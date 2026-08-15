/**
 * The music plugin's in-process diagnostics (CCB-S5-044), the bridge-log shape:
 * the last tick, the last error, and the skip counters - because a cadence
 * bounded by budgets is a cadence that regularly does nothing, and "did nothing,
 * for this reason" must be readable on the console rather than inferred from
 * absence (CCB-S3-023: distinguish a choice from a fault, and neither from
 * silence).
 */

import type { CadenceSkip } from './cadence.js';

interface MusicDiagnostics {
  lastTickAt: number | null;
  lastError: { at: number; where: string; message: string } | null;
  /** Per-reason counts since process start. A skip is normal; the counts make it legible. */
  skips: Record<CadenceSkip, number>;
  announcementsSent: number;
}

const diag: MusicDiagnostics = {
  lastTickAt: null,
  lastError: null,
  skips: {
    'not-due': 0,
    'budget-spent': 0,
    'gap-too-recent': 0,
    'send-in-flight': 0,
    'playlist-empty': 0,
  },
  announcementsSent: 0,
};

export function noteMusicTick(at: number): void {
  diag.lastTickAt = at;
}

export function noteMusicSkip(reason: CadenceSkip): void {
  diag.skips[reason] += 1;
}

export function noteMusicSend(): void {
  diag.announcementsSent += 1;
}

export function noteMusicError(where: string, error: unknown): void {
  diag.lastError = {
    at: Date.now(),
    where,
    message: error instanceof Error ? error.message : String(error),
  };
}

export function musicDiagnostics(): Readonly<MusicDiagnostics> {
  return diag;
}

/** Harness reset, so counts assert from zero. */
export function resetMusicDiagnostics(): void {
  diag.lastTickAt = null;
  diag.lastError = null;
  for (const k of Object.keys(diag.skips) as CadenceSkip[]) diag.skips[k] = 0;
  diag.announcementsSent = 0;
}
