/**
 * Assemble a population and write the three views plus the review record.
 *
 *   npm run assemble -- --count 200 --seed 42 --out ./review
 *
 * Writes `detail.txt`, `crowd.html`, `distribution.txt` and `review.md`.
 *
 * EXITS NON-ZERO if any component data set reports no version (§7, §9.3). The files are
 * still written, so the gap is on record; the exit code is so nobody walks past it.
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import {
  DEFAULT_ASSEMBLE_CONFIG,
  assemblePopulation,
  componentVersions,
  loadComponents,
  prepareAssembler,
  renderCrowd,
  renderDetail,
  renderDistribution,
  renderReview,
} from '../src/generator/assemble/index.js';

function arg(name: string, fallback: string): string {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] !== undefined ? process.argv[i + 1]! : fallback;
}

const count = Number(arg('count', '200'));
const seed = Number(arg('seed', '42'));
const outDir = resolve(arg('out', './review'));
/** How many go into the detail view. "A handful" (§3.1), not a second crowd view. */
const detailCount = Number(arg('detail', '6'));

if (!Number.isInteger(count) || count <= 0) throw new Error(`--count must be a positive integer, got ${arg('count', '')}`);
if (!Number.isInteger(seed)) throw new Error(`--seed must be an integer, got ${arg('seed', '')}`);

const components = loadComponents();
const assembler = prepareAssembler(components, DEFAULT_ASSEMBLE_CONFIG);
const profiles = assemblePopulation(assembler, count, seed);

// The detail view reads profiles that actually have something to read. An all-empty
// handful would trace nothing, and the empty case is already visible in the crowd view.
const withBios = profiles.filter((p) => p.bio.text !== null);
const detailProfiles = [
  ...withBios.slice(0, Math.max(1, detailCount - 1)),
  ...profiles.filter((p) => p.bio.text === null).slice(0, 1),
].slice(0, detailCount);

const versions = componentVersions(components);
const { markdown, missing } = renderReview({
  seed,
  count,
  readSeeds: detailProfiles.map((p) => p.seed),
  versions,
  configVersion: 'assemble-default',
});

mkdirSync(outDir, { recursive: true });
writeFileSync(join(outDir, 'detail.txt'), renderDetail(detailProfiles), 'utf8');
writeFileSync(join(outDir, 'crowd.html'), renderCrowd(profiles, seed), 'utf8');
writeFileSync(join(outDir, 'distribution.txt'), renderDistribution(profiles, components, seed), 'utf8');
writeFileSync(join(outDir, 'review.md'), markdown, 'utf8');

console.log(`Assembled ${count.toLocaleString()} profiles from seed ${seed}.`);
console.log(`  ${join(outDir, 'detail.txt')}          ${detailProfiles.length} traced`);
console.log(`  ${join(outDir, 'crowd.html')}         the member list; OPEN THIS ONE`);
console.log(`  ${join(outDir, 'distribution.txt')}    statistics, with the caveat at the top`);
console.log(`  ${join(outDir, 'review.md')}           pre-filled except for findings`);
console.log('');
for (const [k, v] of Object.entries(versions)) console.log(`  ${k.padEnd(12)}${v || '(MISSING)'}`);

if (missing.length > 0) {
  console.error(
    `\n${missing.length} component data set(s) reported no version: ${missing.join(', ')}.\n` +
      `review.md was written with the gap marked, because a record of the gap is worth more\n` +
      `than a missing file, but a review that cannot name what it reviewed cannot be\n` +
      `referred to later. Exiting non-zero.`,
  );
  process.exit(1);
}
console.log('\nRead crowd.html before believing distribution.txt.');
