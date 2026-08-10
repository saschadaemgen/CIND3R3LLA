/**
 * The seeded rule registry, for checks that need the real rules and no database
 * (CCB-S4-039).
 *
 * ── WHY THE CHECKS GO THROUGH POSTGRES FOR THIS ──────────────────────────────
 *
 * Because the migration is the only authored copy of the rule text. A helper that returned a
 * hand-written array of rules would be the second source this briefing exists to remove, and
 * it would be the worst possible second source: one that only the checks read, so the checks
 * would keep passing while production drifted away from them.
 *
 * PGlite is real Postgres in WASM with no server, the repository already runs a dozen
 * harnesses on it, and the whole migration set applies in well under a second. So the checks
 * read what the deployment reads, through the same loader, including the CHECK constraints
 * on lane, tier and condition.
 *
 * Cached per process: several checks in one script would otherwise re-apply thirty-five
 * migrations each time.
 */

import { PGlite } from '@electric-sql/pglite';
import { vector } from '@electric-sql/pglite-pgvector';
import { loadMigrationFiles } from '../src/db/migrate.js';
import { listPromptRules } from '../src/db/prompt-rules.js';
import type { Queryable } from '../src/db/pool.js';
import type { PromptRule } from '../src/interaction/prompt-rules.js';

let cached: Promise<PromptRule[]> | null = null;

async function load(): Promise<PromptRule[]> {
  const pg = new PGlite({ extensions: { vector } });
  try {
    for (const migration of await loadMigrationFiles()) await pg.exec(migration.sql);
    const db: Queryable = {
      async query(sql, values) {
        const result = await pg.query(sql, values ? [...values] : undefined);
        return {
          rows: result.rows as never[],
          rowCount: (result.affectedRows ?? result.rows.length) as number,
        };
      },
    };
    return await listPromptRules(db);
  } finally {
    await pg.close();
  }
}

/** Every rule as `migrations/035_prompt_rules.sql` seeds it. */
export function seededPromptRules(): Promise<PromptRule[]> {
  cached ??= load();
  return cached;
}
