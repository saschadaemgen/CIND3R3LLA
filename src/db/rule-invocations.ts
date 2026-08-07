/**
 * The record of when a law was invoked (CCB-S4-050, D-152).
 *
 * Narrow by design. It writes at the deterministic gates and reads for the console, and it
 * knows nothing about why a gate decided what it decided.
 */

import { log } from '../log.js';
import type { Queryable } from './pool.js';

export const INVOCATION_KINDS = ['pre-search', 'disclosure', 'moderation'] as const;
export type InvocationKind = (typeof INVOCATION_KINDS)[number];

export interface RuleInvocation {
  ruleId: string;
  groupId: number;
  kind: InvocationKind;
  category: string | null;
  occurredAt: Date;
}

/**
 * Records one deterministic decision.
 *
 * NEVER THROWS INTO THE REPLY PATH. A gate that refused something has already made the
 * decision that matters; failing to write the record afterwards must not turn a successful
 * refusal into an error the member sees. It is logged instead, with the rule and the kind, so
 * a broken record is visible in the operator's log rather than silent.
 *
 * That is deliberately NOT the standing "surface failures" rule being bent: the failure is
 * surfaced, loudly, in the place operators read. What it must not do is propagate, because the
 * thing it would break is a safety refusal that already succeeded.
 */
export async function recordRuleInvocation(
  db: Queryable,
  entry: { ruleId: string; groupId: number; kind: InvocationKind; category?: string | null },
): Promise<void> {
  try {
    await db.query(
      `INSERT INTO cinderella_rule_invocations (rule_id, group_id, kind, category)
       VALUES ($1, $2, $3, $4)`,
      [entry.ruleId, entry.groupId, entry.kind, entry.category ?? null],
    );
  } catch (err) {
    log.error(
      `Rule invocation record failed for ${entry.ruleId} (${entry.kind}): ` +
        `${err instanceof Error ? err.message : String(err)}. The decision itself stands.`,
    );
  }
}

export interface RuleInvocationSummary {
  ruleId: string;
  count: number;
  lastAt: Date;
}

/** Per rule: how often it has decided something, and when it last did. */
export async function summariseRuleInvocations(
  db: Queryable,
): Promise<Map<string, RuleInvocationSummary>> {
  const result = await db.query<{ rule_id: string; n: string; last_at: Date }>(
    `SELECT rule_id, count(*) AS n, max(occurred_at) AS last_at
       FROM cinderella_rule_invocations
      GROUP BY rule_id`,
  );
  return new Map(
    result.rows.map((row) => [
      row.rule_id,
      { ruleId: row.rule_id, count: Number(row.n), lastAt: row.last_at },
    ]),
  );
}

/** The chronological view. */
export async function listRecentRuleInvocations(
  db: Queryable,
  limit = 100,
): Promise<RuleInvocation[]> {
  const result = await db.query<{
    rule_id: string;
    group_id: string;
    kind: InvocationKind;
    category: string | null;
    occurred_at: Date;
  }>(
    `SELECT rule_id, group_id, kind, category, occurred_at
       FROM cinderella_rule_invocations
      ORDER BY occurred_at DESC
      LIMIT $1`,
    [limit],
  );
  return result.rows.map((row) => ({
    ruleId: row.rule_id,
    groupId: Number(row.group_id),
    kind: row.kind,
    category: row.category,
    occurredAt: row.occurred_at,
  }));
}

/**
 * Drops rows past the retention the operator set.
 *
 * Retention is a setting because this grows with every refusal, and an operator who never
 * looks at it should not accumulate rows forever. Zero means keep everything, which is a
 * legitimate choice for somebody who wants the whole history.
 */
export async function pruneRuleInvocations(db: Queryable, retentionDays: number): Promise<number> {
  if (retentionDays <= 0) return 0;
  const result = await db.query(
    `DELETE FROM cinderella_rule_invocations
      WHERE occurred_at < now() - ($1 || ' days')::interval`,
    [String(retentionDays)],
  );
  return result.rowCount ?? 0;
}
