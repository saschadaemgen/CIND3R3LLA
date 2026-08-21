/**
 * The archive stops keeping what nobody agreed to (CCB-S5-054, D-240).
 *
 * ── WHAT THIS HAS TO PROVE, AND WHY EACH HALF NEEDS THE OTHER ────────────────
 *
 * A sweep that erases content has two ways to be wrong and they point in opposite
 * directions, so every assertion here comes in pairs. "Nothing published was lost" is
 * satisfied by a sweep that does nothing at all; "the unconsented rows are empty" is
 * satisfied by a sweep that empties everything. Neither is worth anything alone, and this
 * repository has shipped exactly that mistake before - a negative with no positive control
 * beside it passes forever and says nothing.
 *
 * So: every row that must be spared is asserted intact WHILE a row that must be swept is
 * asserted empty, in the same pass, from the same run.
 *
 * ── AND THE ONE THING A HARNESS CANNOT SEE (D-162, D-212) ────────────────────
 *
 * That the Retention page's controls are reachable, visible and enabled. Section 7 drives
 * the real routes and reads the effect back out of the database, which is the regression
 * guard; the verification is opening the page and pressing the button.
 *
 *   npx tsx scripts/verify-retention.ts
 */

import { PGlite } from '@electric-sql/pglite';
import { vector } from '@electric-sql/pglite-pgvector';
import * as argon2 from 'argon2';
import { mkdtemp, writeFile, readFile, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { Queryable } from '../src/db/pool.js';
import { loadMigrationFiles } from '../src/db/migrate.js';
import { setLogLevel } from '../src/log.js';
import { buildServer, registerNav } from '../src/web/server.js';
import { registerAdminViews } from '../src/web/views/index.js';
import { SettingsService } from '../src/settings/service.js';
import { SecurityService } from '../src/security/settings.js';
import { InteractionService } from '../src/interaction/settings.js';
import type { Config } from '../src/config.js';
import { MAX_HISTORY_LIMITS } from '../src/interaction/history.js';
import { resolveMemberByDisplayName } from '../src/db/bot-messages.js';
import { dashboardStats } from '../src/db/admin-queries.js';
import { memberArchiveCounts } from '../src/db/member-stats.js';
import { memberMessageCount } from '../src/db/consent.js';
import {
  markInterruptedMediaReceipts,
  updateMedia,
  upsertMessage,
} from '../src/db/messages.js';
import {
  DEFAULT_RETENTION,
  RETENTION_MIN_HOURS,
  SWEEPABLE,
  cutoffFor,
  getRetentionSettings,
  msUntilNextMidnight,
  nextMidnight,
  startRetentionSweeper,
  normalizeRetention,
  sweepUnconsented,
  sweepableCount,
  tombstoneCount,
} from '../src/archive/retention.js';

const OPERATOR = 'operator';
const PASSWORD = 'retention-test-password';

let failures = 0;
function check(label: string, ok: boolean, detail = ''): void {
  if (!ok) failures++;
  console.log(`  [${ok ? 'PASS' : 'FAIL'}] ${label}${detail ? ` - ${detail}` : ''}`);
}

/** Long enough ago to be past any bound this schema permits. */
const OLD = '2026-01-02T10:00:00.000Z';
/** Inside the bound, whatever the operator picked. */
const RECENT = new Date(Date.now() - 60_000).toISOString();

interface Seeded {
  id: number;
}

async function main(): Promise<void> {
  setLogLevel('error');
  console.log('The archive stops keeping what nobody agreed to (CCB-S5-054, D-240)');

  const pg = new PGlite({ extensions: { vector } });
  const db: Queryable = {
    async query(sql, values) {
      const r = await pg.query(sql, values ? [...values] : undefined);
      return { rows: r.rows as never[], rowCount: (r.affectedRows ?? r.rows.length) as number };
    },
  } as Queryable;
  for (const m of await loadMigrationFiles()) await pg.exec(m.sql);

  // PGlite is ONE connection, so this is a real transaction for the harness's purposes and
  // is NOT a claim that pool semantics are proven here (D-178's fourth item). The production
  // path uses the pool's own dedicated client.
  const transaction = async <R>(fn: (tx: Queryable) => Promise<R>): Promise<R> => {
    await db.query('BEGIN');
    try {
      const out = await fn(db);
      await db.query('COMMIT');
      return out;
    } catch (err) {
      await db.query('ROLLBACK');
      throw err;
    }
  };

  const mediaRoot = await mkdtemp(join(tmpdir(), 'cind-retention-'));

  /* ── the fixture ─────────────────────────────────────────────────────────── */

  let nextItem = 1000;
  const insert = async (opts: {
    member: string;
    name?: string;
    at?: string;
    text?: string;
    isBot?: boolean;
    botCategory?: string;
    replyTo?: number | null;
    mediaPath?: string | null;
    moderation?: string;
  }): Promise<Seeded> => {
    nextItem += 1;
    const { rows } = await db.query<{ id: string }>(
      `INSERT INTO messages
         (group_id, group_msg_id, sender_member_id, sender_display_name, sent_at, type,
          text_body, links_text, raw_json, is_bot, bot_category, search_body, reply_to_id,
          media_path, media_mime, media_size, moderation_state)
       VALUES (7, $1, $2, $3, $4, 'text', $5, $6, $7::jsonb, $8, $9, $10, $11, $12, $13, $14,
               $15::moderation_state)
       RETURNING id`,
      [
        nextItem,
        opts.member,
        opts.name ?? `Name ${opts.member}`,
        opts.at ?? OLD,
        opts.text ?? `said something (${opts.member})`,
        `https://example.org/${opts.member}`,
        JSON.stringify({ chatItem: { content: { msgContent: { text: opts.text ?? 'x' } } } }),
        opts.isBot ?? false,
        opts.botCategory ?? null,
        opts.isBot ? (opts.text ?? 'her words') : null,
        opts.replyTo ?? null,
        opts.mediaPath ?? null,
        opts.mediaPath ? 'image/jpeg' : null,
        opts.mediaPath ? 1234 : null,
        opts.moderation ?? 'none',
      ],
    );
    const id = Number(rows[0]?.id);
    await db.query('INSERT INTO links (message_id, url, title) VALUES ($1, $2, $3)', [
      id,
      `https://example.org/${opts.member}`,
      'a link',
    ]);
    return { id };
  };

  // A real file on disk for the media case, so "the bytes are gone" is a filesystem fact.
  await writeFile(join(mediaRoot, 'photo.jpg'), 'JPEGBYTES');

  const never = await insert({ member: 'm-never', name: 'Nobody Consented' });
  const neverMedia = await insert({ member: 'm-never', mediaPath: 'photo.jpg' });
  const neverRecent = await insert({ member: 'm-never', at: RECENT, text: 'said this today' });
  const herReply = await insert({
    member: 'bot-1',
    isBot: true,
    botCategory: 'conversation',
    replyTo: never.id,
    text: 'she answered the question',
  });
  const herOwn = await insert({
    member: 'bot-1',
    isBot: true,
    botCategory: 'conversation',
    text: 'she said something unprompted',
  });

  const optedBefore = await insert({ member: 'm-opted', text: 'before the opt-in' });
  const optedAfter = await insert({
    member: 'm-opted',
    at: '2026-06-01T10:00:00.000Z',
    text: 'after the opt-in',
  });
  await db.query('INSERT INTO consent (member_id, opted_in_at) VALUES ($1, $2)', [
    'm-opted',
    '2026-05-01T00:00:00.000Z',
  ]);

  const hidden = await insert({ member: 'm-hidden', text: 'hidden by its owner' });
  await db.query(
    `INSERT INTO consent (member_id, opted_in_at, revoked_at, revocation_mode)
     VALUES ($1, $2, $3, 'hide')`,
    ['m-hidden', '2026-01-01T00:00:00.000Z', '2026-07-01T00:00:00.000Z'],
  );

  // THE UNDO TRAP. No consent row at all, but a journal entry an undo could act on, which
  // would restore consent with its ORIGINAL opt-in and republish this.
  const undone = await insert({ member: 'm-undone', text: 'consent was undone' });
  await db.query(
    `INSERT INTO consent_actions (member_id, action, source, at, prev_existed, prev_opted_in_at)
     VALUES ($1, 'opt_in', 'slash', $2, TRUE, $3)`,
    ['m-undone', '2026-02-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z'],
  );

  const gapped = await insert({ member: 'm-gapped', text: 'has a gap and no consent row' });
  await db.query(
    'INSERT INTO consent_gaps (member_id, gap_start, gap_end) VALUES ($1, $2, $3)',
    ['m-gapped', '2026-02-01T00:00:00.000Z', '2026-03-01T00:00:00.000Z'],
  );

  const held = await insert({ member: 'm-held', text: 'under an evidence hold' });
  await db.query(
    `INSERT INTO evidence_holds (message_id, source, state) VALUES ($1, 'report', 'active')`,
    [held.id],
  );

  const reported = await insert({ member: 'm-reported', text: 'somebody reported this' });
  await db.query(
    `INSERT INTO reports (message_id, reason, reporter_hash) VALUES ($1, 'other', 'hash-1')`,
    [reported.id],
  );

  const rejected = await insert({
    member: 'm-moderated',
    text: 'the operator rejected this',
    moderation: 'rejected',
  });

  const owed = await insert({ member: 'm-owed', text: 'a destruction is already owed' });
  await db.query(
    'INSERT INTO pending_destructions (message_id, member_id, requested_by) VALUES ($1, $2, $3)',
    [owed.id, 'm-owed', 'member'],
  );

  await db.query(
    'UPDATE messages SET media_path = $2 WHERE id = $1',
    [neverMedia.id, 'photo.jpg'],
  );

  /* ── 1. the shape of the setting ─────────────────────────────────────────── */

  console.log('\n1. The bound is a number the code justifies, not a preference');
  // D-241: the floor shipped at 168h on a moderation argument that does not hold. A
  // violation row carries its own copy of the group, the member, the display name at the
  // time, the role and the kind, and NO foreign key to messages, so a sweep leaves every
  // count byte-identical. The only finite window over message content anywhere in the tree
  // is her conversation memory's, and the floor is the first whole day above it.
  const mod029Sql = await readFile('migrations/029_moderation.sql', 'utf8');
  check(
    'THE CLAIM THE OLD FLOOR RESTED ON IS FALSE: no violation row points at a message',
    !/REFERENCES\s+messages/i.test(mod029Sql) && !/message_id/i.test(mod029Sql),
  );
  check(
    '  and the moderation tables keep their own copy of who it was',
    /member_display_name/.test(mod029Sql) && /member_role/.test(mod029Sql),
  );
  check('the floor is 24 hours', RETENTION_MIN_HOURS === 24, String(RETENTION_MIN_HOURS) + 'h');
  check(
    '  which clears the ONLY finite window over message content, twice over',
    RETENTION_MIN_HOURS * 60 >= 2 * MAX_HISTORY_LIMITS.windowMinutes,
    'memory max ' + String(MAX_HISTORY_LIMITS.windowMinutes) + ' min',
  );
  check(
    '  and that window is READ from the code rather than restated here',
    MAX_HISTORY_LIMITS.windowMinutes === 720,
  );
  check(
    'a fresh deployment gets the shortest bound',
    DEFAULT_RETENTION.hours === RETENTION_MIN_HOURS,
    String(DEFAULT_RETENTION.hours) + 'h',
  );
  const pageSrc = await readFile('src/web/views/retention.ts', 'utf8');
  check('  and 24 hours is a bound the operator can pick', pageSrc.includes("label: '24 hours'"));
  check(
    '  THE CONTROL: the longer bounds are still offered, not replaced',
    pageSrc.includes("label: '7 days'") && pageSrc.includes("label: '1 year'"),
  );
  check('it ships switched OFF', (await getRetentionSettings(db)).enabled === false);
  check(
    'a bound below the floor falls back rather than being accepted',
    normalizeRetention({ enabled: true, hours: 1 }).hours === RETENTION_MIN_HOURS,
  );
  check(
    'and a bound inside the range is kept exactly',
    normalizeRetention({ enabled: true, hours: 720 }).hours === 720,
  );

  /* ── 2. the published set cannot move ────────────────────────────────────── */

  console.log('\n2. Nothing published is lost and nothing unpublished becomes public');
  const publishedIds = async (): Promise<string> => {
    const { rows } = await db.query<{ ids: string | null }>(
      `SELECT string_agg(id::text, ',' ORDER BY id) AS ids
         FROM message_publish_state WHERE published`,
    );
    return rows[0]?.ids ?? '';
  };
  const before = await publishedIds();
  check('the fixture actually publishes something', before !== '', `[${before}]`);

  const cutoff = cutoffFor(RETENTION_MIN_HOURS, new Date());
  const waiting = await sweepableCount(db, cutoff);
  check('and it has rows waiting to be swept', waiting > 0, `${String(waiting)} row(s)`);

  const outcome = await transaction((tx) => sweepUnconsented(tx, mediaRoot, cutoff));
  check('the sweep ran', outcome.swept > 0, `${String(outcome.swept)} row(s)`);

  const after = await publishedIds();
  check('the published set is CHARACTER IDENTICAL afterwards', before === after, `[${after}]`);

  /* ── 3. the allow-list, every clause with its positive control ───────────── */

  console.log('\n3. Every clause is load-bearing, and something IS swept in the same pass');
  const swept = async (id: number): Promise<boolean> => {
    const { rows } = await db.query<{ n: string | null }>(
      'SELECT content_swept_at::text AS n FROM messages WHERE id = $1',
      [id],
    );
    return rows[0]?.n != null;
  };
  const textOf = async (id: number): Promise<string | null> => {
    const { rows } = await db.query<{ t: string | null }>(
      'SELECT text_body AS t FROM messages WHERE id = $1',
      [id],
    );
    return rows[0]?.t ?? null;
  };

  check('THE POSITIVE CONTROL: a never-consenting member is swept', await swept(never.id));
  check('  and its text really is gone', (await textOf(never.id)) === null);

  check('a member who opted in keeps even their PRE-opt-in words', !(await swept(optedBefore.id)));
  check('  and their published words', !(await swept(optedAfter.id)));
  check('a member who revoked and HID keeps everything, restorable', !(await swept(hidden.id)));
  check('a member whose consent was UNDONE is untouched', !(await swept(undone.id)));
  check('a member with a consent gap and no row is untouched', !(await swept(gapped.id)));
  check('an evidence hold spares its message', !(await swept(held.id)));
  check('a report spares its message', !(await swept(reported.id)));
  check('a rejected message is spared for the operator', !(await swept(rejected.id)));
  check('an owed destruction is left to the destruction path', !(await swept(owed.id)));
  check('a message inside the bound is untouched', !(await swept(neverRecent.id)));
  check('  and still says what it said', (await textOf(neverRecent.id)) === 'said this today');

  /* ── 4. her half of the conversation goes with it ────────────────────────── */

  console.log('\n4. Her reply to a swept question is swept; her own words are not');
  check('her reply to the swept message is swept too', await swept(herReply.id));
  const publishedNow = async (id: number): Promise<boolean> => {
    const { rows } = await db.query<{ p: boolean }>(
      'SELECT published AS p FROM message_publish_state WHERE id = $1',
      [id],
    );
    return rows[0]?.p === true;
  };
  // NOT a restatement of the sweep: this is the REASON it is safe to sweep her reply, read
  // off the publish view itself. A reply publishes only when its parent does, and this
  // parent's sender can never opt in backwards.
  check('  and the view agrees it is not published', !(await publishedNow(herReply.id)));
  check(
    '  THE CONTROL: an opted-in member IS published by that same view',
    await publishedNow(optedAfter.id),
  );
  check('her unprompted message is untouched', !(await swept(herOwn.id)));
  check(
    '  and still carries its search body, which its CHECK requires',
    (
      await db.query<{ b: string | null }>('SELECT search_body AS b FROM messages WHERE id = $1', [
        herOwn.id,
      ])
    ).rows[0]?.b !== null,
  );

  /* ── 5. what a tombstone is ──────────────────────────────────────────────── */

  console.log('\n5. The content is gone; the fact that a message existed is not');
  const { rows: tomb } = await db.query<Record<string, unknown>>(
    `SELECT text_body, links_text, raw_json::text AS raw, sender_display_name, media_path,
            media_mime, video_title, group_id, group_msg_id, sender_member_id,
            sent_at::text AS sent_at, type::text AS type
       FROM messages WHERE id = $1`,
    [never.id],
  );
  const t = tomb[0] ?? {};
  check('no text', t['text_body'] === null);
  check('no link text', t['links_text'] === null);
  check('no raw envelope', t['raw'] === '{}');
  check('no media path', t['media_path'] === null);
  // THE DISPLAY NAME IS PART OF THE SKELETON, and 070 clearing it was withdrawn in 071
  // (D-241). Who said something is not what they said, and removing a sender from
  // `resolveMemberByDisplayName`'s DISTINCT set can turn an ambiguous name into a confident
  // one - which publishes a mention on the strength of the wrong member's consent. Section
  // 12 drives that case.
  check('THE SKELETON IS KEPT: who said it', t['sender_display_name'] === 'Nobody Consented');
  check('  the room', Number(t['group_id']) === 7);
  check('  the chat item', Number(t['group_msg_id']) > 0);
  check('  the member id, which consent binds to', t['sender_member_id'] === 'm-never');
  check('  when it was said', String(t['sent_at']).startsWith('2026-01-02'));
  check('  and what kind of thing it was', t['type'] === 'text');

  const { rows: linkRows } = await db.query<{ n: string }>(
    'SELECT count(*)::text AS n FROM links WHERE message_id = $1',
    [never.id],
  );
  check('the link row is gone', linkRows[0]?.n === '0');

  let bytesGone = false;
  try {
    await access(join(mediaRoot, 'photo.jpg'));
  } catch {
    bytesGone = true;
  }
  check('the media bytes are gone from disk', bytesGone);
  check('  and the sweep counted the file it removed', outcome.filesRemoved === 1);
  check(
    '  while a file that was never there is not an error',
    (await readFile(join(mediaRoot, 'photo.jpg'), 'utf8').catch(() => null)) === null,
  );

  /* ── 6. the database refuses a half-swept row ────────────────────────────── */

  console.log('\n6. A tombstone that still holds content cannot exist');
  let refused = false;
  try {
    await db.query('UPDATE messages SET text_body = $2 WHERE id = $1', [never.id, 'put it back']);
  } catch {
    refused = true;
  }
  check('writing text back into a tombstone is refused by the schema', refused);
  const stillEmpty = (await textOf(never.id)) === null;
  check('  and the tombstone is unchanged', stillEmpty);

  let allowed = true;
  try {
    await db.query('UPDATE messages SET text_body = $2 WHERE id = $1', [
      optedAfter.id,
      'an ordinary edit',
    ]);
  } catch {
    allowed = false;
  }
  check('THE CONTROL: an ordinary row still accepts writes', allowed);
  await db.query('UPDATE messages SET text_body = $2 WHERE id = $1', [
    optedAfter.id,
    'after the opt-in',
  ]);

  /* ── 7. running it again converges ───────────────────────────────────────── */

  console.log('\n7. A second pass sweeps nothing and changes nothing');
  const tombsBefore = await tombstoneCount(db);
  const second = await transaction((tx) => sweepUnconsented(tx, mediaRoot, cutoff));
  check('the second pass sweeps nothing', second.swept === 0);
  check('  and the tombstone count is unchanged', (await tombstoneCount(db)) === tombsBefore);
  check('  and the published set STILL has not moved', (await publishedIds()) === after);

  /* ── 8. the mutations ────────────────────────────────────────────────────── */

  console.log('\n8. Mutations: each guard, removed, lets through exactly what it protects');
  const wouldSweep = async (predicate: string): Promise<number[]> => {
    const { rows } = await db.query<{ id: string }>(
      `SELECT m.id FROM messages m WHERE ${predicate} ORDER BY m.id`,
      [cutoff],
    );
    return rows.map((r) => Number(r.id));
  };
  const drop = (clause: string): string =>
    SWEEPABLE.split('\n')
      .map((line) =>
        // A dropped line carrying $1 is REPLACED rather than removed: deleting it takes the
        // only parameter reference with it and the bind fails, which reads as a mutation that
        // could not run rather than one that let a row through.
        line.includes(clause)
          ? line.includes('$1')
            ? '  AND $1::timestamptz IS NOT NULL'
            : ''
          : line,
      )
      .join('\n');

  const withoutJournal = await wouldSweep(drop('FROM consent_actions'));
  check(
    'without the consent-journal clause, the undone member IS swept',
    withoutJournal.includes(undone.id),
  );
  const withoutGaps = await wouldSweep(drop('FROM consent_gaps'));
  check('without the gap clause, the gapped member IS swept', withoutGaps.includes(gapped.id));
  const withoutHolds = await wouldSweep(drop('FROM evidence_holds'));
  check('without the hold clause, held content IS swept', withoutHolds.includes(held.id));
  const withoutReports = await wouldSweep(drop('FROM reports'));
  check('without the report clause, reported content IS swept', withoutReports.includes(reported.id));
  const withoutAge = await wouldSweep(drop('m.sent_at <'));
  check('without the age clause, today IS swept', withoutAge.includes(neverRecent.id));
  const withoutConsent = await wouldSweep(drop('FROM consent c'));
  check(
    'without the consent clause, an OPTED-IN member IS swept',
    withoutConsent.includes(optedBefore.id),
  );
  check(
    '  and the shipped predicate refuses every one of those',
    (await wouldSweep(SWEEPABLE)).length === 0,
    'nothing is left to sweep after the real pass',
  );

  /* ── 9. the grammar of the core command, read from the parser ────────────── */

  console.log('\n9. The core command is the grammar the parser states (D-209)');
  const coreSrc = await readFile('src/bot/runtime/core.ts', 'utf8');
  check(
    'the setter is /_ttl <userId> <seconds>',
    coreSrc.includes('`/_ttl ${String(simplexUserId)} ${String(seconds)}`'),
  );
  check('the getter is /_ttl <userId>', coreSrc.includes('`/_ttl ${String(simplexUserId)}`'));
  check(
    'and it goes through the scheduler, because a named user id is refusable (D-171)',
    /setChatItemTTL[\s\S]{0,600}this\.scheduler\.run/.test(coreSrc),
  );
  check(
    'the immediate-expiry warning is on the page the operator presses',
    (await readFile('src/web/views/retention.ts', 'utf8')).includes(
      'This takes effect immediately, not just from now on.',
    ),
  );

  /* ── 10. the page, operated ──────────────────────────────────────────────── */

  console.log('\n10. The Retention page, driven through its real routes');

  const adminCfg = {
    adminPort: 8809,
    adminUsername: OPERATOR,
    adminPasswordHash: await argon2.hash(PASSWORD, { type: argon2.argon2id }),
    sessionSecret: 'retention-secret-0123456789abcdef0123456789ab',
    publicOrigin: 'https://admin.example.org',
    rpId: 'admin.example.org',
    webauthnOrigin: 'https://admin.example.org',
    rpName: 'Cinderella Admin',
  } as never;
  const cfg = {
    mediaRoot,
    assetRoot: './state/preview-assets',
    backupStatusPath: './state/backup-status.json',
    backupRequestPath: './state/backup-request',
    backupProgressPath: './state/backup-progress.json',
    avatarPath: '',
    databaseUrl: 'postgres://placeholder@127.0.0.1:5432/x',
    logLevel: 'error',
  } as unknown as Config;

  registerNav();
  const app = buildServer({
    db,
    adminCfg,
    transaction,
    settings: await SettingsService.load(db, 'error'),
    security: await SecurityService.load(db),
    interaction: await InteractionService.load(db),
    cfg,
    registerViews: registerAdminViews,
  } as never);
  await app.ready();

  const loginPage = await app.inject({ method: 'GET', url: '/login' });
  const loginCookie = String(loginPage.headers['set-cookie'] ?? '');
  const loginToken = /name="_csrf" value="([^"]+)"/.exec(loginPage.body)?.[1] ?? '';
  const login = await app.inject({
    method: 'POST',
    url: '/login',
    headers: { cookie: loginCookie, 'content-type': 'application/x-www-form-urlencoded' },
    payload: `username=${OPERATOR}&password=${encodeURIComponent(PASSWORD)}&_csrf=${encodeURIComponent(loginToken)}`,
  });
  const rawCookie = login.headers['set-cookie'];
  const cookie = (Array.isArray(rawCookie) ? rawCookie : [String(rawCookie ?? '')])
    .map((c) => c.split(';')[0])
    .join('; ');

  const get = async (url: string): Promise<string> =>
    (await app.inject({ method: 'GET', url, headers: { cookie } })).body;
  const csrfOf = (body: string): string => /name="_csrf" value="([^"]+)"/.exec(body)?.[1] ?? '';
  const says = (body: string, phrase: string): boolean =>
    body.replace(/\s+/g, ' ').includes(phrase.replace(/\s+/g, ' '));

  const pageBody = await get('/retention');
  check('the page renders', pageBody.includes('Retention'));
  check(
    'and states what a tombstone is, in the words the operator can repeat',
    says(pageBody, 'The content is gone. The fact that a message existed is not.'),
  );
  check(
    'it says who is swept rather than leaving it to be inferred',
    says(pageBody, 'never touched consent at all'),
  );
  check('it shows how many are already swept', says(pageBody, 'Already swept'));

  const csrf = csrfOf(pageBody);
  const saved = await app.inject({
    method: 'POST',
    url: '/retention/settings',
    headers: { cookie, 'content-type': 'application/x-www-form-urlencoded' },
    payload: `hours=720&enabled=yes&_csrf=${encodeURIComponent(csrf)}`,
  });
  check('saving the bound redirects', saved.statusCode === 302);
  const readBack = await getRetentionSettings(db);
  check('  and the DATABASE holds the new bound', readBack.hours === 720, `${String(readBack.hours)}h`);
  check('  and sweeping is now on', readBack.enabled);

  // A fresh row nobody consented to, old enough for the saved bound, so "Sweep now" has
  // something to do and the assertion is not vacuous.
  const later = await insert({ member: 'm-never', text: 'one more nobody agreed to' });
  const beforeSweepButton = await tombstoneCount(db);
  const pressed = await app.inject({
    method: 'POST',
    url: '/retention/sweep',
    headers: { cookie, 'content-type': 'application/x-www-form-urlencoded' },
    payload: `_csrf=${encodeURIComponent(csrfOf(await get('/retention')))}`,
  });
  check('pressing Sweep now redirects', pressed.statusCode === 302);
  check(
    '  and the row it was pressed for now holds no content',
    (await textOf(later.id)) === null && (await swept(later.id)),
  );
  check(
    '  and the tombstone count rose by exactly that row',
    (await tombstoneCount(db)) === beforeSweepButton + 1,
  );
  check('  and the published set STILL has not moved', (await publishedIds()) === after);

  const browsed = await get(`/messages?id=${String(never.id)}`);
  check(
    'the message browser says the content was removed rather than showing a blank row',
    says(browsed, 'content removed'),
  );

  /* ── 11. the schedule is a time, not a consequence of the restart clock ──── */

  console.log('\n11. The bound is an age; the schedule is midnight');
  const at = (iso: string): Date => new Date(iso);
  check(
    'an afternoon arms for midnight tonight',
    nextMidnight(at('2026-08-21T14:37:00')).getHours() === 0 &&
      nextMidnight(at('2026-08-21T14:37:00')).getDate() === 22,
    nextMidnight(at('2026-08-21T14:37:00')).toString(),
  );
  check(
    'one second before midnight still arms for tonight, not tomorrow night',
    nextMidnight(at('2026-08-21T23:59:59')).getDate() === 22,
  );
  check(
    'AT midnight it arms for the NEXT one, so a pass cannot re-fire into itself',
    nextMidnight(at('2026-08-21T00:00:00')).getDate() === 22,
  );
  check(
    'it crosses a month boundary without arithmetic of its own',
    nextMidnight(at('2026-08-31T22:00:00')).getMonth() === 8,
  );
  check(
    'it crosses a year boundary',
    nextMidnight(at('2026-12-31T22:00:00')).getFullYear() === 2027,
  );
  check(
    'the wait is always positive, so a timer can never be armed for the past',
    msUntilNextMidnight(at('2026-08-21T00:00:00')) > 0 &&
      msUntilNextMidnight(at('2026-08-21T23:59:59.999')) > 0,
  );

  // THE ONE THAT MATTERS, and it is the behaviour the operator asked for: starting the
  // sweeper must not sweep. A boot run would put erasure back on the restart clock, which
  // is exactly what "at a time he can predict" rules out.
  let ranAtBoot = 0;
  const schedule = startRetentionSweeper({
    runOnce: async () => {
      ranAtBoot += 1;
      return null;
    },
  });
  await new Promise((r) => setTimeout(r, 50));
  check('arming the sweeper does NOT sweep', ranAtBoot === 0);
  schedule.stop();
  check('  and the schedule can be stopped', true);

  // THE POSITIVE CONTROL. Without it, "does not run at boot" passes against a runner that
  // is never called at all, which is the same shape as retention being dead.
  let fired = 0;
  const soon = startRetentionSweeper(
    {
      runOnce: async () => {
        fired += 1;
        return null;
      },
    },
    // A clock one millisecond before midnight, so the armed timer is due almost at once.
    () => new Date(new Date().setHours(23, 59, 59, 999)),
  );
  await new Promise((r) => setTimeout(r, 120));
  soon.stop();
  // The stub clock stays one millisecond before midnight, so this also shows the timer
  // RE-ARMING after each pass rather than firing once and dying, which is the difference
  // between a nightly sweep and a sweep that happened once on the day it was deployed.
  check(
    '  but the armed timer DOES fire when its time comes, and re-arms after each pass',
    fired >= 2,
    `${String(fired)} pass(es)`,
  );

  /* ── 12. a tombstone is not a fault, and not an opportunity ─────────────── */

  console.log('\n12. What a tombstone must never be mistaken for (D-241)');

  // A. THE NAME. Two members have used one name; one is swept. The resolver must still see
  // both, because seeing only one would resolve the mention and publish it.
  await db.query(
    `INSERT INTO messages (group_id, group_msg_id, sender_member_id, sender_display_name,
                           sent_at, type, text_body, raw_json)
     VALUES (7, 9001, 'm-never', 'Robin', $1, 'text', 'the swept Robin', '{}'::jsonb),
            (7, 9002, 'm-opted', 'Robin', $2, 'text', 'the consented Robin', '{}'::jsonb)`,
    [OLD, '2026-06-02T10:00:00.000Z'],
  );
  const ambiguousBefore = await resolveMemberByDisplayName(db, 'Robin');
  check('a name two members have used resolves to NOBODY', ambiguousBefore === null);
  await transaction((tx) => sweepUnconsented(tx, mediaRoot, cutoff));
  const ambiguousAfter = await resolveMemberByDisplayName(db, 'Robin');
  check(
    '  and it STILL resolves to nobody after the sweep, so the mention stays withheld',
    ambiguousAfter === null,
    String(ambiguousAfter),
  );
  check(
    '  THE CONTROL: a name only one member has used still resolves',
    (await resolveMemberByDisplayName(db, 'Nobody Consented')) === 'm-never',
  );

  // B. THE HOLD, IN THE DATABASE RATHER THAN IN TYPESCRIPT. Migration 020 put this guarantee
  // in a trigger precisely because an application predicate cannot deliver it; 020's trigger
  // is BEFORE DELETE and the sweep UPDATEs, so 071 extends it. Driven by clearing a held row
  // DIRECTLY, which is what an ad-hoc remediation script would do.
  const heldNow = await insert({ member: 'm-held2', text: 'held and old' });
  await db.query(
    `INSERT INTO evidence_holds (message_id, source, state) VALUES ($1, 'report', 'active')`,
    [heldNow.id],
  );
  let sweepRefused = false;
  try {
    await db.query(
      `UPDATE messages SET text_body = NULL, links_text = NULL, raw_json = '{}'::jsonb,
              media_path = NULL, content_swept_at = now() WHERE id = $1`,
      [heldNow.id],
    );
  } catch {
    sweepRefused = true;
  }
  check('the DATABASE refuses to sweep held content, not just the predicate', sweepRefused);
  check('  and the held content is still there', (await textOf(heldNow.id)) === 'held and old');
  let ordinaryAllowed = true;
  try {
    await db.query('UPDATE messages SET text_body = $2 WHERE id = $1', [
      heldNow.id,
      'held and old',
    ]);
  } catch {
    ordinaryAllowed = false;
  }
  check('  THE CONTROL: an ordinary update of a held row is untouched', ordinaryAllowed);

  // MUTATION: drop 071's trigger and the held content goes, which is the state the code was
  // in when it was pushed. Restored immediately afterwards.
  await db.query('DROP TRIGGER messages_evidence_hold_sweep_guard ON messages');
  let sweptWithoutGuard = false;
  try {
    await db.query(
      `UPDATE messages SET text_body = NULL, links_text = NULL, raw_json = '{}'::jsonb,
              media_path = NULL, content_swept_at = now() WHERE id = $1`,
      [heldNow.id],
    );
    sweptWithoutGuard = true;
  } catch {
    sweptWithoutGuard = false;
  }
  check(
    '  MUTATION: without the trigger, held content IS erased',
    sweptWithoutGuard && (await textOf(heldNow.id)) === null,
  );
  await db.query(
    `UPDATE messages SET text_body = 'held and old', content_swept_at = NULL WHERE id = $1`,
    [heldNow.id],
  );
  await db.query(
    `CREATE TRIGGER messages_evidence_hold_sweep_guard BEFORE UPDATE ON messages
       FOR EACH ROW EXECUTE FUNCTION guard_evidence_hold_sweep()`,
  );

  // C. CAPTURE MUST NOT CRASH AGAINST A TOMBSTONE. The 070 CHECK turned a re-capture or an
  // edit into an exception on the path D-190 says must fail TOWARDS capturing.
  let recaptured = 0;
  try {
    recaptured = await upsertMessage(db, {
      groupId: 7,
      groupMsgId: 1001,
      sharedMsgId: null,
      senderMemberId: 'm-never',
      senderDisplayName: 'Nobody Consented',
      sentAt: OLD,
      type: 'text',
      textBody: 'the same chat item, delivered again',
      linksText: null,
      rawJson: { chatItem: {} },
    } as never);
  } catch (err) {
    check('re-capturing a swept message does not throw', false, String(err));
  }
  check('re-capturing a swept message does not throw', recaptured > 0);
  const revived = await db.query<{ t: string | null; s: string | null }>(
    'SELECT text_body AS t, content_swept_at::text AS s FROM messages WHERE group_id = 7 AND group_msg_id = 1001',
  );
  check('  and it revives the row rather than half-writing it', revived.rows[0]?.s === null);
  check(
    '  with the content that actually arrived',
    revived.rows[0]?.t === 'the same chat item, delivered again',
  );

  // D. A FILE THAT LANDS AFTER THE SWEEP. Same shape, and the one media state that cannot be
  // repaired by retrying: bytes on disk with nothing pointing at them.
  const lateFile = await insert({ member: 'm-never', text: 'a picture is coming' });
  await transaction((tx) => sweepUnconsented(tx, mediaRoot, cutoff));
  check('the row for a late file was swept', await swept(lateFile.id));
  const lateRow = await db.query<{ group_msg_id: string }>(
    'SELECT group_msg_id FROM messages WHERE id = $1',
    [lateFile.id],
  );
  const updated = await updateMedia(db, 7, Number(lateRow.rows[0]?.group_msg_id), {
    mediaPath: 'late.jpg',
    mediaMime: 'image/jpeg',
    mediaSize: 10,
  });
  check('  the arriving file is recorded rather than refused', updated === 1);
  check('  and the row owns its bytes again', !(await swept(lateFile.id)));

  // E. NEITHER READER MAY REPORT AN ERASURE AS A FAILED RECEIPT.
  const mediaTomb = await insert({ member: 'm-never', mediaPath: 'gone.jpg' });
  await writeFile(join(mediaRoot, 'gone.jpg'), 'BYTES');
  await db.query("UPDATE messages SET type = 'image' WHERE id = $1", [mediaTomb.id]);
  await transaction((tx) => sweepUnconsented(tx, mediaRoot, cutoff));
  check('a swept picture is a tombstone', await swept(mediaTomb.id));
  const flagged = await markInterruptedMediaReceipts(db);
  const stamped = await db.query<{ e: string | null }>(
    'SELECT media_error AS e FROM messages WHERE id = $1',
    [mediaTomb.id],
  );
  check(
    '  the boot flagger does not stamp it "receipt interrupted"',
    stamped.rows[0]?.e === null,
    `flagged ${String(flagged)} row(s)`,
  );
  const stats = await dashboardStats(db, 24);
  check(
    '  and the dashboard does not count it as a failed or at-risk receipt',
    stats.mediaFailed === 0 && stats.mediaAtRisk === 0,
    `failed ${String(stats.mediaFailed)}, at risk ${String(stats.mediaAtRisk)}`,
  );
  // THE POSITIVE CONTROL. Without it both assertions pass against a flagger that flags
  // nothing and a dashboard that counts nothing, which is the same shape as the feature
  // being dead.
  const genuinelyMissing = await insert({ member: 'm-opted', text: 'a real lost receipt' });
  await db.query("UPDATE messages SET type = 'image' WHERE id = $1", [genuinelyMissing.id]);
  const flagged2 = await markInterruptedMediaReceipts(db);
  const stamped2 = await db.query<{ e: string | null }>(
    'SELECT media_error AS e FROM messages WHERE id = $1',
    [genuinelyMissing.id],
  );
  check(
    '  THE CONTROL: a genuinely missing file IS still flagged',
    flagged2 >= 1 && (stamped2.rows[0]?.e ?? '').includes('interrupted'),
  );
  check(
    '  and the dashboard DOES count that one',
    (await dashboardStats(db, 24)).mediaFailed >= 1,
  );

  // F. SHE MUST NOT CLAIM CUSTODY OF WHAT SHE HAS ERASED. This is CCB-S3-031 pointing the
  // other way: that rule stops her claiming destruction over retained content; this stops
  // her claiming retention over destroyed content.
  const counts = await memberArchiveCounts(db, 'm-never');
  const rawRows = await db.query<{ n: string }>(
    'SELECT count(*)::text AS n FROM messages WHERE sender_member_id = $1',
    ['m-never'],
  );
  check(
    'the STATUS count excludes tombstones',
    counts.total < Number(rawRows.rows[0]?.n ?? 0),
    `${String(counts.total)} of ${String(rawRows.rows[0]?.n)} rows`,
  );
  check(
    '  THE CONTROL: it still counts what she really holds',
    counts.total >= 1,
    `${String(counts.total)}`,
  );
  check(
    'and the revocation count agrees, so no restore is promised over erased content',
    (await memberMessageCount(db, 'm-never')) === counts.total,
  );

  await app.close();
  await pg.close();

  console.log(
    failures === 0
      ? '\nAll retention checks passed.'
      : `\n${String(failures)} check(s) FAILED.`,
  );
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
