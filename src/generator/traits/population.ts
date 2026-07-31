/**
 * The population covariance, in closed form.
 *
 * Moved here from `scripts/ridge-traits.ts` because the surface derivation needs it at
 * call time, not only in an analysis pass: the style percentile normalisation divides
 * by `sqrt(w' Cov w)`, and that has to be the same covariance the analysis reports or
 * the two will drift.
 *
 * ── WHY CLOSED FORM RATHER THAN SAMPLED ─────────────────────────────────────
 *
 * The sampler draws from a MIXTURE: `k` archetype components at their own weights plus
 * an unclassified background at the origin. For any such mixture,
 *
 *     Cov(X) = W + B
 *     W = [ sum_c pi_c sigma_c^2 ] * Sigma          within components
 *     B = sum_c pi_c (mu_c - mu_bar)(mu_c - mu_bar)'    between components
 *
 * Both are exact in the archetype means, the mixture weights and the two spreads, so
 * there is no Monte Carlo noise and no seed dependence anywhere downstream of this.
 * Deriving it from a generated sample instead would make every style percentile depend
 * on how many avatars happened to be drawn, which is the kind of dependency that is
 * invisible until someone changes a sample size.
 *
 * `verify:surface` checks the closed form against a large sample rather than trusting
 * it, which is the point of having a closed form worth checking.
 *
 * THE BACKGROUND IS A COMPONENT LIKE ANY OTHER. It has a mean (zero) and a spread, and
 * leaving it out of `B` understates the between-variance by exactly the amount its
 * displacement from the grand mean contributes.
 */

import { TRAIT_COUNT, UNCLASSIFIED_SIGMA_FACTOR, type ArchetypeSet, type TraitConfig } from './types.js';

export interface PopulationMoments {
  /** Grand mean of the mixture, per trait. */
  mean: number[];
  /** Within-component covariance. */
  within: number[][];
  /** Between-component covariance. */
  between: number[][];
  /** `within + between`. The population covariance. */
  covariance: number[][];
}

/**
 * Moments of the population a configuration produces. Exact; no sampling.
 *
 * `archetypeMix` weights are normalised over the classified share, matching what
 * `Rng.pickWeighted` does at draw time, so a mix that does not sum to one behaves here
 * exactly as it behaves in the sampler.
 */
export function populationMoments(
  archetypes: ArchetypeSet,
  config: Pick<
    TraitConfig,
    'archetypeMix' | 'unclassifiedShare' | 'sigma' | 'unclassifiedSigma' | 'covariance'
  >,
): PopulationMoments {
  const u = config.unclassifiedShare;
  const sigmaU = config.unclassifiedSigma ?? config.sigma * UNCLASSIFIED_SIGMA_FACTOR;

  const entries = archetypes.list
    .map((a) => ({ archetype: a, weight: config.archetypeMix[a.key] ?? 0 }))
    .filter((e) => e.weight > 0);
  const totalWeight = entries.reduce((s, e) => s + e.weight, 0);

  const means: number[][] = [];
  const weights: number[] = [];
  const spreads: number[] = [];
  for (const e of entries) {
    means.push([...e.archetype.mean]);
    weights.push(totalWeight > 0 ? ((1 - u) * e.weight) / totalWeight : 0);
    spreads.push(config.sigma);
  }
  // The background.
  means.push(new Array<number>(TRAIT_COUNT).fill(0));
  weights.push(u);
  spreads.push(sigmaU);

  let withinScale = 0;
  for (let c = 0; c < weights.length; c++) withinScale += weights[c]! * spreads[c]! * spreads[c]!;

  const mean = new Array<number>(TRAIT_COUNT).fill(0);
  for (let c = 0; c < means.length; c++) {
    for (let i = 0; i < TRAIT_COUNT; i++) mean[i]! += weights[c]! * means[c]![i]!;
  }

  const between: number[][] = Array.from({ length: TRAIT_COUNT }, () =>
    new Array<number>(TRAIT_COUNT).fill(0),
  );
  for (let c = 0; c < means.length; c++) {
    const d = means[c]!.map((v, i) => v - mean[i]!);
    for (let i = 0; i < TRAIT_COUNT; i++) {
      for (let j = 0; j < TRAIT_COUNT; j++) between[i]![j]! += weights[c]! * d[i]! * d[j]!;
    }
  }

  const within = config.covariance.map((row) => row.map((v) => v * withinScale));
  const covariance = within.map((row, i) => row.map((v, j) => v + between[i]![j]!));

  return { mean, within, between, covariance };
}

/**
 * Variance of a weighted sum of latent traits, under the population covariance.
 *
 *     Var(w . X) = w' Cov w
 *
 * This is the exact quantity the style normalisation divides by.
 */
export function linearCombinationVariance(
  weights: readonly number[],
  covariance: readonly (readonly number[])[],
): number {
  let sum = 0;
  for (let i = 0; i < weights.length; i++) {
    for (let j = 0; j < weights.length; j++) {
      sum += weights[i]! * weights[j]! * covariance[i]![j]!;
    }
  }
  return sum;
}

/** Mean of a weighted sum of latent traits: `w . mu`. */
export function linearCombinationMean(
  weights: readonly number[],
  populationMean: readonly number[],
): number {
  let sum = 0;
  for (let i = 0; i < weights.length; i++) sum += weights[i]! * populationMean[i]!;
  return sum;
}
