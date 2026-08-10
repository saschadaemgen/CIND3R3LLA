/**
 * Turning text into vectors (CCB-S5-022, D-176).
 *
 * ── THE MODEL, AND ITS LICENCE ───────────────────────────────────────────────
 *
 * `nomic-embed-text` v1.5: **Apache-2.0**, ~137M parameters, 768 dimensions, 8192-token
 * context. The licence was a selection criterion rather than a footnote, because several
 * leaderboard-topping embedding models are non-commercially licensed and are disqualified
 * outright, and at least one popular local option (EmbeddingGemma) ships under bespoke terms
 * with use restrictions rather than an OSI licence.
 *
 * Two Apache/MIT alternatives were considered and lost on one measurement rather than on
 * quality: `bge-m3` (MIT, 568M) and `qwen3-embedding:0.6b` are both around a gigabyte, and
 * the deployment has **825 MiB of VRAM free with qwen3:32b resident**. Measured on the
 * operator's own card, nomic-embed-text occupies **0.32 GB alongside the pinned 32B, which
 * survives**, leaving 733 MiB. A larger embedder would evict the reply model onto the CPU,
 * which is the failure the operator has already been bitten by once.
 *
 * It is English-only, and that is fine here for a stated reason rather than by luck: this
 * repository's own standing rule is English everywhere, so the operator's protocol work,
 * architecture notes and season protocols are English. Member-facing text is bilingual and
 * is not what is being embedded.
 *
 * ── THE TASK PREFIXES ARE NOT OPTIONAL ───────────────────────────────────────
 *
 * nomic-embed-text is trained with instruction prefixes and its model card states the text
 * "must" carry one: `search_document:` for stored text and `search_query:` for a question.
 * Ollama does not add them. Getting this wrong costs retrieval quality SILENTLY - the calls
 * succeed, the vectors come back, and everything looks like it works - so the two helpers
 * below are the only way this module will embed anything, and `verify:knowledge` pins the
 * asymmetry.
 *
 * ── WHY THERE IS NO RERANKER ─────────────────────────────────────────────────
 *
 * A cross-encoder reranker is reported as the highest-value addition after hybrid search,
 * and it is not built, for a reason found by asking the runtime rather than by reading about
 * the technique: **Ollama has no rerank endpoint**. Confirmed against the running 0.32.6:
 * `/api/rerank` returns 404, and a reranker model driven through `/api/embed` returns
 * embeddings from the wrong layer rather than cross-encoder relevance scores, which is worse
 * than no reranker because it looks like one.
 *
 * Serving one would mean a second inference service beside Ollama on a shared production
 * host, with a GPU that has 733 MiB free. That is a real piece of work with a real operating
 * cost, and it is not this briefing. The seam is here: `retrieve()` takes ranked candidates
 * and would take reranked ones without changing its shape.
 */

import { log } from '../log.js';
import type { LocalAiConfig } from '../config.js';

/** The model this build embeds with. Pinned: the column dimension depends on it. */
export const EMBEDDING_MODEL = 'nomic-embed-text';
export const EMBEDDING_DIMENSIONS = 768;
export const EMBEDDING_LICENCE = 'Apache-2.0';

/** The two instruction prefixes. See the header: not optional, and asymmetric on purpose. */
export const DOCUMENT_PREFIX = 'search_document: ';
export const QUERY_PREFIX = 'search_query: ';

export type EmbedFetch = (input: string | URL, init?: RequestInit) => Promise<Response>;

export interface EmbedderDeps {
  config: Pick<LocalAiConfig, 'baseUrl' | 'timeoutMs'>;
  fetchImpl?: EmbedFetch;
  /** Injected by the harnesses so the whole pipeline runs with no model. */
  embedImpl?: (inputs: readonly string[]) => Promise<number[][]>;
}

/**
 * How long Ollama should hold the embedding model.
 *
 * Short on purpose. The reply model is pinned and the card has 733 MiB to spare; holding a
 * second model indefinitely for a capability used a few times an hour is how the margin
 * disappears. The measured cost of a cold load beside the resident 32B is ~800 ms, against
 * ~120 ms warm, and only the first question after a quiet spell pays it.
 */
const KEEP_ALIVE = '5m';

export class Embedder {
  constructor(private readonly deps: EmbedderDeps) {}

  /** Embed stored text. Always with the document prefix. */
  async embedDocuments(texts: readonly string[]): Promise<number[][]> {
    return this.embed(texts.map((t) => DOCUMENT_PREFIX + t));
  }

  /** Embed a question. Always with the query prefix. */
  async embedQuery(text: string): Promise<number[]> {
    const [only] = await this.embed([QUERY_PREFIX + text]);
    if (!only) throw new Error('The embedding model returned no vector for the query.');
    return only;
  }

  private async embed(inputs: readonly string[]): Promise<number[][]> {
    if (this.deps.embedImpl) return this.deps.embedImpl(inputs);
    if (inputs.length === 0) return [];

    const endpoint = new URL('/api/embed', `${this.deps.config.baseUrl}/`);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), Math.max(this.deps.config.timeoutMs, 120_000));
    try {
      const response = await (this.deps.fetchImpl ?? fetch)(endpoint, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          model: EMBEDDING_MODEL,
          input: [...inputs],
          keep_alive: KEEP_ALIVE,
        }),
        signal: controller.signal,
      });
      if (!response.ok) {
        throw new Error(`the embedding model answered ${String(response.status)}`);
      }
      const decoded = (await response.json()) as { embeddings?: unknown };
      const vectors = decoded.embeddings;
      if (!Array.isArray(vectors) || vectors.length !== inputs.length) {
        throw new Error(
          `expected ${String(inputs.length)} vector(s) and got ${String(
            Array.isArray(vectors) ? vectors.length : 0,
          )}`,
        );
      }
      return vectors.map((v, i) => {
        if (!Array.isArray(v) || v.length !== EMBEDDING_DIMENSIONS) {
          // A dimension mismatch means the model is not the one the column was built for,
          // and storing it would compare vectors from two different spaces. Loud, not
          // coerced (CCB-S3-023).
          throw new Error(
            `vector ${String(i)} has ${String(Array.isArray(v) ? v.length : 0)} dimensions, ` +
              `expected ${String(EMBEDDING_DIMENSIONS)}: is ${EMBEDDING_MODEL} really the ` +
              `model that produced the stored chunks?`,
          );
        }
        return v as number[];
      });
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      log.warn(`Knowledge: embedding failed (${detail}).`);
      throw new Error(`Embedding failed: ${detail}`);
    } finally {
      clearTimeout(timeout);
    }
  }
}

/** pgvector's text input form. */
export function toVectorLiteral(v: readonly number[]): string {
  return `[${v.join(',')}]`;
}
