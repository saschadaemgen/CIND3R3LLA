/**
 * Cinderella profile, group, and technical identity administration.
 *
 * This is the persistent policy foundation. It does not join SimpleX groups,
 * accept invitation links, or activate remote command execution.
 */

import type { FastifyInstance } from 'fastify';
import {
  addCinderellaGroup,
  createCinderellaProfile,
  listCinderellaProfiles,
  setCinderellaGroupEnabled,
  setCinderellaProfileEnabled,
  upsertCinderellaGroupAuthority,
  upsertCinderellaProfileAuthority,
  type CinderellaGroup,
  type CinderellaGroupRole,
  type CinderellaProfile,
  type CinderellaProfileRole,
} from '../../profiles/service.js';
import { html, page, raw, type SafeHtml } from '../html.js';
import type { ViewContext } from '../server.js';
import { badge, card, pageHeader, stat } from './ui.js';

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function positiveId(value: unknown, label: string): number {
  const parsed = typeof value === 'string' ? Number.parseInt(value, 10) : Number.NaN;

  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new Error(`${label} must be a positive integer.`);
  }

  return parsed;
}

function text(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function checked(value: unknown): boolean {
  return value === 'true' || value === '1' || value === 'on';
}

function fingerprint(value: string | number): string {
  const source = String(value);

  if (source.length <= 12) return source;
  return `${source.slice(0, 7)}...${source.slice(-4)}`;
}

function profileRoleOptions(current = ''): SafeHtml {
  const roles: CinderellaProfileRole[] = ['owner', 'administrator', 'auditor'];

  return html`${roles.map(
    (role) =>
      html`<option value="${role}" ${role === current ? raw('selected') : ''}>${role}</option>`,
  )}`;
}

function groupRoleOptions(current = ''): SafeHtml {
  const roles: CinderellaGroupRole[] = [
    'owner',
    'administrator',
    'moderator',
    'team_member',
    'member',
    'auditor',
    'blocked',
  ];

  return html`${roles.map(
    (role) =>
      html`<option value="${role}" ${role === current ? raw('selected') : ''}>${role}</option>`,
  )}`;
}

function authoritiesTable(profile: CinderellaProfile): SafeHtml {
  if (profile.authorities.length === 0) {
    return html`<p class="text-sm text-slate-500">No profile authorities assigned yet.</p>`;
  }

  return html`<div class="overflow-x-auto">
    <table class="min-w-full text-left text-sm">
      <thead class="border-b border-slate-200 text-xs uppercase tracking-wide text-slate-500">
        <tr>
          <th class="px-3 py-2 font-medium">Label</th>
          <th class="px-3 py-2 font-medium">Identity</th>
          <th class="px-3 py-2 font-medium">Role</th>
          <th class="px-3 py-2 font-medium">State</th>
        </tr>
      </thead>
      <tbody class="divide-y divide-slate-100">
        ${profile.authorities.map(
          (authority) =>
            html`<tr>
              <td class="px-3 py-3 font-medium text-slate-900">${authority.displayLabel}</td>
              <td class="px-3 py-3 text-slate-600">
                ${authority.identityType}:${fingerprint(authority.simplexId)}
              </td>
              <td class="px-3 py-3">${badge(authority.role, 'blue')}</td>
              <td class="px-3 py-3">
                ${badge(authority.enabled ? 'enabled' : 'disabled', authority.enabled ? 'green' : 'slate')}
              </td>
            </tr>`,
        )}
      </tbody>
    </table>
  </div>`;
}

function groupAuthoritiesTable(group: CinderellaGroup): SafeHtml {
  if (group.authorities.length === 0) {
    return html`<p class="text-sm text-slate-500">No group roles assigned yet.</p>`;
  }

  return html`<div class="overflow-x-auto">
    <table class="min-w-full text-left text-sm">
      <thead class="border-b border-slate-200 text-xs uppercase tracking-wide text-slate-500">
        <tr>
          <th class="px-3 py-2 font-medium">Label</th>
          <th class="px-3 py-2 font-medium">Member fingerprint</th>
          <th class="px-3 py-2 font-medium">Role</th>
          <th class="px-3 py-2 font-medium">State</th>
        </tr>
      </thead>
      <tbody class="divide-y divide-slate-100">
        ${group.authorities.map(
          (authority) =>
            html`<tr>
              <td class="px-3 py-3 font-medium text-slate-900">${authority.displayLabel}</td>
              <td class="px-3 py-3 text-slate-600">${fingerprint(authority.simplexMemberId)}</td>
              <td class="px-3 py-3">
                ${badge(authority.role, authority.role === 'blocked' ? 'red' : 'blue')}
              </td>
              <td class="px-3 py-3">
                ${badge(authority.enabled ? 'enabled' : 'disabled', authority.enabled ? 'green' : 'slate')}
              </td>
            </tr>`,
        )}
      </tbody>
    </table>
  </div>`;
}

function groupCard(group: CinderellaGroup, csrf: string): SafeHtml {
  return card(
    group.localDisplayName,
    html`
      <div class="mb-4 flex flex-wrap gap-2">
        ${badge(group.kind, group.kind === 'team' ? 'blue' : 'slate')}
        ${badge(`SimpleX group ${fingerprint(group.simplexGroupId)}`, 'slate')}
        ${badge(group.enabled ? 'enabled' : 'paused', group.enabled ? 'green' : 'amber')}
        ${badge(group.inheritProfile ? 'inherits profile' : 'custom policy', 'slate')}
      </div>

      ${groupAuthoritiesTable(group)}

      <form method="post" action="/ai/profiles" class="mt-4 grid gap-3 lg:grid-cols-4">
        <input type="hidden" name="_csrf" value="${csrf}" />
        <input type="hidden" name="action" value="set-group-authority" />
        <input type="hidden" name="groupId" value="${group.id}" />
        <label class="text-sm">
          <span class="font-medium text-slate-700">Display label</span>
          <input
            name="displayLabel"
            required
            maxlength="120"
            class="mt-1 w-full rounded-lg border border-slate-300 px-2 py-2"
          />
        </label>
        <label class="text-sm">
          <span class="font-medium text-slate-700">SimpleX member ID</span>
          <input
            name="simplexMemberId"
            required
            maxlength="240"
            class="mt-1 w-full rounded-lg border border-slate-300 px-2 py-2 font-mono"
          />
        </label>
        <label class="text-sm">
          <span class="font-medium text-slate-700">Group role</span>
          <select name="role" class="mt-1 w-full rounded-lg border border-slate-300 px-2 py-2">
            ${groupRoleOptions()}
          </select>
        </label>
        <button
          type="submit"
          class="self-end rounded-lg bg-slate-900 px-3 py-2 text-sm font-medium text-white hover:bg-slate-700"
        >
          Assign group role
        </button>
      </form>

      <form method="post" action="/ai/profiles" class="mt-3">
        <input type="hidden" name="_csrf" value="${csrf}" />
        <input type="hidden" name="action" value="toggle-group" />
        <input type="hidden" name="groupId" value="${group.id}" />
        <input type="hidden" name="enabled" value="${group.enabled ? 'false' : 'true'}" />
        <button
          type="submit"
          class="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
        >
          ${group.enabled ? 'Pause group policy' : 'Enable group policy'}
        </button>
      </form>
    `,
  );
}

function profileCard(profile: CinderellaProfile, csrf: string): SafeHtml {
  const teamGroup = profile.groups.find((group) => group.kind === 'team');

  return card(
    profile.displayName,
    html`
      <div class="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
        ${stat('Profile slug', profile.slug)} ${stat('Groups', profile.groups.length)}
        ${stat('Team group', teamGroup?.localDisplayName ?? 'Not assigned')}
        ${stat('Authorities', profile.authorities.length)}
        ${stat('Privacy baseline', profile.localOnly ? 'Local only' : 'Custom')}
      </div>

      <div class="mt-4 flex flex-wrap gap-2">
        ${badge(profile.enabled ? 'profile enabled' : 'profile paused', profile.enabled ? 'green' : 'amber')}
        ${badge(profile.localOnly ? 'local only' : 'external policy possible', profile.localOnly ? 'green' : 'amber')}
        ${badge(profile.cloudAllowed ? 'cloud allowed' : 'cloud blocked', profile.cloudAllowed ? 'amber' : 'slate')}
        ${badge(`personality ${profile.personalityProfile}`, 'slate')}
      </div>

      <div class="mt-5">
        <h3 class="mb-2 text-sm font-semibold text-slate-900">Profile authorities</h3>
        ${authoritiesTable(profile)}
      </div>

      <form method="post" action="/ai/profiles" class="mt-4 grid gap-3 lg:grid-cols-5">
        <input type="hidden" name="_csrf" value="${csrf}" />
        <input type="hidden" name="action" value="set-profile-authority" />
        <input type="hidden" name="profileId" value="${profile.id}" />
        <label class="text-sm">
          <span class="font-medium text-slate-700">Display label</span>
          <input
            name="displayLabel"
            required
            maxlength="120"
            class="mt-1 w-full rounded-lg border border-slate-300 px-2 py-2"
          />
        </label>
        <label class="text-sm">
          <span class="font-medium text-slate-700">Identity type</span>
          <select
            name="identityType"
            class="mt-1 w-full rounded-lg border border-slate-300 px-2 py-2"
          >
            <option value="user">user</option>
            <option value="contact">contact</option>
          </select>
        </label>
        <label class="text-sm">
          <span class="font-medium text-slate-700">SimpleX numeric ID</span>
          <input
            name="simplexId"
            type="number"
            min="1"
            required
            class="mt-1 w-full rounded-lg border border-slate-300 px-2 py-2 font-mono"
          />
        </label>
        <label class="text-sm">
          <span class="font-medium text-slate-700">Profile role</span>
          <select name="role" class="mt-1 w-full rounded-lg border border-slate-300 px-2 py-2">
            ${profileRoleOptions()}
          </select>
        </label>
        <button
          type="submit"
          class="self-end rounded-lg bg-slate-900 px-3 py-2 text-sm font-medium text-white hover:bg-slate-700"
        >
          Assign profile role
        </button>
      </form>

      <div class="mt-6">
        <h3 class="mb-2 text-sm font-semibold text-slate-900">Add SimpleX group assignment</h3>
        <form method="post" action="/ai/profiles" class="grid gap-3 lg:grid-cols-4">
          <input type="hidden" name="_csrf" value="${csrf}" />
          <input type="hidden" name="action" value="add-group" />
          <input type="hidden" name="profileId" value="${profile.id}" />
          <label class="text-sm">
            <span class="font-medium text-slate-700">Local display name</span>
            <input
              name="localDisplayName"
              required
              maxlength="120"
              class="mt-1 w-full rounded-lg border border-slate-300 px-2 py-2"
            />
          </label>
          <label class="text-sm">
            <span class="font-medium text-slate-700">SimpleX group ID</span>
            <input
              name="simplexGroupId"
              type="number"
              min="1"
              required
              class="mt-1 w-full rounded-lg border border-slate-300 px-2 py-2 font-mono"
            />
          </label>
          <label class="text-sm">
            <span class="font-medium text-slate-700">Group kind</span>
            <select name="kind" class="mt-1 w-full rounded-lg border border-slate-300 px-2 py-2">
              <option value="team">team</option>
              <option value="member">member</option>
              <option value="test">test</option>
            </select>
          </label>
          <button
            type="submit"
            class="self-end rounded-lg bg-slate-900 px-3 py-2 text-sm font-medium text-white hover:bg-slate-700"
          >
            Assign group
          </button>
        </form>
      </div>

      <form method="post" action="/ai/profiles" class="mt-4">
        <input type="hidden" name="_csrf" value="${csrf}" />
        <input type="hidden" name="action" value="toggle-profile" />
        <input type="hidden" name="profileId" value="${profile.id}" />
        <input type="hidden" name="enabled" value="${profile.enabled ? 'false' : 'true'}" />
        <button
          type="submit"
          class="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
        >
          ${profile.enabled ? 'Pause profile policy' : 'Enable profile policy'}
        </button>
      </form>

      <div class="mt-6 space-y-4">
        ${
          profile.groups.length > 0
            ? profile.groups.map((group) => groupCard(group, csrf))
            : html`<p class="text-sm text-slate-500">No groups assigned to this profile yet.</p>`
        }
      </div>
    `,
  );
}

export function registerAiProfiles(app: FastifyInstance, ctx: ViewContext): void {
  app.get<{ Querystring: { saved?: string; error?: string } }>(
    '/ai/profiles',
    async (req, reply) => {
      const profiles = await listCinderellaProfiles(ctx.db);
      const csrf = req.session?.csrfToken ?? '';

      reply.type('text/html');

      return page({
        title: 'AI Profiles and Groups',
        active: 'ai:profiles',
        csrfToken: csrf,
        body: html`
          ${pageHeader(
            'AI Profiles and Groups',
            'Persistent Cinderella profiles, team groups, member groups, and role assignments backed by technical SimpleX identifiers.',
          )}
          ${
            req.query.saved
              ? html`<div
                  class="mb-4 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800"
                >
                  Profile and group configuration saved.
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
            ${badge('SimpleX IDs define trust', 'green')}
            ${badge('One team group per profile', 'blue')}
            ${badge('Invitation links not stored', 'slate')}
            ${badge('Remote commands disabled', 'slate')}
            ${badge('Policy enforcement not active yet', 'amber')}
          </div>

          ${card(
            'Create Cinderella profile',
            html`
              <form method="post" action="/ai/profiles" class="grid gap-3 lg:grid-cols-3">
                <input type="hidden" name="_csrf" value="${csrf}" />
                <input type="hidden" name="action" value="create-profile" />
                <label class="text-sm">
                  <span class="font-medium text-slate-700">Profile name</span>
                  <input
                    name="displayName"
                    required
                    maxlength="80"
                    placeholder="Cinderella Main"
                    class="mt-1 w-full rounded-lg border border-slate-300 px-2 py-2"
                  />
                </label>
                <label class="text-sm">
                  <span class="font-medium text-slate-700">Profile slug</span>
                  <input
                    name="slug"
                    required
                    minlength="2"
                    maxlength="63"
                    pattern="[a-z0-9][a-z0-9-]{1,62}"
                    placeholder="cinderella-main"
                    class="mt-1 w-full rounded-lg border border-slate-300 px-2 py-2 font-mono"
                  />
                </label>
                <button
                  type="submit"
                  class="self-end rounded-lg bg-slate-900 px-3 py-2 text-sm font-medium text-white hover:bg-slate-700"
                >
                  Create profile
                </button>
              </form>
            `,
          )}

          <div class="mt-4 grid gap-4 lg:grid-cols-2">
            ${card(
              'Current trust model',
              html`<ul class="space-y-2 text-sm text-slate-700">
                <li>Profile roles use numeric SimpleX user or contact IDs.</li>
                <li>Group roles use the stable SimpleX member ID inside one group.</li>
                <li>Display names are labels only and never grant authority.</li>
                <li>Exactly one enabled owner and one team group are allowed per profile.</li>
                <li>Blocked group members can be represented before command processing exists.</li>
              </ul>`,
            )}
            ${card(
              'Connection boundary',
              html`<dl class="grid gap-3 text-sm sm:grid-cols-2">
                <div class="rounded-lg border border-slate-200 p-3">
                  <dt class="text-xs uppercase tracking-wide text-slate-500">
                    Invitation link handling
                  </dt>
                  <dd class="mt-1 font-medium text-slate-900">Not implemented</dd>
                </div>
                <div class="rounded-lg border border-slate-200 p-3">
                  <dt class="text-xs uppercase tracking-wide text-slate-500">Join group action</dt>
                  <dd class="mt-1 font-medium text-slate-900">Not implemented</dd>
                </div>
                <div class="rounded-lg border border-slate-200 p-3">
                  <dt class="text-xs uppercase tracking-wide text-slate-500">
                    Team command execution
                  </dt>
                  <dd class="mt-1 font-medium text-slate-900">Disabled</dd>
                </div>
                <div class="rounded-lg border border-slate-200 p-3">
                  <dt class="text-xs uppercase tracking-wide text-slate-500">
                    Role policy enforcement
                  </dt>
                  <dd class="mt-1 font-medium text-slate-900">Foundation only</dd>
                </div>
              </dl>`,
            )}
          </div>

          <div class="mt-4 space-y-6">
            ${
              profiles.length > 0
                ? profiles.map((profile) => profileCard(profile, csrf))
                : card(
                    'No profiles configured',
                    html`<p class="text-sm text-slate-600">
                      Create the first Cinderella profile before assigning a team group, normal
                      groups, owners, administrators, or moderators.
                    </p>`,
                  )
            }
          </div>
        `,
      });
    },
  );

  app.post('/ai/profiles', async (req, reply) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const action = text(body['action']);
    const actor = req.session?.username ?? 'unknown';

    try {
      switch (action) {
        case 'create-profile':
          await createCinderellaProfile(
            ctx.db,
            {
              slug: text(body['slug']),
              displayName: text(body['displayName']),
            },
            actor,
          );
          break;

        case 'toggle-profile':
          await setCinderellaProfileEnabled(
            ctx.db,
            positiveId(body['profileId'], 'Profile ID'),
            checked(body['enabled']),
            actor,
          );
          break;

        case 'add-group':
          await addCinderellaGroup(
            ctx.db,
            {
              profileId: positiveId(body['profileId'], 'Profile ID'),
              simplexGroupId: positiveId(body['simplexGroupId'], 'SimpleX group ID'),
              localDisplayName: text(body['localDisplayName']),
              kind: text(body['kind']) as 'team' | 'member' | 'test',
            },
            actor,
          );
          break;

        case 'toggle-group':
          await setCinderellaGroupEnabled(
            ctx.db,
            positiveId(body['groupId'], 'Group ID'),
            checked(body['enabled']),
            actor,
          );
          break;

        case 'set-profile-authority':
          await upsertCinderellaProfileAuthority(
            ctx.db,
            {
              profileId: positiveId(body['profileId'], 'Profile ID'),
              identityType: text(body['identityType']) as 'user' | 'contact',
              simplexId: positiveId(body['simplexId'], 'SimpleX identity ID'),
              displayLabel: text(body['displayLabel']),
              role: text(body['role']) as CinderellaProfileRole,
            },
            actor,
          );
          break;

        case 'set-group-authority':
          await upsertCinderellaGroupAuthority(
            ctx.db,
            {
              groupId: positiveId(body['groupId'], 'Group ID'),
              simplexMemberId: text(body['simplexMemberId']),
              displayLabel: text(body['displayLabel']),
              role: text(body['role']) as CinderellaGroupRole,
            },
            actor,
          );
          break;

        default:
          throw new Error('Unknown profile or group action.');
      }

      return reply.redirect(`/ai/profiles?saved=${encodeURIComponent(action)}`);
    } catch (error) {
      return reply.redirect(`/ai/profiles?error=${encodeURIComponent(errorMessage(error))}`);
    }
  });
}
