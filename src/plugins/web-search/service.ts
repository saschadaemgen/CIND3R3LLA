/**
 * The web search service (CCB-S4-037, D-141).
 *
 * ── THIS MODULE IS THE QUARANTINE ────────────────────────────────────────────
 *
 * Everything it returns is text a stranger wrote. Its whole job is to fetch that text,
 * make it SMALL and BORING, and hand it to exactly one caller. It cannot send a message,
 * cannot touch consent, cannot reach moderation and holds no chat client, in the same
 * structural sense the moderation rules tree cannot act: the capability is not here to be
 * misused (D-139).
 *
 * ── WHAT SANITISING DOES AND DOES NOT CLAIM ──────────────────────────────────
 *
 * It does NOT claim to detect prompt injection. That is not a solvable pattern-matching
 * problem, and a filter that pretended to solve it would be worse than none, because
 * everything downstream would start trusting its output. What it does is bound the damage:
 *
 *   1. HARD TRUNCATION, per result and in total. An injection needs room to argue; a
 *      400-character snippet is not room. It also means a long page cannot crowd her
 *      instructions out of a 32k context, which is the other half of the same attack.
 *   2. CONTROL CHARACTERS AND FENCE MARKERS REMOVED. A result carrying the fence's own
 *      delimiter could otherwise close the fence early and continue as if it were the
 *      application talking. That one IS a pattern-matching problem, and it is solved here.
 *   3. NEWLINES FLATTENED. A snippet formatted to look like a new prompt section is a
 *      snippet that reads like one; one line per result cannot.
 *
 * The actual defence is the fencing and the instruction in `ollama-reply.ts`, plus the
 * fact that nothing downstream can act on what she reads. This is the belt.
 */

import { log } from '../../log.js';
import { decryptSecret } from '../secrets.js';
import { buildProvider } from './providers/adapters.js';
import {
  SearchProviderError,
  type SearchProvider,
  type SearchResult,
} from './providers/types.js';
import type { WebSearchSettings } from './settings.js';

/** Why a search produced nothing. Each maps to a different honest sentence. */
export type SearchFailure =
  | 'not-configured'
  | 'rate-limited'
  | 'timeout'
  | 'provider-error'
  | 'no-results';

export type SearchOutcome =
  | { kind: 'results'; results: SearchResult[]; provider: string }
  | { kind: 'failed'; failure: SearchFailure; detail: string };

/**
 * The fence delimiter, and the one string a result may never contain.
 *
 * Chosen to be something no ordinary page writes: if a snippet could carry it, a page
 * could close the fence and write what looked like application text after it. Stripped
 * from every result before it is ever put inside one.
 */
export const FENCE = '<<<UNTRUSTED-WEB-CONTENT>>>';

/**
 * One result, cut down to size and stripped of anything structural.
 *
 * The URL is kept whole but capped: it is the only field a member can independently check,
 * so truncating it into something unfollowable would remove the one thing that makes the
 * attribution worth anything.
 */
function sanitizeResult(result: SearchResult, perResultChars: number): SearchResult {
  const flatten = (value: string, limit: number): string =>
    value
      // The fence marker, first. See FENCE.
      .split(FENCE)
      .join(' ')
      // Control characters, for the same reason the model's own output is stripped of
      // them: this is untrusted text on its way to a chat.
      // eslint-disable-next-line no-control-regex
      .replace(/[\u0000-\u001f\u007f-\u009f]/g, ' ')
      // Any run of whitespace becomes one space, so nothing can lay itself out to look
      // like a new section of the prompt.
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, limit);

  // Title and snippet SHARE the per-result budget rather than each getting it, so the
  // setting means what the console says it means.
  const title = flatten(result.title, Math.max(40, Math.floor(perResultChars * 0.25)));
  const snippet = flatten(result.snippet, Math.max(40, perResultChars - title.length));
  return { title, snippet, url: flatten(result.url, 300) };
}

/**
 * Apply the total budget across results.
 *
 * Whole results are dropped rather than half-included. A snippet cut mid-sentence by a
 * global counter reads as a different result than it is, and the last thing this pipeline
 * needs is a member judging a source by half of what it said.
 */
export function applyBudget(results: SearchResult[], totalChars: number): SearchResult[] {
  const out: SearchResult[] = [];
  let used = 0;
  for (const result of results) {
    const cost = result.title.length + result.snippet.length + result.url.length;
    if (used + cost > totalChars) break;
    out.push(result);
    used += cost;
  }
  return out;
}

/** A rolling counter per key, for the per-member and per-chat limits. */
class Window {
  private readonly hits = new Map<string, number[]>();

  allow(key: string, limit: number, windowSeconds: number, now: number): boolean {
    if (limit <= 0) return false;
    const cutoff = now - windowSeconds * 1000;
    const kept = (this.hits.get(key) ?? []).filter((at) => at >= cutoff);
    if (kept.length >= limit) {
      this.hits.set(key, kept);
      return false;
    }
    kept.push(now);
    this.hits.set(key, kept);
    return true;
  }
}

export interface WebSearchDeps {
  settings: () => WebSearchSettings;
  /** Injected so the harness drives the whole pipeline with no network and no key. */
  provider?: SearchProvider;
  now?: () => number;
  fetchImpl?: typeof fetch;
}

export class WebSearchService {
  private readonly window = new Window();
  private readonly now: () => number;

  constructor(private readonly deps: WebSearchDeps) {
    this.now = deps.now ?? ((): number => Date.now());
  }

  /** The live provider, or the injected one. Rebuilt per call so a key change applies. */
  private provider(): SearchProvider | undefined {
    if (this.deps.provider) return this.deps.provider;
    const cfg = this.deps.settings();
    return buildProvider(cfg.provider, {
      // Decrypted at the moment the request is built and never held, never logged.
      apiKey: () => decryptSecret(cfg.apiKey),
      ...(this.deps.fetchImpl ? { fetchImpl: this.deps.fetchImpl } : {}),
    });
  }

  /** Whether a search could be attempted at all right now. The console shows this. */
  available(): boolean {
    const provider = this.provider();
    return provider !== undefined && provider.isConfigured();
  }

  /**
   * Run one search.
   *
   * NEVER THROWS. Every failure is a named outcome, because each one is a different
   * honest sentence and the caller has to say the right one. A thrown error here would
   * become a generic apology, and "I could not reach the search provider" and "I looked
   * and found nothing" are not the same statement.
   */
  async search(
    query: string,
    scope: { groupId: number; memberId: string },
  ): Promise<SearchOutcome> {
    const cfg = this.deps.settings();
    const provider = this.provider();

    if (!provider || !provider.isConfigured()) {
      // NOT CONFIGURED IS A CHOICE, NOT A FAULT (the standing rule). It is reported as
      // its own outcome and it does not call `status.error`, because an operator who has
      // not entered a key has not broken anything.
      return { kind: 'failed', failure: 'not-configured', detail: 'no search provider is configured' };
    }

    const trimmed = query.trim().slice(0, 300);
    if (!trimmed) {
      return { kind: 'failed', failure: 'no-results', detail: 'the query was empty' };
    }

    const now = this.now();
    const allowed =
      this.window.allow(`m:${scope.memberId}`, cfg.rateLimitPerMember, cfg.rateLimitWindowSeconds, now) &&
      this.window.allow(`g:${String(scope.groupId)}`, cfg.rateLimitPerChat, cfg.rateLimitWindowSeconds, now);
    if (!allowed) {
      return { kind: 'failed', failure: 'rate-limited', detail: 'the search budget for this window is spent' };
    }

    let raw: SearchResult[];
    try {
      raw = await provider.search(trimmed, cfg.maxResults, cfg.timeoutMs);
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      const timedOut = /abort|timeout/i.test(detail);
      // CONFIGURED BUT FAILING IS A FAULT, and it is logged as one. The distinction the
      // standing rule asks for is exactly the one between this branch and the one above.
      log.warn(
        `Web search: ${provider.name} could not answer (${detail}).`,
      );
      return {
        kind: 'failed',
        failure: timedOut ? 'timeout' : 'provider-error',
        detail: error instanceof SearchProviderError ? error.message : detail,
      };
    }

    const results = applyBudget(
      raw.map((result) => sanitizeResult(result, cfg.perResultChars)).filter((r) => r.snippet || r.title),
      cfg.totalChars,
    );

    if (results.length === 0) {
      return { kind: 'failed', failure: 'no-results', detail: 'the search returned nothing usable' };
    }

    return { kind: 'results', results, provider: provider.name };
  }
}
