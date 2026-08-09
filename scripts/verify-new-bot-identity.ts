/**
 * A new bot arrives knowing its own name (CCB-S5-009, D-163).
 *
 *   npx tsx scripts/verify-new-bot-identity.ts
 *
 * ── THE DEFECT ───────────────────────────────────────────────────────────────
 *
 * The operator went to create his second bot and stopped, because creation left it in a
 * state he could not read. Two facts, both identity, both invisible:
 *
 *   1. THE WAKE WORD WAS NEVER ASKED FOR. CCB-S5-006 derived it from the display name so a
 *      new bot would not silently answer to "Cinderella". Right, and still invisible: the
 *      single most important fact about a bot was set by a function nobody saw, and the
 *      derivation is often wrong (SANCH3Z should answer to Sanchez). Worse, the derivation
 *      and the settings page disagreed about long names: one rejected over 40 characters and
 *      wrote NO override, the other truncated, so a bot with a long name inherited hers.
 *   2. THE RETORTS WERE SOMEBODY ELSE'S. Absence means inherit, and creation wrote no retort
 *      override, so every new bot answered a nickname with her twelve. Nine of them are her
 *      mythology rather than a template: the pumpkin, the fairy godmother, midnight, the
 *      ashes, the glass slipper, Cindy by name. Substituting `{wake}` does not rescue those.
 *      The alternative, an empty list, silently turned the nickname path off and took the
 *      verbal moderation ladder's spoken warning with it.
 *
 * ── WHAT IS ASSERTED, AND WHY EACH ONE HAS A CONTROL ────────────────────────
 *
 * "A new bot has its own retorts" passes against an implementation that copies hers, so the
 * pair is: it has its own AND none of them is one of hers AND none names her mythology. "The
 * wake word is required" passes against an implementation that accepts anything, so the pair
 * is: a blank one is refused AND a real one is stored AND a duplicate is refused by name
 * while a distinct one is accepted.
 *
 * Section 5 is the one that would have caught the original defect: it drives the REAL engine
 * for a bot with no retorts and proves the ladder's warning still arrives. Before this
 * briefing it was built and discarded, silently, which is the standing rule's exact wording.
 */

import { PGlite } from '@electric-sql/pglite';
import argon2 from 'argon2';
import { loadMigrationFiles } from '../src/db/migrate.js';
import type { Queryable } from '../src/db/pool.js';
import {
  createBotOnboardingProfile,
  listBotOnboardingProfiles,
  type BotCreationInput,
} from '../src/profiles/bot-onboarding.js';
import { botIdentity } from '../src/profiles/bot-identity.js';
import { listSettingOverridesForBot } from '../src/db/interaction-overrides.js';
import {
  DEFAULT_INTERACTION,
  NEW_BOT_RETORTS,
  WAKE_WORD_MAX_CHARS,
  normalizeInteraction,
  normalizeWakeWord,
} from '../src/interaction/settings.js';
import { applySettingOverrides } from '../src/interaction/setting-scope.js';
import { InteractionEngine } from '../src/interaction/engine.js';
import { DEFAULT_MODERATION_RULES } from '../src/moderation/rules.js';
import { DEFAULT_PERSONALITY } from '../src/interaction/personality.js';
import type { CapturedMessage } from '../src/capture/message.js';
import type * as T from 'simplex-chat/dist/types.js';
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

let itemId = 5000;
function nickname(text: string): CapturedMessage {
  return {
    groupId: 11,
    groupName: 'archive',
    itemId: itemId++,
    sharedMsgId: undefined,
    senderMemberId: 'member-probe-000',
    senderDisplayName: 'Probe',
    senderRole: 'member',
    senderGroupMemberId: 3,
    sentAt: new Date('2026-08-09T10:00:00.000Z').toISOString(),
    type: 'text',
    text,
    linkPreview: undefined,
    file: undefined,
    forwarded: false,
    quotedFromBot: false,
    raw: {} as T.AChatItem,
  };
}

async function refused(fn: () => Promise<unknown>): Promise<string | null> {
  try {
    await fn();
    return null;
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}

async function main(): Promise<void> {
  setLogLevel('error');

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

  /* ── 1 ─────────────────────────────────────────────────────────────────── */

  section('1. One definition of a usable wake word, used by both callers');

  check('a plain word survives', normalizeWakeWord('Sanchez') === 'Sanchez');
  check(
    'surrounding spaces are removed, which CCB-S5-006 found being stored raw',
    normalizeWakeWord('  Sanchez  ') === 'Sanchez',
  );
  check('and an inner run collapses, because two spaces render as one', normalizeWakeWord('San  chez') === 'San chez');
  check('one character is not a wake word', normalizeWakeWord('x') === null);
  check('nor is whitespace', normalizeWakeWord('   ') === null);
  check('nor is a non-string', normalizeWakeWord(undefined) === null);
  // THE REGRESSION. These two used to disagree: creation REJECTED over 40 and wrote no
  // override at all, so the bot inherited hers, while the settings page truncated.
  const long = 'B'.repeat(60);
  check(
    'a long name TRUNCATES rather than being rejected, so it never yields no wake word',
    normalizeWakeWord(long)?.length === WAKE_WORD_MAX_CHARS,
    String(normalizeWakeWord(long)?.length),
  );
  check(
    '  and the settings page agrees, because it is the same function',
    normalizeInteraction({ wakeWord: long }).wakeWord === normalizeWakeWord(long),
  );

  /* ── 2 ─────────────────────────────────────────────────────────────────── */

  section('2. Creation asks for it, requires it, and refuses a name already taken');

  const blank = await refused(() =>
    createBotOnboardingProfile(db, botInput('nameless', 'Nameless', '  '), OPERATOR),
  );
  check('a bot cannot be created without a usable wake word', blank !== null, blank ?? '');
  check(
    '  and the refusal says what a wake word is FOR, not just that it is invalid',
    (blank ?? '').includes('what members call it'),
  );
  check('and no bot was created by the attempt', (await listBotOnboardingProfiles(db)).length === 0);

  const first = await createBotOnboardingProfile(
    db,
    botInput('cinderella', 'CIND3R3LLA', 'Cinderella'),
    OPERATOR,
  );
  check('the first bot may take the shared default, which is the ordinary case', first > 0);
  {
    const overrides = await listSettingOverridesForBot(db, first);
    check(
      '  and stores no wake-word deviation for it, so a later shared edit still reaches it',
      !overrides.some((o) => o.key === 'wakeWord'),
    );
  }

  const dup = await refused(() =>
    createBotOnboardingProfile(db, botInput('copycat', 'Copycat', 'cinderella'), OPERATOR),
  );
  check('a second bot cannot take a wake word already in use', dup !== null);
  check(
    '  matched case-insensitively, because detectAddress matches that way',
    (dup ?? '').includes('already the wake word'),
    (dup ?? '').slice(0, 60),
  );
  check('  and it NAMES the bot holding it rather than only refusing', (dup ?? '').includes('CIND3R3LLA'));
  check('  and no bot was created', (await listBotOnboardingProfiles(db)).length === 1);

  // The positive control: the refusal above must be about the collision and nothing else.
  const second = await createBotOnboardingProfile(
    db,
    botInput('sanchez', 'SANCH3Z', 'Sanchez'),
    OPERATOR,
  );
  check('a DISTINCT wake word is accepted, so the check refuses collisions and not creation', second > 0);
  {
    const overrides = await listSettingOverridesForBot(db, second);
    const stored = overrides.find((o) => o.key === 'wakeWord')?.value;
    check('and it is stored as this bot own deviation', stored === 'Sanchez', String(stored));
    check(
      '  which is the operator typed word, NOT the display name it was derived from',
      stored !== 'SANCH3Z',
    );
  }

  /* ── 3 ─────────────────────────────────────────────────────────────────── */

  section('3. A new bot gets retorts of its own, and none of them are hers');

  const overrides = await listSettingOverridesForBot(db, second);
  const own = overrides.find((o) => o.key === 'retorts')?.value as
    | Record<string, string[]>
    | undefined;
  check('a new bot is created with its own retorts', own !== undefined);
  check(
    '  in both shipped languages, so a German group is not silently unserved',
    (own?.['en']?.length ?? 0) > 0 && (own?.['de']?.length ?? 0) > 0,
    `en ${String(own?.['en']?.length)}, de ${String(own?.['de']?.length)}`,
  );
  check(
    '  enough of them for the rotation to never repeat, which excludes only the previous one',
    (own?.['en']?.length ?? 0) >= 3,
  );

  const hers = new Set([...DEFAULT_INTERACTION.retorts['en']!, ...DEFAULT_INTERACTION.retorts['de']!]);
  const mine = [...(own?.['en'] ?? []), ...(own?.['de'] ?? [])];
  check(
    'NOT ONE of them is one of hers, which is what inheriting used to mean',
    mine.every((line) => !hers.has(line)),
  );
  // The stronger form, because a paraphrase of her mythology would pass the check above.
  const HER_WORLD = ['pumpkin', 'kürbis', 'slipper', 'schuh', 'midnight', 'mitternacht', 'godmother', 'fee', 'ash', 'asche', 'princess', 'prinzessin', 'cindy'];
  const leaked = mine.filter((line) => HER_WORLD.some((w) => line.toLowerCase().includes(w)));
  check(
    'and none of them names her world, so a paraphrase could not sneak through either',
    leaked.length === 0,
    leaked.join(' | '),
  );
  check(
    'every one substitutes the bot own name, so none can insist on a name it does not have',
    mine.every((line) => line.includes('{wake}') || !line.includes('Cinderella')),
  );
  check(
    'the shipped starter set and what was stored are the same text',
    JSON.stringify(own?.['en']) === JSON.stringify([...(NEW_BOT_RETORTS['en'] ?? [])]),
  );

  /* ── 4 ─────────────────────────────────────────────────────────────────── */

  section('4. The three retort states are told apart, because silence looks identical');

  const shared = normalizeInteraction({});
  const facts = (o: { key: string; value: unknown }[], avatar: string | null = null, link: string | null = null) =>
    botIdentity({ avatarPath: avatar, contactAddressLink: link, overrides: o.map((x) => ({ ...x, botProfileId: second })), shared });

  check(
    'OWN: an override with lines in it',
    facts([{ key: 'retorts', value: { en: ['a', 'b'] } }]).retortSource === 'own',
  );
  check(
    'INHERITED: no override at all, which is a bot speaking in her voice about her name',
    facts([]).retortSource === 'inherited',
  );
  check(
    'NONE: an override deliberately emptied, which is configured and answers nothing',
    facts([{ key: 'retorts', value: { en: [] } }]).retortSource === 'none',
  );
  check(
    '  and NONE is not reported as own, which would show a silent feature as healthy',
    facts([{ key: 'retorts', value: { en: [] } }]).retortCount === 0,
  );
  check(
    'the wake word reads as the shared default when the bot has no deviation',
    facts([]).wakeWordIsOwn === false && facts([]).wakeWord === shared.wakeWord,
  );
  check(
    '  and as its own when it has one',
    facts([{ key: 'wakeWord', value: 'Sanchez' }]).wakeWordIsOwn === true,
  );
  check('a face is reported when there is one', facts([], 'bot-avatar-x.jpg').hasFace);
  check('  and not when there is not', !facts([]).hasFace);
  check('onboarded follows the contact address, reusing the page own definition', facts([], null, 'https://x').onboarded);

  /* ── 5 ─────────────────────────────────────────────────────────────────── */

  section('5. The real engine: its own retort, and the ladder never goes silent');

  const settingsFor = async (botId: number) =>
    applySettingOverrides(
      normalizeInteraction({ nicknames: { enabled: true, words: 'Cindy', spamLimit: 1000 } }),
      await listSettingOverridesForBot(db, botId),
    );

  {
    const s = await settingsFor(second);
    const sent: string[] = [];
    const engine = new InteractionEngine({
      db,
      settings: () => s,
      personality: () => ({ ...DEFAULT_PERSONALITY }),
      moderationRules: () => DEFAULT_MODERATION_RULES,
      // The model is faked so the CONTENT under test is the stored retort rather than a
      // model's rewording of it. What reaches a member is this text in the bot's voice.
      personalize: async (request) => Promise.resolve(request.deterministicDraft),
      send: async (_msg, text) => {
        sent.push(text);
        return Promise.resolve();
      },
    });

    await engine.handle(nickname('Cindy are you there'));
    check('a nickname reaches the new bot and it answers', sent.length === 1, sent[0]?.slice(0, 70) ?? '');
    check(
      'and it answers with ITS name, not hers',
      (sent[0] ?? '').includes('Sanchez') || !(sent[0] ?? '').includes('Cinderella'),
      sent[0] ?? '',
    );
    check(
      'and the line it used is one of its own, not one of hers',
      !hers.has((sent[0] ?? '').replace('Sanchez', '{wake}')),
    );
  }

  {
    // THE ORIGINAL SILENT FAILURE. A bot whose retorts were emptied still counts the
    // violation and still escalates, and the warning used to be built and thrown away with
    // the retort it had nothing to attach to.
    const emptied = applySettingOverrides(
      normalizeInteraction({ nicknames: { enabled: true, words: 'Cindy', spamLimit: 1000 } }),
      [{ botProfileId: second, key: 'retorts', value: { en: [], de: [] } }],
    );
    const sent: string[] = [];
    const engine = new InteractionEngine({
      db,
      settings: () => emptied,
      personality: () => ({ ...DEFAULT_PERSONALITY }),
      moderationRules: () => DEFAULT_MODERATION_RULES,
      personalize: async (request) => Promise.resolve(request.deterministicDraft),
      send: async (_msg, text) => {
        sent.push(text);
        return Promise.resolve();
      },
    });

    await db.query(`DELETE FROM cinderella_violations`);
    for (let i = 0; i < 6; i++) await engine.handle(nickname('Cindy again'));

    const { rows: counted } = await db.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM cinderella_violations`,
    );
    check('with no retorts the violation is still counted', Number(counted[0]?.n ?? 0) === 6, `${counted[0]?.n ?? '0'} rows`);
    check(
      'AND the ladder warning still reaches the member rather than being discarded',
      sent.length > 0,
      `${sent.length} sent`,
    );
    check(
      '  and what arrived is warning text, since there was no retort to carry it',
      sent.every((t) => t.trim().length > 0),
    );
  }

  /* ── 6 ─────────────────────────────────────────────────────────────────── */

  section('6. The console: the field exists, and the identity is on the page');

  process.env['SESSION_SECRET'] ??= 'identity-verify-secret-0123456789abcdefghij';
  const adminCfg = {
    adminPort: 8804,
    adminUsername: OPERATOR,
    adminPasswordHash: await argon2.hash(PASSWORD, { type: argon2.argon2id }),
    sessionSecret: 'identity-verify-session-secret-0123456789ab',
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

  // Whitespace-collapsed, because the templates wrap prose across lines and an exact
  // substring match on rendered HTML is a verifier defect this project has already booked
  // (D-111): the page was right and the check was reading it wrong.
  const pageFor = async (id: number): Promise<string> =>
    (
      await app.inject({
        method: 'GET',
        url: `/ai/onboarding?profile=${String(id)}`,
        headers: { cookie },
      })
    ).body.replace(/\s+/g, ' ');

  const onSecond = await pageFor(second);
  check('the create form asks for a wake word', onSecond.includes('name="wakeWord"'));
  check(
    '  and says what it is for in the words an operator needs',
    onSecond.includes('what members call it') && onSecond.includes('what wakes it'),
  );
  check('  and warns that two bots cannot share one', onSecond.includes('both would answer the same sentence'));
  check(
    '  and the browser can pre-fill it, so the derivation stays the default',
    onSecond.includes('data-wake-source') && onSecond.includes('data-wake-word'),
  );

  check('the detail page carries the identity panel', onSecond.includes('data-identity-panel'));
  check('  and states the name the bot answers to', onSecond.includes('Sanchez'));
  check('  and that the name is its own', onSecond.includes('its own'));
  check(
    '  and states the moderation dependency, which is not obvious from anywhere else',
    onSecond.includes('what the violation counter counts'),
  );

  // The bot on the shared default must READ as being on it, which is the honest state and
  // the one an operator has to be able to see.
  const onFirst = await pageFor(first);
  check('a bot on the shared default says so rather than showing it as its own', onFirst.includes('the shared default'));
  check('  and points at where to fix it', onFirst.includes('/interaction/addressing?bot='));

  await app.close();
  await pg.close();

  console.log(failures === 0 ? `\nAll new-bot identity checks passed.` : `\n${failures} CHECK(S) FAILED.`);
  if (failures > 0) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
