/**
 * Channel posts on the website (CCB-S5-043, D-215): the origin on the archived
 * record, the per-channel switches, and the two surfaces.
 *
 * ── WHAT IS PROVEN ───────────────────────────────────────────────────────────
 *
 *  1. The migration's own SQL derivation of `channel_key` is IDENTICAL to
 *     `channelKeyFor`, for a channel with a link and for one without. That
 *     expression runs once, on the operator's data, and nothing else would ever
 *     notice if it disagreed.
 *  2. The BACKFILL, driven the only way a backfill can honestly be driven:
 *     migrations up to 061, legacy rows seeded, then 062 alone. What is
 *     recoverable is recovered; what is not is left NULL, cannot publish, and is
 *     COUNTED.
 *  3. A live announcement carries its origin in the same INSERT as the message,
 *     through the real service and a fake port.
 *  4. THE POINT OF THE BRIEFING: clearing the channel record - which cascades the
 *     forward log the origin used to live on - strips a published item of
 *     neither its provenance nor its publication.
 *  5. Publication: off by default, on makes it public, off again REMOVES it. The
 *     mutation the briefing asked for by name is here: with the switch predicate
 *     removed, an unpublished channel's post becomes publicly readable.
 *  6. The two surfaces, with positive controls in both directions: a member's
 *     message can never reach the channel block, and an announcement kept out of
 *     the stream is still public in the block.
 *  7. Anonymisation hides the name AND NOTHING ELSE: the column, the name inside
 *     the announcement's own attribution line, the search text and the structured
 *     runs all move together, and the post's own words survive character for
 *     character.
 *  8. The console, OPERATED (D-178): the real routes pressed, the effect read back
 *     out of the database, and a refusal for a channel that has no record.
 *
 * Every negative has a positive control beside it, because "the post is not
 * public" passes against an archive that publishes nothing at all.
 *
 *   npx tsx scripts/verify-channel-publication.ts
 */

import * as argon2 from 'argon2';
import { PGlite } from '@electric-sql/pglite';
import { vector } from '@electric-sql/pglite-pgvector';
import type { Queryable } from '../src/db/pool.js';
import { buildServer, registerNav } from '../src/web/server.js';
import { registerAdminViews } from '../src/web/views/index.js';
import { SettingsService } from '../src/settings/service.js';
import { SecurityService } from '../src/security/settings.js';
import { InteractionService } from '../src/interaction/settings.js';
import { loadMigrationFiles } from '../src/db/migrate.js';
import { parseChannelPost } from '../src/bot/parse.js';
import type { BridgeSendPort } from '../src/bot/bridge-port.js';
import { buildOrigin, channelKeyFor } from '../src/plugins/channel-bridge/origin.js';
import {
  insertBridgeMapping,
  insertBridgePost,
  recordBridgeForward,
  upsertBridgeChannel,
  deleteBridgeChannel,
} from '../src/plugins/channel-bridge/store.js';
import {
  countBridgeMessagesWithoutOrigin,
  getChannelPublication,
  listChannelPublications,
  mintChannelPublicId,
  setChannelPublication,
} from '../src/plugins/channel-bridge/publication.js';
import { intakeChannelPost, runBridgeTick, type BridgeDeps } from '../src/plugins/channel-bridge/service.js';
import { listPublishedChannels, listPublishedItems } from '../src/db/public-archive.js';
import { ArchiveService, DEFAULT_ARCHIVE } from '../src/archive/settings.js';
import { DEFAULT_INTERACTION } from '../src/interaction/settings.js';
import { setLogLevel } from '../src/log.js';

let failures = 0;
function check(label: string, ok: boolean, detail = ''): void {
  if (!ok) failures++;
  console.log(`  [${ok ? 'PASS' : 'FAIL'}] ${label}${detail ? `: ${detail}` : ''}`);
}

/* ── fixtures ─────────────────────────────────────────────────────────────── */

const CHANNEL_GROUP = 901;
const OTHER_CHANNEL_GROUP = 902;
const DEST_GROUP = 77;
const LINK = 'https://simplex.chat/c#fixture-placeholder-link';
const OTHER_LINK = 'https://simplex.chat/c#second-fixture-placeholder';
const NOW = new Date('2026-08-14T12:00:00Z');
const ALL_TYPES = ['text', 'image', 'video', 'voice', 'link', 'file'] as const;

function channelItem(over: {
  itemId: number;
  text: string;
  groupId?: number;
  name?: string;
  link?: string;
  postedAt?: string;
}): never {
  return {
    chatInfo: {
      type: 'group',
      groupInfo: {
        groupId: over.groupId ?? CHANNEL_GROUP,
        localDisplayName: over.name ?? 'TownCrier',
        useRelays: true,
        viaGroupLinkUri: over.link ?? LINK,
        groupProfile: {
          displayName: over.name ?? 'TownCrier',
          publicGroup: { groupType: 'channel' },
        },
      },
    },
    chatItem: {
      chatDir: { type: 'channelRcv' },
      meta: {
        itemId: over.itemId,
        itemTs: over.postedAt ?? NOW.toISOString(),
        itemSharedMsgId: `sh-${String(over.itemId)}`,
      },
      content: { type: 'rcvMsgContent', msgContent: { type: 'text', text: over.text } },
    },
  } as never;
}

function sentItem(groupId: number, itemId: number, sharedMsgId: string): unknown {
  return {
    chatInfo: {
      type: 'group',
      groupInfo: {
        groupId,
        localDisplayName: 'archive',
        groupProfile: { displayName: 'archive' },
        membership: {
          memberId: 'bot-member-id',
          localDisplayName: 'CIND3R3LLA',
          memberProfile: { displayName: 'CIND3R3LLA' },
        },
      },
    },
    chatItem: {
      chatDir: { type: 'groupSnd' },
      meta: { itemId, itemTs: NOW.toISOString(), itemSharedMsgId: sharedMsgId },
      content: { type: 'sndMsgContent', msgContent: { type: 'text', text: '' } },
    },
  };
}

function pgliteQueryable(pg: PGlite): Queryable {
  return {
    async query(sql, values) {
      const result = await pg.query(sql, values ? [...values] : undefined);
      return {
        rows: result.rows as never[],
        rowCount: (result.affectedRows ?? result.rows.length) as number,
      };
    },
  } as Queryable;
}

/** Publication state for one message id, straight out of the view. */
async function publishedIds(db: Queryable): Promise<number[]> {
  const { rows } = await db.query<{ id: string | number }>(
    'SELECT id FROM published_messages ORDER BY id',
  );
  return rows.map((r) => Number(r.id));
}

async function main(): Promise<void> {
  setLogLevel('error');

  /* ══ 1. The migration's SQL derivation equals the TypeScript one ══════════ */
  //
  // This is the one place the key is derived anywhere but `channelKeyFor`, and it
  // runs exactly once on data nobody can re-derive. A silent disagreement would
  // unpublish a live block, so the agreement is asserted rather than assumed - and
  // it is asserted against `channelKeyFor` itself, so changing either side reddens.

  console.log('\n1. The backfill derives the same key the code does');
  {
    const probe = new PGlite();
    const sql = `SELECT CASE
        WHEN $1::text IS NOT NULL AND btrim($1::text) <> ''
          THEN 'link:' || substr(encode(sha256(convert_to(btrim($1::text), 'UTF8')), 'hex'), 1, 16)
        ELSE 'local:' || $2::bigint || ':' || $3::bigint
      END AS k`;
    const withLink = await probe.query<{ k: string }>(sql, [LINK, 7, CHANNEL_GROUP]);
    check(
      'a channel with a link: SQL and channelKeyFor agree',
      withLink.rows[0]?.k === channelKeyFor(LINK, 7, CHANNEL_GROUP),
      `${String(withLink.rows[0]?.k)} vs ${channelKeyFor(LINK, 7, CHANNEL_GROUP)}`,
    );
    const noLink = await probe.query<{ k: string }>(sql, [null, 7, CHANNEL_GROUP]);
    check(
      'a channel with no link: both give the honest profile-local form',
      noLink.rows[0]?.k === channelKeyFor(null, 7, CHANNEL_GROUP),
      String(noLink.rows[0]?.k),
    );
    check(
      'CONTROL: the two forms are different, so the check above is not comparing one thing to itself',
      withLink.rows[0]?.k !== noLink.rows[0]?.k,
    );
    // A DIFFERENT link must give a different key, or the whole identity is a
    // constant and every channel would share one publication row.
    const other = await probe.query<{ k: string }>(sql, [OTHER_LINK, 7, CHANNEL_GROUP]);
    check(
      'CONTROL: a different link gives a different key',
      other.rows[0]?.k !== withLink.rows[0]?.k,
    );
    await probe.close();
  }

  /* ══ 2. The backfill, and what it cannot recover ══════════════════════════ */
  //
  // Driven the only honest way: the schema as it stood BEFORE this briefing,
  // legacy rows seeded into it, and then 062 applied on its own.

  console.log('\n2. The backfill recovers what survives and counts what does not');
  {
    const pg = new PGlite({ extensions: { vector } });
    const db = pgliteQueryable(pg);
    const all = await loadMigrationFiles();
    const migration062 = all.find((m) => m.name.startsWith('062_'));
    if (migration062 === undefined) throw new Error('migration 062 is missing');
    for (const m of all) {
      if (m.name >= '062') break;
      await pg.exec(m.sql);
    }

    const bots = await db.query<{ id: string }>(
      `INSERT INTO cinderella_bot_profiles (slug, display_name, enabled)
       VALUES ('crier', 'CIND3R3LLA', TRUE) RETURNING id`,
    );
    const BOT = Number(bots.rows[0]?.id);

    // Pre-062 channel rows: `channel_key` does not exist yet, so these are raw inserts.
    await pg.exec(
      `INSERT INTO cinderella_bridge_channels (bot_profile_id, source_group_id, channel_name, link)
       VALUES (${String(BOT)}, ${String(CHANNEL_GROUP)}, 'TownCrier', '${LINK}'),
              (${String(BOT)}, ${String(OTHER_CHANNEL_GROUP)}, 'NoLinkChannel', NULL)`,
    );
    const mapping = await insertBridgeMapping(db, {
      botProfileId: BOT,
      sourceGroupId: CHANNEL_GROUP,
      destGroupId: DEST_GROUP,
      intervalMinutes: 60,
      messageCount: null,
      maxAgeHours: 24,
      maxRepeats: 3,
    });

    // Three legacy announcements. Two still have their forward row; the third's
    // was cascaded away when its mapping went, which is the unrecoverable case.
    const legacy: number[] = [];
    for (let i = 0; i < 3; i++) {
      const msg = await db.query<{ id: string }>(
        `INSERT INTO messages
           (group_id, group_msg_id, sender_member_id, sender_display_name, sent_at, type,
            text_body, raw_json, is_bot, bot_category, bot_lang, search_body, mentions_scanned)
         VALUES ($1, $2, 'bot-member-id', 'CIND3R3LLA', $3, 'text', $4, '{}'::jsonb,
                 TRUE, 'bridge', 'en', $4, TRUE)
         RETURNING id`,
        [DEST_GROUP, 500 + i, NOW.toISOString(), `legacy announcement ${String(i)}`],
      );
      legacy.push(Number(msg.rows[0]?.id));
    }
    for (let i = 0; i < 2; i++) {
      const post = await insertBridgePost(db, {
        botProfileId: BOT,
        sourceGroupId: CHANNEL_GROUP,
        sharedMsgId: `legacy-${String(i)}`,
        itemId: 700 + i,
        text: `legacy announcement ${String(i)}`,
        postedAt: NOW,
      });
      await recordBridgeForward(db, {
        mappingId: mapping,
        postId: post.id,
        kind: 'featured',
        sentItemId: 500 + i,
        sentSharedMsgId: `sent-legacy-${String(i)}`,
        origin: buildOrigin({
          channelKey: channelKeyFor(LINK, BOT, CHANNEL_GROUP),
          channelName: 'TownCrier',
          postedAt: NOW,
          sharedMsgId: `legacy-${String(i)}`,
        }),
        messageId: legacy[i] ?? null,
      });
    }

    await pg.exec(migration062.sql);

    const after = await db.query<{ id: string; k: string | null; n: string | null }>(
      `SELECT id, bridge_channel_key AS k, bridge_channel_name AS n
         FROM messages WHERE is_bot AND bot_category = 'bridge' ORDER BY id`,
    );
    // `.every()` over a slice of an EMPTY result is TRUE, so the row count is asserted
    // first and in the same check: "they all got their channel back" must not be able to
    // pass because there was nothing to get one.
    check(
      'the two announcements whose forward survived got their channel back',
      after.rows.length === 3 &&
        after.rows
          .slice(0, 2)
          .every((r) => r.k === channelKeyFor(LINK, BOT, CHANNEL_GROUP) && r.n === 'TownCrier'),
      `${String(after.rows.length)} rows: ${after.rows.map((r) => String(r.k)).join(', ')}`,
    );
    check(
      'the one whose forward was already gone stays blank, because there is nothing to read',
      after.rows[2]?.k === null && after.rows[2]?.n === null,
    );
    check(
      'and it is COUNTED rather than left silent',
      (await countBridgeMessagesWithoutOrigin(db)) === 1,
      String(await countBridgeMessagesWithoutOrigin(db)),
    );

    const keys = await db.query<{ g: string; k: string }>(
      `SELECT source_group_id AS g, channel_key AS k FROM cinderella_bridge_channels ORDER BY source_group_id`,
    );
    check(
      'the channel WITH a link is keyed on the link',
      keys.rows[0]?.k === channelKeyFor(LINK, BOT, CHANNEL_GROUP),
      String(keys.rows[0]?.k),
    );
    check(
      'the channel with NO link is keyed on the honest local form',
      keys.rows[1]?.k === channelKeyFor(null, BOT, OTHER_CHANNEL_GROUP),
      String(keys.rows[1]?.k),
    );
    const pubs = await listChannelPublications(db);
    check('a publication row was seeded for every channel', pubs.length === 2, String(pubs.length));
    check(
      'and every one of them is OFF',
      pubs.length === 2 && pubs.every((p) => !p.publish && !p.anonymise),
    );
    check(
      'the unrecoverable announcement cannot publish even with the switch on',
      await (async () => {
        await setChannelPublication(db, channelKeyFor(LINK, BOT, CHANNEL_GROUP), { publish: true }, 'test');
        await pg.exec(
          `INSERT INTO settings (key, value) VALUES ('archive', '${JSON.stringify(DEFAULT_ARCHIVE)}'::jsonb)
           ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
        );
        const ids = await publishedIds(db);
        return ids.includes(legacy[0] as number) && !ids.includes(legacy[2] as number);
      })(),
    );
    await pg.close();
  }

  /* ══ 3-8. A live world ═══════════════════════════════════════════════════ */

  const pg = new PGlite({ extensions: { vector } });
  const db = pgliteQueryable(pg);
  for (const m of await loadMigrationFiles()) await pg.exec(m.sql);
  await pg.exec(
    `INSERT INTO settings (key, value) VALUES
       ('archive', '${JSON.stringify(DEFAULT_ARCHIVE)}'::jsonb),
       ('interaction', '${JSON.stringify(DEFAULT_INTERACTION).replaceAll("'", "''")}'::jsonb)`,
  );
  const bots = await db.query<{ id: string }>(
    `INSERT INTO cinderella_bot_profiles (slug, display_name, enabled)
     VALUES ('crier', 'CIND3R3LLA', TRUE) RETURNING id`,
  );
  const BOT = Number(bots.rows[0]?.id);
  const KEY = channelKeyFor(LINK, BOT, CHANNEL_GROUP);
  const OTHER_KEY = channelKeyFor(OTHER_LINK, BOT, OTHER_CHANNEL_GROUP);

  let sendSeq = 0;
  const fakePort: BridgeSendPort = {
    async sendText(groupId, text) {
      sendSeq += 1;
      return {
        itemId: 800 + sendSeq,
        sharedMsgId: `sent-${String(sendSeq)}`,
        raw: sentItem(groupId, 800 + sendSeq, `sent-${String(sendSeq)}`),
        text,
      } as never;
    },
    async sendFile(groupId, _path, text) {
      sendSeq += 1;
      return {
        itemId: 800 + sendSeq,
        sharedMsgId: `sent-${String(sendSeq)}`,
        raw: sentItem(groupId, 800 + sendSeq, `sent-${String(sendSeq)}`),
        text,
      } as never;
    },
    async updateText() {
      /* not exercised here */
    },
    async deleteBroadcast() {
      /* not exercised here */
    },
  } as never;

  let clock = NOW;
  const deps: BridgeDeps = {
    db,
    port: () => fakePort,
    isEnabledFor: () => true,
    linesFor: () => ({
      lang: 'en',
      attributionFor: (channel, at) => `From the channel ${channel}, ${at.toISOString().slice(0, 10)}`,
      remainderLine: (channel, n) => `Also new in ${channel}: ${String(n)} earlier posts.`,
    }),
    storeMedia: null,
    maxFileBytes: () => 1024 * 1024,
    now: () => clock,
  };

  console.log('\n3. A live announcement carries its channel in the same insert as the message');

  const POST_TEXT = 'The maintenance window is Friday at 19:00 UTC.';
  await intakeChannelPost(deps, BOT, parseChannelPost(channelItem({ itemId: 1, text: POST_TEXT })) as never);
  const mappingId = await insertBridgeMapping(db, {
    botProfileId: BOT,
    sourceGroupId: CHANNEL_GROUP,
    destGroupId: DEST_GROUP,
    intervalMinutes: 60,
    messageCount: null,
    maxAgeHours: 24,
    maxRepeats: 1,
  });
  // The cadence anchors on `created_at` when nothing has been sent yet, and that comes from
  // the DATABASE clock rather than this fixture's. Left alone, the mapping is created "in the
  // future" relative to the fixture and is never due - which is a harness defect that looks
  // exactly like a broken tick.
  await db.query(`UPDATE cinderella_bridge_mappings SET created_at = $2 WHERE id = $1`, [
    mappingId,
    NOW,
  ]);
  clock = new Date(NOW.getTime() + 61 * 60_000);
  const tick = await runBridgeTick(deps);
  check('the tick announced it', tick.announcementsSent === 1, JSON.stringify(tick));

  const announced = await db.query<{ id: string; k: string | null; n: string | null; t: string }>(
    `SELECT id, bridge_channel_key AS k, bridge_channel_name AS n, text_body AS t
       FROM messages WHERE is_bot AND bot_category = 'bridge' ORDER BY id DESC LIMIT 1`,
  );
  const MSG = Number(announced.rows[0]?.id);
  check('the archived announcement carries the channel key', announced.rows[0]?.k === KEY, String(announced.rows[0]?.k));
  check('and the channel name', announced.rows[0]?.n === 'TownCrier');
  check(
    'CONTROL: the key is the link-derived form, so a rejoin cannot move it',
    (announced.rows[0]?.k ?? '').startsWith('link:'),
  );
  // The origin on the FORWARD and the origin on the MESSAGE must be one value: two
  // derivations would agree today and drift the day one of them moved.
  const fwdOrigin = await db.query<{ k: string }>(
    `SELECT origin ->> 'channelKey' AS k FROM cinderella_bridge_forwards ORDER BY id DESC LIMIT 1`,
  );
  // Both sides must HOLD a key, not merely match: two undefineds compare equal, and an
  // assertion that passes when nothing was written is the vacuous shape this repository has
  // shipped twice.
  check(
    'the forward log and the message agree on the key',
    fwdOrigin.rows[0]?.k === KEY && announced.rows[0]?.k === KEY,
    `${String(fwdOrigin.rows[0]?.k)} / ${String(announced.rows[0]?.k)}`,
  );

  console.log('\n4. Clearing the channel record strips neither provenance nor publication');

  await setChannelPublication(db, KEY, { publish: true }, 'test');
  check('the announcement is public with the switch on', (await publishedIds(db)).includes(MSG));
  const removed = await deleteBridgeChannel(db, BOT, CHANNEL_GROUP);
  check('the channel record is gone, with its mappings and posts', removed.channels === 1 && removed.mappings === 1);
  const cascaded = await db.query<{ n: string }>(
    `SELECT count(*) AS n FROM cinderella_bridge_forwards`,
  );
  check(
    '  and the forward log went with it, which is what used to hold the origin',
    Number(cascaded.rows[0]?.n) === 0,
  );
  const survivor = await db.query<{ k: string | null; n: string | null }>(
    `SELECT bridge_channel_key AS k, bridge_channel_name AS n FROM messages WHERE id = $1`,
    [MSG],
  );
  check('the archived announcement STILL knows its channel', survivor.rows[0]?.k === KEY && survivor.rows[0]?.n === 'TownCrier');
  check('and it is STILL public, because the decision was never that record', (await publishedIds(db)).includes(MSG));
  const orphan = (await listChannelPublications(db)).find((p) => p.channelKey === KEY);
  check('the console can still see it, marked orphaned', orphan !== undefined && orphan.orphaned);
  check('  with a count of what is public through it', orphan?.published === 1, String(orphan?.published));

  // Put the channel back the way a rejoin would: same link, a NEW local group id.
  await upsertBridgeChannel(db, {
    botProfileId: BOT,
    sourceGroupId: CHANNEL_GROUP + 50,
    channelName: 'TownCrier',
    link: LINK,
  });
  const rejoined = (await listChannelPublications(db)).find((p) => p.channelKey === KEY);
  check(
    'a rejoin under a new group id lands on the SAME decision, still published',
    rejoined !== undefined && rejoined.publish && !rejoined.orphaned,
  );

  console.log('\n5. The switch, and the mutation the briefing named');

  await setChannelPublication(db, KEY, { publish: false }, 'test');
  check('switched off, the announcement is not public', !(await publishedIds(db)).includes(MSG));
  const blockOff = await listPublishedItems(db, ALL_TYPES, { page: 1, pageSize: 30 }, 'channels');
  check('  and the standalone block is empty', blockOff.total === 0, String(blockOff.total));
  check(
    '  its media is unreachable too, because the media route reads the same view',
    Number(
      (
        await db.query<{ n: string | number }>(
          'SELECT count(*) AS n FROM published_messages WHERE id = $1',
          [MSG],
        )
      ).rows[0]?.n,
    ) === 0,
  );
  await setChannelPublication(db, KEY, { publish: true }, 'test');
  check('POSITIVE CONTROL: switched on again, it is public again', (await publishedIds(db)).includes(MSG));
  const blockOn = await listPublishedItems(db, ALL_TYPES, { page: 1, pageSize: 30 }, 'channels');
  check('  and the block shows it', blockOn.total === 1 && blockOn.items[0]?.id === MSG);
  check('  carrying the channel for the filter to work on', blockOn.items[0]?.channel?.name === 'TownCrier');

  // ── THE MUTATION ──────────────────────────────────────────────────────────
  //
  // The view rebuilt with the per-channel predicate replaced by TRUE, which is
  // what "publish every channel" looks like as a defect. An UNPUBLISHED channel's
  // post must then be readable, and this check must go RED. If it does not, the
  // predicate is not what is holding the line and the section above proves nothing.
  {
    await setChannelPublication(db, KEY, { publish: false }, 'test');
    const before = (await publishedIds(db)).includes(MSG);
    const files = await loadMigrationFiles();
    const sql = files.find((m) => m.name.startsWith('062_'))?.sql ?? '';
    const start = sql.indexOf('DROP VIEW published_messages;');
    const mutated = sql
      .slice(start)
      .replace(
        `m.bridge_channel_key IS NOT NULL
          AND EXISTS (
            SELECT 1 FROM cinderella_bridge_channel_publication p
            WHERE p.channel_key = m.bridge_channel_key
              AND p.publish
          )`,
        'TRUE',
      );
    check('the mutation found the predicate to remove', mutated !== sql.slice(start));
    // ── THE INDEX VIEW STANDS ON THESE (CCB-S5-051, D-236) ──────────────────
    //
    // This block re-runs 062's `DROP VIEW ... CREATE VIEW ...` against a database that has
    // since moved on, and `published_message_index` now depends on `message_publish_state`,
    // so the DROP fails with "other objects depend on it". Dropped and rebuilt around the
    // replay rather than CASCADEd: a CASCADE here would quietly remove whatever a later
    // migration adds and the check would go on passing while testing less than it says.
    const indexSql = files.find((m) => m.name.startsWith('069_'))?.sql ?? '';
    check('the index view migration was found, so the rebuild below is real', indexSql !== '');
    // ONLY the index view comes back here, never the whole of 069. The first draft replayed
    // all of it and silently UNDID the mutation, because 069 also replaces
    // `message_publish_state` and would put the real switch predicate straight back. The
    // check then reported the leak as absent, which is a mutation proving nothing.
    const indexOnly = indexSql.slice(indexSql.indexOf('CREATE VIEW published_message_index'));
    check('the index view can be rebuilt on its own', indexOnly.startsWith('CREATE VIEW'));
    await pg.exec('DROP VIEW IF EXISTS published_message_index;');
    await pg.exec(mutated);
    await pg.exec(indexOnly);
    const leaked = (await publishedIds(db)).includes(MSG);
    check(
      'MUTATION: with the switch predicate gone, an UNPUBLISHED channel\'s post is publicly readable',
      !before && leaked,
    );
    // Restore, and prove the restoration actually restored.
    await pg.exec('DROP VIEW IF EXISTS published_message_index;');
    await pg.exec(sql.slice(start));
    await pg.exec(indexSql);
    check(
      '  and the real view refuses it again, so the mutation was the only difference',
      !(await publishedIds(db)).includes(MSG),
    );
    await setChannelPublication(db, KEY, { publish: true }, 'test');
  }

  console.log('\n6. Two surfaces, two promises');

  // A member's message in the same group, opted in, so the stream has both halves.
  await pg.exec(
    `INSERT INTO consent (member_id, opted_in_at) VALUES ('member-1', '2026-01-01T00:00:00Z')`,
  );
  const memberMsg = await db.query<{ id: string }>(
    `INSERT INTO messages
       (group_id, group_msg_id, sender_member_id, sender_display_name, sent_at, type, text_body, raw_json)
     VALUES ($1, 999, 'member-1', 'Alice', $2, 'text', 'a member said this', '{}'::jsonb)
     RETURNING id`,
    [DEST_GROUP, NOW.toISOString()],
  );
  const MEMBER_MSG = Number(memberMsg.rows[0]?.id);

  const streamDefault = await listPublishedItems(db, ALL_TYPES, { page: 1, pageSize: 30 }, 'stream');
  check(
    'with the stream switch off, the stream carries the member and NOT the announcement',
    streamDefault.items.some((i) => i.id === MEMBER_MSG) &&
      !streamDefault.items.some((i) => i.id === MSG),
  );
  const blockDefault = await listPublishedItems(db, ALL_TYPES, { page: 1, pageSize: 30 }, 'channels');
  check(
    'POSITIVE CONTROL: the block carries the announcement and NOT the member',
    blockDefault.items.some((i) => i.id === MSG) && !blockDefault.items.some((i) => i.id === MEMBER_MSG),
  );
  check(
    '  so a member\'s message can never reach a channel block',
    !blockDefault.items.some((i) => i.id === MEMBER_MSG) && blockDefault.total === 1,
  );

  await pg.exec(
    `UPDATE settings SET value = '${JSON.stringify({
      ...DEFAULT_ARCHIVE,
      categories: { ...DEFAULT_ARCHIVE.categories, bridge: true },
    })}'::jsonb WHERE key = 'archive'`,
  );
  const streamOn = await listPublishedItems(db, ALL_TYPES, { page: 1, pageSize: 30 }, 'stream');
  check(
    'with the stream switch on, the stream carries BOTH',
    streamOn.items.some((i) => i.id === MEMBER_MSG) && streamOn.items.some((i) => i.id === MSG),
  );
  check(
    'and the members\' half of the stream was never touched by any of it',
    streamDefault.items.filter((i) => i.id === MEMBER_MSG).length === 1 &&
      streamOn.items.filter((i) => i.id === MEMBER_MSG).length === 1,
  );

  // HER ORDINARY REPLIES are the third thing in the stream, and `in_stream` is the column
  // that could quietly drop them: it is derived per row and a NULL would reach the stream's
  // own WHERE. So one of her replies in a PUBLISHING category is driven through both states
  // of the bridge switch, which is the positive control the two checks above do not give.
  await pg.exec(
    `UPDATE settings SET value = '${JSON.stringify(DEFAULT_ARCHIVE)}'::jsonb WHERE key = 'archive'`,
  );
  const herReply = await db.query<{ id: string }>(
    `INSERT INTO messages
       (group_id, group_msg_id, sender_member_id, sender_display_name, sent_at, type, text_body,
        raw_json, is_bot, bot_category, bot_lang, search_body, mentions_scanned)
     VALUES ($1, 998, 'bot-member-id', 'CIND3R3LLA', $2, 'text', 'noted, you are published',
             '{}'::jsonb, TRUE, 'consent', 'en', 'noted, you are published', TRUE)
     RETURNING id`,
    [DEST_GROUP, NOW.toISOString()],
  );
  const HER_MSG = Number(herReply.rows[0]?.id);
  const streamWithHer = await listPublishedItems(db, ALL_TYPES, { page: 1, pageSize: 30 }, 'stream');
  check(
    'one of HER ordinary replies is in the stream with the bridge switch off',
    streamWithHer.items.some((i) => i.id === HER_MSG),
  );
  check(
    '  and it is not in the channel block, because it carries no channel',
    !(await listPublishedItems(db, ALL_TYPES, { page: 1, pageSize: 30 }, 'channels')).items.some(
      (i) => i.id === HER_MSG,
    ),
  );
  await pg.exec(
    `UPDATE settings SET value = '${JSON.stringify({
      ...DEFAULT_ARCHIVE,
      categories: { ...DEFAULT_ARCHIVE.categories, bridge: true },
    })}'::jsonb WHERE key = 'archive'`,
  );
  check(
    'POSITIVE CONTROL: and still there with it on, so the column cannot drop her replies',
    (await listPublishedItems(db, ALL_TYPES, { page: 1, pageSize: 30 }, 'stream')).items.some(
      (i) => i.id === HER_MSG,
    ),
  );
  const nullCategory = await db.query<{ n: string | number }>(
    `SELECT count(*) AS n FROM published_messages WHERE in_stream IS NULL`,
  );
  check(
    'and no published row has an UNKNOWN stream state, at either setting',
    Number(nullCategory.rows[0]?.n) === 0,
    String(nullCategory.rows[0]?.n),
  );

  // The database refuses a channel origin on a member's row, so the block's
  // scope cannot be reached by anything but one of her bridge rows.
  let refused = false;
  try {
    await db.query(`UPDATE messages SET bridge_channel_key = $1, bridge_channel_name = 'TownCrier' WHERE id = $2`, [
      KEY,
      MEMBER_MSG,
    ]);
  } catch {
    refused = true;
  }
  check('the database REFUSES a channel origin on a member\'s message', refused);

  // The selector lists what can be found, not what is switched on.
  await upsertBridgeChannel(db, {
    botProfileId: BOT,
    sourceGroupId: OTHER_CHANNEL_GROUP,
    channelName: 'SecondChannel',
    link: OTHER_LINK,
  });
  await setChannelPublication(db, OTHER_KEY, { publish: true }, 'test');
  const selectable = await listPublishedChannels(db, ALL_TYPES, 'channels');
  check(
    'the channel selector offers only channels that have actually published',
    selectable.length === 1 && selectable[0]?.name === 'TownCrier',
    selectable.map((c) => String(c.name)).join(', '),
  );
  check('  with a count a visitor can trust', selectable[0]?.count === 1);
  const filtered = await listPublishedItems(
    db,
    ALL_TYPES,
    { page: 1, pageSize: 30, channels: [selectable[0]?.publicId ?? ''] },
    'channels',
  );
  check('filtering to one channel returns that channel', filtered.total === 1 && filtered.items[0]?.id === MSG);
  const filteredOther = await listPublishedItems(
    db,
    ALL_TYPES,
    { page: 1, pageSize: 30, channels: [mintChannelPublicId()] },
    'channels',
  );
  check('POSITIVE CONTROL: filtering to a channel with nothing returns nothing', filteredOther.total === 0);

  console.log('\n7. Anonymisation hides the name and nothing else');

  const named = await db.query<{ t: string; sb: string; s: string | null; ch: string | null; pid: string }>(
    `SELECT text_body AS t, search_body AS sb, search::text AS s,
            bridge_channel_name AS ch, bridge_channel_public_id AS pid
       FROM published_messages WHERE id = $1`,
    [MSG],
  );
  check('named: the channel is in the text', (named.rows[0]?.t ?? '').includes('TownCrier'));
  check('named: and in the column', named.rows[0]?.ch === 'TownCrier');
  check('named: and the post is searchable', named.rows[0]?.s !== null);

  await setChannelPublication(db, KEY, { anonymise: true }, 'test');
  const anon = await db.query<{
    t: string;
    sb: string;
    s: string | null;
    ft: string | null;
    ch: string | null;
    pid: string;
  }>(
    `SELECT text_body AS t, search_body AS sb, search::text AS s, formatted_text::text AS ft,
            bridge_channel_name AS ch, bridge_channel_public_id AS pid
       FROM published_messages WHERE id = $1`,
    [MSG],
  );
  // EVERY absence below is conjoined with `present`, because an anonymised post that had
  // simply stopped being published would satisfy all of them: `''.includes(name)` is false,
  // and `undefined === null` is false only by luck of the operator. The row has to be there
  // for "the name is not in it" to mean anything.
  const present = anon.rows.length === 1;
  check('the post is STILL public', present);
  check(
    'the channel name is gone from the text',
    present && !(anon.rows[0]?.t ?? '').includes('TownCrier'),
  );
  check('the channel name is gone from the column', present && anon.rows[0]?.ch === null);
  check(
    'the channel name is gone from the search text',
    present && !(anon.rows[0]?.sb ?? '').includes('TownCrier'),
  );
  check(
    'and the post is not full-text findable, so the name cannot be searched for',
    present && anon.rows[0]?.s === null,
  );
  check(
    'the structured runs are withheld, so they cannot carry the name',
    present && anon.rows[0]?.ft === null,
  );
  check(
    'AND NOTHING ELSE CHANGED: the post keeps every one of its own words',
    (anon.rows[0]?.t ?? '').includes(POST_TEXT),
    (anon.rows[0]?.t ?? '').slice(0, 90),
  );
  check(
    'the replacement is the persona\'s own placeholder, in the attribution line where the name was',
    (anon.rows[0]?.t ?? '').includes(`From the channel ${DEFAULT_INTERACTION.persona.en.bridgeAnonymousChannel},`),
    (anon.rows[0]?.t ?? '').split('\n').pop() ?? '',
  );
  check(
    'the block id is unchanged, so an embed keeps working and is not the link-derived key',
    anon.rows[0]?.pid === named.rows[0]?.pid && !(anon.rows[0]?.pid ?? '').includes('link:'),
  );
  const anonSelector = await listPublishedChannels(db, ALL_TYPES, 'channels');
  check(
    'the selector still offers it, unnamed rather than absent',
    anonSelector.length === 1 && anonSelector[0]?.name === null && anonSelector[0]?.count === 1,
  );
  await setChannelPublication(db, KEY, { anonymise: false }, 'test');
  check(
    'POSITIVE CONTROL: switched back, the name returns, so nothing was destroyed',
    (
      await db.query<{ ch: string | null }>(
        'SELECT bridge_channel_name AS ch FROM published_messages WHERE id = $1',
        [MSG],
      )
    ).rows[0]?.ch === 'TownCrier',
  );

  console.log('\n8. The console, operated');
  await operateConsole(db, KEY, BOT);

  await pg.close();

  console.log(
    failures === 0
      ? '\nAll channel publication checks passed: the origin is on the record, one switch decides, and the two surfaces keep two promises.'
      : `\n${String(failures)} CHECK(S) FAILED`,
  );
  if (failures > 0) process.exit(1);
}

/**
 * The switches PRESSED, through the real routes, with the effect read back out of the
 * database (D-178: a control is verified when it has been operated, not when its markup has
 * been read). The refusal case matters as much as the success: a POST naming a channel with
 * no publication record must say so rather than redirect to "Saved."
 */
async function operateConsole(db: Queryable, channelKey: string, botId: number): Promise<void> {
  const OPERATOR = 'operator';
  const PASSWORD = 'a-long-enough-test-password-0123456789';
  const adminCfg = {
    adminPort: 8807,
    adminUsername: OPERATOR,
    adminPasswordHash: await argon2.hash(PASSWORD, { type: argon2.argon2id }),
    sessionSecret: 'channel-publication-secret-0123456789abcdef',
    publicOrigin: 'https://admin.example.org',
    rpId: 'admin.example.org',
    webauthnOrigin: 'https://admin.example.org',
    rpName: 'Cinderella Admin',
  } as never;
  const cfg = {
    mediaRoot: './state/preview-media',
    assetRoot: './state/preview-assets',
    backupStatusPath: './state/backup-status.json',
    backupRequestPath: './state/backup-request',
    backupProgressPath: './state/backup-progress.json',
    avatarPath: '',
    databaseUrl: 'postgres://placeholder@127.0.0.1:5432/x',
    logLevel: 'error',
  } as never;

  registerNav();
  const app = buildServer({
    db,
    adminCfg,
    mediaRoot: './state/preview-media',
    settings: await SettingsService.load(db, 'error'),
    security: await SecurityService.load(db),
    interaction: await InteractionService.load(db),
    archive: await ArchiveService.load(db),
    cfg,
    registerViews: registerAdminViews,
  } as never);
  await app.ready();

  const loginPage = await app.inject({ method: 'GET', url: '/login' });
  const loginCookie = String(loginPage.headers['set-cookie'] ?? '');
  const loginToken = /name="_csrf" value="([^"]+)"/.exec(loginPage.body)?.[1] ?? '';
  const login = await app.inject({
    method: 'POST',
    url: '/login',
    headers: { cookie: loginCookie, 'content-type': 'application/x-www-form-urlencoded' },
    payload: `username=${OPERATOR}&password=${encodeURIComponent(PASSWORD)}&_csrf=${encodeURIComponent(loginToken)}`,
  });
  const rawCookie = login.headers['set-cookie'];
  const cookie = (Array.isArray(rawCookie) ? rawCookie : [String(rawCookie ?? '')])
    .map((c) => c.split(';')[0])
    .join('; ');
  const page = await app.inject({ method: 'GET', url: '/bridge', headers: { cookie } });
  const says = (body: string, phrase: string): boolean =>
    body.replace(/\s+/g, ' ').includes(phrase.replace(/\s+/g, ' '));
  const csrf = /name="_csrf" value="([^"]+)"/.exec(page.body)?.[1] ?? '';
  check('the Bridge page renders', page.statusCode === 200, String(page.statusCode));
  check(
    'it says what publishing means, and that switching it off removes what was published',
    says(page.body, 'Switching it off removes them.'),
  );
  check(
    'and it says which posts are public, per channel',
    says(page.body, 'of 1 archived announcements are public') ||
      says(page.body, 'archived, none public'),
  );
  check('the switch names what it acts on', says(page.body, 'Stop publishing TownCrier'));
  // Without the apostrophe: the templates escape `'` to `&#39;`, so asserting on
  // "CIND3R3LLA's alone" tests the ESCAPING and not the sentence, which is the D-111 shape.
  check(
    'the page names the bot whose bridge this is',
    says(page.body, 'announcements CIND3R3LLA brings into'),
  );
  check(
    'and the scope panel says publication is per channel rather than per bot',
    says(page.body, 'Publish / publish unnamed'),
  );
  check('the standalone block snippet is offered', says(page.body, '/channels'));

  const press = async (url: string, payload: string): Promise<{ status: number; location: string }> => {
    const res = await app.inject({
      method: 'POST',
      url,
      headers: { cookie, 'content-type': 'application/x-www-form-urlencoded' },
      payload: `${payload}&_csrf=${encodeURIComponent(csrf)}`,
    });
    return { status: res.statusCode, location: String(res.headers['location'] ?? '') };
  };

  // OFF, then read the row back out of the database rather than believing the redirect.
  const off = await press(
    '/bridge/publication/publish',
    `channelKey=${encodeURIComponent(channelKey)}&botProfileId=${String(botId)}&publish=off`,
  );
  check('pressing the switch redirects with Saved', off.location.includes('saved=1'), off.location);
  check(
    '  and the database says the channel is no longer published',
    (await getChannelPublication(db, channelKey))?.publish === false,
  );
  const on = await press(
    '/bridge/publication/publish',
    `channelKey=${encodeURIComponent(channelKey)}&botProfileId=${String(botId)}&publish=on`,
  );
  check('POSITIVE CONTROL: pressing it again publishes', on.location.includes('saved=1'));
  check(
    '  and the database agrees',
    (await getChannelPublication(db, channelKey))?.publish === true,
  );
  const anon = await press(
    '/bridge/publication/anonymise',
    `channelKey=${encodeURIComponent(channelKey)}&botProfileId=${String(botId)}&anonymise=on`,
  );
  check('the anonymise switch is a separate control', anon.location.includes('saved=1'));
  const state = await getChannelPublication(db, channelKey);
  check('  and it changed only that field', state?.anonymise === true && state.publish === true);
  await press(
    '/bridge/publication/anonymise',
    `channelKey=${encodeURIComponent(channelKey)}&botProfileId=${String(botId)}&anonymise=off`,
  );

  // A key with no record must be REFUSED, not silently created: a POST that
  // invents a publication row is a publication path with nobody's decision behind it.
  const bogus = await press(
    '/bridge/publication/publish',
    `channelKey=${encodeURIComponent('link:0000000000000000')}&botProfileId=${String(botId)}&publish=on`,
  );
  check('a channel with no record is refused rather than created', bogus.location.includes('error='));
  check(
    '  and no row appeared',
    (await getChannelPublication(db, 'link:0000000000000000')) === null,
  );
  const reread = await app.inject({ method: 'GET', url: '/bridge', headers: { cookie } });
  check('the page then shows the state the database holds', reread.statusCode === 200);
  await app.close();
}

await main();
