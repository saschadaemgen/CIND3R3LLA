/**
 * Bot avatar handling (Connect & Go-Live C.3, SDK-native).
 *
 * The avatar is carried IN the profile passed to `bot.run`: the SDK's
 * `updateBotUserProfile` (simplex-chat 6.5.4 `bot.ts`) deep-compares the config
 * profile against the stored one and, when `updateProfile` is true (the default),
 * calls `apiUpdateProfile(userId, profile)` with the FULL profile — image
 * included. So we simply include the image in the boot profile: the core sets it
 * on first run and self-heals it on any boot where it differs. (The earlier
 * `updateProfile:false` + separate re-apply fought the SDK: a profile WITHOUT an
 * image differed from the stored one WITH an image, so every boot blanked it.)
 *
 * `apiUpdateProfile` only notifies direct CONTACTS (the bot has none); existing
 * GROUP members receive the avatar only when the bot next sends a group message
 * — see flushAvatarToGroups.
 *
 * SimpleX profile images ride inside the profile message envelope (~15,610 bytes
 * encoded), so the avatar must be small — we downscale to a square JPEG and drop
 * quality until the data URI is comfortably under budget. JPEG (PNG renders
 * blurry). An oversized image is silently not propagated to members.
 */

import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import sharp from 'sharp';
import { util } from 'simplex-chat';
import type { T } from '@simplex-chat/types';
import { log } from '../log.js';
import { getSetting, setSetting } from '../db/settings.js';
import type { Queryable } from '../db/pool.js';
import { SchedulerReentryError } from './runtime/scheduler.js';

/**
 * The one bot whose avatar is being flushed (CCB-S5-001).
 *
 * This used to be implicit: `apiGetActiveUser()` for the profile and a bare
 * `apiSendTextMessage` for the send, both of which resolve to whichever profile the core
 * last made active. With one bot pinned active at boot that was the right one by
 * construction; with several it is whichever one most recently issued a command, so a
 * flush could read A's image, list A's groups, and post into B's. Naming the bot removes
 * the ambiguity rather than scheduling around it.
 */
export interface AvatarBot {
  /** The profile record the runtime read at start, for this bot specifically. */
  user: T.User;
  /** For logs, so a flush says whose it was. */
  displayName: string;
  /** Send as THIS bot, through the active-user scheduler. */
  sendToGroup: (groupId: number, text: string) => Promise<unknown>;
  /**
   * This bot's groups, listed AS this bot (CCB-S5-018, D-171).
   *
   * A port rather than a bare `chat.apiListGroups(userId)` here, which is what this was.
   * The core checks the explicit user id against the active user and refuses on
   * `differentActiveUser`, so the bare call worked only for whichever bot happened to be
   * active and threw for every other one: the flush for a second bot never got as far as
   * its first send. The caller owns the scheduler, so the caller supplies the listing.
   */
  listGroups: () => Promise<{ groupId: number; localDisplayName: string }[]>;
}

/**
 * What a flush actually did (CCB-S5-016).
 *
 * It returned void, which was enough while the only caller was boot and the only reader was
 * the log. The console applies a face on demand now and has to TELL the operator what
 * happened, and the three outcomes are genuinely different: it reached N groups, it was
 * already current so nothing needed sending, or the profile carries no image at all. Reporting
 * "done" for the third would be the half-measure this whole thread has been about.
 */
export interface FlushResult {
  /** Groups the flush message reached. Zero with `alreadyFlushed` is success. */
  sent: number;
  /** The marker already matched: this image has been flushed and members have it. */
  alreadyFlushed: boolean;
  /** False when the profile carries no image, so there was nothing to flush. */
  hadImage: boolean;
}

/** Keep the data URI well under the ~15,610-byte profile envelope. */
const MAX_DATA_URI_CHARS = 12000;
const SIZES = [192, 160, 128];
const QUALITIES = [72, 64, 56, 48, 40];

/**
 * A preview that KEEPS the image's shape, for anything that is not an avatar
 * (CCB-S5-042, D-214).
 *
 * ── ITS OWN FUNCTION, NOT A FLAG ON THE AVATAR ONE ──────────────────────────
 *
 * {@link buildAvatarDataUri} crops to a SQUARE (`fit: 'cover'`) and is right to: an avatar is
 * rendered round, so the corners are thrown away anyway and centring the crop is what makes a
 * face look deliberate. A cover is not round. Cropping a 720x1319 sleeve to a square ate the
 * top and the bottom, and the operator saw it immediately.
 *
 * The two could share one function with a mode. They should not. They answer different
 * questions - "how do I fill a circle" and "how do I show this whole picture small" - and a
 * shared function with a flag is how the next caller gets the wrong default without noticing,
 * which is the shape of half the defects this season.
 *
 * The SIZE budget is shared, because that part is genuinely one question: the data URI rides
 * inside the message, so it must fit the same envelope. Hence the same descent, and hence a
 * bridged image that blew it produced `largeMsg` and lost its picture entirely.
 */
export async function buildCoverPreview(source: Buffer): Promise<string | null> {
  for (const px of SIZES) {
    for (const quality of QUALITIES) {
      const buf = await sharp(source)
        .rotate()
        .resize(px, px, { fit: 'inside', withoutEnlargement: true })
        .jpeg({ quality })
        .toBuffer();
      const uri = `data:image/jpg;base64,${buf.toString('base64')}`;
      if (uri.length <= MAX_DATA_URI_CHARS) return uri;
    }
  }
  // No fallback to the smallest attempt, unlike the avatar: an oversized preview is what
  // makes the whole SEND fail, so none is strictly better than one that will not fit.
  log.warn('Cover preview would not fit the message budget; sending without one.');
  return null;
}

/** Downscales an image to a small square JPEG data URI under the size budget. */
export async function buildAvatarDataUri(source: Buffer): Promise<string> {
  let best = '';
  for (const px of SIZES) {
    for (const quality of QUALITIES) {
      const buf = await sharp(source)
        .rotate() // honour EXIF orientation
        .resize(px, px, { fit: 'cover', position: 'centre' })
        .jpeg({ quality })
        .toBuffer();
      const uri = `data:image/jpg;base64,${buf.toString('base64')}`;
      best = uri;
      if (uri.length <= MAX_DATA_URI_CHARS) return uri;
    }
  }
  // Nothing fit the budget (unusual); return the smallest we produced.
  return best;
}

/**
 * Reads the avatar file and returns a size-budgeted `data:image/jpg;base64,…`
 * data URI to embed in the bot's `bot.run` profile, or `undefined` if no avatar
 * file is present (or it can't be read). The SDK then applies/self-heals it.
 */
export async function loadAvatarDataUri(avatarPath: string): Promise<string | undefined> {
  let source: Buffer;
  try {
    source = await readFile(avatarPath);
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') {
      log.debug(`No avatar file at ${avatarPath}; bot profile will carry no image.`);
    } else {
      // A staged-but-unreadable avatar (e.g. root-owned after `npm run avatar`, then
      // read as the service user gives EACCES) must not masquerade as "no avatar"
      // (CCB-S3-023): say plainly it is present but unreadable so it is diagnosable.
      log.warn(
        `Avatar at ${avatarPath} could not be read (${code ?? (err instanceof Error ? err.message : String(err))}); ` +
          `bot profile will carry no image. If a file is staged there, check its ownership/permissions.`,
      );
    }
    return undefined;
  }
  const dataUri = await buildAvatarDataUri(source);
  if (dataUri.length > MAX_DATA_URI_CHARS) {
    // Over the profile envelope — the core would silently not propagate it.
    log.warn(
      `Avatar data URI is ${dataUri.length} chars (> ${MAX_DATA_URI_CHARS}); ` +
        'it may not propagate to members. Use a simpler/smaller source image.',
    );
  }
  log.info(`Avatar loaded from ${avatarPath}: ${dataUri.length} char data URI.`);
  return dataUri;
}

/**
 * Marker (in `settings`) recording which avatar has been flushed to the group.
 *
 * PER BOT since CCB-S5-001. It used to be the bare string, one key for the whole
 * deployment, which was correct while one bot could exist and silently wrong the moment
 * a second did: bot A flushing its avatar wrote the marker, bot B then read its own
 * image against A's marker, and - only if the two images happened to differ - flushed.
 * Two bots sharing one avatar file would have left B's members with no picture forever,
 * with nothing logged, because the code had already decided the work was done.
 *
 * The legacy unsuffixed key is deliberately NOT migrated. It would have to be attributed
 * to a bot to be worth keeping, nothing records which bot wrote it, and the cost of
 * ignoring it is one extra flush message per bot on the first boot after this change.
 */
function flushMarkerKey(simplexUserId: number): string {
  return `avatarGroupFlushMarker:${String(simplexUserId)}`;
}
/** A minimal, one-time group message whose only job is to flush the profile. */
const FLUSH_MESSAGE = '🕯️✨';

/**
 * Flushes the bot's member profile (incl. avatar) to its groups.
 *
 * The SimpleX core only sends a member-profile update (`XInfo`) to a group when
 * the bot next sends a GROUP message — it piggybacks the profile when
 * `userMemberProfileSentAt < userMemberProfileUpdatedAt` (setting the avatar
 * advances the latter). `apiUpdateProfile` alone reaches contacts only, so
 * without a group send the avatar never reaches members.
 *
 * This sends ONE minimal group message per distinct avatar (gated by a hash
 * marker in `settings`, so restarts don't spam). After the send the core has
 * flushed the profile and won't re-piggyback; normal command replies keep it
 * current thereafter.
 */
export async function flushAvatarToGroups(db: Queryable, bot: AvatarBot): Promise<FlushResult> {
  const user = bot.user;
  const image = util.fromLocalProfile(user.profile).image;
  if (!image) return { sent: 0, alreadyFlushed: false, hadImage: false };

  const marker = createHash('sha256').update(image).digest('hex').slice(0, 16);
  const key = flushMarkerKey(user.userId);
  const stored = await getSetting(db, key);
  if (stored === marker) {
    log.debug(`Avatar already flushed to ${bot.displayName}'s groups; no group send needed.`);
    return { sent: 0, alreadyFlushed: true, hadImage: true };
  }

  // Attempt every group; a non-connected group just errors and is skipped (the
  // GroupMemberStatus runtime value doesn't reliably match the typed enum, so we
  // don't pre-filter on it).
  const groups = await bot.listGroups();
  let sent = 0;
  for (const g of groups) {
    try {
      // Through the bot's own scheduled send: `apiSendTextMessage` takes no user id, so
      // issued bare it would post THIS bot's flush message into whichever profile the
      // core last made active - into a group that bot may not even be in.
      await bot.sendToGroup(g.groupId, FLUSH_MESSAGE);
      sent++;
    } catch (err) {
      // ── ONE UNREACHABLE GROUP IS NOT THE SAME AS A DEFECT (CCB-S5-015) ────
      //
      // The per-group catch exists so a group this bot cannot post to does not stop the
      // others, and that is right. It was catching everything, though, which meant the
      // scheduler's re-entry refusal, a defect that will recur on every boot until the
      // code changes, was downgraded to a warning per group and the flush then reported
      // success having sent nothing. Found by the mutation in `verify:scheduler-reentry`,
      // which restored the old wrapper and watched the check pass anyway.
      //
      // So a defect is re-thrown and a group failure is still skipped (CCB-S3-023: a
      // caught error must not become a value that reads as a legitimate result).
      if (err instanceof SchedulerReentryError) throw err;
      // The group id, not its name: a room's name in the journal is community data in an
      // ordinary log line (CCB-S5-062); the bot's own name is the operator's and stays.
      log.warn(
        `Could not flush ${bot.displayName}'s profile to group ${g.groupId}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  }
  if (sent > 0) {
    await setSetting(db, key, marker);
    log.info(
      `Flushed member profile (avatar) for ${bot.displayName} to ${sent} group(s) via one group ` +
        'message — members receive the XInfo profile update on this send.',
    );
  }
  return { sent, alreadyFlushed: false, hadImage: true };
}
