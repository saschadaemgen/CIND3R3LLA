/**
 * The create form can actually be completed (CCB-S5-010, D-164).
 *
 *   npx tsx scripts/verify-bot-creation-form.ts
 *
 * ── THE DEFECT ───────────────────────────────────────────────────────────────
 *
 * Submitting the form did nothing, silently, and the operator could not create a bot at all.
 * Two faults, both invisible without a browser console open:
 *
 *   1. THE INTERNAL KEY WAS REQUIRED AND UNREACHABLE. Every required field lives on step one,
 *      and the wizard sets `hidden` on the steps it is not showing. An operator who left step
 *      one without typing a key and then pressed Finish hit a wall the browser could not
 *      describe: native validation blocks the submit, tries to focus the offending control,
 *      finds it inside a hidden subtree, gives up, and logs "An invalid form control with
 *      name='slug' is not focusable" to a console nobody has open. The button did nothing and
 *      said nothing. That is D-162's shape from the other side: not a control that looks live
 *      and is dead, but one that is live, required, and cannot be reached to be complained
 *      about.
 *
 *   2. THE SLUG PATTERN NEVER COMPILED. It read `[a-z0-9][a-z0-9-]{1,62}`. Browsers compile
 *      `pattern` in regex **`v` mode**, where an unescaped `-` in a character class is a
 *      syntax error, so it threw on every validation and the constraint was silently dropped.
 *      Measured in a real browser: with the old pattern an input holding `NOT a slug!!`
 *      reported itself VALID. The client-side format check had never once run.
 *
 * ── WHAT THIS CHECK CAN AND CANNOT DO ───────────────────────────────────────
 *
 * It cannot see a wall. Nothing in Node can: `hidden` is set at runtime by the wizard, the
 * shipped markup does not carry it, and a static sweep of the served HTML reports the form as
 * perfectly reachable, which it did. The browser is the only place that defect is visible and
 * the browser is where it was found and fixed.
 *
 * What this check does is pin the two things that made it possible and the one that made it
 * invisible: every `pattern` the console serves must COMPILE, the create form must carry the
 * derivation hooks so the empty case is not reached in the first place, and the wizard script
 * must still wire its reveal-and-report to both Next and Finish. Section 1 is the one that
 * would have caught fault 2 the day it was written.
 */

import { PGlite } from '@electric-sql/pglite';
import argon2 from 'argon2';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadMigrationFiles } from '../src/db/migrate.js';
import type { Queryable } from '../src/db/pool.js';
import { SLUG_PATTERN } from '../src/web/views/ai-onboarding.js';
import { createBotOnboardingProfile } from '../src/profiles/bot-onboarding.js';
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

/** Does this source compile as a regex in the given mode? */
function compiles(source: string, flags: string): boolean {
  try {
    new RegExp(source, flags);
    return true;
  } catch {
    return false;
  }
}

async function main(): Promise<void> {
  setLogLevel('error');

  /* ── 1 ─────────────────────────────────────────────────────────────────── */

  section('1. Every pattern the console serves compiles, in the mode browsers use');

  // `v` is the mode the HTML spec now says `pattern` is compiled in, and the one Chrome uses.
  // `u` as well, so an older engine is not broken in the other direction by the fix.
  check('the slug pattern compiles in v mode, which is what browsers use', compiles(SLUG_PATTERN, 'v'));
  check('  and in u mode, so nothing older is broken by the escape', compiles(SLUG_PATTERN, 'u'));
  // The mutation, run rather than described: the pattern as it shipped.
  check(
    '  MUTATION: the pattern as it shipped does NOT compile, which is why it never ran',
    !compiles('[a-z0-9][a-z0-9-]{1,62}', 'v'),
  );

  // It has to constrain, not merely compile. A pattern that compiles and matches everything
  // is the same defect wearing a different face.
  const rx = new RegExp(`^(?:${SLUG_PATTERN})$`, 'v');
  check('a real slug is accepted', rx.test('marlow-desk') && rx.test('cind3r3lla'));
  check('  and one with spaces and punctuation is not', !rx.test('NOT a slug!!'));
  check('  nor one starting with a hyphen', !rx.test('-leading'));
  check('  nor an upper-case one', !rx.test('Upper'));
  check('  nor a single character, because the column wants at least two', !rx.test('a'));

  /* ── 2 ─────────────────────────────────────────────────────────────────── */

  section('2. The wizard still refuses out loud');

  const wizard = readFileSync(join(process.cwd(), 'assets', 'admin-setup-wizard.js'), 'utf8');
  check('the reveal-and-report helper is present', wizard.includes('function revealAndReport'));
  check(
    '  it reveals the step before reporting, which is the whole fix',
    /showStep\(dialog, step\)[\s\S]{0,400}reportValidity/.test(wizard),
  );
  check('  wired to Next, so a problem surfaces on the step it lives on', /data-setup-next[\s\S]{0,400}revealAndReport/.test(wizard));
  check(
    '  and wired to Finish, for every route that did not pass a Next',
    /data-setup-finish[\s\S]{0,300}revealAndReport[\s\S]{0,120}preventDefault/.test(wizard),
  );
  check('the slug derivation exists, so the empty case is not normally reached', wizard.includes('DERIVE'));
  check(
    '  and it is only applied while the operator has not taken the field over',
    /if \(t\.dirty\) return;/.test(wizard),
  );

  /* ── 3 ─────────────────────────────────────────────────────────────────── */

  section('3. The served form carries what the browser needs');

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
  await createBotOnboardingProfile(
    db,
    {
      slug: 'cinderella',
      displayName: 'CIND3R3LLA',
      wakeWord: 'Cinderella',
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
    },
    OPERATOR,
  );

  process.env['SESSION_SECRET'] ??= 'form-verify-secret-0123456789abcdefghijkl';
  const adminCfg = {
    adminPort: 8805,
    adminUsername: OPERATOR,
    adminPasswordHash: await argon2.hash(PASSWORD, { type: argon2.argon2id }),
    sessionSecret: 'form-verify-session-secret-0123456789abcdef',
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

  const page = (await app.inject({ method: 'GET', url: '/ai/onboarding', headers: { cookie } })).body;

  check('the slug field is served with the escaped pattern', page.includes(`pattern="${SLUG_PATTERN}"`));
  check(
    '  and NOT with the one that never compiled',
    !page.includes('pattern="[a-z0-9][a-z0-9-]{1,62}"'),
  );
  check('the slug is derived from the bot name', page.includes('data-derive="slug"'));
  check('  from the same field the wake word follows', page.includes('data-wake-source'));

  /* ── 4 ─────────────────────────────────────────────────────────────────── */

  section('4. Every pattern on every console page, not just this one');

  // The general form of fault 2. One field had it; the check that matters is the one that
  // catches the next field, on a page nobody is thinking about today.
  const PAGES = [
    '/ai/onboarding',
    '/interaction/addressing',
    '/interaction/nicknames',
    '/moderation/rules',
    '/settings',
    '/security',
    '/book',
    '/ai/personality',
    '/ai/models',
    '/plugins',
  ];
  const broken: string[] = [];
  let seen = 0;
  for (const url of PAGES) {
    const body = (await app.inject({ method: 'GET', url, headers: { cookie } })).body;
    for (const m of body.matchAll(/pattern="([^"]+)"/g)) {
      const source = (m[1] ?? '').replace(/&amp;/g, '&').replace(/&quot;/g, '"');
      seen++;
      if (!compiles(source, 'v')) broken.push(`${url}: ${source}`);
    }
  }
  check(
    'every pattern attribute served by the console compiles in v mode',
    broken.length === 0,
    broken.length === 0 ? `${seen} checked` : broken.join(' | '),
  );
  check('  and there was at least one to check, so the sweep means something', seen > 0, `${seen}`);

  await app.close();
  await pg.close();

  console.log(
    failures === 0 ? `\nThe create form can be completed.` : `\n${failures} CHECK(S) FAILED.`,
  );
  if (failures > 0) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
