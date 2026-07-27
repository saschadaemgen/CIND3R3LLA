/**
 * What makes an instance the demo, and what makes it impossible for production to
 * become one by accident (CCB-S4-001 §1).
 *
 * THE BRIEFING'S OWN PRINCIPLE, applied to itself: "a flag in the live process is
 * an application-code check, and one missing check puts a stranger inside the
 * operator's real console. The quarantine trigger in CCB-S3-013 was made a
 * database trigger for exactly this reason: a guard that can be forgotten is not
 * a guard."
 *
 * The demo is the same code deployed twice, so SOMETHING has to tell the two
 * apart, and a single environment variable is exactly the forgettable guard the
 * briefing warns about: one typo in a unit file, one copied `.env`, and the
 * production console starts handing out sessions to strangers.
 *
 * So there are TWO independent guards, and both must agree:
 *
 *  1. `DEMO_INSTANCE=true` in the environment.
 *  2. A marker row IN THE DATABASE saying this database is a demo database.
 *
 * The second is the one that matters. It cannot be set by an environment mistake,
 * it travels with the data rather than with the process, and it is written only by
 * `npm run demo:seed` against a database that contains nothing real. Copying the
 * production env file to the demo host cannot turn production into a demo, and
 * pointing the demo process at the production database cannot either: the
 * production database has no marker, so the demo routes refuse to register and the
 * process says why.
 *
 * The inverse mistake is caught too. A demo database reached by a process WITHOUT
 * the env flag simply behaves as an ordinary admin console over synthetic data,
 * which is harmless.
 */

import type { Queryable } from '../db/pool.js';
import { log } from '../log.js';

/** Settings key holding the marker. Deliberately unglamorous and explicit. */
export const DEMO_MARKER_KEY = 'demo.instance';

/**
 * The exact marker value. A boolean would be too easy to produce by accident from
 * a truthy setting; this string exists nowhere else in the system.
 */
export const DEMO_MARKER_VALUE = 'this-database-contains-only-synthetic-demo-data';

/** Env half of the guard. */
export function demoEnvFlag(): boolean {
  return (process.env['DEMO_INSTANCE'] ?? '').trim().toLowerCase() === 'true';
}

/** Database half of the guard: is THIS database a demo database? */
export async function demoDatabaseMarked(db: Queryable): Promise<boolean> {
  const { rows } = await db.query<{ value: unknown }>(
    'SELECT value FROM settings WHERE key = $1',
    [DEMO_MARKER_KEY],
  );
  const raw = rows[0]?.value;
  // The settings table stores JSON; accept either a bare string or {"value": ...}.
  const asString =
    typeof raw === 'string'
      ? raw
      : typeof (raw as { value?: unknown } | null)?.value === 'string'
        ? ((raw as { value: string }).value)
        : '';
  return asString === DEMO_MARKER_VALUE;
}

/**
 * Whether the demo surface may exist in this process.
 *
 * Both guards, and a loud log line for each disagreement, because the two
 * disagreeing is always a deployment mistake worth seeing rather than a state to
 * pass over quietly.
 */
export async function demoEnabled(db: Queryable): Promise<boolean> {
  const env = demoEnvFlag();
  let marked = false;
  try {
    marked = await demoDatabaseMarked(db);
  } catch (err) {
    log.error(
      `Demo: could not read the demo marker, so the demo surface stays OFF: ` +
        `${err instanceof Error ? err.message : String(err)}`,
    );
    return false;
  }

  if (env && !marked) {
    // The dangerous direction: a process told it is the demo, pointed at a
    // database that is not one. Refuse, loudly. This is the case that would
    // otherwise put a stranger in the real console.
    log.error(
      'Demo: DEMO_INSTANCE is set but this database carries no demo marker. The demo surface is ' +
        'DISABLED. Point it at a demo database seeded with `npm run demo:seed`, and never at ' +
        'production.',
    );
    return false;
  }
  if (!env && marked) {
    log.warn(
      'Demo: this database is marked as a demo database but DEMO_INSTANCE is not set. Running as ' +
        'an ordinary console over synthetic data; the demo surface is off.',
    );
    return false;
  }
  if (env && marked) log.info('Demo: this instance is the public demo (synthetic data only).');
  return env && marked;
}

/**
 * Writes the marker. Called only by the demo seed script.
 *
 * Refuses if the database already holds real-looking content, which is the last
 * line of defence against running the seed against production by mistake.
 */
export async function markDemoDatabase(db: Queryable): Promise<void> {
  const { rows } = await db.query<{ n: string }>('SELECT count(*)::text AS n FROM messages');
  const messages = Number(rows[0]?.n ?? 0);
  if (messages > 0) {
    throw new Error(
      `refusing to mark a database that already holds ${String(messages)} message(s) as a demo ` +
        'database. A demo database must start empty; this looks like a real archive.',
    );
  }
  await db.query(
    `INSERT INTO settings (key, value) VALUES ($1, to_jsonb($2::text))
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
    [DEMO_MARKER_KEY, DEMO_MARKER_VALUE],
  );
  log.info('Demo: database marked as a demo database.');
}
