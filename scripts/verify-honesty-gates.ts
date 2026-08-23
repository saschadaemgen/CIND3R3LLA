/**
 * The confidence hedge and the snippet rule (CCB-S5-060 stages 3 and 4, D-255).
 *
 * ── WHAT EACH ONE GUARANTEES ─────────────────────────────────────────────────
 *
 * The HEDGE: a conversational answer whose own token probabilities say the model was
 * guessing carries an application-written caveat. Hedge, never suppress - the operator's
 * decision: the answer still goes out, because losing one correct answer in five is too
 * high a price for silence and a hedge is honest where silence is only safe.
 *
 * The SNIPPET RULE: a version or price in a web answer that also appears in a snippet she
 * was handed is marked as coming from a preview nobody opened, because no search API
 * returns the crawl date and the v7.0 case was unavoidable given what she was handed.
 *
 * ── THE GRAMMAR-FORCED-TOKEN TRAP, PINNED ────────────────────────────────────
 *
 * The first threshold measurement returned minProb 0.000 for EVERY reply in BOTH classes:
 * the schema grammar forces the key token `"reply"`, and a forced token carries the raw
 * probability of a token the model was never free to refuse. A gate reading the whole span
 * would hedge everything or nothing. Section 1 pins the value-interior extraction that
 * makes the signal mean something, with the forced-key case as its own assertion.
 *
 *   npx tsx scripts/verify-honesty-gates.ts
 */

import { PGlite } from '@electric-sql/pglite';
import { vector } from '@electric-sql/pglite-pgvector';
import type { Queryable } from '../src/db/pool.js';
import { loadMigrationFiles } from '../src/db/migrate.js';
import { listPromptRules } from '../src/db/prompt-rules.js';
import { InteractionEngine } from '../src/interaction/engine.js';
import { DEFAULT_INTERACTION, normalizeInteraction } from '../src/interaction/settings.js';
import { DEFAULT_PERSONALITY } from '../src/interaction/personality.js';
import { CORE_INTENTS, capabilityCatalog } from '../src/interaction/intent.js';
import {
  CONFIDENCE_HEDGE_THRESHOLD,
  minReplyTokenProb,
  replyValueSpan,
  snippetValueAsserted,
} from '../src/interaction/confidence.js';
import type { AiReplyRequest } from '../src/interaction/ollama-reply.js';
import type { CapturedMessage } from '../src/capture/message.js';
import { stripProtectedLines } from '../src/interaction/protected-text.js';
import {
  EVIDENCE_MIN_TERMS,
  EVIDENCE_VERBATIM_SHARE,
  attributable,
  evidenceOfUse,
  looksLikeRefusal,
} from '../src/interaction/provenance.js';
import { attributionForUsed } from '../src/knowledge/retrieval.js';
import {
  HEDGED_LANE,
  assertsGivenFact,
  carriesCheckableClaim,
  givenFactValues,
  lockedReply,
  numberWords,
} from '../src/interaction/confidence.js';
import { readFileSync } from 'node:fs';
import { setLogLevel } from '../src/log.js';

let failures = 0;
function check(label: string, ok: boolean, detail = ''): void {
  if (!ok) failures++;
  console.log(`  [${ok ? 'PASS' : 'FAIL'}] ${label}${detail ? `: ${detail}` : ''}`);
}

const GROUP = 1;
function message(text: string, itemId: number): CapturedMessage {
  return {
    groupId: GROUP,
    groupName: 'archive',
    itemId,
    sharedMsgId: undefined,
    senderMemberId: 'alice-member-id',
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

  /* ── 1. The signal: value-interior tokens only ───────────────────────────── */

  console.log('\n1. The confidence signal reads the reply, not the grammar');

  const content = '{"reply": "The capital of France is Paris."}';
  const entries = [
    { token: '{"', logprob: 0 },
    // THE FORCED KEY, at the measured raw probability of a token the grammar chose: e^-30
    // is the 0.000 that made every naive minimum identical in both classes.
    { token: 'reply', logprob: -30 },
    { token: '":', logprob: 0 },
    { token: ' "', logprob: 0 },
    { token: 'The', logprob: Math.log(0.9) },
    { token: ' capital', logprob: Math.log(0.99) },
    { token: ' of France is Paris', logprob: Math.log(0.6) },
    { token: '."', logprob: 0 },
    { token: '}', logprob: -20 },
  ];
  const span = replyValueSpan(content);
  check('the value span finds the reply string', span !== null && content.slice(span.lo, span.hi) === 'The capital of France is Paris.');
  const min = minReplyTokenProb(content, entries);
  check(
    'THE TRAP, PINNED: the forced key token is excluded from the minimum',
    min !== null && Math.abs(min - 0.6) < 1e-9,
    String(min),
  );
  check('an escaped quote does not end the span early', (() => {
    const c = '{"reply": "She said \\"hi\\" twice."}';
    const s2 = replyValueSpan(c);
    return s2 !== null && c.slice(s2.lo, s2.hi) === 'She said \\"hi\\" twice.';
  })());
  check('no envelope means no signal, and no signal means no hedge', minReplyTokenProb('plain text', entries) === null);
  check('no entries means no signal', minReplyTokenProb(content, []) === null);
  check('the threshold is the measured one', CONFIDENCE_HEDGE_THRESHOLD === 0.7);

  /* ── 2. The snippet rule, pure ───────────────────────────────────────────── */

  console.log('\n2. A value seen in a snippet is marked as a preview value');

  const SNIPPET = 'New in v7.0. SimpleX public names for channels and businesses (BETA).';
  check(
    'THE V7.0 CASE: the copied version is caught',
    snippetValueAsserted('v7.0. SimpleX public names for channels and businesses (BETA).', [SNIPPET]) === 'v7.0',
  );
  check(
    '  and the bare form matches the prefixed one',
    snippetValueAsserted('The latest is 7.0, says the search.', [SNIPPET]) !== null,
  );
  check(
    'a price is caught too, the other production shape',
    snippetValueAsserted('It costs $4.99 per month.', ['Plans start at $4.99 monthly.']) !== null,
  );
  check(
    'a value NOT in any snippet is left to the confidence hedge',
    snippetValueAsserted('I would guess around v9.2 by now.', [SNIPPET]) === null,
  );
  check(
    'an answer with no value asserts nothing and is not marked',
    snippetValueAsserted('The releases page is the place to check.', [SNIPPET]) === null,
  );
  check(
    'a bare year does not trip the pattern, or half of conversation would',
    snippetValueAsserted('That was back in 2023 I think.', ['Posted in 2023.']) === null,
  );

  /* ── 3. The engine: hedge appended, answer kept ──────────────────────────── */

  console.log('\n3. Hedge, never suppress, driven through the real engine');

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
  let confidence: number | null = null;
  // VARIED PER CALL, deliberately: the repetition gate (D-253) sits on the same lane, and
  // a fixture returning one string forever would have IT refuse the later turns - which is
  // exactly what happened to this harness's first run. Two gates, one lane, and a fixture
  // has to be innocent of both to test either.
  let phrasing = 0;
  const engine = new InteractionEngine({
    capabilities: () => [...CORE_INTENTS],
    db,
    settings: () => normalizeInteraction({ ...DEFAULT_INTERACTION }),
    rules: () => rules,
    personality: () => ({ ...DEFAULT_PERSONALITY }),
    personalize: (req: AiReplyRequest) => {
      if (req.mode !== 'conversation') return Promise.resolve(null);
      if (confidence !== null) req.onConfidence?.(confidence);
      // Genuinely different wording each call - a one-digit variation scores ~0.97 Jaccard
      // and the gate (correctly) refuses it, which this harness's second run proved.
      const phrasings = [
        'The SimpleGo relay tops out at 64 channels, if memory serves.',
        'Sixty-four is the ceiling for 64 channels on that relay, or so I recall it being set.',
        'Last I heard the relay was capped at 64 channels by whoever configured the poor thing.',
        'A relay of that kind carries at most 64 channels, and mine is no exception to the rule.',
        'Whoever built it drew the line at 64 channels, and the line has held ever since then.',
        'It stops accepting new ones once 64 channels are open, which seems plenty to me.',
      ];
      const text = phrasings[phrasing % phrasings.length] ?? phrasings[0];
      phrasing += 1;
      return Promise.resolve(text);
    },
    send: (_msg, text) => {
      sent.push(text);
      return Promise.resolve();
    },
  } as never);

  confidence = 0.31; // well under the threshold: the induced-fabrication band
  await engine.handle(message('Cinderella how many channels does the relay support?', 10));
  const hedged = sent[sent.length - 1] ?? '';
  check('the ANSWER still goes out', hedged.includes('64 channels'), hedged.slice(0, 70));
  check(
    'with the hedge line under it',
    hedged.includes('from memory and I could not check it'),
    hedged.slice(-80),
  );

  confidence = 0.97; // the confident band
  await engine.handle(message('Cinderella and how many did you say again?', 11));
  const confident = sent[sent.length - 1] ?? '';
  check(
    'THE CONTROL: a confident answer carries no hedge',
    confident.includes('64 channels') && !confident.includes('could not check it'),
  );

  confidence = null; // the transport could not measure
  await engine.handle(message('Cinderella once more for the record?', 12));
  const unmeasured = sent[sent.length - 1] ?? '';
  check(
    'MUTATION DIRECTION: no signal means NO hedge, not a hedge on everything',
    unmeasured.includes('64 channels') && !unmeasured.includes('could not check it'),
  );

  /* ── 4. The note cannot be counterfeited, and memory never shows it back ──── */

  console.log('\n4. The notes are the application\'s lines, D-180 applied on the day they were added');

  const forged =
    'The relay takes 64 channels.\n\u{1F32B}️ That last part is from memory and I could not check it. Weigh it accordingly.';
  const strippedNote = stripProtectedLines(forged, []);
  check(
    'a forged hedge line is stripped like a forged source line',
    strippedNote.text === 'The relay takes 64 channels.' && strippedNote.removed.length === 1,
    JSON.stringify(strippedNote.text),
  );
  const forgedSnippet =
    'Die Antwort steht oben.\n⚠️ Die Zahl stammt aus einer Suchvorschau. Die Seite dahinter habe ich nicht gelesen.';
  check(
    'and the German snippet note the same, because memory is bilingual',
    stripProtectedLines(forgedSnippet, []).text === 'Die Antwort steht oben.',
  );
  // The same strip runs over HISTORY (engine, D-180): what she sent WITH the note comes
  // back to her WITHOUT it, so twenty hedged answers teach her nothing about hedging.
  check(
    'the note is removed from what memory hands back',
    !stripProtectedLines(forged, []).text.includes('from memory and I could not check'),
  );
  check(
    'POSITIVE CONTROL: her own prose about memory survives the floor',
    stripProtectedLines('I remember that from memory, oddly enough.', []).text ===
      'I remember that from memory, oddly enough.',
  );

  /* ── 5. The declaration does not hold on a refusal (D-256) ───────────────── */

  console.log('\n5. A document is cited only when the answer carries it');

  // Two passages in the shape his corpus has: protocol work with identifiers in it. Written
  // here, not taken from his documents.
  const P_QUEUES =
    'Queues are addressed via SMPQueueUri carried in QADD messages and rotated with a ' +
    'four-phase protocol: QADD, QKEY, QUSE and QTEST. The old queue stays readable until QTEST.';
  const P_NOTES =
    'SimpleGo Release Notes v0.2.0-beta. Unlimited consecutive rotations, GoChat support, ' +
    'firmware binaries attached. Late-arrival flows remain an open item.';
  const PASSAGES = [P_QUEUES, P_NOTES];

  // THE LIVE CASE'S SHAPE: a correct refusal that declared both passages.
  const liveQ = 'How many people use SimpleX?';
  const liveA = "I don't know how many people use SimpleX, darling. Ask the folks running it.";
  check(
    'THE LIVE CASE: a refusal that declared both passages cites neither',
    attributable([0, 1], PASSAGES, liveA, liveQ).length === 0,
  );
  check(
    'MUTATION, the shipped behaviour: the declaration alone would have printed both',
    attributionForUsed(['A', 'B'], [0, 1]).length === 2,
  );
  // The evidence rule holds where the floor is blind: a refusal worded in a way no term list
  // has met, over a passage sharing the question's own words.
  const oddRefusal = 'Nope. Nothing I can see about that one, ask whoever runs it.';
  check(
    'the floor misses this wording, by construction of the check',
    !looksLikeRefusal(oddRefusal),
  );
  check(
    '  and the evidence rule still refuses it: zero passage terms beyond the question',
    attributable([0, 1], PASSAGES, oddRefusal, 'How are queues addressed and rotated?').length === 0,
  );
  check(
    'an answer that only echoes the question over a passage containing those words carries nothing',
    evidenceOfUse(
      'I cannot tell you how queues are addressed or rotated.',
      'How are queues addressed and rotated?',
      P_QUEUES,
    ).terms.length === 0,
  );
  // A true answer, paraphrased, carries the identifiers it could only have read.
  const trueA =
    'They are addressed with SMPQueueUri inside QADD messages and rotate through QADD, QKEY, QUSE and QTEST.';
  const trueEvidence = evidenceOfUse(trueA, 'How are queues addressed and rotated?', P_QUEUES);
  check(
    `a true answer carries at least ${String(EVIDENCE_MIN_TERMS)} passage terms (measured minimum on his corpus: 4)`,
    trueEvidence.terms.length >= EVIDENCE_MIN_TERMS,
    trueEvidence.terms.join(', '),
  );
  check(
    'and is cited - and ONLY the passage it used, not the other one it declared',
    JSON.stringify(attributable([0, 1], PASSAGES, trueA, 'How are queues addressed and rotated?')) === '[0]',
  );
  // THE CASE THE TERM RULE ALONE GETS WRONG, from the measurement: a version string is one
  // term, and a true one-word answer would lose its citation. The verbatim door keeps it.
  const versionQ = 'What is the latest SimpleGo version number?';
  const versionEv = evidenceOfUse('v0.2.0-beta', versionQ, P_NOTES);
  check(
    'a version-string answer carries fewer terms than the rule asks',
    versionEv.terms.length < EVIDENCE_MIN_TERMS,
    String(versionEv.terms.length),
  );
  check(
    `  but its shingle share clears the verbatim door (${String(EVIDENCE_VERBATIM_SHARE)}; refusals measured at most 0.26)`,
    versionEv.shingleShare >= EVIDENCE_VERBATIM_SHARE,
    versionEv.shingleShare.toFixed(2),
  );
  check(
    '  so it is cited',
    JSON.stringify(attributable([1], PASSAGES, 'v0.2.0-beta', versionQ)) === '[1]',
  );
  check(
    '  MUTATION: with the verbatim door shut, the true answer loses its citation',
    attributable([1], PASSAGES, 'v0.2.0-beta', versionQ, EVIDENCE_MIN_TERMS, 1.01).length === 0,
  );
  check(
    'an index outside the handed set is dropped, still',
    attributable([5], PASSAGES, trueA, 'How are queues addressed and rotated?').length === 0,
  );
  // The floor, on the forms the measurement met and the plain ones, both languages.
  for (const r of [
    'Not specified in the provided documents.',
    "No info on the founder's age. But I know he made SimpleX happen.",
    "That info isn't in my docs. Ask the SimpleX team directly.",
    'Not covered in provided docs.',
    "The SMP relay isn't mentioned in the provided documents.",
    "No idea. Next year's releases aren't written in beta notes from 2026.",
    'Not sure, but probably less than a million. Why?',
    "I don't do that.",
    'Ich weiß es nicht, ehrlich gesagt.',
    'Keine Ahnung, das steht da nicht.',
  ]) {
    check(`floor: "${r.slice(0, 44)}…" is refusal-shaped`, looksLikeRefusal(r));
  }
  check(
    'floor POSITIVE CONTROL: a real answer is not refusal-shaped',
    !looksLikeRefusal('ClientHello with ALPN smp/1 tells the server which version to use.') &&
      !looksLikeRefusal('Queues are not rotated in the provided mode, only re-keyed.'),
  );

  /* ── 6. The hedge never touches application-supplied truth (D-256) ───────── */

  console.log('\n6. The hedge is for her own words, never for what she was handed');

  const dj = givenFactValues({ tracks: 18, genres: ['Synthwave', 'Darkwave'], playlists: 2 });
  check(
    'THE LIVE CASE: "18 tracks, Synthwave and Darkwave" restates given facts',
    assertsGivenFact("I've got 18 tracks, darling: Synthwave and Darkwave, mostly.", dj) !== null,
  );
  check(
    '  and is exempt from the hedge for that reason',
    lockedReply({ page: false, requiredLiterals: [], documentsUsed: false, givenFacts: dj, reply: '18 tracks, Synthwave mostly.' }) === 'given-fact',
  );
  // THE SECOND LIVE FAULT: the SHORT form. The first matcher refused a trailing dot (to keep
  // "v18.2" from counting as 18) and knew no number words, so "18." and "Eighteen." both
  // missed and the hedge fired on a bare true answer. A member asking a second time gets a
  // different shape of the same true answer, and every shape must hold.
  for (const short of [
    '18. Spread across playlists. Want a number or a genre?', // the exact live reply
    '18.',
    '18, spread across playlists.',
    'Eighteen. Want a genre?',
    'Two playlists, darling.',
    'Two.',
    'Synthwave, Darkwave.',
    'Zwei Playlists.',
    'Achtzehn.',
    'Achtzehn Titel auf zwei Playlists, vor allem Synthwave.',
    'Eighteen tracks, two playlists, and a weakness for Darkwave.',
    'Mostly House and Synthwave, if you must know which genres.',
  ]) {
    check(`SHORT FORM restates a given fact: "${short}"`, assertsGivenFact(short, [...dj, 'House']) !== null);
  }
  check(
    'a number matches only as a whole number: "v18.2", "180" and "2.18" are not the counts',
    assertsGivenFact('Firmware v18.2 shipped; 180 devices on 2.18.', dj) === null,
  );
  // And the other direction, which is what makes number words safe to add at all: "two" and
  // "one" are everywhere in prose, so a value counts only in LIBRARY context - a library noun
  // within a few words, or a reply short enough to be a bare answer.
  for (const prose of [
    'I have two thoughts on that, darling, and neither of them is polite.',
    'The relay tops out at 18 channels, if memory serves me right today.',
    'The house rules apply to everyone here, no exceptions, not even for you.',
    'One of them asked me that yesterday and I told them the same thing then.',
  ]) {
    check(`NOT a given fact out of library context: "${prose.slice(0, 40)}…"`, assertsGivenFact(prose, [...dj, 'House']) === null);
  }
  check(
    'number words cover both languages, hyphenated and compound forms',
    numberWords(18).includes('eighteen') && numberWords(18).includes('achtzehn') &&
      numberWords(21).includes('twenty-one') && numberWords(21).includes('einundzwanzig') &&
      numberWords(30).includes('dreissig'),
  );
  check(
    'POSITIVE CONTROL: a memory answer is NOT exempt, so the hedge still has something to do',
    lockedReply({ page: false, requiredLiterals: [], documentsUsed: false, givenFacts: dj, reply: 'The relay tops out at 64 channels.' }) === null,
  );
  check(
    'a printed page is exempt',
    lockedReply({ page: true, requiredLiterals: [], documentsUsed: false, givenFacts: [], reply: 'Here it is.' }) === 'page',
  );
  check(
    'a reply carrying required literals is exempt',
    lockedReply({ page: false, requiredLiterals: ['93'], documentsUsed: false, givenFacts: [], reply: 'I have 93 laws.' }) === 'required-literals',
  );
  check(
    'an answer the documents were used for is exempt, because the source line says the opposite',
    lockedReply({ page: false, requiredLiterals: [], documentsUsed: true, givenFacts: [], reply: 'From the notes: ...' }) === 'documents-used',
  );
  const engineSource = readFileSync(new URL('../src/interaction/engine.ts', import.meta.url), 'utf8');
  check(
    `STRUCTURAL: the engine attaches onConfidence in exactly one place, the ${HEDGED_LANE} lane`,
    (engineSource.match(/onConfidence:/g) ?? []).length === 1 && HEDGED_LANE === 'conversation',
  );

  // Through the real engine: the exact question, the DJ facts from a fake library, a low
  // confidence, and the knowledge declaration on a refusal - both live faults in one run.
  const sentB: string[] = [];
  let confidenceB: number | null = null;
  let replyB = 'placeholder';
  let declareB: number[] | null = null;
  const engineB = new InteractionEngine({
    capabilities: () => [...CORE_INTENTS],
    db,
    botProfileId: 7,
    // The reply limiter is raised for this engine: it answers one member eight times in one
    // burst, and the shipped 6-per-member limit would drop the last turns as 'rate-limited'
    // - which it did, on this harness's first run with the extra short-form turns, leaving
    // the final control reading the previous reply. Not the property under test here.
    settings: () => normalizeInteraction({ ...DEFAULT_INTERACTION, replyLimitPerMember: 60, replyLimitPerChat: 120 }),
    rules: () => rules,
    personality: () => ({ ...DEFAULT_PERSONALITY }),
    music: () => ({
      facts: () => Promise.resolve({ tracks: 18, genres: [{ name: 'Synthwave', count: 10 }, { name: 'Darkwave', count: 8 }], playlists: 2 }),
    }),
    knowledge: () => ({
      query: () =>
        Promise.resolve({
          passages: [
            { title: 'SimpleX Protocol Analysis - Part 31', text: P_QUEUES },
            { title: 'SimpleGo Protocol Analysis: Index and Session History', text: P_NOTES },
          ],
          sources: ['SimpleX Protocol Analysis - Part 31', 'SimpleGo Protocol Analysis: Index and Session History'],
        }),
    }),
    personalize: (req: AiReplyRequest) => {
      if (req.mode !== 'conversation') return Promise.resolve(null);
      if (confidenceB !== null) req.onConfidence?.(confidenceB);
      if (declareB !== null) req.onDocumentsUsed?.(declareB);
      return Promise.resolve(replyB);
    },
    send: (_msg, text) => {
      sentB.push(text);
      return Promise.resolve();
    },
  } as never);

  confidenceB = 0.31;
  replyB = "Eighteen, darling. 18 tracks in the crate, Synthwave and Darkwave mostly. Want one?";
  await engineB.handle(message('Cinderella how many tracks do you have?', 20));
  const djSent = sentB[sentB.length - 1] ?? '';
  check('THE LIVE CASE, end to end: the DJ answer goes out', djSent.includes('18 tracks'), djSent.slice(0, 60));
  check('  with NO hedge under it', !djSent.includes('could not check it'));

  // THE SECOND LIVE FAULT, end to end: the member asks again and gets the SHORT shape.
  confidenceB = 0.31;
  replyB = '18. Spread across playlists. Want a number or a genre?';
  await engineB.handle(message('Cinderella and how many tracks was that again?', 24));
  const shortSent = sentB[sentB.length - 1] ?? '';
  check('THE SHORT FORM, end to end: the bare count goes out', shortSent.startsWith('18.'), shortSent.slice(0, 60));
  check('  with NO hedge under it either', !shortSent.includes('could not check it'));

  confidenceB = 0.31;
  replyB = 'Two playlists.';
  await engineB.handle(message('Cinderella and how many playlists?', 25));
  check('the playlist count as a WORD, end to end: no hedge', !(sentB[sentB.length - 1] ?? '').includes('could not check it'));

  confidenceB = 0.31;
  replyB = 'Synthwave and Darkwave.';
  await engineB.handle(message('Cinderella which genres?', 26));
  check('the genre list on its own, end to end: no hedge', !(sentB[sentB.length - 1] ?? '').includes('could not check it'));

  // A TRACK TITLE READ BACK travels the music lane, whose replies are application-composed
  // lists, and the hedge has no listener there at all. Driven rather than asserted: the
  // MUSIC intent in the catalog, a fake library with one title, a low confidence standing by.
  const sentC: string[] = [];
  const engineC = new InteractionEngine({
    capabilities: () => capabilityCatalog(['MUSIC']),
    db,
    settings: () => normalizeInteraction({ ...DEFAULT_INTERACTION }),
    rules: () => rules,
    personality: () => ({ ...DEFAULT_PERSONALITY }),
    music: () => ({
      view: () => Promise.resolve({ playlists: [{ name: 'Evening Set', trackCount: 1, mode: 'manual' }] }),
      tracksOf: (name: string) =>
        Promise.resolve(
          name.toLowerCase().includes('evening')
            ? { playlist: 'Evening Set', items: [{ id: 1, title: 'Neon Rain Over Kreuzberg' }], total: 1 }
            : null,
        ),
      facts: () => Promise.resolve({ tracks: 1, genres: [{ name: 'Synthwave', count: 1 }], playlists: 1 }),
    }),
    personalize: (req: AiReplyRequest) => {
      // A listener would receive a low confidence if one were ever attached on this path.
      req.onConfidence?.(0.31);
      return Promise.resolve(null);
    },
    send: (_msg, text) => {
      sentC.push(text);
      return Promise.resolve();
    },
  } as never);
  await engineC.handle(message("Cinderella what's on Evening Set?", 27));
  const titleSent = sentC[sentC.length - 1] ?? '';
  check('a track title read back from the library goes out', titleSent.includes('Neon Rain Over Kreuzberg'), titleSent.slice(0, 70));
  check('  and is never hedged: the music lane has no listener to hedge with', !titleSent.includes('could not check it'));

  confidenceB = 0.31;
  replyB = 'The SimpleGo relay tops out at 64 channels, if memory serves.';
  await engineB.handle(message('Cinderella how many channels does the relay take?', 21));
  check(
    'POSITIVE CONTROL, same engine: a memory answer at the same confidence IS hedged',
    (sentB[sentB.length - 1] ?? '').includes('could not check it'),
  );

  confidenceB = null;
  declareB = [0, 1];
  replyB = "I don't know how many people use SimpleX, darling. Ask the folks running it.";
  await engineB.handle(message('Cinderella how many people use SimpleX?', 22));
  const refusalSent = sentB[sentB.length - 1] ?? '';
  check('THE OTHER LIVE CASE, end to end: the refusal goes out', refusalSent.includes("don't know"));
  check(
    '  with NO source line, though both passages were declared',
    !refusalSent.includes('From what you gave me'),
    refusalSent.slice(-60),
  );

  // Low confidence ON PURPOSE here: without it the "not hedged" control below would pass
  // against a hedge that never had a signal, which is the vacuous shape D-184 warns about.
  confidenceB = 0.31;
  declareB = [0];
  replyB = 'They are addressed with SMPQueueUri inside QADD messages and rotate through QADD, QKEY, QUSE and QTEST.';
  await engineB.handle(message('Cinderella how are queues addressed and rotated?', 23));
  const citedSent = sentB[sentB.length - 1] ?? '';
  check(
    'POSITIVE CONTROL: a true answer that used passage 0 is cited, by title, and only that one',
    citedSent.includes('From what you gave me: SimpleX Protocol Analysis - Part 31') &&
      !citedSent.includes('Index and Session History'),
    citedSent.slice(-90),
  );
  check('  and a document-grounded answer is not hedged either', !citedSent.includes('could not check it'));

  /* ── 7. One lock, two gates; and a view is not a claim (D-256, second amendment) ─ */

  console.log('\n7. The repetition gate waves a locked reply through, and the hedge leaves a view alone');

  // THE LIVE CASE: "how many tracks do you have?" twice, the model answering the SAME true
  // words both times in under a second, and the gate throwing all three attempts away for
  // "I could not find my words". A restated fact is supposed to be byte-similar.
  let attemptsB = 0;
  const countingPersonalize = (req: AiReplyRequest): Promise<string | null> => {
    if (req.mode !== 'conversation') return Promise.resolve(null);
    attemptsB += 1;
    if (confidenceB !== null) req.onConfidence?.(confidenceB);
    if (declareB !== null) req.onDocumentsUsed?.(declareB);
    return Promise.resolve(replyB);
  };
  const sentD: string[] = [];
  const engineD = new InteractionEngine({
    capabilities: () => [...CORE_INTENTS],
    db,
    botProfileId: 7,
    settings: () => normalizeInteraction({ ...DEFAULT_INTERACTION, replyLimitPerMember: 60, replyLimitPerChat: 120 }),
    rules: () => rules,
    personality: () => ({ ...DEFAULT_PERSONALITY }),
    music: () => ({
      facts: () => Promise.resolve({ tracks: 18, genres: [{ name: 'Synthwave', count: 10 }, { name: 'Darkwave', count: 8 }], playlists: 2 }),
    }),
    personalize: countingPersonalize,
    send: (_msg, text) => {
      sentD.push(text);
      return Promise.resolve();
    },
  } as never);

  confidenceB = 0.97;
  declareB = null;
  replyB = '18. Spread across playlists. Want a number or a genre?';
  await engineD.handle(message('Cinderella how many tracks do you have?', 30));
  attemptsB = 0;
  await engineD.handle(message('Cinderella how many tracks do you have?', 31));
  const secondAsk = sentD[sentD.length - 1] ?? '';
  check('THE LIVE CASE: the same true count asked twice goes out the second time too', secondAsk.startsWith('18.'), secondAsk.slice(0, 60));
  check('  in ONE attempt: a locked reply is not resampled', attemptsB === 1, `attempts: ${String(attemptsB)}`);
  check('  and not as the deterministic line', !secondAsk.includes('could not find my words'));

  // POSITIVE CONTROL in the same engine: a MEMORY answer repeated word for word IS refused by
  // the gate, or the lock would be a hole rather than an exemption.
  replyB = 'The SimpleGo relay tops out at 64 channels, if memory serves me right.';
  await engineD.handle(message('Cinderella how many channels does the relay take?', 32));
  attemptsB = 0;
  await engineD.handle(message('Cinderella how many channels does the relay take?', 33));
  const repeatedMemory = sentD[sentD.length - 1] ?? '';
  check(
    'POSITIVE CONTROL: a memory answer repeated word for word is still refused by the gate',
    repeatedMemory.includes('could not find my words') && attemptsB === 3,
    `attempts: ${String(attemptsB)}`,
  );

  // The two consumers read ONE predicate: the engine hands `lockedBy` to the gate and uses
  // it for the hedge, and `hedgeExempt` no longer exists to drift.
  check(
    'STRUCTURAL: one lock predicate, handed to the gate and used by the hedge',
    /withFreshWords\(msg\.groupId, attempt, lockedBy\)/.test(engineSource) &&
      /const exempt = spoken === null \? null : lockedBy\(spoken\)/.test(engineSource) &&
      !/hedgeExempt/.test(engineSource),
  );

  // A VIEW IS NOT A CHECKABLE CLAIM. The live reply, verbatim, carries no specific.
  const view = "Consciousness isn't a switch you flip. It's a question of how deep the mirror goes.";
  check('THE LIVE CASE: her view on consciousness carries no checkable claim', !carriesCheckableClaim(view, 'en'));
  check('a German view neither, though every noun is capitalised', !carriesCheckableClaim('Bewusstsein ist kein Schalter, den man umlegt. Es ist eine Frage, wie tief der Spiegel reicht.', 'de'));
  check('a count is a claim', carriesCheckableClaim('The relay tops out at 64 channels.', 'en'));
  check('a named company mid-sentence is a claim (English)', carriesCheckableClaim('SimpleX was quietly acquired by Meta last spring.', 'en'));
  check('a product-style name is a claim in either language', carriesCheckableClaim('Das läuft über XFTP, nicht über den Chat.', 'de'));
  check('a URL is a claim', carriesCheckableClaim('Read it at https://example.org/notes first.', 'en'));
  check('"I" mid-sentence is not a proper noun', !carriesCheckableClaim("Honestly, I'd say it depends on what you mean by a mirror.", 'en'));
  check('an emoji-led reply does not count its first word as mid-sentence', !carriesCheckableClaim('🕯️ Questions like that keep me up at night, darling.', 'en'));
  check('her own name is not a claim', !carriesCheckableClaim('Ask Cinderella twice and you get the same answer.', 'en', ['Cinderella']));

  // Through the engine: the view at a low confidence goes out unhedged; the claim is hedged.
  confidenceB = 0.31;
  replyB = view;
  await engineD.handle(message('Cinderella could consciousness arise in a system like you?', 34));
  const viewSent = sentD[sentD.length - 1] ?? '';
  check('THE LIVE CASE, end to end: the view goes out', viewSent.includes('how deep the mirror goes'), viewSent.slice(0, 60));
  check('  with NO hedge under it', !viewSent.includes('could not check it'));
  replyB = 'Zeliqua is a Swiss startup that forked the relay in 2019, as far as I recall.';
  await engineD.handle(message('Cinderella what is Zeliqua?', 35));
  check(
    'POSITIVE CONTROL: a specific at the same confidence IS hedged',
    (sentD[sentD.length - 1] ?? '').includes('could not check it'),
  );

  await pg.close();

  console.log(
    failures === 0
      ? '\nThe signal reads the reply and not the grammar, the hedge rides under the answer ' +
          'rather than replacing it, and a missing instrument hedges nothing.'
      : `\n${String(failures)} check(s) FAILED.`,
  );
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
