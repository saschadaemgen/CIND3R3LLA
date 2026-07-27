/**
 * Consent table operations. Consent binds to the STABLE group member id, never
 * the display name (briefing §9). All functions take a `Queryable`.
 */

import type { Queryable } from './pool.js';

/**
 * What a member chose when they revoked (CCB-S3-013).
 *
 * `pending` is the state between "she asked hide or delete" and "they answered".
 * A destructive choice must be chosen, never inherited, so there is no default:
 * `pending` reads as hidden everywhere and authorises nothing.
 */
export type RevocationMode = 'pending' | 'hide' | 'delete';

export interface ConsentRecord {
  memberId: string;
  optedInAt: string;
  revokedAt: string | null;
  revocationMode: RevocationMode | null;
}

/**
 * Records opt-in for a member. Idempotent: a repeat /publish (or a re-opt-in
 * after revocation) sets a fresh opt-in timestamp and clears any revocation, so
 * publishing stays forward-only from the latest opt-in.
 *
 * @param at - the /publish command's group-message timestamp (ISO 8601).
 */
export async function recordOptIn(db: Queryable, memberId: string, at: string): Promise<void> {
  await db.query(
    `INSERT INTO consent (member_id, opted_in_at, revoked_at, revocation_mode)
     VALUES ($1, $2, NULL, NULL)
     ON CONFLICT (member_id) DO UPDATE SET
       opted_in_at     = EXCLUDED.opted_in_at,
       revoked_at      = NULL,
       -- An active consent carries no revocation choice. Leaving a stale 'delete'
       -- here would make a later revocation inherit a destructive decision the
       -- member never repeated.
       revocation_mode = NULL`,
    [memberId, at],
  );
}

/**
 * Records opt-out for a member. With the derived publish view, setting
 * `revoked_at` immediately removes all of that member's messages from the
 * published set. Returns true if an active consent row was revoked.
 */
export async function recordOptOut(db: Queryable, memberId: string, at: string): Promise<boolean> {
  const { rowCount } = await db.query(
    // The revocation itself hides everything immediately, whatever the member
    // goes on to choose. 'pending' is the interim: hidden, and not consent to
    // destroy anything (CCB-S3-013).
    `UPDATE consent SET revoked_at = $2, revocation_mode = 'pending'
     WHERE member_id = $1 AND revoked_at IS NULL`,
    [memberId, at],
  );
  return (rowCount ?? 0) > 0;
}

/**
 * Records the member's answer to "hide or delete" (CCB-S3-013).
 *
 * Scoped to a member who is ACTUALLY REVOKED and has not already answered, so a
 * late or repeated answer cannot re-arm a destruction or flip a settled choice.
 * Returns true when this call is the one that recorded the decision.
 */
export async function recordRevocationMode(
  db: Queryable,
  memberId: string,
  mode: Exclude<RevocationMode, 'pending'>,
): Promise<boolean> {
  // THE MODE MAY MOVE WHILE THE MEMBER IS REVOKED (CCB-S3-031).
  //
  // `pending` -> `hide` | `delete`, and either of those to the other. The one
  // absolute is `revoked_at IS NOT NULL`: no transition on a member who has not
  // withdrawn, because that would let a stray word destroy a published archive.
  //
  // The original rule accepted `pending` alone. It was right about the danger
  // (destroying on a replay would be the worst bug in the feature) and wrong about
  // two real cases. A member who chose HIDE and later asks to delete is not a
  // replay: it is a fresh, first-person decision confirmed with the literal word,
  // and refusing it left them with no route from hidden to destroyed while the
  // engine told them there was "nothing left to destroy" over an archive it was
  // deliberately keeping. And CCB-S3-013 deliberately requires the reverse: a
  // member whose deletion was deferred by an evidence hold must be able to change
  // their mind back to hide and withdraw it, because hiding is the reversible
  // choice and must be able to call off the irreversible one.
  //
  // Honesty is NOT enforced here, because the schema cannot see it. Whether "hidden,
  // and you can bring them back" is true depends on whether anything survived, which
  // is a question about `messages`, not about `consent`. The engine asks it and picks
  // its words accordingly.
  const { rowCount } = await db.query(
    `UPDATE consent SET revocation_mode = $2
     WHERE member_id = $1 AND revoked_at IS NOT NULL AND revocation_mode <> $2`,
    [memberId, mode],
  );
  return (rowCount ?? 0) > 0;
}

/**
 * Why a hide/delete choice was not this call's to make (CCB-S3-031).
 *
 * The engine needs this to tell the member the truth. Before, both refusals came
 * back as a bare `false` and the reply was chosen from destruction counts, so a
 * member who was already hidden and a member who was never revoked at all were
 * both told "there is nothing of yours left in my archive to destroy" while their
 * content sat there, retained and restorable.
 */
export type ChoiceRefusal = 'not-revoked' | 'already-in-mode';

/** Reads why a mode transition changed nothing, so the reply can say what is true. */
export async function revocationRefusal(db: Queryable, memberId: string): Promise<ChoiceRefusal> {
  const { rows } = await db.query<{ revoked: boolean }>(
    `SELECT (revoked_at IS NOT NULL) AS revoked FROM consent WHERE member_id = $1`,
    [memberId],
  );
  return rows[0]?.revoked ? 'already-in-mode' : 'not-revoked';
}

/** How many of this member's messages the archive still holds. */
export async function memberMessageCount(db: Queryable, memberId: string): Promise<number> {
  const { rows } = await db.query<{ n: string }>(
    'SELECT count(*)::text AS n FROM messages WHERE sender_member_id = $1',
    [memberId],
  );
  return Number(rows[0]?.n ?? 0);
}

/**
 * Restores content the member chose to HIDE (CCB-S3-013).
 *
 * This is NOT an undo. It deliberately does not go through
 * `undoLastConsentAction`, and it deliberately does not call `recordOptIn`:
 * `recordOptIn` resets `opted_in_at` to now, and publication is forward-only
 * from that timestamp, so re-opting-in would leave every hidden message behind.
 * Clearing `revoked_at` while keeping the ORIGINAL `opted_in_at` is what puts a
 * member's own archive back exactly as it was.
 *
 * Only ever available after 'hide'. A revocation whose mode is 'delete' or
 * 'pending' does not match, so there is no shape of this call that can bring
 * back content the member asked to destroy, or pre-empt an unanswered choice.
 */
export async function restoreHidden(db: Queryable, memberId: string): Promise<boolean> {
  // The interval spent hidden is recorded BEFORE the revocation is cleared, while
  // `revoked_at` still says when it began. Messages sent inside it were spoken
  // while opted out and must stay unpublished: a restore brings back what WAS
  // public, it does not publish what the member said while out of the light
  // (migration 021).
  //
  // Same statement as the clear, so there is no window in which `revoked_at` is
  // gone but the gap is unrecorded, which would publish that content.
  // ORDER IS THE SAFETY PROPERTY HERE. The gap is written FIRST, while
  // `revoked_at` still says when the hiding began, and only then is the revocation
  // cleared. A crash between the two leaves a gap recorded on a member who is
  // still revoked, so their content stays hidden and the restore can simply be
  // asked for again. The other order would clear the revocation and lose the gap,
  // publishing everything said while hidden.
  const { rowCount } = await db.query(
    `INSERT INTO consent_gaps (member_id, gap_start, gap_end)
     SELECT member_id, revoked_at, now() FROM consent
     WHERE member_id = $1
       AND revoked_at IS NOT NULL
       AND revocation_mode = 'hide'
       AND now() > revoked_at`,
    [memberId],
  );
  if ((rowCount ?? 0) === 0) {
    // Nothing matched, so there is nothing to restore. Checked here rather than
    // after the UPDATE so a member who never hid anything cannot clear a
    // revocation whose mode is 'delete' or 'pending'.
    const { rowCount: eligible } = await db.query(
      `SELECT 1 FROM consent
       WHERE member_id = $1 AND revoked_at IS NOT NULL AND revocation_mode = 'hide'`,
      [memberId],
    );
    if ((eligible ?? 0) === 0) return false;
  }
  const { rowCount: cleared } = await db.query(
    `UPDATE consent SET revoked_at = NULL, revocation_mode = NULL
     WHERE member_id = $1 AND revoked_at IS NOT NULL AND revocation_mode = 'hide'`,
    [memberId],
  );
  return (cleared ?? 0) > 0;
}

export async function getConsent(db: Queryable, memberId: string): Promise<ConsentRecord | null> {
  const { rows } = await db.query<{
    member_id: string;
    opted_in_at: string;
    revoked_at: string | null;
    revocation_mode: string | null;
  }>(
    `SELECT member_id, opted_in_at, revoked_at, revocation_mode
     FROM consent WHERE member_id = $1`,
    [memberId],
  );
  const r = rows[0];
  if (!r) return null;
  return {
    memberId: r.member_id,
    optedInAt: r.opted_in_at,
    revokedAt: r.revoked_at,
    revocationMode: (r.revocation_mode as RevocationMode | null) ?? null,
  };
}
