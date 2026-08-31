/**
 * Moderation rules (CCB-S4-032, D-136): two ladders, both driven by repetition.
 *
 * ── WHY THIS FILE IS PURE ────────────────────────────────────────────────────
 *
 * No database, no transport, and above all NO CAPABILITY TO ACT. It turns a count
 * into a decision and stops. `store.ts` persists, the engine wires, and nothing
 * anywhere in this tree can change a role, block a member or remove one: the
 * capability does not exist here to be misused, which is a stronger guarantee than a
 * flag that says not to.
 *
 * ── THE TWO LADDERS ARE SEPARATE ON PURPOSE ──────────────────────────────────
 *
 * VERBAL escalation is how sharply she speaks. It raises the sharpness dial above the
 * operator's base for a while and then relaxes. It harms nobody, so it is live from
 * this briefing, and it reuses the personality axis from D-133 rather than inventing a
 * second voice mechanism.
 *
 * ENFORCEMENT escalation is what actually happens to a member. It computes and records
 * and, in this briefing, does nothing else. Conflating the two would mean either a
 * sharper tone needing the same caution as a ban, or a ban being as casual as a sharper
 * tone.
 *
 * ── THE MODEL NEVER DECIDES A SANCTION ───────────────────────────────────────
 *
 * The counter is deterministic, the thresholds are numbers, and the rung follows
 * mechanically from a comparison. She may SAY something about a step in her own voice,
 * but no model output is read to choose one. Otherwise a member could talk her into
 * sanctioning somebody, which is the same injection the consent gate exists to refuse.
 * Model words, rules decide.
 *
 * ── DECAY IS THE WINDOW ──────────────────────────────────────────────────────
 *
 * There is no separate decay number, because a second knob that merely restated the
 * window would be a dead control. Violations are counted over a rolling window and
 * age out of it; that IS the decay, and the two ladders get their own window lengths
 * so an operator can let the tone relax faster than the enforcement count does.
 */

import type { SdkGroupRole } from '../profiles/bot-onboarding.js';

/**
 * Only `observe` is implemented (CCB-S4-032). `enforce` exists in the type and the
 * column so the arming briefing has somewhere to put it, and the console offers it
 * disabled with an honest sentence rather than as a toggle that pretends to work.
 */
export const MODERATION_MODES = ['observe', 'enforce'] as const;
export type ModerationMode = (typeof MODERATION_MODES)[number];

/**
 * Whether the console may actually arm enforcement (CCB-S4-035, D-139).
 *
 * ── WHY THIS IS FALSE WHILE EVERYTHING BEHIND IT IS BUILT ────────────────────
 *
 * CCB-S4-035 built all of it: previous-role memory, expiry through the queue, undo, the
 * three actions, the announcement, the refusals and the failure paths. Every one of them
 * is proven offline against a substitutable port, which is why the port exists.
 *
 * What is NOT proven is the half no harness can reach. The briefing's first ground rule
 * asks for a real core with a real second member: an actual mute applied and lifted, a
 * moderator restored as a moderator, an expiry firing, an exempt member surviving the
 * hardest rung. That needs a second human with a SimpleX client in a real group, and the
 * only real group this deployment has is the operator's live one, whose members are not
 * test subjects.
 *
 * Ground rule 5 says exactly what to do about that: ship the parts that can be proven and
 * leave enforce unselectable. So this is the switch, it is one word, and it is false. The
 * console says what is owed rather than offering a control that has never been run against
 * anything real, and `updateModerationMode` refuses to write 'enforce' while it stands.
 *
 * WHAT UNLOCKING COSTS: flip this to true, run `npm run verify:moderation`, and do the
 * five live checks the briefing lists. The code underneath does not change, which is the
 * point of gating it here rather than leaving the feature half-written.
 */
export const ARMING_UNLOCKED = false;

/**
 * What a rung may do. `none` makes a rung inert, which is how an operator keeps the
 * ladder short without losing the capability.
 *
 * NONE OF THESE ARE PERFORMED IN THIS BRIEFING. They name what would happen.
 */
export const ENFORCEMENT_ACTIONS = ['none', 'warn', 'mute', 'block', 'remove'] as const;
export type EnforcementAction = (typeof ENFORCEMENT_ACTIONS)[number];

/**
 * The person-readable name of each action, and what it does, as DATA (CCB-S5-064, D-262).
 *
 * ── WHY THE NAME IS DERIVED FROM THE ACTION AND NOT FIXED PER RUNG ───────────
 *
 * The operator asked for rung names so a person reading the page can tell what each rung
 * does. But a rung is a positional slot whose action is an operator-editable dropdown: a
 * fixed name per POSITION goes false the moment a dropdown changes, and against the
 * shipped ladder the proposed fixed sequence (Notice / Warning / Mute / Removal) is wrong
 * three times over - rung 3 does not mute (rung 2 does), rung 4 removes nobody (both hard
 * rungs ship inert on purpose), and rung 1's stored action is literally 'warn', which the
 * system GUARANTEES for the first live rung on save and on arming. So the name follows
 * the ACTION, which is the thing that is true whatever the operator configures, and the
 * number stays beside it because the number is what the records keep.
 *
 * "Notice" appears nowhere, because nothing in either ladder notices: the closest true
 * sentence is that the verbal ladder sharpens her tone, and that is worded as what it is.
 *
 * `whatItDoes` states the OBSERVED/ARMED split honestly: a warning speaks today in both
 * modes; the three hard actions are computed and recorded only, until arming is unlocked.
 */
export const ENFORCEMENT_ACTION_NAMES: Readonly<
  Record<EnforcementAction, { name: string; whatItDoes: string }>
> = Object.freeze({
  none: Object.freeze({
    name: 'Does nothing',
    whatItDoes: 'The rung is inert and is skipped; a higher rung still applies.',
  }),
  warn: Object.freeze({
    name: 'Warning',
    whatItDoes:
      'She warns the member in the chat, with the count. The warning is spoken in ' +
      'observed mode too; it acts on nobody.',
  }),
  mute: Object.freeze({
    name: 'Mute',
    whatItDoes:
      'The member’s role changes to Observer for the set duration, then is restored; a ' +
      'duration of 0 means until it is lifted by hand. Liftable from the Active page ' +
      'either way. Recorded only, until enforcement is armed.',
  }),
  block: Object.freeze({
    name: 'Block',
    whatItDoes:
      'The member’s messages are hidden from everyone; they stay in the group. Not ' +
      'liftable from this console. Recorded only, until enforcement is armed.',
  }),
  remove: Object.freeze({
    name: 'Removal',
    whatItDoes:
      'The member is removed from the group. Not reversible from this console. Recorded ' +
      'only, until enforcement is armed.',
  }),
});

/**
 * The kind of rule a violation belongs to.
 *
 * GENERIC BY CONSTRUCTION. Nicknames are the first trigger and deliberately not the
 * only one the ladder can express: a later trigger adds a value here and reuses
 * everything else. Nothing in the evaluation reads this; it is carried so the log can
 * say which rule produced a count and so two rules can never be added up together.
 */
export const VIOLATION_TYPES = ['nickname'] as const;
export type ViolationType = (typeof VIOLATION_TYPES)[number];

/** How many rungs each ladder has. Fixed, so the console form is stable. */
export const LADDER_RUNGS = 4;

export interface VerbalRung {
  /** Violations within the verbal window at which this rung applies. */
  threshold: number;
  /** Added to the configured base sharpness. The sum is capped at the axis maximum. */
  sharpnessBonus: number;
}

export interface EnforcementRung {
  threshold: number;
  action: EnforcementAction;
  /** Only meaningful for `mute`. Seconds. */
  durationSeconds: number;
}

export interface ModerationRules {
  mode: ModerationMode;
  /** Rolling window for the verbal ladder. Shorter, so tone relaxes sooner. */
  verbalWindowSeconds: number;
  /** Rolling window for the enforcement ladder. */
  enforcementWindowSeconds: number;
  verbal: VerbalRung[];
  enforcement: EnforcementRung[];
  /**
   * How many warnings are spoken before the ladder advances (CCB-S4-033, D-137).
   *
   * THE OPERATOR-FACING CONTROL, and the single source of truth for the gap. The
   * threshold of the rung after the warning is DERIVED from it by
   * {@link normalizeModerationRules} on every read and every write, so there is no code
   * path that can hold the two in disagreement. Before this, the number of warnings was
   * implied by the arithmetic gap between two thresholds, which is a thing to state, not
   * a thing to compute.
   *
   * 0 means the operator has deliberately chosen no warnings: the warn rung goes inert
   * and the ordering guarantee does not apply.
   */
  warningCount: number;
  /** Roles enforcement never applies to. She cannot touch an owner in any case. */
  exemptRoles: SdkGroupRole[];
  /**
   * Whether the exempt roles also escape the VERBAL ladder. Default false: the
   * briefing's choice is that a cheeky admin can still get a sharp retort, because a
   * sharper sentence is not a sanction.
   */
  verbalExemptsStaff: boolean;
  /**
   * Whether she announces a step in the chat. Stored and honoured by the arming
   * briefing; in observation mode nothing is announced because nothing happens.
   */
  announce: boolean;
}

/**
 * The shipped ladder.
 *
 * Verbal reaches the briefing's stated target exactly: base 5 plus 4 at the fifth
 * nickname is 9. Enforcement ships SHORT, warn then mute, with the two hard rungs
 * inert. An operator who wants a block or a removal chooses it deliberately; shipping
 * a default that would remove members, even observed, is not a default anybody asked
 * for.
 */
export const DEFAULT_MODERATION_RULES: Readonly<ModerationRules> = Object.freeze<ModerationRules>({
  mode: 'observe',
  verbalWindowSeconds: 600,
  enforcementWindowSeconds: 600,
  verbal: [
    { threshold: 2, sharpnessBonus: 1 },
    { threshold: 3, sharpnessBonus: 2 },
    { threshold: 4, sharpnessBonus: 3 },
    { threshold: 5, sharpnessBonus: 4 },
  ],
  enforcement: [
    { threshold: 5, action: 'warn', durationSeconds: 0 },
    { threshold: 10, action: 'mute', durationSeconds: 600 },
    { threshold: 20, action: 'none', durationSeconds: 0 },
    { threshold: 30, action: 'none', durationSeconds: 0 },
  ],
  // Five, which is exactly the gap 029 shipped implicitly (warn at 5, mute at 10). The
  // behaviour is unchanged by this default; what changes is that it is now stated.
  warningCount: 5,
  exemptRoles: ['owner', 'admin', 'moderator'],
  verbalExemptsStaff: false,
  announce: false,
});

const ROLES: readonly SdkGroupRole[] = [
  'relay',
  'observer',
  'author',
  'member',
  'moderator',
  'admin',
  'owner',
];

function clampInt(value: unknown, min: number, max: number, fallback: number): number {
  const parsed =
    typeof value === 'number'
      ? value
      : typeof value === 'string'
        ? Number.parseInt(value, 10)
        : Number.NaN;
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, Math.trunc(parsed)));
}

/** A string field, or something that is not one. Anything else is not a value. */
function asText(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

/**
 * Everything a form, a column or an older build can hand over, made safe.
 *
 * Rungs are normalised to a FIXED length and sorted by threshold. A short list is
 * padded from the defaults and a long one is truncated, so a stored value written by a
 * different version cannot produce a console form with a missing row or a ladder with
 * a rung nobody can see.
 */
export function normalizeModerationRules(raw: unknown): ModerationRules {
  const o = asRecord(raw);
  const d = DEFAULT_MODERATION_RULES;

  const rawMode = asText(o['mode']).trim();
  const mode: ModerationMode = (MODERATION_MODES as readonly string[]).includes(rawMode)
    ? (rawMode as ModerationMode)
    : d.mode;

  const verbalRaw = Array.isArray(o['verbal']) ? (o['verbal'] as unknown[]) : [];
  const verbal: VerbalRung[] = Array.from({ length: LADDER_RUNGS }, (_unused, index) => {
    const rung = asRecord(verbalRaw[index]);
    const fallback = d.verbal[index]!;
    return {
      threshold: clampInt(rung['threshold'], 1, 100_000, fallback.threshold),
      // 0 is meaningful (a rung that changes nothing), so the floor is 0, not 1.
      sharpnessBonus: clampInt(rung['sharpnessBonus'], 0, 9, fallback.sharpnessBonus),
    };
  }).sort((a, b) => a.threshold - b.threshold);

  const enforcementRaw = Array.isArray(o['enforcement']) ? (o['enforcement'] as unknown[]) : [];
  const enforcement: EnforcementRung[] = Array.from({ length: LADDER_RUNGS }, (_unused, index) => {
    const rung = asRecord(enforcementRaw[index]);
    const fallback = d.enforcement[index]!;
    const rawAction = asText(rung['action']).trim();
    return {
      threshold: clampInt(rung['threshold'], 1, 100_000, fallback.threshold),
      action: ((ENFORCEMENT_ACTIONS as readonly string[]).includes(rawAction)
        ? rawAction
        : fallback.action) as EnforcementAction,
      durationSeconds: clampInt(rung['durationSeconds'], 0, 31_536_000, fallback.durationSeconds),
    };
  }).sort((a, b) => a.threshold - b.threshold);

  const exemptRaw = Array.isArray(o['exemptRoles']) ? (o['exemptRoles'] as unknown[]) : null;
  const exemptRoles =
    exemptRaw === null
      ? [...d.exemptRoles]
      : [
          ...new Set(
            exemptRaw
              .map((role) => asText(role).trim().toLowerCase())
              .filter((role): role is SdkGroupRole =>
                (ROLES as readonly string[]).includes(role),
              ),
          ),
        ];

  const warningCount = clampInt(o['warningCount'], 0, 100, d.warningCount);

  return {
    mode,
    warningCount,
    verbalWindowSeconds: clampInt(o['verbalWindowSeconds'], 10, 604_800, d.verbalWindowSeconds),
    enforcementWindowSeconds: clampInt(
      o['enforcementWindowSeconds'],
      10,
      604_800,
      d.enforcementWindowSeconds,
    ),
    verbal,
    // Derived, never stored independently. See `deriveFromWarningCount`. Sorted AFTER
    // the derivation and not only before it: the derived threshold can land anywhere,
    // and a ladder listed out of threshold order reads as broken in the console.
    enforcement: deriveFromWarningCount(enforcement, warningCount).sort(
      (a, b) => a.threshold - b.threshold,
    ),
    exemptRoles,
    verbalExemptsStaff:
      typeof o['verbalExemptsStaff'] === 'boolean'
        ? o['verbalExemptsStaff']
        : d.verbalExemptsStaff,
    announce: typeof o['announce'] === 'boolean' ? o['announce'] : d.announce,
  };
}

/**
 * The first rung that actually does something, and the first live rung after it.
 *
 * "Live" means an action other than `none`: an inert rung is skipped rather than
 * treated as a ceiling, which is the rule {@link evaluateEnforcement} already follows.
 * Returned as indices so the caller can rewrite a threshold in place.
 */
function liveRungIndices(enforcement: readonly EnforcementRung[]): number[] {
  return enforcement
    .map((rung, index) => (rung.action === 'none' ? -1 : index))
    .filter((index) => index >= 0);
}

/**
 * Make the ladder agree with the warning count (CCB-S4-033, D-137).
 *
 * ── WHY THIS IS DERIVATION AND NOT VALIDATION ────────────────────────────────
 *
 * The briefing's requirement is that the warning count and the thresholds cannot
 * contradict each other. Validation would catch a contradiction after it existed;
 * derivation means it cannot exist. The threshold of the rung after the warning is
 * COMPUTED here, on every normalisation, which is every read out of the database and
 * every write into it. A stored value, a form post and an in-memory object therefore
 * cannot disagree, because only one of the two numbers is ever authoritative.
 *
 * ── AND WHY IT ALSO SETTLES THE REPEAT QUESTION ──────────────────────────────
 *
 * 029 left "does warn fire once or on every violation" undefined. With the next rung
 * sitting exactly `warningCount` violations above the warn rung, firing on EVERY
 * violation while the warn rung resolves produces exactly `warningCount` warnings and
 * then advances. The count is the number of warnings by construction rather than by a
 * second rule that could drift from it.
 */
function deriveFromWarningCount(
  enforcement: EnforcementRung[],
  warningCount: number,
): EnforcementRung[] {
  if (warningCount <= 0) return enforcement;

  const live = liveRungIndices(enforcement);
  const warnAt = live.find((index) => enforcement[index]!.action === 'warn');
  if (warnAt === undefined) return enforcement;

  const next = live.find((index) => index > warnAt);
  if (next === undefined) return enforcement;

  const derived = enforcement[warnAt]!.threshold + warningCount;
  const result = enforcement.map((rung, index) =>
    index === next ? { ...rung, threshold: derived } : rung,
  );

  // Rungs above the derived one must stay above it. An operator who shortens the
  // warning run should not silently produce a ladder whose third rung sits below its
  // second, which `evaluateEnforcement` would resolve in threshold order and surprise
  // them with.
  let floor = derived;
  for (let index = next + 1; index < result.length; index++) {
    const rung = result[index]!;
    if (rung.action !== 'none' && rung.threshold <= floor) {
      result[index] = { ...rung, threshold: floor + 1 };
    }
    if (rung.action !== 'none') floor = Math.max(floor, result[index]!.threshold);
  }

  return result;
}

/**
 * Whether this ladder can escalate without ever having warned (CCB-S4-033).
 *
 * The guarantee: a mute, or anything harder, must never be the first thing that happens
 * to a member. Expressed as a property OF THE RULES rather than as a hope resting on how
 * the thresholds happen to be arranged, so it can be checked once on save instead of
 * being re-derived by whoever next reads the ladder.
 *
 * A warning count of 0 is the operator saying explicitly that they want no warnings, and
 * is therefore not a violation of anything.
 */
export function escalatesWithoutWarning(rules: ModerationRules): boolean {
  if (rules.warningCount <= 0) return false;
  const live = liveRungIndices(rules.enforcement);
  const first = live[0];
  return first !== undefined && rules.enforcement[first]!.action !== 'warn';
}

/**
 * Which warning this is, out of how many.
 *
 * Both numbers are real: the ladder resolves to warn for exactly `warningCount`
 * violations, so "3 of 5" is a fact rather than a figure of speech. Returns null when
 * the count is not a warning at all.
 */
export function warningPosition(
  count: number,
  rules: ModerationRules,
): { number: number; total: number } | null {
  if (rules.warningCount <= 0) return null;
  const warnRung = rules.enforcement.find((rung) => rung.action === 'warn');
  if (!warnRung || count < warnRung.threshold) return null;
  const position = count - warnRung.threshold + 1;
  if (position > rules.warningCount) return null;
  return { number: position, total: rules.warningCount };
}

/** Whether a role escapes ENFORCEMENT. An unknown role is not exempt; see below. */
export function isExemptRole(
  role: SdkGroupRole | null | undefined,
  rules: ModerationRules,
): boolean {
  return role !== null && role !== undefined && rules.exemptRoles.includes(role);
}

export interface VerbalDecision {
  /** Violations inside the verbal window, including the one just recorded. */
  count: number;
  /** Added to the base sharpness. 0 when no rung is reached or the member is exempt. */
  sharpnessBonus: number;
  /** The rung that produced it, for the log. Null when none applied. */
  rungThreshold: number | null;
  /** True when a rung would have applied but the member's role is exempt. */
  exempt: boolean;
}

/**
 * How much sharper she gets.
 *
 * The HIGHEST rung whose threshold the count has reached wins, so an operator who
 * makes a middle rung gentler cannot accidentally make a later one gentler too.
 */
export function evaluateVerbal(
  count: number,
  role: SdkGroupRole | null | undefined,
  rules: ModerationRules,
): VerbalDecision {
  const exempt = rules.verbalExemptsStaff && isExemptRole(role, rules);
  let bonus = 0;
  let rungThreshold: number | null = null;

  for (const rung of rules.verbal) {
    // Highest threshold wins, for the same reason as the enforcement ladder: the
    // decision must not depend on where a rung happens to sit in the array.
    if (count >= rung.threshold && (rungThreshold === null || rung.threshold >= rungThreshold)) {
      bonus = rung.sharpnessBonus;
      rungThreshold = rung.threshold;
    }
  }

  return exempt
    ? { count, sharpnessBonus: 0, rungThreshold: null, exempt: true }
    : { count, sharpnessBonus: bonus, rungThreshold, exempt: false };
}

export interface EnforcementDecision {
  count: number;
  action: EnforcementAction;
  durationSeconds: number;
  rungThreshold: number | null;
  exempt: boolean;
  /**
   * False when the adapter could not tell us the member's role.
   *
   * Recorded rather than resolved. In observation mode it changes nothing, because
   * nothing happens either way. THE ARMING BRIEFING MUST REFUSE TO ACT WHEN THIS IS
   * FALSE: sanctioning a member whose role is unknown risks aiming at an owner, which
   * would fail at the SDK and look like a bug rather than like the policy it is.
   */
  roleKnown: boolean;
}

/**
 * Which rung fires.
 *
 * A rung set to `none` is INERT rather than blocking: the highest rung that both
 * has been reached and actually does something wins. Otherwise raising the count past
 * a disabled rung would drop the member back to no action, which reads as a bug.
 */
export function evaluateEnforcement(
  count: number,
  role: SdkGroupRole | null | undefined,
  rules: ModerationRules,
): EnforcementDecision {
  const roleKnown = role !== null && role !== undefined;
  const exempt = isExemptRole(role, rules);

  if (exempt) {
    return {
      count,
      action: 'none',
      durationSeconds: 0,
      rungThreshold: null,
      exempt: true,
      roleKnown,
    };
  }

  let action: EnforcementAction = 'none';
  let durationSeconds = 0;
  let rungThreshold: number | null = null;

  for (const rung of rules.enforcement) {
    // A warning rung with the count set to zero is inert (CCB-S4-033). The operator has
    // said they want no warnings; the rung is left in the stored ladder rather than
    // rewritten, so raising the count again brings it straight back.
    const inert = rung.action === 'none' || (rung.action === 'warn' && rules.warningCount <= 0);
    if (inert || count < rung.threshold) continue;
    // HIGHEST THRESHOLD WINS, not last-in-the-array. The two were the same while the
    // ladder was always sorted, and CCB-S4-033 made that assumption false for one
    // normalisation: the derived threshold can land out of order. Depending on array
    // order here meant a member past the block rung could resolve back to a mute purely
    // because of where a rung sat in the list. The normaliser sorts as well, so this is
    // belt and braces, which is the right amount for a decision about sanctioning
    // somebody.
    if (rungThreshold === null || rung.threshold >= rungThreshold) {
      action = rung.action;
      durationSeconds = rung.durationSeconds;
      rungThreshold = rung.threshold;
    }
  }

  return { count, action, durationSeconds, rungThreshold, exempt: false, roleKnown };
}

/** One line for the log, saying what produced a decision. Content free. */
export function describeRule(
  type: ViolationType,
  count: number,
  windowSeconds: number,
  rungThreshold: number | null,
): string {
  const minutes = Math.round(windowSeconds / 60);
  const window = minutes >= 1 ? `${minutes} minute(s)` : `${windowSeconds} second(s)`;
  const rung = rungThreshold === null ? 'no rung' : `rung at ${rungThreshold}`;
  return `${type}: ${count} in ${window}, ${rung}`;
}
