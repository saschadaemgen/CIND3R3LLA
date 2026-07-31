/**
 * Assemble a population and write the three views plus the review record.
 *
 *   npm run assemble -- --count 200 --seed 42 --out ./review
 *   npm run assemble -- --engine model --model qwen2.5:7b-instruct
 *
 * Writes `detail.txt`, `crowd.html`, `distribution.txt` and `review.md`.
 *
 * TWO ENGINES, AND THE POINT IS TO COMPARE THEM BY READING. The template path is the
 * fallback: small, plain, deliberately quiet, and it exists so this works with no model
 * reachable and so load-test populations do not need one. The model path is the quality
 * path. Statistics will not settle which is better, because a read of two hundred
 * profiles found ten defect classes that every statistical check passed.
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
  conditioningVersion,
  loadComponents,
  prepareAssembler,
  renderCrowd,
  renderDetail,
  renderDistribution,
  renderReview,
  runModelPass,
} from '../src/generator/assemble/index.js';
import { DEFAULT_MODEL_BIO_CONFIG, type ModelBioConfig } from '../src/generator/bio/model.js';

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

const engine = arg('engine', 'template');
if (engine !== 'template' && engine !== 'model') {
  throw new Error(`--engine must be "template" or "model", got ${engine}`);
}

const components = loadComponents();
const config = {
  ...DEFAULT_ASSEMBLE_CONFIG,
  bio: { ...DEFAULT_ASSEMBLE_CONFIG.bio, engine },
};
const assembler = prepareAssembler(components, config);
const profiles = assemblePopulation(assembler, count, seed);

if (engine === 'model') {
  const modelConfig: ModelBioConfig = {
    ...DEFAULT_MODEL_BIO_CONFIG,
    baseUrl: arg('model-url', DEFAULT_MODEL_BIO_CONFIG.baseUrl),
    model: arg('model', DEFAULT_MODEL_BIO_CONFIG.model),
    concurrency: Number(arg('concurrency', String(DEFAULT_MODEL_BIO_CONFIG.concurrency))),
    // A population that is about to be READ takes silence over a wrong bio. That is the
    // opposite default from the library's, whose caller may be a load test.
    onFailure: arg('on-failure', 'empty') === 'template' ? 'template' : 'empty',
  };
  process.stdout.write(`Writing bios with ${modelConfig.model} at ${modelConfig.baseUrl}\n`);
  const report = await runModelPass(profiles, {
    config: modelConfig,
    templates: components.templates,
    conditioningVersion: conditioningVersion(components, config),
    cachePath: resolve(arg('cache', '.generator-cache/bios.json')),
    onProgress: (d, t) => {
      if (d % 10 === 0 || d === t) process.stdout.write(`  ${d}/${t}\r`);
    },
  });
  process.stdout.write('\n');
  console.log(
    `  ${report.fromCache} from cache, ${report.generated} generated, ${report.failed} failed ` +
      `(${report.keptTemplateText} kept template text, ${report.emptied} emptied)`,
  );
  for (const [reason, n] of Object.entries(report.failures)) console.log(`    ${n}x ${reason}`);
  if (report.retried > 0) console.log(`  ${report.retried} needed a second attempt`);
  if (report.cacheRejected > 0) {
    console.log(`  ${report.cacheRejected} cached bios were rejected by today's rules and rewritten`);
  }
  if (report.cache.stale > 0) console.log(`  ${report.cache.stale} cache entries this run did not ask for`);
  // A model path that silently wrote nothing is the failure this reports rather than
  // absorbs: the files would still be written and would still look green.
  if (report.attempted > 0 && report.generated === 0 && report.fromCache === 0) {
    console.error('\nEVERY model call failed. The bios below are NOT model output.');
  }
}

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
