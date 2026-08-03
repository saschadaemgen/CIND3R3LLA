/**
 * The readiness gate (CCB-S4-021).
 *
 * One rule, isolated here so it is provable without a chat core: NOTHING SENDS BEFORE
 * THE RUNTIME IS READY.
 *
 * `startChat()` returns in about 42 ms and the core keeps subscribing behind it for up
 * to a minute. A send issued into that window took 10 s to reach its first receiver,
 * against 153 ms on a settled core (D-085). That is a factor of 65, and it is invisible
 * in testing: a slow reply reads as a slow bot, not as a bug, so the only defence is
 * that the send physically cannot be issued yet.
 *
 * Holding rather than refusing is deliberate. A member's question arriving during the
 * warm-up is captured normally; the answer waits and then goes. Refusing would drop it,
 * and the wait is bounded by the state machine's ceiling.
 */

export interface GateOptions {
  /** Resolves when the runtime is ready. Rejects if it stops before it ever was. */
  ready: () => Promise<void>;
  /** Whether the runtime is ALREADY ready, so a normal send logs nothing. */
  isReady: () => boolean;
  /** Called once per send that actually had to wait. */
  onHold?: (label: string) => void;
}

/**
 * Wrap a send so it cannot be issued before readiness.
 *
 * Generic in the send's shape so the runtime's real signature stays the one source of
 * truth: this file has no opinion about what a send takes or returns, only about when
 * it may happen.
 */
export function heldUntilReady<A extends unknown[], R>(
  send: (...args: A) => Promise<R>,
  options: GateOptions,
  label = 'send',
): (...args: A) => Promise<R> {
  return async (...args: A): Promise<R> => {
    if (!options.isReady()) {
      options.onHold?.(label);
    }
    await options.ready();
    return await send(...args);
  };
}
