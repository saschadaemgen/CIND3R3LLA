/**
 * The fixture screening provider (CCB-S3-012 §3).
 *
 * Exists so the WHOLE pipeline — screen, match, quarantine, segregate, alert,
 * audit, resist deletion — can be exercised end to end without any real material
 * ever being involved, and without contacting anything.
 *
 * It matches on the SHA-256 of benign bytes. Detection services publish harmless
 * test files with deliberately registered hashes for exactly this purpose, so when
 * a real provider is configured the same fixture mechanism accepts those files:
 * the operator adds the published test hash to the list and confirms the pipeline
 * end to end against the live provider without ever handling real material.
 *
 * SHA-256 IS NOT WHAT A REAL PROVIDER USES. Production hash screening uses
 * perceptual hashing (PhotoDNA and its equivalents), which survives resizing and
 * re-encoding; an exact cryptographic digest does not. That difference does not
 * matter here, because this provider's job is to prove the PLUMBING, not to
 * detect anything. A real adapter implements the same interface and swaps the
 * comparison. Saying this out loud matters: a cryptographic hash presented as
 * CSAM screening would be a false assurance.
 */

import { createHash } from 'node:crypto';

import { log } from '../log.js';
import type { ScreeningProvider, ScreeningRequest, ScreeningResult } from './types.js';

export interface FixtureProviderOptions {
  /** Lowercase hex SHA-256 digests that count as a match. */
  hashes: () => readonly string[];
  /** Whether the provider is switched on at all. */
  enabled: () => boolean;
}

export function sha256Hex(buf: Buffer): string {
  return createHash('sha256').update(buf).digest('hex');
}

/**
 * A provider that compares against a LOCAL list. `transmitsContent` is false
 * because nothing leaves the host: the comparison happens in this process.
 */
export function createFixtureProvider(opts: FixtureProviderOptions): ScreeningProvider {
  return {
    name: 'fixture',
    label: 'Local fixture hash list (test only)',
    transmitsContent: false,
    isConfigured: () => opts.enabled() && opts.hashes().length > 0,
    async screen(req: ScreeningRequest): Promise<ScreeningResult> {
      const list = opts.hashes().map((h) => h.trim().toLowerCase());
      if (list.length === 0) return { verdict: 'not-screened', provider: 'fixture' };
      let digest: string;
      try {
        // Only NOW are the plaintext bytes materialised, and only because a
        // configured provider asked for them.
        digest = sha256Hex(await req.bytes());
      } catch (err) {
        // A file that cannot be read is a fault, not a verdict. It degrades to
        // an error the caller retries; it must never read as "no match".
        return {
          verdict: 'error',
          provider: 'fixture',
          detail: err instanceof Error ? err.message : String(err),
        };
      }
      if (list.includes(digest)) {
        // The digest is NOT logged. It identifies the content, and an operator
        // log line is not the place for it.
        log.warn(`Screening: fixture provider matched message ${req.messageId}.`);
        return { verdict: 'match', provider: 'fixture', reference: 'fixture-list' };
      }
      return { verdict: 'no-match', provider: 'fixture' };
    },
  };
}
