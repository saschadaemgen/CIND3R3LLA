/**
 * The benign-noise allowlist (briefing §11; D-085).
 *
 * Once several profiles in one core relay the same group message to each other, two
 * error classes become routine. They are the core CORRECTLY discarding duplicates:
 *
 *     errorStore / duplicateGroupMessage
 *     errorAgent / INTERNAL / SEMsgNotFound "setMsgUserAck"
 *
 * ── WHY AN ALLOWLIST AND NOT A catch ────────────────────────────────────────
 *
 * The standing rule (CCB-S3-023) forbids swallowing failures, and a broad catch around
 * the event path would swallow the real ones alongside these two. So this matches
 * EXACTLY these two shapes and nothing else, counts them, and lets everything else
 * through untouched to be logged and surfaced. The count is shown in the admin, per the
 * same rule: a fallback that can mask a fault is counted and the count displayed.
 *
 * This is the pattern `scope-diagnostics.ts` and `media/failures.ts` already use.
 *
 * ── THE HONEST CAVEAT ABOUT THE SECOND PATTERN ──────────────────────────────
 *
 * `SEMsgNotFound` is not in the SDK's type package. It reaches TypeScript only as free
 * text inside `AgentErrorType.INTERNAL`, so the matcher below is written against a
 * STRING SHAPE THAT HAS NOT BEEN SEEN ON A LIVE CORE from this codebase. It is a
 * faithful transcription of D-085's transcription, which is not the same as verified.
 *
 * The consequence of being wrong is bounded and in the safe direction: a miss means a
 * benign error is logged as a real one, which is noise. It cannot go the other way,
 * because the matcher requires both the class AND the substring.
 */



/** What the allowlist decided about one error. */
export type NoiseClass = 'duplicate-group-message' | 'msg-not-found-ack' | null;

export interface BenignCounts {
  duplicateGroupMessage: number;
  msgNotFoundAck: number;
}

export function emptyBenignCounts(): BenignCounts {
  return { duplicateGroupMessage: 0, msgNotFoundAck: 0 };
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : null;
}

/**
 * Classify an error as one of the two known-benign shapes, or `null` for everything
 * else.
 *
 * Takes `unknown` on purpose. Errors arrive here from the SDK's own error channel with
 * no guaranteed shape, and a typed parameter would be a claim about them that nothing
 * checks.
 */
export function classifyBenign(err: unknown): NoiseClass {
  const root = asRecord(err);
  if (root === null) return null;

  // errorStore / duplicateGroupMessage
  const store = asRecord(root['storeError']);
  if (root['type'] === 'errorStore' && store?.['type'] === 'duplicateGroupMessage') {
    return 'duplicate-group-message';
  }

  // errorAgent / INTERNAL / SEMsgNotFound "setMsgUserAck". BOTH conditions required:
  // a bare INTERNAL is not benign, and this must not become a catch-all for it.
  const agent = asRecord(root['agentError']);
  if (root['type'] === 'errorAgent' && agent?.['type'] === 'INTERNAL') {
    const detail = agent['internalErr'];
    if (typeof detail === 'string' && detail.includes('SEMsgNotFound')) {
      return 'msg-not-found-ack';
    }
  }

  return null;
}

/**
 * Count a benign error, or report that it is not benign.
 *
 * Returns `true` when the caller may log at debug and move on; `false` when the caller
 * must surface it. Deliberately does not do the surfacing itself: this module decides
 * what is noise, and the caller decides what to do about the rest, so a change here
 * cannot silently alter how real failures are reported.
 */
export function noteIfBenign(err: unknown, counts: BenignCounts): boolean {
  const kind = classifyBenign(err);
  if (kind === null) return false;
  if (kind === 'duplicate-group-message') counts.duplicateGroupMessage++;
  else counts.msgNotFoundAck++;
  return true;
}
