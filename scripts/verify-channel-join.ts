/**
 * The channel join, and the one rule that makes it safe (CCB-S5-038, D-197).
 *
 * ── WHY THIS EXISTS ──────────────────────────────────────────────────────────
 *
 * `apiConnect` is the wrong command for a channel link and the core says so by name. The
 * right one is not in the SDK at 6.5.4 or 7.0.0, but it is in the core:
 *
 *     /_prepare group      -> APIPrepareGroup
 *     /_connect group #    -> APIConnectPreparedGroup
 *
 * ── THE LOAD-BEARING RULE ────────────────────────────────────────────────────
 *
 * `/_connect group #<n>` acts on whatever group `n` names. An `n` from the wrong place joins
 * the wrong real room and the console cannot undo it. So the id comes from the PREPARE
 * response and from nowhere else - never the connect plan, never `apiListGroups`.
 *
 * That is what is asserted here: `preparedGroupIdOf` reads an id when the core gives one and
 * returns NULL for everything else, so an unexpected answer becomes a refusal rather than a
 * number. Every negative has a positive control, because a reader that always returned null
 * would pass every "does not invent an id" assertion.
 *
 *   npx tsx scripts/verify-channel-join.ts
 */

import { readFile } from 'node:fs/promises';
import { preparedGroupIdOf } from '../src/bot/runtime/core.js';

let failures = 0;
function check(label: string, ok: boolean, detail = ''): void {
  if (!ok) failures++;
  console.log(`  [${ok ? 'PASS' : 'FAIL'}] ${label}${detail ? ` - ${detail}` : ''}`);
}

async function main(): Promise<void> {
  console.log('The channel join reads its id and never invents one (CCB-S5-038, D-197)');

  console.log('\n1. The id is read from the core answer');
  check(
    'a newPreparedChat carrying a group yields its id',
    preparedGroupIdOf({ type: 'newPreparedChat', chat: { chatInfo: { groupInfo: { groupId: 42 } } } }) === 42,
  );
  check(
    '  however deep the core nests it',
    preparedGroupIdOf({ a: { b: { c: { groupInfo: { groupId: 7 } } } } }) === 7,
  );

  console.log('\n2. Anything else is a refusal, not a number');
  for (const [what, value] of [
    ['an error response', { type: 'chatCmdError', chatError: { type: 'error' } }],
    ['a plan response with no group', { type: 'connectionPlan', connectionPlan: { type: 'groupLink', groupLinkPlan: { type: 'ok' } } }],
    ['a group id that is not a number', { groupInfo: { groupId: '42' } }],
    ['null', null],
    ['a bare string', 'newPreparedChat'],
    ['an empty object', {}],
  ] as const) {
    check(`${what} yields no id`, preparedGroupIdOf(value) === null);
  }

  console.log('\n3. Positive controls, so a reader that always refused would fail here');
  check('a minimal valid shape still reads', preparedGroupIdOf({ groupInfo: { groupId: 1 } }) === 1);
  check('  and zero is a value, not an absence', preparedGroupIdOf({ groupInfo: { groupId: 0 } }) === 0);

  console.log('\n4. The wire strings are the core\u2019s, not invented');
  const core = await readFile('src/bot/runtime/core.ts', 'utf8');
  check("prepare uses '/_prepare group '", core.includes('`/_prepare group ${String(simplexUserId)} ${link}`'));
  check("connect uses '/_connect group #'", core.includes('`/_connect group #${String(groupId)}`'));
  check(
    '  and both are inside a scheduled critical section (D-171)',
    /prepareGroup:\$\{String\(simplexUserId\)\}/.test(core) && /connectPrepared:\$\{String\(groupId\)\}/.test(core),
  );

  console.log('\n5. The caller does not nest the scheduler (CCB-S5-015)');
  const actions = await readFile('src/bot/runtime/admin-actions.ts', 'utf8');
  const joinBlock = actions.slice(actions.indexOf('A CHANNEL JOINS THROUGH THE PREPARED-GROUP PATH'), actions.indexOf('A prepared link is what'));
  check(
    'neither step is wrapped in runScheduled, which would deadlock',
    !joinBlock.includes("runScheduled('channel:prepare'") &&
      !joinBlock.includes("runScheduled('channel:connect-prepared'"),
  );
  check(
    '  and the id passed to connect is the one prepare returned',
    joinBlock.includes('const preparedGroupId = await host.runtime.prepareGroupFromLink') &&
      joinBlock.includes('connectPreparedGroup(simplexUserId, preparedGroupId)'),
  );
  check(
    '  MUTATION: it is not taken from the plan or from listGroups',
    !joinBlock.includes('listGroups') && !joinBlock.includes('plan.groupLinkPlan.groupInfo'),
  );

  console.log(
    `\n${failures === 0 ? 'ALL PASSED' : `${String(failures)} CHECK(S) FAILED`} - channel join.`,
  );
  console.log('Note: the SimpleX core is one of the four things only the host can show (D-178).');
  process.exitCode = failures === 0 ? 0 : 1;
}

main().catch((err: unknown) => {
  console.error(err);
  process.exitCode = 1;
});
