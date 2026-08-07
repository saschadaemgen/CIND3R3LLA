/**
 * The three things that can actually happen to a member (CCB-S4-035, D-139).
 *
 * ── WHY THIS FILE IS HERE AND NOT IN src/moderation/ ─────────────────────────
 *
 * CCB-S4-032 made a structural promise: nothing in the moderation tree can act, because
 * the capability does not exist there to be misused. Arming does not weaken that promise,
 * it puts the capability somewhere else and keeps the tree incapable. `rules.ts` still
 * turns a count into a decision and stops; `store.ts` still writes rows and holds no chat
 * client; `verify:moderation` still scans that whole tree for the enforcement API names
 * and still fails if one appears. What changed is that the ENGINE now has a second
 * outbound beside `send`, and the queue worker and the console can call in here directly.
 *
 * It also has to be here for a duller reason: `src/bot/` is the only tree permitted to
 * import `simplex-chat`, enforced by `verify:adapter-seam`. The SDK vocabulary stops at
 * this file, and everything above it speaks Cinderella's.
 *
 * Modelled on `core-delete.ts` deliberately, down to the shape of the availability check
 * and the unavailable-error: a registered handle, absent in harnesses and one-shot
 * scripts, and a transient failure when the core is not running so a queue job retries
 * rather than dead-lettering a mute that could have been lifted a minute later.
 *
 * ── NUMERIC IDS, AND WHY THE REFUSALS ARE HERE ───────────────────────────────
 *
 * All three APIs take `groupMemberIds: number[]`, the core's own row id, not the
 * protocol's string member id that the archive keys everything else on. The caller
 * supplies the number, and this file refuses a call that does not have one rather than
 * coercing a NaN into an array and letting the core decide what that means.
 */

import { T } from '@simplex-chat/types';

import type { MemberRole } from '../adapter/types.js';
import type { EnforcementPort } from '../moderation/apply.js';
import { log } from '../log.js';
/**
 * ── ROUTED BY GROUP OWNER SINCE CCB-S5-001 ───────────────────────────────────
 *
 * This held a `BotHandle` and called `bot.chat.apiSetMembersRole(...)` directly. None of
 * the three SDK calls it makes takes a user id, so all three execute as whichever profile
 * the core last made active. With one bot pinned active that was the right one by
 * construction. With several it is whichever bot most recently issued any command, so a
 * mute decided by bot A's ladder could be issued as bot B - which is usually not even a
 * member of that group, so the SDK refuses and a correct moderation decision reads as a
 * bug; and where both bots ARE admins of one group, it succeeds as the wrong one.
 *
 * So the module holds a PORT that resolves the owning bot from the group id and issues
 * through the scheduler, and refuses when the owner is unknown rather than acting as
 * somebody arbitrary. This is the moderation path: acting on the wrong member's standing
 * as the wrong identity is not a failure to degrade quietly around.
 */

/** The live bot, when one is running. Absent in harnesses and one-shot scripts. */
/** What the runtime supplies: run this command as whichever bot owns the group. */
export interface EnforcementRuntimePort {
  runForGroup<R>(groupId: number, label: string, fn: () => Promise<R>): Promise<R>;
  readonly chat: { 
    apiSetMembersRole(groupId: number, memberIds: number[], role: T.GroupMemberRole): Promise<unknown>;
    apiBlockMembersForAll(groupId: number, memberIds: number[], blocked: boolean): Promise<unknown>;
    apiRemoveMembers(groupId: number, memberIds: number[]): Promise<unknown>;
  };
}

let handle: EnforcementRuntimePort | null = null;

export function setEnforcementHandle(h: EnforcementRuntimePort | null): void {
  handle = h;
}

/** Whether an enforcement action can be attempted at all right now. */
export function enforcementAvailable(): boolean {
  return handle !== null;
}

/**
 * The core is not running.
 *
 * TRANSIENT, always. The bot may be starting, or stopped while the admin console stays
 * up. A mute expiry that dead-lettered because the core happened to be down would leave a
 * member muted forever over a restart, so this is a retry and never a permanent failure.
 */
export class EnforcementUnavailableError extends Error {
  constructor() {
    super('the SimpleX core is not running, so no moderation action can be applied yet');
  }
}

/**
 * Cinderella's seven roles to the protocol's enum, inside the adapter and nowhere else.
 *
 * Exhaustive by construction: the mapping is a record over the union, so adding a role to
 * `MemberRole` fails the build here rather than silently falling through to a default.
 * A default is exactly what must not exist on this path, because the fallback value of a
 * role mapping is somebody's standing in a group.
 */
const ROLE_TO_SDK: Record<MemberRole, T.GroupMemberRole> = {
  relay: T.GroupMemberRole.Relay,
  observer: T.GroupMemberRole.Observer,
  author: T.GroupMemberRole.Author,
  member: T.GroupMemberRole.Member,
  moderator: T.GroupMemberRole.Moderator,
  admin: T.GroupMemberRole.Admin,
  owner: T.GroupMemberRole.Owner,
};

/**
 * The role no ladder may ever aim at, whatever the operator has configured.
 *
 * A FLOOR BENEATH THE EXEMPTIONS, in the same spirit as the permissiveness ceiling
 * beneath the personality dials (D-133): the exempt-roles list is the operator's to set,
 * and this is not on it. Owner is excluded by the shipped default, but a default is a
 * value somebody can change, and the thing on the other side of that change is the person
 * who owns the group being demoted by a nickname counter. If the bot is not owner the SDK
 * refuses anyway and the failure reads as a bug; if the bot IS owner it would succeed,
 * which is worse. Refused here, once, on the only path that can act.
 */
export const NEVER_ENFORCE_AGAINST: readonly MemberRole[] = ['owner'];

function requireHandle(): EnforcementRuntimePort {
  if (!handle) throw new EnforcementUnavailableError();
  return handle;
}

function requireMemberId(groupMemberId: number | undefined | null, what: string): number {
  if (typeof groupMemberId !== 'number' || !Number.isFinite(groupMemberId)) {
    throw new Error(
      `Cannot ${what}: the member's numeric group-member id is unknown, and aiming a ` +
        `moderation action at a guess is not something this will do.`,
    );
  }
  return groupMemberId;
}

/**
 * Sets a member's role. This is both halves of a mute: down to Observer, and back again.
 *
 * ONE FUNCTION FOR BOTH DIRECTIONS ON PURPOSE. A `mute()` and an `unmute()` would be two
 * places that have to agree about what a mute IS, and the restore half would be the one
 * that drifted, because it runs unattended from a queue an hour later. There is one call,
 * and the difference between silencing somebody and giving them back what they had is
 * which role the caller passes.
 */
export async function setMemberRole(
  groupId: number,
  groupMemberId: number | undefined | null,
  role: MemberRole,
): Promise<void> {
  const bot = requireHandle();
  const memberId = requireMemberId(groupMemberId, `set a member's role in group ${groupId}`);
  await bot.runForGroup(groupId, 'moderation:role', () =>
    bot.chat.apiSetMembersRole(groupId, [memberId], ROLE_TO_SDK[role]),
  );
  log.info(`Moderation: set member ${memberId} in group ${groupId} to ${role}.`);
}

/** Blocks a member's messages for everyone in the group. */
export async function blockMemberForAll(
  groupId: number,
  groupMemberId: number | undefined | null,
  blocked = true,
): Promise<void> {
  const bot = requireHandle();
  const memberId = requireMemberId(groupMemberId, `block a member in group ${groupId}`);
  await bot.runForGroup(groupId, 'moderation:block', () =>
    bot.chat.apiBlockMembersForAll(groupId, [memberId], blocked),
  );
  log.info(
    `Moderation: ${blocked ? 'blocked' : 'unblocked'} member ${memberId} in group ${groupId}.`,
  );
}

/**
 * Removes a member from the group.
 *
 * `withMessages` is left at the SDK default (false) and is deliberately not exposed. A
 * moderation ladder removing somebody is a decision about their membership; deleting
 * everything they ever wrote is a decision about the ARCHIVE, and the archive is governed
 * by consent and by the destruction path (CCB-S3-013), not by a nickname counter.
 */
export async function removeMember(
  groupId: number,
  groupMemberId: number | undefined | null,
): Promise<void> {
  const bot = requireHandle();
  const memberId = requireMemberId(groupMemberId, `remove a member from group ${groupId}`);
  await bot.runForGroup(groupId, 'moderation:remove', () =>
    bot.chat.apiRemoveMembers(groupId, [memberId]),
  );
  log.info(`Moderation: removed member ${memberId} from group ${groupId}.`);
}

/**
 * The live capability, in the shape `src/moderation/` is allowed to see.
 *
 * ONE OBJECT, not three call sites. The engine, the expiry job and the console's undo all
 * need the same three methods, and three separately-constructed literals would be three
 * chances for one of them to be wired to something subtly different. It is a plain object
 * rather than a class because there is no state here: the state is the module-level
 * handle, and every method reads it at call time so a port captured before the core
 * started still works after it does.
 */
export const liveEnforcementPort: EnforcementPort = {
  setMemberRole: (groupId, groupMemberId, role) => setMemberRole(groupId, groupMemberId, role),
  blockMemberForAll: (groupId, groupMemberId, blocked) =>
    blockMemberForAll(groupId, groupMemberId, blocked),
  removeMember: (groupId, groupMemberId) => removeMember(groupId, groupMemberId),
};
