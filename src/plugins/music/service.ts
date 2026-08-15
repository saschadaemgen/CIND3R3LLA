/**
 * The music plugin's orchestration (CCB-S5-044, D-216): the send in its two
 * proven shapes, the tick, and a member's own file made playable.
 *
 * The DECISIONS live in cadence.ts (pure) and store.ts (derived reads); the
 * TRANSPORT is bot/music-port.ts; the FILES are library.ts. This file joins
 * them, and everything arrives through {@link MusicDeps} so `verify:music`
 * drives the whole composition with fakes.
 *
 * ── NO MODEL ANYWHERE ON THE SEND PATH ───────────────────────────────────────
 *
 * A caption is DATA - the track's own title and artist - and the refusal lines
 * are persona strings the application fills. Nothing here calls a model, which
 * `verify:music` asserts structurally, the bridge's precedent: content that
 * plays into a group on a timer must not be a place a prompt injection can
 * steer.
 *
 * ── ONE SEND AT A TIME, PER GROUP ────────────────────────────────────────────
 *
 * The operator's rule: a bot plays one and waits to be asked again. In-flight
 * is a module map keyed by group; a request landing mid-transfer gets the
 * honest busy line rather than a queue, because a queue is invisible state,
 * and a cadence slot landing mid-transfer is SKIPPED and counted.
 */

import { basename, join } from 'node:path';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import type { Queryable } from '../../db/pool.js';
import type { MusicSendPort, MusicSentMessage } from '../../bot/music-port.js';
import { parseSentGroupItem } from '../../bot/parse.js';
import { insertBotMessage } from '../../db/bot-messages.js';
import { readMediaFile } from '../../media/at-rest.js';
import { log } from '../../log.js';
import { planCadence, type CadenceSkip } from './cadence.js';
import { ensureEncoded, freshTrack, readTags } from './library.js';
import {
  assignmentsForBot,
  getTrack,
  listAssignments,
  nextCadenceTrack,
  playlistTracks,
  recordPlay,
  setAssignmentLastSent,
  unbiddenSpend,
  type Track,
} from './store.js';
// The capture-table read the bridge already owns; one authority for "member
// messages in this group since then" beats a second copy that drifts.
import { memberMessagesSince } from '../channel-bridge/store.js';
import { noteMusicError, noteMusicSend, noteMusicSkip, noteMusicTick } from './music-log.js';
import { MEMBER_UPLOAD_EXTENSIONS, type MusicSettings } from './settings.js';
import { encodeMusicVideo } from '../../media/encode.js';
import { ENCODE_VERSION } from '../../media/encode.js';

export interface MusicDeps {
  db: Queryable;
  /** Null while nothing is hosting; the tick then does nothing, loudly in debug. */
  port: () => MusicSendPort | null;
  /** The library capability, per bot (D-175). */
  isEnabledFor: (botProfileId: number) => boolean;
  /** Part 4b's separate switch, per bot. */
  uploadsEnabledFor: (botProfileId: number) => boolean;
  /** The bot's answer language, for archiving her own sends. */
  langFor: (botProfileId: number) => string;
  musicRoot: string;
  settings: () => MusicSettings;
  /** Reaches the dashboard for faults on this plugin path (CCB-S3-023). */
  onFault: (message: string) => void;
  now?: () => Date;
}

const nowOf = (deps: MusicDeps): Date => (deps.now ? deps.now() : new Date());

/* ── one send at a time, per group ────────────────────────────────────────── */

const inFlight = new Set<number>();

export function sendInFlightFor(groupId: number): boolean {
  return inFlight.has(groupId);
}

/** Harness reset. */
export function resetInFlight(): void {
  inFlight.clear();
}

/* ── the send, both shapes ────────────────────────────────────────────────── */

/** The caption is data: title, and artist when there is one. */
export function trackCaption(track: Pick<Track, 'title' | 'artist'>): string {
  return track.artist === null || track.artist === '' ? track.title : `${track.title} - ${track.artist}`;
}

export interface PlayOutcome {
  sent: boolean;
  /** 'video' | 'voice' - which proven shape went out. */
  shape: 'video' | 'voice' | null;
  busy: boolean;
}

/**
 * Plays one track into one group, choosing the shape by whether the track has
 * a cover (the Stage-0 contract): with one, the single video message; without,
 * the title as its own message and then the bare voice player.
 *
 * Records the play (member_id NULL - D-217's deferral) and archives her own
 * send under the 'music' category, non-blocking on the archive exactly as the
 * bridge is: a message that went out must not be lost to the archive failing.
 */
export async function playTrackToGroup(
  deps: MusicDeps,
  botProfileId: number,
  groupId: number,
  track: Track,
  origin: { requested: boolean; assignmentId: number | null },
): Promise<PlayOutcome> {
  const port = deps.port();
  if (port === null) {
    log.debug(`music: group ${String(groupId)} asked to play and nothing is hosting; declining.`);
    return { sent: false, shape: null, busy: false };
  }
  if (inFlight.has(groupId)) return { sent: false, shape: null, busy: true };

  inFlight.add(groupId);
  try {
    const caption = trackCaption(track);
    const duration = track.durationSeconds ?? 0;
    let sent: MusicSentMessage;
    let shape: 'video' | 'voice';

    const encodedPath =
      track.coverPath === null
        ? null
        : await ensureEncoded(deps.db, deps.musicRoot, track, deps.onFault);
    const current = (await freshTrack(deps.db, track.id)) ?? track;

    if (encodedPath !== null && current.coverPath !== null) {
      shape = 'video';
      sent = await port.sendVideo(groupId, encodedPath, caption, current.coverPath, duration);
    } else {
      // Coverless - or the encode faulted, which degrades HERE, to the shape
      // that always works, rather than losing the track (D-214's rule).
      shape = 'voice';
      await port.sendText(groupId, caption);
      sent = await port.sendVoice(groupId, current.filePath, duration);
    }

    await recordPlay(deps.db, {
      trackId: track.id,
      botProfileId,
      groupId,
      assignmentId: origin.assignmentId,
      requested: origin.requested,
      kindAtPlay: track.kind,
      memberId: null,
      playedAt: nowOf(deps),
    });
    noteMusicSend();
    await archiveOwnSend(deps, botProfileId, sent, caption);
    return { sent: true, shape, busy: false };
  } finally {
    inFlight.delete(groupId);
  }
}

async function archiveOwnSend(
  deps: MusicDeps,
  botProfileId: number,
  sent: MusicSentMessage,
  caption: string,
): Promise<void> {
  if (sent.raw === null) return;
  try {
    const item = parseSentGroupItem(sent.raw);
    if (item === null) return;
    await insertBotMessage(deps.db, {
      groupId: item.groupId,
      groupMsgId: item.itemId,
      sharedMsgId: item.sharedMsgId,
      senderMemberId: item.memberId,
      senderDisplayName: item.displayName,
      sentAt: item.sentAt,
      text: caption,
      category: 'music',
      lang: deps.langFor(botProfileId),
      searchBody: caption,
      mentions: [],
      rawJson: sent.raw,
    });
  } catch (error) {
    log.warn(
      `music: archiving her own send failed (${error instanceof Error ? error.message : String(error)}); the track itself went out.`,
    );
  }
}

/* ── the tick ─────────────────────────────────────────────────────────────── */

export interface MusicTickReport {
  assignmentsConsidered: number;
  played: number;
  skipped: Partial<Record<CadenceSkip, number>>;
}

/**
 * One pass over every cadence assignment. At-least-once with the bridge's
 * ordering: `last_sent_at` moves only after a successful send, so a crash
 * before sending re-plans identically, and the rare double costs one repeat
 * rather than a silent loss.
 */
export async function runMusicTick(deps: MusicDeps): Promise<MusicTickReport> {
  const report: MusicTickReport = { assignmentsConsidered: 0, played: 0, skipped: {} };
  noteMusicTick(nowOf(deps).getTime());
  const assignments = await listAssignments(deps.db);

  for (const a of assignments) {
    if (a.mode !== 'cadence' || a.destGroupId === null) continue;
    if (!deps.isEnabledFor(a.botProfileId)) continue;
    report.assignmentsConsidered += 1;
    try {
      const now = nowOf(deps);
      const candidate = await nextCadenceTrack(deps.db, a.id, a.playlistId);
      const isSpot = candidate?.kind === 'spot';
      const s = deps.settings();
      const bounds = isSpot
        ? { dailyCap: s.spotDailyCap, gapMinutes: s.spotGapMinutes }
        : { dailyCap: s.musicDailyCap, gapMinutes: s.musicGapMinutes };
      const budget = await unbiddenSpend(deps.db, a.destGroupId, isSpot, now);
      const since = await memberMessagesSince(deps.db, a.destGroupId, a.lastSentAt);
      const plan = planCadence({
        assignment: a,
        now,
        memberMessagesSinceLastSend: since,
        budget,
        bounds,
        sendInFlight: inFlight.has(a.destGroupId),
        playlistHasTracks: candidate !== null,
      });
      if (!plan.send) {
        if (plan.skip !== null) noteMusicSkip(plan.skip);
        if (plan.skip !== null) report.skipped[plan.skip] = (report.skipped[plan.skip] ?? 0) + 1;
        continue;
      }
      const outcome = await playTrackToGroup(deps, a.botProfileId, a.destGroupId, candidate as Track, {
        requested: false,
        assignmentId: a.id,
      });
      if (outcome.sent) {
        report.played += 1;
        await setAssignmentLastSent(deps.db, a.id, now);
      }
    } catch (error) {
      // One assignment's failure must not silence the others (the bridge rule).
      log.error(`music: assignment ${String(a.id)} failed this tick: ${String(error)}`);
      noteMusicError(`assignment ${String(a.id)}`, error);
      deps.onFault(`Music: assignment ${String(a.id)} failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  return report;
}

/* ── asked directly: the engine's data needs ──────────────────────────────── */

/** What the MUSIC intent's handler needs, precomputed per bot - all derived. */
export async function botMusicView(
  deps: MusicDeps,
  botProfileId: number,
): Promise<{ playlists: { name: string; trackCount: number; mode: string }[] }> {
  const assignments = await assignmentsForBot(deps.db, botProfileId);
  const out = [];
  for (const a of assignments) {
    const tracks = await playlistTracks(deps.db, a.playlistId);
    out.push({ name: a.playlistName, trackCount: tracks.length, mode: a.mode });
  }
  return { playlists: out };
}

/* ── Part 4b: a member's own upload, made playable ────────────────────────── */

export type UploadRefusal = 'not-audio' | 'too-large' | 'no-file' | 'capability-off';

export interface UploadPlayback {
  ok: boolean;
  refusal: UploadRefusal | null;
  shape: 'video' | 'voice' | null;
}

/**
 * A member dropped an audio file into the chat and asked her to make it
 * playable. The file is ALREADY on disk: capture received and stored it under
 * MEDIA_ROOT, encrypted at rest, so "she fetches it" is a decrypting read
 * through the one sanctioned reader (src/media/at-rest.ts) - no new transfer
 * machinery and no second copy kept.
 *
 * PLAYED WITHOUT BEING STORED (the operator's default, inherited): the
 * decrypted bytes live in a temp directory for the send and are removed in
 * `finally`. Nothing enters the library.
 *
 * The refusals are an ALLOW-LIST (D-201): audio extensions only, the
 * deployment size bound, and the capability switch - each named to the member
 * through the persona line the caller picks from the refusal reason.
 */
export async function playMemberUpload(
  deps: MusicDeps,
  botProfileId: number,
  groupId: number,
  file: { mediaPath: string; mime: string | null; size: number; name: string } | null,
): Promise<UploadPlayback> {
  if (!deps.uploadsEnabledFor(botProfileId)) return { ok: false, refusal: 'capability-off', shape: null };
  if (file === null) return { ok: false, refusal: 'no-file', shape: null };
  const s = deps.settings();
  if (file.size > s.memberUploadMaxBytes) return { ok: false, refusal: 'too-large', shape: null };
  const ext = /\.[A-Za-z0-9]{1,5}$/.exec(file.name.toLowerCase())?.[0] ?? '';
  if (!MEMBER_UPLOAD_EXTENSIONS.includes(ext)) {
    return { ok: false, refusal: 'not-audio', shape: null };
  }

  const port = deps.port();
  if (port === null) return { ok: false, refusal: null, shape: null };
  if (inFlight.has(groupId)) return { ok: false, refusal: null, shape: null };

  const tmpDir = join(deps.musicRoot, '.playback-tmp', `${String(groupId)}-${String(Date.now())}`);
  inFlight.add(groupId);
  try {
    await mkdir(tmpDir, { recursive: true });
    const bytes = await readMediaFile(file.mediaPath);
    // The allow-list's second side: the extension is a CLAIM, the first bytes
    // are the fact. An MP3 opens with an ID3 tag or an MPEG frame sync, and a
    // renamed binary opens with neither - it is refused as not-audio rather
    // than re-sent wearing a player it can never be.
    const isMp3 =
      (bytes.length > 3 && bytes[0] === 0x49 && bytes[1] === 0x44 && bytes[2] === 0x33) ||
      (bytes.length > 2 && bytes[0] === 0xff && ((bytes[1] ?? 0) & 0xe0) === 0xe0);
    if (!isMp3) return { ok: false, refusal: 'not-audio', shape: null };
    const plainPath = join(tmpDir, `upload${ext}`);
    await writeFile(plainPath, bytes);

    const tags = await readTags(plainPath);
    const duration = tags.durationSeconds ?? 0;

    if (tags.cover !== null) {
      // A cover in the tag gets the video shape, encoded to the same recipe.
      const coverPath = join(tmpDir, 'cover.jpg');
      const sharp = (await import('sharp')).default;
      await writeFile(
        coverPath,
        await sharp(tags.cover).rotate().resize(1280, 1280, { fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 85 }).toBuffer(),
      );
      const mp4Path = join(tmpDir, `video-v${String(ENCODE_VERSION)}.mp4`);
      try {
        await encodeMusicVideo({ coverPath, audioPath: plainPath, outPath: mp4Path });
        const caption = tags.title ?? file.name;
        await port.sendVideo(groupId, mp4Path, caption, coverPath, duration);
        return { ok: true, refusal: null, shape: 'video' };
      } catch (error) {
        log.warn(`music: member-upload encode failed (${String(error)}); playing as voice.`);
      }
    }
    if (tags.title !== null) await port.sendText(groupId, tags.title);
    await port.sendVoice(groupId, plainPath, duration);
    return { ok: true, refusal: null, shape: 'voice' };
  } finally {
    inFlight.delete(groupId);
    await rm(tmpDir, { recursive: true, force: true }).catch(() => undefined);
  }
}

/** The member's most recent audio upload in this group, for "make this playable". */
export async function latestMemberAudio(
  db: Queryable,
  groupId: number,
  senderMemberId: string,
): Promise<{ mediaPath: string; mime: string | null; size: number; name: string } | null> {
  const { rows } = await db.query<{
    media_path: string | null;
    media_mime: string | null;
    media_size: string | number | null;
    text_body: string | null;
  }>(
    `SELECT media_path, media_mime, media_size, text_body
       FROM messages
      WHERE group_id = $1 AND sender_member_id = $2 AND media_path IS NOT NULL
        AND deleted = FALSE AND group_deleted = FALSE
      ORDER BY sent_at DESC, id DESC
      LIMIT 1`,
    [groupId, senderMemberId],
  );
  const r = rows[0];
  if (r === undefined || r.media_path === null) return null;
  return {
    mediaPath: r.media_path,
    mime: r.media_mime,
    size: r.media_size === null ? 0 : Number(r.media_size),
    // The stored path keeps the upload's extension, and the extension is what
    // the allow-list reads; the caption is not a filename.
    name: basename(r.media_path),
  };
}

/** Re-exported for the console and the engine. */
export { getTrack, playlistTracks };
