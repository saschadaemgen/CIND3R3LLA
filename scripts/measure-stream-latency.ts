/**
 * Where the activity stream's time goes, per query and per migration (CCB-S5-047).
 *
 * ── WHY IT BISECTS BY MIGRATION RATHER THAN BY COMMIT ────────────────────────
 *
 * The stream reads ONE view, `published_messages`, and that view is defined by whichever
 * migration last replaced it. Nothing in `src/` decides how expensive a page is; the WHERE
 * builder only adds predicates on top. So `git bisect` over commits would keep landing on the
 * same answer with more steps: the question is which VIEW DEFINITION costs what, and the
 * migration number is the exact axis for that.
 *
 * It applies migrations up to N against PGlite, seeds a realistic volume, and times the four
 * queries `/embed/:id` actually issues, each separately, so "the stream is slow" becomes a
 * number per query rather than a feeling.
 *
 * ── WHAT A PGlite NUMBER IS AND IS NOT ───────────────────────────────────────
 *
 * PGlite is real Postgres compiled to WASM, single-connection, with no shared buffers worth
 * the name. The ABSOLUTE milliseconds are not the operator's host and must not be quoted as
 * though they were (D-184). What transfers is the RATIO between two migration levels on the
 * same data and the same engine, and the shape of where the time sits. A ten-times regression
 * shows as a ten-times regression.
 *
 *   npx tsx scripts/measure-stream-latency.ts            (bisect 057 -> 062 -> head)
 *   npx tsx scripts/measure-stream-latency.ts 5000       (with a different row count)
 */

import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { FastifyInstance } from 'fastify';
import { PGlite } from '@electric-sql/pglite';
import { vector } from '@electric-sql/pglite-pgvector';
import { loadMigrationFiles } from '../src/db/migrate.js';
import type { Queryable } from '../src/db/pool.js';
import type { AdminConfig, Config } from '../src/config.js';
import { SettingsService } from '../src/settings/service.js';
import { SecurityService } from '../src/security/settings.js';
import { buildServer } from '../src/web/server.js';
import { createEmbedInstance } from '../src/db/embeds.js';
import {
  ARCHIVE_TYPES,
  latestPublishedImageId,
  listPublishedChannels,
  listPublishedIds,
  listPublishedItems,
} from '../src/db/public-archive.js';

const ROWS = Number(process.argv[2] ?? 4000);

/** The migration levels worth comparing: before the bridge, before 062, and today. */
const LEVELS = [57, 61, 62, 999];

interface Timing {
  label: string;
  ms: number;
}

async function timeIt<T>(label: string, fn: () => Promise<T>, out: Timing[]): Promise<T> {
  const started = performance.now();
  const value = await fn();
  out.push({ label, ms: Math.round((performance.now() - started) * 10) / 10 });
  return value;
}

function migrationNumber(name: string): number {
  return Number(name.slice(0, 3));
}

async function build(level: number): Promise<{ db: Queryable; applied: string }> {
  const pg = new PGlite({ extensions: { vector } });
  const db: Queryable = {
    async query(text, values) {
      const res = await pg.query(text, values ? [...values] : undefined);
      return {
        rows: res.rows as never[],
        rowCount: (res.affectedRows ?? res.rows.length) as number,
      };
    },
  };

  const all = await loadMigrationFiles();
  const chosen = all.filter((m) => migrationNumber(m.name) <= level);
  for (const m of chosen) await pg.exec(m.sql);

  // ── THE SEED ───────────────────────────────────────────────────────────────
  //
  // One consenting member and a spread of ordinary messages, because the members' half of
  // the stream is what a customer's embed is mostly made of. Written as raw SQL rather than
  // through `upsertMessage` so the volume can be built in one statement per batch: this is a
  // timing rig, and the write path is not what is being timed.
  await db.query(
    `INSERT INTO consent (member_id, opted_in_at, revoked_at)
     VALUES ('member-bench-0000000000', now() - interval '400 days', NULL)`,
    [],
  );
  const batch = 500;
  for (let start = 0; start < ROWS; start += batch) {
    const values: string[] = [];
    for (let i = start; i < Math.min(start + batch, ROWS); i++) {
      values.push(
        `(1, ${String(i + 1)}, NULL, 'member-bench-0000000000', 'Bench Member', now() - interval '${String(
          Math.floor(i / 8),
        )} hours', 'text', 'Bench message ${String(i)} about the archive and consent.', FALSE, 'none', '{}'::jsonb)`,
      );
    }
    await db.query(
      `INSERT INTO messages
         (group_id, group_msg_id, shared_msg_id, sender_member_id, sender_display_name, sent_at,
          type, text_body, deleted, moderation_state, raw_json)
       VALUES ${values.join(',')}`,
      [],
    );
  }

  return { db, applied: chosen[chosen.length - 1]?.name ?? 'none' };
}

/** The REAL Fastify server over this database, so the route can be timed as served. */
async function server(db: Queryable): Promise<{ app: FastifyInstance; base: string }> {
  const adminCfg: AdminConfig = {
    adminPort: 0,
    adminUsername: 'operator',
    adminPasswordHash: 'x',
    sessionSecret: 'measure-stream-session-secret-0123456789abcdef',
    publicOrigin: 'https://archive.example.test',
    rpId: 'archive.example.test',
    webauthnOrigin: 'https://archive.example.test',
    rpName: 'Cinderella',
  };
  const cfg = {
    botDisplayName: 'Cinderella',
    simplexDbPrefix: './state/simplex/cinderella',
    simplexFilesFolder: './state/files',
    groupName: 'bench',
    mediaRoot: mkdtempSync(join(tmpdir(), 'cinderella-bench-')),
    avatarPath: '',
    databaseUrl: 'postgres://x',
    logLevel: 'error',
  } as Config;
  const settings = await SettingsService.load(db, cfg.logLevel);
  const security = await SecurityService.load(db);
  const app = buildServer({ db, adminCfg, cfg, settings, security, mediaRoot: cfg.mediaRoot });
  await app.ready();
  const inst = await createEmbedInstance(db, 'Bench Community');
  return { app, base: `/embed/${inst.id}` };
}

async function measure(level: number): Promise<void> {
  const { db, applied } = await build(level);
  const types = [...ARCHIVE_TYPES];
  const filters = { page: 1, pageSize: 20 } as never;

  const timings: Timing[] = [];
  const page = await timeIt('listPublishedItems (count + page)', () => listPublishedItems(db, types, filters), timings);
  await timeIt('listPublishedIds (version hash)', () => listPublishedIds(db, types, filters), timings);
  await timeIt('latestPublishedImageId (og image)', () => latestPublishedImageId(db, types), timings);
  // Present only once the bridge exists; skipped below that so the rig runs at every level.
  if (level >= 57) {
    await timeIt(
      'listPublishedChannels (dropdown)',
      () => listPublishedChannels(db, types, 'stream'),
      timings,
    ).catch(() => timings.push({ label: 'listPublishedChannels (dropdown)', ms: -1 }));
  }

  const total = timings.reduce((s, t) => s + t.ms, 0);
  console.log(`\n  migrations <= ${String(level)}   (last applied: ${applied})`);
  console.log(`  ${String(page.total)} published rows of ${String(ROWS)} seeded`);
  for (const t of timings) {
    console.log(`    ${String(t.ms).padStart(8)} ms   ${t.label}`);
  }
  console.log(`    ${String(Math.round(total * 10) / 10).padStart(8)} ms   queries only`);

  // ── AND THE WHOLE ROUTE, WHICH IS THE THING THAT IS SLOW ───────────────────
  //
  // The four queries above are what the operator's hypothesis pointed at, and timing them
  // alone would have answered a question nobody asked. What a visitor waits for is the
  // ROUTE: instance lookup, the four queries, SEO resolution, and the render. This drives
  // the real Fastify server through `inject`, so everything between the request and the
  // bytes is inside the number, and the difference between it and the line above is the
  // part that is not the database.
  const { app, base } = await server(db);
  const routeTimes: number[] = [];
  for (let i = 0; i < 5; i++) {
    const started = performance.now();
    const res = await app.inject({ method: 'GET', url: base });
    routeTimes.push(performance.now() - started);
    if (res.statusCode !== 200) console.log(`    route returned ${String(res.statusCode)}`);
  }
  await app.close();
  const median = [...routeTimes].sort((a, b) => a - b)[2] ?? 0;
  console.log(
    `    ${String(Math.round(median * 10) / 10).padStart(8)} ms   GET /embed/:id end to end (median of 5)`,
  );
  console.log(
    `    ${String(Math.round((median - total) * 10) / 10).padStart(8)} ms   of which is NOT the four queries`,
  );
}

async function main(): Promise<void> {
  console.log(`\nSTREAM LATENCY BY MIGRATION LEVEL, ${String(ROWS)} seeded messages`);
  console.log('PGlite, single connection. Read the RATIO between levels, not the absolute ms.');
  for (const level of LEVELS) {
    try {
      await measure(level);
    } catch (error) {
      console.log(`\n  migrations <= ${String(level)}: FAILED - ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  console.log('');
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
