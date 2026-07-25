/**
 * Offline verification for Ollama model discovery and catalog state.
 *
 * No network, SimpleX message, consent write, or production database is used.
 */

import type { LocalAiConfig } from '../src/config.js';
import type { Queryable } from '../src/db/pool.js';
import {
  AiRuntimeService,
  aiRuntimeSnapshot,
  refreshAiModelCatalog,
  resetAiRuntimeForTests,
} from '../src/interaction/ai-runtime.js';
import type { FetchLike } from '../src/interaction/ollama-resolver.js';

let failures = 0;

function check(label: string, ok: boolean, detail = ''): void {
  if (!ok) failures += 1;
  console.log(`  [${ok ? 'PASS' : 'FAIL'}] ${label}${detail ? `: ${detail}` : ''}`);
}

class MemoryDb implements Queryable {
  async query<R = Record<string, unknown>>(
    text: string,
  ): Promise<{ rows: R[]; rowCount: number | null }> {
    if (text.includes('SELECT value FROM settings')) {
      return { rows: [], rowCount: 0 };
    }

    throw new Error(`Unexpected query in model catalog harness: ${text}`);
  }
}

const config: LocalAiConfig = {
  enabled: true,
  baseUrl: 'http://127.0.0.1:11434',
  model: 'qwen3.5:9b',
  timeoutMs: 1000,
};

let mode: 'healthy' | 'malformed' | 'missing' = 'healthy';

const healthyModels = [
  {
    name: 'nomic-embed-text:latest',
    model: 'nomic-embed-text:latest',
    modified_at: '2026-07-25T16:00:00Z',
    size: 274302450,
    details: {
      family: 'nomic-bert',
      parameter_size: '137M',
      quantization_level: 'F16',
    },
  },
  {
    name: 'qwen3.5:9b',
    model: 'qwen3.5:9b',
    modified_at: '2026-07-25T15:00:00Z',
    size: 6700000000,
    details: {
      family: 'qwen3',
      parameter_size: '9.7B',
      quantization_level: 'Q4_K_M',
    },
  },
];

const fakeFetch: FetchLike = async (input) => {
  const url = new URL(String(input));

  if (url.pathname !== '/api/tags') {
    return new Response('not found', { status: 404 });
  }

  if (mode === 'malformed') {
    return new Response(JSON.stringify({ models: 'broken' }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  }

  const models =
    mode === 'missing'
      ? healthyModels.filter((model) => model.name !== config.model)
      : healthyModels;

  return new Response(JSON.stringify({ models }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
};

async function main(): Promise<void> {
  const db = new MemoryDb();
  let clock = 0;
  const now = (): Date => new Date(Date.parse('2026-07-25T18:30:00.000Z') + clock++ * 1000);

  const runtime = await AiRuntimeService.load(db, config, {
    fetchImpl: fakeFetch,
    now,
  });

  console.log('\n1. Healthy catalog discovery');
  const catalog = await refreshAiModelCatalog();
  check('catalog refresh succeeds', catalog.ok === true);
  check('two installed models are returned', catalog.models.length === 2);
  check(
    'models are sorted by name',
    catalog.models[0]?.name === 'nomic-embed-text:latest' &&
      catalog.models[1]?.name === 'qwen3.5:9b',
  );

  const configured = catalog.models.find((model) => model.name === config.model);
  check('configured model metadata is parsed', configured?.family === 'qwen3');
  check('parameter size is parsed', configured?.parameterSize === '9.7B');
  check('quantization is parsed', configured?.quantizationLevel === 'Q4_K_M');
  check('model size is parsed', configured?.sizeBytes === 6700000000);
  check('catalog timestamp is recorded', catalog.at === '2026-07-25T18:30:00.000Z');
  check('runtime snapshot exposes the catalog', aiRuntimeSnapshot().catalog.models.length === 2);

  console.log('\n2. Failed discovery keeps the last known inventory');
  mode = 'malformed';
  let malformedRefused = false;

  try {
    await runtime.refreshModels();
  } catch {
    malformedRefused = true;
  }

  const failedCatalog = runtime.snapshot().catalog;
  check('malformed catalog is rejected', malformedRefused);
  check('failed catalog state is visible', failedCatalog.ok === false);
  check('last known models remain visible', failedCatalog.models.length === 2);
  check(
    'catalog error is retained',
    failedCatalog.error?.includes('invalid model list') === true,
    failedCatalog.error ?? '',
  );

  console.log('\n3. Probe refuses a missing configured model');
  mode = 'missing';
  let missingRefused = false;

  try {
    await runtime.testConnection();
  } catch {
    missingRefused = true;
  }

  const missingSnapshot = runtime.snapshot();
  check('missing configured model is refused', missingRefused);
  check('probe records model absence', missingSnapshot.probe.modelPresent === false);
  check('catalog itself remains healthy', missingSnapshot.catalog.ok === true);
  check('available model metadata remains visible', missingSnapshot.catalog.models.length === 1);

  resetAiRuntimeForTests();

  console.log('\n=== RESULTS ===');
  console.log(`StepSuccessful: ${failures === 0}`);
  console.log(`Failures: ${failures}`);
  console.log('NetworkUsed: false');
  console.log('SimpleXMessageSent: false');
  console.log('ConsentExecuted: false');
  console.log('ProductionChanged: false');

  if (failures > 0) process.exit(1);
}

main().catch((error: unknown) => {
  resetAiRuntimeForTests();
  const message = error instanceof Error ? error.message : String(error);

  console.error('\n=== RESULTS ===');
  console.error('StepSuccessful: false');
  console.error(`Error: ${message}`);
  console.error('NetworkUsed: false');
  console.error('SimpleXMessageSent: false');
  console.error('ConsentExecuted: false');
  console.error('ProductionChanged: false');
  process.exit(1);
});
