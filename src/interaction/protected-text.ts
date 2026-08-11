/**
 * The lines the APPLICATION writes, and which she may therefore never write (CCB-S5-027).
 *
 * ── THE DEFECT ───────────────────────────────────────────────────────────────
 *
 * Observed in the operator's group. Under one knowledge-base answer there were TWO
 * attribution lines: one she had written herself, inline at the end of her prose, naming a
 * single document; and the application's own underneath it, naming two. Hers was a
 * forgery. It was in the application's format, it read exactly like the real thing, and it
 * did not even agree with the real thing sitting one line below it.
 *
 * ── WHERE SHE LEARNED IT, WHICH IS THE PART WORTH KNOWING ────────────────────
 *
 * She has conversation memory (CCB-S4-044, D-147), and memory is the whole group thread
 * INCLUDING her own replies as they were sent. The application appends the source line
 * AFTER she writes, so what memory hands back to her an hour later is her prose with a
 * source line attached to it. Twenty of those in a window and the format is simply how her
 * answers look. Nobody instructed her to write one; the product taught her the shape by
 * showing her its own output and calling it hers.
 *
 * That is the general form and it is worth stating plainly: **anything the application
 * appends to her words becomes, through memory, an example of how she writes.** The source
 * line has that shape. So does the moderation warning with its count, so does the sanction
 * announcement, so does every persona line whose placeholders the application fills.
 *
 * ── WHAT COUNTS AS PROTECTED, DERIVED RATHER THAN LISTED ─────────────────────
 *
 * A list of four keys would go stale the first time somebody adds a fifth, and nothing
 * would say so - which is the D-105 failure exactly. So the set is DERIVED: a persona line
 * is protected when its template carries a placeholder the application fills. That is the
 * definition of "a fact the application owns", it is machine-readable, and a persona key
 * added by a later briefing is covered on the day it is added rather than on the day
 * somebody remembers.
 *
 * The marker is the literal run in front of the FIRST placeholder, because that is the part
 * a forgery has to reproduce to look like the real thing:
 *
 *   `📄 From what you gave me: {sources}`            ->  `📄 From what you gave me:`
 *   `⚠️ That is warning {n} of {total}, and it ...`  ->  `⚠️ That is warning`
 *   `💰 *{amount} {base}* are about ...`             ->  (too short, no marker)
 *
 * A template whose placeholder comes first, or almost first, yields nothing usable and is
 * skipped rather than turned into a marker that would match half her vocabulary. That is a
 * real hole and {@link markersFromTemplates} reports it, because an operator who rewrites a
 * persona line to open with `{n}` has silently removed a guard.
 *
 * ── A DRAFT SHE WAS GIVEN IS NOT A FORGERY ───────────────────────────────────
 *
 * The command lanes hand the model an application-written draft and ask for it in her
 * voice, so the STATUS reply legitimately comes back containing the status line. Stripping
 * it there would delete the answer. So a marker that appears in the deterministic draft is
 * dropped from the guard FOR THAT CALL: if the application gave her the words, she may
 * carry them; if it did not, she may not invent them. That is a property of the request
 * rather than a list of exempt modes, so a new lane cannot forget to be exempt or forget to
 * be guarded.
 *
 * ── STRIP, DO NOT REJECT, AND THIS IS DELIBERATELY UNLIKE `blockedLiterals` ───
 *
 * `blockedLiterals` and the unresolved-placeholder guard both REJECT, and the reasoning
 * there was that stripping leaves a hole in a sentence: `Hey {name}, good to see you`
 * becomes `Hey , good to see you`. That reasoning does not transfer. A forged attribution
 * is a whole trailing line, or the tail of one; removing it leaves the answer intact and
 * complete, and the application then appends the true line in its place.
 *
 * The costs point the same way. Rejecting a free-conversation reply costs the member the
 * ANSWER, because that lane has no deterministic draft to fall back to: they would get "I
 * heard you, but I could not find my words just now" for a reply that was good apart from
 * a decoration. Rejecting the answer to punish the footnote is the wrong trade.
 *
 * It is not silent. Every strip is counted and recorded for the Diagnostics page
 * (`forgery-log.ts`), because a fallback that can mask a fault is counted and the count is
 * shown in the admin (CCB-S3-023).
 *
 * ── THE FLOOR IS A TERM LIST, AND A TERM LIST IS NOT A SOLUTION ──────────────
 *
 * {@link SHIPPED_ATTRIBUTION_OPENERS} catches the shapes a model reaches for when it is not
 * copying the template exactly: `Source:`, `Quelle:`, and the four shipped defaults even
 * after an operator has reworded the persona, because what she learned from memory is the
 * wording that was live at the time. It misses paraphrase and it always will. It is a floor
 * under the other three layers of this fix, not a replacement for them, and the layer that
 * actually holds is that she is no longer shown a source line at all - not in her memory,
 * and not as a document name beside a passage she was handed.
 *
 * ── PURE ─────────────────────────────────────────────────────────────────────
 *
 * No settings import, no database, no transport. The caller passes templates in and gets
 * markers back, so a check drives this with two string arrays.
 */

/**
 * The shortest literal run that may become a marker.
 *
 * Measured against the shipped persona rather than chosen: `📄 From what you gave me:` is
 * 24, `⚠️ That is warning` is 17, `🔒 That is a` is 11, and `💰 *` is 3. Eight sits between
 * the shortest real marker and the longest useless one with room on both sides. Below it a
 * "marker" is punctuation and an emoji, which would match ordinary prose.
 */
export const MIN_MARKER_CHARS = 8;

/** The placeholder grammar, borrowed from `fillPersona` so the two cannot disagree. */
const PLACEHOLDER = /\{(\w+)\}/;

/**
 * The variation selector. Present in `⚠️`, absent in `⚠`, invisible in both.
 *
 * Written as an escape rather than as the character, because the character is invisible in
 * source and a reader cannot tell a file that contains one from a file that does not.
 */
const VARIATION_SELECTOR = /\uFE0F/g;

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * A marker as a pattern that tolerates the two ways the same line renders differently.
 *
 * WHITESPACE, because a model that reproduces a line rarely reproduces its spacing, and
 * VARIATION SELECTORS, because `⚠️` and `⚠` are the same character to a reader and two
 * different strings to `includes`. Everything else is matched literally and
 * case-insensitively.
 */
function markerPattern(marker: string): RegExp {
  const source = [...marker.replace(VARIATION_SELECTOR, '').replace(/\s+/g, ' ')]
    .map((ch) => (ch === ' ' ? '\\s+' : `${escapeRegExp(ch)}\\uFE0F?`))
    .join('');
  return new RegExp(source, 'iu');
}

/** List decoration a model puts in front of a line it is quoting. Never content. */
const DECORATION = /^[\s>*_#\u2022\u00b7\u2013-]*$/u;

/**
 * The shapes a forgery takes when it is not copying a template character for character.
 *
 * LINE START ONLY, unlike the derived markers. These are ordinary words: `sources:` inside
 * a sentence is prose, and cutting a sentence in half at it would be worse than the defect.
 * At the start of a line, after decoration, it is an attribution and nothing else.
 *
 * The four shipped defaults are here PERMANENTLY, even though an operator who has reworded
 * the persona would also produce them from the template. What she copied out of her own
 * memory is whatever the wording was when she sent it, and a persona edited last week does
 * not unteach a month of thread.
 */
export const SHIPPED_ATTRIBUTION_OPENERS: readonly string[] = [
  'From the web:',
  'From what you gave me:',
  'Aus dem Netz:',
  'Aus deinen Unterlagen:',
  'Source:',
  'Sources:',
  'Quelle:',
  'Quellen:',
];

/** What {@link markersFromTemplates} found, and what it could not make a marker of. */
export interface DerivedMarkers {
  /** Longest first, so the most specific match wins when two overlap. */
  markers: string[];
  /**
   * Templates that carry a placeholder and yielded no usable marker.
   *
   * Reported rather than passed over: each one is a line the application fills and the
   * guard cannot recognise, which is a hole somebody should know about.
   */
  unguarded: string[];
}

/**
 * The markers for a set of persona templates.
 *
 * A template with no placeholder is not protected: it carries no fact the application
 * filled in, so her writing something like it is a stylistic echo rather than a forged
 * statement about the world.
 */
export function markersFromTemplates(templates: Iterable<string>): DerivedMarkers {
  const markers = new Set<string>();
  const unguarded = new Set<string>();

  for (const template of templates) {
    const at = PLACEHOLDER.exec(template);
    if (!at) continue;
    const literal = template.slice(0, at.index).trim();
    if (literal.replace(VARIATION_SELECTOR, '').length >= MIN_MARKER_CHARS) markers.add(literal);
    else unguarded.add(template);
  }

  return {
    markers: [...markers].sort((a, b) => b.length - a.length),
    unguarded: [...unguarded],
  };
}

/** One line the guard took out, for the log and for the operator. */
export interface RemovedLine {
  /** What was removed, trimmed. Her own words, never a member's message. */
  text: string;
  /** Whether it stood on its own line or was tacked onto the end of a sentence. */
  where: 'line' | 'inline';
}

export interface StripResult {
  text: string;
  removed: RemovedLine[];
}

/**
 * Removes anything in `text` that imitates one of the application's own lines.
 *
 * Two placements, because production produced the second one: a forged line on its own is
 * dropped whole, and a forged line tacked onto the end of a sentence is CUT AT THE MARKER
 * with the sentence kept. Cutting rather than dropping matters - the observed forgery sat
 * "inline at the end of her prose", and dropping that line would have taken the answer with
 * it.
 *
 * `draft` is whatever the application handed the model to reword. Any marker occurring in
 * it is not a forgery and is left alone; see the header.
 */
export function stripProtectedLines(
  text: string,
  markers: readonly string[],
  draft = '',
): StripResult {
  const active = markers.filter((marker) => !draft.includes(marker));
  if (active.length === 0 && SHIPPED_ATTRIBUTION_OPENERS.length === 0) return { text, removed: [] };

  const anywhere = active.map(markerPattern);
  // The floor is anchored, so an opener that is also an ordinary word cannot cut a sentence
  // in half from the middle of one.
  const atStart = SHIPPED_ATTRIBUTION_OPENERS.filter((opener) => !draft.includes(opener)).map(
    (opener) => new RegExp(`^\\s*${markerPattern(opener).source}`, 'iu'),
  );

  const removed: RemovedLine[] = [];
  const kept: string[] = [];

  for (const line of text.split('\n')) {
    let cut = -1;
    for (const pattern of anywhere) {
      const hit = pattern.exec(line);
      if (hit && (cut === -1 || hit.index < cut)) cut = hit.index;
    }
    if (cut === -1 && atStart.some((pattern) => pattern.test(line))) cut = 0;

    if (cut === -1) {
      kept.push(line);
      continue;
    }

    const before = line.slice(0, cut);
    const tail = line.slice(cut).trim();
    if (DECORATION.test(before)) {
      removed.push({ text: tail, where: 'line' });
      continue;
    }
    removed.push({ text: tail, where: 'inline' });
    // Trailing separators are taken with it: `... and that is that. 📄 From ...` must not
    // leave a dangling opener behind, and `(📄 From ...)` must not leave a lone bracket.
    const head = before.replace(/[\s([{<"'`,;:—–-]+$/u, '').trimEnd();
    if (head !== '') kept.push(head);
  }

  if (removed.length === 0) return { text, removed: [] };

  const cleaned = kept
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  return { text: cleaned, removed };
}
