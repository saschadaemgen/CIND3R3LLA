/**
 * The bridge's live diagnostics (CCB-S5-032), on the conversation-log pattern.
 *
 * The DURABLE record is in the database: forwards, suppressions, resolutions.
 * What this holds is the operational residue the console's diagnostics card
 * wants and no table should: when the tick last ran, what it decided, and the
 * last error with its timestamp. IN MEMORY, capped, gone on restart -
 * diagnostics, not a record.
 */

import { describeChatError } from '../../bot/runtime/chat-error.js';

export interface BridgeTickNote {
  /** Epoch ms. */
  at: number;
  mappingId: number;
  due: 'interval' | 'count' | null;
  announced: number;
  resolved: number;
}

export interface BridgeErrorNote {
  at: number;
  where: string;
  message: string;
}

const LIMIT = 50;

const ticks: BridgeTickNote[] = [];
let lastTickAt: number | null = null;
let lastError: BridgeErrorNote | null = null;

export function noteBridgeTick(note: BridgeTickNote): void {
  lastTickAt = note.at;
  // Quiet ticks (not due, or due with nothing pending) are counted in
  // lastTickAt and not kept as rows: fifty lines of "nothing" would push the
  // interesting ones out, and "the tick is alive" is one timestamp's worth of
  // information.
  if (note.due === null || (note.announced === 0 && note.resolved === 0)) return;
  ticks.unshift(note);
  if (ticks.length > LIMIT) ticks.length = LIMIT;
}

export function noteBridgeTickAlive(at: number): void {
  lastTickAt = at;
}

/**
 * The last thing that went wrong, as one line for the console's Diagnostics card.
 *
 * Through `describeChatError` (CCB-S5-018) rather than `error.message`: every failure
 * on this path can be an SDK `ChatAPIError`, whose message is the literal pointer
 * "Chat command error (see chatError property)" with the actual fault on `.chatError`.
 * This card is one of the three surfaces an operator has, and it was printing the
 * pointer. A non-SDK error reads exactly as it did before, so nothing is lost by
 * routing every note through the describer.
 */
export function noteBridgeError(where: string, error: unknown): void {
  lastError = {
    at: Date.now(),
    where,
    message: describeChatError(error),
  };
}

export function bridgeDiagnostics(): {
  lastTickAt: number | null;
  lastError: BridgeErrorNote | null;
  recent: BridgeTickNote[];
} {
  return { lastTickAt, lastError, recent: [...ticks] };
}

/** Test hook. */
export function clearBridgeLog(): void {
  ticks.length = 0;
  lastTickAt = null;
  lastError = null;
}
