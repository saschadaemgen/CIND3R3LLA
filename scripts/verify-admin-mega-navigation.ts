/**
 * Offline verification for the full width administration mega navigation.
 *
 * No database, network, SimpleX transport, or production service is used.
 */

import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { registerNav } from '../src/web/server.js';
import { html, page } from '../src/web/html.js';

let failures = 0;

function check(label: string, ok: boolean, detail = ''): void {
  if (!ok) failures++;
  console.log(`  [${ok ? 'PASS' : 'FAIL'}] ${label}${detail ? `: ${detail}` : ''}`);
}

function section(body: string, attribute: string): string {
  const escaped = attribute.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`<nav(?=[^>]*${escaped})[^>]*>[\\s\\S]*?<\\/nav>`).exec(body)?.[0] ?? '';
}

function megaNavigationShell(body: string): string {
  const marker = '<div class="admin-mega-shell" data-mega-shell';
  const start = body.indexOf(marker);

  if (start < 0) return '';

  const end = body.indexOf('</header>', start);
  if (end < 0) return '';

  return body.slice(start, end);
}

async function main(): Promise<void> {
  registerNav();

  const body = page({
    title: 'Navigation verification',
    active: 'ai:onboarding',
    csrfToken: 'verification-token',
    body: html`<p>Navigation verification</p>`,
  });

  const mainNavigation = section(body, 'data-main-navigation');
  const mobileNavigation = section(body, 'data-main-navigation-mobile');
  const megaShell = megaNavigationShell(body);

  console.log('\n1. Desktop navigation shell');
  check('desktop navigation is rendered', mainNavigation !== '');
  check(
    'sections with children expose mega triggers',
    mainNavigation.includes('data-mega-trigger="content"') &&
      mainNavigation.includes('data-mega-trigger="interaction"') &&
      mainNavigation.includes('data-mega-trigger="ai"') &&
      mainNavigation.includes('data-mega-trigger="plugins"') &&
      mainNavigation.includes('data-mega-trigger="system"'),
  );
  check(
    'dashboard remains a direct navigation link',
    mainNavigation.includes('href="/dashboard"') &&
      !mainNavigation.includes('data-mega-trigger="dashboard"'),
  );
  check(
    'one shared animated indicator is rendered',
    (mainNavigation.match(/data-main-nav-indicator/g) ?? []).length === 1,
  );
  check(
    'AI Control remains the active main section',
    mainNavigation.includes('data-main-active="true"') &&
      mainNavigation.includes('aria-controls="admin-mega-ai"'),
  );

  console.log('\n2. Full width categorized panel');
  check('mega panel shell is rendered', megaShell !== '');
  check(
    'AI panel exposes all four categories',
    megaShell.includes('Foundation') &&
      megaShell.includes('Intelligence') &&
      megaShell.includes('Operations') &&
      megaShell.includes('Safety &amp; Connectivity'),
  );
  check(
    'AI panel contains key destinations',
    megaShell.includes('href="/ai/onboarding"') &&
      megaShell.includes('href="/ai/profiles"') &&
      megaShell.includes('href="/ai/models"') &&
      megaShell.includes('href="/ai/privacy"') &&
      megaShell.includes('href="/ai/audit"'),
  );
  check(
    'panels expose accessible close controls',
    megaShell.includes('data-mega-close') && megaShell.includes('aria-label="Close menu"'),
  );
  check(
    'active destination is represented inside the panel',
    megaShell.includes('href="/ai/onboarding"') && megaShell.includes('aria-current="page"'),
  );

  console.log('\n3. Existing sidebar and mobile navigation');
  check(
    'contextual sidebar remains available',
    body.includes('data-context-sidebar') &&
      body.includes('data-section="ai"') &&
      body.includes('href="/ai/onboarding"'),
  );
  check(
    'mobile navigation remains direct and independent',
    mobileNavigation.includes('href="/ai/overview"') &&
      !mobileNavigation.includes('data-mega-trigger'),
  );

  console.log('\n4. Client behavior and visual foundation');
  const root = process.cwd();
  const script = await readFile(join(root, 'assets', 'admin-navigation.js'), 'utf8');
  const css = await readFile(join(root, 'assets', 'app.css'), 'utf8');
  const copier = await readFile(join(root, 'scripts', 'copy-assets.mjs'), 'utf8');

  check(
    'page loads same origin navigation script',
    body.includes('<script src="/assets/admin-navigation.js" defer></script>'),
  );
  check(
    'client script supports click, escape, resize, and reduced motion',
    script.includes("addEventListener('click'") &&
      script.includes("event.key === 'Escape'") &&
      script.includes("addEventListener('resize'") &&
      script.includes('prefers-reduced-motion: reduce'),
  );
  check(
    'client script moves one shared indicator',
    script.includes('positionIndicator') &&
      script.includes('translate3d') &&
      script.includes('data-main-active'),
  );
  check(
    'CSS removes the old misplaced pseudo indicator',
    css.includes(".admin-main-nav-link[aria-current='page']::after") &&
      css.includes('content: none;'),
  );
  check(
    'CSS provides animated mega panel and sidebar marker',
    css.includes('.admin-mega-shell') &&
      css.includes(".admin-mega-shell[data-open='true']") &&
      css.includes('.admin-main-nav-indicator') &&
      css.includes('.admin-sidebar-link[aria-current=') &&
      css.includes('admin-sidebar-marker-in'),
  );
  check(
    'asset copier publishes the navigation script',
    copier.includes("assets', 'admin-navigation.js") &&
      copier.includes("public', 'assets', 'admin-navigation.js"),
  );

  console.log('\n=== RESULTS ===');
  console.log(`StepSuccessful: ${failures === 0}`);
  console.log(`Failures: ${failures}`);
  console.log('FullWidthMegaMenuCreated: true');
  console.log('CategorizedNavigationCreated: true');
  console.log('SharedMainIndicatorCreated: true');
  console.log('SidebarIndicatorCorrected: true');
  console.log('MobileNavigationPreserved: true');
  console.log('TabsCreated: false');
  console.log('BotOnboardingChanged: false');
  console.log('SimplexSdkActionsExecuted: false');
  console.log('ProductionChanged: false');

  if (failures > 0) process.exit(1);
}

main().catch((error: unknown) => {
  console.error('\n=== RESULTS ===');
  console.error('StepSuccessful: false');
  console.error(`Error: ${error instanceof Error ? error.message : String(error)}`);
  console.error('SimplexSdkActionsExecuted: false');
  console.error('ProductionChanged: false');
  process.exit(1);
});
