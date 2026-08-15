/**
 * Cinderella entrypoint.
 *
 * Cinderella is the tireless worker: first into the group, never resting,
 * capturing everything opted-in members contribute so it can later be
 * republished as a consent-gated public archive.
 *
 *   node dist/index.js            → run the capture bot (long-lived)
 *   node dist/index.js --check    → validate config and exit 0 (Stage 0 check)
 *
 * Capture pipeline: connect the embedded SimpleX core, persist each received
 * group message to PostgreSQL (with extracted links and FTS), and download any
 * attached file into the media store, recording its path.
 */

import {
  loadAdminConfig,
  loadConfig,
  loadLocalAiConfig,
  redactConfig,
  redactLocalAiConfig,
  type Config,
  type LocalAiConfig,
} from './config.js';
import { log, setLogLevel } from './log.js';
import { startRuntimeHost, type HostedBot, type RuntimeHost } from './bot/runtime/host.js';
import { setRuntimeAdminHandle } from './bot/runtime/admin-actions.js';
import { describeChatError } from './bot/runtime/chat-error.js';
import { registerContactRequestListener } from './profiles/contact-requests.js';
import { registerGroupInvitationListener } from './profiles/group-invitations.js';
import { setCoreDeletePort } from './bot/core-delete.js';
import { enforcementAvailable, liveEnforcementPort, setEnforcementHandle } from './bot/enforcement.js';
import { flushAvatarToGroups } from './bot/avatar.js';
import { sendViaRuntime } from './bot/send.js';
import { sdkRecitalPort, setRecitalSendPort } from './bot/recital-port.js';
import { bridgeSendPort, sdkBridgePort, setBridgeSendPort } from './bot/bridge-port.js';
import { musicSendPort, sdkMusicPort, setMusicSendPort } from './bot/music-port.js';
import { registerBridgeIntake, bridgeMediaStore } from './plugins/channel-bridge/intake.js';
import type { BridgeDeps } from './plugins/channel-bridge/service.js';
import { CHANNEL_BRIDGE_ID } from './plugins/channel-bridge/plugin.js';
import { CAPTURE_ID } from './plugins/capture/plugin.js';
import { refreshCaptureRooms, setRoomRefresher, shouldCapture } from './capture/room-service.js';
import { watchArrivals } from './plugins/welcome/trigger.js';
import { resolveWelcomeSettings } from './plugins/welcome/settings.js';
import { botGroupSummaries, membershipIsCurrent } from './capture/room-service.js';
import {
  membershipIsRecorded,
  recordMembershipChange,
  type MembershipHow,
} from './db/group-memberships.js';
import { listCaptureAssignments } from './db/capture-assignments.js';
import { seedBridgeTick, setBridgeJobDeps } from './queue/jobs/bridge.js';
import { seedMusicTick, setMusicJobDeps } from './queue/jobs/music.js';
import {
  botMusicView,
  latestMemberAudio,
  playMemberUpload,
  playTrackToGroup,
  type MusicDeps,
} from './plugins/music/service.js';
import {
  assignmentsForBot as musicAssignmentsForBot,
  findTrackForBot,
  getTrack as musicGetTrack,
  libraryFactsForBot as musicLibraryFactsForBot,
  lastPlayedInGroup as musicLastPlayedInGroup,
  nextTrackByArtistForBot,
  nextTrackByGenreForBot,
  nextTrackForBot,
  nextTrackFromPlaylistForBot,
  tracksByGenreForBot as musicTracksByGenreForBot,
  playlistTracks as musicPlaylistTracks,
  trackReachableByBot,
} from './plugins/music/store.js';
import { MUSIC_ID, MUSIC_UPLOADS_ID } from './plugins/music/plugin.js';
import { status as webStatus } from './web/status.js';
import { RECITAL_JOB, setRecitalJobDeps } from './queue/jobs/recital.js';
import {
  startRecital,
  tellBookScene,
  type RecitalDeps,
} from './interaction/recital-service.js';
import { sceneClosingChars, sceneOpeningChars } from './interaction/book-scene.js';
import { recitalSendPort } from './bot/recital-port.js';
import { enqueueJob } from './queue/store.js';
import { registerCapture } from './capture/handler.js';
import { makePersistenceHooks } from './capture/persist.js';
import { withBotCapture, type BotReplyMeta } from './capture/bot-message.js';
import { checkPublishedMedia } from './media/pipeline.js';
import { describeMediaEncryption } from './media/at-rest.js';
import { sampleEncryptedOriginal } from './media/at-rest-check.js';
import { makeConsentHandler } from './consent/commands.js';
import type { CapturedMessage } from './capture/message.js';
import { assertDbReachable, closePool, getPool, withTransaction } from './db/pool.js';
import { markInterruptedMediaReceipts, setMemberCategory } from './db/messages.js';
import { SettingsService } from './settings/service.js';
import { SecurityService } from './security/settings.js';
import { ArchiveService } from './archive/settings.js';
import { InteractionService, fillPersona } from './interaction/settings.js';
import { InteractionEngine } from './interaction/engine.js';
import {
  AiRuntimeService,
  currentReplyModel,
  personalizeAiReply,
} from './interaction/ai-runtime.js';
import { activeResolverName } from './interaction/resolver.js';
import { RuntimePolicyService } from './profiles/runtime-policy.js';
import {
  BotPersonalityService,
  currentBotPersonality,
  setBotPersonalityService,
  warmBotPersonality,
} from './profiles/bot-personality.js';
import {
  PromptRuleService,
  currentPromptRules,
  setPromptRuleService,
  warmPromptRules,
} from './interaction/prompt-rule-service.js';
import {
  ModerationService,
  currentModerationRules,
  setModerationService,
  warmModerationRules,
} from './moderation/service.js';
import { PluginService } from './plugins/service.js';
import { KnowledgeService, setKnowledgeService } from './knowledge/service.js';
import { Embedder } from './knowledge/embed.js';
import { KNOWLEDGE_BASE_ID } from './plugins/knowledge-base/plugin.js';
import { CryptoPriceService } from './plugins/crypto-prices/service.js';
import { providerKeyStatus } from './plugins/crypto-prices/settings.js';
import { CRYPTO_PRICES_ID } from './plugins/crypto-prices/plugin.js';
import { WEB_SEARCH_ID } from './plugins/web-search/plugin.js';
import { WebSearchService, setWebSearchService } from './plugins/web-search/service.js';
import { startAdminServer } from './web/server.js';
import { status } from './web/status.js';
import { registerAdminViews } from './web/views/index.js';
import { enqueueModerationExpiry, startQueue, stopQueue } from './queue/index.js';
import { resweepOverdueMutes } from './queue/jobs/moderation-expiry.js';
import { listOverdueSanctions } from './moderation/store.js';
import { startDestructionSweeper } from './archive/sweeper.js';

function runConfigCheck(cfg: Config, localAi: LocalAiConfig): void {
  log.info('Configuration loaded:', redactConfig(cfg));
  log.info('Local AI configuration:', redactLocalAiConfig(localAi));
  log.info('Config valid. Exiting 0.');
}

/** Ensures the archive DB is reachable and the schema has been migrated. */
async function assertDbReady(): Promise<void> {
  try {
    await assertDbReachable();
  } catch (err) {
    throw new Error(
      `Cannot reach PostgreSQL — check DATABASE_URL. (${err instanceof Error ? err.message : String(err)})`,
    );
  }
  const { rows } = await getPool().query<{ t: string | null }>(
    `SELECT to_regclass('public.messages') AS t`,
  );
  if (!rows[0]?.t) {
    throw new Error('Archive schema is not initialized. Run: npm run migrate');
  }
}

/**
 * Logs which groups each hosted bot is in (capture only works there).
 *
 * Per bot since CCB-S5-001, because "the bot is in 3 groups" is not a fact about the
 * deployment any more: a bot in no groups is the thing worth warning about, and one bot
 * being in two would hide another being in none.
 */
async function reportGroups(host: RuntimeHost, cfg: Config): Promise<void> {
  for (const bot of host.bots) {
    try {
      // Through the runtime, which schedules it as this bot: a bare call is refused with
      // `differentActiveUser` for every bot that is not the active one (CCB-S5-018).
      const all = await host.runtime.listGroups(bot.simplexUserId);
      // ── ENDED MEMBERSHIPS ARE NOT GROUPS THE BOT IS IN (CCB-S5-034, D-192) ──
      //
      // `apiListGroups` returns records for memberships that are OVER, and this line printed
      // every one of them as though it were current. The operator removed the bot from a
      // group, saw it still listed here and on the dashboard, and spent a week chasing
      // groups he did not have - and everyone advising him chased the wrong cause, because
      // the surface said something untrue.
      //
      // Production held six records for one bot in three rooms, of which exactly one
      // membership was current. The ended ones are still worth stating, because they are why
      // the core's own count is larger than the truth, but they are stated AS ended.
      const groups = all.filter((g) => membershipIsCurrent(g.membership?.memberStatus));
      const ended = all.length - groups.length;
      const endedNote =
        ended === 0
          ? ''
          : ` (${String(ended)} record(s) of memberships that have ENDED are not listed; ` +
            `clear them on the Capture page)`;
      if (groups.length === 0) {
        log.warn(
          `Bot "${bot.config.displayName}" is not a member of any group yet${endedNote}. ` +
            'Join one with: npm run connect -- "<simplex group link>"',
        );
        continue;
      }
      // The GROUP'S name, not the core's local alias: `localDisplayName` carries the `_1`
      // disambiguator from UNIQUE (user_id, local_display_name) and names nothing outside
      // this database, which is what the operator was shown for a week (D-193).
      const names = groups.map((g) => g.groupProfile?.displayName || g.localDisplayName).join(', ');
      log.info(
        `Bot "${bot.config.displayName}" is in ${groups.length} group(s): ${names}${endedNote}`,
      );
      if (
        cfg.groupName &&
        !groups.some(
          (g) => g.localDisplayName === cfg.groupName || g.groupProfile?.displayName === cfg.groupName,
        )
      ) {
        log.warn(
          `GROUP_NAME="${cfg.groupName}" does not match any group "${bot.config.displayName}" ` +
            `has joined.`,
        );
      }
    } catch (err) {
      // The real error, not the SDK's pointer to it (CCB-S5-018). This is the second of two
      // places that read the groups per bot and the second that printed "see chatError
      // property" at an operator.
      log.warn(
        `Could not list groups for "${bot.config.displayName}": ${describeChatError(err)}`,
      );
    }
  }
}

/**
 * Everything one hosted bot needs that is not the bot itself.
 *
 * Built once and shared, because none of it is per bot: the market data, the search
 * provider and the plugin registry are deployment-wide services, and giving each bot its
 * own would multiply the provider calls and the caches for no gain. What IS per bot -
 * the character, the laws, the ladders, the conversation state, the reply budget - lives
 * inside the graph {@link buildBotGraph} builds.
 */
interface BotGraphDeps {
  cfg: Config;
  interaction: InteractionService;
  plugins: PluginService;
  prices: CryptoPriceService;
  webSearch: WebSearchService;
  knowledge: KnowledgeService;
  host: RuntimeHost;
}

/** One bot's engine and the recital dependencies that reach it. */
interface BotGraph {
  bot: HostedBot;
  engine: InteractionEngine;
  recitalDeps: () => Omit<RecitalDeps, 'db'>;
}

/**
 * Build the whole conversational graph for ONE bot (CCB-S5-001).
 *
 * ── WHY THIS IS A FUNCTION NOW ───────────────────────────────────────────────
 *
 * It used to be the body of `startCaptureWorker`, because there was one bot and therefore
 * one engine, one consent handler, one capture registration and one set of hooks. Every
 * one of those is per bot: an engine holds the conversation state, the follow-up windows
 * and the reply budgets, so two bots sharing one would let a member's reply to bot A open
 * a follow-up window on bot B, and would spend one budget on two groups.
 *
 * Nothing in here is shared between bots except the services passed in, and that is the
 * property the isolation checks assert.
 */
/**
 * The bridge's dependencies (CCB-S5-032), one factory for both consumers: the
 * per-bot intake (which binds THIS bot's FileReceiver for media) and the queue
 * jobs (which never store media and pass null). Everything is read LIVE - the
 * per-bot switch, the persona lines, the file bound - so a console change takes
 * effect on the next tick rather than the next boot.
 */
function makeBridgeDeps(
  interaction: InteractionService,
  plugins: PluginService,
  storeMedia: BridgeDeps['storeMedia'],
): BridgeDeps {
  const linesFor = (botProfileId: number): ReturnType<BridgeDeps['linesFor']> => {
    // THIS bot's persona in ITS default language (CCB-S5-006): the strings are
    // per bot, and the bridge has no member message to pick a language from, so
    // the bot's configured default is the honest choice.
    const s = interaction.get(botProfileId);
    const strings = s.persona[s.defaultLanguage] ?? s.persona['en'];
    const when = (postedAt: Date): string =>
      `${postedAt.toISOString().slice(0, 16).replace('T', ' ')} UTC`;
    return {
      lang: s.defaultLanguage,
      attributionFor: (channel, postedAt) =>
        fillPersona(strings?.bridgeAttribution ?? '', { channel, when: when(postedAt) }),
      remainderLine: (channel, n) => fillPersona(strings?.bridgeMore ?? '', { channel, n }),
    };
  };
  return {
    db: getPool(),
    port: () => bridgeSendPort(),
    isEnabledFor: (botProfileId) => plugins.isEnabledFor(botProfileId, CHANNEL_BRIDGE_ID),
    linesFor,
    storeMedia,
    maxFileBytes: () => plugins.channelBridgeSettings().maxFileBytes,
  };
}

function makeMusicDeps(
  cfg: Config,
  interaction: InteractionService,
  plugins: PluginService,
): MusicDeps {
  return {
    db: getPool(),
    port: () => musicSendPort(),
    isEnabledFor: (botProfileId) => plugins.isEnabledFor(botProfileId, MUSIC_ID),
    uploadsEnabledFor: (botProfileId) => plugins.isEnabledFor(botProfileId, MUSIC_UPLOADS_ID),
    langFor: (botProfileId) => interaction.get(botProfileId).defaultLanguage,
    musicRoot: cfg.musicRoot,
    settings: () => plugins.musicSettings(),
    onFault: (message) => webStatus.error(message),
  };
}

/**
 * The MUSIC lane's operations for ONE bot (CCB-S5-044): thin verbs over the
 * service, scoped so a bot can only see and play its own assignments - the
 * absent-capability property the harness mutates.
 */
function musicOpsFor(cfg: Config, interaction: InteractionService, plugins: PluginService, botProfileId: number) {
  const deps = makeMusicDeps(cfg, interaction, plugins);
  return {
    view: () => botMusicView(deps, botProfileId),
    tracksOf: async (name: string) => {
      const assignments = await musicAssignmentsForBot(deps.db, botProfileId);
      const hit = assignments.find((a) => a.playlistName.toLowerCase() === name.toLowerCase())
        ?? assignments.find((a) => a.playlistName.toLowerCase().includes(name.toLowerCase()));
      if (hit === undefined) return null;
      const tracks = await musicPlaylistTracks(deps.db, hit.playlistId);
      return {
        playlist: hit.playlistName,
        items: tracks.map((t) => ({ id: t.id, title: t.title })),
        total: tracks.length,
      };
    },
    playById: async (groupId: number, trackId: number) => {
      // The number came out of a list SHE showed, and the boundary still holds:
      // a stale context or a crafted number must not reach past the assignments.
      if (!(await trackReachableByBot(deps.db, botProfileId, trackId))) return 'unknown' as const;
      const track = await musicGetTrack(deps.db, trackId);
      if (track === null) return 'unknown' as const;
      const out = await playTrackToGroup(deps, botProfileId, groupId, track, {
        requested: true,
        assignmentId: null,
      });
      return out.busy
        ? ('busy' as const)
        : out.sent
          ? ('sent' as const)
          : out.failed === true
            ? ('send-failed' as const)
            : ('unavailable' as const);
    },
    playFromPlaylist: async (groupId: number, name: string) => {
      // Per-room ADVANCE (D-222): two members asking minutes apart get two
      // different tracks, and the playlist plays through before repeating.
      const track = await nextTrackFromPlaylistForBot(deps.db, botProfileId, groupId, name);
      if (track === null) return 'empty' as const;
      const out = await playTrackToGroup(deps, botProfileId, groupId, track, {
        requested: true,
        assignmentId: null,
      });
      return out.busy
        ? ('busy' as const)
        : out.sent
          ? ('sent' as const)
          : out.failed === true
            ? ('send-failed' as const)
            : ('unavailable' as const);
    },
    facts: async () => {
      // Per BOT, not per deployment (D-220): the DJ sheet must describe what
      // SHE can reach, or a second bot advertises genres it cannot play.
      const f = await musicLibraryFactsForBot(deps.db, botProfileId);
      return {
        tracks: f.tracks,
        genres: f.genres, // {name, count}: the cards need the counts (D-221)
        playlists: (await musicAssignmentsForBot(deps.db, botProfileId)).length,
      };
    },
    playByGenre: async (groupId: number, genre: string) => {
      const track = await nextTrackByGenreForBot(deps.db, botProfileId, groupId, genre);
      if (track === null) return 'empty' as const;
      const out = await playTrackToGroup(deps, botProfileId, groupId, track, {
        requested: true,
        assignmentId: null,
      });
      return out.busy
        ? ('busy' as const)
        : out.sent
          ? ('sent' as const)
          : out.failed === true
            ? ('send-failed' as const)
            : ('unavailable' as const);
    },
    playByTitle: async (groupId: number, title: string) => {
      const track = await findTrackForBot(deps.db, botProfileId, title);
      if (track === null) return 'unknown' as const;
      const out = await playTrackToGroup(deps, botProfileId, groupId, track, {
        requested: true,
        assignmentId: null,
      });
      return out.busy
        ? ('busy' as const)
        : out.sent
          ? ('sent' as const)
          : out.failed === true
            ? ('send-failed' as const)
            : ('unavailable' as const);
    },
    playByArtist: async (groupId: number, artist: string) => {
      const track = await nextTrackByArtistForBot(deps.db, botProfileId, groupId, artist);
      if (track === null) return 'empty' as const;
      const out = await playTrackToGroup(deps, botProfileId, groupId, track, {
        requested: true,
        assignmentId: null,
      });
      return out.busy
        ? ('busy' as const)
        : out.sent
          ? ('sent' as const)
          : out.failed === true
            ? ('send-failed' as const)
            : ('unavailable' as const);
    },
    playNext: async (groupId: number) => {
      // What "next" follows (D-222): the room's last play - its genre when it
      // has one, else anything reachable - through the same per-room advance,
      // so the just-played track is the last candidate to come around again.
      const last = await musicLastPlayedInGroup(deps.db, botProfileId, groupId);
      if (last === null) return 'empty' as const;
      const firstGenre = last.genre?.split(',')[0]?.trim();
      const track =
        firstGenre !== undefined && firstGenre !== ''
          ? ((await nextTrackByGenreForBot(deps.db, botProfileId, groupId, firstGenre)) ??
            (await nextTrackForBot(deps.db, botProfileId, groupId)))
          : await nextTrackForBot(deps.db, botProfileId, groupId);
      if (track === null) return 'empty' as const;
      const out = await playTrackToGroup(deps, botProfileId, groupId, track, {
        requested: true,
        assignmentId: null,
      });
      return out.busy
        ? ('busy' as const)
        : out.sent
          ? ('sent' as const)
          : out.failed === true
            ? ('send-failed' as const)
            : ('unavailable' as const);
    },
    tracksOfGenre: async (genre: string) => {
      const tracks = await musicTracksByGenreForBot(deps.db, botProfileId, genre);
      if (tracks.length === 0) return null;
      return {
        genre,
        items: tracks.map((t) => ({ id: t.id, title: t.title })),
        total: tracks.length,
      };
    },
    playSomething: async (groupId: number) => {
      const track = await nextTrackForBot(deps.db, botProfileId, groupId);
      if (track === null) return 'empty' as const;
      const out = await playTrackToGroup(deps, botProfileId, groupId, track, {
        requested: true,
        assignmentId: null,
      });
      return out.busy
        ? ('busy' as const)
        : out.sent
          ? ('sent' as const)
          : out.failed === true
            ? ('send-failed' as const)
            : ('unavailable' as const);
    },
    uploadLimitBytes: () => plugins.musicSettings().memberUploadMaxBytes,
    playUpload: async (groupId: number, senderMemberId: string) => {
      if (!deps.uploadsEnabledFor(botProfileId)) return 'off' as const;
      const file = await latestMemberAudio(deps.db, groupId, senderMemberId);
      const out = await playMemberUpload(deps, botProfileId, groupId, file);
      if (out.ok) return 'sent' as const;
      switch (out.refusal) {
        case 'capability-off': return 'off' as const;
        case 'no-file': return 'no-file' as const;
        case 'not-audio': return 'not-audio' as const;
        case 'too-large': return 'too-large' as const;
        default: return 'unavailable' as const;
      }
    },
  };
}

function buildBotGraph(bot: HostedBot, deps: BotGraphDeps): BotGraph {
  const { cfg, interaction, plugins, prices, webSearch } = deps;
  const botProfileId = bot.config.botProfileId;
  const hooks = makePersistenceHooks(cfg);

  /**
   * The one place her own messages become archive rows (CCB-S3-007). Both reply
   * paths — the dialogue engine and the slash commands — go through this, for
   * the same reason they already share one transport: two capture sites would
   * be two chances for her side of a conversation to go missing.
   *
   * The placeholder is read live from the persona settings, so an operator who
   * rewrites "that member" sees it take effect on the next reply.
   */
  const placeholderFor = (lang: string): string => {
    // THIS bot's persona (CCB-S5-006): the strings are per bot, so a placeholder read from
    // the shared record would be another bot's wording.
    const p = interaction.get(botProfileId).persona;
    return (
      p[lang]?.redactedMember ??
      p[interaction.get(botProfileId).defaultLanguage]?.redactedMember ??
      p['en']?.redactedMember ??
      'that member'
    );
  };

  /**
   * The outbound transport, bound to THIS bot.
   *
   * Serialized by the active-user scheduler, held until the core is ready (D-085's
   * factor-65 warm-up), and attributed from the core's own `r.user.userId` (D-124). The
   * attribution is what makes a misroute loud rather than silent: the core states who
   * sent, and the runtime checks it against who was meant to.
   */
  const sendOut = (
    msg: CapturedMessage,
    text: string,
    opts: { quote: boolean },
  ): Promise<readonly unknown[]> => sendViaRuntime(bot.sendGroupText, msg, text, opts);

  const sendAndArchive = (
    msg: CapturedMessage,
    text: string,
    opts: { quote: boolean } & BotReplyMeta,
  ): Promise<void> =>
    withBotCapture(placeholderFor, (t, o: { quote: boolean }) => sendOut(msg, t, o))(text, opts);

  // The engine is created below; the callback is late-bound so the slash path
  // can refresh the same follow-up window the engine owns.
  let noteReply: (g: number, m: string) => void = () => undefined;
  // Late-bound like noteReply, for the same reason: the engine is built below,
  // and the slash path needs it to ask the hide-or-delete question (CCB-S3-013).
  let askRevokeChoice: (msg: CapturedMessage) => Promise<void> = () => Promise.resolve();
  /**
   * One bot answers a command that names nobody (CCB-S5-027, D-182).
   *
   * Read through the runtime's ownership index on every message rather than decided at
   * boot: a bot that joins or leaves a group changes the answer, and the index is rebuilt
   * per profile as that happens.
   */
  const answersCommands = (groupId: number): boolean =>
    deps.host.runtime.ownership.answersCommands(groupId);

  hooks.onCommand = makeConsentHandler(interaction, (g, m) => noteReply(g, m), {
    send: sendAndArchive,
    askRevokeChoice: (msg) => askRevokeChoice(msg),
    answersCommands,
  });

  /**
   * Reading the Book out loud (CCB-S4-047).
   *
   * Everything a recital needs that is not the database, gathered once. `send` is read
   * through the port rather than captured, so a recital started before the core is ready
   * declines instead of throwing, and `reserve` is the engine's own limiter so a reading
   * and an ordinary reply draw on one budget rather than two.
   */
  const recitalDeps = (): Omit<RecitalDeps, 'db'> => ({
    // THIS bot's laws, which is the whole point of a per-bot rulebook: a bot that has
    // reworded a law must read out the wording it was actually given.
    rules: () => currentPromptRules(botProfileId),
    recital: () => interaction.get(botProfileId).recital,
    assetRoot: cfg.assetRoot,
    // Both go through the ENGINE rather than being rebuilt here. It already owns the one
    // identity builder, the one clock and the one rate limiter, and a second copy of any
    // of them is a fact she would state inconsistently or a budget she would overspend.
    renderRule: (rule) => engine.renderRuleForMember(rule),
    renderableValues: () => engine.renderableValues(),
    transition: (beat, _index, lang) => engine.reciteTransition(beat.title, lang),
    // Her voice for half a scene, from the brief rather than a chapter title.
    sceneVoice: (brief, lang, opts) => engine.sceneVoice(brief, lang, opts),
    send: recitalSendPort,
    reserve: (groupId, memberId) => engine.allowRecital(groupId, memberId),
    schedule: async (groupId, lang, beatIndex, delayMs) => {
      await enqueueJob(getPool(), RECITAL_JOB, {
        idempotencyKey: `recital:${String(groupId)}:${lang}:${String(beatIndex)}`,
        lane: 'interactive',
        runAt: new Date(Date.now() + delayMs),
        payload: { groupId, lang, beatIndex },
      });
    },
  });

  const engine = new InteractionEngine({
    db: getPool(),
    // Whose engine this is (CCB-S5-001). Everything per bot below reads it, and the
    // moderation counters are written against it.
    botProfileId,
    // For the Diagnostics page, so a near miss says which bot ignored it (CCB-S5-006).
    botName: bot.config.displayName,
    // THIS bot's settings (CCB-S5-006). The wake word, the nickname list, the retorts, the
    // persona and the guards are per bot; reading the shared record here is what made two
    // bots answer to one name.
    settings: () => interaction.get(botProfileId),
    personalize: personalizeAiReply,
    // Reading the Book out loud (CCB-S4-047). Returns false when a recital cannot start,
    // and the engine then gives the brief answer rather than going quiet.
    recite: (msg, lang) => startRecital({ ...recitalDeps(), db: getPool() }, msg, lang),
    // The Book as a SCENE (CCB-S5-005, D-159). One message: fire and light, what the book
    // means to her, ONE law, and an invitation. The law and both counts come from the
    // application, so nothing here can be quoted wrong or counted wrong.
    tellBook: async (msg, lang, previousLawId) => {
      const s = interaction.get(botProfileId);
      if (!s.bookScene.enabled) return null;
      const rules = currentPromptRules(botProfileId);
      if (rules.length === 0) return null;

      // The scene has its OWN length bound, moved by the verbosity dial underneath it. A
      // terse bot gets a terser scene; no setting turns it back into three paragraphs.
      const verbosity = currentBotPersonality(botProfileId)?.verbosity ?? 5;
      let shown: string | null = null;
      const told = await tellBookScene({ ...recitalDeps(), db: getPool() }, msg, lang, {
        previousLawId,
        openingChars: sceneOpeningChars(verbosity),
        closingChars: sceneClosingChars(verbosity),
        // THIS bot's reply path, not the recital port: archived, prefixed, and loud when it
        // fails. The port is for beats sent minutes later by a queue job; a scene is a reply.
        send: (text) => engine.sendSceneText(msg, lang, text),
        onLawShown: (lawId) => {
          shown = lawId;
        },
      });
      return told ? shown : null;
    },
    // THIS bot's character and dials (CCB-S4-029, per bot since CCB-S5-001). Read live,
    // so an operator moving a slider expects the next reply to sound different, not the
    // next restart.
    personality: () => currentBotPersonality(botProfileId),
    // THIS bot's laws (CCB-S4-039): the shared registry with this bot's deviations
    // applied. Read live like the dials above, and needed in every mode rather than only
    // the dialled ones: the whole system prompt is assembled from the registry.
    rules: () => currentPromptRules(botProfileId),
    // The model that is actually running (CCB-S4-042). A given fact like the clock, so
    // she stops naming the one her history was written against.
    replyModel: currentReplyModel,
    // THIS bot's two ladders (CCB-S4-032). Verbal escalation is live; enforcement
    // computes and records only. The engine has no capability to act on a computed
    // sanction: `send` is its one outbound, which is the no-act guarantee in structural
    // form.
    moderationRules: () => currentModerationRules(botProfileId),
    // ── ARMED (CCB-S4-035, D-139) ────────────────────────────────────────
    //
    // The capability, handed over only while a core is actually running. Two things
    // still have to be true before anything happens to anybody: the operator has set
    // the mode to enforce on the Rules page, and the resolved rung is not `none`. This
    // supplies the means; the ladder supplies the decision; the model supplies neither.
    //
    // `enforcementAvailable()` is re-read on every call rather than captured, so a bot
    // that stops leaves the engine observing instead of throwing into a member's reply.
    enforcementPort: () => (enforcementAvailable() ? liveEnforcementPort : null),
    // A mute without this is a mute nobody lifts. Booked on the durable queue, so it
    // survives the restart that a timer would not.
    scheduleUnmute: (sanctionId, at) => enqueueModerationExpiry(getPool(), sanctionId, at),
    // ── WHAT THIS BOT CAN BE ASKED FOR (CCB-S5-021, D-175) ───────────────
    //
    // The core intents plus the intents of the plugins enabled for THIS bot. Read live,
    // like the dials and the laws above, so a capability switched off for one bot in the
    // console leaves its vocabulary on the next message.
    //
    // It replaced a process-wide catalog. Plugin state lived under one `plugins` settings
    // key with one writer, so enabling web search enabled it for every hosted bot, and the
    // operator's Rick could google whether he wanted it to or not.
    capabilities: () => plugins.capabilitiesFor(botProfileId),
    // One bot answers `/search` and `/help` in a group (CCB-S5-027, D-182). The same
    // predicate the consent handler above uses, so the two cannot disagree about which
    // bot is speaking for a group.
    answersGroupCommands: answersCommands,
    // Handed over only while the plugin is enabled FOR THIS BOT; when it is off, PRICE is
    // not in this bot's catalog either, so this is belt and braces. A getter rather than a
    // spread since CCB-S5-021: decided once at boot, it would have disagreed with the
    // catalog for the whole life of the process after any console toggle.
    prices: () => (plugins.isEnabledFor(botProfileId, CRYPTO_PRICES_ID) ? prices : null),
    // Web search (CCB-S4-037), on exactly the same terms and for exactly the same
    // reason: off means LOOKUP is absent from this bot's catalog, and this is the second
    // line of defence rather than the first. The service holds no chat client, so
    // the only thing that can come back through here is text.
    webSearch: () => (plugins.isEnabledFor(botProfileId, WEB_SEARCH_ID) ? webSearch : null),
    // The music library (CCB-S5-044), same terms again: off means MUSIC is not
    // in this bot's catalog, and this getter is the second line of defence.
    music: () =>
      plugins.isEnabledFor(botProfileId, MUSIC_ID)
        ? musicOpsFor(cfg, interaction, plugins, botProfileId)
        : null,
    // Null when the knowledge base is off FOR THIS BOT. For a plugin that contributes no
    // intent this IS the absent-capability property: nothing is embedded, nothing is
    // searched, and no passage reaches the model. Read live, so a console toggle takes
    // effect on the next message.
    knowledge: () =>
      plugins.isEnabledFor(botProfileId, KNOWLEDGE_BASE_ID) && deps.knowledge
        ? deps.knowledge
        : null,
    priceSettings: () => plugins.getCryptoPrices(),
    // Presentation is the engine's decision (CCB-S3-003); this is only the
    // transport. Both this and the slash-command path go through the same send,
    // so the two can never disagree about quoting again — and both archive
    // what they send (CCB-S3-007).
    send: sendAndArchive,
  });
  noteReply = (g, m) => engine.noteExternalReply(g, m);
  askRevokeChoice = (msg) => engine.askRevokeChoiceAfterSlash(msg);

  const runtimePolicy = new RuntimePolicyService(getPool());
  hooks.onInteraction = (msg) =>
    runtimePolicy.handleInteraction(msg, async () => engine.handle(msg));
  // CCB-S3-009: the message is already archived by now; this records what kind
  // of instruction it was, which is what the category switches act on.
  hooks.onInstruction = async (msg, category) => {
    await setMemberCategory(
      getPool(),
      msg.groupId,
      msg.itemId,
      category ?? engine.lastHandledCategory(),
    );
  };
  hooks.isAddressed = (msg) => engine.isExplicitAddress(msg);

  // Receiving is attached NOW, before readiness, deliberately. A message that
  // arrives while the core is still subscribing is a real member's message and must
  // be captured; it is only SENDING that waits (D-085).
  //
  // On THIS bot's own event source, which is what keeps one bot's messages out of
  // another bot's engine. `GROUP_NAME` scoping is deliberately not applied per bot:
  // it is one deployment-wide name from the environment and would scope every bot to
  // one bot's group. A bot captures the groups it is in.
  //
  // `shouldCapture` is the room rule (CCB-S5-033, D-190): with two bots in one room exactly
  // one RECORD writes the archive. Passed as a live predicate rather than a value, because
  // the conflict it exists for appeared when a bot JOINED a room at runtime and nobody
  // touched a setting - a value read here would have been correct at boot and wrong an hour
  // later. A bot whose capability is off captures nothing anywhere; the index answers that
  // too, so this is one question rather than two.
  // WHY THE PER-MESSAGE READ IS SAFE COLD. `statesFor` FAILS CLOSED on a cache miss, and on
  // this path that would not delay a message but DROP it: `shouldCapture` would answer false,
  // `persist` would return false, and nothing would say so. The caller already awaits
  // `plugins.refreshFor(id)` immediately before building this graph (see the boot loop), so
  // the cache is warm before capture is listening. The per-message read stays because a
  // console toggle must take effect without a restart; it just never runs cold.

  registerCapture({ chat: bot.events, fileReceiver: bot.fileReceiver }, cfg, hooks, {
    shouldCapture: (groupId) =>
      deps.plugins.isEnabledFor(botProfileId, CAPTURE_ID) && shouldCapture(botProfileId, groupId),
  });

  // The channel bridge's intake (CCB-S5-032), on the same per-bot event source
  // and for the same isolation reason. Capture and the bridge route by item
  // DIRECTION (groupRcv with a member vs channelRcv with nobody), so no item
  // can enter both; parse.ts states the decision. Media receives through THIS
  // bot's FileReceiver into the bridge's own tree.
  registerBridgeIntake({ chat: bot.events, fileReceiver: bot.fileReceiver }, botProfileId, () =>
    makeBridgeDeps(
      deps.interaction,
      deps.plugins,
      bridgeMediaStore(bot.fileReceiver, cfg.bridgeMediaRoot),
    ),
  );

  // Onboarding steps two and three (CCB-S4-023, CCB-S4-025), on this bot's own stream
  // and filed against this bot. The listener used to look the bot up per event through
  // `selected_for_runtime`, which was right while one bot ran and would now file every
  // bot's contact requests against the primary.
  registerContactRequestListener(bot.events, getPool(), () => Promise.resolve(botProfileId));
  registerGroupInvitationListener(bot.events, getPool(), () => Promise.resolve(botProfileId));

  return { bot, engine, recitalDeps };
}

/**
 * Starts the capture worker. Failures are reported to the runtime status (so
 * the admin dashboard shows them) instead of killing the whole process — the
 * operator needs the console most when the bot is unhappy.
 */
async function startCaptureWorker(
  cfg: Config,
  settings: SettingsService,
  interaction: InteractionService,
  plugins: PluginService,
): Promise<RuntimeHost | null> {
  try {
    // CCB-S5-001: EVERY enabled bot is hosted. CCB-S4-021 hosted exactly one, for
    // isolation, and half two is this. The pre-runtime `bot.run` path and its
    // `BOT_RUNTIME_HOSTING` rollback lever are gone, as D-125 said they would be when
    // this arrived: that path cannot host a second profile, so keeping it would have been
    // a switch that silently reduced the deployment to one bot.
    const host = await startRuntimeHost(cfg, getPool(), {
      getFileTimeoutMs: () => settings.fileTimeoutMs,
    });
    // The admin console's onboarding actions need the running runtime (CCB-S4-022).
    // Registered rather than passed in, because the console is deliberately started
    // BEFORE the bot so it can show a failure when the bot fails to start, so there is
    // no runtime to hand it at the moment its views are built.
    setRuntimeAdminHandle(host);

    // ── THE CORE-ERASURE PATH (CCB-S3-027, rebound CCB-S5-001) ──────────────
    //
    // `apiDeleteChatItems` takes no user id and the core scopes its DELETE by `user_id`,
    // so issued as the wrong bot it erases nothing and raises nothing. The port resolves
    // the owning bot from the chat id and refuses when it cannot, so the queue retries
    // rather than recording an erasure that did not happen.
    setCoreDeletePort({
      eraseAsOwner: (chatType, chatId, itemId) =>
        host.runtime.deleteChatItems(chatType, chatId, [itemId]),
    });
    // The capability that arming needs (CCB-S4-035). Registered beside the delete port
    // and cleared beside it on shutdown, so "can the bot act" is one fact with one
    // lifetime rather than two that can disagree.
    setEnforcementHandle({
      runForGroup: (groupId, label, fn) => host.runtime.runForGroup(groupId, label, fn),
      chat: host.chat,
    });

    // The recital's own transport (CCB-S4-047). Group-id based, because beats two onward
    // are sent by a queue job long after the triggering message object has gone, and
    // owner-resolved for the same reason the erasure path is.
    setRecitalSendPort(
      sdkRecitalPort({
        sendGroupText: (groupId, text) => host.runtime.sendGroupTextAsOwner(groupId, text),
        sendGroupComposedAsOwner: (groupId, composed) =>
          host.runtime.sendGroupComposedAsOwner(groupId, composed),
      }),
    );

    // The bridge's transport and its queue-job deps (CCB-S5-032), beside the
    // recital port and for the same reasons: group-id based, owner-resolved.
    // The job deps carry NO media store - the tick and propagation never fetch
    // bytes, only the per-bot intake does.
    setBridgeSendPort(sdkBridgePort(host.runtime));
    setBridgeJobDeps(() => makeBridgeDeps(interaction, plugins, null));
    setMusicSendPort(sdkMusicPort(host.runtime));
    setMusicJobDeps(() => makeMusicDeps(cfg, interaction, plugins));

    // Deployment-wide services, built once. Every setting is read live, so a chain
    // reorder or a new API key takes effect on the next question without a restart.
    const prices = new CryptoPriceService({
      db: getPool(),
      settings: () => plugins.getCryptoPrices(),
    });
    const webSearch = new WebSearchService({
      settings: () => plugins.getWebSearch(),
      // THE RELEVANCE FLOOR (CCB-S5-028, D-183). The same embedder the knowledge base uses,
      // on its own SHORT timeout: this runs between a member's question and her answer, so
      // the ingest job's two-minute ceiling would be a bot that stopped talking. Measured
      // cost is ~120 ms warm and ~800 ms cold for a batch this size.
      embed: new Embedder({ config: loadLocalAiConfig(), timeoutMs: 15_000 }),
    });
    // ── WHAT SHE WAS GIVEN TO READ (CCB-S5-022, D-176) ────────────────────
    //
    // Deployment-wide, like the market data and the search provider, and for the same
    // reason: the store, its index and the embedding model are one of each. What is PER BOT
    // is which documents a bot was granted, and that is a filter inside the query rather
    // than a second store.
    //
    // Registered process-wide as well, because the ingest QUEUE JOB has only a document id
    // and the console is built before the bot starts.
    const knowledge = new KnowledgeService({
      db: getPool(),
      embedder: new Embedder({ config: loadLocalAiConfig() }),
      settings: () => plugins.getKnowledge(),
      // A REAL transaction on a dedicated client. `db` above is the pool, where BEGIN and
      // COMMIT issued as separate queries land on different connections and protect nothing.
      transaction: withTransaction,
    });
    setKnowledgeService(knowledge);
    // Registered so the Web Search page can show its counters and its last failure without
    // anybody reading the journal (CCB-S4-042).
    setWebSearchService(webSearch);

    // Each bot's character, laws and ladders read in BEFORE its engine can be asked for
    // them. Without this the first message to a freshly booted bot races the load and is
    // answered with the shared laws and no ladders, which is a correct-but-wrong first
    // reply that nothing would ever explain.
    const graphs: BotGraph[] = [];
    for (const bot of host.bots) {
      const id = bot.config.botProfileId;
      await Promise.all([
        warmBotPersonality(id),
        warmPromptRules(id),
        warmModerationRules(id),
        // Its wake word, nicknames, retorts, persona and guards (CCB-S5-006). Without this
        // the first message to a freshly booted bot races the read and is answered against
        // the SHARED wake word, which is the defect wearing a timing hat.
        interaction.refreshFor(id),
        // Its CAPABILITIES (CCB-S5-021), for the same reason and with a sharper cost: an
        // unwarmed bot falls back to the deployment's plugin states, so the first message
        // to a bot that must not search could reach a search. The window is one query and
        // this closes it.
        plugins.refreshFor(id),
      ]);
      graphs.push(
        buildBotGraph(bot, { cfg, interaction, plugins, prices, webSearch, knowledge, host }),
      );

      // ── WHAT THIS BOT WILL ACTUALLY WAKE ON (CCB-S5-018) ─────────────────
      //
      // Stated at boot, per bot, because "he does not answer to his name" was reported
      // repeatedly and there was no way to tell from outside WHICH name the running engine
      // had. The wake word travels through a settings row, a per-bot override, a cache and
      // a refresh, and a failure at any of those reads identically from the group: silence.
      //
      // Read back through the same `interaction.get(id)` the engine's `settings` getter
      // uses, not from the database, so this line is the value the reply path will see
      // rather than the value it ought to see. A line that agreed with the row and
      // disagreed with the engine would be worse than none.
      const effective = interaction.get(id);
      log.info('bot: hosted and listening', {
        bot: bot.config.displayName,
        simplexUserId: bot.simplexUserId,
        wakeWord: effective.wakeWord,
        nicknames: effective.nicknames.words.length,
        addressingMode: effective.addressing.mode,
        // What this bot can be asked for (CCB-S5-021), on the same terms as the wake word
        // above and for the same reason: capability travels through a settings key, a
        // per-bot override, a cache and a refresh, and a failure at any of them reads from
        // the group as her not understanding the question.
        plugins: plugins
          .list(id)
          .map((p) => `${p.id}:${p.enabled ? 'on' : 'off'}${p.inherited ? '' : '(own)'}`)
          .join(' '),
      });
      if (effective.wakeWord === interaction.get().wakeWord && host.bots.length > 1) {
        // Not necessarily wrong: a bot may legitimately be on the shared value. It is
        // worth saying out loud with more than one bot, because two bots on one wake word
        // is the CCB-S5-006 defect and it is invisible from the group.
        log.warn(
          `Bot "${bot.config.displayName}" answers to the SHARED wake word ` +
            `"${effective.wakeWord}". If it should have its own, set it on the Addressing ` +
            `page; two bots on one wake word both answer the same sentence.`,
        );
      }
    }

    // The recital job holds a group id and nothing else, so it finds the engine of the bot
    // that owns that group. Null while the ownership index is still empty, which the
    // handler retries rather than treating as a dead beat.
    setRecitalJobDeps((groupId) => {
      const owner = host.runtime.ownerOf(groupId);
      if (owner === undefined) return null;
      return graphs.find((g) => g.bot.simplexUserId === owner)?.recitalDeps() ?? null;
    });

    await reportGroups(host, cfg);

    const ia = interaction.get();
    // The wake words are PER BOT (CCB-S5-006), so one name in this line would be a lie the
    // moment a second bot is hosted, and it is the exact lie this briefing fixes. Each bot
    // is named with the word it actually answers to.
    const wakeWords = host.bots
      .map((b) => `${b.config.displayName}="${interaction.get(b.config.botProfileId).wakeWord}"`)
      .join(', ');
    log.info(
      `Interaction layer: wake words ${wakeWords}, natural addressing ` +
        `${ia.naturalAddressing ? 'on' : 'off'}, ` +
        // The DEPLOYMENT-WIDE plugin states, said so, because each bot's own are on its
        // own line above and a bare "plugins [...]" here would read as the whole answer -
        // which is exactly what it was before CCB-S5-021 and exactly what was wrong.
        `plugins (deployment-wide) [${plugins
          .list()
          .map((p) => `${p.id}:${p.enabled ? 'on' : 'off'}`)
          .join(' ')}], ` +
        `reply mode "${ia.replyMode}"${ia.replyMode === 'mention' && !ia.namePrefix.enabled ? ' (name prefix off)' : ''}, ` +
        `resolver "${activeResolverName()}", ` +
        `${String(host.bots.length)} bot(s) hosted.`,
    );

    await runBootSelfChecks(cfg, plugins, prices);

    // Push the avatar to group members: the core only sends the member-profile
    // update (XInfo, incl. avatar) when the bot next sends a GROUP message. This
    // sends one minimal message per distinct avatar (marker-gated — no spam).
    //
    // It is the one send the boot sequence makes, so it is the one thing that has to wait
    // for readiness. Detached rather than awaited: the queue, the sweeper and the shutdown
    // handler must not sit behind a core that is still subscribing, and readiness is
    // bounded by the state machine's ceiling anyway.
    void host
      .whenReady()
      .then(async () => {
        log.info('Bots are live: the core has settled and replies are being sent.', {
          readyReason: host.runtime.readyReason,
          eventsRouted: host.runtime.counters.eventsRouted,
          eventsUnknownProfile: host.runtime.counters.eventsUnknownProfile,
        });
        // The subscribe-before-capture-registers window (see RoutedEventSource):
        // narrow, real, and countable rather than assumed empty. Per bot now, because
        // each has its own source.
        for (const bot of host.bots) {
          for (const [tag, n] of bot.events.unhandled) {
            log.warn('Events arrived before anything subscribed to them', {
              tag,
              count: n,
              bot: bot.config.displayName,
            });
            if (tag === 'newChatItems') {
              status.error(
                `${n} incoming message event(s) for ${bot.config.displayName} arrived before ` +
                  `capture was listening and were not archived. They were sent between the core ` +
                  `starting and the bot finishing its boot; check the group for messages around ` +
                  `the restart.`,
              );
            }
          }
        }

        // Which bot owns which group. Read once the core has settled, because
        // `apiListGroups` before subscription can report a partial membership, and the
        // erasure path would then refuse a group it will shortly know about.
        await host.runtime.refreshOwnership();
        reportCoTenancy(host);
        // Which bot captures which room, from the member sets (CCB-S5-033). After
        // `refreshOwnership` for the same reason it is: the core must have settled, or a
        // partial membership would make two bots look like one room's only capturer in turn.
        await refreshRooms(host, plugins);
        // Recorded once the rooms are known, and watched from here on: a join by LINK
        // updated nothing before this, which is why nobody saw one happen.
        await reconcileMemberships(host, 'observed');
        watchMemberships(host, plugins);

        // Per bot, and only CURRENT memberships (CCB-S5-034, D-192). This read
        // `ownership.all().map(g => g.localDisplayName)`: every bot's groups flattened into
        // one string with nobody named, counting memberships that had ENDED as though they
        // were current, and set once here so a runtime join could not appear until a
        // restart. `refreshRooms` re-states it on every membership change.
        status.botRunning(botSummaries(host));

        for (const bot of host.bots) {
          // ── NOT WRAPPED IN runScheduled (CCB-S5-015, D-167) ─────────────
          //
          // It was, and that was a deadlock. `flushAvatarToGroups` calls `sendToGroup`,
          // which schedules; scheduling from inside a critical section waits for the
          // section that is waiting for it, so every flush blocked for the full 60 s
          // command timeout, logged that its message had not gone out, and then sent it
          // anyway the moment the tail unblocked. Per bot, serialized by this loop.
          //
          // The wrapper was never needed: every SDK call inside already goes through the
          // scheduler as this bot. That was written here as "apiListGroups takes the user id
          // explicitly", which was the false rule CCB-S5-018 corrected (D-171): naming a user
          // id does not exempt a command, it makes the core REFUSE it when the active user
          // differs. The listing is a scheduled port now. The scheduler refuses re-entry
          // outright, so the wrapper cannot silently come back either.
          await flushAvatarToGroups(getPool(), {
            user: bot.user,
            displayName: bot.config.displayName,
            sendToGroup: (groupId, text) => bot.sendGroupText(groupId, text),
            listGroups: () => host.runtime.listGroups(bot.simplexUserId),
          });
        }
      })
      .catch((err: unknown) => {
        log.warn(
          `Post-readiness boot work skipped or failed: ${err instanceof Error ? err.message : String(err)}`,
        );
      });

    return host;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    status.botFailed(message);
    status.error(`Capture worker failed to start: ${message}`);
    log.error(`Capture worker failed to start: ${message}`);
    return null;
  }
}

/**
 * Two hosted bots sitting in one SimpleX group (CCB-S5-001).
 *
 * ── WHY THIS IS REPORTED AND NOT SILENTLY TOLERATED ──────────────────────────
 *
 * Every bot captures the groups it is in. Two bots in ONE group therefore capture the
 * same message twice, under two different core group ids (the ids differ because each
 * profile holds its own `groups` row), so the archive gets two rows for one thing a
 * member said and derives consent for both. That is not a duplicate-key error the
 * database would catch - `UNIQUE (group_id, group_msg_id)` permits both - it is two
 * archive entries for one utterance, and D-083 records that canonicalising them is
 * separate work that does not exist yet.
 *
 * So it is named, loudly, rather than discovered from a public archive that shows every
 * message twice. It is not REFUSED, because refusing would mean one of the operator's
 * bots silently going deaf in a group he deliberately put it in, and because the
 * condition is recoverable by removing one of them.
 */
function reportCoTenancy(host: RuntimeHost): void {
  const shared = host.runtime.ownership.sharedGroups();
  for (const group of shared) {
    const names = group.members
      .map((m) => {
        const bot = host.bots.find((b) => b.simplexUserId === m.simplexUserId);
        return bot?.config.displayName ?? `user ${String(m.simplexUserId)}`;
      })
      .join(' and ');
    log.error('Two hosted bots are in the same group', {
      group: group.members[0]?.localDisplayName,
      bots: names,
    });
    // WHAT IS AND IS NOT HANDLED, in the operator's own words (CCB-S5-027). Since D-182 the
    // commands that name nobody are answered by exactly one of them, so `/search` no longer
    // comes back twice and a consent decision has one actor. The DOUBLE ARCHIVING is
    // untouched and is still the reason this is an error rather than a note: canonicalising
    // the two rows is separate work that does not exist (D-083). Saying "every message twice
    // and two consent writes" after fixing half of it would be the stale-copy failure this
    // repository keeps recording.
    const elected = group.members
      .slice()
      .sort((a, b) => a.simplexUserId - b.simplexUserId)[0];
    const electedName =
      host.bots.find((b) => b.simplexUserId === elected?.simplexUserId)?.config.displayName ??
      `user ${String(elected?.simplexUserId ?? 0)}`;
    status.error(
      `${names} are both in the group "${group.members[0]?.localDisplayName ?? 'unknown'}". ` +
        `Every message there is archived TWICE, once per bot, and consent derived for both ` +
        `copies; nothing merges them. Commands that name no bot (/search, /help, /publish, ` +
        `/unpublish) are answered by ${electedName} alone, so they are not doubled. Remove ` +
        `one of them from that group. A bot per group is the supported arrangement; two bots ` +
        `in one group is not.`,
    );
  }
  const unknown = host.runtime.ownership.unidentifiedGroups();
  if (unknown.length > 0) {
    // ── THIS LINE IS NO LONGER THE ANSWER (CCB-S5-033, D-190) ───────────────
    //
    // It looked straight at the case this briefing exists for and reported it as an
    // unchecked case rather than a fault: `sharedGroupKey` consults `groupKeys.publicGroupId`
    // and `viaGroupLinkUri`, both of which the core leaves null for a bot ADDED to a group,
    // so the four groups it named were the four where co-tenancy was real and invisible.
    //
    // The room index answers the same question from the MEMBER SETS instead, which is
    // measurable rather than absent, and reports a real conflict through `status.error`.
    // Kept at debug because a null shared key is still true and still worth being able to
    // see; it is no longer the only thing said about these groups.
    log.debug('Some groups carry no shared identity; the room index decides them by membership', {
      groups: unknown.map((g) => g.localDisplayName).join(', '),
    });
  }
}

/**
 * Which bot captures which room, evaluated at boot (CCB-S5-033, D-190).
 *
 * At boot and on membership change, NOT only when a setting is saved. The operator did not
 * create the conflict that prompted this: a second bot joined a room that already had one,
 * and the conflict appeared with nobody touching a form. A rule that is only evaluated on
 * save is a rule that cannot see the way this actually happens.
 */
async function reconcileMemberships(host: RuntimeHost, how: MembershipHow): Promise<void> {
  const db = getPool();
  for (const bot of host.bots) {
    try {
      const groups = await host.runtime.listGroups(bot.simplexUserId);
      for (const g of groups) {
        // FAILS CLOSED (D-201): the history recorded `joined` for a channel the bot
        // had never joined, because `unknown` was absent from a deny-list.
        if (!membershipIsCurrent(g.membership?.memberStatus)) continue;
        if (await membershipIsRecorded(db, bot.config.botProfileId, g.groupId)) continue;
        await recordMembershipChange(db, {
          botProfileId: bot.config.botProfileId,
          simplexUserId: bot.simplexUserId,
          groupId: g.groupId,
          groupName: g.localDisplayName,
          change: 'joined',
          how,
        });
        log.info('membership: a bot is in a room that was not recorded', {
          bot: bot.config.displayName,
          group: g.localDisplayName,
          groupId: g.groupId,
          how,
        });
      }
    } catch (err) {
      // Loud, not swallowed: an unrecorded membership is exactly the blindness this fixes.
      log.error('membership: could not reconcile a bot\'s rooms', {
        bot: bot.config.displayName,
        error: describeChatError(err),
      });
    }
  }
}

/**
 * Watch for membership changing while the process runs.
 *
 * `userJoinedGroup` fires on this bot's own stream, and the existing handler only stamps a
 * row an invitation created - so a LINK join updated nothing and said nothing. Reconciling
 * from the core's own list rather than from the event payload means a join by any route is
 * recorded, and the room index is rebuilt so the new membership takes effect on the next
 * message rather than at the next restart.
 */
function watchMemberships(host: RuntimeHost, plugins: PluginService): void {
  // Console actions that end a membership refresh through this too (D-201).
  setRoomRefresher(() => refreshRooms(host, plugins));

  // ── SHE GREETS WHOEVER ARRIVES (CCB-S5-041, D-206) ────────────────────────
  //
  // Wired here rather than in `host.ts` because greeting needs the archive database and the
  // plugin states, and `host.ts` deliberately knows about neither. Settings are resolved per
  // arrival, not captured now: the operator edits the greeting between joins.
  watchArrivals(
    host.bots.map((b) => ({
      botProfileId: b.config.botProfileId,
      on: (event: string, handler: (ev: never) => void) => {
        (b.events as unknown as { on: (e: string, h: (ev: never) => void) => void }).on(
          event,
          handler,
        );
      },
    })),
    {
      db: getPool(),
      settingsFor: (botProfileId) =>
        resolveWelcomeSettings(getPool(), plugins.getStates(), botProfileId),
    },
  );
  for (const bot of host.bots) {
    bot.events.on('userJoinedGroup', () => {
      void (async () => {
        await reconcileMemberships(host, 'observed');
        await refreshRooms(host, plugins);
      })();
    });
  }
}

/** Each hosted bot's rooms, for the dashboard. Derived from the live room index. */
function botSummaries(host: RuntimeHost): ReturnType<typeof botGroupSummaries> {
  return botGroupSummaries(
    host.bots.map((b) => ({
      botProfileId: b.config.botProfileId,
      displayName: b.config.displayName,
    })),
  );
}

async function refreshRooms(host: RuntimeHost, plugins: PluginService): Promise<void> {
  await refreshCaptureRooms(
    {
      bots: host.bots.map((b) => ({
        botProfileId: b.config.botProfileId,
        simplexUserId: b.simplexUserId,
        displayName: b.config.displayName,
      })),
      listGroups: (simplexUserId) => host.runtime.listGroups(simplexUserId),
      listMembers: (simplexUserId, groupId) => host.runtime.listMembers(simplexUserId, groupId),
    },
    (botProfileId) => plugins.isEnabledFor(botProfileId, CAPTURE_ID),
    await listCaptureAssignments(getPool()),
  );
  // LIVE, not a boot snapshot (CCB-S5-034): this runs on every membership change, so a room
  // joined or left at runtime is on the dashboard without a restart.
  status.groupsChanged(botSummaries(host));
}

/**
 * The boot self-checks that are about the DEPLOYMENT rather than about any one bot.
 *
 * Lifted out of the capture worker unchanged when it became per bot (CCB-S5-001): media
 * encryption, published derivatives, pinned assets and provider keys are all
 * deployment-wide, and running them once per bot would report the same fault N times.
 */
async function runBootSelfChecks(
  cfg: Config,
  plugins: PluginService,
  prices: CryptoPriceService,
): Promise<void> {
  // Media encryption at rest (CCB-S3-012 §2). Three states, and they must not
  // look alike: OFF is a choice and is merely stated; ON is confirmed; and
  // "encrypted media exists but this key cannot read it" is a FAULT that has to
  // be loud, because the alternative is discovering a rotated MEDIA_SECRET from
  // a stream full of broken images weeks later.
  try {
    const enc = describeMediaEncryption();
    if (!enc.configured) {
      log.info(
        'Media encryption at rest is OFF (MEDIA_SECRET is unset). Originals are stored as-is.',
      );
    } else {
      const sample = await sampleEncryptedOriginal(getPool(), cfg.mediaRoot);
      if (sample.checked > 0 && !sample.readable) {
        status.error(
          'Media encryption is configured but the stored originals cannot be decrypted with the ' +
            'current MEDIA_SECRET. Every encrypted original is unreadable until the correct key ' +
            'is restored. Do NOT re-encrypt or backfill: that would destroy them.',
        );
        log.error('Media at rest: MEDIA_SECRET does not decrypt the existing originals.');
      } else {
        log.info(`Media encryption at rest is ON (${enc.algo}).`);
      }
    }
  } catch (err) {
    status.error(
      `Media encryption is misconfigured: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  // A published image whose derivative is missing is INVISIBLE, not broken-
  // looking (CCB-S3-011 Addendum A). Checked and healed at boot so an empty
  // stream is never the first sign of a fault.
  try {
    const media = await checkPublishedMedia(getPool(), cfg.mediaRoot);
    if (media.checked > 0) {
      log.warn(
        `Media: ${media.checked} published item(s) had no stripped derivative — ` +
          `${media.healed} regenerated, ${media.broken} still unservable.`,
      );
      if (media.broken > 0) {
        status.error(
          `${media.broken} published image(s) cannot be served: no stripped derivative could ` +
            `be produced. Check that the service user can write to MEDIA_ROOT/derived.`,
        );
      }
    }
  } catch (err) {
    // A boot self-check that itself fails must not be silent (CCB-S3-023): the
    // operator loses the check's protection and would never know.
    const emsg = err instanceof Error ? err.message : String(err);
    log.warn(`Media: could not check published derivatives (${emsg}).`);
    status.error(
      `Boot self-check failed: could not verify published media derivatives (${emsg}).`,
    );
  }

  // A pin that no enabled provider can serve fails SILENTLY and forever
  // (CCB-S3-008 §2), which is strictly worse than having no pin, so it is
  // checked at boot and named in the log rather than waiting for a member to
  // ask and get "the markets are out of earshot".
  try {
    const pins = await prices.checkPins();
    const broken = pins.filter((p) => !p.ok);
    if (broken.length > 0) {
      const names = broken.map((p) => p.symbol).join(', ');
      log.warn(
        `Price: ${broken.length} of ${pins.length} pinned asset(s) cannot be served by any ` +
          `enabled provider — ${names}. They will fail every lookup until the chain, a key, ` +
          `or the pin is corrected.`,
      );
      status.error(
        `${broken.length} pinned asset(s) have no enabled provider that can serve them: ${names}.`,
      );
    } else {
      log.info(`Price: all ${pins.length} pinned asset(s) have an enabled provider.`);
    }
  } catch (err) {
    const emsg = err instanceof Error ? err.message : String(err);
    log.warn(`Price: could not check the pinned assets (${emsg}).`);
    status.error(`Boot self-check failed: could not verify pinned assets (${emsg}).`);
  }

  // Configured-but-unreachable credentials (CCB-S3-023). A stored provider key that
  // cannot be decrypted (e.g. after a SESSION_SECRET rotation) is worse than no key:
  // the provider silently self-disables, and the only symptom a member sees is "the
  // markets are out of earshot". Distinguish it from an EMPTY key (a choice) and
  // discover it HERE, at boot, not from a member. This generalises the pin self-check
  // to credentials; a future plugin with its own credentials should add the same.
  try {
    if (plugins.isEnabled(CRYPTO_PRICES_ID)) {
      const cp = plugins.getCryptoPrices();
      const dead = cp.chain.filter(
        (n) => cp.providers[n]?.enabled && providerKeyStatus(cp, n).undecryptable,
      );
      if (dead.length > 0) {
        log.warn(
          `Plugins: ${dead.length} stored provider key(s) cannot be decrypted: ${dead.join(', ')}.`,
        );
        status.error(
          `Provider API key(s) stored but UNDECRYPTABLE: ${dead.join(', ')} (was SESSION_SECRET rotated?). ` +
            `They cannot authenticate; re-enter or clear them on the Plugins page.`,
        );
      }
    }
  } catch (err) {
    log.warn(
      `Plugins: could not check provider key usability (${err instanceof Error ? err.message : String(err)}).`,
    );
  }
}

async function runApp(cfg: Config, localAi: LocalAiConfig): Promise<void> {
  await assertDbReady();
  const settings = await SettingsService.load(getPool(), cfg.logLevel);

  // Any file receipt that was in-flight when the process last stopped is gone —
  // flag those messages so the operator sees them (before the ~48h XFTP expiry).
  const interrupted = await markInterruptedMediaReceipts(getPool());
  if (interrupted > 0) {
    log.warn(`${interrupted} media receipt(s) were interrupted by a previous restart — flagged.`);
  }

  const security = await SecurityService.load(getPool());
  const archive = await ArchiveService.load(getPool());
  const interaction = await InteractionService.load(getPool());
  const plugins = await PluginService.load(getPool());
  await AiRuntimeService.load(getPool(), localAi);
  // The personality dials (CCB-S4-029). Loaded before the console starts, because the
  // console's Personality page invalidates this cache on every save and a save that
  // arrived before the first load would invalidate nothing.
  setBotPersonalityService(await BotPersonalityService.load(getPool()));
  // The rule registry (CCB-S4-039). Loaded before the console starts, because the console's
  // Personality page previews the assembled prompt and would otherwise render before there
  // was anything to assemble it from.
  setPromptRuleService(await PromptRuleService.load(getPool()));
  // The moderation ladders (CCB-S4-032). Loaded before the console starts, for the same
  // reason as the personality: the Rules page invalidates this cache on every save, and
  // a save that arrived before the first load would invalidate nothing.
  setModerationService(await ModerationService.load(getPool()));

  // ── THE SAFETY NET UNDER THE MUTE TIMER (CCB-S4-035) ──────────────────────
  //
  // Every mute books its own expiry job the moment it applies, and that is the normal
  // path. This covers the window a crash can land in, between the sanction row committing
  // and the queue accepting the job: without it that member stays an observer forever, and
  // only the Active page's overdue flag would ever say so.
  //
  // Safe on every boot because `enqueueModerationExpiry` dedupes on its idempotency key
  // against live jobs, so a mute that already has one gets nothing new. Failure is logged
  // rather than fatal: a bot refusing to start because it could not re-queue an expiry
  // helps nobody who is currently muted.
  try {
    const overdue = await listOverdueSanctions(getPool(), new Date());
    if (overdue.length > 0) {
      await resweepOverdueMutes(
        getPool(),
        overdue.map((row) => row.id),
        (sanctionId) => enqueueModerationExpiry(getPool(), sanctionId, new Date()),
      );
    }
  } catch (error) {
    log.warn(
      `Moderation: the overdue-mute sweep did not run at boot (${
        error instanceof Error ? error.message : String(error)
      }).`,
    );
  }

  // One process (A2): the admin web server and the capture worker together.
  const adminCfg = loadAdminConfig();
  const adminServer = await startAdminServer({
    db: getPool(),
    adminCfg,
    mediaRoot: cfg.mediaRoot,
    settings,
    security,
    archive,
    interaction,
    plugins,
    cfg,
    registerViews: registerAdminViews,
  });

  const botHandle = await startCaptureWorker(cfg, settings, interaction, plugins);

  // The durable background-job worker (CCB-S3-022). Runs in this same process; a
  // failure to start is logged and surfaced but must not take the archive, the
  // admin console, or the bot down with it.
  try {
    await startQueue({ db: getPool() });
    // The bridge's cadence chain (CCB-S5-032). Safe on every boot: the seed's
    // minute-bucket idempotency key collapses into a live chain's own next link
    // rather than starting a second one; see queue/jobs/bridge.ts.
    await seedBridgeTick();
    await seedMusicTick();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    status.error(`Job queue failed to start: ${message}`);
    log.error(`Job queue failed to start: ${message}`);
  }

  // The backstop under deferred destruction (CCB-S3-013): lapses holds whose
  // expiry job never ran, and re-queues any deletion whose blocker is gone. Runs
  // once now, so a process that was down when a hold expired resolves it on the
  // way back up, then every quarter hour.
  try {
    startDestructionSweeper(getPool(), cfg.simplexFilesFolder);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    status.error(`Deferred-destruction sweeper failed to start: ${message}`);
    log.error(`Deferred-destruction sweeper failed to start: ${message}`);
  }

  log.info('CIND3R3LLA is capturing to PostgreSQL (consent-gated). Press Ctrl+C to stop.');

  await new Promise<void>((resolve) => {
    let shuttingDown = false;
    const shutdown = (signal: string): void => {
      if (shuttingDown) return;
      shuttingDown = true;
      log.info(`Received ${signal}, shutting down…`);
      void (async () => {
        await stopQueue().catch(() => undefined);
        await adminServer.close().catch(() => undefined);
        // Before the handle is closed, not after: `coreDeleteAvailable()` otherwise
        // keeps answering yes against a chat client that has been shut down, and the
        // erasure path would report a capability it no longer has (CCB-S3-023).
        setCoreDeletePort(null);
        setEnforcementHandle(null);
        setRuntimeAdminHandle(null);
        // Same reasoning as the delete port: the bridge must not go on
        // reporting a transport it no longer has.
        setBridgeSendPort(null);
        setBridgeJobDeps(null);
        setMusicSendPort(null);
        setMusicJobDeps(null);
        if (botHandle) await botHandle.close().catch(() => undefined);
        await closePool().catch(() => undefined);
        resolve();
      })();
    };
    process.on('SIGINT', () => shutdown('SIGINT'));
    process.on('SIGTERM', () => shutdown('SIGTERM'));
  });
}

async function main(): Promise<void> {
  const cfg = loadConfig();
  const localAi = loadLocalAiConfig();
  setLogLevel(cfg.logLevel);
  log.info('CIND3R3LLA booting…');

  if (process.argv.includes('--check')) {
    runConfigCheck(cfg, localAi);
    return;
  }

  await runApp(cfg, localAi);
}

main()
  .then(() => process.exit(0))
  .catch((err: unknown) => {
    const message = err instanceof Error ? err.message : String(err);
    log.error(`Fatal: ${message}`);
    process.exit(1);
  });
