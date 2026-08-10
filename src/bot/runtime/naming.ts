/**
 * What each hosted bot's SimpleX profile is called (CCB-S5-019, D-173).
 *
 * ── WHY THIS IS ITS OWN MODULE ───────────────────────────────────────────────
 *
 * Same reason as `faces.ts`: the decision imports no SDK and is therefore answerable with
 * no core running, which is what lets a harness drive the dangerous half of this briefing
 * instead of reading it. `host.ts` supplies the live profile names and acts on the answer.
 *
 * ── THE CHANGE THIS GUARDS ───────────────────────────────────────────────────
 *
 * Until CCB-S5-019 the primary's profile was named from `BOT_DISPLAY_NAME` and every other
 * bot from its own record, chosen by `selected_for_runtime`. Every bot reads its own record
 * now. For every deployment where those two agree that is not a change at all; for one
 * where they disagree it renames a bot in front of its group, silently, once, and
 * irreversibly from the members' side.
 *
 * A migration copying the env value into the record was considered and rejected: it decides
 * which of two disagreeing sources wins at a moment nobody is watching, and if the env value
 * is the stale one it makes the rename permanent rather than preventing it. Refusing names
 * both values and costs one loud failed deploy, which is strictly better than one that
 * succeeds wrongly.
 *
 * ── AND WHY IT IS BOUNDED ────────────────────────────────────────────────────
 *
 * Only the bot ACTUALLY WEARING the env name can be renamed by this change, so only that bot
 * is checked. A deployment whose `BOT_DISPLAY_NAME` matches nobody is not in a dangerous
 * state and must still boot; so must one where a second bot's record happens to differ from
 * an env value that was never applied to it. The live name is read from the profile the core
 * reports rather than from the flag being retired, because the flag is what is under
 * suspicion and the profile is the thing a member can see.
 */

/** One bot, as this decision needs it. */
export interface BotNaming {
  /** What the core says this profile is called right now. */
  liveName: string;
  /** What `cinderella_bot_profiles.display_name` says it should be called. */
  recordName: string;
}

/**
 * The one bot whose name would change under D-173, or null when no bot would.
 *
 * Null is the answer for every safe deployment, including the ordinary one where the env
 * value and the record agree. It is deliberately not a list: two bots cannot both be wearing
 * the same env name, and returning at most one keeps the message about a single rename.
 */
export function findRenameOnBoot<B extends BotNaming>(bots: readonly B[], envDisplayName: string): B | null {
  return bots.find((b) => b.liveName === envDisplayName && b.recordName !== envDisplayName) ?? null;
}

/**
 * What an operator is told, naming BOTH values and neither winning.
 *
 * The two remedies are spelled out because the refusal is otherwise a puzzle: an operator
 * reading it at deploy time has to be able to act on it without reading this file, and the
 * right answer depends on which of the two is stale, which only they know.
 */
export function renameRefusal(bot: BotNaming): string {
  return (
    `Runtime host: the bot currently named "${bot.liveName}" in SimpleX has "${bot.recordName}" in ` +
    `its record, and from CCB-S5-019 every bot is named from its record. Booting would rename it ` +
    `in front of its group. Decide which is right and make the two agree: set this bot's name to ` +
    `"${bot.liveName}" on the AI Bot Setup page to keep the name its members already see, or set ` +
    `BOT_DISPLAY_NAME to "${bot.recordName}" if the record is the correct one. Nothing has been ` +
    `changed.`
  );
}
