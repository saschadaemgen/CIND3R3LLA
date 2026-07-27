/**
 * Live-editable settings service (A3 "Configuration").
 *
 * Settings live in the `settings` table and are cached in-process. Writing a
 * setting persists it AND applies its side effect immediately (e.g. log level),
 * so edits take effect without a restart. Boot/secret settings (DB connection,
 * admin credentials, session secret, SimpleX paths) are environment-only and
 * never pass through here.
 */

import { getAllSettings, setSetting } from '../db/settings.js';
import type { Queryable } from '../db/pool.js';
import { log, parseLogLevel, setLogLevel, type LogLevel } from '../log.js';

export interface LiveSettings {
  /** Log verbosity — applied immediately. */
  logLevel: LogLevel;
  /** Per-file receive timeout in minutes — applied to subsequent receipts. */
  fileTimeoutMinutes: number;
  /** Dashboard: a pending file older than this (hours) counts as "at risk". */
  fileAlertHours: number;
  /**
   * Days an illegal-content report holds an item against destruction
   * (CCB-S3-013). Time-boxed so an unreviewed report cannot become a permanent
   * block by neglect; when it lapses, any deferred deletion runs.
   */
  holdDays: number;
  /**
   * How many of a reporting source's illegal reports the operator may dismiss
   * before that source stops creating holds (CCB-S3-013). 0 disables the
   * suppression entirely, which fails toward accepting every report.
   */
  holdAbuseThreshold: number;
}

export const SETTING_DEFS: {
  key: keyof LiveSettings;
  label: string;
  help: string;
}[] = [
  {
    key: 'logLevel',
    label: 'Log level',
    help: 'Verbosity of the bot + admin logs (applies immediately).',
  },
  {
    key: 'fileTimeoutMinutes',
    label: 'File receive timeout (minutes)',
    help: 'How long to wait for an XFTP file download before treating it as failed.',
  },
  {
    key: 'fileAlertHours',
    label: 'File alert threshold (hours)',
    help: 'Dashboard flags media still missing after this long (XFTP relays expire files after ~48h).',
  },
  {
    key: 'holdDays',
    label: 'Evidence hold period (days)',
    help: 'How long an illegal-content report holds an item against destruction. When it expires, any deletion the member asked for runs automatically. Escalations and hash-match quarantines never expire.',
  },
  {
    key: 'holdAbuseThreshold',
    label: 'Hold abuse threshold (dismissed reports)',
    help: 'After this many of a reporting source’s illegal reports are dismissed, its reports stop creating holds. Set to 0 to accept every report.',
  },
];

function defaults(envLogLevel: LogLevel): LiveSettings {
  return {
    logLevel: envLogLevel,
    fileTimeoutMinutes: 5,
    fileAlertHours: 24,
    // The briefing's default. Long enough for a real review, short enough that a
    // forgotten report does not block a member's erasure indefinitely.
    holdDays: 30,
    holdAbuseThreshold: 3,
  };
}

function clampInt(v: unknown, min: number, max: number, fallback: number): number {
  const n = typeof v === 'number' ? v : Number.parseInt(String(v), 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.trunc(n)));
}

export class SettingsService {
  private values: LiveSettings;

  private constructor(
    private readonly db: Queryable,
    envLogLevel: LogLevel,
  ) {
    this.values = defaults(envLogLevel);
  }

  /** Loads persisted settings and applies side effects. */
  static async load(db: Queryable, envLogLevel: LogLevel): Promise<SettingsService> {
    const svc = new SettingsService(db, envLogLevel);
    const stored = await getAllSettings(db);
    const storedLogLevel = stored.get('logLevel');
    svc.values = {
      logLevel: parseLogLevel(
        typeof storedLogLevel === 'string' ? storedLogLevel : undefined,
        svc.values.logLevel,
      ),
      fileTimeoutMinutes: clampInt(
        stored.get('fileTimeoutMinutes'),
        1,
        720,
        svc.values.fileTimeoutMinutes,
      ),
      fileAlertHours: clampInt(stored.get('fileAlertHours'), 1, 168, svc.values.fileAlertHours),
      // Floor of 1 day: a hold that expires the moment it is placed would defeat
      // the review it exists for. Ceiling of ~2 years keeps "time-boxed" honest.
      holdDays: clampInt(stored.get('holdDays'), 1, 730, svc.values.holdDays),
      // 0 is meaningful here (accept every report), so the floor is 0, not 1.
      holdAbuseThreshold: clampInt(
        stored.get('holdAbuseThreshold'),
        0,
        1000,
        svc.values.holdAbuseThreshold,
      ),
    };
    svc.applySideEffects();
    return svc;
  }

  get(): LiveSettings {
    return { ...this.values };
  }

  get fileTimeoutMs(): number {
    return this.values.fileTimeoutMinutes * 60 * 1000;
  }

  /**
   * Validates, persists, applies, and returns the new value of one setting.
   * Throws on unknown keys or invalid values.
   */
  async set(key: string, rawValue: string): Promise<LiveSettings[keyof LiveSettings]> {
    switch (key) {
      case 'logLevel': {
        const v = rawValue.trim().toLowerCase();
        if (v !== 'error' && v !== 'warn' && v !== 'info' && v !== 'debug') {
          throw new Error('Log level must be one of: error, warn, info, debug.');
        }
        this.values.logLevel = v;
        await setSetting(this.db, 'logLevel', v);
        this.applySideEffects();
        return v;
      }
      case 'fileTimeoutMinutes': {
        const n = clampInt(rawValue, 1, 720, NaN);
        if (!Number.isFinite(n))
          throw new Error('File timeout must be a number of minutes (1–720).');
        this.values.fileTimeoutMinutes = n;
        await setSetting(this.db, 'fileTimeoutMinutes', n);
        return n;
      }
      case 'fileAlertHours': {
        const n = clampInt(rawValue, 1, 168, NaN);
        if (!Number.isFinite(n)) throw new Error('File alert threshold must be hours (1–168).');
        this.values.fileAlertHours = n;
        await setSetting(this.db, 'fileAlertHours', n);
        return n;
      }
      case 'holdDays': {
        const n = clampInt(rawValue, 1, 730, NaN);
        if (!Number.isFinite(n)) throw new Error('Evidence hold period must be days (1–730).');
        this.values.holdDays = n;
        await setSetting(this.db, 'holdDays', n);
        return n;
      }
      case 'holdAbuseThreshold': {
        const n = clampInt(rawValue, 0, 1000, NaN);
        if (!Number.isFinite(n))
          throw new Error('Hold abuse threshold must be a number of dismissed reports (0–1000).');
        this.values.holdAbuseThreshold = n;
        await setSetting(this.db, 'holdAbuseThreshold', n);
        return n;
      }
      default:
        throw new Error(`Unknown setting: ${key}`);
    }
  }

  private applySideEffects(): void {
    setLogLevel(this.values.logLevel);
    log.debug(`Live settings applied: ${JSON.stringify(this.values)}`);
  }
}
