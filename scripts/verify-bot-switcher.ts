/**
 * One switcher, and every settings page follows it (CCB-S5-011, D-169).
 *
 *   npx tsx scripts/verify-bot-switcher.ts
 *
 * ── THE DEFECT ───────────────────────────────────────────────────────────────
 *
 * Four page families each invented their own `?bot=` control: pills inside a card on
 * Interaction, a dropdown on Personality, a sentence on the Book, a master-detail list on AI
 * Bot Setup. So the operator re-stated which bot he meant on every page, could not tell at a
 * glance which bot a form belonged to, and nothing remembered the answer. His words were that
 * it felt like four consoles.
 *
 * It also made the PRIMARY look like a setting to think about, because the primary was the
 * console's default selection and the only thing that survived a page change. This briefing
 * does not remove the flag; it removes the reason to look at it.
 *
 * ── WHAT IS ASSERTED, AND THE ONE THAT MATTERS MOST ─────────────────────────
 *
 * Section 1 pins the precedence as pure logic, including the states a browser cannot easily
 * produce. Section 3 is the load-bearing one the briefing asks for by name: **a settings page
 * must not edit a bot other than the selected one**, driven through the real routes and
 * mutation-proven, because that is the failure that silently writes one bot's values over
 * another's.
 *
 * Every guarantee has a control beside it. "The page shows bot B" passes against an
 * implementation that shows B always, so the pair is always: B when B is selected AND A when
 * A is.
 */

import { PGlite } from '@electric-sql/pglite';
import { vector } from '@electric-sql/pglite-pgvector';
import argon2 from 'argon2';
import { loadMigrationFiles } from '../src/db/migrate.js';
import type { Queryable } from '../src/db/pool.js';
import { resolveSelectedBot } from '../src/web/selected-bot.js';
import {
  createBotOnboardingProfile,
  listBotOnboardingProfiles,
  type BotCreationInput,
  type BotOnboardingProfile,
} from '../src/profiles/bot-onboarding.js';
import { listSettingOverridesForBot } from '../src/db/interaction-overrides.js';
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

function botInput(slug: string, displayName: string, wakeWord: string): BotCreationInput {
  return {
    slug,
    displayName,
    wakeWord,
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

const fake = (id: number, name: string): BotOnboardingProfile =>
  ({ id, displayName: name }) as BotOnboardingProfile;

async function main(): Promise<void> {
  setLogLevel('error');

  /* ── 1 ─────────────────────────────────────────────────────────────────── */

  section('1. Precedence: the URL, then the session, then the first bot');

  const three = [fake(1, 'CIND3R3LLA'), fake(2, 'SupportDesk'), fake(3, 'Nightingale')];

  check('no URL and no session opens on the first bot', resolveSelectedBot(three, undefined, null).selectedId === 1);
  check(
    'the session is used when the URL says nothing, which is what makes a switch HOLD',
    resolveSelectedBot(three, undefined, 3).selectedId === 3,
  );
  check(
    'the URL WINS over the session, so a shared link shows the bot it names',
    resolveSelectedBot(three, '2', 3).selectedId === 2,
  );
  check(
    '  and says it came from the URL, so the page can admit it is not the usual selection',
    resolveSelectedBot(three, '2', 3).fromUrl === true,
  );
  check(
    '  CONTROL: a session-driven page does not claim that',
    resolveSelectedBot(three, undefined, 3).fromUrl === false,
  );

  // The states a browser cannot easily produce, which is why this half is pure.
  check(
    'a session pointing at a DELETED bot falls back rather than naming a ghost',
    resolveSelectedBot(three, undefined, 99).selectedId === 1,
  );
  check('a URL naming a deleted bot falls back too', resolveSelectedBot(three, '99', 2).selectedId === 2);
  check('rubbish in the URL is ignored rather than refused', resolveSelectedBot(three, 'nonsense', 2).selectedId === 2);
  check('with no bots at all the answer is null, not an invented one', resolveSelectedBot([], undefined, 1).selectedId === null);
  check('and the name travels with the id, so a page never has one without the other', resolveSelectedBot(three, undefined, 2).selectedName === 'SupportDesk');

  /* ── 2 ─────────────────────────────────────────────────────────────────── */

  section('2. The console: one control, in one place, on every page that edits a bot');

  const pg = new PGlite({ extensions: { vector } });
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

  const botA = await createBotOnboardingProfile(db, botInput('cinderella', 'CIND3R3LLA', 'Cinderella'), OPERATOR);
  const botB = await createBotOnboardingProfile(db, botInput('sanchez', 'SANCH3Z', 'Sanchez'), OPERATOR);

  process.env['SESSION_SECRET'] ??= 'switcher-verify-secret-0123456789abcdefgh';
  const adminCfg = {
    adminPort: 8806,
    adminUsername: OPERATOR,
    adminPasswordHash: await argon2.hash(PASSWORD, { type: argon2.argon2id }),
    sessionSecret: 'switcher-verify-session-secret-0123456789ab',
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

  const get = async (url: string): Promise<string> =>
    (await app.inject({ method: 'GET', url, headers: { cookie } })).body.replace(/\s+/g, ' ');
  const csrfOf = (body: string): string => /name="_csrf" value="([^"]+)"/.exec(body)?.[1] ?? '';

  const PAGES = [
    ['/interaction/addressing', 'Interaction'],
    ['/interaction/nicknames', 'Interaction nicknames'],
    ['/ai/personality', 'Personality'],
    ['/book/assembled', 'The Assembled Word'],
    ['/ai/onboarding', 'AI Bot Setup'],
  ] as const;

  for (const [url, name] of PAGES) {
    const body = await get(url);
    check(`${name} carries the switcher`, body.includes('data-bot-switcher'), url);
  }
  check(
    'and it names both bots, so switching is possible rather than merely displayed',
    (await get('/interaction/addressing')).includes('SANCH3Z'),
  );
  // ── SCOPE IS STATED, NOT IMPLIED (re-pointed under CCB-S5-036, D-194) ────
  //
  // These three used to assert the prose line "Settings below apply to this bot. Shared
  // settings say so where they appear." and the ABSENCE of the switcher on a
  // deployment-wide page. Both were the previous design and both were deliberately
  // changed, so this is a re-baseline rather than a loosening:
  //
  //   - the paragraph around the control is gone. Three lines of prose attached to a
  //     picker is a paragraph, and the per-setting scope badges already carry the shared
  //     versus per-bot distinction where the SETTING is, which is where it is actionable.
  //   - absence worked as a statement while the control sat mid-sidebar. Moved into the
  //     header slot, an empty space reads as something failing to load, so a page that
  //     edits no single bot now SAYS "Deployment-wide".
  //
  // D-155's scope visibility is what is actually being guarded here, and it is stronger
  // stated than implied: the assertion is that the page tells you its scope, not that it
  // tells you in one particular sentence.
  check(
    'a per-bot page names the bot it is editing',
    (await get('/interaction/addressing')).includes('Editing bot'),
  );
  check(
    '  and offers the other bot, so switching is possible rather than merely displayed',
    (await get('/interaction/addressing')).includes('admin-botpicker-option'),
  );
  check(
    'CONTROL: a deployment-wide page SAYS so rather than leaving a blank (D-155)',
    (await get('/settings')).includes('Deployment-wide'),
  );
  check(
    '  and offers no bot to choose, since choosing one would be meaningless there',
    !(await get('/settings')).includes('admin-botpicker-option'),
  );

  /* ── 3 ─────────────────────────────────────────────────────────────────── */

  section('3. Switching holds, and no page edits a bot other than the selected one');

  {
    const before = await get('/interaction/addressing');
    check(
      'before switching, the page shows the FIRST bot',
      before.includes('value="Cinderella"'),
      'wake word on the page',
    );

    const switched = await app.inject({
      method: 'POST',
      url: '/console/select-bot',
      headers: { cookie, 'content-type': 'application/x-www-form-urlencoded' },
      payload: `botProfileId=${String(botB)}&returnTo=%2Finteraction%2Faddressing&_csrf=${encodeURIComponent(csrfOf(before))}`,
    });
    check(
      'switching redirects back to where the operator was',
      String(switched.headers['location'] ?? '') === '/interaction/addressing',
      String(switched.headers['location'] ?? ''),
    );

    check(
      'the SAME page now shows the other bot',
      (await get('/interaction/addressing')).includes('value="Sanchez"'),
    );
    // THE POINT OF THE BRIEFING: it holds across pages, without a `?bot=` anywhere.
    check(
      'and so does a DIFFERENT page, with no bot in the URL',
      (await get('/ai/personality')).includes('SANCH3Z'),
    );
    check(
      '  and the Book previews that bot too',
      (await get('/book/assembled')).includes('SANCH3Z'),
    );
    check(
      '  and AI Bot Setup opens on it',
      (await get('/ai/onboarding')).includes('SANCH3Z'),
    );

    // THE LOAD-BEARING CHECK. A save must reach the SELECTED bot and no other.
    //
    // `wakeWord` and not `greetings`: greetings are SHARED (setting-scope.ts), so a per-bot
    // save correctly writes no deviation for them and asserting on one would pass against an
    // implementation that wrote nothing at all. The per-bot key in this section is the wake
    // word, which is also the one an operator would notice going wrong.
    // CAPTURED BEFORE THE SAVE (CCB-S5-030). This asserted bot A held NO wake-word row, which
    // was true before migration 056 backfilled one for every existing bot so the new derived
    // fallback could not move anything on its own. The guarantee under test is that a save on
    // one bot does not touch another, so it is now asserted as UNCHANGED rather than as absent,
    // which is both the real property and independent of what the backfill leaves behind.
    const wakeBefore = async (id: number): Promise<unknown> =>
      (await listSettingOverridesForBot(db, id)).find((o) => o.key === 'wakeWord')?.value;
    const botABefore = await wakeBefore(botA);

    const page = await get('/interaction/addressing');
    await app.inject({
      method: 'POST',
      url: '/interaction',
      headers: { cookie, 'content-type': 'application/x-www-form-urlencoded' },
      payload:
        `section=addressing&botProfileId=${String(botB)}&wakeWord=Morty&greetings=hey` +
        `&naturalAddressing=on&_csrf=${encodeURIComponent(csrfOf(page))}`,
    });
    const wakeOf = async (id: number): Promise<unknown> =>
      (await listSettingOverridesForBot(db, id)).find((o) => o.key === 'wakeWord')?.value;

    check('a save on the selected bot reaches THAT bot', (await wakeOf(botB)) === 'Morty', String(await wakeOf(botB)));
    check(
      '  MUTATION: and the other bot is untouched, which is the failure this guards',
      (await wakeOf(botA)) === botABefore,
      `bot A: ${String(botABefore)} -> ${String(await wakeOf(botA))}`,
    );
    check(
      "  and bot A still reads the shared wake word rather than bot B's new one",
      (await get(`/interaction/addressing?bot=${String(botA)}`)).includes('value="Cinderella"'),
    );

    // Put it back, so the sections after this one read the state they were written for.
    await app.inject({
      method: 'POST',
      url: '/interaction',
      headers: { cookie, 'content-type': 'application/x-www-form-urlencoded' },
      payload:
        `section=addressing&botProfileId=${String(botB)}&wakeWord=Sanchez&greetings=hey` +
        `&naturalAddressing=on&_csrf=${encodeURIComponent(csrfOf(await get('/interaction/addressing')))}`,
    });
  }

  {
    // `?bot=` is a ONE-OFF view and must not move the standing choice, or a shared link would
    // silently re-point the recipient's whole session.
    await get(`/interaction/addressing?bot=${String(botA)}`);
    check(
      'following a ?bot= link does not change the remembered selection',
      (await get('/interaction/addressing')).includes('value="Sanchez"'),
    );
  }

  {
    // The open-redirect guard on the return path. It arrives in a form field, and a form
    // field is untrusted whatever rendered it.
    for (const bad of ['https://evil.example/x', '//evil.example/x', '/\\evil.example']) {
      const r = await app.inject({
        method: 'POST',
        url: '/console/select-bot',
        headers: { cookie, 'content-type': 'application/x-www-form-urlencoded' },
        payload: `botProfileId=${String(botA)}&returnTo=${encodeURIComponent(bad)}&_csrf=${encodeURIComponent(csrfOf(await get('/interaction/addressing')))}`,
      });
      check(
        `an off-site return path is refused: ${bad}`,
        String(r.headers['location'] ?? '') === '/dashboard',
        String(r.headers['location'] ?? ''),
      );
    }
  }

  /* ── 4 ─────────────────────────────────────────────────────────────────── */

  section('4. Moderation, the last page family, under the same switcher');

  {
    // ── WHY THIS IS THE MOST CONSEQUENTIAL OF THE FAMILY (CCB-S5-017) ─────
    //
    // The Rules page read `profiles[0]`, which is the PRIMARY, so it showed and SAVED the
    // primary's ladders whatever the operator had selected. The thing being edited decides
    // whether a member is warned, muted or removed, so a ladder edited against the wrong
    // bot is a sanction configured for somebody who will never trigger it and a bot left
    // running on values nobody chose.
    for (const url of ['/moderation/rules', '/moderation/active', '/moderation/log']) {
      check(`${url} carries the switcher`, (await get(url)).includes('data-bot-switcher'));
    }
    check(
      'the Rules page states the scope: the ladders are per bot',
      (await get('/moderation/rules')).includes('The mode and both ladders below belong to the bot selected'),
    );
    check(
      '  and that arming is NOT per bot, because it is a build-time constant',
      // Matched on a fragment carrying no markup: the sentence has a <strong> inside it,
      // and matching across tags is the D-111 verifier defect in another costume.
      (await get('/moderation/rules')).includes('switching bots does not change it'),
    );
    check(
      'the Log names the bot whose records it is showing',
      (await get('/moderation/log')).includes('Showing what'),
    );

    // Select bot A, save a ladder, and prove bot B is untouched. This is the check the
    // briefing asks for by name, on the page where getting it wrong costs a member.
    const rulesPage = await get('/moderation/rules');
    await app.inject({
      method: 'POST',
      url: '/console/select-bot',
      headers: { cookie, 'content-type': 'application/x-www-form-urlencoded' },
      payload: `botProfileId=${String(botA)}&returnTo=%2Fmoderation%2Frules&_csrf=${encodeURIComponent(csrfOf(rulesPage))}`,
    });
    const onA = await get('/moderation/rules');
    check('switching reaches the Moderation pages too', onA.includes('CIND3R3LLA'));

    await app.inject({
      method: 'POST',
      url: '/moderation/rules',
      headers: { cookie, 'content-type': 'application/x-www-form-urlencoded' },
      // The real field names, read off `ladderFrom` rather than guessed: a payload the
      // parser ignores would leave the value unchanged and the check would read as a
      // scoping failure when it was a fixture failure.
      payload:
        `bot=${String(botA)}&section=verbal&verbalWindowSeconds=2520` +
        `&verbal.0.threshold=2&verbal.0.sharpnessBonus=1&_csrf=${encodeURIComponent(csrfOf(onA))}`,
    });

    const { rows: windows } = await db.query<{ id: string; w: number }>(
      `SELECT id, moderation_verbal_window_secs AS w FROM cinderella_bot_profiles ORDER BY id`,
    );
    const windowOf = (id: number): number | undefined =>
      windows.find((r) => Number(r.id) === id)?.w;
    check(
      'a ladder saved for the selected bot reaches THAT bot',
      windowOf(botA) === 2520,
      `bot A window ${String(windowOf(botA))}s`,
    );
    check(
      '  MUTATION: and the other bot keeps the ladder it had, which is what a member depends on',
      windowOf(botB) === 600,
      `bot B window ${String(windowOf(botB))}s`,
    );
  }

  check(
    'the bot list still has both bots, so nothing in this was destructive',
    (await listBotOnboardingProfiles(db)).length === 2,
  );

  await app.close();
  await pg.close();

  console.log(
    failures === 0
      ? '\nOne switcher, in one place, and every settings page follows it.'
      : `\n${failures} CHECK(S) FAILED.`,
  );
  if (failures > 0) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
