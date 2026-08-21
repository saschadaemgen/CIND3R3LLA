/**
 * Conversation state for the interaction layer (CCB-S3-002 §2, §4.5, §6).
 *
 * Deliberately in-process and deliberately forgetful. Everything here is
 * short-lived UI state — who she is mid-sentence with, which retort she used
 * last, how much she has said recently — and none of it is a consent record.
 * Consent lives in PostgreSQL; losing this map across a restart costs a member
 * one repeated wake word, which is the correct trade for not persisting a
 * conversational side-channel about who spoke to the bot and when.
 *
 * Three mechanisms live here:
 *
 *  - the **follow-up window** (§2), which is what turns commands into
 *    conversation: after she replies, that member may keep talking without
 *    repeating her name;
 *  - the **reply rate limit** (§4.5), per member and per chat, so the group
 *    cannot be flooded through her;
 *  - the **retort rotation and anti-spam counter** (§6), so she never repeats a
 *    nickname retort back-to-back in a chat and goes quiet if someone is just
 *    poking her.
 */

import type { Intent } from './intent.js';

/**
 * What kind of answer an open offer is waiting for (CCB-S3-013).
 *
 *   `consent`       — the original yes/no on publish or unpublish.
 *   `revokeChoice`  — hide or delete, after a revocation. There is NO default:
 *                     a bare affirmation answers nothing here, because "yes" to
 *                     "hide or delete?" does not name a choice.
 *   `deleteConfirm` — the destructive confirmation. Accepts ONLY the literal
 *                     word, never an affirmation.
 *
 * The kind is carried on the offer rather than inferred at the answer site, so
 * the acceptance rule travels with the question that asked it.
 */
export type PendingKind = 'consent' | 'revokeChoice' | 'deleteConfirm' | 'restoreConfirm';

/** A consent change she has proposed and is waiting to hear an answer about. */
export interface PendingConfirmation {
  kind: PendingKind;
  intent: Extract<Intent, 'PUBLISH' | 'UNPUBLISH'>;
  /** Language the request came in — the answer follows it. */
  lang: string;
  /** Epoch ms after which the offer lapses (tracks the follow-up window). */
  expiresAt: number;
}

/** An asset choice she has offered and is waiting for an answer to (§1). */
export interface PendingChoice {
  symbol: string;
  options: {
    id: string;
    symbol: string;
    name: string;
    chain?: string;
    contract?: string;
    provider: string;
  }[];
  expiresAt: number;
}

interface MemberEntry {
  followUpUntil: number;
  /** Language detected for this member, kept for the follow-up window (§6). */
  lang: string | undefined;
  /** Last READ-ONLY intent this member used, for elliptical follow-ups (§7c). */
  lastIntent: string | undefined;
  pending: PendingConfirmation | undefined;
  choice: PendingChoice | undefined;
  /** Consecutive nickname addresses; resets on a proper address or after a rest. */
  nicknameStreak: number;
  lastNicknameAt: number;
  /** Epoch ms of recent replies to this member (for the per-member limit). */
  replies: number[];
  /** Epoch ms of recent price questions (a separate, scarcer budget). */
  priceCalls: number[];
  /** Epoch ms of recent recitals (CCB-S4-047), scarcer still. */
  recitals: number[];
  /** When she last gave this member a rules OVERVIEW (CCB-S4-049). */
  lastOverviewAt: number | undefined;
  /**
   * When she last performed the Book SCENE for this member (CCB-S5-005).
   *
   * Separate from the overview's, and deliberately so: the two windows admit different
   * messages. See `asksForAnotherLaw` for why a scene's invitation is the narrower offer.
   */
  lastSceneAt: number | undefined;
}

interface ChatEntry {
  /** Index of the last retort used here, so the next one differs. */
  lastRetort: number;
  /**
   * The last law the Book showed here, by page (CCB-S5-005).
   *
   * Written by the scene and by every page turn after it, so "tell me another" moves forward
   * through the book instead of handing back the same page.
   *
   * Per CHAT rather than per member, because a scene is a performance in a room: two people
   * asking one after another are in the same room and would both hear the same law. Losing it
   * on a restart is fine and is the honest degradation, since the rotation starts at the
   * ceiling, which is where it should start anyway.
   */
  lastLawShownId: string | undefined;
  replies: number[];
  priceCalls: number[];
  recitals: number[];
}

/**
 * How long after an overview a bare question is still an answer to it (CCB-S4-049).
 *
 * ── WHY THREE MINUTES, AND WHY A WINDOW AT ALL ───────────────────────────────
 *
 * The overview ends by naming the chapters and asking what part interests you. A member who
 * answers that question in her own words was not going to say "rules", and until this existed
 * they got a nice paragraph instead of the law.
 *
 * The window is deliberately SHORT. Over-detection is the worse failure here and it is worse
 * because it is constant rather than occasional: ordinary conversation answered with quoted
 * statutes would be wrong every time, where a missed follow-up is wrong once and costs a
 * clarifying question. Three minutes is long enough to read six chapter names and decide
 * which one you want, and short enough that a conversation which has moved on has moved on.
 *
 * It is per MEMBER and per CHAT, because the invitation was to one person. Somebody else
 * asking an unrelated question in the same group ninety seconds later is not answering it.
 */
const OVERVIEW_WINDOW_MS = 3 * 60 * 1000;

/**
 * How often the Book may be read out (CCB-S4-047).
 *
 * In code rather than on the console, like the history clamp and for the same reason: this is
 * the number standing between a question and a group full of messages, and the operator
 * already has the knob that decides how LONG a reading is. Worst case at the maximum message
 * bound is two readings of twelve, and only when two different members ask inside one minute.
 */
const RECITALS_PER_MEMBER = 1;
const RECITALS_PER_CHAT = 2;

/** A nickname streak this old is forgiven — she is petty, not unforgiving. */
const NICKNAME_STREAK_RESET_MS = 10 * 60 * 1000;

/** Window the reply rate limits are measured over. */
const RATE_WINDOW_MS = 60 * 1000;

/** Entries untouched for this long are dropped by {@link ConversationState.prune}. */
const IDLE_EVICT_MS = 60 * 60 * 1000;

function trim(times: number[], now: number): number[] {
  const cutoff = now - RATE_WINDOW_MS;
  return times.filter((t) => t > cutoff);
}

/**
 * How long a member needs to READ a reply, before the clock on answering it starts
 * (CCB-S5-057, D-250).
 *
 * ── THE DEFECT A MEMBER FOUND HIMSELF ───────────────────────────────────────
 *
 * The help says: once we are talking you can follow up for a moment without repeating my
 * name. The window is 60 seconds and it opens when SHE SENDS. That is fine for an ordinary
 * reply, which arrives in about four seconds and is two sentences long - the member is
 * already reading it as it lands and answers inside the minute.
 *
 * It is not fine for a lookup, which is where he hit it. That lane announces, then searches,
 * then writes the longest thing she sends. The member's own clock does not start when she
 * sends; it starts when they have finished READING. So the lane's own latency and its own
 * length eat the window from both ends, and a bare follow-up is then refused at the address
 * gate - before dispatch, before the model, with no near-miss and no conversation row. The
 * member has to retype her name and nothing anywhere records that they tried.
 *
 * ── WHY THIS IS NOT ANOTHER MUSIC-SHAPED SPECIAL CASE ───────────────────────
 *
 * CCB-S5-048 widened the door for a live music card, bounded by the card's own expiry. That
 * was right and it was narrow: the same reasoning applies to anything long she sends, and
 * the lookup lane proved it by breaking in exactly the way the music lane had. So this is
 * not a second special case, it is the general form of the first one - the door stays open
 * as long as what she put in front of you takes to deal with.
 *
 * ── THE NUMBER, AND WHERE IT COMES FROM ─────────────────────────────────────
 *
 * 15 characters a second, which is roughly 180 words a minute: ordinary adult reading of
 * unfamiliar prose, at the slow end of the usual range because a member is reading in a chat
 * client on a phone, often mid-conversation, and the cost of being slightly generous is one
 * extra bare line treated as addressed while the cost of being tight is the defect above.
 *
 * It is an allowance ON TOP of the operator's own `followUpSeconds`, never a replacement:
 * his setting still says how long a member has to ANSWER, and this says how long they had
 * their head down first. A two-sentence reply adds about seven seconds and a full-budget
 * lookup answer adds about ninety, which is the difference the lane needed.
 */
const READING_CHARS_PER_SECOND = 15;

/** The reading allowance for one reply, in milliseconds. Pure, so a check can pin it. */
export function readingAllowanceMs(text: string): number {
  return Math.round((text.length / READING_CHARS_PER_SECOND) * 1000);
}
export class ConversationState {
  private readonly members = new Map<string, MemberEntry>();
  private readonly chats = new Map<number, ChatEntry>();
  private lastPruneAt = 0;

  /**
   * Her recent MODEL-WORDED replies, per room, for the repetition gate (D-253).
   *
   * Only text the model wrote enters this: the deterministic templates repeat by design
   * and must never be witnesses against themselves. In memory on purpose - a restart
   * forgets it, which costs at most one repeat after a deploy, and the alternative is a
   * database read on every conversational reply for a window of five strings.
   */
  private readonly modelReplies = new Map<number, string[]>();

  noteModelReply(groupId: number, text: string, window: number): void {
    const list = this.modelReplies.get(groupId) ?? [];
    list.push(text);
    if (list.length > window) list.splice(0, list.length - window);
    this.modelReplies.set(groupId, list);
  }

  recentModelReplies(groupId: number): readonly string[] {
    return this.modelReplies.get(groupId) ?? [];
  }

  private static key(groupId: number, memberId: string): string {
    return `${groupId}:${memberId}`;
  }

  private member(groupId: number, memberId: string): MemberEntry {
    const key = ConversationState.key(groupId, memberId);
    let entry = this.members.get(key);
    if (!entry) {
      entry = {
        followUpUntil: 0,
        lang: undefined,
        lastIntent: undefined,
        pending: undefined,
        choice: undefined,
        nicknameStreak: 0,
        lastNicknameAt: 0,
        replies: [],
        priceCalls: [],
        recitals: [],
        lastOverviewAt: undefined,
        lastSceneAt: undefined,
      };
      this.members.set(key, entry);
    }
    return entry;
  }

  private chat(groupId: number): ChatEntry {
    let entry = this.chats.get(groupId);
    if (!entry) {
      entry = {
        lastRetort: -1,
        lastLawShownId: undefined,
        replies: [],
        priceCalls: [],
        recitals: [],
      };
      this.chats.set(groupId, entry);
    }
    return entry;
  }

  /* ── Follow-up window (§2) ─────────────────────────────────────────────── */

  /** Is this member mid-conversation with her in this chat? */
  inFollowUp(groupId: number, memberId: string, now: number): boolean {
    const key = ConversationState.key(groupId, memberId);
    const entry = this.members.get(key);
    return entry !== undefined && entry.followUpUntil > now;
  }

  /** Opens or refreshes the window. Called whenever she replies to a member. */
  openFollowUp(groupId: number, memberId: string, now: number, windowMs: number): void {
    if (windowMs <= 0) return;
    this.member(groupId, memberId).followUpUntil = now + windowMs;
  }

  /**
   * Remembers the language an exchange is being held in (§6), so a bare `yes`
   * that carries no linguistic signal of its own is answered in the language of
   * the conversation it belongs to rather than the instance default.
   */
  rememberLanguage(groupId: number, memberId: string, lang: string): void {
    this.member(groupId, memberId).lang = lang;
  }

  /** The remembered language, but only while the follow-up window is still open. */
  rememberedLanguage(groupId: number, memberId: string, now: number): string | undefined {
    const entry = this.members.get(ConversationState.key(groupId, memberId));
    if (!entry || entry.followUpUntil <= now) return undefined;
    return entry.lang;
  }

  /**
   * Remembers the last READ-ONLY intent, so `monero?` after a price answer can
   * inherit it. Consent intents are deliberately never stored: carry-over must
   * not be able to produce one.
   */
  rememberIntent(groupId: number, memberId: string, intent: string): void {
    this.member(groupId, memberId).lastIntent = intent;
  }

  /** The remembered intent, but only while the follow-up window is still open. */
  rememberedIntent(groupId: number, memberId: string, now: number): string | undefined {
    const entry = this.members.get(ConversationState.key(groupId, memberId));
    if (!entry || entry.followUpUntil <= now) return undefined;
    return entry.lastIntent;
  }

  closeFollowUp(groupId: number, memberId: string): void {
    const entry = this.members.get(ConversationState.key(groupId, memberId));
    if (entry) entry.followUpUntil = 0;
  }

  /* ── Pending consent confirmations (§4.1) ──────────────────────────────── */

  getPending(groupId: number, memberId: string, now: number): PendingConfirmation | undefined {
    const entry = this.members.get(ConversationState.key(groupId, memberId));
    if (!entry?.pending) return undefined;
    if (entry.pending.expiresAt <= now) {
      entry.pending = undefined;
      return undefined;
    }
    return entry.pending;
  }

  setPending(groupId: number, memberId: string, pending: PendingConfirmation): void {
    this.member(groupId, memberId).pending = pending;
  }

  clearPending(groupId: number, memberId: string): void {
    const entry = this.members.get(ConversationState.key(groupId, memberId));
    if (entry) entry.pending = undefined;
  }

  /* ── Pending asset disambiguation (CCB-S3-004 §1) ──────────────────────── */

  getPendingChoice(groupId: number, memberId: string, now: number): PendingChoice | undefined {
    const entry = this.members.get(ConversationState.key(groupId, memberId));
    if (!entry?.choice) return undefined;
    if (entry.choice.expiresAt <= now) {
      entry.choice = undefined;
      return undefined;
    }
    return entry.choice;
  }

  setPendingChoice(groupId: number, memberId: string, choice: PendingChoice): void {
    this.member(groupId, memberId).choice = choice;
  }

  clearPendingChoice(groupId: number, memberId: string): void {
    const entry = this.members.get(ConversationState.key(groupId, memberId));
    if (entry) entry.choice = undefined;
  }

  /* ── Nicknames (§6) ────────────────────────────────────────────────────── */

  /**
   * Records a nickname address and reports whether she should answer. After
   * `spamLimit` in a row she stays silent rather than feeding the game.
   */
  noteNickname(groupId: number, memberId: string, now: number, spamLimit: number): boolean {
    const entry = this.member(groupId, memberId);
    if (now - entry.lastNicknameAt > NICKNAME_STREAK_RESET_MS) entry.nicknameStreak = 0;
    entry.lastNicknameAt = now;
    entry.nicknameStreak += 1;
    return entry.nicknameStreak <= spamLimit;
  }

  /** Called when the member gets her name right — the slate is wiped. */
  resetNicknameStreak(groupId: number, memberId: string): void {
    const entry = this.members.get(ConversationState.key(groupId, memberId));
    if (entry) entry.nicknameStreak = 0;
  }

  nicknameStreak(groupId: number, memberId: string): number {
    return this.members.get(ConversationState.key(groupId, memberId))?.nicknameStreak ?? 0;
  }

  /**
   * Picks a retort index for this chat, never repeating the previous one.
   * `random` is injected so the harness can assert the no-repeat property
   * without depending on luck.
   */
  pickRetort(groupId: number, count: number, random: () => number): number {
    if (count <= 0) return -1;
    const entry = this.chat(groupId);
    if (count === 1) {
      entry.lastRetort = 0;
      return 0;
    }
    // Draw from the count-1 indices that are not the previous one, then shift
    // past it — a uniform pick with the repeat structurally excluded.
    const draw = Math.min(count - 2, Math.floor(random() * (count - 1)));
    const index = entry.lastRetort >= 0 && draw >= entry.lastRetort ? draw + 1 : draw;
    entry.lastRetort = index;
    return index;
  }

  /* ── Reply rate limits (§4.5) ──────────────────────────────────────────── */

  /**
   * Consumes one reply allowance. Returns false when either the member's or the
   * chat's budget for the last minute is spent, in which case she stays silent.
   */
  allowReply(
    groupId: number,
    memberId: string,
    now: number,
    perMember: number,
    perChat: number,
  ): boolean {
    const m = this.member(groupId, memberId);
    const c = this.chat(groupId);
    m.replies = trim(m.replies, now);
    c.replies = trim(c.replies, now);
    if (m.replies.length >= perMember || c.replies.length >= perChat) return false;
    m.replies.push(now);
    c.replies.push(now);
    return true;
  }

  /**
   * Would a reply be allowed right now, WITHOUT consuming anything (CCB-S5-025)?
   *
   * Exists for the lookup holding line, which is not a reply: it carries no information and
   * must never be the message that pushes the real answer over the limit. So it asks first,
   * and is sent uncounted, which leaves the answer holding the allowance it needs.
   *
   * This is also what bounds it. A holding line that neither checks nor counts would be an
   * unbounded outbound on the archive and knowledge paths, which have no equivalent of the
   * web search budget behind them. Asking here means a member who is over their limit gets
   * no announcement AND no answer, rather than an unbounded stream of announcements for
   * answers the limiter is dropping.
   */
  wouldAllowReply(
    groupId: number,
    memberId: string,
    now: number,
    perMember: number,
    perChat: number,
  ): boolean {
    const m = this.member(groupId, memberId);
    const c = this.chat(groupId);
    m.replies = trim(m.replies, now);
    c.replies = trim(c.replies, now);
    return m.replies.length < perMember && c.replies.length < perChat;
  }

  /**
   * Takes `count` reply allowances at once, or takes NONE (CCB-S4-047).
   *
   * All-or-nothing, and that is the whole point. A recital is several messages and it must
   * not be able to start unless every one of them fits: a reading that stops in the middle
   * because the allowance ran out is exactly the silence the never-silent rule forbids, and
   * it would arrive as a bug an operator could only diagnose by counting messages.
   */
  /** Records that this member has just been given the overview. */
  noteOverview(groupId: number, memberId: string, now: number): void {
    this.member(groupId, memberId).lastOverviewAt = now;
  }

  /**
   * Is this member still inside the window the overview opened?
   *
   * Read-only: it does not extend the window. A member who keeps asking gets each answer, and
   * the window still closes three minutes after the OVERVIEW rather than three minutes after
   * the last thing they said, so a long conversation cannot drift into the Book one question
   * at a time.
   */
  inOverviewWindow(groupId: number, memberId: string, now: number): boolean {
    const at = this.member(groupId, memberId).lastOverviewAt;
    return at !== undefined && now - at <= OVERVIEW_WINDOW_MS;
  }

  /** Records that this member has just been shown the Book scene (CCB-S5-005). */
  noteScene(groupId: number, memberId: string, now: number): void {
    this.member(groupId, memberId).lastSceneAt = now;
  }

  /**
   * Is this member still inside the window the scene opened?
   *
   * Same three minutes as the overview's, and the same read-only shape. What differs is what
   * the caller is allowed to promote inside it: a scene's invitation is narrower than an
   * overview's, so only a message asking for another page counts. See `asksForAnotherLaw`.
   */
  inSceneWindow(groupId: number, memberId: string, now: number): boolean {
    const at = this.member(groupId, memberId).lastSceneAt;
    return at !== undefined && now - at <= OVERVIEW_WINDOW_MS;
  }

  /** The last law shown in this chat, so the next one is a different page. */
  lastLawShown(groupId: number): string | null {
    return this.chat(groupId).lastLawShownId ?? null;
  }

  noteLawShown(groupId: number, lawId: string): void {
    this.chat(groupId).lastLawShownId = lawId;
  }

  allowRecital(groupId: number, memberId: string, now: number): boolean {
    const m = this.member(groupId, memberId);
    const c = this.chat(groupId);
    m.recitals = trim(m.recitals, now);
    c.recitals = trim(c.recitals, now);
    if (m.recitals.length >= RECITALS_PER_MEMBER || c.recitals.length >= RECITALS_PER_CHAT) {
      return false;
    }
    m.recitals.push(now);
    c.recitals.push(now);
    // One reply allowance as well, because a recital IS her speaking and a single counter of
    // "she said something" that a performance does not appear in would be a lie to the next
    // thing that reads it.
    m.replies = trim(m.replies, now);
    c.replies = trim(c.replies, now);
    m.replies.push(now);
    c.replies.push(now);
    return true;
  }

  /**
   * Consumes one PRICE allowance (CCB-S3-004 §3). Kept separate from the reply
   * limiter because a price question costs an outbound HTTP call to a throttled
   * third party, not just a message — the two budgets protect different things.
   */
  allowPrice(
    groupId: number,
    memberId: string,
    now: number,
    perMember: number,
    perChat: number,
  ): boolean {
    const m = this.member(groupId, memberId);
    const c = this.chat(groupId);
    m.priceCalls = trim(m.priceCalls, now);
    c.priceCalls = trim(c.priceCalls, now);
    if (m.priceCalls.length >= perMember || c.priceCalls.length >= perChat) return false;
    m.priceCalls.push(now);
    c.priceCalls.push(now);
    return true;
  }

  /** Records a reply that bypassed the limiter, so it still counts toward it. */
  noteReply(groupId: number, memberId: string, now: number): void {
    const m = this.member(groupId, memberId);
    const c = this.chat(groupId);
    m.replies = trim(m.replies, now);
    c.replies = trim(c.replies, now);
    m.replies.push(now);
    c.replies.push(now);
  }

  /* ── Housekeeping ──────────────────────────────────────────────────────── */

  /** Drops entries nobody has touched for an hour. Cheap; called opportunistically. */
  prune(now: number): void {
    if (now - this.lastPruneAt < 5 * 60 * 1000) return;
    this.lastPruneAt = now;
    for (const [key, entry] of this.members) {
      const lastActivity = Math.max(
        entry.followUpUntil,
        entry.lastNicknameAt,
        entry.pending?.expiresAt ?? 0,
        entry.replies[entry.replies.length - 1] ?? 0,
      );
      if (now - lastActivity > IDLE_EVICT_MS) this.members.delete(key);
    }
    for (const [id, entry] of this.chats) {
      const lastActivity = entry.replies[entry.replies.length - 1] ?? 0;
      if (now - lastActivity > IDLE_EVICT_MS) this.chats.delete(id);
    }
  }
}
