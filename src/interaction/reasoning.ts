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
 * The application sends `reasoning_effort: 'none'` on every request, and Ollama 0.32.6 honours
 * it on the OpenAI-compatible endpoint. So thinking is already OFF, deliberately, and has been
 * since it was written. Nothing about this is the runtime's default.
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

/** What the application sends, on every request, today. */
export const REASONING_EFFORT_SENT = 'none' as const;

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
 * The context measurement, reported and deliberately not applied.
 *
 * The operator has been burned once by a context change pushing the model onto the CPU, so
 * this is a number for him to decide with rather than a setting anybody moved.
 */
export const CONTEXT_MEASUREMENTS = Object.freeze([
  { numCtx: 8192, totalGb: 22.11, vramGb: 22.11, cpuGb: 0, note: 'production, fully on GPU' },
  {
    numCtx: 16384,
    totalGb: null,
    vramGb: null,
    cpuGb: null,
    note: 'failed to load in two attempts; not measured rather than guessed',
  },
  { numCtx: 32768, totalGb: 29.15, vramGb: 22.95, cpuGb: 6.21, note: 'SPILLED 6.21 GB to CPU' },
]);
