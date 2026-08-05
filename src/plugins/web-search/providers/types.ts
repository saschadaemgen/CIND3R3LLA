/**
 * The search-provider seam (CCB-S4-037, D-141).
 *
 * Same shape and the same reason as the price-provider seam: adding a second source
 * touches no caller. It matters more here, because the shipped provider is a commercial
 * API with a key and an operator who cannot change it is an operator locked in.
 *
 * ── WHAT A PROVIDER MAY RETURN, AND WHAT IT MAY NOT ──────────────────────────
 *
 * A {@link SearchResult} is a title, a snippet and a URL. That is deliberately the whole
 * shape. This briefing is search results, not a browser: nothing here fetches a page, so
 * no provider may return page BODIES, and one that offered them would still only have
 * these three fields to put them in.
 *
 * The narrow shape is also the first line of the injection defence. The less text crosses
 * this boundary, the less there is to hide an instruction in, and every field is truncated
 * by the service before it reaches a prompt.
 *
 * ── EVERY FIELD IS HOSTILE ───────────────────────────────────────────────────
 *
 * A title and a snippet are written by whoever owns the page. They are not knowledge, they
 * are strings from strangers, and nothing downstream may treat them as anything else. An
 * adapter's job is to parse the provider's envelope and hand over the strings; sanitising
 * them is the service's job and fencing them is the prompt's, so neither can be forgotten
 * by an adapter author who is thinking about JSON shapes.
 */

/** One result. Three strings, all of them untrusted. */
export interface SearchResult {
  /** The page title, as the provider reports it. Untrusted. */
  title: string;
  /** The provider's snippet. Untrusted, and the most likely place for an injection. */
  snippet: string;
  /** The result URL. Untrusted, but the only field a member can independently check. */
  url: string;
}

export interface SearchProviderCapabilities {
  /** Whether it needs an API key to answer at all. */
  requiresKey: boolean;
  /** Where the operator gets one. Shown in the console beside the key field. */
  keyUrl: string;
  /** Notes shown next to the provider in the console. */
  note: string;
}

export interface SearchProvider {
  /** Stable slug, also the key under which its settings live. */
  readonly name: string;
  readonly label: string;
  readonly capabilities: SearchProviderCapabilities;

  /** Usable right now: configured, and holding a key if it needs one. */
  isConfigured(): boolean;

  /**
   * Runs one query.
   *
   * Throws {@link SearchProviderError} rather than returning an empty list when the
   * provider could not answer. "No results" and "the provider is down" are different
   * facts and she says different things about them: one is an honest "I found nothing",
   * the other is an honest "I could not look it up". Collapsing them would make her
   * report an outage as an empty internet.
   */
  search(query: string, limit: number, timeoutMs: number): Promise<SearchResult[]>;
}

/** Thrown when a provider cannot answer. Never swallowed; the caller says so out loud. */
export class SearchProviderError extends Error {
  constructor(
    readonly provider: string,
    message: string,
  ) {
    super(message);
    this.name = 'SearchProviderError';
  }
}
