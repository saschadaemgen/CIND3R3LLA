/**
 * Runtime control and in-memory telemetry for the private Ollama resolver.
 *
 * Environment configuration decides whether local AI is available at all. The
 * persisted preference decides whether this process uses it or the deterministic
 * rules. Enabling is fail-closed: the endpoint and configured model are probed
 * before the resolver is swapped in. Disabling switches to rules immediately.
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

interface StoredRuntimeSettings {
  enabled: boolean;
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

export interface AiRuntimeSnapshot {
  available: boolean;
  requestedEnabled: boolean;
  enabled: boolean;
  activeResolver: string;
  baseUrl: string;
  model: string;
  timeoutMs: number;
  metrics: AiRuntimeMetrics;
  probe: AiProbeSnapshot;
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

function modelNames(value: unknown): string[] {
  const models = record(value)['models'];
  if (!Array.isArray(models)) throw new Error('Ollama returned an invalid model list.');

  return models
    .map((entry) => {
      const item = record(entry);
      const name = item['name'] ?? item['model'];
      return typeof name === 'string' ? name.trim() : '';
    })
    .filter((name) => name !== '');
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

let activeRuntime: AiRuntimeService | undefined;

export class AiRuntimeService implements OllamaResolverObserver {
  private requestedEnabled: boolean;
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

  private constructor(
    private readonly db: Queryable,
    private readonly config: LocalAiConfig,
    requestedEnabled: boolean,
    deps: AiRuntimeDeps,
  ) {
    this.requestedEnabled = requestedEnabled;
    this.fetchImpl = deps.fetchImpl ?? fetch;
    this.now = deps.now ?? (() => new Date());
  }

  static async load(
    db: Queryable,
    config: LocalAiConfig,
    deps: AiRuntimeDeps = {},
  ): Promise<AiRuntimeService> {
    const stored = await getSetting(db, RUNTIME_KEY);
    const service = new AiRuntimeService(
      db,
      config,
      storedPreference(stored, config.enabled),
      deps,
    );
    activeRuntime = service;
    service.applyResolver();
    return service;
  }

  /** Receives a successful model classification from the resolver wrapper. */
  success(event: OllamaResolveSuccess): void {
    const m = this.metricsState;
    m.requests++;
    m.successes++;
    m.totalLatencyMs += event.latencyMs;
    m.lastLatencyMs = event.latencyMs;
    m.lastSuccessAt = this.now().toISOString();
    m.lastModelIntent = event.modelIntent;
    m.lastFinalIntent = event.finalIntent;
    m.lastError = null;
    if (event.modelIntent !== event.finalIntent) m.guardOverrides++;
  }

  /** A thrown model error means resolver.ts will use the deterministic fallback. */
  failure(event: OllamaResolveFailure): void {
    const m = this.metricsState;
    m.requests++;
    m.failures++;
    m.fallbacks++;
    m.totalLatencyMs += event.latencyMs;
    m.lastLatencyMs = event.latencyMs;
    m.lastFailureAt = this.now().toISOString();
    m.lastError = event.error;
  }

  /**
   * Gives the local model one chance to phrase an already-decided reply.
   *
   * The engine owns the facts and the action. A wording failure is deliberately
   * non-fatal: returning null makes the engine use its deterministic persona
   * string immediately.
   */
  async personalize(request: AiReplyRequest): Promise<string | null> {
    if (!this.isEnabled()) return null;

    try {
      return await generateOllamaReply(this.config, request, this.fetchImpl);
    } catch (error) {
      log.warn(
        `Local AI reply wording failed; using the deterministic fallback (${errorMessage(error)}).`,
      );
      return null;
    }
  }

  snapshot(): AiRuntimeSnapshot {
    const m = this.metricsState;
    const averageLatencyMs =
      m.requests > 0 ? Math.round((m.totalLatencyMs / m.requests) * 10) / 10 : null;

    return {
      available: this.config.enabled,
      requestedEnabled: this.requestedEnabled,
      enabled: this.isEnabled(),
      activeResolver: activeResolverName(),
      baseUrl: this.config.baseUrl,
      model: this.config.model,
      timeoutMs: this.config.timeoutMs,
      metrics: {
        requests: m.requests,
        successes: m.successes,
        failures: m.failures,
        fallbacks: m.fallbacks,
        guardOverrides: m.guardOverrides,
        averageLatencyMs,
        lastLatencyMs: m.lastLatencyMs,
        lastSuccessAt: m.lastSuccessAt,
        lastFailureAt: m.lastFailureAt,
        lastModelIntent: m.lastModelIntent,
        lastFinalIntent: m.lastFinalIntent,
        lastError: m.lastError,
      },
      probe: { ...this.probeState },
    };
  }

  async testConnection(): Promise<AiProbeSnapshot> {
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

      const names = modelNames(await response.json());
      const present = names.includes(this.config.model);
      if (!present) {
        throw new Error(`Configured model "${this.config.model}" is not installed on Ollama.`);
      }

      const latencyMs = Math.round((performance.now() - started) * 10) / 10;
      this.probeState = {
        at: this.now().toISOString(),
        ok: true,
        latencyMs,
        modelPresent: true,
        error: null,
      };
      return { ...this.probeState };
    } catch (error) {
      const message = controller.signal.aborted
        ? `Ollama probe timed out after ${this.config.timeoutMs} ms.`
        : errorMessage(error);
      const latencyMs = Math.round((performance.now() - started) * 10) / 10;
      this.probeState = {
        at: this.now().toISOString(),
        ok: false,
        latencyMs,
        modelPresent: false,
        error: message,
      };
      throw new Error(message);
    } finally {
      clearTimeout(timeout);
    }
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
          model: this.config.model,
        });
      } catch (error) {
        await setSetting(this.db, RUNTIME_KEY, { enabled: false }).catch(() => undefined);
        throw error;
      }

      this.requestedEnabled = true;
      this.applyResolver();
      return this.snapshot();
    }

    // Disabling is fail-closed: rules become active before any database write.
    this.requestedEnabled = false;
    this.applyResolver();
    try {
      await setSetting(this.db, RUNTIME_KEY, { enabled } satisfies StoredRuntimeSettings);
      await writeAudit(this.db, actor, 'local-ai.toggle', 'local-ai', {
        enabled,
        model: this.config.model,
      });
    } catch (error) {
      throw new Error(
        `Rules are active for this process, but the preference could not be persisted: ${errorMessage(error)}`,
      );
    }
    return this.snapshot();
  }

  private isEnabled(): boolean {
    return this.config.enabled && this.requestedEnabled;
  }

  private applyResolver(): void {
    if (this.isEnabled()) {
      setIntentResolver(
        createOllamaIntentResolver(this.config, {
          fetchImpl: this.fetchImpl,
          observer: this,
        }),
      );
      log.info(`Local AI runtime enabled with model "${this.config.model}".`);
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
  };
}

export function aiRuntimeSnapshot(): AiRuntimeSnapshot {
  return activeRuntime?.snapshot() ?? unavailableSnapshot();
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

/** Uses local AI for wording only when the runtime is currently active. */
export async function personalizeAiReply(request: AiReplyRequest): Promise<string | null> {
  if (!activeRuntime) return null;
  return activeRuntime.personalize(request);
}

/** Test-only reset for the module-level runtime and resolver singleton. */
export function resetAiRuntimeForTests(): void {
  activeRuntime = undefined;
  resetIntentResolver();
}
