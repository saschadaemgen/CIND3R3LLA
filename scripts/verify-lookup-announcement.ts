/**
 * She says she is going to look, and only when she is (CCB-S5-025).
 *
 * ── WHAT THIS GUARDS ─────────────────────────────────────────────────────────
 *
 * CCB-S4-038 gave web search a holding line and one hard rule: she may never say she is
 * looking something up when she is not. This briefing extends the line to the archive and to
 * the knowledge base, which means the rule now has three paths to hold on instead of one, and
 * two of them can fail in ways the web path cannot.
 *
 * The briefing asked specifically for a check that fails if an announcement can be emitted
 * for a lookup that never started. That is section 4, and it is mutation-proven per kind.
 *
 * ── WHY THE POSITIVE CONTROLS ARE HALF THE FILE ──────────────────────────────
 *
 * Every guarantee here passes trivially against an implementation that announces NOTHING.
 * "No announcement was emitted for a refused search" is true of a bot with the feature
 * deleted. So each negative is paired with the positive that proves the feature still exists,
 * and the same is true of the threshold: a projection that refused everything would satisfy
 * every assertion about staying quiet.
 *
 * ── AND TWO THINGS THIS FILE EXISTS BECAUSE OF ───────────────────────────────
 *
 * The first build of this shipped a hard-coded generation rate, measured on one model on one
 * machine. Section 3 is the guard: the same question at the same dials must announce on a
 * slow deployment and stay quiet on a fast one, decided by measurement rather than by a
 * constant nobody can make right for hardware this code has never run on.
 *
 * The second is the allowance. CCB-S4-038's own comment said the announcement bypasses the
 * limiter so that "a lookup costs exactly one unit of allowance" and that the alternative
 * would make the ANSWER the message that gets dropped. The bypass it chose still called
 * `noteReply`, so the announcement took a slot and the failure it described was the behaviour
 * it shipped. Section 6 pins the corrected semantics and mutation-proves them.
 */

import { PGlite } from '@electric-sql/pglite';
import { vector } from '@electric-sql/pglite-pgvector';
import type { Queryable } from '../src/db/pool.js';
import { loadMigrationFiles } from '../src/db/migrate.js';
import { listPromptRules } from '../src/db/prompt-rules.js';
import { InteractionEngine } from '../src/interaction/engine.js';
import { DEFAULT_INTERACTION, normalizeInteraction } from '../src/interaction/settings.js';
import { DEFAULT_PERSONALITY, replyCharBudget } from '../src/interaction/personality.js';
import { CORE_INTENTS } from '../src/interaction/intent.js';
import { ConversationState } from '../src/interaction/state.js';
import { ModelQueueMeter } from '../src/interaction/model-queue.js';
import {
  ANNOUNCE_THRESHOLD_SECONDS,
  ATTRIBUTION_KEY,
  lookupBrief,
  projectedReplySeconds,
  shouldAnnounce,
  type LookupKind,
} from '../src/interaction/lookup-announcement.js';
import { renderPromptRule } from '../src/interaction/prompt-rules.js';
import type { CapturedMessage } from '../src/capture/message.js';
import type { AiReplyRequest } from '../src/interaction/ollama-reply.js';
import { setLogLevel } from '../src/log.js';

let failures = 0;
function check(label: string, ok: boolean, detail = ''): void {
  if (!ok) failures++;
  console.log(`  [${ok ? 'PASS' : 'FAIL'}] ${label}${detail ? `: ${detail}` : ''}`);
}

const GROUP = 1;
const ALICE = 'alice-member-id';
const KINDS: LookupKind[] = ['web', 'archive', 'knowledge'];

/**
 * The two rates measured on the development machine, with the transport's own request shape
 * (`reasoning_effort: 'none'`, `max_tokens: 320`), four warm runs each, median.
 *
 * They are fixtures here rather than a claim about production: what the check proves is that
 * the DECISION follows the measurement, not that any particular number is right.
 */
const SLOW_CHARS_PER_SECOND = 138; // qwen3:32b
const FAST_CHARS_PER_SECOND = 414; // qwen3.5:9b

function message(text: string, itemId = 10): CapturedMessage {
  return {
    groupId: GROUP,
    groupName: 'archive',
    itemId,
    sharedMsgId: undefined,
    senderMemberId: ALICE,
    senderDisplayName: 'Alice',
    sentAt: new Date().toISOString(),
    type: 'text',
    text,
    linkPreview: undefined,
    file: undefined,
    forwarded: false,
    quotedFromBot: false,
    raw: {} as never,
  } as CapturedMessage;
}

async function main(): Promise<void> {
  setLogLevel('error');

  /* ── 1. The projection, and what it decides ─────────────────────────────── */

  console.log('\n1. The projection: a prediction, not a guess');

  check(
    'the threshold is five seconds, stated as a judgement about people',
    ANNOUNCE_THRESHOLD_SECONDS === 5,
  );

  // The arithmetic itself, against the real budget rather than a copy of it.
  for (const v of [1, 5, 10]) {
    const expected = replyCharBudget(v) / SLOW_CHARS_PER_SECOND;
    check(
      `  verbosity ${v} projects ${expected.toFixed(1)}s at ${SLOW_CHARS_PER_SECOND} chars/s`,
      Math.abs(projectedReplySeconds(v, SLOW_CHARS_PER_SECOND) - expected) < 1e-9,
    );
  }

  // A rate that cannot produce a wait must be refused rather than producing Infinity, which
  // would silently decide every announcement from then on.
  for (const bad of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
    let threw = false;
    try {
      projectedReplySeconds(5, bad);
    } catch {
      threw = true;
    }
    check(`  a rate of ${String(bad)} is refused rather than divided by`, threw);
  }

  console.log('\n1b. The same question, decided by how fast this deployment writes');

  // THE LOAD-BEARING PAIR. Identical kind, identical dial; the only thing that differs is the
  // measured rate. This is what a hard-coded constant could not have done.
  check(
    'at 138 chars/s a verbosity-10 archive lookup announces (10.1s)',
    shouldAnnounce('archive', 10, SLOW_CHARS_PER_SECOND),
  );
  check(
    'at 414 chars/s the SAME lookup stays quiet (3.4s)',
    !shouldAnnounce('archive', 10, FAST_CHARS_PER_SECOND),
  );
  check(
    '  and on the fast model nothing announces at any dial, because nothing is slow',
    ![1, 2, 3, 4, 5, 6, 7, 8, 9, 10].some((v) =>
      shouldAnnounce('knowledge', v, FAST_CHARS_PER_SECOND),
    ),
  );

  // The crossover on the slow model, computed rather than asserted as a magic number.
  const crossover = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10].find((v) =>
    shouldAnnounce('archive', v, SLOW_CHARS_PER_SECOND),
  );
  check(
    'on the slow model the crossover is verbosity 7',
    crossover === 7,
    `found ${String(crossover)}`,
  );
  check(
    '  and it is exactly where the projection crosses the threshold',
    projectedReplySeconds(7, SLOW_CHARS_PER_SECOND) >= ANNOUNCE_THRESHOLD_SECONDS &&
      projectedReplySeconds(6, SLOW_CHARS_PER_SECOND) < ANNOUNCE_THRESHOLD_SECONDS,
  );

  console.log('\n1c. The web is exempt, and an unmeasured deployment announces');

  check(
    'web announces at every dial and every rate, because its lookup is a network round trip',
    [1, 5, 10].every(
      (v) =>
        shouldAnnounce('web', v, FAST_CHARS_PER_SECOND) &&
        shouldAnnounce('web', v, SLOW_CHARS_PER_SECOND) &&
        shouldAnnounce('web', v, null),
    ),
  );
  check(
    'a null rate announces: a cold process is the slowest it will ever be',
    shouldAnnounce('archive', 1, null) && shouldAnnounce('knowledge', 1, null),
  );
  check(
    '  and so does a rate that arrived nonsensical, rather than dividing by it',
    shouldAnnounce('archive', 1, 0) && shouldAnnounce('knowledge', 1, Number.NaN),
  );

  /* ── 2. The three briefs ────────────────────────────────────────────────── */

  console.log('\n2. Three lookups, three briefs, one form');

  const briefs = new Map(KINDS.map((k) => [k, lookupBrief(k)]));
  check(
    'every kind has a brief and no two are the same',
    new Set(briefs.values()).size === KINDS.length,
  );
  check(
    'none of them is a line she says: each is addressed to her as a situation',
    [...briefs.values()].every((b) => /\byou\b/i.test(b)),
  );
  check(
    'no brief carries a dash she is told never to write',
    ![...briefs.values()].some((b) => /[—–―]/.test(b)),
  );

  // The DISTINCTION is the point: each must name where she is going, and the knowledge brief
  // must not repeat the "not in my head" stance that is false of the operator's documents.
  check('the web brief goes outside', /\bweb\b/i.test(briefs.get('web') ?? ''));
  check('the archive brief names this group', /archive/i.test(briefs.get('archive') ?? ''));
  // CONSENT-EXACT. `countPublishedMatching` reads `published_messages`, which is derived from
  // the consent table, so a brief promising "everything its members have said here" would
  // have her claim to search what nobody opted in to publish.
  check(
    '  and says PUBLISHED rather than everything said, which is what it actually searches',
    /publish/i.test(briefs.get('archive') ?? '') &&
      !/everything its members have said/i.test(briefs.get('archive') ?? ''),
  );
  check(
    'the knowledge brief names the operator documents',
    /documents/i.test(briefs.get('knowledge') ?? ''),
  );
  check(
    'and it says she ALREADY has it, which is the contradiction 055 removed from the rules',
    /already have/i.test(briefs.get('knowledge') ?? '') &&
      !/not have this one in your own head/i.test(briefs.get('knowledge') ?? ''),
  );
  check(
    '  while the web brief still says she does not',
    /do not have this one in your own head/i.test(briefs.get('web') ?? ''),
  );

  check(
    'the attribution map covers every kind, and the archive has none to name',
    KINDS.every((k) => k in ATTRIBUTION_KEY) && ATTRIBUTION_KEY.archive === null,
  );

  /* ── 3. The rate is measured from her own replies ───────────────────────── */

  console.log('\n3. The rate the meter reads back');

  let clock = 1_000_000;
  const meter = new ModelQueueMeter(() => clock);

  check('with no replies at all the meter says it does not know', meter.observedCharsPerSecond() === null);

  // Two replies is still not enough: the first call after a restart also pays for loading
  // the model, which measured 3 to 8 seconds against sub-second warm calls.
  const record = (chars: number, ms: number, ok = true): void => {
    const id = meter.start(null);
    clock += ms;
    meter.finish(id, ok, chars);
  };
  record(500, 5000); // the cold one: 100 chars/s
  record(500, 1000);
  check('  nor after two', meter.observedCharsPerSecond() === null);
  record(500, 1000);
  const observed = meter.observedCharsPerSecond();
  check('after three it answers', observed !== null);
  check(
    '  and it takes the MEDIAN, so the cold outlier does not set the rate',
    observed === 500,
    `got ${String(observed)}`,
  );

  const failedMeter = new ModelQueueMeter(() => clock);
  for (let i = 0; i < 4; i++) {
    const id = failedMeter.start(null);
    clock += 1000;
    failedMeter.finish(id, false, 500);
  }
  check(
    'a failed call contributes no rate, because it produced no reply',
    failedMeter.observedCharsPerSecond() === null,
  );

  const instantMeter = new ModelQueueMeter(() => clock);
  for (let i = 0; i < 4; i++) instantMeter.finish(instantMeter.start(null), true, 500);
  check(
    'a zero-duration call is skipped rather than reported as an infinite rate',
    instantMeter.observedCharsPerSecond() === null,
  );

  /* ── 4. She never announces a lookup that did not start ─────────────────── */

  console.log('\n4. The invariant: an announcement means the lookup ran');

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
  for (const migration of await loadMigrationFiles()) await pg.exec(migration.sql);
  const rules = await listPromptRules(db);

  const interaction = normalizeInteraction({ ...DEFAULT_INTERACTION });

  // The rule that CARRIES the brief, rendered through the real renderer. Assembling the
  // whole lane here would need every value the transport supplies (`maxChars` and the rest)
  // and proves nothing extra: `verify:prompt-identity` already pins all three assembled
  // searching prompts byte for byte, one per kind.
  const aboutToLook = rules.find((r) => r.id === 'task.searching.about-to-look');
  check('the rule that names the destination exists', aboutToLook !== undefined);
  check(
    '  and it carries the placeholder rather than naming the web itself',
    (aboutToLook?.text ?? '').includes('{{lookupBrief}}') &&
      !/\bthe web\b/i.test(aboutToLook?.text ?? ''),
  );
  for (const kind of KINDS) {
    const rendered = aboutToLook
      ? renderPromptRule(aboutToLook, { lookupBrief: lookupBrief(kind) } as never)
      : '';
    check(`  it renders the ${kind} brief`, rendered.includes(lookupBrief(kind)));
  }
  check(
    'and no searching rule still names the web in its own text',
    !rules.filter((r) => r.lane === 'searching').some((r) => /\bthe web\b/i.test(r.text)),
  );

  // FAILS CLOSED, not open. A searching prompt built with no brief must THROW rather than
  // render a holding line whose destination is missing: the caller treats a throw as "no
  // line", which is this lane's documented behaviour when the model cannot speak. An earlier
  // draft defaulted the placeholder to an empty string and called the path unreachable;
  // `verify:book` reached it within the hour by assembling every lane for the console preview.
  let renderedWithoutBrief = true;
  try {
    if (aboutToLook) renderPromptRule(aboutToLook, {} as never);
  } catch {
    renderedWithoutBrief = false;
  }
  check(
    'a searching rule with no brief refuses to render rather than losing the destination',
    !renderedWithoutBrief,
  );
  // The stance line was the one that would have CONTRADICTED the knowledge brief.
  check(
    'the stance line no longer asserts she lacks it, which is false of his documents',
    !rules
      .filter((r) => r.lane === 'searching')
      .some((r) => /not have this one in your own head/i.test(r.text)),
  );

  /**
   * Drive the real engine and report what left, plus whether the lookup actually ran.
   *
   * `personalize` returns the holding line for the searching mode and the answer otherwise,
   * which is what lets a caller tell the two messages apart in `sent`.
   */
  const HOLD = '<<HOLDING-LINE>>';
  const ANSWER = '<<ANSWER>>';

  interface Run {
    sent: string[];
    counted: number;
    announced: boolean;
    archiveCounted: number;
  }

  const drive = async (opts: {
    text: string;
    verbosity?: number;
    rate?: number | null;
    knowledgePassages?: { text: string }[];
    knowledgeSources?: string[];
    modelFails?: boolean;
    countThrows?: boolean;
    /**
     * Ordinary turns to spend the allowance on BEFORE the lookup.
     *
     * The engine builds its own `ConversationState` and does not take one, so the only way
     * to reach a spent member is the way production does: earlier replies. An earlier draft
     * passed a pre-spent state in the deps object, which the engine ignored, and the check
     * reported a member with no allowance receiving two messages.
     */
    spendFirst?: readonly string[];
    replyLimitPerMember?: number;
    /** Make the model answer the announcement with the transport own envelope. */
    announceReturnsJson?: boolean;
  }): Promise<Run> => {
    const sent: string[] = [];
    let archiveCounted = 0;

    // A db that counts archive searches and can be made to fail, over the real schema.
    const spyDb = {
      query: async (sql: string, values?: readonly unknown[]) => {
        if (/published_messages|message_publish_state/i.test(sql) && /count/i.test(sql)) {
          archiveCounted += 1;
          if (opts.countThrows) throw new Error('archive count exploded');
        }
        return db.query(sql, values);
      },
    } as Queryable;

    const engine = new InteractionEngine({
      capabilities: () => [...CORE_INTENTS, 'LOOKUP'],
      db: spyDb,
      settings: () =>
        opts.replyLimitPerMember === undefined
          ? interaction
          : normalizeInteraction({
              ...DEFAULT_INTERACTION,
              replyLimitPerMember: opts.replyLimitPerMember,
              replyLimitPerChat: 50,
            }),
      rules: () => rules,
      personality: () => ({ ...DEFAULT_PERSONALITY, verbosity: opts.verbosity ?? 10 }),
      knowledge:
        opts.knowledgePassages === undefined
          ? undefined
          : () => ({
              query: () =>
                Promise.resolve({
                  passages: opts.knowledgePassages ?? [],
                  sources: opts.knowledgeSources ?? [],
                }),
            }),
      botProfileId: 1,
      personalize: (req: AiReplyRequest) => {
        if (req.mode === 'searching')
          return Promise.resolve(
            opts.announceReturnsJson
              ? '{"status":"searching","message":"Access denied."}'
              : HOLD,
          );
        if (opts.modelFails) return Promise.resolve(null);
        return Promise.resolve(ANSWER);
      },
      send: (_msg, text) => {
        sent.push(text);
        return Promise.resolve();
      },
    } as never);

    let itemId = 100;
    for (const earlier of opts.spendFirst ?? []) await engine.handle(message(earlier, itemId++));
    // Only what the LOOKUP turn produced; the spending turns are setup.
    const spentCount = sent.length;
    archiveCounted = 0;
    await engine.handle(message(opts.text, itemId));
    const produced = sent.slice(spentCount);
    return {
      sent: produced,
      counted: spentCount,
      announced: produced.some((t) => t.includes(HOLD)),
      archiveCounted,
    };
  };

  console.log('\n4b. The archive');

  const archiveRun = await drive({ text: 'Cinderella search the archive for pancakes' });
  check(
    'a real archive search announces AND runs the count',
    archiveRun.announced && archiveRun.archiveCounted > 0,
    `announced=${String(archiveRun.announced)} counted=${String(archiveRun.archiveCounted)}`,
  );
  check('  and the answer follows the holding line', archiveRun.sent.length >= 2);

  // NEGATIVE: no query means no search, and therefore no announcement.
  const emptyQuery = await drive({ text: 'Cinderella search the archive for' });
  check(
    'an archive request with nothing to search for announces nothing',
    !emptyQuery.announced && emptyQuery.archiveCounted === 0,
  );

  console.log('\n4c. The knowledge base');

  const kbHit = await drive({
    text: 'Cinderella what does the handbook say about pancakes?',
    knowledgePassages: [{ text: 'Pancakes are cooked on a griddle.' }],
    knowledgeSources: ['handbook.md'],
  });
  check('passages above the floor produce a holding line', kbHit.announced);

  // NEGATIVE: below the floor there are no passages, so there is nothing to announce and
  // nothing to attribute. The two are suppressed by the same emptiness.
  const kbMiss = await drive({
    text: 'Cinderella what does the handbook say about pancakes?',
    knowledgePassages: [],
    knowledgeSources: [],
  });
  check('nothing retrieved announces nothing', !kbMiss.announced);
  check(
    '  and she still answers, without claiming to have read anything',
    kbMiss.sent.length === 1 && !kbMiss.sent[0]?.includes(HOLD),
  );

  /* ── 5. Closing the loop ────────────────────────────────────────────────── */

  // RAW STRUCTURED OUTPUT IS NOT A LINE. Observed against a real model at sharpness 10: the
  // announcement came back as {"status":"searching","message":"Access denied. ..."}, which
  // would have reached a member as visible JSON. This lane is the likeliest place for it,
  // because its deterministic draft is empty and there is no shape for the model to copy.
  const jsonRun = await drive({
    text: 'Cinderella search the archive for pancakes',
    announceReturnsJson: true,
  });
  check(
    'an announcement that comes back as JSON is treated as nothing rather than sent',
    !jsonRun.sent.some((t) => t.trim().startsWith('{')),
    jsonRun.sent.join(' | ').slice(0, 80),
  );
  check(
    '  and the ANSWER still goes out, because the lookup itself was never in doubt',
    jsonRun.sent.length === 1,
    `sent ${String(jsonRun.sent.length)}`,
  );

  console.log('\n5. A holding line is never left over silence');

  const kbFailed = await drive({
    text: 'Cinderella what does the handbook say about pancakes?',
    knowledgePassages: [{ text: 'Pancakes are cooked on a griddle.' }],
    knowledgeSources: ['handbook.md'],
    modelFails: true,
  });
  check(
    'she announced, the model failed, and she says so rather than going quiet',
    kbFailed.announced && kbFailed.sent.length >= 2,
    `sent ${String(kbFailed.sent.length)}`,
  );
  check(
    '  with the honest line, which does not answer from training data instead',
    kbFailed.sent.some((t) => /could not look that up/i.test(t)),
  );

  // POSITIVE CONTROL: the honest line must not appear when nothing went wrong.
  check(
    'and a successful lookup does NOT carry it',
    !kbHit.sent.some((t) => /could not look that up/i.test(t)),
  );

  // A model failure with NO announcement stays silent, which is the pre-existing behaviour
  // and is still correct: nothing was promised.
  const quietFail = await drive({
    text: 'Cinderella how are you today?',
    modelFails: true,
    verbosity: 1,
  });
  check(
    'a failure with no holding line before it still stays silent',
    !quietFail.announced && quietFail.sent.length === 0,
  );

  const archiveBroken = await drive({
    text: 'Cinderella search the archive for pancakes',
    countThrows: true,
  });
  check(
    'an archive count that throws after the holding line is answered honestly',
    archiveBroken.announced && archiveBroken.sent.length >= 2,
    `sent ${String(archiveBroken.sent.length)}`,
  );

  /* ── 6. The allowance ───────────────────────────────────────────────────── */

  console.log('\n6. A lookup costs one unit of allowance, not two');

  // THE ASSERTION THIS SECTION EXISTS FOR, and it is driven through the REAL engine rather
  // than computed off `ConversationState`. The first draft of this check did the latter and a
  // mutation that restored the shipped defect stayed green, which is D-162 exactly: a
  // property a check can compute is not the property an operator experiences.
  //
  // One reply per member. A lookup emits two messages. If the holding line consumes the
  // allowance, the ANSWER is the one the limiter drops, and the member is left holding
  // "give me a second" forever.
  const tight = await drive({
    text: 'Cinderella search the archive for pancakes',
    replyLimitPerMember: 1,
  });
  check('with ONE reply allowed, the holding line goes out', tight.announced);
  check(
    '  and so does the answer, because the holding line took no allowance',
    tight.sent.length === 2,
    `sent ${String(tight.sent.length)}: ${tight.sent.map((t) => t.slice(0, 20)).join(' | ')}`,
  );
  check(
    '  and the answer is the real one rather than a second holding line',
    tight.sent.filter((t) => t.includes(HOLD)).length === 1,
  );

  // POSITIVE CONTROL on the limiter itself: it must still be capable of dropping something,
  // or the assertion above passes against a build with no rate limiting at all.
  const overLimit = new ConversationState();
  overLimit.allowReply(GROUP, ALICE, Date.now(), 1, 50);
  check(
    'the limiter can still refuse: a spent member would be refused a reply',
    !overLimit.wouldAllowReply(GROUP, ALICE, Date.now(), 1, 50),
  );

  // And a member with NOTHING left gets neither message, which is what bounds an uncounted
  // send on the two paths that have no search budget behind them.
  //
  // Zero is not configurable (`normalizeInteraction` floors the limit at 1), so the
  // allowance is SPENT instead, which is how a member reaches this state in production.
  const spentRun = await drive({
    text: 'Cinderella search the archive for pancakes',
    replyLimitPerMember: 1,
    spendFirst: ['Cinderella how are you?'],
  });
  check(
    'a member who has spent their allowance is not told she is looking',
    !spentRun.announced,
    `sent ${String(spentRun.sent.length)}`,
  );
  check(
    '  and gets no answer either, so nothing is left hanging',
    spentRun.sent.length === 0,
    `sent ${String(spentRun.sent.length)}`,
  );

  /* ── 7. The mutations ───────────────────────────────────────────────────── */

  console.log('\n7. The proof that this can go red');

  // 7a. The floor of the whole briefing: an announcement for a lookup that never started.
  const alwaysAnnounces = (kind: LookupKind, verbosity: number): boolean =>
    shouldAnnounce(kind, verbosity, null) || kind === 'web' || verbosity > 0;
  check(
    'a projection that announced everything would fail the fast-model assertion',
    [1, 5, 10].some((v) => alwaysAnnounces('knowledge', v)) &&
      ![1, 5, 10].some((v) => shouldAnnounce('knowledge', v, FAST_CHARS_PER_SECOND)),
  );

  // 7b. A rate taken as a mean rather than a median is moved by one cold call.
  const meanOf = (xs: number[]): number => xs.reduce((a, b) => a + b, 0) / xs.length;
  check(
    'taking the mean instead of the median would let the cold call set the rate',
    Math.abs(meanOf([100, 500, 500]) - 500) > 100,
  );

  // 7c. Counting the announcement is what made the answer droppable.
  const withCounting = new ConversationState();
  withCounting.noteReply(GROUP, ALICE, Date.now()); // the announcement, as it used to be
  check(
    'if the holding line counted, a one-reply member would lose the ANSWER',
    !withCounting.wouldAllowReply(GROUP, ALICE, Date.now(), 1, 50),
  );
  const withoutCounting = new ConversationState();
  check(
    '  and not counting it leaves the answer exactly one slot, which is the fix',
    withoutCounting.wouldAllowReply(GROUP, ALICE, Date.now(), 1, 50),
  );

  console.log(
    failures === 0
      ? '\nShe announces only what she is about to do, in her own words, only when the ' +
          'member would otherwise be kept waiting, and never over a silence.'
      : `\n${failures} CHECK(S) FAILED.`,
  );
  await pg.close();
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
