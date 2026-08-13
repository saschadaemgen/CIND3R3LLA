/**
 * What to say to a new member, and where to try saying it (CCB-S5-041, D-206).
 *
 * PURE. No database, no SDK, no clock. Every guarantee in this plugin that can be decided
 * without the network is decided here, so it is testable against PGlite with no core at all -
 * which matters because the SimpleX core is one of the four things only the host can show
 * (D-178), and none of these rules needs it.
 *
 * ── WHAT THIS DOES NOT DECIDE ───────────────────────────────────────────────
 *
 * Whether a private route EXISTS. That is not knowable from settings: `directMessages` is a
 * `RoleGroupPreference` (allowed from a role upwards, not a flat switch), the bot is an
 * ordinary member under that rule and benefits only from its role, and `memberContactId` may
 * be absent regardless. Reimplementing the role comparison here would mean ordering
 * `observer / author / member / moderator / admin / owner` MYSELF - a vocabulary SimpleX owns
 * and extends, which is the D-201 trap in a new place: a role added later lands outside the
 * comparison and the guard answers wrong, silently.
 *
 * So the core decides. This plans an ATTEMPT, the runner makes it, and {@link afterRefusal}
 * turns whatever came back into the next step. That is why the refusal reasons are an input
 * here rather than something this file computes.
 */

/** Where a greeting may be addressed. */
export type Destination = 'group' | 'support' | 'direct';

/** What to do when a private route turns out to be unavailable. */
export type Fallback = 'group' | 'none';

/**
 * Why nothing was sent. Kept apart because they are different facts about the deployment,
 * and CCB-S3-023 forbids rendering "not configured" and "configured but failing" alike.
 */
export type SuppressionReason =
  /** The capability is off for this bot. */
  | 'disabled'
  /** The operator has not written a greeting for this case. */
  | 'no-text'
  /** This person was greeted already: a rejoin, a reconnect, or a resync. */
  | 'already-greeted'
  /** They were in the room before this bot arrived, so they are not a new member. */
  | 'predates-bot'
  /** No `memberContactId`: no private route EXISTS to this member. */
  | 'no-contact'
  /** `directMessagesProhibited`: the group's rule refuses it for this bot's role. */
  | 'prohibited'
  /** Something else broke. The ONLY one of these that is a fault. */
  | 'send-failed';

/** The only suppression that is a fault, and so the only one that reaches `status.error`. */
export function isFault(reason: SuppressionReason): boolean {
  return reason === 'send-failed';
}

/**
 * Categories that mean "arrived after this bot did".
 *
 * An ALLOW-list, so it FAILS CLOSED (D-201): an unrecognised category is NOT a new arrival
 * and is not greeted. `GroupMemberCategory` is SimpleX's vocabulary, not ours, and the cost of
 * being wrong in the two directions is not symmetric - a missed greeting is a missed
 * pleasantry, while treating `pre` as new means her first act in a 900-member room is 900
 * greetings.
 *
 * `post` is a member who joined AFTER us. `invitee` is somebody this bot itself invited, who
 * is therefore also new to the room and arrived after it. Everything else is excluded and
 * each for its own reason: `pre` was here before us and is the flood; `host` invited us, so
 * they predate us by definition; `user` is the bot itself.
 */
const ARRIVED_AFTER_US: ReadonlySet<string> = new Set(['post', 'invitee']);

/**
 * Did this member arrive after the bot?
 *
 * Read from the event's own `memberCategory` rather than computed from timestamps, because
 * SimpleX already answers it: it introduces a joining bot to the existing members as `pre` and
 * announces later arrivals as `post`. That is the same distinction a clock comparison would be
 * approximating, without the clock, the window, or the resync problem - a replayed connection
 * carries the category it always had.
 */
export function arrivedAfterBot(memberCategory: string | undefined): boolean {
  return memberCategory === undefined ? false : ARRIVED_AFTER_US.has(memberCategory);
}

export interface WelcomeSettings {
  enabled: boolean;
  text: string;
  returningText: string;
  /** Off by default: most operators want one greeting for both cases. */
  separateReturning: boolean;
  destination: Destination;
  fallback: Fallback;
}

export interface GreetingContext {
  memberName: string;
  groupName: string;
  /** They have been in this room before. The member id is stable, so this is a fact. */
  returning: boolean;
  /**
   * They were already here when this bot joined.
   *
   * NOT the same question as {@link GreetingContext.returning}, and the guard the
   * once-constraint cannot provide: `UNIQUE (member_id)` enforces ONCE, not APPROPRIATE. The
   * bot's own join connects it to every existing member at once, so without this a first join
   * into a 900-member room greets 900 people, each exactly once, exactly as specified.
   * A resync replaying connections is the same hazard wearing a different hat.
   */
  predatesBot: boolean;
}

export type GreetingPlan =
  | { kind: 'send'; route: Destination; text: string }
  | { kind: 'suppress'; reason: SuppressionReason };

/**
 * Fill the placeholders the application owns.
 *
 * The model neither writes this text nor sees it (D-137, D-180), so there is no forgery to
 * strip and no completion to guard. That also means this path has NO automatic protection:
 * `containsBlockedLiteral`, which would reject a line carrying the member's own name, has
 * exactly two call sites and both are inside `generateOllamaReply`, reading a field that only
 * exists for a model request. It will never run here - correctly, since it exists because the
 * MODEL invents uses of a member's name, and a greeting using it is the entire point.
 *
 * So this substitution is the only thing between a member's display name and the wire, and it
 * is deliberately DUMB: a single pass over the template, values inserted verbatim, no
 * recursion. A name containing `{{group}}` inserts those characters and cannot cause a second
 * substitution, because the replacement is computed from the template and never rescanned.
 */
export function fillPlaceholders(
  template: string,
  values: { member: string; group: string },
): string {
  return template.replace(/\{\{(member|group)\}\}/g, (_m, key: string) =>
    key === 'member' ? values.member : values.group,
  );
}

/** Which text this member should get, or nothing if the operator has not written one. */
function textFor(settings: WelcomeSettings, ctx: GreetingContext): string | null {
  // The combining switch. OFF means one text serves both, which is the default because most
  // operators want one greeting; ON means a returning member gets the second one INSTEAD.
  const raw =
    settings.separateReturning && ctx.returning ? settings.returningText : settings.text;
  const trimmed = raw.trim();
  return trimmed === '' ? null : trimmed;
}

/**
 * Plan the first attempt.
 *
 * Order matters and is deliberate: the cheapest and most certain refusals come first, so a
 * bot with the capability off never reaches the text, and a member who predates the bot never
 * reaches the once-check. Each returns a DIFFERENT reason, because "nothing was sent" with no
 * explanation is what made the operator read a working control as broken.
 */
export function planGreeting(settings: WelcomeSettings, ctx: GreetingContext): GreetingPlan {
  if (!settings.enabled) return { kind: 'suppress', reason: 'disabled' };
  if (ctx.predatesBot) return { kind: 'suppress', reason: 'predates-bot' };
  const text = textFor(settings, ctx);
  if (text === null) return { kind: 'suppress', reason: 'no-text' };
  return {
    kind: 'send',
    route: settings.destination,
    text: fillPlaceholders(text, { member: ctx.memberName, group: ctx.groupName }),
  };
}

/**
 * What to do when the private route refused.
 *
 * A FAULT IS NEVER ABSORBED INTO A FALLBACK. `no-contact` and `prohibited` are stable states
 * of the deployment - the member has no direct connection, or the group's rule does not permit
 * one for this bot's role - so falling back to the group there is a permanent, sensible answer
 * to a permanent condition. `send-failed` is something breaking, and quietly delivering to the
 * group instead would hide it behind a success (CCB-S3-023). It suppresses and is reported.
 */
export function afterRefusal(
  settings: WelcomeSettings,
  planned: { text: string },
  reason: Extract<SuppressionReason, 'no-contact' | 'prohibited' | 'send-failed'>,
): GreetingPlan {
  if (reason === 'send-failed') return { kind: 'suppress', reason };
  if (settings.fallback === 'none') return { kind: 'suppress', reason };
  return { kind: 'send', route: 'group', text: planned.text };
}
