/**
 * An in-process double for the SimpleX chat core's active-user behaviour.
 *
 * `scripts/` is exempt from `verify:adapter-seam`, but this file needs no exemption:
 * it imports no SDK. It exists because the runtime's most important property cannot be
 * tested any other way.
 *
 * ── WHY A DOUBLE AND NOT N FakeChatAdapter INSTANCES ────────────────────────
 *
 * `FakeChatAdapter` has no active-user state at all, so N of them cannot reproduce the
 * failure the scheduler exists to prevent: they would simply all succeed, and the
 * negative test would pass whether or not the scheduler were there. A test that cannot
 * fail proves nothing.
 *
 * ── HOW THE FAILURE IS REPRODUCED, AND WHY IT IS DETERMINISTIC ──────────────
 *
 * The real failure comes from a gap. "Become profile A, then send" is two calls, and a
 * concurrent "become B" landing between them makes the first send execute as B. The
 * core raises nothing, because a legal command was issued by a genuinely active
 * profile.
 *
 * {@link FakeCore.setActiveUser} reproduces exactly that: it yields to the microtask
 * queue BEFORE assigning. With N operations started concurrently and unserialized, all
 * N pass through their yields in lockstep, so every assignment lands before any command
 * reads the value, and every command then runs as the LAST profile assigned. One
 * success per batch, which is what D-085 measured against the live core (7 of 20 across
 * batches of three).
 *
 * Microtask ordering in V8 is strictly FIFO, so this is fully deterministic: no timers,
 * no sleeps, no flake. The same harness run produces the same interleaving every time.
 */

export interface FakeUser {
  userId: number;
  displayName: string;
}

/** One command execution, with what it INTENDED and what it actually ran as. */
export interface Execution {
  label: string;
  intendedUserId: number;
  ranAsUserId: number | undefined;
  /** The whole point: false means the command silently executed as the wrong profile. */
  correct: boolean;
}

export interface FakeCoreOptions {
  users?: FakeUser[];
  /**
   * Microtask hops inside `setActiveUser` and each command, i.e. the width of the
   * window a concurrent switch can land in. Two is enough to interleave; more does not
   * change the outcome, only the number of hops.
   */
  yields?: number;
}

export class FakeCore {
  readonly users: FakeUser[];
  private readonly yields: number;

  activeUserId: number | undefined;

  readonly executions: Execution[] = [];
  switchCount = 0;

  /** Set to make the next `setActiveUser` reject, for the failure-path tests. */
  failNextSwitch = false;

  constructor(options: FakeCoreOptions = {}) {
    this.users = options.users ?? [
      { userId: 1, displayName: 'Alpha' },
      { userId: 2, displayName: 'Beta' },
      { userId: 3, displayName: 'Gamma' },
    ];
    this.yields = options.yields ?? 2;
  }

  /** The window a concurrent switch can land in. */
  private async window(): Promise<void> {
    for (let i = 0; i < this.yields; i++) await Promise.resolve();
  }

  /**
   * Become `userId`. Yields BEFORE assigning, which is the gap the whole problem lives
   * in. Never raises on a wrong-profile outcome, because the real core does not either.
   */
  async setActiveUser(userId: number): Promise<void> {
    this.switchCount++;
    await this.window();
    if (this.failNextSwitch) {
      this.failNextSwitch = false;
      throw new Error(`FakeCore: simulated failure switching to user ${userId}`);
    }
    this.activeUserId = userId;
  }

  /**
   * Issue an active-user-dependent command.
   *
   * Records which profile it actually ran as. `intendedUserId` is what the CALLER
   * meant; the fake never uses it to influence execution, only to score afterwards.
   */
  async issue<T = void>(label: string, intendedUserId: number, produce?: () => T): Promise<T> {
    await this.window();
    const ranAsUserId = this.activeUserId;
    this.executions.push({
      label,
      intendedUserId,
      ranAsUserId,
      correct: ranAsUserId === intendedUserId,
    });
    return produce ? produce() : (undefined as T);
  }

  /** How many commands executed as the profile their caller intended. */
  get correctCount(): number {
    return this.executions.filter((e) => e.correct).length;
  }

  reset(): void {
    this.executions.length = 0;
    this.switchCount = 0;
    this.activeUserId = undefined;
    this.failNextSwitch = false;
  }
}

/**
 * The UNSERIALIZED control: what the runtime would do without the scheduler.
 *
 * Deliberately the naive-but-reasonable implementation, not a strawman. It awaits both
 * calls in order, which looks correct in isolation and is exactly what someone writes
 * before they know about the gap.
 */
export async function runUnserialized(
  core: FakeCore,
  ops: readonly { userId: number; label: string }[],
): Promise<void> {
  await Promise.all(
    ops.map(async ({ userId, label }) => {
      await core.setActiveUser(userId);
      await core.issue(label, userId);
    }),
  );
}
