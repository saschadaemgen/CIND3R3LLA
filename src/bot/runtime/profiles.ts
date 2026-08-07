/**
 * Turning configured profile specs into the SimpleX users the runtime will host.
 *
 * SDK-FREE ON PURPOSE. It imports `@simplex-chat/types` (types and two enums, no
 * native addon) and talks to the core through {@link ProfileDirectory}, so the whole
 * resolution - including the two failure modes that would silently produce a bot in no
 * groups - is provable by `verify:runtime-host` with no chat core present.
 */

import { T } from '@simplex-chat/types';
import { log } from '../../log.js';

/** A profile the runtime hosts. The id is known by the time it is hosted. */
export interface RuntimeProfile {
  simplexUserId: number;
  displayName: string;
}

/**
 * How a caller names a profile to host.
 *
 * Two forms, because the two callers know different things. The registry knows ids
 * (`simplexUserId`), so it names them and a missing one is a drift error. The
 * single-bot wiring (CCB-S4-021) knows only a display name from the environment, and
 * must resolve the same profile `bot.run` would have resolved.
 */
export type RuntimeProfileSpec =
  | { simplexUserId: number; displayName: string; adopt?: undefined }
  | {
      simplexUserId?: undefined;
      displayName: string;
      /**
       * Resolve the profile the way `bot.run` does: the core's ACTIVE user if the
       * database has one, else create it.
       *
       * NOT a display-name match, and the difference is the whole point. Group
       * membership belongs to the SimpleX user, not to its name. An operator who
       * edits `BOT_DISPLAY_NAME` would, under name matching, get a brand new profile
       * that is in no groups and captures nothing, while every log line said the boot
       * had succeeded. Adopting the active user cannot do that.
       *
       * AT MOST ONE SPEC MAY USE THIS (CCB-S5-001). There is one active user, so two
       * specs adopting it would host one profile twice: one SimpleX identity carrying
       * two characters and two sets of laws, answering each message as whichever of
       * the two the router reached first. The caller decides which one adopts - the
       * primary, since it is the profile that already holds the group membership - and
       * every other unbound bot uses `create`.
       */
      adopt: 'activeUser';
    }
  | {
      simplexUserId?: undefined;
      displayName: string;
      /**
       * Make a NEW profile for this bot (CCB-S5-001).
       *
       * What a second bot needs on its first boot: it has no SimpleX identity yet, and
       * it must not take over the first bot's. Adoption is deliberately not an option
       * here - there is one active user and the primary has it.
       *
       * The caller must persist the resulting id against the bot's configuration, or
       * the next boot creates another one. `hosted-bots.ts` does that immediately.
       */
      adopt: 'create';
    };

/** The three core calls resolution needs, and nothing else. */
export interface ProfileDirectory {
  listUsers(): Promise<readonly T.UserInfo[]>;
  getActiveUser(): Promise<T.User | undefined>;
  createUser(profile: T.Profile): Promise<T.User>;
}

export interface ResolvedProfile {
  user: T.User;
  /** What the configuration called it, which may not be what the core stores. */
  configuredName: string;
  /** How it was found, for the boot log. */
  how: 'named by id' | 'adopted the core active user' | 'created';
}

/**
 * Reproduce `mkBotProfile`'s mutation. Losing this silently disables file transfer on
 * every profile so created: nothing is raised at creation time and nothing fails until
 * the first image arrives, months later, in someone else's group.
 *
 * `preferences.commands` is included although it is empty. `mkBotProfile` always sets
 * it (to `opts.commands`, `[]` by default), so a profile built without it is NOT equal
 * to the one the SDK would have built, and a caller that deep-compares the stored
 * profile against this one to decide whether to update would find a difference on
 * every boot and rewrite the profile forever.
 *
 * NEVER PASS THE RESULT OF THIS INTO `bot.run`. `mkBotProfile` opens with
 * `if (prefs.files || prefs.calls || prefs.voice || prefs.commands) { console.log(...);
 * process.exit() }`, and an empty array is truthy in JavaScript, so handing it an
 * already-marked profile kills the process with no thrown error, past every try/catch
 * above it. Deduplicating this against `client.ts`'s profile is the obvious next tidy
 * and it is the one that must not be done.
 */
export function botProfileFor(displayName: string, image?: string): T.Profile {
  return {
    displayName,
    fullName: '',
    ...(image === undefined ? {} : { image }),
    preferences: {
      files: { allow: T.FeatureAllowed.Yes },
      calls: { allow: T.FeatureAllowed.No },
      voice: { allow: T.FeatureAllowed.No },
      commands: [],
    },
    peerType: T.ChatPeerType.Bot,
  };
}

export async function resolveProfileSpecs(
  specs: readonly RuntimeProfileSpec[],
  dir: ProfileDirectory,
  profileFor: (displayName: string) => T.Profile = botProfileFor,
): Promise<ResolvedProfile[]> {
  const existing = await dir.listUsers();
  const byId = new Map(existing.map((u) => [u.user.userId, u.user]));
  const resolved: ResolvedProfile[] = [];

  for (const spec of specs) {
    if (spec.simplexUserId !== undefined) {
      const found = byId.get(spec.simplexUserId);
      if (found === undefined) {
        // Loud. A registry row naming a profile the core does not have means the two
        // have drifted, and hosting the rest while silently skipping this one would
        // leave a profile that looks configured and never speaks.
        throw new Error(
          `Runtime: registry names SimpleX user ${spec.simplexUserId} ` +
            `(${spec.displayName}), which does not exist in the core database. ` +
            `Known ids: ${[...byId.keys()].join(', ') || 'none'}.`,
        );
      }
      resolved.push({ user: found, configuredName: spec.displayName, how: 'named by id' });
      continue;
    }

    if (spec.adopt === 'create') {
      const made = await dir.createUser(profileFor(spec.displayName));
      log.info('runtime: created a SimpleX profile for a bot that had none', {
        simplexUserId: made.userId,
        displayName: made.profile.displayName,
        note: 'created through the guarded bot profile: peerType Bot, file transfer allowed',
      });
      resolved.push({ user: made, configuredName: spec.displayName, how: 'created' });
      continue;
    }

    const active = await dir.getActiveUser();
    if (active !== undefined) {
      if (active.profile.displayName !== spec.displayName) {
        // Said out loud rather than silently reconciled either way. Renaming here
        // would rename the bot in every group from an environment edit; creating
        // instead would abandon the membership. Neither is this module's decision.
        log.warn('runtime: the configured display name is not the stored one', {
          configured: spec.displayName,
          stored: active.profile.displayName,
          simplexUserId: active.userId,
          effect: 'the stored profile is hosted unchanged; nothing was renamed',
        });
      }
      resolved.push({
        user: active,
        configuredName: spec.displayName,
        how: 'adopted the core active user',
      });
      continue;
    }

    if (existing.length > 0) {
      throw new Error(
        `Runtime: the core database has ${existing.length} user(s) but no ACTIVE user, ` +
          `so "${spec.displayName}" cannot be adopted without guessing which one it is. ` +
          `Name it by SimpleX user id instead. Known ids: ${[...byId.keys()].join(', ')}.`,
      );
    }

    const created = await dir.createUser(profileFor(spec.displayName));
    log.info('runtime: no user in the core database, created one', {
      simplexUserId: created.userId,
      displayName: created.profile.displayName,
      note: 'created through the guarded bot profile: peerType Bot, file transfer allowed',
    });
    resolved.push({ user: created, configuredName: spec.displayName, how: 'created' });
  }

  // ── TWO BOTS ON ONE SIMPLEX IDENTITY (CCB-S5-001) ─────────────────────────
  //
  // Loud, and checked after resolution rather than over the specs, because the specs can
  // be distinct while the resolution is not: two `adopt: 'activeUser'` entries name no
  // ids at all and land on the same user. The result would be one profile hosted twice,
  // so one member's message would be answered by whichever of the two characters the
  // router happened to reach first, and the moderation counters and reply budgets of two
  // bots would apply to one identity. Nothing downstream can detect that, because every
  // individual part of it looks correct.
  const seen = new Map<number, string>();
  for (const r of resolved) {
    const already = seen.get(r.user.userId);
    if (already !== undefined) {
      throw new Error(
        `Runtime: bots "${already}" and "${r.configuredName}" both resolved to SimpleX user ` +
          `${r.user.userId}. One profile cannot host two characters: bind each bot to its own ` +
          `SimpleX profile, or leave only one of them enabled.`,
      );
    }
    seen.set(r.user.userId, r.configuredName);
  }

  return resolved;
}
