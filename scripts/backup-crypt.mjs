#!/usr/bin/env node
/**
 * Backup archive encryption (CCB-S4-016, D-121). AES-256-GCM with an scrypt KDF.
 *
 *   node scripts/backup-crypt.mjs encrypt <in> <out> <passphrase-file>
 *   node scripts/backup-crypt.mjs decrypt <in> <out> <passphrase-file>
 *
 * WHY THIS EXISTS RATHER THAN `age -p`. The scheme decided was symmetric and
 * quantum-resistant: a 256-bit cipher keeps a ~128-bit margin under Grover, which is why
 * an asymmetric layer was rejected. `age` implements exactly that in passphrase mode, but
 * `age -p` READS THE PASSPHRASE FROM THE TTY BY DESIGN and cannot be driven from a
 * systemd timer: piping the passphrase, setting an environment variable and redirecting
 * stdin all hang. `age -i` is scriptable but is X25519, and a backup is the canonical
 * harvest-now-decrypt-later target, so asymmetric key agreement would quietly give up the
 * property the whole decision was made for.
 *
 * So the format is built here, from Node's own primitives, and it avoids every trap that
 * made raw `openssl enc` a bad idea: GCM is authenticated so a wrong key FAILS rather
 * than producing garbage, the IV is random per file and stored, and there is no padding
 * oracle because GCM is a stream mode. This is the same construction the project already
 * trusts for media at rest (D-075).
 *
 * STREAMING ON PURPOSE. A media archive can be gigabytes; nothing here holds a whole
 * archive in memory.
 *
 * Layout: MAGIC(8) VERSION(1) N(4) r(4) p(4) SALT(32) IV(12) | ciphertext | TAG(16)
 * The tag trails because GCM only produces it at the end. Decryption reads it from the
 * last 16 bytes and streams everything between.
 */

import { createReadStream, createWriteStream } from 'node:fs';
import { open, readFile, rename, rm, stat } from 'node:fs/promises';
import { createCipheriv, createDecipheriv, randomBytes, scrypt } from 'node:crypto';
import { pipeline } from 'node:stream/promises';

const MAGIC = Buffer.from('CINDBAK1', 'ascii');
const VERSION = 1;
const SALT_LEN = 32;
const IV_LEN = 12;
const TAG_LEN = 16;
const HEADER_LEN = MAGIC.length + 1 + 4 + 4 + 4 + SALT_LEN + IV_LEN; // 65

// N=2^15 with r=8 costs 128*N*r = 32 MiB per derivation. Deliberate: it is paid once per
// archive, and it is what makes a guess against the passphrase expensive.
const KDF = { N: 1 << 15, r: 8, p: 1 };
const MAXMEM = 128 * KDF.N * KDF.r * 2;

function die(message) {
  process.stderr.write(`backup-crypt: ${message}\n`);
  process.exit(1);
}

async function readPassphrase(file) {
  let raw;
  try {
    raw = await readFile(file, 'utf8');
  } catch (err) {
    die(`cannot read the passphrase file ${file} (${err.code ?? err.message}).`);
  }
  // A trailing newline from an editor must not silently change the key.
  const pass = raw.replace(/\r?\n$/, '');
  if (pass.trim() === '') die(`the passphrase file ${file} is empty.`);
  return pass;
}

function deriveKey(pass, salt, params) {
  return new Promise((resolve, reject) => {
    scrypt(pass, salt, 32, { N: params.N, r: params.r, p: params.p, maxmem: MAXMEM }, (err, key) =>
      err ? reject(err) : resolve(key),
    );
  });
}

async function encrypt(inPath, outPath, passFile) {
  const pass = await readPassphrase(passFile);
  const salt = randomBytes(SALT_LEN);
  const iv = randomBytes(IV_LEN);
  const key = await deriveKey(pass, salt, KDF);

  const header = Buffer.alloc(HEADER_LEN);
  let o = 0;
  MAGIC.copy(header, o);
  o += MAGIC.length;
  header.writeUInt8(VERSION, o);
  o += 1;
  header.writeUInt32BE(KDF.N, o);
  o += 4;
  header.writeUInt32BE(KDF.r, o);
  o += 4;
  header.writeUInt32BE(KDF.p, o);
  o += 4;
  salt.copy(header, o);
  o += SALT_LEN;
  iv.copy(header, o);

  // Written beside the target and renamed only once the tag is on disk, so a crash or a
  // full disk can never leave something at `outPath` that looks like a finished archive.
  const tmp = `${outPath}.part`;
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  try {
    const out = createWriteStream(tmp);
    out.write(header);
    await pipeline(createReadStream(inPath), cipher, out, { end: false });
    // The tag is only available once the cipher has flushed.
    await new Promise((resolve, reject) => {
      out.end(cipher.getAuthTag(), (err) => (err ? reject(err) : resolve()));
    });
  } catch (err) {
    await rm(tmp, { force: true });
    die(`could not encrypt ${inPath}: ${err.message}`);
  }
  await rename(tmp, outPath);
}

async function decrypt(inPath, outPath, passFile) {
  const pass = await readPassphrase(passFile);
  const { size } = await stat(inPath);
  if (size < HEADER_LEN + TAG_LEN) die(`${inPath} is too small to be an encrypted archive.`);

  const fh = await open(inPath, 'r');
  let header, tag;
  try {
    header = Buffer.alloc(HEADER_LEN);
    await fh.read(header, 0, HEADER_LEN, 0);
    tag = Buffer.alloc(TAG_LEN);
    await fh.read(tag, 0, TAG_LEN, size - TAG_LEN);
  } finally {
    await fh.close();
  }

  if (!header.subarray(0, MAGIC.length).equals(MAGIC)) {
    die(`${inPath} is not a Cinderella encrypted archive (bad magic).`);
  }
  let o = MAGIC.length;
  const version = header.readUInt8(o);
  o += 1;
  if (version !== VERSION) die(`${inPath} uses format version ${version}, this build reads ${VERSION}.`);
  const params = {
    N: header.readUInt32BE(o),
    r: header.readUInt32BE(o + 4),
    p: header.readUInt32BE(o + 8),
  };
  o += 12;
  const salt = header.subarray(o, o + SALT_LEN);
  o += SALT_LEN;
  const iv = header.subarray(o, o + IV_LEN);

  const key = await deriveKey(pass, salt, params);
  const decipher = createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);

  // THE OUTPUT IS STAGED AND ONLY RENAMED ONCE AUTHENTICATION HAS PASSED.
  //
  // This is not tidiness, it is the whole point of using an AEAD. GCM verifies at the
  // very end, so a wrong passphrase still streams unverified plaintext up to that moment.
  // Writing straight to `outPath` would leave that garbage sitting at the destination
  // after a failed decrypt, looking like a restored file. Staging means a failure leaves
  // NOTHING at the destination, which is what "fails cleanly" has to mean here.
  const tmp = `${outPath}.part`;
  try {
    await pipeline(
      createReadStream(inPath, { start: HEADER_LEN, end: size - TAG_LEN - 1 }),
      decipher,
      createWriteStream(tmp),
    );
  } catch (err) {
    await rm(tmp, { force: true });
    // The wrong passphrase lands here, as an authentication failure rather than as
    // plausible-looking garbage. That distinction is the reason for an AEAD.
    die(
      `could not decrypt ${inPath}: ${err.message}. ` +
        'The usual cause is the wrong passphrase; the archive may also be truncated or corrupt.',
    );
  }
  await rename(tmp, outPath);
}

const [, , mode, inPath, outPath, passFile] = process.argv;
if (!mode || !inPath || !outPath || !passFile) {
  die('usage: backup-crypt.mjs <encrypt|decrypt> <in> <out> <passphrase-file>');
}
if (mode === 'encrypt') await encrypt(inPath, outPath, passFile);
else if (mode === 'decrypt') await decrypt(inPath, outPath, passFile);
else die(`unknown mode "${mode}" (expected encrypt or decrypt).`);
