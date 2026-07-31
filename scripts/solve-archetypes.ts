/**
 * Joint placement of the archetype means.
 *
 *   npx tsx scripts/solve-archetypes.ts
 *
 * PRINTS A PROPOSAL. Writes nothing. The output has to be read by a person, because
 * the last step is not arithmetic: every solved position must still describe a
 * recognisable human being, and a position that does not is a FINDING rather than a
 * number to accept.
 *
 * ── WHY A JOINT SOLVE AND NOT ANOTHER ARCHETYPE ─────────────────────────────
 *
 * Sequential patching cannot converge here, and that is demonstrated rather than
 * assumed: filling the agreeableness/honesty quadrants took that pair from 0.935 to
 * 0.173 and pushed the collinearity straight onto conscientiousness/honesty (0.671) and
 * neuroticism/honesty (-0.614). The fifteen correlations across ten points are coupled;
 * every fix redistributes the others.
 *
 * So they are satisfied together. Ten points in six dimensions is sixty parameters
 * against fifteen targets, which is comfortably under-determined: this is a solvable
 * design problem, not a compromise between competing goods.
 *
 * ── WHAT IS BEING TARGETED, AND WHAT IS NOT ─────────────────────────────────
 *
 * The target is THE MODEL'S OWN SPECIFIED CORRELATION MATRIX, which is a stated property
 * of the design. It is NOT the diagnostic in `verify:traits`. Iterating until a
 * diagnostic reads well is how the halo arrived in the first place, and the difference
 * matters: the model says neuroticism/honesty and openness/honesty are ZERO, so an
 * archetype set that correlates them at -0.614 and 0.463 encodes the proposition that
 * anxious or disorganised people are less honest. Nothing supports that, the model
 * explicitly denies it, and anything downstream that leans on the sixth dimension would
 * inherit it as structure.
 *
 * ── WHAT IS PINNED ──────────────────────────────────────────────────────────
 *
 * Three archetypes carry product meaning in their positions and do not move:
 * `professionalSupport` is the support-avatar archetype, `quietLurker` populates rooms,
 * `average` anchors the centre. The other seven were authored to sketch a personality
 * space and may be repositioned as long as they remain describable.
 *
 * ── DETERMINISM ─────────────────────────────────────────────────────────────
 *
 * Multi-start descent seeded from the generator's own `Rng`. Same input, same proposal,
 * every run. No clock, no `Math.random`.
 */

import {
  DEFAULT_ARCHETYPE_SEPARATION,
  TRAIT_COUNT,
  TRAIT_ORDER,
  defaultCovariance,
  loadArchetypes,
  separations,
  type Archetype,
  type ArchetypeSet,
  type TraitKey,
} from '../src/generator/traits/index.js';
import { Rng } from '../src/generator/rng.js';
import {
  DEFAULT_ARCHETYPE_MIX,
  DEFAULT_SIGMA,
  DEFAULT_UNCLASSIFIED_SHARE,
  populationMoments,
} from '../src/generator/traits/index.js';

/** Positions that carry product meaning. These do not move. */
const PINNED = new Set(['average', 'quietLurker', 'professionalSupport']);

/** Aim slightly above the floor so the proposal is not delivered sitting on it. */
const SEPARATION_TARGET = DEFAULT_ARCHETYPE_SEPARATION + 0.07;

// Loaded WITHOUT the separation assertion: satisfying it is this solver's job, so it
// must be able to start from a configuration that violates it. Section 5 reports where
// the proposal actually lands.
const base = loadArchetypes({ separation: null });
const TARGET = defaultCovariance();
const ORIGINAL = base.list.map((a) => [...a.mean]);
const FREE = base.list.map((a) => !PINNED.has(a.key));

/**
 * How hard a free archetype is held near where it started.
 *
 * This is the semantic-coherence proxy, and it is a proxy: a vector that has barely
 * moved is still describable by its old label, and one that has moved a long way needs
 * re-reading and possibly re-naming. Too high and the halo survives; too low and the
 * set stops meaning anything. Reported per archetype so the trade is visible rather
 * than buried in a constant.
 */
const DRIFT_WEIGHT = 0.06;
const SEPARATION_WEIGHT = 40;

/**
 * The z-score claim has TWO halves and the solve now carries both.
 *
 * The specification says population mean 0 and standard deviation 1. Only the sd half was
 * ever constrained, and it was constrained indirectly, by choosing the background spread
 * factor rather than by the solve. The mean half was never checked at all, and when it
 * was measured it came out at +0.213 on honesty, positive on five traits of six.
 *
 * The argument is the one already accepted for the sd, applied to the other moment: a
 * realised mean of 0.213 does not make the population worse, it makes the STATED
 * REPRESENTATION FALSE. A latent honesty of zero is then not population-average honesty,
 * it is a fifth of a standard deviation below it, and every threshold, percentile and
 * downstream reading inherits the offset.
 *
 * ── WHAT THIS COMMITS TO, STATED SO IT IS A CHOICE AND NOT A SURPRISE ───────
 *
 * A weighted mean of zero on honesty means that for every honest archetype there is
 * dishonest weight to balance it. If that is not wanted, the honest answer is to stop
 * claiming z-scores rather than to leave the claim standing while it is false.
 *
 * ── AND IT IS A PROPERTY OF (SET x MIX), NOT OF THE SET ALONE ──────────────
 *
 * The population mean is the weighted archetype mean diluted by the background at the
 * origin, so the constraint is on the WEIGHTED means. It is solved against the DEFAULT
 * equal mix; a different `archetypeMix` reintroduces an offset, exactly as it does for
 * the sd. Both constraints are properties of a named set under a named mix.
 */
const MEAN_WEIGHT = 12;
const SD_WEIGHT = 4;

/** The configuration both moments are constrained against. */
const MOMENT_CONFIG = {
  archetypeMix: DEFAULT_ARCHETYPE_MIX,
  unclassifiedShare: DEFAULT_UNCLASSIFIED_SHARE,
  sigma: DEFAULT_SIGMA,
  covariance: TARGET as number[][],
};

type Config = number[][];

function betweenCorr(cfg: Config, i: number, j: number): number {
  const n = cfg.length;
  let mx = 0;
  let my = 0;
  for (let k = 0; k < n; k++) {
    mx += cfg[k]![i]!;
    my += cfg[k]![j]!;
  }
  mx /= n;
  my /= n;
  let sxy = 0;
  let sxx = 0;
  let syy = 0;
  for (let k = 0; k < n; k++) {
    const dx = cfg[k]![i]! - mx;
    const dy = cfg[k]![j]! - my;
    sxy += dx * dy;
    sxx += dx * dx;
    syy += dy * dy;
  }
  const denom = Math.sqrt(sxx * syy);
  return denom < 1e-12 ? 0 : sxy / denom;
}

/** Restricted distance, matching `assertSeparation`: union of defining traits. */
function restrictedDistance(cfg: Config, a: number, b: number): number {
  const traits = new Set<TraitKey>([...base.list[a]!.defining, ...base.list[b]!.defining]);
  let sum = 0;
  for (const t of traits) {
    const k = TRAIT_ORDER.indexOf(t);
    const d = cfg[a]![k]! - cfg[b]![k]!;
    sum += d * d;
  }
  return Math.sqrt(sum);
}

interface Score {
  total: number;
  corrError: number;
  meanError: number;
  worstMean: number;
  sdError: number;
  worstPair: string;
  worstError: number;
  separationPenalty: number;
  minSeparation: number;
  drift: number;
}

function score(cfg: Config): Score {
  let corrError = 0;
  let worstError = 0;
  let worstPair = '';
  for (let i = 0; i < TRAIT_COUNT; i++) {
    for (let j = i + 1; j < TRAIT_COUNT; j++) {
      const e = betweenCorr(cfg, i, j) - TARGET[i]![j]!;
      corrError += e * e;
      if (Math.abs(e) > worstError) {
        worstError = Math.abs(e);
        worstPair = `${TRAIT_ORDER[i]} / ${TRAIT_ORDER[j]}`;
      }
    }
  }

  let separationPenalty = 0;
  let minSeparation = Infinity;
  for (let a = 0; a < cfg.length; a++) {
    for (let b = a + 1; b < cfg.length; b++) {
      const d = restrictedDistance(cfg, a, b);
      minSeparation = Math.min(minSeparation, d);
      const short = SEPARATION_TARGET - d;
      if (short > 0) separationPenalty += short * short;
    }
  }

  let drift = 0;
  for (let a = 0; a < cfg.length; a++) {
    if (!FREE[a]) continue;
    for (let k = 0; k < TRAIT_COUNT; k++) {
      const d = cfg[a]![k]! - ORIGINAL[a]![k]!;
      drift += d * d;
    }
  }

  // Both moments of the z-score claim, under the default mix.
  const trial = base.list.map((arch, a) => ({ ...arch, mean: cfg[a]! }));
  const moments = populationMoments(
    { list: trial, byKey: new Map(trial.map((t) => [t.key, t])), source: 'solve', version: base.version },
    MOMENT_CONFIG,
  );
  let meanError = 0;
  let worstMean = 0;
  for (let i = 0; i < TRAIT_COUNT; i++) {
    meanError += moments.mean[i]! * moments.mean[i]!;
    worstMean = Math.max(worstMean, Math.abs(moments.mean[i]!));
  }
  let sdError = 0;
  for (let i = 0; i < TRAIT_COUNT; i++) {
    const sd = Math.sqrt(moments.covariance[i]![i]!);
    sdError += (sd - 1) * (sd - 1);
  }

  return {
    total:
      corrError +
      SEPARATION_WEIGHT * separationPenalty +
      DRIFT_WEIGHT * drift +
      MEAN_WEIGHT * meanError +
      SD_WEIGHT * sdError,
    corrError,
    meanError,
    worstMean,
    sdError,
    worstPair,
    worstError,
    separationPenalty,
    minSeparation,
    drift,
  };
}

/** Numerical-gradient descent with a backtracking step. Deterministic. */
function descend(start: Config, steps: number): Config {
  const cfg = start.map((r) => [...r]);
  let step = 0.05;
  const EPS = 1e-5;

  for (let it = 0; it < steps; it++) {
    const here = score(cfg).total;
    const grad: number[][] = cfg.map(() => new Array<number>(TRAIT_COUNT).fill(0));
    for (let a = 0; a < cfg.length; a++) {
      if (!FREE[a]) continue;
      for (let k = 0; k < TRAIT_COUNT; k++) {
        const saved = cfg[a]![k]!;
        cfg[a]![k] = saved + EPS;
        const up = score(cfg).total;
        cfg[a]![k] = saved - EPS;
        const down = score(cfg).total;
        cfg[a]![k] = saved;
        grad[a]![k] = (up - down) / (2 * EPS);
      }
    }

    // Backtrack until the step actually improves, then keep it.
    let taken = false;
    for (let attempt = 0; attempt < 12 && !taken; attempt++) {
      const trial = cfg.map((r) => [...r]);
      for (let a = 0; a < cfg.length; a++) {
        if (!FREE[a]) continue;
        for (let k = 0; k < TRAIT_COUNT; k++) trial[a]![k]! -= step * grad[a]![k]!;
      }
      if (score(trial).total < here) {
        for (let a = 0; a < cfg.length; a++) cfg[a] = trial[a]!;
        taken = true;
        step *= 1.15;
      } else {
        step *= 0.5;
      }
    }
    if (!taken) break;
    if (step < 1e-7) break;
  }
  return cfg;
}

/* ==================================================================== solve */

console.log('Joint placement of the archetype means');
console.log('='.repeat(78));
console.log(`
Target: the model's OWN specified correlation matrix, not the verify:traits diagnostic.
Pinned (carry product meaning): ${[...PINNED].join(', ')}.
Free: ${base.list.filter((a) => !PINNED.has(a.key)).length} of ${base.list.length}.
Separation floor ${DEFAULT_ARCHETYPE_SEPARATION}, aiming for ${SEPARATION_TARGET.toFixed(2)}.
`);

const before = score(ORIGINAL);
console.log(`Before: correlation error ${before.corrError.toFixed(4)}, worst pair ` +
  `${before.worstPair} off by ${before.worstError.toFixed(3)}, min separation ${before.minSeparation.toFixed(3)}.`);
console.log(`        worst population mean ${before.worstMean.toFixed(4)}, sd error ${before.sdError.toFixed(4)}.`);

let best: Config = ORIGINAL.map((r) => [...r]);
let bestScore = before.total;
for (let restart = 0; restart < 8; restart++) {
  const rng = new Rng(20260731 + restart, 'solve:archetypes');
  const start = ORIGINAL.map((row, a) =>
    row.map((v) => (FREE[a] && restart > 0 ? v + (rng.float() - 0.5) * 0.8 : v)),
  );
  const solved = descend(start, 400);
  const s = score(solved);
  if (s.total < bestScore) {
    bestScore = s.total;
    best = solved;
  }
}

const after = score(best);
console.log(`After:  correlation error ${after.corrError.toFixed(4)}, worst pair ` +
  `${after.worstPair} off by ${after.worstError.toFixed(3)}, min separation ${after.minSeparation.toFixed(3)}.`);
console.log(`        worst population mean ${after.worstMean.toFixed(4)}, sd error ${after.sdError.toFixed(4)}.`);

/* --------------------------------------------------------- what it produced */

console.log('\n1. THE FIFTEEN CORRELATIONS, against the model');
console.log('-'.repeat(78));
console.log('  pair                                   model    before     after');
for (let i = 0; i < TRAIT_COUNT; i++) {
  for (let j = i + 1; j < TRAIT_COUNT; j++) {
    const b = betweenCorr(ORIGINAL, i, j);
    const a = betweenCorr(best, i, j);
    const flag = Math.abs(a - TARGET[i]![j]!) > 0.3 ? '  <-- still far' : '';
    console.log(
      `  ${`${TRAIT_ORDER[i]} / ${TRAIT_ORDER[j]}`.padEnd(38)}` +
        `${TARGET[i]![j]!.toFixed(2).padStart(6)}${b.toFixed(3).padStart(10)}${a.toFixed(3).padStart(10)}${flag}`,
    );
  }
}

console.log('\n2. HOW FAR EACH FREE ARCHETYPE MOVED');
console.log('-'.repeat(78));
for (let a = 0; a < best.length; a++) {
  const arch = base.list[a]!;
  if (!FREE[a]) {
    console.log(`  ${arch.key.padEnd(24)}PINNED`);
    continue;
  }
  let d = 0;
  for (let k = 0; k < TRAIT_COUNT; k++) d += (best[a]![k]! - ORIGINAL[a]![k]!) ** 2;
  const moved = Math.sqrt(d);
  const biggest = TRAIT_ORDER.map((t, k) => ({ t, d: best[a]![k]! - ORIGINAL[a]![k]! }))
    .sort((x, y) => Math.abs(y.d) - Math.abs(x.d))[0]!;
  console.log(
    `  ${arch.key.padEnd(24)}moved ${moved.toFixed(3)}   largest shift: ${biggest.t} ${biggest.d >= 0 ? '+' : ''}${biggest.d.toFixed(2)}`,
  );
}

console.log('\n3. THE PROPOSED VECTORS, to be read as descriptions of people');
console.log('-'.repeat(78));
console.log(`  ${'archetype'.padEnd(24)}${TRAIT_ORDER.map((t) => t.slice(0, 5).padStart(8)).join('')}`);
for (let a = 0; a < best.length; a++) {
  console.log(
    `  ${base.list[a]!.key.padEnd(24)}${best[a]!.map((v) => v.toFixed(2).padStart(8)).join('')}`,
  );
}

console.log('\n4. DOES ANYTHING OCCUPY THE MISSING QUADRANTS?');
console.log('-'.repeat(78));
const nIdx = TRAIT_ORDER.indexOf('neuroticism');
const hIdx = TRAIT_ORDER.indexOf('honesty');
const cIdx = TRAIT_ORDER.indexOf('conscientiousness');
function occupants(pred: (v: number[]) => boolean): string[] {
  return best.map((v, a) => (pred(v) ? base.list[a]!.key : '')).filter(Boolean);
}
const anxiousScrupulous = occupants((v) => v[nIdx]! > 0.5 && v[hIdx]! > 0.5);
const calmDishonest = occupants((v) => v[nIdx]! < -0.3 && v[cIdx]! > 0.3 && v[hIdx]! < -0.3);
console.log(`  anxious and scrupulous (N > 0.5, H > 0.5):   ${anxiousScrupulous.join(', ') || 'NOBODY'}`);
console.log(`  calm, organised, low honesty:                ${calmDishonest.join(', ') || 'NOBODY'}`);

console.log('\n5. SEPARATION AFTER THE SOLVE');
console.log('-'.repeat(78));
{
  const proposed: Archetype[] = base.list.map((arch, a) => ({ ...arch, mean: best[a]! }));
  const set: ArchetypeSet = {
    list: proposed,
    byKey: new Map(proposed.map((p) => [p.key, p])),
    source: 'solver proposal',
    version: base.version,
  };
  const pairs = separations(set);
  console.log(`  closest: ${pairs[0]!.a} / ${pairs[0]!.b} at ${pairs[0]!.distance.toFixed(3)}`);
  console.log(`  below the ${DEFAULT_ARCHETYPE_SEPARATION} floor: ${pairs.filter((p) => p.distance < DEFAULT_ARCHETYPE_SEPARATION).length} of ${pairs.length}`);
}

console.log('\n6. THE PROPOSAL AS JSON MEANS');
console.log('-'.repeat(78));
for (let a = 0; a < best.length; a++) {
  if (!FREE[a]) continue;
  const obj = Object.fromEntries(TRAIT_ORDER.map((t, k) => [t, Number(best[a]![k]!.toFixed(2))]));
  console.log(`  "${base.list[a]!.key}": ${JSON.stringify(obj)}`);
}

console.log(`
NOTHING IS WRITTEN. Read section 3 as descriptions before accepting any of it. A solved
position that cannot be described as a plausible person means the target correlation
matrix and the personality space disagree, and that is the finding, not a number to
round off.`);
