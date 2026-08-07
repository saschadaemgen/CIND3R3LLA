/**
 * The live moderation rules the engine reads (CCB-S4-032, D-136).
 *
 * Same shape and the same reasoning as `BotPersonalityService` (D-133): the ladders are
 * consulted inside the reply path, which is synchronous about its settings, and they
 * change when an operator edits a form rather than per message. So they are loaded at
 * boot and held, and the console invalidates on every save so a tuned threshold takes
 * effect on the next message rather than the next restart. Safe because this is one
 * process (A2).
 *
 * A failed refresh keeps the last known rules and logs. It does NOT fall back to the
 * shipped ladder: quietly substituting defaults would change an operator's thresholds
 * without telling them, which on a moderation surface is worse than a stale read.
 */

import type { Queryable } from '../db/pool.js';
import { log } from '../log.js';
import type { ModerationRules } from './rules.js';
import { botModerationRules, runtimeModerationRules } from './store.js';

/**
 * ── PER BOT SINCE CCB-S5-001 ─────────────────────────────────────────────────
 *
 * The ladders were always per bot in the schema - 029 says so in as many words, "two bots
 * in one deployment must be able to moderate differently" - and the service cached one
 * set anyway, because one bot ran. Every enabled bot runs now, so a bot with a lenient
 * ladder would have been moderating on the primary's strict one, sanctioning members for
 * what its own configuration tolerated, while the Rules page showed the settings it was
 * not using.
 */
export class ModerationService {
  private value: ModerationRules | null = null;
  private readonly perBot = new Map<number, ModerationRules | null>();
  private readonly inFlight = new Map<number, Promise<void>>();
  private loaded = false;
  private refreshing: Promise<void> | null = null;

  constructor(private readonly db: Queryable) {}

  static async load(db: Queryable): Promise<ModerationService> {
    const service = new ModerationService(db);
    await service.refresh();
    return service;
  }

  /**
   * The rules of the runtime bot, or null when no bot is selected for the runtime.
   *
   * Null means the ladders do not run at all. That is deliberate: with no bot profile
   * there is no operator-chosen policy, and inventing one to moderate a real group with
   * would be the worst possible default.
   */
  get(botProfileId?: number): ModerationRules | null {
    if (!this.loaded) void this.kickRefresh();
    if (botProfileId === undefined) return this.value;
    const cached = this.perBot.get(botProfileId);
    if (cached !== undefined) return cached;
    void this.kickRefreshFor(botProfileId);
    // NOT the primary's ladders as a stand-in. Moderating one bot's members by another
    // bot's thresholds is the failure this became per-bot to prevent, and unlike a wrong
    // voice it is one a member pays for. Null means the ladders do not run, which is the
    // safe direction on a surface that can mute somebody.
    return null;
  }

  invalidate(): void {
    this.loaded = false;
    this.perBot.clear();
    void this.kickRefresh();
  }

  /** Load one bot's ladders. */
  async refreshFor(botProfileId: number): Promise<void> {
    try {
      this.perBot.set(botProfileId, await botModerationRules(this.db, botProfileId));
    } catch (error) {
      log.warn(
        `Moderation: reading bot ${botProfileId}'s ladders failed (${
          error instanceof Error ? error.message : String(error)
        }).`,
      );
    }
  }

  private kickRefreshFor(botProfileId: number): Promise<void> {
    let p = this.inFlight.get(botProfileId);
    if (p === undefined) {
      p = this.refreshFor(botProfileId).finally(() => this.inFlight.delete(botProfileId));
      this.inFlight.set(botProfileId, p);
    }
    return p;
  }

  async refresh(): Promise<void> {
    try {
      this.value = await runtimeModerationRules(this.db);
      this.loaded = true;
    } catch (error) {
      log.warn(
        `Moderation: reading the runtime bot rules failed, keeping the last known ` +
          `ladders (${error instanceof Error ? error.message : String(error)}).`,
      );
    }
  }

  private kickRefresh(): Promise<void> {
    this.refreshing ??= this.refresh().finally(() => {
      this.refreshing = null;
    });
    return this.refreshing;
  }
}

/**
 * The process-wide instance, registered by the boot path, absent in the admin preview.
 * Same pattern and the same reason as the personality service.
 */
let active: ModerationService | null = null;

export function setModerationService(service: ModerationService | null): void {
  active = service;
}

export function invalidateModerationRules(): void {
  active?.invalidate();
}

/**
 * The getter the engine is wired with. Each engine passes its own bot's id
 * (CCB-S5-001); the no-argument form is the primary's, for the console's default views.
 */
export function currentModerationRules(botProfileId?: number): ModerationRules | null {
  return active?.get(botProfileId) ?? null;
}

/** Warm one bot's ladders, so its first message does not race the read. */
export async function warmModerationRules(botProfileId: number): Promise<void> {
  await active?.refreshFor(botProfileId);
}
