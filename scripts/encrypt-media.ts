/**
 * Backfill: encrypt originals that predate encryption at rest (CCB-S3-012 §2).
 *
 *   npx tsx scripts/encrypt-media.ts --dry-run
 *   npx tsx scripts/encrypt-media.ts
 *
 * Encryption is switched on by setting `MEDIA_SECRET`; from that moment NEW
 * originals are written encrypted. Files already on disk are not, and readers
 * handle both because every file carries a magic header. This walks the media
 * store and closes that gap.
 *
 * SAFE TO RE-RUN. An already-encrypted file is detected by its header and skipped,
 * so a partial run simply continues. Each file is rewritten atomically through a
 * sibling `.tmp` and a rename, so an interruption leaves either the old plaintext
 * or the new ciphertext, never a half-written file.
 *
 * IT DOES NOT TOUCH DERIVATIVES. Everything under `derived/` is the stripped,
 * public artefact and stays plaintext by design; encrypting it would put a decrypt
 * on the hot path of every public image request and protect nothing.
 *
 * MUST RUN AS THE SERVICE USER. Rewriting these files as root is how CCB-S3-011
 * Addendum A happened: a remediation script left a directory the service user
 * could not write, and every new photograph silently 404'd afterwards.
 */

import { readdir, stat } from 'node:fs/promises';
import { join, resolve, sep } from 'node:path';

import { loadConfig } from '../src/config.js';
import { encryptFileInPlace, isEncryptedFile, mediaEncryptionEnabled } from '../src/media/at-rest.js';

const dryRun = process.argv.includes('--dry-run');

async function walk(dir: string, out: string[] = []): Promise<string[]> {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries) {
    const abs = join(dir, e.name);
    if (e.isDirectory()) {
      // `derived/` holds the public artefacts and stays plaintext.
      if (e.name === 'derived') continue;
      await walk(abs, out);
    } else if (e.isFile() && !e.name.endsWith('.tmp')) {
      out.push(abs);
    }
  }
  return out;
}

async function main(): Promise<void> {
  const cfg = loadConfig();
  const root = resolve(cfg.mediaRoot);

  if (!mediaEncryptionEnabled()) {
    console.error(
      'MEDIA_SECRET is not set, so there is nothing to encrypt WITH. Set it (32+ characters), back ' +
        'it up somewhere other than the media backups, and run this again.',
    );
    process.exitCode = 1;
    return;
  }

  const files = await walk(root);
  let encrypted = 0;
  let already = 0;
  let failed = 0;
  let bytes = 0;

  for (const abs of files) {
    // Belt and braces on a script that rewrites files in place.
    if (abs !== root && !abs.startsWith(root + sep)) continue;
    try {
      if (await isEncryptedFile(abs)) {
        already += 1;
        continue;
      }
      const info = await stat(abs);
      if (dryRun) {
        encrypted += 1;
        bytes += info.size;
        continue;
      }
      if (await encryptFileInPlace(abs)) {
        encrypted += 1;
        bytes += info.size;
      } else {
        already += 1;
      }
    } catch (err) {
      failed += 1;
      // The path is printed for the operator on their own console. It is not
      // logged to the application log, where a member filename does not belong.
      console.error(`FAILED ${abs}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  console.log(
    `${dryRun ? '[dry run] ' : ''}originals: ${String(encrypted)} ${
      dryRun ? 'would be encrypted' : 'encrypted'
    }, ${String(already)} already encrypted, ${String(failed)} failed ` +
      `(${(bytes / 1024 / 1024).toFixed(1)} MB).`,
  );
  if (failed > 0) process.exitCode = 1;
}

main().catch((err: unknown) => {
  console.error(err);
  process.exitCode = 1;
});
