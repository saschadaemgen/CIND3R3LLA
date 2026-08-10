/**
 * Two bots, two names, through the real detector (CCB-S5-006, D-158).
 *
 * ── WHY THIS IS SEPARATE FROM `verify:interaction-scope` ─────────────────────
 *
 * That check proves the SPLIT: the inventory is complete, the database and the code agree,
 * a shared setting is refused per bot. It stops at the settings objects.
 *
 * This one drives `detectAddress`, which is the function that actually decides whether a
 * bot was spoken to. The defect was never "the settings object has one wakeWord"; it was
 * "both bots wake on the same word", and only the detector can answer that. The briefing
 * asks for it by name: confirm it reads the right bot's, and that two bots in one group do
 * not both wake on a message naming one of them.
 *
 * That last case is real rather than hypothetical: CCB-S5-001 reports two bots in one group
 * loudly rather than refusing it, so a deployment can be in exactly this state.
 *
 * No model and no core. `detectAddress` is pure and takes a settings object, so this is
 * decidable end to end.
 *
 *   npx tsx scripts/verify-two-names.ts
 */

import { PGlite } from '@electric-sql/pglite';
import { loadMigrationFiles } from '../src/db/migrate.js';
import type { Queryable } from '../src/db/pool.js';
import { detectAddress } from '../src/interaction/addressing.js';
import { applySettingOverrides } from '../src/interaction/setting-scope.js';
import {
  listSettingOverridesForBot,
  setSettingOverride,
} from '../src/db/interaction-overrides.js';
import { normalizeInteraction, type InteractionSettings } from '../src/interaction/settings.js';
import { setLogLevel } from '../src/log.js';

let failures = 0;
function check(label: string, ok: boolean, detail = ''): void {
  if (!ok) failures++;
  console.log(`  [${ok ? 'PASS' : 'FAIL'}] ${label}${detail ? `: ${detail}` : ''}`);
}

/**
 * Whether this settings object treats the message as addressed to its bot.
 *
 * `detectAddress` returns a `kind`, not a boolean, and an earlier draft of this check read
 * a `.addressed` field that does not exist: undefined is falsy, so the detector appeared to
 * wake nobody and four checks "passed" because nothing ever woke. The positive controls
 * caught it, which is what they are for. D-111's rule applies: look at what the code
 * actually returns before concluding the code is wrong.
 */
function wakes(s: InteractionSettings, text: string): boolean {
  return detectAddress(text, s).kind !== 'none';
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

  const { rows } = await db.query<{ id: string; slug: string }>(
    `INSERT INTO cinderella_bot_profiles (slug, display_name, enabled)
     VALUES ('cinderella','CIND3R3LLA',TRUE), ('aurora','Aurora',TRUE)
     RETURNING id, slug`,
  );
  const ids = new Map(rows.map((r) => [r.slug, Number(r.id)]));
  const cinderellaId = ids.get('cinderella') ?? 0;
  const auroraId = ids.get('aurora') ?? 0;

  // The shared record. Its wake word is what the deployment answered to before this
  // briefing, and it is what the FIRST bot keeps inheriting.
  const shared = normalizeInteraction({ wakeWord: 'Cinderella', nicknames: { enabled: true, words: ['Cindy', 'Ella'], spamLimit: 3 } });

  await setSettingOverride(db, auroraId, 'wakeWord', 'Aurora');
  await setSettingOverride(db, auroraId, 'nicknames.words', ['Rory']);
  await setSettingOverride(db, auroraId, 'retorts', {});

  const cinderella = applySettingOverrides(shared, await listSettingOverridesForBot(db, cinderellaId));
  const aurora = applySettingOverrides(shared, await listSettingOverridesForBot(db, auroraId));

  /* ── 1. Each answers to its own name ────────────────────────────────────── */

  console.log('\n1. Each bot answers to its own name and not the other one');
  console.log(`   Cinderella wakes on "${cinderella.wakeWord}", Aurora on "${aurora.wakeWord}"\n`);
  {
    check(
      'the two bots resolve to different wake words',
      cinderella.wakeWord !== aurora.wakeWord,
      `"${cinderella.wakeWord}" and "${aurora.wakeWord}"`,
    );

    const toCinderella = 'Cinderella, what do you keep of mine?';
    const toAurora = 'Aurora, what do you keep of mine?';

    check(
      'a message naming Cinderella wakes Cinderella',
      wakes(cinderella, toCinderella),
      toCinderella,
    );
    check(
      'and does NOT wake Aurora, which is the whole defect',
      !wakes(aurora, toCinderella),
      'before this briefing both bots woke on this one message',
    );
    check('a message naming Aurora wakes Aurora', wakes(aurora, toAurora), toAurora);
    check('and does NOT wake Cinderella', !wakes(cinderella, toAurora));

    // POSITIVE CONTROL. Every check above passes against a detector that never wakes at
    // all, so one message must wake each bot for the negatives to mean anything.
    check(
      'CONTROL: the detector does wake somebody, so the negatives above are not vacuous',
      wakes(cinderella, toCinderella) && wakes(aurora, toAurora),
    );

    // MUTATION: put Aurora back on the shared wake word and the defect returns.
    const auroraShared = applySettingOverrides(shared, []);
    check(
      'MUTATION: with no per-bot wake word, BOTH wake on one name again',
      wakes(auroraShared, toCinderella) && wakes(cinderella, toCinderella),
      'this is the state the deployment was in before this briefing',
    );
  }

  /* ── 2. Nicknames and retorts follow the name ───────────────────────────── */

  console.log('\n2. A bot refuses its own pet names, in its own voice or none');
  {
    check(
      'each bot has its own nickname list',
      JSON.stringify(cinderella.nicknames.words) !== JSON.stringify(aurora.nicknames.words),
      `${cinderella.nicknames.words.join('/')} against ${aurora.nicknames.words.join('/')}`,
    );
    check(
      'a pet form of HER name wakes her',
      wakes(cinderella, 'Cindy, are you there?'),
    );
    check(
      'and does not wake the other bot, which was never called that',
      !wakes(aurora, 'Cindy, are you there?'),
    );
    check(
      'the other bot has its own pet form',
      wakes(aurora, 'Rory, are you there?'),
    );

    // "None" is a real state. A bot with no retorts says nothing rather than borrowing hers.
    check(
      'a bot can have NO retorts at all',
      Object.keys(aurora.retorts).length === 0,
    );
    check(
      'CONTROL: the other bot still has hers, so the emptiness is that bot and not the fixture',
      Object.keys(cinderella.retorts).length > 0,
      `${Object.keys(cinderella.retorts).length} language(s)`,
    );
    check(
      "MUTATION: inheriting would have given it HER retorts, about HER name",
      Object.keys(applySettingOverrides(shared, []).retorts).length > 0,
      'which is what a bot with no override of its own would have got',
    );
  }

  /* ── 3. Two bots in ONE group ───────────────────────────────────────────── */

  console.log('\n3. Two bots in one group: only the one named answers');
  {
    // CCB-S5-001 reports this arrangement loudly rather than refusing it, so it can exist.
    // Both bots see the same message; exactly one may wake.
    const messages = [
      'Cinderella, publish me',
      'Aurora, publish me',
      'hey Cinderella can you help',
      'so Aurora what do you think',
    ];
    let bothWoke = 0;
    let neitherWoke = 0;
    for (const m of messages) {
      const c = wakes(cinderella, m);
      const a = wakes(aurora, m);
      if (c && a) bothWoke++;
      if (!c && !a) neitherWoke++;
      console.log(`   "${m}" -> Cinderella ${c ? 'wakes' : 'quiet'}, Aurora ${a ? 'wakes' : 'quiet'}`);
    }
    check(
      'no message naming one bot wakes both',
      bothWoke === 0,
      `${String(bothWoke)} of ${String(messages.length)} woke both`,
    );
    check(
      'and every message woke exactly one, so the guard is not simply silence',
      neitherWoke === 0,
      `${String(neitherWoke)} woke neither`,
    );
  }

  /* ── 4. The shared settings still reach both ────────────────────────────── */

  console.log('\n4. A shared setting changed once reaches both bots');
  {
    // `greetings` is shared, so a change to the shared record must be visible to both
    // without either being touched. This is the other half of the mechanism: deviating on
    // one key must not fork the whole record.
    const withGreeting = normalizeInteraction({
      wakeWord: 'Cinderella',
      greetings: ['yo'],
      nicknames: { enabled: true, words: ['Cindy', 'Ella'], spamLimit: 3 },
    });
    const c2 = applySettingOverrides(withGreeting, await listSettingOverridesForBot(db, cinderellaId));
    const a2 = applySettingOverrides(withGreeting, await listSettingOverridesForBot(db, auroraId));

    check(
      'both bots see the shared greeting change',
      c2.greetings.includes('yo') && a2.greetings.includes('yo'),
    );
    check(
      'while each keeps its own name',
      c2.wakeWord === 'Cinderella' && a2.wakeWord === 'Aurora',
      `"${c2.wakeWord}" and "${a2.wakeWord}"`,
    );
    check(
      'and the new greeting works in front of EACH name',
      wakes(c2, 'yo Cinderella you about') && wakes(a2, 'yo Aurora you about'),
      'one shared edit, both bots, neither name disturbed',
    );
  }

  console.log(
    failures === 0
      ? '\nTwo bots, two names. Each answers only to its own, and one shared edit still reaches both.'
      : `\n${failures} CHECK(S) FAILED.`,
  );
  await pg.close();
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
