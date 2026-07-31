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
  const cappedCount = population.filter((p) => p.surface.capped.includes('emojiAffinity')).length;
  const share = cappedCount / N;
  measure('avatars whose emojiAffinity the cap changed', `${cappedCount} of ${N} (${(share * 100).toFixed(2)}%)`);
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
    cappedOnes.every((p) => p.surface.style.emojiAffinity === loadings.coherence.emojiAffinityCap),
    `${cappedOnes.length} capped, all exactly at ${loadings.coherence.emojiAffinityCap}`);
  check('every capped avatar has a formal tone', cappedOnes.every(
    (p) => p.surface.style.tone <= loadings.coherence.formalToneBelow));

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
  check('and the value is the cap', forced.style.emojiAffinity === loadings.coherence.emojiAffinityCap);

  // The cap is individually switchable (specification §12).
  const off = { ...loadings, coherence: { ...loadings.coherence, enabled: false } };
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

  /** Cosine between two loading vectors: how much structure the weights SHARE. */
  function loadingOverlap(a: StyleField, b: StyleField): number {
    const va = TRAIT_ORDER.map((t) => loadings.style[a][t] ?? 0);
    const vb = TRAIT_ORDER.map((t) => loadings.style[b][t] ?? 0);
    let dot = 0, na = 0, nb = 0;
    for (let i = 0; i < va.length; i++) {
      dot += va[i]! * vb[i]!;
      na += va[i]! ** 2;
      nb += vb[i]! ** 2;
    }
    return dot / Math.sqrt(na * nb);
  }

  const rows: { pair: string; r: number; overlap: number; artefact: number }[] = [];
  for (let i = 0; i < STYLE_FIELDS.length; i++) {
    for (let j = i + 1; j < STYLE_FIELDS.length; j++) {
      const a = STYLE_FIELDS[i]!;
      const b = STYLE_FIELDS[j]!;
      const r = corr(a, b);
      const overlap = loadingOverlap(a, b);
      rows.push({ pair: `${a} / ${b}`, r, overlap, artefact: Math.abs(r) - Math.abs(overlap) });
    }
  }
  const byR = [...rows].sort((x, y) => Math.abs(y.r) - Math.abs(x.r));
  const byArtefact = [...rows].sort((x, y) => y.artefact - x.artefact);

  measure('largest style correlation', `${byR[0]!.pair} at ${byR[0]!.r.toFixed(3)} (loadings share ${byR[0]!.overlap.toFixed(3)})`);
  measure('largest UNEXPLAINED correlation', `${byArtefact[0]!.pair}: r ${byArtefact[0]!.r.toFixed(3)} against loading overlap ${byArtefact[0]!.overlap.toFixed(3)}`);

  console.log('         pair                                     r   loadings   unexplained');
  for (const row of byR.slice(0, 6)) {
    console.log(
      `         ${row.pair.padEnd(38)}${row.r.toFixed(3).padStart(6)}${row.overlap.toFixed(3).padStart(11)}${row.artefact.toFixed(3).padStart(14)}`,
    );
  }
  console.log(
    '         NOT GATED. tone, warmth and humor sharing a loading on extraversion is',
  );
  console.log(
    '         INTENDED and must not read as a defect. What would be the archetype problem',
  );
  console.log(
    '         on a new layer is two fields correlating strongly when their loadings share',
  );
  console.log(
    '         little, which is the "unexplained" column. See verify:traits for the same',
  );
  console.log('         diagnostic on the archetype means (D-097).');
}

/* -------------------------------------------------------------------- done */

console.log(`\nDerived ${N.toLocaleString()} surfaces from loading set ${loadings.version} and archetype set ${archetypes.version}.`);
if (failures > 0) {
  console.error(`\n${failures} CHECK(S) FAILED`);
  process.exit(1);
}
console.log('ALL PASSED');
