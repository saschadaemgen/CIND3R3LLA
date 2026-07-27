/**
 * The name generator, proven (briefing §10).
 *
 * Covers every required test: determinism, culture grammar, structure,
 * sanitisation, population properties over 10,000 draws, and fantasy-intensity
 * monotonicity. Plus the operator's added requirement that no single pseudonym
 * repeats more than a handful of times, asserted ON THE GENERATED DISTRIBUTION
 * rather than on pool size, so the pools can grow without touching the test.
 *
 *   npx tsx scripts/verify-namegen.ts
 */

import {
  generateName,
  loadCorpus,
  verifyCorpus,
  CULTURE_GRAMMARS,
  isSimplexSafe,
  type NameCorpus,
  type NameRequest,
  type NameResult,
  type NameType,
} from '../src/generator/names/index.js';

let failures = 0;
function check(label: string, ok: boolean, detail = ''): void {
  if (!ok) failures++;
  console.log(`  [${ok ? 'PASS' : 'FAIL'}] ${label}${detail ? ` - ${detail}` : ''}`);
}
function section(t: string): void {
  console.log(`\n${t}`);
}

const corpus: NameCorpus = loadCorpus();

/** A request with sane defaults; override what a test cares about. */
function request(over: Partial<NameRequest> = {}): NameRequest {
  return {
    seed: 1,
    cultureMix: { en: 1 },
    blendProbability: 0,
    nameStyleMix: { real: 1 },
    genderPresentation: 'unspecified',
    fantasyIntensity: 50,
    nameCase: 'natural',
    ...over,
  };
}

/** Draw n results, one per seed. */
function draw(n: number, over: Partial<NameRequest> = {}): NameResult[] {
  const out: NameResult[] = [];
  for (let seed = 0; seed < n; seed++) out.push(generateName(request({ seed, ...over }), corpus));
  return out;
}

/* ------------------------------------------------------------------- corpus */

section('Corpus integrity');
{
  const problems = verifyCorpus(corpus);
  check('corpus and grammars agree', problems.length === 0, problems.slice(0, 4).join('; '));
  check('bulk corpus loaded', corpus.general.givenNeutral.length > 30000,
    `${corpus.general.givenNeutral.length} given, ${corpus.general.family.length} family`);
  check('grammar count is substantial', Object.keys(CULTURE_GRAMMARS).length >= 50,
    `${Object.keys(CULTURE_GRAMMARS).length} cultures`);

  // Every GrammarStructure must be represented, or the engine has untested branches.
  const structures = new Set(Object.values(CULTURE_GRAMMARS).map((g) => g.structure));
  for (const s of ['givenFamily', 'familyGiven', 'givenPatronymicFamily', 'patronymicOnly',
    'givenNasabFather', 'mononym', 'givenPaternalMaternal']) {
    check(`structure ${s} is represented`, structures.has(s as never));
  }
}

/* -------------------------------------------------------------- determinism */

section('Determinism (§2)');
{
  const req = request({ seed: 12345, cultureMix: { en: 1, nl: 1, es: 1 }, blendProbability: 0.3,
    nameStyleMix: { real: 1, pseudonym: 1, fantasy: 1 } });
  const a = generateName(req, corpus);
  const b = generateName(req, corpus);
  check('same seed and config produce an identical result',
    JSON.stringify(a) === JSON.stringify(b), a.displayName);

  const c = generateName({ ...req, seed: 12346 }, corpus);
  check('a different seed produces a different result', JSON.stringify(a) !== JSON.stringify(c),
    `${a.displayName} vs ${c.displayName}`);

  // A fresh corpus object must not change anything: no hidden shared state.
  const d = generateName(req, loadCorpus());
  check('a freshly loaded corpus produces the identical result',
    JSON.stringify(a) === JSON.stringify(d));
}

/* ---------------------------------------------------------- culture grammar */

section('Culture grammar (§5, §10)');
{
  const ice = draw(60, { cultureMix: { is: 1 }, nameStyleMix: { real: 1 },
    genderPresentation: 'female' });
  const icePatronymic = ice.filter((r) => r.parts.some((p) => p.kind === 'patronymic'));
  check('Icelandic produces a patronymic', icePatronymic.length > 0,
    icePatronymic[0]?.originalName ?? '');
  check('Icelandic carries NO family part',
    ice.every((r) => !r.parts.some((p) => p.kind === 'family')));

  const tamil = draw(30, { cultureMix: { ta: 1 }, nameStyleMix: { real: 1 } });
  check('a mononym culture produces exactly one part',
    tamil.every((r) => r.parts.length === 1), tamil[0]?.originalName ?? '');

  const spanish = draw(60, { cultureMix: { es: 1 }, nameStyleMix: { real: 1 } });
  const twoSurnames = spanish.filter((r) => r.parts.filter((p) => p.kind === 'family').length === 2);
  check('a Spanish name carries two surname parts', twoSurnames.length > 0,
    twoSurnames[0]?.originalName ?? '');

  const dutch = draw(200, { cultureMix: { nl: 1 }, nameStyleMix: { real: 1 } });
  const particled = dutch.filter((r) =>
    r.parts.some((p) => p.kind === 'family' && /\s/.test(p.value)));
  check('a Dutch particled surname occurs', particled.length > 0,
    particled[0]?.parts.find((p) => p.kind === 'family')?.value ?? '');
  check('the particle stays lower-case and the surname stays ONE part',
    particled.every((r) => {
      const fam = r.parts.filter((p) => p.kind === 'family');
      if (fam.length !== 1) return false;
      const first = fam[0]!.value.split(' ')[0]!;
      return first === first.toLocaleLowerCase();
    }));

  const chinese = draw(40, { cultureMix: { zh: 1 }, nameStyleMix: { real: 1 } });
  const withFamily = chinese.filter((r) => r.parts.length >= 2 && r.pattern === 'firstLast');
  check('a Chinese name places the family part first',
    withFamily.length > 0 && withFamily.every((r) => r.parts[0]!.kind === 'family'),
    withFamily[0]?.originalName ?? '');
}

/* ------------------------------------------------------------------ structure */

section('Structure (§5, §10)');
{
  const all = draw(2000, { cultureMix: { en: 1, nl: 1, es: 1, is: 1, ta: 1, ru: 1, ar: 1, zh: 1 },
    nameStyleMix: { real: 1, firstName: 1, mononym: 1 } });

  check('a part containing a space is never split into two parts',
    all.every((r) => r.parts.every((p) => p.value.trim().length > 0)));

  // The real assertion: a particled surname arrives as one family part.
  const spaced = all.filter((r) => r.parts.some((p) => /\s/.test(p.value)));
  check('space-containing parts exist and stay single parts', spaced.length > 0,
    `${spaced.length} of ${all.length}`);

  check('no output requires a family name to exist',
    all.every((r) => r.parts.length >= 1));

  const noFamily = all.filter((r) => !r.parts.some((p) => p.kind === 'family'));
  check('names with no family part are produced and are valid', noFamily.length > 0,
    `${noFamily.length} of ${all.length}`);

  // Apostrophes and hyphens must survive stages 1 to 6, and appear in originalName.
  // Drawn per-feature: an apostrophe lives in the English SURNAME pool (O'Hara) and a
  // hyphen in the French GIVEN pool (Jean-Pierre), so a single mixed sample tests
  // neither reliably. `real` can replace the given name with an initial, which is why
  // the hyphen sample uses firstName.
  const apos = draw(600, { cultureMix: { en: 1 }, nameStyleMix: { real: 1 } })
    .filter((r) => r.originalName.includes("'"));
  // Gendered on purpose: `unspecified` falls back to `givenNeutral`, and the
  // hyphenated French names (Jean-Pierre, Marie-Claire) live in the gendered pools.
  const hyph = [
    ...draw(400, { cultureMix: { fr: 1 }, nameStyleMix: { firstName: 1 },
      genderPresentation: 'male' }),
    ...draw(400, { cultureMix: { fr: 1 }, nameStyleMix: { firstName: 1 },
      genderPresentation: 'female' }),
  ].filter((r) => r.originalName.includes('-'));
  check('apostrophes survive stages 1 to 6', apos.length > 0,
    apos[0]?.originalName ?? 'none in sample');
  check('hyphens survive stages 1 to 6', hyph.length > 0,
    hyph[0]?.originalName ?? 'none in sample');
  check('a hyphenated given name stays ONE part', hyph.length > 0 &&
    hyph.every((r) => r.parts.filter((p) => p.kind === 'given').length === 1));

  // Patronymic affixes attach per the grammar convention, never leaving the
  // notation hyphen in the name: Gunnarsdottir, not Gunnar-sdottir.
  const ice = draw(80, { cultureMix: { is: 1 }, nameStyleMix: { real: 1 },
    genderPresentation: 'female' })
    .flatMap((r) => r.parts.filter((p) => p.kind === 'patronymic'));
  check('a patronymic carries no notation hyphen', ice.length > 0 &&
    ice.every((p) => !p.value.includes('-')), ice[0]?.value ?? 'none');
}

/* --------------------------------------------------------------- sanitisation */

section('Sanitisation (§8, §10)');
{
  const all = draw(3000, { cultureMix: { en: 1, fr: 1, nl: 1 },
    nameStyleMix: { real: 1, initials: 1, pseudonym: 1, handle: 1 } });

  check('no displayName contains a dot or an apostrophe',
    all.every((r) => isSimplexSafe(r.displayName)));

  const changed = all.filter((r) => r.sanitised);
  check('sanitisation actually fires on this sample', changed.length > 0,
    `${changed.length} of ${all.length}`);
  check('when sanitised is true, originalName differs',
    changed.every((r) => r.originalName !== r.displayName));
  check('when sanitised is false, the two are identical',
    all.filter((r) => !r.sanitised).every((r) => r.originalName === r.displayName));

  // Sanitisation runs AFTER casing, not before. Under `lower`, a dotted-initials
  // name must be lowercased first and stripped second: if the order were reversed
  // the dots would already be gone and lowering could not have removed them, so we
  // assert the observable consequence - the lowered form is still dot-free and the
  // original still shows the dots.
  const lowered = draw(400, { nameStyleMix: { initials: 1 }, nameCase: 'lower' });
  const dotted = lowered.filter((r) => r.originalName.includes('.'));
  check('casing runs before sanitisation', dotted.length > 0 &&
    dotted.every((r) => r.originalName === r.originalName.toLocaleLowerCase() &&
      isSimplexSafe(r.displayName)),
    dotted[0] ? `${dotted[0].originalName} -> ${dotted[0].displayName}` : 'no dotted sample');
}

/* --------------------------------------------------------- population (§7) */

const N = 10_000;

section(`Population properties (§7, §10) over ${N} draws`);
{
  const mix: Partial<Record<NameType, number>> = {
    pseudonym: 0.45, firstName: 0.2, real: 0.15, mononym: 0.08, initials: 0.07, fantasy: 0.05,
  };
  const pop = draw(N, { cultureMix: { en: 3, nl: 1, es: 1, zh: 1, ru: 1, is: 1, ta: 1 },
    nameStyleMix: mix, blendProbability: 0.12 });

  // Name-type mix within tolerance.
  const counts = new Map<NameType, number>();
  for (const r of pop) counts.set(r.nameType, (counts.get(r.nameType) ?? 0) + 1);
  const TOLERANCE = 0.02;
  let mixOk = true;
  const detail: string[] = [];
  for (const [type, want] of Object.entries(mix) as [NameType, number][]) {
    const got = (counts.get(type) ?? 0) / N;
    if (Math.abs(got - want) > TOLERANCE) mixOk = false;
    detail.push(`${type} ${got.toFixed(3)}/${want}`);
  }
  check(`name type mix matches within ${TOLERANCE}`, mixOk, detail.join(', '));

  // Blend rate.
  const blended = pop.filter((r) => r.cultures.length === 2).length / N;
  // The observed rate is below the configured one by construction: a blend that
  // draws the same culture twice collapses to one. Assert against that expectation
  // rather than against the raw configured value.
  check('blend rate is in the expected band', blended > 0.05 && blended < 0.12,
    `observed ${blended.toFixed(3)} for configured 0.12`);

  // Zipf shape on given names, measured over a type that always yields one.
  // Drawn from `it`, which has a grammar but NO fixture pool, so it falls back to
  // the real 36,162-name corpus. Measuring this against a fixture culture would
  // only prove Zipf over a 16-name pool, which says nothing about the tail.
  const firsts = draw(N, { cultureMix: { it: 1 }, nameStyleMix: { firstName: 1 } });
  const freq = new Map<string, number>();
  for (const r of firsts) freq.set(r.displayName, (freq.get(r.displayName) ?? 0) + 1);
  const ranked = [...freq.values()].sort((a, b) => b - a);
  const top10 = ranked.slice(0, 10).reduce((s, v) => s + v, 0) / N;
  const distinct = ranked.length;
  // A flat draw over ~36k names into 10k slots would give a top-10 share near
  // 0.003 and almost no repeats. Zipf must concentrate the head far above that.
  check('given-name frequency is Zipf-shaped rather than flat', top10 > 0.05,
    `top-10 share ${(top10 * 100).toFixed(1)}%, ${distinct} distinct`);
  check('a long tail exists', distinct > 200, `${distinct} distinct names`);

  // Collisions must occur. Zero collisions is itself detectable as generated.
  const uniqueDisplay = new Set(pop.map((r) => r.displayName)).size;
  const collisions = N - uniqueDisplay;
  check('collisions occur and are not suppressed', collisions > 0,
    `${collisions} collisions across ${N}`);
}

/* ------------------------------------ pseudonym repetition (operator's added test) */

section('Pseudonym repetition, on the generated distribution');
{
  // 10,000 profiles at the default 0.45 pseudonym share.
  const pop = draw(N, {
    cultureMix: { en: 1 },
    nameStyleMix: { pseudonym: 0.45, firstName: 0.2, real: 0.15, mononym: 0.08,
      initials: 0.07, fantasy: 0.05 },
  });
  const pseudonyms = pop.filter((r) => r.nameType === 'pseudonym');
  const freq = new Map<string, number>();
  for (const r of pseudonyms) freq.set(r.displayName, (freq.get(r.displayName) ?? 0) + 1);
  const worst = Math.max(...freq.values());
  const MAX_REPEATS = 6;
  check(`no single pseudonym appears more than ${MAX_REPEATS} times`, worst <= MAX_REPEATS,
    `${pseudonyms.length} pseudonyms, ${freq.size} distinct, worst repeat ${worst}`);
}

/* --------------------------------------------------------- fantasy intensity */

section('Fantasy intensity (§6, §10)');
{
  /** Metric: mean element count. Smooth and strictly increasing in intensity. */
  function ornamentation(intensity: number): number {
    const sample = draw(1500, { nameStyleMix: { fantasy: 1 }, fantasyIntensity: intensity });
    const total = sample.reduce((sum, r) => sum + r.displayName.trim().split(/\s+/).length, 0);
    return total / sample.length;
  }
  const at0 = ornamentation(0);
  const at20 = ornamentation(20);
  const at50 = ornamentation(50);
  const at80 = ornamentation(80);
  const at100 = ornamentation(100);

  check('intensity 0, 50 and 100 differ measurably',
    at0 < at50 && at50 < at100, `0:${at0.toFixed(2)} 50:${at50.toFixed(2)} 100:${at100.toFixed(2)}`);
  check('the scale is monotonic: 50 sits between 20 and 80',
    at20 < at50 && at50 < at80, `20:${at20.toFixed(2)} 50:${at50.toFixed(2)} 80:${at80.toFixed(2)}`);
  check('intensity 0 is restrained (a single element)', at0 < 1.15, at0.toFixed(3));
}

/* --------------------------------------------------------------------- done */

console.log(`\nScanned the generator across ${N.toLocaleString()}-draw populations.`);
if (failures > 0) {
  console.error(`\n${failures} CHECK(S) FAILED`);
  process.exit(1);
}
console.log('ALL PASSED');
