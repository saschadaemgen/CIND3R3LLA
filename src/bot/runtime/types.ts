/**
 * Multi-profile runtime: the types, and the narrow core contract the runtime is built
 * against.
 *
 * NO SDK IMPORT IN THIS FILE, and none in `scheduler.ts`, `state.ts`, `router.ts` or
 * `errors.ts` either. That is deliberate and it is what makes this testable: those
 * four modules depend only on {@link ActiveUserCore} and on plain event shapes, so a
 * harness can drive the whole runtime with an in-process fake and no Haskell core.
 * Only `core.ts` imports `simplex-chat`.
 *
 * The seam check (`verify:adapter-seam`) permits the SDK anywhere under `src/bot/`, so
 * this separation is not something it enforces. It is enforced by the harness being
 * able to run at all: if these modules took an SDK type, `verify:multi-profile` could
 * not exist.
 */

/** Briefing §6.2. */
export type RuntimeState =
  | 'offline'
  | 'starting'
  | 'subscribing'
  | 'ready'
  | 'degraded'
  | 'stopping';

/**
 * What declared the runtime ready.
 *
 * Load-bearing, not decoration: briefing §7 requires the runtime to log which of the
 * two it was, because reaching the ceiling is a fault signal and reaching quiet is not.
 */
export type ReadyReason = 'quiet' | 'ceiling';

/**
 * The slice of the chat core the scheduler needs.
 *
 * Deliberately two methods. The scheduler's whole job is to own the active-user
 * transition, so it must not be handed anything that could change the active user
 * behind its back.
 */
export interface ActiveUserCore {
  /**
   * Makes `userId` the active user. The scheduler calls this only from inside its
   * critical section.
   */
  setActiveUser(userId: number): Promise<void>;
}

/**
 * An incoming event, reduced to what routing needs.
 *
 * `userId` rather than the SDK's `user: T.User` object. 45 of the SDK's 50 event
 * interfaces carry the full user; five carry none at all (`hostConnected`,
 * `hostDisconnected`, `subscriptionStatus`, `chatError`, `chatErrors`). The adapter in
 * `core.ts` extracts `event.user.userId` and represents the unattributable five as
 * `userId: null`, so that a missing attribution is a value the router must handle
 * rather than an `undefined` that silently reads as "profile 0".
 */
export interface RoutableEvent {
  /** The SDK event tag, e.g. `newChatItems`. */
  type: string;
  /** The RECEIVING profile, or null for the five event types that carry no user. */
  userId: number | null;
  /** The original event, passed through untouched. */
  payload: unknown;
}

/** Runtime-level counters, surfaced to the admin rather than only logged. */
export interface RuntimeCounters {
  /** Commands issued through the scheduler. */
  commandsIssued: number;
  /** Active-user switches actually performed. */
  activeUserSwitches: number;
  /**
   * Commands that needed no switch because the requested profile was already active.
   * Worth showing: a workload with a low ratio here is paying a core round trip per
   * command and is a candidate for batching by profile.
   */
  activeUserReuses: number;
  /** Events delivered to a profile handler. */
  eventsRouted: number;
  /** Events carrying no user id, which cannot be attributed to a profile. */
  eventsUnattributed: number;
  /** Events whose userId matched no hosted profile. */
  eventsUnknownProfile: number;
  /** Handler throws, caught and surfaced rather than swallowed. */
  handlerFailures: number;
}

export function emptyCounters(): RuntimeCounters {
  return {
    commandsIssued: 0,
    activeUserSwitches: 0,
    activeUserReuses: 0,
    eventsRouted: 0,
    eventsUnattributed: 0,
    eventsUnknownProfile: 0,
    handlerFailures: 0,
  };
}
