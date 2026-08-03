/**
 * Runtime control, role routing, model discovery, and content-free operations telemetry for private Ollama.
 *
 * Environment configuration decides whether local AI is available at all. Persisted settings decide
 * whether this process uses local AI and which installed model serves each supported role. Enabling
 * and routing changes are fail-closed because the selected models are verified before the active
 * resolver is changed.
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
const ACTIVITY_CAPACITY = 50;

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

export interface AiReplyMetrics {
  requests: number;
  successes: number;
  failures: number;
  fallbacks: number;
  averageLatencyMs: number | null;
  lastLatencyMs: number | null;
  lastSuccessAt: string | null;
  lastFailureAt: string | null;
  lastReplyKind: string | null;
  lastReplyMode: AiReplyRequest['mode'] | null;
  lastErrorCategory: string | null;
}

export type AiActivityRole = 'intent' | 'reply' | 'runtime' | 'routing' | 'catalog' | 'probe';
export type AiActivityOutcome = 'success' | 'failure' | 'fallback' | 'change';

export interface AiActivityEvent {
  id: number;
  at: string;
  role: AiActivityRole;
  outcome: AiActivityOutcome;
  model: string | null;
  operation: string;
  latencyMs: number | null;
  detail: string;
}

export interface AiOperationsSummary {
  totalRequests: number;
  successes: number;
  failures: number;
  fallbacks: number;
  successRate: number | null;
  fallbackRate: number | null;
  lastActivityAt: string | null;
  activityCapacity: number;
  contentStored: false;
  metricsPersistence: 'memory';
}

export interface AiOperationsTelemetry {
  summary: AiOperationsSummary;
  intent: AiRuntimeMetrics & { model: string };
  reply: AiReplyMetrics & { model: string };
  recent: AiActivityEvent[];
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
  replyMetrics: AiReplyMetrics;
  operations: AiOperationsTelemetry;
  probe: AiProbeSnapshot;
  catalog: AiModelCatalogSnapshot;
}

export interface AiRuntimeDeps {
  fetchImpl?: FetchLike;
  now?: () => Date;
}

interface MutableIntentMetrics {
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

interface MutableReplyMetrics {
  requests: number;
  successes: number;
  failures: number;
  fallbacks: number;
  totalLatencyMs: number;
  lastLatencyMs: number | null;
  lastSuccessAt: string | null;
  lastFailureAt: string | null;
  lastReplyKind: string | null;
  lastReplyMode: AiReplyRequest['mode'] | null;
  lastErrorCategory: string | null;
}

function emptyIntentMetrics(): MutableIntentMetrics {
  return {
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
}

function emptyReplyMetrics(): MutableReplyMetrics {
  return {
    requests: 0,
    successes: 0,
    failures: 0,
    fallbacks: 0,
    totalLatencyMs: 0,
    lastLatencyMs: null,
    lastSuccessAt: null,
    lastFailureAt: null,
    lastReplyKind: null,
    lastReplyMode: null,
    lastErrorCategory: null,
  };
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

function safeErrorCategory(error: unknown): string {
  const message = errorMessage(error).toLowerCase();

  if (message.includes('timed out') || message.includes('abort')) return 'timeout';
  if (message.includes('http')) return 'http-error';
  if (
    message.includes('malformed') ||
    message.includes('invalid') ||
    message.includes('empty') ||
    message.includes('no completion')
  ) {
    return 'invalid-output';
  }
  if (
    message.includes('required literal') ||
    message.includes('blocked text') ||
    message.includes('unsafe')
  ) {
    return 'guard-rejection';
  }
  if (
    message.includes('not installed') ||
    message.includes('missing') ||
    message.includes('unavailable')
  ) {
    return 'unavailable';
  }

  return 'runtime-error';
}

function uniqueModels(routing: StoredRoutingSettings): string[] {
  return [...new Set([routing.intentModel, routing.replyModel])];
}

function average(total: number, requests: number): number | null {
  return requests > 0 ? Math.round((total / requests) * 10) / 10 : null;
}

function rate(value: number, total: number): number | null {
  return total > 0 ? Math.round((value / total) * 1000) / 10 : null;
}

let activeRuntime: AiRuntimeService | undefined;

export class AiRuntimeService implements OllamaResolverObserver {
  private requestedEnabled: boolean;
  private routingState: StoredRoutingSettings;
  private readonly fetchImpl: FetchLike;
  private readonly now: () => Date;
  private intentMetricsState: MutableIntentMetrics = emptyIntentMetrics();
  private replyMetricsState: MutableReplyMetrics = emptyReplyMetrics();
  private activityState: AiActivityEvent[] = [];
  private activitySequence = 0;
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
    const metrics = this.intentMetricsState;
    const guarded = event.modelIntent !== event.finalIntent;
    const at = this.now().toISOString();

    metrics.requests++;
    metrics.successes++;
    metrics.totalLatencyMs += event.latencyMs;
    metrics.lastLatencyMs = event.latencyMs;
    metrics.lastSuccessAt = at;
    metrics.lastModelIntent = event.modelIntent;
    metrics.lastFinalIntent = event.finalIntent;
    metrics.lastError = null;

    if (guarded) metrics.guardOverrides++;

    this.pushActivity({
      at,
      role: 'intent',
      outcome: 'success',
      model: this.routingState.intentModel,
      operation: 'classify',
      latencyMs: event.latencyMs,
      detail: guarded ? 'deterministic guard override' : 'classification accepted',
    });
  }

  failure(event: OllamaResolveFailure): void {
    const metrics = this.intentMetricsState;
    const at = this.now().toISOString();

    metrics.requests++;
    metrics.failures++;
    metrics.fallbacks++;
    metrics.totalLatencyMs += event.latencyMs;
    metrics.lastLatencyMs = event.latencyMs;
    metrics.lastFailureAt = at;
    metrics.lastError = event.error;

    this.pushActivity({
      at,
      role: 'intent',
      outcome: 'fallback',
      model: this.routingState.intentModel,
      operation: 'classify',
      latencyMs: event.latencyMs,
      detail: safeErrorCategory(event.error),
    });
  }

  async personalize(request: AiReplyRequest): Promise<string | null> {
    if (!this.isEnabled()) return null;

    const started = performance.now();
    const metrics = this.replyMetricsState;
    const operation = request.kind.slice(0, 80);
    const model = this.routingState.replyModel;
    metrics.requests++;

    try {
      const reply = await generateOllamaReply(this.configForModel(model), request, this.fetchImpl);
      const latencyMs = Math.round((performance.now() - started) * 10) / 10;
      const at = this.now().toISOString();

      metrics.successes++;
      metrics.totalLatencyMs += latencyMs;
      metrics.lastLatencyMs = latencyMs;
      metrics.lastSuccessAt = at;
      metrics.lastReplyKind = operation;
      metrics.lastReplyMode = request.mode;
      metrics.lastErrorCategory = null;

      this.pushActivity({
        at,
        role: 'reply',
        outcome: 'success',
        model,
        operation,
        latencyMs,
        detail: request.mode,
      });

      // SUCCESS IS LOGGED, and the reason is a briefing (CCB-S4-026, D-130). Only the
      // FAILURE path used to say anything, so a working model lane was indistinguishable
      // from a lane that was never called: both were silence. An operator grepping the
      // journal while she answered found nothing and reasonably concluded she was never
      // asking the model, when in fact she was asking and succeeding.
      //
      // The member's message, the deterministic draft and the model's output are all
      // deliberately absent: this says THAT the model worded a reply and how long it
      // took, never what anybody said.
      log.info('Local AI worded a reply', { kind: operation, mode: request.mode, model, latencyMs });

      return reply;
    } catch (error) {
      const latencyMs = Math.round((performance.now() - started) * 10) / 10;
      const at = this.now().toISOString();
      const category = safeErrorCategory(error);

      metrics.failures++;
      metrics.fallbacks++;
      metrics.totalLatencyMs += latencyMs;
      metrics.lastLatencyMs = latencyMs;
      metrics.lastFailureAt = at;
      metrics.lastReplyKind = operation;
      metrics.lastReplyMode = request.mode;
      metrics.lastErrorCategory = category;

      this.pushActivity({
        at,
        role: 'reply',
        outcome: 'fallback',
        model,
        operation,
        latencyMs,
        detail: category,
      });

      log.warn(
        `Local AI reply wording failed; using the deterministic fallback (${errorMessage(error)}).`,
      );
      return null;
    }
  }

  snapshot(): AiRuntimeSnapshot {
    const intent = this.intentMetricsSnapshot();
    const reply = this.replyMetricsSnapshot();
    const totalRequests = intent.requests + reply.requests;
    const successes = intent.successes + reply.successes;
    const failures = intent.failures + reply.failures;
    const fallbacks = intent.fallbacks + reply.fallbacks;

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
      metrics: intent,
      replyMetrics: reply,
      operations: {
        summary: {
          totalRequests,
          successes,
          failures,
          fallbacks,
          successRate: rate(successes, totalRequests),
          fallbackRate: rate(fallbacks, totalRequests),
          lastActivityAt: this.activityState.at(-1)?.at ?? null,
          activityCapacity: ACTIVITY_CAPACITY,
          contentStored: false,
          metricsPersistence: 'memory',
        },
        intent: {
          ...intent,
          model: this.routingState.intentModel,
        },
        reply: {
          ...reply,
          model: this.routingState.replyModel,
        },
        recent: this.activityState.map((event) => ({ ...event })),
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
      const at = this.now().toISOString();

      this.catalogState = {
        at,
        ok: true,
        latencyMs,
        models,
        error: null,
      };

      this.pushActivity({
        at,
        role: 'catalog',
        outcome: 'success',
        model: null,
        operation: 'refresh',
        latencyMs,
        detail: `${models.length} models discovered`,
      });

      return this.snapshot().catalog;
    } catch (error) {
      const message = controller.signal.aborted
        ? `Ollama model discovery timed out after ${this.config.timeoutMs} ms.`
        : errorMessage(error);
      const latencyMs = Math.round((performance.now() - started) * 10) / 10;
      const at = this.now().toISOString();

      this.catalogState = {
        at,
        ok: false,
        latencyMs,
        models: this.catalogState.models.map((model) => ({ ...model })),
        error: message,
      };

      this.pushActivity({
        at,
        role: 'catalog',
        outcome: 'failure',
        model: null,
        operation: 'refresh',
        latencyMs,
        detail: safeErrorCategory(message),
      });

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
      const at = this.now().toISOString();

      this.probeState = {
        at,
        ok: true,
        latencyMs,
        modelPresent: true,
        error: null,
      };

      this.pushActivity({
        at,
        role: 'probe',
        outcome: 'success',
        model: null,
        operation: 'role-models',
        latencyMs,
        detail: 'all selected models present',
      });

      return { ...this.probeState };
    } catch (error) {
      const message = errorMessage(error);
      const latencyMs = Math.round((performance.now() - started) * 10) / 10;
      const at = this.now().toISOString();

      this.probeState = {
        at,
        ok: false,
        latencyMs,
        modelPresent: false,
        error: message,
      };

      this.pushActivity({
        at,
        role: 'probe',
        outcome: 'failure',
        model: null,
        operation: 'role-models',
        latencyMs,
        detail: safeErrorCategory(message),
      });

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

    this.pushActivity({
      at: this.now().toISOString(),
      role: 'routing',
      outcome: 'change',
      model: null,
      operation: 'role-assignment',
      latencyMs: null,
      detail: 'local role routing updated',
    });

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

      this.pushActivity({
        at: this.now().toISOString(),
        role: 'runtime',
        outcome: 'change',
        model: null,
        operation: 'enable',
        latencyMs: null,
        detail: 'local AI enabled',
      });

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

    this.pushActivity({
      at: this.now().toISOString(),
      role: 'runtime',
      outcome: 'change',
      model: null,
      operation: 'disable',
      latencyMs: null,
      detail: 'deterministic rules enabled',
    });

    return this.snapshot();
  }

  async resetTelemetry(actor: string): Promise<AiRuntimeSnapshot> {
    await writeAudit(this.db, actor, 'local-ai.telemetry.reset', 'local-ai', {
      previousIntentRequests: this.intentMetricsState.requests,
      previousReplyRequests: this.replyMetricsState.requests,
      previousActivityEvents: this.activityState.length,
    });

    this.intentMetricsState = emptyIntentMetrics();
    this.replyMetricsState = emptyReplyMetrics();
    this.activityState = [];
    this.activitySequence = 0;

    return this.snapshot();
  }

  private intentMetricsSnapshot(): AiRuntimeMetrics {
    const metrics = this.intentMetricsState;

    return {
      requests: metrics.requests,
      successes: metrics.successes,
      failures: metrics.failures,
      fallbacks: metrics.fallbacks,
      guardOverrides: metrics.guardOverrides,
      averageLatencyMs: average(metrics.totalLatencyMs, metrics.requests),
      lastLatencyMs: metrics.lastLatencyMs,
      lastSuccessAt: metrics.lastSuccessAt,
      lastFailureAt: metrics.lastFailureAt,
      lastModelIntent: metrics.lastModelIntent,
      lastFinalIntent: metrics.lastFinalIntent,
      lastError: metrics.lastError,
    };
  }

  private replyMetricsSnapshot(): AiReplyMetrics {
    const metrics = this.replyMetricsState;

    return {
      requests: metrics.requests,
      successes: metrics.successes,
      failures: metrics.failures,
      fallbacks: metrics.fallbacks,
      averageLatencyMs: average(metrics.totalLatencyMs, metrics.requests),
      lastLatencyMs: metrics.lastLatencyMs,
      lastSuccessAt: metrics.lastSuccessAt,
      lastFailureAt: metrics.lastFailureAt,
      lastReplyKind: metrics.lastReplyKind,
      lastReplyMode: metrics.lastReplyMode,
      lastErrorCategory: metrics.lastErrorCategory,
    };
  }

  private pushActivity(event: Omit<AiActivityEvent, 'id'>): void {
    this.activitySequence++;
    this.activityState.push({
      id: this.activitySequence,
      ...event,
    });

    if (this.activityState.length > ACTIVITY_CAPACITY) {
      this.activityState.splice(0, this.activityState.length - ACTIVITY_CAPACITY);
    }
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
  const metrics: AiRuntimeMetrics = {
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
  };
  const replyMetrics: AiReplyMetrics = {
    requests: 0,
    successes: 0,
    failures: 0,
    fallbacks: 0,
    averageLatencyMs: null,
    lastLatencyMs: null,
    lastSuccessAt: null,
    lastFailureAt: null,
    lastReplyKind: null,
    lastReplyMode: null,
    lastErrorCategory: null,
  };

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
    metrics,
    replyMetrics,
    operations: {
      summary: {
        totalRequests: 0,
        successes: 0,
        failures: 0,
        fallbacks: 0,
        successRate: null,
        fallbackRate: null,
        lastActivityAt: null,
        activityCapacity: ACTIVITY_CAPACITY,
        contentStored: false,
        metricsPersistence: 'memory',
      },
      intent: { ...metrics, model: '' },
      reply: { ...replyMetrics, model: '' },
      recent: [],
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

export async function resetAiOperationsTelemetry(actor: string): Promise<AiRuntimeSnapshot> {
  if (!activeRuntime) throw new Error('Local AI runtime is not initialized.');
  return activeRuntime.resetTelemetry(actor);
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
