/**
 * AI Operations Center for Cinderella.
 *
 * This surface exposes local runtime control, role routing, model inventory, content-free telemetry,
 * a recent operations buffer, and the safety boundaries around private inference.
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
} from '../../interaction/ai-runtime.js';
import { html, page, raw, type SafeHtml } from '../html.js';
import type { ViewContext } from '../server.js';
import { badge, card, pageHeader, stat } from './ui.js';

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

function modelTable(models: AiModelInfo[], routing: AiModelRoutingSnapshot): SafeHtml {
  if (models.length === 0) {
    return html`<p class="text-sm text-slate-500">
      No model inventory has been loaded yet. Refresh the catalog to read the local Ollama node.
    </p>`;
  }

  return html`<div class="overflow-x-auto">
    <table class="min-w-full text-left text-sm">
      <thead class="border-b border-slate-200 text-xs uppercase tracking-wide text-slate-500">
        <tr>
          <th class="px-3 py-2 font-medium">Model</th>
          <th class="px-3 py-2 font-medium">Size</th>
          <th class="px-3 py-2 font-medium">Family</th>
          <th class="px-3 py-2 font-medium">Parameters</th>
          <th class="px-3 py-2 font-medium">Quantization</th>
          <th class="px-3 py-2 font-medium">Modified</th>
        </tr>
      </thead>
      <tbody class="divide-y divide-slate-100">
        ${models.map(
          (model) =>
            html`<tr>
              <td class="px-3 py-3 font-medium text-slate-900">
                <div class="flex flex-wrap items-center gap-2">
                  <span>${model.name}</span>
                  ${model.name === routing.intentModel ? badge('Intent', 'blue') : null}
                  ${model.name === routing.replyModel ? badge('Reply', 'green') : null}
                  ${model.name === routing.defaultModel ? badge('Env default', 'slate') : null}
                </div>
              </td>
              <td class="px-3 py-3 text-slate-600">${displayBytes(model.sizeBytes)}</td>
              <td class="px-3 py-3 text-slate-600">${model.family ?? 'Unknown'}</td>
              <td class="px-3 py-3 text-slate-600">${model.parameterSize ?? 'Unknown'}</td>
              <td class="px-3 py-3 text-slate-600">${model.quantizationLevel ?? 'Unknown'}</td>
              <td class="px-3 py-3 text-slate-600">${displayTime(model.modifiedAt)}</td>
            </tr>`,
        )}
      </tbody>
    </table>
  </div>`;
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

export function registerAi(app: FastifyInstance, _ctx: ViewContext): void {
  app.get<{
    Querystring: {
      saved?: string;
      tested?: string;
      refreshed?: string;
      routed?: string;
      reset?: string;
      error?: string;
    };
  }>('/ai', async (req, reply) => {
    const snapshot = aiRuntimeSnapshot();
    const csrf = req.session?.csrfToken ?? '';
    const availableModels = modelNames(snapshot.catalog.models, snapshot.routing);
    const operations = snapshot.operations;

    const notice = req.query.reset
      ? html`<div
          class="mb-4 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800"
        >
          In-memory AI telemetry and the recent operations buffer were cleared.
        </div>`
      : req.query.routed
        ? html`<div
            class="mb-4 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800"
          >
            Model routing updated. New intent and reply requests use the selected local lanes.
          </div>`
        : req.query.refreshed
          ? html`<div
              class="mb-4 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800"
            >
              Model catalog refreshed from the configured Ollama endpoint.
            </div>`
          : req.query.tested
            ? html`<div
                class="mb-4 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800"
              >
                Role probe passed. Every selected local model is online and available.
              </div>`
            : req.query.saved
              ? html`<div
                  class="mb-4 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800"
                >
                  Runtime mode updated. The new route is active without a service restart.
                </div>`
              : req.query.error
                ? html`<div
                    class="mb-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700"
                  >
                    ${req.query.error}
                  </div>`
                : null;

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

    reply.type('text/html');

    return page({
      title: 'AI Operations',
      active: 'ai',
      csrfToken: csrf,
      body: html`
        ${pageHeader(
          'AI Operations Center',
          'Private model routing, operational telemetry, inventory, trust signals, and the safety perimeter around Cinderella.',
        )}
        ${notice}

        <div class="mb-4 flex flex-wrap gap-2">
          ${badge(runtimeLabel, runtimeTone)}
          ${badge(snapshot.available ? 'Environment gate open' : 'Environment gate closed', snapshot.available ? 'blue' : 'amber')}
          ${badge(probeLabel, probeTone)} ${badge(catalogLabel, catalogTone)}
          ${badge(endpointScope(snapshot.baseUrl), endpointScope(snapshot.baseUrl) === 'External endpoint' ? 'amber' : 'slate')}
          ${badge('Content-free telemetry', 'green')} ${badge('Cloud fallback disabled', 'slate')}
        </div>

        ${card(
          'Operations overview',
          html`<div class="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            ${stat('Total AI requests', operations.summary.totalRequests)}
            ${stat('Successful calls', operations.summary.successes, 'green')}
            ${stat('Failures', operations.summary.failures, operations.summary.failures > 0 ? 'red' : 'slate')}
            ${stat('Fallbacks', operations.summary.fallbacks, operations.summary.fallbacks > 0 ? 'amber' : 'slate')}
            ${stat('Success rate', displayRate(operations.summary.successRate), 'green')}
            ${stat('Fallback rate', displayRate(operations.summary.fallbackRate), operations.summary.fallbacks > 0 ? 'amber' : 'slate')}
            ${stat('Installed models', snapshot.catalog.models.length)}
            ${stat('Stored member content', '0', 'green')}
          </div>`,
        )}

        <div class="mt-4 grid gap-4 lg:grid-cols-2">
          ${card(
            'Intent lane telemetry',
            html`
              ${definitionList([
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
              ])}
            `,
          )}
          ${card(
            'Reply lane telemetry',
            html`
              ${definitionList([
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
              ])}
            `,
          )}
        </div>

        ${card(
          'Recent AI operations',
          html`
            ${activityTable(operations.recent)}
            <div class="mt-4 flex flex-wrap items-center justify-between gap-3">
              <p class="text-xs text-slate-500">
                The buffer keeps at most ${operations.summary.activityCapacity} metadata-only
                events. Member text, prompts, names, and generated replies are never stored here.
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
          'mt-4',
        )}

        <div class="mt-4 grid gap-4 lg:grid-cols-2">
          ${card(
            'Runtime lane',
            html`
              ${definitionList([
                [
                  'Environment availability',
                  snapshot.available ? 'Available' : 'Disabled by environment',
                ],
                ['Requested mode', snapshot.requestedEnabled ? 'Local AI' : 'Deterministic rules'],
                ['Effective mode', snapshot.enabled ? 'Local AI' : 'Deterministic rules'],
                ['Active resolver', snapshot.activeResolver],
              ])}

              <form method="post" action="/ai/runtime" class="mt-4 flex flex-wrap gap-2">
                <input type="hidden" name="_csrf" value="${csrf}" />
                <button
                  type="submit"
                  name="mode"
                  value="local"
                  class="rounded-lg bg-slate-900 px-3 py-2 text-sm font-medium text-white hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-50"
                  ${snapshot.available ? '' : 'disabled'}
                >
                  Enable Local AI
                </button>
                <button
                  type="submit"
                  name="mode"
                  value="rules"
                  class="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
                >
                  Use deterministic rules
                </button>
              </form>

              <p class="mt-3 text-xs text-slate-500">
                Enabling is fail-closed. Cinderella verifies every selected role model before
                switching away from rules.
              </p>
            `,
          )}
          ${card(
            'Model connection',
            html`
              ${definitionList([
                ['Provider', 'Ollama'],
                ['Endpoint', snapshot.baseUrl || 'Not configured'],
                ['Environment default', snapshot.routing.defaultModel || 'Not configured'],
                ['Timeout', snapshot.timeoutMs > 0 ? `${snapshot.timeoutMs} ms` : 'Not configured'],
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
        </div>

        <div class="mt-4 grid gap-4 lg:grid-cols-2">
          ${card(
            'Model role routing',
            html`
              <form method="post" action="/ai/routing" class="flex flex-col gap-4">
                <input type="hidden" name="_csrf" value="${csrf}" />
                <label class="flex flex-col gap-1 text-sm">
                  <span class="font-medium text-slate-700">Intent classification model</span>
                  ${modelSelect('intentModel', snapshot.routing.intentModel, availableModels)}
                  <span class="text-xs text-slate-500">
                    Classifies member text only. Consent actions still require deterministic
                    agreement.
                  </span>
                </label>
                <label class="flex flex-col gap-1 text-sm">
                  <span class="font-medium text-slate-700">Reply wording model</span>
                  ${modelSelect('replyModel', snapshot.routing.replyModel, availableModels)}
                  <span class="text-xs text-slate-500">
                    Rephrases finished read-only replies. It receives no execution or transport
                    access.
                  </span>
                </label>
                <button
                  type="submit"
                  class="self-start rounded-lg bg-slate-900 px-3 py-2 text-sm font-medium text-white hover:bg-slate-700"
                >
                  Apply model routing
                </button>
              </form>
              <p class="mt-3 text-xs text-slate-500">
                Saving refreshes the local inventory and refuses missing models. No cloud route is
                created.
              </p>
            `,
          )}
          ${card(
            'Operational envelope',
            definitionList([
              ['Metrics persistence', 'In memory until process restart'],
              ['Activity capacity', `${operations.summary.activityCapacity} metadata events`],
              ['Member content retained', 'No'],
              ['Prompt content retained', 'No'],
              ['Automatic cloud fallback', 'Disabled'],
              ['Cloud providers', 'Disabled'],
              ['Private RAG', 'Not configured'],
              ['Comparison lane', 'Disabled'],
            ]),
          )}
        </div>

        <div class="mt-4 grid gap-4 lg:grid-cols-2">
          ${card(
            'Catalog status',
            html`
              ${definitionList([
                ['Last refresh', displayTime(snapshot.catalog.at)],
                ['Discovery latency', displayLatency(snapshot.catalog.latencyMs)],
                ['Installed models', String(snapshot.catalog.models.length)],
                ['Last discovery error', snapshot.catalog.error ?? 'None'],
              ])}
              <form method="post" action="/ai/models/refresh" class="mt-4">
                <input type="hidden" name="_csrf" value="${csrf}" />
                <button
                  type="submit"
                  class="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
                >
                  Refresh model catalog
                </button>
              </form>
              <p class="mt-3 text-xs text-slate-500">
                Discovery reads metadata from the configured local endpoint. It does not pull,
                remove, or switch a model.
              </p>
            `,
          )}
          ${card(
            'Active route summary',
            definitionList([
              ['Intent model', snapshot.routing.intentModel],
              ['Reply model', snapshot.routing.replyModel],
              ['Environment default', snapshot.routing.defaultModel],
              ['Resolver state', snapshot.activeResolver],
              ['Last AI activity', displayTime(operations.summary.lastActivityAt)],
              ['Endpoint scope', endpointScope(snapshot.baseUrl)],
            ]),
          )}
        </div>

        ${card(
          'Installed Ollama models',
          modelTable(snapshot.catalog.models, snapshot.routing),
          'mt-4',
        )}
        ${card(
          'Capability and trust matrix',
          html`<div class="overflow-x-auto">
            <table class="min-w-full text-left text-sm">
              <thead
                class="border-b border-slate-200 text-xs uppercase tracking-wide text-slate-500"
              >
                <tr>
                  <th class="px-3 py-2 font-medium">Capability</th>
                  <th class="px-3 py-2 font-medium">Status</th>
                  <th class="px-3 py-2 font-medium">Technical proof</th>
                </tr>
              </thead>
              <tbody class="divide-y divide-slate-100">
                ${capabilityRow('Private local inference', snapshot.available ? 'Available' : 'Disabled', snapshot.available ? 'green' : 'amber', endpointScope(snapshot.baseUrl))}
                ${capabilityRow('Independent role routing', 'Enabled', 'green', `${snapshot.routing.intentModel} for intent, ${snapshot.routing.replyModel} for replies`)}
                ${capabilityRow('Deterministic action execution', 'Enforced', 'green', 'Models classify or phrase but cannot execute actions')}
                ${capabilityRow('Consent safety gate', 'Enforced', 'green', 'Publish and unpublish require deterministic agreement')}
                ${capabilityRow('Automatic rule fallback', 'Enabled', 'green', 'Model failures return to deterministic rules')}
                ${capabilityRow('Content-free operations telemetry', 'Enabled', 'green', 'Only model, lane, outcome, latency, and fixed metadata are buffered')}
                ${capabilityRow('Audited operator changes', 'Enabled', 'green', 'Runtime, routing, and telemetry reset actions write audit records')}
                ${capabilityRow('Cloud providers', 'Disabled', 'slate', 'No cloud provider configuration exists')}
                ${capabilityRow('Automatic cloud fallback', 'Disabled', 'slate', 'No route can silently leave the private lane')}
                ${capabilityRow('Private RAG', 'Not configured', 'amber', 'Knowledge indexing is reserved for a later controlled phase')}
                ${capabilityRow('Model comparison', 'Disabled', 'slate', 'Parallel comparison requests are not active')}
              </tbody>
            </table>
          </div>`,
          'mt-4',
        )}
        ${card(
          'Private data path',
          html`<div class="grid gap-3 text-sm md:grid-cols-5">
            <div class="rounded-lg border border-slate-200 p-3">
              <strong class="block text-slate-900">1. SimpleX input</strong>
              <span class="text-slate-600"
                >Message enters Cinderella through the existing private bot path.</span
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
              <span class="text-slate-600"
                >The VPS reaches Ollama over the private WireGuard route.</span
              >
            </div>
            <div class="rounded-lg border border-slate-200 p-3">
              <strong class="block text-slate-900">4. Guarded result</strong>
              <span class="text-slate-600"
                >Structured output is checked before Cinderella accepts it.</span
              >
            </div>
            <div class="rounded-lg border border-slate-200 p-3">
              <strong class="block text-slate-900">5. Deterministic execution</strong>
              <span class="text-slate-600"
                >Only application code can read data, confirm consent, or perform an action.</span
              >
            </div>
          </div>`,
          'mt-4',
        )}
        ${
          snapshot.probe.error
            ? card(
                'Last probe failure',
                html`<p class="break-words text-sm text-red-700">${snapshot.probe.error}</p>`,
                'mt-4 border-red-200',
              )
            : null
        }
      `,
    });
  });

  app.post<{ Body: Record<string, unknown> }>('/ai/runtime', async (req, reply) => {
    const mode = typeof req.body['mode'] === 'string' ? req.body['mode'] : '';
    const actor = req.session?.username ?? 'unknown';

    if (mode !== 'local' && mode !== 'rules') {
      return reply.redirect('/ai?error=' + encodeURIComponent('Invalid runtime mode.'));
    }

    try {
      await setAiRuntimeEnabled(mode === 'local', actor);
      return reply.redirect('/ai?saved=1');
    } catch (error) {
      return reply.redirect('/ai?error=' + encodeURIComponent(errorMessage(error)));
    }
  });

  app.post<{ Body: Record<string, unknown> }>('/ai/routing', async (req, reply) => {
    const intentModel = typeof req.body['intentModel'] === 'string' ? req.body['intentModel'] : '';
    const replyModel = typeof req.body['replyModel'] === 'string' ? req.body['replyModel'] : '';
    const actor = req.session?.username ?? 'unknown';

    try {
      await setAiModelRouting(intentModel, replyModel, actor);
      return reply.redirect('/ai?routed=1');
    } catch (error) {
      return reply.redirect('/ai?error=' + encodeURIComponent(errorMessage(error)));
    }
  });

  app.post('/ai/telemetry/reset', async (req, reply) => {
    try {
      await resetAiOperationsTelemetry(req.session?.username ?? 'unknown');
      return reply.redirect('/ai?reset=1');
    } catch (error) {
      return reply.redirect('/ai?error=' + encodeURIComponent(errorMessage(error)));
    }
  });

  app.post('/ai/test', async (_req, reply) => {
    try {
      await testAiRuntimeConnection();
      return reply.redirect('/ai?tested=1');
    } catch (error) {
      return reply.redirect('/ai?error=' + encodeURIComponent(errorMessage(error)));
    }
  });

  app.post('/ai/models/refresh', async (_req, reply) => {
    try {
      await refreshAiModelCatalog();
      return reply.redirect('/ai?refreshed=1');
    } catch (error) {
      return reply.redirect('/ai?error=' + encodeURIComponent(errorMessage(error)));
    }
  });
}
