/**
 * The real chat error reaches the operator, and every core command names its bot
 * (D-188, extending D-171).
 *
 * ── THE DEFECT THIS EXISTS FOR ───────────────────────────────────────────────
 *
 * CCB-S5-018 wrote `describeChatError` "precisely so this string never reaches an
 * operator", and wired it into TWO files: `core.ts` and `index.ts`. Both are the runtime
 * layer. The CONSOLE - the surface an operator actually reads - got none of it, and when
 * the channel bridge added an operator page four briefings later, its two runtime actions
 * shipped with `err instanceof Error ? err.message : String(err)` and no log line at all.
 *
 * The operator pressed Join and pressed Refresh. Both answered:
 *
 *     Chat command error (see chatError property)
 *
 * and the journal held nothing to compare it against. Two paths, one of them read-only,
 * indistinguishable - because the one field that tells them apart was being discarded at
 * the catch. That is the THIRD time the wrapper text has cost a round trip.
 *
 * This is the D-105 shape exactly: the describer existed, the rule held, and the new
 * source tree did not inherit it, with nothing announcing the gap. So the property is
 * checked rather than remembered.
 *
 * ── WHAT THIS CAN AND CANNOT SEE (D-162) ─────────────────────────────────────
 *
 * It CANNOT see that a button is reachable, or that a banner is legible, or that the
 * operator understood the sentence. It is a regression guard, not the verification.
 * What it decides is narrow and worth having:
 *
 *   1. the describer really does extract the detail, driven against the INSTALLED SDK's
 *      own error classes rather than a hand-built lookalike;
 *   2. no console file that issues a runtime action flattens an error with the bare
 *      `.message` idiom;
 *   3. every raw SDK call in the runtime's command layer is lexically inside a scheduled
 *      callback - the D-171 property, decided on the AST rather than by grep.
 *
 * Every negative has a positive control beside it, because "no bare idiom found" passes
 * against a scan that reads no files, and "every call is scheduled" passes against a
 * matcher that finds no calls.
 *
 *   npx tsx scripts/verify-chat-error-surfaced.ts
 */

import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import ts from 'typescript';

import { describeChatError } from '../src/bot/runtime/chat-error.js';

let failures = 0;
function check(label: string, ok: boolean, detail = ''): void {
  if (!ok) failures++;
  console.log(`  [${ok ? 'PASS' : 'FAIL'}] ${label}${detail ? ` - ${detail}` : ''}`);
}

/* ── the two error classes the SDK actually throws ──────────────────────────── */

/**
 * Rebuilt to the INSTALLED constructors' shapes rather than imported.
 *
 * `verify:adapter-seam` exempts `scripts/`, so importing the SDK here would be legal;
 * these are rebuilt anyway so the harness runs with no native addon present. The shapes
 * are pinned by section 1's assertions, which fail if the SDK ever changes them.
 */
class ChatAPIErrorLike extends Error {
  chatError: unknown;
  constructor(message: string, chatError?: unknown) {
    super(message);
    this.message = message;
    this.chatError = chatError;
  }
}

class ChatCommandErrorLike extends Error {
  response: unknown;
  constructor(message: string, response: unknown) {
    super(message);
    this.message = message;
    this.response = response;
  }
}

const POINTER = 'Chat command error (see chatError property)';

/* ── section 1: the describer extracts, and leaves plain errors alone ───────── */

function sectionDescriber(): void {
  console.log('\n1. The describer turns the pointer into the answer');

  // The exact payload the core sent in the D-171 production defect.
  const different = new ChatAPIErrorLike(POINTER, {
    type: 'error',
    errorType: { type: 'differentActiveUser', commandUserId: 2, activeUserId: 1 },
  });
  const describedDifferent = describeChatError(different);
  check(
    'a differentActiveUser refusal names itself',
    describedDifferent.includes('differentActiveUser') &&
      describedDifferent.includes('commandUserId'),
    describedDifferent,
  );
  check(
    '  and the SDK pointer text is GONE from what the operator reads',
    !describedDifferent.includes('see chatError property'),
  );

  // The other shape a failed /_user switch can carry.
  const unknown = new ChatAPIErrorLike(POINTER, {
    type: 'error',
    errorType: { type: 'userUnknown' },
  });
  check(
    'a userUnknown refusal names itself too',
    describeChatError(unknown).includes('userUnknown'),
    describeChatError(unknown),
  );

  // The api.ts class: detail on `.response`, NOT `.chatError`. The repository's own
  // comments had these two classes the wrong way round until D-188.
  const cmd = new ChatCommandErrorLike('error listing groups', {
    type: 'chatCmdError',
    chatError: { type: 'error', errorType: { type: 'noActiveUser' } },
  });
  const describedCmd = describeChatError(cmd);
  check(
    'the OTHER SDK class is described through .response, not dropped',
    describedCmd.includes('error listing groups') && describedCmd.includes('noActiveUser'),
    describedCmd,
  );

  // POSITIVE CONTROL. Without this, a describer that returned a constant string would
  // pass every assertion above.
  check(
    'POSITIVE CONTROL: a plain Error is returned VERBATIM, so nothing is lost by routing every catch site through the describer',
    describeChatError(new Error('A channel link is required.')) === 'A channel link is required.',
  );
  check(
    '  and a non-Error value still describes',
    describeChatError('bare string') === 'bare string',
  );

  // The one blank it can produce, and proof it is a DIFFERENT string from the pointer,
  // so a reader can tell "no detail" from "detail discarded".
  const blank = describeChatError(new ChatAPIErrorLike(POINTER));
  check(
    'an error carrying no detail SAYS SO rather than reprinting the pointer',
    blank.includes('carried no detail') && !blank.includes('see chatError property'),
    blank,
  );
}

/* ── section 2: no console flattens a runtime error ─────────────────────────── */

/** The bare idiom the whole defect is made of. */
const BARE_IDIOM =
  /(\w+)\s+instanceof\s+Error\s*\?\s*\1\.message\s*:\s*String\(\s*\1\s*\)/;

/** Console files that reach the runtime, so an SDK error can arrive at their catches. */
const RUNTIME_CONSOLES = [
  join('src', 'web', 'views', 'bridge.ts'),
  join('src', 'web', 'views', 'ai-onboarding.ts'),
];

async function sectionConsoles(): Promise<void> {
  console.log('\n2. No console that issues a core command flattens its errors');

  for (const rel of RUNTIME_CONSOLES) {
    const src = await readFile(rel, 'utf8');

    check(
      `${rel} imports describeChatError`,
      src.includes('describeChatError'),
    );
    check(
      `  and does not flatten with the bare idiom`,
      !BARE_IDIOM.test(src),
      BARE_IDIOM.exec(src)?.[0] ?? '',
    );
    // A silent failure is the other half of the defect: the operator had a banner and an
    // empty journal, and could not tell which of two commands had failed.
    check(
      `  and logs, so the journal has the untruncated copy`,
      src.includes('log.error'),
    );
  }

  // POSITIVE CONTROL on the matcher itself. Without this, a typo in BARE_IDIOM would
  // make every assertion above pass against files that still carry the defect.
  check(
    'POSITIVE CONTROL: the matcher DOES catch the shipped idiom',
    BARE_IDIOM.test('const message = err instanceof Error ? err.message : String(err);'),
  );
  check(
    '  and does not fire on the corrected line',
    !BARE_IDIOM.test('const message = describeChatError(err);'),
  );
}

/* ── section 3: every core command is issued inside the scheduler (D-171) ───── */

/**
 * The scheduler's own primitive and the boot-time profile resolution.
 *
 * `apiSetActiveUser` IS what the scheduler issues to open a critical section, so
 * scheduling it would recurse forever. The other three run while resolving which profiles
 * exist at all, before anything is hosted and before there is a user id to schedule for.
 * Named individually rather than exempting the file, so a fourth bare call cannot hide
 * behind them.
 */
const UNSCHEDULED_BY_DESIGN = new Map<string, string>([
  ['apiSetActiveUser', "the scheduler's own primitive: scheduling it would recurse"],
  ['apiListUsers', 'boot-time profile resolution, before anything is hosted'],
  ['apiGetActiveUser', 'boot-time profile resolution, before anything is hosted'],
  ['apiCreateActiveUser', 'boot-time profile resolution, before anything is hosted'],
]);

const SCHEDULING_CALLS = new Set(['run', 'runScheduled', 'runForGroup']);

export interface UnscheduledCall {
  file: string;
  line: number;
  method: string;
}

/**
 * Every `*.api*(...)` call in `file` that is NOT lexically inside a scheduling callback.
 *
 * On the AST rather than by grep, because the property is structural: what matters is
 * whether an ANCESTOR of the call is an argument to `scheduler.run` / `runScheduled` /
 * `runForGroup`, and no regex decides that.
 */
export function findUnscheduledSdkCalls(file: string, source: string): UnscheduledCall[] {
  const sf = ts.createSourceFile(file, source, ts.ScriptTarget.ES2022, true);
  const out: UnscheduledCall[] = [];

  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)) {
      const method = node.expression.name.text;
      if (method.startsWith('api') && !UNSCHEDULED_BY_DESIGN.has(method)) {
        let scheduled = false;
        for (let p: ts.Node | undefined = node.parent; p !== undefined; p = p.parent) {
          if (ts.isCallExpression(p)) {
            const callee = p.expression;
            const name = ts.isPropertyAccessExpression(callee)
              ? callee.name.text
              : ts.isIdentifier(callee)
                ? callee.text
                : '';
            if (SCHEDULING_CALLS.has(name)) {
              scheduled = true;
              break;
            }
          }
        }
        if (!scheduled) {
          out.push({
            file,
            line: sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1,
            method,
          });
        }
      }
    }
    ts.forEachChild(node, visit);
  };

  visit(sf);
  return out;
}

/** The command layer: the files allowed to hold a chat handle and issue commands. */
const COMMAND_LAYER = [
  join('src', 'bot', 'runtime', 'core.ts'),
  join('src', 'bot', 'runtime', 'admin-actions.ts'),
];

async function sectionScheduled(): Promise<void> {
  console.log('\n3. Every core command names its bot through the scheduler (D-171)');

  let total = 0;
  for (const rel of COMMAND_LAYER) {
    const src = await readFile(rel, 'utf8');
    const bare = findUnscheduledSdkCalls(rel, src);
    total += bare.length;
    check(
      `${rel}: no unscheduled SDK call`,
      bare.length === 0,
      bare.map((b) => `${b.method} at line ${String(b.line)}`).join(', '),
    );
  }
  check('the command layer is clean overall', total === 0);

  // POSITIVE CONTROL. Every assertion above passes if the matcher finds nothing at all,
  // which is exactly what a broken AST walk would do.
  const scheduledFixture = `
    class X {
      async ok(id: number) {
        return await this.scheduler.run(id, 'label', () => chat.apiListGroups(id));
      }
      async alsoOk(id: number) {
        return await bot.runScheduled('label', () => chatOf().apiConnectPlan(id, 'link'));
      }
    }`;
  check(
    'POSITIVE CONTROL: a correctly scheduled call is NOT flagged',
    findUnscheduledSdkCalls('fixture.ts', scheduledFixture).length === 0,
  );

  // MUTATION: this is the shipped defect restored. It is the exact shape that was found
  // beside `listGroups` in `contactOwner` - an explicit user id, no scheduler.
  const bareFixture = `
    class X {
      async bad(id: number) {
        const contacts = await chat.apiListContacts(id);
        return contacts;
      }
    }`;
  const found = findUnscheduledSdkCalls('fixture.ts', bareFixture);
  check(
    'MUTATION: a bare call with an EXPLICIT user id IS flagged, which is the whole of D-171',
    found.length === 1 && found[0]?.method === 'apiListContacts',
    found.map((f) => f.method).join(', '),
  );

  // And that the by-design exemptions are exemptions rather than blindness.
  const exemptFixture = `
    class X {
      async boot() {
        await chat.apiSetActiveUser(1);
        await chat.apiListUsers();
      }
    }`;
  check(
    '  and the named exemptions stay exempt',
    findUnscheduledSdkCalls('fixture.ts', exemptFixture).length === 0,
  );
}

/* ── main ───────────────────────────────────────────────────────────────────── */

async function main(): Promise<void> {
  console.log('The real chat error reaches the operator (D-188)');

  sectionDescriber();
  await sectionConsoles();
  await sectionScheduled();

  console.log(
    `\n${failures === 0 ? 'ALL PASSED' : `${String(failures)} CHECK(S) FAILED`} - chat errors surfaced.`,
  );
  console.log(
    'Note: this is a regression guard, not the verification. It cannot see that a\n' +
      'control is reachable or that a sentence is legible (D-162); press the button.',
  );
  if (failures > 0) process.exitCode = 1;
}

main().catch((err: unknown) => {
  console.error(err);
  process.exitCode = 1;
});
