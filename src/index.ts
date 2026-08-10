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
import { assertDbReachable, closePool, getPool } from './db/pool.js';
import { markInterruptedMediaReceipts, setMemberCategory } from './db/messages.js';
import { SettingsService } from './settings/service.js';
import { SecurityService } from './security/settings.js';
import { ArchiveService } from './archive/settings.js';
import { InteractionService } from './interaction/settings.js';
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
      const groups = await host.runtime.listGroups(bot.simplexUserId);
      if (groups.length === 0) {
        log.warn(
          `Bot "${bot.config.displayName}" is not a member of any group yet. Join one with: ` +
            'npm run connect -- "<simplex group link>"',
        );
        continue;
      }
      const names = groups.map((g) => g.localDisplayName).join(', ');
      log.info(`Bot "${bot.config.displayName}" is in ${groups.length} group(s): ${names}`);
      if (cfg.groupName && !groups.some((g) => g.localDisplayName === cfg.groupName)) {
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
  hooks.onCommand = makeConsentHandler(interaction, (g, m) => noteReply(g, m), {
    send: sendAndArchive,
    askRevokeChoice: (msg) => askRevokeChoice(msg),
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
    // Handed over only while the plugin is enabled; when it is off, PRICE is
    // not in the active intent catalog either, so this is belt and braces.
    ...(plugins.isEnabled(CRYPTO_PRICES_ID) ? { prices } : {}),
    // Web search (CCB-S4-037), on exactly the same terms and for exactly the same
    // reason: off means LOOKUP is absent from the catalog, and this is the second
    // line of defence rather than the first. The service holds no chat client, so
    // the only thing that can come back through here is text.
    ...(plugins.isEnabled(WEB_SEARCH_ID) ? { webSearch: webSearch } : {}),
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
  registerCapture({ chat: bot.events, fileReceiver: bot.fileReceiver }, cfg, hooks, {});

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

    // Deployment-wide services, built once. Every setting is read live, so a chain
    // reorder or a new API key takes effect on the next question without a restart.
    const prices = new CryptoPriceService({
      db: getPool(),
      settings: () => plugins.getCryptoPrices(),
    });
    const webSearch = new WebSearchService({ settings: () => plugins.getWebSearch() });
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
      ]);
      graphs.push(buildBotGraph(bot, { cfg, interaction, plugins, prices, webSearch, host }));

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
        `plugins [${plugins
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

        status.botRunning(
          host.runtime.ownership.all().map((g) => g.localDisplayName),
        );

        for (const bot of host.bots) {
          // ── NOT WRAPPED IN runScheduled (CCB-S5-015, D-167) ─────────────
          //
          // It was, and that was a deadlock. `flushAvatarToGroups` calls `sendToGroup`,
          // which schedules; scheduling from inside a critical section waits for the
          // section that is waiting for it, so every flush blocked for the full 60 s
          // command timeout, logged that its message had not gone out, and then sent it
          // anyway the moment the tail unblocked. Per bot, serialized by this loop.
          //
          // The wrapper was never needed: every SDK call inside already names its bot.
          // `apiListGroups` takes the user id explicitly and `sendGroupText` schedules
          // itself. The scheduler refuses re-entry outright now, so this cannot silently
          // come back.
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
    status.error(
      `${names} are both in the group "${group.members[0]?.localDisplayName ?? 'unknown'}". ` +
        `Every message there will be archived TWICE, once per bot, and consent derived for ` +
        `both copies. Remove one of them from that group. A bot per group is the supported ` +
        `arrangement; two bots in one group is not.`,
    );
  }
  const unknown = host.runtime.ownership.unidentifiedGroups();
  if (unknown.length > 0) {
    // Stated rather than passed over: a null shared key means the core gave nothing to
    // compare, so co-tenancy in those groups can be neither confirmed nor ruled out, and
    // silence would read as "checked, none found".
    log.info('Some groups carry no shared identity, so co-tenancy could not be checked', {
      groups: unknown.map((g) => g.localDisplayName).join(', '),
    });
  }
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
