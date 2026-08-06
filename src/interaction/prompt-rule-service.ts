/**
 * The live rule registry the prompt is assembled from (CCB-S4-039, D-144).
 *
 * Shaped exactly like {@link BotPersonalityService} in `src/profiles/bot-personality.ts`,
 * and for the same three reasons, which are worth restating because they are the reasons
 * this is a cache and not a query.
 *
 * ── WHY IT IS CACHED ─────────────────────────────────────────────────────────
 *
 * The prompt builder is synchronous and sits inside the reply path. Reaching the database
 * from there would put a query between a member's message and her answer, for a set of rows
 * that changes when an operator edits a rule, which is to say almost never.
 *
 * ── WHY IT IS INVALIDATED AND NOT EXPIRED ────────────────────────────────────
 *
 * A TTL would mean an operator changes a rule, talks to her, hears the old one, and cannot
 * tell whether the edit is broken or merely slow. The console that edits rules is the next
 * briefing, and {@link invalidatePromptRules} is the hook it will call. Safe because
 * Cinderella is ONE PROCESS: the console that writes the row and the engine that reads it
 * are the same program.
 *
 * ── WHY A FAILED READ DOES NOT SUBSTITUTE ANYTHING ───────────────────────────
 *
 * It keeps the last known good set, logs, and pushes the fault to the admin dashboard. What
 * it does NOT do is fall back to a built-in copy of the rules, because there isn't one and
 * there must not be one (see `prompt-rules.ts`). With nothing ever loaded, {@link current}
 * returns an empty set, the assembler throws, and every AI-worded reply degrades to the
 * deterministic draft somebody wrote. That is a loud, visible, safe failure: she stops
 * wording replies rather than wording them with no rules.
 */

import type { Queryable } from '../db/pool.js';
import { listPromptRules } from '../db/prompt-rules.js';
import { log } from '../log.js';
import { status } from '../web/status.js';
import type { PromptRule, PromptRuleSet } from './prompt-rules.js';

export class PromptRuleService {
  private value: PromptRule[] = [];
  private loaded = false;
  private refreshing: Promise<void> | null = null;
  /** So a persistent fault reports once per transition rather than once per reply. */
  private reportedFailure = false;

  constructor(private readonly db: Queryable) {}

  /** Read the registry once, at boot. */
  static async load(db: Queryable): Promise<PromptRuleService> {
    const service = new PromptRuleService(db);
    await service.refresh();
    return service;
  }

  /**
   * The current rules, or an empty set before the first load completes.
   *
   * Synchronous by design: this is called from the reply path. An empty set is not treated
   * as "no rules apply" anywhere; the assembler refuses it.
   */
  get(): PromptRuleSet {
    if (!this.loaded) void this.kickRefresh();
    return this.value;
  }

  /** Drop the cached rules and read them again. */
  invalidate(): void {
    this.loaded = false;
    void this.kickRefresh();
  }

  async refresh(): Promise<void> {
    try {
      this.value = await listPromptRules(this.db);
      this.loaded = true;
      this.reportedFailure = false;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      log.warn(
        `Prompt rules: reading the rule registry failed, keeping the last known set of ` +
          `${this.value.length} rule(s) (${message}).`,
      );
      if (!this.reportedFailure) {
        this.reportedFailure = true;
        status.error(
          this.value.length === 0
            ? `The prompt rule registry could not be read (${message}). Until it can, every ` +
                `AI-worded reply falls back to its deterministic text.`
            : `The prompt rule registry could not be re-read (${message}). She is still ` +
                `answering from the ${this.value.length} rule(s) loaded before the fault.`,
        );
      }
    }
  }

  /** One refresh in flight at a time, so a burst of replies cannot stack reads. */
  private kickRefresh(): Promise<void> {
    this.refreshing ??= this.refresh().finally(() => {
      this.refreshing = null;
    });
    return this.refreshing;
  }
}

/**
 * The process-wide instance, registered by the boot path.
 *
 * Registered rather than passed, for the same reason the personality service is: the admin
 * console is started BEFORE the bot so it can report a bot that failed to start, so its
 * views are built at a moment when there is nothing to hand them.
 */
let active: PromptRuleService | null = null;

export function setPromptRuleService(service: PromptRuleService | null): void {
  active = service;
}

/** Tell the reply path that a rule changed. A no-op with no service registered. */
export function invalidatePromptRules(): void {
  active?.invalidate();
}

/** The getter the interaction engine and the console preview are wired with. */
export function currentPromptRules(): PromptRuleSet {
  return active?.get() ?? [];
}
