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

/** One style field's weights over the latent traits. */
export type LoadingVector = Partial<Record<TraitKey, number>>;

export interface LoadingSet {
  /** Names this set of weights. A bound written against derived values must name it. */
  version: string;
  style: Record<StyleField, LoadingVector>;
  /** Score weights per reaction, before the softmax (briefing §6). */
  reactions: Record<Reaction, LoadingVector>;
  /**
   * The coherence cap (briefing §5): emoji affinity is capped when tone is formal.
   * Applied LAST, after the percentile mapping, so the mapping stays interpretable.
   */
  coherence: {
    /** Tone at or below this counts as formal. */
    formalToneBelow: number;
    /** Emoji affinity is clamped to at most this for a formal tone. */
    emojiAffinityCap: number;
    /** Individually switchable, per specification §12. */
    enabled: boolean;
  };
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
  identity: Identity;
  rhythm: Rhythm;
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
