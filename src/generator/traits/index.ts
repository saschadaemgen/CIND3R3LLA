/**
 * Trait sampler: public entry point.
 *
 * Second component of the profile generator. Turns a seed plus a configuration
 * into a six-dimensional personality vector and an archetype label. Pure
 * computation: no corpus, no filesystem, no database, no clock.
 *
 *     import {
 *       loadArchetypes, prepareTraitSampler, defaultCovariance,
 *       DEFAULT_ARCHETYPE_MIX, DEFAULT_SIGMA, DEFAULT_UNCLASSIFIED_SHARE,
 *     } from './generator/traits/index.js';
 *
 *     const archetypes = loadArchetypes();          // once, at startup
 *     const sampler = prepareTraitSampler({
 *       archetypeMix: DEFAULT_ARCHETYPE_MIX,
 *       unclassifiedShare: DEFAULT_UNCLASSIFIED_SHARE,
 *       sigma: DEFAULT_SIGMA,
 *       covariance: defaultCovariance(),
 *     }, archetypes);
 *
 *     const avatar = sampler.draw(42);              // { archetype, latent }
 *
 * `sampleTraits(request, archetypes)` is the one-shot form of the same thing, with
 * the seed inside the request, exactly as briefing §6 specifies it.
 *
 * WHAT IS DELIVERED, AND WHAT IS NOT. The sampling procedure, determinism, the
 * covariance model, the archetype set and every property in briefing §7 are built
 * and verified. Surface derivation (tone, verbosity, emoji affinity, reaction
 * weights) is a separate component and is explicitly not here (§8); so are names,
 * bios, the population layer and persistence. This takes a seed and a configuration
 * and returns six numbers and an archetype label.
 *
 * THE TWO STARTING BOUNDS ARE NOT ESTABLISHED VALUES. Briefing §7 sets the adjusted
 * mutual information between clusters and true archetypes at above 0.2 and below
 * 0.9, and says so explicitly. `verify:traits` prints the measured figure on every
 * run, passing or failing, so the bounds can be calibrated once real output exists.
 */

export { sampleTraits, prepareTraitSampler, type PreparedTraitSampler } from './sample.js';

export {
  loadArchetypes,
  parseArchetypes,
  assertSeparation,
  separations,
  type LoadArchetypesOptions,
  type SeparationPair,
} from './archetypes.js';

export {
  DEFAULT_CORRELATIONS,
  DEFAULT_COVARIANCE,
  FACTOR_STRUCTURE,
  assertCorrelationMatrix,
  buildCorrelationMatrix,
  cholesky,
  defaultCovariance,
  isPositiveDefinite,
  productWithTranspose,
  ridgeRepair,
  type RidgeRepairResult,
} from './covariance.js';

export { standardNormals } from './normal.js';
export {
  populationMoments,
  linearCombinationMean,
  linearCombinationVariance,
  linearCombinationCorrelation,
  type PopulationMoments,
} from './population.js';
export { Rng } from '../rng.js';

export {
  ARCHETYPE_SEPARATION_MAX,
  ARCHETYPE_SEPARATION_MIN,
  DEFAULT_ARCHETYPE_MIX,
  DEFAULT_ARCHETYPE_SEPARATION,
  DEFAULT_SIGMA,
  DEFAULT_UNCLASSIFIED_SHARE,
  SIGMA_MAX,
  SIGMA_MIN,
  TRAIT_COUNT,
  TRAIT_INDEX,
  TRAIT_ORDER,
  UNCLASSIFIED_SIGMA_FACTOR,
  type Archetype,
  type ArchetypeSet,
  type Latent,
  type TraitConfig,
  type TraitKey,
  type TraitRequest,
  type TraitResult,
} from './types.js';
