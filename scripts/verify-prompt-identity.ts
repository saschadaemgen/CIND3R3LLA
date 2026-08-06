/**
 * The prompt baseline: what she is told today, byte for byte (CCB-S4-039).
 *
 * ── WHY THIS EXISTS BEFORE THE RULE REGISTRY AND NOT AFTER ───────────────────
 *
 * CCB-S4-039 moves every hardcoded rule out of `personality.ts` and
 * `ollama-reply.ts` and into a database registry, and its one binding constraint is that
 * the assembled prompt must not change by a single character. "We moved the rules and
 * nothing changed" is unfalsifiable unless something recorded what the prompt WAS before
 * anybody touched it.
 *
 * So this is the recording. It renders every lane in a matrix of configurations, hashes
 * each one, and compares against a committed fixture. Captured from the pre-registry code,
 * it is the specification the registry has to reproduce; captured afterwards it would only
 * be a photograph of whatever the move happened to produce.
 *
 * ── WHAT IT GUARDS, WHICH IS MORE THAN ONE BRIEFING ──────────────────────────
 *
 * Nothing about it is specific to the registry. Any change to any prompt line, from any
 * briefing, fails this check and prints which lane and which line moved. That is the point:
 * the prompt is the product's behaviour, and until now the only thing standing between an
 * accidental edit and production was whether somebody happened to assert on that sentence.
 *
 * A DELIBERATE prompt change is expected to fail this and is re-baselined on purpose:
 *
 *   npm run verify:prompt-identity -- --update
 *
 * That command is the review gate. The diff it produces in `prompt-baseline.json` is the
 * exact change to what the model is told, in a reviewable form, which is a better artefact
 * than the code diff for that one question.
 *
 *   npx tsx scripts/verify-prompt-identity.ts
 */

import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { systemPrompt, type AiReplyMode, type AiReplyRequest } from '../src/interaction/ollama-reply.js';
import {
  DEFAULT_ORIGIN,
  DEFAULT_PERSONALITY,
  replyCharBudget,
  type BotPersonality,
  type CurrentTime,
} from '../src/interaction/personality.js';

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
}

/**
 * The matrix the briefing asks for, plus the branches the code actually has.
 *
 * Every lane, and for the conversation lane every configuration that selects a different
 * branch in `conversationVoice`: with and without an origin, with and without a base
 * character, with and without a name, with and without a clock, with no personality at
 * all, and both ends of the dials. Those are not stylistic variations, they are the
 * conditions the registry will have to express as `condition` values, so each one has to
 * be pinned before the move.
 */
const CASES: Case[] = [
  { id: 'conversation.full', mode: 'conversation', personality: personality(), identity: IDENTITY_FULL, now: NOW },
  { id: 'conversation.no-origin', mode: 'conversation', personality: personality({ origin: '' }), identity: IDENTITY_FULL, now: NOW },
  { id: 'conversation.no-character', mode: 'conversation', personality: personality({ baseCharacter: '' }), identity: IDENTITY_FULL, now: NOW },
  { id: 'conversation.no-origin-no-character', mode: 'conversation', personality: personality({ origin: '', baseCharacter: '' }), identity: IDENTITY_FULL, now: NOW },
  { id: 'conversation.no-personality', mode: 'conversation', personality: null, identity: IDENTITY_FULL, now: NOW },
  { id: 'conversation.no-name', mode: 'conversation', personality: personality(), identity: { name: '' } as never, now: NOW },
  { id: 'conversation.name-only', mode: 'conversation', personality: personality(), identity: { name: 'CIND3R3LLA' }, now: NOW },
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

function render(testCase: Case): string {
  const request: AiReplyRequest = {
    kind: 'conversation',
    lang: 'en',
    memberMessage: 'MEMBER MESSAGE',
    deterministicDraft: 'DETERMINISTIC DRAFT',
    mode: testCase.mode,
    requiredLiterals: [],
    blockedLiterals: ['Alice'],
    personality: testCase.personality,
    ...(testCase.identity ? { identity: testCase.identity } : {}),
    ...(testCase.now ? { now: testCase.now } : {}),
    ...(testCase.webResults ? { webResults: testCase.webResults } : {}),
  };
  // The output bound is derived from the dial, so it is passed explicitly rather than left
  // to a default that would make the fixture depend on the transport's arithmetic.
  return systemPrompt(request, replyCharBudget(testCase.personality?.verbosity ?? 5));
}

function digest(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex').slice(0, 16);
}

interface Baseline {
  note: string;
  cases: Record<string, { hash: string; lines: number; chars: number; prompt: string }>;
}

function capture(): Baseline {
  const cases: Baseline['cases'] = {};
  for (const testCase of CASES) {
    const prompt = render(testCase);
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

function main(): void {
  const update = process.argv.includes('--update');
  const current = capture();

  if (update || !existsSync(FIXTURE)) {
    mkdirSync(dirname(FIXTURE), { recursive: true });
    writeFileSync(FIXTURE, `${JSON.stringify(current, null, 2)}\n`);
    console.log(
      existsSync(FIXTURE) && !update
        ? `\nNo baseline existed. Wrote ${Object.keys(current.cases).length} cases to ${FIXTURE}.`
        : `\nRe-baselined ${Object.keys(current.cases).length} cases. Review the diff to ${FIXTURE}.`,
    );
    return;
  }

  const saved = JSON.parse(readFileSync(FIXTURE, 'utf8')) as Baseline;

  console.log('\nThe prompt is byte for byte what it was');

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

  console.log(
    failures === 0
      ? `\nAll ${savedIds.length} prompt cases are byte identical to the baseline.`
      : `\n${failures} prompt case(s) DIFFER from the baseline. If that was deliberate, ` +
        `re-baseline with: npm run verify:prompt-identity -- --update`,
  );
  process.exit(failures === 0 ? 0 : 1);
}

main();
