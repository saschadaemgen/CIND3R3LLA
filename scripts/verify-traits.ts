/**
 * The trait sampler, proven (briefing §7).
 *
 * Covers every required test: determinism, correctness of the sampling, the
 * covariance index order, failure behaviour, population composition, and the two
 * anti-mush properties that are the point of the component.
 *
 *   npx tsx scripts/verify-traits.ts
 *
 * TWO NUMBERS ARE REPORTED WHETHER OR NOT THEY PASS. Briefing §7 sets the adjusted
 * mutual information bounds at 0.2 and 0.9 and says in terms that these "are
 * starting points, not established values", to be calibrated once real output
 * exists. The same goes for how much higher the pairwise-distance spread has to be
 * than the independent baseline. Both measurements are printed on every run, so
 * calibrating them is reading a line rather than instrumenting the harness.
 *
 * The clustering and the adjusted mutual information are implemented here rather
 * than pulled in, for the same reason the rest of this component has no
 * dependencies. Both are small and both are standard; the AMI expectation term is
 * the Vinh, Epps and Bailey (2010) formula.
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  ARCHETYPE_SEPARATION_MAX,
  DEFAULT_ARCHETYPE_MIX,
  DEFAULT_ARCHETYPE_SEPARATION,
  DEFAULT_CORRELATIONS,
  DEFAULT_SIGMA,
  DEFAULT_UNCLASSIFIED_SHARE,
  SIGMA_MAX,
  SIGMA_MIN,
  TRAIT_COUNT,
  TRAIT_INDEX,
  TRAIT_ORDER,
  assertSeparation,
  buildCorrelationMatrix,
  cholesky,
  defaultCovariance,
  loadArchetypes,
  parseArchetypes,
  prepareTraitSampler,
  productWithTranspose,
  ridgeRepair,
  sampleTraits,
  separations,
  Rng,
  type ArchetypeSet,
  type TraitConfig,
  type TraitKey,
  type TraitResult,
} from '../src/generator/traits/index.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

let failures = 0;
function check(label: string, ok: boolean, detail = ''): void {
  if (!ok) failures++;
  console.log(`  [${ok ? 'PASS' : 'FAIL'}] ${label}${detail ? ` - ${detail}` : ''}`);
}
function section(t: string): void {
  console.log(`\n${t}`);
}
/** A measurement that is reported whether or not anything is asserted about it. */
function measure(label: string, value: string): void {
  console.log(`  [....] ${label} = ${value}`);
}
/**
 * Strip comments so a structural source check tests the code and not the prose
 * describing it. Same approach as `verify:no-dashes`, and the same reason.
 */
function stripComments(src: string): string {
  const withoutBlocks = src.replace(/\/\*[\s\S]*?\*\//g, ' ');
  return withoutBlocks
    .split('\n')
    .map((line) => {
      const m = /(^|[^:])\/\//.exec(line);
      return m ? line.slice(0, m.index + m[1]!.length) : line;
    })
    .join('\n');
}

function threw(fn: () => unknown): Error | null {
  try {
    fn();
    return null;
  } catch (err) {
    return err instanceof Error ? err : new Error(String(err));
  }
}

const archetypes: ArchetypeSet = loadArchetypes();

/** The default population configuration. */
function config(over: Partial<TraitConfig> = {}): TraitConfig {
  return {
    archetypeMix: DEFAULT_ARCHETYPE_MIX,
    unclassifiedShare: DEFAULT_UNCLASSIFIED_SHARE,
    sigma: DEFAULT_SIGMA,
    covariance: defaultCovariance(),
    ...over,
  };
}

/**
 * A configuration that isolates the sampling machinery: every draw is unclassified,
 * so `mu` is the zero vector, and the background spread is exactly 1. The
 * population is then precisely N(0, Sigma), which is what makes "the empirical
 * covariance matches the target" and "each marginal is approximately standard
 * normal" testable statements about the maths rather than about the archetype set.
 */
function machineryConfig(covariance: number[][]): TraitConfig {
  return {
    archetypeMix: DEFAULT_ARCHETYPE_MIX,
    unclassifiedShare: 1,
    sigma: DEFAULT_SIGMA,
    unclassifiedSigma: 1,
    covariance,
  };
}

function drawMany(n: number, cfg: TraitConfig, seedFrom = 0): TraitResult[] {
  const sampler = prepareTraitSampler(cfg, archetypes);
  const out: TraitResult[] = new Array(n);
  for (let i = 0; i < n; i++) out[i] = sampler.draw(seedFrom + i);
  return out;
}

function vectorOf(r: TraitResult): number[] {
  return TRAIT_ORDER.map((k) => r.latent[k]);
}

/* --------------------------------------------------------------- statistics */

function mean(xs: readonly number[]): number {
  let s = 0;
  for (const x of xs) s += x;
  return s / xs.length;
}
function variance(xs: readonly number[]): number {
  const m = mean(xs);
  let s = 0;
  for (const x of xs) s += (x - m) * (x - m);
  return s / (xs.length - 1);
}
/** Column-wise Pearson correlation of a sample of row vectors. */
function correlationMatrix(rows: readonly (readonly number[])[]): number[][] {
  const d = TRAIT_COUNT;
  const cols = Array.from({ length: d }, (_, j) => rows.map((r) => r[j]!));
  const m = cols.map(mean);
  const sd = cols.map((c) => Math.sqrt(variance(c)));
  const out: number[][] = Array.from({ length: d }, () => new Array<number>(d).fill(0));
  for (let i = 0; i < d; i++) {
    for (let j = 0; j < d; j++) {
      let s = 0;
      for (let k = 0; k < rows.length; k++) s += (cols[i]![k]! - m[i]!) * (cols[j]![k]! - m[j]!);
      out[i]![j] = s / (rows.length - 1) / (sd[i]! * sd[j]!);
    }
  }
  return out;
}
/** Largest absolute difference between two matrices, and where it is. */
function maxDeviation(
  a: readonly (readonly number[])[],
  b: readonly (readonly number[])[],
): { value: number; at: string } {
  let value = 0;
  let at = '';
  for (let i = 0; i < a.length; i++) {
    for (let j = 0; j < a.length; j++) {
      const d = Math.abs(a[i]![j]! - b[i]![j]!);
      if (d > value) {
        value = d;
        at = `${TRAIT_ORDER[i]} x ${TRAIT_ORDER[j]}`;
      }
    }
  }
  return { value, at };
}

/** Coefficient of variation of all pairwise Euclidean distances. Scale-free. */
function pairwiseDistanceCv(rows: readonly (readonly number[])[]): number {
  const n = rows.length;
  let sum = 0;
  let sumSq = 0;
  let count = 0;
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      let d = 0;
      for (let k = 0; k < TRAIT_COUNT; k++) {
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

/* ----------------------------------------------------------------- k-means */

/** Deterministic k-means++ with restarts. Returns the best assignment by inertia. */
function kmeans(
  rows: readonly (readonly number[])[],
  k: number,
  opts: { restarts?: number; iterations?: number; seed?: number } = {},
): number[] {
  const restarts = opts.restarts ?? 6;
  const iterations = opts.iterations ?? 80;
  const n = rows.length;
  let best: number[] = new Array(n).fill(0);
  let bestInertia = Infinity;

  for (let attempt = 0; attempt < restarts; attempt++) {
    const rng = new Rng((opts.seed ?? 20260731) + attempt, 'verify:kmeans');

    // k-means++ seeding: first centre uniform, the rest weighted by squared distance.
    const centres: number[][] = [[...rows[rng.int(n)]!]];
    const closest = new Array<number>(n).fill(Infinity);
    while (centres.length < k) {
      const latest = centres[centres.length - 1]!;
      let total = 0;
      for (let i = 0; i < n; i++) {
        let d = 0;
        for (let c = 0; c < TRAIT_COUNT; c++) {
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
          for (let t = 0; t < TRAIT_COUNT; t++) {
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

      const sums = Array.from({ length: k }, () => new Array<number>(TRAIT_COUNT).fill(0));
      const counts = new Array<number>(k).fill(0);
      for (let i = 0; i < n; i++) {
        const c = assign[i]!;
        counts[c]!++;
        for (let t = 0; t < TRAIT_COUNT; t++) sums[c]![t]! += rows[i]![t]!;
      }
      for (let c = 0; c < k; c++) {
        if (counts[c]! === 0) continue; // Empty cluster: leave the centre where it is.
        for (let t = 0; t < TRAIT_COUNT; t++) centres[c]![t] = sums[c]![t]! / counts[c]!;
      }
    }

    if (inertia < bestInertia) {
      bestInertia = inertia;
      best = [...assign];
    }
  }
  return best;
}

/* ------------------------------------------- adjusted mutual information */

/** log Gamma, Lanczos g=7. Tabulated below for the factorials AMI needs. */
function lgammaRaw(x: number): number {
  const C = [
    0.99999999999980993, 676.5203681218851, -1259.1392167224028, 771.32342877765313,
    -176.61502916214059, 12.507343278686905, -0.13857109526572012, 9.9843695780195716e-6,
    1.5056327351493116e-7,
  ];
  if (x < 0.5) return Math.log(Math.PI / Math.sin(Math.PI * x)) - lgammaRaw(1 - x);
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
 * The adjustment matters here: plain mutual information rises with the number of
 * clusters regardless of whether the clustering is any good, so an unadjusted score
 * would make eight archetypes look structured no matter what the sampler did.
 */
function adjustedMutualInformation(labelsA: readonly number[], labelsB: readonly number[]): number {
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

  // lgamma(0..n+1) once; the expectation below reaches every factorial in range.
  const lg = new Float64Array(n + 2);
  for (let i = 0; i <= n + 1; i++) lg[i] = lgammaRaw(i + 1);

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
          lg[ai]! +
          lg[bj]! +
          lg[n - ai]! +
          lg[n - bj]! -
          lg[n]! -
          lg[nij]! -
          lg[ai - nij]! -
          lg[bj - nij]! -
          lg[n - ai - bj + nij]!;
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

/* ==================================================================== §5 data */

section('Archetype set (§5)');
{
  check('eight archetypes load', archetypes.list.length === 8, `${archetypes.list.length} loaded`);
  const keys = archetypes.list.map((a) => a.key);
  for (const expected of [
    'average',
    'roleModel',
    'reserved',
    'selfCentered',
    'enthusiasticNewcomer',
    'terseExpert',
    'quietLurker',
    'professionalSupport',
  ]) {
    check(`archetype ${expected} present`, keys.includes(expected));
  }
  check(
    'every archetype pins at least one defining trait',
    archetypes.list.every((a) => a.defining.length > 0),
  );
  check(
    'every mean is six finite z-scores',
    archetypes.list.every(
      (a) => a.mean.length === TRAIT_COUNT && a.mean.every((v) => Number.isFinite(v)),
    ),
  );
  // The sketches are the only record of what the numbers were aiming at.
  check(
    'every archetype carries its §5 sketch',
    archetypes.list.every((a) => a.sketch.length > 0),
  );

  // Spot-check that the authored vectors actually say what their sketch says.
  const by = (k: string) => archetypes.byKey.get(k)!;
  const at = (k: string, t: TraitKey) => by(k).mean[TRAIT_INDEX[t]]!;
  check('roleModel is low N and high elsewhere',
    at('roleModel', 'neuroticism') < -1 &&
      (['openness', 'conscientiousness', 'extraversion', 'agreeableness', 'honesty'] as TraitKey[])
        .every((t) => at('roleModel', t) > 1));
  check('quietLurker is low E and moderate elsewhere',
    at('quietLurker', 'extraversion') < -1 &&
      TRAIT_ORDER.filter((t) => t !== 'extraversion').every((t) => Math.abs(at('quietLurker', t)) < 0.6));
  check('professionalSupport is high C, high A, low N, high H, moderate E',
    at('professionalSupport', 'conscientiousness') > 1 &&
      at('professionalSupport', 'agreeableness') > 1 &&
      at('professionalSupport', 'neuroticism') < -1 &&
      at('professionalSupport', 'honesty') > 1 &&
      Math.abs(at('professionalSupport', 'extraversion')) < 0.6);
  check('selfCentered is high E, low O, low A, low C',
    at('selfCentered', 'extraversion') > 1 &&
      at('selfCentered', 'openness') < -1 &&
      at('selfCentered', 'agreeableness') < -1 &&
      at('selfCentered', 'conscientiousness') < -1);
}

/* ============================================================ §2 determinism */

section('Determinism (§2)');
{
  const cfg = config();
  const a = sampleTraits({ seed: 4242, ...cfg }, archetypes);
  const b = sampleTraits({ seed: 4242, ...cfg }, archetypes);
  check('same seed and configuration produce an identical result',
    JSON.stringify(a) === JSON.stringify(b), JSON.stringify(a.latent.openness));

  // Including the archetype drawn, which is a separate stream from the vector.
  const many = 500;
  let identical = 0;
  for (let s = 0; s < many; s++) {
    const x = sampleTraits({ seed: s, ...cfg }, archetypes);
    const y = sampleTraits({ seed: s, ...cfg }, archetypes);
    if (JSON.stringify(x) === JSON.stringify(y)) identical++;
  }
  check('identical across 500 seeds, archetype included', identical === many, `${identical}/${many}`);

  const drawn = drawMany(2000, cfg);
  const distinct = new Set(drawn.map((r) => vectorOf(r).join(','))).size;
  check('different seeds produce different results', distinct === 2000, `${distinct}/2000 distinct`);

  // The prepared and one-shot forms are the same code path; prove it rather than
  // assert it in prose, because a divergence would be invisible.
  const prepared = prepareTraitSampler(cfg, archetypes);
  check('prepareTraitSampler and sampleTraits agree',
    [0, 1, 7, 99, 12345].every(
      (s) => JSON.stringify(prepared.draw(s)) === JSON.stringify(sampleTraits({ seed: s, ...cfg }, archetypes)),
    ));

  // Named streams: the archetype decision must not shift the latent sequence, or
  // inserting a stage later would silently change every previously generated vector.
  let sameZ = 0;
  const classified = prepareTraitSampler(config({ unclassifiedShare: 0 }), archetypes);
  const background = prepareTraitSampler(config({ unclassifiedShare: 1 }), archetypes);
  for (let s = 0; s < 200; s++) {
    const c = classified.draw(s);
    const u = background.draw(s);
    const mu = archetypes.byKey.get(c.archetype!)!.mean;
    // Recover L@z from each: (latent - mu) / spread.
    const zc = TRAIT_ORDER.map((k, i) => (c.latent[k] - mu[i]!) / DEFAULT_SIGMA);
    const zu = TRAIT_ORDER.map((k) => u.latent[k] / background.unclassifiedSigma);
    if (zc.every((v, i) => Math.abs(v - zu[i]!) < 1e-9)) sameZ++;
  }
  check('the latent stream is independent of the archetype draw', sameZ === 200, `${sameZ}/200`);
}

/* ================================================= §4/§7 sampling correctness */

const N = 20_000;

section(`Correctness of the sampling (§7), ${N.toLocaleString()} draws`);
{
  const target = defaultCovariance();
  const rows = drawMany(N, machineryConfig(target)).map(vectorOf);

  // Marginals. At 20,000 draws the standard error of the mean is 0.0071 and of the
  // variance about 0.010, so these tolerances are roughly four to five of them.
  let worstMean = 0;
  let worstVar = 0;
  for (let i = 0; i < TRAIT_COUNT; i++) {
    const col = rows.map((r) => r[i]!);
    worstMean = Math.max(worstMean, Math.abs(mean(col)));
    worstVar = Math.max(worstVar, Math.abs(variance(col) - 1));
  }
  check('every marginal has mean 0 within 0.03', worstMean < 0.03, `worst ${worstMean.toFixed(4)}`);
  check('every marginal has variance 1 within 0.05', worstVar < 0.05, `worst ${worstVar.toFixed(4)}`);

  const empirical = correlationMatrix(rows);
  const dev = maxDeviation(empirical, target);
  check('the empirical covariance matches the target within 0.03',
    dev.value < 0.03, `worst ${dev.value.toFixed(4)} at ${dev.at}`);

  // Algebra, independent of sampling: the factor must reproduce the matrix exactly.
  const rebuilt = productWithTranspose(cholesky(target));
  const algebraic = maxDeviation(rebuilt, target);
  check('L @ Lt reproduces the target matrix', algebraic.value < 1e-12,
    `worst ${algebraic.value.toExponential(2)}`);

  // The higher-order structure §4.1 says should survive any retuning.
  const r = (a: TraitKey, b: TraitKey) => target[TRAIT_INDEX[a]]![TRAIT_INDEX[b]]!;
  check('stability factor: C and A positive, N negative to both',
    r('conscientiousness', 'agreeableness') > 0 &&
      r('neuroticism', 'conscientiousness') < 0 &&
      r('neuroticism', 'agreeableness') < 0);
  check('engagement factor: O and E positive', r('openness', 'extraversion') > 0);
  check('Honesty-Humility is orthogonal to the Big Five',
    TRAIT_ORDER.filter((t) => t !== 'honesty').every((t) => r('honesty', t) === 0));
  check('all eight §4.1 correlations land in the matrix',
    DEFAULT_CORRELATIONS.every(([a, b, v]) => r(a, b) === v && r(b, a) === v));
}

/* ================================================================ index order */

section('Index order (§3): each matrix cell is bound to its two named traits');
{
  // A symmetric matrix equals its transpose, so transposing the DEFAULT matrix
  // changes nothing and cannot be tested for. The real hazard is a REORDERED
  // matrix: correlations written into the wrong cells. This probes one pair at a
  // time, so a reordering shows up as the correlation appearing between the wrong
  // two NAMED traits, which is the failure that would otherwise never be caught.
  const PROBE = 0.7;
  const PROBE_N = 8_000;
  let wrongPair = 0;
  let leaked = 0;
  let worstOn = 1;
  let worstOff = 0;

  for (let i = 0; i < TRAIT_COUNT; i++) {
    for (let j = i + 1; j < TRAIT_COUNT; j++) {
      const a = TRAIT_ORDER[i]!;
      const b = TRAIT_ORDER[j]!;
      const matrix = buildCorrelationMatrix([[a, b, PROBE]]);
      const rows = drawMany(PROBE_N, machineryConfig(matrix)).map(vectorOf);
      const emp = correlationMatrix(rows);

      const on = emp[i]![j]!;
      if (Math.abs(on - PROBE) > 0.05) wrongPair++;
      worstOn = Math.min(worstOn, on);

      for (let x = 0; x < TRAIT_COUNT; x++) {
        for (let y = x + 1; y < TRAIT_COUNT; y++) {
          if (x === i && y === j) continue;
          const off = Math.abs(emp[x]![y]!);
          worstOff = Math.max(worstOff, off);
          if (off > 0.05) leaked++;
        }
      }
    }
  }
  check('all 15 pairs correlate on exactly the traits they name', wrongPair === 0,
    `weakest on-pair ${worstOn.toFixed(3)} of ${PROBE}`);
  check('no correlation leaks onto any other pair', leaked === 0,
    `strongest off-pair ${worstOff.toFixed(3)}`);
}

/* ========================================================= §4.2 failure behaviour */

section('Failure behaviour (§4.2)');
{
  // Equicorrelation at -0.5 in six dimensions has an eigenvalue of 1 + 5(-0.5).
  const equi: number[][] = Array.from({ length: TRAIT_COUNT }, (_, i) =>
    Array.from({ length: TRAIT_COUNT }, (_, j) => (i === j ? 1 : -0.5)),
  );
  const e1 = threw(() => cholesky(equi));
  check('a non-positive-definite matrix raises', e1 !== null);
  check('the error names the matrix as non-positive-definite',
    /NOT POSITIVE-DEFINITE/i.test(e1?.message ?? ''), (e1?.message ?? '').slice(0, 70));

  // Rank deficiency: openness and conscientiousness identical, but correlating
  // differently with extraversion. The pivot fails at conscientiousness.
  const singular = buildCorrelationMatrix([
    ['openness', 'conscientiousness', 1],
    ['openness', 'extraversion', 0.5],
  ]);
  const e2 = threw(() => cholesky(singular));
  check('a singular matrix raises rather than producing an enormous factor', e2 !== null);
  check('the error names the trait whose pivot failed',
    /conscientiousness/.test(e2?.message ?? ''), (e2?.message ?? '').slice(0, 70));

  // The same failure must reach a caller through the sampling entry points, not
  // only through cholesky directly.
  check('sampleTraits raises on a non-positive-definite matrix',
    threw(() => sampleTraits({ seed: 1, ...config({ covariance: equi }) }, archetypes)) !== null);
  check('prepareTraitSampler raises before a single avatar is drawn',
    threw(() => prepareTraitSampler(config({ covariance: equi }), archetypes)) !== null);

  // Asymmetry is the transposition typo. Cholesky reads the lower triangle only,
  // so without this check the sampler would use half of what its author wrote.
  const asymmetric = defaultCovariance();
  asymmetric[0]![2] = 0.9;
  check('an asymmetric matrix raises', /not symmetric/i.test(threw(() => cholesky(asymmetric))?.message ?? ''));

  const wrongDiagonal = defaultCovariance();
  wrongDiagonal[3]![3] = 1.4;
  check('a non-unit diagonal raises',
    /diagonal must be 1/i.test(threw(() => cholesky(wrongDiagonal))?.message ?? ''));

  check('a matrix of the wrong size raises',
    threw(() => cholesky([[1, 0], [0, 1]])) !== null);

  // NO FALLBACK TO INDEPENDENT SAMPLING. Two guarantees, structural and behavioural.
  // Comments are stripped first: sample.ts explains at length why it has no catch
  // and does not import the repair, and an unstripped scan would trip on the
  // explanation rather than on the code.
  const sampleSource = stripComments(readFileSync(join(ROOT, 'src/generator/traits/sample.ts'), 'utf8'));
  check('sample.ts contains no catch at all', !/\bcatch\b/.test(sampleSource));
  check('sample.ts does not reference the opt-in repair', !/ridgeRepair/.test(sampleSource));

  // Behavioural: if any path fell back to independent draws, a strongly correlated
  // configuration would come out uncorrelated. It does not.
  const strong = buildCorrelationMatrix([['openness', 'extraversion', 0.85]]);
  const strongRows = drawMany(10_000, machineryConfig(strong)).map(vectorOf);
  const observed = correlationMatrix(strongRows)[TRAIT_INDEX.openness]![TRAIT_INDEX.extraversion]!;
  check('a strong correlation survives to the output, so nothing sampled independently',
    Math.abs(observed - 0.85) < 0.02, `observed ${observed.toFixed(4)}`);

  // The repair exists, is opt-in, and reports how much it changed. Equicorrelation
  // at -0.25 is mildly non-positive-definite (its smallest eigenvalue is -0.25) and
  // comes back inside the cap.
  const mild: number[][] = Array.from({ length: TRAIT_COUNT }, (_, i) =>
    Array.from({ length: TRAIT_COUNT }, (_, j) => (i === j ? 1 : -0.25)),
  );
  check('the mild matrix is genuinely non-positive-definite to begin with',
    threw(() => cholesky(mild)) !== null);
  const repaired = ridgeRepair(mild);
  check('ridgeRepair is available as an explicit opt-in and reports its blend',
    repaired.blend > 0 && threw(() => cholesky(repaired.matrix)) === null,
    `blend ${repaired.blend.toFixed(3)}`);
  // The -0.5 matrix needs more than half the identity mixed in. That is not
  // "slightly off", and the cap is what stops it being quietly shipped: blending
  // all the way to the identity IS independent sampling.
  check('ridgeRepair refuses a matrix too broken for its cap, rather than blending to independence',
    threw(() => ridgeRepair(equi)) !== null);
}

section('Parameter validation (§4.3)');
{
  check('sigma below the valid range raises',
    /outside the valid range/.test(threw(() => prepareTraitSampler(config({ sigma: 0.4 }), archetypes))?.message ?? ''));
  check('sigma above the valid range raises',
    threw(() => prepareTraitSampler(config({ sigma: 0.9 }), archetypes)) !== null);
  check('unclassifiedShare outside 0..1 raises',
    threw(() => prepareTraitSampler(config({ unclassifiedShare: 1.2 }), archetypes)) !== null);
  check('an unknown archetype key raises rather than silently never being drawn',
    /not in the archetype set/.test(
      threw(() => prepareTraitSampler(config({ archetypeMix: { roleMod3l: 1 } }), archetypes))?.message ?? ''));
  check('a mix with no positive weight raises when avatars must be classified',
    threw(() => prepareTraitSampler(config({ archetypeMix: { average: 0 }, unclassifiedShare: 0.5 }), archetypes)) !== null);
  check('an unclassified background narrower than sigma raises',
    threw(() => prepareTraitSampler(config({ unclassifiedSigma: 0.3 }), archetypes)) !== null);
}

/* ================================================== §4.3/§4.4 population make-up */

section('Population composition (§4.3, §4.4)');
{
  const cfg = config();
  const drawn = drawMany(N, cfg);

  const unclassified = drawn.filter((r) => r.archetype === null).length / N;
  check('the unclassified share matches its setting within 0.01',
    Math.abs(unclassified - DEFAULT_UNCLASSIFIED_SHARE) < 0.01,
    `${unclassified.toFixed(4)} against ${DEFAULT_UNCLASSIFIED_SHARE}`);

  const keys = Object.keys(DEFAULT_ARCHETYPE_MIX);
  const totalWeight = keys.reduce((s, k) => s + DEFAULT_ARCHETYPE_MIX[k]!, 0);
  let worstProportion = 0;
  for (const key of keys) {
    const expected = (DEFAULT_ARCHETYPE_MIX[key]! / totalWeight) * (1 - DEFAULT_UNCLASSIFIED_SHARE);
    const actual = drawn.filter((r) => r.archetype === key).length / N;
    worstProportion = Math.max(worstProportion, Math.abs(actual - expected));
  }
  check('archetype proportions match the configured mix within 0.01',
    worstProportion < 0.01, `worst deviation ${worstProportion.toFixed(4)}`);

  // A non-uniform mix, so the check is about the weights and not about eight equal ones.
  const skewed = drawMany(N, config({ archetypeMix: { professionalSupport: 8, quietLurker: 2 }, unclassifiedShare: 0.5 }));
  const support = skewed.filter((r) => r.archetype === 'professionalSupport').length / N;
  const lurker = skewed.filter((r) => r.archetype === 'quietLurker').length / N;
  check('a skewed mix is honoured (8:2 over half the population)',
    Math.abs(support - 0.4) < 0.012 && Math.abs(lurker - 0.1) < 0.012,
    `support ${support.toFixed(3)}, lurker ${lurker.toFixed(3)}`);

  // §3 calls the six values z-scores on a population with mean 0 and standard
  // deviation 1. That is a claim about the REALISED population, and it is what
  // pins UNCLASSIFIED_SIGMA_FACTOR, so it is checked rather than assumed.
  //
  // The tolerances are wide on purpose, and the reason is worth stating. The
  // population mean depends on `archetypeMix`, which is a per-request input: the
  // shipped archetype set is net positive on agreeableness and honesty and net
  // negative on neuroticism, so an equal-weight mix sits slightly off centre and a
  // different mix would sit somewhere else. Recentring the means to zero the
  // default mix would only be correct for that one mix, and choosing mixes is a
  // population-layer question §8 puts out of scope. What is asserted here is
  // therefore the SCALE, which would catch a real error, and not the centring,
  // which is a legitimate property of whoever composes the room.
  const rows = drawn.map(vectorOf);
  let worstOffset = 0;
  let widest = 0;
  let narrowest = Infinity;
  for (let i = 0; i < TRAIT_COUNT; i++) {
    const col = rows.map((r) => r[i]!);
    worstOffset = Math.max(worstOffset, Math.abs(mean(col)));
    const sd = Math.sqrt(variance(col));
    widest = Math.max(widest, sd);
    narrowest = Math.min(narrowest, sd);
  }
  measure('realised population spread', `sd ${narrowest.toFixed(3)} to ${widest.toFixed(3)}, worst mean offset ${worstOffset.toFixed(3)}`);
  check('the realised population is on the z-score scale §3 declares',
    narrowest > 0.8 && widest < 1.25, `sd ${narrowest.toFixed(3)} to ${widest.toFixed(3)}`);
  check('the population is near enough centred for the default mix',
    worstOffset < 0.35, `worst ${worstOffset.toFixed(3)}`);

  // §4.3: separation is validated, never applied.
  const pairs = separations(archetypes);
  const closest = pairs[0]!;
  measure('closest archetype pair', `${closest.a} / ${closest.b} at ${closest.distance.toFixed(3)}`);
  check(`every pair is at least ${DEFAULT_ARCHETYPE_SEPARATION} apart on its defining traits`,
    threw(() => assertSeparation(archetypes, DEFAULT_ARCHETYPE_SEPARATION)) === null,
    `minimum ${closest.distance.toFixed(3)}`);
  measure('headroom above the required separation',
    `${pairs.filter((p) => p.distance >= ARCHETYPE_SEPARATION_MAX).length} of ${pairs.length} pairs also clear ` +
      `${ARCHETYPE_SEPARATION_MAX}, the top of the valid range`);

  // The check must SAY SO when two archetypes sit on top of each other (§4.3).
  const collapsed = parseArchetypes(
    {
      archetypes: [
        { key: 'a', label: 'A', sketch: 'test', defining: ['extraversion'], mean: Object.fromEntries(TRAIT_ORDER.map((t) => [t, 0])) },
        { key: 'b', label: 'B', sketch: 'test', defining: ['extraversion'], mean: Object.fromEntries(TRAIT_ORDER.map((t) => [t, 0])) },
      ],
    },
    'collapsed-fixture',
  );
  const collapseError = threw(() => assertSeparation(collapsed, DEFAULT_ARCHETYPE_SEPARATION));
  check('two archetypes on top of each other are reported by name',
    collapseError !== null && /a \/ b/.test(collapseError.message),
    (collapseError?.message ?? '').slice(0, 60));
  check('a positional mean array is rejected',
    threw(() => parseArchetypes({ archetypes: [{ key: 'a', label: 'A', sketch: 's', defining: ['extraversion'], mean: [0, 0, 0, 0, 0, 0] }] }, 'fixture')) !== null);
  check('an archetype with no defining trait is rejected',
    threw(() => parseArchetypes({ archetypes: [{ key: 'a', label: 'A', sketch: 's', defining: [], mean: Object.fromEntries(TRAIT_ORDER.map((t) => [t, 0])) }] }, 'fixture')) !== null);
  check('the loader enforces separation on startup',
    threw(() => loadArchetypes({ separation: 99 })) !== null);
}

/* ======================================================== §7 the anti-mush pair */

section('The anti-mush property (§7): relative spread of pairwise distances');
{
  // A relative comparison, not an absolute threshold, because the absolute value
  // depends on the archetype set. Both samples are the same size and dimension and
  // come through the SAME code path; only the configuration differs, so what is
  // being compared is the structure rather than two implementations.
  const SPREAD_N = 1_400;
  const identity = buildCorrelationMatrix([]);

  const structured = drawMany(SPREAD_N, config()).map(vectorOf);
  const independent = drawMany(SPREAD_N, machineryConfig(identity), 1_000_000).map(vectorOf);

  const cvStructured = pairwiseDistanceCv(structured);
  const cvIndependent = pairwiseDistanceCv(independent);
  const ratio = cvStructured / cvIndependent;

  measure('pairwise-distance CV, this sampler', cvStructured.toFixed(4));
  measure('pairwise-distance CV, independent baseline', cvIndependent.toFixed(4));
  measure('ratio', `${ratio.toFixed(3)}x`);
  console.log(
    '         Like the AMI bounds below, 1.15 is a STARTING bound rather than an\n' +
      '         established one: §7 uses a relative comparison precisely because the\n' +
      '         absolute value depends on the archetype set. Measured across four\n' +
      '         disjoint seed ranges at n=1000/1400/2000 the ratio sits at 1.16 to\n' +
      '         1.20, so the margin here is real but not large. Retuning the archetype\n' +
      '         set moves it, and this line is what to read afterwards.',
  );

  check('the sampler spreads pairwise distances meaningfully more than independent draws',
    ratio > 1.15, `${ratio.toFixed(3)}x, needs > 1.15x`);

  // Where the spread comes from, which is worth knowing before anyone retunes.
  // Correlation alone contributes almost nothing: it fixes the second failure in
  // briefing §1 (combinations that do not occur in people), not the first. The
  // archetype means are what break the equidistance.
  const correlatedOnly = drawMany(SPREAD_N, machineryConfig(defaultCovariance()), 2_000_000).map(vectorOf);
  measure('the same sampler with archetypes switched off',
    `${(pairwiseDistanceCv(correlatedOnly) / cvIndependent).toFixed(3)}x, so the archetype means carry the spread`);
}

section('The anti-mush property (§7): structure exists but is not clean');
{
  // Cluster the CLASSIFIED draws with k set to the archetype count and compare
  // against their true archetype labels. The unclassified background is excluded
  // because it has no true label to compare against: it is the absence of an
  // archetype, not a ninth one, and folding it in would measure how well k-means
  // finds a cloud that was drawn to have no structure.
  const keyIndex = new Map(archetypes.list.map((a, i) => [a.key, i]));

  /** Cluster the classified draws at one sigma and score against the true labels. */
  function amiAtSigma(sigma: number, want: number): { ami: number; n: number; truth: number[]; clusters: number[] } {
    const sampler = prepareTraitSampler(config({ sigma }), archetypes);
    const rows: number[][] = [];
    const truth: number[] = [];
    for (let seed = 0; rows.length < want; seed++) {
      const r = sampler.draw(seed);
      if (r.archetype === null) continue;
      rows.push(vectorOf(r));
      truth.push(keyIndex.get(r.archetype)!);
    }
    const clusters = kmeans(rows, archetypes.list.length);
    return { ami: adjustedMutualInformation(truth, clusters), n: rows.length, truth, clusters };
  }

  const at = amiAtSigma(DEFAULT_SIGMA, 6_000);
  const { ami, truth, clusters } = at;

  measure(`adjusted mutual information over ${at.n.toLocaleString()} classified draws`, ami.toFixed(4));
  console.log(
    '         Briefing §7: "These two bounds are starting points, not established\n' +
      '         values." Reported on every run so they can be calibrated.',
  );

  check('structure is present (AMI above the 0.2 starting bound)', ami > 0.2, ami.toFixed(4));
  check('archetypes are not caricatures (AMI below the 0.9 starting bound)', ami < 0.9, ami.toFixed(4));

  // A sanity anchor for the measure itself: a shuffled labelling must score ~0,
  // otherwise a high AMI above would prove nothing.
  const shuffleRng = new Rng(7, 'verify:shuffle');
  const shuffled = [...truth];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = shuffleRng.int(i + 1);
    [shuffled[i], shuffled[j]] = [shuffled[j]!, shuffled[i]!];
  }
  const nullAmi = adjustedMutualInformation(shuffled, clusters);
  check('a shuffled labelling scores about zero, so the measure is calibrated',
    Math.abs(nullAmi) < 0.01, nullAmi.toFixed(5));

  // Calibration data for the two bounds, since sigma is the knob that moves them:
  // narrower turns archetypes into caricatures, wider dissolves them (§4.3). This
  // is the shape of that trade-off across the whole valid range, reported only.
  const low = amiAtSigma(SIGMA_MIN, 4_000).ami;
  const high = amiAtSigma(SIGMA_MAX, 4_000).ami;
  measure(`the same measure at sigma ${SIGMA_MIN}`, low.toFixed(4));
  measure(`the same measure at sigma ${SIGMA_MAX}`, high.toFixed(4));
  if (low >= 0.9) {
    console.log(
      `         NOTE, and it is a finding rather than a failure: at sigma ${SIGMA_MIN}, the\n` +
        `         bottom of the range §4.3 calls valid, the measure is ${low.toFixed(3)} and so\n` +
        `         crosses the 0.9 starting bound. The archetypes become caricatures there.\n` +
        `         The default of ${DEFAULT_SIGMA} sits well inside the band; the low end of the\n` +
        `         valid range does not, on these starting bounds and this archetype set.`,
    );
  }
}

/* --------------------------------------------------------------------- done */

console.log(`\nScanned the sampler across ${N.toLocaleString()}-draw populations.`);
if (failures > 0) {
  console.error(`\n${failures} CHECK(S) FAILED`);
  process.exit(1);
}
console.log('ALL PASSED');
