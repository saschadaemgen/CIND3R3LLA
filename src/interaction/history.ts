/**
 * Conversation history (CCB-S4-044, D-147): the room she is standing in.
 *
 * ── WHAT THIS FIXES ──────────────────────────────────────────────────────────
 *
 * Every reply was written from the current message alone. She asked "what did I just say",
 * repeated herself across three consecutive replies, and told a member *"Vaguely. But I do
 * recall you asking for a story"*, which was invented, because she recalled nothing. Asked to
 * name the strongest counter-argument to her own previous answer she could not, because she
 * could not see it.
 *
 * The data was always there. Every message is captured and stored against a stable
 * `sender_member_id`. This was never a data problem; it was a supply problem.
 *
 * ── THIS FILE IS PURE ────────────────────────────────────────────────────────
 *
 * The SQL lives in `src/db/messages.ts` and the fencing in `ollama-reply.ts`. What is here
 * is the part with the judgement in it: how much of a thread survives three independent
 * limits, and what one line of it looks like. Both are things a check should be able to
 * drive with an array and no database.
 */

/** One remembered line. Deliberately not a `messages` row: this is what the model may see. */
export interface HistoryEntry {
  /** Stable member id. Used for grouping and for nothing the model reads. */
  memberId: string;
  /** Who said it, as they were called at the time. */
  displayName: string;
  /** Her own replies are marked, because following her own thread is half the point. */
  fromBot: boolean;
  sentAt: string;
  text: string;
}

/** What an operator controls, and what the transport enforces. */
export interface HistoryLimits {
  /** How many messages back, at most. */
  maxMessages: number;
  /** How far back in time, at most. */
  windowMinutes: number;
  /** The hard ceiling on the assembled history, in characters. */
  maxChars: number;
}

/**
 * The defaults.
 *
 * ── WHY THESE NUMBERS ────────────────────────────────────────────────────────
 *
 * The model runs an 8192-token context. Her rules and given facts already occupy roughly
 * 2500 of it and her reply may take another 400, so the history has to live comfortably
 * inside what is left with room to spare. 4000 characters is about 1000 to 1400 tokens
 * depending on language, which lands the whole prompt near half the window.
 *
 * 20 messages and 30 minutes are the conversational span the defect was about: following a
 * thread somebody started a few minutes ago, including one started by a different member.
 * Neither number is trying to be a biography; that is explicitly not this briefing.
 */
export const DEFAULT_HISTORY_LIMITS: Readonly<HistoryLimits> = Object.freeze({
  maxMessages: 20,
  windowMinutes: 30,
  maxChars: 4000,
});

/**
 * The bounds the console will not let an operator past.
 *
 * ── WHY THE MAXIMUM IS BOUNDED IN CODE AND NOT LEFT TO CARE ──────────────────
 *
 * The briefing asks whether the maximum a console allows is safe, and says to bound it
 * rather than trusting the operator to be careful. A history that crowds her own rules out
 * of the context is a SAFETY failure, not a performance one: the thing that gets pushed out
 * is the permissiveness ceiling. So the ceiling on `maxChars` is chosen so that the largest
 * prompt the console can produce still leaves the rules intact, and it is enforced by
 * {@link normalizeHistoryLimits} rather than by a warning nobody reads.
 *
 * 8000 characters is roughly 2000 to 2800 tokens. With a ~2500-token rule set and a
 * 400-token reply that is about 5700 of 8192 at worst, which leaves real headroom for a
 * long member message and the search fence on top.
 */
export const MAX_HISTORY_LIMITS: Readonly<HistoryLimits> = Object.freeze({
  maxMessages: 100,
  windowMinutes: 720,
  maxChars: 8000,
});

function clamp(value: unknown, fallback: number, min: number, max: number): number {
  const parsed =
    typeof value === 'number'
      ? value
      : typeof value === 'string'
        ? Number.parseInt(value, 10)
        : Number.NaN;
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, Math.trunc(parsed)));
}

/** Everything a form or a settings row can hand over, made safe and bounded. */
export function normalizeHistoryLimits(raw: Partial<Record<keyof HistoryLimits, unknown>> | null | undefined): HistoryLimits {
  return {
    // 0 disables history entirely, which is a legitimate choice and the way back if this
    // ever misbehaves in the operator's group.
    maxMessages: clamp(raw?.maxMessages, DEFAULT_HISTORY_LIMITS.maxMessages, 0, MAX_HISTORY_LIMITS.maxMessages),
    windowMinutes: clamp(raw?.windowMinutes, DEFAULT_HISTORY_LIMITS.windowMinutes, 0, MAX_HISTORY_LIMITS.windowMinutes),
    maxChars: clamp(raw?.maxChars, DEFAULT_HISTORY_LIMITS.maxChars, 0, MAX_HISTORY_LIMITS.maxChars),
  };
}

/**
 * Who said it, as the model sees it.
 *
 * Her own rows are "You" rather than her name, because the point of including them is that
 * she can follow her OWN thread, and a transcript that named her in the third person invites
 * her to treat her own previous answer as somebody else's claim.
 */
export function speakerOf(entry: HistoryEntry): string {
  return entry.fromBot ? 'You' : entry.displayName;
}

/** One line, as the model sees it. Kept here so the check and the transport agree on it. */
export function renderHistoryEntry(entry: HistoryEntry): string {
  return `${speakerOf(entry)}: ${entry.text}`;
}

/**
 * The entries as the transport takes them, with the fence marker removed.
 *
 * ── WHY THE STRIP IS HERE AND NOT OPTIONAL ───────────────────────────────────
 *
 * A member can type the fence delimiter into a group. If it survived into the prompt, that
 * line could close its own fence early and everything after it would read as if the
 * application were talking. The search service strips its own marker out of results for
 * exactly this reason (CCB-S4-037), and history is the same problem with a member choosing
 * the timing.
 *
 * THE DISPLAY NAME IS STRIPPED TOO, and that is not paranoia: a display name is
 * member-controlled text that the member picks themselves, so it is the easiest field in the
 * product to put a delimiter in. Newlines go with it, because a name containing one could
 * otherwise forge an extra transcript line.
 */
export function toPromptHistory(
  entries: readonly HistoryEntry[],
  fence: string,
): { speaker: string; text: string }[] {
  const clean = (value: string): string =>
    value.split(fence).join(' ').replace(/[\r\n]+/g, ' ').trim();

  return entries.map((entry) => ({
    speaker: clean(speakerOf(entry)),
    text: clean(entry.text),
  }));
}

/**
 * Trim a thread to what the limits allow, oldest dropped first.
 *
 * ── THE THREE LIMITS ARE INDEPENDENT AND THE TIGHTEST WINS ───────────────────
 *
 * The count and the window are the operator's, and they answer different questions: twenty
 * messages is a lot in a busy group and nothing in a quiet one, and thirty minutes is the
 * reverse. The character budget is the transport's and it is not negotiable, because a few
 * long messages can blow the context on their own while satisfying both of the others.
 *
 * ── OLDEST FIRST, AND WHY THAT IS NOT ARBITRARY ──────────────────────────────
 *
 * The most recent lines are the ones a follow-up is about. Dropping the oldest keeps the
 * thread she is actually in and loses the part that had already scrolled away.
 *
 * `entries` arrives OLDEST FIRST and leaves in the same order, because a transcript read
 * backwards is not a transcript.
 */
export function trimHistory(
  entries: readonly HistoryEntry[],
  limits: HistoryLimits,
  now: number,
): HistoryEntry[] {
  if (limits.maxMessages <= 0 || limits.maxChars <= 0) return [];

  const cutoff = limits.windowMinutes > 0 ? now - limits.windowMinutes * 60_000 : null;
  const inWindow = entries.filter((entry) => {
    if (cutoff === null) return false;
    const at = Date.parse(entry.sentAt);
    // An unparseable timestamp is dropped rather than kept: it cannot be shown to be inside
    // the window the operator asked for, and guessing in favour of inclusion is how a
    // window setting stops meaning anything.
    return Number.isFinite(at) && at >= cutoff;
  });

  const byCount = inWindow.slice(-limits.maxMessages);

  // The budget, applied from the newest backwards so the survivors are the recent ones.
  const kept: HistoryEntry[] = [];
  let used = 0;
  for (let i = byCount.length - 1; i >= 0; i--) {
    const entry = byCount[i]!;
    // +1 for the newline that joins it to the next line, so the budget means the size of
    // the block that is actually sent rather than the sum of its parts.
    const cost = renderHistoryEntry(entry).length + 1;
    if (used + cost > limits.maxChars) break;
    used += cost;
    kept.push(entry);
  }

  return kept.reverse();
}

/** The assembled block, as it rides in the user message. Empty when there is nothing. */
export function renderHistory(entries: readonly HistoryEntry[]): string {
  return entries.map(renderHistoryEntry).join('\n');
}

/**
 * What she can honestly say about her own memory.
 *
 * D-140 recorded, in terms, that the "you have no memory of this conversation" instruction
 * becomes a false statement she has been told to make on the day memory is built. This is
 * that day, so it is deleted rather than softened, and this is what replaces it: a true
 * statement of what she can see, so she can answer the question honestly instead of either
 * claiming perfect recall or denying she has any.
 */
export function describeMemory(limits: HistoryLimits, entryCount: number): string {
  if (limits.maxMessages <= 0 || limits.maxChars <= 0 || entryCount === 0) {
    return 'You cannot see anything said before the message in front of you.';
  }
  return (
    `You can see the last ${String(entryCount)} message(s) of this chat, going back at most ` +
    `${String(limits.windowMinutes)} minutes. Anything older than that you cannot see at all.`
  );
}
