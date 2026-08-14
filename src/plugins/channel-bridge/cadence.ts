/**
 * The cadence model: when the bridge speaks, what it says, and what it owes a
 * record for (CCB-S5-032, D-187).
 *
 * PURE. No database, no transport, no clock of its own: the service hands in the
 * mapping, the unresolved posts and the time, and gets back a plan. Every decision
 * the briefing asked to be reported lives HERE, where a check can drive it, rather
 * than spread across the service and the store.
 *
 * ── THE OPERATOR'S MODEL, AND THE DECISIONS TAKEN ON IT ──────────────────────
 *
 * The bridge does not mirror. A channel post becomes a standing announcement the
 * bot brings into the group on a rhythm, so members who were not looking still see
 * it. His example: repeat it once an hour, or every thirty chat messages,
 * whichever he sets. Four decisions were open and are taken as follows.
 *
 * WHEN TO POST: interval or message count, WHICHEVER COMES FIRST. His phrasing
 * suggested it, and it is also the only composition that keeps both settings
 * meaningful: whichever-comes-last makes the smaller of the two a dead control,
 * because the larger one always decides. Due-ness is measured from the LAST SEND
 * (or the mapping's creation), not from fixed clock boundaries, so a group that
 * has been quiet for hours hears a fresh post on the next sweep rather than
 * waiting out a full interval that already elapsed.
 *
 * HOW FAR BACK: `maxAgeHours` per mapping. This morning's post is news; last
 * month's is noise. The age limit applies to REPEATS as well as first
 * announcements, so a post cannot be new enough to start and then go on being
 * repeated into staleness.
 *
 * WHAT STOPS A POST: any of three things. Its repeats are exhausted
 * (`maxRepeats`), it aged out, or the operator dismissed it from the console.
 * Newer posts do NOT kill older ones; they take the featured slot and the older
 * ones ride along in the digest, because a busy channel would otherwise starve
 * every post of its repeats and "superseded" would become the common silent end.
 *
 * SEVERAL PENDING: A DIGEST, one message per tick. All-of-them separately is the
 * flood the cadence exists to prevent; newest-only silently drops the rest, which
 * is the one thing the briefing forbids. The newest post is rendered in FULL
 * (news value), up to {@link DIGEST_SUMMARY_CAP} older ones follow as one-line
 * excerpts OLDEST FIRST so nothing starves, and anything beyond that is COUNTED
 * in a stated remainder line. A post that only ever appeared in the remainder
 * count has not been announced: the count names its existence, not its content,
 * so it stays pending and does not spend a repeat.
 *
 * THE QUIET CASE: a due tick with nothing pending sends nothing and records
 * nothing. Quiet is not suppression; a cadence that fires on an empty channel is
 * a bot talking to itself, which is the briefing's own words.
 *
 * ── WHAT A SUPPRESSION IS, EXACTLY ───────────────────────────────────────────
 *
 * A post is SUPPRESSED when it stops without ever having been announced: aged out
 * at zero repeats, dismissed at zero repeats, or refused by the loop guard. A post
 * that was announced at least once and then stopped has COMPLETED, which is the
 * feature working. The distinction is load-bearing because the briefing's bar is
 * "never suppress a post silently": every resolution this planner emits says
 * whether it is a suppression, and the store writes the record the console shows.
 * `verify:bridge` proves a suppression cannot happen without one.
 */

/** How many older posts a digest names beneath the featured one. */
export const DIGEST_SUMMARY_CAP = 4;

/**
 * How much of a summarized post the digest shows. An excerpt, not the post: the
 * full text gets its turn when the post reaches the featured slot.
 */
export const DIGEST_EXCERPT_CHARS = 120;

/**
 * Defaults, from the operator's own example: "once an hour, or every thirty chat
 * messages". A day of news value, three announcements per post.
 */
export const DEFAULT_INTERVAL_MINUTES = 60;
export const DEFAULT_MESSAGE_COUNT = 30;
export const DEFAULT_MAX_AGE_HOURS = 24;
export const DEFAULT_MAX_REPEATS = 3;

export interface BridgeCadence {
  /** Minutes between announcements. Null means the interval trigger is off. */
  intervalMinutes: number | null;
  /** Member messages in the destination since the last send. Null means off. */
  messageCount: number | null;
  /** How old a channel post may be and still be worth repeating. */
  maxAgeHours: number;
  /** How many times one post may be announced before it completes. */
  maxRepeats: number;
}

export interface BridgeMappingState extends BridgeCadence {
  /** When this mapping last sent anything, or null if it never has. */
  lastSentAt: Date | null;
  /** The anchor when nothing has been sent yet. */
  createdAt: Date;
}

/** One unresolved channel post, as the planner needs to see it. */
export interface PendingPost {
  id: number;
  sharedMsgId: string;
  text: string;
  postedAt: Date;
  /** Set when the source post was edited; the current text is already the edit. */
  editedAt: Date | null;
  /** How many times this mapping has announced it (featured or summarized). */
  repeatsDone: number;
  /** Set when the operator pressed dismiss on the console. */
  dismissedAt: Date | null;
}

export type PostResolution = 'completed' | 'aged-out' | 'dismissed';

export interface PlannedResolution {
  postId: number;
  resolution: PostResolution;
  /**
   * True when the post ends with ZERO announcements, which is the case the
   * briefing forbids happening silently. The store writes the record; the
   * console shows it.
   */
  suppressed: boolean;
}

export interface DigestPlan {
  /** The newest pending post, rendered in full. */
  full: PendingPost;
  /** Up to {@link DIGEST_SUMMARY_CAP} older ones, OLDEST first, as excerpts. */
  summarized: PendingPost[];
  /**
   * How many pending posts appear only as a count. Stated in the message, so
   * they are named without being shown; they stay pending and spend no repeat.
   */
  remainder: number;
}

export interface TickPlan {
  /** Which trigger fired, or null when the mapping is not due. */
  due: 'interval' | 'count' | null;
  /** What to send, or null for the quiet case. */
  announce: DigestPlan | null;
  /** Posts that stop this tick, each stating whether stopping is a suppression. */
  resolutions: PlannedResolution[];
}

/**
 * Whichever comes first, measured from the last send.
 *
 * Exported on its own because `verify:bridge` proves both orderings: interval
 * elapsed with the count short, and the count reached with the interval short.
 * A mapping with BOTH triggers off is never due, which the store's CHECK
 * constraint makes unrepresentable; the planner still answers it honestly
 * rather than assuming the constraint held.
 */
export function dueBy(
  mapping: BridgeMappingState,
  now: Date,
  memberMessagesSinceLastSend: number,
): 'interval' | 'count' | null {
  const anchor = mapping.lastSentAt ?? mapping.createdAt;
  if (
    mapping.intervalMinutes !== null &&
    now.getTime() - anchor.getTime() >= mapping.intervalMinutes * 60_000
  ) {
    return 'interval';
  }
  if (mapping.messageCount !== null && memberMessagesSinceLastSend >= mapping.messageCount) {
    return 'count';
  }
  return null;
}

function ageHours(post: PendingPost, now: Date): number {
  return (now.getTime() - post.postedAt.getTime()) / 3_600_000;
}

/**
 * One tick's plan for one mapping.
 *
 * The caller passes every UNRESOLVED post for the mapping's source; the planner
 * decides what is announced, what resolves, and what merely waits. It never
 * mutates its inputs and it never invents a post, so the exhaustiveness property
 * the check asserts is decidable: every input post is featured, summarized,
 * counted in the remainder, resolved with a record, or still pending, and
 * nothing else exists.
 */
export function planTick(
  mapping: BridgeMappingState,
  posts: readonly PendingPost[],
  now: Date,
  memberMessagesSinceLastSend: number,
): TickPlan {
  const due = dueBy(mapping, now, memberMessagesSinceLastSend);
  if (due === null) return { due: null, announce: null, resolutions: [] };

  const resolutions: PlannedResolution[] = [];
  const fresh: PendingPost[] = [];

  for (const post of posts) {
    // Dismissal resolves at the tick rather than at the click so there is ONE
    // writer of resolutions. The console records the operator's action in the
    // audit log the moment they act; the post's own record says what it cost.
    if (post.dismissedAt !== null) {
      resolutions.push({
        postId: post.id,
        resolution: 'dismissed',
        suppressed: post.repeatsDone === 0,
      });
      continue;
    }
    if (ageHours(post, now) > mapping.maxAgeHours) {
      // Aged out with announcements behind it is the feature completing; aged
      // out at zero is a post that VANISHED, and that gets a record.
      resolutions.push({
        postId: post.id,
        resolution: 'aged-out',
        suppressed: post.repeatsDone === 0,
      });
      continue;
    }
    fresh.push(post);
  }

  if (fresh.length === 0) {
    // The quiet case: due, and nothing to say. No message, and no record either,
    // because nothing was withheld - there was nothing.
    return { due, announce: null, resolutions };
  }

  // Newest gets the featured slot; the rest ride oldest-first so a busy channel
  // cannot starve its older posts out of ever being shown.
  const byNewest = [...fresh].sort((a, b) => b.postedAt.getTime() - a.postedAt.getTime());
  const full = byNewest[0] as PendingPost;
  const rest = byNewest.slice(1).sort((a, b) => a.postedAt.getTime() - b.postedAt.getTime());
  const summarized = rest.slice(0, DIGEST_SUMMARY_CAP);
  const remainder = rest.length - summarized.length;

  return { due, announce: { full, summarized, remainder }, resolutions };
}

/**
 * What one announcement costs the posts in it: the featured and summarized posts
 * spend a repeat, and any that reach the cap complete. Remainder posts spent
 * nothing, because nothing of theirs was shown.
 *
 * Completion by repeat exhaustion is never a suppression: by construction the
 * post was just announced, so `repeatsDone` is at least one.
 */
export function afterAnnouncement(
  mapping: BridgeCadence,
  plan: DigestPlan,
): { postId: number; repeatsDone: number; completed: boolean }[] {
  return [plan.full, ...plan.summarized].map((post) => {
    const repeatsDone = post.repeatsDone + 1;
    return { postId: post.id, repeatsDone, completed: repeatsDone >= mapping.maxRepeats };
  });
}

/**
 * The rendered announcement, composed from application-written parts.
 *
 * The post text is VERBATIM (D-137, D-180: a fact the model carries inside its
 * own prose is a fact it corrupts, so no model is anywhere near this). The
 * attribution and the remainder line arrive pre-filled from the persona layer,
 * so the operator can reword them and the protected-text guard derives their
 * markers automatically; this function only assembles.
 */
export function renderAnnouncement(
  plan: DigestPlan,
  parts: {
    /** The filled attribution line for one post, e.g. "From <channel>, <time>". */
    attributionFor: (post: PendingPost) => string;
    /** The filled remainder line, e.g. "and N earlier posts in the channel". */
    remainderLine: (n: number) => string;
  },
): string {
  const blocks: string[] = [];
  // ── TRAILING BLANK LINES ARE NOT CONTENT (CCB-S5-042, D-214) ──────────────
  //
  // `trimEnd`, not `trim`, and nothing else. A channel post that ends with a newline - which
  // is most of them, since people press enter - carried those newlines into the caption, and
  // the client rendered them as vertical space. The operator saw an unusually large gap
  // between the caption and the image, and it was ours rather than the client's.
  //
  // This does NOT weaken the verbatim guarantee. Nothing is summarised, reworded or
  // truncated; leading text and every internal line break are untouched. What goes is
  // whitespace after the last visible character, which no reader can see and no writer meant.
  blocks.push(`${plan.full.text.trimEnd()}\n${parts.attributionFor(plan.full)}`);
  for (const post of plan.summarized) {
    const excerpt =
      post.text.length > DIGEST_EXCERPT_CHARS
        ? `${post.text.slice(0, DIGEST_EXCERPT_CHARS - 1)}…`
        : post.text.trimEnd();
    blocks.push(`• ${excerpt}\n  ${parts.attributionFor(post)}`);
  }
  if (plan.remainder > 0) blocks.push(parts.remainderLine(plan.remainder));
  return blocks.join('\n\n');
}
