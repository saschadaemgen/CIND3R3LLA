/**
 * Which bots the runtime hosts, and which SimpleX profile each one is (CCB-S5-001, D-155).
 *
 * ── WHAT CHANGED ─────────────────────────────────────────────────────────────
 *
 * The boot path used to read one row - `selected_for_runtime = TRUE` - and host the
 * core's active user as that bot. Every enabled bot is hosted now, so the question
 * "which SimpleX profile is this bot" has to have an answer per bot rather than being
 * answered once by whichever profile the core last made active.
 *
 * Migration 044 adds the column that answers it. This module is the only writer of it.
 *
 * ── THE ORDER MATTERS, AND NOT FOR TIDINESS ──────────────────────────────────
 *
 * The primary is hosted FIRST and is the only bot allowed to adopt the core's active
 * user. That is what preserves the existing deployment: the profile that is already in
 * the operator's groups, already has the avatar, already has the members, stays exactly
 * where it is and simply gets its id written down. Every other unbound bot gets a NEW
 * profile, because taking over the active user would move a second character into the
 * first one's groups.
 *
 * A bot that already carries a `simplex_user_id` is named by id and neither adopts nor
 * creates, which is the steady state after the first boot.
 */

import type { Queryable } from '../db/pool.js';
import { log } from '../log.js';
import type { RuntimeProfileSpec } from '../bot/runtime/profiles.js';

/** One bot the runtime will host. */
export interface HostedBotConfig {
  botProfileId: number;
  slug: string;
  displayName: string;
  /** NULL until this bot has been bound to a SimpleX profile. */
  simplexUserId: number | null;
  /** The console's default selection. Decides nothing about hosting. */
  isPrimary: boolean;
  /**
   * This bot's own avatar, relative to the asset root, or null for the deployment default
   * (CCB-S5-007). Null is an answer rather than a gap: it means AVATAR_PATH, which is what
   * every bot including the first one gets until somebody uploads a face for it.
   */
  avatarPath: string | null;
}

interface BotRow {
  id: string;
  slug: string;
  display_name: string;
  simplex_user_id: string | null;
  selected_for_runtime: boolean;
  avatar_path: string | null;
}

/**
 * Every bot that should be running, primary first.
 *
 * `enabled` on `cinderella_bot_profiles` is the flag, and it is the one the wizard
 * writes. Note it is NOT `cinderella_bot_registry.enabled`: 023 says in as many words
 * that the two mean different things ("this onboarding draft is live" against "the
 * runtime may host this profile"), and this reads the operator's configuration rather
 * than the record of what the core reported.
 *
 * Ordered primary first, then by id, so hosting is deterministic across boots and the
 * one bot allowed to adopt the active user is always the same one.
 */
export async function listBotsToHost(db: Queryable): Promise<HostedBotConfig[]> {
  const { rows } = await db.query<BotRow>(
    `SELECT id, slug, display_name, simplex_user_id, selected_for_runtime, avatar_path
       FROM cinderella_bot_profiles
      WHERE enabled = TRUE
      ORDER BY selected_for_runtime DESC, id`,
  );
  return rows.map((r) => ({
    botProfileId: Number(r.id),
    slug: r.slug,
    displayName: r.display_name,
    simplexUserId: r.simplex_user_id === null ? null : Number(r.simplex_user_id),
    isPrimary: r.selected_for_runtime,
    avatarPath: r.avatar_path,
  }));
}

/**
 * Whether ANY configured bot is already bound to a SimpleX profile.
 *
 * Over the whole table, deliberately, and not over the enabled set {@link listBotsToHost}
 * returns. A bound bot that the operator has paused still owns its SimpleX identity: its
 * groups, its members and its history are on that profile whether the runtime is hosting it
 * this boot or not. Asking only about enabled bots would let an operator pause the one bound
 * bot, boot, and have an unbound bot adopt the paused one's identity, which is the exact
 * takeover this function exists to make impossible.
 */
export async function anyBotIsBound(db: Queryable): Promise<boolean> {
  const { rows } = await db.query<{ bound: string }>(
    `SELECT count(*)::text AS bound
       FROM cinderella_bot_profiles
      WHERE simplex_user_id IS NOT NULL`,
  );
  return Number(rows[0]?.bound ?? 0) > 0;
}

/**
 * Turn the configurations into runtime specs.
 *
 * ── WHO MAY ADOPT, AND THE DEFECT THIS CORRECTS (CCB-S5-012, D-165) ─────────
 *
 * Adoption means taking over the SimpleX profile the core already has: its identity, its
 * groups, its members. It is the one operation here that cannot be undone from the console,
 * so the rule has to be narrow, and it was not.
 *
 * The rule was "the first unbound bot adopts", implemented as a bare `adoptionSpent` flag.
 * The doc above it claimed something narrower - "only when it is the primary or there is no
 * primary" - and the code never checked that, so the comment described a guarantee that was
 * not there. On a deployment with one bound bot and one new one, which is what an operator
 * has the moment he creates a second bot, the new bot took `adopt: 'activeUser'` and resolved
 * onto the FIRST bot's profile. The CCB-S5-001 duplicate guard then refused the whole boot.
 * Loud rather than silent, and nothing was stranded, but the runtime would not start and the
 * error named a remedy the console cannot perform.
 *
 * ── THE RULE NOW ─────────────────────────────────────────────────────────────
 *
 * Adopt the existing active user **only when nothing is bound yet**. That is the one moment
 * adoption is meaningful: a deployment whose profile predates this table, where the active
 * user IS the bot everybody knows. Once any bot holds a `simplex_user_id`, the active user
 * belongs to somebody, and every unbound bot creates its own profile instead.
 *
 * Note what this rule does NOT mention: the primary. The old comment reached for it because
 * "which bot is the special one" felt like the question, and it is not. The question is
 * whether the existing identity is spoken for, which the data answers directly. This was the
 * flag's last functional consumer, and correcting the rule removed it rather than preserving
 * it (see D-165).
 *
 * `anyBound` is a parameter rather than a lookup so this stays pure and answerable with no
 * database, which is how `verify:adoption` drives every case including the ones production
 * cannot reach.
 */
export function toRuntimeSpecs(
  bots: readonly HostedBotConfig[],
  anyBound: boolean,
): RuntimeProfileSpec[] {
  // Spent before the walk begins when something is already bound: there is no adoption to
  // hand out. Two specs carrying `adopt: 'activeUser'` would resolve to one profile, which
  // `resolveProfileSpecs` refuses outright, but producing the refusable input and relying on
  // the refusal is not a design.
  let adoptionSpent = anyBound;
  return bots.map((bot) => {
    if (bot.simplexUserId !== null) {
      return { simplexUserId: bot.simplexUserId, displayName: bot.displayName };
    }
    if (!adoptionSpent) {
      adoptionSpent = true;
      return { displayName: bot.displayName, adopt: 'activeUser' as const };
    }
    return { displayName: bot.displayName, adopt: 'create' as const };
  });
}

/**
 * Record which SimpleX profile a bot ended up on.
 *
 * Called immediately after resolution, before anything is hosted. If this does not
 * happen, a bot that CREATED a profile creates another one on the next boot, and the
 * first one is left in the core database as a bot in no groups that nothing hosts - the
 * exact failure `profiles.ts` refuses to allow by display-name matching, arrived at from
 * the other direction.
 *
 * The write is guarded by the partial unique index from 044, so binding two bots to one
 * profile fails here rather than producing a deployment where one identity carries two
 * characters.
 */
export async function bindSimplexUser(
  db: Queryable,
  botProfileId: number,
  simplexUserId: number,
): Promise<void> {
  await db.query(
    `UPDATE cinderella_bot_profiles
        SET simplex_user_id = $2, updated_at = now()
      WHERE id = $1 AND simplex_user_id IS DISTINCT FROM $2`,
    [botProfileId, simplexUserId],
  );
  log.info('Bound a bot configuration to its SimpleX profile', {
    botProfileId,
    simplexUserId,
  });
}

/** The bot a given SimpleX profile belongs to, for routing an event to its character. */
export function botForUser(
  bots: readonly HostedBotConfig[],
  simplexUserId: number,
): HostedBotConfig | undefined {
  return bots.find((b) => b.simplexUserId === simplexUserId);
}
