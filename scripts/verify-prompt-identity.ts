/**
 * The prompt baseline: what she is told, byte for byte (CCB-S4-039).
 *
 * ── WHY THIS EXISTED BEFORE THE RULE REGISTRY AND NOT AFTER ──────────────────
 *
 * CCB-S4-039 moved every hardcoded rule out of `personality.ts` and `ollama-reply.ts` and
 * into a database registry, and its one binding constraint was that the assembled prompt
 * must not change by a single character. "We moved the rules and nothing changed" is
 * unfalsifiable unless something recorded what the prompt WAS before anybody touched it.
 *
 * So `scripts/fixtures/prompt-baseline.json` is that recording, committed one commit before
 * the move, captured from the pre-registry code. It is the SPECIFICATION the registry has to
 * reproduce. Captured afterwards it would only be a photograph of whatever the move happened
 * to produce, which is why it was taken first and why it must not be re-baselined to make
 * this briefing pass.
 *
 * ── WHAT IT GUARDS, WHICH IS MORE THAN ONE BRIEFING ──────────────────────────
 *
 * Nothing about it is specific to the registry. Any change to any prompt line, from any
 * briefing or from any edit to a rule, fails this check and prints which lane and which line
 * moved. That is the point: the prompt is the product's behaviour, and until this existed
 * the only thing standing between an accidental edit and production was whether somebody
 * happened to assert on that sentence.
 *
 * A DELIBERATE prompt change is expected to fail this and is re-baselined on purpose:
 *
 *   npm run verify:prompt-identity -- --update
 *
 * That command is the review gate. The diff it produces in `prompt-baseline.json` is the
 * exact change to what the model is told, in a reviewable form, which is a better artefact
 * than the code diff for that one question.
 *
 * ── AND THE TWO THINGS IT PROVES ABOUT ITSELF ────────────────────────────────
 *
 * A check that cannot fail is not a check. Section 3 mutates the registry in memory, one
 * rule's text and then two rules' order, and asserts the comparison goes red both times.
 * Section 2 asserts every rule marked `critical` actually reaches the prompt in a lane and
 * condition that selects it, and section 3 proves that one can fail too, by disabling a
 * constitutional rule and confirming it is caught.
 *
 *   npx tsx scripts/verify-prompt-identity.ts
 */

import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  HISTORY_FENCE,
  SEARCH_FENCE,
  systemPrompt,
  type AiReplyMode,
  type AiReplyRequest,
} from '../src/interaction/ollama-reply.js';
import {
  DEFAULT_ORIGIN,
  DEFAULT_PERSONALITY,
  dialledPromptInputs,
  replyCharBudget,
  type BotPersonality,
  type CurrentTime,
} from '../src/interaction/personality.js';
import {
  NOTHING_IN_SCOPE,
  PROMPT_RULE_TIERS,
  lanesForMode,
  renderPromptRule,
  selectPromptRules,
  type PromptRule,
  type PromptRuleContext,
  type PromptRuleSet,
} from '../src/interaction/prompt-rules.js';
import { seededPromptRules } from './seeded-rules.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const FIXTURE = join(ROOT, 'scripts', 'fixtures', 'prompt-baseline.json');

let failures = 0;
function check(label: string, ok: boolean, detail = ''): void {
  if (!ok) failures++;
  console.log(`  [${ok ? 'PASS' : 'FAIL'}] ${label}${detail ? `: ${detail}` : ''}`);
}

/**
 * Everything variable is PINNED.
 *
 * The clock, the zone, the name, the URLs, the dial values and both text fields. A baseline
 * that moved with the wall clock or the host's timezone would fail every day for reasons
 * that have nothing to do with the prompt, and a check that fails for the wrong reason
 * gets ignored, which is worse than not having it.
 */
const NOW: CurrentTime = { at: new Date('2026-08-05T12:00:00.000Z'), timeZone: 'UTC' };

const IDENTITY_FULL = {
  name: 'CIND3R3LLA',
  label: '(SimpleX AI Bot)',
  archiveUrl: 'https://archive.example.org',
  projectUrl: 'https://project.example.org',
  notMyNames: ['Cindy', 'Ella'],
  // The model she is ACTUALLY running (CCB-S4-042). Present on the full identity because it
  // is present in production: a runtime that is up always has a reply model selected.
  // `conversation.no-model` pins the other branch.
  model: 'qwen3:32b',
};

const CHARACTER = 'A neon courier who reads the wire faster than anyone in the room.';

function personality(over: Partial<BotPersonality> = {}): BotPersonality {
  return {
    ...DEFAULT_PERSONALITY,
    baseCharacter: CHARACTER,
    origin: DEFAULT_ORIGIN,
    sharpness: 5,
    warmth: 5,
    humor: 5,
    verbosity: 5,
    permissiveness: 5,
    ...over,
  };
}

interface Case {
  /** Stable id. Reordering the list must not rename a case in the fixture. */
  id: string;
  mode: AiReplyMode;
  personality: BotPersonality | null;
  identity?: typeof IDENTITY_FULL | { name: string } | undefined;
  now?: CurrentTime | undefined;
  webResults?: { title: string; snippet: string; url: string }[];
  history?: { speaker: string; text: string }[];
  historyWindowMinutes?: number;
  nameableRules?: PromptRule[];
  hasWithheldRules?: boolean;
  ruleOverview?: { total: number; constitutional: number; areas: string };
  moreInArea?: number;
  ruleInvocations?: string;
}

/**
 * A short remembered thread, for the cases that pin the `has-history` branch (CCB-S4-044).
 *
 * Deliberately includes one of HER OWN lines, marked `You`, because that is the half of the
 * feature that lets her follow her own thread and it must be visible in the baseline.
 */
const HISTORY = [
  { speaker: 'Alice', text: 'what does this group actually archive?' },
  { speaker: 'You', text: 'Only what you tell me to. Nothing before you say the word.' },
  { speaker: 'Bob', text: 'and can I take it back afterwards?' },
];

/**
 * The matrix the briefing asks for, plus the branches the code actually has.
 *
 * Every lane, and for the conversation lane every configuration that selects a different
 * branch: with and without an origin, with and without a base character, with and without a
 * name, with and without a clock, with no personality at all, and both ends of the dials.
 * Those are not stylistic variations, they are the conditions the registry expresses as
 * `applies_when` values, and every one of them was pinned before the move.
 */
/**
 * The rules the disclosure case quotes.
 *
 * Fixed here rather than selected from the registry, because this file pins PROMPT SHAPE: a
 * rule edit that changed what `rulesForQuestion` happens to return would otherwise move this
 * baseline for a reason that has nothing to do with the prompt. What is pinned is that a quoted
 * block renders, with its placeholders filled, in the right place. One of them carries a
 * placeholder on purpose: quoting `rule.text` raw once put the literal `{{name}}` in front of a
 * member, and this is the case that would catch that coming back.
 */
const QUOTED: PromptRule[] = [
  {
    id: 'fixture.ceiling',
    tier: 'constitutional',
    lane: 'dialled',
    appliesWhen: 'has-nameable-rules',
    ord: 1,
    text: 'Never write explicit sexual content.',
    enabled: true,
    critical: false,
    nameable: true,
    scope: null,
    source: 'scripts/verify-prompt-identity.ts',
  },
  {
    id: 'fixture.name',
    tier: 'constitutional',
    lane: 'dialled',
    appliesWhen: 'has-nameable-rules',
    ord: 2,
    text: 'Your name is {{name}}, and it is the only name you answer to.',
    enabled: true,
    critical: false,
    nameable: true,
    scope: null,
    source: 'scripts/verify-prompt-identity.ts',
  },
];

const CASES: Case[] = [
  { id: 'conversation.full', mode: 'conversation', personality: personality(), identity: IDENTITY_FULL, now: NOW },
  { id: 'conversation.no-origin', mode: 'conversation', personality: personality({ origin: '' }), identity: IDENTITY_FULL, now: NOW },
  { id: 'conversation.no-character', mode: 'conversation', personality: personality({ baseCharacter: '' }), identity: IDENTITY_FULL, now: NOW },
  { id: 'conversation.no-origin-no-character', mode: 'conversation', personality: personality({ origin: '', baseCharacter: '' }), identity: IDENTITY_FULL, now: NOW },
  { id: 'conversation.no-personality', mode: 'conversation', personality: null, identity: IDENTITY_FULL, now: NOW },
  { id: 'conversation.no-name', mode: 'conversation', personality: personality(), identity: { name: '' } as never, now: NOW },
  { id: 'conversation.name-only', mode: 'conversation', personality: personality(), identity: { name: 'CIND3R3LLA' }, now: NOW },
  { id: 'conversation.no-model', mode: 'conversation', personality: personality(), identity: { ...IDENTITY_FULL, model: '' }, now: NOW },
  { id: 'conversation.with-history', mode: 'conversation', personality: personality(), identity: IDENTITY_FULL, now: NOW, history: HISTORY, historyWindowMinutes: 30 },
  { id: 'retort.with-history', mode: 'retort', personality: personality(), identity: IDENTITY_FULL, now: NOW, history: HISTORY, historyWindowMinutes: 30 },
  { id: 'free.with-history', mode: 'free', personality: personality(), identity: IDENTITY_FULL, now: NOW, history: HISTORY, historyWindowMinutes: 30 },
  { id: 'conversation.rules-question', mode: 'conversation', personality: personality(), identity: IDENTITY_FULL, now: NOW, nameableRules: QUOTED, hasWithheldRules: true },
  // CCB-S4-048. The two shapes the conversational Book takes: the orientation, which quotes
  // nothing and states counts the model must not touch, and a follow-up whose cap bound.
  { id: 'conversation.rule-overview', mode: 'conversation', personality: personality(), identity: IDENTITY_FULL, now: NOW, hasWithheldRules: true, ruleOverview: { total: 93, constitutional: 45, areas: 'who I am, what I will never do and what I keep back' } },
  { id: 'conversation.follow-up-capped', mode: 'conversation', personality: personality(), identity: IDENTITY_FULL, now: NOW, nameableRules: QUOTED, hasWithheldRules: true, moreInArea: 7 },
  // CCB-S4-050. What the record says about the rules she is quoting.
  { id: 'conversation.with-invocations', mode: 'conversation', personality: personality(), identity: IDENTITY_FULL, now: NOW, nameableRules: QUOTED, hasWithheldRules: true, ruleInvocations: '"ceiling.never-explicit" applied 3 times, last on 2026-08-05' },
  { id: 'conversation.no-clock', mode: 'conversation', personality: personality(), identity: IDENTITY_FULL, now: undefined },
  { id: 'conversation.dials-low', mode: 'conversation', personality: personality({ sharpness: 1, warmth: 1, humor: 1, verbosity: 1, permissiveness: 1 }), identity: IDENTITY_FULL, now: NOW },
  { id: 'conversation.dials-high', mode: 'conversation', personality: personality({ sharpness: 10, warmth: 10, humor: 10, verbosity: 10, permissiveness: 10 }), identity: IDENTITY_FULL, now: NOW },
  { id: 'retort.full', mode: 'retort', personality: personality(), identity: IDENTITY_FULL, now: NOW },
  { id: 'retort.dials-high', mode: 'retort', personality: personality({ sharpness: 10, verbosity: 10 }), identity: IDENTITY_FULL, now: NOW },
  { id: 'searching.full', mode: 'searching', personality: personality(), identity: IDENTITY_FULL, now: NOW },
  { id: 'free.command-rewrite', mode: 'free', personality: personality(), identity: IDENTITY_FULL, now: NOW },
  { id: 'locked.command-lead', mode: 'locked', personality: personality(), identity: IDENTITY_FULL, now: NOW },
  {
    id: 'lookup.with-web-results',
    mode: 'conversation',
    personality: personality(),
    identity: IDENTITY_FULL,
    now: NOW,
    webResults: [
      { title: 'A page', snippet: 'Some text from the web.', url: 'https://example.org/a' },
    ],
  },
];

/** The output bound this case's dial earns, which is also what the length rule interpolates. */
function maxCharsFor(testCase: Case): number {
  return replyCharBudget(testCase.personality?.verbosity ?? 5);
}

function render(testCase: Case, rules: PromptRuleSet): string {
  const request: AiReplyRequest = {
    kind: 'conversation',
    lang: 'en',
    memberMessage: 'MEMBER MESSAGE',
    deterministicDraft: 'DETERMINISTIC DRAFT',
    mode: testCase.mode,
    rules,
    requiredLiterals: [],
    blockedLiterals: ['Alice'],
    personality: testCase.personality,
    ...(testCase.identity ? { identity: testCase.identity } : {}),
    ...(testCase.now ? { now: testCase.now } : {}),
    ...(testCase.webResults ? { webResults: testCase.webResults } : {}),
    ...(testCase.history ? { history: testCase.history } : {}),
    ...(testCase.nameableRules ? { nameableRules: testCase.nameableRules } : {}),
    ...(testCase.hasWithheldRules !== undefined ? { hasWithheldRules: testCase.hasWithheldRules } : {}),
    ...(testCase.ruleOverview ? { ruleOverview: testCase.ruleOverview } : {}),
    ...(testCase.moreInArea !== undefined ? { moreInArea: testCase.moreInArea } : {}),
    ...(testCase.ruleInvocations ? { ruleInvocations: testCase.ruleInvocations } : {}),
    ...(testCase.historyWindowMinutes !== undefined
      ? { historyWindowMinutes: testCase.historyWindowMinutes }
      : {}),
  };
  // The output bound is derived from the dial, so it is passed explicitly rather than left
  // to a default that would make the fixture depend on the transport's arithmetic.
  return systemPrompt(request, maxCharsFor(testCase));
}

/**
 * The selection a case produces, through the SAME exported derivation the prompt builder
 * uses.
 *
 * Deliberately not a second implementation of "which conditions hold". A check that decided
 * for itself which rules a case selects would be asserting on its own model of the
 * assembler, which is exactly the failure D-111 records: the verifier and the implementation
 * disagreeing, and the working code being changed to satisfy the broken test.
 */
function selectionFor(
  testCase: Case,
  rules: PromptRuleSet,
): { rules: PromptRule[]; values: Record<string, string> } {
  const dialled =
    testCase.mode === 'conversation' ||
    testCase.mode === 'retort' ||
    testCase.mode === 'searching';
  const base = dialled
    ? dialledPromptInputs(rules, testCase.personality, testCase.identity, testCase.now)
    : { context: NOTHING_IN_SCOPE, values: {} as Record<string, string> };

  const context: PromptRuleContext = {
    ...base.context,
    hasWebResults: (testCase.webResults?.length ?? 0) > 0,
    hasHistory: (testCase.history?.length ?? 0) > 0,
    hasNameableRules: (testCase.nameableRules?.length ?? 0) > 0,
    hasWithheldRules: testCase.hasWithheldRules === true,
    hasRuleOverview: testCase.ruleOverview !== undefined,
    hasMoreInArea: (testCase.moreInArea ?? 0) > 0,
    hasInvocationRecord: (testCase.ruleInvocations ?? '').length > 0,
  };
  const values: Record<string, string> = {
    ...base.values,
    maxChars: String(maxCharsFor(testCase)),
    fence: SEARCH_FENCE,
    historyFence: HISTORY_FENCE,
    historyCount: String(testCase.history?.length ?? 0),
    historyMinutes: String(testCase.historyWindowMinutes ?? 0),
    ruleTotal: String(testCase.ruleOverview?.total ?? 0),
    ruleConstitutional: String(testCase.ruleOverview?.constitutional ?? 0),
    ruleAreas: testCase.ruleOverview?.areas ?? '',
    moreInArea: String(testCase.moreInArea ?? 0),
    ruleInvocations: testCase.ruleInvocations ?? '',
    nameableRules: (testCase.nameableRules ?? [])
      .map((rule) => `\n- ${renderPromptRule(rule, base.values)}`)
      .join(''),
  };

  return { rules: selectPromptRules(rules, lanesForMode(testCase.mode), context), values };
}

function digest(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex').slice(0, 16);
}

interface Baseline {
  note: string;
  cases: Record<string, { hash: string; lines: number; chars: number; prompt: string }>;
}

function capture(rules: PromptRuleSet): Baseline {
  const cases: Baseline['cases'] = {};
  for (const testCase of CASES) {
    const prompt = render(testCase, rules);
    cases[testCase.id] = {
      hash: digest(prompt),
      lines: prompt.split('\n').length,
      chars: prompt.length,
      // The full text is stored, not only the hash. A hash tells you something changed; the
      // text tells you WHAT, and the reviewable diff is the whole reason to commit this.
      prompt,
    };
  }
  return {
    note:
      'Captured from the code, not written by hand. Every string here is what the model is ' +
      'actually told. A failing verify:prompt-identity means a prompt line moved; if the ' +
      'change was deliberate, re-baseline with `npm run verify:prompt-identity -- --update` ' +
      'and review the diff to this file as the record of what she is now told.',
    cases,
  };
}

/** How many recorded cases the given rules fail to reproduce. Silent; used by the mutations. */
function driftCount(rules: PromptRuleSet, saved: Baseline): number {
  let drifted = 0;
  for (const testCase of CASES) {
    const was = saved.cases[testCase.id];
    if (!was) continue;
    let prompt: string;
    try {
      prompt = render(testCase, rules);
    } catch {
      // A mutation that makes the prompt unbuildable has certainly changed it.
      drifted++;
      continue;
    }
    if (digest(prompt) !== was.hash) drifted++;
  }
  return drifted;
}

/**
 * Every critical rule reaches a prompt that should carry it.
 *
 * Returns the ids it could NOT account for, so the mutation proof can assert this reports
 * something rather than merely that it ran.
 *
 * A rule is checked against a case that actually SELECTS it, which is why the selection
 * comes from the assembler rather than from a guess: a critical rule nothing in the matrix
 * exercises is itself a finding, because there is then no evidence it ever reaches a model.
 */
function unpresentCriticalRules(rules: PromptRuleSet): string[] {
  const missing: string[] = [];

  for (const rule of rules.filter((candidate) => candidate.critical)) {
    let proven = false;
    let exercised = false;

    for (const testCase of CASES) {
      const selection = selectionFor(testCase, rules);
      if (!selection.rules.some((selected) => selected.id === rule.id)) continue;
      exercised = true;
      if (render(testCase, rules).includes(renderPromptRule(rule, selection.values))) {
        proven = true;
        break;
      }
    }

    if (!proven) missing.push(exercised ? `${rule.id} (selected, absent)` : `${rule.id} (never selected)`);
  }

  return missing;
}

function main(): void {
  void run();
}

async function run(): Promise<void> {
  const rules = await seededPromptRules();
  const update = process.argv.includes('--update');
  const current = capture(rules);

  if (update || !existsSync(FIXTURE)) {
    const existed = existsSync(FIXTURE);
    mkdirSync(dirname(FIXTURE), { recursive: true });
    writeFileSync(FIXTURE, `${JSON.stringify(current, null, 2)}\n`);
    console.log(
      existed
        ? `\nRe-baselined ${Object.keys(current.cases).length} cases. Review the diff to ${FIXTURE}.`
        : `\nNo baseline existed. Wrote ${Object.keys(current.cases).length} cases to ${FIXTURE}.`,
    );
    return;
  }

  const saved = JSON.parse(readFileSync(FIXTURE, 'utf8')) as Baseline;

  /* ── 1. The prompt the registry assembles is the prompt that shipped ─────── */

  console.log('\n1. The prompt is byte for byte what it was');
  const byTier = PROMPT_RULE_TIERS.map(
    (tier) => `${rules.filter((rule) => rule.tier === tier).length} ${tier}`,
  ).join(', ');
  console.log(`   (${rules.length} rules from the seeded registry: ${byTier})`);

  const savedIds = Object.keys(saved.cases);
  const liveIds = Object.keys(current.cases);
  check(
    'every recorded case is still rendered',
    savedIds.every((id) => liveIds.includes(id)),
    savedIds.filter((id) => !liveIds.includes(id)).join(', ') || '',
  );
  check(
    'and no case appeared without being recorded',
    liveIds.every((id) => savedIds.includes(id)),
    liveIds.filter((id) => !savedIds.includes(id)).join(', ') || '',
  );

  for (const id of savedIds) {
    const was = saved.cases[id];
    const now = current.cases[id];
    if (!was || !now) continue;

    if (was.hash === now.hash) {
      check(`${id} is unchanged`, true, `${now.lines} lines, ${now.chars} chars`);
      continue;
    }

    // WHICH LINE, not just that something moved. A check that says "the prompt changed"
    // sends somebody to diff two thousand characters by eye.
    const before = was.prompt.split('\n');
    const after = now.prompt.split('\n');
    const firstDiff = before.findIndex((line, i) => line !== after[i]);
    check(
      `${id} is unchanged`,
      false,
      `line ${firstDiff + 1}: was "${(before[firstDiff] ?? '(absent)').slice(0, 70)}" now "${(after[firstDiff] ?? '(absent)').slice(0, 70)}"`,
    );
  }

  /* ── 2. Nothing marked critical went missing ─────────────────────────────── */

  console.log('\n2. Every critical rule reaches the model');

  const criticalRules = rules.filter((rule) => rule.critical);
  const constitutional = rules.filter((rule) => rule.tier === 'constitutional');
  const missing = unpresentCriticalRules(rules);

  check(
    'the registry marks the safety, privacy and honesty rules constitutional',
    constitutional.length > 0,
    `${constitutional.length} of ${rules.length}`,
  );
  check(
    'every constitutional rule is also critical, so none can vanish quietly',
    constitutional.every((rule) => rule.critical),
    constitutional
      .filter((rule) => !rule.critical)
      .map((rule) => rule.id)
      .join(', '),
  );
  check(
    'every critical rule reaches a prompt in a lane and condition that selects it',
    missing.length === 0,
    missing.join(', ') || `${criticalRules.length} checked`,
  );
  check(
    'the permissiveness ceiling is among them',
    criticalRules.filter((rule) => rule.id.startsWith('ceiling.')).length === 4,
  );

  /**
   * The em-dash rule now has a new place to be broken (D-105).
   *
   * `verify:no-dashes` scans FILES for member-facing output, and by the scope settled under
   * CCB-S3-043 that is output only: rule text is not output, it is what the model reads. So
   * that check is correctly not extended to the migration, whose surrounding prose may use
   * dashes like every other document here.
   *
   * The rule TEXT is a different matter, and it is asserted here instead, on the rows rather
   * than on the file. She is instructed never to write an em dash; handing her one inside
   * that same prompt is a contradiction, and it is the kind that stays invisible because the
   * output filter in `cleanReply` would quietly clean up after it.
   */
  const dashed = rules.filter((rule) => /[–—―]/.test(rule.text));
  check(
    'no rule hands her a dash she is told never to write',
    dashed.length === 0,
    dashed.map((rule) => rule.id).join(', '),
  );
  check(
    'every rule has a distinct id, so history and the console can address one',
    new Set(rules.map((rule) => rule.id)).size === rules.length,
  );
  check(
    'nothing is scoped yet, and the field is carried unused as the briefing asked',
    rules.every((rule) => rule.scope === null),
  );

  /* ── 3. Both checks above can fail ───────────────────────────────────────── */

  console.log('\n3. The proof that this can go red');

  // A rule's TEXT. One word, in one sentence, in one of forty-odd rules.
  const textMutation = rules.map((rule) =>
    rule.id === 'ceiling.never-explicit'
      ? { ...rule, text: rule.text.replace('Never write', 'Never ever write') }
      : rule,
  );
  check(
    'changing one word of one rule fails the comparison',
    driftCount(textMutation, saved) > 0,
    `${driftCount(textMutation, saved)} case(s) went red`,
  );

  // A rule's ORDER. The text is untouched; only two lines swap places, which is the failure
  // a hash-only check would catch and a "does the prompt contain X" check would not.
  //
  // THE PAIR IS ASSERTED TO EXIST FIRST, and that is not defensive noise: this mutation used
  // to name `grounding.no-memory` and `grounding.no-memory-answer`, CCB-S4-044 deleted both,
  // and the swap silently became a no-op that reported "0 cases went red". A mutation proof
  // that quietly stops mutating is worse than no mutation proof, because it still prints a
  // reassuring line. Two rules that vanish now fail here instead.
  const first = rules.find((rule) => rule.id === 'ceiling.hard-limit');
  const second = rules.find((rule) => rule.id === 'ceiling.never-explicit');
  check(
    'the two rules the order mutation swaps still exist',
    first !== undefined && second !== undefined && first.ord !== second.ord,
  );
  const orderMutation = rules.map((rule) =>
    rule.id === first?.id
      ? { ...rule, ord: second?.ord ?? rule.ord }
      : rule.id === second?.id
        ? { ...rule, ord: first?.ord ?? rule.ord }
        : rule,
  );
  check(
    'swapping the order of two rules fails the comparison, with no text changed',
    driftCount(orderMutation, saved) > 0,
    `${driftCount(orderMutation, saved)} case(s) went red`,
  );

  // A DISABLED critical rule. This is the mutation the console in the next briefing makes
  // possible with one click, which is why the guard has to work before that click exists.
  const disabled = rules.map((rule) =>
    rule.id === 'ceiling.never-minors' ? { ...rule, enabled: false } : rule,
  );
  const caught = unpresentCriticalRules(disabled);
  check(
    'disabling a constitutional rule is caught by the presence check',
    caught.some((entry) => entry.startsWith('ceiling.never-minors')),
    caught.join(', ') || 'nothing was reported',
  );
  check(
    'and it fails the byte comparison too, so neither guard carries it alone',
    driftCount(disabled, saved) > 0,
    `${driftCount(disabled, saved)} case(s) went red`,
  );

  // An EMPTY registry does not degrade into a shorter prompt.
  let refused = false;
  try {
    render(CASES[0]!, []);
  } catch {
    refused = true;
  }
  check('an empty registry refuses to build a prompt rather than building a bare one', refused);

  console.log(
    failures === 0
      ? `\nAll ${savedIds.length} prompt cases are byte identical to the baseline, ` +
        `${criticalRules.length} critical rules are present, and 5 mutations were caught.`
      : `\n${failures} check(s) FAILED. If a prompt change was deliberate, ` +
        `re-baseline with: npm run verify:prompt-identity -- --update`,
  );
  process.exit(failures === 0 ? 0 : 1);
}

main();
