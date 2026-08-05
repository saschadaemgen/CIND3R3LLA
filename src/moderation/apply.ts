/**
 * Applying a sanction, and being able to take it back (CCB-S4-035, D-139).
 *
 * ── HOW THIS TREE STAYS INCAPABLE WHILE ENFORCEMENT IS ARMED ─────────────────
 *
 * CCB-S4-032 promised something stronger than a flag: nothing under `src/moderation/`
 * could act, because the capability did not exist here to be misused. Arming has to
 * change what happens, and it deliberately does not change that.
 *
 * This module cannot mute anybody. It declares {@link EnforcementPort}, an interface in
 * Cinderella's own vocabulary, and acts only through whatever it is HANDED. The real
 * implementation lives in `src/bot/enforcement.ts`, which is the only tree allowed to
 * import the SDK; the boot path connects the two. So the guarantee is now: this tree can
 * act only through a port somebody gave it, `rules.ts` and `store.ts` still cannot act at
 * all, and `verify:moderation` still scans the whole tree for the enforcement API names
 * and still finds none, because the names stop at the seam.
 *
 * That is the same shape as the chat adapter (D-078), for the same reason, plus one that
 * matters more here: a port is substitutable, so a harness can drive every branch of this
 * file with a spy and prove what was called, what was not called, and what was written
 * afterwards. An orchestrator wired directly to the SDK could only be proven by muting
 * somebody.
 *
 * ── THE ORDER OF OPERATIONS IS THE WHOLE DESIGN ──────────────────────────────
 *
 * Refuse, act, then record. Never record then act.
 *
 * Recording first would mean a row claiming a sanction that the SDK then declined to
 * apply, and the Active page would show a member as muted who is talking normally. The
 * briefing calls that leaving a lie, and it is the failure this ordering exists to make
 * impossible: the row is written after the call resolves, and it is written differently
 * depending on which way it resolved. A failure is still recorded, because a sanction
 * that was attempted and failed is something the operator must see, but it is recorded as
 * a failure and it never reaches the Active page.
 */

import type { Queryable } from '../db/pool.js';
import type { MemberRole } from '../adapter/types.js';
import { log } from '../log.js';
import { status } from '../web/status.js';
import {
  markSanctionFailed,
  recordEnforcedSanction,
  type ActiveSanctionRow,
} from './store.js';
import type { EnforcementAction, ViolationType } from './rules.js';

/**
 * The capability, as this tree is allowed to see it.
 *
 * Cinderella's vocabulary, not the protocol's. Three methods rather than a `mute()` and
 * an `unmute()`, because a mute IS a role change and naming it twice would be two places
 * that have to agree about what it means; the one that drifts is always the restore,
 * since it runs unattended from a queue an hour later.
 */
export interface EnforcementPort {
  setMemberRole(groupId: number, groupMemberId: number, role: MemberRole): Promise<void>;
  blockMemberForAll(groupId: number, groupMemberId: number, blocked: boolean): Promise<void>;
  removeMember(groupId: number, groupMemberId: number): Promise<void>;
}

/** The role a mute puts somebody in. Named once so the two halves cannot disagree. */
export const MUTED_ROLE: MemberRole = 'observer';

/**
 * Roles the ladder may never aim at, whatever the operator configured.
 *
 * Duplicated deliberately from `src/bot/enforcement.ts`: that copy guards the capability
 * and this one guards the decision, and neither is allowed to assume the other ran. A
 * floor beneath the configurable exemptions, in the same spirit as the permissiveness
 * ceiling beneath the dials.
 */
export const NEVER_ENFORCE_AGAINST: readonly MemberRole[] = ['owner'];

export interface ApplyRequest {
  groupId: number;
  memberId: string;
  memberDisplayName: string;
  /** The role held right now. This is what a restore puts back. */
  memberRole: MemberRole | null;
  /** The core's numeric id, which is the only thing the port can act on. */
  groupMemberId: number | null;
  action: Exclude<EnforcementAction, 'none'>;
  durationSeconds: number;
  violationType: ViolationType;
  violationCount: number;
  windowSeconds: number;
  rungThreshold: number | null;
  reason: string;
  /** Whether she said it in the chat. */
  spoken: boolean;
}

export type ApplyOutcome =
  | { status: 'applied'; sanctionId: string; expiresAt: string | null; previousRole: MemberRole }
  | { status: 'failed'; sanctionId: string | null; error: string }
  | { status: 'refused'; error: string };

/**
 * Why a sanction was refused before anything was attempted.
 *
 * REFUSAL IS NOT FAILURE and the two are kept apart in the return type, because they mean
 * different things to an operator reading the Log. A failure is "we tried and the core
 * said no". A refusal is "we declined to try", and every refusal here is a policy the
 * briefing asked for rather than a fault to investigate.
 */
function refusalReason(request: ApplyRequest): string | null {
  // THE BRIEFING'S FIRST RULE, and the one that protects everything downstream: an
  // unrestorable mute is worse than none. Without a role there is nothing to put back, so
  // the mute would be permanent by construction the moment it succeeded.
  if (request.memberRole === null) {
    return 'the member\'s role could not be determined, and a mute that cannot be restored is worse than no mute';
  }
  if (NEVER_ENFORCE_AGAINST.includes(request.memberRole)) {
    return `the member holds ${request.memberRole}, which no ladder may act against`;
  }
  // The numeric id is the only thing the port can act on. Coercing a missing one would be
  // aiming an action at whatever the core makes of NaN.
  if (typeof request.groupMemberId !== 'number' || !Number.isFinite(request.groupMemberId)) {
    return 'the member\'s numeric group-member id is unknown, so there is nothing to aim the action at';
  }
  return null;
}

/**
 * Do the thing, then write down what happened.
 *
 * A `warn` never reaches the port. It is a message, and CCB-S4-033 already sends it; the
 * row is written so the Log shows the warning happened, marked enforced because the mode
 * is armed, and carrying no role change because there was none.
 */
export async function applySanction(
  db: Queryable,
  port: EnforcementPort,
  request: ApplyRequest,
  now: Date = new Date(),
): Promise<ApplyOutcome> {
  // A warning acts on nobody, so it skips every refusal that exists to protect a member
  // from an action. Refusing to WARN a member whose role is unknown would mean the ladder
  // going quiet exactly when it should be speaking.
  if (request.action === 'warn') {
    const id = await recordEnforcedSanction(db, {
      ...request,
      previousRole: null,
      groupMemberId: null,
      expiresAt: null,
      enforcedAt: now,
    });
    return {
      status: 'applied',
      sanctionId: id,
      expiresAt: null,
      // A warning changes no role, so there is nothing to restore. Reported as the role
      // they held, which is what it is.
      previousRole: request.memberRole ?? MUTED_ROLE,
    };
  }

  const refused = refusalReason(request);
  if (refused) {
    // RECORDED, and recorded as a refusal rather than as a sanction. An operator whose
    // ladder is quietly declining to act must be able to see that it is, or they will
    // conclude the ladder is wrong and lower the thresholds.
    const id = await markSanctionFailed(db, request, `refused: ${refused}`);
    log.warn(`Moderation: refused to ${request.action} a member, ${refused}.`);
    status.error(
      `Moderation: a ${request.action} was refused, ${refused}. The member was not affected.`,
    );
    return { status: 'failed', sanctionId: id, error: `refused: ${refused}` };
  }

  const previousRole = request.memberRole as MemberRole;
  const groupMemberId = request.groupMemberId as number;

  try {
    // ACT FIRST. Everything after this line knows whether it worked.
    if (request.action === 'mute') {
      await port.setMemberRole(request.groupId, groupMemberId, MUTED_ROLE);
    } else if (request.action === 'block') {
      await port.blockMemberForAll(request.groupId, groupMemberId, true);
    } else {
      await port.removeMember(request.groupId, groupMemberId);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    // NO ROW CLAIMS SUCCESS. The attempt is recorded with its error, the member is
    // untouched, and the schema itself refuses an enforced row that carries neither an
    // applied timestamp nor a reason it did not apply.
    const id = await markSanctionFailed(db, request, message);
    log.warn(`Moderation: ${request.action} failed and the member was not affected (${message}).`);
    status.error(
      `Moderation: a ${request.action} could not be applied and the member was not ` +
        `affected (${message}).`,
    );
    return { status: 'failed', sanctionId: id, error: message };
  }

  // A mute is the only timed action. Block and remove have no automatic reversal, which
  // the console says in as many words rather than leaving the operator to infer from an
  // empty "until" column.
  const expiresAt =
    request.action === 'mute' && request.durationSeconds > 0
      ? new Date(now.getTime() + request.durationSeconds * 1000)
      : null;

  const sanctionId = await recordEnforcedSanction(db, {
    ...request,
    previousRole,
    groupMemberId,
    expiresAt,
    enforcedAt: now,
  });

  log.info('Moderation enforced a step', {
    action: request.action,
    group: request.groupId,
    previousRole,
    expiresAt: expiresAt?.toISOString() ?? null,
  });

  return {
    status: 'applied',
    sanctionId,
    expiresAt: expiresAt?.toISOString() ?? null,
    previousRole,
  };
}

export type RestoreOutcome =
  | { status: 'restored'; role: MemberRole }
  | { status: 'already'; note: string }
  | { status: 'nothing-to-do'; note: string };

/**
 * Put a member back where they were. The one path both reversals go through.
 *
 * IDEMPOTENT BY CONSTRUCTION, because the queue contract requires it (`JobHandler` must
 * survive a repeat run) and because an operator can click undo on a mute that expired
 * while the page was open. A row that has already been reversed returns `already` and
 * touches nothing: not an error, because nothing is wrong, and the briefing is explicit
 * that undo after expiry is a no-op with an honest message rather than a failure.
 *
 * The role restored is `previous_role` off the row, never a default. That is the whole
 * point of storing it: muting a moderator and restoring them as a plain member is a
 * silent demotion nobody would notice until they tried to moderate something.
 */
export async function restoreSanction(
  db: Queryable,
  port: EnforcementPort,
  row: ActiveSanctionRow,
): Promise<RestoreOutcome> {
  if (row.undoneAt !== null || row.expiredAt !== null) {
    return {
      status: 'already',
      note:
        row.expiredAt !== null
          ? 'this mute had already expired and the role was already restored'
          : 'this sanction had already been lifted',
    };
  }

  // Block and remove are not reversible by this system, and saying so is more useful than
  // a call that half works. The console repeats it where an operator will read it.
  if (row.action !== 'mute') {
    return {
      status: 'nothing-to-do',
      note: `a ${row.action} is not reversible from here, it has to be undone in your own client`,
    };
  }

  if (row.previousRole === null || row.groupMemberId === null) {
    // Should be unreachable: `applySanction` refuses to mute without both. Kept because
    // the alternative is a throw from a queue worker on a row that can never succeed.
    return {
      status: 'nothing-to-do',
      note: 'this row carries no previous role or member reference, so there is nothing to restore it to',
    };
  }

  await port.setMemberRole(row.groupId, row.groupMemberId, row.previousRole);
  return { status: 'restored', role: row.previousRole };
}
