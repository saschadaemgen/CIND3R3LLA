/**
 * The geometric coverage sweep, and the record it writes.
 *
 *   npx tsx scripts/coverage-geometry.ts          report only
 *   npx tsx scripts/coverage-geometry.ts --write  update the recorded findings
 *
 * NOT ON THE PER-COMMIT PATH, and bound to the archetype set version instead.
 *
 * ── WHY IT IS SEPARATE FROM THE STANDING CHECK ──────────────────────────────
 *
 * The two halves do different jobs and neither substitutes for the other:
 *
 *   centre distance, standing        catches a NAMED region degrading or emptying
 *   hull and direction sampling      catches UNNAMED gaps no sign predicate expresses
 *
 * The largest hole in the set was found by the second and no version of the first
 * would have found it, because nothing had named that region. Its output is a set of
 * weighted directions that needs a person to translate back into people, and the hull
 * only moves when the set is re-solved, so running it every commit buys nothing.
 *
 * ── WHY IT IS BOUND TO THE VERSION AND NOT TO SOLVE TIME ────────────────────
 *
 * `data/archetypes.json` is editable without a rebuild, so a set can move without ever
 * going through `solve:archetypes`. Binding to solve time would leave exactly the case
 * this is for: someone edits the file, bumps the version, and the standing check reports
 * every named region healthy while a new unnamed hole has opened. So the record names
 * the set it was computed against, and `verify:traits` fails when the set has moved and
 * this has not been re-run. Same binding as the region taxonomy, same reason.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadArchetypes, TRAIT_COUNT, TRAIT_ORDER } from '../src/generator/traits/index.js';
import { Rng } from '../src/generator/rng.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const RECORD = join(ROOT, 'src/generator/traits/data/coverage-geometry.json');

const set = loadArchetypes();
const means = set.list.map((a) => [...a.mean]);

const DIRECTIONS = 40_000;
const PROBES = 200_000;

/** Unit direction from six standard normals. Deterministic. */
function directions(rng: Rng, count: number): number[][] {
  const out: number[][] = [];
  for (let i = 0; i < count; i++) {
    const v: number[] = [];
    for (let k = 0; k < TRAIT_COUNT; k += 2) {
      let u1 = rng.float();
      while (u1 === 0) u1 = rng.float();
      const r = Math.sqrt(-2 * Math.log(u1));
      const t = 2 * Math.PI * rng.float();
      v.push(r * Math.cos(t));
      if (v.length < TRAIT_COUNT) v.push(r * Math.sin(t));
    }
    const norm = Math.sqrt(v.reduce((s, x) => s + x * x, 0));
    out.push(v.map((x) => x / norm));
  }
  return out;
}

function nearestDistance(point: readonly number[]): { distance: number; key: string } {
  let best = Infinity;
  let key = '';
  for (let a = 0; a < means.length; a++) {
    let d = 0;
    for (let i = 0; i < TRAIT_COUNT; i++) d += (means[a]![i]! - point[i]!) ** 2;
    if (d < best) {
      best = d;
      key = set.list[a]!.key;
    }
  }
  return { distance: Math.sqrt(best), key };
}

function loadings(v: readonly number[]): string {
  return v
    .map((x, i) => ({ t: TRAIT_ORDER[i]!, x }))
    .filter((e) => Math.abs(e.x) > 0.2)
    .sort((a, b) => Math.abs(b.x) - Math.abs(a.x))
    .map((e) => `${e.x >= 0 ? '+' : ''}${e.x.toFixed(2)} ${e.t}`)
    .join('  ');
}

console.log('Geometric coverage sweep');
console.log('='.repeat(78));
console.log(`
Archetype set: ${set.version} (${set.list.length} means)
${DIRECTIONS.toLocaleString()} directions, ${PROBES.toLocaleString()} probe points. Deterministic; no clock, no Math.random.

This finds UNNAMED gaps. The standing check in verify:traits finds named regions
degrading. Neither substitutes for the other.
`);

/* ---------------------------------------------------- how far the set reaches */

const dirs = directions(new Rng(20260731, 'coverage:directions'), DIRECTIONS);
const reaches = dirs.map((d) => {
  let max = -Infinity;
  for (const m of means) {
    let p = 0;
    for (let i = 0; i < TRAIT_COUNT; i++) p += m[i]! * d[i]!;
    max = Math.max(max, p);
  }
  return { d, reach: max };
});
reaches.sort((a, b) => a.reach - b.reach);
const median = reaches[Math.floor(reaches.length / 2)]!.reach;

console.log('\n1. THE DIRECTIONS THE SET REACHES LEAST');
console.log('-'.repeat(78));
console.log(`  median reach across all directions: ${median.toFixed(3)}\n`);
const worstDirections = reaches.slice(0, 5).map((r) => ({
  reach: Number(r.reach.toFixed(4)),
  ratioToMedian: Number((r.reach / median).toFixed(3)),
  loadings: loadings(r.d),
}));
for (const w of worstDirections) {
  console.log(`  reach ${w.reach.toFixed(3)}  (${(w.ratioToMedian * 100).toFixed(0)}% of median)   ${w.loadings}`);
}
// Whether the under-reached directions carry a consistent sign on honesty is the
// finding that mattered last time, so it is computed rather than eyeballed.
const worstFive = reaches.slice(0, Math.floor(DIRECTIONS * 0.05));
const negativeHonesty = worstFive.filter((r) => r.d[TRAIT_ORDER.indexOf('honesty')]! < 0).length;
console.log(
  `\n  of the least-reached 5% of directions, ${((negativeHonesty / worstFive.length) * 100).toFixed(1)}% carry a NEGATIVE honesty loading.`,
);

/* --------------------------------------------------------------- the holes */

console.log('\n2. THE LARGEST HOLES IN A PLAUSIBLE REGION OF THE SPACE');
console.log('-'.repeat(78));
const probeRng = new Rng(20260732, 'coverage:probes');
let worst = { distance: -1, point: [] as number[], key: '' };
for (let i = 0; i < PROBES; i++) {
  const p: number[] = [];
  for (let k = 0; k < TRAIT_COUNT; k += 2) {
    let u1 = probeRng.float();
    while (u1 === 0) u1 = probeRng.float();
    const r = Math.sqrt(-2 * Math.log(u1));
    const t = 2 * Math.PI * probeRng.float();
    p.push(r * Math.cos(t));
    if (p.length < TRAIT_COUNT) p.push(r * Math.sin(t));
  }
  const n = nearestDistance(p);
  if (n.distance > worst.distance) worst = { distance: n.distance, point: p, key: n.key };
}
console.log(`  furthest probe from any archetype: ${worst.distance.toFixed(3)} (nearest ${worst.key})`);
console.log(`    at ${worst.point.map((v, i) => `${TRAIT_ORDER[i]!.slice(0, 4)} ${v.toFixed(2)}`).join(', ')}`);

/* ------------------------------------------------------- the named probes */

console.log('\n3. NAMED PROBE POINTS');
console.log('-'.repeat(78));
const NAMED_PROBES: { key: string; point: number[]; why: string }[] = [
  {
    key: 'ordinary-calm',
    point: [0, 0, 0, 0, -1, 0],
    why: 'the modal person: emotionally stable, unremarkable elsewhere',
  },
  { key: 'ordinary-anxious', point: [0, 0, 0, 0, 1, 0], why: 'its mirror, for comparison' },
  { key: 'ordinary-extravert', point: [0, 0, 1, 0, 0, 0], why: 'a second comparison' },
  { key: 'origin', point: [0, 0, 0, 0, 0, 0], why: 'the exact centre the background owns' },
];
const probeResults = NAMED_PROBES.map((p) => {
  const n = nearestDistance(p.point);
  return { key: p.key, why: p.why, distance: Number(n.distance.toFixed(4)), nearest: n.key };
});
for (const p of probeResults) {
  console.log(`  ${p.key.padEnd(20)}${p.distance.toFixed(3).padStart(7)}  nearest ${p.nearest.padEnd(22)}${p.why}`);
}
console.log(`
  A large distance here is NOT automatically a gap to fill. The unclassified background
  owns the unremarkable middle by design, and inventing an archetype for "ordinary" would
  defeat its purpose. What a large distance means is that FORCED nearest-archetype
  assignment would mislabel these people, which is an argument for abstention (D-098),
  not for authorship. See the background-owned status in coverage-regions.json.`);

/* ------------------------------------------------------------ the record */

const record = {
  _README: [
    'Recorded output of scripts/coverage-geometry.ts.',
    '',
    'BOUND TO THE ARCHETYPE SET VERSION. verify:traits fails when reviewedAgainst does',
    'not match archetypes.json, because a set can be edited without a rebuild and without',
    'ever going through solve:archetypes. Re-run with --write whenever the set version',
    'changes, and READ the output rather than only regenerating it: this finds unnamed',
    'gaps, which by definition nobody has decided about yet.',
  ],
  reviewedAgainst: set.version,
  directions: DIRECTIONS,
  probes: PROBES,
  medianReach: Number(median.toFixed(4)),
  leastReachedDirections: worstDirections,
  negativeHonestyShareOfLeastReached: Number((negativeHonesty / worstFive.length).toFixed(4)),
  largestHole: {
    distance: Number(worst.distance.toFixed(4)),
    nearest: worst.key,
    point: worst.point.map((v) => Number(v.toFixed(3))),
  },
  namedProbes: probeResults,
};

if (process.argv.includes('--write')) {
  writeFileSync(RECORD, `${JSON.stringify(record, null, 2)}\n`, 'utf8');
  console.log(`\nWROTE ${RECORD}`);
} else {
  let previous: { reviewedAgainst?: string } = {};
  try {
    previous = JSON.parse(readFileSync(RECORD, 'utf8')) as { reviewedAgainst?: string };
  } catch {
    previous = {};
  }
  const stale = previous.reviewedAgainst !== set.version;
  console.log(
    `\nRecorded against ${previous.reviewedAgainst ?? '(no record)'}; set is ${set.version}.` +
      (stale ? ' STALE - re-run with --write and read the output.' : ' Up to date.'),
  );
}
