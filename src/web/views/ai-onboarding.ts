/**
 * Persistent SimpleX bot onboarding settings and capability inventory.
 *
 * This phase stores desired settings only. No SDK action is executed here.
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
import { badge, card, fmtDate, pageHeader, stat } from './ui.js';

const SDK_ROLES: Array<{
  value: SdkGroupRole;
  label: string;
  description: string;
  operational: boolean;
}> = [
  {
    value: 'relay',
    label: 'Relay',
    description: 'SDK role exposed. Cinderella behavior is not validated yet.',
    operational: false,
  },
  {
    value: 'observer',
    label: 'Observer',
    description: 'Read-focused role with limited participation.',
    operational: true,
  },
  {
    value: 'author',
    label: 'Author',
    description: 'SDK role exposed. Cinderella behavior is not validated yet.',
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
    description: 'Moderate messages and block members where the SDK permits it.',
    operational: true,
  },
  {
    value: 'admin',
    label: 'Admin',
    description: 'Invite, accept, remove, and change member roles. Default for testing.',
    operational: true,
  },
  {
    value: 'owner',
    label: 'Owner',
    description: 'Highest group role. Not required for the initial Cinderella workflow.',
    operational: true,
  },
];

const WORKFLOW_STEPS = [
  ['configured', 'Bot profile configured'],
  ['waiting_contact_request', 'Waiting for contact request'],
  ['contact_request_pending', 'Contact request pending'],
  ['contact_connected', 'Contact connected'],
  ['waiting_group_invitation', 'Waiting for group invitation'],
  ['group_invitation_pending', 'Group invitation pending'],
  ['joined', 'Joined group'],
  ['waiting_expected_role', 'Waiting for expected role'],
  ['role_verified', 'Role verified'],
  ['ready', 'Policy ready'],
] as const;

const CAPABILITIES = [
  ['BotOptions.createAddress', 'Stored', 'SDK runtime wiring planned'],
  ['BotOptions.updateAddress', 'Stored', 'SDK runtime wiring planned'],
  ['BotOptions.updateProfile', 'Stored', 'SDK runtime wiring planned'],
  ['BotAddressSettings.autoAccept', 'Stored', 'Automatic is the default'],
  ['BotAddressSettings.welcomeMessage', 'Stored', 'SDK runtime wiring planned'],
  ['BotAddressSettings.businessAddress', 'Stored', 'Disabled by default'],
  ['BotOptions.allowFiles', 'Stored', 'Enabled by default'],
  ['BotOptions.commands', 'Stored', 'Default and custom registries supported'],
  ['BotOptions.useBotProfile', 'Stored', 'Enabled by default'],
  ['BotOptions.logContacts', 'Stored', 'Enabled by default'],
  ['BotOptions.logNetwork', 'Stored', 'Disabled by default'],
  ['receivedContactRequest', 'Available in SDK', 'Event wiring planned'],
  ['apiAcceptContactRequest', 'Available in SDK', 'Action wiring planned'],
  ['apiRejectContactRequest', 'Available in SDK', 'Action wiring planned'],
  ['contactConnected', 'Available in SDK', 'Event wiring planned'],
  ['receivedGroupInvitation', 'Available in SDK', 'Event wiring planned'],
  ['apiJoinGroup', 'Available in SDK', 'Action wiring planned'],
  ['apiListGroups', 'Available in SDK', 'Discovery wiring planned'],
  ['apiListMembers', 'Available in SDK', 'Role verification wiring planned'],
  ['memberRole', 'Available in SDK', 'Role event wiring planned'],
  ['apiSetMembersRole', 'Available in SDK', 'Optional admin action, disabled initially'],
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

function parseCommands(value: unknown): unknown[] {
  const source = text(value).trim();
  if (!source) return [];

  const parsed = JSON.parse(source) as unknown;
  if (!Array.isArray(parsed)) throw new Error('Custom commands must be a JSON array.');

  return parsed;
}

function selectOption(
  value: string,
  label: string,
  current: string,
  description?: string,
): SafeHtml {
  return html`<option value="${value}" ${value === current ? raw('selected') : ''}>
    ${label}${description ? ` | ${description}` : ''}
  </option>`;
}

function toggle(name: string, label: string, description: string, enabled: boolean): SafeHtml {
  return html`<label class="flex gap-3 rounded-lg border border-slate-200 bg-white p-3">
    <input
      type="checkbox"
      name="${name}"
      value="true"
      ${enabled ? raw('checked') : ''}
      class="mt-1 h-4 w-4 rounded border-slate-300"
    />
    <span>
      <span class="block text-sm font-medium text-slate-900">${label}</span>
      <span class="mt-1 block text-xs leading-5 text-slate-500">${description}</span>
    </span>
  </label>`;
}

function defaults(): BotOnboardingInput {
  return {
    slug: 'cinderella',
    displayName: 'Cinderella',
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

function workflow(profile: BotOnboardingProfile): SafeHtml {
  return card(
    'Guided onboarding workflow',
    html`
      <div class="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
        ${WORKFLOW_STEPS.map(([state, label], index) => {
          const currentIndex = WORKFLOW_STEPS.findIndex(
            ([candidate]) => candidate === profile.workflowState,
          );
          const tone = index < currentIndex ? 'green' : index === currentIndex ? 'blue' : 'slate';

          return html`<div class="rounded-lg border border-slate-200 bg-white p-3">
            <div class="mb-2">${badge(`Step ${index + 1}`, tone)}</div>
            <div class="text-sm font-medium text-slate-900">${label}</div>
            <div class="mt-1 text-xs text-slate-500">${state}</div>
          </div>`;
        })}
      </div>
      <p class="mt-4 text-sm text-slate-600">
        This phase stores the workflow state only. It does not create a SimpleX address, accept a
        request, join a group, change a group role, or activate a policy.
      </p>
    `,
  );
}

function settingsForm(
  profile: BotOnboardingProfile | null,
  csrf: string,
  input: BotOnboardingInput,
): SafeHtml {
  const action = profile ? 'update-profile' : 'create-profile';
  const title = profile
    ? `Bot profile settings: ${profile.displayName}`
    : 'Create bot onboarding profile';

  return card(
    title,
    html`
      <form method="post" action="/ai/onboarding" class="space-y-6">
        <input type="hidden" name="_csrf" value="${csrf}" />
        <input type="hidden" name="action" value="${action}" />
        ${profile ? html`<input type="hidden" name="profileId" value="${profile.id}" />` : null}

        <div>
          <h3 class="mb-3 text-sm font-semibold text-slate-900">Identity and selection</h3>
          <div class="grid gap-3 lg:grid-cols-4">
            <label class="text-sm">
              <span class="font-medium text-slate-700">Display name</span>
              <input
                name="displayName"
                value="${input.displayName}"
                required
                maxlength="80"
                class="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
              />
            </label>
            <label class="text-sm">
              <span class="font-medium text-slate-700">Profile slug</span>
              <input
                name="slug"
                value="${input.slug}"
                required
                minlength="2"
                maxlength="63"
                pattern="[a-z0-9][a-z0-9-]{1,62}"
                class="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 font-mono"
              />
            </label>
            ${toggle('enabled', 'Profile enabled', 'Allows this stored profile to be used later.', input.enabled)}
            ${toggle(
              'selectedForRuntime',
              'Selected for runtime',
              'Desired runtime profile. Runtime application is not wired in this phase.',
              input.selectedForRuntime,
            )}
          </div>
        </div>

        <div>
          <h3 class="mb-3 text-sm font-semibold text-slate-900">Complete SDK BotOptions grid</h3>
          <div class="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            ${toggle(
              'createAddress',
              'Create contact address',
              'Maps to BotOptions.createAddress.',
              input.createAddress,
            )}
            ${toggle(
              'updateAddress',
              'Keep contact address updated',
              'Maps to BotOptions.updateAddress.',
              input.updateAddress,
            )}
            ${toggle(
              'updateProfile',
              'Update bot profile',
              'Maps to BotOptions.updateProfile.',
              input.updateProfile,
            )}
            ${toggle(
              'allowFiles',
              'Allow files',
              'Maps to BotOptions.allowFiles.',
              input.allowFiles,
            )}
            ${toggle(
              'useBotProfile',
              'Use bot profile',
              'Maps to BotOptions.useBotProfile.',
              input.useBotProfile,
            )}
            ${toggle(
              'logContacts',
              'Log contacts',
              'Maps to BotOptions.logContacts. Message content is not added by this option.',
              input.logContacts,
            )}
            ${toggle(
              'logNetwork',
              'Log network',
              'Maps to BotOptions.logNetwork. Disabled by default for privacy.',
              input.logNetwork,
            )}
          </div>
        </div>

        <div>
          <h3 class="mb-3 text-sm font-semibold text-slate-900">Address settings</h3>
          <div class="grid gap-3 md:grid-cols-2">
            ${toggle(
              'autoAcceptContacts',
              'Accept contact requests automatically',
              'Default on. Manual mode becomes active when this option is off.',
              input.autoAcceptContacts,
            )}
            ${toggle(
              'businessAddress',
              'Business contact address',
              'Maps to BotAddressSettings.businessAddress.',
              input.businessAddress,
            )}
          </div>
          <label class="mt-3 block text-sm">
            <span class="font-medium text-slate-700">Welcome message</span>
            <textarea
              name="welcomeMessage"
              rows="4"
              maxlength="4000"
              class="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
              placeholder="Optional message shown before the connection is completed."
            >
${input.welcomeMessage}</textarea>
          </label>
        </div>

        <div>
          <h3 class="mb-3 text-sm font-semibold text-slate-900">Command registry</h3>
          <div class="grid gap-3 lg:grid-cols-2">
            <label class="text-sm">
              <span class="font-medium text-slate-700">BotOptions.commands mode</span>
              <select
                name="commandRegistryMode"
                class="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
              >
                ${selectOption('disabled', 'Disabled', input.commandRegistryMode)}
                ${selectOption(
                  'cinderella_defaults',
                  'Cinderella defaults',
                  input.commandRegistryMode,
                )}
                ${selectOption('custom', 'Custom JSON registry', input.commandRegistryMode)}
              </select>
            </label>
            <label class="text-sm">
              <span class="font-medium text-slate-700">Custom commands JSON array</span>
              <textarea
                name="customCommands"
                rows="5"
                class="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 font-mono text-xs"
              >
${JSON.stringify(input.customCommands, null, 2)}</textarea>
            </label>
          </div>
        </div>

        <div>
          <h3 class="mb-3 text-sm font-semibold text-slate-900">
            Group invitation and role policy
          </h3>
          <div class="grid gap-3 lg:grid-cols-3">
            <label class="text-sm">
              <span class="font-medium text-slate-700">Group invitation handling</span>
              <select
                name="groupInvitationMode"
                class="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
              >
                ${selectOption('manual', 'Manual', input.groupInvitationMode)}
                ${selectOption('automatic', 'Automatic', input.groupInvitationMode)}
                ${selectOption(
                  'approved_contacts',
                  'Automatic for approved contacts',
                  input.groupInvitationMode,
                )}
                ${selectOption(
                  'approved_groups',
                  'Automatic for approved groups',
                  input.groupInvitationMode,
                )}
              </select>
            </label>
            <label class="text-sm">
              <span class="font-medium text-slate-700">Expected SimpleX group role</span>
              <select
                name="expectedGroupRole"
                class="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
              >
                ${SDK_ROLES.map((role) =>
                  selectOption(
                    role.value,
                    role.label,
                    input.expectedGroupRole,
                    role.operational ? undefined : 'advanced, not validated',
                  ),
                )}
              </select>
            </label>
            <label class="text-sm">
              <span class="font-medium text-slate-700">Policy activation</span>
              <select
                name="policyActivationMode"
                class="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
              >
                ${selectOption('manual', 'Manual confirmation', input.policyActivationMode)}
                ${selectOption(
                  'automatic_after_verification',
                  'Automatic after role verification',
                  input.policyActivationMode,
                )}
              </select>
            </label>
          </div>
          <div class="mt-3 grid gap-3 md:grid-cols-2">
            ${toggle(
              'roleVerificationRequired',
              'Require role verification',
              'Policy readiness waits until the detected role matches the expected role.',
              input.roleVerificationRequired,
            )}
            ${toggle(
              'remoteCommandsEnabled',
              'Remote commands enabled',
              'Stored safety switch. Runtime command execution remains unavailable in this phase.',
              input.remoteCommandsEnabled,
            )}
            ${toggle(
              'persistentChangesEnabled',
              'Persistent remote changes enabled',
              'Stored safety switch. Permanent remote changes remain unavailable in this phase.',
              input.persistentChangesEnabled,
            )}
          </div>
        </div>

        <div>
          <h3 class="mb-3 text-sm font-semibold text-slate-900">Retention and queue limits</h3>
          <div class="grid gap-3 lg:grid-cols-3">
            <label class="text-sm">
              <span class="font-medium text-slate-700">Contact request retention in hours</span>
              <input
                name="contactRequestRetentionHours"
                type="number"
                min="1"
                max="8760"
                value="${input.contactRequestRetentionHours}"
                class="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
              />
            </label>
            <label class="text-sm">
              <span class="font-medium text-slate-700">Group invitation retention in hours</span>
              <input
                name="groupInvitationRetentionHours"
                type="number"
                min="1"
                max="8760"
                value="${input.groupInvitationRetentionHours}"
                class="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
              />
            </label>
            <label class="text-sm">
              <span class="font-medium text-slate-700">Maximum pending contact requests</span>
              <input
                name="maxPendingContactRequests"
                type="number"
                min="1"
                max="10000"
                value="${input.maxPendingContactRequests}"
                class="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
              />
            </label>
          </div>
          <p class="mt-2 text-xs text-slate-500">
            These controls are persisted now. Enforcement is added with the event workflow.
          </p>
        </div>

        <button
          type="submit"
          class="rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700"
        >
          ${profile ? 'Save bot profile settings' : 'Create bot onboarding profile'}
        </button>
      </form>
    `,
  );
}

function profileSummary(profile: BotOnboardingProfile, csrf: string): SafeHtml {
  return html`
    <div class="grid gap-3 sm:grid-cols-2 xl:grid-cols-6">
      ${stat('Workflow', profile.workflowState)} ${stat('Expected role', profile.expectedGroupRole)}
      ${stat('Contact acceptance', profile.autoAcceptContacts ? 'Automatic' : 'Manual')}
      ${stat('Group invitations', profile.groupInvitationMode)} ${stat('SDK', profile.sdkVersion)}
      ${stat('Types', profile.sdkTypesVersion)}
    </div>
    <div class="mt-4 flex flex-wrap gap-2">
      ${badge(profile.enabled ? 'profile enabled' : 'profile disabled', profile.enabled ? 'green' : 'amber')}
      ${badge(
        profile.selectedForRuntime ? 'selected for runtime' : 'not selected',
        profile.selectedForRuntime ? 'blue' : 'slate',
      )}
      ${badge('settings stored', 'green')} ${badge('runtime not applied', 'amber')}
      ${badge(
        profile.remoteCommandsEnabled ? 'remote commands requested' : 'remote commands blocked',
        profile.remoteCommandsEnabled ? 'amber' : 'slate',
      )}
      ${badge(
        profile.persistentChangesEnabled
          ? 'persistent changes requested'
          : 'persistent changes blocked',
        profile.persistentChangesEnabled ? 'amber' : 'slate',
      )}
    </div>
    <p class="mt-3 text-xs text-slate-500">
      Created ${fmtDate(profile.createdAt)}. Updated ${fmtDate(profile.updatedAt)}.
    </p>
    <div class="mt-4 flex flex-wrap gap-2">
      <form method="post" action="/ai/onboarding">
        <input type="hidden" name="_csrf" value="${csrf}" />
        <input type="hidden" name="action" value="reset-workflow" />
        <input type="hidden" name="profileId" value="${profile.id}" />
        <button
          type="submit"
          class="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
        >
          Reset workflow state
        </button>
      </form>
      <form method="post" action="/ai/onboarding">
        <input type="hidden" name="_csrf" value="${csrf}" />
        <input type="hidden" name="action" value="delete-profile" />
        <input type="hidden" name="profileId" value="${profile.id}" />
        <button
          type="submit"
          class="rounded-lg border border-red-300 bg-white px-3 py-2 text-sm font-medium text-red-700 hover:bg-red-50"
        >
          Delete stored bot profile
        </button>
      </form>
    </div>
  `;
}

function roleCatalog(): SafeHtml {
  return card(
    'Complete SDK group role catalog',
    html`<div class="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
      ${SDK_ROLES.map(
        (role) =>
          html`<div class="rounded-lg border border-slate-200 bg-white p-3">
            <div class="flex items-center gap-2">
              <span class="font-medium text-slate-900">${role.label}</span>
              ${badge(role.operational ? 'selectable' : 'advanced', role.operational ? 'green' : 'amber')}
            </div>
            <p class="mt-2 text-xs leading-5 text-slate-500">${role.description}</p>
            <p class="mt-2 font-mono text-xs text-slate-600">${role.value}</p>
          </div>`,
      )}
    </div>`,
  );
}

function capabilityGrid(): SafeHtml {
  return card(
    'SDK capability inventory',
    html`<div class="overflow-x-auto">
      <table class="min-w-full text-left text-sm">
        <thead class="border-b border-slate-200 text-xs uppercase tracking-wide text-slate-500">
          <tr>
            <th class="px-3 py-2 font-medium">Capability</th>
            <th class="px-3 py-2 font-medium">Availability</th>
            <th class="px-3 py-2 font-medium">Cinderella state</th>
          </tr>
        </thead>
        <tbody class="divide-y divide-slate-100">
          ${CAPABILITIES.map(
            ([name, availability, state]) =>
              html`<tr>
                <td class="px-3 py-3 font-mono text-xs text-slate-900">${name}</td>
                <td class="px-3 py-3">${badge(availability, 'green')}</td>
                <td class="px-3 py-3 text-slate-600">${state}</td>
              </tr>`,
          )}
        </tbody>
      </table>
    </div>`,
  );
}

export function registerAiOnboarding(app: FastifyInstance, ctx: ViewContext): void {
  app.get<{ Querystring: { saved?: string; error?: string } }>(
    '/ai/onboarding',
    async (req, reply) => {
      const profiles = await listBotOnboardingProfiles(ctx.db);
      const csrf = req.session?.csrfToken ?? '';

      reply.type('text/html');

      return page({
        title: 'Bot Onboarding',
        active: 'ai:onboarding',
        csrfToken: csrf,
        body: html`
          ${pageHeader(
            'Bot Onboarding',
            'Store every supported SimpleX bot option, security gate, role target, and guided workflow state before live SDK actions are enabled.',
          )}
          ${
            req.query.saved
              ? html`<div
                  class="mb-4 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800"
                >
                  Bot onboarding configuration saved.
                </div>`
              : null
          }
          ${
            req.query.error
              ? html`<div
                  class="mb-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700"
                >
                  ${req.query.error}
                </div>`
              : null
          }

          <div class="mb-4 flex flex-wrap gap-2">
            ${badge('SimpleX SDK 6.5.4', 'green')} ${badge('Types 0.8.0', 'green')}
            ${badge('Automatic contacts by default', 'blue')}
            ${badge('Manual group invitations by default', 'blue')}
            ${badge('Expected role Admin', 'blue')}
            ${badge('No SDK actions in this phase', 'amber')}
          </div>

          ${
            profiles.length === 0
              ? settingsForm(null, csrf, defaults())
              : html`<div class="space-y-4">
                  ${profiles.map(
                    (profile) => html`
                      ${card(profile.displayName, profileSummary(profile, csrf))}
                      ${workflow(profile)} ${settingsForm(profile, csrf, profile)}
                    `,
                  )}
                  ${settingsForm(null, csrf, {
                    ...defaults(),
                    selectedForRuntime: false,
                    slug: 'cinderella-lab',
                    displayName: 'Cinderella Lab',
                  })}
                </div>`
          }

          <div class="mt-4">${roleCatalog()}</div>
          <div class="mt-4">${capabilityGrid()}</div>
        `,
      });
    },
  );

  app.post('/ai/onboarding', async (req, reply) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const action = text(body['action']);
    const actor = req.session?.username ?? 'unknown';

    try {
      switch (action) {
        case 'create-profile':
          await createBotOnboardingProfile(ctx.db, formInput(body), actor);
          break;

        case 'update-profile':
          await updateBotOnboardingProfile(
            ctx.db,
            positiveInteger(body['profileId'], 'Bot profile ID', 0),
            formInput(body),
            actor,
          );
          break;

        case 'reset-workflow':
          await resetBotOnboardingWorkflow(
            ctx.db,
            positiveInteger(body['profileId'], 'Bot profile ID', 0),
            actor,
          );
          break;

        case 'delete-profile':
          await deleteBotOnboardingProfile(
            ctx.db,
            positiveInteger(body['profileId'], 'Bot profile ID', 0),
            actor,
          );
          break;

        default:
          throw new Error('Unknown bot onboarding action.');
      }

      return reply.redirect(`/ai/onboarding?saved=${encodeURIComponent(action)}`);
    } catch (error) {
      return reply.redirect(`/ai/onboarding?error=${encodeURIComponent(errorMessage(error))}`);
    }
  });
}
