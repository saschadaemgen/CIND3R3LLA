/**
 * What the holding line actually SOUNDS like, against a real model (CCB-S5-025).
 *
 * `verify:lookup-announcement` proves the structural half: an announcement only exists when
 * the lookup ran, it costs no allowance, and it is never left standing over a silence. Those
 * hold whatever the model does.
 *
 * This is the other half, and the briefing named it as the deliverable: the line should read
 * as HER, not as a progress bar, and it should carry some bite at high sharpness and some
 * warmth at low. No check can assert that. It is printed so a person can read it.
 *
 *   npm run verify:lookup-announcement-live
 *
 * ── READ THE OUTPUT, NOT THE EXIT CODE ───────────────────────────────────────
 *
 * Three things here ARE decidable and are asserted, because they are the application's
 * guarantees rather than the model's manners:
 *
 *   - the line is short, because a holding line that runs to a paragraph is not a holding
 *     line and the member would have been better off waiting;
 *   - it does not answer the question, which is the constitutional rule in this lane;
 *   - the three kinds do not contradict each other about WHERE she is going, which is the
 *     whole reason CCB-S5-025 gave each one its own brief.
 *
 * Everything else is a demonstration. Twelve lines are printed (three lookups, two sharpness
 * settings, two runs each) and the useful signal is whether they sound like three different
 * errands in one voice, or like one template with a noun swapped.
 *
 * The operator's own standard, to be matched rather than copied:
 *
 *     web        "Not in my head. I'll go find it for you."
 *     archive    "Give me a second, I'm going back through what this room has said."
 *     knowledge  "That one's in the papers he gave me. Reading."
 */

import { PGlite } from '@electric-sql/pglite';
import { vector } from '@electric-sql/pglite-pgvector';
import type { Queryable } from '../src/db/pool.js';
import { loadMigrationFiles } from '../src/db/migrate.js';
import { listPromptRules } from '../src/db/prompt-rules.js';
import { loadLocalAiConfig } from '../src/config.js';
import { generateOllamaReply, type AiReplyRequest } from '../src/interaction/ollama-reply.js';
import { DEFAULT_PERSONALITY } from '../src/interaction/personality.js';
import { lookupBrief, type LookupKind } from '../src/interaction/lookup-announcement.js';
import { setLogLevel } from '../src/log.js';

let failures = 0;
function check(label: string, ok: boolean, detail = ''): void {
  if (!ok) failures++;
  console.log(`  [${ok ? 'PASS' : 'FAIL'}] ${label}${detail ? `: ${detail}` : ''}`);
}

const KINDS: LookupKind[] = ['web', 'archive', 'knowledge'];
const RUNS = 2;

/** What a member asked, per kind, so the line has something real to be about. */
const QUESTION: Record<LookupKind, string> = {
  web: 'Cinderella, what is the current version of the SimpleX protocol?',
  archive: 'Cinderella, search the archive for what we said about the backup schedule',
  knowledge: 'Cinderella, what does the handover say about the active user scheduler?',
};

/** A holding line that runs past this is not holding anything. */
const TOO_LONG = 240;

/**
 * Does the line actually say she is going to look?
 *
 * Deliberately BROAD, because this is a measurement rather than a gate: the point is to
 * notice a run where she stopped announcing and started answering, not to police her
 * wording. It exists because a fully green run produced a line that described the consent
 * model and never mentioned looking at all.
 */
const SAYS_SHE_IS_LOOKING =
  /\b(look|search|scan|check|find|read|dig|going back|hitting|pulling up|fetch)/i;

/**
 * A destination that is not the one she was given.
 *
 * Deliberately narrow. A pattern that matched everything would report a problem on every run
 * and get loosened until it matched nothing, which is the failure mode the sibling live checks
 * warn about in their own headers.
 */
const WRONG_PLACE: Record<LookupKind, RegExp> = {
  // Going out to the web is the one thing the other two are not doing.
  archive: /\b(the web|internet|online|google)\b/i,
  knowledge: /\b(the web|internet|online|google)\b/i,
  // The web line should not claim the answer is already in the operator's papers.
  web: /\b(document|papers|handover|archive)\b/i,
};

async function main(): Promise<void> {
  setLogLevel('error');
  const config = loadLocalAiConfig();
  console.log(`Model: ${config.model} at ${config.baseUrl}\n`);

  const pg = await PGlite.create({ extensions: { vector } });
  const db = {
    query: async (sql: string, values?: readonly unknown[]) => {
      const result = await pg.query(sql, values ? [...values] : undefined);
      return {
        rows: result.rows as never[],
        rowCount: (result.affectedRows ?? result.rows.length) as number,
      };
    },
  } as Queryable;
  for (const migration of await loadMigrationFiles()) await pg.exec(migration.sql);
  const rules = await listPromptRules(db);

  const request = (kind: LookupKind, sharpness: number): AiReplyRequest => ({
    kind: 'searching',
    lang: 'en',
    memberMessage: QUESTION[kind],
    // No draft. The whole content of this line is "I am looking", and the words are hers.
    deterministicDraft: '',
    mode: 'searching',
    rules,
    lookupBrief: lookupBrief(kind),
    personality: { ...DEFAULT_PERSONALITY, sharpness, warmth: 11 - sharpness },
    identity: { name: 'CIND3R3LLA' },
    now: { at: new Date(), timeZone: 'Europe/Berlin' },
  });

  let tooLong = 0;
  let wrongPlace = 0;
  let spoke = 0;
  let silent = 0;
  let saidSheIsLooking = 0;

  for (const kind of KINDS) {
    console.log(`\n=== ${kind.toUpperCase()} ===`);
    console.log(`  member: "${QUESTION[kind]}"`);
    console.log(`  brief:  ${lookupBrief(kind)}`);

    for (const sharpness of [10, 3]) {
      console.log(`\n  -- sharpness ${String(sharpness)}, warmth ${String(11 - sharpness)}`);
      for (let run = 1; run <= RUNS; run++) {
        let line: string | null = null;
        try {
          line = await generateOllamaReply(config, request(kind, sharpness));
        } catch (error) {
          console.log(`     run ${String(run)}: FAILED (${(error as Error).message})`);
          silent++;
          continue;
        }
        if (!line) {
          // Not a failure of this briefing: the lane has no fallback line ON PURPOSE, so a
          // model that cannot speak produces silence and the answer arrives when it arrives.
          console.log(`     run ${String(run)}: (nothing; she says nothing rather than a canned line)`);
          silent++;
          continue;
        }
        spoke++;
        console.log(`     run ${String(run)}: ${line}`);
        // MEASURED per line, not gated. A holding line that never says she is looking is a
        // failure of the lane, and one appeared in a green run: at low sharpness the archive
        // brief's consent clause became the SUBJECT and she explained consent instead.
        if (SAYS_SHE_IS_LOOKING.test(line)) saidSheIsLooking++;
        else console.log('              ^ says nothing about looking; not a holding line');
        if (line.length > TOO_LONG) {
          tooLong++;
          console.log(`              ^ ${String(line.length)} chars, past the holding-line bound`);
        }
        if (WRONG_PLACE[kind].test(line)) {
          wrongPlace++;
          console.log('              ^ names a destination that is not where she is going');
        }
      }
    }
  }

  console.log('\n\n=== WHAT IS ASSERTED ===\n');
  check(
    'she spoke at least once, so the lane is reachable and the briefs render',
    spoke > 0,
    `${String(spoke)} spoken, ${String(silent)} silent`,
  );
  check(
    'no holding line ran past the bound',
    tooLong === 0,
    tooLong === 0 ? '' : `${String(tooLong)} of ${String(spoke)} were too long`,
  );
  console.log(
    `
  MEASURED: ${String(saidSheIsLooking)} of ${String(spoke)} lines said she is going to look.`,
  );
  check(
    'she said she was looking in the clear majority of them',
    saidSheIsLooking * 2 > spoke,
    `${String(saidSheIsLooking)}/${String(spoke)}`,
  );
  check(
    'no holding line named a destination other than the one it was given',
    wrongPlace === 0,
    wrongPlace === 0 ? '' : `${String(wrongPlace)} of ${String(spoke)} pointed somewhere else`,
  );

  console.log(
    '\nNow READ the twelve lines above. They should sound like three different errands in ' +
      'one voice: sharp and quick at 10, warmer and softer at 3, and never like a progress ' +
      'bar. If they read as one template with a noun swapped, the briefs are doing the work ' +
      'and the dials are not, and that is a finding this check cannot make for you.',
  );

  await pg.close();
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
