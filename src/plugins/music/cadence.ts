/**
 * The music cadence's decisions (CCB-S5-044, D-216), pure.
 *
 * The bridge's model reused rather than reinvented, which was the briefing's
 * own instruction: an interval, a member-message count, whichever comes first,
 * anchored on the last send or the assignment's creation. What music adds is
 * the BUDGET LAYER the operator bounded: a per-room daily cap and a minimum
 * gap, SEPARATE for music and spots (his decision - a requested track and an
 * unbidden advert are different things to a member, and one budget would let a
 * busy music day silently buy advertising quiet or the reverse).
 *
 * Requested plays consult none of this: a member asking is not the machine
 * speaking unbidden, which is exactly the line the budgets exist to hold.
 *
 * Everything here is a pure function over inputs the caller fetched, so
 * `verify:music` drives every branch with no database and no clock of its own.
 */

export interface CadenceAssignmentState {
  mode: 'on-request' | 'cadence';
  intervalMinutes: number | null;
  messageCount: number | null;
  lastSentAt: Date | null;
  createdAt: Date;
}

/** Why a cadence slot did not send. Every one is counted, never silent. */
export type CadenceSkip =
  | 'not-due'
  | 'budget-spent'
  | 'gap-too-recent'
  | 'send-in-flight'
  | 'playlist-empty';

export interface BudgetState {
  /** Unbidden sends of this class already in this room today. */
  today: number;
  /** The most recent unbidden send of this class in this room. */
  lastAt: Date | null;
}

export interface BudgetBounds {
  dailyCap: number;
  gapMinutes: number;
}

/** The bridge's whichever-comes-first, verbatim in shape. */
export function cadenceDue(
  a: CadenceAssignmentState,
  now: Date,
  memberMessagesSinceLastSend: number,
): 'interval' | 'count' | null {
  if (a.mode !== 'cadence') return null;
  const anchor = a.lastSentAt ?? a.createdAt;
  if (
    a.intervalMinutes !== null &&
    now.getTime() - anchor.getTime() >= a.intervalMinutes * 60_000
  ) {
    return 'interval';
  }
  if (a.messageCount !== null && memberMessagesSinceLastSend >= a.messageCount) {
    return 'count';
  }
  return null;
}

/**
 * The budget verdict for one would-be unbidden send. The cap is checked before
 * the gap so the skip reason names the binding constraint: "budget-spent" and
 * "gap-too-recent" call for different operator responses (raise the cap;
 * accept the rhythm).
 */
export function budgetAllows(
  budget: BudgetState,
  bounds: BudgetBounds,
  now: Date,
): CadenceSkip | null {
  if (budget.today >= bounds.dailyCap) return 'budget-spent';
  if (
    bounds.gapMinutes > 0 &&
    budget.lastAt !== null &&
    now.getTime() - budget.lastAt.getTime() < bounds.gapMinutes * 60_000
  ) {
    return 'gap-too-recent';
  }
  return null;
}

export interface CadencePlanInput {
  assignment: CadenceAssignmentState;
  now: Date;
  memberMessagesSinceLastSend: number;
  budget: BudgetState;
  bounds: BudgetBounds;
  /** One send at a time per group: a slot landing mid-transfer is skipped. */
  sendInFlight: boolean;
  playlistHasTracks: boolean;
}

export interface CadencePlan {
  send: boolean;
  /** Set exactly when send is false AND the slot was due - the counted skips. */
  skip: CadenceSkip | null;
  due: boolean;
}

export function planCadence(input: CadencePlanInput): CadencePlan {
  const due = cadenceDue(input.assignment, input.now, input.memberMessagesSinceLastSend) !== null;
  if (!due) return { send: false, skip: null, due: false };
  if (input.sendInFlight) return { send: false, skip: 'send-in-flight', due: true };
  if (!input.playlistHasTracks) return { send: false, skip: 'playlist-empty', due: true };
  const budgetSkip = budgetAllows(input.budget, input.bounds, input.now);
  if (budgetSkip !== null) return { send: false, skip: budgetSkip, due: true };
  return { send: true, skip: null, due: true };
}
