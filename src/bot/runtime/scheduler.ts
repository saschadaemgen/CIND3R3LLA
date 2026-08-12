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

import { AsyncLocalStorage } from 'node:async_hooks';
import { log } from '../../log.js';
import { describeChatError } from './chat-error.js';
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
  /**
   * Raised when a command schedules from INSIDE another, which always deadlocks.
   *
   * Separate from {@link SchedulerOptions.onTimeout} because they are different faults with
   * different fixes: a timeout is a command the core did not answer, which may be the
   * network; a re-entrant schedule is a bug in this repository and the same code will do it
   * every single time.
   */
  onReentry?: (outer: string, inner: string) => void;
}

const DEFAULT_SLOW_WAIT_MS = 5_000;

/**
 * Generous, because the core legitimately takes seconds: a send on a settled core measured
 * 153 ms and one issued into the warm-up took 10 s (D-085). This is not a latency budget, it
 * is the line past which a command is not coming back.
 */
const DEFAULT_COMMAND_TIMEOUT_MS = 60_000;

/**
 * A command scheduled from inside another (CCB-S5-015, D-167).
 *
 * Its own class, and thrown rather than logged, because the alternative is what shipped: the
 * outer command waits the full command timeout, is abandoned with a message saying its send
 * did not go out, and the inner command then runs anyway the moment the tail unblocks. Sixty
 * seconds of silence per occurrence, a false claim in the log, and a send that arrives late.
 *
 * There is no benign case. `run` chains every command onto ONE tail regardless of user, so a
 * nested call always waits on the section that is waiting on it. Failing immediately turns a
 * guaranteed deadlock into a named error at the line that caused it.
 */
export class SchedulerReentryError extends Error {
  constructor(outer: string, inner: string) {
    super(
      `Runtime: the command "${inner}" was scheduled from inside "${outer}". The scheduler ` +
        `runs one command at a time on a single queue, so the inner command would wait for ` +
        `the outer one to finish and the outer one is waiting for it: that deadlocks until ` +
        `the command timeout. Issue the inner command outside the surrounding critical ` +
        `section; anything it calls that already names its bot does not need one.`,
    );
    this.name = 'SchedulerReentryError';
  }
}

/**
 * Thrown when a command is abandoned so the chain can move on.
 *
 * The wording no longer claims the message did not go out (CCB-S5-015). It used to, and the
 * re-entrancy repro proved it can be false: the abandoned command's send completed moments
 * after the timeout fired, because abandoning stops waiting and does not stop the work.
 * The comment on `commandTimeoutMs` had said as much all along ("may leave the core to finish
 * the command later"); the error text simply disagreed with it.
 */
export class SchedulerTimeoutError extends Error {
  constructor(label: string, ms: number) {
    super(
      `Runtime: the command "${label}" did not answer within ${String(ms)} ms and was ` +
        `abandoned so the queue behind it could continue. Whether it reached the core is ` +
        `unknown: abandoning stops waiting for it, not the command itself.`,
    );
    this.name = 'SchedulerTimeoutError';
  }
}

export class ActiveUserScheduler {
  private readonly core: ActiveUserCore;
  private readonly slowWaitMs: number;
  private readonly commandTimeoutMs: number;
  private readonly onTimeout: ((label: string, ms: number) => void) | undefined;
  private readonly onReentry: ((outer: string, inner: string) => void) | undefined;
  /**
   * Which critical section the current async context is inside, if any.
   *
   * The whole re-entry guard. Set around the command itself rather than around the
   * queueing, so waiting for the lock is not mistaken for holding it.
   */
  private readonly inCritical = new AsyncLocalStorage<{ label: string; userId: number }>();
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
    this.onReentry = options.onReentry;
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
    // ── RE-ENTRY IS A DEADLOCK, AND IT MUST BE LOUD (CCB-S5-015, D-167) ──────
    //
    // Checked FIRST, before the id validation and before anything is queued, so the throw
    // names the two commands and nothing is left half-registered on the tail.
    //
    // `AsyncLocalStorage` rather than a plain flag: the critical section awaits, so a flag
    // set on entry and cleared on exit would be wrong the moment two commands interleave,
    // which is the normal case. The store follows the async context of the section itself.
    const outer = this.inCritical.getStore();
    if (outer !== undefined) {
      log.error('scheduler: a command scheduled another from inside itself', {
        outer: outer.label,
        outerUserId: outer.userId,
        inner: label,
        innerUserId: userId,
        note: 'this always deadlocks: one queue, one command at a time',
      });
      this.onReentry?.(outer.label, label);
      throw new SchedulerReentryError(outer.label, label);
    }

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
        // ── WHICH COMMAND FAILED, SAID OUT LOUD (CCB-S5-018) ─────────────────
        //
        // Every critical section may issue TWO commands: the active-user switch and the
        // command itself. Both fail through the same SDK envelope with the same pointer
        // message, so a caller catching this cannot tell "the profile could not be made
        // active" from "the command was refused" - and those have different fixes. The
        // bridge console's two failures were indistinguishable for exactly this reason.
        //
        // Logged and RETHROWN UNCHANGED: wrapping would hide `.chatError` from
        // `describeChatError` at every catch site above, which is the masking
        // CCB-S3-023 forbids and the very thing this line exists to end.
        log.error('scheduler: could not make a profile active, so its command never ran', {
          label,
          userId,
          error: describeChatError(err),
        });
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
    // The store covers the COMMAND only. Setting it earlier would make a command that is
    // merely queued look like one that is running, and every ordinary sequential call
    // would be reported as re-entrant.
    return await this.inCritical.run({ label, userId }, () => this.bounded(label, fn));
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
