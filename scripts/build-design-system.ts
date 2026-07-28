/**
 * Generates `design-system/` from the site's REAL stylesheet (CCB-S3-040).
 *
 * THE ONE RULE: there is no second copy of the design system. This script imports
 * `siteCss()` from `src/web/site/css.ts`, the same string the server inlines into
 * every page, and derives the package from it. Change a token in the site and the
 * next `npm run build` rewrites the package; there is nothing to keep in step by
 * hand, and nothing that can disagree about what the brand magenta is.
 *
 * That direction (generate) was chosen over the alternative (put tokens in a real
 * CSS file and have `css.ts` import them) because the site inlines its CSS under a
 * per-response CSP nonce. Reading a file at request time would add a filesystem
 * dependency to the render path for no gain, and the acceptance criterion is that
 * a visitor sees no change at all.
 *
 * Run standalone with `npm run design-system`; it also runs as part of `npm run
 * build`, so the package cannot go stale while the site moves on.
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { siteCss } from '../src/web/site/css.js';

const OUT = 'design-system';

/* ── Extraction ───────────────────────────────────────────────────────────── */

interface Token {
  name: string;
  value: string;
  /** The value with every `var()` resolved, so a tool that cannot cascade still sees a colour. */
  resolved: string;
  group: string;
}

/** Every custom property declared in any `:root` block, in source order. */
function readTokens(css: string): Token[] {
  const out: Token[] = [];
  const seen = new Set<string>();
  for (const block of css.matchAll(/:root\{([\s\S]*?)\n\}/g)) {
    for (const [, name, raw] of (block[1] ?? '').matchAll(/(--[a-z0-9-]+)\s*:\s*([^;]+);/g)) {
      if (!name || !raw || seen.has(name)) continue;
      seen.add(name);
      out.push({ name, value: raw.trim(), resolved: '', group: groupOf(name) });
    }
  }
  // Resolve var() chains against the set just read. A missing reference is a real
  // fault in the stylesheet, so it is left visible rather than silently blanked.
  const byName = new Map(out.map((t) => [t.name, t]));
  const resolve = (v: string, depth = 0): string =>
    depth > 8
      ? v
      : v.replace(/var\((--[a-z0-9-]+)\)/g, (whole, ref: string) => {
          const hit = byName.get(ref);
          return hit ? resolve(hit.value, depth + 1) : whole;
        });
  for (const t of out) t.resolved = resolve(t.value);
  return out;
}

function groupOf(name: string): string {
  if (/^--(ink|cyan|magenta|slate|green|amber|red)-/.test(name)) return 'palette';
  if (/^--(text|surface|border|primary|accent|neon|success|warning|danger|info|focus|scrim)/.test(name))
    return 'colour';
  if (/^--(font|size|leading|tracking)/.test(name)) return 'type';
  if (/^--(space|container|gutter)/.test(name)) return 'spacing';
  if (/^--radius|^--clip-corner/.test(name)) return 'shape';
  if (/^--(ease|duration|shadow)/.test(name)) return 'motion';
  return 'other';
}

/**
 * Component rules, pulled out by selector prefix.
 *
 * Selector-driven rather than by copying blocks, so a rule added to the site is
 * picked up on the next build instead of being forgotten.
 */
const COMPONENTS: Array<{ id: string; title: string; match: RegExp; note: string }> = [
  { id: 'control-demo', title: 'Demo control', match: /^\.dm\b|^\.dm[ .:>]|@keyframes dm/, note:
    'The approved control treatment. Nothing moves on hover; the glitch, scanline and raster all happen inside the element.' },
  { id: 'control-button', title: 'Buttons', match: /^\.cn-btn/, note: 'Primary, secondary and ghost, in three sizes.' },
  { id: 'nav-item', title: 'Navigation item and indicator', match: /^\.nav-link|^\.nav-indicator|^\.hdr-nav/, note:
    'One indicator travels between items; nothing else is drawn under a nav item.' },
  { id: 'rail', title: 'Utility rail', match: /^\.rail\b|^\.rail-/, note: 'The secondary tier above the main bar.' },
  { id: 'mega', title: 'Mega menu panel', match: /^\.cn-mega/, note:
    'Copied from the admin console so both surfaces share one navigation language.' },
  { id: 'panel', title: 'Section panel', match: /^\.sec-panel/, note: 'Carries the signature clipped corner.' },
  { id: 'chip', title: 'Feature chip and portrait badge', match: /^\.trust-item|^\.hero-feats|^\.pchip/, note:
    'The hero feature row staggers in; the portrait badge floats over the image.' },
  { id: 'card', title: 'Cards and tiles', match: /^\.cn-card|^\.cn-ftile/, note: 'Content containers.' },
  { id: 'badge', title: 'Badges', match: /^\.cn-badge/, note: 'Status pills.' },
];

interface RuleSet {
  id: string;
  title: string;
  note: string;
  css: string[];
}

/** Splits a stylesheet into top-level rules, keeping at-rules whole. */
function topLevelRules(css: string): string[] {
  const rules: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < css.length; i++) {
    const c = css[i];
    if (c === '{') {
      if (depth === 0) start = start; // rule began at the last boundary
      depth++;
    } else if (c === '}') {
      depth--;
      if (depth === 0) {
        rules.push(css.slice(start, i + 1).trim());
        start = i + 1;
      }
    }
  }
  return rules.filter(Boolean);
}

function collectComponents(css: string): RuleSet[] {
  // Comments carry prose that would confuse a per-rule split; drop them first.
  const bare = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const rules = topLevelRules(bare);
  const sets: RuleSet[] = COMPONENTS.map((c) => ({ id: c.id, title: c.title, note: c.note, css: [] }));
  for (const rule of rules) {
    const selector = rule.slice(0, rule.indexOf('{')).trim();
    if (!selector) continue;
    for (let i = 0; i < COMPONENTS.length; i++) {
      const spec = COMPONENTS[i];
      const set = sets[i];
      if (!spec || !set) continue;
      // A grouped selector matches if ANY of its parts does.
      const parts = selector.split(',').map((x) => x.trim());
      if (parts.some((x) => spec.match.test(x))) {
        set.css.push(rule);
        break;
      }
    }
  }
  return sets.filter((s) => s.css.length > 0);
}

/* ── Emit ─────────────────────────────────────────────────────────────────── */

const GENERATED = `/* GENERATED by scripts/build-design-system.ts from src/web/site/css.ts.
   Do not edit: the next \`npm run build\` overwrites it. Change the site, not this. */\n\n`;

function main(): void {
  const css = siteCss();
  const tokens = readTokens(css);
  const components = collectComponents(css);
  mkdirSync(OUT, { recursive: true });

  /* tokens.css */
  const byGroup = new Map<string, Token[]>();
  for (const t of tokens) byGroup.set(t.group, [...(byGroup.get(t.group) ?? []), t]);
  const order = ['palette', 'colour', 'type', 'spacing', 'shape', 'motion', 'other'];
  let tokensCss = GENERATED + ':root {\n';
  for (const g of order) {
    const list = byGroup.get(g);
    if (!list) continue;
    tokensCss += `\n  /* ${g} */\n`;
    for (const t of list) tokensCss += `  ${t.name}: ${t.value};\n`;
  }
  tokensCss += '}\n';
  writeFileSync(join(OUT, 'tokens.css'), tokensCss);

  /* tokens.json */
  const json: Record<string, Record<string, { value: string; resolved: string }>> = {};
  for (const t of tokens) {
    json[t.group] ??= {};
    (json[t.group] as Record<string, { value: string; resolved: string }>)[t.name] = {
      value: t.value,
      resolved: t.resolved,
    };
  }
  writeFileSync(
    join(OUT, 'tokens.json'),
    JSON.stringify(
      { generatedFrom: 'src/web/site/css.ts', tokenCount: tokens.length, tokens: json },
      null,
      2,
    ) + '\n',
  );

  /* components.css */
  let comp = GENERATED;
  for (const set of components) {
    comp += `/* ── ${set.title} ${'─'.repeat(Math.max(0, 60 - set.title.length))}\n   ${set.note} */\n`;
    comp += set.css.join('\n') + '\n\n';
  }
  writeFileSync(join(OUT, 'components.css'), comp);

  writeFileSync(join(OUT, 'index.html'), showcase(css, tokens, components));

  console.log(
    `design-system: ${String(tokens.length)} tokens, ${String(components.length)} component groups, ` +
      `${String(components.reduce((n, c) => n + c.css.length, 0))} rules`,
  );
}

/* ── The showcase ─────────────────────────────────────────────────────────── */

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}


function showcase(css: string, tokens: Token[], components: RuleSet[]): string {
  // Colour swatches need a per-specimen background. The site forbids inline style
  // attributes under its CSP; this page is a local file with no CSP and no server,
  // so it emits a generated <style> with one class per swatch instead, keeping the
  // same discipline rather than reaching for style="".
  const colourTokens = tokens.filter((t) => t.group === 'palette' || t.group === 'colour');
  const swatchCss = colourTokens
    .map((t, i) => `.sw-${String(i)}{background:${t.resolved}}`)
    .join('\n');
  const swatchMarkup = colourTokens
    .map(
      (t, i) => `<figure class="sw"><div class="sw-chip sw-${String(i)}"></div>
      <figcaption><code>${t.name}</code><span>${esc(t.resolved)}</span></figcaption></figure>`,
    )
    .join('\n');

  const typeTokens = tokens.filter((t) => t.name.startsWith('--size-'));
  const typeRamp = typeTokens
    .map(
      (t) =>
        `<div class="ramp-row"><code>${t.name}</code><span class="ramp-${t.name.replace('--size-', '')}">CIND3R3LLA</span><em>${t.resolved}</em></div>`,
    )
    .join('\n');
  const rampCss = typeTokens
    .map((t) => `.ramp-${t.name.replace('--size-', '')}{font-size:${t.resolved}}`)
    .join('\n');

  const spec = (label: string, html: string, forced = false): string =>
    `<figure class="spec${forced ? ' spec-forced' : ''}">
      <div class="spec-stage">${html}</div>
      <figcaption>${esc(label)}</figcaption>
    </figure>`;

  const demo = (cls: string): string =>
    `<span class="dm ${cls}"><span class="in"><span class="sl"></span><span class="t">DEMO</span></span></span>`;

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>CIND3R3LLA design system</title>
<style>
${css}
</style>
<style>
/* Showcase chrome only. Never shipped; the page above is the real stylesheet. */
body{margin:0;background:var(--surface-page);color:var(--text-body);font-family:var(--font-sans);
  padding:40px 32px 80px}
.ds-wrap{max-width:1100px;margin:0 auto}
h1{font-size:var(--size-title);margin:0 0 6px;color:var(--text-bright)}
.ds-sub{color:var(--text-muted);margin:0 0 34px;font-size:var(--size-body-sm)}
h2{font-size:var(--size-heading);margin:46px 0 4px;color:var(--text-bright);
  padding-top:20px;border-top:1px solid var(--border-hairline)}
h2 + p{color:var(--text-muted);font-size:var(--size-caption);margin:0 0 20px;max-width:70ch}
h3{font-size:var(--size-subheading);margin:26px 0 12px;color:var(--text-accent)}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(190px,1fr));gap:14px}
.sw{margin:0}
.sw-chip{height:52px;border-radius:var(--radius-sm);border:1px solid var(--border-hairline)}
.sw figcaption{display:flex;flex-direction:column;gap:2px;margin-top:7px;font-size:11px}
.sw code{color:var(--text-bright);font-family:var(--font-mono)}
.sw span{color:var(--text-faint);font-family:var(--font-mono)}
.specs{display:flex;flex-wrap:wrap;gap:16px;align-items:flex-start}
.spec{margin:0}
.spec-stage{display:flex;align-items:center;justify-content:center;min-height:80px;min-width:190px;
  padding:18px;border:1px solid var(--border-hairline);border-radius:var(--radius-md);
  background:var(--surface-raised)}
.spec figcaption{margin-top:7px;font-size:11px;color:var(--text-faint);font-family:var(--font-mono)}
.spec-forced .spec-stage{border-color:var(--border-strong)}
.ramp-row{display:grid;grid-template-columns:150px 1fr 80px;align-items:baseline;gap:14px;
  padding:8px 0;border-bottom:1px solid var(--border-hairline)}
.ramp-row code,.ramp-row em{font-family:var(--font-mono);font-size:11px;color:var(--text-faint);
  font-style:normal}
.ramp-row span{color:var(--text-bright);font-weight:600;line-height:1.1}
${swatchCss}
${rampCss}
/* Forced states. Hover cannot be photographed on a static page, so each
   interactive specimen is rendered a second time with its hover rules applied. */
.force-hover .dm{background:#FF3DA6}
.force-hover .dm .in{color:#fff;background:#160410}
.force-hover .dm .in::after{opacity:1}
.force-hover .cn-btn-primary{filter:brightness(1.08)}
.force-hover .nav-link{color:var(--text-bright)}
.force-hover .rail-link{color:var(--cyan-400)}
.force-focus .cn-btn{outline:none;box-shadow:var(--focus-ring)}
.force-focus .nav-link{outline:none;box-shadow:var(--focus-ring)}
.note{font-size:var(--size-caption);color:var(--text-muted);max-width:74ch;line-height:1.6}
.rule-count{font-family:var(--font-mono);font-size:10px;color:var(--text-faint)}
</style>
</head>
<body>
<div class="ds-wrap">
<h1>CIND3R3LLA design system</h1>
<p class="ds-sub">Generated from <code>src/web/site/css.ts</code>. Every specimen below uses the
site's real stylesheet, inlined above, so what you see is what the site renders.</p>

<h2>Colour</h2>
<p>The palette is the raw ramp; the semantic layer above it is what components use. Reach for a
semantic token, never a palette one, so a change of hue does not leave a lying variable name.</p>
<div class="grid">
${swatchMarkup}
</div>

<h2>Type</h2>
<p>Two families: <code>--font-sans</code> for everything, <code>--font-mono</code> for kickers,
labels and anything that should read as machine output.</p>
${typeRamp}

<h2>The signature shape</h2>
<p>A 9px cut at the top-left and bottom-right, held in <code>--clip-corner</code>. It appears on the
Demo control and on section panels, and it is what makes the page read as one system.</p>
<div class="specs">
${spec('sec-panel', '<div class="sec-panel"><div class="sec-panel-in">Section panel</div></div>')}
${spec('dm (default)', demo(''))}
</div>

<h2>Controls</h2>
<p>The approved control treatment. Nothing moves on hover: the border brightens, the interior
darkens toward the accent, the label glitches in hard <code>steps(1)</code>, one scanline crosses,
and a fine raster fades in. All inside the element.</p>
<div class="specs">
${spec('Demo, default', demo(''))}
${spec('Demo, hover (forced)', `<span class="force-hover">${demo('')}</span>`, true)}
${spec('Demo, unbuilt state', demo('dm-soon'))}
${spec('Button, primary', '<a class="cn-btn cn-btn-primary cn-btn-md" href="#">Primary</a>')}
${spec('Button, primary hover (forced)', '<span class="force-hover"><a class="cn-btn cn-btn-primary cn-btn-md" href="#">Primary</a></span>', true)}
${spec('Button, secondary', '<a class="cn-btn cn-btn-secondary cn-btn-md" href="#">Secondary</a>')}
${spec('Button, ghost', '<a class="cn-btn cn-btn-ghost cn-btn-md" href="#">Ghost</a>')}
${spec('Button, focus (forced)', '<span class="force-focus"><a class="cn-btn cn-btn-primary cn-btn-md" href="#">Focused</a></span>', true)}
</div>

<h2>Navigation</h2>
<p>One indicator travels between items; nothing else is drawn under a nav item. Rail items carry a
1px hairline separator sized to the text, not to the padded box.</p>
<div class="specs">
${spec('nav-link', '<span class="nav-link">Platform</span>')}
${spec('nav-link, active', '<span class="nav-link active">Platform</span>')}
${spec('nav-link, hover (forced)', '<span class="force-hover"><span class="nav-link">Platform</span></span>', true)}
${spec('nav-link, focus (forced)', '<span class="force-focus"><span class="nav-link">Platform</span></span>', true)}
${spec('rail-link', '<span class="rail-link"><span>GitHub</span></span>')}
${spec('rail-link, hover (forced)', '<span class="force-hover"><span class="rail-link"><span>GitHub</span></span></span>', true)}
</div>

<h2>Content</h2>
<div class="specs">
${spec('cn-card', '<div class="cn-card cn-card-default cn-card-pad-md">Card</div>')}
${spec('badge, warning', '<span class="cn-badge cn-badge-warning">In development</span>')}
${spec('badge, success', '<span class="cn-badge cn-badge-success">Live</span>')}
${spec('badge, outline', '<span class="cn-badge cn-badge-outline">Planned</span>')}
${spec('feature chip', '<span class="trust-item">Consent first</span>')}
${spec('portrait badge', '<span class="pchip"><span class="d"></span>Consent first</span>')}
</div>

<h2>Motion</h2>
<p class="note">One control curve, <code>--ease-control: cubic-bezier(.2,0,0,1)</code>, plus the
interface curves <code>--ease-out</code> and <code>--ease-in-out</code>. Durations are
<code>--duration-fast</code> 150ms, <code>--duration-base</code> 300ms, <code>--duration-slow</code>
500ms. Every animation on the site is disabled under <code>prefers-reduced-motion</code>; the Demo
control keeps only its colour change.</p>

<h2>Component rules</h2>
<p>Extracted verbatim from the site stylesheet. The full text is in
<code>components.css</code>.</p>
${components
  .map(
    (c) =>
      `<h3>${esc(c.title)} <span class="rule-count">${String(c.css.length)} rules</span></h3>
<p class="note">${esc(c.note)}</p>`,
  )
  .join('\n')}
</div>
</body>
</html>
`;
}

main();
