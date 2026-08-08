/**
 * The decision log's index, generated and checked (CCB-S5-003).
 *
 * ── WHY THIS EXISTS ─────────────────────────────────────────────────────────
 *
 * `docs/decisions.md` is 6,800 lines and 155 entries. Nothing was wrong with it, but two
 * things were awkward and one was dangerous:
 *
 *   1. You cannot see what is in the file without scrolling it or grepping it.
 *   2. The next free number has to be read off the file, and reading it wrong has
 *      produced a duplicate allocation TWICE (D-080, and a second D-082; see CLAUDE.md).
 *
 * A hand-written index would fix (1) and rot. This repository has just been through a
 * season whose close-out found `SEASON-INDEX.md` still claiming the season had not begun,
 * so an index nobody enforces is a liability rather than a feature. This generates the
 * index from the headings and fails when the file and the index disagree, which is the
 * same shape `verify:prompt-identity` uses for the prompt.
 *
 * It also asserts what actually went wrong historically: **no duplicate decision number**.
 * Gaps are reported rather than failed, because a withdrawn allocation is legitimate and
 * D-108 is one.
 *
 * ── WHAT IT DELIBERATELY DOES NOT DO ────────────────────────────────────────
 *
 * No anchor links. GitHub derives heading anchors with rules this script cannot verify
 * against the renderer, and 155 links that are all subtly wrong is worse than 155 rows
 * that are all right. Ctrl-F on the id works in every viewer, which is what the index is
 * for.
 *
 * Usage:
 *   npm run verify:decisions-index              check
 *   npm run verify:decisions-index -- --update  regenerate the block in place
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const FILE = resolve(HERE, '..', 'docs', 'decisions.md');

const BEGIN = '<!-- BEGIN DECISION INDEX -->';
const END = '<!-- END DECISION INDEX -->';

/** `### D-156 - Title` or `### D-124 — Title`. Both separators are in the file. */
const HEADING = /^### (D-(\d+))\s*[-–—]\s*(.+?)\s*$/;
const STATUS = /^\*\*Status:?\*?\*?:?\s*(.+)$/;

interface Entry {
  id: string;
  n: number;
  title: string;
  status: string;
}

let failures = 0;
function check(label: string, ok: boolean, detail = ''): void {
  if (!ok) failures += 1;
  console.log(`  [${ok ? 'PASS' : 'FAIL'}] ${label}${detail ? `: ${detail}` : ''}`);
}

/**
 * The status keyword, not the whole sentence. Entries write it four different ways
 * (`IMPLEMENTED** (CCB…`, `IMPLEMENTED (CCB…`, `IMPLEMENTED.`, `Superseded by D-036 and
 * D-037 …`), so cut at the first thing that ends a keyword and keep what is left.
 */
function normaliseStatus(raw: string): string {
  let s = raw.trim();
  const cut = s.search(/[.(]|\*\*/);
  if (cut > 0) s = s.slice(0, cut);
  return s.replace(/\*/g, '').trim();
}

function parse(text: string): Entry[] {
  const lines = text.split(/\r?\n/);
  const entries: Entry[] = [];
  let pending: { id: string; n: number; title: string } | null = null;

  const flush = (status: string): void => {
    if (pending) entries.push({ ...pending, status });
    pending = null;
  };

  for (const line of lines) {
    const h = HEADING.exec(line);
    if (h) {
      if (pending) flush('(no Status line)');
      pending = { id: h[1], n: Number(h[2]), title: h[3] };
      continue;
    }
    if (pending) {
      const s = STATUS.exec(line);
      if (s) flush(normaliseStatus(s[1]));
    }
  }
  if (pending) flush('(no Status line)');
  return entries;
}

/** The ids allocated more than once. The failure that has actually happened, twice. */
function duplicates(entries: Entry[]): string[] {
  const seen = new Map<number, number>();
  for (const e of entries) seen.set(e.n, (seen.get(e.n) ?? 0) + 1);
  return [...seen.entries()].filter(([, c]) => c > 1).map(([n]) => `D-${n}`);
}

function render(entries: Entry[]): string {
  const numbers = entries.map((e) => e.n);
  const highest = Math.max(...numbers);
  const present = new Set(numbers);
  const gaps: number[] = [];
  for (let i = 1; i <= highest; i += 1) if (!present.has(i)) gaps.push(i);

  const gapNote =
    gaps.length === 0
      ? 'No gaps.'
      : `Not allocated: ${gaps.map((n) => `D-${String(n).padStart(3, '0')}`).join(', ')}.`;

  const rows = entries.map(
    (e) => `| ${e.id} | ${e.title.replace(/\|/g, '\\|')} | ${e.status} |`,
  );

  return [
    BEGIN,
    '<details>',
    `<summary><strong>Index of all ${entries.length} decisions</strong> — newest first. ` +
      `Highest allocated: <strong>D-${highest}</strong>. ${gapNote} ` +
      '(Generated; run <code>npm run verify:decisions-index -- --update</code> after adding one.)</summary>',
    '',
    '| Id | Decision | Status |',
    '|---|---|---|',
    ...rows,
    '',
    '</details>',
    END,
  ].join('\n');
}

function replaceBlock(text: string, block: string): string {
  const start = text.indexOf(BEGIN);
  const end = text.indexOf(END);
  if (start === -1 || end === -1) {
    throw new Error(`Markers not found in ${FILE}. Expected ${BEGIN} … ${END}.`);
  }
  return text.slice(0, start) + block + text.slice(end + END.length);
}

function currentBlock(text: string): string | null {
  const start = text.indexOf(BEGIN);
  const end = text.indexOf(END);
  if (start === -1 || end === -1) return null;
  return text.slice(start, end + END.length);
}

// ── main ──────────────────────────────────────────────────────────────────────

const text = readFileSync(FILE, 'utf8');
const entries = parse(text);
const wanted = render(entries);

if (process.argv.includes('--update')) {
  writeFileSync(FILE, replaceBlock(text, wanted).replace(/\r\n/g, '\n'), 'utf8');
  console.log(`Wrote the index: ${entries.length} decisions, highest D-${Math.max(...entries.map((e) => e.n))}.`);
  process.exit(0);
}

console.log('1. The log parses');
check('every heading yields an id, a title and a status', entries.length > 0, `${entries.length} entries`);
check(
  'every entry has a Status line',
  entries.every((e) => e.status !== '(no Status line)'),
  entries.filter((e) => e.status === '(no Status line)').map((e) => e.id).join(', ') || 'all present',
);

console.log('\n2. No duplicate allocation');
check('each decision number appears exactly once', duplicates(entries).length === 0, duplicates(entries).join(', ') || 'none');

console.log('\n3. The index matches the log');
const have = currentBlock(text);
check('the index block exists', have !== null);
check(
  'the index is byte identical to the headings it indexes',
  have !== null && have.replace(/\r\n/g, '\n') === wanted,
  have !== null && have.replace(/\r\n/g, '\n') === wanted
    ? `${entries.length} rows`
    : 'run: npm run verify:decisions-index -- --update',
);

console.log('\n4. The proof that this can go red');
// A check that cannot fail is not a check. Each mutation is applied to a COPY of the
// parsed entries, never to the file.
const dropped = entries.slice(1);
check('an entry missing from the index fails the comparison', render(dropped) !== wanted);

const retitled = entries.map((e, i) => (i === 0 ? { ...e, title: `${e.title} (moved)` } : e));
check('a changed title fails the comparison', render(retitled) !== wanted);

// Through `duplicates()` itself, the same function section 2 asserts on. Re-implementing
// the detection here would prove only that this file can count.
check(
  'a duplicated number is caught by the same function section 2 uses',
  duplicates([...entries, { ...entries[0] }]).length === 1,
);

const statusChanged = entries.map((e, i) => (i === 0 ? { ...e, status: 'PLANNED' } : e));
check('a changed status fails the comparison', render(statusChanged) !== wanted);

console.log(
  failures === 0
    ? `\nAll ${entries.length} decisions are indexed, numbers are unique, and 4 mutations were caught.`
    : `\n${failures} check(s) failed.`,
);
process.exit(failures === 0 ? 0 : 1);
