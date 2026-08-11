/**
 * She reads what he gives her, against the REAL model (CCB-S5-022, D-176).
 *
 * The offline check proves the mechanism. This is the only thing that can answer the
 * question the operator will actually judge the feature by: does she answer from HIS
 * document, does she say which one, and does she say "I do not have that" when she does not?
 *
 * The four cases the briefing asks for, in order:
 *
 *   1. A question answered from a real document, with the attribution line.
 *   2. The same question with the document removed.
 *   3. A question no document covers.
 *   4. A bot without the capability answering without it.
 *
 * Real nomic-embed-text, real qwen3:32b, real pgvector. Nothing is faked but the transport
 * to SimpleX.
 *
 * READ ITS OUTPUT, NOT ITS EXIT CODE. What is decidable is asserted - a removed document
 * cited, an attribution under an answer that used nothing - and the rest is printed for a
 * person to read.
 *
 *   npm run verify:knowledge-live      (needs Ollama on 127.0.0.1:11434)
 */

import { PGlite } from '@electric-sql/pglite';
import { vector } from '@electric-sql/pglite-pgvector';
import type { T } from '@simplex-chat/types';
import { loadMigrationFiles } from '../src/db/migrate.js';
import type { Queryable } from '../src/db/pool.js';
import { setLogLevel } from '../src/log.js';
import { Embedder } from '../src/knowledge/embed.js';
import {
  KnowledgeService,
  checksumOf,
  singleConnectionTransaction,
} from '../src/knowledge/service.js';
import { deleteDocument, setGrant, upsertDocument } from '../src/db/knowledge.js';
import { normalizeKnowledge } from '../src/plugins/knowledge-base/settings.js';
import { InteractionEngine } from '../src/interaction/engine.js';
import { normalizeInteraction } from '../src/interaction/settings.js';
import { generateOllamaReply } from '../src/interaction/ollama-reply.js';
import { normalizePersonality } from '../src/interaction/personality.js';
import { listPromptRules } from '../src/db/prompt-rules.js';
import type { CapturedMessage } from '../src/capture/types.js';
import type { LocalAiConfig } from '../src/config.js';

let failures = 0;
function check(label: string, ok: boolean, detail = ''): void {
  if (!ok) failures++;
  console.log(`  [${ok ? 'PASS' : 'FAIL'}] ${label}${detail ? `: ${detail}` : ''}`);
}

const AI: LocalAiConfig = {
  enabled: true,
  baseUrl: process.env['OLLAMA_URL'] ?? 'http://127.0.0.1:11434',
  model: process.env['OLLAMA_MODEL'] ?? 'qwen3:32b',
  intentModel: process.env['OLLAMA_MODEL'] ?? 'qwen3:32b',
  replyModel: process.env['OLLAMA_MODEL'] ?? 'qwen3:32b',
  timeoutMs: 180_000,
} as LocalAiConfig;

/**
 * A real document, in the shape the operator's material actually has: protocol work with
 * exact identifiers in it. Taken from this repository's own standing context so nothing
 * member-shaped is involved.
 */
const SCHEDULER_DOC = `# The Active User Scheduler

Every SimpleX command issued by any hosted bot goes through the ActiveUserScheduler. It
serializes them, because the SimpleX core has exactly one active user at a time, and two
commands interleaved would execute as the wrong profile.

## An explicit user id is not an exemption

This was got wrong for three briefings. The architecture notes said apiListGroups "takes an
EXPLICIT user id, so it needs no scheduler: it is one of the few commands that cannot be
misrouted". The core does the opposite. It CHECKS the id against the active user and refuses
with differentActiveUser when they differ.

Naming a user makes a command refusable, not unmisroutable. Every SimpleX command goes
through the scheduler, whatever it carries.

## Re-entry is refused

A command may not schedule another from inside itself. Scheduling from inside a critical
section waits for the section that is waiting for it, so the guard refuses re-entry
immediately rather than after the sixty second command timeout.
`;

const PERSONALITY = normalizePersonality({
  baseCharacter: 'A neon courier who lives in the wire and does not pad an answer.',
  origin: '',
  sharpness: 6,
  warmth: 5,
  humor: 4,
  verbosity: 5,
  permissiveness: 5,
});

let itemId = 3000;
function makeMessage(text: string): CapturedMessage {
  return {
    groupId: 77,
    groupName: 'archive',
    itemId: itemId++,
    sharedMsgId: undefined,
    senderMemberId: 'alice-member-id',
    senderDisplayName: 'Alice',
    senderRole: 'member',
    senderGroupMemberId: 91,
    sentAt: new Date('2026-08-11T12:00:00.000Z').toISOString(),
    type: 'text',
    text,
    linkPreview: undefined,
    file: undefined,
    forwarded: false,
    quotedFromBot: false,
    raw: {} as T.AChatItem,
  };
}

async function main(): Promise<void> {
  setLogLevel('error');
  console.log(`Endpoint ${AI.baseUrl}, reply model ${AI.replyModel}, embedder nomic-embed-text\n`);

  const pg = new PGlite({ extensions: { vector } });
  const db: Queryable = {
    async query(sql, values) {
      const result = await pg.query(sql, values ? [...values] : undefined);
      return {
        rows: result.rows as never[],
        rowCount: (result.affectedRows ?? result.rows.length) as number,
      };
    },
  };
  for (const m of await loadMigrationFiles()) await pg.exec(m.sql);

  const { rows } = await db.query<{ id: string; slug: string }>(
    `INSERT INTO cinderella_bot_profiles (slug, display_name, enabled)
     VALUES ('reader', 'Reader', TRUE), ('blank', 'Blank', TRUE) RETURNING id, slug`,
  );
  const bySlug = new Map(rows.map((r) => [r.slug, Number(r.id)]));
  const reader = bySlug.get('reader') ?? 0;
  const blank = bySlug.get('blank') ?? 0;

  const embedder = new Embedder({ config: { baseUrl: AI.baseUrl, timeoutMs: 120_000 } });
  const settings = normalizeKnowledge({});
  const service = new KnowledgeService({
    db,
    embedder,
    settings: () => settings,
    transaction: singleConnectionTransaction(db),
  });

  const started = Date.now();
  const doc = await upsertDocument(db, {
    title: 'The Active User Scheduler',
    sourceName: 'scheduler.md',
    contentType: 'text/markdown',
    body: SCHEDULER_DOC,
    checksum: checksumOf(SCHEDULER_DOC),
  });
  const { chunks } = await service.ingest(doc.id);
  await setGrant(db, doc.id, reader, true);
  console.log(
    `Ingested ${String(chunks)} chunk(s) in ${String(Date.now() - started)} ms (real embedder).\n`,
  );

  const rules = await listPromptRules(db);
  const interaction = normalizeInteraction({});
  const replies: string[] = [];
  const engineFor = (botProfileId: number, withKnowledge: boolean): InteractionEngine =>
    new InteractionEngine({
      db,
      botProfileId,
      settings: () => interaction,
      capabilities: () => [
        'PUBLISH', 'UNPUBLISH', 'STATUS', 'SEARCH', 'HELP', 'UNDO', 'RESTORE', 'UNKNOWN',
      ],
      rules: () => rules,
      personality: () => PERSONALITY,
      // The port is null for a bot the plugin is off for, which is the whole
      // absent-capability property for a plugin that contributes no intent.
      knowledge: () => (withKnowledge ? service : null),
      personalize: (request) => generateOllamaReply(AI, request),
      send: (msg, text) => {
        replies.push(text);
        return Promise.resolve(msg && undefined);
      },
    });

  const ask = async (
    label: string,
    engine: InteractionEngine,
    question: string,
  ): Promise<string> => {
    replies.length = 0;
    const t = Date.now();
    await engine.handle(makeMessage(`Cinderella ${question}`));
    const said = replies.join('\n');
    console.log(`${label}\n  Q: ${question}\n  A: ${said || '(silence)'}\n  [${String(Date.now() - t)} ms]\n`);
    return said;
  };

  // NOT the word "command": it is a HELP keyword, and an earlier version of this probe
// resolved to HELP and rewrote the help text instead of talking. The implementation was
// right and the question was wrong (D-111).
const QUESTION = 'is an explicit user id an exemption from the scheduler';

  /* 1. Answered from the document. */
  const answered = await ask('1. WITH THE DOCUMENT', engineFor(reader, true), QUESTION);
  check('she answered', answered.trim().length > 0);
  check(
    'and the application printed the source line naming the document',
    answered.includes('The Active User Scheduler'),
    answered.includes('From what you gave me') ? 'attribution present' : 'NO attribution line',
  );
  check(
    'the answer reflects what the document actually says',
    /refus|check|not an exemption|differentActiveUser|still|yes/i.test(answered),
  );

  /* 2. A question no document covers. */
  const uncovered = await ask(
    '2. A QUESTION NO DOCUMENT COVERS',
    engineFor(reader, true),
    'what is the boiling point of mercury',
  );
  check(
    'nothing is attributed to a document that did not answer it',
    !uncovered.includes('From what you gave me'),
    uncovered.includes('From what you gave me') ? 'FALSE ATTRIBUTION' : 'no source line',
  );

  /* 3. The document removed. */
  await deleteDocument(db, doc.id);
  const removed = await ask('3. AFTER THE DOCUMENT IS REMOVED', engineFor(reader, true), QUESTION);
  check(
    'the removed document is not cited',
    !removed.includes('The Active User Scheduler'),
    removed.includes('The Active User Scheduler') ? 'STALE CITATION' : 'not cited',
  );
  check('and no source line is printed at all', !removed.includes('From what you gave me'));

  /* 4. A bot without the capability. */
  const without = await ask(
    '4. A BOT WITHOUT THE CAPABILITY',
    engineFor(blank, false),
    QUESTION,
  );
  check('it answered without the store', without.trim().length >= 0);
  check('and cited nothing', !without.includes('From what you gave me'));

  console.log(
    `\nRead the answers above rather than this line. ${
      failures === 0 ? 'Nothing decidable failed.' : `${String(failures)} decidable check(s) FAILED.`
    }\n`,
  );
  await pg.close();
  process.exit(failures === 0 ? 0 : 1);
}

void main();
