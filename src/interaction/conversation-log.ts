/**
 * Free-conversation diagnostics (CCB-S4-031 gap 5, D-135).
 *
 * ── WHY THIS EXISTS ─────────────────────────────────────────────────────────
 *
 * The near-miss log records what she IGNORED, so Diagnostics showed only her silences.
 * Since CCB-S4-027 the conversational path produces a large share of what she actually
 * says, and it recorded nothing at all: an operator could not tell whether she had
 * answered ten people or none, whether the model was slow, or whether the rate limit was
 * quietly eating her replies. A path that is invisible when it works and invisible when
 * it is throttled is the same problem the near-miss log was built to solve, one lane over.
 *
 * ── WHAT IS AND IS NOT RECORDED ─────────────────────────────────────────────
 *
 * CONTENT-FREE, and more strictly than the near-miss log beside it. That log keeps an
 * excerpt and a display name because its whole job is showing the operator which message
 * was wrongly ignored. This one answers "did it fire, when, where, how fast, and did it
 * reach anybody", and none of those questions needs a word the member wrote or a word she
 * said. So there is no excerpt, no member name and no member id here, matching the rule
 * the reply-wording log already follows: it says THAT the model worded a reply, never what
 * anybody said.
 *
 * The group id stays, because "which chat" is one of the questions and a group is not a
 * person.
 *
 * IN MEMORY ONLY, capped, gone on restart. Diagnostics, not a record, exactly like the
 * near-miss buffer and for the same reasons: a module-level buffer because the admin
 * server is built before the capture worker and there is one of each per process.
 */

/** What became of one free-conversation attempt. */
export type ConversationOutcome =
  /** The model spoke and the reply was sent. */
  | 'spoken'
  /** The model spoke and the rate limit dropped the reply before it left. */
  | 'rate-limited'
  /** The model could not speak. The deterministic fallback decided what happened next. */
  | 'unavailable';

export interface ConversationEvent {
  /** Epoch ms. */
  at: number;
  /** Which bot handled it (CCB-S5-006). See `near-misses.ts` for why. */
  botProfileId?: number | null;
  botName?: string | null;
  groupId: number;
  outcome: ConversationOutcome;
  /** How long the model call took, whatever its outcome. */
  latencyMs: number;
}

/** How many to keep. Diagnostics, not history. */
const LIMIT = 50;

/** Operator-facing explanation of each outcome, shown in the console. */
export const CONVERSATION_OUTCOMES: Record<ConversationOutcome, string> = {
  spoken: 'She answered in her own words',
  'rate-limited': 'Model answered, but the reply limit dropped it',
  unavailable: 'Model could not speak; the guards decided what followed',
};

const buffer: ConversationEvent[] = [];

export function recordConversation(entry: ConversationEvent): void {
  buffer.unshift(entry);
  if (buffer.length > LIMIT) buffer.length = LIMIT;
}

/** Most recent first. */
export function recentConversations(limit = LIMIT): ConversationEvent[] {
  return buffer.slice(0, limit);
}

/** Counts for the summary line, over whatever is still in the buffer. */
export function conversationSummary(): {
  total: number;
  spoken: number;
  rateLimited: number;
  unavailable: number;
  averageLatencyMs: number | null;
} {
  const spoken = buffer.filter((e) => e.outcome === 'spoken').length;
  const rateLimited = buffer.filter((e) => e.outcome === 'rate-limited').length;
  const unavailable = buffer.filter((e) => e.outcome === 'unavailable').length;
  const averageLatencyMs =
    buffer.length === 0
      ? null
      : Math.round((buffer.reduce((sum, e) => sum + e.latencyMs, 0) / buffer.length) * 10) / 10;

  return { total: buffer.length, spoken, rateLimited, unavailable, averageLatencyMs };
}

/** Test hook — the harness asserts on a clean buffer. */
export function clearConversations(): void {
  buffer.length = 0;
}
