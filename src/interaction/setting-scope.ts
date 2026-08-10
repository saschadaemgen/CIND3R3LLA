/**
 * Which interaction settings belong to one bot, and which to the deployment
 * (CCB-S5-006, D-158).
 *
 * ── THE DEFECT ───────────────────────────────────────────────────────────────
 *
 * CCB-S5-001 made personality and standard laws per bot and left the Interaction settings
 * shared. That was not a decision: the briefing named personality and laws, never mentioned
 * identity, and nothing pointed at it. So `wakeWord` stayed in one shared record handed to
 * every hosted bot, and TWO BOTS ANSWERED TO THE SAME NAME. In separate groups that hides
 * itself, which makes it worse rather than better.
 *
 * The wake word was not alone. The nickname list and its retorts are shared too, so a second
 * bot would answer to "Cindy" with retorts written in the first bot's voice, about the first
 * bot's name.
 *
 * ── THE INVENTORY IS DATA, NOT PROSE ─────────────────────────────────────────
 *
 * {@link SETTING_SCOPES} below is the briefing's deliverable in executable form. Writing it
 * as a table in a document would let the code and the table drift, and the drift would be
 * invisible: a setting added later would simply be shared by default, silently, which is
 * exactly how `wakeWord` came to be shared in the first place.
 *
 * As data it can be checked. `verify:interaction-scope` asserts that EVERY key of
 * `InteractionSettings` appears here, so adding a setting without placing it fails a check
 * rather than defaulting to whichever answer the type happened to produce.
 *
 * ── ONE MECHANISM, NOT TWO ───────────────────────────────────────────────────
 *
 * Shared defaults with per-bot deviations, exactly as D-155 established for the laws: a
 * value the operator has not set for a bot is INHERITED rather than copied, so editing the
 * shared value still reaches every bot that has not deviated. Copying at creation time
 * would have been simpler to write and wrong in the same way a forked rulebook is wrong -
 * "what is this setting" would have N answers with no way to tell which was the default.
 */

import { normalizeWakeWord, type InteractionSettings } from './settings.js';

/** Where a setting lives. */
export type SettingScope =
  /** One value for the deployment. Editing it reaches every bot. */
  | 'shared'
  /** Each bot may deviate; unset means inherit the shared value. */
  | 'per-bot';

export interface SettingPlacement {
  /** Dotted path into {@link InteractionSettings}. */
  key: string;
  scope: SettingScope;
  /** The console tab it appears on, so the page can group its badges. */
  section: string;
  /** One line, shown in the console beside the setting. */
  reason: string;
}

/**
 * THE INVENTORY.
 *
 * Every top-level key of `InteractionSettings`, and every nested key that an operator can
 * set independently. Nested keys are listed individually where the halves genuinely differ
 * in scope - `nicknames.words` is identity and `nicknames.spamLimit` is a flood bound - and
 * as a whole where they do not.
 */
export const SETTING_SCOPES: readonly SettingPlacement[] = Object.freeze([
  /* ── Addressing ─────────────────────────────────────────────────────────── */
  {
    key: 'wakeWord',
    scope: 'per-bot',
    section: 'addressing',
    reason: 'It is her name. Two bots sharing one is the defect this briefing exists to fix.',
  },
  {
    key: 'naturalAddressing',
    scope: 'shared',
    section: 'addressing',
    reason: 'Whether plain language reaches bots at all is a policy for the community, not for one bot.',
  },
  {
    key: 'addressing.mode',
    scope: 'shared',
    section: 'addressing',
    reason: 'How hard any bot insists on being addressed. One answer per community keeps it debuggable.',
  },
  {
    key: 'addressing.ignoreForwarded',
    scope: 'shared',
    section: 'addressing',
    reason: 'A property of forwarded messages, not of the bot reading them.',
  },
  {
    key: 'greetings',
    scope: 'shared',
    section: 'addressing',
    reason: '"hey" and "hi" precede any name. Language, not identity.',
  },
  {
    key: 'fillerPrefixes',
    scope: 'shared',
    section: 'addressing',
    reason: '"ok", "so": discourse fillers that precede any name. Language, not identity.',
  },
  {
    key: 'maxPrefixWords',
    scope: 'shared',
    section: 'addressing',
    reason: 'A parser bound on how much may precede a name, whoever the name belongs to.',
  },
  {
    key: 'maxPrefixChars',
    scope: 'shared',
    section: 'addressing',
    reason: 'The character form of the same parser bound.',
  },

  /* ── Guards ─────────────────────────────────────────────────────────────── */
  //
  // PER BOT, and this was the one genuinely arguable group. The case for shared is that
  // "was she addressed" is a question about the MESSAGE, and one threshold is easier to
  // debug than N. The operator chose per bot so a sharper bot can run a different
  // confidence floor from a gentler one, which is the same argument that makes the dials
  // per bot. `logNearMisses` stays shared: it is a debugging switch, not a threshold.
  {
    key: 'addressing.silenceOnUnknown',
    scope: 'per-bot',
    section: 'guards',
    reason: 'A sharper bot may want to answer where a gentler one stays quiet.',
  },
  {
    key: 'addressing.strongSignalGreeting',
    scope: 'per-bot',
    section: 'guards',
    reason: 'What counts as being addressed can reasonably differ between two characters.',
  },
  {
    key: 'addressing.strongSignalReply',
    scope: 'per-bot',
    section: 'guards',
    reason: 'Whether a direct reply counts as being addressed can differ between two characters.',
  },
  {
    key: 'addressing.strongSignalWindow',
    scope: 'per-bot',
    section: 'guards',
    reason: 'Whether arrival inside the follow-up window counts. Travels with the other signals.',
  },
  {
    key: 'addressing.maxInstructionLength',
    scope: 'per-bot',
    section: 'guards',
    reason: 'A terse bot may want a tighter bound than an expansive one.',
  },
  {
    key: 'addressing.lengthGuardConfidence',
    scope: 'per-bot',
    section: 'guards',
    reason: 'Travels with the length bound it qualifies.',
  },
  {
    key: 'confidenceThreshold',
    scope: 'per-bot',
    section: 'guards',
    reason: 'The floor below which an instruction is UNKNOWN. Per bot for the same reason as the rest.',
  },
  {
    key: 'addressing.logNearMisses',
    scope: 'shared',
    section: 'guards',
    reason: 'A diagnostic switch for the operator, not a behaviour of any one bot.',
  },

  /* ── Follow-up ──────────────────────────────────────────────────────────── */
  {
    key: 'followUpSeconds',
    scope: 'shared',
    section: 'followup',
    reason: 'How long a conversation stays open. A property of conversations.',
  },
  {
    key: 'intentCarryover',
    scope: 'shared',
    section: 'followup',
    reason: 'Whether a short follow-up inherits an intent. Mechanics, not voice.',
  },
  {
    key: 'carryOverStopWords',
    scope: 'shared',
    section: 'followup',
    reason: 'Words that never carry an intent. A language fact.',
  },

  /* ── Language ───────────────────────────────────────────────────────────── */
  {
    key: 'replyLanguageMode',
    scope: 'shared',
    section: 'language',
    reason: 'Which language the deployment answers in.',
  },
  {
    key: 'rememberMemberLanguage',
    scope: 'shared',
    section: 'language',
    reason: 'A property of the member, who is the same member whichever bot they addressed.',
  },
  {
    key: 'defaultLanguage',
    scope: 'shared',
    section: 'language',
    reason: 'The fallback language for the community.',
  },

  /* ── Memory ─────────────────────────────────────────────────────────────── */
  {
    key: 'memory',
    scope: 'shared',
    section: 'memory',
    reason:
      'How far back any bot may see. A context-budget decision, and the ceiling that keeps her rules in the window is the same for all of them.',
  },

  /* ── Replies ────────────────────────────────────────────────────────────── */
  {
    key: 'replyMode',
    scope: 'shared',
    section: 'replies',
    reason: 'Whether answers quote, mention or run plain. A readability choice for the group.',
  },
  {
    key: 'namePrefix',
    scope: 'shared',
    section: 'replies',
    reason: 'How a member is addressed in mention mode. About the member, not the bot.',
  },
  {
    key: 'replyLimitPerMember',
    scope: 'shared',
    section: 'replies',
    reason:
      'The NUMBER is shared; the budget is already spent per bot, because each engine holds its own conversation state (CCB-S5-001).',
  },
  {
    key: 'replyLimitPerChat',
    scope: 'shared',
    section: 'replies',
    reason: 'The per-chat form of the same flood bound, spent per bot for the same reason.',
  },

  /* ── Nicknames ──────────────────────────────────────────────────────────── */
  {
    key: 'nicknames.words',
    scope: 'per-bot',
    section: 'nicknames',
    reason: '"Cindy" is a pet form of ONE name. A second bot inheriting them refuses names nobody called it.',
  },
  {
    key: 'retorts',
    scope: 'per-bot',
    section: 'nicknames',
    reason:
      'Written in her voice, about her name. A bot inheriting them would speak as her about a name that is not its own.',
  },
  {
    key: 'nicknames.enabled',
    scope: 'shared',
    section: 'nicknames',
    reason: 'Whether the behaviour runs at all. A switch, not a name.',
  },
  {
    key: 'nicknames.spamLimit',
    scope: 'shared',
    section: 'nicknames',
    reason: 'A flood bound. The same protection whoever is being poked.',
  },

  /* ── Consent behaviour ──────────────────────────────────────────────────── */
  //
  // SHARED, all of it, and this is the one the briefing states outright. Consent is a
  // property of the archive and the member, not of which bot happened to be spoken to. Two
  // bots offering different consent terms in one community would be a real defect, and the
  // words that CONFIRM a consent change are part of those terms.
  {
    key: 'affirmations',
    scope: 'shared',
    section: 'consent',
    reason: 'Consent is a property of the archive and the member, never of which bot was addressed.',
  },
  {
    key: 'declines',
    scope: 'shared',
    section: 'consent',
    reason: 'The word that cancels a consent change must mean the same to every bot in the group.',
  },
  {
    key: 'hideWords',
    scope: 'shared',
    section: 'consent',
    reason: 'Choosing to hide rather than destroy is a decision about the archive, not about a bot.',
  },
  {
    key: 'deleteWords',
    scope: 'shared',
    section: 'consent',
    reason: 'The word that destroys content for good. One vocabulary, or a member could destroy by accident.',
  },
  {
    key: 'undoWindowSeconds',
    scope: 'shared',
    section: 'consent',
    reason: 'How long a member may take a consent action back. One answer for the archive.',
  },

  /* ── Voice ──────────────────────────────────────────────────────────────── */
  {
    key: 'persona',
    scope: 'per-bot',
    section: 'voice',
    reason:
      'The deterministic voice. It follows the personality, and several strings contain {wake}, which is now per bot.',
  },
  {
    key: 'botLabel',
    scope: 'per-bot',
    section: 'voice',
    reason: 'An answer to "what are you". Identity.',
  },
  {
    key: 'archiveUrl',
    scope: 'shared',
    section: 'voice',
    reason:
      'Reads as identity and is actually a DESTINATION: one public archive that every bot writes to.',
  },
  {
    key: 'projectUrl',
    scope: 'shared',
    section: 'voice',
    reason: 'One project. Same reasoning as the archive address.',
  },

  /* ── The Book, and the record of it ─────────────────────────────────────── */
  {
    key: 'recital',
    scope: 'shared',
    section: 'voice',
    reason:
      'There is one Book. Per-bot laws already make each bot read a different set; how the reading is PACED need not also differ.',
  },
  {
    key: 'bookScene',
    scope: 'shared',
    section: 'voice',
    reason: 'The Book told as an artefact. One Book, so one telling of it.',
  },
  {
    key: 'invocationRecord',
    scope: 'shared',
    section: 'diagnostics',
    reason: 'An operator-facing record and its retention. The rows already carry which bot fired.',
  },
]);

/** One bot's deviation from one setting. NULL value is not representable: absence means inherit. */
export interface SettingOverride {
  botProfileId: number;
  key: string;
  /** Parsed JSON. The shape is whatever the setting's type is. */
  value: unknown;
}

const byKey = new Map(SETTING_SCOPES.map((p) => [p.key, p]));

/** Where a setting lives, or undefined when it has not been placed. */
export function placementOf(key: string): SettingPlacement | undefined {
  return byKey.get(key);
}

/** Whether a setting may be set for one bot. */
export function isPerBot(key: string): boolean {
  return byKey.get(key)?.scope === 'per-bot';
}

/**
 * Why a shared setting cannot be set per bot, in a sentence a console can print.
 *
 * Matches the Book's `CONSTITUTIONAL_SCOPE_REASON` in shape and purpose: the briefing asks
 * that a setting which cannot be per bot SAY so with the reason, rather than offering a
 * control that then refuses. The per-setting reason is in the inventory; this is the frame
 * around it.
 */
export function sharedReason(key: string): string {
  const p = byKey.get(key);
  return p === undefined
    ? `${key} has not been placed, so it cannot be set for one bot until somebody decides where it belongs.`
    : `Shared across every bot. ${p.reason}`;
}

/** Read a dotted path out of a settings object. */
export function readPath(settings: InteractionSettings, key: string): unknown {
  return key
    .split('.')
    .reduce<unknown>((acc, part) => (acc as Record<string, unknown> | undefined)?.[part], settings);
}

/** Write a dotted path into a COPY of a settings object, leaving the original alone. */
export function writePath(
  settings: InteractionSettings,
  key: string,
  value: unknown,
): InteractionSettings {
  const parts = key.split('.');
  const clone = structuredClone(settings) as unknown as Record<string, unknown>;
  let cursor = clone;
  for (const part of parts.slice(0, -1)) {
    const next = cursor[part];
    if (typeof next !== 'object' || next === null) return clone as unknown as InteractionSettings;
    cursor = next as Record<string, unknown>;
  }
  const last = parts[parts.length - 1];
  if (last !== undefined) cursor[last] = value;
  return clone as unknown as InteractionSettings;
}

/**
 * One bot's effective settings: the shared record with that bot's deviations applied.
 *
 * A deviation on a SHARED key is ignored rather than applied. The database refuses to store
 * one, so reaching this means something got past that; ignoring it here is the difference
 * between a defence in depth and a comment claiming one, exactly as `applyOverrides` does
 * for a constitutional law.
 */
export function applySettingOverrides(
  shared: InteractionSettings,
  overrides: readonly SettingOverride[],
): InteractionSettings {
  let out = shared;
  for (const o of overrides) {
    if (!isPerBot(o.key)) continue;
    out = writePath(out, o.key, o.value);
  }
  return out;
}

export interface SettingScopeView {
  key: string;
  scope: SettingScope;
  section: string;
  reason: string;
  /** Bots that deviate from the shared value. Empty for a shared setting. */
  deviatingBotIds: number[];
  /** How many bots read the SHARED value. Excludes the deviating ones. */
  sharedBotCount: number;
}

/**
 * What the console has to say about every setting's scope.
 *
 * `sharedBotCount` excludes the bots that deviate, for the reason the Book's version does:
 * a setting three of five bots have overridden reaches two, and an edit warning that said
 * five would be a false number on the one control whose job is to be trusted.
 */
export function describeSettingScopes(
  overrides: readonly SettingOverride[],
  botCount: number,
): Map<string, SettingScopeView> {
  const deviations = new Map<string, number[]>();
  for (const o of overrides) {
    if (!isPerBot(o.key)) continue;
    const list = deviations.get(o.key);
    if (list) list.push(o.botProfileId);
    else deviations.set(o.key, [o.botProfileId]);
  }

  const out = new Map<string, SettingScopeView>();
  for (const p of SETTING_SCOPES) {
    const ids = p.scope === 'per-bot' ? (deviations.get(p.key) ?? []) : [];
    out.set(p.key, {
      key: p.key,
      scope: p.scope,
      section: p.section,
      reason: p.reason,
      deviatingBotIds: ids,
      sharedBotCount: Math.max(0, botCount - ids.length),
    });
  }
  return out;
}

/**
 * The retorts to store for ONE BOT, honouring a language the operator emptied.
 *
 * ── WHY THIS IS THE ONE SETTING WITH A SPECIAL CASE ──────────────────────────
 *
 * `normalizeInteraction` refills a blank retort list with the shipped one, deliberately, and
 * `verify:interaction` pins it: for the SHARED record, clearing a field restores the default
 * rather than muting her. That rule is exactly wrong for a bot. The shipped retorts are HERS,
 * in her register, about her name, so a second bot inheriting them speaks as her about a name
 * that is not its own, and the briefing requires "none" to be a state an operator can reach
 * rather than a fallback to hers.
 *
 * Through the console it was not reachable: an emptied textarea was refilled with her twelve
 * lines and stored as this bot's own. So emptiness is preserved here, in every shape it
 * arrives in: a blank string from the form, an already-empty list from a bot that has none,
 * and an empty object meaning none at all in any language.
 *
 * Iterates the SUBMITTED keys rather than the normalized ones, because normalization always
 * emits both shipped languages and would reintroduce her retorts for a bot that has none.
 */
export function retortsForBot(
  submitted: unknown,
  normalized: InteractionSettings,
): Record<string, string[]> {
  const raw = (submitted ?? {}) as Record<string, unknown>;
  const out: Record<string, string[]> = {};
  for (const [lang, given] of Object.entries(raw)) {
    const emptied =
      (typeof given === 'string' && given.trim() === '') ||
      (Array.isArray(given) && given.length === 0);
    out[lang] = emptied ? [] : (normalized.retorts[lang] ?? []);
  }
  return out;
}

/**
 * The wake word to SUGGEST for a new bot, from its display name.
 *
 * Its own display name, never the shared value. A second bot silently answering to the
 * first one's name is the defect CCB-S5-006 exists to fix, and inheriting the shared
 * `wakeWord` would reproduce it on every bot the operator creates.
 *
 * ── A SUGGESTION SINCE CCB-S5-009, NOT A DECISION ────────────────────────────
 *
 * This used to be the whole answer, applied invisibly at creation. Two things were wrong
 * with that and the operator hit both. The wake word is the single most important fact
 * about a bot and it was the one fact the creation form never mentioned, so an operator
 * finished the wizard not knowing what he had made. And the derivation is often wrong:
 * a bot displayed as `SANCH3Z` should answer to `Sanchez`, and there is no way for this
 * function to know that. It is now the PRE-FILLED DEFAULT on a field the operator can see
 * and change at the moment it matters.
 *
 * Normalization is `normalizeWakeWord`'s, deliberately not a second copy: this returned
 * null for a display name over 40 characters where the settings page truncated, so a bot
 * with a long name got no override and answered to hers.
 *
 * Returns null when nothing usable can be derived, which the console renders as an empty
 * required field rather than as a bot with no name.
 */
export function wakeWordForNewBot(displayName: string): string | null {
  // THE WHOLE DISPLAY NAME AGAIN (CCB-S5-014). CCB-S5-013 took the first token, because a
  // multi-token wake word was inert and deriving one would have created a bot nobody could
  // address. The detector matches a token sequence now, so the natural answer is the natural
  // answer: a bot displayed as "Rick Sanchez" answers to "Rick Sanchez". It is still only a
  // SUGGESTION on a field the operator can see and overtype.
  return normalizeWakeWord(displayName);
}

/**
 * Whether a wake word is already spoken for, and by whom.
 *
 * Two bots in one group waking on one word is a real configuration and an operator should
 * be told at the moment they create it, not discover it when both answer. Compared
 * case-insensitively because `detectAddress` matches that way: accepting `sanchez` beside
 * `Sanchez` would be a collision the check declared clear.
 *
 * The SHARED value counts as taken. A bot that has not deviated is answering to it, so it
 * is not free just because no override row names it.
 */
export interface WakeWordHolder {
  botProfileId: number | null;
  displayName: string;
  /** True when the holder is on the shared value rather than a deviation of its own. */
  shared: boolean;
}

export function wakeWordTakenBy(
  candidate: string,
  holders: readonly WakeWordHolder[],
  wakeWordOf: (holder: WakeWordHolder) => string,
): WakeWordHolder | undefined {
  const want = candidate.trim().toLowerCase();
  if (!want) return undefined;
  return holders.find((h) => wakeWordOf(h).trim().toLowerCase() === want);
}
