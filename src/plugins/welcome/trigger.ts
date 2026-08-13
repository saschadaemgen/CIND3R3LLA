/**
 * What makes a greeting happen (CCB-S5-041, D-206).
 *
 * ── BOTH EVENTS ARE SUBSCRIBED, AND THAT IS THE DESIGN RATHER THAN A HEDGE ──
 *
 * Two events carry an identical shape and mean opposite things:
 *
 *   joinedGroupMember       a member joined the group
 *   connectedToGroupMember  WE connected to a member - which fires ONCE PER EXISTING MEMBER
 *                           when the bot itself joins a room
 *
 * Picking one required knowing which reaches an ordinary member bot rather than only the
 * host, and nothing in the tree, the SDK docs or production's journal answered it. So
 * `c856dca` logs what actually arrives.
 *
 * But the answer turned out not to be needed, because the two guards already built make
 * subscribing to BOTH correct:
 *
 *   - `arrivedAfterBot` is an allow-list over `memberCategory`, so the 900-member flood on the
 *     bot's own join is filtered whichever event delivers it: those members are `pre`.
 *   - the claim is `INSERT ... ON CONFLICT DO NOTHING` over a key SimpleX assigned, so if BOTH
 *     events fire for one member, exactly one greeting is sent.
 *
 * Subscribing to one and guessing wrong means either no greetings ever or a flood; subscribing
 * to both means the same behaviour under either answer. The logging stays, because knowing
 * which one fires is still worth having - it is now confirmation rather than a prerequisite.
 */

import type { Queryable } from '../../db/pool.js';
import { log } from '../../log.js';
import { greetArrival, type ArrivalEvent } from './service.js';
import type { WelcomeSettings } from './greeting.js';

/** The shape both events share. Structural, so this file needs no SDK import. */
interface MemberEvent {
  groupInfo?: {
    groupId?: number;
    groupProfile?: { displayName?: string };
    localDisplayName?: string;
  };
  member?: {
    groupMemberId?: number;
    memberId?: string;
    memberCategory?: string;
    memberContactId?: number;
    memberProfile?: { displayName?: string };
    localDisplayName?: string;
  };
}

/** One bot's event source, narrowed to what this needs. */
export interface GreetableBot {
  botProfileId: number;
  on: (event: string, handler: (ev: MemberEvent) => void) => void;
}

export interface WelcomeTriggerDeps {
  db: Queryable;
  /** Resolved per arrival, never cached: the operator may edit the text between joins. */
  settingsFor: (botProfileId: number) => Promise<WelcomeSettings>;
}

/** Which events can announce an arrival. Both, for the reason in the header. */
const ARRIVAL_EVENTS = ['joinedGroupMember', 'connectedToGroupMember'] as const;

export function watchArrivals(bots: readonly GreetableBot[], deps: WelcomeTriggerDeps): void {
  for (const bot of bots) {
    for (const kind of ARRIVAL_EVENTS) {
      bot.on(kind, (ev) => {
        void (async () => {
          const groupId = ev.groupInfo?.groupId;
          const memberId = ev.member?.memberId;
          const groupMemberId = ev.member?.groupMemberId;
          // Nothing to key on, nothing to address: not an error, just not an arrival we can
          // act on. Debug rather than warn - a malformed event is the core's business.
          if (groupId === undefined || memberId === undefined || groupMemberId === undefined) {
            log.debug('welcome: an arrival event carried no usable identity', { event: kind });
            return;
          }
          const arrival: ArrivalEvent = {
            botProfileId: bot.botProfileId,
            groupId,
            groupName:
              ev.groupInfo?.groupProfile?.displayName ??
              ev.groupInfo?.localDisplayName ??
              `group ${String(groupId)}`,
            memberId,
            groupMemberId,
            memberName:
              ev.member?.memberProfile?.displayName ?? ev.member?.localDisplayName ?? 'there',
            memberCategory: ev.member?.memberCategory,
            ...(ev.member?.memberContactId === undefined
              ? {}
              : { memberContactId: ev.member.memberContactId }),
          };
          try {
            const settings = await deps.settingsFor(bot.botProfileId);
            await greetArrival(deps.db, settings, arrival);
          } catch (err) {
            // A greeting must never take down the event handler that also drives capture.
            log.error('welcome: greeting an arrival failed', {
              botProfileId: bot.botProfileId,
              groupId,
              error: err instanceof Error ? err.message : String(err),
            });
          }
        })();
      });
    }
  }
}
