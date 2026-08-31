/**
 * The retention bound on re-hosted bridge media (CCB-S5-064, D-262).
 *
 * Real PGlite over the full migration set, real files in a temp tree, the real sweep, and
 * the real console routes. The guarantees, each with the positive control that stops it
 * passing vacuously:
 *
 *   - a file past the bound whose announcement is OVER is swept: the bytes unlinked, the
 *     row tombstoned 'swept' with mime and size kept (D-240's shape);
 *   - a STANDING announcement's file is never swept, however old, because a repeat reads
 *     the file when it sends;
 *   - a published announcement loses NOTHING: the archived row, its publication and its
 *     place in `published_messages` are byte-identical across a sweep (the file itself is
 *     never published - established in stage 0 and re-proven here as text-only);
 *   - orphaned files (rows cascaded away with nothing unlinking the bytes) are swept by
 *     age; young orphans are kept;
 *   - the count the operator reads is the count the sweep acts on;
 *   - shipped OFF: with retention disabled nothing is deleted, whatever the counts say;
 *   - the once-per-local-day gate holds, and a manual sweep counts as the day's sweep;
 *   - a stored path outside the root is a counted, surfaced failure, never followed;
 *   - the 077 CHECK makes a swept row still holding a path unrepresentable.
 *
 * The load-bearing mutation is run against the SOURCE in the close-out (the terminal-state
 * clause neutered turns the standing-post check red); in-script, the same clause is proven
 * load-bearing by running the predicate's twin without it and showing it would have
 * selected the standing announcement's file.
 *
 *   npx tsx scripts/verify-bridge-retention.ts
 */

import { mkdtempSync, mkdirSync, writeFileSync, existsSync, utimesSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { vector } from '@electric-sql/pglite-pgvector';
import argon2 from 'argon2';
import type { Queryable } from '../src/db/pool.js';
import { loadMigrationFiles } from '../src/db/migrate.js';
import {
  upsertBridgeChannel,
  insertBridgePost,
  resolveBridgePost,
  setPostMedia,
} from '../src/plugins/channel-bridge/store.js';
import {
  BRIDGE_RETENTION_MARKER_KEY,
  countOrphanBridgeMedia,
  countSweepableBridgeMedia,
  listOrphanBridgeFiles,
  localDay,
  maybeSweepBridgeMedia,
  retentionCutoff,
  sweepBridgeMedia,
} from '../src/plugins/channel-bridge/media-retention.js';
import { insertBotMessage } from '../src/db/bot-messages.js';
import {
  ensureChannelPublication,
  setChannelPublication,
} from '../src/plugins/channel-bridge/publication.js';
import { channelKeyFor } from '../src/plugins/channel-bridge/origin.js';
import { getSetting, setSetting } from '../src/db/settings.js';
import { normalizeChannelBridgeSettings } from '../src/plugins/channel-bridge/settings.js';
import { buildServer, registerNav } from '../src/web/server.js';
import { registerAdminViews } from '../src/web/views/index.js';
import { SettingsService } from '../src/settings/service.js';
import { SecurityService } from '../src/security/settings.js';
import { PluginService } from '../src/plugins/service.js';
import type { AdminConfig, Config } from '../src/config.js';
import { setLogLevel } from '../src/log.js';

let failures = 0;
function check(label: string, ok: boolean, detail = ''): void {
  if (!ok) failures++;
  console.log(`  [${ok ? 'PASS' : 'FAIL'}] ${label}${detail ? `: ${detail}` : ''}`);
}

const DAY = 24 * 60 * 60 * 1000;
const OPERATOR = 'operator';
const PASSWORD = 'correct-horse-battery-staple';

async function main(): Promise<void> {
  setLogLevel('error');
  process.env['SESSION_SECRET'] ??= 'bridge-retention-secret-0123456789abcdef012345';

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
  for (const migration of await loadMigrationFiles()) await pg.exec(migration.sql);

  const root = mkdtempSync(join(tmpdir(), 'bridge-retention-'));
  mkdirSync(join(root, '1'), { recursive: true });
  const now = new Date();
  const old = new Date(now.getTime() - 40 * DAY);
  const young = new Date(now.getTime() - 2 * DAY);

  /* ── 1. The schema refuses a half-swept row ─────────────────────────────── */

  console.log('\n1. A tombstone still holding content is unrepresentable');

  const bot = await db.query<{ id: string }>(
    `INSERT INTO cinderella_bot_profiles (slug, display_name, enabled)
     VALUES ('bridge-bot', 'BridgeBot', TRUE) RETURNING id`,
  );
  const BOT = Number(bot.rows[0]?.id);
  const SRC = 42;
  await upsertBridgeChannel(db, {
    botProfileId: BOT,
    sourceGroupId: SRC,
    channelName: 'Announcements',
    link: 'https://simplex.chat/contact#/example-channel-link',
  });

  const mk = async (item: number, postedAt: Date, text: string): Promise<number> =>
    (
      await insertBridgePost(db, {
        botProfileId: BOT,
        sourceGroupId: SRC,
        sharedMsgId: `shared-${String(item)}`,
        itemId: item,
        text,
        postedAt,
      })
    ).id;

  const probe = await mk(999, old, 'schema probe');
  let refused = '';
  try {
    await db.query(
      `UPDATE cinderella_bridge_posts SET media_state = 'swept', media_path = '/x' WHERE id = $1`,
      [probe],
    );
  } catch (err) {
    refused = err instanceof Error ? err.message : String(err);
  }
  check('a swept row with a path is refused by the schema', refused.includes('swept_pathless'), refused.slice(0, 70));
  check(
    "and 'swept' itself is an accepted state",
    await db
      .query(`UPDATE cinderella_bridge_posts SET media_state = 'swept' WHERE id = $1`, [probe])
      .then(() => true)
      .catch(() => false),
  );

  /* ── 2. The sweep, operated on real files ───────────────────────────────── */

  console.log('\n2. Past the bound and finished: swept. Standing, young, or published: untouched.');

  const fileFor = (name: string, mtime: Date): string => {
    const p = join(root, '1', name);
    writeFileSync(p, `bytes of ${name}`);
    utimesSync(p, mtime, mtime);
    return p;
  };

  // (a) old + terminally resolved -> sweepable.
  const doneOld = await mk(1, old, 'finished announcement');
  const doneOldFile = fileFor('1-done-old.jpg', old);
  await setPostMedia(db, doneOld, { state: 'stored', path: doneOldFile, mime: 'image/jpeg', size: 20 });
  await resolveBridgePost(db, doneOld, 'completed', false, null);

  // (b) old + STANDING (unresolved) -> never swept.
  const standing = await mk(2, old, 'standing announcement');
  const standingFile = fileFor('2-standing.jpg', old);
  await setPostMedia(db, standing, { state: 'stored', path: standingFile, mime: 'image/jpeg', size: 21 });

  // (c) young + resolved -> not yet.
  const doneYoung = await mk(3, young, 'recently finished');
  const doneYoungFile = fileFor('3-done-young.jpg', young);
  await setPostMedia(db, doneYoung, { state: 'stored', path: doneYoungFile, mime: 'image/jpeg', size: 22 });
  await resolveBridgePost(db, doneYoung, 'completed', false, null);

  // (d) old + source-deleted (no resolution) -> sweepable: deletion is terminal too.
  const deletedOld = await mk(4, old, 'withdrawn at the source');
  const deletedOldFile = fileFor('4-deleted-old.jpg', old);
  await setPostMedia(db, deletedOld, { state: 'stored', path: deletedOldFile, mime: 'image/jpeg', size: 23 });
  await db.query(`UPDATE cinderella_bridge_posts SET deleted_at = $2 WHERE id = $1`, [deletedOld, old]);

  // (e/f) orphans: files no row references, one old, one young, both in the shape the
  // intake writes (<botId>/<postId>-<name>), because only that shape is the sweep's to
  // delete.
  const orphanOld = fileFor('500-orphan-old.bin', old);
  const orphanYoung = fileFor('501-orphan-young.bin', young);

  // The published announcement (ground rule 4): the channel publishes, the archived row is
  // hers, text-only, and it must be byte-identical across the sweep.
  const channelKey = channelKeyFor('https://simplex.chat/contact#/example-channel-link', BOT, SRC);
  await ensureChannelPublication(db, channelKey, 'Announcements');
  await setChannelPublication(db, channelKey, { publish: true }, OPERATOR);
  const msgId = await insertBotMessage(db, {
    groupId: 7,
    groupMsgId: 700,
    sharedMsgId: 'announce-1',
    senderMemberId: 'bot-member-1',
    senderDisplayName: 'BridgeBot',
    sentAt: old.toISOString(),
    text: 'finished announcement',
    category: 'bridge',
    lang: 'en',
    searchBody: 'finished announcement',
    mentions: [],
    replyToId: null,
    bridgeChannelKey: channelKey,
    bridgeChannelName: 'Announcements',
    rawJson: {},
  });
  const publishedBefore = await db.query(
    `SELECT * FROM published_messages WHERE id = $1`,
    [msgId],
  );
  check(
    'POSITIVE CONTROL: the announcement IS published before the sweep',
    publishedBefore.rows.length === 1,
  );
  check(
    'and it is text-only, which is what makes the simplified rule safe',
    (publishedBefore.rows[0] as { media_path: string | null } | undefined)?.media_path === null,
  );

  const DAYS = 30;
  const counted = await countSweepableBridgeMedia(db, retentionCutoff(now, DAYS));
  check('the count the operator reads first says 2', counted.rows === 2, String(counted.rows));

  const orphanCount = await countOrphanBridgeMedia(db, root, retentionCutoff(now, DAYS));
  check(
    'and the orphan count says 2 on disk, 1 past the bound',
    orphanCount.files === 2 && orphanCount.pastBound === 1,
    `${String(orphanCount.files)} / ${String(orphanCount.pastBound)}`,
  );

  const report = await sweepBridgeMedia({ db, root, now, days: DAYS });
  check('the sweep swept exactly the counted rows', report.sweptRows === counted.rows, String(report.sweptRows));
  check('and exactly the aged orphan', report.sweptOrphans === 1, String(report.sweptOrphans));
  check('with no failures', report.failures === 0, String(report.failures));

  check('(a) the finished old file is GONE', !existsSync(doneOldFile));
  check('(d) the withdrawn old file is GONE', !existsSync(deletedOldFile));
  check('(e) the aged orphan is GONE', !existsSync(orphanOld));
  check('(b) the STANDING announcement keeps its file', existsSync(standingFile));
  check('(c) the recently finished one keeps its file', existsSync(doneYoungFile));
  check('(f) the young orphan is kept', existsSync(orphanYoung));

  const sweptRow = await db.query<{ media_state: string; media_path: string | null; media_mime: string | null; media_size: string | null }>(
    `SELECT media_state, media_path, media_mime, media_size FROM cinderella_bridge_posts WHERE id = $1`,
    [doneOld],
  );
  check(
    "the swept row is a tombstone: state 'swept', no path, mime and size kept",
    sweptRow.rows[0]?.media_state === 'swept' &&
      sweptRow.rows[0]?.media_path === null &&
      sweptRow.rows[0]?.media_mime === 'image/jpeg' &&
      Number(sweptRow.rows[0]?.media_size) === 20,
  );
  check(
    'and the count is now zero, so a tombstone is never counted again',
    (await countSweepableBridgeMedia(db, retentionCutoff(now, DAYS))).rows === 0,
  );

  const publishedAfter = await db.query(`SELECT * FROM published_messages WHERE id = $1`, [msgId]);
  check(
    'NOTHING PUBLISHED WAS LOST: the announcement is still published, identically',
    publishedAfter.rows.length === 1 &&
      JSON.stringify(publishedAfter.rows[0]) === JSON.stringify(publishedBefore.rows[0]),
  );

  /* ── 3. The clause that keeps a standing announcement alive is load-bearing ── */

  console.log('\n3. The terminal-state clause is what spares the standing file');

  const mutated = await db.query<{ id: string }>(
    // The predicate's twin with the terminal-state clause removed: the shipped defect
    // reconstructed as a query. It selects the STANDING post, which is exactly what the
    // sweep must never do, so check (b) above is what stands between this mutation and a
    // live announcement losing its picture mid-lifecycle.
    `SELECT id FROM cinderella_bridge_posts
      WHERE media_state = 'stored' AND media_path IS NOT NULL AND posted_at < $1`,
    [retentionCutoff(now, DAYS)],
  );
  check(
    'MUTATION TWIN: without the clause, the standing announcement would be selected',
    mutated.rows.some((r) => Number(r.id) === standing),
  );

  /* ── 4. Shipped off, and the daily gate ─────────────────────────────────── */

  console.log('\n4. Off means off, and a day has one sweep');

  const standing2File = fileFor('5-standing2.jpg', old);
  const standing2 = await mk(5, old, 'second finished announcement');
  await setPostMedia(db, standing2, { state: 'stored', path: standing2File, mime: 'image/jpeg', size: 24 });
  await resolveBridgePost(db, standing2, 'completed', false, null);

  check(
    'disabled: maybeSweep does nothing and says so',
    (await maybeSweepBridgeMedia({ db, root, retention: { enabled: false, days: DAYS }, now })) ===
      null && existsSync(standing2File),
  );
  check(
    'the shipped default IS disabled',
    normalizeChannelBridgeSettings({}).mediaRetentionEnabled === false &&
      normalizeChannelBridgeSettings({}).mediaRetentionDays === 30,
  );

  const first = await maybeSweepBridgeMedia({
    db,
    root,
    retention: { enabled: true, days: DAYS },
    now,
  });
  check('enabled: the daily pass sweeps', first !== null && first.sweptRows === 1 && !existsSync(standing2File));
  check(
    'a second pass the same day does nothing',
    (await maybeSweepBridgeMedia({ db, root, retention: { enabled: true, days: DAYS }, now })) ===
      null,
  );
  const tomorrow = new Date(now.getTime() + DAY);
  const second = await maybeSweepBridgeMedia({
    db,
    root,
    retention: { enabled: true, days: DAYS },
    now: tomorrow,
  });
  check('the next local day sweeps again (nothing left, but it RAN)', second !== null && second.sweptRows === 0);
  check(
    'and the marker records the day',
    (await getSetting(db, BRIDGE_RETENTION_MARKER_KEY)) === localDay(tomorrow),
  );

  /* ── 5. A path outside the root is refused, loudly ──────────────────────── */

  console.log('\n5. Containment: a stored path outside the root is never followed');

  const outside = join(tmpdir(), `bridge-retention-outside-${String(Date.now())}.bin`);
  writeFileSync(outside, 'outside bytes');
  utimesSync(outside, old, old);
  const escapee = await mk(6, old, 'row pointing outside the root');
  await setPostMedia(db, escapee, { state: 'stored', path: outside, mime: 'image/jpeg', size: 25 });
  await resolveBridgePost(db, escapee, 'completed', false, null);

  const contained = await sweepBridgeMedia({ db, root, now, days: DAYS });
  check('the sweep counts it as a failure', contained.failures === 1, String(contained.failures));
  check('the file outside the root is untouched', existsSync(outside));
  check(
    'and the row is NOT tombstoned, so it stays visible instead of vanishing into a lie',
    (
      await db.query<{ media_state: string }>(
        `SELECT media_state FROM cinderella_bridge_posts WHERE id = $1`,
        [escapee],
      )
    ).rows[0]?.media_state === 'stored',
  );
  // Repaired for the console section: point it back inside the root.
  const repaired = fileFor('6-repaired.jpg', old);
  await setPostMedia(db, escapee, { state: 'stored', path: repaired, mime: 'image/jpeg', size: 25 });

  /* ── 6. The console: count first, shipped off, operated ─────────────────── */

  console.log('\n6. The Retention page, driven through its real routes');

  const adminCfg: AdminConfig = {
    adminPort: 8798,
    adminUsername: OPERATOR,
    adminPasswordHash: await argon2.hash(PASSWORD, { type: argon2.argon2id }),
    sessionSecret: 'bridge-retention-session-secret-0123456789abcd',
    publicOrigin: 'https://admin.example.org',
    rpId: 'admin.example.org',
    webauthnOrigin: 'https://admin.example.org',
    rpName: 'Cinderella Admin',
  };
  const cfg = {
    botDisplayName: 'CIND3R3LLA',
    simplexDbPrefix: './state/simplex/c',
    simplexFilesFolder: './state/files',
    groupName: 'archive',
    mediaRoot: process.cwd(),
    bridgeMediaRoot: root,
    quarantineRoot: './state/quarantine',
    backupStatusPath: './state/backup-status.json',
    backupRequestPath: './state/backup-request',
    backupProgressPath: './state/backup-progress.json',
    avatarPath: '',
    databaseUrl: 'postgres://placeholder@127.0.0.1:5432/x',
    logLevel: 'error',
  } as unknown as Config;

  registerNav();
  const plugins = PluginService.withDefaults(db);
  const app = buildServer({
    db,
    adminCfg,
    mediaRoot: cfg.mediaRoot,
    settings: await SettingsService.load(db, 'error'),
    security: await SecurityService.load(db),
    cfg,
    plugins,
    registerViews: registerAdminViews,
  });
  await app.ready();

  const cookieOf = (setCookie: string | string[] | undefined, name: string): string => {
    const all = setCookie === undefined ? [] : Array.isArray(setCookie) ? setCookie : [setCookie];
    for (const one of all) if (one.startsWith(`${name}=`)) return one.split(';')[0] ?? '';
    return '';
  };
  const loginPage = await app.inject({ method: 'GET', url: '/login' });
  const loginToken = /name="_csrf" value="([a-f0-9]{64})"/.exec(loginPage.body)?.[1] ?? '';
  const login = await app.inject({
    method: 'POST',
    url: '/login',
    payload: { username: OPERATOR, password: PASSWORD, _csrf: loginToken },
    headers: { cookie: cookieOf(loginPage.headers['set-cookie'], 'cinderella_login_csrf') },
  });
  const session = cookieOf(login.headers['set-cookie'], 'cinderella_session');
  check('the harness can sign in', session !== '', String(login.statusCode));

  const get = (url: string): Promise<{ statusCode: number; body: string }> =>
    app.inject({ method: 'GET', url, headers: { cookie: session } });
  const pageBefore = await get('/bridge/retention');
  const csrf = /name="_csrf" value="([a-f0-9]{64})"/.exec(pageBefore.body)?.[1] ?? '';
  const post = (url: string, payload: Record<string, string>): Promise<{ statusCode: number }> =>
    app.inject({
      method: 'POST',
      url,
      headers: { cookie: session, 'content-type': 'application/x-www-form-urlencoded' },
      payload: new URLSearchParams({ ...payload, _csrf: csrf }).toString(),
    }) as never;

  check('the page renders', pageBefore.statusCode === 200, String(pageBefore.statusCode));
  check(
    'the COUNT comes with the page, before any switch is touched',
    pageBefore.body.includes('What a sweep would delete, right now'),
  );
  // The number the OPERATOR reads is the number the database counts - asserted against
  // the page's own HTML, not against the function both sides share (the reviewed
  // constant-to-itself gap).
  const dbCount = await countSweepableBridgeMedia(db, retentionCutoff(new Date(), 30));
  const pageTile = /(\d+)\s*<\/p>\s*<p class="text-slate-600">\s*file\(s\) past the bound/.exec(
    pageBefore.body.replace(/\n/g, ' '),
  );
  check(
    'the rendered count equals the counted count',
    Number(pageTile?.[1]) === dbCount.rows,
    `page=${pageTile?.[1] ?? '?'} db=${String(dbCount.rows)}`,
  );
  check(
    'it says the sweep is off, which is how it ships',
    pageBefore.body.includes('The sweep is off, which is how it ships.'),
  );
  check(
    'no sweep control is offered while it is off',
    !pageBefore.body.includes('/bridge/retention/sweep'),
  );
  check(
    'the recorded reasoning is on the page: relays, text-only, and the future exception',
    pageBefore.body.includes('relays expire their own copies in about') &&
      pageBefore.body.includes('No bridge file is ever published') &&
      pageBefore.body.includes('worse than a full disk'),
  );
  check(
    'a sweep while off is refused with the reason',
    (await post('/bridge/retention/sweep', {})).statusCode === 302 &&
      existsSync(repaired),
  );

  const enabled = await post('/bridge/retention/settings', {
    mediaRetentionEnabled: 'on',
    mediaRetentionDays: '30',
  });
  check('the settings save', enabled.statusCode === 302);
  check(
    'and are read back enabled',
    plugins.channelBridgeSettings().mediaRetentionEnabled === true,
  );

  const armedPage = await get('/bridge/retention');
  check('the sweep control appears once it is on', armedPage.body.includes('/bridge/retention/sweep'));

  const swept = await post('/bridge/retention/sweep', {});
  check('Sweep now runs', swept.statusCode === 302);
  check('and the repaired old file is gone', !existsSync(repaired));
  check(
    "a manual sweep counts as the day's sweep: the daily pass then declines",
    (await maybeSweepBridgeMedia({
      db,
      root,
      retention: { enabled: true, days: DAYS },
      now: new Date(),
    })) === null,
  );
  const pageAfter = await get('/bridge/retention');
  check(
    'the page reads back the swept state',
    /(\d+) swept so far/.test(pageAfter.body) &&
      Number(/(\d+) swept so far/.exec(pageAfter.body)?.[1]) >= 3,
  );
  check(
    'the standing announcement STILL keeps its file, through every sweep this file ran',
    existsSync(standingFile),
  );

  // Saving with the checkbox absent switches it off explicitly.
  await post('/bridge/retention/settings', { mediaRetentionDays: '30' });
  check(
    'saving without the checkbox turns it off',
    plugins.channelBridgeSettings().mediaRetentionEnabled === false,
  );

  await app.close();

  /* ── 7. The orphan walk never eats a referenced file, and only eats bridge shapes ── */

  console.log('\n7. The orphan pass: referenced excluded, foreign shapes untouchable');

  const countNow = await countOrphanBridgeMedia(db, root, retentionCutoff(now, DAYS));
  check(
    'the standing file is not an orphan while its row references it',
    existsSync(standingFile) && countNow.pastBound === 0,
    `pastBound=${String(countNow.pastBound)}`,
  );

  // Foreign files: a nested tree and a loose note, both old, both NOT bridge-shaped.
  // The reviewed hazard: deletion-by-exclusion would have eaten any tree living under
  // the root. The sweep must leave both alone and still sweep a real bridge-shaped orphan.
  mkdirSync(join(root, 'nested-tree', 'deep'), { recursive: true });
  const foreignDeep = join(root, 'nested-tree', 'deep', 'member-original.bin');
  writeFileSync(foreignDeep, 'not the bridge’s to delete');
  utimesSync(foreignDeep, old, old);
  const foreignLoose = join(root, 'notes.txt');
  writeFileSync(foreignLoose, 'also not the bridge’s');
  utimesSync(foreignLoose, old, old);
  const shapedOrphan = join(root, '1', '777-shaped-orphan.jpg');
  writeFileSync(shapedOrphan, 'a real bridge orphan');
  utimesSync(shapedOrphan, old, old);

  check(
    'the count refuses to count foreign files as sweepable',
    (await countOrphanBridgeMedia(db, root, retentionCutoff(now, DAYS))).pastBound === 1,
  );
  const foreignRun = await sweepBridgeMedia({ db, root, now, days: DAYS });
  check('the sweep deleted exactly the bridge-shaped orphan', foreignRun.sweptOrphans === 1);
  check('the shaped orphan is gone', !existsSync(shapedOrphan));
  check('the nested foreign tree is UNTOUCHED', existsSync(foreignDeep));
  check('and the loose foreign file too', existsSync(foreignLoose));
  check(
    'the standing announcement still keeps its file, after every sweep in this harness',
    existsSync(standingFile),
  );

  /* ── 8. Canonical comparison: a re-spelled stored path is still not an orphan ── */

  console.log('\n8. A referenced file is recognised whatever the spelling names it by');

  if (process.platform === 'win32') {
    // The reviewed defect: lexical resolve() made a differently-CASED spelling of the
    // same file look unreferenced, and the walk then ate it. Store the standing file's
    // path with a lower-cased drive letter and prove the walk still matches it.
    const respelled = standingFile.charAt(0).toLowerCase() + standingFile.slice(1);
    await db.query(`UPDATE cinderella_bridge_posts SET media_path = $2 WHERE id = $1`, [
      standing,
      respelled,
    ]);
    const casing = await sweepBridgeMedia({ db, root, now, days: DAYS });
    check(
      'a case-respelled referenced file is not swept as an orphan',
      existsSync(standingFile) && casing.sweptOrphans === 0,
    );
    await db.query(`UPDATE cinderella_bridge_posts SET media_path = $2 WHERE id = $1`, [
      standing,
      standingFile,
    ]);
  } else {
    check('(case-respelling is a win32 concern; canonicalisation covered by realpath)', true);
  }

  // The tripwire: rows referencing paths under a spelling the walk cannot match at all
  // (a moved mount simulated by pointing every row at a nonexistent sibling root) must
  // SKIP the orphan pass rather than eat everything.
  const agedBait = join(root, '1', '888-bait.jpg');
  writeFileSync(agedBait, 'bait the tripwire must protect');
  utimesSync(agedBait, old, old);
  const movedRoot = join(dirname(root), 'moved-elsewhere');
  await db.query(
    `UPDATE cinderella_bridge_posts SET media_path = REPLACE(media_path, $1, $2)
      WHERE media_path IS NOT NULL`,
    [root, movedRoot],
  );
  const tripped = await sweepBridgeMedia({ db, root, now, days: DAYS });
  check(
    'TRIPWIRE: when no stored path matches the walked root, the orphan pass is skipped',
    tripped.sweptOrphans === 0 && existsSync(agedBait) && tripped.failures >= 1,
  );
  await db.query(`UPDATE cinderella_bridge_posts SET media_path = $2 WHERE id = $1`, [
    standing,
    standingFile,
  ]);

  console.log(
    failures === 0
      ? '\nAll bridge-retention checks passed.'
      : `\n${String(failures)} bridge-retention check(s) FAILED.`,
  );
  process.exit(failures === 0 ? 0 : 1);
}

await main();
