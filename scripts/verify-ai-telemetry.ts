/**
 * Offline verification for content-free AI operations telemetry.
 *
 * No network, SimpleX transport, consent write, or production database is used.
 */

import type { LocalAiConfig } from '../src/config.js';
import type { Queryable } from '../src/db/pool.js';
import {
  AiRuntimeService,
  personalizeAiReply,
  resetAiOperationsTelemetry,
  resetAiRuntimeForTests,
} from '../src/interaction/ai-runtime.js';
import type { FetchLike } from '../src/interaction/ollama-resolver.js';
import { capabilityCatalog, type Intent } from '../src/interaction/intent.js';
import { seededPromptRules } from './seeded-rules.js';

/** The rules she is given, from the seeded registry (CCB-S4-039). */
const RULES = await seededPromptRules();
import { resolveIntent } from '../src/interaction/resolver.js';

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

    throw new Error(`Unexpected query in telemetry harness: ${text}`);
  }
}

const config: LocalAiConfig = {
  enabled: true,
  baseUrl: 'http://127.0.0.1:11434',
  model: 'qwen3.5:9b',
  timeoutMs: 1000,
};

let replyFails = false;

const fakeFetch: FetchLike = async (input, init) => {
  const url = new URL(String(input));

  if (url.pathname === '/api/tags') {
    return new Response(
      JSON.stringify({
        models: [{ name: 'qwen3.5:9b', model: 'qwen3.5:9b' }],
      }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    );
  }

  if (url.pathname === '/api/chat') {
    // The REPLY path since D-252: native endpoint, native envelope; the resolver stays on
    // /v1 below.
    if (replyFails) return new Response('unavailable', { status: 503 });
    return new Response(
      JSON.stringify({
        message: { content: JSON.stringify({ reply: 'Your archive contains 12 messages. 🔐' }) },
        done_reason: 'stop',
      }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    );
  }
  if (url.pathname === '/v1/chat/completions') {
    if (replyFails) return new Response('unavailable', { status: 503 });

    const body = JSON.parse(typeof init?.body === 'string' ? init.body : '{}') as {
      messages?: Array<{ content?: string }>;
    };
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
        { status: 200, headers: { 'content-type': 'application/json' } },
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
      { status: 200, headers: { 'content-type': 'application/json' } },
    );
  }

  return new Response('not found', { status: 404 });
};

async function main(): Promise<void> {
  setCatalog([]);
  const db = new MemoryDb();
  let tick = 0;
  const now = (): Date => new Date(Date.parse('2026-07-25T20:00:00.000Z') + tick++ * 1000);

  const runtime = await AiRuntimeService.load(db, config, { fetchImpl: fakeFetch, now });

  console.log('\n1. Intent and reply lanes report independent telemetry');
  await resolveIntent('what is my status', {
    threshold: 0.65,
    defaultLanguage: 'en',
    intents: catalog,
  });

  const memberMessage = 'PRIVATE MEMBER TEXT 9384';
  const reply = await personalizeAiReply({
    kind: 'status',
    lang: 'en',
    memberMessage,
    deterministicDraft: 'Your archive contains 12 messages.',
    mode: 'free',
    rules: RULES,
    requiredLiterals: ['12'],
  });

  const first = runtime.snapshot();
  check('intent request is counted', first.operations.intent.requests === 1);
  check('intent success is counted', first.operations.intent.successes === 1);
  check('reply request is counted', first.operations.reply.requests === 1);
  check('reply success is counted', first.operations.reply.successes === 1);
  check('reply output succeeds', reply?.includes('12') === true, reply ?? '');
  check('combined request total is correct', first.operations.summary.totalRequests === 2);
  check('success rate is calculated', first.operations.summary.successRate === 100);
  check('telemetry declares no content storage', first.operations.summary.contentStored === false);

  const serialized = JSON.stringify(first.operations);
  check('member text never enters telemetry', !serialized.includes(memberMessage));
  check(
    'deterministic draft never enters telemetry',
    !serialized.includes('Your archive contains'),
  );
  check('generated reply never enters telemetry', !serialized.includes('archive contains 12'));

  console.log('\n2. Reply failure records a safe category and fallback');
  replyFails = true;
  const fallback = await personalizeAiReply({
    kind: 'help',
    lang: 'en',
    memberMessage: 'ANOTHER PRIVATE MESSAGE',
    deterministicDraft: 'Help is available.',
    mode: 'free',
    rules: RULES,
  });

  const failed = runtime.snapshot();
  check('failed reply returns deterministic fallback signal', fallback === null);
  check('reply failure is counted', failed.operations.reply.failures === 1);
  check('reply fallback is counted', failed.operations.reply.fallbacks === 1);
  check(
    'safe error category is exposed',
    failed.operations.reply.lastErrorCategory === 'http-error',
  );
  check(
    'raw private message is absent after failure',
    !JSON.stringify(failed.operations).includes('ANOTHER PRIVATE MESSAGE'),
  );

  console.log('\n3. Activity buffer is metadata-only and bounded');
  replyFails = false;

  for (let index = 0; index < 55; index++) {
    await personalizeAiReply({
      kind: 'status',
      lang: 'en',
      memberMessage: `secret-${index}`,
      deterministicDraft: 'Count 12.',
      mode: 'free',
      rules: RULES,
      requiredLiterals: ['12'],
    });
  }

  const bounded = runtime.snapshot();
  check(
    'activity buffer respects its capacity',
    bounded.operations.recent.length === bounded.operations.summary.activityCapacity,
    `${bounded.operations.recent.length}/${bounded.operations.summary.activityCapacity}`,
  );
  check(
    'activity events contain no generated or member content',
    !JSON.stringify(bounded.operations.recent).includes('secret-'),
  );

  console.log('\n4. Reset clears telemetry but preserves routing and runtime');
  const beforeRoute = bounded.routing;
  const beforeEnabled = bounded.enabled;
  await resetAiOperationsTelemetry('telemetry-test');
  const reset = runtime.snapshot();

  check('intent metrics reset', reset.operations.intent.requests === 0);
  check('reply metrics reset', reset.operations.reply.requests === 0);
  check('activity buffer resets', reset.operations.recent.length === 0);
  check('routing is preserved', reset.routing.intentModel === beforeRoute.intentModel);
  check('reply routing is preserved', reset.routing.replyModel === beforeRoute.replyModel);
  check('runtime mode is preserved', reset.enabled === beforeEnabled);
  check('telemetry reset is audited', db.audits.length >= 1, String(db.audits.length));

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
