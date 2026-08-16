/**
 * Offline verification for individualized local-AI reply wording.
 *
 * No external network, SimpleX message, consent write, or production database is
 * used. Deterministic drafts remain the fallback in every failure case.
 */

import type { LocalAiConfig } from '../src/config.js';
import type { Queryable } from '../src/db/pool.js';
import {
  AiRuntimeService,
  personalizeAiReply,
  resetAiRuntimeForTests,
} from '../src/interaction/ai-runtime.js';
import { generateOllamaReply, type AiReplyRequest } from '../src/interaction/ollama-reply.js';
import { seededPromptRules } from './seeded-rules.js';
import type { FetchLike } from '../src/interaction/ollama-resolver.js';
import { log } from '../src/log.js';

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

    throw new Error(`Unexpected query in AI reply harness: ${text}`);
  }
}

const config: LocalAiConfig = {
  enabled: true,
  baseUrl: 'http://127.0.0.1:11434',
  model: 'qwen3.5:9b',
  timeoutMs: 1000,
};

let nextReply = '';
let inferenceAvailable = true;
let completionCalls = 0;

function completion(reply: string): Response {
  return new Response(
    JSON.stringify({
      choices: [
        {
          message: {
            content: JSON.stringify({ reply }),
          },
        },
      ],
    }),
    { status: 200, headers: { 'content-type': 'application/json' } },
  );
}

const fakeFetch: FetchLike = async (input) => {
  const url = new URL(String(input));

  if (url.pathname === '/api/tags') {
    return new Response(JSON.stringify({ models: [{ name: 'qwen3.5:9b', model: 'qwen3.5:9b' }] }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  }

  if (url.pathname === '/v1/chat/completions') {
    completionCalls++;
    if (!inferenceAvailable) return new Response('unavailable', { status: 503 });
    return completion(nextReply);
  }

  return new Response('not found', { status: 404 });
};

const rules = await seededPromptRules();

const statusRequest: AiReplyRequest = {
  kind: 'status',
  lang: 'en',
  memberMessage: 'Cinderella, what is my publishing status?',
  deterministicDraft:
    'I keep 216 of your messages. 108 of them are public and the rest stay private.',
  mode: 'free',
  rules,
  requiredLiterals: ['216', '108'],
  blockedLiterals: ['Sascha'],
};

async function main(): Promise<void> {
  console.log('\n1. Free replies are individual but keep deterministic facts');
  nextReply =
    'Your archive currently holds 216 messages, and 108 are public. The rest stays private.';
  const status = await generateOllamaReply(config, statusRequest, fakeFetch);
  check('the model wording is used', status.startsWith('Your archive'));
  check('the total survives exactly', status.includes('216'));
  check('the public count survives exactly', status.includes('108'));

  console.log('\n2. Lost facts are rejected so the caller can use its standard reply');
  nextReply = 'Everything looks fine from here.';
  let missingFactRejected = false;
  try {
    await generateOllamaReply(config, statusRequest, fakeFetch);
  } catch {
    missingFactRejected = true;
  }
  check('a reply missing deterministic counts is rejected', missingFactRejected);

  console.log('\n3. Display names are taken OUT of generated body text (D-227)');
  // This used to assert a rejection. The strip decision (D-227) keeps the guarantee - the
  // name does not reach the member - and keeps the answer: the vocative is removed and the
  // rest ships, counted on the Diagnostics page. verify:name-guard drives the full matrix.
  nextReply = 'Sascha, I keep 216 messages, with 108 public.';
  const strippedReply = await generateOllamaReply(config, statusRequest, fakeFetch);
  check(
    'the vocative is removed and the reply ships without the name',
    !strippedReply.toLowerCase().includes('sascha') && strippedReply.includes('I keep 216'),
  );
  check(
    'the deterministic counts survive the strip',
    strippedReply.includes('216') && strippedReply.includes('108'),
  );

  console.log('\n4. Locked operational text is appended unchanged');
  const protectedText =
    'More than one HEX is known. Answer with the number that matches the asset you mean.';
  nextReply = 'That ticker has a few faces, so let us pin down the right one.';
  const locked = await generateOllamaReply(
    config,
    {
      kind: 'priceAmbiguous',
      lang: 'en',
      memberMessage: 'Cinderella, price of HEX?',
      deterministicDraft: protectedText,
      mode: 'locked',
      rules,
      blockedLiterals: ['Alice'],
    },
    fakeFetch,
  );
  check('the individualized lead is present', locked.startsWith('That ticker'));
  check('the protected text is byte-for-byte intact', locked.endsWith(protectedText));

  console.log('\n5. Output sanitation removes every forbidden dash character');
  const forbiddenDashes = [0x2013, 0x2014, 0x2015].map((codePoint) =>
    String.fromCodePoint(codePoint),
  );
  for (const forbiddenDash of forbiddenDashes) {
    nextReply = `I keep 216 messages ${forbiddenDash} with 108 public.`;
    const sanitized = await generateOllamaReply(config, statusRequest, fakeFetch);
    check(
      `the reply removes U+${forbiddenDash.codePointAt(0)?.toString(16).toUpperCase()}`,
      !forbiddenDashes.some((character) => sanitized.includes(character)),
      sanitized,
    );
  }

  console.log('\n6. Unicode wording survives without mojibake');
  nextReply = 'Dein Archiv enthält 216 Beiträge. 108 davon sind öffentlich. 🔐';
  const unicode = await generateOllamaReply(config, statusRequest, fakeFetch);
  check('German umlauts survive', unicode.includes('enthält') && unicode.includes('Beiträge'));
  check('emoji survives', unicode.includes('🔐'));

  console.log('\n7. Runtime mode controls wording without affecting the fallback');
  const db = new MemoryDb();
  const runtime = await AiRuntimeService.load(db, config, { fetchImpl: fakeFetch });

  nextReply = 'The ledger says 216 messages in total, and 108 are currently in the public light.';
  const active = await personalizeAiReply(statusRequest);
  check('active local AI returns individualized wording', active?.includes('ledger') === true);

  await runtime.setEnabled(false, 'reply-test');
  const beforeRules = completionCalls;
  const rulesOnly = await personalizeAiReply(statusRequest);
  check('rules mode asks for deterministic fallback', rulesOnly === null);
  check('rules mode makes no reply-model request', completionCalls === beforeRules);

  await runtime.setEnabled(true, 'reply-test');
  inferenceAvailable = false;
  const outage = await personalizeAiReply(statusRequest);
  check('an Ollama outage asks for deterministic fallback', outage === null);
  inferenceAvailable = true;

  console.log('\n8. A successful wording is visible in the log, and says nothing private');
  //
  // CCB-S4-026. Only the FAILURE path used to log, so a working model lane and a lane
  // that was never called looked identical from the journal: both silent. That cost a
  // briefing. The success line must exist, and must carry none of the content.
  const logged: string[] = [];
  const realInfo = log.info.bind(log);
  (log as unknown as { info: (m: string, meta?: unknown) => void }).info = (m, meta) => {
    logged.push(`${m} ${meta ? JSON.stringify(meta) : ''}`);
  };
  nextReply = 'The ledger holds 216 entries, 108 of them public.';
  await personalizeAiReply(statusRequest);
  (log as unknown as { info: unknown }).info = realInfo;

  const successLine = logged.find((l) => l.startsWith('Local AI worded a reply'));
  check('a successful wording logs that the model was used', successLine !== undefined);
  check(
    'and names the reply kind, the mode and the model',
    Boolean(
      successLine?.includes(statusRequest.kind) &&
        successLine?.includes(statusRequest.mode) &&
        successLine?.includes('qwen3.5:9b'),
    ),
    successLine ?? '(no line)',
  );
  check(
    'but never the member message, the draft, or what the model wrote',
    Boolean(
      successLine &&
        !successLine.includes(statusRequest.memberMessage) &&
        !successLine.includes(statusRequest.deterministicDraft) &&
        !successLine.includes('ledger holds'),
    ),
  );

  resetAiRuntimeForTests();

  console.log('\n=== RESULTS ===');
  console.log(`StepSuccessful: ${failures === 0}`);
  console.log(`Failures: ${failures}`);
  console.log('NetworkUsed: false');
  console.log('ConsentExecuted: false');
  console.log('DeterministicFallbackRetained: true');

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
