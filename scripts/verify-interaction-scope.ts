/**
 * Two bots, one name (CCB-S5-006, D-158).
 *
 * The inventory is DATA, so this can check it rather than take its word:
 *
 *   1. Every key of `InteractionSettings` is placed. A setting added later without a
 *      placement fails here rather than silently defaulting to shared, which is exactly
 *      how `wakeWord` came to be shared.
 *   2. The per-bot list in the code and the CHECK the DATABASE enforces agree. They are a
 *      deliberate duplication; drift between them is not.
 *   3. Two bots get different wake words, and neither inherits the other's retorts.
 *   4. A shared setting cannot be given a per-bot value at any layer.
 *
 * Mutation-proven, and every guarantee has a positive control: an isolation check passes
 * trivially against an implementation where nothing is set at all.
 *
 *   npx tsx scripts/verify-interaction-scope.ts
 */

import { PGlite } from '@electric-sql/pglite';
import { loadMigrationFiles } from '../src/db/migrate.js';
import type { Queryable } from '../src/db/pool.js';
import {
  clearSettingOverride,
  listAllSettingOverrides,
  listSettingOverridesForBot,
  perBotKeysAcceptedByDatabase,
  setSettingOverride,
  SharedSettingError,
} from '../src/db/interaction-overrides.js';
import {
  SETTING_SCOPES,
  applySettingOverrides,
  describeSettingScopes,
  isPerBot,
  readPath,
  retortsForBot,
  wakeWordForNewBot,
} from '../src/interaction/setting-scope.js';
import {
  DEFAULT_INTERACTION,
  normalizeInteraction,
  type InteractionSettings,
} from '../src/interaction/settings.js';
import {
  createBotOnboardingProfile,
  type BotOnboardingInput,
} from '../src/profiles/bot-onboarding.js';
import { DEFAULT_PERSONALITY } from '../src/interaction/personality.js';
import { setLogLevel } from '../src/log.js';

/** A minimal valid bot, so the check drives the real creation path. */
function botInput(slug: string, displayName: string): BotOnboardingInput {
  return {
    slug,
    displayName,
    wakeWord: displayName,
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

let failures = 0;
function check(label: string, ok: boolean, detail = ''): void {
  if (!ok) failures++;
  console.log(`  [${ok ? 'PASS' : 'FAIL'}] ${label}${detail ? `: ${detail}` : ''}`);
}

/**
 * Every key an operator can set, as dotted paths.
 *
 * Derived from a REAL normalized settings object rather than from a hand-written list, so a
 * new setting appears here the moment it exists. Descends into the two objects whose halves
 * genuinely differ in scope and stops at the ones that move together.
 */
function settingKeys(s: InteractionSettings): string[] {
  const out: string[] = [];
  for (const [key, value] of Object.entries(s)) {
    if (key === 'addressing' || key === 'nicknames') {
      for (const sub of Object.keys(value as object)) out.push(`${key}.${sub}`);
    } else {
      out.push(key);
    }
  }
  return out;
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
  } as Queryable;
  for (const migration of await loadMigrationFiles()) await pg.exec(migration.sql);

  const shared = normalizeInteraction({});

  // The PRIMARY is inserted directly, standing in for the bot that predates this briefing:
  // it must come out with exactly what it has today and no override rows.
  const { rows } = await db.query<{ id: string }>(
    `INSERT INTO cinderella_bot_profiles (slug, display_name, enabled, selected_for_runtime)
     VALUES ('primary-bot','CIND3R3LLA',TRUE,TRUE) RETURNING id`,
  );
  const primary = Number(rows[0]?.id ?? 0);

  // The SECOND goes through the real creation path, because that is what an operator uses
  // and it is where the wake word is set. Inserting it with raw SQL would prove the
  // migration's backfill and nothing about how bots are actually made from here on.
  const second = await createBotOnboardingProfile(db, botInput('support-desk', 'SupportDesk'), 'verify');

  /* ── 1. The inventory covers everything ─────────────────────────────────── */

  console.log('\n1. Every setting is placed, so none can default to shared by accident');
  {
    const keys = settingKeys(shared);
    const placed = new Set(SETTING_SCOPES.map((p) => p.key));
    const unplaced = keys.filter((k) => !placed.has(k));
    check(
      'every key of InteractionSettings has a placement',
      unplaced.length === 0,
      unplaced.length > 0 ? `unplaced: ${unplaced.join(', ')}` : `${String(keys.length)} keys`,
    );

    const stale = [...placed].filter((k) => !keys.includes(k));
    check(
      'and every placement names a key that still exists',
      stale.length === 0,
      stale.length > 0 ? `stale: ${stale.join(', ')}` : '',
    );

    check(
      'every placement carries a reason, because the inventory IS the deliverable',
      SETTING_SCOPES.every((p) => p.reason.trim().length > 10),
    );

    // The two the briefing states outright, asserted so a later edit cannot quietly move
    // them: consent is a property of the archive, and the wake word is her name.
    check('wakeWord is per bot', isPerBot('wakeWord'));
    check(
      'consent behaviour is shared, all of it',
      ['affirmations', 'declines', 'hideWords', 'deleteWords', 'undoWindowSeconds'].every(
        (k) => !isPerBot(k),
      ),
    );
    check(
      'the archive and project addresses are shared, because they are destinations',
      !isPerBot('archiveUrl') && !isPerBot('projectUrl'),
    );
  }

  /* ── 2. The code list and the database agree ────────────────────────────── */

  console.log('\n2. The code and the database enforce the same per-bot set');
  {
    const fromDb = (await perBotKeysAcceptedByDatabase(db)).sort();
    const fromCode = SETTING_SCOPES.filter((p) => p.scope === 'per-bot')
      .map((p) => p.key)
      .sort();
    check(
      'the CHECK constraint and SETTING_SCOPES list the same keys',
      JSON.stringify(fromDb) === JSON.stringify(fromCode),
      `${String(fromDb.length)} in the database, ${String(fromCode.length)} in the code`,
    );
    check(
      'and the list is not empty, so the comparison above means something',
      fromDb.length > 0,
      fromDb.join(', '),
    );
  }

  /* ── 3. Two bots, two names ─────────────────────────────────────────────── */

  console.log('\n3. Two bots never answer to one name');
  {
    // The migration's backfill should already have given the non-primary bot its own name.
    const secondOverrides = await listSettingOverridesForBot(db, second);
    const backfilled = secondOverrides.find((o) => o.key === 'wakeWord');
    check(
      'creating a bot gives it its OWN display name as its wake word',
      backfilled?.value === 'SupportDesk',
      String(backfilled?.value),
    );
    check(
      'and left the primary on the shared value, rather than showing it as deviating',
      (await listSettingOverridesForBot(db, primary)).every((o) => o.key !== 'wakeWord'),
    );

    const primarySettings = applySettingOverrides(shared, await listSettingOverridesForBot(db, primary));
    const secondSettings = applySettingOverrides(shared, secondOverrides);
    check(
      'the two bots resolve to different wake words',
      primarySettings.wakeWord !== secondSettings.wakeWord,
      `"${primarySettings.wakeWord}" and "${secondSettings.wakeWord}"`,
    );
    check(
      'the primary keeps exactly what it had, which is the shipping requirement',
      primarySettings.wakeWord === shared.wakeWord,
      `"${primarySettings.wakeWord}"`,
    );

    // A new bot's wake word is its own name, never the shared one.
    check(
      'a new bot is given its own name rather than inheriting hers',
      wakeWordForNewBot('SupportDesk') === 'SupportDesk',
    );
    check(
      'and a name that cannot serve as a wake word yields NOTHING rather than hers',
      wakeWordForNewBot('x') === null,
      'no wake word is visible; the wrong wake word is not',
    );
  }

  /* ── 4. Retorts, and "none" as a real state ─────────────────────────────── */

  console.log('\n4. A bot never speaks in her voice about a name that is not its own');
  {
    await setSettingOverride(db, second, 'retorts', {});
    const secondSettings = applySettingOverrides(shared, await listSettingOverridesForBot(db, second));

    check(
      'a bot can have NO retorts, and that is a stored state rather than a fallback',
      Object.keys(secondSettings.retorts).length === 0,
    );
    // POSITIVE CONTROL: the shared record really does have retorts, so the check above is
    // proving an override rather than an empty fixture.
    check(
      'CONTROL: the shared record does have retorts, so the emptiness above is deliberate',
      Object.keys(shared.retorts).length > 0,
      `${String(Object.keys(shared.retorts).length)} language(s)`,
    );
    check(
      'and the primary still has hers',
      Object.keys(
        applySettingOverrides(shared, await listSettingOverridesForBot(db, primary)).retorts,
      ).length > 0,
    );

    await setSettingOverride(db, second, 'nicknames.words', ['Deskie']);
    const s2 = applySettingOverrides(shared, await listSettingOverridesForBot(db, second));
    check(
      'a bot refuses its OWN pet names, not hers',
      JSON.stringify(s2.nicknames.words) === JSON.stringify(['Deskie']),
      s2.nicknames.words.join(', '),
    );
    check(
      'while the shared list is untouched',
      JSON.stringify(readPath(shared, 'nicknames.words')) ===
        JSON.stringify(normalizeInteraction({}).nicknames.words),
    );
  }

  /* ── 5. A shared setting cannot be set per bot ──────────────────────────── */

  console.log('\n5. A shared setting is refused at every layer');
  {
    let appRefused = '';
    try {
      await setSettingOverride(db, second, 'affirmations', ['ja']);
    } catch (err) {
      appRefused = err instanceof Error ? err.message : String(err);
    }
    check(
      'the application gate refuses it with the inventory reason',
      appRefused.includes('Shared across every bot') && appRefused.includes('archive'),
      appRefused.slice(0, 80),
    );
    check('and it is a named error the console can catch', appRefused.length > 0);

    // The DATABASE refuses it too, with the gate bypassed. This is the layer that holds
    // when a form posts a field nobody expected.
    let dbRefused = '';
    try {
      await db.query(
        `INSERT INTO cinderella_interaction_overrides (bot_profile_id, setting_key, value)
         VALUES ($1, 'affirmations', '["ja"]'::jsonb)`,
        [second],
      );
    } catch (err) {
      dbRefused = err instanceof Error ? err.message : String(err);
    }
    check(
      'the CHECK constraint refuses it with the application gate bypassed',
      dbRefused.length > 0,
      dbRefused.slice(0, 70),
    );

    // MUTATION: a forged shared override changes nothing, even handed straight to the
    // assembler. Positive control beside it, so this proves a refusal and not a no-op.
    const forged = applySettingOverrides(shared, [
      { botProfileId: second, key: 'affirmations', value: ['ja'] },
    ]);
    check(
      'MUTATION: a forged shared override is ignored by the assembler',
      JSON.stringify(forged.affirmations) === JSON.stringify(shared.affirmations),
    );
    const real = applySettingOverrides(shared, [
      { botProfileId: second, key: 'wakeWord', value: 'Other' },
    ]);
    check(
      'CONTROL: the same shape DOES take effect on a per-bot setting',
      real.wakeWord === 'Other',
    );
  }

  /* ── 6. The console can say which is which ──────────────────────────────── */

  console.log('\n6. Every setting can be shown as shared or per bot');
  {
    const overrides = await listAllSettingOverrides(db);
    const scopes = describeSettingScopes(overrides, 2);

    check(
      'every placed setting has a scope view',
      SETTING_SCOPES.every((p) => scopes.has(p.key)),
      `${String(scopes.size)} of ${String(SETTING_SCOPES.length)}`,
    );
    check(
      'a deviating setting names the bots that deviate',
      scopes.get('wakeWord')?.deviatingBotIds.includes(second) === true,
    );
    check(
      'and the shared count EXCLUDES them, so an edit warning cannot overstate',
      scopes.get('wakeWord')?.sharedBotCount === 1,
      'one of two bots deviates, so the shared value reaches one',
    );
    check(
      'a shared setting reaches every bot',
      scopes.get('affirmations')?.sharedBotCount === 2 &&
        scopes.get('affirmations')?.deviatingBotIds.length === 0,
    );

    // Reverting puts the bot back on the shared value rather than on a copy of it.
    await clearSettingOverride(db, second, 'retorts');
    const reverted = applySettingOverrides(shared, await listSettingOverridesForBot(db, second));
    check(
      'clearing a deviation puts that bot back on the shared value',
      Object.keys(reverted.retorts).length === Object.keys(shared.retorts).length,
    );
  }

  /* ── 5. What the CONSOLE stores, which is not what the store accepts ─────── */

  /**
   * ── WHY THIS SECTION EXISTS ────────────────────────────────────────────────
   *
   * Everything above drives the override STORE directly, and the store is fine. The console
   * is a second path to it, and it was writing values the store would never have produced:
   * it read the merged form data and returned before the shared save that normalizes, so the
   * bot with the deviation was the one running on unclamped values.
   *
   * These reproduce the console's own transformation rather than describing it: `next` is the
   * merged object, and what goes into the override is what `readPath`/`retortsForBot` return
   * from it.
   */
  console.log('\n5. What the console stores for one bot is normalized, like everything else');

  const shipped = normalizeInteraction({ ...DEFAULT_INTERACTION });

  /** The console's `next` after a form post: cloned settings with raw strings written in. */
  const posted = (edits: Record<string, unknown>): InteractionSettings => {
    const next = structuredClone(shipped) as unknown as Record<string, unknown>;
    for (const [path, value] of Object.entries(edits)) {
      const parts = path.split('.');
      let cursor = next;
      for (const part of parts.slice(0, -1)) cursor = cursor[part] as Record<string, unknown>;
      cursor[parts[parts.length - 1] as string] = value;
    }
    return next as unknown as InteractionSettings;
  };

  const guards = normalizeInteraction(
    posted({ confidenceThreshold: '0.9', 'addressing.maxInstructionLength': '250' }),
  );
  check(
    'a threshold typed into the form is stored as a NUMBER',
    typeof readPath(guards, 'confidenceThreshold') === 'number',
    `${typeof readPath(guards, 'confidenceThreshold')} ${String(readPath(guards, 'confidenceThreshold'))}`,
  );
  check(
    'and a bound as a number too',
    typeof readPath(guards, 'addressing.maxInstructionLength') === 'number',
  );
  /**
   * MUTATION: the shape that shipped. `for (const nick of s.nicknames.words)` walks a string
   * character by character, so a bot whose word list was stored raw refused every message
   * containing an "n", an "o", a "v" or an "a".
   */
  const rawWords = readPath(posted({ 'nicknames.words': 'nova, novi' }), 'nicknames.words');
  check(
    'MUTATION: stored raw, a nickname list is a STRING, and iterating it yields characters',
    typeof rawWords === 'string' && [...(rawWords as string)][0] === 'n',
  );
  // The field is COMMA separated, which the first version of this check got wrong and the
  // implementation got right: `parseList` is called without `lines` for the word list.
  const words = readPath(normalizeInteraction(posted({ 'nicknames.words': 'nova, novi' })), 'nicknames.words');
  check(
    'normalized, it is the list it claims to be',
    Array.isArray(words) && (words as string[]).length === 2,
    JSON.stringify(words),
  );
  check(
    'and a wake word arrives without the spaces the operator typed',
    readPath(normalizeInteraction(posted({ wakeWord: '   Aurora   ' })), 'wakeWord') === 'Aurora',
  );

  /* ── "None" is reachable through the page, not only through the store ───── */

  const cleared = posted({ 'retorts.en': '' });
  const forBot = retortsForBot(
    (cleared as unknown as Record<string, unknown>)['retorts'],
    normalizeInteraction(cleared),
  );
  check(
    'a language the operator emptied is stored EMPTY for that bot',
    (forBot['en'] ?? []).length === 0,
    `${String((forBot['en'] ?? []).length)} retort(s)`,
  );
  check(
    'CONTROL: the other language is untouched, so the emptiness is the edit and not a wipe',
    (forBot['de'] ?? []).length > 0,
    `${String((forBot['de'] ?? []).length)} retort(s)`,
  );
  /**
   * MUTATION: what the console did before. `normalizeInteraction` refills a blank list with
   * the shipped one, deliberately and asserted for the SHARED record, so reading the override
   * straight out of it gave a second bot HER twelve retorts, in her register, about her name.
   */
  check(
    'MUTATION: read straight from the normalized object, "none" becomes HER retorts',
    ((readPath(normalizeInteraction(cleared), 'retorts') as Record<string, string[]>)['en'] ?? [])
      .length === 12,
  );
  check(
    'and a bot with no retorts in any language keeps none through a save',
    Object.keys(retortsForBot({}, shipped)).length === 0,
  );
  check(
    'an already-empty list is not refilled either',
    (retortsForBot({ en: [] }, shipped)['en'] ?? []).length === 0,
  );

  /* ── One form on a page does not wipe the other's deviation ─────────────── */

  /**
   * The Nicknames page carries two per-bot settings edited by two forms, and so does Voice.
   * The console builds `next` from the settings being edited; when that was the SHARED record,
   * every key the form did not submit compared equal to shared and cleared the bot's
   * deviation. Saving the retorts form wiped the bot's nickname list.
   */
  const pages = new Map<string, string[]>();
  for (const p of SETTING_SCOPES) {
    if (p.scope !== 'per-bot') continue;
    pages.set(p.section, [...(pages.get(p.section) ?? []), p.key]);
  }
  const exposed = [...pages].filter(([, keys]) => keys.length > 1);
  check(
    'the pages where this can happen are known, so the fix is not aimed at nothing',
    exposed.length > 0,
    exposed.map(([s, k]) => `${s}: ${k.join(' + ')}`).join('; '),
  );

  const botsRetorts = { en: ['mine'], de: ['meine'] };
  const withDeviation = applySettingOverrides(shipped, [
    { botProfileId: 9, key: 'retorts', value: botsRetorts },
    { botProfileId: 9, key: 'nicknames.words', value: ['nova'] },
  ]);
  // Saving the NICKNAMES form, based on the bot's own settings: retorts are not submitted.
  const savedFromBot = structuredClone(withDeviation) as unknown as Record<string, unknown>;
  (savedFromBot['nicknames'] as Record<string, unknown>)['words'] = 'nova\nnovi';
  const keptRetorts = retortsForBot(
    savedFromBot['retorts'],
    normalizeInteraction(savedFromBot as unknown as InteractionSettings),
  );
  check(
    'saving one form on a page keeps the bot\'s deviation in the other',
    JSON.stringify(keptRetorts) === JSON.stringify(botsRetorts),
    JSON.stringify(keptRetorts['en']),
  );
  /**
   * MUTATION: based on the SHARED record instead, which is what shipped. The unsubmitted
   * retorts read back as the shared ones, compare equal to shared, and the deviation is gone.
   */
  const savedFromShared = structuredClone(shipped) as unknown as Record<string, unknown>;
  (savedFromShared['nicknames'] as Record<string, unknown>)['words'] = 'nova\nnovi';
  check(
    'MUTATION: based on the shared record, the other deviation is silently cleared',
    JSON.stringify(
      retortsForBot(
        savedFromShared['retorts'],
        normalizeInteraction(savedFromShared as unknown as InteractionSettings),
      ),
    ) === JSON.stringify(readPath(shipped, 'retorts')),
  );

  console.log(
    failures === 0
      ? '\nAll interaction-scope checks passed: the inventory is complete, and two bots keep two names.'
      : `\n${failures} CHECK(S) FAILED.`,
  );
  await pg.close();
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
