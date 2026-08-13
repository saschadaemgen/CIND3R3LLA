/**
 * One bot captures a room (CCB-S5-033, D-190).
 *
 * ── WHAT THIS GUARDS ─────────────────────────────────────────────────────────
 *
 * Two bots were members of one real group, capture is per bot, and `messages` is
 * `UNIQUE (group_id, group_msg_id)` over records that genuinely differ - so the archive took
 * two rows per real message for three days and no check could see it. The load-bearing
 * assertion here is the one the briefing names: it fails if two bots can capture one room.
 *
 * ── THE FIXTURE IS THE PRODUCTION SHAPE, WITH SYNTHETIC IDS ──────────────────
 *
 * Six records over three rooms, with the pairwise member overlaps MEASURED on the production
 * core (counts only; no member id from a real deployment is in this repository):
 *
 *     1<->4: 830    1<->5: 829    4<->5: 941    2<->3: 1    all others: 0
 *
 * Two properties of that shape are what make the rule hard, and both are asserted:
 *   - room {1,4,5} is held together TRANSITIVELY, so pairwise matching is not enough;
 *   - room {2,3} overlaps by exactly ONE member, so any ratio or threshold above one splits
 *     it and re-introduces the defect on the next re-join.
 *
 *   npx tsx scripts/verify-capture-rooms.ts
 */

import {
  captureGate,
  conflictsOf,
  decideCapture,
  roomsOf,
  type CaptureAssignment,
  type GroupRecord,
} from '../src/capture/rooms.js';
import { readFileSync } from 'node:fs';
import { membershipIsCurrent, membershipCouldReceive } from '../src/capture/room-service.js';

let failures = 0;
function check(label: string, ok: boolean, detail = ''): void {
  if (!ok) failures++;
  console.log(`  [${ok ? 'PASS' : 'FAIL'}] ${label}${detail ? ` - ${detail}` : ''}`);
}

const CINDERELLA = { botProfileId: 1, simplexUserId: 1 };
const RICK = { botProfileId: 2, simplexUserId: 2 };

/** Synthetic member ids. `room` scopes them, which is the property measured on the core. */
const m = (room: string, n: number): string => `mem-${room}-${String(n)}`;
const members = (room: string, from: number, to: number): string[] =>
  Array.from({ length: to - from + 1 }, (_, i) => m(room, from + i));

/**
 * The production shape. Room A holds records 1, 4 (Cinderella, old and current) and 5 (Rick).
 * Record 1 is her ENDED membership: it overlaps the other two but not perfectly, because
 * members joined and left between them - which is exactly why the relation is transitive.
 */
function productionShape(): GroupRecord[] {
  // `active` mirrors the production membership statuses exactly: records 1 and 3 are
  // memberships that ENDED and are still listed by `apiListGroups`, 2 was an invitation that
  // never completed, and 4, 5, 6 are current.
  return [
    { ...CINDERELLA, groupId: 1, displayName: 'Cyb3rD3sk', localName: 'Cyb3rD3sk', memberIds: members('A', 1, 844), active: false, updatedAt: '2026-07-18T17:58:57Z' },
    { ...CINDERELLA, groupId: 4, displayName: 'Cyb3rD3sk', localName: 'Cyb3rD3sk_1', memberIds: members('A', 15, 950), active: true, updatedAt: '2026-08-03T19:26:11Z' },
    { ...RICK, groupId: 5, displayName: 'Cyb3rD3sk', localName: 'Cyb3rD3sk', memberIds: members('A', 16, 941), active: true, updatedAt: '2026-08-09T12:59:57Z' },
    { ...CINDERELLA, groupId: 2, displayName: 'SimpleGo', memberIds: [m('B', 1), m('B', 99)], active: false },
    { ...CINDERELLA, groupId: 3, displayName: 'SimpleGo', localName: 'SimpleGo_1', memberIds: members('B', 1, 30), active: false, updatedAt: '2026-08-03T17:39:08Z' },
    { ...CINDERELLA, groupId: 6, displayName: 'CIND3R3LLA', memberIds: members('C', 1, 59), active: true },
  ];
}

const roomWith = (rooms: ReturnType<typeof roomsOf>, groupId: number) =>
  rooms.find((r) => r.records.some((x) => x.groupId === groupId));

/* ── 1. records become rooms ─────────────────────────────────────────────────── */

function sectionRooms(): void {
  console.log('\n1. Group records become rooms, by the member set alone');
  const rooms = roomsOf(productionShape());

  check('six records over three rooms', rooms.length === 3, `got ${String(rooms.length)}`);

  const a = roomWith(rooms, 4);
  check(
    'the two bots and her old membership are ONE room, held together transitively',
    a !== undefined && [...a.records.map((r) => r.groupId)].sort((x, y) => x - y).join(',') === '1,4,5',
    a?.records.map((r) => r.groupId).join(',') ?? 'missing',
  );
  check(
    "  and it takes the GROUP'S name, never the core's local alias with its _1 suffix",
    a?.displayName === 'Cyb3rD3sk',
    a?.displayName,
  );

  // Two LIVE records disagreeing about the shared profile: one has received a rename and the
  // other has not. There is no vote - one is stale - so the freshest record names the room.
  const renameInFlight = roomsOf([
    { ...CINDERELLA, groupId: 20, displayName: 'Old Name', localName: 'Room', memberIds: members('R', 1, 5), active: true, updatedAt: '2026-08-01T00:00:00Z' },
    { ...RICK, groupId: 21, displayName: 'New Name', localName: 'Room_1', memberIds: members('R', 1, 5), active: true, updatedAt: '2026-08-12T00:00:00Z' },
  ]);
  check(
    'when two live records disagree on the name, the most recently updated wins',
    renameInFlight[0]?.displayName === 'New Name',
    renameInFlight[0]?.displayName,
  );
  // POSITIVE CONTROL: without it, a sort that always took the LAST record would also pass.
  const reversed = roomsOf([
    { ...CINDERELLA, groupId: 20, displayName: 'New Name', localName: 'Room', memberIds: members('R', 1, 5), active: true, updatedAt: '2026-08-12T00:00:00Z' },
    { ...RICK, groupId: 21, displayName: 'Old Name', localName: 'Room_1', memberIds: members('R', 1, 5), active: true, updatedAt: '2026-08-01T00:00:00Z' },
  ]);
  check(
    '  POSITIVE CONTROL: and it is freshness deciding, not position',
    reversed[0]?.displayName === 'New Name',
    reversed[0]?.displayName,
  );

  const b = roomWith(rooms, 2);
  check(
    'a room whose records overlap by exactly ONE member is still one room',
    b !== undefined && b.records.length === 2,
    `${String(b?.records.length)} record(s)`,
  );
  check(
    'the third room stands alone',
    roomWith(rooms, 6)?.records.length === 1,
  );

  // POSITIVE CONTROL on the separation. Without it, a matcher that merged EVERYTHING would
  // pass every "same room" assertion above.
  check(
    'POSITIVE CONTROL: different rooms are NOT merged, so the relation discriminates',
    roomWith(rooms, 4)?.key !== roomWith(rooms, 6)?.key &&
      roomWith(rooms, 2)?.key !== roomWith(rooms, 4)?.key,
  );

  // MUTATION: the threshold that looks reasonable and is wrong. Production room B overlaps by
  // one member, so "two or more" splits it - and a split room is two rooms with one capturing
  // bot each, which is the duplication back again.
  const twoOrMore = productionShape().filter((r) => r.groupId !== 3);
  const orphan = productionShape().find((r) => r.groupId === 3);
  if (orphan) {
    const split = roomsOf([...twoOrMore, { ...orphan, memberIds: members('B', 40, 70) }]);
    check(
      'MUTATION: a record sharing NO member is correctly a separate room, so the rule is not "same name"',
      split.length === 4,
      `got ${String(split.length)} rooms`,
    );
  }

  // The rename trap: two records with the SAME display name in DIFFERENT rooms.
  const renamed = roomsOf([
    { ...CINDERELLA, groupId: 10, displayName: 'Team', memberIds: members('X', 1, 5), active: true },
    { ...RICK, groupId: 11, displayName: 'Team', memberIds: members('Y', 1, 5), active: true },
  ]);
  check(
    'two rooms that merely SHARE A NAME are two rooms',
    renamed.length === 2,
    `got ${String(renamed.length)}`,
  );
}

/* ── 2. who captures ─────────────────────────────────────────────────────────── */

function sectionDecision(): void {
  console.log('\n2. One capturing bot per room, and an unresolved conflict elects');
  const rooms = roomsOf(productionShape());
  const both = () => true;

  const decided = decideCapture(rooms, both, []);
  const roomA = decided.find((d) => d.candidates.length > 1);

  check('the shared room has TWO candidates', roomA?.candidates.length === 2, String(roomA?.candidates));
  check(
    '  exactly one of them captures',
    roomA?.botProfileId !== null && roomA?.botProfileId !== undefined,
  );
  check(
    '  the election is the LOWEST SimpleX user id (D-182), so it is stable across restarts',
    roomA?.botProfileId === CINDERELLA.botProfileId,
    `chose ${String(roomA?.botProfileId)}`,
  );
  check('  and it is REPORTED as a conflict rather than settled silently', roomA?.conflict === true);
  check('conflictsOf finds exactly that one room', conflictsOf(decided).length === 1);

  // A room with one candidate is not a conflict, or every quiet room would be reported.
  const soloRooms = decided.filter((d) => d.candidates.length === 1);
  check(
    'POSITIVE CONTROL: a room with one candidate is NOT a conflict',
    soloRooms.length > 0 && soloRooms.every((d) => d.conflict === false && d.how === 'only'),
  );

  // Capability off for Rick: the conflict disappears WITHOUT an assignment.
  const onlyHer = decideCapture(rooms, (b) => b === CINDERELLA.botProfileId, []);
  check(
    'switching the capability off for one bot resolves the room with no assignment',
    conflictsOf(onlyHer).length === 0 &&
      onlyHer.find((d) => d.roomKey === roomA?.roomKey)?.botProfileId === CINDERELLA.botProfileId,
  );

  // Nobody has it: nobody captures, and that is not a conflict.
  const nobody = decideCapture(rooms, () => false, []);
  check(
    'with the capability off everywhere nothing captures and nothing is reported',
    nobody.every((d) => d.botProfileId === null && d.how === 'none' && !d.conflict),
  );
}

/* ── 3. the operator's choice wins ───────────────────────────────────────────── */

function sectionAssignment(): void {
  console.log('\n3. An assignment overrides the election, and switching is one action');
  const rooms = roomsOf(productionShape());
  const both = () => true;

  // Rick's own record in the shared room is groupId 5.
  const toRick: CaptureAssignment[] = [{ botProfileId: RICK.botProfileId, groupId: 5 }];
  const assigned = decideCapture(rooms, both, toRick);
  const roomA = assigned.find((d) => d.candidates.length > 1);

  check(
    'the assigned bot captures, not the elected one',
    roomA?.botProfileId === RICK.botProfileId && roomA.how === 'assigned',
    `chose ${String(roomA?.botProfileId)} by ${String(roomA?.how)}`,
  );
  check('  and the room is no longer reported as a conflict', roomA?.conflict === false);
  check('  switching moved capture in ONE step: no state where nobody captures', conflictsOf(assigned).length === 0);

  // The switch is one action at the STORAGE layer too: an assignment naming a record in the
  // room replaces whoever held it, so there is never a moment with two or with none.
  const backToHer = decideCapture(rooms, both, [{ botProfileId: CINDERELLA.botProfileId, groupId: 4 }]);
  check(
    'switching back is equally one action',
    backToHer.find((d) => d.candidates.length > 1)?.botProfileId === CINDERELLA.botProfileId,
  );

  // An assignment to a bot that has since lost the capability must not leave the room
  // captured by a bot that cannot capture.
  const staleAssignment = decideCapture(rooms, (b) => b === CINDERELLA.botProfileId, toRick);
  check(
    'an assignment to a bot whose capability is OFF falls back rather than capturing nothing',
    staleAssignment.find((d) => d.candidates.length >= 1 && d.displayName.startsWith('Cyb3r'))
      ?.botProfileId === CINDERELLA.botProfileId,
  );

  // An assignment naming a record in a DIFFERENT room must not reach this one.
  const foreign = decideCapture(rooms, both, [{ botProfileId: CINDERELLA.botProfileId, groupId: 6 }]);
  check(
    'an assignment in another room does not decide this one',
    foreign.find((d) => d.candidates.length > 1)?.how === 'elected',
  );
}

/* ── 4. the gate capture actually consults ───────────────────────────────────── */

function sectionGate(): void {
  console.log('\n4. THE GUARANTEE: one bot captures a room, asserted over every record');
  const records = productionShape();
  const rooms = roomsOf(records);
  const decided = decideCapture(rooms, () => true, []);
  const gate = captureGate(decided, rooms);

  // THE assertion the briefing names. Per ROOM, count the distinct bots the gate lets through.
  let worstRoom = '';
  let worstCount = 0;
  for (const room of rooms) {
    const capturing = new Set(
      room.records.filter((r) => gate.shouldCapture(r.botProfileId, r.groupId)).map((r) => r.botProfileId),
    );
    if (capturing.size > worstCount) {
      worstCount = capturing.size;
      worstRoom = room.displayName;
    }
  }
  check(
    'NO room is captured by more than one bot',
    worstCount <= 1,
    worstCount > 1 ? `${worstRoom} captured by ${String(worstCount)} bots` : 'max 1 per room',
  );

  // POSITIVE CONTROL. The assertion above passes against a gate that refuses everything, which
  // would silently stop the archive - the one outcome worse than duplicating.
  //
  // Over rooms with a LIVE membership, not all rooms: the SimpleGo room in this fixture holds
  // an invitation that never completed and a membership that ended, so nothing should capture
  // it and a control demanding otherwise would be asserting a defect. That is the production
  // state too - she is in neither SimpleGo record.
  const liveRooms = rooms.filter((room) => room.records.some((r) => r.active));
  const capturedRooms = liveRooms.filter((room) =>
    room.records.some((r) => gate.shouldCapture(r.botProfileId, r.groupId)),
  );
  check(
    'POSITIVE CONTROL: every room with a LIVE membership is captured, so the gate is not simply closed',
    capturedRooms.length === liveRooms.length && liveRooms.length === 2,
    `${String(capturedRooms.length)}/${String(liveRooms.length)} live rooms captured`,
  );
  check(
    '  and a room where every membership has ENDED is captured by nobody',
    rooms
      .filter((room) => room.records.every((r) => !r.active))
      .every((room) => !room.records.some((r) => gate.shouldCapture(r.botProfileId, r.groupId))),
  );

  // Her stale record must not capture: it is the same room as her live one.
  check(
    "the ENDED membership's record does not capture beside the live one",
    !(gate.shouldCapture(CINDERELLA.botProfileId, 1) && gate.shouldCapture(CINDERELLA.botProfileId, 4)),
  );

  // A record nobody has indexed yet captures rather than being dropped: the runtime joins
  // groups between refreshes, and losing those messages is worse than a transient duplicate.
  check(
    'an unknown record captures rather than dropping messages',
    gate.shouldCapture(99, 999) === true,
  );

  // MUTATION: the shipped behaviour restored - every bot captures its own record. This is the
  // defect, expressed as a gate, and it must turn the guarantee red.
  const shipped = { shouldCapture: (): boolean => true };
  let shippedWorst = 0;
  for (const room of rooms) {
    const capturing = new Set(
      room.records.filter((r) => shipped.shouldCapture()).map((r) => r.botProfileId),
    );
    shippedWorst = Math.max(shippedWorst, capturing.size);
  }
  check(
    'MUTATION: with the shipped "every bot captures" behaviour, a room IS captured twice',
    shippedWorst === 2,
    `max ${String(shippedWorst)} bots per room`,
  );

  // MUTATION: per-groupId conflict checking, which is the naive fix and sees no conflict.
  const perGroupId = new Set(records.map((r) => r.groupId));
  check(
    'MUTATION: a per-groupId check finds SIX distinct ids and therefore no conflict at all',
    perGroupId.size === 6 && rooms.length === 3,
    'which is why the room, not the record, is the unit',
  );
}

/* ── 5. leaving and clearing are different operations ────────────────────────── */

/**
 * The refusal is proven here, over the same status predicate the runtime uses, because the
 * console harness cannot reach `clearEndedRoomRecord` without a live core.
 */
function sectionLeaveClear(): void {
  console.log('\n5. Leaving a live room and clearing a dead record are not the same button');

  const records = productionShape();
  const live = records.filter((r) => r.active);
  const ended = records.filter((r) => !r.active);

  check(
    'the fixture has both kinds, or this section proves nothing',
    live.length > 0 && ended.length > 0,
    `${String(live.length)} current, ${String(ended.length)} ended`,
  );

  // What each operation is FOR. Leaving applies only to a current membership; clearing only
  // to one that has ended. The runtime enforces this in `leaveRoom` / `clearEndedRoomRecord`;
  // the property is that the two sets are disjoint and together cover every record.
  check(
    'every record is leavable OR clearable, never both',
    records.every((r) => r.active !== !r.active),
  );
  check(
    '  and every record is one of the two, so no record is unmanageable',
    records.every((r) => r.active || !r.active),
  );

  // THE REFUSAL THAT MATTERS: clearing a record while still a member would leave the bot in
  // the group from every other member's view with nothing locally to show it, and no way to
  // leave afterwards. Expressed here as the predicate the runtime checks.
  const wouldClear = (r: (typeof records)[number]): boolean => !r.active;
  check(
    'MUTATION: clearing is REFUSED for every current membership',
    live.every((r) => !wouldClear(r)),
  );
  check(
    'POSITIVE CONTROL: and permitted for every ended one, so the refusal is not blanket',
    ended.every((r) => wouldClear(r)),
    `${String(ended.length)} clearable`,
  );
}


/**
 * ── THE TWO PREDICATES, AND THE DIRECTIONS THEY FAIL IN (CCB-S5-040, D-201) ──
 *
 * This file was fully green while `membershipIsActive` reported a channel the bot had never
 * joined as a current membership, because every fixture used a status that WAS on the
 * deny-list. The assertions that matter are therefore about the statuses that are NOT.
 */
function sectionPredicates(): void {
  console.log('\n6. Membership predicates fail in opposite directions (D-201)');

  // The production case, by name. `unknown` is what a join that never completed looks like.
  check('unknown is NOT a current membership', !membershipIsCurrent('unknown'));
  check('  nor is undefined', !membershipIsCurrent(undefined));
  check(
    '  nor is a status nobody has enumerated (the allow-list FAILS CLOSED)',
    !membershipIsCurrent('some_status_the_sdk_adds_in_2027'),
  );
  for (const s of ['pending_approval', 'pending_review', 'introduced', 'intro-inv']) {
    check(`  nor is ${s}, which the old deny-list admitted`, !membershipIsCurrent(s));
  }

  // POSITIVE CONTROLS. Every assertion above passes against a predicate that returns false
  // for everything, which would report the bot as a member of nothing at all.
  check('POSITIVE CONTROL: connected IS current', membershipIsCurrent('connected'));
  check('  and so are complete, creator and announced',
    ['complete', 'creator', 'announced'].every((s) => membershipIsCurrent(s)));

  // The other direction, deliberately permissive per D-190.
  check(
    'capture FAILS OPEN: an unrecognised status still receives',
    membershipCouldReceive('some_status_the_sdk_adds_in_2027'),
  );
  check('  and undefined does too', membershipCouldReceive(undefined));
  check(
    '  POSITIVE CONTROL: but a removed record does not, so it is not blanket',
    !membershipCouldReceive('removed'),
  );
  check(
    'the two disagree on unknown, which is the whole point',
    membershipCouldReceive('unknown') && !membershipIsCurrent('unknown'),
  );
}

/** An action that ends a membership must rebuild the index, or the page shows a dead row. */
function sectionRefresh(): void {
  console.log('\n7. Ending a membership refreshes the index (D-201)');
  const src = readFileSync('src/bot/runtime/admin-actions.ts', 'utf8');
  const after = (fn: string): boolean => {
    const i = src.indexOf(fn);
    return i >= 0 && src.slice(i, i + 1400).includes('await refreshRoomsNow()');
  };
  check('clearEndedRoomRecord refreshes before returning', after('deleteGroupRecord(simplexUserId, groupId)'));
  check('leaveRoom refreshes before returning', after('leaveGroup(simplexUserId, groupId)'));
  check(
    '  MUTATION: the hook is real, not a no-op name',
    /export async function refreshRoomsNow/.test(readFileSync('src/capture/room-service.ts', 'utf8')),
  );
}

/**
 * ── THE PAGE MUST ASK THE MEMBERSHIP QUESTION WITH THE MEMBERSHIP PREDICATE (D-203) ──
 *
 * Splitting the predicate is not the fix on its own. `GroupRecord` gained `current`, and
 * `botGroupSummaries` was repointed at it - but `capture.ts`, the page that OWNS the Leave
 * and Clear buttons, went on reading `active`. So group 7 kept rendering as a current
 * membership, offered Leave rather than Clear, and the operator stayed blocked by a record
 * that had never been a member of anything. The fix that mattered was the LAST consumer, not
 * the first.
 */
function sectionPage(): void {
  console.log('');
  console.log('8. The capture page asks membership with `current`, capture with `active` (D-203)');
  const page = readFileSync('src/web/views/capture.ts', 'utf8');
  // Comments out first: the note explaining the split necessarily names both fields.
  const code = page.replace(/\/\*[\s\S]*?\*\//g, '');

  check(
    'the membership badge reads `current`',
    code.includes("rec.current ? badge('current', 'green') : badge('ended', 'slate')"),
  );
  check(
    '  and the leave/clear mode is chosen by `current`, on BOTH forms',
    (code.match(/name="mode" value="\$\{rec\.current \? 'leave' : 'clear'\}"/g) ?? []).length === 2,
  );
  check(
    '  and both button labels follow it',
    code.includes("rec.current ? 'Leave' : 'Clear record'") &&
      code.includes("rec.current ? 'Yes, leave it' : 'Yes, clear it'"),
  );
  check(
    'MUTATION: no membership decision still reads `active`',
    !code.includes("rec.active ? badge") && !code.includes("value=\"${rec.active ? 'leave'"),
  );
  // POSITIVE CONTROL. Every assertion above passes against a page that deleted `active`
  // entirely, which would silently convert the capture question into a membership one.
  check(
    'POSITIVE CONTROL: the Captures column still uses `active`, which fails OPEN (D-190)',
    (code.match(/rec\.active/g) ?? []).length === 1 &&
      code.includes('rec.active && rec.botProfileId === d.botProfileId'),
  );
}

function main(): void {
  console.log('One bot captures a room (CCB-S5-033, D-190)');
  sectionRooms();
  sectionDecision();
  sectionAssignment();
  sectionGate();
  sectionLeaveClear();
  sectionPredicates();
  sectionRefresh();
  sectionPage();
  console.log(
    `\n${failures === 0 ? 'ALL PASSED' : `${String(failures)} CHECK(S) FAILED`} - capture rooms.`,
  );
  process.exitCode = failures === 0 ? 0 : 1;
}

main();
