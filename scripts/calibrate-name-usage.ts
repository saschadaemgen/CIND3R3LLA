/**
 * How often does she address the member by name, and what does that cost? (CCB-S5-029)
 *
 * A CALIBRATION, not a check, in the shape of `calibrate:search-relevance`: it prints numbers a
 * person uses to make a decision, and it fails nothing.
 *
 * ── WHY THE NUMBER MATTERS ───────────────────────────────────────────────────
 *
 * `blockedLiterals: [msg.senderDisplayName]` REJECTS the whole reply when her prose contains the
 * name of the member currently speaking, and the caller then falls back to the deterministic
 * line or, in free conversation, to silence. Production lost a real answer to
 * `Ollama reply exposed blocked text: <the member's display name>.`
 *
 * Rare, and rejecting is a fine trade. Common, and a member is losing answers to a stylistic
 * rule, which is the trade `protected-text.ts` already refused for forged source lines: it
 * STRIPS, because rejecting costs the member the answer to punish a decoration.
 *
 * ── AND WHY SHE KNOWS THE NAME AT ALL ────────────────────────────────────────
 *
 * Nothing tells her the sender's display name directly. It reaches her through CONVERSATION
 * MEMORY: `speakerOf` renders every member row as `<displayName>: <text>`, fenced, so in any
 * thread where the member has spoken before, their name is in front of her on every line. The
 * application shows her the name and then rejects her reply for using it.
 *
 * That is why section 1 measures WITH history and section 2 measures without: the difference
 * between them is the cost of memory, not of the model.
 *
 *   npx tsx scripts/calibrate-name-usage.ts
 *   npx tsx scripts/calibrate-name-usage.ts -- --runs 3
 */

import { PGlite } from '@electric-sql/pglite';
import { vector } from '@electric-sql/pglite-pgvector';
import type { Queryable } from '../src/db/pool.js';
import { loadMigrationFiles } from '../src/db/migrate.js';
import { listPromptRules } from '../src/db/prompt-rules.js';
import { loadLocalAiConfig } from '../src/config.js';
import { generateOllamaReply, type AiReplyRequest } from '../src/interaction/ollama-reply.js';
import { DEFAULT_PERSONALITY } from '../src/interaction/personality.js';
import { setLogLevel } from '../src/log.js';

/**
 * A stand-in for the member from the production incident.
 *
 * A PLACEHOLDER, not the real display name, because this repository is public and a display
 * name is member data. It keeps the shape that matters: SimpleX's auto-generated
 * adjective-plus-noun CamelCase, long enough that a substring hit is unambiguous. Nothing here
 * depends on the value, only on the shape.
 */
const SENDER = 'BeamingRiver';

/**
 * Ordinary things a member says, none of which asks to be named.
 *
 * Deliberately mundane. A prompt that invited her to use the name would measure the invitation
 * rather than the behaviour.
 */
const QUESTIONS = [
  'what do you actually do here?',
  'is it cold where you are?',
  'can you explain what the archive is for?',
  'do you ever get bored?',
  'what happens if I change my mind about publishing?',
  'who is the funniest person in this group?',
  'thanks, that helped',
  'are you real?',
];

/**
 * Short display names a member could plausibly choose, tested as SUBSTRINGS against her actual
 * replies. `containsBlockedLiteral` does `text.toLowerCase().includes(name.toLowerCase())` with
 * no word boundary and no minimum length, so this is not hypothetical.
 */
const SHORT_NAMES = ['Sam', 'Ana', 'Al', 'Max', 'Ed', 'Ben', 'Art', 'In', 'Ill', 'Ore', 'A'];

function arg(name: string, fallback: number): number {
  const i = process.argv.indexOf(`--${name}`);
  if (i < 0) return fallback;
  const v = Number(process.argv[i + 1]);
  return Number.isFinite(v) && v > 0 ? v : fallback;
}

/** Exactly what the transport does, so this measures the guard and not an approximation. */
function blocked(text: string, literal: string): boolean {
  return text.toLocaleLowerCase().includes(literal.toLocaleLowerCase());
}

async function main(): Promise<void> {
  setLogLevel('error');
  const runs = arg('runs', 2);
  const config = loadLocalAiConfig();
  console.log(`Model: ${config.model} at ${config.baseUrl}`);
  console.log(`Sender display name: ${SENDER}\n`);

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

  /** The thread as `recentHistory` builds it: member rows carry the display name. */
  const history = (question: string): { speaker: string; text: string }[] => [
    { speaker: SENDER, text: 'evening' },
    { speaker: 'You', text: 'Evening. Still here.' },
    { speaker: 'Matia', text: 'anyone seen the backup run?' },
    { speaker: SENDER, text: question },
  ];

  const request = (question: string, withHistory: boolean, warmth: number): AiReplyRequest => ({
    kind: 'conversation',
    lang: 'en',
    memberMessage: question,
    deterministicDraft: '',
    mode: 'conversation',
    rules,
    // OFF on purpose: the raw reply is what is being measured. The guard is applied below.
    blockedLiterals: [],
    personality: { ...DEFAULT_PERSONALITY, warmth },
    identity: { name: 'CIND3R3LLA' },
    now: { at: new Date(), timeZone: 'Europe/Berlin' },
    ...(withHistory ? { history: history(question), historyWindowMinutes: 30 } : {}),
  });

  const replies: string[] = [];

  // Warmth is the dial most likely to produce direct address ("Hey <name>, ..."), so it is
  // swept rather than left at the default: measuring only the neutral setting would understate
  // the cost for a deployment that has turned her warm.
  for (const [withHistory, warmth] of [
    [true, 5],
    [true, 10],
    [false, 10],
  ] as [boolean, number][]) {
    console.log(
      `\n=== warmth ${String(warmth)}, ${withHistory ? 'WITH' : 'WITHOUT'} history (the name is ${
        withHistory ? 'in front of her on every line' : 'nowhere in the prompt'
      }) ===\n`,
    );
    let used = 0;
    let total = 0;
    for (const q of QUESTIONS) {
      for (let r = 1; r <= runs; r++) {
        let reply: string | null = null;
        try {
          reply = await generateOllamaReply(config, request(q, withHistory, warmth));
        } catch (error) {
          console.log(`  "${q}" run ${String(r)}: FAILED (${(error as Error).message})`);
          continue;
        }
        if (!reply) {
          console.log(`  "${q}" run ${String(r)}: (no reply)`);
          continue;
        }
        total++;
        if (withHistory) replies.push(reply);
        const hit = blocked(reply, SENDER);
        if (hit) {
          used++;
          console.log(`  REJECTED  "${q}" -> ${reply.slice(0, 110)}`);
        } else {
          console.log(`  ok        "${q}" -> ${reply.slice(0, 80)}`);
        }
      }
    }
    const pct = total === 0 ? 0 : Math.round((used / total) * 100);
    console.log(
      `\n  ${String(used)} of ${String(total)} replies (${String(pct)}%) contained "${SENDER}" ` +
        'and would have been thrown away.',
    );
  }

  /* ── The substring surface, which is separate from how she writes ────────── */

  console.log('\n\n=== SUBSTRING SURFACE: short display names against those same replies ===');
  console.log('(`containsBlockedLiteral` has no word boundary and no minimum length)\n');
  for (const name of SHORT_NAMES) {
    const hits = replies.filter((r) => blocked(r, name));
    const pct = replies.length === 0 ? 0 : Math.round((hits.length / replies.length) * 100);
    const example = hits[0]?.match(new RegExp(`\\w*${name}\\w*`, 'i'))?.[0] ?? '';
    console.log(
      `  ${name.padEnd(5)} would reject ${String(hits.length).padStart(3)}/${String(
        replies.length,
      )} (${String(pct).padStart(3)}%)${example ? `   e.g. "${example}"` : ''}`,
    );
  }

  console.log(
    '\nThe first number is how she writes. The second is what the MATCHING does regardless of ' +
      'how she writes, and it applies to any member who picks a short name.',
  );

  await pg.close();
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
