/**
 * Who may take over the existing SimpleX identity (CCB-S5-012, D-165).
 *
 *   npx tsx scripts/verify-adoption.ts
 *
 * ── THE DEFECT ───────────────────────────────────────────────────────────────
 *
 * Adoption means taking over the profile the core already has: its identity, its groups, its
 * members. It is the one operation on this path that cannot be undone from the console.
 *
 * The rule was "the first UNBOUND bot adopts", a bare `adoptionSpent` flag. The comment above
 * it claimed something narrower, "only when it is the primary or there is no primary", and the
 * code never checked that, so the comment described a guarantee that did not exist.
 *
 * Production had exactly the shape that breaks: one bound bot (id 10, `simplex_user_id` 1) and
 * one new one (id 14, NULL). On the next boot the new bot took `adopt: 'activeUser'` and
 * resolved onto the first bot's profile; the CCB-S5-001 duplicate guard then refused the
 * entire boot. Nothing was stranded, which is the guard doing its job, but the runtime would
 * not start and the error named a remedy the console cannot perform.
 *
 * ── THE RULE, AND WHAT IT DELIBERATELY DOES NOT MENTION ─────────────────────
 *
 * Adopt only when NOTHING is bound yet. Once any bot holds a `simplex_user_id`, the active
 * user belongs to somebody and every unbound bot creates its own profile.
 *
 * It does not mention the primary. "Which bot is the special one" is not the question; whether
 * the existing identity is spoken for is, and the data answers that directly. This was the
 * flag's last functional consumer and the correction removed it (D-165).
 *
 * ── THE CASE THAT DECIDES THE SIGNATURE ─────────────────────────────────────
 *
 * Section 3. `listBotsToHost` returns the ENABLED bots, so "is anything bound" asked of that
 * list is the wrong question: an operator who pauses the one bound bot and boots would have an
 * unbound bot adopt the paused one's identity, groups and members. That is why `anyBound` is a
 * parameter computed over the whole table rather than derived from the input.
 */

import { PGlite } from '@electric-sql/pglite';
import { loadMigrationFiles } from '../src/db/migrate.js';
import type { Queryable } from '../src/db/pool.js';
import { anyBotIsBound, toRuntimeSpecs, type HostedBotConfig } from '../src/profiles/hosted-bots.js';
import { setLogLevel } from '../src/log.js';

let failures = 0;
function check(label: string, ok: boolean, detail = ''): void {
  if (!ok) failures++;
  console.log(`  [${ok ? 'PASS' : 'FAIL'}] ${label}${detail ? `: ${detail}` : ''}`);
}
function section(title: string): void {
  console.log(`\n${title}`);
}

function bot(id: number, displayName: string, simplexUserId: number | null): HostedBotConfig {
  return {
    botProfileId: id,
    slug: displayName.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
    displayName,
    simplexUserId,
    avatarPath: null,
  };
}

/** How each spec resolves, as a readable word per bot. */
function shape(specs: ReturnType<typeof toRuntimeSpecs>): string[] {
  return specs.map((s) =>
    'simplexUserId' in s && s.simplexUserId !== undefined
      ? `bound:${String(s.simplexUserId)}`
      : (s as { adopt: string }).adopt,
  );
}

async function main(): Promise<void> {
  setLogLevel('error');

  /* ── 1 ─────────────────────────────────────────────────────────────────── */

  section('1. A fresh deployment: the existing identity is adopted exactly once');

  {
    const specs = toRuntimeSpecs([bot(1, 'CIND3R3LLA', null), bot(2, 'Aurora', null)], false);
    check(
      'the first unbound bot adopts the active user, which is what a pre-existing profile needs',
      shape(specs)[0] === 'activeUser',
      shape(specs).join(', '),
    );
    check('and the second creates its own rather than colliding', shape(specs)[1] === 'create');
    check(
      'exactly one adopts, so two specs can never resolve to one profile',
      shape(specs).filter((s) => s === 'activeUser').length === 1,
    );
  }

  /* ── 2 ─────────────────────────────────────────────────────────────────── */

  section("2. Production's actual shape: one bound bot and one new one");

  {
    // The real rows, as the operator supplied them: id 10 bound to SimpleX user 1, id 14 new.
    const specs = toRuntimeSpecs([bot(10, 'Cinderella', 1), bot(14, 'Rick Sanchez', null)], true);
    check('the bound bot is named by its id, never re-resolved', shape(specs)[0] === 'bound:1');
    check(
      'THE FIX: the new bot CREATES its own profile instead of adopting hers',
      shape(specs)[1] === 'create',
      shape(specs).join(', '),
    );
    check(
      'nothing adopts, because the existing identity is already spoken for',
      !shape(specs).includes('activeUser'),
    );
    // The mutation, run rather than described: the rule as it shipped.
    const asShipped = toRuntimeSpecs([bot(10, 'Cinderella', 1), bot(14, 'Rick Sanchez', null)], false);
    check(
      'MUTATION: the shipped rule made that same bot adopt, which is the failed boot',
      shape(asShipped)[1] === 'activeUser',
      shape(asShipped).join(', '),
    );
  }

  /* ── 3 ─────────────────────────────────────────────────────────────────── */

  section('3. A PAUSED bound bot still owns its identity');

  {
    // `listBotsToHost` returns only enabled bots, so the hosted list here contains just the
    // new one. Asked of that list alone, "is anything bound" is false and the new bot would
    // take over the paused bot's groups and members. Asked of the table, it is true.
    const hosted = [bot(14, 'Rick Sanchez', null)];
    check(
      'asked of the hosted list alone, the answer would be wrong',
      hosted.every((b) => b.simplexUserId === null),
      'which is why the parameter is not derived from the input',
    );
    check(
      'with the table consulted, the enabled unbound bot creates rather than adopting',
      shape(toRuntimeSpecs(hosted, true))[0] === 'create',
    );
    check(
      '  CONTROL: and with genuinely nothing bound anywhere, it still adopts',
      shape(toRuntimeSpecs(hosted, false))[0] === 'activeUser',
    );
  }

  /* ── 4 ─────────────────────────────────────────────────────────────────── */

  section('4. anyBotIsBound reads the whole table, not the enabled set');

  const pg = new PGlite();
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

  check('with no bots at all, nothing is bound', (await anyBotIsBound(db)) === false);

  await db.query(
    `INSERT INTO cinderella_bot_profiles (slug, display_name, enabled)
     VALUES ('unbound-one','Unbound',TRUE)`,
  );
  check('  and a configured but unbound bot does not count', (await anyBotIsBound(db)) === false);

  await db.query(
    `INSERT INTO cinderella_bot_profiles (slug, display_name, enabled, simplex_user_id)
     VALUES ('bound-one','Bound',TRUE,1)`,
  );
  check('a bound bot counts', (await anyBotIsBound(db)) === true);

  // The load-bearing one: pausing the bound bot must not free its identity.
  await db.query(`UPDATE cinderella_bot_profiles SET enabled = FALSE WHERE slug = 'bound-one'`);
  check(
    'and it STILL counts once paused, because pausing a bot does not release its profile',
    (await anyBotIsBound(db)) === true,
  );

  await pg.close();

  console.log(
    failures === 0
      ? '\nAdoption is bounded: the existing identity is taken over only when nothing holds it.'
      : `\n${failures} CHECK(S) FAILED.`,
  );
  if (failures > 0) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
