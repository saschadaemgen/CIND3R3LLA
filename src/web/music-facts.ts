/**
 * The DJ sheet as the console's PROMPT PREVIEWS receive it (D-220).
 *
 * ── THE GAP THIS CLOSES ──────────────────────────────────────────────────────
 *
 * The Assembled Word, the per-rule preview, the Personality page's voice block and
 * the Interaction page's context-size card all render the prompt through the reply
 * path's own functions, and every one of them was building the request WITHOUT the
 * music facts. So an operator inspecting "what she is told" read a prompt with no
 * library in it while the bot's real replies carried one, which is exactly the
 * stale-surface failure D-205 names: the thing that changed the world (the music
 * plugin, D-218) did not reach the surfaces that describe it.
 *
 * ── WHAT IT ANSWERS, AND WHAT ABSENT MEANS ───────────────────────────────────
 *
 * The same contract the engine's `musicPromptFacts` gives the reply path: facts when
 * the music plugin is ON for this bot, `undefined` otherwise, so the has-music rules
 * are either rendered with the numbers she would actually be told or honestly absent.
 * The gate and the derivation are the reply path's own (`isEnabledFor` + the store's
 * `promptFactsForBot`), never a preview-side copy that can drift.
 *
 * A library that cannot be counted is a FAULT and is logged as one, and the preview
 * then says nothing about the library - which is also what the reply path does under
 * the same fault, so even the failure mode previews truthfully.
 */

import type { Queryable } from '../db/pool.js';
import { log } from '../log.js';
import type { MusicPromptFacts } from '../interaction/personality.js';
import type { PluginService } from '../plugins/service.js';
import { MUSIC_ID } from '../plugins/music/plugin.js';
import { promptFactsForBot } from '../plugins/music/store.js';

/** The music facts a preview of this bot's prompt must carry, or undefined. */
export async function previewMusicFacts(
  ctx: { db: Queryable; plugins: PluginService },
  botProfileId: number | null | undefined,
): Promise<MusicPromptFacts | undefined> {
  if (botProfileId === null || botProfileId === undefined) return undefined;
  // THE ROWS, NOT THE CACHE (CCB-S5-011's lesson, caught here by the preview's
  // deliberate cold start): `isEnabledFor` alone answers a cache miss fail-closed,
  // which is right for the reply path and wrong for a page, where it rendered the
  // first request after boot without the library and the second with it. The
  // refresh reads this bot's rows first; if that read fails it has already said so
  // loudly, the cache stays unset, and the gate below still fails closed.
  await ctx.plugins.refreshFor(botProfileId);
  if (!ctx.plugins.isEnabledFor(botProfileId, MUSIC_ID)) return undefined;
  try {
    return await promptFactsForBot(ctx.db, botProfileId);
  } catch (error) {
    log.warn(
      `Preview: reading bot ${String(botProfileId)}'s music facts failed (${
        error instanceof Error ? error.message : String(error)
      }); the previewed prompt stays silent about the library, as the reply would.`,
    );
    return undefined;
  }
}
