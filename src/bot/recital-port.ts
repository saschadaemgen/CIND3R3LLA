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

import type { T } from '@simplex-chat/types';
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

/**
 * What the runtime supplies so a beat is sent as the bot that owns the group.
 *
 * ── WHY THIS IS NOT A BARE `ChatApi` ANY MORE (CCB-S5-001) ───────────────────
 *
 * Neither `apiSendTextMessage` nor `apiSendMessages` takes a user id, so both execute as
 * whichever profile the core last made active. A recital beat is booked on the queue and
 * sent minutes later, so the profile that happens to be active when beat four fires has
 * nothing to do with the bot that started the reading: one bot would read the other's
 * book into the other's group, and the core would raise nothing, because a member of that
 * group did legitimately send a message.
 *
 * Resolving the owner from the group id and issuing through the scheduler is what makes
 * the beat land as the bot that began the chapter.
 */
export interface RecitalRuntimePort {
  sendGroupText(groupId: number, text: string): Promise<unknown>;
  sendGroupComposedAsOwner(groupId: number, composed: T.ComposedMessage[]): Promise<unknown>;
}

/** Binds the port to the runtime, which knows which bot owns which group. */
export function sdkRecitalPort(runtime: RecitalRuntimePort): RecitalSendPort {
  return {
    async sendText(groupId, text) {
      await runtime.sendGroupText(groupId, text);
    },
    async sendImage(groupId, filePath, caption, preview) {
      try {
        await runtime.sendGroupComposedAsOwner(groupId, [
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
        await runtime.sendGroupText(groupId, caption);
      }
    },
  };
}
