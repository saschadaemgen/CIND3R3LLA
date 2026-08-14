/**
 * Hosting EVERY enabled bot on the multi-profile runtime (CCB-S5-001, D-155).
 *
 * ── WHAT THIS WAS, AND WHY IT CHANGED ────────────────────────────────────────
 *
 * CCB-S4-021 wired the bot onto the runtime with exactly one profile hosted, and said
 * why: isolation. If putting the runtime under the bot changed how the bot behaved, that
 * had to show up with one profile, where it was attributable, before N profiles made it a
 * puzzle. It did not change anything, and this is half two.
 *
 * The operator arrived at the same place from the other end: he had one bot in two
 * groups, decided that was wrong, and wants a bot per group so each can have its own
 * character. Everything a second bot needs already existed per bot - personality, dials,
 * origin, onboarding, moderation. The only thing that did not exist was hosting more than
 * one at a time.
 *
 * ── WHAT IT HAS TO REPRODUCE, BECAUSE bot.run() DID IT FOR US ───────────────
 *
 * `startBot()` (`../client.ts`) is a thin wrapper over the SDK's `bot.run`, and
 * `bot.run` quietly does five things this path must keep doing:
 *
 *   1. RESOLVE the user: active-user-else-create. Reproduced by the specs
 *      `hosted-bots.ts` builds. Exactly one bot may adopt the active user; see there.
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
 *
 * ── ONE EVENT SOURCE PER BOT, NOT ONE FOR THE PROCESS ───────────────────────
 *
 * The single-bot wiring gave every profile the same `RoutedEventSource`, which was
 * harmless when there was one. With several it would undo the router: capture, the
 * interaction engine and the file receiver would each see every bot's events and answer
 * in whichever character the wiring happened to hand them. So each hosted bot gets its
 * own source, its own file receiver, and its own graph above them.
 */

import type { T } from '@simplex-chat/types';
import type { api } from 'simplex-chat';
import type { Config } from '../../config.js';
import type { Queryable } from '../../db/pool.js';
import { log } from '../../log.js';
import { status } from '../../web/status.js';
import { configureFilesFolder, ensureDirs, type StartBotOptions } from '../client.js';
import { loadAvatarDataUri } from '../avatar.js';
import { resolveAssetPath } from '../../media/assets.js';
import { avatarFault, decideFaces } from './faces.js';
import { findRenameOnBoot, renameRefusal } from './naming.js';
import { FileReceiver } from '../files.js';
import { makeWelcomeTransport } from '../welcome-transport.js';
import { setWelcomeTransports, type WelcomeTransport } from '../welcome-port.js';
import {
  bindSimplexUser,
  anyBotIsBound,
  listBotsToHost,
  toRuntimeSpecs,
  type HostedBotConfig,
} from '../../profiles/hosted-bots.js';
import { MultiProfileRuntime, botProfileFor } from './core.js';
import type { BotWords } from './profiles.js';
import { RoutedEventSource } from './events.js';
import { heldUntilReady } from './gate.js';
import type { RoutableEvent } from './types.js';

/** One running bot: its configuration, its SimpleX identity, and its own transports. */
export interface HostedBot {
  config: HostedBotConfig;
  simplexUserId: number;
  /** The `T.User` the core reported for this profile at start. */
  user: T.User;
  /** THIS bot's events. Capture and the interaction engine subscribe here. */
  events: RoutedEventSource;
  /** THIS bot's file receiver. */
  fileReceiver: FileReceiver;
  /**
   * Send text to a group as this bot.
   *
   * Waits for readiness, goes through the scheduler, and is attributed from
   * `r.user.userId` on the raw command's response (D-124, D-096 Decision 5).
   */
  sendGroupText: (groupId: number, text: string, quotedItemId?: number) => Promise<T.AChatItem[]>;
  /** Run something active-profile-dependent as this bot, through the scheduler. */
  runScheduled: <R>(label: string, fn: () => Promise<R>) => Promise<R>;
}

export interface RuntimeHost {
  runtime: MultiProfileRuntime;
  /**
   * The raw chat handle.
   *
   * For profile-INDEPENDENT commands only (`/_files_folder`) and for commands taking an
   * explicit user id. Anything addressed at a chat goes through a {@link HostedBot} or
   * through `runtime.runForGroup`, or it executes as whichever profile is active.
   */
  chat: api.ChatApi;
  bots: HostedBot[];
  whenReady: () => Promise<void>;
  close: () => Promise<void>;
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
      // `shortDescr` is HERE because leaving it out is a known cost, not a hypothetical one
      // (D-203): a field the console saves, the database stores and this comparison ignores
      // compares equal every boot and never reaches the profile - it would work everywhere
      // except the one place that matters. `welcome_message` is that defect already shipped.
      x.shortDescr ?? null,
      x.image ?? null,
      x.peerType ?? null,
      x.preferences?.files?.allow ?? null,
      x.preferences?.calls?.allow ?? null,
      x.preferences?.voice?.allow ?? null,
    ]);
  return p(stored) !== p(desired);
}

/**
 * SHE MUST NEVER PRESENT AS HUMAN (CCB-S5-041, D-209).
 *
 * `mkBotProfile` / {@link botProfileFor} set `peerType = Bot` at creation, and
 * `verify:runtime-host` proves they do. Nothing proved it SURVIVED - and `profileDiffers`
 * carries `peerType` in its comparison list, so the boot path can write the field. A cleared
 * peer type would therefore be silent, exactly like the dead subscription of D-207: no error,
 * no log line, and a bot presenting as a person until somebody happened to look.
 *
 * That is the one thing this product must never do. It is the basis of the honesty the
 * operator sells, and since 2 August 2026 the EU transparency obligation makes it a compliance
 * question rather than a preference.
 *
 * So the stored value is READ BACK at every boot and disagreement is a FAULT: logged, and
 * raised to the admin dashboard rather than merely logged, because a log line nobody reads is
 * how this would be discovered late. Read from what the core reported for this profile, not
 * from what we intended to write - the intent is already known to be right, and the intent is
 * not what a member sees.
 *
 * It does NOT repair the value. Rewriting a profile at boot on the strength of a comparison is
 * what could clear it in the first place, and a silent self-heal would hide the fault that
 * matters. It reports, loudly, and the operator decides.
 */
function assertBotPeerType(user: T.User, displayName: string): void {
  const peerType = (user.profile as unknown as T.Profile).peerType;
  // Compared against the WIRE VALUE rather than the enum: `T` is a type-only import in this
  // file, and the string is what the core actually stores (`contact_profiles.chat_peer_type`),
  // which is the thing being asserted.
  if (String(peerType) === 'bot') return;
  const seen = peerType === undefined ? 'absent' : String(peerType);
  log.error('runtime: a hosted bot is NOT marked as a bot in its stored profile', {
    displayName,
    peerType: seen,
  });
  status.error(
    `"${displayName}" is not marked as a bot in its SimpleX profile (peerType ${seen}). ` +
      `It may present as a person to members, which this product must never do. Nothing was ` +
      `changed automatically; see the AI Bot page.`,
  );
}

export async function startRuntimeHost(
  cfg: Config,
  db: Queryable,
  opts: StartBotOptions = {},
): Promise<RuntimeHost> {
  await ensureDirs(cfg);

  const configured = await listBotsToHost(db);
  // Over the WHOLE table, not over `configured`, which is the enabled set: a paused bot
  // still owns its SimpleX identity, and an unbound bot must not adopt it (CCB-S5-012).
  const anyBound = await anyBotIsBound(db);
  if (configured.length === 0) {
    throw new Error(
      'Runtime host: no bot is enabled, so there is nothing to host. Enable at least one ' +
        'on the AI bots page.',
    );
  }

  // Loaded before the core starts, for the same reason the old path loaded it there:
  // the avatar has to be IN the profile that gets written, and an unreadable file must
  // leave the stored profile alone rather than blanking it.
  const image = await loadAvatarDataUri(cfg.avatarPath);

  // One source per hosted profile, keyed by the SimpleX user id the router attributes
  // events with. Built before the runtime, because the runtime binds each profile's
  // handler before it starts the core (see `handlerFor`), and the handler dispatches
  // into these.
  const sources = new Map<number, RoutedEventSource>();
  const sourceFor = (simplexUserId: number): RoutedEventSource => {
    let s = sources.get(simplexUserId);
    if (s === undefined) {
      s = new RoutedEventSource();
      sources.set(simplexUserId, s);
    }
    return s;
  };

  log.info(`Starting the multi-profile runtime with ${configured.length} profile(s)…`, {
    bots: configured.map((b) => b.displayName).join(', '),
  });

  const runtime = new MultiProfileRuntime({
    dbPrefix: cfg.simplexDbPrefix,
    profiles: toRuntimeSpecs(configured, anyBound),
    profileFor: (displayName) => {
      // The words belong to the bot being CREATED, so they are looked up by the name the
      // runtime is creating rather than taken from whichever bot happens to be first.
      const cfg = configured.find((c) => c.displayName === displayName);
      return botProfileFor(displayName, image, {
        fullName: cfg?.fullName ?? undefined,
        shortDescr: cfg?.shortDescr ?? undefined,
      });
    },
    onError: (message) => status.error(message),
    handlerFor: (profile) => {
      const source = sourceFor(profile.simplexUserId);
      return (event: RoutableEvent) => source.dispatch(event);
    },
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
    profiles: runtime.profiles.length,
    note: 'this is NOT readiness; nothing sends until ready',
  });

  // The runtime resolved the specs in the order they were given, which is the order
  // `listBotsToHost` returned. Pairing by index is therefore exact, and it is asserted
  // rather than trusted: a mispairing would give a bot another bot's character silently.
  if (runtime.profiles.length !== configured.length) {
    throw new Error(
      `Runtime host: asked for ${configured.length} profile(s) and the runtime hosted ` +
        `${runtime.profiles.length}. Refusing to guess which configuration belongs to which.`,
    );
  }

  const chat = runtime.chat;
  const bots: HostedBot[] = [];
  /** Per bot, keyed by profile id: the welcome's send routes. See where it is filled. */
  const welcomeTransports = new Map<number, WelcomeTransport>();

  for (const [index, config] of configured.entries()) {
    const hosted = runtime.profiles[index];
    if (hosted === undefined) {
      throw new Error(`Runtime host: no hosted profile at index ${index} for ${config.displayName}.`);
    }
    const user = runtime.user(hosted.simplexUserId);
    if (user === undefined) {
      throw new Error(
        `Runtime host: no SimpleX user record for hosted profile ${hosted.simplexUserId}.`,
      );
    }

    // Written down NOW, before anything is hosted. A bot that CREATED a profile and is
    // not bound creates another on the next boot and abandons this one in the core
    // database as a bot in no groups that nothing hosts.
    if (config.simplexUserId !== hosted.simplexUserId) {
      await bindSimplexUser(db, config.botProfileId, hosted.simplexUserId);
      config.simplexUserId = hosted.simplexUserId;
    }

    // Read back before anything is wired: if she is presenting as a person, that is the first
    // thing the operator should see in the log, not the last.
    assertBotPeerType(user, config.displayName);

    const events = sourceFor(hosted.simplexUserId);
    const fileReceiver = new FileReceiver(chat, cfg.simplexFilesFolder, opts.getFileTimeoutMs);
    events.on('rcvFileComplete', (ev) => fileReceiver.handleComplete(ev));
    events.on('rcvFileError', (ev) => fileReceiver.handleError(ev));
    // rcvFileWarning is transient (the XFTP agent keeps retrying) — do NOT treat it
    // as terminal, or media that later completes would be dropped.
    events.on('rcvFileWarning', (ev) => fileReceiver.handleWarning(ev));

    // ── WHICH EVENT ANNOUNCES A NEW MEMBER? OBSERVED, NOT ASSUMED (CCB-S5-041) ──
    //
    // The Welcome plugin needs the event that means "somebody joined", and two candidates
    // carry an IDENTICAL shape (`user`, `groupInfo`, `member`) while meaning opposite things:
    //
    //   joinedGroupMember      a member joined the group
    //   connectedToGroupMember WE established a connection to a member - which fires ONCE PER
    //                          EXISTING MEMBER when the bot itself joins a room
    //
    // Wired to the second, her first act in a 900-member room is 900 greetings, and the
    // once-per-member constraint would not save it: those are 900 distinct members, each
    // greeted exactly once, exactly as specified. `joinedGroupMember` is the right one
    // semantically, but it may only reach the HOST - the member whose link was used - and
    // this bot is usually an ordinary member.
    //
    // Neither event was referenced anywhere in this tree and production's journal held no
    // occurrence of either, so there was no evidence in any direction. Rather than stage a
    // test or guess, this records what actually arrives; the answer turns up the next time
    // anybody joins any of his groups. Content-free by design: which event, which group, the
    // member's STATUS and CATEGORY - never a name and never a message. It is a question about
    // the event vocabulary, not about a person.
    for (const kind of [
      'joinedGroupMember',
      'connectedToGroupMember',
      'joinedGroupMemberConnecting',
      'memberAcceptedByOther',
    ] as const) {
      events.on(kind, (ev: { groupInfo?: { groupId?: number }; member?: { memberCategory?: string; memberStatus?: string } }) => {
        log.info('membership event observed (CCB-S5-041: which event announces a new member?)', {
          event: kind,
          botProfileId: config.botProfileId,
          groupId: ev.groupInfo?.groupId,
          memberCategory: ev.member?.memberCategory,
          memberStatus: ev.member?.memberStatus,
        });
      });
    }

    const sendGroupText = heldUntilReady(
      (groupId: number, text: string, quotedItemId?: number): Promise<T.AChatItem[]> =>
        runtime.sendGroupText(hosted.simplexUserId, groupId, text, quotedItemId),
      {
        ready: () => runtime.whenReady(),
        isReady: () => runtime.state === 'ready',
        onHold: (label) =>
          log.info('runtime: holding a send until the core is ready', {
            label,
            bot: config.displayName,
            state: runtime.state,
          }),
      },
      `group-reply:${config.slug}`,
    );

    const runScheduled = <R>(label: string, fn: () => Promise<R>): Promise<R> =>
      runtime.scheduler.run(hosted.simplexUserId, label, fn);

    // ── ONE WELCOME TRANSPORT PER BOT (CCB-S5-041, D-206) ─────────────────────
    //
    // Built here for the reason each bot gets its own event source: a transport shared across
    // profiles would send in whichever voice the scheduler last left active, which is the
    // D-171 misrouting shape with a greeting attached. It reuses this bot's own
    // `sendGroupText`, so the readiness gate is not bypassed by a new send path.
    welcomeTransports.set(
      config.botProfileId,
      makeWelcomeTransport({
        chat,
        runScheduled,
        sendGroupText: (groupId: number, text: string) => sendGroupText(groupId, text),
        slug: config.slug,
      }),
    );

    bots.push({
      config,
      simplexUserId: hosted.simplexUserId,
      user,
      events,
      fileReceiver,
      sendGroupText,
      runScheduled,
    });
  }

  // Pin an active user through the scheduler rather than trusting whatever the core
  // last persisted. Commands that take no explicit user id still exist (the file
  // receiver's `/freceive` among them), and leaving the active user unset would make
  // media receipt depend on a value nothing in this process has stated. With several
  // bots this is a STARTING POINT and not a guarantee: anything addressed at a chat
  // goes through the scheduler naming its own bot.
  const primary = bots[0];
  if (primary === undefined) throw new Error('Runtime host: no bot was hosted.');
  await runtime.scheduler.run(primary.simplexUserId, 'adopt-active-user', () =>
    Promise.resolve(undefined),
  );

  // Published once, after every bot is built, so the port can never resolve a half-built
  // transport. Set as a whole map rather than one bot at a time for the same reason.
  setWelcomeTransports(welcomeTransports);

  // ── EVERY BOT WEARS ITS OWN FACE (CCB-S5-007, D-161) ─────────────────────
  //
  // Was: the one `AVATAR_PATH` image applied to the primary only, because one image cannot
  // dress several bots and giving them all the same face looks deliberate when it is not.
  //
  // Now each bot has an OWN image or none, and none means the deployment default, which is
  // that same `AVATAR_PATH`. So there is no special primary case: the first bot keeps
  // exactly the picture it has because it has no upload and falls back, and a second bot
  // gets its own the moment one is uploaded for it.
  //
  // Loaded per bot rather than once, and budgeted per bot, because `loadAvatarDataUri` is
  // where the SimpleX profile envelope is honoured (~15,610 bytes; the step-down lives in
  // `buildAvatarDataUri`). The decision itself is in `faces.ts`, which imports no SDK and is
  // therefore answerable without a core; this loop is what it costs to act on it.
  // ── THE RECONCILIATION, AND WHY IT REFUSES RATHER THAN MIGRATES (D-173) ──
  //
  // The reasoning is in `naming.ts`, which imports no SDK so `verify:runtime-host` can drive
  // it. In short: every bot is named from its own record from this briefing, so a bot WEARING
  // the env name whose record says something else would be renamed in front of its group on
  // the next deploy. That refuses, naming both values, rather than a migration silently
  // picking a winner, and it is bounded to the one bot that change can rename.
  const rename = findRenameOnBoot(
    bots.map((b) => ({
      liveName: (b.user.profile as unknown as T.Profile).displayName,
      recordName: b.config.displayName,
    })),
    cfg.botDisplayName,
  );
  if (rename !== null) throw new Error(renameRefusal(rename));

  const faces = await decideFaces(
    bots.map((b) => ({ bot: b, displayName: b.config.displayName, avatarPath: b.config.avatarPath })),
    {
      defaultImage: image,
      resolve: (relative) => resolveAssetPath(cfg.assetRoot, relative),
      load: loadAvatarDataUri,
    },
  );
  for (const outcome of faces) {
    const b = outcome.bot.bot;
    if (outcome.source === 'fault') {
      // Configured and unreadable is a FAULT, not a choice (CCB-S3-023). Falling silently
      // back to the default would dress this bot as the deployment and say nothing.
      log.error('runtime: a bot has an avatar configured that could not be read', {
        bot: b.config.displayName,
        avatarPath: b.config.avatarPath,
        note: 'its stored profile is left alone; upload the image again',
      });
      status.error(outcome.fault ?? avatarFault(b.config.displayName));
      continue;
    }
    // EVERY BOT READS ITS OWN RECORD (CCB-S5-019, D-173). This was
    // `b.config.isPrimary ? cfg.botDisplayName : b.config.displayName`, and it was the
    // primary flag's last functional consumer anywhere in the product.
    await applyProfileUpdate(
      runtime,
      b.simplexUserId,
      b.config.displayName,
      outcome.image,
      b.user,
    );
  }

  await configureFilesFolder(chat, cfg.simplexFilesFolder);

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
    for (const bot of bots) {
      bot.fileReceiver.abortAll('bot shutting down before file receipt completed');
    }
    await new Promise((r) => setTimeout(r, 250));
    try {
      // Stops the chat AND closes the database; see MultiProfileRuntime.stop.
      await runtime.stop();
    } catch (err) {
      log.warn(`Error during shutdown: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  return {
    runtime,
    chat,
    bots,
    whenReady: () => runtime.whenReady(),
    close,
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
 *
 * EXPORTED SINCE CCB-S5-011, because the console applies a face on demand now and this is
 * the write. It was private, and being private was the only thing standing between an
 * upload and the bot actually wearing it: the mechanism was whole, it simply had one caller
 * and that caller was boot. Returning whether it wrote lets the console say what happened
 * rather than guess.
 */
export async function applyProfileUpdate(
  runtime: MultiProfileRuntime,
  simplexUserId: number,
  displayName: string,
  image: string | undefined,
  stored: T.User,
  words?: BotWords,
): Promise<boolean> {
  // ── AN ABSENT AVATAR NO LONGER SKIPS THE WHOLE UPDATE (CCB-S5-041, D-209) ──
  //
  // This returned outright when no avatar was loaded, which was right while the avatar was the
  // only thing this path wrote. It is now also the path that carries the operator's OWN WORDS
  // about the bot, and a deployment with no avatar is ordinary - so returning here would mean
  // he writes a description, the console saves it, the database stores it, and it never
  // reaches the profile. That is `welcome_message` exactly: a field that saves and changes
  // nothing, the defect this product has now shipped twice.
  //
  // The image is still only written when one was loaded, because an unreadable or absent
  // avatar must never BLANK a stored one (D-161). `botProfileFor` omits the key entirely when
  // `image` is undefined, so `profileDiffers` compares the stored image against itself and the
  // absence cannot clear it.
  if (image === undefined && words === undefined) {
    log.debug('runtime: nothing configured to write, leaving the stored profile untouched');
    return false;
  }
  // THE STORED IMAGE IS CARRIED FORWARD WHEN NO NEW ONE WAS LOADED (D-161, D-209).
  //
  // Narrowing the early return above opened a hazard the early return had been hiding: with no
  // avatar loaded, `desired` carries no image, so it DIFFERS from a stored profile that has
  // one, the update fires, and the write blanks the avatar. An absent avatar must never clear
  // a stored one - that is D-161's rule, and it now has to be kept explicitly rather than as a
  // side effect of not running at all.
  const storedImage = (stored.profile as unknown as T.Profile).image;
  const carried = image ?? storedImage;
  const desired = botProfileFor(displayName, carried, words);
  const current = stored.profile as unknown as T.Profile;
  if (!profileDiffers(current, desired)) {
    log.debug('runtime: stored profile already matches the configured one');
    return false;
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
  return true;
}
