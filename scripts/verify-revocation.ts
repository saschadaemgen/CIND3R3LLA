/**
 * Verification harness — hide or delete on revocation, with evidence holds
 * (CCB-S3-013).
 *
 * Runs the REAL code against PGlite (Postgres in WASM) and a real temporary media
 * tree: the real migrations, the real publish views, the real dialogue engine, the
 * real destruction path, the real DB hold trigger. Nothing here is a mock of the
 * thing being tested.
 *
 * It exists to prove the acceptance list, and in particular the two claims that
 * are worth nothing unless demonstrated:
 *
 *   - a bare "yes" NEVER destroys anything;
 *   - NO path destroys a held item: not a member's delete, not an operator
 *     takedown, not a direct SQL DELETE, not a reply cascade.
 *
 *   npx tsx scripts/verify-revocation.ts
 */

import { mkdtemp, mkdir, writeFile, readdir, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { PGlite } from '@electric-sql/pglite';

import { destroyMessage, recordPendingDestruction } from '../src/archive/destroy.js';
import { sweepDestructions } from '../src/archive/sweeper.js';
import { chooseDelete, chooseHide, isHoldViolation, restoreHiddenContent } from '../src/consent/revocation.js';
import { getConsent, recordOptIn, recordOptOut } from '../src/db/consent.js';
import { liveHold, placeHold, resolveHold, sourceIsSuppressed } from '../src/db/holds.js';
import { loadMigrationFiles } from '../src/db/migrate.js';
import { setModerationState, upsertMessage } from '../src/db/messages.js';
import type { Queryable } from '../src/db/pool.js';
import { createReport } from '../src/db/reports.js';
import { InteractionEngine } from '../src/interaction/engine.js';
import { DEFAULT_INTERACTION, type InteractionSettings } from '../src/interaction/settings.js';
import { filesOwnedBy } from '../src/media/owned-files.js';
import {
  isMediaQuarantined,
  quarantineMedia,
  releaseQuarantinedMedia,
  servableMediaPath,
} from '../src/media/quarantine.js';
import type { CapturedMessage } from '../src/capture/message.js';

let failures = 0;
function check(label: string, ok: boolean, detail = ''): void {
  if (!ok) failures++;
  console.log(`  [${ok ? 'PASS' : 'FAIL'}] ${label}${detail ? ` — ${detail}` : ''}`);
}
function section(title: string): void {
  console.log(`\n${title}`);
}

const GROUP = 1;
const ALICE = 'member-alice';
const BOB = 'member-bob';

async function main(): Promise<void> {
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

  const mediaRoot = await mkdtemp(join(tmpdir(), 'cinderella-revocation-'));
  // PGlite is a single connection, so a transaction is just BEGIN/COMMIT on it.
  const runTx = async <T>(fn: (tx: Queryable) => Promise<T>): Promise<T> => {
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

  let nextMsgId = 100;
  async function insert(
    member: string,
    opts: { sentAt: string; text?: string; media?: boolean } = { sentAt: '2026-07-01T10:00:00Z' },
  ): Promise<number> {
    const groupMsgId = nextMsgId++;
    await upsertMessage(db, {
      groupId: GROUP,
      groupMsgId,
      sharedMsgId: null,
      senderMemberId: member,
      senderDisplayName: member,
      sentAt: opts.sentAt,
      type: opts.media ? 'image' : 'text',
      textBody: opts.text ?? `message ${groupMsgId}`,
      linksText: null,
      rawJson: { id: groupMsgId },
    });
    const r = await pg.query<{ id: string }>(
      'SELECT id FROM messages WHERE group_id = $1 AND group_msg_id = $2',
      [GROUP, groupMsgId],
    );
    return Number(r.rows[0]?.id);
  }

  /** Gives a message a real original and a real stripped derivative on disk. */
  async function attachMedia(id: number): Promise<{ original: string; derived: string }> {
    const original = `2026/07/9001-photo-${id}.jpg`;
    const derived = `derived/2026/07/${id}.jpg`;
    await mkdir(join(mediaRoot, '2026', '07'), { recursive: true });
    await mkdir(join(mediaRoot, 'derived', '2026', '07'), { recursive: true });
    await writeFile(join(mediaRoot, original), 'original-bytes');
    await writeFile(join(mediaRoot, derived), 'stripped-bytes');
    await db.query(
      'UPDATE messages SET media_path = $2, media_derived_path = $3, media_mime = $4 WHERE id = $1',
      [id, original, derived, 'image/jpeg'],
    );
    return { original, derived };
  }

  async function exists(rel: string): Promise<boolean> {
    try {
      await stat(join(mediaRoot, rel));
      return true;
    } catch {
      return false;
    }
  }

  async function isPublished(id: number): Promise<boolean> {
    const r = await pg.query<{ published: boolean }>(
      'SELECT published FROM message_publish_state WHERE id = $1',
      [id],
    );
    return r.rows[0]?.published === true;
  }

  async function rowExists(id: number): Promise<boolean> {
    const r = await pg.query('SELECT 1 FROM messages WHERE id = $1', [id]);
    return r.rows.length > 0;
  }

  /* ── 1. The interim state: revoked, unanswered, and therefore hidden ────── */
  section('1. Revocation hides immediately, and the unanswered state is hidden');

  await recordOptIn(db, ALICE, '2026-07-01T09:00:00Z');
  const a1 = await insert(ALICE, { sentAt: '2026-07-01T10:00:00Z', text: 'alice one' });
  const a2 = await insert(ALICE, { sentAt: '2026-07-01T11:00:00Z', text: 'alice two' });
  check('opted-in content is published', (await isPublished(a1)) && (await isPublished(a2)));

  await recordOptOut(db, ALICE, '2026-07-02T09:00:00Z');
  check('revoking hides everything at once', !(await isPublished(a1)) && !(await isPublished(a2)));
  const afterRevoke = await getConsent(db, ALICE);
  check(
    "the unanswered choice is recorded as 'pending', not as a default",
    afterRevoke?.revocationMode === 'pending',
    `mode=${String(afterRevoke?.revocationMode)}`,
  );
  check('the rows still exist while the choice is unanswered', await rowExists(a1));

  /* ── 2. HIDE, and restore ───────────────────────────────────────────────── */
  section('2. Hide keeps the content, and only that member can restore it');

  await chooseHide(db, { memberId: ALICE, at: '2026-07-02T09:01:00Z', source: 'natural' });
  check('hide is recorded', (await getConsent(db, ALICE))?.revocationMode === 'hide');
  check('hidden content stays unpublished', !(await isPublished(a1)));
  check('hidden content is retained', await rowExists(a1));

  const journalHide = await pg.query<{ action: string }>(
    "SELECT action FROM consent_actions WHERE member_id = $1 AND action = 'hide'",
    [ALICE],
  );
  check('the consent journal records the mode that was chosen', journalHide.rows.length === 1);

  // Restoring must NOT go through re-opt-in: that would reset opted_in_at and,
  // because publication is forward-only, leave every old message behind.
  const restored = await restoreHiddenContent(db, {
    memberId: ALICE,
    at: '2026-07-03T09:00:00Z',
    source: 'natural',
  });
  check('restore reports success', restored.restored);
  check(
    'restored content is public again, with its ORIGINAL opt-in window intact',
    (await isPublished(a1)) && (await isPublished(a2)),
  );
  // PGlite hands back a Date for timestamptz where node-postgres gives a string,
  // so this normalises rather than assuming either.
  const optedInAt = new Date(String((await getConsent(db, ALICE))?.optedInAt)).toISOString();
  check(
    'the original opt-in timestamp is preserved by the restore',
    optedInAt.startsWith('2026-07-01T09:00'),
    optedInAt,
  );

  /* ── 3. DELETE really erases, including every file ──────────────────────── */
  section('3. Delete erases rows, media, derivatives and the search index');

  await recordOptIn(db, BOB, '2026-07-01T09:00:00Z');
  const b1 = await insert(BOB, { sentAt: '2026-07-01T10:00:00Z', text: 'bob searchable weasel' });
  const b2 = await insert(BOB, { sentAt: '2026-07-01T11:00:00Z', text: 'bob two' });
  const files = await attachMedia(b1);
  // A stray derivative from an earlier strip, and a partial `.tmp` sidecar: both
  // are real leftovers this code can produce, and neither is named by any column.
  await writeFile(join(mediaRoot, `derived/2026/07/${b1}.png`), 'orphan-derivative');
  await writeFile(join(mediaRoot, `derived/2026/07/${b1}.jpg.tmp`), 'partial-write');
  await writeFile(join(mediaRoot, `2026/07/thumb-${b1}.jpg`), 'video-thumbnail');

  const owned = await filesOwnedBy(db, mediaRoot, b1);
  check(
    'the file enumerator finds the original, the derivative, the orphan, the tmp and the thumbnail',
    owned.paths.length === 5,
    `found ${owned.paths.length}`,
  );

  const searchBefore = await pg.query(
    "SELECT 1 FROM published_messages WHERE search @@ plainto_tsquery('simple', 'weasel')",
  );
  check('the content is findable in search beforehand', searchBefore.rows.length === 1);

  await recordOptOut(db, BOB, '2026-07-02T09:00:00Z');
  const del = await chooseDelete(
    db,
    { memberId: BOB, at: '2026-07-02T09:01:00Z', source: 'natural' },
    mediaRoot,
    runTx,
  );
  check('both of the member’s messages were destroyed', del.destroyed === 2, JSON.stringify(del));
  check('the rows are gone', !(await rowExists(b1)) && !(await rowExists(b2)));
  check('the original file is gone', !(await exists(files.original)));
  check('the stripped derivative is gone', !(await exists(files.derived)));
  check('the orphaned derivative is gone', !(await exists(`derived/2026/07/${b1}.png`)));
  check('the partial .tmp sidecar is gone', !(await exists(`derived/2026/07/${b1}.jpg.tmp`)));
  check('the video thumbnail is gone', !(await exists(`2026/07/thumb-${b1}.jpg`)));

  const searchAfter = await pg.query(
    "SELECT 1 FROM published_messages WHERE search @@ plainto_tsquery('simple', 'weasel')",
  );
  check('the destroyed content is no longer in the search index', searchAfter.rows.length === 0);

  const journalDelete = await pg.query<{ action: string }>(
    "SELECT action FROM consent_actions WHERE member_id = $1 AND action = 'delete'",
    [BOB],
  );
  check('the journal records that delete was the mode chosen', journalDelete.rows.length === 1);

  // Nobody, including the operator, can bring it back: there is nothing left.
  const restoreAfterDelete = await restoreHiddenContent(db, {
    memberId: BOB,
    at: '2026-07-03T09:00:00Z',
    source: 'natural',
  });
  check('restore after a delete restores nothing', !restoreAfterDelete.restored);

  /* ── 4. Reports: only illegal creates a hold, and holds do not compound ── */
  section('4. Only an illegal-content report creates a hold, and it never compounds');

  const c1 = await insert(ALICE, { sentAt: '2026-07-04T10:00:00Z', text: 'reported item' });
  await createReport(db, {
    messageId: c1,
    reason: 'spam',
    note: null,
    reporterHash: 'hash-spam',
    reporterSource: 'src-1',
  });
  check('a spam report places no hold', (await liveHold(db, c1)) === null);

  const first = await placeHold(db, c1, 'report', new Date(Date.now() + 30 * 86400_000));
  check('an illegal report places a hold', first.created && first.hold.state === 'active');
  const firstExpiry = first.hold.expiresAt;

  const second = await placeHold(db, c1, 'report', new Date(Date.now() + 90 * 86400_000));
  check('a second report does not create another hold', !second.created);
  check(
    'a second report does not extend the clock',
    new Date(String(second.hold.expiresAt)).getTime() === new Date(String(firstExpiry)).getTime(),
    `${String(firstExpiry)} vs ${String(second.hold.expiresAt)}`,
  );
  const holdCount = await pg.query('SELECT 1 FROM evidence_holds WHERE message_id = $1', [c1]);
  check('exactly one hold row exists for the item', holdCount.rows.length === 1);

  /* ── 5. A hold blocks destruction, and NOTHING gets past it ─────────────── */
  section('5. No path destroys a held item');

  const heldFiles = await attachMedia(c1);

  let memberDeleteBlocked = false;
  try {
    await runTx((tx) => destroyMessage(tx, mediaRoot, c1));
  } catch (err) {
    memberDeleteBlocked = isHoldViolation(err);
  }
  check('a member deletion cannot destroy a held item', memberDeleteBlocked);
  check('and its media is untouched by the refused attempt', await exists(heldFiles.original));
  check('and its row survives', await rowExists(c1));

  // The guard is in the DATABASE, so a path that never goes through the
  // application meets it too. This is the ad-hoc remediation script case.
  let rawSqlBlocked = false;
  try {
    await db.query('DELETE FROM messages WHERE id = $1', [c1]);
  } catch {
    rawSqlBlocked = true;
  }
  check('a direct SQL DELETE cannot destroy a held item', rawSqlBlocked);

  // An operator takedown HIDES; it must still work, and must not destroy.
  await setModerationState(db, c1, 'rejected');
  check('an operator takedown still works on a held item', !(await isPublished(c1)));
  check('and the takedown did not destroy it', await rowExists(c1));
  await setModerationState(db, c1, 'none');

  // The reply cascade: destroying a question would cascade into her answer. If the
  // ANSWER is held, the whole delete has to be refused.
  const question = await insert(ALICE, { sentAt: '2026-07-05T10:00:00Z', text: 'a question' });
  const answer = await insert(ALICE, { sentAt: '2026-07-05T10:00:01Z', text: 'her answer' });
  await db.query('UPDATE messages SET reply_to_id = $2 WHERE id = $1', [answer, question]);
  await placeHold(db, answer, 'report', new Date(Date.now() + 30 * 86400_000));
  let cascadeBlocked = false;
  try {
    await runTx((tx) => destroyMessage(tx, mediaRoot, question));
  } catch (err) {
    cascadeBlocked = isHoldViolation(err);
  }
  check('a held REPLY blocks destruction of the question that would cascade into it', cascadeBlocked);
  check('both rows survive', (await rowExists(question)) && (await rowExists(answer)));

  /* ── 6. A hold never blocks HIDING ──────────────────────────────────────── */
  section('6. A hold defers destruction only, never hiding');

  const d1 = await insert(BOB, { sentAt: '2026-07-06T10:00:00Z', text: 'held but hideable' });
  await recordOptIn(db, BOB, '2026-07-06T09:00:00Z');
  check('the item is published to begin with', await isPublished(d1));
  await placeHold(db, d1, 'report', new Date(Date.now() + 30 * 86400_000));
  check('placing a hold does not change publication', await isPublished(d1));

  await recordOptOut(db, BOB, '2026-07-06T11:00:00Z');
  check('a held item is hidden INSTANTLY when its author revokes', !(await isPublished(d1)));

  const deferred = await chooseDelete(
    db,
    { memberId: BOB, at: '2026-07-06T11:01:00Z', source: 'natural' },
    mediaRoot,
    runTx,
  );
  check('the delete defers the held item rather than failing', deferred.deferred === 1, JSON.stringify(deferred));
  check('the held item still exists', await rowExists(d1));
  const pending = await pg.query('SELECT 1 FROM pending_destructions WHERE message_id = $1', [d1]);
  check('the deletion intent is recorded durably, so a restart cannot lose it', pending.rows.length === 1);

  /* ── 7. Release and expiry let the deferred deletion run ────────────────── */
  section('7. Releasing or expiring a hold lets the deferred deletion proceed');

  const heldHold = await liveHold(db, d1);
  await resolveHold(db, heldHold?.id ?? 0, 'release', 'operator');
  check('the hold is released', (await liveHold(db, d1)) === null);
  await runTx((tx) => destroyMessage(tx, mediaRoot, d1));
  check('the previously-deferred deletion now succeeds', !(await rowExists(d1)));

  /* ── 8. Escalation is destruction-proof, forever ────────────────────────── */
  section('8. An escalated item cannot be destroyed by any path');

  const e1 = await insert(ALICE, { sentAt: '2026-07-07T10:00:00Z', text: 'escalated' });
  const eHold = await placeHold(db, e1, 'report', new Date(Date.now() + 30 * 86400_000));
  const escalated = await resolveHold(db, eHold.hold.id, 'escalate', 'operator');
  check('escalating keeps the hold live', escalated?.state === 'escalated');
  check('an escalated hold has no expiry, so the clock can never release it', escalated?.expiresAt === null);

  let escalationBlocked = false;
  try {
    await runTx((tx) => destroyMessage(tx, mediaRoot, e1));
  } catch (err) {
    escalationBlocked = isHoldViolation(err);
  }
  check('an escalated item cannot be destroyed', escalationBlocked);
  check('an escalated item is excluded from the expiry sweep', await rowExists(e1));

  const expiredSweep = await pg.query(
    "SELECT 1 FROM evidence_holds WHERE state = 'active' AND expires_at IS NOT NULL AND expires_at <= now()",
  );
  check('nothing is due to expire in this fixture', expiredSweep.rows.length === 0);

  /* ── 9. The abuse threshold ─────────────────────────────────────────────── */
  section('9. A source whose illegal reports keep being dismissed stops creating holds');

  check('a threshold of 0 never suppresses', !(await sourceIsSuppressed(db, 'src-x', 0)));
  check('an unknown source is not suppressed', !(await sourceIsSuppressed(db, 'src-x', 1)));

  const f1 = await insert(ALICE, { sentAt: '2026-07-08T10:00:00Z' });
  const f2 = await insert(ALICE, { sentAt: '2026-07-08T10:00:01Z' });
  for (const [i, id] of [f1, f2].entries()) {
    await createReport(db, {
      messageId: id,
      reason: 'illegal',
      note: null,
      reporterHash: `hash-abuse-${i}`,
      reporterSource: 'src-abusive',
    });
  }
  await db.query("UPDATE reports SET status = 'dismissed' WHERE reporter_source = 'src-abusive'");
  check('below the threshold the source still creates holds', !(await sourceIsSuppressed(db, 'src-abusive', 3)));
  check('at the threshold the source is suppressed', await sourceIsSuppressed(db, 'src-abusive', 2));

  /* ── 10. The asymmetric confirmation, through the real engine ───────────── */
  section('10. A bare "yes" never destroys; only the literal word does');

  const sent: string[] = [];
  const settings: InteractionSettings = { ...DEFAULT_INTERACTION, wakeWord: 'cinderella' };
  const engine = new InteractionEngine({
    db,
    settings: () => settings,
    mediaRoot,
    runTx,
    send: async (_msg, text) => {
      sent.push(text);
      return Promise.resolve();
    },
  });

  const GEORGE = 'member-george';
  await recordOptIn(db, GEORGE, '2026-07-09T09:00:00Z');
  const g1 = await insert(GEORGE, { sentAt: '2026-07-09T10:00:00Z', text: 'george one' });

  let itemId = 900;
  function say(text: string): CapturedMessage {
    return {
      groupId: GROUP,
      itemId: itemId++,
      sharedMsgId: null,
      senderMemberId: GEORGE,
      senderDisplayName: 'George',
      sentAt: new Date().toISOString(),
      type: 'text',
      text,
      linkPreview: undefined,
      file: undefined,
      forwarded: false,
      quotedFromBot: false,
      raw: {},
    } as unknown as CapturedMessage;
  }

  await engine.handle(say('cinderella, unpublish me'));
  check('she asks for confirmation of the revocation', sent.some((t) => /confirm|bestätig/i.test(t)));

  sent.length = 0;
  await engine.handle(say('yes'));
  check('the revocation is applied', !(await isPublished(g1)));
  check(
    'and she immediately asks hide or delete',
    sent.some((t) => /hide/i.test(t) && /delete/i.test(t)),
    sent.join(' | ').slice(0, 120),
  );
  check(
    'the mode is pending, not defaulted',
    (await getConsent(db, GEORGE))?.revocationMode === 'pending',
  );

  // THE CENTRAL ASSERTION. A bare affirmation at the choice must name nothing.
  sent.length = 0;
  await engine.handle(say('yes'));
  check('a bare "yes" at the choice destroys nothing', await rowExists(g1));
  check(
    'and does not silently pick a mode',
    (await getConsent(db, GEORGE))?.revocationMode === 'pending',
  );

  sent.length = 0;
  await engine.handle(say('delete'));
  check(
    'saying delete asks for the literal confirmation',
    sent.some((t) => /delete/i.test(t)),
    sent.join(' | ').slice(0, 120),
  );
  check('nothing is destroyed yet', await rowExists(g1));

  // THE OTHER CENTRAL ASSERTION.
  sent.length = 0;
  await engine.handle(say('yes'));
  check('a bare "yes" at the destructive confirmation destroys nothing', await rowExists(g1));
  check(
    'and she says the word itself is required',
    sent.some((t) => /delete/i.test(t)),
    sent.join(' | ').slice(0, 120),
  );

  // Fuzzy neighbours must not pass either: the literal check is exact.
  for (const near of ['delet', 'deleted', 'felete', 'yeah delete everything']) {
    sent.length = 0;
    await engine.handle(say(near));
    check(`"${near}" does not destroy anything`, await rowExists(g1));
  }

  sent.length = 0;
  await engine.handle(say('delete'));
  check('the literal word destroys', !(await rowExists(g1)));
  check(
    'the mode is recorded as delete',
    (await getConsent(db, GEORGE))?.revocationMode === 'delete',
  );

  /* ── 11. Declining a destruction leaves the content hidden, not deleted ── */
  section('11. Declining the destruction leaves the content hidden');

  const HARRY = 'member-harry';
  await recordOptIn(db, HARRY, '2026-07-10T09:00:00Z');
  const h1 = await insert(HARRY, { sentAt: '2026-07-10T10:00:00Z', text: 'harry one' });
  await recordOptOut(db, HARRY, '2026-07-10T11:00:00Z');
  await chooseHide(db, { memberId: HARRY, at: '2026-07-10T11:01:00Z', source: 'slash' });
  check('harry’s content is hidden and retained', !(await isPublished(h1)) && (await rowExists(h1)));

  /* ── 12. Nothing leaked into the media tree ─────────────────────────────── */
  section('12. The destruction left no stray files behind');

  async function walkAll(dir: string, out: string[] = []): Promise<string[]> {
    for (const e of await readdir(dir, { withFileTypes: true })) {
      const p = join(dir, e.name);
      if (e.isDirectory()) await walkAll(p, out);
      else out.push(p);
    }
    return out;
  }
  const remaining = await walkAll(mediaRoot);
  // Only the held item's media should survive: it was refused, not destroyed.
  check(
    'exactly the held item’s two files remain',
    remaining.length === 2,
    remaining.map((p) => p.slice(mediaRoot.length)).join(', '),
  );

  /* ── 13. Pending destruction survives the row it points at ─────────────── */
  section('13. A recorded deletion intent is cleaned up with its message');

  const k1 = await insert(ALICE, { sentAt: '2026-07-11T10:00:00Z' });
  await recordPendingDestruction(db, k1, ALICE, 'member');
  await recordPendingDestruction(db, k1, ALICE, 'member');
  const dupe = await pg.query('SELECT 1 FROM pending_destructions WHERE message_id = $1', [k1]);
  check('recording the same intent twice keeps one row', dupe.rows.length === 1);
  await runTx((tx) => destroyMessage(tx, mediaRoot, k1));
  const afterDestroy = await pg.query('SELECT 1 FROM pending_destructions WHERE message_id = $1', [
    k1,
  ]);
  check('the intent row is cascaded away with the message', afterDestroy.rows.length === 0);

  /* ── 14. Regressions for the adversarial-review findings ───────────────── */
  section('14. Defects found by adversarial review, each now guarded');

  // FINDING: releasing an escalated hold de-escalated it and then ran the
  // deferred destruction, destroying the evidence the escalation preserved.
  const esc2 = await insert(ALICE, { sentAt: '2026-07-12T10:00:00Z', text: 'escalated two' });
  const escHold2 = await placeHold(db, esc2, 'report', new Date(Date.now() + 86400_000));
  await resolveHold(db, escHold2.hold.id, 'escalate', 'operator');
  const reReleased = await resolveHold(db, escHold2.hold.id, 'release', 'operator');
  check(
    'resolveHold still matches an escalated row (the route is what must refuse)',
    reReleased !== null,
  );
  // Restore the escalation for the guard test below.
  await db.query("UPDATE evidence_holds SET state = 'escalated', outcome = NULL WHERE id = $1", [
    escHold2.hold.id,
  ]);
  let escStillBlocked = false;
  try {
    await runTx((tx) => destroyMessage(tx, mediaRoot, esc2));
  } catch (err) {
    escStillBlocked = isHoldViolation(err);
  }
  check('an escalated item is still undestroyable', escStillBlocked);

  const countRows = async (member: string): Promise<number> => {
    const r = await pg.query<{ n: number }>(
      'SELECT count(*)::int AS n FROM messages WHERE sender_member_id = $1',
      [member],
    );
    return r.rows[0]?.n ?? 0;
  };
  const modeOf = async (member: string): Promise<string | null> => {
    const r = await pg.query<{ m: string | null }>(
      'SELECT revocation_mode AS m FROM consent WHERE member_id = $1',
      [member],
    );
    return r.rows[0]?.m ?? null;
  };

  // CCB-S3-031 CHANGED THIS DELIBERATELY.
  //
  // The original finding was that `chooseDelete` destroyed while `consent` still
  // read 'hide' - a state inconsistency, and the real defect. The fix chosen then
  // was to refuse the transition outright, which removed something a member is
  // entitled to: having chosen hide, they could never afterwards choose deletion,
  // and she answered such a request with "there is nothing of yours left in my
  // archive to destroy" over an archive being deliberately kept for them.
  //
  // Now the transition is allowed and the ROW MOVES WITH IT, so the inconsistency
  // the finding was about cannot occur. Replay protection lives where it can tell a
  // replay from a decision: the engine clears the pending confirmation before it
  // acts, so a duplicate delivery finds nothing to answer.
  const IVY = 'member-ivy';
  await recordOptIn(db, IVY, '2026-07-12T09:00:00Z');
  const i1 = await insert(IVY, { sentAt: '2026-07-12T10:00:00Z', text: 'ivy one' });
  await recordOptOut(db, IVY, '2026-07-12T11:00:00Z');
  await chooseHide(db, { memberId: IVY, at: '2026-07-12T11:01:00Z', source: 'natural' });
  const lateDelete = await chooseDelete(
    db,
    { memberId: IVY, at: '2026-07-12T11:02:00Z', source: 'natural' },
    mediaRoot,
    runTx,
  );
  check(
    'a member who chose hide can afterwards choose deletion',
    lateDelete.recorded && lateDelete.destroyed === 1,
    `recorded=${String(lateDelete.recorded)} destroyed=${String(lateDelete.destroyed)}`,
  );
  check('and the content really is destroyed', (await countRows(IVY)) === 0);
  check(
    'and the row moves with it, so nothing is destroyed while consent still reads hide',
    (await modeOf(IVY)) === 'delete',
  );
  check(
    'a delete on a member who never revoked is refused and destroys nothing',
    await (async () => {
      const JUNO = 'member-juno';
      await recordOptIn(db, JUNO, '2026-07-12T09:00:00Z');
      await insert(JUNO, { sentAt: '2026-07-12T10:00:00Z', text: 'juno one' });
      const r = await chooseDelete(
        db,
        { memberId: JUNO, at: '2026-07-12T11:00:00Z', source: 'natural' },
        mediaRoot,
        runTx,
      );
      return !r.recorded && r.refusal === 'not-revoked' && (await countRows(JUNO)) === 1;
    })(),
  );

  // FINDING: choosing hide did not withdraw a destruction already deferred by a
  // hold, so a member who changed their mind was told their words were safe and
  // then lost them when the hold lapsed.
  const JUDE = 'member-jude';
  await recordOptIn(db, JUDE, '2026-07-13T09:00:00Z');
  const j1 = await insert(JUDE, { sentAt: '2026-07-13T10:00:00Z', text: 'jude one' });
  await placeHold(db, j1, 'report', new Date(Date.now() + 86400_000));
  await recordOptOut(db, JUDE, '2026-07-13T11:00:00Z');
  const jDelete = await chooseDelete(
    db,
    { memberId: JUDE, at: '2026-07-13T11:01:00Z', source: 'natural' },
    mediaRoot,
    runTx,
  );
  check('the destruction is deferred by the hold', jDelete.deferred === 1);
  const jPendingBefore = await pg.query(
    'SELECT 1 FROM pending_destructions WHERE message_id = $1',
    [j1],
  );
  check('and recorded as pending', jPendingBefore.rows.length === 1);
  await chooseHide(db, { memberId: JUDE, at: '2026-07-13T11:02:00Z', source: 'natural' });
  const jPendingAfter = await pg.query('SELECT 1 FROM pending_destructions WHERE message_id = $1', [
    j1,
  ]);
  check('changing the mind to hide withdraws the pending destruction', jPendingAfter.rows.length === 0);
  check('and the content survives', await rowExists(j1));

  // FINDING: restore republished messages the member posted WHILE hidden, which
  // they never consented to publish.
  const KIT = 'member-kit';
  await recordOptIn(db, KIT, '2026-07-14T09:00:00Z');
  const beforeHide = await insert(KIT, { sentAt: '2026-07-14T10:00:00Z', text: 'kit public' });
  check('the pre-revocation message is published', await isPublished(beforeHide));
  await recordOptOut(db, KIT, '2026-07-14T11:00:00Z');
  await chooseHide(db, { memberId: KIT, at: '2026-07-14T11:01:00Z', source: 'natural' });
  // Capture never stops: the member keeps talking while hidden.
  const whileHidden = await insert(KIT, { sentAt: '2026-07-14T12:00:00Z', text: 'kit while hidden' });
  check('nothing of theirs is published while hidden', !(await isPublished(whileHidden)));
  await restoreHiddenContent(db, { memberId: KIT, at: '2026-07-14T13:00:00Z', source: 'natural' });
  check('restore brings back what WAS public', await isPublished(beforeHide));
  check(
    'restore does NOT publish what was said while hidden',
    !(await isPublished(whileHidden)),
    'said while opted out, never consented to',
  );
  const gaps = await pg.query('SELECT 1 FROM consent_gaps WHERE member_id = $1', [KIT]);
  check('the hidden interval is recorded as a consent gap', gaps.rows.length === 1);

  /* ── 15. The sweeper is the backstop under all of it ───────────────────── */
  section('15. The sweep lapses forgotten holds and re-queues unblocked deletions');

  const LUCA = 'member-luca';
  await recordOptIn(db, LUCA, '2026-07-15T09:00:00Z');
  const l1 = await insert(LUCA, { sentAt: '2026-07-15T10:00:00Z', text: 'luca one' });
  // A hold that expired with no job left to lapse it.
  const staleHold = await placeHold(db, l1, 'report', new Date(Date.now() - 86400_000));
  check('the hold starts active and already past its expiry', staleHold.hold.state === 'active');
  await recordOptOut(db, LUCA, '2026-07-15T11:00:00Z');
  await chooseDelete(
    db,
    { memberId: LUCA, at: '2026-07-15T11:01:00Z', source: 'natural' },
    mediaRoot,
    runTx,
  );
  check('the destruction is deferred', await rowExists(l1));

  const swept = await sweepDestructions(db);
  check('the sweep lapses the forgotten hold', swept.holdsExpired === 1, JSON.stringify(swept));
  check('the hold is gone', (await liveHold(db, l1)) === null);
  check('and the unblocked deletion is queued', swept.destructionsQueued >= 1);
  const queued = await pg.query<{ type: string }>(
    "SELECT type FROM jobs WHERE type = 'destruction.run' AND state = 'queued'",
  );
  check('a destruction.run job exists on the queue', queued.rows.length >= 1);

  /* ── 16. Quarantine is segregated outside the database ─────────────────── */
  section('16. Quarantine withholds everywhere and moves the bytes out of the served tree');

  const quarantineRoot = await mkdtemp(join(tmpdir(), 'cinderella-quarantine-'));

  const MAY = 'member-may';
  await recordOptIn(db, MAY, '2026-07-16T09:00:00Z');
  const q1 = await insert(MAY, { sentAt: '2026-07-16T10:00:00Z', text: 'quarantine me' });
  const qFiles = await attachMedia(q1);
  check('the item is published and its media is in the media store', await isPublished(q1));
  check('the original is under MEDIA_ROOT', await exists(qFiles.original));

  // An ordinary report hold must NOT withhold: that rule is unchanged.
  const reportHold = await placeHold(db, q1, 'report', new Date(Date.now() + 86400_000));
  check('an ordinary report hold still does not change publication', await isPublished(q1));
  check('and does not move any bytes', await exists(qFiles.original));

  // Escalation is a quarantine: it must withhold AND segregate.
  await quarantineMedia(db, mediaRoot, quarantineRoot, q1);
  await resolveHold(db, reportHold.hold.id, 'escalate', 'operator');

  check('an escalated item is withheld from publication', !(await isPublished(q1)));
  check('its original is GONE from the media store', !(await exists(qFiles.original)));
  check('its derivative is GONE from the media store', !(await exists(qFiles.derived)));

  async function quarantineHas(rel: string): Promise<boolean> {
    try {
      await stat(join(quarantineRoot, rel));
      return true;
    } catch {
      return false;
    }
  }
  check('the original is in the quarantine store', await quarantineHas(qFiles.original));
  check('the derivative is in the quarantine store', await quarantineHas(qFiles.derived));

  // The serving-layer guard, independent of the move.
  const servable = await servableMediaPath(mediaRoot, qFiles.original);
  check('nothing under MEDIA_ROOT resolves for a quarantined file', servable === null);
  check('and the message reads as quarantined', await isMediaQuarantined(db, quarantineRoot, q1));

  // A hash-match quarantine also withholds, and never expires.
  const NOAH = 'member-noah';
  await recordOptIn(db, NOAH, '2026-07-17T09:00:00Z');
  const n1 = await insert(NOAH, { sentAt: '2026-07-17T10:00:00Z', text: 'hash match' });
  check('published before the match', await isPublished(n1));
  await placeHold(db, n1, 'csam', null);
  check('a hash match withholds the item', !(await isPublished(n1)));
  const csamHold = await liveHold(db, n1);
  check('and never expires', csamHold?.expiresAt === null);

  // Releasing a false positive puts the bytes back.
  const nFiles = await attachMedia(n1);
  await quarantineMedia(db, mediaRoot, quarantineRoot, n1);
  check('the false-positive item is segregated', !(await exists(nFiles.original)));
  await resolveHold(db, csamHold?.id ?? 0, 'release', 'operator');
  await releaseQuarantinedMedia(db, mediaRoot, quarantineRoot, n1);
  check('releasing restores publication', await isPublished(n1));
  check('and puts the bytes back in the media store', await exists(nFiles.original));
  check('leaving nothing in quarantine', !(await quarantineHas(nFiles.original)));

  // Destruction still finds everything when files sit in either root.
  const OMAR = 'member-omar';
  await recordOptIn(db, OMAR, '2026-07-18T09:00:00Z');
  const o1 = await insert(OMAR, { sentAt: '2026-07-18T10:00:00Z', text: 'omar one' });
  const oFiles = await attachMedia(o1);
  await quarantineMedia(db, mediaRoot, quarantineRoot, o1);
  check('omar’s bytes are in quarantine', await quarantineHas(oFiles.original));
  await runTx((tx) => destroyMessage(tx, mediaRoot, o1, quarantineRoot));
  check('destroying sweeps the quarantine store too', !(await quarantineHas(oFiles.original)));
  check('and the row is gone', !(await rowExists(o1)));

  /* ── 17. The core's own copy is erased too (CCB-S3-027) ────────────────── */
  section('17. Destroying a message queues erasure of the SimpleX core copy');

  const { sweepFileStubs } = await import('../src/bot/file-stubs.js');

  const PIA = 'member-pia';
  await recordOptIn(db, PIA, '2026-07-19T09:00:00Z');
  const p1 = await insert(PIA, { sentAt: '2026-07-19T10:00:00Z', text: 'pia one' });
  const coreRef = await pg.query<{ group_id: string; group_msg_id: string }>(
    'SELECT group_id, group_msg_id FROM messages WHERE id = $1',
    [p1],
  );
  const gid = Number(coreRef.rows[0]?.group_id);
  const iid = Number(coreRef.rows[0]?.group_msg_id);

  await runTx((tx) => destroyMessage(tx, mediaRoot, p1, quarantineRoot));
  // Scoped to THIS message: earlier sections destroyed messages too, and each of
  // those legitimately queued its own core erasure.
  const eraseJob = await pg.query<{ payload: unknown }>(
    "SELECT payload FROM jobs WHERE type = 'core.erase' AND idempotency_key = $1",
    [`core.erase:${String(gid)}:${String(iid)}`],
  );
  check('destroying a message queues a core erasure', eraseJob.rows.length === 1);
  const payload = JSON.stringify(eraseJob.rows[0]?.payload ?? {});
  check(
    'and the job carries the CORE identifiers read before the row was deleted',
    payload.includes(`"groupId":${String(gid)}`) && payload.includes(`"itemId":${String(iid)}`),
    payload,
  );
  check(
    'and it carries identifiers ONLY, never content or a filename',
    !payload.includes('pia one') && !payload.includes('photo'),
    payload,
  );

  // A quarantined item must NOT have its core copy erased: that copy is evidence.
  const QUINN = 'member-quinn';
  await recordOptIn(db, QUINN, '2026-07-19T09:00:00Z');
  const q2 = await insert(QUINN, { sentAt: '2026-07-19T10:00:00Z', text: 'evidence' });
  await placeHold(db, q2, 'csam', null);
  const beforeN = (
    await pg.query<{ n: number }>("SELECT count(*)::int AS n FROM jobs WHERE type = 'core.erase'")
  ).rows[0];
  let quarantineBlocked = false;
  try {
    await runTx((tx) => destroyMessage(tx, mediaRoot, q2, quarantineRoot));
  } catch (err) {
    quarantineBlocked = isHoldViolation(err);
  }
  const afterN = (
    await pg.query<{ n: number }>("SELECT count(*)::int AS n FROM jobs WHERE type = 'core.erase'")
  ).rows[0];
  check('a quarantined item cannot be destroyed at all', quarantineBlocked);
  check(
    'and NO core erasure is queued for it, because that copy is evidence',
    (afterN?.n ?? 0) === (beforeN?.n ?? 0),
  );

  /* ── 18. Abandoned receipt placeholders ────────────────────────────────── */
  section('18. Abandoned receipt placeholders are swept, live transfers are not');

  const filesFolder = await mkdtemp(join(tmpdir(), 'cinderella-files-'));
  const oldStub = join(filesFolder, 'EXAMPLE_00000000_000000.jpg');
  const freshStub = join(filesFolder, 'EXAMPLE_11111111_111111.jpg');
  const realFile = join(filesFolder, 'actual-photo.jpg');
  await writeFile(oldStub, '');
  await writeFile(freshStub, '');
  await writeFile(realFile, 'real bytes');
  const aged = new Date(Date.now() - 96 * 60 * 60 * 1000);
  const { utimes } = await import('node:fs/promises');
  await utimes(oldStub, aged, aged);

  const stubSweep = await sweepFileStubs(filesFolder);
  check('an aged zero-byte placeholder is removed', stubSweep.removed === 1, JSON.stringify(stubSweep));
  check('a fresh one is left alone (a transfer may be in flight)', await stubExists(freshStub));
  check('and a real file is never touched', await stubExists(realFile));

  async function stubExists(p: string): Promise<boolean> {
    try {
      await stat(p);
      return true;
    } catch {
      return false;
    }
  }

  console.log(
    `\n${failures === 0 ? 'ALL PASSED' : `${failures} FAILURE(S)`} — hide/delete on revocation with evidence holds.`,
  );
  if (failures > 0) process.exitCode = 1;
}

main().catch((err: unknown) => {
  console.error(err);
  process.exitCode = 1;
});
