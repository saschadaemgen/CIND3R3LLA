/**
 * Profile assembly and review (CCB-S4-007).
 *
 * Brings the four components together and makes the result readable by a person.
 * **It generates nothing.** If something is missing that is a gap in a component, not
 * something for this to fill.
 *
 * ── WHY THIS EXISTS ────────────────────────────────────────────────────────
 *
 * CCB-S4-006 made the case better than any argument: every population statistic passed
 * while the text was wrong. Empty rate, length distribution, structural pattern share,
 * four varying mechanisms, all green - and then twenty-six bios were read and three
 * defects appeared that no numeric check could see.
 *
 * That is the general case for anything a person will read, and the validation approach
 * this workstream is heading toward is entirely statistical. Fidelity, coverage,
 * dependence and classifiability would all pass a population whose text is nonsense.
 * This component exists so that reading is a STEP rather than an act of
 * conscientiousness.
 */

import { generateName, loadCorpus, type NameCorpus, type NameResult } from '../names/index.js';
import {
  DEFAULT_ARCHETYPE_MIX,
  DEFAULT_SIGMA,
  DEFAULT_UNCLASSIFIED_SHARE,
  defaultCovariance,
  loadArchetypes,
  prepareTraitSampler,
  type ArchetypeSet,
  type Latent,
  type TraitConfig,
} from '../traits/index.js';
import {
  DEFAULT_POPULATION,
  loadLoadings,
  prepareSurface,
  type LoadingSet,
  type PopulationConfig,
  type Surface,
} from '../surface/index.js';
import {
  DEFAULT_BIO_POPULATION,
  generateBio,
  loadTemplates,
  type BioPopulationConfig,
  type BioResult,
  type TemplateSet,
} from '../bio/index.js';

/** One fully assembled profile. Everything traceable to the seed that produced it. */
export interface AssembledProfile {
  /** §4: a profile that looks wrong must be reproducible in isolation. */
  seed: number;
  latent: Latent;
  archetype: string | null;
  surface: Surface;
  name: NameResult;
  bio: BioResult & { fellBack: boolean };
}

/** The four data sets, and their versions. §5 requires a review to record all four. */
export interface Components {
  archetypes: ArchetypeSet;
  loadings: LoadingSet;
  templates: TemplateSet;
  corpus: NameCorpus;
}

export interface AssembleConfig {
  traits: TraitConfig;
  population: PopulationConfig;
  bio: BioPopulationConfig;
}

export const DEFAULT_ASSEMBLE_CONFIG: AssembleConfig = {
  traits: {
    archetypeMix: DEFAULT_ARCHETYPE_MIX,
    unclassifiedShare: DEFAULT_UNCLASSIFIED_SHARE,
    sigma: DEFAULT_SIGMA,
    covariance: defaultCovariance(),
  },
  population: DEFAULT_POPULATION,
  bio: DEFAULT_BIO_POPULATION,
};

/** Load every component data set once. Never per profile. */
export function loadComponents(): Components {
  return {
    archetypes: loadArchetypes(),
    loadings: loadLoadings(),
    templates: loadTemplates(),
    corpus: loadCorpus(),
  };
}

/** The four versions, in one place, for the review record. */
export function componentVersions(components: Components): Record<string, string> {
  return {
    archetypes: components.archetypes.version,
    loadings: components.loadings.version,
    templates: components.templates.version,
    names: components.corpus.version,
  };
}

export interface PreparedAssembler {
  (seed: number): AssembledProfile;
  readonly components: Components;
  readonly config: AssembleConfig;
}

/**
 * Prepare once, assemble per profile.
 *
 * ONE SEED DRIVES EVERY COMPONENT. That is what makes §7's "a profile regenerated from
 * its own seed alone matches the one in the population" true: there is no per-population
 * state, so profile 4,271 is the same object whether it is the 4,271st of fifty thousand
 * or the only one asked for.
 */
export function prepareAssembler(
  components: Components,
  config: AssembleConfig = DEFAULT_ASSEMBLE_CONFIG,
): PreparedAssembler {
  const sampler = prepareTraitSampler(config.traits, components.archetypes);
  const surface = prepareSurface(
    components.archetypes,
    config.traits,
    components.loadings,
    config.population,
  );

  const assemble = (seed: number): AssembledProfile => {
    const drawn = sampler.draw(seed);
    const s = surface({ seed, latent: drawn.latent });

    // The identity block was shaped to feed the name generator directly (CCB-S4-005 §10),
    // which is why nothing is translated here.
    const name = generateName(
      {
        seed,
        cultureMix: s.identity.originBlend,
        blendProbability: config.population.blendProbability,
        nameStyleMix: { [s.identity.nameType]: 1 },
        genderPresentation: s.identity.genderPresentation,
        ageBand: s.identity.ageBand,
        fantasyIntensity: s.identity.fantasyIntensity,
        nameCase: s.identity.nameCase,
      },
      components.corpus,
    );

    const bio = generateBio(
      seed,
      { latent: drawn.latent, style: s.style, identity: s.identity, rhythm: s.rhythm, content: s.content },
      components.templates,
      config.bio,
    );

    return { seed, latent: drawn.latent, archetype: drawn.archetype, surface: s, name, bio };
  };

  return Object.assign(assemble, { components, config });
}

/** A population, from one seed and one configuration. */
export function assemblePopulation(
  assembler: PreparedAssembler,
  count: number,
  firstSeed = 0,
): AssembledProfile[] {
  return Array.from({ length: count }, (_, i) => assembler(firstSeed + i));
}

/**
 * Names the conditioning exactly, for the bio cache key.
 *
 * The four data set versions verbatim, plus a short digest of the configuration. Both
 * halves matter: swapping the archetype set and nudging the theme mix both change who the
 * person is, and cached text written for a different person is the one failure a
 * seed-keyed cache could otherwise hide.
 */
export function conditioningVersion(components: Components, config: AssembleConfig): string {
  const versions = Object.values(componentVersions(components)).join('+');
  // FNV-1a over the configuration. A digest rather than the config itself, because this
  // ends up in every cache key and only needs to CHANGE when the configuration does.
  let h = 0x811c9dc5;
  for (const ch of JSON.stringify(config)) {
    h ^= ch.charCodeAt(0);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return `${versions}#${h.toString(16).padStart(8, '0')}`;
}

export { renderDetail, renderCrowd, renderDistribution, renderReview } from './render.js';
export { runModelPass, type ModelPassReport, type ModelPassOptions } from './model-pass.js';
