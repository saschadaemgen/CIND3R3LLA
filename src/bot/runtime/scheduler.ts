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
  /** Shared counter object, so the admin can show one set of runtime numbers. */
  counters?: RuntimeCounters;
}

const DEFAULT_SLOW_WAIT_MS = 5_000;

export class ActiveUserScheduler {
  private readonly core: ActiveUserCore;
  private readonly slowWaitMs: number;
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
    return await fn();
  }
}
