/**
 * Where the web-search relevance floor goes (CCB-S5-028, D-183).
 *
 * ── WHY THIS SCRIPT EXISTS AT ALL ────────────────────────────────────────────
 *
 * D-176 records a relevance floor being GUESSED at 0.45, shipped, and found wrong by a live
 * run that printed a document name under an answer about the boiling point of mercury. The
 * number that replaced it was measured. This is the same discipline applied to the second
 * floor, before it ships rather than after, and it exists as a script rather than as a
 * one-off because the number is a property of the embedding model and the shape of the
 * material, both of which can change.
 *
 * ── THE SHAPE OF THE MATERIAL IS NOT THE KNOWLEDGE BASE'S ────────────────────
 *
 * The knowledge base embeds CHUNKS: a thousand characters of connected prose from a document
 * somebody wrote about one thing. Web search embeds a TITLE AND A SNIPPET: about 400
 * characters, written by a stranger to be clicked on. The bands are not the same bands and
 * the floor cannot be assumed to transfer, which is precisely the assumption this script
 * exists to refuse.
 *
 * ── THE BANDS ────────────────────────────────────────────────────────────────
 *
 * Five, and the middle two are the whole difficulty:
 *
 *   `relevant`               answers the question, or plainly bears on it
 *   `adjacent`               same field, does not answer it
 *   `word-match`             shares a word with the question and nothing else - THE DEFECT
 *   `unrelated`              a different universe
 *
 * A floor is usable when it separates `relevant` from everything below it with margin on
 * both sides. The production failure sat in `word-match`: two university pages about
 * amending human-subjects research protocols, returned for a question about a messaging
 * protocol, because the word "protocol" matched.
 *
 *   npm run calibrate:search-relevance
 *
 * Needs Ollama with nomic-embed-text. Prints the bands, the gap, and what the floor would
 * admit and reject at several candidate values.
 */

import { Embedder } from '../src/knowledge/embed.js';
import { cosine, searchRelevanceText } from '../src/plugins/web-search/relevance.js';
import { setLogLevel } from '../src/log.js';

interface Case {
  query: string;
  results: { band: Band; title: string; snippet: string }[];
}

type Band = 'relevant' | 'adjacent' | 'word-match' | 'unrelated';

const BANDS: Band[] = ['relevant', 'adjacent', 'word-match', 'unrelated'];

/**
 * The calibration set.
 *
 * Six queries of deliberately different shapes, because a floor tuned on one shape is a
 * floor that fails on the others: a long technical question, a short one, an everyday
 * question, a question with a proper noun, a question about a current event, and a German
 * one. Every query carries at least one member of each band it can plausibly have.
 *
 * THE FIRST CASE IS THE PRODUCTION FAILURE, reconstructed. The two `word-match` entries are
 * the pages behind `research.uoregon.edu` and `hrpp.research.virginia.edu` in the source line
 * she actually printed.
 */
const CASES: Case[] = [
  {
    query:
      'One SimpleGo protocol says SUB after NEW is required, another says it is a noop. Which is correct for SimpleGo, and where did the clarification come from?',
    results: [
      {
        band: 'relevant',
        title: 'SimpleX Messaging Protocol (SMP) specification: NEW, SUB and SEND commands',
        snippet:
          'The SUB command subscribes the recipient to the queue. After NEW the queue is already subscribed for the creating connection, so an immediate SUB is a no-op and returns OK without further submission.',
      },
      {
        band: 'relevant',
        title: 'SimpleGo protocol notes: is SUB after NEW required?',
        snippet:
          'Clarification: SUB following NEW is not required. NEW returns the queue already subscribed. Older examples in the documentation show an explicit SUB and are superseded.',
      },
      {
        band: 'adjacent',
        title: 'TCP subscription semantics in message queues',
        snippet:
          'A subscribe call after a create call is idempotent in most broker implementations, though some brokers require an explicit acknowledgement before delivery begins.',
      },
      {
        band: 'adjacent',
        title: 'SimpleX Chat: private messaging without user identifiers',
        snippet:
          'SimpleX is the first messaging platform that has no user identifiers of any kind, not even random numbers. It uses unidirectional simplex queues to pass messages.',
      },
      {
        band: 'word-match',
        title: 'Protocol Amendments | Research Compliance Services | University of Oregon',
        snippet:
          'A protocol amendment is required whenever you wish to make changes to an approved human subjects research protocol. Submit the amendment form to the IRB for review before implementing any changes.',
      },
      {
        band: 'word-match',
        title: 'Modifications (Amendments) | Human Research Protection Program',
        snippet:
          'All changes to an approved protocol must be submitted for IRB review and approval prior to implementation, except when necessary to eliminate apparent immediate hazards to the subject.',
      },
      {
        band: 'unrelated',
        title: 'Best pizza in Naples: 12 places locals actually eat',
        snippet:
          'From Da Michele to Sorbillo, here is where to find a proper Neapolitan margherita, with wood-fired crusts and San Marzano tomatoes.',
      },
    ],
  },
  {
    query: 'what is the boiling point of mercury',
    results: [
      {
        band: 'relevant',
        title: 'Mercury (element) - Wikipedia',
        snippet:
          'Mercury is a chemical element with symbol Hg and atomic number 80. It melts at -38.83 C and boils at 356.73 C at standard pressure.',
      },
      {
        band: 'adjacent',
        title: 'Thermometers and the history of measuring temperature',
        snippet:
          'Early thermometers used mercury because it expands linearly across a wide range of temperatures and is easy to see in a narrow glass tube.',
      },
      {
        band: 'word-match',
        title: 'Mercury Records signs three new artists this spring',
        snippet:
          'The label announced a new roster today, with releases planned across the summer and a boiling hot festival season ahead.',
      },
      {
        band: 'unrelated',
        title: 'How to repair a bicycle puncture in ten minutes',
        snippet:
          'Remove the wheel, find the hole by submerging the tube, roughen the area and apply the patch firmly for two minutes.',
      },
    ],
  },
  {
    query: 'who won the world cup in 1998',
    results: [
      {
        band: 'relevant',
        title: '1998 FIFA World Cup Final - France 3-0 Brazil',
        snippet:
          'France won their first World Cup on home soil, beating Brazil 3-0 in the final at the Stade de France on 12 July 1998, with two goals from Zinedine Zidane.',
      },
      {
        band: 'adjacent',
        title: 'History of the FIFA World Cup',
        snippet:
          'The tournament has been held every four years since 1930, with the exception of 1942 and 1946. Brazil have won it five times, more than any other nation.',
      },
      {
        band: 'word-match',
        title: 'World Cup coffee roasters: 1998 vintage single origin',
        snippet:
          'Our 1998 cup profile notes describe a winning combination of stone fruit and cocoa, roasted in small batches.',
      },
      {
        band: 'unrelated',
        title: 'Filing a self-assessment tax return before the deadline',
        snippet:
          'Register for self-assessment by 5 October, file online by 31 January, and keep records for at least five years.',
      },
    ],
  },
  {
    query: 'pgvector index types',
    results: [
      {
        band: 'relevant',
        title: 'pgvector: HNSW and IVFFlat index types explained',
        snippet:
          'pgvector supports two index types. IVFFlat divides vectors into lists and searches a subset; HNSW builds a multilayer graph and gives better recall at the cost of build time.',
      },
      {
        band: 'adjacent',
        title: 'Choosing an index for a PostgreSQL text search column',
        snippet:
          'GIN indexes are the usual choice for tsvector columns. GiST is smaller and slower to search but faster to update.',
      },
      {
        band: 'word-match',
        title: 'Vector Index Fund quarterly report',
        snippet:
          'The fund tracks a broad market index and reported a 4.2 percent gain over the quarter, with types of holdings unchanged.',
      },
      {
        band: 'unrelated',
        title: 'Sourdough starter: a week by week guide',
        snippet:
          'Feed equal weights of flour and water daily. By day five the starter should double reliably within six hours.',
      },
    ],
  },
  {
    query: 'wie funktioniert ein waermepumpentrockner',
    results: [
      {
        band: 'relevant',
        title: 'Waermepumpentrockner: Funktionsweise und Stromverbrauch',
        snippet:
          'Ein Waermepumpentrockner fuehrt die warme feuchte Luft nicht nach aussen ab, sondern entzieht ihr im Waermetauscher die Feuchtigkeit und erwaermt sie erneut. Das spart bis zu 50 Prozent Strom.',
      },
      {
        band: 'adjacent',
        title: 'Waschmaschine und Trockner richtig aufstellen',
        snippet:
          'Ein Zwischenbausatz verbindet beide Geraete sicher. Achten Sie auf einen ebenen Untergrund und ausreichend Belueftung.',
      },
      {
        band: 'word-match',
        title: 'Waermepumpe fuer Einfamilienhaeuser: Foerderung 2026',
        snippet:
          'Die Foerderung fuer den Heizungstausch betraegt bis zu 70 Prozent. Antraege werden ueber die KfW gestellt.',
      },
      {
        band: 'unrelated',
        title: 'Die zehn schoensten Wanderwege in den Dolomiten',
        snippet:
          'Von der Seiser Alm bis zu den Drei Zinnen: Routen fuer jedes Niveau, mit Huetten und Einkehrmoeglichkeiten.',
      },
    ],
  },
  {
    query: 'latest release of postgresql',
    results: [
      {
        band: 'relevant',
        title: 'PostgreSQL: Release notes and current version',
        snippet:
          'The PostgreSQL Global Development Group has released version 18.2, a maintenance release fixing 34 bugs reported over the last three months.',
      },
      {
        band: 'adjacent',
        title: 'PostgreSQL versioning policy',
        snippet:
          'Each major version is supported for five years after its initial release. Minor releases appear quarterly and require only a restart.',
      },
      {
        band: 'word-match',
        title: 'Release your inner elephant: a yoga sequence for beginners',
        snippet:
          'The latest sequence in our series focuses on hip openers, with a slow release through the lower back.',
      },
      {
        band: 'unrelated',
        title: 'Refinishing hardwood floors without sanding',
        snippet:
          'A chemical abrasion kit removes the old finish without dust, though it will not level a badly worn board.',
      },
    ],
  },
];

const CANDIDATES = [0.5, 0.55, 0.6, 0.65, 0.68, 0.7, 0.72, 0.75];

async function main(): Promise<void> {
  setLogLevel('error');
  const baseUrl = process.env['LOCAL_AI_BASE_URL'] ?? 'http://127.0.0.1:11434';
  const embedder = new Embedder({ config: { baseUrl, timeoutMs: 120_000 } });

  const scored: { band: Band; score: number; query: string; title: string }[] = [];

  for (const testCase of CASES) {
    const queryVector = await embedder.embedQuery(testCase.query);
    const vectors = await embedder.embedDocuments(
      testCase.results.map((r) => searchRelevanceText(r)),
    );
    testCase.results.forEach((result, i) => {
      const vector = vectors[i];
      if (!vector) throw new Error('no vector');
      scored.push({
        band: result.band,
        score: cosine(queryVector, vector),
        query: testCase.query,
        title: result.title,
      });
    });
    console.log(`\n${testCase.query.slice(0, 76)}`);
    testCase.results
      .map((r, i) => ({ band: r.band, title: r.title, score: cosine(queryVector, vectors[i] as number[]) }))
      .sort((a, b) => b.score - a.score)
      .forEach((r) => console.log(`  ${r.score.toFixed(4)}  ${r.band.padEnd(11)}  ${r.title.slice(0, 62)}`));
  }

  console.log('\n\nBANDS across every case');
  for (const band of BANDS) {
    const values = scored.filter((s) => s.band === band).map((s) => s.score).sort((a, b) => a - b);
    if (values.length === 0) continue;
    const min = values[0] as number;
    const max = values[values.length - 1] as number;
    const mean = values.reduce((a, b) => a + b, 0) / values.length;
    console.log(
      `  ${band.padEnd(11)} n=${String(values.length).padStart(2)}  min ${min.toFixed(4)}  mean ${mean.toFixed(4)}  max ${max.toFixed(4)}`,
    );
  }

  const relevantMin = Math.min(...scored.filter((s) => s.band === 'relevant').map((s) => s.score));
  const restMax = Math.max(...scored.filter((s) => s.band !== 'relevant').map((s) => s.score));
  console.log(
    `\n  lowest RELEVANT  ${relevantMin.toFixed(4)}` +
      `\n  highest NON-relevant ${restMax.toFixed(4)}` +
      `\n  gap ${(relevantMin - restMax).toFixed(4)}${relevantMin > restMax ? '' : '  <-- THE BANDS OVERLAP, no single floor separates them'}`,
  );

  console.log('\n\nWHAT EACH CANDIDATE FLOOR WOULD DO');
  console.log('  floor   relevant kept   adjacent kept   word-match kept   unrelated kept');
  for (const floor of CANDIDATES) {
    const kept = (band: Band): string => {
      const all = scored.filter((s) => s.band === band);
      const pass = all.filter((s) => s.score >= floor).length;
      return `${String(pass)}/${String(all.length)}`;
    };
    const flag =
      scored.filter((s) => s.band === 'relevant' && s.score < floor).length > 0
        ? '   <- drops a relevant result'
        : scored.filter((s) => s.band !== 'relevant' && s.score >= floor).length === 0
          ? '   <- clean separation'
          : '';
    console.log(
      `  ${floor.toFixed(2)}    ${kept('relevant').padEnd(14)}  ${kept('adjacent').padEnd(14)}  ${kept('word-match').padEnd(16)}  ${kept('unrelated')}${flag}`,
    );
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
