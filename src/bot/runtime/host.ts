/**
 * Hosting ONE bot on the multi-profile runtime (CCB-S4-021, wiring half one).
 *
 * The runtime landed dormant under CCB-S4-020: it could host N profiles and nothing
 * called it, so the bot still booted through `bot.run()`. This file is the caller. It
 * hosts exactly one profile, which is the whole scope of half one, and the reason is
 * isolation rather than timidity: if putting the runtime under the bot changes how the
 * bot behaves, that shows up with one profile where it is attributable, before N
 * profiles make it a puzzle.
 *
 * ── WHAT IT HAS TO REPRODUCE, BECAUSE bot.run() DID IT FOR US ───────────────
 *
 * `startBot()` (`../client.ts`) is a thin wrapper over the SDK's `bot.run`, and
 * `bot.run` quietly does five things this path must keep doing:
 *
 *   1. RESOLVE the user: active-user-else-create. Reproduced by `adopt: 'activeUser'`
 *      in the runtime, NOT by matching display names - see the note there.
 *   2. MARK the profile as a bot: `mkBotProfile` forces `peerType = Bot` and
 *      `preferences.files`, without which the profile silently cannot receive media.
 *      Reproduced by `botProfileFor`.
 *   3. UPDATE the stored profile when it differs from the configured one, which is how
 *      the avatar reaches the profile at all. Reproduced below, under exactly the same
 *      condition the old path used: only when an avatar file was actually loaded.
 *   4. START the chat. The runtime does this, and unlike `bot.run` it then says
 *      `subscribing` rather than pretending to be ready.
 *   5. CONFIGURE the files folder. Not `bot.run`'s, ours, but equally load-bearing:
 *      without it every XFTP download lands somewhere the media store never looks.
 *
 * ── THE ONE BEHAVIOURAL DIFFERENCE, AND IT IS THE POINT ─────────────────────
 *
 * Nothing SENDS until the runtime is ready. `startChat()` returns in ~42 ms while
 * subscriptions run on for up to a minute behind it, and a send issued into that
 * window took 10 s to reach its first receiver against 153 ms on a settled core
 * (D-085, factor 65). Receiving is attached immediately, so a message that arrives
 * during the warm-up is still captured; only the answer waits. Waiting is bounded by
 * the state machine's ceiling, so a reply is delayed at worst, never dropped.
 */

import type { T } from '@simplex-chat/types';
import type { Config } from '../../config.js';
import { log } from '../../log.js';
import { status } from '../../web/status.js';
import { configureFilesFolder, ensureDirs, type BotHandle, type StartBotOptions } from '../client.js';
import { loadAvatarDataUri } from '../avatar.js';
import { FileReceiver } from '../files.js';
import { MultiProfileRuntime, botProfileFor } from './core.js';
import { RoutedEventSource } from './events.js';
import { heldUntilReady } from './gate.js';
import type { RoutableEvent } from './types.js';

/**
 * A {@link BotHandle}, so every existing consumer is untouched, plus the runtime
 * underneath it and the readiness gate.
 */
export interface RuntimeBotHandle extends BotHandle {
  runtime: MultiProfileRuntime;
  /** The event source capture and the file receiver subscribe to. */
  events: RoutedEventSource;
  /** Resolves when the core has settled. Everything that SENDS awaits this. */
  whenReady: () => Promise<void>;
  /**
   * Run something that depends on the ACTIVE profile through the scheduler.
   *
   * For the calls this file does not wrap: the avatar flush is the one at boot. With
   * one profile hosted nothing can be misrouted, but going through the scheduler is
   * what keeps that true when a second arrives, and it is one line here against an
   * archaeology exercise later.
   */
  runScheduled: <R>(label: string, fn: () => Promise<R>) => Promise<R>;
  /**
   * Send text to a group as this bot, and return what the core created.
   *
   * Waits for readiness, goes through the scheduler, and is attributed from
   * `r.user.userId` on the raw command's response (D-124, D-096 Decision 5).
   */
  sendGroupText: (groupId: number, text: string, quotedItemId?: number) => Promise<T.AChatItem[]>;
}

/**
 * The profile fields worth comparing to decide whether the stored profile needs
 * updating. Every field this path ever writes, and no others: a full deep-equal would
 * also drag in fields the core maintains, and would rewrite the profile on every boot.
 */
function profileDiffers(stored: T.Profile, desired: T.Profile): boolean {
  const p = (x: T.Profile): string =>
    JSON.stringify([
      x.displayName,
      x.fullName,
      x.image ?? null,
      x.peerType ?? null,
      x.preferences?.files?.allow ?? null,
      x.preferences?.calls?.allow ?? null,
      x.preferences?.voice?.allow ?? null,
    ]);
  return p(stored) !== p(desired);
}

export async function startRuntimeBot(
  cfg: Config,
  opts: StartBotOptions = {},
): Promise<RuntimeBotHandle> {
  await ensureDirs(cfg);

  // Loaded before the core starts, for the same reason the old path loaded it there:
  // the avatar has to be IN the profile that gets written, and an unreadable file must
  // leave the stored profile alone rather than blanking it.
  const image = await loadAvatarDataUri(cfg.avatarPath);

  // Built before the runtime, because the runtime binds the profile's handler before
  // it starts the core (see `handlerFor`), and the handler dispatches into this.
  const events = new RoutedEventSource();

  log.info('Starting the multi-profile runtime with one profile…');
  const runtime = new MultiProfileRuntime({
    dbPrefix: cfg.simplexDbPrefix,
    profiles: [{ displayName: cfg.botDisplayName, adopt: 'activeUser' }],
    profileFor: (displayName) => botProfileFor(displayName, image),
    onError: (message) => status.error(message),
    handlerFor: () => (event: RoutableEvent) => events.dispatch(event),
    onTransition: (from, to, detail) => {
      log.info('runtime: state', {
        from,
        to,
        ...(detail.readyReason ? { readyReason: detail.readyReason } : {}),
        ...(detail.subscribeMs === undefined ? {} : { subscribeMs: detail.subscribeMs }),
        ...(detail.reason ? { reason: detail.reason } : {}),
      });
      if (detail.readyReason === 'ceiling') {
        // Reaching the ceiling means subscription-class events never stopped arriving,
        // so the core is declared ready without ever having settled and first-message
        // latency is unknown. That is a fault signal, and a fault signal that only
        // reaches a log file is one the operator finds out about from a member.
        status.error(
          `The SimpleX core never went quiet while subscribing and was declared ready on the ` +
            `${Math.round((detail.subscribeMs ?? 0) / 1000)}s ceiling instead. Replies may be slow ` +
            `and the core may still be settling.`,
        );
      }
    },
  });

  const startedAt = Date.now();
  await runtime.start();
  log.info('runtime: start() resolved', {
    ms: Date.now() - startedAt,
    state: runtime.state,
    note: 'this is NOT readiness; nothing sends until ready',
  });

  const hosted = runtime.profiles[0];
  if (hosted === undefined) {
    throw new Error('Runtime host: start() hosted no profile, so there is no bot to run.');
  }
  const user = runtime.user(hosted.simplexUserId);
  if (user === undefined) {
    throw new Error(
      `Runtime host: no SimpleX user record for hosted profile ${hosted.simplexUserId}.`,
    );
  }
  const chat = runtime.chat;

  // Pin the active user through the scheduler rather than trusting whatever the core
  // last persisted. Commands that take no explicit user id (the file receiver's
  // `/freceive` among them) execute as the ACTIVE profile, so leaving it unset would
  // make media receipt depend on a value nothing in this process has stated.
  await runtime.scheduler.run(hosted.simplexUserId, 'adopt-active-user', () =>
    Promise.resolve(undefined),
  );

  await applyProfileUpdate(runtime, hosted.simplexUserId, cfg.botDisplayName, image, user);
  await configureFilesFolder(chat, cfg.simplexFilesFolder);

  const fileReceiver = new FileReceiver(chat, cfg.simplexFilesFolder, opts.getFileTimeoutMs);
  events.on('rcvFileComplete', (ev) => fileReceiver.handleComplete(ev));
  events.on('rcvFileError', (ev) => fileReceiver.handleError(ev));
  // rcvFileWarning is transient (the XFTP agent keeps retrying) — do NOT treat it
  // as terminal, or media that later completes would be dropped.
  events.on('rcvFileWarning', (ev) => fileReceiver.handleWarning(ev));

  // The handler was bound by `handlerFor` before the core started. Assert it, because
  // a profile with no handler loses its entire event stream to a `log.debug` line and
  // the bot would look healthy while capturing nothing.
  const unhandled = runtime.profiles
    .map((p) => p.simplexUserId)
    .filter((id) => !runtime.router.hostedUserIds.includes(id));
  if (unhandled.length > 0) {
    throw new Error(
      `Runtime host: hosted profile(s) ${unhandled.join(', ')} have no event handler, ` +
        `so every message they receive would be counted and discarded.`,
    );
  }

  const close = async (): Promise<void> => {
    fileReceiver.abortAll('bot shutting down before file receipt completed');
    await new Promise((r) => setTimeout(r, 250));
    try {
      // Stops the chat AND closes the database; see MultiProfileRuntime.stop.
      await runtime.stop();
    } catch (err) {
      log.warn(`Error during shutdown: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  const whenReady = (): Promise<void> => runtime.whenReady();

  const sendGroupText = heldUntilReady(
    (groupId: number, text: string, quotedItemId?: number): Promise<T.AChatItem[]> =>
      runtime.sendGroupText(hosted.simplexUserId, groupId, text, quotedItemId),
    {
      ready: whenReady,
      isReady: () => runtime.state === 'ready',
      onHold: (label) =>
        log.info('runtime: holding a send until the core is ready', {
          label,
          state: runtime.state,
        }),
    },
    'group-reply',
  );

  const runScheduled = <R>(label: string, fn: () => Promise<R>): Promise<R> =>
    runtime.scheduler.run(hosted.simplexUserId, label, fn);

  return {
    chat,
    user,
    fileReceiver,
    close,
    runtime,
    events,
    whenReady,
    sendGroupText,
    runScheduled,
  };
}

/**
 * Write the configured profile if it differs from the stored one, on exactly the
 * condition the pre-runtime path used.
 *
 * `startBot` passed `updateProfile: image !== undefined` for a reason it recorded at
 * length: with no avatar loaded, letting the SDK reconcile would deep-diff an
 * image-less profile against the stored one and WIPE the avatar, then propagate the
 * blank to the group. So no avatar means no write, exactly as before.
 */
async function applyProfileUpdate(
  runtime: MultiProfileRuntime,
  simplexUserId: number,
  displayName: string,
  image: string | undefined,
  stored: T.User,
): Promise<void> {
  if (image === undefined) {
    log.debug('runtime: no avatar file loaded, leaving the stored profile untouched');
    return;
  }
  const desired = botProfileFor(displayName, image);
  const current = stored.profile as unknown as T.Profile;
  if (!profileDiffers(current, desired)) {
    log.debug('runtime: stored profile already matches the configured one');
    return;
  }
  // Through the scheduler: apiUpdateProfile takes an explicit user id, but it is a
  // write to a profile and the scheduler is the one place that serialises those.
  await runtime.scheduler.run(simplexUserId, 'update-profile', async () => {
    await runtime.chat.apiUpdateProfile(simplexUserId, desired);
  });
  log.info('runtime: stored profile updated to match the configured one', {
    simplexUserId,
    withImage: true,
  });
}
