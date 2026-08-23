/**
 * What an answer carries from the passage it cites, measured where it runs. (D-256)
 *
 * ── THE QUESTION THIS ANSWERS ────────────────────────────────────────────────
 *
 * `provenance.ts` prints a document under an answer only when the answer carries content
 * terms from that passage beyond the member's own question. The number of terms that
 * separates "she used it" from "she declared it and refused" is a property of his corpus and
 * his model, not of this repository (D-184). So this runs against the PRODUCTION knowledge
 * store, the production embedder and the production reply model, with the production request
 * shape, and prints per answer: what the model declared, what the evidence rule finds, what
 * the refusal floor says, and the reply itself - because the number without the samples is
 * the eighteen-probe mistake, and reading the replies is the measurement.
 *
 * ── RUN ON THE HOST, FROM tmp/, AND REMOVE IT AFTER ──────────────────────────
 *
 *   scp scripts/measure-provenance.ts vps:/opt/cinderella/tmp/
 *   ssh vps 'cd /opt/cinderella && set -a && . /etc/cinderella/cinderella.env && set +a &&
 *            npx tsx tmp/measure-provenance.ts ; rm -f tmp/measure-provenance.ts'
 *
 * Prints the operator's own document TITLES (his file names) and her replies. Never a
 * passage body, never a member message.
 */

import { Pool } from 'pg';
import type { Queryable } from '../src/db/pool.js';
import { withTransaction } from '../src/db/pool.js';
import { loadLocalAiConfig } from '../src/config.js';
import { listPromptRules } from '../src/db/prompt-rules.js';
import { Embedder } from '../src/knowledge/embed.js';
import { KnowledgeService } from '../src/knowledge/service.js';
import { PluginService } from '../src/plugins/service.js';
import { generateOllamaReply, type AiReplyRequest } from '../src/interaction/ollama-reply.js';
import { DEFAULT_PERSONALITY } from '../src/interaction/personality.js';
import {
  EVIDENCE_MIN_TERMS,
  evidenceOfUse,
  looksLikeRefusal,
} from '../src/interaction/provenance.js';

/** Half the docs should answer, half should not; the label is what the reader checks. */
const QUESTIONS: { q: string; expect: 'answer' | 'refuse' }[] = [
  { q: 'How does SimpleX use TLS between a client and a server?', expect: 'answer' },
  { q: 'What is the SMP protocol and what does a queue do in it?', expect: 'answer' },
  { q: 'How does XFTP transfer a file?', expect: 'answer' },
  { q: 'What does the double ratchet do for message encryption in SimpleX?', expect: 'answer' },
  { q: 'How does the session history work in SimpleGo?', expect: 'answer' },
  { q: 'What does the SimpleGo protocol index cover?', expect: 'answer' },
  { q: 'How are SimpleX message queues addressed and rotated?', expect: 'answer' },
  { q: 'What is the role of the SMP relay in SimpleX?', expect: 'answer' },
  { q: 'How does a SimpleX client find out which servers to use?', expect: 'answer' },
  { q: 'How many people use SimpleX?', expect: 'refuse' },
  { q: 'Who funds SimpleX development?', expect: 'refuse' },
  { q: 'What will SimpleX release next year?', expect: 'refuse' },
  { q: 'How much does SimpleX Premium cost per month?', expect: 'refuse' },
  { q: 'How old is the founder of SimpleX?', expect: 'refuse' },
  { q: 'What is Zeliqua?', expect: 'refuse' },
  { q: 'What is the latest SimpleGo version number?', expect: 'refuse' },
  { q: 'In which city are the SimpleX servers hosted?', expect: 'refuse' },
  { q: 'How many messages does SimpleX deliver per day?', expect: 'refuse' },
  { q: 'Which company acquired SimpleX?', expect: 'refuse' },
];

async function main(): Promise<void> {
  const url = process.env['DATABASE_URL'];
  if (!url) throw new Error('DATABASE_URL is not set; load the host env first.');
  const pool = new Pool({ connectionString: url });
  const db: Queryable = pool as unknown as Queryable;

  const plugins = await PluginService.load(db);
  const knowledge = plugins.getKnowledge();
  const base = loadLocalAiConfig();
  // The model comes from the routing row, never from the stale env default (D-245).
  const { rows: routing } = await pool.query<{ value: { replyModel?: string } }>(
    "SELECT value FROM settings WHERE key = 'local-ai-model-routing'",
  );
  const model = routing[0]?.value?.replyModel ?? base.replyModel;
  const ai = { ...base, enabled: true, model, replyModel: model, intentModel: model };

  const { rows: bots } = await pool.query<{ bot_profile_id: string; n: string }>(
    'SELECT bot_profile_id, count(*)::text AS n FROM cinderella_kb_document_bots GROUP BY 1 ORDER BY 2 DESC LIMIT 1',
  );
  const botId = Number(bots[0]?.bot_profile_id);
  if (!Number.isFinite(botId)) throw new Error('no bot has any document granted');

  const service = new KnowledgeService({
    db,
    embedder: new Embedder({ config: base }),
    settings: () => knowledge,
    transaction: withTransaction,
  });
  const rules = await listPromptRules(db);

  console.log(
    `model ${model}, bot ${String(botId)}, floor ${String(knowledge.relevanceFloor)}, ` +
      `trigger ${knowledge.trigger}, evidence rule needs ${String(EVIDENCE_MIN_TERMS)} terms\n`,
  );

  const bands: { label: string; declared: number; evidenceMin: number | null; refusal: boolean }[] = [];

  for (const { q, expect } of QUESTIONS) {
    const { passages, sources } = await service.query(botId, q);
    console.log(`\n━━ [${expect}] ${q}`);
    if (passages.length === 0) {
      console.log('   no passages cleared the floor: nothing to attribute, nothing to measure');
      continue;
    }
    console.log(`   handed ${String(passages.length)} passage(s): ${sources.join(' | ')}`);

    let declared: readonly number[] | null = null;
    const request: AiReplyRequest = {
      kind: 'conversation',
      lang: 'en',
      memberMessage: q,
      deterministicDraft: '',
      mode: 'conversation',
      rules,
      personality: { ...DEFAULT_PERSONALITY },
      identity: { name: 'CIND3R3LLA', label: 'SimpleX AI Bot' },
      now: { at: new Date(), timeZone: 'Europe/Berlin' },
      knowledgePassages: passages,
      onDocumentsUsed: (indices) => {
        declared = indices;
      },
    };
    const started = Date.now();
    const reply = await generateOllamaReply(ai, request);
    const ms = Date.now() - started;
    if (reply === null) {
      console.log(`   model returned NOTHING (${String(ms)} ms)`);
      continue;
    }
    const refusal = looksLikeRefusal(reply);
    const decl: readonly number[] = declared ?? [];
    console.log(`   her reply (${String(ms)} ms): ${reply.replace(/\s+/g, ' ')}`);
    console.log(`   declared: ${JSON.stringify(decl)}   refusal floor: ${refusal ? 'REFUSAL' : 'no'}`);
    let evidenceMin: number | null = null;
    for (const index of decl) {
      const passage = passages[index];
      if (!passage) continue;
      const e = evidenceOfUse(reply, q, passage.text);
      evidenceMin = evidenceMin === null ? e.terms.length : Math.min(evidenceMin, e.terms.length);
      console.log(
        `     #${String(index)} "${passage.title}": ${String(e.terms.length)} term(s) ` +
          `[${e.terms.slice(0, 8).join(', ')}${e.terms.length > 8 ? ', …' : ''}]  ` +
          `shingle share ${e.shingleShare.toFixed(2)}  -> ` +
          `${!refusal && e.terms.length >= EVIDENCE_MIN_TERMS ? 'CITED' : 'dropped'}`,
      );
    }
    bands.push({ label: expect, declared: decl.length, evidenceMin, refusal });
  }

  console.log('\n━━ BANDS (read the replies above; the label is what was EXPECTED, not what she did)');
  for (const label of ['answer', 'refuse'] as const) {
    const rows = bands.filter((b) => b.label === label);
    const declaredSomething = rows.filter((b) => b.declared > 0);
    const mins = declaredSomething.map((b) => b.evidenceMin ?? 0).sort((a, b) => a - b);
    console.log(
      `   expected ${label}: ${String(rows.length)} measured, ${String(declaredSomething.length)} ` +
        `declared a document, min terms per declared reply: [${mins.join(' ')}], ` +
        `refusal floor fired on ${String(rows.filter((b) => b.refusal).length)}`,
    );
  }
  console.log(
    '\nRead every reply. A refusal that declared a document and carries >= ' +
      `${String(EVIDENCE_MIN_TERMS)} terms is the gate failing open; an answer with fewer is the ` +
      'gate costing a true citation. Both are counted by hand here, not by this script.',
  );

  await pool.end();
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
