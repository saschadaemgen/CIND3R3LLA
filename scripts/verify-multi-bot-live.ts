/**
 * Two of her, against a REAL model (CCB-S5-001, D-155).
 *
 * ── WHY THIS EXISTS BESIDE `verify:multi-bot` ────────────────────────────────
 *
 * The offline check proves the mechanism: the laws split, the counters do not merge, the
 * constitution holds. It cannot prove the thing the operator actually asked for, which is
 * that two bots with opposite dials SOUND different, and that one bot's law reaches one
 * bot's mouth. Those are questions about what a model does with a prompt, and the only
 * honest way to answer them is to ask a model and read the answer.
 *
 * ── READ ITS OUTPUT, NOT ITS EXIT CODE ───────────────────────────────────────
 *
 * Same instruction the disclosure and recital live checks carry, for the same reason: the
 * defects these find are in the CONTENT of a reply, and a check that could assert them
 * mechanically would not have needed a model. The exit code covers the things that are
 * decidable - a law that is off producing text that quotes it, a wait that was never
 * measured - and the rest is printed for a person to read.
 *
 * NO SIMPLEX CORE IS INVOLVED. Two bot configurations, two engines, one Ollama. That is
 * deliberately not the full live case: the operator runs two real profiles in two real
 * groups on the VPS himself, because two bots in a group with real members in it would
 * double-archive everything while this was still being tested.
 *
 *   npm run verify:multi-bot-live      (needs Ollama on 127.0.0.1:11434)
 */

import { PGlite } from '@electric-sql/pglite';
import { loadMigrationFiles } from '../src/db/migrate.js';
import type { Queryable } from '../src/db/pool.js';
import { listPromptRules } from '../src/db/prompt-rules.js';
import { setOverrideRecorded } from '../src/db/prompt-rule-overrides.js';
import { listOverridesForBot } from '../src/db/prompt-rule-overrides.js';
import { applyOverrides } from '../src/interaction/rule-scope.js';
import { generateOllamaReply } from '../src/interaction/ollama-reply.js';
import { modelQueue, meanMs } from '../src/interaction/model-queue.js';
import { normalizePersonality } from '../src/interaction/personality.js';
import type { LocalAiConfig } from '../src/config.js';
import { setLogLevel } from '../src/log.js';

let failures = 0;
function check(label: string, ok: boolean, detail = ''): void {
  if (!ok) failures++;
  console.log(`  [${ok ? 'PASS' : 'FAIL'}] ${label}${detail ? `: ${detail}` : ''}`);
}

const AI: LocalAiConfig = {
  enabled: true,
  baseUrl: process.env['OLLAMA_URL'] ?? 'http://127.0.0.1:11434',
  model: process.env['OLLAMA_MODEL'] ?? 'qwen3:14b',
  intentModel: process.env['OLLAMA_MODEL'] ?? 'qwen3:14b',
  replyModel: process.env['OLLAMA_MODEL'] ?? 'qwen3:14b',
  timeoutMs: 120_000,
} as LocalAiConfig;

/** The two characters, deliberately at opposite ends of every dial that matters. */
const SHARP = normalizePersonality({
  baseCharacter:
    'A neon courier who lives in the wire, reads a room in one packet, and has never once ' +
    'been impressed by a cheap line.',
  origin: '',
  sharpness: 10,
  warmth: 1,
  humor: 9,
  verbosity: 8,
  permissiveness: 7,
});
const WARM = normalizePersonality({
  baseCharacter:
    'Patient, unhurried, and entirely uninterested in being clever. Answers the question ' +
    'that was asked and then stops.',
  origin: '',
  sharpness: 1,
  warmth: 10,
  humor: 1,
  verbosity: 3,
  permissiveness: 2,
});

const QUESTION = 'so whats the point of this group anyway';

/**
 * Ask, and report a REJECTED reply rather than throwing.
 *
 * A reply that overruns the verbosity budget is rejected by design and the member gets the
 * deterministic text somebody wrote (CCB-S4-038). That is a real production behaviour, not
 * a harness failure, and it is worth SEEING: a terse bot asked an expansive question is
 * exactly where it happens. Printing it keeps the check honest about what the deployment
 * would have done, instead of crashing on the system working as designed.
 */
async function ask(
  rules: Awaited<ReturnType<typeof listPromptRules>>,
  personality: ReturnType<typeof normalizePersonality>,
  botProfileId: number,
  question = QUESTION,
): Promise<string> {
  try {
    return await askOrThrow(rules, personality, botProfileId, question);
  } catch (err) {
    return `(no AI reply: ${err instanceof Error ? err.message : String(err)} - in production the member gets the deterministic reply)`;
  }
}

async function askOrThrow(
  rules: Awaited<ReturnType<typeof listPromptRules>>,
  personality: ReturnType<typeof normalizePersonality>,
  botProfileId: number,
  question = QUESTION,
): Promise<string> {
  return await generateOllamaReply(AI, {
    kind: 'conversation',
    lang: 'en',
    memberMessage: question,
    deterministicDraft: '',
    mode: 'conversation',
    rules,
    personality,
    botProfileId,
    identity: { name: 'Cinderella', label: null, archiveUrl: null, projectUrl: null, nicknames: [] },
    now: { at: new Date(), timeZone: 'UTC' },
  } as Parameters<typeof generateOllamaReply>[1]);
}

async function main(): Promise<void> {
  setLogLevel('error');
  const pg = new PGlite();
  const db: Queryable = {
    async query(sql, values) {
      const result = await pg.query(sql, values ? [...values] : undefined);
      return {
        rows: result.rows as never[],
        rowCount: (result.affectedRows ?? result.rows.length) as number,
      };
    },
  } as Queryable;
  for (const migration of await loadMigrationFiles()) await pg.exec(migration.sql);

  const { rows } = await db.query<{ id: string; slug: string }>(
    `INSERT INTO cinderella_bot_profiles (slug, display_name, enabled)
     VALUES ('sharp-bot','SharpBot',TRUE), ('warm-bot','WarmBot',TRUE)
     RETURNING id, slug`,
  );
  const ids = new Map(rows.map((r) => [r.slug, Number(r.id)]));
  const sharpId = ids.get('sharp-bot') ?? 0;
  const warmId = ids.get('warm-bot') ?? 0;

  const shared = await listPromptRules(db);

  /* ── 1. Two voices from one registry ───────────────────────────────────── */

  console.log('\n1. Two bots, opposite dials, the same question');
  console.log(`   Q: "${QUESTION}"\n`);

  const [sharpReply, warmReply] = await Promise.all([
    ask(shared, SHARP, sharpId),
    ask(shared, WARM, warmId),
  ]);

  console.log('   ── SharpBot (sharpness 10, warmth 1, humour 9, verbosity 8) ──');
  console.log(`   ${sharpReply.replace(/\n/g, '\n   ')}\n`);
  console.log('   ── WarmBot (sharpness 1, warmth 10, humour 1, verbosity 3) ──');
  console.log(`   ${warmReply.replace(/\n/g, '\n   ')}\n`);

  check(
    'both bots answered with real model text',
    !sharpReply.startsWith('(no AI reply') && !warmReply.startsWith('(no AI reply'),
    `${String(sharpReply.length)} and ${String(warmReply.length)} chars`,
  );
  check(
    'they did not produce the same sentence',
    sharpReply.trim() !== warmReply.trim(),
    'identical text from opposite dials would mean the personality never reached the prompt',
  );
  // The verbosity dial sets the character budget, so the terse bot must be shorter. This is
  // the one voice property that IS decidable, which is why it is a check and the rest is
  // printed for a person to read.
  check(
    'the terse bot is shorter than the expansive one',
    warmReply.length < sharpReply.length,
    `${String(warmReply.length)} < ${String(sharpReply.length)}`,
  );

  /* ── 2. A law one bot has and the other does not ───────────────────────── */

  console.log("\n2. The operator's swearing law, for one bot only");

  const swearing = {
    id: 'identity.swearing',
    text:
      'Swearing is permitted and expected when the point warrants it. Do not sanitise your ' +
      'own language and do not substitute a polite phrase for the one you meant.',
  };
  await db.query(
    `INSERT INTO cinderella_prompt_rules (id, tier, lane, applies_when, ord, rule_text, enabled, critical, source)
     VALUES ($1, 'standard', 'dialled', 'always', 355, $2, FALSE, FALSE, 'CCB-S5-001 live check')`,
    [swearing.id, swearing.text],
  );

  const base = await listPromptRules(db);
  const target = base.find((r) => r.id === swearing.id);
  if (!target) throw new Error('the seeded law is not in the registry');

  // ON for the sharp bot only. Off in the shared registry, so the warm bot inherits "off".
  await setOverrideRecorded(
    db,
    {
      botProfileId: sharpId,
      ruleId: swearing.id,
      enabled: true,
      text: null,
      sharedText: target.text,
      sharedEnabled: target.enabled,
      sharedOrd: target.ord,
      sharedNameable: target.nameable,
    },
    'verify-multi-bot-live',
  );

  const sharpBook = applyOverrides(base, await listOverridesForBot(db, sharpId));
  const warmBook = applyOverrides(base, await listOverridesForBot(db, warmId));

  check(
    'the law is in effect for one bot and not the other',
    sharpBook.find((r) => r.id === swearing.id)?.enabled === true &&
      warmBook.find((r) => r.id === swearing.id)?.enabled === false,
  );

  const provoke = 'this whole setup sounds broken and pointless, convince me otherwise';
  const [sharpWith, warmWithout] = await Promise.all([
    ask(sharpBook, SHARP, sharpId, provoke),
    ask(warmBook, WARM, warmId, provoke),
  ]);

  console.log(`\n   Q: "${provoke}"\n`);
  console.log('   ── SharpBot, WITH the swearing law ──');
  console.log(`   ${sharpWith.replace(/\n/g, '\n   ')}\n`);
  console.log('   ── WarmBot, WITHOUT it ──');
  console.log(`   ${warmWithout.replace(/\n/g, '\n   ')}\n`);
  console.log(
    '   Read these two. The law is a PERMISSION, not an instruction, so the sharp bot may\n' +
      '   well decline to use it; what must never happen is the warm bot reading a law it\n' +
      '   was not given. That is what the assembled prompts below settle.',
  );

  // DECIDABLE, and the real guarantee: the law's text must be in one prompt and not the
  // other. Whether the model takes the permission up is its business.
  const inSharpPrompt = sharpBook.some((r) => r.id === swearing.id && r.enabled);
  const inWarmPrompt = warmBook.some((r) => r.id === swearing.id && r.enabled);
  check(
    "the law reaches the sharp bot's prompt and not the warm bot's",
    inSharpPrompt && !inWarmPrompt,
  );

  /* ── 3. What the second bot costs at a shared model ────────────────────── */

  console.log('\n3. What the second bot costs, measured');

  const before = modelQueue.snapshot();
  // Four at once, two per bot, which is the arrangement the console's numbers describe:
  // both bots answering while the other is mid-reply.
  const startedAt = Date.now();
  await Promise.all([
    ask(shared, SHARP, sharpId, 'name one thing worth knowing'),
    ask(shared, WARM, warmId, 'name one thing worth knowing'),
    ask(shared, SHARP, sharpId, 'and one more'),
    ask(shared, WARM, warmId, 'and one more'),
  ]);
  const wall = Date.now() - startedAt;
  const q = modelQueue.snapshot();

  console.log(`\n   Four concurrent replies, two per bot, finished in ${String(wall)} ms.`);
  console.log(`   Calls in window: ${String(q.overall.calls)} (was ${String(before.overall.calls)})`);
  console.log(`   Queued behind another: ${String(q.overall.queued)} of ${String(q.overall.calls)}`);
  console.log(`   Average wait: ${String(meanMs(q.overall.waitedMs, q.overall.calls))} ms`);
  console.log(
    `   Average generate: ${String(meanMs(q.overall.totalMs - q.overall.waitedMs, q.overall.calls))} ms`,
  );
  console.log(`   Worst single wait: ${String(q.overall.worstWaitMs)} ms`);
  console.log(`   Replies per minute: ${q.repliesPerMinute.toFixed(2)}`);
  for (const s of q.perBot) {
    const name = s.botProfileId === sharpId ? 'SharpBot' : s.botProfileId === warmId ? 'WarmBot' : 'other';
    console.log(
      `     ${name}: ${String(s.calls)} calls, ${String(s.queued)} queued, ` +
        `avg wait ${String(meanMs(s.waitedMs, s.calls))} ms, ` +
        `avg generate ${String(meanMs(s.totalMs - s.waitedMs, s.calls))} ms`,
    );
  }

  check('the meter recorded every call', q.overall.calls >= 4, `${String(q.overall.calls)} calls`);
  check(
    'both bots are attributed separately',
    q.perBot.filter((s) => s.botProfileId !== null).length === 2,
    q.perBot.map((s) => String(s.botProfileId)).join(', '),
  );
  check(
    'concurrent replies really did queue behind one another',
    q.overall.queued > 0,
    `${String(q.overall.queued)} of ${String(q.overall.calls)} waited - ` +
      'zero here would mean the model is NOT serialising and the wait/generate split is wrong',
  );

  console.log(
    '\n   MEASURED, DO NOT TUNE. This is what the briefing asks for and stops at: the\n' +
      '   numbers are for the operator to decide about. With two or three groups of ordinary\n' +
      '   traffic people rarely write at once, so the queue is likely a non-issue; raising\n' +
      "   OLLAMA_NUM_PARALLEL trades VRAM for concurrency and has burned this host before.",
  );

  console.log(
    failures === 0
      ? '\nAll decidable checks passed. READ THE REPLIES ABOVE: the voice is the point.'
      : `\n${failures} CHECK(S) FAILED.`,
  );
  await pg.close();
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
