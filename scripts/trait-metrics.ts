/**
 * Statistics shared by `verify-traits.ts` and `calibrate-traits.ts`.
 *
 * Extracted so the gate and the calibration pass cannot drift: a threshold written
 * from one implementation and enforced by another is a bug waiting for a refactor.
 *
 * Nothing here is a dependency. The clustering and the adjusted mutual information are
 * small and standard; the AMI expectation term is Vinh, Epps and Bailey (2010).
 */

import { Rng } from '../src/generator/rng.js';

/* ------------------------------------------------------------------ moments */

export function mean(xs: readonly number[]): number {
  let s = 0;
  for (const x of xs) s += x;
  return s / xs.length;
}

export function variance(xs: readonly number[]): number {
  const m = mean(xs);
  let s = 0;
  for (const x of xs) s += (x - m) * (x - m);
  return s / (xs.length - 1);
}

/** Column-wise Pearson correlation of a sample of row vectors. */
export function correlationMatrix(rows: readonly (readonly number[])[], dim: number): number[][] {
  const cols = Array.from({ length: dim }, (_, j) => rows.map((r) => r[j]!));
  const m = cols.map(mean);
  const sd = cols.map((c) => Math.sqrt(variance(c)));
  const out: number[][] = Array.from({ length: dim }, () => new Array<number>(dim).fill(0));
  for (let i = 0; i < dim; i++) {
    for (let j = 0; j < dim; j++) {
      let s = 0;
      for (let k = 0; k < rows.length; k++) s += (cols[i]![k]! - m[i]!) * (cols[j]![k]! - m[j]!);
      out[i]![j] = s / (rows.length - 1) / (sd[i]! * sd[j]!);
    }
  }
  return out;
}

export function maxDeviation(
  a: readonly (readonly number[])[],
  b: readonly (readonly number[])[],
  names: readonly string[],
): { value: number; at: string } {
  let value = 0;
  let at = '';
  for (let i = 0; i < a.length; i++) {
    for (let j = 0; j < a.length; j++) {
      const d = Math.abs(a[i]![j]! - b[i]![j]!);
      if (d > value) {
        value = d;
        at = `${names[i]} x ${names[j]}`;
      }
    }
  }
  return { value, at };
}

/* ------------------------------------------------------- pairwise distances */

/** Coefficient of variation of all pairwise Euclidean distances. Scale-free. */
export function pairwiseDistanceCv(rows: readonly (readonly number[])[], dim: number): number {
  const n = rows.length;
  let sum = 0;
  let sumSq = 0;
  let count = 0;
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      let d = 0;
      for (let k = 0; k < dim; k++) {
        const delta = rows[i]![k]! - rows[j]![k]!;
        d += delta * delta;
      }
      const dist = Math.sqrt(d);
      sum += dist;
      sumSq += dist * dist;
      count++;
    }
  }
  const m = sum / count;
  return Math.sqrt(Math.max(0, sumSq / count - m * m)) / m;
}

/**
 * THE INDEPENDENT BASELINE, ANALYTICALLY.
 *
 * The distance between two independent draws from N(0, I_d) is `sqrt(2) * chi_d`, so
 * the coefficient of variation is `sd(chi_d) / E[chi_d]`, with the `sqrt(2)` dropping
 * out because a CV is scale-free. For six dimensions this is 0.29404.
 *
 * ── WHY THIS REPLACED A DRAWN BASELINE ──────────────────────────────────────
 *
 * The baseline is a distributional CONSTANT. Sampling it made the denominator of a
 * pass/fail ratio carry its own noise, and that noise was the DOMINANT term: measured
 * across twenty independent draws at n=1400 the baseline moved with sd 0.0017 while the
 * numerator moved with sd 0.0030, so roughly a third of the variance in every published
 * ratio came from re-measuring a number that was never in doubt. The originally
 * published 1.183 was a low-side realisation on both sides at once.
 *
 * There is nothing to gain by drawing it and a real gate to lose.
 */
export function analyticIndependentPairwiseCv(dim: number): number {
  const logMean = 0.5 * Math.LN2 + lgamma((dim + 1) / 2) - lgamma(dim / 2);
  const m = Math.exp(logMean);
  const v = dim - m * m;
  return Math.sqrt(v) / m;
}

/* ------------------------------------------------------------------ k-means */

/** Deterministic k-means++ with restarts. Returns the best assignment by inertia. */
export function kmeans(
  rows: readonly (readonly number[])[],
  k: number,
  dim: number,
  opts: { restarts?: number; iterations?: number; seed?: number } = {},
): number[] {
  const restarts = opts.restarts ?? 6;
  const iterations = opts.iterations ?? 80;
  const n = rows.length;
  let best: number[] = new Array(n).fill(0);
  let bestInertia = Infinity;

  for (let attempt = 0; attempt < restarts; attempt++) {
    const rng = new Rng((opts.seed ?? 20260731) + attempt, 'verify:kmeans');

    const centres: number[][] = [[...rows[rng.int(n)]!]];
    const closest = new Array<number>(n).fill(Infinity);
    while (centres.length < k) {
      const latest = centres[centres.length - 1]!;
      let total = 0;
      for (let i = 0; i < n; i++) {
        let d = 0;
        for (let c = 0; c < dim; c++) {
          const delta = rows[i]![c]! - latest[c]!;
          d += delta * delta;
        }
        if (d < closest[i]!) closest[i] = d;
        total += closest[i]!;
      }
      let roll = rng.float() * total;
      let picked = n - 1;
      for (let i = 0; i < n; i++) {
        roll -= closest[i]!;
        if (roll <= 0) {
          picked = i;
          break;
        }
      }
      centres.push([...rows[picked]!]);
    }

    const assign = new Array<number>(n).fill(-1);
    let inertia = 0;
    for (let iter = 0; iter < iterations; iter++) {
      let moved = false;
      inertia = 0;
      for (let i = 0; i < n; i++) {
        let bestC = 0;
        let bestD = Infinity;
        for (let c = 0; c < k; c++) {
          let d = 0;
          for (let t = 0; t < dim; t++) {
            const delta = rows[i]![t]! - centres[c]![t]!;
            d += delta * delta;
          }
          if (d < bestD) {
            bestD = d;
            bestC = c;
          }
        }
        inertia += bestD;
        if (assign[i] !== bestC) {
          assign[i] = bestC;
          moved = true;
        }
      }
      if (!moved) break;

      const sums = Array.from({ length: k }, () => new Array<number>(dim).fill(0));
      const counts = new Array<number>(k).fill(0);
      for (let i = 0; i < n; i++) {
        const c = assign[i]!;
        counts[c]!++;
        for (let t = 0; t < dim; t++) sums[c]![t]! += rows[i]![t]!;
      }
      for (let c = 0; c < k; c++) {
        if (counts[c]! === 0) continue;
        for (let t = 0; t < dim; t++) centres[c]![t] = sums[c]![t]! / counts[c]!;
      }
    }

    if (inertia < bestInertia) {
      bestInertia = inertia;
      best = [...assign];
    }
  }
  return best;
}

/* ---------------------------------------------------------------------- AMI */

/** log Gamma, Lanczos g=7. */
export function lgamma(x: number): number {
  const C = [
    0.99999999999980993, 676.5203681218851, -1259.1392167224028, 771.32342877765313,
    -176.61502916214059, 12.507343278686905, -0.13857109526572012, 9.9843695780195716e-6,
    1.5056327351493116e-7,
  ];
  if (x < 0.5) return Math.log(Math.PI / Math.sin(Math.PI * x)) - lgamma(1 - x);
  const z = x - 1;
  let a = C[0]!;
  const t = z + 7.5;
  for (let i = 1; i < 9; i++) a += C[i]! / (z + i);
  return 0.5 * Math.log(2 * Math.PI) + (z + 0.5) * Math.log(t) - t + Math.log(a);
}

function entropy(counts: readonly number[], n: number): number {
  let h = 0;
  for (const c of counts) {
    if (c === 0) continue;
    const p = c / n;
    h -= p * Math.log(p);
  }
  return h;
}

/**
 * Adjusted mutual information, arithmetic-mean normalisation.
 *
 *     AMI = (MI - E[MI]) / (mean(H(U), H(V)) - E[MI])
 *
 * The adjustment matters: plain mutual information rises with the number of clusters
 * regardless of whether the clustering is any good.
 *
 * NOTE ON COMPARING ACROSS LABEL COUNTS. The normalising denominator carries the
 * entropy of the truth labelling, so a score over 8 archetype labels and a score over 9
 * (archetypes plus the unclassified null) are NOT on the same scale. Two readings may be
 * compared with each other, never subtracted from each other.
 */
export function adjustedMutualInformation(
  labelsA: readonly number[],
  labelsB: readonly number[],
): number {
  const n = labelsA.length;
  const keysA = [...new Set(labelsA)].sort((x, y) => x - y);
  const keysB = [...new Set(labelsB)].sort((x, y) => x - y);
  const ia = new Map(keysA.map((k, i) => [k, i]));
  const ib = new Map(keysB.map((k, i) => [k, i]));

  const table = Array.from({ length: keysA.length }, () => new Array<number>(keysB.length).fill(0));
  for (let i = 0; i < n; i++) table[ia.get(labelsA[i]!)!]![ib.get(labelsB[i]!)!]!++;

  const rowSums = table.map((r) => r.reduce((s, v) => s + v, 0));
  const colSums = keysB.map((_, j) => table.reduce((s, r) => s + r[j]!, 0));

  let mi = 0;
  for (let i = 0; i < rowSums.length; i++) {
    for (let j = 0; j < colSums.length; j++) {
      const nij = table[i]![j]!;
      if (nij === 0) continue;
      mi += (nij / n) * Math.log((n * nij) / (rowSums[i]! * colSums[j]!));
    }
  }

  const lg = new Float64Array(n + 2);
  for (let i = 0; i <= n + 1; i++) lg[i] = lgamma(i + 1);

  let emi = 0;
  for (let i = 0; i < rowSums.length; i++) {
    const ai = rowSums[i]!;
    for (let j = 0; j < colSums.length; j++) {
      const bj = colSums[j]!;
      const from = Math.max(1, ai + bj - n);
      const to = Math.min(ai, bj);
      for (let nij = from; nij <= to; nij++) {
        const term = (nij / n) * Math.log((n * nij) / (ai * bj));
        const logP =
          lg[ai]! + lg[bj]! + lg[n - ai]! + lg[n - bj]! - lg[n]! -
          lg[nij]! - lg[ai - nij]! - lg[bj - nij]! - lg[n - ai - bj + nij]!;
        emi += term * Math.exp(logP);
      }
    }
  }

  const ha = entropy(rowSums, n);
  const hb = entropy(colSums, n);
  const denominator = (ha + hb) / 2 - emi;
  if (Math.abs(denominator) < 1e-12) return 0;
  return (mi - emi) / denominator;
}
