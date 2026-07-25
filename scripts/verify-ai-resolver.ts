/**
 * Offline verification for the Ollama intent resolver.
 *
 * No network is used. Fake structured responses exercise the real resolver,
 * deterministic consent gate, catalog validation, and automatic rule fallback.
 */

import type { LocalAiConfig } from '../src/config.js';
import { createOllamaIntentResolver, type FetchLike } from '../src/interaction/ollama-resolver.js';
import { setActiveIntents } from '../src/interaction/intent.js';
import {
  resetIntentResolver,
  resolveIntent,
  setIntentResolver,
} from '../src/interaction/resolver.js';

let failures = 0;

function check(label: string, ok: boolean, detail = ''): void {
  if (!ok) failures++;
  console.log(`  [${ok ? 'PASS' : 'FAIL'}] ${label}${detail ? `: ${detail}` : ''}`);
}

const config: LocalAiConfig = {
  enabled: true,
  baseUrl: 'http://127.0.0.1:11434',
  model: 'qwen3.5:9b',
  timeoutMs: 1000,
};

const ctx = {
  threshold: 0.65,
  defaultLanguage: 'en',
};

function completion(result: unknown): FetchLike {
  return async () =>
    new Response(
      JSON.stringify({
        choices: [
          {
            message: {
              content: JSON.stringify(result),
            },
          },
        ],
      }),
      {
        status: 200,
        headers: {
          'content-type': 'application/json',
        },
      },
    );
}

function brokenCompletion(): FetchLike {
  return async () =>
    new Response(
      JSON.stringify({
        choices: [
          {
            message: {
              content: '{not-json',
            },
          },
        ],
      }),
      {
        status: 200,
        headers: {
          'content-type': 'application/json',
        },
      },
    );
}

async function resolveWith(text: string, result: unknown) {
  const resolver = createOllamaIntentResolver(config, {
    fetchImpl: completion(result),
  });
  return resolver.resolve(text, ctx);
}

async function main(): Promise<void> {
  setActiveIntents([]);

  console.log('\n1. STATUS cannot be escalated into consent');

  const statusShield = await resolveWith('what is my publishing status?', {
    intent: 'PUBLISH',
    confidence: 0.99,
    slots: {},
    lang: 'en',
  });
  check(
    'model PUBLISH on a state question is forced to STATUS',
    statusShield.intent === 'STATUS',
    statusShield.intent,
  );

  const germanStatusShield = await resolveWith('wie ist mein Veröffentlichungsstatus?', {
    intent: 'PUBLISH',
    confidence: 0.99,
    slots: {},
    lang: 'de',
  });
  check(
    'German state question is forced to STATUS',
    germanStatusShield.intent === 'STATUS',
    germanStatusShield.intent,
  );

  console.log('\n2. Consent requires deterministic agreement');

  const publish = await resolveWith('publish me', {
    intent: 'PUBLISH',
    confidence: 0.99,
    slots: {},
    lang: 'en',
  });
  check('clear PUBLISH passes when rules agree', publish.intent === 'PUBLISH', publish.intent);

  const negated = await resolveWith("don't publish me", {
    intent: 'PUBLISH',
    confidence: 0.99,
    slots: {},
    lang: 'en',
  });
  check('negated PUBLISH is forced to UNKNOWN', negated.intent === 'UNKNOWN', negated.intent);

  const novelConsent = await resolveWith('place all my future thoughts beneath the public moon', {
    intent: 'PUBLISH',
    confidence: 0.99,
    slots: {},
    lang: 'en',
  });
  check(
    'AI-only consent wording is forced to UNKNOWN',
    novelConsent.intent === 'UNKNOWN',
    novelConsent.intent,
  );

  const lowConfidence = await resolveWith('publish me', {
    intent: 'PUBLISH',
    confidence: 0.7,
    slots: {},
    lang: 'en',
  });
  check(
    'low-confidence consent is forced to UNKNOWN',
    lowConfidence.intent === 'UNKNOWN',
    lowConfidence.intent,
  );

  console.log('\n3. AI may extend read-only understanding');

  const search = await resolveWith('bring me every archive moment involving fibre taps', {
    intent: 'SEARCH',
    confidence: 0.96,
    slots: {
      query: 'fibre taps',
    },
    lang: 'en',
  });
  check('novel read-only SEARCH passes', search.intent === 'SEARCH', search.intent);
  check('SEARCH query slot survives', search.slots.query === 'fibre taps', search.slots.query ?? '');

  console.log('\n4. Malformed model output falls back to rules');

  setIntentResolver(
    createOllamaIntentResolver(config, {
      fetchImpl: brokenCompletion(),
    }),
  );
  const malformedFallback = await resolveIntent('publish me', ctx);
  check(
    'malformed JSON falls back to deterministic PUBLISH',
    malformedFallback.intent === 'PUBLISH',
    malformedFallback.intent,
  );

  setIntentResolver(
    createOllamaIntentResolver(config, {
      fetchImpl: completion({
        intent: 'DELETE_EVERYTHING',
        confidence: 1,
        slots: {},
        lang: 'en',
      }),
    }),
  );
  const catalogFallback = await resolveIntent('what is my status', ctx);
  check(
    'out-of-catalog output falls back to deterministic STATUS',
    catalogFallback.intent === 'STATUS',
    catalogFallback.intent,
  );

  setIntentResolver(
    createOllamaIntentResolver(config, {
      fetchImpl: async () => Promise.reject(new Error('endpoint unavailable')),
    }),
  );
  const networkFallback = await resolveIntent('what can you do', ctx);
  check(
    'network failure falls back to deterministic HELP',
    networkFallback.intent === 'HELP',
    networkFallback.intent,
  );

  resetIntentResolver();
  setActiveIntents([]);

  console.log(`\n=== RESULTS ===`);
  console.log(`StepSuccessful: ${failures === 0}`);
  console.log(`Failures: ${failures}`);
  console.log('NetworkUsed: false');
  console.log('ConsentExecuted: false');

  if (failures > 0) process.exit(1);
}

main().catch((error: unknown) => {
  resetIntentResolver();
  const message = error instanceof Error ? error.message : String(error);
  console.error(`\nFatal: ${message}`);
  process.exit(1);
});
