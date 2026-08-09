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
import type { T } from '@simplex-chat/types';
import type { Queryable } from '../../db/pool.js';
import { applyProfileUpdate, type HostedBot, type RuntimeHost } from './host.js';
import { flushAvatarToGroups } from '../avatar.js';

/** The live runtime, when one is running. Absent in harnesses and scripts. */
let handle: RuntimeHost | null = null;

export function setRuntimeAdminHandle(h: RuntimeHost | null): void {
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

/**
 * Who the runtime is hosting.
 *
 * Takes a bot profile id since CCB-S5-001: every enabled bot is hosted, so "the hosted
 * identity" is not a single answer any more and a console page that acts on the wrong one
 * would create an address for, or accept a contact as, a bot the operator was not looking
 * at. With no id it answers for the primary, which is the console's default selection.
 */
export function hostedIdentity(botProfileId?: number): HostedIdentity | null {
  if (handle === null) return null;
  // READ-ONLY, so a default is honest here where it was not for the actions: this answers
  // "who is running" for a page, and the primary is the console's default selection. Nothing
  // reached through it has a side effect on a profile.
  const bot = botProfileId === undefined ? handle.primary : pick(handle, botProfileId);
  if (bot === undefined) return null;
  return {
    simplexUserId: bot.simplexUserId,
    displayName: bot.config.displayName,
    state: handle.runtime.state,
  };
}

/** Every hosted bot, so a console page can show which identities exist. */
export function hostedIdentities(): HostedIdentity[] {
  if (handle === null) return [];
  const state = handle.runtime.state;
  return handle.bots.map((b) => ({
    simplexUserId: b.simplexUserId,
    displayName: b.config.displayName,
    state,
  }));
}

/** The shared chat handle. Every use of it here is inside a scheduled critical section. */
function chatOf(): RuntimeHost['chat'] {
  if (handle === null) throw new RuntimeActionUnavailableError('The SimpleX runtime is not running.');
  return handle.chat;
}

/**
 * The hosted bot with this id, or undefined.
 *
 * ── WHY THE ID IS REQUIRED (CCB-S5-007) ──────────────────────────────────────
 *
 * It used to be optional and fall back to `host.primary`, which is how the onboarding
 * console came to run all four of its steps as the primary whatever bot the operator
 * thought he was configuring. The database write was per bot and the SimpleX call was not:
 * accepting a contact for bot B recorded it against B and accepted it as A.
 *
 * A default was the wrong shape for a question with real side effects on a real profile.
 * Required, so a caller that does not name a bot does not compile, which is a stronger
 * guarantee than any runtime check and one nobody can forget to write.
 */
function pick(host: RuntimeHost, botProfileId: number): HostedBot | undefined {
  return host.bots.find((b) => b.config.botProfileId === botProfileId);
}

/**
 * The running bot, or a refusal explaining why there is none. One place, because every
 * onboarding step needs the same three answers and each of them is a different sentence
 * the operator can act on.
 */
function requireReadyBot(
  what: string,
  botProfileId: number,
): { host: RuntimeHost; bot: HostedBot; simplexUserId: number; displayName: string } {
  const host = handle;
  if (host === null) {
    throw new RuntimeActionUnavailableError(
      `The SimpleX runtime is not running, so ${what} yet. Start the bot and try again.`,
    );
  }
  const bot = pick(host, botProfileId);
  if (bot === undefined) {
    // Named rather than falling back to the primary. Acting as a different bot than the
    // page the operator is looking at is exactly the confusion hosting several of them
    // introduces, and doing it silently would create an address on the wrong identity.
    throw new RuntimeActionUnavailableError(
      `Bot ${String(botProfileId)} is not currently hosted, so nothing can be done as it. ` +
        `Enable it and restart, or pick a bot that is running.`,
    );
  }
  if (host.runtime.state !== 'ready') {
    throw new RuntimeActionUnavailableError(
      `The SimpleX core is still starting up (${host.runtime.state}). It settles a few ` +
        `seconds after a restart; try again once the bot is live.`,
    );
  }
  // The HOST is returned too since CCB-S5-016: applying a face needs the runtime and the
  // chat handle, and re-reading the module-level `handle` afterwards would be a second
  // read of something this function has already proven non-null.
  return { host, bot, simplexUserId: bot.simplexUserId, displayName: bot.config.displayName };
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
export async function createOrShowBotAddress(botProfileId: number): Promise<BotAddress> {
  // Refused rather than queued while the core is still subscribing. Creating an address
  // is an interactive network command and the core settles about ten seconds after a
  // restart (D-125); holding an HTTP request open for that long would look like a hung
  // console, while saying so and letting the operator press again takes one sentence.
  const { bot, simplexUserId, displayName } = requireReadyBot(
    'no contact address can be created',
    botProfileId,
  );

  const existing = await bot.runScheduled('address:show', () =>
    chatOf().apiGetUserAddress(simplexUserId),
  );
  if (existing?.connLinkContact) {
    const link = util.contactAddressStr(existing.connLinkContact);
    log.info('runtime: contact address already existed, showing it', { simplexUserId });
    return { link, created: false, simplexUserId, displayName };
  }

  const created = await bot.runScheduled('address:create', () =>
    chatOf().apiCreateUserAddress(simplexUserId),
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
export async function acceptContactRequest(
  contactRequestId: number,
  botProfileId: number,
): Promise<AcceptedContact> {
  const { bot, simplexUserId } = requireReadyBot('this request cannot be accepted', botProfileId);
  const contact = await bot.runScheduled(`contact:accept:${contactRequestId}`, () =>
    chatOf().apiAcceptContactRequest(contactRequestId),
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
export async function rejectContactRequest(
  contactRequestId: number,
  botProfileId: number,
): Promise<void> {
  const { bot, simplexUserId } = requireReadyBot('this request cannot be rejected', botProfileId);
  await bot.runScheduled(`contact:reject:${contactRequestId}`, () =>
    chatOf().apiRejectContactRequest(contactRequestId),
  );
  log.info('runtime: contact request rejected', { contactRequestId, simplexUserId });
}

export interface JoinedGroup {
  groupId: number;
  groupName: string;
  /**
   * The role the core reports for the bot's OWN membership after joining.
   *
   * Not the role the invitation offered, and not the operator's expected role.
   * Verifying it against the expected one is step four; this is only what is true.
   */
  role: string;
}

/**
 * Join a group the bot has been invited to, by the core's own group id (CCB-S4-025).
 *
 * Through the scheduler, and for the same reason as the contact accept:
 * `apiJoinGroup(groupId)` takes NO user id, so it executes as whichever profile is
 * active. With one profile hosted and pinned there is nothing to misroute to today; with
 * two, this would join somebody else's group with nothing raised.
 */
export async function joinInvitedGroup(
  groupId: number,
  botProfileId: number,
): Promise<JoinedGroup> {
  const { bot, simplexUserId } = requireReadyBot('this group cannot be joined', botProfileId);
  const info = await bot.runScheduled(`group:join:${groupId}`, () =>
    chatOf().apiJoinGroup(groupId),
  );
  const role = info?.membership?.memberRole;
  if (typeof role !== 'string' || !role) {
    // The caller is about to record a membership on the strength of this. A join whose
    // answer carries no role tells us the bot is in the group and nothing about what it
    // can do there, which is the one thing step four needs from step three.
    throw new Error(
      'The SimpleX core accepted the join but reported no membership role. Nothing has ' +
        'been recorded; the invitation is still pending.',
    );
  }
  log.info('runtime: joined group', { groupId, role, simplexUserId });
  return {
    groupId: info.groupId,
    groupName: info.groupProfile?.displayName ?? info.localDisplayName ?? 'unknown group',
    role,
  };
}


/** What applying a face actually did, so the console reports rather than assumes. */
export interface AppliedFace {
  displayName: string;
  simplexUserId: number;
  /** False when the stored profile already matched. A success, not a no-op. */
  profileWritten: boolean;
  /** Groups the flush reached. Zero with `alreadyCurrent` means members already have it. */
  groupsFlushed: number;
  /** The image had already been flushed, so no group message was needed. */
  alreadyCurrent: boolean;
}

/**
 * Put a bot's face on its live SimpleX profile, now (CCB-S5-016, D-168).
 *
 * ── WHY THIS EXISTS ──────────────────────────────────────────────────────────
 *
 * Uploading an avatar wrote a row and told the operator to restart the bot, and the console
 * offered no way to restart anything: an instruction without a tool, which cost a live avatar
 * once already. Nothing here needed inventing. It is the boot path's two steps, called from
 * the console instead of from `startRuntimeHost`.
 *
 * ── WHY BOTH STEPS ──────────────────────────────────────────────────────────
 *
 * `apiUpdateProfile` reaches direct CONTACTS only. A group member sees a member-profile
 * update when the bot next sends a GROUP message, because the core piggybacks `XInfo` onto
 * it. Writing the profile without flushing changes nothing anybody can see, which is exactly
 * the half-measure being replaced.
 *
 * ── THE STALE SNAPSHOT, WHICH IS THE TRAP ───────────────────────────────────
 *
 * `bot.user` is the `T.User` the core reported AT BOOT. `flushAvatarToGroups` derives its
 * marker from `user.profile.image`, so handing it the boot snapshot after changing the profile
 * computes the marker of the OLD image. After any normal boot that image has already been
 * flushed, so the marker would match, the flush would return early, and the new face would
 * reach nobody while this function reported success.
 *
 * So the flush is given a user carrying the image just written. `applyProfileUpdate` still
 * diffs against the boot snapshot and may therefore write when the profile already matches;
 * that is the conservative direction and is left alone deliberately. A redundant write costs
 * one command. A skipped one costs the entire point.
 */
export async function applyBotFaceNow(
  db: Queryable,
  botProfileId: number,
  image: string | undefined,
): Promise<AppliedFace> {
  const { host, bot, simplexUserId, displayName } = requireReadyBot(
    'its face cannot be applied to the running bot',
    botProfileId,
  );

  // THE ONE THING THAT GENUINELY CANNOT BE DONE LIVE, named rather than silently skipped.
  // With no image anywhere there is nothing to write, and writing an image-less profile makes
  // the SDK deep-diff it against the stored one and WIPE the avatar, then propagate the blank
  // to the group. `applyProfileUpdate` refuses for that reason; refusing here first means the
  // operator gets a sentence rather than a button that appears to work.
  if (image === undefined) {
    throw new RuntimeActionUnavailableError(
      `${displayName} has no image to apply: it has no upload of its own, and the deployment ` +
        `has no default avatar either. Upload one for this bot, or set AVATAR_PATH.`,
    );
  }

  const before = (bot.user.profile as unknown as T.Profile).image;
  await applyProfileUpdate(host.runtime, simplexUserId, displayName, image, bot.user);

  const flushed = await flushAvatarToGroups(host.chat, db, {
    // The image just written, NOT the boot snapshot. See above; this is the whole trap.
    user: { ...bot.user, profile: { ...bot.user.profile, image } },
    displayName,
    sendToGroup: (groupId, text) => bot.sendGroupText(groupId, text),
  });

  log.info('runtime: applied a bot face on demand', {
    simplexUserId,
    displayName,
    profileWritten: before !== image,
    groupsFlushed: flushed.sent,
  });

  return {
    displayName,
    simplexUserId,
    profileWritten: before !== image,
    groupsFlushed: flushed.sent,
    alreadyCurrent: flushed.alreadyFlushed,
  };
}
