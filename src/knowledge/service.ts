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
import { chunkDocument, ingestSignature } from './chunk.js';
import type { Embedder } from './embed.js';
import { attributionFor, retrieve, type RetrievalOutcome } from './retrieval.js';
import { asksForDocuments } from '../plugins/knowledge-base/settings.js';
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
  /**
   * Run a unit of work inside a REAL transaction, on a handle that is one connection.
   *
   * REQUIRED, and required for a reason found by an adversarial read of the first version.
   * `replaceChunks` issued BEGIN / DELETE / INSERT / COMMIT through a plain `Queryable`,
   * which is a real transaction against PGlite (one connection) and is NOT one against
   * `pg.Pool`, where every statement checks out a different connection: the BEGIN opens a
   * transaction on a connection that then goes back into the pool still inside it, the
   * DELETE auto-commits on another, and a failed INSERT rolls back nothing. A re-ingest that
   * failed half way would have destroyed the document's previous chunks permanently.
   *
   * Optional with a same-handle default would have been the obvious shape and would have
   * left production silently unprotected, because the harness cannot tell the difference.
   * So every construction site states it: production passes `withTransaction`, harnesses
   * pass the same-handle form, and a pool-backed caller that forgets does not compile.
   */
  transaction: <T>(fn: (db: Queryable) => Promise<T>) => Promise<T>;
}

/**
 * The same-handle transaction runner, for a Queryable that really is ONE connection.
 *
 * Correct for PGlite and for a checked-out client. Wrong for a pool, which is exactly why
 * the dependency above is required rather than defaulted to this.
 */
export function singleConnectionTransaction(db: Queryable) {
  return async <T>(fn: (handle: Queryable) => Promise<T>): Promise<T> => {
    await db.query('BEGIN');
    try {
      const result = await fn(db);
      await db.query('COMMIT');
      return result;
    } catch (error) {
      await db.query('ROLLBACK');
      throw error;
    }
  };
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
        await this.deps.transaction((tx) => replaceChunks(tx, documentId, []));
        await setDocumentState(this.deps.db, documentId, 'ready', {
          chunkCount: 0,
          error: null,
          ingestSignature: ingestSignature(settings),
        });
        return { chunks: 0 };
      }

      // Embedded with the DOCUMENT prefix, over the context line and the body together, so
      // the vector sees exactly what the tsvector sees.
      const vectors = await this.deps.embedder.embedDocuments(
        chunks.map((c) => (c.contextPrefix ? `${c.contextPrefix}\n${c.body}` : c.body)),
      );

      await this.deps.transaction((tx) =>
        replaceChunks(
          tx,
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
        ),
      );
      const stored = await countChunks(this.deps.db, documentId);
      await setDocumentState(this.deps.db, documentId, 'ready', {
        chunkCount: stored,
        error: null,
        // What these chunks were ACTUALLY cut under, so staleness is derived rather than
        // flagged (CCB-S5-023). Taken from the same `settings` the chunking used, not read
        // again, so a save landing mid-ingest cannot record a signature nothing produced.
        ingestSignature: ingestSignature(settings),
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

    // ── THE TRIGGER IS CONSULTED HERE, AND IT WAS NOT ─────────────────────
    //
    // An adversarial read of the first version found that this setting was normalised,
    // persisted, audited, inventoried and shown, and read by nothing: `off` and `explicit`
    // both behaved exactly like `always`. That is the D-162 shape - a control a check can
    // drive is not a control an operator can use - and it is worse for being a control the
    // console offers with a sentence explaining what it does.
    //
    // `off` costs no embedding call at all, which is the point of it.
    if (settings.trigger === 'off') return empty;
    if (settings.trigger === 'explicit' && !asksForDocuments(text)) return empty;

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

  /** The ingest settings in force right now, for comparing against a stored signature. */
  currentIngestSignature(): string {
    return ingestSignature(this.deps.settings());
  }

  /**
   * Whether a document's stored chunks were cut under the settings in force now.
   *
   * A stale document is still RETRIEVABLE, deliberately: its chunks are the operator's
   * verbatim text, correctly stored, cut to a different length. Hiding it would silently
   * switch the knowledge base off the moment somebody moved a slider. See migration 053.
   *
   * NULL reads as unknown rather than as current, because it predates the column and
   * claiming it matches would be a claim nothing checked.
   */
  isStale(doc: { ingestSignature: string | null; state: string }): boolean {
    if (doc.state !== 'ready') return false;
    return doc.ingestSignature !== this.currentIngestSignature();
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
