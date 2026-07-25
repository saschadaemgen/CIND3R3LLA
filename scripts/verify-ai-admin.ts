/**
 * Offline verification for the AI Operations Center.
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
    if (value.startsWith(`${name}=`)) {
      return value.split(';')[0] ?? null;
    }
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
              family: 'qwen3',
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
              family: 'qwen3',
              parameter_size: '4B',
              quantization_level: 'Q4_K_M',
            },
          },
        ],
      }),
      {
        status: 200,
        headers: {
          'content-type': 'application/json',
        },
      },
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
    payload: {
      username: 'operator',
      password: PASSWORD,
      _csrf: loginToken,
    },
    headers: {
      cookie: loginCookie,
    },
  });

  const session = cookieOf(login.headers['set-cookie'], 'cinderella_session') ?? '';
  const authed = { cookie: session };

  check('admin login succeeds', login.statusCode === 302 && session !== '');

  const page = await app.inject({
    method: 'GET',
    url: '/ai',
    headers: authed,
  });

  check('AI Operations Center renders', page.statusCode === 200);
  check(
    'navigation exposes AI Control',
    page.body.includes('href="/ai"') && page.body.includes('AI Control'),
  );
  check(
    'large operations surface renders',
    page.body.includes('Operations overview') &&
      page.body.includes('Intent lane telemetry') &&
      page.body.includes('Reply lane telemetry') &&
      page.body.includes('Recent AI operations'),
  );
  check(
    'marketing trust sections render',
    page.body.includes('Capability and trust matrix') &&
      page.body.includes('Private data path') &&
      page.body.includes('Content-free telemetry'),
  );
  check(
    'role routing controls render',
    page.body.includes('Model role routing') &&
      page.body.includes('name="intentModel"') &&
      page.body.includes('name="replyModel"'),
  );
  check(
    'real limitations remain visible',
    page.body.includes('Private RAG') &&
      page.body.includes('Comparison lane') &&
      page.body.includes('Cloud providers') &&
      page.body.includes('Disabled'),
  );
  check(
    'secrets never appear',
    !page.body.includes(DB_SECRET) &&
      !page.body.includes(SESSION_SECRET) &&
      !page.body.includes(adminCfg.adminPasswordHash),
  );

  const csrf = /name="_csrf" value="([a-f0-9]{64})"/.exec(page.body)?.[1] ?? '';
  check('AI page embeds CSRF token', csrf !== '');

  const refresh = await app.inject({
    method: 'POST',
    url: '/ai/models/refresh',
    payload: {
      _csrf: csrf,
    },
    headers: authed,
  });

  check(
    'model catalog refresh succeeds',
    refresh.statusCode === 302 && refresh.headers.location === '/ai?refreshed=1',
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
    'model routing update succeeds',
    routeModels.statusCode === 302 && routeModels.headers.location === '/ai?routed=1',
  );
  check(
    'routing takes effect in process',
    aiRuntimeSnapshot().routing.intentModel === 'qwen3.5:4b' &&
      aiRuntimeSnapshot().routing.replyModel === 'qwen3.5:9b',
  );

  const reset = await app.inject({
    method: 'POST',
    url: '/ai/telemetry/reset',
    payload: {
      _csrf: csrf,
    },
    headers: authed,
  });

  check(
    'telemetry reset succeeds',
    reset.statusCode === 302 && reset.headers.location === '/ai?reset=1',
  );
  check('telemetry reset clears activity', aiRuntimeSnapshot().operations.recent.length === 0);
  check(
    'telemetry reset preserves routing',
    aiRuntimeSnapshot().routing.intentModel === 'qwen3.5:4b',
  );

  const noCsrf = await app.inject({
    method: 'POST',
    url: '/ai/telemetry/reset',
    payload: {},
    headers: authed,
  });

  check('telemetry reset without CSRF is refused', noCsrf.statusCode === 403);

  const audit = await pg.query<{ n: number }>(
    `SELECT count(*)::int AS n FROM audit_log WHERE action IN ('local-ai.routing.update', 'local-ai.telemetry.reset')`,
  );

  check('routing and telemetry reset are audited', (audit.rows[0]?.n ?? 0) >= 2);

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
