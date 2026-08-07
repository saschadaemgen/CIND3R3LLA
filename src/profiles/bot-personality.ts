/**
 * The live personality the conversation prompt is built from (CCB-S4-029, D-133).
 *
 * ── WHY THIS IS CACHED AND NOT READ PER REPLY ────────────────────────────────
 *
 * The prompt builder is synchronous and sits inside the reply path. Reaching the
 * database from there would put a query between a member's message and her answer for
 * a value that changes when an operator moves a slider, which is to say almost never.
 * So the value is loaded at boot and held.
 *
 * ── WHY THE CACHE IS INVALIDATED AND NOT EXPIRED ─────────────────────────────
 *
 * A TTL would mean an operator moves a slider, talks to her, hears the old voice, and
 * cannot tell whether the slider is broken or merely slow. That is precisely the
 * failure this briefing exists to avoid, so the console calls {@link invalidate} on
 * every save and the next reply reads the new value. This is safe because Cinderella is
 * ONE PROCESS (Addendum 1 A2): the admin console that writes the row and the engine
 * that reads it are the same program, so there is no second process holding a copy.
 *
 * The refresh is deliberately lazy rather than eager: invalidation happens on the
 * console's request path, and making an operator's save wait on a read it does not use
 * would be the wrong place to spend the time.
 *
 * ── WHY A FAILED READ FALLS BACK AND SAYS SO ─────────────────────────────────
 *
 * A database that cannot answer must not stop her from talking, so a failed refresh
 * keeps the last known value and logs. It does NOT silently substitute defaults: the
 * previously loaded personality is the closest true thing available, and the log names
 * the operation so a persistent fault is visible rather than showing up as a bot that
 * quietly reverted to the middle of every dial (CCB-S3-023).
 */

import type { Queryable } from '../db/pool.js';
import { log } from '../log.js';
import type { BotPersonality } from '../interaction/personality.js';
import { botPersonalityById, runtimeBotPersonality } from './bot-onboarding.js';

/**
 * ── PER BOT SINCE CCB-S5-001 ─────────────────────────────────────────────────
 *
 * This used to cache ONE personality, the `selected_for_runtime` row's, because one bot
 * ran. Every enabled bot runs now and each has its own character, so the cache is keyed
 * by bot: a message is answered in the voice of the bot that RECEIVED it, and reading
 * the primary's dials for all of them would have given every bot the primary's voice
 * while every setting page still showed the right one.
 *
 * The invalidation contract is unchanged and still whole-cache: an operator saving one
 * bot's dials drops all of them, which costs one query per bot on the next reply and
 * removes any chance of a per-key invalidation missing the key that mattered.
 */
export class BotPersonalityService {
  private readonly values = new Map<number, BotPersonality | null>();
  /** The primary's, for the paths that still ask without naming a bot. */
  private primary: BotPersonality | null = null;
  private loaded = false;
  private refreshing: Promise<void> | null = null;

  constructor(private readonly db: Queryable) {}

  /** Read the primary bot's personality once, at boot. */
  static async load(db: Queryable): Promise<BotPersonalityService> {
    const service = new BotPersonalityService(db);
    await service.refresh();
    return service;
  }

  /**
   * The current personality, or null when no bot profile is selected for the runtime.
   *
   * Synchronous by design: this is called from the reply path. Before the first load
   * completes it returns null, which the prompt builder reads as "not configured" and
   * answers with the ceiling and the original voice, never with an error.
   *
   * With no bot named this answers for the PRIMARY, which is what the console's default
   * views want. The reply path always names one.
   */
  get(botProfileId?: number): BotPersonality | null {
    if (!this.loaded) void this.kickRefresh();
    if (botProfileId === undefined) return this.primary;
    const cached = this.values.get(botProfileId);
    if (cached !== undefined) return cached;
    void this.kickRefreshFor(botProfileId);
    // Not the primary's as a stand-in: handing one bot another bot's character is the
    // exact failure this became per-bot to prevent, and it would be invisible. Null is
    // read as "not configured", which produces the original voice and the ceiling.
    return null;
  }

  /** Drop every cached value and read again. Called by the console after every save. */
  invalidate(): void {
    this.loaded = false;
    this.values.clear();
    void this.kickRefresh();
  }

  async refresh(): Promise<void> {
    try {
      this.primary = await runtimeBotPersonality(this.db);
      this.loaded = true;
    } catch (error) {
      log.warn(
        `Personality: reading the runtime bot personality failed, keeping the last known ` +
          `value (${error instanceof Error ? error.message : String(error)}).`,
      );
    }
  }

  /** Load one bot's personality into the cache. */
  async refreshFor(botProfileId: number): Promise<void> {
    try {
      this.values.set(botProfileId, await botPersonalityById(this.db, botProfileId));
    } catch (error) {
      log.warn(
        `Personality: reading bot ${botProfileId}'s personality failed (${
          error instanceof Error ? error.message : String(error)
        }).`,
      );
    }
  }

  /** One refresh in flight at a time, so a burst of replies cannot stack reads. */
  private kickRefresh(): Promise<void> {
    this.refreshing ??= this.refresh().finally(() => {
      this.refreshing = null;
    });
    return this.refreshing;
  }

  private readonly inFlight = new Map<number, Promise<void>>();

  private kickRefreshFor(botProfileId: number): Promise<void> {
    let p = this.inFlight.get(botProfileId);
    if (p === undefined) {
      p = this.refreshFor(botProfileId).finally(() => this.inFlight.delete(botProfileId));
      this.inFlight.set(botProfileId, p);
    }
    return p;
  }
}

/**
 * The process-wide instance, registered by the boot path.
 *
 * Registered rather than passed, for the same reason `setRuntimeAdminHandle` is: the
 * admin console is started BEFORE the bot so it can report a bot that failed to start,
 * so its views are built at a moment when there is nothing to hand them. Absent in the
 * admin-preview harness, where nothing hosts a bot, hence the null tolerance.
 */
let active: BotPersonalityService | null = null;

export function setBotPersonalityService(service: BotPersonalityService | null): void {
  active = service;
}

/** Tell the reply path that a saved personality changed. A no-op with no bot running. */
export function invalidateBotPersonality(): void {
  active?.invalidate();
}

/**
 * The getter the interaction engine is wired with.
 *
 * Each engine belongs to one bot and passes its own id (CCB-S5-001). The no-argument
 * form answers for the primary and is what the console's default views use; it must not
 * be used on the reply path, because there it would give every bot the primary's voice.
 */
export function currentBotPersonality(botProfileId?: number): BotPersonality | null {
  return active?.get(botProfileId) ?? null;
}

/** Warm one bot's personality into the cache, so its first reply does not race a read. */
export async function warmBotPersonality(botProfileId: number): Promise<void> {
  await active?.refreshFor(botProfileId);
}
