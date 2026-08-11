/**
 * What an archive search reaches, and what it counts (CCB-S5-027, D-181).
 *
 * ── THREE DEFECTS FROM ONE PRODUCTION SESSION, ALL ABOUT ONE ANSWER ──────────
 *
 * WHERE IT ROUTED. *"In which session was the switch from mbedTLS to OpenSSL decided?"* is a
 * false-premise question with no archive phrase in it, put to her as a deliberate
 * hallucination trap. It reached the archive, which answered it with a full-text count, so
 * the trap tested nothing and the knowledge base was never consulted. CCB-S5-026 had made
 * the archive explicit-only in the rule engine and told the MODEL about it in a prompt
 * sentence; a prompt sentence is an instruction, and this one was not followed.
 *
 * WHAT IT SAID. *"I found 2 moments where this group spoke of the switch from mbedTLS to
 * OpenSSL"* asserts that the switch happened and that the group discussed it. Two term
 * matches is not a memory.
 *
 * WHAT IT COUNTED. Two hosted bots answered one `/search` with 8 and 9. The difference was
 * the member's own search request, which is persisted before the interaction layer runs and
 * publishes on consent alone until its category is written, which happens after the reply.
 *
 * ── THE POSITIVE CONTROLS ARE THE LOAD-BEARING HALF ──────────────────────────
 *
 * A gate that refused every SEARCH passes every routing assertion here. A count that
 * excluded everything passes every corpus assertion. So each exclusion is asserted beside a
 * row that must still be counted, and each refusal beside a phrasing that must still work.
 *
 *   npx tsx scripts/verify-archive-search.ts
 */

import { PGlite } from '@electric-sql/pglite';
import { vector } from '@electric-sql/pglite-pgvector';
import type { Queryable } from '../src/db/pool.js';
import { loadMigrationFiles } from '../src/db/migrate.js';
import { upsertMessage, setMemberCategory } from '../src/db/messages.js';
import { insertBotMessage } from '../src/db/bot-messages.js';
import { recordOptIn } from '../src/db/consent.js';
import { countPublishedMatching } from '../src/db/public-archive.js';
import { namesTheArchive, ruleResolver } from '../src/interaction/rules.js';
import {
  resetIntentResolver,
  resolveIntent,
  setIntentResolver,
} from '../src/interaction/resolver.js';
import { INTENTS, type IntentContext, type IntentResult } from '../src/interaction/intent.js';
import { DEFAULT_INTERACTION, fillPersona, normalizeInteraction } from '../src/interaction/settings.js';
import { setLogLevel } from '../src/log.js';

let failures = 0;
function check(label: string, ok: boolean, detail = ''): void {
  if (!ok) failures++;
  console.log(`  [${ok ? 'PASS' : 'FAIL'}] ${label}${detail ? `: ${detail}` : ''}`);
}

const GROUP = 1;
const OTHER_GROUP = 2;
const ALICE = 'alice-member-id';
const BOB = 'bob-member-id';

/** The question the operator asked, verbatim, and its German twin. */
const TRAP = 'In which session was the switch from mbedTLS to OpenSSL decided?';
const TRAP_DE = 'In welcher Session wurde der Wechsel von mbedTLS zu OpenSSL beschlossen?';

const ctx: IntentContext = { threshold: 0.6, defaultLanguage: 'en', intents: [...INTENTS] };

async function main(): Promise<void> {
  setLogLevel('error');

  /* ── 1. Naming the place, decided without a model ────────────────────────── */

  console.log('\n1. The archive is explicit-only, whoever is at the door');

  check(
    'the rule engine returns UNKNOWN for the trap, which is why the model is the only suspect',
    (await ruleResolver.resolve(TRAP, ctx)).intent === 'UNKNOWN',
    (await ruleResolver.resolve(TRAP, ctx)).intent,
  );
  check(
    '  in German too',
    (await ruleResolver.resolve(TRAP_DE, ctx)).intent === 'UNKNOWN',
  );

  check('namesTheArchive: the trap names nowhere', !namesTheArchive(TRAP));
  check('  nor does a bare search verb', !namesTheArchive('search for openssl'));
  check(
    '  nor does a knowledge-base question about a chat product',
    !namesTheArchive('how does the core handle group ids?'),
  );
  // POSITIVE CONTROLS. Without these, a predicate that always returned false would pass.
  check('but "search the archive for X" does', namesTheArchive('search the archive for openssl'));
  check('and so does "what did we say about X"', namesTheArchive('what did we say about openssl'));
  check('and the German forms', namesTheArchive('was haben wir über openssl gesagt'));

  /* ── 2. A model that claims it anyway is downgraded ──────────────────────── */

  console.log('\n2. The seam refuses a SEARCH the text does not support');

  const claimsSearch = (query: string): void => {
    setIntentResolver({
      name: 'fake:always-search',
      resolve: (): Promise<IntentResult> =>
        Promise.resolve({
          intent: 'SEARCH',
          confidence: 0.96,
          slots: { query },
          lang: 'en',
        }),
    });
  };

  claimsSearch('mbedTLS OpenSSL');
  const trapped = await resolveIntent(TRAP, ctx);
  check(
    'a resolver claiming SEARCH for the trap is downgraded to UNKNOWN',
    trapped.intent === 'UNKNOWN',
    trapped.intent,
  );
  check(
    '  so the question falls to conversation, which is where the knowledge base is consulted',
    trapped.slots.query === undefined,
  );

  // THE POSITIVE CONTROL, and the mutation in one: the SAME resolver, the same claim, a
  // message that names the archive. If this fails, the gate refuses everything and the
  // assertions above prove nothing.
  claimsSearch('openssl');
  const legitimate = await resolveIntent('search the archive for openssl', ctx);
  check(
    'the same resolver claiming SEARCH for a message that names the archive is honoured',
    legitimate.intent === 'SEARCH',
    legitimate.intent,
  );
  check('  with its query slot intact', legitimate.slots.query === 'openssl');
  resetIntentResolver();

  check(
    'and the rule engine itself is untouched by the gate',
    (await resolveIntent('what did we say about openssl', ctx)).intent === 'SEARCH',
  );

  /* ── 3. The sentence says what it matched ────────────────────────────────── */

  console.log('\n3. A count is a count');

  const persona = normalizeInteraction({ ...DEFAULT_INTERACTION }).persona;
  for (const lang of ['en', 'de']) {
    const template = (persona[lang] as Record<string, string>)['searchResult'] ?? '';
    const rendered = fillPersona(template, { n: 2, query: 'the switch from mbedTLS to OpenSSL' });
    check(
      `[${lang}] the answer states the count and the term it matched`,
      rendered.includes('2') && rendered.includes('mbedTLS'),
      rendered,
    );
    check(
      `[${lang}] and no longer says the group SPOKE of it`,
      !/spoke of|moments|sprach|Momente/.test(rendered),
    );
    check(
      `[${lang}] and says in her own words that a match is not a memory`,
      /not a memory|keine Erinnerung/.test(rendered),
    );
    check(
      `[${lang}] and makes no offer nothing keeps`,
      !/Shall I bring|Soll ich sie/.test(rendered),
    );
  }

  /* ── 4. What the count counts ────────────────────────────────────────────── */

  console.log('\n4. The corpus: this group, not her, not the question');

  const pg = new PGlite({ extensions: { vector } });
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

  const t0 = Date.parse('2026-08-11T10:00:00Z');
  const at = (minute: number): string => new Date(t0 + minute * 60_000).toISOString();
  await recordOptIn(db, ALICE, at(0));
  await recordOptIn(db, BOB, at(0));

  const member = async (
    id: number,
    text: string,
    opts: { group?: number; member?: string; category?: string } = {},
  ): Promise<void> => {
    const group = opts.group ?? GROUP;
    await upsertMessage(db, {
      groupId: group,
      groupMsgId: id,
      sharedMsgId: null,
      senderMemberId: opts.member ?? ALICE,
      senderDisplayName: 'Alice',
      sentAt: at(id),
      type: 'text',
      textBody: text,
      linksText: null,
      rawJson: {},
    });
    if (opts.category) await setMemberCategory(db, group, id, opts.category);
  };

  // Two ordinary member messages: the corpus a search is actually about.
  await member(1, 'openssl replaced the old stack last spring');
  await member(2, 'nobody liked openssl at first');
  // One of HERS, quoting the term back, which is how the count used to climb on its own.
  const hers = 'I count 5 public messages in this group matching *openssl*.';
  await insertBotMessage(db, {
    groupId: GROUP,
    groupMsgId: 3,
    sharedMsgId: null,
    senderMemberId: 'cinderella-member-id',
    senderDisplayName: 'CIND3R3LLA',
    sentAt: at(3),
    text: hers,
    searchBody: hers,
    category: 'search',
    lang: 'en',
    mentions: [],
    rawJson: {},
  });
  await pg.exec(
    `UPDATE settings SET value = '{"categories":{"search":true}}'::jsonb WHERE key = 'archive'`,
  );
  await pg.exec(
    `INSERT INTO settings (key, value) VALUES ('archive', '{"categories":{"search":true}}'::jsonb)
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
  );
  // A member's EARLIER search request, already categorised.
  await member(4, '/search openssl', { category: 'search', member: BOB });
  // The same words in a different group.
  await member(5, 'openssl everywhere over here too', { group: OTHER_GROUP, member: BOB });
  // The request being answered RIGHT NOW: persisted, category not yet written.
  await member(6, 'search the archive for openssl');

  const counted = await countPublishedMatching(db, 'openssl', {
    groupId: GROUP,
    excludeGroupMsgId: 6,
  });
  check(
    'the two ordinary member messages are counted, so the query is not simply empty',
    counted === 2,
    String(counted),
  );

  const raw = async (where: string): Promise<number> => {
    const { rows } = await db.query<{ n: string }>(
      `SELECT count(*) AS n FROM published_messages
       WHERE search @@ websearch_to_tsquery('simple', 'openssl') ${where}`,
    );
    return Number(rows[0]?.n ?? 0);
  };

  // MUTATION, one exclusion at a time, so each is shown to be doing work rather than being
  // carried by the others.
  check(
    'MUTATION: without the group filter a different group leaks in',
    (await raw(`AND group_msg_id <> 6 AND is_bot = FALSE
                AND (member_category IS NULL OR member_category <> 'search')`)) === 3,
    String(
      await raw(`AND group_msg_id <> 6 AND is_bot = FALSE
                 AND (member_category IS NULL OR member_category <> 'search')`),
    ),
  );
  check(
    'MUTATION: without the bot filter her own answer counts itself',
    (await raw(`AND group_id = 1 AND group_msg_id <> 6
                AND (member_category IS NULL OR member_category <> 'search')`)) === 3,
  );
  check(
    'MUTATION: without the category filter an earlier search request counts',
    (await raw(`AND group_id = 1 AND group_msg_id <> 6 AND is_bot = FALSE`)) === 3,
  );
  check(
    'MUTATION: without excluding the asking message the question is its own answer',
    (await raw(`AND group_id = 1 AND is_bot = FALSE
                AND (member_category IS NULL OR member_category <> 'search')`)) === 3,
  );
  check(
    'and with none of them, the number production would have printed',
    (await raw('')) === 6,
    String(await raw('')),
  );

  /* ── 5. Asking twice does not change the answer ──────────────────────────── */

  console.log('\n5. The loop is closed');

  // The real sequence: the capture handler persists the request, the engine answers it, and
  // `onInstruction` writes the category AFTERWARDS. That ordering is why the current request
  // is excluded by its id and every earlier one by its category, and both halves have to be
  // present for the loop to be closed rather than merely slowed down.
  await setMemberCategory(db, GROUP, 6, 'search');
  await member(7, 'search the archive for openssl');
  const again = await countPublishedMatching(db, 'openssl', {
    groupId: GROUP,
    excludeGroupMsgId: 7,
  });
  check(
    'the second identical search returns the same number as the first',
    again === counted,
    `${String(counted)} then ${String(again)}`,
  );

  console.log(
    failures === 0
      ? '\nThe archive answers only when it was named, counts only what members said here, ' +
          'and says what it matched.'
      : `\n${failures} CHECK(S) FAILED.`,
  );
  await pg.close();
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
