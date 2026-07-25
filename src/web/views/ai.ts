/**
 * Dedicated AI control center for Cinderella.
 *
 * This surface exposes the runtime switch, role routing, model probe, installed model catalog,
 * resolver telemetry, and the safety boundary around local inference. Provider credentials and
 * boot secrets never enter this view.
 */

import type { FastifyInstance } from 'fastify';
import {
  aiRuntimeSnapshot,
  refreshAiModelCatalog,
  setAiModelRouting,
  setAiRuntimeEnabled,
  testAiRuntimeConnection,
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

export function registerAi(app: FastifyInstance, _ctx: ViewContext): void {
  app.get<{
    Querystring: {
      saved?: string;
      tested?: string;
      refreshed?: string;
      routed?: string;
      error?: string;
    };
  }>('/ai', async (req, reply) => {
    const snapshot = aiRuntimeSnapshot();
    const csrf = req.session?.csrfToken ?? '';
    const availableModels = modelNames(snapshot.catalog.models, snapshot.routing);

    const notice = req.query.routed
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
      title: 'AI Control',
      active: 'ai',
      csrfToken: csrf,
      body: html`
        ${pageHeader(
          'AI Control',
          'Runtime routing, local model inventory, telemetry, and the safety perimeter around Cinderella.',
        )}
        ${notice}

        <div class="mb-4 flex flex-wrap gap-2">
          ${badge(runtimeLabel, runtimeTone)}
          ${badge(snapshot.available ? 'Environment gate open' : 'Environment gate closed', snapshot.available ? 'blue' : 'amber')}
          ${badge(probeLabel, probeTone)} ${badge(catalogLabel, catalogTone)}
          ${badge(endpointScope(snapshot.baseUrl), endpointScope(snapshot.baseUrl) === 'External endpoint' ? 'amber' : 'slate')}
        </div>

        <div class="grid gap-4 lg:grid-cols-2">
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
            'Future lanes',
            definitionList([
              ['Private RAG', 'Not configured'],
              ['Comparison lane', 'Disabled'],
              ['Cloud provider', 'Disabled'],
              ['Automatic cloud fallback', 'Disabled'],
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
            ]),
          )}
        </div>

        ${card(
          'Installed Ollama models',
          modelTable(snapshot.catalog.models, snapshot.routing),
          'mt-4',
        )}

        <div class="mt-4 grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
          ${stat('Intent requests', snapshot.metrics.requests)}
          ${stat('Successful calls', snapshot.metrics.successes, 'green')}
          ${stat('Failures', snapshot.metrics.failures, snapshot.metrics.failures > 0 ? 'red' : 'slate')}
          ${stat('Automatic fallbacks', snapshot.metrics.fallbacks, snapshot.metrics.fallbacks > 0 ? 'amber' : 'slate')}
          ${stat('Guard overrides', snapshot.metrics.guardOverrides, snapshot.metrics.guardOverrides > 0 ? 'blue' : 'slate')}
        </div>

        <div class="mt-4 grid gap-4 lg:grid-cols-2">
          ${card(
            'Intent telemetry',
            definitionList([
              ['Average latency', displayLatency(snapshot.metrics.averageLatencyMs)],
              ['Last latency', displayLatency(snapshot.metrics.lastLatencyMs)],
              ['Last success', displayTime(snapshot.metrics.lastSuccessAt)],
              ['Last failure', displayTime(snapshot.metrics.lastFailureAt)],
              ['Last model intent', snapshot.metrics.lastModelIntent ?? 'Not recorded'],
              ['Last final intent', snapshot.metrics.lastFinalIntent ?? 'Not recorded'],
              ['Last error', snapshot.metrics.lastError ?? 'None'],
            ]),
          )}
          ${card(
            'Safety perimeter',
            html`<ul class="space-y-2 text-sm text-slate-700">
              <li>
                <strong>Local-only routing:</strong> role changes are limited to models discovered
                on the configured private Ollama endpoint.
              </li>
              <li>
                <strong>Deterministic execution:</strong> the intent model classifies, but it never
                performs an action.
              </li>
              <li>
                <strong>Consent boundary:</strong> publish, unpublish, undo, and confirmation flows
                remain deterministic.
              </li>
              <li>
                <strong>Reply isolation:</strong> the wording model can only rewrite a finished,
                guarded reply.
              </li>
              <li>
                <strong>Automatic fallback:</strong> timeouts, malformed output, unsafe wording, and
                model failures return to rules.
              </li>
            </ul>`,
          )}
        </div>

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
