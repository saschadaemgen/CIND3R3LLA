/**
 * The music plugin's deployment-wide settings (CCB-S5-044, D-216).
 *
 * The per-bot halves live elsewhere by D-175's three questions: enablement is a
 * plugin override per bot, and the playlists a bot HOLDS are assignment rows
 * (absence there means no playlist, where absence in an overrides table means
 * inherit - the knowledge-base grant shape). What is left for the deployment
 * are the safety bounds:
 *
 *   * the two unbidden budgets, per room per day, with a minimum gap. SEPARATE
 *     for music and spots, the operator's decision over the shared-budget
 *     proposal: a requested track and an unbidden advert are different things
 *     to a member, and one budget means a busy music day silently buys
 *     advertising quiet or the reverse.
 *   * the member-upload bounds (CCB-S5-044 Part 4b): the size ceiling and the
 *     ALLOW-LIST of types she will re-send. An allow-list per D-201: a member
 *     handing her an arbitrary file to re-send is a small abuse surface, and
 *     stating what is permitted refuses the unknown instead of admitting it.
 *
 * The defaults are the operator's numbers, halved from the proposal on his own
 * reasoning: nobody raises a limit they never noticed, and an advert every 45
 * minutes in a quiet room reads as spam. He raises them on the page.
 */

export interface MusicSettings {
  /** Unbidden MUSIC sends allowed per room per day (cadence plays of non-spot kinds). */
  musicDailyCap: number;
  /** Minimum minutes between unbidden music sends in one room. */
  musicGapMinutes: number;
  /** Unbidden SPOT sends allowed per room per day. */
  spotDailyCap: number;
  /** Minimum minutes between unbidden spots in one room. */
  spotGapMinutes: number;
  /** The largest member file she will fetch and play back, in bytes. */
  memberUploadMaxBytes: number;
}

export const MUSIC_DEFAULTS: Readonly<MusicSettings> = Object.freeze({
  musicDailyCap: 3,
  musicGapMinutes: 60,
  spotDailyCap: 3,
  spotGapMinutes: 60,
  // The bridge's re-host bound, for the same reason at the same magnitude: it
  // covers any real track and caps what a member can make her carry.
  memberUploadMaxBytes: 25 * 1024 * 1024,
});

/**
 * What she accepts from a member to play back (Part 4b). AUDIO ONLY, by
 * declared type AND by extension, both sides of the same allow-list: the
 * refusal names the rule so a member knows it is a policy, not a fault.
 * Video is deliberately absent here: a member video is not "make this
 * playable", it is re-hosting arbitrary footage, and that is not this feature.
 */
export const MEMBER_UPLOAD_MIMES: readonly string[] = Object.freeze([
  'audio/mpeg',
  'audio/mp4',
  'audio/m4a',
  'audio/x-m4a',
  'audio/ogg',
  'audio/flac',
  'audio/x-flac',
  'audio/wav',
  'audio/x-wav',
]);

export const MEMBER_UPLOAD_EXTENSIONS: readonly string[] = Object.freeze([
  '.mp3', '.m4a', '.aac', '.ogg', '.opus', '.flac', '.wav',
]);

function clampInt(value: unknown, min: number, max: number, fallback: number): number {
  const parsed =
    typeof value === 'number'
      ? value
      : typeof value === 'string'
        ? Number.parseInt(value, 10)
        : Number.NaN;
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, Math.trunc(parsed)));
}

export function normalizeMusicSettings(raw: unknown): MusicSettings {
  const o =
    raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  return {
    musicDailyCap: clampInt(o['musicDailyCap'], 1, 48, MUSIC_DEFAULTS.musicDailyCap),
    musicGapMinutes: clampInt(o['musicGapMinutes'], 0, 1440, MUSIC_DEFAULTS.musicGapMinutes),
    spotDailyCap: clampInt(o['spotDailyCap'], 1, 48, MUSIC_DEFAULTS.spotDailyCap),
    spotGapMinutes: clampInt(o['spotGapMinutes'], 0, 1440, MUSIC_DEFAULTS.spotGapMinutes),
    memberUploadMaxBytes: clampInt(
      o['memberUploadMaxBytes'],
      64 * 1024,
      1024 * 1024 * 1024,
      MUSIC_DEFAULTS.memberUploadMaxBytes,
    ),
  };
}
