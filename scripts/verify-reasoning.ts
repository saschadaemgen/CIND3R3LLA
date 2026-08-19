/**
 * How hard she thinks before she speaks (CCB-S4-052, D-154).
 *
 * The display ships whether or not a control does, so what is asserted is that the display
 * tells the truth: the value it names is the value the application actually sends, and the
 * figures it quotes are the ones that were measured.
 *
 * Mutation-proven, because a page that reports a hidden state is only worth having if it
 * cannot report the wrong one.
 *
 *   npx tsx scripts/verify-reasoning.ts
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  CONTEXT_MEASUREMENTS,
  REASONING_EFFORT_SENT,
  REASONING_MEASUREMENTS,
  REASONING_SOURCE,
  SERVED_CONTEXT_TOKENS,
} from '../src/interaction/reasoning.js';
import { setLogLevel } from '../src/log.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

let failures = 0;
function check(label: string, ok: boolean, detail = ''): void {
  if (!ok) failures++;
  console.log(`  [${ok ? 'PASS' : 'FAIL'}] ${label}${detail ? `: ${detail}` : ''}`);
}

function main(): void {
  setLogLevel('error');

  /* ── 1. The display names what is actually sent ─────────────────────────── */

  console.log('\n1. What the page says is what the request carries');

  const transport = readFileSync(join(ROOT, 'src', 'interaction', 'ollama-reply.ts'), 'utf8');
  const sent = /reasoning_effort:\s*'([a-z]+)'/.exec(transport)?.[1];
  check('the transport sends a reasoning setting at all', sent !== undefined, sent ?? '(none)');
  check(
    'and the constant the console displays is that exact value',
    sent === REASONING_EFFORT_SENT,
    `transport="${sent ?? ''}" console="${REASONING_EFFORT_SENT}"`,
  );

  // MUTATION. The whole point of the display is that it cannot drift from the code; this is
  // the check that would go red if somebody changed one and not the other.
  check(
    'MUTATION: a different value in the transport would be caught',
    'low' !== REASONING_EFFORT_SENT,
  );
  check(
    'the source is stated as the application rather than the model',
    REASONING_SOURCE.includes('application') && REASONING_SOURCE.includes('every request'),
    REASONING_SOURCE,
  );

  /* ── 2. The measurement it quotes ───────────────────────────────────────── */

  console.log('\n2. The figures are the measured ones, and they say what they mean');

  const shipped = REASONING_MEASUREMENTS.find((m) => m.label.startsWith('none'));
  check('the setting she runs on is in the table', shipped !== undefined);
  check('with no reasoning', shipped?.reasoningChars === 0);
  check('and nothing unusable', shipped?.unusableOfFive === 0);

  const thinking = REASONING_MEASUREMENTS.filter((m) => m.reasoningChars > 0);
  check('every level that thinks is recorded', thinking.length >= 3, String(thinking.length));
  check(
    'and every one of them loses replies, which is why no dial shipped',
    thinking.every((m) => m.unusableOfFive > 0),
    thinking.map((m) => `${m.label}=${String(m.unusableOfFive)}/5`).join(' '),
  );
  check(
    'thinking costs several times the latency, so the trade is visible rather than implied',
    thinking.every((m) => m.latencyMs > (shipped?.latencyMs ?? 0) * 3),
  );

  // The levels are NOT a gradient, which is the finding that killed the per-kind control as a
  // useful shape even before the truncation did.
  const byLevel = REASONING_MEASUREMENTS.filter((m) => m.label === 'low' || m.label === 'high');
  check(
    'and the levels do not form a gradient, so there was never a depth dial to offer',
    byLevel.length === 2 && byLevel[0]!.reasoningChars > byLevel[1]!.reasoningChars,
    byLevel.map((m) => `${m.label}=${String(m.reasoningChars)}`).join(' '),
  );

  /* ── 3. The context figures, reported and not applied ───────────────────── */

  console.log('\n3. The context measurement, per model, which now decides the served window');

  // EVERY ROW IS NOW ADDRESSED BY MODEL AS WELL AS BY WINDOW (CCB-S5-045, D-231). These
  // assertions used to `find` on numCtx alone, which was unambiguous only while every row was
  // qwen3:32b. With qwen3:14b measured at the same windows, `find(c => c.numCtx === 32768)`
  // would return whichever row came first and the spill assertion would silently start
  // testing a different model - the exact confusion that let a fact about one model's KV
  // cache be read as a fact about the window for a whole season.
  const spilled = CONTEXT_MEASUREMENTS.find((c) => c.model === 'qwen3:32b' && c.numCtx === 32768);
  check('the 32B still records its spill at 32768', (spilled?.cpuGb ?? 0) > 1, `${String(spilled?.cpuGb)} GB`);
  check(
    'the one that could not be loaded is reported as unmeasured, not estimated',
    CONTEXT_MEASUREMENTS.some((c) => c.totalGb === null && c.note.includes('not measured')),
  );

  // THE POSITIVE CONTROL THIS TABLE EXISTS FOR. "The 32B spills" passes against a table that
  // records nothing else, and the decision that matters is that the SERVED model does not.
  const servedRows = CONTEXT_MEASUREMENTS.filter((c) => c.model === 'qwen3:14b');
  check('the served model is measured at more than one window', servedRows.length >= 4);
  check(
    'and it spills at NO measured window, including the one the host serves',
    servedRows.length > 0 && servedRows.every((c) => c.cpuGb === 0),
  );
  const served = servedRows.find((c) => c.numCtx === SERVED_CONTEXT_TOKENS);
  check(
    'the window the host serves is one of the measured rows, not an untested number',
    served !== undefined,
    served ? `${String(served.totalGb)} GB fully in VRAM` : 'no row for the served window',
  );

  // STILL ASSERTED, FOR A DIFFERENT REASON THAN WHEN IT WAS WRITTEN. It used to mean "the
  // report changed no setting". It now means: setting num_ctx here would do NOTHING while
  // looking exactly as though it had, because /v1/chat/completions ignores it - verified by
  // sending num_ctx 24576 and watching the model load at 8192. Removing this check would
  // erase the record of that, and the next person would add a num_ctx and believe it worked.
  check(
    'nothing in the codebase sets num_ctx, because the transport would silently ignore it',
    !readFileSync(join(ROOT, 'src', 'interaction', 'ollama-reply.ts'), 'utf8').includes('num_ctx') &&
      !readFileSync(join(ROOT, 'src', 'config.ts'), 'utf8').includes('num_ctx'),
  );

  /* ── 4. The page actually shows it ──────────────────────────────────────── */

  console.log('\n4. It reaches the console');

  const view = readFileSync(join(ROOT, 'src', 'web', 'views', 'ai.ts'), 'utf8');
  check('the card exists', view.includes('function reasoningCard()'));
  check('and is rendered on the Models page', view.includes('${reasoningCard()}'));
  check('it says reasoning is off', view.includes('reasoning <strong>off</strong>'));
  check('it says the value is not the runtime default', view.includes("not the runtime's default"));
  check('it explains why there is no dial', view.includes('Why there is no dial'));
  // CHANGED DELIBERATELY (CCB-S5-045, D-231). It asserted the page said "deliberately not
  // applied", which was true while the context was a number nobody had moved. The window IS
  // applied now, so keeping that assertion would have forced the page to keep a false
  // sentence in order to stay green - a check holding copy in place after the copy stopped
  // being true. What the page must now say is where the setting actually lives, since it is
  // not this application.
  check('and it names the served window', view.includes('SERVED_CONTEXT_TOKENS'));
  check(
    'and says where that setting lives, because it is not this application',
    view.includes('OLLAMA_CONTEXT_LENGTH'),
  );
  check('and it tells the two models apart in the table', view.includes('<th>Model</th>'));

  console.log(
    failures === 0 ? '\nAll reasoning checks passed.' : `\n${failures} check(s) FAILED.`,
  );
  process.exit(failures === 0 ? 0 : 1);
}

main();
