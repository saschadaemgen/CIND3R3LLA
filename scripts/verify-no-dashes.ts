/**
 * CCB-S3-021 — no em-dash, en-dash, or horizontal bar in member-facing text.
 *
 * The operator's standing rule: those three characters (— – ―) must never appear
 * in anything a member can read, in any language. This harness fails if one does,
 * in the same spirit as the doubled-delimiter guard from CCB-S3-003 — without an
 * enforced check the fault returns the moment someone writes new copy.
 *
 * It guards on three fronts:
 *   1. LOCALE FILES — every value is member-facing, so the raw JSON is scanned.
 *   2. RUNTIME OUTPUT — the composed member-facing strings (persona, retorts, the
 *      help reply and its topics, the welcome message) are built and checked. This
 *      is the definitive check: it sees exactly what a member would.
 *   3. SOURCE BACKSTOP — the copy-bearing modules and the WHOLE plugins tree are
 *      scanned with comments stripped, so a new plugin's strings are caught
 *      automatically rather than being remembered. After stripping comments, any of
 *      these characters can only be inside a string literal (no identifier or
 *      operator uses them), so a bare character scan is enough.
 *   4. GENERATED MEMBER-FACING OUTPUT — the profile generator's authored data sets, and
 *      an actual generated population's bios and names.
 *
 * FRONT 4 EXISTS BECAUSE THE RULE WAS BINDING AND THE CHECK DID NOT COVER IT. An em-dash
 * was authored into the bio separator pool and shipped, and a member list came back
 * reading "Ueber Astronomie rede ich jederzeit gern — Ich arbeite im Bereich Druck". The
 * rule always covered it: a generated bio is text a member reads. What did not cover it
 * was this harness, which scanned the bot's own copy and stopped there. A generator whose
 * entire purpose is output that does not look machine written is the LAST place the
 * check should have been missing, since an em-dash is one of the plainest tells there is:
 * a member cannot type one on a phone keyboard.
 *
 * Generating a population rather than only reading the data files is deliberate. The
 * separator was correct in isolation and only became member-facing text after
 * composition, which is the same reason front 2 exists for the bot's own copy.
 *
 *   npx tsx scripts/verify-no-dashes.ts
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DEFAULT_INTERACTION } from '../src/interaction/settings.js';
import { buildHelpReply, buildHelpTopic } from '../src/interaction/help.js';
import { arrivalNotice } from '../src/consent/commands.js';
import type { Intent } from '../src/interaction/intent.js';
import {
  DEFAULT_ASSEMBLE_CONFIG,
  assemblePopulation,
  loadComponents,
  prepareAssembler,
} from '../src/generator/assemble/index.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

/** Em-dash (U+2014), en-dash (U+2013), horizontal bar (U+2015). */
const FORBIDDEN = /[—–―]/;
const NAMES: Record<string, string> = {
  '—': 'em-dash',
  '–': 'en-dash',
  '―': 'horizontal-bar',
};

let failures = 0;
let scanned = 0;

function report(where: string, text: string): void {
  const idx = text.search(FORBIDDEN);
  if (idx < 0) return;
  failures++;
  const ch = text[idx] ?? '';
  const around = text.slice(Math.max(0, idx - 28), idx + 28).replace(/\s+/g, ' ');
  console.log(`  [FAIL] ${where}: ${NAMES[ch] ?? 'forbidden'} in "…${around}…"`);
}

function check(where: string, text: string): void {
  scanned++;
  report(where, text);
}

/* ── 1. Locale files: none here any more ─────────────────────────────────────
 *
 * `locales/` moved to the marketing-site repository with the rest of the site
 * (D-089), which runs its own `verify:no-dashes` over those files and over its
 * rendered pages. What remains member-facing in THIS repository is the bot's own
 * output, which is what the rest of this harness checks.
 */

/* ── 2. Runtime member-facing strings ────────────────────────────────────── */
for (const [lang, p] of Object.entries(DEFAULT_INTERACTION.persona)) {
  for (const [key, val] of Object.entries(p)) check(`persona.${lang}.${key}`, String(val));
}
for (const [lang, list] of Object.entries(DEFAULT_INTERACTION.retorts)) {
  list.forEach((r, i) => check(`retorts.${lang}[${i}]`, r));
}
const ALL_INTENTS: Intent[] = ['PUBLISH', 'UNPUBLISH', 'STATUS', 'SEARCH', 'PRICE', 'HELP', 'UNDO'];
for (const lang of ['en', 'de'] as const) {
  // template '' renders the shipped default (CCB-S3-021 §3), so the rendered help,
  // its consent block and its command list are all scanned for stray dashes.
  check(`help.${lang}`, buildHelpReply({ template: '', intents: ALL_INTENTS, wake: 'Cinderella', lang, links: ['https://x/a', 'https://x/b'] }));
  check(`helpTopic.consent.${lang}`, buildHelpTopic('consent', 'Cinderella', lang));
  check(`helpTopic.prices.${lang}`, buildHelpTopic('prices', 'Cinderella', lang));
}
check('arrivalNotice (her own arrival, renamed from welcomeMessage under D-206)', arrivalNotice('Cinderella'));

/* ── 3. Source backstop (comments stripped) ──────────────────────────────── */
function stripComments(src: string): string {
  // Block comments (covers JSDoc, where most legitimate em-dashes live).
  let s = src.replace(/\/\*[\s\S]*?\*\//g, ' ');
  // Line comments — cut at the first `//` NOT preceded by ':' (so `https://` in a
  // string survives). Any dash after such a `//` would be in a comment, out of scope.
  s = s
    .split('\n')
    .map((line) => {
      const m = /(^|[^:])\/\//.exec(line);
      return m ? line.slice(0, m.index + m[1].length) : line;
    })
    .join('\n');
  return s;
}

function walk(dir: string, out: string[]): void {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (name.endsWith('.ts')) out.push(p);
  }
}

const backstopFiles = [
  join(ROOT, 'src/interaction/help.ts'),
  join(ROOT, 'src/interaction/settings.ts'),
  join(ROOT, 'src/consent/commands.ts'),
  // CCB-S4-029. The calibrated reference lines are examples of her voice sent INTO the
  // prompt, and a 9B model returns one verbatim when the member's message happens to be
  // the calibration question. That makes them member-facing in the only sense that
  // matters here, so they are scanned like any other copy. Added by walking the standing
  // checks against a new file, which is the D-105 rule.
  join(ROOT, 'src/interaction/personality.ts'),
];
walk(join(ROOT, 'src/plugins'), backstopFiles);

for (const file of backstopFiles) {
  const rel = file.slice(ROOT.length + 1).replace(/\\/g, '/');
  check(`${rel} (string literal)`, stripComments(readFileSync(file, 'utf8')));
}

/* ── 4. Generated member-facing output ───────────────────────────────────── */

// 4a. The authored data sets. `_README` blocks are repository prose, not output, and
// CCB-S3-043 settled that scope: the rule covers what a member can read. Every other
// string in these files can reach a profile.
function scanJson(node: unknown, where: string): void {
  if (typeof node === 'string') check(where, node);
  else if (Array.isArray(node)) node.forEach((v, i) => scanJson(v, `${where}[${i}]`));
  else if (node !== null && typeof node === 'object') {
    for (const [k, v] of Object.entries(node)) {
      if (k === '_README') continue;
      scanJson(v, `${where}.${k}`);
    }
  }
}

const dataFiles: string[] = [];
function walkJson(dir: string): void {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walkJson(p);
    // The shipped bulk name corpus is a third-party data set of ~100k names and is
    // covered by 4b instead, which scans what actually comes out of it.
    else if (name.endsWith('.json') && name !== 'names_data.json') dataFiles.push(p);
  }
}
walkJson(join(ROOT, 'src/generator'));
for (const file of dataFiles) {
  scanJson(JSON.parse(readFileSync(file, 'utf8')), file.slice(ROOT.length + 1).replace(/\\/g, '/'));
}

// 4b. A real population. The separator that shipped was correct in isolation and only
// became member-facing text after composition, so the data files alone are not enough.
const assembled = assemblePopulation(
  prepareAssembler(loadComponents(), DEFAULT_ASSEMBLE_CONFIG),
  400,
  1,
);
for (const p of assembled) {
  if (p.bio.text !== null) check(`generated bio (seed ${p.seed})`, p.bio.text);
  check(`generated name (seed ${p.seed})`, p.name.displayName);
}

/* ── Result ──────────────────────────────────────────────────────────────── */
console.log(`\nScanned ${scanned} sources.`);
if (failures === 0) {
  console.log('ALL PASSED — no em-dash, en-dash or horizontal bar in member-facing text.');
} else {
  console.log(`${failures} FAILURE(S) — replace with a hyphen, a comma, or restructure.`);
  process.exit(1);
}
