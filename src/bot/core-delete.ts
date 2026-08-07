/**
 * Erasing our copy from the SimpleX core's own database (CCB-S3-027).
 *
 * THE FINDING THIS EXISTS FOR. `storeMedia` moves files rather than copying them,
 * so file BYTES were never duplicated. But the core keeps its own SQLite copy of
 * every chat item, and nothing had ever deleted from it. Every message a member
 * had "destroyed" still existed on the host, including the base64 link-preview
 * images that ride inside link messages. `apiDeleteChatItems` was in the SDK with
 * zero call sites: not out of reach, simply never called.
 *
 * ── What `internal` actually does, established from the core sources at 6.5.4 ──
 *
 * `/_delete item <chatRef> <ids> internal` reaches `deleteGroupCIs`, which runs
 * `deleteGroupChatItem` per item:
 *
 *     deleteChatItemMessages_      -- DELETE the raw wire messages
 *     deleteChatItemVersions_      -- DELETE the edit history
 *     deleteGroupCIReactions_      -- DELETE the reactions
 *     DELETE FROM chat_items WHERE user_id = ? AND group_id = ? AND chat_item_id = ?
 *
 * and `deleteCIFiles` -> `deleteFilesLocally`, which `removeFile`s the file from
 * the core's files folder. The row goes, so `item_content` goes with it, and the
 * embedded preview image with that.
 *
 * `internalMark` is the one that does NOT erase: it runs
 * `UPDATE chat_items SET item_deleted = ?, item_deleted_ts = ? ...` and leaves the
 * content in place. Production confirmed this empirically before any of this was
 * written: the eleven rows already carrying `item_deleted = 1`, from members who
 * deleted their own messages in the group, each still held 12 to 14 KB of
 * `item_content`.
 *
 * ── Why `internal` and never `broadcast` ─────────────────────────────────────
 *
 * `broadcast` sends an `XMsgDel` to every member: it announces the member's
 * deletion to the whole group. They asked us to erase OUR copy, not to publish
 * the fact that they changed their mind. Broadcasting would be both wrong and a
 * privacy harm in its own right, so it is not an option here, not a default.
 */

import { T } from '@simplex-chat/types';

import type { ChatKind } from '../adapter/types.js';
import { log } from '../log.js';

/**
 * Erasing as the RIGHT bot (CCB-S5-001, D-155).
 *
 * ── WHY THIS STOPPED BEING A BARE CHAT HANDLE ────────────────────────────────
 *
 * This used to hold a `BotHandle` and call `handle.chat.apiDeleteChatItems(...)`.
 * `apiDeleteChatItems` takes NO user id, so it executes as whichever profile the core
 * last made active, and the core's own statement is
 *
 *     DELETE FROM chat_items WHERE user_id = ? AND group_id = ? AND chat_item_id = ?
 *
 * With one bot hosted and pinned active that was correct. With two, an erasure booked
 * for bot A can be issued while bot B is active: `user_id` matches nothing, ZERO ROWS
 * are deleted, and NO ERROR IS RAISED, because deleting something that does not exist
 * for that user is not an error. The queue would mark the job done and a member who
 * asked to be erased would still be on the host.
 *
 * So the port takes a group id and answers with the owning bot, and the runtime issues
 * the command as that bot through the scheduler. When the owner is unknown it THROWS:
 * the job stays on the queue and retries, which is the only safe answer on a path whose
 * silent failure is undetectable.
 */

/** What the runtime supplies: erase these items, as whichever bot owns the chat. */
export interface CoreDeletePort {
  /**
   * Erase one item from the core, as the bot that owns `chatId`.
   *
   * Must throw rather than issue the command as an arbitrary profile when the owner
   * cannot be determined.
   */
  eraseAsOwner(chatType: T.ChatType, chatId: number, itemId: number): Promise<void>;
}

/** The live port, when a core is running. Absent in harnesses and one-shot scripts. */
let port: CoreDeletePort | null = null;

export function setCoreDeletePort(p: CoreDeletePort | null): void {
  port = p;
}

/** Whether a core deletion can be attempted at all right now. */
export function coreDeleteAvailable(): boolean {
  return port !== null;
}

export class CoreDeleteUnavailableError extends Error {
  constructor() {
    super('the SimpleX core is not running, so its copy cannot be erased yet');
  }
}

/**
 * Erases one group chat item from the core's own database and files folder.
 *
 * `groupId` and `itemId` are the core's own identifiers, which the archive stores
 * as `messages.group_id` and `messages.group_msg_id`. They must be read BEFORE the
 * archive row is deleted, because afterwards there is nothing left to read them
 * from.
 *
 * Throws when the core is not running, when the owning bot cannot be determined, or
 * when the command fails, so the caller can retry durably rather than reporting an
 * erasure that did not happen.
 */
export async function deleteFromCore(
  chatId: number,
  itemId: number,
  chatKind: ChatKind = 'group',
): Promise<void> {
  if (!port) throw new CoreDeleteUnavailableError();
  // The SDK enum lives HERE, inside the adapter, and nowhere else.
  const chatType = chatKind === 'direct' ? T.ChatType.Direct : T.ChatType.Group;
  // Group for archived member messages; Direct for the private support-scope
  // items CCB-S3-019 removed from the archive but never from the core.
  //
  // INTERNAL, never Broadcast, and the mode is the port's rather than a parameter:
  // broadcast would announce the member's deletion to the entire group.
  await port.eraseAsOwner(chatType, chatId, itemId);
  log.info(`Core: erased chat item ${itemId} in ${chatKind} chat ${chatId} from the core database.`);
}
