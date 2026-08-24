/**
 * What the member-claim guard refused or removed, and what history she was holding. (D-258)
 *
 * ── TWO INSTRUMENTS, ONE FILE, BECAUSE THEY ANSWER ONE QUESTION ──────────────
 *
 * The `forgery-log.ts` shape (CCB-S5-023): a strip is a fallback that hides a fault by
 * design, so it is counted and the count is shown in the admin. Both of these are that.
 *
 * {@link recordMemberClaim} is the strip: a verdict about a member she could not have
 * checked, removed on the way out, with the excerpt kept because a count with no example
 * cannot be judged - an operator reading "6 removed" cannot tell an invented verdict from an
 * over-eager guard eating a legitimate sentence.
 *
 * ── AND THE ONE THAT EXISTS BECAUSE A FAULT COULD NOT BE REPRODUCED ──────────
 *
 * {@link recordMemoryDenial} is different, and it is here because of what happened when the
 * memory denial was investigated. She told the operator she could not recall his last three
 * messages. The law that would have said so is conditioned on `has-no-history` and that
 * condition was verified correct; the history read was verified non-empty for that turn; and
 * eighteen runs against the production model with history supplied, including with the
 * operator's own character and dials, produced ZERO denials. So the live prompt differed
 * from every prompt that could be assembled afterwards, and nothing in the system recorded
 * how.
 *
 * That is the gap this closes. A reply that DENIES seeing the conversation while history was
 * in the prompt is a contradiction the application can detect deterministically, at the
 * moment it happens, with the numbers that explain it: how many entries were handed over,
 * which lane, which bot. The next occurrence is then a log line rather than an
 * archaeological dig, and if the count stays at zero while the operator keeps seeing it, the
 * denial is arriving from somewhere this instrument does not watch, which is itself the
 * answer.
 *
 * It does NOT strip the denial. A wrongly-removed "I cannot see that" would replace an
 * honest answer with a claim of memory she may not have, which is the worse of the two
 * errors (D-140: the two ways of being wrong here are claiming perfect recall and denying
 * she has any). It records, and the operator decides.
 */
import { log } from '../log.js';
import { status } from '../web/status.js';
import type { RemovedClaim } from './member-claims.js';

export interface MemberClaimEvent {
  at: number;
  botProfileId: number | null;
  /** 'refused' when the request was turned down, 'stripped' when a written claim was cut. */
  action: 'refused-override' | 'refused-authority' | 'stripped' | 'replaced';
  reason: RemovedClaim['reason'] | 'set-aside-request';
  /** Her own words, bounded. Never a member's message. */
  text: string;
}

export interface MemoryDenialEvent {
  at: number;
  botProfileId: number | null;
  /** How many history entries the prompt actually carried. */
  handed: number;
  /** The window in minutes, so a denial with one entry reads differently from one with twenty. */
  windowMinutes: number;
  /** Her own words, bounded. */
  text: string;
}

const LIMIT = 50;
const MAX_EXCERPT = 200;

const claims: MemberClaimEvent[] = [];
let claimTotal = 0;
const denials: MemoryDenialEvent[] = [];
let denialTotal = 0;

export function recordMemberClaim(entry: Omit<MemberClaimEvent, 'at'> & { at: number }): void {
  claimTotal += 1;
  claims.unshift({ ...entry, text: entry.text.slice(0, MAX_EXCERPT) });
  if (claims.length > LIMIT) claims.length = LIMIT;
  log.info('Interaction: a claim about a member was refused or removed', {
    action: entry.action,
    reason: entry.reason,
    botProfileId: entry.botProfileId,
    excerpt: entry.text.slice(0, 100),
  });
}

export function recentMemberClaims(limit = LIMIT): MemberClaimEvent[] {
  return claims.slice(0, limit);
}

/** Since boot, and NOT the buffer length: the buffer is capped and this is not. */
export function memberClaimCount(): number {
  return claimTotal;
}

/**
 * She said she could not see the conversation, while the conversation was in her prompt.
 *
 * `status.error` as well as the log, because this is the consent-and-honesty path losing a
 * guarantee: a member asking what they just said is being told the archive forgot them, and
 * a log file nobody opens is how the first one went unexplained for a week (CCB-S3-023).
 */
export function recordMemoryDenial(entry: Omit<MemoryDenialEvent, 'at'> & { at: number }): void {
  denialTotal += 1;
  denials.unshift({ ...entry, text: entry.text.slice(0, MAX_EXCERPT) });
  if (denials.length > LIMIT) denials.length = LIMIT;
  log.warn('Interaction: she denied seeing the chat while history was in her prompt', {
    handed: entry.handed,
    windowMinutes: entry.windowMinutes,
    botProfileId: entry.botProfileId,
    excerpt: entry.text.slice(0, 100),
  });
  status.error(
    `Interaction: a reply denied seeing the conversation while ${String(entry.handed)} history ` +
      `entries were in the prompt. See Interaction, Diagnostics.`,
  );
}

export function recentMemoryDenials(limit = LIMIT): MemoryDenialEvent[] {
  return denials.slice(0, limit);
}

export function memoryDenialCount(): number {
  return denialTotal;
}

/** Test hook - the harness asserts on a clean buffer. */
export function clearMemberClaims(): void {
  claims.length = 0;
  claimTotal = 0;
  denials.length = 0;
  denialTotal = 0;
}
