/**
 * Consent commands: `/publish` and `/unpublish` (ASCII only, briefing §9).
 *
 * Commands arrive as plain group messages to the bot. On `/publish` the sender's
 * stable member id is recorded as opted-in; on `/unpublish` it is revoked. Every
 * confirmation reply states what publishing means and how to revoke.
 */

import { log } from '../log.js';
import { getPool } from '../db/pool.js';
import { applyConsentChange } from './apply.js';
import { status } from '../web/status.js';
import { formatOutbound } from '../interaction/reply.js';
import { DEFAULT_INTERACTION, type InteractionSettings } from '../interaction/settings.js';
import type { CapturedMessage } from '../capture/message.js';
import type { BotReplyMeta } from '../capture/bot-message.js';

export type ConsentCommand = 'publish' | 'unpublish';

/**
 * The transport a consent confirmation is sent through. Matches the interaction
 * engine's `send`, so both reply paths archive her side the same way.
 */
export type ConsentSender = (
  msg: CapturedMessage,
  text: string,
  opts: { quote: boolean } & BotReplyMeta,
) => Promise<void>;

/** Recognizes an exact `/publish` or `/unpublish` command (ASCII, trimmed). */
export function parseConsentCommand(text: string): ConsentCommand | null {
  const t = text.trim().toLowerCase();
  if (t === '/publish') return 'publish';
  if (t === '/unpublish') return 'unpublish';
  return null;
}

const PUBLISH_REPLY =
  "You're opted in. From now on, the messages you post in this group may appear " +
  'on the public web archive. This applies only to messages you send from this ' +
  'point onward - nothing you posted earlier. You can opt out at any time by ' +
  'sending /unpublish, which also removes your messages from the archive.';

const UNPUBLISH_REPLY =
  "You're opted out. Your messages will not appear on the public web archive, and " +
  'any of your messages that were published have been removed from it. You can opt ' +
  'in again at any time by sending /publish (only messages you send after opting ' +
  'in will be published). I will ask next whether to keep your messages hidden or ' +
  'destroy them for good.';

const FAILURE_REPLY =
  'Sorry - I could not process your command right now due to a temporary error. ' +
  'Please send it again in a moment.';

/**
 * Consent-first welcome message posted to the group on join (briefing §9,
 * Addendum 2 A2.7, Connect & Go-Live C.2). Cinderella's own voice; it is the
 * consent notice that does the legal work — posted verbatim. Do not paraphrase.
 *
 * NOTE (CCB-S3-003): an earlier version of this comment claimed SimpleX renders
 * no markdown. That is wrong, and believing it is what shipped literal asterisks
 * to the live group. SimpleX DOES render single-character delimiters — `*bold*`,
 * `_italic_`, `~strike~`, backtick code, `#secret#`. This message contains none,
 * so it is unaffected, but any copy added here must respect that.
 */
const ARRIVAL_TEMPLATE = `I'm {wake}, and yes, I run this place.

Before you settle in, one thing you should know. By default, whatever you say here stays here, between us. I publish nothing of yours to the outside world unless you tell me to.

If you want your words to step into the light and join the public record, that is your call. Say so, and I will carry your messages, meaning your text, images, video and links, out to my public archive, a searchable page kept for good, with your name on it. From the moment you say yes, and only forward from there. Never behind your back.

Three things worth knowing before you decide.
Forward only: I only ever publish what you say after you opt in, never anything from before.
Public until you take it back: it stays on the web, and searchable, for as long as you leave it there.
Taking it back is instant, and then you choose: /unpublish removes everything from public view at once. I then ask whether to hide your words, which keeps them safe and lets you bring them back whenever you like, or delete them, which destroys them for good. Until you answer, they stay hidden.

To let me publish for you, send /publish
To take it all back, send /unpublish
To see everything I can do, send /help

No /publish, and you simply talk freely. Nothing leaves this room. Your choice, always, and yours to change whenever you like.

{wake}`;

/**
 * HER ARRIVAL NOTICE, addressed in the bot's own configured name.
 *
 * Renamed from `welcomeMessage` under CCB-S5-041 (D-206). Three unrelated things were called
 * "welcome" and the collision hid a dead field for months: this line, which she posts when SHE
 * joins a group; `AddressSettings.autoReply`, stored by onboarding as `welcome_message` and
 * wired to nothing; and the member greeting the Welcome plugin now owns. This one fires on
 * `userJoinedGroup` - her own join - and greets the ROOM, not a member.
 *
 * CIND3R3LLA is the PRODUCT. The bot running in a given community is named by its
 * operator, so no member-facing copy may hard-code a name (CCB-S3-031 follow-up).
 */
export function arrivalNotice(wakeWord: string): string {
  return ARRIVAL_TEMPLATE.split('{wake}').join(wakeWord);
}

/**
 * Sends a consent confirmation. These NEVER quote (CCB-S3-003): a `/publish` is
 * one word, so repeating it above the answer adds nothing but clutter — the same
 * clutter this briefing removes from the natural-language path. In `mention` mode
 * the member's name is prefixed instead, which is what ties the notice to them.
 *
 * The chat rendering was never the consent record: `consent` and `consent_actions`
 * are. Do not reintroduce the quote to "prove" who opted in.
 */
async function reply(
  msg: CapturedMessage,
  text: string,
  s: InteractionSettings,
  send: ConsentSender,
): Promise<void> {
  try {
    const out = formatOutbound(text, {
      mode: s.replyMode,
      prefixTemplate: s.namePrefix.enabled
        ? (s.namePrefix.templates[s.defaultLanguage] ?? s.namePrefix.templates['en'] ?? null)
        : null,
      displayName: msg.senderDisplayName,
      allowQuote: false,
    });
    // A consent confirmation is archive content of the "consent" category
    // (CCB-S3-007 §3). It names the member only when the prefix put their name
    // there — and note that an /unpublish confirmation therefore names somebody
    // who has, one line earlier, just opted OUT: the guard redacts it, which is
    // the correct answer and worth keeping in mind before "simplifying" it.
    const meta = {
      quote: out.quote,
      category: 'consent' as const,
      lang: s.defaultLanguage,
      mentions: out.prefixName
        ? [{ displayName: out.prefixName, memberId: msg.senderMemberId }]
        : [],
    };
    await send(msg, out.text, meta);
  } catch (err) {
    log.warn(
      `Failed to send consent confirmation to member ${msg.senderMemberId}: ` +
        `${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

/**
 * Builds the command handler used by the capture pipeline. Records consent and
 * replies with a confirmation.
 */
export function makeConsentHandler(
  interaction: { get(): InteractionSettings } | undefined,
  /** Called after a confirmation is sent, so the follow-up window opens (§7c). */
  onReplied: ((groupId: number, memberId: string) => void) | undefined,
  opts: {
    /**
     * The archiving transport (CCB-S3-007), and now the ONLY way out.
     *
     * ── WHY IT STOPPED BEING OPTIONAL (CCB-S5-001) ──────────────────────────
     *
     * It was optional so that "the harnesses and the connect script can still build a
     * handler with nothing behind it", and when absent the reply went straight out
     * through `sendToChat(botHandle.chat, ...)`. That claim had gone stale: this
     * function has exactly one caller, `src/index.ts`, and it has always passed a
     * transport. So the fallback was unreachable code that nonetheless reached the
     * core with an unscheduled, unheld, unattributed send - which with a second bot
     * hosted would post a member's consent confirmation as the wrong bot.
     *
     * Requiring it deletes that call site rather than scheduling it, which is the
     * cheaper of the two correct answers.
     */
    send: ConsentSender;
    /**
     * Asks the hide-or-delete question after a `/unpublish` (CCB-S3-013), so the
     * slash path and the spoken path mean the same thing by a revocation.
     */
    askRevokeChoice?: (msg: CapturedMessage) => Promise<void>;
    /**
     * Does THIS bot act on a consent command in this group (CCB-S5-027, D-182)?
     *
     * `/publish` names no bot, so with two hosted bots in one group both of them receive
     * the message and both of them run this handler. That is a different order of problem
     * from two bots answering `/search`:
     *
     *   · the consent table has no bot dimension, so both writes land on the same member's
     *     row and the SECOND one is a second `opt_in` for a member who already opted in;
     *   · both send a confirmation, so a member sees their consent decision acknowledged
     *     twice by two different names and cannot tell which one holds it;
     *   · `/unpublish` asks the hide-or-delete question twice, leaving two independent
     *     pending choices, and the member's single answer resolves both. A "delete" is
     *     the one action in this product that cannot be undone.
     *
     * So one bot acts and the rest stand down. Absent means yes, for the reason the
     * engine's copy of this gives: a deployment that knows nothing about co-tenancy is one
     * where there is none, and a consent command must never go unanswered because an index
     * was cold.
     */
    answersCommands?: (groupId: number) => boolean;
  },
): (msg: CapturedMessage, command: ConsentCommand) => Promise<void> {
  return async (msg, command) => {
    if (opts.answersCommands && !opts.answersCommands(msg.groupId)) {
      // NOT an error and not a warning. This is the arrangement working: another hosted
      // bot in this group is the one that acts, and it is doing so right now. The message
      // is already persisted and already categorised as `consent` by the capture handler,
      // so nothing about the record depends on this branch.
      log.debug(
        `Consent: /${command} from member ${msg.senderMemberId} in group ${msg.groupId} is ` +
          `another hosted bot's to act on; standing down.`,
      );
      return;
    }
    const db = getPool();
    // Read the presentation settings ONCE, up front, and never between recording
    // a consent change and confirming it: a throw in that gap would send the
    // failure notice for a decision that was actually written.
    let presentation = DEFAULT_INTERACTION;
    try {
      presentation = interaction?.get() ?? DEFAULT_INTERACTION;
    } catch (err) {
      log.warn(
        `Could not read interaction settings for a consent confirmation; using defaults (${
          err instanceof Error ? err.message : String(err)
        }).`,
      );
    }
    try {
      // Slash commands stay IMMEDIATE (CCB-S3-002 §4.1) — the confirmation
      // handshake applies to natural language only. They share the write path
      // with it so both are journalled and undoable in the same way.
      if (command === 'publish') {
        await applyConsentChange(db, {
          memberId: msg.senderMemberId,
          at: msg.sentAt,
          action: 'opt_in',
          source: 'slash',
        });
        log.info(`Consent: opt-in recorded for member ${msg.senderMemberId}.`);
        await reply(msg, PUBLISH_REPLY, presentation, opts.send);
        onReplied?.(msg.groupId, msg.senderMemberId);
      } else {
        const { hadActive } = await applyConsentChange(db, {
          memberId: msg.senderMemberId,
          at: msg.sentAt,
          action: 'opt_out',
          source: 'slash',
        });
        log.info(
          `Consent: opt-out recorded for member ${msg.senderMemberId} (had active consent: ${hadActive}).`,
        );
        await reply(msg, UNPUBLISH_REPLY, presentation, opts.send);
        onReplied?.(msg.groupId, msg.senderMemberId);
        // Hide or delete (CCB-S3-013). Asked after the confirmation so the member
        // sees the revocation land first, and the content is already hidden either
        // way. A failure here must not report the revocation itself as failed: it
        // succeeded, and the choice can be asked again.
        try {
          await opts.askRevokeChoice?.(msg);
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          log.error(
            `Consent: /unpublish succeeded for member ${msg.senderMemberId} but the hide-or-delete ` +
              `question could not be asked: ${message}`,
          );
          status.error(
            `A member revoked with /unpublish but was not asked whether to hide or delete. Their ` +
              `content is hidden; the choice is unanswered: ${message}`,
          );
        }
      }
    } catch (err) {
      // Fail loudly toward the member and the operator — never silently drop a
      // consent decision (it is the product's legal backbone).
      const message = err instanceof Error ? err.message : String(err);
      log.error(`Consent command /${command} failed for member ${msg.senderMemberId}: ${message}`);
      status.error(
        `Consent command /${command} failed for member ${msg.senderMemberId}: ${message}`,
      );
      await reply(msg, FAILURE_REPLY, presentation, opts.send);
    }
  };
}
