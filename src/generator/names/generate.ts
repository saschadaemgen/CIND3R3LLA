/**
 * The seven-stage pipeline (briefing §4).
 *
 *   1. draw culture        from the configured population mix
 *   2. draw origin blend   optionally combine two cultures within this one name
 *   3. apply grammar       build the name parts per that culture's rules
 *   4. draw name type      real, handle, pseudonym, mononym, initials, fantasy
 *   5. apply display form  transform the parts into the chosen type
 *   6. apply casing        natural, lower, mixed
 *   7. sanitise            SimpleX-facing only, and last
 *
 * The order is strict. Stage 7 last is the load-bearing one: stages 1 to 6 produce
 * a culturally correct name, stage 7 produces a string SimpleX will accept, and
 * both are returned so the difference is visible.
 *
 * Every stage draws from its OWN named RNG stream. Inserting a stage, or changing
 * how many draws a stage makes, therefore cannot shift the sequence a later stage
 * sees. Without that, adding a feature would silently change every name previously
 * generated from every seed, and the seed-reconstructs-a-profile guarantee would be
 * worth nothing.
 */

import { Rng } from '../rng.js';
import { zipfPick, rankShuffled } from './zipf.js';
import { grammarFor } from './grammars.js';
import { applyCasing, capitaliseName } from './casing.js';
import { sanitiseForSimplex } from './sanitise.js';
import {
  DEFAULT_NAME_STYLE_MIX,
  type AgeBand,
  type CultureGrammar,
  type CulturePool,
  type GenderPresentation,
  type NameCorpus,
  type NamePart,
  type NameRequest,
  type NameResult,
  type NameType,
} from './types.js';

/* ------------------------------------------------------------------ stage 1-2 */

/** Resolve the culture pool for a key, falling back to the unlabelled corpus. */
function poolFor(corpus: NameCorpus, culture: string): CulturePool {
  return corpus.cultures[culture] ?? corpus.general;
}

/**
 * Stage 1 and 2. Returns one culture, or two when the blend roll succeeds.
 *
 * A blend draws the second culture from the same mix and rejects a repeat, so a
 * "blended" name is always genuinely two cultures. One retry only: with a mix
 * dominated by a single culture, insisting would loop.
 */
function drawCultures(request: NameRequest, seed: number): string[] {
  const cultureRng = new Rng(seed, 'culture');
  const primary = cultureRng.pickWeighted(request.cultureMix);

  const blendRng = new Rng(seed, 'blend');
  if (!blendRng.chance(request.blendProbability)) return [primary];

  const second = blendRng.pickWeighted(request.cultureMix);
  return second === primary ? [primary] : [primary, second];
}

/* -------------------------------------------------------------------- stage 3 */

/** Draw a given name honouring the requested gender, reporting what happened. */
function drawGiven(
  rng: Rng,
  pool: CulturePool,
  gender: GenderPresentation,
  poolId: string,
): { value: string; resolved: GenderPresentation } {
  const gendered =
    gender === 'female' ? pool.givenFemale : gender === 'male' ? pool.givenMale : [];

  if (gendered.length > 0) {
    return { value: zipfPick(rng, rankShuffled(gendered, `${poolId}:${gender}`)), resolved: gender };
  }

  // Fall back to the ungendered pool. The unlabelled corpus has no gender data at
  // all, so this is the normal path for it. `resolved` reports the fallback rather
  // than pretending the request was honoured.
  const neutral = pool.givenNeutral.length > 0 ? pool.givenNeutral : pool.givenFemale;
  const source = neutral.length > 0 ? neutral : pool.givenMale;
  if (source.length === 0) throw new RangeError(`culture pool ${poolId} has no given names`);
  return {
    value: zipfPick(rng, rankShuffled(source, `${poolId}:neutral`)),
    resolved: gender === 'neutral' ? 'neutral' : 'unspecified',
  };
}

/** Draw a family name, optionally particled. Returns [] for cultures with none. */
function drawFamily(
  rng: Rng,
  pool: CulturePool,
  grammar: CultureGrammar,
  poolId: string,
): NamePart[] {
  if (pool.family.length === 0) return [];
  const base = zipfPick(rng, rankShuffled(pool.family, `${poolId}:family`));

  // A corpus family name may ALREADY carry its particle as part of the string
  // (`van der Meer`). Adding another would produce `van van der Meer`, so the
  // particle roll only applies to names that do not already have one.
  const alreadyParticled = grammar.particles.some((p) => base.toLocaleLowerCase().startsWith(`${p} `));
  if (alreadyParticled || grammar.particles.length === 0) {
    return [{ kind: 'family', value: base }];
  }

  if (!rng.chance(grammar.particleProbability)) return [{ kind: 'family', value: base }];

  const particle = rng.pick(grammar.particles);
  // ONE family part containing a space, not two parts. `van der Meer` is one
  // surname; splitting it is the exact failure the briefing calls out.
  return [{ kind: 'family', value: `${particle} ${base}` }];
}

/** Build a patronymic from a father's given name and the culture's suffixes. */
function buildPatronymic(
  rng: Rng,
  pool: CulturePool,
  grammar: CultureGrammar,
  gender: GenderPresentation,
  poolId: string,
): NamePart | null {
  if (!grammar.patronymic) return null;
  // The father's name: drawn from the male pool where one exists.
  const source = pool.givenMale.length > 0 ? pool.givenMale : pool.givenNeutral;
  if (source.length === 0) return null;
  const father = zipfPick(rng, rankShuffled(source, `${poolId}:father`));
  const suffix =
    gender === 'female' ? grammar.patronymic.suffixFemale : grammar.patronymic.suffixMale;
  return { kind: 'patronymic', value: applyAffix(father, suffix) };
}

/**
 * Attach a patronymic affix to a stem, honouring the grammar file's three-way
 * convention. This is documented in `grammars.ts` and getting it wrong produces
 * names that are wrong in a way only a speaker would notice:
 *
 *   leading hyphen  attaches directly    Jón   + `-sson`  -> Jónsson
 *   no hyphen       is a separate word   Rəşid + `oglu`   -> Rəşid oglu
 *   empty           no marker at all     the father's given name stands alone
 *
 * The hyphen is grammar-reference notation meaning "attaches to the stem", never
 * a character in the name.
 */
function applyAffix(stem: string, suffix: string): string {
  if (suffix.length === 0) return stem;
  if (suffix.startsWith('-')) return `${stem}${suffix.slice(1)}`;
  return `${stem} ${suffix}`;
}

/**
 * Stage 3. Build the culturally correct parts for this culture.
 *
 * Nothing here assumes two tokens, and nothing requires a family name: mononym and
 * patronymic-only cultures have none, and the callers downstream must cope.
 */
function applyGrammar(
  rng: Rng,
  corpus: NameCorpus,
  cultures: string[],
  request: NameRequest,
): { parts: NamePart[]; resolved: GenderPresentation; grammar: CultureGrammar } {
  const primary = cultures[0]!;
  const grammar = grammarFor(primary);
  const givenPool = poolFor(corpus, primary);
  // A blend takes the given name from the first culture and the family name from
  // the second: that is what a mixed-heritage name usually looks like.
  const familyCulture = cultures[1] ?? primary;
  const familyPool = poolFor(corpus, familyCulture);

  const given = drawGiven(rng, givenPool, request.genderPresentation, primary);
  const givenPart: NamePart = { kind: 'given', value: given.value };

  switch (grammar.structure) {
    case 'mononym':
      return { parts: [givenPart], resolved: given.resolved, grammar };

    case 'patronymicOnly': {
      const patronymic = buildPatronymic(rng, givenPool, grammar, request.genderPresentation, primary);
      // No family name exists in this culture, and there is none to fall back to.
      return {
        parts: patronymic ? [givenPart, patronymic] : [givenPart],
        resolved: given.resolved,
        grammar,
      };
    }

    case 'familyGiven': {
      const family = drawFamily(rng, familyPool, grammar, familyCulture);
      // Family first. The ORDER of the parts array is the display order.
      return { parts: [...family, givenPart], resolved: given.resolved, grammar };
    }

    case 'givenPatronymicFamily': {
      const patronymic = buildPatronymic(rng, givenPool, grammar, request.genderPresentation, primary);
      const family = drawFamily(rng, familyPool, grammar, familyCulture);
      // East Slavic family names are gendered too: Ivanov -> Ivanova.
      const gendered =
        request.genderPresentation === 'female' && grammar.patronymic?.familySuffixFemale
          ? family.map((part) => ({
              ...part,
              value: applyAffix(part.value, grammar.patronymic!.familySuffixFemale!),
            }))
          : family;
      return {
        parts: [givenPart, ...(patronymic ? [patronymic] : []), ...gendered],
        resolved: given.resolved,
        grammar,
      };
    }

    case 'givenNasabFather': {
      const nasab = grammar.nasab;
      const source = givenPool.givenMale.length > 0 ? givenPool.givenMale : givenPool.givenNeutral;
      if (!nasab || source.length === 0) {
        return { parts: [givenPart], resolved: given.resolved, grammar };
      }
      const father = zipfPick(rng, rankShuffled(source, `${primary}:father`));
      const particle = request.genderPresentation === 'female' ? nasab.female : nasab.male;
      return {
        parts: [givenPart, { kind: 'particle', value: particle }, { kind: 'family', value: father }],
        resolved: given.resolved,
        grammar,
      };
    }

    case 'givenPaternalMaternal': {
      const paternal = drawFamily(rng, familyPool, grammar, familyCulture);
      const maternal = drawFamily(rng, familyPool, grammar, familyCulture);
      // Two surname parts, both kind 'family'. Spanish names carry both.
      return {
        parts: [givenPart, ...paternal, ...maternal],
        resolved: given.resolved,
        grammar,
      };
    }

    case 'givenFamily':
    default: {
      const family = drawFamily(rng, familyPool, grammar, familyCulture);
      return { parts: [givenPart, ...family], resolved: given.resolved, grammar };
    }
  }
}

/* -------------------------------------------------------------------- stage 4 */

/**
 * Age bias (briefing §9: "ageBand? biases type: teens toward handles").
 *
 * Multiplicative against the configured mix rather than a replacement, so an
 * operator who sets a mix still gets their mix, tilted.
 */
const AGE_BIAS: Readonly<Record<AgeBand, Partial<Record<NameType, number>>>> = {
  teen: { handle: 3.0, pseudonym: 1.4, fantasy: 2.0, real: 0.3, initials: 0.5 },
  youngAdult: { handle: 1.8, pseudonym: 1.2, fantasy: 1.3, real: 0.7 },
  adult: {},
  middleAged: { real: 1.4, firstName: 1.2, handle: 0.5, fantasy: 0.4 },
  senior: { real: 1.6, firstName: 1.3, initials: 1.2, handle: 0.2, fantasy: 0.2 },
} as const;

function drawNameType(request: NameRequest, seed: number): NameType {
  const configured = Object.keys(request.nameStyleMix).length > 0
    ? request.nameStyleMix
    : DEFAULT_NAME_STYLE_MIX;

  const bias = request.ageBand ? AGE_BIAS[request.ageBand] : {};
  const weighted: Partial<Record<NameType, number>> = {};
  for (const [type, weight] of Object.entries(configured) as [NameType, number][]) {
    if (!(weight > 0)) continue;
    weighted[type] = weight * (bias[type] ?? 1);
  }

  return new Rng(seed, 'type').pickWeighted(weighted);
}

/* -------------------------------------------------------------------- stage 5 */

/** Join parts into a display string. Particles and parts are space-separated. */
function joinParts(parts: NamePart[]): string {
  return parts
    .map((p) => p.value)
    .filter((v) => v.length > 0)
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function initialOf(value: string): string {
  // First letter of the first word, uppercased. Handles particled surnames by
  // taking the particle's letter, which is what an initial of `van der Meer` is.
  const first = [...value.trim()][0] ?? '';
  return first.toLocaleUpperCase();
}

const REAL_PATTERNS = ['firstOnly', 'firstLast', 'firstInitialLast', 'firstLastInitial'] as const;
const HANDLE_PATTERNS = ['word', 'wordNumber', 'compound', 'leet', 'underscored'] as const;
// Fantasy patterns ('single', 'titled', 'compound') are not drawn from a list:
// they emerge from the intensity rolls below, which is what keeps the scale
// continuous rather than a choice between three presets.

const LEET: Readonly<Record<string, string>> = { a: '4', e: '3', i: '1', o: '0', s: '5', t: '7' };

function toLeet(word: string, rng: Rng): string {
  return [...word]
    .map((ch) => {
      const swap = LEET[ch.toLocaleLowerCase()];
      return swap && rng.chance(0.55) ? swap : ch;
    })
    .join('');
}

interface DisplayForm {
  parts: NamePart[];
  pattern: string;
}

/**
 * Stage 5. Turn the grammar parts into the chosen name type.
 *
 * For handle, pseudonym and fantasy the grammar parts are DISCARDED: those types
 * are built from word pools, not from real-name pools. The grammar still ran,
 * because the pipeline order is fixed and running it keeps the culture draw
 * meaningful in the result even when the name itself does not use it.
 */
function applyDisplayForm(
  rng: Rng,
  corpus: NameCorpus,
  grammarParts: NamePart[],
  nameType: NameType,
  request: NameRequest,
): DisplayForm {
  const given = grammarParts.find((p) => p.kind === 'given');
  const family = grammarParts.filter((p) => p.kind === 'family');
  const patronymic = grammarParts.find((p) => p.kind === 'patronymic');

  switch (nameType) {
    case 'real': {
      // A culture with no family name cannot produce firstLast. Restrict the
      // pattern set rather than inventing a family name.
      const tail = family[0] ?? patronymic;
      const available = tail ? REAL_PATTERNS : (['firstOnly'] as const);
      const pattern = rng.pick(available as readonly string[]);
      if (!given) return { parts: grammarParts, pattern: 'asGrammar' };

      switch (pattern) {
        case 'firstOnly':
          return { parts: [given], pattern };
        case 'firstInitialLast':
          return {
            parts: [{ kind: 'initial', value: initialOf(given.value) }, tail!],
            pattern,
          };
        case 'firstLastInitial':
          return {
            parts: [given, { kind: 'initial', value: initialOf(tail!.value) }],
            pattern,
          };
        case 'firstLast':
        default:
          // Preserve the grammar's own ordering (family-first cultures included).
          return { parts: grammarParts, pattern: 'firstLast' };
      }
    }

    case 'firstName':
      return { parts: given ? [given] : grammarParts, pattern: 'givenOnly' };

    case 'mononym':
      return { parts: given ? [given] : [grammarParts[0]!], pattern: 'single' };

    case 'initials': {
      const source = [given, family[0] ?? patronymic].filter(Boolean) as NamePart[];
      const pattern = rng.pick(['dotted', 'bare', 'single']);
      const letters = source.map((p) => initialOf(p.value));
      if (pattern === 'single' || letters.length === 1) {
        return { parts: [{ kind: 'initial', value: letters[0] ?? 'X' }], pattern: 'single' };
      }
      if (pattern === 'dotted') {
        // Contains dots ON PURPOSE. Stage 7 strips them, and that visible
        // difference is exactly what `sanitised` exists to report.
        return {
          parts: [{ kind: 'initial', value: `${letters.join('.')}.` }],
          pattern: 'dotted',
        };
      }
      return { parts: [{ kind: 'initial', value: letters.join('') }], pattern: 'bare' };
    }

    case 'pseudonym': {
      // Name-shaped, from word pools. Reads like a name; is not one.
      const first = capitaliseName(rng.pick(corpus.words.pseudonymGiven));
      const last = capitaliseName(rng.pick(corpus.words.pseudonymFamily));
      return {
        parts: [
          { kind: 'given', value: first },
          { kind: 'family', value: last },
        ],
        pattern: 'givenFamily',
      };
    }

    case 'handle': {
      const pattern = rng.pick(HANDLE_PATTERNS);
      const modifier = rng.pick(corpus.words.handleModifier);
      const noun = rng.pick(corpus.words.handleNoun);
      let value: string;
      switch (pattern) {
        case 'word':
          value = noun;
          break;
        case 'wordNumber':
          value = `${noun}${rng.int(9000) + 100}`;
          break;
        case 'compound':
          value = `${modifier}${capitaliseName(noun)}`;
          break;
        case 'leet':
          value = toLeet(`${modifier}${noun}`, rng);
          break;
        case 'underscored':
        default:
          value = `${modifier}_${noun}`;
          break;
      }
      return { parts: [{ kind: 'handle', value }], pattern };
    }

    case 'fantasy': {
      // Intensity is CONTINUOUS (briefing §6). Expected element count is
      // 1 + t + t^2, which is smooth and strictly increasing in t, so 50 sits
      // between 20 and 80 rather than jumping between presets.
      const t = Math.min(100, Math.max(0, request.fantasyIntensity)) / 100;
      const useIconic = rng.chance(t);
      const head = useIconic ? rng.pick(corpus.fantasy.iconic) : rng.pick(corpus.fantasy.nouns);
      const elements: string[] = [head];
      let pattern: string = 'single';

      if (rng.chance(t)) {
        elements.unshift(rng.pick(corpus.fantasy.adjectives));
        pattern = 'compound';
      }
      if (rng.chance(t * t)) {
        elements.unshift('the');
        elements.unshift(rng.pick(corpus.fantasy.adjectives));
        pattern = 'titled';
      }
      return {
        parts: [{ kind: 'handle', value: elements.map(capitaliseName).join(' ') }],
        pattern: pattern,
      };
    }

    default:
      return { parts: grammarParts, pattern: 'asGrammar' };
  }
}

/* --------------------------------------------------------------------- public */

/**
 * Generate one name.
 *
 * Pure. Given the same seed, the same request and the same corpus, this returns
 * the identical result, forever. It reads no clock, no filesystem and no global
 * random source.
 */
export function generateName(request: NameRequest, corpus: NameCorpus): NameResult {
  const seed = request.seed >>> 0;

  // Stages 1 and 2.
  const cultures = drawCultures(request, seed);

  // Stage 3.
  const grammarRng = new Rng(seed, 'grammar');
  const built = applyGrammar(grammarRng, corpus, cultures, request);

  // Stage 4.
  const nameType = drawNameType(request, seed);

  // Stage 5.
  const formRng = new Rng(seed, 'form');
  const form = applyDisplayForm(formRng, corpus, built.parts, nameType, request);

  // Stage 6.
  const caseRng = new Rng(seed, 'case');
  const cased = applyCasing(form.parts, request.nameCase, caseRng);

  // Stage 7, last and only on the assembled display form.
  const originalName = joinParts(cased);
  const { displayName, sanitised } = sanitiseForSimplex(originalName);

  return {
    displayName,
    originalName,
    sanitised,
    nameType,
    pattern: form.pattern,
    cultures,
    parts: cased,
    genderResolved: built.resolved,
  };
}
