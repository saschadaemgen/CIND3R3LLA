/**
 * Incoming contact requests for the bot being onboarded (CCB-S4-023, D-127).
 *
 * Step two of the manual onboarding sequence. Like step one, this module does not touch
 * the SimpleX SDK: it records what the core reported and what an action returned. The
 * event listener below is handed the runtime's own event source, and the accept and
 * reject actions live in `src/bot/runtime/admin-actions.ts`.
 *
 * ── WHY THE STATE MOVES HERE AND NOT IN THE VIEW ────────────────────────────
 *
 * `waiting_contact_request` to `contact_request_pending` happens because a request
 * ARRIVED, which is an event, not a click. If the view moved it, the page would have to
 * be open for the workflow to be true. So the listener owns that transition, and the
 * page only ever renders what is already recorded.
 */

import { writeAudit } from '../db/audit.js';
import { log } from '../log.js';
import { status } from '../web/status.js';
import type { Queryable } from '../db/pool.js';
import type { ChatEventSource } from '../bot/runtime/events.js';

export type ContactRequestState = 'pending' | 'accepted' | 'rejected';

export interface BotContactRequest {
  id: number;
  botProfileId: number;
  /** The core's own id. Acceptance is issued with exactly this. */
  contactRequestId: number;
  simplexUserId: number;
  requesterName: string;
  receivedAt: string;
  state: ContactRequestState;
  resolvedAt: string | null;
  contactId: number | null;
  contactName: string | null;
  /** When the core said the contact actually connected, which is a later fact. */
  connectedAt: string | null;
}

interface Row {
  id: string | number;
  bot_profile_id: string | number;
  contact_request_id: string | number;
  simplex_user_id: string | number;
  requester_name: string;
  received_at: string;
  state: ContactRequestState;
  resolved_at: string | null;
  contact_id: string | number | null;
  contact_name: string | null;
  connected_at: string | null;
}

const n = (v: string | number): number => Number(v);

function mapRow(row: Row): BotContactRequest {
  return {
    id: n(row.id),
    botProfileId: n(row.bot_profile_id),
    contactRequestId: n(row.contact_request_id),
    simplexUserId: n(row.simplex_user_id),
    requesterName: row.requester_name,
    receivedAt: row.received_at,
    state: row.state,
    resolvedAt: row.resolved_at,
    contactId: row.contact_id === null ? null : n(row.contact_id),
    contactName: row.contact_name,
    connectedAt: row.connected_at,
  };
}

const COLUMNS = `
  id, bot_profile_id, contact_request_id, simplex_user_id, requester_name,
  received_at, state, resolved_at, contact_id, contact_name, connected_at
`;

export async function listContactRequests(
  db: Queryable,
  botProfileId: number,
): Promise<BotContactRequest[]> {
  const { rows } = await db.query<Row>(
    `SELECT ${COLUMNS}
       FROM cinderella_bot_contact_requests
      WHERE bot_profile_id = $1
      ORDER BY (state = 'pending') DESC, received_at DESC`,
    [botProfileId],
  );
  return rows.map(mapRow);
}

/**
 * Record a request the core reported, and move the workflow to pending.
 *
 * Idempotent on the core's request id: the same request arriving twice, after a restart
 * or a reconnect, must not become two rows the operator has to choose between.
 * Returns whether this call is what created the row, so the caller can log honestly.
 */
export async function recordIncomingContactRequest(
  db: Queryable,
  botProfileId: number,
  request: { contactRequestId: number; simplexUserId: number; requesterName: string },
): Promise<{ recorded: boolean }> {
  const { rows } = await db.query<{ id: string }>(
    `INSERT INTO cinderella_bot_contact_requests
       (bot_profile_id, contact_request_id, simplex_user_id, requester_name)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (bot_profile_id, contact_request_id) DO NOTHING
     RETURNING id`,
    [botProfileId, request.contactRequestId, request.simplexUserId, request.requesterName],
  );
  const recorded = rows.length > 0;

  // The workflow advances only from `waiting_contact_request`. A request arriving while
  // the bot is already connected is real and is recorded, but it must not drag the
  // workflow backwards to an earlier step.
  if (recorded) {
    await db.query(
      `UPDATE cinderella_bot_profiles
          SET workflow_state = 'contact_request_pending',
              updated_at = now()
        WHERE id = $1 AND workflow_state = 'waiting_contact_request'`,
      [botProfileId],
    );
  }
  return { recorded };
}

/** Mark a request accepted, with the contact the core actually created. */
export async function recordAcceptedContactRequest(
  db: Queryable,
  botProfileId: number,
  contactRequestId: number,
  contact: { contactId: number; contactName: string },
  actor: string,
): Promise<void> {
  if (!Number.isSafeInteger(contact.contactId) || contact.contactId <= 0) {
    throw new Error('Refusing to record an acceptance without the contact the core created.');
  }

  const result = await db.query(
    `UPDATE cinderella_bot_contact_requests
        SET state = 'accepted',
            resolved_at = now(),
            contact_id = $3,
            contact_name = $4
      WHERE bot_profile_id = $1 AND contact_request_id = $2 AND state = 'pending'`,
    [botProfileId, contactRequestId, contact.contactId, contact.contactName],
  );
  if (result.rowCount !== 1) {
    throw new Error('That contact request is no longer pending.');
  }

  await db.query(
    `UPDATE cinderella_bot_profiles
        SET workflow_state = 'contact_connected',
            updated_at = now()
      WHERE id = $1`,
    [botProfileId],
  );

  await writeAudit(db, actor, 'cinderella.bot-profile.contact-accepted', `bot-profile:${botProfileId}`, {
    contactRequestId,
    contactId: contact.contactId,
    workflowState: 'contact_connected',
    runtimeApplied: true,
  });
}

/**
 * Mark a request rejected and put the workflow back to waiting.
 *
 * Back to waiting rather than to an error state: rejecting a request the operator did
 * not expect is a normal thing to do, and the bot is then exactly where it was, with a
 * live address, waiting for the right one.
 */
export async function recordRejectedContactRequest(
  db: Queryable,
  botProfileId: number,
  contactRequestId: number,
  actor: string,
): Promise<void> {
  const result = await db.query(
    `UPDATE cinderella_bot_contact_requests
        SET state = 'rejected',
            resolved_at = now()
      WHERE bot_profile_id = $1 AND contact_request_id = $2 AND state = 'pending'`,
    [botProfileId, contactRequestId],
  );
  if (result.rowCount !== 1) {
    throw new Error('That contact request is no longer pending.');
  }

  // Only back to waiting when nothing else is outstanding, and never from a state that
  // is further along: rejecting one of two requests must leave the page saying the
  // other is still pending.
  await db.query(
    `UPDATE cinderella_bot_profiles p
        SET workflow_state = 'waiting_contact_request',
            updated_at = now()
      WHERE p.id = $1
        AND p.workflow_state = 'contact_request_pending'
        AND NOT EXISTS (
          SELECT 1 FROM cinderella_bot_contact_requests r
           WHERE r.bot_profile_id = p.id AND r.state = 'pending'
        )`,
    [botProfileId],
  );

  await writeAudit(db, actor, 'cinderella.bot-profile.contact-rejected', `bot-profile:${botProfileId}`, {
    contactRequestId,
    workflowState: 'waiting_contact_request',
    runtimeApplied: true,
  });
}

/**
 * Stamp the moment the core said the contact actually connected.
 *
 * Accepting and connecting are two different facts. The operator's own app shows
 * "connecting" between them, and a console that presented the first as the second would
 * be telling them their app is wrong.
 */
export async function recordContactConnected(
  db: Queryable,
  simplexUserId: number,
  contactId: number,
): Promise<boolean> {
  const result = await db.query(
    `UPDATE cinderella_bot_contact_requests
        SET connected_at = COALESCE(connected_at, now())
      WHERE simplex_user_id = $1 AND contact_id = $2 AND state = 'accepted'`,
    [simplexUserId, contactId],
  );
  return result.rowCount === 1;
}

/**
 * Attach the onboarding listeners to the runtime's event flow.
 *
 * `resolveProfileId` is a lookup rather than a fixed id. It used to read the primary flag,
 * which was right while one bot ran; since CCB-S5-001 the caller resolves the bot whose own
 * event stream this is, so null means that bot has no configuration record rather than that
 * nobody holds the primary. The lookup shape is kept because the record can change under a
 * listener and a stale id would quietly file requests against the wrong bot.
 */
export function registerContactRequestListener(
  events: ChatEventSource,
  db: Queryable,
  resolveProfileId: () => Promise<number | null>,
): void {
  events.on('receivedContactRequest', async (ev) => {
    const contactRequestId = ev.contactRequest?.contactRequestId;
    const simplexUserId = ev.user?.userId;
    if (typeof contactRequestId !== 'number' || typeof simplexUserId !== 'number') {
      // Surfaced, not shrugged off: a request the console cannot record is a member
      // whose invitation will sit unanswered with nothing on the page to explain it.
      log.warn('onboarding: contact request event without an id, ignored', { ev });
      status.error(
        'A SimpleX contact request arrived that could not be recorded (the event carried ' +
          'no request id), so it will not appear on the AI Bot Setup page.',
      );
      return;
    }

    const botProfileId = await resolveProfileId();
    if (botProfileId === null) {
      log.warn('onboarding: contact request arrived with no bot record to file it against', {
        contactRequestId,
      });
      // Reworded under CCB-S5-008. It used to say "no AI bot is marked as the primary runtime
      // bot. Mark one", which named the wizard toggle that no longer exists and a decision
      // that never governed this: the caller resolves the bot that RECEIVED the request, so
      // null here means that bot has no configuration record, not that nobody is the primary.
      status.error(
        `A SimpleX contact request arrived (request ${contactRequestId}) but the bot that ` +
          `received it has no configuration record, so it could not be recorded. Check the ` +
          `AI Bot Setup page and ask the sender to try again.`,
      );
      return;
    }

    const requesterName =
      ev.contactRequest?.profile?.displayName?.trim() ??
      ev.contactRequest?.localDisplayName?.trim() ??
      'unknown';

    const { recorded } = await recordIncomingContactRequest(db, botProfileId, {
      contactRequestId,
      simplexUserId,
      requesterName,
    });
    log.info('onboarding: contact request received', {
      contactRequestId,
      botProfileId,
      recorded,
      note: recorded ? 'recorded and awaiting the operator' : 'already known, not duplicated',
    });
  });

  events.on('contactConnected', async (ev) => {
    const contactId = ev.contact?.contactId;
    const simplexUserId = ev.user?.userId;
    if (typeof contactId !== 'number' || typeof simplexUserId !== 'number') return;
    const stamped = await recordContactConnected(db, simplexUserId, contactId);
    if (stamped) {
      log.info('onboarding: the accepted contact is now connected', { contactId });
    }
  });
}
