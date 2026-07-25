/**
 * Runtime control, role routing, model discovery, and in-memory telemetry for private Ollama.
 *
 * Environment configuration decides whether local AI is available at all. Persisted settings
 * decide whether this process uses local AI and which installed model serves each supported role.
 * Enabling and routing changes are fail-closed because the selected models are verified before
 * the active resolver is changed.
 */

import type { LocalAiConfig } from '../config.js';
import { writeAudit } from '../db/audit.js';
import type { Queryable } from '../db/pool.js';
import { getSetting, setSetting } from '../db/settings.js';
import { log } from '../log.js';
import type { Intent } from './intent.js';
import {
  createOllamaIntentResolver,
  type FetchLike,
  type OllamaResolveFailure,
  type OllamaResolveSuccess,
  type OllamaResolverObserver,
} from './ollama-resolver.js';
import { generateOllamaReply, type AiReplyRequest } from './ollama-reply.js';
import { activeResolverName, resetIntentResolver, setIntentResolver } from './resolver.js';

const RUNTIME_KEY = 'local-ai-runtime';
const ROUTING_KEY = 'local-ai-model-routing';

interface StoredRuntimeSettings {
  enabled: boolean;
}

interface StoredRoutingSettings {
  intentModel: string;
  replyModel: string;
}

export interface AiRuntimeMetrics {
  requests: number;
  successes: number;
  failures: number;
  fallbacks: number;
  guardOverrides: number;
  averageLatencyMs: number | null;
  lastLatencyMs: number | null;
  lastSuccessAt: string | null;
  lastFailureAt: string | null;
  lastModelIntent: Intent | null;
  lastFinalIntent: Intent | null;
  lastError: string | null;
}

export interface AiProbeSnapshot {
  at: string | null;
  ok: boolean | null;
  latencyMs: number | null;
  modelPresent: boolean | null;
  error: string | null;
}

export interface AiModelInfo {
  name: string;
  sizeBytes: number | null;
  modifiedAt: string | null;
  family: string | null;
  parameterSize: string | null;
  quantizationLevel: string | null;
}

export interface AiModelCatalogSnapshot {
  at: string | null;
  ok: boolean | null;
  latencyMs: number | null;
  models: AiModelInfo[];
  error: string | null;
}

export interface AiModelRoutingSnapshot {
  defaultModel: string;
  intentModel: string;
  replyModel: string;
}

export interface AiRuntimeSnapshot {
  available: boolean;
  requestedEnabled: boolean;
  enabled: boolean;
  activeResolver: string;
  baseUrl: string;
  model: string;
  timeoutMs: number;
  routing: AiModelRoutingSnapshot;
  metrics: AiRuntimeMetrics;
  probe: AiProbeSnapshot;
  catalog: AiModelCatalogSnapshot;
}

export interface AiRuntimeDeps {
  fetchImpl?: FetchLike;
  now?: () => Date;
}

interface MutableMetrics {
  requests: number;
  successes: number;
  failures: number;
  fallbacks: number;
  guardOverrides: number;
  totalLatencyMs: number;
  lastLatencyMs: number | null;
  lastSuccessAt: string | null;
  lastFailureAt: string | null;
  lastModelIntent: Intent | null;
  lastFinalIntent: Intent | null;
  lastError: string | null;
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function storedPreference(value: unknown, fallback: boolean): boolean {
  const enabled = record(value)['enabled'];
  return typeof enabled === 'boolean' ? enabled : fallback;
}

function cleanModelName(value: unknown, fallback: string): string {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : fallback;
}

function storedRouting(value: unknown, fallback: string): StoredRoutingSettings {
  const raw = record(value);

  return {
    intentModel: cleanModelName(raw['intentModel'], fallback),
    replyModel: cleanModelName(raw['replyModel'], fallback),
  };
}

function optionalString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : null;
}

function optionalNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
}

function modelCatalog(value: unknown): AiModelInfo[] {
  const models = record(value)['models'];
  if (!Array.isArray(models)) throw new Error('Ollama returned an invalid model list.');

  return models
    .map((entry): AiModelInfo | null => {
      const item = record(entry);
      const details = record(item['details']);
      const name = optionalString(item['name'] ?? item['model']);

      if (!name) return null;

      return {
        name,
        sizeBytes: optionalNumber(item['size']),
        modifiedAt: optionalString(item['modified_at']),
        family: optionalString(details['family']),
        parameterSize: optionalString(details['parameter_size']),
        quantizationLevel: optionalString(details['quantization_level']),
      };
    })
    .filter((model): model is AiModelInfo => model !== null)
    .sort((left, right) => left.name.localeCompare(right.name));
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function uniqueModels(routing: StoredRoutingSettings): string[] {
  return [...new Set([routing.intentModel, routing.replyModel])];
}

let activeRuntime: AiRuntimeService | undefined;

export class AiRuntimeService implements OllamaResolverObserver {
  private requestedEnabled: boolean;
  private routingState: StoredRoutingSettings;
  private readonly fetchImpl: FetchLike;
  private readonly now: () => Date;
  private readonly metricsState: MutableMetrics = {
    requests: 0,
    successes: 0,
    failures: 0,
    fallbacks: 0,
    guardOverrides: 0,
    totalLatencyMs: 0,
    lastLatencyMs: null,
    lastSuccessAt: null,
    lastFailureAt: null,
    lastModelIntent: null,
    lastFinalIntent: null,
    lastError: null,
  };
  private probeState: AiProbeSnapshot = {
    at: null,
    ok: null,
    latencyMs: null,
    modelPresent: null,
    error: null,
  };
  private catalogState: AiModelCatalogSnapshot = {
    at: null,
    ok: null,
    latencyMs: null,
    models: [],
    error: null,
  };

  private constructor(
    private readonly db: Queryable,
    private readonly config: LocalAiConfig,
    requestedEnabled: boolean,
    routing: StoredRoutingSettings,
    deps: AiRuntimeDeps,
  ) {
    this.requestedEnabled = requestedEnabled;
    this.routingState = routing;
    this.fetchImpl = deps.fetchImpl ?? fetch;
    this.now = deps.now ?? (() => new Date());
  }

  static async load(
    db: Queryable,
    config: LocalAiConfig,
    deps: AiRuntimeDeps = {},
  ): Promise<AiRuntimeService> {
    const runtimeSetting = await getSetting(db, RUNTIME_KEY);
    const routingSetting = await getSetting(db, ROUTING_KEY);
    const service = new AiRuntimeService(
      db,
      config,
      storedPreference(runtimeSetting, config.enabled),
      storedRouting(routingSetting, config.model),
      deps,
    );

    activeRuntime = service;
    service.applyResolver();
    return service;
  }

  success(event: OllamaResolveSuccess): void {
    const metrics = this.metricsState;
    metrics.requests++;
    metrics.successes++;
    metrics.totalLatencyMs += event.latencyMs;
    metrics.lastLatencyMs = event.latencyMs;
    metrics.lastSuccessAt = this.now().toISOString();
    metrics.lastModelIntent = event.modelIntent;
    metrics.lastFinalIntent = event.finalIntent;
    metrics.lastError = null;

    if (event.modelIntent !== event.finalIntent) metrics.guardOverrides++;
  }

  failure(event: OllamaResolveFailure): void {
    const metrics = this.metricsState;
    metrics.requests++;
    metrics.failures++;
    metrics.fallbacks++;
    metrics.totalLatencyMs += event.latencyMs;
    metrics.lastLatencyMs = event.latencyMs;
    metrics.lastFailureAt = this.now().toISOString();
    metrics.lastError = event.error;
  }

  async personalize(request: AiReplyRequest): Promise<string | null> {
    if (!this.isEnabled()) return null;

    try {
      return await generateOllamaReply(
        this.configForModel(this.routingState.replyModel),
        request,
        this.fetchImpl,
      );
    } catch (error) {
      log.warn(
        `Local AI reply wording failed; using the deterministic fallback (${errorMessage(error)}).`,
      );
      return null;
    }
  }

  snapshot(): AiRuntimeSnapshot {
    const metrics = this.metricsState;
    const averageLatencyMs =
      metrics.requests > 0
        ? Math.round((metrics.totalLatencyMs / metrics.requests) * 10) / 10
        : null;

    return {
      available: this.config.enabled,
      requestedEnabled: this.requestedEnabled,
      enabled: this.isEnabled(),
      activeResolver: activeResolverName(),
      baseUrl: this.config.baseUrl,
      model: this.config.model,
      timeoutMs: this.config.timeoutMs,
      routing: {
        defaultModel: this.config.model,
        intentModel: this.routingState.intentModel,
        replyModel: this.routingState.replyModel,
      },
      metrics: {
        requests: metrics.requests,
        successes: metrics.successes,
        failures: metrics.failures,
        fallbacks: metrics.fallbacks,
        guardOverrides: metrics.guardOverrides,
        averageLatencyMs,
        lastLatencyMs: metrics.lastLatencyMs,
        lastSuccessAt: metrics.lastSuccessAt,
        lastFailureAt: metrics.lastFailureAt,
        lastModelIntent: metrics.lastModelIntent,
        lastFinalIntent: metrics.lastFinalIntent,
        lastError: metrics.lastError,
      },
      probe: { ...this.probeState },
      catalog: {
        ...this.catalogState,
        models: this.catalogState.models.map((model) => ({ ...model })),
      },
    };
  }

  async refreshModels(): Promise<AiModelCatalogSnapshot> {
    if (!this.config.enabled) {
      throw new Error('Local AI is disabled by LOCAL_AI_ENABLED.');
    }

    const started = performance.now();
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.config.timeoutMs);

    try {
      const endpoint = new URL('/api/tags', `${this.config.baseUrl}/`);
      const response = await this.fetchImpl(endpoint, { signal: controller.signal });
      if (!response.ok) throw new Error(`Ollama HTTP ${response.status}.`);

      const models = modelCatalog(await response.json());
      const latencyMs = Math.round((performance.now() - started) * 10) / 10;

      this.catalogState = {
        at: this.now().toISOString(),
        ok: true,
        latencyMs,
        models,
        error: null,
      };

      return this.snapshot().catalog;
    } catch (error) {
      const message = controller.signal.aborted
        ? `Ollama model discovery timed out after ${this.config.timeoutMs} ms.`
        : errorMessage(error);
      const latencyMs = Math.round((performance.now() - started) * 10) / 10;

      this.catalogState = {
        at: this.now().toISOString(),
        ok: false,
        latencyMs,
        models: this.catalogState.models.map((model) => ({ ...model })),
        error: message,
      };

      throw new Error(message);
    } finally {
      clearTimeout(timeout);
    }
  }

  async testConnection(): Promise<AiProbeSnapshot> {
    const started = performance.now();

    try {
      const catalog = await this.refreshModels();
      const installed = new Set(catalog.models.map((model) => model.name));
      const missing = uniqueModels(this.routingState).filter((model) => !installed.has(model));

      if (missing.length > 0) {
        throw new Error(`Selected role model not installed: ${missing.join(', ')}.`);
      }

      const latencyMs = catalog.latencyMs ?? Math.round((performance.now() - started) * 10) / 10;

      this.probeState = {
        at: this.now().toISOString(),
        ok: true,
        latencyMs,
        modelPresent: true,
        error: null,
      };

      return { ...this.probeState };
    } catch (error) {
      const message = errorMessage(error);
      const latencyMs = Math.round((performance.now() - started) * 10) / 10;

      this.probeState = {
        at: this.now().toISOString(),
        ok: false,
        latencyMs,
        modelPresent: false,
        error: message,
      };

      throw new Error(message);
    }
  }

  async setRouting(
    intentModel: string,
    replyModel: string,
    actor: string,
  ): Promise<AiRuntimeSnapshot> {
    const nextRouting: StoredRoutingSettings = {
      intentModel: cleanModelName(intentModel, ''),
      replyModel: cleanModelName(replyModel, ''),
    };

    if (!nextRouting.intentModel || !nextRouting.replyModel) {
      throw new Error('Intent and reply model selections are required.');
    }

    const catalog = await this.refreshModels();
    const installed = new Set(catalog.models.map((model) => model.name));
    const missing = uniqueModels(nextRouting).filter((model) => !installed.has(model));

    if (missing.length > 0) {
      throw new Error(`Cannot route to an uninstalled model: ${missing.join(', ')}.`);
    }

    const previous = { ...this.routingState };

    try {
      await setSetting(this.db, ROUTING_KEY, nextRouting satisfies StoredRoutingSettings);
      await writeAudit(this.db, actor, 'local-ai.routing.update', 'local-ai', {
        intentModel: nextRouting.intentModel,
        replyModel: nextRouting.replyModel,
      });
    } catch (error) {
      await setSetting(this.db, ROUTING_KEY, previous).catch(() => undefined);
      throw error;
    }

    this.routingState = nextRouting;
    this.applyResolver();
    return this.snapshot();
  }

  async setEnabled(enabled: boolean, actor: string): Promise<AiRuntimeSnapshot> {
    if (enabled) {
      if (!this.config.enabled) {
        throw new Error('Local AI cannot be enabled because LOCAL_AI_ENABLED is false.');
      }

      await this.testConnection();

      try {
        await setSetting(this.db, RUNTIME_KEY, { enabled } satisfies StoredRuntimeSettings);
        await writeAudit(this.db, actor, 'local-ai.toggle', 'local-ai', {
          enabled,
          intentModel: this.routingState.intentModel,
          replyModel: this.routingState.replyModel,
        });
      } catch (error) {
        await setSetting(this.db, RUNTIME_KEY, { enabled: false }).catch(() => undefined);
        throw error;
      }

      this.requestedEnabled = true;
      this.applyResolver();
      return this.snapshot();
    }

    this.requestedEnabled = false;
    this.applyResolver();

    try {
      await setSetting(this.db, RUNTIME_KEY, { enabled } satisfies StoredRuntimeSettings);
      await writeAudit(this.db, actor, 'local-ai.toggle', 'local-ai', {
        enabled,
        intentModel: this.routingState.intentModel,
        replyModel: this.routingState.replyModel,
      });
    } catch (error) {
      throw new Error(
        `Rules are active for this process, but the preference could not be persisted: ${errorMessage(error)}`,
      );
    }

    return this.snapshot();
  }

  private configForModel(model: string): LocalAiConfig {
    return {
      ...this.config,
      model,
    };
  }

  private isEnabled(): boolean {
    return this.config.enabled && this.requestedEnabled;
  }

  private applyResolver(): void {
    if (this.isEnabled()) {
      setIntentResolver(
        createOllamaIntentResolver(this.configForModel(this.routingState.intentModel), {
          fetchImpl: this.fetchImpl,
          observer: this,
        }),
      );
      log.info(
        `Local AI runtime enabled with intent model "${this.routingState.intentModel}" and reply model "${this.routingState.replyModel}".`,
      );
      return;
    }

    resetIntentResolver();
    log.info('Local AI runtime disabled; deterministic rules are active.');
  }
}

function unavailableSnapshot(): AiRuntimeSnapshot {
  return {
    available: false,
    requestedEnabled: false,
    enabled: false,
    activeResolver: activeResolverName(),
    baseUrl: '',
    model: '',
    timeoutMs: 0,
    routing: {
      defaultModel: '',
      intentModel: '',
      replyModel: '',
    },
    metrics: {
      requests: 0,
      successes: 0,
      failures: 0,
      fallbacks: 0,
      guardOverrides: 0,
      averageLatencyMs: null,
      lastLatencyMs: null,
      lastSuccessAt: null,
      lastFailureAt: null,
      lastModelIntent: null,
      lastFinalIntent: null,
      lastError: null,
    },
    probe: {
      at: null,
      ok: null,
      latencyMs: null,
      modelPresent: null,
      error: null,
    },
    catalog: {
      at: null,
      ok: null,
      latencyMs: null,
      models: [],
      error: null,
    },
  };
}

export function aiRuntimeSnapshot(): AiRuntimeSnapshot {
  return activeRuntime?.snapshot() ?? unavailableSnapshot();
}

export async function refreshAiModelCatalog(): Promise<AiModelCatalogSnapshot> {
  if (!activeRuntime) throw new Error('Local AI runtime is not initialized.');
  return activeRuntime.refreshModels();
}

export async function setAiModelRouting(
  intentModel: string,
  replyModel: string,
  actor: string,
): Promise<AiRuntimeSnapshot> {
  if (!activeRuntime) throw new Error('Local AI runtime is not initialized.');
  return activeRuntime.setRouting(intentModel, replyModel, actor);
}

export async function testAiRuntimeConnection(): Promise<AiProbeSnapshot> {
  if (!activeRuntime) throw new Error('Local AI runtime is not initialized.');
  return activeRuntime.testConnection();
}

export async function setAiRuntimeEnabled(
  enabled: boolean,
  actor: string,
): Promise<AiRuntimeSnapshot> {
  if (!activeRuntime) throw new Error('Local AI runtime is not initialized.');
  return activeRuntime.setEnabled(enabled, actor);
}

export async function personalizeAiReply(request: AiReplyRequest): Promise<string | null> {
  if (!activeRuntime) return null;
  return activeRuntime.personalize(request);
}

export function resetAiRuntimeForTests(): void {
  activeRuntime = undefined;
  resetIntentResolver();
}
