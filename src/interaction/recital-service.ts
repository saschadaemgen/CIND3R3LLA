/**
 * Starting and continuing a recital (CCB-S4-047, D-149).
 *
 * The join between the pure plan, the durable queue and the transport. It owns two decisions
 * that the pure layer deliberately does not: whether there is ROOM to perform, and what a
 * beat costs a member's reply allowance.
 *
 * ── THE BUDGET IS TAKEN IN ONE PIECE, BEFORE THE FIRST WORD ──────────────────
 *
 * The briefing asked how a recital interacts with the reply limit and said to decide rather
 * than let an operator discover it. The decision is that a recital has its OWN allowance,
 * taken whole before anything is sent, and if it is spent she gives the brief answer instead.
 *
 * Charging as it goes was never an option: a member who ran out mid-reading would get an
 * opening, three chapters and then nothing, which is the mid-recital silence the never-silent
 * rule forbids outright. Deciding before anybody has been spoken to is the only shape where
 * the answer is either the whole book or the short version, and never half of one.
 *
 * Charging it as N REPLIES was the first attempt and it was wrong, in a way only reading the
 * console showed: the reply budget ships at six per member per minute, a recital is eight
 * messages, so it could never start and the feature was dead with every check green. A recital
 * is one performance rather than several conversational turns, and it is bounded like the
 * price lookup is (CCB-S3-004 §3), by its own counter.
 */

import { log } from '../log.js';
import { chapterImagePreview, resolveAssetPath } from '../media/assets.js';
import { listRecitalChapters } from '../db/recital-chapters.js';
import type { Queryable } from '../db/pool.js';
import type { CapturedMessage } from '../capture/message.js';
import type { PromptRule, PromptRuleSet } from './prompt-rules.js';
import {
  planRecital,
  wantsRecital,
  type RecitalBeat,
  type RecitalPlan,
  type RecitalSettings,
} from './recital.js';
import { sendRecitalBeat, type RecitalPort } from './recital-runner.js';
import { asksAboutRules, asksForRecital } from './disclosure.js';

export interface RecitalDeps {
  db: Queryable;
  rules: () => PromptRuleSet;
  recital: () => RecitalSettings;
  assetRoot: string;
  /** One rule as a member will read it, placeholders filled. */
  renderRule: (rule: PromptRule) => string;
  /**
   * Which placeholder values are available right now.
   *
   * Supplied so the plan can drop a rule it could not render rather than throwing mid-reading.
   * See the note in `planRecital`.
   */
  renderableValues: () => ReadonlySet<string>;
  /**
   * Her voice leading into a beat. `null` from an absent model, or from one that gave nothing
   * usable, is an ordinary outcome: the chapter's authored line takes its place.
   */
  transition?: (beat: RecitalBeat, index: number, lang: string) => Promise<string | null>;
  /** Sends one message into a group. Null when nothing is hosting. */
  send: (() => {
    sendText(groupId: number, text: string): Promise<void>;
    sendImage(
      groupId: number,
      filePath: string,
      caption: string,
      preview: string | null,
    ): Promise<void>;
  } | null);
  /**
   * Takes this member's recital allowance, or returns false having taken nothing.
   *
   * All-or-nothing on purpose: a partial reservation is the mid-recital silence this exists
   * to make impossible.
   */
  reserve: (groupId: number, memberId: string) => boolean;
  /** Books the next beat on the durable queue. */
  schedule: (groupId: number, lang: string, beatIndex: number, delayMs: number) => Promise<void>;
}

/** Loads the chapters and builds the plan for a group, or null when there is nothing to read. */
async function planFor(deps: RecitalDeps, lang: string): Promise<RecitalPlan | null> {
  const rules = deps.rules();
  if (rules.length === 0) return null;
  const chapters = await listRecitalChapters(deps.db);
  const plan = planRecital(chapters, rules, {
    lang,
    maxMessages: deps.recital().maxMessages,
    values: deps.renderableValues(),
  });
  // Two beats is an opening and the ending, which is honest and is not a book. Below that the
  // caller gives the brief answer, which is a complete answer in its own right.
  return plan.beats.length >= 3 ? plan : null;
}

function portFor(deps: RecitalDeps, groupId: number, lang: string): RecitalPort {
  return {
    transition: (beat, index) =>
      deps.transition ? deps.transition(beat, index, lang) : Promise.resolve(null),
    renderRule: (rule) => deps.renderRule(rule),
    send: async (text, imagePath) => {
      const out = deps.send();
      if (!out) throw new Error('nothing is hosting; the recital cannot send');
      if (!imagePath) {
        await out.sendText(groupId, text);
        return;
      }
      // A chapter whose image has gone ships as text. The briefing is explicit that a
      // missing image never blocks a chapter, and `chapterImagePreview` already logs why.
      const preview = await chapterImagePreview(deps.assetRoot, imagePath);
      if (preview === null) {
        await out.sendText(groupId, text);
        return;
      }
      await out.sendImage(groupId, resolveAssetPath(deps.assetRoot, imagePath), text, preview);
    },
    scheduleNext: (nextIndex, delayMs) => deps.schedule(groupId, lang, nextIndex, delayMs),
  };
}

/**
 * Starts a recital, or declines to.
 *
 * Returns whether one started. `false` is not a failure and the caller falls through to the
 * brief answer: no chapters, no host, a bound too low, or a member without the allowance are
 * all reasons to answer briefly rather than to answer at all.
 */
export async function startRecital(
  deps: RecitalDeps,
  msg: CapturedMessage,
  lang: string,
): Promise<boolean> {
  const settings = deps.recital();
  if (
    !wantsRecital(settings, {
      asksAboutRules: asksAboutRules(msg.text),
      asksForRecital: asksForRecital(msg.text),
    })
  ) {
    return false;
  }
  if (!deps.send()) {
    log.debug('Recital: nothing is hosting, so the brief answer is given instead.');
    return false;
  }

  const plan = await planFor(deps, lang);
  if (!plan) {
    log.debug('Recital: no chapters hold anything she may recite; the brief answer is given.');
    return false;
  }

  // THE WHOLE ALLOWANCE, BEFORE THE FIRST WORD.
  if (!deps.reserve(msg.groupId, msg.senderMemberId)) {
    log.debug(
      'Recital: this member or this chat has already had one this minute; the brief answer is ' +
        'given instead of half a reading.',
    );
    return false;
  }

  log.info(
    `Recital: reading ${String(plan.beats.length)} beats in group ${String(msg.groupId)} ` +
      `(${String(plan.omitted)} rules not read, ${String(plan.withheld)} withheld).`,
  );
  return await sendRecitalBeat(portFor(deps, msg.groupId, lang), plan, 0, {
    german: lang.toLowerCase().startsWith('de'),
    pacingMs: settings.pacingMs,
  });
}

/**
 * Sends beat `index` of a recital already under way.
 *
 * The plan is REBUILT rather than carried in the payload, which is what makes the job
 * idempotent and small: the same chapters and the same registry produce the same beats, so a
 * retry after a crash re-sends the beat it was going to send. An operator who edits a chapter
 * mid-reading shifts the remainder, which is rare, self-correcting, and better than a payload
 * carrying a copy of rule text that the Book may have changed underneath it.
 */
export async function continueRecital(
  deps: RecitalDeps,
  groupId: number,
  lang: string,
  index: number,
): Promise<boolean> {
  const plan = await planFor(deps, lang);
  if (!plan) {
    log.warn(`Recital: beat ${String(index)} has no plan to belong to; the reading stops here.`);
    return false;
  }
  return await sendRecitalBeat(portFor(deps, groupId, lang), plan, index, {
    german: lang.toLowerCase().startsWith('de'),
    pacingMs: deps.recital().pacingMs,
  });
}
