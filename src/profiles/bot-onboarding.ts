/**
 * Persistent SimpleX bot onboarding configuration.
 *
 * This service stores desired BotOptions, address settings, workflow policy, and
 * safety controls. It still does not invoke the SimpleX SDK: the create-address action
 * (CCB-S4-022) runs in `src/bot/runtime/admin-actions.ts` and hands the RESULT here.
 * That split is the point. {@link recordContactAddress} can only be called with a link
 * the core actually returned, so the workflow state cannot advance on an intention.
 */

import { writeAudit } from '../db/audit.js';
import type { Queryable } from '../db/pool.js';
import { setSettingOverride } from '../db/interaction-overrides.js';
import { getSetting } from '../db/settings.js';
import { log } from '../log.js';
import { wakeWordForNewBot } from '../interaction/setting-scope.js';
import type { MemberRole } from '../adapter/types.js';
import {
  normalizePersonality,
  type BotPersonality,
  type PersonalityInput,
} from '../interaction/personality.js';

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

/**
 * Alias of the adapter's {@link MemberRole} since CCB-S4-032, which widened that type to
 * the same seven values. Two identical unions is one definition too many, and moderation
 * needs the role from a captured message and the role from this config to be the same
 * thing. The name stays because onboarding copy and columns speak of an SDK group role.
 */
export type SdkGroupRole = MemberRole;

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
  /**
   * Who this bot is and how it sounds (CCB-S4-029, migration 028). Stored per bot here
   * because that is where every other per-bot setting lives; the `settings` table has
   * no bot dimension. Read live by `src/profiles/bot-personality.ts` and turned into
   * prompt text by `src/interaction/personality.ts`.
   */
  personality: BotPersonality;
  /** The contact link the core returned, or null while the address does not exist. */
  contactAddressLink: string | null;
  /** The SimpleX user the address was created on, so the link can be checked. */
  contactAddressUserId: number | null;
  contactAddressCreatedAt: string | null;
  /**
   * This bot's own face, relative to the asset root, or null for the deployment default
   * (CCB-S5-007, D-161, migration 049). Null is an answer rather than a gap: it means
   * `AVATAR_PATH`, which is what every bot including the first one wears until somebody
   * uploads one for it. Never the image bytes; the path, as everywhere else.
   */
  avatarPath: string | null;
  createdAt: string;
  updatedAt: string;
}

/**
 * What the wizard form posts.
 *
 * `avatarPath` is omitted for the same reason `contactAddressLink` is: it is not a field on
 * that form, it is written by its own route with a stored file in hand, and a save from the
 * wizard must not be able to clear it by omission. That is the failure the personality
 * columns already have a comment about, arrived at from a different direction.
 */
export type BotOnboardingInput = Omit<
  BotOnboardingProfile,
  | 'id'
  | 'workflowState'
  | 'sdkVersion'
  | 'sdkTypesVersion'
  | 'contactAddressLink'
  | 'contactAddressUserId'
  | 'contactAddressCreatedAt'
  | 'avatarPath'
  | 'createdAt'
  | 'updatedAt'
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
    // Clamped rather than rejected. Every one of these arrives from a range input or a
    // textarea, so an out-of-range value means a tampered or stale form rather than an
    // operator decision worth failing a whole save over, and the DDL still refuses what
    // this would somehow miss.
    personality: normalizePersonality(input.personality),
  };
}

/**
 * The shared wake word, read straight from the settings row.
 *
 * Deliberately not through `InteractionService`: this runs inside bot creation, which has
 * no service instance to hand, and reaching for the process-wide one would tie creating a
 * bot to a service that the harnesses and one-shot scripts do not start.
 */
async function sharedWakeWord(db: Queryable): Promise<string | null> {
  try {
    const stored = (await getSetting(db, 'interaction')) as { wakeWord?: unknown } | null;
    const value = stored?.wakeWord;
    return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
  } catch {
    // A read that fails must not stop a bot being created. Null means "unknown", and the
    // override is then written, which is the safe direction: its own name.
    return null;
  }
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
  base_character: string | null;
  origin: string | null;
  axis_sharpness: number;
  axis_warmth: number;
  axis_humor: number;
  axis_verbosity: number;
  axis_permissiveness: number;
  contact_address_link: string | null;
  contact_address_user_id: string | number | null;
  contact_address_created_at: string | null;
  avatar_path: string | null;
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
    personality: normalizePersonality({
      baseCharacter: row.base_character ?? '',
      origin: row.origin ?? '',
      sharpness: row.axis_sharpness,
      warmth: row.axis_warmth,
      humor: row.axis_humor,
      verbosity: row.axis_verbosity,
      permissiveness: row.axis_permissiveness,
    }),
    contactAddressLink: row.contact_address_link,
    contactAddressUserId:
      row.contact_address_user_id === null ? null : numberOf(row.contact_address_user_id),
    contactAddressCreatedAt: row.contact_address_created_at,
    avatarPath: row.avatar_path,
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
  base_character,
  origin,
  axis_sharpness,
  axis_warmth,
  axis_humor,
  axis_verbosity,
  axis_permissiveness,
  contact_address_link,
  contact_address_user_id,
  contact_address_created_at,
  avatar_path,
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

/**
 * Create a bot profile.
 *
 * THE `origin` COLUMN IS OMITTED FROM THE INSERT ON PURPOSE (CCB-S4-034, D-138).
 * Migration 031 gives that column a default which is her written origin, precisely so a
 * new bot starts with a history rather than with nothing, and a column is only defaulted
 * when the INSERT leaves it out. Listing it here with `input.personality.origin` would
 * ship every new bot with an empty history and nothing would announce it, so
 * `verify:personality` creates a bot against the real schema and fails if the origin does
 * not come back. The Personality page is the edit path, and the only one.
 */
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
         max_pending_contact_requests,
         base_character,
         axis_sharpness,
         axis_warmth,
         axis_humor,
         axis_verbosity,
         axis_permissiveness
       )
       VALUES (
         $1, $2, $3, $4, $5, $6, $7, $8, NULLIF($9, ''), $10, $11, $12,
         $13::jsonb, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24, $25,
         NULLIF($26, ''), $27, $28, $29, $30, $31
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
        input.personality.baseCharacter,
        input.personality.sharpness,
        input.personality.warmth,
        input.personality.humor,
        input.personality.verbosity,
        input.personality.permissiveness,
      ],
    );

    const id = numberOf(result.rows[0]?.id ?? 0);

    // ── ITS OWN NAME, NOT HERS (CCB-S5-006, D-158) ────────────────────────
    //
    // The wake word is shared by default, so a bot created without this answers to whatever
    // the primary is called. That is the defect CCB-S5-006 exists to fix, and it would be
    // reintroduced on every bot the operator creates.
    //
    // Written as a per-bot OVERRIDE rather than by copying the whole settings record: the
    // bot inherits everything else, so a later edit to a shared value still reaches it.
    // A display name that cannot serve as a wake word yields no row at all, and the
    // operator sets one; no wake word is a bot nobody can address, which is visible.
    const wake = wakeWordForNewBot(input.displayName);
    // Only when it actually DIFFERS from the shared wake word. A bot whose display name is
    // already the shared value needs no deviation, and storing one would show it in the
    // console as differing from a default it matches, and would freeze it at today's value
    // so a later shared edit stopped reaching it. Same rule the console's save path uses.
    const sharedWake = await sharedWakeWord(db);
    if (wake !== null && wake !== sharedWake) {
      await setSettingOverride(db, id, 'wakeWord', wake);
    } else if (wake === null) {
      log.warn(
        `Bot "${input.displayName}" was created with no wake word: its display name cannot ` +
          `serve as one. Set one on the Addressing page before it is hosted, or it cannot ` +
          `be addressed by name.`,
      );
    }

    await writeAudit(db, actor, 'cinderella.bot-profile.create', `bot-profile:${id}`, {
      slug: input.slug,
      displayName: input.displayName,
      selectedForRuntime: input.selectedForRuntime,
      autoAcceptContacts: input.autoAcceptContacts,
      groupInvitationMode: input.groupInvitationMode,
      expectedGroupRole: input.expectedGroupRole,
      // The dials are audited; the base character is recorded as set-or-not rather than
      // quoted, because it is free operator prose and the audit log is not where a
      // paragraph belongs. The Personality page audits its own edits in the same shape.
      baseCharacterConfigured: input.personality.baseCharacter !== '',
      personalityAxes: {
        sharpness: input.personality.sharpness,
        warmth: input.personality.warmth,
        humor: input.personality.humor,
        verbosity: input.personality.verbosity,
        permissiveness: input.personality.permissiveness,
      },
      runtimeApplied: false,
    });

    return id;
  } catch (error) {
    throw dbError(error);
  }
}

/**
 * Save the onboarding settings.
 *
 * DELIBERATELY DOES NOT WRITE THE PERSONALITY COLUMNS, even though the input type
 * carries them. The wizard form has one personality field on it, the base character,
 * and it only has that one when CREATING. If this statement wrote all five, then every
 * save from the wizard's edit dialog would post four axes the form never showed and
 * reset an operator's dials to the middle without saying so. {@link updateBotPersonality}
 * is the edit path, and the Personality page is where the values are visible while they
 * are being changed.
 */
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

/**
 * Save the personality alone (CCB-S4-029).
 *
 * Separate from {@link updateBotOnboardingProfile} because the Personality page edits
 * five fields and nothing else. Routing it through the whole-profile update would mean
 * the page had to round-trip and re-submit every onboarding setting on the record, and
 * a form that resubmits values nobody looked at is how an unrelated setting gets
 * silently reverted by whoever opened the wrong page.
 *
 * The base character is stored NULL when blank, so "not configured" survives a save
 * that clears it rather than becoming an empty character somebody chose.
 */
export async function updateBotPersonality(
  db: Queryable,
  id: number,
  raw: PersonalityInput,
  actor: string,
): Promise<BotPersonality> {
  if (!Number.isSafeInteger(id) || id <= 0) throw new Error('Bot profile ID is invalid.');

  const personality = normalizePersonality(raw);
  const result = await db.query(
    `UPDATE cinderella_bot_profiles
        SET base_character = NULLIF($2, ''),
            origin = NULLIF($3, ''),
            axis_sharpness = $4,
            axis_warmth = $5,
            axis_humor = $6,
            axis_verbosity = $7,
            axis_permissiveness = $8,
            updated_at = now()
      WHERE id = $1`,
    [
      id,
      personality.baseCharacter,
      // Written explicitly, so the column default from migration 031 does not apply and
      // a cleared origin stays cleared. The default is for a row coming into existence,
      // not for every save (CCB-S4-034).
      personality.origin,
      personality.sharpness,
      personality.warmth,
      personality.humor,
      personality.verbosity,
      personality.permissiveness,
    ],
  );

  if (result.rowCount !== 1) throw new Error('Bot onboarding profile not found.');

  await writeAudit(db, actor, 'cinderella.bot-profile.personality', `bot-profile:${id}`, {
    baseCharacterConfigured: personality.baseCharacter !== '',
    baseCharacterChars: personality.baseCharacter.length,
    // Recorded set-or-not and by length, never quoted, for the same reason the base
    // character is: it is free operator prose and the audit log is not where two
    // paragraphs belong. Clearing a history is a real change, so it has to be visible.
    originConfigured: personality.origin !== '',
    originChars: personality.origin.length,
    sharpness: personality.sharpness,
    warmth: personality.warmth,
    humor: personality.humor,
    verbosity: personality.verbosity,
    permissiveness: personality.permissiveness,
    runtimeApplied: false,
  });

  return personality;
}

/**
 * The personality of the bot the runtime is hosting, or null when there is no runtime
 * bot at all.
 *
 * NULL IS A REAL ANSWER AND NOT A DEFAULT. An operator who has created no bot profile,
 * or selected none for the runtime, has configured no personality, and handing back
 * mid-value dials would be inventing one. The prompt builder distinguishes the two:
 * null gets the original voice paragraph plus the safety ceiling, a real row gets the
 * dials. See `conversationVoice` in src/interaction/personality.ts.
 */
export async function runtimeBotPersonality(db: Queryable): Promise<BotPersonality | null> {
  return await readBotPersonality(db, `WHERE selected_for_runtime = TRUE`, []);
}

/**
 * The personality of ONE bot (CCB-S5-001).
 *
 * The per-bot form of {@link runtimeBotPersonality}, needed because every enabled bot is
 * hosted now and the engine that answers a member has to read the character of the bot
 * that received the message rather than of whichever row carries the primary flag.
 * Same null semantics: absence is an answer, not a default.
 */
export async function botPersonalityById(
  db: Queryable,
  botProfileId: number,
): Promise<BotPersonality | null> {
  return await readBotPersonality(db, `WHERE id = $1`, [botProfileId]);
}

async function readBotPersonality(
  db: Queryable,
  where: string,
  params: unknown[],
): Promise<BotPersonality | null> {
  const result = await db.query<{
    base_character: string | null;
    origin: string | null;
    axis_sharpness: number;
    axis_warmth: number;
    axis_humor: number;
    axis_verbosity: number;
    axis_permissiveness: number;
  }>(
    `SELECT base_character, origin, axis_sharpness, axis_warmth, axis_humor, axis_verbosity,
            axis_permissiveness
       FROM cinderella_bot_profiles
      ${where}
      LIMIT 1`,
    params,
  );

  const row = result.rows[0];
  if (!row) return null;

  return normalizePersonality({
    baseCharacter: row.base_character ?? '',
    origin: row.origin ?? '',
    sharpness: row.axis_sharpness,
    warmth: row.axis_warmth,
    humor: row.axis_humor,
    verbosity: row.axis_verbosity,
    permissiveness: row.axis_permissiveness,
  });
}

export async function resetBotOnboardingWorkflow(
  db: Queryable,
  id: number,
  actor: string,
): Promise<void> {
  if (!Number.isSafeInteger(id) || id <= 0) throw new Error('Bot profile ID is invalid.');

  // The address is cleared with the state. A reset that left the link behind would
  // show step one as not done while displaying its result, and the operator would have
  // no way to tell which of the two the system believed.
  const result = await db.query(
    `UPDATE cinderella_bot_profiles
        SET workflow_state = 'configured',
            contact_address_link = NULL,
            contact_address_user_id = NULL,
            contact_address_created_at = NULL,
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

/**
 * Record a contact address the core actually returned, and advance the workflow.
 *
 * ── THE ONE THING THIS FUNCTION IS FOR ──────────────────────────────────────
 *
 * The link and the state move in a SINGLE statement, and the statement is only
 * reachable with a link in hand. The wizard's whole failure to date was a page that
 * described a step nothing performed; the way that becomes worse rather than better is
 * a button that advances the state and stores an intention. So there is no
 * `markAddressRequested`, no optimistic write, and no path that sets
 * `waiting_contact_request` without a link: the parameter is not optional.
 *
 * Writing it again with the same link is a no-op in effect, which is what makes the
 * button idempotent from end to end rather than only at the SDK call.
 */
export async function recordContactAddress(
  db: Queryable,
  id: number,
  address: { link: string; simplexUserId: number },
  actor: string,
): Promise<void> {
  if (!Number.isSafeInteger(id) || id <= 0) throw new Error('Bot profile ID is invalid.');
  if (!address.link.trim()) throw new Error('Refusing to record an empty contact address.');
  if (!Number.isSafeInteger(address.simplexUserId) || address.simplexUserId <= 0) {
    throw new Error('Refusing to record a contact address without a valid SimpleX user id.');
  }

  const result = await db.query(
    `UPDATE cinderella_bot_profiles
        SET contact_address_link = $2,
            contact_address_user_id = $3,
            contact_address_created_at = COALESCE(contact_address_created_at, now()),
            workflow_state = 'waiting_contact_request',
            updated_at = now()
      WHERE id = $1`,
    [id, address.link.trim(), address.simplexUserId],
  );

  if (result.rowCount !== 1) throw new Error('Bot onboarding profile not found.');

  // The link itself is NOT audited. It is the credential a stranger needs to reach the
  // bot, the audit log is rendered in the console, and the row already holds it; a
  // second copy in an append-only table is a second place it can leak from.
  await writeAudit(db, actor, 'cinderella.bot-profile.contact-address', `bot-profile:${id}`, {
    simplexUserId: address.simplexUserId,
    workflowState: 'waiting_contact_request',
    linkRecorded: true,
    runtimeApplied: true,
  });
}

/**
 * Record which image this bot wears, or clear it back to the deployment default.
 *
 * ── WHY `null` IS A VALUE AND NOT AN ABSENCE ─────────────────────────────────
 *
 * Clearing is a real operation with a real meaning: wear whatever `AVATAR_PATH` is. So the
 * parameter is `string | null` and not optional, and the caller has to say which it means.
 * An optional parameter would make "clear it" and "I forgot to pass it" the same call.
 *
 * ── AND WHY IT SAYS NOTHING ABOUT THE RUNNING BOT ────────────────────────────
 *
 * This writes a row. The SimpleX profile is dressed at boot, by `startRuntimeHost`, and
 * nothing here reaches into a running core to change a live profile. That is deliberate and
 * the page says so: an upload that claimed to have changed the bot's face while the members
 * still saw the old one would be exactly the "stores an intention" failure the contact
 * address was built to avoid. It takes a restart, and the operator is told that.
 *
 * The path is one `storeChapterImage` returned, which is a content hash and an extension. It
 * is re-validated on every read by `resolveAssetPath` anyway; the guard here is against a
 * path arriving from somewhere else entirely.
 */
export async function setBotAvatarPath(
  db: Queryable,
  id: number,
  relativePath: string | null,
  actor: string,
): Promise<void> {
  if (!Number.isSafeInteger(id) || id <= 0) throw new Error('Bot profile ID is invalid.');

  const cleaned = relativePath === null ? null : relativePath.trim();
  if (cleaned !== null) {
    if (!cleaned) throw new Error('Refusing to record an empty avatar path.');
    // Absolute or escaping paths are refused HERE as well as at read time. The column has no
    // CHECK, this is the only writer, and a stored `../../etc/...` would be a finding even if
    // every reader happened to catch it.
    if (cleaned.includes('\\') || cleaned.startsWith('/') || cleaned.split('/').includes('..')) {
      throw new Error('Refusing to record an avatar path that is not inside the asset root.');
    }
  }

  const result = await db.query(
    `UPDATE cinderella_bot_profiles
        SET avatar_path = $2,
            updated_at = now()
      WHERE id = $1`,
    [id, cleaned],
  );

  if (result.rowCount !== 1) throw new Error('Bot onboarding profile not found.');

  await writeAudit(db, actor, 'cinderella.bot-profile.avatar', `bot-profile:${id}`, {
    avatarPath: cleaned,
    cleared: cleaned === null,
    // Named rather than implied: the write is the whole of it. The live SimpleX profile is
    // unchanged until the bot is restarted.
    runtimeApplied: false,
  });

  log.info(
    cleaned === null
      ? `Bot ${id} cleared its avatar; it falls back to the deployment default at next start.`
      : `Bot ${id} now wears ${cleaned}; it is applied at next start.`,
  );
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
