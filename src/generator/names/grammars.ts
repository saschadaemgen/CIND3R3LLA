/**
 * Culture grammars for the name generator.
 *
 * AUTHORED METADATA, NOT DERIVED DATA. Nothing in this file is computed from
 * `data/names_data.json`, and nothing in it could be: the shipped corpus is five
 * flat unlabelled arrays (36,162 given names, 21,967 surnames, three fantasy
 * pools) with no culture labels, no gender, and no ordering information. How a
 * culture assembles a full name is knowledge about the culture, not a property of
 * a word list, so it is written down by hand here.
 *
 * WHY BESIDE THE CORPUS RATHER THAN INSIDE IT. The corpus is bulk data that gets
 * replaced wholesale: today's fixtures, tomorrow's labelled pools, possibly a
 * third-party dump. Grammar is small, reviewed, and stable across every one of
 * those swaps. Folding it into the JSON would mean re-authoring it on every
 * corpus refresh and would let a data drop silently change name structure. Kept
 * separate, a corpus can be replaced without touching a single rule, and a rule
 * can be corrected without regenerating a 600 KB file. It is TypeScript rather
 * than JSON so the compiler checks every structure name and every field.
 *
 * COMPLETENESS. A test asserts the two directions agree: every culture key in
 * this record resolves in the corpus (falling back to `general` where a labelled
 * pool does not exist yet), and every culture key the corpus offers has a grammar
 * here. Neither side may grow a key the other has never heard of.
 *
 * CONVENTIONS USED BELOW
 * - The record key IS the culture key. `culture` is filled in from the key when
 *   the record is frozen, so the two cannot drift apart.
 * - Particles stay LOWER-CASE and belong to the family part: `van der Meer` is
 *   one part, not three.
 * - `particleProbability` is an authored estimate of how often a surname carries
 *   a particle in that culture, not a measured frequency. It is deliberately not
 *   uniform: Dutch surnames carry one constantly, German ones almost never.
 * - PATRONYMIC AFFIX FORM. A leading hyphen means the affix is appended directly
 *   to the father's given name (Icelandic `Jon` + `-sson` = `Jonsson`; Kazakh
 *   `Abish` + `-uly` = `Abishuly`). No leading hyphen means it is written as a
 *   separate word (Azerbaijani `Alirza oglu`, Arabic `ibn Yusuf`). An EMPTY affix
 *   means the father's given name stands alone with no marker at all, which is
 *   how Amharic, Somali and Marathi work. Consumers strip the leading hyphen
 *   before joining and insert a space when there is none.
 *
 * KNOWN SIMPLIFICATIONS, stated rather than hidden. `GrammarStructure` has seven
 * members and real naming has more. Portuguese is filed under
 * `givenPaternalMaternal` although Portuguese order is in fact maternal then
 * paternal; both surnames are drawn from one pool, so the difference is not
 * observable in output. Malay is filed under `mononym` even though `bin` / `binti`
 * is common, because a single given name is the dominant public form. Greek and
 * Latvian family names are gendered, but the type only carries a feminine family
 * suffix alongside a patronymic, and neither culture has one.
 */

import type { CultureGrammar } from './types.js';

/**
 * The documented fallback. `grammarFor` returns this for any culture key that is
 * unknown, empty, or malformed. English is the choice because it is the least
 * structured grammar in the set: given name, family name, no patronymic, no
 * second surname, particles all but absent. Falling back to it can only produce a
 * plain two-part name, never a wrong-looking patronymic or a spurious particle.
 */
export const DEFAULT_CULTURE = 'en';

/** Everything except `culture`, which the key supplies. */
type GrammarEntry = Omit<CultureGrammar, 'culture'>;

/** Named so the fallback below needs no cast and cannot go missing unnoticed. */
const EN_ENTRY: GrammarEntry = {
  label: 'English',
  structure: 'givenFamily',
  particles: ['de', 'van'],
  particleProbability: 0.01,
};

const ENTRIES: Record<string, GrammarEntry> = {
  /* Anglophone and Germanic ------------------------------------------------ */
  en: EN_ENTRY,
  de: {
    label: 'German',
    structure: 'givenFamily',
    particles: ['von', 'von der', 'vom', 'zu', 'zur', 'am'],
    particleProbability: 0.03,
  },
  nl: {
    label: 'Dutch',
    structure: 'givenFamily',
    particles: ['van', 'van der', 'van den', 'van de', 'de', 'den', 'ter', 'ten'],
    particleProbability: 0.25,
  },
  af: {
    label: 'Afrikaans',
    structure: 'givenFamily',
    particles: ['van', 'van der', 'van den', 'de', 'du', 'le'],
    particleProbability: 0.15,
  },
  sv: {
    label: 'Swedish',
    structure: 'givenFamily',
    particles: ['af', 'von'],
    particleProbability: 0.01,
  },
  no: {
    label: 'Norwegian',
    structure: 'givenFamily',
    particles: ['von'],
    particleProbability: 0.01,
  },
  da: { label: 'Danish', structure: 'givenFamily', particles: [], particleProbability: 0 },
  is: {
    label: 'Icelandic',
    structure: 'patronymicOnly',
    particles: [],
    particleProbability: 0,
    // No family name exists at all: Jonsson and Jonsdottir are siblings.
    patronymic: { suffixMale: '-sson', suffixFemale: '-sdóttir' },
  },

  /* Romance ---------------------------------------------------------------- */
  fr: {
    label: 'French',
    structure: 'givenFamily',
    particles: ['de', 'du', 'des', 'le', 'la'],
    particleProbability: 0.06,
  },
  it: {
    label: 'Italian',
    structure: 'givenFamily',
    particles: ['di', 'da', 'de', 'del', 'della', 'dei', 'lo'],
    particleProbability: 0.08,
  },
  es: {
    label: 'Spanish',
    structure: 'givenPaternalMaternal',
    particles: ['de', 'de la', 'del', 'de los', 'de las'],
    particleProbability: 0.05,
  },
  ca: {
    label: 'Catalan',
    structure: 'givenPaternalMaternal',
    particles: ['de', 'del', 'de la'],
    particleProbability: 0.05,
  },
  gl: {
    label: 'Galician',
    structure: 'givenPaternalMaternal',
    particles: ['de', 'da', 'do', 'dos'],
    particleProbability: 0.06,
  },
  pt: {
    label: 'Portuguese',
    structure: 'givenPaternalMaternal',
    particles: ['de', 'da', 'do', 'dos', 'das'],
    particleProbability: 0.3,
  },
  tl: {
    label: 'Filipino',
    structure: 'givenPaternalMaternal',
    particles: ['de', 'dela', 'del', 'de los'],
    particleProbability: 0.08,
  },
  ro: { label: 'Romanian', structure: 'givenFamily', particles: [], particleProbability: 0 },

  /* Finnic and Baltic ------------------------------------------------------ */
  fi: { label: 'Finnish', structure: 'givenFamily', particles: [], particleProbability: 0 },
  et: { label: 'Estonian', structure: 'givenFamily', particles: [], particleProbability: 0 },
  lv: { label: 'Latvian', structure: 'givenFamily', particles: [], particleProbability: 0 },
  lt: { label: 'Lithuanian', structure: 'givenFamily', particles: [], particleProbability: 0 },

  /* West and South Slavic -------------------------------------------------- */
  pl: { label: 'Polish', structure: 'givenFamily', particles: [], particleProbability: 0 },
  cs: { label: 'Czech', structure: 'givenFamily', particles: [], particleProbability: 0 },
  sk: { label: 'Slovak', structure: 'givenFamily', particles: [], particleProbability: 0 },
  sl: { label: 'Slovene', structure: 'givenFamily', particles: [], particleProbability: 0 },
  hr: { label: 'Croatian', structure: 'givenFamily', particles: [], particleProbability: 0 },
  sr: { label: 'Serbian', structure: 'givenFamily', particles: [], particleProbability: 0 },
  bg: {
    label: 'Bulgarian',
    structure: 'givenPatronymicFamily',
    particles: [],
    particleProbability: 0,
    // Bulgarian is South Slavic but keeps a middle patronymic: Ivan Petrov Georgiev,
    // Ivana Petrova Georgieva.
    patronymic: { suffixMale: '-ov', suffixFemale: '-ova', familySuffixFemale: '-a' },
  },

  /* East Slavic ------------------------------------------------------------ */
  ru: {
    label: 'Russian',
    structure: 'givenPatronymicFamily',
    particles: [],
    particleProbability: 0,
    // Ivan Petrovich Ivanov, Anna Petrovna Ivanova.
    patronymic: { suffixMale: '-ovich', suffixFemale: '-ovna', familySuffixFemale: '-a' },
  },
  uk: {
    label: 'Ukrainian',
    structure: 'givenPatronymicFamily',
    particles: [],
    particleProbability: 0,
    // Not the Russian forms: Petrovych / Petrivna, not Petrovich / Petrovna. No
    // familySuffixFemale, because the commonest Ukrainian surnames (-enko, -uk,
    // -chuk, -ko) do not decline for gender at all; only the -ov and -skyi
    // minority does, and feminising the majority would be worse than leaving it.
    patronymic: { suffixMale: '-ovych', suffixFemale: '-ivna' },
  },
  be: {
    label: 'Belarusian',
    structure: 'givenPatronymicFamily',
    particles: [],
    particleProbability: 0,
    // Belarusian keeps the a-vocalism: Piatrovich becomes Piatravich, Piatrouna.
    patronymic: { suffixMale: '-avich', suffixFemale: '-auna', familySuffixFemale: '-a' },
  },

  /* Other Europe and the Caucasus ------------------------------------------ */
  el: { label: 'Greek', structure: 'givenFamily', particles: [], particleProbability: 0 },
  tr: { label: 'Turkish', structure: 'givenFamily', particles: [], particleProbability: 0 },
  cy: {
    label: 'Welsh',
    structure: 'givenFamily',
    particles: ['ap', 'ab'],
    particleProbability: 0.02,
  },
  hu: { label: 'Hungarian', structure: 'familyGiven', particles: [], particleProbability: 0 },
  hy: { label: 'Armenian', structure: 'givenFamily', particles: [], particleProbability: 0 },
  ka: { label: 'Georgian', structure: 'givenFamily', particles: [], particleProbability: 0 },

  /* Middle East ------------------------------------------------------------ */
  ar: {
    label: 'Arabic',
    structure: 'givenNasabFather',
    particles: ['al', 'el', 'abu', 'umm'],
    particleProbability: 0.2,
    nasab: { male: 'ibn', female: 'bint' },
  },
  he: { label: 'Hebrew', structure: 'givenFamily', particles: [], particleProbability: 0 },
  fa: { label: 'Persian', structure: 'givenFamily', particles: [], particleProbability: 0 },

  /* Central Asia ----------------------------------------------------------- */
  kk: {
    label: 'Kazakh',
    structure: 'givenPatronymicFamily',
    particles: [],
    particleProbability: 0,
    // Written as one word: Abish + uly.
    patronymic: { suffixMale: '-uly', suffixFemale: '-qyzy' },
  },
  uz: {
    label: 'Uzbek',
    structure: 'givenPatronymicFamily',
    particles: [],
    particleProbability: 0,
    // Written as a separate word, unlike Kazakh.
    patronymic: { suffixMale: 'ogli', suffixFemale: 'qizi' },
  },
  az: {
    label: 'Azerbaijani',
    structure: 'givenPatronymicFamily',
    particles: [],
    particleProbability: 0,
    // Separate word, and the Soviet-era -ov / -ova surnames still decline.
    patronymic: { suffixMale: 'oglu', suffixFemale: 'qizi', familySuffixFemale: '-a' },
  },

  /* South Asia ------------------------------------------------------------- */
  hi: { label: 'Hindi', structure: 'givenFamily', particles: [], particleProbability: 0 },
  bn: { label: 'Bengali', structure: 'givenFamily', particles: [], particleProbability: 0 },
  mr: {
    label: 'Marathi',
    structure: 'givenPatronymicFamily',
    particles: [],
    particleProbability: 0,
    // Given, father's given, family: the middle part carries no affix at all.
    patronymic: { suffixMale: '', suffixFemale: '' },
  },
  ta: { label: 'Tamil', structure: 'mononym', particles: [], particleProbability: 0 },
  ml: { label: 'Malayalam', structure: 'mononym', particles: [], particleProbability: 0 },
  te: { label: 'Telugu', structure: 'familyGiven', particles: [], particleProbability: 0 },

  /* Southeast and East Asia ------------------------------------------------ */
  id: { label: 'Indonesian', structure: 'mononym', particles: [], particleProbability: 0 },
  ms: { label: 'Malay', structure: 'mononym', particles: [], particleProbability: 0 },
  my: { label: 'Burmese', structure: 'mononym', particles: [], particleProbability: 0 },
  th: { label: 'Thai', structure: 'givenFamily', particles: [], particleProbability: 0 },
  vi: { label: 'Vietnamese', structure: 'familyGiven', particles: [], particleProbability: 0 },
  km: { label: 'Khmer', structure: 'familyGiven', particles: [], particleProbability: 0 },
  zh: { label: 'Chinese', structure: 'familyGiven', particles: [], particleProbability: 0 },
  ja: { label: 'Japanese', structure: 'familyGiven', particles: [], particleProbability: 0 },
  ko: { label: 'Korean', structure: 'familyGiven', particles: [], particleProbability: 0 },

  /* Africa ----------------------------------------------------------------- */
  am: {
    label: 'Amharic',
    structure: 'patronymicOnly',
    particles: [],
    particleProbability: 0,
    // Given name plus the father's given name, no affix and no family name.
    patronymic: { suffixMale: '', suffixFemale: '' },
  },
  so: {
    label: 'Somali',
    structure: 'patronymicOnly',
    particles: [],
    particleProbability: 0,
    // Same shape as Amharic: the second part is the father's given name.
    patronymic: { suffixMale: '', suffixFemale: '' },
  },
  sw: { label: 'Swahili', structure: 'givenFamily', particles: [], particleProbability: 0 },
  yo: { label: 'Yoruba', structure: 'givenFamily', particles: [], particleProbability: 0 },
  zu: { label: 'Zulu', structure: 'givenFamily', particles: [], particleProbability: 0 },
};

/** Freeze one grammar and everything reachable from it. */
function freezeGrammar(culture: string, entry: GrammarEntry): CultureGrammar {
  const grammar: CultureGrammar = { culture, ...entry };
  Object.freeze(grammar.particles);
  if (grammar.patronymic) Object.freeze(grammar.patronymic);
  if (grammar.nasab) Object.freeze(grammar.nasab);
  return Object.freeze(grammar);
}

const BUILT: Record<string, CultureGrammar> = {};
for (const [culture, entry] of Object.entries(ENTRIES)) {
  BUILT[culture] = freezeGrammar(culture, entry);
}

/**
 * Every culture grammar, keyed by culture key. Deeply frozen: a caller that
 * mutates a grammar would corrupt every later draw for that culture, so the
 * runtime refuses rather than trusting the `readonly` types.
 */
export const CULTURE_GRAMMARS: Readonly<Record<string, CultureGrammar>> = Object.freeze(BUILT);

/** The culture keys, in declaration order. For the completeness test and the admin UI. */
export const CULTURE_KEYS: readonly string[] = Object.freeze(Object.keys(CULTURE_GRAMMARS));

const DEFAULT_GRAMMAR: CultureGrammar =
  CULTURE_GRAMMARS[DEFAULT_CULTURE] ?? freezeGrammar(DEFAULT_CULTURE, EN_ENTRY);

/**
 * Resolve a culture key to its grammar.
 *
 * Resolution order, each step documented because a silent wrong answer here
 * produces a plausible-looking but culturally wrong name:
 *   1. exact match on the trimmed, lower-cased key;
 *   2. the language part of a region-qualified key, so `pt-BR` and `zh_TW` reach
 *      `pt` and `zh` instead of falling all the way through;
 *   3. `DEFAULT_CULTURE` ('en'), the documented fallback.
 *
 * Never throws and never returns undefined: the generator always has a grammar.
 */
export function grammarFor(culture: string): CultureGrammar {
  const key = culture.trim().toLowerCase();
  const exact = CULTURE_GRAMMARS[key];
  if (exact) return exact;

  const base = key.split(/[-_]/)[0];
  if (base !== undefined && base !== key) {
    const byLanguage = CULTURE_GRAMMARS[base];
    if (byLanguage) return byLanguage;
  }

  return DEFAULT_GRAMMAR;
}

/** True when a culture key has its own grammar, without applying any fallback. */
export function hasGrammar(culture: string): boolean {
  return CULTURE_GRAMMARS[culture.trim().toLowerCase()] !== undefined;
}
