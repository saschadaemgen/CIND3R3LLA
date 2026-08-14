/**
 * The structured origin of a bridged post (CCB-S5-032, D-187).
 *
 * ── DATA, NOT A SENTENCE ─────────────────────────────────────────────────────
 *
 * The rendered attribution under an announcement is for the member reading the
 * group. This record is for CONSUMERS: the console's forward log filters by it
 * today, and the activity stream on the website - a separate repository with its
 * own chat - will read it later. A rendered line cannot be filtered, so the
 * origin is stored as a structured field on the forwarded record, and the
 * console filtering by it is the proof the shape is fit before the site depends
 * on it.
 *
 * ── THE SHAPE, AND WHAT WAS GUESSED ──────────────────────────────────────────
 *
 * The briefing says to coordinate the shape with the site rather than invent
 * one. There is no channel to the site's chat from here, so the shape below is
 * the MINIMAL one this side can prove it needs, every field is something the
 * console's own filter or rendering consumes, and the guesses are flagged in the
 * decision entry for the operator to settle in the other chat before either
 * side commits. Versioned (`v: 1`) so the settlement can move it without
 * archaeology.
 *
 * ── STABLE ACROSS A RENAME ───────────────────────────────────────────────────
 *
 * `channelKey` is the identity a reader groups and filters by, and it must
 * survive the channel being renamed. The channel's LINK is the only identity
 * that is stable and portable: the core's numeric group id is stable but local
 * to one profile's database (two bots subscribed to one channel hold two
 * different ids), and the display name is exactly the thing a rename changes.
 * So the key is derived from the link where one is known, and falls back to a
 * profile-local key that is honest about being one. `channelName` rides along
 * as the CURRENT display name at forward time, for rendering; a reader who
 * groups by name instead of key gets exactly the rename instability the key
 * exists to avoid, which is why both are present.
 */

import { createHash } from 'node:crypto';

/** The structured origin stored on every forwarded record. */
export interface BridgeOrigin {
  /** Shape version, for the day the site settlement moves a field. */
  v: 1;
  source: 'simplex-channel';
  /** Stable identity of the channel; survives a rename. Group and filter by this. */
  channelKey: string;
  /** The channel's display name at the moment of forwarding. Render this. */
  channelName: string;
  /** When the post was made in the channel (ISO 8601). Sort by this. */
  postedAt: string;
  /** The source post's shared message id: the key an edit or deletion finds. */
  sharedMsgId: string;
}

/**
 * The stable key for a channel.
 *
 * `link:<hash>` when the join link is known - two deployments subscribed to the
 * same channel derive the SAME key, which is what makes the field portable to a
 * consumer outside this codebase. The hash is of the full link, truncated for
 * legibility; 16 hex characters is 64 bits, far past collision concern for a
 * population of channels one operator bridges.
 *
 * `local:<bot>:<group>` when no link survived (the core does not always retain
 * `viaGroupLinkUri`). Honest about its scope: it is stable for THIS deployment
 * and meaningless outside it, and the prefix makes the difference readable
 * rather than leaving a consumer to guess which kind of key it holds.
 */
export function channelKeyFor(
  link: string | null,
  botProfileId: number,
  sourceGroupId: number,
): string {
  if (link !== null && link.trim() !== '') {
    return `link:${createHash('sha256').update(link.trim()).digest('hex').slice(0, 16)}`;
  }
  return `local:${String(botProfileId)}:${String(sourceGroupId)}`;
}

/**
 * Assembles the origin from a key the caller already holds.
 *
 * It used to derive the key itself. It takes one now because the SAME key has to reach two
 * places for one announcement (CCB-S5-043, D-215): the forward log's structured origin, and
 * the archived message's own `bridge_channel_key`, which is what publication and the
 * website's channel filter are derived from. Two calls to `channelKeyFor` would agree today
 * and would be two places to change; one value computed once in the tick cannot disagree
 * with itself.
 */
export function buildOrigin(input: {
  channelKey: string;
  channelName: string;
  postedAt: Date;
  sharedMsgId: string;
}): BridgeOrigin {
  return {
    v: 1,
    source: 'simplex-channel',
    channelKey: input.channelKey,
    channelName: input.channelName,
    postedAt: input.postedAt.toISOString(),
    sharedMsgId: input.sharedMsgId,
  };
}
