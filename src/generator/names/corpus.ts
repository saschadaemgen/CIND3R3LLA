/**
 * Corpus loading. THE ONLY FILE IN THIS MODULE THAT TOUCHES THE FILESYSTEM.
 *
 * Everything else takes a `NameCorpus` as an argument, which is what makes
 * briefing §2's "must not read the filesystem at call time" structural rather than
 * a rule someone has to remember.
 *
 * ---------------------------------------------------------------------------
 * WHAT THE SHIPPED CORPUS ACTUALLY IS, AND WHAT IT IS NOT
 * ---------------------------------------------------------------------------
 *
 * The briefing describes `names_data.json` as "36,162 given names across 57
 * cultures, 21,967 surnames, and fantasy pools". The counts are exact. The
 * cultures are not there. The file is five flat, alphabetically sorted,
 * deduplicated string arrays:
 *
 *     firstNames     36162      fantasyAdj      125
 *     lastNames      21967      fantasyNoun     126
 *                                fantasyIconic    65
 *
 * There are no culture labels, no gender markers, no frequency data and no word
 * pools. So this loader composes the corpus from three sources:
 *
 *   1. `data/names_data.json`      the real, unlabelled bulk corpus -> `general`
 *   2. `fixtures/culture-pools.fixture.json`
 *                                  HAND-AUTHORED STAND-INS -> `cultures`
 *   3. `data/word-pools.json`      authored vocabulary -> `words`
 *
 * Source 2 is a FIXTURE. It exists so the culture-grammar engine can be exercised
 * and tested. It is small, it is not a real labelled corpus, and the "culturally
 * coherent names" property of the briefing is NOT delivered by it.
 *
 * ---------------------------------------------------------------------------
 * REPLACING THE FIXTURES WITH A REAL LABELLED CORPUS
 * ---------------------------------------------------------------------------
 *
 * Produce a JSON file of this shape and point `loadCorpus` at it. Nothing in the
 * engine changes, and no code in this file needs adapting:
 *
 *     {
 *       "<cultureKey>": {
 *         "givenFemale": ["..."],   // [] if the data does not distinguish
 *         "givenMale":   ["..."],   // [] if the data does not distinguish
 *         "givenNeutral":["..."],   // used when a gendered pool is empty
 *         "family":      ["..."]    // [] for mononym and patronymic-only cultures
 *       }
 *     }
 *
 * Culture keys must match the keys in `grammars.ts`. `verifyCorpus` asserts that
 * correspondence in both directions, so drift fails a check instead of rotting.
 *
 * Two properties the engine relies on, which a replacement must preserve:
 *   - `family: []` genuinely means "this culture has no family names" (Icelandic,
 *     Tamil, Indonesian). It is not a gap to be filled by falling back.
 *   - A particled surname is ONE string containing spaces: `"van der Meer"`.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { CULTURE_GRAMMARS } from './grammars.js';
import type { CulturePool, NameCorpus, WordPools } from './types.js';

const HERE = dirname(fileURLToPath(import.meta.url));

/** The raw shape of the shipped, unlabelled corpus file. */
interface RawNamesData {
  firstNames: string[];
  lastNames: string[];
  fantasyAdj: string[];
  fantasyNoun: string[];
  fantasyIconic: string[];
}

function readJson<T>(relativePath: string): T {
  const path = resolve(HERE, relativePath);
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as T;
  } catch (err) {
    // Surfaced, not swallowed: a missing or malformed corpus must not degrade
    // silently into an empty pool that generates plausible-looking rubbish.
    throw new Error(
      `Name generator: could not read corpus file ${relativePath} - ` +
        `${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

/** Strip the `_README` documentation key that fixture files carry. */
function withoutReadme<T extends object>(raw: T): Omit<T, '_README'> {
  const { _README: _ignored, ...rest } = raw as T & { _README?: unknown };
  return rest;
}

export interface LoadCorpusOptions {
  /** Override the labelled-culture source. Point this at a real corpus. */
  culturePoolsPath?: string;
}

/**
 * Compose the corpus. Called once at startup, never per name.
 */
export function loadCorpus(options: LoadCorpusOptions = {}): NameCorpus {
  const raw = readJson<RawNamesData>('./data/names_data.json');
  const words = withoutReadme(readJson<WordPools & { _README?: string }>('./data/word-pools.json'));
  const cultureRaw = withoutReadme(
    readJson<Record<string, CulturePool> & { _README?: string }>(
      options.culturePoolsPath ?? './fixtures/culture-pools.fixture.json',
    ),
  );

  // The unlabelled bulk corpus. Everything goes in `givenNeutral` because the file
  // carries no gender information; a gendered request against this pool falls back
  // and says so via `NameResult.genderResolved`.
  const general: CulturePool = {
    givenFemale: [],
    givenMale: [],
    givenNeutral: Object.freeze(raw.firstNames),
    family: Object.freeze(raw.lastNames),
  };

  return Object.freeze({
    cultures: Object.freeze(cultureRaw as Record<string, CulturePool>),
    general,
    words: Object.freeze(words as WordPools),
    fantasy: Object.freeze({
      adjectives: Object.freeze(raw.fantasyAdj),
      nouns: Object.freeze(raw.fantasyNoun),
      iconic: Object.freeze(raw.fantasyIconic),
    }),
  });
}

/**
 * Structural checks on a corpus.
 *
 * The grammar/corpus correspondence check is the one that matters: it is what
 * stops the authored grammars and the labelled pools drifting apart, which is the
 * cost the briefing (§12.3) named for keeping them in separate files. Drift
 * becomes a failing check rather than a name that is silently built with the wrong
 * rules.
 */
export function verifyCorpus(corpus: NameCorpus): string[] {
  const problems: string[] = [];

  for (const culture of Object.keys(corpus.cultures)) {
    if (!CULTURE_GRAMMARS[culture]) {
      problems.push(`culture pool "${culture}" has no grammar entry in grammars.ts`);
    }
  }

  for (const [key, grammar] of Object.entries(CULTURE_GRAMMARS)) {
    if (grammar.culture !== key) {
      problems.push(`grammar "${key}" carries mismatched culture field "${grammar.culture}"`);
    }
    const pool = corpus.cultures[key];
    if (!pool) continue; // Falls back to `general`, which is legitimate.

    const hasGiven =
      pool.givenFemale.length + pool.givenMale.length + pool.givenNeutral.length > 0;
    if (!hasGiven) problems.push(`culture pool "${key}" has no given names at all`);

    // A culture WITH family structure but an empty family pool would silently
    // produce given-name-only output that looks like a mononym.
    const needsFamily =
      grammar.structure === 'givenFamily' ||
      grammar.structure === 'familyGiven' ||
      grammar.structure === 'givenPatronymicFamily' ||
      grammar.structure === 'givenPaternalMaternal';
    if (needsFamily && pool.family.length === 0) {
      problems.push(
        `culture "${key}" has structure ${grammar.structure} but an empty family pool`,
      );
    }

    // The inverse: a mononym or patronymic-only culture must NOT carry family
    // names, or the grammar's "there is no family name" guarantee is a lie.
    const forbidsFamily =
      grammar.structure === 'mononym' || grammar.structure === 'patronymicOnly';
    if (forbidsFamily && pool.family.length > 0) {
      problems.push(
        `culture "${key}" is ${grammar.structure} but its pool carries ${pool.family.length} family names`,
      );
    }
  }

  if (corpus.general.givenNeutral.length === 0) problems.push('general pool has no given names');
  if (corpus.words.pseudonymGiven.length === 0) problems.push('pseudonymGiven pool is empty');
  if (corpus.words.pseudonymFamily.length === 0) problems.push('pseudonymFamily pool is empty');

  return problems;
}
