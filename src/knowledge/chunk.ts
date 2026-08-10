/**
 * Cutting a document into what gets stored (CCB-S5-022, D-176).
 *
 * ── THE ONE RULE: WHAT COMES OUT IS WHAT WENT IN ─────────────────────────────
 *
 * Every character of every chunk body is a character of the source, in order. This module
 * cuts and it does not write. No summary, no paraphrase, no model.
 *
 * That is the finding of arXiv 2601.00821, which varied only the stored representation
 * inside one fixed pipeline: verbatim chunks beat LLM-extracted artifacts by 15.9 points on
 * LoCoMo and 22.0 on LongMemEval-S, and the mechanism was lossy distillation rather than
 * structure. The failure mode of the alternative is the dangerous kind: an extraction
 * pipeline looks like it works, and what it lost is invisible until somebody asks the one
 * question the lost sentence answered.
 *
 * ── THE CONTEXT LINE IS DERIVED, NOT WRITTEN ─────────────────────────────────
 *
 * Anthropic's contextual retrieval prepends a statement of where a chunk came from before
 * indexing it, and reports failed retrievals down 49% (67% with reranking). Their version
 * asks a model to describe each chunk against the whole document. This one DERIVES the line
 * from the title, the heading path and the position, for two reasons: a model-written line
 * is a model-written artifact in the store, which is the thing the paragraph above rules
 * out; and it would cost one generation per chunk at ingest, against a corpus the operator
 * re-ingests whenever he changes a chunking setting.
 *
 * The derived line carries most of what the technique is for. What it cannot do is resolve a
 * pronoun ("the company's revenue" -> which company), and the operator's material is
 * technical prose with explicit subjects, where headings carry the referent.
 *
 * ── WHY THESE SIZES ──────────────────────────────────────────────────────────
 *
 * 1000 characters, 150 of overlap, hard ceiling 1400. Roughly 250 tokens per chunk at four
 * characters a token, so four chunks fit inside the 2400-character retrieval budget with
 * room for the context lines.
 *
 * The corpus is what set it: protocol work full of exact identifiers alongside prose. A
 * smaller chunk retrieves an identifier precisely and hands the model a line with no
 * surrounding sentence to interpret it; a larger one buries the identifier among paragraphs
 * about other things and spends the budget on them. 1000 keeps a chunk to about one idea
 * while still carrying the sentence that says what the idea is for.
 *
 * The overlap is 15%, and it exists for one specific failure: a definition that straddles a
 * boundary is otherwise retrievable from neither side, because neither side contains both
 * the term and its meaning. Both of these are GUESSES calibrated to the corpus rather than
 * measured optima, which is why they are settings and not constants.
 *
 * Boundaries are chosen structurally before they are chosen by length: a markdown heading
 * always starts a chunk, and paragraphs are kept whole where they fit. Cutting mid-sentence
 * is the last resort, not the method.
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
  /** VERBATIM source text. */
  body: string;
  /** Derived, for indexing. Empty when the setting is off. */
  contextPrefix: string;
  /** The heading path this chunk sits under, for the console and the context line. */
  headingPath: string;
}

/** A block of source text with the heading path it sits under. */
interface Block {
  text: string;
  headingPath: string;
}

const HEADING = /^(#{1,6})\s+(.*)$/;

/**
 * Split into blocks, remembering the heading each one sits under.
 *
 * Headings are kept as text rather than consumed: a heading is part of the document and
 * dropping it would lose the one line that most often names the subject.
 */
function blocksOf(body: string): Block[] {
  const out: Block[] = [];
  const path: string[] = [];
  let buffer: string[] = [];

  const flush = (): void => {
    const text = buffer.join('\n').trim();
    buffer = [];
    if (text) out.push({ text, headingPath: path.join(' > ') });
  };

  for (const line of body.split(/\r?\n/)) {
    const heading = HEADING.exec(line);
    if (heading) {
      flush();
      const depth = (heading[1] ?? '#').length;
      const title = (heading[2] ?? '').trim();
      path.length = Math.max(0, depth - 1);
      path[depth - 1] = title;
      // The heading itself opens the next block, so it is indexed with the text under it.
      buffer.push(line);
      continue;
    }
    if (line.trim() === '') {
      // A blank line ends a paragraph but not a section: keep the heading path.
      buffer.push('');
      continue;
    }
    buffer.push(line);
  }
  flush();
  return out;
}

/** The tail of `text`, cut at a sentence or word boundary rather than mid-word. */
function tailOverlap(text: string, chars: number): string {
  if (chars <= 0 || text.length <= chars) return text.length <= chars ? text : '';
  const tail = text.slice(-chars);
  // Prefer starting the overlap at a sentence, then at a word. A fragment beginning
  // mid-word is noise in both the index and the prompt.
  const sentence = tail.search(/(?<=[.!?])\s+/);
  if (sentence >= 0 && sentence < chars * 0.6) return tail.slice(sentence).trimStart();
  const space = tail.indexOf(' ');
  return space >= 0 ? tail.slice(space + 1) : tail;
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
 * database and no model: every chunk body is a substring of the source, and the chunks in
 * order cover it.
 */
export function chunkDocument(
  doc: ChunkableDocument,
  settings: ChunkSettings = CHUNK_DEFAULTS,
): Chunk[] {
  const target = Math.max(200, Math.min(settings.targetChars, settings.maxChars));
  const max = Math.max(target, settings.maxChars);
  const overlap = Math.max(0, Math.min(settings.overlapChars, Math.floor(target / 2)));

  const pieces: { body: string; headingPath: string }[] = [];
  let current = '';
  let currentPath = '';

  const push = (): void => {
    const body = current.trim();
    current = '';
    if (body) pieces.push({ body, headingPath: currentPath });
  };

  for (const block of blocksOf(doc.body)) {
    // A heading starts a new chunk: the structure the author chose is a better boundary
    // than any length the settings name.
    if (current && (block.headingPath !== currentPath || current.length >= target)) {
      const carry = tailOverlap(current, overlap);
      push();
      current = carry ? `${carry}\n` : '';
    }
    if (!current) currentPath = block.headingPath;

    let text = block.text;
    // A single block longer than the ceiling is cut by length, which is the last resort.
    while (current.length + text.length > max) {
      const room = max - current.length;
      if (room < 80) {
        const carry = tailOverlap(current, overlap);
        push();
        current = carry ? `${carry}\n` : '';
        currentPath = block.headingPath;
        continue;
      }
      // Cut at the last paragraph, then sentence, then space inside the room available.
      const head = text.slice(0, room);
      const at =
        Math.max(head.lastIndexOf('\n\n'), head.lastIndexOf('. '), head.lastIndexOf(' ')) + 1;
      const cut = at > 80 ? at : room;
      current += head.slice(0, cut);
      text = text.slice(cut);
      const carry = tailOverlap(current, overlap);
      push();
      current = carry ? `${carry}\n` : '';
      currentPath = block.headingPath;
    }
    current += (current ? '\n\n' : '') + text;
  }
  push();

  return pieces.map((piece, index) => ({
    ord: index,
    body: piece.body,
    headingPath: piece.headingPath,
    contextPrefix: settings.contextualPrefix
      ? contextLineFor(doc.title, piece.headingPath, index, pieces.length)
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
