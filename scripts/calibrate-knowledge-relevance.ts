/**
 * Where the knowledge relevance floor's number comes from (D-226). Not a
 * check: it PRINTS the bands so the floor is chosen against evidence, the
 * same instrument `calibrate:search-relevance` is for the web floor. Its
 * sibling `calibrate:knowledge-floor` (CCB-S5-037, D-195) answers the OTHER
 * floor question - whether a contentless message clears it; this one answers
 * where it should sit for a given corpus.
 *
 * Run it against the material the deployment actually ingests, ON the
 * deployment when possible (D-184: a constant measured on one machine is a
 * guess about every other one). The shipped default (0.60) came from two
 * measurements with nomic-embed-text:
 *
 *   original bands (CCB-S5-023): relevant 0.62-0.75, unrelated 0.39-0.43
 *   the fourth-sighting measurement (D-220/D-226): the SimpleGo README's
 *   noise band against off-topic questions 0.53-0.58 - the operator's own
 *   sentence scored 0.575 against a floor of 0.55 - while genuinely covered
 *   questions scored 0.65-0.77
 *
 * The gap between every measured noise value and every measured relevant
 * value is [0.58, 0.62]; 0.60 sits in its middle.
 *
 *   npx tsx scripts/calibrate-knowledge-relevance.ts <doc.md> [more docs...]
 *   (no args: uses the repo's own README as a stand-in corpus)
 */
import { readFileSync } from 'node:fs';
import { basename } from 'node:path';
import { chunkDocument, CHUNK_DEFAULTS } from '../src/knowledge/chunk.js';
import { Embedder } from '../src/knowledge/embed.js';
import { cosine } from '../src/plugins/web-search/relevance.js';

const OFF_TOPIC = [
  'do you have Chillstep Music',
  'what is the boiling point of mercury',
  'hello, how are you today?',
  'play something for us',
  'what year is it',
];

const CANDIDATE_FLOORS = [0.5, 0.55, 0.58, 0.6, 0.62, 0.65];

async function main(): Promise<void> {
  const docs = process.argv.slice(2);
  if (docs.length === 0) docs.push('README.md');
  const embedder = new Embedder({
    config: {
      baseUrl: process.env.OLLAMA_BASE_URL ?? 'http://127.0.0.1:11434',
      timeoutMs: 120_000,
    },
  });

  for (const path of docs) {
    const body = readFileSync(path, 'utf8');
    const chunks = chunkDocument({ title: basename(path), body }, CHUNK_DEFAULTS);
    const texts = chunks.map((c) => (c.contextPrefix ? `${c.contextPrefix}\n${c.body}` : c.body));
    const vecs = await embedder.embedDocuments(texts);
    console.log(`\n═══ ${path} (${String(chunks.length)} chunks)`);

    const onTopic = `what is ${basename(path).replace(/\..+$/, '')} about?`;
    for (const q of [onTopic, ...OFF_TOPIC]) {
      const qv = await embedder.embedQuery(q);
      const scores = vecs.map((v) => cosine(qv, v)).sort((a, b) => b - a);
      const top = scores.slice(0, 3).map((s) => s.toFixed(3)).join(', ');
      const admits = CANDIDATE_FLOORS.map(
        (f) => `${f.toFixed(2)}:${String(scores.filter((s) => s >= f).length)}`,
      ).join('  ');
      console.log(`  "${q}"\n    top: ${top}\n    admitted per floor  ${admits}`);
    }
  }
  console.log(
    '\nPick the floor from the gap between the off-topic band and the on-topic one; the shipped default is 0.60.',
  );
}

main().catch((e: unknown) => {
  console.error(e);
  process.exit(1);
});
