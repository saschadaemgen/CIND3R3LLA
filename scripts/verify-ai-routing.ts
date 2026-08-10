/**
 * Offline verification for role-based local model routing.
 *
 * No network, SimpleX message, consent write, or production database is used.
 */

import type { LocalAiConfig } from '../src/config.js';
import type { Queryable } from '../src/db/pool.js';
import {
  AiRuntimeService,
  personalizeAiReply,
  resetAiRuntimeForTests,
  setAiModelRouting,
} from '../src/interaction/ai-runtime.js';
import type { FetchLike } from '../src/interaction/ollama-resolver.js';
import { capabilityCatalog, type Intent } from '../src/interaction/intent.js';
import { seededPromptRules } from './seeded-rules.js';

/** The rules she is given, from the seeded registry (CCB-S4-039). */
const RULES = await seededPromptRules();
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
  if (!ok) failures += 1;
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

    throw new Error(`Unexpected query in routing harness: ${text}`);
  }
}

const config: LocalAiConfig = {
  enabled: true,
  baseUrl: 'http://127.0.0.1:11434',
  model: 'qwen3.5:9b',
  timeoutMs: 1000,
};

const requestedModels: string[] = [];

const fakeFetch: FetchLike = async (input, init) => {
  const url = new URL(String(input));

  if (url.pathname === '/api/tags') {
    return new Response(
      JSON.stringify({
        models: [
          { name: 'qwen3.5:4b', model: 'qwen3.5:4b' },
          { name: 'qwen3.5:9b', model: 'qwen3.5:9b' },
        ],
      }),
      {
        status: 200,
        headers: { 'content-type': 'application/json' },
      },
    );
  }

  if (url.pathname === '/v1/chat/completions') {
    const body = JSON.parse(typeof init?.body === 'string' ? init.body : '{}') as {
      model?: string;
      messages?: Array<{ content?: string }>;
    };

    requestedModels.push(body.model ?? '');
    const system = body.messages?.[0]?.content ?? '';

    if (system.includes('intent classification')) {
      return new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  intent: 'STATUS',
                  confidence: 0.97,
                  slots: {},
                  lang: 'en',
                }),
              },
            },
          ],
        }),
        {
          status: 200,
          headers: { 'content-type': 'application/json' },
        },
      );
    }

    return new Response(
      JSON.stringify({
        choices: [
          {
            message: {
              content: JSON.stringify({
                reply: 'Your archive contains 12 messages. 🔐',
              }),
            },
          },
        ],
      }),
      {
        status: 200,
        headers: { 'content-type': 'application/json' },
      },
    );
  }

  return new Response('not found', { status: 404 });
};

async function main(): Promise<void> {
  setCatalog([]);

  const db = new MemoryDb();
  const runtime = await AiRuntimeService.load(db, config, { fetchImpl: fakeFetch });

  console.log('\n1. Default role routing');
  const defaults = runtime.snapshot().routing;
  check('intent defaults to the environment model', defaults.intentModel === config.model);
  check('reply defaults to the environment model', defaults.replyModel === config.model);
  check('default model remains visible', defaults.defaultModel === config.model);

  console.log('\n2. Separate role models apply immediately');
  await setAiModelRouting('qwen3.5:4b', 'qwen3.5:9b', 'routing-test');
  const routed = runtime.snapshot();

  check('intent model is updated', routed.routing.intentModel === 'qwen3.5:4b');
  check('reply model is updated', routed.routing.replyModel === 'qwen3.5:9b');
  check('active resolver follows the intent model', activeResolverName() === 'ollama:qwen3.5:4b');

  await resolveIntent('what is my status', {
    threshold: 0.65,
    defaultLanguage: 'en',
    intents: catalog,
  });

  check(
    'intent classification uses the selected intent model',
    requestedModels.at(-1) === 'qwen3.5:4b',
    requestedModels.at(-1) ?? '',
  );

  const reply = await personalizeAiReply({
    kind: 'status',
    lang: 'en',
    memberMessage: 'What is in my archive?',
    deterministicDraft: 'Your archive contains 12 messages.',
    mode: 'free',
    rules: RULES,
    requiredLiterals: ['12'],
  });

  check(
    'reply wording uses the selected reply model',
    requestedModels.at(-1) === 'qwen3.5:9b',
    requestedModels.at(-1) ?? '',
  );
  check('reply wording succeeds', reply?.includes('12') === true, reply ?? '');

  console.log('\n3. Missing models are refused without changing the route');
  let missingRefused = false;

  try {
    await runtime.setRouting('ghost-model:latest', 'qwen3.5:9b', 'routing-test');
  } catch {
    missingRefused = true;
  }

  const afterRefusal = runtime.snapshot().routing;
  check('missing model is refused', missingRefused);
  check('intent route remains unchanged', afterRefusal.intentModel === 'qwen3.5:4b');
  check('reply route remains unchanged', afterRefusal.replyModel === 'qwen3.5:9b');

  console.log('\n4. Routing persists across runtime reload');
  const reloaded = await AiRuntimeService.load(db, config, { fetchImpl: fakeFetch });
  const persisted = reloaded.snapshot().routing;

  check('persisted intent model reloads', persisted.intentModel === 'qwen3.5:4b');
  check('persisted reply model reloads', persisted.replyModel === 'qwen3.5:9b');
  check('routing update is audited', db.audits.length >= 1, String(db.audits.length));

  resetAiRuntimeForTests();
  setCatalog([]);

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
  setCatalog([]);
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
