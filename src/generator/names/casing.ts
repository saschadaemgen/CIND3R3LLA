/**
 * Stage 6: casing (briefing §5, §9).
 *
 * The rule that makes this non-trivial: "Capitalisation is not title-case every
 * word. `van der Meer` keeps its lower-case particle."
 *
 * So `natural` casing must not touch a name that is already correctly cased. It is
 * the identity function on well-formed parts, which is the whole point: the culture
 * grammar produced the correct form and casing must not undo it.
 */

import type { NameCase, NamePart } from './types.js';
import type { Rng } from './rng.js';

/**
 * Apply casing to the assembled parts.
 *
 * `natural` leaves parts exactly as the grammar produced them. `lower` lowercases
 * everything, which is a common self-presentation on privacy-focused platforms.
 * `mixed` lowercases SOME parts and leaves others, producing the inconsistent
 * casing real people actually use, deterministically per name.
 *
 * A particle part is never uppercased by any mode. Under `natural` it stays as
 * authored; under `lower` it is already lower; under `mixed` it is left alone
 * rather than randomised, because `Van der Meer` is a different (and wrong) name
 * rather than a stylistic variant.
 */
export function applyCasing(parts: NamePart[], nameCase: NameCase, rng: Rng): NamePart[] {
  if (nameCase === 'natural') return parts;

  if (nameCase === 'lower') {
    return parts.map((part) => ({ ...part, value: part.value.toLocaleLowerCase() }));
  }

  // mixed: decide per part, deterministically.
  return parts.map((part) => {
    if (part.kind === 'particle') return part;
    // Initials stay upper: `m.k.` reads as a typo rather than a style.
    if (part.kind === 'initial') return part;
    return rng.chance(0.5) ? { ...part, value: part.value.toLocaleLowerCase() } : part;
  });
}

/**
 * Capitalise the first letter of a word, leaving the rest untouched.
 *
 * `toLocaleUpperCase` on the first code point only: uppercasing the whole string
 * and re-lowering would destroy `McDonald` and `O'Hara`, and would break the
 * intra-word capital in hyphenated `Jean-Pierre`.
 */
export function capitaliseFirst(word: string): string {
  if (word.length === 0) return word;
  const first = [...word][0]!;
  return first.toLocaleUpperCase() + word.slice(first.length);
}

/**
 * Capitalise each hyphen-separated segment: `jean-pierre` becomes `Jean-Pierre`.
 * Used when building a name from a lower-case word pool, never on corpus names,
 * which arrive already cased.
 */
export function capitaliseName(word: string): string {
  return word
    .split('-')
    .map((segment) => capitaliseFirst(segment))
    .join('-');
}
