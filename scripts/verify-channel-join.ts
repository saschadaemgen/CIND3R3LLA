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
  // \u2500\u2500 FOUR ARGUMENTS, MEASURED AGAINST THE REAL CORE (D-198) \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
  //
  // This asserted the two-argument form `/_prepare group ${uid} ${link}`, which the core
  // rejected on every live attempt with `Failed reading: empty`. The check was GREEN for
  // that whole time, because it compared the source against itself: it pinned the string
  // the code emitted, and the code emitted the wrong string. That is the shape of a check
  // that can only ever confirm what was written, and it is why the assertion now names
  // the two arguments that were MISSING rather than the literal it happens to build.
  check(
    "prepare uses '/_prepare group ' with the full link AND the short link",
    core.includes('`/_prepare group ${String(simplexUserId)} ` +') &&
      core.includes('`${connLink.connFullLink} ${shortLink} ${dataJson}`'),
  );
  check(
    '  and the fourth argument is the plan\u2019s own group data as JSON',
    /const dataJson = JSON\.stringify\(shortLinkData\)/.test(core),
  );
  check(
    '  MUTATION: the pasted link is no longer passed to prepare at all',
    !core.includes('`/_prepare group ${String(simplexUserId)} ${link}`'),
  );
  check(
    '  a link with no short link is refused rather than sent (it cannot parse)',
    /connShortLink/.test(core) && /without a short link, so it cannot be prepared/.test(core),
  );
  check(
    '  and the command is never logged, because it carries the link and an avatar',
    !/command: redactLink\(command\)/.test(core) && /shape: '\/_prepare group </.test(core),
  );
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

  check(
    '  and both extra arguments come from the plan, not from the pasted text',
    joinBlock.includes('prepared,') && joinBlock.includes('plan.groupLinkPlan.groupSLinkData_'),
  );

  console.log('\n6. A group link is refused, and the refusal has no override (D-198)');
  const bridgeSource = await readFile('src/web/views/bridge.ts', 'utf8');
  // ── THE SCAN MEANS "IN THE CODE", SO COMMENTS COME OUT FIRST ───────────────
  //
  // Written without this, three of the checks below went red against a CORRECT page: the
  // comment that records why the button was removed necessarily quotes the button, and a
  // substring search cannot tell a removal from a mention of one. Per D-111 the verifier
  // was fixed and the source was left alone - the alternative was deleting the note that
  // explains the decision in order to satisfy a check about the decision.
  const bridge = bridgeSource.replace(/\/\*[\s\S]*?\*\//g, '');
  check(
    'the "Join that group anyway" button is gone from the page',
    !bridge.includes('Join that group anyway'),
  );
  check(
    '  and nothing can re-enable it: confirmGroupJoin exists nowhere in the tree',
    !bridge.includes('confirmGroupJoin') && !actions.includes('confirmGroupJoin'),
  );
  check(
    '  the refusal names the group so the operator can tell what he pasted',
    /That is a group link\$\{named \? ` for "\$\{named\}"` : ''\}/.test(actions),
  );
  check(
    '  and says where a group IS joined, which a bare refusal does not',
    /joined\s*` \+\s*`by invitation on the Foundation page\./.test(actions),
  );
  check(
    '  the link is not carried back through the URL (log + history)',
    !bridge.includes('pending=') && !bridge.includes("req.query.pending"),
  );
  // POSITIVE CONTROL. Every assertion above is an ABSENCE, and all five pass against a
  // page that renders nothing at all. This one fails if the refusal stopped being shown.
  check(
    '  POSITIVE CONTROL: the refusal is still rendered to the operator',
    bridge.includes('req.query.groupLink') && /border-red-300/.test(bridge),
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
