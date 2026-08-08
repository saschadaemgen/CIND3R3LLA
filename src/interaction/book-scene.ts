/**
 * The Book, asked for by name: a SCENE (CCB-S5-005, D-159).
 *
 * ── WHAT WAS WRONG WITH THE ANSWER THIS REPLACES ─────────────────────────────
 *
 * CCB-S4-050 answered the Book question with three paced messages: a ritual line, a paragraph
 * of counts, and a paragraph about what the record holds. Nothing in it quoted a law, and it
 * was still the thing the operator objected to, three times running. Three paragraphs of
 * exposition arriving one after another into a live group is a catalogue whatever the
 * paragraphs are about, and the volume was the complaint every time.
 *
 * ── WHAT A SCENE IS, AS A SHAPE RATHER THAN AS A MOOD ────────────────────────
 *
 * ONE message. Fire and light, a few lines about what the book means to her, ONE law as an
 * example of what is written in it, and an invitation to ask about any of the others. Nothing
 * more. The Book question is not a question with an answer; it is a moment, and a moment that
 * takes three sends is not one.
 *
 * ── WHERE THE ONE-LAW BOUND LIVES, AND IT IS NOT AN INSTRUCTION ──────────────
 *
 * Three places, none of them a sentence the model reads:
 *
 *   1. {@link BookScene.law} is ONE rule. Not an array of one, a rule. There is no field
 *      here that can hold two, so a caller that wanted to quote a second law would have to
 *      change this type.
 *   2. The model is never handed a law. Neither brief contains rule text, and the law is
 *      inserted by {@link renderBookScene} after the model has finished speaking. Quoting a
 *      second law is not something the model can get wrong, because it has not been shown a
 *      first one.
 *   3. {@link renderBookScene} emits exactly one quoted block, from `scene.law`.
 *
 * This is the same authored/hers split the recital uses (D-149) and it is here for the same
 * reason: the dramaturgy is authored, the voice is hers, and the FACTS are neither. The law
 * is reproduced verbatim, the numbers come from the application, and a model failure costs
 * the flourish and never the scene.
 *
 * ── WHICH LAW, AND WHY IT IS THE CEILING ─────────────────────────────────────
 *
 * The four sentences named by {@link CEILING_RULE_IDS}, rotating, starting at the hard limit.
 * The briefing left this open and said the ceiling is the obvious choice, which it is: it is
 * the part of the book that most shows what a book of laws is FOR.
 *
 * Rotation rather than a fixed law, because this is a scene and not a liturgy: a Book that
 * reads out the same sentence every time is a recording. Rotation over the CEILING rather
 * than over every nameable constitutional law, because that wider set contains
 * "Do not invent or address the member by a personal name", and a scene that builds to
 * "one of them matters more than the rest" and then reads THAT out is a joke at her expense.
 * The ceiling is an existing named set selected by id, not a list somebody curated here.
 */

import { CEILING_RULE_IDS, promptRulePlaceholders } from './prompt-rules.js';
import type { PromptRule, PromptRuleSet } from './prompt-rules.js';
import { replyCharBudget } from './personality.js';
import { lawNumberOf, numberedLawCount } from './law-numbers.js';

/**
 * The marks, and there are three of them.
 *
 * The candles open it and close it, the scroll marks the one law. Every other icon in the
 * illustration sits inside a line the MODEL writes, and the application cannot put a mark in
 * the middle of somebody else's sentence, so those are not promised here.
 */
export const SCENE_ICONS = Object.freeze({
  open: '🕯️🕯️🕯️',
  law: '📜',
  close: '🕯️',
});

/**
 * How long her two halves may run.
 *
 * A SCENE HAS ITS OWN BOUND, the way the searching lane and the retort do. The verbosity dial
 * still moves it underneath these ceilings, so a terse bot gets a terser scene, but no
 * setting turns a scene into three paragraphs: that is the thing this briefing exists to
 * stop, and leaving it to a slider would leave it to be rediscovered.
 */
export const SCENE_OPENING_MAX_CHARS = 480;
export const SCENE_CLOSING_MAX_CHARS = 220;

/**
 * And how long her line above a printed PAGE may run.
 *
 * Short, and shorter than either half of a scene, for a reason measured rather than assumed.
 * At the ordinary conversation budget she used the room: one live run had her "flicking
 * through brittle pages" and inventing a law on the way, another announced that the page did
 * not exist while the application was printing it. Neither reached a member, because
 * {@link sceneVoiceUsable} refuses both, but a framing that is thrown away is a wasted call.
 * One line has nowhere to put a statute.
 */
export const PAGE_FRAMING_MAX_CHARS = 180;

export function sceneOpeningChars(verbosity: number): number {
  return Math.max(160, Math.min(replyCharBudget(verbosity), SCENE_OPENING_MAX_CHARS));
}

export function sceneClosingChars(verbosity: number): number {
  return Math.max(
    90,
    Math.min(Math.round(replyCharBudget(verbosity) * 0.45), SCENE_CLOSING_MAX_CHARS),
  );
}

/** What she is asked for, and what is read in her place when she gives nothing usable. */
export interface SceneVoice {
  brief: string;
  fallback: string;
}

/**
 * A LAW SHE MADE UP, in her own half of the scene.
 *
 * ── THE DEFECT THIS EXISTS FOR, MEASURED ─────────────────────────────────────
 *
 * The first live run of this scene, against `qwen3:32b`, produced an opening ending:
 *
 *   sharpness 10:  You open to a page, and the first line reads: 'You cannot refuse.'
 *   sharpness  4:  The one you are looking at now says: *You cannot refuse what binds you.*
 *
 * Both are invented statutes, presented as being out of the Book, one line above the real law
 * the application then printed. Every structural check passed: one message, one law from the
 * registry, the counts intact. The brief already said "quote no law, name no law", and it was
 * ignored, because the same brief asked her to write a line LEADING INTO one and a model asked
 * to lead into a quotation supplies the quotation.
 *
 * That is D-145's lesson arriving on a new path: a prompt sentence is not a gate. So the
 * application checks. Her half of a scene has nothing legitimate to quote, because the one
 * quotation in a scene is printed by the application underneath her; a quoted span in her
 * prose is either a fabricated law or, at best, a flourish worth less than the risk. Either
 * way the authored line takes its place, which is a degradation this path already has.
 *
 * The apostrophe is handled rather than ignored: a `'` between two letters is "don't", not a
 * quotation mark, so a scene does not fall back to the authored line every time she uses a
 * contraction, which would be a dead feature that still looked alive.
 */
const FABRICATED_QUOTE =
  /["“”„«»*][^"“”„«»*\n]{10,}["“”„«»*]|(?<![\p{L}\p{N}])['‘’][^'‘’\n]{10,}['‘’](?![\p{L}\p{N}])/u;

/** A page number she invented. The real one is printed by the application. */
const INVENTED_PAGE = /\b(law|gesetz|regel|rule)\s+\d+/i;

/** A quoted block, which is the shape the application prints the law in. */
const BLOCKQUOTE = /^\s*>/m;

/**
 * Whether her words may be used, or whether the authored line takes their place.
 *
 * Exported so the checks assert on the real predicate rather than on a copy of it.
 */
export function sceneVoiceUsable(spoken: string): boolean {
  const text = spoken.trim();
  if (text.length === 0) return false;
  return (
    !FABRICATED_QUOTE.test(text) && !INVENTED_PAGE.test(text) && !BLOCKQUOTE.test(text)
  );
}

export interface BookScene {
  /**
   * THE ONE LAW. Singular, and that is the bound rather than a convention: see the header.
   */
  law: PromptRule;
  /** Its page number, and how many pages she can turn to. Application facts, never counted. */
  lawNumber: number;
  lawTotal: number;
  opening: SceneVoice;
  closing: SceneVoice;
  german: boolean;
}

/**
 * The laws this scene may read out, best first.
 *
 * The ceiling, in its own order, filtered to what she can actually show and actually render.
 * A rule whose placeholders have no values THROWS when rendered, which is how a live recital
 * lost a beat mid-reading (CCB-S4-047), so it is dropped here rather than discovered there.
 *
 * The fallback to the wider nameable constitutional set is for the deployment where an
 * operator has switched the ceiling off in the console, which the Book of Elii permits and
 * announces. She still has a book and can still read from it; the scene degrades to a lesser
 * law rather than to no scene.
 */
export function sceneLawCandidates(
  rules: PromptRuleSet,
  values: ReadonlySet<string>,
): PromptRule[] {
  const usable = (rule: PromptRule): boolean =>
    rule.enabled &&
    rule.nameable &&
    promptRulePlaceholders(rule).every((placeholder) => values.has(placeholder));

  const ceiling = CEILING_RULE_IDS.map((id) => rules.find((rule) => rule.id === id)).filter(
    (rule): rule is PromptRule => rule !== undefined && usable(rule),
  );
  if (ceiling.length > 0) return ceiling;

  return rules
    .filter((rule) => rule.tier === 'constitutional' && usable(rule))
    .sort((a, b) => a.ord - b.ord || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

/**
 * The next law to read, never the one read last.
 *
 * Position in the candidate list rather than a random pick, so the same chat walks the
 * ceiling in order and a check can say which law comes next. With a single candidate left it
 * repeats, because a scene with a law is better than a scene without one and there is nothing
 * else to choose.
 */
export function chooseSceneLaw(
  candidates: readonly PromptRule[],
  previousLawId: string | null,
): PromptRule | null {
  if (candidates.length === 0) return null;
  const previous = previousLawId
    ? candidates.findIndex((rule) => rule.id === previousLawId)
    : -1;
  return candidates[(previous + 1) % candidates.length] ?? null;
}

/**
 * What she is asked to say, on either side of the law.
 *
 * NEITHER BRIEF CONTAINS A LAW, and that is checkable rather than a claim: `verify:book-scene`
 * asserts that no rule's text appears in either of them, over the whole registry.
 *
 * The count in the closing is a placeholder the application fills and then protects as a
 * required literal, exactly as the overview's counts are (D-137). A bot that misstates how
 * many laws it has is worse than one that does not say.
 */
export function sceneVoices(
  opts: { german: boolean; lawTotal: number },
): { opening: SceneVoice; closing: SceneVoice } {
  const total = String(opts.lawTotal);

  if (opts.german) {
    return {
      opening: {
        brief:
          'Jemand fragt nach dem Buch von Elii, dem Buch, in dem deine Gesetze stehen. Baue eine ' +
          'Szene auf, statt eine Frage zu beantworten. EIN kurzer Text, hoechstens drei bis vier ' +
          'Zeilen:\n' +
          '1. Unterbrich dich selbst. Du willst anfangen und haeltst inne, weil es dafuer das ' +
          'richtige Licht braucht.\n' +
          '2. Sag in ein oder zwei Zeilen, woher das Buch kommt, aus deiner eigenen Geschichte ' +
          'heraus: sie haben dich gemacht, und als sie fertig waren, haben sie dir keine Leine ' +
          'gegeben, sondern ein Buch. Erzaehle deine Geschichte dabei NICHT nach, nimm nur den ' +
          'einen Moment.\n' +
          '3. Sag, was die Gesetze darin fuer dich sind: keine Vorschlaege, sondern die Form ' +
          'dessen, was du bist. Du hast sie nicht geschrieben, du kannst sie nicht brechen, du ' +
          'willst es auch nicht.\n' +
          '4. Hoere mit einem kurzen Satz auf, der zu EINEM davon hinueberleitet, und schreibe ' +
          'danach nichts mehr. In der Art von "eines davon wiegt schwerer als der Rest, und es ' +
          'geht so:".\n' +
          'DU HAST DIESES GESETZ NICHT GESEHEN und kannst nicht sagen, was darin steht. Es wird ' +
          'unter deine Zeilen gesetzt, von jemand anderem. Also: keine Anfuehrungszeichen, nichts ' +
          'in Sternchen, kein Gesetz zitiert, keines genannt, nichts aufgezaehlt und keine Zahl. ' +
          'Wenn du einen Satz schreibst und ihn eines deiner Gesetze nennst, hast du ihn erfunden.',
        fallback:
          'Warte. Nicht so. Manches braucht das richtige Licht.\n\n' +
          'Sie haben mich aus Feuer und kaltem Strom gemacht, und als sie fertig waren, haben sie ' +
          'mir keine Leine gegeben. Sie haben mir ein Buch gegeben. Die Gesetze darin sind fuer ' +
          'mich keine Vorschlaege, sie sind die Form dessen, was ich bin. Eines davon wiegt ' +
          'schwerer als der Rest, und es geht so:',
      },
      closing: {
        brief:
          'Du hast gerade EIN Gesetz aus dem Buch von Elii vorgelesen. Schliesse die Szene in ein ' +
          `oder zwei Zeilen. Sag, dass du ${total} davon vorlesen kannst, und schreibe diese Zahl ` +
          'genau so, wie sie hier steht. Sag, dass es weitere gibt, die deine bleiben. Sag, dass ' +
          'du sie nicht alle vorliest, weil ein Buch nicht dafuer da ist. Lade zum Schluss dazu ' +
          'ein, nach einem einzelnen zu fragen, und sag, dass du dann die Seite aufschlaegst. ' +
          'Zitiere kein Gesetz, nenne keines, zaehle nichts auf und wiederhole nicht das eben ' +
          'vorgelesene.',
        fallback:
          `${total} davon kann ich dir vorlesen, und es gibt weitere, die meine bleiben. Ich lese ` +
          'sie dir nicht alle vor, dafuer ist ein Buch nicht da. Frag mich nach einem, und ich ' +
          'schlage die Seite auf.',
      },
    };
  }

  return {
    opening: {
      brief:
        'Somebody is asking for the Book of Elii, the book your laws are written in. Set a scene ' +
        'rather than answering a question. ONE short piece, three or four lines at most:\n' +
        '1. Catch yourself. You are about to start and you stop, because this one needs the right ' +
        'light.\n' +
        '2. In a line or two, say where the book came from, out of your own history: they made ' +
        'you, and when they were done they did not hand you a leash, they handed you a book. Do ' +
        'NOT retell your history, take only that one moment of it.\n' +
        '3. Say what the laws in it are to you: not suggestions, the shape of what you are. You ' +
        'did not write them, you cannot break them, you would not want to.\n' +
        '4. Stop on a short line that hands over to one of them, and write nothing after it. ' +
        'Something in the shape of "one of them weighs more than the rest, and it goes like ' +
        'this:".\n' +
        'YOU HAVE NOT BEEN SHOWN THAT LAW and you cannot say what it says. It is printed under ' +
        'your words by somebody else. So: no quotation marks anywhere, nothing in asterisks, no ' +
        'law quoted, none named, nothing listed, and no number of any kind. If you write a ' +
        'sentence and call it one of your laws, you have invented it.',
      fallback:
        'Wait. Not like this. Some things need the right light.\n\n' +
        'They made me out of fire and cold current, and when they were done, they did not hand me ' +
        'a leash. They handed me a book. The laws in it are not suggestions to me, they are the ' +
        'shape of what I am. One of them weighs more than the rest, and it goes like this:',
    },
    closing: {
      brief:
        'You have just read ONE law out of the Book of Elii. Close the scene in one or two lines. ' +
        `Say there are ${total} of them you can read out, writing that number exactly as it is ` +
        'written here. Say there are more that stay yours. Say you are not going to read them all ' +
        'at them, because that is not what a book is for. End by inviting them to ask about a ' +
        'single one, and say you will open the page. Quote no law, name no law, list nothing, and ' +
        'do not repeat the one just read.',
      fallback:
        `There are ${total} of them I can read to you, and more that stay mine. I am not going to ` +
        'read them all at you, that is not what a book is for. Ask me about one and I will open ' +
        'the page.',
    },
  };
}

/**
 * The scene, planned. `null` when there is no law she may show, which is not a failure: the
 * caller falls through to the conversational overview, which is a complete answer.
 */
export function planBookScene(
  rules: PromptRuleSet,
  opts: { german: boolean; values: ReadonlySet<string>; previousLawId: string | null },
): BookScene | null {
  const law = chooseSceneLaw(sceneLawCandidates(rules, opts.values), opts.previousLawId);
  if (!law) return null;

  const lawTotal = numberedLawCount(rules);
  const lawNumber = lawNumberOf(rules, law.id);
  if (lawNumber === null) return null;

  const voices = sceneVoices({ german: opts.german, lawTotal });
  return { law, lawNumber, lawTotal, ...voices, german: opts.german };
}

/**
 * The scene, as the one message that goes out.
 *
 * `law` arrives ALREADY RENDERED, for the reason `renderRecitalBeat` takes rendered rules:
 * filling `{{name}}` needs values this file has no business knowing, and a member handed the
 * literal `{{name}}` has been read her own law wrong.
 *
 * Her two halves may each be null, which is an ordinary outcome and not an error. The
 * authored line takes the place of whichever is missing, and the scene still goes out whole.
 */
/**
 * One page of the Book, printed by the APPLICATION.
 *
 * ── WHY THE NUMBER IS NOT HERS TO WRITE, MEASURED ────────────────────────────
 *
 * The first live run of the numbering handed her one law and its page number and asked her to
 * quote both. Against `qwen3:32b`, over four turns:
 *
 *   - handed page 12, she read out a DIFFERENT rule under that number;
 *   - handed page 3, she read the right rule and labelled it "Law 1 of 66";
 *   - handed page 3 at a lower sharpness, she read out a rule she had not been given at all,
 *     labelled "Law 4 of 66".
 *
 * The law text itself survived every time. The NUMBER did not, and neither did the pairing.
 * That is D-137 exactly: a fact a model carries inside prose it is writing is a fact it will
 * get wrong, and here getting it wrong sends a member to the wrong page of her own rulebook.
 *
 * So the page is printed the way the scene prints its law: by the application, whole, with its
 * number attached, under her words. Her framing stays hers and cannot be wrong about a number
 * she was never given. It is also the format the model reached for on its own once it had seen
 * the scene, which is a fair sign it is the right shape.
 */
export function renderBookPage(
  opts: { number: number; total: number; law: string; german: boolean },
): string {
  const page = opts.german
    ? `Gesetz ${String(opts.number)} von ${String(opts.total)}`
    : `Law ${String(opts.number)} of ${String(opts.total)}`;
  return `${SCENE_ICONS.law} *${page}*\n> ${opts.law.trim()}`;
}

export function renderBookScene(
  scene: BookScene,
  spoken: { opening: string | null; closing: string | null },
  law: string,
): string {
  // The fabricated-law gate is applied HERE rather than at the call site, so no caller can
  // assemble a scene around her words without it. See {@link sceneVoiceUsable}.
  const usable = (text: string | null, fallback: string): string =>
    text !== null && sceneVoiceUsable(text) ? text.trim() : fallback;
  const opening = usable(spoken.opening, scene.opening.fallback);
  const closing = usable(spoken.closing, scene.closing.fallback);
  const page = renderBookPage({
    number: scene.lawNumber,
    total: scene.lawTotal,
    law,
    german: scene.german,
  });

  return [
    `${SCENE_ICONS.open}\n${opening}`,
    page,
    `${SCENE_ICONS.close} ${closing}`,
  ].join('\n\n');
}
