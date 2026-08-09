/**
 * Creating a bot, and which one is the primary (CCB-S5-008).
 *
 *   npx tsx scripts/verify-primary-bot.ts
 *
 * ── THE DEFECT ───────────────────────────────────────────────────────────────
 *
 * `selected_for_runtime` used to mean "this bot runs". Under D-155 every enabled bot runs,
 * the column came to mean "this bot is the primary", and nothing renamed it. What the
 * operator was left with was a wizard toggle called "select for the runtime", defaulted ON,
 * that had to be answered to create a second bot which by definition must not hold it, and
 * which the unique index from 019 then refused. The operator's own words were that he did
 * not understand the workflow, which is the report that matters: the constraint was right
 * and the workflow was wrong.
 *
 * ── WHAT IS ASSERTED, AND WHY EACH ONE HAS A CONTROL BESIDE IT ───────────────
 *
 * "Creating a bot does not make it the primary" passes trivially against an implementation
 * that never sets the flag at all, which would leave a deployment with no primary and no way
 * to get one. So the pairs are: the FIRST bot created takes it AND the second does not; the
 * flag does not move on create AND it does move on {@link setPrimaryBot}; an unknown id is
 * refused AND the primary that was there is still there afterwards, which is the assertion
 * that fails the day the clear-then-set pair stops being one transaction.
 *
 * The load-bearing one is section 2. The input type no longer carries the field, so nothing
 * in `src/` can ask for it, but a form post is an untyped object and the old name may still
 * be in somebody's saved request or a stale page. Passing it anyway and proving it is
 * IGNORED is the check that the removal is real rather than cosmetic.
 *
 * No SimpleX core is started and no production database is used.
 */

import { PGlite } from '@electric-sql/pglite';
import argon2 from 'argon2';
import { loadMigrationFiles } from '../src/db/migrate.js';
import type { Queryable } from '../src/db/pool.js';
import {
  createBotOnboardingProfile,
  deleteBotOnboardingProfile,
  listBotOnboardingProfiles,
  setPrimaryBot,
  updateBotOnboardingProfile,
  type BotOnboardingInput,
} from '../src/profiles/bot-onboarding.js';
import { DEFAULT_PERSONALITY } from '../src/interaction/personality.js';
import { buildServer, registerNav } from '../src/web/server.js';
import { registerAdminViews } from '../src/web/views/index.js';
import { SettingsService } from '../src/settings/service.js';
import { SecurityService } from '../src/security/settings.js';
import { InteractionService } from '../src/interaction/settings.js';
import { setLogLevel } from '../src/log.js';
import type { AdminConfig, Config } from '../src/config.js';

let failures = 0;
const PASSWORD = 'correct-horse-battery-staple';
const OPERATOR = 'operator';

function check(label: string, ok: boolean, detail = ''): void {
  if (!ok) failures++;
  console.log(`  [${ok ? 'PASS' : 'FAIL'}] ${label}${detail ? `: ${detail}` : ''}`);
}
function section(title: string): void {
  console.log(`\n${title}`);
}

function botInput(slug: string, displayName: string): BotOnboardingInput {
  return {
    slug,
    displayName,
    enabled: true,
    createAddress: true,
    updateAddress: true,
    updateProfile: true,
    autoAcceptContacts: true,
    welcomeMessage: '',
    businessAddress: false,
    allowFiles: true,
    commandRegistryMode: 'cinderella_defaults',
    customCommands: [],
    useBotProfile: true,
    logContacts: true,
    logNetwork: false,
    groupInvitationMode: 'manual',
    expectedGroupRole: 'admin',
    roleVerificationRequired: true,
    policyActivationMode: 'manual',
    remoteCommandsEnabled: false,
    persistentChangesEnabled: false,
    contactRequestRetentionHours: 168,
    groupInvitationRetentionHours: 168,
    maxPendingContactRequests: 100,
    personality: { ...DEFAULT_PERSONALITY },
  };
}

/** Which bot holds the flag, read back through the real listing. */
async function primaryOf(db: Queryable): Promise<number | null> {
  const found = (await listBotOnboardingProfiles(db)).filter((p) => p.selectedForRuntime);
  // More than one is unrepresentable under the index; if it ever happens, say so loudly
  // rather than returning the first and reporting a pass.
  if (found.length > 1) throw new Error(`Two bots hold the primary flag: ${found.length}`);
  return found[0]?.id ?? null;
}

async function main(): Promise<void> {
  setLogLevel('error');

  const pg = new PGlite();
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

  /* ── 1 ─────────────────────────────────────────────────────────────────── */

  section('1. Creating a bot is not a decision about the primary');

  check('no bots, so no primary', (await primaryOf(db)) === null);

  const first = await createBotOnboardingProfile(db, botInput('cinderella', 'CIND3R3LLA'), OPERATOR);
  check('the FIRST bot created is the primary, because nothing else is', (await primaryOf(db)) === first);

  // The operator's actual defect: this used to be refused by the unique index, because the
  // wizard defaulted the toggle on and the second bot arrived claiming the flag.
  const second = await createBotOnboardingProfile(db, botInput('aurora', 'Aurora'), OPERATOR);
  check('a SECOND bot is created without being refused', second > 0, `id ${String(second)}`);
  check('and it is not the primary', (await primaryOf(db)) === first);

  const third = await createBotOnboardingProfile(db, botInput('atlas', 'Atlas'), OPERATOR);
  check('a third is created and the primary has still not moved', (await primaryOf(db)) === first);
  check('there are three bots', (await listBotOnboardingProfiles(db)).length === 3, 'sanity');
  check(
    'and exactly one of them is the primary',
    (await listBotOnboardingProfiles(db)).filter((p) => p.selectedForRuntime).length === 1,
  );

  /* ── 2 ─────────────────────────────────────────────────────────────────── */

  section('2. The old field is ignored, not honoured, however it arrives');

  // A form post is an untyped object. `src/` cannot ask for this any more because the input
  // type does not carry it, but a stale page or a replayed request still can, and the whole
  // point is that asking is no longer a way to get it.
  const asked = {
    ...botInput('nova', 'Nova'),
    selectedForRuntime: true,
  } as unknown as BotOnboardingInput;
  const fourth = await createBotOnboardingProfile(db, asked, OPERATOR);
  check('creating a bot that ASKS to be the primary does not make it one', (await primaryOf(db)) === first);
  check('and the bot is created anyway rather than refused', fourth > 0);

  await updateBotOnboardingProfile(
    db,
    second,
    { ...botInput('aurora', 'Aurora'), selectedForRuntime: true } as unknown as BotOnboardingInput,
    OPERATOR,
  );
  check('saving a bot that ASKS for the primary does not move it', (await primaryOf(db)) === first);

  // The other direction, and the one that used to happen silently on every edit of a second
  // bot: a save must not be able to take the flag AWAY either.
  await updateBotOnboardingProfile(
    db,
    first,
    {
      ...botInput('cinderella', 'CIND3R3LLA'),
      selectedForRuntime: false,
    } as unknown as BotOnboardingInput,
    OPERATOR,
  );
  check('and saving the primary cannot clear its own flag', (await primaryOf(db)) === first);

  /* ── 3 ─────────────────────────────────────────────────────────────────── */

  section('3. Changing the primary is its own action');

  check('control: the primary is the first bot before this section', (await primaryOf(db)) === first);
  await setPrimaryBot(db, second, OPERATOR);
  check('making a bot the primary moves it there', (await primaryOf(db)) === second);
  check(
    'and it is taken off the bot that held it, so there is still exactly one',
    (await listBotOnboardingProfiles(db)).filter((p) => p.selectedForRuntime).length === 1,
  );

  await setPrimaryBot(db, second, OPERATOR);
  check('doing it twice is not an error and changes nothing', (await primaryOf(db)) === second);

  let refused = false;
  try {
    await setPrimaryBot(db, 999_999, OPERATOR);
  } catch {
    refused = true;
  }
  check('an unknown bot is refused', refused);
  // THE ROLLBACK. The implementation clears the current primary before setting the new one,
  // so a failure that was not wrapped in a transaction would leave the deployment with no
  // primary at all and nothing saying so. This is the assertion that goes red that day.
  check('and the primary that was there is still there', (await primaryOf(db)) === second);

  // The FIRST such row, not the newest: the idempotent call above wrote a second one whose
  // previous primary is legitimately itself, and reading that one would assert nothing.
  const { rows: audited } = await db.query<{ action: string; details: Record<string, unknown> }>(
    `SELECT action, details FROM audit_log
      WHERE action = 'cinderella.bot-profile.make-primary'
      ORDER BY id ASC LIMIT 1`,
  );
  check('the change is audited', audited.length === 1);
  check(
    'and the audit names the bot it was taken from',
    Number(audited[0]?.details?.['previousPrimaryId'] ?? 0) === first,
    String(audited[0]?.details?.['previousPrimaryId'] ?? 'missing'),
  );
  check(
    'and records that nothing about hosting changed',
    audited[0]?.details?.['hostingChanged'] === false,
  );

  /* ── 4 ─────────────────────────────────────────────────────────────────── */

  section('4. The seat, and the index that keeps it to one');

  await deleteBotOnboardingProfile(db, second, OPERATOR);
  check('deleting the primary leaves no primary', (await primaryOf(db)) === null);
  const fifth = await createBotOnboardingProfile(db, botInput('vega', 'Vega'), OPERATOR);
  check('and the next bot created takes the empty seat', (await primaryOf(db)) === fifth);

  // The briefing says the index is correct and stays. Prove it is live rather than assuming:
  // this is the guarantee every one of the checks above is leaning on.
  let indexHeld = false;
  try {
    await db.query(`UPDATE cinderella_bot_profiles SET selected_for_runtime = TRUE WHERE id = $1`, [
      third,
    ]);
  } catch {
    indexHeld = true;
  }
  check('a second primary is refused by the database itself', indexHeld);
  check('and the primary is unchanged by the attempt', (await primaryOf(db)) === fifth);

  /* ── 5 ─────────────────────────────────────────────────────────────────── */

  section('5. The console: the control is gone from creation and exists on its own');

  process.env['SESSION_SECRET'] ??= 'primary-verify-secret-0123456789abcdefghij';
  const adminCfg = {
    adminPort: 8803,
    adminUsername: OPERATOR,
    adminPasswordHash: await argon2.hash(PASSWORD, { type: argon2.argon2id }),
    sessionSecret: 'primary-verify-session-secret-0123456789abcd',
    publicOrigin: 'https://admin.example.org',
    rpId: 'admin.example.org',
    webauthnOrigin: 'https://admin.example.org',
    rpName: 'Cinderella Admin',
  } as unknown as AdminConfig;

  const cfg = {
    botDisplayName: 'CIND3R3LLA',
    simplexDbPrefix: './state/simplex/c',
    simplexFilesFolder: './state/files',
    groupName: 'archive',
    mediaRoot: process.cwd(),
    quarantineRoot: './state/quarantine',
    assetRoot: './state/assets',
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

  const pageFor = async (id: number): Promise<string> =>
    (
      await app.inject({
        method: 'GET',
        url: `/ai/onboarding?profile=${String(id)}`,
        headers: { cookie },
      })
    ).body;

  const onPrimary = await pageFor(fifth);
  const onOther = await pageFor(third);
  const csrf = /name="_csrf" value="([^"]+)"/.exec(onOther)?.[1] ?? '';

  // The field itself, by name. This is what the wizard posted and what `formInput` read.
  check('the wizard no longer posts a primary field', !onPrimary.includes('name="selectedForRuntime"'));
  check(
    'and the sentence that named a decision nobody makes is gone',
    !onPrimary.includes('Select this bot as the desired runtime profile'),
  );
  check('the old label is gone too', !onPrimary.includes('Primary runtime bot'));

  check('the detail card carries the primary panel', onOther.includes('data-primary-panel'));
  check(
    'and states the one thing an operator cannot see: it decides nothing about hosting',
    onOther.includes('It decides nothing about hosting'),
  );
  check(
    'a bot that is not the primary is offered the action',
    onOther.includes('value="make-primary"'),
  );
  check(
    'and the bot that IS the primary is not offered it',
    !onPrimary.includes('value="make-primary"'),
  );

  const moved = await app.inject({
    method: 'POST',
    url: '/ai/onboarding',
    headers: { cookie, 'content-type': 'application/x-www-form-urlencoded' },
    payload: `action=make-primary&profileId=${String(third)}&_csrf=${encodeURIComponent(csrf)}`,
  });
  check(
    'the action redirects as a save',
    String(moved.headers['location'] ?? '').includes('saved=make-primary'),
    String(moved.headers['location'] ?? ''),
  );
  check('and the primary moved through the real route', (await primaryOf(db)) === third);
  // FOLLOWED, not re-fetched. The banner lives on the redirect target's query string, so a
  // plain GET of the page proves nothing about what the operator is told.
  const landed = await app.inject({
    method: 'GET',
    url: String(moved.headers['location'] ?? ''),
    headers: { cookie },
  });
  check(
    'and the page says what happened rather than "configuration saved"',
    landed.body.includes('Nothing was started, stopped or restarted'),
  );
  check(
    'control: an ordinary save still gets the ordinary banner',
    (
      await app.inject({
        method: 'GET',
        url: '/ai/onboarding?saved=update-profile',
        headers: { cookie },
      })
    ).body.includes('AI bot configuration saved.'),
  );

  await app.close();
  await pg.close();

  console.log(`\nFailures: ${failures}`);
  if (failures > 0) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
