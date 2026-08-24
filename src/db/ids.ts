/**
 * The two message id spaces, made unmistakable. (D-258)
 *
 * ── THE FOURTH ID-SPACE CONFUSION THIS SEASON ────────────────────────────────
 *
 * A message has TWO numeric ids and they are unrelated sequences:
 *
 *   `messages.id`            the archive's own IDENTITY primary key
 *   `messages.group_msg_id`  the SimpleX chat-item id, which is what
 *                            `CapturedMessage.itemId` carries
 *
 * `recentHistory` passed the chat-item id to a query that filtered on the primary key. Both
 * are `number`, so nothing complained, and the guard that was supposed to keep the message
 * she is answering out of her own history became a coin toss decided by which sequence
 * happened to be ahead in that group. Measured on the live archive:
 *
 *   group 1  pk 1..577      item 38..1406     overlapping: truncates
 *   group 4  pk 706..4757   item 1657..6110   overlapping: truncates
 *   group 8  pk 4758..5618  item 6175..8208   item ids all higher: NEVER FIRES
 *
 * On group 8 the guard did not fire at all, so every turn carried the member's current
 * message inside its own history. On group 1 it removed real history instead.
 *
 * ── WHY A NAME WAS NOT ENOUGH, AND WHAT IS DONE ABOUT IT ─────────────────────
 *
 * This is D-205's standing rule again ("a key that is local to one profile is not an
 * identity"), and the previous three were fixed one call site at a time. The call site was
 * never the problem: two `number`s that mean different things are assignable in both
 * directions forever, so the next caller re-makes the same mistake with a clean compile.
 *
 * So the two ids are BRANDED. The brand is erased at runtime - these are plain numbers on
 * the wire and in Postgres - and it exists only so that handing one where the other belongs
 * FAILS TO COMPILE, which is the treatment the capability catalog already gets in
 * `capability-claims.ts`: a mistake the type system refuses is a mistake nobody makes twice.
 * The constructors are the only way in, and each one is one word at the boundary where a
 * raw number arrives from the SDK or from a query.
 */

declare const ARCHIVE_ID: unique symbol;
declare const CHAT_ITEM_ID: unique symbol;

/** `messages.id`: the archive's own primary key. Meaningless to SimpleX. */
export type ArchiveMessageId = number & { readonly [ARCHIVE_ID]: true };

/**
 * `messages.group_msg_id`: the SimpleX chat-item id, as `CapturedMessage.itemId` carries it
 * and as in-group deletion events refer to it. Local to one profile's database and NOT
 * stable across a rejoin, which is the other half of D-205: it is a handle for one session,
 * never an identity.
 */
export type ChatItemId = number & { readonly [CHAT_ITEM_ID]: true };

/** Tag a raw number as an archive primary key. Use only where the row's own `id` arrives. */
export function archiveMessageId(n: number): ArchiveMessageId {
  return n as ArchiveMessageId;
}

/** Tag a raw number as a SimpleX chat-item id. Use only at the SDK or capture boundary. */
export function chatItemId(n: number): ChatItemId {
  return n as ChatItemId;
}
