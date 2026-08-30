/**
 * The guard that throws away a reply for naming the member, and what it costs (CCB-S5-031).
 *
 * ── THE DEFECT ───────────────────────────────────────────────────────────────
 *
 * `blockedLiterals: [msg.senderDisplayName]` rejected a whole reply whose prose contained
 * the speaking member's display name, matched as a bare case-insensitive SUBSTRING with no
 * word boundary and no minimum length. A member calling themselves `In`, `Al`, `Ed` or `A`
 * therefore had every reply she wrote destroyed, because those are substrings of ordinary
 * words in both languages, and nobody ever learned an answer had existed: the rejection was
 * a `log.debug` inside a catch.
 *
 * Three things are fixed and this drives all three.
 *
 *   1. the match is a WHOLE WORD, Unicode-aware, with a floor on the name's length;
 *   2. every rejection is COUNTED where an operator can see it, per CCB-S3-023, with the
 *      expensive case (free conversation, no draft, answer lost) distinguished from the
 *      cheap one (a deterministic line went instead);
 *   3. the two call sites that answered a SUCCESSFUL lookup with "I could not look that up
 *      just now" now say which half actually failed.
 *
 * ── THE QUESTION SECTION 3 EXISTED TO MAKE MEASURABLE IS NOW DECIDED (D-227) ─
 *
 * CCB-S5-031 left strip-versus-reject open and built the count to decide it. The count
 * decided: a true match is STRIPPED - a vocative removed, an inline mention turned second
 * person - and the rest of the answer ships, recorded with cost `stripped`. Rejection
 * remains the fallback for a strip that leaves nothing or fails to remove the name, so
 * the guard's failure direction is unchanged. This harness now pins the strip.
 *
 * ── EVERY NEGATIVE HAS A POSITIVE CONTROL ────────────────────────────────────
 *
 * "The guard did not fire" passes trivially against a guard that never fires, and "the
 * answer survived" passes against one that has been deleted. So each absence is asserted
 * beside the presence that makes it meaningful: the same name at the same length is shown
 * being caught as a whole word and let through inside one.
 *
 *   npx tsx scripts/verify-name-guard.ts
 */

import { PGlite } from '@electric-sql/pglite';
import { vector } from '@electric-sql/pglite-pgvector';
import type { Queryable } from '../src/db/pool.js';
import { loadMigrationFiles } from '../src/db/migrate.js';
import { listPromptRules } from '../src/db/prompt-rules.js';
import { AI_PERSONALIZED_KEYS, InteractionEngine } from '../src/interaction/engine.js';
import { DEFAULT_INTERACTION, normalizeInteraction } from '../src/interaction/settings.js';
import { DEFAULT_PERSONALITY } from '../src/interaction/personality.js';
import { CORE_INTENTS } from '../src/interaction/intent.js';
import {
  MIN_BLOCKED_NAME_CHARS,
  generateOllamaReply,
  type AiReplyRequest,
  type FetchLike,
} from '../src/interaction/ollama-reply.js';
import {
  blockedNameCount,
  clearBlockedNames,
  recentBlockedNames,
} from '../src/interaction/blocked-name-log.js';
import { modelQueue } from '../src/interaction/model-queue.js';
import type { LocalAiConfig } from '../src/config.js';
import type { CapturedMessage } from '../src/capture/message.js';
import { log, setLogLevel } from '../src/log.js';
import { AiRuntimeService } from '../src/interaction/ai-runtime.js';

let failures = 0;
function check(label: string, ok: boolean, detail = ''): void {
  if (!ok) failures++;
  console.log(`  [${ok ? 'PASS' : 'FAIL'}] ${label}${detail ? `: ${detail}` : ''}`);
}

const GROUP = 1;
const ALICE = 'alice-member-id';

const config: LocalAiConfig = {
  enabled: true,
  baseUrl: 'http://127.0.0.1:11434',
  model: 'qwen3.5:9b',
  timeoutMs: 1000,
};

let nextReply = '';
const fakeFetch: FetchLike = (input) => {
  const url = new URL(String(input));
  // The native endpoint since D-252; the envelope below matches it.
  if (url.pathname !== '/api/chat') {
    return Promise.resolve(new Response('not found', { status: 404 }));
  }
  return Promise.resolve(
    new Response(
      JSON.stringify({ message: { content: JSON.stringify({ reply: nextReply }) }, done_reason: 'stop' }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    ),
  );
};

function message(text: string, itemId = 10): CapturedMessage {
  return {
    groupId: GROUP,
    groupName: 'archive',
    itemId,
    sharedMsgId: undefined,
    senderMemberId: ALICE,
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

  const pg = new PGlite({ extensions: { vector } });
  const db: Queryable = {
    async query(sql, values) {
      const result = await pg.query(sql, values ? [...values] : undefined);
      return {
        rows: result.rows as never[],
        rowCount: (result.affectedRows ?? result.rows.length) as number,
      };
    },
  } as Queryable;
  // `exec`, not `query`: a migration file holds many statements and `query` takes one.
  for (const migration of await loadMigrationFiles()) await pg.exec(migration.sql);
  const rules = await listPromptRules(db);
  const persona = normalizeInteraction({ ...DEFAULT_INTERACTION }).persona;

  /**
   * One reply through the REAL guard, with the REAL transport shape.
   *
   * `deterministicDraft` decides the recorded cost, so it is a parameter: an empty draft is
   * free conversation, where a rejection destroys the answer.
   */
  const speak = async (
    reply: string,
    senderName: string,
    draft = '',
    lang = 'en',
  ): Promise<{ text: string | null; error: string | null }> => {
    nextReply = reply;
    const request = {
      kind: 'conversation',
      lang,
      memberMessage: 'hello',
      deterministicDraft: draft,
      mode: 'conversation',
      rules,
      blockedLiterals: [senderName],
      botProfileId: 1,
      now: { at: new Date(), timeZone: 'UTC' },
    } as unknown as AiReplyRequest;
    try {
      return { text: await generateOllamaReply(config, request, fakeFetch), error: null };
    } catch (error) {
      return { text: null, error: error instanceof Error ? error.message : String(error) };
    }
  };

  const rejected = async (reply: string, senderName: string, draft = ''): Promise<boolean> =>
    (await speak(reply, senderName, draft)).error?.includes('exposed blocked text') === true;

  /** One reply through the guard with the record inspected beside the result. */
  const guarded = async (
    reply: string,
    senderName: string,
    draft = '',
    lang = 'en',
  ): Promise<{ text: string | null; error: string | null; events: ReturnType<typeof recentBlockedNames> }> => {
    clearBlockedNames();
    const out = await speak(reply, senderName, draft, lang);
    return { ...out, events: recentBlockedNames() };
  };

  /* ── 1. The match is a whole word ────────────────────────────────────────── */

  console.log('\n1. A name is matched as a word, not as a run of letters');

  // THE PRODUCTION SHAPE FIRST. A long name written out in her prose is still CAUGHT -
  // and since D-227 the catch is a recovery: the vocative goes, the answer ships.
  //
  // A PLACEHOLDER of SimpleX's auto-generated adjective-plus-noun shape, not the display name
  // from the incident, because this repository is public and a display name is member data.
  // Only the shape matters here: long enough that a substring hit is unambiguous, and a word
  // it can be embedded in.
  const vocative = await guarded('Good question, BeamingRiver, the archive keeps that.', 'BeamingRiver');
  check(
    'a display name she wrote is taken out and the answer ships without it (D-227)',
    vocative.text === 'Good question, the archive keeps that.' &&
      vocative.events.length === 1 &&
      vocative.events[0]?.cost === 'stripped',
    vocative.text ?? vocative.error ?? '',
  );

  // ...and the negative that the boundary buys, with the SAME name at the SAME length, so
  // the pair differs in one property only: the guard does not even fire.
  const embedded = await guarded('They talked about beamingriverside walks.', 'BeamingRiver');
  check(
    '  but the same letters inside a longer word are left entirely alone',
    embedded.text === 'They talked about beamingriverside walks.' && embedded.events.length === 0,
  );

  // The four-character floor is the boundary's partner and neither works alone. `Ella` is a
  // real name, long enough to guard, and a substring of ordinary words in both languages.
  const ella = await guarded('Ella, that is published now.', 'Ella');
  check(
    'a four-character name standing alone is stripped',
    ella.text === 'That is published now.' && ella.events[0]?.cost === 'stripped',
    ella.text ?? '',
  );
  const stellar = await guarded('Take an umbrella, the stellar forecast is poor.', 'Ella');
  check(
    '  and untouched inside "umbrella" or "stellar"',
    stellar.text === 'Take an umbrella, the stellar forecast is poor.' && stellar.events.length === 0,
  );

  // German, because the guard runs in both languages and `ein`/`in` are the worst cases.
  const inge = await guarded('Das steht in deinen Unterlagen, glaube ich.', 'Inge', '', 'de');
  check(
    'a German sentence is not touched for a name inside its prepositions',
    inge.text === 'Das steht in deinen Unterlagen, glaube ich.' && inge.events.length === 0,
  );
  const ingeNamed = await guarded('Inge, das steht in deinen Unterlagen.', 'Inge', '', 'de');
  check(
    '  while the same member named outright is still caught, and the address removed',
    ingeNamed.text === 'Das steht in deinen Unterlagen.' && ingeNamed.events[0]?.cost === 'stripped',
    ingeNamed.text ?? '',
  );

  /* ── 2. The floor, and what it deliberately gives up ─────────────────────── */

  console.log('\n2. The floor on a name that cannot be told from a word');

  check(
    `the floor is ${String(MIN_BLOCKED_NAME_CHARS)} characters and is exported so the console can state it`,
    MIN_BLOCKED_NAME_CHARS === 4,
  );

  // THE DEFECT ITSELF. Each of these is an ordinary word in English or German, and each was
  // destroying every reply for the member who chose it.
  for (const [name, sentence] of [
    ['In', 'It is in the archive, and it has been since Tuesday.'],
    ['Al', 'I will check all of it for you.'],
    ['A', 'That is a fair question.'],
    ['Ed', 'I have edited nothing of yours.'],
    ['Art', 'The art of it is knowing when to stop.'],
  ] as const) {
    check(
      `  a member called "${name}" no longer loses this reply`,
      !(await rejected(sentence, name)),
    );
  }

  // THE POSITIVE CONTROL THE FLOOR NEEDS. Without this, "short names are not guarded" would
  // pass against a guard that had been deleted outright.
  const anna = await guarded('Anna, I have that here.', 'Anna');
  check(
    'a name one character over the floor is still guarded',
    anna.text === 'I have that here.' && anna.events.length === 1,
    anna.text ?? '',
  );

  // STATED, NOT HIDDEN: this is the cost of the floor and the check says so out loud.
  const sam = await guarded('Sam, I have that here.', 'Sam');
  check(
    '  and a three-character name is knowingly NOT guarded, which is the trade',
    sam.text === 'Sam, I have that here.' && sam.events.length === 0,
  );

  /* ── 3. Every catch is counted, and the strip is the normal case (D-227) ─── */

  console.log('\n3. A catch reaches the operator, and the answer survives it');

  clearBlockedNames();
  check('the log starts empty', blockedNameCount() === 0);

  // The two shapes the count showed were being destroyed: the vocative and the inline
  // mention. Both now ship, with the name gone, and both are recorded.
  await speak('Alice, the archive has three of those.', 'Alice', '');
  await speak('I asked Alice for patience.', 'Alice', 'The archive has three.');

  const events = recentBlockedNames();
  check('both catches were recorded', blockedNameCount() === 2, `count=${String(blockedNameCount())}`);
  check(
    'the recorded name is the one that matched',
    events.every((e) => e.literal === 'Alice'),
  );
  check(
    'both were recoveries: cost says the name went and the reply shipped',
    events.every((e) => e.cost === 'stripped'),
    events.map((e) => e.cost).join(','),
  );
  check(
    'what she had written is kept, so the count can be judged',
    events.every((e) => /alice/i.test(e.text)),
  );

  // The strip's grammar: an inline mention becomes second person, a possessive becomes
  // "your", and German gets its own words.
  const inline = await guarded('I asked Alice for patience.', 'Alice');
  check(
    'an inline mention becomes second person',
    inline.text === 'I asked you for patience.',
    inline.text ?? '',
  );
  const possessive = await guarded("That was Alice's idea all along.", 'Alice');
  check(
    "a possessive becomes 'your'",
    possessive.text === 'That was your idea all along.',
    possessive.text ?? '',
  );

  // THE REJECT FALLBACK IS STILL THERE, read from the source because it is deliberately
  // hard to reach: it exists for a strip that leaves nothing or fails to remove the name
  // (the substring fallback in matchesBlockedName can match what a whole-word replacement
  // cannot remove), and the day somebody deletes it this goes red.
  {
    const src = await (await import('node:fs/promises')).readFile(
      'src/interaction/ollama-reply.ts',
      'utf8',
    );
    check(
      'the reject fallback survives for a strip that fails',
      src.includes('stripped.length < 2 || matchesBlockedName(stripped, literal)') &&
        src.includes('noteBlockedName(literal, current, request);'),
    );
  }

  // A REPLY THAT PASSES IS NOT RECORDED, or the card would count clean traffic as faults.
  const before = blockedNameCount();
  const clean = await speak('The archive has three of those.', 'Alice');
  check(
    'a reply that names nobody is delivered and not counted',
    clean.text !== null && blockedNameCount() === before,
  );

  /* ── 4. The line that says which half failed ─────────────────────────────── */

  console.log('\n4. A lookup that ran is never reported as a lookup that failed');

  check(
    'searchNoWords exists in both languages',
    typeof persona['en']?.searchNoWords === 'string' &&
      typeof persona['de']?.searchNoWords === 'string',
  );
  check(
    '  and says the looking happened, unlike searchUnavailable',
    /found something/i.test(persona['en']?.searchNoWords ?? '') &&
      persona['en']?.searchNoWords !== persona['en']?.searchUnavailable,
  );
  // IT MUST NOT BE PERSONALIZED. This line is reached because wording failed; wording it
  // through the same path that just failed is the one thing it cannot do.
  check(
    '  and is deterministic, because it exists for the case where wording failed',
    !AI_PERSONALIZED_KEYS.has('searchNoWords' as never),
  );

  // Names its destination, because a holding line that names nowhere is refused since
  // D-251 - and the bare marker was exactly the production defect standing in a fixture.
  const HOLD = '<<HOLDING-LINE>> reading the documents he gave me';

  // THE METER IS A MODULE SINGLETON AND SECTIONS 1 TO 3 HAVE BEEN FEEDING IT.
  //
  // `lookupAnnouncementDue` projects how long her reply will take from the rate observed in
  // her own recent replies (D-184), and every `speak()` above went through the real
  // transport path against a fake that answers in about a millisecond. That is a rate of
  // tens of thousands of characters a second, so the projected wait is zero, so nothing
  // announces and this whole section silently tests nothing.
  //
  // Reset rather than reordered, because the ordering that fixes it is invisible: a future
  // editor moving a section would reintroduce this with no failure to warn them. A null rate
  // is what a cold process has and `shouldAnnounce` reads it as yes.
  modelQueue.reset();

  /** Drive the real engine with the knowledge lookup succeeding and the wording failing. */
  const drive = async (opts: {
    text: string;
    knowledgePassages?: { text: string }[];
    modelFails: boolean;
  }): Promise<string[]> => {
    const sent: string[] = [];
    const engine = new InteractionEngine({
      capabilities: () => [...CORE_INTENTS, 'LOOKUP'],
      db,
      settings: () => normalizeInteraction({ ...DEFAULT_INTERACTION }),
      rules: () => rules,
      personality: () => ({ ...DEFAULT_PERSONALITY, verbosity: 10 }),
      knowledge:
        opts.knowledgePassages === undefined
          ? undefined
          : () => ({
              query: () =>
                Promise.resolve({
                  passages: opts.knowledgePassages ?? [],
                  sources: ['handbook.md'],
                }),
            }),
      botProfileId: 1,
      personalize: (req: AiReplyRequest) => {
        if (req.mode === 'searching') return Promise.resolve(HOLD);
        return Promise.resolve(opts.modelFails ? null : '<<ANSWER>>');
      },
      send: (_msg: CapturedMessage, text: string) => {
        sent.push(text);
        return Promise.resolve();
      },
    } as never);
    await engine.handle(message(opts.text));
    return sent;
  };

  const lost = await drive({
    text: 'Cinderella what does the handbook say about pancakes?',
    knowledgePassages: [{ text: 'Pancakes are cooked on a griddle.' }],
    modelFails: true,
  });
  const lostText = lost.join('\n');
  check(
    'she announced the lookup and then reported the WORDING as the failure',
    lost.some((t) => t.includes(HOLD)) && lostText.includes('lost the words'),
    lostText.replace(/\s+/g, ' ').slice(0, 120),
  );
  // THE DEFECT, ASSERTED AS AN ABSENCE. This is the sentence production was sending.
  check(
    '  and never claims it could not look it up, which is what it had been saying',
    !/could not look that up/i.test(lostText),
  );

  // POSITIVE CONTROL: the same path with a working model answers normally, so the check
  // above is not passing against a lane that has stopped speaking altogether.
  const ok = await drive({
    text: 'Cinderella what does the handbook say about pancakes?',
    knowledgePassages: [{ text: 'Pancakes are cooked on a griddle.' }],
    modelFails: false,
  });
  check(
    'a working lookup still answers, so the assertion above means something',
    ok.join('\n').includes('<<ANSWER>>'),
  );

  /* ── 5. Mutations ────────────────────────────────────────────────────────── */

  console.log('\n5. Mutations: each guarantee is shown able to go red');

  // 5a. REMOVE THE BOUNDARY. This restores the shipped defect exactly.
  const substringWouldReject = 'That is an elatingbrainwave of an idea.'
    .toLocaleLowerCase()
    .includes('elatingbrain'.toLocaleLowerCase());
  check(
    'MUTATION: the old substring test rejects the reply the boundary saves',
    substringWouldReject,
  );

  // 5b. REMOVE THE FLOOR. Same shape, for the other half of the fix.
  const noFloorWouldReject = /(?<![\p{L}\p{N}_])in(?![\p{L}\p{N}_])/iu.test(
    'It is in the archive, and it has been since Tuesday.',
  );
  check(
    'MUTATION: with no floor, a boundary alone still destroys a member called "In"',
    noFloorWouldReject,
  );

  // 5c. A CATCH THAT LEAVES NO RECORD. The operator asked for this one by name when the
  // guard rejected, and it holds unchanged now that it strips: a strip nobody can see is
  // the silent rewrite CCB-S3-023 forbids, so a catch with no record must fail the check.
  clearBlockedNames();
  const silently = await speak('Alice, here it is.', 'Alice');
  check(
    'MUTATION: a strip with no record would fail here',
    silently.text === 'Here it is.' && blockedNameCount() === 1,
    `shipped=${JSON.stringify(silently.text)} recorded=${String(blockedNameCount())}`,
  );

  /* ── 6. The name stays out of the journal (CCB-S5-062) ───────────────────── */
  //
  // The guard's throw message carried the member's display name, and the one consumer of
  // that message is `AiRuntime.personalize`'s catch, which logs it at WARN - beside the
  // standing rule to redact before logging. The dedicated record (asserted throughout this
  // file) carries the name on purpose, behind the passkey; the journal may not.

  console.log('\n6. A rejection is logged without the name it rejected for');

  const noted = await guarded('Priscilla!', 'Priscilla');
  check('the reply is rejected, so there is an error headed for the journal', noted.error !== null);
  check(
    'POSITIVE CONTROL: the dedicated record carries the name, so it was there to leak',
    noted.events.some((e) => e.literal === 'Priscilla' && e.text.includes('Priscilla')),
  );
  check(
    "the throw's message does not carry it",
    noted.error !== null && !noted.error.includes('Priscilla'),
    noted.error ?? '',
  );
  check(
    'and still names the kind of failure, so the AI page category survives the redaction',
    noted.error?.includes('blocked text') === true,
  );

  // The warn line itself, from the REAL runtime with the REAL logger spied on: this is
  // the line the operator's journal holds, and the surface the name leaked on.
  setLogLevel('warn');
  const captured: string[] = [];
  const realWarn = log.warn;
  log.warn = (message, meta) => {
    captured.push(meta === undefined ? message : `${message} ${JSON.stringify(meta)}`);
  };
  try {
    const runtime = await AiRuntimeService.load(db, config, { fetchImpl: fakeFetch });
    nextReply = 'Priscilla!';
    const out = await runtime.personalize({
      kind: 'conversation',
      lang: 'en',
      memberMessage: 'hello',
      deterministicDraft: 'a draft to fall back on',
      mode: 'conversation',
      rules,
      blockedLiterals: ['Priscilla'],
      botProfileId: 1,
      now: { at: new Date(), timeZone: 'UTC' },
    } as unknown as AiReplyRequest);
    check(
      'the runtime fell back and wrote its warn line',
      out === null && captured.length > 0,
      `${String(captured.length)} line(s)`,
    );
    check(
      'no line that reached the logger carries the name',
      captured.every((line) => !line.includes('Priscilla')),
      captured.find((line) => line.includes('Priscilla'))?.slice(0, 120) ?? '',
    );
    // MUTATION: the shipped warn line, reconstructed character for character, trips the
    // read above - so "no line carries the name" is a detector that can go red, not a
    // tautology over an empty capture.
    captured.push(
      'Local AI reply wording failed; using the deterministic fallback ' +
        '(Ollama reply exposed blocked text: Priscilla.).',
    );
    check(
      'MUTATION: the shipped warn line would have been caught by that read',
      captured.some((line) => line.includes('Priscilla')),
    );
  } finally {
    log.warn = realWarn;
    setLogLevel('error');
  }

  console.log(
    failures === 0
      ? '\nAll name-guard checks passed.\n'
      : `\n${String(failures)} name-guard check(s) FAILED.\n`,
  );
  process.exit(failures === 0 ? 0 : 1);
}

void main();
