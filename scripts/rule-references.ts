/**
 * Which rules are PINNED BY NAME somewhere in the tree (measurement aid).
 *
 * "Load-bearing" is a judgement, and this is the half of it that is not: a rule whose id a
 * check, the source, or a decision entry names is a rule something else depends on, and
 * cutting it breaks that thing loudly. A rule nothing names is not thereby prose - it may be
 * the only sentence standing between her and a production failure - but the two piles are
 * worth telling apart before anybody proposes a cut.
 *
 * Read-only. Greps the tree for each seeded rule id.
 *
 *   npx tsx scripts/rule-references.ts
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { seededPromptRules } from './seeded-rules.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

const SEARCHED = ['src', 'scripts', 'docs', 'migrations'] as const;
const SKIP = new Set(['node_modules', 'dist', 'public', 'state', 'media', '.git']);

/**
 * The measurement tools are excluded from their own sweep.
 *
 * The whole point of this script is the signal "a CHECK depends on this rule, so cutting it
 * breaks something loudly". A measurement aid naming a rule id in an example or a fixture is
 * not that, and counting one produced exactly the wrong answer on the first run: it reported
 * `ceiling.hard-limit` as pinned by `measure-prompt.ts`, which pins nothing at all.
 */
const NOT_A_DEPENDENCY = new Set([
  'scripts/measure-prompt.ts',
  'scripts/dump-rule-text.ts',
  'scripts/dump-dial-block.ts',
  'scripts/rule-references.ts',
]);

interface Hit {
  file: string;
  count: number;
}

function walk(dir: string, out: string[]): void {
  for (const entry of readdirSync(dir)) {
    if (SKIP.has(entry)) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.(ts|sql|md|json)$/.test(entry)) out.push(full);
  }
}

async function main(): Promise<void> {
  const rules = await seededPromptRules();

  const files: string[] = [];
  for (const dir of SEARCHED) walk(join(ROOT, dir), files);
  const contents = new Map<string, string>();
  for (const file of files) contents.set(file, readFileSync(file, 'utf8'));

  interface Row {
    id: string;
    chars: number;
    tier: string;
    critical: boolean;
    checks: Hit[];
    source: Hit[];
    docs: Hit[];
  }

  const rows: Row[] = [];
  for (const rule of rules) {
    const needle = rule.id;
    const checks: Hit[] = [];
    const source: Hit[] = [];
    const docs: Hit[] = [];
    for (const [file, text] of contents) {
      // The migration that seeds it always names it; that is not a dependency.
      if (file.includes(`${'migrations'}`)) continue;
      const count = text.split(needle).length - 1;
      if (count === 0) continue;
      const rel = file.slice(ROOT.length + 1).replace(/\\/g, '/');
      if (NOT_A_DEPENDENCY.has(rel)) continue;
      if (rel.startsWith('scripts/')) checks.push({ file: rel, count });
      else if (rel.startsWith('src/')) source.push({ file: rel, count });
      else docs.push({ file: rel, count });
    }
    rows.push({
      id: rule.id,
      chars: rule.text.length,
      tier: rule.tier,
      critical: rule.critical,
      checks,
      source,
      docs,
    });
  }

  const pinned = rows.filter((r) => r.checks.length > 0 || r.source.length > 0);
  const documented = rows.filter(
    (r) => r.checks.length === 0 && r.source.length === 0 && r.docs.length > 0,
  );
  const unnamed = rows.filter(
    (r) => r.checks.length === 0 && r.source.length === 0 && r.docs.length === 0,
  );

  console.log('');
  console.log(`PINNED BY A CHECK OR BY THE SOURCE: ${String(pinned.length)} of ${String(rows.length)}`);
  for (const row of pinned.sort((a, b) => b.chars - a.chars)) {
    const where = [...row.checks, ...row.source].map((h) => h.file).join(', ');
    console.log(`  ${String(row.chars).padStart(5)}  ${row.id.padEnd(40)} ${where}`);
  }
  console.log('');

  console.log(`NAMED ONLY IN A DECISION OR DOCUMENT: ${String(documented.length)}`);
  for (const row of documented.sort((a, b) => b.chars - a.chars)) {
    console.log(
      `  ${String(row.chars).padStart(5)}  ${row.id.padEnd(40)} ${row.docs.map((h) => h.file).join(', ')}`,
    );
  }
  console.log('');

  console.log(`NAMED NOWHERE OUTSIDE THE MIGRATION: ${String(unnamed.length)}`);
  const unnamedChars = unnamed.reduce((s, r) => s + r.chars, 0);
  for (const row of unnamed.sort((a, b) => b.chars - a.chars)) {
    console.log(`  ${String(row.chars).padStart(5)}  ${row.id.padEnd(40)} ${row.tier}${row.critical ? ' CRITICAL' : ''}`);
  }
  console.log('');
  console.log(`  ${String(unnamedChars)} characters of authored text sit in rules nothing else names.`);
  console.log('');
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
