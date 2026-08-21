/**
 * What the knowledge base ACTUALLY returns for a question, on a real corpus (D-239).
 *
 * ── WHY THIS EXISTS ──────────────────────────────────────────────────────────
 *
 * A false source line has been reported five times. Each diagnosis so far reasoned about the
 * relevance floor and raised it; the fifth sighting arrived with the floor at 0.60. Reasoning
 * about the floor is measuring ONE INPUT to the decision rather than the decision, which is
 * how a defect survives five rounds.
 *
 * This drives the REAL `searchChunks` and the REAL `retrieve()` against a real database and a
 * real embedder, and prints every candidate with both of its scores, whether it cleared the
 * floor, and what was finally selected. It answers the only question that matters: was the
 * application handed anything to attribute, or was there nothing and the line was invented.
 *
 * ── READ THE TWO SCORES SEPARATELY ───────────────────────────────────────────
 *
 * `retrieval.ts` is explicit that the floor is on COSINE and only on cosine, because that is
 * the calibrated number; the fused RRF score decides ORDER, not admission. So a candidate can
 * rank first and still be refused, and that is the case this print makes visible.
 *
 * Run it where the corpus is:
 *   DATABASE_URL=... LOCAL_AI_BASE_URL=... npx tsx scripts/measure-knowledge-retrieval.ts <botId> "<question>"
 */

import { Pool } from 'pg';
import type { Queryable } from '../src/db/pool.js';
import { searchChunks, botCorpusSize } from '../src/db/knowledge.js';
import { retrieve, RETRIEVAL_DEFAULTS } from '../src/knowledge/retrieval.js';
import { Embedder } from '../src/knowledge/embed.js';

const BOT = Number(process.argv[2] ?? 1);
const QUESTION = process.argv[3] ?? "what's your most efficient function";

function pad(s: string, n: number): string {
  return s.length >= n ? s.slice(0, n) : s + ' '.repeat(n - s.length);
}

async function main(): Promise<void> {
  const pool = new Pool({ connectionString: process.env['DATABASE_URL'] });
  const db: Queryable = {
    async query(text, values) {
      const r = await pool.query(text, values ? [...values] : undefined);
      return { rows: r.rows as never[], rowCount: r.rowCount ?? 0 };
    },
  };

  const settings = RETRIEVAL_DEFAULTS;
  const corpus = await botCorpusSize(db, BOT);
  console.log(`\nbot ${String(BOT)}  corpus: ${String(corpus.documents)} documents, ${String(corpus.chunks)} chunks`);
  console.log(`question: ${JSON.stringify(QUESTION)}`);
  console.log(`floor (cosine): ${String(settings.minScore)}   candidates per search: ${String(settings.candidatesPerSearch)}\n`);

  if (corpus.chunks === 0) {
    console.log('This bot is granted no documents, so no embedding call is made at all.');
    await pool.end();
    return;
  }

  // The REAL embedder against the REAL endpoint. Two minutes, because a cold model load
  // beside a resident reply model is measured at ~800 ms and a probe must not time out
  // where production would have waited.
  const embedder = new Embedder({
    config: {
      baseUrl: process.env['LOCAL_AI_BASE_URL'] ?? 'http://127.0.0.1:11434',
      timeoutMs: 120_000,
    },
  });
  const vector = await embedder.embedQuery(QUESTION.slice(0, 2000));
  const candidates = await searchChunks(db, BOT, QUESTION.slice(0, 500), vector, settings.candidatesPerSearch);

  console.log(`candidates returned by the two searches: ${String(candidates.length)}\n`);
  console.log(`  ${pad('cosine', 8)}${pad('vecRank', 9)}${pad('kwRank', 8)}${pad('floor?', 8)}document`);
  for (const c of [...candidates].sort((a, b) => b.vectorScore - a.vectorScore)) {
    console.log(
      `  ${pad(c.vectorScore.toFixed(4), 8)}${pad(String(c.vectorRank ?? '-'), 9)}${pad(String(c.keywordRank ?? '-'), 8)}` +
        `${pad(c.vectorScore >= settings.minScore ? 'PASS' : 'below', 8)}${c.documentTitle.slice(0, 44)}`,
    );
  }

  const outcome = retrieve(candidates, settings);
  console.log('');
  console.log(`SELECTED: ${String(outcome.selected.length)} passage(s), ${String(outcome.charsUsed)} characters`);
  for (const s of outcome.selected) {
    console.log(`  fused ${s.fusedScore.toFixed(5)}  cosine ${s.vectorScore.toFixed(4)}  ${s.documentTitle.slice(0, 50)}`);
  }
  console.log(`emptyBecauseOfFloor: ${String(outcome.emptyBecauseOfFloor)}`);
  console.log('');
  console.log(
    outcome.selected.length === 0
      ? 'THE APPLICATION WAS HANDED NOTHING. Any source line under this answer was invented,\nand the fault is the guard rather than the floor.'
      : 'The application WAS handed passages, so a source line under this answer is the\napplication printing what it retrieved, and the fault is relevance rather than forgery.',
  );
  console.log('');
  await pool.end();
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
