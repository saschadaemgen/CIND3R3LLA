/**
 * Event routing by receiving profile (briefing §6.3).
 *
 * Every incoming event is routed through the SimpleX `userId` it was received on. That
 * information is already there and always has been: 45 of the SDK's 50 event
 * interfaces carry `user: T.User`, `newChatItems` among them. Nothing in Cinderella
 * has ever read it, because with one profile there was nothing to distinguish.
 *
 * ── WHY THIS EXISTS RATHER THAN N SUBSCRIPTIONS ─────────────────────────────
 *
 * The SDK's subscriber table is keyed by event tag ALONE, with no user dimension, and
 * its event loop is a single sequential await chain shared by every profile. So "each
 * profile subscribes to its own events" is not available: N subscriptions to
 * `newChatItems` would each receive every profile's messages. Exactly one subscriber
 * per tag is registered, here, and this fans out.
 *
 * ── THE THREE OUTCOMES, ALL COUNTED ─────────────────────────────────────────
 *
 * A routed event reaches exactly one profile handler. The other two outcomes are the
 * interesting ones and neither is silently dropped:
 *
 *   UNATTRIBUTED  five event types carry no user at all (`hostConnected`,
 *                 `hostDisconnected`, `subscriptionStatus`, `chatError`, `chatErrors`).
 *                 They go to the core-level handler. They are NOT guessed onto the
 *                 active profile: that would invent an attribution that is right often
 *                 enough to be trusted and wrong often enough to matter.
 *   UNKNOWN       a userId with no hosted profile. Counted and logged, never dropped
 *                 quietly, because it means the registry and the core disagree about
 *                 who exists.
 *
 * ── HANDLER FAILURES SURFACE ────────────────────────────────────────────────
 *
 * The SDK swallows subscriber errors into `console.log`. That is already non-compliant
 * with CCB-S3-023 and multiplies by N here. Every handler call is wrapped: benign noise
 * (§11) is counted and logged at debug, everything else is logged with context AND
 * pushed to `status.error`, because the capture path losing events is exactly the class
 * of failure that must reach the admin rather than a log file.
 */

import { log } from '../../log.js';
import { noteIfBenign, emptyBenignCounts, type BenignCounts } from './errors.js';
import type { RoutableEvent, RuntimeCounters } from './types.js';

export type ProfileHandler = (event: RoutableEvent) => Promise<void> | void;
export type CoreHandler = (event: RoutableEvent) => Promise<void> | void;

export interface RouterOptions {
  counters?: RuntimeCounters;
  benign?: BenignCounts;
  /** Where a real failure is surfaced. Injected so the harness can assert on it. */
  onError?: (message: string) => void;
}

export class EventRouter {
  private readonly profiles = new Map<number, ProfileHandler>();
  private coreHandler: CoreHandler | undefined;
  private readonly counters: RuntimeCounters | undefined;
  private readonly benign: BenignCounts;
  private readonly onError: ((message: string) => void) | undefined;

  constructor(options: RouterOptions = {}) {
    this.counters = options.counters;
    this.benign = options.benign ?? emptyBenignCounts();
    this.onError = options.onError;
  }

  get benignCounts(): Readonly<BenignCounts> {
    return this.benign;
  }

  get hostedUserIds(): number[] {
    return [...this.profiles.keys()].sort((a, b) => a - b);
  }

  /**
   * Bind a handler to one profile.
   *
   * Refuses to replace an existing binding. Two handlers for one profile means two
   * capture paths for the same messages, and the second silently winning is how an
   * archive quietly halves.
   */
  register(userId: number, handler: ProfileHandler): void {
    if (this.profiles.has(userId)) {
      throw new Error(
        `Event router: SimpleX user ${userId} already has a handler. Replacing it would ` +
          `silently redirect that profile's entire event stream.`,
      );
    }
    this.profiles.set(userId, handler);
  }

  unregister(userId: number): void {
    this.profiles.delete(userId);
  }

  /** Handles the five event types that carry no user, plus unknown-profile events. */
  onCoreEvent(handler: CoreHandler): void {
    this.coreHandler = handler;
  }

  /**
   * Route one event. Never throws: a throw here would kill the SDK's shared event loop
   * for every profile.
   */
  async route(event: RoutableEvent): Promise<void> {
    if (event.userId === null) {
      if (this.counters) this.counters.eventsUnattributed++;
      await this.invoke(this.coreHandler, event, 'core');
      return;
    }

    const handler = this.profiles.get(event.userId);
    if (handler === undefined) {
      if (this.counters) this.counters.eventsUnknownProfile++;
      // Not an error in itself: a profile may exist in the core and be deliberately
      // disabled in the registry. It IS worth seeing, because the other explanation is
      // that the registry and the core have drifted.
      log.debug('router: event for a profile this runtime does not host', {
        type: event.type,
        userId: event.userId,
        hosted: this.hostedUserIds.length,
      });
      await this.invoke(this.coreHandler, event, 'core');
      return;
    }

    if (this.counters) this.counters.eventsRouted++;
    await this.invoke(handler, event, `profile ${event.userId}`);
  }

  private async invoke(
    handler: ProfileHandler | CoreHandler | undefined,
    event: RoutableEvent,
    who: string,
  ): Promise<void> {
    if (handler === undefined) return;
    try {
      await handler(event);
    } catch (err) {
      if (noteIfBenign(err, this.benign)) {
        log.debug('router: benign core noise, discarded duplicate', {
          type: event.type,
          userId: event.userId,
        });
        return;
      }
      if (this.counters) this.counters.handlerFailures++;
      const message = err instanceof Error ? err.message : String(err);
      log.error('router: handler failed', {
        type: event.type,
        userId: event.userId,
        who,
        error: message,
      });
      // Reaches the admin dashboard, not only a log file: this is the capture path.
      this.onError?.(`event handler failed for ${who} on ${event.type}: ${message}`);
    }
  }
}
