/**
 * Greeting a new member, end to end (CCB-S5-041, D-206).
 *
 * Joins the four pieces that were built separately and can each be tested without a core:
 * `greeting.ts` decides, `store.ts` claims, `bot/welcome-port.ts` attempts, and this
 * sequences them. The sequencing is where the guarantees are either kept or quietly lost, so
 * the order below is argued rather than assumed.
 *
 * ── THE CLAIM COMES BEFORE THE SEND, AND THAT IS NOT THE OBVIOUS ORDER ──────
 *
 * Sending first and recording after would be simpler and would read better in the log, and it
 * is wrong: several bots in one room receive the same membership event, from the same core, in
 * the same process, at the same instant. Whatever they do BEFORE the claim, they all do. So
 * the claim - one `INSERT ... ON CONFLICT DO NOTHING` over a key SimpleX assigned - must be
 * the first thing that happens, and only the winner sends.
 *
 * The cost is that the row exists before the outcome is known and states the INTENDED route.
 * `recordFailedSend` corrects it. That is a real cost and it is the right one: a duplicate
 * greeting is visible to every member of the room forever, while a row that briefly says
 * `group` before saying `suppressed` is visible to nobody but the diagnostics page.
 *
 * ── WHAT IS DELIBERATELY NOT RECORDED ───────────────────────────────────────
 *
 * `predates-bot` short-circuits with NO row. The briefing asks that a greeting which did not
 * go out leaves a record, and for every other reason it does - but this one fires once per
 * existing member the moment the bot joins a room, so honouring it literally would write 900
 * rows on one join, bury every real suppression, and claim 900 member ids that were never
 * candidates. It is counted and logged once per join instead. The distinction: the other
 * reasons are decisions ABOUT a candidate, and this one says there was no candidate.
 */

import type { Queryable } from '../../db/pool.js';
import { log } from '../../log.js';
import { status } from '../../web/status.js';
import { attemptPrivate, sendToGroup } from '../../bot/welcome-port.js';
import {
  afterRefusal,
  arrivedAfterBot,
  isFault,
  planGreeting,
  type SuppressionReason,
  type WelcomeSettings,
} from './greeting.js';
import { claimGreeting, isReturningMember, recordFailedSend } from './store.js';

/** What the membership event told us about the arrival. */
export interface ArrivalEvent {
  botProfileId: number;
  groupId: number;
  groupName: string;
  /** The wire id. Room-scoped by SimpleX's construction: the once-rule's key. */
  memberId: string;
  /** The core's numeric member id, needed to address the support thread. */
  groupMemberId: number;
  memberName: string;
  /** `pre` / `post` / `invitee` / `host` / `user`. Decides whether this is an arrival at all. */
  memberCategory: string | undefined;
  /** Absent when no direct connection exists to this member. */
  memberContactId?: number;
}

export type GreetOutcome =
  | { greeted: true; route: 'group' | 'support' | 'direct' }
  | { greeted: false; reason: SuppressionReason };

/**
 * Greet one arriving member, or say precisely why not.
 *
 * Never throws: a greeting is a courtesy, and a membership event must not be lost because a
 * pleasantry failed. Every path returns a reason instead, and the one genuine fault reaches
 * the admin dashboard (CCB-S3-023).
 */
export async function greetArrival(
  db: Queryable,
  settings: WelcomeSettings,
  ev: ArrivalEvent,
): Promise<GreetOutcome> {
  // FIRST, and with no row: see the header. This is the 900-greetings guard, and it is not
  // the once-constraint - that enforces once, not appropriate.
  if (!arrivedAfterBot(ev.memberCategory)) {
    return { greeted: false, reason: 'predates-bot' };
  }

  const returning = await isReturningMember(db, ev.memberId);
  const plan = planGreeting(settings, {
    memberName: ev.memberName,
    groupName: ev.groupName,
    returning,
    // Already decided above; the model takes it as an input so it stays pure and testable.
    predatesBot: false,
  });

  if (plan.kind === 'suppress') {
    // A decision about a real candidate, so it is recorded. If another bot got here first the
    // claim simply fails and this one records nothing, which is correct.
    await claimGreeting(db, {
      memberId: ev.memberId,
      botProfileId: ev.botProfileId,
      groupId: ev.groupId,
      groupName: ev.groupName,
      memberName: ev.memberName,
      isReturning: returning,
      route: 'suppressed',
      reason: plan.reason,
    });
    return { greeted: false, reason: plan.reason };
  }

  // THE CLAIM. Whoever wins this sends; everybody else stops here, having done nothing.
  const won = await claimGreeting(db, {
    memberId: ev.memberId,
    botProfileId: ev.botProfileId,
    groupId: ev.groupId,
    groupName: ev.groupName,
    memberName: ev.memberName,
    isReturning: returning,
    route: plan.route,
    reason: null,
  });
  if (!won) {
    // Not an error and not logged as one: this is the guarantee working. A second bot, a
    // rejoin, a reconnect, or a resync replaying connections.
    return { greeted: false, reason: 'already-greeted' };
  }

  const outcome =
    plan.route === 'group'
      ? await sendToGroup(ev.botProfileId, ev.groupId, plan.text)
      : await attemptPrivate(ev.botProfileId, plan.route, {
          groupId: ev.groupId,
          groupMemberId: ev.groupMemberId,
          memberContactId: ev.memberContactId,
          text: plan.text,
        });

  if (outcome.ok) {
    log.info('welcome: a member was greeted', {
      botProfileId: ev.botProfileId,
      groupId: ev.groupId,
      route: plan.route,
      returning,
    });
    return { greeted: true, route: plan.route };
  }

  // The private route refused. `afterRefusal` decides whether the group catches it, and
  // REFUSES to fall back on a fault - delivering to the group after a real failure would hide
  // the fault behind a success.
  const next = afterRefusal(settings, { text: plan.text }, outcome.reason);
  if (next.kind === 'send') {
    const viaGroup = await sendToGroup(ev.botProfileId, ev.groupId, next.text);
    if (viaGroup.ok) {
      // The row still says the intended private route, so correct it to what happened.
      await recordFailedSend(db, ev.memberId, outcome.reason);
      log.info('welcome: the private route was unavailable, greeted in the group instead', {
        botProfileId: ev.botProfileId,
        groupId: ev.groupId,
        reason: outcome.reason,
      });
      return { greeted: true, route: 'group' };
    }
    await recordFailedSend(db, ev.memberId, 'send-failed');
    status.error(
      `A welcome could not be sent in "${ev.groupName}": the private route was unavailable ` +
        `(${outcome.reason}) and the group send failed too.`,
    );
    return { greeted: false, reason: 'send-failed' };
  }

  await recordFailedSend(db, ev.memberId, next.reason);
  if (isFault(next.reason)) {
    // ONLY a fault reaches the dashboard. `no-contact` and `prohibited` are stable states of
    // the deployment, correct behaviour by the admin's configuration, and alerting on them
    // would be the noise CCB-S3-023 forbids.
    status.error(
      `A welcome could not be sent in "${ev.groupName}": ${outcome.detail ?? next.reason}.`,
    );
  }
  return { greeted: false, reason: next.reason };
}
