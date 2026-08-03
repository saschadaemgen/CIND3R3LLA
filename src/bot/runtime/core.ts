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
import { EventRouter } from './router.js';
import { RuntimeStateMachine } from './state.js';
import { emptyBenignCounts, type BenignCounts } from './errors.js';
import {
  emptyCounters,
  type ActiveUserCore,
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
  'subscriptionStatus',
  'hostConnected',
  'contactSubSummary',
  'memberSubSummary',
  'userContactSubSummary',
  'pendingSubSummary',
  'contactConnected',
  'groupSubscribed',
  'rcvFileSubscribed',
  'sndFileSubscribed',
]);

/** The event tags the runtime subscribes to. Exactly one subscriber per tag. */
const ROUTED_TAGS: readonly string[] = [
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

export interface RuntimeProfile {
  simplexUserId: number;
  displayName: string;
}

export interface RuntimeOptions {
  /** SimpleX database file prefix. Produces `<prefix>_chat.db` and `<prefix>_agent.db`. */
  dbPrefix: string;
  encryptionKey?: string;
  /** Profiles to host. Normally the enabled rows of the bot registry. */
  profiles: readonly RuntimeProfile[];
  /** Where a real failure is surfaced, beyond the log. */
  onError?: (message: string) => void;
  onTransition?: (from: RuntimeState, to: RuntimeState) => void;
}

/**
 * Reproduce `mkBotProfile`'s mutation. See the header: losing this silently disables
 * file transfer on every profile the runtime creates.
 */
export function botProfileFor(displayName: string): T.Profile {
  return {
    displayName,
    fullName: '',
    preferences: {
      files: { allow: T.FeatureAllowed.Yes },
      calls: { allow: T.FeatureAllowed.No },
      voice: { allow: T.FeatureAllowed.No },
    },
    peerType: T.ChatPeerType.Bot,
  };
}

export class MultiProfileRuntime {
  private chat: api.ChatApi | undefined;
  private readonly options: RuntimeOptions;

  readonly counters: RuntimeCounters = emptyCounters();
  readonly benign: BenignCounts = emptyBenignCounts();
  readonly router: EventRouter;
  readonly machine: RuntimeStateMachine;

  private schedulerInstance: ActiveUserScheduler | undefined;
  private hosted: RuntimeProfile[] = [];

  constructor(options: RuntimeOptions) {
    this.options = options;
    this.router = new EventRouter({
      counters: this.counters,
      benign: this.benign,
      ...(options.onError ? { onError: options.onError } : {}),
    });
    this.machine = new RuntimeStateMachine({
      ...(options.onTransition
        ? { onTransition: (from, to) => options.onTransition!(from, to) }
        : {}),
    });
  }

  get state(): RuntimeState {
    return this.machine.state;
  }

  get profiles(): readonly RuntimeProfile[] {
    return this.hosted;
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
    this.chat = chat;

    const core: ActiveUserCore = {
      setActiveUser: async (userId: number): Promise<void> => {
        await chat.apiSetActiveUser(userId);
      },
    };
    this.schedulerInstance = new ActiveUserScheduler(core, { counters: this.counters });

    // Enumerate BEFORE startChat, matching bot.run's ordering.
    const existing = await chat.apiListUsers();
    const byId = new Map(existing.map((u: T.UserInfo) => [u.user.userId, u.user]));
    this.hosted = [];
    for (const profile of this.options.profiles) {
      const found = byId.get(profile.simplexUserId);
      if (found === undefined) {
        // Loud. A registry row naming a profile the core does not have means the two
        // have drifted, and hosting the rest while silently skipping this one would
        // leave a profile that looks configured and never speaks.
        throw new Error(
          `Runtime: registry names SimpleX user ${profile.simplexUserId} ` +
            `(${profile.displayName}), which does not exist in the core database. ` +
            `Known ids: ${[...byId.keys()].join(', ') || 'none'}.`,
        );
      }
      this.hosted.push(profile);
    }

    this.subscribe(chat);

    await chat.startChat();
    // startChat() returning is NOT readiness. 42 ms with 200 profiles (D-085).
    this.machine.subscribing();
    log.info('runtime: startChat returned, subscribing', {
      profiles: this.hosted.length,
      note: 'not ready yet; readiness is a quiet period or the ceiling',
    });
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

  async stop(): Promise<void> {
    this.machine.stopping();
    try {
      await this.chat?.stopChat();
    } finally {
      this.machine.offline();
      this.chat = undefined;
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
  ): Promise<T.AChatItem[]> {
    const chat = this.requireChat();
    return await this.scheduler.run(simplexUserId, `sendGroupText:${groupId}`, async () => {
      const cmd = CC.APISendMessages.cmdString({
        sendRef: { type: 'direct', chatType: T.ChatType.Group, chatId: groupId },
        liveMessage: false,
        composedMessages: [{ msgContent: { type: 'text', text } }],
      } as never);
      const r = (await chat.sendChatCmd(cmd)) as { type: string; user?: T.User; chatItems?: T.AChatItem[] };
      if (r.type !== 'newChatItems' || r.chatItems === undefined) {
        throw new Error(`Runtime: send to group ${groupId} answered ${r.type}, not newChatItems.`);
      }
      assertSentAs(r.user?.userId, simplexUserId, `group ${groupId}`);
      return r.chatItems;
    });
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
    if (this.chat === undefined) {
      throw new Error('Runtime: not started.');
    }
    return this.chat;
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
