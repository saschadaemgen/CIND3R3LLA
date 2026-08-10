/**
 * Ingest and question-time retrieval (CCB-S5-022, D-176).
 *
 * The orchestration only: the decisions live in `chunk.ts` (what is stored) and
 * `retrieval.ts` (what is shown), both pure, and the SQL lives in `db/knowledge.ts`. This
 * joins them to the embedding model and to the durable queue.
 */

import { createHash } from 'node:crypto';
import { log } from '../log.js';
import { status } from '../web/status.js';
import type { Queryable } from '../db/pool.js';
import {
  botCorpusSize,
  countChunks,
  getDocument,
  getDocumentBody,
  listDocuments,
  replaceChunks,
  setDocumentState,
  searchChunks,
} from '../db/knowledge.js';
import { chunkDocument } from './chunk.js';
import type { Embedder } from './embed.js';
import { attributionFor, retrieve, type RetrievalOutcome } from './retrieval.js';
import type { KnowledgeSettings } from '../plugins/knowledge-base/settings.js';

/** SHA-256 of the body, which is what makes a re-upload of identical bytes a no-op. */
export function checksumOf(body: string): string {
  return createHash('sha256').update(body, 'utf8').digest('hex');
}

/**
 * The formats accepted, and why the list is this short.
 *
 * Markdown and plain text are certain: that is what the operator's material is, and both are
 * already text, so ingest is chunking and nothing else.
 *
 * PDF is DELIBERATELY ABSENT and it is a decision rather than an oversight. Extracting text
 * from a PDF is a dependency (a parser), a failure mode (scanned pages yield nothing, or
 * worse, yield ligature soup), and a silent quality cliff: a badly extracted PDF produces
 * chunks that look like text and retrieve like noise, which is the failure this whole design
 * is arranged to avoid. It is worth doing on purpose, with its own extraction check, rather
 * than as a line in this briefing.
 */
export const ACCEPTED_TYPES = Object.freeze({
  '.md': 'text/markdown',
  '.markdown': 'text/markdown',
  '.txt': 'text/plain',
  '.text': 'text/plain',
} as Record<string, string>);

export function contentTypeFor(filename: string): string | null {
  const dot = filename.lastIndexOf('.');
  if (dot < 0) return null;
  return ACCEPTED_TYPES[filename.slice(dot).toLowerCase()] ?? null;
}

export interface KnowledgeDeps {
  db: Queryable;
  embedder: Embedder;
  settings: () => KnowledgeSettings;
}

/** What a retrieval produced, for the engine and for the diagnostics page. */
export interface KnowledgeAnswer {
  outcome: RetrievalOutcome;
  /** The chunks to fence into the prompt, longest-lived form first. */
  passages: { title: string; text: string }[];
  /** Document titles the application will print. Never model-written (D-137). */
  sources: string[];
}

export class KnowledgeService {
  constructor(private readonly deps: KnowledgeDeps) {}

  /* ── Ingest ──────────────────────────────────────────────────────────────── */

  /**
   * Chunk, embed and store one document, replacing whatever it had before.
   *
   * ── WHY THIS IS A QUEUE JOB IN PRODUCTION ────────────────────────────────
   *
   * Measured on the operator's card with the 32B resident: 32 chunks of ~1500 characters
   * took 21.2 s, about 660 ms a chunk. A 500 KB document is roughly 500 chunks, so about
   * five minutes. A console request that held a connection open for that would time out,
   * and an operator watching a spinner cannot tell a slow ingest from a hung one.
   *
   * So the console enqueues and this runs on the durable queue, which also means an ingest
   * survives a restart rather than leaving a document stuck in `ingesting` forever.
   */
  async ingest(documentId: number): Promise<{ chunks: number }> {
    const doc = await getDocument(this.deps.db, documentId);
    if (!doc) throw new Error(`Document ${String(documentId)} does not exist.`);
    const body = await getDocumentBody(this.deps.db, documentId);
    if (body === null) throw new Error(`Document ${String(documentId)} has no body.`);

    await setDocumentState(this.deps.db, documentId, 'ingesting', { error: null });
    try {
      const settings = this.deps.settings();
      const chunks = chunkDocument({ title: doc.title, body }, settings);
      if (chunks.length === 0) {
        // An empty document is not a failure, and it must not look like one. It is simply
        // a document with nothing in it, and it is `ready` with zero chunks.
        await replaceChunks(this.deps.db, documentId, []);
        await setDocumentState(this.deps.db, documentId, 'ready', { chunkCount: 0, error: null });
        return { chunks: 0 };
      }

      // Embedded with the DOCUMENT prefix, over the context line and the body together, so
      // the vector sees exactly what the tsvector sees.
      const vectors = await this.deps.embedder.embedDocuments(
        chunks.map((c) => (c.contextPrefix ? `${c.contextPrefix}\n${c.body}` : c.body)),
      );

      await replaceChunks(
        this.deps.db,
        documentId,
        chunks.map((c, i) => {
          const embedding = vectors[i];
          if (!embedding) throw new Error(`No vector came back for chunk ${String(i)}.`);
          return {
            ord: c.ord,
            body: c.body,
            contextPrefix: c.contextPrefix,
            embedding,
          };
        }),
      );
      const stored = await countChunks(this.deps.db, documentId);
      await setDocumentState(this.deps.db, documentId, 'ready', {
        chunkCount: stored,
        error: null,
      });
      log.info('knowledge: ingested a document', { documentId, chunks: stored });
      return { chunks: stored };
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      // FAILED, LOUDLY, AND NOT RETRIEVABLE. The state check in `searchChunks` only admits
      // `ready`, so a document that failed half way through answers nothing rather than
      // answering from the half of itself that got embedded (CCB-S3-023).
      await setDocumentState(this.deps.db, documentId, 'failed', { error: detail.slice(0, 500) });
      log.error('knowledge: ingest failed', { documentId, detail });
      status.error(
        `Ingesting the document "${doc.title}" failed: ${detail}. It is not retrievable, and ` +
          `it is marked failed on the Knowledge Base page rather than silently doing nothing.`,
      );
      throw error;
    }
  }

  /* ── Question time ───────────────────────────────────────────────────────── */

  /**
   * What this bot knows about this question.
   *
   * Returns an outcome even when nothing survives, because the diagnostics page needs to
   * show the candidates that were rejected and why. `passages` empty means she was given
   * nothing, and the engine says so rather than answering and attributing it.
   */
  async query(botProfileId: number, question: string): Promise<KnowledgeAnswer> {
    const settings = this.deps.settings();
    const empty: KnowledgeAnswer = {
      outcome: { candidates: [], selected: [], charsUsed: 0, emptyBecauseOfFloor: false },
      passages: [],
      sources: [],
    };
    const text = question.trim();
    if (!text) return empty;

    const corpus = await botCorpusSize(this.deps.db, botProfileId);
    // Nothing granted means no embedding call at all. A bot with no documents must not cost
    // a model round trip on every message it hears.
    if (corpus.chunks === 0) return empty;

    const vector = await this.deps.embedder.embedQuery(text.slice(0, 2000));
    const candidates = await searchChunks(
      this.deps.db,
      botProfileId,
      text.slice(0, 500),
      vector,
      settings.candidatesPerSearch,
    );
    const outcome = retrieve(candidates, settings);
    return {
      outcome,
      // The CONTEXT LINE IS NOT SENT. It exists to make the chunk findable, not to be read
      // as part of the document: prepending "From X, under Y (part 3 of 9)." to the text
      // she is shown would be the application putting words in the document's mouth.
      passages: outcome.selected.map((c) => ({ title: c.documentTitle, text: c.body })),
      sources: attributionFor(outcome),
    };
  }

  /** Everything the console lists. */
  async documents(): Promise<Awaited<ReturnType<typeof listDocuments>>> {
    return listDocuments(this.deps.db);
  }

  async corpusFor(botProfileId: number): Promise<{ documents: number; chunks: number }> {
    return botCorpusSize(this.deps.db, botProfileId);
  }
}

/**
 * The process-wide instance, registered by the boot path.
 *
 * Registered rather than passed, for the reason the web search service is: the console is
 * built before the bot starts, so its views exist at a moment when there is nothing to hand
 * them. Null in every harness that does not wire one, and the page then says the service is
 * not running rather than showing an empty corpus that looks like a fact.
 */
let active: KnowledgeService | null = null;

export function setKnowledgeService(service: KnowledgeService | null): void {
  active = service;
}

export function knowledgeService(): KnowledgeService | null {
  return active;
}
