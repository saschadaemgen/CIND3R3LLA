/**
 * Every `{@link Symbol}` in the tree resolves to a symbol that exists
 * (CCB-S5-064, D-262; proposed by CCB-S5-063's stage 6, approved as framed).
 *
 * ── THE DEFECT CLASS THIS CATCHES ────────────────────────────────────────────
 *
 * `{@link originLines}` pointed at a symbol that never existed after D-144 moved the
 * prompt sentences into the registry, and it was found by a reader, twice (the second
 * time as an echo in a migration comment). A doc link to nothing is a claim about the
 * code that the code cannot back.
 *
 * ── WHAT COUNTS AS RESOLVING ─────────────────────────────────────────────────
 *
 * The link's BASE identifier must occur somewhere in src/ or scripts/ either as a
 * declaration (`class|interface|function|const|let|var|enum|type NAME`) or as a
 * member-shaped occurrence (`NAME:`, `NAME(`, `NAME =`, `NAME<`), and a dotted link's
 * MEMBER must occur member-shaped too. Member-shaped occurrences are accepted on
 * purpose: seventeen real links point at methods and properties (`runForGroup`,
 * `GreetingContext.returning`, ...) that no top-level declaration form matches -
 * measured before this shipped, because a matcher that reported seventeen false dead
 * links would have been loosened on day two and would then hide real ones.
 *
 * The pre-existing dead link this would have caught was REWORDED in the commit that
 * ships this check (personality.ts's historical note about `originLines` itself), rather
 * than teaching the matcher to skip backtick-quoted links - a loophole every future dead
 * link could hide in.
 *
 * Mutation-proven in section 2, and the scanner carries its own positive control against
 * the real tree (a scanner matching nothing would pass forever - the D-184 dead-detector
 * lesson).
 *
 *   npx tsx scripts/verify-doc-links.ts
 */

import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

let failures = 0;
function check(label: string, ok: boolean, detail = ''): void {
  if (!ok) failures++;
  console.log(`  [${ok ? 'PASS' : 'FAIL'}] ${label}${detail ? `: ${detail}` : ''}`);
}

export interface DocLink {
  file: string;
  name: string;
}

const LINK_RE = /\{@link\s+([A-Za-z_$][A-Za-z0-9_$.]*)[^}]*\}/g;

export function linksIn(file: string, source: string): DocLink[] {
  const out: DocLink[] = [];
  for (const m of source.matchAll(LINK_RE)) {
    const name = m[1];
    if (name) out.push({ file, name });
  }
  return out;
}

function escape(name: string): string {
  return name.replace(/\$/g, '\\$');
}

/**
 * Comments removed, so a link cannot resolve against PROSE (the reviewed hole: a dead
 * link whose target was mentioned as `name:` in some unrelated comment stayed green).
 * Naive - a string literal containing `//` loses its tail - which for a resolution
 * corpus errs toward stricter, the right direction for a detector.
 */
export function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/[^\n]*/g, ' ');
}

function declaredRe(name: string): RegExp {
  return new RegExp(`\\b(?:class|interface|function|const|let|var|enum|type)\\s+${escape(name)}\\b`);
}

/** Whether one identifier exists in CODE: declared, member-shaped, imported, or in type
 * position (`: Name`, `<Name`, `| Name` - annotation-only types are legitimate targets). */
export function identifierExists(codeCorpus: string, name: string): boolean {
  const memberShaped = new RegExp(`\\b${escape(name)}\\s*[:(=<]`);
  const typePosition = new RegExp(`[:<,|&(]\\s*${escape(name)}\\b`);
  const imported = new RegExp(`\\bimport\\b[^;]{0,400}\\b${escape(name)}\\b`);
  return (
    declaredRe(name).test(codeCorpus) ||
    memberShaped.test(codeCorpus) ||
    typePosition.test(codeCorpus) ||
    imported.test(codeCorpus)
  );
}

/**
 * Whether a (possibly dotted) link target resolves.
 *
 * A dotted link's MEMBER is resolved within the files that DECLARE its base, not against
 * the whole corpus (the reviewed hole: `Real.noSuchMember` stayed green because some
 * unrelated file had a `noSuchMember:` property). When no file declares the base in a
 * declaration form - a purely member-shaped base - the member falls back to the whole
 * corpus, and that residual looseness is stated here rather than hidden.
 */
export function linkResolves(codeSources: readonly string[], name: string): boolean {
  const corpus = codeSources.join('\n');
  const [base, ...rest] = name.split('.');
  if (!base || !identifierExists(corpus, base)) return false;
  if (rest.length === 0) return true;
  const declaringFiles = codeSources.filter((s) => declaredRe(base).test(s));
  const scope = declaringFiles.length > 0 ? declaringFiles.join('\n') : corpus;
  return rest.every((member) => identifierExists(scope, member));
}

function walk(dir: string, out: string[]): void {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const abs = join(dir, entry.name);
    if (entry.isDirectory()) walk(abs, out);
    else if (entry.isFile() && /\.(ts|mjs|js)$/.test(entry.name)) out.push(abs);
  }
}

function main(): void {
  const all: string[] = [];
  walk('src', all);
  walk('scripts', all);
  // The one exclusion, printed rather than hidden: THIS file must carry forged dead
  // links (the mutation fixtures below and the defect's own name in the header) to prove
  // the detector can go red, so scanning it would flag its own counterexamples. Nothing
  // else is excluded, and a second file wanting in here should be treated as a dead link
  // hiding, not a fixture.
  const files = all.filter((f) => !f.endsWith('verify-doc-links.ts'));
  console.log(`  (excluded from the scan: this harness itself, which holds the forged fixtures)`);
  const sources = files.map((f) => [f, readFileSync(f, 'utf8')] as const);
  // Links are read from the FULL sources (they live in comments); resolution runs over
  // the comment-stripped code only.
  const codeSources = sources.map(([, s]) => stripComments(s));

  /* ── 1. Every link resolves ─────────────────────────────────────────────── */

  console.log('\n1. Every {@link} names something that exists');

  const links = sources.flatMap(([f, s]) => linksIn(f, s));
  check(
    'POSITIVE CONTROL: the scanner sees the tree’s links at all',
    links.length >= 150,
    `${String(links.length)} links in ${String(files.length)} files`,
  );

  const dead = links.filter((l) => !linkResolves(codeSources, l.name));
  check(
    'no link is dead',
    dead.length === 0,
    dead.map((l) => `${l.file}: {@link ${l.name}}`).join(' · ') || 'all resolve',
  );

  /* ── 2. Mutations: the detector can go red, both ways ───────────────────── */

  console.log('\n2. Mutations');

  const forged = linksIn('forged.ts', '/** see {@link NoSuchSymbolQx} and {@link Real.noSuchMemberQx} */');
  check(
    'MUTATION: a link to a symbol that exists nowhere goes red',
    forged.some((l) => !linkResolves([...codeSources, 'class Real {}'], l.name)),
  );
  check(
    'MUTATION: a dotted link with a dead member goes red even when its base resolves',
    !linkResolves(['class Real { good(): void {} }'], 'Real.noSuchMemberQx') &&
      linkResolves(['class Real { good(): void {} }'], 'Real.good'),
  );
  check(
    'MUTATION: a member declared only in an UNRELATED file no longer rescues a dotted link',
    !linkResolves(
      ['class Real { good(): void {} }', 'const other = { noSuchMemberQx: 1 };'],
      'Real.noSuchMemberQx',
    ),
  );
  check(
    'MUTATION: a comment mentioning the symbol does not resolve it',
    !linkResolves([stripComments('// the old orphanedSymbolQx: helper is gone')], 'orphanedSymbolQx'),
  );
  check(
    'POSITIVE CONTROL: declaration-, member-, annotation- and import-shaped targets resolve',
    linkResolves(['export function realFn(): void {}'], 'realFn') &&
      linkResolves(['interface X { someProp: number }'], 'someProp') &&
      linkResolves(['const obj = { someMethod(a: 1) {} }'], 'someMethod') &&
      linkResolves(['function f(x: AnnotatedType): void {}'], 'AnnotatedType') &&
      linkResolves(["import { ImportedThing } from './x.js';"], 'ImportedThing'),
  );
  check(
    'and the historical originLines example is really gone from the tree as a tag',
    !links.some((l) => l.name === 'originLines'),
  );

  console.log(
    failures === 0
      ? '\nAll doc-link checks passed.'
      : `\n${String(failures)} doc-link check(s) FAILED.`,
  );
  process.exit(failures === 0 ? 0 : 1);
}

main();
