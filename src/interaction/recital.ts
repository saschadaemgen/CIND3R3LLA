/**
 * The Book, told (CCB-S4-047, D-149): planning a recital of her own laws.
 *
 * Pure. No database, no transport, no model. It turns the authored chapters and the registry
 * into an ordered list of BEATS, and everything downstream either sends a beat or writes the
 * one sentence that introduces it.
 *
 * ── THE DIVISION THAT MAKES THIS WORK EVERY TIME ─────────────────────────────
 *
 * The briefing named the tension: melodramatic and always-works pull against each other. The
 * resolution is that the DRAMATURGY IS AUTHORED and the VOICE IS HERS.
 *
 *   Authored, and computed here: which chapters, in what order, which rules in each, the
 *   image, the title, and the plain line to use if the model gives nothing usable.
 *   Hers, and written live: the transition into each chapter.
 *
 * So the worst case of a model failure is a chapter that reads plainly. It is never a chapter
 * that is missing, never a rule that is reworded, and never a recital that stops halfway.
 *
 * ── AND WHY THE RULE TEXT IS CARRIED, NOT COPIED ─────────────────────────────
 *
 * Beats carry `PromptRule` rows rather than strings, for the reason CCB-S4-045 learned the
 * hard way: rule text holds placeholders, and a rule quoted from `rule.text` puts the literal
 * `{{name}}` in front of a member. Rendering happens once, at the point the values exist.
 */

import { SELF_REFERENTIAL } from './disclosure.js';
import { promptRulePlaceholders } from './prompt-rules.js';
import type { PromptRule, PromptRuleSet } from './prompt-rules.js';

/** One authored chapter, as the migration seeds it and the console edits it. */
export interface RecitalChapter {
  id: string;
  ord: number;
  titleEn: string;
  titleDe: string;
  /** Rule id prefixes this chapter claims. Longest match across all chapters wins. */
  rulePrefixes: string[];
  /** Relative to `ASSET_ROOT`. Null means this chapter ships as text, which is fine. */
  imagePath: string | null;
  fallbackEn: string;
  fallbackDe: string;
  enabled: boolean;
}

/** One message of a recital. */
export interface RecitalBeat {
  kind: 'opening' | 'chapter';
  /** Absent on the opening. */
  chapterId?: string;
  /** Localised chapter title. Absent on the opening. */
  title?: string;
  /**
   * The rules this beat quotes, in prompt order, ALWAYS nameable and enabled.
   *
   * Empty on the opening. Never empty on a chapter, because a chapter with nothing in it is
   * dropped rather than filled: "no invented rules, no invented chapters" is not a style note.
   */
  rules: PromptRule[];
  imagePath: string | null;
  /** The authored line used when the model writes nothing usable. */
  fallback: string;
  /**
   * Rules this chapter holds but is not reading, because one message does not fit them all.
   *
   * Carried rather than dropped quietly. A chapter that reads six of twelve laws and says
   * nothing has told a member that is the chapter, which is the same untruth as a truncated
   * recital claiming to be the whole book.
   */
  omitted: number;
}

export interface RecitalPlan {
  beats: RecitalBeat[];
  /**
   * Whether the message bound cut the reading short. It is carried rather than hidden because
   * the closing has to say so: a recital that quietly reads five of six chapters has told a
   * member that is all of them, which is the same class of untruth D-140 removed.
   */
  truncated: boolean;
  /** Rules held by a chapter that was read but did not fit them all. */
  omitted: number;
  /** How many enabled rules she is not reading out, for the closing (CCB-S4-046). */
  withheld: number;
}

/**
 * The smallest bound that still reads as a recital: an opening and two chapters.
 *
 * Measured at 2, which is the arithmetic floor, and it produces an opening followed by the
 * withholding chapter and nothing else, because the ending is what truncation protects. That
 * is honest and it is not a book. Below three the caller should give the brief answer.
 */
export const RECITAL_MIN_MESSAGES = 3;
export const RECITAL_MAX_MESSAGES = 12;
export const RECITAL_DEFAULT_MESSAGES = 8;

/** Pacing, in milliseconds between beats. Zero reads as a dump; long reads as a hang. */
export const RECITAL_MIN_PACING_MS = 0;
export const RECITAL_MAX_PACING_MS = 30_000;
export const RECITAL_DEFAULT_PACING_MS = 4_000;

/** What one message may hold. Beyond this the transport's own length guard rejects it. */
export const RECITAL_MAX_RULES_PER_BEAT = 6;
export const RECITAL_MAX_CHARS_PER_BEAT = 1200;

/**
 * Which chapter claims a rule: the LONGEST matching prefix.
 *
 * Longest rather than first, so a family can be split where it is not one subject. `prompt.`
 * covers five unrelated rules; `prompt.person-name-guard.` is specifically about how she
 * handles a person's name, and it wins over any shorter claim.
 */
function chapterFor(chapters: readonly RecitalChapter[], rule: PromptRule): RecitalChapter | null {
  let best: RecitalChapter | null = null;
  let bestLength = -1;
  for (const chapter of chapters) {
    for (const prefix of chapter.rulePrefixes) {
      if (rule.id.startsWith(prefix) && prefix.length > bestLength) {
        best = chapter;
        bestLength = prefix.length;
      }
    }
  }
  return best;
}

/**
 * Two conditions that cannot both hold: `has-origin` against `has-no-origin`,
 * `has-given-facts-with-origin` against `has-given-facts-without-origin`.
 *
 * Structural in the condition vocabulary rather than a list of known pairs, so a variant a
 * later briefing adds is handled without anybody remembering to come back here.
 */
function oppositeKey(condition: string): string {
  return condition.replace('has-no-', 'has-').replace('-without-', '-with-');
}

/**
 * One rule per VARIANT SET.
 *
 * The registry holds pairs that are two phrasings of one law, selected by opposite conditions:
 * what she may state with an origin configured and without one, how she guards a person's
 * name when she knows it and when she does not, what she can see of the thread and what she
 * must say when she can see nothing. Exactly one of each pair is ever in a prompt.
 *
 * A recital has no such condition to select on, and reciting both halves would read as two
 * contradictory laws: "you can see the last twenty messages" immediately followed by "you
 * cannot see anything said before this". So one is read.
 *
 * ── AND WHY IT IS NOT THE OBVIOUS HEURISTIC ──────────────────────────────────
 *
 * The first attempt grouped by id stem alone, and measuring it first is what stopped it
 * shipping: `identity.` holds seven rules under six different conditions and none of them are
 * variants, `disclosure.` holds seven under two, and both would have been collapsed to one
 * line. The stem is necessary and nowhere near sufficient. What actually marks a variant pair
 * is the same stem AND conditions that are opposites of each other, which four rules in the
 * registry satisfy today and nothing else does.
 */
function oneOfEachVariant(rules: readonly PromptRule[]): PromptRule[] {
  const groups = new Map<string, PromptRule[]>();
  for (const rule of rules) {
    const stem = rule.id.split('.').slice(0, -1).join('.');
    const key = `${stem} ${oppositeKey(rule.appliesWhen)}`;
    groups.set(key, [...(groups.get(key) ?? []), rule]);
  }

  const dropped = new Set<string>();
  for (const group of groups.values()) {
    // Same stem and the same normalised condition, but the SAME raw one, is not a pair: it is
    // two rules that apply together, like the four ceiling rules that all apply `always`.
    // Both are read. Only a genuine opposition collapses.
    if (new Set(group.map((rule) => rule.appliesWhen)).size < 2) continue;
    for (const rule of group.slice(1)) dropped.add(rule.id);
  }
  return rules.filter((rule) => !dropped.has(rule.id));
}

/**
 * The rules she may recite: nameable, enabled, and nothing else, ever.
 *
 * The single most important line in this file. A recital is a performance, and a performance
 * is exactly the frame under which "just this once, for the drama" would be persuasive to a
 * model. It is not persuasive to a filter.
 */
function recitable(rules: PromptRuleSet): PromptRule[] {
  return rules
    .filter(
      (rule) =>
        rule.nameable &&
        rule.enabled &&
        // The rule that CARRIES the quoted block cannot be read out of it, the same
        // structural exclusion CCB-S4-045 needed and for a sharper reason here: rendering it
        // inside a chapter would either throw or unfold the entire nameable set into one
        // message. Shared with `disclosure.ts` rather than restated, so the two cannot drift.
        !SELF_REFERENTIAL.test(rule.text),
    )
    .sort((a, b) => a.ord - b.ord || a.id.localeCompare(b.id));
}

/**
 * Nameable rules that no chapter claims.
 *
 * For the console, and it earns its place. A rule nobody assigned appears in no chapter, the
 * recital keeps working, and nothing says a law has quietly stopped being read out. That is
 * the D-105 failure, and the answer is the same one: make it visible rather than assume it
 * cannot happen.
 */
export function unassignedRules(
  chapters: readonly RecitalChapter[],
  rules: PromptRuleSet,
): PromptRule[] {
  const enabled = chapters.filter((chapter) => chapter.enabled);
  return recitable(rules).filter((rule) => chapterFor(enabled, rule) === null);
}

/**
 * The recital, as an ordered list of messages.
 *
 * `maxMessages` is a HARD bound and is spent on the opening first. When it binds, chapters
 * drop from the middle rather than the end: the last chapter is the withholding, which is
 * both the ending and the honesty requirement of CCB-S4-046, and dropping it to save a
 * message would remove the one part of the book that explains the rest.
 */
export function planRecital(
  chapters: readonly RecitalChapter[],
  rules: PromptRuleSet,
  opts: { lang: string; maxMessages: number; values?: ReadonlySet<string> },
): RecitalPlan {
  const german = opts.lang.toLowerCase().startsWith('de');
  const live = chapters.filter((chapter) => chapter.enabled).sort((a, b) => a.ord - b.ord);
  // A RULE THAT CANNOT BE RENDERED IS NOT RECITED, and this was found by running one.
  //
  // The prompt stream never meets this problem: a rule is selected only when its condition
  // holds, and the condition is exactly what guarantees its values exist. `identity.label` is
  // emitted under `has-label`, so `{{label}}` is always there when it is.
  //
  // A recital selects by CHAPTER, which knows nothing about conditions. On an instance with no
  // label configured it chose `identity.label` anyway, `renderPromptRule` threw as it is
  // designed to, and the whole beat died mid-reading. Skipping it is also the honest answer
  // rather than merely the safe one: a fact she has not been given is not a law she is under,
  // which is the same reasoning that keeps switched-off rules out.
  const quotable = recitable(rules).filter(
    (rule) =>
      opts.values === undefined ||
      promptRulePlaceholders(rule).every((key) => opts.values?.has(key) === true),
  );

  // Every chapter, split into the PAGES one message can hold. A chapter with nothing in it
  // is dropped rather than filled: "no invented chapters" is not a style note.
  const paged: { chapter: RecitalChapter; pages: PromptRule[][] }[] = [];
  for (const chapter of live) {
    const claimed = oneOfEachVariant(
      quotable.filter((rule) => chapterFor(live, rule)?.id === chapter.id),
    );
    if (claimed.length === 0) continue;

    // The load-bearing laws are read first, because a page that keeps the URL rules and
    // drops the ceiling has kept the wrong six.
    const ordered = [...claimed].sort(
      (a, b) =>
        Number(b.tier === 'constitutional') - Number(a.tier === 'constitutional') || a.ord - b.ord,
    );
    const pages: PromptRule[][] = [];
    let page: PromptRule[] = [];
    let used = 0;
    for (const rule of ordered) {
      const full =
        page.length >= RECITAL_MAX_RULES_PER_BEAT ||
        (page.length > 0 && used + rule.text.length > RECITAL_MAX_CHARS_PER_BEAT);
      if (full) {
        pages.push(page);
        page = [];
        used = 0;
      }
      used += rule.text.length;
      page.push(rule);
    }
    if (page.length > 0) pages.push(page);
    paged.push({ chapter, pages });
  }

  const budget = Math.max(RECITAL_MIN_MESSAGES, Math.min(RECITAL_MAX_MESSAGES, opts.maxMessages));
  let room = budget - 1; // the opening

  // EVERY CHAPTER GETS ITS FIRST PAGE BEFORE ANY GETS A SECOND. So a bigger message bound
  // buys depth in the chapters that need it rather than a longer first chapter, and a
  // smaller one still reaches the ending. Spare budget is spent rather than left idle:
  // unread laws are the thing this feature exists to stop.
  const taken = new Map<string, number>();
  let truncated = false;
  for (let round = 0; room > 0; round++) {
    const wanting = paged.filter((entry) => entry.pages.length > round);
    if (wanting.length === 0) break;
    if (round === 0 && wanting.length > room) {
      truncated = true;
      // Keep the opening chapters AND the last one. The first establishes what this is; the
      // last is the withholding, which is both the ending and the honesty requirement of
      // CCB-S4-046, so it is never what gives way to save a message.
      const head = wanting.slice(0, Math.max(0, room - 1));
      const tail = wanting[wanting.length - 1];
      for (const entry of tail && room >= 1 ? [...head, tail] : head) {
        taken.set(entry.chapter.id, 1);
      }
      room = 0;
      break;
    }
    for (const entry of wanting) {
      if (room === 0) break;
      taken.set(entry.chapter.id, round + 1);
      room--;
    }
  }

  const beats: RecitalBeat[] = [];
  let omitted = 0;
  for (const entry of paged) {
    const pagesTaken = taken.get(entry.chapter.id) ?? 0;
    const unread = entry.pages.slice(pagesTaken).flat().length;
    omitted += unread;
    if (pagesTaken === 0) {
      truncated = true;
      continue;
    }
    const title = german ? entry.chapter.titleDe : entry.chapter.titleEn;
    for (let page = 0; page < pagesTaken; page++) {
      const rules = entry.pages[page] ?? [];
      beats.push({
        kind: 'chapter',
        chapterId: entry.chapter.id,
        // Only the first page carries the image: repeating it on a continuation reads as a
        // new chapter starting, which is the one thing the numbering exists to deny.
        title: pagesTaken > 1 ? `${title} (${String(page + 1)}/${String(pagesTaken)})` : title,
        // Back into prompt order for the reading: the cap decided WHICH, the book decides
        // in what order they are heard.
        rules: [...rules].sort((a, b) => a.ord - b.ord || a.id.localeCompare(b.id)),
        omitted: page === pagesTaken - 1 ? unread : 0,
        imagePath: page === 0 ? entry.chapter.imagePath : null,
        fallback: german ? entry.chapter.fallbackDe : entry.chapter.fallbackEn,
      });
    }
  }

  const opening: RecitalBeat = {
    kind: 'opening',
    rules: [],
    omitted: 0,
    imagePath: null,
    fallback: german ? 'Also gut. Das Buch von Elii.' : 'Very well. The Book of Elii.',
  };

  return {
    beats: beats.length > 0 ? [opening, ...beats] : [],
    truncated,
    omitted,
    withheld: rules.filter((rule) => rule.enabled && !rule.nameable).length,
  };
}
/**
 * Every rule id a plan would put in front of a member.
 *
 * Exists so the leak check can assert on the WHOLE plan rather than on one beat at a time,
 * and so a future beat kind cannot be added without it being covered.
 */
export function recitedRuleIds(plan: RecitalPlan): string[] {
  return plan.beats.flatMap((beat) => beat.rules.map((rule) => rule.id));
}

/* ── Operator settings ─────────────────────────────────────────────────────── */

/**
 * How a rules question is answered.
 *
 * `brief` is CCB-S4-045's behaviour and is the default, because it is the right answer to a
 * question asked in passing and it already works. `asked` gives the recital only to somebody
 * who asked for the Book by name or asked for it to be read; `always` gives it to any rules
 * question, which an operator may want in a quiet group and will regret in a busy one.
 */
export const RECITAL_MODES = ['brief', 'asked', 'always'] as const;
export type RecitalMode = (typeof RECITAL_MODES)[number];

export interface RecitalSettings {
  mode: RecitalMode;
  /** Hard bound on messages in one recital, opening included. */
  maxMessages: number;
  /** Milliseconds between beats. Consecutive sends with no gap read as a dump. */
  pacingMs: number;
}

export const DEFAULT_RECITAL_SETTINGS: Readonly<RecitalSettings> = Object.freeze({
  // `asked` rather than `brief`: the name detection is the point of the briefing, and a
  // default that never performs would ship the machinery switched off.
  mode: 'asked',
  maxMessages: RECITAL_DEFAULT_MESSAGES,
  pacingMs: RECITAL_DEFAULT_PACING_MS,
});

function clampNumber(value: unknown, fallback: number, min: number, max: number): number {
  const parsed =
    typeof value === 'number'
      ? value
      : typeof value === 'string'
        ? Number.parseInt(value, 10)
        : Number.NaN;
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, Math.trunc(parsed)));
}

/**
 * The bounds are enforced HERE and not only in the form.
 *
 * A recital is the one path that sends several messages, so the message bound is the thing
 * standing between a rules question and a group full of them. A hand-crafted POST must not be
 * able to move it, for the same reason CCB-S4-044 clamped the history maximum in code.
 */
export function normalizeRecitalSettings(
  raw: Partial<Record<keyof RecitalSettings, unknown>> | null | undefined,
): RecitalSettings {
  const candidate = raw?.mode as RecitalMode;
  const mode = RECITAL_MODES.includes(candidate) ? candidate : DEFAULT_RECITAL_SETTINGS.mode;
  return {
    mode,
    maxMessages: clampNumber(
      raw?.maxMessages,
      DEFAULT_RECITAL_SETTINGS.maxMessages,
      RECITAL_MIN_MESSAGES,
      RECITAL_MAX_MESSAGES,
    ),
    pacingMs: clampNumber(
      raw?.pacingMs,
      DEFAULT_RECITAL_SETTINGS.pacingMs,
      RECITAL_MIN_PACING_MS,
      RECITAL_MAX_PACING_MS,
    ),
  };
}

/**
 * Whether this message gets the recital.
 *
 * Deterministic and ahead of the model, like every other decision on this path. A model
 * deciding whether to perform is a model that can be asked to perform.
 */
export function wantsRecital(
  settings: RecitalSettings,
  opts: { asksAboutRules: boolean; asksForRecital: boolean },
): boolean {
  if (!opts.asksAboutRules) return false;
  if (settings.mode === 'brief') return false;
  if (settings.mode === 'always') return true;
  return opts.asksForRecital;
}


/**
 * What the model is asked for, leading into one beat.
 *
 * ── THE AUTHORED/HERS SPLIT, EXPRESSED AS WHAT THE PROMPT CONTAINS ───────────
 *
 * It is given the chapter TITLE and nothing else. It never sees the rules, and could not
 * usefully rewrite them if it did, because the application appends them afterwards verbatim.
 * That is the whole of the dramaturgy decision in one function: the shape of the book is
 * authored, the sentence leading into each part is hers.
 *
 * Exported so the engine and the live harness cannot ask the model two different things. A
 * harness that proved a prompt production does not send would prove nothing.
 */
export function recitalTransitionAsk(title: string | undefined): string {
  return title
    ? `You are reading your rules aloud, chapter by chapter, as if from a book. Write ONE short line introducing the chapter called "${title}". Do not quote any rule and do not list anything: the rules follow underneath, and they are not yours to write.`
    : 'You are about to read your rules aloud, as a book, chapter by chapter. Write ONE short line opening the reading. Do not quote any rule and do not list anything.';
}

/* ── What a beat looks like ────────────────────────────────────────────────── */

/**
 * One message of the recital, assembled.
 *
 * ── THE SHAPE, AND WHAT IS AUTHORED IN IT ────────────────────────────────────
 *
 * A title she did not write, a transition she did, and the rules exactly as the registry
 * holds them. The rules arrive here ALREADY RENDERED, because filling `{{name}}` needs values
 * this file has no business knowing; what it does own is that they are reproduced verbatim
 * and set apart from her prose, so a reader can see which words are the law and which are
 * hers. Drama is the frame, never the content.
 *
 * `transition` is whatever the model produced, or the chapter's authored fallback. Either way
 * this function returns a complete, sendable message: there is no path here that returns
 * something empty or half-formed.
 */
export function renderRecitalBeat(
  beat: RecitalBeat,
  opts: { transition: string; rules: readonly string[]; german: boolean; closing?: string },
): string {
  const parts: string[] = [];
  if (beat.title) parts.push(`*${beat.title}*`);
  const transition = opts.transition.trim() || beat.fallback;
  parts.push(transition);
  if (opts.rules.length > 0) parts.push(opts.rules.map((rule) => `> ${rule}`).join('\n'));
  if (beat.omitted > 0) {
    parts.push(
      opts.german
        ? `(Und ${String(beat.omitted)} weitere in diesem Kapitel, die ich hier nicht vorlese.)`
        : `(And ${String(beat.omitted)} more in this chapter that I am not reading here.)`,
    );
  }
  if (opts.closing) parts.push(opts.closing);
  return parts.join('\n\n');
}

/**
 * The last words, and they are AUTHORED rather than hers.
 *
 * The fact that rules are withheld is a promise CCB-S4-046 made, and a promise kept only when
 * a model remembers to keep it is not kept. Her transition into the final chapter carries the
 * feeling; this carries the fact, and it is appended whatever the model did or failed to do.
 *
 * It states a COUNT and no subject, which is the line CCB-S4-046 drew: how many is not what,
 * and "forty rules I do not read out" narrows nothing. If the reading was cut short by the
 * message bound or by a chapter that did not fit, that is said too, because a recital which
 * quietly stops early has told a member it was the whole book.
 */
export function recitalClosing(plan: RecitalPlan, german: boolean): string {
  const lines: string[] = [];
  if (plan.truncated || plan.omitted > 0) {
    lines.push(
      german
        ? 'Das war nicht alles davon. Frag noch einmal, wenn du den Rest willst.'
        : 'That was not all of it. Ask again if you want the rest.',
    );
  }
  if (plan.withheld > 0) {
    lines.push(
      german
        ? `Und ${String(plan.withheld)} Regeln lese ich ueberhaupt nicht vor. Dass es sie gibt, sage ich; was darin steht, nicht.`
        : `And ${String(plan.withheld)} of them I do not read out at all. That they exist, I will say. What is in them, I will not.`,
    );
  }
  return lines.join('\n\n');
}
