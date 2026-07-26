/**
 * Deterministic runtime policy resolution for incoming SimpleX group messages.
 *
 * The resolver maps one technical SimpleX group and member identity to the
 * configured Cinderella profile, group, role, and hard privacy baseline.
 *
 * It never executes a command, changes personality, joins a group, accepts an
 * invitation link, or calls an external provider.
 */

import type { CapturedMessage } from '../capture/message.js';
import type { Queryable } from '../db/pool.js';
import type { CinderellaGroupKind, CinderellaGroupRole } from './service.js';

export type RuntimePolicyOutcome = 'allow' | 'deny' | 'unassigned';
export type RuntimePolicyReason =
  'allowed' | 'group_unassigned' | 'profile_disabled' | 'group_disabled' | 'member_blocked';
export type RuntimePolicySource = 'compatibility' | 'profile-group';
export type RuntimeRoleSource = 'assigned' | 'default' | 'none';

export interface RuntimePolicyInput {
  simplexGroupId: number;
  simplexMemberId: string;
  itemId: number;
}

export interface RuntimePolicyDecision {
  outcome: RuntimePolicyOutcome;
  reason: RuntimePolicyReason;
  policySource: RuntimePolicySource;
  enforcementApplied: boolean;
  profileId: number | null;
  profileSlug: string | null;
  groupId: number | null;
  groupKind: CinderellaGroupKind | null;
  inheritProfile: boolean;
  role: CinderellaGroupRole | null;
  roleSource: RuntimeRoleSource;
  interactionAllowed: boolean;
  localOnly: boolean;
  cloudAllowed: boolean;
  canManageGroup: boolean;
  canContributeTeamGuidance: boolean;
  remoteCommandsAllowed: false;
  persistentChangesAllowed: false;
}

interface PolicyRow {
  profile_id: string;
  profile_slug: string;
  profile_enabled: boolean;
  local_only: boolean;
  cloud_allowed: boolean;
  group_id: string;
  group_kind: CinderellaGroupKind;
  group_enabled: boolean;
  inherit_profile: boolean;
  role: CinderellaGroupRole | null;
}

const MANAGEMENT_ROLES = new Set<CinderellaGroupRole>(['owner', 'administrator', 'moderator']);
const TEAM_GUIDANCE_ROLES = new Set<CinderellaGroupRole>([
  'owner',
  'administrator',
  'moderator',
  'team_member',
]);

function positiveInteger(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${label} must be a positive integer.`);
  }

  return value;
}

function memberId(value: string): string {
  const cleaned = value.trim();

  if (!cleaned) throw new Error('SimpleX member ID is required.');
  if (cleaned.length > 240) throw new Error('SimpleX member ID must not exceed 240 characters.');

  return cleaned;
}

function compatibilityDecision(): RuntimePolicyDecision {
  return {
    outcome: 'unassigned',
    reason: 'group_unassigned',
    policySource: 'compatibility',
    enforcementApplied: false,
    profileId: null,
    profileSlug: null,
    groupId: null,
    groupKind: null,
    inheritProfile: true,
    role: null,
    roleSource: 'none',
    interactionAllowed: true,
    localOnly: true,
    cloudAllowed: false,
    canManageGroup: false,
    canContributeTeamGuidance: false,
    remoteCommandsAllowed: false,
    persistentChangesAllowed: false,
  };
}

function assignedDecision(row: PolicyRow): RuntimePolicyDecision {
  const role = row.role ?? 'member';
  const roleSource: RuntimeRoleSource = row.role === null ? 'default' : 'assigned';
  const localOnly = row.local_only;
  const cloudAllowed = localOnly ? false : row.cloud_allowed;

  let outcome: RuntimePolicyOutcome = 'allow';
  let reason: RuntimePolicyReason = 'allowed';

  if (!row.profile_enabled) {
    outcome = 'deny';
    reason = 'profile_disabled';
  } else if (!row.group_enabled) {
    outcome = 'deny';
    reason = 'group_disabled';
  } else if (role === 'blocked') {
    outcome = 'deny';
    reason = 'member_blocked';
  }

  const interactionAllowed = outcome === 'allow';

  return {
    outcome,
    reason,
    policySource: 'profile-group',
    enforcementApplied: true,
    profileId: Number(row.profile_id),
    profileSlug: row.profile_slug,
    groupId: Number(row.group_id),
    groupKind: row.group_kind,
    inheritProfile: row.inherit_profile,
    role,
    roleSource,
    interactionAllowed,
    localOnly,
    cloudAllowed,
    canManageGroup: interactionAllowed && MANAGEMENT_ROLES.has(role),
    canContributeTeamGuidance:
      interactionAllowed && row.group_kind === 'team' && TEAM_GUIDANCE_ROLES.has(role),
    remoteCommandsAllowed: false,
    persistentChangesAllowed: false,
  };
}

export class RuntimePolicyService {
  constructor(private readonly db: Queryable) {}

  async resolve(input: RuntimePolicyInput): Promise<RuntimePolicyDecision> {
    const simplexGroupId = positiveInteger(input.simplexGroupId, 'SimpleX group ID');
    const simplexMemberId = memberId(input.simplexMemberId);
    positiveInteger(input.itemId, 'SimpleX item ID');

    const result = await this.db.query<PolicyRow>(
      `SELECT
         p.id AS profile_id,
         p.slug AS profile_slug,
         p.enabled AS profile_enabled,
         p.local_only,
         p.cloud_allowed,
         g.id AS group_id,
         g.kind AS group_kind,
         g.enabled AS group_enabled,
         g.inherit_profile,
         ga.role
       FROM cinderella_groups g
       JOIN cinderella_profiles p
         ON p.id = g.profile_id
       LEFT JOIN cinderella_group_authorities ga
         ON ga.group_id = g.id
        AND ga.simplex_member_id = $2
        AND ga.enabled = TRUE
      WHERE g.simplex_group_id = $1
      LIMIT 1`,
      [simplexGroupId, simplexMemberId],
    );

    const row = result.rows[0];

    return row ? assignedDecision(row) : compatibilityDecision();
  }

  async decideAndRecord(msg: CapturedMessage): Promise<RuntimePolicyDecision> {
    const input: RuntimePolicyInput = {
      simplexGroupId: msg.groupId,
      simplexMemberId: msg.senderMemberId,
      itemId: msg.itemId,
    };
    const decision = await this.resolve(input);

    await this.db.query(
      `INSERT INTO cinderella_runtime_policy_decisions
         (
           profile_id,
           group_id,
           simplex_group_id,
           simplex_member_id,
           item_id,
           outcome,
           reason,
           role,
           group_kind,
           local_only,
           cloud_allowed,
           details
         )
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12::jsonb)
       ON CONFLICT (simplex_group_id, item_id)
       DO UPDATE SET
         decided_at = now(),
         profile_id = EXCLUDED.profile_id,
         group_id = EXCLUDED.group_id,
         simplex_member_id = EXCLUDED.simplex_member_id,
         outcome = EXCLUDED.outcome,
         reason = EXCLUDED.reason,
         role = EXCLUDED.role,
         group_kind = EXCLUDED.group_kind,
         local_only = EXCLUDED.local_only,
         cloud_allowed = EXCLUDED.cloud_allowed,
         details = EXCLUDED.details`,
      [
        decision.profileId,
        decision.groupId,
        input.simplexGroupId,
        input.simplexMemberId,
        input.itemId,
        decision.outcome,
        decision.reason,
        decision.role,
        decision.groupKind,
        decision.localOnly,
        decision.cloudAllowed,
        JSON.stringify({
          policySource: decision.policySource,
          enforcementApplied: decision.enforcementApplied,
          profileSlug: decision.profileSlug,
          inheritProfile: decision.inheritProfile,
          roleSource: decision.roleSource,
          interactionAllowed: decision.interactionAllowed,
          canManageGroup: decision.canManageGroup,
          canContributeTeamGuidance: decision.canContributeTeamGuidance,
          remoteCommandsAllowed: decision.remoteCommandsAllowed,
          persistentChangesAllowed: decision.persistentChangesAllowed,
        }),
      ],
    );

    return decision;
  }

  async handleInteraction(
    msg: CapturedMessage,
    next: (decision: RuntimePolicyDecision) => Promise<boolean>,
  ): Promise<boolean> {
    const decision = await this.decideAndRecord(msg);

    if (!decision.interactionAllowed) return false;

    return next(decision);
  }
}
