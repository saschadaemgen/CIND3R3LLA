/**
 * Surface derivation: types.
 *
 * Third component of the profile generator (briefing CCB-S4-005). Turns a latent trait
 * vector into the visible properties everything downstream reads.
 *
 * ── THE DISTINCTION THIS FILE EXISTS TO KEEP (briefing §3) ──────────────────
 *
 *   STYLE     DERIVED from the latent vector. A pure function, no randomness. Two
 *             avatars with identical latent vectors write identically, and that is
 *             intended.
 *   RHYTHM    MIXED. Drawn from population parameters, biased by latent traits.
 *   IDENTITY  DRAWN from population parameters, biased by latent traits and age band
 *             only where the specification asks for it.
 *
 * **Identity is not a reading of personality.** Origin, age and gender are not
 * personality traits and are never derived from them. Deriving them would encode
 * propositions nobody intends, in exactly the way the archetype set encoded that bad
 * faith announces itself (D-097). The type split below is what keeps that structural:
 * the derivation function for style takes no `Rng` at all, and the identity draw takes
 * no latent vector except where a documented bias applies.
 */

import type { AgeBand, GenderPresentation, NameCase, NameType } from '../names/types.js';
import type { Latent, TraitKey } from '../traits/types.js';

export type { AgeBand, GenderPresentation, NameCase, NameType };

/** The six style fields, all on a 0..100 percentile scale except the reaction weights. */
export const STYLE_FIELDS = [
  'tone',
  'verbosity',
  'warmth',
  'humor',
  'emojiAffinity',
  'sentenceComplexity',
] as const;
export type StyleField = (typeof STYLE_FIELDS)[number];

/** The eight reactions the core actually accepts (briefing §6; verified live). */
export const REACTIONS = ['👍', '👎', '😀', '😂', '😢', '❤', '🚀', '✅'] as const;
export type Reaction = (typeof REACTIONS)[number];

/**
 * One coherence rule.
 *
 * ── A FIRING RATE OF ZERO IS A FINDING, NOT A PASS ──────────────────────────
 *
 * Briefing §5 anticipates a rule firing on 2 percent (a coherence rule) and on 40
 * percent (a weighting problem wearing a rule's clothing). It does not anticipate ZERO,
 * and zero is the reading that looks healthiest in a report while being the most
 * suspicious. Two possibilities, and the second is why this matters:
 *
 *   - the rule guards against something that cannot happen, so it is decoration;
 *   - the rule guards against something that cannot happen BECAUSE OF A DEFECT
 *     ELSEWHERE. That was the live case: `tone` and `emojiAffinity` correlated at 0.983,
 *     so two fields could never disagree enough for a rule about their disagreement to
 *     have anything to do. A report asking only "did this fire too often" cannot see it.
 *
 * `verify:surface` therefore reports every rule's firing rate and treats zero as
 * requiring an explanation.
 */
export interface CoherenceRule {
  id: string;
  /** The only kind implemented. Others in the specification arrive as data plus a case. */
  kind: 'cap-when-below';
  when: { field: StyleField; below: number };
  cap: { field: StyleField; at: number };
  enabled: boolean;
}

/** One style field's weights over the latent traits. */
export type LoadingVector = Partial<Record<TraitKey, number>>;

export interface LoadingSet {
  /** Names this set of weights. A bound written against derived values must name it. */
  version: string;
  style: Record<StyleField, LoadingVector>;
  /** Score weights per reaction, before the softmax (briefing §6). */
  reactions: Record<Reaction, LoadingVector>;
  /**
   * Individually switchable coherence rules (specification §12).
   *
   * A LIST rather than one hardcoded rule, so the specification's other seven can be
   * added as data, and so the firing-rate report below is generic over all of them
   * rather than special-cased for the one that happens to exist.
   */
  coherence: CoherenceRule[];
  /**
   * Reactions whose softmax probability falls below this are zeroed and the rest
   * renormalised. Without it every avatar has some probability of every reaction, which
   * expresses no personality at all (briefing §6).
   */
  reactionFloor: number;
  /**
   * Sharpens the reaction softmax before the floor applies.
   *
   * At 1.0 the scores produce a distribution flat enough that almost every avatar
   * retains almost every reaction, which is precisely the failure briefing §6 names.
   */
  temperature: number;
}

export type SessionPattern = 'steady' | 'bursty' | 'sporadic';
export type ActivityTier = 'superuser' | 'contributor' | 'lurker';

export interface HourRange {
  /** Local hour, 0..23 inclusive. */
  from: number;
  to: number;
}

export interface LogNormalParams {
  median: number;
  sigma: number;
}

export interface PopulationConfig {
  /** Culture weights, feeding the name generator's `cultureMix`. */
  originMix: Record<string, number>;
  /** Timezone offset per culture key, in hours. Identity draws origin, timezone follows. */
  originTimezones: Record<string, number>;
  ageBandMix: Record<AgeBand, number>;
  genderMix: Record<GenderPresentation, number>;
  /** Base name-style weights, before the age-band bias. */
  nameStyleMix: Partial<Record<NameType, number>>;
  /** Teenagers skew toward handles (briefing §3, the one documented identity bias). */
  teenHandleBoost: number;
  nameCaseMix: Record<NameCase, number>;
  /** Chance a name blends two cultures. */
  blendProbability: number;
  /** Population shares of the participation curve (briefing §7). */
  activityTiers: Record<ActivityTier, number>;
  sessionPatterns: Record<SessionPattern, number>;
  /** Population parameter, not per-avatar personality. */
  interEventAlpha: number;
  /** Pool the interest draw selects from (CCB-S4-006 §5). */
  interestPool: string[];
  /** Base weights over bio themes, before the style bias. */
  bioThemeMix: Record<BioTheme, number>;
}

export interface Style {
  tone: number;
  verbosity: number;
  warmth: number;
  humor: number;
  emojiAffinity: number;
  sentenceComplexity: number;
  /** Sums to 1. Zeroed entries are omitted, so a key's absence means "never". */
  reactionWeights: Partial<Record<Reaction, number>>;
}

export interface Identity {
  originBlend: Record<string, number>;
  ageBand: AgeBand;
  genderPresentation: GenderPresentation;
  nameType: NameType;
  namePattern: string;
  fantasyIntensity: number;
  nameCase: NameCase;
}

/** Themes a bio can take (CCB-S4-006 §5). `none` always yields an empty bio. */
export const BIO_THEMES = ['professional', 'personal', 'quirky', 'minimal', 'cryptic', 'none'] as const;
export type BioTheme = (typeof BIO_THEMES)[number];

/**
 * What an avatar is ABOUT, as opposed to how it writes.
 *
 * ── ADDED UNDER CCB-S4-006, WHICH EXPOSED A GAP BETWEEN TWO BRIEFINGS ───────
 *
 * CCB-S4-006 §5 says `bioTheme` comes "from the surface" and lists `interests` as a
 * bio input, but CCB-S4-005 §10's interface specified neither, so the surface component
 * shipped without them. Recorded rather than quietly patched, because the gap is between
 * two specifications and not inside one.
 *
 * ── WHY A FOURTH BLOCK RATHER THAN INSIDE `identity` ───────────────────────
 *
 * Both are biased by personality, and `identity` is the block whose whole guarantee is
 * that it is NOT: `drawIdentity` takes no latent vector, which is what makes "origin,
 * age and gender cannot be derived from personality" structural rather than a rule
 * (D-099). Putting a personality-biased field in there would quietly break the one
 * property that block exists to hold, and the test that asserts it would have had to be
 * weakened to accommodate it. So this is a MIXED block, like rhythm.
 */
export interface Content {
  /** Which angle a bio takes. Drawn, biased by style. */
  bioTheme: BioTheme;
  /** What a bio may mention. Drawn from the population pool; count biased by openness. */
  interests: string[];
}

export interface Rhythm {
  activityTier: ActivityTier;
  interEventAlpha: number;
  circadianMask: HourRange[];
  sessionPattern: SessionPattern;
  responseLatency: LogNormalParams;
  messageLength: LogNormalParams;
}

export interface Surface {
  style: Style;
  /** Ids of the coherence rules that fired for this avatar. */
  firedRules: string[];
  identity: Identity;
  rhythm: Rhythm;
  content: Content;
  /** Fields the coherence cap changed. Reported, never silent (briefing §5). */
  capped: string[];
  /** Fields supplied as overrides, so a hand-adjusted avatar stays distinguishable. */
  overrides: string[];
}

export interface SurfaceRequest {
  seed: number;
  latent: Latent;
  population: PopulationConfig;
  loadings: LoadingSet;
  /**
   * Overrides bypass DERIVATION. They do not bypass the coherence cap, and an override
   * the cap then changes appears in both `overrides` and `capped` (briefing §9).
   */
  overrides?: Partial<{
    tone: number;
    verbosity: number;
    warmth: number;
    humor: number;
    emojiAffinity: number;
    sentenceComplexity: number;
  }>;
}
