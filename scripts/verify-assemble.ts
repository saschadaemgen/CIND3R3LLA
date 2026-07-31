/**
 * Profile assembly and review, proven (CCB-S4-007 §7).
 *
 *   npx tsx scripts/verify-assemble.ts
 *
 * This harness cannot check the thing the component is FOR. §3.2's crowd view answers
 * "does this look real", and that question is answered by a person reading it. What is
 * checked here is that the reading is possible and reproducible: that the views are
 * deterministic, that every profile carries the seed that reproduces it alone, that the
 * HTML is self-contained, and that a review names what it reviewed.
 *
 * One measurement is REPORTED rather than gated, and it is the finding the crowd view
 * produced on its first run: how often a name matches the culture it was drawn for.
 */

import {
  DEFAULT_ASSEMBLE_CONFIG,
  assemblePopulation,
  componentVersions,
  loadComponents,
  prepareAssembler,
  renderCrowd,
  renderDetail,
  renderDistribution,
  renderReview,
} from '../src/generator/assemble/index.js';

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

const components = loadComponents();
const assembler = prepareAssembler(components, DEFAULT_ASSEMBLE_CONFIG);
const SEED = 42;
const COUNT = 200;
const profiles = assemblePopulation(assembler, COUNT, SEED);

/* ============================================================== determinism */

section('Determinism (§4, §7)');
{
  const again = assemblePopulation(prepareAssembler(loadComponents(), DEFAULT_ASSEMBLE_CONFIG), COUNT, SEED);
  check('the same seed and configuration produce an identical population',
    JSON.stringify(profiles) === JSON.stringify(again));

  const detailA = renderDetail(profiles.slice(0, 6));
  const detailB = renderDetail(again.slice(0, 6));
  const crowdA = renderCrowd(profiles, SEED);
  const crowdB = renderCrowd(again, SEED);
  const distA = renderDistribution(profiles, components, SEED);
  const distB = renderDistribution(again, components, SEED);
  check('identical output across all three views',
    detailA === detailB && crowdA === crowdB && distA === distB);

  // §4: a profile that looks wrong must be reproducible in isolation, without
  // regenerating the population around it. That is the difference between "something is
  // off in this run" and a bug report.
  const isolated = prepareAssembler(components, DEFAULT_ASSEMBLE_CONFIG);
  let mismatches = 0;
  for (const p of [profiles[0]!, profiles[57]!, profiles[113]!, profiles.at(-1)!]) {
    if (JSON.stringify(isolated(p.seed)) !== JSON.stringify(p)) mismatches++;
  }
  check('a profile regenerated from its own seed alone matches the one in the population',
    mismatches === 0, `${mismatches} of 4 differed`);
}

/* ============================================================ seeds in views */

section('Every profile shows its own seed (§4)');
{
  const detail = renderDetail(profiles.slice(0, 6));
  const crowd = renderCrowd(profiles, SEED);
  const missingDetail = profiles.slice(0, 6).filter((p) => !detail.includes(`seed ${p.seed}`));
  check('the detail view carries every seed it renders', missingDetail.length === 0);

  const missingCrowd = profiles.filter((p) => !new RegExp(`>${p.seed}</div>`).test(crowd));
  check('the crowd view carries every seed it renders', missingCrowd.length === 0,
    `${missingCrowd.length} of ${COUNT} missing`);

  const dist = renderDistribution(profiles, components, SEED);
  check('the distribution view names the population seed', dist.includes(`Population seed ${SEED}`));
}

/* ================================================================ crowd view */

section('The crowd view is self-contained (§7)');
{
  const crowd = renderCrowd(profiles, SEED);
  // No external references of any kind: no src, no href, no url(), no import.
  const external = /<script|src\s*=|href\s*=|url\(|@import|<img/i.exec(crowd);
  check('no external references at all', external === null, external?.[0] ?? '');
  check('it is a complete HTML document',
    crowd.startsWith('<!doctype html>') && crowd.trim().endsWith('</html>'));
  check('it renders every profile', (crowd.match(/class="m"/g) ?? []).length === COUNT);

  // A member list, not a table of fields. The distinction is the requirement: a table
  // shows the same characters and conceals the same faults, because a table is read as
  // data and a member list is read as people.
  check('it is a list, not a table', !/<table|<td|<th\b/i.test(crowd));

  // Bio text is escaped rather than injected. A generated bio is untrusted text.
  const withAngle = profiles.find((p) => p.bio.text?.includes('<'));
  check('bio text is HTML-escaped', withAngle === undefined || crowd.includes('&lt;'),
    withAngle === undefined ? 'no bio in this population contains an angle bracket' : 'escaped');
}

/* ========================================================= distribution view */

section('The distribution view carries its caveat (§3.3, §7)');
{
  const dist = renderDistribution(profiles, components, SEED);
  check('the caveat is present', dist.includes('READ THE CAVEAT FIRST'));
  // At the TOP, because §3.3 is explicit that this is the view that would have passed
  // while the text was wrong.
  check('and it appears before any statistic',
    dist.indexOf('READ THE CAVEAT FIRST') < dist.indexOf('Archetype'));
  check('it says a green distribution view is not a verdict',
    dist.includes('is not a verdict'));
  check('it names all four component data set versions',
    Object.values(componentVersions(components)).every((v) => dist.includes(v)));
  check('it says the numbers were re-derived from this population',
    dist.includes('Re-derived from this population'));
}

/* ==================================================================== review */

section('The review record (§5, §7)');
{
  const versions = componentVersions(components);
  const { markdown, missing } = renderReview({
    seed: SEED, count: COUNT, readSeeds: [42, 57, 99], versions, configVersion: 'test',
  });
  check('no component data set is missing a version', missing.length === 0,
    missing.length === 0 ? Object.keys(versions).join(', ') : missing.join(', '));
  check('the review records all four versions',
    Object.values(versions).every((v) => markdown.includes(v)));
  check('it records the population seed and the profiles read',
    markdown.includes(`\`${SEED}\``) && markdown.includes('`57`'));
  check('it carries the what-to-look-for list from what has actually gone wrong',
    markdown.includes('punctuation that belongs to two mechanisms'));

  // §7: "a review that does not name what it reviewed cannot be referred to later."
  const gapped = renderReview({
    seed: SEED, count: COUNT, readSeeds: [], versions: { ...versions, templates: '' }, configVersion: 'test',
  });
  check('a missing version is detected', gapped.missing.includes('templates'));
  check('and the record is still written, with the gap marked in it',
    gapped.markdown.includes('**MISSING**') && gapped.markdown.includes('THIS REVIEW IS INCOMPLETE'),
    '§9.3: marking leaves a record that the gap existed; the CLI also exits non-zero');
}

/* ============================================ the finding the crowd view made */

section('Name and culture coherence: REPORTED, and it is a gap in a component');
{
  // THE CROWD VIEW PRODUCED THIS ON ITS FIRST RUN. Rendering names beside bios made a
  // documented limitation visible for the first time: `crispin sinclair`, origin `de`,
  // asked for culture `de`, writing a German bio under an English name. CCB-S4-002 says
  // in terms that "culturally coherent names" is NOT delivered, because the shipped
  // corpus carries no culture labels and the grammar engine runs against small
  // hand-authored fixtures. Nothing here fixes it: §2 says this component adds no
  // generation of its own, and a missing property is a gap in a component.
  const nonEnglish = profiles.filter((p) => !p.name.cultures.includes('en'));
  measure('profiles drawn for a non-English culture', `${nonEnglish.length} of ${COUNT}`);

  const surnames = new Map<string, number>();
  for (const p of profiles) {
    const family = p.name.parts.find((x) => x.kind === 'family')?.value;
    if (family !== undefined) surnames.set(family, (surnames.get(family) ?? 0) + 1);
  }
  const repeated = [...surnames.entries()].filter(([, n]) => n > 1).sort((a, b) => b[1] - a[1]);
  measure('surnames appearing more than once',
    repeated.length === 0 ? 'none' : repeated.slice(0, 5).map(([s, n]) => `${s} x${n}`).join(', '));

  const mismatched = profiles.filter(
    (p) => p.bio.text !== null && p.bio.language !== 'en' && p.name.cultures.every((c) => c !== p.bio.language),
  );
  measure("bios whose LABELLED culture differs from the name", `${mismatched.length}`);
  console.log('         That zero is not reassurance, and the metric is kept only to say so.');
  console.log('         The culture LABEL is correct on both sides: crispin sinclair was drawn');
  console.log('         for `de` and writes German. What is wrong is that the `de` pool returns');
  console.log('         an English-looking name, and no measurement taken from inside this');
  console.log('         generator can see that, because it would need the labelled corpus whose');
  console.log('         absence is the defect. A person reading the list saw it immediately.');

  console.log('         REPORTED, NOT GATED, and NOT FIXED HERE. §2: this component adds no');
  console.log('         generation of its own, and if something is missing it is a gap in a');
  console.log('         component. The gap is CCB-S4-002\'s: culturally coherent names need a');
  console.log('         labelled corpus, the fixtures stand in for one, and a `de` request');
  console.log('         therefore falls back to the unlabelled bulk pool. Invisible until names');
  console.log('         and bios were rendered together, which is what this component is for.');
}

/* -------------------------------------------------------------------- done */

console.log(`\nAssembled and rendered ${COUNT} profiles from seed ${SEED}.`);
console.log('This harness cannot check whether the population looks real. Open crowd.html.');
if (failures > 0) {
  console.error(`\n${failures} CHECK(S) FAILED`);
  process.exit(1);
}
console.log('ALL PASSED');
