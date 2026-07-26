/**
 * Offline verification for persistent SimpleX bot onboarding settings.
 *
 * No SimpleX core is started and no production database is used.
 */

import { PGlite } from '@electric-sql/pglite';
import argon2 from 'argon2';
import type { AdminConfig, Config } from '../src/config.js';
import type { Queryable } from '../src/db/pool.js';
import { loadMigrationFiles } from '../src/db/migrate.js';
import {
  createBotOnboardingProfile,
  deleteBotOnboardingProfile,
  listBotOnboardingProfiles,
  resetBotOnboardingWorkflow,
  updateBotOnboardingProfile,
  type BotOnboardingInput,
} from '../src/profiles/bot-onboarding.js';
import { SettingsService } from '../src/settings/service.js';
import { SecurityService } from '../src/security/settings.js';
import { buildServer, registerNav } from '../src/web/server.js';
import { registerAdminViews } from '../src/web/views/index.js';

let failures = 0;

function check(label: string, ok: boolean, detail = ''): void {
  if (!ok) failures++;
  console.log(`  [${ok ? 'PASS' : 'FAIL'}] ${label}${detail ? `: ${detail}` : ''}`);
}

function cookieOf(setCookie: string | string[] | undefined, name: string): string | null {
  const values = setCookie === undefined ? [] : Array.isArray(setCookie) ? setCookie : [setCookie];

  for (const value of values) {
    if (value.startsWith(`${name}=`)) return value.split(';')[0] ?? null;
  }

  return null;
}

const PASSWORD = 'correct-horse-battery-staple';
const SESSION_SECRET = 'b'.repeat(48);

function defaults(): BotOnboardingInput {
  return {
    slug: 'cinderella',
    displayName: 'Cinderella',
    enabled: true,
    selectedForRuntime: true,
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
  };
}

async function main(): Promise<void> {
  process.env['SESSION_SECRET'] ??= SESSION_SECRET;

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

  for (const migration of await loadMigrationFiles()) {
    await pg.exec(migration.sql);
  }

  console.log('\n1. Persist every supported bot option');
  const id = await createBotOnboardingProfile(db, defaults(), 'verify-bot-onboarding');
  let profiles = await listBotOnboardingProfiles(db);
  let profile = profiles[0];

  check('profile is persisted', profile?.id === id);
  check('automatic contact acceptance is the default', profile?.autoAcceptContacts === true);
  check('manual group invitations are the default', profile?.groupInvitationMode === 'manual');
  check('Admin is the default expected role', profile?.expectedGroupRole === 'admin');
  check('remote commands are blocked by default', profile?.remoteCommandsEnabled === false);
  check('persistent changes are blocked by default', profile?.persistentChangesEnabled === false);
  check(
    'all SDK BotOptions are persisted',
    Boolean(
      profile?.createAddress &&
      profile.updateAddress &&
      profile.updateProfile &&
      profile.allowFiles &&
      profile.useBotProfile &&
      profile.logContacts &&
      profile.commandRegistryMode === 'cinderella_defaults',
    ),
  );

  console.log('\n2. Store manual and advanced alternatives');
  await updateBotOnboardingProfile(
    db,
    id,
    {
      ...defaults(),
      autoAcceptContacts: false,
      businessAddress: true,
      logNetwork: true,
      commandRegistryMode: 'custom',
      customCommands: [{ command: '/status', help: 'Show status' }],
      groupInvitationMode: 'approved_contacts',
      expectedGroupRole: 'moderator',
      policyActivationMode: 'automatic_after_verification',
      remoteCommandsEnabled: true,
      persistentChangesEnabled: true,
      contactRequestRetentionHours: 72,
      groupInvitationRetentionHours: 96,
      maxPendingContactRequests: 250,
    },
    'verify-bot-onboarding',
  );

  profiles = await listBotOnboardingProfiles(db);
  profile = profiles[0];

  check('manual contact approval can be selected', profile?.autoAcceptContacts === false);
  check(
    'approved contact invitation mode is persisted',
    profile?.groupInvitationMode === 'approved_contacts',
  );
  check('Moderator can be selected', profile?.expectedGroupRole === 'moderator');
  check('custom command registry is persisted', profile?.customCommands.length === 1);
  check(
    'future safety switches are persisted',
    Boolean(profile?.remoteCommandsEnabled && profile.persistentChangesEnabled),
  );

  console.log('\n3. Validate all SDK roles');
  for (const role of [
    'relay',
    'observer',
    'author',
    'member',
    'moderator',
    'admin',
    'owner',
  ] as const) {
    await updateBotOnboardingProfile(
      db,
      id,
      { ...defaults(), expectedGroupRole: role },
      'verify-bot-onboarding',
    );
    const current = (await listBotOnboardingProfiles(db))[0];
    check(`role ${role} is accepted`, current?.expectedGroupRole === role);
  }

  let invalidRoleRefused = false;
  try {
    await updateBotOnboardingProfile(
      db,
      id,
      { ...defaults(), expectedGroupRole: 'invalid' as never },
      'verify-bot-onboarding',
    );
  } catch {
    invalidRoleRefused = true;
  }
  check('unknown SDK role is refused', invalidRoleRefused);

  console.log('\n4. Workflow reset and safe deletion');
  await db.query(
    `UPDATE cinderella_bot_profiles SET workflow_state = 'role_verified' WHERE id = $1`,
    [id],
  );
  await resetBotOnboardingWorkflow(db, id, 'verify-bot-onboarding');
  check(
    'workflow reset returns to configured',
    (await listBotOnboardingProfiles(db))[0]?.workflowState === 'configured',
  );

  const secondId = await createBotOnboardingProfile(
    db,
    {
      ...defaults(),
      slug: 'cinderella-lab',
      displayName: 'Cinderella Lab',
      selectedForRuntime: false,
    },
    'verify-bot-onboarding',
  );
  await deleteBotOnboardingProfile(db, secondId, 'verify-bot-onboarding');
  check('stored profile can be deleted', (await listBotOnboardingProfiles(db)).length === 1);

  console.log('\n5. Real admin surface');
  const adminCfg: AdminConfig = {
    adminPort: 0,
    adminUsername: 'operator',
    adminPasswordHash: await argon2.hash(PASSWORD, { type: argon2.argon2id }),
    sessionSecret: SESSION_SECRET,
    publicOrigin: 'https://cinderella.example.org',
    rpId: 'cinderella.example.org',
    webauthnOrigin: 'https://cinderella.example.org',
    rpName: 'Cinderella Admin',
  };

  const cfg: Config = {
    botDisplayName: 'Cinderella',
    simplexDbPrefix: '/var/lib/cinderella/simplex/cinderella',
    simplexFilesFolder: '/var/lib/cinderella/files',
    groupName: '',
    mediaRoot: process.cwd(),
    avatarPath: '',
    databaseUrl: 'postgres://cinderella:test@127.0.0.1:5432/cinderella',
    logLevel: 'info',
  };

  const settings = await SettingsService.load(db, cfg.logLevel);
  const security = await SecurityService.load(db);
  registerNav();

  const app = buildServer({
    db,
    adminCfg,
    cfg,
    settings,
    security,
    mediaRoot: cfg.mediaRoot,
    registerViews: registerAdminViews,
  });

  await app.ready();

  const loginPage = await app.inject({ method: 'GET', url: '/login' });
  const token = /name="_csrf" value="([a-f0-9]{64})"/.exec(loginPage.body)?.[1] ?? '';
  const loginCookie = cookieOf(loginPage.headers['set-cookie'], 'cinderella_login_csrf') ?? '';

  const login = await app.inject({
    method: 'POST',
    url: '/login',
    payload: { username: 'operator', password: PASSWORD, _csrf: token },
    headers: { cookie: loginCookie },
  });

  const session = cookieOf(login.headers['set-cookie'], 'cinderella_session') ?? '';
  const page = await app.inject({
    method: 'GET',
    url: '/ai/onboarding',
    headers: { cookie: session },
  });

  check('onboarding page renders', page.statusCode === 200);
  check('navigation exposes Bot Onboarding', page.body.includes('Bot Onboarding'));
  check('complete SDK option grid is visible', page.body.includes('Complete SDK BotOptions grid'));
  check(
    'automatic contact setting is visible',
    page.body.includes('Accept contact requests automatically'),
  );
  check(
    'manual and automatic invitation modes are visible',
    Boolean(
      page.body.includes('Automatic for approved contacts') &&
      page.body.includes('Automatic for approved groups'),
    ),
  );
  check(
    'all SDK roles are visible',
    Boolean(
      page.body.includes('Relay') &&
      page.body.includes('Observer') &&
      page.body.includes('Author') &&
      page.body.includes('Member') &&
      page.body.includes('Moderator') &&
      page.body.includes('Admin') &&
      page.body.includes('Owner'),
    ),
  );
  check(
    'capability inventory is visible',
    Boolean(
      page.body.includes('apiAcceptContactRequest') &&
      page.body.includes('receivedGroupInvitation') &&
      page.body.includes('apiListMembers'),
    ),
  );
  check(
    'workflow is visible',
    Boolean(
      page.body.includes('Waiting for contact request') &&
      page.body.includes('Group invitation pending') &&
      page.body.includes('Policy ready'),
    ),
  );
  check('runtime boundary is explicit', page.body.includes('No SDK actions in this phase'));

  await app.close();
  await pg.close();

  console.log(`\nFailures: ${failures}`);
  if (failures > 0) process.exitCode = 1;
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
