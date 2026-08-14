/**
 * The channel bridge (CCB-S5-032, D-187): the cadence, the loop guard, the
 * suppression record, the separation from consent, and the propagation of
 * edits and deletions.
 *
 * ── WHAT IS PROVEN ───────────────────────────────────────────────────────────
 *
 * 1. A channel item and a member item lead to two different worlds, in both
 *    directions, with positive controls.
 * 2. The cadence decides as designed: whichever trigger comes first, the age
 *    window, the repeat cap, dismissal, and the digest that accounts for every
 *    pending post (featured, summarized, or counted - nothing vanishes).
 * 3. The quiet case: a due tick with nothing pending sends nothing and records
 *    nothing.
 * 4. A bridged message is never re-bridged, and the MUTATION shows the readback
 *    is load-bearing: with it bypassed, the bridge announces its own product.
 * 5. A post cannot be suppressed without a record, and the MUTATION shows the
 *    invariant catches a raw-SQL suppression that skipped the record.
 * 6. The whole composition through a fake port: announcement rendered with the
 *    post VERBATIM and the application-written attribution, forwards recorded
 *    with the structured origin, her own side archived under 'bridge', the
 *    switch honoured, the absent capability storing nothing.
 * 7. Edits follow in place via recomposition; a deletion withdraws every copy.
 * 8. No model is anywhere on the path, asserted structurally.
 *
 * Every negative has a positive control beside it: "the guard refused" passes
 * trivially against a bridge that refuses everything, so the same shapes are
 * shown being accepted when they should be.
 *
 *   npx tsx scripts/verify-bridge.ts
 */

import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import { vector } from '@electric-sql/pglite-pgvector';
import type { Queryable } from '../src/db/pool.js';
import { loadMigrationFiles } from '../src/db/migrate.js';
import { parseChannelPost, parseGroupMessage } from '../src/bot/parse.js';
import type { BridgeSendPort } from '../src/bot/bridge-port.js';
import {
  DIGEST_SUMMARY_CAP,
  afterAnnouncement,
  dueBy,
  planTick,
  renderAnnouncement,
  type BridgeMappingState,
  type PendingPost,
} from '../src/plugins/channel-bridge/cadence.js';
import { refuseMapping, refusalText } from '../src/plugins/channel-bridge/loop.js';
import { buildOrigin, channelKeyFor } from '../src/plugins/channel-bridge/origin.js';
import {
  insertBridgeMapping,
  insertBridgePost,
  listBridgeMappings,
  listBridgeSuppressions,
  pendingBridgePosts,
  recordBridgeForward,
  setBridgeMappingEnabled,
  upsertBridgeChannel,
} from '../src/plugins/channel-bridge/store.js';
import {
  intakeChannelDeletion,
  intakeChannelEdit,
  intakeChannelPost,
  propagateForPost,
  runBridgeTick,
  type BridgeDeps,
} from '../src/plugins/channel-bridge/service.js';
import { markersFromTemplates } from '../src/interaction/protected-text.js';
import { DEFAULT_INTERACTION, PERSONA_CATEGORY, normalizeInteraction } from '../src/interaction/settings.js';
import { DEFAULT_ARCHIVE } from '../src/archive/settings.js';
import { setLogLevel } from '../src/log.js';

let failures = 0;
function check(label: string, ok: boolean, detail = ''): void {
  if (!ok) failures++;
  console.log(`  [${ok ? 'PASS' : 'FAIL'}] ${label}${detail ? `: ${detail}` : ''}`);
}

/* ── fixture builders ─────────────────────────────────────────────────────── */

const CHANNEL_GROUP = 901;
const DEST_GROUP = 77;
const LINK = 'https://simplex.chat/c#fixture-placeholder-link';

/** A channel item as the installed types shape it: channelRcv carries NOBODY. */
function channelItem(over: {
  itemId: number;
  text: string;
  sharedMsgId?: string | null;
  postedAt?: string;
  file?: { fileId: number; fileName: string; fileSize: number };
}): never {
  return {
    chatInfo: {
      type: 'group',
      groupInfo: {
        groupId: CHANNEL_GROUP,
        localDisplayName: 'TownCrier',
        useRelays: true,
        viaGroupLinkUri: LINK,
        groupProfile: {
          displayName: 'TownCrier',
          publicGroup: { groupType: 'channel' },
        },
      },
    },
    chatItem: {
      chatDir: { type: 'channelRcv' },
      meta: {
        itemId: over.itemId,
        itemTs: over.postedAt ?? new Date().toISOString(),
        ...(over.sharedMsgId === null ? {} : { itemSharedMsgId: over.sharedMsgId ?? `sh-${String(over.itemId)}` }),
      },
      content: { type: 'rcvMsgContent', msgContent: { type: 'text', text: over.text } },
      ...(over.file ? { file: over.file } : {}),
    },
  } as never;
}

/** A member's group message, for the separation checks. */
function memberItem(itemId: number, text: string): never {
  return {
    chatInfo: {
      type: 'group',
      groupInfo: { groupId: DEST_GROUP, localDisplayName: 'archive', groupProfile: { displayName: 'archive' } },
    },
    chatItem: {
      chatDir: {
        type: 'groupRcv',
        groupMember: {
          memberId: 'member-1',
          groupMemberId: 11,
          memberRole: 'member',
          localDisplayName: 'Alice',
          memberProfile: { displayName: 'Alice' },
        },
      },
      meta: { itemId, itemTs: new Date().toISOString() },
      content: { type: 'rcvMsgContent', msgContent: { type: 'text', text } },
    },
  } as never;
}

/** What the port's send returns: her sent item, groupSnd, with its membership. */
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
      meta: { itemId, itemTs: new Date().toISOString(), itemSharedMsgId: sharedMsgId },
      content: { type: 'sndMsgContent', msgContent: { type: 'text', text: '' } },
    },
  };
}

interface PortCall {
  kind: 'text' | 'file' | 'update' | 'delete';
  groupId: number;
  text?: string;
  itemIds?: number[];
  itemId?: number;
}

function makeFakePort(calls: PortCall[]): BridgeSendPort {
  let nextItem = 500;
  return {
    sendText: (groupId, text) => {
      const itemId = ++nextItem;
      const sharedMsgId = `sent-${String(itemId)}`;
      calls.push({ kind: 'text', groupId, text });
      return Promise.resolve({ itemId, sharedMsgId, raw: sentItem(groupId, itemId, sharedMsgId) });
    },
    sendFile: (groupId, _filePath, caption) => {
      const itemId = ++nextItem;
      const sharedMsgId = `sent-${String(itemId)}`;
      calls.push({ kind: 'file', groupId, text: caption });
      return Promise.resolve({ itemId, sharedMsgId, raw: sentItem(groupId, itemId, sharedMsgId) });
    },
    updateText: (groupId, itemId, text) => {
      calls.push({ kind: 'update', groupId, itemId, text });
      return Promise.resolve();
    },
    deleteBroadcast: (groupId, itemIds) => {
      calls.push({ kind: 'delete', groupId, itemIds: [...itemIds] });
      return Promise.resolve();
    },
  };
}

function post(id: number, minutesAgo: number, over: Partial<PendingPost> = {}): PendingPost {
  return {
    id,
    sharedMsgId: `sh-${String(id)}`,
    text: `post ${String(id)}`,
    postedAt: new Date(NOW.getTime() - minutesAgo * 60_000),
    editedAt: null,
    repeatsDone: 0,
    dismissedAt: null,
    ...over,
  };
}

const NOW = new Date('2026-08-12T12:00:00Z');

const MAPPING: BridgeMappingState = {
  intervalMinutes: 60,
  messageCount: 30,
  maxAgeHours: 24,
  maxRepeats: 3,
  lastSentAt: new Date(NOW.getTime() - 61 * 60_000),
  createdAt: new Date(NOW.getTime() - 7 * 24 * 3_600_000),
};

/**
 * A BRIDGED IMAGE RENDERS AS AN IMAGE (CCB-S5-042, D-214).
 *
 * The bridge sent `type: 'file'` for everything, so every picture arrived as an attachment to
 * fetch. This suite was green for that entire time, because it asserts what the bridge DECIDES
 * and never what content type it SENDS. Asserted over the source, since the choice is one
 * expression and the rendering follows from it.
 */
async function sectionContentType(): Promise<void> {
  console.log('');
  console.log('Content type: a bridged image is sent AS an image (D-214)');
  const { readFile } = await import('node:fs/promises');
  const src = await readFile('src/bot/bridge-port.ts', 'utf8');
  const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
  check(
    'an image is sent as MsgContent.Image with a preview',
    code.includes("{ type: 'image', text: caption, image: preview ?? '' }"),
  );
  check(
    '  chosen from the MIME the intake stored, not guessed from the path',
    /const isImage = \(mime \?\? ''\)\.startsWith\('image\/'\)/.test(code),
  );
  check(
    '  MUTATION: `file` is no longer the unconditional content type',
    !/msgContent: \{ type: 'file', text: caption \}, mentions/.test(code),
  );
  // POSITIVE CONTROL: every line above passes against a bridge that sends nothing but images.
  check(
    'POSITIVE CONTROL: a non-image is still sent as a file',
    code.includes("{ type: 'file', text: caption }"),
  );
  const svc = await readFile('src/plugins/channel-bridge/service.ts', 'utf8');
  check(
    'and the caller passes the stored MIME through',
    /sendFile\([\s\S]{0,120}featured\.mediaMime/.test(svc),
  );
}

async function main(): Promise<void> {
  setLogLevel('error');
  const pg = new PGlite({ extensions: { vector } });
  const db: Queryable = {
    async query(sql, values) {
      const result = await pg.query(sql, values ? [...values] : undefined);
      return {
        rows: result.rows as never[],
        rowCount: (result.affectedRows ?? result.rows.length) as number,
      };
    },
  } as Queryable;
  // `exec`, not `query`: a migration is many statements and `query` takes one.
  for (const migration of await loadMigrationFiles()) await pg.exec(migration.sql);

  // Two bots, so per-bot properties mean something.
  const bots = await db.query<{ id: string }>(
    `INSERT INTO cinderella_bot_profiles (slug, display_name, enabled)
     VALUES ('crier-bot', 'CIND3R3LLA', TRUE), ('quiet-bot', 'SupportDesk', TRUE)
     RETURNING id`,
  );
  const BOT = Number(bots.rows[0]?.id);
  const OTHER_BOT = Number(bots.rows[1]?.id);

  /* ── 1. Two directions, two worlds ──────────────────────────────────────── */

  console.log('\n1. A channel item and a member item lead to different worlds');

  const chPost = parseChannelPost(channelItem({ itemId: 1, text: 'hello from the channel' }));
  check('a channelRcv item parses as a channel post', chPost !== null);
  check(
    '  carrying the channel identity and NO member of any kind',
    chPost !== null &&
      chPost.channelName === 'TownCrier' &&
      chPost.isChannelGroup &&
      !('senderMemberId' in chPost),
  );
  check(
    'the same item is NOTHING to the member parser, so it cannot reach consent',
    parseGroupMessage(channelItem({ itemId: 1, text: 'hello from the channel' })) === null,
  );
  // POSITIVE CONTROLS, both ways: the separation is two working parsers, not
  // one broken one.
  check(
    'CONTROL: a member item is NOTHING to the channel parser',
    parseChannelPost(memberItem(2, 'hello from a member')) === null,
  );
  check(
    'CONTROL: and is a real message to the member parser',
    parseGroupMessage(memberItem(2, 'hello from a member')) !== null,
  );

  /* ── 2. The cadence decides as designed ─────────────────────────────────── */

  console.log('\n2. Whichever comes first, the age window, the cap, the digest');

  check(
    'interval elapsed with the count short fires on the interval',
    dueBy({ ...MAPPING, messageCount: 30 }, NOW, 3) === 'interval',
  );
  check(
    'count reached with the interval short fires on the count',
    dueBy({ ...MAPPING, lastSentAt: new Date(NOW.getTime() - 5 * 60_000) }, NOW, 31) === 'count',
  );
  check(
    'neither reached is not due',
    dueBy({ ...MAPPING, lastSentAt: new Date(NOW.getTime() - 5 * 60_000) }, NOW, 3) === null,
  );
  check(
    'a mapping that never sent measures from its creation',
    dueBy({ ...MAPPING, lastSentAt: null }, NOW, 0) === 'interval',
  );
  // MUTATION (in logic): whichever-comes-LAST would refuse both of the above
  // single-trigger firings; proving the two single-sided cases above IS the
  // ordering proof, so this asserts the composition is OR, not AND.
  check(
    'MUTATION: an AND composition would have refused both single-trigger cases above',
    dueBy({ ...MAPPING, messageCount: null }, NOW, 0) === 'interval' &&
      dueBy(
        { ...MAPPING, intervalMinutes: null, lastSentAt: new Date(NOW.getTime() - 5 * 60_000) },
        NOW,
        31,
      ) === 'count',
  );

  {
    const plan = planTick(MAPPING, [post(1, 30)], NOW, 0);
    check('a fresh post is featured', plan.announce?.full.id === 1);
  }
  {
    const plan = planTick(MAPPING, [post(1, 25 * 60)], NOW, 0);
    check(
      'a post beyond the age window is not announced',
      plan.announce === null && plan.resolutions[0]?.resolution === 'aged-out',
    );
    check(
      '  and aged out at ZERO announcements is a SUPPRESSION',
      plan.resolutions[0]?.suppressed === true,
    );
  }
  {
    const plan = planTick(MAPPING, [post(1, 25 * 60, { repeatsDone: 2 })], NOW, 0);
    check(
      '  while aged out AFTER being announced is completion, not suppression',
      plan.resolutions[0]?.resolution === 'aged-out' && plan.resolutions[0]?.suppressed === false,
    );
  }
  {
    const plan = planTick(MAPPING, [post(1, 30, { dismissedAt: NOW })], NOW, 0);
    check(
      'a dismissed post resolves and a never-announced dismissal is recorded',
      plan.announce === null && plan.resolutions[0]?.resolution === 'dismissed' && plan.resolutions[0]?.suppressed === true,
    );
  }
  {
    // Seven pending: newest featured, four oldest-first summarized, two counted.
    const posts = [1, 2, 3, 4, 5, 6, 7].map((i) => post(i, i * 10));
    const plan = planTick(MAPPING, posts, NOW, 0);
    const a = plan.announce;
    check('a burst becomes ONE digest', a !== null);
    check('  the newest post is featured in full', a?.full.id === 1);
    check(
      `  up to ${String(DIGEST_SUMMARY_CAP)} older ride along OLDEST first, so nothing starves`,
      JSON.stringify(a?.summarized.map((p) => p.id)) === JSON.stringify([7, 6, 5, 4]),
    );
    check('  and the rest are COUNTED, not dropped', a?.remainder === 2);
    // THE EXHAUSTIVENESS PROPERTY: every input post is featured, summarized,
    // counted, resolved, or still pending - and those five sum to the input.
    const accounted =
      1 + (a?.summarized.length ?? 0) + (a?.remainder ?? 0) + plan.resolutions.length;
    check('  every pending post is accounted for', accounted === posts.length, `${String(accounted)} of 7`);
    const outcomes = afterAnnouncement(MAPPING, a as NonNullable<typeof a>);
    check(
      '  a repeat is spent by being SHOWN: featured and summarized, never the counted',
      outcomes.length === 5 && outcomes.every((o) => o.repeatsDone === 1 && !o.completed),
    );
  }
  {
    const outcomes = afterAnnouncement(MAPPING, {
      full: post(1, 30, { repeatsDone: 2 }),
      summarized: [],
      remainder: 0,
    });
    check(
      'the repeat cap completes a post',
      outcomes[0]?.completed === true && outcomes[0]?.repeatsDone === 3,
    );
  }
  {
    const rendered = renderAnnouncement(
      { full: post(1, 30, { text: 'the verbatim post text' }), summarized: [post(2, 60, { text: 'older' })], remainder: 3 },
      {
        attributionFor: (p) => `[FROM TownCrier ${p.postedAt.toISOString()}]`,
        remainderLine: (n) => `[AND ${String(n)} MORE]`,
      },
    );
    check(
      'the rendering is the post VERBATIM plus application-written lines',
      rendered.includes('the verbatim post text') &&
        rendered.includes('[FROM TownCrier') &&
        rendered.includes('[AND 3 MORE]'),
    );
  }

  /* ── 3. The quiet case ──────────────────────────────────────────────────── */

  console.log('\n3. A due tick with nothing pending is silence, not a record');

  {
    const plan = planTick(MAPPING, [], NOW, 0);
    check(
      'due, empty channel: no announcement, no resolutions, no anything',
      plan.due === 'interval' && plan.announce === null && plan.resolutions.length === 0,
    );
  }

  /* ── 4. The loop guard ──────────────────────────────────────────────────── */

  console.log('\n4. A bridged message is never re-bridged');

  const isChannel = (g: number): boolean => g === CHANNEL_GROUP || g === 902;
  check(
    'a mapping from a channel to a group is ACCEPTED (the positive control first)',
    refuseMapping({ botProfileId: BOT, sourceGroupId: CHANNEL_GROUP, destGroupId: DEST_GROUP }, [], isChannel) === null,
  );
  check(
    'a source that is not a channel is refused',
    refuseMapping({ botProfileId: BOT, sourceGroupId: DEST_GROUP, destGroupId: 78 }, [], isChannel)?.reason === 'source-not-channel',
  );
  check(
    'a destination that IS a channel is refused, which makes a cycle unrepresentable',
    refuseMapping({ botProfileId: BOT, sourceGroupId: CHANNEL_GROUP, destGroupId: 902 }, [], isChannel)?.reason === 'dest-is-channel',
  );
  check(
    'a destination another mapping reads from is refused (the stale-kind belt)',
    refuseMapping(
      { botProfileId: BOT, sourceGroupId: CHANNEL_GROUP, destGroupId: 903 },
      [{ botProfileId: BOT, sourceGroupId: 903, destGroupId: 904 }],
      isChannel,
    )?.reason === 'dest-feeds-a-mapping',
  );
  check(
    '  and every refusal has an operator-readable sentence',
    (['source-not-channel', 'dest-is-channel', 'source-equals-dest'] as const).every(
      (reason) => refusalText({ reason }).length > 20,
    ),
  );

  // The READBACK, end to end through the real store and service.
  await upsertBridgeChannel(db, { botProfileId: BOT, sourceGroupId: CHANNEL_GROUP, channelName: 'TownCrier', link: LINK });
  const mappingId = await insertBridgeMapping(db, {
    botProfileId: BOT,
    sourceGroupId: CHANNEL_GROUP,
    destGroupId: DEST_GROUP,
    intervalMinutes: 60,
    messageCount: 30,
    maxAgeHours: 24,
    maxRepeats: 3,
  });

  // ── ONE CLOCK, OR THE CHECK HAS AN EXPIRY DATE (D-189) ────────────────────
  //
  // `created_at` is the only column the cadence anchors on that the DATABASE stamps
  // (migration 057, `DEFAULT now()`), so an inserted mapping is born at REAL wall-clock
  // time while every fixture and the injected service clock descend from the frozen
  // `NOW`. `dueBy` reads `lastSentAt ?? createdAt` (cadence.ts), so the instant real time
  // passed `NOW` the anchor sat in the FUTURE and nothing was ever due again: no
  // announcement, no forward row, no age-out suppression, and the loop mutation's
  // "it re-bridged" assertion false because nothing was bridged at all.
  //
  // That is exactly what happened. This harness was committed at 09:26 UTC with `NOW`
  // pinned to 12:00 UTC the same day; it was green for two and a half hours and has been
  // red ever since, permanently, on every machine and every future date.
  //
  // Pinned rather than un-freezing `NOW`: a frozen clock is what makes the run
  // deterministic, and `new Date()` would only move the expiry rather than remove it.
  await db.query(`UPDATE cinderella_bridge_mappings SET created_at = $2 WHERE id = $1`, [
    mappingId,
    MAPPING.createdAt,
  ]);

  // The assertion that keeps it that way. It is not decoration: this exact drift is what
  // turned six checks red and hid the whole summary behind a crash, and nothing announced
  // it, because a harness that stops exercising its subject looks identical to a passing
  // one until you read the lines.
  {
    const anchor = await db.query<{ created_at: string | Date }>(
      `SELECT created_at FROM cinderella_bridge_mappings WHERE id = $1`,
      [mappingId],
    );
    const stored = new Date(anchor.rows[0]?.created_at ?? 0).getTime();
    check(
      'the harness is HERMETIC: the mapping the cadence anchors on carries the frozen clock, not the wall clock',
      stored === MAPPING.createdAt.getTime(),
      `stored ${new Date(stored).toISOString()}, expected ${MAPPING.createdAt.toISOString()}`,
    );
  }

  const calls: PortCall[] = [];
  let clock = NOW;
  // ONE port for the whole run. An earlier draft built a fresh fake per
  // `port()` call, which reset the sent-item counter, so two ticks' sends
  // shared an item id: her archived rows collided on (group, item) and a
  // withdrawal saw an unrelated post standing in the withdrawn message. The
  // real port cannot do that (item ids are the core's), so neither may the fake.
  const fakePort = makeFakePort(calls);
  const deps: BridgeDeps = {
    db,
    port: () => fakePort,
    isEnabledFor: (id) => id === BOT,
    linesFor: () => ({
      lang: 'en',
      attributionFor: (channel, at) => `[FROM ${channel} ${at.toISOString().slice(0, 10)}]`,
      remainderLine: (channel, n) => `[AND ${String(n)} MORE IN ${channel}]`,
    }),
    storeMedia: null,
    maxFileBytes: () => 1024 * 1024,
    now: () => clock,
  };

  // A forward exists whose sent shared id is 'sent-echo'; the same id then
  // arrives as a channel post - a foreign bridge re-injecting our announcement.
  const victim = await insertBridgePost(db, {
    botProfileId: BOT,
    sourceGroupId: CHANNEL_GROUP,
    sharedMsgId: 'sh-victim',
    itemId: 100,
    text: 'the original announcement',
    postedAt: NOW,
  });
  await recordBridgeForward(db, {
    mappingId,
    postId: victim.id,
    kind: 'featured',
    sentItemId: 400,
    sentSharedMsgId: 'sent-echo',
    origin: buildOrigin({ channelKey: channelKeyFor(LINK, BOT, CHANNEL_GROUP), channelName: 'TownCrier', postedAt: NOW, sharedMsgId: 'sh-victim' }),
    messageId: null,
  });

  const echo = await intakeChannelPost(
    deps,
    BOT,
    parseChannelPost(channelItem({ itemId: 101, text: 'the original announcement', sharedMsgId: 'sent-echo' })) as never,
  );
  check('the bridge recognises its own send coming back and refuses it', echo.loopRefused);
  const afterEcho = await pendingBridgePosts(db, BOT, CHANNEL_GROUP);
  check(
    '  the refused post is not pending, so no tick can ever announce it',
    !afterEcho.some((p) => p.sharedMsgId === 'sent-echo'),
  );
  const echoSupp = await listBridgeSuppressions(db);
  check(
    '  and the refusal is a RECORD, never a silent drop',
    echoSupp.some((s) => s.reason === 'loop-refused'),
  );

  // ── MUTATION: the briefing's named one - a bridged message CAN be re-bridged
  // when the readback is bypassed. The same echo is inserted straight into the
  // store (which is what the service without its guard would do), and the next
  // due tick announces the bridge's own product back into the group.
  {
    await insertBridgePost(db, {
      botProfileId: BOT,
      sourceGroupId: CHANNEL_GROUP,
      sharedMsgId: 'sent-echo-mutated',
      itemId: 102,
      text: 'the original announcement, round two',
      postedAt: NOW,
    });
    await recordBridgeForward(db, {
      mappingId,
      postId: victim.id,
      kind: 'featured',
      sentItemId: 401,
      sentSharedMsgId: 'sent-echo-mutated',
      origin: buildOrigin({ channelKey: channelKeyFor(LINK, BOT, CHANNEL_GROUP), channelName: 'TownCrier', postedAt: NOW, sharedMsgId: 'sh-victim' }),
      messageId: null,
    });
    calls.length = 0;
    clock = new Date(NOW.getTime() + 61 * 60_000);
    await runBridgeTick(deps);
    const reAnnounced = calls.some(
      (c) => c.kind === 'text' && (c.text ?? '').includes('round two'),
    );
    check(
      'MUTATION: with the readback bypassed, the bridge re-bridges its own product',
      reAnnounced,
      'the guard above is load-bearing, not decorative',
    );
    // Clean up the mutated post so later sections plan over known state.
    await db.query(
      `UPDATE cinderella_bridge_posts SET resolution = 'completed', resolved_at = now()
        WHERE shared_msg_id IN ('sent-echo-mutated', 'sh-victim') AND resolution IS NULL`,
    );
  }

  /* ── 5. A suppression cannot be silent ──────────────────────────────────── */

  console.log('\n5. A post cannot be suppressed without a record');

  // The service path first: an aged-out never-announced post gets its record.
  await insertBridgePost(db, {
    botProfileId: BOT,
    sourceGroupId: CHANNEL_GROUP,
    sharedMsgId: 'sh-stale',
    itemId: 103,
    text: 'a post from last month',
    postedAt: new Date(NOW.getTime() - 30 * 24 * 3_600_000),
  });
  clock = new Date(NOW.getTime() + 122 * 60_000);
  calls.length = 0;
  await runBridgeTick(deps);
  const supp = await listBridgeSuppressions(db);
  check(
    'the tick that ages a post out at zero announcements writes the record',
    supp.some((s) => s.reason === 'aged-out' && s.postText.includes('last month')),
  );

  // THE INVARIANT the console and this check both stand on: every suppressed
  // resolution has its row. Provable as SQL, so a future writer that resolves
  // without recording goes red here whatever code path it took.
  const orphanQuery = `
    SELECT count(*) AS n FROM cinderella_bridge_posts p
     WHERE p.resolution IN ('aged-out', 'dismissed', 'loop-refused')
       AND p.repeats_done = 0
       AND NOT EXISTS (SELECT 1 FROM cinderella_bridge_suppressions s WHERE s.post_id = p.id)`;
  {
    const { rows } = await db.query<{ n: string | number }>(orphanQuery);
    check('no suppressed post lacks its record (the invariant holds on the real path)', Number(rows[0]?.n) === 0);
  }
  // ── MUTATION: the briefing's second named one - suppress WITHOUT a record,
  // via raw SQL past the service, and the invariant catches it.
  {
    await db.query(
      `INSERT INTO cinderella_bridge_posts
         (bot_profile_id, source_group_id, shared_msg_id, item_id, text_body, posted_at, resolution, resolved_at)
       VALUES ($1, $2, 'sh-silent', 104, 'silently vanished', now(), 'dismissed', now())`,
      [BOT, CHANNEL_GROUP],
    );
    const { rows } = await db.query<{ n: string | number }>(orphanQuery);
    check(
      'MUTATION: a raw-SQL suppression with no record turns the invariant red',
      Number(rows[0]?.n) === 1,
    );
    await db.query(`DELETE FROM cinderella_bridge_posts WHERE shared_msg_id = 'sh-silent'`);
  }

  /* ── 6. The composition through the fake port ───────────────────────────── */

  console.log('\n6. A channel post appears in the group, attributed, on the cadence');

  const fresh = parseChannelPost(
    channelItem({ itemId: 110, text: 'Market day moves to Saturday.', sharedMsgId: 'sh-fresh' }),
  ) as NonNullable<ReturnType<typeof parseChannelPost>>;
  await intakeChannelPost(deps, BOT, fresh);
  clock = new Date(clock.getTime() + 61 * 60_000);
  calls.length = 0;
  await runBridgeTick(deps);
  const announcement = calls.find((c) => c.kind === 'text');
  check('the post was announced through the port', announcement !== undefined);
  check(
    '  VERBATIM, with the application-written attribution under it',
    (announcement?.text ?? '').includes('Market day moves to Saturday.') &&
      (announcement?.text ?? '').includes('[FROM TownCrier'),
  );
  check('  into the mapped destination group', announcement?.groupId === DEST_GROUP);

  const fwd = await db.query<{ kind: string; origin: unknown; message_id: string | null }>(
    `SELECT f.kind, f.origin, f.message_id FROM cinderella_bridge_forwards f
       JOIN cinderella_bridge_posts p ON p.id = f.post_id
      WHERE p.shared_msg_id = 'sh-fresh'`,
  );
  check('the forward is recorded', fwd.rows[0]?.kind === 'featured');
  {
    // `?? {}` is the difference between a FAILED CHECK and a DEAD RUN (D-189). With no
    // row, `origin` was undefined and `origin['v']` threw an uncaught TypeError out of
    // `main()`: the process died mid-section, the remaining sections never ran, and the
    // summary line was never printed. So the harness reported neither its failures nor a
    // count, and a reader who scrolled to the bottom saw a stack trace where the verdict
    // belongs. A missing row is an assertion this harness should FAIL, not choke on.
    const origin = (typeof fwd.rows[0]?.origin === 'string'
      ? JSON.parse(fwd.rows[0].origin)
      : (fwd.rows[0]?.origin ?? {})) as Record<string, unknown>;
    check(
      '  with the STRUCTURED origin: versioned, keyed on the link, named, timed',
      origin['v'] === 1 &&
        origin['source'] === 'simplex-channel' &&
        origin['channelKey'] === channelKeyFor(LINK, BOT, CHANNEL_GROUP) &&
        origin['channelName'] === 'TownCrier' &&
        typeof origin['postedAt'] === 'string' &&
        origin['sharedMsgId'] === 'sh-fresh',
    );
    check(
      '  and the key is derived from the LINK, so a rename cannot move it',
      String(origin['channelKey']).startsWith('link:'),
    );
  }
  {
    const her = await db.query<{ bot_category: string | null; text_body: string | null }>(
      `SELECT bot_category, text_body FROM messages WHERE is_bot = TRUE AND group_id = $1`,
      [DEST_GROUP],
    );
    check(
      "her own side is archived under 'bridge', which ships excluded from publication",
      her.rows.some((r) => r.bot_category === 'bridge' && (r.text_body ?? '').includes('Market day')),
    );
  }
  {
    const again = calls.length;
    await runBridgeTick(deps); // same clock: not due
    check(
      'the cadence holds: an immediate second tick is not due and sends nothing',
      calls.length === again,
    );
  }
  {
    // Switchable without deletion: off sends nothing, on sends again.
    await setBridgeMappingEnabled(db, mappingId, false);
    clock = new Date(clock.getTime() + 61 * 60_000);
    calls.length = 0;
    await runBridgeTick(deps);
    check('a mapping switched OFF is silent', calls.length === 0);
    await setBridgeMappingEnabled(db, mappingId, true);
    await runBridgeTick(deps);
    check(
      'CONTROL: switched back ON, the same tick announces (the repeat of the same post)',
      calls.some((c) => c.kind === 'text' && (c.text ?? '').includes('Market day')),
    );
  }
  {
    // The absent capability: the OTHER bot's intake stores nothing at all.
    const before = await db.query<{ n: string | number }>(
      `SELECT count(*) AS n FROM cinderella_bridge_posts WHERE bot_profile_id = $1`,
      [OTHER_BOT],
    );
    const result = await intakeChannelPost(
      deps,
      OTHER_BOT,
      parseChannelPost(channelItem({ itemId: 120, text: 'for the quiet bot' })) as never,
    );
    const after = await db.query<{ n: string | number }>(
      `SELECT count(*) AS n FROM cinderella_bridge_posts WHERE bot_profile_id = $1`,
      [OTHER_BOT],
    );
    check(
      'a bot the plugin is OFF for stores nothing: no channel, no post, no anything',
      !result.stored && Number(before.rows[0]?.n) === 0 && Number(after.rows[0]?.n) === 0,
    );
    check(
      'CONTROL: the enabled bot storing posts is what makes that meaningful',
      Number((await db.query<{ n: string | number }>(`SELECT count(*) AS n FROM cinderella_bridge_posts WHERE bot_profile_id = $1`, [BOT])).rows[0]?.n) > 0,
    );
  }

  /* ── 7. Edits follow, deletions withdraw ────────────────────────────────── */

  console.log('\n7. The copy follows an edit and dies with a deletion');

  {
    const editedId = await intakeChannelEdit(
      deps,
      BOT,
      parseChannelPost(
        channelItem({ itemId: 110, text: 'Market day moves to SUNDAY.', sharedMsgId: 'sh-fresh' }),
      ) as never,
    );
    check('an edit updates the stored post', editedId !== null);
    calls.length = 0;
    await propagateForPost(deps, editedId as number, 'edit');
    const update = calls.find((c) => c.kind === 'update');
    check(
      'the live copy is EDITED IN PLACE with the new text (recomposition)',
      update !== undefined && (update.text ?? '').includes('SUNDAY'),
    );
    check('  in the destination group', update?.groupId === DEST_GROUP);
  }
  {
    const marked = await intakeChannelDeletion(deps, BOT, CHANNEL_GROUP, [110]);
    check('a source deletion marks the post', marked.length === 1);
    calls.length = 0;
    await propagateForPost(deps, marked[0] as number, 'withdraw');
    check(
      'the sole copy is deleted FOR EVERYONE (broadcast), not merely locally',
      calls.some((c) => c.kind === 'delete' && c.groupId === DEST_GROUP),
    );
    const withdrawal = await db.query<{ n: string | number }>(
      `SELECT count(*) AS n FROM cinderella_bridge_forwards WHERE kind = 'withdrawal'`,
    );
    check('  and the withdrawal is a forward-log record', Number(withdrawal.rows[0]?.n) > 0);
  }

  /* ── 8. No model on the path, and the lines are guarded ─────────────────── */

  console.log('\n8. No model is anywhere near a channel post');

  {
    const src = readFileSync('src/plugins/channel-bridge/service.ts', 'utf8');
    check(
      'the service imports no reply generator and no engine',
      !src.includes('ollama-reply') && !src.includes('generateOllamaReply') && !src.includes("from '../../interaction/engine.js'"),
    );
    const cadenceSrc = readFileSync('src/plugins/channel-bridge/cadence.ts', 'utf8');
    check('  and neither does the cadence', !cadenceSrc.includes('ollama'));
  }
  {
    const persona = normalizeInteraction({ ...DEFAULT_INTERACTION }).persona;
    const templates = Object.values(persona).flatMap((s) =>
      Object.values(s as Record<string, string>).filter((v): v is string => typeof v === 'string'),
    );
    const derived = markersFromTemplates(templates);
    check(
      'the attribution lines are GUARDED: a model imitating one is stripped',
      derived.markers.includes('📣 From the channel') &&
        derived.markers.includes('📣 Aus dem Kanal') &&
        derived.markers.includes('📣 Also new in') &&
        derived.markers.includes('📣 Ebenfalls neu in'),
    );
    check(
      "  and both bridge persona keys publish under the 'bridge' category",
      PERSONA_CATEGORY['bridgeAttribution'] === 'bridge' && PERSONA_CATEGORY['bridgeMore'] === 'bridge',
    );
    check(
      "  which ships EXCLUDED from the public archive",
      DEFAULT_ARCHIVE.categories['bridge'] === false,
    );
  }
  {
    // The mapping list is intact after everything above: storage survived use.
    const finalMappings = await listBridgeMappings(db, BOT);
    check('the mapping survived the whole exercise, enabled', finalMappings[0]?.enabled === true);
  }

  await sectionContentType();
  console.log(
    failures === 0
      ? '\nAll bridge checks passed: two worlds, a cadence that accounts for every post, a loop that cannot be configured or replayed, and a suppression that cannot be silent.'
      : `\n${String(failures)} CHECK(S) FAILED.`,
  );
  await pg.close();
  // `exitCode`, not `exit()` (D-189). `process.exit` tears the process down without
  // waiting for stdout to drain, and stdout to a PIPE is asynchronous, so the summary
  // this harness just wrote can be discarded before it is read - which is precisely the
  // shape of a check that reports something other than what it found.
  process.exitCode = failures === 0 ? 0 : 1;
}

main().catch((err: unknown) => {
  // A CRASH IS NOT A PASS, AND IT IS NOT A FAILURE COUNT EITHER (D-189).
  //
  // This used to print the stack and exit, so a throw anywhere in `main` produced a run
  // with no verdict at all: sections after the throw never ran, the summary was never
  // written, and a reader scrolling to the bottom found a stack trace where the count
  // belongs. That is how six red checks were reported as "2 CHECK(S) FAILED" by anyone
  // reading a truncated tail. The run says what it is now: incomplete, with the count it
  // had reached, and never a number that looks like a complete result.
  console.error(err);
  console.error(
    `\nRUN INCOMPLETE - the harness threw before finishing. ${String(failures)} check(s) had ` +
      `already failed; the sections after the throw did NOT run, so this is not a count of ` +
      `what is wrong.`,
  );
  process.exitCode = 1;
});
