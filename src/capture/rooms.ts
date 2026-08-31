/**
 * What a real room is, and which bot captures it (CCB-S5-033, D-190).
 *
 * ── THE DEFECT THIS EXISTS FOR ───────────────────────────────────────────────
 *
 * Two bots were members of one real group. Capture is per bot by design, and `messages` is
 * `UNIQUE (group_id, group_msg_id)`, so two group RECORDS cannot collide: the archive took
 * two rows for every real message and had been doing so since 9 August. The co-tenancy check
 * looked straight at it and reported that co-tenancy "could not be checked".
 *
 * ── WHY A GROUP RECORD IS NOT A ROOM ─────────────────────────────────────────
 *
 * The core keeps one `groups` row per (user, membership). One real room therefore appears
 * once per bot that is in it, AND once more per previous membership: `groups` has
 * `UNIQUE (user_id, local_display_name)`, so a re-join lands beside the old record with a
 * `_1` suffix. The production database held six records for four rooms.
 *
 * A naive per-`groupId` conflict check sees no conflict at all, because the two records
 * genuinely have different ids. The whole question is which records are the same ROOM.
 *
 * ── WHAT IDENTIFIES A ROOM, MEASURED RATHER THAN ASSUMED ─────────────────────
 *
 * A member's wire `member_id` is scoped to the ROOM: the same person carries the same id in
 * every local record of one room and a different id in a different room. Measured against
 * the production core, intersecting the member sets of every pair of records:
 *
 *     same room:      941, 830, and 1
 *     different room:   0,   0, and 0
 *
 * So two records are the same room exactly when their member sets INTERSECT, and the
 * predicate is `>= 1` rather than a ratio. That 1 is load-bearing: it is a record whose join
 * never completed and which therefore knew only the host. Any threshold above one member
 * would have called it a different room and re-introduced the defect on the next re-join.
 *
 * REJECTED, and why, because each looked right first:
 *   - the HOST member id: it is the member through whom THIS bot joined, so two bots invited
 *     by different members hold different hosts for one room. It is also absent from
 *     `GroupInfo` entirely. It happens to agree on today's data, which is exactly how it
 *     would have shipped.
 *   - `groupKeys.publicGroupId` and `viaGroupLinkUri`: both null for every record involved.
 *     That is not a coincidence, it IS the existing bug - `sharedGroupKey` consults these two
 *     and returns null, which is why the boot line could not check.
 *   - `root_pub_key`: null on every row.
 *   - `group_profile_id`: one per record, by construction.
 *
 * Members come from `apiListMembers`, which the SDK documents as "Network usage: no" - a
 * local read of the core's SQLite, not a round trip.
 *
 * This module is PURE. It takes records and answers questions, so the whole rule is testable
 * with no core and no database.
 */

/** One `groups` row as this model needs it: a bot, a record, and who is in it. */
export interface GroupRecord {
  botProfileId: number;
  simplexUserId: number;
  /** The core's local group id, unique per bot and NOT a room identity. */
  groupId: number;
  /**
   * WHAT THE GROUP IS CALLED, from its shared profile (CCB-S5-035, D-193).
   *
   * Not `localDisplayName`. The core keeps `UNIQUE (user_id, local_display_name)`, so a
   * second record for a group whose name is already taken gets a `_1` suffix - and the
   * operator was shown `Cyb3rD3sk_1`, a string that exists nowhere but in the bot's own
   * SQLite. His group is called `Cyb3rD3sk`, and every record of it says so in
   * `groupProfile.displayName`.
   */
  displayName: string;
  /** The core's local alias, for diagnostics only. Never shown as the room's name. */
  localName?: string;
  /**
   * When the core last updated this record, for choosing between live records that disagree
   * about the shared profile. See {@link roomsOf}.
   */
  updatedAt?: string;
  /** Wire member ids of everyone the core lists in this record. */
  memberIds: readonly string[];
  /**
   * Whether this membership is CURRENT.
   *
   * `apiListGroups` returns records for memberships that have ENDED - production listed
   * `Cyb3rD3sk` (removed) beside `Cyb3rD3sk_1` (connected) as two of one bot's four groups.
   * A stale record receives nothing, but it is still a record, and a bot holding two records
   * in one room would otherwise satisfy "one capturing BOT per room" while capturing through
   * both. So the unit is the capturing RECORD, and liveness decides which one.
   *
   * FAILS OPEN, towards capturing (D-190): an unrecognised status keeps the record eligible,
   * because a duplicate is visible and a lost message is gone. Use for CAPTURE decisions.
   * For anything the operator READS, use {@link GroupRecord.current} - see D-201.
   */
  active: boolean;
  /**
   * Whether this bot is genuinely a MEMBER, for anything the operator reads.
   *
   * FAILS CLOSED, the opposite of {@link GroupRecord.active} and deliberately so. `active`
   * once answered both questions and reported a channel the bot had never joined as current,
   * because `unknown` - what a join that never completed looks like - was simply absent from
   * a deny-list of five out of fifteen statuses. A claim of membership must be positively
   * evidenced; capture eligibility may be assumed. See D-201.
   */
  current: boolean;
}

/** Several records that are one real room. */
export interface Room {
  /**
   * Stable within a process and derived, never stored: the smallest
   * `simplexUserId:groupId` in the room. Storage keys on a real record instead
   * (see {@link CaptureAssignment}), so nothing depends on this surviving a
   * membership change.
   */
  key: string;
  /** What to call it. The records can disagree after a rename; the longest-lived wins. */
  displayName: string;
  records: readonly GroupRecord[];
}

const recordKey = (r: GroupRecord): string => `${String(r.simplexUserId)}:${String(r.groupId)}`;

/**
 * Group records into rooms.
 *
 * Connected components over "share at least one member", not merely pairwise matching: if A
 * and B share a member and B and C share a different one, all three are one room. Membership
 * differs between records (one bot joined later and never saw the members who had already
 * left), so a room can be held together by a chain rather than by one common member.
 */
export function roomsOf(records: readonly GroupRecord[]): Room[] {
  const parent = new Map<string, string>();
  const find = (a: string): string => {
    let r = a;
    while (parent.get(r) !== r) {
      const up = parent.get(r);
      if (up === undefined) break;
      parent.set(r, parent.get(up) ?? up);
      r = parent.get(r) ?? r;
    }
    return r;
  };
  const union = (a: string, b: string): void => {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent.set(ra, rb);
  };

  for (const r of records) parent.set(recordKey(r), recordKey(r));

  // One pass over members rather than a pairwise comparison of every record: a member id
  // seen twice unions the two records that hold it. O(total members) instead of O(n^2 * m).
  const seenBy = new Map<string, string>();
  for (const r of records) {
    const me = recordKey(r);
    for (const m of r.memberIds) {
      const other = seenBy.get(m);
      if (other === undefined) seenBy.set(m, me);
      else union(me, other);
    }
  }

  const byRoot = new Map<string, GroupRecord[]>();
  for (const r of records) {
    const root = find(recordKey(r));
    const list = byRoot.get(root);
    if (list) list.push(r);
    else byRoot.set(root, [r]);
  }

  const out: Room[] = [];
  for (const group of byRoot.values()) {
    const sorted = [...group].sort((a, b) =>
      a.simplexUserId - b.simplexUserId || a.groupId - b.groupId,
    );
    const first = sorted[0];
    if (first === undefined) continue;
    // ── WHICH RECORD NAMES THE ROOM (CCB-S5-035, D-193) ─────────────────────
    //
    // A CURRENT membership first: a record whose membership ended keeps whatever the group
    // was called then, and naming a live room after it is how the preview came to label one
    // "Cyb3rD3sk_old".
    //
    // Then, among live records, THE MOST RECENTLY UPDATED. Two live records in one room can
    // disagree about the group's name, because `groupProfile` is shared state pushed by the
    // group's owner and a bot that has not received the rename yet still holds the old one.
    // There is no vote to take: one of them is stale and the other is not, and the core's own
    // `updatedAt` is the only evidence of which. Ties fall to the lowest group id so the
    // answer is stable rather than arbitrary.
    //
    // Member count is NOT the tiebreak any more. It was, and it is unrelated to freshness:
    // the bot with more members is simply the one that has been in the room longer.
    const byFreshness = [...sorted].sort(
      (a, b) =>
        Number(b.active) - Number(a.active) ||
        (b.updatedAt ?? '').localeCompare(a.updatedAt ?? '') ||
        a.groupId - b.groupId,
    );
    const named = byFreshness[0];
    out.push({
      key: recordKey(first),
      displayName: named?.displayName ?? first.displayName,
      records: sorted,
    });
  }
  return out.sort((a, b) => a.key.localeCompare(b.key));
}

/**
 * The operator's explicit choice for one room.
 *
 * Keyed on a REAL RECORD rather than on {@link Room.key}, deliberately. A synthetic room key
 * is derived from the membership, so it moves when the membership moves, and an assignment
 * whose key drifted would be silently forgotten. A record is a row the core keeps; if it
 * disappears the assignment stops matching and the room falls back to the election, which is
 * the safe direction.
 */
export interface CaptureAssignment {
  botProfileId: number;
  groupId: number;
}

export type CaptureHow =
  /** The operator named this bot for this room. */
  | 'assigned'
  /** The only candidate. */
  | 'only'
  /** More than one candidate and nobody chose; the rule below picked. */
  | 'elected'
  /** No bot in this room has the capability. */
  | 'none';

export interface CaptureDecision {
  roomKey: string;
  displayName: string;
  /** Who captures, or null when nobody does. */
  botProfileId: number | null;
  /**
   * WHICH RECORD captures, or null. Named as well as the bot because a bot can hold more
   * than one record in a room (a re-join leaves the old one behind), and "one capturing bot"
   * would still be satisfied while both of its records captured.
   */
  groupId: number | null;
  how: CaptureHow;
  /** Every bot in the room with the capability on. */
  candidates: readonly number[];
  /**
   * True when more than one bot could capture and no assignment settled it. The election
   * still names one, so the archive stays whole; this is what makes the situation VISIBLE.
   */
  conflict: boolean;
}

/**
 * Who captures each room.
 *
 * ── WHAT AN UNRESOLVED CONFLICT DOES, AND WHY ────────────────────────────────
 *
 * Three answers were possible and two are wrong. Capturing TWICE is the defect this exists to
 * end. Capturing NOTHING loses messages, and a lost message is not recoverable later, whereas
 * a wrong choice of capturer is. So an unresolved conflict ELECTS one, and the archive stays
 * whole and single.
 *
 * The election is the lowest `simplexUserId` among the candidates - the rule D-182 already
 * uses to decide which bot answers a slash command. It is the core's own creation order, so
 * it is stable across restarts and across a rename, and every bot derives the same answer
 * from the same index with no coordination.
 *
 * Electing decides something the operator did not, so it is never silent: {@link
 * CaptureDecision.conflict} is what the boot check reports and what the console shows, and an
 * assignment overrides it.
 */
export function decideCapture(
  rooms: readonly Room[],
  hasCapability: (botProfileId: number) => boolean,
  assignments: readonly CaptureAssignment[],
): CaptureDecision[] {
  return rooms.map((room) => {
    // Only a CURRENT membership can capture: an ended one receives nothing, and treating it
    // as a candidate would let a removed record hold a room against the bot that is actually
    // in it.
    const live = room.records.filter((r) => r.active && hasCapability(r.botProfileId));
    const candidates = [...new Set(live.map((r) => r.botProfileId))].sort((a, b) => a - b);

    /**
     * That bot's current record here; the most recent when a re-join left several.
     *
     * "Most recent" is decided by the HIGHEST local group id, which leans on the core
     * assigning its per-profile ids monotonically - a rejoin gets a larger one (the very
     * property D-205 records for the operator's own 4 -> 8 move). That is an assumption
     * about the core's allocator, stated here because it was previously leaned on in
     * silence (CCB-S5-063); if it ever broke, the cost would be capture keyed to an older
     * record of the SAME bot, which the Capture page's clear-record control repairs.
     */
    const recordFor = (botProfileId: number): number | null =>
      live
        .filter((r) => r.botProfileId === botProfileId)
        .sort((a, b) => b.groupId - a.groupId)[0]?.groupId ?? null;

    const assigned = assignments.find((a) =>
      live.some((r) => r.botProfileId === a.botProfileId && r.groupId === a.groupId),
    );

    const base = { roomKey: room.key, displayName: room.displayName, candidates };

    if (candidates.length === 0) {
      return { ...base, botProfileId: null, groupId: null, how: 'none' as const, conflict: false };
    }
    // An assignment counts only when that bot still HAS the capability. Otherwise switching
    // capture off for a bot would leave it nominally capturing a room it cannot capture.
    if (assigned !== undefined && candidates.includes(assigned.botProfileId)) {
      return {
        ...base,
        botProfileId: assigned.botProfileId,
        // The assigned RECORD, not the newest: the operator picked this one.
        groupId: assigned.groupId,
        how: 'assigned' as const,
        conflict: false,
      };
    }
    if (candidates.length === 1) {
      const only = candidates[0] ?? null;
      return {
        ...base,
        botProfileId: only,
        groupId: only === null ? null : recordFor(only),
        how: 'only' as const,
        conflict: false,
      };
    }

    // The election. Lowest SimpleX user id, per D-182.
    const lowest = live.sort((a, b) => a.simplexUserId - b.simplexUserId)[0];
    const winner = lowest?.botProfileId ?? null;
    return {
      ...base,
      botProfileId: winner,
      groupId: winner === null ? null : recordFor(winner),
      how: 'elected' as const,
      conflict: true,
    };
  });
}

/**
 * The lookup capture actually uses: may this bot capture this group record?
 *
 * Consulted per message rather than decided once at registration, because membership changes
 * at runtime: a second bot joining a room must change the answer without a restart, which is
 * exactly what nobody noticed happening in the other direction.
 */
export function captureGate(decisions: readonly CaptureDecision[], rooms: readonly Room[]) {
  /** Every known record, mapped to the ONE record that captures its room. */
  const winnerOf = new Map<string, string | null>();
  for (const d of decisions) {
    const room = rooms.find((r) => r.key === d.roomKey);
    if (room === undefined) continue;
    const winner =
      d.botProfileId === null || d.groupId === null
        ? null
        : `${String(d.botProfileId)}:${String(d.groupId)}`;
    for (const rec of room.records) {
      winnerOf.set(`${String(rec.botProfileId)}:${String(rec.groupId)}`, winner);
    }
  }
  return {
    shouldCapture(botProfileId: number, groupId: number): boolean {
      const me = `${String(botProfileId)}:${String(groupId)}`;
      const winner = winnerOf.get(me);
      // A record this index has never heard of: capture it. An unknown room is a room the
      // ownership index has not caught up with, and refusing there would drop messages for
      // the one case the whole briefing is about - a group joined since the last refresh.
      // Duplicating is the lesser fault, and the refresh that follows corrects it.
      if (winner === undefined) return true;
      return winner === me;
    },
  };
}

/** The conflicts a boot check reports, with everything needed to name them. */
export function conflictsOf(decisions: readonly CaptureDecision[]): CaptureDecision[] {
  return decisions.filter((d) => d.conflict);
}
