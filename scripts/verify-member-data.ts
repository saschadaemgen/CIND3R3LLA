/**
 * The member-data registry's structural sweep (CCB-S5-044, D-217): every table
 * that carries a member-identifying column is registered, with an honest class,
 * or this goes red.
 *
 * ── WHY A SWEEP AND NOT A LIST REVIEW ────────────────────────────────────────
 *
 * The registry exists so "what do you know about me" can one day be answered
 * honestly and deleted in parts. Both fail silently if a future capability adds
 * member data the registry never hears about - nothing announces a new table
 * (the D-105 shape). So the check derives the ground truth from
 * information_schema over ALL migrations applied to a real (PGlite) database,
 * and compares it with the registry both ways:
 *
 *   * a member-columned table missing from the registry: RED.
 *   * a registered table absent from the schema: RED (the registry lies).
 *   * a registered member column absent from its table: RED.
 *
 * Mutation-proven by creating an unregistered member table and re-sweeping.
 *
 *   npx tsx scripts/verify-member-data.ts
 */

import { PGlite } from '@electric-sql/pglite';
import { vector } from '@electric-sql/pglite-pgvector';
import { loadMigrationFiles } from '../src/db/migrate.js';
import {
  DISPLAY_NAME_ONLY_SOURCES,
  MEMBER_DATA_SOURCES,
  deletableCategories,
} from '../src/members/data-registry.js';
import { setLogLevel } from '../src/log.js';

let failures = 0;
function check(label: string, ok: boolean, detail = ''): void {
  if (!ok) failures++;
  console.log(`  [${ok ? 'PASS' : 'FAIL'}] ${label}${detail ? `: ${detail}` : ''}`);
}

/**
 * What counts as a member-identifying column. An ALLOW-LIST of shapes (D-201):
 * the wire-id columns, plus the two display-name columns the onboarding tables
 * use as their only person reference. `sender_display_name` and the like ride
 * on tables already caught by their id columns, so they add no rows here.
 */
const MEMBER_COLUMN_PATTERNS = [
  /^member_id$/,
  /^sender_member_id$/,
  /^simplex_member_id$/,
  /^group_member_id$/,
  /^requester_name$/,
  /^inviter_name$/,
];

async function sweep(pg: PGlite): Promise<Map<string, string[]>> {
  const res = await pg.query<{ table_name: string; column_name: string }>(
    `SELECT table_name, column_name
       FROM information_schema.columns
      WHERE table_schema = 'public'
      ORDER BY table_name, column_name`,
  );
  const hits = new Map<string, string[]>();
  for (const row of res.rows) {
    if (!MEMBER_COLUMN_PATTERNS.some((p) => p.test(row.column_name))) continue;
    const list = hits.get(row.table_name) ?? [];
    list.push(row.column_name);
    hits.set(row.table_name, list);
  }
  return hits;
}

async function main(): Promise<void> {
  setLogLevel('error');
  const pg = new PGlite({ extensions: { vector } });
  for (const m of await loadMigrationFiles()) await pg.exec(m.sql);

  console.log('\n1. Every member-columned table is registered');
  const hits = await sweep(pg);
  const registered = new Map(MEMBER_DATA_SOURCES.map((s) => [s.table, s] as const));
  const nameOnly = new Set(DISPLAY_NAME_ONLY_SOURCES);
  // Views expose the base tables' columns again; only base tables are the fence.
  const tables = await pg.query<{ table_name: string }>(
    `SELECT table_name FROM information_schema.tables
      WHERE table_schema = 'public' AND table_type = 'BASE TABLE'`,
  );
  const baseTables = new Set(tables.rows.map((r) => r.table_name));

  let unregistered = 0;
  for (const [table, cols] of hits) {
    if (!baseTables.has(table)) continue;
    if (registered.has(table) || nameOnly.has(table)) continue;
    unregistered++;
    console.log(`  [FAIL] ${table} carries ${cols.join(', ')} and is not in the registry`);
    failures++;
  }
  check('no member-columned base table is unregistered', unregistered === 0,
    `${String([...hits.keys()].filter((t) => baseTables.has(t)).length)} tables swept`);

  console.log('\n2. The registry does not lie about the schema');
  for (const s of MEMBER_DATA_SOURCES) {
    check(`${s.table} exists`, baseTables.has(s.table));
    const cols = hits.get(s.table) ?? [];
    const allCols = await pg.query<{ column_name: string }>(
      `SELECT column_name FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = $1`,
      [s.table],
    );
    const present = new Set(allCols.rows.map((r) => r.column_name));
    for (const c of s.memberColumns) {
      check(`  ${s.table}.${c} exists as registered`, present.has(c));
    }
    void cols;
  }

  console.log('\n3. The profile class holds its promises');
  const profile = MEMBER_DATA_SOURCES.filter((s) => s.class === 'profile');
  check('exactly one profile-class source today (the plays log)',
    profile.length === 1 && profile[0]?.table === 'cinderella_track_plays');
  const nullable = await pg.query<{ is_nullable: string }>(
    `SELECT is_nullable FROM information_schema.columns
      WHERE table_name = 'cinderella_track_plays' AND column_name = 'member_id'`,
  );
  check('its member column is NULLABLE, because anonymous is the pre-consent state',
    nullable.rows[0]?.is_nullable === 'YES');
  check('"music" is the one deletable category', JSON.stringify(deletableCategories()) === '["music"]');
  const retained = MEMBER_DATA_SOURCES.filter((s) => s.class === 'consent' || s.class === 'safety');
  check('every retained class states WHY it is retained',
    retained.every((s) => (s.retainedBecause ?? '').length > 10),
    `${String(retained.length)} sources`);

  console.log('\n4. MUTATION: an unregistered member table turns the sweep red');
  await pg.exec(
    `CREATE TABLE cinderella_sneaky_notes (
       id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
       member_id TEXT NOT NULL,
       note TEXT NOT NULL
     )`,
  );
  const mutated = await sweep(pg);
  const caught = [...mutated.keys()].some(
    (t) => t === 'cinderella_sneaky_notes' && !registered.has(t) && !nameOnly.has(t),
  );
  check('the sweep finds the table nobody registered', caught);
  await pg.exec(`DROP TABLE cinderella_sneaky_notes`);
  const restored = await sweep(pg);
  check('POSITIVE CONTROL: dropped again, the sweep is clean again',
    ![...restored.keys()].includes('cinderella_sneaky_notes'));

  await pg.close();
  console.log(
    failures === 0
      ? '\nAll member-data checks passed: what she could ever know about a member is enumerable, classed, and cannot grow in silence.'
      : `\n${String(failures)} CHECK(S) FAILED`,
  );
  if (failures > 0) process.exit(1);
}

await main();
