/**
 * A relevance scorer for the harnesses (CCB-S5-028, D-183).
 *
 * The web-search relevance floor needs an embedder, and every check that drives
 * `WebSearchService` needs one or the service fails CLOSED and hands over nothing, which is
 * the whole point of it. This supplies vectors with EXACT, chosen cosines, so a check states
 * the score it is testing rather than hoping a real model lands in the right band.
 *
 * ── HOW AN EXACT COSINE IS MANUFACTURED ──────────────────────────────────────
 *
 * The query vector is `[1, 0]`. A document vector of `[c, sqrt(1 - c^2)]` is a unit vector
 * whose cosine against it is exactly `c`. No model, no floating-point band to reason about,
 * and a check can drive the floor from either side by naming the number.
 *
 * Nothing here is used in production. `src/plugins/web-search/relevance.ts` is the module
 * under test; this is only a way to hold its input still.
 */

/** Cosine 1.0 for everything, so a check about something else is unaffected by the floor. */
export function alwaysRelevant(): {
  embedQuery(text: string): Promise<number[]>;
  embedDocuments(texts: readonly string[]): Promise<number[][]>;
} {
  return scoringEmbedder(() => 1);
}

/** Cosine 0 for everything: every result is below any floor worth having. */
export function neverRelevant(): ReturnType<typeof alwaysRelevant> {
  return scoringEmbedder(() => 0);
}

/**
 * A scorer that decides each result's cosine from its own text.
 *
 * `score` receives the string the service asked to embed, which is
 * `searchRelevanceText(result)` - title, a full stop, snippet - so a check keys on a marker
 * it put in the title.
 */
export function scoringEmbedder(score: (text: string) => number): {
  embedQuery(text: string): Promise<number[]>;
  embedDocuments(texts: readonly string[]): Promise<number[][]>;
} {
  return {
    embedQuery: () => Promise.resolve([1, 0]),
    embedDocuments: (texts) =>
      Promise.resolve(
        texts.map((text) => {
          const c = Math.max(-1, Math.min(1, score(text)));
          return [c, Math.sqrt(Math.max(0, 1 - c * c))];
        }),
      ),
  };
}

/** An embedder that always throws, for the `unjudged` branch. */
export function brokenEmbedder(message = 'the embedding model is not answering'): ReturnType<
  typeof alwaysRelevant
> {
  return {
    embedQuery: () => Promise.reject(new Error(message)),
    embedDocuments: () => Promise.reject(new Error(message)),
  };
}
