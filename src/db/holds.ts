/**
 * Evidence holds (CCB-S3-013 Part B).
 *
 * Content under suspicion has to survive long enough for the operator to review
 * it. The tension that shapes this whole module: reports are anonymous and
 * unauthenticated by design, so if a report blocked deletion outright, any
 * stranger could make a member's content permanently undeletable by reporting
 * it, repeatedly and for free.
 *
 * The resolution is a separation of concerns:
 *
 *   **A hold prevents destruction. It never prevents hiding.**
 *
 * A member may always make their content non-public, immediately, with no delay
 * and no review: that is `consent.revoked_at` and nothing here touches it. Only
 * the physical destruction of the data is deferred while a hold is active. That
 * keeps withdrawal genuinely effective, and it is the more defensible position
 * anyway: deferring erasure for a documented purpose is a recognised exception,
 * whereas continuing to publish against a withdrawal is not.
 *
 * The hold is ENFORCED IN THE DATABASE, not here. `migrations/020` installs a
 * BEFORE DELETE trigger on `messages` that raises when a live hold exists, so
 * member deletion, operator takedown, a reply cascade, a retention sweep and the
 * next ad-hoc remediation script all meet the same guard. The functions below
 * place, read and resolve holds; they are not the thing that makes them binding.
 */

import { log } from '../log.js';
import type { Queryable } from './pool.js';

export type HoldSource = 'report' | 'csam';
export type HoldState = 'active' | 'released' | 'escalated';
export type HoldOutcome = 'release' | 'destroy' | 'escalate' | 'expired';

export interface EvidenceHold {
  id: number;
  messageId: number;
  source: HoldSource;
  state: HoldState;
  createdAt: string;
  expiresAt: string | null;
  resolvedAt: string | null;
  resolvedBy: string | null;
  outcome: HoldOutcome | null;
}

interface RawHold {
  id: string;
  message_id: string;
  source: string;
  state: string;
  created_at: string;
  expires_at: string | null;
  resolved_at: string | null;
  resolved_by: string | null;
  outcome: string | null;
}

const HOLD_COLUMNS = `id, message_id, source, state, created_at, expires_at,
                      resolved_at, resolved_by, outcome`;

function mapHold(r: RawHold): EvidenceHold {
  return {
    id: Number(r.id),
    messageId: Number(r.message_id),
    source: r.source as HoldSource,
    state: r.state as HoldState,
    createdAt: r.created_at,
    expiresAt: r.expires_at,
    resolvedAt: r.resolved_at,
    resolvedBy: r.resolved_by,
    outcome: (r.outcome as HoldOutcome | null) ?? null,
  };
}

/**
 * Places a hold, or returns the existing live one unchanged.
 *
 * REPEATED REPORTS DO NOT COMPOUND. The partial unique index
 * `evidence_holds_one_live` allows at most one live hold per message, and this
 * function takes `ON CONFLICT DO NOTHING` and then reads the incumbent back. So
 * the clock runs from the FIRST qualifying report and no amount of re-reporting
 * extends it, moves `expires_at`, or stacks a second hold behind the first.
 *
 * Returns the live hold and whether this call is the one that created it.
 */
export async function placeHold(
  db: Queryable,
  messageId: number,
  source: HoldSource,
  expiresAt: Date | null,
): Promise<{ hold: EvidenceHold; created: boolean }> {
  const { rows } = await db.query<RawHold>(
    `INSERT INTO evidence_holds (message_id, source, expires_at)
     VALUES ($1, $2, $3)
     ON CONFLICT DO NOTHING
     RETURNING ${HOLD_COLUMNS}`,
    [messageId, source, expiresAt],
  );
  const inserted = rows[0];
  if (inserted) return { hold: mapHold(inserted), created: true };

  const existing = await liveHold(db, messageId);
  if (existing) return { hold: existing, created: false };

  // The insert was absorbed by the unique index but no live hold is readable.
  // That is not a state this schema can reach, so it is a fault, not a quiet
  // "already held" (CCB-S3-023: never convert a surprise into a plausible value).
  throw new Error(
    `evidence hold for message ${messageId} was neither created nor found; the live-hold index and the read disagree.`,
  );
}

/** The live (active or escalated) hold on a message, if any. */
export async function liveHold(db: Queryable, messageId: number): Promise<EvidenceHold | null> {
  const { rows } = await db.query<RawHold>(
    `SELECT ${HOLD_COLUMNS} FROM evidence_holds
     WHERE message_id = $1 AND state IN ('active', 'escalated')`,
    [messageId],
  );
  const r = rows[0];
  return r ? mapHold(r) : null;
}

/** Which of the given messages currently carry a live hold. */
export async function liveHeldIds(
  db: Queryable,
  messageIds: readonly number[],
): Promise<Set<number>> {
  if (messageIds.length === 0) return new Set();
  const { rows } = await db.query<{ message_id: string }>(
    `SELECT message_id FROM evidence_holds
     WHERE state IN ('active', 'escalated') AND message_id = ANY($1::bigint[])`,
    [[...messageIds]],
  );
  return new Set(rows.map((r) => Number(r.message_id)));
}

/**
 * Resolves a hold.
 *
 * `escalate` is the one outcome that does not end the hold: the row moves to
 * `escalated`, which the DB trigger still treats as live, and `expires_at` is
 * cleared so nothing can time it out. That is what "preserved for a legal
 * process: segregated, not deletable by any path" has to mean in a schema.
 *
 * Scoped with `state = 'active'` (or `'escalated'` for a later release) so a
 * double-submitted button cannot resolve the same hold twice and write a second
 * audit row.
 */
export async function resolveHold(
  db: Queryable,
  holdId: number,
  outcome: HoldOutcome,
  by: string,
): Promise<EvidenceHold | null> {
  const nextState: HoldState = outcome === 'escalate' ? 'escalated' : 'released';
  const { rows } = await db.query<RawHold>(
    `UPDATE evidence_holds
     SET state       = $2,
         outcome     = $3,
         resolved_at = now(),
         resolved_by = $4,
         -- An escalation never expires. A release does not need an expiry either.
         expires_at  = NULL
     WHERE id = $1 AND state IN ('active', 'escalated')
     RETURNING ${HOLD_COLUMNS}`,
    [holdId, nextState, outcome, by],
  );
  const r = rows[0];
  return r ? mapHold(r) : null;
}

/**
 * Holds whose time is up.
 *
 * An unreviewed report must not become a permanent block by neglect, so a report
 * hold is time-boxed and lapses on its own. Escalations and CSAM quarantines have
 * `expires_at IS NULL` and are structurally excluded from this query: they are
 * released by an explicit operator decision or not at all.
 */
export async function expiredHolds(db: Queryable, limit = 200): Promise<EvidenceHold[]> {
  const { rows } = await db.query<RawHold>(
    `SELECT ${HOLD_COLUMNS} FROM evidence_holds
     WHERE state = 'active' AND expires_at IS NOT NULL AND expires_at <= now()
     ORDER BY expires_at
     LIMIT $1`,
    [limit],
  );
  return rows.map(mapHold);
}

/**
 * Active holds expiring within `days`, soonest first.
 *
 * The briefing asks that the operator be warned as expiry approaches, "so a hold
 * lapses by decision rather than by being forgotten". This is what the admin
 * surfaces; it is a prompt to review, not a fault, so it does not alert.
 */
export async function holdsExpiringWithin(db: Queryable, days: number): Promise<EvidenceHold[]> {
  const { rows } = await db.query<RawHold>(
    `SELECT ${HOLD_COLUMNS} FROM evidence_holds
     WHERE state = 'active'
       AND expires_at IS NOT NULL
       AND expires_at <= now() + make_interval(days => $1)
     ORDER BY expires_at`,
    [days],
  );
  return rows.map(mapHold);
}

export interface HoldListRow extends EvidenceHold {
  /** Open illegal-content reports behind this hold, for the operator's context. */
  reportCount: number;
  senderMemberId: string | null;
  /** Whether the member has already asked for this message to be destroyed. */
  destructionPending: boolean;
}

/** The operator's review queue. */
export async function listHolds(db: Queryable, state: 'live' | 'resolved'): Promise<HoldListRow[]> {
  const stateClause =
    state === 'live' ? `h.state IN ('active', 'escalated')` : `h.state = 'released'`;
  const { rows } = await db.query<
    RawHold & { report_count: string; sender_member_id: string | null; pending: boolean }
  >(
    `SELECT ${HOLD_COLUMNS.split(',')
      .map((c) => `h.${c.trim()}`)
      .join(', ')},
            (SELECT count(*) FROM reports r
              WHERE r.message_id = h.message_id AND r.reason = 'illegal') AS report_count,
            m.sender_member_id,
            (pd.message_id IS NOT NULL) AS pending
     FROM evidence_holds h
     LEFT JOIN messages m ON m.id = h.message_id
     LEFT JOIN pending_destructions pd ON pd.message_id = h.message_id
     WHERE ${stateClause}
     ORDER BY h.expires_at NULLS LAST, h.created_at DESC`,
  );
  return rows.map((r) => ({
    ...mapHold(r),
    reportCount: Number(r.report_count),
    senderMemberId: r.sender_member_id,
    destructionPending: r.pending,
  }));
}

/** Count of live holds, for the admin badge. */
export async function countLiveHolds(db: Queryable): Promise<number> {
  const { rows } = await db.query<{ n: string }>(
    `SELECT count(*)::text AS n FROM evidence_holds WHERE state IN ('active', 'escalated')`,
  );
  return Number(rows[0]?.n ?? 0);
}

/**
 * Whether this reporting source has had enough illegal-content reports dismissed
 * that its reports should stop creating holds.
 *
 * The abuse case this closes: a hold is free to create and expensive to clear, so
 * a determined reporter could otherwise freeze content against deletion at
 * 10 reports a minute. If the operator has repeatedly judged a source's illegal
 * reports to be unfounded, that source loses the ability to place new holds.
 *
 * IT FAILS TOWARD ACCEPTING THE REPORT. A source token is a heuristic: behind
 * CGNAT, a VPN or Tor many unrelated people share one address, and one person can
 * rotate freely. So a missing token, a rotated secret, or a threshold of zero all
 * mean "not suppressed" - the cost of wrongly suppressing a genuine
 * illegal-content notice is far higher than the cost of one more reviewable hold.
 */
export async function sourceIsSuppressed(
  db: Queryable,
  reporterSource: string | null,
  threshold: number,
): Promise<boolean> {
  if (!reporterSource || threshold <= 0) return false;
  const { rows } = await db.query<{ n: string }>(
    `SELECT count(*)::text AS n FROM reports
     WHERE reporter_source = $1 AND reason = 'illegal' AND status = 'dismissed'`,
    [reporterSource],
  );
  const dismissed = Number(rows[0]?.n ?? 0);
  const suppressed = dismissed >= threshold;
  if (suppressed) {
    // Logged so the operator can see that a hold was NOT placed and why. Silence
    // here would look identical to "nobody reported it" (CCB-S3-023).
    log.warn(
      `Holds: a reporting source with ${dismissed} dismissed illegal report(s) is at or over the ` +
        `threshold of ${threshold}; its report did not place a hold.`,
    );
  }
  return suppressed;
}
