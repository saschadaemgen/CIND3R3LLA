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
import { wakeWordTakenBy, type WakeWordHolder } from '../interaction/setting-scope.js';
import {
  DEFAULT_INTERACTION,
  NEW_BOT_RETORTS,
  WAKE_WORD_MAX_CHARS,
  normalizeWakeWord,
  wakeWordProblem,
} from '../interaction/settings.js';
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
 *
 * ── AND `selectedForRuntime` IS OMITTED BECAUSE CREATING A BOT IS NOT THAT DECISION ──
 *
 * It used to be on the form, and the form is where the workflow broke (CCB-S5-008). The flag
 * changed meaning under D-155 without changing its name: it used to mean "this bot runs", it
 * now means "this bot is the primary", and every enabled bot runs either way. A wizard field
 * called "select for the runtime" therefore asked the operator to make hosting decision that
 * does not exist, on a form where the honest answer for the second bot is always no, and
 * defaulted it to yes so that creating a second bot failed on the unique index.
 *
 * Taking it off the type rather than off the form is deliberate: the compiler then finds every
 * caller that still believes creating a bot decides this, which is how the harnesses and the
 * preview seed were found. {@link setPrimaryBot} is the one path that moves it.
 */
export type BotOnboardingInput = Omit<
  BotOnboardingProfile,
  | 'id'
  | 'selectedForRuntime'
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

/**
 * What CREATING a bot posts: everything a save posts, plus the one fact only creation
 * decides (CCB-S5-009).
 *
 * `wakeWord` is here and not on {@link BotOnboardingInput} because it is not a column on
 * `cinderella_bot_profiles`: it is a per-bot deviation from the shared interaction settings,
 * written through `setSettingOverride`. Putting it on the shared input type would have meant
 * the edit dialog posting a field it does not show, which is the failure the personality
 * columns and the primary flag have each already caused on this exact form.
 *
 * REQUIRED, not optional. An optional wake word is a bot that silently answers to the
 * primary's name, which is the whole defect, and `verify:new-bot-identity` proves creation
 * refuses without a usable one.
 */
export type BotCreationInput = BotOnboardingInput & { wakeWord: string };

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
 * Every wake word currently in use, with the bot answering to it.
 *
 * The SHARED value is in the list under the bots that have not deviated, because a bot on
 * the shared value is answering to it: it is not free just because no override row names it.
 *
 * With no bots at all the list is EMPTY, and that is deliberate rather than an oversight. The
 * shared value is not held by anybody until a bot is on it, so the first bot an operator
 * creates may take it, which is the ordinary case: it then needs no override and inherits any
 * later edit to the shared value. Treating the default as reserved would refuse the most
 * normal creation there is.
 */
async function wakeWordHolders(db: Queryable): Promise<{ holder: WakeWordHolder; word: string }[]> {
  const shared = (await sharedWakeWord(db)) ?? '';
  const { rows: bots } = await db.query<{ id: string; display_name: string }>(
    `SELECT id, display_name FROM cinderella_bot_profiles ORDER BY id`,
  );
  const { rows: overrides } = await db.query<{ bot_profile_id: string; value: unknown }>(
    `SELECT bot_profile_id, value
       FROM cinderella_interaction_overrides
      WHERE setting_key = 'wakeWord'`,
  );
  const deviations = new Map(
    overrides.map((o) => [Number(o.bot_profile_id), typeof o.value === 'string' ? o.value : '']),
  );

  return bots.map((b) => {
    const id = Number(b.id);
    const own = deviations.get(id);
    return {
      holder: {
        botProfileId: id,
        displayName: b.display_name,
        shared: own === undefined,
      },
      word: own ?? shared,
    };
  });
}

/**
 * Validate the one field creation adds, and refuse a name already spoken for.
 *
 * ── WHY REFUSING RATHER THAN WARNING ────────────────────────────────────────
 *
 * The briefing allowed either, provided the operator is told. Two bots waking on one word in
 * one group is not a configuration with a downside, it is two bots answering the same
 * sentence at the same time and a member with no way to reach either one specifically. There
 * is no message that makes that acceptable, so it is refused, by name, with the bot that
 * holds the word stated. Changing an existing bot's wake word remains possible on the
 * Addressing page, which is where an operator who genuinely wants to swap two names goes.
 */
async function validateCreation(db: Queryable, wakeWord: unknown, displayName: string): Promise<string> {
  // The REASON, not a boolean, so the operator is told which rule the value broke rather
  // than being handed one sentence covering three different problems (CCB-S5-013).
  const problem = wakeWordProblem(wakeWord);
  if (problem !== null) throw new Error(`${displayName}: ${problem}`);
  const cleaned = normalizeWakeWord(wakeWord);
  if (cleaned === null) {
    throw new Error(
      `"${displayName}" needs a wake word of at least 2 characters: it is what members ` +
        `call it and what wakes it. Up to ${WAKE_WORD_MAX_CHARS} characters.`,
    );
  }

  const holders = await wakeWordHolders(db);
  const taken = wakeWordTakenBy(
    cleaned,
    holders.map((h) => h.holder),
    (holder) => holders.find((h) => h.holder === holder)?.word ?? '',
  );
  if (taken) {
    throw new Error(
      `"${cleaned}" is already the wake word of ${taken.displayName}` +
        (taken.shared ? ', which is on the shared default' : '') +
        `. Two bots waking on one word in one group both answer the same sentence, and a ` +
        `member cannot reach either on purpose. Choose another, or rename ` +
        `${taken.displayName} first on the Addressing page.`,
    );
  }

  return cleaned;
}

/**
 * The shared wake word: the stored one, or the shipped default when nothing is stored.
 *
 * Deliberately not through `InteractionService`: this runs inside bot creation, which has
 * no service instance to hand, and reaching for the process-wide one would tie creating a
 * bot to a service that the harnesses and one-shot scripts do not start.
 *
 * ── WHY THE DEFAULT AND NOT NULL (CCB-S5-009) ────────────────────────────────
 *
 * It returned null when no settings row existed, and null meant "unknown" to both callers.
 * That was harmless while the only caller compared for equality; it stopped being harmless
 * the moment the duplicate check started asking what each bot answers to. A deployment that
 * has never opened the settings page has no row, so every bot on the shared value would have
 * read as answering to the empty string, and a second bot could have been created on a wake
 * word the first one was already using without anything noticing.
 *
 * There is no such thing as no shared wake word: `normalizeInteraction` refuses to produce
 * an empty one, so the effective value with no row is the shipped default and saying so is
 * simply true. A read that FAILS is different and still returns null, because guessing after
 * an error is how a fault becomes a wrong answer.
 */
async function sharedWakeWord(db: Queryable): Promise<string | null> {
  try {
    const stored = (await getSetting(db, 'interaction')) as { wakeWord?: unknown } | null;
    const value = stored?.wakeWord;
    return typeof value === 'string' && value.trim().length > 0
      ? value.trim()
      : DEFAULT_INTERACTION.wakeWord;
  } catch {
    // A read that fails must not stop a bot being created, and must not claim to know the
    // shared value either. Null here makes the caller write the bot its own override, which
    // is the safe direction: its own name rather than a guess at somebody else's.
    return null;
  }
}

function dbError(error: unknown): Error {
  const message = error instanceof Error ? error.message : String(error);

  if (message.includes('cinderella_bot_profiles_slug_key')) {
    return new Error('A bot onboarding profile with this slug already exists.');
  }

  // Reworded with the flag (CCB-S5-008). The index is right and stays; the old sentence
  // described a choice the operator no longer makes and named a thing the flag no longer
  // means. It should now be unreachable from creating or saving a bot, because neither
  // writes the column any more, and reachable only from two operators racing
  // {@link setPrimaryBot}. Kept because "should be unreachable" is not "is".
  if (message.includes('cinderella_one_runtime_bot_profile_idx')) {
    return new Error('There is already a primary bot. Only one bot can be the primary.');
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
 *
 * ── AND THE PRIMARY FLAG IS DECIDED HERE RATHER THAN ASKED FOR (CCB-S5-008) ──
 *
 * A new bot is simply a bot. The first one is the primary because there is nothing else to
 * be it; every one after is not. That is not a decision worth a form field, it is an
 * observation about how many rows exist, so it is made in SQL where the answer cannot be
 * stale between the read and the write.
 *
 * Written as "no primary exists" rather than "no bot exists" so it also answers the case an
 * operator can actually reach: delete the primary, and the next bot created takes the empty
 * seat instead of leaving the console with no default selection and no way to get one back
 * except {@link setPrimaryBot}. It can therefore never violate the unique index on its own,
 * because it only ever writes TRUE when nothing else holds it.
 */
export async function createBotOnboardingProfile(
  db: Queryable,
  rawInput: BotCreationInput,
  actor: string,
): Promise<number> {
  const input = validateInput(rawInput);
  // BEFORE the insert, so a refused wake word leaves no half-made bot behind. The duplicate
  // check reads other bots, which is why it cannot run after this one exists.
  const wakeWord = await validateCreation(db, rawInput.wakeWord, input.displayName);

  try {
    const result = await db.query<{ id: string; selected_for_runtime: boolean }>(
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
         $1, $2, $3,
         NOT EXISTS (SELECT 1 FROM cinderella_bot_profiles WHERE selected_for_runtime = TRUE),
         $4, $5, $6, $7, NULLIF($8, ''), $9, $10, $11,
         $12::jsonb, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24,
         NULLIF($25, ''), $26, $27, $28, $29, $30
       )
       RETURNING id, selected_for_runtime`,
      [
        input.slug,
        input.displayName,
        input.enabled,
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
    // What the database decided, not what anybody asked for. Audited below as the fact it is.
    const becamePrimary = result.rows[0]?.selected_for_runtime === true;

    // ── ITS OWN NAME, ASKED FOR RATHER THAN DERIVED (CCB-S5-006, CCB-S5-009) ──
    //
    // The wake word is shared by default, so a bot created without this answers to whatever
    // the primary is called. CCB-S5-006 fixed that by deriving one from the display name.
    // CCB-S5-009 made it a field on the form instead, because deriving it silently meant the
    // operator finished the wizard not knowing what the bot answered to, and the derivation
    // is wrong often enough to matter: SANCH3Z should answer to Sanchez.
    //
    // `input.wakeWord` has already been through `normalizeWakeWord` and the duplicate check
    // in {@link validateCreation}, which is where the operator-facing refusals live. By here
    // it is a usable word or the creation never happened.
    //
    // Written as a per-bot OVERRIDE rather than by copying the whole settings record: the
    // bot inherits everything else, so a later edit to a shared value still reaches it.
    const sharedWake = await sharedWakeWord(db);
    // Only when it actually DIFFERS from the shared wake word. A bot whose wake word is
    // already the shared value needs no deviation, and storing one would show it in the
    // console as differing from a default it matches, and would freeze it at today's value
    // so a later shared edit stopped reaching it. Same rule the console's save path uses.
    if (wakeWord !== sharedWake) {
      await setSettingOverride(db, id, 'wakeWord', wakeWord);
    }

    // ── AND ITS OWN RETORTS (CCB-S5-009, D-163) ───────────────────────────
    //
    // Absence means inherit, so a bot created without this answers a nickname with HER twelve
    // retorts: the pumpkin, the fairy godmother, the glass slipper, Cindy by name. Nine of
    // the twelve are her mythology rather than a template, so substituting `{wake}` does not
    // rescue them. The alternative, leaving the list empty, silently turns the nickname path
    // off and takes the verbal moderation ladder with it.
    //
    // So a new bot gets the plain starter set as its OWN editable text, written here once and
    // owned by the application afterwards. Voice is not stored: `handleNickname` re-voices
    // whichever line it picks through this bot's personality and the ladder's sharpness.
    await setSettingOverride(db, id, 'retorts', {
      en: [...(NEW_BOT_RETORTS['en'] ?? [])],
      de: [...(NEW_BOT_RETORTS['de'] ?? [])],
    });

    await writeAudit(db, actor, 'cinderella.bot-profile.create', `bot-profile:${id}`, {
      slug: input.slug,
      displayName: input.displayName,
      // Recorded because it happened, not because it was requested: creating a bot cannot
      // ask for this since CCB-S5-008. True only for the bot that found the seat empty.
      becamePrimary,
      // The name it answers to, recorded because it is the fact CCB-S5-009 exists to make
      // visible, and because an audit that cannot answer "what did this bot start as called"
      // is missing the one thing an operator asks after the fact.
      wakeWord,
      retortsSeeded: (NEW_BOT_RETORTS['en'] ?? []).length,
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
 *
 * IT NO LONGER WRITES `selected_for_runtime` EITHER, for the same reason one step further
 * on (CCB-S5-008): the dialog does not show it, so a save from the dialog must not be able
 * to move it. It used to, which meant editing any setting on the primary re-asserted the
 * flag and editing any setting on a second bot silently posted FALSE for it. Changing which
 * bot is the primary is {@link setPrimaryBot} and nothing else.
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
              create_address = $5,
              update_address = $6,
              update_profile = $7,
              auto_accept_contacts = $8,
              welcome_message = NULLIF($9, ''),
              business_address = $10,
              allow_files = $11,
              command_registry_mode = $12,
              custom_commands = $13::jsonb,
              use_bot_profile = $14,
              log_contacts = $15,
              log_network = $16,
              group_invitation_mode = $17,
              expected_group_role = $18,
              role_verification_required = $19,
              policy_activation_mode = $20,
              remote_commands_enabled = $21,
              persistent_changes_enabled = $22,
              contact_request_retention_hours = $23,
              group_invitation_retention_hours = $24,
              max_pending_contact_requests = $25,
              updated_at = now()
        WHERE id = $1`,
      [
        id,
        input.slug,
        input.displayName,
        input.enabled,
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
 * Make one bot the primary (CCB-S5-008).
 *
 * ── ITS OWN ACTION, WHICH IS THE WHOLE POINT ─────────────────────────────────
 *
 * The flag used to move as a side effect of creating or saving a bot, from a wizard field
 * that named a decision nobody makes. So there was no way to say "this one is the primary
 * now" without opening an unrelated dialog and re-saving twenty settings, and no way to
 * create a second bot without first answering a question about the first one. One button,
 * one statement pair, one audit row.
 *
 * ── AND WHY IT IS TWO STATEMENTS IN A TRANSACTION ────────────────────────────
 *
 * The partial unique index from 019 is checked as each row is written, not at the end of
 * the statement, so the obvious single UPDATE (`SET selected_for_runtime = (id = $1)`) fails
 * whenever Postgres happens to reach the new primary before the old one. Clearing first and
 * setting second is ordered and therefore never transiently holds two, and the transaction
 * is what stops a failure between them leaving the deployment with no primary at all.
 *
 * BEGIN/COMMIT on the handle we were given rather than `withTransaction`, which reaches for
 * the global pool: this runs under PGlite in the harness and the real pool in production,
 * and both speak plain SQL. Same reason `db/prompt-rules.ts` does it that way.
 */
export async function setPrimaryBot(db: Queryable, id: number, actor: string): Promise<void> {
  if (!Number.isSafeInteger(id) || id <= 0) throw new Error('Bot profile ID is invalid.');

  await db.query('BEGIN');
  try {
    const { rows: before } = await db.query<{ id: string; display_name: string }>(
      `SELECT id, display_name FROM cinderella_bot_profiles WHERE selected_for_runtime = TRUE`,
    );
    const previous = before[0] ?? null;

    await db.query(
      `UPDATE cinderella_bot_profiles
          SET selected_for_runtime = FALSE, updated_at = now()
        WHERE selected_for_runtime = TRUE AND id <> $1`,
      [id],
    );

    const result = await db.query(
      `UPDATE cinderella_bot_profiles
          SET selected_for_runtime = TRUE, updated_at = now()
        WHERE id = $1`,
      [id],
    );

    // Not found means the id is wrong, and the clear above has already run. Throwing rolls
    // it back, so a mistyped id cannot cost the deployment the primary it had.
    if (result.rowCount !== 1) throw new Error('Bot onboarding profile not found.');

    await writeAudit(db, actor, 'cinderella.bot-profile.make-primary', `bot-profile:${id}`, {
      previousPrimaryId: previous ? numberOf(previous.id) : null,
      previousPrimaryName: previous?.display_name ?? null,
      // Named explicitly because the flag's old name says otherwise: this changes which bot
      // the console offers first and which one the not-yet-per-bot paths read. It starts and
      // stops nothing. Every enabled bot was hosted before this and still is.
      hostingChanged: false,
      runtimeApplied: false,
    });

    await db.query('COMMIT');
  } catch (error) {
    await db.query('ROLLBACK');
    throw dbError(error);
  }

  log.info(`Bot ${id} is now the primary; hosting is unchanged and every enabled bot still runs.`);
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
 * The PRIMARY bot's personality, or null when no bot holds the flag.
 *
 * Called `runtimeBotPersonality` until CCB-S5-008, which was a name that stopped being true
 * under D-155 and said so to nobody: it reads as "the personality of the bot the runtime
 * hosts", and the runtime hosts every enabled bot. What it actually answers is the console's
 * default, for pages that must show one bot before the operator has picked one. The reply
 * path names a bot and uses {@link botPersonalityById}; it never comes here.
 *
 * NULL IS A REAL ANSWER AND NOT A DEFAULT. An operator who has created no bot profile has
 * configured no personality, and handing back mid-value dials would be inventing one. The
 * prompt builder distinguishes the two: null gets the original voice paragraph plus the
 * safety ceiling, a real row gets the dials. See `conversationVoice` in
 * src/interaction/personality.ts.
 */
export async function primaryBotPersonality(db: Queryable): Promise<BotPersonality | null> {
  return await readBotPersonality(db, `WHERE selected_for_runtime = TRUE`, []);
}

/**
 * The personality of ONE bot (CCB-S5-001).
 *
 * The per-bot form of {@link primaryBotPersonality}, needed because every enabled bot is
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
