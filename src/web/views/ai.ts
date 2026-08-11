/**
 * Modular AI control center for Cinderella.
 *
 * The admin surface is split into dedicated pages so runtime control, models, routing,
 * telemetry, personality, privacy, providers, knowledge, testing, and audit information
 * can grow independently without turning one page into an unreadable wall.
 */

import type { FastifyInstance } from 'fastify';
import {
  aiRuntimeSnapshot,
  refreshAiModelCatalog,
  resetAiOperationsTelemetry,
  setAiModelRouting,
  setAiRuntimeEnabled,
  testAiRuntimeConnection,
  type AiActivityEvent,
  type AiModelInfo,
  type AiModelRoutingSnapshot,
  type AiRuntimeSnapshot,
} from '../../interaction/ai-runtime.js';
import { html, page, raw, type BotSwitcher, type SafeHtml } from '../html.js';
import type { ViewContext } from '../server.js';
import { badge, card, pageHeader, stat } from './ui.js';
import { meanMs, modelQueue, type BotModelStats } from '../../interaction/model-queue.js';
import { listBotOnboardingProfiles } from '../../profiles/bot-onboarding.js';

/**
 * Exported with {@link renderAiPage} so the Personality page (CCB-S4-029) can be its
 * own module and still wear the same chrome. It grew past a `definitionList` of
 * "Not configured" rows into a real editor, and a 2000 line `ai.ts` was not the place
 * for it; sharing the header rather than copying it keeps the AI section one section.
 */
export interface AiPageQuery {
  saved?: string;
  tested?: string;
  refreshed?: string;
  routed?: string;
  reset?: string;
  error?: string;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function displayTime(value: string | null): string {
  if (!value) return 'Not recorded';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return `${date.toISOString().replace('T', ' ').slice(0, 19)} UTC`;
}

function displayLatency(value: number | null): string {
  return value === null ? 'Not recorded' : `${value.toFixed(1)} ms`;
}

function displayRate(value: number | null): string {
  return value === null ? 'Not recorded' : `${value.toFixed(1)}%`;
}

function displayBytes(value: number | null): string {
  if (value === null) return 'Unknown';
  if (value < 1024) return `${value} B`;

  const units = ['KiB', 'MiB', 'GiB', 'TiB'];
  let scaled = value;
  let unit = 'B';

  for (const candidate of units) {
    scaled /= 1024;
    unit = candidate;
    if (scaled < 1024) break;
  }

  return `${scaled >= 100 ? scaled.toFixed(0) : scaled.toFixed(1)} ${unit}`;
}

function endpointScope(baseUrl: string): string {
  if (!baseUrl) return 'Not configured';

  try {
    const host = new URL(baseUrl).hostname.toLowerCase();

    if (
      host === 'localhost' ||
      host === '127.0.0.1' ||
      host === '::1' ||
      host.startsWith('10.') ||
      host.startsWith('192.168.') ||
      /^172\.(1[6-9]|2[0-9]|3[01])\./.test(host)
    ) {
      return 'Private or loopback endpoint';
    }

    return 'External endpoint';
  } catch {
    return 'Invalid endpoint';
  }
}

function definitionList(rows: Array<[string, string | SafeHtml]>): SafeHtml {
  return html`<dl class="grid gap-3 text-sm sm:grid-cols-2">
    ${rows.map(
      ([label, value]) =>
        html`<div class="rounded-lg border border-slate-200 p-3">
          <dt class="text-xs font-medium uppercase tracking-wide text-slate-500">${label}</dt>
          <dd class="mt-1 break-words font-medium text-slate-900">${value}</dd>
        </div>`,
    )}
  </dl>`;
}

function notice(query: AiPageQuery): SafeHtml | null {
  const success = query.reset
    ? 'In-memory AI telemetry and the recent operations buffer were cleared.'
    : query.routed
      ? 'Model routing updated. New intent and reply requests use the selected local lanes.'
      : query.refreshed
        ? 'Model catalog refreshed from the configured Ollama endpoint.'
        : query.tested
          ? 'Role probe passed. Every selected local model is online and available.'
          : query.saved
            ? 'Runtime mode updated. The new route is active without a service restart.'
            : null;

  if (success) {
    return html`<div
      class="mb-4 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800"
    >
      ${success}
    </div>`;
  }

  if (query.error) {
    return html`<div
      class="mb-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700"
    >
      ${query.error}
    </div>`;
  }

  return null;
}

function statusBadges(snapshot: AiRuntimeSnapshot): SafeHtml {
  const runtimeTone = snapshot.enabled ? 'green' : 'slate';
  const runtimeLabel = snapshot.enabled ? 'Local AI active' : 'Deterministic rules active';
  const probeTone =
    snapshot.probe.ok === true ? 'green' : snapshot.probe.ok === false ? 'red' : 'slate';
  const probeLabel =
    snapshot.probe.ok === true
      ? 'Role probe passed'
      : snapshot.probe.ok === false
        ? 'Role probe failed'
        : 'Not tested';
  const catalogTone =
    snapshot.catalog.ok === true ? 'green' : snapshot.catalog.ok === false ? 'red' : 'slate';
  const catalogLabel =
    snapshot.catalog.ok === true
      ? `${snapshot.catalog.models.length} models discovered`
      : snapshot.catalog.ok === false
        ? 'Catalog refresh failed'
        : 'Catalog not loaded';
  const scope = endpointScope(snapshot.baseUrl);

  return html`<div class="mb-4 flex flex-wrap gap-2">
    ${badge(runtimeLabel, runtimeTone)}
    ${badge(
      snapshot.available ? 'Environment gate open' : 'Environment gate closed',
      snapshot.available ? 'blue' : 'amber',
    )}
    ${badge(probeLabel, probeTone)} ${badge(catalogLabel, catalogTone)}
    ${badge(scope, scope === 'External endpoint' ? 'amber' : 'slate')}
    ${badge('Content-free telemetry', 'green')} ${badge('Cloud fallback disabled', 'slate')}
  </div>`;
}

export function renderAiPage(
  title: string,
  description: string,
  active: string,
  csrf: string,
  query: AiPageQuery,
  snapshot: AiRuntimeSnapshot,
  body: SafeHtml,
  head?: SafeHtml,
  /**
   * The bot this page edits, when it edits one (CCB-S5-011).
   *
   * Optional and last, because most AI pages are deployment-wide. A page that passes
   * nothing renders no switcher, which is the honest statement that it does not belong to
   * one bot rather than an omission.
   */
  botSwitcher?: BotSwitcher,
): string {
  return page({
    title,
    active,
    csrfToken: csrf,
    ...(head ? { head } : {}),
    ...(botSwitcher ? { botSwitcher } : {}),
    body: html`
      ${pageHeader(title, description)} ${notice(query)} ${statusBadges(snapshot)} ${body}
    `,
  });
}

function modelNames(models: AiModelInfo[], routing: AiModelRoutingSnapshot): string[] {
  return [
    ...new Set([
      ...models.map((model) => model.name),
      routing.defaultModel,
      routing.intentModel,
      routing.replyModel,
    ]),
  ]
    .filter((name) => name !== '')
    .sort((left, right) => left.localeCompare(right));
}

function modelSelect(name: string, current: string, models: string[]): SafeHtml {
  return html`<select
    name="${name}"
    class="w-full rounded-lg border border-slate-300 px-2 py-2 text-sm"
  >
    ${models.map(
      (model) =>
        html`<option value="${model}" ${model === current ? raw('selected') : ''}>
          ${model}
        </option>`,
    )}
  </select>`;
}

function modelRoleNames(model: AiModelInfo, routing: AiModelRoutingSnapshot): string[] {
  const roles: string[] = [];

  if (model.name === routing.intentModel) roles.push('intent');
  if (model.name === routing.replyModel) roles.push('reply');
  if (model.name === routing.defaultModel) roles.push('default');

  return roles;
}

function modelRoleBadges(model: AiModelInfo, routing: AiModelRoutingSnapshot): SafeHtml {
  const roles = modelRoleNames(model, routing);

  if (roles.length === 0) return badge('unassigned', 'slate');

  return html`${roles.map((role) =>
    badge(role, role === 'intent' ? 'blue' : role === 'reply' ? 'green' : 'slate'),
  )}`;
}

function modelCatalogItem(
  model: AiModelInfo,
  routing: AiModelRoutingSnapshot,
  index: number,
): SafeHtml {
  const roles = modelRoleNames(model, routing);
  const roleSearch = roles.length > 0 ? roles.join(' ') : 'unassigned';

  return html`<button
    type="button"
    class="model-catalog-item"
    data-model-item
    data-model-target="model-detail-${index}"
    data-search-value="${model.name} ${model.family ?? ''} ${model.parameterSize ?? ''} ${model.quantizationLevel ?? ''}"
    data-role-value="${roleSearch}"
    ${index === 0 ? raw('aria-current="true"') : raw('aria-current="false"')}
  >
    <span class="model-catalog-item-icon">M</span>
    <span class="model-catalog-item-copy">
      <strong>${model.name}</strong>
      <small
        >${model.parameterSize ?? 'Unknown size'} ·
        ${model.quantizationLevel ?? 'Unknown quantization'}</small
      >
    </span>
    <span class="model-catalog-item-roles">${modelRoleBadges(model, routing)}</span>
  </button>`;
}

function modelDetailPanel(
  model: AiModelInfo,
  routing: AiModelRoutingSnapshot,
  index: number,
): SafeHtml {
  const roles = modelRoleNames(model, routing);

  return html`<article
    id="model-detail-${index}"
    class="model-catalog-detail"
    data-model-detail
    ${index === 0 ? '' : raw('hidden')}
  >
    <header class="model-catalog-detail-header">
      <div>
        <span class="setup-eyebrow">Selected model</span>
        <h2>${model.name}</h2>
        <p>Read only metadata discovered from the configured Ollama endpoint.</p>
      </div>
      <div class="model-catalog-detail-badges">${modelRoleBadges(model, routing)}</div>
    </header>

    <div class="model-catalog-detail-stats">
      ${stat('File size', displayBytes(model.sizeBytes))}
      ${stat('Family', model.family ?? 'Unknown')}
      ${stat('Parameters', model.parameterSize ?? 'Unknown')}
      ${stat('Quantization', model.quantizationLevel ?? 'Unknown')}
    </div>

    <section class="model-catalog-detail-section">
      <header>
        <div>
          <span class="setup-eyebrow">Routing state</span>
          <h3>Current role assignments</h3>
        </div>
        <a href="/ai/routing" class="setup-button setup-button-secondary">Open routing</a>
      </header>

      <dl class="model-catalog-routing-grid">
        <div>
          <dt>Intent classification</dt>
          <dd>${model.name === routing.intentModel ? 'assigned' : 'not assigned'}</dd>
        </div>
        <div>
          <dt>Reply wording</dt>
          <dd>${model.name === routing.replyModel ? 'assigned' : 'not assigned'}</dd>
        </div>
        <div>
          <dt>Environment default</dt>
          <dd>${model.name === routing.defaultModel ? 'assigned' : 'not assigned'}</dd>
        </div>
        <div>
          <dt>Active role count</dt>
          <dd>${roles.length}</dd>
        </div>
      </dl>
    </section>

    <section class="model-catalog-detail-section">
      <header>
        <div>
          <span class="setup-eyebrow">Catalog metadata</span>
          <h3>Discovery record</h3>
        </div>
      </header>

      <dl class="model-catalog-definition-list">
        <div>
          <dt>Model name</dt>
          <dd>${model.name}</dd>
        </div>
        <div>
          <dt>Family</dt>
          <dd>${model.family ?? 'Unknown'}</dd>
        </div>
        <div>
          <dt>Parameter size</dt>
          <dd>${model.parameterSize ?? 'Unknown'}</dd>
        </div>
        <div>
          <dt>Quantization</dt>
          <dd>${model.quantizationLevel ?? 'Unknown'}</dd>
        </div>
        <div>
          <dt>Modified</dt>
          <dd>${displayTime(model.modifiedAt)}</dd>
        </div>
        <div>
          <dt>Catalog source</dt>
          <dd>Ollama /api/tags</dd>
        </div>
      </dl>
    </section>
  </article>`;
}

/**
 * How hard she thinks before she speaks (CCB-S4-052, D-154).
 *
 * SHIPS WHETHER OR NOT THERE IS A CONTROL, which was the operator's point and it stands. The
 * reasoning setting was invisible: nothing said whether she thinks before answering, at what
 * depth, or where the value comes from. That is a hidden state in a product whose whole
 * argument is that hidden states are what you cannot trust.
 *
 * It is knowable precisely because it is not a property of the model: it is a parameter this
 * application sends with every request, from the same machine the console runs on.
 */
import {
  CONTEXT_MEASUREMENTS,
  REASONING_EFFORT_SENT,
  REASONING_MEASUREMENTS,
  REASONING_SOURCE,
} from '../../interaction/reasoning.js';

function reasoningCard(): SafeHtml {
  return html`<section class="setup-card">
    <h2>Thinking before she answers</h2>

    <p class="setup-card-note">
      She is running with reasoning <strong>off</strong>
      (<code>reasoning_effort: "${REASONING_EFFORT_SENT}"</code>). That is an explicit choice in
      the code, not the runtime's default: Ollama runs a reasoning pass by default for models
      that support it, and this application turns it off on every request.
    </p>
    <p class="setup-card-note">
      <strong>Where it comes from.</strong> It is ${REASONING_SOURCE}, so it is knowable from
      here and would be changeable from here. It is not currently changeable, and the reason is
      measured rather than assumed.
    </p>

    <table class="setup-table">
      <thead>
        <tr>
          <th>Setting</th>
          <th>Latency</th>
          <th>Reasoning</th>
          <th>Unusable replies</th>
        </tr>
      </thead>
      <tbody>
        ${REASONING_MEASUREMENTS.map(
          (m) => html`<tr>
            <td>${m.label}</td>
            <td>${(m.latencyMs / 1000).toFixed(1)}s</td>
            <td>${m.reasoningChars === 0 ? 'none' : `${String(m.reasoningChars)} chars`}</td>
            <td>${String(m.unusableOfFive)} of 5</td>
          </tr>`,
        )}
      </tbody>
    </table>

    <p class="setup-card-note">
      <strong>Why there is no dial.</strong> A reply is bounded at 320 tokens and the reasoning
      pass spends the same budget. Measured in the real request shape, turning thinking on made
      three replies in five come back empty and fail their schema, which in production throws
      and falls back to the deterministic line. A control that silently replaced three in five
      of her answers with a canned one is not a control worth having, and the quality at each
      level was not visibly better in the first place.
    </p>
    <p class="setup-card-note">
      Raising the token budget would make room, and that is a different change with its own
      costs that nobody has measured. If it is ever wanted, this is the page it belongs on.
    </p>

    <h3>What a bigger context would cost</h3>
    <p class="setup-card-note">
      Measured on the 24 GB card and <strong>deliberately not applied</strong>: this is a
      number to decide with, not a setting anybody moved.
    </p>
    <table class="setup-table">
      <thead>
        <tr>
          <th>Context</th>
          <th>Total</th>
          <th>In VRAM</th>
          <th>On CPU</th>
        </tr>
      </thead>
      <tbody>
        ${CONTEXT_MEASUREMENTS.map(
          (c) => html`<tr>
            <td>${String(c.numCtx)}</td>
            <td>${c.totalGb === null ? 'not measured' : `${c.totalGb.toFixed(2)} GB`}</td>
            <td>${c.vramGb === null ? '' : `${c.vramGb.toFixed(2)} GB`}</td>
            <td>${c.cpuGb === null ? '' : `${c.cpuGb.toFixed(2)} GB`}</td>
          </tr>`,
        )}
      </tbody>
    </table>
    <p class="setup-card-note">
      At 32768 the model spills 6.21 GB onto the CPU, which is the failure that has bitten this
      deployment before. 16384 failed to load in two attempts and is reported as unmeasured
      rather than estimated.
    </p>
  </section>`;
}

function modelsBody(snapshot: AiRuntimeSnapshot, csrf: string, query: AiPageQuery): SafeHtml {
  const models = snapshot.catalog.models;
  const routedModels = new Set([
    snapshot.routing.intentModel,
    snapshot.routing.replyModel,
    snapshot.routing.defaultModel,
  ]).size;
  const catalogState =
    snapshot.catalog.ok === true
      ? 'healthy'
      : snapshot.catalog.ok === false
        ? 'failed'
        : 'not loaded';

  return html`<section class="model-catalog-page">
    <header class="setup-page-header">
      <div>
        <span class="setup-eyebrow">AI Control</span>
        <h1>AI Models</h1>
        <p>
          Inspect installed Ollama models, catalog health, routing assignments, and management
          boundaries.
        </p>
      </div>

      <form method="post" action="/ai/models/refresh">
        <input type="hidden" name="_csrf" value="${csrf}" />
        <button type="submit" class="setup-button setup-button-primary setup-create-button">
          Refresh catalog
        </button>
      </form>
    </header>

    ${reasoningCard()}

    ${notice(query)}

    <!--
      CCB-S4-042 defect 6. An honest sentence beats a missing one, and both beat a control that
      does not do what its label says. The operator watched the same spell-check produce three
      different answers and had no way to learn why from this console.
    -->
    <div class="rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm text-slate-700">
      <p class="font-semibold">Why the same question can get a different answer twice</p>
      <p class="mt-1">
        Every model call uses <strong>temperature 0.7</strong> and asks for
        <strong>no reasoning effort</strong>, in every mode. Temperature is what makes her sound
        alive rather than canned: a nickname retort that came back word for word identical every
        time would be a worse product. For a <em>task</em>, though, the same setting is a defect,
        and it shows: the identical spell-check text sent three times produced three materially
        different replies.
      </p>
      <p class="mt-2">
        <strong>There is deliberately no setting here yet, because there is nothing to attach one
        to.</strong> She has five reply modes and none of them is "a task": a spell-check request
        is not a command, so it arrives as UNKNOWN and is answered in the same conversation mode,
        with the same sampling, as small talk. Adding a temperature slider today would apply it to
        her whole voice at once, which is not what anybody wants. Telling a task apart from a
        conversation is a resolver change, not a settings change, and it is queued rather than
        guessed at here.
      </p>
    </div>

    <div class="model-catalog-status-grid">
      <article class="model-catalog-status">
        <span>Catalog state</span>
        <strong>${catalogState}</strong>
        <small>${snapshot.catalog.error ?? 'No discovery error recorded'}</small>
      </article>
      <article class="model-catalog-status">
        <span>Installed models</span>
        <strong>${models.length}</strong>
        <small>Read only inventory from Ollama</small>
      </article>
      <article class="model-catalog-status">
        <span>Routed model names</span>
        <strong>${routedModels}</strong>
        <small>Intent, reply, and environment default</small>
      </article>
      <article class="model-catalog-status">
        <span>Last refresh</span>
        <strong>${snapshot.catalog.at ? 'recorded' : 'not recorded'}</strong>
        <small>${displayTime(snapshot.catalog.at)}</small>
      </article>
    </div>

    <div class="model-catalog-toolbar">
      <label class="setup-search">
        <span class="setup-search-icon" aria-hidden="true">⌕</span>
        <input
          type="search"
          placeholder="Search installed models"
          aria-label="Search installed models"
          data-model-search
        />
      </label>

      <label class="model-catalog-filter">
        <span>Role filter</span>
        <select data-model-role-filter>
          <option value="all">All models</option>
          <option value="routed">Any routed role</option>
          <option value="intent">Intent</option>
          <option value="reply">Reply</option>
          <option value="default">Environment default</option>
          <option value="unassigned">Unassigned</option>
        </select>
      </label>

      <div class="setup-toolbar-summary">
        <strong data-model-visible-count>${models.length}</strong>
        <span>visible</span>
      </div>
    </div>

    ${
      models.length > 0
        ? html`<div class="model-catalog-master-detail">
            <aside class="model-catalog-list-panel">
              <div class="setup-list-heading">
                <span>Installed Ollama models</span>
                <strong>${models.length}</strong>
              </div>
              <div class="model-catalog-list">
                ${models.map((model, index) => modelCatalogItem(model, snapshot.routing, index))}
                <p class="setup-list-empty" data-model-empty hidden>
                  No models match the current filters.
                </p>
              </div>
            </aside>

            <section class="model-catalog-detail-panel">
              ${models.map((model, index) => modelDetailPanel(model, snapshot.routing, index))}
            </section>
          </div>`
        : html`<section class="setup-empty">
            <span class="setup-eyebrow">Catalog empty</span>
            <h2>No installed models discovered</h2>
            <p>
              Refresh the catalog to read the current model inventory from the private Ollama
              endpoint.
            </p>
            <form method="post" action="/ai/models/refresh">
              <input type="hidden" name="_csrf" value="${csrf}" />
              <button type="submit" class="setup-button setup-button-primary">
                Refresh catalog
              </button>
            </form>
          </section>`
    }

    <details class="setup-reference model-catalog-boundary">
      <summary>Model management boundary</summary>
      <div class="setup-reference-body">
        <div class="setup-reference-intro">
          <div>
            <span class="setup-eyebrow">Current capability</span>
            <h2>Discovery is read only</h2>
            <p>
              Catalog refresh updates the process snapshot and operations telemetry. It does not
              install, remove, load, or unload models.
            </p>
          </div>
        </div>

        <div class="model-catalog-boundary-grid">
          <div><span>Discovery</span><strong>available</strong></div>
          <div><span>Catalog persistence</span><strong>process memory</strong></div>
          <div><span>Pull model</span><strong>not implemented</strong></div>
          <div><span>Remove model</span><strong>not implemented</strong></div>
          <div><span>Load or unload</span><strong>not implemented</strong></div>
          <div><span>Role assignment</span><strong>available in Routing</strong></div>
          <div><span>Cloud catalog</span><strong>disabled</strong></div>
          <div><span>Secret material shown</span><strong>no</strong></div>
        </div>
      </div>
    </details>
  </section>`;
}

function activityTone(outcome: AiActivityEvent['outcome']): 'green' | 'red' | 'amber' | 'blue' {
  if (outcome === 'success') return 'green';
  if (outcome === 'failure') return 'red';
  if (outcome === 'fallback') return 'amber';
  return 'blue';
}

function activityTable(events: AiActivityEvent[]): SafeHtml {
  if (events.length === 0) {
    return html`<p class="text-sm text-slate-500">
      No AI operations have been recorded in this process yet.
    </p>`;
  }

  return html`<div class="overflow-x-auto">
    <table class="min-w-full text-left text-sm">
      <thead class="border-b border-slate-200 text-xs uppercase tracking-wide text-slate-500">
        <tr>
          <th class="px-3 py-2 font-medium">Time</th>
          <th class="px-3 py-2 font-medium">Lane</th>
          <th class="px-3 py-2 font-medium">Outcome</th>
          <th class="px-3 py-2 font-medium">Operation</th>
          <th class="px-3 py-2 font-medium">Model</th>
          <th class="px-3 py-2 font-medium">Latency</th>
          <th class="px-3 py-2 font-medium">Detail</th>
        </tr>
      </thead>
      <tbody class="divide-y divide-slate-100">
        ${[...events].reverse().map(
          (event) =>
            html`<tr>
              <td class="whitespace-nowrap px-3 py-3 text-slate-600">${displayTime(event.at)}</td>
              <td class="px-3 py-3 font-medium text-slate-900">${event.role}</td>
              <td class="px-3 py-3">${badge(event.outcome, activityTone(event.outcome))}</td>
              <td class="px-3 py-3 text-slate-600">${event.operation}</td>
              <td class="px-3 py-3 text-slate-600">${event.model ?? 'System'}</td>
              <td class="px-3 py-3 text-slate-600">${displayLatency(event.latencyMs)}</td>
              <td class="px-3 py-3 text-slate-600">${event.detail}</td>
            </tr>`,
        )}
      </tbody>
    </table>
  </div>`;
}

function capabilityRow(
  capability: string,
  status: string,
  tone: 'green' | 'slate' | 'amber' | 'blue',
  proof: string,
): SafeHtml {
  return html`<tr>
    <td class="px-3 py-3 font-medium text-slate-900">${capability}</td>
    <td class="px-3 py-3">${badge(status, tone)}</td>
    <td class="px-3 py-3 text-slate-600">${proof}</td>
  </tr>`;
}

function capabilityMatrix(snapshot: AiRuntimeSnapshot): SafeHtml {
  return card(
    'Capability and trust matrix',
    html`<div class="overflow-x-auto">
      <table class="min-w-full text-left text-sm">
        <thead class="border-b border-slate-200 text-xs uppercase tracking-wide text-slate-500">
          <tr>
            <th class="px-3 py-2 font-medium">Capability</th>
            <th class="px-3 py-2 font-medium">Status</th>
            <th class="px-3 py-2 font-medium">Technical proof</th>
          </tr>
        </thead>
        <tbody class="divide-y divide-slate-100">
          ${capabilityRow(
            'Private local inference',
            snapshot.available ? 'Available' : 'Disabled',
            snapshot.available ? 'green' : 'amber',
            endpointScope(snapshot.baseUrl),
          )}
          ${capabilityRow(
            'Independent role routing',
            'Enabled',
            'green',
            `${snapshot.routing.intentModel} for intent, ${snapshot.routing.replyModel} for replies`,
          )}
          ${capabilityRow(
            'Deterministic action execution',
            'Enforced',
            'green',
            'Models classify or phrase but cannot execute actions',
          )}
          ${capabilityRow(
            'Consent safety gate',
            'Enforced',
            'green',
            'Publish and unpublish require deterministic agreement',
          )}
          ${capabilityRow(
            'Automatic rule fallback',
            'Enabled',
            'green',
            'Model failures return to deterministic rules',
          )}
          ${capabilityRow(
            'Content-free operations telemetry',
            'Enabled',
            'green',
            'Only model, lane, outcome, latency, and fixed metadata are buffered',
          )}
          ${capabilityRow(
            'Audited operator changes',
            'Enabled',
            'green',
            'Runtime, routing, and telemetry reset actions write audit records',
          )}
          ${capabilityRow(
            'Cloud providers',
            'Disabled',
            'slate',
            'No cloud provider configuration exists',
          )}
          ${capabilityRow(
            'Automatic cloud fallback',
            'Disabled',
            'slate',
            'No route can silently leave the private lane',
          )}
          ${capabilityRow(
            'Private RAG',
            'Not configured',
            'amber',
            'Knowledge indexing is reserved for a later controlled phase',
          )}
          ${capabilityRow(
            'Model comparison',
            'Disabled',
            'slate',
            'Parallel comparison requests are not active',
          )}
        </tbody>
      </table>
    </div>`,
  );
}

function privateDataPath(): SafeHtml {
  return card(
    'Private data path',
    html`<div class="grid gap-3 text-sm md:grid-cols-5">
      <div class="rounded-lg border border-slate-200 p-3">
        <strong class="block text-slate-900">1. SimpleX input</strong>
        <span class="text-slate-600"
          >Message enters CIND3R3LLA through the existing private bot path.</span
        >
      </div>
      <div class="rounded-lg border border-slate-200 p-3">
        <strong class="block text-slate-900">2. Deterministic guard</strong>
        <span class="text-slate-600"
          >Rules establish safety boundaries and the allowed intent catalog.</span
        >
      </div>
      <div class="rounded-lg border border-slate-200 p-3">
        <strong class="block text-slate-900">3. Private model lane</strong>
        <span class="text-slate-600">The VPS reaches Ollama over the private WireGuard route.</span>
      </div>
      <div class="rounded-lg border border-slate-200 p-3">
        <strong class="block text-slate-900">4. Guarded result</strong>
        <span class="text-slate-600"
          >Structured output is checked before CIND3R3LLA accepts it.</span
        >
      </div>
      <div class="rounded-lg border border-slate-200 p-3">
        <strong class="block text-slate-900">5. Deterministic execution</strong>
        <span class="text-slate-600"
          >Only application code can read data, confirm consent, or perform an action.</span
        >
      </div>
    </div>`,
  );
}

function overviewBody(snapshot: AiRuntimeSnapshot): SafeHtml {
  const operations = snapshot.operations;

  return html`
    ${card(
      'Operations overview',
      html`<div class="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        ${stat('Total AI requests', operations.summary.totalRequests)}
        ${stat('Successful calls', operations.summary.successes, 'green')}
        ${stat(
          'Failures',
          operations.summary.failures,
          operations.summary.failures > 0 ? 'red' : 'slate',
        )}
        ${stat(
          'Fallbacks',
          operations.summary.fallbacks,
          operations.summary.fallbacks > 0 ? 'amber' : 'slate',
        )}
        ${stat('Success rate', displayRate(operations.summary.successRate), 'green')}
        ${stat(
          'Fallback rate',
          displayRate(operations.summary.fallbackRate),
          operations.summary.fallbacks > 0 ? 'amber' : 'slate',
        )}
        ${stat('Installed models', snapshot.catalog.models.length)}
        ${stat('Stored member content', '0', 'green')}
      </div>`,
    )}
    <div class="mt-4">${capabilityMatrix(snapshot)}</div>
    <div class="mt-4">${privateDataPath()}</div>
  `;
}

function runtimeBody(snapshot: AiRuntimeSnapshot, csrf: string, query: AiPageQuery): SafeHtml {
  const requestedMode = snapshot.requestedEnabled ? 'Local AI' : 'Deterministic rules';
  const effectiveMode = snapshot.enabled ? 'Local AI' : 'Deterministic rules';
  const aligned = snapshot.requestedEnabled === snapshot.enabled;
  const probeState =
    snapshot.probe.ok === true ? 'passed' : snapshot.probe.ok === false ? 'failed' : 'not tested';
  const catalogState =
    snapshot.catalog.ok === true
      ? `${snapshot.catalog.models.length} models discovered`
      : snapshot.catalog.ok === false
        ? 'refresh failed'
        : 'not loaded';

  return html`<section class="runtime-control-page">
    <header class="setup-page-header runtime-control-header">
      <div>
        <span class="setup-eyebrow">AI Control</span>
        <h1>Runtime Control</h1>
        <p>
          Control the active inference lane, compare the stored request with the effective mode, and
          verify the private runtime boundary.
        </p>
      </div>

      <form method="post" action="/ai/test">
        <input type="hidden" name="_csrf" value="${csrf}" />
        <button type="submit" class="setup-button setup-button-primary setup-create-button">
          Test active models
        </button>
      </form>
    </header>

    ${notice(query)}

    <div class="runtime-control-status-grid">
      <article class="runtime-control-status" data-runtime-stored-state>
        <span>Stored setting</span>
        <strong>${requestedMode}</strong>
        <small>Persistent requested runtime mode</small>
      </article>
      <article class="runtime-control-status" data-runtime-effective-state>
        <span>Effective mode</span>
        <strong>${effectiveMode}</strong>
        <small>Mode currently serving requests</small>
      </article>
      <article class="runtime-control-status">
        <span>Environment gate</span>
        <strong>${snapshot.available ? 'open' : 'closed'}</strong>
        <small
          >${snapshot.available ? 'Private provider available' : 'Local AI disabled by environment'}</small
        >
      </article>
      <article class="runtime-control-status">
        <span>Active resolver</span>
        <strong>${snapshot.activeResolver}</strong>
        <small
          >${aligned ? 'Stored and active state aligned' : 'Stored and active state differ'}</small
        >
      </article>
    </div>

    <div class="runtime-control-badges">
      ${badge(aligned ? 'stored and active aligned' : 'stored and active differ', aligned ? 'green' : 'amber')}
      ${badge(`role probe ${probeState}`, snapshot.probe.ok === true ? 'green' : snapshot.probe.ok === false ? 'red' : 'slate')}
      ${badge(`catalog ${catalogState}`, snapshot.catalog.ok === true ? 'green' : snapshot.catalog.ok === false ? 'red' : 'slate')}
      ${badge(endpointScope(snapshot.baseUrl), endpointScope(snapshot.baseUrl) === 'External endpoint' ? 'amber' : 'blue')}
      ${badge('cloud fallback disabled', 'slate')}
    </div>

    <section class="runtime-control-mode-panel">
      <header class="runtime-control-section-header">
        <div>
          <span class="setup-eyebrow">Runtime mode</span>
          <h2>Select the active processing lane</h2>
          <p>
            Every change is persisted, audited, and applied immediately when its safety checks pass.
          </p>
        </div>
      </header>

      <div class="runtime-control-mode-grid">
        <article
          class="runtime-control-mode-card"
          data-runtime-mode="local"
          data-state="${snapshot.enabled ? 'active' : snapshot.requestedEnabled ? 'stored' : 'inactive'}"
        >
          <div class="runtime-control-mode-icon">AI</div>
          <div class="runtime-control-mode-copy">
            <div class="runtime-control-mode-title">
              <h3>Local AI</h3>
              ${badge(snapshot.enabled ? 'active' : snapshot.requestedEnabled ? 'stored' : 'inactive', snapshot.enabled ? 'green' : snapshot.requestedEnabled ? 'amber' : 'slate')}
            </div>
            <p>
              Use the configured private Ollama lane for intent classification and guarded replies.
            </p>

            <dl class="runtime-control-mode-facts">
              <div>
                <dt>Availability</dt>
                <dd>${snapshot.available ? 'available' : 'blocked'}</dd>
              </div>
              <div>
                <dt>Provider</dt>
                <dd>Ollama</dd>
              </div>
              <div>
                <dt>Probe</dt>
                <dd>${probeState}</dd>
              </div>
              <div>
                <dt>Fallback</dt>
                <dd>deterministic rules</dd>
              </div>
            </dl>

            <form method="post" action="/ai/runtime">
              <input type="hidden" name="_csrf" value="${csrf}" />
              <input type="hidden" name="mode" value="local" />
              <button
                type="submit"
                class="setup-button setup-button-primary"
                ${!snapshot.available || snapshot.enabled ? raw('disabled') : ''}
              >
                ${snapshot.enabled ? 'Local AI active' : 'Enable Local AI'}
              </button>
            </form>
          </div>
        </article>

        <article
          class="runtime-control-mode-card"
          data-runtime-mode="rules"
          data-state="${snapshot.enabled ? 'inactive' : 'active'}"
        >
          <div class="runtime-control-mode-icon">R</div>
          <div class="runtime-control-mode-copy">
            <div class="runtime-control-mode-title">
              <h3>Deterministic rules</h3>
              ${badge(snapshot.enabled ? 'available' : 'active', snapshot.enabled ? 'blue' : 'green')}
            </div>
            <p>
              Keep all request handling inside deterministic application rules without model
              inference.
            </p>

            <dl class="runtime-control-mode-facts">
              <div>
                <dt>Availability</dt>
                <dd>always available</dd>
              </div>
              <div>
                <dt>Provider</dt>
                <dd>application rules</dd>
              </div>
              <div>
                <dt>Network</dt>
                <dd>not required</dd>
              </div>
              <div>
                <dt>Safety</dt>
                <dd>baseline mode</dd>
              </div>
            </dl>

            <form method="post" action="/ai/runtime">
              <input type="hidden" name="_csrf" value="${csrf}" />
              <input type="hidden" name="mode" value="rules" />
              <button
                type="submit"
                class="setup-button setup-button-secondary"
                ${snapshot.enabled ? '' : raw('disabled')}
              >
                ${snapshot.enabled ? 'Use deterministic rules' : 'Rules active'}
              </button>
            </form>
          </div>
        </article>
      </div>

      <div class="runtime-control-safety-note">
        <strong>Fail closed activation</strong>
        <span>
          Local AI becomes effective only after the selected role models are confirmed. Any failure
          keeps or returns the runtime to deterministic rules.
        </span>
      </div>
    </section>

    <div class="runtime-control-secondary-grid">
      <section class="runtime-control-panel">
        <header class="runtime-control-panel-header">
          <div>
            <span class="setup-eyebrow">Health</span>
            <h2>Runtime health</h2>
          </div>
          <a href="/ai/testing" class="setup-button setup-button-quiet">Open testing</a>
        </header>

        <dl class="runtime-control-list">
          <div>
            <dt>Last role probe</dt>
            <dd>${displayTime(snapshot.probe.at)}</dd>
          </div>
          <div>
            <dt>Probe result</dt>
            <dd>${probeState}</dd>
          </div>
          <div>
            <dt>Probe latency</dt>
            <dd>${displayLatency(snapshot.probe.latencyMs)}</dd>
          </div>
          <div>
            <dt>Model catalog</dt>
            <dd>${catalogState}</dd>
          </div>
          <div>
            <dt>Intent model</dt>
            <dd>${snapshot.routing.intentModel}</dd>
          </div>
          <div>
            <dt>Reply model</dt>
            <dd>${snapshot.routing.replyModel}</dd>
          </div>
        </dl>
      </section>

      <section class="runtime-control-panel">
        <header class="runtime-control-panel-header">
          <div>
            <span class="setup-eyebrow">Boundary</span>
            <h2>Configuration boundary</h2>
          </div>
          <a href="/ai/routing" class="setup-button setup-button-quiet">Open routing</a>
        </header>

        <dl class="runtime-control-list">
          <div>
            <dt>Provider</dt>
            <dd>Ollama</dd>
          </div>
          <div>
            <dt>Endpoint scope</dt>
            <dd>${endpointScope(snapshot.baseUrl)}</dd>
          </div>
          <div>
            <dt>Browser endpoint editing</dt>
            <dd>blocked by design</dd>
          </div>
          <div>
            <dt>Automatic cloud fallback</dt>
            <dd>disabled</dd>
          </div>
          <div>
            <dt>Configuration source</dt>
            <dd>environment and persisted mode</dd>
          </div>
          <div>
            <dt>Audit action</dt>
            <dd>local-ai.toggle</dd>
          </div>
        </dl>
      </section>
    </div>

    <section class="runtime-control-activation">
      <header class="runtime-control-section-header">
        <div>
          <span class="setup-eyebrow">Activation path</span>
          <h2>What happens when Local AI is enabled</h2>
          <p>
            The stored request and effective runtime state are deliberately shown as separate facts.
          </p>
        </div>
      </header>

      <ol class="runtime-control-activation-steps">
        <li>
          <span>1</span><strong>Store request</strong
          ><small>Persist the desired runtime mode.</small>
        </li>
        <li>
          <span>2</span><strong>Verify models</strong
          ><small>Confirm every selected local role model.</small>
        </li>
        <li>
          <span>3</span><strong>Activate lane</strong
          ><small>Switch only after the private probe passes.</small>
        </li>
        <li>
          <span>4</span><strong>Audit result</strong
          ><small>Record the operator and runtime change.</small>
        </li>
      </ol>
    </section>

    <details class="setup-technical runtime-control-technical">
      <summary>Technical details</summary>
      <div class="setup-technical-content">
        <dl class="setup-technical-grid">
          <div>
            <dt>Endpoint</dt>
            <dd>${snapshot.baseUrl || 'not configured'}</dd>
          </div>
          <div>
            <dt>Timeout</dt>
            <dd>${snapshot.timeoutMs > 0 ? `${snapshot.timeoutMs} ms` : 'not configured'}</dd>
          </div>
          <div>
            <dt>Default model</dt>
            <dd>${snapshot.routing.defaultModel || 'not configured'}</dd>
          </div>
          <div>
            <dt>Requested enabled</dt>
            <dd>${snapshot.requestedEnabled ? 'true' : 'false'}</dd>
          </div>
          <div>
            <dt>Effective enabled</dt>
            <dd>${snapshot.enabled ? 'true' : 'false'}</dd>
          </div>
          <div>
            <dt>Active resolver</dt>
            <dd>${snapshot.activeResolver}</dd>
          </div>
        </dl>
      </div>
    </details>
  </section>`;
}

function routingBody(snapshot: AiRuntimeSnapshot, csrf: string, query: AiPageQuery): SafeHtml {
  const availableModels = modelNames(snapshot.catalog.models, snapshot.routing);
  const intentInfo = snapshot.catalog.models.find(
    (model) => model.name === snapshot.routing.intentModel,
  );
  const replyInfo = snapshot.catalog.models.find(
    (model) => model.name === snapshot.routing.replyModel,
  );
  const routesAligned = snapshot.routing.intentModel === snapshot.routing.replyModel;
  const catalogState =
    snapshot.catalog.ok === true
      ? `${snapshot.catalog.models.length} models available`
      : snapshot.catalog.ok === false
        ? 'catalog failed'
        : 'catalog not loaded';

  return html`<section class="ai-routing-page">
    <header class="setup-page-header">
      <div>
        <span class="setup-eyebrow">AI Control</span>
        <h1>AI Routing</h1>
        <p>
          Assign independent local models to intent classification and guarded reply wording while
          keeping execution inside deterministic application code.
        </p>
      </div>

      <form method="post" action="/ai/test">
        <input type="hidden" name="_csrf" value="${csrf}" />
        <button type="submit" class="setup-button setup-button-primary setup-create-button">
          Test active models
        </button>
      </form>
    </header>

    ${notice(query)}

    <div class="ai-routing-status-grid">
      <article class="ai-routing-status" data-routing-stored-state>
        <span>Stored intent route</span>
        <strong>${snapshot.routing.intentModel}</strong>
        <small>${intentInfo?.parameterSize ?? 'Model metadata not loaded'}</small>
      </article>
      <article class="ai-routing-status">
        <span>Stored reply route</span>
        <strong>${snapshot.routing.replyModel}</strong>
        <small>${replyInfo?.parameterSize ?? 'Model metadata not loaded'}</small>
      </article>
      <article class="ai-routing-status" data-routing-effective-state>
        <span>Effective resolver</span>
        <strong>${snapshot.activeResolver}</strong>
        <small>${snapshot.enabled ? 'Local AI active' : 'Deterministic rules active'}</small>
      </article>
      <article class="ai-routing-status">
        <span>Catalog state</span>
        <strong>${catalogState}</strong>
        <small
          >${routesAligned ? 'Both lanes share one model' : 'Independent role models active'}</small
        >
      </article>
    </div>

    <form method="post" action="/ai/routing" class="ai-routing-form">
      <input type="hidden" name="_csrf" value="${csrf}" />

      <div class="ai-routing-lane-grid">
        <article class="ai-routing-lane" data-routing-lane="intent">
          <header>
            <div class="ai-routing-lane-icon">I</div>
            <div>
              <span class="setup-eyebrow">Lane one</span>
              <h2>Intent classification</h2>
              <p>
                Classifies member text into the allowed intent catalog without executing actions.
              </p>
            </div>
          </header>

          <label class="ai-routing-select">
            <span>Intent model</span>
            ${modelSelect('intentModel', snapshot.routing.intentModel, availableModels)}
          </label>

          <dl class="ai-routing-facts">
            <div>
              <dt>Current model</dt>
              <dd>${snapshot.routing.intentModel}</dd>
            </div>
            <div>
              <dt>Family</dt>
              <dd>${intentInfo?.family ?? 'not loaded'}</dd>
            </div>
            <div>
              <dt>Parameters</dt>
              <dd>${intentInfo?.parameterSize ?? 'not loaded'}</dd>
            </div>
            <div>
              <dt>Quantization</dt>
              <dd>${intentInfo?.quantizationLevel ?? 'not loaded'}</dd>
            </div>
          </dl>

          <div class="ai-routing-boundary-note">
            <strong>Deterministic guard remains authoritative</strong>
            <span>Consent decisions and application actions are never delegated to this lane.</span>
          </div>
        </article>

        <article class="ai-routing-lane" data-routing-lane="reply">
          <header>
            <div class="ai-routing-lane-icon">R</div>
            <div>
              <span class="setup-eyebrow">Lane two</span>
              <h2>Reply wording</h2>
              <p>
                Rephrases completed read only answers while preserving required facts and literals.
              </p>
            </div>
          </header>

          <label class="ai-routing-select">
            <span>Reply model</span>
            ${modelSelect('replyModel', snapshot.routing.replyModel, availableModels)}
          </label>

          <dl class="ai-routing-facts">
            <div>
              <dt>Current model</dt>
              <dd>${snapshot.routing.replyModel}</dd>
            </div>
            <div>
              <dt>Family</dt>
              <dd>${replyInfo?.family ?? 'not loaded'}</dd>
            </div>
            <div>
              <dt>Parameters</dt>
              <dd>${replyInfo?.parameterSize ?? 'not loaded'}</dd>
            </div>
            <div>
              <dt>Quantization</dt>
              <dd>${replyInfo?.quantizationLevel ?? 'not loaded'}</dd>
            </div>
          </dl>

          <div class="ai-routing-boundary-note">
            <strong>No transport or execution access</strong>
            <span
              >This lane receives a finished draft and cannot send messages or perform
              actions.</span
            >
          </div>
        </article>
      </div>

      <footer class="ai-routing-actions">
        <div>
          <strong>Apply both lanes together</strong>
          <span>Every selected model must exist in the current Ollama catalog.</span>
        </div>
        <button type="submit" class="setup-button setup-button-primary">Apply model routing</button>
      </footer>
    </form>

    <section class="ai-routing-path">
      <header class="runtime-control-section-header">
        <div>
          <span class="setup-eyebrow">Processing path</span>
          <h2>How the two lanes cooperate</h2>
          <p>
            The selected models support the application but never replace its deterministic safety
            layer.
          </p>
        </div>
      </header>

      <ol class="ai-routing-path-steps">
        <li>
          <span>1</span><strong>Receive input</strong
          ><small>SimpleX event enters the assigned bot context.</small>
        </li>
        <li>
          <span>2</span><strong>Apply guard</strong
          ><small>Application rules define the allowed intent space.</small>
        </li>
        <li>
          <span>3</span><strong>Classify intent</strong
          ><small>The intent model returns structured classification only.</small>
        </li>
        <li>
          <span>4</span><strong>Build answer</strong
          ><small>Deterministic code prepares facts and the safe draft.</small>
        </li>
        <li>
          <span>5</span><strong>Phrase reply</strong
          ><small>The reply model may improve wording without action access.</small>
        </li>
      </ol>
    </section>

    <details class="setup-technical ai-routing-technical">
      <summary>Technical details</summary>
      <div class="setup-technical-content">
        <dl class="setup-technical-grid">
          <div>
            <dt>Environment default</dt>
            <dd>${snapshot.routing.defaultModel}</dd>
          </div>
          <div>
            <dt>Persistence</dt>
            <dd>settings table</dd>
          </div>
          <div>
            <dt>Validation source</dt>
            <dd>installed Ollama catalog</dd>
          </div>
          <div>
            <dt>Apply behavior</dt>
            <dd>immediate after persistence</dd>
          </div>
          <div>
            <dt>Missing model policy</dt>
            <dd>refuse and keep previous route</dd>
          </div>
          <div>
            <dt>Audit action</dt>
            <dd>local-ai.routing.update</dd>
          </div>
          <div>
            <dt>Cloud route</dt>
            <dd>disabled</dd>
          </div>
          <div>
            <dt>Execution access</dt>
            <dd>none</dd>
          </div>
        </dl>
      </div>
    </details>
  </section>`;
}

function hardwareBody(snapshot: AiRuntimeSnapshot, csrf: string, query: AiPageQuery): SafeHtml {
  const intentModel = snapshot.catalog.models.find(
    (model) => model.name === snapshot.routing.intentModel,
  );
  const replyModel = snapshot.catalog.models.find(
    (model) => model.name === snapshot.routing.replyModel,
  );
  const catalogState =
    snapshot.catalog.ok === true
      ? 'healthy'
      : snapshot.catalog.ok === false
        ? 'failed'
        : 'not loaded';

  return html`<section class="ai-hardware-page">
    <header class="setup-page-header">
      <div>
        <span class="setup-eyebrow">AI Control</span>
        <h1>AI Hardware</h1>
        <p>
          Inspect the hardware facts currently available through Ollama and keep every missing
          telemetry source clearly marked as not integrated.
        </p>
      </div>

      <form method="post" action="/ai/models/refresh">
        <input type="hidden" name="_csrf" value="${csrf}" />
        <button type="submit" class="setup-button setup-button-primary setup-create-button">
          Refresh hardware facts
        </button>
      </form>
    </header>

    ${notice(query)}

    <div class="ai-hardware-status-grid">
      <article class="ai-hardware-status" data-hardware-catalog-state>
        <span>Catalog state</span>
        <strong>${catalogState}</strong>
        <small>${snapshot.catalog.models.length} installed models visible</small>
      </article>
      <article class="ai-hardware-status">
        <span>Runtime mode</span>
        <strong>${snapshot.enabled ? 'Local AI' : 'Deterministic rules'}</strong>
        <small>${snapshot.activeResolver}</small>
      </article>
      <article class="ai-hardware-status">
        <span>Provider boundary</span>
        <strong>Ollama</strong>
        <small>${endpointScope(snapshot.baseUrl)}</small>
      </article>
      <article class="ai-hardware-status" data-hardware-telemetry-state>
        <span>GPU telemetry</span>
        <strong>not integrated</strong>
        <small>No utilization, temperature, or VRAM values are claimed</small>
      </article>
    </div>

    <div class="ai-hardware-main-grid">
      <section class="ai-hardware-panel">
        <header class="ai-hardware-panel-header">
          <div>
            <span class="setup-eyebrow">Active lanes</span>
            <h2>Selected model footprint</h2>
          </div>
          <a href="/ai/routing" class="setup-button setup-button-secondary">Open routing</a>
        </header>

        <div class="ai-hardware-lane-list">
          <article data-hardware-lane="intent">
            <div class="ai-hardware-lane-icon">I</div>
            <div>
              <span>Intent classification</span>
              <strong>${snapshot.routing.intentModel}</strong>
              <small>
                ${intentModel?.parameterSize ?? 'Unknown parameters'} ·
                ${intentModel?.quantizationLevel ?? 'Unknown quantization'} ·
                ${displayBytes(intentModel?.sizeBytes ?? null)}
              </small>
            </div>
          </article>

          <article data-hardware-lane="reply">
            <div class="ai-hardware-lane-icon">R</div>
            <div>
              <span>Reply wording</span>
              <strong>${snapshot.routing.replyModel}</strong>
              <small>
                ${replyModel?.parameterSize ?? 'Unknown parameters'} ·
                ${replyModel?.quantizationLevel ?? 'Unknown quantization'} ·
                ${displayBytes(replyModel?.sizeBytes ?? null)}
              </small>
            </div>
          </article>
        </div>
      </section>

      <section class="ai-hardware-panel">
        <header class="ai-hardware-panel-header">
          <div>
            <span class="setup-eyebrow">Visibility boundary</span>
            <h2>What the runtime can actually report</h2>
          </div>
        </header>

        <dl class="ai-hardware-visibility-list">
          <div>
            <dt>Installed model inventory</dt>
            <dd>available</dd>
          </div>
          <div>
            <dt>Model family and parameters</dt>
            <dd>available when Ollama reports them</dd>
          </div>
          <div>
            <dt>Model file size</dt>
            <dd>available when Ollama reports it</dd>
          </div>
          <div>
            <dt>Runtime residency</dt>
            <dd>not integrated</dd>
          </div>
          <div>
            <dt>GPU utilization</dt>
            <dd>not integrated</dd>
          </div>
          <div>
            <dt>VRAM allocation</dt>
            <dd>not integrated</dd>
          </div>
          <div>
            <dt>GPU temperature</dt>
            <dd>not integrated</dd>
          </div>
          <div>
            <dt>Inference queue depth</dt>
            <dd>not integrated</dd>
          </div>
        </dl>
      </section>
    </div>

    <section class="ai-hardware-inventory">
      <header class="runtime-control-section-header">
        <div>
          <span class="setup-eyebrow">Installed inventory</span>
          <h2>Model hardware metadata</h2>
          <p>
            Every row comes from the current Ollama catalog snapshot. No synthetic GPU values are
            added.
          </p>
        </div>
        <a href="/ai/models" class="setup-button setup-button-quiet">Open AI Models</a>
      </header>

      ${
        snapshot.catalog.models.length > 0
          ? html`<div class="ai-hardware-table-wrap">
              <table class="ai-hardware-table">
                <thead>
                  <tr>
                    <th>Model</th>
                    <th>Role</th>
                    <th>Family</th>
                    <th>Parameters</th>
                    <th>Quantization</th>
                    <th>File size</th>
                  </tr>
                </thead>
                <tbody>
                  ${snapshot.catalog.models.map((model) => {
                    const roles = modelRoleNames(model, snapshot.routing);
                    return html`<tr>
                      <td><strong>${model.name}</strong></td>
                      <td>${roles.length > 0 ? roles.join(', ') : 'unassigned'}</td>
                      <td>${model.family ?? 'unknown'}</td>
                      <td>${model.parameterSize ?? 'unknown'}</td>
                      <td>${model.quantizationLevel ?? 'unknown'}</td>
                      <td>${displayBytes(model.sizeBytes)}</td>
                    </tr>`;
                  })}
                </tbody>
              </table>
            </div>`
          : html`<div class="setup-empty">
              <span class="setup-eyebrow">Inventory unavailable</span>
              <h2>No model hardware metadata loaded</h2>
              <p>Refresh the private Ollama catalog to populate the installed model inventory.</p>
              <form method="post" action="/ai/models/refresh">
                <input type="hidden" name="_csrf" value="${csrf}" />
                <button type="submit" class="setup-button setup-button-primary">
                  Refresh hardware facts
                </button>
              </form>
            </div>`
      }
    </section>

    <section class="ai-hardware-integration">
      <header class="runtime-control-section-header">
        <div>
          <span class="setup-eyebrow">Integration plan</span>
          <h2>Hardware observability without invented values</h2>
          <p>
            Each future source must be implemented, status checked, and tested before its metrics
            appear as active.
          </p>
        </div>
      </header>

      <ol class="ai-hardware-integration-steps">
        <li>
          <span>1</span><strong>Read source</strong
          ><small>Connect a local GPU or runtime telemetry source.</small>
        </li>
        <li>
          <span>2</span><strong>Validate schema</strong
          ><small>Reject missing, malformed, or stale measurements.</small>
        </li>
        <li>
          <span>3</span><strong>Expose status</strong
          ><small>Show source health separately from reported values.</small>
        </li>
        <li>
          <span>4</span><strong>Audit controls</strong
          ><small>Any future lifecycle action requires explicit audit coverage.</small>
        </li>
      </ol>
    </section>

    <details class="setup-technical ai-hardware-technical">
      <summary>Technical details</summary>
      <div class="setup-technical-content">
        <dl class="setup-technical-grid">
          <div>
            <dt>Provider</dt>
            <dd>Ollama</dd>
          </div>
          <div>
            <dt>Catalog source</dt>
            <dd>/api/tags</dd>
          </div>
          <div>
            <dt>Catalog persistence</dt>
            <dd>process memory</dd>
          </div>
          <div>
            <dt>Endpoint scope</dt>
            <dd>${endpointScope(snapshot.baseUrl)}</dd>
          </div>
          <div>
            <dt>Browser hardware control</dt>
            <dd>not implemented</dd>
          </div>
          <div>
            <dt>Model lifecycle control</dt>
            <dd>not implemented</dd>
          </div>
          <div>
            <dt>Cloud telemetry</dt>
            <dd>disabled</dd>
          </div>
          <div>
            <dt>Member content collected</dt>
            <dd>none</dd>
          </div>
        </dl>
      </div>
    </details>
  </section>`;
}

/**
 * What several bots cost each other at one model (CCB-S5-001).
 *
 * ── WHY THIS IS ON THE TELEMETRY PAGE AND NOT THE BOT PAGE ──────────────────
 *
 * It is a fact about the MODEL, not about any one bot. The model is shared and loaded
 * once, so bots cost no VRAM; what they cost is queue time, and the number that matters is
 * how often one waited behind another. Putting it beside the other model telemetry is what
 * makes it read as a property of the shared resource.
 *
 * The wait/generate split is INFERRED and is labelled as such here, not only in the source.
 * Ollama reports neither figure and exposes no endpoint for its parallelism, so the split
 * rests on the assumption printed beside it. An operator who raises the parallelism and is
 * not told the numbers assume otherwise would read them as measurements.
 */
function modelQueueCard(botNames: Map<number, string>): SafeHtml {
  const q = modelQueue.snapshot();
  const pct = (part: number, whole: number): string =>
    whole === 0 ? '0%' : `${String(Math.round((part / whole) * 100))}%`;

  const row = (label: string, s: BotModelStats): SafeHtml => html`<tr class="border-t border-slate-200">
    <td class="py-1 pr-3 font-medium text-slate-800">${label}</td>
    <td class="py-1 pr-3 text-right">${String(s.calls)}</td>
    <td class="py-1 pr-3 text-right">${String(s.queued)}</td>
    <td class="py-1 pr-3 text-right">${meanMs(s.waitedMs, s.calls)} ms</td>
    <td class="py-1 pr-3 text-right">${meanMs(s.totalMs - s.waitedMs, s.calls)} ms</td>
    <td class="py-1 pr-3 text-right">${String(s.worstWaitMs)} ms</td>
    <td class="py-1 text-right">${pct(s.waitedMs, s.totalMs)}</td>
  </tr>`;

  return card(
    'Model queue, per bot',
    html`
      <p class="text-sm text-slate-600">
        Bots do not cost VRAM: the model is loaded once and shared. What a second bot costs
        is <strong>queue time</strong>. These are the last ${String(q.windowMinutes)} minutes.
      </p>
      <table class="mt-3 w-full text-sm">
        <thead>
          <tr class="text-xs uppercase tracking-wide text-slate-500">
            <th class="py-1 pr-3 text-left">Bot</th>
            <th class="py-1 pr-3 text-right">Calls</th>
            <th class="py-1 pr-3 text-right">Queued</th>
            <th class="py-1 pr-3 text-right">Avg wait</th>
            <th class="py-1 pr-3 text-right">Avg generate</th>
            <th class="py-1 pr-3 text-right">Worst wait</th>
            <th class="py-1 text-right">Waiting</th>
          </tr>
        </thead>
        <tbody>
          ${q.perBot.map((s) =>
            row(
              s.botProfileId === null
                ? 'unattributed'
                : (botNames.get(s.botProfileId) ?? `bot ${String(s.botProfileId)}`),
              s,
            ),
          )}
          ${q.perBot.length > 1 ? row('All bots', q.overall) : null}
          ${q.perBot.length === 0
            ? html`<tr class="border-t border-slate-200">
                <td colspan="7" class="py-2 text-slate-500">
                  No model calls in the window. This fills in as she answers; it is empty
                  after a restart and on a deployment where nothing has spoken yet.
                </td>
              </tr>`
            : null}
        </tbody>
      </table>
      <dl class="mt-3 grid grid-cols-2 gap-2 text-sm sm:grid-cols-4">
        <div><dt class="text-xs text-slate-500">Replies per minute</dt>
          <dd class="font-medium">${q.repliesPerMinute.toFixed(2)}</dd></div>
        <div><dt class="text-xs text-slate-500">In flight now</dt>
          <dd class="font-medium">${String(q.inFlight)}</dd></div>
        <div><dt class="text-xs text-slate-500">Failed calls</dt>
          <dd class="font-medium">${String(q.overall.failed)}</dd></div>
        <div><dt class="text-xs text-slate-500">Parallelism</dt>
          <dd class="font-medium">${String(q.assumedParallelism)}</dd></div>
      </dl>
      <div class="mt-3 rounded-lg border border-slate-300 bg-slate-50 px-3 py-2 text-xs text-slate-700">
        <p>
          <strong>Parallelism is the lever, and it trades VRAM for concurrency.</strong>
          At ${String(q.assumedParallelism)}, the model server runs
          ${q.assumedParallelism === 1 ? 'one request at a time' : `${String(q.assumedParallelism)} requests at once`},
          so a bot answering while another is mid-reply
          ${q.assumedParallelism === 1 ? 'waits for it to finish' : 'may still wait once every slot is busy'}.
          Raising it lets more replies overlap and costs GPU memory per extra slot; if that
          memory is not there, the model falls back to the CPU and everything gets slower.
        </p>
        <p class="mt-2">
          <strong>Wait and generate are inferred, not reported.</strong> The model server
          reports neither, and exposes no endpoint for its own parallelism. The split is
          computed from how our requests overlapped, assuming
          ${String(q.assumedParallelism)} slot(s). Calls and latency are measured exactly;
          if the server's real parallelism differs from that number, the split is wrong and
          the totals are not.
        </p>
      </div>
    `,
  );
}

function telemetryBody(
  snapshot: AiRuntimeSnapshot,
  csrf: string,
  botNames: Map<number, string>,
): SafeHtml {
  const operations = snapshot.operations;

  return html`
    <div class="mb-4">${modelQueueCard(botNames)}</div>
    <div class="grid gap-4 lg:grid-cols-2">
      ${card(
        'Intent lane telemetry',
        definitionList([
          ['Model', operations.intent.model],
          ['Requests', String(operations.intent.requests)],
          ['Successes', String(operations.intent.successes)],
          ['Failures', String(operations.intent.failures)],
          ['Fallbacks', String(operations.intent.fallbacks)],
          ['Guard overrides', String(operations.intent.guardOverrides)],
          ['Average latency', displayLatency(operations.intent.averageLatencyMs)],
          ['Last latency', displayLatency(operations.intent.lastLatencyMs)],
          ['Last success', displayTime(operations.intent.lastSuccessAt)],
          ['Last failure', displayTime(operations.intent.lastFailureAt)],
          ['Last model intent', operations.intent.lastModelIntent ?? 'Not recorded'],
          ['Last final intent', operations.intent.lastFinalIntent ?? 'Not recorded'],
        ]),
      )}
      ${card(
        'Reply lane telemetry',
        definitionList([
          ['Model', operations.reply.model],
          ['Requests', String(operations.reply.requests)],
          ['Successes', String(operations.reply.successes)],
          ['Failures', String(operations.reply.failures)],
          ['Fallbacks', String(operations.reply.fallbacks)],
          ['Average latency', displayLatency(operations.reply.averageLatencyMs)],
          ['Last latency', displayLatency(operations.reply.lastLatencyMs)],
          ['Last success', displayTime(operations.reply.lastSuccessAt)],
          ['Last failure', displayTime(operations.reply.lastFailureAt)],
          ['Last reply kind', operations.reply.lastReplyKind ?? 'Not recorded'],
          ['Last reply mode', operations.reply.lastReplyMode ?? 'Not recorded'],
          ['Last error category', operations.reply.lastErrorCategory ?? 'None'],
        ]),
      )}
    </div>
    <div class="mt-4">
      ${card(
        'Recent AI operations',
        html`
          ${activityTable(operations.recent)}
          <div class="mt-4 flex flex-wrap items-center justify-between gap-3">
            <p class="text-xs text-slate-500">
              The buffer keeps at most ${operations.summary.activityCapacity} metadata-only events.
              Member text, prompts, names, and generated replies are never stored here.
            </p>
            <form method="post" action="/ai/telemetry/reset">
              <input type="hidden" name="_csrf" value="${csrf}" />
              <button
                type="submit"
                class="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
              >
                Reset operations telemetry
              </button>
            </form>
          </div>
        `,
      )}
    </div>
  `;
}

// The Personality page moved to `ai-personality.ts` under CCB-S4-029, where it became
// an editor instead of a description of one. What stood here was a definition list
// whose own rows said "Permanent personality profile: Not configured" next to a roadmap
// of things nothing implemented.

function privacyBody(snapshot: AiRuntimeSnapshot): SafeHtml {
  return html`
    ${capabilityMatrix(snapshot)}
    <div class="mt-4">${privateDataPath()}</div>
    <div class="mt-4 grid gap-4 lg:grid-cols-2">
      ${card(
        'Privacy controls in force',
        definitionList([
          ['Inference endpoint', snapshot.baseUrl || 'Not configured'],
          ['Endpoint scope', endpointScope(snapshot.baseUrl)],
          ['Automatic cloud fallback', 'Disabled'],
          ['Cloud providers', 'Disabled'],
          ['Member content in telemetry', 'No'],
          ['Prompt content in telemetry', 'No'],
          ['Generated replies in telemetry', 'No'],
          ['Consent execution', 'Deterministic'],
        ]),
      )}
      ${card(
        'Policy roadmap',
        definitionList([
          ['Per-room AI policy', 'Not configured'],
          ['Content classification policy', 'Not configured'],
          ['External provider consent', 'Not configured'],
          ['Archive export policy', 'Local-only default planned'],
          ['RAG source permissions', 'Not configured'],
          ['Data retention windows', 'Not configured'],
          ['Operator policy overrides', 'Audit required'],
          ['Silent external routing', 'Forbidden'],
        ]),
      )}
    </div>
  `;
}

function providersBody(snapshot: AiRuntimeSnapshot): SafeHtml {
  return html`<div class="grid gap-4 lg:grid-cols-2">
    ${card(
      'Ollama provider',
      definitionList([
        ['Status', snapshot.available ? 'Available' : 'Disabled by environment'],
        ['Endpoint', snapshot.baseUrl || 'Not configured'],
        ['Endpoint scope', endpointScope(snapshot.baseUrl)],
        ['Configured model', snapshot.routing.defaultModel || 'Not configured'],
        ['Intent model', snapshot.routing.intentModel],
        ['Reply model', snapshot.routing.replyModel],
        ['Secret required', 'No'],
        ['Browser endpoint editing', 'Blocked by design'],
      ]),
    )}
    ${card(
      'External providers',
      definitionList([
        ['OpenAI', 'Disabled'],
        ['Anthropic', 'Disabled'],
        ['Automatic cloud fallback', 'Disabled'],
        ['Credentials stored', 'No'],
        ['Room permission policy', 'Not configured'],
        ['Content permission policy', 'Not configured'],
        ['Provider cost telemetry', 'Not configured'],
        ['Silent provider activation', 'Forbidden'],
      ]),
    )}
  </div>`;
}

function testingBody(snapshot: AiRuntimeSnapshot, csrf: string): SafeHtml {
  return html`<div class="grid gap-4 lg:grid-cols-2">
    ${card(
      'Active model probe',
      html`
        ${definitionList([
          ['Last role probe', displayTime(snapshot.probe.at)],
          ['Probe latency', displayLatency(snapshot.probe.latencyMs)],
          [
            'Selected models present',
            snapshot.probe.modelPresent === null
              ? 'Not tested'
              : snapshot.probe.modelPresent
                ? 'Yes'
                : 'No',
          ],
          ['Last probe error', snapshot.probe.error ?? 'None'],
        ])}
        <form method="post" action="/ai/test" class="mt-4">
          <input type="hidden" name="_csrf" value="${csrf}" />
          <button
            type="submit"
            class="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
          >
            Test active role models
          </button>
        </form>
      `,
    )}
    ${card(
      'Testing roadmap',
      definitionList([
        ['Structured prompt tests', 'Not configured'],
        ['Bilingual test suites', 'Offline verifier available'],
        ['Model comparison', 'Disabled'],
        ['Parallel provider requests', 'Disabled'],
        ['Quality scoring', 'Not configured'],
        ['Latency comparison', 'Not configured'],
        ['SimpleX message sending', 'Never used by admin tests'],
        ['Consent execution', 'Never used by admin tests'],
      ]),
    )}
  </div>`;
}

function auditBody(): SafeHtml {
  return html`
    ${card(
      'AI audit coverage',
      definitionList([
        ['local-ai.toggle', 'Runtime mode changes'],
        ['local-ai.routing.update', 'Intent and reply model changes'],
        ['local-ai.telemetry.reset', 'Operations telemetry reset'],
        ['Actor identity', 'Recorded'],
        ['Mutation timestamp', 'Recorded by the audit store'],
        ['Model prompts', 'Not recorded'],
        ['Member content', 'Not recorded'],
        ['Dedicated AI audit viewer', 'Planned'],
      ]),
    )}
    <div class="mt-4">
      ${card(
        'Audit design boundary',
        html`<p class="text-sm text-slate-700">
          Operator changes are already written to the central CIND3R3LLA audit log. This page shows
          the covered action types without duplicating sensitive data. A filtered AI audit table
          with search, time range, actor, and action filters will be added as its own controlled
          phase.
        </p>`,
      )}
    </div>
  `;
}

export function registerAi(app: FastifyInstance, ctx: ViewContext): void {
  app.get('/ai', async (_req, reply) => reply.redirect('/ai/overview'));

  app.get<{ Querystring: AiPageQuery }>('/ai/overview', async (req, reply) => {
    const snapshot = aiRuntimeSnapshot();
    reply.type('text/html');
    return renderAiPage(
      'AI Overview',
      'Executive status, trust signals, active capabilities, and the private data path.',
      'ai:overview',
      req.session?.csrfToken ?? '',
      req.query,
      snapshot,
      overviewBody(snapshot),
    );
  });

  app.get<{ Querystring: AiPageQuery }>('/ai/runtime', async (req, reply) => {
    const snapshot = aiRuntimeSnapshot();
    const csrf = req.session?.csrfToken ?? '';
    reply.type('text/html');

    return page({
      title: 'Runtime Control',
      active: 'ai:runtime',
      csrfToken: csrf,
      body: runtimeBody(snapshot, csrf, req.query),
    });
  });

  app.get<{ Querystring: AiPageQuery }>('/ai/models', async (req, reply) => {
    const snapshot = aiRuntimeSnapshot();
    const csrf = req.session?.csrfToken ?? '';
    reply.type('text/html');

    return page({
      title: 'AI Models',
      active: 'ai:models',
      csrfToken: csrf,
      head: html`<script src="/assets/admin-model-catalog.js" defer></script>`,
      body: modelsBody(snapshot, csrf, req.query),
    });
  });

  app.get<{ Querystring: AiPageQuery }>('/ai/routing', async (req, reply) => {
    const snapshot = aiRuntimeSnapshot();
    const csrf = req.session?.csrfToken ?? '';
    reply.type('text/html');

    return page({
      title: 'AI Routing',
      active: 'ai:routing',
      csrfToken: csrf,
      body: routingBody(snapshot, csrf, req.query),
    });
  });

  app.get<{ Querystring: AiPageQuery }>('/ai/hardware', async (req, reply) => {
    const snapshot = aiRuntimeSnapshot();
    const csrf = req.session?.csrfToken ?? '';
    reply.type('text/html');

    return page({
      title: 'AI Hardware',
      active: 'ai:hardware',
      csrfToken: csrf,
      body: hardwareBody(snapshot, csrf, req.query),
    });
  });

  app.get<{ Querystring: AiPageQuery }>('/ai/telemetry', async (req, reply) => {
    const snapshot = aiRuntimeSnapshot();
    const csrf = req.session?.csrfToken ?? '';
    // Named rather than numbered: "bot 2 waited 900 ms" is a fact nobody can act on.
    const botNames = new Map(
      (await listBotOnboardingProfiles(ctx.db)).map((p) => [p.id, p.displayName]),
    );
    reply.type('text/html');
    return renderAiPage(
      'AI Telemetry',
      'Content-free intent, reply, fallback, latency, and recent operations telemetry.',
      'ai:telemetry',
      csrf,
      req.query,
      snapshot,
      telemetryBody(snapshot, csrf, botNames),
    );
  });

  app.get<{ Querystring: AiPageQuery }>('/ai/privacy', async (req, reply) => {
    const snapshot = aiRuntimeSnapshot();
    reply.type('text/html');
    return renderAiPage(
      'AI Privacy and Safety',
      'Local data routes, deterministic consent, telemetry limits, and future room policies.',
      'ai:privacy',
      req.session?.csrfToken ?? '',
      req.query,
      snapshot,
      privacyBody(snapshot),
    );
  });

  app.get<{ Querystring: AiPageQuery }>('/ai/providers', async (req, reply) => {
    const snapshot = aiRuntimeSnapshot();
    reply.type('text/html');
    return renderAiPage(
      'AI Providers',
      'Configured local provider, disabled external providers, and provider privacy boundaries.',
      'ai:providers',
      req.session?.csrfToken ?? '',
      req.query,
      snapshot,
      providersBody(snapshot),
    );
  });

  // `/ai/knowledge` IS THE KNOWLEDGE BASE NOW (CCB-S5-024). This was a placeholder page
  // describing "future retrieval controls", laid out when the menu was; the real thing lands
  // on it rather than beside it, and `src/web/views/knowledge.ts` registers the route.
  // Removing the placeholder rather than leaving it behind a second URL is the point: two
  // pages about knowledge is the duplication this move exists to end.

  app.get<{ Querystring: AiPageQuery }>('/ai/testing', async (req, reply) => {
    const snapshot = aiRuntimeSnapshot();
    const csrf = req.session?.csrfToken ?? '';
    reply.type('text/html');
    return renderAiPage(
      'AI Testing and Compare',
      'Safe model probes, offline regression coverage, and future comparison workflows.',
      'ai:testing',
      csrf,
      req.query,
      snapshot,
      testingBody(snapshot, csrf),
    );
  });

  app.get<{ Querystring: AiPageQuery }>('/ai/audit', async (req, reply) => {
    const snapshot = aiRuntimeSnapshot();
    reply.type('text/html');
    return renderAiPage(
      'AI Audit',
      'Existing audited operator actions and the boundary for a future filtered AI audit viewer.',
      'ai:audit',
      req.session?.csrfToken ?? '',
      req.query,
      snapshot,
      auditBody(),
    );
  });

  app.post<{ Body: Record<string, unknown> }>('/ai/runtime', async (req, reply) => {
    const mode = typeof req.body['mode'] === 'string' ? req.body['mode'] : '';
    const actor = req.session?.username ?? 'unknown';

    if (mode !== 'local' && mode !== 'rules') {
      return reply.redirect('/ai/runtime?error=' + encodeURIComponent('Invalid runtime mode.'));
    }

    try {
      await setAiRuntimeEnabled(mode === 'local', actor);
      return reply.redirect('/ai/runtime?saved=1');
    } catch (error) {
      return reply.redirect('/ai/runtime?error=' + encodeURIComponent(errorMessage(error)));
    }
  });

  app.post<{ Body: Record<string, unknown> }>('/ai/routing', async (req, reply) => {
    const intentModel = typeof req.body['intentModel'] === 'string' ? req.body['intentModel'] : '';
    const replyModel = typeof req.body['replyModel'] === 'string' ? req.body['replyModel'] : '';
    const actor = req.session?.username ?? 'unknown';

    try {
      await setAiModelRouting(intentModel, replyModel, actor);
      return reply.redirect('/ai/routing?routed=1');
    } catch (error) {
      return reply.redirect('/ai/routing?error=' + encodeURIComponent(errorMessage(error)));
    }
  });

  app.post('/ai/telemetry/reset', async (req, reply) => {
    try {
      await resetAiOperationsTelemetry(req.session?.username ?? 'unknown');
      return reply.redirect('/ai/telemetry?reset=1');
    } catch (error) {
      return reply.redirect('/ai/telemetry?error=' + encodeURIComponent(errorMessage(error)));
    }
  });

  app.post('/ai/test', async (_req, reply) => {
    try {
      await testAiRuntimeConnection();
      return reply.redirect('/ai/testing?tested=1');
    } catch (error) {
      return reply.redirect('/ai/testing?error=' + encodeURIComponent(errorMessage(error)));
    }
  });

  app.post('/ai/models/refresh', async (_req, reply) => {
    try {
      await refreshAiModelCatalog();
      return reply.redirect('/ai/models?refreshed=1');
    } catch (error) {
      return reply.redirect('/ai/models?error=' + encodeURIComponent(errorMessage(error)));
    }
  });
}
