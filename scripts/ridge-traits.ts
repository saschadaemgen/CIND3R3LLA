/**
 * The between/within covariance surface.
 *
 *   npx tsx scripts/ridge-traits.ts
 *
 * NOT A GATE. Nothing here passes or fails, and nothing here proposes a bound.
 *
 * ── WHAT THIS IS AND WHY IT REPLACED "THE RIDGE" ────────────────────────────
 *
 * The earlier framing was: find the locus where the realised per-trait standard
 * deviation equals 1, treat that as a ridge, and bound quality along it. That framing
 * is superseded. Two corrections, both from the methodology review:
 *
 *   1. **The target standard deviation is not ours to define.** It comes from the real
 *      reference's standardisation, applied unchanged to synthetic data. Realised sd
 *      landing near 1 is a CONSEQUENCE of that, not a self-imposed axiom, and
 *      re-standardising synthetic data by its own moments would erase exactly the
 *      deviation being tested.
 *   2. **Matching sd is necessary and nowhere near sufficient.** It says nothing about
 *      skew, kurtosis, tail mass, floor and ceiling effects or copula shape, all of
 *      which real personality data has and a Gaussian mixture does not.
 *
 * What survives, and is genuinely needed under the new approach, is the decomposition
 * underneath it. For a mixture population:
 *
 *     Cov(X) = W + B
 *     W = [ sum_c pi_c sigma_c^2 ] * Sigma        within components
 *     B = sum_c pi_c (mu_c - mu_bar)(mu_c - mu_bar)^T   between components
 *
 * `sigma` and centroid separation interact because BOTH control the ratio of B to W.
 * That is why they collapse to roughly one degree of freedom, and it is a better
 * explanation than "there is a ridge in the surface": the ridge was a shadow of this.
 *
 * ── EVERYTHING HERE IS ANALYTIC ─────────────────────────────────────────────
 *
 * W and B are closed forms in the archetype means, the mixture weights and the two
 * spreads. So is the realised per-trait variance, which is diag(W + B). No sampling, no
 * Monte Carlo noise, no seed dependence, and no "curve of measure zero" problem: the
 * surface is exact and a tolerance band around it is an exact region.
 *
 * The one sampled figure is the empirical check at the end, which exists only to prove
 * the closed forms describe the sampler that actually ships.
 */

import {
  DEFAULT_ARCHETYPE_MIX,
  DEFAULT_SIGMA,
  DEFAULT_UNCLASSIFIED_SHARE,
  TRAIT_COUNT,
  TRAIT_ORDER,
  UNCLASSIFIED_SIGMA_FACTOR,
  defaultCovariance,
  loadArchetypes,
  prepareTraitSampler,
  separations,
  type ArchetypeSet,
} from '../src/generator/traits/index.js';
import { mean, variance } from './trait-metrics.js';

const base = loadArchetypes();
const SIGMA = defaultCovariance();
const BASE_MIN_SEP = separations(base)[0]!.distance;

const SIGMAS = [0.5, 0.55, 0.6, 0.65, 0.7];
const SEPARATIONS = [1.5, 1.75, 2.0, 2.25, 2.5];

/* --------------------------------------------------------- linear algebra */

type Matrix = number[][];

function zeros(n: number): Matrix {
  return Array.from({ length: n }, () => new Array<number>(n).fill(0));
}

function trace(m: Matrix): number {
  let t = 0;
  for (let i = 0; i < m.length; i++) t += m[i]![i]!;
  return t;
}

function multiply(a: Matrix, b: Matrix): Matrix {
  const n = a.length;
  const out = zeros(n);
  for (let i = 0; i < n; i++)
    for (let j = 0; j < n; j++) {
      let s = 0;
      for (let k = 0; k < n; k++) s += a[i]![k]! * b[k]![j]!;
      out[i]![j] = s;
    }
  return out;
}

/**
 * Jacobi eigendecomposition of a symmetric matrix. Returns eigenvalues and the
 * orthogonal matrix of eigenvectors in columns.
 *
 * Jacobi rather than anything cleverer because the matrices here are 6x6, it is
 * unconditionally stable for symmetric input, and it needs no dependency.
 */
function jacobiEigen(input: Matrix): { values: number[]; vectors: Matrix } {
  const n = input.length;
  const a = input.map((r) => [...r]);
  const v = zeros(n);
  for (let i = 0; i < n; i++) v[i]![i] = 1;

  for (let sweep = 0; sweep < 100; sweep++) {
    let off = 0;
    for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) off += a[i]![j]! * a[i]![j]!;
    if (off < 1e-24) break;

    for (let p = 0; p < n; p++) {
      for (let q = p + 1; q < n; q++) {
        if (Math.abs(a[p]![q]!) < 1e-18) continue;
        const theta = (a[q]![q]! - a[p]![p]!) / (2 * a[p]![q]!);
        const t = Math.sign(theta || 1) / (Math.abs(theta) + Math.sqrt(theta * theta + 1));
        const c = 1 / Math.sqrt(t * t + 1);
        const s = t * c;
        for (let k = 0; k < n; k++) {
          const akp = a[k]![p]!;
          const akq = a[k]![q]!;
          a[k]![p] = c * akp - s * akq;
          a[k]![q] = s * akp + c * akq;
        }
        for (let k = 0; k < n; k++) {
          const apk = a[p]![k]!;
          const aqk = a[q]![k]!;
          a[p]![k] = c * apk - s * aqk;
          a[q]![k] = s * apk + c * aqk;
        }
        for (let k = 0; k < n; k++) {
          const vkp = v[k]![p]!;
          const vkq = v[k]![q]!;
          v[k]![p] = c * vkp - s * vkq;
          v[k]![q] = s * vkp + c * vkq;
        }
      }
    }
  }
  return { values: Array.from({ length: n }, (_, i) => a[i]![i]!), vectors: v };
}

/** `M^(-1/2)` for a symmetric positive-definite `M`. */
function inverseSqrt(m: Matrix): Matrix {
  const { values, vectors } = jacobiEigen(m);
  const n = m.length;
  const d = zeros(n);
  for (let i = 0; i < n; i++) {
    if (!(values[i]! > 0)) {
      throw new Error(`inverseSqrt: matrix is not positive-definite (eigenvalue ${values[i]}).`);
    }
    d[i]![i] = 1 / Math.sqrt(values[i]!);
  }
  const vt = zeros(n);
  for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) vt[i]![j] = vectors[j]![i]!;
  return multiply(multiply(vectors, d), vt);
}

/* ------------------------------------------------- the closed-form surface */

interface Decomposition {
  /** Within-component covariance. */
  W: Matrix;
  /** Between-component covariance. */
  B: Matrix;
  /** `tr(B) / tr(B + W)`. The interpretable scalar for cluster intensity. */
  etaTrace: number;
  /** Eigenvalues of `W^(-1/2) B W^(-1/2)`, descending. */
  spectrum: number[];
  /** Realised per-trait standard deviation, `sqrt(diag(W + B))`. */
  perTraitSd: number[];
}

/**
 * Decompose the population a configuration produces. Closed form, no sampling.
 *
 * Components are the eight archetypes at weight `(1 - u)/8` each, plus the unclassified
 * background at the origin with weight `u`. The background is a component like any
 * other: it has a mean (zero) and a spread, and leaving it out of `B` would understate
 * the between-variance by exactly the amount its displacement from the grand mean
 * contributes.
 */
function decompose(
  set: ArchetypeSet,
  sigma: number,
  unclassifiedShare: number,
  unclassifiedSigma?: number,
): Decomposition {
  const u = unclassifiedShare;
  const sigmaU = unclassifiedSigma ?? sigma * UNCLASSIFIED_SIGMA_FACTOR;
  const k = set.list.length;
  const wEach = (1 - u) / k;

  // Components: k archetypes plus the background.
  const means: number[][] = [...set.list.map((a) => [...a.mean]), new Array<number>(TRAIT_COUNT).fill(0)];
  const weights: number[] = [...new Array<number>(k).fill(wEach), u];
  const spreads: number[] = [...new Array<number>(k).fill(sigma), sigmaU];

  // W = (sum_c pi_c sigma_c^2) * Sigma
  let wScale = 0;
  for (let c = 0; c < weights.length; c++) wScale += weights[c]! * spreads[c]! * spreads[c]!;
  const W = SIGMA.map((row) => row.map((v) => v * wScale));

  // Grand mean, then B.
  const grand = new Array<number>(TRAIT_COUNT).fill(0);
  for (let c = 0; c < means.length; c++)
    for (let i = 0; i < TRAIT_COUNT; i++) grand[i]! += weights[c]! * means[c]![i]!;

  const B = zeros(TRAIT_COUNT);
  for (let c = 0; c < means.length; c++) {
    const d = means[c]!.map((v, i) => v - grand[i]!);
    for (let i = 0; i < TRAIT_COUNT; i++)
      for (let j = 0; j < TRAIT_COUNT; j++) B[i]![j]! += weights[c]! * d[i]! * d[j]!;
  }

  const total = W.map((row, i) => row.map((v, j) => v + B[i]![j]!));
  const perTraitSd = Array.from({ length: TRAIT_COUNT }, (_, i) => Math.sqrt(total[i]![i]!));

  const wInvSqrt = inverseSqrt(W);
  const whitened = multiply(multiply(wInvSqrt, B), wInvSqrt);
  const spectrum = jacobiEigen(whitened).values.sort((a, b) => b - a);

  return { W, B, etaTrace: trace(B) / trace(total), spectrum, perTraitSd };
}

function scaledSet(target: number): ArchetypeSet {
  const factor = target / BASE_MIN_SEP;
  const list = base.list.map((a) => ({ ...a, mean: a.mean.map((v) => v * factor) }));
  return { list, byKey: new Map(list.map((a) => [a.key, a])), source: `scaled x${factor}` };
}

function pad(x: number, d = 3, w = 8): string {
  return x.toFixed(d).padStart(w);
}

/* ==================================================================== report */

console.log('Trait sampler: the between/within covariance surface');
console.log('='.repeat(78));
console.log(`
Closed form. No sampling, no seed dependence, no Monte Carlo noise.

    Cov(X) = W + B          W = [sum_c pi_c sigma_c^2] * Sigma
                            B = sum_c pi_c (mu_c - mu_bar)(mu_c - mu_bar)^T

Components: ${base.list.length} archetypes at weight (1 - u)/${base.list.length}, plus the unclassified
background at the origin with weight u = ${DEFAULT_UNCLASSIFIED_SHARE}. The background is a component
like any other; omitting it from B would understate the between-variance.

NOTHING HERE IS A BOUND. The quality bounds are held pending the reference-data layer.
`);

/* ------------------------------------------------------------ eta_trace */

console.log('\n1. CLUSTER INTENSITY: eta_trace = tr(B) / tr(B + W)');
console.log('-'.repeat(78));
console.log(`  ${'sep\\sig'.padEnd(10)}${SIGMAS.map((s) => s.toFixed(2).padStart(8)).join('')}`);
for (const sep of SEPARATIONS) {
  const set = scaledSet(sep);
  const cells = SIGMAS.map((s) => pad(decompose(set, s, DEFAULT_UNCLASSIFIED_SHARE).etaTrace));
  console.log(`  ${sep.toFixed(2).padEnd(10)}${cells.join('')}`);
}
console.log(`
  This is the single scalar that sigma and separation BOTH control, and it is why they
  are not two independent dials. Read across a row or down a column and the same value
  recurs at different (sigma, separation) pairs: those configurations produce the same
  cluster intensity by different routes.`);

/* ---------------------------------------------------- realised per-trait sd */

console.log('\n2. REALISED PER-TRAIT sd = sqrt(diag(W + B)), mean over the six traits');
console.log('-'.repeat(78));
console.log(`  ${'sep\\sig'.padEnd(10)}${SIGMAS.map((s) => s.toFixed(2).padStart(8)).join('')}`);
for (const sep of SEPARATIONS) {
  const set = scaledSet(sep);
  const cells = SIGMAS.map((s) => pad(mean(decompose(set, s, DEFAULT_UNCLASSIFIED_SHARE).perTraitSd)));
  console.log(`  ${sep.toFixed(2).padEnd(10)}${cells.join('')}`);
}
console.log(`
  REPORTED, NOT TARGETED. Under the measurement contract the standardisation comes from
  a real training split and is applied unchanged to synthetic data, so this landing near
  1 would be a CONSEQUENCE of matching the reference, never a target set here. Until
  that reference exists there is nothing to standardise against, and these are the
  sampler's own numbers on its own scale.`);

/* ------------------------------------------------------- the spread of sd */

console.log('\n3. ANISOTROPY: max/min per-trait sd, at each configuration');
console.log('-'.repeat(78));
console.log(`  ${'sep\\sig'.padEnd(10)}${SIGMAS.map((s) => s.toFixed(2).padStart(8)).join('')}`);
for (const sep of SEPARATIONS) {
  const set = scaledSet(sep);
  const cells = SIGMAS.map((s) => {
    const sd = decompose(set, s, DEFAULT_UNCLASSIFIED_SHARE).perTraitSd;
    return pad(Math.max(...sd) / Math.min(...sd));
  });
  console.log(`  ${sep.toFixed(2).padEnd(10)}${cells.join('')}`);
}
console.log(`
  A mean sd of 1.0 can hide a population that is wide on one trait and narrow on
  another. This ratio is what a single averaged number conceals, and it is driven by the
  archetype set's shape rather than by either dial: scaling the set moves every trait
  together, so the anisotropy is nearly constant down each column.`);

/* -------------------------------------------------------------- spectrum */

console.log('\n4. THE SPECTRUM OF W^(-1/2) B W^(-1/2), at the shipped configuration');
console.log('-'.repeat(78));
{
  const d = decompose(base, DEFAULT_SIGMA, DEFAULT_UNCLASSIFIED_SHARE);
  console.log(`  eigenvalues: ${d.spectrum.map((v) => v.toFixed(4)).join('  ')}`);
  const positive = d.spectrum.filter((v) => v > 1e-9).length;
  console.log(`  non-zero directions: ${positive} of ${TRAIT_COUNT}`);
  console.log(`
  Why this is recorded alongside eta_trace and not instead of it: two generators can
  share a trace share while one concentrates its between-variance along a single
  direction and the other spreads it across all six. The trace share cannot tell them
  apart; the spectrum can. Here the between-variance occupies ${positive} directions, which is
  what ${base.list.length} archetype means plus a background at the origin can span.`);
}

/* ------------------------------------------------- necessary, not sufficient */

console.log('\n5. IS MATCHING sd DOING REAL WORK? TWO ADVERSARIAL CASES');
console.log('-'.repeat(78));
console.log(`
  The question asked was whether a configuration exists that satisfies the sd constraint
  while producing bad output, and whether one exists that violates it while producing
  good output. If neither exists the constraint is load-bearing. Both exist, and neither
  is contrived.
`);
{
  // Case A: perfect sd, no structure at all. Every draw unclassified, spread exactly 1.
  // This is the featureless blob the whole component exists to avoid, and it satisfies
  // the sd claim EXACTLY rather than approximately.
  const blob = decompose(base, DEFAULT_SIGMA, 1, 1);
  const blobSd = mean(blob.perTraitSd);
  console.log(`  A. unclassifiedShare = 1, background spread exactly 1 (no archetypes at all)`);
  console.log(`     mean per-trait sd  ${blobSd.toFixed(4)}      eta_trace ${blob.etaTrace.toFixed(4)}`);
  console.log(`     Satisfies the sd claim EXACTLY, to every decimal, and has ZERO cluster`);
  console.log(`     structure. It is precisely the featureless population the archetype`);
  console.log(`     layer exists to prevent, and it is the best possible score on sd.`);

  // Case B: the shipped default, which is 3.4 percent compressed and is the
  // best-structured configuration measured anywhere in this pass.
  const shipped = decompose(base, DEFAULT_SIGMA, DEFAULT_UNCLASSIFIED_SHARE);
  console.log(`\n  B. the SHIPPED default (sigma ${DEFAULT_SIGMA}, separation ${BASE_MIN_SEP.toFixed(3)})`);
  console.log(
    `     mean per-trait sd  ${mean(shipped.perTraitSd).toFixed(4)}      eta_trace ${shipped.etaTrace.toFixed(4)}`,
  );
  console.log(`     Violates a strict sd = 1 reading by ${((1 - mean(shipped.perTraitSd)) * 100).toFixed(1)} percent and is the`);
  console.log(`     structured configuration everything else is compared against.`);

  console.log(`
  CONCLUSION: the sd constraint is NECESSARY AND FAR FROM SUFFICIENT. It is a
  definitional check that the stated representation is honest, and it says nothing about
  whether the population has structure. Case A passes it perfectly and is useless; case
  B fails a strict reading of it and is what ships. It cannot be the primary gate, and
  eta_trace plus the spectrum are what distinguish the two.`);
}

/* ------------------------------------------------ the closed form is the sampler */

console.log('\n6. THE CLOSED FORMS DESCRIBE THE SAMPLER THAT SHIPS');
console.log('-'.repeat(78));
{
  const predicted = decompose(base, DEFAULT_SIGMA, DEFAULT_UNCLASSIFIED_SHARE).perTraitSd;
  const sampler = prepareTraitSampler(
    {
      archetypeMix: DEFAULT_ARCHETYPE_MIX,
      unclassifiedShare: DEFAULT_UNCLASSIFIED_SHARE,
      sigma: DEFAULT_SIGMA,
      covariance: defaultCovariance(),
    },
    base,
  );
  const rows: number[][] = [];
  for (let i = 0; i < 40_000; i++) {
    const r = sampler.draw(i);
    rows.push(TRAIT_ORDER.map((k) => r.latent[k]));
  }
  console.log('  trait               predicted   sampled   difference');
  let worst = 0;
  for (let i = 0; i < TRAIT_COUNT; i++) {
    const sampled = Math.sqrt(variance(rows.map((r) => r[i]!)));
    const diff = Math.abs(sampled - predicted[i]!);
    worst = Math.max(worst, diff);
    console.log(
      `  ${TRAIT_ORDER[i]!.padEnd(20)}${pad(predicted[i]!, 4)}${pad(sampled, 4)}${pad(diff, 4)}`,
    );
  }
  console.log(`\n  worst difference ${worst.toFixed(4)} over 40,000 draws.`);
  console.log(
    `  The closed form is the population the sampler actually produces, so every surface\n` +
      `  above is exact rather than estimated.`,
  );
}

/* ------------------------------------------- what the near-null direction is */

console.log('\n7. THE NEAR-NULL DIRECTION: WHICH TRAITS CARRY NO ARCHETYPE VARIATION');
console.log('-'.repeat(78));
{
  const d = decompose(base, DEFAULT_SIGMA, DEFAULT_UNCLASSIFIED_SHARE);

  // Between-archetype variance per trait, over the EIGHT archetype means alone. The
  // background is excluded here on purpose: this asks what the archetype set spans, not
  // what the population does.
  console.log('  between-archetype variance per trait (the 8 means alone, background excluded)');
  const perTrait: { trait: string; v: number }[] = [];
  for (let i = 0; i < TRAIT_COUNT; i++) {
    const col = base.list.map((a) => a.mean[i]!);
    const m = mean(col);
    perTrait.push({
      trait: TRAIT_ORDER[i]!,
      v: col.reduce((s, x) => s + (x - m) * (x - m), 0) / col.length,
    });
  }
  for (const { trait, v } of [...perTrait].sort((a, b) => b.v - a.v)) {
    console.log(`    ${trait.padEnd(20)}${pad(v, 4)}`);
  }

  // The generalized eigenvector. v solves W^(-1/2) B W^(-1/2) v = lambda v, so
  // a = W^(-1/2) v solves B a = lambda W a: the trait-space direction whose
  // between-over-within ratio is lambda. That is the direction being asked about.
  const wInvSqrt = inverseSqrt(d.W);
  const whitened = multiply(multiply(wInvSqrt, d.B), wInvSqrt);
  const { values, vectors } = jacobiEigen(whitened);
  let minIdx = 0;
  for (let i = 1; i < values.length; i++) if (values[i]! < values[minIdx]!) minIdx = i;

  const vMin = Array.from({ length: TRAIT_COUNT }, (_, i) => vectors[i]![minIdx]!);
  const aRaw = Array.from({ length: TRAIT_COUNT }, (_, i) => {
    let s = 0;
    for (let j = 0; j < TRAIT_COUNT; j++) s += wInvSqrt[i]![j]! * vMin[j]!;
    return s;
  });
  const norm = Math.sqrt(aRaw.reduce((s, x) => s + x * x, 0));
  const a = aRaw.map((x) => x / norm);

  console.log(`\n  smallest whitened eigenvalue: ${values[minIdx]!.toExponential(3)}`);
  console.log('  that direction, in trait coordinates (unit vector, sorted by weight):');
  const loadings = a
    .map((w, i) => ({ trait: TRAIT_ORDER[i]!, w }))
    .sort((x, y) => Math.abs(y.w) - Math.abs(x.w));
  for (const { trait, w } of loadings) {
    const bar = '#'.repeat(Math.round(Math.abs(w) * 40));
    console.log(`    ${trait.padEnd(20)}${(w >= 0 ? ' ' : '') + w.toFixed(4)}  ${bar}`);
  }

  const dominant = loadings[0]!;
  const share = dominant.w * dominant.w;
  console.log(`
  Largest single-trait share of that direction: ${dominant.trait} at ${(share * 100).toFixed(1)}%
  of the squared length. A direction aligned with one trait would be near 100%.`);

  // The H values as actually authored, because the hypothesis rests on a claim about them.
  console.log('\n  Honesty-Humility and Agreeableness, as authored across the eight archetypes:');
  console.log(`    ${'archetype'.padEnd(22)}${'H'.padStart(7)}${'A'.padStart(7)}`);
  for (const arch of [...base.list].sort((x, y) => y.mean[5]! - x.mean[5]!)) {
    console.log(`    ${arch.key.padEnd(22)}${pad(arch.mean[5]!, 2, 7)}${pad(arch.mean[3]!, 2, 7)}`);
  }

  // Between-archetype correlation of every pair, so the collinearity is measured rather
  // than eyeballed off the table above.
  function betweenCorr(i: number, j: number): number {
    const x = base.list.map((a) => a.mean[i]!);
    const y = base.list.map((a) => a.mean[j]!);
    const mx = mean(x);
    const my = mean(y);
    let sxy = 0;
    let sxx = 0;
    let syy = 0;
    for (let k = 0; k < x.length; k++) {
      sxy += (x[k]! - mx) * (y[k]! - my);
      sxx += (x[k]! - mx) ** 2;
      syy += (y[k]! - my) ** 2;
    }
    return sxy / Math.sqrt(sxx * syy);
  }

  console.log('\n  strongest between-archetype trait correlations (over the 8 means):');
  const pairs: { a: string; b: string; r: number }[] = [];
  for (let i = 0; i < TRAIT_COUNT; i++)
    for (let j = i + 1; j < TRAIT_COUNT; j++)
      pairs.push({ a: TRAIT_ORDER[i]!, b: TRAIT_ORDER[j]!, r: betweenCorr(i, j) });
  for (const p of pairs.sort((x, y) => Math.abs(y.r) - Math.abs(x.r)).slice(0, 4)) {
    console.log(
      `    ${(p.a + ' / ' + p.b).padEnd(40)}r = ${p.r >= 0 ? ' ' : ''}${p.r.toFixed(3)}   R2 = ${(p.r * p.r).toFixed(3)}`,
    );
  }
  const ah = betweenCorr(3, 5);
  console.log(`
  THE CAUSE. H is not flat across the archetypes: its between-archetype variance is
  ${perTrait[5]!.v.toFixed(3)}, the smallest of six but only ${((1 - perTrait[5]!.v / perTrait[2]!.v) * 100).toFixed(0)}% below extraversion's and within
  ${(((perTrait[4]!.v - perTrait[5]!.v) / perTrait[5]!.v) * 100).toFixed(0)}% of neuroticism's. What is nearly absent is H's INDEPENDENT variation:
  across these eight means H correlates with agreeableness at r = ${ah.toFixed(3)}, so
  ${(ah * ah * 100).toFixed(1)}% of its between-archetype variance is already carried by A. The archetypes
  vary in H only insofar as they vary in A, which is why the contrast direction above
  (H against A) has almost no between-variance left in it.

  This is a property of HOW THESE EIGHT VECTORS WERE AUTHORED, not of the model. An
  archetype where H and A diverge (agreeable but manipulative, or blunt but honest)
  would make H informative immediately and would close this direction.`);
}

console.log('\nNothing here passes or fails. Nothing here proposes a bound.');
