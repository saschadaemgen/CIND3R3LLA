/**
 * Group invitations for the bot being onboarded (CCB-S4-025, D-129).
 *
 * Step three, and the same shape as step two by design: an event arrives on its own, a
 * listener records it, the console offers an action, and the action's real result moves
 * the state. D-127 settled that split so it would not be improvised again here.
 *
 * ── THE ROLE IS THREE DIFFERENT FACTS AND THIS MODULE KEEPS THEM APART ──────
 *
 *   invited_as_role   what the invitation offered   (`receivedGroupInvitation.memberRole`)
 *   joined_role       what the bot actually holds   (`groupInfo.membership.memberRole`)
 *   expectedGroupRole what the operator wants       (on `cinderella_bot_profiles`)
 *
 * Joining proves the second. It proves nothing about the third, and the page must not
 * say otherwise: checking them against each other is step four.
 */

import { writeAudit } from '../db/audit.js';
import { log } from '../log.js';
import { status } from '../web/status.js';
import type { Queryable } from '../db/pool.js';
import type { ChatEventSource } from '../bot/runtime/events.js';

export type GroupInvitationState = 'pending' | 'joined';

export interface BotGroupInvitation {
  id: number;
  botProfileId: number;
  /** The core's own group id. The join is issued with exactly this. */
  groupId: number;
  simplexUserId: number;
  groupName: string;
  inviterName: string;
  /** The role the invitation offered. Not a promise. */
  invitedAsRole: string;
  receivedAt: string;
  state: GroupInvitationState;
  resolvedAt: string | null;
  /** The role the core reports once the bot is a member. */
  joinedRole: string | null;
  joinedAt: string | null;
}

interface Row {
  id: string | number;
  bot_profile_id: string | number;
  group_id: string | number;
  simplex_user_id: string | number;
  group_name: string;
  inviter_name: string;
  invited_as_role: string;
  received_at: string;
  state: GroupInvitationState;
  resolved_at: string | null;
  joined_role: string | null;
  joined_at: string | null;
}

const n = (v: string | number): number => Number(v);

function mapRow(row: Row): BotGroupInvitation {
  return {
    id: n(row.id),
    botProfileId: n(row.bot_profile_id),
    groupId: n(row.group_id),
    simplexUserId: n(row.simplex_user_id),
    groupName: row.group_name,
    inviterName: row.inviter_name,
    invitedAsRole: row.invited_as_role,
    receivedAt: row.received_at,
    state: row.state,
    resolvedAt: row.resolved_at,
    joinedRole: row.joined_role,
    joinedAt: row.joined_at,
  };
}

const COLUMNS = `
  id, bot_profile_id, group_id, simplex_user_id, group_name, inviter_name,
  invited_as_role, received_at, state, resolved_at, joined_role, joined_at
`;

export async function listGroupInvitations(
  db: Queryable,
  botProfileId: number,
): Promise<BotGroupInvitation[]> {
  const { rows } = await db.query<Row>(
    `SELECT ${COLUMNS}
       FROM cinderella_bot_group_invitations
      WHERE bot_profile_id = $1
      ORDER BY (state = 'pending') DESC, received_at DESC`,
    [botProfileId],
  );
  return rows.map(mapRow);
}

/**
 * Record an invitation the core reported, and move the workflow to pending.
 *
 * Advances from `contact_connected` as well as from `waiting_group_invitation`, because
 * nothing moves the workflow into the latter: after step two the page says "invite the
 * bot into a group" and the operator simply does it. Gating on only one of the two would
 * leave a real invitation recorded against a workflow that never noticed.
 */
export async function recordIncomingGroupInvitation(
  db: Queryable,
  botProfileId: number,
  invitation: {
    groupId: number;
    simplexUserId: number;
    groupName: string;
    inviterName: string;
    invitedAsRole: string;
  },
): Promise<{ recorded: boolean }> {
  const { rows } = await db.query<{ id: string }>(
    `INSERT INTO cinderella_bot_group_invitations
       (bot_profile_id, group_id, simplex_user_id, group_name, inviter_name, invited_as_role)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (bot_profile_id, group_id) DO NOTHING
     RETURNING id`,
    [
      botProfileId,
      invitation.groupId,
      invitation.simplexUserId,
      invitation.groupName,
      invitation.inviterName,
      invitation.invitedAsRole,
    ],
  );
  const recorded = rows.length > 0;

  if (recorded) {
    await db.query(
      `UPDATE cinderella_bot_profiles
          SET workflow_state = 'group_invitation_pending',
              updated_at = now()
        WHERE id = $1
          AND workflow_state IN ('contact_connected', 'waiting_group_invitation')`,
      [botProfileId],
    );
  }
  return { recorded };
}

/**
 * Mark an invitation joined, with the role the core reports for the membership.
 *
 * The role is required, not optional. A joined row with no role would be the page
 * saying the bot is in the group while having nothing to say about what it can do
 * there, which is the question step four exists to answer.
 */
export async function recordJoinedGroup(
  db: Queryable,
  botProfileId: number,
  groupId: number,
  joined: { role: string },
  actor: string,
): Promise<void> {
  if (!joined.role.trim()) {
    throw new Error('Refusing to record a join without the role the core reported.');
  }

  const result = await db.query(
    `UPDATE cinderella_bot_group_invitations
        SET state = 'joined',
            resolved_at = now(),
            joined_role = $3
      WHERE bot_profile_id = $1 AND group_id = $2 AND state = 'pending'`,
    [botProfileId, groupId, joined.role.trim()],
  );
  if (result.rowCount !== 1) {
    throw new Error('That group invitation is no longer pending.');
  }

  await db.query(
    `UPDATE cinderella_bot_profiles
        SET workflow_state = 'joined',
            updated_at = now()
      WHERE id = $1`,
    [botProfileId],
  );

  await writeAudit(db, actor, 'cinderella.bot-profile.group-joined', `bot-profile:${botProfileId}`, {
    groupId,
    joinedRole: joined.role,
    workflowState: 'joined',
    roleVerified: false,
    runtimeApplied: true,
  });
}

/**
 * Stamp the moment the core said the bot's membership was live.
 *
 * `apiJoinGroup` returning is the command being accepted; `userJoinedGroup` is the
 * membership actually existing. The same distinction step two draws between accepted
 * and connected, for the same reason: the operator's own group shows the difference.
 */
export async function recordGroupJoinConfirmed(
  db: Queryable,
  simplexUserId: number,
  groupId: number,
  role: string | null,
): Promise<boolean> {
  const result = await db.query(
    `UPDATE cinderella_bot_group_invitations
        SET joined_at = COALESCE(joined_at, now()),
            joined_role = COALESCE($3, joined_role)
      WHERE simplex_user_id = $1 AND group_id = $2 AND state = 'joined'`,
    [simplexUserId, groupId, role],
  );
  return result.rowCount === 1;
}

/**
 * Attach the group-invitation listeners to the runtime's event flow.
 *
 * `receivedGroupInvitation` and `userJoinedGroup` must BOTH be in the runtime's
 * `ROUTED_TAGS` or these handlers can never fire. That is not a footnote: it is the
 * exact deafness CCB-S4-024's guard was built to predict for this step, and
 * `verify:runtime-host` checks it.
 */
export function registerGroupInvitationListener(
  events: ChatEventSource,
  db: Queryable,
  resolveProfileId: () => Promise<number | null>,
): void {
  events.on('receivedGroupInvitation', async (ev) => {
    const groupId = ev.groupInfo?.groupId;
    const simplexUserId = ev.user?.userId;
    if (typeof groupId !== 'number' || typeof simplexUserId !== 'number') {
      log.warn('onboarding: group invitation event without a group id, ignored', { ev });
      status.error(
        'A SimpleX group invitation arrived that could not be recorded (the event carried ' +
          'no group id), so it will not appear on the AI Bot Setup page.',
      );
      return;
    }

    const botProfileId = await resolveProfileId();
    if (botProfileId === null) {
      log.warn('onboarding: group invitation arrived with no runtime bot record to file it against', {
        groupId,
      });
      // Reworded under CCB-S5-008, same correction as the contact-request listener: the
      // caller resolves the bot that RECEIVED the invitation, so null means that bot has no
      // configuration record rather than that nobody is the primary.
      status.error(
        `A SimpleX group invitation arrived (group ${groupId}) but the bot that received it ` +
          `has no configuration record, so it could not be recorded. Check the AI Bot Setup ` +
          `page and ask the inviter to try again.`,
      );
      return;
    }

    const groupName =
      ev.groupInfo?.groupProfile?.displayName?.trim() ??
      ev.groupInfo?.localDisplayName?.trim() ??
      'unknown group';
    const inviterName =
      ev.contact?.profile?.displayName?.trim() ??
      ev.contact?.localDisplayName?.trim() ??
      'unknown';

    const { recorded } = await recordIncomingGroupInvitation(db, botProfileId, {
      groupId,
      simplexUserId,
      groupName,
      inviterName,
      // What the invitation OFFERS. The core decides the real one on join.
      invitedAsRole: String(ev.memberRole ?? 'unknown'),
    });
    log.info('onboarding: group invitation received', {
      groupId,
      botProfileId,
      invitedAsRole: String(ev.memberRole ?? 'unknown'),
      recorded,
      note: recorded ? 'recorded and awaiting the operator' : 'already known, not duplicated',
    });
  });

  events.on('userJoinedGroup', async (ev) => {
    const groupId = ev.groupInfo?.groupId;
    const simplexUserId = ev.user?.userId;
    if (typeof groupId !== 'number' || typeof simplexUserId !== 'number') return;
    const role = ev.groupInfo?.membership?.memberRole;
    const stamped = await recordGroupJoinConfirmed(
      db,
      simplexUserId,
      groupId,
      typeof role === 'string' ? role : null,
    );
    if (stamped) {
      log.info('onboarding: the group membership is live', { groupId, role: String(role) });
    }
  });
}
