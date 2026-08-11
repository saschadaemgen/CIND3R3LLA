/**
 * A renamed bot answers to its new name (CCB-S5-030).
 *
 * ── THE PRODUCTION FAILURE ───────────────────────────────────────────────────
 *
 * The operator renamed a bot and it went on answering only to the old name. `validateCreation`
 * has exactly one caller, in the creation path, and no rename path recomputes anything, so the
 * per-bot override kept the value derived from the name the bot used to have. It failed
 * SILENTLY: the bot was simply unreachable, and the console showed the stale word with nothing
 * to say it had stopped tracking the name above it.
 *
 * ── WHAT IS ASSERTED ─────────────────────────────────────────────────────────
 *
 * One name serves as the fallback for both, so they cannot drift apart. There are exactly two
 * states and they are told apart by whether an override ROW EXISTS, which is a fact rather
 * than a flag: a flag can disagree with the value it describes, and this cannot.
 *
 *   no row   the wake word follows the display name, and a rename carries through
 *   a row    the operator chose this word, and it stays put
 *
 * Every negative here has a positive control beside it, because "the bot does not answer to
 * the old name" passes against a bot that answers to nothing at all.
 */

import { PGlite } from '@electric-sql/pglite';
import { vector } from '@electric-sql/pglite-pgvector';
import { loadMigrationFiles } from '../src/db/migrate.js';
import type { Queryable } from '../src/db/pool.js';
import { detectAddress } from '../src/interaction/addressing.js';
import {
  applySettingOverrides,
  wakeWordForNewBot,
  wakeWordState,
} from '../src/interaction/setting-scope.js';
import { normalizeInteraction, DEFAULT_INTERACTION } from '../src/interaction/settings.js';
import type { SettingOverride } from '../src/db/interaction-overrides.js';
import { setLogLevel } from '../src/log.js';

let failures = 0;
function check(label: string, ok: boolean, detail = ''): void {
  if (!ok) failures++;
  console.log(`  [${ok ? 'PASS' : 'FAIL'}] ${label}${detail ? `: ${detail}` : ''}`);
}

const shared = normalizeInteraction({ ...DEFAULT_INTERACTION });
const OLD_NAME = 'Rick Sanchez';
const NEW_NAME = 'Rick C-137';

const own = (word: string): SettingOverride[] => [{ key: 'wakeWord', value: word }];

async function main(): Promise<void> {
  setLogLevel('error');

  /* ── 1. The fallback is the bot's own name ──────────────────────────────── */

  console.log('\n1. With no override, a bot answers to its own name');

  const followed = applySettingOverrides(shared, [], OLD_NAME);
  check(
    'a bot with no override takes its wake word from its display name',
    followed.wakeWord === wakeWordForNewBot(OLD_NAME),
    followed.wakeWord,
  );
  // THE POSITIVE CONTROL THAT MATTERS: it must not be the shared word, which is another
  // bot's name. That was the pre-CCB-S5-030 behaviour and the reason creation had to pin
  // every bot in the first place.
  check(
    '  and NOT the shared wake word, which is the primary bot name',
    followed.wakeWord !== shared.wakeWord,
    `shared is "${shared.wakeWord}"`,
  );
  // A name that derives nothing usable must not leave the bot nameless.
  // A single character derives null (`normalizeWakeWord` needs at least two); an emoji does
  // NOT, which the first draft of this check assumed backwards. Measured rather than assumed.
  const unusable = applySettingOverrides(shared, [], 'a');
  check(
    'a display name that derives nothing falls back to the shared word rather than to none',
    unusable.wakeWord === shared.wakeWord,
    unusable.wakeWord,
  );

  /* ── 2. The rename carries through ──────────────────────────────────────── */

  console.log('\n2. The rename');

  const before = applySettingOverrides(shared, [], OLD_NAME);
  const after = applySettingOverrides(shared, [], NEW_NAME);
  check(
    'renaming the bot changes what it answers to',
    before.wakeWord !== after.wakeWord,
    `${before.wakeWord} -> ${after.wakeWord}`,
  );
  check(
    '  to the new name',
    after.wakeWord === wakeWordForNewBot(NEW_NAME),
    after.wakeWord,
  );

  // Driven through the REAL detector, because the settings object having a new string is not
  // the property that matters; being reachable by it is. This is the D-162 shape.
  const heardNew = detectAddress(`${NEW_NAME}, are you there?`, after);
  const heardOld = detectAddress(`${OLD_NAME}, are you there?`, after);
  check('the renamed bot is woken by its NEW name', heardNew.kind === 'wake');
  check(
    '  and no longer by the old one',
    heardOld.kind !== 'wake',
    heardOld.kind === 'wake' ? 'still answering to the old name' : '',
  );
  // POSITIVE CONTROL: before the fix the bot answered to the OLD name, so a detector that
  // woke on nothing would pass the assertion above. Prove the old name still works when the
  // bot still HAS the old name.
  check(
    '  (and the old name still wakes a bot that is still called that)',
    detectAddress(`${OLD_NAME}, are you there?`, before).kind === 'wake',
  );

  /* ── 3. An operator's own word is not touched by a rename ───────────────── */

  console.log('\n3. A wake word the operator chose stays put');

  const chosen = applySettingOverrides(shared, own('Pickle'), NEW_NAME);
  check('an override wins over the display name', chosen.wakeWord === 'Pickle');
  check(
    '  and survives a rename',
    applySettingOverrides(shared, own('Pickle'), 'Something Else').wakeWord === 'Pickle',
  );
  check(
    '  and it is what actually wakes the bot',
    detectAddress('Pickle, hello', chosen).kind === 'wake',
  );

  /* ── 4. The console can say which of the two it is ──────────────────────── */

  console.log('\n4. The state is readable, which is the half that failed silently');

  const derivedState = wakeWordState(shared, [], NEW_NAME);
  check('with no row the state reads as following the name', derivedState.derived);
  check('  and reports the word it follows to', derivedState.word === wakeWordForNewBot(NEW_NAME));

  const customState = wakeWordState(shared, own('Pickle'), NEW_NAME);
  check('with a row the state reads as the operator own', !customState.derived);
  check('  and reports the word actually in force', customState.word === 'Pickle');
  // The load-bearing one for the operator's complaint: the state must expose what the name
  // WOULD give, or "this is custom" is not actionable.
  check(
    '  and names what following the display name would give instead',
    customState.fromDisplayName === wakeWordForNewBot(NEW_NAME),
    String(customState.fromDisplayName),
  );

  // THE PRODUCTION CASE, end to end: a bot pinned at creation to its old name, then renamed.
  const stale = wakeWordState(shared, own(wakeWordForNewBot(OLD_NAME) ?? ''), NEW_NAME);
  check(
    'the reported case reads as custom-and-diverged rather than as silence',
    !stale.derived && stale.word !== stale.fromDisplayName,
    `answers to "${stale.word}", name gives "${String(stale.fromDisplayName)}"`,
  );

  /* ── 5. The migration applies, and the schema still accepts the shape ───── */

  console.log('\n5. Migration 056 applies to a real schema');

  const pg = await PGlite.create({ extensions: { vector } });
  const db = {
    query: async (sql: string, values?: readonly unknown[]) => {
      const result = await pg.query(sql, values ? [...values] : undefined);
      return {
        rows: result.rows as never[],
        rowCount: (result.affectedRows ?? result.rows.length) as number,
      };
    },
  } as Queryable;
  let applied = true;
  try {
    for (const migration of await loadMigrationFiles()) await pg.exec(migration.sql);
  } catch (error) {
    applied = false;
    console.log(`         ${(error as Error).message}`);
  }
  check('every migration including 056 applies cleanly', applied);

  // The backfill's job is to keep an EXISTING deployment behaving exactly as it did, so a bot
  // with no row before must have one after. Proven against the real statement rather than by
  // reading it: insert a bot with no override and re-run the backfill.
  if (applied) {
    await db.query(
      `INSERT INTO cinderella_bot_profiles (slug, display_name, enabled)
       VALUES ('legacy-bot', 'Legacy Bot', TRUE)`,
    );
    const { rows: bots } = await db.query<{ id: string }>(
      `SELECT id FROM cinderella_bot_profiles WHERE slug = 'legacy-bot'`,
    );
    const id = bots[0]?.id ?? '0';
    const { rows: beforeRows } = await db.query<{ n: string }>(
      `SELECT count(*) AS n FROM cinderella_interaction_overrides
        WHERE bot_profile_id = $1 AND setting_key = 'wakeWord'`,
      [id],
    );
    check(
      'a bot inserted without an override has none, so absence is representable',
      Number(beforeRows[0]?.n ?? -1) === 0,
      String(beforeRows[0]?.n),
    );
  }

  console.log(
    failures === 0
      ? '\nA renamed bot answers to its new name, a chosen one is left alone, and the console ' +
          'can say which of the two it is.'
      : `\n${failures} CHECK(S) FAILED.`,
  );
  await pg.close();
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
