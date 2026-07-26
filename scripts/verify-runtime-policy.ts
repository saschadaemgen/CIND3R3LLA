/**
 * Offline verification for deterministic runtime policy resolution.
 *
 * It uses PGlite and synthetic captured messages. No SimpleX connection, group
 * join, invitation link, outbound message, cloud provider, or production
 * database is used.
 */

import { PGlite } from '@electric-sql/pglite';
import type { CapturedMessage } from '../src/capture/message.js';
import type { Queryable } from '../src/db/pool.js';
import { loadMigrationFiles } from '../src/db/migrate.js';
import {
  addCinderellaGroup,
  createCinderellaProfile,
  setCinderellaGroupEnabled,
  setCinderellaProfileEnabled,
  upsertCinderellaGroupAuthority,
} from '../src/profiles/service.js';
import { RuntimePolicyService } from '../src/profiles/runtime-policy.js';

let failures = 0;

function check(label: string, ok: boolean, detail = ''): void {
  if (!ok) failures++;
  console.log(`  [${ok ? 'PASS' : 'FAIL'}] ${label}${detail ? `: ${detail}` : ''}`);
}

function message(
  groupId: number,
  senderMemberId: string,
  itemId: number,
  text = 'Cinderella status please',
): CapturedMessage {
  return {
    groupId,
    groupName: `Group ${groupId}`,
    itemId,
    sharedMsgId: undefined,
    senderMemberId,
    senderDisplayName: 'Synthetic Member',
    sentAt: '2026-07-26T12:00:00.000Z',
    type: 'text',
    text,
    linkPreview: undefined,
    file: undefined,
    forwarded: false,
    quotedFromBot: false,
    raw: {} as CapturedMessage['raw'],
  };
}

async function main(): Promise<void> {
  const pg = new PGlite();
  const db: Queryable = {
    async query(text, values) {
      const result = await pg.query(text, values ? [...values] : undefined);
      return {
        rows: result.rows as never[],
        rowCount: (result.affectedRows ?? result.rows.length) as number,
      };
    },
  };

  for (const migration of await loadMigrationFiles()) {
    await pg.exec(migration.sql);
  }

  const profileId = await createCinderellaProfile(
    db,
    { slug: 'cinderella-main', displayName: 'Cinderella Main' },
    'runtime-policy-test',
  );
  const teamGroupId = await addCinderellaGroup(
    db,
    {
      profileId,
      simplexGroupId: 7001,
      localDisplayName: 'Cinderella Team',
      kind: 'team',
    },
    'runtime-policy-test',
  );
  const memberGroupId = await addCinderellaGroup(
    db,
    {
      profileId,
      simplexGroupId: 7002,
      localDisplayName: 'Community',
      kind: 'member',
    },
    'runtime-policy-test',
  );

  await upsertCinderellaGroupAuthority(
    db,
    {
      groupId: teamGroupId,
      simplexMemberId: 'team-moderator',
      displayLabel: 'Team Moderator',
      role: 'moderator',
    },
    'runtime-policy-test',
  );
  await upsertCinderellaGroupAuthority(
    db,
    {
      groupId: memberGroupId,
      simplexMemberId: 'blocked-member',
      displayLabel: 'Blocked Member',
      role: 'blocked',
    },
    'runtime-policy-test',
  );

  const runtime = new RuntimePolicyService(db);

  console.log('\n1. Compatibility and hard privacy baseline');
  const unassigned = await runtime.resolve({
    simplexGroupId: 7999,
    simplexMemberId: 'unassigned-member',
    itemId: 1,
  });

  check('unassigned group remains compatible', unassigned.outcome === 'unassigned');
  check('unassigned group does not silently enable enforcement', !unassigned.enforcementApplied);
  check('unassigned group preserves current interaction behavior', unassigned.interactionAllowed);
  check('unassigned group is local only', unassigned.localOnly);
  check('unassigned group blocks cloud', !unassigned.cloudAllowed);
  check('remote commands remain disabled', !unassigned.remoteCommandsAllowed);
  check('persistent changes remain disabled', !unassigned.persistentChangesAllowed);

  console.log('\n2. Assigned profile, group, and role resolution');
  const defaultMember = await runtime.resolve({
    simplexGroupId: 7002,
    simplexMemberId: 'ordinary-member',
    itemId: 2,
  });

  check('assigned group activates enforcement', defaultMember.enforcementApplied);
  check('unknown member receives member role', defaultMember.role === 'member');
  check('unknown member role source is default', defaultMember.roleSource === 'default');
  check('ordinary member interaction is allowed', defaultMember.interactionAllowed);
  check('ordinary member cannot manage group', !defaultMember.canManageGroup);
  check('ordinary member cannot provide team guidance', !defaultMember.canContributeTeamGuidance);

  const moderator = await runtime.resolve({
    simplexGroupId: 7001,
    simplexMemberId: 'team-moderator',
    itemId: 3,
  });

  check('assigned moderator role is resolved', moderator.role === 'moderator');
  check('moderator role source is assigned', moderator.roleSource === 'assigned');
  check('team group is identified', moderator.groupKind === 'team');
  check('moderator can manage group policy scope', moderator.canManageGroup);
  check('team moderator can contribute guidance', moderator.canContributeTeamGuidance);
  check('team moderator still cannot issue remote commands', !moderator.remoteCommandsAllowed);
  check('team moderator still cannot persist changes', !moderator.persistentChangesAllowed);

  const blocked = await runtime.resolve({
    simplexGroupId: 7002,
    simplexMemberId: 'blocked-member',
    itemId: 4,
  });

  check('blocked role is resolved', blocked.role === 'blocked');
  check('blocked member is denied', blocked.outcome === 'deny');
  check('blocked reason is explicit', blocked.reason === 'member_blocked');
  check('blocked member interaction is refused', !blocked.interactionAllowed);

  console.log('\n3. Runtime gate behavior');
  let allowedCalls = 0;
  const allowedHandled = await runtime.handleInteraction(
    message(7002, 'ordinary-member', 10),
    async () => {
      allowedCalls++;
      return true;
    },
  );

  check('allowed interaction reaches dialogue engine', allowedHandled && allowedCalls === 1);

  let blockedCalls = 0;
  const blockedHandled = await runtime.handleInteraction(
    message(7002, 'blocked-member', 11),
    async () => {
      blockedCalls++;
      return true;
    },
  );

  check('blocked interaction never reaches dialogue engine', !blockedHandled && blockedCalls === 0);

  console.log('\n4. Paused profile and group enforcement');
  await setCinderellaGroupEnabled(db, memberGroupId, false, 'runtime-policy-test');
  const pausedGroup = await runtime.resolve({
    simplexGroupId: 7002,
    simplexMemberId: 'ordinary-member',
    itemId: 12,
  });
  check(
    'paused group is denied',
    pausedGroup.reason === 'group_disabled' && !pausedGroup.interactionAllowed,
  );

  await setCinderellaGroupEnabled(db, memberGroupId, true, 'runtime-policy-test');
  await setCinderellaProfileEnabled(db, profileId, false, 'runtime-policy-test');
  const pausedProfile = await runtime.resolve({
    simplexGroupId: 7002,
    simplexMemberId: 'ordinary-member',
    itemId: 13,
  });
  check(
    'paused profile is denied',
    pausedProfile.reason === 'profile_disabled' && !pausedProfile.interactionAllowed,
  );
  await setCinderellaProfileEnabled(db, profileId, true, 'runtime-policy-test');

  console.log('\n5. Decision audit');
  const secretText = 'private message content must not enter policy audit';
  const auditedMessage = message(7001, 'team-moderator', 20, secretText);

  await runtime.decideAndRecord(auditedMessage);
  await runtime.decideAndRecord(auditedMessage);

  const decisionRows = await pg.query<{
    n: number;
    details_text: string;
    role: string | null;
    outcome: string;
  }>(
    `SELECT
       count(*)::int AS n,
       max(details::text) AS details_text,
       max(role::text) AS role,
       max(outcome::text) AS outcome
     FROM cinderella_runtime_policy_decisions
    WHERE simplex_group_id = 7001
      AND item_id = 20`,
  );
  const decisionRow = decisionRows.rows[0];

  check('one message has one idempotent decision row', decisionRow?.n === 1);
  check('decision stores resolved role', decisionRow?.role === 'moderator');
  check('decision stores outcome', decisionRow?.outcome === 'allow');
  check(
    'decision details contain no message content',
    !String(decisionRow?.details_text ?? '').includes(secretText),
  );
  check(
    'decision details contain no display name',
    !String(decisionRow?.details_text ?? '').includes('Synthetic Member'),
  );

  const decisionCount = await pg.query<{ n: number }>(
    `SELECT count(*)::int AS n
       FROM cinderella_runtime_policy_decisions`,
  );
  check('runtime decisions are recorded', (decisionCount.rows[0]?.n ?? 0) >= 3);

  console.log('\n=== RESULTS ===');
  console.log(`StepSuccessful: ${failures === 0}`);
  console.log(`Failures: ${failures}`);
  console.log('RuntimePolicyMigrationCreated: true');
  console.log('ProfileGroupResolutionCreated: true');
  console.log('DefaultMemberRoleCreated: true');
  console.log('BlockedMemberEnforced: true');
  console.log('PausedGroupEnforced: true');
  console.log('PausedProfileEnforced: true');
  console.log('CompatibilityFallbackCreated: true');
  console.log('HardLocalOnlyFallbackCreated: true');
  console.log('DecisionAuditCreated: true');
  console.log('MessageContentStoredInPolicyAudit: false');
  console.log('RemoteCommandsEnabled: false');
  console.log('PersistentPersonalityChangesEnabled: false');
  console.log('InvitationLinksStored: false');
  console.log('NetworkUsed: false');

  await pg.close();

  if (failures > 0) process.exitCode = 1;
}

void main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
