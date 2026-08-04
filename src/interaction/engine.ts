/**
 * The dialogue engine (CCB-S3-002 §4) — where an understood instruction becomes
 * an action, or, far more often, becomes a question.
 *
 * The division of labour is strict and deliberate:
 *
 *   addressing.ts  decides whether she was spoken to
 *   resolver.ts    decides what was probably meant   (never executes anything)
 *   engine.ts      decides what to do about it       (this file)
 *   consent/apply  performs the consent change       (the existing, tested path)
 *
 * The engine holds no consent SQL of its own. Every opt-in and opt-out it causes
 * goes through the same `applyConsentChange` the `/publish` command uses, so the
 * natural-language path cannot drift away from the slash path, and the consent
 * rules are enforced in exactly one place.
 *
 * Two safety properties are worth reading twice:
 *
 *  - **A consent change never happens on one message.** PUBLISH and UNPUBLISH
 *    always propose and wait for an affirmative answer inside the follow-up
 *    window (§4.1). Slash commands are untouched by this and stay immediate.
 *  - **Consent is first-person, always.** If the instruction names or points at
 *    somebody else she refuses and does nothing (§4.2) — the requester being an
 *    admin makes no difference, because there is no admin concept in this path
 *    at all: the member id acted on is always the sender's own.
 */

import { log } from '../log.js';
import { status } from '../web/status.js';
import type { Queryable } from '../db/pool.js';
import { countPublishedMatching } from '../db/public-archive.js';
import { memberArchiveCounts } from '../db/member-stats.js';
import {
  lastUndoableAction,
  undoLastConsentAction,
  undoReducesExposure,
} from '../db/consent-actions.js';
import { applyConsentChange } from '../consent/apply.js';
import {
  chooseDelete,
  chooseHide,
  restoreHiddenContent,
  type TxRunner,
} from '../consent/revocation.js';
import { getConsent } from '../db/consent.js';
import { loadConfig } from '../config.js';
import type { CapturedMessage } from '../capture/message.js';
import { detectAddress } from './addressing.js';
import { carryOverSlots, resolveIntent } from './resolver.js';
import { ConversationState, type PendingChoice, type PendingConfirmation } from './state.js';
import {
  NEAR_MISS_EXCERPT,
  recordNearMiss,
  recentNearMisses,
  type NearMiss,
  type NearMissReason,
} from './near-misses.js';
import {
  DEFAULT_INTERACTION,
  PERSONA_CATEGORY,
  fillPersona,
  botIdentity,
  type InteractionSettings,
  type PersonaKey,
} from './settings.js';
import type { BotReplyMeta, ReplyMention } from '../capture/bot-message.js';
import type { MemberCategory, ReplyCategory } from '../archive/settings.js';
import { detectLanguage, fuzzyEquals, normTokens } from './text.js';
import type { PriceOutcome } from '../plugins/crypto-prices/service.js';
import { formatAmount, formatValue, describeAge } from '../price/format.js';
import { candidateMetric } from '../plugins/crypto-prices/service.js';
import { formatOutbound, type OutboundReply } from './reply.js';
import { activeIntentList } from './intent.js';
import { buildHelpReply, buildHelpTopic, parseHelpTopic, type HelpLang } from './help.js';
import type { AiReplyMode, AiReplyRequest } from './ollama-reply.js';
import type { BotIdentity, BotPersonality } from './personality.js';
import { recordConversation } from './conversation-log.js';

export interface InteractionDeps {
  db: Queryable;
  /** Live settings — read per message, never cached across edits. */
  settings: () => InteractionSettings;
  /**
   * Where media lives, so a confirmed destruction can erase the files a member's
   * messages own (CCB-S3-013). Defaults to the configured root; the harness
   * points it at a temporary tree.
   */
  mediaRoot?: string;
  /**
   * Transaction boundary for a destruction (CCB-S3-013). Defaults to the real
   * pool; the harness supplies its own so the whole delete path can be exercised
   * against PGlite instead of a live server.
   */
  runTx?: TxRunner;
  /**
   * Sends a reply in the chat the message came from. `opts.quote` decides
   * whether it appears as a quoting reply (CCB-S3-003); the rest describes the
   * reply for the archive (CCB-S3-007) — what kind of thing it is, what language
   * it is in, and which member names it puts into the text.
   *
   * The engine does not decide whether any of that gets published. It states
   * facts about the message; the derivation decides.
   */
  send: (
    msg: CapturedMessage,
    text: string,
    opts: { quote: boolean } & BotReplyMeta,
  ) => Promise<void>;
  /** Injectable clock (harness). */
  now?: () => number;
  /** Injectable randomness for retort rotation (harness). */
  random?: () => number;
  /**
   * Market data (CCB-S3-004), injected by the plugin. Absent when the plugin is
   * disabled — in which case PRICE is not in the active catalog either, so this
   * is belt and braces rather than the only guard.
   */
  prices?: {
    price(
      base: string,
      quote: string | undefined,
      amount: number,
      scope?: string,
      alternates?: string[],
    ): Promise<PriceOutcome>;
    pin(
      symbol: string,
      candidate: { id: string; symbol: string; name: string; chain?: string; contract?: string },
      provider: string,
      source: 'member-choice',
    ): Promise<unknown>;
    /** Already resolved on this instance? Reads the pin table, never a provider. */
    isPinned(symbol: string): Promise<boolean>;
  };
  /** Live plugin settings for the price feature. */
  priceSettings?: () => {
    rateLimitPerMember: number;
    rateLimitPerChat: number;
    disclaimer: string;
  };
  /**
   * Optional local-AI wording layer.
   *
   * It receives a reply whose meaning and facts are already fixed. Returning
   * null keeps the deterministic persona string. Tests and rules-only instances
   * can omit it entirely.
   */
  personalize?: (request: AiReplyRequest) => Promise<string | null>;
  /**
   * Who she is and how she is dialled (CCB-S4-029, D-133), read live so a slider the
   * operator just moved takes effect on the next reply rather than on the next restart.
   *
   * Used by free conversation only. It is deliberately NOT threaded into
   * {@link InteractionEngine.personalized}, which rewrites decisions the application
   * has already made: a personality that could reword a consent confirmation would be
   * a personality with reach into the one thing this product cannot get wrong.
   *
   * Absent, or returning null, means no bot profile is selected for the runtime. The
   * prompt builder reads that as "not configured" and still emits the safety ceiling.
   */
  personality?: () => BotPersonality | null;
}

interface ReplyOptions {
  /**
   * Whether this reply opens/refreshes the follow-up window (§2). True for
   * everything except nickname retorts, which must never start a conversation.
   */
  openWindow?: boolean;
  /**
   * Whether this reply may be dropped by the rate limiter. Consent OUTCOMES are
   * exempt: silently changing what is published and not saying so would be the
   * one failure mode this product cannot have. The handshake makes them rare
   * (two messages per change), so exempting them cannot be used to flood.
   */
  bypassLimit?: boolean;
  /** Appended to the reply on its own line (the price disclaimer). */
  suffix?: string;
  /**
   * Never quote, whatever `replyMode` says (CCB-S3-003 §1). Set on the consent
   * confirmation prompts: they may carry a name prefix so the member knows the
   * prompt is theirs, but must not repeat their message back at the group.
   */
  neverQuote?: boolean;
}

/**
 * Matches a member's reply to one of the offered assets: a number ("2"), the
 * asset's name, or its chain. Deliberately strict — a wrong pin is permanent
 * until an operator changes it, so anything unrecognised leaves the question
 * open rather than guessing.
 */
function matchChoice(
  instruction: string,
  choice: PendingChoice,
): PendingChoice['options'][number] | undefined {
  const t = instruction.trim().toLowerCase();
  if (!t) return undefined;
  // The WHOLE message must be the number. `Number.parseInt` reads a prefix, so
  // "2 min" and "1x" used to select an option and write a permanent global pin
  // out of somebody saying how long something would take.
  if (/^\d{1,2}$/.test(t)) {
    const asIndex = Number.parseInt(t, 10);
    if (asIndex >= 1 && asIndex <= choice.options.length) return choice.options[asIndex - 1];
    return undefined;
  }
  for (const o of choice.options) {
    if (o.name.toLowerCase() === t) return o;
    if (o.chain && o.chain.toLowerCase() === t) return o;
  }
  // A distinctive word, e.g. "pulsechain" out of "HEX (PulseChain)".
  const hits = choice.options.filter(
    (o) => o.name.toLowerCase().includes(t) || (o.chain ?? '').toLowerCase().includes(t),
  );
  return hits.length === 1 ? hits[0] : undefined;
}

/**
 * Minimum confidence to act on a message that did NOT name her — one heard only
 * because the follow-up window was open. Set above the single-keyword score so
 * that only a real, multi-word instruction carries inside the window.
 */
const IMPLICIT_MIN_CONFIDENCE = 0.8;

/** Longest fragment that still counts as an elliptical follow-up (§7c). */
const CARRY_OVER_MAX_TOKENS = 4;

/**
 * What kind of member message each intent represents, for the archive
 * (CCB-S3-009 §2). UNKNOWN maps to nothing: a message she did not understand is
 * ordinary conversation and publishes on the plain consent rules.
 */
const MEMBER_CATEGORY_FOR_INTENT: Record<string, MemberCategory | null> = {
  PRICE: 'price',
  SEARCH: 'search',
  STATUS: 'status',
  HELP: 'help',
  // The consent mechanics themselves. Archiving them adds noise, not meaning.
  PUBLISH: 'consent',
  UNPUBLISH: 'consent',
  UNDO: 'consent',
  RESTORE: 'consent',
  UNKNOWN: null,
};

/**
 * Replies that may be reworded freely because they cannot change consent or
 * execute an action. Consent, undo, and action outcomes deliberately stay on
 * their deterministic strings.
 */
const AI_PERSONALIZED_KEYS = new Set<PersonaKey>([
  'status',
  'searchResult',
  'notUnderstood',
  'price',
  'conversion',
  'priceUnknownAsset',
  'priceAmbiguous',
  'priceUnavailable',
  'priceThrottled',
]);

/**
 * Personalized replies whose deterministic text may NOT be rewritten, only led into.
 *
 * `status` is here for a security reason found by the CCB-S4-010 injection review, not
 * for style. In `free` mode the model rewrites the whole draft, and the only protection
 * is `requiredLiterals`, which is built from the persona's variable VALUES. For `status`
 * those values are two bare counts, so the check proves the two numbers still appear and
 * says nothing about what they are now claimed to mean: `I keep 5 of your messages, 0 of
 * them public` and a rewrite that swaps which number is which both satisfy it. Nothing
 * downstream compares the draft's meaning with the output.
 *
 * `status` is the one personalized reply that reports a member's own publication state,
 * which is consent-bearing information (D-080: addressing her IS the consent path). A
 * member misinformed about their state may not exercise a right they have. Locked mode
 * removes the possibility rather than relying on the model: the application appends the
 * deterministic text unchanged and the model only writes the opening line, so the member
 * still gets an individualized reply and the fact is immutable. See D-116.
 */
const AI_LOCKED_KEYS = new Set<PersonaKey>(['priceAmbiguous', 'status']);

/**
 * Is this fragment pure reaction rather than an instruction (§1)?
 *
 * Two ways to be one. It is made only of stop-words the operator listed, or it
 * carries no letters at all — `:)))))))`, `!!!`, an emoji. The length guard alone
 * could never catch these, because an interjection is short BY NATURE; that is
 * precisely what made the earlier "short fragments only" rule insufficient.
 */
export function isInterjection(text: string, stopWords: readonly string[]): boolean {
  const trimmed = text.trim();
  if (!trimmed) return true;
  // No letter anywhere: emoticons, punctuation, emoji.
  if (!/\p{L}/u.test(trimmed)) return true;

  const tokens = normTokens(trimmed);
  if (tokens.length === 0) return true;
  const stops = new Set<string>();
  for (const w of stopWords) for (const t of normTokens(w)) stops.add(t);
  return tokens.every((t) => stops.has(t));
}

export class InteractionEngine {
  private readonly state = new ConversationState();
  /**
   * What kind of instruction the message currently being handled turned out to
   * be (CCB-S3-009). Held on the instance rather than returned, because
   * threading it out would mean rewriting forty-odd return statements in a
   * consent-carrying dispatch, and a mechanical edit that size is its own risk.
   *
   * Safe because capture is strictly sequential: the handler awaits `handle()`
   * for one chat item before touching the next, and reads this immediately after.
   */
  private handledCategory: MemberCategory | null = null;
  private readonly now: () => number;
  private readonly random: () => number;

  constructor(private readonly deps: InteractionDeps) {
    this.now = deps.now ?? ((): number => Date.now());
    this.random = deps.random ?? Math.random;
  }

  /**
   * Handles one captured group message.
   *
   * Returns true when she treated the message as an instruction. The caller
   * archives it EITHER WAY (CCB-S3-009) and reads {@link lastHandledCategory} to
   * record what kind it was — the boolean no longer means "do not archive".
   *
   * That it ever meant that is the whole of CCB-S3-009. It was right while an
   * instruction meant `/publish`, and wrong from the moment natural addressing
   * made a price question an instruction too: every question a member asked her
   * was discarded, and the public archive showed her answers with nothing above
   * them. A member's question is that member's message; consent decides whether
   * it publishes.
   */
  async handle(msg: CapturedMessage): Promise<boolean> {
    this.handledCategory = null;
    const s = this.deps.settings();
    if (!s.naturalAddressing) return false;
    // Media and files are content, never instructions — a caption that happens
    // to say "publish me" is not a consent decision.
    if (msg.type !== 'text' || msg.file) return false;
    // Command-shaped messages belong to the slash path, and only to it. Without
    // this, a member inside the follow-up window could still trigger `/publish`
    // through the conversational route after the operator had switched slash
    // commands OFF — a toggle that silently only half-applies is worse than no
    // toggle. Addressing her by name (`Cinderella /publish`) is unaffected: such
    // a message does not start with the slash.
    // `/help` is the one exception (CCB-S3-010 §2a): it is not a consent command,
    // it has no slash handler, and a slash is itself an explicit address — so it
    // is answered here rather than swallowed by the guard below. The wake word is
    // not required, exactly as it is not for `/publish`. Matched as its own word
    // so `/helpdesk` is not caught.
    if (/^\/help(?:\s+\S.*)?$/i.test(msg.text.trim())) {
      this.handledCategory = 'help';
      await this.answerHelp(
        msg,
        s,
        this.replyLanguage(msg, s, msg.text, undefined, this.now()),
        msg.text.trim(),
      );
      return true;
    }
    if (msg.text.trimStart().startsWith('/')) return false;

    const now = this.now();
    this.state.prune(now);

    // A FORWARDED message is content someone is sharing, not someone speaking to
    // her (CCB-S3-005 §1). This guard is not cosmetic: a forwarded announcement
    // whose first words are her name and which quotes the commands it documents
    // resolves to PUBLISH at high confidence, which would post a consent
    // confirmation prompt to the whole group. Checked BEFORE addressing, so no
    // other guard has to be right for this one to hold.
    if (msg.forwarded && s.addressing.ignoreForwarded) {
      this.noteNearMiss(msg, s, now, 'forwarded', msg.text, undefined);
      return false;
    }

    const address = detectAddress(msg.text, s);

    // Nicknames (§6): a retort, and nothing else. Never resolved, never acted
    // on, never opens the follow-up window.
    if (address.kind === 'nickname') {
      this.handledCategory = 'nickname';
      return this.handleNickname(msg, s, now);
    }

    const inWindow = this.state.inFollowUp(msg.groupId, msg.senderMemberId, now);

    let instruction: string;
    let explicit: boolean;
    // A STRONG signal means she can be confident she was actually addressed, and
    // is the difference between answering "I did not quite catch that" and
    // staying out of it (§2). A bare name at the start of a message is the weak
    // case — it is how announcements, quotes and third-person talk begin.
    let strong: boolean;

    if (address.kind === 'wake') {
      this.state.resetNicknameStreak(msg.groupId, msg.senderMemberId);
      instruction = address.instruction;
      explicit = true;
      strong = address.greeted && s.addressing.strongSignalGreeting;
    } else if (msg.quotedFromBot) {
      // A direct reply to one of her messages needs no wake word (§1.2).
      instruction = msg.text;
      explicit = true;
      strong = s.addressing.strongSignalReply;
    } else if (inWindow) {
      // Mid-conversation (§2).
      instruction = msg.text;
      explicit = false;
      strong = s.addressing.strongSignalWindow;
    } else {
      // In strict mode a bare leading name is not an address. Log it, so the
      // operator can see what strict mode is costing them rather than guessing.
      if (s.addressing.mode === 'strict' && address.kind === 'none') {
        const relaxed = detectAddress(msg.text, {
          ...s,
          addressing: { ...s.addressing, mode: 'relaxed' },
        });
        if (relaxed.kind === 'wake') {
          this.noteNearMiss(msg, s, now, 'strict-mode-no-greeting', relaxed.instruction, undefined);
        }
      }
      return false;
    }

    // Arriving inside the window is a strong signal in its own right, whichever
    // way she was addressed.
    if (inWindow && s.addressing.strongSignalWindow) strong = true;

    return this.dispatch(msg, s, instruction, explicit, strong, now);
  }

  /**
   * Was this message addressed to her by name or nickname? Side-effect free, so
   * it is safe to ask about a message EDIT (which must not re-run the dialogue
   * but must not be archived either).
   */
  isExplicitAddress(msg: CapturedMessage): boolean {
    const s = this.deps.settings();
    if (!s.naturalAddressing) return false;
    if (msg.type !== 'text' || msg.file) return false;
    return detectAddress(msg.text, s).kind !== 'none';
  }

  /* ── Dispatch ──────────────────────────────────────────────────────────── */

  private async dispatch(
    msg: CapturedMessage,
    s: InteractionSettings,
    instruction: string,
    explicit: boolean,
    strong: boolean,
    now: number,
  ): Promise<boolean> {
    const pending = this.state.getPending(msg.groupId, msg.senderMemberId, now);
    // The language of THIS message, decided before anything is resolved, so the
    // not-understood reply is covered too (§6). It is refined AFTER resolution when
    // a keyword set matched, which is authoritative (CCB-S3-005 Addendum A).
    let lang = this.replyLanguage(msg, s, instruction, pending, now);

    // An outstanding offer is answered before anything else is considered.
    //
    // The acceptance rule comes from the OFFER, not from this site (CCB-S3-013).
    // Putting a destructive offer into the same slot and then checking its kind
    // afterwards would not be enough: the affirmation branch has to be the thing
    // that is conditional, or "yes", "ok", "sure", "klar" would each complete a
    // destruction before any later check ran.
    if (pending) {
      // A decline always cancels, whatever the offer is. Nothing destructive may
      // ever be harder to stop than to start.
      if (this.matchesList(instruction, s.declines)) {
        this.handledCategory = 'confirmation';
        this.state.clearPending(msg.groupId, msg.senderMemberId);
        // Declining the destruction leaves the content hidden, which is where the
        // revocation already put it. Saying so is the honest answer: "cancelled"
        // alone would leave the member unsure what state they are in.
        if (pending.kind === 'deleteConfirm' || pending.kind === 'revokeChoice') {
          return this.chooseHideNow(msg, s, pending);
        }
        await this.reply(msg, s, pending.lang, 'cancelled', {});
        return true;
      }

      if (pending.kind === 'deleteConfirm') {
        // ONLY the literal word. Checked before resolution, so a member writing
        // "delete" cannot have it swallowed by the UNPUBLISH lexicon instead.
        if (this.matchesLiteral(instruction, s.deleteWords)) {
          this.handledCategory = 'confirmation';
          return this.performDelete(msg, s, pending);
        }
        if (this.matchesList(instruction, s.affirmations)) {
          // The failure this whole mechanism exists to prevent. Re-ask rather than
          // act, and keep the offer open so the member can simply write the word.
          this.handledCategory = 'confirmation';
          await this.reply(msg, s, pending.lang, 'deleteNeedsWord', {}, { neverQuote: true });
          return true;
        }
        // Anything else falls through to ordinary handling, so a member is never
        // trapped in the offer. It lapses on its own if they walk away.
      } else if (pending.kind === 'revokeChoice') {
        if (this.matchesLiteral(instruction, s.deleteWords)) {
          this.handledCategory = 'confirmation';
          return this.askDeleteConfirmation(msg, s, pending);
        }
        if (this.matchesList(instruction, s.hideWords)) {
          this.handledCategory = 'confirmation';
          return this.chooseHideNow(msg, s, pending);
        }
        // A bare "yes" names neither option, so it answers nothing. Re-asking is
        // the only safe reading of it: there is no default (§A.1).
        if (this.matchesList(instruction, s.affirmations)) {
          this.handledCategory = 'confirmation';
          await this.reply(msg, s, pending.lang, 'revokeChoice', {}, { neverQuote: true });
          return true;
        }
      } else if (pending.kind === 'restoreConfirm') {
        if (this.matchesList(instruction, s.affirmations)) {
          this.handledCategory = 'confirmation';
          this.state.clearPending(msg.groupId, msg.senderMemberId);
          return this.performRestore(msg, s, pending.lang);
        }
      } else if (this.matchesList(instruction, s.affirmations)) {
        this.handledCategory = 'confirmation';
        return this.performConsentChange(msg, s, pending);
      }
    }

    // Inside the follow-up window she is listening to messages that were never
    // marked for her, so the bar to ACT on one is higher than for a message that
    // says her name. A bare keyword is not enough there — "I'll publish the
    // photos later" is a member talking to the group, and interrupting it with a
    // consent prompt is exactly the unwanted interjection §1 warns against. A
    // multi-word instruction ("publish me") still scores well above this, and
    // affirmations are handled before resolution, so "yes" is unaffected.
    const threshold = explicit
      ? s.confidenceThreshold
      : Math.max(s.confidenceThreshold, IMPLICIT_MIN_CONFIDENCE);

    // A pending "which HEX did you mean?" is answered before anything else is
    // resolved — the reply is a bare "1" or a name, which resolves to nothing.
    const choice = this.state.getPendingChoice(msg.groupId, msg.senderMemberId, now);
    if (choice) {
      this.handledCategory = 'disambiguation';
      if (await this.resolveChoice(msg, s, lang, instruction, choice, now)) return true;
      this.handledCategory = null;
    }

    let result = await resolveIntent(instruction, {
      threshold,
      defaultLanguage: lang,
    });

    // §7c — an elliptical follow-up inside the window inherits the previous
    // READ-ONLY intent: "monero?" after a price answer is a price question. The
    // guard is structural: only PRICE and SEARCH can be inherited, so no
    // fragment can ever become a consent action, however it is phrased.
    let carried = false;
    if (
      result.intent === 'UNKNOWN' &&
      s.intentCarryover &&
      // Applause is not a ticker (§1). Checked before anything is looked up, so
      // an interjection never reaches a provider at all.
      !isInterjection(instruction, s.carryOverStopWords) &&
      // An elliptical follow-up is SHORT — "monero?", "and of monero?". Without
      // this bound, any ordinary sentence inside the window that happened to
      // contain a noun became a price question, which is the same
      // over-eagerness CCB-S3-005 spent a whole briefing removing.
      normTokens(instruction).length <= CARRY_OVER_MAX_TOKENS &&
      this.state.inFollowUp(msg.groupId, msg.senderMemberId, now)
    ) {
      const previous = this.state.rememberedIntent(msg.groupId, msg.senderMemberId, now);
      // PRICE only. A carried SEARCH took the fragment VERBATIM as the query, so
      // "nice one" after a search answer produced "I found 0 moments where this
      // group spoke of nice one" — the same invention this rule exists to stop,
      // with no pin table to check it against. A search query is created
      // content, not reused knowledge, so it cannot satisfy the invariant at all.
      if (previous === 'PRICE') {
        const inherited = carryOverSlots(instruction, previous);
        // THE INVARIANT (§1): carry-over may REUSE knowledge, never CREATE it.
        //
        // An inferred intent must not be able to start a resolution. Live, the
        // fragment `nice :)))))))` inherited PRICE, was sent to a provider as a
        // symbol, and came back as a disambiguation prompt offering "Nice" and
        // "Bury Nice Token" — a lookup invented out of applause, and a pin one
        // keystroke away from being written. So a carried PRICE is allowed only
        // for an asset THIS INSTANCE HAS ALREADY RESOLVED, and it is checked
        // against the pin table, not against the provider.
        if (inherited?.intent === 'PRICE') {
          const base = inherited.slots.base;
          // BOTH sides must already be known. The quote side matters just as
          // much: "btc to the moon" parses as base=btc (pinned, so the gate would
          // pass) with quote=moon, and the quote side is resolved through the
          // full provider chain and PINNED on a dominant candidate — a permanent
          // global mapping written out of a figure of speech.
          const quote = inherited.slots.quote;
          const known =
            base !== undefined &&
            (await this.isPinnedAsset(base)) &&
            (quote === undefined || (await this.isPinnedAsset(quote)));
          if (known) {
            result = { ...inherited, lang };
            carried = true;
          }
        }
      }
    }

    // The LENGTH GUARD (§3). A command is short. Long-form text that merely opens
    // with her name — an announcement, a pasted article — is only acted on when
    // the resolver is very sure, and is otherwise ignored rather than answered.
    if (
      !carried &&
      instruction.length > s.addressing.maxInstructionLength &&
      result.confidence < s.addressing.lengthGuardConfidence
    ) {
      this.noteNearMiss(msg, s, now, 'too-long', instruction, result);
      return false;
    }

    // A real new instruction supersedes an unanswered offer. Anything she did
    // NOT understand leaves the offer standing — a member who says "one moment"
    // mid-confirmation should still be able to say "yes" afterwards.
    if (pending && result.intent !== 'UNKNOWN') {
      this.state.clearPending(msg.groupId, msg.senderMemberId);
    }

    // A message that literally begins with "help"/"hilfe" is a help request
    // (CCB-S3-010 §2a). It has to be forced here because "help consent" and
    // "help prices" otherwise resolve to PRICE — "help" reads as an asset and the
    // two-word shape scores above HELP. Only when she was explicitly addressed,
    // so a follow-up fragment is never hijacked.
    if (explicit && result.intent !== 'HELP' && /^(?:help|hilfe)\b/i.test(instruction.trim())) {
      result = { intent: 'HELP', confidence: 1, slots: {}, lang };
    }

    // CCB-S3-005 Addendum A: a resolved match knows the member's language with
    // CERTAINTY (the keyword set that matched), which is better evidence than the
    // weighted contest on a short message that cannot supply a margin. So answer in
    // it. This runs only where a match exists: UNKNOWN, a language-ambiguous match
    // (a keyword identical in both, so langMatched is false), and fixed mode all
    // keep the contest + default already decided in replyLanguage. The follow-up
    // window is untouched, because a bare `yes`/`ja` is UNKNOWN and carries no
    // langMatched, and a carried-over fragment (§7c) is not a keyword match either.
    if (
      s.replyLanguageMode !== 'fixed' &&
      result.intent !== 'UNKNOWN' &&
      result.langMatched === true &&
      s.persona[result.lang]
    ) {
      lang = result.lang;
      if (s.rememberMemberLanguage) {
        this.state.rememberLanguage(msg.groupId, msg.senderMemberId, lang);
      }
    }

    // ONE place decides what kind of message this was for the archive
    // (CCB-S3-009), keyed off the settled intent so a new intent has to be
    // classified here rather than defaulting into a category by accident.
    this.handledCategory = MEMBER_CATEGORY_FOR_INTENT[result.intent] ?? null;

    // Only READ-ONLY intents are remembered (§7c). Storing a consent intent here
    // is what would make a later bare "yes" dangerous, so it never happens.
    if (result.intent === 'PRICE' || result.intent === 'SEARCH') {
      this.state.rememberIntent(msg.groupId, msg.senderMemberId, result.intent);
    }

    switch (result.intent) {
      case 'PUBLISH':
      case 'UNPUBLISH': {
        const target = result.slots.targetName;
        if (target !== undefined) {
          // §4.2 — refuse, take no action, regardless of who is asking.
          log.info(
            `Interaction: refused a third-party consent request from member ${msg.senderMemberId}.`,
          );
          await this.reply(msg, s, lang, 'refuseThirdParty', { name: target });
          return true;
        }
        const followUpMs = s.followUpSeconds * 1000;
        this.state.setPending(msg.groupId, msg.senderMemberId, {
          kind: 'consent',
          intent: result.intent,
          lang,
          // The offer lives exactly as long as the conversation does.
          expiresAt: now + Math.max(followUpMs, 15_000),
        });
        // §1 — a confirmation prompt may carry a name prefix so the member knows
        // the prompt is theirs, but must never quote them back to the group.
        await this.reply(
          msg,
          s,
          lang,
          result.intent === 'PUBLISH' ? 'publishConfirm' : 'unpublishConfirm',
          {},
          { neverQuote: true },
        );
        return true;
      }

      case 'STATUS': {
        // Kept to one line on purpose (§4.6): there is no private channel to
        // move a personal answer into, so it says as little as it can.
        const counts = await memberArchiveCounts(this.deps.db, msg.senderMemberId);
        await this.reply(msg, s, lang, 'status', {
          total: counts.total,
          public: counts.published,
        });
        return true;
      }

      case 'SEARCH': {
        const query = result.slots.query;
        if (!query) {
          await this.reply(msg, s, lang, 'notUnderstood', {});
          return true;
        }
        const n = await countPublishedMatching(this.deps.db, query);
        await this.reply(msg, s, lang, 'searchResult', { n, query });
        return true;
      }

      case 'HELP':
        await this.answerHelp(msg, s, lang, instruction);
        return true;

      case 'UNDO':
        return this.performUndo(msg, s, lang);

      case 'RESTORE': {
        // RESTORE INCREASES PUBLIC EXPOSURE, so it confirms like PUBLISH rather
        // than acting on one word. The rule resolver reaches it from a single
        // typo-tolerant keyword, and acting immediately would let an ordinary
        // sentence republish a member's whole hidden archive without them ever
        // asking for it. Same handshake, same 'consent' pending kind.
        if (result.slots.targetName !== undefined) {
          await this.reply(msg, s, lang, 'refuseThirdParty', { name: result.slots.targetName });
          return true;
        }
        const followUpMs = s.followUpSeconds * 1000;
        this.state.setPending(msg.groupId, msg.senderMemberId, {
          kind: 'restoreConfirm',
          intent: 'PUBLISH',
          lang,
          expiresAt: now + Math.max(followUpMs, 15_000),
        });
        await this.reply(msg, s, lang, 'restoreConfirm', {}, { neverQuote: true });
        return true;
      }

      case 'PRICE':
        return this.answerPrice(msg, s, lang, result.slots, now, carried);

      case 'UNKNOWN':
      default:
        // Inside the follow-up window an unrecognised message is far more likely
        // to be ordinary conversation than a failed instruction, so she says
        // nothing and lets it be archived like any other message.
        if (!explicit) return false;

        // CCB-S4-028. The order of these two used to be the other way round, and it
        // made relaxed mode mean nothing: `detectAddress` correctly returns `wake` for
        // a bare leading name in relaxed (addressing.ts), but a bare name is WEAK, and
        // the silence guard below ran first and swallowed it. An operator who set
        // "a message starting with her name counts as an address" got silence.
        //
        // What that guard is FOR is written on its own switch: "Stay silent on a weak,
        // not-understood signal". Its §2 rationale is about the canned line, not about
        // answering: "I did not quite catch that" is a bad thing to say to a forwarded
        // announcement that happens to begin with her name. Since CCB-S4-027 a weak
        // address does not produce that line, it produces a conversation, and a real
        // answer to somebody genuinely talking to her is not what the guard was
        // protecting anyone from.
        //
        // So the guard now covers what it names: the FALLBACK. She converses when the
        // model can speak, and stays silent on a weak signal when it cannot, rather
        // than saying a canned sentence to something that may not have been aimed at
        // her. Strict mode is untouched, because a bare name never gets this far.
        if (await this.freeConversation(msg, s, lang)) return true;

        if (s.addressing.silenceOnUnknown && !strong) {
          this.noteNearMiss(msg, s, now, 'weak-signal-unknown', instruction, result);
          return false;
        }
        // The model could not speak and the signal was strong enough to answer anyway.
        await this.reply(msg, s, lang, 'conversationUnavailable', {});
        return true;
    }
  }

  /**
   * Which language to answer in (§6), in order of authority:
   *
   *  1. `fixed` mode — always the configured default.
   *  2. An OPEN confirmation offer — its language wins, so a prompt and its
   *     result can never come back in different languages mid-handshake.
   *  3. Confident detection from THIS message.
   *  4. The language the exchange has been running in (a bare `yes` carries no
   *     signal of its own).
   *  5. The configured default.
   *
   * Only languages with real persona copy are offered: the map is the shipped
   * and operator-edited set, never the machine-translated website locales.
   */
  private replyLanguage(
    msg: CapturedMessage,
    s: InteractionSettings,
    instruction: string,
    pending: PendingConfirmation | undefined,
    now: number,
  ): string {
    const available = (code: string | undefined): string | undefined =>
      code && s.persona[code] ? code : undefined;

    const fallback = available(s.defaultLanguage) ?? 'en';
    if (s.replyLanguageMode === 'fixed') return fallback;
    if (pending) return available(pending.lang) ?? fallback;

    // Detect from the member's own words, not from which keyword set matched —
    // that is what left an English message answered in German.
    const guess = detectLanguage(instruction || msg.text, fallback);
    if (guess.confident) {
      const lang = available(guess.lang) ?? fallback;
      if (s.rememberMemberLanguage) {
        this.state.rememberLanguage(msg.groupId, msg.senderMemberId, lang);
      }
      return lang;
    }

    if (s.rememberMemberLanguage) {
      const remembered = available(
        this.state.rememberedLanguage(msg.groupId, msg.senderMemberId, now),
      );
      if (remembered) return remembered;
    }
    return fallback;
  }

  /** Records an ignored candidate so the guards are visible, not invisible (§5). */
  private noteNearMiss(
    msg: CapturedMessage,
    s: InteractionSettings,
    now: number,
    reason: NearMissReason,
    text: string,
    result: { intent: string; confidence: number } | undefined,
  ): void {
    log.debug(
      `Interaction: ignored a message from ${msg.senderMemberId} (${reason})` +
        `${result ? ` — ${result.intent} @ ${result.confidence.toFixed(2)}` : ''}.`,
    );
    if (!s.addressing.logNearMisses) return;
    const entry: NearMiss = {
      at: now,
      groupId: msg.groupId,
      who: msg.senderDisplayName,
      reason,
      excerpt: text.replace(/\s+/g, ' ').trim().slice(0, NEAR_MISS_EXCERPT),
      intent: result?.intent,
      confidence: result?.confidence,
    };
    recordNearMiss(entry);
  }

  /**
   * Records that SOMETHING replied to this member, refreshing their follow-up
   * window (CCB-S3-006 §7c). The engine's own replies do this inside sendReply;
   * this is for the slash-command path, which sends through the shared transport
   * without going through the engine at all. Without it, a member who used
   * `/publish` had no window and their next message was ignored.
   */
  noteExternalReply(groupId: number, memberId: string): void {
    const s = this.deps.settings();
    this.state.openFollowUp(groupId, memberId, this.now(), s.followUpSeconds * 1000);
  }

  /**
   * Has this instance already resolved this symbol? The check is against the pin
   * table, deliberately NOT against a provider: asking a provider would be the
   * very resolution that carry-over is not allowed to start.
   */
  private async isPinnedAsset(symbol: string): Promise<boolean> {
    const prices = this.deps.prices;
    if (!prices) return false;
    try {
      // Called through the service so `this` stays bound to it.
      return await prices.isPinned(symbol);
    } catch (err) {
      log.debug(
        `Price: could not check whether "${symbol}" is pinned (${
          err instanceof Error ? err.message : String(err)
        }); treating it as unknown.`,
      );
      return false;
    }
  }

  /** Test hook: seed the remembered intent that drives carry-over (§7c). */
  rememberIntentForTest(groupId: number, memberId: string, intent: 'PRICE' | 'SEARCH'): void {
    this.state.rememberIntent(groupId, memberId, intent);
  }

  /**
   * The category of the message just handled (CCB-S3-009). Read by the capture
   * path immediately after `handle()` returns.
   */
  lastHandledCategory(): MemberCategory | null {
    return this.handledCategory;
  }

  /** Recent ignored candidates, for the admin console. */
  nearMisses(limit?: number): NearMiss[] {
    return recentNearMisses(limit);
  }

  /**
   * Answers a price question (CCB-S3-004). Read-only: no confirmation, no
   * consent involvement, nothing journalled — it is a lookup, and the only state
   * it touches is a cache, a rate-limit counter, and the pinned mapping table.
   */
  private async answerPrice(
    msg: CapturedMessage,
    s: InteractionSettings,
    lang: string,
    slots: { base?: string; quote?: string; amount?: number; baseAlternates?: string[] },
    now: number,
    /**
     * True when this question was INFERRED from the previous turn rather than
     * asked. Such a lookup may answer, but it may never ask a question of its
     * own — see the ambiguity branch (§1).
     */
    carried = false,
  ): Promise<boolean> {
    const prices = this.deps.prices;
    const cfg = this.deps.priceSettings?.();
    const base = slots.base;
    if (!prices || !cfg) {
      // The plugin is off or unconfigured. PRICE should not even be in the
      // active catalog in that case, so this is the second line of defence.
      await this.reply(msg, s, lang, 'priceUnavailable', {});
      return true;
    }
    if (!base) {
      await this.reply(msg, s, lang, 'notUnderstood', {});
      return true;
    }

    // A price question costs an outbound call to a throttled third party, so it
    // has its own budget on top of the reply limit.
    if (
      !this.state.allowPrice(
        msg.groupId,
        msg.senderMemberId,
        now,
        cfg.rateLimitPerMember,
        cfg.rateLimitPerChat,
      )
    ) {
      log.debug(`Price: rate limit hit for member ${msg.senderMemberId}; staying silent.`);
      return true;
    }

    // Alternates let the service prefer an already-pinned asset word (§3).
    const outcome = await prices.price(
      base,
      slots.quote,
      slots.amount ?? 1,
      '*',
      slots.baseAlternates,
    );

    // A carried-over question was INFERRED, not asked. It may answer, and it may
    // stay silent. Anything else — "I do not know that one", "which did you
    // mean?", "the markets are quiet" — is her interrupting a conversation on the
    // strength of a guess, which is the whole complaint behind §1. Only a real
    // answer survives this gate.
    if (carried && outcome.kind !== 'price' && outcome.kind !== 'conversion') {
      log.debug(
        `Price: carried-over lookup ended as "${outcome.kind}"; staying silent rather than interrupting.`,
      );
      return false;
    }

    switch (outcome.kind) {
      case 'unknown-asset':
        await this.reply(msg, s, lang, 'priceUnknownAsset', { symbol: outcome.symbol });
        return true;

      case 'ambiguous': {
        // A carried-over fragment never earns a question (§1). The member did not
        // ask about this word; inferring a question from it is how `nice` became
        // a disambiguation prompt in the live group.
        if (carried) {
          log.debug(
            `Price: carried-over "${outcome.symbol}" is ambiguous; staying silent rather than asking.`,
          );
          return false;
        }
        // Ask, never choose — and remember the options so the member's answer
        // can be pinned globally and nobody is asked again (§1).
        const options = outcome.options.slice(0, 5);
        this.state.setPendingChoice(msg.groupId, msg.senderMemberId, {
          symbol: outcome.symbol,
          options: options.map((o) => ({
            id: o.id,
            symbol: o.symbol,
            name: o.name,
            ...(o.chain ? { chain: o.chain } : {}),
            ...(o.contract ? { contract: o.contract } : {}),
            provider: outcome.provider,
          })),
          expiresAt: now + Math.max(s.followUpSeconds * 1000, 60_000),
        });
        // One candidate per line, numbered, with the figure that actually tells
        // a real asset from a clone (§6). A comma-separated run was unreadable.
        await this.reply(msg, s, lang, 'priceAmbiguous', {
          symbol: outcome.symbol,
          options: options
            .map((o, i) => {
              const parts = [`*${i + 1}*`, o.name];
              if (o.chain) parts.push(`_${o.chain}_`);
              const metric = candidateMetric(o);
              if (metric) parts.push(metric);
              return parts.join(' · ');
            })
            .join('\n'),
        });
        return true;
      }

      case 'unavailable':
        // Honest failure, and now a SPECIFIC one (§3). Being throttled is
        // temporary and the member can act on it; anything else is the operator's
        // to fix and must not be dressed up as a quiet market.
        await this.reply(
          msg,
          s,
          lang,
          outcome.reason === 'throttled' ? 'priceThrottled' : 'priceUnavailable',
          {},
        );
        return true;

      default: {
        const quoteDecimals = 'decimals' in outcome.quote ? outcome.quote.decimals : 8;
        // Attribution and disclaimer each get their own line (§6); the credit
        // names the provider that actually answered, never a fixed string.
        const suffix = [
          outcome.attribution ? `🔗 ${outcome.attribution}` : '',
          cfg.disclaimer ? `⚠️ ${cfg.disclaimer}` : '',
        ]
          .filter((x) => x)
          .join('\n');
        // Secondary facts: where it trades, and how old the figure is.
        const detail = [
          outcome.kind === 'conversion'
            ? `via _${s.defaultLanguage === 'de' ? 'USD' : 'USD'}_ cross rate`
            : '',
          'chain' in outcome.base && outcome.base.chain ? `_${outcome.base.chain}_` : '',
          describeAge(outcome.at, now, lang),
        ]
          .filter((x) => x)
          .join(' · ');
        await this.reply(
          msg,
          s,
          lang,
          outcome.kind === 'conversion' ? 'conversion' : 'price',
          {
            amount: formatAmount(outcome.amount),
            base: outcome.base.symbol,
            quote: outcome.quote.symbol,
            value: formatValue(outcome.value, quoteDecimals),
            detail,
          },
          { suffix },
        );
        return true;
      }
    }
  }

  /**
   * Handles a member picking one of the assets she offered. The answer is pinned
   * GLOBALLY, so the question is asked once per symbol for the whole instance
   * rather than once per member (§1).
   */
  private async resolveChoice(
    msg: CapturedMessage,
    s: InteractionSettings,
    lang: string,
    instruction: string,
    choice: PendingChoice,
    now: number,
  ): Promise<boolean> {
    const picked = matchChoice(instruction, choice);
    if (!picked) return false;

    this.state.clearPendingChoice(msg.groupId, msg.senderMemberId);
    const prices = this.deps.prices;
    if (!prices) return false;
    try {
      await prices.pin(choice.symbol, picked, picked.provider, 'member-choice');
      log.info(`Price: "${choice.symbol}" pinned to ${picked.name} by a member's choice.`);
    } catch (err) {
      log.error(
        `Price: could not pin "${choice.symbol}": ${err instanceof Error ? err.message : String(err)}`,
      );
      await this.reply(msg, s, lang, 'priceUnavailable', {});
      return true;
    }
    // Answer the original question now that the ambiguity is settled.
    return this.answerPrice(msg, s, lang, { base: choice.symbol }, now);
  }

  /**
   * The help reply (CCB-S3-010 Part 2). Generated from the ACTIVE intent catalog
   * so it lists only what is enabled, plus optional `help <topic>` detail. It is
   * built rather than templated, so it cannot go through {@link reply}'s persona
   * lookup — {@link replyBody} sends the finished text with the `help` category.
   */
  private async answerHelp(
    msg: CapturedMessage,
    s: InteractionSettings,
    lang: string,
    instruction?: string,
  ): Promise<void> {
    const helpLang: HelpLang = lang === 'de' ? 'de' : 'en';
    const topic = instruction ? parseHelpTopic(instruction) : null;
    const body = topic
      ? buildHelpTopic(topic, s.wakeWord, helpLang)
      : buildHelpReply({
          // The one editable help text (CCB-S3-021 §3): her persona `help` field,
          // which the machine fills. Blank falls back to the shipped default.
          template: s.persona[helpLang]?.help ?? '',
          intents: activeIntentList(),
          wake: s.wakeWord,
          lang: helpLang,
          links: [s.archiveUrl, s.projectUrl].filter((u) => u),
          label: s.botLabel,
        });
    await this.replyBody(msg, s, lang, body);
  }

  /**
   * Sends an ALREADY-BUILT body (no persona lookup), archived as `help`. Mirrors
   * {@link reply}'s send, minus the templating, for replies assembled in code.
   */
  private async replyBody(
    msg: CapturedMessage,
    s: InteractionSettings,
    lang: string,
    body: string,
  ): Promise<void> {
    const personalized = await this.personalizedBody(msg, lang, 'help', body, 'locked');
    const out = formatOutbound(personalized, {
      mode: s.replyMode,
      prefixTemplate: this.prefixTemplate(s, lang),
      displayName: msg.senderDisplayName,
      allowQuote: true,
    });
    const mentions: ReplyMention[] = out.prefixName
      ? [{ displayName: out.prefixName, memberId: msg.senderMemberId }]
      : [];
    await this.sendReply(
      msg,
      s,
      out,
      {},
      {
        category: 'help',
        lang,
        mentions,
        replyTo: { groupId: msg.groupId, itemId: msg.itemId },
      },
    );
  }

  /* ── Actions ───────────────────────────────────────────────────────────── */

  private async performConsentChange(
    msg: CapturedMessage,
    s: InteractionSettings,
    pending: PendingConfirmation,
  ): Promise<boolean> {
    const action = pending.intent === 'PUBLISH' ? 'opt_in' : 'opt_out';
    try {
      await applyConsentChange(this.deps.db, {
        memberId: msg.senderMemberId,
        at: msg.sentAt,
        action,
        source: 'natural',
      });
    } catch (err) {
      // Never let a consent decision fail quietly — it is the product's legal
      // backbone. The offer stays open so the member can simply say yes again.
      const message = err instanceof Error ? err.message : String(err);
      log.error(`Interaction: ${action} failed for member ${msg.senderMemberId}: ${message}`);
      status.error(`Consent (natural language) ${action} failed: ${message}`);
      await this.reply(msg, s, pending.lang, 'notUnderstood', {});
      return true;
    }

    this.state.clearPending(msg.groupId, msg.senderMemberId);
    log.info(
      `Interaction: ${action} recorded for member ${msg.senderMemberId} via natural language.`,
    );

    // A revocation does not end here any more (CCB-S3-013). The outcome is
    // confirmed first, exactly as before, and THEN the choice is asked: the
    // content is already hidden by derivation, and what remains is whether it is
    // kept or destroyed. Keeping the two as separate messages keeps the
    // `unpublished` string a live, editable piece of copy rather than turning it
    // into a field the operator can edit and never see (the CCB-S3-021 lesson).
    await this.reply(
      msg,
      s,
      pending.lang,
      action === 'opt_in' ? 'published' : 'unpublished',
      {},
      { bypassLimit: true },
    );
    if (action === 'opt_out') return this.askRevokeChoice(msg, s, pending.lang);
    return true;
  }

  /**
   * Asks hide or delete, and opens the offer that will accept the answer.
   *
   * Called after any revocation, on both the natural-language and slash paths, so
   * the two cannot drift about what a revocation means. Safe to reach twice: the
   * question is idempotent and the underlying state is already 'pending'.
   */
  async askRevokeChoice(msg: CapturedMessage, s: InteractionSettings, lang: string): Promise<boolean> {
    const followUpMs = s.followUpSeconds * 1000;
    this.state.setPending(msg.groupId, msg.senderMemberId, {
      kind: 'revokeChoice',
      intent: 'UNPUBLISH',
      lang,
      expiresAt: Date.now() + Math.max(followUpMs, 15_000),
    });
    // bypassLimit, because a dropped prompt here would leave the member believing
    // they had answered a question they never saw.
    await this.reply(msg, s, lang, 'revokeChoice', {}, { neverQuote: true, bypassLimit: true });
    return true;
  }

  /**
   * The revocation choice, asked after a `/unpublish` (CCB-S3-013).
   *
   * The slash path stays IMMEDIATE, as CCB-S3-002 §4.1 requires: the opt-out is
   * already applied and the content is already hidden by the time this runs. What
   * it adds is the question about what happens next, so `/unpublish` and
   * "Cinderella, unpublish me" mean the same thing. Without it the two paths would
   * disagree about what a revocation is, which is exactly the drift the shared
   * write path exists to prevent.
   */
  async askRevokeChoiceAfterSlash(msg: CapturedMessage): Promise<void> {
    const s = this.deps.settings();
    const remembered = this.state.rememberedLanguage(msg.groupId, msg.senderMemberId, this.now());
    const lang = remembered ?? s.defaultLanguage;
    await this.askRevokeChoice(msg, s, lang);
  }

  /**
   * Brings back content the member chose to HIDE (CCB-S3-013).
   *
   * Restoring is available only after a hide, never after a delete, and only to
   * the member themselves. All three are structural rather than checked here:
   * `restoreHidden` matches only a row whose mode is 'hide', and the member id
   * comes from the sender of this message, so there is no shape of this call that
   * restores somebody else's archive or resurrects destroyed content.
   *
   * It deliberately does NOT go through the undo path. Undo may only ever reduce
   * exposure; this increases it, which is legitimate precisely because it is the
   * member's own first-person request rather than the reversal of one.
   */
  private async performRestore(
    msg: CapturedMessage,
    s: InteractionSettings,
    lang: string,
  ): Promise<boolean> {
    let restored = false;
    try {
      const result = await restoreHiddenContent(this.deps.db, {
        memberId: msg.senderMemberId,
        at: msg.sentAt,
        source: 'natural',
      });
      restored = result.restored;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      log.error(`Interaction: restore failed for member ${msg.senderMemberId}: ${message}`);
      status.error(`Consent (natural language) restore failed: ${message}`);
      await this.reply(msg, s, lang, 'notUnderstood', {});
      return true;
    }

    if (restored) {
      log.info(`Interaction: restore recorded for member ${msg.senderMemberId}.`);
      await this.reply(msg, s, lang, 'restored', {}, { bypassLimit: true });
      return true;
    }

    // Nothing matched. Either they never hid anything, or they destroyed it. The
    // second reading is the one worth saying out loud, because a member who asks
    // for words back after a deletion needs to be told plainly that they are gone.
    const consent = await getConsent(this.deps.db, msg.senderMemberId);
    const key = consent?.revocationMode === 'delete' ? 'restoreNotDeleted' : 'undoNothing';
    await this.reply(msg, s, lang, key, { wake: s.wakeWord }, { bypassLimit: true });
    return true;
  }

  /** Records HIDE and says so. Also the landing point for declining a destruction. */
  private async chooseHideNow(
    msg: CapturedMessage,
    s: InteractionSettings,
    pending: PendingConfirmation,
  ): Promise<boolean> {
    this.state.clearPending(msg.groupId, msg.senderMemberId);
    let outcome;
    try {
      // The result is deliberately not branched on. `recorded: false` means the
      // choice was already settled as hide, which is the state this reply
      // describes, and `chooseHide` cancels any pending destruction either way.
      // A THROW is the only outcome that makes the reply untrue, and that is
      // handled below.
      outcome = await chooseHide(this.deps.db, {
        memberId: msg.senderMemberId,
        at: msg.sentAt,
        source: 'natural',
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      log.error(`Interaction: recording hide for member ${msg.senderMemberId} failed: ${message}`);
      status.error(`Consent (natural language) hide failed: ${message}`);
      // The content is hidden either way: the revocation did that. Only the
      // record of the CHOICE failed, so she must not claim it succeeded.
      await this.reply(msg, s, pending.lang, 'notUnderstood', {});
      return true;
    }
    // The reply follows the member's ACTUAL state, not the happy path (CCB-S3-031).
    // `hidden` promises retention and restorability, and sending it to somebody
    // whose content was already destroyed, or who was never revoked at all, told
    // them something false at the moment they were deciding about their own words.
    // The reply follows what the member ACTUALLY has, not the happy path
    // (CCB-S3-031). `hidden` promises retention and restorability; sending it to
    // somebody whose content was already destroyed, or who was never revoked at
    // all, told them something false at the moment they were deciding about their
    // own words.
    const hideKey =
      outcome.refusal === 'not-revoked'
        ? 'choiceNotRevoked'
        : outcome.remaining === 0
          ? 'alreadyDestroyed'
          : !outcome.recorded
            ? 'alreadyHidden'
            : 'hidden';
    await this.reply(msg, s, pending.lang, hideKey, { wake: s.wakeWord }, { bypassLimit: true });
    return true;
  }

  /** Moves to the destructive confirmation, which only the literal word answers. */
  private async askDeleteConfirmation(
    msg: CapturedMessage,
    s: InteractionSettings,
    pending: PendingConfirmation,
  ): Promise<boolean> {
    const followUpMs = s.followUpSeconds * 1000;
    this.state.setPending(msg.groupId, msg.senderMemberId, {
      kind: 'deleteConfirm',
      intent: 'UNPUBLISH',
      lang: pending.lang,
      expiresAt: Date.now() + Math.max(followUpMs, 15_000),
    });
    await this.reply(
      msg,
      s,
      pending.lang,
      'deleteConfirm',
      {},
      { neverQuote: true, bypassLimit: true },
    );
    return true;
  }

  /**
   * Carries out the destruction the member just confirmed with the literal word.
   *
   * Tells them honestly when part of it is deferred by an evidence hold: silently
   * not deleting is worse than openly deferring, and the deferral message reveals
   * nothing about who reported the item or what the report said.
   */
  private async performDelete(
    msg: CapturedMessage,
    s: InteractionSettings,
    pending: PendingConfirmation,
  ): Promise<boolean> {
    this.state.clearPending(msg.groupId, msg.senderMemberId);
    let outcome;
    try {
      outcome = await chooseDelete(
        this.deps.db,
        { memberId: msg.senderMemberId, at: msg.sentAt, source: 'natural' },
        this.deps.mediaRoot ?? loadConfig().mediaRoot,
        this.deps.runTx,
        // Was omitted, so a quarantined original survived the member's own
        // deletion while the admin path swept it (CCB-S3-031).
        loadConfig().quarantineRoot,
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      log.error(`Interaction: delete for member ${msg.senderMemberId} failed: ${message}`);
      status.error(`Consent (natural language) delete failed: ${message}`);
      await this.reply(msg, s, pending.lang, 'notUnderstood', {});
      return true;
    }

    log.info(
      `Interaction: delete recorded for member ${msg.senderMemberId} via natural language ` +
        `(${outcome.destroyed} destroyed, ${outcome.deferred} deferred, ${outcome.failed} failed).`,
    );

    // A failure is counted with the deferrals for the member's benefit: in both
    // cases the honest statement is "not yet gone, and I will keep at it". The
    // operator sees the difference through status.error and the log.
    if (outcome.failed > 0) {
      status.error(
        `A member asked for their content to be destroyed and ${outcome.failed} message(s) could ` +
          `not be destroyed. They are hidden and the deletion will be retried.`,
      );
    }
    // THE DEFECT THIS REPLACES (CCB-S3-031): the key was chosen from destruction
    // COUNTS alone, so a member whose choice was already settled as HIDE - for whom
    // nothing is destroyed and nothing is pending, by design - fell through to
    // `deleteNothing` and was told "there is nothing of yours left in my archive to
    // destroy" over an archive being deliberately kept for them. The member's state
    // is the question; the counts only describe how far a real deletion got.
    if (!outcome.recorded) {
      const refusedKey =
        outcome.refusal === 'not-revoked' ? 'choiceNotRevoked' : 'alreadyDestroyed';
      await this.reply(msg, s, pending.lang, refusedKey, { wake: s.wakeWord }, { bypassLimit: true });
      return true;
    }
    // A hold and a failure are NOT the same thing to say. A hold may be permanent
    // (a screening match or an operator escalation never expires), so promising
    // "deleted as soon as the check is done" was an unkeepable promise; and a
    // failure has no report behind it, so mentioning one invented a report that
    // does not exist.
    const key =
      outcome.deferred > 0
        ? 'deleteDeferred'
        : outcome.failed > 0
          ? 'deleteRetrying'
          : outcome.destroyed > 0
            ? 'deleted'
            : 'deleteNothing';
    await this.reply(
      msg,
      s,
      pending.lang,
      key,
      {
        n: String(outcome.destroyed),
        held: String(outcome.deferred > 0 ? outcome.deferred : outcome.failed),
        wake: s.wakeWord,
      },
      { bypassLimit: true },
    );
    return true;
  }

  private async performUndo(
    msg: CapturedMessage,
    s: InteractionSettings,
    lang: string,
  ): Promise<boolean> {
    const notBefore =
      s.undoWindowSeconds > 0
        ? new Date(new Date(msg.sentAt).getTime() - s.undoWindowSeconds * 1000).toISOString()
        : null;

    // A revocation is not undoable (CCB-S3-010 Addendum A). She says so rather
    // than silently doing nothing — "nothing happened" and "that is the one thing
    // I will not do" are very different things to a member who just changed their
    // mind about something irreversible.
    try {
      const pending = await lastUndoableAction(this.deps.db, msg.senderMemberId, notBefore);
      if (pending && !undoReducesExposure(pending.action)) {
        await this.reply(msg, s, lang, 'undoNotRevocation', {}, { bypassLimit: true });
        return true;
      }
    } catch {
      // Fall through to the ordinary path; it cannot republish anything either.
    }

    let undone = null;
    try {
      // Scoped to the sender's own member id — there is no shape of this call
      // that reaches somebody else's decision (§4.4).
      undone = await undoLastConsentAction(this.deps.db, msg.senderMemberId, msg.sentAt, notBefore);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      log.error(`Interaction: undo failed for member ${msg.senderMemberId}: ${message}`);
      status.error(`Consent undo failed: ${message}`);
      await this.reply(msg, s, lang, 'undoNothing', {});
      return true;
    }

    if (undone) {
      log.info(
        `Interaction: undid ${undone.action} for member ${msg.senderMemberId} (action ${undone.id}).`,
      );
    }
    await this.reply(
      msg,
      s,
      lang,
      undone ? 'undo' : 'undoNothing',
      {},
      {
        bypassLimit: undone !== null,
      },
    );
    return true;
  }

  private async handleNickname(
    msg: CapturedMessage,
    s: InteractionSettings,
    now: number,
  ): Promise<boolean> {
    // The instruction is DISCARDED, not resolved (§6). Nothing below reads it.
    const allowed = this.state.noteNickname(
      msg.groupId,
      msg.senderMemberId,
      now,
      s.nicknames.spamLimit,
    );
    if (!allowed) {
      log.debug(
        `Interaction: nickname anti-spam limit reached for member ${msg.senderMemberId}; staying silent.`,
      );
      return true;
    }

    const lang = this.replyLanguage(msg, s, msg.text, undefined, now);
    const list = this.retorts(s, lang);
    const index = this.state.pickRetort(msg.groupId, list.length, this.random);
    const retort = index >= 0 ? list[index] : undefined;
    if (retort) {
      // Retorts name her, and her name is whatever the operator configured. They
      // never went through placeholder substitution, so a renamed bot insisted on
      // a name that was not its own (CCB-S3-031 follow-up).
      const named = retort.split('{wake}').join(s.wakeWord);
      // CCB-S4-031 gap 1. This was `free` mode, which carries no personality, so the
      // most-seen line she says arrived in the generic voice while everything else was
      // dialled. `retort` keeps the operator's retort as the CONTENT and puts her voice
      // on it: at sharpness 10 it cuts, at 1 it is gentle, and the ceiling comes along.
      const personalized = await this.personalizedBody(msg, lang, 'nickname', named, 'retort', [], {
        personality: this.deps.personality?.() ?? null,
        identity: botIdentity(s),
      });
      // A retort is a snub, not an address: no name prefix (that would read as
      // her talking TO the member, contradicting "never opens a conversation")
      // and no quote.
      await this.sendReply(
        msg,
        s,
        { text: personalized, quote: false },
        { openWindow: false },
        // A retort names nobody — the instruction was discarded, not read, and a
        // retort carries no name prefix (that would read as her talking TO them).
        {
          category: 'nickname',
          lang,
          mentions: [],
          replyTo: { groupId: msg.groupId, itemId: msg.itemId },
        },
      );
    }
    return true;
  }

  /* ── Replies ───────────────────────────────────────────────────────────── */

  private persona(s: InteractionSettings, lang: string, key: PersonaKey): string {
    const strings =
      s.persona[lang] ??
      s.persona[s.defaultLanguage] ??
      s.persona['en'] ??
      DEFAULT_INTERACTION.persona['en'];
    return strings?.[key] ?? (DEFAULT_INTERACTION.persona['en'] as Record<PersonaKey, string>)[key];
  }

  private retorts(s: InteractionSettings, lang: string): string[] {
    return (
      s.retorts[lang] ??
      s.retorts[s.defaultLanguage] ??
      s.retorts['en'] ??
      (DEFAULT_INTERACTION.retorts['en'] as string[])
    );
  }

  /** The prefix template for a language, or null when prefixing is switched off. */
  private prefixTemplate(s: InteractionSettings, lang: string): string | null {
    if (!s.namePrefix.enabled) return null;
    const t = s.namePrefix.templates;
    return t[lang] ?? t[s.defaultLanguage] ?? t['en'] ?? null;
  }

  /**
   * Asks local AI to phrase a deterministic draft around the member's actual
   * message. The caller always receives usable text: no runtime, rules mode,
   * network failure, malformed output, or lost required fact can escape this
   * method as a broken reply.
   */
  private async personalizedBody(
    msg: CapturedMessage,
    lang: string,
    kind: AiReplyRequest['kind'],
    deterministicDraft: string,
    mode: AiReplyMode,
    requiredLiterals: string[] = [],
    /**
     * Her voice and her identity. Supplied ONLY by the retort path (CCB-S4-031): the
     * command rewrites that share this method must stay in the plain voice, because
     * D-133 keeps the personality out of anything that rephrases a decision.
     */
    dialled?: { personality: BotPersonality | null; identity: BotIdentity },
  ): Promise<string> {
    const personalize = this.deps.personalize;
    if (!personalize) return deterministicDraft;

    try {
      const personalized = await personalize({
        kind,
        lang,
        memberMessage: msg.text,
        deterministicDraft,
        mode,
        requiredLiterals,
        blockedLiterals: [msg.senderDisplayName],
        ...(dialled ? { personality: dialled.personality, identity: dialled.identity } : {}),
      });
      return personalized?.trim() || deterministicDraft;
    } catch (error) {
      log.debug(
        `Interaction: reply personalization failed (${error instanceof Error ? error.message : String(error)}).`,
      );
      return deterministicDraft;
    }
  }

  /**
   * Talk back when there was nothing to do (CCB-S4-027, D-131).
   *
   * ── WHAT IS DIFFERENT ABOUT THIS ONE ────────────────────────────────────────
   *
   * Every other model call in this engine rephrases a decision the application has
   * already made, with the deterministic draft as both the instruction and the
   * fallback. Here there is no decision and no draft: the model writes original words.
   * That is a real boundary and it is why the reply lane gets a named `conversation`
   * mode rather than an empty draft in `free` mode, which would have asked the model to
   * rewrite nothing and let it invent the nothing.
   *
   * What does NOT change: the model still cannot act. It has produced a sentence, and a
   * sentence is all that leaves this method. Consent, commands and every intent in the
   * catalog were considered before this branch was reached.
   */
  private async freeConversation(
    msg: CapturedMessage,
    s: InteractionSettings,
    lang: string,
  ): Promise<boolean> {
    const personalize = this.deps.personalize;
    let spoken: string | null = null;
    // Wall clock around the model call, for Diagnostics (CCB-S4-031 gap 5). Measured
    // whatever the outcome: a slow failure is the fact an operator most wants to see.
    const startedAt = this.now();

    if (personalize) {
      try {
        spoken =
          (
            await personalize({
              kind: 'conversation',
              lang,
              memberMessage: msg.text,
              // No draft, deliberately. See the note above.
              deterministicDraft: '',
              mode: 'conversation',
              requiredLiterals: [],
              // The same guard as every other reply: her words never carry the
              // sender's display name, because the prefix is what names them.
              blockedLiterals: [msg.senderDisplayName],
              // The dials (CCB-S4-029). Read here rather than held, so an operator who
              // saves the Personality page and immediately talks to her hears the change
              // on this reply and not on the next boot.
              personality: this.deps.personality?.() ?? null,
              // Who she is (CCB-S4-030, widened in CCB-S4-031). The wake word is the
              // authoritative name: it is what a member must type to reach her, and it is
              // already what the persona copy substitutes for `{wake}`. Without it the
              // model was told everything about her voice and nothing about her identity,
              // and denied the name.
              identity: botIdentity(s),
            })
          )?.trim() || null;
      } catch (error) {
        log.debug(
          `Interaction: free conversation failed (${
            error instanceof Error ? error.message : String(error)
          }).`,
        );
      }
    }

    // The caller decides what to do with a silence, because only it knows how strong
    // the address signal was. NOT `notUnderstood` either way: she heard perfectly well,
    // and telling a member they were unclear when they were not is the kind of small
    // untruth this project does not tell.
    if (spoken === null) {
      recordConversation({
        at: this.now(),
        groupId: msg.groupId,
        outcome: 'unavailable',
        latencyMs: this.now() - startedAt,
      });
      return false;
    }

    const sent = await this.replyWithText(msg, s, lang, spoken, 'conversation');
    // 'rate-limited' is a separate outcome rather than a missing row, because a dropped
    // reply and a reply that never happened look identical from the group and the
    // operator has to be able to tell them apart. It is the one thing this log records
    // that no existing telemetry could: the AI operations buffer sees a successful model
    // call either way, since the throttle happens after it.
    recordConversation({
      at: this.now(),
      groupId: msg.groupId,
      outcome: sent ? 'spoken' : 'rate-limited',
      latencyMs: this.now() - startedAt,
    });
    return true;
  }

  /**
   * Send text the application did not compose from a persona template.
   *
   * The tail of {@link reply} exactly: the same outbound formatting, the same name
   * prefix and mention bookkeeping, the same rate limit, the same follow-up window.
   * Only the body differs, which is the whole point of having it separate.
   */
  private async replyWithText(
    msg: CapturedMessage,
    s: InteractionSettings,
    lang: string,
    text: string,
    category: ReplyCategory,
    /** Whether it left. Threaded out for the free-conversation diagnostics. */
  ): Promise<boolean> {
    const out = formatOutbound(text, {
      mode: s.replyMode,
      prefixTemplate: this.prefixTemplate(s, lang),
      displayName: msg.senderDisplayName,
      allowQuote: true,
    });

    const mentions: ReplyMention[] = [];
    if (out.prefixName) {
      mentions.push({ displayName: out.prefixName, memberId: msg.senderMemberId });
    }

    return this.sendReply(
      msg,
      s,
      out,
      {},
      {
        category,
        lang,
        mentions,
        replyTo: { groupId: msg.groupId, itemId: msg.itemId },
      },
    );
  }

  private async reply(
    msg: CapturedMessage,
    s: InteractionSettings,
    lang: string,
    key: PersonaKey,
    vars: Record<string, string | number>,
    opts: ReplyOptions = {},
  ): Promise<void> {
    // The body's own placeholders are filled FIRST and separately from the name
    // prefix — see the {name} footgun note in reply.ts. Formatting deliberately
    // happens here rather than inside sendReply's try/catch, so a broken prefix
    // template fails loudly instead of being swallowed as a failed send.
    const suffix = opts.suffix?.trim();
    const deterministicDraft = fillPersona(this.persona(s, lang, key), vars);
    let core = deterministicDraft;

    if (AI_PERSONALIZED_KEYS.has(key)) {
      const mode: AiReplyMode = AI_LOCKED_KEYS.has(key) ? 'locked' : 'free';
      const requiredLiterals =
        mode === 'free'
          ? [
              ...new Set(
                Object.values(vars)
                  .map(String)
                  .map((value) => value.trim())
                  .filter(Boolean),
              ),
            ]
          : [];
      core = await this.personalizedBody(
        msg,
        lang,
        key,
        deterministicDraft,
        mode,
        requiredLiterals,
      );
    }

    const body = suffix ? `${core}\n${suffix}` : core;
    const out = formatOutbound(body, {
      mode: s.replyMode,
      prefixTemplate: this.prefixTemplate(s, lang),
      displayName: msg.senderDisplayName,
      allowQuote: opts.neverQuote !== true,
    });

    // Which member names this reply carries into the archive (CCB-S3-007 §2).
    // Only two things put one there: the mention prefix, which names the sender,
    // and a third-party refusal, which names whoever the instruction pointed at.
    // They are collected here, at the one place that knows both, and never
    // inferred from the finished text.
    const mentions: ReplyMention[] = [];
    if (key === 'refuseThirdParty' && typeof vars['name'] === 'string') {
      // Typed by the sender about somebody else, so the id is NOT known here and
      // is looked up later — an ambiguous or unknown name stays unpublishable.
      mentions.push({ displayName: vars['name'] });
    }
    // The prefix names the sender, whose id we already hold. Passing it avoids a
    // display-name lookup that would come back empty for two members sharing a
    // name, and redact somebody who had actually opted in.
    if (out.prefixName) {
      mentions.push({ displayName: out.prefixName, memberId: msg.senderMemberId });
    }

    await this.sendReply(msg, s, out, opts, {
      category: PERSONA_CATEGORY[key],
      lang,
      mentions,
      // The question this answers (CCB-S3-009), so the pair publishes or
      // withholds together.
      replyTo: { groupId: msg.groupId, itemId: msg.itemId },
    });
  }

  private async sendReply(
    msg: CapturedMessage,
    s: InteractionSettings,
    out: OutboundReply,
    opts: ReplyOptions,
    meta: BotReplyMeta,
    /**
     * Whether the reply left. Added for the free-conversation diagnostics (CCB-S4-031
     * gap 5): a reply the rate limit dropped is invisible from outside, and "she said
     * nothing" and "she was throttled" are different facts an operator needs apart.
     * Every existing caller ignores it, which is why this is a return value rather than
     * a thrown error.
     */
  ): Promise<boolean> {
    const now = this.now();
    const openWindow = opts.openWindow !== false;

    if (opts.bypassLimit) {
      this.state.noteReply(msg.groupId, msg.senderMemberId, now);
    } else if (
      !this.state.allowReply(
        msg.groupId,
        msg.senderMemberId,
        now,
        s.replyLimitPerMember,
        s.replyLimitPerChat,
      )
    ) {
      log.debug(
        `Interaction: reply rate limit hit for member ${msg.senderMemberId} in group ${msg.groupId}; staying silent.`,
      );
      return false;
    }

    try {
      await this.deps.send(msg, out.text, { quote: out.quote, ...meta });
    } catch (err) {
      log.warn(
        `Interaction: failed to reply to member ${msg.senderMemberId}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
      return false;
    }

    // §2 — the window refreshes on every reply she actually sends.
    if (openWindow) {
      this.state.openFollowUp(msg.groupId, msg.senderMemberId, now, s.followUpSeconds * 1000);
    }
    return true;
  }

  /* ── Helpers ───────────────────────────────────────────────────────────── */

  /**
   * Does a short answer begin with one of the configured words? Used for the
   * affirmation and decline lists, which are fuzzy-matched like everything else
   * (`jup`, `yeah`, `klar`) but anchored at the start and length-bounded, so a
   * long sentence that happens to contain "ok" is not read as consent.
   */
  /**
   * Does the message consist of exactly one of these words, and nothing else?
   * (CCB-S3-013)
   *
   * Deliberately NOT `matchesList`. That helper is fuzzy and length-bounded, both
   * of which are right for "yeah" and fatal for a destructive keyword:
   *
   *   - `fuzzyEquals` allows one edit at six characters and two at seven or more,
   *     so "delete" would accept "delet", "deleted" and "felete", and the folded
   *     German "loeschen" would accept two edits. A word that can be arrived at by
   *     mistyping is not a safety mechanism.
   *   - `matchesList` skips its length guard until the message is more than two
   *     tokens longer than the pattern, so "yeah delete everything" matches on its
   *     first token alone.
   *
   * So this requires a single token, compared for exact equality after `fold()`
   * normalisation. Folding is not fuzziness: it makes "lösche" and "loesche" the
   * same word rather than making near-misses acceptable.
   */
  private matchesLiteral(instruction: string, words: string[]): boolean {
    const tokens = normTokens(instruction);
    if (tokens.length !== 1) return false;
    const token = tokens[0] as string;
    for (const word of words) {
      const pat = normTokens(word);
      if (pat.length === 1 && pat[0] === token) return true;
    }
    return false;
  }

  private matchesList(instruction: string, list: string[]): boolean {
    const tokens = normTokens(instruction);
    if (tokens.length === 0) return false;
    for (const entry of list) {
      const pat = normTokens(entry);
      if (pat.length === 0 || pat.length > tokens.length) continue;
      if (tokens.length > pat.length + 2) continue;
      let ok = true;
      for (let i = 0; i < pat.length; i++) {
        if (!fuzzyEquals(tokens[i] as string, pat[i] as string)) {
          ok = false;
          break;
        }
      }
      if (ok) return true;
    }
    return false;
  }
}
