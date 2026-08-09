/**
 * Every bot wears its own face (CCB-S5-007, D-161).
 *
 *   npx tsx scripts/verify-bot-avatar.ts
 *
 * ── THE DEFECT ───────────────────────────────────────────────────────────────
 *
 * `AVATAR_PATH` is one image in the environment. CCB-S5-001 hosts every enabled bot and
 * applied that one image to the PRIMARY only, deliberately: writing it onto every profile
 * would have given every bot the same face, which looks intentional and is not. So a second
 * bot could have no picture, or the first one's, and neither is what an operator wants when
 * the point of a second bot is that it is a different character.
 *
 * ── WHAT IS ASSERTED, AND WHY EACH ONE HAS A CONTROL BESIDE IT ───────────────
 *
 * Nearly every guarantee here passes trivially against an implementation that does nothing.
 * "Bot B wears its own image" is satisfied by an implementation that dresses nobody, if the
 * assertion is only that B is not wearing A's. So every claim is paired: the bot with an
 * upload wears ITS image AND the bot without one wears the DEPLOYMENT DEFAULT, the upload for
 * one bot changes that bot AND leaves the other exactly as it was.
 *
 * The one that matters most is the fault. A configured-but-unreadable avatar must NOT fall
 * back to the deployment default (CCB-S3-023): that would dress the bot as somebody else and
 * say nothing, and the operator's evidence that their upload worked would be a picture that
 * is not theirs. So the fault outcome is asserted to carry NO image, which is the assertion
 * that fails if anybody ever "fixes" it into a fallback.
 *
 * Sections 1 and 2 need no database and no core, because the decision lives in `faces.ts`,
 * which is why it lives there. Sections 3 and 4 run against real Postgres (PGlite) and the
 * real console routes.
 */

import { PGlite } from '@electric-sql/pglite';
import argon2 from 'argon2';
import sharp from 'sharp';
import { mkdir, readFile, rm } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadMigrationFiles } from '../src/db/migrate.js';
import type { Queryable } from '../src/db/pool.js';
import { avatarFault, decideFaces, type FaceTarget } from '../src/bot/runtime/faces.js';
import { loadAvatarDataUri } from '../src/bot/avatar.js';
import { resolveAssetPath } from '../src/media/assets.js';
import {
  createBotOnboardingProfile,
  listBotOnboardingProfiles,
  setBotAvatarPath,
} from '../src/profiles/bot-onboarding.js';
import { listBotsToHost } from '../src/profiles/hosted-bots.js';
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

const DEFAULT_IMAGE = 'data:image/jpg;base64,THE-DEPLOYMENT-FACE';

/** A loader that answers for the paths it was given and nothing else. */
function loaderFor(files: Record<string, string>): {
  load: (absolute: string) => Promise<string | undefined>;
  asked: string[];
} {
  const asked: string[] = [];
  return {
    asked,
    load: (absolute) => {
      asked.push(absolute);
      return Promise.resolve(files[absolute]);
    },
  };
}

const ASSET_ROOT = join(tmpdir(), `cinderella-avatar-${String(process.pid)}`);
const resolve = (relative: string): string => resolveAssetPath(ASSET_ROOT, relative);

async function main(): Promise<void> {
  setLogLevel('error');
  await mkdir(ASSET_ROOT, { recursive: true });

  /* ── 1. Which face each bot wears ───────────────────────────────────────── */

  section('1. A path per bot, and null means the deployment default');
  {
    const bots: FaceTarget[] = [
      { displayName: 'CIND3R3LLA', avatarPath: null },
      { displayName: 'Aurora', avatarPath: 'bot-avatar-aaaa.jpg' },
    ];
    const own = join(ASSET_ROOT, 'bot-avatar-aaaa.jpg');
    const loader = loaderFor({ [own]: 'data:image/jpg;base64,AURORAS-OWN-FACE' });
    const out = await decideFaces(bots, {
      defaultImage: DEFAULT_IMAGE,
      resolve,
      load: loader.load,
    });

    check(
      'a bot with an upload wears ITS OWN image',
      out[1]?.source === 'own' && out[1]?.image === 'data:image/jpg;base64,AURORAS-OWN-FACE',
      `${out[1]?.source ?? '(none)'} / ${String(out[1]?.image).slice(0, 40)}`,
    );
    // THE CONTROL. Without it, an implementation that handed every bot its own path and
    // nothing else would pass above while leaving the existing deployment bare.
    check(
      '  CONTROL: and a bot with none wears the DEPLOYMENT DEFAULT, not nothing',
      out[0]?.source === 'default' && out[0]?.image === DEFAULT_IMAGE,
      `${out[0]?.source ?? '(none)'} / ${String(out[0]?.image).slice(0, 40)}`,
    );
    check(
      'the two bots did not end up with one face between them',
      out[0]?.image !== out[1]?.image,
      `${String(out[0]?.image).slice(-20)} vs ${String(out[1]?.image).slice(-20)}`,
    );
    check(
      "the stored path is resolved against the ASSET ROOT, so it is read from where it lives",
      loader.asked.length === 1 && loader.asked[0] === own,
      loader.asked.join(', ') || '(nothing was read)',
    );
    check(
      'and the bot with no upload caused no read at all',
      !loader.asked.some((p) => p.includes('CIND3R3LLA')),
    );
  }

  section('2. A configured avatar that cannot be read is a FAULT, never a quiet fallback');
  {
    const bots: FaceTarget[] = [
      { displayName: 'Aurora', avatarPath: 'bot-avatar-gone.jpg' },
      { displayName: 'CIND3R3LLA', avatarPath: null },
    ];
    const loader = loaderFor({}); // every read comes back undefined
    const out = await decideFaces(bots, {
      defaultImage: DEFAULT_IMAGE,
      resolve,
      load: loader.load,
    });

    check('an unreadable configured avatar is reported as a fault', out[0]?.source === 'fault');
    /**
     * THE ASSERTION THIS WHOLE SECTION EXISTS FOR. The tempting "fix" for a missing avatar is
     * to fall back to the deployment default, which would dress this bot as the deployment
     * and say nothing. If anybody ever writes that, this line goes red.
     */
    check(
      'MUTATION: and it carries NO image, so it cannot silently wear the deployment default',
      out[0]?.image === undefined,
      String(out[0]?.image ?? '(none, which is right)'),
    );
    check(
      'the fault names the bot, because "an avatar failed" is unactionable with two of them',
      (out[0]?.fault ?? '').includes('Aurora') && out[0]?.fault === avatarFault('Aurora'),
      out[0]?.fault ?? '(no fault text)',
    );
    // THE CONTROL. One bot's bad path must not cost another bot its face, and must not stop
    // the boot: that loop dresses every bot the deployment has.
    check(
      '  CONTROL: and the NEXT bot is still dressed, so one bad path costs one face',
      out[1]?.source === 'default' && out[1]?.image === DEFAULT_IMAGE,
      `${out[1]?.source ?? '(none)'}`,
    );

    // A path that escapes the asset root used to throw out of the boot loop, which would
    // have taken every other bot down with it. It is the same fault as unreadable now.
    const escaping = await decideFaces([{ displayName: 'Mallory', avatarPath: '../../etc/passwd' }], {
      defaultImage: DEFAULT_IMAGE,
      resolve,
      load: loader.load,
    });
    check(
      'a path that escapes the asset root is a fault rather than a crashed boot',
      escaping[0]?.source === 'fault' && escaping[0]?.image === undefined,
      escaping[0]?.source ?? '(it threw)',
    );

    // A deployment with no AVATAR_PATH at all is a CHOICE, not a fault: it is the state
    // every fresh install starts in, and alerting on it would be noise (CCB-S3-023).
    const bare = await decideFaces([{ displayName: 'CIND3R3LLA', avatarPath: null }], {
      defaultImage: undefined,
      resolve,
      load: loader.load,
    });
    check(
      'no avatar anywhere is a choice and not a fault, so it raises nothing',
      bare[0]?.source === 'default' && bare[0]?.image === undefined && bare[0]?.fault === null,
      bare[0]?.source ?? '',
    );
  }

  section('3. The boot path acts on the decision, and the fault branch dresses nobody');
  {
    // Structural, because reaching this loop needs a real SimpleX core. What a refactor
    // could break silently is the LINK: the decision is only worth having if the boot uses
    // it, and the fault is only a fault if it reaches the dashboard.
    const host = readFileSync(join('src', 'bot', 'runtime', 'host.ts'), 'utf8');
    check('the boot loop asks `decideFaces` rather than deciding again', /decideFaces\(/.test(host));
    const faultBranch = /source === 'fault'[\s\S]*?continue;/.exec(host)?.[0] ?? '';
    check('the fault branch exists at all, so the check is not vacuous', faultBranch.length > 0);
    check(
      'it raises to the admin dashboard and not only to a log file',
      /status\.error\(/.test(faultBranch),
    );
    check(
      'and it applies NO profile update, leaving that bot as it was',
      !/applyProfileUpdate/.test(faultBranch),
    );
    check(
      'the deployment default still comes from the configured AVATAR_PATH',
      /defaultImage: image/.test(host),
    );
  }

  /* ── 4. The column, and what the runtime reads out of it ─────────────────── */

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

  section('4. The column: null is a value, and one bot\'s face is not another\'s');

  // No primary argument since CCB-S5-008: creating a bot cannot decide that. The first one
  // created takes the flag because nothing else holds it, which is what the order below relies
  // on and what `verify:bot-onboarding` asserts directly.
  const makeBot = async (slug: string, displayName: string): Promise<number> =>
    createBotOnboardingProfile(
      db,
      {
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
      },
      OPERATOR,
    );

  const first = await makeBot('cinderella', 'CIND3R3LLA');
  const second = await makeBot('aurora', 'Aurora');
  {
    const before = await listBotOnboardingProfiles(db);
    check(
      'a bot starts with no avatar of its own, so an existing deployment keeps its picture',
      before.every((p) => p.avatarPath === null),
      before.map((p) => `${p.slug}=${String(p.avatarPath)}`).join(', '),
    );

    await setBotAvatarPath(db, second, 'bot-avatar-1234.jpg', OPERATOR);
    const after = await listBotOnboardingProfiles(db);
    check(
      'a face is recorded against the bot it was given',
      after.find((p) => p.id === second)?.avatarPath === 'bot-avatar-1234.jpg',
      String(after.find((p) => p.id === second)?.avatarPath),
    );
    check(
      '  CONTROL: and the OTHER bot is untouched',
      after.find((p) => p.id === first)?.avatarPath === null,
      String(after.find((p) => p.id === first)?.avatarPath),
    );

    await setBotAvatarPath(db, second, null, OPERATOR);
    check(
      'clearing is a real operation and returns that bot to the deployment default',
      (await listBotOnboardingProfiles(db)).find((p) => p.id === second)?.avatarPath === null,
    );

    const refused: string[] = [];
    for (const bad of ['../../etc/passwd', '/etc/passwd', '   ']) {
      await setBotAvatarPath(db, second, bad, OPERATOR).catch((err: unknown) => {
        refused.push(err instanceof Error ? err.message : String(err));
      });
    }
    check(
      'a path that is not inside the asset root is refused at the WRITE, not only at the read',
      refused.length === 3,
      `${String(refused.length)} of 3 refused`,
    );
    const unknown = await setBotAvatarPath(db, 9999, 'bot-avatar-x.jpg', OPERATOR)
      .then(() => '')
      .catch((err: unknown) => (err instanceof Error ? err.message : String(err)));
    check('a face for a bot that does not exist raises', unknown.includes('not found'), unknown);

    await setBotAvatarPath(db, second, 'bot-avatar-1234.jpg', OPERATOR);
    const audit = await db.query<{ action: string; details: Record<string, unknown> }>(
      `SELECT action, details FROM audit_log WHERE action = 'cinderella.bot-profile.avatar'
        ORDER BY id DESC LIMIT 1`,
    );
    check(
      'the write is audited',
      audit.rows[0]?.action === 'cinderella.bot-profile.avatar',
      audit.rows[0]?.action ?? '(no audit row)',
    );
    check(
      'and the audit says the RUNNING bot was not changed, because it was not',
      audit.rows[0]?.details['runtimeApplied'] === false,
      JSON.stringify(audit.rows[0]?.details ?? {}),
    );

    // What the runtime actually reads at boot. The column is only useful if it survives
    // the journey from this table to the hosting list.
    const hosted = await listBotsToHost(db);
    check(
      'the runtime reads the face out with the bot',
      hosted.find((b) => b.botProfileId === second)?.avatarPath === 'bot-avatar-1234.jpg',
      String(hosted.find((b) => b.botProfileId === second)?.avatarPath),
    );
    check(
      '  CONTROL: and reads null for the bot that has none',
      hosted.find((b) => b.botProfileId === first)?.avatarPath === null,
    );
    await setBotAvatarPath(db, second, null, OPERATOR);
  }

  /* ── 5. The console ─────────────────────────────────────────────────────── */

  section('5. The console upload, against the real routes');

  process.env['SESSION_SECRET'] ??= 'avatar-verify-secret-0123456789abcdefghij';
  const adminCfg = {
    adminPort: 8802,
    adminUsername: OPERATOR,
    adminPasswordHash: await argon2.hash(PASSWORD, { type: argon2.argon2id }),
    sessionSecret: 'avatar-verify-session-secret-0123456789abcd',
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
    assetRoot: ASSET_ROOT,
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
    (await app.inject({ method: 'GET', url: `/ai/onboarding?profile=${String(id)}`, headers: { cookie } }))
      .body;

  const page = await pageFor(second);
  const csrf = /name="_csrf" value="([^"]+)"/.exec(page)?.[1] ?? '';
  check('the AI bot page renders the avatar panel', page.includes('data-avatar-panel'));
  check(
    'and says plainly that a bot with no upload wears the deployment default',
    page.includes('wears the deployment default'),
  );
  check(
    'it does not claim the running bot changed, because it did not',
    page.includes('next time the bot starts'),
  );
  check(
    'the panel posts to the SELECTED bot, not to whichever the page listed first',
    page.includes(`/ai/onboarding/${String(second)}/avatar"`),
  );

  /* ── THE CONTROL HAS TO BE USABLE, NOT ONLY CORRECT (CCB-S5-008) ───────────
   *
   * Everything below this point passed while the panel was unusable. The operator reported
   * that clicking Upload produced no dialogue, no error and no request, and all three were
   * true: the chooser was a bare `<input type="file">` styled at 11px in a muted colour, so
   * the thing that looked pressable was the Upload button; `admin-image-upload.js` disables
   * Upload until a file is chosen; and the console had no `:disabled` rule at all, so a
   * disabled button rendered at full accent brightness with `cursor: pointer` and swallowed
   * every click in silence.
   *
   * These two checks cannot see a rendered pixel, and they are not pretending to. They pin
   * the two things that were missing, either of which alone brings the defect back: a chooser
   * shaped like a control, and a stylesheet in which a dead button looks dead. */
  check(
    'the chooser is a control and not a caption: it is a button-shaped label',
    page.includes('setup-file-button') && page.includes('Choose an image'),
  );
  check(
    '  and the panel says what the state is rather than leaving the line empty',
    page.includes('No image chosen yet'),
  );
  {
    // Read from the SOURCE stylesheet rather than the built one, so the check does not
    // silently pass on a stale `public/assets/app.css` from an earlier build.
    const css = readFileSync(join(process.cwd(), 'assets', 'app.css'), 'utf8');
    check(
      'a disabled .setup-button is visibly disabled, because JavaScript disables this one',
      /\.setup-button:disabled[^{]*\{[^}]*opacity/.test(css),
    );
    check(
      '  and does not keep the pointer cursor, which is the other half of looking dead',
      /\.setup-button:disabled[^{]*\{[^}]*cursor:\s*not-allowed/.test(css),
    );
  }

  const form = (payload: string): Parameters<typeof app.inject>[0] => ({
    method: 'POST',
    headers: { cookie, 'content-type': 'application/x-www-form-urlencoded' },
    payload: `${payload}&_csrf=${encodeURIComponent(csrf)}`,
  });

  // A real image, generated here so nothing binary is committed.
  const png = await sharp({
    create: { width: 96, height: 96, channels: 3, background: { r: 30, g: 200, b: 160 } },
  })
    .png()
    .toBuffer();

  const upload = await app.inject({
    ...form(`imageData=${encodeURIComponent(png.toString('base64'))}`),
    url: `/ai/onboarding/${String(second)}/avatar`,
  });
  check(
    'an avatar uploads',
    String(upload.headers['location'] ?? '').includes('saved=avatar'),
    String(upload.headers['location'] ?? ''),
  );
  const dressed = (await listBotOnboardingProfiles(db)).find((p) => p.id === second);
  check(
    'the stored name comes from the CONTENT, so an attacker-chosen filename cannot traverse',
    /^bot-avatar-[0-9a-f]{16}\.jpg$/.test(dressed?.avatarPath ?? ''),
    dressed?.avatarPath ?? '',
  );
  check(
    'and it is prefixed as an avatar, so the asset root says what each file is for',
    (dressed?.avatarPath ?? '').startsWith('bot-avatar-'),
  );
  const stored = await readFile(join(ASSET_ROOT, dressed?.avatarPath ?? ''));
  check(
    'it was RE-ENCODED rather than stored as sent, which is what strips metadata',
    stored.subarray(0, 3).toString('hex') === 'ffd8ff' && !stored.equals(png),
  );
  /**
   * THE POINT OF THE BRIEFING. Dressing one bot must not dress the other, and an assertion
   * that bot A is bare passes against an implementation that stores nothing at all, so it is
   * only worth making beside the assertion above that bot B is dressed.
   */
  check(
    'CONTROL: the other bot is still bare, so one upload dressed exactly one bot',
    (await listBotOnboardingProfiles(db)).find((p) => p.id === first)?.avatarPath === null,
  );

  const served = await app.inject({
    method: 'GET',
    url: `/ai/onboarding/${String(second)}/avatar`,
    headers: { cookie },
  });
  check('the console serves it by BOT id, never by path', served.statusCode === 200);
  check(
    '  CONTROL: and 404s for the bot that has none, rather than serving the other one\'s',
    (await app.inject({ method: 'GET', url: `/ai/onboarding/${String(first)}/avatar`, headers: { cookie } }))
      .statusCode === 404,
  );
  check(
    'the page now shows the uploaded face rather than the default',
    (await pageFor(second)).includes(`/ai/onboarding/${String(second)}/avatar"`),
  );

  const notAnImage = await app.inject({
    ...form(`imageData=${encodeURIComponent(Buffer.from('#!/bin/sh').toString('base64'))}`),
    url: `/ai/onboarding/${String(second)}/avatar`,
  });
  check(
    'a file that is not an image is REFUSED, and the operator is told why',
    decodeURIComponent(String(notAnImage.headers['location'] ?? '')).includes(
      'could not be read as an image',
    ),
    decodeURIComponent(String(notAnImage.headers['location'] ?? '')).slice(0, 100),
  );
  check(
    '  and the refusal left the previous face in place rather than clearing it',
    (await listBotOnboardingProfiles(db)).find((p) => p.id === second)?.avatarPath ===
      dressed?.avatarPath,
  );

  const empty = await app.inject({ ...form(''), url: `/ai/onboarding/${String(second)}/avatar` });
  check(
    'an empty upload is refused rather than recorded as a face',
    decodeURIComponent(String(empty.headers['location'] ?? '')).includes('No file arrived'),
    decodeURIComponent(String(empty.headers['location'] ?? '')).slice(0, 80),
  );

  await app.inject({ ...form(''), url: `/ai/onboarding/${String(second)}/avatar/clear` });
  check(
    'and it can be cleared back to the deployment default',
    (await listBotOnboardingProfiles(db)).find((p) => p.id === second)?.avatarPath === null,
  );
  check(
    'the file is left on disk, so an accidental clear is a re-assign and not a re-find',
    await readFile(join(ASSET_ROOT, dressed?.avatarPath ?? '')).then(
      () => true,
      () => false,
    ),
  );

  // The end-to-end statement: what the runtime would read at the next boot, from what the
  // console actually did. This is the join the two halves of Part 2 meet at.
  await app.inject({
    ...form(`imageData=${encodeURIComponent(png.toString('base64'))}`),
    url: `/ai/onboarding/${String(second)}/avatar`,
  });
  {
    const hosted = await listBotsToHost(db);
    const real = loaderFor({});
    const out = await decideFaces(
      hosted.map((b) => ({ displayName: b.displayName, avatarPath: b.avatarPath })),
      {
        defaultImage: DEFAULT_IMAGE,
        resolve,
        load: (absolute) => {
          real.asked.push(absolute);
          return loadAvatarDataUri(absolute);
        },
      },
    );
    const aurora = out.find((o) => o.bot.displayName === 'Aurora');
    const cind = out.find((o) => o.bot.displayName === 'CIND3R3LLA');
    check(
      'END TO END: the bot the operator dressed in the console wears that image at boot',
      aurora?.source === 'own' && (aurora?.image ?? '').startsWith('data:image/jpg;base64,'),
      `${aurora?.source ?? '(none)'} / ${String(aurora?.image).slice(0, 30)}`,
    );
    check(
      '  CONTROL: and the one nobody dressed wears the deployment default',
      cind?.source === 'default' && cind?.image === DEFAULT_IMAGE,
      cind?.source ?? '(none)',
    );

    // Now take the file away underneath it: the operator's row still says it has a face.
    await rm(join(ASSET_ROOT, hosted.find((b) => b.displayName === 'Aurora')?.avatarPath ?? ''), {
      force: true,
    });
    const gone = await decideFaces(
      hosted.map((b) => ({ displayName: b.displayName, avatarPath: b.avatarPath })),
      { defaultImage: DEFAULT_IMAGE, resolve, load: loadAvatarDataUri },
    );
    check(
      'and if that file goes missing it is a fault, not a quiet return to the default',
      gone.find((o) => o.bot.displayName === 'Aurora')?.source === 'fault' &&
        gone.find((o) => o.bot.displayName === 'Aurora')?.image === undefined,
      gone.find((o) => o.bot.displayName === 'Aurora')?.source ?? '',
    );
  }

  await app.close();
  await rm(ASSET_ROOT, { recursive: true, force: true });

  console.log(
    failures === 0
      ? '\nAll bot-avatar checks passed: every bot wears its own face, and none means the default.'
      : `\n${String(failures)} CHECK(S) FAILED.`,
  );
  process.exit(failures === 0 ? 0 : 1);
}

await main();
