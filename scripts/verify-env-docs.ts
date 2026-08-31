/**
 * Every environment variable documented in `.env.example` is read by the code
 * (CCB-S5-064, D-262; proposed by CCB-S5-063's stage 6, approved as framed).
 *
 * ── THE DEFECT CLASS THIS CATCHES ────────────────────────────────────────────
 *
 * `BOT_RUNTIME_HOSTING` was documented as a rollback lever for two seasons after D-155
 * removed the code that read it; it was found by a reader in a runbook, not by a check.
 * A documented variable nobody reads is a lever that silently does nothing, which is the
 * dead-switch dishonesty the backlog names.
 *
 * ── WHAT COUNTS AS DOCUMENTED, AND WHAT COUNTS AS READ ───────────────────────
 *
 * Documented: an ASSIGNMENT-shaped line in `.env.example` (`VAR=` or `# VAR=`), because
 * the file's PROSE legitimately names variables that are not this application's settings
 * (`BACKUP_PASSPHRASE_FILE` belongs to deploy/backup.sh, and `BOT_RUNTIME_HOSTING` is
 * documented as removed) - a bare-word match would turn both red for being mentioned.
 *
 * Read: a `process.env` access naming the variable, or the variable's name passed as the
 * string argument of one of `config.ts`'s reader helpers (`required` / `optional` /
 * `optionalBoolean` / `optionalInteger`), anywhere under `src/`. Under src/ and not only
 * config.ts, stated deliberately: `MEDIA_SECRET` is read in `src/media/at-rest.ts` on
 * purpose (the at-rest layer owns its key), and a check scoped to config.ts would have
 * been red on day one for the wrong reason.
 *
 * A comment MENTIONING a variable is not a read: the shapes above are code shapes, and
 * `src/index.ts` mentioning BOT_RUNTIME_HOSTING in a history comment stays a mention.
 *
 * Both directions are looked at, one asserted: an undocumented-but-read variable is
 * PRINTED as a note rather than failed, because reading more than is documented is a
 * documentation gap, not a lie a reader can act on. (As of this briefing the note prints
 * empty: the seven undocumented reads were documented in the same commit.)
 *
 * Mutation-proven in section 3: a synthetic doc line for a variable nothing reads goes
 * red, and the read-detector is proven able to see each accepted shape.
 *
 *   npx tsx scripts/verify-env-docs.ts
 */

import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

let failures = 0;
function check(label: string, ok: boolean, detail = ''): void {
  if (!ok) failures++;
  console.log(`  [${ok ? 'PASS' : 'FAIL'}] ${label}${detail ? `: ${detail}` : ''}`);
}

/** Assignment-shaped documented variables, commented or live. */
export function documentedVars(envExample: string): string[] {
  const out = new Set<string>();
  for (const line of envExample.split('\n')) {
    const m = /^#?\s*([A-Z][A-Z0-9_]*)=/.exec(line);
    if (m?.[1]) out.add(m[1]);
  }
  return [...out].sort();
}

/**
 * Comments removed before the read-shapes run, so a comment QUOTING a read shape
 * (`// the old process.env['X'] read is gone`) cannot keep a dead variable green - the
 * reviewed hole. Naive stripping errs toward stricter, the right direction here.
 */
export function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/[^\n]*/g, ' ');
}

/** Whether one CODE corpus (comments stripped) reads one variable, by the accepted shapes. */
export function isRead(corpus: string, name: string): boolean {
  const env = new RegExp(
    `process\\.env(?:\\.${name}\\b|\\[['"\`]${name}['"\`]\\])`,
  );
  const helper = new RegExp(
    `\\b(?:required|optional|optionalBoolean|optionalInteger)\\(\\s*['"]${name}['"]`,
  );
  return env.test(corpus) || helper.test(corpus);
}

function walk(dir: string, out: string[]): void {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const abs = join(dir, entry.name);
    if (entry.isDirectory()) walk(abs, out);
    else if (entry.isFile() && entry.name.endsWith('.ts')) out.push(abs);
  }
}

function main(): void {
  const envExample = readFileSync('.env.example', 'utf8');
  const files: string[] = [];
  walk('src', files);
  const corpus = stripComments(files.map((f) => readFileSync(f, 'utf8')).join('\n'));

  /* ── 1. Every documented variable is read ───────────────────────────────── */

  console.log('\n1. Every variable .env.example documents is read somewhere under src/');

  const documented = documentedVars(envExample);
  check('the extractor sees the documented set at all', documented.length >= 20, `${String(documented.length)} variables`);

  const unread = documented.filter((name) => !isRead(corpus, name));
  for (const name of documented) {
    console.log(`     ${name.padEnd(24)} ${isRead(corpus, name) ? 'read' : 'NOT READ'}`);
  }
  check('no documented variable is unread', unread.length === 0, unread.join(', ') || 'all read');

  // Prose mentions must NOT count as documented, or the two legitimate mentions go red.
  check(
    'prose mentions are not documented variables',
    !documented.includes('BACKUP_PASSPHRASE_FILE') && !documented.includes('BOT_RUNTIME_HOSTING'),
  );

  /* ── 2. The other direction, printed rather than failed ─────────────────── */

  console.log('\n2. Variables config.ts reads that .env.example does not document (a note)');

  const configSource = readFileSync(join('src', 'config.ts'), 'utf8');
  const readNames = new Set<string>();
  for (const m of configSource.matchAll(
    /process\.env\[['"]([A-Z][A-Z0-9_]*)['"]\]|\b(?:required|optional|optionalBoolean|optionalInteger)\(\s*['"]([A-Z][A-Z0-9_]*)['"]/g,
  )) {
    const name = m[1] ?? m[2];
    if (name) readNames.add(name);
  }
  const undocumented = [...readNames].filter((n) => !documented.includes(n)).sort();
  console.log(
    undocumented.length === 0
      ? '     none - everything config.ts reads is documented'
      : `     ${undocumented.join(', ')}`,
  );

  /* ── 3. Mutations: both halves can go red ───────────────────────────────── */

  console.log('\n3. Mutations');

  const forged = `${envExample}\nSOME_FORGOTTEN_LEVER=true\n`;
  const forgedUnread = documentedVars(forged).filter((n) => !isRead(corpus, n));
  check(
    'MUTATION: a documented variable nobody reads goes red',
    forgedUnread.includes('SOME_FORGOTTEN_LEVER'),
  );
  check(
    'POSITIVE CONTROL: each accepted read shape is recognised',
    isRead(`const x = process.env['A_VAR'];`, 'A_VAR') &&
      isRead(`const x = process.env.A_VAR;`, 'A_VAR') &&
      isRead(`const x = required('A_VAR');`, 'A_VAR') &&
      isRead(`const x = optionalInteger('A_VAR', 1, 2, 3);`, 'A_VAR'),
  );
  check(
    'and a comment mention is NOT a read',
    !isRead(`// the old A_VAR lever is gone`, 'A_VAR'),
  );
  check(
    'MUTATION: even a comment QUOTING a read shape is not a read once comments are stripped',
    !isRead(stripComments(`// the old process.env['A_VAR'] read is gone`), 'A_VAR') &&
      isRead(stripComments(`const x = process.env['A_VAR']; // live`), 'A_VAR'),
  );

  console.log(
    failures === 0
      ? '\nAll env-docs checks passed.'
      : `\n${String(failures)} env-docs check(s) FAILED.`,
  );
  process.exit(failures === 0 ? 0 : 1);
}

main();
