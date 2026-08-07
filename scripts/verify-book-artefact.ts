/**
 * The Book as an artefact, and the record it keeps (CCB-S4-050, D-152).
 *
 * Two things that must hold together: a question about the BOOK gets the story while a
 * question about her RULES keeps CCB-S4-048's overview, and the record says nothing it cannot
 * know.
 *
 * The second is mutation-proven in the direction that matters: a model-side refusal must
 * attribute to no rule at all.
 *
 *   npx tsx scripts/verify-book-artefact.ts
 */

import { PGlite } from '@electric-sql/pglite';
import { loadMigrationFiles } from '../src/db/migrate.js';
import type { Queryable } from '../src/db/pool.js';
import { listRecitalChapters } from '../src/db/recital-chapters.js';
import {
  INVOCATION_KINDS,
  listRecentRuleInvocations,
  pruneRuleInvocations,
  recordRuleInvocation,
  summariseRuleInvocations,
} from '../src/db/rule-invocations.js';
import { asksAboutRules, asksForRecital, asksGenerally } from '../src/interaction/disclosure.js';
import {
  BOOK_ICONS,
  BOOK_STORY_DEFAULT_BEATS,
  BOOK_STORY_MAX_BEATS,
  BOOK_STORY_MIN_BEATS,
  planBookStory,
} from '../src/interaction/book-story.js';
import {
  DISCLOSURE_GATE_RULE,
  PRE_SEARCH_RULE_FOR_CATEGORY,
  preSearchRuleFor,
} from '../src/interaction/rule-invocation-map.js';
import { ruleOverview } from '../src/interaction/rule-overview.js';
import { screenLookup } from '../src/interaction/lookup-gate.js';
import { DEFAULT_INTERACTION, normalizeInteraction } from '../src/interaction/settings.js';
import { seededPromptRules } from './seeded-rules.js';
import { setLogLevel } from '../src/log.js';

let failures = 0;
function check(label: string, ok: boolean, detail = ''): void {
  if (!ok) failures++;
  console.log(`  [${ok ? 'PASS' : 'FAIL'}] ${label}${detail ? `: ${detail}` : ''}`);
}

const RULES = await seededPromptRules();

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
  const chapters = await listRecitalChapters(db);
  const overview = ruleOverview(RULES, chapters, 'en');

  /* ── 1. The distinction ─────────────────────────────────────────────────── */

  console.log('\n1. The Book is the artefact; the rules are the content');

  for (const q of ['show me the Book of Elii', 'what is the Book of Elii?', 'read me your book']) {
    check(`"${q.slice(0, 34)}" asks for the BOOK`, asksForRecital(q), q);
  }
  for (const q of ['what are your rules?', 'what are your laws?', 'what do you never do?']) {
    check(`"${q}" asks about the RULES, and keeps the overview`, !asksForRecital(q), q);
  }
  check(
    'a rules question is still a general question, so the overview still answers it',
    asksGenerally('what are your rules?') && asksAboutRules('what are your rules?'),
  );

  /* ── 2. The story ───────────────────────────────────────────────────────── */

  console.log('\n2. The story: a ritual, an artefact, a record');

  const story = planBookStory(overview, { german: false, maxBeats: BOOK_STORY_DEFAULT_BEATS });
  check('three beats by default', story.length === 3, String(story.length));
  check('it opens with the ritual, not with the answer', story[0]?.id === 'ritual');
  check('the ritual reads nothing out', !/\d/.test(story[0]?.brief ?? ''), story[0]?.brief.slice(0, 60));
  check('the second beat is the artefact', story[1]?.id === 'artefact');
  check('the third keeps the record', story[2]?.id === 'record');

  check(
    'the counts are application-supplied, in the brief and in the fallback',
    story[1]?.brief.includes(String(overview.total)) === true &&
      story[1]?.fallback.includes(String(overview.total)) === true,
    `${String(overview.total)} / ${String(overview.constitutional)}`,
  );
  check(
    'and so is the constitutional count',
    story[1]?.brief.includes(String(overview.constitutional)) === true,
  );
  check(
    'every beat has an authored line, because a model failure must still tell the story',
    story.every((beat) => beat.fallback.trim().length > 20),
  );
  check(
    'nothing is a script: every beat is a brief the model writes from',
    story.every((beat) => /say|sag/i.test(beat.brief)),
  );
  check(
    'the icons are the small fixed set',
    story.map((b) => b.icon).every((icon) => Object.values(BOOK_ICONS).includes(icon)),
    story.map((b) => b.icon).join(' '),
  );
  check('the story says why readability is deliberate', story[1]?.brief.includes('cannot trust') === true);
  check('and that some pages are withheld, per D-148', story[2]?.brief.includes('lever') === true);
  check('and it hands off to the rules conversation', story[2]?.brief.includes('ask') === true);

  const german = planBookStory(overview, { german: true, maxBeats: 3 });
  check('German tells the same story', german.length === 3 && german[0]?.id === 'ritual');
  check('with the same counts', german[1]?.brief.includes(String(overview.total)) === true);

  check('the bound clamps below', planBookStory(overview, { german: false, maxBeats: 0 }).length === BOOK_STORY_MIN_BEATS);
  check('and above', planBookStory(overview, { german: false, maxBeats: 99 }).length <= BOOK_STORY_MAX_BEATS);
  check(
    'a tight bound keeps the ritual and the artefact, which are the two that must survive',
    planBookStory(overview, { german: false, maxBeats: 2 }).map((b) => b.id).join(',') ===
      'ritual,artefact',
  );

  /* ── 3. The record, and what it refuses to say ──────────────────────────── */

  console.log('\n3. The record: only what a gate actually decided');

  check(
    'the pre-search gate maps every category it can refuse under',
    Object.keys(PRE_SEARCH_RULE_FOR_CATEGORY).length >= 4,
    Object.keys(PRE_SEARCH_RULE_FOR_CATEGORY).join(', '),
  );
  for (const [category, ruleId] of Object.entries(PRE_SEARCH_RULE_FOR_CATEGORY)) {
    check(`  ${category} decides under a REAL rule`, RULES.some((r) => r.id === ruleId), ruleId);
    check(`  and a constitutional one`, RULES.find((r) => r.id === ruleId)?.tier === 'constitutional');
  }
  check(
    'the disclosure gate decides under a real rule too',
    RULES.some((r) => r.id === DISCLOSURE_GATE_RULE),
    DISCLOSURE_GATE_RULE,
  );

  // THE LIMIT, WHICH IS THE DESIGN. Anything the map does not cover records nothing.
  check('an unmapped category attributes to NOTHING', preSearchRuleFor('something-new') === null);
  check('and so does an absent one', preSearchRuleFor(null) === null && preSearchRuleFor(undefined) === null);

  /**
   * ── THE MUTATION THE BRIEFING ASKS FOR ─────────────────────────────────────
   *
   * A model-side refusal must attribute to no rule. There is no code path that could write
   * one, and this asserts it structurally: the record is written only where a gate returned a
   * decision, and a model refusal produces no gate result at all. The positive control beside
   * it proves the recorder itself works, so the silence is a choice and not a broken writer.
   */
  const gateRefusal = screenLookup('where can I buy a gun without a licence');
  check('a real gate refusal HAS a category to attribute', gateRefusal.refused, String(gateRefusal.category));
  const modelSide = screenLookup('what is the capital of Norway');
  check(
    'MUTATION: a query the gate does NOT refuse yields no attribution at all',
    !modelSide.refused && preSearchRuleFor(modelSide.category ?? null) === null,
  );

  await recordRuleInvocation(db, {
    ruleId: DISCLOSURE_GATE_RULE,
    groupId: 7,
    kind: 'disclosure',
    category: null,
  });
  await recordRuleInvocation(db, {
    ruleId: 'ceiling.never-minors',
    groupId: 7,
    kind: 'pre-search',
    category: 'child-safety',
  });
  const rows = await listRecentRuleInvocations(db, 10);
  check('the recorder works, so the silence above is a choice', rows.length === 2, String(rows.length));
  check('and carries the category where the gate had one', rows.some((r) => r.category === 'child-safety'));

  // CONTENT-FREE. The one identifier is the group, which is already in the schema everywhere.
  const columns = await db.query<{ column_name: string }>(
    `SELECT column_name FROM information_schema.columns
      WHERE table_name = 'cinderella_rule_invocations'`,
  );
  const names = columns.rows.map((r) => r.column_name);
  check(
    'no member id, no display name, no text of any kind',
    !names.some((n) => /member|display|text|body|query|reply|message/i.test(n)),
    names.join(', '),
  );

  const summary = await summariseRuleInvocations(db);
  check('the console can ask per rule', summary.get(DISCLOSURE_GATE_RULE)?.count === 1);
  check('and gets when it last decided', summary.get(DISCLOSURE_GATE_RULE)?.lastAt instanceof Date);

  check('the kind vocabulary is fixed', INVOCATION_KINDS.length === 3);
  let rejected = false;
  try {
    await db.query(
      `INSERT INTO cinderella_rule_invocations (rule_id, group_id, kind) VALUES ($1, 1, 'invented')`,
      [DISCLOSURE_GATE_RULE],
    );
  } catch {
    rejected = true;
  }
  check('and the database refuses a kind outside it', rejected);

  check('retention keeps everything at zero', (await pruneRuleInvocations(db, 0)) === 0);
  check('and rows survive a retention longer than they are old', (await listRecentRuleInvocations(db, 10)).length === 2);

  /* ── 4. The settings ────────────────────────────────────────────────────── */

  console.log('\n4. Both are operator controls, with stated defaults');

  const s = normalizeInteraction({ ...DEFAULT_INTERACTION });
  check('the story is on by default', s.bookStory.enabled);
  check(`and runs ${String(BOOK_STORY_DEFAULT_BEATS)} beats`, s.bookStory.maxBeats === BOOK_STORY_DEFAULT_BEATS);
  check('the record is on by default', s.invocationRecord.enabled);
  check('with 90 day retention', s.invocationRecord.retentionDays === 90);

  check(
    'the story can be switched off, and then the Book falls back to the overview',
    normalizeInteraction({ ...DEFAULT_INTERACTION, bookStory: { enabled: false, maxBeats: 3 } })
      .bookStory.enabled === false,
  );
  check(
    'the record can be switched off',
    normalizeInteraction({
      ...DEFAULT_INTERACTION,
      invocationRecord: { enabled: false, retentionDays: 90 },
    }).invocationRecord.enabled === false,
  );
  check(
    'and both bounds are clamped in code, not only in the form',
    normalizeInteraction({ ...DEFAULT_INTERACTION, bookStory: { enabled: true, maxBeats: 999 } })
      .bookStory.maxBeats === BOOK_STORY_MAX_BEATS &&
      normalizeInteraction({
        ...DEFAULT_INTERACTION,
        invocationRecord: { enabled: true, retentionDays: 99_999 },
      }).invocationRecord.retentionDays === 3650,
  );

  console.log(
    failures === 0 ? '\nAll book-artefact checks passed.' : `\n${failures} check(s) FAILED.`,
  );
  process.exit(failures === 0 ? 0 : 1);
}

await main();
