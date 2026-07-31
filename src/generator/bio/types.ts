/**
 * Bio generator: types (CCB-S4-006).
 *
 * Fourth component of the profile generator. Turns a personality into the short piece
 * of text a profile carries. Template path only; the model path is out of scope (§11).
 *
 * ── THE FAILURE THIS COMPONENT EXISTS TO PREVENT IS POPULATION-LEVEL ────────
 *
 * Individually plausible bios that share a visible structure are the classic tell of
 * generated data: identical field-completion patterns, the same sentence skeleton with
 * substituted nouns, the same length distribution. A reader scrolling a member list
 * notices that long before they notice anything wrong with a single line.
 *
 * Two consequences run through every type below. `pattern` exists on the RESULT, not as
 * an internal detail, because §6 cannot be measured without it. And the template set is
 * versioned data with a loader that refuses a set without a version, because it is the
 * FOURTH authored set after the archetypes, the loadings and the coverage regions, and
 * the previous three all acquired structure nobody intended.
 */

import type { BioTheme, Surface } from '../surface/types.js';
import type { Latent } from '../traits/types.js';

export type { BioTheme };

/** §4's configuration surface. `empty` is the share of profiles carrying no bio at all. */
export const BIO_LENGTHS = ['empty', 'short', 'medium', 'long'] as const;
export type BioLength = (typeof BIO_LENGTHS)[number];

/** What the bio generator reads. Latent plus the surface blocks. */
export interface Personality {
  latent: Latent;
  style: Surface['style'];
  identity: Surface['identity'];
  rhythm: Surface['rhythm'];
  content: Surface['content'];
}

/**
 * One clause template. Slots are `{interest}`, `{interest2}` and `{noun}`.
 *
 * Clauses rather than whole-bio skeletons, deliberately. A fixed set of skeletons with
 * substituted words is the obvious implementation and the obvious failure: it passes
 * individually and collapses in aggregate. Composing 1 to 3 clauses out of a pool, then
 * varying the separator, the capitalisation, the terminal punctuation and the emoji,
 * multiplies a modest authored pool into a large structural space. That is §6's
 * requirement that variety come from more than one mechanism, and clause composition is
 * only the first of them.
 */
export interface ClausePool {
  /** Clauses that read as fragments: no verb, or no subject. Real bios are often these. */
  fragments: string[];
  /** Clauses that read as sentences. */
  sentences: string[];
  /** Theme-specific nouns for the `{noun}` slot. */
  nouns: string[];
}

export interface LanguageTemplates {
  /** Language tag, e.g. `en`. */
  language: string;
  /**
   * Interest key to its label in this language. An interest named in English inside a
   * German sentence is §7's failure one layer down, and the population statistics pass
   * while the text reads "arbeite an cooking". Empty for the language the keys are in.
   */
  interestLabels: Record<string, string>;
  /** Separators used to join clauses. Variety here is one of the §6 mechanisms. */
  separators: string[];
  /**
   * Whether the lower-case habit may be applied to this language.
   *
   * PER LANGUAGE BECAUSE IT IS AN ENGLISH HABIT. German capitalises nouns, so a
   * lower-cased German bio is not a casual style but a spelling error, and the mechanism
   * was applied to German unchanged: "meine abende gehen fast alle fuer gaertnern drauf".
   * A language that opts out varies on five mechanisms rather than six, which the harness
   * reports rather than papering over with an invented sixth.
   */
  allowLowercase: boolean;
  themes: Record<Exclude<BioTheme, 'none'>, ClausePool>;
}

export interface TemplateSet {
  /** Names this set. A measured pattern share is a property of a specific set. */
  version: string;
  /** Culture key to language tag. Which language a bio is in follows `originBlend` (§7). */
  originLanguages: Record<string, string>;
  /** Language used when an origin maps to one with no authored templates. Counted. */
  fallbackLanguage: string;
  languages: Record<string, LanguageTemplates>;
  /** Emoji a bio may carry. NOT the eight verified reaction emoji: those constrain what
   *  the core accepts as a REACTION, not what a profile description may contain (§8). */
  emoji: string[];
}

/**
 * Which engine writes the words.
 *
 * `model` is the quality default. Every defect class the read of two hundred profiles
 * found was a language defect, and language is what a model does not get wrong in those
 * ways: it writes German that is German, does not calque idiom, does not repeat itself,
 * writes umlauts, capitalises nouns, and holds a register.
 *
 * `template` is the fallback, so the tool keeps working with no model reachable and so
 * load-test populations at scale do not need one. It is deliberately plain and quiet.
 */
export type TextEngine = 'template' | 'model';

export interface BioPopulationConfig {
  /** Which engine writes the text. Per run, because the expensive case and the quality
   *  case barely overlap: nobody reads a hundred thousand load-test bios. */
  engine: TextEngine;
  /** §3's target. Research puts real platforms at 0.60 to 0.75, higher on privacy-focused ones. */
  bioEmpty: number;
  /**
   * The empty rate the TEMPLATE path runs at, which is deliberately above `bioEmpty`.
   *
   * A fallback that produces wrong text is worse than one that produces none. An empty
   * bio is realistic, since most real profiles have one; a calqued German fragment is a
   * tell. Given the choice between an incorrect bio and no bio, the honest fallback for
   * "I cannot write this well" is silence, so the template path stays quieter than the
   * population it is standing in for. Ignored by the model path.
   */
  templateEmptyFloor: number;
  /** §4's configuration surface, including `empty`. Shares over the whole population. */
  bioLength: Record<BioLength, number>;
  /** Median word counts per length bucket, before the log-normal draw. */
  lengthMedians: Record<Exclude<BioLength, 'empty'>, number>;
}

export interface BioRequest {
  seed: number;
  personality: Personality;
  templates: TemplateSet;
  population: BioPopulationConfig;
}

export interface BioResult {
  /** `null` when empty, which is the majority (§3). */
  text: string | null;
  theme: BioTheme | null;
  length: BioLength;
  /**
   * A DERIVED STRUCTURAL SIGNATURE, not a template identifier (§12.1).
   *
   * §12.1 leaves the choice open and answers itself: an identifier "only catches
   * template reuse; a signature also catches two different templates producing the same
   * shape". The second is the failure mode that matters, because §6 is about what a
   * reader sees and a reader cannot see which template was used.
   */
  pattern: string;
  language: string;
  emojiCount: number;
}
