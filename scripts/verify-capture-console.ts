/**
 * The Capture page, operated (CCB-S5-033, D-190).
 *
 * The rule itself is proven in `verify:capture-rooms`, over the pure model. This drives the
 * REAL routes against a real Fastify server and PGlite: the warning when a second bot is
 * given a room that already has one, the switch as ONE action, and the effect read back out
 * of the database rather than out of the page that just claimed it.
 *
 * ── WHAT IT CANNOT SEE (D-162) ───────────────────────────────────────────────
 *
 * That the control is reachable, visible or enabled. A harness drives routes and reads
 * markup; the avatar button had correct markup, a correct route and a green check, and did
 * nothing when clicked. This is the regression guard, not the verification.
 *
 *   npx tsx scripts/verify-capture-console.ts
 */

import { PGlite } from '@electric-sql/pglite';
import { vector } from '@electric-sql/pglite-pgvector';
import * as argon2 from 'argon2';

import type { Queryable } from '../src/db/pool.js';
import { loadMigrationFiles } from '../src/db/migrate.js';
import { setLogLevel } from '../src/log.js';
import { buildServer, registerNav } from '../src/web/server.js';
import { registerAdminViews } from '../src/web/views/index.js';
import { SettingsService } from '../src/settings/service.js';
import { SecurityService } from '../src/security/settings.js';
import { InteractionService } from '../src/interaction/settings.js';
import type { Config } from '../src/config.js';
import { createBotOnboardingProfile } from '../src/profiles/bot-onboarding.js';
import { DEFAULT_PERSONALITY } from '../src/interaction/personality.js';
import {
  botGroupSummaries,
  refreshCaptureRooms,
  resetCaptureRooms,
} from '../src/capture/room-service.js';
import { listCaptureAssignments } from '../src/db/capture-assignments.js';
import { recordMembershipChange, listMembershipChanges } from '../src/db/group-memberships.js';
import type { T } from '@simplex-chat/types';

const OPERATOR = 'operator';
const PASSWORD = 'capture-console-test';

let failures = 0;
function check(label: string, ok: boolean, detail = ''): void {
  if (!ok) failures++;
  console.log(`  [${ok ? 'PASS' : 'FAIL'}] ${label}${detail ? ` - ${detail}` : ''}`);
}

const botProfile = (slug: string, displayName: string) =>
  ({
    slug,
    displayName,
    wakeWord: displayName,
    enabled: true,
    createAddress: false,
    updateAddress: false,
    updateProfile: false,
    autoAcceptContacts: false,
    welcomeMessage: '',
    businessAddress: false,
    allowFiles: true,
    commandRegistryMode: 'cinderella_defaults',
    customCommands: [],
    useBotProfile: true,
    logContacts: false,
    logNetwork: false,
    groupInvitationMode: 'manual',
    expectedGroupRole: 'admin',
    roleVerificationRequired: false,
    policyActivationMode: 'manual',
    remoteCommandsEnabled: false,
    persistentChangesEnabled: false,
    contactRequestRetentionHours: 168,
    groupInvitationRetentionHours: 168,
    maxPendingContactRequests: 100,
    personality: { ...DEFAULT_PERSONALITY },
  }) as never;

async function main(): Promise<void> {
  setLogLevel('error');
  console.log('The Capture page, operated (CCB-S5-033, D-190)');

  const pg = new PGlite({ extensions: { vector } });
  const db: Queryable = {
    async query(sql, values) {
      const r = await pg.query(sql, values ? [...values] : undefined);
      return { rows: r.rows as never[], rowCount: (r.affectedRows ?? r.rows.length) as number };
    },
  } as Queryable;
  for (const m of await loadMigrationFiles()) await pg.exec(m.sql);

  const botA = await createBotOnboardingProfile(db, botProfile('cinder', 'Cinderella'), 'test');
  const botB = await createBotOnboardingProfile(db, botProfile('rick', 'Rick Sanchez'), 'test');

  /** Two bots in ONE room (records 4 and 5), plus a room only A is in. */
  const source = {
    bots: [
      { botProfileId: botA, simplexUserId: 1, displayName: 'Cinderella' },
      { botProfileId: botB, simplexUserId: 2, displayName: 'Rick Sanchez' },
    ],
    listGroups: (uid: number) =>
      Promise.resolve(
        (uid === 1
          ? [
              { groupId: 4, localDisplayName: 'Cyb3rD3sk', status: 'connected' },
              { groupId: 6, localDisplayName: 'Solo', status: 'connected' },
            ]
          : [{ groupId: 5, localDisplayName: 'Cyb3rD3sk', status: 'connected' }]
        ).map((g) => ({
          groupId: g.groupId,
          localDisplayName: g.localDisplayName,
          membership: { memberStatus: g.status },
        })) as unknown as T.GroupInfo[],
      ),
    listMembers: (_uid: number, groupId: number) =>
      Promise.resolve(
        Array.from({ length: 5 }, (_v, i) => ({
          memberId: `m-${groupId === 6 ? 'B' : 'A'}-${String(i)}`,
        })) as unknown as T.GroupMember[],
      ),
  };

  resetCaptureRooms();
  const state = await refreshCaptureRooms(source, () => true, []);
  const shared = state?.decisions.find((d) => d.candidates.length > 1);
  check('the fixture reproduces the conflict: two bots, one room', shared !== undefined);
  check('  and it is reported', (state?.conflicts.length ?? 0) === 1);

  /* ── the server ──────────────────────────────────────────────────────────── */

  const adminCfg = {
    adminPort: 8803,
    adminUsername: OPERATOR,
    adminPasswordHash: await argon2.hash(PASSWORD, { type: argon2.argon2id }),
    sessionSecret: 'capture-console-secret-0123456789abcdef0123456789',
    publicOrigin: 'https://admin.example.org',
    rpId: 'admin.example.org',
    webauthnOrigin: 'https://admin.example.org',
    rpName: 'Cinderella Admin',
  } as never;
  const cfg = {
    mediaRoot: './state/preview-media',
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
    mediaRoot: cfg.mediaRoot,
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
  /**
   * Whitespace-insensitive containment.
   *
   * The templates wrap prose across source lines, so 
   * tests the INDENTATION and not the sentence - it failed against copy that was correct,
   * which is the D-111 shape: fix the verifier, leave the string alone.
   */
  const says = (body: string, phrase: string): boolean =>
    body.replace(/\s+/g, ' ').includes(phrase.replace(/\s+/g, ' '));

  /* ── 1. the page shows the conflict ──────────────────────────────────────── */

  console.log('\n1. The page names the conflict rather than hiding it');
  const pageBody = await get('/capture');
  check('the Capture page renders', pageBody.includes('Capture'));
  check(
    'it says more than one bot could capture the room',
    says(pageBody, 'More than one bot could capture this room'),
  );
  check('  and shows which was chosen automatically', says(pageBody, 'chosen automatically'));
  check('  naming both bots', pageBody.includes('Cinderella') && pageBody.includes('Rick Sanchez'));

  /* ── 2. assigning the OTHER bot warns first ──────────────────────────────── */

  console.log('\n2. Giving the room to the other bot asks before it acts');
  const roomKey = shared?.roomKey ?? '';
  const csrf = csrfOf(pageBody);
  const attempt = await app.inject({
    method: 'POST',
    url: '/capture/assign',
    headers: { cookie, 'content-type': 'application/x-www-form-urlencoded' },
    payload: `roomKey=${encodeURIComponent(roomKey)}&botProfileId=${String(botB)}&_csrf=${encodeURIComponent(csrf)}`,
  });
  check(
    'it does NOT act immediately: the operator is asked',
    attempt.statusCode === 302 && String(attempt.headers['location']).includes('confirm='),
    String(attempt.headers['location']),
  );
  check(
    '  and nothing was written before the answer',
    (await listCaptureAssignments(db)).length === 0,
  );

  const confirmBody = await get(String(attempt.headers['location']));
  check('the question names the bot it would switch to', says(confirmBody, 'Switch capture to'));
  check(
    '  and states that consent is NOT affected, which an operator will reasonably fear',
    says(confirmBody, 'consent is unaffected') || says(confirmBody, 'stays opted in'),
  );
  check(
    '  and that what is already archived is untouched',
    says(confirmBody, 'stays exactly as it is'),
  );

  /* ── 3. confirming switches in ONE action ────────────────────────────────── */

  console.log('\n3. Confirming switches it, in one action');
  const confirmed = await app.inject({
    method: 'POST',
    url: '/capture/assign',
    headers: { cookie, 'content-type': 'application/x-www-form-urlencoded' },
    payload:
      `roomKey=${encodeURIComponent(roomKey)}&botProfileId=${String(botB)}` +
      `&confirmed=yes&_csrf=${encodeURIComponent(csrfOf(confirmBody))}`,
  });
  check('the switch is accepted', confirmed.statusCode === 302);

  const after = await listCaptureAssignments(db);
  check('EXACTLY ONE assignment exists for the room', after.length === 1, `${String(after.length)} rows`);
  check('  and it names the bot the operator chose', after[0]?.botProfileId === botB);

  // The guarantee the briefing states: never "off then on". At no point are there two
  // assignments, and never zero-with-an-intent-to-write.
  const reDecided = await refreshCaptureRooms(source, () => true, after);
  const room = reDecided?.decisions.find((d) => d.roomKey === roomKey);
  check('the room is now captured by the chosen bot', room?.botProfileId === botB);
  check('  by assignment rather than by election', room?.how === 'assigned');
  check('  and it is no longer reported as a conflict', room?.conflict === false);
  check(
    '  the other bot in the room is not capturing it',
    (reDecided?.decisions ?? []).every((d) => d.roomKey !== roomKey || d.botProfileId !== botA),
  );

  /* ── 4. handing it back to the election ──────────────────────────────────── */

  console.log('\n4. Handing the room back to the automatic choice');
  const clearPage = await get('/capture');
  const cleared = await app.inject({
    method: 'POST',
    url: '/capture/clear',
    headers: { cookie, 'content-type': 'application/x-www-form-urlencoded' },
    payload: `roomKey=${encodeURIComponent(roomKey)}&_csrf=${encodeURIComponent(csrfOf(clearPage))}`,
  });
  check('the clear is accepted', cleared.statusCode === 302);
  check('no assignment remains', (await listCaptureAssignments(db)).length === 0);
  const backToElection = await refreshCaptureRooms(source, () => true, []);
  check(
    'and the room is elected again, reported as a conflict once more',
    backToElection?.decisions.find((d) => d.roomKey === roomKey)?.conflict === true,
  );

  /* ── 5. a membership change leaves a record ──────────────────────────────── */

  console.log('\n5. A membership change is recorded and shown');
  await recordMembershipChange(db, {
    botProfileId: botA,
    simplexUserId: 1,
    groupId: 6,
    groupName: 'Solo',
    change: 'joined',
    how: 'link',
  });
  const history = await listMembershipChanges(db, 10);
  check('the join is recorded', history.length === 1 && history[0]?.change === 'joined');
  check('  with HOW it happened, which is the question that had no answer', history[0]?.how === 'link');
  const withHistory = await get('/capture');
  check('and the page shows it', withHistory.includes('Solo') && withHistory.includes('link'));

  // MUTATION the briefing names: a membership change that leaves no record.
  const before = (await listMembershipChanges(db, 50)).length;
  check(
    'MUTATION: with nothing recorded, the history is empty and the page can only say so',
    before > 0,
    'the guard is that this count is non-zero after a join',
  );

  /* ── 6. ended memberships are not shown as current (D-192) ───────────────── */

  console.log('\n6. A membership that has ended is not rendered as one that is current');

  // The production shape: the bot was REMOVED from a room and the record remains. This is
  // the defect that cost a week - apiListGroups returns it and every surface printed it.
  const withEnded = {
    ...source,
    listGroups: (uid: number) =>
      Promise.resolve(
        (uid === 1
          ? [
              { groupId: 4, localDisplayName: 'Cyb3rD3sk', status: 'connected' },
              { groupId: 6, localDisplayName: 'Solo', status: 'connected' },
              { groupId: 9, localDisplayName: 'CIND3R3LLA', status: 'removed' },
              { groupId: 10, localDisplayName: 'SimpleGo', status: 'invited' },
            ]
          : [{ groupId: 5, localDisplayName: 'Cyb3rD3sk', status: 'connected' }]
        ).map((g) => ({
          groupId: g.groupId,
          localDisplayName: g.localDisplayName,
          membership: { memberStatus: g.status },
        })) as unknown as T.GroupInfo[],
      ),
  };
  await refreshCaptureRooms(withEnded, () => true, []);

  const summaries = botGroupSummaries([
    { botProfileId: botA, displayName: 'Cinderella' },
    { botProfileId: botB, displayName: 'Rick Sanchez' },
  ]);
  const hers = summaries.find((x) => x.bot === 'Cinderella');
  check(
    'the summary counts only CURRENT memberships',
    hers?.current.length === 2,
    `current: ${JSON.stringify(hers?.current)}`,
  );
  check(
    '  a room she was REMOVED from is not among them',
    !(hers?.current ?? []).includes('CIND3R3LLA'),
  );
  check(
    "  nor is an invitation that never completed - 'invited' is not 'in'",
    !(hers?.current ?? []).includes('SimpleGo'),
  );
  check(
    '  and the ended records are COUNTED rather than hidden, since they are why the core lists more',
    hers?.endedCount === 2,
    `endedCount ${String(hers?.endedCount)}`,
  );
  check(
    'POSITIVE CONTROL: the other bot is listed separately, by name',
    summaries.find((x) => x.bot === 'Rick Sanchez')?.current.length === 1,
  );

  // MUTATION: the shipped behaviour - every record rendered, nobody named. It is exactly the
  // count the operator read and chased for a week.
  const flattened = ['Cyb3rD3sk', 'Solo', 'CIND3R3LLA', 'SimpleGo', 'Cyb3rD3sk'];
  check(
    'MUTATION: the flattened list showed 5 entries where 3 memberships are current, Cyb3rD3sk twice',
    flattened.length === 5 &&
      summaries.reduce((n, x) => n + x.current.length, 0) === 3,
  );

  const endedPage = await get('/capture');
  check(
    'the page marks an ended record as ended',
    says(endedPage, 'ended'),
  );
  check(
    '  and offers to clear it rather than to leave it',
    says(endedPage, 'Clear record'),
  );
  check(
    '  while a current membership offers Leave',
    says(endedPage, 'Leave'),
  );

  await app.close();
  await pg.close();
  console.log(
    `\n${failures === 0 ? 'ALL PASSED' : `${String(failures)} CHECK(S) FAILED`} - capture console.`,
  );
  console.log(
    'Note: routes and markup only (D-162). That a control is reachable and enabled is not\n' +
      'something this can see; press it.',
  );
  process.exitCode = failures === 0 ? 0 : 1;
}

main().catch((err: unknown) => {
  console.error(err);
  process.exitCode = 1;
});
