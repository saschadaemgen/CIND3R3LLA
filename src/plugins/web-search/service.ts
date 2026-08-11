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
import { status } from '../../web/status.js';
import { decryptSecret } from '../secrets.js';
import {
  SEARCH_RELEVANCE_FLOOR,
  applyRelevanceFloor,
  cosine,
  searchRelevanceText,
  type ScoredResult,
} from './relevance.js';
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
  | 'no-results'
  /**
   * Results came back and NONE of them cleared the relevance floor (CCB-S5-028, D-183).
   *
   * Its own failure rather than `no-results`, because they are different facts and she says
   * different things about them: one is an internet that had nothing on the subject, the
   * other is an internet that answered a different question. The distinction is the same one
   * this type already draws between `no-results` and `provider-error`.
   */
  | 'nothing-relevant'
  /**
   * Results came back and could not be JUDGED, because the embedder did not answer.
   *
   * Fails CLOSED: nothing reaches the model. A result nobody could score is a result nobody
   * can vouch for, and handing over unjudged strangers' text is exactly the defect. It is a
   * FAULT rather than a choice, so unlike `not-configured` it is logged and surfaced.
   */
  | 'unjudged';

export type SearchOutcome =
  | {
      kind: 'results';
      results: SearchResult[];
      provider: string;
      /** Every result with its relevance score, for the console. Never sent to a model. */
      scored: ScoredResult[];
    }
  | { kind: 'failed'; failure: SearchFailure; detail: string; scored?: ScoredResult[] };

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

  /** How many hits are still inside the window, across every key. For the console. */
  live(windowSeconds: number, now: number): number {
    const cutoff = now - windowSeconds * 1000;
    let total = 0;
    for (const times of this.hits.values()) total += times.filter((at) => at >= cutoff).length;
    return total;
  }
}

/**
 * What the console shows about this plugin (CCB-S4-042, D-145).
 *
 * ── WHY THIS EXISTS ──────────────────────────────────────────────────────────
 *
 * The operator hit it on the day the briefing was written: a plugin that fails says nothing
 * in the console, and the only way to find out why was the journal. A fault an operator can
 * only reach over SSH is a fault they will not find.
 *
 * ── CONTENT-FREE, AND THAT IS NOT NEGOTIABLE ─────────────────────────────────
 *
 * The same rule the reply-wording log follows (D-130): THAT something happened, and how it
 * failed, never WHAT anybody said. No query text, no result text, no member id. `detail` is
 * the provider's own error string, which is about the transport rather than about a member;
 * everything member-shaped is deliberately absent.
 */
export interface WebSearchDiagnostics {
  /** Searches that actually reached a provider since the last restart. */
  searches: number;
  /** Searches still inside the rate-limit window, across every member and chat. */
  inWindow: number;
  /** How the last failure failed, and when. Null when nothing has failed. */
  lastFailure: {
    provider: string;
    failure: SearchFailure;
    detail: string;
    at: string;
  } | null;
  /** Requests the pre-search gate refused, so no provider was ever called. */
  refusedBeforeSearch: number;
  /** The last refusal category, for the operator. Never the query. */
  lastRefusal: { category: string; at: string } | null;
  /**
   * Searches whose results ALL fell below the relevance floor (CCB-S5-028, D-183).
   *
   * The number that tells an operator whether the floor is in the right place. Rising
   * steadily against a flat `searches` means it is too high and she is refusing to use good
   * results; flat at zero over a long run means it is too low to be doing anything.
   */
  belowFloor: number;
  /**
   * What the last judged search scored. Content-free: how many survived, out of how many,
   * and the best score. Never a title, a snippet, a host or a query.
   */
  lastRelevance: { best: number | null; kept: number; of: number; at: string } | null;
  /** The floor in force, so the page states the number rather than describing it. */
  floor: number;
}

export interface WebSearchDeps {
  settings: () => WebSearchSettings;
  /** Injected so the harness drives the whole pipeline with no network and no key. */
  provider?: SearchProvider;
  now?: () => number;
  fetchImpl?: typeof fetch;
  /**
   * How relevance is judged (CCB-S5-028, D-183).
   *
   * The same `nomic-embed-text` the knowledge base uses, injected rather than constructed so
   * a harness drives every branch of the floor with fixed vectors and no model at all.
   *
   * IT LIVES IN `src/knowledge/` AND THAT IS AN ACCIDENT OF BIRTH, not a dependency of web
   * search on the knowledge base. The embedder is a deployment capability like the reply
   * model: one model, one endpoint, one set of task prefixes. Two copies of it would be two
   * things to keep in step, and a second embedding model on a card with 733 MiB free is not
   * a thing that fits.
   *
   * ABSENT MEANS UNJUDGED, and unjudged means nothing reaches the model. A deployment that
   * has not wired this does not get to skip the floor; see the `unjudged` failure.
   */
  embed?: {
    embedQuery(text: string): Promise<number[]>;
    embedDocuments(texts: readonly string[]): Promise<number[][]>;
  };
}

export class WebSearchService {
  private readonly window = new Window();
  private readonly now: () => number;
  private searches = 0;
  private refusedBeforeSearch = 0;
  private lastFailure: WebSearchDiagnostics['lastFailure'] = null;
  private lastRefusal: WebSearchDiagnostics['lastRefusal'] = null;
  private belowFloor = 0;
  private lastRelevance: WebSearchDiagnostics['lastRelevance'] = null;

  constructor(private readonly deps: WebSearchDeps) {
    this.now = deps.now ?? ((): number => Date.now());
  }

  /**
   * Counted by the ENGINE, because the gate runs there, before this service is touched.
   *
   * The count lives here anyway so the console has one place to read the plugin's state
   * from. Only the category is kept; the query is never passed in, so it cannot be stored
   * by accident later.
   */
  noteRefusedBeforeSearch(category: string): void {
    this.refusedBeforeSearch++;
    this.lastRefusal = { category, at: new Date(this.now()).toISOString() };
  }

  /** Everything the console shows. Content-free by construction. */
  diagnostics(): WebSearchDiagnostics {
    return {
      searches: this.searches,
      inWindow: this.window.live(this.deps.settings().rateLimitWindowSeconds, this.now()),
      lastFailure: this.lastFailure,
      refusedBeforeSearch: this.refusedBeforeSearch,
      lastRefusal: this.lastRefusal,
      belowFloor: this.belowFloor,
      lastRelevance: this.lastRelevance,
      floor: SEARCH_RELEVANCE_FLOOR,
    };
  }

  private noteFailure(provider: string, failure: SearchFailure, detail: string): void {
    this.lastFailure = { provider, failure, detail, at: new Date(this.now()).toISOString() };
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
    scope: { groupId: number; memberId: string; botProfileId?: number },
  ): Promise<SearchOutcome> {
    const cfg = this.deps.settings();
    const provider = this.provider();

    if (!provider || !provider.isConfigured()) {
      // NOT CONFIGURED IS A CHOICE, NOT A FAULT (the standing rule). It is reported as
      // its own outcome and it does not call `status.error`, because an operator who has
      // not entered a key has not broken anything.
      // Deliberately NOT recorded as a failure: not configured is a choice, not a fault,
      // and putting it in the console's failure line would be alarming an operator about
      // a key they decided not to enter (the standing rule).
      return { kind: 'failed', failure: 'not-configured', detail: 'no search provider is configured' };
    }

    const trimmed = query.trim().slice(0, 300);
    if (!trimmed) {
      return { kind: 'failed', failure: 'no-results', detail: 'the query was empty' };
    }

    const now = this.now();
    // ── THE BUDGET IS SPENT PER BOT (CCB-S5-021, D-175) ─────────────────────
    //
    // The NUMBER is deployment-wide, because it is the operator's bill and there is one
    // account. The SPEND is this bot's, so a bot that searches constantly cannot exhaust
    // the allowance of one that searches rarely.
    //
    // It was already isolated, and only BY ACCIDENT: the keys carried a SimpleX group id
    // and a SimpleX member id, and those differ per profile because each profile is its
    // own membership. That is precisely the accident migration 044 removed from the
    // moderation counters, with the note that conversation canonicalisation would collapse
    // it. Stated here rather than relied upon, so the isolation survives the day two bots
    // are made to agree about what a conversation is.
    const bot = `b:${scope.botProfileId === undefined ? 'shared' : String(scope.botProfileId)}`;
    const allowed =
      this.window.allow(
        `${bot}|m:${scope.memberId}`,
        cfg.rateLimitPerMember,
        cfg.rateLimitWindowSeconds,
        now,
      ) &&
      this.window.allow(
        `${bot}|g:${String(scope.groupId)}`,
        cfg.rateLimitPerChat,
        cfg.rateLimitWindowSeconds,
        now,
      );
    if (!allowed) {
      this.noteFailure(provider.name, 'rate-limited', 'the search budget for this window is spent');
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
      const named = error instanceof SearchProviderError ? error.message : detail;
      this.noteFailure(provider.name, timedOut ? 'timeout' : 'provider-error', named);
      return {
        kind: 'failed',
        failure: timedOut ? 'timeout' : 'provider-error',
        detail: named,
      };
    }

    const results = applyBudget(
      raw.map((result) => sanitizeResult(result, cfg.perResultChars)).filter((r) => r.snippet || r.title),
      cfg.totalChars,
    );

    if (results.length === 0) {
      this.searches++;
      this.noteFailure(provider.name, 'no-results', 'the search returned nothing usable');
      return { kind: 'failed', failure: 'no-results', detail: 'the search returned nothing usable' };
    }

    this.searches++;

    // ── THE RELEVANCE FLOOR (CCB-S5-028, D-183) ─────────────────────────────
    //
    // Everything above this line asked whether the provider ANSWERED. Nothing asked whether
    // what it answered with had anything to do with the question, so two university pages
    // about amending human-subjects research protocols were handed to the model as evidence
    // for a question about a messaging protocol, and the answer that came back invented a
    // technical position and a provenance for it.
    //
    // Placed AFTER sanitising and the budget on purpose: the floor judges exactly the text
    // the model would have seen, so a result cannot pass the bar in a form it is never shown
    // in.
    return this.judge(results, trimmed, provider.name);
  }

  /**
   * Score the results against the question and drop everything below the floor.
   *
   * NEVER THROWS, like `search` itself. An embedder that cannot answer is a named outcome
   * (`unjudged`) rather than an exception, because the caller has to say something honest and
   * "I could not judge what I found" is a different sentence from "I found nothing".
   */
  private async judge(
    results: SearchResult[],
    query: string,
    providerName: string,
  ): Promise<SearchOutcome> {
    const embed = this.deps.embed;
    if (!embed) {
      // NOT a quiet pass-through. A deployment with no embedder cannot judge relevance, and
      // the failure direction is the one that hands the model less. Loud, because unlike a
      // missing API key this is not something an operator chose on this page.
      log.error('Web search: no embedder is wired, so relevance cannot be judged.');
      status.error(
        'Web search results cannot be checked for relevance because the embedding model is ' +
          'not wired. Nothing is being handed to her from the web until it is.',
      );
      this.noteFailure(providerName, 'unjudged', 'no embedder is available to score relevance');
      return {
        kind: 'failed',
        failure: 'unjudged',
        detail: 'no embedder is available to score relevance',
      };
    }

    let scores: number[];
    try {
      const [queryVector, resultVectors] = await Promise.all([
        embed.embedQuery(query),
        embed.embedDocuments(results.map((r) => searchRelevanceText(r))),
      ]);
      scores = resultVectors.map((v) => cosine(queryVector, v));
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      // CONFIGURED BUT FAILING IS A FAULT (the standing rule). The search itself worked; what
      // failed is the check that decides whether its output is worth anything.
      log.error(`Web search: relevance could not be scored (${detail}).`);
      status.error(
        `Web search results could not be checked for relevance (${detail}). Nothing is being ` +
          `handed to her from the web until the embedding model answers again.`,
      );
      this.noteFailure(providerName, 'unjudged', detail);
      return { kind: 'failed', failure: 'unjudged', detail };
    }

    const outcome = applyRelevanceFloor(results, scores, SEARCH_RELEVANCE_FLOOR);
    this.lastRelevance = {
      best: outcome.best,
      kept: outcome.kept.length,
      of: results.length,
      at: new Date(this.now()).toISOString(),
    };

    if (outcome.kept.length === 0) {
      // Not a fault and not an outage: the internet answered a different question. Recorded
      // as a failure so the console can show how often it happens, which is the number that
      // tells an operator whether the floor is in the right place.
      this.noteFailure(
        providerName,
        'nothing-relevant',
        `nothing cleared the relevance floor (best ${outcome.best === null ? 'n/a' : outcome.best.toFixed(3)})`,
      );
      this.belowFloor++;
      return {
        kind: 'failed',
        failure: 'nothing-relevant',
        detail: `nothing cleared the relevance floor of ${String(SEARCH_RELEVANCE_FLOOR)}`,
        scored: outcome.scored,
      };
    }

    return {
      kind: 'results',
      results: outcome.kept,
      provider: providerName,
      scored: outcome.scored,
    };
  }
}

/**
 * The process-wide instance, registered by the boot path (CCB-S4-042).
 *
 * Registered rather than passed, for the same reason the personality and rule services are:
 * the admin console is built before the bot starts, so its views exist at a moment when
 * there is nothing to hand them. Null in every harness that does not host a bot, and the
 * page then says the plugin is not running rather than showing zeroes that look like facts.
 */
let activeWebSearch: WebSearchService | null = null;

export function setWebSearchService(service: WebSearchService | null): void {
  activeWebSearch = service;
}

/** What the Web Search page shows. Null when no service is running. */
export function webSearchDiagnostics(): WebSearchDiagnostics | null {
  return activeWebSearch?.diagnostics() ?? null;
}
