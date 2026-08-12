/**
 * The bridge's live diagnostics (CCB-S5-032), on the conversation-log pattern.
 *
 * The DURABLE record is in the database: forwards, suppressions, resolutions.
 * What this holds is the operational residue the console's diagnostics card
 * wants and no table should: when the tick last ran, what it decided, and the
 * last error with its timestamp. IN MEMORY, capped, gone on restart -
 * diagnostics, not a record.
 */

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

export function noteBridgeError(where: string, error: unknown): void {
  lastError = {
    at: Date.now(),
    where,
    message: error instanceof Error ? error.message : String(error),
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
