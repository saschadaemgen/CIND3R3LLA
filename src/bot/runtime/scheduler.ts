/**
 * The serialized command scheduler (briefing §6.5, §8; D-085).
 *
 * ── THE FAILURE THIS PREVENTS ────────────────────────────────────────────────
 *
 * Every SimpleX command that does not take an explicit `userId` executes as whatever
 * profile is currently active. Making a profile active is itself a command, so the
 * sequence "become A, then send" is two calls with a gap in the middle. Run two of
 * those concurrently and the second `apiSetActiveUser` lands inside the first pair's
 * gap: the first command then executes as the wrong profile.
 *
 * IT DOES NOT RAISE. The core is asked to do something legal by a profile that is
 * genuinely active, so there is no error to report. Measured (D-085): three parallel
 * set-active-user-plus-connect batches produced exactly one success per batch, 7 of 20
 * operations, the failures falling in a regular gap pattern. Serializing the issuing
 * step produced 20 of 20.
 *
 * There is no serialization anywhere in the SDK to fall back on: `sendChatCmd` is a
 * bare pass-through to the native addon. This class is the only thing standing between
 * the runtime and silent cross-profile execution.
 *
 * ── SERIALIZE THE ISSUING, NOT THE WAITING ──────────────────────────────────
 *
 * The critical section is "select user, issue command". It ends when the core has
 * accepted and answered the command, which is what awaiting the SDK call means. It
 * does NOT extend to the operation completing: delivery, receipts and the rest arrive
 * asynchronously as events, are not awaited here, and cannot be affected by a later
 * active-user change. So many operations are in flight at once even though commands
 * are issued one at a time. Serializing the completion as well would collapse
 * throughput for no benefit (§8).
 *
 * ── WHY THE ACTIVE USER IS TRACKED HERE ─────────────────────────────────────
 *
 * Asking the core who is active costs a round trip per command. This class owns the
 * transition, so it can know: it is the only writer, and it records what it wrote.
 * That bookkeeping is only sound while it IS the only writer, which is why
 * {@link ActiveUserCore} exposes nothing else, and why any code path that reaches the
 * raw core sideways invalidates it. {@link ActiveUserScheduler.invalidate} exists for
 * the one honest case: something outside changed the active user and said so.
 */

import { log } from '../../log.js';
import type { ActiveUserCore, RuntimeCounters } from './types.js';

export interface SchedulerOptions {
  /**
   * Warn when a command waits longer than this for the lock. Not a timeout: a slow
   * queue is a throughput signal, not a fault, and cancelling a queued command would
   * turn a slow system into a broken one.
   */
  slowWaitMs?: number;
  /**
   * How long ONE command may run before it is abandoned.
   *
   * ── WHY THIS IS A TIMEOUT WHERE THE WAIT DELIBERATELY IS NOT ───────────────
   *
   * A slow QUEUE is a throughput signal and cancelling a queued command would turn a slow
   * system into a broken one, which is why {@link SchedulerOptions.slowWaitMs} only warns.
   * A command that never ANSWERS is the opposite, and the difference is the tail: `run`
   * chains every command onto `this.tail`, so one call that never settles stops every
   * command behind it, for the life of the process, with nothing timing out and nothing
   * logged. That is not a slow bot, it is a bot that has stopped, and it looks from outside
   * exactly like silence: the reply was worded, the send was issued, and nothing arrived.
   *
   * Abandoning may leave the core to finish the command later. That is the right trade
   * against a permanently poisoned chain: one lost message against every message.
   */
  commandTimeoutMs?: number;
  /** Shared counter object, so the admin can show one set of runtime numbers. */
  counters?: RuntimeCounters;
  /** Raised when a command is abandoned, so it reaches the admin and not only the log. */
  onTimeout?: (label: string, ms: number) => void;
}

const DEFAULT_SLOW_WAIT_MS = 5_000;

/**
 * Generous, because the core legitimately takes seconds: a send on a settled core measured
 * 153 ms and one issued into the warm-up took 10 s (D-085). This is not a latency budget, it
 * is the line past which a command is not coming back.
 */
const DEFAULT_COMMAND_TIMEOUT_MS = 60_000;

/** Thrown when a command is abandoned so the chain can move on. */
export class SchedulerTimeoutError extends Error {
  constructor(label: string, ms: number) {
    super(
      `Runtime: the command "${label}" did not answer within ${String(ms)} ms and was ` +
        `abandoned so the queue behind it could continue. The message it carried did not go ` +
        `out.`,
    );
    this.name = 'SchedulerTimeoutError';
  }
}

export class ActiveUserScheduler {
  private readonly core: ActiveUserCore;
  private readonly slowWaitMs: number;
  private readonly commandTimeoutMs: number;
  private readonly onTimeout: ((label: string, ms: number) => void) | undefined;
  private readonly counters: RuntimeCounters | undefined;

  /**
   * The tail of the issue queue. Every `run` chains onto it, which is what makes the
   * critical sections strictly sequential without a separate lock object.
   */
  private tail: Promise<unknown> = Promise.resolve();

  /** Who the scheduler last made active. `undefined` means "unknown, must set". */
  private activeUserId: number | undefined;

  /** Depth of the queue, including the command currently issuing. */
  private queued = 0;

  constructor(core: ActiveUserCore, options: SchedulerOptions = {}) {
    this.core = core;
    this.slowWaitMs = options.slowWaitMs ?? DEFAULT_SLOW_WAIT_MS;
    this.commandTimeoutMs = options.commandTimeoutMs ?? DEFAULT_COMMAND_TIMEOUT_MS;
    this.onTimeout = options.onTimeout;
    this.counters = options.counters;
  }

  /** Queue depth, for the admin and for tests. */
  get depth(): number {
    return this.queued;
  }

  /** Who the scheduler believes is active. For assertions; not authoritative. */
  get currentUserId(): number | undefined {
    return this.activeUserId;
  }

  /**
   * Forget the tracked active user, forcing the next command to set it explicitly.
   *
   * Call after anything that could have changed the active user outside this
   * scheduler, including a core restart. Cheap insurance: the cost is one extra
   * command, and the alternative is every subsequent command running as the wrong
   * profile with nothing raised.
   */
  invalidate(): void {
    this.activeUserId = undefined;
  }

  /**
   * Run `fn` with `userId` active, exclusively.
   *
   * Returns whatever `fn` returns, VERBATIM. This matters beyond tidiness: outgoing
   * messages are archived from the command's return value rather than from the event
   * stream (briefing §6.6), so a scheduler that wrapped results in a job handle or a
   * status object would break the archive of her own messages without any test that
   * looks at sends failing.
   */
  async run<T>(userId: number, label: string, fn: () => Promise<T>): Promise<T> {
    if (!Number.isInteger(userId) || userId <= 0) {
      throw new Error(
        `Scheduler: refusing to run "${label}" for SimpleX user id ${userId}. ` +
          `A command with no valid profile would execute as whichever profile happened ` +
          `to be active, which is precisely the failure this scheduler exists to prevent.`,
      );
    }

    this.queued++;
    const queuedAt = Date.now();

    // Chain onto the tail. `catch` on the stored tail (not on the returned promise)
    // keeps one failed command from breaking the chain for every command behind it,
    // while the caller still sees its own rejection.
    const result = this.tail.then(() => this.critical(userId, label, queuedAt, fn));
    this.tail = result.catch(() => undefined);

    try {
      return await result;
    } finally {
      this.queued--;
    }
  }

  /**
   * The critical section: select the user, issue the command, release.
   *
   * No `catch` here. A command that fails must reject to its caller unchanged; the
   * scheduler has no basis for turning a failure into a value, and converting one
   * would be exactly the masking CCB-S3-023 forbids. The `finally` exists only to keep
   * the tracked active user honest.
   */
  private async critical<T>(
    userId: number,
    label: string,
    queuedAt: number,
    fn: () => Promise<T>,
  ): Promise<T> {
    const waited = Date.now() - queuedAt;
    if (waited > this.slowWaitMs) {
      log.warn('scheduler: command waited a long time for the active-user lock', {
        label,
        userId,
        waitedMs: waited,
        depth: this.queued,
      });
    }

    if (this.activeUserId !== userId) {
      try {
        await this.core.setActiveUser(userId);
      } catch (err) {
        // The tracked value is now unknowable: the core may or may not have switched
        // before failing. Anything issued next must set it explicitly.
        this.activeUserId = undefined;
        throw err;
      }
      this.activeUserId = userId;
      if (this.counters) this.counters.activeUserSwitches++;
    } else if (this.counters) {
      this.counters.activeUserReuses++;
    }

    if (this.counters) this.counters.commandsIssued++;
    return await this.bounded(label, fn);
  }

  /**
   * `fn`, or a rejection once {@link SchedulerOptions.commandTimeoutMs} has passed.
   *
   * The timer is cleared on every exit, so a normal command leaves nothing behind. The
   * rejection is LOUD in both directions: it reaches the caller, which reports the reply it
   * could not send, and it reaches `onTimeout`, which puts it on the admin dashboard. A
   * command that stops answering used to produce neither.
   */
  private async bounded<T>(label: string, fn: () => Promise<T>): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        fn(),
        new Promise<never>((_resolve, reject) => {
          timer = setTimeout(() => {
            log.error('scheduler: a command did not answer and was abandoned', {
              label,
              timeoutMs: this.commandTimeoutMs,
              depth: this.queued,
              note: 'the queue behind it continues; the message it carried did not go out',
            });
            this.onTimeout?.(label, this.commandTimeoutMs);
            reject(new SchedulerTimeoutError(label, this.commandTimeoutMs));
          }, this.commandTimeoutMs);
        }),
      ]);
    } finally {
      if (timer !== undefined) clearTimeout(timer);
    }
  }
}
