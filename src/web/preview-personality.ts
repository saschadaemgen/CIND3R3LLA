/**
 * The personality as the console's PROMPT PREVIEWS receive it.
 *
 * ── THE GAP THIS CLOSES ──────────────────────────────────────────────────────
 *
 * Two surfaces asked `currentBotPersonality()` with NO bot id: the Book's per-rule
 * preview and the Interaction page's context-size card. That form used to answer with
 * the PRIMARY's personality; since CCB-S5-019 removed the primary fallback it answers
 * `null`, always. So both surfaces silently lost the dial block, the base character and
 * the origin, and neither said so: the preview rendered a prompt nobody receives, and
 * the measured headroom under-counted by the whole voice section - the origin alone is
 * roughly 1.7 KB of it. Nothing failed. The call still compiled, the page still rendered,
 * and the number still looked like a measurement.
 *
 * That is D-205 exactly: the thing that changed the world (the primary fallback going
 * away) did not reach the surfaces that describe it.
 *
 * ── WHY THE ROWS AND NOT THE CACHE (CCB-S5-011) ──────────────────────────────
 *
 * `currentBotPersonality(id)` is the reply path's cache, and on a miss it kicks a
 * fire-and-forget refresh and returns `null` in the meantime. That is right for the
 * reply path, where the window is one query and a bot briefly reading the middle of
 * every dial is a smaller wrong than a stalled answer. It is exactly wrong for a page:
 * the FIRST request for any bot after a boot renders before the refresh lands and shows
 * no character at all, the second shows the real one, and nothing distinguishes the two.
 * That is the same first-request staleness the Interaction page documents at length for
 * the settings it renders, and a preview is the one screen an operator trusts before
 * committing a change.
 *
 * So a preview reads the rows. One query on a page an operator loads by hand.
 *
 * ── WHY A FAILED READ IS NOT CAUGHT HERE ─────────────────────────────────────
 *
 * It throws, and the route fails visibly, which is what every other read on these
 * routes already does - the profiles, the overrides, the registry. Catching it and
 * answering `null` would be indistinguishable from "this bot has no personality
 * configured", which is the masking CCB-S3-023 forbids, and it would put the page back
 * in exactly the state this module exists to end: quietly previewing a prompt that is
 * not the one she is sent.
 */

import type { Queryable } from '../db/pool.js';
import type { BotPersonality } from '../interaction/personality.js';
import { botPersonalityById } from '../profiles/bot-onboarding.js';

/**
 * The personality a preview of this bot's prompt must carry.
 *
 * `null` when there is no bot to preview (a deployment with none, or the explicit shared
 * view), which the prompt builder reads as "not configured" and renders as the original
 * voice with the ceiling - the same thing the reply path would produce.
 */
export async function previewPersonality(
  db: Queryable,
  botProfileId: number | null | undefined,
): Promise<BotPersonality | null> {
  if (botProfileId === null || botProfileId === undefined) return null;
  return await botPersonalityById(db, botProfileId);
}
