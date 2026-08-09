/**
 * Moderation persistence (CCB-S4-032, D-136).
 *
 * ── WHAT THIS MODULE CANNOT DO ───────────────────────────────────────────────
 *
 * It writes rows. It holds no chat client, imports nothing that can reach the SimpleX
 * SDK, and there is no function here that changes a role, blocks or removes anybody.
 * That is the no-act guarantee in its strongest form: not a flag that says do not act,
 * but an absence of any means to. `verify:moderation` scans this tree for the
 * enforcement API names and fails if one appears.
 *
 * `recordSanction` takes a mode and this briefing only ever passes 'observed'. The
 * table's own CHECK refuses a row that claims to be observed and carries an
 * enforcement timestamp, so even a future bug cannot write a half-enforced observation.
 */

import type { Queryable } from '../db/pool.js';
import { writeAudit } from '../db/audit.js';
import type { SdkGroupRole } from '../profiles/bot-onboarding.js';
import {
  ARMING_UNLOCKED,
  escalatesWithoutWarning,
  normalizeModerationRules,
  type EnforcementAction,
  type ModerationMode,
  type ModerationRules,
  type ViolationType,
} from './rules.js';

export interface ViolationInput {
  /**
   * Which bot counted this (CCB-S5-001).
   *
   * Two bots must never share a count. The ladders are per bot, so a shared counter lets
   * one bot's strict ladder fire on what another bot's lenient one tolerated - and the
   * member is sanctioned by a bot that never saw a third of the messages it counted.
   *
   * Null only where no bot can be named at all, which the engine never does: it always
   * knows whose reply path it is.
   */
  botProfileId: number | null;
  groupId: number;
  memberId: string;
  memberDisplayName: string;
  memberRole: SdkGroupRole | null;
  type: ViolationType;
}

export interface ViolationRow {
  id: string;
  groupId: number;
  memberId: string;
  memberDisplayName: string;
  memberRole: SdkGroupRole | null;
  type: ViolationType;
  at: string;
}

/** Append one. Never updated, never deleted; it ages out of the window instead. */
export async function recordViolation(db: Queryable, input: ViolationInput): Promise<void> {
  await db.query(
    `INSERT INTO cinderella_violations
       (bot_profile_id, group_id, member_id, member_display_name, member_role, type)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [
      input.botProfileId,
      input.groupId,
      input.memberId,
      input.memberDisplayName,
      input.memberRole,
      input.type,
    ],
  );
}

/**
 * How many of this type from this member in this chat within the window.
 *
 * The cutoff is computed from a caller-supplied `now` rather than from `now()` in SQL,
 * so the harness can drive the clock and prove that a violation actually ages out
 * instead of merely asserting that the SQL mentions an interval.
 */
export async function countViolations(
  db: Queryable,
  scope: { botProfileId: number | null; groupId: number; memberId: string; type: ViolationType },
  windowSeconds: number,
  now: Date,
): Promise<number> {
  const cutoff = new Date(now.getTime() - windowSeconds * 1000).toISOString();
  // `IS NOT DISTINCT FROM` rather than `=`, so the pre-044 rows (bot_profile_id NULL)
  // count for a caller that also passes null and for nobody else. An `=` would make
  // every one of them invisible to every count, silently resetting every member's
  // history at the moment this shipped.
  const { rows } = await db.query<{ n: string | number }>(
    `SELECT count(*)::int AS n
       FROM cinderella_violations
      WHERE bot_profile_id IS NOT DISTINCT FROM $1::bigint
        AND group_id = $2 AND member_id = $3 AND type = $4 AND at >= $5`,
    [scope.botProfileId, scope.groupId, scope.memberId, scope.type, cutoff],
  );
  return Number(rows[0]?.n ?? 0);
}

export interface SanctionInput {
  botProfileId: number | null;
  groupId: number;
  memberId: string;
  memberDisplayName: string;
  memberRole: SdkGroupRole | null;
  action: Exclude<EnforcementAction, 'none'>;
  violationType: ViolationType;
  violationCount: number;
  windowSeconds: number;
  rungThreshold: number | null;
  reason: string;
  /**
   * 'observed' is the only value CCB-S4-032 writes. The parameter exists because the
   * arming briefing needs the other one, and a function that hard-coded the mode would
   * have to be rewritten rather than called.
   */
  mode: 'observed' | 'enforced';
  /**
   * Whether she actually said it in the chat (CCB-S4-033). Only a warning is ever spoken
   * while the mode is observing, and the table's CHECK enforces that: a recorded mute
   * claiming to have been announced would mean she told somebody they were muted when
   * they were not.
   */
  spoken: boolean;
}

export interface SanctionRow extends Omit<SanctionInput, 'mode' | 'spoken'> {
  id: string;
  mode: 'observed' | 'enforced';
  decidedAt: string;
  /** When she said it. Null means recorded and nothing said. */
  spokenAt: string | null;
  /** Arming-briefing fields. Always null today. */
  enforcedAt: string | null;
  expiresAt: string | null;
  undoneAt: string | null;
}

export async function recordSanction(db: Queryable, input: SanctionInput): Promise<void> {
  await db.query(
    `INSERT INTO cinderella_sanctions
       (bot_profile_id, group_id, member_id, member_display_name, member_role, action,
        violation_type, violation_count, window_seconds, rung_threshold, reason, mode,
        spoken_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12,
             CASE WHEN $13::boolean THEN now() ELSE NULL END)`,
    [
      input.botProfileId,
      input.groupId,
      input.memberId,
      input.memberDisplayName,
      input.memberRole,
      input.action,
      input.violationType,
      input.violationCount,
      input.windowSeconds,
      input.rungThreshold,
      input.reason,
      input.mode,
      input.spoken,
    ],
  );
}

/* ── The arming half (CCB-S4-035, D-139) ────────────────────────────────────
 *
 * Still no capability here. These functions write down what an enforcement attempt DID;
 * the attempt itself happens in `apply.ts`, through a port it was handed, and this module
 * remains unable to reach a chat client of any kind.
 */

export interface EnforcedSanctionInput extends Omit<SanctionInput, 'mode'> {
  /** What they held before, so a restore returns them to it. Null for a warning. */
  previousRole: SdkGroupRole | null;
  /** The core's numeric id, which is what a restore acts through. */
  groupMemberId: number | null;
  expiresAt: Date | null;
  enforcedAt: Date;
}

/**
 * Record a sanction that ACTUALLY HAPPENED.
 *
 * Called only after the port call resolved successfully, which is why it can set
 * `enforced_at` unconditionally. Returns the id so the caller can enqueue an expiry
 * against it: a job keyed on a row that does not exist yet is a job that dead-letters.
 */
export async function recordEnforcedSanction(
  db: Queryable,
  input: EnforcedSanctionInput,
): Promise<string> {
  const { rows } = await db.query<{ id: string }>(
    `INSERT INTO cinderella_sanctions
       (bot_profile_id, group_id, member_id, member_display_name, member_role, action,
        violation_type, violation_count, window_seconds, rung_threshold, reason, mode,
        spoken_at, previous_role, group_member_id, expires_at, enforced_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, 'enforced',
             CASE WHEN $12::boolean THEN now() ELSE NULL END, $13, $14, $15, $16)
     RETURNING id`,
    [
      input.botProfileId,
      input.groupId,
      input.memberId,
      input.memberDisplayName,
      input.memberRole,
      input.action,
      input.violationType,
      input.violationCount,
      input.windowSeconds,
      input.rungThreshold,
      input.reason,
      input.spoken,
      input.previousRole,
      input.groupMemberId,
      input.expiresAt?.toISOString() ?? null,
      input.enforcedAt.toISOString(),
    ],
  );
  return rows[0]?.id ?? '';
}

/**
 * Record an attempt that did not happen, with the reason.
 *
 * WRITES `enforced` WITH NO `enforced_at`. That combination is exactly what the table's
 * CHECK permits only when `enforcement_error` is present, so this function cannot
 * accidentally produce a row that claims a sanction nobody is serving. It carries no
 * previous role and no member reference either: nothing was changed, so there is nothing
 * to restore, and the Active page filters on `enforced_at IS NOT NULL` so this row can
 * never appear there.
 */
export async function markSanctionFailed(
  db: Queryable,
  input: Omit<SanctionInput, 'mode'>,
  error: string,
): Promise<string> {
  const { rows } = await db.query<{ id: string }>(
    `INSERT INTO cinderella_sanctions
       (bot_profile_id, group_id, member_id, member_display_name, member_role, action,
        violation_type, violation_count, window_seconds, rung_threshold, reason, mode,
        spoken_at, enforcement_error)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, 'enforced',
             CASE WHEN $12::boolean THEN now() ELSE NULL END, $13)
     RETURNING id`,
    [
      input.botProfileId,
      input.groupId,
      input.memberId,
      input.memberDisplayName,
      input.memberRole,
      input.action,
      input.violationType,
      input.violationCount,
      input.windowSeconds,
      input.rungThreshold,
      input.reason,
      input.spoken,
      error.slice(0, 2000),
    ],
  );
  return rows[0]?.id ?? '';
}

/** A sanction somebody is currently serving, with everything a reversal needs. */
export interface ActiveSanctionRow extends SanctionRow {
  previousRole: SdkGroupRole | null;
  groupMemberId: number | null;
  expiredAt: string | null;
  undoneBy: string | null;
  enforcementError: string | null;
  /** Past its expiry and never lifted: the job was lost. See the Active page. */
  overdue: boolean;
}

const ACTIVE_COLUMNS = `id, bot_profile_id, group_id, member_id, member_display_name, member_role, action,
                        violation_type, violation_count, window_seconds, rung_threshold,
                        reason, mode, decided_at, spoken_at, enforced_at, expires_at,
                        undone_at, previous_role, group_member_id, expired_at, undone_by,
                        enforcement_error`;

interface ActiveDbRow extends SanctionDbRow {
  previous_role: SdkGroupRole | null;
  group_member_id: string | number | null;
  expired_at: string | null;
  undone_by: string | null;
  enforcement_error: string | null;
}

function toActive(row: ActiveDbRow, now: Date): ActiveSanctionRow {
  const expiresAt = row.expires_at;
  return {
    ...toSanction(row),
    previousRole: row.previous_role,
    groupMemberId: row.group_member_id === null ? null : Number(row.group_member_id),
    expiredAt: row.expired_at,
    undoneBy: row.undone_by,
    enforcementError: row.enforcement_error,
    overdue: expiresAt !== null && row.expired_at === null && new Date(expiresAt) <= now,
  };
}

/**
 * Who is currently under something real, INCLUDING the overdue.
 *
 * Deliberately different from the CCB-S4-032 version, which excluded rows whose
 * `expires_at` had passed. That was correct while nothing could expire, and it is exactly
 * wrong now: it would hide a mute whose expiry job was lost, which is the one case an
 * operator most needs to see. A sanction leaves this list when it has actually been
 * REVERSED, by expiry or by hand, not when its clock ran out.
 *
 * Failed attempts never appear, because `enforced_at IS NOT NULL`.
 *
 * NEITHER DO WARNINGS, and that was a defect this page's own check caught. Once the mode
 * is armed a warning is an enforced row with an `enforced_at`, because it genuinely
 * happened: she said it. But nobody is SERVING a warning. Listing them here would put
 * every warned member on a page headed "currently under a sanction", each with a Lift
 * button that has nothing to lift, and would bury the one or two members who are actually
 * held. A warning belongs to the Log, where it already is.
 */
/**
 * ── THE CONSOLE'S READS ARE PER BOT SINCE CCB-S5-017 ─────────────────────────
 *
 * The rows were always per bot: migration 044 put `bot_profile_id` on both tables, both
 * inserts write it, and the counting query leads with it. What merged was the READING. These
 * three listings took no bot at all, so the Log showed every bot's violations in one
 * undifferentiated list and the Active page every bot's sanctions, with no column saying whose.
 *
 * That is a third variant of one family and worth telling apart from the other two: not the
 * accidental isolation CCB-S5-001 found in the counters, and not the genuine storage merge
 * CCB-S5-006 found in the diagnostics buffers. Correctly stored, correctly counted, merged
 * only where an operator looks.
 *
 * The filter is REQUIRED rather than optional. An optional one would have left every existing
 * call site reading across all bots, silently, which is the state being fixed.
 *
 * Rows with a NULL `bot_profile_id` are not shown. Only a deployment that ran 044 with no
 * primary at all can hold any, and attributing them to whichever bot is being viewed would be
 * an invention; they remain in the table and in `verify:moderation`'s reach.
 */
export async function listActiveSanctionsDetailed(
  db: Queryable,
  now: Date,
  botProfileId: number,
): Promise<ActiveSanctionRow[]> {
  const { rows } = await db.query<ActiveDbRow>(
    `SELECT ${ACTIVE_COLUMNS} FROM cinderella_sanctions
      WHERE bot_profile_id = $1
        AND mode = 'enforced'
        AND enforced_at IS NOT NULL
        AND action <> 'warn'
        AND undone_at IS NULL
        AND expired_at IS NULL
      ORDER BY decided_at DESC`,
    [botProfileId],
  );
  return rows.map((row) => toActive(row, now));
}

/**
 * The Log's list, with the outcome fields.
 *
 * A second function rather than widening `listSanctions`, which several checks and the
 * observation-era page still use with its narrower row. Both read the same table; this one
 * asks for the columns that only mean something once enforcement can act.
 */
export async function listSanctionsDetailed(
  db: Queryable,
  now: Date,
  botProfileId: number,
  limit = 100,
): Promise<ActiveSanctionRow[]> {
  const { rows } = await db.query<ActiveDbRow>(
    `SELECT ${ACTIVE_COLUMNS} FROM cinderella_sanctions
      WHERE bot_profile_id = $1
      ORDER BY decided_at DESC, id DESC LIMIT $2`,
    [botProfileId, limit],
  );
  return rows.map((row) => toActive(row, now));
}

/** One row by id, for undo and for the expiry job. */
export async function findSanction(
  db: Queryable,
  id: string,
  now: Date,
): Promise<ActiveSanctionRow | null> {
  const { rows } = await db.query<ActiveDbRow>(
    `SELECT ${ACTIVE_COLUMNS} FROM cinderella_sanctions WHERE id = $1`,
    [id],
  );
  const row = rows[0];
  return row ? toActive(row, now) : null;
}

/**
 * Mark a mute as expired, once.
 *
 * THE GUARD IS IN THE `WHERE`, not in a read followed by a write. Two expiry runs racing
 * (a retry landing beside the original, which the queue's at-least-once contract permits)
 * would both pass an `if (!row.expiredAt)` check and both write. Making the update
 * conditional means the second one matches no rows and returns false, so the caller can
 * say "already done" honestly rather than double-restoring.
 */
export async function markSanctionExpired(db: Queryable, id: string): Promise<boolean> {
  const result = await db.query(
    `UPDATE cinderella_sanctions
        SET expired_at = now()
      WHERE id = $1 AND expired_at IS NULL AND undone_at IS NULL AND enforced_at IS NOT NULL`,
    [id],
  );
  return result.rowCount === 1;
}

/** Mark a sanction as lifted by hand. Same conditional-update reasoning as expiry. */
export async function markSanctionUndone(
  db: Queryable,
  id: string,
  actor: string,
): Promise<boolean> {
  const result = await db.query(
    `UPDATE cinderella_sanctions
        SET undone_at = now(), undone_by = $2
      WHERE id = $1 AND undone_at IS NULL AND expired_at IS NULL AND enforced_at IS NOT NULL`,
    [id, actor.slice(0, 200)],
  );
  return result.rowCount === 1;
}

/**
 * Mutes that are due and have not been lifted.
 *
 * The safety net under the queue, not a replacement for it. The expiry job is enqueued at
 * sanction time and is the normal path; this is what the console reads to show overdue
 * rows, and what a sweep can use to re-enqueue a job that was lost to a crash between the
 * row being written and the job being accepted.
 */
export async function listOverdueSanctions(
  db: Queryable,
  now: Date,
): Promise<ActiveSanctionRow[]> {
  const { rows } = await db.query<ActiveDbRow>(
    `SELECT ${ACTIVE_COLUMNS} FROM cinderella_sanctions
      WHERE mode = 'enforced'
        AND enforced_at IS NOT NULL
        AND undone_at IS NULL
        AND action <> 'warn'
        AND expired_at IS NULL
        AND expires_at IS NOT NULL
        AND expires_at <= $1
      ORDER BY expires_at ASC`,
    [now.toISOString()],
  );
  return rows.map((row) => toActive(row, now));
}

interface SanctionDbRow {
  id: string;
  group_id: string;
  member_id: string;
  member_display_name: string;
  member_role: SdkGroupRole | null;
  action: Exclude<EnforcementAction, 'none'>;
  violation_type: ViolationType;
  violation_count: number;
  window_seconds: number;
  rung_threshold: number | null;
  reason: string;
  mode: 'observed' | 'enforced';
  decided_at: string;
  spoken_at: string | null;
  enforced_at: string | null;
  expires_at: string | null;
  undone_at: string | null;
  bot_profile_id: string | null;
}

function toSanction(row: SanctionDbRow): SanctionRow {
  return {
    id: row.id,
    botProfileId: row.bot_profile_id === null ? null : Number(row.bot_profile_id),
    groupId: Number(row.group_id),
    memberId: row.member_id,
    memberDisplayName: row.member_display_name,
    memberRole: row.member_role,
    action: row.action,
    violationType: row.violation_type,
    violationCount: row.violation_count,
    windowSeconds: row.window_seconds,
    rungThreshold: row.rung_threshold,
    reason: row.reason,
    mode: row.mode,
    decidedAt: row.decided_at,
    spokenAt: row.spoken_at,
    enforcedAt: row.enforced_at,
    expiresAt: row.expires_at,
    undoneAt: row.undone_at,
  };
}

const SANCTION_COLUMNS = `id, bot_profile_id, group_id, member_id, member_display_name, member_role, action,
                          violation_type, violation_count, window_seconds, rung_threshold,
                          reason, mode, decided_at, spoken_at, enforced_at, expires_at,
                          undone_at`;

export async function listSanctions(db: Queryable, limit = 100): Promise<SanctionRow[]> {
  const { rows } = await db.query<SanctionDbRow>(
    `SELECT ${SANCTION_COLUMNS} FROM cinderella_sanctions
      ORDER BY decided_at DESC, id DESC LIMIT $1`,
    [limit],
  );
  return rows.map(toSanction);
}

/**
 * Who is currently under something real.
 *
 * Observed rows are excluded BY THE QUERY, not by the page. An observation is not a
 * sanction anybody is serving, and a page that listed them would tell the operator
 * members are muted when nobody is.
 */
export async function listActiveSanctions(db: Queryable, now: Date): Promise<SanctionRow[]> {
  const { rows } = await db.query<SanctionDbRow>(
    `SELECT ${SANCTION_COLUMNS} FROM cinderella_sanctions
      WHERE mode = 'enforced'
        AND undone_at IS NULL
        AND (expires_at IS NULL OR expires_at > $1)
      ORDER BY decided_at DESC`,
    [now.toISOString()],
  );
  return rows.map(toSanction);
}

export async function listViolations(
  db: Queryable,
  botProfileId: number,
  limit = 100,
): Promise<ViolationRow[]> {
  const { rows } = await db.query<{
    id: string;
    group_id: string;
    member_id: string;
    member_display_name: string;
    member_role: SdkGroupRole | null;
    type: ViolationType;
    at: string;
  }>(
    `SELECT id, group_id, member_id, member_display_name, member_role, type, at
       FROM cinderella_violations
      WHERE bot_profile_id = $1
      ORDER BY at DESC, id DESC LIMIT $2`,
    [botProfileId, limit],
  );
  return rows.map((row) => ({
    id: row.id,
    groupId: Number(row.group_id),
    memberId: row.member_id,
    memberDisplayName: row.member_display_name,
    memberRole: row.member_role,
    type: row.type,
    at: row.at,
  }));
}

/* ── The rules, per bot ──────────────────────────────────────────────────── */

interface RulesDbRow {
  moderation_mode: string;
  moderation_verbal_window_secs: number;
  moderation_enforce_window_secs: number;
  moderation_verbal_ladder: unknown;
  moderation_enforce_ladder: unknown;
  moderation_exempt_roles: unknown;
  moderation_verbal_exempts_staff: boolean;
  moderation_announce: boolean;
  moderation_warning_count: number;
}

const RULES_COLUMNS = `moderation_mode, moderation_verbal_window_secs,
                       moderation_enforce_window_secs, moderation_verbal_ladder,
                       moderation_enforce_ladder, moderation_exempt_roles,
                       moderation_verbal_exempts_staff, moderation_announce,
                       moderation_warning_count`;

function toRules(row: RulesDbRow): ModerationRules {
  return normalizeModerationRules({
    mode: row.moderation_mode,
    verbalWindowSeconds: row.moderation_verbal_window_secs,
    enforcementWindowSeconds: row.moderation_enforce_window_secs,
    verbal: row.moderation_verbal_ladder,
    enforcement: row.moderation_enforce_ladder,
    exemptRoles: row.moderation_exempt_roles,
    verbalExemptsStaff: row.moderation_verbal_exempts_staff,
    announce: row.moderation_announce,
    warningCount: row.moderation_warning_count,
  });
}

/**
 * The PRIMARY bot's ladders, or null when no bot holds the flag.
 *
 * Called `runtimeModerationRules` until CCB-S5-008, alongside `runtimeBotPersonality`, and
 * wrong in the same way: it reads as "the rules of the bot the runtime hosts" and the
 * runtime hosts every enabled bot. It answers the console's default. The engine names a bot
 * and uses {@link botModerationRules}; a bot moderating on the primary's ladders is the
 * defect CCB-S5-001 removed.
 *
 * Null is a real answer and not a default, exactly as with the personality (D-133): an
 * operator who has configured no bot has configured no rules, and handing back a ladder
 * nobody chose would invent one. The caller decides what absence means, and for the engine
 * it means the ladders do not run at all.
 */
export async function primaryModerationRules(db: Queryable): Promise<ModerationRules | null> {
  const { rows } = await db.query<RulesDbRow>(
    `SELECT ${RULES_COLUMNS} FROM cinderella_bot_profiles
      WHERE selected_for_runtime = TRUE LIMIT 1`,
  );
  const row = rows[0];
  return row ? toRules(row) : null;
}

export async function botModerationRules(
  db: Queryable,
  botProfileId: number,
): Promise<ModerationRules | null> {
  const { rows } = await db.query<RulesDbRow>(
    `SELECT ${RULES_COLUMNS} FROM cinderella_bot_profiles WHERE id = $1`,
    [botProfileId],
  );
  const row = rows[0];
  return row ? toRules(row) : null;
}

/**
 * The phrase an operator types to arm enforcement (CCB-S4-035).
 *
 * A TYPED WORD RATHER THAN A CHECKBOX, and for the reason `updateModerationRules` already
 * gives about the ordering guarantee: a box is something you tick once and then tick
 * forever. Typing cannot be done absent-mindedly, it cannot be done by a stray click, and
 * it cannot be done by a browser restoring a form. This is the switch that turns
 * recordings into consequences and it should cost six keystrokes.
 */
export const ARM_CONFIRMATION = 'ARM';

/**
 * Change the mode, and only the mode (CCB-S4-035, D-139).
 *
 * SEPARATE FROM THE LADDER SAVE ON PURPOSE, which is the shape CCB-S4-032 anticipated
 * when it left the mode out of `updateModerationRules` entirely. If arming rode along
 * with a ladder save, every threshold tweak would carry a hidden mode field, and the one
 * setting in this product that can silence a real person would be changeable by a form
 * that looks like it is about numbers.
 *
 * ARMING REQUIRES THE PHRASE. DISARMING DOES NOT. Friction belongs on the direction that
 * increases harm; an operator who wants enforcement to stop must be able to make it stop
 * immediately, and asking them to type something first would be the wrong thing to
 * optimise. The asymmetry is deliberate and it is the same reasoning as the revocation
 * path, where taking consent back is always cheaper than giving it.
 *
 * The ordering guarantee is re-checked HERE as well as on the ladder save. A ladder saved
 * while observing is a ladder nobody was ever harmed by; the moment it is armed, its
 * shape starts mattering, and this is the last point before it does.
 */
export async function updateModerationMode(
  db: Queryable,
  botProfileId: number,
  mode: ModerationMode,
  confirmation: string,
  actor: string,
): Promise<ModerationMode> {
  if (!Number.isSafeInteger(botProfileId) || botProfileId <= 0) {
    throw new Error('Bot profile ID is invalid.');
  }

  if (mode === 'enforce') {
    // THE LOCK (CCB-S4-035 ground rule 5). Enforcement has not been proven against a real
    // core with a real second member, so it cannot be armed, and the refusal lives on the
    // write path rather than only in the console: a form is not a security boundary and
    // this is the one setting where that distinction can cost somebody their voice.
    if (!ARMING_UNLOCKED) {
      throw new Error(
        'Enforcement cannot be armed yet. Everything it needs is built and checked, but ' +
          'it has not been proven against a real group with a real second member: an actual ' +
          'mute applied and lifted, a moderator restored as a moderator, and an expiry ' +
          'firing. Until that is done, arming would be switching on consequences that have ' +
          'never been run against anything real.',
      );
    }
    if (confirmation.trim().toUpperCase() !== ARM_CONFIRMATION) {
      throw new Error(
        `To arm enforcement, type ${ARM_CONFIRMATION} in the confirmation box. While it is ` +
          `armed, members can be muted, blocked or removed by rule, without anybody being ` +
          `asked first.`,
      );
    }

    const rules = await botModerationRules(db, botProfileId);
    if (!rules) throw new Error('Bot onboarding profile not found.');
    if (escalatesWithoutWarning(rules)) {
      throw new Error(
        'This ladder would escalate a member without ever warning them, so it cannot be ' +
          'armed. Fix the ladder first, or set the warning count to 0 if you deliberately ' +
          'want no warnings.',
      );
    }
  }

  const result = await db.query(
    `UPDATE cinderella_bot_profiles
        SET moderation_mode = $2, updated_at = now()
      WHERE id = $1`,
    [botProfileId, mode],
  );
  if (result.rowCount !== 1) throw new Error('Bot onboarding profile not found.');

  // The most important audit row this product writes. It is the moment consequences were
  // switched on or off, and it names who did it.
  await writeAudit(db, actor, 'cinderella.moderation.mode', `bot-profile:${botProfileId}`, {
    mode,
    armed: mode === 'enforce',
  });

  return mode;
}

/**
 * Save the ladders for one bot.
 *
 * The mode is deliberately NOT a parameter, and still is not. Arming happens through
 * {@link updateModerationMode}, which is its own form, its own audit action and its own
 * confirmation. A ladder save cannot change the mode by accident.
 */
export async function updateModerationRules(
  db: Queryable,
  botProfileId: number,
  raw: unknown,
  actor: string,
): Promise<ModerationRules> {
  if (!Number.isSafeInteger(botProfileId) || botProfileId <= 0) {
    throw new Error('Bot profile ID is invalid.');
  }

  const rules = normalizeModerationRules(raw);

  // THE ORDERING GUARANTEE (CCB-S4-033, D-137). A mute, or anything harder, must never be
  // the first thing that happens to a member.
  //
  // REFUSED rather than acknowledged. An acknowledgement checkbox on a moderation form is
  // a box an operator ticks once and then ticks forever, which converts a guarantee into
  // a habit. Refusing costs one edit and cannot be absent-mindedly agreed to. Setting the
  // warning count to zero remains available and is a deliberate statement rather than an
  // accident, so it is not blocked.
  if (escalatesWithoutWarning(rules)) {
    const first = rules.enforcement.find((rung) => rung.action !== 'none');
    throw new Error(
      `This ladder would ${first?.action ?? 'escalate'} a member without ever warning them. ` +
        `The first rung that does anything must be a warning. Either make rung ${
          rules.enforcement.findIndex((rung) => rung.action !== 'none') + 1
        } a warning, or set the warning count to 0 if you deliberately want no warnings.`,
    );
  }

  const result = await db.query(
    `UPDATE cinderella_bot_profiles
        SET moderation_verbal_window_secs = $2,
            moderation_enforce_window_secs = $3,
            moderation_verbal_ladder = $4::jsonb,
            moderation_enforce_ladder = $5::jsonb,
            moderation_exempt_roles = $6::jsonb,
            moderation_verbal_exempts_staff = $7,
            moderation_announce = $8,
            moderation_warning_count = $9,
            updated_at = now()
      WHERE id = $1`,
    [
      botProfileId,
      rules.verbalWindowSeconds,
      rules.enforcementWindowSeconds,
      JSON.stringify(rules.verbal),
      JSON.stringify(rules.enforcement),
      JSON.stringify(rules.exemptRoles),
      rules.verbalExemptsStaff,
      rules.announce,
      rules.warningCount,
    ],
  );

  if (result.rowCount !== 1) throw new Error('Bot onboarding profile not found.');

  await writeAudit(db, actor, 'cinderella.moderation.rules', `bot-profile:${botProfileId}`, {
    verbalWindowSeconds: rules.verbalWindowSeconds,
    enforcementWindowSeconds: rules.enforcementWindowSeconds,
    verbal: rules.verbal,
    enforcement: rules.enforcement,
    exemptRoles: rules.exemptRoles,
    verbalExemptsStaff: rules.verbalExemptsStaff,
    announce: rules.announce,
    warningCount: rules.warningCount,
    // Recorded on every save so the audit trail shows the mode never changed here.
    modeUnchanged: 'observe',
  });

  return rules;
}
