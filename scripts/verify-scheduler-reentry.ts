/**
 * A command may not schedule another from inside itself (CCB-S5-015, D-167).
 *
 *   npx tsx scripts/verify-scheduler-reentry.ts
 *
 * ── THE DEFECT ───────────────────────────────────────────────────────────────
 *
 * `flushAvatarToGroups` was wrapped in `bot.runScheduled`, and it calls `sendToGroup`, which
 * schedules. `ActiveUserScheduler.run` chains every command onto ONE tail, so the inner call
 * waited for the section that was waiting for it.
 *
 * Measured against the real scheduler before the fix, because the shape of the failure is the
 * argument for making it loud rather than merely correct:
 *
 *   - the outer command blocked for the FULL command timeout, 60 s in production, per bot,
 *     serialized by the boot loop;
 *   - it was then abandoned with an error reading "The message it carried did not go out";
 *   - and the inner send ran anyway, moments later, when the timeout released the tail.
 *
 * So the one diagnostic an operator could have had was false, and the observable symptom was
 * an avatar that changed late or not at all. The timeout is a backstop, not a diagnosis.
 *
 * ── WHAT IS ASSERTED ─────────────────────────────────────────────────────────
 *
 * Section 1 is the guard: re-entry is refused IMMEDIATELY and by name, in a small fraction of
 * the timeout, with both commands identified and the alarm raised. Section 2 is the positive
 * control that matters more than it looks: a guard that refused everything would pass every
 * check in section 1, so ordinary sequential and concurrent scheduling is proven still to
 * work, and the store is proven not to leak past the command it belongs to.
 *
 * Section 3 drives the REAL `flushAvatarToGroups` end to end with a scheduled send, which is
 * the regression guard for the fix itself: wrapped again, it does not complete.
 */

import { PGlite } from '@electric-sql/pglite';
import { vector } from '@electric-sql/pglite-pgvector';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  ActiveUserScheduler,
  SchedulerReentryError,
} from '../src/bot/runtime/scheduler.js';
import { flushAvatarToGroups } from '../src/bot/avatar.js';
import { loadMigrationFiles } from '../src/db/migrate.js';
import type { Queryable } from '../src/db/pool.js';
import { setLogLevel } from '../src/log.js';

let failures = 0;
function check(label: string, ok: boolean, detail = ''): void {
  if (!ok) failures++;
  console.log(`  [${ok ? 'PASS' : 'FAIL'}] ${label}${detail ? `: ${detail}` : ''}`);
}
function section(title: string): void {
  console.log(`\n${title}`);
}

/** The timeout a deadlock would have to wait for. Small, so a real one is unmistakable. */
const TIMEOUT_MS = 800;

function makeScheduler(onReentry?: (outer: string, inner: string) => void): ActiveUserScheduler {
  const core = { setActiveUser: async (_id: number) => Promise.resolve() };
  return new ActiveUserScheduler(core as never, {
    commandTimeoutMs: TIMEOUT_MS,
    slowWaitMs: 100_000,
    ...(onReentry ? { onReentry } : {}),
  });
}

async function main(): Promise<void> {
  setLogLevel('error');

  /* ── 1 ─────────────────────────────────────────────────────────────────── */

  section('1. Re-entry is refused immediately and by name');

  {
    const raised: { outer: string; inner: string }[] = [];
    const s = makeScheduler((outer, inner) => raised.push({ outer, inner }));

    const started = Date.now();
    let innerRan = false;
    let error: unknown = null;
    try {
      await s.run(1, 'avatar-flush', async () => {
        await s.run(1, 'sendGroupText:42', async () => {
          innerRan = true;
          return 'sent';
        });
      });
    } catch (err) {
      error = err;
    }
    const elapsed = Date.now() - started;

    check('the nested command is refused', error instanceof SchedulerReentryError, String(error));
    check(
      'IMMEDIATELY, rather than after the command timeout that used to break it',
      elapsed < TIMEOUT_MS / 2,
      `${elapsed} ms against a ${TIMEOUT_MS} ms timeout`,
    );
    check(
      'and the inner command never ran, so nothing is issued late',
      !innerRan,
      'before the fix it ran the moment the timeout released the tail',
    );
    check(
      'the error names BOTH commands, so the line that caused it is findable',
      (error as Error).message.includes('avatar-flush') &&
        (error as Error).message.includes('sendGroupText:42'),
    );
    check('and it says what to do instead', (error as Error).message.includes('outside'));
    check('the alarm is raised, so it reaches the admin and not only the log', raised.length === 1);
    check(
      '  naming the same two commands',
      raised[0]?.outer === 'avatar-flush' && raised[0]?.inner === 'sendGroupText:42',
    );
  }

  {
    // One queue regardless of user, so a nested call for a DIFFERENT bot deadlocks just the
    // same. Checked because "it is only a problem within one bot" is the plausible wrong
    // reading of the mechanism.
    const s = makeScheduler();
    let error: unknown = null;
    try {
      await s.run(1, 'outer:botA', async () => {
        await s.run(2, 'inner:botB', async () => 'x');
      });
    } catch (err) {
      error = err;
    }
    check(
      'a nested command for a DIFFERENT bot is refused too, because there is one queue',
      error instanceof SchedulerReentryError,
    );
  }

  /* ── 2 ─────────────────────────────────────────────────────────────────── */

  section('2. Ordinary scheduling is untouched, which a guard that refused everything would fail');

  {
    const s = makeScheduler();
    const order: string[] = [];

    check('a plain command runs and returns its value VERBATIM', (await s.run(1, 'a', async () => 'value')) === 'value');

    await s.run(1, 'b', async () => {
      order.push('b');
    });
    await s.run(1, 'c', async () => {
      order.push('c');
    });
    check('sequential commands both run', order.join(',') === 'b,c', order.join(','));

    // The store must not leak past the command it belongs to: scheduling AFTER a section has
    // finished is ordinary, and a guard keyed on a plain flag would refuse it.
    let afterOk = false;
    await s.run(1, 'd', async () => undefined);
    await s.run(1, 'e', async () => {
      afterOk = true;
    });
    check('scheduling after a section has finished is not mistaken for re-entry', afterOk);

    // Concurrent callers are the normal case: they WAIT for the lock, they do not hold it.
    const concurrent = await Promise.all([
      s.run(1, 'p1', async () => 1),
      s.run(2, 'p2', async () => 2),
      s.run(1, 'p3', async () => 3),
    ]);
    check(
      'concurrent callers all succeed, because waiting for the lock is not holding it',
      concurrent.join(',') === '1,2,3',
      concurrent.join(','),
    );

    // And scheduling from a callback that is NOT inside a section, which is what the fixed
    // flush does: the caller awaits, the callback schedules, nothing nests.
    const outsideFirst = await (async () => {
      const sent: number[] = [];
      for (const g of [10, 11]) await s.run(1, `send:${g}`, async () => void sent.push(g));
      return sent.join(',');
    })();
    check('a loop of scheduled sends outside any section works, which is the fix', outsideFirst === '10,11');
  }

  /* ── 3 ─────────────────────────────────────────────────────────────────── */

  section('3. The real flush completes, and would not if it were wrapped again');

  const pg = new PGlite({ extensions: { vector } });
  const db: Queryable = {
    async query(sql, values) {
      const result = await pg.query(sql, values ? [...values] : undefined);
      return {
        rows: result.rows as never[],
        rowCount: (result.affectedRows ?? result.rows.length) as number,
      };
    },
  };
  for (const migration of await loadMigrationFiles()) await pg.exec(migration.sql);

  {
    const s = makeScheduler();
    const sent: number[] = [];
    const user = {
      userId: 1,
      profile: { displayName: 'CIND3R3LLA', fullName: '', image: 'data:image/jpg;base64,AAAA' },
    };
    const bot = {
      user: user as never,
      displayName: 'CIND3R3LLA',
      // Scheduled, exactly as the real `sendGroupText` is.
      sendToGroup: (groupId: number, _text: string) =>
        s.run(1, `sendGroupText:${groupId}`, async () => {
          sent.push(groupId);
          return 'ok';
        }),
      // Scheduled too, since CCB-S5-018: a bare `apiListGroups` is refused with
      // `differentActiveUser` for every bot that is not the active one.
      listGroups: () =>
        s.run(1, 'listGroups:1', async () =>
          Promise.resolve([
            { groupId: 10, localDisplayName: 'archive' },
            { groupId: 11, localDisplayName: 'lab' },
          ]),
        ),
    };

    const started = Date.now();
    await flushAvatarToGroups(db, bot);
    const elapsed = Date.now() - started;

    check(
      'the flush completes, rather than blocking until the command timeout',
      elapsed < TIMEOUT_MS / 2,
      `${elapsed} ms`,
    );
    check('and it reached every group', sent.join(',') === '10,11', sent.join(','));

    // The marker is what stops a restart re-sending, so a flush that "worked" without
    // writing it would flood the group on every boot.
    const { rows } = await db.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM settings WHERE key LIKE 'avatarGroupFlushMarker:%'`,
    );
    check('and recorded its marker, so a restart does not re-send', Number(rows[0]?.n ?? 0) === 1);

    sent.length = 0;
    await flushAvatarToGroups(db, bot);
    check('a second flush of the same image sends nothing', sent.length === 0);
  }

  {
    // THE REGRESSION GUARD, driven rather than asserted on markup: wrapped the old way, the
    // same call does not complete. This is the check that goes red if anybody restores it.
    const s = makeScheduler();
    const bot = {
      user: { userId: 2, profile: { displayName: 'B', fullName: '', image: 'data:image/jpg;base64,BBBB' } } as never,
      displayName: 'B',
      sendToGroup: (groupId: number) => s.run(2, `sendGroupText:${groupId}`, async () => 'ok'),
      listGroups: () =>
        s.run(2, 'listGroups:2', async () =>
          Promise.resolve([{ groupId: 10, localDisplayName: 'g' }]),
        ),
    };
    let wrappedFailed = false;
    try {
      await s.run(2, 'avatar-flush', () => flushAvatarToGroups(db, bot));
    } catch {
      wrappedFailed = true;
    }
    check(
      'MUTATION: wrapped in runScheduled the way it shipped, the flush is refused',
      wrappedFailed,
      'so restoring the wrapper turns this red instead of costing 60 s a bot',
    );
  }

  {
    // And the source, because the runtime one above uses a stand-in for `runScheduled`.
    const src = readFileSync(join(process.cwd(), 'src', 'index.ts'), 'utf8');
    const wrapped = /runScheduled\(\s*['"]avatar-flush['"]/.test(src);
    check('the boot path does not wrap the flush in a critical section', !wrapped);
  }

  await pg.close();

  console.log(
    failures === 0
      ? '\nRe-entry is refused at the line that causes it, and the flush completes.'
      : `\n${failures} CHECK(S) FAILED.`,
  );
  if (failures > 0) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
