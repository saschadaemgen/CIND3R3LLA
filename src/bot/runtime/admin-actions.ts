/**
 * The admin console's hand on the running runtime (CCB-S4-022, D-126).
 *
 * ── WHY A LATE-BOUND HANDLE AND NOT A CONSTRUCTOR ARGUMENT ──────────────────
 *
 * The admin server is built before the bot starts: `runApp` calls
 * `startAdminServer` and only then `startCaptureWorker`, deliberately, so the console
 * is up and can SHOW a failure when the bot fails to start. So there is no runtime to
 * pass into `ViewContext` at the moment the views are registered, and threading a
 * "maybe later" getter through `ServerDeps`, `ViewContext` and every harness that
 * builds a server would change five files to express "not yet".
 *
 * `core-delete.ts` faced exactly this and solved it exactly this way (CCB-S3-027), for
 * the same reason: a queue job that erases from the core runs on its own timer with no
 * relation to the bot's boot. This module follows that precedent rather than inventing
 * a second one.
 *
 * ── WHAT THE WEB LAYER GETS, AND WHAT IT DOES NOT ───────────────────────────
 *
 * It gets operations returning plain data. It does NOT get the `ChatApi`. That is not
 * tidiness: `verify:adapter-seam` forbids the SDK outside `src/bot/`, and a console
 * that held a chat handle would be one careless import away from issuing commands with
 * no scheduler and no readiness check, from an HTTP request handler.
 *
 * ── WHY AN EXPLICIT USER ID MAKES THIS SAFE ON THE SHARED HANDLE ────────────
 *
 * `apiCreateUserAddress` and `apiGetUserAddress` both take a `userId`. Commands that
 * carry one cannot execute as the wrong profile, which is the whole hazard D-085
 * measured and the scheduler exists to prevent. They still go through the scheduler
 * here, because the alternative is a rule that holds only while somebody remembers it.
 */

import { util } from 'simplex-chat';
import { log } from '../../log.js';
import type { RuntimeBotHandle } from './host.js';

/** The live runtime-hosted bot, when one is running. Absent in harnesses and scripts. */
let handle: RuntimeBotHandle | null = null;

export function setRuntimeAdminHandle(h: RuntimeBotHandle | null): void {
  handle = h;
}

/** Whether a runtime action can be attempted at all right now. */
export function runtimeAdminAvailable(): boolean {
  return handle !== null;
}

export class RuntimeActionUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RuntimeActionUnavailableError';
  }
}

/** Who the runtime is hosting, for a console that must not act on the wrong identity. */
export interface HostedIdentity {
  simplexUserId: number;
  displayName: string;
  /** `ready` means the core has settled; anything else means it has not (D-125). */
  state: string;
}

export function hostedIdentity(): HostedIdentity | null {
  if (handle === null) return null;
  const profile = handle.runtime.profiles[0];
  if (profile === undefined) return null;
  return {
    simplexUserId: profile.simplexUserId,
    displayName: profile.displayName,
    state: handle.runtime.state,
  };
}

/**
 * The running bot, or a refusal explaining why there is none. One place, because every
 * onboarding step needs the same three answers and each of them is a different sentence
 * the operator can act on.
 */
function requireReadyBot(
  what: string,
): { bot: RuntimeBotHandle; simplexUserId: number; displayName: string } {
  const bot = handle;
  if (bot === null) {
    throw new RuntimeActionUnavailableError(
      `The SimpleX runtime is not running, so ${what} yet. Start the bot and try again.`,
    );
  }
  const profile = bot.runtime.profiles[0];
  if (profile === undefined) {
    throw new RuntimeActionUnavailableError(
      'The runtime is running but is hosting no profile, so there is no identity to act as.',
    );
  }
  if (bot.runtime.state !== 'ready') {
    throw new RuntimeActionUnavailableError(
      `The SimpleX core is still starting up (${bot.runtime.state}). It settles a few ` +
        `seconds after a restart; try again once the bot is live.`,
    );
  }
  return { bot, simplexUserId: profile.simplexUserId, displayName: profile.displayName };
}

export interface BotAddress {
  link: string;
  /** False when the address already existed and was read back rather than created. */
  created: boolean;
  simplexUserId: number;
  displayName: string;
}

/**
 * Create the bot's SimpleX contact address, or return the one it already has.
 *
 * IDEMPOTENT BY CONSTRUCTION, not by catching an error: it asks first. Pressing the
 * button twice must not produce a second address, and it must not produce a failure
 * either, because an operator who sees an error reasonably concludes the first press
 * did not work.
 */
export async function createOrShowBotAddress(): Promise<BotAddress> {
  // Refused rather than queued while the core is still subscribing. Creating an address
  // is an interactive network command and the core settles about ten seconds after a
  // restart (D-125); holding an HTTP request open for that long would look like a hung
  // console, while saying so and letting the operator press again takes one sentence.
  const { bot, simplexUserId, displayName } = requireReadyBot(
    'no contact address can be created',
  );

  const existing = await bot.runScheduled('address:show', () =>
    bot.chat.apiGetUserAddress(simplexUserId),
  );
  if (existing?.connLinkContact) {
    const link = util.contactAddressStr(existing.connLinkContact);
    log.info('runtime: contact address already existed, showing it', { simplexUserId });
    return { link, created: false, simplexUserId, displayName };
  }

  const created = await bot.runScheduled('address:create', () =>
    bot.chat.apiCreateUserAddress(simplexUserId),
  );
  const link = util.contactAddressStr(created);
  if (!link) {
    // The state must not advance on this: an address the core did not really return is
    // exactly the stored-but-fake success the wizard has been showing for a season.
    throw new Error(
      'The SimpleX core accepted the create-address command but returned no link. ' +
        'The address was NOT created; nothing has been recorded.',
    );
  }
  log.info('runtime: contact address created', { simplexUserId });
  return { link, created: true, simplexUserId, displayName };
}

export interface AcceptedContact {
  contactId: number;
  contactName: string;
}

/**
 * Accept an incoming contact request, by the core's own request id (CCB-S4-023).
 *
 * ── WHY THIS ONE GENUINELY NEEDS THE SCHEDULER, WHERE THE ADDRESS STEP DID NOT ──
 *
 * `apiCreateUserAddress` and `apiGetUserAddress` take an explicit `userId`, so they
 * cannot execute as the wrong profile whatever the active user happens to be.
 * `apiAcceptContactRequest(contactReqId)` takes NO user id: it executes as whichever
 * profile is active, which is precisely the silent cross-profile execution D-085
 * measured. With one profile hosted and pinned there is nothing to misroute to today,
 * and the day a second profile exists this call would accept somebody else's contact
 * request with nothing raised. Going through the scheduler is what keeps that from
 * being a discovery.
 */
export async function acceptContactRequest(contactRequestId: number): Promise<AcceptedContact> {
  const { bot, simplexUserId } = requireReadyBot('this request cannot be accepted');
  const contact = await bot.runScheduled(`contact:accept:${contactRequestId}`, () =>
    bot.chat.apiAcceptContactRequest(contactRequestId),
  );
  if (typeof contact?.contactId !== 'number') {
    // The SDK already throws when the core answers anything but acceptingContactRequest;
    // this covers the shape being right and the content being empty, because the caller
    // is about to record a connection on the strength of it.
    throw new Error(
      'The SimpleX core accepted the request but returned no contact. Nothing has been ' +
        'recorded; the request is still pending.',
    );
  }
  log.info('runtime: contact request accepted', {
    contactRequestId,
    contactId: contact.contactId,
    simplexUserId,
  });
  return {
    contactId: contact.contactId,
    contactName: contact.profile?.displayName ?? contact.localDisplayName ?? 'unknown',
  };
}

/**
 * Reject an incoming contact request.
 *
 * The SDK notes that the sender is NOT notified, which is worth knowing before pressing
 * it: from their side the invitation simply never completes.
 */
export async function rejectContactRequest(contactRequestId: number): Promise<void> {
  const { bot, simplexUserId } = requireReadyBot('this request cannot be rejected');
  await bot.runScheduled(`contact:reject:${contactRequestId}`, () =>
    bot.chat.apiRejectContactRequest(contactRequestId),
  );
  log.info('runtime: contact request rejected', { contactRequestId, simplexUserId });
}
