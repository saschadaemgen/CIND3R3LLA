/**
 * The welcome's transport, and the only place that learns whether a private route exists
 * (CCB-S5-041, D-206). On the bridge-port / recital-port pattern.
 *
 * ── AVAILABILITY IS DISCOVERED, NEVER PREDICTED ─────────────────────────────
 *
 * `greeting.ts` plans an ATTEMPT and this makes it. That split is the whole design, and the
 * reason is that the question cannot honestly be answered anywhere else:
 *
 *   - `directMessages` is a `RoleGroupPreference` - `{ enable, role? }`, "allowed from this
 *     role upwards" rather than a flat switch. The bot is an ordinary member under that rule
 *     and benefits only from whatever role it holds.
 *   - Deciding it here would mean ordering `observer / author / member / moderator / admin /
 *     owner` OURSELVES, over a vocabulary SimpleX owns and extends. That is the D-201 trap:
 *     a role added later lands outside the comparison and the guard answers wrong, silently.
 *   - And `memberContactId` can be absent regardless of any preference.
 *
 * The core already computes the answer. So: attempt, and read what came back.
 *
 * ── THE THREE REFUSALS ARE THREE DIFFERENT FACTS ────────────────────────────
 *
 * Kept apart because CCB-S3-023 forbids rendering "not configured" and "configured but
 * failing" alike, and because the operator's next action differs for each:
 *
 *   no-contact   there is no `memberContactId`. No private route EXISTS to this member; the
 *                commonest case, for anyone who joined by link and never connected directly.
 *                Not a refusal - an absence. Nothing is wrong.
 *   prohibited   the core answered `directMessagesProhibited`. The group's rule refuses it for
 *                this bot's ROLE. Correct behaviour by the admin's configuration.
 *   send-failed  something else broke. The ONLY one of the three that is a fault, the only one
 *                that reaches `status.error`, and the only one a fallback must not absorb.
 */

import type { T } from '@simplex-chat/types';
import { log } from '../log.js';
import { describeChatError } from './runtime/chat-error.js';

/** What a private attempt can come back as. `sent` carries no reason; the others always do. */
export type SendOutcome =
  | { ok: true }
  | { ok: false; reason: 'no-contact' | 'prohibited' | 'send-failed'; detail?: string };

export interface WelcomeTransport {
  /** Publicly, in the group. Always available; the fallback target. */
  sendToGroup(groupId: number, text: string): Promise<T.AChatItem[]>;
  /**
   * Into the member support thread: the private strand inside the group.
   *
   * Needs no direct-message permission because it never leaves the group, and needs no raw
   * command either - `ChatRef` carries an optional `chatScope` and `apiSendMessages` takes a
   * `ChatRef`, so this is the typed path throughout, unlike the channel join.
   */
  sendToSupportThread(groupId: number, groupMemberId: number, text: string): Promise<T.AChatItem[]>;
  /** Over a direct connection. Requires a contact; the group's rule may still refuse. */
  sendToContact(contactId: number, text: string): Promise<T.AChatItem[]>;
}

/**
 * ONE TRANSPORT PER BOT, resolved by profile id.
 *
 * A single module-level transport was the first shape and was wrong: it would have sent every
 * greeting through whichever bot was registered last, which is the D-171 misrouting shape - the
 * right room, the wrong voice. The bridge port can be a singleton because it resolves the
 * OWNING bot through the runtime; here the caller already knows which bot is greeting, so it
 * says so.
 */
let transports: ReadonlyMap<number, WelcomeTransport> = new Map();

export function setWelcomeTransports(t: ReadonlyMap<number, WelcomeTransport>): void {
  transports = t;
}

/** Null is a real state: nothing is hosting, which is the admin preview's permanent one. */
function transportFor(botProfileId: number): WelcomeTransport | null {
  return transports.get(botProfileId) ?? null;
}

/**
 * Is the error the core's way of saying "the group's rule forbids this"?
 *
 * Matched on the tagged type rather than on message text, which is the same discipline the
 * chat-error work settled: a string comparison against a core-authored sentence breaks on the
 * day somebody rewords it, and does so silently.
 */
function isProhibited(err: unknown): boolean {
  const e = err as { chatError?: { errorType?: { type?: string } } } | null;
  return e?.chatError?.errorType?.type === 'directMessagesProhibited';
}

/**
 * Try the private route the operator chose, and say precisely what happened.
 *
 * `memberContactId` absent is checked BEFORE any command is issued: there is nothing to
 * address, so sending would be a guess at a contact id, and a wrong one reaches the wrong
 * person. That is the one case worth refusing without asking the core.
 */
export async function attemptPrivate(
  botProfileId: number,
  route: 'support' | 'direct',
  // `memberContactId?: number | undefined` rather than `?: number`, because
  // `exactOptionalPropertyTypes` is on and the caller genuinely holds an absent contact as
  // `undefined`. Absence IS the no-contact case, so it must be expressible, not omitted.
  args: {
    groupId: number;
    groupMemberId: number;
    memberContactId?: number | undefined;
    text: string;
  },
): Promise<SendOutcome> {
  const transport = transportFor(botProfileId);
  if (transport === null) {
    return { ok: false, reason: 'send-failed', detail: 'nothing is hosting' };
  }
  if (route === 'direct' && args.memberContactId === undefined) {
    return { ok: false, reason: 'no-contact' };
  }
  try {
    if (route === 'support') {
      await transport.sendToSupportThread(args.groupId, args.groupMemberId, args.text);
    } else {
      // Checked above; narrowed here rather than asserted.
      const contactId = args.memberContactId;
      if (contactId === undefined) return { ok: false, reason: 'no-contact' };
      await transport.sendToContact(contactId, args.text);
    }
    return { ok: true };
  } catch (err) {
    if (isProhibited(err)) return { ok: false, reason: 'prohibited' };
    // A FAULT. Logged with actionable context here; `status.error` is raised by the caller,
    // which knows the bot and the room this happened in.
    log.error('welcome: a private greeting could not be sent', {
      route,
      groupId: args.groupId,
      error: describeChatError(err),
    });
    return { ok: false, reason: 'send-failed', detail: describeChatError(err) };
  }
}

/** The public route. Separate because it is the fallback target and cannot itself fall back. */
export async function sendToGroup(
  botProfileId: number,
  groupId: number,
  text: string,
): Promise<SendOutcome> {
  const transport = transportFor(botProfileId);
  if (transport === null) {
    return { ok: false, reason: 'send-failed', detail: 'nothing is hosting' };
  }
  try {
    await transport.sendToGroup(groupId, text);
    return { ok: true };
  } catch (err) {
    log.error('welcome: a group greeting could not be sent', {
      groupId,
      error: describeChatError(err),
    });
    return { ok: false, reason: 'send-failed', detail: describeChatError(err) };
  }
}
