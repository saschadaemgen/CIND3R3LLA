/**
 * Persistent profile, group, and authority configuration for Cinderella.
 *
 * The service stores policy assignments against technical SimpleX identifiers.
 * It does not connect to SimpleX, join a group, process invitation links, or
 * execute remote commands. Those actions require separate guarded phases.
 */

import { writeAudit } from '../db/audit.js';
import type { Queryable } from '../db/pool.js';

export type CinderellaGroupKind = 'team' | 'member' | 'test';
export type CinderellaProfileRole = 'owner' | 'administrator' | 'auditor';
export type CinderellaGroupRole =
  'owner' | 'administrator' | 'moderator' | 'team_member' | 'member' | 'auditor' | 'blocked';
export type CinderellaIdentityType = 'user' | 'contact';

export interface CinderellaProfileAuthority {
  id: number;
  profileId: number;
  identityType: CinderellaIdentityType;
  simplexId: number;
  displayLabel: string;
  role: CinderellaProfileRole;
  enabled: boolean;
}

export interface CinderellaGroupAuthority {
  id: number;
  groupId: number;
  simplexMemberId: string;
  displayLabel: string;
  role: CinderellaGroupRole;
  enabled: boolean;
}

export interface CinderellaGroup {
  id: number;
  profileId: number;
  simplexGroupId: number;
  localDisplayName: string;
  kind: CinderellaGroupKind;
  enabled: boolean;
  inheritProfile: boolean;
  authorities: CinderellaGroupAuthority[];
}

export interface CinderellaProfile {
  id: number;
  slug: string;
  displayName: string;
  enabled: boolean;
  localOnly: boolean;
  cloudAllowed: boolean;
  personalityProfile: string;
  authorities: CinderellaProfileAuthority[];
  groups: CinderellaGroup[];
}

const PROFILE_ROLES = new Set<CinderellaProfileRole>(['owner', 'administrator', 'auditor']);
const GROUP_ROLES = new Set<CinderellaGroupRole>([
  'owner',
  'administrator',
  'moderator',
  'team_member',
  'member',
  'auditor',
  'blocked',
]);
const GROUP_KINDS = new Set<CinderellaGroupKind>(['team', 'member', 'test']);
const IDENTITY_TYPES = new Set<CinderellaIdentityType>(['user', 'contact']);

function positiveInteger(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${label} must be a positive integer.`);
  }

  return value;
}

function requiredText(value: string, label: string, max: number): string {
  const cleaned = value.trim();

  if (!cleaned) throw new Error(`${label} is required.`);
  if (cleaned.length > max) throw new Error(`${label} must not exceed ${max} characters.`);

  return cleaned;
}

function profileSlug(value: string): string {
  const cleaned = value.trim().toLowerCase();

  if (!/^[a-z0-9][a-z0-9-]{1,62}$/.test(cleaned)) {
    throw new Error(
      'Profile slug must use 2 to 63 lowercase letters, numbers, or hyphens and start with a letter or number.',
    );
  }

  return cleaned;
}

function dbError(error: unknown): Error {
  const message = error instanceof Error ? error.message : String(error);

  if (message.includes('cinderella_one_team_group_per_profile_idx')) {
    return new Error('This profile already has a team group.');
  }

  if (message.includes('cinderella_one_owner_per_profile_idx')) {
    return new Error('This profile already has an enabled owner.');
  }

  if (message.includes('cinderella_profiles_slug_key')) {
    return new Error('A profile with this slug already exists.');
  }

  if (message.includes('cinderella_groups_simplex_group_id_key')) {
    return new Error('This SimpleX group ID is already assigned.');
  }

  return error instanceof Error ? error : new Error(message);
}

function numberOf(value: string | number): number {
  return Number(value);
}

export async function listCinderellaProfiles(db: Queryable): Promise<CinderellaProfile[]> {
  const profileRows = await db.query<{
    id: string;
    slug: string;
    display_name: string;
    enabled: boolean;
    local_only: boolean;
    cloud_allowed: boolean;
    personality_profile: string;
  }>(
    `SELECT id, slug, display_name, enabled, local_only, cloud_allowed, personality_profile
       FROM cinderella_profiles
      ORDER BY display_name, id`,
  );

  const groupRows = await db.query<{
    id: string;
    profile_id: string;
    simplex_group_id: string;
    local_display_name: string;
    kind: CinderellaGroupKind;
    enabled: boolean;
    inherit_profile: boolean;
  }>(
    `SELECT id, profile_id, simplex_group_id, local_display_name, kind, enabled, inherit_profile
       FROM cinderella_groups
      ORDER BY profile_id, kind, local_display_name, id`,
  );

  const profileAuthorityRows = await db.query<{
    id: string;
    profile_id: string;
    identity_type: CinderellaIdentityType;
    simplex_id: string;
    display_label: string;
    role: CinderellaProfileRole;
    enabled: boolean;
  }>(
    `SELECT id, profile_id, identity_type, simplex_id, display_label, role, enabled
       FROM cinderella_profile_authorities
      ORDER BY profile_id, role, display_label, id`,
  );

  const groupAuthorityRows = await db.query<{
    id: string;
    group_id: string;
    simplex_member_id: string;
    display_label: string;
    role: CinderellaGroupRole;
    enabled: boolean;
  }>(
    `SELECT id, group_id, simplex_member_id, display_label, role, enabled
       FROM cinderella_group_authorities
      ORDER BY group_id, role, display_label, id`,
  );

  const authoritiesByGroup = new Map<number, CinderellaGroupAuthority[]>();

  for (const row of groupAuthorityRows.rows) {
    const groupId = numberOf(row.group_id);
    const list = authoritiesByGroup.get(groupId) ?? [];

    list.push({
      id: numberOf(row.id),
      groupId,
      simplexMemberId: row.simplex_member_id,
      displayLabel: row.display_label,
      role: row.role,
      enabled: row.enabled,
    });

    authoritiesByGroup.set(groupId, list);
  }

  const groupsByProfile = new Map<number, CinderellaGroup[]>();

  for (const row of groupRows.rows) {
    const profileId = numberOf(row.profile_id);
    const id = numberOf(row.id);
    const list = groupsByProfile.get(profileId) ?? [];

    list.push({
      id,
      profileId,
      simplexGroupId: numberOf(row.simplex_group_id),
      localDisplayName: row.local_display_name,
      kind: row.kind,
      enabled: row.enabled,
      inheritProfile: row.inherit_profile,
      authorities: authoritiesByGroup.get(id) ?? [],
    });

    groupsByProfile.set(profileId, list);
  }

  const authoritiesByProfile = new Map<number, CinderellaProfileAuthority[]>();

  for (const row of profileAuthorityRows.rows) {
    const profileId = numberOf(row.profile_id);
    const list = authoritiesByProfile.get(profileId) ?? [];

    list.push({
      id: numberOf(row.id),
      profileId,
      identityType: row.identity_type,
      simplexId: numberOf(row.simplex_id),
      displayLabel: row.display_label,
      role: row.role,
      enabled: row.enabled,
    });

    authoritiesByProfile.set(profileId, list);
  }

  return profileRows.rows.map((row) => {
    const id = numberOf(row.id);

    return {
      id,
      slug: row.slug,
      displayName: row.display_name,
      enabled: row.enabled,
      localOnly: row.local_only,
      cloudAllowed: row.cloud_allowed,
      personalityProfile: row.personality_profile,
      authorities: authoritiesByProfile.get(id) ?? [],
      groups: groupsByProfile.get(id) ?? [],
    };
  });
}

export async function createCinderellaProfile(
  db: Queryable,
  input: { slug: string; displayName: string },
  actor: string,
): Promise<number> {
  try {
    const result = await db.query<{ id: string }>(
      `INSERT INTO cinderella_profiles (slug, display_name)
       VALUES ($1, $2)
       RETURNING id`,
      [profileSlug(input.slug), requiredText(input.displayName, 'Display name', 80)],
    );
    const id = numberOf(result.rows[0]?.id ?? 0);

    await writeAudit(db, actor, 'cinderella.profile.create', `profile:${id}`, {
      slug: profileSlug(input.slug),
      displayName: requiredText(input.displayName, 'Display name', 80),
      localOnly: true,
      cloudAllowed: false,
    });

    return id;
  } catch (error) {
    throw dbError(error);
  }
}

export async function setCinderellaProfileEnabled(
  db: Queryable,
  profileId: number,
  enabled: boolean,
  actor: string,
): Promise<void> {
  const id = positiveInteger(profileId, 'Profile ID');
  const result = await db.query(
    `UPDATE cinderella_profiles
        SET enabled = $2,
            updated_at = now()
      WHERE id = $1`,
    [id, enabled],
  );

  if (result.rowCount !== 1) throw new Error('Profile not found.');

  await writeAudit(db, actor, 'cinderella.profile.enabled', `profile:${id}`, { enabled });
}

export async function addCinderellaGroup(
  db: Queryable,
  input: {
    profileId: number;
    simplexGroupId: number;
    localDisplayName: string;
    kind: CinderellaGroupKind;
  },
  actor: string,
): Promise<number> {
  const profileId = positiveInteger(input.profileId, 'Profile ID');
  const simplexGroupId = positiveInteger(input.simplexGroupId, 'SimpleX group ID');

  if (!GROUP_KINDS.has(input.kind)) throw new Error('Invalid group kind.');

  try {
    const result = await db.query<{ id: string }>(
      `INSERT INTO cinderella_groups
         (profile_id, simplex_group_id, local_display_name, kind)
       VALUES ($1, $2, $3, $4)
       RETURNING id`,
      [
        profileId,
        simplexGroupId,
        requiredText(input.localDisplayName, 'Group display name', 120),
        input.kind,
      ],
    );
    const id = numberOf(result.rows[0]?.id ?? 0);

    await writeAudit(db, actor, 'cinderella.group.create', `group:${id}`, {
      profileId,
      simplexGroupId,
      localDisplayName: requiredText(input.localDisplayName, 'Group display name', 120),
      kind: input.kind,
    });

    return id;
  } catch (error) {
    throw dbError(error);
  }
}

export async function setCinderellaGroupEnabled(
  db: Queryable,
  groupId: number,
  enabled: boolean,
  actor: string,
): Promise<void> {
  const id = positiveInteger(groupId, 'Group ID');
  const result = await db.query(
    `UPDATE cinderella_groups
        SET enabled = $2,
            updated_at = now()
      WHERE id = $1`,
    [id, enabled],
  );

  if (result.rowCount !== 1) throw new Error('Group not found.');

  await writeAudit(db, actor, 'cinderella.group.enabled', `group:${id}`, { enabled });
}

export async function upsertCinderellaProfileAuthority(
  db: Queryable,
  input: {
    profileId: number;
    identityType: CinderellaIdentityType;
    simplexId: number;
    displayLabel: string;
    role: CinderellaProfileRole;
  },
  actor: string,
): Promise<number> {
  const profileId = positiveInteger(input.profileId, 'Profile ID');
  const simplexId = positiveInteger(input.simplexId, 'SimpleX identity ID');

  if (!IDENTITY_TYPES.has(input.identityType)) throw new Error('Invalid identity type.');
  if (!PROFILE_ROLES.has(input.role)) throw new Error('Invalid profile role.');

  try {
    const result = await db.query<{ id: string }>(
      `INSERT INTO cinderella_profile_authorities
         (profile_id, identity_type, simplex_id, display_label, role)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (profile_id, identity_type, simplex_id)
       DO UPDATE SET
         display_label = EXCLUDED.display_label,
         role = EXCLUDED.role,
         enabled = TRUE,
         updated_at = now()
       RETURNING id`,
      [
        profileId,
        input.identityType,
        simplexId,
        requiredText(input.displayLabel, 'Display label', 120),
        input.role,
      ],
    );
    const id = numberOf(result.rows[0]?.id ?? 0);

    await writeAudit(db, actor, 'cinderella.profile-authority.upsert', `authority:${id}`, {
      profileId,
      identityType: input.identityType,
      simplexId,
      displayLabel: requiredText(input.displayLabel, 'Display label', 120),
      role: input.role,
    });

    return id;
  } catch (error) {
    throw dbError(error);
  }
}

export async function upsertCinderellaGroupAuthority(
  db: Queryable,
  input: {
    groupId: number;
    simplexMemberId: string;
    displayLabel: string;
    role: CinderellaGroupRole;
  },
  actor: string,
): Promise<number> {
  const groupId = positiveInteger(input.groupId, 'Group ID');

  if (!GROUP_ROLES.has(input.role)) throw new Error('Invalid group role.');

  const memberId = requiredText(input.simplexMemberId, 'SimpleX member ID', 240);
  const label = requiredText(input.displayLabel, 'Display label', 120);

  const result = await db.query<{ id: string }>(
    `INSERT INTO cinderella_group_authorities
       (group_id, simplex_member_id, display_label, role)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (group_id, simplex_member_id)
     DO UPDATE SET
       display_label = EXCLUDED.display_label,
       role = EXCLUDED.role,
       enabled = TRUE,
       updated_at = now()
     RETURNING id`,
    [groupId, memberId, label, input.role],
  );
  const id = numberOf(result.rows[0]?.id ?? 0);

  await writeAudit(db, actor, 'cinderella.group-authority.upsert', `authority:${id}`, {
    groupId,
    simplexMemberId: memberId,
    displayLabel: label,
    role: input.role,
  });

  return id;
}
