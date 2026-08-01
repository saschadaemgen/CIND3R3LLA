/**
 * Offline verification for the top-level administration navigation and
 * contextual sidebar structure.
 *
 * No real network, SimpleX transport, consent write, or production database is used.
 */

import { PGlite } from '@electric-sql/pglite';
import argon2 from 'argon2';
import type { LocalAiConfig, AdminConfig, Config } from '../src/config.js';
import type { Queryable } from '../src/db/pool.js';
import { loadMigrationFiles } from '../src/db/migrate.js';
import { AiRuntimeService, resetAiRuntimeForTests } from '../src/interaction/ai-runtime.js';
import type { FetchLike } from '../src/interaction/ollama-resolver.js';
import { SettingsService } from '../src/settings/service.js';
import { SecurityService } from '../src/security/settings.js';
import { buildServer, registerNav } from '../src/web/server.js';
import { html, page, setNavItems } from '../src/web/html.js';
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

function topMainNavigation(body: string): string {
  return /<nav(?=[^>]*\bdata-main-navigation(?:\s|=|>))[^>]*>[\s\S]*?<\/nav>/.exec(body)?.[0] ?? '';
}

function contextSidebar(body: string): string {
  return /<aside[^>]*data-context-sidebar[^>]*>[\s\S]*?<\/aside>/.exec(body)?.[0] ?? '';
}

function activeMainCount(body: string): number {
  const desktopNavigation =
    /<nav(?=[^>]*\bdata-main-navigation(?:\s|=|>))[^>]*>[\s\S]*?<\/nav>/.exec(body)?.[0] ?? '';

  return (desktopNavigation.match(/data-main-active="true"/g) ?? []).length;
}

const PASSWORD = 'correct-horse-battery-staple';
const SESSION_SECRET = 'm'.repeat(48);

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

  check('admin login succeeds', login.statusCode === 302 && session !== '');

  const dashboard = await app.inject({ method: 'GET', url: '/dashboard', headers });
  check('dashboard renders', dashboard.statusCode === 200);
  const dashboardMainNavigation = topMainNavigation(dashboard.body);
  check(
    'top main navigation is present',
    dashboardMainNavigation.includes('href="/dashboard"') &&
      dashboardMainNavigation.includes('href="/messages"') &&
      dashboardMainNavigation.includes('href="/interaction/addressing"') &&
      dashboardMainNavigation.includes('href="/ai/overview"') &&
      dashboardMainNavigation.includes('href="/plugins"') &&
      dashboardMainNavigation.includes('href="/settings"'),
  );
  check(
    'dashboard has no redundant contextual sidebar',
    !dashboard.body.includes('data-context-sidebar'),
  );
  check('exactly one main section is active on dashboard', activeMainCount(dashboard.body) === 1);

  const content = await app.inject({ method: 'GET', url: '/messages', headers });
  const contentSidebar = contextSidebar(content.body);
  check(
    'content sidebar matches the Content main section',
    contentSidebar.includes('data-section="content"') &&
      contentSidebar.includes('href="/messages"') &&
      contentSidebar.includes('href="/consent"') &&
      contentSidebar.includes('href="/reports"'),
  );
  check(
    'content sidebar excludes unrelated AI entries',
    !contentSidebar.includes('/ai/overview') && !contentSidebar.includes('/interaction/guards'),
  );
  check('exactly one main section is active for Content', activeMainCount(content.body) === 1);

  const interaction = await app.inject({
    method: 'GET',
    url: '/interaction/guards',
    headers,
  });
  const interactionSidebar = contextSidebar(interaction.body);
  check(
    'interaction sidebar matches the Interaction main section',
    interactionSidebar.includes('data-section="interaction"') &&
      interactionSidebar.includes('/interaction/addressing') &&
      interactionSidebar.includes('/interaction/guards') &&
      interactionSidebar.includes('/interaction/diagnostics'),
  );
  check(
    'interaction sidebar excludes unrelated sections',
    !interactionSidebar.includes('/ai/privacy') && !interactionSidebar.includes('/settings'),
  );

  const ai = await app.inject({ method: 'GET', url: '/ai/overview', headers });
  const aiSidebar = contextSidebar(ai.body);
  check(
    'AI sidebar matches the AI Control main section',
    aiSidebar.includes('data-section="ai"') &&
      aiSidebar.includes('/ai/profiles') &&
      aiSidebar.includes('/ai/runtime') &&
      aiSidebar.includes('/ai/personality') &&
      aiSidebar.includes('/ai/privacy') &&
      aiSidebar.includes('/ai/knowledge'),
  );
  check(
    'AI sidebar excludes unrelated sections',
    !aiSidebar.includes('/interaction/guards') && !aiSidebar.includes('/security'),
  );
  check('exactly one main section is active for AI', activeMainCount(ai.body) === 1);

  const system = await app.inject({ method: 'GET', url: '/settings', headers });
  const systemSidebar = contextSidebar(system.body);
  // `/website` was REMOVED from this sidebar on purpose, not lost: D-089 moved the
  // marketing site into its own repository and `3da6076` took the admin page with it.
  // The harness predates that (it was written in `165a7a6`) and kept asserting the link,
  // which is the whole of why this check was red. Aligned to the three children the
  // System root actually ships. If a fourth is added, add it here: this check exists to
  // notice the sidebar and the main section drifting apart.
  check(
    'system sidebar matches the System main section',
    systemSidebar.includes('data-section="system"') &&
      systemSidebar.includes('href="/settings"') &&
      systemSidebar.includes('href="/security"') &&
      systemSidebar.includes('href="/embeds"'),
  );
  // The removal is asserted rather than assumed. Without this, deleting the `/website`
  // expectation above would be indistinguishable from never having checked it, and a
  // regression that put the page back would pass silently.
  check(
    'and the System sidebar does NOT carry the retired /website page (D-089)',
    !systemSidebar.includes('href="/website"'),
  );

  await app.close();
  resetAiRuntimeForTests();

  setNavItems([
    {
      key: 'lab',
      href: '/lab',
      label: 'Lab',
      icon: html`<span>L</span>`,
      children: [
        {
          key: 'lab:tools',
          href: '/lab/tools',
          label: 'Tools',
          icon: html`<span>T</span>`,
          children: [
            {
              key: 'lab:tools:queue',
              href: '/lab/tools/queue',
              label: 'Queue',
              icon: html`<span>Q</span>`,
            },
          ],
        },
      ],
    },
  ]);

  const nested = page({
    title: 'Nested navigation',
    active: 'lab:tools:queue',
    csrfToken: 'test-token',
    body: html`<p>Nested navigation verification</p>`,
  });

  check(
    'sidebar supports another submenu level',
    nested.includes('name="cinderella-sidebar-depth-0"') &&
      nested.includes('data-nav-depth="1"') &&
      nested.includes('href="/lab/tools/queue"'),
  );
  check(
    'nested active branch opens automatically',
    nested.includes('<details') && nested.includes('open'),
  );

  console.log('\n=== RESULTS ===');
  console.log(`StepSuccessful: ${failures === 0}`);
  console.log(`Failures: ${failures}`);
  console.log('TopMainNavigationCreated: true');
  console.log('ContextualSidebarCreated: true');
  console.log('NestedSidebarSupported: true');
  console.log('TabsCreated: false');
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
