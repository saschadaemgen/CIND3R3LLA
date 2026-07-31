/**
 * The trait sampler calibration pass.
 *
 *   npx tsx scripts/calibrate-traits.ts
 *
 * This is NOT a gate. It measures the surface the quality bounds should be written
 * from, and prints it. Nothing here passes or fails.
 *
 * ── WHY IT EXISTS ───────────────────────────────────────────────────────────
 *
 * Two thresholds were set by reasoning and both turned out to be measuring something
 * other than what they named. The 0.9 adjusted-mutual-information bound was scored over
 * the CLASSIFIED SUBSET ONLY, which measures how separable eight archetypes are from
 * one another, not whether the generated population is realistic. And the 1.15
 * pairwise-spread bound had no specified origin at all: the briefing asked for a
 * relative comparison and left "meaningfully higher" to judgement.
 *
 * The deeper problem is that the four dials are NOT INDEPENDENT. Adjusted mutual
 * information here is very close to a readout of separation-over-noise and almost
 * nothing else: a synthetic control with isotropic noise scores HIGHER than the real
 * sampler, eight random centroids at the same mean distance land within 0.04, and
 * scaling the whole configuration sweeps the measure from 0.54 to 0.93. So a bound
 * fixed on one dial while the others sit at their defaults breaks the moment anyone
 * moves a different dial. This pass therefore measures a SURFACE in
 * (sigma, separation), not two independent ranges.
 *
 * ── THE MEASURE CHANGED ─────────────────────────────────────────────────────
 *
 * Adjusted mutual information is now scored over the FULL population with the
 * unclassified carried in under their own null label ("reading (b)"), at k = the
 * archetype count. That is the measure the operator settled on, and it is the one that
 * can speak to population realism rather than to archetype separability.
 *
 * ── THE CEILING, WHICH IS THE THING TO UNDERSTAND FIRST ─────────────────────
 *
 * Reading (b) CANNOT approach 1. The unclassified fraction has no cluster of its own,
 * by construction, so k-means must shred it across the archetype clusters and those
 * points can never be recovered. The measure therefore has a structural ceiling set by
 * the unclassified share, and this pass measures that ceiling empirically by pushing
 * the archetypes far enough apart that their own recovery is essentially perfect. Any
 * upper bound has to be read against that ceiling rather than against 1.0.
 */

import {
  DEFAULT_ARCHETYPE_MIX,
  DEFAULT_SIGMA,
  DEFAULT_UNCLASSIFIED_SHARE,
  SIGMA_MAX,
  SIGMA_MIN,
  TRAIT_COUNT,
  TRAIT_ORDER,
  buildCorrelationMatrix,
  defaultCovariance,
  loadArchetypes,
  prepareTraitSampler,
  separations,
  type Archetype,
  type ArchetypeSet,
  type TraitConfig,
} from '../src/generator/traits/index.js';
import {
  adjustedMutualInformation,
  analyticIndependentPairwiseCv,
  kmeans,
  mean,
  pairwiseDistanceCv,
  variance,
} from './trait-metrics.js';

/** One n for every AMI figure in this pass, so nothing confounds sigma with n. */
const AMI_N = 4_000;
/** Points for the pairwise-distance measurements. Pairwise cost is quadratic. */
const CV_N = 2_000;
/**
 * The SAME clustering settings `verify-traits.ts` uses. Deliberately not tuned down for
 * speed: a surface measured with one clustering budget and a gate enforced with another
 * would disagree, and the disagreement would look like drift in the sampler.
 */
const KMEANS = { restarts: 6, iterations: 80 };

const SIGMAS = [0.5, 0.55, 0.6, 0.65, 0.7];
const SEPARATIONS = [1.5, 1.75, 2.0, 2.25, 2.5];

const base = loadArchetypes();
const BASELINE_CV = analyticIndependentPairwiseCv(TRAIT_COUNT);
const keyIndex = new Map(base.list.map((a, i) => [a.key, i]));
/** The label reading (b) gives the unclassified background. */
const NULL_LABEL = base.list.length;

function minSeparation(set: ArchetypeSet): number {
  return separations(set)[0]!.distance;
}

/**
 * Scale every archetype mean by a factor, so the whole configuration moves together.
 *
 * Scaling rather than re-authoring: it changes separation while holding the SHAPE of
 * the archetype set fixed, which is what isolates the separation axis. It does move the
 * population variance too, and that coupling is reported rather than hidden.
 */
function scaledSet(factor: number): ArchetypeSet {
  const list: Archetype[] = base.list.map((a) => ({ ...a, mean: a.mean.map((v) => v * factor) }));
  return {
    list,
    byKey: new Map(list.map((a) => [a.key, a])),
    source: `${base.source} scaled x${factor.toFixed(4)}`,
    version: base.version,
  };
}

/** Scale so the closest defining-trait pair sits exactly at `target`. */
function setWithSeparation(target: number): ArchetypeSet {
  return scaledSet(target / minSeparation(base));
}

function config(sigma: number): TraitConfig {
  return {
    archetypeMix: DEFAULT_ARCHETYPE_MIX,
    unclassifiedShare: DEFAULT_UNCLASSIFIED_SHARE,
    sigma,
    covariance: defaultCovariance(),
  };
}

interface Population {
  rows: number[][];
  labels: number[];
  classified: number[][];
}

function draw(set: ArchetypeSet, sigma: number, n: number, seedFrom = 0): Population {
  const sampler = prepareTraitSampler(config(sigma), set);
  const rows: number[][] = [];
  const labels: number[] = [];
  const classified: number[][] = [];
  for (let i = 0; i < n; i++) {
    const r = sampler.draw(seedFrom + i);
    const v = TRAIT_ORDER.map((k) => r.latent[k]);
    rows.push(v);
    if (r.archetype === null) {
      labels.push(NULL_LABEL);
    } else {
      labels.push(keyIndex.get(r.archetype)!);
      classified.push(v);
    }
  }
  return { rows, labels, classified };
}

/** Reading (b): full population, unclassified under its own null label, k = archetypes. */
function amiReadingB(pop: Population, k: number): number {
  const clusters = kmeans(pop.rows, k, TRAIT_COUNT, KMEANS);
  return adjustedMutualInformation(pop.labels, clusters);
}

function cvRatio(rows: readonly number[][]): number {
  return pairwiseDistanceCv(rows, TRAIT_COUNT) / BASELINE_CV;
}

function fmt(x: number, d = 3): string {
  return x.toFixed(d).padStart(d + 3);
}

/* ============================================================ preliminaries */

console.log('Trait sampler calibration pass');
console.log('='.repeat(78));
console.log(`
Measure changed: adjusted mutual information is scored over the FULL population with
the unclassified carried in under their own null label (reading (b)), k = 8.

Common n: AMI ${AMI_N.toLocaleString()} draws, pairwise spread ${CV_N.toLocaleString()} points.
Independent baseline: ANALYTIC, ${BASELINE_CV.toFixed(5)} = sd(chi_6)/E[chi_6].
Shipped archetype set: minimum defining separation ${minSeparation(base).toFixed(3)}.
Default configuration: sigma ${DEFAULT_SIGMA}, unclassified share ${DEFAULT_UNCLASSIFIED_SHARE}.
`);

/* --------------------------------------------------- the structural ceiling */

console.log('\n1. THE CEILING OF READING (b)');
console.log('-'.repeat(78));
console.log(`
The unclassified ${(DEFAULT_UNCLASSIFIED_SHARE * 100).toFixed(0)}% has no cluster of its own by construction, so k-means must
shred it across the archetype clusters and it can never be recovered. Reading (b)
therefore cannot approach 1. Pushing the archetypes far apart isolates that ceiling:
archetype recovery becomes essentially perfect and what remains unrecovered is the
mass. Any upper bound must be read against this number, not against 1.0.
`);
for (const factor of [1, 2, 4, 8]) {
  const set = scaledSet(factor);
  const pop = draw(set, DEFAULT_SIGMA, AMI_N);
  const ami = amiReadingB(pop, base.list.length);
  console.log(
    `  separation x${String(factor).padStart(2)} (min ${fmt(minSeparation(set))})   AMI(b) ${fmt(ami, 4)}`,
  );
}

/* ------------------------------------------------------- CV swept over sigma */

console.log('\n2. PAIRWISE SPREAD SWEPT OVER SIGMA  (fix 1: this was measured at one sigma only)');
console.log('-'.repeat(78));
console.log('  sigma   full population   classified only   unclassified only');
const cvBySigma = new Map<number, number>();
for (const sigma of SIGMAS) {
  const pop = draw(base, sigma, CV_N);
  const unclassified = pop.rows.filter((_, i) => pop.labels[i] === NULL_LABEL);
  const full = cvRatio(pop.rows);
  cvBySigma.set(sigma, full);
  console.log(
    `  ${sigma.toFixed(2)}    ${fmt(full)}x            ${fmt(cvRatio(pop.classified))}x           ${fmt(cvRatio(unclassified))}x`,
  );
}
console.log(`
  The classified subset carries essentially all the structure; the unclassified
  background sits within a few percent of an independent normal cloud. Note the full
  population is NOT a blend of its subsets: at low sigma it exceeds both, because
  mixing a compact centre with displaced clusters makes the distance distribution
  bimodal and adds spread of its own. It only dilutes as sigma rises.`);

/* --------------------------------------------- AMI swept over separation */

console.log('\n3. AMI(b) SWEPT OVER ARCHETYPE SEPARATION, at the default sigma');
console.log('-'.repeat(78));
console.log('  separation   AMI(b)    population sd (min..max per trait)');
const amiBySeparation = new Map<number, number>();
for (const target of SEPARATIONS) {
  const set = setWithSeparation(target);
  const pop = draw(set, DEFAULT_SIGMA, AMI_N);
  const ami = amiReadingB(pop, base.list.length);
  amiBySeparation.set(target, ami);
  const sds = Array.from({ length: TRAIT_COUNT }, (_, i) =>
    Math.sqrt(variance(pop.rows.map((r) => r[i]!))),
  );
  console.log(
    `  ${target.toFixed(2)}         ${fmt(ami, 4)}    ${fmt(Math.min(...sds))} .. ${fmt(Math.max(...sds))}`,
  );
}
console.log(`
  Separation and the z-score scale move together: widening the archetypes widens the
  population. That coupling is real and is why the two cannot be bounded independently.`);

/* --------------------------------------------------- AMI swept over sigma */

console.log('\n4. AMI(b) SWEPT OVER SIGMA, at the shipped separation');
console.log('-'.repeat(78));
console.log('  sigma   AMI(b)');
const amiBySigma = new Map<number, number>();
for (const sigma of SIGMAS) {
  const pop = draw(base, sigma, AMI_N);
  const ami = amiReadingB(pop, base.list.length);
  amiBySigma.set(sigma, ami);
  console.log(`  ${sigma.toFixed(2)}    ${fmt(ami, 4)}`);
}

/* ------------------------------------------------------------- the surface */

console.log('\n5. THE SURFACE: AMI(b) over (sigma x separation)');
console.log('-'.repeat(78));
console.log(`  ${'sep\\sig'.padEnd(10)}${SIGMAS.map((s) => s.toFixed(2).padStart(8)).join('')}`);
const surface = new Map<string, number>();
for (const target of SEPARATIONS) {
  const set = setWithSeparation(target);
  const cells: string[] = [];
  for (const sigma of SIGMAS) {
    const ami = amiReadingB(draw(set, sigma, AMI_N), base.list.length);
    surface.set(`${target}|${sigma}`, ami);
    cells.push(ami.toFixed(3).padStart(8));
  }
  console.log(`  ${target.toFixed(2).padEnd(10)}${cells.join('')}`);
}

console.log('\n6. THE SURFACE: pairwise spread ratio over (sigma x separation)');
console.log('-'.repeat(78));
console.log(`  ${'sep\\sig'.padEnd(10)}${SIGMAS.map((s) => s.toFixed(2).padStart(8)).join('')}`);
const cvSurface = new Map<string, number>();
for (const target of SEPARATIONS) {
  const set = setWithSeparation(target);
  const cells: string[] = [];
  for (const sigma of SIGMAS) {
    const ratio = cvRatio(draw(set, sigma, CV_N).rows);
    cvSurface.set(`${target}|${sigma}`, ratio);
    cells.push(ratio.toFixed(3).padStart(8));
  }
  console.log(`  ${target.toFixed(2).padEnd(10)}${cells.join('')}`);
}

/* ------------------------------------------------------- z-score coupling */

console.log('\n7. THE z-SCORE PROPERTY ACROSS THE SURFACE');
console.log('-'.repeat(78));
console.log(`
  Briefing §3 calls the six values z-scores on a population with mean 0 and standard
  deviation 1. That is a claim about the realised population and it is a THIRD
  constraint on the same two dials, not a free parameter.
`);
console.log(`  ${'sep\\sig'.padEnd(10)}${SIGMAS.map((s) => s.toFixed(2).padStart(8)).join('')}`);
const sdSurface = new Map<string, number>();
for (const target of SEPARATIONS) {
  const set = setWithSeparation(target);
  const cells: string[] = [];
  for (const sigma of SIGMAS) {
    const pop = draw(set, sigma, CV_N);
    const sds = Array.from({ length: TRAIT_COUNT }, (_, i) =>
      Math.sqrt(variance(pop.rows.map((r) => r[i]!))),
    );
    const meanSd = mean(sds);
    sdSurface.set(`${target}|${sigma}`, meanSd);
    cells.push(meanSd.toFixed(3).padStart(8));
  }
  console.log(`  ${target.toFixed(2).padEnd(10)}${cells.join('')}`);
}

/* ------------------------------------------------------------------ summary */

console.log('\n8. WHAT THE SURFACE SAYS');
console.log('-'.repeat(78));
const defaultAmi = surface.get(`2|0.6`) ?? amiBySigma.get(DEFAULT_SIGMA)!;
const defaultCv = cvSurface.get(`2|0.6`) ?? cvBySigma.get(DEFAULT_SIGMA)!;
const defaultSd = sdSurface.get(`2|0.6`) ?? 1;
console.log(`
  The shipped default (sigma ${DEFAULT_SIGMA}, separation 2.0) measures:
      AMI(b)              ${defaultAmi.toFixed(4)}
      pairwise spread     ${defaultCv.toFixed(3)}x the analytic independent baseline
      mean per-trait sd   ${defaultSd.toFixed(3)}

  No bound is asserted anywhere in this pass. The numbers above are the input to
  setting them, and the three surfaces have to be read together: any pair of bounds
  fixed on two of the dials implies a region in the third, and the z-score constraint
  in section 7 is the one most easily forgotten.
`);
console.log('Nothing here passes or fails. Calibration input only.');
