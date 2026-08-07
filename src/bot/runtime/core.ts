/**
 * The multi-profile runtime (briefing §6.1): one `ChatApi.init()`, one `startChat()`,
 * every enabled profile hosted simultaneously, no profile rotation.
 *
 * THE ONLY FILE IN `runtime/` THAT IMPORTS THE SDK. `scheduler.ts`, `router.ts`,
 * `state.ts`, `errors.ts` and `types.ts` are SDK-free so the harness can drive the
 * whole runtime with an in-process double.
 *
 * ── WHY bot.run() IS REIMPLEMENTED HERE RATHER THAN CALLED N TIMES ──────────
 *
 * Three reasons, each independently sufficient:
 *
 *   1. It calls `process.exit()` on three internal paths with no thrown error
 *      (`simplex-chat/src/bot.ts:93, 102, 177`). One bad profile would kill the whole
 *      process past every `try/catch` above it.
 *   2. Its user resolution is `apiGetActiveUser()` else create. It CANNOT select a
 *      named profile out of a populated database, which is the entire job here.
 *   3. It calls `startChat()` itself. N calls would be N cores, which is the opposite
 *      of the design.
 *
 * ── THE ONE THING THAT MUST NOT BE LOST IN THE REIMPLEMENTATION ─────────────
 *
 * `mkBotProfile` MUTATES the profile it is given: it forces `preferences.files`,
 * `calls`, `voice` and `commands`, and sets `peerType = Bot`. A bare
 * `apiCreateActiveUser(profile)` therefore creates a profile that is NOT marked as a
 * bot and DOES NOT ALLOW FILE TRANSFER, which silently breaks all media capture for
 * every profile so created, with nothing raised at creation time and no failure until
 * the first image arrives. {@link botProfileFor} reproduces it deliberately, and
 * `verify:multi-profile` cannot catch a regression here because it needs no SDK. This
 * comment is the guard.
 */

import type { api } from 'simplex-chat';
import { api as chatApi } from 'simplex-chat';
// `T` and `CC` are VALUE imports, not `import type`: FeatureAllowed, ChatPeerType and
// ChatType are runtime enums, and CC carries the command builders the two SDK
// workarounds below need.
import { T, CC } from '@simplex-chat/types';
import { log } from '../../log.js';
import { ActiveUserScheduler } from './scheduler.js';
import { EventRouter, type ProfileHandler } from './router.js';
import { RuntimeStateMachine, type TransitionDetail } from './state.js';
import { emptyBenignCounts, type BenignCounts } from './errors.js';
import {
  botProfileFor,
  resolveProfileSpecs,
  type RuntimeProfile,
  type RuntimeProfileSpec,
} from './profiles.js';

export { botProfileFor, type RuntimeProfile, type RuntimeProfileSpec };
import { GroupOwnership, UnknownGroupOwnerError, type OwnedGroup } from './ownership.js';
import {
  emptyCounters,
  type ActiveUserCore,
  type ReadyReason,
  type RoutableEvent,
  type RuntimeCounters,
  type RuntimeState,
} from './types.js';

/**
 * Event tags that mean "still subscribing". Feeding the quiet-period detector.
 *
 * NOT a complete list, and it cannot be: there is no per-profile subscription signal in
 * the SDK at all. `/_start` is hard-coded with no per-user variant and
 * `subscriptionStatus` is per-SERVER, carrying no user. These are the tags that arrive
 * in the settling burst; if the list is wrong the effect is bounded, because the
 * ceiling still declares readiness and logs that it did.
 */
const SUBSCRIPTION_EVENT_TAGS: ReadonlySet<string> = new Set([
  // Present in the 6.5.4 event union, and therefore the ones that actually feed the
  // detector. Checked against `CEvt.Tag` under CCB-S4-021 rather than assumed.
  'subscriptionStatus',
  'hostConnected',
  'contactConnected',
  // NOT present in 6.5.4. Left listed on purpose: they are the per-subscription
  // summaries other SimpleX versions emit, they cost nothing here, and removing them
  // would make a future SDK bump silently narrow the detector instead of widening it.
  // Stated so nobody reads this set as evidence that ten kinds of event are observed.
  'contactSubSummary',
  'memberSubSummary',
  'userContactSubSummary',
  'pendingSubSummary',
  'groupSubscribed',
  'rcvFileSubscribed',
  'sndFileSubscribed',
]);

/** The event tags the runtime subscribes to. Exactly one subscriber per tag. */
const ROUTED_TAGS: readonly string[] = [
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
  'chatError',
  'chatErrors',
  'hostConnected',
  'hostDisconnected',
  'subscriptionStatus',
];

export interface RuntimeOptions {
  /** SimpleX database file prefix. Produces `<prefix>_chat.db` and `<prefix>_agent.db`. */
  dbPrefix: string;
  encryptionKey?: string;
  /** Profiles to host. Normally the enabled rows of the bot registry. */
  profiles: readonly RuntimeProfileSpec[];
  /**
   * Profile to write when `adopt: 'activeUser'` has to CREATE one. Defaults to
   * {@link botProfileFor} of the spec's display name; the wiring passes one carrying
   * the avatar so a fresh profile is not created imageless.
   */
  profileFor?: (displayName: string) => T.Profile;
  /**
   * The handler for each hosted profile, bound BEFORE the core starts.
   *
   * Registering from outside after `start()` resolves leaves a window in which the
   * core is running and the profile has no handler, and every event in it is counted
   * and dropped. Passing the factory closes it.
   */
  handlerFor?: (profile: RuntimeProfile) => ProfileHandler | undefined;
  /** Where a real failure is surfaced, beyond the log. */
  onError?: (message: string) => void;
  onTransition?: (from: RuntimeState, to: RuntimeState, detail: TransitionDetail) => void;
}

export class MultiProfileRuntime {
  private chatApiInstance: api.ChatApi | undefined;
  private readonly options: RuntimeOptions;

  readonly counters: RuntimeCounters = emptyCounters();
  readonly benign: BenignCounts = emptyBenignCounts();
  readonly router: EventRouter;
  readonly machine: RuntimeStateMachine;

  private schedulerInstance: ActiveUserScheduler | undefined;
  private hosted: RuntimeProfile[] = [];
  private readonly users = new Map<number, T.User>();

  /**
   * Which hosted bot owns which group (CCB-S5-001).
   *
   * Populated by {@link refreshOwnership}, which the host calls once the core is ready
   * and again whenever a membership event says the answer may have changed. Empty until
   * then, and an empty index makes {@link runForGroup} throw rather than guess.
   */
  readonly ownership = new GroupOwnership();

  /** Settled when the machine reaches `ready`, or rejected when it stops first. */
  private readyResolve: (() => void) | undefined;
  private readyReject: ((err: Error) => void) | undefined;
  private readonly readyPromise: Promise<void>;
  private readySettled = false;

  constructor(options: RuntimeOptions) {
    this.options = options;
    this.router = new EventRouter({
      counters: this.counters,
      benign: this.benign,
      ...(options.onError ? { onError: options.onError } : {}),
    });
    this.readyPromise = new Promise<void>((resolve, reject) => {
      this.readyResolve = resolve;
      this.readyReject = reject;
    });
    // Never an unhandled rejection: a runtime stopped before readiness rejects this
    // promise whether or not anyone is waiting on it yet.
    this.readyPromise.catch(() => undefined);
    this.machine = new RuntimeStateMachine({
      onTransition: (from, to, detail) => {
        this.settleReady(to);
        options.onTransition?.(from, to, detail);
      },
    });
  }

  get state(): RuntimeState {
    return this.machine.state;
  }

  get profiles(): readonly RuntimeProfile[] {
    return this.hosted;
  }

  /** The `T.User` the core reports for a hosted profile, as read at start. */
  user(simplexUserId: number): T.User | undefined {
    return this.users.get(simplexUserId);
  }

  /**
   * The chat handle, for commands this class does not wrap.
   *
   * ── READ THIS BEFORE USING IT ───────────────────────────────────────────────
   *
   * Every command that does NOT take an explicit `userId` executes as whichever
   * profile is currently active, so with more than one profile hosted, issuing one
   * here rather than through {@link scheduler} is the silent cross-profile execution
   * D-085 measured. It is exposed because the single-bot wiring (CCB-S4-021) needs the
   * handle for profile-independent commands (`/_files_folder`), for commands that take
   * an explicit user id (`apiListGroups`), and for the file receiver. With one profile
   * hosted there is nothing to misroute to.
   *
   * When the second profile arrives, every call site reached through this accessor has
   * to be re-examined; the backlog says so rather than leaving it to be discovered.
   */
  get chat(): api.ChatApi {
    return this.requireChat();
  }

  /**
   * Resolves when the runtime is READY, not when `start()` returned.
   *
   * The difference is two orders of magnitude, not a nicety: `startChat()` returns in
   * ~42 ms and subscriptions continue for up to a minute behind it, and a send issued
   * into that window took 10 s to reach its first receiver against 153 ms on a settled
   * core (D-085). Anything that SENDS must await this. Anything that only listens must
   * not, or messages arriving during the warm-up would be missed.
   *
   * Rejects if the runtime stops before it ever became ready, so a caller waiting to
   * send during shutdown fails rather than hanging.
   */
  whenReady(): Promise<void> {
    return this.readyPromise;
  }

  /** How readiness was reached: a quiet period, or the ceiling (a fault signal). */
  get readyReason(): ReadyReason | undefined {
    return this.machine.readyReason;
  }

  private settleReady(to: RuntimeState): void {
    if (this.readySettled) return;
    if (to === 'ready') {
      this.readySettled = true;
      this.readyResolve?.();
      return;
    }
    if (to === 'stopping' || to === 'offline') {
      this.readySettled = true;
      this.readyReject?.(
        new Error('Runtime: stopped before it ever reached ready; nothing was sent.'),
      );
    }
  }

  /**
   * The scheduler. Every active-user-dependent command must go through it.
   *
   * Raises before start rather than returning undefined: a caller that reached for the
   * scheduler too early would otherwise fall back to something, and the something would
   * be an unscheduled command.
   */
  get scheduler(): ActiveUserScheduler {
    if (this.schedulerInstance === undefined) {
      throw new Error('Runtime: the scheduler is not available until start() has run.');
    }
    return this.schedulerInstance;
  }

  /**
   * Boot the core and host every configured profile.
   *
   * Resolves when `startChat()` has returned, which is NOT readiness (§7). The state
   * machine moves to `ready` on its own, on a quiet period or the ceiling.
   */
  async start(): Promise<void> {
    this.machine.starting();

    const dbOpts: api.DbConfig = {
      type: 'sqlite',
      filePrefix: this.options.dbPrefix,
      ...(this.options.encryptionKey ? { encryptionKey: this.options.encryptionKey } : {}),
    };
    const chat = await chatApi.ChatApi.init(dbOpts);
    this.chatApiInstance = chat;

    // Everything past init is inside the guard. A throw here (a registry naming a
    // profile the core does not have, an ambiguous adoption) would otherwise leave an
    // OPEN SQLite database with no handle to close it, a machine stuck in `starting`,
    // and `whenReady()` pending forever, so a caller awaiting readiness would hang
    // rather than see the failure that already happened.
    try {
      const core: ActiveUserCore = {
        setActiveUser: async (userId: number): Promise<void> => {
          await chat.apiSetActiveUser(userId);
        },
      };
      this.schedulerInstance = new ActiveUserScheduler(core, { counters: this.counters });

      // Enumerate BEFORE startChat, matching bot.run's ordering.
      await this.resolveProfiles(chat);

      // Bind each profile's handler BEFORE the core starts, not after `start()`
      // resolves. Events that arrive for a profile with no handler are counted as
      // `eventsUnknownProfile` and dropped (router.ts), and the window between
      // `startChat()` and a caller getting round to registering is real time: an
      // active-user round trip, possibly a profile write, a files-folder command.
      for (const profile of this.hosted) {
        const handler = this.options.handlerFor?.(profile);
        if (handler) this.router.register(profile.simplexUserId, handler);
      }

      this.subscribe(chat);

      await chat.startChat();
    } catch (err) {
      await this.abandonStart();
      throw err;
    }

    // startChat() returning is NOT readiness. 42 ms with 200 profiles (D-085).
    this.machine.subscribing();
    log.info('runtime: startChat returned, subscribing', {
      profiles: this.hosted.length,
      note: 'not ready yet; readiness is a quiet period or the ceiling',
    });
  }

  /** Undo a failed start: close the core, settle the machine, settle `whenReady()`. */
  private async abandonStart(): Promise<void> {
    try {
      await this.chatApiInstance?.close();
    } catch (closeErr) {
      log.warn('runtime: could not close the core after a failed start', {
        error: closeErr instanceof Error ? closeErr.message : String(closeErr),
      });
    }
    this.chatApiInstance = undefined;
    this.schedulerInstance = undefined;
    this.machine.stopping();
    this.machine.offline();
  }

  /** Resolve the configured specs against the core, then host what came back. */
  private async resolveProfiles(chat: api.ChatApi): Promise<void> {
    const resolved = await resolveProfileSpecs(
      this.options.profiles,
      {
        listUsers: () => chat.apiListUsers(),
        getActiveUser: () => chat.apiGetActiveUser(),
        createUser: (profile) => chat.apiCreateActiveUser(profile),
      },
      this.options.profileFor ?? botProfileFor,
    );

    this.hosted = [];
    this.users.clear();
    for (const { user, configuredName, how } of resolved) {
      this.users.set(user.userId, user);
      this.hosted.push({ simplexUserId: user.userId, displayName: user.profile.displayName });
      log.info('runtime: hosting profile', {
        simplexUserId: user.userId,
        displayName: user.profile.displayName,
        configuredName,
        how,
      });
    }
  }

  /** Register exactly one subscriber per tag and fan out. */
  private subscribe(chat: api.ChatApi): void {
    for (const tag of ROUTED_TAGS) {
      chat.on(tag as never, (event: unknown) => {
        const routable = toRoutable(tag, event);
        if (SUBSCRIPTION_EVENT_TAGS.has(tag)) this.machine.noteSubscriptionEvent();
        // The router never throws; a throw here would kill the shared event loop.
        void this.router.route(routable);
      });
    }
  }

  /**
   * Stop the core and CLOSE the database.
   *
   * Both, in that order, because `stopChat()` alone leaves the SQLite files open: the
   * SDK's own `close()` is what releases them, and a process that stops the chat but
   * never closes the store holds a single-writer database against the next boot.
   */
  async stop(): Promise<void> {
    this.machine.stopping();
    const chat = this.chatApiInstance;
    try {
      await chat?.stopChat();
    } finally {
      try {
        await chat?.close();
      } catch (err) {
        log.warn('runtime: could not close the core database', {
          error: err instanceof Error ? err.message : String(err),
        });
      }
      this.machine.offline();
      this.chatApiInstance = undefined;
      this.schedulerInstance = undefined;
    }
  }

  /**
   * Send text to a group as a specific profile, and return what the core said.
   *
   * ── WHY THIS BYPASSES apiSendTextMessage ────────────────────────────────
   *
   * Outgoing messages are archived from the command's RETURN VALUE, never from the
   * event stream (§6.6, §9.2): a history built from events alone recorded zero sends
   * while six profiles had demonstrably sent.
   *
   * But `apiSendMessages` returns `T.AChatItem[]` and DISCARDS the `user` the
   * underlying `newChatItems` response carries, and `AChatItem` has no user dimension.
   * So the typed helper's return value cannot say which profile sent. Attribution would
   * have to be inferred from the scheduler's ambient active profile, which makes the
   * archive's correctness depend on the scheduler's correctness.
   *
   * Issuing the raw command instead keeps `r.user.userId` on the response, so
   * attribution is SELF-EVIDENCING: the core states who sent, and {@link assertSentAs}
   * checks it against who was meant to. A silent misroute becomes a loud mismatch.
   */
  async sendGroupText(
    simplexUserId: number,
    groupId: number,
    text: string,
    /** Quote this chat item above the answer, exactly as `apiSendTextReply` does. */
    quotedItemId?: number,
  ): Promise<T.AChatItem[]> {
    const chat = this.requireChat();
    return await this.scheduler.run(simplexUserId, `sendGroupText:${groupId}`, async () => {
      // Composed exactly as `apiSendTextMessage` composes it, `mentions` included:
      // the SDK helper always sends that field, and this path exists to change WHO the
      // send is attributed to, not what the message looks like on the wire.
      const cmd = CC.APISendMessages.cmdString({
        sendRef: { chatType: T.ChatType.Group, chatId: groupId },
        liveMessage: false,
        composedMessages: [
          {
            msgContent: { type: 'text', text },
            mentions: {},
            ...(quotedItemId === undefined ? {} : { quotedItemId }),
          },
        ],
      });
      const r = (await chat.sendChatCmd(cmd)) as { type: string; user?: T.User; chatItems?: T.AChatItem[] };
      if (r.type !== 'newChatItems' || r.chatItems === undefined) {
        throw new Error(`Runtime: send to group ${groupId} answered ${r.type}, not newChatItems.`);
      }
      assertSentAs(r.user?.userId, simplexUserId, `group ${groupId}`);
      return r.chatItems;
    });
  }

  /* ── Which bot owns which group (CCB-S5-001, D-155) ───────────────────────── */

  /**
   * Rebuild the group index from what each hosted profile reports.
   *
   * `apiListGroups` takes an EXPLICIT user id, so it needs no scheduler: it is one of
   * the few commands that cannot be misrouted. It is still listed per profile rather
   * than once, because there is no "all groups" command and each profile only ever sees
   * its own rows.
   *
   * One profile failing does not blank the others: `adopt` is per profile, and a failed
   * read leaves that profile's previous entries alone. Surfaced rather than swallowed,
   * because a stale index routes an erasure at the wrong bot.
   */
  async refreshOwnership(): Promise<void> {
    const chat = this.requireChat();
    for (const profile of this.hosted) {
      try {
        const groups = await chat.apiListGroups(profile.simplexUserId);
        this.ownership.adopt(
          profile.simplexUserId,
          groups.map((g) => ({
            groupId: g.groupId,
            localDisplayName: g.localDisplayName,
            sharedKey: sharedGroupKey(g),
          })),
        );
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        log.error('runtime: could not list groups for a hosted profile', {
          simplexUserId: profile.simplexUserId,
          displayName: profile.displayName,
          error: message,
        });
        this.options.onError?.(
          `Could not read the groups of bot "${profile.displayName}", so commands aimed at ` +
            `its groups may not be routable: ${message}`,
        );
      }
    }
    log.debug('runtime: group ownership refreshed', {
      groups: this.ownership.size,
      profiles: this.hosted.length,
    });
  }

  /** The bot that owns a group, or undefined when the group is not hosted. */
  ownerOf(groupId: number): number | undefined {
    return this.ownership.owner(groupId);
  }

  /**
   * The bot that owns a DIRECT chat, reading the contact index in if it is empty.
   *
   * Lazy on purpose. `apiListContacts` loads every contact into one response (the SDK
   * says so in as many words), and a bot with a public contact address can accumulate
   * a great many; nothing books a direct-chat erasure today, so paying that on every
   * boot would be cost for a path with no caller. The first request for one pays it.
   */
  private async contactOwner(contactId: number): Promise<number | undefined> {
    const known = this.ownership.contactOwner(contactId);
    if (known !== undefined) return known;
    const chat = this.requireChat();
    for (const profile of this.hosted) {
      const contacts = await chat.apiListContacts(profile.simplexUserId);
      this.ownership.adoptContacts(
        profile.simplexUserId,
        contacts.map((c) => c.contactId),
      );
    }
    return this.ownership.contactOwner(contactId);
  }

  /**
   * Run a command as whichever bot owns `groupId`.
   *
   * The seam every group-addressed command that takes no explicit user id must go
   * through. Throws {@link UnknownGroupOwnerError} when the group belongs to no hosted
   * bot, because the alternative is issuing it as the active profile, which for the
   * erasure path means deleting zero rows and reporting success (see `ownership.ts`).
   */
  async runForGroup<R>(groupId: number, label: string, fn: () => Promise<R>): Promise<R> {
    const owner = this.ownership.owner(groupId);
    if (owner === undefined) throw new UnknownGroupOwnerError(groupId);
    return await this.scheduler.run(owner, `${label}:g${String(groupId)}`, fn);
  }

  /**
   * Erase chat items from the core's own database, as the bot that owns the chat.
   *
   * `apiDeleteChatItems` takes no user id and the core scopes the DELETE by `user_id`,
   * so issued as the wrong profile it removes nothing and raises nothing. For a DIRECT
   * chat there is no group index to consult, so the caller states the bot.
   */
  async deleteChatItems(
    chatType: T.ChatType,
    chatId: number,
    itemIds: readonly number[],
  ): Promise<void> {
    const chat = this.requireChat();
    const owner =
      chatType === T.ChatType.Direct
        ? await this.contactOwner(chatId)
        : this.ownership.owner(chatId);
    if (owner === undefined) throw new UnknownGroupOwnerError(chatId);
    await this.scheduler.run(owner, `deleteChatItems:${String(chatId)}`, async () => {
      await chat.apiDeleteChatItems(chatType, chatId, [...itemIds], T.CIDeleteMode.Internal);
    });
  }

  /** Send one composed message (an image with its caption) as a given bot. */
  async sendGroupComposed(
    simplexUserId: number,
    groupId: number,
    composed: T.ComposedMessage[],
  ): Promise<T.AChatItem[]> {
    const chat = this.requireChat();
    return await this.scheduler.run(simplexUserId, `sendComposed:${String(groupId)}`, async () =>
      chat.apiSendMessages([T.ChatType.Group, groupId], composed),
    );
  }

  /**
   * Send text into a group as whichever bot owns it.
   *
   * For the paths that hold a group id and NOT a bot: the recital, whose beats two
   * onward are sent by a queue job minutes after the message object is gone. Throws on
   * an unknown owner rather than sending as the active profile, which would read one
   * bot's book into another bot's group.
   */
  async sendGroupTextAsOwner(groupId: number, text: string): Promise<T.AChatItem[]> {
    const owner = this.ownership.owner(groupId);
    if (owner === undefined) throw new UnknownGroupOwnerError(groupId);
    return await this.sendGroupText(owner, groupId, text);
  }

  /** The composed-message form of {@link sendGroupTextAsOwner}. */
  async sendGroupComposedAsOwner(
    groupId: number,
    composed: T.ComposedMessage[],
  ): Promise<T.AChatItem[]> {
    const owner = this.ownership.owner(groupId);
    if (owner === undefined) throw new UnknownGroupOwnerError(groupId);
    return await this.sendGroupComposed(owner, groupId, composed);
  }

  /** Every group a hosted profile holds, as the index last saw them. */
  groupsOf(simplexUserId: number): OwnedGroup[] {
    return this.ownership.groupsOf(simplexUserId);
  }

  /**
   * Set or clear a reaction, working around a known SDK defect (§10).
   *
   * `ChatApi.apiChatItemReaction` checks the response against `chatItemsDeleted` and
   * throws otherwise. `/_reaction` answers `chatItemReaction` in BOTH directions, so
   * the guard is never satisfied and both add and remove throw ALTHOUGH THE OPERATION
   * SUCCEEDED. The thrown `ChatCommandError` carries the successful response on
   * `.response` while `.chatError` is `undefined`, so a handler inspecting `.chatError`
   * logs an empty error, which is what makes it expensive to diagnose.
   *
   * Present in 6.5.4 and 7.0.0-beta.3; reported upstream as PR #7109, open. Verified
   * present in the installed 6.5.4 (`dist/api.js`), so this workaround is required, not
   * defensive.
   */
  async setReaction(
    simplexUserId: number,
    chatType: T.ChatType,
    chatId: number,
    chatItemId: number,
    add: boolean,
    reaction: T.MsgReaction,
  ): Promise<void> {
    const chat = this.requireChat();
    await this.scheduler.run(simplexUserId, `reaction:${chatItemId}`, async () => {
      const cmd = CC.APIChatItemReaction.cmdString({
        chatRef: { chatType, chatId },
        chatItemId,
        add,
        reaction,
      });
      const r = (await chat.sendChatCmd(cmd)) as { type: string };
      if (r.type === 'chatItemReaction' || r.type === 'chatItemsDeleted') return;
      throw new Error(`Runtime: reaction on item ${chatItemId} answered ${r.type}.`);
    });
  }

  private requireChat(): api.ChatApi {
    if (this.chatApiInstance === undefined) {
      throw new Error('Runtime: not started.');
    }
    return this.chatApiInstance;
  }
}

/**
 * The emoji the core accepts, verified one fresh message per emoji against a live group
 * (briefing §10).
 *
 * CODE POINTS MATTER and the near-identical neighbours are rejected: `😀 U+1F600` is
 * accepted, `😃 U+1F603` is not; `😢 U+1F622` is accepted, `😔 U+1F614` is not. Anything
 * outside this set answers `commandError`. Listed here so a caller picks from it rather
 * than discovering the rejection at runtime.
 */
export const ACCEPTED_REACTIONS: readonly string[] = Object.freeze([
  '\u{1F44D}', // 👍
  '\u{1F44E}', // 👎
  '\u{1F600}', // 😀
  '\u{1F602}', // 😂
  '\u{1F622}', // 😢
  '❤', //    ❤
  '\u{1F680}', // 🚀
  '✅', //    ✅
]);

/** Rejected by the core although they look interchangeable with accepted ones. */
export const REJECTED_REACTIONS: readonly string[] = Object.freeze([
  '\u{1F603}', // 😃
  '\u{1F614}', // 😔
  '\u{1F62D}', // 😭
  '\u{1F923}', // 🤣
  '\u{1F389}', // 🎉
  '✔', //    ✔
  '\u{1F44F}', // 👏
  '\u{1F44C}', // 👌
]);

/**
 * Reduce an SDK event to what routing needs.
 *
 * The five event types that carry no user become `userId: null` rather than
 * `undefined`, so an unattributable event is a value the router must handle rather than
 * a missing field that reads as profile zero.
 */
/**
 * A stable identity for the REAL group behind one profile's `GroupInfo` (CCB-S5-001).
 *
 * The group id cannot answer "are two of my bots in the same group", because two
 * profiles in one group hold two rows with two different ids (see `ownership.ts`). These
 * two fields can, and they are taken in order of how much they actually prove:
 *
 *   `groupKeys.publicGroupId`  the group's own identifier, shared by every member.
 *                              Present for public groups, which is what this product is.
 *   `viaGroupLinkUri`          the link the profile joined through. Two bots that used
 *                              the same invitation link joined the same group.
 *
 * Returns null when the core reports neither, and null MUST NOT be read as "not shared":
 * it means the question cannot be answered from what the core gave us. The display name
 * is deliberately NOT a fallback - a group admin can rename a group, and two unrelated
 * groups can be called the same thing, so it would produce both false matches and false
 * misses on a question whose wrong answer duplicates the archive.
 */
export function sharedGroupKey(group: T.GroupInfo): string | null {
  const publicId = group.groupKeys?.publicGroupId;
  if (typeof publicId === 'string' && publicId.length > 0) return `pub:${publicId}`;
  const link = group.viaGroupLinkUri;
  if (typeof link === 'string' && link.length > 0) return `link:${link}`;
  return null;
}

export function toRoutable(tag: string, event: unknown): RoutableEvent {
  const user = (event as { user?: { userId?: unknown } } | null)?.user;
  const userId = typeof user?.userId === 'number' ? user.userId : null;
  return { type: tag, userId, payload: event };
}

/**
 * Check that the core says the send came from the profile it was meant to.
 *
 * This is the assertion the scheduler exists to make unnecessary, kept anyway because
 * the failure it guards is silent. If the scheduler ever regresses, this turns a
 * wrong-profile message in the archive into an error at the send site.
 */
export function assertSentAs(
  reportedUserId: number | undefined,
  intendedUserId: number,
  where: string,
): void {
  if (reportedUserId === undefined) {
    log.warn('runtime: send response carried no user, cannot verify attribution', {
      where,
      intendedUserId,
    });
    return;
  }
  if (reportedUserId !== intendedUserId) {
    throw new Error(
      `Runtime: send to ${where} was issued for SimpleX user ${intendedUserId} but the ` +
        `core reports it was sent by user ${reportedUserId}. The active-user scheduler ` +
        `has been bypassed or has regressed; this message would have been archived ` +
        `against the wrong profile.`,
    );
  }
}
