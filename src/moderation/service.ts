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
import { runtimeModerationRules } from './store.js';

export class ModerationService {
  private value: ModerationRules | null = null;
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
  get(): ModerationRules | null {
    if (!this.loaded) void this.kickRefresh();
    return this.value;
  }

  invalidate(): void {
    this.loaded = false;
    void this.kickRefresh();
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

export function currentModerationRules(): ModerationRules | null {
  return active?.get() ?? null;
}
