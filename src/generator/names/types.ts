/**
 * Name generator: types and the corpus contract.
 *
 * First component of the profile generator. Standalone and deterministic: no
 * repository schema, no runtime, no database, no SimpleX call.
 *
 * The corpus is INJECTED rather than read here. That is what makes the "no
 * filesystem at call time" rule (briefing §2) structural instead of a discipline,
 * and it is what lets a labelled corpus replace the fixtures without touching the
 * loader or the engine.
 */

/** A name type, per briefing §6. */
export type NameType =
  | 'real'
  | 'firstName'
  | 'mononym'
  | 'initials'
  | 'handle'
  | 'pseudonym'
  | 'fantasy';

export const NAME_TYPES: readonly NameType[] = [
  'real',
  'firstName',
  'mononym',
  'initials',
  'handle',
  'pseudonym',
  'fantasy',
] as const;

/**
 * How a culture builds a full name (briefing §5).
 *
 * `mononym` has no family name at all; `patronymicOnly` (Icelandic) has a
 * patronymic and no family name to fall back to. Nothing here may assume two
 * tokens, and nothing may require a family part to exist.
 */
export type GrammarStructure =
  | 'givenFamily'
  | 'familyGiven'
  | 'givenPatronymicFamily'
  | 'patronymicOnly'
  | 'givenNasabFather'
  | 'mononym'
  | 'givenPaternalMaternal';

export type GenderPresentation = 'female' | 'male' | 'neutral' | 'unspecified';

/** Age bands bias the name-type draw (teens toward handles). */
export type AgeBand = 'teen' | 'youngAdult' | 'adult' | 'middleAged' | 'senior';

export type NameCase = 'natural' | 'lower' | 'mixed';

/**
 * A typed part of a name. `value` MAY CONTAIN SPACES: `van der Meer` is one
 * family part, not three. Downstream (the bio generator, addressing logic) needs
 * to know which part is the given name, which is why parts are returned at all.
 */
export interface NamePart {
  kind: 'given' | 'family' | 'patronymic' | 'particle' | 'handle' | 'initial';
  value: string;
}

/** Grammar metadata for one culture. Authored, not derived from the corpus. */
export interface CultureGrammar {
  /** Stable key, matching the culture key used by the corpus. */
  culture: string;
  /** Human-readable label, for diagnostics only. */
  label: string;
  structure: GrammarStructure;
  /**
   * Surname particles that stay lower-case and remain part of the family part
   * (`van der`, `von`, `de la`). Empty for cultures that have none.
   */
  particles: readonly string[];
  /** Probability a drawn family name is given a particle, 0..1. */
  particleProbability: number;
  /**
   * Patronymic affixes by gender, for cultures that build one from the father's
   * given name. Icelandic: `-sson` / `-sdóttir`. East Slavic: `-ovich` / `-ovna`.
   */
  patronymic?: {
    suffixMale: string;
    suffixFemale: string;
    /** East Slavic family names are gendered too. */
    familySuffixFemale?: string;
  };
  /** Arabic nasab particles: `ibn` / `bint`. */
  nasab?: { male: string; female: string };
}

/**
 * THE CORPUS CONTRACT.
 *
 * This is the interface a labelled corpus must satisfy. The shipped
 * `names_data.json` does NOT satisfy the culture half of it: it is five flat,
 * unlabelled arrays (36,162 given names, 21,967 surnames, three fantasy pools).
 * The `cultures` map is therefore populated from a clearly-named FIXTURE file
 * until real labelled pools exist.
 *
 * To drop in a labelled corpus: produce this shape. Nothing else changes.
 */
export interface NameCorpus {
  /**
   * Names this corpus composition.
   *
   * ADDED UNDER CCB-S4-007, which requires a review to record the versions of all four
   * component data sets and to fail if any is missing. Three of the four carried one;
   * this was the gap, and it was found by the requirement rather than by anyone looking.
   *
   * Composed from the two AUTHORED inputs plus a constant naming the shipped bulk
   * corpus, because that file is a dataset this project did not author and cannot
   * meaningfully version.
   */
  version: string;
  /**
   * Per-culture name pools. A culture absent from this map falls back to
   * `general`, which is the unlabelled corpus.
   */
  cultures: Readonly<Record<string, CulturePool>>;
  /** The unlabelled bulk corpus. Used for cultures with no labelled pool. */
  general: CulturePool;
  /** Word pools for handles and pseudonyms. Not real-name pools. */
  words: WordPools;
  /** Fantasy pools, present in the shipped corpus. */
  fantasy: FantasyPools;
}

/**
 * One culture's name pools.
 *
 * Given names are split by gender presentation where the data supports it. The
 * unlabelled corpus has no gender information, so it puts everything in
 * `givenNeutral` and gendered draws fall back to it. That fallback is visible
 * rather than silent: `NameResult.genderResolved` reports what actually happened.
 */
export interface CulturePool {
  givenFemale: readonly string[];
  givenMale: readonly string[];
  givenNeutral: readonly string[];
  family: readonly string[];
}

export interface WordPools {
  /** Given-name-shaped words for pseudonyms. Not real given names. */
  pseudonymGiven: readonly string[];
  /** Surname-shaped words for pseudonyms. Not real surnames. */
  pseudonymFamily: readonly string[];
  /** Handle vocabulary: adjectives/modifiers. */
  handleModifier: readonly string[];
  /** Handle vocabulary: nouns. */
  handleNoun: readonly string[];
}

export interface FantasyPools {
  adjectives: readonly string[];
  nouns: readonly string[];
  iconic: readonly string[];
}

/** Input, per briefing §9. */
export interface NameRequest {
  seed: number;
  /** Weights across the population. Need not sum to 1; they are normalised. */
  cultureMix: Record<string, number>;
  /** Chance this one name mixes two cultures, 0..1. */
  blendProbability: number;
  nameStyleMix: Partial<Record<NameType, number>>;
  genderPresentation: GenderPresentation;
  ageBand?: AgeBand;
  /** Continuous 0..100, not a set of steps. */
  fantasyIntensity: number;
  nameCase: NameCase;
}

/** Output, per briefing §9. */
export interface NameResult {
  /** Sanitised, safe to hand to SimpleX. */
  displayName: string;
  /** The culturally correct name, before sanitisation. */
  originalName: string;
  /** True when the two differ, so a stripped character is visible, not silent. */
  sanitised: boolean;
  nameType: NameType;
  pattern: string;
  /** One culture, or two when blended. */
  cultures: string[];
  parts: NamePart[];
  /**
   * What the gender draw actually resolved to. Reports `unspecified` when a
   * gendered request fell back to an ungendered pool, so a corpus limitation is
   * visible in the result rather than quietly ignored.
   */
  genderResolved: GenderPresentation;
}

/** The default SimpleX style mix (briefing §7). Leans pseudonymous. */
export const DEFAULT_NAME_STYLE_MIX: Readonly<Partial<Record<NameType, number>>> = {
  pseudonym: 0.45,
  firstName: 0.2,
  real: 0.15,
  mononym: 0.08,
  initials: 0.07,
  fantasy: 0.05,
} as const;
