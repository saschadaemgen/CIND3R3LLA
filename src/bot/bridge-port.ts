/**
 * The bridge's transport (CCB-S5-032, D-187), on the recital-port pattern.
 *
 * The bridge sends by GROUP ID from a queue job, long after any triggering
 * event object is gone, so it cannot ride the reply path; and every command
 * resolves the OWNING bot through the runtime (D-171, ownership.ts), because an
 * announcement issued as the wrong profile lands in the wrong world or nowhere.
 *
 * A module-level singleton set once at startup. Null is a real state meaning
 * nothing is hosting (the admin preview's permanent state, and every boot's
 * first seconds): the tick then does nothing and says so in its log line,
 * rather than half-working.
 *
 * The SEND returns the raw sent items, unlike the recital port, because the
 * bridge needs two things from them the recital never did: the sent item id
 * (what edit and withdrawal propagation act through) and the shared message id
 * (the loop guard's readback).
 */

import type { T } from '@simplex-chat/types';
import sharp from 'sharp';
import { log } from '../log.js';
import { describeChatError } from './runtime/chat-error.js';

export interface BridgeSentMessage {
  itemId: number | null;
  sharedMsgId: string | null;
  /** The raw item, for the send-site capture of her own message. */
  raw: unknown;
}

/**
 * The still the client draws before the file is fetched (CCB-S5-042, D-214).
 *
 * Small on purpose: it rides in the message itself rather than over XFTP, so it shares the
 * profile envelope's budget. The avatar's ladder already solves exactly this, and a preview
 * that fails to build is NOT a reason to lose the picture - the image still sends, the reader
 * just sees nothing until they tap, which is what happens today for every bridged image.
 */
async function bridgeImagePreview(filePath: string): Promise<string | null> {
  try {
    const buf = await sharp(filePath, { animated: false })
      .resize(320, 320, { fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: 70 })
      .toBuffer();
    return `data:image/jpg;base64,${buf.toString('base64')}`;
  } catch (err) {
    log.warn(
      `bridge: could not build a preview for ${filePath} (${
        err instanceof Error ? err.message : String(err)
      }); sending the image without one.`,
    );
    return null;
  }
}

export interface BridgeSendPort {
  sendText(groupId: number, text: string): Promise<BridgeSentMessage>;
  /**
   * A file with its caption, arriving as ONE message (see send.ts).
   *
   * `mime` decides the CONTENT TYPE and therefore the rendering: an image goes as
   * `MsgContent.Image` with a preview and renders as a picture, anything else as
   * `MsgContent.File` and renders as an attachment (D-214).
   */
  sendFile(
    groupId: number,
    filePath: string,
    caption: string,
    mime?: string | null,
  ): Promise<BridgeSentMessage>;
  /** Edit one of her sent messages in place. */
  updateText(groupId: number, itemId: number, text: string): Promise<void>;
  /** Delete her sent messages for everyone, not only locally. */
  deleteBroadcast(groupId: number, itemIds: readonly number[]): Promise<void>;
}

let port: BridgeSendPort | null = null;

export function setBridgeSendPort(next: BridgeSendPort | null): void {
  port = next;
}

/** Null means nothing is hosting; the tick declines and logs, never guesses. */
export function bridgeSendPort(): BridgeSendPort | null {
  return port;
}

/** What the port needs from the runtime; shaped for `MultiProfileRuntime`. */
export interface BridgeRuntimePort {
  sendGroupTextAsOwner(groupId: number, text: string): Promise<T.AChatItem[]>;
  sendGroupComposedAsOwner(groupId: number, composed: T.ComposedMessage[]): Promise<T.AChatItem[]>;
  updateGroupItemAsOwner(groupId: number, itemId: number, msgContent: T.MsgContent): Promise<void>;
  deleteGroupItemsBroadcastAsOwner(groupId: number, itemIds: readonly number[]): Promise<void>;
}

function firstSent(items: T.AChatItem[]): BridgeSentMessage {
  const item = items[0];
  if (item === undefined) return { itemId: null, sharedMsgId: null, raw: null };
  return {
    itemId: item.chatItem.meta.itemId,
    sharedMsgId: item.chatItem.meta.itemSharedMsgId ?? null,
    raw: item,
  };
}

export function sdkBridgePort(runtime: BridgeRuntimePort): BridgeSendPort {
  return {
    async sendText(groupId, text) {
      return firstSent(await runtime.sendGroupTextAsOwner(groupId, text));
    },
    async sendFile(groupId, filePath, caption, mime) {
      // ── THE CONTENT TYPE DECIDES THE RENDERING (CCB-S5-042, D-214) ────────
      //
      // This sent `type: 'file'` for EVERYTHING, so a bridged post's picture arrived as an
      // attachment the reader had to fetch rather than as a picture in the message. The
      // operator has had it that way since the bridge shipped.
      //
      // The comment here used to say the file variant "shares the shape" as the image one. It
      // shares the SHAPE and not the RENDERING, which is the whole point: `send.ts:127` and
      // `recital-port.ts:81` both send `type: 'image'` with a preview and both render as
      // pictures, and the difference was never the transport. Proven separately by sending an
      // image from the bot's own path with `MsgContent.Image` and watching it arrive as an
      // image (CCB-S5-042 stage 0).
      //
      // The preview is the still the client draws BEFORE the file is fetched - and the client
      // fetches on first press for every received file, so without one there is nothing to
      // look at until somebody taps. Built with the same ladder the avatar uses.
      //
      // Anything that is not an image keeps `type: 'file'`, which is correct for it.
      const isImage = (mime ?? '').startsWith('image/');
      const preview = isImage ? await bridgeImagePreview(filePath) : null;
      const msgContent: T.MsgContent = isImage
        ? { type: 'image', text: caption, image: preview ?? '' }
        : { type: 'file', text: caption };
      // On failure the caption goes alone, loudly: an announcement without its
      // picture is a smaller loss than no announcement, same call the recital's
      // image path makes.
      try {
        return firstSent(
          await runtime.sendGroupComposedAsOwner(groupId, [
            { fileSource: { filePath }, msgContent, mentions: {} },
          ]),
        );
      } catch (error) {
        // `describeChatError`, not `.message` (CCB-S5-018): this is an SDK send and the
        // fallback to text-only HIDES the fault by design, so the log line is the only
        // record that the picture was lost and why.
        log.error(
          `bridge: sending a file into group ${String(groupId)} failed (${describeChatError(
            error,
          )}); forwarding the text without it.`,
        );
        return firstSent(await runtime.sendGroupTextAsOwner(groupId, caption));
      }
    },
    async updateText(groupId, itemId, text) {
      await runtime.updateGroupItemAsOwner(groupId, itemId, { type: 'text', text });
    },
    async deleteBroadcast(groupId, itemIds) {
      await runtime.deleteGroupItemsBroadcastAsOwner(groupId, itemIds);
    },
  };
}
