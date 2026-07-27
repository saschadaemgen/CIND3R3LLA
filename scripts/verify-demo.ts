/**
 * Verification harness — the public demo (CCB-S4-001, Phase 1).
 *
 * The important assertions here are the NEGATIVE ones. A demo that works is easy;
 * a demo that cannot become a way into the real console is the whole point, so
 * most of this proves things do NOT happen.
 *
 *   npx tsx scripts/verify-demo.ts
 */

import { PGlite } from '@electric-sql/pglite';

import {
  DEMO_MARKER_KEY,
  DEMO_MARKER_VALUE,
  demoDatabaseMarked,
  demoEnabled,
  demoEnvFlag,
  markDemoDatabase,
} from '../src/demo/guard.js';
import { loadMigrationFiles } from '../src/db/migrate.js';
import { upsertMessage } from '../src/db/messages.js';
import type { Queryable } from '../src/db/pool.js';

let failures = 0;
function check(label: string, ok: boolean, detail = ''): void {
  if (!ok) failures++;
  console.log(`  [${ok ? 'PASS' : 'FAIL'}] ${label}${detail ? ` - ${detail}` : ''}`);
}
function section(t: string): void {
  console.log(`\n${t}`);
}

async function freshDb(): Promise<{ pg: PGlite; db: Queryable }> {
  const pg = new PGlite();
  const db: Queryable = {
    async query(text, values) {
      const res = await pg.query(text, values ? [...values] : undefined);
      return {
        rows: res.rows as never[],
        rowCount: (res.affectedRows ?? res.rows.length) as number,
      };
    },
  };
  for (const m of await loadMigrationFiles()) await pg.exec(m.sql);
  return { pg, db };
}

async function main(): Promise<void> {
  section('1. The two guards, and every way they can disagree');

  const prod = await freshDb();
  const demo = await freshDb();
  await markDemoDatabase(demo.db);

  check('a demo database carries the marker', await demoDatabaseMarked(demo.db));
  check('a production database does not', !(await demoDatabaseMarked(prod.db)));

  delete process.env['DEMO_INSTANCE'];
  check('env flag off by default', !demoEnvFlag());
  check(
    'no flag + no marker = off (an ordinary production instance)',
    !(await demoEnabled(prod.db)),
  );
  check(
    'no flag + marker = off (a demo database read by an ordinary process)',
    !(await demoEnabled(demo.db)),
  );

  process.env['DEMO_INSTANCE'] = 'true';
  // THE DANGEROUS DIRECTION. A process told it is the demo, pointed at the real
  // database. This is the mistake that would put a stranger in the real console,
  // and it is the one a single env flag could not catch.
  check(
    'flag + NO marker = OFF, so a misconfigured demo cannot open the real console',
    !(await demoEnabled(prod.db)),
  );
  check('flag + marker = on', await demoEnabled(demo.db));
  delete process.env['DEMO_INSTANCE'];

  section('2. The seed refuses a database that holds real content');

  const populated = await freshDb();
  await upsertMessage(populated.db, {
    groupId: 1,
    groupMsgId: 1,
    sharedMsgId: null,
    senderMemberId: 'member-real',
    senderDisplayName: 'A real member',
    sentAt: '2026-07-20T10:00:00Z',
    type: 'text',
    textBody: 'a real archived message',
    linksText: null,
    rawJson: {},
  });
  let refused = false;
  try {
    await markDemoDatabase(populated.db);
  } catch {
    refused = true;
  }
  check(
    'seeding refuses a database that already holds messages',
    refused,
    'the last line of defence against seeding production',
  );
  check('and it stays unmarked', !(await demoDatabaseMarked(populated.db)));

  section('3. The marker is not something a stray setting can produce');

  const nearMiss = await freshDb();
  await nearMiss.db.query(
    `INSERT INTO settings (key, value) VALUES ($1, to_jsonb($2::text))`,
    [DEMO_MARKER_KEY, 'true'],
  );
  check(
    "a truthy value in the marker key is NOT accepted",
    !(await demoDatabaseMarked(nearMiss.db)),
    'only the exact sentinel counts',
  );
  check(
    'the sentinel is long and unique enough not to occur by accident',
    DEMO_MARKER_VALUE.length > 30 && DEMO_MARKER_VALUE.includes('synthetic'),
  );

  section('4. Reset empties the archive but keeps the demo alive');

  const { resetDemoData } = await import('../src/demo/routes.js');
  await upsertMessage(demo.db, {
    groupId: 1,
    groupMsgId: 5,
    sharedMsgId: null,
    senderMemberId: 'demo-visitor',
    senderDisplayName: 'You',
    sentAt: '2026-07-20T10:00:00Z',
    type: 'text',
    textBody: 'something a visitor typed',
    linksText: null,
    rawJson: {},
  });
  await demo.db.query(
    `INSERT INTO consent (member_id, opted_in_at) VALUES ('demo-visitor', now())`,
  );
  const beforeReset = await demo.pg.query<{ n: number }>(
    'SELECT count(*)::int AS n FROM messages',
  );
  check('the visitor left something behind', (beforeReset.rows[0]?.n ?? 0) === 1);

  await resetDemoData({ db: demo.db } as never);

  const afterMsgs = await demo.pg.query<{ n: number }>('SELECT count(*)::int AS n FROM messages');
  const afterConsent = await demo.pg.query<{ n: number }>(
    'SELECT count(*)::int AS n FROM consent',
  );
  check('reset clears messages', (afterMsgs.rows[0]?.n ?? 0) === 0);
  check('reset clears consent', (afterConsent.rows[0]?.n ?? 0) === 0);
  check(
    'and the demo marker SURVIVES, so the demo does not disable itself',
    await demoDatabaseMarked(demo.db),
  );

  section('5. The session budget bounds a visitor');

  const { demoBudgetFor, clearDemoBudgets, SESSION_MESSAGE_BUDGET } = await import(
    '../src/demo/routes.js'
  );
  clearDemoBudgets();
  const b = demoBudgetFor('session-a');
  for (let i = 0; i < SESSION_MESSAGE_BUDGET; i++) b.used += 1;
  check(
    'a visitor reaches their budget',
    demoBudgetFor('session-a').used >= SESSION_MESSAGE_BUDGET,
    `${String(SESSION_MESSAGE_BUDGET)} messages`,
  );
  check(
    'and another visitor has their own',
    demoBudgetFor('session-b').used === 0,
    'budgets are per session, not global',
  );

  section('6. No free-form generation path is reachable');

  // Phase 1 constructs the engine with no `personalize`, so no model is consulted
  // at all. This asserts the source rather than the behaviour, because the
  // absence of a capability is what is being checked.
  const { readFile } = await import('node:fs/promises');
  const routes = await readFile('src/demo/routes.ts', 'utf8');
  check(
    'the demo engine is built without a model wording layer',
    !routes.includes('personalize:'),
  );
  check(
    'and the demo exposes no prompt, model or system-prompt parameter',
    !/\b(prompt|systemPrompt|model)\s*[:=]/.test(routes.replace(/\/\*[\s\S]*?\*\//g, '')),
  );

  console.log(
    `\n${failures === 0 ? 'ALL PASSED' : `${String(failures)} FAILURE(S)`} - public demo.`,
  );
  if (failures > 0) process.exitCode = 1;
}

main().catch((err: unknown) => {
  console.error(err);
  process.exitCode = 1;
});
