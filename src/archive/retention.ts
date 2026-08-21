/**
 * Retention: what the archive stops keeping, and when (CCB-S5-054, D-240).
 *
 * ── THE PROMISE, AND THE GAP THE OPERATOR FOUND ──────────────────────────────
 *
 * "Nothing a member posts appears on the public archive unless that member opted in"
 * is true and always has been. What was ALSO true, and is a different sentence, is
 * that everything a member posts is KEPT whether they opted in or not. Publication was
 * consent-gated from the first briefing; storage never was. On his archive that is
 * 3,337 rows and 119 MB of raw SimpleX envelopes belonging to people who never sent
 * `/publish` and never will.
 *
 * This file closes that. A row whose sender has never engaged with consent at all, and
 * which is older than the operator's bound, has its CONTENT removed and its SKELETON
 * kept. In the words the operator asked for, and they are worth repeating exactly:
 *
 *     The content is gone. The fact that a message existed is not.
 *
 * ── THE PREDICATE IS AN ALLOW-LIST, AND THAT IS NOT A STYLE CHOICE ───────────
 *
 * D-201 is the rule this repository has broken most often, most recently in D-238 by
 * the person who wrote it. A sweep that erases content is precisely the shape where a
 * deny-list fails in the direction you cannot undo: the case nobody listed gets
 * ERASED, and there is nothing left to notice it with.
 *
 * So {@link SWEEPABLE} does not say "everything except the rows I can think of that
 * must be kept". It says what may be swept, and the central clause is the strongest
 * positive statement available: **the sender appears nowhere in the consent system.**
 * Not in `consent`, not in `consent_actions`, not in `consent_gaps`. A member who has
 * ever touched consent - opted in, opted out, hidden, restored, been undone - is out of
 * scope entirely, whatever state they ended in. That is deliberately broader than
 * "currently has no consent row", because `undoLastConsentAction` can put a consent row
 * BACK with its original `opted_in_at`, and an undo that republishes content this sweep
 * had already erased is the one outcome with no recovery.
 *
 * ── WHY NOTHING PUBLISHABLE CAN BE LOST, STRUCTURALLY ────────────────────────
 *
 * This is the load-bearing argument and it is worth stating in full, because it is what
 * makes the sweep safe rather than merely careful.
 *
 * `recordOptIn` sets `opted_in_at` to the timestamp of the `/publish` command, and
 * publication is forward-only from it. A member with no consent row who opts in
 * tomorrow gets `opted_in_at = tomorrow`, so everything they said BEFORE that moment
 * stays unpublished for ever - there is no command, console control or setting that
 * reaches backwards. Every row this sweep touches is older than the bound, which is
 * itself in the past, so every row it touches is on the unreachable side of any opt-in
 * that has not happened yet.
 *
 * The sweep therefore cannot lose something that would have become public. It is not
 * that we checked the current publish state; it is that the future publish state of
 * these rows is fixed at false by the forward-only rule.
 *
 * Her own paired REPLY inherits the same guarantee and so is swept with its parent: a
 * reply publishes only when its parent does (`message_publish_state`), and its parent
 * can never publish, so the reply can never publish either. Leaving it behind would
 * leave her quoting a member whose words we had just erased.
 *
 * ── WHAT IS NOT HERE, AND WHY ────────────────────────────────────────────────
 *
 * The core's own copy. SimpleX keeps everything too, on the same disk, and on his host
 * 2,709 items a member had DELETED still held their text, because `fullDelete` is off
 * by default and a delete later than 78 hours is refused outright. A sweep that cleaned
 * Postgres and left that would be a promise kept in one database and broken in the one
 * next to it. That is `setCoreRetention` in `src/bot/runtime/admin-actions.ts`, driven
 * from the same page, and it is part of the same piece of work rather than a follow-up.
 */

import { unlink } from 'node:fs/promises';

import type { Queryable } from '../db/pool.js';
import { getSetting, setSetting } from '../db/settings.js';
import { log } from '../log.js';
import { forgetMediaFailures } from '../media/failures.js';
import { filesOwnedByMany } from '../media/owned-files.js';
import { status } from '../web/status.js';

/* ────────────────────────────────────────────────────────────────────────────
 * The operator's setting
 * ──────────────────────────────────────────────────────────────────────────── */

export interface RetentionSettings {
  /**
   * Whether the sweep runs at all.
   *
   * Ships OFF. Erasure is not something to inherit from an upgrade: a deployment that
   * has been capturing for a year would otherwise lose a year of unconsented content
   * the first time it restarted, with nobody having decided that. The console states
   * what would be swept BEFORE it is switched on, and the count is the decision.
   */
  enabled: boolean;
  /**
   * How long unconsented content is kept, in hours.
   *
   * ── THE FLOOR, AND THE WRONG ANSWER IT REPLACES (D-241) ────────────────────
   *
   * It shipped at 168 hours, justified by migration 029's cap on a moderation window:
   * "the bound can never be shorter than the longest window an operator could be counting
   * violations over". The premise is true and the inference does not follow, and the
   * operator caught it. What a moderation window counts is rows in `cinderella_violations`,
   * which has its own copies of the group, the member, the display name at the time, the
   * role and the kind, and **no foreign key to `messages` at all**. The floor was
   * protecting a dependency that does not exist. Stage 0 had already reported that the
   * violations table survives a sweep intact, and I set the floor from it anyway.
   *
   * ── WHAT WAS ESTABLISHED INSTEAD ──────────────────────────────────────────
   *
   * Every reader of a captured message's content was swept before this number moved, and
   * the result is unusually clean: **no reader has a finite window over message content.**
   * Each one either needs it at the instant the message arrives and never again
   * (moderation, capture, media stripping, the reply path), or reaches back with no time
   * bound at all (the console browsing a row, "play the audio I uploaded").
   *
   * The single exception, and therefore the only number a floor can honestly be read from,
   * is her CONVERSATION MEMORY: `listGroupHistory` selects text from `messages` at reply
   * time, bounded by `windowMinutes`, which `MAX_HISTORY_LIMITS` caps at **720 minutes -
   * twelve hours** (`src/interaction/history.ts`; the default is 30 minutes). Above that
   * she cannot see a message whatever the archive holds.
   *
   * So the floor is 24 hours: the smallest whole day above the only measured window, and
   * twice it. A number read off the code rather than chosen - which is what the previous
   * comment claimed to be doing and was not.
   */
  hours: number;
}

/**
 * Twice the longest window anything can read message content over (D-241).
 *
 * Her conversation memory caps at 720 minutes; nothing else has a finite window at all.
 * 24 hours is the smallest whole day that clears it.
 */
export const RETENTION_MIN_HOURS = 24;

/** A year. Above this the setting is not a retention policy, it is an off switch. */
export const RETENTION_MAX_HOURS = 24 * 365;

/**
 * A fresh deployment gets 24 hours (D-241).
 *
 * The longer bounds stay on the page and stay selectable: an operator running a longer
 * moderation rhythm, or one who wants a week to look at what arrived before it goes, has a
 * real reason for them. What changed is which one you get without deciding, and for content
 * nobody agreed to keep the honest default is the shortest one the code supports.
 */
export const DEFAULT_RETENTION: RetentionSettings = {
  enabled: false,
  hours: RETENTION_MIN_HOURS,
};

const SETTING_KEY = 'retention';

/** Pure: coerce whatever is stored into a usable setting, never throwing. */
export function normalizeRetention(raw: unknown): RetentionSettings {
  const o = (raw ?? {}) as Record<string, unknown>;
  const hours = Number(o['hours']);
  return {
    enabled: o['enabled'] === true,
    hours:
      Number.isFinite(hours) && hours >= RETENTION_MIN_HOURS && hours <= RETENTION_MAX_HOURS
        ? Math.floor(hours)
        : DEFAULT_RETENTION.hours,
  };
}

export async function getRetentionSettings(db: Queryable): Promise<RetentionSettings> {
  return normalizeRetention(await getSetting(db, SETTING_KEY));
}

export async function saveRetentionSettings(
  db: Queryable,
  next: RetentionSettings,
): Promise<RetentionSettings> {
  const clean = normalizeRetention(next);
  await setSetting(db, SETTING_KEY, clean);
  return clean;
}

/* ────────────────────────────────────────────────────────────────────────────
 * The predicate
 * ──────────────────────────────────────────────────────────────────────────── */

/**
 * What may be swept, as one SQL predicate over `messages m`, with `$1` as the cutoff.
 *
 * Read every clause as a permission rather than an exclusion. This is the whole
 * decision, in one place, so that a future reader can check the list against the
 * schema rather than against their memory of what the schema contains.
 *
 * Not stated here and worth knowing: `deleted` and `group_deleted` are NOT in this
 * list. A member who deleted their own message in the group is a member who wanted the
 * content gone, so it is swept on exactly the same terms as anything else of theirs.
 * Sooner than the bound is not available to us, and that is a choice about having ONE
 * schedule rather than a claim that moderation needs the time (D-241: it does not).
 */
export const SWEEPABLE = `
      m.content_swept_at IS NULL
  AND m.is_bot = FALSE
  AND m.sent_at < $1
  -- An admin decision is outstanding or has been made; the content is the evidence for it.
  AND m.moderation_state = 'none'
  -- THE CENTRAL CLAUSE. The sender appears nowhere in the consent system, in any state.
  AND NOT EXISTS (SELECT 1 FROM consent c WHERE c.member_id = m.sender_member_id)
  AND NOT EXISTS (SELECT 1 FROM consent_actions a WHERE a.member_id = m.sender_member_id)
  AND NOT EXISTS (SELECT 1 FROM consent_gaps g WHERE g.member_id = m.sender_member_id)
  -- A hold exists to KEEP something, including every quarantine (migration 022 wears
  -- this table too, so csam and escalated rows are covered by this one clause).
  AND NOT EXISTS (SELECT 1 FROM evidence_holds h WHERE h.message_id = m.id)
  -- Somebody reported this and the operator has not finished with it.
  AND NOT EXISTS (SELECT 1 FROM reports r WHERE r.message_id = m.id)
  -- A destruction is already owed on this row and owns its media paths.
  AND NOT EXISTS (SELECT 1 FROM pending_destructions d WHERE d.message_id = m.id)
`;

/**
 * Her own reply to a row being swept, on the same terms.
 *
 * Deliberately a SECOND predicate with its own name rather than an OR branch inside the
 * first, because it answers a different question: the first asks "did anybody agree to
 * keep this", which is about a member, and this one asks "can this ever be published",
 * which is about the reply chain. One predicate serving both is how a guard ends up
 * answering the wrong question in the case nobody tested.
 */
const SWEEPABLE_REPLY = `
      r.content_swept_at IS NULL
  AND r.is_bot = TRUE
  AND NOT EXISTS (SELECT 1 FROM evidence_holds h WHERE h.message_id = r.id)
  AND NOT EXISTS (SELECT 1 FROM reports rep WHERE rep.message_id = r.id)
  AND NOT EXISTS (SELECT 1 FROM pending_destructions d WHERE d.message_id = r.id)
`;

/** How many rows the sweep would touch right now, without touching one. */
export async function sweepableCount(db: Queryable, cutoff: string): Promise<number> {
  const { rows } = await db.query<{ n: string }>(
    `SELECT count(*)::text AS n FROM messages m WHERE ${SWEEPABLE}`,
    [cutoff],
  );
  return Number(rows[0]?.n ?? 0);
}

/**
 * When the last sweep removed anything, or null if none ever has.
 *
 * The page shows this beside the next scheduled run, because "armed for tonight" and "has
 * actually been running" are different claims and a surface that made only the first would
 * be describing a timer rather than the archive (D-205). Reads the partial index on
 * `content_swept_at` and no content column.
 */
export async function lastSweptAt(db: Queryable): Promise<string | null> {
  const { rows } = await db.query<{ at: string | null }>(
    'SELECT max(content_swept_at)::text AS at FROM messages WHERE content_swept_at IS NOT NULL',
  );
  return rows[0]?.at ?? null;
}

/** How many rows are already tombstones. */
export async function tombstoneCount(db: Queryable): Promise<number> {
  const { rows } = await db.query<{ n: string }>(
    'SELECT count(*)::text AS n FROM messages WHERE content_swept_at IS NOT NULL',
  );
  return Number(rows[0]?.n ?? 0);
}

/** The cutoff for a bound, as an ISO timestamp. Pure, so the harness can pin it. */
export function cutoffFor(hours: number, now: Date): string {
  return new Date(now.getTime() - hours * 3_600_000).toISOString();
}

/* ────────────────────────────────────────────────────────────────────────────
 * The sweep
 * ──────────────────────────────────────────────────────────────────────────── */

export interface SweepOutcome {
  /** Rows turned into tombstones, her paired replies included. */
  swept: number;
  /** Media files removed from disk. */
  filesRemoved: number;
  /** Link rows deleted. */
  linksRemoved: number;
}

/**
 * The columns the tombstone clears, in one place.
 *
 * Every one of these is content or the identity of somebody who consented to nothing.
 * Nothing `message_publish_state` reads is here, which is what makes the published set
 * provably unmoved - see the migration's header and `verify:retention` section 2.
 */
const CLEAR_CONTENT = `
      text_body           = NULL,
      links_text          = NULL,
      search_body         = CASE WHEN is_bot THEN '' ELSE NULL END,
      raw_json            = '{}'::jsonb,
      media_path          = NULL,
      media_derived_path  = NULL,
      media_mime          = NULL,
      media_size          = NULL,
      media_meta_found    = NULL,
      media_strip_skipped = NULL,
      -- media_error is DELIBERATELY not cleared, and that is the correction of a defect
      -- (D-241). Clearing it made every swept picture match markInterruptedMediaReceipts
      -- and the dashboard's media-health count, both of which read "no path and no error" as
      -- "the file never arrived". Every restart then stamped a false "receipt interrupted"
      -- across the swept archive and the console grew a red banner counting erasures as
      -- failures. Those two readers now exclude tombstones by name; leaving any error the row
      -- already carried is the other half of the same fix.
      video_provider      = NULL,
      video_id            = NULL,
      video_start         = NULL,
      video_title         = NULL,
      content_swept_at    = now()
`;

/**
 * Removes the content of everything nobody agreed to keep and that is past the bound.
 *
 * `db` MUST be inside a transaction, for the same reason `destroyMessage` requires one:
 * the file paths live only on the rows being cleared, so they are read first, and an
 * unlink that fails throws and rolls the clear back rather than leaving a row that says
 * the content is gone over bytes that are still on disk.
 *
 * Idempotent. A retry re-selects from whatever is still unswept, and a file that is
 * already absent is not a failure.
 */
export async function sweepUnconsented(
  db: Queryable,
  mediaRoot: string,
  cutoff: string,
): Promise<SweepOutcome> {
  // The member rows, then her replies to exactly those rows. Two statements rather than
  // one recursive select, because the reply set is defined BY the member set and reading
  // it that way is what makes it checkable.
  const { rows: memberRows } = await db.query<{ id: string }>(
    `SELECT m.id FROM messages m WHERE ${SWEEPABLE} ORDER BY m.id`,
    [cutoff],
  );
  const memberIds = memberRows.map((r) => Number(r.id));
  if (memberIds.length === 0) return { swept: 0, filesRemoved: 0, linksRemoved: 0 };

  const { rows: replyRows } = await db.query<{ id: string }>(
    `SELECT r.id FROM messages r
      WHERE r.reply_to_id = ANY($1::bigint[]) AND ${SWEEPABLE_REPLY}
      ORDER BY r.id`,
    [memberIds],
  );
  const ids = [...memberIds, ...replyRows.map((r) => Number(r.id))];

  // Paths first, while the rows still carry them, and in ONE pass (D-241). The per-message
  // form walks the whole media tree on every call, which is right for a destruction and
  // would have made the first production sweep roughly 3,300 whole-tree walks inside one
  // transaction - not a failure, just a hang, which is the worst way for this to go wrong.
  //
  // A rejected path is a FAULT rather than a row to skip: a tombstone standing over bytes
  // nothing can find again is the one outcome that cannot be repaired by running it again.
  const owned = await filesOwnedByMany(db, mediaRoot, ids);
  if (owned.rejected.length > 0) {
    throw new Error(
      `retention: ${String(owned.rejected.length)} row(s) have stored media path(s) outside ` +
        `the media root; refusing to sweep while bytes would be left behind.`,
    );
  }
  const paths = owned.paths;

  const { rowCount: linksRemoved } = await db.query(
    'DELETE FROM links WHERE message_id = ANY($1::bigint[])',
    [ids],
  );

  // The mention rows name THIRD PARTIES in a message whose content is about to be gone,
  // which is member data with nothing left to serve. They cascade on a delete; there is
  // no delete here, so they are removed explicitly.
  await db.query('DELETE FROM message_mentions WHERE message_id = ANY($1::bigint[])', [ids]);

  // THE GUARDS ARE REPEATED HERE, and that is not belt-and-braces (D-241). The ids were
  // read at the top of this function and the media walk happens in between, so a hold, a
  // report or a destruction request arriving in that gap is invisible to the SELECT. The
  // evidence hold has a trigger underneath it since migration 071; these two do not, and
  // repeating the clauses costs one predicate.
  const { rowCount: swept } = await db.query(
    `UPDATE messages m SET ${CLEAR_CONTENT}
      WHERE m.id = ANY($1::bigint[])
        AND NOT EXISTS (SELECT 1 FROM evidence_holds h WHERE h.message_id = m.id)
        AND NOT EXISTS (SELECT 1 FROM reports r WHERE r.message_id = m.id)
        AND NOT EXISTS (SELECT 1 FROM pending_destructions d WHERE d.message_id = m.id)`,
    [ids],
  );

  let filesRemoved = 0;
  for (const p of paths) if (await unlinkOne(p)) filesRemoved += 1;
  for (const id of ids) forgetMediaFailures(id);

  return {
    swept: swept ?? 0,
    filesRemoved,
    linksRemoved: linksRemoved ?? 0,
  };
}

/**
 * Unlinks one file. ENOENT is success; anything else is a fault and is rethrown.
 *
 * The errno ONLY, never the message: Node embeds the absolute path in it, and that path
 * contains the member's own uploaded filename - the very identifier this sweep exists to
 * remove. `destroy.ts` learned that the hard way and the reasoning is the same here.
 */
async function unlinkOne(absPath: string): Promise<boolean> {
  try {
    await unlink(absPath);
    return true;
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') return false;
    throw new Error(`retention: unlink failed (${code ?? 'unknown'}); path withheld.`);
  }
}

/* ────────────────────────────────────────────────────────────────────────────
 * The timer
 * ──────────────────────────────────────────────────────────────────────────── */

/**
 * ── AGE AND SCHEDULE ARE SEPARATE THINGS (CCB-S5-054 revision) ───────────────
 *
 * The first build ran hourly from boot, which made WHEN a message was erased depend on
 * when the process last restarted: a deployment that came up at 14:37 erased at 14:37,
 * 15:37, and so on, and one that came up ten minutes later erased ten minutes later.
 * Nothing was wrong with the resulting set - the bound decides what goes, and the bound is
 * an AGE - but the operator could not say when anything would happen, and a control that
 * erases needs a time you can predict and be present for.
 *
 * So the sweep is a nightly job at local midnight, and the two questions stay apart:
 * **the bound decides WHAT is old enough; the schedule decides WHEN the pass runs.**
 * Take everything older than the bound, once a night.
 *
 * ── AND IT DELIBERATELY DOES NOT RUN AT BOOT ─────────────────────────────────
 *
 * The destruction sweeper does, and should: it is a backstop under a member's own erasure
 * request, and a host that was down when a hold expired owes that member a run on the way
 * back up. This is the opposite case. A boot run would put erasure back on the restart
 * clock, which is the thing being fixed, and missing a night costs nothing: the next pass
 * takes everything older than the bound, so a skipped night is included tomorrow rather
 * than lost. Nothing is ever kept LONGER than the bound plus one day, and the page shows
 * both the next run and how many are waiting, so an overdue sweep is visible rather than
 * silent. If the operator wants it now, "Sweep now" is the button for that.
 */

/**
 * The next local midnight after `now`.
 *
 * LOCAL rather than UTC because the operator is the one deciding to be awake for it, and
 * the page prints the resolved date and time beside the control so there is nothing to
 * work out. `setHours(24, ...)` rolls into the next day correctly across month, year and
 * daylight-saving boundaries, which is why the arithmetic is left to the Date object; a
 * hand-rolled `+ 86_400_000` is wrong twice a year.
 *
 * At exactly midnight this returns the NEXT one rather than now, so a pass that finishes
 * inside the same millisecond cannot re-arm itself into an immediate second run.
 */
export function nextMidnight(now: Date): Date {
  const next = new Date(now.getTime());
  next.setHours(24, 0, 0, 0);
  return next;
}

/** Milliseconds until the next local midnight. At least 1, so a timer always waits. */
export function msUntilNextMidnight(now: Date): number {
  return Math.max(1, nextMidnight(now).getTime() - now.getTime());
}

export interface RetentionRunner {
  /** Runs one pass now. Returns null when retention is switched off. */
  runOnce(): Promise<SweepOutcome | null>;
}

/**
 * One pass: read the setting, and do nothing loudly if it is off.
 *
 * "Not configured" and "configured but failing" are different states and are reported
 * differently (CCB-S3-023). Off is a choice and says so at debug; a pass that throws is
 * a fault on the consent path and reaches `status.error`, because a retention promise
 * that quietly stopped being kept is indistinguishable from one that never was.
 */
export function retentionRunner(
  db: Queryable,
  mediaRoot: string,
  withTransaction: <R>(fn: (tx: Queryable) => Promise<R>) => Promise<R>,
  now: () => Date = () => new Date(),
): RetentionRunner {
  return {
    async runOnce(): Promise<SweepOutcome | null> {
      const settings = await getRetentionSettings(db);
      if (!settings.enabled) {
        log.debug('Retention: switched off; nothing swept.');
        return null;
      }
      const cutoff = cutoffFor(settings.hours, now());
      const outcome = await withTransaction((tx) => sweepUnconsented(tx, mediaRoot, cutoff));
      if (outcome.swept > 0) {
        log.info(
          `Retention: ${String(outcome.swept)} message(s) past the ${String(settings.hours)}h ` +
            `bound now hold no content (${String(outcome.filesRemoved)} media file(s) removed, ` +
            `${String(outcome.linksRemoved)} link row(s) removed).`,
        );
      }
      return outcome;
    },
  };
}

/** Cancels the nightly schedule. */
export interface RetentionSchedule {
  stop(): void;
}

/**
 * Arms the nightly sweep, and re-arms it after every pass.
 *
 * A self-rescheduling `setTimeout` rather than a `setInterval`, because an interval seeded
 * once drifts: each pass takes a different amount of time, and twenty-four hours after the
 * last START is not midnight. Re-reading the clock after each run keeps it on midnight for
 * as long as the process lives, and carries it across daylight saving without a correction.
 *
 * A pass that throws still re-arms. The alternative is a single bad night silently ending
 * retention for the lifetime of the process, which is the shape CCB-S3-023 exists to stop:
 * the failure is loud, and tomorrow is still attempted.
 */
export function startRetentionSweeper(
  runner: RetentionRunner,
  now: () => Date = () => new Date(),
): RetentionSchedule {
  let timer: NodeJS.Timeout | null = null;
  let stopped = false;

  const arm = (): void => {
    if (stopped) return;
    const wait = msUntilNextMidnight(now());
    timer = setTimeout(() => {
      void runner
        .runOnce()
        .catch((err: unknown) => {
          const message = err instanceof Error ? err.message : String(err);
          log.error(`Retention: the sweep failed: ${message}`);
          status.error(
            `The retention sweep failed: ${message} Content nobody consented to is still being kept.`,
          );
        })
        .finally(arm);
    }, wait);
    timer.unref();
  };

  log.info(`Retention: the nightly sweep is armed for ${nextMidnight(now()).toISOString()}.`);
  arm();
  return {
    stop(): void {
      stopped = true;
      if (timer !== null) clearTimeout(timer);
    },
  };
}
