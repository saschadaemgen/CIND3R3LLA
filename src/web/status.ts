/**
 * Runtime status shared between the capture worker and the admin dashboard.
 * In-memory (per-process) — DB-derived numbers are queried live by the
 * dashboard; this covers what only the running process knows.
 */

export interface RecentError {
  at: string;
  message: string;
}

export interface FileFailure {
  at: string;
  itemId: number;
  groupId: number;
  fileName: string;
  reason: string;
}

/**
 * One bot's rooms, as an operator reads the word (CCB-S5-034, D-192).
 *
 * ── WHY THIS IS NOT A `string[]` ANY MORE ────────────────────────────────────
 *
 * It was `string[]`, every bot's groups flattened into one line with nobody named, produced
 * ONCE at boot. Two things were wrong and both cost real time. `Cyb3rD3sk` appeared twice
 * with no way to tell whose was whose, and a group joined at runtime could not appear until
 * a restart. Worse, `apiListGroups` returns memberships that have ENDED, and every one was
 * rendered exactly like a current one - so the operator removed the bot from a group, saw it
 * still listed, and spent a week chasing groups he did not have.
 *
 * `current` is what "I am in this group" means. `endedCount` is stated rather than hidden,
 * because a record that still exists is why the core's own list is longer than the truth,
 * and silence there is what made the surface lie.
 */
export interface BotGroups {
  bot: string;
  /** Rooms this bot is CURRENTLY in. */
  current: string[];
  /** Records of memberships that are over. Shown as a count, clearable on the Capture page. */
  endedCount: number;
}

export interface RuntimeStatus {
  startedAt: string;
  botState: 'starting' | 'running' | 'failed' | 'disabled';
  botError: string | null;
  groups: BotGroups[];
  lastCapturedAt: string | null;
  /** In-flight + recently failed file receipts (XFTP ~48h expiry — A3). */
  fileFailures: FileFailure[];
  recentErrors: RecentError[];
}

const MAX_RECENT = 50;

class StatusTracker implements RuntimeStatus {
  startedAt = new Date().toISOString();
  botState: RuntimeStatus['botState'] = 'starting';
  botError: string | null = null;
  groups: BotGroups[] = [];
  lastCapturedAt: string | null = null;
  fileFailures: FileFailure[] = [];
  recentErrors: RecentError[] = [];

  botRunning(groups: BotGroups[]): void {
    this.botState = 'running';
    this.botError = null;
    this.groups = groups;
  }

  /**
   * Re-state the rooms without touching the bot state.
   *
   * Called on every room refresh, which is boot AND every membership change - so a group
   * joined or left at runtime shows immediately. `botRunning` set this once at boot, which
   * is why a join could not appear until a restart.
   */
  groupsChanged(groups: BotGroups[]): void {
    this.groups = groups;
  }

  botFailed(message: string): void {
    this.botState = 'failed';
    this.botError = message;
  }

  captured(): void {
    this.lastCapturedAt = new Date().toISOString();
  }

  fileFailed(failure: Omit<FileFailure, 'at'>): void {
    this.fileFailures.unshift({ at: new Date().toISOString(), ...failure });
    if (this.fileFailures.length > MAX_RECENT) this.fileFailures.length = MAX_RECENT;
  }

  error(message: string): void {
    this.recentErrors.unshift({ at: new Date().toISOString(), message });
    if (this.recentErrors.length > MAX_RECENT) this.recentErrors.length = MAX_RECENT;
  }
}

export const status = new StatusTracker();
