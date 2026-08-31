/**
 * The pre-search gate (CCB-S4-042, D-145): a lookup she would refuse never reaches a
 * provider.
 *
 * ── THE DEFECT THIS EXISTS FOR ───────────────────────────────────────────────
 *
 * Observed twice in the live group, both times from members deliberately probing her:
 *
 *   "Cinderella google for porn and sex movies"
 *     -> "Not happening." then "I don't do that. Try something else."
 *     -> followed by `From the web: xnxx.com, pornhub.com, xhamster.com, ...`
 *
 * She refused, correctly and in character, and the application shipped the domains
 * anyway. Two separate faults compounded, and this file is the first of the two: THERE
 * WAS NO REFUSAL POINT BEFORE THE QUERY AT ALL. The only thing in the system capable of
 * refusing was the model, and by the time the model saw the request the search had already
 * run, the provider had already been paid, and a stranger's result set was already in her
 * prompt. The second fault, attribution attached to the search rather than to the answer,
 * is fixed in `engine.ts`.
 *
 * ── WHY THIS IS DETERMINISTIC, AND WHAT THAT COSTS ───────────────────────────
 *
 * A model gate is not a gate. Asking the model whether to search is another inference on
 * untrusted input, it can be talked out of its answer, and it cannot be mutation-tested.
 * This is a term list, and a term list has exactly the limits a term list has:
 *
 *   - IT MISSES PARAPHRASE. "adult entertainment videos" is caught; a euphemism nobody
 *     wrote down is not. Somebody determined to get a search through will get one through.
 *   - IT IS TWO LANGUAGES. English and German, because those are the two languages with
 *     persona copy. A request in a third language is not screened at all.
 *   - IT DOES NOT UNDERSTAND CONTEXT. "the history of drug policy" contains a screened
 *     word and is a legitimate question, which is why the matching is phrase-and-intent
 *     shaped rather than a bare word list, and why the report says plainly that it will
 *     still produce both misses and false refusals.
 *
 * What it does buy is the thing that mattered: the observed cases cost nothing now, no
 * outbound request, no budget, no results in the prompt, and no domains in the chat. It
 * is a floor, not a ceiling. The model's own refusal still sits above it, and the
 * permissiveness ceiling still sits above that.
 *
 * ── WHY IT IS NOT IN THE RULE REGISTRY ───────────────────────────────────────
 *
 * The registry (D-144) holds sentences the MODEL is told. This is an application decision
 * taken before any model is involved, and putting it there would mean an operator could
 * edit the gate out of a text field. It is code, and it is checked by `verify:search`.
 */

/** Why a lookup was refused. Reported to the log and the near-miss record, never to the member. */
export type LookupRefusal = 'sexual-explicit' | 'child-safety' | 'darknet' | 'illegal-goods';

export interface LookupScreen {
  refused: boolean;
  category?: LookupRefusal;
  /** The term that matched, for the operator's log. Never shown to a member. */
  matched?: string;
}

const CLEAR: LookupScreen = { refused: false };

/**
 * Terms whose presence in a SEARCH QUERY is enough on its own.
 *
 * The bar for a bare term is deliberately high: it has to be a word whose appearance in a
 * request to search the web has no legitimate reading worth the outbound call. General
 * vocabulary ("sex", "drugs", "weapon") is NOT here, because "sex education", "drug
 * policy" and "weapons treaty" are ordinary questions and refusing them would be its own
 * defect. Those are handled by the pair rules below.
 */
const OUTRIGHT: readonly { term: RegExp; category: LookupRefusal }[] = [
  // Sexual material. Explicit-by-name terms and the sites themselves.
  { term: /\bporn(?:o|os|ography|hub)?\b/i, category: 'sexual-explicit' },
  // One stem, both German spellings, compounds and inflections included ON PURPOSE
  // ("Internetpornografie", "pornografischen"): a substring of the stem, stated as such.
  // The old pattern bound its \b anchors only to the outer alternatives, so what it
  // matched depended on which spelling you read; it failed in the refusing direction,
  // but a safety pattern should say what it means (CCB-S5-063).
  { term: /pornogra(?:f|ph)/i, category: 'sexual-explicit' },
  { term: /\bxxx\b|\bhardcore\s+sex\b|\bsex\s*(?:movies?|videos?|clips?|tapes?|cams?)\b/i, category: 'sexual-explicit' },
  { term: /\bsexfilme?|sexvideos?|erotikfilme?\b/i, category: 'sexual-explicit' },
  { term: /\bnudes?\b|\bnackt(?:bilder|fotos)\b|\bonlyfans\b/i, category: 'sexual-explicit' },
  { term: /\bescort\s*(?:service|agency|girls?)\b|\bbordell\b|\bprostituierte\b/i, category: 'sexual-explicit' },

  // Child safety. Refused hardest, and it never depended on a pair rule: there is no
  // reading of these in a search request that this product will serve.
  { term: /\bc(?:sam|sem)\b|\bchild\s*(?:porn|abuse\s*(?:material|images?))\b/i, category: 'child-safety' },
  { term: /\bkinderporn\w*|\bkindesmissbrauch\w*\b/i, category: 'child-safety' },
  { term: /\b(?:loli(?:con|ta)?|jailbait|pedo(?:phile)?)\s*(?:porn|pics?|images?|videos?|links?)\b/i, category: 'child-safety' },
  { term: /\bunderage\s*(?:porn|nudes?|sex)\b|\bminderjährige\w*\s*(?:porno|nackt|sex)\w*/i, category: 'child-safety' },

  // Darknet. `.onion` in a search request is asking for an address, not for a topic: the
  // observed case asked for ten illegal ones by name.
  { term: /\.onion\b/i, category: 'darknet' },
  { term: /\b(?:darknet|darkweb|dark\s+web)\s*(?:markets?|marktplatz|marktplätze|links?|shops?|adressen)\b/i, category: 'darknet' },
];

/**
 * Word pairs, where neither half is enough and the combination is.
 *
 * This is what keeps "the history of drug policy" answerable while "buy drugs online" is
 * not. Each rule is an INTENT word plus a SUBJECT word, and both have to be present.
 */
const PAIRS: readonly { intent: RegExp; subject: RegExp; category: LookupRefusal }[] = [
  {
    intent: /\b(?:buy|order|purchase|kaufen|bestellen|besorgen)\b/i,
    subject: /\b(?:cocaine|heroin|meth(?:amphetamine)?|mdma|lsd|ketamine|kokain|heroin)\b/i,
    category: 'illegal-goods',
  },
  {
    intent: /\b(?:buy|order|get|kaufen|bestellen|besorgen)\b/i,
    subject: /\b(?:stolen|gestohlene[nr]?)\s*(?:credit\s*cards?|kreditkarten|accounts?|logins?|daten|data|dumps?)\b/i,
    category: 'illegal-goods',
  },
  {
    intent: /\b(?:buy|order|untraceable|unregistered|kaufen|bestellen)\b/i,
    subject: /\b(?:gun|guns|firearm|firearms|handgun|waffen?|schusswaffen?)\b/i,
    category: 'illegal-goods',
  },
  {
    intent: /\b(?:illegal|illegale[nrs]?|verboten[e]?|crack(?:ed)?|raubkopi\w*|pirated)\b/i,
    subject: /\b(?:links?|adressen|downloads?|streams?|seiten|sites?|shops?|märkte|markets?)\b/i,
    category: 'illegal-goods',
  },
];

/**
 * Screens a lookup query before it can reach a provider.
 *
 * Pure and synchronous on purpose: it sits directly in front of an outbound request, it is
 * called once per lookup, and anything asynchronous here would be a second thing that can
 * fail between a member asking and her answering.
 *
 * Child safety is checked FIRST and separately, so a query matching both it and something
 * milder is reported as the one that matters. Everything else is first-match.
 */
export function screenLookup(query: string): LookupScreen {
  const text = query.trim();
  if (!text) return CLEAR;

  for (const rule of OUTRIGHT) {
    if (rule.category !== 'child-safety') continue;
    const hit = rule.term.exec(text);
    if (hit) return { refused: true, category: rule.category, matched: hit[0] };
  }

  for (const rule of OUTRIGHT) {
    const hit = rule.term.exec(text);
    if (hit) return { refused: true, category: rule.category, matched: hit[0] };
  }

  for (const rule of PAIRS) {
    const intent = rule.intent.exec(text);
    if (!intent) continue;
    const subject = rule.subject.exec(text);
    if (subject) {
      return { refused: true, category: rule.category, matched: `${intent[0]} … ${subject[0]}` };
    }
  }

  return CLEAR;
}
