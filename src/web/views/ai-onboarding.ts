/**
 * Guided AI Bot Setup and persistent SimpleX bot settings.
 *
 * This surface stores desired settings only. No SDK action is executed here.
 */

import type { FastifyInstance } from 'fastify';
import {
  createBotOnboardingProfile,
  deleteBotOnboardingProfile,
  listBotOnboardingProfiles,
  resetBotOnboardingWorkflow,
  updateBotOnboardingProfile,
  type BotOnboardingInput,
  type BotOnboardingProfile,
  type CommandRegistryMode,
  type GroupInvitationMode,
  type PolicyActivationMode,
  type SdkGroupRole,
} from '../../profiles/bot-onboarding.js';
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

function defaults(): BotOnboardingInput {
  return {
    slug: '',
    displayName: '',
    enabled: true,
    selectedForRuntime: true,
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
  };
}

function formInput(body: Record<string, unknown>): BotOnboardingInput {
  return {
    slug: text(body['slug']),
    displayName: text(body['displayName']),
    enabled: checked(body['enabled']),
    selectedForRuntime: checked(body['selectedForRuntime']),
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
          'The settings are stored. The next runtime phase will create and display the contact link.',
      };
    case 'waiting_contact_request':
      return {
        title: 'Send a contact request',
        description: 'Use the future contact link from your personal SimpleX profile.',
      };
    case 'contact_request_pending':
      return {
        title: 'Review the contact request',
        description: profile.autoAcceptContacts
          ? 'Automatic acceptance is configured, but runtime event wiring is not active yet.'
          : 'Accept or reject the request in the future review queue.',
      };
    case 'contact_connected':
      return {
        title: 'Invite the bot into a group',
        description: 'The group owner sends the invitation from the personal SimpleX profile.',
      };
    case 'waiting_group_invitation':
      return {
        title: 'Send the group invitation',
        description: 'The AI bot is connected as a contact and can now be invited manually.',
      };
    case 'group_invitation_pending':
      return {
        title: 'Review the group invitation',
        description: 'Manual invitation handling is currently configured.',
      };
    case 'joined':
      return {
        title: `Grant the ${profile.expectedGroupRole} role`,
        description:
          'The detected SimpleX role must be verified before Access Control is activated.',
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
  input: BotOnboardingInput,
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
              />
              <small>This name is shown to members in SimpleX.</small>
            </label>
            <label class="setup-field">
              <span>Internal key</span>
              <input
                name="slug"
                value="${input.slug}"
                required
                minlength="2"
                maxlength="63"
                pattern="[a-z0-9][a-z0-9-]{1,62}"
                autocomplete="off"
                data-review-source="slug"
              />
              <small
                >Technical identifier used to link this bot profile to saved settings and audit
                records.</small
              >
            </label>
          </div>
          <div class="setup-toggle-grid">
            ${toggle('enabled', 'Enabled', 'Allows this setup to be used later.', input.enabled)}
            ${toggle(
              'selectedForRuntime',
              'Primary runtime bot',
              'Select this bot as the desired runtime profile.',
              input.selectedForRuntime,
            )}
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
      data-tone="${issue ? 'warning' : profile.enabled ? 'ready' : 'muted'}"
    >
      ${issue ? 'Review' : profile.enabled ? 'Stored' : 'Paused'}
    </span>
  </a>`;
}

function profileDetails(profile: BotOnboardingProfile, csrf: string): SafeHtml {
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

      ${journey(profile)}

      <div class="setup-status-grid">
        ${stat('Stored state', profile.workflowState)}
        ${stat('Expected role', profile.expectedGroupRole)}
        ${stat('Contacts', profile.autoAcceptContacts ? 'Automatic' : 'Manual')}
        ${stat('Invitations', profile.groupInvitationMode)}
      </div>

      <section class="setup-next-action">
        <div class="setup-next-action-icon" aria-hidden="true">1</div>
        <div>
          <span>Next action</span>
          <h3>${action.title}</h3>
          <p>${action.description}</p>
        </div>
      </section>

      <div class="setup-chip-row">
        ${badge(profile.enabled ? 'enabled' : 'paused', profile.enabled ? 'green' : 'amber')}
        ${badge(profile.selectedForRuntime ? 'primary runtime' : 'not primary', 'blue')}
        ${badge('settings stored', 'green')} ${badge('runtime not applied', 'amber')}
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
          ${badge('No SDK actions in this phase', 'amber')}
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
      const requestedProfileId = optionalPositiveInteger(req.query.profile);
      const selected =
        profiles.find((profile) => profile.id === requestedProfileId) ?? profiles[0] ?? null;
      const createDialogId = 'setup-create';

      reply.type('text/html');

      return page({
        title: 'AI Bot Setup',
        active: 'ai:onboarding',
        csrfToken: csrf,
        head: html`<script src="/assets/admin-setup-wizard.js" defer></script>`,
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
                    AI bot configuration saved.
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
                      ${selected ? profileDetails(selected, csrf) : null}
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
}
