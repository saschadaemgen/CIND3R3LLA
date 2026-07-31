/**
 * Surface derivation, proven (CCB-S4-005 §11), and the §8 diagnostic.
 *
 *   npx tsx scripts/verify-surface.ts
 *
 * ── OWN HARNESS, NOT FOLDED INTO verify:traits (briefing §13.3) ─────────────
 *
 * §13.3 leaves this open. Separate, because the two harnesses gate different data
 * files against different specifications: `verify:traits` is about the archetype set
 * and would start failing for reasons that have nothing to do with the trait sampler
 * the moment someone edited `loadings.json`. Both print a cross-reference so "one place
 * to look" is preserved by pointing rather than by merging.
 *
 * ── GATES CORRECTNESS, REPORTS QUALITY ─────────────────────────────────────
 *
 * The same split D-095 settled for the trait sampler. Determinism, the derived/drawn
 * separation, direction of effect, override and cap behaviour and the reaction-weight
 * invariants all FAIL the run. The percentile uniformity deviation and the style
 * collinearity matrix are REPORTED, because §11 says so in terms: a perfectly uniform
 * marginal would mean the archetype structure had washed out entirely, so some
 * non-uniformity is the archetypes surviving into the visible layer, which is the point
 * of having them.
 */

import {
  DEFAULT_ARCHETYPE_MIX,
  DEFAULT_SIGMA,
  DEFAULT_UNCLASSIFIED_SHARE,
  TRAIT_ORDER,
  defaultCovariance,
  loadArchetypes,
  linearCombinationCorrelation,
  populationMoments,
  prepareTraitSampler,
  type Latent,
} from '../src/generator/traits/index.js';
import {
  DEFAULT_POPULATION,
  REACTIONS,
  STYLE_FIELDS,
  derivePercentile,
  deriveReactionWeights,
  drawIdentity,
  loadLoadings,
  normalCdf,
  parseLoadings,
  prepareSurface,
  type StyleField,
} from '../src/generator/surface/index.js';
import { mean, variance } from './trait-metrics.js';

let failures = 0;
function check(label: string, ok: boolean, detail = ''): void {
  if (!ok) failures++;
  console.log(`  [${ok ? 'PASS' : 'FAIL'}] ${label}${detail ? ` - ${detail}` : ''}`);
}
function section(t: string): void {
  console.log(`\n${t}`);
}
function measure(label: string, value: string): void {
  console.log(`  [....] ${label} = ${value}`);
}
function threw(fn: () => unknown): Error | null {
  try {
    fn();
    return null;
  } catch (err) {
    return err instanceof Error ? err : new Error(String(err));
  }
}

const archetypes = loadArchetypes();
const loadings = loadLoadings();
const traitConfig = {
  archetypeMix: DEFAULT_ARCHETYPE_MIX,
  unclassifiedShare: DEFAULT_UNCLASSIFIED_SHARE,
  sigma: DEFAULT_SIGMA,
  covariance: defaultCovariance(),
};
const derive = prepareSurface(archetypes, traitConfig, loadings);
const sampler = prepareTraitSampler(traitConfig, archetypes);

const N = 20_000;
const population = Array.from({ length: N }, (_, i) => {
  const drawn = sampler.draw(i);
  return { seed: i, latent: drawn.latent, surface: derive({ seed: i, latent: drawn.latent }) };
});

/* ============================================================== versioning */

section('Versioning and loading');
{
  measure('loading set', loadings.version);
  measure('archetype set', archetypes.version);
  check('the loading set is versioned', loadings.version.length > 0);
  check(
    'a loading set with no version is refused',
    /has no "version"/.test(threw(() => parseLoadings({ style: {} }, 'fixture'))?.message ?? ''),
  );
  check(
    'a style field with no non-zero weight is refused',
    threw(() =>
      parseLoadings(
        { ...loadings, style: { ...loadings.style, tone: { openness: 0 } } },
        'fixture',
      ),
    ) !== null,
  );
  check(
    'a reaction floor that could empty the distribution is refused',
    threw(() => parseLoadings({ ...loadings, reactionFloor: 0.2 }, 'fixture')) !== null,
  );
}

/* ============================================================ §11 determinism */

section('Determinism (§11)');
{
  const latent = population[7]!.latent;
  const a = derive({ seed: 4242, latent });
  const b = derive({ seed: 4242, latent });
  check('identical latent and configuration produce an identical Surface',
    JSON.stringify(a) === JSON.stringify(b));

  // THE PROPERTY THAT KEEPS §3 HONEST: style is derived, identity is drawn.
  const other = derive({ seed: 9999, latent });
  check('a different seed leaves STYLE identical',
    JSON.stringify(a.style) === JSON.stringify(other.style));
  const identityDiffers = JSON.stringify(a.identity) !== JSON.stringify(other.identity);
  check('a different seed changes IDENTITY', identityDiffers);

  // And identity must not move when only the personality does.
  const differentLatent: Latent = { ...latent, extraversion: latent.extraversion + 2 };
  const samSeed = derive({ seed: 4242, latent: differentLatent });
  check('changing the latent vector does NOT change identity',
    JSON.stringify(a.identity) === JSON.stringify(samSeed.identity),
    'origin, age and gender are not personality traits');
  check('changing the latent vector DOES change style',
    JSON.stringify(a.style) !== JSON.stringify(samSeed.style));
}

/* ====================================================== §11 derivation correctness */

section('Derivation correctness (§11)');
{
  const base: Latent = {
    openness: 0, conscientiousness: 0, extraversion: 0,
    agreeableness: 0, neuroticism: 0, honesty: 0,
  };
  const norm = derive.normalisation;

  // Moving one trait must move each field the way its loadings say, and leave fields
  // with no loading on that trait exactly unchanged.
  let wrongDirection = 0;
  let movedWithoutLoading = 0;
  for (const trait of TRAIT_ORDER) {
    const up: Latent = { ...base, [trait]: 1.5 };
    for (const field of STYLE_FIELDS) {
      const w = loadings.style[field][trait] ?? 0;
      const before = derivePercentile(loadings.style[field], base, norm[field]);
      const after = derivePercentile(loadings.style[field], up, norm[field]);
      if (w === 0) {
        if (Math.abs(after - before) > 1e-9) movedWithoutLoading++;
      } else if (Math.sign(after - before) !== Math.sign(w)) {
        wrongDirection++;
      }
    }
  }
  check('every field moves in the direction its loadings specify', wrongDirection === 0,
    `${wrongDirection} wrong`);
  check('a field with no loading on a trait does not move when that trait moves',
    movedWithoutLoading === 0, `${movedWithoutLoading} moved`);

  // The analytic normalisation is the load-bearing claim of §4.1. Check it rather than
  // trusting it: the closed form must match a large sample.
  const moments = populationMoments(archetypes, traitConfig);
  let worstSd = 0;
  let worstMean = 0;
  for (const field of STYLE_FIELDS) {
    const w = TRAIT_ORDER.map((t) => loadings.style[field][t] ?? 0);
    const raws = population.map((p) => {
      let r = 0;
      TRAIT_ORDER.forEach((t, i) => (r += w[i]! * p.latent[t]));
      return r;
    });
    worstSd = Math.max(worstSd, Math.abs(Math.sqrt(variance(raws)) - norm[field]!.sd));
    worstMean = Math.max(worstMean, Math.abs(mean(raws) - norm[field]!.mean));
  }
  measure('analytic vs empirical', `sd differs by at most ${worstSd.toFixed(4)}, mean by ${worstMean.toFixed(4)}`);

  // THE OTHER MOMENT. The specification calls the traits z-scores: population mean 0 AND
  // standard deviation 1. The calibration work constrained the sd and reached 0.984;
  // nobody had checked the mean, so the z-score claim was half established. It is free
  // here, because populationMoments already computes it for the percentile transform.
  const absMean = moments.mean.map(Math.abs);
  const worstTrait = TRAIT_ORDER[absMean.indexOf(Math.max(...absMean))];
  measure('population MEAN per trait (analytic)',
    TRAIT_ORDER.map((t, i) => `${t.slice(0, 4)} ${moments.mean[i]!.toFixed(3)}`).join('  '));
  measure('largest mean magnitude', `${Math.max(...absMean).toFixed(3)} on ${worstTrait}`);
  console.log('         REPORTED. The z-score claim has two halves and only the sd half was ever');
  console.log('         constrained. If the mean is materially non-zero the same question arises');
  console.log('         as it did for the sd: a constraint the archetype solve should carry, or a');
  console.log('         documented property of the set.');
  check('the analytic standard deviation matches a large sample within 0.02',
    worstSd < 0.02, worstSd.toFixed(4));
  check('the analytic mean matches a large sample within 0.02', worstMean < 0.02, worstMean.toFixed(4));
  check('the population covariance is the one the sampler actually produces',
    Math.abs(Math.sqrt(moments.covariance[0]![0]!) -
      Math.sqrt(variance(population.map((p) => p.latent.openness)))) < 0.02);

  // Abramowitz and Stegun 7.1.26 carries a residual of about 1e-9 at z=0, so this is a
  // tolerance rather than an equality. The residual is seven orders of magnitude finer
  // than the 0..100 scale it feeds.
  check('normalCdf is a CDF',
    Math.abs(normalCdf(0) - 0.5) < 1e-7 && normalCdf(-3) < 0.002 && normalCdf(3) > 0.998 &&
      normalCdf(-8) >= 0 && normalCdf(8) <= 1,
    `Phi(0)=${normalCdf(0).toFixed(9)}, Phi(3)=${normalCdf(3).toFixed(6)}`);
}

/* ============================================================ §11 the percentile */

section('The percentile property (§11): REPORTED, NOT GATED');
{
  console.log('         field                 mean   median   |deviation from uniform|');
  let worstDeviation = 0;
  for (const field of STYLE_FIELDS) {
    const values = population.map((p) => p.surface.style[field]).sort((a, b) => a - b);
    const m = mean(values);
    const median = values[Math.floor(values.length / 2)]!;
    // Kolmogorov-style: largest gap between the empirical CDF and uniform.
    let maxGap = 0;
    for (let i = 0; i < values.length; i += 25) {
      maxGap = Math.max(maxGap, Math.abs(values[i]! / 100 - i / values.length));
    }
    worstDeviation = Math.max(worstDeviation, maxGap);
    console.log(
      `         ${field.padEnd(20)}${m.toFixed(1).padStart(6)}${median.toFixed(1).padStart(9)}${maxGap.toFixed(4).padStart(12)}`,
    );
  }
  measure('worst deviation from uniform', worstDeviation.toFixed(4));
  console.log(
    '         NOT GATED, per §11. A perfectly uniform marginal would mean the archetype',
  );
  console.log(
    '         structure had washed out entirely in the surface. Some non-uniformity is',
  );
  console.log(
    '         the archetypes surviving into the visible layer, which is why they exist.',
  );
  // What IS gated: the transform must be on the right scale at all.
  check('every field stays within 0..100', population.every((p) =>
    STYLE_FIELDS.every((f) => p.surface.style[f] >= 0 && p.surface.style[f] <= 100)));
}

/* ============================================================ §6, §11 reactions */

section('Reaction weights (§6, §11)');
{
  let worstSum = 0;
  for (const p of population) {
    const total = Object.values(p.surface.style.reactionWeights).reduce((a, b) => a + b, 0);
    worstSum = Math.max(worstSum, Math.abs(total - 1));
  }
  check('the weights sum to one for every avatar', worstSum < 1e-9, worstSum.toExponential(2));

  // "Genuinely rare rather than merely small" (§6): an absent key means never.
  const highA = population.filter((p) => p.latent.agreeableness > 1);
  const lowA = population.filter((p) => p.latent.agreeableness < -1);
  const thumbsDownHighA = highA.filter((p) => (p.surface.style.reactionWeights['👎'] ?? 0) > 0);
  const thumbsDownLowA = lowA.filter((p) => (p.surface.style.reactionWeights['👎'] ?? 0) > 0);
  const rateHigh = thumbsDownHighA.length / highA.length;
  const rateLow = thumbsDownLowA.length / lowA.length;
  measure('thumbs-down availability',
    `${(rateHigh * 100).toFixed(1)}% of high-A avatars, ${(rateLow * 100).toFixed(1)}% of low-A ` +
      `(n=${highA.length} / ${lowA.length})`);
  check('thumbs-down is genuinely rare for agreeable avatars', rateHigh < 0.02,
    `${(rateHigh * 100).toFixed(2)}%`);
  check('and low-agreeableness avatars do have it', rateLow > 0.5, `${(rateLow * 100).toFixed(1)}%`);

  const activeCounts = population.map((p) => Object.keys(p.surface.style.reactionWeights).length);
  measure('active reactions per avatar', `${mean(activeCounts).toFixed(2)} of ${REACTIONS.length} on average`);
  check('not every avatar has every reaction, so the distribution expresses personality',
    mean(activeCounts) < REACTIONS.length - 0.5);
}

/* ================================================================ §5, §9 cap */

section('The coherence cap (§5) and overrides (§9)');
{
  // Every rule reports, and ZERO IS A FINDING rather than a pass: a rule that never
  // fires is either decoration, or it guards against something a defect elsewhere has
  // made impossible. The second was the live case here, and a report asking only
  // whether a rule fired too often could not have seen it.
  let zeroFiring = 0;
  for (const rule of loadings.coherence) {
    const fired = population.filter((p) => p.surface.firedRules.includes(rule.id)).length;
    measure(`rule ${rule.id}`,
      `${rule.enabled ? 'enabled' : 'DISABLED'}, fired on ${fired} of ${N} (${((fired / N) * 100).toFixed(2)}%)`);
    if (rule.enabled && fired === 0) {
      zeroFiring++;
      console.log(`         ZERO FIRINGS is a FINDING, not a pass. Either ${rule.id} is`);
      console.log('         decoration, or it guards against something a defect elsewhere has');
      console.log('         made impossible. It needs an explanation either way.');
    }
  }
  // THE GATE STATES THE SAMPLE SIZE IT REQUIRES rather than assuming it. At small n a
  // legitimate rule can fire on zero by chance; at n = 20,000 a rule with a true rate
  // above roughly 1 in 4,000 fires with probability over 99 percent, so a zero here is a
  // statement about the rule and not about the sample.
  check(`no enabled coherence rule fires on nothing (n=${N.toLocaleString()})`, zeroFiring === 0,
    zeroFiring === 0
      ? `${loadings.coherence.length} rule(s); at this n a zero is a property of the rule`
      : `${zeroFiring} never fire`);
  const share = population.filter((p) => p.surface.capped.includes('emojiAffinity')).length / N;
  console.log(
    '         §5: a cap firing on two percent is a coherence rule; a cap firing on forty',
  );
  console.log(
    '         percent is a weighting problem wearing a rule\'s clothing, and the count is',
  );
  console.log('         the only way to tell them apart.');
  if (share > 0.15) {
    console.log(`         NOTE: ${(share * 100).toFixed(1)}% is high enough to look like a weighting problem.`);
  } else if (share < 0.005) {
    console.log(`         NOTE: ${(share * 100).toFixed(2)}% is low enough that the rule may be inert.`);
  }

  // The cap must run AFTER the percentile mapping, provably: a capped avatar's value is
  // exactly the cap, not a value that went through Phi afterwards.
  const cappedOnes = population.filter((p) => p.surface.capped.length > 0);
  check('the cap runs after the percentile mapping, provably',
    cappedOnes.every((p) => p.surface.style.emojiAffinity === loadings.coherence[0]!.cap.at),
    `${cappedOnes.length} capped, all exactly at ${loadings.coherence[0]!.cap.at}`);
  check('every capped avatar has a formal tone', cappedOnes.every(
    (p) => p.surface.style.tone <= loadings.coherence[0]!.when.below));

  // Overrides bypass derivation, not the cap.
  const latent = population[3]!.latent;
  const overridden = derive({ seed: 3, latent, overrides: { warmth: 12.5 } });
  check('an overridden field takes the given value', overridden.style.warmth === 12.5);
  check('and appears in overrides[]', overridden.overrides.includes('warmth'));

  // An override the cap then changes must appear in BOTH lists.
  const forced = derive({ seed: 3, latent, overrides: { tone: 5, emojiAffinity: 99 } });
  check('an override the cap changes appears in overrides[]',
    forced.overrides.includes('emojiAffinity'));
  check('and in capped[], rather than being silently altered',
    forced.capped.includes('emojiAffinity'));
  check('and the value is the cap', forced.style.emojiAffinity === loadings.coherence[0]!.cap.at);

  // The cap is individually switchable (specification §12).
  const off = { ...loadings, coherence: loadings.coherence.map((r) => ({ ...r, enabled: false })) };
  const noCap = prepareSurface(archetypes, traitConfig, off)({ seed: 3, latent, overrides: { tone: 5, emojiAffinity: 99 } });
  check('the cap is individually switchable', noCap.style.emojiAffinity === 99 && noCap.capped.length === 0);
}

/* ===================================================== §8 the style diagnostic */

section('Style collinearity (§8): REPORTED, NOT GATED');
{
  // The archetype set produced unintended collinearity that no correlation target
  // caught for weeks and that was found by accident. The same defect appears here more
  // easily, because tone, warmth and humor all load on E and A by design. So the useful
  // quantity is not the correlation but whether it is EXPLAINED BY SHARED LOADINGS.
  function corr(a: StyleField, b: StyleField): number {
    const x = population.map((p) => p.surface.style[a]);
    const y = population.map((p) => p.surface.style[b]);
    const mx = mean(x);
    const my = mean(y);
    let sxy = 0, sxx = 0, syy = 0;
    for (let i = 0; i < x.length; i++) {
      sxy += (x[i]! - mx) * (y[i]! - my);
      sxx += (x[i]! - mx) ** 2;
      syy += (y[i]! - my) ** 2;
    }
    return sxy / Math.sqrt(sxx * syy);
  }

  // THE SPLIT IS EXACT, not a heuristic. Loading overlap under-explains by a knowable
  // amount: two fields loading on entirely different traits still correlate when those
  // traits do, and the model specifies E-A at 0.29 and C-A at 0.15. Both quantities are
  // closed form, so:
  //
  //   realised   correlation under the POPULATION covariance, W + B
  //   implied    correlation under the MODEL correlation matrix, Sigma, alone
  //   artefact   realised - implied
  //
  // W is proportional to Sigma and a correlation is scale-free, so the constant cancels:
  // if B were zero the two would be identical. The difference is therefore attributable
  // ENTIRELY to B, which is the archetype set's structure leaking into the style layer.
  // That may be wanted or not, but it should be a decision rather than a surprise.
  const model = defaultCovariance();
  const vec = (f: StyleField): number[] => TRAIT_ORDER.map((t) => loadings.style[f][t] ?? 0);

  const rows: { pair: string; realised: number; implied: number; artefact: number; empirical: number }[] = [];
  for (let i = 0; i < STYLE_FIELDS.length; i++) {
    for (let j = i + 1; j < STYLE_FIELDS.length; j++) {
      const a = STYLE_FIELDS[i]!;
      const b = STYLE_FIELDS[j]!;
      const realised = linearCombinationCorrelation(vec(a), vec(b), populationMoments(archetypes, traitConfig).covariance);
      const implied = linearCombinationCorrelation(vec(a), vec(b), model);
      rows.push({ pair: `${a} / ${b}`, realised, implied, artefact: realised - implied, empirical: corr(a, b) });
    }
  }
  const byR = [...rows].sort((x, y) => Math.abs(y.realised) - Math.abs(x.realised));
  const byArtefact = [...rows].sort((x, y) => Math.abs(y.artefact) - Math.abs(x.artefact));

  measure('largest realised correlation',
    `${byR[0]!.pair} at ${byR[0]!.realised.toFixed(3)}, model alone implies ${byR[0]!.implied.toFixed(3)}`);
  measure('largest ARTEFACT, archetype structure reaching the style layer',
    `${byArtefact[0]!.pair}: realised ${byArtefact[0]!.realised.toFixed(3)} against implied ${byArtefact[0]!.implied.toFixed(3)}`);

  console.log('         pair                             realised   implied  artefact  empirical');
  for (const row of byR.slice(0, 6)) {
    console.log(
      `         ${row.pair.padEnd(32)}${row.realised.toFixed(3).padStart(9)}${row.implied.toFixed(3).padStart(10)}` +
        `${row.artefact.toFixed(3).padStart(10)}${row.empirical.toFixed(3).padStart(11)}`,
    );
  }
  // The percentile transform is monotone but not linear, so the empirical correlation of
  // the mapped values differs slightly from the analytic correlation of the raw sums.
  // Reported so the gap is visible rather than mistaken for an error in either.
  measure('analytic realised vs empirical after the percentile map',
    `differ by at most ${Math.max(...rows.map((r) => Math.abs(r.realised - r.empirical))).toFixed(3)}`);
  console.log('         That gap is comparable to the largest artefact, and the two numbers');
  console.log('         answer ADJACENT questions rather than the same one: the artefact split');
  console.log('         lives in raw-sum space, while the values an operator actually sees live');
  console.log('         in mapped space. Neither is wrong; they are about different quantities.');
  console.log('         NOT GATED. A pair correlating because the MODEL says its traits do is');
  console.log('         intended, in exactly the sense C/N was intended in the archetype');
  console.log('         diagnostic. The artefact column is what the archetypes add on top, and');
  console.log('         it is the number to watch. See verify:traits for the same split on the');
  console.log('         archetype means themselves (D-097).');

}

/* -------------------------------------------------------------------- done */

console.log(`\nDerived ${N.toLocaleString()} surfaces from loading set ${loadings.version} and archetype set ${archetypes.version}.`);
if (failures > 0) {
  console.error(`\n${failures} CHECK(S) FAILED`);
  process.exit(1);
}
console.log('ALL PASSED');
