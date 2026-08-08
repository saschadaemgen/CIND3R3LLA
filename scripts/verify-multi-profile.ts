/**
 * The multi-profile core foundation, proven (briefing §13).
 *
 *   npx tsx scripts/verify-multi-profile.ts
 *
 * ── WHAT THIS CAN AND CANNOT PROVE, STATED UP FRONT ─────────────────────────
 *
 * This repository has no SimpleX core and no network on its test path: the harnesses
 * are PGlite (Postgres in WASM) and in-process doubles. So the briefing's test table
 * splits in two, and the split is printed at the end of the run rather than left for a
 * reader to work out.
 *
 * PROVEN HERE: the registry and its §14 invariants; the scheduler's serialization,
 * INCLUDING a control run that genuinely fails without it; event routing by receiving
 * userId; the three routing outcomes; handler failures surfacing; the benign-noise
 * allowlist; every state-machine transition and both routes to `ready`.
 *
 * NOT PROVEN HERE, and not claimed: that a live core misroutes without the scheduler
 * (D-085 measured it, this harness reproduces the MECHANISM); that `startChat()`
 * returns before subscription completes; that 10 s quiet and 120 s ceiling are the
 * right constants; that `/_start` subscribes every user in a shared database rather
 * than only the active one; that N profiles in one real group each receive. Those need
 * a live core, and the completion report says so rather than implying coverage.
 */

import { PGlite } from '@electric-sql/pglite';
import { loadMigrationFiles } from '../src/db/migrate.js';
import type { Queryable } from '../src/db/pool.js';
import { FakeCore, runUnserialized } from './fake-core.js';
import { ActiveUserScheduler } from '../src/bot/runtime/scheduler.js';
import { EventRouter } from '../src/bot/runtime/router.js';
import { RuntimeStateMachine, type Cancellable } from '../src/bot/runtime/state.js';
import { classifyBenign, emptyBenignCounts, noteIfBenign } from '../src/bot/runtime/errors.js';
import { emptyCounters, type RoutableEvent } from '../src/bot/runtime/types.js';
import {
  ACTOR_TYPES,
  AUTOMATION_MODES,
  AVATAR_SOURCES,
  DEFAULT_AUTOMATION_MODE,
  findBySimplexUserId,
  listEnabledProfiles,
  registerProfile,
  sanitiseDisplayName,
  setAutomationMode,
  setEnabled,
  setPersonality,
  takeOver,
  type ActorType,
} from '../src/profiles/bot-registry.js';

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

/* ------------------------------------------------------------------ database */

const db = new PGlite();
const queryable: Queryable = {
  async query<R = Record<string, unknown>>(text: string, values?: readonly unknown[]) {
    const r = await db.query<R>(text, values ? [...values] : undefined);
    return { rows: r.rows, rowCount: r.rows.length };
  },
};

for (const m of await loadMigrationFiles()) await db.exec(m.sql);

async function auditCount(action: string): Promise<number> {
  const { rows } = await queryable.query<{ n: string }>(
    `SELECT count(*)::text AS n FROM audit_log WHERE action = $1`,
    [action],
  );
  return Number(rows[0]!.n);
}

/* ================================================== the registry (§6.7, §14) */

section('Registry schema and the four actor types (§3, §6.7)');
{
  const { rows } = await queryable.query<{ n: string }>(
    `SELECT count(*)::text AS n FROM information_schema.tables
      WHERE table_name = 'cinderella_bot_registry'`,
  );
  check('migration 023 applied', Number(rows[0]!.n) === 1);

  // §3: the four actor types must be distinct from the beginning.
  let created = 0;
  for (const actorType of ACTOR_TYPES) {
    const extras =
      actorType === 'human_operated_agent'
        ? { humanOperatorRef: 'operator:alice' }
        : actorType === 'npc'
          ? { disclosureLabel: 'Automated character account' }
          : {};
    await registerProfile(queryable, 'test', {
      simplexUserId: 100 + created,
      displayName: `Profile ${actorType}`,
      actorType,
      ...extras,
    });
    created++;
  }
  check('all four actor types register', created === 4);

  const all = await queryable.query<{ actor_type: string }>(
    `SELECT actor_type FROM cinderella_bot_registry ORDER BY simplex_user_id`,
  );
  check(
    'the four actor types remain distinct',
    new Set(all.rows.map((r) => r.actor_type)).size === 4,
  );

  check(
    'an unknown actor type is rejected by the schema',
    (await threw(() =>
      queryable.query(
        `INSERT INTO cinderella_bot_registry (simplex_user_id, display_name, actor_type, automation_mode)
         VALUES (999, 'X', 'moderator_bot', 'manual')`,
      ),
    )) !== null,
  );

  check(
    'a duplicate SimpleX user id is rejected',
    (await threw(() =>
      registerProfile(queryable, 'test', {
        simplexUserId: 100,
        displayName: 'Clash',
        actorType: 'human_user',
      }),
    )) !== null,
  );

  // §3.3 defaults.
  for (const actorType of ACTOR_TYPES) {
    const entry = await findBySimplexUserId(queryable, 100 + ACTOR_TYPES.indexOf(actorType));
    check(
      `${actorType} defaults to ${DEFAULT_AUTOMATION_MODE[actorType]}`,
      entry?.automationMode === DEFAULT_AUTOMATION_MODE[actorType],
      entry?.automationMode ?? 'missing',
    );
  }

  check(
    'a discovered profile is NOT enabled by default',
    (await listEnabledProfiles(queryable)).length === 0,
  );
}

section('Independence of concepts (§3.1): avatar source does not determine actor type');
{
  // §3.1 is explicit: "Do not infer actor type from avatar style." Prove the schema
  // permits every combination rather than merely not forbidding one.
  let combos = 0;
  let userId = 200;
  for (const actorType of ACTOR_TYPES) {
    for (const avatarSource of AVATAR_SOURCES) {
      const extras =
        actorType === 'human_operated_agent'
          ? { humanOperatorRef: 'operator:bob' }
          : actorType === 'npc'
            ? { disclosureLabel: 'Automated' }
            : {};
      await registerProfile(queryable, 'test', {
        simplexUserId: userId++,
        displayName: `${actorType}-${avatarSource}`,
        actorType,
        avatarSource,
        ...(avatarSource === 'none' ? {} : { avatarRef: 'media/avatar.jpg' }),
        ...extras,
      });
      combos++;
    }
  }
  check('every actor type x avatar source combination is permitted', combos === 16, `${combos}/16`);

  // §3.2: an uploaded avatar must remain supported for every profile, so an operator
  // can replace an unsuitable generated one.
  const uploadedForNpc = await queryable.query<{ n: string }>(
    `SELECT count(*)::text AS n FROM cinderella_bot_registry
      WHERE actor_type = 'npc' AND avatar_source = 'uploaded'`,
  );
  check('an NPC may carry an uploaded avatar', Number(uploadedForNpc.rows[0]!.n) === 1);

  check(
    'an avatar source other than none requires a reference',
    (await threw(() =>
      registerProfile(queryable, 'test', {
        simplexUserId: 300,
        displayName: 'Half written',
        actorType: 'human_user',
        avatarSource: 'uploaded',
      }),
    )) !== null,
  );
}

section('The §14 safety invariants');
{
  // "The system never silently changes a human-operated agent into a fully automated NPC."
  const opAgent = 101; // registered above as human_operated_agent
  const err = await threw(() => setAutomationMode(queryable, 'test', opAgent, 'fully_automated'));
  check('a human_operated_agent cannot be set fully_automated', err !== null);
  check(
    'and the refusal explains why rather than just failing',
    /never becomes a fully/i.test(err?.message ?? ''),
    (err?.message ?? '').slice(0, 60),
  );

  check(
    'the schema refuses it too, against any writer',
    (await threw(() =>
      queryable.query(
        `UPDATE cinderella_bot_registry SET automation_mode = 'fully_automated'
          WHERE simplex_user_id = $1`,
        [opAgent],
      ),
    )) !== null,
  );

  check(
    'a human_operated_agent cannot exist without an accountable operator',
    (await threw(() =>
      registerProfile(queryable, 'test', {
        simplexUserId: 301,
        displayName: 'Unowned agent',
        actorType: 'human_operated_agent',
      }),
    )) !== null,
  );

  // "The system never presents an NPC as a human-operated agent."
  check(
    'an npc cannot exist without a disclosure label',
    (await threw(() =>
      registerProfile(queryable, 'test', {
        simplexUserId: 302,
        displayName: 'Undisclosed npc',
        actorType: 'npc',
      }),
    )) !== null,
  );

  // §3.3: the model must allow a human-operated agent to move between assisted,
  // autopilot and manual takeover.
  await setAutomationMode(queryable, 'test', opAgent, 'autopilot');
  const before = await findBySimplexUserId(queryable, opAgent);
  check('a human_operated_agent can move to autopilot', before?.automationMode === 'autopilot');

  check(
    'leaving autopilot for manual must go through takeOver, not a plain mode change',
    /takeover/i.test(
      (await threw(() => setAutomationMode(queryable, 'test', opAgent, 'manual')))?.message ?? '',
    ),
  );

  const after = await takeOver(queryable, 'test', opAgent, 'operator intervened');
  check('manual takeover disables autopilot', after.automationMode === 'manual');
  check('the takeover is audited in its own right', (await auditCount('cinderella.bot-registry.takeover')) === 1);

  check(
    'takeover is refused for an actor type that has no operator',
    (await threw(() => takeOver(queryable, 'test', 103, 'nope'))) !== null,
  );

  measure(
    'audit rows written',
    `register=${await auditCount('cinderella.bot-registry.register')}, ` +
      `mode=${await auditCount('cinderella.bot-registry.automation-mode')}, ` +
      `takeover=${await auditCount('cinderella.bot-registry.takeover')}`,
  );
  check(
    'every automation-mode change is audited (§14)',
    (await auditCount('cinderella.bot-registry.automation-mode')) >= 1,
  );

  await setEnabled(queryable, 'test', opAgent, true);
  check('enabling is audited', (await auditCount('cinderella.bot-registry.enabled')) === 1);
  check('an enabled profile is listed for hosting', (await listEnabledProfiles(queryable)).length === 1);
}

section('Personality reference (§9.1) and display-name sanitisation (§12)');
{
  check(
    'the personality reference is all-or-nothing',
    (await threw(() =>
      queryable.query(
        `UPDATE cinderella_bot_registry SET personality_seed = 42 WHERE simplex_user_id = 100`,
      ),
    )) !== null,
  );

  const withPersonality = await setPersonality(queryable, 'test', 100, {
    personalityId: 'archetype:professionalSupport',
    seed: 4242,
    configVersion: 'traits-v1',
  });
  check(
    'a personality reference can be attached without a migration',
    withPersonality.personality?.seed === 4242 &&
      withPersonality.personality.configVersion === 'traits-v1',
  );

  const cleared = await setPersonality(queryable, 'test', 100, null);
  check('and cleared again', cleared.personality === null);

  // §12: SimpleX rejects `.` and `'`.
  check("sanitise strips '.' and apostrophes", sanitiseDisplayName("Dr. O'Hara") === 'Dr OHara');
  check('sanitise collapses whitespace', sanitiseDisplayName('  a   b  ') === 'a b');
  check(
    'a name that sanitises to nothing raises rather than writing an unusable profile',
    (await threw(async () => sanitiseDisplayName("..'"))) !== null,
  );
  check(
    'the schema also rejects a forbidden character, against any writer',
    (await threw(() =>
      queryable.query(
        `INSERT INTO cinderella_bot_registry (simplex_user_id, display_name, actor_type, automation_mode)
         VALUES (400, 'Mr. Bad', 'human_user', 'manual')`,
      ),
    )) !== null,
  );
}

/* ============ a command that never answers, and the tail behind it (CCB-S5-006) */

section('A command that stops answering does not stop every command behind it');
{
  /**
   * ── THE PRODUCTION SYMPTOM THIS IS FOR ─────────────────────────────────────
   *
   * She worded a reply and sent nothing, over and over, with no error in the log and
   * nothing on the admin dashboard. `run` chains every command onto `this.tail`, so ONE
   * call that never settles stops every command behind it for the life of the process,
   * and there was no timeout anywhere on that path. From outside it is indistinguishable
   * from a bot that has decided not to speak.
   */
  const hung = new FakeCore();
  const scheduler = new ActiveUserScheduler(hung, { commandTimeoutMs: 60 });

  const stuck = scheduler.run(1, 'never-answers', () => new Promise<void>(() => undefined));
  let abandoned = '';
  await stuck.catch((err: unknown) => {
    abandoned = err instanceof Error ? err.name : String(err);
  });
  check(
    'a command that never answers is abandoned rather than awaited forever',
    abandoned === 'SchedulerTimeoutError',
    abandoned || '(it never settled)',
  );

  // THE POINT: the queue behind it still runs. Without the bound this never resolves.
  const after = await Promise.race([
    scheduler.run(1, 'behind-it', () => Promise.resolve('sent')),
    new Promise<string>((resolve) => setTimeout(() => resolve('STILL BLOCKED'), 2_000)),
  ]);
  check(
    'and the command behind it still goes out, so one hang is not total silence',
    after === 'sent',
    after,
  );
  check(
    'the abandonment is reported, because silence with no error is what took a day to find',
    abandoned === 'SchedulerTimeoutError',
  );

  /**
   * MUTATION: the shape that shipped. No bound, so the second command waits on the first
   * one forever and the check above would read STILL BLOCKED.
   */
  const unbounded = new ActiveUserScheduler(new FakeCore(), { commandTimeoutMs: 3_600_000 });
  void unbounded.run(1, 'never-answers', () => new Promise<void>(() => undefined)).catch(() => undefined);
  const blocked = await Promise.race([
    unbounded.run(1, 'behind-it', () => Promise.resolve('sent')),
    new Promise<string>((resolve) => setTimeout(() => resolve('STILL BLOCKED'), 300)),
  ]);
  check(
    'MUTATION: without the bound, everything behind a hung command is blocked',
    blocked === 'STILL BLOCKED',
    blocked,
  );
}

/* ================================== the serialized scheduler (§6.5, §8, §13) */

section('The serialized scheduler (§8) - THE test that must not be a tautology');
{
  const BATCH = 20;
  const ops = Array.from({ length: BATCH }, (_, i) => ({
    userId: (i % 3) + 1,
    label: `op-${i}`,
  }));

  // The control: the naive implementation, which is what someone writes before they
  // know about the gap. If this passed, the scheduler would be proving nothing.
  const naive = new FakeCore();
  await runUnserialized(naive, ops);
  const naiveCorrect = naive.correctCount;
  measure('unserialized control', `${naiveCorrect}/${BATCH} commands ran as the intended profile`);
  check(
    'WITHOUT the scheduler, commands silently execute as the wrong profile',
    naiveCorrect < BATCH,
    `${naiveCorrect}/${BATCH}; the failure is silent, nothing raised`,
  );
  check(
    'and the control raised no error at all, which is what makes it dangerous',
    naive.executions.length === BATCH,
  );
  if (naiveCorrect === 7 && BATCH === 20) {
    // Worth saying out loud, because it will otherwise be misread as confirmation.
    console.log(
      '         NOTE: 7 of 20 is the same figure D-085 measured against a LIVE core.\n' +
        '         That is not a confirmation of the live measurement, it is the same\n' +
        '         arithmetic: one success per batch of three, and 20 operations make\n' +
        '         seven batches. This double reproduces the MECHANISM (a switch landing\n' +
        '         in another operation’s gap). Only a live core can confirm the core\n' +
        '         behaves this way.',
    );
  }

  // The same operations through the scheduler.
  const core = new FakeCore();
  const counters = emptyCounters();
  const scheduler = new ActiveUserScheduler(core, { counters });
  await Promise.all(
    ops.map((op) => scheduler.run(op.userId, op.label, () => core.issue(op.label, op.userId))),
  );
  measure('serialized', `${core.correctCount}/${BATCH} commands ran as the intended profile`);
  check(
    'WITH the scheduler, every command executes as its own profile',
    core.correctCount === BATCH,
    `${core.correctCount}/${BATCH}`,
  );
  check('every command was issued', core.executions.length === BATCH);
  check('the queue drained', scheduler.depth === 0);

  // The round-robin above alternates profiles on every command, so every one of them
  // legitimately pays for a switch. That is the worst case and it is worth stating.
  measure(
    'active-user switches, round-robin workload',
    `${counters.activeUserSwitches} switches, ${counters.activeUserReuses} reuses over ${BATCH} commands`,
  );
  check(
    'switches plus reuses account for every command',
    counters.activeUserSwitches + counters.activeUserReuses === BATCH,
  );

  // A workload GROUPED by profile must not pay a switch per command. This is the
  // difference between one core round trip per command and one per group, and it is
  // the reason the scheduler tracks the active user rather than asking each time.
  const grouped = [1, 1, 1, 2, 2, 2, 3, 3, 3].map((userId, i) => ({ userId, label: `g-${i}` }));
  const groupedCore = new FakeCore();
  const groupedCounters = emptyCounters();
  const groupedScheduler = new ActiveUserScheduler(groupedCore, { counters: groupedCounters });
  await Promise.all(
    grouped.map((op) =>
      groupedScheduler.run(op.userId, op.label, () => groupedCore.issue(op.label, op.userId)),
    ),
  );
  measure(
    'active-user switches, grouped workload',
    `${groupedCounters.activeUserSwitches} switches, ${groupedCounters.activeUserReuses} reuses over ${grouped.length} commands`,
  );
  check(
    'a command for the already-active profile skips the switch',
    groupedCounters.activeUserReuses === 6 && groupedCounters.activeUserSwitches === 3,
    `${groupedCounters.activeUserSwitches} switches, ${groupedCounters.activeUserReuses} reuses`,
  );
  check(
    'and grouping changes nothing about correctness',
    groupedCore.correctCount === grouped.length,
    `${groupedCore.correctCount}/${grouped.length}`,
  );

  // §6.6 depends on this: the archive of her own messages is built from the return value.
  const returned = await scheduler.run(1, 'returns', async () => ({ itemId: 7, text: 'hello' }));
  check(
    'the scheduler returns the command result verbatim',
    returned.itemId === 7 && returned.text === 'hello',
  );

  check(
    'a command with no valid profile is refused rather than run as whoever is active',
    (await threw(() => scheduler.run(0, 'bad', async () => undefined))) !== null,
  );

  // One failure must not break the chain for everything queued behind it.
  const failing = scheduler.run(2, 'boom', async () => {
    throw new Error('command failed');
  });
  const behind = scheduler.run(3, 'after', () => core.issue('after', 3));
  check('a failing command rejects to its own caller', (await threw(() => failing)) !== null);
  await behind;
  check('and the command queued behind it still runs', core.executions.at(-1)?.label === 'after');
  check('and it ran as the right profile', core.executions.at(-1)?.correct === true);

  // A failed switch must not leave a stale tracked active user.
  core.failNextSwitch = true;
  await threw(() => scheduler.run(1, 'switch-fails', async () => undefined));
  check(
    'a failed switch clears the tracked active user rather than trusting it',
    scheduler.currentUserId === undefined,
  );

  scheduler.invalidate();
  check('invalidate() forces the next command to set the active user', scheduler.currentUserId === undefined);
}

/* ===================================================== event routing (§6.3) */

section('Event routing by receiving userId (§6.3)');
{
  const counters = emptyCounters();
  const surfaced: string[] = [];
  const router = new EventRouter({ counters, onError: (m) => surfaced.push(m) });

  const seen = new Map<number, string[]>();
  for (const userId of [1, 2, 3]) {
    seen.set(userId, []);
    router.register(userId, (e) => {
      seen.get(userId)!.push(e.type);
    });
  }
  const coreSeen: RoutableEvent[] = [];
  router.onCoreEvent((e) => {
    coreSeen.push(e);
  });

  for (const userId of [1, 2, 3, 1, 2, 1]) {
    await router.route({ type: 'newChatItems', userId, payload: {} });
  }
  check('every event reaches exactly its own profile', seen.get(1)!.length === 3 && seen.get(2)!.length === 2 && seen.get(3)!.length === 1,
    `1:${seen.get(1)!.length} 2:${seen.get(2)!.length} 3:${seen.get(3)!.length}`);
  check('incoming events retain the receiving userId', counters.eventsRouted === 6);

  // The five event types that carry no user must NOT be guessed onto a profile.
  await router.route({ type: 'chatError', userId: null, payload: {} });
  await router.route({ type: 'subscriptionStatus', userId: null, payload: {} });
  check('an unattributed event goes to the core handler, not to a profile', coreSeen.length === 2);
  check('and is counted as unattributed', counters.eventsUnattributed === 2);
  check(
    'no profile received an unattributed event',
    seen.get(1)!.length === 3 && seen.get(2)!.length === 2 && seen.get(3)!.length === 1,
  );

  await router.route({ type: 'newChatItems', userId: 99, payload: {} });
  check('an event for an unhosted profile is counted, not dropped silently', counters.eventsUnknownProfile === 1);

  check(
    'a second handler for one profile is refused',
    (await threw(async () => router.register(1, () => undefined))) !== null,
  );

  // A handler throw must not kill the shared event loop, and must surface.
  router.register(4, () => {
    throw new Error('handler exploded');
  });
  await router.route({ type: 'newChatItems', userId: 4, payload: {} });
  check('a throwing handler does not propagate out of the router', true);
  check('a handler failure is counted', counters.handlerFailures === 1);
  check('a handler failure reaches the admin, not only the log', surfaced.length === 1, surfaced[0]?.slice(0, 50) ?? '');
}

section('The benign-noise allowlist (§11)');
{
  const dup = { type: 'errorStore', storeError: { type: 'duplicateGroupMessage' } };
  const ack = { type: 'errorAgent', agentError: { type: 'INTERNAL', internalErr: 'SEMsgNotFound "setMsgUserAck"' } };
  check('a duplicate group message is classified benign', classifyBenign(dup) === 'duplicate-group-message');
  check('the SEMsgNotFound ack is classified benign', classifyBenign(ack) === 'msg-not-found-ack');

  // The allowlist must be exactly these two, never a catch-all.
  check('a bare INTERNAL agent error is NOT benign', classifyBenign({ type: 'errorAgent', agentError: { type: 'INTERNAL', internalErr: 'disk on fire' } }) === null);
  check('another store error is NOT benign', classifyBenign({ type: 'errorStore', storeError: { type: 'duplicateContactLink' } }) === null);
  check('an ordinary Error is NOT benign', classifyBenign(new Error('nope')) === null);
  check('null is NOT benign', classifyBenign(null) === null);

  const counts = emptyBenignCounts();
  noteIfBenign(dup, counts);
  noteIfBenign(dup, counts);
  noteIfBenign(ack, counts);
  check('benign errors are counted so the admin can show them', counts.duplicateGroupMessage === 2 && counts.msgNotFoundAck === 1);

  // And benign noise must not surface as a failure.
  const counters = emptyCounters();
  const surfaced: string[] = [];
  const router = new EventRouter({ counters, onError: (m) => surfaced.push(m) });
  router.register(1, () => {
    throw dup;
  });
  await router.route({ type: 'newChatItems', userId: 1, payload: {} });
  check('benign noise does not trip the admin surface', surfaced.length === 0);
  check('and is not counted as a handler failure', counters.handlerFailures === 0);
  check('but it IS counted as benign', router.benignCounts.duplicateGroupMessage === 1);
}

/* =============================================== the state machine (§6.2, §7) */

section('The runtime state machine (§7)');
{
  // An injected clock and timer, so nothing here waits.
  let now = 0;
  const timers: { at: number; fn: () => void; cancelled: boolean }[] = [];
  const schedule = (fn: () => void, ms: number): Cancellable => {
    const t = { at: now + ms, fn, cancelled: false };
    timers.push(t);
    return {
      cancel: () => {
        t.cancelled = true;
      },
    };
  };
  const advance = (ms: number): void => {
    now += ms;
    for (const t of [...timers]) {
      if (!t.cancelled && t.at <= now) {
        t.cancelled = true;
        t.fn();
      }
    }
  };

  const transitions: string[] = [];
  const m = new RuntimeStateMachine({
    now: () => now,
    schedule,
    onTransition: (from, to, d) => transitions.push(`${from}->${to}${d.readyReason ? `(${d.readyReason})` : ''}`),
  });

  check('starts offline', m.state === 'offline');
  m.starting();
  check('offline -> starting', m.state === 'starting');
  m.subscribing();
  check('startChat() returning gives subscribing, NOT ready', m.state === 'subscribing');

  advance(9_000);
  check('still subscribing before the quiet period elapses', m.state === 'subscribing');

  // A subscription-class event restarts the quiet period.
  m.noteSubscriptionEvent();
  advance(9_000);
  check('a subscription event restarts the quiet period', m.state === 'subscribing');

  advance(10_000);
  check('quiet period elapsed -> ready', m.state === 'ready');
  check('and the runtime recorded that QUIET declared it', m.readyReason === 'quiet');

  m.degraded('core reported a fault');
  check('ready -> degraded', m.state === 'degraded');
  m.stopping();
  m.offline();
  check('stopping -> offline', m.state === 'offline');
  measure('transitions', transitions.join(' '));

  // The ceiling route: events never stop arriving.
  now = 0;
  timers.length = 0;
  const m2 = new RuntimeStateMachine({ now: () => now, schedule });
  m2.starting();
  m2.subscribing();
  for (let elapsed = 0; elapsed < 120_000; elapsed += 5_000) {
    advance(5_000);
    m2.noteSubscriptionEvent();
  }
  check('a core that never goes quiet still reaches ready', m2.state === 'ready');
  check('and records that the CEILING declared it, which is a fault signal', m2.readyReason === 'ceiling');

  // Illegal transitions are refused rather than tolerated.
  const m3 = new RuntimeStateMachine({ now: () => now, schedule });
  let illegal = false;
  try {
    m3.subscribing();
  } catch {
    illegal = true;
  }
  check('offline -> subscribing is refused (startChat cannot precede init)', illegal);
}

/* ---------------------------------------------------------------------- done */

section('Coverage of the briefing’s §13 table');
console.log(`  proven here      the four actor types remain distinct
                   avatar source does not determine actor type
                   manual takeover disables autopilot
                   outgoing commands are serialized
                   parallel requests cannot execute under the wrong profile
                   incoming events retain the receiving userId
  live core only   all profiles remain subscribed regardless of the active user (26 of 26)
                   active user changes do not affect incoming attribution (153 ms / 1771 ms)
                   group ids are per membership and globally unique (N distinct ids)
                   outgoing messages are recorded from command results (end to end)`);

console.log(`\nRan against PGlite and an in-process core double. No SimpleX core was involved.`);
if (failures > 0) {
  console.error(`\n${failures} CHECK(S) FAILED`);
  process.exit(1);
}
console.log('ALL PASSED');
process.exit(0);
