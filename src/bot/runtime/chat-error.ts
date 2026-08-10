/**
 * What a SimpleX chat command error actually says (CCB-S5-018).
 *
 * ── THE DEFECT THIS EXISTS FOR ───────────────────────────────────────────────
 *
 * The SDK's `ChatCommandError` has the message "Chat command error (see chatError property)"
 * and puts the useful part on `.chatError`. Every catch site in this repository did
 * `err instanceof Error ? err.message : String(err)`, so what reached the operator's
 * dashboard was, verbatim:
 *
 *     Could not read the groups of bot "Rick Sanchez" ... : Chat command error (see
 *     chatError property)
 *
 * An instruction to look at a property, on a surface that cannot look at properties. The
 * operator reported it as an error with no error in it, and he was right: the message names
 * where the answer is and then does not go there.
 *
 * ── WHY IT DUCK-TYPES INSTEAD OF IMPORTING THE SDK ───────────────────────────
 *
 * `verify:runtime-host` asserts that the runtime's SDK-free files stay SDK-free, and this is
 * a describer, not a caller: it needs the SHAPE of the error, never the library. Importing
 * `simplex-chat` for an `instanceof` would put the SDK into a file whose whole value is being
 * drivable without a core.
 *
 * ── AND WHY `.response` IS INCLUDED ──────────────────────────────────────────
 *
 * `core.ts` already records that the SDK throws with `.chatError` UNDEFINED and the
 * successful answer on `.response` for at least one command (`apiChatItemReaction`, upstream
 * PR #7109). So an error carrying no `chatError` is not necessarily an error carrying no
 * information, and a describer that only read `chatError` would reproduce the same blank in a
 * different place.
 */

/** The shape the SDK throws. Duck-typed on purpose; see above. */
interface ChatCommandErrorish {
  message?: unknown;
  chatError?: unknown;
  response?: unknown;
}

/** JSON that cannot throw and cannot run away with the log line. */
function brief(value: unknown, max = 400): string | null {
  if (value === undefined || value === null) return null;
  try {
    const text = typeof value === 'string' ? value : JSON.stringify(value);
    if (typeof text !== 'string' || text === '' || text === '{}') return null;
    return text.length > max ? `${text.slice(0, max)}...` : text;
  } catch {
    return null;
  }
}

/**
 * One sentence naming what actually went wrong, for a log line and for the dashboard.
 *
 * Falls back to the plain message when there is nothing richer, so a non-SDK error reads
 * exactly as it did before and nothing is lost by routing every catch site through here.
 */
export function describeChatError(err: unknown): string {
  const base = err instanceof Error ? err.message : String(err);
  if (typeof err !== 'object' || err === null) return base;

  const e = err as ChatCommandErrorish;
  const detail = brief(e.chatError);
  const response = brief(e.response, 200);

  // The SDK's own message is a pointer rather than a description, so it is dropped once
  // there is something to point AT. Keeping both would put "see chatError property" in
  // front of the chatError, which is how the original line came to read as noise.
  const pointerOnly = base.includes('see chatError property');

  const parts: string[] = [];
  if (detail !== null) parts.push(detail);
  else if (!pointerOnly) parts.push(base);
  else parts.push('the SDK reported a chat command error and carried no detail with it');

  if (detail === null && response !== null) {
    // The `apiChatItemReaction` shape: no chatError, a successful response. Saying so is
    // the difference between "unknown failure" and "the command may in fact have worked".
    parts.push(`the command answered: ${response}`);
  }
  return parts.join('; ');
}
