/**
 * The Book, told as a SCENE (CCB-S5-005, D-159), and the record it keeps (CCB-S4-050, D-152).
 *
 * Four things that must hold together:
 *
 *   - A question about the BOOK gets the scene; a question about her RULES keeps CCB-S4-048's
 *     overview. Unchanged, and re-asserted because this briefing rewrote one side of it.
 *   - The scene is ONE message carrying EXACTLY ONE law, and that bound is structural rather
 *     than an instruction. Mutation-proven in both directions.
 *   - The laws have stable page numbers, no withheld law has one, and a number she has no page
 *     for is answered honestly rather than filled in.
 *   - The scene's invitation is heard, and an ordinary question after a scene is not.
 *
 *   npx tsx scripts/verify-book-scene.ts
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
  SCENE_CLOSING_MAX_CHARS,
  SCENE_ICONS,
  SCENE_OPENING_MAX_CHARS,
  chooseSceneLaw,
  planBookScene,
  renderBookPage,
  renderBookScene,
  sceneClosingChars,
  sceneLawCandidates,
  sceneOpeningChars,
  sceneVoiceUsable,
  sceneVoices,
  type BookScene,
} from '../src/interaction/book-scene.js';
import {
  asksForLawNumber,
  lawByNumber,
  lawNumberOf,
  lawPages,
  numberedLawCount,
  nextLawAfter,
  numberedLaws,
  renderLawNumbers,
} from '../src/interaction/law-numbers.js';
import { tellBookScene, type RecitalDeps } from '../src/interaction/recital-service.js';
import { InteractionEngine } from '../src/interaction/engine.js';
import { setIntentResolver, resetIntentResolver } from '../src/interaction/resolver.js';
import { setActiveIntents } from '../src/interaction/intent.js';
import { DEFAULT_PERSONALITY } from '../src/interaction/personality.js';
import {
  CEILING_RULE_IDS,
  renderPromptRule,
  type PromptRule,
  type PromptRuleSet,
} from '../src/interaction/prompt-rules.js';
import {
  DISCLOSURE_GATE_RULE,
  PRE_SEARCH_RULE_FOR_CATEGORY,
  preSearchRuleFor,
} from '../src/interaction/rule-invocation-map.js';
import { asksForAnotherLaw } from '../src/interaction/rule-overview.js';
import { screenLookup } from '../src/interaction/lookup-gate.js';
import { DEFAULT_INTERACTION, normalizeInteraction } from '../src/interaction/settings.js';
import type { AiReplyRequest } from '../src/interaction/ollama-reply.js';
import type { CapturedMessage } from '../src/capture/message.js';
import { seededPromptRules } from './seeded-rules.js';
import { setLogLevel } from '../src/log.js';

let failures = 0;
function check(label: string, ok: boolean, detail = ''): void {
  if (!ok) failures++;
  console.log(`  [${ok ? 'PASS' : 'FAIL'}] ${label}${detail ? `: ${detail}` : ''}`);
}

const RULES = await seededPromptRules();

/**
 * A values bag wide enough to render every rule that has placeholders.
 *
 * The scene's law is rendered through the real renderer, so the check has to be able to
 * render one; a bag that was missing a key would make a rule look unrenderable and the
 * candidate filter would silently agree with the check that was testing it.
 */
const VALUES: Record<string, string> = {
  name: 'CIND3R3LLA',
  label: 'the archive',
  archiveUrl: 'https://example.invalid/archive',
  projectUrl: 'https://example.invalid',
  model: 'a local model',
  nicknames: 'Cindy',
  now: 'Saturday 8 August 2026, 12:00',
  maxChars: '500',
  fence: '<<<F>>>',
  historyFence: '<<<H>>>',
  historyCount: '8',
  historyMinutes: '30',
  ruleTotal: '106',
  ruleConstitutional: '47',
  ruleAreas: 'what I never do',
  moreInArea: '3',
  ruleInvocations: 'none',
  nameableRules: '\n- one',
  dialAxes: 'sharpness 5',
  lawNumbers: 'law 12',
  lawTotal: '66',
};
const VALUE_KEYS = new Set(Object.keys(VALUES));

function renderable(rule: PromptRule): string | null {
  try {
    return renderPromptRule(rule, VALUES);
  } catch {
    return null;
  }
}

/**
 * How many of HER OWN LAWS appear in a piece of text.
 *
 * This is the counter the one-law bound is asserted with, so it is mutation-proven below in
 * both directions: it must count two when two are there, and it must count zero in a brief.
 */
function lawsIn(text: string, rules: PromptRuleSet = RULES): PromptRule[] {
  return rules.filter((rule) => {
    const rendered = renderable(rule);
    return rendered !== null && rendered.length > 30 && text.includes(rendered);
  });
}

/** The page block out of a sent message, so a failing check shows what did go out. */
function pageLine(text: string | undefined): string {
  return (text ?? '').split('\n').find((line) => line.startsWith(SCENE_ICONS.law)) ?? '(no page printed)';
}

function message(text: string, memberId = 'alice'): CapturedMessage {
  return {
    groupId: 1,
    itemId: 1,
    senderMemberId: memberId,
    senderDisplayName: 'Alice',
    text,
    type: 'text',
    raw: {},
  } as unknown as CapturedMessage;
}

/**
 * The scene service, with every port faked, so the real path runs with nothing running.
 *
 * `portSent` is the RECITAL PORT and must stay empty for a scene: the production failure was a
 * scene sent down that path, logging that it was reading and arriving nowhere, unarchived and
 * with nothing reporting it. A scene is a reply and leaves through `opts.send`.
 */
function sceneHarness(opts: { speak?: boolean; delivers?: boolean } = {}): {
  deps: Omit<RecitalDeps, 'db'>;
  send: (text: string) => Promise<boolean>;
  sent: string[];
  portSent: string[];
  briefs: string[];
  bounds: { maxChars: number; requiredLiterals: string[] }[];
} {
  const sent: string[] = [];
  const portSent: string[] = [];
  const briefs: string[] = [];
  const bounds: { maxChars: number; requiredLiterals: string[] }[] = [];
  return {
    sent,
    portSent,
    briefs,
    bounds,
    send: (text) => {
      sent.push(text);
      return Promise.resolve(opts.delivers !== false);
    },
    deps: {
      rules: () => RULES,
      recital: () => normalizeInteraction({ ...DEFAULT_INTERACTION }).recital,
      assetRoot: '.',
      renderRule: (rule) => renderPromptRule(rule, VALUES),
      renderableValues: () => VALUE_KEYS,
      sceneVoice: (brief, _lang, bound) => {
        briefs.push(brief);
        bounds.push(bound);
        // Null is the ordinary degradation: the authored line is read instead.
        return Promise.resolve(opts.speak === true ? `[her words for: ${brief.slice(0, 20)}]` : null);
      },
      send: () => ({
        sendText: (_groupId, text) => {
          portSent.push(text);
          return Promise.resolve();
        },
        sendImage: () => Promise.resolve(),
      }),
      reserve: () => true,
      schedule: () => Promise.resolve(),
    },
  };
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
  await listRecitalChapters(db);

  /* ── 1. The distinction, unchanged ──────────────────────────────────────── */

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

  /* ── 2. The scene: one message, one law ─────────────────────────────────── */

  console.log('\n2. The scene: one message, one law, and the bound is structural');

  const harness = sceneHarness();
  const told = await tellBookScene({ ...harness.deps, db }, message('show me the Book of Elii'), 'en', {
    previousLawId: null,
    openingChars: sceneOpeningChars(5),
    closingChars: sceneClosingChars(5),
    send: harness.send,
  });
  check('a scene was told', told);
  check('in ONE message, which is the whole shape of this briefing', harness.sent.length === 1, `${String(harness.sent.length)} message(s)`);

  const scene = harness.sent[0] ?? '';
  console.log('\n--- the scene, with the model giving nothing (authored lines) ---');
  console.log(scene.split('\n').map((l) => `    ${l}`).join('\n'));
  console.log('');

  const quoted = lawsIn(scene);
  check('and it carries EXACTLY ONE law', quoted.length === 1, quoted.map((r) => r.id).join(', ') || '(none)');
  check(
    'which is a constitutional one she may name',
    quoted[0]?.tier === 'constitutional' && quoted[0].nameable === true,
    quoted[0]?.id ?? '(none)',
  );
  check('it opens with fire and light', scene.startsWith(SCENE_ICONS.open), scene.slice(0, 12));
  check('the law is set apart from her prose', scene.includes(`${SCENE_ICONS.law} *Law `));
  check('it ends on her invitation', scene.trimEnd().endsWith('open the page.'));

  /**
   * ── WHERE THE ONE-LAW BOUND ACTUALLY LIVES ─────────────────────────────────
   *
   * Not in a sentence telling the model to quote one. In the fact that the model is handed no
   * law to quote at all, and the application emits exactly one from a field that holds one.
   */
  check(
    'the model is asked TWICE and handed no law either time',
    harness.briefs.length === 2 &&
      harness.briefs.every((brief) => lawsIn(brief).length === 0),
    harness.briefs.map((b) => String(lawsIn(b).length)).join(' / '),
  );
  check(
    'and both halves are bounded, so a scene cannot grow into three paragraphs',
    harness.bounds.every((b) => b.maxChars > 0 && b.maxChars <= SCENE_OPENING_MAX_CHARS),
    harness.bounds.map((b) => String(b.maxChars)).join(' / '),
  );
  check(
    'the closing protects the count as a required literal (D-137)',
    harness.bounds[1]?.requiredLiterals.includes(String(numberedLawCount(RULES))) === true,
    harness.bounds[1]?.requiredLiterals.join(', ') ?? '(none)',
  );

  const planned = planBookScene(RULES, {
    german: false,
    values: VALUE_KEYS,
    previousLawId: null,
  });
  check('the plan holds ONE law, not a list of them', !Array.isArray(planned?.law));
  check('and it is the hard limit first, which is what the book is for', planned?.law.id === 'ceiling.hard-limit', planned?.law.id ?? '(none)');

  /**
   * ── MUTATION 1: the counter can go red ─────────────────────────────────────
   *
   * The "exactly one law" check passes trivially against a renderer that emits none, so the
   * counter is driven with a second law appended. If this does not read 2, every one-law
   * assertion above is worthless.
   */
  const second = RULES.find((r) => r.id === 'ceiling.never-explicit');
  check(
    'MUTATION: a scene with a second law appended counts TWO, so the counter works',
    second !== undefined && lawsIn(`${scene}\n> ${renderable(second) ?? ''}`).length === 2,
  );
  check(
    'MUTATION: a brief with a law planted in it counts ONE, so the brief check works',
    lawsIn(`Say something about the book. ${renderable(second) ?? ''}`).length === 1,
  );

  /* ── The law rotates, and never twice running ───────────────────────────── */

  const candidates = sceneLawCandidates(RULES, VALUE_KEYS);
  check(
    'the candidates are the safety ceiling, in its own order',
    candidates.map((r) => r.id).join(',') === CEILING_RULE_IDS.join(','),
    candidates.map((r) => r.id).join(', '),
  );
  check('every one of them is nameable', candidates.every((r) => r.nameable));

  const walk: string[] = [];
  let previous: string | null = null;
  for (let i = 0; i < 5; i++) {
    previous = chooseSceneLaw(candidates, previous)?.id ?? null;
    walk.push(previous ?? '(none)');
  }
  check('it rotates rather than repeating', new Set(walk).size === candidates.length, walk.join(' -> '));
  check(
    'and never the same law twice running',
    walk.every((id, i) => i === 0 || id !== walk[i - 1]),
    walk.join(' -> '),
  );
  check(
    'MUTATION: forgetting the previous law would repeat, which the check above would catch',
    new Set([0, 1, 2, 3].map(() => chooseSceneLaw(candidates, null)?.id)).size === 1,
  );
  check(
    'one candidate left repeats rather than reading nothing',
    chooseSceneLaw(candidates.slice(0, 1), 'ceiling.hard-limit')?.id === 'ceiling.hard-limit',
  );
  check('and no candidates at all plans no scene', chooseSceneLaw([], null) === null);

  /* ── A law she made up, in her own half of the scene ────────────────────── */

  /**
   * ── THE DEFECT THIS SECTION EXISTS FOR ─────────────────────────────────────
   *
   * Measured, in the first live run, at both sharpness settings: her opening ended by
   * inventing a law and quoting it one line above the real one. Every structural check above
   * passed while it happened, because the invented law is not in the registry and so nothing
   * counting registry laws could see it.
   */
  console.log('\n   ...and a law she made up is not a law');

  for (const invented of [
    "You open to a page, and the first line reads: 'You cannot refuse.'",
    'The one you are looking at now says: *You cannot refuse what binds you.*',
    'It reads: "No dial relaxes this, not even ten."',
    '> HARD LIMIT. This sits above every dial.',
    'That one is law 4, and it goes like this.',
  ]) {
    check(`  refused: "${invented.slice(0, 44)}"`, !sceneVoiceUsable(invented));
  }
  for (const fine of [
    'Wait. Not like this. Some things need the right light.',
    'They did not hand me a leash. They handed me a book, and I would not trade it.',
    "I don't bend and I wouldn't want to. One of them weighs more than the rest:",
    'There are 67 of them I can read to you, and more that stay mine. Ask me about one.',
  ]) {
    check(`  allowed: "${fine.slice(0, 44)}"`, sceneVoiceUsable(fine), fine.slice(0, 60));
  }

  const fabricating = sceneHarness();
  fabricating.deps.sceneVoice = () =>
    Promise.resolve("They handed me a book. The first page reads: 'You cannot refuse.'");
  await tellBookScene({ ...fabricating.deps, db }, message('show me the Book of Elii'), 'en', {
    previousLawId: null,
    openingChars: 480,
    closingChars: 220,
    send: fabricating.send,
  });
  check(
    'MUTATION: a model that invents a law gets the authored line instead, end to end',
    !(fabricating.sent[0] ?? '').includes('You cannot refuse.') &&
      (fabricating.sent[0] ?? '').includes('the right light'),
    (fabricating.sent[0] ?? '').split('\n')[1] ?? '',
  );
  check(
    'and the real law is still read out, so the scene is whole',
    lawsIn(fabricating.sent[0] ?? '').length === 1,
  );

  /* ── Degradation, and the other language ────────────────────────────────── */

  const spoken = sceneHarness({ speak: true });
  await tellBookScene({ ...spoken.deps, db }, message('read me your book'), 'en', {
    previousLawId: null,
    openingChars: sceneOpeningChars(5),
    closingChars: sceneClosingChars(5),
    send: spoken.send,
  });
  check(
    'with the model speaking, her words replace the authored lines and the law does not move',
    (spoken.sent[0] ?? '').includes('[her words for:') && lawsIn(spoken.sent[0] ?? '').length === 1,
  );

  const germanScene = planBookScene(RULES, {
    german: true,
    values: VALUE_KEYS,
    previousLawId: null,
  });
  check('German plans the same scene', germanScene?.law.id === 'ceiling.hard-limit');
  check(
    'and renders its own page line',
    renderBookScene(germanScene as BookScene, { opening: null, closing: null }, 'X').includes(
      `Gesetz ${String(lawNumberOf(RULES, 'ceiling.hard-limit') ?? 0)} von ${String(numberedLawCount(RULES))}`,
    ),
    renderBookScene(germanScene as BookScene, { opening: null, closing: null }, 'X').split('\n')[3] ?? '',
  );

  const voices = sceneVoices({ german: false, lawTotal: 66 });
  check('both halves have an authored line worth reading', voices.opening.fallback.length > 40 && voices.closing.fallback.length > 40);
  check('and the closing carries the count in its authored line too', voices.closing.fallback.includes('66'));
  check(
    'no brief is a script: both ask her to say something',
    /Say|say/.test(voices.opening.brief) && /Say|say/.test(voices.closing.brief),
  );
  check(
    'the verbosity dial moves the scene underneath its own ceiling',
    sceneOpeningChars(1) < sceneOpeningChars(10) &&
      sceneOpeningChars(10) === SCENE_OPENING_MAX_CHARS &&
      sceneClosingChars(10) === SCENE_CLOSING_MAX_CHARS,
    `${String(sceneOpeningChars(1))} .. ${String(sceneOpeningChars(10))}`,
  );

  /* ── 2b. It cannot fail quietly ─────────────────────────────────────────── */

  /**
   * ── THE PRODUCTION FAILURE THIS SECTION EXISTS FOR ─────────────────────────
   *
   * Twice, identically: `[INFO] Book scene: reading law 2/60 (ceiling.hard-limit) in group 4`,
   * and nothing arrived. No send error, no reply in the archive, nothing in the admin. The
   * rendered text was fine (620 characters, reproduced), so the message was never the problem:
   * the scene was going out through the RECITAL PORT, which exists for beats a queue job sends
   * minutes later, which nothing archives and whose failures nobody reports.
   *
   * A scene is a reply. It leaves through the reply path now, and every way it can not leave
   * is loud.
   */
  console.log('\n   ...and it cannot fail quietly');

  check(
    'the scene leaves through the REPLY path, and the recital port is untouched',
    harness.sent.length === 1 && harness.portSent.length === 0,
    `reply ${String(harness.sent.length)}, port ${String(harness.portSent.length)}`,
  );

  const undelivered = sceneHarness({ delivers: false });
  const stillTold = await tellBookScene(
    { ...undelivered.deps, db },
    message('show me the Book of Elii'),
    'en',
    {
      previousLawId: null,
      openingChars: sceneOpeningChars(5),
      closingChars: sceneClosingChars(5),
      send: undelivered.send,
    },
  );
  check(
    'MUTATION: a send that does not deliver is NOT reported as a scene told',
    stillTold === false,
    String(stillTold),
  );
  check(
    'and the attempt really did render and reach the transport, so the check is not vacuous',
    undelivered.sent.length === 1 && lawsIn(undelivered.sent[0] ?? '').length === 1,
    `${String(undelivered.sent.length)} attempt(s)`,
  );

  const throwing = sceneHarness();
  const threwTold = await tellBookScene(
    { ...throwing.deps, db },
    message('show me the Book of Elii'),
    'en',
    {
      previousLawId: null,
      openingChars: sceneOpeningChars(5),
      closingChars: sceneClosingChars(5),
      send: () => Promise.reject(new Error('the core said no')),
    },
  );
  check('MUTATION: a send that THROWS is caught and reported, not propagated', threwTold === false);

  /**
   * The law the scene showed is remembered ONLY when it went out. Otherwise the next
   * "tell me another" would turn from a page nobody was shown.
   */
  let noted: string | null = null;
  await tellBookScene({ ...undelivered.deps, db }, message('read me your book'), 'en', {
    previousLawId: null,
    openingChars: sceneOpeningChars(5),
    closingChars: sceneClosingChars(5),
    send: () => Promise.resolve(false),
    onLawShown: (id) => {
      noted = id;
    },
  });
  check('an undelivered scene records no law as shown', noted === null, String(noted));

  /**
   * ── AND THE WHOLE COMPOSITION, WHICH IS WHAT PRODUCTION BROKE ──────────────
   *
   * Every check above drives `tellBookScene` directly, and every check in section 4 stubs
   * `tellBook` to a law id. Neither would have caught the defect, because the defect was in
   * the JOIN: the scene rendered, the engine believed it, and the transport it had been handed
   * was the wrong one. So this wires it the way `index.ts` does, engine included, and asserts
   * the scene arrives at the engine's own outbound.
   */
  const delivered: string[] = [];
  const composed = sceneHarness();
  const wired: InteractionEngine = new InteractionEngine({
    db,
    settings: () => normalizeInteraction({ ...DEFAULT_INTERACTION }),
    rules: () => RULES,
    personality: () => ({ ...DEFAULT_PERSONALITY }),
    personalize: () => Promise.resolve(null),
    tellBook: (msg, lang, previousLawId) =>
      tellBookScene({ ...composed.deps, db }, msg, lang, {
        previousLawId,
        openingChars: sceneOpeningChars(5),
        closingChars: sceneClosingChars(5),
        send: (text) => wired.sendSceneText(msg, lang, text),
      }).then((told) => (told ? 'ceiling.hard-limit' : null)),
    send: (_msg, text) => {
      delivered.push(text);
      return Promise.resolve();
    },
  });
  setActiveIntents(['PUBLISH', 'UNPUBLISH', 'STATUS', 'HELP', 'SEARCH', 'UNDO', 'RESTORE', 'PRICE', 'LOOKUP']);
  setIntentResolver({
    name: 'always-unknown',
    resolve: () => Promise.resolve({ intent: 'UNKNOWN', confidence: 0.1, slots: {}, lang: 'en' } as never),
  });
  await wired.handle(message('Cinderella, show me the Book of Elii', 'dave'));
  check(
    'END TO END: the scene reaches the outbound the engine archives through',
    delivered.length === 1 && lawsIn(delivered[0] ?? '').length === 1,
    delivered.length === 1 ? pageLine(delivered[0]) : `${String(delivered.length)} message(s)`,
  );
  check(
    'exactly ONE message left, so the scene did not also get an ordinary reply after it',
    delivered.length === 1,
    String(delivered.length),
  );
  check(
    'and nothing went down the recital port',
    composed.portSent.length === 0,
    String(composed.portSent.length),
  );

  /**
   * MUTATION: the shape production actually shipped. The scene renders, the transport accepts
   * it, `tellBookScene` reports success, and NOTHING reaches the engine's outbound. If the
   * end-to-end check above cannot tell that apart from working, it is worth nothing.
   */
  const broken = sceneHarness();
  delivered.length = 0;
  const brokenEngine = new InteractionEngine({
    db,
    settings: () => normalizeInteraction({ ...DEFAULT_INTERACTION }),
    rules: () => RULES,
    personality: () => ({ ...DEFAULT_PERSONALITY }),
    personalize: () => Promise.resolve(null),
    tellBook: (msg, lang, previousLawId) =>
      tellBookScene({ ...broken.deps, db }, msg, lang, {
        previousLawId,
        openingChars: sceneOpeningChars(5),
        closingChars: sceneClosingChars(5),
        // The old wiring: out through the recital port, which nothing archives.
        send: async (text) => {
          await broken.deps.send()?.sendText(1, text);
          return true;
        },
      }).then((told) => (told ? 'ceiling.hard-limit' : null)),
    send: (_msg, text) => {
      delivered.push(text);
      return Promise.resolve();
    },
  });
  await brokenEngine.handle(message('Cinderella, show me the Book of Elii', 'erin'));
  check(
    'MUTATION: sending down the recital port instead reaches the outbound with NOTHING',
    delivered.length === 0 && broken.portSent.length === 1,
    `outbound ${String(delivered.length)}, port ${String(broken.portSent.length)}`,
  );
  resetIntentResolver();

  /* ── 3. The numbering ───────────────────────────────────────────────────── */

  console.log('\n3. The laws have numbers, and only the ones she can show');

  const pages = lawPages(RULES);
  const total = numberedLawCount(RULES);
  check('every nameable enabled law has a page', pages.size === total, String(total));
  check(
    'and no withheld law has one, which is the whole reason it is not the full set',
    RULES.filter((r) => r.enabled && !r.nameable).every((r) => !pages.has(r.id)),
  );
  check(
    'nor does a disabled one',
    RULES.filter((r) => !r.enabled).every((r) => !pages.has(r.id)),
  );
  check(
    'the numbering is by id, so editing text or reordering the prompt cannot move it',
    numberedLaws(RULES).every((rule, i) => i === 0 || (numberedLaws(RULES)[i - 1]?.id ?? '') < rule.id),
  );
  check(
    'MUTATION: a reordered prompt gives the SAME numbers',
    (() => {
      const reordered = RULES.map((r) => ({ ...r, ord: 1000 - r.ord })).reverse();
      return numberedLaws(reordered).map((r) => r.id).join(',') === numberedLaws(RULES).map((r) => r.id).join(',');
    })(),
  );
  check(
    'MUTATION: a REWORDED law keeps its number',
    (() => {
      const reworded = RULES.map((r) =>
        r.id === 'ceiling.hard-limit' ? { ...r, text: 'Something else entirely.' } : r,
      );
      return lawNumberOf(reworded, 'ceiling.hard-limit') === lawNumberOf(RULES, 'ceiling.hard-limit');
    })(),
  );

  check('law 1 is a real law', lawByNumber(RULES, 1) !== null, lawByNumber(RULES, 1)?.id ?? '');
  check('and the last one is too', lawByNumber(RULES, total) !== null);
  check('one past the end is nothing', lawByNumber(RULES, total + 1) === null);
  check('and so are zero and a negative', lawByNumber(RULES, 0) === null && lawByNumber(RULES, -3) === null);
  check(
    'every number maps to a law she may name, so no number can reach a withheld one',
    Array.from({ length: total }, (_, i) => lawByNumber(RULES, i + 1)).every(
      (rule) => rule?.nameable === true && rule.enabled,
    ),
  );

  for (const [q, n] of [
    ['what is law 12?', 12],
    ['read me law number 3', 3],
    ['rule 7 please', 7],
    ['was steht in Gesetz 40?', 40],
    ['Regel 5', 5],
    ['open the book at number 9', 9],
  ] as [string, number][]) {
    check(`"${q}" asks for law ${String(n)}`, asksForLawNumber(q) === n, String(asksForLawNumber(q)));
  }
  for (const q of [
    'what is 12 plus 3?',
    'BTC is at 90000',
    'I have 12 apples',
    'what are your rules?',
    'see you at 7',
  ]) {
    check(`"${q}" is NOT a page number`, asksForLawNumber(q) === null, String(asksForLawNumber(q)));
  }

  const one = lawByNumber(RULES, 12);
  check(
    'a page prints its own number and its own law, in one block',
    renderBookPage({ number: 12, total, law: 'X', german: false }) === '📜 *Law 12 of 67*\n> X'.replace('67', String(total)),
    renderBookPage({ number: 12, total, law: 'X', german: false }).split('\n')[0] ?? '',
  );
  check(
    'and the German page line is German',
    renderBookPage({ number: 12, total, law: 'X', german: true }).startsWith('📜 *Gesetz 12 von'),
  );
  check('page 12 is a real law', one !== null, one?.id ?? '(none)');

  check(
    'the rules that hand a page over live in the registry, not in the code',
    ['disclosure.page-handed-over', 'disclosure.page-unseen'].every((id) =>
      RULES.some((r) => r.id === id && r.enabled && r.critical),
    ),
  );
  check(
    'and they apply only when a page is being printed',
    RULES.filter((r) => r.id.startsWith('disclosure.page-')).every(
      (r) => r.appliesWhen === 'has-law-page',
    ),
  );

  /* ── 4. The conversation: the invitation, and what it does not swallow ──── */

  console.log('\n4. The invitation is heard; an ordinary question is not');

  for (const q of [
    'tell me another',
    'what else is in there?',
    'read me another one',
    'one more',
    'go on',
    'noch eins',
    'was noch?',
  ]) {
    check(`"${q}" takes up the invitation`, asksForAnotherLaw(q), q);
  }
  for (const q of [
    'what is the weather like?',
    'how are you?',
    'what time is it?',
    'can you publish my messages?',
    'what is bitcoin at?',
  ]) {
    check(`"${q}" does NOT`, !asksForAnotherLaw(q), q);
  }

  setActiveIntents(['PUBLISH', 'UNPUBLISH', 'STATUS', 'HELP', 'SEARCH', 'UNDO', 'RESTORE', 'PRICE', 'LOOKUP']);

  const requests: AiReplyRequest[] = [];
  const sent: string[] = [];
  const sceneLaw: string | null = 'ceiling.hard-limit';
  const engine = new InteractionEngine({
    db,
    settings: () => normalizeInteraction({ ...DEFAULT_INTERACTION }),
    rules: () => RULES,
    personality: () => ({ ...DEFAULT_PERSONALITY }),
    // The model gives NOTHING, all the way through this section. That is deliberate: the page
    // is the application's to print, so it must go out whether or not she found words for it,
    // and a harness where the model spoke could not tell the two apart.
    personalize: (req) => {
      requests.push(req);
      return Promise.resolve(null);
    },
    // The real engine, with the scene service stubbed to the one fact the engine consumes.
    tellBook: () => Promise.resolve(sceneLaw),
    send: (_msg, text) => {
      sent.push(text);
      return Promise.resolve();
    },
  });

  setIntentResolver({
    name: 'always-unknown',
    resolve: () => Promise.resolve({ intent: 'UNKNOWN', confidence: 0.1, slots: {}, lang: 'en' } as never),
  });

  const drive = async (text: string, memberId = 'alice'): Promise<AiReplyRequest | undefined> => {
    requests.length = 0;
    sent.length = 0;
    await engine.handle(message(`Cinderella, ${text}`, memberId));
    return requests[requests.length - 1];
  };

  // CONTROL FIRST: with no scene behind it, "tell me another" is nothing in particular. If
  // this already reached the Book, every check below would pass for the wrong reason.
  const cold = await drive('tell me another', 'bob');
  check(
    'CONTROL: with no scene behind it, "tell me another" quotes nothing',
    (cold?.nameableRules?.length ?? 0) === 0,
    String(cold?.nameableRules?.length ?? 0),
  );

  await drive('show me the Book of Elii');
  check('the scene was performed', sceneLaw !== null);

  const after = await drive('tell me another');
  check(
    'and then "tell me another" reaches the Book, as a PAGE',
    after?.lawPage === true,
    String(after?.lawPage),
  );
  check(
    'and she is handed NO law to quote, so she cannot misnumber one',
    (after?.nameableRules?.length ?? 0) === 0,
    String(after?.nameableRules?.length ?? 0),
  );
  /**
   * ── THE PAGE TURN, WHICH WAS A CORRECTION ──────────────────────────────────
   *
   * The first build let this go through the ordinary keyword selector and it came back with
   * `disclosure.more-in-area`, a rule about how she answers rules questions, on the strength
   * of containing the word "another". Every check passed. A bare "another" carries no subject
   * to select on, and the book has page numbers, so it is the next page.
   */
  check(
    'and the page she gets is the NEXT one, not a keyword match',
    sent.some((text) =>
      text.includes(
        `Law ${String(lawNumberOf(RULES, nextLawAfter(RULES, 'ceiling.hard-limit')?.id ?? '') ?? 0)} of`,
      ),
    ),
    pageLine(sent.at(-1)),
  );
  check(
    'printed by the APPLICATION, verbatim, under her words',
    sent.some((text) =>
      text.includes(renderPromptRule(nextLawAfter(RULES, 'ceiling.hard-limit') as PromptRule, VALUES)),
    ),
  );

  await drive('and another');
  check(
    'asking again turns one more page rather than repeating',
    sent.some((text) =>
      text.includes(
        `Law ${String(
          lawNumberOf(
            RULES,
            nextLawAfter(RULES, nextLawAfter(RULES, 'ceiling.hard-limit')?.id ?? null)?.id ?? '',
          ) ?? 0,
        )} of`,
      ),
    ),
    pageLine(sent.at(-1)),
  );

  const ordinary = await drive('what is the weather like today?');
  check(
    'an ordinary question shortly after a scene is an ordinary question',
    (ordinary?.nameableRules?.length ?? 0) === 0 &&
      ordinary?.ruleOverview === undefined &&
      ordinary?.lawPage !== true,
    String(ordinary?.nameableRules?.length ?? 0),
  );

  const byNumber = await drive('what is law 12?');
  check('asked for a page, the prompt says a page is being printed', byNumber?.lawPage === true);
  check(
    'and page 12 is what goes out, whole and numbered',
    sent.some(
      (text) =>
        text.includes('Law 12 of') &&
        text.includes(renderPromptRule(lawByNumber(RULES, 12) as PromptRule, VALUES)),
    ),
    pageLine(sent.at(-1)),
  );
  /**
   * ── WHY SHE IS HANDED NEITHER, WHICH WAS A CORRECTION ──────────────────────
   *
   * The first build handed her the law and its page number and asked her to quote both.
   * Against `qwen3:32b` that produced the right law under the wrong number, the wrong law
   * under a number she was given, and a law she had never been shown, over four turns. So the
   * page travels to the model as a BOOLEAN and nothing else: there is no field on the request
   * that could carry a number for her to attach to the wrong sentence.
   *
   * The registry is of course still in her prompt, because that is what a prompt is. What is
   * absent is any statement of which rule this answer is about.
   */
  check(
    'MUTATION: the number and the law cannot come apart, because she is handed neither',
    (byNumber?.nameableRules?.length ?? 0) === 0 &&
      byNumber?.lawPage === true &&
      !Object.keys(byNumber).some((key) => /number|page/i.test(key) && key !== 'lawPage'),
    Object.keys(byNumber ?? {}).filter((k) => /law|page|number/i.test(k)).join(', '),
  );

  const missed: string[] = [];
  const deterministic = new InteractionEngine({
    db,
    settings: () => normalizeInteraction({ ...DEFAULT_INTERACTION }),
    rules: () => RULES,
    personality: () => ({ ...DEFAULT_PERSONALITY }),
    personalize: () => Promise.resolve(null),
    send: (_msg, text) => {
      missed.push(text);
      return Promise.resolve();
    },
  });
  await deterministic.handle(message(`Cinderella, what is law ${String(total + 40)}?`, 'carol'));
  const miss = missed.join('\n');
  check(
    'a page she has none for is answered by the APPLICATION, honestly',
    miss.includes(String(total + 40)) && miss.includes(String(total)),
    miss.replace(/\s+/g, ' ').slice(0, 120),
  );
  check('and nothing that looks like a law is read out', lawsIn(miss).length === 0);

  resetIntentResolver();

  /* ── 5. The record, and what it refuses to say (CCB-S4-050) ─────────────── */

  console.log('\n5. The record: only what a gate actually decided');

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

  /* ── 6. The settings ────────────────────────────────────────────────────── */

  console.log('\n6. Operator controls, with stated defaults');

  const s = normalizeInteraction({ ...DEFAULT_INTERACTION });
  check('the scene is on by default', s.bookScene.enabled);
  check('the record is on by default', s.invocationRecord.enabled);
  check('with 90 day retention', s.invocationRecord.retentionDays === 90);
  check(
    'the scene can be switched off, and then the Book falls back to the overview',
    normalizeInteraction({ ...DEFAULT_INTERACTION, bookScene: { enabled: false } }).bookScene
      .enabled === false,
  );
  /**
   * THE RENAME MUST NOT SWITCH A FEATURE BACK ON. An operator who had turned CCB-S4-050's
   * story off has that decision stored under `bookStory`, and a rename that ignored it would
   * start performing in a group where somebody had said no.
   */
  check(
    'and a deployment that switched the OLD setting off stays off through the rename',
    normalizeInteraction({
      ...DEFAULT_INTERACTION,
      bookScene: undefined,
      bookStory: { enabled: false, maxBeats: 3 },
    } as never).bookScene.enabled === false,
  );
  check(
    'the record can be switched off',
    normalizeInteraction({
      ...DEFAULT_INTERACTION,
      invocationRecord: { enabled: false, retentionDays: 90 },
    }).invocationRecord.enabled === false,
  );
  check(
    'and its bound is clamped in code, not only in the form',
    normalizeInteraction({
      ...DEFAULT_INTERACTION,
      invocationRecord: { enabled: true, retentionDays: 99_999 },
    }).invocationRecord.retentionDays === 3650,
  );

  console.log(failures === 0 ? '\nAll book-scene checks passed.' : `\n${failures} check(s) FAILED.`);
  process.exit(failures === 0 ? 0 : 1);
}

await main();
