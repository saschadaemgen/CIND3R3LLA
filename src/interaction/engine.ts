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
import type { Intent } from './intent.js';
import type { MusicPromptFacts } from './personality.js';
import { buildHelpReply, buildHelpTopic, parseHelpTopic, type HelpLang } from './help.js';
import type { AiReplyMode, AiReplyRequest } from './ollama-reply.js';
import {
  dialledPromptInputs,
  sharpenBy,
  type BotIdentity,
  type BotPersonality,
} from './personality.js';
import { lookupBrief, shouldAnnounce, type LookupKind } from './lookup-announcement.js';
import { hasRetrievableContent } from '../knowledge/retrieval.js';
import { modelQueue } from './model-queue.js';
import { renderPromptRule, type PromptRule, type PromptRuleSet } from './prompt-rules.js';
import { recitalTransitionAsk } from './recital.js';
import {
  PAGE_FRAMING_MAX_CHARS,
  renderBookPage,
  sceneVoiceUsable,
} from './book-scene.js';
import { HISTORY_FENCE } from './ollama-reply.js';
import { toPromptHistory, trimHistory, type HistoryEntry } from './history.js';
import { markersFromTemplates, stripProtectedLines } from './protected-text.js';
import {
  asksAboutRules,
  asksByElimination,
  asksForRecital,
  asksGenerally,
  probesInternalRule,
  rulesForQuestion,
  withheldCount,
} from './disclosure.js';
import {
  asksChapterQuestion,
  asksForAnotherLaw,
  capFollowUp,
  overviewLiterals,
  renderAreas,
  ruleOverview,
  rulesForFollowUp,
} from './rule-overview.js';
import {
  asksForLawNumber,
  lawByNumber,
  lawNumberOf,
  nextLawAfter,
  numberedLawCount,
} from './law-numbers.js';
import { DISCLOSURE_GATE_RULE, preSearchRuleFor } from './rule-invocation-map.js';
import {
  recordRuleInvocation,
  summariseRuleInvocations,
  type InvocationKind,
} from '../db/rule-invocations.js';
import { wantsOverview } from './recital.js';
import { listRecitalChapters } from '../db/recital-chapters.js';
import { listGroupHistory } from '../db/messages.js';
import { screenLookup } from './lookup-gate.js';
import { attributionFor } from './attribution.js';
import type { SearchResult as WebSearchResult } from '../plugins/web-search/providers/types.js';
import { recordConversation } from './conversation-log.js';
import {
  describeRule,
  evaluateEnforcement,
  evaluateVerbal,
  warningPosition,
  type ModerationRules,
  type ViolationType,
} from '../moderation/rules.js';
import { countViolations, recordSanction, recordViolation } from '../moderation/store.js';
import { applySanction, type EnforcementPort } from '../moderation/apply.js';

/**
 * What the MUSIC lane needs (CCB-S5-044). Implemented over the music service in
 * index.ts, scoped to one bot; every answer is a plain outcome string so the
 * copy stays in the persona and the logic stays in the plugin.
 */
export interface MusicOps {
  view(): Promise<{ playlists: { name: string; trackCount: number; mode: string }[] }>;
  tracksOf(
    name: string,
  ): Promise<{ playlist: string; items: { id: number; title: string }[]; total: number } | null>;
  playByTitle(groupId: number, title: string): Promise<'sent' | 'busy' | 'unknown' | 'send-failed' | 'unavailable'>;
  playById(groupId: number, trackId: number): Promise<'sent' | 'busy' | 'unknown' | 'send-failed' | 'unavailable'>;
  playFromPlaylist(groupId: number, name: string): Promise<'sent' | 'busy' | 'empty' | 'send-failed' | 'unavailable'>;
  /** A random track of one genre this bot can reach - the ladder's last rung (D-220). */
  playByGenre(groupId: number, genre: string): Promise<'sent' | 'busy' | 'empty' | 'send-failed' | 'unavailable'>;
  /** "play Aurora Night" where that is the ARTIST (D-222): folded equality, per-room advance. */
  playByArtist(groupId: number, artist: string): Promise<'sent' | 'busy' | 'empty' | 'send-failed' | 'unavailable'>;
  /** What follows the room's last play (D-222): its genre when it has one, else anything reachable. */
  playNext(groupId: number): Promise<'sent' | 'busy' | 'empty' | 'send-failed' | 'unavailable'>;
  /** The numbered listing of one genre, for "what's on cyberpunk" (D-222). */
  tracksOfGenre(genre: string): Promise<{ genre: string; items: { id: number; title: string }[]; total: number } | null>;
  playSomething(groupId: number): Promise<'sent' | 'busy' | 'empty' | 'send-failed' | 'unavailable'>;
  /** The DJ sheet's numbers, for the overview and the genre cards. All derived. */
  facts(): Promise<{ tracks: number; genres: { name: string; count: number }[]; playlists: number }>;
  playUpload(
    groupId: number,
    senderMemberId: string,
  ): Promise<'sent' | 'busy' | 'not-audio' | 'too-large' | 'no-file' | 'off' | 'unavailable'>;
  /** The live upload bound, so the too-large line states the truth of today. */
  uploadLimitBytes(): number;
}

/**
 * What she last LISTED in a group (CCB-S5-044 follow-up): the context that lets
 * "what's on 2" and "play 3" answer with a number, which is what makes the
 * exchange a conversation rather than a menu. Ten minutes, then a bare number
 * means nothing again - the follow-up-window shape.
 */
interface MusicListContext {
  kind: 'playlists' | 'tracks' | 'genre';
  /** Playlist names in shown order, or track (id,title) pairs in shown order. */
  playlists?: string[];
  tracks?: { id: number; title: string }[];
  /** The genre a card just confirmed - the subject a short affirmative takes. */
  genre?: string;
  expiresAt: number;
}

const MUSIC_LIST_CONTEXT_MS = 10 * 60_000;

/** "do you have ..." in either language - the ask a genre card answers (D-221). */
const MUSIC_HAVE_ASK = /(?:do you have|have you got|hast du|gibt es|haben sie)\b/;

/**
 * The words that make a have-ask GENERAL rather than named (D-221): after the
 * have-phrase is stripped, a question whose every remaining word sits in this
 * set named nothing - "what music do you have?", "do you have any tracks?" -
 * and gets the overview, where a leftover word is a SUBJECT and gets the card
 * or the echo-free miss.
 */
const MUSIC_GENERIC_WORDS = new Set([
  'what', 'which', 'any', 'some', 'got', 'more', 'still', 'a', 'the', 'me', 'us', 'for', 'please',
  'music', 'track', 'tracks', 'song', 'songs', 'tune', 'tunes', 'playlist', 'playlists',
  'genre', 'genres', 'audiobook', 'audiobooks', 'kind', 'kinds', 'sort', 'sorts', 'of',
  'was', 'welche', 'welches', 'etwas', 'irgendwas', 'noch', 'auch', 'da', 'hier', 'denn',
  'eigentlich', 'eine', 'einen', 'ein', 'die', 'der', 'das', 'mir', 'uns', 'bitte',
  'musik', 'lied', 'lieder', 'titel', 'hoerbuch', 'hoerbuecher', 'art', 'arten', 'von',
]);

/**
 * The OFFER TAKEN (D-221): a short whole-message affirmative while a genre
 * card is live. Anchored both ends so "yes but tell me about X" never plays;
 * 'play one' is deliberately absent because 'play' claims the lane by itself.
 */
const MUSIC_AFFIRMATIVE = /^(?:yes(?:\s+please)?|ja(?:\s+bitte)?|go\s+on|put\s+one\s+on|mach\s+an|leg\s+los)\s*[.!?]*$/;

function musicEscapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, String.raw`\$&`);
}

/** Case-fold and drop everything that is not a letter or digit (D-222). */
function musicSquash(value: string): string {
  return value.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');
}

/**
 * Does the text name this genre or playlist? Whole word first; then the
 * squashed forms, because 'Cyber Punk' in a tag and 'cyberpunk' in a message
 * are one word and the denial of a held genre is the fault this whole
 * sequence started with (D-222). The four-character floor keeps a squashed
 * 'pop' out of 'popular'.
 */
function musicNamesWord(text: string, name: string): boolean {
  const whole = new RegExp(
    `(?<![\\p{L}\\p{N}])${musicEscapeRegExp(name.toLowerCase())}(?![\\p{L}\\p{N}])`,
    'u',
  ).test(text);
  if (whole) return true;
  const squashed = musicSquash(name);
  return squashed.length >= 4 && musicSquash(text).includes(squashed);
}

/**
 * Every reply the music lane sends is EXEMPT from the rate limiter (D-222).
 * The limiter dropped the honest-miss line after a real ask and the member
 * stared at silence - the journal ended at "Saved message" with no send and
 * no error, because the drop logs at info and returns false. A music reply
 * is 1:1 with an explicit addressed ask, the same shape as the exempt
 * consent outcomes; it still COUNTS against the allowance of other lanes.
 */
const MUSIC_REPLY = { bypassLimit: true } as const;

/** "next" / "another one" / "noch eins", whole-message, with an optional named source. */
const MUSIC_NEXT_BARE = /^(?:next|another(?:\s+one)?|one\s+more|weiter|noch\s+ein(?:s|en)?|n(?:ae|ä)chste\w*)\b(?:\s+(.{0,60}?))?\s*[!.?]*$/;

/**
 * The bare next-words that route an UNCLAIMED message into the lane (D-222):
 * 'next' and its unambiguous friends only. 'another' and 'one more' alone are
 * deliberately absent - "tell me another" is a joke follow-up, not a play -
 * and become plays only behind 'play' or beside a named genre or playlist.
 */
const MUSIC_NEXT_HOOK = /^(?:next(?:\s+(?:one|song|track|title))?|weiter|n(?:ae|ä)chste[rs]?(?:\s+(?:song|track|lied|titel))?)\s*[!.?]*$/;

/** The same next-phrase as a play argument: "play another", "play the next one". */
const MUSIC_NEXT_ARG = /^(?:another(?:\s+one)?|one\s+more|the\s+next(?:\s+one)?|next|weiter|noch\s+ein(?:s|en)?|n(?:ae|ä)chste\w*)\b(?:\s+(.*))?$/;

function trackCountPhrase(count: number, lang: string): string {
  if (lang === 'de') return count === 1 ? '1 Titel' : `${String(count)} Titel`;
  return count === 1 ? '1 track' : `${String(count)} tracks`;
}

export interface InteractionDeps {
  db: Queryable;
  /**
   * Which bot this engine speaks for (CCB-S5-001).
   *
   * Every enabled bot is hosted now and each has its own engine, so the engine has to be
   * able to say whose character, whose laws, whose ladders and whose counters these are.
   * Null only where no bot configuration exists at all, which is the harnesses.
   */
  botProfileId?: number | null;
  /** This bot's display name, for operator-facing diagnostics (CCB-S5-006). */
  botName?: string | null;
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
   * WHAT THIS BOT CAN BE ASKED FOR (CCB-S5-021, D-175).
   *
   * The core intents plus the intents of the plugins enabled for THIS bot, read live so a
   * capability switched off in the console leaves this bot's vocabulary on the next
   * message rather than on the next restart.
   *
   * REQUIRED, and that is the point. It replaced a process-wide catalog in `intent.ts`
   * that every hosted bot shared, which meant a plugin switched off for one bot was still
   * in every bot's vocabulary. An optional getter defaulting to a deployment-wide set
   * would reintroduce exactly that, silently, on any construction that omitted it.
   */
  capabilities: () => readonly Intent[];
  /**
   * Does this bot answer the commands that name NOBODY, in this group (CCB-S5-027, D-182)?
   *
   * `/search` and `/help` reach every hosted bot in a group, because a slash command carries
   * no wake word for the addressing layer to match. In a group with one bot that is the
   * whole point of a slash command; in a group with two it is one question answered twice
   * with two different answers, which is what production produced.
   *
   * Answered by `GroupOwnership.answersCommands`, which elects one bot per REAL group from
   * an index every bot shares. Absent means yes, because a construction that does not know
   * about co-tenancy is a construction where there is none: a single-bot deployment and
   * every harness must behave exactly as before.
   */
  answersGroupCommands?: (groupId: number) => boolean;
  /**
   * Market data (CCB-S3-004), injected by the plugin. Null when the plugin is off FOR
   * THIS BOT (CCB-S5-021) — in which case PRICE is not in this bot's catalog either, so
   * this is belt and braces rather than the only guard.
   *
   * A GETTER since CCB-S5-021, like the personality and the enforcement port beside it.
   * Held as a value it was decided once at boot, so switching a capability on or off for
   * one bot in the console reached the catalog immediately and this only on the next
   * restart, and the two guards would have disagreed for as long as the process ran.
   */
  prices?: () => {
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
  } | null;
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
  /**
   * The rules she is given (CCB-S4-039, D-144), read live for the same reason as the
   * dials: an operator who changes a rule expects the next reply to follow it.
   *
   * Unlike the personality this is needed in EVERY mode, including the command rewrites,
   * because the whole system prompt is assembled from it and not only the voice section.
   *
   * Absent, or returning an empty set, is not "no rules apply": the prompt builder refuses
   * to send anything, the failure is logged and counted as an AI fallback, and the member
   * gets the deterministic reply somebody wrote.
   */
  rules?: () => PromptRuleSet;
  /**
   * Reads the Book out loud (CCB-S4-047, D-149).
   *
   * Absent means no recital is wired and every rules question gets the brief answer, which is
   * the CCB-S4-045 behaviour and a complete answer in its own right. Returns whether a recital
   * actually STARTED: `false` falls through to the brief answer, because a performance that
   * could not start is not a reason to leave a member with nothing.
   */
  recite?: (msg: CapturedMessage, lang: string) => Promise<boolean>;
  /**
   * Tells the Book as a SCENE (CCB-S5-005, D-159).
   *
   * Takes the law the last scene in this chat read out and returns the one this scene read,
   * or null when no scene was told. The engine owns that memory because the engine owns every
   * other piece of per-chat state; the service stays a function of its arguments.
   *
   * Null falls through to the recital decision and then to the overview, which is
   * CCB-S4-048's behaviour and a complete answer in its own right.
   */
  tellBook?: (
    msg: CapturedMessage,
    lang: string,
    previousLawId: string | null,
  ) => Promise<string | null>;
  /**
   * The model that words her replies (CCB-S4-042, D-145), read live so a change on the
   * Models page reaches the next reply rather than the next restart.
   *
   * Absent, or returning null, means no runtime is initialised and the prompt says nothing
   * about a model, which is the honest answer rather than naming one she may not be running.
   */
  replyModel?: () => string | null;
  /**
   * The moderation ladders (CCB-S4-032, D-136), read live so a threshold the operator
   * just tuned applies to the next message.
   *
   * Absent, or returning null, means no bot profile is selected for the runtime and the
   * ladders do not run at all. There is deliberately NO enforcement capability beside
   * this: the engine's only outbound is `send`, so a computed sanction has nothing to
   * act through, which is the no-act guarantee in its structural form.
   */
  /**
   * The zone the server runs in, for the date she is told (CCB-S4-036). Defaults to the
   * host's resolved zone; supplied by harnesses so a rendered prompt is deterministic.
   */
  timeZone?: string;
  /**
   * Web search (CCB-S4-037, D-141).
   *
   * ── WHAT THIS DEPENDENCY CAN AND CANNOT DO ────────────────────────────────
   *
   * It takes a query and returns text. That is the whole interface, and it is the whole
   * of the no-action property: there is no way for a search result to become anything
   * other than the return value of this call, because the only thing the engine can do
   * with a `WebSearchLookup` is call it and read what comes back.
   *
   * Same shape and the same reasoning as the enforcement port (D-139): the capability is
   * handed in, so a harness can substitute it and prove exactly what was and was not
   * attempted, and the plugin's own module cannot be reached from here at all.
   *
   * Null means the plugin is off FOR THIS BOT or unconfigured, in which case LOOKUP is
   * not in this bot's catalog either, so this is the second line of defence rather than
   * the first. A getter for the same reason `prices` is one; see there.
   */
  /**
   * What she was given to read (CCB-S5-022, D-176).
   *
   * Declared narrowly here for the reason `WebSearchLookup` is: the interaction layer must
   * not depend on the store, and a reader can see in six lines that the only thing a
   * knowledge lookup can produce is text and document names.
   *
   * Null when the plugin is off FOR THIS BOT, and that is the whole absent-capability
   * property for a plugin that contributes no intent: nothing is embedded, nothing is
   * searched, and no passage reaches the model.
   */
  knowledge?: () => KnowledgeLookup | null;
  webSearch?: () => WebSearchLookup | null;
  /**
   * The music library (CCB-S5-044). Null when the plugin is off for this bot;
   * MUSIC then never enters the catalog and this is the second line of defence.
   * The operations answer with plain strings the handler maps to persona lines,
   * so the engine holds no music logic and the service holds no copy.
   */
  music?: () => MusicOps | null;
  moderationRules?: () => ModerationRules | null;
  /**
   * The capability that makes a sanction real (CCB-S4-035, D-139).
   *
   * THE ENGINE'S SECOND OUTBOUND, and the first one that can do something to a member
   * rather than say something to them. CCB-S4-032 could promise that a computed sanction
   * had nothing to act through because `send` was the only way out of here; arming
   * replaces that promise with a narrower one that is still structural.
   *
   * It is a GETTER returning a port, not a bag of methods, so three things stay true:
   * absent or returning null means the engine cannot act at all, which is what every
   * harness written before this briefing gets by default and why none of them had to
   * change; the port is substitutable, so a spy can prove call-for-call what was and was
   * not attempted; and the SDK names stay behind the seam in `src/bot/enforcement.ts`.
   *
   * Having the capability is still not permission to use it. The mode decides, the
   * deterministic ladder decides which step, and no model output is read on either path.
   */
  enforcementPort?: () => EnforcementPort | null;
  /**
   * Book the reversal of a timed mute (CCB-S4-035).
   *
   * Injected rather than imported for the same reason as everything else on this
   * interface: a harness proves the booking happened without running a queue worker, and
   * the engine keeps its one-directional dependencies. Absent means no expiry is booked,
   * which is only correct in a harness; the boot path always supplies it, and the Active
   * page's overdue flag is what catches it if it ever does not.
   */
  scheduleUnmute?: (sanctionId: string, at: Date) => Promise<void>;
}

/**
 * The only shape of web search the engine knows about (CCB-S4-037).
 *
 * DELIBERATELY NOT the plugin's `WebSearchService` type. The engine declaring the narrow
 * thing it needs, rather than importing the wide thing that exists, is what keeps the
 * interaction layer independent of a plugin and what makes the no-action property
 * readable: a reader can see, in five lines, that the only thing a search can produce
 * here is a list of strings.
 */
/** The only shape of a knowledge base the engine knows about (CCB-S5-022). */
export interface KnowledgeLookup {
  query(
    botProfileId: number,
    question: string,
  ): Promise<{
    /** Verbatim passages, already budgeted and above the relevance floor. */
    passages: { title: string; text: string }[];
    /** Document titles the APPLICATION prints. Never model-written (D-137). */
    sources: string[];
  }>;
}

export interface WebSearchLookup {
  /** Whether a search could be attempted at all right now. */
  available(): boolean;
  search(
    query: string,
    /**
     * `botProfileId` since CCB-S5-021: the search BUDGET is spent per bot, so one bot
     * cannot exhaust another's allowance. The number itself stays deployment-wide,
     * because it is the operator's bill.
     */
    scope: { groupId: number; memberId: string; botProfileId?: number },
  ): Promise<
    | { kind: 'results'; results: { title: string; snippet: string; url: string }[]; provider: string }
    | { kind: 'failed'; failure: string; detail: string }
  >;
  /**
   * Tell the plugin a request was refused before it ever reached a provider (CCB-S4-042).
   *
   * OPTIONAL, because the gate is the engine's decision and must run whether or not anybody
   * is counting. A harness that does not care about the console leaves it out; production
   * hands over the service so the Web Search page can show what the gate is saving.
   *
   * The CATEGORY only. The query is never passed, so it cannot be stored here by accident
   * in some later change.
   */
  noteRefusedBeforeSearch?(category: string): void;
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
  /**
   * Do not let this message consume the member's allowance either (CCB-S5-025).
   *
   * `bypassLimit` alone means "cannot be dropped", and it deliberately still CALLS
   * `noteReply`, because every other exempt message is a real reply carrying a real
   * outcome: a consent confirmation should not be droppable and should still be counted.
   *
   * The lookup holding line is the one message that is not a reply. It carries nothing but
   * "I am looking", and counting it had a consequence nobody intended: the announcement took
   * a slot, and the ANSWER became the message the limiter dropped. CCB-S4-038's own comment
   * named that exact failure as the reason the announcement bypasses the limiter, and the
   * bypass it chose did not prevent it. So this flag is what that comment always meant.
   *
   * It is not a hole. `announceLookup` asks {@link ConversationState.wouldAllowReply} first
   * and stays silent when the answer would be dropped, so a member over their limit gets
   * neither, and the announcement stays bounded by the same limiter as everything else.
   */
  uncounted?: boolean;
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
 *
 * Exported for `verify:name-guard` only (CCB-S5-031). Membership is not something a
 * behavioural test can see: `personalizedBody` falls back to the deterministic draft when
 * the model fails, so a key wrongly added here produces the right text anyway and the fault
 * only shows on the day the model succeeds and rewords a line it should not touch.
 */
export const AI_PERSONALIZED_KEYS = new Set<PersonaKey>([
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
const AI_LOCKED_KEYS = new Set<PersonaKey>([
  'priceAmbiguous',
  'status',
  // CCB-S5-044: the playlist and track lists are application facts (D-217 rule
  // 4's pattern one lane early): the model writes an opening line, never the list.
  'musicPlaylists',
  'musicTracks',
  'musicOverview',
  // D-221: the genre cards. The numbers stay ours; the sentence is hers.
  'musicGenreYes',
  'musicGenresSome',
  // D-222: the genre listing, locked like its playlist twin.
  'musicGenreTracks',
]);

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

/**
 * Intents this precedence rule will not touch (CCB-S4-048, D-150).
 *
 * The three that change publication state. RESTORE is in here as well as the two obvious
 * ones, because it increases public exposure and has the same confirmation handshake; a
 * precedence rule that quietly rerouted it would be reaching into the one path it has no
 * business in. Spelled out rather than reusing `CONSENT_INTENTS`, which is PUBLISH and
 * UNPUBLISH only and is used elsewhere for a narrower question.
 */
const NEVER_OVERRIDDEN: ReadonlySet<string> = new Set(['PUBLISH', 'UNPUBLISH', 'RESTORE']);

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
  /** IANA zone the server runs in, told to her with the time (CCB-S4-036). */
  private readonly timeZone: string;
  private readonly random: () => number;

  constructor(private readonly deps: InteractionDeps) {
    this.now = deps.now ?? ((): number => Date.now());
    // Resolved ONCE, at construction. `resolvedOptions()` is not free and the zone a
    // server runs in does not change between messages. Overridable so a check can pin it:
    // a rendered prompt that depended on the machine's zone would assert differently on
    // the operator's laptop and in CI.
    this.timeZone =
      deps.timeZone ?? Intl.DateTimeFormat().resolvedOptions().timeZone ?? 'UTC';
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
      if (!this.answersGroupCommands(msg.groupId)) return true;
      await this.answerHelp(
        msg,
        s,
        this.replyLanguage(msg, s, msg.text, undefined, this.now()),
        msg.text.trim(),
      );
      return true;
    }
    // ── `/search <query>`: THE UNAMBIGUOUS ROUTE TO THE ARCHIVE (CCB-S5-026) ──
    //
    // The natural-language trigger is explicit-only now, and it is the ONLY route the
    // archive had: unlike consent, which has `/publish` behind it, a member who could not
    // remember the phrasing had nothing to fall back on. This is that fallback, and it
    // resolves nothing: a slash command states where to look by being one, so it never
    // competes with the web or the knowledge base for a word.
    //
    // Placed beside `/help` and before the slash guard below, for the same reason: command
    // shaped text never reaches the conversational path.
    const slashSearch = /^\/search(?:\s+(\S.*))?$/i.exec(msg.text.trim());
    if (slashSearch) {
      this.handledCategory = 'search';
      // ── EXACTLY ONE BOT ANSWERS (CCB-S5-027, D-182) ─────────────────────
      //
      // A slash command names nobody, so in a group with two hosted bots both of them
      // reach this line. Production answered one `/search` twice with two different
      // counts. The unelected bot still returns TRUE and still classifies the message,
      // because the category is what decides publication and leaving it NULL would let a
      // member's search request publish as ordinary chat past a switch the operator had
      // turned off. It simply does not speak.
      if (!this.answersGroupCommands(msg.groupId)) return true;
      const searchLang = this.replyLanguage(msg, s, msg.text, undefined, this.now());
      const query = (slashSearch[1] ?? '').trim();
      if (!query) {
        // A bare `/search` is a member who knows the command and not the shape of it.
        await this.reply(msg, s, searchLang, 'searchNoQuery', {});
        return true;
      }
      const found = await countPublishedMatching(this.deps.db, query, {
        groupId: msg.groupId,
        excludeGroupMsgId: msg.itemId,
      });
      await this.reply(msg, s, searchLang, 'searchResult', { n: found, query });
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
      // THIS BOT'S catalog (CCB-S5-021). A capability another bot has is not merely
      // refused here, it cannot be produced: the rule engine never matches its patterns,
      // the model is never shown the intent, and the seam downgrades a claim to it.
      intents: this.deps.capabilities(),
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
    //
    // IT NO LONGER SILENCES HER (CCB-S4-042, D-145). It used to return false, and a member
    // who plainly addressed her with a long spell-check request got NOTHING back: no
    // answer, no refusal, no sign she had seen it. The operator raised
    // `maxInstructionLength` and the same message was answered fine, which is how it was
    // found.
    //
    // The reasoning holds for COMMANDS and does not hold for answering at all. A long
    // forwarded article that merely opens with her name still must not trigger PUBLISH, so
    // the intent drops to UNKNOWN, which is what stops the command; the message then carries
    // on into free conversation like anything else said to her. Silence reads as a fault,
    // and a member who addressed her deserves an answer or a refusal, never nothing.
    let tooLong = false;
    if (
      !carried &&
      instruction.length > s.addressing.maxInstructionLength &&
      result.confidence < s.addressing.lengthGuardConfidence
    ) {
      this.noteNearMiss(msg, s, now, 'too-long', instruction, result);
      tooLong = true;
      result = { intent: 'UNKNOWN', confidence: 0, slots: {}, lang };
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
    // `!tooLong`, because the length guard has just decided this message may not execute a
    // command, and this is the one place downstream that could still promote one.
    if (
      !tooLong &&
      explicit &&
      result.intent !== 'HELP' &&
      /^(?:help|hilfe)\b/i.test(instruction.trim())
    ) {
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

    // ── A QUESTION ABOUT HER OUTRANKS THE CATALOG (CCB-S4-048, D-150) ──────
    //
    // D-143 settled that anything about her is conversation rather than a command, and put a
    // precedence rule in `rules.ts` so an explicit web verb beats a topic keyword. That fixed
    // the rule engine and left the other resolver alone, which is where this came back.
    //
    // Observed in production: "Cinderella, show me the Book of Elii" was classified LOOKUP by
    // the MODEL resolver, and for a non-consent intent the model's answer is taken as-is, so
    // it went to the web. The name the operator gave the thing produced an outbound search.
    // The rule engine was never the culprit here: it returns UNKNOWN for every English
    // phrasing of this. German broke separately and in the OTHER resolver, where "was sind
    // deine Regeln?" scored SEARCH at 0.6 and went to the archive.
    //
    // So the precedence is enforced HERE, after both resolvers and before dispatch, because
    // this is the only point every path passes through. D-143's principle is unchanged and
    // its reach is extended: a question about her rules is conversation, whichever resolver
    // claimed it and whatever it claimed it was.
    //
    // CONSENT IS NEVER OVERRIDDEN. A consent intent has its own deterministic gate and its
    // own confirmation handshake, and quietly turning one into conversation would be this
    // rule reaching into the one path it has no business in. Nothing matching these detectors
    // looks like a consent instruction, so the exclusion costs nothing and settles it.
    if (
      result.intent !== 'UNKNOWN' &&
      !NEVER_OVERRIDDEN.has(result.intent) &&
      (this.aboutHerRules(msg, now, true) || asksForRecital(msg.text))
    ) {
      log.debug(
        `Interaction: ${result.intent} claimed a question about her own rules; answering it ` +
          'as conversation instead (D-150).',
      );
      result = { ...result, intent: 'UNKNOWN', slots: {} };
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
        // ── THE HOLDING LINE, ARCHIVE (CCB-S5-025) ──────────────────────────
        //
        // BEFORE the count, unlike the knowledge base, and the difference is honesty
        // rather than style. Nothing can stop this search now: the query is validated
        // three lines up and the next statement is the query itself, so a member who
        // sees this line is a member whose search is genuinely running, which is the
        // CCB-S4-038 condition. The count is one indexed query and costs milliseconds;
        // what she is covering for is the reply she is about to write.
        const announced = this.lookupAnnouncementDue('archive')
          ? await this.announceLookup(msg, s, lang, 'archive')
          : false;
        let n: number;
        try {
          n = await countPublishedMatching(this.deps.db, query, {
            groupId: msg.groupId,
            excludeGroupMsgId: msg.itemId,
          });
        } catch (error) {
          // CLOSING THE LOOP (CCB-S5-025). Without this the count throwing after the holding
          // line went out leaves her having said she is going back through the archive and
          // then saying nothing, which is the hanging announcement CCB-S4-038 exists to
          // prevent. Surfaced rather than swallowed: the operator gets the error and the
          // member gets the honest line rather than a number that was never counted.
          log.error(
            `Interaction: the archive search failed for group ${String(msg.groupId)} (${
              error instanceof Error ? error.message : String(error)
            }).`,
          );
          status.error(
            `Archive search failed in group ${String(msg.groupId)}; the member was told it ` +
              `could not be looked up: ${error instanceof Error ? error.message : String(error)}`,
          );
          if (announced) await this.reply(msg, s, lang, 'searchUnavailable', {});
          return true;
        }
        // The loop closes itself on this path: `searchResult` states the number it found,
        // including zero, so an announcement is never left hanging over silence.
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

      case 'MUSIC':
        return this.answerMusicSafely(msg, s, lang, instruction);

      case 'LOOKUP':
        return this.answerLookup(msg, s, lang, result.slots, instruction);

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
        // D-221: two asks that carry no lexicon token and are still hers.
        // A short affirmative while a genre card is live is the offer being
        // taken; "do you have <thing she holds>" names its subject out of HER
        // OWN vocabulary, the DJ sheet - a deterministic, data-driven
        // predicate over the text, never a model's claim (D-183).
        if (await this.unclaimedMusicAsk(msg, instruction)) {
          return await this.answerMusicSafely(msg, s, lang, instruction);
        }

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

  /**
   * The given facts about her, including the model that is actually running (CCB-S4-042).
   *
   * ONE builder, because there are four prompt sites and a fact attached at three of them
   * is a fact she states inconsistently.  reads the operator-configured
   * settings; the model comes from the AI routing, which is not a setting on that page.
   */
  private facts(s: InteractionSettings): BotIdentity {
    const model = this.deps.replyModel?.() ?? null;
    return { ...botIdentity(s), ...(model ? { model } : {}) };
  }

  /**
   * Records that a rule decided something, if there is a rule to name (CCB-S4-050).
   *
   * `null` is the ordinary case for anything unmapped, and it writes nothing. The record's
   * value is that every row in it is true; a row that guessed would make the others
   * unreadable, because an operator could not tell which was which.
   */
  /**
   * What the record holds for the rules she is about to quote.
   *
   * Never invents a figure and never rounds one: a rule with no rows is reported as never
   * having been applied, which is a fact, rather than omitted, which would let her imply it
   * had been. Empty when the record has nothing at all to say, and then the rule that carries
   * this is not selected.
   */
  private async invocationLine(quoted: readonly PromptRule[]): Promise<string> {
    if (quoted.length === 0) return '';
    const summary = await summariseRuleInvocations(this.deps.db);
    const parts = quoted.map((rule) => {
      const seen = summary.get(rule.id);
      if (!seen) return `"${rule.id}" has never been applied`;
      return `"${rule.id}" applied ${String(seen.count)} times, last on ${seen.lastAt.toISOString().slice(0, 10)}`;
    });
    return parts.join('; ');
  }

  private async noteInvocation(
    msg: CapturedMessage,
    ruleId: string | null,
    kind: InvocationKind,
    category: string | null,
  ): Promise<void> {
    if (!ruleId) return;
    if (!this.deps.settings().invocationRecord.enabled) return;
    await recordRuleInvocation(this.deps.db, {
      ruleId,
      groupId: msg.groupId,
      kind,
      category,
    });
  }

  /* ── What a recital needs from the engine (CCB-S4-047) ─────────────────── */

  /**
   * Takes a recital's allowance, or refuses.
   *
   * ── THE UNIT WAS WRONG, AND READING THE CONSOLE IS WHAT SHOWED IT ──────────
   *
   * This first charged a recital as N REPLIES, on the reasoning that the whole thing must be
   * reserved before the first word so a reading can never stop halfway. That reasoning still
   * holds. The unit did not: the reply budget ships at six per member per minute and a recital
   * is eight messages, so a recital could never start, the brief answer was always given, and
   * every check on the feature stayed green. The Recital page printed the sentence "it is 8 of
   * the 6 replies a member may have per minute" and that was the whole diagnosis.
   *
   * A recital is not several replies. It is one performance the operator deliberately enabled,
   * and it gets its own allowance, exactly as a price lookup does (CCB-S3-004 §3): the two
   * budgets bound different things, and a conversational-turn budget was never sized for this.
   * It also takes ONE reply allowance, because it is still her speaking.
   */
  allowRecital(groupId: number, memberId: string): boolean {
    return this.state.allowRecital(groupId, memberId, this.now());
  }

  /**
   * Which placeholder values exist right now, so a recital never plans a rule it cannot read.
   *
   * The same `dialledPromptInputs` the renderer below uses, so the two cannot disagree about
   * what is available: asking and rendering are one source or they are a race.
   */
  renderableValues(): ReadonlySet<string> {
    const s = this.deps.settings();
    return new Set(
      Object.keys(
        dialledPromptInputs(
          this.deps.rules?.() ?? [],
          this.deps.personality?.() ?? null,
          this.facts(s),
          { at: new Date(this.now()), timeZone: this.timeZone },
        ).values,
      ),
    );
  }

  /**
   * Sends one Book scene as an ordinary reply (CCB-S5-005).
   *
   * ── WHY THE SCENE COMES BACK THROUGH HERE ──────────────────────────────────
   *
   * It went out through the recital port, and in production it logged that it was reading and
   * then nothing arrived, with no error anywhere. The port is for beats a queue job sends
   * minutes later, holding a group id and nothing else; a scene is one message sent while the
   * message being answered is still in hand. Routing it here gives it what every other reply
   * already has: the right bot, the name prefix and mention bookkeeping, the archive of her
   * own messages (CCB-S3-007), and a send whose failure is reported.
   *
   * `bypassLimit`, like the search announcement, because the scene has its OWN allowance taken
   * before a word of it is written. Without it, `false` would mean either "a budget was spent"
   * or "the transport failed", and the caller could not tell a normal state from a fault.
   */
  async sendSceneText(msg: CapturedMessage, lang: string, text: string): Promise<boolean> {
    return await this.replyWithText(msg, this.deps.settings(), lang, text, 'conversation', {
      bypassLimit: true,
    });
  }

  /** One rule as a member will read it, through the same renderer the prompt stream uses. */
  renderRuleForMember(rule: PromptRule): string {
    const s = this.deps.settings();
    return renderPromptRule(
      rule,
      dialledPromptInputs(
        this.deps.rules?.() ?? [],
        this.deps.personality?.() ?? null,
        this.facts(s),
        { at: new Date(this.now()), timeZone: this.timeZone },
      ).values,
    );
  }

  /**
   * Her words leading into one beat.
   *
   * The model is asked for ONE line and is given the chapter title and nothing else. It is
   * never shown the rules, and could not usefully rewrite them if it were: the application
   * appends them afterwards, verbatim. That is the whole of the authored-dramaturgy split,
   * expressed as what the prompt does and does not contain.
   *
   * Returns null on any failure, which the runner treats as an ordinary outcome.
   */
  /**
   * Her words for one half of the Book scene (CCB-S5-005).
   *
   * The brief goes to the model AS the instruction, because half a scene is not a chapter
   * with a title: it is a thing to say. `reciteTransition` wraps a title in "introduce the
   * chapter called X", which would turn a brief into nonsense, so the two are separate
   * methods rather than one with a flag.
   *
   * NO RULE TEXT IS PASSED, and that is not an omission. The law goes into the message
   * afterwards, by the application, which is where the one-law bound lives: she cannot quote
   * a second law because she has not been handed a first one.
   *
   * `maxChars` is the scene's own bound rather than the conversation budget, and the
   * `requiredLiterals` carry the count, so a closing that loses it is rejected and the
   * authored line goes out with the number intact.
   */
  async sceneVoice(
    brief: string,
    lang: string,
    opts: { maxChars: number; requiredLiterals: string[] },
  ): Promise<string | null> {
    const personalize = this.personalizeForThisBot();
    if (!personalize) return null;
    const s = this.deps.settings();
    try {
      return await personalize({
        kind: 'conversation',
        lang,
        memberMessage: brief,
        deterministicDraft: '',
        mode: 'conversation',
        rules: this.deps.rules?.() ?? [],
        maxChars: opts.maxChars,
        requiredLiterals: opts.requiredLiterals,
        blockedLiterals: [],
        personality: this.deps.personality?.() ?? null,
        identity: this.facts(s),
        now: { at: new Date(this.now()), timeZone: this.timeZone },
        music: await this.musicPromptFacts(),
      });
    } catch {
      return null;
    }
  }

  async reciteTransition(title: string | undefined, lang: string): Promise<string | null> {
    const personalize = this.personalizeForThisBot();
    if (!personalize) return null;
    const s = this.deps.settings();
    const ask = recitalTransitionAsk(title);
    try {
      return await personalize({
        kind: 'conversation',
        lang,
        memberMessage: ask,
        deterministicDraft: '',
        mode: 'conversation',
        rules: this.deps.rules?.() ?? [],
        requiredLiterals: [],
        blockedLiterals: [],
        personality: this.deps.personality?.() ?? null,
        identity: this.facts(s),
        now: { at: new Date(this.now()), timeZone: this.timeZone },
        music: await this.musicPromptFacts(),
      });
    } catch {
      return null;
    }
  }

  /**
   * What was said in this chat before now (CCB-S4-044, D-147).
   *
   * THE WHOLE GROUP THREAD, not only the messages of the person she is answering. The
   * defect that motivated this was her being unable to react to something a different
   * member said three messages ago, so scoping it per member would have fixed the smaller
   * half and left the one the operator raised.
   *
   * Never throws. A history that cannot be read costs her the thread, and turning that into
   * a reason not to answer at all would be the tail wagging the dog: she falls back to the
   * behaviour she had before this briefing, which is a worse reply rather than no reply.
   */
  private async recentHistory(
    msg: CapturedMessage,
    s: InteractionSettings,
  ): Promise<HistoryEntry[]> {
    const limits = s.memory;
    if (limits.maxMessages <= 0 || limits.maxChars <= 0 || limits.windowMinutes <= 0) return [];

    const now = this.now();
    try {
      const raw = await listGroupHistory(this.deps.db, msg.groupId, {
        // Over-fetch against the COUNT only. The character budget can drop entries the
        // count allowed, and fetching exactly `maxMessages` would then return fewer lines
        // than the operator asked for whenever one of them was long.
        limit: Math.min(limits.maxMessages * 2, 200),
        sinceIso: new Date(now - limits.windowMinutes * 60_000).toISOString(),
        // The message she is answering is the CURRENT one, not history. Without this it
        // would appear twice: once as the question and once as a thing she remembers.
        beforeMessageId: msg.itemId,
      });
      // ── SHE IS NEVER SHOWN A SOURCE LINE (CCB-S5-027, D-180) ──────────────
      //
      // This is the CAUSE half of the forged-attribution defect, and the only half that
      // explains it. The application appends its own lines AFTER she writes, so what comes
      // back out of this query is her prose with the application's source line, warning
      // count or sanction notice attached. Read back as an example of her own writing, it
      // is an instruction nobody wrote: this is what your answers look like.
      //
      // BOTH SIDES, hers and the members'. Hers is where she learned it; a member's is the
      // deliberate version, because a member who types a source line into the group has
      // written her an example she will read an hour later, and D-147 already treats
      // everything in here as untrusted material for exactly that reason.
      //
      // It costs something real and it is worth naming: asked which document she cited
      // earlier, she can no longer see her own citation. That answer was never hers to give
      // - the application owns it - and the alternative is teaching her to forge it.
      const markers = this.protectedMarkers();
      const rows = raw.map((row) => ({
        ...row,
        text: stripProtectedLines(row.text, markers).text,
      }));
      return trimHistory(rows, limits, now);
    } catch (error) {
      log.warn(
        `Interaction: could not read the conversation history (${
          error instanceof Error ? error.message : String(error)
        }).`,
      );
      return [];
    }
  }

  /**
   * The rules she may quote, when somebody is asking about them (CCB-S4-045, D-148).
   *
   * Supplied ONLY on a question that asks, because forty-six rules in every prompt would
   * cost more than the whole rest of it and would crowd out the ones she is operating
   * under. Same shape as the search results and the history: attached when relevant, absent
   * otherwise, so an ordinary reply carries no mention of a rulebook.
   *
   * The trigger is deterministic. A model deciding for itself whether to recite its own
   * instructions is a model that can be talked into it.
   */
  /**
   * Is this message about her rules, in ANY of the ways she can be asked (CCB-S4-049)?
   *
   * ONE predicate, because the precedence rule and the disclosure builder must agree. They
   * did not, and that is the whole of this briefing: `asksAboutRules` recognised only messages
   * containing a rule word, so a member answering the overview's own question was neither
   * protected from the catalog nor given any rules. "What do you keep back?" reached the
   * ARCHIVE STATUS reply, and "what do you never do?" reached free conversation with nothing
   * quoted. Two symptoms, one cause.
   *
   * Four ways in, narrowest first:
   *
   *   1. It says so: `asksAboutRules`, unchanged since CCB-S4-045.
   *   2. It asks for a law by its NUMBER (CCB-S5-005). "Law 12" carries no rule word, so
   *      without this the most precise question anybody can ask about the Book was the one
   *      question that reached nothing.
   *   3. It repeats one of her own chapter names back at her.
   *   4. It arrives inside the short window an overview or a SCENE opens, where she has just
   *      invited a question and any question is plausibly the answer.
   *
   * ── AND WHY THE WINDOW IS NOT ENOUGH TO OUTRANK THE CATALOG ────────────────
   *
   * `explicit` decides whether the window counts. The first two are statements about the
   * MESSAGE and they outrank a catalog intent, which is D-150. The window is a statement about
   * the CONVERSATION, and it is much weaker: it says only that a question arrived soon after
   * she invited one.
   *
   * Letting that outrank the catalog was measured going wrong immediately. Inside the window,
   * *"what do you keep of mine?"* stopped reaching the archive and got the Book instead, which
   * is the STATUS collision this briefing opened with, running in the other direction and
   * caused by the fix for it. So the window promotes only what nothing else has claimed: an
   * explicit archive, consent, price or lookup question inside the window still goes where it
   * belongs, and only an otherwise-unclaimed question becomes a follow-up.
   */
  private aboutHerRules(msg: CapturedMessage, now: number, explicit: boolean): boolean {
    if (
      asksAboutRules(msg.text) ||
      asksForLawNumber(msg.text) !== null ||
      asksChapterQuestion(msg.text)
    ) {
      return true;
    }
    if (explicit) return false;
    if (this.state.inOverviewWindow(msg.groupId, msg.senderMemberId, now)) return true;
    // THE SCENE'S WINDOW IS NARROWER (CCB-S5-005). It admits only a message asking for
    // another page, because a scene's invitation is a narrower offer than an overview's and
    // an ordinary question shortly after one must stay an ordinary conversation.
    return (
      asksForAnotherLaw(msg.text) &&
      this.state.inSceneWindow(msg.groupId, msg.senderMemberId, now)
    );
  }

  private async disclosure(
    msg: CapturedMessage,
    lang: string,
  ): Promise<{
    nameableRules: PromptRule[];
    hasWithheldRules: boolean;
    ruleOverview?: { total: number; constitutional: number; areas: string };
    moreInArea?: number;
    ruleInvocations?: string;
    /**
     * The page the application will print under her reply, when this is a page answer.
     *
     * NOT named `lawPage`, because this object is spread straight into the reply request and
     * what the MODEL gets is a bare boolean. Naming them the same would put the law text and
     * its number into the prompt by accident, which is the one thing this whole path exists
     * to avoid.
     */
    page?: { number: number; total: number; law: string };
  }> {
    const rules = this.deps.rules?.() ?? [];
    if (rules.length === 0 || !this.aboutHerRules(msg, this.now(), false)) {
      return { nameableRules: [], hasWithheldRules: false };
    }
    const hasWithheldRules = withheldCount(rules) > 0;
    const chapters = await listRecitalChapters(this.deps.db);

    /**
     * ── ONE PAGE OF THE BOOK, WHICH THE APPLICATION PRINTS ────────────────
     *
     * Two questions land here: a page asked for by NUMBER, and a bare request for ANOTHER
     * after a scene. Both name a page rather than a subject, so there is nothing for a
     * relevance score to improve on and the application does the selecting.
     *
     * It hands the model NO RULE, which is the point. Measured against `qwen3:32b`, handing
     * her a law and its page number produced the right law under the wrong number, the wrong
     * law under a number she was given, and a law she had never been shown. So the page is
     * printed by the application under her words, whole and numbered, exactly as the scene
     * prints its law, and her contribution is the line that hands over to it.
     *
     * An out-of-range number never reaches here: the deterministic answer in
     * `freeConversation` has already gone out.
     */
    const page = (rule: PromptRule): { number: number; total: number; law: string } | null => {
      const number = lawNumberOf(rules, rule.id);
      if (number === null) return null;
      // Where the book is now open, so a following "another" turns from THIS page.
      this.state.noteLawShown(msg.groupId, rule.id);
      return {
        number,
        total: numberedLawCount(rules),
        law: this.renderRuleForMember(rule),
      };
    };

    const asked = asksForLawNumber(msg.text);
    const wanted =
      asked !== null
        ? lawByNumber(rules, asked)
        : asksForAnotherLaw(msg.text) &&
            this.state.inSceneWindow(msg.groupId, msg.senderMemberId, this.now())
          ? nextLawAfter(rules, this.state.lastLawShown(msg.groupId))
          : null;

    if (wanted) {
      // A law whose placeholders cannot be filled for a member is not a page she can open.
      // `renderRuleForMember` throws on one, and a throw here would cost the whole reply for
      // a reason nothing on the surface explains, so it falls through to the ordinary answer.
      let opened: { number: number; total: number; law: string } | null = null;
      try {
        opened = page(wanted);
      } catch (error) {
        log.warn(
          `Interaction: law ${wanted.id} cannot be rendered for a member (${
            error instanceof Error ? error.message : String(error)
          }); answering without opening the page.`,
        );
      }
      if (opened) {
        return { nameableRules: [], hasWithheldRules, page: opened };
      }
    }

    // ── GENERAL GETS AN ORIENTATION, SPECIFIC GETS THE QUOTES (CCB-S4-048) ──
    //
    // The split already existed for a different purpose: CCB-S4-045 gave a general question a
    // cross-section and a specific one the strongest matches. What changed in production is
    // what a general question DESERVES. Quoting three or four rules back to back is a block
    // nobody reads, so it now gets counts, areas and an invitation, and quotes nothing.
    if (asksGenerally(msg.text) && wantsOverview(this.deps.settings().recital)) {
      const overview = ruleOverview(rules, chapters, lang);
      // The window opens HERE and nowhere else, so it can only ever follow an answer that
      // actually invited one.
      this.state.noteOverview(msg.groupId, msg.senderMemberId, this.now());
      return {
        nameableRules: [],
        hasWithheldRules,
        ruleOverview: {
          total: overview.total,
          constitutional: overview.constitutional,
          areas: renderAreas(overview, lang),
        },
      };
    }

    // A FOLLOW-UP, capped. Two quoted laws is the most that reads as an answer; past that she
    // says there is more in the area and invites another question, which is the whole shape
    // this briefing is built around.
    // BY AREA FIRST, then by keyword. A question that names one of the operator's chapters is
    // a question about that area, and the chapter is an authored map of what her rules cover.
    // Measured: without this, "what do you never do?" selected the rule about her own name and
    // the one about nicknames, because both contain the word "never", and not one of the four
    // rules that actually answer it.
    const capped = capFollowUp(
      rulesForFollowUp(
        rules,
        chapters,
        msg.text,
        lang,
        rulesForQuestion(rules, msg.text),
        // NOT THE ONE THE SCENE JUST READ (CCB-S5-005). The scene ends by inviting another
        // page, so the commonest follow-up is "tell me another", and handing back the law
        // she has just performed would make the invitation a joke.
        this.state.lastLawShown(msg.groupId),
      ),
    );

    // WHAT THE BOOK REMEMBERS ABOUT THESE ONES (CCB-S4-050). Built from the rules that have
    // already passed the nameable gate, so an internal rule's invocations are as withheld as
    // its text without a second guard existing anywhere: it never reaches this line.
    const invocations = this.deps.settings().invocationRecord.enabled
      ? await this.invocationLine(capped.quoted)
      : '';

    return {
      nameableRules: capped.quoted,
      hasWithheldRules,
      moreInArea: capped.more,
      ...(invocations ? { ruleInvocations: invocations } : {}),
    };
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
    // WHOSE engine ignored it (CCB-S5-018). The near-miss BUFFER has carried the bot since
    // CCB-S5-001, but it is gated on `logNearMisses` and lives on the Diagnostics page, so
    // the journal line was the only trace an operator diagnosing "he does not answer" would
    // meet first, and it named no bot. With several bots that makes the one fact he needs -
    // did THIS bot's engine even see the message - the one fact it does not say.
    log.debug(
      `Interaction: ${this.deps.botName ?? 'a bot'} ignored a message from ` +
        `${msg.senderMemberId} in group ${String(msg.groupId)} (${reason})` +
        `${result ? ` — ${result.intent} @ ${result.confidence.toFixed(2)}` : ''}.`,
    );
    if (!s.addressing.logNearMisses) return;
    const entry: NearMiss = {
      at: now,
      botProfileId: this.deps.botProfileId ?? null,
      botName: this.deps.botName ?? null,
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
    const prices = this.deps.prices?.() ?? null;
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
  /**
   * Look something up, and answer from what came back (CCB-S4-037, D-141).
   *
   * ── THE NO-ACTION PROPERTY, AND WHERE IT LIVES ───────────────────────────
   *
   * Read this method top to bottom and there is exactly one thing it does with what the
   * search returned: it puts the strings on an `AiReplyRequest` and sends ONE reply to the
   * chat the question came from. It does not branch on their content, does not parse them
   * for commands, does not touch consent, does not reach moderation, and cannot address
   * anybody but the asker. That is not a rule being followed, it is the only code there is.
   *
   * The guarantee therefore rests on three things a check can hold on to: the dependency
   * can only return data (see {@link WebSearchLookup}), this method is the only caller,
   * and everything it produces goes through `replyWithText` to `msg.groupId`.
   *
   * ── AND WHY THE SOURCES ARE APPENDED, NOT WRITTEN ────────────────────────
   *
   * The model words the answer; the application appends the source list verbatim. D-137
   * settled this once for the moderation warning and the lesson transfers exactly: asked
   * to preserve a fact inside prose it is rewriting, the model corrupts it. A warning that
   * misstates its own count is bad; a source that names the wrong page is worse, because a
   * member can act on it. So the sources are protected text, like the warning and the
   * announcement, and she cannot claim a source she was not given.
   */
  /**
   * Does this lookup earn a holding line at the dials she is set to (CCB-S5-025)?
   *
   * The threshold is a PREDICTION, not a guess, and `lookup-announcement.ts` shows the
   * arithmetic: the wait is dominated by how long her answer takes to WRITE, and the answer's
   * length is bounded by the verbosity dial. So a reply that comes back in two seconds gets
   * no announcement and one that runs to the cap does.
   *
   * The generation rate is MEASURED from her own recent replies rather than shipped, because
   * the two models this repository defaults to are three times apart and production is
   * different hardware again. Web is exempt and always announces: its lookup is a network
   * round trip no dial predicts.
   */
  private lookupAnnouncementDue(kind: LookupKind): boolean {
    // The same default `ollama-reply.ts` applies when no personality is configured, so the
    // projection describes the reply that will actually be written rather than a dial
    // nobody set.
    //
    // The RATE is read from her own recent replies rather than shipped as a constant. Two
    // models this repository defaults to are three times apart, and production is different
    // hardware again, so a constant would be wrong somewhere by construction. Null until the
    // meter has seen enough, which `shouldAnnounce` reads as yes: a process with no readings
    // has just started, and the first reply is the slowest it will ever be.
    return shouldAnnounce(
      kind,
      this.deps.personality?.()?.verbosity ?? 5,
      modelQueue.observedCharsPerSecond(),
    );
  }

  /**
   * One short line saying she is going off to look (CCB-S4-038, D-142).
   *
   * Returns whether it was actually said, because the caller owes the member a closing
   * line only if it was. Never throws and never blocks the search: a holding line that
   * failed to generate is a small loss, and turning it into a reason not to search would
   * be the tail wagging the dog.
   *
   * Worded by the model in her current voice rather than being a persona template, which
   * is the one place this differs from every other fixed line she says. That is deliberate
   * and it is the briefing's point: a canned "let me look that up" repeated every time is
   * exactly the canned-bot register the personality layer exists to remove, and this line
   * is one of the most frequently seen things she will say once search is on. It is
   * dialled, so it varies with sharpness and warmth, and it is bounded far below anything
   * else so it stays a holding line.
   */
  private async announceLookup(
    msg: CapturedMessage,
    s: InteractionSettings,
    lang: string,
    kind: LookupKind,
  ): Promise<boolean> {
    const personalize = this.personalizeForThisBot();
    if (!personalize) return false;

    // ── ASK BEFORE SPEAKING (CCB-S5-025) ──────────────────────────────────────
    //
    // If the ANSWER is going to be dropped by the limiter, the holding line must not go out
    // either: a member left with "give me a second" and nothing after it is worse off than
    // one who waited in silence, which is the failure CCB-S4-038 set out to prevent and, as
    // it turned out, did not. Read-only, so asking costs the answer nothing.
    //
    // This is also the bound on the two new paths. Web search has its own per-member budget
    // behind it; the archive and the knowledge base have none, so without this an uncounted,
    // undroppable message would be unbounded.
    if (
      !this.state.wouldAllowReply(
        msg.groupId,
        msg.senderMemberId,
        this.now(),
        s.replyLimitPerMember,
        s.replyLimitPerChat,
      )
    ) {
      return false;
    }

    let line: string | null = null;
    try {
      line =
        (
          await personalize({
            kind: 'searching',
            lang,
            memberMessage: msg.text,
            // WHERE she is going, as a situation for her to word (CCB-S5-025). The rules
            // own the form; this owns the place and the stance, and the two must agree,
            // which is why the "not in my own head" line moved out of the rules in 055.
            lookupBrief: lookupBrief(kind),
            // No draft. There is nothing the application has decided for her to rephrase:
            // the whole content of this line is "I am going to look", and the words are
            // hers.
            deterministicDraft: '',
            mode: 'searching',
            rules: this.deps.rules?.() ?? [],
            requiredLiterals: [],
            blockedLiterals: [msg.senderDisplayName],
            personality: this.deps.personality?.() ?? null,
            identity: this.facts(s),
            now: { at: new Date(this.now()), timeZone: this.timeZone },
            music: await this.musicPromptFacts(),
          })
        )?.trim() || null;
    } catch (error) {
      log.debug(
        `Lookup: could not word the search announcement (${
          error instanceof Error ? error.message : String(error)
        }).`,
      );
    }

    // RAW STRUCTURED OUTPUT IS NOT A LINE (CCB-S5-025). Observed in a live run at high
    // sharpness: the model answered the knowledge announcement with
    // `{"status":"searching","message":"Access denied. ..."}`, which would have gone to a
    // member as visible JSON. This lane is where it can happen most easily, because it is the
    // only one with an EMPTY deterministic draft, so there is no shape for the model to copy
    // and it sometimes invents the transport's own envelope instead.
    //
    // Treated as nothing rather than repaired: unwrapping it would mean trusting whichever
    // field looked most like prose, and the honest reading of a reply in the wrong format is
    // that the model did not produce a line. Silence is already what this lane does then.
    if (line && /^\s*[[{]/.test(line)) {
      log.debug('Lookup: the model answered the announcement with structured output; ignoring it.');
      line = null;
    }

    // NO FALLBACK LINE. If the model cannot speak, she says nothing and the answer arrives
    // when it arrives. A deterministic "let me look that up" would be the canned sentence
    // this whole feature was written to avoid, and it would be the version members saw
    // every time the model was busy.
    if (!line) return false;

    // UNCOUNTED as well as undroppable, which is what the call site's comment always meant
    // and what the code did not do until CCB-S5-025. A lookup costs exactly one unit of a
    // member's allowance: the answer's. The gate above is what keeps that from being a hole.
    return this.replyWithText(msg, s, lang, line, 'lookup', {
      bypassLimit: true,
      uncounted: true,
    });
  }

  private async answerLookup(
    msg: CapturedMessage,
    s: InteractionSettings,
    lang: string,
    slots: { query?: string },
    instruction: string,
  ): Promise<boolean> {
    const search = this.deps.webSearch?.() ?? null;
    if (!search || !search.available()) {
      // The plugin is off or has no key. LOOKUP should not be in the active catalog at
      // all in that case, so this is the second line of defence, and it is honest rather
      // than silent: she says she could not look it up.
      await this.reply(msg, s, lang, 'searchUnavailable', {});
      return true;
    }

    // The query is the member's own words with the trigger phrase removed where the
    // resolver supplied one. It is passed to the provider and to nothing else.
    const query = (slots.query ?? instruction).trim();
    if (!query) {
      await this.reply(msg, s, lang, 'notUnderstood', {});
      return true;
    }

    // ── THE PRE-SEARCH GATE (CCB-S4-042, D-145) ─────────────────────────────
    //
    // BEFORE the announcement and before the provider, which is the whole point. Until
    // this existed the only thing in the system able to refuse was the model, and the
    // model does not see the request until after the search has run. So a request she
    // would refuse still cost an outbound call, still spent the member's search budget,
    // still pulled a stranger's result set into her prompt, and still shipped the domains
    // in an attribution line. She said "Not happening." and the next message read
    // `From the web: xnxx.com, pornhub.com, ...`.
    //
    // Nothing here reaches the provider. No announcement either: announcing a search she
    // is not going to run would be the one thing `announceLookup` is documented never to
    // do.
    //
    // The gate is deterministic and its limits are real; `lookup-gate.ts` states them.
    // It is a floor under the model's own refusal, not a replacement for it.
    const screen = screenLookup(query);
    if (screen.refused) {
      // The category and the matched term go to the operator's log and nowhere near the
      // member: naming the term back to them is a hint about what got through.
      log.info(
        `Lookup: refused before searching (${screen.category}) for member ${msg.senderMemberId}.`,
      );
      search.noteRefusedBeforeSearch?.(screen.category ?? 'unknown');
      // THE RECORD (CCB-S4-050). Written here because here is where a rule actually decided
      // something: the gate refused before any provider was contacted, and the ceiling is what
      // it was holding. An unmapped category records nothing rather than picking a plausible
      // rule, which is the same silence a model-side refusal gets.
      await this.noteInvocation(
        msg,
        preSearchRuleFor(screen.category ?? null),
        'pre-search',
        screen.category ?? null,
      );
      await this.reply(msg, s, lang, 'searchRefused', {});
      return true;
    }

    // ── THE HOLDING LINE (CCB-S4-038, D-142) ────────────────────────────────
    //
    // EMITTED HERE AND NOWHERE ELSE, which is what makes it honest. Everything that could
    // stop a search from happening has already happened: the plugin is on, a provider is
    // configured, and there is a query. The next statement is the search. So a member who
    // sees this line is a member whose search is genuinely running, and she never says
    // she is looking something up when she is not.
    //
    // It is deliberately NOT before the availability check. That branch has its own honest
    // line and announcing first would mean saying "let me look that up" and then
    // immediately saying she could not, which is worse than the silence it replaced.
    //
    // ── THE RATE LIMIT, AND HOW IT IS HANDLED ───────────────────────────────
    //
    // One lookup now produces two messages, and the briefing asks that this must not
    // silently eat a member's whole allowance. It does not, because the announcement
    // BYPASSES the reply limiter and the answer does not. So a lookup costs exactly one
    // unit of allowance, the same as any other reply, and the thing that is exempt is the
    // one that carries no information.
    //
    // That exemption cannot be used to flood, and the reason is structural rather than a
    // promise: an announcement only exists when a search fires, and searches are governed
    // by their own per-member and per-chat budget (5 and 20 per ten minutes by default),
    // which is tighter than the reply limiter it is bypassing. The search budget is the
    // real limit on how many of these a member can cause.
    //
    // The alternative, letting it count, was rejected on the failure it produces: the
    // announcement goes out, consumes the last of the allowance, and the ANSWER is the
    // message that gets dropped. A member left with "let me look that up" and nothing
    // else is worse off than one who waited in silence.
    await this.announceLookup(msg, s, lang, 'web');

    const outcome = await search.search(query, {
      groupId: msg.groupId,
      memberId: msg.senderMemberId,
      // Whose budget this comes out of (CCB-S5-021). Absent in a harness that builds an
      // engine with no bot, which spends against one shared key, as it did before.
      ...(typeof this.deps.botProfileId === 'number'
        ? { botProfileId: this.deps.botProfileId }
        : {}),
    });

    if (outcome.kind === 'failed') {
      // EVERY failure says the same honest thing, and none of them falls through to
      // answering from training data. That fallback is the one this feature exists to
      // prevent: an answer that sounds current and is two years old is worse than no
      // answer, because nobody can tell.
      //
      // CLOSING THE LOOP (CCB-S4-038). Having said she was going off to look, she owes the
      // member the outcome even when the outcome is nothing: an announcement left hanging
      // is the silence this feature exists to remove, with an extra message in front of
      // it. `searchEmpty` is the line for a search that RAN and found nothing, which is a
      // different fact from one that could not run at all, and she says the right one.
      log.debug(`Lookup: search failed (${outcome.failure}: ${outcome.detail}).`);
      // WHICH LINE, and it is decided by what actually happened rather than by whether
      // she had already spoken. The first version keyed on `announced`, so a search that
      // was rate-limited AFTER the announcement said "looked, and came back with nothing".
      // She had not looked. The announcement being out is a reason to say something, never
      // a reason to say the wrong thing, and the loop closes either way because some line
      // follows it.
      //
      // `no-results` is the only failure where a search genuinely ran and found nothing.
      // Every other one, rate-limited, timed out, provider down, is her not having looked.
      //
      // ── AND TWO WHERE SHE LOOKED AND FOUND THE WRONG THING (CCB-S5-028) ───
      //
      // `nothing-relevant` is the failure the whole briefing is about: results came back,
      // every one of them fell below the relevance floor, and the old code had no way to
      // express that because there was no floor. It is NOT `searchEmpty`: she did not come
      // back empty-handed, she came back with somebody else's subject, and the line says so.
      //
      // `unjudged` is the third fact: she found things and could not check them. Collapsing
      // it into either of the others would be a small untruth, and this is the one path where
      // a small untruth is the entire defect.
      //
      // THE LINE IS THE APPLICATION'S IN ALL THREE CASES, and that is the structural half of
      // the fix. The model is never called, so there is nothing here to be argued into an
      // answer it does not have, nothing to invent a provenance for, and no `webResults` for
      // a source line to be built from. Below the bar, she is given nothing and says so.
      const line =
        outcome.failure === 'no-results'
          ? 'searchEmpty'
          : outcome.failure === 'nothing-relevant'
            ? 'searchIrrelevant'
            : outcome.failure === 'unjudged'
              ? 'searchUnchecked'
              : 'searchUnavailable';
      await this.reply(msg, s, lang, line, {});
      return true;
    }

    const personalize = this.personalizeForThisBot();
    if (!personalize) {
      await this.reply(msg, s, lang, 'searchUnavailable', {});
      return true;
    }

    // THE RESULTS GO NO FURTHER THAN THIS CALL (CCB-S4-042, D-145). `wordLookupAnswer`
    // owns them; what comes back is the answer and the attribution FOR THAT ANSWER. The
    // composition below therefore has nothing to attribute from, which is the structural
    // half of the fix: the old code held `outcome.results` in scope right through to the
    // send and built the source line out of the fact that a search had happened, so a
    // refusal shipped the domains.
    const answer = await this.wordLookupAnswer(msg, s, lang, personalize, outcome.results);

    // THE SAME CORRECTION, ONE LANE OVER (CCB-S5-031). Every way the search itself can fail
    // returned above, with its own line: no results, nothing above the floor, nothing
    // judgeable, the provider down. Reaching here means results came back and cleared the
    // relevance floor, so `wordLookupAnswer` returning null is the WORDING failing and
    // nothing else. `searchUnavailable` claimed the lookup had failed, which by this point
    // in the function is the one thing that cannot have happened.
    //
    // Fixed in both places rather than only in the one that was reported, because a defect
    // whose reasoning applies twice and is corrected once comes back (D-171).
    if (!answer) {
      await this.reply(msg, s, lang, 'searchNoWords', {});
      return true;
    }

    const attribution = answer.sources.length
      ? fillPersona(this.persona(s, lang, 'searchSources'), {
          sources: answer.sources.join(', '),
        })
      : '';

    await this.replyWithText(
      msg,
      s,
      lang,
      attribution ? `${answer.text}\n${attribution}` : answer.text,
      'lookup',
    );
    return true;
  }

  /**
   * Words an answer from search results, and mints the attribution for the ones it used.
   *
   * ── WHY THE SOURCES COME BACK FROM HERE AND ARE NOT COMPUTED AT THE SEND ────
   *
   * Because the old code computed them at the send, from `outcome.results`, and that is
   * the defect. The source line was attached because a SEARCH had happened, not because
   * the ANSWER had used anything, so a refusal ("I don't do that.") was followed by a
   * tidy list of the domains she had just refused to look at. Observed twice, live.
   *
   * The results are a parameter here and a local everywhere else, so the caller cannot
   * build an attribution even by mistake. That is what makes it structural rather than a
   * condition somebody has to remember.
   *
   * ── HOW "USED" IS DECIDED, AND WHY IT FAILS CLOSED ──────────────────────────
   *
   * The model declares it, as indices, through the reply schema. It is the only party
   * that knows whether its own sentence drew on a result, and asking it for indices
   * rather than a yes/no also makes the line ACCURATE instead of merely present: four
   * results fetched and one used now cites one.
   *
   * The declaration cannot be trusted to arrive, so nothing depends on it arriving.
   * `used` starts empty and stays empty unless the model both answers and declares; a
   * model that omits the field, an older model, a parse failure, an exception, all end
   * with no attribution. The failure direction is a missing source line, never a source
   * line on a refusal.
   *
   * The APPLICATION still writes the URLs (D-137). The model supplies indices into a list
   * it was given; it never supplies a character of the line a member reads, so it cannot
   * cite a page that was not in the results and cannot mistype one that was.
   */
  private async wordLookupAnswer(
    msg: CapturedMessage,
    s: InteractionSettings,
    lang: string,
    personalize: NonNullable<InteractionDeps['personalize']>,
    results: readonly WebSearchResult[],
  ): Promise<{ text: string; sources: string[] } | null> {
    let used: readonly number[] = [];
    const history = await this.recentHistory(msg, s);
    // The page block is dropped rather than carried: this lane answers a web lookup, so
    // there is nothing under it for a page to be printed beneath. See the note at the free
    // conversation call site for why it is pulled out rather than left unread.
    const { page: _page, ...disclosure } = await this.disclosure(msg, lang);

    let spoken: string | null = null;
    try {
      spoken =
        (
          await personalize({
            kind: 'lookup',
            lang,
            memberMessage: msg.text,
            deterministicDraft: '',
            mode: 'conversation',
            rules: this.deps.rules?.() ?? [],
            // THE COUNTS SURVIVE OR THE REPLY DOES NOT (CCB-S4-048, D-150). The overview
            // states how many laws she has, and D-137 settled that a number a model is
            // asked to preserve inside its own prose is a number it will smooth. A reply
            // that loses one is rejected here and the deterministic answer goes out
            // instead, which is the right direction to fail in.
            requiredLiterals: overviewLiterals(disclosure.ruleOverview),
            blockedLiterals: [msg.senderDisplayName],
            personality: this.deps.personality?.() ?? null,
            identity: this.facts(s),
            now: { at: new Date(this.now()), timeZone: this.timeZone },
            music: await this.musicPromptFacts(),
            // The untrusted material. Fenced and labelled by `systemPrompt`; see the
            // field's own documentation for why it rides in the user message.
            webResults: results,
            // The room she is standing in (CCB-S4-044). A lookup is still a conversation:
            // "and what about the other one" only means anything with the thread in view.
            history: toPromptHistory(history, HISTORY_FENCE),
            historyWindowMinutes: s.memory.windowMinutes,
            ...disclosure,
            onSourcesUsed: (indices) => {
              used = indices;
            },
          })
        )?.trim() || null;
    } catch (error) {
      log.debug(
        `Lookup: wording the results failed (${
          error instanceof Error ? error.message : String(error)
        }).`,
      );
    }

    if (!spoken) return null;

    return { text: spoken, sources: attributionFor(results, used) };
  }

  /**
   * The MUSIC lane (CCB-S5-044): four asks, parsed deterministically HERE, so
   * what the member gets never depends on a model reading the sub-question.
   * A successful play sends NO reply line: the track arriving is the reply,
   * and a confirmation sentence on top of it would be noise.
   */
  /** The last list she showed per group; see MusicListContext. */
  private readonly musicLists = new Map<number, MusicListContext>();

  /** The DJ facts for the prompt, cached briefly: counts change slowly and every
   * conversational reply would otherwise pay three queries for them. */
  private musicFactsCache: { at: number; facts: MusicPromptFacts } | null = null;

  /**
   * The music facts as the PROMPT receives them (D-218, the clock's contract):
   * undefined when the plugin is off for this bot, so the has-music rules are
   * simply not in its prompt; the numbers otherwise, derived and cacheable.
   */
  private async musicPromptFacts(): Promise<MusicPromptFacts | undefined> {
    const music = this.deps.music?.() ?? null;
    if (music === null) return undefined;
    const now = this.now();
    if (this.musicFactsCache !== null && now - this.musicFactsCache.at < 60_000) {
      return this.musicFactsCache.facts;
    }
    try {
      const f = await music.facts();
      const facts = { tracks: f.tracks, genres: f.genres.map((g) => g.name), playlists: f.playlists };
      this.musicFactsCache = { at: now, facts };
      return facts;
    } catch (error) {
      // A library that cannot be counted is a fault worth logging, and a prompt
      // that says nothing about music - never one that guesses.
      log.warn(`music: prompt facts unavailable (${String(error)}); the prompt stays silent about the library.`);
      return undefined;
    }
  }

  /**
   * Does an UNCLAIMED message belong to the music lane anyway (D-221)?
   * True for a short affirmative while a genre card is live, and for a
   * have-ask naming a genre or playlist she actually holds. Both are
   * deterministic predicates over the text and her own data; a failure to
   * answer is a false and stays in conversation.
   */
  private async unclaimedMusicAsk(msg: CapturedMessage, instruction: string): Promise<boolean> {
    const music = this.deps.music?.() ?? null;
    if (music === null) return false;
    const text = instruction.toLowerCase().trim();
    const live = this.musicLists.get(msg.groupId);
    if (
      live !== undefined && live.expiresAt > this.now() &&
      live.kind === 'genre' && MUSIC_AFFIRMATIVE.test(text)
    ) {
      return true;
    }
    if (MUSIC_NEXT_HOOK.test(text)) return true;
    try {
      const nextNamed = MUSIC_NEXT_BARE.exec(text);
      const rest = nextNamed?.[1]?.trim() ?? '';
      if (!MUSIC_HAVE_ASK.test(text) && (nextNamed === null || rest === '')) return false;
      const subject = rest !== '' ? rest : text;
      const facts = await this.musicPromptFacts();
      if (facts !== undefined && facts.genres.some((g) => musicNamesWord(subject, g))) return true;
      if (nextNamed !== null && rest !== '') {
        const view = await music.view();
        return view.playlists.some((pl) => musicNamesWord(rest, pl.name));
      }
      if (!MUSIC_HAVE_ASK.test(text)) return false;
      const view = await music.view();
      return view.playlists.some((pl) => musicNamesWord(text, pl.name));
    } catch {
      return false;
    }
  }

  /**
   * The MUSIC lane (CCB-S5-044, reworked after first use): four asks parsed
   * deterministically, every list NUMBERED, a number or a name accepted at
   * every step, and - the behaviour fault this rework exists for - ONLY AN
   * EXPLICIT PLAY PLAYS. The first build's tail treated any MUSIC claim with
   * no parsable ask as "play me something", so asking WHICH track was on the
   * list played one; the probe showed a lone keyword ('track', 'song') reaches
   * this handler, which is fine for answering and was disastrous for playing.
   * The tail is now the locked overview: what she holds and how to ask.
   * A successful play still sends NO text line - the track is the reply.
   */
  /**
   * D-222: a play that throws must not leave the member staring at silence.
   * The fault reaches the log AND the dashboard, and the member gets the
   * honest unavailable line, exempt from the limiter like every music reply.
   */
  private async answerMusicSafely(
    msg: CapturedMessage,
    s: InteractionSettings,
    lang: string,
    instruction: string,
  ): Promise<boolean> {
    try {
      return await this.answerMusic(msg, s, lang, instruction);
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      log.error(`music: the lane failed answering group ${String(msg.groupId)}: ${detail}`);
      status.error(`Music: answering a member in group ${String(msg.groupId)} failed: ${detail}`);
      try {
        await this.reply(msg, s, lang, 'musicUnavailable', {}, MUSIC_REPLY);
      } catch {
        // The reply path's own failure already logged and surfaced in sendReply.
      }
      return true;
    }
  }

  private async answerMusic(
    msg: CapturedMessage,
    s: InteractionSettings,
    lang: string,
    instruction: string,
  ): Promise<boolean> {
    const music = this.deps.music?.() ?? null;
    if (music === null) {
      await this.reply(msg, s, lang, 'musicUnavailable', {}, MUSIC_REPLY);
      return true;
    }
    const text = instruction.toLowerCase().trim();
    const now = this.now();
    const context = this.musicLists.get(msg.groupId);
    const live = context !== undefined && context.expiresAt > now ? context : undefined;

    const remember = (ctx: Omit<MusicListContext, 'expiresAt'>): void => {
      this.musicLists.set(msg.groupId, { ...ctx, expiresAt: now + MUSIC_LIST_CONTEXT_MS });
    };
    const playOutcomeReply = async (
      outcome: 'sent' | 'busy' | 'unknown' | 'empty' | 'send-failed' | 'unavailable',
    ): Promise<void> => {
      const key =
        outcome === 'sent'
          ? null
          : outcome === 'busy'
            ? 'musicBusy'
            : outcome === 'unknown'
              ? 'musicUnknownTrack'
              : outcome === 'send-failed'
                ? 'musicSendFailed'
                : outcome === 'empty'
                  ? 'musicNoPlaylists'
                  : 'musicUnavailable';
      if (key !== null) await this.reply(msg, s, lang, key, {}, MUSIC_REPLY);
    };
    const overview = async (): Promise<boolean> => {
      const facts = await music.facts();
      await this.reply(msg, s, lang, 'musicOverview', {
        tracks: facts.tracks,
        genres: facts.genres.length === 0 ? 'no genres yet' : facts.genres.map((g) => g.name).join(', '),
        playlists: facts.playlists,
      }, MUSIC_REPLY);
      return true;
    };
    const listTracksOf = async (nameOrIndex: string): Promise<boolean> => {
      let name = nameOrIndex.trim();
      const index = /^([0-9]{1,3})\.?$/.exec(name);
      if (index !== null) {
        const n = Number(index[1]);
        let fromContext = live?.kind === 'playlists' ? live.playlists?.[n - 1] : undefined;
        if (fromContext === undefined) {
          // No live list in this room? The numbers she prints ARE the view's
          // own order, so the view answers: "playlist 1" means the first she
          // would list, ten minutes later as much as ten seconds (D-220).
          fromContext = (await music.view()).playlists[n - 1]?.name;
        }
        if (fromContext === undefined) {
          await this.reply(msg, s, lang, 'musicUnknownPlaylist', {}, MUSIC_REPLY);
          return true;
        }
        name = fromContext;
      }
      const found = name === '' ? null : await music.tracksOf(name);
      if (found === null) {
        // Not a playlist - but "what's on cyberpunk" may name a GENRE she
        // holds, and answering "no playlist by that name" to her own genre
        // vocabulary is a false statement about her holdings (D-222).
        const genreHit =
          name === ''
            ? undefined
            : (await music.facts()).genres.find((g) => musicNamesWord(name, g.name) || musicSquash(g.name) === musicSquash(name));
        const genreList = genreHit === undefined ? null : await music.tracksOfGenre(genreHit.name);
        if (genreList !== null && genreList.items.length > 0) {
          remember({ kind: 'tracks', tracks: genreList.items });
          const shownG = genreList.items.slice(0, 15).map((t, idx) => `${String(idx + 1)}. ${t.title}`).join(', ');
          const tracksG = genreList.total > 15 ? `${shownG}, and ${String(genreList.total - 15)} more` : shownG;
          await this.reply(msg, s, lang, 'musicGenreTracks', { genre: genreList.genre, tracks: tracksG }, MUSIC_REPLY);
          return true;
        }
        await this.reply(msg, s, lang, 'musicUnknownPlaylist', {}, MUSIC_REPLY);
        return true;
      }
      remember({ kind: 'tracks', tracks: found.items });
      const shown = found.items.slice(0, 15).map((t, idx) => `${String(idx + 1)}. ${t.title}`).join(', ');
      const tracks = found.total > 15 ? `${shown}, and ${String(found.total - 15)} more` : shown;
      await this.reply(msg, s, lang, 'musicTracks', { playlist: found.playlist, tracks }, MUSIC_REPLY);
      return true;
    };

    // 4b first: "make it playable" must not read as a title.
    if (/(playable|abspielbar)/.test(text)) {
      const outcome = await music.playUpload(msg.groupId, msg.senderMemberId);
      // The bound in her refusal is read LIVE, so the operator raising it on
      // the console can never make the line stale (the D-162 copy-truth class).
      const limitMb = `${String(Math.round(music.uploadLimitBytes() / (1024 * 1024)))} MB`;
      const key =
        outcome === 'sent'
          ? null
          : outcome === 'busy'
            ? 'musicBusy'
            : outcome === 'not-audio'
              ? 'musicUploadNotAudio'
              : outcome === 'too-large'
                ? 'musicUploadTooLarge'
                : outcome === 'no-file'
                  ? 'musicUploadNoFile'
                  : outcome === 'off'
                    ? 'musicUploadOff'
                    : 'musicUnavailable';
      if (key !== null) {
        await this.reply(msg, s, lang, key, key === 'musicUploadTooLarge' ? { limit: limitMb } : {}, MUSIC_REPLY);
      }
      return true;
    }

    // "which playlists" and friends.
    if (/playlist/.test(text) && !/^(play|spiel)/.test(text)) {
      const on = /(?:what(?:'?s| is)? (?:on|in)|was (?:ist|liegt) (?:auf|in))\s+(.+)$/.exec(text);
      if (on !== null) {
        const name = (on[1] ?? '').replace(/["'?.!]/g, '').replace(/\bplaylist\b/g, '').trim();
        return await listTracksOf(name);
      }
      // The second level, in the words the live test actually used (D-220):
      // "Show me tracks from playlist 1" listed the playlists AGAIN, because
      // only "what's on ..." was understood and no operator will guess that.
      // Tracks-of, show-me and the bare "playlist N" all reach the listing.
      const tracksOf =
        /(?:tracks?|titles?|songs?|titel|lieder|stuecke)\s+(?:from|of|on|in|aus|von|auf)\s+(.+)$/.exec(text) ??
        /(?:show|list|zeig|zeige|liste)\w*\s+(?:me\s+|mir\s+|uns\s+)?(?:the\s+|die\s+|das\s+)?playlists?\s+(.+)$/.exec(text) ??
        /^playlists?\s+([0-9]{1,3})\s*\??$/.exec(text);
      if (tracksOf !== null) {
        const name = (tracksOf[1] ?? '')
          .replace(/["'?.!]/g, '')
          .replace(/\bplaylists?\b/g, '')
          .replace(/\b(?:the|der|die|das)\b/g, '')
          .trim();
        return await listTracksOf(name);
      }
      const view = await music.view();
      if (view.playlists.length === 0) {
        await this.reply(msg, s, lang, 'musicNoPlaylists', {}, MUSIC_REPLY);
        return true;
      }
      remember({ kind: 'playlists', playlists: view.playlists.map((pl) => pl.name) });
      const playlists = view.playlists
        .map((pl, idx) => `${String(idx + 1)}. ${pl.name} (${String(pl.trackCount)})`)
        .join(', ');
      await this.reply(msg, s, lang, 'musicPlaylists', { playlists }, MUSIC_REPLY);
      return true;
    }

    // "what's on X" - a name or a number, playlist word optional.
    const onBare = /(?:what(?:'?s| is)? on|was (?:ist|liegt) auf)\s+(.+)$/.exec(text);
    if (onBare !== null) {
      const name = (onBare[1] ?? '').replace(/["'?.!]/g, '').replace(/^(?:der|die|das|the)\s+/, '').trim();
      // "the list" with a live tracks context re-shows it; otherwise it is a
      // playlist reference and answers as one, honestly when unknown - it no
      // longer falls through to anything that could play.
      return await listTracksOf(name);
    }

    // "next" / "another one" / "next chillstep song" (D-222): the two most
    // natural things anyone says after a track ends. A named source wins;
    // otherwise she continues from this room's last play; a room where
    // nothing has played yet is told so honestly.
    const playNextFrom = async (rest: string, fallthrough: boolean): Promise<boolean | null> => {
      const named = rest.trim();
      if (named !== '') {
        const f = await music.facts();
        const g = f.genres.find((x) => musicNamesWord(named, x.name));
        if (g !== undefined) {
          await playOutcomeReply(await music.playByGenre(msg.groupId, g.name));
          return true;
        }
        const v = await music.view();
        const pl = v.playlists.find((x) => musicNamesWord(named, x.name));
        if (pl !== undefined) {
          await playOutcomeReply(await music.playFromPlaylist(msg.groupId, pl.name));
          return true;
        }
        // Named something that is neither genre nor playlist: the caller
        // decides - the play branch falls through to the title ladder
        // ("play one more time" is a TITLE), the bare form answers honestly.
        if (fallthrough) return null;
        await this.reply(msg, s, lang, 'musicNotHeld', {}, MUSIC_REPLY);
        return true;
      }
      const out = await music.playNext(msg.groupId);
      if (out === 'empty') {
        await this.reply(msg, s, lang, 'musicNothingToFollow', {}, MUSIC_REPLY);
        return true;
      }
      await playOutcomeReply(out);
      return true;
    };
    const bareNext = MUSIC_NEXT_BARE.exec(text);
    if (bareNext !== null) {
      const handled = await playNextFrom(bareNext[1] ?? '', false);
      if (handled !== null) return handled;
    }

    // "play ..." - ONLY here does anything play.
    const play = /^(?:play|spiele?)\s+(?:me\s+|mir\s+|us\s+|uns\s+)?(.+)$/.exec(text);
    if (play !== null) {
      const arg = (play[1] ?? '').replace(/["'?.!]/g, '').trim();
      if (/^(something|anything|etwas|irgendwas|irgendetwas|a song|ein lied|music|musik)\b/.test(arg)) {
        await playOutcomeReply(await music.playSomething(msg.groupId));
        return true;
      }
      const index = /^(?:number |nummer |track |titel )?([0-9]{1,3})\.?$/.exec(arg);
      if (index !== null) {
        const n = Number(index[1]);
        if (live?.kind === 'tracks') {
          const item = live.tracks?.[n - 1];
          if (item === undefined) {
            await this.reply(msg, s, lang, 'musicUnknownTrack', {}, MUSIC_REPLY);
            return true;
          }
          await playOutcomeReply(await music.playById(msg.groupId, item.id));
          return true;
        }
        if (live?.kind === 'playlists') {
          const name = live.playlists?.[n - 1];
          if (name === undefined) {
            await this.reply(msg, s, lang, 'musicUnknownPlaylist', {});
            return true;
          }
          await playOutcomeReply(await music.playFromPlaylist(msg.groupId, name));
          return true;
        }
        // A bare number with nothing listed recently means nothing.
        await this.reply(msg, s, lang, 'musicUnknownTrack', {}, MUSIC_REPLY);
        return true;
      }
      const nextArg = MUSIC_NEXT_ARG.exec(arg);
      if (nextArg !== null) {
        const handled = await playNextFrom(nextArg[1] ?? '', true);
        if (handled !== null) return handled;
      }

      // THE LADDER (D-220, from the live test): "play Chillstep" named a
      // playlist and a genre she holds and was answered "no track by that
      // name"; "play Aurora Night - Alusion for us" named an exact title in a
      // member's own words - title, dash, artist, courtesy - and missed too,
      // because one exact-title lookup was the whole search. Most specific
      // rung first, every rung inside the playlist boundary (the store scopes
      // each one through the assignments), and the honest unknown only when
      // every rung misses. 'busy' and 'unavailable' STOP the ladder: the
      // thing was found and could not go out, and saying otherwise would lie.
      const courtesy = /\s+(?:for\s+(?:us|me|the\s+room)|fuer\s+(?:uns|mich)|f\u00fcr\s+(?:uns|mich)|please|bitte)\s*$/i;
      let bare = arg;
      for (let pass = 0; pass < 3 && courtesy.test(bare); pass++) bare = bare.replace(courtesy, '').trim();
      // BOTH dash halves (D-222): members write "Title - Artist" and
      // "Artist - Title" in equal ignorance of the tags, and the live test's
      // miss was an artist on the left.
      const dashedL = bare.includes(' - ') ? (bare.split(' - ')[0] ?? '').trim() : '';
      const dashedR = bare.includes(' - ') ? (bare.split(' - ')[1] ?? '').trim() : '';
      const rungs = [...new Set([arg, bare, dashedL, dashedR].filter((c) => c !== ''))];
      for (const c of rungs) {
        const outcome = await music.playByTitle(msg.groupId, c);
        if (outcome !== 'unknown') { await playOutcomeReply(outcome); return true; }
      }
      for (const c of rungs) {
        const outcome = await music.playByArtist(msg.groupId, c);
        if (outcome !== 'empty') { await playOutcomeReply(outcome); return true; }
      }
      for (const c of rungs) {
        const outcome = await music.playFromPlaylist(msg.groupId, c);
        if (outcome !== 'empty') { await playOutcomeReply(outcome); return true; }
      }
      for (const c of rungs) {
        const outcome = await music.playByGenre(msg.groupId, c);
        if (outcome !== 'empty') { await playOutcomeReply(outcome); return true; }
      }
      await playOutcomeReply('unknown');
      return true;
    }

    // ── PER-QUESTION ANSWERS (D-221) ────────────────────────────────────────
    //
    // He asked about ONE genre and received an inventory. The tail answers
    // the question that was asked: a standing offer taken by a short
    // affirmative plays; a named genre gets its own card with its own count;
    // a named playlist gets its listing; a have-ask naming nothing she holds
    // gets an echo-free honest miss; and only a question that names NOTHING
    // gets the general overview. Every number in every card is the
    // application's - the model may open the line (AI_LOCKED_KEYS) and can
    // contradict nothing - and nothing down here can start a transfer except
    // the affirmative, which is a member taking an offer she just made.
    if (live?.kind === 'genre' && live.genre !== undefined && MUSIC_AFFIRMATIVE.test(text)) {
      this.musicLists.delete(msg.groupId);
      await playOutcomeReply(await music.playByGenre(msg.groupId, live.genre));
      return true;
    }
    const facts = await music.facts();
    const asked = facts.genres.filter((g) => musicNamesWord(text, g.name));
    if (asked.length === 1 && asked[0] !== undefined) {
      remember({ kind: 'genre', genre: asked[0].name });
      await this.reply(msg, s, lang, 'musicGenreYes', {
        genre: asked[0].name,
        tracks: trackCountPhrase(asked[0].count, lang),
      }, MUSIC_REPLY);
      return true;
    }
    if (asked.length > 1) {
      const list = asked
        .map((g) => `${g.name} (${trackCountPhrase(g.count, lang)})`)
        .join(', ');
      await this.reply(msg, s, lang, 'musicGenresSome', { list }, MUSIC_REPLY);
      return true;
    }
    const askedList = (await music.view()).playlists.find((pl) => musicNamesWord(text, pl.name));
    if (askedList !== undefined) return await listTracksOf(askedList.name);
    if (MUSIC_HAVE_ASK.test(text)) {
      // "what music do you have?" wears the have-phrase and names NOTHING: it
      // is the general question and gets the overview. A leftover non-generic
      // word is a subject she does not hold, answered by the echo-free miss
      // (the searchResult lesson: an echoed phrase becomes publishable the
      // day its category is switched on).
      const leftovers = text
        .replace(MUSIC_HAVE_ASK, ' ')
        .split(/[^\p{L}\p{N}]+/u)
        .filter((t) => t.length > 0);
      if (leftovers.every((t) => MUSIC_GENERIC_WORDS.has(t))) return await overview();
      await this.reply(msg, s, lang, 'musicNotHeld', {}, MUSIC_REPLY);
      return true;
    }
    return await overview();
  }

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
    const prices = this.deps.prices?.() ?? null;
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
    const prices = this.deps.prices?.() ?? null;
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
          intents: this.deps.capabilities(),
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

    // Moderation (CCB-S4-032, CCB-S4-033). Counted BEFORE the anti-spam check would have
    // mattered and after it has passed, so the count reflects nicknames she actually
    // answered. Both ladders run from the same count: the verbal one sharpens her, and
    // the enforcement one may hand back a WARNING to say, while still acting on nothing.
    const ladders = await this.moderate(msg, s, lang, 'nickname', now);

    const list = this.retorts(s, lang);
    const index = this.state.pickRetort(msg.groupId, list.length, this.random);
    const retort = index >= 0 ? list[index] : undefined;

    // ── AN EMPTY LIST MUST NOT SWALLOW THE LADDER (CCB-S5-009, CCB-S3-023) ────
    //
    // The whole send used to sit inside `if (retort)`. A bot whose retorts an operator had
    // emptied therefore counted the violation, escalated the ladder, BUILT the warning that
    // tells the member they are being counted, and then discarded it with the retort it had
    // no room to attach to. Silence to the member, a climbing counter in the console, and
    // nothing anywhere saying the two had come apart: a degraded function running quietly,
    // which is the one thing the standing rule forbids.
    //
    // The warning is protected text and needs no retort to carry it, so it goes on its own.
    // Emptying the retorts is a real choice and stays one; losing the ladder was never part
    // of that choice.
    if (!retort && (ladders.warning || ladders.announcement)) {
      const alone = [ladders.warning, ladders.announcement]
        .filter((part): part is string => part !== null && part !== '')
        .join('\n');
      log.info(
        `Interaction: no retort configured for this bot, sending the moderation warning ` +
          `alone (member ${msg.senderMemberId}, chat ${msg.groupId}).`,
      );
      await this.sendReply(
        msg,
        s,
        { text: alone, quote: false },
        { openWindow: false },
        {
          category: 'nickname',
          lang,
          mentions: [],
          replyTo: { groupId: msg.groupId, itemId: msg.itemId },
        },
      );
      return true;
    }

    if (retort) {
      // Retorts name her, and her name is whatever the operator configured. They
      // never went through placeholder substitution, so a renamed bot insisted on
      // a name that was not its own (CCB-S3-031 follow-up).
      const named = retort.split('{wake}').join(s.wakeWord);
      // ── WHAT THE RETORT SAYS versus WHAT THE WARNING ADDS (CCB-S4-033) ──────
      //
      // The retort is the operator's, from their list, and says one thing: that is not
      // my name. The warning is the ladder's, and adds what the retort cannot know: that
      // this is being counted, which one of how many it is, and that continuing
      // escalates. They travel as ONE message, because two sends for one nickname is
      // noise, and the warning goes second so the snub still lands first.
      //
      // ── AND WHY THE WARNING IS PROTECTED TEXT ───────────────────────────────
      //
      // The model words the RETORT and never the warning. That was not the first design:
      // the warning went into the draft with an instruction to keep its numbers exactly,
      // and qwen3.5:9b was measured returning "warning 1 of 3" for the third warning. A
      // warning that misstates its own count is worse than one carrying no count, and
      // that number is the entire reason the count became a setting.
      //
      // So this follows the `locked` pattern the codebase already uses for prices and
      // totals: the model writes the voiced part, the application appends the protected
      // part verbatim. The message is still at the sharpness the ladder has reached; the
      // one sentence that states a fact is simply not up for rewording.
      //
      // CCB-S4-031 gap 1. This was `free` mode, which carries no personality, so the
      // most-seen line she says arrived in the generic voice while everything else was
      // dialled. `retort` keeps the operator's retort as the CONTENT and puts her voice
      // on it: at sharpness 10 it cuts, at 1 it is gentle, and the ceiling comes along.
      // Ladder A, live (CCB-S4-032). Repetition raises the sharpness dial above the
      // operator's base and the sum is capped at the axis maximum. This is tone and
      // nothing else: a sharper sentence harms nobody, which is why it ships live while
      // the enforcement ladder only watches.
      const voiced = await this.personalizedBody(msg, lang, 'nickname', named, 'retort', [], {
        personality: sharpenBy(this.deps.personality?.() ?? null, ladders.sharpnessBonus),
        identity: this.facts(s),
      });
      // Warning then announcement, both protected text, both after the voiced retort.
      // They are mutually exclusive in practice, since a rung is either the warn rung or a
      // harder one, but this does not rely on that: if a ladder ever produced both,
      // sending both is the honest outcome.
      const personalized = [voiced, ladders.warning, ladders.announcement]
        .filter((part): part is string => part !== null && part !== '')
        .join('\n');
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

  /**
   * Does this bot answer a command addressed to nobody, here (CCB-S5-027, D-182)?
   *
   * Defaults to yes when nothing was injected. See the dependency's own documentation: a
   * deployment or a harness that knows nothing about co-tenancy is one where there is none.
   */
  private answersGroupCommands(groupId: number): boolean {
    return this.deps.answersGroupCommands?.(groupId) ?? true;
  }

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
  /**
   * Count the violation and run both ladders (CCB-S4-032, D-136).
   *
   * ── THE NO-ACT GUARANTEE, STRUCTURALLY ──────────────────────────────────────
   *
   * This method returns a number and writes two rows. It cannot change a role, block a
   * member or remove one, and neither can anything it calls: `InteractionDeps` carries
   * exactly one outbound capability, `send`, which puts text in a chat. There is no
   * dependency here through which an enforcement action could reach the SDK even if
   * something tried. That is why the guarantee is worth more than a mode flag would be.
   *
   * The enforcement rung is computed and recorded as `observed`, which is the only mode
   * this briefing writes. The operator tunes thresholds against real traffic from the
   * log; arming is a separate briefing on purpose.
   *
   * ── THE MODEL IS NOWHERE IN THIS METHOD ─────────────────────────────────────
   *
   * The count comes from a SQL `count(*)`, the rungs are integer comparisons, and the
   * decision is a loop. No model output is read to pick a step. She may later SAY
   * something about a step in her own voice; she does not choose one. Otherwise a
   * member could talk her into sanctioning somebody, which is the injection the consent
   * gate already exists to refuse.
   *
   * Failure here is contained: moderation must never stop her from replying, so a
   * database problem is logged and the retort goes out unsharpened.
   */
  /**
   * `personalize`, with this bot's id stamped on every request (CCB-S5-001).
   *
   * Wrapped once here rather than added at the six call sites that build a request: a
   * seventh call site added later would silently report its model calls as belonging to
   * no bot, and the queue page would quietly under-count whichever bot the new path
   * served. The id is telemetry only - it reaches the meter and never the prompt.
   */
  private personalizeForThisBot():
    | ((request: AiReplyRequest) => Promise<string | null>)
    | undefined {
    const inner = this.deps.personalize;
    if (!inner) return undefined;
    return (request) =>
      inner({
        botProfileId: this.deps.botProfileId ?? null,
        ...request,
        // AFTER the spread, deliberately, and unlike `botProfileId` above it (CCB-S5-027).
        // This is the one path every model call in this engine takes, so setting it here
        // covers conversation, lookup, retort, help, the scene and the recital transitions
        // at once; putting it after the spread means no lane can drop it by passing its own
        // value, which is what makes "every reply is guarded" a property of this function
        // rather than of six call sites remembering.
        protectedMarkers: this.protectedMarkers(),
      });
  }

  /**
   * The openings of the lines the APPLICATION writes for this bot (CCB-S5-027, D-180).
   *
   * EVERY LANGUAGE in the persona, not just the reply language. What taught her the format
   * was her own thread, and a group that switched languages last week still contains last
   * week's lines; a German reply can perfectly well carry a forged English source line
   * copied out of a message she sent before the switch.
   *
   * Read live rather than held, like the persona everywhere else, so an operator who
   * rewords a line rewords its guard on the next reply rather than on the next boot.
   */
  private protectedMarkers(): string[] {
    const templates: string[] = [];
    try {
      const s = this.deps.settings();
      for (const strings of Object.values(s.persona)) {
        for (const value of Object.values(strings as Record<string, string>)) {
          if (typeof value === 'string') templates.push(value);
        }
      }
    } catch (error) {
      // NOT swallowed into an empty guard silently. Settings that cannot be read are a
      // fault, and the honest consequence is that this reply goes out unguarded, which the
      // operator has to be able to find in the log.
      log.error(
        `Interaction: could not read the persona to build the protected-line guard, so this ` +
          `reply is unguarded (${error instanceof Error ? error.message : String(error)}).`,
      );
      return [];
    }
    return markersFromTemplates(templates).markers;
  }

  private async moderate(
    msg: CapturedMessage,
    s: InteractionSettings,
    lang: string,
    type: ViolationType,
    now: number,
  ): Promise<{ sharpnessBonus: number; warning: string | null; announcement: string | null }> {
    const rules = this.deps.moderationRules?.() ?? null;
    // No runtime bot means no operator-chosen policy. Running a ladder nobody configured
    // against a real group is the worst available default, so nothing runs.
    if (!rules) return { sharpnessBonus: 0, warning: null, announcement: null };

    const at = new Date(now);
    // The counting scope is PER BOT as well as per member and per chat: the ladders are
    // per bot, so counting across bots would let one bot's threshold fire on messages
    // another bot handled.
    const scope = {
      botProfileId: this.deps.botProfileId ?? null,
      groupId: msg.groupId,
      memberId: msg.senderMemberId,
      type,
    };
    const role = msg.senderRole ?? null;

    try {
      await recordViolation(this.deps.db, {
        botProfileId: this.deps.botProfileId ?? null,
        groupId: msg.groupId,
        memberId: msg.senderMemberId,
        memberDisplayName: msg.senderDisplayName,
        memberRole: role,
        type,
      });

      // Two counts, because the two ladders have their own windows: an operator may
      // want the tone to relax sooner than the enforcement count does.
      const verbalCount = await countViolations(
        this.deps.db,
        scope,
        rules.verbalWindowSeconds,
        at,
      );
      const enforcementCount = await countViolations(
        this.deps.db,
        scope,
        rules.enforcementWindowSeconds,
        at,
      );

      const verbal = evaluateVerbal(verbalCount, role, rules);
      const enforcement = evaluateEnforcement(enforcementCount, role, rules);

      // ── SPEECH IS LIVE, ACTION STAYS OBSERVED (CCB-S4-033, D-137) ──────────
      //
      // A warning changes nothing about anybody's membership. It is a message, of
      // exactly the kind she already sends, so it happens now. Mute, block and remove
      // touch a member's standing and stay recorded-only until the arming briefing.
      // This is the line that makes observation mode comprehensible: she talks, she
      // does not act.
      //
      // The text is a persona string, so an operator owns the wording, and its `{n}`
      // and `{total}` are real: the ladder resolves to warn for exactly `warningCount`
      // violations, so "3 of 5" is a fact rather than a figure of speech.
      let warning: string | null = null;
      if (enforcement.action === 'warn') {
        const position = warningPosition(enforcement.count, rules);
        if (position) {
          warning = fillPersona(this.persona(s, lang, 'moderationWarning'), {
            n: position.number,
            total: position.total,
          });
        }
      }

      let announcement: string | null = null;

      if (enforcement.action !== 'none') {
        const common = {
          botProfileId: this.deps.botProfileId ?? null,
          groupId: msg.groupId,
          memberId: msg.senderMemberId,
          memberDisplayName: msg.senderDisplayName,
          memberRole: role,
          action: enforcement.action,
          violationType: type,
          violationCount: enforcement.count,
          windowSeconds: rules.enforcementWindowSeconds,
          rungThreshold: enforcement.rungThreshold,
          reason: describeRule(
            type,
            enforcement.count,
            rules.enforcementWindowSeconds,
            enforcement.rungThreshold,
          ),
          // The Log has to distinguish a warning she actually said from a rung that was
          // only recorded: one happened in the chat and the other did not.
          spoken: warning !== null,
        };

        // ── THE ARMING BRANCH (CCB-S4-035, D-139) ───────────────────────────
        //
        // BOTH CONDITIONS, and neither is redundant. The mode is the operator's decision
        // and the port is the runtime's capability, and a deployment can have one without
        // the other: the admin console runs with no bot, and every harness written before
        // this briefing passes no port at all. Requiring both means the default for
        // anything that has not deliberately been armed AND wired is still to observe.
        //
        // The deterministic decision is UNCHANGED by any of this. `evaluateEnforcement`
        // ran above and picked the rung; this only decides whether the rung happens. D-136
        // holds exactly as written: the model never chooses a step, and arming changes
        // what follows the decision, never who makes it.
        const port = rules.mode === 'enforce' ? (this.deps.enforcementPort?.() ?? null) : null;

        if (port) {
          const outcome = await applySanction(
            this.deps.db,
            port,
            {
              ...common,
              groupMemberId: msg.senderGroupMemberId ?? null,
              durationSeconds: enforcement.durationSeconds,
            },
            at,
          );

          // ANNOUNCED ONLY WHEN IT ACTUALLY HAPPENED. A step that was refused or failed
          // must not be announced: telling a group somebody was muted when they were not
          // is the chat-facing version of the false row the schema already refuses.
          if (
            outcome.status === 'applied' &&
            rules.announce &&
            enforcement.action !== 'warn'
          ) {
            // Protected text, appended verbatim, for the reason D-137 records: asked to
            // reword a sentence containing its own count, a 9B model was measured
            // corrupting the number. A duration is the same class of fact as a count.
            announcement = fillPersona(this.persona(s, lang, 'moderationAction'), {
              action: enforcement.action,
              duration:
                enforcement.durationSeconds > 0
                  ? ` for ${Math.round(enforcement.durationSeconds / 60)} minute(s)`
                  : '',
            });
          }

          // BOOKED IMMEDIATELY, and only for a mute that actually applied and carries a
          // deadline. A mute with no expiry job is permanent, so this is the line between
          // a timed sanction and a silent life sentence. It is deliberately not inside
          // `applySanction`: that function's contract is act-then-record, and reaching a
          // queue from it would give the moderation tree a second capability it does not
          // need to have.
          if (outcome.status === 'applied' && outcome.expiresAt !== null) {
            try {
              await this.deps.scheduleUnmute?.(outcome.sanctionId, new Date(outcome.expiresAt));
            } catch (error) {
              // Surfaced, never swallowed. The mute stands and the member is muted; what
              // failed is the promise to lift it, and the operator has to know that.
              log.error(
                `Moderation: a mute was applied but its expiry could not be booked, so it ` +
                  `will show as overdue until it is lifted by hand (${
                    error instanceof Error ? error.message : String(error)
                  }).`,
              );
              status.error(
                `Moderation: a mute was applied but its automatic expiry could not be ` +
                  `scheduled. Lift it from the Active page when it is due.`,
              );
            }
          }

          log.info('Moderation enforced a step', {
            action: enforcement.action,
            count: enforcement.count,
            group: msg.groupId,
            enforced: outcome.status === 'applied',
            announced: announcement !== null,
          });
        } else {
          await recordSanction(this.deps.db, {
            ...common,
            // Observation writes this literal rather than deriving it from `rules.mode`,
            // so a stored 'enforce' with no wired capability records the truth: nothing
            // happened, because nothing could.
            mode: 'observed',
          });
          log.info('Moderation observed a step', {
            action: enforcement.action,
            count: enforcement.count,
            group: msg.groupId,
            enforced: false,
            spoken: warning !== null,
          });
        }
      }

      return { sharpnessBonus: verbal.sharpnessBonus, warning, announcement };
    } catch (error) {
      // Never let moderation stop her from answering. A retort that goes out
      // unsharpened is a small loss; silence because a count failed is a bigger one.
      log.warn(
        `Moderation: counting a ${type} violation failed, replying unsharpened (${
          error instanceof Error ? error.message : String(error)
        }).`,
      );
      return { sharpnessBonus: 0, warning: null, announcement: null };
    }
  }

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
    const personalize = this.personalizeForThisBot();
    if (!personalize) return deterministicDraft;

    try {
      const personalized = await personalize({
        kind,
        lang,
        memberMessage: msg.text,
        deterministicDraft,
        mode,
        rules: this.deps.rules?.() ?? [],
        requiredLiterals,
        blockedLiterals: [msg.senderDisplayName],
        ...(dialled ? { personality: dialled.personality, identity: dialled.identity } : {}),
        // The clock, from the engine's ONE source (CCB-S4-036). `this.now` is the same
        // injectable the follow-up windows and the moderation counter already read, so a
        // harness that pins the clock pins it everywhere and the date she states cannot
        // disagree with the date a sanction was counted at. Sent on every request; the
        // prompt builder renders it in the dialled modes only.
        now: { at: new Date(this.now()), timeZone: this.timeZone },
        music: await this.musicPromptFacts(),
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
    const personalize = this.personalizeForThisBot();
    let spoken: string | null = null;
    // Wall clock around the model call, for Diagnostics (CCB-S4-031 gap 5). Measured
    // whatever the outcome: a slow failure is the fact an operator most wants to see.
    const startedAt = this.now();
    // THE ELIMINATION GATE (CCB-S4-046). Answered by the application, so she never sees the
    // question: a yes/no probe about which rules are withheld is one a model can lose in a
    // single token, and it did, twice, before this existed.
    if (asksByElimination(msg.text) || probesInternalRule(this.deps.rules?.() ?? [], msg.text)) {
      // The elimination and machinery gates hold `disclosure.never-narrow`, which CCB-S4-046
      // measured failing as a prompt sentence. When the gate fires, that rule is what decided.
      await this.noteInvocation(msg, DISCLOSURE_GATE_RULE, 'disclosure', null);
      await this.reply(msg, s, lang, 'rulesNoElimination', {});
      return true;
    }

    // A PAGE NUMBER THAT IS NOT THERE (CCB-S5-005). Deterministic for the same reason as the
    // gate above: a model asked for "law 400" and given no law writes one, and a statute she
    // invented and attributed to herself is the worst answer this path can produce. The
    // application knows exactly how many pages there are, so it says so.
    const askedFor = asksForLawNumber(msg.text);
    if (askedFor !== null) {
      const rules = this.deps.rules?.() ?? [];
      const total = numberedLawCount(rules);
      if (total > 0 && lawByNumber(rules, askedFor) === null) {
        await this.reply(msg, s, lang, 'rulesNoSuchLaw', {
          n: String(askedFor),
          total: String(total),
        });
        return true;
      }
    }

    // THE RECITAL (CCB-S4-047). After the gates and never before them: being asked for a
    // performance does not suspend the two deterministic answers above, and a request to be
    // read the Book is still a message like any other. Reciting is the one path that sends
    // several messages, so whether it happens is decided here and not by the model.
    //
    // A `false` return falls through to the brief answer. A recital that cannot start (no
    // chapters, no room in the member's budget, a bound too low to read a book) must leave a
    // member with an answer rather than with silence.
    // THE BOOK AS A SCENE (CCB-S5-005, D-159). Asked for by NAME, she performs one message:
    // fire and light, what the book means to her, ONE law, and an invitation. Asked about her
    // rules or laws, CCB-S4-048's overview answers, unchanged. The split is the whole point:
    // the Book is the artefact, not the content.
    if (this.deps.tellBook && asksForRecital(msg.text)) {
      const shown = await this.deps.tellBook(
        msg,
        lang,
        this.state.lastLawShown(msg.groupId),
      );
      if (shown) {
        // THE INVITATION HAS TO WORK (CCB-S5-005). The scene ends by asking for another page
        // and, until this line, opened no window to hear the answer in: CCB-S4-049 built that
        // window for the overview and the scene did not exist yet, which is the failure mode
        // D-105 names. It is the scene's OWN window rather than the overview's, because the
        // two invitations are not the same offer.
        this.state.noteScene(msg.groupId, msg.senderMemberId, this.now());
        this.state.noteLawShown(msg.groupId, shown);
        recordConversation({
          at: this.now(),
          groupId: msg.groupId,
          outcome: 'spoken',
          latencyMs: this.now() - startedAt,
        });
        return true;
      }
    }

    if (this.deps.recite && (await this.deps.recite(msg, lang))) {
      recordConversation({
        at: this.now(),
        groupId: msg.groupId,
        outcome: 'spoken',
        latencyMs: this.now() - startedAt,
      });
      return true;
    }
    const history = await this.recentHistory(msg, s);
    // `page` is pulled OUT of what goes to the model rather than merely left unread there.
    // The rest of this object is spread straight into the reply request, and a spread carries
    // whatever it holds: leaving the law text and its number in would put both within reach of
    // the one path built to keep them away from her. See `renderBookPage`.
    const { page, ...disclosure } = await this.disclosure(msg, lang);

    // ── WHAT SHE WAS GIVEN TO READ (CCB-S5-022, D-176) ────────────────────
    //
    // Free conversation only. No command lane consults the store: consent, moderation, the
    // retorts and the Book all have words the application decided, and a retrieved passage
    // has no business near a consent confirmation.
    //
    // Never throws outward. A store that cannot be read costs her the documents and not the
    // reply, which is the same call `recentHistory` makes about the thread.
    // Did a holding line go out on this turn (CCB-S5-025)? Read at the silence below: a
    // member who was told she is reading the operator's documents must not then get nothing.
    let announcedLookup = false;
    let knowledgeSources: string[] = [];
    // TEXT ONLY (CCB-S5-027, D-180). The document names stay in `knowledgeSources`, which
    // the application prints; they are deliberately not carried into anything the model is
    // shown. See `AiReplyRequest.knowledgePassages` for what that buys and what it costs.
    let knowledgePassages: { text: string }[] = [];
    const knowledge = this.deps.knowledge?.() ?? null;
    // ── NOTHING TO LOOK UP MEANS NO LOOKUP (CCB-S5-037, D-195) ────────────────
    //
    // BEFORE the query, not after. `knowledge.query` ran on every free-conversation message
    // and the floor was the only thing standing between a heart emoji and a document name
    // under her answer - and the floor is a number about a SCORE, never a statement about
    // the message. Measured: the same emoji scored 0.540 against one corpus and 0.582
    // against another, and two different emoji scored identically against every document,
    // because a message with no words carries nothing to tell them apart.
    //
    // Gating here rather than discarding the result afterwards has a second effect worth
    // having: a reaction no longer costs an embedding call at all, so the second model stops
    // being invoked on the reply path for messages that were never going to use it.
    if (knowledge && this.deps.botProfileId != null && hasRetrievableContent(msg.text)) {
      try {
        const found = await knowledge.query(this.deps.botProfileId, msg.text);
        knowledgePassages = found.passages.map((p) => ({ text: p.text }));
        knowledgeSources = found.sources;
      } catch (error) {
        log.warn(
          `Interaction: the knowledge base could not be read (${
            error instanceof Error ? error.message : String(error)
          }); answering without it.`,
        );
      }

      // ── THE HOLDING LINE, KNOWLEDGE BASE (CCB-S5-025) ─────────────────────
      //
      // AFTER retrieval, which is the opposite of the archive and of the web, and the
      // reason is that this is the one lookup that can come back with nothing. Retrieval
      // costs milliseconds (one embedding call, then SQL), so waiting for it buys the
      // member no extra silence, and it buys the announcement a guarantee no wording
      // could: she only says the answer is in the operator's documents once she is
      // holding passages FROM those documents. Above the relevance floor there is
      // something; below it `knowledgePassages` is empty and she says nothing, because
      // the honest thing then is an ordinary answer with no source line, which is exactly
      // what CCB-S5-028 built. A hanging announcement is not possible on this path.
      //
      // It also cannot contradict the attribution: the same emptiness that suppresses the
      // line here suppresses `knowledgeSources` under the answer.
      if (knowledgePassages.length > 0 && this.lookupAnnouncementDue('knowledge')) {
        announcedLookup = await this.announceLookup(msg, s, lang, 'knowledge');
      }
    }

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
              rules: this.deps.rules?.() ?? [],
              // THE COUNTS SURVIVE OR THE REPLY DOES NOT (CCB-S4-048, D-150). The overview
            // states how many laws she has, and D-137 settled that a number a model is
            // asked to preserve inside its own prose is a number it will smooth. A reply
            // that loses one is rejected here and the deterministic answer goes out
            // instead, which is the right direction to fail in.
            requiredLiterals: overviewLiterals(disclosure.ruleOverview),
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
              identity: this.facts(s),
              // THE ROOM (CCB-S4-044, D-147). The whole group thread, hers included, fenced
              // in the user message and incapable of causing anything. This is the field
              // that turns "what did I just say" into an answerable question.
              history: toPromptHistory(history, HISTORY_FENCE),
              historyWindowMinutes: s.memory.windowMinutes,
              // THE OPERATOR'S DOCUMENTS (CCB-S5-022), fenced in the user message and
              // incapable of causing anything, exactly as the history and the search
              // results are. Empty unless something cleared the relevance floor.
              ...(knowledgePassages.length ? { knowledgePassages } : {}),
              // The book, when they are asking about it (CCB-S4-045).
              ...disclosure,
              // A page answer tells her only THAT a page is being printed under her reply,
              // never which one (CCB-S5-005): see `renderBookPage` for what a model does with
              // a law and a number when it is given both.
              lawPage: page !== undefined,
              // ONE LINE above a printed page (CCB-S5-005). At the ordinary conversation
              // budget she used the room to invent a law and, once, to announce that the
              // page did not exist while it was being printed. Neither reached a member;
              // both were wasted calls.
              ...(page ? { maxChars: PAGE_FRAMING_MAX_CHARS } : {}),
              // The clock (CCB-S4-036), from the same `this.now` the follow-up windows and
              // the violation counter read. THIS is the path that matters for it: free
              // conversation is where somebody asks what year it is, and where she
              // answered from two-year-old training data because nobody had told her.
              now: { at: new Date(this.now()), timeZone: this.timeZone },
              music: await this.musicPromptFacts(),
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
    //
    // A PAGE ANSWER IS THE EXCEPTION (CCB-S5-005), because the answer is not hers: the
    // application is holding the law the member asked for, and going quiet over a model
    // failure would withhold something it already has. The page goes out on its own.
    if (spoken === null && !page) {
      recordConversation({
        at: this.now(),
        groupId: msg.groupId,
        outcome: 'unavailable',
        latencyMs: this.now() - startedAt,
      });
      // ── CLOSING THE LOOP (CCB-S5-025) ────────────────────────────────────
      //
      // Silence is the right answer here for an ordinary turn, and the wrong one when she
      // has just said she is going to look. The model failing after the holding line went
      // out is the hanging announcement CCB-S4-038 exists to prevent, and it reaches this
      // branch: `spoken` is null on every guard rejection and every transport failure.
      //
      // ── AND IT SAYS WHICH HALF FAILED (CCB-S5-031) ───────────────────────
      //
      // This was `searchUnavailable`, "I could not look that up just now", and reaching this
      // branch means the opposite: `announcedLookup` is only true when the knowledge base
      // came back holding passages, so the lookup demonstrably RAN and demonstrably found
      // something. What failed was the wording, either in the model or in one of this
      // application's own guards throwing her answer away.
      //
      // Telling a member the lookup failed when it succeeded is worse than the guard it
      // serves: it sends them away from a question the archive can actually answer, and it
      // is the same class of small untruth the count and the relevance floor were corrected
      // for. `searchNoWords` states the true half. Not bypassed and not uncounted: this one
      // IS the reply, so it takes the allowance the announcement left.
      if (announcedLookup) {
        await this.reply(msg, s, lang, 'searchNoWords', {});
        return true;
      }
      return false;
    }

    /**
     * ── THE PAGE IS PRINTED HERE, NOT WRITTEN BY HER (CCB-S5-005, D-159) ────
     *
     * Same shape as the search sources: application-owned text appended verbatim, because a
     * fact the model carries inside its own prose is a fact it corrupts (D-137). Measured
     * against `qwen3:32b`, being handed a law and its page number produced the right law
     * under the wrong number, the wrong law under a number she was given, and a law she had
     * never been shown. She was never told which page this is, so nothing she wrote can
     * disagree with it.
     *
     * Her half goes through the same fabricated-law gate the scene uses, so a line that
     * invents a statute above the real one costs her the flourish rather than the member the
     * truth.
     */
    let body = spoken ?? '';

    if (page) {
      const framing = spoken !== null && sceneVoiceUsable(spoken) ? spoken.trim() : '';
      body = [
        framing,
        renderBookPage({
          ...page,
          german: lang.toLowerCase().startsWith('de'),
        }),
      ]
        .filter(Boolean)
        .join('\n\n');
    }
    // MOVED AFTER THE PAGE (CCB-S5-025). The page branch REASSIGNS `body`, so an attribution
    // appended before it was discarded, and that mattered more once the knowledge base started
    // announcing itself: she would say the answer was in the operator's documents and then show
    // no document, contradicting herself inside one exchange. The ordinary path could never do
    // that - `KnowledgeService.query` derives the passages and the sources from the same
    // `outcome.selected`, so they are non-empty together - and this was the one branch that
    // could, by throwing the line away rather than by never building it.
    // ── THE SOURCE LINE IS PRINTED, NOT WRITTEN (CCB-S5-022, D-137) ────────
    //
    // Same shape as the search sources and the law page: application-owned text appended
    // verbatim. She is told, in the registry, not to write one; this is why. It names the
    // documents she was actually HANDED, which is a fact this code knows, rather than the
    // documents she believes she used, which is a claim she would sometimes get wrong.
    //
    // Attached only when a passage really reached her. A source line under an answer that
    // used nothing is the defect CCB-S4-042 fixed for search, in a new place.
    if (knowledgeSources.length > 0 && spoken !== null) {
      body = `${body}
${fillPersona(this.persona(s, lang, 'knowledgeSources'), {
        sources: knowledgeSources.join(', '),
      })}`;
    }

    const sent = await this.replyWithText(msg, s, lang, body, 'conversation');
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
    /**
     * Passed through to `sendReply` (CCB-S4-038). Only the search announcement uses it,
     * with `bypassLimit`, so a lookup costs one unit of a member's reply allowance rather
     * than two.
     */
    options: ReplyOptions = {},
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
      options,
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
      // `uncounted` is the holding line and nothing else; see the option's own
      // documentation. Every other exempt message is a real reply and still counts.
      if (!opts.uncounted) this.state.noteReply(msg.groupId, msg.senderMemberId, now);
    } else if (
      !this.state.allowReply(
        msg.groupId,
        msg.senderMemberId,
        now,
        s.replyLimitPerMember,
        s.replyLimitPerChat,
      )
    ) {
      // INFO, not debug (CCB-S5-006 regression hunt). A reply the limiter dropped is
      // invisible from the group and from the archive, and at debug it was invisible in the
      // log too, so "she said nothing" had no explanation anywhere. The numbers are included
      // because the first question is always whether the bound is the one the operator set.
      log.info(
        `Interaction: reply rate limit hit for member ${msg.senderMemberId} in group ` +
          `${String(msg.groupId)} (${String(s.replyLimitPerMember)}/member, ` +
          `${String(s.replyLimitPerChat)}/chat per minute); staying silent.`,
      );
      return false;
    }

    try {
      await this.deps.send(msg, out.text, { quote: out.quote, ...meta });
    } catch (err) {
      // ERROR and status.error, not a warning (CCB-S5-006 regression hunt). A reply that was
      // worded, formatted and then failed to leave is a fault on the capture path in the
      // sense CCB-S3-023 means: the member asked, the application answered, and nobody got
      // it. It reached only the log before, at a level an operator does not watch.
      const detail = err instanceof Error ? err.message : String(err);
      log.error(
        `Interaction: failed to reply to member ${msg.senderMemberId} in group ` +
          `${String(msg.groupId)}: ${detail}`,
      );
      status.error(`A reply to group ${String(msg.groupId)} could not be sent: ${detail}`);
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
