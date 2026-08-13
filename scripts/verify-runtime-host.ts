/**
 * One bot hosted on the multi-profile runtime, proven (CCB-S4-021).
 *
 *   npx tsx scripts/verify-runtime-host.ts
 *
 * ── WHAT THIS CAN AND CANNOT PROVE, STATED UP FRONT ─────────────────────────
 *
 * There is no SimpleX core on this test path, so this harness proves the WIRING and
 * not the hosting. Everything below is a property that a refactor could break silently
 * and that a live boot would not obviously expose:
 *
 *   PROVEN HERE: the profile-resolution rules, including the two that would otherwise
 *   produce a bot in no groups; the bot-profile guard that keeps media working; that
 *   capture driven through the router behaves IDENTICALLY to capture driven through
 *   the SDK's own subscriber table, event for event and hook call for hook call; that
 *   one profile's events never reach another's handlers; that nothing can be sent
 *   before readiness; that the runtime's SDK-free files are still SDK-free.
 *
 *   NOT PROVEN HERE, and claimed nowhere: that a real core reaches ready, how long it
 *   takes, that a real send is attributed to the right profile by the real core, or
 *   that media receipt still works. Those need a core, and the completion report says
 *   what was run against one and what is still owed.
 */

import type { T } from '@simplex-chat/types';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  botProfileFor,
  resolveProfileSpecs,
  type ProfileDirectory,
  type RuntimeProfileSpec,
} from '../src/bot/runtime/profiles.js';
import { RoutedEventSource } from '../src/bot/runtime/events.js';
import { heldUntilReady } from '../src/bot/runtime/gate.js';
import { EventRouter } from '../src/bot/runtime/router.js';
import { emptyCounters } from '../src/bot/runtime/types.js';
import { findRenameOnBoot, renameRefusal } from '../src/bot/runtime/naming.js';
import { registerCapture, type CaptureHooks, type CaptureHost } from '../src/capture/handler.js';
import { sendViaRuntime } from '../src/bot/send.js';
import type { CapturedMessage } from '../src/capture/message.js';
import type { Config } from '../src/config.js';

let failures = 0;
function check(label: string, ok: boolean, detail = ''): void {
  if (!ok) failures++;
  console.log(`  [${ok ? 'PASS' : 'FAIL'}] ${label}${detail ? ` - ${detail}` : ''}`);
}
function section(t: string): void {
  console.log(`\n${t}`);
}
function measure(label: string, value: string): void {
  console.log(`  [....] ${label} = ${value}`);
}
async function threw(fn: () => Promise<unknown>): Promise<Error | null> {
  try {
    await fn();
    return null;
  } catch (err) {
    return err instanceof Error ? err : new Error(String(err));
  }
}

const userOf = (userId: number, displayName: string): T.User =>
  ({ userId, profile: { displayName, fullName: '' } }) as unknown as T.User;

/** A core directory double. Records what it was asked to do. */
function directory(users: T.User[], active: T.User | undefined) {
  const created: T.Profile[] = [];
  const dir: ProfileDirectory = {
    listUsers: () => Promise.resolve(users.map((user) => ({ user }) as unknown as T.UserInfo)),
    getActiveUser: () => Promise.resolve(active),
    createUser: (profile) => {
      created.push(profile);
      const u = userOf(900 + created.length, profile.displayName);
      users.push(u);
      return Promise.resolve(u);
    },
  };
  return { dir, created };
}

/* ============================================ the bot-profile guard (R6, D-096) */

section('The bot profile: the guard that keeps media working');
{
  const p = botProfileFor('Test Bot');
  check('peerType is Bot', p.peerType === 'bot', String(p.peerType));
  check('file transfer is allowed', p.preferences?.files?.allow === 'yes', String(p.preferences?.files?.allow));
  check('calls are refused', p.preferences?.calls?.allow === 'no');
  check('voice is refused', p.preferences?.voice?.allow === 'no');
  check(
    'commands is present, because mkBotProfile always sets it',
    Array.isArray(p.preferences?.commands),
    'absence would make every boot rewrite the profile',
  );
  check('no image unless one is supplied', p.image === undefined);
  check('an avatar is carried when supplied', botProfileFor('Test Bot', 'data:image/jpg;base64,AA').image === 'data:image/jpg;base64,AA');
}

/* =================================================== profile resolution (R7) */

section('Profile resolution: the two failures that would leave a bot in no groups');
{
  const existing = userOf(1, 'CIND3R3LLA');

  {
    const { dir, created } = directory([existing], existing);
    const r = await resolveProfileSpecs([{ displayName: 'CIND3R3LLA', adopt: 'activeUser' }], dir);
    check('an active user is adopted', r[0]?.user.userId === 1 && r[0]?.how === 'adopted the core active user');
    check('and nothing is created', created.length === 0);
  }

  {
    // THE failure this rule exists for: the operator edits BOT_DISPLAY_NAME. Matching
    // by name would create a second, empty profile that is in no groups and captures
    // nothing, on a boot that logs success.
    const { dir, created } = directory([existing], existing);
    // Caught rather than awaited bare: an implementation that resolved by NAME would
    // throw here, and a harness that died on it would report nothing at all.
    let r: Awaited<ReturnType<typeof resolveProfileSpecs>> | null = null;
    try {
      r = await resolveProfileSpecs([{ displayName: 'Renamed', adopt: 'activeUser' }], dir);
    } catch (err) {
      check('a changed display name does not make resolution fail', false, String(err).slice(0, 70));
    }
    check(
      'a changed display name still adopts the SAME SimpleX user',
      r?.[0]?.user.userId === 1,
      `got ${String(r?.[0]?.user.userId)}`,
    );
    check('it does NOT create a second profile', created.length === 0);
    check(
      'and it does NOT rename the stored profile',
      r?.[0]?.user.profile.displayName === 'CIND3R3LLA',
    );
  }

  {
    const { dir, created } = directory([], undefined);
    const r = await resolveProfileSpecs([{ displayName: 'Fresh', adopt: 'activeUser' }], dir);
    check('an empty core database gets a profile created', r[0]?.how === 'created');
    check(
      'created through the guarded bot profile, not a bare one',
      created[0]?.peerType === 'bot' && created[0]?.preferences?.files?.allow === 'yes',
    );
  }

  {
    // Ambiguity is refused rather than guessed: picking one of several would hand the
    // group membership of a different bot to this one.
    const { dir } = directory([userOf(1, 'A'), userOf(2, 'B')], undefined);
    const err = await threw(() =>
      resolveProfileSpecs([{ displayName: 'A', adopt: 'activeUser' }], dir),
    );
    check('users but no active user is refused, not guessed', err !== null);
    check('and the refusal names the candidates', /1, 2/.test(err?.message ?? ''), (err?.message ?? '').slice(0, 60));
  }

  {
    const { dir } = directory([userOf(7, 'Seven')], userOf(7, 'Seven'));
    const r = await resolveProfileSpecs([{ simplexUserId: 7, displayName: 'Seven' }], dir);
    check('an explicitly named id is adopted by id', r[0]?.how === 'named by id');
    const err = await threw(() =>
      resolveProfileSpecs([{ simplexUserId: 42, displayName: 'Ghost' }] as RuntimeProfileSpec[], dir),
    );
    check('an id the core does not have is a loud drift error', err !== null);
    check('naming the ids the core does have', /Known ids: 7/.test(err?.message ?? ''));
  }
}

/* ======================================================= the routed event source */

section('The routed event source: the SDK shape, fed from the router');
{
  const src = new RoutedEventSource();
  const seen: string[] = [];
  src.on('newChatItems', () => {
    seen.push('a');
  });
  src.on('newChatItems', () => {
    seen.push('b');
  });
  await src.dispatch({ type: 'newChatItems', userId: 1, payload: {} });
  check('every handler for a tag runs, in order', seen.join(',') === 'a,b', seen.join(','));

  const after: string[] = [];
  const src2 = new RoutedEventSource();
  src2.on('newChatItems', () => {
    throw new Error('first handler exploded');
  });
  src2.on('newChatItems', () => {
    after.push('ran anyway');
  });
  const err = await threw(() => src2.dispatch({ type: 'newChatItems', userId: 1, payload: {} }));
  check('a throwing handler does not stop the ones behind it', after.length === 1);
  check(
    'but the failure is re-thrown rather than swallowed as the SDK does',
    err !== null,
    err?.message.slice(0, 40) ?? '',
  );

  const src3 = new RoutedEventSource();
  await src3.dispatch({ type: 'newChatItems', userId: 1, payload: {} });
  check(
    'an event for a tag nobody subscribed to is COUNTED, not silently dropped',
    src3.unhandled.get('newChatItems') === 1,
  );
}

/* ================================================= per-profile isolation (§6.3) */

section("Isolation: one profile's events never reach another's handlers");
{
  const counters = emptyCounters();
  const router = new EventRouter({ counters });
  const mine = new RoutedEventSource();
  const theirs = new RoutedEventSource();
  router.register(1, (e) => mine.dispatch(e));
  router.register(2, (e) => theirs.dispatch(e));

  const gotMine: number[] = [];
  const gotTheirs: number[] = [];
  mine.on('newChatItems', () => {
    gotMine.push(1);
  });
  theirs.on('newChatItems', () => {
    gotTheirs.push(2);
  });

  await router.route({ type: 'newChatItems', userId: 1, payload: {} });
  await router.route({ type: 'newChatItems', userId: 2, payload: {} });
  await router.route({ type: 'newChatItems', userId: 2, payload: {} });
  check('each profile got exactly its own', gotMine.length === 1 && gotTheirs.length === 2, `${gotMine.length}/${gotTheirs.length}`);
}

/* ======================= capture through the router == capture through the SDK */

section('Capture: the router path behaves identically to the pre-runtime path');
{
  const cfg = { groupName: '' } as unknown as Config;

  const groupMember = {
    memberId: 'member-alice',
    memberProfile: { displayName: 'Alice' },
    localDisplayName: 'Alice',
  };
  let nextItemId = 100;
  const item = (text: string, groupId = 1): T.AChatItem =>
    ({
      chatInfo: { type: 'group', groupInfo: { groupId, localDisplayName: 'archive' } },
      chatItem: {
        chatDir: { type: 'groupRcv', groupMember },
        meta: { itemId: nextItemId++, itemTs: '2026-08-03T10:00:00Z' },
        content: { type: 'rcvMsgContent', msgContent: { type: 'text', text } },
      },
    }) as unknown as T.AChatItem;

  /** Records every hook call, in order, as comparable strings. */
  function recorder(): { hooks: CaptureHooks; log: string[] } {
    const logged: string[] = [];
    const hooks: CaptureHooks = {
      onMessage: (m) => {
        logged.push(`message:${m.itemId}:${m.text}`);
      },
      onCommand: (m, c) => {
        logged.push(`command:${m.itemId}:${c}`);
      },
      onInteraction: (m) => {
        logged.push(`interaction:${m.itemId}`);
        return Promise.resolve(m.text.startsWith('@bot'));
      },
      onInstruction: (m, category) => {
        logged.push(`instruction:${m.itemId}:${category ?? 'none'}`);
      },
      onDeleted: (groupId, ids) => {
        logged.push(`deleted:${groupId}:${ids.join('+')}`);
      },
      isAddressed: (m) => m.text.startsWith('@bot'),
    };
    return { hooks, log: logged };
  }

  const events = [
    { tag: 'newChatItems', payload: { chatItems: [item('ordinary message')] } },
    { tag: 'newChatItems', payload: { chatItems: [item('/publish')] } },
    { tag: 'newChatItems', payload: { chatItems: [item('@bot what is the price')] } },
    { tag: 'chatItemUpdated', payload: { chatItem: item('an edit') } },
    {
      tag: 'groupChatItemsDeleted',
      payload: { groupInfo: { groupId: 1 }, chatItemIDs: [1, 2] },
    },
  ];

  // (a) the pre-runtime shape: handlers registered straight onto a chat-like object.
  const direct = new Map<string, (e: unknown) => Promise<void>>();
  const legacyRec = recorder();
  const legacyHost = {
    chat: {
      on: (tag: string, h: (e: unknown) => Promise<void>) => direct.set(tag, h),
    },
    fileReceiver: { receive: () => Promise.reject(new Error('no files in this test')) },
  } as unknown as CaptureHost;
  const startId = nextItemId;
  registerCapture(legacyHost, cfg, legacyRec.hooks, { targetGroupId: 1 });
  for (const e of events) await direct.get(e.tag)?.(e.payload);

  // (b) the runtime shape: the identical handlers, fed by the router.
  nextItemId = startId; // same item ids, so the two logs are comparable
  const counters = emptyCounters();
  const router = new EventRouter({ counters });
  const source = new RoutedEventSource();
  router.register(1, (e) => source.dispatch(e));
  const runtimeRec = recorder();
  registerCapture(
    { chat: source, fileReceiver: { receive: () => Promise.reject(new Error('no files')) } },
    cfg,
    runtimeRec.hooks,
    { targetGroupId: 1 },
  );
  for (const e of events) await router.route({ type: e.tag, userId: 1, payload: e.payload });

  measure('pre-runtime hook calls', legacyRec.log.join(' | ') || '(none)');
  measure('runtime hook calls', runtimeRec.log.join(' | ') || '(none)');
  check('capture produced SOME calls, so the comparison means something', legacyRec.log.length > 0);
  check(
    'the runtime path produces the IDENTICAL hook calls, in the identical order',
    legacyRec.log.join('|') === runtimeRec.log.join('|'),
  );
  check('every routed event was attributed to the profile', counters.eventsRouted === events.length);
  check('none went unattributed or to an unknown profile',
    counters.eventsUnattributed === 0 && counters.eventsUnknownProfile === 0);
}

/* ========================================================= the readiness gate */

section('The readiness gate: nothing sends before the core has settled');
{
  const issued: string[] = [];
  let ready = false;
  let release: () => void = () => undefined;
  const readyPromise = new Promise<void>((resolve) => {
    release = () => {
      ready = true;
      resolve();
    };
  });

  const held: string[] = [];
  const send = heldUntilReady(
    (text: string) => {
      issued.push(text);
      return Promise.resolve(text);
    },
    { ready: () => readyPromise, isReady: () => ready, onHold: (l) => held.push(l) },
    'group-reply',
  );

  const first = send('sent during warm-up');
  await Promise.resolve();
  await Promise.resolve();
  check('a send issued while subscribing does NOT reach the core', issued.length === 0);
  check('and it is recorded as held rather than silently delayed', held.length === 1);

  release();
  await first;
  check('it goes out once the core is ready', issued.join(',') === 'sent during warm-up');

  await send('sent when ready');
  check('a later send is not held', held.length === 1, `${held.length} holds`);
  check('and both arrived in order', issued.join(',') === 'sent during warm-up,sent when ready');

  // Shutdown before readiness must fail the send, not hang it.
  const rejecting = heldUntilReady(
    () => Promise.resolve('unreachable'),
    { ready: () => Promise.reject(new Error('stopped before ready')), isReady: () => false },
  );
  check('a send during shutdown fails rather than hanging', (await threw(() => rejecting())) !== null);
}

/* ======================================================= the outbound decision */

section('The outbound decision is the same as the pre-runtime transport');
{
  const calls: Array<[number, string, number | undefined]> = [];
  const send = (groupId: number, text: string, quotedItemId?: number): Promise<T.AChatItem[]> => {
    calls.push([groupId, text, quotedItemId]);
    return Promise.resolve([]);
  };
  const msg = { groupId: 12, itemId: 345 } as unknown as CapturedMessage;

  await sendViaRuntime(send, msg, 'plain', { quote: false });
  check('a plain reply carries no quoted item', calls[0]?.[2] === undefined);
  check('and goes to the message\'s own group', calls[0]?.[0] === 12);

  await sendViaRuntime(send, msg, 'quoted', { quote: true });
  check(
    'a quoting reply quotes the triggering item, as apiSendTextReply does',
    calls[1]?.[2] === 345,
    String(calls[1]?.[2]),
  );
}

/* ===================================== every bot is named from its own record (D-173) */

section('The reconciliation: a bot that would be renamed in front of its group');
{
  // The dangerous half of CCB-S5-019. Until it, the primary's SimpleX profile was named
  // from BOT_DISPLAY_NAME and every other bot from its record; every bot reads its record
  // now. Where the two disagree for the bot WEARING the env name, the next deploy renames
  // it silently, once, and irreversibly from the members' side.
  const ENV = 'CIND3R3LLA';

  // ── The ordinary deployment: they agree, and nothing happens ──────────────
  check(
    'a bot whose live name and record agree boots',
    findRenameOnBoot([{ liveName: ENV, recordName: ENV }], ENV) === null,
  );
  check(
    'and so does a whole deployment of them',
    findRenameOnBoot(
      [
        { liveName: ENV, recordName: ENV },
        { liveName: 'Aurora', recordName: 'Aurora' },
      ],
      ENV,
    ) === null,
  );

  // ── The one that refuses ──────────────────────────────────────────────────
  const caught = findRenameOnBoot(
    [
      { liveName: ENV, recordName: 'Renamed In The Console' },
      { liveName: 'Aurora', recordName: 'Aurora' },
    ],
    ENV,
  );
  check('the bot wearing the env name with a differing record is caught', caught !== null);
  check(
    'and it is that bot, not its neighbour',
    caught?.liveName === ENV && caught?.recordName === 'Renamed In The Console',
  );

  // The message is the whole remedy: an operator reads it at deploy time and has to act on
  // it without reading the source. Both values by name, and both directions offered.
  const message = caught === null ? '' : renameRefusal(caught);
  check('the refusal quotes the name its members see', message.includes(`"${ENV}"`));
  check('and the name in the record', message.includes('"Renamed In The Console"'));
  check('and names the env var, so the second remedy is actionable', message.includes('BOT_DISPLAY_NAME'));
  check('and names the page, so the first one is', message.includes('AI Bot Setup'));
  check('and says nothing was changed', /nothing has been changed/i.test(message));

  // ── BOUNDED. These must all still boot ────────────────────────────────────
  //
  // A refusal that fired on any disagreement would pass every assertion above and stop
  // deployments that are in no danger at all. This is the half that says it does not.
  check(
    'a SECOND bot whose record differs from an env value it never wore still boots',
    findRenameOnBoot(
      [
        { liveName: ENV, recordName: ENV },
        { liveName: 'Aurora', recordName: 'Something Else' },
      ],
      ENV,
    ) === null,
  );
  check(
    'and a deployment whose BOT_DISPLAY_NAME matches nobody boots',
    findRenameOnBoot(
      [
        { liveName: 'Aurora', recordName: 'Something Else' },
        { liveName: 'Rick', recordName: 'Also Different' },
      ],
      ENV,
    ) === null,
  );
  check(
    'and so does a deployment with no bots at all',
    findRenameOnBoot([], ENV) === null,
  );

  // ── MUTATION: the shape that was rejected ─────────────────────────────────
  //
  // A migration copying the env value into the record, or equivalently a boot that just
  // took the env name for the primary and said nothing. Modelled as "always take the env
  // value": it never refuses, so the caught case above goes green while the bot gets
  // renamed. Printed so the guarantee is visible as a difference rather than asserted.
  const migrated = (bots: { liveName: string; recordName: string }[]): null => {
    void bots;
    return null;
  };
  check(
    'MUTATION: silently taking the env value refuses nothing, including the dangerous case',
    migrated([{ liveName: ENV, recordName: 'Renamed In The Console' }]) === null &&
      findRenameOnBoot([{ liveName: ENV, recordName: 'Renamed In The Console' }], ENV) !== null,
  );

  // ── MUTATION: the bound removed ───────────────────────────────────────────
  //
  // The other way to get this wrong, and the likelier one: refuse whenever ANY bot's live
  // name and record disagree. It catches the dangerous case too, so every assertion above
  // the bound would stay green - and it stops a deployment where a second bot was simply
  // renamed in the console, which is an ordinary thing to do and no danger at all.
  const unbounded = (bots: { liveName: string; recordName: string }[]) =>
    bots.find((b) => b.liveName !== b.recordName) ?? null;
  const safe = [
    { liveName: ENV, recordName: ENV },
    { liveName: 'Aurora', recordName: 'Something Else' },
  ];
  check(
    'MUTATION: without the bound, an ordinary console rename stops the deployment',
    unbounded(safe) !== null && findRenameOnBoot(safe, ENV) === null,
  );

  // ── And that host.ts actually acts on it ──────────────────────────────────
  //
  // The decision is pure and provable here; that the boot path THROWS on it is not, so it
  // is read out of the source. Without this the whole section could be green against a host
  // that computes the answer and drops it, which is the shape D-162 is about.
  const host = readFileSync(join('src', 'bot', 'runtime', 'host.ts'), 'utf8').replace(/\s+/g, ' ');
  check(
    'host.ts consults it',
    /const rename = findRenameOnBoot\(/.test(host),
  );
  check(
    'and throws rather than logging and continuing',
    /if \(rename !== null\) throw new Error\(renameRefusal\(rename\)\);/.test(host),
  );
  check(
    'and reads the live name from the core profile, not from the flag being retired',
    /liveName: \(b\.user\.profile as unknown as T\.Profile\)\.displayName/.test(host) &&
      !/selected_for_runtime|isPrimary/.test(host.replace(/\/\/[^\n]*/g, '')),
  );
  check(
    'and every bot is named from its own record when it does boot',
    /applyProfileUpdate\( runtime, b\.simplexUserId, b\.config\.displayName,/.test(host),
  );
}

/* ============================== the runtime's SDK-free files are still SDK-free */

section('D-105 scope review: the runtime files that must not import the SDK');
{
  // verify:multi-profile drives the whole runtime with no chat core, and stays runnable
  // only while these files import none. verify:adapter-seam cannot catch a regression
  // here: it permits the SDK anywhere under src/bot, which includes all of these.
  const mustBeFree = [
    'scheduler.ts',
    'router.ts',
    'state.ts',
    'errors.ts',
    'types.ts',
    'profiles.ts',
    'events.ts',
    'gate.ts',
    // Added by walking this check against a new file rather than assuming a green run
    // covered it (D-105, CCB-S5-007). `faces.ts` exists precisely so the avatar decision is
    // answerable with no core; an SDK import there would quietly undo that.
    'faces.ts',
    // Same walk, same reason (CCB-S5-019). `naming.ts` holds the reconciliation, which is
    // the one thing in this briefing that can stop a deployment, and it is only drivable
    // above because it imports no core.
    'naming.ts',
  ];
  const offenders: string[] = [];
  for (const file of mustBeFree) {
    const src = readFileSync(join('src', 'bot', 'runtime', file), 'utf8');
    // `import type ... from 'simplex-chat'` is erased and harmless; a value import is
    // what loads the native addon.
    for (const line of src.split(/\r?\n/)) {
      const isImport = /^\s*import\s/.test(line) && /'simplex-chat'/.test(line);
      if (isImport && !/^\s*import\s+type\s/.test(line)) offenders.push(`${file}: ${line.trim()}`);
    }
  }
  measure('files checked', String(mustBeFree.length));
  check('none of them loads the SDK', offenders.length === 0, offenders.join(' | '));

  const core = readFileSync(join('src', 'bot', 'runtime', 'core.ts'), 'utf8');
  check(
    'and core.ts, which is allowed to, still does - so the check is not vacuous',
    /import \{ api as chatApi \} from 'simplex-chat'/.test(core),
  );
}

/* ================= every subscribed event tag is real, and actually routed */

section('Event tags: subscribed to something the core emits, and something the runtime routes');
{
  // WHY THIS CHECK EXISTS (CCB-S4-024). A handler subscribed to a tag the core never
  // emits is not a compile error, not a lint error, and not a test failure. It is
  // SILENCE: the feature simply never happens, and every log line says the boot went
  // fine. That is unfalsifiable by any test that raises its own events, so the only
  // defence is to check the names against the SDK's own union and against the tags the
  // runtime actually routes.
  //
  // There are TWO ways to be deaf and the second is the one that will bite next:
  //   1. the tag does not exist at all (a typo, or a name from another SDK version);
  //   2. the tag exists, the core emits it, and the RUNTIME DOES NOT ROUTE IT, so the
  //      handler is wired to a source that will never deliver. Step three of onboarding
  //      subscribes to a group-invitation event, and forgetting ROUTED_TAGS would be
  //      exactly this.
  const eventTypes = readFileSync(
    join('node_modules', '@simplex-chat', 'types', 'dist', 'events.d.ts'),
    'utf8',
  );
  const union = /export type Tag = ([^;]+);/.exec(eventTypes)?.[1] ?? '';
  const sdkTags = new Set(
    union
      .split('|')
      .map((t) => t.trim().replace(/["']/g, ''))
      .filter(Boolean),
  );
  measure('tags in the SDK event union', String(sdkTags.size));
  check('the SDK union parsed at all, so the check is not vacuous', sdkTags.size > 20);

  // ROUTED_TAGS moved to `types.ts` under CCB-S5-041 (D-207) so that `RoutedEventSource.on()`
  // could be NARROWED to it: an unrouted subscription is a type error now, in every shape,
  // including the loop-over-a-const-array that walked straight past this scan. The scan stays
  // as the belt to that braces - it still catches a tag that is not an SDK event at all, which
  // the type cannot - but the type is what actually holds the rule.
  const runtimeTypes = readFileSync(join('src', 'bot', 'runtime', 'types.ts'), 'utf8');
  const routedBlock =
    /const ROUTED_TAGS[^=]*=\s*\[([\s\S]*?)\] as const;/.exec(runtimeTypes)?.[1] ?? '';
  const routed = new Set(
    [...routedBlock.matchAll(/'([a-zA-Z]+)'/g)].map((m) => m[1] as string),
  );
  measure('tags the runtime routes', [...routed].sort().join(', '));
  // Without this, moving ROUTED_TAGS makes the routed set EMPTY and every subscription looks
  // unrouted - which is exactly what happened when it moved. A vacuous scan must go red.
  check('the routed set parsed at all, so this scan is not vacuous', routed.size >= 10);

  const unknownRouted = [...routed].filter((t) => !sdkTags.has(t));
  check(
    'every routed tag is an event the SDK actually defines',
    unknownRouted.length === 0,
    unknownRouted.join(', '),
  );

  // Files whose subscriptions are fed by the runtime's router in production. The
  // pre-runtime path (`client.ts`, `connect.ts`) talks to the raw ChatApi and is
  // deliberately not in this list: its tags must be real, but they need not be routed.
  const ROUTED_SUBSCRIBERS = [
    join('src', 'bot', 'runtime', 'host.ts'),
    join('src', 'capture', 'handler.ts'),
    join('src', 'profiles', 'contact-requests.ts'),
    join('src', 'profiles', 'group-invitations.ts'),
  ];
  const ALL_SUBSCRIBERS = [
    ...ROUTED_SUBSCRIBERS,
    join('src', 'bot', 'client.ts'),
    join('src', 'bot', 'connect.ts'),
  ];
  // Node's own emitters share the `.on(` shape and are not chat events.
  const NOT_CHAT_EVENTS = new Set(['SIGINT', 'SIGTERM', 'error', 'exit', 'close']);

  const subscriptionsIn = (file: string): string[] =>
    [...readFileSync(file, 'utf8').matchAll(/\.on\(\s*'([a-zA-Z]+)'/g)]
      .map((m) => m[1] as string)
      .filter((t) => !NOT_CHAT_EVENTS.has(t));

  const bogus: string[] = [];
  let subscribed = 0;
  for (const file of ALL_SUBSCRIBERS) {
    for (const tag of subscriptionsIn(file)) {
      subscribed++;
      if (!sdkTags.has(tag)) bogus.push(`${file}: ${tag}`);
    }
  }
  measure('chat-event subscriptions found in src', String(subscribed));
  check('subscriptions were found, so the scan is not vacuous', subscribed >= 11);
  check(
    'every subscribed tag is an event the SDK actually defines',
    bogus.length === 0,
    bogus.join(' | '),
  );

  const unrouted: string[] = [];
  for (const file of ROUTED_SUBSCRIBERS) {
    for (const tag of subscriptionsIn(file)) {
      if (!routed.has(tag)) unrouted.push(`${file}: ${tag}`);
    }
  }
  check(
    'and every tag subscribed on the routed path is one the runtime routes',
    unrouted.length === 0,
    unrouted.length > 0
      ? `${unrouted.join(' | ')} - the handler would never fire`
      : '',
  );

  // The specific pair this briefing was about, named so the regression has a name.
  check(
    "the incoming contact request is 'receivedContactRequest', which is what 6.5.4 emits",
    sdkTags.has('receivedContactRequest') && routed.has('receivedContactRequest'),
  );
  check(
    "and 'contactRequest' is NOT an event tag, it is a ChatInfo kind",
    !sdkTags.has('contactRequest'),
  );
  // Step three's pair, named for the same reason: this is the step CCB-S4-024's guard
  // was written in anticipation of.
  check(
    "the group invitation is 'receivedGroupInvitation', routed",
    sdkTags.has('receivedGroupInvitation') && routed.has('receivedGroupInvitation'),
  );
  check(
    "and the join confirmation is 'userJoinedGroup', routed",
    sdkTags.has('userJoinedGroup') && routed.has('userJoinedGroup'),
  );
}

/* ---------------------------------------------------------------------- done */

section('Coverage');
console.log(`  proven here      every subscribed event tag exists AND is routed (CCB-S4-024)
                   profile resolution, incl. the renamed-bot and ambiguous-core cases
                   the bot-profile guard (peerType Bot, files allowed, commands set)
                   capture through the router == capture through the SDK, call for call
                   one profile's events never reach another's handlers
                   nothing is sent before readiness, and a held send is not lost
                   the runtime's SDK-free files are still SDK-free
                   the D-173 rename reconciliation: what refuses, what still boots,
                   and that host.ts throws on it rather than computing and dropping it
  live core only   that a real core reaches ready, and how long it takes
                   that a real send is attributed to this profile by the core
                   that media receipt still works end to end`);

console.log('\nRan against in-process doubles. No SimpleX core was involved.');
if (failures > 0) {
  console.error(`\n${failures} CHECK(S) FAILED`);
  process.exit(1);
}
console.log('ALL PASSED');
process.exit(0);
