/**
 * Surface derivation: public entry point (CCB-S4-005).
 *
 *     import { loadLoadings, prepareSurface, DEFAULT_POPULATION } from './generator/surface/index.js';
 *
 *     const loadings = loadLoadings();                  // once, at startup
 *     const derive = prepareSurface(archetypes, traitConfig, loadings);
 *     const surface = derive({ seed: 42, latent });     // per avatar
 *
 * ── WHERE THE LOADING SET LIVES (briefing §13.1, the open question) ─────────
 *
 * Beside THIS component, at `data/loadings.json`, not beside the archetype set.
 *
 * §4.2 says "alongside the archetype set" and §13.1 asks whether that is right. The
 * archetype decision was "beside the sampler, because only the loader knows the path",
 * and the same reasoning applies here with the opposite conclusion about WHICH module:
 * the loadings belong to surface derivation, not to the trait sampler, and putting them
 * beside `archetypes.json` would give the sampler a data file it never reads. The
 * injection seam means the cost of being wrong is one path in one function.
 *
 * ── WHAT IS DELIVERED, AND WHAT IS NOT ─────────────────────────────────────
 *
 * Style, rhythm and identity, with the coherence cap, overrides and the collinearity
 * diagnostic. NOT delivered, and out of scope per §12: bios, avatar images, name
 * generation itself (this feeds it), the population layer, the behaviour layer, and
 * persistence. The style loadings are AUTHORED, not read off any data; whether real
 * populations write this way is the same open question the archetype set carries.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import {
  DEFAULT_ARCHETYPE_MIX,
  DEFAULT_SIGMA,
  DEFAULT_UNCLASSIFIED_SHARE,
  defaultCovariance,
  populationMoments,
  type ArchetypeSet,
  type Latent,
  type TraitConfig,
} from '../traits/index.js';
import { deriveStyle, styleNormalisation, type StyleNormalisation } from './style.js';
import { drawContent, drawIdentity, drawRhythm, timezoneFor } from './draw.js';
import { REACTIONS, STYLE_FIELDS, type LoadingSet, type PopulationConfig, type Surface, type SurfaceRequest } from './types.js';

const HERE = dirname(fileURLToPath(import.meta.url));

export interface LoadLoadingsOptions {
  path?: string;
}

/** THE ONLY FILE-READING FUNCTION HERE. Call once at startup, never per avatar. */
export function loadLoadings(options: LoadLoadingsOptions = {}): LoadingSet {
  const path = resolve(HERE, options.path ?? './data/loadings.json');
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(path, 'utf8'));
  } catch (err) {
    throw new Error(
      `Surface: could not read the loading set at ${path} - ` +
        `${err instanceof Error ? err.message : String(err)}`,
    );
  }
  return parseLoadings(parsed, path);
}

/** Validate a parsed loading file. Pure, so a test can drive it with an object. */
export function parseLoadings(raw: unknown, source: string): LoadingSet {
  const fail = (message: string): never => {
    throw new Error(`Surface: loading set ${source} - ${message}`);
  };
  if (typeof raw !== 'object' || raw === null) fail('is not a JSON object.');
  const file = raw as Partial<LoadingSet>;

  if (typeof file.version !== 'string' || file.version.length === 0) {
    fail(
      'has no "version". Derived values are properties of a specific weight set, so a ' +
        'set that cannot be named cannot have anything measured against it.',
    );
  }
  if (typeof file.style !== 'object' || file.style === null) fail('has no "style" block.');
  for (const field of STYLE_FIELDS) {
    const vector = file.style![field];
    if (typeof vector !== 'object' || vector === null) fail(`has no loadings for "${field}".`);
    const nonZero = Object.values(vector).filter((v) => typeof v === 'number' && v !== 0);
    if (nonZero.length === 0) {
      fail(`gives "${field}" no non-zero weight, so it cannot be mapped to a percentile.`);
    }
  }
  if (typeof file.reactions !== 'object' || file.reactions === null) fail('has no "reactions".');
  for (const r of REACTIONS) {
    if (typeof file.reactions![r] !== 'object') fail(`has no score weights for reaction ${r}.`);
  }
  if (!Array.isArray(file.coherence)) {
    fail('has no "coherence" ARRAY. It is a list so every rule can report a firing rate.');
  }
  const ids = new Set<string>();
  for (const rule of file.coherence ?? []) {
    if (typeof rule.id !== 'string' || rule.id.length === 0) fail('has a coherence rule with no id.');
    if (ids.has(rule.id)) fail(`has two coherence rules called "${rule.id}".`);
    ids.add(rule.id);
    if (rule.kind !== 'cap-when-below') {
      fail(`coherence rule "${rule.id}" has unknown kind ${JSON.stringify(rule.kind)}.`);
    }
  }
  if (typeof file.temperature !== 'number' || !(file.temperature > 0)) {
    fail('has no positive "temperature"; at 1.0 the reaction distribution barely discriminates.');
  }
  if (typeof file.reactionFloor !== 'number' || file.reactionFloor < 0 || file.reactionFloor >= 1 / REACTIONS.length) {
    fail(
      `has a reactionFloor of ${String(file.reactionFloor)}. It must sit in [0, ` +
        `${(1 / REACTIONS.length).toFixed(3)}); at or above that it can empty the distribution.`,
    );
  }
  return file as LoadingSet;
}

/** A neutral population. Authored here, not specified, and not read off any data. */
export const DEFAULT_POPULATION: PopulationConfig = Object.freeze({
  originMix: { en: 4, de: 2, es: 2, fr: 1, nl: 1 },
  originTimezones: { en: 0, de: 1, es: 1, fr: 1, nl: 1 },
  ageBandMix: { teen: 0.08, youngAdult: 0.3, adult: 0.38, middleAged: 0.18, senior: 0.06 },
  genderMix: { female: 0.42, male: 0.44, neutral: 0.09, unspecified: 0.05 },
  nameStyleMix: { pseudonym: 0.45, firstName: 0.2, real: 0.15, mononym: 0.08, initials: 0.07, fantasy: 0.05 },
  teenHandleBoost: 0.35,
  nameCaseMix: { natural: 0.7, lower: 0.22, mixed: 0.08 },
  blendProbability: 0.12,
  // One percent produce roughly seventy percent of messages (§7). A population
  // property, not personality.
  activityTiers: { superuser: 0.01, contributor: 0.19, lurker: 0.8 },
  sessionPatterns: { steady: 0.34, bursty: 0.4, sporadic: 0.26 },
  interEventAlpha: 1.5,
  interestPool: [
    'photography', 'cycling', 'cooking', 'linux', 'privacy', 'gardening', 'chess',
    'synthesizers', 'hiking', 'typography', 'coffee', 'bookbinding', 'astronomy',
    'running', 'woodworking', 'languages', 'cats', 'vinyl', 'baking', 'sailing',
  ],
  bioThemeMix: { professional: 0.2, personal: 0.24, quirky: 0.16, minimal: 0.16, cryptic: 0.08, none: 0.16 },
});

export interface PreparedSurface {
  (request: Omit<SurfaceRequest, 'population' | 'loadings'>): Surface;
  readonly normalisation: StyleNormalisation;
}

/**
 * Precompute the analytic normalisation once, then derive per avatar.
 *
 * The normalisation depends on the archetype set and the trait configuration, never on
 * the avatar, so computing it per call would repeat the same closed-form arithmetic for
 * every avatar in a population.
 */
export function prepareSurface(
  archetypes: ArchetypeSet,
  traitConfig: Pick<TraitConfig, 'archetypeMix' | 'unclassifiedShare' | 'sigma' | 'unclassifiedSigma' | 'covariance'>,
  loadings: LoadingSet,
  population: PopulationConfig = DEFAULT_POPULATION,
): PreparedSurface {
  const moments = populationMoments(archetypes, traitConfig);
  const normalisation = styleNormalisation(loadings, moments);

  const derive = (request: Omit<SurfaceRequest, 'population' | 'loadings'>): Surface => {
    const overrides = request.overrides ?? {};
    const { style, capped, firedRules } = deriveStyle(request.latent, loadings, normalisation, overrides);
    const identity = drawIdentity(request.seed, population);
    const rhythm = drawRhythm(
      request.seed,
      request.latent,
      style,
      population,
      timezoneFor(identity, population),
    );
    const content = drawContent(request.seed, request.latent, style, population);
    return { style, firedRules, identity, rhythm, content, capped, overrides: Object.keys(overrides) };
  };

  return Object.assign(derive, { normalisation });
}

/** One avatar, the specified §10 entry point. Prepares on every call. */
export function deriveSurface(request: SurfaceRequest, archetypes: ArchetypeSet): Surface {
  const traitConfig = {
    archetypeMix: DEFAULT_ARCHETYPE_MIX,
    unclassifiedShare: DEFAULT_UNCLASSIFIED_SHARE,
    sigma: DEFAULT_SIGMA,
    covariance: defaultCovariance(),
  };
  const prepared = prepareSurface(archetypes, traitConfig, request.loadings, request.population);
  return prepared({ seed: request.seed, latent: request.latent, ...(request.overrides ? { overrides: request.overrides } : {}) });
}

export type { Latent };
export {
  deriveReactionWeights,
  derivePercentile,
  normalCdf,
  normalisationFor,
  styleNormalisation,
  type FieldNormalisation,
  type StyleNormalisation,
} from './style.js';
export { drawContent, drawIdentity, drawRhythm, timezoneFor } from './draw.js';
export * from './types.js';
