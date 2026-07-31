/**
 * Trait sampler: types, the index order, and the parameter defaults.
 *
 * Second component of the profile generator. Pure computation: no corpus, no
 * filesystem, no database, no clock, no global random source. The archetype set is
 * INJECTED, exactly as the name generator injects its corpus, which is what makes
 * "no filesystem at call time" (briefing §1) structural rather than a rule someone
 * has to remember. `archetypes.ts` is the only file in this module that reads a
 * file, and nothing on the sampling path calls it.
 */

/** The six dimensions (briefing §3). Five Big Five, plus HEXACO Honesty-Humility. */
export type TraitKey =
  | 'openness'
  | 'conscientiousness'
  | 'extraversion'
  | 'agreeableness'
  | 'neuroticism'
  | 'honesty';

/**
 * THE INDEX ORDER. Load-bearing, and the reason briefing §3 demands it be
 * documented in the code and asserted in a test.
 *
 *     0 openness   1 conscientiousness   2 extraversion
 *     3 agreeableness   4 neuroticism     5 honesty
 *
 * Every 6-vector and every row/column of the correlation matrix is in this order.
 * A reordered matrix is the dangerous failure mode here: it decomposes cleanly, it
 * samples without complaint, and it produces a population whose correlations sit on
 * the wrong pairs of traits. Nothing downstream would show it and no eye would
 * catch it, so `verify:traits` binds each matrix cell to its two NAMED traits by
 * probing one pair at a time (see the harness, "Index order").
 *
 * Note what is NOT in this order: the archetype mean vectors in
 * `data/archetypes.json` are authored as NAMED objects, not arrays. That file is
 * hand-edited, and hand-editing a bare array of six numbers is precisely how an
 * order mistake gets in. The loader converts names to indices in one place.
 */
export const TRAIT_ORDER = [
  'openness',
  'conscientiousness',
  'extraversion',
  'agreeableness',
  'neuroticism',
  'honesty',
] as const satisfies readonly TraitKey[];

/** Six. Named so the arithmetic below never spells it as a bare literal. */
export const TRAIT_COUNT = TRAIT_ORDER.length;

/** Position of each trait in `TRAIT_ORDER`. */
export const TRAIT_INDEX: Readonly<Record<TraitKey, number>> = Object.freeze(
  Object.fromEntries(TRAIT_ORDER.map((key, i) => [key, i])) as Record<TraitKey, number>,
);

/** The six z-scores. Population mean 0, standard deviation 1 (briefing §3). */
export type Latent = Record<TraitKey, number>;

/**
 * One archetype: a named mean vector, plus the traits that define it.
 *
 * `defining` is not decoration. Briefing §4.3 requires archetype means to be
 * separated by `archetypeSeparation` "on their defining traits", so the separation
 * check needs to know which traits a sketch actually pins and which it leaves free.
 * `quietLurker` is "low E, moderate elsewhere": its only defining trait is
 * extraversion, and its other five components are authored, not specified. Checking
 * separation across all six would let a free component rescue a pair that genuinely
 * collides on the traits that give it its identity.
 */
export interface Archetype {
  /** Stable key, as used in `TraitRequest.archetypeMix` and returned in the result. */
  key: string;
  /** Human-readable label, for diagnostics only. */
  label: string;
  /** The sketch this vector was authored against, quoted from briefing §5. */
  sketch: string;
  /** Mean z-scores, resolved into `TRAIT_ORDER` index order by the loader. */
  mean: readonly number[];
  /** Traits the sketch pins. Non-empty; see above. */
  defining: readonly TraitKey[];
  /** Anything authored beyond the sketch, recorded so it is not mistaken for spec. */
  note?: string;
}

/** A loaded, validated archetype set. */
export interface ArchetypeSet {
  list: readonly Archetype[];
  byKey: ReadonlyMap<string, Archetype>;
  /** Where it came from, for error messages. */
  source: string;
}

/** Input, per briefing §6. */
export interface TraitRequest {
  seed: number;
  /** Weights over archetype keys. Need not sum to 1; they are normalised. */
  archetypeMix: Record<string, number>;
  /** Probability this avatar belongs to no archetype at all (briefing §4.4). */
  unclassifiedShare: number;
  /** Spread around an archetype mean (briefing §4.3). */
  sigma: number;
  /** 6x6 correlation matrix in `TRAIT_ORDER` index order. Diagonal 1, symmetric. */
  covariance: number[][];
  /**
   * ADDITIVE, beyond briefing §6. Spread of the unclassified background, which
   * §4.4 specifies only as "a wider sigma" without saying how much wider. Defaults
   * to `sigma * UNCLASSIFIED_SIGMA_FACTOR`. Optional, so the §6 interface still
   * works verbatim; explicit, so the number is a choice rather than a constant
   * buried in the sampler.
   */
  unclassifiedSigma?: number;
}

/** Everything in a request except the seed. One configuration, many avatars. */
export type TraitConfig = Omit<TraitRequest, 'seed'>;

/** Output, per briefing §6. */
export interface TraitResult {
  /**
   * `null` means the unclassified background, and it is `null` rather than a
   * sentinel string on purpose (briefing §4.4): "that must be representable rather
   * than encoded as a special string". A string would collide with a real archetype
   * key the moment someone authored one called `none`.
   */
  archetype: string | null;
  latent: Latent;
}

/* ------------------------------------------------------------------ defaults */

/** Briefing §4.3. */
export const DEFAULT_SIGMA = 0.6;
export const SIGMA_MIN = 0.5;
export const SIGMA_MAX = 0.7;

/**
 * Briefing §4.3. NOT a sampling input: it is a property of the archetype
 * definitions, validated by `assertSeparation` rather than applied anywhere.
 */
export const DEFAULT_ARCHETYPE_SEPARATION = 2.0;
export const ARCHETYPE_SEPARATION_MIN = 1.5;
export const ARCHETYPE_SEPARATION_MAX = 2.5;

/**
 * Briefing §4.4, and a DESIGN HEURISTIC rather than a population constant.
 *
 * The reasoning was that only around 42 percent of people can be assigned to any
 * personality type at all, so a population where everyone is a clean archetype is
 * itself detectable as artificial. The second half of that stands. The 42 percent does
 * not carry the weight it was given: it comes from one reanalysis with one definition
 * of when a person counts as assigned, and it moves with the questionnaire, the trait
 * estimation, the standardisation, the number and shape of mixture components, the
 * clustering used, what counts as a meaningful cluster, the confidence criterion for
 * an individual assignment, and the reference null model.
 *
 * It is a defensible starting point. It is not a constant, and this constant should not
 * be defended as though it were measured.
 *
 * WHAT REPLACES IT: a classifiability CURVE compared against real data across all
 * confidence levels rather than a single share at one arbitrary threshold,
 *
 *     C(t) = P( max_k p(C = k | X) >= t )
 *
 * with an entropy curve alongside, because two populations can both reach 55 percent
 * classifiable and have entirely different uncertainty profiles. The clustering has to
 * be fitted on a real training split with the assignment and abstention rules frozen
 * before either population is scored, or every synthetic population is allowed to
 * invent the typology that flatters it.
 *
 * Not built. It needs the reference data layer, which does not exist yet.
 */
export const DEFAULT_UNCLASSIFIED_SHARE = 0.45;

/**
 * How much wider the unclassified background is drawn than an archetype cloud.
 * At the default sigma this gives 0.75.
 *
 * Briefing §4.4 says only "a wider sigma", so the number needed a basis, and the
 * basis is briefing §3: the six values are z-scores on a population with mean 0 and
 * standard deviation 1. That is a claim about the REALISED population, and it pins
 * this constant.
 *
 * The classified 55% already carries the variance of the archetype means (about
 * 0.96 per trait, because the means are authored at roughly unit magnitude) plus
 * `sigma` squared within each cloud. Solving for the background spread that brings
 * the whole population to unit variance gives about 0.78, so 1.25 x 0.6 = 0.75.
 * `verify:traits` asserts the realised population is z-scored rather than trusting
 * the arithmetic.
 *
 * It matters in both directions. Narrower than `sigma` and the background would be
 * a tight ninth cluster at the origin, which is a type, which is the opposite of
 * what it is for. Too much wider and it becomes a cloud of mush that swamps the
 * archetypes: at 1.5 the population is measurably less structured, and the
 * pairwise-distance spread this component exists to protect drops by a third.
 */
export const UNCLASSIFIED_SIGMA_FACTOR = 1.25;

/**
 * An equal-weight mix over the shipped archetypes.
 *
 * AUTHORED HERE, NOT SPECIFIED. Briefing §5 gives the archetype set but no
 * population weights, and choosing them is a population-layer question, which §8
 * puts explicitly out of scope for this component. Equal weight is the neutral
 * placeholder, not a claim about how rooms are actually composed.
 */
export const DEFAULT_ARCHETYPE_MIX: Readonly<Record<string, number>> = Object.freeze({
  average: 1,
  roleModel: 1,
  reserved: 1,
  selfCentered: 1,
  enthusiasticNewcomer: 1,
  terseExpert: 1,
  quietLurker: 1,
  professionalSupport: 1,
});
