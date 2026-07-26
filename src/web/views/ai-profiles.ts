/**
 * AI bot access profile, group, and technical identity administration.
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
import { badge, stat } from './ui.js';

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

function optionalPositiveId(value: unknown): number | null {
  if (typeof value !== 'string' || value.trim() === '') return null;

  const parsed = Number.parseInt(value, 10);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
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

function profileStatusTone(profile: CinderellaProfile): 'ready' | 'warning' {
  return profile.enabled ? 'ready' : 'warning';
}

function profileListItem(profile: CinderellaProfile, selected: boolean): SafeHtml {
  const authorityCount = profile.authorities.length;
  const groupCount = profile.groups.length;

  return html`<a
    href="/ai/profiles?profile=${profile.id}"
    class="setup-list-item"
    data-access-list-item
    data-search-value="${profile.displayName} ${profile.slug}"
    ${selected ? raw('aria-current="page"') : ''}
  >
    <span class="setup-list-avatar">${profile.displayName.slice(0, 1).toUpperCase()}</span>
    <span class="setup-list-copy">
      <strong>${profile.displayName}</strong>
      <small>${groupCount} groups, ${authorityCount} authorities</small>
    </span>
    <span class="setup-list-status" data-tone="${profileStatusTone(profile)}">
      ${profile.enabled ? 'enabled' : 'paused'}
    </span>
  </a>`;
}

function authorityRows(profile: CinderellaProfile): SafeHtml {
  if (profile.authorities.length === 0) {
    return html`<tr>
      <td colspan="4" class="access-control-empty-row">No profile authorities assigned yet.</td>
    </tr>`;
  }

  return html`${profile.authorities.map(
    (authority) =>
      html`<tr>
        <td>
          <span class="access-control-identity">
            <strong>${authority.displayLabel}</strong>
            <small>${authority.identityType}:${fingerprint(authority.simplexId)}</small>
          </span>
        </td>
        <td>${authority.identityType === 'user' ? 'SimpleX user' : 'SimpleX contact'}</td>
        <td>${badge(authority.role, authority.role === 'owner' ? 'green' : 'blue')}</td>
        <td>
          ${badge(authority.enabled ? 'enabled' : 'disabled', authority.enabled ? 'green' : 'slate')}
        </td>
      </tr>`,
  )}`;
}

function groupAuthorityRows(group: CinderellaGroup): SafeHtml {
  if (group.authorities.length === 0) {
    return html`<tr>
      <td colspan="3" class="access-control-empty-row">No member roles assigned yet.</td>
    </tr>`;
  }

  return html`${group.authorities.map(
    (authority) =>
      html`<tr>
        <td>
          <span class="access-control-identity">
            <strong>${authority.displayLabel}</strong>
            <small>${fingerprint(authority.simplexMemberId)}</small>
          </span>
        </td>
        <td>${badge(authority.role, authority.role === 'blocked' ? 'red' : 'blue')}</td>
        <td>
          ${badge(authority.enabled ? 'enabled' : 'disabled', authority.enabled ? 'green' : 'slate')}
        </td>
      </tr>`,
  )}`;
}

function profileAuthorityDialog(profile: CinderellaProfile, csrf: string): SafeHtml {
  const id = `access-authority-${profile.id}`;

  return html`<dialog id="${id}" class="access-control-dialog" data-access-dialog>
    <form method="post" action="/ai/profiles">
      <input type="hidden" name="_csrf" value="${csrf}" />
      <input type="hidden" name="action" value="set-profile-authority" />
      <input type="hidden" name="profileId" value="${profile.id}" />
      <input type="hidden" name="returnProfileId" value="${profile.id}" />

      <header class="access-control-dialog-header">
        <div>
          <span class="setup-eyebrow">Access Control</span>
          <h2>Assign authority</h2>
          <p>Add a SimpleX identity to ${profile.displayName}.</p>
        </div>
        <button
          type="button"
          class="access-control-dialog-close"
          data-access-close="${id}"
          aria-label="Close dialog"
        >
          ×
        </button>
      </header>

      <div class="access-control-dialog-body">
        <label class="access-control-field">
          <span>Display label</span>
          <input name="displayLabel" required maxlength="120" />
        </label>

        <label class="access-control-field">
          <span>Identity type</span>
          <select name="identityType">
            <option value="user">SimpleX user</option>
            <option value="contact">SimpleX contact</option>
          </select>
        </label>

        <label class="access-control-field">
          <span>SimpleX numeric ID</span>
          <input name="simplexId" type="number" min="1" required />
        </label>

        <label class="access-control-field">
          <span>Profile role</span>
          <select name="role">
            ${profileRoleOptions()}
          </select>
        </label>
      </div>

      <footer class="access-control-dialog-footer">
        <button type="button" class="setup-button setup-button-quiet" data-access-close="${id}">
          Cancel
        </button>
        <button type="submit" class="setup-button setup-button-primary">Assign authority</button>
      </footer>
    </form>
  </dialog>`;
}

function addGroupDialog(profile: CinderellaProfile, csrf: string): SafeHtml {
  const id = `access-group-${profile.id}`;

  return html`<dialog id="${id}" class="access-control-dialog" data-access-dialog>
    <form method="post" action="/ai/profiles">
      <input type="hidden" name="_csrf" value="${csrf}" />
      <input type="hidden" name="action" value="add-group" />
      <input type="hidden" name="profileId" value="${profile.id}" />
      <input type="hidden" name="returnProfileId" value="${profile.id}" />

      <header class="access-control-dialog-header">
        <div>
          <span class="setup-eyebrow">Access Control</span>
          <h2>Add group assignment</h2>
          <p>Link one SimpleX group to ${profile.displayName}.</p>
        </div>
        <button
          type="button"
          class="access-control-dialog-close"
          data-access-close="${id}"
          aria-label="Close dialog"
        >
          ×
        </button>
      </header>

      <div class="access-control-dialog-body">
        <label class="access-control-field">
          <span>Local display name</span>
          <input name="localDisplayName" required maxlength="120" />
        </label>

        <label class="access-control-field">
          <span>SimpleX group ID</span>
          <input name="simplexGroupId" type="number" min="1" required />
        </label>

        <label class="access-control-field">
          <span>Group kind</span>
          <select name="kind">
            <option value="member">Member</option>
            <option value="team">Team</option>
            <option value="test">Test</option>
          </select>
        </label>
      </div>

      <footer class="access-control-dialog-footer">
        <button type="button" class="setup-button setup-button-quiet" data-access-close="${id}">
          Cancel
        </button>
        <button type="submit" class="setup-button setup-button-primary">Add group</button>
      </footer>
    </form>
  </dialog>`;
}

function groupAuthorityDialog(
  profile: CinderellaProfile,
  group: CinderellaGroup,
  csrf: string,
): SafeHtml {
  const id = `access-group-authority-${group.id}`;

  return html`<dialog id="${id}" class="access-control-dialog" data-access-dialog>
    <form method="post" action="/ai/profiles">
      <input type="hidden" name="_csrf" value="${csrf}" />
      <input type="hidden" name="action" value="set-group-authority" />
      <input type="hidden" name="groupId" value="${group.id}" />
      <input type="hidden" name="returnProfileId" value="${profile.id}" />

      <header class="access-control-dialog-header">
        <div>
          <span class="setup-eyebrow">Group access</span>
          <h2>Assign member role</h2>
          <p>Add a stable SimpleX member identity to ${group.localDisplayName}.</p>
        </div>
        <button
          type="button"
          class="access-control-dialog-close"
          data-access-close="${id}"
          aria-label="Close dialog"
        >
          ×
        </button>
      </header>

      <div class="access-control-dialog-body">
        <label class="access-control-field">
          <span>Display label</span>
          <input name="displayLabel" required maxlength="120" />
        </label>

        <label class="access-control-field">
          <span>SimpleX member ID</span>
          <input name="simplexMemberId" required maxlength="240" />
        </label>

        <label class="access-control-field">
          <span>Group role</span>
          <select name="role">
            ${groupRoleOptions()}
          </select>
        </label>
      </div>

      <footer class="access-control-dialog-footer">
        <button type="button" class="setup-button setup-button-quiet" data-access-close="${id}">
          Cancel
        </button>
        <button type="submit" class="setup-button setup-button-primary">Assign member role</button>
      </footer>
    </form>
  </dialog>`;
}

function groupCard(profile: CinderellaProfile, group: CinderellaGroup, csrf: string): SafeHtml {
  const dialogId = `access-group-authority-${group.id}`;

  return html`<article class="access-control-group-card">
    <header class="access-control-group-header">
      <div>
        <div class="access-control-group-title-row">
          <h4>${group.localDisplayName}</h4>
          ${badge(group.kind, group.kind === 'team' ? 'blue' : 'slate')}
        </div>
        <p>SimpleX group ${fingerprint(group.simplexGroupId)}</p>
      </div>
      ${badge(group.enabled ? 'enabled' : 'paused', group.enabled ? 'green' : 'amber')}
    </header>

    <dl class="access-control-group-stats">
      <div>
        <dt>Member roles</dt>
        <dd>${group.authorities.length}</dd>
      </div>
      <div>
        <dt>Policy source</dt>
        <dd>${group.inheritProfile ? 'profile' : 'custom'}</dd>
      </div>
    </dl>

    <div class="access-control-group-table-wrap">
      <table class="access-control-table access-control-group-table">
        <thead>
          <tr>
            <th>Member</th>
            <th>Role</th>
            <th>State</th>
          </tr>
        </thead>
        <tbody>
          ${groupAuthorityRows(group)}
        </tbody>
      </table>
    </div>

    <footer class="access-control-group-actions">
      <button
        type="button"
        class="setup-button setup-button-secondary"
        data-access-open="${dialogId}"
      >
        Assign member role
      </button>

      <form method="post" action="/ai/profiles">
        <input type="hidden" name="_csrf" value="${csrf}" />
        <input type="hidden" name="action" value="toggle-group" />
        <input type="hidden" name="groupId" value="${group.id}" />
        <input type="hidden" name="returnProfileId" value="${profile.id}" />
        <input type="hidden" name="enabled" value="${group.enabled ? 'false' : 'true'}" />
        <button type="submit" class="setup-button setup-button-quiet">
          ${group.enabled ? 'Pause group policy' : 'Enable group policy'}
        </button>
      </form>
    </footer>

    ${groupAuthorityDialog(profile, group, csrf)}
  </article>`;
}

function selectedProfileDetail(profile: CinderellaProfile, csrf: string): SafeHtml {
  const authorityDialogId = `access-authority-${profile.id}`;
  const groupDialogId = `access-group-${profile.id}`;
  const teamGroup = profile.groups.find((group) => group.kind === 'team');

  return html`<section class="access-control-detail" data-access-workspace>
    <header class="setup-detail-header">
      <div>
        <span class="setup-eyebrow">Selected AI bot</span>
        <h2>${profile.displayName}</h2>
        <p>Access policy and technical trust assignments.</p>
      </div>
      <a href="/ai/onboarding" class="setup-button setup-button-secondary">Edit AI Bot</a>
    </header>

    <nav class="access-control-tabs" aria-label="Access Control sections">
      <button
        type="button"
        class="access-control-tab"
        data-access-tab="overview"
        aria-selected="true"
      >
        Overview
      </button>
      <button
        type="button"
        class="access-control-tab"
        data-access-tab="authorities"
        aria-selected="false"
      >
        Authorities
      </button>
      <button
        type="button"
        class="access-control-tab"
        data-access-tab="groups"
        aria-selected="false"
      >
        Groups
      </button>
    </nav>

    <section data-access-panel="overview">
      <div class="setup-status-grid">
        ${stat('Policy state', profile.enabled ? 'enabled' : 'paused')}
        ${stat('Groups', profile.groups.length)} ${stat('Authorities', profile.authorities.length)}
        ${stat('Privacy', profile.localOnly ? 'local only' : 'custom')}
      </div>

      <div class="setup-chip-row">
        ${badge(profile.enabled ? 'profile enabled' : 'profile paused', profile.enabled ? 'green' : 'amber')}
        ${badge(profile.cloudAllowed ? 'cloud allowed' : 'cloud blocked', profile.cloudAllowed ? 'amber' : 'green')}
        ${badge('policy foundation', 'slate')}
      </div>

      <section class="access-control-overview-note">
        <span class="setup-eyebrow">Current boundary</span>
        <h3>Stored access policy only</h3>
        <p>
          SimpleX IDs define trust. Invitation handling, group joining, command execution, and
          runtime enforcement remain inactive.
        </p>
      </section>

      <details class="setup-technical">
        <summary>Technical details</summary>
        <div class="setup-technical-content">
          <dl class="setup-technical-grid">
            <div>
              <dt>Profile slug</dt>
              <dd>${profile.slug}</dd>
            </div>
            <div>
              <dt>Team group</dt>
              <dd>${teamGroup?.simplexGroupId ?? 'not assigned'}</dd>
            </div>
            <div>
              <dt>Cloud</dt>
              <dd>${profile.cloudAllowed ? 'allowed' : 'blocked'}</dd>
            </div>
            <div>
              <dt>Personality</dt>
              <dd>${profile.personalityProfile}</dd>
            </div>
            <div>
              <dt>Runtime</dt>
              <dd>not active</dd>
            </div>
            <div>
              <dt>Enforcement</dt>
              <dd>foundation only</dd>
            </div>
          </dl>
        </div>
      </details>

      <form method="post" action="/ai/profiles" class="access-control-profile-action">
        <input type="hidden" name="_csrf" value="${csrf}" />
        <input type="hidden" name="action" value="toggle-profile" />
        <input type="hidden" name="profileId" value="${profile.id}" />
        <input type="hidden" name="returnProfileId" value="${profile.id}" />
        <input type="hidden" name="enabled" value="${profile.enabled ? 'false' : 'true'}" />
        <button
          type="submit"
          class="setup-button ${profile.enabled ? 'setup-button-danger' : 'setup-button-secondary'}"
        >
          ${profile.enabled ? 'Pause access policy' : 'Enable access policy'}
        </button>
      </form>
    </section>

    <section data-access-panel="authorities" hidden>
      <section class="access-control-section">
        <header class="access-control-section-header">
          <div>
            <h3>Profile authorities</h3>
            <p>Technical SimpleX identities with profile level permissions.</p>
          </div>
          <button
            type="button"
            class="setup-button setup-button-secondary"
            data-access-open="${authorityDialogId}"
          >
            Assign authority
          </button>
        </header>

        <div class="access-control-table-wrap">
          <table class="access-control-table">
            <thead>
              <tr>
                <th>Label</th>
                <th>Identity</th>
                <th>Role</th>
                <th>State</th>
              </tr>
            </thead>
            <tbody>
              ${authorityRows(profile)}
            </tbody>
          </table>
        </div>
      </section>
      ${profileAuthorityDialog(profile, csrf)}
    </section>

    <section data-access-panel="groups" hidden>
      <section class="access-control-section">
        <header class="access-control-section-header">
          <div>
            <h3>Group access</h3>
            <p>Group assignments and member roles for this AI bot.</p>
          </div>
          <button
            type="button"
            class="setup-button setup-button-secondary"
            data-access-open="${groupDialogId}"
          >
            Add group
          </button>
        </header>

        ${
          profile.groups.length > 0
            ? html`<div class="access-control-groups">
                ${profile.groups.map((group) => groupCard(profile, group, csrf))}
              </div>`
            : html`<div class="access-control-empty-panel">
                No SimpleX groups are assigned to this AI bot yet.
              </div>`
        }
      </section>
      ${addGroupDialog(profile, csrf)}
    </section>
  </section>`;
}

export function registerAiProfiles(app: FastifyInstance, ctx: ViewContext): void {
  app.get<{ Querystring: { profile?: string; saved?: string; error?: string } }>(
    '/ai/profiles',
    async (req, reply) => {
      const profiles = await listCinderellaProfiles(ctx.db);
      const csrf = req.session?.csrfToken ?? '';
      const requestedProfileId = optionalPositiveId(req.query.profile);
      const selectedProfile =
        profiles.find((profile) => profile.id === requestedProfileId) ?? profiles[0] ?? null;

      reply.type('text/html');

      return page({
        title: 'Access Control',
        active: 'ai:profiles',
        csrfToken: csrf,
        head: html`<script src="/assets/admin-access-control.js" defer></script>`,
        body: html`<section class="setup-page access-control-page">
          <header class="setup-page-header">
            <div>
              <span class="setup-eyebrow">Access Control</span>
              <h1>Access Control</h1>
              <p>Manage groups, roles, and technical trust assignments for configured AI bots.</p>
            </div>
            <a href="/ai/onboarding" class="setup-button setup-button-primary setup-create-button">
              Open AI Bot Setup
            </a>
          </header>

          ${
            req.query.saved
              ? html`<div class="setup-alert" data-tone="success">
                  Profile and group configuration saved.
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
                data-access-search
              />
            </label>
            <div class="setup-toolbar-summary">
              <strong>${profiles.length}</strong>
              <span>${profiles.length === 1 ? 'AI Bot' : 'AI Bots'}</span>
            </div>
          </div>

          ${
            profiles.length > 0 && selectedProfile
              ? html`<div class="access-control-master-detail">
                  <aside class="setup-list-panel">
                    <div class="setup-list-heading">
                      <span>AI Bots</span>
                      <strong>${profiles.length}</strong>
                    </div>
                    <nav class="setup-list" aria-label="Configured AI bots">
                      ${profiles.map((profile) =>
                        profileListItem(profile, profile.id === selectedProfile.id),
                      )}
                      <p class="setup-list-empty" data-access-list-empty hidden>
                        No AI bots found.
                      </p>
                    </nav>
                  </aside>

                  ${selectedProfileDetail(selectedProfile, csrf)}
                </div>`
              : html`<section class="setup-empty">
                  <span class="setup-eyebrow">No access policy configured</span>
                  <h2>Complete AI Bot Setup first</h2>
                  <p>
                    Access policy will be connected after identity, group, and role verification.
                  </p>
                  <a href="/ai/onboarding" class="setup-button setup-button-primary">
                    Open AI Bot Setup
                  </a>
                </section>`
          }

          <details class="setup-reference">
            <summary>Trust model and connection boundary</summary>
            <div class="setup-reference-body">
              <div class="setup-reference-intro">
                <div>
                  <span class="setup-eyebrow">Technical reference</span>
                  <h2>Access policy foundation</h2>
                  <p>
                    SimpleX IDs define trust. Invitation handling and runtime enforcement remain
                    separate phases.
                  </p>
                </div>
              </div>

              <div class="access-control-boundary-grid">
                <div>
                  <span>Invitation links</span>
                  <strong>not stored</strong>
                </div>
                <div>
                  <span>Join group action</span>
                  <strong>not implemented</strong>
                </div>
                <div>
                  <span>Remote commands</span>
                  <strong>disabled</strong>
                </div>
                <div>
                  <span>Policy enforcement</span>
                  <strong>foundation only</strong>
                </div>
              </div>
            </div>
          </details>
        </section>`,
      });
    },
  );

  app.post('/ai/profiles', async (req, reply) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const action = text(body['action']);
    const actor = req.session?.username ?? 'unknown';
    const returnProfileId = optionalPositiveId(body['returnProfileId']);

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

      const query = new URLSearchParams({ saved: action });
      if (returnProfileId !== null) query.set('profile', String(returnProfileId));
      return reply.redirect(`/ai/profiles?${query.toString()}`);
    } catch (error) {
      const query = new URLSearchParams({ error: errorMessage(error) });
      if (returnProfileId !== null) query.set('profile', String(returnProfileId));
      return reply.redirect(`/ai/profiles?${query.toString()}`);
    }
  });
}
