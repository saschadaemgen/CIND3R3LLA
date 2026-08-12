/**
 * The live answer to "may this bot capture this group?" (CCB-S5-033, D-190).
 *
 * `rooms.ts` is the pure rule; this is the process-wide index it decides over, the refresh
 * that keeps it current, and the report that makes a conflict visible.
 *
 * ── WHY AN INDEX RATHER THAN A DECISION AT REGISTRATION ──────────────────────
 *
 * The conflict this exists for was not created in a settings form. A second bot JOINED a room
 * that already had one, and nothing anywhere changed a setting. So the answer has to be able
 * to change while the process runs, which means capture asks per message and this index is
 * refreshed when membership moves - at boot, and on `userJoinedGroup`.
 *
 * ── FAIL TOWARDS CAPTURING ───────────────────────────────────────────────────
 *
 * Every uncertain case here resolves to "capture". A room this index has not heard of, a
 * refresh that failed, a membership status the SDK has not shown us before: all capture. That
 * is deliberate and it is not symmetry. Capturing twice is a defect the operator can see and
 * this briefing can fix; a message not captured is gone, and no later correction recovers it.
 */

import { log } from '../log.js';
import { status } from '../web/status.js';
import { describeChatError } from '../bot/runtime/chat-error.js';
import {
  captureGate,
  conflictsOf,
  decideCapture,
  roomsOf,
  type CaptureAssignment,
  type CaptureDecision,
  type GroupRecord,
  type Room,
} from './rooms.js';

/**
 * Membership states in which a record receives nothing.
 *
 * A DENY-list rather than an allow-list, so a status the SDK adds later reads as ACTIVE and
 * the room keeps capturing. The other direction would stop an archive because a vocabulary
 * grew. `invited` is here because it means the join never completed: production held such a
 * record for months, with two members and no messages.
 */
const ENDED: ReadonlySet<string> = new Set([
  'rejected',
  'removed',
  'left',
  'deleted',
  'invited',
]);

export function membershipIsActive(memberStatus: string | undefined): boolean {
  return memberStatus === undefined ? true : !ENDED.has(memberStatus);
}

interface Index {
  rooms: Room[];
  decisions: CaptureDecision[];
  gate: { shouldCapture(botProfileId: number, groupId: number): boolean };
}

/** Empty means "not built yet", and an empty gate captures everything. See the header. */
let index: Index = {
  rooms: [],
  decisions: [],
  gate: { shouldCapture: () => true },
};

/** What capture consults, per message. */
export function shouldCapture(botProfileId: number, groupId: number): boolean {
  return index.gate.shouldCapture(botProfileId, groupId);
}

/** What the console shows. */
export function captureRoomState(): { rooms: Room[]; decisions: CaptureDecision[] } {
  return { rooms: index.rooms, decisions: index.decisions };
}

/**
 * Each bot's rooms, for the dashboard (CCB-S5-034, D-192).
 *
 * Derived from the same index capture decides over, so it is per bot, it distinguishes a
 * CURRENT membership from a record of one that ended, and it is as live as the index - which
 * is refreshed at boot and on every membership change.
 *
 * The line it replaces flattened every bot's groups into one string, named nobody, counted
 * ended memberships as though they were current, and was produced once at boot.
 */
export function botGroupSummaries(
  bots: readonly { botProfileId: number; displayName: string }[],
): { bot: string; current: string[]; endedCount: number }[] {
  return bots.map((b) => {
    const mine = index.rooms.flatMap((r) => r.records.filter((rec) => rec.botProfileId === b.botProfileId));
    return {
      bot: b.displayName,
      current: mine.filter((r) => r.active).map((r) => r.displayName).sort((x, y) => x.localeCompare(y)),
      endedCount: mine.filter((r) => !r.active).length,
    };
  });
}

/**
 * What this needs from the core, in CINDERELLA'S OWN TERMS.
 *
 * Structural rather than `T.GroupInfo` / `T.GroupMember`: `verify:adapter-seam` forbids the
 * SDK outside `src/bot/`, and it is right to - this module reasons about rooms, not about
 * SimpleX. The runtime satisfies these shapes without any adaptation because the fields are
 * named the same, and the check that would have caught a drift is the seam itself.
 */
export interface RoomSource {
  /** Every hosted bot, with the profile id the console uses and the SimpleX id the core does. */
  bots: readonly { botProfileId: number; simplexUserId: number; displayName: string }[];
  listGroups(simplexUserId: number): Promise<
    readonly {
      groupId: number;
      localDisplayName: string;
      /** The group's SHARED profile. Its `displayName` is what the group is called (D-193). */
      groupProfile?: { displayName?: string } | undefined;
      updatedAt?: string | undefined;
      membership?: { memberStatus?: string } | undefined;
    }[]
  >;
  listMembers(
    simplexUserId: number,
    groupId: number,
  ): Promise<readonly { memberId: string }[]>;
}

/**
 * Rebuild the index from the core, and report any conflict.
 *
 * One `listGroups` per bot plus one `listMembers` per group, all local reads. A failure for
 * one bot leaves the previous index alone rather than blanking it: a blank index captures
 * everything, which is the duplication back again.
 */
export async function refreshCaptureRooms(
  source: RoomSource,
  hasCapability: (botProfileId: number) => boolean,
  assignments: readonly CaptureAssignment[],
): Promise<{ rooms: Room[]; decisions: CaptureDecision[]; conflicts: CaptureDecision[] } | null> {
  const records: GroupRecord[] = [];
  try {
    for (const bot of source.bots) {
      const groups = await source.listGroups(bot.simplexUserId);
      for (const g of groups) {
        const members = await source.listMembers(bot.simplexUserId, g.groupId);
        records.push({
          botProfileId: bot.botProfileId,
          simplexUserId: bot.simplexUserId,
          groupId: g.groupId,
          // The GROUP'S name, from its shared profile - not `localDisplayName`, which carries
          // the core's `_1` disambiguator and names nothing outside this database (D-193).
          displayName: g.groupProfile?.displayName || g.localDisplayName,
          localName: g.localDisplayName,
          ...(g.updatedAt === undefined ? {} : { updatedAt: g.updatedAt }),
          memberIds: members.map((m) => m.memberId),
          active: membershipIsActive(g.membership?.memberStatus),
        });
      }
    }
  } catch (err) {
    // Surfaced, never swallowed (CCB-S3-023): a stale index is a room whose capturer is a
    // guess, and this is the consent and capture path.
    const message = describeChatError(err);
    log.error('capture: could not read the rooms, keeping the previous index', { error: message });
    status.error(
      `Could not read which bot captures which room (${message}). The previous assignment ` +
        `still applies; if a bot has just joined or left a group, restart to re-read it.`,
    );
    return null;
  }

  const rooms = roomsOf(records);
  const decisions = decideCapture(rooms, hasCapability, assignments);
  index = { rooms, decisions, gate: captureGate(decisions, rooms) };

  const conflicts = conflictsOf(decisions);
  reportConflicts(conflicts, source);
  log.info('capture: rooms resolved', {
    records: records.length,
    rooms: rooms.length,
    capturing: decisions.filter((d) => d.botProfileId !== null).length,
    conflicts: conflicts.length,
  });
  return { rooms, decisions, conflicts };
}

/**
 * Say a conflict out loud, naming the room and every bot in it.
 *
 * The line this replaces looked straight at this exact case and said co-tenancy "could not be
 * checked", because it consulted two fields the core leaves null. An operator reading it had
 * no way to know that two bots were writing one archive twice.
 */
function reportConflicts(conflicts: readonly CaptureDecision[], source: RoomSource): void {
  const nameOf = (botProfileId: number): string =>
    source.bots.find((b) => b.botProfileId === botProfileId)?.displayName ??
    `bot ${String(botProfileId)}`;

  for (const c of conflicts) {
    const others = c.candidates.filter((b) => b !== c.botProfileId).map(nameOf);
    const line =
      `Two or more bots can capture "${c.displayName}": ${c.candidates.map(nameOf).join(', ')}. ` +
      `${nameOf(c.botProfileId ?? -1)} is capturing it, chosen automatically because nobody ` +
      `assigned one, so the archive keeps ONE copy. ${others.join(' and ')} ` +
      `${others.length === 1 ? 'is' : 'are'} in the room and not capturing. Choose which bot ` +
      `should capture it on the Capture page.`;
    log.error('capture: more than one bot can capture a room', {
      room: c.displayName,
      capturing: nameOf(c.botProfileId ?? -1),
      others,
    });
    status.error(line);
  }
}

/**
 * How many of the rooms this bot is in does it actually record (CCB-S5-035, D-193)?
 *
 * The capability and the assignment are different facts and the console showed only the
 * first: "on for this bot" beside "Cinderella is capturing it" reads as a contradiction, and
 * the operator reasonably concluded something was broken. `capturing` of `rooms` is the
 * sentence that reconciles them.
 */
export function captureCounts(botProfileId: number): { rooms: number; capturing: number } {
  const mine = index.rooms.filter((r) =>
    r.records.some((rec) => rec.botProfileId === botProfileId && rec.active),
  );
  return {
    rooms: mine.length,
    capturing: index.decisions.filter(
      (d) => d.botProfileId === botProfileId && mine.some((r) => r.key === d.roomKey),
    ).length,
  };
}

/** Test hook. */
export function resetCaptureRooms(): void {
  index = { rooms: [], decisions: [], gate: { shouldCapture: () => true } };
}
