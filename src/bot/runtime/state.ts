/**
 * The runtime state machine (briefing §6.2, §7; D-085).
 *
 *     offline -> starting -> subscribing -> ready
 *                                 |            |
 *                                 +--> degraded <--+
 *                                        |
 *                     any state -> stopping -> offline
 *
 * ── THE LOAD-BEARING PART: startChat() RETURNING IS NOT READINESS ───────────
 *
 * `startChat()` returns in about 42 ms with 200 profiles and subscribes in the
 * background (D-085, measured). A run that began sending 8 seconds later took 10
 * seconds to reach its first receiver; the same operation on a settled core took
 * 153 ms. Factor 65. Treating the core as ready when `startChat()` returns is not a
 * cosmetic error, it is wrong by two orders of magnitude in first-message latency.
 *
 * So `subscribing -> ready` is a QUIET PERIOD: no subscription-class event for
 * {@link QUIET_PERIOD_MS}, with a hard ceiling of {@link READY_CEILING_MS}. The
 * runtime records WHICH of the two declared it ready, because reaching the ceiling is
 * a fault signal and reaching quiet is not.
 *
 * ── WHY `subscribing` IS A CORE-LEVEL PHASE AND NOT A PER-PROFILE ONE ───────
 *
 * There is no per-profile subscription signal to key off. `/_start` is hard-coded with
 * no per-user variant, and `subscriptionStatus` is per-SERVER and carries no user at
 * all. Synthesising a per-profile readiness from events that do not carry a profile
 * would be inventing information. The phase is therefore core-wide, and that is stated
 * rather than implied.
 *
 * ── `degraded` SHIPS UNTESTED, AND IS NEVER ATTRIBUTED TO A PROFILE ─────────
 *
 * D-085 is explicit that `degraded` has no measured basis: a clean restart was
 * measured, a network interruption was not. It ships labelled untested.
 *
 * It is also core-level only. The error events that would justify it (`chatError`,
 * `chatErrors`, `hostDisconnected`, `subscriptionStatus`) are exactly the five event
 * types that carry NO user. Attributing an unattributed error to "whichever profile is
 * currently active" would invent an attribution that happens to be right sometimes,
 * which is the masking CCB-S3-023 forbids.
 *
 * NO CLOCK IS READ HERE. Time comes in through {@link StateMachineOptions.now} and
 * timers through `schedule`, so the whole machine is drivable by a harness with no
 * real waiting.
 */

import { log } from '../../log.js';
import type { ReadyReason, RuntimeState } from './types.js';

/** D-085, measured. No subscription-class event for this long means settled. */
export const QUIET_PERIOD_MS = 10_000;

/** D-085, measured. Declare ready anyway past this, and log that it was the ceiling. */
export const READY_CEILING_MS = 120_000;

/** A timer handle the machine can cancel. */
export interface Cancellable {
  cancel(): void;
}

export interface StateMachineOptions {
  /** Injected clock. Defaults to `Date.now`. */
  now?: () => number;
  /** Injected timer. Defaults to `setTimeout`. */
  schedule?: (fn: () => void, ms: number) => Cancellable;
  quietPeriodMs?: number;
  readyCeilingMs?: number;
  /** Called on every transition, for the admin surface. */
  onTransition?: (from: RuntimeState, to: RuntimeState, detail: TransitionDetail) => void;
}

export interface TransitionDetail {
  /** Set only on the transition into `ready`. */
  readyReason?: ReadyReason;
  /** Milliseconds spent subscribing, set on the transition into `ready`. */
  subscribeMs?: number;
  /** Set on the transition into `degraded`. */
  reason?: string;
}

function defaultSchedule(fn: () => void, ms: number): Cancellable {
  const handle = setTimeout(fn, ms);
  // Never hold the process open on a readiness timer.
  if (typeof handle.unref === 'function') handle.unref();
  return { cancel: () => clearTimeout(handle) };
}

/** Transitions the machine will accept, keyed by source state. */
const ALLOWED: Readonly<Record<RuntimeState, readonly RuntimeState[]>> = Object.freeze({
  offline: ['starting', 'stopping'],
  starting: ['subscribing', 'degraded', 'stopping'],
  subscribing: ['ready', 'degraded', 'stopping'],
  ready: ['degraded', 'stopping'],
  degraded: ['ready', 'subscribing', 'stopping'],
  stopping: ['offline'],
});

export class RuntimeStateMachine {
  private current: RuntimeState = 'offline';
  private readonly now: () => number;
  private readonly schedule: (fn: () => void, ms: number) => Cancellable;
  private readonly quietPeriodMs: number;
  private readonly readyCeilingMs: number;
  private readonly onTransition: StateMachineOptions['onTransition'];

  private quietTimer: Cancellable | undefined;
  private ceilingTimer: Cancellable | undefined;
  private subscribingSince = 0;

  /** How readiness was reached last time. `undefined` until ready. */
  private lastReadyReason: ReadyReason | undefined;

  constructor(options: StateMachineOptions = {}) {
    this.now = options.now ?? Date.now;
    this.schedule = options.schedule ?? defaultSchedule;
    this.quietPeriodMs = options.quietPeriodMs ?? QUIET_PERIOD_MS;
    this.readyCeilingMs = options.readyCeilingMs ?? READY_CEILING_MS;
    this.onTransition = options.onTransition;
  }

  get state(): RuntimeState {
    return this.current;
  }

  get readyReason(): ReadyReason | undefined {
    return this.lastReadyReason;
  }

  /** Core init has begun. */
  starting(): void {
    this.transition('starting', {});
  }

  /**
   * `startChat()` has returned. This begins the quiet period; it does NOT mean ready.
   */
  subscribing(): void {
    this.transition('subscribing', {});
    this.subscribingSince = this.now();
    this.armCeiling();
    this.armQuiet();
  }

  /**
   * A subscription-class event arrived. Restarts the quiet period.
   *
   * Ignored in every state but `subscribing`, so a late straggler after readiness does
   * not drag the runtime backwards.
   */
  noteSubscriptionEvent(): void {
    if (this.current !== 'subscribing') return;
    this.armQuiet();
  }

  /** Something went wrong at the core level. Never called with a profile. */
  degraded(reason: string): void {
    this.clearTimers();
    this.transition('degraded', { reason });
  }

  stopping(): void {
    this.clearTimers();
    this.transition('stopping', {});
  }

  offline(): void {
    this.clearTimers();
    this.transition('offline', {});
  }

  private armQuiet(): void {
    this.quietTimer?.cancel();
    this.quietTimer = this.schedule(() => this.declareReady('quiet'), this.quietPeriodMs);
  }

  private armCeiling(): void {
    this.ceilingTimer?.cancel();
    this.ceilingTimer = this.schedule(() => this.declareReady('ceiling'), this.readyCeilingMs);
  }

  private declareReady(reason: ReadyReason): void {
    if (this.current !== 'subscribing') return;
    this.clearTimers();
    this.lastReadyReason = reason;
    const subscribeMs = this.now() - this.subscribingSince;

    if (reason === 'ceiling') {
      // A fault signal, not a milestone. The core never went quiet, so something is
      // still churning and first-message latency is unknown.
      log.warn('runtime: reached ready on the CEILING, not on quiet', {
        ceilingMs: this.readyCeilingMs,
        subscribeMs,
        meaning:
          'subscription-class events never stopped arriving; the core may still be settling',
      });
    } else {
      log.info('runtime: ready', { readyReason: reason, subscribeMs });
    }

    this.transition('ready', { readyReason: reason, subscribeMs });
  }

  private clearTimers(): void {
    this.quietTimer?.cancel();
    this.ceilingTimer?.cancel();
    this.quietTimer = undefined;
    this.ceilingTimer = undefined;
  }

  private transition(to: RuntimeState, detail: TransitionDetail): void {
    const from = this.current;
    if (from === to) return;
    if (!ALLOWED[from].includes(to)) {
      // Loud rather than tolerated. An impossible transition means the caller's model
      // of the runtime has diverged from the runtime's, and continuing would act on
      // the wrong one.
      throw new Error(
        `Runtime state machine: refusing the transition ${from} -> ${to}. ` +
          `Allowed from ${from}: ${ALLOWED[from].join(', ')}.`,
      );
    }
    this.current = to;
    this.onTransition?.(from, to, detail);
  }
}
