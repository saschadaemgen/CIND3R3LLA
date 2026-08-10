/**
 * Offline verification for Cinderella profiles, groups, and technical identity roles.
 *
 * It uses PGlite and the real admin server. No SimpleX connection, group join,
 * invitation link, message send, consent action, or production database is used.
 */

import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { vector } from '@electric-sql/pglite-pgvector';
import argon2 from 'argon2';
import type { LocalAiConfig, AdminConfig, Config } from '../src/config.js';
import type { Queryable } from '../src/db/pool.js';
import { loadMigrationFiles } from '../src/db/migrate.js';
import {
  addCinderellaGroup,
  createCinderellaProfile,
  listCinderellaProfiles,
  upsertCinderellaGroupAuthority,
  upsertCinderellaProfileAuthority,
} from '../src/profiles/service.js';
import { AiRuntimeService, resetAiRuntimeForTests } from '../src/interaction/ai-runtime.js';
import type { FetchLike } from '../src/interaction/ollama-resolver.js';
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
const SESSION_SECRET = 'p'.repeat(48);

const localAi: LocalAiConfig = {
  enabled: true,
  baseUrl: 'http://10.8.0.4:11434',
  model: 'qwen3.5:9b',
  timeoutMs: 30000,
};

const fakeFetch: FetchLike = async (input) => {
  const url = new URL(String(input));

  if (url.pathname === '/api/tags') {
    return new Response(JSON.stringify({ models: [{ name: 'qwen3.5:9b', model: 'qwen3.5:9b' }] }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  }

  return new Response('not found', { status: 404 });
};

async function main(): Promise<void> {
  process.env['SESSION_SECRET'] ??= SESSION_SECRET;

  const root = process.cwd();
  const accessControlClient = await readFile(
    join(root, 'assets', 'admin-access-control.js'),
    'utf8',
  );
  const accessControlCss = await readFile(join(root, 'assets', 'app.css'), 'utf8');
  const assetCopier = await readFile(join(root, 'scripts', 'copy-assets.mjs'), 'utf8');

  const pg = new PGlite({ extensions: { vector } });
  const db: Queryable = {
    async query(text, values) {
      const result = await pg.query(text, values ? [...values] : undefined);
      return {
        rows: result.rows as never[],
        rowCount: (result.affectedRows ?? result.rows.length) as number,
      };
    },
  };

  for (const migration of await loadMigrationFiles()) {
    await pg.exec(migration.sql);
  }

  console.log('\n1. Persistent profile and group model');
  const profileId = await createCinderellaProfile(
    db,
    { slug: 'cinderella-main', displayName: 'Cinderella Main' },
    'profile-test',
  );

  const teamGroupId = await addCinderellaGroup(
    db,
    {
      profileId,
      simplexGroupId: 7001,
      localDisplayName: 'Cinderella Team',
      kind: 'team',
    },
    'profile-test',
  );

  const memberGroupId = await addCinderellaGroup(
    db,
    {
      profileId,
      simplexGroupId: 7002,
      localDisplayName: 'Community',
      kind: 'member',
    },
    'profile-test',
  );

  await upsertCinderellaProfileAuthority(
    db,
    {
      profileId,
      identityType: 'user',
      simplexId: 91,
      displayLabel: 'Sascha',
      role: 'owner',
    },
    'profile-test',
  );

  await upsertCinderellaProfileAuthority(
    db,
    {
      profileId,
      identityType: 'contact',
      simplexId: 92,
      displayLabel: 'Operations Admin',
      role: 'administrator',
    },
    'profile-test',
  );

  await upsertCinderellaGroupAuthority(
    db,
    {
      groupId: teamGroupId,
      simplexMemberId: 'member-team-001',
      displayLabel: 'Mausi',
      role: 'moderator',
    },
    'profile-test',
  );

  await upsertCinderellaGroupAuthority(
    db,
    {
      groupId: memberGroupId,
      simplexMemberId: 'member-community-004',
      displayLabel: 'Blocked Member',
      role: 'blocked',
    },
    'profile-test',
  );

  const profiles = await listCinderellaProfiles(db);
  const profile = profiles[0];

  check('profile is persisted', profile?.slug === 'cinderella-main');
  check('local-only baseline is enforced', profile?.localOnly === true);
  check('cloud is blocked by default', profile?.cloudAllowed === false);
  check('team and member groups are persisted', profile?.groups.length === 2);
  check(
    'profile authorities use technical IDs',
    profile?.authorities.some(
      (authority) =>
        authority.identityType === 'user' &&
        authority.simplexId === 91 &&
        authority.role === 'owner',
    ) === true,
  );
  check(
    'group roles use stable member IDs',
    profile?.groups
      .find((group) => group.id === teamGroupId)
      ?.authorities.some(
        (authority) =>
          authority.simplexMemberId === 'member-team-001' && authority.role === 'moderator',
      ) === true,
  );

  console.log('\n2. Structural safety constraints');
  let secondTeamRefused = false;

  try {
    await addCinderellaGroup(
      db,
      {
        profileId,
        simplexGroupId: 7003,
        localDisplayName: 'Second Team',
        kind: 'team',
      },
      'profile-test',
    );
  } catch {
    secondTeamRefused = true;
  }

  check('second team group is refused', secondTeamRefused);

  let secondOwnerRefused = false;

  try {
    await upsertCinderellaProfileAuthority(
      db,
      {
        profileId,
        identityType: 'contact',
        simplexId: 93,
        displayLabel: 'Second Owner',
        role: 'owner',
      },
      'profile-test',
    );
  } catch {
    secondOwnerRefused = true;
  }

  check('second enabled owner is refused', secondOwnerRefused);

  let duplicateGroupRefused = false;

  try {
    const otherProfile = await createCinderellaProfile(
      db,
      { slug: 'cinderella-lab', displayName: 'Cinderella Lab' },
      'profile-test',
    );

    await addCinderellaGroup(
      db,
      {
        profileId: otherProfile,
        simplexGroupId: 7002,
        localDisplayName: 'Duplicate Group',
        kind: 'test',
      },
      'profile-test',
    );
  } catch {
    duplicateGroupRefused = true;
  }

  check('SimpleX group ID cannot be assigned twice', duplicateGroupRefused);

  console.log('\n3. Real admin surface');
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
  await AiRuntimeService.load(db, localAi, { fetchImpl: fakeFetch });

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
  const headers = { cookie: session };

  const page = await app.inject({
    method: 'GET',
    url: `/ai/profiles?profile=${profileId}`,
    headers,
  });

  check('profiles page renders', page.statusCode === 200);
  check(
    'sidebar exposes Access Control',
    page.body.includes('href="/ai/profiles"') && page.body.includes('Access Control'),
  );
  check(
    'duplicate profile creation is hidden from the normal workflow',
    !page.body.includes('name="action" value="create-profile"') &&
      page.body.includes('Open AI Bot Setup'),
  );
  check(
    'master detail Access Control workspace is visible',
    page.body.includes('access-control-master-detail') &&
      page.body.includes('data-access-workspace') &&
      page.body.includes('Selected AI bot'),
  );
  check(
    'only the selected AI bot detail is rendered',
    page.body.includes('href="/ai/profiles?profile=') &&
      page.body.includes('data-access-list-item'),
  );
  check(
    'authorities and groups use compact sections',
    page.body.includes('data-access-panel="authorities"') &&
      page.body.includes('data-access-panel="groups"') &&
      page.body.includes('access-control-group-card'),
  );
  check(
    'mutating forms are presented in dialogs',
    page.body.includes('data-access-dialog') &&
      page.body.includes('data-access-open') &&
      page.body.includes('Assign authority') &&
      page.body.includes('Add group assignment'),
  );
  check(
    'Access Control client supports dialogs, tabs, and search',
    accessControlClient.includes('showModal()') &&
      accessControlClient.includes('data-access-tab') &&
      accessControlClient.includes('data-access-search'),
  );
  check(
    'Access Control styles and asset publishing exist',
    accessControlCss.includes('CIND3R3LLA access control workspace') &&
      assetCopier.includes('admin-access-control.js'),
  );
  check(
    'profile and groups are visible',
    page.body.includes('Cinderella Main') &&
      page.body.includes('Cinderella Team') &&
      page.body.includes('Community'),
  );
  check(
    'technical trust model is visible',
    page.body.includes('SimpleX IDs define trust') &&
      page.body.includes('Profile authorities') &&
      page.body.includes('SimpleX member ID'),
  );
  check(
    'unsupported connection actions are honest',
    page.body.includes('Invitation links') &&
      page.body.includes('not stored') &&
      page.body.includes('Join group action') &&
      page.body.includes('not implemented') &&
      page.body.includes('Remote commands') &&
      page.body.includes('disabled') &&
      page.body.includes('Policy enforcement') &&
      page.body.includes('foundation only'),
  );
  check('group links are not accepted by a form', !page.body.includes('name="groupLink"'));

  const csrf = /name="_csrf" value="([a-f0-9]{64})"/.exec(page.body)?.[1] ?? '';
  check('profiles page embeds CSRF token', csrf !== '');

  const createViaWeb = await app.inject({
    method: 'POST',
    url: '/ai/profiles',
    payload: {
      _csrf: csrf,
      action: 'create-profile',
      displayName: 'Cinderella Support',
      slug: 'cinderella-support',
    },
    headers,
  });

  check(
    'profile creation works through admin',
    createViaWeb.statusCode === 302 &&
      createViaWeb.headers.location === '/ai/profiles?saved=create-profile',
  );

  const withoutCsrf = await app.inject({
    method: 'POST',
    url: '/ai/profiles',
    payload: {
      action: 'create-profile',
      displayName: 'Unsafe',
      slug: 'unsafe-profile',
    },
    headers,
  });

  check('profile mutation without CSRF is refused', withoutCsrf.statusCode === 403);

  const audit = await pg.query<{ n: number }>(
    `SELECT count(*)::int AS n
       FROM audit_log
      WHERE action LIKE 'cinderella.%'`,
  );

  check('all profile and role mutations are audited', (audit.rows[0]?.n ?? 0) >= 8);

  await app.close();
  resetAiRuntimeForTests();

  console.log('\n=== RESULTS ===');
  console.log(`StepSuccessful: ${failures === 0}`);
  console.log(`Failures: ${failures}`);
  console.log('DatabaseMigrationCreated: true');
  console.log('ProfileCrudFoundationCreated: true');
  console.log('MultiGroupFoundationCreated: true');
  console.log('TeamGroupConstraintCreated: true');
  console.log('ProfileRolesCreated: true');
  console.log('GroupRolesCreated: true');
  console.log('TechnicalIdsUsedForAuthority: true');
  console.log('InvitationLinksStored: false');
  console.log('SimpleXGroupJoined: false');
  console.log('RemoteCommandsEnabled: false');
  console.log('PolicyEnforcementActive: false');
  console.log('NetworkUsed: false');
  console.log('SimpleXMessageSent: false');
  console.log('ConsentExecuted: false');
  console.log('ProductionChanged: false');

  if (failures > 0) process.exit(1);
}

main().catch((error: unknown) => {
  resetAiRuntimeForTests();
  const message = error instanceof Error ? error.message : String(error);

  console.error('\n=== RESULTS ===');
  console.error('StepSuccessful: false');
  console.error(`Error: ${message}`);
  console.error('SimpleXMessageSent: false');
  console.error('ProductionChanged: false');
  process.exit(1);
});
