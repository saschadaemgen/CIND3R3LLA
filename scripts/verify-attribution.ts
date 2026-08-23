/**
 * Where the answer came from (CCB-S5-055 stage 1, D-243).
 *
 * ── THE ONE THING THE BRIEFING ASKS FOR BY NAME ──────────────────────────────
 *
 * "A mutation-proven check that fails if an attribution can name a document the answer did
 * not use." That is section 3, and the mutation is the shipped defect restored: attribute
 * from what was HANDED OVER instead of from what was declared, and watch the emoji, the
 * translation and the deploy log each acquire a citation again.
 *
 * ── WHY EVERY NEGATIVE HAS A POSITIVE BESIDE IT ──────────────────────────────
 *
 * "No document is named" is satisfied by an implementation that names nothing ever, which is
 * what the tree did for one day between CCB-S5-056 and this. So every assertion that a line
 * is ABSENT sits next to one proving a line still ARRIVES when the answer really used a
 * document. Neither is worth anything alone.
 *
 * ── AND THE TWO HALVES ARE TESTED SEPARATELY, ON PURPOSE ─────────────────────
 *
 * The upstream half (`shouldRetrieve`) decides whether the corpus is consulted at all. The
 * downstream half (`attributionForUsed`) decides whether anything is named. The operator
 * asked for both because either alone leaves a hole: without the gate the announcement still
 * fires for a deploy log, and without the declaration a retrieved-but-unused document is
 * still cited. Sections 1 and 2 prove they are independent.
 *
 *   npx tsx scripts/verify-attribution.ts
 */

import { readFileSync } from 'node:fs';

import {
  attributionForUsed,
  asksAboutSelf,
  documentsHanded,
  hasRetrievableContent,
  looksLikeAQuestion,
  shouldRetrieve,
  type RetrievalOutcome,
  type ScoredCandidate,
} from '../src/knowledge/retrieval.js';

let failures = 0;
function check(label: string, ok: boolean, detail = ''): void {
  if (!ok) failures++;
  console.log(`  [${ok ? 'PASS' : 'FAIL'}] ${label}${detail ? ` - ${detail}` : ''}`);
}

/** The two documents that produced 31 of the 38 production sightings. */
const README = 'SimpleGo README';
const SS7 = 'SS7 Attack Notable Incidents and Regulatory Response';

function outcomeOf(titles: readonly string[]): RetrievalOutcome {
  const selected = titles.map(
    (t, i) =>
      ({
        chunkId: i + 1,
        documentId: titles.indexOf(t) + 1,
        documentTitle: t,
        documentWeight: 1,
        body: `passage ${String(i)}`,
        vectorScore: 0.7,
        vectorRank: i,
        keywordRank: null,
        fusedScore: 1,
        finalScore: 1,
        selected: true,
      }) as unknown as ScoredCandidate,
  );
  return { candidates: selected, selected, charsUsed: 0, emptyBecauseOfFloor: false };
}

function main(): void {
  console.log('Where the answer came from (CCB-S5-055, D-243)');

  /* ── 1. the upstream half: what may reach the corpus at all ──────────────── */

  console.log('\n1. A message that is not asking anything does not retrieve');

  // THE PRODUCTION CASES, in the operator's own words, each one an emission that happened.
  const refused: [string, string][] = [
    ['a pasted deploy log', 'CIND3R3LLA Alpha Testing → migrate Applying migration 071 restart'],
    ['an acknowledgement', 'Correction accepted.'],
    ['thanks', "You're welcome."],
    ['a greeting', 'Heard that, plug me in.'],
    ['a bare statement whose copula is not an inversion', 'Aktivity Stream is live.'],
    ['a statement containing "was"', 'That was the last one I sent.'],
    ['a compliment', 'You are doing well today.'],
    ['a reaction', '❤️'],
    ['a two-letter answer', 'ok'],
  ];
  for (const [label, text] of refused) {
    check(`${label} does not reach the corpus`, !shouldRetrieve(text, false), JSON.stringify(text.slice(0, 40)));
  }

  // THE POSITIVE CONTROLS. Without these, a predicate that refused everything would pass
  // every assertion above, and she would stop knowing what the operator gave her.
  console.log('\n1b. A real question still does');
  const admitted: [string, string][] = [
    ['an inverted auxiliary leading the message', 'Is SimpleX still maintained'],
    ['a German inversion', 'Ist der SMP frame immer gleich gross'],
    ['a question mark', 'SimpleGo, what is it exactly'],
    ['an English interrogative', 'what does the handover say about the scheduler'],
    ['a German interrogative', 'wie gross ist ein SMP frame'],
    ['an imperative request', 'explain the SEC-05 key derivation'],
    ['a bare technical question', 'how many entries fit in PSRAM?'],
  ];
  for (const [label, text] of admitted) {
    check(`${label} reaches the corpus`, shouldRetrieve(text, false), JSON.stringify(text.slice(0, 40)));
  }

  console.log('\n1c. Two cases the predicate settles that the floor never could');
  check(
    'a question about HER does not go to his documents',
    !shouldRetrieve('what are your functions?', false),
  );
  check(
    '  and that is the closed set from D-238, not a noun list',
    asksAboutSelf('what are your functions') && !asksAboutSelf('what is an SMP frame'),
  );
  check(
    'an explicit request overrides everything, whatever shape the sentence has',
    shouldRetrieve('check your notes', true) && shouldRetrieve('Correction accepted.', true),
  );
  check(
    '  and the two guards are separate predicates, not one doing both jobs',
    hasRetrievableContent('yes') && !looksLikeAQuestion('yes'),
    'hasRetrievableContent admits "yes"; looksLikeAQuestion refuses it',
  );

  /* ── 2. the downstream half: what may be named ───────────────────────────── */

  console.log('\n2. Only what the answer declared is named');

  const handed = ['doc-A.md', 'doc-B.md', README];
  check('a declaration of nothing names nothing', attributionForUsed(handed, []).length === 0);
  check(
    'THE CONTROL: a declaration of one names exactly that one',
    attributionForUsed(handed, [1]).join() === 'doc-B.md',
  );
  check(
    'two passages from ONE document are named once',
    attributionForUsed([README, README, 'doc-B.md'], [0, 1]).join() === README,
  );
  check('order follows the declaration', attributionForUsed(handed, [2, 0]).join() === `${README},doc-A.md`);

  console.log('\n2b. The declaration cannot ADD a source, only narrow one');
  for (const [label, used] of [
    ['an index past the end', [99]],
    ['a negative index', [-1]],
    ['a non-integer', [1.5]],
    ['NaN', [Number.NaN]],
  ] as [string, number[]][]) {
    check(`${label} is dropped rather than clamped`, attributionForUsed(handed, used).length === 0);
  }
  check(
    '  so a model naming a document it was never given gets nothing',
    attributionForUsed([], [0, 1, 2]).length === 0,
  );
  check(
    '  and a mixed declaration keeps only the valid part',
    attributionForUsed(handed, [0, 99, -1]).join() === 'doc-A.md',
  );

  /* ── 3. THE MUTATION THE BRIEFING ASKS FOR BY NAME ───────────────────────── */

  console.log('\n3. Restoring the shipped defect makes the false citations come back');

  // The shipped behaviour: attribute from what was HANDED OVER. Every production sighting is
  // a turn where retrieval returned something and the answer used none of it.
  const sightings: [string, string][] = [
    ['a heart emoji', SS7],
    ['"Correction accepted"', README],
    ['a Greek translation', README],
    ['a question about music', README],
    ['"what are your functions"', SS7],
    ['the SimpleX roadmap answer', README],
  ];
  let wouldCite = 0;
  let doesCite = 0;
  for (const [, doc] of sightings) {
    const outcome = outcomeOf([doc]);
    // THE MUTATION: name what was handed over.
    if (documentsHanded(outcome).length > 0) wouldCite += 1;
    // THE SHIPPED CODE: name what was declared, and the answer declared nothing.
    if (attributionForUsed([doc], []).length > 0) doesCite += 1;
  }
  check(
    'the OLD rule cites a document in all six production sightings',
    wouldCite === 6,
    `${String(wouldCite)} of 6`,
  );
  check(
    'the NEW rule cites nothing in any of them',
    doesCite === 0,
    `${String(doesCite)} of 6`,
  );
  check(
    '  and this is not because it cites nothing ever',
    attributionForUsed([README], [0]).join() === README,
  );

  /* ── 3b. a snippet is not a page ─────────────────────────────────────────── */

  console.log('\n3b. The web line does not claim the answer came from the page (D-244)');

  // MEASURED on the deployment, and this is why the wording changed. Asked for the latest
  // SimpleX beta, she replied "v7.0. SimpleX public names for channels and businesses
  // (BETA)." - a near-verbatim copy of the serper snippet for the GitHub releases page,
  // whose live content says 7.1. The model could not have known either version: its
  // training predates both. It read a STALE EXCERPT and the application printed the page
  // underneath it.
  //
  // A snippet's age is not knowable. Of the five results that query returns, ONE carries a
  // date field, as the string "3 years ago", and the one that produced the wrong answer
  // carries none. And a date would be the PAGE's publication date in any case: for exactly
  // the pages whose content moves - a releases index, a downloads page - that is meaningless
  // and the CRAWL date is what matters, which no search API returns.
  const persona = readFileSync(new URL('../src/interaction/settings.ts', import.meta.url), 'utf8');
  const leadOf = (line: string): string => {
    const m = new RegExp(`  searchSources: '([^']*)\\{sources\\}',`).exec(line);
    return m?.[1] ?? '';
  };
  const leads = persona
    .split('\n')
    .filter((l) => l.includes('searchSources:') && l.includes('{sources}'))
    .map(leadOf);
  check('both languages carry a web attribution lead', leads.length === 2, leads.join(' | '));
  check(
    'neither claims the answer came FROM the web',
    !leads.some((l) => /from the web|aus dem netz/i.test(l)),
    leads.join(' | '),
  );
  check(
    'both say what it was actually built from',
    leads.every((l) => /previews|Vorschauen/i.test(l)),
  );
  check(
    '  and both say it can be out of date',
    leads.every((l) => /out of date|veraltet/i.test(l)),
  );
  check(
    '  and both point at the page as the thing to check',
    leads.every((l) => /check the page|Prüf die Seite/i.test(l)),
  );
  // THE LEGACY MARKERS STAY PROTECTED, which is the half a reword would quietly lose: her
  // own memory still holds a month of replies carrying the old wording, and she can copy
  // one back. `protected-text.ts` keeps the shipped openers permanently for that reason.
  const protectedText = readFileSync(
    new URL('../src/interaction/protected-text.ts', import.meta.url),
    'utf8',
  );
  check(
    'the OLD wording is still stripped if she writes it from memory',
    /'From the web:'/.test(protectedText) && /'Aus dem Netz:'/.test(protectedText),
  );

  /* ── 4. the wiring, read from the source ─────────────────────────────────── */

  console.log('\n4. The wiring, because a pure function proves nothing on its own');

  const engine = readFileSync(new URL('../src/interaction/engine.ts', import.meta.url), 'utf8');
  const transport = readFileSync(
    new URL('../src/interaction/ollama-reply.ts', import.meta.url),
    'utf8',
  );
  // Since D-256 the declaration passes through the evidence gate first (`attributable`), which
  // can only shrink it: the engine still attributes FROM the declaration and from nothing else.
  check(
    'the engine attributes from the declaration, through the evidence gate',
    /attributable\(\s*declaredDocuments,/.test(engine) &&
      /attributionForUsed\(passageTitles, evidenced\)/.test(engine),
  );
  check(
    '  and prints only when that is non-empty',
    /usedTitles\.length > 0 && spoken !== null/.test(engine),
  );
  check(
    '  and a model that was never asked is a distinct state from one that declared nothing',
    /declaredDocuments === null \|\| spoken === null\s*\? \[\]/.test(engine) &&
      /declared: declaredDocuments === null \? 'not asked'/.test(engine),
  );
  check(
    'the transport asks only when passages are attached',
    /if \(hasDocuments\) request\.onDocumentsUsed/.test(transport),
  );
  check(
    '  and the field is REQUIRED when it is asked for',
    /withDocuments \? \['usedDocuments'\] : \[\]/.test(transport),
  );
  check(
    'the passages are numbered so the declaration has something to point at',
    /\[\$\{String\(i\)\}\] \$\{KNOWLEDGE_FENCE\}/.test(transport),
  );
  check(
    '  and the document NAME still never reaches the model',
    !/referenceDocuments[\s\S]{0,400}documentTitle/.test(transport),
  );
  check(
    'the retrieval gate is in the service, so it holds for every caller',
    /shouldRetrieve\(text, explicitlyAsked\)/.test(
      readFileSync(new URL('../src/knowledge/service.ts', import.meta.url), 'utf8'),
    ),
  );

  console.log(
    failures === 0
      ? '\nRetrieval runs only on a question, attribution names only what the answer declared, ' +
          'and neither alone can produce a citation.'
      : `\n${String(failures)} check(s) FAILED.`,
  );
  process.exit(failures === 0 ? 0 : 1);
}

main();
