/**
 * Ingesting a document, on the durable queue (CCB-S5-022, D-176).
 *
 * ── WHY THIS IS NOT DONE IN THE CONSOLE REQUEST ──────────────────────────────
 *
 * Measured on the operator's card with qwen3:32b resident: 32 chunks of ~1500 characters
 * took 21.2 s, about 660 ms a chunk. A 500 KB document is roughly 500 chunks, so about five
 * minutes. A POST handler holding a connection open for that would time out behind nginx,
 * and an operator watching a spinner cannot tell a slow ingest from a hung one.
 *
 * On the queue it also survives a restart. Without that, a deploy in the middle of an ingest
 * would leave a document in `ingesting` for ever, which is the worst of the states because
 * it is neither retrievable nor visibly broken.
 *
 * ── IDEMPOTENT BY CONSTRUCTION ───────────────────────────────────────────────
 *
 * `ingest` replaces the whole chunk set in one transaction, so running it twice produces
 * exactly the state running it once produces. That is what makes a retry safe, and it is why
 * the idempotency key is the document id and nothing finer: two enqueues for one document are
 * the same work, and the second should collapse into the first rather than double it.
 */

import { log } from '../../log.js';
import { status } from '../../web/status.js';
import { knowledgeService } from '../../knowledge/service.js';
import type { JobHandler } from '../types.js';

export const KNOWLEDGE_INGEST_JOB = 'knowledge.ingest';

/** One document, one pending ingest. */
export function knowledgeIngestKey(documentId: number): string {
  return `knowledge.ingest:${String(documentId)}`;
}

export const knowledgeIngestHandler: JobHandler = async (payload) => {
  const documentId = typeof payload['documentId'] === 'number' ? payload['documentId'] : null;
  if (documentId === null) {
    throw new Error('knowledge.ingest was enqueued without a document id.');
  }

  const service = knowledgeService();
  if (!service) {
    // NOT swallowed and NOT succeeded (CCB-S3-023). No service means the bot is not running,
    // and the document would sit in `pending` looking like it was being worked on. Throwing
    // puts the job back on the queue with backoff, so it completes when the bot returns.
    throw new Error(
      'knowledge.ingest ran with no knowledge service registered, so the document was not ' +
        'ingested. This is the bot not running rather than the document being bad.',
    );
  }

  const started = Date.now();
  const { chunks } = await service.ingest(documentId);
  log.info('queue: ingested a knowledge document', {
    documentId,
    chunks,
    ms: Date.now() - started,
  });
  if (chunks === 0) {
    // Zero chunks is legitimate for an empty file and is a surprise for anything else, so it
    // is said out loud rather than left to be discovered as a document that answers nothing.
    status.error(
      `Document ${String(documentId)} ingested with 0 chunks. It is stored and granted but ` +
        `there is nothing in it to retrieve; check that the file was not empty.`,
    );
  }
};
