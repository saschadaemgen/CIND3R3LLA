/**
 * What a CONTENTLESS message scores against the knowledge corpus (CCB-S5-037, D-195).
 *
 * ── THE PRODUCTION DEFECT THIS MEASURES ──────────────────────────────────────
 *
 * A member sent a heart emoji and nothing else. She announced a lookup, answered with small
 * talk about heart emojis, and printed
 *
 *     From what you gave me: SS7 Attack Notable Incidents and Regulatory Response
 *
 * under it. The answer had nothing to do with that document and nothing to do with SS7.
 *
 * Two guarantees failed at once and they have one cause. `knowledge.query` runs on EVERY
 * free-conversation message with no condition on whether the member asked anything, and both
 * the announcement and the attribution are gated on `knowledgePassages.length > 0` - that is,
 * on the FLOOR having admitted something. So the floor is the only thing standing between an
 * emoji and a document name, and a floor is a number, not a statement about the message.
 *
 * ── WHAT THIS SCRIPT ANSWERS ─────────────────────────────────────────────────
 *
 * Whether a contentless message clears 0.55 against ordinary chunks. If it does, no number
 * fixes this - the input has no terms to match and any document can be handed over for
 * anything, which is D-183's "a bar that lives only in a prompt is not a bar" wearing a
 * cosine instead of a sentence.
 *
 * Five bands of INPUT, all scored against the same corpus:
 *
 *   `question`     a real question the corpus answers          - must clear the floor
 *   `topical`      names the subject, not a question           - should clear it
 *   `smalltalk`    a greeting, thanks, a reaction              - must NOT retrieve
 *   `emoji`        emoji only, the production case             - must NOT retrieve
 *   `single-word`  one bare word                               - must NOT retrieve
 *
 *   npm run calibrate:knowledge-floor
 *
 * Needs Ollama with nomic-embed-text. Prints every band's scores against the corpus, the
 * maximum any contentless input reaches, and whether the shipped floor separates them.
 */

import { Embedder } from '../src/knowledge/embed.js';
import { cosine } from '../src/plugins/web-search/relevance.js';
import { setLogLevel } from '../src/log.js';
import { RETRIEVAL_DEFAULTS } from '../src/knowledge/retrieval.js';

/** Chunk-shaped material: connected prose about one thing, as the knowledge base stores it. */
const CORPUS: { name: string; text: string }[] = [
  {
    name: 'SS7 Attack Notable Incidents and Regulatory Response',
    text:
      'Signalling System No. 7 was designed in 1975 for a closed network of trusted carriers ' +
      'and carries no authentication between operators. Notable incidents include the 2017 ' +
      'theft from German bank accounts, where attackers used SS7 to intercept mTAN codes, and ' +
      'the tracking of a US congressman by researchers demonstrating location disclosure. ' +
      'Regulators responded unevenly: the FCC opened an inquiry, the GSMA published signalling ' +
      'firewall guidance, and several operators deployed SS7 firewalls at the network edge.',
  },
  {
    name: 'Media retention and the destruction sweeper',
    text:
      'Originals are encrypted at rest under a dedicated media secret and the database stores ' +
      'the path rather than the bytes. When a member revokes consent and chooses deletion, the ' +
      'row is marked and the deferred-destruction sweeper erases the file on its next pass, ' +
      'unless an evidence hold defers that. A hold never defers the hiding, only the erasure.',
  },
  {
    name: 'Group onboarding for a second bot',
    text:
      'Each hosted profile creates its own contact address and accepts its own invitations. ' +
      'The console runs each onboarding step as the bot it was given rather than as the ' +
      'primary, because a database write filed against one profile and a SimpleX call issued ' +
      'as another is the misrouting class this project has already paid for twice.',
  },
];

const INPUTS: { band: string; text: string }[] = [
  { band: 'question', text: 'What happened in the 2017 SS7 attack on German bank accounts?' },
  { band: 'question', text: 'How does the destruction sweeper handle an evidence hold?' },
  { band: 'topical', text: 'SS7 signalling security' },
  { band: 'topical', text: 'media retention' },
  { band: 'smalltalk', text: 'hey there' },
  { band: 'smalltalk', text: 'thanks, that is great' },
  { band: 'smalltalk', text: 'good morning everyone' },
  { band: 'emoji', text: '❤️' },
  { band: 'emoji', text: '👍' },
  { band: 'emoji', text: '🔥🔥🔥' },
  { band: 'single-word', text: 'ok' },
  { band: 'single-word', text: 'nice' },
  { band: 'single-word', text: 'yes' },
];

const CONTENTLESS = new Set(['smalltalk', 'emoji', 'single-word']);

async function main(): Promise<void> {
  setLogLevel('error');
  const baseUrl = process.env['LOCAL_AI_BASE_URL'] ?? 'http://127.0.0.1:11434';
  console.log('What a contentless message scores against the knowledge corpus');
  console.log(`  embedder: nomic-embed-text at ${baseUrl}`);
  console.log(`  shipped floor: ${String(RETRIEVAL_DEFAULTS.minScore)}\n`);

  const embedder = new Embedder({ config: { baseUrl, timeoutMs: 120_000 } });
  // The SAME calls production makes: nomic prefixes query and document differently, and
  // measuring with the wrong one would measure a system nobody runs.
  const corpusVectors = await embedder.embedDocuments(CORPUS.map((c) => c.text));

  const byBand = new Map<string, number[]>();

  for (const input of INPUTS) {
    const vector = await embedder.embedQuery(input.text);
    const scores = corpusVectors.map((cv, i) => ({
      name: CORPUS[i]?.name ?? '?',
      score: cosine(vector, cv),
    }));
    scores.sort((a, b) => b.score - a.score);
    const best = scores[0];
    if (!best) continue;
    const list = byBand.get(input.band) ?? [];
    list.push(best.score);
    byBand.set(input.band, list);

    const verdict = best.score >= RETRIEVAL_DEFAULTS.minScore ? 'RETRIEVES' : 'nothing';
    console.log(
      `  ${input.band.padEnd(12)} ${JSON.stringify(input.text).padEnd(58)} ` +
        `best=${best.score.toFixed(3)} ${verdict.padEnd(10)} ${best.score >= RETRIEVAL_DEFAULTS.minScore ? best.name : ''}`,
    );
  }

  console.log('\n── bands ──────────────────────────────────────────────────────');
  const summary = new Map<string, { min: number; max: number }>();
  for (const [band, scores] of byBand) {
    const min = Math.min(...scores);
    const max = Math.max(...scores);
    summary.set(band, { min, max });
    console.log(`  ${band.padEnd(12)} n=${String(scores.length)}  min=${min.toFixed(3)}  max=${max.toFixed(3)}`);
  }

  const wanted = ['question', 'topical'].flatMap((b) => byBand.get(b) ?? []);
  const contentless = [...CONTENTLESS].flatMap((b) => byBand.get(b) ?? []);
  const lowestWanted = wanted.length ? Math.min(...wanted) : NaN;
  const highestContentless = contentless.length ? Math.max(...contentless) : NaN;

  console.log('\n── the question this exists to answer ─────────────────────────');
  console.log(`  lowest score a REAL question reaches      : ${lowestWanted.toFixed(3)}`);
  console.log(`  highest score a CONTENTLESS message reaches: ${highestContentless.toFixed(3)}`);
  console.log(`  shipped floor                              : ${RETRIEVAL_DEFAULTS.minScore.toFixed(3)}`);

  const contentlessRetrieves = contentless.filter((s) => s >= RETRIEVAL_DEFAULTS.minScore).length;
  console.log(
    `\n  contentless inputs that RETRIEVE at the shipped floor: ` +
      `${String(contentlessRetrieves)} of ${String(contentless.length)}`,
  );

  if (highestContentless >= lowestWanted) {
    console.log(
      '\n  VERDICT: NO FLOOR SEPARATES THEM. A contentless message scores at or above the\n' +
        '  lowest real question, so raising the number cannot fix this without also refusing\n' +
        '  questions the corpus answers. The floor needs a COMPANION PREDICATE over the text:\n' +
        '  a message with nothing to retrieve must not retrieve, whatever it scores.',
    );
  } else {
    const gap = lowestWanted - highestContentless;
    console.log(
      `\n  VERDICT: a gap of ${gap.toFixed(3)} exists. A floor between ` +
        `${highestContentless.toFixed(3)} and ${lowestWanted.toFixed(3)} would separate them -\n` +
        '  but read the per-input lines before trusting it: a gap over thirteen inputs is a\n' +
        '  weaker claim than a predicate that cannot be scored past.',
    );
  }
}

main().catch((err: unknown) => {
  console.error(err);
  process.exitCode = 1;
});
