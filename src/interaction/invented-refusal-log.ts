/**
 * Sentences removed because they refused a capability the bot holds (D-226).
 *
 * The third log of this shape, beside `forgery-log.ts` (the source lines the
 * application writes and she may not) and `blocked-name-log.ts` (the member's own
 * name). Same reasoning, stated once there and not repeated: a guard that quietly
 * rewrites her words is a fallback that hides a fault by design, and CCB-S3-023's
 * answer is to count it where the operator can see it, with the matched material,
 * because a bare number cannot be judged. What is kept is HER OUTPUT only.
 *
 * IN MEMORY ONLY, capped, gone on restart. Diagnostics, not a record.
 */

import type { ClaimableAbility } from './capability-claims.js';

export interface InventedRefusalEvent {
  /** Epoch ms. */
  at: number;
  botProfileId: number | null;
  /** Which lane she was speaking in. */
  kind: string;
  /** The capability she falsely refused. The most useful field on the card. */
  ability: ClaimableAbility;
  /**
   * What it cost the member. `stripped` means the rest of the reply shipped without
   * the lying sentence, which is the cheap case and the reason the guard strips
   * rather than rejects. `draft` and `silence` mean the strip left nothing and the
   * caller fell back, exactly as the name guard's costs are recorded.
   */
  cost: 'stripped' | 'draft' | 'silence';
  /** The sentence that was removed. Bounded. */
  text: string;
}

const LIMIT = 50;
const MAX_EXCERPT = 240;

const buffer: InventedRefusalEvent[] = [];
let total = 0;

export function recordInventedRefusal(entry: InventedRefusalEvent): void {
  total += 1;
  buffer.unshift({ ...entry, text: entry.text.slice(0, MAX_EXCERPT) });
  if (buffer.length > LIMIT) buffer.length = LIMIT;
}

/** Most recent first. */
export function recentInventedRefusals(limit = LIMIT): InventedRefusalEvent[] {
  return buffer.slice(0, limit);
}

/** Since boot; the buffer is capped and this is not. */
export function inventedRefusalCount(): number {
  return total;
}

/** Test hook - the harness asserts on a clean buffer. */
export function clearInventedRefusals(): void {
  buffer.length = 0;
  total = 0;
}
