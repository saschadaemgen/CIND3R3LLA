/**
 * The laws have numbers (CCB-S5-005, D-159).
 *
 * ── WHY THE NUMBER IS DERIVED AND NOT STORED ─────────────────────────────────
 *
 * A stored number is a second identifier, and a second identifier drifts: a law created in
 * the console would need one allocated, a law disabled would leave a hole, and the day the
 * two disagree there is no way to say which is the law's real number. So the number IS a
 * position in the registry, computed the same way every time, and there is nothing to keep in
 * step because there is only one thing.
 *
 * ── SORTED BY ID, WHICH IS THE ONLY ORDER AN OPERATOR CANNOT MOVE ────────────
 *
 * The obvious ordering is `ord`, the prompt order. It is the wrong one: `ord` is EDITABLE
 * from the Book of Elii (CCB-S4-043), so an operator reordering two lines of the prompt would
 * renumber every law after them, and "law 12" would mean something different than it did an
 * hour ago. The id cannot be edited at all, only set once when a law is created, so an
 * id-sorted position moves only when the SET moves, which is a real change to the book.
 *
 * The comparison is on raw code units rather than `localeCompare`, deliberately. A collation
 * that depends on the host's ICU build is not a stable numbering, and ids are lowercase ASCII
 * with dots and hyphens, so the two orders agree anyway. This one agrees everywhere.
 *
 * ── AND WHY ONLY THE ONES SHE CAN SHOW ARE NUMBERED ──────────────────────────
 *
 * The briefing proposes numbering every law and answering "that one I keep" for a withheld
 * number, on the ground that a withheld law's number reveals nothing. That is true of one
 * number and false of all of them together, which is the shape CCB-S4-046 keeps finding.
 * Ids are family-clustered (`ceiling.*`, `memory.*`, `moderation.*`), so an id-sorted
 * numbering puts a withheld law between two she will read out; a member who walks 1..106 and
 * writes down which numbers come back withheld can read each one's SUBJECT off its
 * neighbours. That is narrowing the withheld set by topic, which is precisely what
 * `disclosure.never-narrow` forbids and what the elimination gate exists to stop.
 *
 * So the numbering covers the nameable set, and the denominator is the nameable count, which
 * is also the briefing's own example sentence: "law 12 of the 61 I can show you". A number
 * outside it is answered honestly and reveals no position: there is no law there she can
 * read, this many she can, and more that stay hers.
 */

import { promptRulePlaceholders, type PromptRule, type PromptRuleSet } from './prompt-rules.js';

/** Code-unit order. See the header: a numbering must not depend on the host's collation. */
function byId(a: PromptRule, b: PromptRule): number {
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/**
 * Placeholders that ASSEMBLE one reply rather than state a law.
 *
 * ── WHY THIS DECIDES WHAT HAS A PAGE, AND WHY IT IS NOT A WORKAROUND ─────────
 *
 * A page is a law somebody can be handed on its own and read as a law. A sentence built
 * around one of these is not that: `disclosure.invocations` says "here is what the record
 * holds for the ones quoted to you: {{ruleInvocations}}", which outside the reply that
 * supplies them is a sentence with a hole in it. Same for the overview's counts, the memory
 * window's two numbers and the fence delimiters.
 *
 * It is also what keeps the numbering from breaking replies. These values exist only while
 * one prompt is being built, so `renderRuleForMember` THROWS on a rule that needs one, and a
 * member asking for that page number would otherwise have taken the whole reply down for a
 * reason nothing on the surface explains. Two reasons, one line, and the definition is the
 * honest one rather than the convenient one.
 *
 * `nameableRules` is in here for a third reason as well: rendering the rule that CARRIES the
 * quoted block into that block is a rule quoting itself, which `rulesForQuestion` and
 * `rulesForFollowUp` already exclude for exactly that reason.
 */
const REPLY_ASSEMBLY_PLACEHOLDERS: ReadonlySet<string> = new Set([
  'nameableRules',
  'ruleInvocations',
  'ruleTotal',
  'ruleConstitutional',
  'ruleAreas',
  'moreInArea',
  'maxChars',
  'fence',
  'historyFence',
  'historyCount',
  'historyMinutes',
]);

/**
 * Whether this law can be turned to as a page.
 *
 * Enabled AND nameable: a law an operator switched off is not one she is operating under, and
 * numbering it would give a member a page that describes behaviour she does not have. And it
 * has to stand on its own; see {@link REPLY_ASSEMBLY_PLACEHOLDERS}.
 */
function pageable(rule: PromptRule): boolean {
  return (
    rule.enabled &&
    rule.nameable &&
    !promptRulePlaceholders(rule).some((placeholder) =>
      REPLY_ASSEMBLY_PLACEHOLDERS.has(placeholder),
    )
  );
}

/** The laws she can show, in the order they are numbered. */
export function numberedLaws(rules: PromptRuleSet): PromptRule[] {
  return rules.filter(pageable).sort(byId);
}

/** How many she can quote by number. The denominator in "law 12 of 66". */
export function numberedLawCount(rules: PromptRuleSet): number {
  return rules.filter(pageable).length;
}

/**
 * Every numbered law's page, for the console.
 *
 * The SAME computation the chat uses, which is the point: the briefing asks that the operator
 * see the page numbers a member does, and two implementations of a numbering would eventually
 * be two numberings.
 */
export function lawPages(rules: PromptRuleSet): ReadonlyMap<string, number> {
  return new Map(numberedLaws(rules).map((rule, index) => [rule.id, index + 1]));
}

/** This law's number, or null when it is not one of the numbered ones. */
export function lawNumberOf(rules: PromptRuleSet, ruleId: string): number | null {
  const index = numberedLaws(rules).findIndex((rule) => rule.id === ruleId);
  return index < 0 ? null : index + 1;
}

/** The law at this number, or null when there is none. 1-based, like the member's question. */
export function lawByNumber(rules: PromptRuleSet, position: number): PromptRule | null {
  if (!Number.isInteger(position) || position < 1) return null;
  return numberedLaws(rules)[position - 1] ?? null;
}

/**
 * The next page after this one, wrapping at the end.
 *
 * ── WHY "TELL ME ANOTHER" IS A PAGE TURN AND NOT A SEARCH ────────────────────
 *
 * Measured while building this: after a scene, "tell me another" went through the ordinary
 * keyword selector and came back with `disclosure.more-in-area`, a rule about how she answers
 * questions about rules, because it happens to contain the word "another". Every check passed
 * and the answer was noise, which is the CCB-S4-045 near-miss failure arriving through the
 * single commonest follow-up this feature has.
 *
 * A bare "another" carries no subject to select on. What it means is literally the next page,
 * and the book now has page numbers, so that is what it gets. Deterministic, in order, and
 * the same tomorrow.
 */
export function nextLawAfter(rules: PromptRuleSet, lawId: string | null): PromptRule | null {
  const laws = numberedLaws(rules);
  if (laws.length === 0) return null;
  const at = lawId ? laws.findIndex((rule) => rule.id === lawId) : -1;
  return laws[(at + 1) % laws.length] ?? null;
}

/**
 * The numbers of the laws quoted to her, as one phrase for the prompt.
 *
 * Application-supplied like every other count on this path (D-137). She is told which numbers
 * these are; she is not asked to work them out, because a model counting positions in a list
 * it was handed is a model that will hand a member the wrong page.
 */
export function renderLawNumbers(
  rules: PromptRuleSet,
  quoted: readonly PromptRule[],
  german: boolean,
): string {
  const numbers = quoted
    .map((rule) => lawNumberOf(rules, rule.id))
    .filter((n): n is number => n !== null)
    .map(String);
  if (numbers.length === 0) return '';
  if (numbers.length === 1) {
    return german ? `Gesetz ${numbers[0] ?? ''}` : `law ${numbers[0] ?? ''}`;
  }
  const last = numbers[numbers.length - 1] ?? '';
  return german
    ? `Gesetze ${numbers.slice(0, -1).join(', ')} und ${last}`
    : `laws ${numbers.slice(0, -1).join(', ')} and ${last}`;
}

/**
 * A member asking for a law by its number.
 *
 * ── DETERMINISTIC, LIKE EVERY OTHER DECISION ON THIS PATH ────────────────────
 *
 * Same reasoning as the disclosure trigger and the pre-search gate: which law gets quoted is
 * not a judgement to hand a model. It is a lookup, the member has already done the choosing,
 * and the application can do it exactly.
 *
 * It requires a LAW WORD next to the digits. A bare number is a price, a quantity, a year or
 * somebody counting, and every one of those arrives in this chat. "Law 12", "rule 12",
 * "Gesetz 12" is somebody holding a page number.
 */
const LAW_NUMBER =
  /\b(?:law|rule|gesetz|regel)\s*(?:number|no\.?|nr\.?|nummer|#)?\s*(\d{1,4})\b|\b(?:number|nummer|no\.?|nr\.?|#)\s*(\d{1,4})\b[^?]{0,32}\b(?:book|buch|eli+|law|laws|rule|rules|gesetz|gesetze|regel|regeln)\b|\b(?:book|buch|eli+)\b[^?]{0,32}\b(?:number|nummer|no\.?|nr\.?|#)\s*(\d{1,4})\b/i;

/** The number they asked for, or null when this is not a question about one. */
export function asksForLawNumber(text: string): number | null {
  const match = LAW_NUMBER.exec(text);
  if (!match) return null;
  const digits = match.slice(1).find((group) => group !== undefined);
  if (digits === undefined) return null;
  const parsed = Number.parseInt(digits, 10);
  return Number.isFinite(parsed) ? parsed : null;
}
