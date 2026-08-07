/**
 * The single outbound transport for Cinderella's chat replies (CCB-S3-003).
 *
 * Two SDK calls produce visibly different messages, and both the natural-language
 * engine and the slash-command handler need to choose between them. Routing both
 * through here means the choice cannot drift between the two paths — which was
 * the actual bug: the interaction layer and the consent commands each called
 * `apiSendTextReply` independently, so every single reply quoted.
 */

import type { api } from 'simplex-chat';
import type { T } from '@simplex-chat/types';
import { log } from '../log.js';
import type { CapturedMessage } from '../capture/message.js';

export interface SendOptions {
  /** Quote the triggering message above the answer. */
  quote: boolean;
}

/**
 * Sends `text` into the chat `msg` came from, and returns the chat items the core
 * created for it (CCB-S3-007 — her own messages are archived, and the item id is
 * how one is identified).
 *
 * `apiSendTextMessage` with no `inReplyTo` is the plain form: a normal group
 * message. `msg.raw.chatInfo` is exactly the `ChatInfo` that overload accepts, so
 * no group lookup is needed.
 *
 * If the chat reference is somehow missing we fall back to the quoting form
 * rather than dropping the message: a cluttered reply is a cosmetic problem, a
 * silently unsent consent confirmation is not.
 */
export async function sendToChat(
  chat: api.ChatApi,
  msg: CapturedMessage,
  text: string,
  opts: SendOptions,
): Promise<T.AChatItem[]> {
  if (!opts.quote) {
    // Narrowing the opaque handle back to the SDK item. Legitimate HERE and
    // nowhere else: this file is inside the adapter, which is the one place that
    // knows what `RawItem` actually is (CCB-S3-020 §2).
    const raw = msg.raw as T.AChatItem;
    const chatInfo = raw.chatInfo;
    if (chatInfo) {
      return await chat.apiSendTextMessage(chatInfo, text);
    }
    log.warn(
      `Outbound reply for item ${msg.itemId} has no chat reference; falling back to a quoting reply.`,
    );
  }
  return await chat.apiSendTextReply(msg.raw as T.AChatItem, text);
}

/** What the runtime host offers: send to a group as this bot, optionally quoting. */
export type RuntimeGroupSend = (
  groupId: number,
  text: string,
  quotedItemId?: number,
) => Promise<T.AChatItem[]>;

/**
 * The same outbound decision as {@link sendToChat}, issued through the runtime
 * (CCB-S4-021) so the send is serialized by the active-user scheduler and attributed
 * from `r.user.userId` on the core's own response (D-124, D-096 Decision 5).
 *
 * ── WHY A GROUP ID IS ENOUGH, WHERE sendToChat NEEDED THE ChatInfo ──────────
 *
 * `apiSendTextMessage(chatInfo, …)` derives its send reference with `chatInfoRef`,
 * which carries the `memberSupport` scope through when the item came from a private
 * support thread. Dropping the scope would answer a private thread in the public
 * group, which is the CCB-S3-019 leak, so this would be the wrong shortcut if such an
 * item could reach here. It cannot: `parseGroupMessage` rejects every scoped item at
 * `isPublicGroupChat` before anything else, so every {@link CapturedMessage} that
 * exists is a scope-free public group message, and `{ chatType: Group, chatId:
 * msg.groupId }` is exactly the reference `chatInfoRef` would have produced.
 *
 * There is no fallback branch either, for the same reason: `msg.groupId` is a required
 * field parsed from the item, so the "no chat reference" case `sendToChat` guards
 * against cannot arise.
 */
export async function sendViaRuntime(
  send: RuntimeGroupSend,
  msg: CapturedMessage,
  text: string,
  opts: SendOptions,
): Promise<T.AChatItem[]> {
  return await send(msg.groupId, text, opts.quote ? msg.itemId : undefined);
}

/**
 * Sends one image with its caption into the chat `msg` came from (CCB-S4-047).
 *
 * ── CONFIRMED AGAINST THE SHIPPED CORE, BECAUSE IT DECIDES THE PACING ────────
 *
 * The briefing asked whether caption and image arrive together or as two messages. They
 * arrive TOGETHER, as one: `apiSendMessages` takes `ComposedMessage[]`, and one composed
 * message carries both a `fileSource` (the bytes, which travel over XFTP) and an
 * `MsgContent.Image` whose `text` IS the caption and whose `image` is the inline preview a
 * client shows before the transfer finishes.
 *
 * So a chapter with an image is ONE beat, not two, and the recital's pacing counts it once.
 * Had it been two the message bound would have meant half as many chapters.
 *
 * Falls back to sending the caption as plain text when the file cannot be composed, because a
 * chapter that ships without its illustration is the documented degradation and a chapter
 * that fails to ship is not.
 */
export async function sendImageToChat(
  chat: api.ChatApi,
  msg: CapturedMessage,
  filePath: string,
  caption: string,
  preview: string | null,
): Promise<T.AChatItem[]> {
  const raw = msg.raw as T.AChatItem;
  const chatInfo = raw.chatInfo;
  if (!chatInfo) {
    log.warn(`Outbound image for item ${msg.itemId} has no chat reference; sending the text alone.`);
    return await sendToChat(chat, msg, caption, { quote: false });
  }
  try {
    return await chat.apiSendMessages(chatInfo, [
      {
        fileSource: { filePath },
        msgContent: { type: 'image', text: caption, image: preview ?? '' },
        mentions: {},
      },
    ]);
  } catch (err) {
    // Surfaced, not swallowed: an image that will not send is a fault the operator should
    // see, and the chapter still ships.
    log.error(
      `Chapter image ${filePath} could not be sent (${
        err instanceof Error ? err.message : String(err)
      }); sending the chapter as text.`,
    );
    return await sendToChat(chat, msg, caption, { quote: false });
  }
}
