/**
 * The addressing model (CCB-S3-002 §1): deciding whether a group message is
 * talking TO Cinderella or merely ABOUT her.
 *
 * The wake word is her name, not a phrase, which is what makes this work in any
 * language for free — a greeting in front of it is optional decoration that gets
 * stripped, so `Hallo Cinderella`, `Bonjour Cinderella` and `Good morning
 * Cinderella` all land the same way without a per-language rule.
 *
 * STRICT ANCHORING is the safety property here. The name must be the FIRST
 * standalone word, with only a greeting permitted before it:
 *
 *   `Cinderella, publish me`      → addressed
 *   `Hey Cinderella publish me`   → addressed
 *   `I think Cinderella is great` → NOT addressed (name is not first)
 *   `Cinderella's archive is nice`→ NOT addressed (possessive, not standalone)
 *   `Cinderellas Archiv ist gut`  → NOT addressed (compound, not standalone)
 *
 * The possessive/compound cases are the reason fuzzy matching cannot be applied
 * naively: `cinderellas` is one edit away from `cinderella`, so plain edit
 * distance would forgive exactly the case the briefing requires us to ignore.
 * {@link matchesWakeWord} therefore refuses any token that is the wake word plus
 * a suffix, while still forgiving `cinderela` and `cinderlla`.
 *
 * When in doubt, stay silent: a missed address is a minor annoyance, an unwanted
 * interjection in a busy group is not.
 */

import type { InteractionSettings } from './settings.js';
import { levenshtein, maxDistanceFor, normTokens, tokenize, type Token } from './text.js';

export type AddressKind = 'wake' | 'nickname' | 'none';

export interface AddressResult {
  kind: AddressKind;
  /** Text following the wake word — what the resolver is asked to understand. */
  instruction: string;
  /** Which nickname was used, when `kind === 'nickname'`. */
  nickname: string | undefined;
  /**
   * Whether a greeting preceded the name (CCB-S3-005). This is the difference
   * between someone SAYING her name and someone GREETING her: `Hey Cinderella
   * blargh` is unmistakably aimed at her, while a message merely beginning with
   * her name very often is not. It is the primary strong-signal input, and in
   * `strict` mode it is required.
   */
  greeted: boolean;
}

const NOT_ADDRESSED: AddressResult = {
  kind: 'none',
  instruction: '',
  nickname: undefined,
  greeted: false,
};

/**
 * Does this token address her by name? Exact match always wins; a small typo is
 * forgiven; a suffixed form (possessive, German compound) never is.
 */
export function matchesWakeWord(tokenNorm: string, wakeNorm: string): boolean {
  if (!wakeNorm || !tokenNorm) return false;
  if (tokenNorm === wakeNorm) return true;
  // `cinderellas`, `cinderellax` — the name plus something. Not an address.
  if (tokenNorm.length > wakeNorm.length && tokenNorm.startsWith(wakeNorm)) return false;
  const max = maxDistanceFor(wakeNorm.length);
  if (max === 0) return false;
  if (Math.abs(tokenNorm.length - wakeNorm.length) > max) return false;
  return levenshtein(tokenNorm, wakeNorm, max) <= max;
}

/**
 * How many tokens of a multi-token name matched here, or 0 (CCB-S5-014, D-172).
 *
 * ── WHY THE NAME IS A SEQUENCE AND NOT A STRING ──────────────────────────────
 *
 * `detectAddress` compared ONE token against the whole folded wake word, so a name with a
 * space in it could never match: "rick" against "rick sanchez" fails the exact test, fails
 * the prefix guard, and is rejected by the length gate before Levenshtein is reached. D-166
 * refused such a wake word for that reason and said in its own title that the refusal was
 * temporary. This is what lifts it.
 *
 * ── THE FUZZY RULE, WHICH IS THE PART THAT COULD GO WRONG ───────────────────
 *
 * Per TOKEN, never over the joined string. `maxDistanceFor` scales with length, so applying
 * it to "rick sanchez" as one 12-character string would buy a budget of 2 edits anywhere in
 * it, and a longer name would become an easier target than a short one. Per token, each
 * token's allowance is sized to that token.
 *
 * And **at most one token in the whole name may be inexact**. That is the generalisation of
 * what a single-token name already does - its one token may be inexact - and it is what makes
 * a longer name STRICTER rather than looser: every token beyond the first must be exactly
 * right, so "Rick Sanchez" is harder to hit by accident than "Sanchez" is, not easier.
 *
 * A total budget instead of a per-token one was considered and rejected: it would let two
 * half-wrong tokens through, which is the shape of an accidental match rather than a typo.
 */
export function matchWakeSequence(
  tokens: readonly Token[],
  from: number,
  wakeTokens: readonly string[],
): number {
  if (wakeTokens.length === 0) return 0;
  if (from + wakeTokens.length > tokens.length) return 0;

  let inexact = 0;
  for (let i = 0; i < wakeTokens.length; i++) {
    const got = tokens[from + i]?.norm ?? '';
    const want = wakeTokens[i] ?? '';
    if (got === want) continue;
    // One typo in the whole name, wherever it falls. A second means this is not the name.
    if (inexact > 0) return 0;
    if (!matchesWakeWord(got, want)) return 0;
    inexact++;
  }
  return wakeTokens.length;
}

/** The same, exact only: nicknames are never fuzzy (§6) and may also be several words. */
export function matchNicknameSequence(
  tokens: readonly Token[],
  from: number,
  nickTokens: readonly string[],
): number {
  if (nickTokens.length === 0) return 0;
  if (from + nickTokens.length > tokens.length) return 0;
  for (let i = 0; i < nickTokens.length; i++) {
    if (tokens[from + i]?.norm !== nickTokens[i]) return 0;
  }
  return nickTokens.length;
}

/**
 * Greetings are matched EXACTLY, not fuzzily. They are optional decoration, and
 * a fuzzy greeting could swallow a real word standing where a greeting would be
 * — which would shift what counts as the "first" word and defeat the anchoring.
 */
function consumePrefix(tokens: Token[], greetings: string[][], maxWords: number): number {
  let consumed = 0;
  for (const g of greetings) {
    if (g.length <= consumed) continue;
    if (g.length > tokens.length) continue;
    if (g.length > maxWords) continue;
    let ok = true;
    for (let i = 0; i < g.length; i++) {
      if (tokens[i]?.norm !== g[i]) {
        ok = false;
        break;
      }
    }
    if (ok) consumed = g.length;
  }
  return consumed;
}

/** Leading separators between the name and the instruction: `Cinderella, - publish me`. */
const LEADING_SEPARATORS = /^[\s,;:.!?–—-]+/;

/**
 * Classifies a message as addressed by name, addressed by nickname, or not
 * addressed at all. Pure — the follow-up window and reply-to-bot paths are the
 * caller's business (they need conversation state; this does not).
 */
export function detectAddress(text: string, s: InteractionSettings): AddressResult {
  if (!text.trim()) return NOT_ADDRESSED;

  const tokens = tokenize(text);
  if (tokens.length === 0) return NOT_ADDRESSED;

  // Greetings AND short discourse fillers may precede the name (CCB-S3-006 §7d):
  // "so cinderella, what is BTC worth" is plainly addressed to her, and rejecting
  // it taught members to re-type the whole sentence. Longest first, so
  // `good morning` wins over a bare `good`.
  const prefixes = [...s.greetings, ...s.fillerPrefixes]
    .map((g) => normTokens(g))
    .filter((g) => g.length > 0)
    .sort((a, b) => b.length - a.length);

  // The prefix stays SHORT and bounded, so a long sentence that merely contains
  // her name still is not an address — the CCB-S3-005 anchoring is untouched.
  let skip = consumePrefix(tokens, prefixes, s.maxPrefixWords);
  const prefixChars = skip > 0 ? (tokens[skip - 1]?.end ?? 0) : 0;
  if (prefixChars > s.maxPrefixChars) skip = 0;
  const head = tokens[skip];
  if (!head) return NOT_ADDRESSED; // a bare greeting, addressed to nobody

  const instructionFrom = (t: Token): string =>
    text.slice(t.end).replace(LEADING_SEPARATORS, '').trim();

  // Only a real GREETING is a strong address signal (CCB-S3-005 §2). A discourse
  // filler like "so" is not someone greeting her, so it must not unlock the
  // not-understood reply.
  const greetingSets = s.greetings.map((g) => normTokens(g).join(' ')).filter((g) => g);
  const consumedText = tokens
    .slice(0, skip)
    .map((t) => t.norm)
    .join(' ');
  const greeted = skip > 0 && greetingSets.includes(consumedText);

  // ── THE NAME IS A TOKEN SEQUENCE (CCB-S5-014) ─────────────────────────────
  //
  // One or more tokens, anchored at exactly the same place a single-token name was: the
  // first token after any greeting or filler prefix. Nothing about the anchoring changes,
  // which is what keeps "a long sentence that merely contains her name" from being an
  // address, and `maxPrefixWords` / `maxPrefixChars` keep their meaning too because they
  // bound what comes BEFORE the name and not the name itself.
  const wakeMatched = matchWakeSequence(tokens, skip, normTokens(s.wakeWord));
  if (wakeMatched > 0) {
    // Strict mode (CCB-S3-005 §4): the name alone is not an address, a greeting
    // must precede it. Direct replies, the follow-up window and slash commands
    // bypass this entirely — they are handled by the caller, not here.
    if (s.addressing.mode === 'strict' && !greeted) return NOT_ADDRESSED;
    // From the LAST token of the name, so a two-word name does not leave its second word
    // at the front of the instruction.
    const last = tokens[skip + wakeMatched - 1] ?? head;
    return { kind: 'wake', instruction: instructionFrom(last), nickname: undefined, greeted };
  }

  // Nicknames match EXACTLY (§6). They are short — `cin`, `ella` — and a fuzzy
  // match on a three or four letter word would fire on ordinary German and
  // English words, which would make her interrupt conversations to be sarcastic.
  //
  // Multi-token since CCB-S5-014, for the same reason the wake word is: a bot called in two
  // words has near-misses in two words, and "Rick baby" could not have been refused. Longest
  // first, so a two-word nickname wins over a one-word one that is its prefix.
  if (s.nicknames.enabled) {
    const byLength = [...s.nicknames.words]
      .map((nick) => ({ nick, tokens: normTokens(nick) }))
      .sort((a, b) => b.tokens.length - a.tokens.length);
    for (const { nick, tokens: nickTokens } of byLength) {
      const n = matchNicknameSequence(tokens, skip, nickTokens);
      if (n > 0) {
        // A nickname is answered in both modes: refusing to answer to "Cindy" is
        // the point, and staying silent would read as her accepting it.
        const last = tokens[skip + n - 1] ?? head;
        return { kind: 'nickname', instruction: instructionFrom(last), nickname: nick, greeted };
      }
    }
  }

  return NOT_ADDRESSED;
}

/**
 * Was this message addressed by name or nickname, ignoring conversation state?
 * Used on message EDITS, where re-running the whole dialogue would be wrong but
 * silently archiving an instruction aimed at the bot would be worse.
 */
export function isExplicitlyAddressed(text: string, s: InteractionSettings): boolean {
  return detectAddress(text, s).kind !== 'none';
}
