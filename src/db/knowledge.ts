/**
 * `cinderella_kb_*` - the knowledge base store (CCB-S5-022, D-176, migration 052).
 *
 * The reading models are `src/knowledge/chunk.ts` and `src/knowledge/retrieval.ts`; this is
 * the SQL. The one thing worth reading here is {@link searchChunks}, which is both halves of
 * hybrid retrieval in one statement.
 */

import type { Queryable } from './pool.js';
import { toVectorLiteral } from '../knowledge/embed.js';
import type { Candidate } from '../knowledge/retrieval.js';

export type DocumentState = 'pending' | 'ingesting' | 'ready' | 'failed';

export interface KbDocument {
  id: number;
  title: string;
  sourceName: string;
  contentType: string;
  byteSize: number;
  checksum: string;
  state: DocumentState;
  chunkCount: number;
  ingestError: string | null;
  ingestedAt: string | null;
  createdAt: string;
}

interface DocRow {
  id: string;
  title: string;
  source_name: string;
  content_type: string;
  byte_size: number;
  checksum: string;
  state: DocumentState;
  chunk_count: number;
  ingest_error: string | null;
  ingested_at: string | null;
  created_at: string;
}

const toDoc = (r: DocRow): KbDocument => ({
  id: Number(r.id),
  title: r.title,
  sourceName: r.source_name,
  contentType: r.content_type,
  byteSize: Number(r.byte_size),
  checksum: r.checksum,
  state: r.state,
  chunkCount: Number(r.chunk_count),
  ingestError: r.ingest_error,
  ingestedAt: r.ingested_at,
  createdAt: r.created_at,
});

const DOC_COLUMNS = `id, title, source_name, content_type, byte_size, checksum, state,
                     chunk_count, ingest_error, ingested_at, created_at`;

/** Every document, newest first. The console's list. */
export async function listDocuments(db: Queryable): Promise<KbDocument[]> {
  const { rows } = await db.query<DocRow>(
    `SELECT ${DOC_COLUMNS} FROM cinderella_kb_documents ORDER BY created_at DESC, id DESC`,
  );
  return rows.map(toDoc);
}

export async function getDocument(db: Queryable, id: number): Promise<KbDocument | null> {
  const { rows } = await db.query<DocRow>(
    `SELECT ${DOC_COLUMNS} FROM cinderella_kb_documents WHERE id = $1`,
    [id],
  );
  const row = rows[0];
  return row ? toDoc(row) : null;
}

export async function getDocumentBody(db: Queryable, id: number): Promise<string | null> {
  const { rows } = await db.query<{ body: string }>(
    `SELECT body FROM cinderella_kb_documents WHERE id = $1`,
    [id],
  );
  return rows[0]?.body ?? null;
}

/**
 * Store a document, or recognise one already stored.
 *
 * Keyed on the CHECKSUM: re-uploading identical bytes returns the existing row untouched
 * rather than re-embedding it, because embedding a large document is minutes of GPU time and
 * an operator who drags the same file in twice has not asked for that.
 */
export async function upsertDocument(
  db: Queryable,
  doc: {
    title: string;
    sourceName: string;
    contentType: string;
    body: string;
    checksum: string;
  },
): Promise<{ id: number; alreadyStored: boolean }> {
  const existing = await db.query<{ id: string }>(
    `SELECT id FROM cinderella_kb_documents WHERE checksum = $1`,
    [doc.checksum],
  );
  const found = existing.rows[0];
  if (found) return { id: Number(found.id), alreadyStored: true };

  const { rows } = await db.query<{ id: string }>(
    `INSERT INTO cinderella_kb_documents
       (title, source_name, content_type, body, byte_size, checksum, state)
     VALUES ($1, $2, $3, $4, $5, $6, 'pending')
     RETURNING id`,
    [
      doc.title,
      doc.sourceName,
      doc.contentType,
      doc.body,
      Buffer.byteLength(doc.body, 'utf8'),
      doc.checksum,
    ],
  );
  const id = rows[0]?.id;
  if (id === undefined) throw new Error('Storing the document returned no id.');
  return { id: Number(id), alreadyStored: false };
}

export async function setDocumentState(
  db: Queryable,
  id: number,
  state: DocumentState,
  detail?: { chunkCount?: number; error?: string | null },
): Promise<void> {
  await db.query(
    `UPDATE cinderella_kb_documents
        SET state = $2,
            chunk_count = COALESCE($3, chunk_count),
            ingest_error = $4,
            ingested_at = CASE WHEN $2 = 'ready' THEN now() ELSE ingested_at END,
            updated_at = now()
      WHERE id = $1`,
    [id, state, detail?.chunkCount ?? null, detail?.error ?? null],
  );
}

/**
 * Remove a document entirely.
 *
 * The chunks go with it by cascade, which is what makes a removed document UNRETRIEVABLE
 * rather than merely hidden. A stale chunk outliving its document is the worst failure this
 * feature has, because it reads as knowledge.
 */
export async function deleteDocument(db: Queryable, id: number): Promise<boolean> {
  const { rowCount } = await db.query(`DELETE FROM cinderella_kb_documents WHERE id = $1`, [id]);
  return (rowCount ?? 0) > 0;
}

/* ── Which bot was given what ───────────────────────────────────────────────── */

export interface DocumentGrant {
  documentId: number;
  botProfileId: number;
  enabled: boolean;
}

export async function listGrants(db: Queryable): Promise<DocumentGrant[]> {
  const { rows } = await db.query<{ document_id: string; bot_profile_id: string; enabled: boolean }>(
    `SELECT document_id, bot_profile_id, enabled FROM cinderella_kb_document_bots`,
  );
  return rows.map((r) => ({
    documentId: Number(r.document_id),
    botProfileId: Number(r.bot_profile_id),
    enabled: r.enabled,
  }));
}

/** Give a document to a bot, or take it back. `null` removes the grant entirely. */
export async function setGrant(
  db: Queryable,
  documentId: number,
  botProfileId: number,
  enabled: boolean | null,
): Promise<void> {
  if (enabled === null) {
    await db.query(
      `DELETE FROM cinderella_kb_document_bots WHERE document_id = $1 AND bot_profile_id = $2`,
      [documentId, botProfileId],
    );
    return;
  }
  await db.query(
    `INSERT INTO cinderella_kb_document_bots (document_id, bot_profile_id, enabled)
     VALUES ($1, $2, $3)
     ON CONFLICT (document_id, bot_profile_id)
     DO UPDATE SET enabled = EXCLUDED.enabled, updated_at = now()`,
    [documentId, botProfileId, enabled],
  );
}

/* ── The chunks ─────────────────────────────────────────────────────────────── */

/**
 * Replace a document's chunks with a new set, in one transaction.
 *
 * DELETE then INSERT rather than a merge, and that is the staleness rule in its load-bearing
 * form: after this returns, nothing produced by the previous chunking is retrievable. A
 * merge would leave chunks from an old chunk size sitting beside new ones, and a store where
 * half the chunks were made under different settings is a store nobody can reason about.
 */
export async function replaceChunks(
  db: Queryable,
  documentId: number,
  chunks: readonly { ord: number; body: string; contextPrefix: string; embedding: number[] }[],
): Promise<void> {
  await db.query('BEGIN');
  try {
    await db.query(`DELETE FROM cinderella_kb_chunks WHERE document_id = $1`, [documentId]);
    for (const chunk of chunks) {
      await db.query(
        `INSERT INTO cinderella_kb_chunks (document_id, ord, body, context_prefix, embedding)
         VALUES ($1, $2, $3, $4, $5::vector)`,
        [documentId, chunk.ord, chunk.body, chunk.contextPrefix, toVectorLiteral(chunk.embedding)],
      );
    }
    await db.query('COMMIT');
  } catch (error) {
    await db.query('ROLLBACK');
    throw error;
  }
}

export async function countChunks(db: Queryable, documentId: number): Promise<number> {
  const { rows } = await db.query<{ n: string }>(
    `SELECT COUNT(*) AS n FROM cinderella_kb_chunks WHERE document_id = $1`,
    [documentId],
  );
  return Number(rows[0]?.n ?? 0);
}

/* ── Hybrid search ──────────────────────────────────────────────────────────── */

interface CandidateRow {
  chunk_id: string;
  document_id: string;
  title: string;
  ord: number;
  body: string;
  context_prefix: string;
  keyword_score: number | null;
  keyword_rank: number | null;
  vector_score: number | null;
  vector_rank: number | null;
}

/**
 * Both halves of hybrid retrieval, in one statement.
 *
 * ── WHAT THE SCOPE CTE IS FOR, AND WHY IT IS FIRST ───────────────────────────
 *
 * `scoped` is the only place the per-bot rule lives, and everything else selects from it. A
 * bot sees a chunk only when the document is `ready` AND granted to that bot AND the grant is
 * enabled. Filtering afterwards would mean the ranks were computed over documents the bot
 * cannot read, so a chunk it is allowed to see could be pushed out of the candidate list by
 * one it is not - a leak of ORDERING rather than of content, and still a leak.
 *
 * ── WHY EVERY CANDIDATE CARRIES A COSINE SCORE ───────────────────────────────
 *
 * The final SELECT computes the cosine similarity for every candidate, including the ones
 * only the keyword search found. The relevance floor is applied to that one calibrated
 * number (see `retrieval.ts`), so a chunk that arrived by keyword must be able to fail it.
 * Without this a keyword-only hit would bypass the floor entirely, which is exactly the
 * "confidently-delivered irrelevant chunk" the design exists to prevent.
 */
export async function searchChunks(
  db: Queryable,
  botProfileId: number,
  query: string,
  queryVector: readonly number[],
  candidatesPerSearch: number,
): Promise<Candidate[]> {
  const vec = toVectorLiteral(queryVector);
  const { rows } = await db.query<CandidateRow>(
    `WITH scoped AS (
       SELECT c.id, c.document_id, c.ord, c.body, c.context_prefix, c.embedding, c.tsv,
              d.title
         FROM cinderella_kb_chunks c
         JOIN cinderella_kb_documents d
           ON d.id = c.document_id AND d.state = 'ready'
         JOIN cinderella_kb_document_bots g
           ON g.document_id = d.id AND g.bot_profile_id = $1 AND g.enabled
     ),
     kw AS (
       SELECT id,
              ts_rank(tsv, plainto_tsquery('english', $2)) AS score,
              ROW_NUMBER() OVER (
                ORDER BY ts_rank(tsv, plainto_tsquery('english', $2)) DESC, id
              ) AS rank
         FROM scoped
        WHERE plainto_tsquery('english', $2) <> '' AND tsv @@ plainto_tsquery('english', $2)
        ORDER BY score DESC, id
        LIMIT $4
     ),
     vec AS (
       SELECT id,
              1 - (embedding <=> $3::vector) AS score,
              ROW_NUMBER() OVER (ORDER BY embedding <=> $3::vector, id) AS rank
         FROM scoped
        WHERE embedding IS NOT NULL
        ORDER BY embedding <=> $3::vector, id
        LIMIT $4
     )
     SELECT s.id                                   AS chunk_id,
            s.document_id                          AS document_id,
            s.title                                AS title,
            s.ord                                  AS ord,
            s.body                                 AS body,
            s.context_prefix                       AS context_prefix,
            kw.score                               AS keyword_score,
            kw.rank                                AS keyword_rank,
            -- Computed for EVERY candidate, not only the ones the vector search returned.
            1 - (s.embedding <=> $3::vector)       AS vector_score,
            vec.rank                               AS vector_rank
       FROM scoped s
       LEFT JOIN kw  ON kw.id  = s.id
       LEFT JOIN vec ON vec.id = s.id
      WHERE kw.id IS NOT NULL OR vec.id IS NOT NULL`,
    [botProfileId, query, vec, candidatesPerSearch],
  );

  return rows.map((r) => ({
    chunkId: Number(r.chunk_id),
    documentId: Number(r.document_id),
    documentTitle: r.title,
    ord: Number(r.ord),
    body: r.body,
    contextPrefix: r.context_prefix,
    keywordScore: Number(r.keyword_score ?? 0),
    vectorScore: Number(r.vector_score ?? -1),
    keywordRank: r.keyword_rank === null ? null : Number(r.keyword_rank),
    vectorRank: r.vector_rank === null ? null : Number(r.vector_rank),
    // The per-document weight is CCB-S5-023's control; neutral until it exists, and the
    // seam is here so adding it is a column and a select rather than a reshaped model.
    documentWeight: 1,
  }));
}

/** How many documents this bot has been given, and how many chunks they hold. */
export async function botCorpusSize(
  db: Queryable,
  botProfileId: number,
): Promise<{ documents: number; chunks: number }> {
  const { rows } = await db.query<{ documents: string; chunks: string }>(
    `SELECT COUNT(DISTINCT d.id) AS documents, COUNT(c.id) AS chunks
       FROM cinderella_kb_documents d
       JOIN cinderella_kb_document_bots g
         ON g.document_id = d.id AND g.bot_profile_id = $1 AND g.enabled
       LEFT JOIN cinderella_kb_chunks c ON c.document_id = d.id
      WHERE d.state = 'ready'`,
    [botProfileId],
  );
  return { documents: Number(rows[0]?.documents ?? 0), chunks: Number(rows[0]?.chunks ?? 0) };
}
