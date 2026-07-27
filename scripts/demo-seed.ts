/**
 * Marks a database as the demo database (CCB-S4-001 §1).
 *
 *   npm run demo:seed
 *
 * Run this ONCE against the demo instance's own database, never against
 * production. It refuses a database that already holds messages, which is the
 * last line of defence if the wrong DATABASE_URL is in the environment.
 *
 * Without this marker the demo surface stays off even with DEMO_INSTANCE=true,
 * because one forgettable flag is not a guard.
 */

import { closePool, getPool } from '../src/db/pool.js';
import { markDemoDatabase } from '../src/demo/guard.js';

async function main(): Promise<void> {
  await markDemoDatabase(getPool());
  console.log('This database is now marked as a demo database.');
}

main()
  .then(() => closePool())
  .catch((err: unknown) => {
    console.error(err instanceof Error ? err.message : String(err));
    process.exitCode = 1;
    return closePool();
  });
