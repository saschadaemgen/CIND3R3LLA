/**
 * Enforcement: nothing outside the adapter may import the SDK (CCB-S3-020 §4).
 *
 * THIS IS THE DURABLE PART OF THE BRIEFING, not the refactor. A seam that is
 * merely tidy erodes within a month, exactly as the send path diverged before
 * CCB-S3-003 had to unify it. A refactor is a state; a check is a property.
 *
 * Two assertions:
 *
 *  1. No file outside `src/bot/` (the SimpleX adapter) imports `simplex-chat` or
 *     `@simplex-chat/types`.
 *  2. The check itself actually fails when a violation is introduced. A guard
 *     nobody has seen fail is a guard nobody knows works, so this synthesises a
 *     violating file in a temp directory and asserts the scanner rejects it.
 *
 *   npx tsx scripts/verify-adapter-seam.ts
 */

import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, relative, sep } from 'node:path';

/** The ONE directory allowed to touch the SDK: the SimpleX adapter. */
const ADAPTER_DIRS = [join('src', 'bot')];

/** Harnesses may construct SDK-shaped fixtures; they are not shipped code. */
const EXEMPT_DIRS = [join('scripts')];

const SDK_IMPORT = /from\s+['"](?:simplex-chat|@simplex-chat\/types)['"]/;

let failures = 0;
function check(label: string, ok: boolean, detail = ''): void {
  if (!ok) failures++;
  console.log(`  [${ok ? 'PASS' : 'FAIL'}] ${label}${detail ? ` - ${detail}` : ''}`);
}

async function walk(dir: string, out: string[] = []): Promise<string[]> {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries) {
    const p = join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name === 'node_modules' || e.name === 'dist') continue;
      await walk(p, out);
    } else if (e.name.endsWith('.ts')) {
      out.push(p);
    }
  }
  return out;
}

function isAllowed(file: string): boolean {
  const rel = relative(process.cwd(), file);
  return [...ADAPTER_DIRS, ...EXEMPT_DIRS].some(
    (d) => rel === d || rel.startsWith(d + sep),
  );
}

/** Every file that imports the SDK from outside the adapter. */
export async function findSeamViolations(roots: string[]): Promise<string[]> {
  const violations: string[] = [];
  for (const root of roots) {
    for (const file of await walk(root)) {
      if (isAllowed(file)) continue;
      const src = await readFile(file, 'utf8');
      if (SDK_IMPORT.test(src)) violations.push(relative(process.cwd(), file));
    }
  }
  return violations;
}

async function main(): Promise<void> {
  console.log('\n1. No SDK import outside the adapter');
  const violations = await findSeamViolations(['src']);
  check(
    'application code does not import simplex-chat',
    violations.length === 0,
    violations.length > 0 ? violations.join(', ') : '',
  );

  console.log('\n2. The check fails when a violation is introduced');
  // A guard that has never been seen to fail is a guard nobody knows works.
  const tmp = await mkdtemp(join(tmpdir(), 'cinderella-seam-'));
  try {
    const offender = join(tmp, 'offender.ts');
    await writeFile(offender, "import type { T } from '@simplex-chat/types';\nexport const x: T.User | null = null;\n");
    const found = await findSeamViolations([tmp]);
    check(
      'a synthesised direct import IS detected',
      found.length === 1,
      `found ${String(found.length)}`,
    );
    const clean = join(tmp, 'clean.ts');
    await writeFile(clean, "export const y = 1;\n");
    const stillOne = await findSeamViolations([tmp]);
    check('and a clean file beside it is not flagged', stillOne.length === 1);
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }

  console.log(
    `\n${failures === 0 ? 'ALL PASSED' : `${String(failures)} FAILURE(S)`} - adapter seam.`,
  );
  if (failures > 0) process.exitCode = 1;
}

main().catch((err: unknown) => {
  console.error(err);
  process.exitCode = 1;
});
