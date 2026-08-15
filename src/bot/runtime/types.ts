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
 * Deliberately one method. The scheduler's whole job is to own the active-user
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

/**
 * THE EVENT TAGS THE RUNTIME SUBSCRIBES TO. Exactly one subscriber per tag.
 *
 * ── WHY THIS IS A TYPE AND NOT ONLY A LIST (CCB-S5-041, D-207) ──────────────
 *
 * `RoutedEventSource.on()` used to accept any `CEvt.Tag`, so subscribing to a tag the runtime
 * does not route COMPILED, SUCCEEDED, and delivered nothing - for ever, silently. The welcome
 * plugin's arrival handler was wired that way and a full round of live testing was spent
 * waiting for events that were never subscribed to at the SDK at all.
 *
 * `verify:runtime-host` already had a check for exactly this, naming it in its own comment,
 * and it did not fire: it matches `.on('literalTag'` over the source, and the subscription was
 * a loop over a const array, so the scan simply could not see it. A string matcher over source
 * can always be evaded, and the evasion is silent.
 *
 * So the set moved HERE, to the SDK-free module both the runtime and the event source can
 * import, and `on()` is narrowed to {@link RoutedTag}. An unrouted subscription is now a TYPE
 * ERROR at build time, in every shape - literal, loop, computed - with no scan to evade. The
 * scan stays as the belt to this braces.
 */
export const ROUTED_TAGS = [
  // `contactConnected` is here for the detector rather than for a handler: a tag that
  // is never subscribed can never restart the quiet period, and readiness declared on
  // evidence the runtime never asked for is readiness declared early. It carries a
  // handler as well since CCB-S4-023, which stamps when an accepted contact actually
  // connected.
  'contactConnected',
  // The onboarding console's step two (CCB-S4-023). Without it the core raises the
  // request, nothing listens, and the sender's app sits on "connecting" forever.
  'receivedContactRequest',
  // Step three (CCB-S4-025). Same hazard one step later: the operator's app says
  // "You sent group invitation" and the bot never hears it. `userJoinedGroup` is the
  // confirmation that the membership is live, which is a later fact than the join
  // command returning. `verify:runtime-host` checks both are real and both are here.
  'receivedGroupInvitation',
  'userJoinedGroup',
  'newChatItems',
  'chatItemUpdated',
  'groupChatItemsDeleted',
  'chatItemsDeleted',
  'rcvFileComplete',
  'rcvFileError',
  'rcvFileWarning',
  // ── THE OUTBOUND HALF (CCB-S5-044 follow-up, D-224) ──────────────────────
  //
  // The receive side was routed and the SEND side was not, so an outbound
  // file's error had nowhere to land and was dropped by this very allow-list
  // - the D-201 lesson pointing the other way. And these three still cannot
  // see the worst case: a file stuck in `new` fires NO event at all, which
  // is why every file-bearing send also books a `files.watch` check.
  'sndFileCompleteXFTP',
  'sndFileError',
  'sndFileWarning',
  'chatError',
  'chatErrors',
  'hostConnected',
  'hostDisconnected',
  'subscriptionStatus',
  // ── SOMEBODY ARRIVED (CCB-S5-041, D-207) ─────────────────────────────────
  //
  // All four, READ FROM THE CLIENT rather than guessed. The Kotlin client
  // (apps/multiplatform .../SimpleXAPI.kt) handles every one of these identically -
  // `upsertGroupMember(rhId, r.groupInfo, r.member)` - and privileges none of them as THE
  // arrival event. It is the same handler an ordinary member-role client runs, which is what
  // makes them real for a bot that is merely a member rather than the host.
  //
  // Subscribing to all four is therefore the client's own shape, not a hedge.
  // `arrivedAfterBot` filters the bot's own join whichever one delivers it, and the
  // greeting's UNIQUE claim dedupes a member announced by more than one.
  'joinedGroupMember',
  'connectedToGroupMember',
  'joinedGroupMemberConnecting',
  'memberAcceptedByOther',
] as const;

/** A tag the runtime actually routes. Subscribing to anything else does not compile. */
export type RoutedTag = (typeof ROUTED_TAGS)[number];
