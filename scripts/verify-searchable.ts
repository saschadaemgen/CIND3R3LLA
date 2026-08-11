/**
 * Every tracked source and document is searchable (CCB-S5-009).
 *
 *   npx tsx scripts/verify-searchable.ts
 *
 * ── THE DEFECT, WHICH HAS NOW HAPPENED THREE TIMES ──────────────────────────
 *
 * A single NUL byte anywhere in a file makes `grep` and `ripgrep` classify the whole file
 * as BINARY and skip it. Not warn: skip, and report success. Every content search in this
 * repository is then silently blind to that file, including the agent's own tooling and
 * anything a maintainer types.
 *
 * `scripts/verify-personality.ts` and `scripts/verify-recital.ts` each carried one, written
 * as a `?? '<NUL>'` sentinel that was meant to be the escape and was pasted as the byte. The
 * consequence was found the hard way: a stale import in one of them survived a repository-wide
 * grep and only surfaced when the harness crashed. The third was written into
 * `seasons/CCB-REGISTER.md` by the commit that reported the first two, which is the reason
 * this check exists rather than a third one-off fix.
 *
 * ── WHY THIS IS NOT PART OF verify:no-dashes ────────────────────────────────
 *
 * That check reads files with Node, which does not care about NUL bytes, so it was never
 * blind and is not the thing at risk. What is at risk is every SEARCH: the standing rule in
 * CLAUDE.md that a check's scope must be reviewed when a tree is added (D-105) assumes the
 * person reviewing can find the tree. A file the search cannot see is worse than a check
 * that does not cover it, because nothing anywhere reports it.
 *
 * The scan is deliberately wider than the source tree. The register, the six living
 * documents and the migrations are all read by search far more often than they are executed.
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

const ROOT = process.cwd();

/** Never walked: not ours, not tracked, or legitimately binary. */
const SKIP_DIRS = new Set([
  'node_modules',
  '.git',
  'dist',
  'public',
  'state',
  'media',
  '.claude',
  'coverage',
]);

/** Text we expect a human or a search to read. Binary assets are not in scope. */
const EXTENSIONS = ['.ts', '.js', '.mjs', '.cjs', '.json', '.sql', '.md', '.css', '.html', '.yml', '.yaml'];

let failures = 0;

function check(label: string, ok: boolean, detail = ''): void {
  if (!ok) failures++;
  console.log(`  [${ok ? 'PASS' : 'FAIL'}] ${label}${detail ? `: ${detail}` : ''}`);
}

function walk(dir: string, out: string[]): string[] {
  for (const entry of readdirSync(dir)) {
    if (SKIP_DIRS.has(entry)) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (EXTENSIONS.some((ext) => entry.endsWith(ext))) out.push(full);
  }
  return out;
}

/**
 * The same rule the tools use: a NUL in the file means binary, means skipped.
 *
 * GNU grep and ripgrep both decide on the first block rather than the whole file, so a NUL
 * late in a large file can be missed by them and still caught here. That asymmetry is the
 * right way round: this check is stricter than the tools it protects.
 */
function nulOffset(bytes: Buffer): number {
  return bytes.indexOf(0);
}

/**
 * The OTHER control bytes, which do not blind grep but do something quieter and worse
 * (CCB-S5-025).
 *
 * A NUL makes a file invisible to search, which is loud once you know to look. A U+0008
 * BACKSPACE written into a regex where \b was meant makes the pattern match NOTHING, and a
 * detector that matches nothing passes forever. Three had already reached this repository:
 * `DESTRUCTION_WORDS` and `DESTRUCTION_WORDS_DE` in `verify:interaction`, which are the
 * CCB-S3-031 guarantee that consent copy never claims destruction over retained content, and
 * `MUTE_THREAT` in `verify:moderation-live`, whose own comment says a match "is worth failing
 * over". None of them could ever match. The decision log records the same byte doing the same
 * thing once before, in CCB-S4-015.
 *
 * It happens because a shell heredoc or a JavaScript string literal turns the two characters
 *  and b into one byte, so the source LOOKS right in a terminal that renders 0x08 as nothing
 * at all. Cheap to scan for, invisible otherwise.
 *
 * TAB, newline and carriage return are legitimate; everything else below 0x20 is not.
 */
function controlOffset(bytes: Buffer): number {
  for (let i = 0; i < bytes.length; i++) {
    const c = bytes[i] as number;
    if (c === 9 || c === 10 || c === 13) continue;
    if (c < 32) return i;
  }
  return -1;
}

function main(): void {
  console.log('\n1. No tracked text file is invisible to search');

  const files = walk(ROOT, []);
  check('the scan found a plausible number of files', files.length > 100, `${files.length} files`);

  const offenders: { path: string; at: number; context: string }[] = [];
  for (const file of files) {
    const bytes = readFileSync(file);
    const at = nulOffset(bytes);
    if (at < 0) continue;
    offenders.push({
      path: relative(ROOT, file).split(sep).join('/'),
      at,
      // The surrounding text, so the report says where to look rather than only that
      // something is wrong. Sanitised, or printing it would break the terminal too.
      context: bytes
        .subarray(Math.max(0, at - 60), at + 20)
        .toString('utf8')
        .replace(/\0/g, '<NUL>')
        .replace(/\s+/g, ' '),
    });
  }

  check(
    'no file contains a NUL byte, which would make every grep skip it silently',
    offenders.length === 0,
    offenders.length === 0 ? `${files.length} scanned` : `${offenders.length} offender(s)`,
  );

  for (const o of offenders) {
    console.log(`         ${o.path} at byte ${o.at}: ...${o.context}...`);
    console.log(`         Write the escape as source text instead of pasting the byte.`);
  }

  /* ── Control bytes that do not blind grep, but kill a pattern ───────────── */

  console.log('\n1b. No tracked text file carries a stray control byte');

  const control: { path: string; at: number; byte: number; context: string }[] = [];
  for (const file of files) {
    const bytes = readFileSync(file);
    const at = controlOffset(bytes);
    if (at < 0) continue;
    control.push({
      path: relative(ROOT, file).split(sep).join('/'),
      at,
      byte: bytes[at] as number,
      context: bytes
        .subarray(Math.max(0, at - 60), at + 20)
        .toString('utf8')
        .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '<CTRL>')
        .replace(/s+/g, ' '),
    });
  }
  check(
    'no file carries a control byte, which silently kills the pattern it lands in',
    control.length === 0,
    control.length === 0 ? `${files.length} scanned` : `${control.length} offender(s)`,
  );
  for (const o of control) {
    console.log(
      `         ${o.path} at byte ${String(o.at)} (0x${o.byte.toString(16)}): ...${o.context}...`,
    );
    console.log('         Write the escape as source text instead of pasting the byte.');
  }

  /* ── The mutation, run every time rather than described ──────────────────── */

  console.log('\n2. The check can go red');

  // A file the scan WOULD have accepted, proven to be rejected once it carries the byte.
  // Held in memory: writing a NUL file to disk to prove the point would leave the repository
  // in exactly the state this check exists to prevent if the process died here.
  const clean = Buffer.from('const answer = 42;\n', 'utf8');
  const dirty = Buffer.concat([clean, Buffer.from([0]), Buffer.from('// tail\n', 'utf8')]);
  check('a clean file is accepted', nulOffset(clean) < 0);
  check('and the same file with one NUL byte is not', nulOffset(dirty) >= 0, `at ${nulOffset(dirty)}`);

  // The same proof for the quieter byte, and a demonstration of what it does to a pattern:
  // a regex holding U+0008 where a word boundary was meant matches nothing at all.
  const withBackspace = Buffer.concat([
    Buffer.from('const re = /', 'utf8'),
    Buffer.from([8]),
    Buffer.from('(gone|erased)/i;\n', 'utf8'),
  ]);
  check('a clean file carries no control byte', controlOffset(clean) < 0);
  check(
    'and one backspace byte is caught, though no NUL scan would see it',
    controlOffset(withBackspace) >= 0 && nulOffset(withBackspace) < 0,
  );
  check(
    '  and that is not pedantry: the pattern it lands in matches nothing',
    !new RegExp(String.fromCharCode(8) + '(gone|erased)', 'i').test('it is all gone'),
  );
  check(
    '  while the intended one matches',
    new RegExp(String.fromCharCode(92) + 'b(gone|erased)', 'i').test('it is all gone'),
  );

  // Tabs and newlines are legitimate and must not be reported, or the check would fire on
  // every file in the repository and be switched off within a day.
  check(
    'tabs and newlines are not control bytes for this purpose',
    controlOffset(Buffer.from('a\tb\r\nc\n', 'utf8')) < 0,
  );

  console.log(
    failures === 0
      ? `\nAll ${files.length} tracked text files are searchable.`
      : `\n${failures} CHECK(S) FAILED.`,
  );
  if (failures > 0) process.exitCode = 1;
}

main();
