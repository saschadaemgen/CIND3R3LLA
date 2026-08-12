/**
 * The bridge's event intake (CCB-S5-032, D-187), registered per hosted bot in
 * `buildBotGraph`, beside `registerCapture` and on the same per-bot event
 * source - which is what keeps one bot's channels out of another bot's bridge.
 *
 * ── THE SEPARATION FROM CAPTURE, STATED ──────────────────────────────────────
 *
 * `registerCapture` and this function listen to the SAME events and route by
 * DIRECTION: `groupRcv` items carry a member and go to capture, consent and the
 * engine; `channelRcv` items carry nobody and come here. The two parsers are
 * exclusive by construction (parse.ts states the decision), so no item can be
 * both a member message and a channel post, and neither registration needs to
 * know the other exists.
 *
 * ── MEDIA, AND THE 48-HOUR CLOCK ─────────────────────────────────────────────
 *
 * A channel file's bytes ride the transfer relays for roughly 48 hours. The
 * intake receives them THROUGH THIS BOT'S FileReceiver on arrival and moves
 * them under BRIDGE_MEDIA_ROOT - plaintext, deliberately: the at-rest
 * encryption (D-075) protects MEMBER media, whose privacy is a promise; a
 * channel post is the operator's own public broadcast, already readable by
 * every relay that carried it (the console says so in bold), and an encrypted
 * copy would buy nothing while putting a decrypt on the forward path.
 */

import { join } from 'node:path';
import { mkdir, rename, copyFile, unlink, stat } from 'node:fs/promises';
import type { ChatEventSource } from '../../bot/runtime/events.js';
import type { FileReceiver } from '../../bot/files.js';
import { parseChannelPost } from '../../bot/parse.js';
import type { CapturedFile } from '../../capture/message.js';
import { log } from '../../log.js';
import {
  intakeChannelDeletion,
  intakeChannelEdit,
  intakeChannelPost,
  type BridgeDeps,
} from './service.js';
import { enqueueBridgePropagation } from '../../queue/jobs/bridge.js';

export interface BridgeIntakeHost {
  chat: ChatEventSource;
  fileReceiver: Pick<FileReceiver, 'receive'>;
}

/** Mirrors capture/media.ts's move: rename, with the EXDEV copy fallback. */
async function moveFile(from: string, to: string): Promise<void> {
  try {
    await rename(from, to);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'EXDEV') throw err;
    await copyFile(from, to);
    await unlink(from);
  }
}

function sanitizeFileName(fileName: string): string {
  const base = fileName.replace(/[/\\]/g, '_');
  const cleaned = base.replace(/[^A-Za-z0-9._-]/g, '_').replace(/_+/g, '_');
  const trimmed = cleaned.replace(/^[._]+/, '').slice(0, 120);
  return trimmed.length > 0 ? trimmed : 'file';
}

const MIME_BY_EXT: Record<string, string> = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.mp4': 'video/mp4',
  '.pdf': 'application/pdf',
};

function mimeFor(fileName: string): string {
  const dot = fileName.lastIndexOf('.');
  return (dot === -1 ? undefined : MIME_BY_EXT[fileName.slice(dot).toLowerCase()]) ??
    'application/octet-stream';
}

/**
 * The media store the service's deps carry: receive through THIS bot's
 * FileReceiver, move under `<bridgeMediaRoot>/<botId>/<postId>-<name>`.
 * Post-id-first naming so the tree is legible and collision-free without
 * carrying anything derived from a member (there is no member).
 */
export function bridgeMediaStore(
  fileReceiver: Pick<FileReceiver, 'receive'>,
  bridgeMediaRoot: string,
): (botProfileId: number, postId: number, file: CapturedFile) => Promise<{
  path: string;
  mime: string;
  size: number;
}> {
  return async (botProfileId, postId, file) => {
    const received = await fileReceiver.receive(file);
    const dir = join(bridgeMediaRoot, String(botProfileId));
    await mkdir(dir, { recursive: true });
    const dest = join(dir, `${String(postId)}-${sanitizeFileName(received.fileName)}`);
    await moveFile(received.path, dest);
    const size = (await stat(dest)).size;
    return { path: dest, mime: mimeFor(received.fileName), size };
  };
}

/**
 * Registers the channel intake on one bot's event stream.
 *
 * Every handler narrows through `parseChannelPost`, so a member's message can
 * never enter the bridge whatever the event was, and every failure is logged
 * rather than thrown: the event source delivers at most once, and a thrown
 * handler loses the event for capture too.
 */
export function registerBridgeIntake(
  host: BridgeIntakeHost,
  botProfileId: number,
  deps: () => BridgeDeps,
): void {
  host.chat.on('newChatItems', async ({ chatItems }) => {
    for (const item of chatItems) {
      const post = parseChannelPost(item);
      if (post === null) continue;
      try {
        await intakeChannelPost(deps(), botProfileId, post);
      } catch (err) {
        log.error(
          `bridge: storing a channel post failed for bot ${String(botProfileId)}: ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
      }
    }
  });

  host.chat.on('chatItemUpdated', async ({ chatItem }) => {
    const post = parseChannelPost(chatItem);
    if (post === null) return;
    try {
      const postId = await intakeChannelEdit(deps(), botProfileId, post);
      // Propagation is a QUEUE job, not an inline call: the copies live in
      // other groups and the sends must survive a crash between them.
      if (postId !== null) await enqueueBridgePropagation(postId, 'edit');
    } catch (err) {
      log.error(
        `bridge: applying a channel edit failed for bot ${String(botProfileId)}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  });

  // Both deletion events, like capture: they can both fire for one deletion,
  // and markPostsDeleted is idempotent, so the propagation enqueue dedupes on
  // the post id (the marked set is only ever non-empty once per post).
  host.chat.on('groupChatItemsDeleted', async (ev) => {
    await handleDeletion(deps, botProfileId, ev.groupInfo.groupId, ev.chatItemIDs);
  });
  host.chat.on('chatItemsDeleted', async (ev) => {
    const byGroup = new Map<number, number[]>();
    for (const deletion of ev.chatItemDeletions) {
      const aci = deletion.deletedChatItem;
      if (aci.chatInfo.type !== 'group') continue;
      // The DIRECTION check is what scopes this to channel posts: a member
      // message's deletion belongs to capture's handler, not the bridge's.
      if (aci.chatItem.chatDir.type !== 'channelRcv') continue;
      const ids = byGroup.get(aci.chatInfo.groupInfo.groupId) ?? [];
      ids.push(aci.chatItem.meta.itemId);
      byGroup.set(aci.chatInfo.groupInfo.groupId, ids);
    }
    for (const [groupId, ids] of byGroup) {
      await handleDeletion(deps, botProfileId, groupId, ids);
    }
  });
}

async function handleDeletion(
  deps: () => BridgeDeps,
  botProfileId: number,
  groupId: number,
  itemIds: readonly number[],
): Promise<void> {
  try {
    const marked = await intakeChannelDeletion(deps(), botProfileId, groupId, itemIds);
    for (const postId of marked) await enqueueBridgePropagation(postId, 'withdraw');
  } catch (err) {
    log.error(
      `bridge: marking channel deletions failed for bot ${String(botProfileId)}: ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
  }
}
