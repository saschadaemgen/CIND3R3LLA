/**
 * How hard she thinks before she speaks (CCB-S4-052, D-154).
 *
 * ── WHY THIS IS A DISPLAY AND NOT A DIAL ─────────────────────────────────────
 *
 * `qwen3:32b` is a reasoning model, and Ollama runs an unread reasoning pass by default for
 * models that support it. The briefing assumed that is what happens here and asked whether
 * her answers could be made better by controlling it.
 *
 * They cannot, and the measurement is unambiguous. It is recorded here rather than only in a
 * decision entry, because the number is what makes the console's sentence true.
 *
 * ── WHAT IS ACTUALLY SET ─────────────────────────────────────────────────────
 *
 * The application turns thinking off on every reply request - `reasoning_effort: 'none'` when
 * this was written, `think: false` since the transport moved to the native endpoint (D-252) -
 * and Ollama 0.32.6 honours both spellings on their respective endpoints. So thinking is
 * already OFF, deliberately, and has been since it was written. Nothing about this is the
 * runtime's default.
 *
 * ── AND WHY TURNING IT ON IS NOT AVAILABLE ───────────────────────────────────
 *
 * The reply is bounded by `max_tokens: 320`, and the reasoning pass spends the SAME budget.
 * Measured in the production request shape, over five substantive questions:
 *
 *   none    0 of 5 truncated,  0 of 5 unusable
 *   low     3 of 5 truncated,  3 of 5 unusable
 *   high    3 of 5 truncated,  3 of 5 unusable
 *
 * An unusable reply is an empty completion that fails the JSON schema, which in production
 * throws and falls back to the deterministic line. Enabling thinking today would silently
 * replace roughly three in five of her conversational answers with a canned one.
 *
 * So a per-kind control was NOT built. Shipping a dial that degrades three replies in five is
 * the opposite of what this project does, and raising `max_tokens` to make room is a separate
 * change with its own costs that nobody has asked for or measured.
 */

/**
 * What the application sends, on every request, today.
 *
 * The WIRE FIELD changed with the endpoint (CCB-S5-060, D-252): `reasoning_effort: 'none'`
 * was the OpenAI-compatible spelling and `think: false` is the native one. The DECISION is
 * unchanged - reasoning off, chosen by the application, on every request - and the console
 * states the field as it is actually sent, because a page showing a field the code no
 * longer contains is the drift this constant exists to prevent.
 */
export const REASONING_WIRE_FIELD = 'think: false' as const;

/** Where that value comes from, for the console to state plainly. */
export const REASONING_SOURCE =
  'sent by the application with every request, not read from the model';

export interface ReasoningMeasurement {
  label: string;
  /** Round trip in the production request shape, in milliseconds. */
  latencyMs: number;
  /** Characters of reasoning the model returned. */
  reasoningChars: number;
  /** Of five substantive questions, how many came back unusable. */
  unusableOfFive: number;
}

/**
 * What was measured, against `qwen3:32b` on Ollama 0.32.6, in the production request shape:
 * the real assembled system prompt, the JSON schema, `max_tokens: 320`, temperature 0.7.
 *
 * Held as data so the console shows the same numbers the decision entry cites, and so a check
 * can assert the console is not quoting figures that drifted from the record.
 */
export const REASONING_MEASUREMENTS: readonly ReasoningMeasurement[] = Object.freeze([
  { label: 'none (what she runs on)', latencyMs: 2782, reasoningChars: 0, unusableOfFive: 0 },
  { label: 'low', latencyMs: 16283, reasoningChars: 1463, unusableOfFive: 3 },
  { label: 'high', latencyMs: 16854, reasoningChars: 1228, unusableOfFive: 3 },
  { label: 'no parameter (runtime default)', latencyMs: 14770, reasoningChars: 889, unusableOfFive: 3 },
]);

/**
 * The context measurement, PER MODEL, and no longer "deliberately not applied" (D-231).
 *
 * ── WHY THE MODEL IS NOW A COLUMN ────────────────────────────────────────────
 *
 * Because the old table had no model column and every row was `qwen3:32b`, the 32768 spill
 * read as a fact about the CONTEXT WINDOW when it was a fact about that model's KV cache:
 * 64 layers x 8 KV heads x 128 dim x 2 x 2 bytes is 0.25 MiB per token, so 32768 costs
 * 8192 MiB of KV on a card that had about 2 GB spare. The whole deployment was then held at
 * 8192 on the strength of a number that does not transfer, and CCB-S5-045 measured that it
 * does not: on `qwen3:14b` there is NO spill at any window up to the model's 40960 maximum.
 *
 * A table that cannot say which model a row belongs to will make that mistake again.
 *
 * ── THE 32B ROWS STAY ────────────────────────────────────────────────────────
 *
 * They are the record of a real failure and they are still true of that model (D-191/D-193).
 * What changed is that they no longer describe what this deployment runs.
 */
export interface ContextMeasurement {
  model: string;
  numCtx: number;
  totalGb: number | null;
  vramGb: number | null;
  cpuGb: number | null;
  note: string;
}

export const CONTEXT_MEASUREMENTS: readonly ContextMeasurement[] = Object.freeze([
  // CCB-S4-052, on the 24 GB card. The model this deployment ran until CCB-S5-045.
  { model: 'qwen3:32b', numCtx: 8192, totalGb: 22.11, vramGb: 22.11, cpuGb: 0, note: 'fully on GPU, but leaves under 1 GB free' },
  {
    model: 'qwen3:32b',
    numCtx: 16384,
    totalGb: null,
    vramGb: null,
    cpuGb: null,
    note: 'failed to load in two attempts; not measured rather than guessed',
  },
  { model: 'qwen3:32b', numCtx: 32768, totalGb: 29.15, vramGb: 22.95, cpuGb: 6.21, note: 'SPILLED 6.21 GB to CPU' },

  // CCB-S5-045, same card, measured with the embedder NOT resident. Every window the model
  // supports fits entirely in VRAM, which is what the 32B rows above cannot tell you.
  { model: 'qwen3:14b', numCtx: 8192, totalGb: 10.47, vramGb: 10.47, cpuGb: 0, note: 'fully on GPU, 11.1 GB free' },
  { model: 'qwen3:14b', numCtx: 16384, totalGb: 11.83, vramGb: 11.83, cpuGb: 0, note: 'fully on GPU, 9.0 GB free' },
  { model: 'qwen3:14b', numCtx: 24576, totalGb: 13.19, vramGb: 13.19, cpuGb: 0, note: 'SERVED: fully on GPU, 7.7 GB free with the embedder resident' },
  { model: 'qwen3:14b', numCtx: 32768, totalGb: 14.55, vramGb: 14.55, cpuGb: 0, note: 'fully on GPU, 6.5 GB free' },
  { model: 'qwen3:14b', numCtx: 40960, totalGb: 15.90, vramGb: 15.90, cpuGb: 0, note: "fully on GPU at the model's maximum, 5.2 GB free" },
]);

/**
 * The window the Ollama host actually serves (D-231).
 *
 * ── IT IS NOT A SETTING THIS APPLICATION CAN MAKE, AND THAT WAS MEASURED ─────
 *
 * The transport is `/v1/chat/completions`, Ollama's OpenAI-compatible endpoint, and it
 * IGNORES an Ollama `options.num_ctx`: a request carrying `num_ctx: 24576` was verified to
 * load the model at 8192 and 10.47 GB rather than 24576 and 13.19 GB. So the only lever is
 * `OLLAMA_CONTEXT_LENGTH` on the host, and it needs an Ollama restart to take effect.
 *
 * That is why `verify:reasoning` still asserts no `num_ctx` anywhere in the codebase: it is
 * not restraint any more, it is the fact that setting one there would do nothing while
 * looking exactly like it had. Moving the transport to `/api/chat`, which does honour
 * options, is the change that would give this application its own window; it is not made
 * here because it touches the whole reply path.
 *
 * Held as data so the console and the "What it costs" card state the same number, and so a
 * check can catch this drifting from the host the way the old 32768 claims did.
 */
export const SERVED_CONTEXT_TOKENS = 24576;
