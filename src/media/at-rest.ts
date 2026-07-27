/**
 * Encryption of original media at rest (CCB-S3-012 §2).
 *
 * WHY THIS EXISTS, in the operator's own framing: the platform must retain
 * material it is not permitted to look at. A hash match is a signal, not
 * evidence, and investigators need the unmodified file, so the correct response
 * to a match is preserve, not delete. That makes this a CUSTODY problem rather
 * than a detection problem, and material held in custody has to be unreadable to
 * anyone reading the disk.
 *
 * EVERY ORIGINAL IS ENCRYPTED, not only suspect ones. That is a security property,
 * not a convenience: if only quarantined files were encrypted, then a file's
 * encryption status would itself disclose that it is under suspicion, to anyone
 * with a directory listing. Uniform treatment leaks nothing.
 *
 * The published DERIVATIVE stays plaintext. It is public by definition, it has
 * already had its metadata stripped, and it is not the artefact under custody.
 * Encrypting it would buy nothing and would put a decrypt on the hot path of
 * every public image request.
 *
 * ── Why a DEDICATED secret, rather than deriving from SESSION_SECRET ──────────
 *
 * The briefing asks for the plugin-secret pattern (`src/plugins/secrets.ts`:
 * AES-256-GCM, scrypt-derived key, fixed non-secret salt) "unless there is a
 * reason not to". The algorithm and the envelope shape are reused exactly. The
 * SECRET is not, and the reason is the difference in what is lost:
 *
 *   * A plugin API key encrypted under `SESSION_SECRET` becomes undecryptable on
 *     rotation, and the operator RE-ENTERS it. Annoying, recoverable.
 *   * Media encrypted under `SESSION_SECRET` becomes undecryptable on rotation,
 *     and it is GONE. There is nothing to re-enter. That includes material held
 *     under legal custody, which is the one class of file that must survive.
 *
 * Rotating `SESSION_SECRET` is ordinary hygiene, it is already on the operator's
 * task list, and it is exactly the sort of thing done in a hurry after a scare.
 * Coupling the archive's survival to it would turn a routine security action into
 * an irreversible data-loss event. So media uses `MEDIA_SECRET`, and the two
 * rotate independently.
 *
 * ── Rotation, stated plainly ─────────────────────────────────────────────────
 *
 * Rotating `MEDIA_SECRET` makes every already-encrypted original undecryptable.
 * There is no key history and no re-wrap on read. Re-encryption under a new
 * secret would have to be a deliberate, offline migration holding both secrets;
 * that does not exist yet, so in practice `MEDIA_SECRET` is set once and kept.
 *
 * THE KEY MUST BE BACKED UP SEPARATELY FROM THE MEDIA. `deploy/backup.sh` copies
 * the database and the media tree; it does not copy `/etc/cinderella`. A restore
 * from those backups without the secret yields a directory of unreadable bytes.
 *
 * ── Mixed trees are supported on purpose ─────────────────────────────────────
 *
 * Files carry a magic header, so a reader can tell an encrypted file from a
 * plaintext one and handle both. That is what lets encryption be switched on for
 * an archive that already has plaintext media in it, and lets the backfill run
 * incrementally without a flag day.
 */

import { createReadStream } from 'node:fs';
import { open, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'node:crypto';

import { log } from '../log.js';

const ALGO = 'aes-256-gcm';
/** Identifies a Cinderella-encrypted media file. Non-secret by design. */
const MAGIC = Buffer.from('CINDM1', 'ascii');
const IV_LEN = 12;
const TAG_LEN = 16;
const HEADER_LEN = MAGIC.length + IV_LEN + TAG_LEN;
/** Fixed and non-secret: it separates this key from any other use of the secret. */
const SALT = 'cinderella/media-at-rest/v1';
/** Below this a passphrase is too weak to be worth the false assurance. */
const MIN_SECRET_LEN = 32;

let cachedKey: Buffer | undefined | null;

/**
 * The derived key, or null when media encryption is NOT CONFIGURED.
 *
 * "Not configured" is a legitimate operator choice and reads as such everywhere
 * (CCB-S3-023): originals are then stored as they always were. It is distinct
 * from "configured but failing", which is a fault and is surfaced.
 */
function key(): Buffer | null {
  if (cachedKey !== undefined) return cachedKey;
  const secret = process.env['MEDIA_SECRET'] ?? '';
  if (!secret) {
    cachedKey = null;
    return null;
  }
  if (secret.length < MIN_SECRET_LEN) {
    // Loud, and it does NOT silently fall back to storing in clear: an operator
    // who set MEDIA_SECRET believes media is encrypted.
    throw new Error(
      `MEDIA_SECRET must be at least ${MIN_SECRET_LEN} characters; media encryption refuses to run with a weak key.`,
    );
  }
  cachedKey = scryptSync(secret, SALT, 32);
  return cachedKey;
}

/** Test hook — forget the derived key after changing the env in a harness. */
export function resetMediaKey(): void {
  cachedKey = undefined;
}

/** Whether new originals will be written encrypted. */
export function mediaEncryptionEnabled(): boolean {
  return key() !== null;
}

/** Does this buffer start with the Cinderella media envelope? */
export function looksEncrypted(head: Buffer): boolean {
  return head.length >= MAGIC.length && head.subarray(0, MAGIC.length).equals(MAGIC);
}

/** Wraps plaintext bytes in the envelope: MAGIC | iv | tag | ciphertext. */
export function encryptBytes(plain: Buffer): Buffer {
  const k = key();
  if (!k) throw new Error('media encryption is not configured (MEDIA_SECRET is unset).');
  const iv = randomBytes(IV_LEN);
  const cipher = createCipheriv(ALGO, k, iv);
  const ct = Buffer.concat([cipher.update(plain), cipher.final()]);
  return Buffer.concat([MAGIC, iv, cipher.getAuthTag(), ct]);
}

/**
 * Unwraps an envelope. Throws on a wrong key or a tampered file rather than
 * returning something plausible: GCM authentication is the whole point, and a
 * silent fallback to raw bytes would hand a caller ciphertext to serve.
 */
export function decryptBytes(stored: Buffer): Buffer {
  const k = key();
  if (!k) {
    throw new Error(
      'An encrypted media file was read but MEDIA_SECRET is unset. The file cannot be decrypted.',
    );
  }
  if (!looksEncrypted(stored)) throw new Error('not a Cinderella media envelope');
  const iv = stored.subarray(MAGIC.length, MAGIC.length + IV_LEN);
  const tag = stored.subarray(MAGIC.length + IV_LEN, HEADER_LEN);
  const decipher = createDecipheriv(ALGO, k, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(stored.subarray(HEADER_LEN)), decipher.final()]);
}

/**
 * Reads a media file and returns its PLAINTEXT bytes, whatever it is on disk.
 *
 * This is the single reader every consumer of an original goes through, so no
 * caller has to know whether encryption is on, or whether this particular file
 * predates it. An encrypted file with no key throws, loudly: serving ciphertext
 * as if it were an image is precisely the masking the standing rule forbids.
 */
export async function readMediaFile(absPath: string): Promise<Buffer> {
  const raw = await readFile(absPath);
  if (!looksEncrypted(raw)) return raw;
  return decryptBytes(raw);
}

/**
 * Writes bytes as an original, encrypting when configured.
 *
 * Atomic: written to a sibling `.tmp` and renamed, so a crash mid-write cannot
 * leave a truncated file that `looksEncrypted` would happily try to decrypt.
 */
export async function writeMediaFile(absPath: string, plain: Buffer): Promise<void> {
  const payload = mediaEncryptionEnabled() ? encryptBytes(plain) : plain;
  const tmp = `${absPath}.tmp`;
  try {
    await writeFile(tmp, payload);
    await rename(tmp, absPath);
  } catch (err) {
    await unlink(tmp).catch(() => undefined);
    throw err;
  }
}

/**
 * Encrypts a file that is already on disk, in place and atomically.
 *
 * Used by the backfill and by the capture path, which MOVES a received file into
 * the media store before anything reads it. Returns false when the file is
 * already encrypted, so a re-run is a cheap no-op rather than double-wrapping
 * (the defect CCB-S3-008 taught).
 */
export async function encryptFileInPlace(absPath: string): Promise<boolean> {
  if (!mediaEncryptionEnabled()) return false;
  const raw = await readFile(absPath);
  if (looksEncrypted(raw)) return false;
  const tmp = `${absPath}.tmp`;
  try {
    await writeFile(tmp, encryptBytes(raw));
    await rename(tmp, absPath);
    return true;
  } catch (err) {
    await unlink(tmp).catch(() => undefined);
    throw err;
  }
}

/**
 * Whether the configured key can actually read this file. Used by the boot check
 * so "MEDIA_SECRET was rotated" surfaces as a fault instead of appearing later as
 * a stream full of broken images.
 */
export async function canDecrypt(absPath: string): Promise<boolean> {
  try {
    const raw = await readFile(absPath);
    if (!looksEncrypted(raw)) return true;
    decryptBytes(raw);
    return true;
  } catch {
    return false;
  }
}

/**
 * The PLAINTEXT size of a media file, whatever it is on disk.
 *
 * This exists because of a specific bug it would otherwise cause. The public
 * media route answers byte-range requests using `stat().size`, and AES-GCM
 * ciphertext is exactly as long as its plaintext, so an encrypted file's on-disk
 * size is plaintext + 34 (magic + iv + tag). Serving `Content-Length` or
 * `Content-Range` from the raw size would overstate every video by 34 bytes and
 * put every seek off by the same amount.
 */
export async function mediaPlaintextSize(absPath: string): Promise<number> {
  const handle = await open(absPath, 'r');
  try {
    const head = Buffer.alloc(MAGIC.length);
    await handle.read(head, 0, MAGIC.length, 0);
    const { size } = await handle.stat();
    return looksEncrypted(head) ? Math.max(0, size - HEADER_LEN) : size;
  } finally {
    await handle.close();
  }
}

/** Is the file on disk wrapped in the envelope? Reads only the magic. */
export async function isEncryptedFile(absPath: string): Promise<boolean> {
  const handle = await open(absPath, 'r');
  try {
    const head = Buffer.alloc(MAGIC.length);
    await handle.read(head, 0, MAGIC.length, 0);
    return looksEncrypted(head);
  } finally {
    await handle.close();
  }
}

/**
 * Bytes to serve for a media file, optionally a byte range.
 *
 * A PLAINTEXT file still streams, exactly as before: no regression in memory use
 * for the archive as it stands today, and none for the derivatives that serve most
 * public traffic.
 *
 * An ENCRYPTED file is decrypted into memory and sliced. That is not laziness:
 * AES-GCM authenticates the whole file, so there is no way to verify a fragment
 * without having decrypted everything before it, and serving unverified plaintext
 * would throw away the integrity guarantee that makes custody meaningful. Buffering
 * is the honest cost of authenticated encryption at rest. The producers in this
 * codebase already buffer whole files (sharp does, in `stripToDerivative`), so this
 * introduces no new ceiling.
 */
export async function readMediaRange(
  absPath: string,
  start?: number,
  end?: number,
): Promise<Buffer | ReturnType<typeof createReadStream>> {
  if (!(await isEncryptedFile(absPath))) {
    return start === undefined || end === undefined
      ? createReadStream(absPath)
      : createReadStream(absPath, { start, end });
  }
  const plain = await readMediaFile(absPath);
  if (start === undefined || end === undefined) return plain;
  return plain.subarray(start, end + 1);
}

/** One-line description for the admin, never the key itself. */
export function describeMediaEncryption(): { configured: boolean; algo: string } {
  let configured = false;
  try {
    configured = mediaEncryptionEnabled();
  } catch (err) {
    // A weak MEDIA_SECRET throws. Report it rather than rendering "off", which
    // would read as a choice when it is a misconfiguration.
    log.error(`Media encryption is misconfigured: ${err instanceof Error ? err.message : String(err)}`);
  }
  return { configured, algo: ALGO };
}
