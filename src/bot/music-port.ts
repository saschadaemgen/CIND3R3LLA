/**
 * The music transport (CCB-S5-044, D-216): the two proven send shapes, and
 * nothing else.
 *
 * ── THE COVER DECIDES THE SHAPE (the Stage-0 proof, as a contract) ───────────
 *
 * WITH a cover: ONE message, `MsgContent.Video` carrying the static-image MP4,
 * the title as its caption, the cover as the embedded preview (the still the
 * client draws before the file is fetched), and the duration the player shows.
 *
 * WITHOUT one: the title as its OWN message first, then the bare voice player -
 * `MsgContent.Voice` with `text: ""`, because an empty caption is what produces
 * the bare player rather than a framed one (measured in Stage 0, not inferred).
 *
 * A track without a cover is a normal state that changes the shape, never an
 * error that blocks the send.
 *
 * ── DEGRADATION, THE D-214 RULE ──────────────────────────────────────────────
 *
 * A new branch's failure must cost no more than the branch added. A video send
 * that fails retries as a plain FILE attachment (the always-worked shape), and
 * only then does the title go alone; a voice send does the same. Each step is
 * logged through `describeChatError`, because the fallback hides the fault by
 * design and the log line is the only record the player was lost.
 *
 * The recital-port pattern throughout: sends are BY GROUP ID, the port is a
 * module singleton the host sets and clears, and null means nothing is hosting.
 */

import type { T } from '@simplex-chat/types';
import { buildCoverPreview } from './avatar.js';
import { describeChatError } from './runtime/chat-error.js';
import { log } from '../log.js';
import { readFile } from 'node:fs/promises';

export interface MusicSentMessage {
  itemId: number | null;
  sharedMsgId: string | null;
  raw: unknown;
}

export interface MusicSendPort {
  /** The one-message video shape: encoded MP4, caption, preview, duration. */
  sendVideo(
    groupId: number,
    mp4Path: string,
    caption: string,
    coverPath: string,
    durationSeconds: number,
  ): Promise<MusicSentMessage>;
  /** The coverless shape's second half: the bare player (empty caption). */
  sendVoice(groupId: number, audioPath: string, durationSeconds: number): Promise<MusicSentMessage>;
  /** The coverless shape's first half, and every refusal line. */
  sendText(groupId: number, text: string): Promise<MusicSentMessage>;
}

let port: MusicSendPort | null = null;

export function setMusicSendPort(p: MusicSendPort | null): void {
  port = p;
}

/** Null means nothing is hosting; callers decline and log, never guess. */
export function musicSendPort(): MusicSendPort | null {
  return port;
}

/** What the port needs from the runtime; the bridge-port subset. */
export interface MusicRuntimePort {
  sendGroupTextAsOwner(groupId: number, text: string): Promise<T.AChatItem[]>;
  sendGroupComposedAsOwner(groupId: number, composed: T.ComposedMessage[]): Promise<T.AChatItem[]>;
}

function firstSent(items: T.AChatItem[]): MusicSentMessage {
  const item = items[0];
  if (item === undefined) return { itemId: null, sharedMsgId: null, raw: null };
  return {
    itemId: item.chatItem.meta.itemId,
    sharedMsgId: item.chatItem.meta.itemSharedMsgId ?? null,
    raw: item,
  };
}

export function sdkMusicPort(runtime: MusicRuntimePort): MusicSendPort {
  const composedSend = async (
    groupId: number,
    filePath: string,
    msgContent: T.MsgContent,
  ): Promise<MusicSentMessage> =>
    firstSent(
      await runtime.sendGroupComposedAsOwner(groupId, [
        { fileSource: { filePath }, msgContent, mentions: {} },
      ]),
    );

  const degradeToFile = async (
    groupId: number,
    filePath: string,
    caption: string,
    error: unknown,
    what: string,
  ): Promise<MusicSentMessage> => {
    log.error(
      `music: sending group ${String(groupId)} ${what} failed (${describeChatError(error)}); retrying as a plain attachment.`,
    );
    try {
      return await composedSend(groupId, filePath, { type: 'file', text: caption });
    } catch (fileError) {
      log.error(
        `music: the attachment retry for group ${String(groupId)} failed too (${describeChatError(fileError)}); sending the title without it.`,
      );
      return firstSent(await runtime.sendGroupTextAsOwner(groupId, caption));
    }
  };

  return {
    async sendVideo(groupId, mp4Path, caption, coverPath, durationSeconds) {
      // The preview keeps the cover's shape (buildCoverPreview, D-214) - a
      // sleeve is not round, and it is not square either.
      let preview: string | null = null;
      try {
        preview = await buildCoverPreview(await readFile(coverPath));
      } catch (error) {
        log.warn(
          `music: cover preview for group ${String(groupId)} failed (${String(error)}); the video goes without one.`,
        );
      }
      const msgContent: T.MsgContent = {
        type: 'video',
        text: caption,
        image: preview ?? '',
        duration: durationSeconds,
      };
      try {
        return await composedSend(groupId, mp4Path, msgContent);
      } catch (error) {
        return await degradeToFile(groupId, mp4Path, caption, error, 'a music video');
      }
    },
    async sendVoice(groupId, audioPath, durationSeconds) {
      // `text: ""` IS the bare player (Stage 0, measured). The title travelled
      // in its own message already, so a failure here degrades with an empty
      // caption too - the title must not arrive twice.
      const msgContent: T.MsgContent = { type: 'voice', text: '', duration: durationSeconds };
      try {
        return await composedSend(groupId, audioPath, msgContent);
      } catch (error) {
        return await degradeToFile(groupId, audioPath, '', error, 'a voice player');
      }
    },
    async sendText(groupId, text) {
      return firstSent(await runtime.sendGroupTextAsOwner(groupId, text));
    },
  };
}
