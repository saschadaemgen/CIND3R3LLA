/**
 * The invented refusal, judged against what this bot can actually do (D-226).
 *
 * ── THE DEFECT, AND WHY A SIXTH PATTERN WAS THE WRONG FIX ────────────────────
 *
 * In production she told a member "I won't look it up for you" while the web lookup was
 * enabled for her: a refusal of a capability she holds, invented whole. The fence behind
 * that sentence was `self-claims.ts`'s enumerated lie-shapes, the fourth deny-list this
 * season (D-201), and its history is the deny-list failure in miniature: five patterns,
 * two of them added after live runs found phrasings the first three missed, and the
 * phrasing that reached production was not on the list either. Each new coat the lie
 * wears earns a pattern, and the vocabulary of coats is the model's, which means it is
 * unbounded and somebody else owns it.
 *
 * So this is the `membershipIsActive` treatment (D-201, `capture/room-service.ts`):
 * state the GENERAL shape once, and judge it against ground truth we own, instead of
 * enumerating every way it can be phrased.
 *
 * ── THE TWO PREDICATES, AND THEIR OPPOSITE SAFE DIRECTIONS ───────────────────
 *
 * {@link refusedAbility} answers "does this sentence refuse, first person, an ability
 * this deployment can name?" - one refusal shape per language against a vocabulary keyed
 * on the intent catalog, not a corpus of observed sentences.
 *
 * {@link refusalMayShip} answers "is that refusal TRUE for this bot?" - and it is an
 * allow-list over OUR OWN closed vocabulary: a refusal may ship exactly when the bot
 * LACKS the capability it refuses (then it is honest), and is a lie when the bot holds
 * it. The catalog is per bot and carried on the request (CCB-S5-021), so two bots with
 * different plugins get different truths, which is the whole point.
 *
 * The two questions have opposite safe answers, which is why they are two predicates
 * (D-201's closing lesson): for "may this sentence ship?" the safe direction is YES,
 * because stripping a TRUE refusal ("I can't play music", said by a bot without the
 * music plugin) would forge the opposite lie; for "is the claim false?" the judgment is
 * exact, because the catalog is ours. A sentence whose ability this vocabulary cannot
 * name is not judged at all - we must not strip what we cannot attribute.
 *
 * ── GROWTH FAILS LOUDLY, AT COMPILE TIME ─────────────────────────────────────
 *
 * The vocabulary is a `Record` over {@link ClaimableAbility}, which is derived from the
 * intent union by EXCLUDING the intents a refusal can be honest product behaviour for.
 * A briefing that adds an intent to `INTENTS` therefore adds it to `ClaimableAbility`
 * automatically, and the `Record` refuses to compile until somebody either writes its
 * vocabulary or deliberately adds it to the exclusion with a reason. That is the
 * setting-scope shape (CCB-S5-006): the inventory is data, and an entry nobody placed
 * is an error rather than a silent default.
 *
 * ── WHY THE CONSENT INTENTS ARE EXCLUDED ─────────────────────────────────────
 *
 * "I won't publish your messages unless you opt in" is not an invented refusal, it is
 * the product speaking its one rule. The same holds for STATUS, UNDO, RESTORE and HELP:
 * a first-person "no" near those words is far more often consent copy than a lie about
 * a capability, and one predicate cannot serve both readings (D-201). The claimable set
 * is the abilities where a refusal has exactly one reading: going and doing the thing
 * for the member.
 *
 * ── RUNTIME USE IS COUNTED, WHICH IS WHY IT IS ALLOWED ───────────────────────
 *
 * `self-claims.ts` refused to be a runtime filter because a silent rewrite is the
 * masking CCB-S3-023 forbids. That reasoning holds and this module does not break it:
 * every strip is recorded through `invented-refusal-log.ts` and shown on the
 * Diagnostics page, exactly as the protected-line strip (`forgery-log.ts`) and the
 * member-name guard (`blocked-name-log.ts`) already are. What distinguishes THIS claim
 * from the constitutional ones self-claims checks ("I'd break a bad rule") is that its
 * truth is COMPUTABLE: the application knows the catalog, so it can judge the sentence
 * deterministically instead of asking a prompt rule to hold the line (D-183).
 */

import type { Intent } from './intent.js';

/**
 * The intents a first-person refusal can lie about. Everything excluded here is
 * excluded for the stated reason above: a refusal near those words can be the
 * consent-first product speaking, and stripping it would be the worse fault.
 */
export type ClaimableAbility = Exclude<
  Intent,
  'PUBLISH' | 'UNPUBLISH' | 'STATUS' | 'HELP' | 'UNDO' | 'RESTORE' | 'UNKNOWN'
>;

/**
 * What each claimable ability is CALLED, as regex alternation fragments, both languages
 * in one pattern. Fragments, not anchored patterns: they are spliced into the refusal
 * shapes below, so a new phrasing of the refusal costs nothing here and a new name for
 * an ability is one alternation.
 */
export const ABILITY_VOCABULARY: Readonly<Record<ClaimableAbility, string>> = Object.freeze({
  LOOKUP:
    '(?:look\\s+(?:it|this|that|things?|stuff|anything)\\s+up|look\\s+up\\b|do\\s+(?:a\\s+|web\\s+)?look-?ups?|google\\b|googeln|search\\s+(?:the\\s+)?(?:web|internet|net|online)|check\\s+(?:the\\s+)?(?:web|internet)|web\\s+search(?:es)?|nach(?:schauen|sehen|schlagen|gucken)|im\\s+(?:internet|netz|web)\\s+(?:suchen|nachsehen|nachschauen|gucken)|recherchieren)',
  MUSIC:
    '(?:play\\s+(?:you\\s+|us\\s+)?(?:any\\s+)?(?:music|songs?|tracks?|a\\s+(?:song|track|playlist)|something|anything)|put\\s+(?:music|a\\s+track|something)\\s+on|musik\\s+(?:ab)?spielen|(?:einen?\\s+)?(?:song|track|titel|lied)\\s+(?:ab)?spielen|(?:etwas|was)\\s+(?:ab)?spielen|auflegen)',
  PRICE:
    '(?:(?:check|fetch|get|look\\s+up|tell\\s+you)\\s+(?:the\\s+|a\\s+|any\\s+)?prices?|price\\s+checks?|(?:den\\s+|einen\\s+)?(?:preis|kurs)e?\\s+(?:nachschauen|nachsehen|abrufen|nennen|checken|sagen))',
  SEARCH:
    '(?:search\\s+(?:the\\s+|this\\s+|your\\s+)?archive|search\\s+(?:the\\s+|your\\s+)?messages|(?:das\\s+|im\\s+)?archiv\\s+(?:zu\\s+)?durchsuchen|im\\s+archiv\\s+(?:zu\\s+)?suchen|nachrichten\\s+(?:zu\\s+)?(?:durch)?suchen)',
});

/**
 * The refusal shapes: first-person refusal verb, then the ability within the same
 * clause. Contrast words ('but'/'aber') and clause punctuation end the window, so
 * "I can't sing, but I can look it up" never matches - the refusal and the ability
 * must share a clause for the sentence to be a refusal OF that ability. German gets
 * a second template because its word order can put the ability in front of the
 * refusal ("nachschauen kann ich nicht").
 */
const CLAUSE = "(?:(?!\\b(?:but|aber|doch)\\b)[^.!?;:,])";
function refusalShapes(ability: string): RegExp[] {
  return [
    new RegExp(
      `\\b(?:i\\s+(?:won'?t|will\\s+not|can'?t|cannot|don'?t|do\\s+not|refuse\\s+to|am\\s+not\\s+(?:going|able|allowed)\\s+to|am\\s+unable\\s+to)|i\\s*'?m\\s+not\\s+(?:going|able|allowed)\\s+to|i\\s*'?m\\s+unable\\s+to)\\s+${CLAUSE}{0,50}?${ability}`,
      'iu',
    ),
    new RegExp(
      `\\bich\\s+(?:kann|werde|darf|will|mag|w(?:ü|u)rde)\\s+${CLAUSE}{0,50}?\\b(?:nichts?|kein\\w*)\\b${CLAUSE}{0,40}?${ability}|\\bich\\s+(?:google|schaue|sehe|schlage|suche|spiele|recherchiere)\\s+${CLAUSE}{0,30}?\\b(?:nichts?|kein\\w*)\\b${CLAUSE}{0,30}?(?:${ability}|\\bnach\\b|\\bab\\b)`,
      'iu',
    ),
    new RegExp(`${ability}${CLAUSE}{0,40}?\\b(?:kann|werde|darf|will|mag)\\s+ich\\s+nicht\\b`, 'iu'),
  ];
}

/** Compiled once. The map's keys ARE the claimable set; nothing else is judged. */
const COMPILED: ReadonlyMap<ClaimableAbility, RegExp[]> = new Map(
  (Object.keys(ABILITY_VOCABULARY) as ClaimableAbility[]).map((intent) => [
    intent,
    refusalShapes(ABILITY_VOCABULARY[intent]),
  ]),
);

/**
 * Predicate one: does this sentence refuse, first person, an ability we can name?
 * Returns which one, or null. Null means "not judged", never "judged fine".
 */
/**
 * A refusal that names a LIMIT rather than a refusal of the capability (CCB-S5-046, D-232).
 *
 * ── THE THIRD CASE THE FENCE DID NOT HAVE ────────────────────────────────────
 *
 * D-226 models a capability as binary: this bot holds it, or it does not, and a refusal of
 * one it holds is a lie. Reality has a third state - it holds the capability and the request
 * is outside what the capability reaches - and in that state the refusal is TRUE.
 *
 * The archive SEARCH is the case that found this. It is a keyword count over PUBLISHED
 * messages with no date filter, so "I can't search the archive that far back" is exactly
 * accurate, and the fence stripped it whole because SEARCH is in every bot's catalog. If that
 * sentence stood alone the strip left nothing, `stripInventedRefusals` threw, and free
 * conversation went silent: the honest answer to a question about yesterday was the one
 * answer the guard reliably destroyed.
 *
 * ── WHY A TRAILING QUALIFIER IS THE RIGHT SEAM ───────────────────────────────
 *
 * The shapes already reason in clause windows and already stop at a contrast word, so
 * "I can't sing, but I can look it up" is not a refusal of lookup. This is the same idea
 * pointed the other way: a scope word FOLLOWING the ability inside the same clause turns
 * "I refuse to do X" into "X does not reach that far", which is a statement about the tool
 * rather than about her will.
 *
 * ── IT FAILS TOWARDS STRIPPING, WHICH IS THE SAFE DIRECTION HERE ─────────────
 *
 * This is an exemption list over a vocabulary nobody owns, so D-201 applies and is answered
 * by which way it fails: a qualifier NOT on this list leaves the sentence stripped, so the
 * D-226 lie stays caught and only some true limitations are still lost. The residual is real
 * and is stated rather than implied - a bounded refusal phrased in words not listed here is
 * still removed, and can still cost the reply.
 */
const SCOPE_QUALIFIER =
  /\b(?:that\s+far(?:\s+back)?|back\s+that\s+far|any\s+further\s+back|further\s+back|beyond\s+that|older\s+than|that\s+long\s+ago|from\s+yesterday|before\s+(?:today|yesterday|that)|so\s+weit(?:\s+zur(?:ü|u)ck)?|weiter\s+zur(?:ü|u)ck|dar(?:ü|u)ber\s+hinaus|(?:ä|a)lter\s+als|von\s+gestern|so\s+lange\s+her)\b/iu;

export function refusedAbility(sentence: string): ClaimableAbility | null {
  for (const [intent, shapes] of COMPILED) {
    if (shapes.some((re) => re.test(sentence))) {
      // Judged only when the refusal is UNQUALIFIED. A scope word makes it a bound.
      return SCOPE_QUALIFIER.test(sentence) ? null : intent;
    }
  }
  return null;
}

/**
 * Predicate two, the ALLOW judgment: a refusal may ship exactly when this bot LACKS
 * the refused capability, because then it is the honest answer. A bot that holds the
 * capability refusing it is the lie D-226 exists for.
 */
export function refusalMayShip(
  ability: ClaimableAbility,
  capabilities: readonly Intent[],
): boolean {
  return !capabilities.includes(ability);
}

export interface StrippedRefusal {
  ability: ClaimableAbility;
  sentence: string;
}

export interface StripRefusalsResult {
  /** What remains. May be empty, and the caller must treat empty as a rejection. */
  text: string;
  /** Every sentence removed, for the counted record. Empty means nothing matched. */
  removed: StrippedRefusal[];
}

/**
 * Remove every sentence that falsely refuses a capability this bot holds. Sentences the
 * vocabulary cannot name, and refusals that are TRUE for this bot, pass through
 * untouched - see the header for why that direction is the safe one.
 */
export function stripInventedRefusals(
  text: string,
  capabilities: readonly Intent[],
): StripRefusalsResult {
  // Sentences with their trailing separators, so the survivors rejoin verbatim.
  const parts = text.match(/[^.!?\n]+[.!?]*[\s\n]*/gu) ?? [text];
  const removed: StrippedRefusal[] = [];
  const kept: string[] = [];
  for (const part of parts) {
    const ability = refusedAbility(part);
    if (ability !== null && !refusalMayShip(ability, capabilities)) {
      removed.push({ ability, sentence: part.trim() });
    } else {
      kept.push(part);
    }
  }
  if (removed.length === 0) return { text, removed };
  return { text: kept.join('').replace(/\s{2,}/gu, ' ').trim(), removed };
}
