/**
 * The bridge's deployment-wide settings (CCB-S5-032, D-187).
 *
 * ONE SETTING, deliberately. Everything else the briefing calls a setting is
 * PER MAPPING and lives on the mapping row (interval, message count, how far
 * back, how often to repeat), because a busy group and a quiet one want
 * different rhythms; that is the operator's own design. What is left for the
 * deployment is the safety bound: how large a channel file the bridge will
 * fetch and re-host. Storage is a deployment cost, not a bot choice, which is
 * D-175's line for where a setting lives.
 */

export interface ChannelBridgeSettings {
  /**
   * The largest channel file the bridge fetches and re-hosts, in bytes.
   *
   * Files ride the transfer relays for a limited window (~48h), so the bridge
   * downloads promptly and keeps its own copy, or a repeat would carry a dead
   * link. Every stored byte is duplicated storage the operator pays for, hence
   * a bound; a post whose file exceeds it still forwards as TEXT, with the
   * omission stated on the console rather than swallowed ('too-large' is a
   * media state, never a silent gap).
   */
  maxFileBytes: number;
}

export const CHANNEL_BRIDGE_DEFAULTS: Readonly<ChannelBridgeSettings> = Object.freeze({
  // 25 MiB: covers images, documents and short clips, and caps the cost of a
  // busy channel at a number an operator can reason about. Settable on the
  // bridge page, because the right bound is a property of the host's disk.
  maxFileBytes: 25 * 1024 * 1024,
});

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

export function normalizeChannelBridgeSettings(raw: unknown): ChannelBridgeSettings {
  const o =
    raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  return {
    // 64 KiB floor (below that even a thumbnail fails for no reason an operator
    // could want); 1 GiB ceiling, which is the neighbourhood of what XFTP
    // transfers carry at all.
    maxFileBytes: clampInt(
      o['maxFileBytes'],
      64 * 1024,
      1024 * 1024 * 1024,
      CHANNEL_BRIDGE_DEFAULTS.maxFileBytes,
    ),
  };
}
