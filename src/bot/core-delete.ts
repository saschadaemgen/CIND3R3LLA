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
import type { BotHandle } from './client.js';

/** The live bot, when one is running. Absent in harnesses and one-shot scripts. */
let handle: BotHandle | null = null;

export function setCoreDeleteHandle(h: BotHandle | null): void {
  handle = h;
}

/** Whether a core deletion can be attempted at all right now. */
export function coreDeleteAvailable(): boolean {
  return handle !== null;
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
 * Throws when the core is not running or the command fails, so the caller can
 * retry durably rather than reporting an erasure that did not happen.
 */
export async function deleteFromCore(
  chatId: number,
  itemId: number,
  chatKind: ChatKind = 'group',
): Promise<void> {
  if (!handle) throw new CoreDeleteUnavailableError();
  // The SDK enum lives HERE, inside the adapter, and nowhere else.
  const chatType = chatKind === 'direct' ? T.ChatType.Direct : T.ChatType.Group;
  await handle.chat.apiDeleteChatItems(
    // Group for archived member messages; Direct for the private support-scope
    // items CCB-S3-019 removed from the archive but never from the core.
    chatType,
    chatId,
    [itemId],
    // INTERNAL, never Broadcast. See the header: broadcast would announce the
    // member's deletion to the entire group.
    T.CIDeleteMode.Internal,
  );
  log.info(`Core: erased chat item ${itemId} in ${chatKind} chat ${chatId} from the core database.`);
}
