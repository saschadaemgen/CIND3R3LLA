/**
 * The deterministic rule-based intent resolver (CCB-S3-002 §3).
 *
 * No AI. Per-intent keyword and phrase sets in English AND German — the wake
 * word is language-agnostic, so the instruction after it can be in either — are
 * matched against the normalised instruction with typo tolerance, scored, and
 * guarded.
 *
 * Three properties are worth stating, because they are what keep this honest:
 *
 *  - **Phrases outrank keywords.** `stop publishing` must not be read as
 *    `publish` with a stray word in front of it, so a longer contiguous match
 *    always scores above a single keyword.
 *  - **Doubt is expressed as UNKNOWN, not as a guess.** A negation next to the
 *    keyword, a hypothetical framing (`what happens if I say ...`), or a keyword
 *    inside quotation marks collapses the score. Asking again is cheap;
 *    publishing someone who did not ask is not.
 *  - **Nothing here executes anything.** The result is a report. The engine
 *    decides what to do with it, and the consent code decides whether that is
 *    allowed.
 */

import {
  inCatalog,
  unknownResult,
  type Intent,
  type IntentContext,
  type IntentResolver,
  type IntentResult,
  type IntentSlots,
} from './intent.js';
import {
  fuzzyEquals,
  detectLanguageFromTokens,
  isQuoted,
  normTokens,
  quotedRanges,
  tokenize,
  type Token,
} from './text.js';
import { parseAmountAt, unitMultiplier } from '../price/amount.js';

/* ── Lexicon ─────────────────────────────────────────────────────────────── */

interface LexEntry {
  intent: Exclude<Intent, 'UNKNOWN'>;
  lang: string;
  /** Multi-word forms. Score higher than keywords, longest first. */
  phrases: string[];
  /** Single words. */
  keywords: string[];
}

const LEXICON: LexEntry[] = [
  {
    intent: 'PUBLISH',
    lang: 'en',
    phrases: [
      'publish me',
      'publish my messages',
      'publish my stuff',
      'publish my words',
      'publish my posts',
      'publish everything',
      'opt me in',
      'opt in',
      'sign me up',
      'count me in',
      'make me public',
      'go public',
      'put me in the archive',
      'add me to the archive',
      'you can publish',
      'you may publish',
      'i want to be published',
      'i want to publish',
    ],
    keywords: ['publish', 'publishing', 'publicise', 'publicize'],
  },
  {
    intent: 'PUBLISH',
    lang: 'de',
    phrases: [
      'veröffentliche mich',
      'veröffentliche meine nachrichten',
      'veröffentliche meine sachen',
      'veröffentliche alles',
      'nimm mich auf',
      'melde mich an',
      'ich möchte veröffentlichen',
      'ich will veröffentlichen',
      'du darfst veröffentlichen',
      'mach mich öffentlich',
      'gib mich frei',
    ],
    keywords: ['veröffentlichen', 'veröffentliche', 'veröffentlicht', 'freigeben', 'freigabe'],
  },
  {
    intent: 'UNPUBLISH',
    lang: 'en',
    phrases: [
      'unpublish me',
      'opt me out',
      'opt out',
      'take it back',
      'take me out',
      'take me off',
      'take my words back',
      'remove me',
      'remove me from the archive',
      'delete me from the archive',
      'hide me',
      'stop publishing',
      'stop publishing me',
      'withdraw my consent',
      'withdraw me',
      'i want out',
      'get me out',
      'no longer public',
    ],
    keywords: ['unpublish', 'unpublishing', 'withdraw', 'retract'],
  },
  {
    intent: 'UNPUBLISH',
    lang: 'de',
    phrases: [
      'widerrufe meine zustimmung',
      'widerruf meine zustimmung',
      'nimm mich raus',
      'nimm mich heraus',
      'melde mich ab',
      'lösche mich aus dem archiv',
      'entferne mich aus dem archiv',
      'verberge mich',
      'nimm es zurück',
      'nimm alles zurück',
      'hör auf zu veröffentlichen',
      'ich will raus',
      'mach mich unsichtbar',
    ],
    keywords: [
      'widerrufen',
      'widerrufe',
      'widerruf',
      'abmelden',
      'zurückziehen',
      'zurücknehmen',
      'verbergen',
    ],
  },
  // RESTORE (CCB-S3-013): bringing HIDDEN content back into the public archive.
  // Only ever reaches content the member chose to hide; a destruction has nothing
  // to restore, and the engine says so rather than pretending.
  //
  // These phrases are kept clear of the UNPUBLISH set above on purpose. "hide me"
  // and "verberge mich" mean take it down; "bring my words back" means put it up.
  // A collision here would be a consent bug, not a wording bug.
  {
    intent: 'RESTORE',
    lang: 'en',
    phrases: [
      'restore my words',
      'restore me',
      'bring my words back',
      'bring them back',
      'bring it back',
      'put my words back',
      'unhide me',
      'show my words again',
      'publish them again',
    ],
    keywords: ['restore', 'unhide'],
  },
  {
    intent: 'RESTORE',
    lang: 'de',
    phrases: [
      'hole meine worte zurück',
      'hol meine worte zurück',
      'stelle meine worte wieder her',
      'stell meine worte wieder her',
      'zeig meine worte wieder',
      'mach sie wieder sichtbar',
      'bring sie zurück',
      'wieder veröffentlichen',
    ],
    keywords: ['wiederherstellen', 'zurückholen'],
  },
  {
    intent: 'STATUS',
    lang: 'en',
    phrases: [
      'what do you have on me',
      'what do you have of mine',
      'what do you keep of mine',
      'what have you got on me',
      'what do you know about me',
      'am i opted in',
      'am i published',
      'am i public',
      'what is my status',
      'how many messages do you have',
      'do you have anything on me',
      'do you have anything of mine',
      'show me my status',
      'whats my publish status',
      'what is my publish status',
      'my publish status',
      'publish status',
      'publication status',
      'my status',
    ],
    keywords: ['status', 'statistics', 'stats', 'numbers'],
  },
  {
    intent: 'STATUS',
    lang: 'de',
    phrases: [
      'was hast du über mich',
      'was hast du von mir',
      'was bewahrst du von mir',
      'was weißt du über mich',
      'bin ich angemeldet',
      'bin ich veröffentlicht',
      'bin ich öffentlich',
      'wie ist mein status',
      'wie viele nachrichten hast du',
      'mein status',
      'mein veroeffentlichungsstatus',
      'veroeffentlichungsstatus',
    ],
    keywords: ['status', 'statistik', 'statistiken', 'zahlen'],
  },
  // ── THE ARCHIVE IS EXPLICIT-ONLY, LIKE THE WEB (CCB-S5-026) ────────────────
  //
  // Every phrase here must SAY WHERE: the archive, the chat, the group, or the group's own
  // past in a form that can mean nothing else. There are NO keywords, and that is the whole
  // change: a bare `search` or `find` anywhere in a sentence used to score toward the
  // archive, and `search for` / `suche nach` claimed any request to look for anything.
  //
  // This completes CCB-S4-041 rather than reversing it. That briefing took `search for` OUT
  // of the web list with the reason that "a bare search verb is not a statement about where
  // to look", and applied the principle to one side only. It is not a statement about the
  // archive either. What is left over now falls to conversation, which is where the
  // knowledge base is consulted, so the three lookups stop competing for the same words.
  //
  // The test for admission is the one the web list already passes: `google` contains no "web"
  // and names the place beyond doubt. `what did we say about` contains no "archive" and names
  // this group's own history beyond doubt. Literal keywords are not the standard; being
  // unmistakable about WHERE is.
  {
    intent: 'SEARCH',
    lang: 'en',
    phrases: [
      'search the archive for',
      'search the archive',
      'search the chat archive',
      'search the chat history',
      'search the chat',
      'search the group',
      'search this group',
      'look through the archive for',
      'look through the archive',
      'look in the archive',
      // Named by meaning rather than by the word "archive", which is what members type.
      'what did we say about',
      'what did anyone say about',
      'what has been said about',
      'did we talk about',
      'have we talked about',
      'did anyone mention',
      'has anyone mentioned',
      'did anyone post',
      'has anyone posted',
    ],
    keywords: [],
  },
  {
    intent: 'SEARCH',
    lang: 'de',
    // GERMAN NEEDS MORE OF THESE, NOT FEWER. `suche nach` is the ordinary way to say it and
    // it is going, so without natural replacements the capability would survive in English
    // and quietly disappear for German members. Every phrase is CONTIGUOUS, because
    // `findWindow` matches a token window: German separable constructions like
    // "hat jemand X erwähnt" cannot be a pattern, so the forms below all put the topic last.
    phrases: [
      'durchsuche das archiv nach',
      'durchsuche das archiv',
      'suche im archiv nach',
      'suche im archiv',
      'such im archiv',
      'such mal im archiv',
      'durchsuche die gruppe',
      'durchsuche den chat',
      'durchsuche den verlauf',
      'suche in der gruppe',
      'suche im chat',
      'suche im verlauf',
      // The natural spoken forms. The topic follows and a participle usually trails it,
      // which `extractQuery` strips: `websearch_to_tsquery` ANDs its terms, so a stray
      // "gesagt" would require that word to appear in the message and return nothing.
      'was haben wir über',
      'was haben wir hier über',
      'was wurde hier über',
      'was wurde über',
      'haben wir über',
      'hat jemand über',
      'hat hier jemand über',
    ],
    keywords: [],
  },
  {
    intent: 'HELP',
    lang: 'en',
    phrases: [
      'what can you do',
      'what do you do',
      'how do i use you',
      'can you help me',
      'what are your commands',
      'how does this work',
      'how do you work',
      'what are you for',
      'who are you',
    ],
    keywords: ['help', 'commands'],
  },
  {
    intent: 'HELP',
    lang: 'de',
    phrases: [
      'was kannst du',
      'was machst du',
      'wie funktioniert das',
      'kannst du mir helfen',
      'welche befehle',
      'wie benutze ich dich',
      'wofür bist du da',
      'wer bist du',
    ],
    keywords: ['hilfe', 'befehle'],
  },
  /**
   * LOOKUP: the web-search trigger (CCB-S4-037, D-141).
   *
   * ── WHY THE TRIGGER IS HERE AND NOT IN THE MODEL ─────────────────────────
   *
   * The briefing asked for it to be deterministic and inspectable, and this file is where
   * every other decision in this system already is. An operator can read these phrases,
   * the resolver can be driven over them offline, and a check can assert exactly which
   * sentences do and do not cost an outbound request. A model deciding for itself when to
   * search would be a model deciding when to spend the operator's money and when to pull
   * a stranger's text into its own prompt.
   *
   * ── EXPLICIT FIRST, AND THAT IS THE PART THAT MATTERS ────────────────────
   *
   * The phrases below are all EXPLICIT REQUESTS: somebody asking her to look something
   * up, search for it, or google it. They are unambiguous, they are what the briefing
   * calls the clearest trigger, and they are the whole of the shipped trigger.
   *
   * There is deliberately NO "this looks like it wants current information" heuristic.
   * Such a rule fires on ordinary conversation, and the cost of a false positive here is
   * not a clumsy answer: it is an outbound request, a bill, and untrusted text entering
   * the prompt. When somebody says "I wonder what the weather is doing", she should talk
   * to them, not silently query a search API. The operator can see the trigger, and
   * widening it is a decision for somebody who is watching the bill.
   */
  {
    intent: 'LOOKUP',
    lang: 'en',
    phrases: [
      'look up',
      'look that up',
      'search the web for',
      'search the web',
      'search online for',
      'search online',
      // CCB-S4-041. 'search for' was here from CCB-S4-037 and does not name the web at
      // all. The archive SEARCH legitimately owns it, and once an explicit web verb took
      // precedence over SEARCH, "search for pizza" stopped reaching the archive.
      //
      // ── THE BAR HERE IS NOT THE ARCHIVE'S, AND THE COMMENT USED TO SAY IT WAS ──
      //
      // It read: "Every phrase in this list must SAY web, online, internet or google; a bare
      // search verb is not a statement about where to look. Caught by verify:interaction."
      // BOTH HALVES WERE FALSE (CCB-S5-028). Six of the phrases below name no place at all -
      // `look up`, `look that up`, `find out about`, `find out what`, `can you look`,
      // `could you look`, plus `finde heraus` and `recherchiere` - and no check anywhere
      // asserted anything about this list; `verify:interaction` never mentioned LOOKUP. A
      // stated invariant, a named check that does not exist, and a list already violating it,
      // which is the D-162 shape in the file a gate was about to be built out of.
      //
      // The real bar, and the one `asksToLookItUp` enforces, is **an explicit instruction to
      // GO AND LOOK**. `look up` names nowhere and is unmistakably a request to go; "which is
      // correct, and where did the clarification come from?" is a question, and questions are
      // conversation. That is the same distinction the archive list draws between naming a
      // place and containing a keyword, applied to the verb instead of to the noun.
      'google',
      'web search',
      'find out about',
      'find out what',
      'find out if',
      'can you look',
      'could you look',
      'check the web',
      'check online',
      'check the internet',
      'what does the internet say',
      'what does the web say',
      // The windows are CONTIGUOUS (findWindow), so 'look up' cannot absorb an
      // object between its tokens: 'look it up' matched NOTHING while 'look
      // that up' did, and a member asking in the most natural English there
      // is was answered with an offer instead of a search. Each object form
      // is its own phrase for that reason, not out of caution.
      'look it up',
      'look this up',
      'look them up',
      'look him up',
      'look her up',
      'search it up',
      'search the internet',
      'search the internet for',
    ],
    keywords: [],
  },
  {
    intent: 'LOOKUP',
    lang: 'de',
    phrases: [
      'schau nach',
      'schau mal nach',
      'schlag nach',
      'such im netz',
      'such im internet',
      'suche im netz',
      'suche im internet',
      'im internet suchen',
      'google mal',
      'googel mal',
      'kannst du nachschauen',
      'kannst du nachsehen',
      'kannst du mal nachschauen',
      'kannst du mal nachsehen',
      'kannst du googeln',
      'kannst du das nachschlagen',
      'guck mal nach',
      'guck nach',
      'schau mal im internet',
      'schau im internet',
      'such mal im netz',
      'such mal im internet',
      'schlag mal nach',
      'finde heraus',
      'recherchiere',
      'recherchier mal',
    ],
    keywords: [],
  },
  {
    // CCB-S5-044. The library's asks. Multi-word windows on purpose: a bare
    // "play" claims "play fair"; "play me something" claims only itself.
    intent: 'MUSIC',
    lang: 'en',
    phrases: [
      'which playlists',
      'what playlists',
      'your playlists',
      'list your playlists',
      'what is on',
      'whats on',
      'play me something',
      'play something',
      'play me',
      'play the',
      'play a',
      // Bare 'play': these patterns only ever see a message ADDRESSED to her
      // (wake word or follow-up), and "CIND3R3LLA play X" is a music ask
      // whatever X is; the handler answers honestly when X is nothing she holds.
      'play',
      'next track',
      'make it playable',
      'make this playable',
      'make that playable',
      'make my file playable',
      'play my file',
      'play it back',
    ],
    // 'music' and 'genre' joined after the live test (D-220): "do you have
    // Chillstep Music" named her whole capability and never reached this lane,
    // so the model answered against no data and denied a genre she holds.
    // Addressed-only messages make the wide net safe: the lane's tail answers
    // per question since D-221 - a genre card, a listing, an honest miss -
    // and falls back to the locked overview only when nothing was named.
    keywords: ['playlist', 'track', 'song', 'tune', 'audiobook', 'music', 'genre', 'genres'],
  },
  {
    intent: 'MUSIC',
    lang: 'de',
    phrases: [
      'welche playlists',
      'deine playlists',
      'was ist auf',
      'was liegt auf',
      'spiel mir etwas',
      'spiel etwas',
      'spiel mir',
      'spiel die',
      'spiel ein',
      'spiel',
      'spiele',
      'naechster titel',
      'mach das abspielbar',
      'mach die datei abspielbar',
      'spiel meine datei',
    ],
    keywords: ['playlist', 'titel', 'lied', 'song', 'hoerbuch', 'musik', 'genre', 'genres'],
  },
  {
    intent: 'PRICE',
    lang: 'en',
    phrases: [
      'what is the price of',
      'what is the current value of',
      'what is the value of',
      'what is the dollar value of',
      'how much',
      'how many',
      'how much is',
      'how much are',
      'how much do i get for',
      'how much would i get for',
      'price of',
      'value of',
      'worth in',
      'is worth',
      'are worth',
      'convert',
      'exchange rate',
      'rate of',
    ],
    keywords: ['price', 'worth', 'value', 'rate', 'quote'],
  },
  {
    intent: 'PRICE',
    lang: 'de',
    phrases: [
      'was ist ein',
      'was kostet',
      'was kosten',
      'wie viel',
      'wie viele',
      'wie viel ist',
      'wie viel sind',
      'wie viel bekomme ich fuer',
      'wie viel kriege ich fuer',
      'kurs von',
      'preis von',
      'wert von',
      'in euro wert',
      'wert in',
      'umrechnen',
      'wechselkurs',
    ],
    keywords: ['kurs', 'preis', 'wert', 'wechselkurs'],
  },
  {
    intent: 'UNDO',
    lang: 'en',
    phrases: ['undo that', 'undo it', 'revert that', 'undo the last'],
    keywords: ['undo', 'revert'],
  },
  {
    intent: 'UNDO',
    lang: 'de',
    phrases: ['mach das rückgängig', 'mach es rückgängig'],
    keywords: ['rückgängig', 'undo'],
  },
];

interface Pattern {
  intent: Exclude<Intent, 'UNKNOWN'>;
  lang: string;
  tokens: string[];
  phrase: boolean;
}

const PATTERNS: Pattern[] = LEXICON.flatMap((e) => [
  ...e.phrases.map((p) => ({
    intent: e.intent,
    lang: e.lang,
    tokens: normTokens(p),
    phrase: true,
  })),
  ...e.keywords.map((k) => ({
    intent: e.intent,
    lang: e.lang,
    tokens: normTokens(k),
    phrase: false,
  })),
]).filter((p) => p.tokens.length > 0);

/* ── Guards ──────────────────────────────────────────────────────────────── */

/**
 * Framings that make a keyword a description rather than an instruction. These
 * are checked over the WHOLE instruction, not just near the keyword — a member
 * asking `what happens if I say Cinderella publish me` is discussing the bot,
 * not commanding it.
 */
const HYPOTHETICALS = [
  'what happens if',
  'what would happen if',
  'what if',
  'if i say',
  'if i said',
  'if someone says',
  'for example',
  'imagine',
  'hypothetically',
  'just kidding',
  'was passiert wenn',
  'was würde passieren wenn',
  'wenn ich sage',
  'wenn jemand sagt',
  'zum beispiel',
  'stell dir vor',
  'angenommen',
  'nur ein scherz',
].map((h) => normTokens(h));

/** Negations. Applied only OUTSIDE the matched span — see {@link negatedNear}. */
const NEGATIONS = new Set([
  'not',
  'dont',
  'doesnt',
  'didnt',
  'wont',
  'cant',
  'cannot',
  'never',
  'no',
  'nor',
  'neither',
  'without',
  'nicht',
  'nie',
  'niemals',
  'kein',
  'keine',
  'keinen',
  'keinem',
  'nein',
  'ohne',
  'weder',
]);

/** How many tokens either side of the match a negation still poisons. */
const NEGATION_RADIUS = 3;

/**
 * Third-person targets. Deliberately conservative: German `sie`, `er`, `alle`
 * and bare `sein` are NOT here, because they collide with ordinary phrasing
 * (`alle meine Nachrichten` = all MY messages) and a false refusal is a bad
 * enough experience to be worth avoiding.
 */
const THIRD_PARTY_PRONOUNS = new Set([
  'him',
  'his',
  'her',
  'hers',
  'he',
  'she',
  'they',
  'them',
  'their',
  'theirs',
  'us',
  'we',
  'our',
  'ours',
  'everyone',
  'everybody',
  'someone',
  'somebody',
  'ihn',
  'ihm',
  'ihre',
  'ihren',
  'ihrem',
  'ihrer',
  'seine',
  'seinen',
  'seinem',
  'seiner',
  'uns',
  'unsere',
  'unseren',
  'jemand',
  'jemanden',
]);

const FIRST_PERSON = new Set([
  'i',
  'me',
  'my',
  'mine',
  'myself',
  'ich',
  'mich',
  'mir',
  'mein',
  'meine',
  'meinen',
  'meinem',
  'meiner',
  'meins',
]);

/**
 * Ordinary words that happen to be capitalised — every German noun, for a start.
 * A capitalised token in here is never mistaken for somebody's name.
 */
const COMMON_WORDS = new Set(
  [
    // English function words and the nouns these instructions actually use
    'a',
    'an',
    'the',
    'you',
    'your',
    'yours',
    'please',
    'can',
    'could',
    'would',
    'will',
    'shall',
    'do',
    'does',
    'did',
    'to',
    'for',
    'of',
    'on',
    'in',
    'from',
    'with',
    'and',
    'or',
    'but',
    'it',
    'its',
    'that',
    'this',
    'these',
    'those',
    'all',
    'everything',
    'anything',
    'something',
    'thing',
    'things',
    'stuff',
    'message',
    'messages',
    'word',
    'words',
    'post',
    'posts',
    'text',
    'texts',
    'data',
    'archive',
    'public',
    'private',
    'now',
    'again',
    'ok',
    'okay',
    'thanks',
    'thank',
    'yes',
    'no',
    'photo',
    'photos',
    'picture',
    'pictures',
    'image',
    'images',
    'video',
    'videos',
    'link',
    'links',
    'file',
    'files',
    'media',
    'chat',
    'group',
    'here',
    'there',
    'what',
    'when',
    'where',
    'how',
    'why',
    'who',
    'am',
    'is',
    'are',
    'was',
    'were',
    'be',
    'been',
    'have',
    'has',
    'had',
    'want',
    'like',
    'need',
    'about',
    'up',
    'out',
    'off',
    'back',
    'last',
    'next',
    // German
    'ein',
    'eine',
    'einen',
    'einem',
    'einer',
    'der',
    'die',
    'das',
    'den',
    'dem',
    'des',
    'du',
    'dich',
    'dir',
    'dein',
    'deine',
    'bitte',
    'kann',
    'kannst',
    'könnte',
    'würde',
    'wirst',
    'mach',
    'machen',
    'macht',
    'tu',
    'tun',
    'zu',
    'für',
    'von',
    'auf',
    'aus',
    'mit',
    'und',
    'oder',
    'aber',
    'es',
    'dies',
    'diese',
    'alles',
    'alle',
    'sachen',
    'kram',
    'zeug',
    'nachricht',
    'nachrichten',
    'wort',
    'worte',
    'wörter',
    'beitrag',
    'beiträge',
    'daten',
    'archiv',
    'öffentlich',
    'jetzt',
    'nochmal',
    'danke',
    'bild',
    'bilder',
    'foto',
    'fotos',
    'video',
    'videos',
    'medien',
    'datei',
    'dateien',
    'text',
    'texte',
    'ding',
    'dinge',
    'eintrag',
    'einträge',
    'kommentar',
    'kommentare',
    'gruppe',
    'chat',
    'hier',
    'dort',
    'was',
    'wann',
    'wo',
    'wie',
    'warum',
    'wer',
    'bin',
    'ist',
    'sind',
    'war',
    'sein',
    'habe',
    'hast',
    'hat',
    'haben',
    'möchte',
    'will',
    'brauche',
    'über',
    'raus',
    'rein',
    'zurück',
    'letzte',
    'letzten',
    'nächste',
    'ja',
    'nein',
  ].flatMap((w) => normTokens(w)),
);

/** Every word the lexicon itself knows — those are instructions, not names. */
const LEXICON_WORDS = new Set(PATTERNS.flatMap((p) => p.tokens));

function isKnownWord(norm: string): boolean {
  return (
    LEXICON_WORDS.has(norm) ||
    COMMON_WORDS.has(norm) ||
    FIRST_PERSON.has(norm) ||
    THIRD_PARTY_PRONOUNS.has(norm) ||
    NEGATIONS.has(norm)
  );
}

/* ── Matching ────────────────────────────────────────────────────────────── */

interface Match {
  /** Index of the first instruction token covered. */
  start: number;
  /** Index one past the last instruction token covered. */
  end: number;
  /** True when at least one token needed typo tolerance to line up. */
  fuzzy: boolean;
}

/** Finds `pat` as a contiguous run in `instr`, preferring an exact alignment. */
function findWindow(instr: string[], pat: string[]): Match | null {
  const n = pat.length;
  if (n === 0 || instr.length < n) return null;
  let fuzzyHit: Match | null = null;

  for (let i = 0; i + n <= instr.length; i++) {
    let ok = true;
    let fuzzy = false;
    for (let j = 0; j < n; j++) {
      const a = instr[i + j] as string;
      const b = pat[j] as string;
      if (a === b) continue;
      if (fuzzyEquals(a, b)) {
        fuzzy = true;
        continue;
      }
      ok = false;
      break;
    }
    if (!ok) continue;
    const m: Match = { start: i, end: i + n, fuzzy };
    if (!fuzzy) return m;
    fuzzyHit ??= m;
  }
  return fuzzyHit;
}

/**
 * Score for a match. A multi-word phrase always beats a single keyword, and an
 * exact hit always beats a typo-tolerant one, so `stop publishing` (phrase)
 * cannot be overruled by `publish` (keyword) sitting inside it.
 */
function scoreOf(pattern: Pattern, m: Match): number {
  const len = pattern.tokens.length;
  if (pattern.phrase) {
    const base = m.fuzzy ? 0.8 : 0.9;
    return Math.min(1, base + 0.02 * len);
  }
  return m.fuzzy ? 0.6 : 0.75;
}

/** Does the whole instruction contain a hypothetical framing? */
function isHypothetical(instr: string[]): boolean {
  return HYPOTHETICALS.some((h) => findWindow(instr, h) !== null);
}

/**
 * A negation close to (but not inside) the match. Negations that are PART of the
 * matched phrase are intentional — `no longer public` means what it says.
 */
function negatedNear(instr: string[], m: Match): boolean {
  const from = Math.max(0, m.start - NEGATION_RADIUS);
  const to = Math.min(instr.length, m.end + NEGATION_RADIUS);
  for (let i = from; i < to; i++) {
    if (i >= m.start && i < m.end) continue;
    if (NEGATIONS.has(instr[i] as string)) return true;
  }
  return false;
}

/* ── Slots ───────────────────────────────────────────────────────────────── */

/**
 * Detects that the instruction is about SOMEBODY ELSE (§4.2). Three signals,
 * in increasing order of guesswork:
 *
 *  1. an explicit third-person pronoun — always decisive;
 *  2. an `@mention`, or a capitalised possessive (`Max's`) — always decisive;
 *  3. an unknown capitalised word, but ONLY when the instruction contains no
 *     first-person marker at all. `veröffentliche meine Fotos` says `meine`, so
 *     `Fotos` is not read as a person; `publish Max` says nothing about the
 *     speaker, so `Max` is.
 */
function findTargetName(text: string, tokens: Token[]): string | undefined {
  const hasFirstPerson = tokens.some((t) => FIRST_PERSON.has(t.norm));

  for (const t of tokens) {
    if (THIRD_PARTY_PRONOUNS.has(t.norm)) return t.raw;
  }

  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i] as Token;
    const capitalised = t.raw[0] !== undefined && t.raw[0] !== t.raw[0].toLowerCase();
    if (!capitalised || t.norm.length < 2) continue;

    const mentioned = t.start > 0 && text[t.start - 1] === '@';
    const possessive = /['’ʼ]s$/.test(t.raw);
    if (mentioned || possessive) {
      if (!isKnownWord(t.norm.replace(/s$/, '')) && !isKnownWord(t.norm)) return t.raw;
      continue;
    }
    if (hasFirstPerson || i === 0) continue;
    if (!isKnownWord(t.norm)) return t.raw;
  }
  return undefined;
}

/** Everything after the search keyword, minus a leading `for` / `nach`. */
/**
 * The verbs German puts at the END of the sentence, which are not part of the topic.
 *
 * "was haben wir über den scheduler GESAGT" leaves `den scheduler gesagt` as the query, and
 * `countPublishedMatching` uses `websearch_to_tsquery`, which ANDs its terms: the archive
 * would then have to contain the word "gesagt" for any result at all. So the trailing verb
 * is dropped. English needs none of this, because its archive phrases end in "about" and the
 * topic is last (CCB-S5-026).
 */
const TRAILING_VERBS = new Set([
  'gesagt',
  'geschrieben',
  'geschickt',
  'erwähnt',
  'erwaehnt',
  'gesprochen',
  'besprochen',
  'gepostet',
  'geredet',
  'diskutiert',
  'erzählt',
  'erzaehlt',
]);

function extractQuery(text: string, tokens: Token[], m: Match): string | undefined {
  const rest = tokens.slice(m.end);
  const first = rest[0];
  if (!first) return undefined;
  const skip = first.norm === 'for' || first.norm === 'nach' || first.norm === 'about' ? 1 : 0;
  const from = rest[skip];
  if (!from) return undefined;
  // Trailing verbs come off the END, one or more of them, before the text is sliced: the
  // query runs to the last token that is part of the topic.
  let last = rest.length - 1;
  while (last >= skip && TRAILING_VERBS.has(rest[last]?.norm ?? '')) last--;
  const to = rest[last];
  if (!to || last < skip) return undefined;
  const q = text
    .slice(from.start, to.end)
    .replace(/["“”„«»]/g, '')
    .trim();
  return q || undefined;
}

/* ── State questions vs action requests (CCB-S3-006 §7a) ─────────────────── */

/**
 * Openings that mark a question ABOUT STATE. The distinction is not
 * question-versus-command — "can you publish me?" is a question and a genuine
 * request — it is whether the member is asking what IS, or asking for something
 * to HAPPEN.
 */
const STATE_OPENERS = [
  'what is my',
  'whats my',
  'what are my',
  'what do you have',
  'what have you got',
  'am i',
  'do i have',
  'do you have',
  'how many',
  'how much do you have',
  'was ist mein',
  'was ist meine',
  'bin ich',
  'habe ich',
  'hast du',
  'wie viele',
].map((p) => normTokens(p));

/** Openings that mark a request for an ACTION. */
const ACTION_OPENERS = [
  'can you',
  'could you',
  'would you',
  'will you',
  'please',
  'i want you to',
  'kannst du',
  'koenntest du',
  'wuerdest du',
  'bitte',
  'ich moechte dass du',
].map((p) => normTokens(p));

/** Nouns that make a state question unmistakable. */
const STATE_NOUNS = new Set(
  ['status', 'state', 'zustand', 'statistik', 'statistiken', 'statistics', 'stats'].flatMap((w) =>
    normTokens(w),
  ),
);

/** Does this instruction OPEN with one of the given phrases? */
function opensWith(instr: string[], phrases: string[][]): boolean {
  return phrases.some((p) => {
    if (p.length > instr.length) return false;
    for (let i = 0; i < p.length; i++) if (instr[i] !== p[i]) return false;
    return true;
  });
}

/**
 * True when the message is asking about state rather than requesting an action.
 *
 * A consent prompt must only ever appear because someone asked for the action.
 * "whats my publish status?" contains the word `publish`, which used to outrank
 * STATUS and put a consent confirmation in front of a member who had asked a
 * question about their own record.
 */
function isStateQuestion(instr: string[]): boolean {
  if (opensWith(instr, ACTION_OPENERS)) return false;
  if (opensWith(instr, STATE_OPENERS)) return true;
  // "publish status" with no opener at all is still a state question.
  return instr.some((t) => STATE_NOUNS.has(t));
}

/* ── Price slots (CCB-S3-004 §1) ─────────────────────────────────────────── */

/**
 * Words that are grammar rather than assets, so the symbol scan can skip them.
 * Deliberately NOT a list of assets: which symbols exist is the registry's
 * business, and the resolver must not need updating when an operator adds a
 * token.
 */
const PRICE_STOPWORDS = new Set([
  'what',
  'whats',
  'is',
  'are',
  'the',
  'a',
  'an',
  'of',
  'in',
  'to',
  'for',
  'do',
  'does',
  'i',
  'me',
  'my',
  'you',
  'get',
  'much',
  'many',
  'how',
  'much',
  'current',
  'currently',
  'now',
  'right',
  'about',
  'worth',
  'value',
  'price',
  'rate',
  'quote',
  'convert',
  'at',
  'moment',
  'today',
  'please',
  'tell',
  'give',
  'would',
  'will',
  'and',
  'one',
  'exchange',
  'was',
  'ist',
  'ein',
  'eine',
  'der',
  'die',
  'das',
  'wie',
  'viel',
  'viele',
  'von',
  'im',
  'kurs',
  'preis',
  'wert',
  'kostet',
  'kosten',
  'bekomme',
  'kriege',
  'ich',
  'fuer',
  'mir',
  'gerade',
  'aktuell',
  'aktuelle',
  'aktueller',
  'jetzt',
  'bitte',
  'sag',
  'sage',
  'und',
  'umrechnen',
  'wechselkurs',
  'us',
  'usd',
  // CCB-S3-006 §3 — "one real bitcoin" resolved the asset as "real".
  'one',
  'real',
  'actual',
  'actually',
  'currently',
  'just',
  'simply',
  'exactly',
  'ein',
  'eine',
  'echte',
  'echter',
  'echtes',
  'aktuell',
  'genau',
  'einfach',
]);

/** Tokens that introduce the QUOTE currency. */
const QUOTE_MARKERS = new Set(['in', 'to', 'into', 'gegen', 'nach']);
/** Tokens that introduce the BASE asset: "the value OF hex". */
const BASE_MARKERS = new Set(['of', 'von']);
/** "the <currency> VALUE of x" — the word before these names the quote. */
const VALUE_WORDS = new Set(['value', 'price', 'worth', 'wert', 'preis', 'kurs']);
/** Tokens that introduce the amount+base in a "how much X for N Y" question. */
const FOR_MARKERS = new Set(['for', 'fuer', 'per']);

interface PriceSlots {
  base?: string;
  /** Other words that could be the asset, best first (CCB-S3-006 §3). */
  baseAlternates?: string[];
  quote?: string;
  amount?: number;
}

/**
 * Pulls the asset words and the amount out of a price question.
 *
 * The resolver deliberately extracts CANDIDATE WORDS, not assets: it hands
 * `base`/`quote` back as the member wrote them and the price service resolves
 * them against the admin-editable registry. That keeps "which symbols exist"
 * out of the resolver entirely, which is what lets an operator add a token
 * without a code change — and it is the same separation that keeps the resolver
 * free of anything it could execute.
 *
 * Two shapes matter most:
 *   `price of HEX in EUR`                     → base HEX, quote EUR
 *   `how much Ethereum do I get for 1m HEX`   → quote Ethereum, base HEX (reversed)
 */
/**
 * Recognises a bare conversion with no price keyword at all: `1 million hex in
 * eth`, `100 hex in eur`, `hex in euro`. Members write these constantly and
 * nothing in the lexicon matches them, so they resolved to UNKNOWN.
 *
 * Deliberately shape-based rather than lexical, and deliberately narrow: an
 * amount and/or an asset word, a quote marker, another asset word, and few
 * spare tokens. It only runs when nothing else matched, so it can never
 * outrank a real instruction.
 */
function looksLikeConversion(tokens: Token[]): boolean {
  const norms = tokens.map((t) => t.norm);
  const marker = norms.findIndex((n) => QUOTE_MARKERS.has(n));
  if (marker <= 0 || marker === norms.length - 1) return false;

  const candidate = (i: number): boolean => {
    const n = norms[i];
    if (!n) return false;
    if (PRICE_STOPWORDS.has(n)) return false;
    if (unitMultiplier(n) !== undefined) return false;
    if (parseAmountAt(norms, i)) return false;
    return true;
  };
  const before = norms.slice(0, marker).some((_, i) => candidate(i));
  const after = norms.slice(marker + 1).some((_, i) => candidate(marker + 1 + i));
  // Bounded: a long sentence containing "in" is not a conversion request.
  return before && after && norms.length <= 10;
}

function extractPriceSlots(tokens: Token[]): PriceSlots {
  const norms = tokens.map((t) => t.norm);
  const slots: PriceSlots = {};

  // The amount, and where it sits.
  let amountAt = -1;
  let amountLen = 0;
  for (let i = 0; i < norms.length; i++) {
    const parsed = parseAmountAt(norms, i);
    if (parsed) {
      slots.amount = parsed.value;
      amountAt = i;
      amountLen = parsed.tokens;
      break;
    }
  }

  const isCandidate = (i: number): boolean => {
    const n = norms[i];
    if (!n) return false;
    if (PRICE_STOPWORDS.has(n)) return false;
    if (unitMultiplier(n) !== undefined) return false;
    if (parseAmountAt(norms, i)) return false;
    return true;
  };
  const nextCandidate = (from: number, stop = norms.length): string | undefined => {
    for (let i = from; i < stop; i++) if (isCandidate(i)) return tokens[i]?.raw;
    return undefined;
  };

  // Explicit "in <currency>" wins for the quote.
  for (let i = 0; i < norms.length; i++) {
    if (QUOTE_MARKERS.has(norms[i] as string)) {
      const q = nextCandidate(i + 1);
      if (q) {
        slots.quote = q;
        break;
      }
    }
  }

  // "the US dollar VALUE of HEX" — the word immediately before "value" names the
  // currency they want it in. Only the immediately preceding token counts: in
  // "the value of HEX" that token is "the", and inventing a quote there would
  // silently answer a different question than the one asked.
  if (!slots.quote) {
    for (let i = 1; i < norms.length; i++) {
      if (!VALUE_WORDS.has(norms[i] as string)) continue;
      // Only the "<currency> value OF <asset>" shape. Without the trailing
      // marker, "what is WAGMI worth" would read WAGMI as the currency and be
      // left with no asset at all.
      const hasBaseMarker = norms.slice(i + 1).some((n) => BASE_MARKERS.has(n));
      if (!hasBaseMarker) continue;
      const before = tokens[i - 1]?.raw;
      if (before && isCandidate(i - 1)) {
        slots.quote = before;
        break;
      }
    }
  }

  // "how much X ... for N Y" — the asset named FIRST is what they want to
  // receive, so it is the quote, and the one after the amount is the base.
  const forAt = norms.findIndex((n) => FOR_MARKERS.has(n));
  if (amountAt >= 0 && forAt >= 0 && forAt < amountAt) {
    const wanted = nextCandidate(0, forAt);
    if (wanted && !slots.quote) slots.quote = wanted;
    const paid = nextCandidate(amountAt + amountLen);
    if (paid) slots.base = paid;
  }

  // "the value OF hex" — an explicit marker beats positional guessing.
  if (!slots.base) {
    for (let i = 0; i < norms.length; i++) {
      if (!BASE_MARKERS.has(norms[i] as string)) continue;
      const b = nextCandidate(i + 1);
      if (b && b !== slots.quote) {
        slots.base = b;
        break;
      }
    }
  }

  if (!slots.base && amountAt >= 0) {
    const afterAmount = nextCandidate(amountAt + amountLen);
    if (afterAmount) slots.base = afterAmount;
  }
  if (!slots.base) {
    // First candidate that is not already claimed as the quote.
    for (let i = 0; i < norms.length; i++) {
      if (!isCandidate(i)) continue;
      const raw = tokens[i]?.raw;
      if (raw && raw !== slots.quote) {
        slots.base = raw;
        break;
      }
    }
  }
  // Every other candidate word, in sentence order (CCB-S3-006 §3). The resolver
  // cannot know which of them is a real asset, so it offers them and the price
  // service prefers whichever is already pinned. That is what turns
  // "one real bitcoin" into Bitcoin instead of an unknown token called "real".
  const alternates: string[] = [];
  for (let i = 0; i < norms.length; i++) {
    if (!isCandidate(i)) continue;
    const raw = tokens[i]?.raw;
    if (!raw) continue;
    if (raw === slots.base || raw === slots.quote) continue;
    if (!alternates.includes(raw)) alternates.push(raw);
  }
  if (alternates.length > 0) slots.baseAlternates = alternates;

  return slots;
}

/* ── The resolver ────────────────────────────────────────────────────────── */

function resolveRules(text: string, ctx: IntentContext): IntentResult {
  const tokens = tokenize(text);
  const instr = tokens.map((t) => t.norm);
  const fallbackLang = detectLanguageFromTokens(instr, ctx.defaultLanguage).lang;

  if (instr.length === 0) return unknownResult(fallbackLang);

  // A hypothetical framing disqualifies the whole message (§3).
  if (isHypothetical(instr)) return unknownResult(fallbackLang);

  const quoted = quotedRanges(text);

  /**
   * Did the member explicitly say to look on the WEB (CCB-S4-041)?
   *
   * Computed separately from the scoring contest and REGARDLESS of whether LOOKUP is
   * active, because the two situations it produces need opposite answers and the ordinary
   * loop can express neither.
   *
   * The observed defect: "google the current price of an RTX 5090" scored PRICE at 0.94,
   * because "price of" is a two token phrase and "google" is one, and the crypto plugin
   * then quoted 1.9758 USD for a graphics card. No amount of tuning the catalog would have
   * fixed that one, because it never reached the model: the rule engine had already
   * decided.
   *
   * The precedence: an explicit web verb is a statement about WHERE to look, and it beats
   * a topic keyword sitting in the same sentence. "Google the price of X" is a request to
   * go and look, not a price question that happens to mention Google.
   */
  // The same predicate the two gates use (CCB-S5-028). It was a local copy of the same scan;
  // one definition means the rule engine's precedence and the resolver gates cannot come to
  // different conclusions about what asking to look something up looks like.
  const webVerb = asksToLookItUp(text);

  let best: { pattern: Pattern; match: Match; score: number } | null = null;
  // Best score achieved per language (CCB-S3-005 Addendum A). The reply language a
  // match implies is authoritative only when its language strictly beats every
  // other's here; a keyword identical in both (status, undo) ties and stays a job
  // for the weighted contest.
  const bestByLang = new Map<string, number>();
  for (const pattern of PATTERNS) {
    // A pattern belonging to a plugin that is off FOR THIS BOT is not merely outranked,
    // it is never considered — so a price question put to a bot without the capability is
    // UNKNOWN and follows the CCB-S3-005 silence rules rather than half-matching. The
    // catalog is the asking bot's, not the deployment's, since CCB-S5-021.
    if (!inCatalog(ctx.intents, pattern.intent)) continue;
    const match = findWindow(instr, pattern.tokens);
    if (!match) continue;

    let score = scoreOf(pattern, match);

    // A keyword the member is QUOTING is not an instruction.
    const startTok = tokens[match.start];
    const endTok = tokens[match.end - 1];
    if (startTok && endTok && isQuoted(quoted, startTok.start, endTok.end)) score *= 0.2;

    // A negation beside the keyword: better to ask than to act.
    if (negatedNear(instr, match)) score *= 0.3;

    bestByLang.set(pattern.lang, Math.max(bestByLang.get(pattern.lang) ?? 0, score));

    if (
      !best ||
      score > best.score ||
      (score === best.score && pattern.tokens.length > best.pattern.tokens.length)
    ) {
      best = { pattern, match, score };
    }
  }

  // ── THE WEB VERB WINS, OR SAYS SO (CCB-S4-041) ──────────────────────────────
  //
  // Two cases, and they are deliberately not the same.
  //
  // LOOKUP ACTIVE: an explicit web verb outranks PRICE and SEARCH, whatever the scores
  // said. Those two are the only intents whose keywords can plausibly co-occur with one
  // ("google the price of", "search the web for"), and in both the member has said where
  // they want it looked for.
  //
  // LOOKUP INACTIVE: the member asked for the WEB and the web is not available. Falling
  // through to the archive search is the observed behaviour and it is misleading: they get
  // a count of what the group said about something, presented as an answer, without ever
  // being told the web was not consulted. UNKNOWN sends it to free conversation, where she
  // can say plainly that she cannot look things up. Honest and quiet beats confident and
  // wrong.
  if (webVerb) {
    if (inCatalog(ctx.intents, 'LOOKUP')) {
      if (!best || best.pattern.intent === 'PRICE' || best.pattern.intent === 'SEARCH') {
        const lookup = PATTERNS.filter((pattern) => pattern.intent === 'LOOKUP')
          .map((pattern) => {
            const match = findWindow(instr, pattern.tokens);
            return match ? { pattern, match, score: scoreOf(pattern, match) } : null;
          })
          .filter((entry): entry is { pattern: Pattern; match: Match; score: number } => entry !== null)
          .sort((a, b) => b.score - a.score)[0];
        if (lookup) best = lookup;
      }
    } else if (best?.pattern.intent === 'SEARCH' || best?.pattern.intent === 'PRICE') {
      return unknownResult(best.pattern.lang);
    }
  }

  // §1 — a bare "N X in Y" carries no price keyword, so nothing above matched.
  // Checked only when nothing else won, so it can never outrank a real
  // instruction, and only while the PRICE intent is actually active.
  if (
    (!best || best.score < ctx.threshold) &&
    inCatalog(ctx.intents, 'PRICE') &&
    looksLikeConversion(tokens)
  ) {
    const slots: IntentSlots = {};
    const price = extractPriceSlots(tokens);
    if (price.base !== undefined) slots.base = price.base;
    if (price.quote !== undefined) slots.quote = price.quote;
    if (price.amount !== undefined) slots.amount = price.amount;
    if (price.baseAlternates?.length) slots.baseAlternates = price.baseAlternates;
    if (slots.base && slots.quote) {
      return { intent: 'PRICE', confidence: 0.9, slots, lang: fallbackLang };
    }
  }

  if (!best || best.score < ctx.threshold) {
    return unknownResult(best?.pattern.lang ?? fallbackLang);
  }

  let { pattern } = best;
  const { match, score } = best;

  // §7a — a question about state must never become a request for an action.
  // Re-point it at STATUS rather than merely lowering its score, because the
  // member did ask something answerable.
  if ((pattern.intent === 'PUBLISH' || pattern.intent === 'UNPUBLISH') && isStateQuestion(instr)) {
    pattern = { ...pattern, intent: 'STATUS' };
  }

  const slots: IntentSlots = {};

  if (pattern.intent === 'SEARCH') {
    const query = extractQuery(text, tokens, match);
    if (query !== undefined) slots.query = query;
  }

  if (pattern.intent === 'PRICE') {
    const price = extractPriceSlots(tokens);
    if (price.base !== undefined) slots.base = price.base;
    if (price.quote !== undefined) slots.quote = price.quote;
    if (price.amount !== undefined) slots.amount = price.amount;
    if (price.baseAlternates?.length) slots.baseAlternates = price.baseAlternates;
  }

  // Third-party targeting only matters where consent is at stake.
  if (pattern.intent === 'PUBLISH' || pattern.intent === 'UNPUBLISH') {
    const target = findTargetName(text, tokens);
    if (target !== undefined) slots.targetName = target;
  }

  // The match's language is authoritative (CCB-S3-005 Addendum A) only when it
  // strictly beats every other language's best score. A tie (a keyword identical
  // in both, e.g. `status`) is ambiguous, so the engine keeps the contest + default.
  let otherBest = 0;
  for (const [l, sc] of bestByLang) if (l !== pattern.lang) otherBest = Math.max(otherBest, sc);
  const langMatched = score > otherBest;

  return { intent: pattern.intent, confidence: score, slots, lang: pattern.lang, langMatched };
}

/**
 * Does this message NAME the archive as the place to look (CCB-S5-027, D-181)?
 *
 * ── WHY THIS IS A PREDICATE AND NOT JUST A LEXICON ENTRY ─────────────────────
 *
 * CCB-S5-026 made the archive explicit-only: every phrase must say WHERE, there are no
 * keywords, and whatever is left over falls to conversation, which is where the knowledge
 * base is consulted. It applied that to the rule engine and to the model resolver's
 * DESCRIPTION, which is a sentence in a prompt.
 *
 * A sentence in a prompt is an instruction, and this one was not followed. Live, with the
 * new description in place, *"In which session was the switch from mbedTLS to OpenSSL
 * decided?"* was classified SEARCH and answered with a full-text count. Measured against
 * this file: the rule engine returns UNKNOWN for it, in both languages, at zero confidence.
 * So the claim came from the model, and the seam honoured it because SEARCH is in the
 * catalog. The question never reached retrieval, which is where it would have been answered
 * or honestly refused, and the false premise in it was restated back as fact instead.
 *
 * Naming a place is a property OF THE TEXT. It is decidable without a model, this file
 * already decides it for the rule engine, and D-179's own reasoning says the bar is the
 * same whoever is at the door. So the bar is enforced deterministically and a model that
 * claims SEARCH for a sentence naming nowhere is downgraded rather than believed.
 *
 * ── BUILT FROM THE PATTERNS, NOT FROM A SECOND LIST ──────────────────────────
 *
 * The same `PATTERNS` the resolver scores. A second copy of the phrase list would be a
 * second thing to keep in step, and the drift would show up as a capability that works in
 * one resolver and not the other, which is precisely the class of defect this is fixing.
 *
 * It answers only "is the place named". It does not care about negation, quoting or
 * hypotheticals: those lower a SCORE, and this gate never raises one. It can only ever
 * remove a claim, never create one.
 */
export function namesTheArchive(text: string): boolean {
  return matchesIntentPattern(text, 'SEARCH');
}

/**
 * Does this message ASK HER TO GO AND LOOK on the web (CCB-S5-028, D-183)?
 *
 * ── THE SIXTH ROUTING COLLISION, AND THE LAST LANE WITHOUT A GATE ────────────
 *
 * The operator asked *"One SimpleGo protocol says SUB after NEW is required, another says it
 * is a noop. Which is correct for SimpleGo, and where did the clarification come from?"* - a
 * question about documents he had loaded into her knowledge base. It was classified LOOKUP,
 * two university pages about amending human-subjects research protocols came back because the
 * word "protocol" matched, and she answered from nothing while the application printed their
 * domains underneath.
 *
 * Measured against this file: the rule engine returns UNKNOWN for it. So the claim came from
 * the model, and the seam honoured it, because LOOKUP's bar existed only as a sentence in the
 * model's own intent description. D-181 had already recorded what a bar in a prompt is worth
 * and had already fixed the identical hole one intent along; this is the same fix on the last
 * lane that lacked it.
 *
 * ── WHY THIS MATTERS MORE THAN A MISROUTE ────────────────────────────────────
 *
 * The knowledge base contributes NO intent (`plugins/knowledge-base/plugin.ts`, `intents: []`)
 * and is consulted at exactly ONE call site, inside free conversation. It is RESIDUE: it gets
 * the questions every other lane declined. So an intent that claims a question does not merely
 * answer it in the wrong place, it removes the knowledge base from the running permanently,
 * and nothing anywhere says so. Closing this gate is what puts a question about the operator's
 * own documents back where it can be answered.
 *
 * ── BUILT FROM THE PATTERNS, LIKE THE ARCHIVE'S ──────────────────────────────
 *
 * Same predicate shape, same reason: a second phrase list is a second thing to keep in step.
 * `resolveRules` uses this for its own web-verb precedence too, so the rule engine and the two
 * gates cannot drift apart.
 */
export function asksToLookItUp(text: string): boolean {
  return matchesIntentPattern(text, 'LOOKUP');
}

/**
 * Subjects a definition question can name that she should answer HERSELF (CCB-S5-049).
 *
 * Every one of these is either about her, about this product, or a generic noun that names
 * nothing lookupable. Asked "what is the archive", she has rules and facts for that and must
 * not spend an outbound request on it.
 */
const SELF_SUBJECTS = new Set([
  'you', 'your', 'yours', 'yourself', 'this', 'that', 'it', 'they', 'we', 'i', 'me',
  'here', 'there', 'name', 'archive', 'consent', 'bot', 'group', 'chat', 'room', 'rule',
  'rules', 'book', 'elii', 'publish', 'unpublish', 'cinderella', 'cind3r3lla', 'playlist',
  'music', 'track', 'song', 'genre', 'time', 'date', 'day', 'today', 'up', 'point',
  'du', 'dich', 'dir', 'das', 'dies', 'hier', 'name', 'regel', 'regeln', 'buch', 'lied',
  'musik', 'titel', 'zeit', 'datum', 'heute', 'gruppe', 'archiv',
]);

/** "what is X", "who is X", "was ist X", "wer ist X" - and nothing else. */
const DEFINITION_QUESTION =
  /^(?:hey\s+|hi\s+|ok(?:ay)?\s+|so\s+)?(?:can\s+you\s+tell\s+me\s+|tell\s+me\s+|do\s+you\s+know\s+)?(?:what(?:'?s| is| are)|who(?:'?s| is| are)|was\s+(?:ist|sind)|wer\s+(?:ist|sind))\s+(?:a|an|the|der|die|das|ein|eine)?\s*(.+?)\s*\??$/i;

/**
 * Does this ask what a NAMED THING is (CCB-S5-049, D-234)?
 *
 * ── THIS IS THE WIDENING rules.ts REFUSED, AND WHY IT IS NOW ALLOWED ─────────
 *
 * The LOOKUP header above says in terms that there is deliberately no "this looks like it
 * wants current information" heuristic, because a false positive costs an outbound request
 * and a bill, and it ends: *"widening it is a decision for somebody who is watching the
 * bill."* The operator is that person and he has made that decision, so this is his
 * widening rather than a rule quietly relaxed - and it is deliberately far NARROWER than
 * the heuristic that was refused.
 *
 * It is not "wants current information". It is the one shape that produced every invention
 * this product has recorded: a member asks what a named thing IS, she has no material for
 * it, and the model fills the gap with something plausible. Measured in production:
 * *"Matter over Thread is a concept that suggests physical matter should take precedence
 * over digital or virtual threads"*, asserted as fact, about a home-automation standard.
 *
 * ── WHAT IT REFUSES ──────────────────────────────────────────────────────────
 *
 * A subject that is about HER, about this product, or a bare generic noun. "what is your
 * name", "what is the archive", "what is a playlist" all have answers she already holds,
 * and spending a search on one would be the false positive the header warns about. A
 * multi-word subject needs only one non-generic token, because "what is a SINA Box" is the
 * case and "box" alone is not.
 */
/**
 * A word that makes the subject HERS, whatever noun follows it (CCB-S5-052, D-238).
 *
 * ── WHY THIS EXISTS, AND WHY THE LIST ABOVE WAS NOT ENOUGH ───────────────────
 *
 * `SELF_SUBJECTS` is a deny-list of NOUNS, and that is D-201's failure mode written out:
 * it fails OPEN on the noun nobody thought of. Measured in production, twice in one
 * conversation: "what's your most efficient function" went to the web and came back with a
 * Quora page about algorithms, and "what's your zodiac sign" announced a lookup - because
 * `function`, `efficient` and `zodiac` are not on any list and never could be. "what is your
 * name" only ever worked by accident, because `name` happened to be on it.
 *
 * A POSSESSIVE OR A PRONOUN IS A CLOSED SET, and it is the thing that actually decides. If a
 * member says "your" or "you" anywhere in the subject, they are asking about HER, and the
 * answer is not on the web by construction: a bot searching the internet to learn about
 * itself is worse than useless, because the answer can never be there.
 *
 * Applied to ANY token rather than the first, so "what is the most efficient function you
 * have" is caught as well as "what is your zodiac sign".
 *
 * The cost is stated: "what is your opinion on the Zeliqua protocol" now stays conversation
 * rather than searching. That is the right trade - they asked for HER view, not for a
 * definition - and it is a narrow loss against a fault that reached members twice.
 */
const SELF_REFERENCE = new Set([
  'you', 'your', 'yours', 'yourself', 'u', 'ur',
  'du', 'dein', 'deine', 'deinem', 'deinen', 'deiner', 'deines', 'dich', 'dir',
  'ihr', 'ihre', 'ihrem', 'ihren', 'ihrer', 'sie',
]);

export function asksWhatSomethingIs(text: string): boolean {
  const m = DEFINITION_QUESTION.exec(text.trim());
  if (m === null) return false;
  const subject = (m[1] ?? '').trim();
  if (subject === '') return false;
  const tokens = normTokens(subject);
  if (tokens.length === 0 || tokens.length > 8) return false;
  // ABOUT HER: never a lookup, whatever the noun. Checked FIRST and over every token,
  // because this is the closed set and the noun list below is not.
  if (tokens.some((t) => SELF_REFERENCE.has(t))) return false;
  // At least one token that is not about this product and not a bare generic noun.
  return tokens.some((t) => !SELF_SUBJECTS.has(t) && t.length > 2);
}

/**
 * The MUSIC bar (CCB-S5-044, the D-183 rule): a resolver may only claim MUSIC
 * for a message that deterministically asks to play or asks about the
 * playlists. Talking ABOUT music stays conversation.
 */
export function asksForMusic(text: string): boolean {
  return matchesIntentPattern(text, 'MUSIC');
}

/**
 * Does any pattern for `intent` appear as a contiguous window in `text`?
 *
 * Answers only that. It does not care about negation, quoting or hypotheticals: those lower a
 * SCORE, and these gates never raise one. They can only ever remove a claim, never create one,
 * which is the property that makes them safe to apply on top of any resolver.
 */
function matchesIntentPattern(text: string, intent: Exclude<Intent, 'UNKNOWN'>): boolean {
  const instr = normTokens(text);
  if (instr.length === 0) return false;
  return PATTERNS.some(
    (pattern) => pattern.intent === intent && findWindow(instr, pattern.tokens) !== null,
  );
}

/**
 * Price slots for a bare fragment, used by the carry-over path (CCB-S3-006 §7c).
 * Exported for `resolver.ts` only; callers still go through the seam.
 */
export function priceSlotsFor(text: string): IntentSlots {
  const tokens = tokenize(text);
  const price = extractPriceSlots(tokens);
  const slots: IntentSlots = {};
  if (price.base !== undefined) slots.base = price.base;
  if (price.quote !== undefined) slots.quote = price.quote;
  if (price.amount !== undefined) slots.amount = price.amount;
  if (price.baseAlternates?.length) slots.baseAlternates = price.baseAlternates;
  return slots;
}

/** The rule engine as an {@link IntentResolver}. Registered by default. */
export const ruleResolver: IntentResolver = {
  name: 'rules',
  resolve(text: string, ctx: IntentContext): Promise<IntentResult> {
    return Promise.resolve(resolveRules(text, ctx));
  },
};
