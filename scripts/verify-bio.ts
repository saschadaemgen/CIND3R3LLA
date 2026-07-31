/**
 * The bio generator, proven (CCB-S4-006 §10), and the §6 structural diagnostic.
 *
 *   npx tsx scripts/verify-bio.ts
 *
 * ── OWN HARNESS (briefing §12.3) ───────────────────────────────────────────
 *
 * §12.3 asks whether the structural diagnostic belongs with the style correlation
 * diagnostic from CCB-S4-005, since both are "an authored set acquired unintended
 * structure" checks. Separate, for the reason D-099 already settled: they gate different
 * versioned data files against different specifications, and folding them together means
 * editing `templates.json` can fail a harness about the style loadings. All three
 * harnesses cross-reference instead.
 *
 * ── GATES CORRECTNESS, REPORTS POPULATION SHAPE ────────────────────────────
 *
 * Determinism, the coherence rules, the language rule and the structural floor fail the
 * run. The population properties §10 lists are REPORTED AGAINST THEIR CONFIGURED TARGET,
 * because §3 and §4 ask for exactly that: the realised rate against the target, not an
 * assertion that they match.
 */

import {
  DEFAULT_ARCHETYPE_MIX,
  DEFAULT_SIGMA,
  DEFAULT_UNCLASSIFIED_SHARE,
  defaultCovariance,
  loadArchetypes,
  prepareTraitSampler,
} from '../src/generator/traits/index.js';
import { DEFAULT_POPULATION, loadLoadings, prepareSurface } from '../src/generator/surface/index.js';
import {
  DEFAULT_BIO_POPULATION,
  BIO_LENGTHS,
  generateBio,
  loadTemplates,
  parseTemplates,
  structuralSignature,
  type Personality,
  type TemplateSet,
} from '../src/generator/bio/index.js';

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
const templates = loadTemplates();
const traitConfig = {
  archetypeMix: DEFAULT_ARCHETYPE_MIX,
  unclassifiedShare: DEFAULT_UNCLASSIFIED_SHARE,
  sigma: DEFAULT_SIGMA,
  covariance: defaultCovariance(),
};
const sampler = prepareTraitSampler(traitConfig, archetypes);
const surface = prepareSurface(archetypes, traitConfig, loadings);

function personalityFor(seed: number): Personality {
  const latent = sampler.draw(seed).latent;
  const s = surface({ seed, latent });
  return { latent, style: s.style, identity: s.identity, rhythm: s.rhythm, content: s.content };
}

const N = 20_000;
const population = Array.from({ length: N }, (_, i) => {
  const personality = personalityFor(i);
  return { seed: i, personality, bio: generateBio(i, personality, templates, DEFAULT_BIO_POPULATION) };
});
const written = population.filter((p) => p.bio.text !== null);

/* ============================================================== versioning */

section('Versioning and loading');
{
  measure('template set', templates.version);
  measure('languages authored', Object.keys(templates.languages).join(', '));
  check('the template set is versioned', templates.version.length > 0);
  check('a set with no version is refused',
    /has no "version"/.test(threw(() => parseTemplates({ languages: {} }, 'fixture'))?.message ?? ''));
  check('a theme pool with only sentences is refused',
    /BOTH fragments and sentences/.test(
      threw(() => parseTemplates(
        { ...templates, languages: { en: { ...templates.languages.en!,
          themes: { ...templates.languages.en!.themes,
            minimal: { ...templates.languages.en!.themes.minimal, fragments: [] } } } } },
        'fixture')
      )?.message ?? ''));
  check('a language with fewer than two separators is refused',
    threw(() => parseTemplates(
      { ...templates, languages: { en: { ...templates.languages.en!, separators: [' '] } } }, 'fixture')) !== null);
}

/* ============================================================ §10 determinism */

section('Determinism (§10)');
{
  // A personality that actually writes: a `none` theme is empty at every seed by design,
  // so picking one at random would test nothing.
  const p = written[0]!.personality;
  const a = generateBio(4242, p, templates, DEFAULT_BIO_POPULATION);
  const b = generateBio(4242, p, templates, DEFAULT_BIO_POPULATION);
  check('identical personality and configuration produce identical text',
    JSON.stringify(a) === JSON.stringify(b));

  // A different seed must produce different text for the SAME personality. Sampled over
  // many seeds rather than one pair, since two seeds can legitimately collide.
  const texts = new Set<string>();
  let nonEmpty = 0;
  for (let s = 0; s < 400; s++) {
    const r = generateBio(s, p, templates, DEFAULT_BIO_POPULATION);
    if (r.text !== null) {
      texts.add(r.text);
      nonEmpty++;
    }
  }
  check('a different seed produces different text for the same personality',
    texts.size > nonEmpty * 0.5, `${texts.size} distinct of ${nonEmpty} written`);
}

/* ================================================ §3 the most important requirement */

section('The empty share (§3): REPORTED AGAINST TARGET');
{
  const emptyRate = (N - written.length) / N;
  // THE TARGET DEPENDS ON THE ENGINE, and this harness runs the template one. A fallback
  // that produces wrong text is worse than one that produces none, so the template path
  // deliberately runs above the realistic band: an empty bio is ordinary, a calqued
  // German fragment is a tell. The 60 to 75 band is what the MODEL path aims at, and
  // asserting it here would gate the fallback against a target it is designed to miss.
  const engineTarget = Math.max(DEFAULT_BIO_POPULATION.bioEmpty, DEFAULT_BIO_POPULATION.templateEmptyFloor);
  measure('realised empty rate', `${(emptyRate * 100).toFixed(1)}% against a target of ${(engineTarget * 100).toFixed(0)}% (template engine)`);
  console.log('         §3: research puts real platforms at 60 to 75 percent, higher on');
  console.log('         privacy-focused ones. A population where every profile carries a bio is');
  console.log('         detectable on sight, and this is the single property that most');
  console.log('         determines whether a member list reads as real. The model path aims');
  console.log('         at that band; this path stays above it on purpose.');
  check('the empty share tracks the target this engine aims at',
    Math.abs(emptyRate - engineTarget) <= 0.05,
    `${(emptyRate * 100).toFixed(1)}% against ${(engineTarget * 100).toFixed(0)}%`);

  // §3's table: the share must be skewed by tier and by conscientiousness, not flat.
  for (const tier of ['lurker', 'contributor', 'superuser'] as const) {
    const group = population.filter((p) => p.personality.rhythm.activityTier === tier);
    const rate = group.filter((p) => p.bio.text === null).length / group.length;
    measure(`  empty rate, ${tier}`, `${(rate * 100).toFixed(1)}% (n=${group.length})`);
  }
  const lurkerRate = (() => {
    const g = population.filter((p) => p.personality.rhythm.activityTier === 'lurker');
    return g.filter((p) => p.bio.text === null).length / g.length;
  })();
  const superRate = (() => {
    const g = population.filter((p) => p.personality.rhythm.activityTier === 'superuser');
    return g.filter((p) => p.bio.text === null).length / g.length;
  })();
  check('lurkers are overwhelmingly empty and superusers mostly are not',
    lurkerRate > superRate + 0.2, `${(lurkerRate * 100).toFixed(0)}% against ${(superRate * 100).toFixed(0)}%`);

  const highC = population.filter((p) => p.personality.latent.conscientiousness > 1);
  const lowC = population.filter((p) => p.personality.latent.conscientiousness < -1);
  const highCRate = highC.filter((p) => p.bio.text === null).length / highC.length;
  const lowCRate = lowC.filter((p) => p.bio.text === null).length / lowC.length;
  measure('  empty rate by conscientiousness',
    `${(highCRate * 100).toFixed(1)}% high-C against ${(lowCRate * 100).toFixed(1)}% low-C`);
  check('conscientious avatars fill their profile more', highCRate < lowCRate - 0.05);

  check('a none theme always produces null',
    population.filter((p) => p.personality.content.bioTheme === 'none').every((p) => p.bio.text === null));
}

/* ==================================================================== §4 length */

section('Length (§4): REPORTED AGAINST TARGET');
{
  console.log('         bucket    realised   target');
  for (const bucket of BIO_LENGTHS) {
    const share = population.filter((p) => p.bio.length === bucket).length / N;
    console.log(
      `         ${bucket.padEnd(10)}${(share * 100).toFixed(1).padStart(7)}%${(DEFAULT_BIO_POPULATION.bioLength[bucket] * 100).toFixed(1).padStart(9)}%`,
    );
  }
  const words = written.map((p) => p.bio.text!.trim().split(/\s+/u).filter(Boolean).length).sort((a, b) => a - b);
  const median = words[Math.floor(words.length / 2)]!;
  measure('word count of written bios', `median ${median}, p90 ${words[Math.floor(words.length * 0.9)]}, max ${words.at(-1)}`);
  check('the median written bio is short, a clause to a sentence', median <= 10, `${median} words`);
  check('there is a long tail rather than one length',
    words.at(-1)! > median * 3, `max ${words.at(-1)} against median ${median}`);
  check('not every bio is the same length', new Set(words).size > 8, `${new Set(words).size} distinct lengths`);
}

/* ================================================== §6 THE STRUCTURAL REQUIREMENT */

section('Structure (§6): the hard part');
{
  const counts = new Map<string, number>();
  for (const p of written) counts.set(p.bio.pattern, (counts.get(p.bio.pattern) ?? 0) + 1);
  const ranked = [...counts.entries()].sort((a, b) => b[1] - a[1]);
  const topShare = ranked[0]![1] / written.length;

  measure('distinct structural patterns', `${counts.size} across ${written.length.toLocaleString()} written bios`);
  measure('most common pattern', `${ranked[0]![0]} at ${(topShare * 100).toFixed(1)}%`);
  console.log('         top five patterns:');
  for (const [pattern, n] of ranked.slice(0, 5)) {
    console.log(`         ${pattern.padEnd(34)}${((n / written.length) * 100).toFixed(1).padStart(6)}%`);
  }

  // §6: "no single structural pattern exceeds a share that a reader would notice". A
  // reader scanning a member list notices a shape recurring every few entries; one in
  // eight is the point where that becomes hard to miss.
  check('no single structural pattern exceeds 12.5 percent of written bios',
    topShare < 0.125, `${(topShare * 100).toFixed(1)}%`);

  // The signature is derived, not a template id (§12.1), so it must be able to see two
  // DIFFERENT texts converging on one shape. Proven directly.
  const shapeA = structuralSignature('photography, cycling', 0);
  const shapeB = structuralSignature('chess, baking', 0);
  check('two different texts with the same shape share a signature',
    shapeA === shapeB, `${shapeA}`);
  check('and a different shape does not',
    structuralSignature('I work in ops.', 0) !== shapeA);

  // §6 requires variety from MORE THAN ONE mechanism. Each must actually vary.
  const endings = new Set(written.map((p) => (/[.!?]$/u.test(p.bio.text!) ? 'stop' : 'none')));
  const caps = new Set(written.map((p) => (p.bio.text! === p.bio.text!.toLowerCase() ? 'lower' : 'mixed')));
  const clauseCounts = new Set(written.map((p) => p.bio.pattern.split('|')[0]));
  const fragOrSent = new Set(written.map((p) => p.bio.pattern.split('|')[1]));
  measure('mechanisms actually varying',
    `clause counts ${clauseCounts.size}, fragment/sentence ${fragOrSent.size}, ` +
      `capitalisation ${caps.size}, terminal punctuation ${endings.size}`);
  check('at least four mechanisms vary, not just the skeleton',
    clauseCounts.size > 1 && fragOrSent.size > 1 && caps.size > 1 && endings.size > 1);
}

/* ================================================================== §7 language */

section('Language (§7)');
{
  const byLang = new Map<string, number>();
  for (const p of population) byLang.set(p.bio.language, (byLang.get(p.bio.language) ?? 0) + 1);
  measure('language distribution',
    [...byLang.entries()].map(([l, n]) => `${l} ${((n / N) * 100).toFixed(1)}%`).join(', '));

  const originShare = new Map<string, number>();
  for (const p of population) {
    const primary = Object.entries(p.personality.identity.originBlend).sort((a, b) => b[1] - a[1])[0]![0];
    originShare.set(primary, (originShare.get(primary) ?? 0) + 1);
  }
  measure('origin distribution',
    [...originShare.entries()].sort((a, b) => b[1] - a[1]).map(([o, n]) => `${o} ${((n / N) * 100).toFixed(1)}%`).join(', '));

  // German origins must actually write German. This is the §7 requirement.
  const german = population.filter((p) =>
    Object.entries(p.personality.identity.originBlend).sort((a, b) => b[1] - a[1])[0]![0] === 'de');
  check('German origins write German, not a global default',
    german.length > 0 && german.every((p) => p.bio.language === 'de'), `n=${german.length}`);
  check('bios are not uniformly one language', byLang.size > 1, `${byLang.size} languages in use`);

  const fellBack = population.filter((p) => p.bio.fellBack).length;
  measure('origins with no authored template set', `${((fellBack / N) * 100).toFixed(1)}% fell back to ${templates.fallbackLanguage}`);
  console.log('         REPORTED AS A GAP, not absorbed. §7 accepts one language for a first');
  console.log('         build if the mechanism for adding more is in place; two are authored and');
  console.log('         the mechanism is the originLanguages map. Every origin still falling back');
  console.log('         is a language somebody has to write, and the number is what says how many.');

  // NEITHER OF THESE WAS CAUGHT BY A NUMBER. The population statistics all passed while
  // the text read "in 2019.. i am legally required" and "arbeite an cooking". They are
  // gated now because reading the output is what found them and reading it again is not
  // something a future change can be relied on to do.
  const punctuationDefects = written.filter((p) => /[.!?]{2,}|[.!?]\s*[,;|]|,\s*$/u.test(p.bio.text!));
  check('no bio doubles its terminal punctuation or follows a stop with a separator',
    punctuationDefects.length === 0,
    punctuationDefects.length === 0 ? `${written.length.toLocaleString()} checked`
      : `${punctuationDefects.length}, e.g. ${JSON.stringify(punctuationDefects[0]!.bio.text)}`);

  const interestKeys = Object.keys(templates.languages.de!.interestLabels);
  const untranslated = written.filter(
    (p) => p.bio.language === 'de' &&
      interestKeys.some((k) => new RegExp(`\b${k}\b`, 'u').test(p.bio.text!)),
  );
  check('German bios name interests in German, not in English',
    untranslated.length === 0,
    untranslated.length === 0 ? 'checked against every interest key'
      : `${untranslated.length}, e.g. ${JSON.stringify(untranslated[0]!.bio.text)}`);

  // §7 explicitly withdrew the non-native register. Nothing may simulate broken speech.
  // Scan the TEMPLATES, not the file's own documentation: the README says "NO SIMULATED
  // NON-NATIVE SPEECH" and an unstripped scan trips on the sentence forbidding the thing.
  // Same shape as verify:no-dashes stripping comments before checking source.
  const { _README: _ignored, ...templateBody } = templates as TemplateSet & { _README?: unknown };
  const source = JSON.stringify(templateBody);
  check('no template simulates non-native speech',
    !/nonNative|non-native/iu.test(source),
    'the register was withdrawn because it drifts into caricature and has no support');
}

/* ================================================================ §10 coherence */

section('Coherence (§10)');
{
  const highEmoji = written.filter((p) => p.personality.style.emojiAffinity > 70);
  const lowEmoji = written.filter((p) => p.personality.style.emojiAffinity < 30);
  const highRate = highEmoji.reduce((s, p) => s + p.bio.emojiCount, 0) / Math.max(1, highEmoji.length);
  const lowRate = lowEmoji.reduce((s, p) => s + p.bio.emojiCount, 0) / Math.max(1, lowEmoji.length);
  measure('emoji per bio', `${highRate.toFixed(2)} at high affinity, ${lowRate.toFixed(2)} at low`);
  check('high emojiAffinity produces measurably more emoji', highRate > lowRate + 0.1);

  const overall = written.reduce((s, p) => s + p.bio.emojiCount, 0) / written.length;
  measure('emoji across all written bios', `${overall.toFixed(2)} per bio`);
  check('most bios in most populations contain none (§8)',
    written.filter((p) => p.bio.emojiCount === 0).length / written.length > 0.6);

  const highV = written.filter((p) => p.personality.style.verbosity > 70);
  const lowV = written.filter((p) => p.personality.style.verbosity < 30);
  const wc = (g: typeof written): number =>
    g.reduce((s, p) => s + p.bio.text!.trim().split(/\s+/u).filter(Boolean).length, 0) / Math.max(1, g.length);
  measure('words per bio', `${wc(highV).toFixed(1)} at high verbosity, ${wc(lowV).toFixed(1)} at low`);
  check('high verbosity produces measurably longer bios', wc(highV) > wc(lowV) + 1);

  // §5: theme decides WHAT, style decides HOW. Two avatars differing only in tone must
  // produce visibly different text from the same theme and interests.
  const base = population.find((p) => p.personality.content.bioTheme === 'professional')!.personality;
  const formal: Personality = { ...base, style: { ...base.style, tone: 5, sentenceComplexity: 90 } };
  const casual: Personality = { ...base, style: { ...base.style, tone: 95, sentenceComplexity: 10 } };
  let differing = 0;
  for (let s = 500; s < 700; s++) {
    const f = generateBio(s, formal, templates, DEFAULT_BIO_POPULATION);
    const c = generateBio(s, casual, templates, DEFAULT_BIO_POPULATION);
    if (f.text !== null && c.text !== null && f.text !== c.text) differing++;
  }
  check('two avatars differing only in tone write visibly differently',
    differing > 20, `${differing} of 200 seeds produced different text from the same theme`);
}

/* ================================= the defects a read found, now gated (§11) */

section('The ten defect classes: REGRESSION GATES');
{
  // A READ OF TWO HUNDRED PROFILES FOUND ALL OF THESE AND EVERY CHECK ABOVE PASSED.
  // 279 distinct structural patterns, most common at 4.6 percent, six varying mechanisms,
  // all green, while the text said "ask me about synthesizers, trying to get better at
  // synthesizers, i came for synthesizers and stayed for the arguments".
  //
  // The measure above counts STRUCTURAL variety. Every defect below is SEMANTIC. A pool
  // of meaningless clauses combined by six mechanisms produces excellent structural
  // variety and unreadable text, so these are gated separately and by name.

  // §1: clauses draw from a shared slot pool. The single most visible defect, at roughly
  // one bio in eight. Nobody writes their own hobby three times in one line.
  const labelsFor = (lang: string): Record<string, string> =>
    templates.languages[lang]?.interestLabels ?? {};
  let repeated = 0;
  let worst = '';
  for (const p of written) {
    const labels = labelsFor(p.bio.language);
    const lower = p.bio.text!.toLocaleLowerCase();
    for (const key of DEFAULT_POPULATION.interestPool) {
      const label = (labels[key] ?? key).toLocaleLowerCase();
      let from = 0;
      let hits = 0;
      for (;;) {
        const at = lower.indexOf(label, from);
        if (at < 0) break;
        hits++;
        from = at + label.length;
      }
      if (hits > 1) {
        repeated++;
        if (worst === '') worst = p.bio.text!;
        break;
      }
    }
  }
  check('§1 no bio names the same interest twice', repeated === 0,
    repeated === 0 ? `${written.length} bios` : `${repeated} do, e.g. "${worst}"`);

  // §3 and §8: the German set is authored in German. A regression list rather than a
  // pattern, because "ue" is legitimate in German ("neue", "Steuer") and a pattern would
  // either miss the fault or fire on correct words.
  const germanSource = JSON.stringify(templates.languages.de);
  const asciiStandIns = ['Ueber', 'fuer', 'vernuenftig', 'gaertnern', 'Gaertnern', 'hauptsaechlich',
    'Grossteil', 'erwaehnen', 'spaeter', 'hoere', 'Buchbinden-Verteidiger', 'Arbeite an'];
  const found = asciiStandIns.filter((w) => germanSource.includes(w));
  check('§3 the German set spells German rather than substituting ASCII', found.length === 0, found.join(', '));
  check('§3 and it actually contains umlauts', /[äöüßÄÖÜ]/u.test(germanSource));

  // §4: the lower-case habit is an English habit, and it was applied to German unchanged.
  const germanBios = written.filter((p) => p.bio.language === 'de');
  const lowercased = germanBios.filter((p) => p.bio.text! === p.bio.text!.toLocaleLowerCase());
  check('§4 no German bio is lower-cased', lowercased.length === 0,
    lowercased.length === 0
      ? `${germanBios.length} German bios`
      : `${lowercased.length} are, e.g. "${lowercased[0]!.bio.text}"`);

  // §5: the standing rule (CCB-S3-021), which was already binding when an em-dash was
  // authored into the separator pool. verify:no-dashes now covers this tree too; the
  // check is repeated here so a bio defect fails the bio harness.
  const dashed = written.filter((p) => /[—–―·]/u.test(p.bio.text!));
  check('§5 no forbidden dash and no middle dot', dashed.length === 0,
    dashed.length === 0 ? '' : `e.g. "${dashed[0]!.bio.text}"`);

  // §7: a bio says who someone is. Roughly one written bio in six said nothing at all,
  // and not in the way a terse real bio says little.
  const notSelfDescriptions = ['Zurzeit keine Fragen', 'Das war es', 'You will work it out',
    'Ask later', 'spaeter fragen', 'Not much to say', 'Hello.', 'Hallo.', 'orbit', 'null', 'echo',
    'static', 'drift', 'signal only', 'in transit'];
  const poolSource = JSON.stringify(templates.languages);
  const survivors = notSelfDescriptions.filter((w) => poolSource.includes(w));
  check('§7 no clause is a greeting, a reply or a meaningless fragment',
    survivors.length === 0, survivors.join(', '));

  // §2: `lurker` in "my lurker opinions are load-bearing" read like an activityTier enum
  // leaking into text. It was not: it was an authored noun that happened to collide with
  // the enum name. Nothing substitutes runtime values into a bio, and this proves it
  // rather than asserting it, because the reasoning that it "cannot happen" is exactly
  // what a leak would survive.
  const runtimeValues = ['lurker', 'contributor', 'superuser', 'professional', 'cryptic',
    'minimal', 'quirky', 'personal'];
  const leaked = written.filter((p) => {
    const lower = p.bio.text!.toLocaleLowerCase();
    return runtimeValues.some((v) => new RegExp(`\b${v}\b`, 'u').test(lower));
  });
  check('§2 no internal enum value appears in any bio', leaked.length === 0,
    leaked.length === 0 ? `${written.length} bios checked against ${runtimeValues.length} enum values` : `e.g. "${leaked[0]!.bio.text}"`);
}

/* -------------------------------------------------------------------- done */

console.log(`\nGenerated ${N.toLocaleString()} bios from template set ${templates.version}.`);
console.log('See verify:surface for the style diagnostic and verify:traits for the archetype one.');
if (failures > 0) {
  console.error(`\n${failures} CHECK(S) FAILED`);
  process.exit(1);
}
console.log('ALL PASSED');
