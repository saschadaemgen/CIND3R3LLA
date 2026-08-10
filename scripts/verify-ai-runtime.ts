/**
 * Offline verification for local-AI runtime switching and telemetry.
 *
 * No network, SimpleX message, consent write, or production database is used.
 */

import type { LocalAiConfig } from '../src/config.js';
import type { Queryable } from '../src/db/pool.js';
import {
  AiRuntimeService,
  resetAiRuntimeForTests,
  type AiRuntimeSnapshot,
} from '../src/interaction/ai-runtime.js';
import type { FetchLike } from '../src/interaction/ollama-resolver.js';
import { capabilityCatalog, type Intent } from '../src/interaction/intent.js';
import { activeResolverName, resolveIntent } from '../src/interaction/resolver.js';

/**
 * The catalog this harness drives with (CCB-S5-021).
 *
 * It used to be process state, written by `setActiveIntents`. It is a VALUE now, computed
 * per bot in production and carried in the resolution context, so a harness states the
 * capabilities it is testing instead of mutating a global that outlived the check.
 */
let catalog: Intent[] = capabilityCatalog([]);
const setCatalog = (extra: readonly Intent[]): void => {
  catalog = capabilityCatalog(extra);
};

let failures = 0;

function check(label: string, ok: boolean, detail = ''): void {
  if (!ok) failures++;
  console.log(`  [${ok ? 'PASS' : 'FAIL'}] ${label}${detail ? `: ${detail}` : ''}`);
}

class MemoryDb implements Queryable {
  readonly settings = new Map<string, unknown>();
  readonly audits: unknown[] = [];

  async query<R = Record<string, unknown>>(
    text: string,
    values: readonly unknown[] = [],
  ): Promise<{ rows: R[]; rowCount: number | null }> {
    if (text.includes('SELECT value FROM settings')) {
      const value = this.settings.get(String(values[0] ?? ''));
      return {
        rows: (value === undefined ? [] : [{ value }]) as R[],
        rowCount: value === undefined ? 0 : 1,
      };
    }

    if (text.includes('INSERT INTO settings')) {
      const key = String(values[0] ?? '');
      const raw = values[1];
      this.settings.set(key, typeof raw === 'string' ? JSON.parse(raw) : raw);
      return { rows: [], rowCount: 1 };
    }

    if (text.includes('INSERT INTO audit_log')) {
      this.audits.push({ values: [...values] });
      return { rows: [], rowCount: 1 };
    }

    throw new Error(`Unexpected query in runtime harness: ${text}`);
  }
}

const config: LocalAiConfig = {
  enabled: true,
  baseUrl: 'http://127.0.0.1:11434',
  model: 'qwen3.5:9b',
  timeoutMs: 1000,
};

let tagsAvailable = true;
let inferenceAvailable = true;
let forcedModelIntent: string | undefined;

function completion(intent: string): Response {
  return new Response(
    JSON.stringify({
      choices: [
        {
          message: {
            content: JSON.stringify({
              intent,
              confidence: intent === 'UNKNOWN' ? 0 : 0.95,
              slots: {},
              lang: 'en',
            }),
          },
        },
      ],
    }),
    { status: 200, headers: { 'content-type': 'application/json' } },
  );
}

const fakeFetch: FetchLike = async (input, init) => {
  const url = new URL(String(input));

  if (url.pathname === '/api/tags') {
    if (!tagsAvailable) return new Response('unavailable', { status: 503 });
    return new Response(
      JSON.stringify({ models: [{ name: 'qwen3.5:9b', model: 'qwen3.5:9b' }] }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    );
  }

  if (url.pathname === '/v1/chat/completions') {
    if (!inferenceAvailable) return new Response('unavailable', { status: 503 });

    const rawBody = typeof init?.body === 'string' ? init.body : '{}';
    const body = JSON.parse(rawBody) as Record<string, unknown>;
    const messages = Array.isArray(body['messages']) ? body['messages'] : [];
    const user = messages
      .map((message) =>
        message && typeof message === 'object'
          ? (message as Record<string, unknown>)['content']
          : undefined,
      )
      .filter((value): value is string => typeof value === 'string')
      .at(-1);

    const intent =
      forcedModelIntent ??
      (user?.toLowerCase().includes('status')
        ? 'STATUS'
        : user?.toLowerCase().includes('help')
          ? 'HELP'
          : 'UNKNOWN');
    return completion(intent);
  }

  return new Response('not found', { status: 404 });
};

function snapshotDetail(snapshot: AiRuntimeSnapshot): string {
  return `${snapshot.activeResolver}, requests=${snapshot.metrics.requests}, fallbacks=${snapshot.metrics.fallbacks}`;
}

async function main(): Promise<void> {
  setCatalog([]);
  const db = new MemoryDb();
  let nowTick = 0;
  const now = (): Date => new Date(Date.parse('2026-07-25T12:00:00.000Z') + nowTick++ * 1000);

  console.log('\n1. Boot preference and immediate switching');
  const runtime = await AiRuntimeService.load(db, config, { fetchImpl: fakeFetch, now });
  check('environment-enabled runtime starts on local AI', runtime.snapshot().enabled);
  check('Ollama resolver is active', activeResolverName() === 'ollama:qwen3.5:9b');

  await runtime.setEnabled(false, 'runtime-test');
  check('disabling switches to deterministic rules immediately', activeResolverName() === 'rules');
  check(
    'disabled preference is persisted',
    (db.settings.get('local-ai-runtime') as { enabled?: boolean } | undefined)?.enabled === false,
  );

  console.log('\n2. Failed probes cannot enable local AI');
  tagsAvailable = false;
  let refused = false;
  try {
    await runtime.setEnabled(true, 'runtime-test');
  } catch {
    refused = true;
  }
  check('unreachable Ollama is refused', refused);
  check('rules remain active after a failed enable', activeResolverName() === 'rules');
  check('failed probe is visible in the snapshot', runtime.snapshot().probe.ok === false);

  console.log('\n3. Healthy model enables without restart');
  tagsAvailable = true;
  await runtime.setEnabled(true, 'runtime-test');
  const enabled = runtime.snapshot();
  check('healthy configured model enables local AI', enabled.enabled, snapshotDetail(enabled));
  check('successful probe is recorded', enabled.probe.ok === true && enabled.probe.modelPresent === true);
  check('runtime changes are audited', db.audits.length >= 2, String(db.audits.length));

  console.log('\n4. Runtime telemetry records success, guards, and fallback');
  const ctx = { threshold: 0.65, defaultLanguage: 'en', intents: catalog };
  const statusResult = await resolveIntent('what is my status', ctx);
  check('successful live path returns STATUS', statusResult.intent === 'STATUS', statusResult.intent);

  forcedModelIntent = 'PUBLISH';
  const guarded = await resolveIntent('what is my publishing status', ctx);
  check('safety guard overrides model PUBLISH to STATUS', guarded.intent === 'STATUS', guarded.intent);
  forcedModelIntent = undefined;

  inferenceAvailable = false;
  const fallback = await resolveIntent('what can you do', ctx);
  check('model outage falls back to deterministic HELP', fallback.intent === 'HELP', fallback.intent);
  inferenceAvailable = true;

  const metrics = runtime.snapshot().metrics;
  check('three model attempts are counted', metrics.requests === 3, String(metrics.requests));
  check('two successful model calls are counted', metrics.successes === 2, String(metrics.successes));
  check('one automatic fallback is counted', metrics.fallbacks === 1, String(metrics.fallbacks));
  check('one deterministic guard override is counted', metrics.guardOverrides === 1, String(metrics.guardOverrides));
  check('last model error is retained', metrics.lastError?.includes('HTTP 503') === true, metrics.lastError ?? '');

  console.log('\n5. Stored rules preference survives a runtime reload');
  await runtime.setEnabled(false, 'runtime-test');
  const reloaded = await AiRuntimeService.load(db, config, { fetchImpl: fakeFetch, now });
  check('reloaded runtime respects stored rules mode', !reloaded.snapshot().enabled);
  check('rules remain active after reload', activeResolverName() === 'rules');

  resetAiRuntimeForTests();
  setCatalog([]);

  console.log('\n=== RESULTS ===');
  console.log(`StepSuccessful: ${failures === 0}`);
  console.log(`Failures: ${failures}`);
  console.log('NetworkUsed: false');
  console.log('ConsentExecuted: false');

  if (failures > 0) process.exit(1);
}

main().catch((error: unknown) => {
  resetAiRuntimeForTests();
  const message = error instanceof Error ? error.message : String(error);
  console.error('\n=== RESULTS ===');
  console.error('StepSuccessful: false');
  console.error(`Error: ${message}`);
  console.error('NetworkUsed: false');
  console.error('ConsentExecuted: false');
  process.exit(1);
});
