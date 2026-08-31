/**
 * The bridge's orchestration (CCB-S5-032, D-187): intake, the tick, and
 * propagation. The DECISIONS live in cadence.ts and loop.ts, both pure; the
 * TABLES live in store.ts; the TRANSPORT is bot/bridge-port.ts. This file joins
 * them, and everything it needs arrives through {@link BridgeDeps} so
 * `verify:bridge` can drive the whole composition with fakes.
 *
 * ── NO MODEL, ANYWHERE, AND THAT IS A SECURITY PROPERTY ──────────────────────
 *
 * A channel post is text the application did not write. It is forwarded
 * VERBATIM: no summarising, no rewording, no model call on this path at all, so
 * there is nothing for a hostile channel post to instruct. The only sentences
 * added are the application's own persona lines, filled by `fillPersona` and
 * appended after the post. `verify:bridge` asserts the absence structurally
 * (this module must not import the reply generator) and behaviourally (a spy on
 * `personalize` sees nothing during a forward).
 *
 * The residue a member should still understand: her forwarded announcement is
 * her own message, so it enters her conversation MEMORY like everything she
 * says, fenced exactly as member text is (D-147). A channel post full of
 * instructions is no more privileged there than a member typing the same words.
 */

import type { Queryable } from '../../db/pool.js';
import type { ChannelPost } from '../../bot/parse.js';
import type { CapturedFile } from '../../capture/message.js';
import type { BridgeSendPort, BridgeSentMessage } from '../../bot/bridge-port.js';
import { parseSentGroupItem } from '../../bot/parse.js';
import { insertBotMessage } from '../../db/bot-messages.js';
import { log } from '../../log.js';
import { status } from '../../web/status.js';
import {
  afterAnnouncement,
  planTick,
  renderAnnouncement,
  type PendingPost,
} from './cadence.js';
import { buildOrigin, channelKeyFor } from './origin.js';
import {
  applyAnnouncementOutcome,
  applyPostEdit,
  bridgeForwardLog,
  getBridgePost,
  insertBridgePost,
  isOwnBridgeSend,
  listBridgeChannels,
  listBridgeMappings,
  liveForwardsForPost,
  markPostsDeleted,
  memberMessagesSince,
  pendingBridgePosts,
  postsInSentMessage,
  recordBridgeForward,
  resolveBridgePost,
  setMappingLastSent,
  setPostMedia,
  touchChannelPostAt,
  upsertBridgeChannel,
  type BridgeChannel,
  type BridgeMapping,
} from './store.js';
import { noteBridgeError, noteBridgeTick } from './bridge-log.js';
import { describeChatError } from '../../bot/runtime/chat-error.js';

/** The persona lines for one destination, pre-filled by the wiring. */
export interface BridgeLines {
  lang: string;
  attributionFor: (channelName: string, postedAt: Date) => string;
  remainderLine: (channelName: string, n: number) => string;
}

export interface BridgeDeps {
  db: Queryable;
  /** Null while nothing is hosting; the tick then does nothing, loudly in debug. */
  port: () => BridgeSendPort | null;
  /** The per-bot capability switch (D-175). Absent capability stores nothing. */
  isEnabledFor: (botProfileId: number) => boolean;
  /** The application-written lines, in the destination bot's language. */
  linesFor: (botProfileId: number) => BridgeLines;
  /** Receives a channel file's bytes and stores them; null when media is unwired. */
  storeMedia:
    | ((botProfileId: number, postId: number, file: CapturedFile) => Promise<{
        path: string;
        mime: string;
        size: number;
      }>)
    | null;
  /** The deployment bound on a re-hosted file, in bytes. */
  maxFileBytes: () => number;
  /**
   * The retention bound on stored files (CCB-S5-064): read per tick, so the operator's
   * save takes effect on the next tick rather than the next boot, like everything else
   * here.
   */
  mediaRetention: () => { enabled: boolean; days: number };
  /** Where the re-hosted files live; null when nothing is hosting (no sweep then). */
  mediaRoot: string | null;
  now?: () => Date;
}

const nowOf = (deps: BridgeDeps): Date => (deps.now ? deps.now() : new Date());

/* ── intake ───────────────────────────────────────────────────────────────── */

/**
 * A channel post arrived on one bot's event stream.
 *
 * Persisted for every KNOWN-OR-EVIDENT channel while the capability is on for
 * the bot: the post table is what "how far back may a post be" reaches into, so
 * a post that arrived before its mapping did can still be announced within the
 * age window. A bot the plugin is off for stores NOTHING - that is the
 * absent-capability property, and `verify:bridge` proves it with a spy.
 *
 * THE LOOP READBACK RUNS HERE, before anything is stored as announceable: a
 * post whose shared message id matches a message this bot's bridge sent is the
 * bridge's own product arriving back through a channel, and it is recorded
 * loop-refused - visibly, never silently (loop.ts states the model and the
 * limit).
 */
export async function intakeChannelPost(
  deps: BridgeDeps,
  botProfileId: number,
  post: ChannelPost,
): Promise<{ stored: boolean; loopRefused: boolean }> {
  if (!deps.isEnabledFor(botProfileId)) return { stored: false, loopRefused: false };

  await upsertBridgeChannel(deps.db, {
    botProfileId,
    sourceGroupId: post.groupId,
    channelName: post.channelName,
    link: post.viaLink,
  });
  await touchChannelPostAt(deps.db, botProfileId, post.groupId, new Date(post.postedAt));

  const inserted = await insertBridgePost(deps.db, {
    botProfileId,
    sourceGroupId: post.groupId,
    sharedMsgId: post.sharedMsgId,
    itemId: post.itemId,
    text: post.text,
    postedAt: new Date(post.postedAt),
  });
  if (!inserted.created) return { stored: true, loopRefused: false };

  if (post.sharedMsgId !== null && (await isOwnBridgeSend(deps.db, botProfileId, post.sharedMsgId))) {
    await resolveBridgePost(deps.db, inserted.id, 'loop-refused', true, null);
    return { stored: true, loopRefused: true };
  }

  // Media is fetched ON ARRIVAL, not at announce time: the relays keep a file
  // for roughly 48 hours and a repeat can be scheduled past that, so waiting
  // would hold a dead link. What that costs is the briefing's question, and the
  // answer is stated: a duplicate copy of every mapped channel file, bounded by
  // maxFileBytes, on the deployment's own disk.
  if (post.file !== undefined) {
    const cap = deps.maxFileBytes();
    if (post.file.fileSize > cap) {
      await setPostMedia(deps.db, inserted.id, {
        state: 'too-large',
        error: `${String(post.file.fileSize)} bytes against a ${String(cap)} byte bound; the text still forwards.`,
      });
    } else if (deps.storeMedia === null) {
      await setPostMedia(deps.db, inserted.id, {
        state: 'failed',
        error: 'no media store is wired (nothing is hosting); the text still forwards.',
      });
    } else {
      await setPostMedia(deps.db, inserted.id, { state: 'pending' });
      try {
        const stored = await deps.storeMedia(botProfileId, inserted.id, post.file);
        await setPostMedia(deps.db, inserted.id, {
          state: 'stored',
          path: stored.path,
          mime: stored.mime,
          size: stored.size,
        });
      } catch (error) {
        // A fault, not a choice (CCB-S3-023): the file was wanted and the fetch
        // failed, so the state says so and the console shows it. The text still
        // forwards; the announcement does not wait for bytes that may never come.
        const message = describeChatError(error);
        await setPostMedia(deps.db, inserted.id, { state: 'failed', error: message });
        log.error(
          `bridge: receiving a channel file for post ${String(inserted.id)} failed: ${message}`,
        );
        noteBridgeError('media', error);
      }
    }
  }

  return { stored: true, loopRefused: false };
}

/** The source post was edited; the copy follows (see propagateForPost). */
export async function intakeChannelEdit(
  deps: BridgeDeps,
  botProfileId: number,
  post: ChannelPost,
): Promise<number | null> {
  if (!deps.isEnabledFor(botProfileId)) return null;
  return await applyPostEdit(
    deps.db,
    botProfileId,
    post.groupId,
    post.itemId,
    post.text,
    nowOf(deps),
  );
}

/** The source posts were deleted; every copy is withdrawn (see propagateForPost). */
export async function intakeChannelDeletion(
  deps: BridgeDeps,
  botProfileId: number,
  sourceGroupId: number,
  itemIds: readonly number[],
): Promise<number[]> {
  if (!deps.isEnabledFor(botProfileId)) return [];
  return await markPostsDeleted(deps.db, botProfileId, sourceGroupId, itemIds, nowOf(deps));
}

/* ── the tick ─────────────────────────────────────────────────────────────── */

export interface TickReport {
  mappingsConsidered: number;
  announcementsSent: number;
  postsResolved: number;
}

/**
 * One pass over every enabled mapping. Called by the recurring queue job.
 *
 * AT-LEAST-ONCE, and the window is stated: `last_sent_at` moves only after a
 * successful send, so a tick that crashes BEFORE sending re-plans identically
 * and loses nothing, while a crash in the narrow gap between the send landing
 * and the bookkeeping landing double-announces once on the retry. The reverse
 * ordering would convert the same crash into a silently LOST announcement with
 * records claiming it went out, which is the worse lie.
 */
export async function runBridgeTick(deps: BridgeDeps): Promise<TickReport> {
  const report: TickReport = { mappingsConsidered: 0, announcementsSent: 0, postsResolved: 0 };
  const port = deps.port();
  const mappings = await listBridgeMappings(deps.db);
  const channels = await listBridgeChannels(deps.db);
  const channelOf = new Map<string, BridgeChannel>(
    channels.map((c) => [`${String(c.botProfileId)}:${String(c.sourceGroupId)}`, c]),
  );

  for (const mapping of mappings) {
    if (!mapping.enabled) continue;
    if (!deps.isEnabledFor(mapping.botProfileId)) continue;
    report.mappingsConsidered += 1;
    try {
      const outcome = await tickOneMapping(deps, port, mapping, channelOf);
      report.announcementsSent += outcome.announced;
      report.postsResolved += outcome.resolved;
    } catch (error) {
      // One mapping's failure must not silence the others. Logged with its
      // mapping, kept as the console's last error, and escalated: the bridge is
      // a plugin path and a member-visible absence (CCB-S3-023). The one shape
      // that stays quiet is the unknown-owner refusal, which is the normal state
      // of a boot's first minute and of a group the core has not listed yet.
      //
      // Through `describeChatError` (CCB-S5-018): everything this tick does - the send,
      // the in-place edit, the broadcast withdrawal - is an SDK command, so `.message`
      // here is very often the pointer string and not the fault. The unknown-owner test
      // below still works, because the describer returns a plain error's message
      // verbatim and `UnknownGroupOwnerError` is not an SDK error.
      const message = describeChatError(error);
      log.error(`bridge: mapping ${String(mapping.id)} failed this tick: ${message}`);
      noteBridgeError(`mapping ${String(mapping.id)}`, error);
      if (!message.includes('does not belong to any hosted bot')) {
        status.error(`Channel bridge: mapping ${String(mapping.id)} failed: ${message}`);
      }
    }
  }
  return report;
}

async function tickOneMapping(
  deps: BridgeDeps,
  port: BridgeSendPort | null,
  mapping: BridgeMapping,
  channelOf: Map<string, BridgeChannel>,
): Promise<{ announced: number; resolved: number }> {
  const now = nowOf(deps);
  const since = await memberMessagesSince(deps.db, mapping.destGroupId, mapping.lastSentAt);
  const posts = await pendingBridgePosts(deps.db, mapping.botProfileId, mapping.sourceGroupId);
  const plan = planTick(mapping, posts, now, since);

  for (const r of plan.resolutions) {
    await resolveBridgePost(deps.db, r.postId, r.resolution, r.suppressed, mapping.id);
  }

  noteBridgeTick({
    at: now.getTime(),
    mappingId: mapping.id,
    due: plan.due,
    announced: plan.announce === null ? 0 : 1,
    resolved: plan.resolutions.length,
  });

  if (plan.announce === null) return { announced: 0, resolved: plan.resolutions.length };
  // Due with something to say and nothing to say it through: nothing is
  // hosting. The plan is NOT spent (last_sent_at does not move), so the same
  // announcement goes out on the first tick after the port returns.
  if (port === null) {
    log.debug(`bridge: mapping ${String(mapping.id)} is due and nothing is hosting; waiting.`);
    return { announced: 0, resolved: plan.resolutions.length };
  }

  const channel = channelOf.get(
    `${String(mapping.botProfileId)}:${String(mapping.sourceGroupId)}`,
  );
  const channelName = channel?.channelName ?? `channel ${String(mapping.sourceGroupId)}`;
  // The key this announcement is stamped with, computed ONCE for both the forward log's
  // structured origin and the archived message's own columns (CCB-S5-043, D-215). Every
  // post in one announcement comes from one mapping and therefore one channel, so a digest
  // has one origin. A channel record the tick could not find falls back to the same
  // profile-local form `channelKeyFor` would produce, so a stamped row is never keyless.
  const channelKey = channelKeyFor(
    channel?.link ?? null,
    mapping.botProfileId,
    mapping.sourceGroupId,
  );
  const lines = deps.linesFor(mapping.botProfileId);
  const text = renderAnnouncement(plan.announce, {
    attributionFor: (post) => lines.attributionFor(channelName, post.postedAt),
    remainderLine: (n) => lines.remainderLine(channelName, n),
  });

  // The featured post's stored file rides along; summarized posts send their
  // excerpts only (their file gets its turn if they reach the featured slot).
  const featured = await getBridgePost(deps.db, plan.announce.full.id);
  const sent =
    featured !== null && featured.mediaState === 'stored' && featured.mediaPath !== null
      ? // The MIME the intake already stored decides image-versus-file, and therefore whether
        // a bridged picture renders as a picture (D-214). It was recorded and never used.
        await port.sendFile(mapping.destGroupId, featured.mediaPath, text, featured.mediaMime)
      : await port.sendText(mapping.destGroupId, text);

  const messageId = await archiveOwnSend(deps, sent, text, lines.lang, {
    channelKey,
    channelName,
  });

  for (const post of [plan.announce.full, ...plan.announce.summarized]) {
    await recordBridgeForward(deps.db, {
      mappingId: mapping.id,
      postId: post.id,
      kind: post.id === plan.announce.full.id ? 'featured' : 'summarized',
      sentItemId: sent.itemId,
      sentSharedMsgId: sent.sharedMsgId,
      origin: buildOrigin({
        channelKey,
        channelName,
        postedAt: post.postedAt,
        sharedMsgId: post.sharedMsgId,
      }),
      messageId,
    });
  }

  await applyAnnouncementOutcome(deps.db, afterAnnouncement(mapping, plan.announce));
  await setMappingLastSent(deps.db, mapping.id, now);
  return { announced: 1, resolved: plan.resolutions.length };
}

/**
 * Her side of the forward, archived like every other message she sends, under
 * the 'bridge' category (excluded from publication by default; migration 057).
 *
 * Non-blocking on purpose, the withBotCapture rule: a message that went out
 * must not be lost to the archive failing, and a message that failed to go out
 * never reaches this function.
 */
async function archiveOwnSend(
  deps: BridgeDeps,
  sent: BridgeSentMessage,
  text: string,
  lang: string,
  /**
   * The channel this announcement came from (CCB-S5-043, D-215). Written in the SAME
   * statement as the message, because the forward log it used to live on is cascaded by a
   * console action and a published item must not be able to lose its provenance.
   */
  origin: { channelKey: string; channelName: string },
): Promise<number | null> {
  if (sent.raw === null) return null;
  try {
    const item = parseSentGroupItem(sent.raw);
    if (item === null) return null;
    return await insertBotMessage(deps.db, {
      groupId: item.groupId,
      groupMsgId: item.itemId,
      sharedMsgId: item.sharedMsgId,
      senderMemberId: item.memberId,
      senderDisplayName: item.displayName,
      sentAt: item.sentAt,
      text,
      category: 'bridge',
      lang,
      // No member is ever named by the bridge (the content is a channel's and
      // the attribution names a channel), so the searchable text is the text.
      searchBody: text,
      mentions: [],
      bridgeChannelKey: origin.channelKey,
      bridgeChannelName: origin.channelName,
      rawJson: sent.raw,
    });
  } catch (error) {
    log.warn(
      `bridge: archiving her own announcement failed (${
        error instanceof Error ? error.message : String(error)
      }); the announcement itself went out.`,
    );
    return null;
  }
}

/* ── propagation: edits and withdrawals ───────────────────────────────────── */

/**
 * A source edit or deletion reaches every live copy (CCB-S5-032, Part 4).
 *
 * THE COPY FOLLOWS IN PLACE for an edit, rather than a correction being posted,
 * because the copy is the APPLICATION'S utterance rather than a member's: one
 * authoritative copy per group keeps the group's record matching the channel's,
 * SimpleX clients mark edited messages natively so the change is visible, and a
 * correction post would double the announcement volume the cadence exists to
 * bound. A deletion deletes FOR EVERYONE (broadcast), because a withdrawn
 * announcement surviving in the group is the failure with consequences.
 *
 * A digest complicates both, and the answer is RECOMPOSITION: the sent message
 * is rebuilt from the current state of every post standing in it. An edited
 * post's new text replaces the old; a withdrawn post's block disappears; a
 * message left holding nothing is deleted outright. The digest's remainder line
 * is not reproduced (its count described a moment that has passed).
 */
export async function propagateForPost(
  deps: BridgeDeps,
  postId: number,
  action: 'edit' | 'withdraw',
): Promise<{ updated: number; deleted: number }> {
  const port = deps.port();
  if (port === null) {
    // Retryable by the caller (the queue job throws to get its backoff): a
    // withdrawal that waits for the core beats one that silently never happens.
    throw new Error('bridge: nothing is hosting, so propagation must wait.');
  }

  const out = { updated: 0, deleted: 0 };
  const forwards = await liveForwardsForPost(deps.db, postId);
  const mappings = new Map((await listBridgeMappings(deps.db)).map((m) => [m.id, m]));
  const channels = await listBridgeChannels(deps.db);
  const channelOf = new Map(
    channels.map((c) => [`${String(c.botProfileId)}:${String(c.sourceGroupId)}`, c]),
  );

  for (const fwd of forwards) {
    const mapping = mappings.get(fwd.mappingId);
    if (mapping === undefined || fwd.sentItemId === null) continue;
    const standing = await postsInSentMessage(deps.db, fwd.mappingId, fwd.sentItemId);
    const alive = standing.filter((p) => p.deletedAt === null);

    if (alive.length === 0) {
      await port.deleteBroadcast(mapping.destGroupId, [fwd.sentItemId]);
      for (const p of standing) {
        await recordBridgeForward(deps.db, {
          mappingId: fwd.mappingId,
          postId: p.id,
          kind: 'withdrawal',
          sentItemId: fwd.sentItemId,
          sentSharedMsgId: fwd.sentSharedMsgId,
          origin: fwd.origin,
          messageId: null,
        });
      }
      out.deleted += 1;
      continue;
    }

    const channel = channelOf.get(
      `${String(mapping.botProfileId)}:${String(mapping.sourceGroupId)}`,
    );
    const channelName = channel?.channelName ?? `channel ${String(mapping.sourceGroupId)}`;
    const lines = deps.linesFor(mapping.botProfileId);
    const newestFirst = [...alive].sort((a, b) => b.postedAt.getTime() - a.postedAt.getTime());
    const full = newestFirst[0] as PendingPost;
    const rest = newestFirst.slice(1).sort((a, b) => a.postedAt.getTime() - b.postedAt.getTime());
    const text = renderAnnouncement(
      { full, summarized: rest, remainder: 0 },
      {
        attributionFor: (post) => lines.attributionFor(channelName, post.postedAt),
        remainderLine: (n) => lines.remainderLine(channelName, n),
      },
    );
    await port.updateText(mapping.destGroupId, fwd.sentItemId, text);
    await recordBridgeForward(deps.db, {
      mappingId: fwd.mappingId,
      postId,
      kind: action === 'withdraw' ? 'withdrawal' : 'edit',
      sentItemId: fwd.sentItemId,
      sentSharedMsgId: fwd.sentSharedMsgId,
      origin: fwd.origin,
      messageId: null,
    });
    out.updated += 1;
  }
  return out;
}

/** Re-exported for the console. */
export { bridgeForwardLog };
