/**
 * Style derivation: a pure function of the latent vector (briefing §3, §4).
 *
 * NO `Rng` PARAMETER ANYWHERE IN THIS FILE, and that is the point rather than an
 * omission. Style is a deterministic reading of the personality: two avatars with
 * identical latent vectors write identically. Not taking a random source is what makes
 * that structural instead of a rule someone has to remember.
 */

import {
  TRAIT_ORDER,
  linearCombinationMean,
  linearCombinationVariance,
  type Latent,
  type PopulationMoments,
} from '../traits/index.js';
import {
  REACTIONS,
  STYLE_FIELDS,
  type LoadingSet,
  type LoadingVector,
  type Reaction,
  type Style,
  type StyleField,
} from './types.js';

/**
 * Normal CDF, via Abramowitz and Stegun 7.1.26. Absolute error below 1.5e-7, which is
 * four orders of magnitude finer than the 0..100 scale it feeds.
 */
export function normalCdf(z: number): number {
  const sign = z < 0 ? -1 : 1;
  const x = Math.abs(z) / Math.SQRT2;
  const t = 1 / (1 + 0.3275911 * x);
  const y =
    1 -
    ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) *
      t *
      Math.exp(-x * x);
  return 0.5 * (1 + sign * y);
}

function weightsArray(vector: LoadingVector): number[] {
  return TRAIT_ORDER.map((t) => vector[t] ?? 0);
}

function latentArray(latent: Latent): number[] {
  return TRAIT_ORDER.map((t) => latent[t]);
}

export interface FieldNormalisation {
  /** `w . mu`, the population mean of the raw combination. */
  mean: number;
  /** `sqrt(w' Cov w)`, the population standard deviation of the raw combination. */
  sd: number;
}

/**
 * The normalisation constants for one loading vector, ANALYTICALLY.
 *
 * Briefing §4.1 is explicit that the standard deviation must be analytic rather than
 * empirical, because the population covariance is known in closed form and deriving it
 * from a generated sample would make the transform depend on how many avatars happened
 * to be drawn.
 *
 * ── ONE ADDITION TO THE SPECIFIED FORMULA, AND WHY ──────────────────────────
 *
 * §4.1 gives `z = raw / sd_raw`. This uses `z = (raw - mean_raw) / sd_raw`.
 *
 * The population mean of the raw combination is not zero: the archetype set is not
 * centred (its mix is a per-request input, and the shipped set is net positive on
 * agreeableness and honesty), so `w . mu` is generally non-zero. Without subtracting it
 * the percentile is systematically offset, and a tone of 70 would NOT mean "more casual
 * than roughly 70 percent of the population" - which §4.1 says is the entire point of
 * the percentile mapping and what an operator will assume it means.
 *
 * The correction is analytic like the rest, so it costs nothing and carries no noise.
 */
export function normalisationFor(
  vector: LoadingVector,
  moments: PopulationMoments,
): FieldNormalisation {
  const w = weightsArray(vector);
  const variance = linearCombinationVariance(w, moments.covariance);
  if (!(variance > 0)) {
    throw new Error(
      `Surface: loading vector ${JSON.stringify(vector)} has zero variance under the ` +
        `population covariance, so it cannot be mapped to a percentile. Either every ` +
        `weight is zero, or the weighted traits carry no variance in this population.`,
    );
  }
  return { mean: linearCombinationMean(w, moments.mean), sd: Math.sqrt(variance) };
}

/** Precomputed normalisation for every style field. Compute once, use per avatar. */
export type StyleNormalisation = Record<StyleField, FieldNormalisation>;

export function styleNormalisation(
  loadings: LoadingSet,
  moments: PopulationMoments,
): StyleNormalisation {
  const out = {} as StyleNormalisation;
  for (const field of STYLE_FIELDS) {
    out[field] = normalisationFor(loadings.style[field], moments);
  }
  return out;
}

/** `100 * Phi((w.x - mean) / sd)`. The percentile a field reports. */
export function derivePercentile(
  vector: LoadingVector,
  latent: Latent,
  norm: FieldNormalisation,
): number {
  const w = weightsArray(vector);
  const x = latentArray(latent);
  let raw = 0;
  for (let i = 0; i < w.length; i++) raw += w[i]! * x[i]!;
  return 100 * normalCdf((raw - norm.mean) / norm.sd);
}

/**
 * Reaction weights: score each reaction, softmax, then FLOOR AND RENORMALISE.
 *
 * The floor is what makes briefing §6's second property true. A bare softmax gives
 * every avatar a non-zero probability of every reaction, and "a distribution where
 * every avatar has some probability of every reaction expresses no personality at all".
 * Below the floor a reaction is dropped entirely and the rest are renormalised, so an
 * absent key means "never" rather than "rarely", and an agreeable avatar genuinely does
 * not use thumbs-down rather than using it 0.4% of the time.
 */
export function deriveReactionWeights(
  latent: Latent,
  loadings: LoadingSet,
): Partial<Record<Reaction, number>> {
  const x = latentArray(latent);
  const scores = REACTIONS.map((r) => {
    const w = weightsArray(loadings.reactions[r]);
    let s = 0;
    for (let i = 0; i < w.length; i++) s += w[i]! * x[i]!;
    return s;
  });

  const sharpened = scores.map((s) => s * loadings.temperature);
  const max = Math.max(...sharpened);
  const exp = sharpened.map((s) => Math.exp(s - max));
  const total = exp.reduce((a, b) => a + b, 0);
  const probabilities = exp.map((e) => e / total);

  const kept = probabilities.map((p) => (p >= loadings.reactionFloor ? p : 0));
  const keptTotal = kept.reduce((a, b) => a + b, 0);
  if (keptTotal <= 0) {
    // Cannot happen with a floor below 1/8, but a silent empty distribution would be
    // far worse than a loud failure: it would mean an avatar that reacts to nothing.
    throw new Error(
      `Surface: the reaction floor ${loadings.reactionFloor} removed every reaction. ` +
        `A floor at or above ${(1 / REACTIONS.length).toFixed(3)} can empty the distribution.`,
    );
  }

  const out: Partial<Record<Reaction, number>> = {};
  for (let i = 0; i < REACTIONS.length; i++) {
    if (kept[i]! > 0) out[REACTIONS[i]!] = kept[i]! / keptTotal;
  }
  return out;
}

export interface StyleResult {
  style: Style;
  /** Fields a coherence rule changed. */
  capped: string[];
  /** Ids of the rules that fired, so a per-rule firing rate can be reported. */
  firedRules: string[];
}

/**
 * Derive the whole style block, apply overrides, then apply the coherence cap.
 *
 * ── ORDER IS LOAD-BEARING (briefing §5, §9) ─────────────────────────────────
 *
 * derive -> override -> cap. The cap runs LAST, after the percentile mapping, so the
 * mapping stays interpretable: capping before it would distort the scale the percentile
 * is defined on. And overrides bypass derivation but NOT the cap, so an overridden
 * emoji affinity on a formal-toned avatar is still capped, and appears in both
 * `overrides` and `capped` rather than being silently altered.
 */
export function deriveStyle(
  latent: Latent,
  loadings: LoadingSet,
  norm: StyleNormalisation,
  overrides: Partial<Record<StyleField, number>> = {},
): StyleResult {
  const firedRules: string[] = [];
  const values = {} as Record<StyleField, number>;
  for (const field of STYLE_FIELDS) {
    values[field] = Object.prototype.hasOwnProperty.call(overrides, field)
      ? overrides[field]!
      : derivePercentile(loadings.style[field], latent, norm[field]);
  }

  // Every enabled rule, in order. `capped` records the RULE id rather than only the
  // field, so a firing rate can be reported per rule (see CoherenceRule).
  const capped: string[] = [];
  for (const rule of loadings.coherence) {
    if (!rule.enabled) continue;
    if (values[rule.when.field] <= rule.when.below && values[rule.cap.field] > rule.cap.at) {
      values[rule.cap.field] = rule.cap.at;
      capped.push(rule.cap.field);
      firedRules.push(rule.id);
    }
  }

  return {
    style: { ...values, reactionWeights: deriveReactionWeights(latent, loadings) },
    capped,
    firedRules,
  };
}
