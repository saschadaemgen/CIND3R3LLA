/**
 * The model bio path, proven with no model running.
 *
 *   npx tsx scripts/verify-bio-model.ts
 *
 * Proof-of-concept before integration: the transport is injected, so every property below
 * is checked against a fake that returns exactly what a real model might, including the
 * things a real model gets wrong. A harness that needed Ollama running would be skipped
 * on the machine where it matters.
 *
 * WHAT THIS CANNOT CHECK is whether the model writes good German. That question is
 * answered by a person reading crowd.html, and the whole reason the bio moved to a model
 * is that a read found ten defect classes every statistical check had passed.
 */

import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  DEFAULT_ASSEMBLE_CONFIG,
  assemblePopulation,
  conditioningVersion,
  loadComponents,
  prepareAssembler,
  runModelPass,
} from '../src/generator/assemble/index.js';
import {
  DEFAULT_MODEL_BIO_CONFIG,
  modelIdentity,
  validateBio,
  type BioConditioning,
  type FetchLike,
  type ModelBioConfig,
} from '../src/generator/bio/model.js';
import { BioCache } from '../src/generator/bio/cache.js';

let failures = 0;
function check(label: string, ok: boolean, detail = ''): void {
  if (!ok) failures++;
  console.log(`  [${ok ? 'PASS' : 'FAIL'}] ${label}${detail ? ` - ${detail}` : ''}`);
}
function section(t: string): void {
  console.log(`\n${t}`);
}

const components = loadComponents();
const MODEL_CONFIG: ModelBioConfig = { ...DEFAULT_MODEL_BIO_CONFIG, concurrency: 4 };

// THE MODEL ENGINE, not the default. The template path runs at a raised empty rate
// because a wrong bio is worse than none, so assembling with it would leave this harness
// exercising a handful of profiles and calling that coverage.
const CONFIG = {
  ...DEFAULT_ASSEMBLE_CONFIG,
  bio: { ...DEFAULT_ASSEMBLE_CONFIG.bio, engine: 'model' as const },
};
const CONDITIONING = conditioningVersion(components, CONFIG);

/** Every request the fake saw, so the conditioning can be inspected rather than assumed. */
interface Seen {
  system: string;
  user: Record<string, unknown>;
}

function fakeModel(reply: (seen: Seen, n: number) => string | Error): { fetch: FetchLike; seen: Seen[] } {
  const seen: Seen[] = [];
  const fetchImpl: FetchLike = async (_url, init) => {
    const body = JSON.parse(String(init?.body)) as {
      messages: { role: string; content: string }[];
    };
    const entry: Seen = {
      system: body.messages[0]!.content,
      user: JSON.parse(body.messages[1]!.content) as Record<string, unknown>,
    };
    seen.push(entry);
    const out = reply(entry, seen.length - 1);
    if (out instanceof Error) throw out;
    return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ bio: out }) } }] }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  };
  return { fetch: fetchImpl, seen };
}

function population(count = 60): ReturnType<typeof assemblePopulation> {
  return assemblePopulation(prepareAssembler(components, CONFIG), count, 7);
}

/* ============================================ the model is told who the person is */

section('The model is conditioned, and decides nothing (decision §2, §6)');
{
  const profiles = population();
  const { fetch: f, seen } = fakeModel(() => 'ops person, mostly here for the archives');
  const dir = mkdtempSync(join(tmpdir(), 'biomodel-'));
  await runModelPass(profiles, {
    config: MODEL_CONFIG,
    templates: components.templates,
    conditioningVersion: CONDITIONING,
    cachePath: join(dir, 'c.json'),
    fetchImpl: f,
    now: () => '2026-07-31T00:00:00.000Z',
  });

  check('every request carried the personality', seen.length > 0 && seen.every((s) => 'person' in s.user));
  check('and the writing style', seen.every((s) => 'writingStyle' in s.user));
  check('and the interests the surface layer drew', seen.every((s) => Array.isArray(s.user.interests)));
  check('and the length the deterministic draw produced',
    seen.every((s) => typeof s.user.approximateWordCount === 'number' && (s.user.approximateWordCount as number) > 0));

  // The language decision is the deterministic layer's. A German profile must not be
  // asked for in English and then be expected to come back German.
  const germanRequests = seen.filter((s) => s.user.language === 'de');
  check('German profiles ask the model, in the prompt, to write German',
    germanRequests.length > 0 && germanRequests.every((s) => s.system.includes('WRITE IN DE')),
    `${germanRequests.length} of ${seen.length} requests were for German`);

  // Traits reach the model as WORDS. A model handles "very reserved" better than -0.9.
  check('traits are described in words, not as numbers',
    seen.every((s) => typeof (s.user.person as Record<string, unknown>).extraversion === 'string'));

  check('the prompt forbids the dash characters',
    seen.every((s) => s.system.includes('em-dash') && s.system.includes('phone keyboard')));
  check('the prompt forbids naming the person', seen.every((s) => s.system.includes("person's name")));
  rmSync(dir, { recursive: true, force: true });
}

/* ================================================================ determinism */

section('A seed reproduces its bio (decision §4)');
{
  const dir = mkdtempSync(join(tmpdir(), 'biomodel-'));
  const cachePath = join(dir, 'c.json');
  // A model that returns something DIFFERENT every call. Only the cache can make this
  // reproducible, which is exactly the property being proven.
  let n = 0;
  const drifting = (): string => `bio variant ${n++}`;

  const first = population();
  const r1 = await runModelPass(first, {
    config: MODEL_CONFIG, templates: components.templates, conditioningVersion: CONDITIONING,
    cachePath, fetchImpl: fakeModel(drifting).fetch, now: () => '2026-07-31T00:00:00.000Z',
  });
  const second = population();
  const r2 = await runModelPass(second, {
    config: MODEL_CONFIG, templates: components.templates, conditioningVersion: CONDITIONING,
    cachePath, fetchImpl: fakeModel(drifting).fetch, now: () => '2026-07-31T00:00:00.000Z',
  });

  check('the first run generated', r1.generated > 0, `${r1.generated} bios`);
  check('the second run generated nothing new', r2.generated === 0 && r2.fromCache === r1.generated,
    `${r2.fromCache} from cache`);
  check('and the text is identical despite a model that never repeats itself',
    first.every((p, i) => p.bio.text === second[i]!.bio.text));

  // All three parts of the key, proven one at a time.
  const changedModel = population();
  const r3 = await runModelPass(changedModel, {
    config: { ...MODEL_CONFIG, model: 'a-different-model' },
    templates: components.templates, conditioningVersion: CONDITIONING,
    cachePath, fetchImpl: fakeModel(drifting).fetch, now: () => '2026-07-31T00:00:00.000Z',
  });
  check('a different model regenerates rather than serving the old text',
    r3.generated === r1.generated && r3.fromCache === 0);

  const changedConditioning = population();
  const r4 = await runModelPass(changedConditioning, {
    config: MODEL_CONFIG, templates: components.templates,
    conditioningVersion: `${CONDITIONING}-edited`,
    cachePath, fetchImpl: fakeModel(drifting).fetch, now: () => '2026-07-31T00:00:00.000Z',
  });
  check('an edited data set regenerates too', r4.generated === r1.generated && r4.fromCache === 0);

  const stored = JSON.parse(readFileSync(cachePath, 'utf8')) as { entries: Record<string, unknown> };
  check('earlier entries are kept rather than pruned',
    Object.keys(stored.entries).length === r1.generated * 3,
    `${Object.keys(stored.entries).length} entries across three keyings`);

  const key = BioCache.key(7, CONDITIONING, modelIdentity(MODEL_CONFIG));
  // A TIGHTENED GATE MUST REACH TEXT THAT IS ALREADY CACHED. The validator is code, not
  // conditioning, so it is deliberately absent from the key; without re-validation on
  // read, the run that tightened the recitation gate would have kept serving all 53 bios
  // written before it existed.
  //
  // The cache is written BY HAND here, because bad text cannot get in through the normal
  // path: `writeBioWithModel` validates before `cache.set` is reached. That is the real
  // scenario exactly, though. The entry is what an OLDER, laxer validator wrote.
  {
    const dir2 = mkdtempSync(join(tmpdir(), 'biomodel-'));
    const path2 = join(dir2, 'c.json');
    const seeded = population();
    const identity2 = modelIdentity(MODEL_CONFIG);
    const stale = Object.fromEntries(
      seeded
        .filter((p) => p.bio.text !== null)
        .map((p) => [
          BioCache.key(p.seed, CONDITIONING, identity2),
          { text: 'organised and warm, mostly reading', at: '2020-01-01T00:00:00.000Z' },
        ]),
    );
    writeFileSync(path2, JSON.stringify({ format: 1, entries: stale }, null, 2));

    const r5 = await runModelPass(seeded, {
      config: MODEL_CONFIG, templates: components.templates, conditioningVersion: CONDITIONING,
      cachePath: path2,
      fetchImpl: fakeModel(() => 'linux, slowly').fetch,
      now: () => '2026-07-31T00:00:00.000Z',
    });
    check('cached text the current validator rejects is regenerated, not served',
      r5.cacheRejected === r5.attempted && r5.fromCache === 0,
      `${r5.cacheRejected} of ${r5.attempted} rejected, ${r5.fromCache} served`);
    check('and the replacement is what the population ends up with',
      seeded.filter((p) => p.bio.text !== null).every((p) => p.bio.text === 'linux, slowly'));

    // The converse: text that still passes is still served, so this is a targeted
    // rejection rather than a cache that has quietly stopped working.
    const good = population();
    const fresh = Object.fromEntries(
      good.filter((p) => p.bio.text !== null).map((p) => [
        BioCache.key(p.seed, CONDITIONING, identity2),
        { text: 'linux, slowly', at: '2020-01-01T00:00:00.000Z' },
      ]),
    );
    const path3 = join(dir2, 'd.json');
    writeFileSync(path3, JSON.stringify({ format: 1, entries: fresh }, null, 2));
    const r6 = await runModelPass(good, {
      config: MODEL_CONFIG, templates: components.templates, conditioningVersion: CONDITIONING,
      cachePath: path3,
      fetchImpl: fakeModel(() => new Error('the model must not be called')).fetch,
    });
    check('cached text that still passes is still served without calling the model',
      r6.fromCache === r6.attempted && r6.cacheRejected === 0 && r6.generated === 0,
      `${r6.fromCache} served`);
    rmSync(dir2, { recursive: true, force: true });
  }

  check('the key names all three inputs',
    key.includes('7|') && key.includes(CONDITIONING) && key.includes(MODEL_CONFIG.model));
  rmSync(dir, { recursive: true, force: true });
}

/* ============================================================ failure surfacing */

section('Failures are surfaced and counted, never masked (CCB-S3-023)');
{
  const dir = mkdtempSync(join(tmpdir(), 'biomodel-'));
  const profiles = population();
  const withTemplate = profiles.map((p) => p.bio.text);
  const report = await runModelPass(profiles, {
    config: { ...MODEL_CONFIG, onFailure: 'template' },
    templates: components.templates, conditioningVersion: CONDITIONING,
    cachePath: join(dir, 'a.json'),
    fetchImpl: fakeModel(() => new Error('connect ECONNREFUSED 127.0.0.1:11434')).fetch,
  });
  check('an unreachable model is counted, not absorbed', report.failed === report.attempted);
  check('and the reason is named rather than totalled',
    Object.keys(report.failures).some((r) => r.includes('ECONNREFUSED')),
    Object.keys(report.failures)[0] ?? '');
  check('nothing was generated', report.generated === 0);
  check('onFailure=template keeps the deterministic text',
    profiles.every((p, i) => p.bio.text === withTemplate[i]) && report.keptTemplateText === report.attempted);

  const profiles2 = population();
  const report2 = await runModelPass(profiles2, {
    config: { ...MODEL_CONFIG, onFailure: 'empty' },
    templates: components.templates, conditioningVersion: CONDITIONING,
    cachePath: join(dir, 'b.json'),
    fetchImpl: fakeModel(() => new Error('nope')).fetch,
  });
  // Decision §3: given the choice between an incorrect bio and no bio, no bio is right.
  check('onFailure=empty drops the bio instead',
    report2.emptied === report2.attempted && profiles2.every((p) => p.bio.text === null));

  // A partial failure must not read as a clean run.
  const profiles3 = population();
  const report3 = await runModelPass(profiles3, {
    config: MODEL_CONFIG, templates: components.templates, conditioningVersion: CONDITIONING,
    cachePath: join(dir, 'c.json'),
    fetchImpl: fakeModel((_s, i) => (i % 2 === 0 ? 'quiet, mostly reading' : new Error('timeout'))).fetch,
  });
  check('a half-failed run reports both halves',
    report3.generated > 0 && report3.failed > 0 && report3.generated + report3.failed === report3.attempted,
    `${report3.generated} written, ${report3.failed} failed`);

  let threw = false;
  try {
    const corrupt = join(dir, 'corrupt.json');
    writeFileSync(corrupt, '{not json');
    BioCache.load(corrupt);
  } catch {
    threw = true;
  }
  check('a corrupt cache is a fault, not silently an empty one', threw);
  rmSync(dir, { recursive: true, force: true });
}

/* ============================================================ output discipline */

section('Model output is sanitised and validated before it can be read');
{
  const dir = mkdtempSync(join(tmpdir(), 'biomodel-'));
  const profiles = population();
  // A model that does every forbidden thing at once.
  await runModelPass(profiles, {
    config: MODEL_CONFIG, templates: components.templates, conditioningVersion: CONDITIONING,
    cachePath: join(dir, 'c.json'),
    fetchImpl: fakeModel(() => '"Logistics by trade — coffee · always reading"').fetch,
  });
  const written = profiles.filter((p) => p.bio.text !== null);
  check('the em-dash never reaches the text', written.every((p) => !/[—–―]/u.test(p.bio.text!)),
    'the standing rule is a guarantee here, not a request in the prompt');
  check('nor the middle dot', written.every((p) => !p.bio.text!.includes('·')));
  check('wrapping quotes are removed', written.every((p) => !p.bio.text!.startsWith('"')));

  const base: BioConditioning = {
    seed: 1, language: 'en', theme: 'personal',
    latent: { openness: 0, conscientiousness: 0, extraversion: 0, agreeableness: 0, neuroticism: 0 },
    style: { tone: 50, verbosity: 50, warmth: 50, humor: 50, emojiAffinity: 50, sentenceComplexity: 50, reactionWeights: {} },
    ageBand: '25-34', activityTier: 'lurker', interests: ['cycling'], targetWords: 8,
    displayName: 'Fernando Ramirez',
  };
  check('meta-text is rejected', validateBio('Here is a bio for you: cycling', base) === 'meta-text');
  check('a bio naming its own owner is rejected', validateBio('I am Fernando and I cycle', base) === 'names-self');
  check('a link is rejected', validateBio('cycling, see https://example.test', base) === 'has-link');
  check('a runaway length is rejected', validateBio('word '.repeat(60), base) === 'too-long');
  check('empty is rejected', validateBio('', base) === 'empty');
  check('a plain bio passes', validateBio('Cycling, mostly. Slow about it.', base) === null);

  // THE MODEL RECITES ITS OWN INPUTS unless stopped. The first real run against
  // qwen3.5:9b wrote "I am a very organised, warm Linux enthusiast who finds quiet
  // moments" and "curious gardener. blunt cook.": the conditioning adjectives, verbatim.
  // Nobody describes themselves as organised and warm; being organised and warm is what
  // the writing is supposed to SHOW.
  check('reciting two conditioning adjectives is rejected',
    validateBio('I am a very organised, warm Linux enthusiast who finds quiet moments.', base) === 'recites-traits');
  check('and it survives translation, which an English-only list would have missed',
    validateBio('Ich bin geordnet, doch warmherzig, und lese viel.', base) === 'recites-traits',
    'the conditioning is English and the bio is not');
  // ONE is coincidence. A real bio may well contain "curious" or "dry".
  check('a single conditioning word is left alone',
    validateBio('Curious gardener who binds books badly.', base) === null);

  // A REGRESSION GATE ON THE CHECK ITSELF. The first version of this validator built its
  // regex with `` inside a template literal, which is U+0008 backspace rather than a
  // word boundary. It read correctly, type-checked, and matched nothing, so it gated
  // nothing and a 53-bio run went out unfiltered. A check that silently does nothing is
  // worse than no check, because the harness reports it as passing.
  check('the boundary is a boundary, not a backspace character',
    validateBio('organised and warm', base) === 'recites-traits');

  // INFLECTION. Found by a reader who went and read this file: the list held the citation
  // form `strukturiert` and the model wrote `strukturiere`, so the recitation walked
  // through as a finite verb. A word list matching only citation forms is a list that
  // mostly does not fire in any language that inflects, which is every language here
  // except English.
  check('inflected German forms are caught',
    validateBio('Ich bin geordnete und warmherzige Person.', base) === 'recites-traits');
  check('inflected Spanish forms are caught',
    validateBio('Curiosa y organizada, nada mas.', base) === 'recites-traits');
  check('inflected French forms are caught',
    validateBio('Curieuse et organisee, voila.', base) === 'recites-traits');
  check('and inflected English forms',
    validateBio('organising things and warm about it', base) === 'recites-traits');

  // The bound exists so the stems do not swallow longer words that a real bio may carry.
  check('stems do not over-match longer words',
    validateBio('I work for a large organisation. Bread needs a warm oven.', base) === null,
    '"organisation" is not "organised"');

  // The accented case is why the boundary is a Unicode lookaround rather than , which
  // is ASCII-derived and behaves unpredictably next to an accented letter.
  check('accented stems match on Unicode letter boundaries',
    validateBio('Persona cálida y sociable.', base) === 'recites-traits');
  rmSync(dir, { recursive: true, force: true });
}

/* ================================================== derived fields follow the text */

section('What was derived from the text is re-derived');
{
  const dir = mkdtempSync(join(tmpdir(), 'biomodel-'));
  const profiles = population();
  const before = profiles.map((p) => p.bio.pattern);
  await runModelPass(profiles, {
    config: MODEL_CONFIG, templates: components.templates, conditioningVersion: CONDITIONING,
    cachePath: join(dir, 'c.json'),
    fetchImpl: fakeModel(() => 'Long distance cycling, slowly, and a lot of very strong coffee every single morning without exception').fetch,
  });
  const written = profiles.map((p, i) => ({ p, i })).filter(({ p }) => p.bio.text !== null);
  check('the structural signature describes the new text, not the old',
    written.some(({ p, i }) => p.bio.pattern !== before[i]),
    'a stale signature would leave the distribution view describing a population that no longer exists');

  // The INVARIANT, not a fixture constant: whatever text a profile ended up with, its
  // bucket describes that text. An earlier version of this check asserted a fixed bucket
  // and failed for the right reason, because the validator had rejected the fixture as
  // too long for its target and the profile had correctly kept its template text.
  const bucket = (t: string): string => {
    const w = t.trim().split(/\s+/u).filter(Boolean).length;
    return w <= 5 ? 'short' : w <= 12 ? 'medium' : 'long';
  };
  check('the length bucket follows the text each profile actually ended up with',
    written.every(({ p }) => p.bio.length === bucket(p.bio.text!)),
    `${written.length} written`);
  rmSync(dir, { recursive: true, force: true });
}

/* -------------------------------------------------------------------- done */

console.log('\nThe transport is faked throughout; no model was contacted.');
console.log('Whether the model writes good German is answered by reading crowd.html.');
if (failures > 0) {
  console.error(`\n${failures} CHECK(S) FAILED`);
  process.exit(1);
}
console.log('ALL PASSED');
