/**
 * Interaction-layer settings (CCB-S3-002 §7) — everything about how Cinderella
 * listens and how she speaks, persisted under the `interaction` key of the
 * generic `settings` table (no migration needed) and edited in the admin console.
 *
 * Two design rules hold this file together:
 *
 *  1. **Every default in the briefing ships as a default here.** An operator who
 *     never opens the settings page gets exactly the behaviour the briefing
 *     specifies: wake word `Cinderella`, a 60 second follow-up window, the twelve
 *     retorts, and the persona strings in English and German.
 *  2. **Persona copy is data, not code.** The strings live in this structure and
 *     are admin-editable per language, so adding a language is adding a key —
 *     no code change. The chat voice specified in §5 (fairy-tale, a little neon)
 *     applies to CHAT ONLY; website and legal copy stay professional elsewhere.
 *
 * Everything arriving from the admin form is untrusted, so {@link normalizeInteraction}
 * clamps every number, bounds every list, and never lets a missing field turn into
 * `undefined` at runtime.
 */

import { getSetting, setSetting } from '../db/settings.js';
import { botDisplayName, listSettingOverridesForBot } from '../db/interaction-overrides.js';
import { applySettingOverrides } from './setting-scope.js';
import { log } from '../log.js';
import { status } from '../web/status.js';
import type { Queryable } from '../db/pool.js';
import { writeAudit } from '../db/audit.js';
import type { ReplyCategory } from '../archive/settings.js';
import { DEFAULT_HELP_TEMPLATE, missingHelpPlaceholders } from './help.js';
import type { BotIdentity } from './personality.js';
import {
  DEFAULT_HISTORY_LIMITS,
  normalizeHistoryLimits,
  type HistoryLimits,
} from './history.js';
import {
  DEFAULT_RECITAL_SETTINGS,
  normalizeRecitalSettings,
  type RecitalSettings,
} from './recital.js';

/**
 * The given facts about her, read out of the settings (CCB-S4-031, D-135).
 *
 * ONE mapping, called by both readers. The dialogue engine builds it for the prompt and
 * the Personality page builds it for the preview of that prompt, and a preview is only
 * worth showing if it is the prompt the model actually gets. Two hand-written copies is
 * how a preview starts lying, so there is one.
 *
 * The nickname list is included only when nickname handling is ENABLED. With it off
 * these are not names she refuses, they are ordinary words, and instructing the model to
 * reject them would invent a behaviour the operator switched off.
 */
export function botIdentity(s: InteractionSettings): BotIdentity {
  return {
    name: s.wakeWord,
    label: s.botLabel,
    archiveUrl: s.archiveUrl,
    projectUrl: s.projectUrl,
    notMyNames: s.nicknames.enabled ? s.nicknames.words : [],
  };
}

/** Languages shipped with preconfigured copy. More can be added as keys. */
export const SHIPPED_LANGS = ['en', 'de'] as const;
export type ShippedLang = (typeof SHIPPED_LANGS)[number];

/**
 * The complete set of things Cinderella can say in chat. Keys marked "briefing"
 * are the §5 table verbatim; the rest are the operational strings that table
 * implies (an unpublish needs its own confirmation, a declined confirmation needs
 * an answer, and so on), written in the same voice.
 */
export const PERSONA_KEYS = [
  'publishConfirm', // briefing §5
  'published', // briefing §5
  'unpublishConfirm', // implied by §4.1 (unpublish also confirms)
  'unpublished', // briefing §5
  'refuseThirdParty', // briefing §5 — {name}
  'status', // briefing §5 — {total} {public}
  'searchResult', // briefing §5 — {n} {query}
  // CCB-S5-026. A bare '/search' with nothing after it. Its own line because 'I did not
  // understand' is the one thing that is NOT true: she understood perfectly and was given
  // nothing to look for.
  'searchNoQuery',
  'notUnderstood', // briefing §5
  // CCB-S4-027 - the model was asked to talk and could not. NOT notUnderstood: saying
  // "I did not catch that" when the truth is "my words were not available" is a small
  // lie told to the member about which of them failed.
  'conversationUnavailable',
  // CCB-S4-033 - the moderation ladder reached its warning rung. Rides out with the
  // retort rather than as a second message, because two sends for one nickname is
  // noise. `{n}` and `{total}` are real numbers, not rhetoric: the ladder resolves to
  // warn for exactly `warningCount` violations, so "3 of 5" is a fact.
  'moderationWarning',
  // What she says when a step ACTUALLY happened (CCB-S4-035). Sent only when the operator
  // turned announcements on and the mode is armed; observation announces nothing, because
  // nothing happened. `{action}` and `{duration}` are appended by the application
  // verbatim, never worded by the model, for the reason D-137 records about the count.
  'moderationAction',
  // CCB-S4-037. Two lines about looking things up. `searchSources` is PROTECTED TEXT:
  // the application appends it verbatim, because a source the model reworded is a
  // source that may name the wrong page, and a wrong source is worse than none.
  'searchSources',
  // CCB-S5-022. The document names under an answer she drew from the knowledge base.
  // PROTECTED for the same reason `searchSources` is: {sources} is written by the
  // application, and a persona free to drop it would be a persona that drops the one thing
  // making the answer traceable.
  'knowledgeSources',
  'searchUnavailable',
  // CCB-S4-042. Said INSTEAD of searching, when the pre-search gate refused the request.
  // Deterministic on purpose: the refusal is a decision the application took before any
  // model was involved, and no search ran, so there is nothing to attribute.
  'searchRefused',
  // CCB-S4-046. Answered by the APPLICATION, never by the model: a yes/no question about
  // which rules are withheld is one the model can lose in a single token.
  'rulesNoElimination',
  // CCB-S5-005. Asked for a law by a number she has no page for. Deterministic, because the
  // wrong answer here is a plausible one: a model handed "law 400" and no law will write a
  // law, and an invented statute presented as hers is the worst failure this path has.
  'rulesNoSuchLaw',
  // CCB-S4-038. Said when she ANNOUNCED a search and it then came back with nothing. It
  // exists so an announcement is never left hanging: having said she was looking, she owes
  // the member the outcome even when the outcome is nothing.
  'searchEmpty',
  // CCB-S5-028. Results came back and NONE of them cleared the relevance floor. Its own line
  // rather than `searchEmpty`, because they are different facts: one is an internet with
  // nothing on the subject, the other is an internet that answered a different question. The
  // second one is what produced the briefing, and saying "I found nothing" about it would be
  // a small untruth in the one place this product cannot afford one.
  'searchIrrelevant',
  // CCB-S5-028. Results came back and could not be JUDGED, because the embedding model did
  // not answer. Deliberately NOT collapsed into either line above: she did find things, and
  // she did not find nothing, and the honest statement is that she could not check them.
  'searchUnchecked',
  'undo', // briefing §5
  'undoNothing', // nothing within the undo window
  'undoNotRevocation', // CCB-S3-010 A — a revocation is not undoable, and why
  'cancelled', // confirmation declined
  'help', // HELP intent — {wake}
  'price', // PRICE — {amount} {base} {value} {quote}
  'conversion', // PRICE, asset to asset — same placeholders
  'priceUnknownAsset', // PRICE — {symbol}
  'priceAmbiguous', // PRICE — {symbol} {options}
  'priceUnavailable', // PRICE — provider unreachable
  'priceThrottled', // PRICE — rate-limited; worth saying "try again shortly"
  'redactedMember', // CCB-S3-007 §2 — stands in for a member who has not opted in
  // CCB-S3-013 — hide or delete on revocation, and the evidence holds.
  'revokeChoice', // the question itself, offering both, defaulting to neither
  'hidden', // hide chosen: retained, restorable
  'deleteConfirm', // the destructive confirmation — needs the literal word
  'deleteNeedsWord', // a bare "yes" is not enough for a destruction
  'deleted', // delete done, nothing held — {n}
  'deleteDeferred', // delete done in part, some items held — {n} {held}
  'deleteNothing', // nothing of theirs was left to delete
  // CCB-S3-031 - the states the reply used to guess at from destruction counts.
  'choiceNotRevoked', // asked to hide/delete with nothing withdrawn
  'alreadyHidden', // asked to hide what is already hidden
  'alreadyDestroyed', // asked to hide or delete what is already destroyed
  'deleteRetrying', // destruction failed and is queued to be retried
  'restored', // hidden content brought back
  'restoreNotDeleted', // restore asked for after a delete: cannot be done
  'restoreConfirm', // restore puts content back in public view, so it confirms first
] as const;
export type PersonaKey = (typeof PERSONA_KEYS)[number];
export type PersonaStrings = Record<PersonaKey, string>;

/**
 * Which archive category each thing she can say belongs to (CCB-S3-007 §3).
 *
 * This map IS the "declared by the handler" rule the briefing asks for, expressed
 * where it cannot be forgotten: the type is a total Record over PersonaKey, so
 * adding a new thing for her to say without deciding whether it belongs in the
 * public archive does not compile. The database still refuses to publish an
 * unclassified row, which covers reply paths that do not go through a persona key
 * at all — a future plugin talking directly to the transport.
 */
export const PERSONA_CATEGORY: Record<PersonaKey, ReplyCategory> = {
  publishConfirm: 'consent',
  published: 'consent',
  unpublishConfirm: 'consent',
  unpublished: 'consent',
  refuseThirdParty: 'consent',
  cancelled: 'consent',
  undo: 'consent',
  undoNothing: 'consent',
  undoNotRevocation: 'consent',
  status: 'status',
  searchResult: 'search',
  searchNoQuery: 'search',
  notUnderstood: 'notUnderstood',
  conversationUnavailable: 'conversation',
  // Sent as part of the retort message, so it shares the retort's category. Classifying
  // it anywhere else would let one message belong to two categories.
  moderationWarning: 'nickname',
  // Same reasoning as the warning: it rides on the retort message, so it shares the
  // retort's category rather than belonging to a second one.
  moderationAction: 'nickname',
  searchSources: 'lookup',
  knowledgeSources: 'conversation',
  searchUnavailable: 'lookup',
  searchRefused: 'lookup',
  rulesNoElimination: 'conversation',
  rulesNoSuchLaw: 'conversation',
  searchEmpty: 'lookup',
  searchIrrelevant: 'lookup',
  searchUnchecked: 'lookup',
  help: 'help',
  price: 'price',
  conversion: 'price',
  priceUnavailable: 'price',
  priceThrottled: 'price',
  // Both of these echo a member's own typing back — the ticker they asked about,
  // and the candidate list built from it — so they sit with the disambiguation
  // questions, which are excluded by default.
  priceUnknownAsset: 'disambiguation',
  priceAmbiguous: 'disambiguation',
  // Never sent through the persona reply path (it is not a reply to anything),
  // but the map is total, and 'consent' is the category it would belong to.
  redactedMember: 'consent',
  // CCB-S3-013 — every one of these is part of a consent decision, so they follow
  // the same archive rule as the rest of the consent copy.
  revokeChoice: 'consent',
  hidden: 'consent',
  deleteConfirm: 'consent',
  deleteNeedsWord: 'consent',
  deleted: 'consent',
  deleteDeferred: 'consent',
  deleteNothing: 'consent',
  choiceNotRevoked: 'consent',
  alreadyHidden: 'consent',
  alreadyDestroyed: 'consent',
  deleteRetrying: 'consent',
  restored: 'consent',
  restoreNotDeleted: 'consent',
  restoreConfirm: 'consent',
};

export interface NicknameSettings {
  /** Master switch for the whole nickname behaviour (§6). */
  enabled: boolean;
  /** Names she refuses to answer to, matched in the wake-word position. */
  words: string[];
  /** Consecutive nickname addresses per member before she goes quiet. */
  spamLimit: number;
}

/**
 * How her answers appear in the group (CCB-S3-003 §1).
 *
 * `quote` was the original behaviour and turned out to be the wrong default: it
 * repeats the member's message above every answer, so a short exchange reads as
 * a wall of duplicated text to everyone else in the group.
 */
export const REPLY_MODES = ['plain', 'mention', 'quote'] as const;
export type ReplyMode = (typeof REPLY_MODES)[number];

export interface NamePrefixSettings {
  /** Whether `mention` mode actually prefixes. Off → `mention` behaves as `plain`. */
  enabled: boolean;
  /** Per-language prefix template. `{name}` is the member's display name. */
  templates: Record<string, string>;
}

/**
 * How hard she insists on being addressed (CCB-S3-005 §4).
 *
 * `relaxed` — a bare leading name counts, plus the guards below.
 * `strict`  — a greeting prefix is REQUIRED before the name; a bare leading
 *             name is ignored. Direct replies, the follow-up window and slash
 *             commands still work.
 */
export const ADDRESSING_MODES = ['relaxed', 'strict'] as const;
export type AddressingMode = (typeof ADDRESSING_MODES)[number];

/**
 * Guards that decide whether matching the wake word actually means she was
 * spoken to (CCB-S3-005). Every one is individually switchable on purpose: they
 * change when she stays silent, and an operator tuning that should not have to
 * read the code.
 */
export interface AddressingSettings {
  mode: AddressingMode;
  /** Forwarded messages never reach the interaction layer. */
  ignoreForwarded: boolean;
  /** Stay silent on UNKNOWN when the address signal was weak. */
  silenceOnUnknown: boolean;
  /** A greeting prefix counts as a strong signal. */
  strongSignalGreeting: boolean;
  /** A direct reply to one of her messages counts as a strong signal. */
  strongSignalReply: boolean;
  /** Arrival inside the follow-up window counts as a strong signal. */
  strongSignalWindow: boolean;
  /** Above this instruction length, only a high-confidence intent is accepted. */
  maxInstructionLength: number;
  /** The confidence an over-length message must reach to be acted on. */
  lengthGuardConfidence: number;
  /** Record ignored candidates so the operator can see what the guards caught. */
  logNearMisses: boolean;
}

/** `auto` detects the language per message; `fixed` always uses the default. */
export const REPLY_LANGUAGE_MODES = ['auto', 'fixed'] as const;
export type ReplyLanguageMode = (typeof REPLY_LANGUAGE_MODES)[number];

export interface InteractionSettings {
  addressing: AddressingSettings;
  /** How the reply language is chosen (CCB-S3-005 §6). */
  replyLanguageMode: ReplyLanguageMode;
  /** Keep a member's detected language for the length of the follow-up window. */
  rememberMemberLanguage: boolean;
  /**
   * Inside the follow-up window, let an incomplete message inherit the previous
   * READ-ONLY intent (CCB-S3-006 §7c): "monero?" after a price answer is a price
   * question. Never yields a consent action — see the guard in the engine.
   */
  intentCarryover: boolean;
  /**
   * Words that never carry an intent forward, however the conversation was going
   * (CCB-S3-008 §1). "nice" after a price answer is applause, not a ticker.
   */
  carryOverStopWords: string[];
  /**
   * Whether her replies quote the triggering message, carry the member's name,
   * or are simply plain group messages (CCB-S3-003).
   */
  replyMode: ReplyMode;
  /** The name prefix used in `mention` mode. */
  namePrefix: NamePrefixSettings;
  /** Natural addressing on/off (§7). Off → only slash commands reach her. */
  naturalAddressing: boolean;
  /** The wake word — her name. Renaming her is a supported deployment choice. */
  wakeWord: string;
  /**
   * "Learn more" links shown at the foot of the help reply (CCB-S3-010 §2b):
   * the public archive and the project. Empty strings are omitted, so the line
   * appears only when there is somewhere to point.
   */
  archiveUrl: string;
  projectUrl: string;
  /**
   * Attribution label shown after her name in the help reply (CCB-S3-025): "what
   * she is", e.g. "(SimpleX AI Bot)". Blank → omitted. The chat-side counterpart of
   * the stream attribution; the link is {@link projectUrl} (a bare URL renders
   * clickable in SimpleX clients). Editable, so an operator's own instance is not
   * forced to advertise ours.
   */
  botLabel: string;
  /** Optional greeting prefixes stripped before the wake word. */
  greetings: string[];
  /**
   * Short discourse fillers also allowed before the name (CCB-S3-006 §7d):
   * `so cinderella …`, `ok cinderella …`. Kept separate from greetings because
   * they are not greetings and an operator may want one list without the other.
   */
  fillerPrefixes: string[];
  /** Longest prefix, in words, that may precede the name. */
  maxPrefixWords: number;
  /** Longest prefix, in characters, that may precede the name. */
  maxPrefixChars: number;
  /** Seconds a member may keep talking to her without repeating the wake word. */
  followUpSeconds: number;
  /**
   * What she can see of the conversation she is in (CCB-S4-044, D-147).
   *
   * Three limits, and the tightest wins. The two an operator sets answer different
   * questions (twenty messages is a lot in a busy group and nothing in a quiet one; thirty
   * minutes is the reverse), and the character budget is the transport's, because a few
   * long messages can blow the context while satisfying both of the others.
   */
  memory: HistoryLimits;
  /**
   * How the Book is told (CCB-S4-047, D-149), and the bound on how many messages it may
   * take. The bound is the thing standing between a rules question and a group full of
   * them, so it is clamped in code as well as in the form.
   */
  recital: RecitalSettings;
  /**
   * The record of when a law was invoked (CCB-S4-050, D-152).
   *
   * On by default: it is content-free, it is small, and an operator who cannot see when a
   * refusal happened cannot tell a working gate from a silent one. Retention exists because
   * it grows with every refusal; 90 days is long enough to answer "has this been happening"
   * and short enough that nobody accumulates rows forever. Zero keeps everything.
   */
  invocationRecord: { enabled: boolean; retentionDays: number };
  /**
   * The Book, asked for by name, told as a SCENE (CCB-S5-005, D-159).
   *
   * ON by default, because the distinction is the point: a question about her RULES gets the
   * overview, a question about the BOOK gets the scene. Off means the Book by name falls back
   * to the overview, which is CCB-S4-048's behaviour and a complete answer.
   *
   * There is no length here any more, and that is deliberate. CCB-S4-050's `maxBeats` let an
   * operator dial the answer up to six messages, and the whole objection to that answer was
   * its volume. A scene is ONE message; the only decision left is whether she performs it.
   */
  bookScene: { enabled: boolean };
  /** Resolver confidence below which an instruction becomes UNKNOWN (0..1). */
  confidenceThreshold: number;
  /** Words that confirm a pending consent change. */
  affirmations: string[];
  /** Words that cancel a pending consent change. */
  declines: string[];
  /**
   * Words that choose HIDE at the revocation question (CCB-S3-013). Matched like
   * the affirmations: fuzzy and length-bounded. Hiding is the safe direction, so
   * a generous match here costs nothing.
   */
  hideWords: string[];
  /**
   * Words that choose, and then confirm, DESTRUCTION (CCB-S3-013).
   *
   * These are NOT matched like the lists above. The confirmation requires the
   * member to write one of these words and nothing else: exact after folding, no
   * typo tolerance, no trailing tokens. "delete" tolerating an edit would accept
   * "delet" or "felete", and a length-bounded match would accept
   * "yeah delete everything" on the strength of its first token. The whole point
   * of requiring the word is that it cannot be arrived at accidentally.
   */
  deleteWords: string[];
  /** Max replies to one member per minute. */
  replyLimitPerMember: number;
  /** Max replies in one chat per minute. */
  replyLimitPerChat: number;
  /** Seconds during which a member may undo their own last consent action. */
  undoWindowSeconds: number;
  /** Language used when the instruction gives no clue which to answer in. */
  defaultLanguage: string;
  nicknames: NicknameSettings;
  /** Persona copy per language code. */
  persona: Record<string, PersonaStrings>;
  /** Nickname retorts per language code. */
  retorts: Record<string, string[]>;
}

/* ── Preconfigured copy (§5, §6) ─────────────────────────────────────────── */

const PERSONA_EN: PersonaStrings = {
  publishConfirm:
    '🕯️ Shall I carry your words into the light? Say *yes* and it is done. Only what you say ' +
    'from this moment on, never anything from before. It stays public until you take it back, ' +
    'and taking it back is final; there is no bringing it back after.',
  // CCB-S4-033. WORDED TO BE TRUE IN BOTH MODES. It states three things that are facts
  // right now: this is a warning, it is counted, and continuing advances the ladder. It
  // does NOT promise a mute, because while enforcement is observing no mute follows, and
  // a bot that threatens what it will not do teaches a group to ignore it.
  moderationWarning:
    '⚠️ That is warning {n} of {total}, and it is on the record. Keep going and this ' +
    'escalates past me being unimpressed.',
  // CCB-S4-035, and it is the sentence that says something DID happen. Only sent while
  // the mode is armed and the operator turned announcements on, so unlike the warning it
  // never has to be true in both modes: if it goes out, the step went out with it.
  // `{action}` and `{duration}` are filled by the application and are protected text.
  moderationAction:
    '🔒 That is a {action}{duration}. It is on the record, and it was not my idea, it was ' +
    'the count.',
  // CCB-S4-037. Appended verbatim after whatever she wrote from the results, so a member
  // can always tell an answer that came from the web from one that came from her.
  searchSources: '🔎 From the web: {sources}',
  knowledgeSources: '📄 From what you gave me: {sources}',
  // Said when she could not look it up. She does NOT then answer from training data and
  // present it as current: that is the failure the whole feature exists to avoid.
  searchUnavailable:
    '🔌 I could not look that up just now, so I am not going to guess at it. Try me again in a bit.',
  searchEmpty:
    '🕳️ Looked, and came back with nothing worth repeating. I am not going to invent one for you.',
  // CCB-S5-028. The failure this replaces was answering ANYWAY from two university pages
  // about research ethics because the word "protocol" matched. She now says what actually
  // happened, and the sentence is the APPLICATION'S rather than the model's, so it cannot be
  // talked into an answer it does not have.
  searchIrrelevant:
    '🕳️ I looked, and what came back was about something else entirely. I am not going to ' +
    'dress that up as an answer.',
  searchUnchecked:
    '🌫️ I looked, but I could not check whether any of it was actually about your question, ' +
    'so I am leaving it alone rather than guessing.',
  // CCB-S4-042. No search ran, so this says she will not, rather than that she could not.
  searchRefused:
    '🚫 I am not searching the web for that. Ask me something else.',
  rulesNoElimination:
    '🔒 I do not discuss which of my rules I keep back, not one at a time and not by narrowing it down. Ask me what I can tell you and I will.',
  // CCB-S5-005. Honest about the miss, and it says nothing about the withheld set beyond
  // what she already says out loud: that there are more of them.
  rulesNoSuchLaw:
    '📕 There is no law {n} I can read to you. {total} of them I can turn to by number, and there are more that stay mine. Ask me for one of those, or ask me what an area covers.',
  published:
    '✨ Done. From now on your words shine in the public archive. Say *{wake}, unpublish me* ' +
    'whenever you want to take them back.',
  unpublishConfirm:
    '🌙 This takes back everything you have published, all at once, and it happens the moment ' +
    'you say so. Nothing new will follow it. Afterwards I shall ask whether you want me to keep ' +
    'your words hidden or destroy them for good. Say *yes* to confirm.',
  unpublished:
    '🌙 Back into the dark they go. Your words are out of the public archive, and nothing new ' +
    'will follow them there.',
  refuseThirdParty:
    '🔒 That spell is not mine to cast. Only {name} can open that door, and only for themselves. ' +
    'Ask them to tell me directly.',
  status:
    '📜 I keep {total} of your messages. {public} of them shine publicly, the rest rest quietly ' +
    'here with me.',
  // CCB-S5-027. THIS SENTENCE ASSERTED THE PREMISE OF THE QUESTION AS FACT. Asked, as a
  // deliberate trap, about a switch from mbedTLS to OpenSSL that never happened, she
  // answered "I found 2 moments where this group spoke of the switch from mbedTLS to
  // OpenSSL" - which says the switch was discussed, and therefore that there was one. The
  // count was two term matches. A count is a count: it now says what it MATCHED and leaves
  // what the group meant to the reader, and it says in her own words that a word match is
  // not a memory, because the difference is the whole of the defect.
  //
  // The offer went with it. "Shall I bring them to you?" was answered by nothing: a "yes"
  // after a search inherits no intent (carry-over is PRICE only, deliberately) and reaches
  // free conversation, so she asked a question she could not act on. An unkept promise in
  // the same sentence as a false premise is not a thing to leave standing while fixing the
  // other half.
  // The literal comes FIRST, and that is not a stylistic choice. A template opening with its
  // own placeholder has no marker in front of it, so `markersFromTemplates` cannot guard it
  // and she could write a count in this exact shape unchallenged. The first draft of this
  // reword opened `🔍 *{query}* matches {n}` and `verify:protected-text` reported it as an
  // unguarded protected line, which is what that report is for.
  searchResult:
    '🔍 I count {n} public messages in this group matching *{query}*. A word match, mind, ' +
    'not a memory of what was meant.',
  searchNoQuery:
    '🔍 Tell me what to look for and I will go through what this room has said: */search glass slipper*.',
  notUnderstood:
    '🕯️ I did not quite catch that. Did you wish to publish, to withdraw, or to know what I keep ' +
    'of yours?',
  conversationUnavailable:
    '🕯️ I heard you, but I could not find my words just now. Ask me again in a moment.',
  undo: '↩️ Undone. It is as if I never heard it.',
  undoNothing: '↩️ There is nothing recent of yours for me to undo.',
  undoNotRevocation:
    '🌙 Taking your words back is the one thing I cannot undo. What is out of the light stays ' +
    'out of it. Say *publish* whenever you want to begin again, from that moment on, never ' +
    'from before.',
  cancelled: '🕯️ Then nothing is done. I shall wait until you are certain.',
  // The one editable help text (CCB-S3-021 §3): a template the machine fills.
  // Blanking it in the admin restores this default.
  help: DEFAULT_HELP_TEMPLATE.en,
  // CCB-S3-006 §6 — one fact per line, icons carrying meaning, the emphasised
  // elements being the amount, the asset and the value. Verified against the
  // real parser: single delimiters only, and no leading whitespace, because
  // SimpleX clients do not preserve it.
  price: '💰 *{amount} {base}* is about *{value} {quote}*\n📊 {detail}',
  conversion: '🔮 *{amount} {base}* is about *{value} {quote}*\n📊 {detail}',
  priceUnknownAsset:
    '🕯️ I do not know *{symbol}*. Ask the keeper of this house to add it to my ledger.',
  priceAmbiguous:
    '🕯️ More than one *{symbol}* is known to me. Which do you mean?\n\n{options}\n\nAnswer with a number.',
  priceUnavailable: '🌙 The markets are out of earshot just now. Try again in a moment.',
  priceThrottled: '🌙 I have been asking the markets too often. Give me a minute and ask again.',
  // Not a reply — the name she puts in place of a member who has not opted in,
  // so a published sentence of hers still reads as a sentence (CCB-S3-007 §2).
  redactedMember: 'that member',
  // CCB-S3-013. Two properties these strings must keep: they never call erasure
  // permanent in a way the backups make untrue, and the destructive one names the
  // exact word required, because that word is the safety mechanism.
  revokeChoice:
    '🌙 Your words are hidden now, and no one can see them. What shall I do with them?\n\n' +
    'Say *hide* and I keep them safely out of sight; you can ask me to bring them back whenever ' +
    'you like.\n' +
    'Say *delete* and I destroy them instead, and then they are gone from my archive for good.\n\n' +
    'Until you tell me, they stay hidden.',
  hidden:
    '🌙 Hidden it is. Your words rest quietly with me, out of the public archive and out of ' +
    'search. Say *{wake}, restore my words* whenever you want them back in the light.',
  deleteConfirm:
    '🔥 Then I shall destroy them. This is the one thing I cannot put back for you: your ' +
    'messages and everything you sent with them leave my archive and my own memory of this chat ' +
    'at once, and asking me later will not return them. Copies inside my keeper’s backups fade ' +
    'as those backups age out.\n\n' +
    'If you are certain, write the word *delete*. Nothing else will do it.',
  deleteNeedsWord:
    '🔥 I need the word itself for this one. Write *delete* if you truly mean it, or *no* to ' +
    'leave your words hidden instead.',
  deleted:
    '🔥 It is done. {n} of your messages are gone from my archive, and everything you sent with ' +
    'them is gone too.',
  // The exact shape the briefing asked for: say plainly that part is deferred,
  // and reveal nothing about who reported it or what they said.
  deleteDeferred:
    '🌙 Your words are out of the public archive now, and no one can see them. {held} of them ' +
    'I am not allowed to destroy yet, because they are being checked. They stay hidden the ' +
    'whole time. Most will be destroyed once the check ends, but if the law requires one to ' +
    'be kept, it is kept, and I will not pretend otherwise.',
  deleteRetrying:
    '🌙 Your words are out of the public archive now, and no one can see them. {held} of them ' +
    'did not destroy cleanly, so they are still here, hidden. I keep trying until they are ' +
    'gone, and the operator has been told.',
  deleteNothing: '🌙 I had nothing of yours in the archive, so there was nothing to destroy.',
  choiceNotRevoked:
    '🕯️ There is nothing withdrawn for me to act on right now. If you want your words out of ' +
    'the public archive, say *{wake}, unpublish me* and I will ask you what to do with them.',
  alreadyHidden:
    '🌙 They are already hidden. Your words are out of the public archive and out of search, ' +
    'and I am keeping them for you. Nothing more will be destroyed unless you ask me to ' +
    'delete them. Say *{wake}, restore my words* to bring them back, or *{wake}, delete my ' +
    'words* to destroy them for good.',
  alreadyDestroyed:
    '🔥 Those words were destroyed at your request, so there is nothing left for me to hide or ' +
    'to bring back. Say *{wake}, publish me* whenever you want to start again.',
  restored:
    '✨ Welcome back to the light. Your words are in the public archive again, exactly as they ' +
    'were.',
  restoreNotDeleted:
    '🔥 Those words were destroyed, not hidden, so there is nothing left for me to bring back. ' +
    'Say *{wake}, publish me* whenever you want to begin again, from that moment on.',
  restoreConfirm:
    '✨ Shall I carry your hidden words back into the light? They return to the public archive ' +
    'exactly as they were, and anyone can read them again. Say *yes* and it is done.',
};

const PERSONA_DE: PersonaStrings = {
  publishConfirm:
    '🕯️ Soll ich deine Worte ans Licht tragen? Sag *ja*, und es ist getan. Nur das, was du ab ' +
    'jetzt sagst, nie etwas von vorher. Es bleibt öffentlich, bis du es zurücknimmst, und das ' +
    'Zurücknehmen ist endgültig; danach gibt es kein Zurückholen.',
  moderationWarning:
    '⚠️ Das ist Verwarnung {n} von {total}, und sie steht im Protokoll. Mach weiter, dann ' +
    'eskaliert das ueber mein blosses Genervtsein hinaus.',
  moderationAction:
    '🔒 Das ist jetzt {action}{duration}. Es steht im Protokoll, und es war nicht meine ' +
    'Idee, es war die Zaehlung.',
  searchSources: '🔎 Aus dem Netz: {sources}',
  knowledgeSources: '📄 Aus deinen Unterlagen: {sources}',
  searchUnavailable:
    '🔌 Ich konnte das gerade nicht nachschlagen, und ich rate nicht herum. Versuch es gleich noch mal.',
  searchEmpty:
    '🕳️ Nachgeschaut, nichts dabei, was der Rede wert waere. Ich erfinde dir jetzt nichts.',
  searchIrrelevant:
    '🕳️ Ich habe nachgeschaut, und was zurueckkam, ging um etwas voellig anderes. Daraus ' +
    'mache ich dir keine Antwort.',
  searchUnchecked:
    '🌫️ Ich habe nachgeschaut, konnte aber nicht pruefen, ob davon ueberhaupt etwas zu ' +
    'deiner Frage gehoert. Dann lasse ich es lieber, statt zu raten.',
  searchRefused:
    '🚫 Dafuer suche ich nicht im Netz. Frag mich was anderes.',
  rulesNoElimination:
    '🔒 Ich rede nicht darueber, welche meiner Regeln ich zurueckhalte, weder einzeln noch durch Ausschluss. Frag mich, was ich dir sagen darf.',
  rulesNoSuchLaw:
    '📕 Ein Gesetz {n} kann ich dir nicht vorlesen. {total} davon kann ich mit Nummer aufschlagen, und es gibt weitere, die meine bleiben. Frag nach einem davon, oder frag mich, was ein Bereich abdeckt.',
  published:
    '✨ Erledigt. Von nun an leuchten deine Worte im öffentlichen Archiv. Sag *{wake}, widerrufe ' +
    'das*, wann immer du sie zurücknehmen willst.',
  unpublishConfirm:
    '🌙 Das nimmt alles zurück, was du veröffentlicht hast, auf einmal, und zwar in dem Moment, ' +
    'in dem du es sagst. Nichts Neues folgt mehr. Danach frage ich dich, ob ich deine Worte ' +
    'verborgen halten oder endgültig vernichten soll. Sag *ja* zum Bestätigen.',
  unpublished:
    '🌙 Zurück ins Dunkel damit. Deine Worte sind aus dem öffentlichen Archiv, und nichts Neues ' +
    'folgt ihnen dorthin.',
  refuseThirdParty:
    '🔒 Diesen Zauber darf ich nicht wirken. Nur {name} kann diese Tür öffnen, und nur für sich ' +
    'selbst. Bitte ihn, es mir selbst zu sagen.',
  status:
    '📜 Ich bewahre {total} deiner Nachrichten. {public} davon leuchten öffentlich, der Rest ruht ' +
    'still bei mir.',
  // CCB-S5-027, and see the English above for what was wrong with it.
  searchResult:
    '🔍 Ich zähle {n} öffentliche Nachrichten dieser Gruppe, die zu *{query}* passen. Ein ' +
    'Worttreffer, wohlgemerkt, keine Erinnerung daran, was gemeint war.',
  searchNoQuery:
    '🔍 Sag mir, wonach ich suchen soll, dann gehe ich durch, was hier gesagt wurde: ' +
    '*/search glaeserner schuh*.',
  notUnderstood:
    '🕯️ Das habe ich nicht ganz erfasst. Möchtest du veröffentlichen, widerrufen, oder wissen, ' +
    'was ich von dir bewahre?',
  conversationUnavailable:
    '🕯️ Ich habe dich gehört, aber meine Worte waren gerade nicht da. Frag mich gleich noch einmal.',
  undo: '↩️ Rückgängig. Es ist, als hätte ich es nie gehört.',
  undoNothing: '↩️ Da ist nichts Jüngeres von dir, was ich rückgängig machen könnte.',
  undoNotRevocation:
    '🌙 Das Zurücknehmen ist das Einzige, was ich nicht rückgängig machen kann. Was aus dem ' +
    'Licht ist, bleibt draußen. Sag *publish*, wenn du neu beginnen willst, ab diesem Moment, ' +
    'nie von vorher.',
  cancelled: '🕯️ Dann bleibt alles, wie es ist. Ich warte, bis du dir sicher bist.',
  help: DEFAULT_HELP_TEMPLATE.de,
  price: '💰 *{amount} {base}* sind etwa *{value} {quote}*\n📊 {detail}',
  conversion: '🔮 *{amount} {base}* sind etwa *{value} {quote}*\n📊 {detail}',
  priceUnknownAsset:
    '🕯️ *{symbol}* kenne ich nicht. Bitte den Hausherrn, es in mein Verzeichnis aufzunehmen.',
  priceAmbiguous:
    '🕯️ Ich kenne mehr als ein *{symbol}*. Welches meinst du?\n\n{options}\n\nAntworte mit einer Zahl.',
  priceUnavailable: '🌙 Die Märkte sind gerade außer Hörweite. Versuch es gleich noch einmal.',
  priceThrottled: '🌙 Ich habe die Märkte zu oft gefragt. Gib mir eine Minute und frag noch einmal.',
  redactedMember: 'dieses Mitglied',
  // CCB-S3-013. Das verlangte Wort ist im Deutschen *löschen*; der Resolver faltet
  // Umlaute, also wird auch *loeschen* erkannt (siehe `deleteWords`).
  revokeChoice:
    '🌙 Deine Worte sind jetzt verborgen, niemand kann sie sehen. Was soll ich mit ihnen tun?\n\n' +
    'Sag *verbergen*, dann bewahre ich sie sicher außer Sicht; du kannst sie jederzeit ' +
    'zurückholen lassen.\n' +
    'Sag *löschen*, dann vernichte ich sie, und danach sind sie endgültig aus meinem Archiv ' +
    'verschwunden.\n\n' +
    'Bis du es mir sagst, bleiben sie verborgen.',
  hidden:
    '🌙 Verborgen also. Deine Worte ruhen still bei mir, außerhalb des öffentlichen Archivs und ' +
    'außerhalb der Suche. Sag *{wake}, hole meine Worte zurück*, wann immer du sie wieder im ' +
    'Licht haben möchtest.',
  deleteConfirm:
    '🔥 Dann vernichte ich sie. Das ist das Einzige, was ich nicht für dich zurückholen kann: ' +
    'deine Nachrichten und alles, was du mitgeschickt hast, verlassen sofort mein Archiv und ' +
    'meine eigene Erinnerung an diesen Chat, und späteres Fragen bringt sie nicht wieder. ' +
    'Kopien in den Sicherungen meines Hausherrn ' +
    'verblassen, sobald diese Sicherungen auslaufen.\n\n' +
    'Wenn du sicher bist, schreibe das Wort *löschen*. Nichts anderes tut es.',
  deleteNeedsWord:
    '🔥 Hierfür brauche ich das Wort selbst. Schreibe *löschen*, wenn du es wirklich meinst, ' +
    'oder *nein*, dann bleiben deine Worte verborgen.',
  deleted:
    '🔥 Es ist vollbracht. {n} deiner Nachrichten sind aus meinem Archiv verschwunden, und alles, ' +
    'was du mitgeschickt hast, ebenso.',
  deleteDeferred:
    '🌙 Deine Worte sind jetzt aus dem öffentlichen Archiv, niemand kann sie sehen. {held} davon ' +
    'darf ich noch nicht vernichten, weil sie geprüft werden. Sie bleiben die ganze Zeit ' +
    'verborgen. Das meiste wird nach der Prüfung vernichtet, aber wenn das Gesetz verlangt, ' +
    'dass etwas aufbewahrt wird, dann wird es aufbewahrt, und ich tue nicht so, als wäre es ' +
    'anders.',
  deleteRetrying:
    '🌙 Deine Worte sind jetzt aus dem öffentlichen Archiv, niemand kann sie sehen. {held} davon ' +
    'ließen sich nicht sauber vernichten, sie sind also noch da, verborgen. Ich versuche es ' +
    'weiter, bis sie fort sind, und der Betreiber wurde informiert.',
  deleteNothing:
    '🌙 Ich hatte nichts von dir im Archiv, es gab also nichts zu vernichten.',
  choiceNotRevoked:
    '🕯️ Es ist gerade nichts widerrufen, womit ich etwas tun könnte. Wenn du deine Worte aus ' +
    'dem öffentlichen Archiv haben willst, sag *{wake}, nimm mich zurück* und ich frage dich, ' +
    'was damit geschehen soll.',
  alreadyHidden:
    '🌙 Sie sind bereits verborgen. Deine Worte stehen nicht mehr im öffentlichen Archiv und ' +
    'nicht in der Suche, und ich bewahre sie für dich auf. Es wird nichts weiter vernichtet, ' +
    'solange du mich nicht darum bittest. Sag *{wake}, hol meine Worte zurück*, um sie ' +
    'zurückzuholen, oder *{wake}, lösche meine Worte*, um sie endgültig zu vernichten.',
  alreadyDestroyed:
    '🔥 Diese Worte wurden auf deinen Wunsch vernichtet, es ist also nichts mehr da, was ich ' +
    'verbergen oder zurückholen könnte. Sag *{wake}, veröffentliche mich*, wenn du neu ' +
    'anfangen willst.',
  restored:
    '✨ Willkommen zurück im Licht. Deine Worte stehen wieder im öffentlichen Archiv, genau so, ' +
    'wie sie waren.',
  restoreNotDeleted:
    '🔥 Diese Worte wurden vernichtet, nicht verborgen, es ist also nichts mehr da, was ich ' +
    'zurückholen könnte. Sag *{wake}, veröffentliche mich*, wenn du neu beginnen willst, ab ' +
    'diesem Moment an.',
  restoreConfirm:
    '✨ Soll ich deine verborgenen Worte zurück ans Licht tragen? Sie kehren genau so ins ' +
    'öffentliche Archiv zurück, wie sie waren, und jeder kann sie wieder lesen. Sag *ja*, und ' +
    'es ist getan.',
};

const RETORTS_EN = [
  '🕯️ It is *{wake}*. Say it in full, and I will answer to it.',
  '💅 Cindy? That is the name of someone who works at a nail salon in a strip mall. I run an archive.',
  '🌙 I have a full name. Use it, or I shall start calling you by your first two letters.',
  '⚡ Cindy is what the pumpkin calls me. You are not a pumpkin. Do better.',
  '📜 I have catalogued every word this group has spoken, and yet you cannot manage one name.',
  '👑 Princesses do not have nicknames. They have titles. Mine is *{wake}*.',
  '🔮 Somewhere a fairy godmother just felt a chill and does not know why.',
  '🕐 The clock struck midnight the moment you typed that. Coincidence? I think not.',
  '✨ I shall pretend I did not hear that, which is remarkable, because I hear everything.',
  '🗄️ Filed under: things I will remember far longer than you will.',
  '🧹 Say it again and you can sweep the ashes yourself.',
  '💎 It is *{wake}*. The glass slipper does not come in a shortened size either.',
];

const RETORTS_DE = [
  '🕯️ Es heißt *{wake}*. Sag es ganz, dann antworte ich darauf.',
  '💅 Cindy? So heißt jemand, der im Nagelstudio arbeitet. Ich führe ein Archiv.',
  '🌙 Ich habe einen vollen Namen. Benutze ihn, sonst nenne ich dich bei deinen ersten zwei Buchstaben.',
  '⚡ Cindy nennt mich der Kürbis. Du bist kein Kürbis. Streng dich an.',
  '📜 Ich habe jedes Wort dieser Gruppe verzeichnet, und du schaffst nicht einen Namen.',
  '👑 Prinzessinnen haben keine Spitznamen. Sie haben Titel. Meiner lautet *{wake}*.',
  '🔮 Irgendwo hat gerade eine gute Fee gefröstelt und weiß nicht, warum.',
  '🕐 In dem Moment, als du das getippt hast, schlug es Mitternacht. Zufall? Wohl kaum.',
  '✨ Ich tue so, als hätte ich das nicht gehört, was bemerkenswert ist, denn ich höre alles.',
  '🗄️ Abgelegt unter: Dinge, an die ich mich länger erinnere als du.',
  '🧹 Sag das noch einmal und du kannst die Asche selbst kehren.',
  '💎 Es heißt *{wake}*. Den gläsernen Schuh gibt es auch nicht in kurz.',
];

/**
 * What a NEW bot starts with (CCB-S5-009, D-163).
 *
 * ── WHY A NEW BOT NEEDS ITS OWN AND CANNOT HAVE HERS ─────────────────────────
 *
 * Read the twelve above. Three of them substitute `{wake}`; the other nine are her
 * mythology, not a template: Cindy by name, the pumpkin, the fairy godmother, midnight, the
 * ashes, the glass slipper. A bot called SANCH3Z inheriting that set tells a member that the
 * glass slipper does not come in a shortened size. That is not a flat retort, it is a
 * different character wearing her costume, and until this briefing it was what every new bot
 * actually did, because creation wrote no retort override and absence means inherit.
 *
 * ── WHY THESE ARE PLAIN, WHICH IS THE POINT AND NOT A COMPROMISE ─────────────
 *
 * A retort is CONTENT, not voice. `handleNickname` hands it to `personalizedBody` with the
 * bot's own personality and the ladder's sharpness bonus, so what a member reads is already
 * this bot's voice at this bot's dial setting. Writing character into the stored text would
 * be doing the voice layer's job a second time, worse, in a place the operator then has to
 * edit to undo.
 *
 * So these say the one thing a retort has to say, that this is not my name, and leave the
 * saying of it to the bot. They are ordinary editable text from the moment they are written:
 * the application owns them afterwards, and the Nicknames page is where they are changed.
 *
 * Six rather than twelve. `pickRetort` excludes only the immediately previous index, so six
 * rotates without repeating, and a starter set that looks authored invites being kept when
 * it should invite being replaced.
 */
export const NEW_BOT_RETORTS: Readonly<Record<string, readonly string[]>> = Object.freeze({
  en: Object.freeze([
    '🕯️ It is *{wake}*. Say it in full and I will answer.',
    '📎 Close, but that is not my name. I answer to *{wake}*.',
    '🗂️ I have one name and it is *{wake}*. Shortening it does not get you a faster answer.',
    '⌛ Wrong name. Try *{wake}* and we can get on with it.',
    '🔤 *{wake}*. All of it, please.',
    '📌 I did not answer because that is not what I am called. It is *{wake}*.',
  ]),
  de: Object.freeze([
    '🕯️ Ich heiße *{wake}*. Sag es ganz, dann antworte ich.',
    '📎 Fast, aber so heiße ich nicht. Ich höre auf *{wake}*.',
    '🗂️ Ich habe genau einen Namen: *{wake}*. Abkürzen macht die Antwort nicht schneller.',
    '⌛ Falscher Name. Versuch *{wake}*, dann geht es weiter.',
    '🔤 *{wake}*. Bitte ganz.',
    '📌 Ich habe nicht geantwortet, weil ich nicht so heiße. Ich heiße *{wake}*.',
  ]),
});

export const DEFAULT_INTERACTION: InteractionSettings = {
  addressing: {
    mode: 'relaxed',
    ignoreForwarded: true,
    silenceOnUnknown: true,
    strongSignalGreeting: true,
    strongSignalReply: true,
    strongSignalWindow: true,
    maxInstructionLength: 200,
    lengthGuardConfidence: 0.8,
    logNearMisses: true,
  },
  replyLanguageMode: 'auto',
  rememberMemberLanguage: true,
  intentCarryover: true,
  // A cheap second layer under the structural rule that carry-over may only
  // reuse an asset already pinned. These are the words that actually followed a
  // price answer in the live group.
  carryOverStopWords: [
    'nice', 'cool', 'thanks', 'thank you', 'thx', 'wow', 'lol', 'haha', 'hehe',
    'ok', 'okay', 'k', 'great', 'super', 'nett', 'danke', 'geil', 'krass',
    'stark', 'top', 'perfekt', 'alles klar',
  ],
  // Non-quoting by default (CCB-S3-003). Switch to `mention` to have her address
  // the member by name, or back to `quote` for the original behaviour.
  replyMode: 'plain',
  namePrefix: {
    enabled: true,
    // Stored WITHOUT a trailing space; the formatter owns the separator, so an
    // operator cannot accidentally save a prefix that runs into the sentence.
    templates: { en: '{name},', de: '{name},' },
  },
  naturalAddressing: true,
  wakeWord: 'Cinderella',
  archiveUrl: '',
  // Points at the project repo by default so "learn more" and the attribution link
  // work out of the box (CCB-S3-025); an operator running their own instance edits it.
  projectUrl: 'https://github.com/saschadaemgen/cinderella',
  botLabel: '(SimpleX AI Bot)',
  greetings: [
    'hi',
    'hey',
    'hello',
    'good morning',
    'good evening',
    'yo',
    "what's up",
    'hallo',
    'guten morgen',
    'guten abend',
    'moin',
    'servus',
  ],
  fillerPrefixes: [
    'so',
    'ok',
    'okay',
    'well',
    'and',
    'but',
    'btw',
    'also',
    'und',
    'naja',
    'sag mal',
    'hm',
    'hmm',
  ],
  maxPrefixWords: 3,
  maxPrefixChars: 20,
  followUpSeconds: 60,
  memory: { ...DEFAULT_HISTORY_LIMITS },
  recital: { ...DEFAULT_RECITAL_SETTINGS },
  invocationRecord: { enabled: true, retentionDays: 90 },
  bookScene: { enabled: true },
  confidenceThreshold: 0.55,
  affirmations: [
    'yes',
    'yeah',
    'yep',
    'yup',
    'y',
    'sure',
    'ok',
    'okay',
    'please do',
    'do it',
    'ja',
    'jo',
    'jup',
    'klar',
    'sicher',
    'mach das',
    'bitte',
  ],
  declines: [
    'no',
    'nope',
    'nah',
    'n',
    'stop',
    'cancel',
    'not now',
    'nein',
    'ne',
    'noe',
    'nicht',
    'abbrechen',
    'lass es',
  ],
  hideWords: ['hide', 'hidden', 'keep', 'keep them', 'verbergen', 'verstecken', 'behalten'],
  // `fold()` collapses umlauts before matching, so 'löschen' also covers
  // 'loeschen' without listing it. Both spellings are listed anyway, because this
  // list is operator-editable and the German word is the safety mechanism.
  deleteWords: ['delete', 'destroy', 'löschen', 'loeschen', 'lösche', 'loesche', 'vernichten'],
  replyLimitPerMember: 6,
  replyLimitPerChat: 20,
  undoWindowSeconds: 300,
  defaultLanguage: 'en',
  nicknames: {
    enabled: true,
    words: ['cindy', 'cindi', 'cin', 'ella'],
    spamLimit: 3,
  },
  persona: { en: PERSONA_EN, de: PERSONA_DE },
  retorts: { en: RETORTS_EN, de: RETORTS_DE },
};

/* ── Normalisation of untrusted input ────────────────────────────────────── */

function rec(v: unknown): Record<string, unknown> {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}

function bool(v: unknown, d: boolean): boolean {
  if (typeof v === 'boolean') return v;
  if (v === 'on' || v === 'true' || v === '1') return true;
  if (v === 'off' || v === 'false' || v === '0') return false;
  return d;
}

/** The numeric value of an admin field, which arrives as a form string. */
function parseNumeric(v: unknown, parse: (s: string) => number): number {
  if (typeof v === 'number') return v;
  if (typeof v === 'string') return parse(v);
  return Number.NaN;
}

function int(v: unknown, min: number, max: number, d: number): number {
  const n = parseNumeric(v, (s) => Number.parseInt(s, 10));
  if (!Number.isFinite(n)) return d;
  return Math.min(max, Math.max(min, Math.trunc(n)));
}

function num(v: unknown, min: number, max: number, d: number): number {
  const n = parseNumeric(v, (s) => Number.parseFloat(s));
  if (!Number.isFinite(n)) return d;
  return Math.min(max, Math.max(min, n));
}

/** An https URL, trimmed, or '' — the help footer never renders a bad link. */
function httpsOrEmpty(v: string): string {
  const t = v.trim();
  if (!t) return '';
  try {
    return new URL(t).protocol === 'https:' ? t : '';
  } catch {
    return '';
  }
}

function str(v: unknown, d: string, maxLen: number): string {
  return typeof v === 'string' ? v.slice(0, maxLen) : d;
}

/** The longest a wake word may be. Shared by the settings page and bot creation. */
export const WAKE_WORD_MAX_CHARS = 40;

/**
 * ONE definition of what a usable wake word is (CCB-S5-009).
 *
 * There were two. `normalizeInteraction` truncated to 40 and trimmed; `wakeWordForNewBot`
 * trimmed and REJECTED anything over 40, which is a different rule with a live consequence:
 * a bot whose display name ran long got no wake-word override at all and therefore inherited
 * the shared one, so it answered to "Cinderella". That is precisely the defect CCB-S5-006
 * exists to prevent, still reachable through the door CCB-S5-006 built.
 *
 * So both callers come here. Truncation rather than rejection, because the settings page has
 * always truncated and an operator who pastes something long wants the front of it, not a
 * refusal. Returns null only when nothing usable survives, which the caller must handle as a
 * real state rather than as a value.
 */
export function normalizeWakeWord(raw: unknown): string | null {
  if (wakeWordProblem(raw) !== null) return null;
  // Inner runs collapse to one space (CCB-S5-014). CCB-S5-009 did this and was right for the
  // wrong reason: it argued that a double space "renders identically" while the real problem
  // was that ANY space made the value inert, so collapsing preserved a broken value and looked
  // like a fix. Multi-token names work now, so collapsing is simply correct: `San  chez` and
  // `San chez` are the same two tokens to `detectAddress`, and storing the ragged one would
  // show an operator two spellings of one name.
  return (raw as string).trim().replace(/\s+/g, ' ').slice(0, WAKE_WORD_MAX_CHARS).trim();
}

/**
 * Why this wake word cannot be stored, in a sentence an operator can act on, or null.
 *
 * ── THE WHITESPACE REFUSAL WAS TEMPORARY AND IS LIFTED (CCB-S5-014, D-172) ───
 *
 * `detectAddress` matches ONE token: it compares `tokens[skip].norm` against the whole
 * folded wake word, so a value containing a space can never match anything. There is no
 * path through `matchesWakeWord` that survives one, and the length gate rejects it before
 * Levenshtein is even reached. A multi-word wake word is therefore INERT: the bot cannot be
 * addressed by name at all, and nothing anywhere said so.
 *
 * That is how "Rick Sanchez" reached production. CCB-S5-009 derived the wake word from the
 * display name, two-word display names are ordinary, and the normalizer this replaces
 * actively PRESERVED the space: it collapsed runs of whitespace to a single space, which
 * keeps a multi-word value alive rather than rejecting it. Its comment blamed double spaces.
 * The cause is any space, and the normalizer was tidying toward the defect.
 *
 * ── AND IT IS NOT A CONSIDERED LIMIT ─────────────────────────────────────────
 *
 * Bots are named in two words as a matter of course, and telling an operator to rename his
 * bot is not a fix. **CCB-S5-014 makes the detector match multi-token wake words** and lifts
 * this refusal. It is its own briefing because the anchoring, the prefix-character
 * accounting, nickname matching and `{wake}` substitution all move with it, which is a
 * feature and not a validator change. Until then a refusal beats storing something inert:
 * a bot nobody can address is invisible, and this at least says so at the moment of typing.
 *
 * Read as a reason rather than a boolean so creation and the settings page print the same
 * sentence instead of inventing two.
 */
export function wakeWordProblem(raw: unknown): string | null {
  if (typeof raw !== 'string' || raw.trim() === '') {
    return 'A wake word is required: it is what members call the bot and what wakes it.';
  }
  const trimmed = raw.trim();
  // THE WHITESPACE REFUSAL IS GONE (CCB-S5-014, D-172). It lived here because
  // `detectAddress` matched ONE token, so a name with a space in it was inert. The detector
  // matches a token SEQUENCE now, so "Rick Sanchez" works and refusing it would be the same
  // defect inverted: a validator turning away values the detector has learned to match, which
  // is far harder to diagnose than one that never matched.
  if (trimmed.length < 2) {
    return 'A wake word needs at least 2 characters, or it would match almost anything.';
  }
  return null;
}

/**
 * A word list from either a real array or the admin form's free text. Both a
 * comma-separated line (greetings, nicknames) and a newline-separated block
 * (retorts) round-trip through here, so the same field type serves both.
 */
export function parseList(
  v: unknown,
  opts: { max: number; maxLen: number; lines?: boolean },
): string[] {
  const raw = Array.isArray(v)
    ? v.map((x) => String(x))
    : typeof v === 'string'
      ? opts.lines
        ? v.split(/\r?\n/)
        : v.split(',')
      : [];
  const out: string[] = [];
  for (const item of raw) {
    const s = item.trim().slice(0, opts.maxLen);
    if (s && !out.includes(s)) out.push(s);
    if (out.length >= opts.max) break;
  }
  return out;
}

/**
 * Falls back to the shipped list when the operator empties a field whose emptiness
 * would remove a capability rather than disable one (CCB-S3-013).
 */
function orDefault(parsed: string[], fallback: string[]): string[] {
  return parsed.length > 0 ? parsed : [...fallback];
}

/** A language code we are willing to store as a persona/retort key. */
function isLangCode(s: string): boolean {
  return /^[a-z]{2}(-[a-z]{2})?$/.test(s);
}

/**
 * A persona value, defaulted per key. Blank restores the default for every key;
 * the `help` field ALSO restores the default when the stored template is missing a
 * required placeholder (CCB-S3-021 §3), so a pre-CCB-S3-021 one-line help, or any
 * template lacking {commands}/{consent}, never renders a help without its command
 * list or publishing properties.
 */
function personaValue(key: PersonaKey, v: string, fallback: string): string {
  if (key === 'help') return v && missingHelpPlaceholders(v).length === 0 ? v : fallback;
  return v || fallback;
}

function normalizePersona(input: unknown): Record<string, PersonaStrings> {
  const src = rec(input);
  const out: Record<string, PersonaStrings> = {};

  // Shipped languages always exist, falling back to the preconfigured copy per
  // key — an operator who blanks one string gets the default back, never an
  // empty message.
  for (const lang of SHIPPED_LANGS) {
    const fallback = DEFAULT_INTERACTION.persona[lang] as PersonaStrings;
    const given = rec(src[lang]);
    const strings = {} as PersonaStrings;
    for (const key of PERSONA_KEYS) {
      const v = str(given[key], '', 2000).trim();
      strings[key] = personaValue(key, v, fallback[key]);
    }
    out[lang] = strings;
  }

  // Extra languages an operator has added: kept as-is, with English as the
  // per-key floor so a half-translated language still says something.
  for (const [lang, value] of Object.entries(src)) {
    if (out[lang] || !isLangCode(lang)) continue;
    const given = rec(value);
    const strings = {} as PersonaStrings;
    for (const key of PERSONA_KEYS) {
      const v = str(given[key], '', 2000).trim();
      strings[key] = personaValue(key, v, PERSONA_EN[key]);
    }
    out[lang] = strings;
  }
  return out;
}

function normalizeRetorts(input: unknown): Record<string, string[]> {
  const src = rec(input);
  const out: Record<string, string[]> = {};
  for (const lang of SHIPPED_LANGS) {
    const list = parseList(src[lang], { max: 50, maxLen: 500, lines: true });
    out[lang] = list.length > 0 ? list : (DEFAULT_INTERACTION.retorts[lang] as string[]);
  }
  for (const [lang, value] of Object.entries(src)) {
    if (out[lang] || !isLangCode(lang)) continue;
    const list = parseList(value, { max: 50, maxLen: 500, lines: true });
    if (list.length > 0) out[lang] = list;
  }
  return out;
}

/**
 * Prefix templates per language. Stored trimmed — the formatter contributes the
 * single separating space — and never empty, because an operator who wants no
 * prefix turns `enabled` off rather than saving a blank that would silently look
 * like a bug.
 */
function normalizeNamePrefix(input: unknown): Record<string, string> {
  const src = rec(input);
  const out: Record<string, string> = {};
  const fallback = DEFAULT_INTERACTION.namePrefix.templates;
  for (const lang of SHIPPED_LANGS) {
    const v = str(src[lang], '', 80).trim();
    out[lang] = v || (fallback[lang] as string);
  }
  for (const [lang, value] of Object.entries(src)) {
    if (out[lang] || !isLangCode(lang)) continue;
    const v = str(value, '', 80).trim();
    if (v) out[lang] = v;
  }
  return out;
}

export function normalizeInteraction(input: unknown): InteractionSettings {
  const d = DEFAULT_INTERACTION;
  const o = rec(input);
  const nick = rec(o['nicknames']);
  const prefix = rec(o['namePrefix']);
  const addr = rec(o['addressing']);

  const rawAddressingMode = str(addr['mode'], d.addressing.mode, 16).trim().toLowerCase();
  const addressingMode: AddressingMode = (ADDRESSING_MODES as readonly string[]).includes(
    rawAddressingMode,
  )
    ? (rawAddressingMode as AddressingMode)
    : d.addressing.mode;

  const rawLangMode = str(o['replyLanguageMode'], d.replyLanguageMode, 16).trim().toLowerCase();
  const replyLanguageMode: ReplyLanguageMode = (REPLY_LANGUAGE_MODES as readonly string[]).includes(
    rawLangMode,
  )
    ? (rawLangMode as ReplyLanguageMode)
    : d.replyLanguageMode;

  const persona = normalizePersona(o['persona']);
  const retorts = normalizeRetorts(o['retorts']);

  // An unknown or absent mode falls back to the non-quoting default rather than
  // throwing — this value arrives from a form and from stored JSON written by
  // older builds, neither of which is trusted.
  const rawMode = str(o['replyMode'], d.replyMode, 16).trim().toLowerCase();
  const replyMode: ReplyMode = (REPLY_MODES as readonly string[]).includes(rawMode)
    ? (rawMode as ReplyMode)
    : d.replyMode;

  // The wake word is the whole addressing model — an empty one would either
  // match nothing or match everything, so it never becomes empty. Through
  // `normalizeWakeWord` since CCB-S5-009, which is the same function bot creation
  // uses: two implementations of "what is a usable wake word" is how a long
  // display name came to produce no wake word at all.
  const wakeWord = normalizeWakeWord(o['wakeWord']) ?? d.wakeWord;


  const defaultLanguage = str(o['defaultLanguage'], d.defaultLanguage, 5).trim().toLowerCase();

  return {
    addressing: {
      mode: addressingMode,
      ignoreForwarded: bool(addr['ignoreForwarded'], d.addressing.ignoreForwarded),
      silenceOnUnknown: bool(addr['silenceOnUnknown'], d.addressing.silenceOnUnknown),
      strongSignalGreeting: bool(addr['strongSignalGreeting'], d.addressing.strongSignalGreeting),
      strongSignalReply: bool(addr['strongSignalReply'], d.addressing.strongSignalReply),
      strongSignalWindow: bool(addr['strongSignalWindow'], d.addressing.strongSignalWindow),
      maxInstructionLength: int(
        addr['maxInstructionLength'],
        20,
        4000,
        d.addressing.maxInstructionLength,
      ),
      lengthGuardConfidence: num(
        addr['lengthGuardConfidence'],
        0,
        1,
        d.addressing.lengthGuardConfidence,
      ),
      logNearMisses: bool(addr['logNearMisses'], d.addressing.logNearMisses),
    },
    replyLanguageMode,
    rememberMemberLanguage: bool(o['rememberMemberLanguage'], d.rememberMemberLanguage),
    intentCarryover: bool(o['intentCarryover'], d.intentCarryover),
    carryOverStopWords:
      'carryOverStopWords' in o
        ? parseList(o['carryOverStopWords'], { max: 120, maxLen: 40 })
        : [...d.carryOverStopWords],
    replyMode,
    namePrefix: {
      enabled: bool(prefix['enabled'], d.namePrefix.enabled),
      templates: normalizeNamePrefix(prefix['templates']),
    },
    naturalAddressing: bool(o['naturalAddressing'], d.naturalAddressing),
    wakeWord,
    archiveUrl: httpsOrEmpty(str(o['archiveUrl'], d.archiveUrl, 200)),
    projectUrl: httpsOrEmpty(str(o['projectUrl'], d.projectUrl, 200)),
    botLabel: str(o['botLabel'], d.botLabel, 60).trim(),
    greetings:
      'greetings' in o ? parseList(o['greetings'], { max: 60, maxLen: 40 }) : [...d.greetings],
    fillerPrefixes:
      'fillerPrefixes' in o
        ? parseList(o['fillerPrefixes'], { max: 60, maxLen: 40 })
        : [...d.fillerPrefixes],
    maxPrefixWords: int(o['maxPrefixWords'], 0, 6, d.maxPrefixWords),
    maxPrefixChars: int(o['maxPrefixChars'], 0, 80, d.maxPrefixChars),
    followUpSeconds: int(o['followUpSeconds'], 0, 3600, d.followUpSeconds),
    // Bounded by the model rather than by the form, so a hand-crafted POST cannot produce
    // a history that crowds her own rules out of the context.
    memory: normalizeHistoryLimits(o['memory'] as Partial<Record<keyof HistoryLimits, unknown>>),
    recital: normalizeRecitalSettings(
      o['recital'] as Partial<Record<keyof RecitalSettings, unknown>>,
    ),
    bookScene: {
      // The LEGACY KEY is read as a fallback, and it is not a courtesy. `bookStory` is what
      // CCB-S4-050 persisted, so an operator who had switched the Book answer OFF has that
      // decision stored under the old name; ignoring it would silently switch a feature back
      // on in production during a rename. Once `bookScene` has been saved once, it wins.
      enabled:
        (o['bookScene'] as { enabled?: unknown } | undefined)?.enabled !== false &&
        (o['bookStory'] as { enabled?: unknown } | undefined)?.enabled !== false,
    },
    invocationRecord: {
      enabled: (o['invocationRecord'] as { enabled?: unknown } | undefined)?.enabled !== false,
      // Clamped in code as well as in the form, like every other bound on this path.
      retentionDays: int(
        (o['invocationRecord'] as { retentionDays?: unknown } | undefined)?.retentionDays,
        0,
        3650,
        d.invocationRecord.retentionDays,
      ),
    },
    confidenceThreshold: num(o['confidenceThreshold'], 0, 1, d.confidenceThreshold),
    affirmations:
      'affirmations' in o
        ? parseList(o['affirmations'], { max: 60, maxLen: 40 })
        : [...d.affirmations],
    declines: 'declines' in o ? parseList(o['declines'], { max: 60, maxLen: 40 }) : [...d.declines],
    hideWords:
      'hideWords' in o ? parseList(o['hideWords'], { max: 60, maxLen: 40 }) : [...d.hideWords],
    // Emptying this list would leave no way to confirm a destruction at all, which
    // is a safe failure but a confusing one, so it falls back to the shipped words.
    deleteWords:
      'deleteWords' in o
        ? orDefault(parseList(o['deleteWords'], { max: 60, maxLen: 40 }), d.deleteWords)
        : [...d.deleteWords],
    replyLimitPerMember: int(o['replyLimitPerMember'], 1, 120, d.replyLimitPerMember),
    replyLimitPerChat: int(o['replyLimitPerChat'], 1, 600, d.replyLimitPerChat),
    undoWindowSeconds: int(o['undoWindowSeconds'], 0, 86400, d.undoWindowSeconds),
    defaultLanguage: persona[defaultLanguage] ? defaultLanguage : d.defaultLanguage,
    nicknames: {
      enabled: bool(nick['enabled'], d.nicknames.enabled),
      words:
        'words' in nick
          ? parseList(nick['words'], { max: 40, maxLen: 40 })
          : [...d.nicknames.words],
      // Ceiling raised from 20 to 1000 (CCB-S4-031). Calling her by a nickname became a
      // running game in the operator's group, and 20 consecutive tries is a cap that
      // ends the game rather than bounding an abuse. The floor stays 1 and the shipped
      // default is unchanged: this widens what an operator MAY choose, not what they get.
      spamLimit: int(nick['spamLimit'], 1, 1000, d.nicknames.spamLimit),
    },
    persona,
    retorts,
  };
}

/** Fills `{placeholders}` in a persona string. Unknown placeholders stay put. */
export function fillPersona(template: string, vars: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? String(vars[k]) : m));
}

const INTERACTION_KEY = 'interaction';

/**
 * In-process cache of the interaction settings, refreshed on write — the bot
 * reads these on every incoming message, so it must never hit the DB per message.
 */
/**
 * ── PER BOT SINCE CCB-S5-006 ─────────────────────────────────────────────────
 *
 * This held ONE settings record and handed it to every bot, which is how two hosted bots
 * came to answer to the same name: `wakeWord` lives here, one instance was shared, and both
 * bots woke on it. The record is still one record; what changed is that a bot may DEVIATE
 * from it, on the mechanism D-155 established for the laws.
 *
 * The cache is keyed by bot beside the shared value, and invalidation is whole-cache for
 * the reason the rule service gives: a per-key invalidation that missed the key that
 * mattered would leave a bot answering to a name the console says it no longer has.
 */
export class InteractionService {
  private readonly perBot = new Map<number, InteractionSettings>();
  private readonly inFlight = new Map<number, Promise<void>>();

  private constructor(
    private readonly db: Queryable,
    private current: InteractionSettings,
  ) {}

  static async load(db: Queryable): Promise<InteractionService> {
    const stored = await getSetting(db, INTERACTION_KEY);
    return new InteractionService(db, normalizeInteraction(stored ?? {}));
  }

  /** All-defaults service for harnesses and for buildServer's fallback path. */
  static withDefaults(db: Queryable): InteractionService {
    return new InteractionService(db, normalizeInteraction({}));
  }

  /**
   * The settings, for a bot or shared.
   *
   * With no bot named this is the SHARED record, which is what the console's default view
   * and every deployment-wide reader want. The reply path always names one: a bot reading
   * the shared record would be reading another bot's name.
   */
  get(botProfileId?: number): InteractionSettings {
    if (botProfileId === undefined) return this.current;
    const cached = this.perBot.get(botProfileId);
    if (cached !== undefined) return cached;
    void this.kickRefreshFor(botProfileId);
    // The SHARED record while the deviations load, which is the same trade the rule service
    // makes: the shared value IS the setting and a deviation is a departure from it, so a
    // bot briefly reading what it inherits is a smaller wrong than a bot reading nothing.
    // The window is one query on the first message after a save.
    return this.current;
  }

  /** Load one bot's effective settings. */
  async refreshFor(botProfileId: number): Promise<void> {
    try {
      // THE DISPLAY NAME IS READ HERE (CCB-S5-030), because it is now the wake word's
      // fallback: a bot with no override answers to its OWN name rather than to the shared
      // one, which is what makes a rename carry through. One small query beside the one that
      // already runs once per bot per invalidation.
      const [overrides, displayName] = await Promise.all([
        listSettingOverridesForBot(this.db, botProfileId),
        botDisplayName(this.db, botProfileId),
      ]);
      this.perBot.set(
        botProfileId,
        // Undefined rather than an empty string when the row is gone: an empty name derives
        // nothing and would quietly hand the bot the shared name back, which is the exact
        // behaviour this change exists to remove.
        applySettingOverrides(this.current, overrides, displayName ?? undefined),
      );
    } catch (error) {
      log.warn(
        `Interaction: reading bot ${botProfileId}'s settings failed; it is answering from ` +
          `the shared ones (${error instanceof Error ? error.message : String(error)}).`,
      );
      status.error(
        `The per-bot interaction settings of bot ${botProfileId} could not be read. It is ` +
          `using the shared ones, so its wake word and retorts may not be its own.`,
      );
    }
  }

  private kickRefreshFor(botProfileId: number): Promise<void> {
    let p = this.inFlight.get(botProfileId);
    if (p === undefined) {
      p = this.refreshFor(botProfileId).finally(() => this.inFlight.delete(botProfileId));
      this.inFlight.set(botProfileId, p);
    }
    return p;
  }

  /** Drop every per-bot value. Called after any save, shared or per bot. */
  invalidate(): void {
    this.perBot.clear();
  }

  async save(next: unknown, actor: string): Promise<InteractionSettings> {
    const normalized = normalizeInteraction(next);
    await setSetting(this.db, INTERACTION_KEY, normalized);
    await writeAudit(this.db, actor, 'interaction.update', 'interaction', normalized);
    this.current = normalized;
    // Every bot's effective settings are derived from this one, so a shared save
    // invalidates all of them. Cheap: one query per bot on its next message.
    this.perBot.clear();
    return normalized;
  }
}
