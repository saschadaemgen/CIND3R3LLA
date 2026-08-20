/**
 * How long a reply takes on THIS host, and whether it survives the envelope (D-184, D-232).
 *
 * ── WHY THIS EXISTS ──────────────────────────────────────────────────────────
 *
 * Two bounds sit on every reply and neither is visible from the console.
 *
 * `LOCAL_AI_TIMEOUT_MS` wraps the WHOLE fetch in an AbortController, so it bounds model LOAD
 * plus generation rather than generation alone. The application sends no `keep_alive`, so
 * whether a request is cold is the server's decision, and a model switch or an Ollama restart
 * makes the next request cold by definition. A timeout that is comfortable warm and impossible
 * cold is invisible until the day somebody changes the model, which is exactly when it bites.
 *
 * `max_tokens: 320` bounds the reply, and the reply is a STRICT json_schema envelope. A model
 * that runs to the cap is cut off mid-string, the envelope never closes, `parseCompletion`
 * throws on the JSON, and in free conversation a throw is silence (see engine.ts, the
 * `spoken === null` branch). So the interesting failure is not slowness, it is a question whose
 * honest answer is long.
 *
 * ── IT SENDS THE PRODUCTION BODY, NOT AN APPROXIMATION ───────────────────────
 *
 * The first version of this script omitted `response_format` and `max_tokens` and measured a
 * request the application never sends. It reported a comfortable 7.3 s cold and would have
 * cleared the model of a failure it does cause. D-184's lesson is the transport's OWN request
 * shape, and this now mirrors `generateOllamaReply` field for field.
 *
 *   npx tsx scripts/measure-reply-latency.ts
 *   npx tsx scripts/measure-reply-latency.ts qwen3:14b
 */

import { systemPrompt, type AiReplyRequest } from '../src/interaction/ollama-reply.js';
import {
  DEFAULT_ORIGIN,
  DEFAULT_PERSONALITY,
  replyCharBudget,
  type BotPersonality,
} from '../src/interaction/personality.js';
import { seededPromptRules } from './seeded-rules.js';

const HOST = process.env['LOCAL_AI_BASE_URL'] ?? 'http://127.0.0.1:11434';
const MODEL = process.argv[2] ?? 'qwen3:14b';
const TIMEOUT_MS = Number(process.env['LOCAL_AI_TIMEOUT_MS'] ?? 15000);

/** The application's own cap. Named here so the report can attribute a failure to it. */
const MAX_TOKENS = 320;

const HISTORY_FENCE_LITERAL = '<<<UNTRUSTED-CHAT-HISTORY>>>';

interface Probe {
  label: string;
  question: string;
  history: { speaker: string; text: string }[];
}

/** A remembered thread, so the long-answer probes have something to be asked about. */
const THREAD = Array.from({ length: 14 }, (_, i) => ({
  speaker: i % 3 === 0 ? 'You' : `Member${String((i % 4) + 1)}`,
  text:
    i % 3 === 0
      ? 'Only what you tell me to publish is published, and you can take it back at any time.'
      : `Message ${String(i + 1)}: a normal group line about the archive, consent and what gets published.`,
}));

const PROBES: Probe[] = [
  { label: 'short answer, no history', question: 'what is the capital of France?', history: [] },
  { label: 'the SINA Box question', question: 'what is a SINA Box?', history: [] },
  {
    label: 'summarise history (the reported silence)',
    question: 'can you give me a summary of what was said in this chat yesterday?',
    history: THREAD,
  },
  {
    label: 'summarise, phrased to invite length',
    question:
      'please summarise everything that was discussed in this chat, point by point, in as much detail as you can.',
    history: THREAD,
  },
];

interface Outcome {
  ms: number;
  httpOk: boolean;
  finish: string;
  parsed: boolean;
  chars: number;
  note: string;
}

async function call(prompt: string, probe: Probe): Promise<Outcome> {
  return callWithBudget(prompt, probe, 500);
}

async function callWithBudget(prompt: string, probe: Probe, maxChars: number): Promise<Outcome> {
  const started = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(`${HOST}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      signal: controller.signal,
      body: JSON.stringify({
        model: MODEL,
        messages: [
          { role: 'system', content: prompt },
          {
            role: 'user',
            content: JSON.stringify({
              replyKind: 'conversation',
              language: 'en',
              memberMessage: probe.question,
              ...(probe.history.length
                ? {
                    chatHistory: probe.history.map(
                      (l) => `${HISTORY_FENCE_LITERAL}${l.speaker}: ${l.text}${HISTORY_FENCE_LITERAL}`,
                    ),
                  }
                : {}),
              requiredLiterals: [],
            }),
          },
        ],
        stream: false,
        temperature: 0.7,
        max_tokens: MAX_TOKENS,
        reasoning_effort: 'none',
        response_format: {
          type: 'json_schema',
          json_schema: {
            name: 'cinderella_reply',
            strict: true,
            schema: {
              type: 'object',
              additionalProperties: false,
              required: ['reply'],
              properties: { reply: { type: 'string', minLength: 1, maxLength: maxChars } },
            },
          },
        },
      }),
    });

    const ms = Date.now() - started;
    if (!res.ok) return { ms, httpOk: false, finish: String(res.status), parsed: false, chars: 0, note: `HTTP ${String(res.status)}` };

    const json = (await res.json()) as {
      choices?: { message?: { content?: string }; finish_reason?: string }[];
    };
    const content = json.choices?.[0]?.message?.content ?? '';
    const finish = json.choices?.[0]?.finish_reason ?? 'unknown';

    // Exactly what `parseCompletion` does: JSON.parse, then read `reply`.
    try {
      const decoded = JSON.parse(content) as { reply?: unknown };
      const reply = typeof decoded.reply === 'string' ? decoded.reply : '';
      return { ms, httpOk: true, finish, parsed: true, chars: reply.length, note: reply.slice(0, 80) };
    } catch {
      return {
        ms,
        httpOk: true,
        finish,
        parsed: false,
        chars: 0,
        note: `MALFORMED JSON, ${String(content.length)} chars, tail: ${JSON.stringify(content.slice(-40))}`,
      };
    }
  } catch (error) {
    return {
      ms: Date.now() - started,
      httpOk: false,
      finish: 'aborted',
      parsed: false,
      chars: 0,
      note: error instanceof Error ? error.message : String(error),
    };
  } finally {
    clearTimeout(timer);
  }
}

async function unload(): Promise<void> {
  await fetch(`${HOST}/api/generate`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ model: MODEL, keep_alive: 0, prompt: '' }),
  });
  await new Promise((r) => setTimeout(r, 5000));
}

async function main(): Promise<void> {
  const rules = await seededPromptRules();
  const personality: BotPersonality = {
    ...DEFAULT_PERSONALITY,
    baseCharacter: 'Precise, dry, and unhurried.',
    origin: DEFAULT_ORIGIN,
  };

  console.log('');
  console.log(`model:  ${MODEL}`);
  console.log(`bounds: LOCAL_AI_TIMEOUT_MS ${String(TIMEOUT_MS)} ms (wraps load + generation), max_tokens ${String(MAX_TOKENS)}`);
  console.log('');

  console.log('COLD START (what a model switch or an Ollama restart produces)');
  await unload();
  {
    const request: AiReplyRequest = {
      kind: 'conversation', lang: 'en', memberMessage: PROBES[0]!.question, deterministicDraft: '',
      mode: 'conversation', rules, personality,
      identity: { name: 'CIND3R3LLA', label: '(SimpleX AI Bot)', notMyNames: [], model: MODEL },
      now: { at: new Date('2026-08-20T12:00:00.000Z'), timeZone: 'UTC' },
      history: [], historyWindowMinutes: 30,
    };
    const out = await call(systemPrompt(request, replyCharBudget(5)), PROBES[0]!);
    console.log(`  ${String(out.ms).padStart(6)} ms  ${out.ms > TIMEOUT_MS ? 'OVER BOUND' : 'within bound'}  finish=${out.finish}  parsed=${String(out.parsed)}`);
  }
  console.log('');

  // ── THE BUDGET AGAINST THE TOKEN CAP ───────────────────────────────────────
  //
  // `max_tokens` is a fixed 320 while `replyCharBudget` runs to 1400. At roughly 3.2
  // characters per token that is 438 tokens of budget against a 320-token cap, so at the top
  // of the verbosity dial a reply that USES its budget cannot finish. When the cap binds the
  // JSON envelope is cut mid-string, `parseCompletion` throws, and free conversation is
  // silent. This sweep is the demonstration; the arithmetic alone would be an argument.
  console.log('VERBOSITY AGAINST THE 320-TOKEN CAP  (summary question, 2 runs each)');
  const summary = PROBES[2]!;
  for (const verbosity of [5, 8, 9, 10]) {
    const budget = replyCharBudget(verbosity);
    const dialled: BotPersonality = { ...personality, verbosity };
    const request: AiReplyRequest = {
      kind: 'conversation', lang: 'en', memberMessage: summary.question, deterministicDraft: '',
      mode: 'conversation', rules, personality: dialled,
      identity: { name: 'CIND3R3LLA', label: '(SimpleX AI Bot)', notMyNames: [], model: MODEL },
      now: { at: new Date('2026-08-20T12:00:00.000Z'), timeZone: 'UTC' },
      history: summary.history, historyWindowMinutes: 30,
    };
    const prompt = systemPrompt(request, budget);
    const needed = Math.ceil(budget / 3.2);
    console.log(
      `\n  verbosity ${String(verbosity).padStart(2)}  budget ${String(budget).padStart(4)} chars  ~${String(needed)} tokens needed vs cap ${String(MAX_TOKENS)}${needed > MAX_TOKENS ? '  <<< budget exceeds the cap' : ''}`,
    );
    for (let i = 0; i < 2; i++) {
      const out = await callWithBudget(prompt, summary, budget);
      console.log(
        `    ${String(out.ms).padStart(6)} ms  finish=${out.finish.padEnd(6)}  ${out.parsed ? `reply ${String(out.chars)} chars` : `SILENCE: ${out.note}`}`,
      );
    }
  }
  console.log('');

  console.log('WARM, PER QUESTION SHAPE  (3 runs each)');
  for (const probe of PROBES) {
    const request: AiReplyRequest = {
      kind: 'conversation', lang: 'en', memberMessage: probe.question, deterministicDraft: '',
      mode: 'conversation', rules, personality,
      identity: { name: 'CIND3R3LLA', label: '(SimpleX AI Bot)', notMyNames: [], model: MODEL },
      now: { at: new Date('2026-08-20T12:00:00.000Z'), timeZone: 'UTC' },
      history: probe.history, historyWindowMinutes: 30,
    };
    const prompt = systemPrompt(request, replyCharBudget(5));
    console.log(`\n  ${probe.label}   (prompt ${String(prompt.length)} chars)`);
    let silent = 0;
    for (let i = 0; i < 3; i++) {
      const out = await call(prompt, probe);
      const verdict = out.parsed ? 'reply' : 'SILENCE (engine sends nothing)';
      if (!out.parsed) silent++;
      console.log(
        `    ${String(out.ms).padStart(6)} ms  finish=${out.finish.padEnd(6)} ${verdict}  ${out.parsed ? `${String(out.chars)} chars` : out.note}`,
      );
    }
    if (silent > 0) console.log(`    >>> ${String(silent)} of 3 produced NO REPLY AT ALL`);
  }
  console.log('');
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
