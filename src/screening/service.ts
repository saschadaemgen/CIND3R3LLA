/**
 * The screening service (CCB-S3-012 §3): provider selection, health, and the
 * match handler.
 *
 * HEALTH IS MODULE-GLOBAL, deliberately. The price panel keeps per-provider health
 * on the service instance, and the admin page constructs a fresh service per
 * request, so that column renders an empty dash forever. Screening health has to
 * survive from the worker that records it to the request that renders it, so it
 * lives here in a capped module-level buffer, like the price ATTEMPT log which is
 * the half of that design that does work.
 *
 * The buffer is sized for screening's own traffic. Screening runs at receipt on
 * every image regardless of consent, which is a far higher rate than price
 * lookups, so a 60-entry cap borrowed from there would let one upload burst evict
 * every diagnostic an operator needs.
 *
 * WHAT IS RECORDED, and what is not: message id, provider, verdict, timing, and an
 * operator-facing cause for errors. Never the hash, never the filename, never the
 * bytes. The hash identifies the content; an admin page is not where it belongs.
 */

import { writeAudit } from '../db/audit.js';
import { placeHold } from '../db/holds.js';
import type { Queryable } from '../db/pool.js';
import { log } from '../log.js';
import { readMediaFile } from '../media/at-rest.js';
import { quarantineMedia } from '../media/quarantine.js';
import { status } from '../web/status.js';
import { nullScreeningProvider, type ScreeningProvider, type ScreeningResult } from './types.js';

/** Sized for receipt-rate traffic, not price-lookup traffic. */
const ATTEMPT_LIMIT = 400;

export interface ScreeningAttempt {
  at: number;
  messageId: number;
  provider: string;
  verdict: ScreeningResult['verdict'];
  ms: number;
  detail?: string;
}

const attempts: ScreeningAttempt[] = [];

export function recordScreeningAttempt(a: Omit<ScreeningAttempt, 'at'>): void {
  attempts.push({ ...a, at: Date.now() });
  if (attempts.length > ATTEMPT_LIMIT) attempts.splice(0, attempts.length - ATTEMPT_LIMIT);
}

/** Newest first. */
export function recentScreeningAttempts(limit = 50): ScreeningAttempt[] {
  return attempts.slice(-limit).reverse();
}

export function clearScreeningAttempts(): void {
  attempts.length = 0;
}

export interface ScreeningHealth {
  provider: string;
  label: string;
  configured: boolean;
  transmitsContent: boolean;
  screened: number;
  matches: number;
  errors: number;
  lastAt: number | null;
  lastError: string | null;
}

export function screeningHealth(provider: ScreeningProvider): ScreeningHealth {
  const mine = attempts.filter((a) => a.provider === provider.name);
  const errs = mine.filter((a) => a.verdict === 'error');
  return {
    provider: provider.name,
    label: provider.label,
    configured: provider.isConfigured(),
    transmitsContent: provider.transmitsContent,
    screened: mine.filter((a) => a.verdict === 'no-match' || a.verdict === 'match').length,
    matches: mine.filter((a) => a.verdict === 'match').length,
    errors: errs.length,
    lastAt: mine.length > 0 ? (mine[mine.length - 1] as ScreeningAttempt).at : null,
    lastError: errs.length > 0 ? ((errs[errs.length - 1] as ScreeningAttempt).detail ?? null) : null,
  };
}

let active: ScreeningProvider = nullScreeningProvider;

/** The provider in force. Defaults to the one that contacts nothing. */
export function activeScreeningProvider(): ScreeningProvider {
  return active;
}

/**
 * Installs a provider. Called from composition, and by the harness.
 *
 * A provider that is not configured is replaced by the null provider rather than
 * being called and declining, so "not configured" cannot become a code path that
 * reaches a network client at all.
 */
export function setScreeningProvider(p: ScreeningProvider | null): void {
  active = p && p.isConfigured() ? p : nullScreeningProvider;
  log.info(
    `Screening: provider set to '${active.name}'` +
      (active.transmitsContent ? ' (transmits content off this host)' : ' (nothing leaves the host)'),
  );
}

export interface ScreenOutcome {
  result: ScreeningResult;
  quarantined: boolean;
}

/**
 * Screens one already-stored original and acts on the verdict.
 *
 * ORDER ON A MATCH is fixed by §4 and by what each step protects:
 *   1. QUARANTINE FIRST, before anything else, and irreversibly. Segregating the
 *      bytes and withholding publication is the only step whose delay has a
 *      consequence that cannot be undone.
 *   2. PRESERVE. The encrypted original is moved, never deleted. The hold carries
 *      no expiry, and the DB trigger from CCB-S3-013 makes it undeletable by a
 *      member's revocation, an operator takedown, or any other path.
 *   3. ALERT with the fact and the reference only.
 *   4. AUDIT the event, not the content.
 *   5. STOP. Reporting is a legal process the operator performs with a lawyer.
 *      Nothing here contacts anyone.
 */
export async function screenMessage(
  db: Queryable,
  roots: { mediaRoot: string; quarantineRoot: string },
  message: { id: number; mediaPath: string; mime: string | null },
): Promise<ScreenOutcome> {
  const provider = active;
  const started = Date.now();
  let result: ScreeningResult;
  try {
    result = await provider.screen({
      messageId: message.id,
      mime: message.mime,
      bytes: () => readMediaFile(`${roots.mediaRoot}/${message.mediaPath}`),
    });
  } catch (err) {
    // A provider that throws is a fault, never a verdict. It must not read as
    // "no match", which would silently mean "screened and clean".
    result = {
      verdict: 'error',
      provider: provider.name,
      detail: err instanceof Error ? err.message : String(err),
    };
  }
  recordScreeningAttempt({
    messageId: message.id,
    provider: result.provider,
    verdict: result.verdict,
    ms: Date.now() - started,
    ...(result.detail === undefined ? {} : { detail: result.detail }),
  });

  if (result.verdict === 'error') {
    // "Configured but failing" is a fault and is surfaced; "not configured" is a
    // choice and is silent. The null provider never reaches this branch.
    status.error(
      `Hash screening failed for message ${message.id} via provider '${result.provider}'. The item ` +
        `is NOT screened and will be retried.`,
    );
    throw new Error(`screening failed for message ${message.id}: ${result.detail ?? 'unknown'}`);
  }

  if (result.verdict !== 'match') return { result, quarantined: false };

  // 1 + 2. Bytes out of the served tree FIRST, then the never-expiring hold. The
  // ordering is quarantineMedia's contract: if the move fails, no hold is placed
  // and the failure is loud, rather than an item marked quarantined whose bytes
  // are still being served.
  await quarantineMedia(db, roots.mediaRoot, roots.quarantineRoot, message.id);
  await placeHold(db, message.id, 'csam', null);

  // 3. The alert carries the fact and the reference. It does not render, embed,
  // preview, thumbnail or attach the content, and it names no filename.
  status.error(
    `HASH SCREENING MATCH on message ${message.id} (provider '${result.provider}'). The item is ` +
      `quarantined, withheld from every public path, and preserved. It cannot be deleted. Do not ` +
      `open it. Follow your legal process.`,
  );
  log.error(
    `Screening: MATCH on message ${message.id} via '${result.provider}'; quarantined and preserved.`,
  );

  // 4. The audit records the event, not the content: identifiers and provider only.
  await writeAudit(db, 'system', 'screening.match', `message:${message.id}`, {
    provider: result.provider,
    reference: result.reference ?? null,
  });

  // 5. Nothing further. No disclosure, no notification, no report is generated.
  return { result, quarantined: true };
}
