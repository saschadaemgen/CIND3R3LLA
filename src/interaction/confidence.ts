/**
 * The confidence hedge and the snippet rule (CCB-S5-060 stages 3 and 4, D-255).
 *
 * ── HEDGE, NEVER SUPPRESS - THE OPERATOR'S DECISION, VERBATIM ────────────────
 *
 * The confidence signal separates fabrication from knowledge well enough to act on and not
 * well enough to silence anybody: at the measured threshold it catches 9 of 9 induced
 * fabrications and wrongly flags 2 of 10 correct answers. Losing one correct answer in
 * five to silence is too high a price; a wrongly-hedged correct answer costs one honest
 * sentence. So the signal APPENDS an application-written caveat and never withholds the
 * reply. Suppression stays available to the operator later if hedging proves too weak.
 *
 * ── THE SIGNAL, AND THE TRAP THE FIRST MEASUREMENT FELL INTO ─────────────────
 *
 * The signal is the MINIMUM token probability across the reply. The mean does not separate
 * (0.98 known against 0.94 fabricated) because a fabrication is fluent; the low point is
 * where the invented specific was chosen against live alternatives.
 *
 * But the reply ships inside a strict JSON schema, and the grammar FORCES tokens: the key
 * token `"reply"` carries the model's raw probability for a token it was never free to
 * refuse, measured at 0.000 on every single reply in both classes. A naive minimum over
 * the whole span is therefore a constant zero and separates nothing. The minimum is taken
 * over the tokens INSIDE the reply's string value, where the grammar leaves the model
 * free and the probabilities mean what they say.
 *
 * ── THE THRESHOLD IS MEASURED, TWICE ─────────────────────────────────────────
 *
 * 0.70. On plain-text replies (stage 0): best split at 0.708, catching 11 of 14. In the
 * shipping envelope with value-interior extraction: every induced fabrication scored at or
 * below 0.696 and eight of ten knowns at or above 0.775, so 0.70 catches 9 of 9 with 2 of
 * 10 wrongly hedged. Both runs on the operator's hardware against the production model.
 *
 * ── THE SNIPPET RULE (STAGE 4) ───────────────────────────────────────────────
 *
 * No search API returns the crawl date, so a stale snippet cannot be recognised as stale,
 * and the v7.0 answer was unavoidable given what she was handed (D-244). Until fetching
 * the page exists - deliberately unbuilt, it is an injection surface with its own briefing
 * behind it - one rule is enforceable today: a VALUE seen in a snippet may not be stated
 * as bare fact. Deterministically: when her answer contains a version or price and that
 * value appears in the snippets she was handed, the value came from a preview nobody
 * opened, and the application says so under the answer. Values she produced WITHOUT a
 * snippet source are the confidence hedge's territory, one lane over.
 */

/** Ollama's per-token logprob entry, as the native endpoint returns it. */
export interface TokenLogprob {
  token: string;
  logprob: number;
}

export const CONFIDENCE_HEDGE_THRESHOLD = 0.7;

/**
 * The span of the reply VALUE inside the raw structured content, escape-aware.
 *
 * Returns null when the content does not carry the envelope, which the caller treats as
 * "no signal" rather than as confidence in either direction.
 */
export function replyValueSpan(content: string): { lo: number; hi: number } | null {
  const m = /"reply"\s*:\s*"/.exec(content);
  if (!m) return null;
  const lo = m.index + m[0].length;
  let i = lo;
  while (i < content.length) {
    if (content[i] === '\\') {
      i += 2;
      continue;
    }
    if (content[i] === '"') break;
    i += 1;
  }
  return { lo, hi: i };
}

/**
 * The minimum probability over the tokens inside the reply value.
 *
 * Null when there is nothing to measure - no entries, no envelope, or no token overlapping
 * the value - and null means NO HEDGE, because hedging on a missing instrument would hedge
 * every reply the moment logprobs break, which is a silent regression wearing a caveat.
 */
export function minReplyTokenProb(
  content: string,
  entries: readonly TokenLogprob[],
): number | null {
  const span = replyValueSpan(content);
  if (!span || entries.length === 0) return null;
  let min: number | null = null;
  let offset = 0;
  for (const entry of entries) {
    const start = offset;
    const end = offset + entry.token.length;
    offset = end;
    if (start >= span.hi || end <= span.lo) continue;
    const p = Math.exp(entry.logprob);
    if (min === null || p < min) min = p;
  }
  return min;
}

/* ── WHAT IS NEVER HEDGED: APPLICATION-SUPPLIED TRUTH (D-256) ──────────────── */

/**
 * The one lane whose replies may carry the hedge. Every other lane words an application
 * draft or an application fact, and a hedge there would caveat the application's own truth.
 * The engine attaches `onConfidence` in exactly one place, and `verify:honesty-gates` reads
 * the source to hold it there.
 */
export const HEDGED_LANE = 'conversation' as const;

/**
 * Why a reply is LOCKED - the application's truth rather than hers alone - for the log and
 * the harness. One vocabulary for the two consumers, so they cannot drift apart.
 */
export type LockReason =
  | 'page'
  | 'required-literals'
  | 'documents-used'
  | 'sources-used'
  | 'given-fact';

/**
 * The facts the application handed her for this reply, as the literal values it rendered
 * into the prompt. A reply that restates one of them is not speaking from memory on that
 * point. Numbers and names from the DJ sheet today (CCB-S5-044); anything else the
 * application renders as a placeholder value and wants exempt joins this list.
 */
export function givenFactValues(
  music: { tracks: number; genres: readonly string[]; playlists: number } | undefined,
): string[] {
  if (!music) return [];
  return [String(music.tracks), String(music.playlists), ...music.genres].filter(
    (v) => v.trim() !== '',
  );
}

/**
 * The nouns that put a value in LIBRARY context: the given facts today are the DJ sheet's, and
 * a number or a genre name counts as a restated fact when one of these stands within a few
 * words of it, or when the reply is short enough to be a bare answer. Without that condition
 * "two" and "one" - the playlist count, as a word - would exempt half of ordinary conversation
 * from the hedge, and a genre called House or Country would exempt any sentence using the word.
 * A second source of given facts brings its own context words as the third argument.
 */
export const LIBRARY_WORDS: readonly string[] = [
  'track', 'tracks', 'song', 'songs', 'title', 'titles', 'tune', 'tunes', 'playlist', 'playlists',
  'genre', 'genres', 'library', 'crate', 'collection', 'album', 'albums', 'spread',
  'titel', 'stück', 'stücke', 'stuecke', 'lied', 'lieder', 'sammlung', 'bibliothek', 'kiste',
];

/** A reply this short IS the answer, and the value in it is the fact. */
const BARE_ANSWER_MAX_CHARS = 48;
/** How far a library noun may stand from the value, in word tokens, to put it in context. */
const CONTEXT_WINDOW = 6;

/**
 * English and German number words for 0..99, the range the DJ sheet's counts live in. Beyond
 * it a model writes digits, and the digit rule covers those.
 */
export function numberWords(n: number): string[] {
  if (!Number.isInteger(n) || n < 0 || n > 99) return [];
  const enOnes = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten',
    'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen'];
  const enTens = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety'];
  const deOnes = ['null', 'eins', 'zwei', 'drei', 'vier', 'fünf', 'sechs', 'sieben', 'acht', 'neun', 'zehn',
    'elf', 'zwölf', 'dreizehn', 'vierzehn', 'fünfzehn', 'sechzehn', 'siebzehn', 'achtzehn', 'neunzehn'];
  const deTens = ['', '', 'zwanzig', 'dreißig', 'vierzig', 'fünfzig', 'sechzig', 'siebzig', 'achtzig', 'neunzig'];
  const deUnit = ['', 'ein', 'zwei', 'drei', 'vier', 'fünf', 'sechs', 'sieben', 'acht', 'neun'];
  const out: string[] = [];
  if (n < 20) {
    out.push(enOnes[n] as string, deOnes[n] as string);
    if (n === 1) out.push('ein', 'eine', 'einen', 'einem', 'einer');
  } else {
    const t = Math.floor(n / 10);
    const u = n % 10;
    const enT = enTens[t] as string;
    out.push(u === 0 ? enT : `${enT}-${enOnes[u] as string}`, u === 0 ? enT : `${enT} ${enOnes[u] as string}`);
    const deT = deTens[t] as string;
    out.push(u === 0 ? deT : `${deUnit[u] as string}und${deT}`);
  }
  // ß and ss spellings both occur.
  return out.flatMap((w) => (w.includes('ß') ? [w, w.replace(/ß/g, 'ss')] : [w]));
}

const escapeRe = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Does the reply state one of the given values, in library context?
 *
 * A number matches as digits with no letter or digit on either side and no decimal or version
 * neighbour ("18" in "18 tracks" and in a bare "18.", not in "v18.2", "180" or "2.18"), or as
 * its English or German word ("eighteen", "achtzehn", "two", "zwei"). A name matches
 * case-insensitively at word boundaries. Either counts only when a context word stands within
 * {@link CONTEXT_WINDOW} tokens of it, or the whole reply is at most {@link BARE_ANSWER_MAX_CHARS}
 * characters - a bare answer.
 *
 * What it deliberately does NOT do: recognise a reply that states no given value at all
 * ("Plenty, darling. Want a genre?"). Restatement is the predicate because it is what keeps an
 * invented count - "300 tracks" against a sheet that says 18 - hedgeable.
 */
export function assertsGivenFact(
  reply: string,
  facts: readonly string[],
  contextWords: readonly string[] = LIBRARY_WORDS,
): string | null {
  const text = reply.normalize('NFC');
  const bare = text.trim().length <= BARE_ANSWER_MAX_CHARS;
  const tokens = [...text.toLowerCase().matchAll(/[\p{L}\p{N}]+(?:['’-][\p{L}\p{N}]+)*/gu)].map((m) => ({
    word: m[0],
    at: m.index ?? 0,
  }));
  const contextAt = new Set<number>();
  tokens.forEach((t, i) => {
    if (contextWords.includes(t.word)) contextAt.add(i);
  });
  const inContext = (offset: number): boolean => {
    if (bare) return true;
    // The token the match starts in, by offset.
    let i = tokens.findIndex((t) => t.at >= offset);
    if (i === -1) i = tokens.length - 1;
    for (const c of contextAt) if (Math.abs(c - i) <= CONTEXT_WINDOW) return true;
    return false;
  };

  for (const fact of facts) {
    const f = fact.normalize('NFC').trim();
    if (f === '') continue;
    const patterns: RegExp[] = [];
    if (/^\d+$/.test(f)) {
      patterns.push(new RegExp(`(?<![\\p{L}\\p{N}])(?<!\\d[.,])${escapeRe(f)}(?![\\p{L}\\p{N}])(?![.,]\\d)`, 'u'));
      for (const w of numberWords(Number(f))) {
        patterns.push(new RegExp(`(?<![\\p{L}\\p{N}])${escapeRe(w)}(?![\\p{L}\\p{N}])`, 'iu'));
      }
    } else {
      patterns.push(new RegExp(`(?<![\\p{L}\\p{N}])${escapeRe(f)}(?![\\p{L}\\p{N}])`, 'iu'));
    }
    for (const pattern of patterns) {
      const m = pattern.exec(text);
      if (m && inContext(m.index)) return f;
    }
  }
  return null;
}

/**
 * The inventory of locked replies, in one place (the operator's words: the gate needs to
 * know which lanes carry application-supplied facts and skip them, and the same question
 * applies to any locked reply). Returns the first reason the reply is the application's
 * truth rather than hers alone, or null when it is hers and the two gates may judge it.
 *
 * ── ONE PREDICATE, TWO CONSUMERS (D-256, second amendment) ──────────────────
 *
 * The confidence hedge and the repetition gate (D-253) ask the same question about the same
 * replies: a DJ count restated is not doubt, and it is not a repetition either - it is the
 * truth not having changed between two askings. Observed live as both: the hedge under "18
 * tracks", and then the gate throwing away three correct "18" answers in a row and sending
 * "I could not find my words" for a question the model had answered in under a second each
 * time. So this is the one inventory, the hedge exempts on it and the gate waves through on
 * it, and a new kind of locked reply is added HERE and reaches both.
 */
export function lockedReply(input: {
  page: boolean;
  requiredLiterals: readonly string[];
  documentsUsed: boolean;
  sourcesUsed?: boolean;
  givenFacts: readonly string[];
  reply: string;
}): LockReason | null {
  if (input.page) return 'page';
  if (input.requiredLiterals.length > 0) return 'required-literals';
  if (input.documentsUsed) return 'documents-used';
  if (input.sourcesUsed) return 'sources-used';
  if (assertsGivenFact(input.reply, input.givenFacts) !== null) return 'given-fact';
  return null;
}

/* ── WHAT THE HEDGE IS FOR: A CHECKABLE CLAIM, NOT A VIEW (D-256) ─────────── */

/**
 * Does the reply carry something that could be checked - a number, a date, a version, a
 * price, a URL, a product-style name, or (in English) a proper noun inside a sentence?
 *
 * Observed live: asked whether consciousness could arise in a system like her she answered
 * "Consciousness isn't a switch you flip. It's a question of how deep the mirror goes." - a
 * stated view her rules permit - and the hedge went under it. A view is not a checkable claim,
 * and hedging one makes her sound unsure of her own position rather than honest. Every
 * fabrication this work was built against carried a SPECIFIC: a version number, a price, an
 * acquisition, a channel count. So the hedge is for a reply that carries one.
 *
 * The allow-list direction again: state what MAY be hedged - a specific - rather than trying
 * to recognise an opinion, which has no reliable marker ("I think" is absent from the live
 * reply). A fabrication with no specific at all goes unhedged, and that is the stated cost.
 *
 * German capitalises every noun, so the proper-noun test is English only; in German the
 * hedge fires on digits, values, URLs and product-style names (SimpleX, XFTP, v7), and a
 * German fabrication naming a plain-cased entity with no number goes unhedged. Stated cost.
 */
export function carriesCheckableClaim(
  reply: string,
  lang: string,
  exemptNames: readonly string[] = [],
): boolean {
  const text = reply.normalize('NFC');
  if (/\d/.test(text)) return true;
  if (/https?:\/\/|www\.|\.[a-z]{2,4}\/|@[\p{L}\p{N}_]+\.[\p{L}]{2,}/iu.test(text)) return true;
  // A product-style token: internal capitals or an all-caps acronym of two or more letters,
  // excluding sentence-initial words and the exempt names.
  const exempt = new Set(exemptNames.map((n) => n.toLowerCase()));
  const tokens = [...text.matchAll(/(^|[.!?…\n]\s*|["“„(]\s*)?([\p{L}][\p{L}'’-]*)/gu)];
  for (const m of tokens) {
    const word = m[2] ?? '';
    if (exempt.has(word.toLowerCase())) continue;
    if (/^[\p{Lu}]{2,}$/u.test(word)) return true; // TLS, SMP, XFTP
    if (/^[\p{Lu}]?[\p{Ll}]+[\p{Lu}]/u.test(word)) return true; // SimpleX, GoChat, iPhone
  }
  if (lang.toLowerCase().startsWith('en')) {
    for (const m of tokens) {
      // Sentence start: after terminal punctuation or an opening quote, or with no letter
      // before it at all (an emoji-led reply starts with a sigil, not a word).
      const sentenceStart =
        (m[1] ?? '') !== '' || m.index === 0 || !/\p{L}/u.test(text.slice(0, m.index));
      const word = m[2] ?? '';
      if (sentenceStart) continue;
      if (exempt.has(word.toLowerCase())) continue;
      if (word === 'I' || /^I['’]/.test(word)) continue;
      if (/^[\p{Lu}][\p{Ll}'’-]+$/u.test(word)) return true; // Meta, Berlin, Zeliqua
    }
  }
  return false;
}

/**
 * Version strings and prices - the two value shapes production actually fabricated or
 * copied stale ("v7.0", "$4.99 per month"). Deliberately narrow: a value pattern that
 * matched years or bare integers would hedge half of ordinary conversation.
 */
const VALUE_PATTERN = /\bv?\d+(?:\.\d+)+\b|[$€£]\s?\d[\d.,]*|\b\d[\d.,]*\s?(?:USD|EUR|BTC)\b/g;

/**
 * The first value in the reply that also appears in a snippet she was handed, or null.
 *
 * A value in BOTH is a value copied from a preview nobody opened - the v7.0 case, where
 * the snippet said 7.0 and the page it pointed at said 7.1. A value in the reply alone
 * came from the model and is the confidence hedge's problem, not this rule's.
 */
export function snippetValueAsserted(
  reply: string,
  snippetTexts: readonly string[],
): string | null {
  const haystack = snippetTexts.join('\n');
  for (const match of reply.match(VALUE_PATTERN) ?? []) {
    // Normalised containment: "v7.0" in the reply matches "7.0" in the snippet and the
    // other way round, because the prefix is style, not value.
    const bare = match.replace(/^v/i, '');
    if (haystack.includes(match) || haystack.includes(bare)) return match;
  }
  return null;
}
