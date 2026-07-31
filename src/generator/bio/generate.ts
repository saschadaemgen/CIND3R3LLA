/**
 * Bio generation, and the structural signature that makes §6 measurable.
 *
 * ── THIS IS THE FALLBACK PATH. THE MODEL PATH IS THE PRIMARY ONE (D-104) ───
 *
 * §6 asked for six mechanisms, and six were built, and the result read badly enough to
 * move bio text to a model. Six independent mechanisms multiply the ways a line can be
 * wrong while the diagnostic governing them counts only how many distinct SHAPES appear,
 * which is why 279 patterns at 4.6 percent coexisted with "arbeite an Kochen".
 *
 * So this path no longer optimises variety. Its job is to be PLAINLY CORRECT OR SILENT,
 * and two of the six mechanisms have been withdrawn on that ground rather than fixed:
 *
 *   1. clause composition   1 to 3 clauses drawn from a themed pool, sharing a slot pool
 *                           so one interest is never named twice
 *   2. fragment or sentence  chosen per clause, not per bio
 *   3. separator             six of them, all typeable on a phone keyboard
 *   4. capitalisation        English only. German capitalises nouns, so lower-casing it is
 *                           a spelling error rather than a habit
 *   5. terminal punctuation  present or absent
 *   6. emoji                 WITHDRAWN. Drawn from a flat pool with no view of the
 *                           interests, it put a telescope on a baking profile. Coupling it
 *                           to the interests is more machinery for the one path whose job
 *                           is to have less; the model path writes its own, coherently.
 *
 * Four varying mechanisms in English, three in German. `verify:bio` reports the realised
 * count rather than asserting six, because the number was never the goal.
 */

import { Rng } from '../rng.js';
import type {
  BioLength,
  BioPopulationConfig,
  BioResult,
  ClausePool,
  Personality,
  TemplateSet,
} from './types.js';

const STREAM_EMPTY = 'bio:empty';
const STREAM_LENGTH = 'bio:length';
const STREAM_CLAUSES = 'bio:clauses';
const STREAM_SEPARATOR = 'bio:separator';
const STREAM_CASE = 'bio:case';
const STREAM_PUNCT = 'bio:punct';

function logit(p: number): number {
  const c = Math.min(0.999, Math.max(0.001, p));
  return Math.log(c / (1 - c));
}
function sigmoid(x: number): number {
  return 1 / (1 + Math.exp(-x));
}

/**
 * Share-weighted so the tier adjustment is mean-zero across the population.
 *
 * Without this the realised empty rate drifts away from the configured target purely
 * because 80 percent of a population are lurkers and lurkers are adjusted upward. The
 * adjustment should move WHO is empty, not HOW MANY.
 */
const TIER_ADJUSTMENT: Record<string, number> = {
  lurker: 0.55,
  contributor: -1.15,
  superuser: -2.4,
};
const TIER_SHARES: Record<string, number> = { lurker: 0.8, contributor: 0.19, superuser: 0.01 };
const TIER_MEAN = Object.keys(TIER_ADJUSTMENT).reduce(
  (s, k) => s + TIER_SHARES[k]! * TIER_ADJUSTMENT[k]!,
  0,
);

/**
 * Which language this avatar writes in. Follows `originBlend`, never a global default.
 *
 * WALKS THE WHOLE BLEND, not only its strongest origin. Taking the top origin and going
 * straight to English discarded a real second language: an avatar of Dutch and German
 * origin whose Dutch weight was marginally higher wrote English, although German was
 * authored and is a language that person actually has. Falling back to English is correct
 * ONLY when no origin in the blend has an authored set.
 *
 * The residue this cannot fix is the NAME. An Irish-looking name writing German is not a
 * missing language, it is the wrong one, and the cause is upstream: the shipped name
 * corpus carries no culture labels (CCB-S4-002), so a `de` request returns whatever the
 * unlabelled bulk pool gives. Nothing decided here can see that.
 */
/**
 * The language this avatar's ORIGIN implies, with no template requirement.
 *
 * The model path needs this rather than `languageFor`. A model writes Spanish without
 * anyone authoring a Spanish clause pool, so gating its language on the existence of a
 * template set imported the fallback path's limitation into the path that does not have
 * it: `Juan García Hernández` wrote English on the first real model run, for no reason
 * except that `es` had no pool the model was never going to use.
 *
 * Returns `null` when the origin maps to no language tag at all, which is the only case
 * where the caller has nothing better than the fallback language.
 */
export function originLanguageFor(personality: Personality, templates: TemplateSet): string | null {
  const byWeight = Object.entries(personality.identity.originBlend).sort((a, b) => b[1] - a[1]);
  for (const [origin] of byWeight) {
    const mapped = templates.originLanguages[origin];
    if (mapped !== undefined) return mapped;
  }
  return null;
}

export function languageFor(
  personality: Personality,
  templates: TemplateSet,
): { language: string; fellBack: boolean } {
  const byWeight = Object.entries(personality.identity.originBlend).sort((a, b) => b[1] - a[1]);
  for (const [origin] of byWeight) {
    const mapped = templates.originLanguages[origin];
    if (mapped !== undefined && templates.languages[mapped] !== undefined) {
      return { language: mapped, fellBack: false };
    }
  }
  // COUNTED, not hidden. §7's whole point is that a German-Spanish origin mix must not
  // produce uniformly English bios, so a fallback is a gap to report rather than absorb.
  return { language: templates.fallbackLanguage, fellBack: true };
}

/** Everything a clause can be split on, when the caller does not supply the real list. */
const FALLBACK_SEPARATORS = [' | ', '. ', ', ', '\n', ' / ', '; '];

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
}

/**
 * Build the clause splitter FROM the separators actually in use.
 *
 * This used to be a hand-written regex listing the separators a second time, and the two
 * lists drifted: the data file was corrected and the regex kept an em-dash nobody could
 * reach. Deriving it means there is one list, so the drift is not possible rather than
 * merely unlikely.
 */
export function clauseSplitter(separators: readonly string[] = FALLBACK_SEPARATORS): RegExp {
  // Longest first, so ", " never pre-empts a longer separator that contains it.
  const alts = [...separators].sort((a, b) => b.length - a.length).map(escapeRe);
  return new RegExp(alts.join('|'), 'u');
}

/**
 * The derived structural signature (§9, §12.1).
 *
 * Computed from the TEXT, not from which template produced it. An identifier only
 * catches template reuse; this also catches two different templates converging on the
 * same shape, which is what a reader actually perceives.
 */
export function structuralSignature(
  text: string,
  emojiCount: number,
  separators?: readonly string[],
): string {
  const trimmed = text.trim();
  const clauseCount = trimmed.split(clauseSplitter(separators)).filter((c) => c.trim().length > 0).length;
  const endsWithStop = /[.!?]$/u.test(trimmed);
  const startsUpper = /^\p{Lu}/u.test(trimmed);
  const allLower = trimmed === trimmed.toLowerCase();
  const hasVerbish = /\b(I|am|is|are|was|work|like|have|will|ich|bin|ist|sind|arbeite|mag|habe)\b/iu.test(trimmed);
  const words = trimmed.split(/\s+/u).filter(Boolean).length;
  const lengthBucket = words <= 3 ? 'w1' : words <= 8 ? 'w2' : words <= 16 ? 'w3' : 'w4';
  const emojiBucket = emojiCount === 0 ? 'e0' : emojiCount === 1 ? 'e1' : 'e2';
  return [
    `c${Math.min(clauseCount, 4)}`,
    hasVerbish ? 'sent' : 'frag',
    allLower ? 'lower' : startsUpper ? 'upper' : 'mixed',
    endsWithStop ? 'stop' : 'nostop',
    emojiBucket,
    lengthBucket,
  ].join('|');
}

/** How many distinct interests a template consumes. */
function slotsNeeded(template: string): number {
  return (template.includes('{interest}') ? 1 : 0) + (template.includes('{interest2}') ? 1 : 0);
}

function fill(
  template: string,
  pool: ClausePool,
  /** The interests THIS CLAUSE may use, already reserved by the caller. */
  claimed: string[],
  labels: Record<string, string>,
  rng: Rng,
): string {
  // Interests are LABELLED PER LANGUAGE. An English interest inside a German sentence is
  // §7's failure one layer down, and it passed every numeric check while producing
  // "arbeite an cooking".
  const label = (k: string | undefined): string | undefined => (k === undefined ? undefined : (labels[k] ?? k));
  const i1 = label(claimed[0]) ?? 'things';
  const i2 = label(claimed[1]) ?? i1;
  return template
    .replace(/\{interest2\}/gu, i2)
    .replace(/\{interest\}/gu, i1)
    .replace(/\{noun\}/gu, pool.nouns[rng.int(pool.nouns.length)] ?? 'things');
}

/**
 * Clauses whose slots this avatar can actually fill.
 *
 * A template wanting a second interest from an avatar with one produced "languages und
 * languages"; one wanting any interest from an avatar with none produced "Working on
 * things". Filtering is cheaper than authoring a fallback for every slot combination,
 * and it falls back to the unfiltered pool rather than returning nothing.
 */
function usable(pool: string[], interests: string[]): string[] {
  const filtered = pool.filter((t) => {
    if (t.includes('{interest2}') && interests.length < 2) return false;
    if (t.includes('{interest}') && interests.length < 1) return false;
    return true;
  });
  return filtered.length > 0 ? filtered : pool;
}

/** Bucket a non-empty bio by its drawn word count. */
function bucketFor(words: number, medians: BioPopulationConfig['lengthMedians']): BioLength {
  if (words <= medians.short + 1) return 'short';
  if (words <= medians.medium + 3) return 'medium';
  return 'long';
}

export function generateBio(
  seed: number,
  personality: Personality,
  templates: TemplateSet,
  population: BioPopulationConfig,
): BioResult & { fellBack: boolean } {
  const theme = personality.content.bioTheme;
  const { language, fellBack } = languageFor(personality, templates);

  // §3: MOST PROFILES HAVE NO BIO, and this is the single property that most determines
  // whether a member list reads as real. `none` always empties; everything else is a
  // draw against a target adjusted by activity tier and conscientiousness.
  if (theme === 'none') {
    return { text: null, theme: null, length: 'empty', pattern: 'empty', language, emojiCount: 0, fellBack };
  }

  // The configured target is for the WHOLE population, and `none` already contributes
  // its share of it, so the draw for the rest is the remainder. Approximated from the
  // configured theme mix rather than the realised one, which is why the harness reports
  // realised against target rather than asserting they match.
  //
  // THE TEMPLATE PATH RUNS QUIETER THAN THE POPULATION IT STANDS IN FOR. A fallback that
  // produces wrong text is worse than one that produces none: an empty bio is realistic,
  // a calqued German fragment is a tell. So the template engine takes the raised floor
  // and the model engine takes the realistic target.
  const noneShare = 0.16;
  const target = population.engine === 'template'
    ? Math.max(population.bioEmpty, population.templateEmptyFloor)
    : population.bioEmpty;
  const remainder = Math.min(0.98, Math.max(0.02, (target - noneShare) / (1 - noneShare)));
  const adjusted = sigmoid(
    logit(remainder) +
      (TIER_ADJUSTMENT[personality.rhythm.activityTier] ?? 0) -
      TIER_MEAN -
      0.45 * personality.latent.conscientiousness,
  );
  if (new Rng(seed, STREAM_EMPTY).float() < adjusted) {
    return { text: null, theme: null, length: 'empty', pattern: 'empty', language, emojiCount: 0, fellBack };
  }

  const lang = templates.languages[language]!;
  const pool = lang.themes[theme];
  if (pool === undefined) {
    throw new Error(
      `Bio generator: language "${language}" has no clause pool for theme "${theme}". ` +
        `A theme with no pool would silently produce an empty bio and inflate the empty rate.`,
    );
  }

  // §4: log-normal and short. Verbosity moves the median; the draw keeps the tail.
  const lengthRng = new Rng(seed, STREAM_LENGTH);
  const verbosity = personality.style.verbosity / 100;
  const medianWords = population.lengthMedians.short + verbosity * (population.lengthMedians.long - population.lengthMedians.short);
  let u1 = lengthRng.float();
  while (u1 === 0) u1 = lengthRng.float();
  const normal = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * lengthRng.float());
  const targetWords = Math.max(1, Math.round(medianWords * Math.exp(0.55 * normal)));

  // Mechanism 1 and 2: clause count and fragment-or-sentence, per clause.
  const clauseRng = new Rng(seed, STREAM_CLAUSES);
  const clauseCount = targetWords <= 4 ? 1 : targetWords <= 11 ? 1 + clauseRng.int(2) : 2 + clauseRng.int(2);
  const sentenceBias = 0.25 + (personality.style.sentenceComplexity / 100) * 0.5;
  const interests = personality.content.interests;
  const sentences = usable(pool.sentences, interests);
  const fragments = usable(pool.fragments, interests);
  const labels = lang.interestLabels ?? {};
  const parts: string[] = [];
  const used = new Set<string>();

  // CLAUSES DRAW FROM A SHARED SLOT POOL. Each clause used to name an interest chosen
  // independently, so an avatar with one interest named it in every clause: "ask me about
  // synthesizers, trying to get better at synthesizers, i came for synthesizers and
  // stayed for the arguments". Nobody writes their own hobby three times in one line, and
  // it was the most visible defect in a read of two hundred profiles.
  //
  // The interests are consumed rather than re-read, so a second clause either takes a
  // different one or takes a form that names none.
  const remaining = [...interests];

  for (let i = 0; i < clauseCount; i++) {
    const useSentence = clauseRng.chance(sentenceBias) && sentences.length > 0;
    const preferred = useSentence ? sentences : fragments;
    // Only forms this clause can still fill from what is LEFT. Falling back to the
    // other register, and only then to interest-free forms, keeps a bio composable when
    // the interests run out before the clauses do.
    const affordable = (src: string[]): string[] => src.filter((t) => slotsNeeded(t) <= remaining.length);
    let source = affordable(preferred);
    if (source.length === 0) source = affordable(useSentence ? fragments : sentences);
    if (source.length === 0) source = [...preferred, ...(useSentence ? fragments : sentences)].filter((t) => slotsNeeded(t) === 0);
    if (source.length === 0) break; // Nothing left that says anything; a shorter bio is correct.

    let pick = source[clauseRng.int(source.length)]!;
    // One redraw against repeating a clause inside one bio; not a loop, because a small
    // pool plus a high clause count must not spin.
    if (used.has(pick)) pick = source[clauseRng.int(source.length)]!;
    used.add(pick);
    const claimed = remaining.splice(0, slotsNeeded(pick));
    // Terminal punctuation is STRIPPED here and reapplied once at the end. A clause
    // carrying its own produced "i peaked during a hiking conversation in 2019.. i am
    // legally required to mention hiking", and a comma separator after a full stop.
    parts.push(fill(pick, pool, claimed, labels, clauseRng).replace(/[.]+$/u, ''));
  }
  if (parts.length === 0) {
    return { text: null, theme: null, length: 'empty', pattern: 'empty', language, emojiCount: 0, fellBack };
  }

  // Mechanism 3: separator.
  const separator = lang.separators[new Rng(seed, STREAM_SEPARATOR).int(lang.separators.length)]!;
  let text = parts.join(separator);

  // Mechanism 4: capitalisation habit. Casual avatars lower-case more.
  //
  // GATED PER LANGUAGE. This is an English habit; German capitalises nouns, so lowercasing
  // a German bio is not a casual style but a spelling error, and the mechanism was applied
  // to German unchanged ("zehn jahre logistik", "meine abende gehen fast alle fuer
  // gaertnern drauf"). A language that opts out varies on five mechanisms rather than six,
  // and the harness reports that rather than inventing a sixth to hit the number.
  const caseRng = new Rng(seed, STREAM_CASE);
  const lowerHabit = 0.12 + (personality.style.tone / 100) * 0.4;
  if (lang.allowLowercase && caseRng.chance(lowerHabit)) text = text.toLowerCase();
  else text = text.charAt(0).toUpperCase() + text.slice(1);

  // Mechanism 5: terminal punctuation. Frequently absent in real bios.
  const punctRng = new Rng(seed, STREAM_PUNCT);
  const wantsStop = punctRng.chance(0.25 + (personality.style.sentenceComplexity / 100) * 0.4);
  if (wantsStop && !/[.!?]$/u.test(text)) text += '.';
  if (!wantsStop) text = text.replace(/[.]+$/u, '');

  // MECHANISM 6, EMOJI, IS GONE FROM THIS PATH ON PURPOSE.
  //
  // It drew from a flat pool with no view of the interests, so a telescope landed on a
  // baking profile. Tying the pool to the interests would work, and it is more machinery
  // for the one path whose entire job is to have less: this path is the fallback, and its
  // job is now to be plainly correct or silent. Emoji are decorative variety, and variety
  // is exactly what this path stopped trying to do.
  //
  // The model path keeps them and keeps them coherent, because it has the personality in
  // front of it and writes its own into the text. `templates.emoji` therefore survives as
  // the set the model pass RECOGNISES when counting, not as a set anything draws from.
  //
  // The cost, stated rather than hidden: this path now varies on four mechanisms in
  // English and three in German, not six. `verify:bio` reports the realised count.
  const emojiCount = 0;

  const words = text.trim().split(/\s+/u).filter(Boolean).length;
  return {
    text,
    theme,
    length: bucketFor(words, population.lengthMedians),
    pattern: structuralSignature(text, emojiCount, templates.languages[language]?.separators),
    language,
    emojiCount,
    fellBack,
  };
}
