/**
 * Boot-time confirmation that the media key still reads the media (CCB-S3-012).
 *
 * A rotated or mistyped `MEDIA_SECRET` does not fail loudly on its own: writes
 * keep succeeding under the new key, and only reads of OLDER files break. Without
 * this check the first symptom would be a public stream of broken images, days
 * later, which is exactly the shape of fault CCB-S3-011 Addendum A was.
 *
 * It samples rather than sweeps: one readable original is enough to prove the key
 * is right, and reading every file at boot would decrypt the whole archive into
 * memory for no additional information.
 */

import { join } from 'node:path';

import type { Queryable } from '../db/pool.js';
import { canDecrypt, isEncryptedFile } from './at-rest.js';

export interface AtRestCheck {
  /** How many encrypted originals were sampled. 0 means there is nothing to prove. */
  checked: number;
  /** Whether the sampled file decrypted with the configured key. */
  readable: boolean;
}

export async function sampleEncryptedOriginal(
  db: Queryable,
  mediaRoot: string,
  sample = 5,
): Promise<AtRestCheck> {
  const { rows } = await db.query<{ media_path: string }>(
    `SELECT media_path FROM messages
     WHERE media_path IS NOT NULL
     ORDER BY id DESC
     LIMIT $1`,
    [sample],
  );
  for (const r of rows) {
    const abs = join(mediaRoot, r.media_path);
    try {
      if (!(await isEncryptedFile(abs))) continue;
      return { checked: 1, readable: await canDecrypt(abs) };
    } catch {
      // Unreadable for a non-crypto reason (moved, quarantined, permissions).
      // Not this check's business; the media check below reports those.
      continue;
    }
  }
  return { checked: 0, readable: true };
}
