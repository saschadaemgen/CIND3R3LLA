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
  escalatesWithoutWarning,
  normalizeModerationRules,
  type EnforcementAction,
  type ModerationRules,
  type ViolationType,
} from './rules.js';

export interface ViolationInput {
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
       (group_id, member_id, member_display_name, member_role, type)
     VALUES ($1, $2, $3, $4, $5)`,
    [input.groupId, input.memberId, input.memberDisplayName, input.memberRole, input.type],
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
  scope: { groupId: number; memberId: string; type: ViolationType },
  windowSeconds: number,
  now: Date,
): Promise<number> {
  const cutoff = new Date(now.getTime() - windowSeconds * 1000).toISOString();
  const { rows } = await db.query<{ n: string | number }>(
    `SELECT count(*)::int AS n
       FROM cinderella_violations
      WHERE group_id = $1 AND member_id = $2 AND type = $3 AND at >= $4`,
    [scope.groupId, scope.memberId, scope.type, cutoff],
  );
  return Number(rows[0]?.n ?? 0);
}

export interface SanctionInput {
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
       (group_id, member_id, member_display_name, member_role, action,
        violation_type, violation_count, window_seconds, rung_threshold, reason, mode,
        spoken_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11,
             CASE WHEN $12::boolean THEN now() ELSE NULL END)`,
    [
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
}

function toSanction(row: SanctionDbRow): SanctionRow {
  return {
    id: row.id,
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

const SANCTION_COLUMNS = `id, group_id, member_id, member_display_name, member_role, action,
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

export async function listViolations(db: Queryable, limit = 100): Promise<ViolationRow[]> {
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
       FROM cinderella_violations ORDER BY at DESC, id DESC LIMIT $1`,
    [limit],
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
 * The rules of the bot the runtime is hosting, or null when no bot is selected.
 *
 * Null is a real answer and not a default, exactly as with the personality (D-133): an
 * operator who has selected no runtime bot has configured no rules, and handing back a
 * ladder nobody chose would invent one. The caller decides what absence means, and for
 * the engine it means the ladders do not run at all.
 */
export async function runtimeModerationRules(db: Queryable): Promise<ModerationRules | null> {
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
 * Save the ladders for one bot.
 *
 * The mode is deliberately NOT a parameter. CCB-S4-032 implements observation only, and
 * a save path able to write 'enforce' would be an armed switch reachable from a form
 * whose page does not offer it. The arming briefing adds it here, visibly.
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
