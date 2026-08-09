/**
 * Guided AI Bot Setup and persistent SimpleX bot settings.
 *
 * Mostly a settings surface. ONE step now performs a real SimpleX action: creating the
 * bot's contact address (CCB-S4-022). It runs in `src/bot/runtime/admin-actions.ts`
 * against the running runtime and the state advances only on a link the core actually
 * returned, which is the whole difference between this step and the description of it
 * that stood here doing nothing for a season. Contact acceptance, group join and role
 * setting are the next three briefings and are still descriptions.
 */

import type { FastifyInstance } from 'fastify';
import {
  createBotOnboardingProfile,
  deleteBotOnboardingProfile,
  listBotOnboardingProfiles,
  recordContactAddress,
  resetBotOnboardingWorkflow,
  setBotAvatarPath,
  setPrimaryBot,
  updateBotOnboardingProfile,
  type BotCreationInput,
  type BotOnboardingInput,
  type BotOnboardingProfile,
  type CommandRegistryMode,
  type GroupInvitationMode,
  type PolicyActivationMode,
  type SdkGroupRole,
} from '../../profiles/bot-onboarding.js';
import {
  ASSET_MAX_BYTES,
  AssetError,
  resolveAssetPath,
  storeChapterImage,
} from '../../media/assets.js';
import { log } from '../../log.js';
import { decideFaces } from '../../bot/runtime/faces.js';
import { loadAvatarDataUri } from '../../bot/avatar.js';
import {
  acceptContactRequest,
  createOrShowBotAddress,
  hostedIdentity,
  joinInvitedGroup,
  rejectContactRequest,
  runtimeAdminAvailable,
  applyBotFaceNow,
  RuntimeActionUnavailableError,
  type HostedIdentity,
} from '../../bot/runtime/admin-actions.js';
import {
  listGroupInvitations,
  recordJoinedGroup,
  type BotGroupInvitation,
} from '../../profiles/group-invitations.js';
import {
  listContactRequests,
  recordAcceptedContactRequest,
  recordRejectedContactRequest,
  type BotContactRequest,
} from '../../profiles/contact-requests.js';
import {
  BASE_CHARACTER_MAX_CHARS,
  DEFAULT_PERSONALITY,
  normalizePersonality,
} from '../../interaction/personality.js';
import { WAKE_WORD_MAX_CHARS } from '../../interaction/settings.js';
import { botIdentity, type BotIdentityFacts } from '../../profiles/bot-identity.js';
import { listSettingOverridesForBot } from '../../db/interaction-overrides.js';
import { html, page, raw, type SafeHtml } from '../html.js';
import type { ViewContext } from '../server.js';
import { badge, fmtDate, stat } from './ui.js';

const SDK_ROLES: Array<{
  value: SdkGroupRole;
  label: string;
  description: string;
  operational: boolean;
}> = [
  {
    value: 'relay',
    label: 'Relay',
    description: 'SDK role exposed. Bot behavior is not validated yet.',
    operational: false,
  },
  {
    value: 'observer',
    label: 'Observer',
    description: 'Read focused role with limited participation.',
    operational: true,
  },
  {
    value: 'author',
    label: 'Author',
    description: 'SDK role exposed. Bot behavior is not validated yet.',
    operational: false,
  },
  {
    value: 'member',
    label: 'Member',
    description: 'Normal group participation without moderation powers.',
    operational: true,
  },
  {
    value: 'moderator',
    label: 'Moderator',
    description: 'Moderation role for normal operational use.',
    operational: true,
  },
  {
    value: 'admin',
    label: 'Admin',
    description: 'Default role for the controlled initial setup.',
    operational: true,
  },
  {
    value: 'owner',
    label: 'Owner',
    description: 'Highest group role. Not required for the initial setup.',
    operational: true,
  },
];

const CAPABILITIES = [
  ['apiCreateUserAddress', 'SDK available', 'WIRED (CCB-S4-022)'],
  ['apiGetUserAddress', 'SDK available', 'WIRED (CCB-S4-022)'],
  ['BotOptions.createAddress', 'Stored', 'Runtime wiring planned'],
  ['BotOptions.updateAddress', 'Stored', 'Runtime wiring planned'],
  ['BotOptions.updateProfile', 'Stored', 'Runtime wiring planned'],
  ['BotAddressSettings.autoAccept', 'Stored', 'Automatic by default'],
  ['BotAddressSettings.welcomeMessage', 'Stored', 'Runtime wiring planned'],
  ['BotOptions.allowFiles', 'Stored', 'Enabled by default'],
  ['BotOptions.commands', 'Stored', 'Default registry retained'],
  ['receivedContactRequest', 'SDK available', 'Event wiring planned'],
  ['apiAcceptContactRequest', 'SDK available', 'Action wiring planned'],
  ['receivedGroupInvitation', 'SDK available', 'Event wiring planned'],
  ['apiJoinGroup', 'SDK available', 'Action wiring planned'],
  ['apiListGroups', 'SDK available', 'Discovery wiring planned'],
  ['apiListMembers', 'SDK available', 'Role verification planned'],
] as const;

const JOURNEY = [
  {
    label: 'Identity',
    states: ['configured'],
  },
  {
    label: 'Contact',
    states: ['waiting_contact_request', 'contact_request_pending', 'contact_connected'],
  },
  {
    label: 'Group',
    states: ['waiting_group_invitation', 'group_invitation_pending', 'joined'],
  },
  {
    label: 'Role',
    states: ['waiting_expected_role', 'role_verified'],
  },
  {
    label: 'Ready',
    states: ['ready'],
  },
] as const;

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function text(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function checked(value: unknown): boolean {
  return value === 'true' || value === '1' || value === 'on';
}

function positiveInteger(value: unknown, label: string, fallback: number): number {
  if (value === undefined || value === null || value === '') return fallback;

  const parsed = typeof value === 'string' ? Number.parseInt(value, 10) : Number.NaN;

  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new Error(`${label} must be a positive integer.`);
  }

  return parsed;
}

function optionalPositiveInteger(value: unknown): number | null {
  if (value === undefined || value === null || value === '') return null;

  const parsed = typeof value === 'string' ? Number.parseInt(value, 10) : Number.NaN;
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

function parseCommands(value: unknown): unknown[] {
  const source = text(value).trim();
  if (!source) return [];

  const parsed = JSON.parse(source) as unknown;
  if (!Array.isArray(parsed)) throw new Error('Custom commands must be a JSON array.');

  return parsed;
}

/**
 * The slug's format, as the browser must receive it (CCB-S5-010).
 *
 * ── THE HYPHEN HAS TO BE ESCAPED, AND IT WAS NOT ─────────────────────────────
 *
 * This was written inline as `[a-z0-9][a-z0-9-]{1,62}` and had been since the field was
 * added. Browsers compile `pattern` in regex **`v` mode**, where an unescaped `-` inside a
 * character class is a syntax error, so the pattern NEVER COMPILED: it threw on every
 * validation attempt and the constraint was silently dropped. Measured in the console rather
 * than reasoned about, because that is the only way this was ever going to surface: with the
 * old pattern, an input holding `NOT a slug!!` reported itself **valid**. The client-side
 * format check has therefore never once run, and the server's `profileSlug` has been the only
 * thing keeping a bad key out. It did its job, which is why nobody noticed.
 *
 * A constant rather than an inline string so `verify:bot-creation-form` can compile it in
 * both `u` and `v` mode and fail if it ever stops being valid in either. Written with `\\-`
 * in the source so a single backslash reaches the HTML: inside a template literal `\-` is a
 * NonEscapeCharacter and cooks away to a bare `-`, which would put the defect straight back.
 */
export const SLUG_PATTERN = '[a-z0-9][a-z0-9\\-]{1,62}';

function defaults(): BotCreationInput {
  return {
    slug: '',
    displayName: '',
    // Empty, and filled in the browser from the bot name as it is typed. Seeding it here
    // would mean rendering a wake word for a bot with no name yet (CCB-S5-009).
    wakeWord: '',
    enabled: true,
    createAddress: true,
    updateAddress: true,
    updateProfile: true,
    autoAcceptContacts: true,
    welcomeMessage: '',
    businessAddress: false,
    allowFiles: true,
    commandRegistryMode: 'cinderella_defaults',
    customCommands: [],
    useBotProfile: true,
    logContacts: true,
    logNetwork: false,
    groupInvitationMode: 'manual',
    expectedGroupRole: 'admin',
    roleVerificationRequired: true,
    policyActivationMode: 'manual',
    remoteCommandsEnabled: false,
    persistentChangesEnabled: false,
    contactRequestRetentionHours: 168,
    groupInvitationRetentionHours: 168,
    maxPendingContactRequests: 100,
    // Mid dials and no character (CCB-S4-029). The wizard collects the character, which
    // is the part only a person can write; the dials are left at their middle and are
    // turned on the Personality page, where each one shows what its value means.
    personality: { ...DEFAULT_PERSONALITY },
  };
}

function formInput(body: Record<string, unknown>): BotCreationInput {
  return {
    slug: text(body['slug']),
    displayName: text(body['displayName']),
    // Present on the create form only. The edit dialog posts nothing here and the update
    // path ignores it, which is why `BotCreationInput` and not `BotOnboardingInput` carries
    // it: the type says which of the two forms owns the field.
    wakeWord: text(body['wakeWord']),
    enabled: checked(body['enabled']),
    createAddress: checked(body['createAddress']),
    updateAddress: checked(body['updateAddress']),
    updateProfile: checked(body['updateProfile']),
    autoAcceptContacts: checked(body['autoAcceptContacts']),
    welcomeMessage: text(body['welcomeMessage']),
    businessAddress: checked(body['businessAddress']),
    allowFiles: checked(body['allowFiles']),
    commandRegistryMode: text(body['commandRegistryMode']) as CommandRegistryMode,
    customCommands: parseCommands(body['customCommands']),
    useBotProfile: checked(body['useBotProfile']),
    logContacts: checked(body['logContacts']),
    logNetwork: checked(body['logNetwork']),
    groupInvitationMode: text(body['groupInvitationMode']) as GroupInvitationMode,
    expectedGroupRole: text(body['expectedGroupRole']) as SdkGroupRole,
    roleVerificationRequired: checked(body['roleVerificationRequired']),
    policyActivationMode: text(body['policyActivationMode']) as PolicyActivationMode,
    remoteCommandsEnabled: checked(body['remoteCommandsEnabled']),
    persistentChangesEnabled: checked(body['persistentChangesEnabled']),
    contactRequestRetentionHours: positiveInteger(
      body['contactRequestRetentionHours'],
      'Contact request retention',
      168,
    ),
    groupInvitationRetentionHours: positiveInteger(
      body['groupInvitationRetentionHours'],
      'Group invitation retention',
      168,
    ),
    maxPendingContactRequests: positiveInteger(
      body['maxPendingContactRequests'],
      'Maximum pending contact requests',
      100,
    ),
    // The wizard posts the base character only. The dials are absent from this form on
    // purpose, and `normalizePersonality` fills them with the middle value rather than
    // with zero, so a wizard save can never dial a bot to the bottom of every axis by
    // omission. Editing an existing bot re-posts its stored character (see `wizardDialog`),
    // so a save from here does not silently clear it.
    personality: normalizePersonality({ baseCharacter: text(body['baseCharacter']) }),
  };
}

function option(value: string, label: string, current: string, description?: string): SafeHtml {
  return html`<option value="${value}" ${value === current ? raw('selected') : ''}>
    ${label}${description ? ` | ${description}` : ''}
  </option>`;
}

function toggle(
  name: string,
  label: string,
  description: string,
  enabled: boolean,
  warning = false,
): SafeHtml {
  return html`<label class="setup-toggle ${warning ? 'setup-toggle-warning' : ''}">
    <input type="checkbox" name="${name}" value="true" ${enabled ? raw('checked') : ''} />
    <span class="setup-toggle-indicator" aria-hidden="true"></span>
    <span class="setup-toggle-copy">
      <strong>${label}</strong>
      <small>${description}</small>
    </span>
  </label>`;
}

function hidden(name: string, value: string | number | boolean): SafeHtml {
  return html`<input type="hidden" name="${name}" value="${String(value)}" />`;
}

function workflowIndex(profile: BotOnboardingProfile): number {
  const found = JOURNEY.findIndex((phase) =>
    (phase.states as readonly string[]).includes(profile.workflowState),
  );
  return found < 0 ? 0 : found;
}

function workflowLabel(profile: BotOnboardingProfile): string {
  const labels: Record<string, string> = {
    configured: 'Configuration stored',
    waiting_contact_request: 'Waiting for a contact request',
    contact_request_pending: 'Contact request needs attention',
    contact_connected: 'Direct contact connected',
    waiting_group_invitation: 'Waiting for a group invitation',
    group_invitation_pending: 'Group invitation needs attention',
    joined: 'AI bot joined the group',
    waiting_expected_role: 'Waiting for the expected role',
    role_verified: 'SimpleX role verified',
    ready: 'Ready for policy activation',
    error: 'Setup requires attention',
  };

  return labels[profile.workflowState] ?? profile.workflowState;
}

function nextAction(profile: BotOnboardingProfile): { title: string; description: string } {
  switch (profile.workflowState) {
    case 'configured':
      return {
        title: 'Create the SimpleX contact address',
        description:
          'The settings are stored. Creating the address asks the running SimpleX core for ' +
          'the contact link, which you then use to add this bot as a contact.',
      };
    case 'waiting_contact_request':
      return {
        title: 'Send a contact request',
        description:
          'The contact link is below. Open your own SimpleX app, add a contact with that ' +
          'link, and this bot receives the request.',
      };
    case 'contact_request_pending':
      return {
        title: 'Review the contact request',
        description:
          'Someone used the contact link. Accept it below to connect, or reject it if it ' +
          'is not the request you were expecting.',
      };
    case 'contact_connected':
      return {
        title: 'Invite the bot into a group',
        description:
          'The direct contact is connected. Inviting the bot into a group is the next step ' +
          'and is not built yet, so nothing here does it for you.',
      };
    case 'waiting_group_invitation':
      return {
        title: 'Send the group invitation',
        description: 'The AI bot is connected as a contact and can now be invited to a group.',
      };
    case 'group_invitation_pending':
      return {
        title: 'Review the group invitation',
        description:
          'The bot has been invited to a group. Joining below puts it in the group; it does ' +
          'not grant it any role beyond the one the invitation carries.',
      };
    case 'joined':
      return {
        title: `Verify the ${profile.expectedGroupRole} role`,
        description:
          'The bot is in the group. Checking the role it actually holds against the role you ' +
          'expect is the next step and is not built yet.',
      };
    case 'waiting_expected_role':
      return {
        title: `Waiting for ${profile.expectedGroupRole}`,
        description: 'Change the role in SimpleX, then run role verification.',
      };
    case 'role_verified':
      return {
        title: 'Review and activate access policy',
        description: 'The SimpleX role is verified. Policy activation still requires confirmation.',
      };
    case 'ready':
      return {
        title: 'Setup complete',
        description: 'The bot is ready for the next controlled runtime phase.',
      };
    default:
      return {
        title: 'Review setup status',
        description: 'Open the technical details and inspect the stored workflow state.',
      };
  }
}

function journey(profile: BotOnboardingProfile): SafeHtml {
  const current = workflowIndex(profile);

  return html`<ol class="setup-journey" aria-label="AI Bot setup progress">
    ${JOURNEY.map(
      (phase, index) =>
        html`<li
          class="setup-journey-step"
          data-state="${index < current ? 'complete' : index === current ? 'current' : 'upcoming'}"
        >
          <span class="setup-journey-dot">${index + 1}</span>
          <span>${phase.label}</span>
        </li>`,
    )}
  </ol>`;
}

function wizardDialog(
  profile: BotOnboardingProfile | null,
  csrf: string,
  // The create form's shape, with the wake word optional so the EDIT dialog can pass a
  // stored profile: that dialog does not render the field, because it does not save
  // overrides and a field that looks saved and is not is the recurring defect on this form.
  input: BotOnboardingInput & { wakeWord?: string },
  id: string,
): SafeHtml {
  const action = profile ? 'update-profile' : 'create-profile';
  const submitLabel = profile ? 'Save AI Bot' : 'Create AI Bot';

  return html`<dialog id="${id}" class="setup-dialog" data-setup-dialog>
    <form method="post" action="/ai/onboarding" class="setup-wizard-form" data-setup-form>
      <input type="hidden" name="_csrf" value="${csrf}" />
      <input type="hidden" name="action" value="${action}" />
      ${profile ? hidden('profileId', profile.id) : null}
      ${hidden('createAddress', input.createAddress)}
      ${hidden('updateAddress', input.updateAddress)}
      ${hidden('updateProfile', input.updateProfile)}
      ${hidden('businessAddress', input.businessAddress)}
      ${hidden('commandRegistryMode', input.commandRegistryMode)}
      ${hidden('customCommands', JSON.stringify(input.customCommands))}
      ${hidden('useBotProfile', input.useBotProfile)} ${hidden('logContacts', input.logContacts)}
      ${hidden('logNetwork', input.logNetwork)}
      ${hidden('contactRequestRetentionHours', input.contactRequestRetentionHours)}
      ${hidden('groupInvitationRetentionHours', input.groupInvitationRetentionHours)}
      ${hidden('maxPendingContactRequests', input.maxPendingContactRequests)}

      <header class="setup-dialog-header">
        <div>
          <span class="setup-eyebrow">Guided assistant</span>
          <h2>${profile ? `Edit ${profile.displayName}` : 'Create AI Bot'}</h2>
          <p>One clear setup decision is shown at a time.</p>
        </div>
        <button
          type="button"
          class="setup-dialog-close"
          data-setup-close
          aria-label="Close assistant"
        >
          ×
        </button>
      </header>

      <div class="setup-wizard-progress">
        <div class="setup-wizard-progress-copy">
          <span data-setup-step-label>Step 1 of 5</span>
          <span data-setup-step-title>Identity</span>
        </div>
        <div class="setup-wizard-progress-track" aria-hidden="true">
          <span data-setup-progress></span>
        </div>
      </div>

      <div class="setup-wizard-body">
        <section class="setup-wizard-step" data-setup-step="0">
          <div class="setup-step-heading">
            <span>Step 1</span>
            <h3>Identity</h3>
            <p>Choose the individual bot name and its internal setup key.</p>
          </div>
          <div class="setup-step-explanation" data-step-explanation="identity">
            <p>
              Choose the bot name shown to members in SimpleX. The internal key links this bot
              profile to its saved settings, runtime status, and audit records.
            </p>
            <p>
              Use a clear name and a stable internal key so the bot remains easy to identify later.
            </p>
          </div>
          <div class="setup-field-grid">
            <label class="setup-field">
              <span>Bot name</span>
              <input
                name="displayName"
                value="${input.displayName}"
                required
                maxlength="80"
                autocomplete="off"
                data-review-source="displayName"
                data-wake-source
              />
              <small>This name is shown to members in SimpleX.</small>
            </label>
            ${
              // ── THE WAKE WORD, ASKED FOR (CCB-S5-009) ─────────────────────────
              //
              // Only when creating. It is a per-bot interaction override, not a column on
              // this record, and the edit dialog does not save overrides: a field here on
              // edit would look like it saved and would not. The Addressing page is the
              // edit path, and the note below points at it.
              //
              // Pre-filled from the bot name by `admin-setup-wizard.js` as the operator
              // types, and only until they touch this field. The derivation stays the
              // default and stops being the decision: SANCH3Z should answer to Sanchez, and
              // nothing in the code can know that.
              profile
                ? null
                : html`<label class="setup-field">
                    <span>Wake word</span>
                    <input
                      name="wakeWord"
                      value="${input.wakeWord ?? ''}"
                      required
                      minlength="2"
                      maxlength="${String(WAKE_WORD_MAX_CHARS)}"
                      autocomplete="off"
                      data-wake-word
                      data-review-source="wakeWord"
                    />
                    <small
                      >This is what members call it, and it is what wakes it.
                      <strong>One word</strong>, because a wake word is matched one word at a
                      time: a two word name would never be heard. It starts from the first word
                      of the bot name and you can change it, so a bot shown as SANCH3Z probably
                      answers better to Sanchez. Two bots cannot share one, because both would
                      answer the same sentence. Change it later on the Addressing page.</small
                    >
                  </label>`
            }
            <label class="setup-field">
              <span>Internal key</span>
              <input
                name="slug"
                value="${input.slug}"
                required
                minlength="2"
                maxlength="63"
                pattern="${SLUG_PATTERN}"
                autocomplete="off"
                data-review-source="slug"
                data-derive="slug"
              />
              <small
                >Technical identifier used to link this bot profile to saved settings and audit
                records. It starts from the bot name and you can change it; lower case letters,
                numbers and hyphens.</small
              >
            </label>
          </div>
          ${
            // The base character is collected at creation and edited on the Personality
            // page (CCB-S4-029). It is NOT rendered on the edit dialog, and that is the
            // point: this form's save does not write the personality columns, so a field
            // here would be a control that appears to save and does not.
            profile
              ? html`<div class="setup-inline-note">
                  This bot already has a character, an origin and four voice dials.
                  <a href="/ai/personality?bot=${String(profile.id)}">Open its Personality page</a>
                  to change how it sounds and what it says about where it came from. Nothing on
                  this dialog affects that.
                </div>`
              : html`<label class="setup-field">
                  <span>Base character</span>
                  <textarea
                    name="baseCharacter"
                    rows="4"
                    maxlength="${String(BASE_CHARACTER_MAX_CHARS)}"
                    placeholder="Who she is, in your own words. Cyberpunk, sharp, whatever you want her to be."
                  >
${input.personality.baseCharacter}</textarea
                  >
                  <small
                    >Sent at the top of every conversation prompt, where it outranks any generic
                    idea of a chat assistant. The four voice dials start at their middle and are
                    turned on the Personality page, which is also where the origin lives: a new
                    bot ships with her written history already in it, and you can rewrite or
                    clear it there. Optional, and editable later.</small
                  >
                </label>`
          }
          <div class="setup-toggle-grid">
            ${
              // THE PRIMARY TOGGLE IS GONE FROM THIS FORM (CCB-S5-008). It asked the operator
              // to decide something that creating a bot does not decide, under a name that
              // stopped being true under D-155, and it defaulted to on: so creating a second
              // bot meant ticking a box labelled "select for the runtime" on a bot that must
              // not take it, and being refused by the unique index for doing as it said.
              // A new bot is simply a bot. Which one is the primary is its own action on the
              // detail card, and hosting is not affected by either.
              toggle('enabled', 'Enabled', 'Allows this setup to be used later.', input.enabled)
            }
          </div>
        </section>

        <section class="setup-wizard-step" data-setup-step="1" hidden>
          <div class="setup-step-heading">
            <span>Step 2</span>
            <h3>Contact handling</h3>
            <p>Configure how direct SimpleX contact requests should be handled.</p>
          </div>
          <div class="setup-step-explanation" data-step-explanation="contact">
            <p>
              Choose how direct SimpleX contact requests are handled. Automatic acceptance creates a
              direct contact connection without granting group roles or administrative permissions.
            </p>
            <p>
              The optional welcome message and supported file handling are configured here as well.
            </p>
          </div>
          <div class="setup-toggle-grid">
            ${toggle(
              'autoAcceptContacts',
              'Accept contact requests automatically',
              'Recommended for the first controlled setup.',
              input.autoAcceptContacts,
            )}
            ${toggle(
              'allowFiles',
              'Allow files',
              'Allows supported file handling after runtime wiring is active.',
              input.allowFiles,
            )}
          </div>
          <label class="setup-field">
            <span>Welcome message</span>
            <textarea
              name="welcomeMessage"
              rows="5"
              maxlength="4000"
              placeholder="Optional message shown before the connection is completed."
            >
${input.welcomeMessage}</textarea>
            <small>Leave empty to use no welcome message.</small>
          </label>
        </section>

        <section class="setup-wizard-step" data-setup-step="2" hidden>
          <div class="setup-step-heading">
            <span>Step 3</span>
            <h3>Group and role</h3>
            <p>Choose how invitations are reviewed and which SimpleX role is expected.</p>
          </div>
          <div class="setup-step-explanation" data-step-explanation="group-role">
            <p>
              Choose which group invitations may be accepted and which SimpleX role should be
              verified after the bot joins a group.
            </p>
            <p>
              The detected SimpleX role and the internal Access Control policy are evaluated
              separately.
            </p>
          </div>
          <div class="setup-field-grid">
            <label class="setup-field">
              <span>Group invitations</span>
              <select name="groupInvitationMode" data-review-source="groupInvitationMode">
                ${option('manual', 'Manual review', input.groupInvitationMode)}
                ${option('automatic', 'Automatic', input.groupInvitationMode)}
                ${option(
                  'approved_contacts',
                  'Automatic for approved contacts',
                  input.groupInvitationMode,
                )}
                ${option(
                  'approved_groups',
                  'Automatic for approved groups',
                  input.groupInvitationMode,
                )}
              </select>
              <small>Manual review is the safest initial setting.</small>
            </label>
            <label class="setup-field">
              <span>Expected SimpleX role</span>
              <select name="expectedGroupRole" data-review-source="expectedGroupRole">
                ${SDK_ROLES.map((role) =>
                  option(
                    role.value,
                    role.label,
                    input.expectedGroupRole,
                    role.operational ? undefined : 'advanced',
                  ),
                )}
              </select>
              <small>Admin remains the controlled test default.</small>
            </label>
          </div>
          <div class="setup-toggle-grid">
            ${toggle(
              'roleVerificationRequired',
              'Require role verification',
              'Do not prepare access policy until the detected role matches.',
              input.roleVerificationRequired,
            )}
          </div>
        </section>

        <section class="setup-wizard-step" data-setup-step="3" hidden>
          <div class="setup-step-heading">
            <span>Step 4</span>
            <h3>Permissions and safety</h3>
            <p>Choose whether this AI bot may execute remote commands or save permanent changes.</p>
          </div>
          <div class="setup-step-explanation" data-step-explanation="permissions">
            <p>
              Remote commands permit supported administrative actions through chat. Persistent
              changes allow configuration updates to remain saved after the current request.
            </p>
            <p>Keep both switches disabled during the first connection and role tests.</p>
          </div>
          <div class="setup-safety-explanation">
            <strong>Recommended for the first setup</strong>
            <p>
              Leave both switches disabled. The bot can be connected and tested without receiving
              authority to execute remote administration or change persistent configuration.
            </p>
          </div>
          <label class="setup-field">
            <span>Policy activation</span>
            <select name="policyActivationMode" data-review-source="policyActivationMode">
              ${option('manual', 'Manual confirmation', input.policyActivationMode)}
              ${option(
                'automatic_after_verification',
                'Automatic after role verification',
                input.policyActivationMode,
              )}
            </select>
            <small>Manual confirmation is recommended until the full workflow is tested.</small>
          </label>
          <div class="setup-toggle-grid">
            ${toggle(
              'remoteCommandsEnabled',
              'Remote commands',
              'Stored only. Runtime execution is not active.',
              input.remoteCommandsEnabled,
              true,
            )}
            ${toggle(
              'persistentChangesEnabled',
              'Persistent remote changes',
              'Stored only. Permanent changes are not active.',
              input.persistentChangesEnabled,
              true,
            )}
          </div>
        </section>

        <section class="setup-wizard-step" data-setup-step="4" hidden>
          <div class="setup-step-heading">
            <span>Step 5</span>
            <h3>Review</h3>
            <p>Check the important choices before saving.</p>
          </div>
          <div class="setup-step-explanation" data-step-explanation="review">
            <p>
              Check the bot identity, contact rules, invitation mode, expected role, and safety
              switches before saving.
            </p>
            <p>
              Saving stores the configuration. It does not run SimpleX actions or activate Access
              Control.
            </p>
          </div>
          <dl class="setup-review-grid">
            <div>
              <dt>Bot name</dt>
              <dd data-review-value="displayName">${input.displayName}</dd>
            </div>
            <div>
              <dt>Internal key</dt>
              <dd data-review-value="slug">${input.slug}</dd>
            </div>
            <div>
              <dt>Group invitations</dt>
              <dd data-review-value="groupInvitationMode">${input.groupInvitationMode}</dd>
            </div>
            <div>
              <dt>Expected role</dt>
              <dd data-review-value="expectedGroupRole">${input.expectedGroupRole}</dd>
            </div>
            <div>
              <dt>Policy activation</dt>
              <dd data-review-value="policyActivationMode">${input.policyActivationMode}</dd>
            </div>
            <div>
              <dt>Runtime action</dt>
              <dd>Configuration storage only</dd>
            </div>
          </dl>
          <div class="setup-boundary-note">
            Saving does not create a SimpleX address, accept a request, join a group, change a role,
            or activate an access policy.
          </div>
        </section>
      </div>

      <footer class="setup-dialog-footer">
        <button type="button" class="setup-button setup-button-quiet" data-setup-close>
          Cancel
        </button>
        <button type="submit" class="setup-button setup-button-secondary">Save and exit</button>
        <span class="setup-dialog-spacer"></span>
        <button type="button" class="setup-button setup-button-quiet" data-setup-back hidden>
          Back
        </button>
        <button type="button" class="setup-button setup-button-primary" data-setup-next>
          Continue
        </button>
        <button type="submit" class="setup-button setup-button-primary" data-setup-finish hidden>
          ${submitLabel}
        </button>
      </footer>
    </form>
  </dialog>`;
}


/**
 * The control the wizard's "next action" points at.
 *
 * The wizard has described this step since the onboarding work landed and there has
 * never been a control behind it: the page said what to do next and offered no way to
 * do it. This is that way. It renders only in `configured`, only for the bot the
 * operator marked as the runtime's, and it says WHICH SimpleX identity it will act on
 * before it acts, because an address created on the wrong profile in a shared core
 * database is invisible until somebody tries to use the link.
 */
function createAddressControl(
  profile: BotOnboardingProfile,
  csrf: string,
  hosted: HostedIdentity | null,
): SafeHtml | null {
  if (profile.workflowState !== 'configured') return null;

  // NO PRIMARY GUARD (CCB-S5-007). Being the primary was never the question; being HOSTED
  // is. The old guard existed because the action could not target a bot, and it made
  // onboarding a second bot impossible.
  // TWO DIFFERENT FACTS, two different sentences (CCB-S5-007). `hostedIdentity` answers null
  // both when the runtime is not running at all and when it is running without THIS bot, and
  // collapsing them told an operator with a stopped bot to go and enable a bot that was
  // already enabled. `runtimeAdminAvailable` is the one that separates them.
  const note =
    hosted === null
      ? html`<p class="setup-inline-note" data-tone="warning">
          ${!runtimeAdminAvailable()
            ? 'The SimpleX runtime is not running in this process, so the address cannot be ' +
              'created right now. Start the bot, then reload this page.'
            : profile.enabled
              ? 'The runtime is running but is not hosting this bot, so there is no identity ' +
                'to create an address on. A bot is picked up at start, so restart the bot ' +
                'after enabling it, then reload this page.'
              : 'This bot is paused, so the runtime is not hosting it and there is no ' +
                'identity to create an address on. Enable it in Edit setup, then restart.'}
        </p>`
      : html`<p class="setup-inline-note">
          It will be created on the profile the runtime is hosting:
          <strong>${hosted.displayName}</strong> (SimpleX user ${hosted.simplexUserId}).
          ${hosted.state === 'ready'
            ? null
            : html`<br />The core is still starting up (${hosted.state}); it settles a few
                seconds after a restart.`}
          ${hosted.displayName === profile.displayName
            ? null
            : html`<br />The name stored here is <strong>${profile.displayName}</strong>, which
                is not the hosted profile's name. The address is created on the hosted
                profile, not on this record's name.`}
        </p>`;

  return html`
    <form method="post" action="/ai/onboarding" class="setup-next-action-form">
      <input type="hidden" name="_csrf" value="${csrf}" />
      <input type="hidden" name="action" value="create-address" />
      <input type="hidden" name="profileId" value="${profile.id}" />
      <button type="submit" class="setup-button setup-button-primary">
        Create the contact address
      </button>
    </form>
    ${note}
  `;
}

/**
 * The contact link, once one exists, with what the page is waiting for.
 *
 * Shown for every state from `waiting_contact_request` onwards, not only that one: the
 * link stays useful after the first contact connects, and a panel that vanished at the
 * next step would look like the address had been withdrawn.
 */
function contactAddressPanel(profile: BotOnboardingProfile): SafeHtml | null {
  if (!profile.contactAddressLink) return null;
  const waiting = profile.workflowState === 'waiting_contact_request';

  return html`<section class="setup-address" data-address-panel>
    <header>
      <span class="setup-eyebrow">SimpleX contact address</span>
      ${waiting ? badge('waiting for a contact request', 'amber') : badge('address created', 'green')}
    </header>
    <p>
      Open your own SimpleX app, choose to add a contact, and paste this link. The request
      then appears below for you to accept.
    </p>
    <code class="setup-address-link" data-address-link>${profile.contactAddressLink}</code>
    <p class="setup-inline-note">
      Created ${fmtDate(profile.contactAddressCreatedAt ?? profile.updatedAt)} on SimpleX user
      ${profile.contactAddressUserId ?? 'unknown'}.
    </p>
  </section>`;
}


/**
 * The contact requests the core has actually reported (CCB-S4-023).
 *
 * Every request is listed, pending ones first, because a public contact address can be
 * used by anyone who has it and more than one can be outstanding. Showing only the
 * newest would have the operator accept whichever one the page happened to render.
 */
function contactRequestPanel(requests: readonly BotContactRequest[], csrf: string): SafeHtml | null {
  if (requests.length === 0) return null;
  const pending = requests.filter((r) => r.state === 'pending');

  const row = (r: BotContactRequest): SafeHtml => html`<li
    class="setup-request"
    data-request-state="${r.state}"
    data-request-id="${r.contactRequestId}"
  >
    <div class="setup-request-who">
      <strong>${r.requesterName}</strong>
      <small>
        Request ${r.contactRequestId}, received ${fmtDate(r.receivedAt)}${r.state === 'accepted'
          ? html`, accepted as contact ${r.contactId}${r.connectedAt
              ? html`, connected ${fmtDate(r.connectedAt)}`
              : html`, <em>connecting</em>`}`
          : r.state === 'rejected'
            ? html`, rejected ${fmtDate(r.resolvedAt ?? r.receivedAt)}`
            : null}
      </small>
    </div>
    ${r.state === 'pending'
      ? html`<div class="setup-request-actions">
          <form method="post" action="/ai/onboarding">
            <input type="hidden" name="_csrf" value="${csrf}" />
            <input type="hidden" name="action" value="accept-contact" />
            <input type="hidden" name="profileId" value="${r.botProfileId}" />
            <input type="hidden" name="contactRequestId" value="${r.contactRequestId}" />
            <button type="submit" class="setup-button setup-button-primary">Accept</button>
          </form>
          <form method="post" action="/ai/onboarding">
            <input type="hidden" name="_csrf" value="${csrf}" />
            <input type="hidden" name="action" value="reject-contact" />
            <input type="hidden" name="profileId" value="${r.botProfileId}" />
            <input type="hidden" name="contactRequestId" value="${r.contactRequestId}" />
            <button type="submit" class="setup-button setup-button-quiet">Reject</button>
          </form>
        </div>`
      : html`<span class="setup-request-state">${r.state}</span>`}
  </li>`;

  return html`<section class="setup-requests" data-request-panel>
    <header>
      <span class="setup-eyebrow">Contact requests</span>
      ${pending.length > 0
        ? badge(`${pending.length} awaiting your decision`, 'amber')
        : badge('nothing pending', 'green')}
    </header>
    ${pending.length > 0
      ? html`<p>
          Someone used the contact link. Accepting connects the bot to them as a direct
          contact and nothing else: it does not put the bot in any group. Rejecting is
          silent, the sender is not told.
        </p>`
      : null}
    <ul class="setup-request-list">
      ${requests.map(row)}
    </ul>
  </section>`;
}


/**
 * The group invitations the core has reported (CCB-S4-025).
 *
 * The role is shown three ways on purpose once a group is joined: what the invitation
 * offered, what the bot actually holds, and what the operator expects. They are usually
 * the same and they are not the same fact, and a page that showed one of them as all
 * three would be answering step four's question by assuming it.
 */
function groupInvitationPanel(
  invitations: readonly BotGroupInvitation[],
  expectedRole: string,
  csrf: string,
): SafeHtml | null {
  if (invitations.length === 0) return null;
  const pending = invitations.filter((i) => i.state === 'pending');

  const row = (g: BotGroupInvitation): SafeHtml => html`<li
    class="setup-request"
    data-invitation-state="${g.state}"
    data-group-id="${g.groupId}"
  >
    <div class="setup-request-who">
      <strong>${g.groupName}</strong>
      <small>
        Group ${g.groupId}, invited by ${g.inviterName} as ${g.invitedAsRole}, received
        ${fmtDate(g.receivedAt)}${g.state === 'joined'
          ? html`, joined as <strong>${g.joinedRole ?? 'unknown'}</strong>${g.joinedAt
              ? html`, membership live ${fmtDate(g.joinedAt)}`
              : html`, <em>membership still settling</em>`}`
          : null}
      </small>
    </div>
    ${g.state === 'pending'
      ? html`<div class="setup-request-actions">
          <form method="post" action="/ai/onboarding">
            <input type="hidden" name="_csrf" value="${csrf}" />
            <input type="hidden" name="action" value="join-group" />
            <input type="hidden" name="profileId" value="${g.botProfileId}" />
            <input type="hidden" name="groupId" value="${g.groupId}" />
            <button type="submit" class="setup-button setup-button-primary">Join the group</button>
          </form>
        </div>`
      : html`<span class="setup-request-state">joined</span>`}
  </li>`;

  const joined = invitations.filter((g) => g.state === 'joined');
  const roleMismatch = joined.filter((g) => g.joinedRole !== expectedRole);

  return html`<section class="setup-requests" data-invitation-panel>
    <header>
      <span class="setup-eyebrow">Group invitations</span>
      ${pending.length > 0
        ? badge(`${pending.length} awaiting your decision`, 'amber')
        : badge('nothing pending', 'green')}
    </header>
    ${pending.length > 0
      ? html`<p>
          Joining puts the bot in the group with the role the invitation carries. It does
          not change anyone's role and it does not switch any capture or policy on.
        </p>`
      : null}
    <ul class="setup-request-list">
      ${invitations.map(row)}
    </ul>
    ${joined.length > 0
      ? html`<p class="setup-inline-note" data-tone="${roleMismatch.length > 0 ? 'warning' : ''}">
          ${roleMismatch.length > 0
            ? html`The role held is not the <strong>${expectedRole}</strong> role you expect.`
            : html`The role held matches the <strong>${expectedRole}</strong> role you expect.`}
          Either way it is <strong>not verified</strong>: checking and adjusting the role is
          the next step and is not built yet, so nothing here has enforced it.
        </p>`
      : null}
  </section>`;
}

/**
 * Apply a bot's configured face to the running bot, reporting which of four things happened.
 *
 * ── WHY IT RESOLVES THE IMAGE THE WAY BOOT DOES ──────────────────────────────
 *
 * Through `decideFaces`, the same pure function `startRuntimeHost` uses, rather than a second
 * reading of the same columns. That is what keeps "the face this bot wears" one answer: null
 * means the deployment default, an unreadable configured path is a FAULT that dresses nobody
 * (D-161), and both of those stay true here without being restated.
 *
 * ── AND WHY A RUNTIME THAT IS DOWN IS NOT AN ERROR ───────────────────────────
 *
 * The row is already written by the time this runs, and it is correct: it is the operator's
 * decision about what the bot wears. A stopped runtime means the live apply did not happen,
 * not that the upload failed, so it returns a different banner rather than throwing. Anything
 * else, including a fault reading the file, is a real error the operator has to see.
 */
async function applyFaceIfRunning(ctx: ViewContext, profileId: number): Promise<string> {
  const profile = (await listBotOnboardingProfiles(ctx.db)).find((p) => p.id === profileId);
  if (!profile) return 'avatar';

  const [outcome] = await decideFaces([{ displayName: profile.displayName, avatarPath: profile.avatarPath }], {
    defaultImage: await loadAvatarDataUri(ctx.cfg.avatarPath),
    resolve: (relative) => resolveAssetPath(ctx.cfg.assetRoot, relative),
    load: loadAvatarDataUri,
  });
  if (outcome?.source === 'fault') {
    // Configured and unreadable dresses nobody, here as at boot. Raised rather than
    // quietly falling back to the deployment's face, which would put somebody else's
    // picture on this bot and call it success.
    throw new Error(outcome.fault ?? 'That bot has an avatar configured that cannot be read.');
  }

  try {
    const applied = await applyBotFaceNow(ctx.db, profileId, outcome?.image);
    return applied.alreadyCurrent ? 'avatar-already' : 'avatar-live';
  } catch (err) {
    if (err instanceof RuntimeActionUnavailableError) {
      log.info(`Bot ${profileId}: face stored but not applied live: ${errorMessage(err)}`);
      return 'avatar';
    }
    throw err;
  }
}

/**
 * What actually happened, instead of "AI bot configuration saved" for all of it.
 *
 * Added with the make-primary action (CCB-S5-008), because that action's whole difficulty is
 * that operators reasonably expect it to start or stop something, and a success banner reading
 * "configuration saved" answers none of that. The mapping is from a fixed set to fixed strings:
 * the query parameter chooses a sentence and is never rendered, so a hand-edited URL cannot put
 * text on the page.
 */
function savedMessage(action: string): string {
  switch (action) {
    case 'make-primary':
      return (
        'That bot is now the primary. Nothing was started, stopped or restarted: every ' +
        'enabled bot was already running and still is.'
      );
    case 'create-profile':
      return 'AI bot created.';
    case 'delete-profile':
      return 'AI bot deleted.';
    case 'avatar':
      return (
        'The image is stored, but the bot is not running, so it is not wearing it yet. It ' +
        'is applied when the bot next starts, or press "Apply to the running bot" once it is up.'
      );
    case 'avatar-live':
      return (
        'Done. The bot is wearing it now and its groups have been told, so members see the ' +
        'new picture without a restart.'
      );
    case 'avatar-already':
      return 'That is already the picture the bot is wearing, and its members already have it.';
    case 'avatar-cleared':
      return 'That bot is back to the deployment default image.';
    case 'create-address':
      return 'The contact address was created on the runtime.';
    default:
      return 'AI bot configuration saved.';
  }
}

/**
 * What the operator has just made, in one place (CCB-S5-009 Part 3).
 *
 * ── WHY THIS PANEL EXISTS AT ALL ─────────────────────────────────────────────
 *
 * Creating a bot left it in a state the operator could not read. The name it answers to was
 * derived invisibly and lived on the Addressing page; whether it had retorts of its own lived
 * on the Nicknames page; whether it had a face was two panels down; whether it had been
 * onboarded was a chip. Four pages to answer "what did I just make". The briefing asked
 * whether the detail page could carry it rather than whether a dashboard should be built, and
 * it can: this sits directly under the header, above the step the operator is being sent to
 * next, and adds one section rather than one page.
 *
 * ── THE RETORT STATE IS THE ONE THAT HAS TO BE HONEST ────────────────────────
 *
 * Three states and they are not interchangeable, which is why the badge names which one it
 * is rather than counting. OWN means text written for this bot, editable, working. INHERITED
 * means it is answering nicknames in the primary's voice about the primary's name, which is
 * the pre-CCB-S5-009 state and reads as normal until a member sees it. NONE means the
 * nickname path answers nothing at all. An operator who pokes a bot with a nickname and gets
 * silence has to be able to tell "off", "empty" and "misconfigured" apart, and until this
 * panel the failure was identical in all three.
 */
function identityPanel(profile: BotOnboardingProfile, identity: BotIdentityFacts): SafeHtml {
  const retortBadge =
    identity.retortSource === 'own'
      ? badge(`${String(identity.retortCount)} of its own`, 'green')
      : identity.retortSource === 'inherited'
        ? badge('inherited, not its own', 'amber')
        : badge('none', 'amber');

  return html`<section class="setup-primary" data-identity-panel>
    <header>
      <span class="setup-eyebrow">Identity</span>
      ${identity.onboarded ? badge('onboarded', 'green') : badge('not onboarded', 'slate')}
    </header>
    <dl class="setup-identity-grid">
      <div>
        <dt>Answers to</dt>
        <dd>
          <strong>${identity.wakeWord}</strong>
          ${identity.wakeWordIsOwn
            ? badge('its own', 'green')
            : badge('the shared default', 'amber')}
        </dd>
      </div>
      <div>
        <dt>Nickname retorts</dt>
        <dd>${retortBadge}</dd>
      </div>
      <div>
        <dt>Face</dt>
        <dd>
          ${identity.hasFace ? badge('its own image', 'green') : badge('deployment default', 'slate')}
        </dd>
      </div>
      <div>
        <dt>Onboarded</dt>
        <dd>
          ${identity.onboarded
            ? badge('contact address created', 'green')
            : badge('no contact address yet', 'slate')}
        </dd>
      </div>
    </dl>
    ${identity.wakeWordIsOwn
      ? null
      : html`<p class="setup-inline-note" data-tone="warning">
          This bot has no wake word of its own, so it answers to the deployment default and
          cannot be told apart from any other bot on it. Set one on the
          <a href="/interaction/addressing?bot=${String(profile.id)}">Addressing page</a>.
        </p>`}
    ${identity.retortSource === 'own'
      ? null
      : html`<p class="setup-inline-note" data-tone="warning">
          ${identity.retortSource === 'inherited'
            ? html`Its nickname retorts are inherited rather than its own, so it answers to a
                nickname in another bot's voice, about another bot's name.`
            : html`It has no nickname retorts, so a member who calls it by a nickname gets no
                reaction at all.`}
          Write some on the
          <a href="/interaction/nicknames?bot=${String(profile.id)}">Nicknames page</a>.
        </p>`}
    <p class="setup-inline-note">
      The nickname path is also what feeds verbal moderation: a nickname is what the violation
      counter counts and what the verbal escalation ladder sharpens. A bot with no retorts of
      its own still counts, and its warnings are sent on their own, but the snub that normally
      carries them is missing. Set the retorts before you tune the ladders on the
      <a href="/moderation/rules">Moderation page</a>.
    </p>
  </section>`;
}

/**
 * Which bot is the primary, and one honest line about what that now decides (CCB-S5-008).
 *
 * ── THE LABEL SURVIVED A CHANGE OF MEANING, WHICH IS THE DEFECT ──────────────
 *
 * `selected_for_runtime` used to mean "this bot runs". Under D-155 every enabled bot runs and
 * the column came to mean "this bot is the primary", and nothing renamed it. The operator was
 * left with a wizard toggle called "select for the runtime" that had to be ticked to create a
 * bot which explicitly must not be primary, and which the unique index then refused. That is
 * not a workflow anybody can follow, and the operator said so.
 *
 * So the flag is named for what it is and the panel states the smallest true thing about it.
 * Above all it says what it does NOT decide, because that is the part an operator cannot see
 * and would otherwise infer from the old name: a bot that is not the primary is hosted,
 * answers members, and captures, exactly like the one that is.
 */
function primaryPanel(profile: BotOnboardingProfile, csrf: string): SafeHtml {
  return html`<section class="setup-primary" data-primary-panel>
    <header>
      <span class="setup-eyebrow">Primary bot</span>
      ${profile.selectedForRuntime ? badge('the primary', 'green') : badge('not the primary', 'slate')}
    </header>
    <p>
      The primary is the bot this console opens on, and the one the few paths that are not yet
      per bot read. It decides nothing about hosting: every enabled bot runs, answers members
      and captures, whether it is the primary or not. Exactly one bot holds it.
    </p>
    ${profile.selectedForRuntime
      ? html`<p class="setup-inline-note">
          This bot holds it. It is never switched off, only handed over: open another bot and
          make that one the primary.
        </p>`
      : html`<form method="post" action="/ai/onboarding">
          <input type="hidden" name="_csrf" value="${csrf}" />
          <input type="hidden" name="action" value="make-primary" />
          <input type="hidden" name="profileId" value="${profile.id}" />
          <button type="submit" class="setup-button setup-button-secondary">
            Make this the primary
          </button>
          <span class="setup-inline-note">
            Moves it off whichever bot holds it now. Nothing starts, stops or restarts.
          </span>
        </form>`}
  </section>`;
}

/**
 * The face this bot wears (CCB-S5-007, D-161).
 *
 * ── WHAT THIS CONTROL IS, AND WHAT IT IS CAREFUL NOT TO CLAIM ────────────────
 *
 * `AVATAR_PATH` is one image in the environment, so before this the operator could dress the
 * first bot and no other. The column holds a path per bot and NULL means the deployment
 * default, so both states are normal and neither is styled as a problem: a bot with no upload
 * is not misconfigured, it is wearing the shipped face.
 *
 * It writes a ROW. The SimpleX profile is dressed at boot by `startRuntimeHost`, and nothing
 * here reaches into a running core, so the panel says "at next start" rather than "saved" and
 * leaves it at that. The alternative, a page that reported the bot's face had changed while
 * every member still saw the old one, is the "stores an intention" failure the contact address
 * step was built to avoid, and it would be worse here because nothing would ever correct it.
 *
 * Unlike the create-address control this renders for every bot, hosted or not, in every
 * workflow state. Uploading a face for a bot that has not been onboarded yet is a perfectly
 * ordinary thing to do, and gating it on the runtime would make dressing a second bot depend
 * on the runtime being up, which is the shape of defect this whole briefing exists to remove.
 *
 * ── AND WHY THE CHOOSER IS A LABEL AND NOT A BARE FILE INPUT (CCB-S5-008) ────
 *
 * It was a bare `<input type="file">` beside an Upload button, and the operator reported that
 * clicking Upload produced no dialogue, no error and no request. All three were true. The file
 * input rendered at 11px in a muted colour and read as a caption rather than a control, so the
 * thing that looked pressable was Upload; `admin-image-upload.js` disables Upload until a file
 * is chosen; and the console had no `:disabled` styling at all, so a disabled button was
 * indistinguishable from a live one, kept `cursor: pointer`, and swallowed every click in
 * silence. Markup, wiring, route and checks were all correct and the control was dead.
 *
 * So the chooser is now shaped like every other button on the page and carries the accent,
 * Upload is quiet until there is something to upload, and the status line says what the state
 * is rather than being empty. The `:disabled` rule that makes an inert control look inert went
 * on the base class in app.css, because this cannot be the last script to disable a button.
 */
function avatarPanel(profile: BotOnboardingProfile, csrf: string): SafeHtml {
  const own = profile.avatarPath !== null;

  return html`<section class="setup-avatar" data-avatar-panel>
    <header>
      <span class="setup-eyebrow">Bot avatar</span>
      ${own ? badge('own image', 'green') : badge('deployment default', 'slate')}
    </header>
    <p>
      The picture members see beside this bot's messages. Every bot has its own, and a bot
      with none wears the image the deployment ships with, which is the normal state for the
      first one.
    </p>

    <div class="setup-avatar-current">
      ${own
        ? html`<img
              src="/ai/onboarding/${profile.id}/avatar"
              alt="Current avatar for ${profile.displayName}"
              class="setup-avatar-image"
            />
            <form method="post" action="/ai/onboarding/${profile.id}/avatar/clear">
              <input type="hidden" name="_csrf" value="${csrf}" />
              <button type="submit" class="setup-button setup-button-quiet">
                Use the deployment default
              </button>
            </form>`
        : html`<span class="setup-avatar-status">
            No image uploaded for this bot, so it wears the deployment default.
          </span>`}
    </div>

    <form
      method="post"
      action="/ai/onboarding/${profile.id}/avatar"
      data-image-upload
      class="setup-avatar-form"
    >
      <input type="hidden" name="_csrf" value="${csrf}" />
      <input type="hidden" name="imageData" value="" />
      <label class="setup-button setup-button-secondary setup-file-button">
        <span>Choose an image</span>
        <input type="file" accept="image/*" class="setup-file-input" />
      </label>
      <button type="submit" class="setup-button setup-button-quiet">Upload</button>
      <span data-image-upload-status class="setup-avatar-status">
        No image chosen yet. Choose one, then upload it.
      </span>
    </form>

    ${
      // ── THE BUTTON, NOT THE SENTENCE (CCB-S5-016) ────────────────────────
      //
      // This panel used to end with "restart the bot to put the new face in front of
      // members", and the console offered no way to restart anything. An instruction
      // without a tool, and it cost a live avatar once. Uploading applies live now, and
      // this control exists for the cases upload cannot cover: the runtime was down when
      // the upload happened, or the face was cleared, or the operator simply wants to
      // push the current one again.
      //
      // Rendered for every bot rather than only for one with an upload, because a bot on
      // the deployment default has a face too and "apply what this bot should be wearing"
      // is the same operation either way.
      html`<form method="post" action="/ai/onboarding" class="setup-avatar-apply">
        <input type="hidden" name="_csrf" value="${csrf}" />
        <input type="hidden" name="action" value="apply-face" />
        <input type="hidden" name="profileId" value="${profile.id}" />
        <button type="submit" class="setup-button setup-button-secondary">
          Apply to the running bot
        </button>
        <span class="setup-inline-note">
          Writes the profile and sends one short message to each of its groups, which is how
          members receive a new picture. No restart.
        </span>
      </form>`
    }

    <p class="setup-inline-note">
      The file is re-encoded on the server and stored beside the other console images; the
      database keeps the path and never the bytes. Uploading applies it to the running bot
      straight away; if the bot is not running, it is stored and applied when it next starts.
    </p>
  </section>`;
}

function profileListItem(profile: BotOnboardingProfile, selected: boolean): SafeHtml {
  const issue =
    profile.workflowState === 'error' ||
    profile.remoteCommandsEnabled ||
    profile.persistentChangesEnabled;

  return html`<a
    href="/ai/onboarding?profile=${profile.id}"
    class="setup-list-item"
    data-setup-list-item
    data-search-value="${profile.displayName} ${profile.slug} ${profile.workflowState}"
    ${selected ? raw('aria-current="page"') : ''}
  >
    <span class="setup-list-avatar">${profile.displayName.slice(0, 1).toUpperCase()}</span>
    <span class="setup-list-copy">
      <strong>${profile.displayName}</strong>
      <small>${workflowLabel(profile)}</small>
    </span>
    <span
      class="setup-list-status"
      data-tone="${issue
        ? 'warning'
        : profile.contactAddressLink
          ? 'ready'
          : profile.enabled
            ? 'muted'
            : 'muted'}"
    >
      ${issue
        ? 'Review'
        : profile.contactAddressLink
          ? 'Onboarded'
          : profile.enabled
            ? 'Not onboarded'
            : 'Paused'}
    </span>
  </a>`;
}

function profileDetails(
  profile: BotOnboardingProfile,
  csrf: string,
  hosted: HostedIdentity | null,
  requests: readonly BotContactRequest[],
  invitations: readonly BotGroupInvitation[],
  identity: BotIdentityFacts,
): SafeHtml {
  const action = nextAction(profile);
  const dialogId = `setup-edit-${profile.id}`;

  return html`
    <section class="setup-detail-card">
      <header class="setup-detail-header">
        <div>
          <span class="setup-eyebrow">Selected AI Bot</span>
          <h2>${profile.displayName}</h2>
          <p>${workflowLabel(profile)}</p>
        </div>
        <button
          type="button"
          class="setup-button setup-button-secondary"
          data-setup-open="${dialogId}"
        >
          Edit setup
        </button>
      </header>

      ${identityPanel(profile, identity)} ${journey(profile)}

      <div class="setup-status-grid">
        ${stat('Stored state', profile.workflowState)}
        ${stat('Expected role', profile.expectedGroupRole)}
        ${stat('Contacts', profile.autoAcceptContacts ? 'Automatic' : 'Manual')}
        ${stat('Invitations', profile.groupInvitationMode)}
      </div>

      <section class="setup-next-action">
        <div class="setup-next-action-icon" aria-hidden="true">${workflowIndex(profile) + 1}</div>
        <div>
          <span>Next action</span>
          <h3>${action.title}</h3>
          <p>${action.description}</p>
          ${createAddressControl(profile, csrf, hosted)}
        </div>
      </section>

      ${primaryPanel(profile, csrf)}
      ${avatarPanel(profile, csrf)}
      ${contactAddressPanel(profile)}
      ${contactRequestPanel(requests, csrf)}
      ${groupInvitationPanel(invitations, profile.expectedGroupRole, csrf)}

      <div class="setup-chip-row">
        ${badge(profile.enabled ? 'enabled' : 'paused', profile.enabled ? 'green' : 'amber')}
        ${badge(profile.selectedForRuntime ? 'primary bot' : 'not the primary', 'blue')}
        ${badge('settings stored', 'green')}
        ${profile.contactAddressLink
          ? badge('contact address created on the runtime', 'green')
          : badge('runtime not applied', 'amber')}
        ${badge(profile.remoteCommandsEnabled ? 'remote requested' : 'remote blocked', 'slate')}
        ${badge(
          profile.persistentChangesEnabled ? 'persistent requested' : 'persistent blocked',
          'slate',
        )}
      </div>

      <div class="setup-detail-actions">
        <form method="post" action="/ai/onboarding">
          <input type="hidden" name="_csrf" value="${csrf}" />
          <input type="hidden" name="action" value="reset-workflow" />
          <input type="hidden" name="profileId" value="${profile.id}" />
          <button type="submit" class="setup-button setup-button-quiet">Reset workflow</button>
        </form>
        <form method="post" action="/ai/onboarding">
          <input type="hidden" name="_csrf" value="${csrf}" />
          <input type="hidden" name="action" value="delete-profile" />
          <input type="hidden" name="profileId" value="${profile.id}" />
          <button type="submit" class="setup-button setup-button-danger">
            Delete stored AI bot
          </button>
        </form>
      </div>

      <p class="setup-updated">
        Created ${fmtDate(profile.createdAt)}. Updated ${fmtDate(profile.updatedAt)}.
      </p>

      <details class="setup-technical">
        <summary>Technical details</summary>
        <div class="setup-technical-content">
          <dl class="setup-technical-grid">
            <div>
              <dt>Profile ID</dt>
              <dd>${profile.id}</dd>
            </div>
            <div>
              <dt>Slug</dt>
              <dd>${profile.slug}</dd>
            </div>
            <div>
              <dt>SDK</dt>
              <dd>${profile.sdkVersion}</dd>
            </div>
            <div>
              <dt>Types</dt>
              <dd>${profile.sdkTypesVersion}</dd>
            </div>
            <div>
              <dt>Command mode</dt>
              <dd>
                ${
      profile.commandRegistryMode === 'cinderella_defaults'
        ? 'Default command set'
        : 'Custom command set'
    }
              </dd>
            </div>
            <div>
              <dt>Contact retention</dt>
              <dd>${profile.contactRequestRetentionHours} hours</dd>
            </div>
          </dl>
        </div>
      </details>

      ${wizardDialog(profile, csrf, profile, dialogId)}
    </section>
  `;
}

function capabilityReference(): SafeHtml {
  return html`<details class="setup-reference">
    <summary>SDK reference</summary>
    <div class="setup-reference-body">
      <div class="setup-reference-intro">
        <div>
          <h2>SimpleX capability inventory</h2>
          <p>Technical names remain available without dominating the normal setup workflow.</p>
        </div>
        <div class="setup-chip-row">
          ${badge('SimpleX SDK 6.5.4', 'green')} ${badge('Types 0.8.0', 'green')}
          ${badge('1 of 4 SDK actions wired: create address', 'amber')}
        </div>
      </div>
      <div class="setup-reference-table-wrap">
        <table class="setup-reference-table">
          <thead>
            <tr>
              <th>Capability</th>
              <th>Availability</th>
              <th>Bot state</th>
            </tr>
          </thead>
          <tbody>
            ${CAPABILITIES.map(
              ([name, availability, state]) =>
                html`<tr>
                  <td><code>${name}</code></td>
                  <td>${availability}</td>
                  <td>${state}</td>
                </tr>`,
            )}
          </tbody>
        </table>
      </div>
    </div>
  </details>`;
}

export function registerAiOnboarding(app: FastifyInstance, ctx: ViewContext): void {
  app.get<{ Querystring: { saved?: string; error?: string; profile?: string } }>(
    '/ai/onboarding',
    async (req, reply) => {
      const profiles = await listBotOnboardingProfiles(ctx.db);
      const csrf = req.session?.csrfToken ?? '';
      // `?profile=` is this page's own name for the same idea, kept because every existing
      // link and every redirect on this page uses it. Falling back to the SESSION rather
      // than to the first bot is the CCB-S5-011 change: an operator who switched bots in
      // the sidebar and then opened AI Bot Setup lands on the bot he was working on.
      const requestedProfileId = optionalPositiveInteger(req.query.profile);
      const sessionBot = req.session?.selectedBotProfileId ?? null;
      const selected =
        profiles.find((profile) => profile.id === requestedProfileId) ??
        profiles.find((profile) => profile.id === sessionBot) ??
        profiles[0] ??
        null;
      const createDialogId = 'setup-create';
      // Read per request, never cached: the runtime may not have started when the
      // console did, and it may stop while the console stays up. A page that showed a
      // remembered identity would be describing a bot that is no longer there.
      // FOR THE SELECTED BOT (CCB-S5-007). With no id this answers for the primary, so the
      // page reported one bot's SimpleX identity while the operator configured another, and
      // the four steps below have real side effects on a real profile.
      const hosted = hostedIdentity(selected?.id);
      // Read for the selected bot only: the page shows one record at a time, and a
      // request belongs to the record it arrived for.
      const requests = selected ? await listContactRequests(ctx.db, selected.id) : [];
      const invitations = selected ? await listGroupInvitations(ctx.db, selected.id) : [];
      // Read from the ROWS rather than from the interaction cache, for the same reason the
      // settings save does: the cache answers with the shared record on a miss, which would
      // report a bot as inheriting when it has deviations the console just wrote.
      const identity = selected
        ? botIdentity({
            avatarPath: selected.avatarPath,
            contactAddressLink: selected.contactAddressLink,
            overrides: await listSettingOverridesForBot(ctx.db, selected.id),
            shared: ctx.interaction.get(),
          })
        : null;

      reply.type('text/html');

      return page({
        title: 'AI Bot Setup',
        active: 'ai:onboarding',
        csrfToken: csrf,
        // The switcher here mirrors the list beside it rather than replacing it: this page
        // is where bots are CREATED and deleted, so the list is doing a second job the
        // sidebar cannot. Both drive the same selection.
        botSwitcher: {
          bots: profiles.map((p) => ({ id: p.id, displayName: p.displayName })),
          selectedId: selected?.id ?? null,
          selectedName: selected?.displayName ?? null,
          fromUrl: requestedProfileId !== undefined && requestedProfileId !== sessionBot,
          returnTo: '/ai/onboarding',
        },
        head: html`<script src="/assets/admin-setup-wizard.js" defer></script>
          <script src="/assets/admin-image-upload.js" defer></script>`,
        body: html`
          <section class="setup-page">
            <header class="setup-page-header">
              <div>
                <span class="setup-eyebrow">AI Bot Setup</span>
                <h1>AI Bot Setup</h1>
                <p>
                  Create and configure transport based AI bots with a guided assistant. SimpleX is
                  available now.
                </p>
              </div>
              <button
                type="button"
                class="setup-button setup-button-primary setup-create-button"
                data-setup-open="${createDialogId}"
              >
                Create AI Bot
              </button>
            </header>

            ${
              req.query.saved
                ? html`<div class="setup-alert" data-tone="success">
                    ${savedMessage(req.query.saved)}
                  </div>`
                : null
            }
            ${
              req.query.error
                ? html`<div class="setup-alert" data-tone="danger">${req.query.error}</div>`
                : null
            }

            <div class="setup-toolbar">
              <label class="setup-search">
                <span class="setup-search-icon" aria-hidden="true">⌕</span>
                <input
                  type="search"
                  placeholder="Search AI bots"
                  aria-label="Search AI bots"
                  data-setup-search
                />
              </label>
              <div class="setup-toolbar-summary">
                <strong>${profiles.length}</strong>
                <span>${profiles.length === 1 ? 'AI Bot' : 'AI Bots'}</span>
              </div>
            </div>

            ${
              profiles.length === 0
                ? html`<section class="setup-empty">
                    <div class="setup-empty-icon" aria-hidden="true">C</div>
                    <h2>No AI bot configured</h2>
                    <p>
                      The assistant creates one connected setup without exposing internal tables.
                    </p>
                    <button
                      type="button"
                      class="setup-button setup-button-primary"
                      data-setup-open="${createDialogId}"
                    >
                      Create the first AI bot
                    </button>
                  </section>`
                : html`<div class="setup-master-detail">
                    <aside class="setup-list-panel" aria-label="Configured AI bots">
                      <div class="setup-list-heading">
                        <span>AI Bots</span>
                        <strong>${profiles.length}</strong>
                      </div>
                      <div class="setup-list" data-setup-list>
                        ${profiles.map((profile) =>
                          profileListItem(profile, profile.id === selected?.id),
                        )}
                      </div>
                      <p class="setup-list-empty" data-setup-list-empty hidden>
                        No matching AI bot.
                      </p>
                    </aside>
                    <div class="setup-detail-panel">
                      ${selected && identity
                        ? profileDetails(selected, csrf, hosted, requests, invitations, identity)
                        : null}
                    </div>
                  </div>`
            }
            ${capabilityReference()} ${wizardDialog(null, csrf, defaults(), createDialogId)}
          </section>
        `,
      });
    },
  );

  app.post('/ai/onboarding', async (req, reply) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const action = text(body['action']);
    const actor = req.session?.username ?? 'unknown';
    let profileId: number | null = null;

    try {
      switch (action) {
        case 'create-profile':
          profileId = await createBotOnboardingProfile(ctx.db, formInput(body), actor);
          break;

        case 'update-profile':
          profileId = positiveInteger(body['profileId'], 'Bot profile ID', 0);
          await updateBotOnboardingProfile(ctx.db, profileId, formInput(body), actor);
          break;

        case 'reset-workflow':
          profileId = positiveInteger(body['profileId'], 'Bot profile ID', 0);
          await resetBotOnboardingWorkflow(ctx.db, profileId, actor);
          break;

        // Its own action (CCB-S5-008), which is the correction. It used to be a field on the
        // create and edit form, so moving the primary meant re-saving every setting of an
        // unrelated dialog, and creating a bot meant answering it. Nothing is started or
        // stopped here: every enabled bot was hosted before this ran and still is.
        case 'make-primary':
          profileId = positiveInteger(body['profileId'], 'Bot profile ID', 0);
          await setPrimaryBot(ctx.db, profileId, actor);
          break;

        // The button that replaces "restart the bot" (CCB-S5-016). It applies whatever the
        // bot is CONFIGURED to wear, which for a bot with no upload is the deployment
        // default: "apply this bot's face" is one operation either way.
        case 'apply-face': {
          profileId = positiveInteger(body['profileId'], 'Bot profile ID', 0);
          const applied = await applyFaceIfRunning(ctx, profileId);
          // Pressed deliberately, so a runtime that is down is an ERROR here where it is
          // only a milder banner after an upload: the upload still stored something useful,
          // this did nothing at all.
          if (applied === 'avatar') {
            throw new Error(
              'The SimpleX runtime is not running, so nothing was applied. Start the bot ' +
                'and press this again.',
            );
          }
          return reply.redirect(
            `/ai/onboarding?saved=${applied}&profile=${encodeURIComponent(String(profileId))}`,
          );
        }

        // Step three (CCB-S4-025). Same order again: the SDK call first, the database
        // write with its result in hand. The role recorded is the one the core reports
        // for the membership, not the one the invitation offered and not the one the
        // operator expects.
        case 'join-group': {
          profileId = positiveInteger(body['profileId'], 'Bot profile ID', 0);
          const groupId = positiveInteger(body['groupId'], 'Group ID', 0);
          const joined = await joinInvitedGroup(groupId, profileId);
          await recordJoinedGroup(ctx.db, profileId, groupId, { role: joined.role }, actor);
          break;
        }

        // Step two (CCB-S4-023). Same order as step one and for the same reason: the
        // SDK call first, the database write with its result in hand. A failed accept
        // leaves the request pending and the workflow where it was, so the operator can
        // try again rather than being told it worked.
        case 'accept-contact': {
          profileId = positiveInteger(body['profileId'], 'Bot profile ID', 0);
          const contactRequestId = positiveInteger(body['contactRequestId'], 'Contact request ID', 0);
          const contact = await acceptContactRequest(contactRequestId, profileId);
          await recordAcceptedContactRequest(ctx.db, profileId, contactRequestId, contact, actor);
          break;
        }

        case 'reject-contact': {
          profileId = positiveInteger(body['profileId'], 'Bot profile ID', 0);
          const contactRequestId = positiveInteger(body['contactRequestId'], 'Contact request ID', 0);
          await rejectContactRequest(contactRequestId, profileId);
          await recordRejectedContactRequest(ctx.db, profileId, contactRequestId, actor);
          break;
        }

        // The first onboarding step that actually does something (CCB-S4-022).
        //
        // The ORDER here is the honesty rule: the SimpleX call happens first and the
        // database write happens only with its result in hand. Any failure, including
        // "the runtime is not running" and "the core returned no link", leaves the
        // workflow state exactly where it was and lands on the page as an error. There
        // is no path that stores an intention.
        case 'create-address': {
          profileId = positiveInteger(body['profileId'], 'Bot profile ID', 0);
          // THE PRIMARY GUARD IS GONE (CCB-S5-007). It existed only because the action
          // could not target a bot, so the only way to be sure the address was created on
          // the right profile was to insist the right profile was the primary. That made
          // onboarding a second bot impossible, which is the thing this briefing is for.
          // `requireReadyBot` now answers the real question: is THIS bot hosted and ready.
          const address = await createOrShowBotAddress(profileId);
          await recordContactAddress(
            ctx.db,
            profileId,
            { link: address.link, simplexUserId: address.simplexUserId },
            actor,
          );
          break;
        }

        case 'delete-profile':
          await deleteBotOnboardingProfile(
            ctx.db,
            positiveInteger(body['profileId'], 'Bot profile ID', 0),
            actor,
          );
          break;

        default:
          throw new Error('Unknown AI Bot Setup action.');
      }

      const selected = profileId ? `&profile=${encodeURIComponent(String(profileId))}` : '';
      return reply.redirect(`/ai/onboarding?saved=${encodeURIComponent(action)}${selected}`);
    } catch (error) {
      return reply.redirect(`/ai/onboarding?error=${encodeURIComponent(errorMessage(error))}`);
    }
  });

  /* ── The bot avatar (CCB-S5-007, D-161) ──────────────────────────────────────
   *
   * THREE ROUTES OF ITS OWN, and not three more cases on the action switch above. The
   * upload needs a body limit large enough for an 8 MB file base64'd, and that limit has to
   * be on this route and no other: the recital's upload made the same call for the same
   * reason, and a console-wide limit this size is a gift to anybody who finds an
   * unauthenticated POST. The action switch handles small forms and stays small.
   *
   * The bytes arrive base64'd in an ordinary field rather than as multipart, and are stored
   * by `storeChapterImage`, which decodes, re-encodes through sharp and names the file from
   * its content hash. That is the part that makes an operator upload safe, it already exists,
   * and it is reused whole rather than copied: only the filename prefix differs.
   */

  app.post<{ Params: { id: string }; Body: Record<string, unknown> }>(
    '/ai/onboarding/:id/avatar',
    {
      // Base64 inflates by a third, so the body has to hold more than the file limit.
      bodyLimit: Math.ceil(ASSET_MAX_BYTES * 1.4) + 4096,
    },
    async (req, reply) => {
      const actor = req.session?.username ?? 'unknown';
      const back = (query: string): string =>
        `/ai/onboarding?${query}&profile=${encodeURIComponent(req.params.id)}`;
      try {
        const profileId = positiveInteger(req.params.id, 'Bot profile ID', 0);
        const encoded = text((req.body as Record<string, unknown> | null)?.['imageData']);
        if (!encoded) {
          return reply.redirect(
            back('error=' + encodeURIComponent('No file arrived. Choose one and try again.')),
          );
        }
        // 'bot-avatar' rather than 'chapter', so the asset root says what each file is for
        // and clearing one kind can never sweep up the other.
        const stored = await storeChapterImage(
          ctx.cfg.assetRoot,
          Buffer.from(encoded, 'base64'),
          'bot-avatar',
        );
        await setBotAvatarPath(ctx.db, profileId, stored.relativePath, actor);
        // ── APPLIED LIVE, AND THE ROW IS WRITTEN EITHER WAY (CCB-S5-016) ──
        //
        // The order matters and is the opposite of the create-address rule. There the SDK
        // call comes first because the workflow state must not advance on an intention;
        // here the ROW is the operator's decision about what this bot wears, and it is
        // correct whether or not the runtime happens to be up. So it is stored first, then
        // applied, and a runtime that is down costs the live apply rather than the upload.
        const applied = await applyFaceIfRunning(ctx, profileId);
        return reply.redirect(back(`saved=${applied}`));
      } catch (err) {
        // An AssetError is the operator's problem to see and fix (not an image, too big);
        // anything else is ours, and is logged as well as shown.
        if (!(err instanceof AssetError)) {
          log.error(`Bot avatar upload failed: ${errorMessage(err)}`);
        }
        return reply.redirect(back('error=' + encodeURIComponent(errorMessage(err))));
      }
    },
  );

  app.post<{ Params: { id: string } }>('/ai/onboarding/:id/avatar/clear', async (req, reply) => {
    const actor = req.session?.username ?? 'unknown';
    const back = (query: string): string =>
      `/ai/onboarding?${query}&profile=${encodeURIComponent(req.params.id)}`;
    try {
      // The row is cleared; the file is left on disk, exactly as the recital's clear does it.
      // Deleting it would be the one destructive operation on this page, and an operator who
      // clears a face by accident would rather re-upload it than go and find it again.
      await setBotAvatarPath(
        ctx.db,
        positiveInteger(req.params.id, 'Bot profile ID', 0),
        null,
        actor,
      );
      // Applied live as well, so clearing is not a half-measure either: the bot goes back
      // to the deployment default in front of members rather than at some future restart.
      const applied = await applyFaceIfRunning(ctx, positiveInteger(req.params.id, 'Bot profile ID', 0));
      return reply.redirect(back(applied === 'avatar' ? 'saved=avatar-cleared' : `saved=${applied}`));
    } catch (err) {
      return reply.redirect(back('error=' + encodeURIComponent(errorMessage(err))));
    }
  });

  /** Serves a bot's avatar to the console, by BOT id and never by path. */
  app.get<{ Params: { id: string } }>('/ai/onboarding/:id/avatar', async (req, reply) => {
    const profileId = optionalPositiveInteger(req.params.id);
    const profile = (await listBotOnboardingProfiles(ctx.db)).find((p) => p.id === profileId);
    if (!profile?.avatarPath) return reply.code(404).send('No avatar for that bot.');
    try {
      // Addressed by bot id, resolved through the guard, and never taken from a query
      // parameter: the same rule the media console follows (CCB-S3-013 §4).
      return await reply
        .type('image/jpeg')
        .send(
          (await import('node:fs')).createReadStream(
            resolveAssetPath(ctx.cfg.assetRoot, profile.avatarPath),
          ),
        );
    } catch (err) {
      // Configured and unreadable is a fault, not an absence (CCB-S3-023). The boot path
      // raises this to the dashboard; here it is enough that the console says so rather than
      // rendering a broken image and leaving the operator to guess.
      log.warn(`Bot avatar ${profile.avatarPath} could not be served: ${errorMessage(err)}`);
      return reply.code(404).send('That image could not be read.');
    }
  });
}
