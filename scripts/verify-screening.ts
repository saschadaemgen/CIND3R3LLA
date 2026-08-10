/**
 * Verification harness — encryption at rest and hash screening (CCB-S3-012).
 *
 * Real code against PGlite and a real temporary media tree: the real migrations,
 * the real publish views, the real at-rest envelope, the real quarantine move, the
 * real DB hold trigger.
 *
 * NO REAL MATERIAL IS INVOLVED, and that is the point of the fixture provider: the
 * whole pipeline (screen, match, quarantine, segregate, withhold, resist deletion)
 * is exercised against a few bytes of ASCII whose SHA-256 is put on a local list.
 *
 *   npx tsx scripts/verify-screening.ts
 */

import { mkdtemp, mkdir, readFile, writeFile, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { PGlite } from '@electric-sql/pglite';
import { vector } from '@electric-sql/pglite-pgvector';

import { destroyMessage } from '../src/archive/destroy.js';
import { isHoldViolation } from '../src/consent/revocation.js';
import { recordOptIn } from '../src/db/consent.js';
import { isQuarantined, liveHold } from '../src/db/holds.js';
import { loadMigrationFiles } from '../src/db/migrate.js';
import { setModerationState, upsertMessage } from '../src/db/messages.js';
import type { Queryable } from '../src/db/pool.js';
import {
  encryptFileInPlace,
  isEncryptedFile,
  mediaEncryptionEnabled,
  mediaPlaintextSize,
  readMediaFile,
  resetMediaKey,
  writeMediaFile,
} from '../src/media/at-rest.js';
import { createFixtureProvider, sha256Hex } from '../src/screening/fixture-provider.js';
import {
  activeScreeningProvider,
  clearScreeningAttempts,
  recentScreeningAttempts,
  screenMessage,
  screeningHealth,
  setScreeningProvider,
} from '../src/screening/service.js';
import { nullScreeningProvider } from '../src/screening/types.js';

let failures = 0;
function check(label: string, ok: boolean, detail = ''): void {
  if (!ok) failures++;
  console.log(`  [${ok ? 'PASS' : 'FAIL'}] ${label}${detail ? ` — ${detail}` : ''}`);
}
function section(title: string): void {
  console.log(`\n${title}`);
}

const GROUP = 1;
const MEMBER = 'member-mallory';
/** Benign fixture content. Nothing about this is, or resembles, real material. */
const FIXTURE_BYTES = Buffer.from('cinderella-benign-screening-fixture-v1', 'utf8');

async function main(): Promise<void> {
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
  for (const m of await loadMigrationFiles()) await pg.exec(m.sql);

  const mediaRoot = await mkdtemp(join(tmpdir(), 'cinderella-screen-media-'));
  const quarantineRoot = await mkdtemp(join(tmpdir(), 'cinderella-screen-quar-'));
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

  let next = 500;
  async function insert(text: string): Promise<number> {
    const groupMsgId = next++;
    await upsertMessage(db, {
      groupId: GROUP,
      groupMsgId,
      sharedMsgId: null,
      senderMemberId: MEMBER,
      senderDisplayName: MEMBER,
      sentAt: '2026-07-20T10:00:00Z',
      type: 'image',
      textBody: text,
      linksText: null,
      rawJson: { id: groupMsgId },
    });
    const r = await pg.query<{ id: string }>(
      'SELECT id FROM messages WHERE group_id = $1 AND group_msg_id = $2',
      [GROUP, groupMsgId],
    );
    return Number(r.rows[0]?.id);
  }

  async function attach(id: number, bytes: Buffer): Promise<string> {
    const rel = `2026/07/700${id}-photo.jpg`;
    await mkdir(join(mediaRoot, '2026', '07'), { recursive: true });
    await writeMediaFile(join(mediaRoot, rel), bytes);
    await db.query(
      'UPDATE messages SET media_path = $2, media_mime = $3 WHERE id = $1',
      [id, rel, 'image/jpeg'],
    );
    return rel;
  }

  async function isPublished(id: number): Promise<boolean> {
    const r = await pg.query<{ published: boolean }>(
      'SELECT published FROM message_publish_state WHERE id = $1',
      [id],
    );
    return r.rows[0]?.published === true;
  }

  /* ── 1. Encryption at rest ─────────────────────────────────────────────── */
  section('1. Originals are encrypted at rest; a raw read yields no usable image');

  delete process.env['MEDIA_SECRET'];
  resetMediaKey();
  check('with no MEDIA_SECRET, encryption is OFF and that is a choice', !mediaEncryptionEnabled());

  await recordOptIn(db, MEMBER, '2026-07-19T09:00:00Z');
  const plainId = await insert('stored before encryption');
  const plainRel = await attach(plainId, FIXTURE_BYTES);
  check('a file written with encryption off is plaintext on disk', !(await isEncryptedFile(join(mediaRoot, plainRel))));

  process.env['MEDIA_SECRET'] = 'x'.repeat(48);
  resetMediaKey();
  check('with MEDIA_SECRET set, encryption is ON', mediaEncryptionEnabled());

  const encId = await insert('stored after encryption');
  const encRel = await attach(encId, FIXTURE_BYTES);
  const encAbs = join(mediaRoot, encRel);
  check('a newly written original is encrypted on disk', await isEncryptedFile(encAbs));

  const raw = await readFile(encAbs);
  check(
    'a RAW read yields no usable image (the plaintext is not present in the file)',
    !raw.includes(FIXTURE_BYTES),
  );
  check('and it is wrapped in the Cinderella envelope', raw.subarray(0, 6).toString() === 'CINDM1');

  const roundTripped = await readMediaFile(encAbs);
  check('the at-rest reader round-trips the exact bytes', roundTripped.equals(FIXTURE_BYTES));

  const onDisk = (await stat(encAbs)).size;
  const plaintextSize = await mediaPlaintextSize(encAbs);
  check(
    'the PLAINTEXT size is reported, not the on-disk size (byte ranges depend on it)',
    plaintextSize === FIXTURE_BYTES.length && onDisk === plaintextSize + 34,
    `disk=${String(onDisk)} plaintext=${String(plaintextSize)}`,
  );

  // A mixed tree must keep working: this is what lets encryption be switched on
  // for an archive that already has plaintext media in it.
  check(
    'a legacy PLAINTEXT file still reads correctly through the same reader',
    (await readMediaFile(join(mediaRoot, plainRel))).equals(FIXTURE_BYTES),
  );
  check('and the backfill encrypts it', await encryptFileInPlace(join(mediaRoot, plainRel)));
  check('after which it is encrypted', await isEncryptedFile(join(mediaRoot, plainRel)));
  check(
    're-running the backfill on an encrypted file is a no-op, never a second layer',
    !(await encryptFileInPlace(join(mediaRoot, plainRel))),
  );
  check(
    'and it still decrypts to the original bytes',
    (await readMediaFile(join(mediaRoot, plainRel))).equals(FIXTURE_BYTES),
  );

  // A wrong key must FAIL, not silently hand back ciphertext to serve.
  process.env['MEDIA_SECRET'] = 'y'.repeat(48);
  resetMediaKey();
  let wrongKeyThrew = false;
  try {
    await readMediaFile(encAbs);
  } catch {
    wrongKeyThrew = true;
  }
  check('a WRONG key throws rather than returning ciphertext', wrongKeyThrew);
  process.env['MEDIA_SECRET'] = 'x'.repeat(48);
  resetMediaKey();

  /* ── 2. The default configuration transmits nothing ────────────────────── */
  section('2. The default provider forms no opinion and contacts nothing');

  clearScreeningAttempts();
  setScreeningProvider(null);
  check('the shipped provider is the null provider', activeScreeningProvider().name === 'none');
  check('which does not transmit content', !activeScreeningProvider().transmitsContent);

  let bytesRead = false;
  const nullOutcome = await nullScreeningProvider.screen({
    messageId: encId,
    mime: 'image/jpeg',
    bytes: () => {
      bytesRead = true;
      return Promise.resolve(FIXTURE_BYTES);
    },
  });
  check('it answers not-screened', nullOutcome.verdict === 'not-screened');
  check(
    'and it never even decrypts the original',
    !bytesRead,
    'the bytes callback was not invoked',
  );

  const cleanId = await insert('a clean image');
  await attach(cleanId, Buffer.from('something else entirely', 'utf8'));
  const nullRun = await screenMessage(
    db,
    { mediaRoot, quarantineRoot },
    { id: cleanId, mediaPath: `2026/07/700${cleanId}-photo.jpg`, mime: 'image/jpeg' },
  );
  check('screening with no provider quarantines nothing', !nullRun.quarantined);
  check('and records not-screened', nullRun.result.verdict === 'not-screened');

  /* ── 3. An unconfigured provider is never called ───────────────────────── */
  section('3. A provider that is not configured is never consulted');

  let calledWhenUnconfigured = false;
  setScreeningProvider(
    createFixtureProvider({
      enabled: () => false,
      hashes: () => {
        calledWhenUnconfigured = true;
        return [];
      },
    }),
  );
  check(
    'an unconfigured provider is replaced by the null provider',
    activeScreeningProvider().name === 'none',
  );
  check('so its configuration is never consulted at screen time', !calledWhenUnconfigured);

  /* ── 4. The fixture provider matches, and the match quarantines ────────── */
  section('4. A fixture match quarantines, preserves, withholds and alerts');

  const fixtureHash = sha256Hex(FIXTURE_BYTES);
  setScreeningProvider(
    createFixtureProvider({ enabled: () => true, hashes: () => [fixtureHash] }),
  );
  check('the fixture provider is active', activeScreeningProvider().name === 'fixture');
  check('and it transmits nothing off the host', !activeScreeningProvider().transmitsContent);

  const matchId = await insert('the fixture image');
  const matchRel = await attach(matchId, FIXTURE_BYTES);
  check('it is published before screening', await isPublished(matchId));

  const outcome = await screenMessage(
    db,
    { mediaRoot, quarantineRoot },
    { id: matchId, mediaPath: matchRel, mime: 'image/jpeg' },
  );
  check('the verdict is a match', outcome.result.verdict === 'match');
  check('the item is quarantined', outcome.quarantined);
  check('the DB agrees it is quarantined', await isQuarantined(db, matchId));

  // 1. Unreachable by every public path — via the derivation, which every public
  // reader goes through.
  check('it is WITHHELD from publication', !(await isPublished(matchId)));

  // 2. Preserved, and segregated out of the served tree.
  check('the original is GONE from the media store', !(await fileExists(join(mediaRoot, matchRel))));
  check(
    'and PRESERVED in the quarantine store',
    await fileExists(join(quarantineRoot, matchRel)),
  );
  check(
    'still encrypted where it now sits',
    await isEncryptedFile(join(quarantineRoot, matchRel)),
  );

  const hold = await liveHold(db, matchId);
  check('a hash-match hold exists', hold?.source === 'csam');
  check('and it NEVER expires', hold?.expiresAt === null);

  // 4. Audited: the event, not the content.
  const audit = await pg.query<{ action: string; details: unknown }>(
    "SELECT action, details FROM audit_log WHERE action = 'screening.match'",
  );
  check('the match is audited', audit.rows.length === 1);
  const detailsJson = JSON.stringify(audit.rows[0]?.details ?? {});
  check(
    'and the audit record contains no content and no hash',
    !detailsJson.includes(fixtureHash) && !detailsJson.includes(FIXTURE_BYTES.toString('utf8')),
    detailsJson,
  );

  const attemptLog = JSON.stringify(recentScreeningAttempts(10));
  check(
    'the screening activity log records no hash and no content either',
    !attemptLog.includes(fixtureHash) && !attemptLog.includes(FIXTURE_BYTES.toString('utf8')),
  );

  const health = screeningHealth(activeScreeningProvider());
  check('provider health counts the match', health.matches === 1, JSON.stringify(health));

  /* ── 5. A quarantined item resists every deletion path ─────────────────── */
  section('5. A quarantined item cannot be deleted by any path');

  let memberDeleteBlocked = false;
  try {
    await runTx((tx) => destroyMessage(tx, mediaRoot, matchId, quarantineRoot));
  } catch (err) {
    memberDeleteBlocked = isHoldViolation(err);
  }
  check('a member deletion cannot destroy it', memberDeleteBlocked);

  let rawSqlBlocked = false;
  try {
    await db.query('DELETE FROM messages WHERE id = $1', [matchId]);
  } catch {
    rawSqlBlocked = true;
  }
  check('a direct SQL DELETE cannot destroy it', rawSqlBlocked);

  // An operator takedown HIDES and must still work; it must not destroy.
  await setModerationState(db, matchId, 'rejected');
  check('an operator takedown still works', !(await isPublished(matchId)));
  check('and did not destroy it', await rowExists(matchId));
  check('the preserved original is still there', await fileExists(join(quarantineRoot, matchRel)));

  /* ── 6. No preview is ever generated for a quarantined item ────────────── */
  section('6. A quarantined item never gets a preview, thumbnail or derivative');

  const { stripAndRecord } = await import('../src/media/pipeline.js');
  const record = await stripAndRecord(db, mediaRoot, matchId, matchRel, 'image/jpeg');
  check('the derivative producer refuses', record.skipped === 'quarantined');
  const derived = await pg.query<{ media_derived_path: string | null }>(
    'SELECT media_derived_path FROM messages WHERE id = $1',
    [matchId],
  );
  check('and no derivative path was recorded', !derived.rows[0]?.media_derived_path);
  check(
    'and nothing was written into the derived tree',
    !(await fileExists(join(mediaRoot, 'derived', '2026', '07', `${String(matchId)}.jpg`))),
  );

  /* ── 7. A failing provider degrades and never drops the message ────────── */
  section('7. A failing provider degrades to a retryable fault, never a false clean');

  setScreeningProvider({
    name: 'flaky',
    label: 'Failing provider',
    transmitsContent: true,
    isConfigured: () => true,
    screen: () => Promise.reject(new Error('provider unreachable')),
  });
  const flakyId = await insert('during an outage');
  const flakyRel = await attach(flakyId, Buffer.from('unrelated bytes', 'utf8'));
  let screeningThrew = false;
  try {
    await screenMessage(
      db,
      { mediaRoot, quarantineRoot },
      { id: flakyId, mediaPath: flakyRel, mime: 'image/jpeg' },
    );
  } catch {
    screeningThrew = true;
  }
  check('a provider failure throws, so the queue retries it', screeningThrew);
  check('the message itself is untouched', await rowExists(flakyId));
  check('and it is NOT quarantined on a provider error', !(await isQuarantined(db, flakyId)));
  // A provider error must leave NO trace that could be read as a clean verdict:
  // no hold, no audit row, and an attempt recorded explicitly as an error.
  const flakyAudit = await pg.query(
    "SELECT 1 FROM audit_log WHERE target = $1 AND action = 'screening.match'",
    [`message:${String(flakyId)}`],
  );
  check('no match is audited for a failed screening', flakyAudit.rows.length === 0);
  check(
    'and the attempt is recorded as an ERROR, never as no-match',
    recentScreeningAttempts(5).some((a) => a.messageId === flakyId && a.verdict === 'error'),
  );
  const errHealth = screeningHealth(activeScreeningProvider());
  check('the failure is visible in provider health', errHealth.errors === 1);

  async function fileExists(p: string): Promise<boolean> {
    try {
      await stat(p);
      return true;
    } catch {
      return false;
    }
  }

  async function rowExists(id: number): Promise<boolean> {
    const r = await pg.query('SELECT 1 FROM messages WHERE id = $1', [id]);
    return r.rows.length > 0;
  }

  console.log(
    `\n${failures === 0 ? 'ALL PASSED' : `${String(failures)} FAILURE(S)`} — encryption at rest and hash screening.`,
  );
  if (failures > 0) process.exitCode = 1;
}

main().catch((err: unknown) => {
  console.error(err);
  process.exitCode = 1;
});
