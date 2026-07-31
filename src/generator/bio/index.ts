/**
 * Bio generator: public entry point (CCB-S4-006).
 *
 *     const templates = loadTemplates();            // once, at startup
 *     const bio = generateBio(seed, personality, templates, DEFAULT_BIO_POPULATION);
 *
 * Template path only. The model-backed text path is a separate optional component and
 * is out of scope (§11), as are avatar images, names (the name generator produces
 * those; this feeds alongside it), the population layer and persistence.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { BIO_LENGTHS, type BioPopulationConfig, type TemplateSet } from './types.js';

const HERE = dirname(fileURLToPath(import.meta.url));

export interface LoadTemplatesOptions {
  path?: string;
}

/** THE ONLY FILE-READING FUNCTION HERE. Once at startup, never per avatar. */
export function loadTemplates(options: LoadTemplatesOptions = {}): TemplateSet {
  const path = resolve(HERE, options.path ?? './data/templates.json');
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(path, 'utf8'));
  } catch (err) {
    throw new Error(
      `Bio generator: could not read the template set at ${path} - ` +
        `${err instanceof Error ? err.message : String(err)}`,
    );
  }
  return parseTemplates(parsed, path);
}

const THEMES_NEEDED = ['professional', 'personal', 'quirky', 'minimal', 'cryptic'] as const;

/** Validate a parsed template file. Pure, so a test can drive it with an object. */
export function parseTemplates(raw: unknown, source: string): TemplateSet {
  const fail = (message: string): never => {
    throw new Error(`Bio generator: template set ${source} - ${message}`);
  };
  if (typeof raw !== 'object' || raw === null) fail('is not a JSON object.');
  const file = raw as Partial<TemplateSet>;

  if (typeof file.version !== 'string' || file.version.length === 0) {
    fail(
      'has no "version". A measured pattern share is a property of a specific template ' +
        'set, so a set that cannot be named cannot have anything measured against it.',
    );
  }
  if (typeof file.languages !== 'object' || file.languages === null) fail('has no "languages".');
  const languages = Object.keys(file.languages!);
  if (languages.length === 0) fail('authors no language.');
  if (typeof file.fallbackLanguage !== 'string' || file.languages![file.fallbackLanguage] === undefined) {
    fail('has a fallbackLanguage that is not one of the authored languages.');
  }
  for (const lang of languages) {
    const l = file.languages![lang]!;
    if (!Array.isArray(l.separators) || l.separators.length < 2) {
      fail(`language "${lang}" has fewer than two separators; separator variety is one of §6's mechanisms.`);
    }
    for (const theme of THEMES_NEEDED) {
      const pool = l.themes?.[theme];
      if (pool === undefined) fail(`language "${lang}" has no clause pool for theme "${theme}".`);
      if (pool.fragments.length === 0 || pool.sentences.length === 0) {
        fail(
          `language "${lang}" theme "${theme}" needs BOTH fragments and sentences. Real ` +
            `bios are frequently not sentences at all, and a pool with only one kind ` +
            `collapses a §6 mechanism.`,
        );
      }
      if (pool.nouns.length === 0) fail(`language "${lang}" theme "${theme}" has no nouns.`);
    }
  }
  if (!Array.isArray(file.emoji) || file.emoji.length === 0) fail('has no emoji pool.');
  if (typeof file.originLanguages !== 'object' || file.originLanguages === null) {
    fail('has no originLanguages map; language must follow originBlend rather than a global default (§7).');
  }
  return file as TemplateSet;
}

/**
 * A neutral population. Authored here, not specified.
 *
 * `bioEmpty` sits at 0.68, mid-range of the 0.60 to 0.75 research puts real platforms
 * at. §3 calls this the single property that most determines whether a member list
 * reads as real, and it is higher still on privacy-focused platforms, which this is.
 */
export const DEFAULT_BIO_POPULATION: BioPopulationConfig = Object.freeze({
  bioEmpty: 0.68,
  bioLength: { empty: 0.68, short: 0.2, medium: 0.09, long: 0.03 },
  lengthMedians: { short: 4, medium: 9, long: 18 },
});

export { generateBio, languageFor, structuralSignature } from './generate.js';
export { BIO_LENGTHS };
export * from './types.js';
