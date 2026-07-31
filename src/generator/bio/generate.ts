/**
 * Bio generation, and the structural signature that makes §6 measurable.
 *
 * ── THE SIX MECHANISMS §6 REQUIRES ─────────────────────────────────────────
 *
 * "Structural variety must come from more than one mechanism. Multiple skeletons is one
 * mechanism and is not enough on its own." So there are six, each on its own named RNG
 * stream so adding a seventh cannot shift the sequence the others see:
 *
 *   1. clause composition   1 to 3 clauses drawn from a themed pool
 *   2. fragment or sentence  chosen per clause, not per bio; real bios are often neither
 *                            wholly one nor the other
 *   3. separator             six of them, including a newline
 *   4. capitalisation        sentence case or all-lower, a habit rather than a rule
 *   5. terminal punctuation  present or absent
 *   6. emoji                 count and position
 *
 * The pool is modest on purpose. Six mechanisms over a small pool produce a far larger
 * structural space than a large pool of whole-bio skeletons would, and the space is the
 * thing a reader perceives.
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
const STREAM_EMOJI = 'bio:emoji';

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

/** Which language this avatar writes in. Follows `originBlend`, never a global default. */
export function languageFor(
  personality: Personality,
  templates: TemplateSet,
): { language: string; fellBack: boolean } {
  const primary = Object.entries(personality.identity.originBlend).sort((a, b) => b[1] - a[1])[0]?.[0];
  const mapped = primary === undefined ? undefined : templates.originLanguages[primary];
  if (mapped !== undefined && templates.languages[mapped] !== undefined) {
    return { language: mapped, fellBack: false };
  }
  // COUNTED, not hidden. §7's whole point is that a German-Spanish origin mix must not
  // produce uniformly English bios, so a fallback is a gap to report rather than absorb.
  return { language: templates.fallbackLanguage, fellBack: true };
}

/**
 * The derived structural signature (§9, §12.1).
 *
 * Computed from the TEXT, not from which template produced it. An identifier only
 * catches template reuse; this also catches two different templates converging on the
 * same shape, which is what a reader actually perceives.
 */
export function structuralSignature(text: string, emojiCount: number): string {
  const trimmed = text.trim();
  const clauseCount = trimmed.split(/[·|\n]|(?:\.\s)|(?:,\s)|(?:\s—\s)/u).filter((c) => c.trim().length > 0).length;
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

function fill(
  template: string,
  pool: ClausePool,
  interests: string[],
  labels: Record<string, string>,
  rng: Rng,
): string {
  // Interests are LABELLED PER LANGUAGE. An English interest inside a German sentence is
  // §7's failure one layer down, and it passed every numeric check while producing
  // "arbeite an cooking".
  const label = (k: string | undefined): string | undefined => (k === undefined ? undefined : (labels[k] ?? k));
  const i1 = label(interests[0]) ?? 'things';
  const i2 = label(interests[1]) ?? i1;
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
  const noneShare = 0.16;
  const remainder = Math.min(0.98, Math.max(0.02, (population.bioEmpty - noneShare) / (1 - noneShare)));
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
  for (let i = 0; i < clauseCount; i++) {
    const useSentence = clauseRng.chance(sentenceBias) && sentences.length > 0;
    const source = useSentence ? sentences : fragments;
    let pick = source[clauseRng.int(source.length)]!;
    // One redraw against repeating a clause inside one bio; not a loop, because a small
    // pool plus a high clause count must not spin.
    if (used.has(pick)) pick = source[clauseRng.int(source.length)]!;
    used.add(pick);
    // Terminal punctuation is STRIPPED here and reapplied once at the end. A clause
    // carrying its own produced "i peaked during a hiking conversation in 2019.. i am
    // legally required to mention hiking", and a comma separator after a full stop.
    parts.push(fill(pick, pool, interests, labels, clauseRng).replace(/[.]+$/u, ''));
  }

  // Mechanism 3: separator.
  const separator = lang.separators[new Rng(seed, STREAM_SEPARATOR).int(lang.separators.length)]!;
  let text = parts.join(separator);

  // Mechanism 4: capitalisation habit. Casual avatars lower-case more.
  const caseRng = new Rng(seed, STREAM_CASE);
  const lowerHabit = 0.12 + (personality.style.tone / 100) * 0.4;
  if (caseRng.chance(lowerHabit)) text = text.toLowerCase();
  else text = text.charAt(0).toUpperCase() + text.slice(1);

  // Mechanism 5: terminal punctuation. Frequently absent in real bios.
  const punctRng = new Rng(seed, STREAM_PUNCT);
  const wantsStop = punctRng.chance(0.25 + (personality.style.sentenceComplexity / 100) * 0.4);
  if (wantsStop && !/[.!?]$/u.test(text)) text += '.';
  if (!wantsStop) text = text.replace(/[.]+$/u, '');

  // Mechanism 6: emoji. Most bios in most populations contain none (§8).
  const emojiRng = new Rng(seed, STREAM_EMOJI);
  const affinity = personality.style.emojiAffinity / 100;
  let emojiCount = 0;
  if (emojiRng.chance(Math.max(0, affinity - 0.45) * 1.3)) {
    emojiCount = emojiRng.chance(affinity * 0.5) ? 2 : 1;
    const picked = Array.from({ length: emojiCount }, () => templates.emoji[emojiRng.int(templates.emoji.length)]!);
    text = emojiRng.chance(0.25) ? `${picked.join('')} ${text}` : `${text} ${picked.join('')}`;
  }

  const words = text.trim().split(/\s+/u).filter(Boolean).length;
  return {
    text,
    theme,
    length: bucketFor(words, population.lengthMedians),
    pattern: structuralSignature(text, emojiCount),
    language,
    emojiCount,
    fellBack,
  };
}
