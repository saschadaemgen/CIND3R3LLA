/**
 * Sending a recital beat, by group id (CCB-S4-047, D-149).
 *
 * ── WHY THIS EXISTS SEPARATELY FROM `send.ts` ────────────────────────────────
 *
 * Every other outbound path in the product answers a MESSAGE: it holds the captured item and
 * sends into the chat that item came from. A recital cannot, because beats two through eight
 * are sent by a queue job minutes after the triggering message was handled, and the SDK's
 * `AChatItem` is a live object that does not survive a JSON payload or a restart.
 *
 * What does survive is the group id, and the SDK takes one: `apiSendMessages` accepts
 * `[ChatType, number]` in place of a full `ChatInfo`. So the job's payload is an id and an
 * index, and this is the seam that turns those back into a message.
 *
 * Set once at startup, like the web-search service, because the queue worker has no way to
 * reach into the wiring that built the bot.
 */

import { T as TV } from '@simplex-chat/types';
import type { T } from '@simplex-chat/types';
import type { api } from 'simplex-chat';
import { log } from '../log.js';

export interface RecitalSendPort {
  sendText(groupId: number, text: string): Promise<void>;
  /** Caption and image travel as ONE message; see `sendImageToChat` for the confirmation. */
  sendImage(
    groupId: number,
    filePath: string,
    caption: string,
    preview: string | null,
  ): Promise<void>;
}

let port: RecitalSendPort | null = null;

export function setRecitalSendPort(next: RecitalSendPort | null): void {
  port = next;
}

/**
 * The port, or null when nothing is hosting.
 *
 * Null is a real state rather than an error: the admin preview harness and every offline
 * check run with no core. A recital simply does not start, and the member gets the brief
 * answer, which is what "degrades, never fails" means at this layer too.
 */
export function recitalSendPort(): RecitalSendPort | null {
  return port;
}

/** Binds the port to a live SDK handle. */
export function sdkRecitalPort(chat: api.ChatApi): RecitalSendPort {
  const groupRef = (groupId: number): [T.ChatType, number] => [TV.ChatType.Group, groupId];
  return {
    async sendText(groupId, text) {
      await chat.apiSendTextMessage(groupRef(groupId), text);
    },
    async sendImage(groupId, filePath, caption, preview) {
      try {
        await chat.apiSendMessages(groupRef(groupId), [
          {
            fileSource: { filePath },
            msgContent: { type: 'image', text: caption, image: preview ?? '' },
            mentions: {},
          },
        ]);
      } catch (err) {
        // The chapter ships without its illustration rather than not at all. Logged as an
        // error because a configured image that will not send is a fault, not a choice.
        log.error(
          `Recital image ${filePath} could not be sent (${
            err instanceof Error ? err.message : String(err)
          }); sending the chapter as text.`,
        );
        await chat.apiSendTextMessage(groupRef(groupId), caption);
      }
    },
  };
}
