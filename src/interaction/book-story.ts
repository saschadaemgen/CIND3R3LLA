/**
 * The Book, told as an artefact (CCB-S4-050, D-152).
 *
 * ── THE DISTINCTION THIS EXISTS TO MAKE ──────────────────────────────────────
 *
 * Asked about her RULES or LAWS, she answers normally: CCB-S4-048's overview, then a
 * follow-up with quoted rules. That works and is untouched.
 *
 * Asked about the BOOK OF ELII, she tells a story. The Book is not the content, it is the
 * artefact, and until now both questions landed on the same paragraph of counts, which reads
 * like a database and not like a thing named after a book carried through a wasteland.
 *
 * ── WHAT MAKES IT AN ARTEFACT RATHER THAN AN ANSWER ──────────────────────────
 *
 * The ritual. She does not simply start talking: she says she is about to read, and takes a
 * beat to set the mood. That one short message is the whole difference between a lookup and a
 * ceremony, and it costs one message.
 *
 * ── THE SPLIT, WHICH IS CCB-S4-047's SPLIT ───────────────────────────────────
 *
 * Authored: how many beats, what each is about, the icon, and the plain line to fall back to.
 * Hers: the words. The model is told what this beat is FOR and never handed a script, so it
 * reads differently at different sharpness settings, which is what "with some gravity" has to
 * mean for something that must also work every time.
 *
 * The facts are not hers. The counts come from the application and travel as required
 * literals, per D-137, exactly as the overview's do.
 */

import type { RuleOverview } from './rule-overview.js';

/**
 * The icon set, small and fixed.
 *
 * Small on purpose. A recognisable artefact needs a handful of marks used consistently, not a
 * decorated line; the point is that somebody scrolling a busy chat knows what they are looking
 * at before they read a word.
 */
export const BOOK_ICONS = Object.freeze({
  ritual: '🕯️',
  book: '📖',
  record: '📜',
  seal: '🕯️',
  withheld: '🔒',
});

export interface BookStoryBeat {
  id: string;
  /** The icon this beat opens with. */
  icon: string;
  /** What this beat is for, handed to the model. Never a script. */
  brief: string;
  /** What she reads when the model gives nothing usable. */
  fallback: string;
}

/**
 * How long the story runs.
 *
 * THREE by default, which is the operator's "two or three" and the shorter end of it, because
 * his objection to the recital was never the drama, it was the volume in a live group. Three
 * is the ritual, the artefact and the record; anything less loses one of them.
 *
 * The bound is an operator setting so a set piece is available, and it is clamped in code as
 * well as in the form, like every other message bound on this path.
 */
export const BOOK_STORY_MIN_BEATS = 2;
export const BOOK_STORY_MAX_BEATS = 6;
export const BOOK_STORY_DEFAULT_BEATS = 3;

/**
 * The story, as briefs rather than lines.
 *
 * Ordered so that dropping from the end still leaves something coherent: the ritual and the
 * artefact are the two that must survive a tight bound, and the record and the withholding are
 * what a longer setting buys.
 */
export function bookStoryBeats(overview: RuleOverview, german: boolean): BookStoryBeat[] {
  const total = String(overview.total);
  const constitutional = String(overview.constitutional);

  return german
    ? [
        {
          id: 'ritual',
          icon: BOOK_ICONS.ritual,
          brief:
            'Sag in EINEM kurzen Satz, dass du gleich aus dem Buch von Elii vorliest und dafuer ' +
            'einen Moment brauchst, um die richtige Stimmung zu schaffen. Lies noch nichts vor.',
          fallback: 'Einen Moment. Dafuer braucht es das richtige Licht.',
        },
        {
          id: 'artefact',
          icon: BOOK_ICONS.book,
          brief:
            `Sag, was das Buch von Elii IST: jedes Gesetz, unter dem du laeufst, aufgeschrieben, wo man es lesen kann, statt vergraben im Code. Es sind ${total} davon, ${constitutional} davon so tief eingeritzt, dass kein Regler sie biegt. Nenne beide Zahlen genau so. Sag auch, warum das absichtlich lesbar ist: eine Regel, die man nicht lesen kann, ist eine Regel, der man nicht trauen kann.`,
          fallback: `Das Buch von Elii. ${total} Gesetze, ${constitutional} davon unverrueckbar, aufgeschrieben statt vergraben.`,
        },
        {
          id: 'record',
          icon: BOOK_ICONS.record,
          brief:
            'Sag, dass das Buch sich erinnert: jede Aenderung an einem Gesetz, wer sie gemacht hat und was vorher dastand, und wann ein Gesetz angewendet wurde. Sag dann, dass manche Seiten deine sind, weil ihr genauer Wortlaut ein Hebel ist, und lade dazu ein, nach einem einzelnen Gesetz zu fragen.',
          fallback:
            'Das Buch erinnert sich: jede Aenderung, wer sie gemacht hat, und wann ein Gesetz angewendet wurde. Manche Seiten bleiben meine. Frag mich nach einer davon.',
        },
      ]
    : [
        {
          id: 'ritual',
          icon: BOOK_ICONS.ritual,
          brief:
            'Say in ONE short line that you are about to read from the Book of Elii and need a ' +
            'moment to set the mood for it. Do not read anything yet.',
          fallback: 'Give me a moment. This one needs the right light.',
        },
        {
          id: 'artefact',
          icon: BOOK_ICONS.book,
          brief:
            `Say what the Book of Elii IS: every law you run under, written down where anybody can read it rather than buried in code. There are ${total} of them, and ${constitutional} are carved deep enough that no dial bends them. State both numbers exactly as written. Say why the readability is deliberate: a rule you cannot read is a rule you cannot trust.`,
          fallback: `The Book of Elii. ${total} laws, ${constitutional} of them carved too deep for any dial, written down rather than buried in code.`,
        },
        {
          id: 'record',
          icon: BOOK_ICONS.record,
          brief:
            'Say that the Book remembers: every change to a law, who made it and what it said before, and when a law was invoked. Then say that some pages are yours to keep, because their exact wording is a lever and you do not hand levers to strangers, and invite them to ask what is written on any page they like.',
          fallback:
            'The Book remembers: every change to a law, who made it, and when a law was applied. Some pages stay mine. Ask me what is written on any of the others.',
        },
      ];
}

/** The beats this bound allows, from the front. */
export function planBookStory(
  overview: RuleOverview,
  opts: { german: boolean; maxBeats: number },
): BookStoryBeat[] {
  const bound = Math.max(
    BOOK_STORY_MIN_BEATS,
    Math.min(BOOK_STORY_MAX_BEATS, opts.maxBeats),
  );
  return bookStoryBeats(overview, opts.german).slice(0, bound);
}
