/**
 * Offline verification for the modular AI admin navigation.
 *
 * No real network, SimpleX message, consent execution, or production database is used.
 */

import { PGlite } from '@electric-sql/pglite';
import { vector } from '@electric-sql/pglite-pgvector';
import argon2 from 'argon2';
import type { LocalAiConfig, AdminConfig, Config } from '../src/config.js';
import type { Queryable } from '../src/db/pool.js';
import { loadMigrationFiles } from '../src/db/migrate.js';
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
const SESSION_SECRET = 'n'.repeat(48);

const localAi: LocalAiConfig = {
  enabled: true,
  baseUrl: 'http://10.8.0.4:11434',
  model: 'qwen3.5:9b',
  timeoutMs: 30000,
};

const fakeFetch: FetchLike = async (input) => {
  const url = new URL(String(input));

  if (url.pathname === '/api/tags') {
    return new Response(
      JSON.stringify({
        models: [
          {
            name: 'qwen3.5:9b',
            model: 'qwen3.5:9b',
            size: 6594474711,
            details: {
              family: 'qwen35',
              parameter_size: '9.7B',
              quantization_level: 'Q4_K_M',
            },
          },
        ],
      }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    );
  }

  return new Response('not found', { status: 404 });
};

async function main(): Promise<void> {
  process.env['SESSION_SECRET'] ??= SESSION_SECRET;

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
    groupName: 'cinderella-test',
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

  check('admin login succeeds', login.statusCode === 302 && session !== '');

  const root = await app.inject({ method: 'GET', url: '/ai', headers });
  check(
    'AI root redirects to overview',
    root.statusCode === 302 && root.headers.location === '/ai/overview',
  );

  const routes = [
    ['/ai/overview', 'AI Overview'],
    ['/ai/profiles', 'Access Control'],
    ['/ai/runtime', 'Runtime Control'],
    ['/ai/models', 'AI Models'],
    ['/ai/routing', 'AI Routing'],
    ['/ai/hardware', 'AI Hardware'],
    ['/ai/telemetry', 'AI Telemetry'],
    ['/ai/personality', 'AI Personality'],
    ['/ai/privacy', 'AI Privacy and Safety'],
    ['/ai/providers', 'AI Providers'],
    ['/ai/knowledge', 'AI Knowledge and RAG'],
    ['/ai/testing', 'AI Testing and Compare'],
    ['/ai/audit', 'AI Audit'],
  ] as const;

  for (const [url, heading] of routes) {
    const response = await app.inject({ method: 'GET', url, headers });
    check(
      `${heading} route renders`,
      response.statusCode === 200 && response.body.includes(heading),
    );
  }

  const overview = await app.inject({ method: 'GET', url: '/ai/overview', headers });
  const submenuLinks = routes.map(([url]) => `href="${url}"`);
  check(
    'sidebar exposes the complete AI submenu',
    submenuLinks.every((link) => overview.body.includes(link)),
  );
  check(
    'overview contains trust and private path sections',
    overview.body.includes('Capability and trust matrix') &&
      overview.body.includes('Private data path'),
  );

  const runtime = await app.inject({ method: 'GET', url: '/ai/runtime', headers });
  check(
    'runtime page keeps real controls',
    runtime.body.includes('action="/ai/runtime"') &&
      runtime.body.includes('data-runtime-mode="local"') &&
      runtime.body.includes('data-runtime-mode="rules"') &&
      runtime.body.includes('name="mode" value="local"') &&
      runtime.body.includes('name="mode" value="rules"') &&
      runtime.body.includes('Stored setting') &&
      runtime.body.includes('Effective mode'),
  );

  const models = await app.inject({ method: 'GET', url: '/ai/models', headers });
  check(
    'models page keeps catalog controls',
    models.body.includes('action="/ai/models/refresh"') &&
      models.body.includes('data-model-search') &&
      models.body.includes('data-model-role-filter') &&
      models.body.includes('Model management boundary'),
  );

  const routing = await app.inject({ method: 'GET', url: '/ai/routing', headers });
  check(
    'routing page keeps role controls',
    routing.body.includes('action="/ai/routing"') &&
      routing.body.includes('name="intentModel"') &&
      routing.body.includes('name="replyModel"'),
  );

  const hardware = await app.inject({ method: 'GET', url: '/ai/hardware', headers });
  check(
    'hardware page keeps honest visibility controls',
    hardware.body.includes('action="/ai/models/refresh"') &&
      hardware.body.includes('data-hardware-catalog-state') &&
      hardware.body.includes('data-hardware-telemetry-state') &&
      hardware.body.includes('Model hardware metadata') &&
      hardware.body.includes('not integrated'),
  );

  const telemetry = await app.inject({ method: 'GET', url: '/ai/telemetry', headers });
  check(
    'telemetry page keeps reset control',
    telemetry.body.includes('action="/ai/telemetry/reset"') &&
      telemetry.body.includes('Recent AI operations'),
  );

  // CCB-S4-029 replaced this page's placeholder copy ("Personality training roadmap",
  // "Moderator approval") with a real editor, so the old assertions describe a page that
  // no longer exists. This harness seeds no bot profile, so what it should see is the
  // empty state pointing at the thing a personality belongs to. The editor itself is
  // asserted by `verify:personality`, which seeds a bot; duplicating it here would mean
  // two checks that must be kept in step.
  const personality = await app.inject({ method: 'GET', url: '/ai/personality', headers });
  check(
    'personality page points at the bot a personality belongs to',
    personality.body.includes('No bot profile yet') &&
      personality.body.includes('href="/ai/onboarding"'),
  );

  const privacy = await app.inject({ method: 'GET', url: '/ai/privacy', headers });
  check(
    'privacy page shows local and deterministic boundaries',
    privacy.body.includes('Automatic cloud fallback') &&
      privacy.body.includes('Member content in telemetry') &&
      privacy.body.includes('Consent execution'),
  );

  const providers = await app.inject({ method: 'GET', url: '/ai/providers', headers });
  check(
    'providers page is honest about external providers',
    providers.body.includes('Ollama provider') &&
      providers.body.includes('OpenAI') &&
      providers.body.includes('Anthropic') &&
      providers.body.includes('Disabled'),
  );

  const knowledge = await app.inject({ method: 'GET', url: '/ai/knowledge', headers });
  check(
    'knowledge page exposes private training roadmap',
    knowledge.body.includes('More than 50 SimpleX analysis') &&
      knowledge.body.includes('RAG enabled') &&
      knowledge.body.includes('No'),
  );

  resetAiRuntimeForTests();
  await app.close();

  console.log('\n=== RESULTS ===');
  console.log(`StepSuccessful: ${failures === 0}`);
  console.log(`Failures: ${failures}`);
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
  console.error('NetworkUsed: false');
  console.error('SimpleXMessageSent: false');
  console.error('ConsentExecuted: false');
  console.error('ProductionChanged: false');
  process.exit(1);
});
