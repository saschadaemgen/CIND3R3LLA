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
 * What a rung may do. `none` makes a rung inert, which is how an operator keeps the
 * ladder short without losing the capability.
 *
 * NONE OF THESE ARE PERFORMED IN THIS BRIEFING. They name what would happen.
 */
export const ENFORCEMENT_ACTIONS = ['none', 'warn', 'mute', 'block', 'remove'] as const;
export type EnforcementAction = (typeof ENFORCEMENT_ACTIONS)[number];

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

  return {
    mode,
    verbalWindowSeconds: clampInt(o['verbalWindowSeconds'], 10, 604_800, d.verbalWindowSeconds),
    enforcementWindowSeconds: clampInt(
      o['enforcementWindowSeconds'],
      10,
      604_800,
      d.enforcementWindowSeconds,
    ),
    verbal,
    enforcement,
    exemptRoles,
    verbalExemptsStaff:
      typeof o['verbalExemptsStaff'] === 'boolean'
        ? o['verbalExemptsStaff']
        : d.verbalExemptsStaff,
    announce: typeof o['announce'] === 'boolean' ? o['announce'] : d.announce,
  };
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
    if (count >= rung.threshold) {
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
    if (count >= rung.threshold && rung.action !== 'none') {
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
