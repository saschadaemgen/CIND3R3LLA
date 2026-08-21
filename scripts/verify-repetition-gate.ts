/**
 * The repetition gate: she does not send the same reply twice (CCB-S5-060 stage 2, D-253).
 *
 * ── WHAT THE BRIEFING ASKED FOR BY NAME ──────────────────────────────────────
 *
 * "Prove the repetition gate by reproducing the five-of-five case and showing it does not
 * send." Section 2 drives the REAL engine with a model that returns the exact 187-byte
 * production reply on every call, and shows the first send succeeding, every duplicate
 * refused, the resamples counted, and the deterministic line going out instead.
 *
 * ── EVERY NEGATIVE HAS ITS POSITIVE ──────────────────────────────────────────
 *
 * "The duplicate was not sent" passes trivially against an engine that sends nothing. So
 * the first occurrence is proven to SEND, the resample path is proven to RECOVER when the
 * model lands elsewhere, and the application templates are proven to repeat freely -
 * because the stage-0 measurement found seven consent confirmations among what a naive
 * gate would have refused, and a silently unconfirmed publication is the one failure this
 * product cannot have (CCB-S3-023).
 *
 *   npx tsx scripts/verify-repetition-gate.ts
 */

import { PGlite } from '@electric-sql/pglite';
import { vector } from '@electric-sql/pglite-pgvector';
import type { Queryable } from '../src/db/pool.js';
import { loadMigrationFiles } from '../src/db/migrate.js';
import { InteractionEngine } from '../src/interaction/engine.js';
import { DEFAULT_INTERACTION, normalizeInteraction } from '../src/interaction/settings.js';
import { DEFAULT_PERSONALITY } from '../src/interaction/personality.js';
import { CORE_INTENTS } from '../src/interaction/intent.js';
import {
  REPETITION_MIN_CHARS,
  REPETITION_RESAMPLES,
  REPETITION_THRESHOLD,
  isNearDuplicate,
  jaccard,
  shingles,
} from '../src/interaction/repetition.js';
import { clearConversations, recentConversations } from '../src/interaction/conversation-log.js';
import { listPromptRules } from '../src/db/prompt-rules.js';
import type { CapturedMessage } from '../src/capture/message.js';
import { setLogLevel } from '../src/log.js';

let failures = 0;
function check(label: string, ok: boolean, detail = ''): void {
  if (!ok) failures++;
  console.log(`  [${ok ? 'PASS' : 'FAIL'}] ${label}${detail ? `: ${detail}` : ''}`);
}

/** The 187 bytes production sent three times, byte-identical. The known trigger. */
const THE_486 =
  "You think I'm broken? Try 'I don't understand that' again. I'm not a 486. I'm a neon " +
  "courier who's been up all night more times than your motherboard has capacitors.";

const GROUP = 1;

function message(text: string, itemId: number, member = 'alice-member-id'): CapturedMessage {
  return {
    groupId: GROUP,
    groupName: 'archive',
    itemId,
    sharedMsgId: undefined,
    senderMemberId: member,
    senderDisplayName: 'Alice',
    sentAt: new Date().toISOString(),
    type: 'text',
    text,
    linkPreview: undefined,
    file: undefined,
    forwarded: false,
    quotedFromBot: false,
    raw: {} as never,
  } as CapturedMessage;
}

async function main(): Promise<void> {
  setLogLevel('error');

  /* ── 1. The pure gate, against the production case ───────────────────────── */

  console.log('\n1. The measure, the threshold and the floor');

  check(
    'the 486 case scores 1.0 against itself, as it did in the archive',
    jaccard(shingles(THE_486), shingles(THE_486)) === 1,
  );
  check('and is caught as a near-duplicate', isNearDuplicate(THE_486, [THE_486]));
  check(
    'small drift does not rescue it: one apostrophe restyled, an emoji appended',
    isNearDuplicate(THE_486.replace("'I don't", '"I don’t'), [THE_486]) &&
      isNearDuplicate(THE_486 + ' 🔥', [THE_486]),
  );
  // A STATED BOUNDARY, not a gap being hidden: restyling EVERY quote in the reply breaks
  // enough 5-gram shingles to land under the measured 0.8, so a whole-string punctuation
  // rewrite would ship. The measured production repeats scored 1.0000 - the model copies
  // bytes, not styles - and the threshold was calibrated on the archive WITH punctuation,
  // so loosening the normalisation to catch this hypothetical would invalidate the
  // false-positive rates the scoping decision rests on.
  check(
    'the boundary is where the measurement put it: a full quote-restyle lands below 0.8',
    !isNearDuplicate(THE_486.replace(/'/g, '’’'), [THE_486]),
    jaccard(shingles(THE_486.replace(/'/g, '’’')), shingles(THE_486)).toFixed(3),
  );
  check(
    'a genuinely different reply passes',
    !isNearDuplicate('Mesh networks are spiderwebs with opinions. Ask me a harder one.', [THE_486]),
  );
  check(
    `a reply under ${String(REPETITION_MIN_CHARS)} chars is exempt, the measured short-line class`,
    !isNearDuplicate('Looking it up now.', ['Looking it up now.']),
  );
  check(
    '  and a SHORT prior is no witness against a long reply either',
    !isNearDuplicate(THE_486, ['Looking it up now.']),
  );
  check(
    'the threshold is the measured operating point, not a guess',
    REPETITION_THRESHOLD === 0.8 && REPETITION_MIN_CHARS === 40,
  );

  /* ── 2. The engine: the five-of-five case does not send ──────────────────── */

  console.log('\n2. The engine, driven with a model that always lands on the same ground');

  const pg = new PGlite({ extensions: { vector } });
  const db: Queryable = {
    async query(sql, values) {
      const r = await pg.query(sql, values ? [...values] : undefined);
      return { rows: r.rows as never[], rowCount: (r.affectedRows ?? r.rows.length) as number };
    },
  } as Queryable;
  for (const m of await loadMigrationFiles()) await pg.exec(m.sql);
  const rules = await listPromptRules(db);

  const sent: string[] = [];
  let modelCalls = 0;
  /** What the fake model returns per call; a function so scenarios can vary it. */
  let modelReply: () => string | null = () => THE_486;

  const engine = new InteractionEngine({
    capabilities: () => [...CORE_INTENTS],
    db,
    settings: () => normalizeInteraction({ ...DEFAULT_INTERACTION }),
    rules: () => rules,
    personality: () => ({ ...DEFAULT_PERSONALITY }),
    personalize: (req) => {
      if (req.mode !== 'conversation') return Promise.resolve(null);
      modelCalls += 1;
      return Promise.resolve(modelReply());
    },
    send: (_msg, text) => {
      sent.push(text);
      return Promise.resolve();
    },
  } as never);

  clearConversations();

  // TURN ONE: the first occurrence is a normal reply and must SEND. Without this positive
  // control, every assertion below passes against an engine that answers nothing.
  await engine.handle(message('Cinderella you sound like an old text adventure', 10));
  check('the first occurrence sends', sent.some((t) => t.includes('not a 486')), String(sent.length));
  const afterFirst = sent.length;
  const callsAfterFirst = modelCalls;

  // TURN TWO: a DIFFERENT member message, the model lands on the same ground every time.
  await engine.handle(message("Cinderella I don't understand that", 11));
  const produced = sent.slice(afterFirst);
  check(
    'THE FIVE-OF-FIVE CASE: the duplicate is not sent',
    !produced.some((t) => t.includes('not a 486')),
    produced.join(' | ').slice(0, 90),
  );
  check(
    `it resampled ${String(REPETITION_RESAMPLES)} times before giving way`,
    modelCalls - callsAfterFirst === 1 + REPETITION_RESAMPLES,
    `${String(modelCalls - callsAfterFirst)} calls`,
  );
  check(
    'and the member gets the deterministic line rather than silence',
    produced.length === 1 && produced[0] !== undefined && produced[0].length > 0,
    produced[0]?.slice(0, 60) ?? '(nothing)',
  );
  check(
    "the give-up is counted as its own outcome, not as the model failing",
    recentConversations(5).some((c) => c.outcome === 'repeated'),
    recentConversations(3)
      .map((c) => c.outcome)
      .join(','),
  );

  // TURN THREE: the model recovers on the resample. The gate must take the variant, which
  // is the whole point of resampling before giving way.
  let call = 0;
  modelReply = () => {
    call += 1;
    return call === 1
      ? THE_486
      : 'Fine, new words: your motherboard outlived three of my firmware updates. Respect.';
  };
  const beforeThird = sent.length;
  await engine.handle(message('Cinderella say that differently', 12));
  const third = sent.slice(beforeThird);
  check(
    'a resample that lands elsewhere SHIPS the variant',
    third.some((t) => t.includes('firmware updates')),
    third.join(' | ').slice(0, 80),
  );
  check('  and the duplicate still did not ship', !third.some((t) => t.includes('not a 486')));

  /* ── 3. Application templates repeat freely ──────────────────────────────── */

  console.log('\n3. What the gate must NEVER touch: the templates');

  // Two members ask to publish IN WORDS - the natural path, which is the one that flows
  // through this engine; slash commands ride a separate handler and never could be gated.
  // Both get the SAME confirmation question, byte for byte. The stage-0 measurement found
  // seven consent confirmations among a naive gate's hits - refusing the second would
  // silently not confirm a publication, the one failure this product cannot have. The gate
  // is scoped to model-worded lanes, so these never pass through it; this proves that
  // scoping end to end rather than trusting the reading.
  const beforeConsent = sent.length;
  await engine.handle(message('Cinderella publish me', 20, 'member-one'));
  await engine.handle(message('Cinderella publish me', 21, 'member-two'));
  const confirmations = sent.slice(beforeConsent);
  check('both consent confirmations sent', confirmations.length === 2, String(confirmations.length));
  check(
    'byte-identical, because a template repeating is the template working',
    confirmations.length === 2 && confirmations[0] === confirmations[1],
  );

  /* ── 4. The mutation: what stands between her and the duplicate ──────────── */

  console.log('\n4. The mutation the briefing asked for');

  // The world without the gate, reproduced through the gate's own floor: priors below the
  // length floor are not witnesses, so the identical short exchange ships twice. This is
  // the shipped-defect behaviour surviving exactly where the measurement said it should
  // (two short confirmations agreeing is conversation), and it proves the refusal above
  // comes from the gate's criterion rather than from anything else in the engine.
  modelReply = () => 'Ping received. All quiet.';
  const beforeShort = sent.length;
  await engine.handle(message('Cinderella ping', 30));
  await engine.handle(message('Cinderella ping again', 31));
  const shorts = sent.slice(beforeShort);
  check(
    'below the floor the duplicate SHIPS, so the gate is the only thing refusing above it',
    shorts.length === 2 && shorts[0] === shorts[1],
    `${String(shorts.length)} sends`,
  );
  check(
    '  and the floor is why',
    'Ping received. All quiet.'.length < REPETITION_MIN_CHARS,
  );

  await pg.close();

  console.log(
    failures === 0
      ? '\nThe first occurrence sends, the duplicate never does, the templates repeat freely, ' +
          'and the give-up is counted where the operator looks.'
      : `\n${String(failures)} check(s) FAILED.`,
  );
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
