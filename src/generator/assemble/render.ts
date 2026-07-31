/**
 * The three views, and the review record (CCB-S4-007 §3, §5).
 *
 * Three genuinely different questions, and no single output serves all three. Twenty
 * profiles is too few to see repetition and too many to inspect properly.
 */

import { TRAIT_ORDER } from '../traits/index.js';
import { STYLE_FIELDS } from '../surface/index.js';
import { BIO_LENGTHS } from '../bio/index.js';
import type { AssembledProfile, Components } from './index.js';

/* ==================================================================== detail */

/**
 * One profile with everything visible and traceable (§3.1).
 *
 * The point is that a person can follow a value back to what produced it, so every
 * derived number is printed next to the thing that derived it rather than on its own.
 */
export function renderDetail(profiles: readonly AssembledProfile[]): string {
  const out: string[] = [
    'DETAIL VIEW',
    '='.repeat(78),
    '',
    'One profile at a time, fully traced. Every value should be followable back to what',
    'produced it; if one is not, that is the gap to report.',
    '',
  ];

  for (const p of profiles) {
    out.push('-'.repeat(78));
    out.push(`seed ${p.seed}`);
    out.push('');
    out.push(`  archetype         ${p.archetype ?? 'null (unclassified background)'}`);
    out.push(
      `  latent            ${TRAIT_ORDER.map((t) => `${t.slice(0, 4)} ${p.latent[t].toFixed(2)}`).join('  ')}`,
    );
    out.push('');
    const capped = new Set(p.surface.capped);
    out.push('  style (percentiles; * marks a value a coherence rule changed)');
    for (const f of STYLE_FIELDS) {
      out.push(`    ${f.padEnd(20)}${p.surface.style[f].toFixed(1).padStart(6)}${capped.has(f) ? ' *' : ''}`);
    }
    if (p.surface.firedRules.length > 0) {
      out.push(`    rules fired       ${p.surface.firedRules.join(', ')}`);
    }
    const reactions = Object.entries(p.surface.style.reactionWeights)
      .sort((a, b) => b[1] - a[1])
      .map(([r, w]) => `${r} ${(w * 100).toFixed(0)}%`)
      .join('  ');
    out.push(`    reactions         ${reactions}`);
    out.push('');
    out.push('  identity');
    out.push(`    origin            ${Object.entries(p.surface.identity.originBlend).map(([k, v]) => `${k} ${v}`).join(', ')}`);
    out.push(`    age band          ${p.surface.identity.ageBand}`);
    out.push(`    gender            ${p.surface.identity.genderPresentation}`);
    out.push(`    name type         ${p.surface.identity.nameType}`);
    out.push(`    name pattern      ${p.surface.identity.namePattern}`);
    out.push('');
    out.push('  name');
    out.push(`    display           ${p.name.displayName}`);
    // Only when they differ: a stripped character must be visible, not silent.
    if (p.name.sanitised) {
      out.push(`    before sanitising ${p.name.originalName}   <-- SANITISED`);
    }
    out.push(`    cultures          ${p.name.cultures.join(', ')}`);
    out.push(`    generator pattern ${p.name.pattern}`);
    out.push(`    gender resolved   ${p.name.genderResolved}`);
    out.push('');
    out.push('  content and bio');
    out.push(`    theme             ${p.surface.content.bioTheme}`);
    out.push(`    interests         ${p.surface.content.interests.join(', ') || '(none)'}`);
    out.push(`    language          ${p.bio.language}${p.bio.fellBack ? '  <-- FELL BACK, no pool for this origin' : ''}`);
    out.push(`    length            ${p.bio.length}`);
    out.push(`    structural shape  ${p.bio.pattern}`);
    out.push(`    text              ${p.bio.text === null ? '(empty, which is the majority)' : JSON.stringify(p.bio.text)}`);
    out.push('');
    out.push('  rhythm');
    out.push(`    activity tier     ${p.surface.rhythm.activityTier}`);
    out.push(`    session pattern   ${p.surface.rhythm.sessionPattern}`);
    out.push(`    response latency  median ${p.surface.rhythm.responseLatency.median}s`);
    out.push(`    message length    median ${p.surface.rhythm.messageLength.median} words`);
    out.push(`    active hours      ${p.surface.rhythm.circadianMask.map((h) => `${h.from}-${h.to}`).join(', ')}`);
    out.push('');
  }
  return out.join('\n');
}

/* ===================================================================== crowd */

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * The member list (§3.2). THE VIEW THAT MATTERS.
 *
 * Rendered as a member list, not as a table of fields, and the distinction is the whole
 * requirement. The defects CCB-S4-006 found were visible only when a bio was read AS A
 * BIO: a table of `text` column values would have shown the same characters and
 * concealed the same faults, because a table is read as data and a member list is read
 * as people.
 *
 * ── TWO CHOICES §9.1 AND §4 PULL AGAINST EACH OTHER ON ─────────────────────
 *
 * §9.1 asks whether to show anything beyond name and bio. A letter-tile avatar
 * placeholder IS included, because a real client shows one and a member list without
 * avatars does not look like a member list, which is the only question this view exists
 * to answer. No timestamp: that would imply activity this view is not rendering.
 *
 * §4 requires every profile to show its own seed in all three views, and a real client
 * would show no such thing. It is rendered small and dim so it sits out of the way of
 * reading, but it IS rendered, because a profile that looks wrong has to be reproducible
 * in isolation and that is the difference between "something is off in this run" and a
 * bug report.
 *
 * SELF-CONTAINED: inline styles, no external references of any kind, no images. The
 * avatar is a CSS tile with a letter in it.
 */
export function renderCrowd(profiles: readonly AssembledProfile[], seed: number): string {
  const rows = profiles
    .map((p) => {
      const initial = escapeHtml([...p.name.displayName][0] ?? '?').toUpperCase();
      const hue = (p.seed * 137) % 360;
      const bio =
        p.bio.text === null
          ? '<div class="nobio"></div>'
          : `<div class="bio">${escapeHtml(p.bio.text).replace(/\n/g, '<br>')}</div>`;
      return `<li class="m">
  <div class="av" style="--h:${hue}">${initial}</div>
  <div class="t">
    <div class="n">${escapeHtml(p.name.displayName)}</div>
    ${bio}
  </div>
  <div class="s">${p.seed}</div>
</li>`;
    })
    .join('\n');

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Crowd view - ${profiles.length} profiles, population seed ${seed}</title>
<style>
  :root { color-scheme: light dark; }
  body { margin:0; font:15px/1.5 system-ui,-apple-system,Segoe UI,Roboto,sans-serif;
         background:#fbfbfc; color:#16171a; }
  header { padding:18px 20px; border-bottom:1px solid #e3e4e8; background:#fff; position:sticky; top:0; }
  h1 { margin:0 0 4px; font-size:15px; font-weight:600; }
  header p { margin:0; font-size:13px; color:#6b6d76; max-width:62ch; }
  ul { list-style:none; margin:0; padding:0; }
  .m { display:flex; gap:12px; align-items:flex-start; padding:12px 20px; border-bottom:1px solid #eceef1; }
  .av { flex:0 0 40px; height:40px; border-radius:50%; display:grid; place-items:center;
        font-weight:600; font-size:16px; color:#fff; background:hsl(var(--h) 42% 52%); }
  .t { flex:1 1 auto; min-width:0; }
  .n { font-weight:600; }
  .bio { color:#3c3e45; white-space:pre-wrap; overflow-wrap:anywhere; }
  .nobio { height:0; }
  .s { flex:0 0 auto; font:11px ui-monospace,SFMono-Regular,Consolas,monospace; color:#b6b8c0; padding-top:3px; }
  @media (prefers-color-scheme: dark) {
    body { background:#101114; color:#e8e9ec; }
    header { background:#16171a; border-color:#26282e; }
    header p { color:#9a9ca4; }
    .m { border-color:#1e2025; }
    .bio { color:#c2c4cb; }
    .s { color:#4a4c54; }
  }
</style></head><body>
<header>
  <h1>${profiles.length} profiles &middot; population seed ${seed}</h1>
  <p>Read this as a member list, not as data. The question is whether it looks real:
     whether any phrasing recurs more than a reader would accept, whether a name and a bio
     belong to the same person, whether anything reads as generated rather than written.
     The number on the right is the seed, so anything that looks wrong can be reproduced
     on its own.</p>
</header>
<ul>
${rows}
</ul>
</body></html>
`;
}

/* ============================================================== distribution */

/**
 * The statistics, RE-DERIVED from this population (§3.3, §9.2).
 *
 * §9.2 asks whether to embed the per-component harness output or re-derive it. Embedding
 * is simpler; re-deriving guarantees the numbers describe THIS population rather than
 * the last harness run. Re-derived, for the same reason every version binding in this
 * workstream exists: an artefact that might describe something else is worse than no
 * artefact.
 *
 * The caveat goes at the top rather than the bottom because §3.3 is explicit that this
 * is the view that would have passed while the text was wrong.
 */
export function renderDistribution(
  profiles: readonly AssembledProfile[],
  components: Components,
  seed: number,
): string {
  const n = profiles.length;
  const out: string[] = [
    'DISTRIBUTION VIEW',
    '='.repeat(78),
    '',
    'READ THE CAVEAT FIRST.',
    '',
    '  Everything below can be green while the text is wrong. That is not hypothetical:',
    '  under CCB-S4-006 every population statistic passed - empty rate, length',
    '  distribution, structural pattern share, four varying mechanisms - and then',
    '  twenty-six bios were read and three defects appeared that no number here could',
    '  have shown. A green distribution view is not a verdict. It is one of three, and',
    '  the crowd view is the one that answers whether this looks real.',
    '',
    `Population seed ${seed}, ${n.toLocaleString()} profiles.`,
    'Re-derived from this population, not copied from any harness run.',
    '',
  ];

  const share = (count: number): string => `${((count / n) * 100).toFixed(1)}%`;
  const tally = (pick: (p: AssembledProfile) => string): [string, number][] => {
    const m = new Map<string, number>();
    for (const p of profiles) m.set(pick(p), (m.get(pick(p)) ?? 0) + 1);
    return [...m.entries()].sort((a, b) => b[1] - a[1]);
  };
  const block = (title: string, rows: [string, number][], limit = 12): void => {
    out.push(title);
    for (const [k, v] of rows.slice(0, limit)) {
      out.push(`  ${k.padEnd(34)}${String(v).padStart(7)}${share(v).padStart(9)}`);
    }
    if (rows.length > limit) out.push(`  ... and ${rows.length - limit} more`);
    out.push('');
  };

  const written = profiles.filter((p) => p.bio.text !== null);
  out.push(`Bios: ${share(n - written.length)} empty, ${written.length.toLocaleString()} written.`);
  out.push('');

  block('Archetype', tally((p) => p.archetype ?? '(unclassified)'));
  block('Bio theme', tally((p) => p.surface.content.bioTheme));
  block('Bio length', BIO_LENGTHS.map((b) => [b, profiles.filter((p) => p.bio.length === b).length] as [string, number]));
  block('Bio language', tally((p) => p.bio.language + (p.bio.fellBack ? ' (fell back)' : '')));
  block('Name type', tally((p) => p.surface.identity.nameType));
  block('Culture', tally((p) => p.name.cultures.join('+')));
  block('Age band', tally((p) => p.surface.identity.ageBand));
  block('Activity tier', tally((p) => p.surface.rhythm.activityTier));

  const patterns = tally((p) => p.bio.pattern).filter(([k]) => k !== 'empty');
  const writtenCount = Math.max(1, written.length);
  out.push('Bio structural pattern, as a share of WRITTEN bios');
  for (const [k, v] of patterns.slice(0, 8)) {
    out.push(`  ${k.padEnd(34)}${String(v).padStart(7)}${`${((v / writtenCount) * 100).toFixed(1)}%`.padStart(9)}`);
  }
  out.push(`  ${patterns.length} distinct patterns across ${written.length.toLocaleString()} written bios`);
  out.push('');

  out.push('Style marginals (percentiles)');
  for (const f of STYLE_FIELDS) {
    const vals = profiles.map((p) => p.surface.style[f]).sort((a, b) => a - b);
    out.push(
      `  ${f.padEnd(22)}p10 ${vals[Math.floor(n * 0.1)]!.toFixed(0).padStart(3)}` +
        `   median ${vals[Math.floor(n * 0.5)]!.toFixed(0).padStart(3)}` +
        `   p90 ${vals[Math.floor(n * 0.9)]!.toFixed(0).padStart(3)}`,
    );
  }
  out.push('');

  out.push('Latent marginals (z-scores; standardised, so these should sit near 0 and 1)');
  for (const t of TRAIT_ORDER) {
    const vals = profiles.map((p) => p.latent[t]);
    const m = vals.reduce((a, b) => a + b, 0) / n;
    const sd = Math.sqrt(vals.reduce((a, b) => a + (b - m) ** 2, 0) / Math.max(1, n - 1));
    out.push(`  ${t.padEnd(22)}mean ${m.toFixed(3).padStart(7)}   sd ${sd.toFixed(3).padStart(6)}`);
  }
  out.push('');

  out.push('Component data set versions');
  for (const [k, v] of Object.entries({
    archetypes: components.archetypes.version,
    loadings: components.loadings.version,
    templates: components.templates.version,
    names: components.corpus.version,
  })) {
    out.push(`  ${k.padEnd(22)}${v}`);
  }
  return out.join('\n');
}

/* ==================================================================== review */

export interface ReviewInput {
  seed: number;
  count: number;
  readSeeds: number[];
  versions: Record<string, string>;
  configVersion: string;
}

/**
 * The review record (§5), pre-filled with everything mechanical.
 *
 * ── §9.3: MARK THE GAP AND FAIL, RATHER THAN CHOOSING ──────────────────────
 *
 * §9.3 asks whether to refuse writing when a component version is missing, or to write
 * with the gap marked: "refusing is stricter; marking leaves a record that the gap
 * existed". Both, because they are not alternatives. The file is written with the gap
 * marked in it, so the record survives, AND the command exits non-zero, so the gap is
 * not something anyone can walk past. Destroying the evidence to enforce the rule would
 * be the worse half of each option.
 */
export function renderReview(input: ReviewInput): { markdown: string; missing: string[] } {
  const missing = Object.entries(input.versions)
    .filter(([, v]) => typeof v !== 'string' || v.length === 0)
    .map(([k]) => k);

  const versionRows = Object.entries(input.versions)
    .map(([k, v]) => `| ${k} | ${v && v.length > 0 ? `\`${v}\`` : '**MISSING**'} |`)
    .join('\n');

  const markdown = `# Profile review

Generated by \`npm run assemble\`. Everything above the findings section is mechanical;
the findings are the only manual part and should be the only manual part.

## What was reviewed

| | |
|---|---|
| population seed | \`${input.seed}\` |
| profiles generated | ${input.count} |
| configuration | \`${input.configVersion}\` |

### Component data set versions

| data set | version |
|---|---|
${versionRows}
${missing.length > 0 ? `\n> **THIS REVIEW IS INCOMPLETE.** ${missing.join(', ')} reported no version, so this record\n> cannot say what it reviewed and cannot be referred to later. The file is written anyway\n> so the gap itself is on record, and \`assemble\` exited non-zero.\n` : ''}
### Profiles read

Seeds: ${input.readSeeds.length > 0 ? input.readSeeds.map((s) => `\`${s}\``).join(', ') : '_none recorded_'}

Count: ${input.readSeeds.length}

## What to look for

From what has actually gone wrong, rather than from imagination:

- [ ] punctuation that belongs to two mechanisms at once
- [ ] language mixing inside one bio
- [ ] a template's assumptions violated by its inputs
- [ ] names and bios that do not belong to the same person
- [ ] the same phrasing recurring more often than a reader would accept
- [ ] anything that reads as generated rather than written

The last is the whole point and cannot be enumerated further.

## Findings

_Fill this in. Write "nothing found" if nothing was found: an empty section and a clean
review are indistinguishable later, and only one of them is a fact._

## Reviewed by

_Name or handle, and the date._
`;
  return { markdown, missing };
}
