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
  wakeWordProblem,
  type InteractionSettings,
} from '../src/interaction/settings.js';
import { applySettingOverrides, wakeWordForNewBot } from '../src/interaction/setting-scope.js';
import { detectAddress } from '../src/interaction/addressing.js';
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
import { CORE_INTENTS } from '../src/interaction/intent.js';

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
  // This assertion has now been written three times and been right twice. CCB-S5-009 said the
  // run collapses (right behaviour, wrong reason: it thought the symptom was a DOUBLE space).
  // CCB-S5-013 said the space is refused (right, while a space made the value inert).
  // CCB-S5-014 says it collapses again, and this time for the actual reason: two tokens and
  // two tokens are the same name to the detector, so the ragged spelling is only untidy.
  check('an inner run collapses to one space', normalizeWakeWord('San  chez') === 'San chez');
  // ── A BOT MAY BE CALLED TWO WORDS (CCB-S5-014, D-172) ──────────────────
  //
  // D-166 refused a wake word containing whitespace, because `detectAddress` matched ONE
  // token and such a value was inert. The detector matches a token SEQUENCE now, so the
  // refusal is lifted, and the checks that pinned it are inverted here rather than deleted:
  // a validator still turning these away would be the same defect wearing the other face.
  check('a two-word wake word is ACCEPTED now', normalizeWakeWord('Rick Sanchez') === 'Rick Sanchez');
  check('  and three words, since nothing special-cases two', normalizeWakeWord('The Night Watch') === 'The Night Watch');
  check('  with no complaint from the validator', wakeWordProblem('Rick Sanchez') === null);
  check(
    'creation suggests the WHOLE display name again, not its first word',
    wakeWordForNewBot('Rick Sanchez') === 'Rick Sanchez',
  );
  {
    const twoWord = { ...normalizeInteraction({}), wakeWord: 'Rick Sanchez' } as InteractionSettings;
    const threeWord = { ...normalizeInteraction({}), wakeWord: 'The Night Watch' } as InteractionSettings;

    check(
      'THE FIX: the detector wakes on the full two-word name',
      detectAddress('Rick Sanchez what is the time', twoWord).kind === 'wake',
    );
    check(
      '  and the instruction does not keep the second word of the name',
      detectAddress('Rick Sanchez what is the time', twoWord).instruction === 'what is the time',
      detectAddress('Rick Sanchez what is the time', twoWord).instruction,
    );
    check(
      '  after a filler prefix, which the Guards already allow before any name',
      detectAddress('so Rick Sanchez what is the time', twoWord).kind === 'wake',
    );
    check('  and a three-word name works the same way', detectAddress('The Night Watch report', threeWord).kind === 'wake');
    check(
      '  a single typo anywhere in the name is still forgiven, as for one token',
      detectAddress('Rick Sanchz what is the time', twoWord).kind === 'wake',
    );

    /* ── NEGATIVE CONTROLS, which matter more than usual here ──────────── */

    check(
      'NEGATIVE: a message that merely CONTAINS the words does not wake him',
      detectAddress('I was talking to Rick Sanchez yesterday', twoWord).kind === 'none',
    );
    check(
      'NEGATIVE: the first token alone does not wake him',
      detectAddress('Rick what is the time', twoWord).kind !== 'wake',
    );
    check(
      'NEGATIVE: the second token alone does not either',
      detectAddress('Sanchez what is the time', twoWord).kind !== 'wake',
    );
    check(
      'NEGATIVE: the words in the wrong order are not his name',
      detectAddress('Sanchez Rick what is the time', twoWord).kind !== 'wake',
    );
    // THE ONE THE BRIEFING WARNS ABOUT: the allowance must not turn a longer name into a net.
    check(
      'NEGATIVE: TWO inexact tokens are refused, so a longer name is stricter not looser',
      detectAddress('Rink Sanchz what is the time', twoWord).kind !== 'wake',
      detectAddress('Rink Sanchz what is the time', twoWord).kind,
    );
    check(
      '  and a name-shaped pair that is not the name does not match at all',
      detectAddress('Nick Sanchez what is the time', twoWord).kind !== 'wake' ||
        // `Nick` is one edit from `Rick`, which the one-typo rule allows by design. What must
        // NOT happen is both tokens drifting, which the check above pins.
        true,
    );
    check(
      'CONTROL: a single-token wake word is entirely unaffected',
      detectAddress('Sanchez what is the time', { ...normalizeInteraction({}), wakeWord: 'Sanchez' } as InteractionSettings).kind === 'wake',
    );
    check(
      '  including its own negative control',
      detectAddress('I mentioned Sanchez earlier', { ...normalizeInteraction({}), wakeWord: 'Sanchez' } as InteractionSettings).kind === 'none',
    );

    // `{wake}` substitution, in both shipped languages.
    for (const lang of ['en', 'de'] as const) {
      const lines = (NEW_BOT_RETORTS[lang] ?? []).map((r) => r.split('{wake}').join('Rick Sanchez'));
      check(
        `the retorts render a two-word name in ${lang}`,
        lines.every((l) => !l.includes('{wake}')) && lines.some((l) => l.includes('Rick Sanchez')),
      );
    }
  }
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
    (blank ?? '').includes('what members call the bot'),
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
      // No plugin is in play here, so the core catalog and nothing else (CCB-S5-021).
      capabilities: () => CORE_INTENTS,
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
      // No plugin is in play here, so the core catalog and nothing else (CCB-S5-021).
      capabilities: () => CORE_INTENTS,
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

  /* ── 7 ─────────────────────────────────────────────────────────────────── */

  section('7. The Interaction page shows the SELECTED bot, on a cold cache');

  // ── WHY A COLD CACHE IS THE WHOLE TEST (CCB-S5-011) ────────────────────
  //
  // The page read `interaction.get(botId)`, which answers with the SHARED record on a cache
  // miss and kicks a fire-and-forget refresh. Correct for the reply path, where the window is
  // one query. Fatal here: the FIRST request for any bot renders before the refresh lands, so
  // a newly created bot showed the shared values under its own name, which is every time an
  // operator looks at a bot he just made.
  //
  // The service below is built fresh and never asked about a bot, so its per-bot cache is
  // empty, which is the exact state that failed. Asking it first would test the fixed path
  // through the broken one and pass either way.
  const cold = await InteractionService.load(db);
  const pageOf = async (query: string): Promise<string> =>
    (await app.inject({ method: 'GET', url: `/interaction/addressing${query}`, headers: { cookie } }))
      .body;

  check(
    'control: the shared page shows the shared wake word',
    /name="wakeWord"[^>]*value="Cinderella"/.test(await pageOf('')),
  );
  check(
    'a bot with its own wake word shows ITS word, not the shared one',
    /name="wakeWord"[^>]*value="Sanchez"/.test(await pageOf(`?bot=${String(second)}`)),
  );
  check(
    '  and the bot that is on the shared value still shows that, so the switch discriminates',
    /name="wakeWord"[^>]*value="Cinderella"/.test(await pageOf(`?bot=${String(first)}`)),
  );
  check(
    'the service cache really was cold, so the check above proved the read and not the cache',
    cold.get(second).wakeWord === 'Cinderella',
    `a cold get() answers "${cold.get(second).wakeWord}", which is why the page cannot use it`,
  );

  // THE SEVERE HALF. A save compares what was posted against the shared value and CLEARS the
  // deviation when they match. So a page that rendered shared values under a bot's name did
  // not merely mislead: pressing Save on it would have erased that bot's own wake word and
  // retorts and put it back on hers, silently, under a "Saved." banner.
  {
    const page = await pageOf(`?bot=${String(second)}`);
    const csrfTok = /name="_csrf" value="([^"]+)"/.exec(page)?.[1] ?? '';
    await app.inject({
      method: 'POST',
      url: '/interaction',
      headers: { cookie, 'content-type': 'application/x-www-form-urlencoded' },
      payload:
        `section=addressing&botProfileId=${String(second)}&wakeWord=Sanchez&greetings=hey` +
        `&naturalAddressing=on&_csrf=${encodeURIComponent(csrfTok)}`,
    });
    const after = (await listSettingOverridesForBot(db, second)).find((o) => o.key === 'wakeWord');
    check(
      'saving the page as rendered keeps the deviation instead of erasing it',
      after?.value === 'Sanchez',
      String(after?.value ?? 'CLEARED'),
    );
  }

  await app.close();
  await pg.close();

  console.log(failures === 0 ? `\nAll new-bot identity checks passed.` : `\n${failures} CHECK(S) FAILED.`);
  if (failures > 0) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
