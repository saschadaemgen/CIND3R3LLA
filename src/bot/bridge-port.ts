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
import { log } from '../log.js';

export interface BridgeSentMessage {
  itemId: number | null;
  sharedMsgId: string | null;
  /** The raw item, for the send-site capture of her own message. */
  raw: unknown;
}

export interface BridgeSendPort {
  sendText(groupId: number, text: string): Promise<BridgeSentMessage>;
  /** A file with its caption, arriving as ONE message (see send.ts). */
  sendFile(
    groupId: number,
    filePath: string,
    caption: string,
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
    async sendFile(groupId, filePath, caption) {
      // `type: 'file'` with the bytes riding `fileSource` over XFTP; the caption
      // and the file arrive together as one message (confirmed for images in
      // send.ts against the shipped core; the file variant shares the shape).
      // On failure the caption goes alone, loudly: an announcement without its
      // picture is a smaller loss than no announcement, same call the recital's
      // image path makes.
      try {
        return firstSent(
          await runtime.sendGroupComposedAsOwner(groupId, [
            { fileSource: { filePath }, msgContent: { type: 'file', text: caption }, mentions: {} },
          ]),
        );
      } catch (error) {
        log.error(
          `bridge: sending a file into group ${String(groupId)} failed (${
            error instanceof Error ? error.message : String(error)
          }); forwarding the text without it.`,
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
