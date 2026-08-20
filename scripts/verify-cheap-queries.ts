/**
 * Nothing that wants a NUMBER may read a view that carries CONTENT (CCB-S5-051, D-236).
 *
 * ── WHY THIS IS A CHECK AND NOT A CONVENTION ─────────────────────────────────
 *
 * The operator's activity stream took ten seconds to render an archive of 5,186 messages,
 * and 7.3 of those seconds were three queries that wanted a count, a hash and a distinct
 * list. All three read `published_messages`, which computes a `formatted` column from
 * `raw_json -> 'chatItem' -> 'formattedText'`. His `raw_json` averages 39 KB a row and the
 * table carries 207 MB of TOAST, so each of those queries detoasted 207 MB to produce a
 * number it then discarded.
 *
 * Nobody did anything careless. `formatted` arrived with migration 019, the counts predate
 * it, and the two met without anybody noticing. That is exactly the shape a convention does
 * not survive: the next expensive column will be added by somebody who was not here, onto a
 * view that a count has been reading happily for two years.
 *
 * ── THE RULE, AS AN ALLOW-LIST ───────────────────────────────────────────────
 *
 * D-201: a deny-list of "expensive columns" fails OPEN - the column that matters is the one
 * nobody thought to list, which is precisely how this happened. So the rule is stated the
 * other way round and over the SHAPE of the query rather than over columns: a query that
 * aggregates, counts, hashes, takes a DISTINCT or asks EXISTS is a query that wants an
 * answer about the SET, and it must read `published_message_index`. Only a query that
 * genuinely renders rows may read `published_messages`, and those are bounded by LIMIT.
 *
 * ── THE POSITIVE CONTROL IS LOAD-BEARING ─────────────────────────────────────
 *
 * "No counting query reads the content view" passes perfectly against a file where nothing
 * reads it at all, or where the content view has been deleted. So this also asserts that
 * the content view IS still read, by the row-rendering queries, and that the index view is
 * actually in use. Without both, a future refactor could satisfy this check by making the
 * stream stop working.
 *
 *   npm run verify:cheap-queries
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SOURCE = join(ROOT, 'src', 'db', 'public-archive.ts');

const CONTENT_VIEW = 'published_messages';
const INDEX_VIEW = 'published_message_index';

/**
 * What makes a query a question about the SET rather than a request for rows.
 *
 * `LIMIT` is deliberately NOT here. A query can carry both - the page selects rows AND is
 * bounded - and what decides is whether it aggregates, not whether it is bounded.
 */
const SET_SHAPES: { name: string; re: RegExp }[] = [
  { name: 'count(*)', re: /\bcount\s*\(/i },
  { name: 'max()/min()', re: /\b(?:max|min)\s*\(/i },
  { name: 'DISTINCT', re: /\bdistinct\b/i },
  { name: 'EXISTS', re: /\bexists\s*\(/i },
  { name: 'string_agg/md5 over the set', re: /\bstring_agg\s*\(/i },
];

let failures = 0;
function check(label: string, ok: boolean, detail = ''): void {
  if (!ok) failures++;
  console.log(`  [${ok ? 'PASS' : 'FAIL'}] ${label}${detail ? `: ${detail}` : ''}`);
}

interface Statement {
  sql: string;
  line: number;
}

/**
 * Every SQL template literal in the file, with the line it starts on.
 *
 * Backtick literals only, which is what every query here uses. A query assembled by string
 * concatenation would slip past this, and that is stated rather than hidden: the guard is
 * over the shape this file actually writes, and `verify:searchable`'s lesson applies - a
 * detector that cannot see something should say so.
 */
function statements(src: string): Statement[] {
  const out: Statement[] = [];
  for (let i = 0; i < src.length; i++) {
    if (src[i] !== '`') continue;
    const end = src.indexOf('`', i + 1);
    if (end === -1) break;
    const body = src.slice(i + 1, end);
    if (/\bfrom\s+published_/i.test(body)) {
      out.push({ sql: body, line: src.slice(0, i).split('\n').length });
    }
    i = end;
  }
  // Single-quoted one-liners too: `isPublished` writes one.
  for (const m of src.matchAll(/'([^'\n]*\bFROM\s+published_[^'\n]*)'/gi)) {
    out.push({ sql: m[1] ?? '', line: src.slice(0, m.index ?? 0).split('\n').length });
  }
  return out;
}

/** Does this statement read the CONTENT view (as opposed to the index)? */
function readsContentView(sql: string): boolean {
  return new RegExp(`\\bfrom\\s+${CONTENT_VIEW}\\b`, 'i').test(sql);
}

function readsIndexView(sql: string): boolean {
  return new RegExp(`\\bfrom\\s+${INDEX_VIEW}\\b`, 'i').test(sql);
}

function setShapesIn(sql: string): string[] {
  return SET_SHAPES.filter((s) => s.re.test(sql)).map((s) => s.name);
}

function violations(src: string): { line: number; shapes: string[] }[] {
  return statements(src)
    .filter((s) => readsContentView(s.sql))
    .map((s) => ({ line: s.line, shapes: setShapesIn(s.sql) }))
    .filter((v) => v.shapes.length > 0);
}

function main(): void {
  const src = readFileSync(SOURCE, 'utf8');
  const all = statements(src);

  console.log('\n1. The rule: a query that asks about the SET reads the index, not the content view\n');

  const bad = violations(src);
  check(
    'no counting, hashing, DISTINCT or EXISTS query reads the content view',
    bad.length === 0,
    bad.length === 0
      ? ''
      : bad.map((v) => `line ${String(v.line)} uses ${v.shapes.join(' + ')}`).join('; '),
  );

  console.log('\n2. The positive controls, without which the above passes vacuously\n');

  const contentReaders = all.filter((s) => readsContentView(s.sql));
  const indexReaders = all.filter((s) => readsIndexView(s.sql));

  check(
    'the content view IS still read, by the queries that render rows',
    contentReaders.length > 0,
    `${String(contentReaders.length)} statement(s)`,
  );
  check(
    'the index view is actually in use',
    indexReaders.length > 0,
    `${String(indexReaders.length)} statement(s)`,
  );
  check(
    'and the set-shape detector recognises a real one',
    indexReaders.some((s) => setShapesIn(s.sql).length > 0),
    'at least one index read is a count/hash/exists',
  );

  console.log('\n3. The proof that this can go red\n');

  // Point one cheap query back at the content view, in memory only.
  const mutated = src.replace(
    `SELECT count(*) AS n FROM ${INDEX_VIEW} m \${whereSql}`,
    `SELECT count(*) AS n FROM ${CONTENT_VIEW} m \${whereSql}`,
  );
  check('the mutation found a counting query to move', mutated !== src);
  const caught = violations(mutated);
  check(
    'MUTATION: a count pointed back at the content view is caught',
    caught.length > 0,
    caught.length > 0 ? `line ${String(caught[0]?.line ?? 0)}` : 'not caught',
  );

  // And the reverse: deleting every content read must NOT satisfy the rule, because the
  // positive control above would go red. Proven by running the control on that text.
  const gutted = src.replace(new RegExp(`\\bFROM\\s+${CONTENT_VIEW}\\b`, 'gi'), `FROM ${INDEX_VIEW}`);
  check(
    'MUTATION: a file that stopped reading the content view at all fails the control',
    statements(gutted).filter((s) => readsContentView(s.sql)).length === 0,
    'so "no violations" cannot be reached by deleting the feature',
  );

  console.log(
    failures === 0
      ? `\nAll cheap-query checks passed: ${String(all.length)} published-view statements scanned.`
      : `\n${String(failures)} check(s) FAILED.`,
  );
  process.exit(failures === 0 ? 0 : 1);
}

main();
