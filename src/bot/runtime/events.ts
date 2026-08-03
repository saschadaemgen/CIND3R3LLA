/**
 * The seam between the runtime's per-profile routing and the handlers that were
 * written against the SDK's own subscriber table (CCB-S4-021).
 *
 * ── WHY THIS EXISTS RATHER THAN LETTING CAPTURE SUBSCRIBE DIRECTLY ──────────
 *
 * The SDK's subscriber table is keyed by event tag alone, with no user dimension, so a
 * handler registered with `chat.on('newChatItems', …)` receives EVERY hosted profile's
 * messages. That is exactly what {@link EventRouter} exists to prevent, and it is why
 * the runtime registers exactly one subscriber per tag and fans out by receiving
 * `userId`.
 *
 * Capture, the file receiver and the interaction layer were written before any of that
 * and take the SDK's shape: `on(tag, handler)`. Rather than rewrite them (a briefing
 * that changes hosting must not change behaviour), this class presents the same shape
 * and is fed from the router instead of from the SDK. Every one of those handlers then
 * receives its own profile's events and no other profile's, without a line of theirs
 * changing.
 *
 * ── ONE DELIBERATE DIFFERENCE FROM THE SDK, AND IT IS AN IMPROVEMENT ────────
 *
 * The SDK swallows a subscriber's throw into `console.log` and moves on (`api.js`,
 * `runEventsLoop`). That is the masking CCB-S3-023 forbids, and on the capture path it
 * means messages can stop being archived with nothing but a line on stdout to say so.
 * Here every handler still runs even when an earlier one threw (the SDK's one good
 * property, kept), but the failures are then re-thrown as one error, which the router
 * counts, logs with context, and pushes to the admin dashboard.
 */

import type { CEvt, ChatEvent } from '@simplex-chat/types';
import type { RoutableEvent } from './types.js';

/** The subscribe shape `api.ChatApi` offers, narrowed to what handlers use. */
export interface ChatEventSource {
  on<K extends CEvt.Tag>(
    event: K,
    subscriber: (event: ChatEvent & { type: K }) => void | Promise<void>,
  ): void;
}

type AnyHandler = (event: unknown) => void | Promise<void>;

export class RoutedEventSource implements ChatEventSource {
  private readonly handlers = new Map<string, AnyHandler[]>();

  /**
   * Events routed to this profile for a tag nothing has subscribed to yet, by tag.
   *
   * There is a window: the runtime binds this source before it starts the core, but
   * capture subscribes to it afterwards, so an event arriving in between reaches a tag
   * with no handler. It is much narrower than the pre-runtime path's (which registered
   * capture after the whole engine graph was built) but it is not zero, and a dropped
   * `newChatItems` is a member's message that was never archived. Counted rather than
   * assumed away, so the first live boot can be checked instead of trusted.
   */
  readonly unhandled = new Map<string, number>();

  on<K extends CEvt.Tag>(
    event: K,
    subscriber: (event: ChatEvent & { type: K }) => void | Promise<void>,
  ): void {
    const list = this.handlers.get(event) ?? [];
    list.push(subscriber as AnyHandler);
    this.handlers.set(event, list);
  }

  /** Tags something has subscribed to. For assertions and diagnostics. */
  get subscribedTags(): string[] {
    return [...this.handlers.keys()].sort();
  }

  /**
   * Deliver one routed event to the handlers registered for its tag.
   *
   * Sequential and awaited, matching the SDK's loop: capture relies on it, because two
   * items of one `newChatItems` event must be persisted in order.
   */
  async dispatch(event: RoutableEvent): Promise<void> {
    const list = this.handlers.get(event.type);
    if (list === undefined || list.length === 0) {
      this.unhandled.set(event.type, (this.unhandled.get(event.type) ?? 0) + 1);
      return;
    }

    const failures: Error[] = [];
    for (const handler of list) {
      try {
        await handler(event.payload);
      } catch (err) {
        failures.push(err instanceof Error ? err : new Error(String(err)));
      }
    }
    const only = failures[0];
    if (failures.length === 1 && only !== undefined) throw only;
    if (failures.length > 1) {
      throw new Error(
        `${failures.length} handlers failed on ${event.type}: ` +
          failures.map((f) => f.message).join(' | '),
      );
    }
  }
}
