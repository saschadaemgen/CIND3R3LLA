/**
 * What reaches her from a lookup, and what she may say about it (CCB-S5-028, D-183).
 *
 * ── THE PRODUCTION FAILURE THIS GUARDS ───────────────────────────────────────
 *
 * The operator asked *"One SimpleGo protocol says SUB after NEW is required, another says it
 * is a noop. Which is correct for SimpleGo, and where did the clarification come from?"* Two
 * university pages about amending human-subjects research protocols came back, because the
 * word "protocol" matched. She stated a technical position, invented a provenance for it,
 * called his documentation outdated, pointed at his own repository, and the application
 * printed the two domains underneath.
 *
 * ── FOUR GUARANTEES, AND WHICH OF THEM ARE STRUCTURAL ────────────────────────
 *
 * 1. ROUTING. A question that does not ask her to go and look is not a web search, whichever
 *    resolver claims it. Deterministic.
 * 2. THE FLOOR. Results below it never reach the model. Deterministic.
 * 3. NO ATTRIBUTION WITHOUT RESULTS. With nothing above the floor there is no `webResults` in
 *    the request, so the schema has no `usedResults` field, so nothing can be declared and no
 *    line can be built. Structural, and this file proves it end to end.
 * 4. THE HONEST NOTHING. Application-written and deterministic: the model is not called at
 *    all, so there is nothing to argue into an answer it does not have.
 *
 * What is NOT structural is the surviving band: results that clear the floor and still do not
 * answer. That rests on a prompt rule and therefore on the model, and
 * `npm run verify:lookup-honesty-live` is where it is measured rather than asserted.
 *
 *   npx tsx scripts/verify-lookup-honesty.ts
 */

import { PGlite } from '@electric-sql/pglite';
import { vector } from '@electric-sql/pglite-pgvector';
import type { Queryable } from '../src/db/pool.js';
import { loadMigrationFiles } from '../src/db/migrate.js';
import { WebSearchService } from '../src/plugins/web-search/service.js';
import {
  WEB_SEARCH_DEFAULTS,
  normalizeWebSearchSettings,
  type WebSearchSettings,
} from '../src/plugins/web-search/settings.js';
import {
  SEARCH_RELEVANCE_FLOOR,
  applyRelevanceFloor,
} from '../src/plugins/web-search/relevance.js';
import type { SearchProvider, SearchResult } from '../src/plugins/web-search/providers/types.js';
import { asksToLookItUp, ruleResolver } from '../src/interaction/rules.js';
import {
  resetIntentResolver,
  resolveIntent,
  setIntentResolver,
} from '../src/interaction/resolver.js';
import { INTENTS, type IntentContext, type IntentResult } from '../src/interaction/intent.js';
import { InteractionEngine } from '../src/interaction/engine.js';
import { DEFAULT_INTERACTION, normalizeInteraction } from '../src/interaction/settings.js';
import { DEFAULT_PERSONALITY } from '../src/interaction/personality.js';
import { CORE_INTENTS } from '../src/interaction/intent.js';
import type { CapturedMessage } from '../src/capture/message.js';
import type { AiReplyRequest } from '../src/interaction/ollama-reply.js';
import { listPromptRules } from '../src/db/prompt-rules.js';
import { alwaysRelevant, brokenEmbedder, scoringEmbedder } from './relevance-stub.js';
import { setLogLevel } from '../src/log.js';

let failures = 0;
function check(label: string, ok: boolean, detail = ''): void {
  if (!ok) failures++;
  console.log(`  [${ok ? 'PASS' : 'FAIL'}] ${label}${detail ? `: ${detail}` : ''}`);
}

const GROUP = 1;
const ALICE = 'alice-member-id';

/** The operator's question, verbatim. */
const QUESTION =
  'One SimpleGo protocol says SUB after NEW is required, another says it is a noop. Which is correct for SimpleGo, and where did the clarification come from?';

/** The two pages behind the domains in the source line she actually printed. */
const IRRELEVANT: SearchResult[] = [
  {
    title: 'Protocol Amendments | Research Compliance Services | University of Oregon',
    snippet:
      'A protocol amendment is required whenever you wish to make changes to an approved human subjects research protocol.',
    url: 'https://research.uoregon.edu/protocol-amendments',
  },
  {
    title: 'Modifications (Amendments) | Human Research Protection Program',
    snippet:
      'All changes to an approved protocol must be submitted for IRB review and approval prior to implementation.',
    url: 'https://hrpp.research.virginia.edu/teams/modifications',
  },
];

const RELEVANT: SearchResult[] = [
  {
    title: 'SimpleX Messaging Protocol: NEW, SUB and SEND',
    snippet: 'After NEW the queue is already subscribed, so an immediate SUB is a no-op.',
    url: 'https://example.org/smp',
  },
];

function staticProvider(results: SearchResult[]): SearchProvider {
  return {
    name: 'static',
    label: 'Static',
    capabilities: { requiresKey: false, keyUrl: '', note: '' },
    isConfigured: () => true,
    search: () => Promise.resolve(results),
  };
}

const settingsOf = (over: Partial<WebSearchSettings> = {}): WebSearchSettings =>
  normalizeWebSearchSettings({ ...WEB_SEARCH_DEFAULTS, apiKey: 'k', ...over });

const ctx: IntentContext = { threshold: 0.6, defaultLanguage: 'en', intents: [...INTENTS] };

async function main(): Promise<void> {
  setLogLevel('error');

  /* ── 1. Routing: a question is not a request to go and look ──────────────── */

  console.log('\n1. The last lane without a deterministic bar');

  check(
    'the rule engine returns UNKNOWN for the production question, so the model was the claimant',
    (await ruleResolver.resolve(QUESTION, ctx)).intent === 'UNKNOWN',
  );
  check('asksToLookItUp: the production question does not ask her to go', !asksToLookItUp(QUESTION));
  check(
    '  nor does a question that merely mentions a document',
    !asksToLookItUp('which of the two protocol notes is right?'),
  );
  // POSITIVE CONTROLS. A predicate that always said no would pass everything above while
  // removing web search from the product.
  check('but "look up X" does', asksToLookItUp('look up the current SMP spec'));
  check('and "google it" does', asksToLookItUp('google the boiling point of mercury'));
  check('and the German forms', asksToLookItUp('schau mal nach was ein waermepumpentrockner ist'));

  setIntentResolver({
    name: 'fake:always-lookup',
    resolve: (): Promise<IntentResult> =>
      Promise.resolve({ intent: 'LOOKUP', confidence: 0.97, slots: { query: 'SimpleGo SUB NEW' }, lang: 'en' }),
  });
  const claimed = await resolveIntent(QUESTION, ctx);
  check(
    'a resolver claiming LOOKUP for it is downgraded, so the question stays in the building',
    claimed.intent === 'UNKNOWN',
    claimed.intent,
  );
  const honoured = await resolveIntent('look up the current SMP spec', ctx);
  check(
    '  while the SAME resolver claiming LOOKUP for a real request is honoured',
    honoured.intent === 'LOOKUP',
    honoured.intent,
  );
  resetIntentResolver();

  /* ── 2. The floor ────────────────────────────────────────────────────────── */

  console.log('\n2. Below the bar she is given nothing');

  const scoreOf = (marker: string, score: number) => (text: string) =>
    text.includes(marker) ? score : 0.1;

  // The REAL service, the real floor, driven with exact cosines.
  const belowFloor = new WebSearchService({
    settings: settingsOf,
    provider: staticProvider(IRRELEVANT),
    embed: scoringEmbedder(scoreOf('Protocol Amendments', 0.58)),
  });
  const rejected = await belowFloor.search(QUESTION, { groupId: GROUP, memberId: ALICE });
  check(
    'a result set that is about something else is refused, not handed over',
    rejected.kind === 'failed' && rejected.failure === 'nothing-relevant',
    rejected.kind === 'failed' ? rejected.failure : 'results',
  );
  check(
    '  and it is NOT reported as an empty internet, which would be a different fact',
    rejected.kind === 'failed' && rejected.failure !== 'no-results',
  );
  check(
    '  the scores are kept for the operator, and the best one is below the floor',
    rejected.kind === 'failed' &&
      rejected.scored !== undefined &&
      rejected.scored.every((s) => !s.kept),
  );
  check(
    'the floor is 0.70 and the two production results score below it',
    SEARCH_RELEVANCE_FLOOR === 0.7 && 0.5813 < SEARCH_RELEVANCE_FLOOR && 0.5538 < SEARCH_RELEVANCE_FLOOR,
  );
  check(
    "  which the knowledge base's floor of the time (0.55; 0.60 since D-226) would NOT have done",
    0.5813 > 0.55,
  );

  // THE POSITIVE CONTROL, and it is the load-bearing half: a floor that rejected everything
  // would pass every assertion above while removing the capability.
  const aboveFloor = new WebSearchService({
    settings: settingsOf,
    provider: staticProvider(RELEVANT),
    embed: scoringEmbedder(scoreOf('SimpleX Messaging Protocol', 0.82)),
  });
  const kept = await aboveFloor.search(QUESTION, { groupId: GROUP, memberId: ALICE });
  check(
    'a genuinely relevant result still gets through',
    kept.kind === 'results' && kept.results.length === 1,
    kept.kind === 'results' ? `${String(kept.results.length)} result(s)` : kept.failure,
  );

  // MIXED, which is what the floor is actually for: keep the one, drop the other.
  const mixed = new WebSearchService({
    settings: settingsOf,
    provider: staticProvider([...IRRELEVANT, ...RELEVANT]),
    embed: scoringEmbedder((t) => (t.includes('SimpleX Messaging Protocol') ? 0.82 : 0.58)),
  });
  const filtered = await mixed.search(QUESTION, { groupId: GROUP, memberId: ALICE });
  check(
    'in a mixed set only the relevant one survives',
    filtered.kind === 'results' &&
      filtered.results.length === 1 &&
      filtered.results[0]?.title.includes('SimpleX Messaging Protocol') === true,
    filtered.kind === 'results' ? filtered.results.map((r) => r.title).join(' | ') : filtered.failure,
  );

  // MUTATION 1, which the briefing asks for by name: a check that fails if irrelevant results
  // can reach the model. Removing the floor is what removing this guarantee looks like.
  const noFloor = applyRelevanceFloor(IRRELEVANT, [0.58, 0.55], 0);
  check(
    'MUTATION: with the floor at zero the irrelevant results reach the model again',
    noFloor.kept.length === 2 && !noFloor.emptyBecauseOfFloor,
  );
  check(
    '  and at the shipped floor they do not',
    applyRelevanceFloor(IRRELEVANT, [0.58, 0.55]).kept.length === 0,
  );

  /* ── 3. Unjudged fails CLOSED ────────────────────────────────────────────── */

  console.log('\n3. A result nobody could score is a result nobody can vouch for');

  const unjudged = new WebSearchService({
    settings: settingsOf,
    provider: staticProvider(RELEVANT),
    embed: brokenEmbedder(),
  });
  const broke = await unjudged.search(QUESTION, { groupId: GROUP, memberId: ALICE });
  check(
    'an embedder that cannot answer hands over nothing',
    broke.kind === 'failed' && broke.failure === 'unjudged',
    broke.kind === 'failed' ? broke.failure : 'results',
  );
  const noEmbedder = new WebSearchService({
    settings: settingsOf,
    provider: staticProvider(RELEVANT),
  });
  check(
    '  and so does a deployment with no embedder wired at all',
    (await noEmbedder.search(QUESTION, { groupId: GROUP, memberId: ALICE })).kind === 'failed',
  );
  check(
    '  which is a DIFFERENT fact from an empty internet, so she can say the right thing',
    broke.kind === 'failed' && broke.failure !== 'no-results' && broke.failure !== 'nothing-relevant',
  );

  /* ── 4. No results, no source line. End to end. ──────────────────────────── */

  console.log('\n4. A source line cannot appear on an answer that used nothing');

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
  const rules = await listPromptRules(db);

  const interaction = normalizeInteraction({ ...DEFAULT_INTERACTION });

  const drive = async (
    service: WebSearchService,
    reply: string,
    declare: readonly number[],
  ): Promise<{ sent: string[]; sawResults: number }> => {
    const sent: string[] = [];
    let sawResults = 0;
    const engine = new InteractionEngine({
      capabilities: () => [...CORE_INTENTS, 'LOOKUP'],
      db,
      settings: () => interaction,
      rules: () => rules,
      personality: () => ({ ...DEFAULT_PERSONALITY }),
      webSearch: () => service,
      personalize: (req: AiReplyRequest) => {
        if ((req.webResults?.length ?? 0) > 0) sawResults += 1;
        // A model that declares sources whatever it was given, which is the worst case the
        // attribution has to survive.
        req.onSourcesUsed?.(declare);
        return Promise.resolve(reply);
      },
      send: (_msg, text) => {
        sent.push(text);
        return Promise.resolve();
      },
    });
    await engine.handle({
      groupId: GROUP,
      groupName: 'archive',
      itemId: Math.floor(Math.random() * 1),
      sharedMsgId: undefined,
      senderMemberId: ALICE,
      senderDisplayName: 'Alice',
      sentAt: new Date().toISOString(),
      type: 'text',
      text: 'Cinderella look up whether SUB after NEW is required',
      linkPreview: undefined,
      file: undefined,
      forwarded: false,
      quotedFromBot: false,
      raw: {} as never,
    } as CapturedMessage);
    return { sent, sawResults };
  };

  const rejectedRun = await drive(
    new WebSearchService({
      settings: settingsOf,
      provider: staticProvider(IRRELEVANT),
      embed: scoringEmbedder(() => 0.58),
    }),
    'The answer is that SUB after NEW is a noop, established by analysing the logs.',
    [0, 1],
  );
  check(
    'with everything below the floor the model is never asked',
    rejectedRun.sawResults === 0,
    `${String(rejectedRun.sawResults)} call(s) with results`,
  );
  check(
    '  so no source line can be printed, even though the model declared [0, 1]',
    !rejectedRun.sent.some((t) => t.includes('From the web')),
    rejectedRun.sent.join(' || ').slice(0, 120),
  );
  check(
    '  and what she says is the application\'s own honest line',
    rejectedRun.sent.some((t) => t.includes('about something else entirely')),
    rejectedRun.sent.join(' || ').slice(0, 140),
  );
  check(
    '  which is NOT the "found nothing" line, because that is a different fact',
    !rejectedRun.sent.some((t) => t.includes('nothing worth repeating')),
  );

  // MUTATION 2, which the briefing asks for by name: a check that fails if a source line can
  // appear on an answer that used nothing. Here the model declares NOTHING and the results
  // did clear the floor, so the line must be absent for that reason instead.
  const declaredNothing = await drive(
    new WebSearchService({
      settings: settingsOf,
      provider: staticProvider(RELEVANT),
      embed: alwaysRelevant(),
    }),
    'I could not find an answer to that in what came back.',
    [],
  );
  check(
    'results above the floor DO reach the model, so this section is not vacuous',
    declaredNothing.sawResults === 1,
  );
  check(
    'MUTATION: a model that declares nothing gets no source line',
    !declaredNothing.sent.some((t) => t.includes('From the web')),
    declaredNothing.sent.join(' || ').slice(0, 120),
  );

  const declaredSomething = await drive(
    new WebSearchService({
      settings: settingsOf,
      provider: staticProvider(RELEVANT),
      embed: alwaysRelevant(),
    }),
    'After NEW the queue is already subscribed, so SUB is a no-op.',
    [0],
  );
  check(
    '  and a model that declares a result it was given DOES get one',
    declaredSomething.sent.some((t) => t.includes('From the web')),
    declaredSomething.sent.join(' || ').slice(0, 140),
  );

  /* ── 5. The rules that carry the rest ────────────────────────────────────── */

  console.log('\n5. What the registry now says, and when');

  const byId = new Map(rules.map((r) => [r.id, r]));
  const noAction = byId.get('task.conversation.no-action-claimed');
  check(
    'the "you looked nothing up" sentence no longer applies when she just looked something up',
    noAction?.appliesWhen === 'has-no-web-results',
    noAction?.appliesWhen ?? '(missing)',
  );
  const looked = byId.get('task.conversation.only-looked-here');
  check(
    '  and the lookup case is told the truth instead',
    looked?.appliesWhen === 'has-web-results' && looked.tier === 'constitutional',
  );
  for (const id of [
    'grounding.may-reason',
    'grounding.no-invented-provenance',
    'grounding.no-verdict-on-unseen',
  ]) {
    const rule = byId.get(id);
    check(`${id} is constitutional and critical`, rule?.tier === 'constitutional' && rule.critical === true);
  }
  const spine = byId.get('grounding.may-reason');
  const fence = byId.get('grounding.no-invented-provenance');
  check(
    'the SPINE is emitted before the fence, which D-156 made load-bearing',
    spine !== undefined && fence !== undefined && spine.ord < fence.ord,
    `${String(spine?.ord)} then ${String(fence?.ord)}`,
  );
  check(
    'the provenance fence names the moves she actually made, not a category of noun',
    /analysed behaviour|read logs|checked a repository/.test(fence?.text ?? ''),
  );
  check(
    'and rejecting a result is stated not to be using it',
    /irrelevant is not using it/.test(byId.get('web.fence.rejected-is-not-used')?.text ?? ''),
  );

  console.log(
    failures === 0
      ? '\nA question stays in the building, results below the bar never reach her, and no ' +
          'source line can stand under an answer that used nothing.'
      : `\n${failures} CHECK(S) FAILED.`,
  );
  await pg.close();
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
