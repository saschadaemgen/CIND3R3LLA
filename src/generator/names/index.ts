/**
 * Name generator: public entry point.
 *
 * First component of the profile generator (briefing "Name generator"). Turns a
 * seed plus a configuration into a name. Standalone and deterministic: no schema,
 * no runtime, no database, no SimpleX call.
 *
 *     import { loadCorpus, generateName, DEFAULT_NAME_STYLE_MIX } from './generator/names/index.js';
 *
 *     const corpus = loadCorpus();                    // once, at startup
 *     const name = generateName({ seed: 42, ... }, corpus);
 *
 * WHAT IS DELIVERED, AND WHAT IS NOT. The pipeline, the culture-grammar engine,
 * determinism, the population statistics and the SimpleX sanitisation are built and
 * verified. "Culturally coherent names" is NOT delivered: the shipped corpus has no
 * culture labels, so the grammar engine currently runs against small hand-authored
 * FIXTURE pools. That property arrives with a real labelled corpus, and the swap
 * point is documented in `corpus.ts`.
 */

export { generateName } from './generate.js';
export { loadCorpus, verifyCorpus, type LoadCorpusOptions } from './corpus.js';
export { CULTURE_GRAMMARS, grammarFor } from './grammars.js';
export { Rng } from '../rng.js';
export { sanitiseForSimplex, isSimplexSafe } from './sanitise.js';

export {
  DEFAULT_NAME_STYLE_MIX,
  NAME_TYPES,
  type AgeBand,
  type CultureGrammar,
  type CulturePool,
  type FantasyPools,
  type GenderPresentation,
  type GrammarStructure,
  type NameCase,
  type NameCorpus,
  type NamePart,
  type NameRequest,
  type NameResult,
  type NameType,
  type WordPools,
} from './types.js';
