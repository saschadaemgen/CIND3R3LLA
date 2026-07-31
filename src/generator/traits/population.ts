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
  /** Grand mean of the mixture, per trait. Subtracted at draw time. */
  mean: number[];
  /** Per-trait population standard deviation. Divided by at draw time. */
  sd: number[];
  /** Within-component covariance. */
  within: number[][];
  /** Between-component covariance. */
  between: number[][];
  /** `within + between`. The population covariance of the AUTHORED coordinates. */
  covariance: number[][];
  /**
   * The covariance the sampler's OUTPUT actually has: `D^-1 (W + B) D^-1`.
   *
   * Unit diagonal by construction, because the draw is standardised. Anything reading
   * standardised latent - which is everything downstream - must normalise against this
   * rather than against `covariance`, or it will divide by a spread the values no longer
   * have.
   */
  standardisedCovariance: number[][];
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

  const sd = Array.from({ length: TRAIT_COUNT }, (_, i) => Math.sqrt(covariance[i]![i]!));
  const standardisedCovariance = covariance.map((row, i) =>
    row.map((v, j) => v / (sd[i]! * sd[j]!)),
  );

  return { mean, sd, within, between, covariance, standardisedCovariance };
}

/**
 * Standardise a latent vector against the population moments: `(x - mu) / sd`, per trait.
 *
 * ── WHY THIS RUNS AT DRAW TIME AND NOT AS A CALIBRATION ─────────────────────
 *
 * Both moments are properties of `(archetype set x archetypeMix)`, not of the set alone,
 * and `archetypeMix` is an OPERATOR-FACING CONTROL. Solving the archetype positions to
 * put the mean at zero fixed the moments for one mix; it cannot fix them for a mix
 * nobody has chosen yet, and the control exists precisely so it can be moved.
 *
 * Standardising here makes the z-score claim true BY CONSTRUCTION for any mix, rather
 * than true by calibration for one. The solve's mean and sd targets become a
 * convenience: they keep this transform close to the identity at the default mix, which
 * is what keeps `archetypes.json` readable as the coordinates somebody authored.
 *
 * ── TWO CONSEQUENCES THAT MUST NOT SURPRISE ANYONE ─────────────────────────
 *
 * The values in `archetypes.json` are PRE-STANDARDISATION coordinates. An avatar drawn
 * from `professionalSupport` no longer sits at the authored mean. Relative structure is
 * untouched, because every point shifts by the same constant and scales by the same
 * factor per trait, so separation and semantics are preserved.
 *
 * And SEPARATION MUST BE CHECKED IN STANDARDISED SPACE. Distances scale by `1/sd` per
 * trait, so a mix that pushed a trait's sd to 0.7 would inflate every separation along
 * it by roughly 1.4 and the floor would pass trivially. At the default mix `sd` is
 * within a few percent of 1, which is exactly why this would otherwise be missed.
 */
export function standardise(latent: readonly number[], moments: PopulationMoments): number[] {
  return latent.map((v, i) => (v - moments.mean[i]!) / moments.sd[i]!);
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

/**
 * Correlation between two weighted sums of latent traits under a given covariance.
 *
 *     corr(w_a . X, w_b . X) = w_a' C w_b / sqrt( (w_a' C w_a)(w_b' C w_b) )
 *
 * ── WHY THIS MAKES THE INTENDED/ARTEFACT SPLIT EXACT ────────────────────────
 *
 * Evaluate it twice. Under the POPULATION covariance `W + B` it gives the correlation
 * two derived fields actually have. Under the MODEL correlation matrix `Sigma` alone it
 * gives the correlation they would have from the model's own trait structure and
 * nothing else. The difference is attributable ENTIRELY to `B`.
 *
 * That last step is exact rather than approximate, and the reason is that `W` is
 * proportional to `Sigma`:
 *
 *     W = ( sum_c pi_c sigma_c^2 ) * Sigma
 *
 * A correlation is scale-free, so the proportionality constant cancels. If `B` were
 * zero the two evaluations would be identical. So `realised - implied` is precisely the
 * archetype set's structure leaking into the layer above, which may be wanted or not
 * but should be a decision rather than a surprise.
 *
 * This REPLACES the loading-overlap heuristic it was first written with. Overlap
 * under-explains by a knowable amount: two fields loading on entirely different traits
 * still correlate when those traits do, and the model specifies E-A at 0.29 and C-A at
 * 0.15, so part of any such correlation is intended in exactly the sense C/N was
 * intended in the archetype diagnostic.
 */
export function linearCombinationCorrelation(
  a: readonly number[],
  b: readonly number[],
  covariance: readonly (readonly number[])[],
): number {
  let ab = 0;
  for (let i = 0; i < a.length; i++) {
    for (let j = 0; j < b.length; j++) ab += a[i]! * b[j]! * covariance[i]![j]!;
  }
  const va = linearCombinationVariance(a, covariance);
  const vb = linearCombinationVariance(b, covariance);
  if (!(va > 0) || !(vb > 0)) return 0;
  return ab / Math.sqrt(va * vb);
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
