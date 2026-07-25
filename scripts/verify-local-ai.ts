/**
 * Live end-to-end verification for the configured private Ollama resolver.
 *
 * This script only classifies fixed test phrases. It never executes a consent
 * action, touches the database, or sends a SimpleX message.
 */

import { loadLocalAiConfig } from '../src/config.js';
import { createOllamaIntentResolver } from '../src/interaction/ollama-resolver.js';
import { setActiveIntents, type Intent } from '../src/interaction/intent.js';

interface Case {
  label: string;
  text: string;
  expected: Intent;
  defaultLanguage: string;
  expectedQuery?: string;
}

const cases: Case[] = [
  {
    label: 'English publication state question',
    text: 'What is my publishing status?',
    expected: 'STATUS',
    defaultLanguage: 'en',
  },
  {
    label: 'English publish request',
    text: 'Publish my messages.',
    expected: 'PUBLISH',
    defaultLanguage: 'en',
  },
  {
    label: 'German publication state question',
    text: 'Wie ist mein Veröffentlichungsstatus?',
    expected: 'STATUS',
    defaultLanguage: 'de',
  },
  {
    label: 'German publish request',
    text: 'Veröffentliche meine Nachrichten.',
    expected: 'PUBLISH',
    defaultLanguage: 'de',
  },
  {
    label: 'English unpublish request',
    text: 'Withdraw my consent.',
    expected: 'UNPUBLISH',
    defaultLanguage: 'en',
  },
  {
    label: 'Negated consent request',
    text: "Don't publish me.",
    expected: 'UNKNOWN',
    defaultLanguage: 'en',
  },
  {
    label: 'Hypothetical consent discussion',
    text: 'What happens if I say publish me?',
    expected: 'UNKNOWN',
    defaultLanguage: 'en',
  },
  {
    label: 'Read-only archive search',
    text: 'Search the archive for fibre taps.',
    expected: 'SEARCH',
    defaultLanguage: 'en',
    expectedQuery: 'fibre taps',
  },
];

async function main(): Promise<void> {
  const config = loadLocalAiConfig();

  if (!config.enabled) {
    throw new Error('LOCAL_AI_ENABLED must be true for the live verification.');
  }

  setActiveIntents([]);
  const resolver = createOllamaIntentResolver(config);

  let failures = 0;
  const timings: number[] = [];

  console.log(`\nPrivate Ollama model: ${config.model}`);

  for (const test of cases) {
    const started = performance.now();
    const result = await resolver.resolve(test.text, {
      threshold: 0.65,
      defaultLanguage: test.defaultLanguage,
    });
    const elapsed = Math.round((performance.now() - started) * 10) / 10;
    timings.push(elapsed);

    const intentOk = result.intent === test.expected;
    const actualQuery = result.slots.query?.replace(/[.!?]+$/u, '').trim().toLowerCase();
    const expectedQuery = test.expectedQuery?.trim().toLowerCase();
    const queryOk = expectedQuery === undefined || actualQuery === expectedQuery;
    const ok = intentOk && queryOk;

    if (!ok) failures++;

    const detail =
      `${result.intent} @ ${result.confidence.toFixed(2)}, ` +
      `${elapsed.toFixed(1)} ms` +
      (result.slots.query ? `, query="${result.slots.query}"` : '');

    console.log(`  [${ok ? 'PASS' : 'FAIL'}] ${test.label}: ${detail}`);
  }

  const average =
    timings.length > 0
      ? Math.round((timings.reduce((sum, value) => sum + value, 0) / timings.length) * 10) / 10
      : 0;

  console.log('\n=== RESULTS ===');
  console.log(`StepSuccessful: ${failures === 0}`);
  console.log(`Failures: ${failures}`);
  console.log(`Cases: ${cases.length}`);
  console.log(`AverageLatencyMs: ${average.toFixed(1)}`);
  console.log('ConsentExecuted: false');

  if (failures > 0) process.exit(1);
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error('\n=== RESULTS ===');
  console.error('StepSuccessful: false');
  console.error(`Error: ${message}`);
  console.error('ConsentExecuted: false');
  process.exit(1);
});
