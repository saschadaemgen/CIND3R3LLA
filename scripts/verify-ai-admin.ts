/**
 * Offline verification for the modular AI admin control center.
 *
 * It boots the real admin server against PGlite, uses a fake Ollama endpoint,
 * and never sends a SimpleX message or touches production.
 */

import { PGlite } from '@electric-sql/pglite';
import argon2 from 'argon2';
import type { LocalAiConfig, AdminConfig, Config } from '../src/config.js';
import type { Queryable } from '../src/db/pool.js';
import { loadMigrationFiles } from '../src/db/migrate.js';
import {
  AiRuntimeService,
  aiRuntimeSnapshot,
  resetAiRuntimeForTests,
} from '../src/interaction/ai-runtime.js';
import type { FetchLike } from '../src/interaction/ollama-resolver.js';
import { SettingsService } from '../src/settings/service.js';
import { SecurityService } from '../src/security/settings.js';
import { buildServer, registerNav } from '../src/web/server.js';
import { registerAdminViews } from '../src/web/views/index.js';

let failures = 0;

function check(label: string, ok: boolean, detail = ''): void {
  if (!ok) failures += 1;
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
const SESSION_SECRET = 's'.repeat(48);
const DB_SECRET = 'ai-admin-db-secret';

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
            modified_at: '2026-07-25T15:00:00Z',
            size: 6700000000,
            details: {
              family: 'qwen35',
              parameter_size: '9.7B',
              quantization_level: 'Q4_K_M',
            },
          },
          {
            name: 'qwen3.5:4b',
            model: 'qwen3.5:4b',
            modified_at: '2026-07-25T16:00:00Z',
            size: 3100000000,
            details: {
              family: 'qwen35',
              parameter_size: '4B',
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

  const pg = new PGlite();
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
    databaseUrl: `postgres://cinderella:${DB_SECRET}@127.0.0.1:5432/cinderella`,
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
  const loginToken = /name="_csrf" value="([a-f0-9]{64})"/.exec(loginPage.body)?.[1] ?? '';
  const loginCookie = cookieOf(loginPage.headers['set-cookie'], 'cinderella_login_csrf') ?? '';

  const login = await app.inject({
    method: 'POST',
    url: '/login',
    payload: { username: 'operator', password: PASSWORD, _csrf: loginToken },
    headers: { cookie: loginCookie },
  });

  const session = cookieOf(login.headers['set-cookie'], 'cinderella_session') ?? '';
  const authed = { cookie: session };

  check('admin login succeeds', login.statusCode === 302 && session !== '');

  const root = await app.inject({ method: 'GET', url: '/ai', headers: authed });
  check(
    'legacy AI route redirects to overview',
    root.statusCode === 302 && root.headers.location === '/ai/overview',
  );

  const overview = await app.inject({ method: 'GET', url: '/ai/overview', headers: authed });
  check('AI overview renders', overview.statusCode === 200);
  check(
    'navigation exposes AI submenu',
    overview.body.includes('href="/ai/runtime"') &&
      overview.body.includes('href="/ai/personality"') &&
      overview.body.includes('href="/ai/privacy"') &&
      overview.body.includes('href="/ai/knowledge"'),
  );
  check(
    'overview keeps trust and operations sections',
    overview.body.includes('Operations overview') &&
      overview.body.includes('Capability and trust matrix') &&
      overview.body.includes('Private data path'),
  );
  check(
    'secrets never appear',
    !overview.body.includes(DB_SECRET) &&
      !overview.body.includes(SESSION_SECRET) &&
      !overview.body.includes(adminCfg.adminPasswordHash),
  );

  const runtimePage = await app.inject({ method: 'GET', url: '/ai/runtime', headers: authed });
  const csrf = /name="_csrf" value="([a-f0-9]{64})"/.exec(runtimePage.body)?.[1] ?? '';
  check('runtime page embeds CSRF token', csrf !== '');
  check(
    'Runtime Control separates stored and effective state',
    runtimePage.body.includes('Runtime Control') &&
      runtimePage.body.includes('data-runtime-stored-state') &&
      runtimePage.body.includes('data-runtime-effective-state') &&
      runtimePage.body.includes('Stored setting') &&
      runtimePage.body.includes('Effective mode'),
  );
  check(
    'runtime modes expose real persistent controls',
    runtimePage.body.includes('data-runtime-mode="local"') &&
      runtimePage.body.includes('data-runtime-mode="rules"') &&
      runtimePage.body.includes('name="mode" value="local"') &&
      runtimePage.body.includes('name="mode" value="rules"'),
  );
  check(
    'runtime status and safety boundary are visible',
    runtimePage.body.includes('Environment gate') &&
      runtimePage.body.includes('Active resolver') &&
      runtimePage.body.includes('Fail closed activation') &&
      runtimePage.body.includes('Automatic cloud fallback') &&
      runtimePage.body.includes('disabled'),
  );
  check(
    'runtime test, routing, audit, and technical status are connected',
    runtimePage.body.includes('action="/ai/test"') &&
      runtimePage.body.includes('href="/ai/routing"') &&
      runtimePage.body.includes('local-ai.toggle') &&
      runtimePage.body.includes('Technical details'),
  );

  const useRules = await app.inject({
    method: 'POST',
    url: '/ai/runtime',
    payload: { _csrf: csrf, mode: 'rules' },
    headers: authed,
  });

  check(
    'rules mode redirects to runtime page',
    useRules.statusCode === 302 && useRules.headers.location === '/ai/runtime?saved=1',
  );
  check('rules become active immediately', aiRuntimeSnapshot().enabled === false);

  const enableLocal = await app.inject({
    method: 'POST',
    url: '/ai/runtime',
    payload: { _csrf: csrf, mode: 'local' },
    headers: authed,
  });

  check(
    'healthy local mode redirects to runtime page',
    enableLocal.statusCode === 302 && enableLocal.headers.location === '/ai/runtime?saved=1',
  );
  check('local AI becomes active', aiRuntimeSnapshot().enabled === true);

  const refresh = await app.inject({
    method: 'POST',
    url: '/ai/models/refresh',
    payload: { _csrf: csrf },
    headers: authed,
  });

  check(
    'catalog refresh redirects to models page',
    refresh.statusCode === 302 && refresh.headers.location === '/ai/models?refreshed=1',
  );

  const routeModels = await app.inject({
    method: 'POST',
    url: '/ai/routing',
    payload: {
      _csrf: csrf,
      intentModel: 'qwen3.5:4b',
      replyModel: 'qwen3.5:9b',
    },
    headers: authed,
  });

  check(
    'routing update redirects to routing page',
    routeModels.statusCode === 302 && routeModels.headers.location === '/ai/routing?routed=1',
  );
  check(
    'routing takes effect',
    aiRuntimeSnapshot().routing.intentModel === 'qwen3.5:4b' &&
      aiRuntimeSnapshot().routing.replyModel === 'qwen3.5:9b',
  );

  const probe = await app.inject({
    method: 'POST',
    url: '/ai/test',
    payload: { _csrf: csrf },
    headers: authed,
  });

  check(
    'role probe redirects to testing page',
    probe.statusCode === 302 && probe.headers.location === '/ai/testing?tested=1',
  );

  const reset = await app.inject({
    method: 'POST',
    url: '/ai/telemetry/reset',
    payload: { _csrf: csrf },
    headers: authed,
  });

  check(
    'telemetry reset redirects to telemetry page',
    reset.statusCode === 302 && reset.headers.location === '/ai/telemetry?reset=1',
  );

  const noCsrf = await app.inject({
    method: 'POST',
    url: '/ai/telemetry/reset',
    payload: {},
    headers: authed,
  });

  check('AI mutation without CSRF is refused', noCsrf.statusCode === 403);

  const personality = await app.inject({
    method: 'GET',
    url: '/ai/personality',
    headers: authed,
  });

  check(
    'personality page exposes truthful current and future state',
    personality.body.includes('Permanent personality profile') &&
      personality.body.includes('Not configured') &&
      personality.body.includes('Moderator approval'),
  );

  const privacy = await app.inject({ method: 'GET', url: '/ai/privacy', headers: authed });
  check(
    'privacy page exposes hard boundaries',
    privacy.body.includes('Automatic cloud fallback') &&
      privacy.body.includes('Disabled') &&
      privacy.body.includes('Member content in telemetry'),
  );

  const audit = await pg.query<{ n: number }>(
    `SELECT count(*)::int AS n
       FROM audit_log
      WHERE action IN ('local-ai.toggle', 'local-ai.routing.update', 'local-ai.telemetry.reset')`,
  );

  check('AI mutations remain audited', (audit.rows[0]?.n ?? 0) >= 4);

  await app.close();
  resetAiRuntimeForTests();

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
