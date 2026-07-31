/**
 * The sampler (briefing §4).
 *
 * Per avatar:
 *   1. draw an archetype from the mix, or fall into the unclassified background
 *      with probability `unclassifiedShare`;
 *   2. draw `z` in six dimensions from a standard normal;
 *   3. return `mu + sigma * (L @ z)`.
 *
 * ---------------------------------------------------------------------------
 * WHY IT IS BUILT THIS WAY AND NOT THE OBVIOUS WAY
 * ---------------------------------------------------------------------------
 *
 * Sampling each trait independently fails at least once, and this file was built to
 * answer two failures. One of those two is now WITHDRAWN as a justification, and the
 * correction is recorded here rather than quietly dropped, because a reason that does
 * not hold is worse than no reason: it looks settled.
 *
 * WITHDRAWN: THE DISTANCE-CONCENTRATION ARGUMENT. The original reasoning was that in
 * high dimensions independently drawn vectors become roughly equidistant, so relative
 * spread collapses and every avatar ends up average. **That effect is weak at six
 * dimensions.** The pairwise distance between two draws from N(0, I_6) is a scaled
 * chi-6 variable with a coefficient of variation of about 0.294, which is nowhere near
 * zero; distance concentration becomes empirically problematic somewhere around ten to
 * fifteen dimensions depending on the distribution. The argument does not carry at
 * d = 6 and is not a reason for anything here.
 *
 * STANDING: real personality traits co-vary, and independent draws produce combinations
 * that do not occur in people. `L` is what fixes that, and that reason is unaffected.
 *
 * WHAT THE ARCHETYPE MEANS ARE NOW JUSTIFIED BY: nothing measured, yet. They demonstrably
 * add spread (1.02x without them against 1.18x with, against an independent baseline),
 * but "more spread" has no established desired direction, so that is a description and
 * not a justification. Whether real personality populations contain cluster structure
 * beyond their marginals and correlations is an open empirical question, answerable
 * against a covariance-matched null on public data, and not yet answered. The archetype
 * layer is therefore **unjustified rather than refuted**, and if real excess
 * clusterability turns out to be low the right response is fewer archetypes, a larger
 * unstructured share, or both.
 *
 * ---------------------------------------------------------------------------
 * THERE IS NO `catch` IN THIS FILE, AND THERE MUST NOT BE
 * ---------------------------------------------------------------------------
 *
 * Every validation and the Cholesky itself raise. Briefing §4.2 forbids a silent
 * fallback to independent sampling, and a `catch` around the decomposition is the
 * exact shape that failure would take: a matrix that stops decomposing after a
 * retune would quietly start producing the mush this component exists to prevent,
 * with nothing downstream showing it. `verify:traits` reads this source and asserts
 * it contains no `catch` and does not import `ridgeRepair`.
 */

import { Rng } from '../rng.js';
import { cholesky } from './covariance.js';
import { standardNormals } from './normal.js';
import { populationMoments, type PopulationMoments } from './population.js';
import {
  SIGMA_MAX,
  SIGMA_MIN,
  TRAIT_COUNT,
  TRAIT_ORDER,
  UNCLASSIFIED_SIGMA_FACTOR,
  type ArchetypeSet,
  type Latent,
  type TraitConfig,
  type TraitRequest,
  type TraitResult,
} from './types.js';

/**
 * Named streams, one per decision (the pattern the name generator's `rng.ts`
 * establishes and explains). The archetype draw must not shift the sequence the
 * latent draw sees: without that, adding a stage later would silently change every
 * vector previously generated from every seed, and a seed would no longer
 * reconstruct a profile.
 *
 * A useful consequence, asserted in the harness: the underlying `z` for a given
 * seed is the same whether or not an archetype was drawn.
 */
const STREAM_ARCHETYPE = 'trait:archetype';
const STREAM_LATENT = 'trait:latent';

/** The unclassified background sits at the origin (briefing §4.4). */
const ZERO_MEAN: readonly number[] = Object.freeze(new Array<number>(TRAIT_COUNT).fill(0));

export interface PreparedTraitSampler {
  /** One avatar. */
  draw(seed: number): TraitResult;
  /** The lower-triangular Cholesky factor, exposed so a test can prove `L @ Lt = Sigma`. */
  readonly factor: readonly (readonly number[])[];
  /** The resolved background spread, after the `sigma * factor` default is applied. */
  readonly unclassifiedSigma: number;
  /**
   * The moments this configuration produces, used to standardise every draw.
   *
   * Exposed because everything reading the OUTPUT must normalise against
   * `standardisedCovariance` rather than against the authored coordinates.
   */
  readonly moments: PopulationMoments;
}

function assertFinite(name: string, value: unknown): asserts value is number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(`Trait sampler: ${name} must be a finite number, got ${String(value)}.`);
  }
}

/**
 * Validate a configuration and decompose its matrix ONCE.
 *
 * Drawing a population means doing this tens of thousands of times otherwise, and
 * more importantly it means a bad matrix would be found on avatar one, avatar two,
 * and avatar twenty thousand rather than once at configuration time.
 */
export function prepareTraitSampler(
  config: TraitConfig,
  archetypes: ArchetypeSet,
): PreparedTraitSampler {
  assertFinite('sigma', config.sigma);
  if (config.sigma < SIGMA_MIN || config.sigma > SIGMA_MAX) {
    throw new Error(
      `Trait sampler: sigma is ${config.sigma}, outside the valid range ` +
        `${SIGMA_MIN} to ${SIGMA_MAX} (briefing §4.3). Narrower turns archetypes into ` +
        `caricatures; wider dissolves them.`,
    );
  }

  assertFinite('unclassifiedShare', config.unclassifiedShare);
  if (config.unclassifiedShare < 0 || config.unclassifiedShare > 1) {
    throw new Error(
      `Trait sampler: unclassifiedShare is ${config.unclassifiedShare}, outside 0..1.`,
    );
  }

  const unclassifiedSigma = config.unclassifiedSigma ?? config.sigma * UNCLASSIFIED_SIGMA_FACTOR;
  assertFinite('unclassifiedSigma', unclassifiedSigma);
  if (unclassifiedSigma < config.sigma) {
    throw new Error(
      `Trait sampler: unclassifiedSigma is ${unclassifiedSigma}, narrower than sigma ` +
        `(${config.sigma}). Briefing §4.4 draws the unclassified middle with a WIDER ` +
        `sigma: a background tighter than the archetypes would itself be a type, ` +
        `which is the opposite of what it is for.`,
    );
  }

  if (typeof config.archetypeMix !== 'object' || config.archetypeMix === null) {
    throw new Error(`Trait sampler: archetypeMix must be an object of key to weight.`);
  }
  let positiveWeight = 0;
  for (const [key, weight] of Object.entries(config.archetypeMix)) {
    if (!archetypes.byKey.has(key)) {
      // A typo here would otherwise be silent: an unknown key simply never gets
      // drawn, and the population quietly loses an archetype nobody notices missing.
      throw new Error(
        `Trait sampler: archetypeMix names "${key}", which is not in the archetype set ` +
          `loaded from ${archetypes.source}. Known: ${[...archetypes.byKey.keys()].join(', ')}.`,
      );
    }
    assertFinite(`archetypeMix.${key}`, weight);
    if (weight < 0) {
      throw new Error(`Trait sampler: archetypeMix.${key} is ${weight}; weights cannot be negative.`);
    }
    if (weight > 0) positiveWeight++;
  }
  if (positiveWeight === 0 && config.unclassifiedShare < 1) {
    throw new Error(
      `Trait sampler: archetypeMix has no positive weight, but unclassifiedShare is ` +
        `${config.unclassifiedShare}, so ${((1 - config.unclassifiedShare) * 100).toFixed(0)}% of ` +
        `avatars are meant to be classified. Either give an archetype weight or set ` +
        `unclassifiedShare to 1.`,
    );
  }

  // Raises on a matrix that is malformed, asymmetric, or not positive-definite.
  const factor = cholesky(config.covariance);

  // Closed form, computed once. The draw is standardised against these so the z-score
  // claim holds for ANY mix rather than for the one the archetypes were solved against
  // (D-101). archetypeMix is an operator-facing control; it will move.
  const moments = populationMoments(archetypes, config);

  const mix = { ...config.archetypeMix };
  const share = config.unclassifiedShare;
  const sigma = config.sigma;

  function draw(seed: number): TraitResult {
    assertFinite('seed', seed);

    const chooser = new Rng(seed, STREAM_ARCHETYPE);
    const unclassified = chooser.float() < share;
    // `pickWeighted` normalises, so the mix need not sum to 1.
    const archetype = unclassified ? null : archetypes.byKey.get(chooser.pickWeighted(mix))!;

    const z = standardNormals(new Rng(seed, STREAM_LATENT), TRAIT_COUNT);
    const mean = archetype?.mean ?? ZERO_MEAN;
    const spread = archetype === null ? unclassifiedSigma : sigma;

    const latent = {} as Latent;
    for (let i = 0; i < TRAIT_COUNT; i++) {
      // Row i of L is zero past column i, so the inner sum stops at i.
      let correlated = 0;
      for (let k = 0; k <= i; k++) correlated += factor[i]![k]! * z[k]!;
      // Standardised on the way out: (x - mu) / sd, per trait. The authored archetype
      // coordinates are therefore PRE-standardisation, and an avatar drawn from
      // professionalSupport does not sit at the authored mean.
      const raw = mean[i]! + spread * correlated;
      latent[TRAIT_ORDER[i]!] = (raw - moments.mean[i]!) / moments.sd[i]!;
    }

    return { archetype: archetype?.key ?? null, latent };
  }

  return { draw, factor, unclassifiedSigma, moments };
}

/**
 * One avatar from a seed and a configuration (briefing §6).
 *
 * This is the specified entry point. It validates and decomposes on every call, so
 * for a population use `prepareTraitSampler` and call `draw` per avatar: same code
 * path, same results, one decomposition.
 */
export function sampleTraits(request: TraitRequest, archetypes: ArchetypeSet): TraitResult {
  const { seed, ...config } = request;
  return prepareTraitSampler(config, archetypes).draw(seed);
}
