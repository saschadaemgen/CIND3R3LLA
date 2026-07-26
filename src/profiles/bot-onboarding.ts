/**
 * Persistent SimpleX bot onboarding configuration.
 *
 * This service stores desired BotOptions, address settings, workflow policy,
 * and safety controls. It does not invoke the SimpleX SDK.
 */

import { writeAudit } from '../db/audit.js';
import type { Queryable } from '../db/pool.js';

export type BotWorkflowState =
  | 'configured'
  | 'waiting_contact_request'
  | 'contact_request_pending'
  | 'contact_connected'
  | 'waiting_group_invitation'
  | 'group_invitation_pending'
  | 'joined'
  | 'waiting_expected_role'
  | 'role_verified'
  | 'ready'
  | 'error';

export type CommandRegistryMode = 'disabled' | 'cinderella_defaults' | 'custom';

export type GroupInvitationMode = 'manual' | 'automatic' | 'approved_contacts' | 'approved_groups';

export type SdkGroupRole =
  'relay' | 'observer' | 'author' | 'member' | 'moderator' | 'admin' | 'owner';

export type PolicyActivationMode = 'manual' | 'automatic_after_verification';

export interface BotOnboardingProfile {
  id: number;
  slug: string;
  displayName: string;
  enabled: boolean;
  selectedForRuntime: boolean;
  workflowState: BotWorkflowState;
  sdkVersion: string;
  sdkTypesVersion: string;
  createAddress: boolean;
  updateAddress: boolean;
  updateProfile: boolean;
  autoAcceptContacts: boolean;
  welcomeMessage: string;
  businessAddress: boolean;
  allowFiles: boolean;
  commandRegistryMode: CommandRegistryMode;
  customCommands: unknown[];
  useBotProfile: boolean;
  logContacts: boolean;
  logNetwork: boolean;
  groupInvitationMode: GroupInvitationMode;
  expectedGroupRole: SdkGroupRole;
  roleVerificationRequired: boolean;
  policyActivationMode: PolicyActivationMode;
  remoteCommandsEnabled: boolean;
  persistentChangesEnabled: boolean;
  contactRequestRetentionHours: number;
  groupInvitationRetentionHours: number;
  maxPendingContactRequests: number;
  createdAt: string;
  updatedAt: string;
}

export type BotOnboardingInput = Omit<
  BotOnboardingProfile,
  'id' | 'workflowState' | 'sdkVersion' | 'sdkTypesVersion' | 'createdAt' | 'updatedAt'
>;

const COMMAND_MODES = new Set<CommandRegistryMode>(['disabled', 'cinderella_defaults', 'custom']);

const GROUP_INVITATION_MODES = new Set<GroupInvitationMode>([
  'manual',
  'automatic',
  'approved_contacts',
  'approved_groups',
]);

const SDK_ROLES = new Set<SdkGroupRole>([
  'relay',
  'observer',
  'author',
  'member',
  'moderator',
  'admin',
  'owner',
]);

const POLICY_ACTIVATION_MODES = new Set<PolicyActivationMode>([
  'manual',
  'automatic_after_verification',
]);

function requiredText(value: string, label: string, max: number): string {
  const cleaned = value.trim();

  if (!cleaned) throw new Error(`${label} is required.`);
  if (cleaned.length > max) throw new Error(`${label} must not exceed ${max} characters.`);

  return cleaned;
}

function optionalText(value: string, max: number): string {
  const cleaned = value.trim();

  if (cleaned.length > max) throw new Error(`Text must not exceed ${max} characters.`);

  return cleaned;
}

function profileSlug(value: string): string {
  const cleaned = value.trim().toLowerCase();

  if (!/^[a-z0-9][a-z0-9-]{1,62}$/.test(cleaned)) {
    throw new Error(
      'Bot profile slug must use 2 to 63 lowercase letters, numbers, or hyphens and start with a letter or number.',
    );
  }

  return cleaned;
}

function boundedInteger(value: number, label: string, min: number, max: number): number {
  if (!Number.isSafeInteger(value) || value < min || value > max) {
    throw new Error(`${label} must be an integer between ${min} and ${max}.`);
  }

  return value;
}

function validateInput(input: BotOnboardingInput): BotOnboardingInput {
  if (!COMMAND_MODES.has(input.commandRegistryMode)) {
    throw new Error('Invalid command registry mode.');
  }

  if (!GROUP_INVITATION_MODES.has(input.groupInvitationMode)) {
    throw new Error('Invalid group invitation mode.');
  }

  if (!SDK_ROLES.has(input.expectedGroupRole)) {
    throw new Error('Invalid expected SimpleX group role.');
  }

  if (!POLICY_ACTIVATION_MODES.has(input.policyActivationMode)) {
    throw new Error('Invalid policy activation mode.');
  }

  if (!Array.isArray(input.customCommands)) {
    throw new Error('Custom commands must be a JSON array.');
  }

  return {
    ...input,
    slug: profileSlug(input.slug),
    displayName: requiredText(input.displayName, 'Bot profile name', 80),
    welcomeMessage: optionalText(input.welcomeMessage, 4000),
    contactRequestRetentionHours: boundedInteger(
      input.contactRequestRetentionHours,
      'Contact request retention',
      1,
      8760,
    ),
    groupInvitationRetentionHours: boundedInteger(
      input.groupInvitationRetentionHours,
      'Group invitation retention',
      1,
      8760,
    ),
    maxPendingContactRequests: boundedInteger(
      input.maxPendingContactRequests,
      'Maximum pending contact requests',
      1,
      10000,
    ),
  };
}

function dbError(error: unknown): Error {
  const message = error instanceof Error ? error.message : String(error);

  if (message.includes('cinderella_bot_profiles_slug_key')) {
    return new Error('A bot onboarding profile with this slug already exists.');
  }

  if (message.includes('cinderella_one_runtime_bot_profile_idx')) {
    return new Error('Only one bot profile can be selected for the runtime.');
  }

  return error instanceof Error ? error : new Error(message);
}

function numberOf(value: string | number): number {
  return Number(value);
}

function mapRow(row: {
  id: string;
  slug: string;
  display_name: string;
  enabled: boolean;
  selected_for_runtime: boolean;
  workflow_state: BotWorkflowState;
  sdk_version: string;
  sdk_types_version: string;
  create_address: boolean;
  update_address: boolean;
  update_profile: boolean;
  auto_accept_contacts: boolean;
  welcome_message: string | null;
  business_address: boolean;
  allow_files: boolean;
  command_registry_mode: CommandRegistryMode;
  custom_commands: unknown[];
  use_bot_profile: boolean;
  log_contacts: boolean;
  log_network: boolean;
  group_invitation_mode: GroupInvitationMode;
  expected_group_role: SdkGroupRole;
  role_verification_required: boolean;
  policy_activation_mode: PolicyActivationMode;
  remote_commands_enabled: boolean;
  persistent_changes_enabled: boolean;
  contact_request_retention_hours: number;
  group_invitation_retention_hours: number;
  max_pending_contact_requests: number;
  created_at: string;
  updated_at: string;
}): BotOnboardingProfile {
  return {
    id: numberOf(row.id),
    slug: row.slug,
    displayName: row.display_name,
    enabled: row.enabled,
    selectedForRuntime: row.selected_for_runtime,
    workflowState: row.workflow_state,
    sdkVersion: row.sdk_version,
    sdkTypesVersion: row.sdk_types_version,
    createAddress: row.create_address,
    updateAddress: row.update_address,
    updateProfile: row.update_profile,
    autoAcceptContacts: row.auto_accept_contacts,
    welcomeMessage: row.welcome_message ?? '',
    businessAddress: row.business_address,
    allowFiles: row.allow_files,
    commandRegistryMode: row.command_registry_mode,
    customCommands: row.custom_commands,
    useBotProfile: row.use_bot_profile,
    logContacts: row.log_contacts,
    logNetwork: row.log_network,
    groupInvitationMode: row.group_invitation_mode,
    expectedGroupRole: row.expected_group_role,
    roleVerificationRequired: row.role_verification_required,
    policyActivationMode: row.policy_activation_mode,
    remoteCommandsEnabled: row.remote_commands_enabled,
    persistentChangesEnabled: row.persistent_changes_enabled,
    contactRequestRetentionHours: row.contact_request_retention_hours,
    groupInvitationRetentionHours: row.group_invitation_retention_hours,
    maxPendingContactRequests: row.max_pending_contact_requests,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

const SELECT_COLUMNS = `
  id,
  slug,
  display_name,
  enabled,
  selected_for_runtime,
  workflow_state,
  sdk_version,
  sdk_types_version,
  create_address,
  update_address,
  update_profile,
  auto_accept_contacts,
  welcome_message,
  business_address,
  allow_files,
  command_registry_mode,
  custom_commands,
  use_bot_profile,
  log_contacts,
  log_network,
  group_invitation_mode,
  expected_group_role,
  role_verification_required,
  policy_activation_mode,
  remote_commands_enabled,
  persistent_changes_enabled,
  contact_request_retention_hours,
  group_invitation_retention_hours,
  max_pending_contact_requests,
  created_at,
  updated_at
`;

export async function listBotOnboardingProfiles(db: Queryable): Promise<BotOnboardingProfile[]> {
  const result = await db.query<Parameters<typeof mapRow>[0]>(
    `SELECT ${SELECT_COLUMNS}
       FROM cinderella_bot_profiles
      ORDER BY selected_for_runtime DESC, display_name, id`,
  );

  return result.rows.map(mapRow);
}

export async function createBotOnboardingProfile(
  db: Queryable,
  rawInput: BotOnboardingInput,
  actor: string,
): Promise<number> {
  const input = validateInput(rawInput);

  try {
    const result = await db.query<{ id: string }>(
      `INSERT INTO cinderella_bot_profiles (
         slug,
         display_name,
         enabled,
         selected_for_runtime,
         create_address,
         update_address,
         update_profile,
         auto_accept_contacts,
         welcome_message,
         business_address,
         allow_files,
         command_registry_mode,
         custom_commands,
         use_bot_profile,
         log_contacts,
         log_network,
         group_invitation_mode,
         expected_group_role,
         role_verification_required,
         policy_activation_mode,
         remote_commands_enabled,
         persistent_changes_enabled,
         contact_request_retention_hours,
         group_invitation_retention_hours,
         max_pending_contact_requests
       )
       VALUES (
         $1, $2, $3, $4, $5, $6, $7, $8, NULLIF($9, ''), $10, $11, $12,
         $13::jsonb, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24, $25
       )
       RETURNING id`,
      [
        input.slug,
        input.displayName,
        input.enabled,
        input.selectedForRuntime,
        input.createAddress,
        input.updateAddress,
        input.updateProfile,
        input.autoAcceptContacts,
        input.welcomeMessage,
        input.businessAddress,
        input.allowFiles,
        input.commandRegistryMode,
        JSON.stringify(input.customCommands),
        input.useBotProfile,
        input.logContacts,
        input.logNetwork,
        input.groupInvitationMode,
        input.expectedGroupRole,
        input.roleVerificationRequired,
        input.policyActivationMode,
        input.remoteCommandsEnabled,
        input.persistentChangesEnabled,
        input.contactRequestRetentionHours,
        input.groupInvitationRetentionHours,
        input.maxPendingContactRequests,
      ],
    );

    const id = numberOf(result.rows[0]?.id ?? 0);

    await writeAudit(db, actor, 'cinderella.bot-profile.create', `bot-profile:${id}`, {
      slug: input.slug,
      displayName: input.displayName,
      selectedForRuntime: input.selectedForRuntime,
      autoAcceptContacts: input.autoAcceptContacts,
      groupInvitationMode: input.groupInvitationMode,
      expectedGroupRole: input.expectedGroupRole,
      runtimeApplied: false,
    });

    return id;
  } catch (error) {
    throw dbError(error);
  }
}

export async function updateBotOnboardingProfile(
  db: Queryable,
  id: number,
  rawInput: BotOnboardingInput,
  actor: string,
): Promise<void> {
  if (!Number.isSafeInteger(id) || id <= 0) throw new Error('Bot profile ID is invalid.');

  const input = validateInput(rawInput);

  try {
    const result = await db.query(
      `UPDATE cinderella_bot_profiles
          SET slug = $2,
              display_name = $3,
              enabled = $4,
              selected_for_runtime = $5,
              create_address = $6,
              update_address = $7,
              update_profile = $8,
              auto_accept_contacts = $9,
              welcome_message = NULLIF($10, ''),
              business_address = $11,
              allow_files = $12,
              command_registry_mode = $13,
              custom_commands = $14::jsonb,
              use_bot_profile = $15,
              log_contacts = $16,
              log_network = $17,
              group_invitation_mode = $18,
              expected_group_role = $19,
              role_verification_required = $20,
              policy_activation_mode = $21,
              remote_commands_enabled = $22,
              persistent_changes_enabled = $23,
              contact_request_retention_hours = $24,
              group_invitation_retention_hours = $25,
              max_pending_contact_requests = $26,
              updated_at = now()
        WHERE id = $1`,
      [
        id,
        input.slug,
        input.displayName,
        input.enabled,
        input.selectedForRuntime,
        input.createAddress,
        input.updateAddress,
        input.updateProfile,
        input.autoAcceptContacts,
        input.welcomeMessage,
        input.businessAddress,
        input.allowFiles,
        input.commandRegistryMode,
        JSON.stringify(input.customCommands),
        input.useBotProfile,
        input.logContacts,
        input.logNetwork,
        input.groupInvitationMode,
        input.expectedGroupRole,
        input.roleVerificationRequired,
        input.policyActivationMode,
        input.remoteCommandsEnabled,
        input.persistentChangesEnabled,
        input.contactRequestRetentionHours,
        input.groupInvitationRetentionHours,
        input.maxPendingContactRequests,
      ],
    );

    if (result.rowCount !== 1) throw new Error('Bot onboarding profile not found.');

    await writeAudit(db, actor, 'cinderella.bot-profile.update', `bot-profile:${id}`, {
      slug: input.slug,
      displayName: input.displayName,
      selectedForRuntime: input.selectedForRuntime,
      autoAcceptContacts: input.autoAcceptContacts,
      groupInvitationMode: input.groupInvitationMode,
      expectedGroupRole: input.expectedGroupRole,
      runtimeApplied: false,
    });
  } catch (error) {
    throw dbError(error);
  }
}

export async function resetBotOnboardingWorkflow(
  db: Queryable,
  id: number,
  actor: string,
): Promise<void> {
  if (!Number.isSafeInteger(id) || id <= 0) throw new Error('Bot profile ID is invalid.');

  const result = await db.query(
    `UPDATE cinderella_bot_profiles
        SET workflow_state = 'configured',
            updated_at = now()
      WHERE id = $1`,
    [id],
  );

  if (result.rowCount !== 1) throw new Error('Bot onboarding profile not found.');

  await writeAudit(db, actor, 'cinderella.bot-profile.workflow-reset', `bot-profile:${id}`, {
    workflowState: 'configured',
    simplexIdentityDeleted: false,
    simplexMembershipChanged: false,
    runtimeApplied: false,
  });
}

export async function deleteBotOnboardingProfile(
  db: Queryable,
  id: number,
  actor: string,
): Promise<void> {
  if (!Number.isSafeInteger(id) || id <= 0) throw new Error('Bot profile ID is invalid.');

  const existing = await db.query<{ slug: string; display_name: string }>(
    `SELECT slug, display_name
       FROM cinderella_bot_profiles
      WHERE id = $1`,
    [id],
  );

  const row = existing.rows[0];
  if (!row) throw new Error('Bot onboarding profile not found.');

  await db.query(`DELETE FROM cinderella_bot_profiles WHERE id = $1`, [id]);

  await writeAudit(db, actor, 'cinderella.bot-profile.delete', `bot-profile:${id}`, {
    slug: row.slug,
    displayName: row.display_name,
    simplexIdentityDeleted: false,
    simplexMembershipChanged: false,
    messageArchiveChanged: false,
    runtimeDecisionHistoryDeleted: false,
  });
}
