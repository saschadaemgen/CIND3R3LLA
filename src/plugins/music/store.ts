/**
 * The music library's tables (CCB-S5-044, D-216/D-217): tracks, playlists,
 * assignments, and the plays log.
 *
 * Plain readers and writers over migration 063. The DECISIONS live elsewhere:
 * cadence.ts plans a tick, service.ts orchestrates, library.ts owns the files.
 * Nothing here consults the SDK, so every function is answerable in PGlite.
 *
 * ── EVERY AGGREGATE IS DERIVED, NONE IS STORED (D-217 rule 2) ────────────────
 *
 * The DJ sheet's counts, "most played", "popular now", the daily budgets and
 * the minimum gap are all GROUP BY / windowed reads over `cinderella_track_plays`
 * at the moment of asking - the moderation-window pattern. That is what makes
 * "delete only my music preferences" cheap when the memory work lands: deleting
 * the rows deletes everything derived from them, because nothing derived was
 * ever stored.
 */

import type { Queryable } from '../../db/pool.js';

export type TrackKind = 'music' | 'audiobook' | 'documentary' | 'spot';
export const TRACK_KINDS: readonly TrackKind[] = ['music', 'audiobook', 'documentary', 'spot'];

export interface Track {
  id: number;
  kind: TrackKind;
  title: string;
  artist: string | null;
  album: string | null;
  genre: string | null;
  durationSeconds: number | null;
  filePath: string;
  fileSize: number;
  mime: string;
  coverPath: string | null;
  encodedPath: string | null;
  encodedAt: Date | null;
  encodeVersion: number | null;
  uploadedAt: Date;
}

interface TrackRow {
  id: string | number;
  kind: string;
  title: string;
  artist: string | null;
  album: string | null;
  genre: string | null;
  duration_seconds: number | null;
  file_path: string;
  file_size: string | number;
  mime: string;
  cover_path: string | null;
  encoded_path: string | null;
  encoded_at: string | Date | null;
  encode_version: number | null;
  uploaded_at: string | Date;
}

function mapTrack(r: TrackRow): Track {
  return {
    id: Number(r.id),
    kind: r.kind as TrackKind,
    title: r.title,
    artist: r.artist,
    album: r.album,
    genre: r.genre,
    durationSeconds: r.duration_seconds,
    filePath: r.file_path,
    fileSize: Number(r.file_size),
    mime: r.mime,
    coverPath: r.cover_path,
    encodedPath: r.encoded_path,
    encodedAt: r.encoded_at === null ? null : new Date(r.encoded_at),
    encodeVersion: r.encode_version,
    uploadedAt: new Date(r.uploaded_at),
  };
}

export interface NewTrack {
  kind: TrackKind;
  title: string;
  artist: string | null;
  album: string | null;
  genre: string | null;
  durationSeconds: number | null;
  filePath: string;
  fileSize: number;
  mime: string;
  coverPath: string | null;
}

export async function insertTrack(db: Queryable, t: NewTrack): Promise<number> {
  const { rows } = await db.query<{ id: string }>(
    `INSERT INTO cinderella_tracks
       (kind, title, artist, album, genre, duration_seconds, file_path, file_size, mime, cover_path)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
     RETURNING id`,
    [t.kind, t.title, t.artist, t.album, t.genre, t.durationSeconds, t.filePath, t.fileSize, t.mime, t.coverPath],
  );
  return Number(rows[0]?.id);
}

export async function updateTrackMeta(
  db: Queryable,
  id: number,
  m: { kind: TrackKind; title: string; artist: string | null; album: string | null; genre: string | null },
): Promise<boolean> {
  const result = await db.query(
    `UPDATE cinderella_tracks
        SET kind = $2, title = $3, artist = $4, album = $5, genre = $6, updated_at = now()
      WHERE id = $1`,
    [id, m.kind, m.title, m.artist, m.album, m.genre],
  );
  return result.rowCount === 1;
}

export async function setTrackCover(db: Queryable, id: number, coverPath: string | null): Promise<void> {
  // A cover change invalidates the cached encode: the video IS the cover.
  await db.query(
    `UPDATE cinderella_tracks
        SET cover_path = $2, encoded_path = NULL, encoded_at = NULL, encode_version = NULL,
            updated_at = now()
      WHERE id = $1`,
    [id, coverPath],
  );
}

export async function setTrackEncoded(
  db: Queryable,
  id: number,
  encodedPath: string,
  version: number,
): Promise<void> {
  await db.query(
    `UPDATE cinderella_tracks
        SET encoded_path = $2, encoded_at = now(), encode_version = $3, updated_at = now()
      WHERE id = $1`,
    [id, encodedPath, version],
  );
}

export async function getTrack(db: Queryable, id: number): Promise<Track | null> {
  const { rows } = await db.query<TrackRow>(`SELECT * FROM cinderella_tracks WHERE id = $1`, [id]);
  return rows[0] === undefined ? null : mapTrack(rows[0]);
}

export async function listTracks(db: Queryable): Promise<Track[]> {
  const { rows } = await db.query<TrackRow>(
    `SELECT * FROM cinderella_tracks ORDER BY title, id`,
  );
  return rows.map(mapTrack);
}

/** Deleting a track cascades its playlist memberships and plays; files are the caller's. */
export async function deleteTrack(db: Queryable, id: number): Promise<Track | null> {
  const track = await getTrack(db, id);
  if (track === null) return null;
  await db.query(`DELETE FROM cinderella_tracks WHERE id = $1`, [id]);
  return track;
}

/* ── playlists ────────────────────────────────────────────────────────────── */

export interface Playlist {
  id: number;
  name: string;
  trackCount: number;
}

export async function createPlaylist(db: Queryable, name: string): Promise<number> {
  const { rows } = await db.query<{ id: string }>(
    `INSERT INTO cinderella_playlists (name) VALUES ($1) RETURNING id`,
    [name],
  );
  return Number(rows[0]?.id);
}

export async function listPlaylists(db: Queryable): Promise<Playlist[]> {
  const { rows } = await db.query<{ id: string | number; name: string; n: string | number }>(
    `SELECT p.id, p.name,
            (SELECT count(*) FROM cinderella_playlist_tracks t WHERE t.playlist_id = p.id) AS n
       FROM cinderella_playlists p
      ORDER BY p.name`,
  );
  return rows.map((r) => ({ id: Number(r.id), name: r.name, trackCount: Number(r.n) }));
}

export async function deletePlaylist(db: Queryable, id: number): Promise<boolean> {
  const result = await db.query(`DELETE FROM cinderella_playlists WHERE id = $1`, [id]);
  return result.rowCount === 1;
}

export async function setPlaylistTracks(
  db: Queryable,
  playlistId: number,
  trackIds: readonly number[],
): Promise<void> {
  await db.query(`DELETE FROM cinderella_playlist_tracks WHERE playlist_id = $1`, [playlistId]);
  for (let i = 0; i < trackIds.length; i++) {
    await db.query(
      `INSERT INTO cinderella_playlist_tracks (playlist_id, track_id, position)
       VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`,
      [playlistId, trackIds[i], i],
    );
  }
}

export async function playlistTracks(db: Queryable, playlistId: number): Promise<Track[]> {
  const { rows } = await db.query<TrackRow>(
    `SELECT t.* FROM cinderella_tracks t
       JOIN cinderella_playlist_tracks pt ON pt.track_id = t.id
      WHERE pt.playlist_id = $1
      ORDER BY pt.position, t.id`,
    [playlistId],
  );
  return rows.map(mapTrack);
}

/* ── assignments ──────────────────────────────────────────────────────────── */

export type AssignmentMode = 'on-request' | 'cadence';

export interface PlaylistAssignment {
  id: number;
  botProfileId: number;
  playlistId: number;
  playlistName: string;
  mode: AssignmentMode;
  destGroupId: number | null;
  intervalMinutes: number | null;
  messageCount: number | null;
  lastSentAt: Date | null;
  createdAt: Date;
}

interface AssignmentRow {
  id: string | number;
  bot_profile_id: string | number;
  playlist_id: string | number;
  playlist_name: string;
  mode: string;
  dest_group_id: string | number | null;
  interval_minutes: number | null;
  message_count: number | null;
  last_sent_at: string | Date | null;
  created_at: string | Date;
}

function mapAssignment(r: AssignmentRow): PlaylistAssignment {
  return {
    id: Number(r.id),
    botProfileId: Number(r.bot_profile_id),
    playlistId: Number(r.playlist_id),
    playlistName: r.playlist_name,
    mode: r.mode as AssignmentMode,
    destGroupId: r.dest_group_id === null ? null : Number(r.dest_group_id),
    intervalMinutes: r.interval_minutes,
    messageCount: r.message_count,
    lastSentAt: r.last_sent_at === null ? null : new Date(r.last_sent_at),
    createdAt: new Date(r.created_at),
  };
}

const ASSIGNMENT_SELECT = `SELECT a.*, p.name AS playlist_name
   FROM cinderella_playlist_assignments a
   JOIN cinderella_playlists p ON p.id = a.playlist_id`;

/**
 * Assigns a playlist to a bot, ON-REQUEST - the operator's decision: a cadence
 * is a deliberate choice, never a default, so creation cannot take cadence
 * fields at all and switching modes is its own action.
 */
export async function assignPlaylist(
  db: Queryable,
  botProfileId: number,
  playlistId: number,
): Promise<number> {
  const { rows } = await db.query<{ id: string }>(
    `INSERT INTO cinderella_playlist_assignments (bot_profile_id, playlist_id)
     VALUES ($1, $2)
     ON CONFLICT ON CONSTRAINT cinderella_playlist_assignments_unique DO UPDATE
       SET updated_at = now()
     RETURNING id`,
    [botProfileId, playlistId],
  );
  return Number(rows[0]?.id);
}

export async function setAssignmentCadence(
  db: Queryable,
  id: number,
  c: { destGroupId: number; intervalMinutes: number | null; messageCount: number | null },
): Promise<boolean> {
  const result = await db.query(
    `UPDATE cinderella_playlist_assignments
        SET mode = 'cadence', dest_group_id = $2, interval_minutes = $3, message_count = $4,
            updated_at = now()
      WHERE id = $1`,
    [id, c.destGroupId, c.intervalMinutes, c.messageCount],
  );
  return result.rowCount === 1;
}

export async function setAssignmentOnRequest(db: Queryable, id: number): Promise<boolean> {
  const result = await db.query(
    `UPDATE cinderella_playlist_assignments
        SET mode = 'on-request', dest_group_id = NULL, interval_minutes = NULL,
            message_count = NULL, updated_at = now()
      WHERE id = $1`,
    [id],
  );
  return result.rowCount === 1;
}

export async function removeAssignment(db: Queryable, id: number): Promise<boolean> {
  const result = await db.query(
    `DELETE FROM cinderella_playlist_assignments WHERE id = $1`,
    [id],
  );
  return result.rowCount === 1;
}

/** The playlists THIS bot holds - the absent-capability boundary the harness mutates. */
export async function assignmentsForBot(
  db: Queryable,
  botProfileId: number,
): Promise<PlaylistAssignment[]> {
  const { rows } = await db.query<AssignmentRow>(
    `${ASSIGNMENT_SELECT} WHERE a.bot_profile_id = $1 ORDER BY p.name`,
    [botProfileId],
  );
  return rows.map(mapAssignment);
}

export async function listAssignments(db: Queryable): Promise<PlaylistAssignment[]> {
  const { rows } = await db.query<AssignmentRow>(`${ASSIGNMENT_SELECT} ORDER BY a.id`);
  return rows.map(mapAssignment);
}

export async function getAssignment(db: Queryable, id: number): Promise<PlaylistAssignment | null> {
  const { rows } = await db.query<AssignmentRow>(`${ASSIGNMENT_SELECT} WHERE a.id = $1`, [id]);
  return rows[0] === undefined ? null : mapAssignment(rows[0]);
}

export async function setAssignmentLastSent(db: Queryable, id: number, at: Date): Promise<void> {
  await db.query(
    `UPDATE cinderella_playlist_assignments SET last_sent_at = $2, updated_at = now() WHERE id = $1`,
    [id, at],
  );
}

/* ── the plays log ────────────────────────────────────────────────────────── */

export interface NewPlay {
  trackId: number;
  botProfileId: number;
  groupId: number;
  assignmentId: number | null;
  requested: boolean;
  kindAtPlay: TrackKind;
  /**
   * ALWAYS NULL this briefing (D-217): the consent that would permit a member
   * id does not exist yet, so every play is anonymous. The parameter exists so
   * the memory work changes a call site, not a schema.
   */
  memberId: string | null;
  playedAt: Date;
}

export async function recordPlay(db: Queryable, p: NewPlay): Promise<number> {
  const { rows } = await db.query<{ id: string }>(
    `INSERT INTO cinderella_track_plays
       (track_id, bot_profile_id, group_id, assignment_id, requested, kind_at_play, member_id, played_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     RETURNING id`,
    [p.trackId, p.botProfileId, p.groupId, p.assignmentId, p.requested, p.kindAtPlay, p.memberId, p.playedAt],
  );
  return Number(rows[0]?.id);
}

/**
 * Unbidden sends already spent in this room today, and the most recent one,
 * per budget class - the whole budget question in one derived read. "Today" is
 * the UTC day of `now`, which is one honest arbitrary boundary rather than N
 * configurable ones.
 */
export async function unbiddenSpend(
  db: Queryable,
  groupId: number,
  spotClass: boolean,
  now: Date,
): Promise<{ today: number; lastAt: Date | null }> {
  const { rows } = await db.query<{ n: string | number; last: string | Date | null }>(
    `SELECT count(*) FILTER (WHERE played_at >= date_trunc('day', $2::timestamptz)) AS n,
            max(played_at) AS last
       FROM cinderella_track_plays
      WHERE group_id = $1 AND NOT requested
        AND (CASE WHEN $3 THEN kind_at_play = 'spot' ELSE kind_at_play <> 'spot' END)`,
    [groupId, now, spotClass],
  );
  const r = rows[0];
  return {
    today: Number(r?.n ?? 0),
    lastAt: r?.last == null ? null : new Date(r.last),
  };
}

/**
 * The next track for a cadence assignment: SHUFFLE WITHOUT REPLACEMENT,
 * derived - the track in the playlist with the fewest plays under this
 * assignment, ties broken by longest-unplayed, then lowest id. Every track
 * plays once before any plays twice, with no cycle state stored anywhere.
 */
export async function nextCadenceTrack(
  db: Queryable,
  assignmentId: number,
  playlistId: number,
): Promise<Track | null> {
  const { rows } = await db.query<TrackRow>(
    `SELECT t.* FROM cinderella_tracks t
       JOIN cinderella_playlist_tracks pt ON pt.track_id = t.id AND pt.playlist_id = $2
       LEFT JOIN cinderella_track_plays pl
         ON pl.track_id = t.id AND pl.assignment_id = $1
      GROUP BY t.id
      ORDER BY count(pl.id) ASC, max(pl.played_at) ASC NULLS FIRST, t.id ASC
      LIMIT 1`,
    [assignmentId, playlistId],
  );
  return rows[0] === undefined ? null : mapTrack(rows[0]);
}

/* ── the DJ sheet (all derived; D-217 rule 2) ─────────────────────────────── */

export interface LibraryFacts {
  totalTracks: number;
  byKind: { kind: TrackKind; count: number }[];
  /** The genre vocabulary IS the library's own GROUP BY - she cannot invent one. */
  byGenre: { genre: string; count: number }[];
  mostPlayed: { title: string; artist: string | null; plays: number }[];
  /** The last seven days, so "popular now" means now. */
  popularNow: { title: string; artist: string | null; plays: number }[];
}

export async function libraryFacts(db: Queryable, now: Date): Promise<LibraryFacts> {
  const total = await db.query<{ n: string | number }>(
    `SELECT count(*) AS n FROM cinderella_tracks`,
  );
  const kinds = await db.query<{ kind: string; n: string | number }>(
    `SELECT kind, count(*) AS n FROM cinderella_tracks GROUP BY kind ORDER BY count(*) DESC`,
  );
  // Comma-separated genres SPLIT (the first-use report): "Folk, Shanty" is two
  // genres on one track, and the vocabulary she is handed must say so. Derived
  // at read like everything else here - the column keeps the operator's string.
  const genres = await db.query<{ genre: string; n: string | number }>(
    `SELECT btrim(g) AS genre, count(*) AS n
       FROM cinderella_tracks, unnest(string_to_array(genre, ',')) AS g
      WHERE genre IS NOT NULL AND btrim(g) <> ''
      GROUP BY btrim(g) ORDER BY count(*) DESC, btrim(g)`,
  );
  const most = await db.query<{ title: string; artist: string | null; n: string | number }>(
    `SELECT t.title, t.artist, count(*) AS n
       FROM cinderella_track_plays p JOIN cinderella_tracks t ON t.id = p.track_id
      GROUP BY t.id, t.title, t.artist ORDER BY count(*) DESC, t.title LIMIT 5`,
  );
  const recent = await db.query<{ title: string; artist: string | null; n: string | number }>(
    `SELECT t.title, t.artist, count(*) AS n
       FROM cinderella_track_plays p JOIN cinderella_tracks t ON t.id = p.track_id
      WHERE p.played_at >= $1::timestamptz - interval '7 days'
      GROUP BY t.id, t.title, t.artist ORDER BY count(*) DESC, t.title LIMIT 5`,
    [now],
  );
  return {
    totalTracks: Number(total.rows[0]?.n ?? 0),
    byKind: kinds.rows.map((r) => ({ kind: r.kind as TrackKind, count: Number(r.n) })),
    byGenre: genres.rows.map((r) => ({ genre: r.genre, count: Number(r.n) })),
    mostPlayed: most.rows.map((r) => ({ title: r.title, artist: r.artist, plays: Number(r.n) })),
    popularNow: recent.rows.map((r) => ({ title: r.title, artist: r.artist, plays: Number(r.n) })),
  };
}

/**
 * Finds a track BY TITLE among the playlists this bot holds - "play me this".
 * Case-insensitive exact first, then substring; scoped to the bot's own
 * assignments so a title in a playlist it was never given is unfindable, which
 * is the absent-capability property at the data layer.
 */
export async function findTrackForBot(
  db: Queryable,
  botProfileId: number,
  title: string,
): Promise<Track | null> {
  const scoped = `FROM cinderella_tracks t
       JOIN cinderella_playlist_tracks pt ON pt.track_id = t.id
       JOIN cinderella_playlist_assignments a
         ON a.playlist_id = pt.playlist_id AND a.bot_profile_id = $1`;
  const exact = await db.query<TrackRow>(
    `SELECT DISTINCT t.* ${scoped} WHERE lower(t.title) = lower($2) LIMIT 1`,
    [botProfileId, title],
  );
  if (exact.rows[0] !== undefined) return mapTrack(exact.rows[0]);
  const partial = await db.query<TrackRow>(
    `SELECT DISTINCT t.* ${scoped} WHERE t.title ILIKE '%' || $2 || '%' ORDER BY t.id LIMIT 1`,
    [botProfileId, title],
  );
  return partial.rows[0] === undefined ? null : mapTrack(partial.rows[0]);
}

/**
 * Is this exact track reachable by this bot through ANY of its assignments?
 * The number path resolves a track id out of a list SHE showed, but the check
 * stays: a stale context, a removed assignment, or a crafted number must not
 * let a bot play past the playlist boundary (the briefing-named mutation's
 * guarantee, held for ids exactly as for titles).
 */
export async function trackReachableByBot(
  db: Queryable,
  botProfileId: number,
  trackId: number,
): Promise<boolean> {
  const { rows } = await db.query<{ one: number }>(
    `SELECT 1 AS one FROM cinderella_playlist_tracks pt
       JOIN cinderella_playlist_assignments a
         ON a.playlist_id = pt.playlist_id AND a.bot_profile_id = $1
      WHERE pt.track_id = $2
      LIMIT 1`,
    [botProfileId, trackId],
  );
  return rows.length > 0;
}

/** A random track from ONE named playlist, scoped to the bot - "play 2" over a playlists list. */
export async function randomTrackFromPlaylistForBot(
  db: Queryable,
  botProfileId: number,
  playlistName: string,
): Promise<Track | null> {
  const { rows } = await db.query<TrackRow>(
    `SELECT * FROM (
       SELECT DISTINCT t.* FROM cinderella_tracks t
         JOIN cinderella_playlist_tracks pt ON pt.track_id = t.id
         JOIN cinderella_playlist_assignments a
           ON a.playlist_id = pt.playlist_id AND a.bot_profile_id = $1
         JOIN cinderella_playlists p ON p.id = pt.playlist_id
        WHERE lower(p.name) = lower($2)
     ) s ORDER BY random() LIMIT 1`,
    [botProfileId, playlistName],
  );
  return rows[0] === undefined ? null : mapTrack(rows[0]);
}

/**
 * A random track of one GENRE this bot can reach - the ladder's last rung
 * (D-220). Scoped through the assignments like every other read here, so the
 * rung cannot step over the playlist boundary; the genre is matched against
 * the same comma-split vocabulary the DJ sheet is derived from.
 */
export async function randomTrackByGenreForBot(
  db: Queryable,
  botProfileId: number,
  genre: string,
): Promise<Track | null> {
  const { rows } = await db.query<TrackRow>(
    `SELECT * FROM (
       SELECT DISTINCT t.* FROM cinderella_tracks t
         JOIN cinderella_playlist_tracks pt ON pt.track_id = t.id
         JOIN cinderella_playlist_assignments a
           ON a.playlist_id = pt.playlist_id AND a.bot_profile_id = $1
        WHERE t.genre IS NOT NULL
          AND EXISTS (
            SELECT 1 FROM unnest(string_to_array(t.genre, ',')) AS g
             WHERE lower(btrim(g)) = lower(btrim($2))
          )
     ) s ORDER BY random() LIMIT 1`,
    [botProfileId, genre],
  );
  return rows[0] === undefined ? null : mapTrack(rows[0]);
}

/**
 * The DJ sheet PER BOT (D-220): what this bot can actually reach through its
 * assignments, because the deployment-wide sheet advertised genres a second
 * bot could never play - "she cannot claim a genre she does not hold" is
 * D-216's own sentence and the deployment-wide numbers broke it. The console's
 * library page keeps the deployment view; this is what SHE is told about
 * herself.
 */
export async function libraryFactsForBot(
  db: Queryable,
  botProfileId: number,
): Promise<{ tracks: number; genres: string[] }> {
  const total = await db.query<{ n: string | number }>(
    `SELECT count(DISTINCT t.id) AS n FROM cinderella_tracks t
       JOIN cinderella_playlist_tracks pt ON pt.track_id = t.id
       JOIN cinderella_playlist_assignments a
         ON a.playlist_id = pt.playlist_id AND a.bot_profile_id = $1`,
    [botProfileId],
  );
  const genres = await db.query<{ genre: string }>(
    `SELECT btrim(g) AS genre, count(DISTINCT t.id) AS n
       FROM cinderella_tracks t
       JOIN cinderella_playlist_tracks pt ON pt.track_id = t.id
       JOIN cinderella_playlist_assignments a
         ON a.playlist_id = pt.playlist_id AND a.bot_profile_id = $1,
       unnest(string_to_array(t.genre, ',')) AS g
      WHERE t.genre IS NOT NULL AND btrim(g) <> ''
      GROUP BY btrim(g) ORDER BY count(DISTINCT t.id) DESC, btrim(g)`,
    [botProfileId],
  );
  return { tracks: Number(total.rows[0]?.n ?? 0), genres: genres.rows.map((r) => r.genre) };
}

/** A random track from this bot's playlists - "play me something". */
export async function randomTrackForBot(
  db: Queryable,
  botProfileId: number,
): Promise<Track | null> {
  // DISTINCT and ORDER BY random() cannot share a level (the expression must be
  // selectable), so the dedup runs inside and the shuffle outside.
  const { rows } = await db.query<TrackRow>(
    `SELECT * FROM (
       SELECT DISTINCT t.* FROM cinderella_tracks t
         JOIN cinderella_playlist_tracks pt ON pt.track_id = t.id
         JOIN cinderella_playlist_assignments a
           ON a.playlist_id = pt.playlist_id AND a.bot_profile_id = $1
     ) s ORDER BY random() LIMIT 1`,
    [botProfileId],
  );
  return rows[0] === undefined ? null : mapTrack(rows[0]);
}
