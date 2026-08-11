/**
 * Cutting a document into what gets stored (CCB-S5-022, D-176).
 *
 * ── THE ONE RULE: WHAT COMES OUT IS WHAT WENT IN ─────────────────────────────
 *
 * Every chunk body is `source.slice(start, end)`. This module cuts and it does not write.
 * No summary, no paraphrase, no model, and no separator of its own.
 *
 * That is the finding of arXiv 2601.00821, which varied only the stored representation
 * inside one fixed pipeline: verbatim chunks beat LLM-extracted artifacts by 15.9 points on
 * LoCoMo and 22.0 on LongMemEval-S, and the mechanism was lossy distillation. The failure
 * mode of the alternative is the dangerous kind: an extraction pipeline looks like it works,
 * and what it lost is invisible until somebody asks the one question the lost sentence
 * answered.
 *
 * ── WHY THIS WORKS IN OFFSETS, AND NOT IN STRINGS ────────────────────────────
 *
 * The first version built each chunk by concatenating blocks, and it broke its own one rule
 * in two ways that no amount of care would have prevented, because the rule was aspirational
 * rather than structural:
 *
 *   1. Rejoining an overlap carry to the next block INSERTED SEPARATORS the source does not
 *      have (three newlines where the document had one blank line). For prose that is inert;
 *      for a long unbroken run of characters it put a line break INSIDE AN IDENTIFIER,
 *      defeating exactly the exact-match retrieval the keyword half exists for.
 *   2. The heading path was captured under a condition that could never fire once an overlap
 *      was being carried, so every chunk in a document inherited the FIRST heading. Both
 *      halves of hybrid retrieval then indexed each chunk under a section it was not in,
 *      with a well-formed, plausible, wrong sentence. That is the inverse of what contextual
 *      retrieval is for.
 *
 * Both were found by an adversarial read that EXECUTED the module rather than inspecting it,
 * and the harness's own headline assertion had been passing straight over them: it compared
 * only each chunk's first line, and squashed whitespace before comparing order, so an
 * injected separator was invisible to it.
 *
 * A chunk is now a HALF-OPEN RANGE into the source. Verbatim stops being a property somebody
 * has to maintain and becomes one the shape of the operation guarantees: nothing
 * concatenates, so no code path can add a character. Overlap is `start[n+1] < end[n]`, which
 * is what overlap actually means, rather than a copied tail glued back on.
 *
 * ── THE CONTEXT LINE IS DERIVED, NOT WRITTEN ─────────────────────────────────
 *
 * Anthropic's contextual retrieval prepends a statement of where a chunk came from before
 * indexing it, and reports failed retrievals down 49% (67% with reranking). Their version
 * asks a model to describe each chunk against the whole document. This one DERIVES the line
 * from the title, the heading path and the position, for two reasons: a model-written line
 * is a model-written artifact in the store, which is the thing the rule above forbids; and it
 * would cost one generation per chunk at ingest, against a corpus the operator re-ingests
 * whenever he changes a chunking setting.
 *
 * ── WHY THESE SIZES ──────────────────────────────────────────────────────────
 *
 * 1000 characters, 150 of overlap, hard ceiling 1400. Roughly 250 tokens per chunk at four
 * characters a token, so a few chunks fit inside the 2400-character retrieval budget.
 *
 * The corpus set it: protocol work full of exact identifiers alongside prose. A smaller chunk
 * retrieves an identifier precisely and hands the model a line with no surrounding sentence
 * to interpret it; a larger one buries the identifier among paragraphs about other things and
 * spends the budget on them. The overlap exists for one specific failure: a definition that
 * straddles a boundary is otherwise retrievable from neither side. Both are GUESSES
 * calibrated to the corpus rather than measured optima, which is why they are settings.
 */

/** What a document has to look like to be cut up. */
export interface ChunkableDocument {
  title: string;
  body: string;
}

export interface ChunkSettings {
  /** Target characters per chunk. */
  targetChars: number;
  /** Characters of the previous chunk repeated at the start of the next. */
  overlapChars: number;
  /** Nothing may exceed this, whatever the structure says. */
  maxChars: number;
  /** Whether the deterministic context line is generated and indexed. */
  contextualPrefix: boolean;
}

export const CHUNK_DEFAULTS: Readonly<ChunkSettings> = Object.freeze({
  targetChars: 1000,
  overlapChars: 150,
  maxChars: 1400,
  contextualPrefix: true,
});

export interface Chunk {
  ord: number;
  /** VERBATIM: a slice of the source, by construction. */
  body: string;
  /** Derived, for indexing. Empty when the setting is off. */
  contextPrefix: string;
  /** The heading path this chunk OPENS under, for the context line. */
  headingPath: string;
}

/** One paragraph of the source, as offsets, with the heading path in force there. */
interface Segment {
  start: number;
  end: number;
  headingPath: string;
  /** True when this segment begins with a markdown heading. */
  opensSection: boolean;
}

const HEADING = /^(#{1,6})\s+(.*)$/;

/**
 * Split the source into paragraph segments, recording offsets and the heading path.
 *
 * The heading LINE is kept as part of the segment it opens: it is text the author wrote, and
 * it is usually the line that names the subject.
 */
function segmentsOf(body: string): Segment[] {
  const out: Segment[] = [];
  const path: string[] = [];
  let segStart = -1;
  let segEnd = -1;
  let opensSection = false;
  let pathAtStart = '';

  const flush = (): void => {
    if (segStart >= 0 && segEnd > segStart) {
      out.push({ start: segStart, end: segEnd, headingPath: pathAtStart, opensSection });
    }
    segStart = -1;
    segEnd = -1;
    opensSection = false;
  };

  let offset = 0;
  for (const line of body.split('\n')) {
    const lineStart = offset;
    const lineEnd = offset + line.length;
    offset = lineEnd + 1; // the newline `split` consumed

    const heading = HEADING.exec(line);
    if (heading) {
      flush();
      const depth = (heading[1] ?? '#').length;
      const title = (heading[2] ?? '').trim();
      // Truncate, then pad, then assign. A jump from h1 straight to h3 used to leave a
      // sparse hole that joined as an empty element, producing paths like " > Term".
      if (path.length > depth - 1) path.length = depth - 1;
      while (path.length < depth - 1) path.push('');
      path[depth - 1] = title;
      pathAtStart = path.filter((p) => p !== '').join(' > ');
      segStart = lineStart;
      segEnd = lineEnd;
      opensSection = true;
      continue;
    }
    if (line.trim() === '') {
      flush();
      continue;
    }
    if (segStart < 0) {
      segStart = lineStart;
      pathAtStart = path.filter((p) => p !== '').join(' > ');
    }
    segEnd = lineEnd;
  }
  flush();
  return out;
}

/**
 * Where the next chunk starts, given the one just closed.
 *
 * An OFFSET into the source, never a copied string. Snapped forward to a sentence or word
 * boundary so a chunk does not open mid-token, and strictly greater than `start`, so the
 * loop always advances.
 */
function overlapStart(source: string, start: number, end: number, overlap: number): number {
  if (overlap <= 0) return end;
  const want = Math.max(start + 1, end - overlap);
  const window = source.slice(want, end);
  const skipBlank = (at: number): number => {
    const rest = source.slice(at, end).search(/\S/);
    return rest < 0 ? end : at + rest;
  };
  const sentence = window.search(/(?<=[.!?])\s/);
  if (sentence >= 0 && sentence < window.length * 0.6) return skipBlank(want + sentence);
  const space = window.search(/\s/);
  if (space >= 0) return skipBlank(want + space);
  // No boundary inside the window: rather than open a chunk mid-token, take no overlap.
  return end;
}

/** Move a range inwards past whitespace, so a body neither starts nor ends blank. */
function tighten(source: string, start: number, end: number): { start: number; end: number } {
  let a = start;
  let b = end;
  while (a < b && /\s/.test(source[a] ?? '')) a++;
  while (b > a && /\s/.test(source[b - 1] ?? '')) b--;
  return { start: a, end: b };
}

/**
 * The line prepended for indexing.
 *
 * Deliberately readable: it goes into the tsvector and the embedding, so it should read as
 * the sentence a person would write about where this text sits.
 */
export function contextLineFor(
  title: string,
  headingPath: string,
  index: number,
  total: number,
): string {
  const where = headingPath ? `${title}, under "${headingPath}"` : title;
  return `From ${where} (part ${String(index + 1)} of ${String(total)}).`;
}

/**
 * Cut a document into chunks.
 *
 * Pure, so `verify:knowledge` can assert the verbatim property over real documents with no
 * database and no model, and it now asserts it as an EXACT substring rather than by
 * comparing first lines.
 */
export function chunkDocument(
  doc: ChunkableDocument,
  settings: ChunkSettings = CHUNK_DEFAULTS,
): Chunk[] {
  const source = doc.body;
  const target = Math.max(200, Math.min(settings.targetChars, settings.maxChars));
  const max = Math.max(target, settings.maxChars);
  const overlap = Math.max(0, Math.min(settings.overlapChars, Math.floor(target / 2)));

  const ranges: { start: number; end: number; headingPath: string }[] = [];
  let cur: { start: number; end: number; headingPath: string } | null = null;

  const close = (): void => {
    if (!cur) return;
    const t = tighten(source, cur.start, cur.end);
    if (t.end > t.start) ranges.push({ start: t.start, end: t.end, headingPath: cur.headingPath });
    cur = null;
  };

  for (const seg of segmentsOf(source)) {
    if (cur && (seg.opensSection || cur.end - cur.start >= target)) {
      const from = overlapStart(source, cur.start, cur.end, overlap);
      close();
      // The overlap opens the next chunk, and the heading path is the NEW section's, because
      // that is what this chunk is about. The previous version took it from whatever opened
      // the chunk before and could never update it.
      cur = { start: Math.min(from, seg.start), end: seg.end, headingPath: seg.headingPath };
    } else if (cur) {
      cur.end = seg.end;
    } else {
      cur = { start: seg.start, end: seg.end, headingPath: seg.headingPath };
    }

    // A segment longer than the ceiling is cut by length, which is the last resort.
    while (cur !== null && cur.end - cur.start > max) {
      const open: { start: number; end: number; headingPath: string } = cur;
      const hardEnd = open.start + max;
      const window = source.slice(open.start, hardEnd);
      const at = Math.max(
        window.lastIndexOf('\n\n'),
        window.lastIndexOf('. '),
        window.lastIndexOf(' '),
      );
      const cutAt = at > 80 ? open.start + at + 1 : hardEnd;
      const rest = open.end;
      const from = overlapStart(source, open.start, cutAt, overlap);
      const path = open.headingPath;
      open.end = cutAt;
      close();
      // `overlapStart` returns something strictly greater than `start`, so the next range
      // always begins later than this one did and the loop cannot stall.
      cur = { start: Math.max(from, cutAt - max), end: rest, headingPath: path };
    }
  }
  close();

  return ranges.map((r, index) => ({
    ord: index,
    // THE WHOLE POINT: a slice, never a concatenation.
    body: source.slice(r.start, r.end),
    headingPath: r.headingPath,
    contextPrefix: settings.contextualPrefix
      ? contextLineFor(doc.title, r.headingPath, index, ranges.length)
      : '',
  }));
}

/**
 * The settings that decide what is IN the store, as opposed to how it is searched.
 *
 * Named as a set because changing any of them makes every existing chunk a chunk somebody
 * else's settings produced. `verify:knowledge` asserts this list against the ingest path, so
 * a setting added later without being named here cannot silently escape the staleness rule.
 */
export const INGEST_SETTING_KEYS = Object.freeze([
  'targetChars',
  'overlapChars',
  'maxChars',
  'contextualPrefix',
] as const);

/** True when two ingest settings would produce different chunks. */
export function ingestSettingsDiffer(a: ChunkSettings, b: ChunkSettings): boolean {
  return INGEST_SETTING_KEYS.some((key) => a[key] !== b[key]);
}

/**
 * The settings a document was chunked under, as one comparable string (CCB-S5-023).
 *
 * Stored per document so STALENESS IS DERIVED rather than flagged: a document is stale when
 * its signature differs from the current one, which is recomputed on every render and cannot
 * drift. A boolean would go wrong the first time a re-ingest path forgot to clear it, and it
 * would go wrong silently.
 *
 * Built from {@link INGEST_SETTING_KEYS} rather than from a hand-written list, so an ingest
 * setting added later is in the signature the moment it exists. That is the D-105 shape: a
 * new field announces nothing, so the derivation has to go and look.
 */
export function ingestSignature(settings: ChunkSettings): string {
  return INGEST_SETTING_KEYS.map((key) => `${key}=${String(settings[key])}`).join(';');
}
