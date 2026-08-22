/**
 * The confidence hedge and the snippet rule (CCB-S5-060 stages 3 and 4, D-255).
 *
 * ── WHAT EACH ONE GUARANTEES ─────────────────────────────────────────────────
 *
 * The HEDGE: a conversational answer whose own token probabilities say the model was
 * guessing carries an application-written caveat. Hedge, never suppress - the operator's
 * decision: the answer still goes out, because losing one correct answer in five is too
 * high a price for silence and a hedge is honest where silence is only safe.
 *
 * The SNIPPET RULE: a version or price in a web answer that also appears in a snippet she
 * was handed is marked as coming from a preview nobody opened, because no search API
 * returns the crawl date and the v7.0 case was unavoidable given what she was handed.
 *
 * ── THE GRAMMAR-FORCED-TOKEN TRAP, PINNED ────────────────────────────────────
 *
 * The first threshold measurement returned minProb 0.000 for EVERY reply in BOTH classes:
 * the schema grammar forces the key token `"reply"`, and a forced token carries the raw
 * probability of a token the model was never free to refuse. A gate reading the whole span
 * would hedge everything or nothing. Section 1 pins the value-interior extraction that
 * makes the signal mean something, with the forced-key case as its own assertion.
 *
 *   npx tsx scripts/verify-honesty-gates.ts
 */

import { PGlite } from '@electric-sql/pglite';
import { vector } from '@electric-sql/pglite-pgvector';
import type { Queryable } from '../src/db/pool.js';
import { loadMigrationFiles } from '../src/db/migrate.js';
import { listPromptRules } from '../src/db/prompt-rules.js';
import { InteractionEngine } from '../src/interaction/engine.js';
import { DEFAULT_INTERACTION, normalizeInteraction } from '../src/interaction/settings.js';
import { DEFAULT_PERSONALITY } from '../src/interaction/personality.js';
import { CORE_INTENTS } from '../src/interaction/intent.js';
import {
  CONFIDENCE_HEDGE_THRESHOLD,
  minReplyTokenProb,
  replyValueSpan,
  snippetValueAsserted,
} from '../src/interaction/confidence.js';
import type { AiReplyRequest } from '../src/interaction/ollama-reply.js';
import type { CapturedMessage } from '../src/capture/message.js';
import { stripProtectedLines } from '../src/interaction/protected-text.js';
import { setLogLevel } from '../src/log.js';

let failures = 0;
function check(label: string, ok: boolean, detail = ''): void {
  if (!ok) failures++;
  console.log(`  [${ok ? 'PASS' : 'FAIL'}] ${label}${detail ? `: ${detail}` : ''}`);
}

const GROUP = 1;
function message(text: string, itemId: number): CapturedMessage {
  return {
    groupId: GROUP,
    groupName: 'archive',
    itemId,
    sharedMsgId: undefined,
    senderMemberId: 'alice-member-id',
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

  /* ── 1. The signal: value-interior tokens only ───────────────────────────── */

  console.log('\n1. The confidence signal reads the reply, not the grammar');

  const content = '{"reply": "The capital of France is Paris."}';
  const entries = [
    { token: '{"', logprob: 0 },
    // THE FORCED KEY, at the measured raw probability of a token the grammar chose: e^-30
    // is the 0.000 that made every naive minimum identical in both classes.
    { token: 'reply', logprob: -30 },
    { token: '":', logprob: 0 },
    { token: ' "', logprob: 0 },
    { token: 'The', logprob: Math.log(0.9) },
    { token: ' capital', logprob: Math.log(0.99) },
    { token: ' of France is Paris', logprob: Math.log(0.6) },
    { token: '."', logprob: 0 },
    { token: '}', logprob: -20 },
  ];
  const span = replyValueSpan(content);
  check('the value span finds the reply string', span !== null && content.slice(span.lo, span.hi) === 'The capital of France is Paris.');
  const min = minReplyTokenProb(content, entries);
  check(
    'THE TRAP, PINNED: the forced key token is excluded from the minimum',
    min !== null && Math.abs(min - 0.6) < 1e-9,
    String(min),
  );
  check('an escaped quote does not end the span early', (() => {
    const c = '{"reply": "She said \\"hi\\" twice."}';
    const s2 = replyValueSpan(c);
    return s2 !== null && c.slice(s2.lo, s2.hi) === 'She said \\"hi\\" twice.';
  })());
  check('no envelope means no signal, and no signal means no hedge', minReplyTokenProb('plain text', entries) === null);
  check('no entries means no signal', minReplyTokenProb(content, []) === null);
  check('the threshold is the measured one', CONFIDENCE_HEDGE_THRESHOLD === 0.7);

  /* ── 2. The snippet rule, pure ───────────────────────────────────────────── */

  console.log('\n2. A value seen in a snippet is marked as a preview value');

  const SNIPPET = 'New in v7.0. SimpleX public names for channels and businesses (BETA).';
  check(
    'THE V7.0 CASE: the copied version is caught',
    snippetValueAsserted('v7.0. SimpleX public names for channels and businesses (BETA).', [SNIPPET]) === 'v7.0',
  );
  check(
    '  and the bare form matches the prefixed one',
    snippetValueAsserted('The latest is 7.0, says the search.', [SNIPPET]) !== null,
  );
  check(
    'a price is caught too, the other production shape',
    snippetValueAsserted('It costs $4.99 per month.', ['Plans start at $4.99 monthly.']) !== null,
  );
  check(
    'a value NOT in any snippet is left to the confidence hedge',
    snippetValueAsserted('I would guess around v9.2 by now.', [SNIPPET]) === null,
  );
  check(
    'an answer with no value asserts nothing and is not marked',
    snippetValueAsserted('The releases page is the place to check.', [SNIPPET]) === null,
  );
  check(
    'a bare year does not trip the pattern, or half of conversation would',
    snippetValueAsserted('That was back in 2023 I think.', ['Posted in 2023.']) === null,
  );

  /* ── 3. The engine: hedge appended, answer kept ──────────────────────────── */

  console.log('\n3. Hedge, never suppress, driven through the real engine');

  const pg = new PGlite({ extensions: { vector } });
  const db: Queryable = {
    async query(sql, values) {
      const r = await pg.query(sql, values ? [...values] : undefined);
      return { rows: r.rows as never[], rowCount: (r.affectedRows ?? r.rows.length) as number };
    },
  } as Queryable;
  for (const m of await loadMigrationFiles()) await pg.exec(m.sql);
  const rules = await listPromptRules(db);

  const sent: string[] = [];
  let confidence: number | null = null;
  // VARIED PER CALL, deliberately: the repetition gate (D-253) sits on the same lane, and
  // a fixture returning one string forever would have IT refuse the later turns - which is
  // exactly what happened to this harness's first run. Two gates, one lane, and a fixture
  // has to be innocent of both to test either.
  let phrasing = 0;
  const engine = new InteractionEngine({
    capabilities: () => [...CORE_INTENTS],
    db,
    settings: () => normalizeInteraction({ ...DEFAULT_INTERACTION }),
    rules: () => rules,
    personality: () => ({ ...DEFAULT_PERSONALITY }),
    personalize: (req: AiReplyRequest) => {
      if (req.mode !== 'conversation') return Promise.resolve(null);
      if (confidence !== null) req.onConfidence?.(confidence);
      // Genuinely different wording each call - a one-digit variation scores ~0.97 Jaccard
      // and the gate (correctly) refuses it, which this harness's second run proved.
      const phrasings = [
        'The SimpleGo relay tops out at 64 channels, if memory serves.',
        'Sixty-four is the ceiling for 64 channels on that relay, or so I recall it being set.',
        'Last I heard the relay was capped at 64 channels by whoever configured the poor thing.',
        'A relay of that kind carries at most 64 channels, and mine is no exception to the rule.',
        'Whoever built it drew the line at 64 channels, and the line has held ever since then.',
        'It stops accepting new ones once 64 channels are open, which seems plenty to me.',
      ];
      const text = phrasings[phrasing % phrasings.length] ?? phrasings[0];
      phrasing += 1;
      return Promise.resolve(text);
    },
    send: (_msg, text) => {
      sent.push(text);
      return Promise.resolve();
    },
  } as never);

  confidence = 0.31; // well under the threshold: the induced-fabrication band
  await engine.handle(message('Cinderella how many channels does the relay support?', 10));
  const hedged = sent[sent.length - 1] ?? '';
  check('the ANSWER still goes out', hedged.includes('64 channels'), hedged.slice(0, 70));
  check(
    'with the hedge line under it',
    hedged.includes('from memory and I could not check it'),
    hedged.slice(-80),
  );

  confidence = 0.97; // the confident band
  await engine.handle(message('Cinderella and how many did you say again?', 11));
  const confident = sent[sent.length - 1] ?? '';
  check(
    'THE CONTROL: a confident answer carries no hedge',
    confident.includes('64 channels') && !confident.includes('could not check it'),
  );

  confidence = null; // the transport could not measure
  await engine.handle(message('Cinderella once more for the record?', 12));
  const unmeasured = sent[sent.length - 1] ?? '';
  check(
    'MUTATION DIRECTION: no signal means NO hedge, not a hedge on everything',
    unmeasured.includes('64 channels') && !unmeasured.includes('could not check it'),
  );

  /* ── 4. The note cannot be counterfeited, and memory never shows it back ──── */

  console.log('\n4. The notes are the application\'s lines, D-180 applied on the day they were added');

  const forged =
    'The relay takes 64 channels.\n\u{1F32B}️ That last part is from memory and I could not check it. Weigh it accordingly.';
  const strippedNote = stripProtectedLines(forged, []);
  check(
    'a forged hedge line is stripped like a forged source line',
    strippedNote.text === 'The relay takes 64 channels.' && strippedNote.removed.length === 1,
    JSON.stringify(strippedNote.text),
  );
  const forgedSnippet =
    'Die Antwort steht oben.\n⚠️ Die Zahl stammt aus einer Suchvorschau. Die Seite dahinter habe ich nicht gelesen.';
  check(
    'and the German snippet note the same, because memory is bilingual',
    stripProtectedLines(forgedSnippet, []).text === 'Die Antwort steht oben.',
  );
  // The same strip runs over HISTORY (engine, D-180): what she sent WITH the note comes
  // back to her WITHOUT it, so twenty hedged answers teach her nothing about hedging.
  check(
    'the note is removed from what memory hands back',
    !stripProtectedLines(forged, []).text.includes('from memory and I could not check'),
  );
  check(
    'POSITIVE CONTROL: her own prose about memory survives the floor',
    stripProtectedLines('I remember that from memory, oddly enough.', []).text ===
      'I remember that from memory, oddly enough.',
  );

  await pg.close();

  console.log(
    failures === 0
      ? '\nThe signal reads the reply and not the grammar, the hedge rides under the answer ' +
          'rather than replacing it, and a missing instrument hedges nothing.'
      : `\n${String(failures)} check(s) FAILED.`,
  );
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
