/**
 * Identity and rhythm: DRAWN from population parameters, biased by latent traits only
 * where the specification asks (briefing §3, §7).
 *
 * ── WHY IDENTITY TAKES THE LATENT VECTOR AT ALL, AND WHERE IT MUST NOT ──────
 *
 * It does not. `drawIdentity` has no `latent` parameter, and that is deliberate rather
 * than incidental. Origin, age and gender are not personality traits, and deriving them
 * from personality would encode propositions nobody intends: that extraverts come from
 * one place, or that anxious people are younger. The one bias the specification does
 * ask for - teenagers skewing toward handles - is a bias from AGE to NAME TYPE, both of
 * which are identity, so it stays inside identity.
 *
 * Rhythm is the mixed case and does take the latent vector, because §7 asks for exactly
 * three biases: extraversion on where an avatar lands on the participation curve,
 * conscientiousness on session pattern, and both on response latency.
 */

import { Rng } from '../rng.js';
import type { Latent } from '../traits/types.js';
import type {
  ActivityTier,
  HourRange,
  Identity,
  LogNormalParams,
  PopulationConfig,
  Rhythm,
  Style,
} from './types.js';
import type { NameType } from '../names/types.js';

/** Named streams, so adding a draw cannot shift the sequence an existing one sees. */
const STREAM_ORIGIN = 'surface:origin';
const STREAM_AGE = 'surface:age';
const STREAM_GENDER = 'surface:gender';
const STREAM_NAME = 'surface:name';
const STREAM_ACTIVITY = 'surface:activity';
const STREAM_SESSION = 'surface:session';
const STREAM_CIRCADIAN = 'surface:circadian';

/**
 * Draw the identity block. NO LATENT VECTOR: see the header.
 *
 * The returned shape feeds the name generator directly (`cultureMix`, `ageBand`,
 * `genderPresentation`, `fantasyIntensity`, `nameCase`), which is why it is shaped this
 * way rather than as whatever surface derivation would find most natural.
 */
export function drawIdentity(seed: number, population: PopulationConfig): Identity {
  const originRng = new Rng(seed, STREAM_ORIGIN);
  const primary = originRng.pickWeighted(population.originMix);
  const originBlend: Record<string, number> = { [primary]: 1 };
  if (originRng.chance(population.blendProbability)) {
    const second = originRng.pickWeighted(population.originMix);
    if (second !== primary) {
      originBlend[primary] = 0.7;
      originBlend[second] = 0.3;
    }
  }

  const ageBand = new Rng(seed, STREAM_AGE).pickWeighted(population.ageBandMix);
  const genderPresentation = new Rng(seed, STREAM_GENDER).pickWeighted(population.genderMix);

  // The one documented identity bias (§3): teenagers skew toward handles. Age to name
  // type, both identity; no personality involved.
  const nameRng = new Rng(seed, STREAM_NAME);
  const styleMix: Partial<Record<NameType, number>> = { ...population.nameStyleMix };
  if (ageBand === 'teen' && (styleMix.handle ?? 0) >= 0) {
    styleMix.handle = (styleMix.handle ?? 0) + population.teenHandleBoost;
  }
  const nameType = nameRng.pickWeighted(styleMix);
  const nameCase = nameRng.pickWeighted(population.nameCaseMix);
  // Continuous 0..100, as the name generator expects.
  const fantasyIntensity = nameType === 'fantasy' ? 40 + nameRng.float() * 60 : nameRng.float() * 40;

  return {
    originBlend,
    ageBand,
    genderPresentation,
    nameType,
    namePattern: `${nameType}:${primary}`,
    fantasyIntensity,
    nameCase,
  };
}

/**
 * Where an avatar lands on the participation curve.
 *
 * THE CURVE IS A POPULATION PROPERTY, NOT PERSONALITY (briefing §7). One percent of
 * members produce roughly seventy percent of messages regardless of who they are.
 * Extraversion biases WHERE an avatar lands on that curve; it does not define the
 * curve, and the shares below come from the population configuration rather than from
 * anyone's traits.
 */
function drawActivityTier(
  seed: number,
  latent: Latent,
  population: PopulationConfig,
): ActivityTier {
  const tiers = { ...population.activityTiers };
  // Extraversion tilts the draw without changing the curve's shape: a strongly
  // extraverted avatar is more likely to be a superuser, not certain to be one.
  const tilt = Math.exp(0.55 * latent.extraversion);
  tiers.superuser *= tilt;
  tiers.contributor *= Math.sqrt(tilt);
  return new Rng(seed, STREAM_ACTIVITY).pickWeighted(tiers);
}

/** Circadian mask: a waking window, offset by the origin's timezone. */
function drawCircadian(seed: number, timezoneOffset: number): HourRange[] {
  const rng = new Rng(seed, STREAM_CIRCADIAN);
  // Wake between 06:00 and 09:00 local, active for 14 to 17 hours.
  const wake = 6 + rng.int(4);
  const span = 14 + rng.int(4);
  const from = (((wake + timezoneOffset) % 24) + 24) % 24;
  const to = (from + span) % 24;
  return from <= to ? [{ from, to }] : [{ from, to: 23 }, { from: 0, to }];
}

/**
 * Rhythm. The mixed case: drawn from population parameters, biased by latent traits in
 * the three places §7 names and nowhere else.
 *
 * `messageLength` and `responseLatency` go through the PERCENTILE, not directly from
 * the latent combination (briefing §13.2 leaves the choice open). The percentile route
 * is the only one that can hit the measured population target: §7 gives message length
 * a median of six to ten words, and mapping a percentile onto a range guarantees that
 * the population median lands there whatever the loadings are. A direct combination
 * would put the median wherever the weights happened to place it.
 */
export function drawRhythm(
  seed: number,
  latent: Latent,
  style: Style,
  population: PopulationConfig,
  timezoneOffset: number,
): Rhythm {
  const activityTier = drawActivityTier(seed, latent, population);

  const patterns = { ...population.sessionPatterns };
  const c = latent.conscientiousness;
  patterns.steady *= Math.exp(0.6 * c);
  patterns.sporadic *= Math.exp(-0.6 * c);
  const sessionPattern = new Rng(seed, STREAM_SESSION).pickWeighted(patterns);

  // Median response latency, in seconds. Extraverts answer sooner; the conscientious
  // answer sooner still. Mapped through the style percentiles so the population spread
  // is controlled rather than emergent.
  const promptness = (style.verbosity + (100 - style.tone)) / 200; // 0..1
  const responseLatency: LogNormalParams = {
    median: Math.round(30 + (1 - promptness) * 570),
    sigma: 1.1,
  };

  // Target median six to ten words across the population (§7). verbosity is uniform on
  // 0..100 by construction, so mapping it linearly onto 4..14 puts the population
  // median at 9 words, inside the target band.
  const messageLength: LogNormalParams = {
    median: Number((4 + (style.verbosity / 100) * 10).toFixed(2)),
    sigma: 0.85,
  };

  return {
    activityTier,
    interEventAlpha: population.interEventAlpha,
    circadianMask: drawCircadian(seed, timezoneOffset),
    sessionPattern,
    responseLatency,
    messageLength,
  };
}

/** Timezone follows origin (briefing §7), never personality. */
export function timezoneFor(identity: Identity, population: PopulationConfig): number {
  const primary = Object.entries(identity.originBlend).sort((a, b) => b[1] - a[1])[0]?.[0];
  return primary === undefined ? 0 : (population.originTimezones[primary] ?? 0);
}
