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
import { status } from '../web/status.js';
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
import { planBookScene, renderBookScene, type BookScene } from './book-scene.js';

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
  /**
   * Her words for one half of the Book scene, from a brief rather than a script.
   *
   * Absent, or returning null, means that half reads as its authored line. Same degradation
   * the recital has, and it is a complete scene, just a plainer one.
   *
   * `maxChars` is the scene's OWN bound rather than the conversation budget: see
   * `book-scene.ts`. `requiredLiterals` carries the count, so a half that loses it is
   * rejected and the authored line goes out with the right number in it.
   */
  sceneVoice?: (
    brief: string,
    lang: string,
    opts: { maxChars: number; requiredLiterals: string[] },
  ) => Promise<string | null>;
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
 * Tells the Book as a SCENE (CCB-S5-005, D-159).
 *
 * ── WHY THIS NO LONGER GOES THROUGH THE RECITAL RUNNER ───────────────────────
 *
 * CCB-S4-050 built the story on top of the runner, correctly, because a paced multi-message
 * answer needs a durable chain and the runner already had one. A scene is ONE message, so
 * there is no chain, no queue and no next beat to book; borrowing the runner for it would
 * mean carrying a plan, a pacing setting and a scheduler for a performance that never uses
 * any of them.
 *
 * What it still shares is the part that mattered: her voice comes from a brief, the facts do
 * not come from her, and a model failure reads as an authored line rather than as silence.
 *
 * ── AND WHY THE TWO HALVES ARE TWO CALLS ─────────────────────────────────────
 *
 * The law sits BETWEEN them, and the law is not hers to write. One call could not put a
 * verbatim rule in the middle of its own paragraph without being handed the rule, and handing
 * it over is exactly what the one-law bound is built to avoid. So she speaks, the application
 * reads the law out, and she closes. Two short calls, one message, and no path by which a
 * second law can appear.
 *
 * ── AND WHY IT SENDS THROUGH THE REPLY PATH RATHER THAN THE RECITAL PORT ─────
 *
 * It used to use the recital port, inherited from CCB-S4-050's story, and that was wrong on
 * every count. The port exists for ONE reason: beats two onward are sent by a queue job
 * minutes after the message object is gone, so they have a group id and nothing else. A scene
 * is one message sent synchronously while the message is still in hand, so it needs none of
 * that, and taking it cost three things that path already had: the send was not archived (her
 * own messages are captured on the reply path, so a scene left no trace anywhere, which is
 * what made the production failure invisible), it did not carry the name prefix or the
 * mention bookkeeping every other reply carries, and its failures were reported by nobody.
 *
 * Production: `[INFO] Book scene: reading law 2/60 ... in group 4` twice, nothing sent, no
 * error. The rendered text was 620 characters, reproduced exactly, so the message was fine
 * and the transport swallowed it. What follows is written so that can never be the shape of
 * the evidence again.
 *
 * Returns whether a scene was told. `false` from a DECISION (no law she may show, a member
 * who has already had one this minute) is not a failure and the caller answers with the
 * conversational overview. `false` from a FAULT is logged as an error and raised to the
 * admin, because a member asked for something the application had and did not get it.
 */
export async function tellBookScene(
  deps: RecitalDeps,
  msg: CapturedMessage,
  lang: string,
  opts: {
    previousLawId: string | null;
    openingChars: number;
    closingChars: number;
    /**
     * Sends the scene as an ordinary reply, returning whether it left.
     *
     * The caller supplies it rather than this function reaching for a transport, because the
     * only correct transport is the one that answers THIS message: bot-scoped, archived, and
     * already loud about its own failures.
     */
    send: (text: string) => Promise<boolean>;
    onLawShown?: (lawId: string) => void;
  },
): Promise<boolean> {
  const german = lang.toLowerCase().startsWith('de');
  const scene = planBookScene(deps.rules(), {
    german,
    values: deps.renderableValues(),
    previousLawId: opts.previousLawId,
  });
  if (!scene) {
    log.debug('Book scene: no law she may show, so the overview is given instead.');
    return false;
  }

  // The member's allowance, taken before a word is spoken, exactly as a recital takes it.
  // A DECISION rather than a fault, so it is logged plainly and the overview answers instead.
  if (!deps.reserve(msg.groupId, msg.senderMemberId)) {
    log.info(
      `Book scene: member ${msg.senderMemberId} has already had one this minute in group ` +
        `${String(msg.groupId)}; the overview is given instead.`,
    );
    return false;
  }

  const speak = async (
    voice: BookScene['opening'],
    maxChars: number,
    requiredLiterals: string[],
  ): Promise<string | null> => {
    if (!deps.sceneVoice) return null;
    try {
      return await deps.sceneVoice(voice.brief, lang, { maxChars, requiredLiterals });
    } catch (err) {
      // The model may fail and may not stop this. The authored line takes its place.
      log.warn(
        `Book scene: the model failed (${
          err instanceof Error ? err.message : String(err)
        }); the authored line is read instead.`,
      );
      return null;
    }
  };

  const opening = await speak(scene.opening, opts.openingChars, []);
  const closing = await speak(scene.closing, opts.closingChars, [String(scene.lawTotal)]);

  // THE LAW IS RENDERED HERE, by the application, from `scene.law`, which holds exactly one.
  // `renderRule` throws on a law it cannot fill in for a member, and that is a fault rather
  // than a quiet fall-through: the law was selected from a candidate set already filtered on
  // renderability, so reaching this and failing means those two disagree.
  let text: string;
  try {
    text = renderBookScene(scene, { opening, closing }, deps.renderRule(scene.law));
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    log.error(`Book scene: law ${scene.law.id} could not be rendered for a member (${detail}).`);
    status.error(`The Book scene could not render law ${scene.law.id}: ${detail}`);
    return false;
  }

  /**
   * ── A BLANK SCENE IS A FAULT, NOT A MESSAGE ────────────────────────────────
   *
   * It cannot happen as the code stands: both halves fall back to an authored line and the
   * law is application text, which is why the production symptom turned out NOT to be this.
   * It is checked anyway because the alternative failure is an empty send, and an empty send
   * is the one outcome that looks exactly like success from in here.
   */
  if (text.trim().length === 0) {
    log.error(
      `Book scene: assembled an empty scene for law ${scene.law.id} in group ` +
        `${String(msg.groupId)}; nothing was sent.`,
    );
    status.error(`The Book scene assembled an empty message for law ${scene.law.id}.`);
    return false;
  }

  log.info(
    `Book scene: reading law ${String(scene.lawNumber)}/${String(scene.lawTotal)} ` +
      `(${scene.law.id}) in group ${String(msg.groupId)}, ${String(text.length)} characters.`,
  );

  /**
   * ── AND IF IT DOES NOT LEAVE, SOMEBODY IS TOLD ─────────────────────────────
   *
   * The send bypasses the reply limit (the scene's own allowance above is what bounds it), so
   * `false` here means the transport declined or failed rather than that a budget was spent.
   * That is a fault: a member asked for something the application was holding, the application
   * had it rendered, and it did not arrive. It goes to the log AND to the admin dashboard,
   * because the production failure this replaces produced neither.
   */
  let sent = false;
  try {
    sent = await opts.send(text);
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    log.error(
      `Book scene: the send threw for law ${scene.law.id} in group ${String(msg.groupId)} ` +
        `(${detail}).`,
    );
    status.error(`The Book scene could not be sent to group ${String(msg.groupId)}: ${detail}`);
    return false;
  }

  if (!sent) {
    log.error(
      `Book scene: law ${scene.law.id} was rendered (${String(text.length)} characters) and ` +
        `did not leave for group ${String(msg.groupId)}.`,
    );
    status.error(
      `The Book scene was rendered and not delivered to group ${String(msg.groupId)}.`,
    );
    return false;
  }

  log.info(`Book scene: law ${scene.law.id} sent to group ${String(msg.groupId)}.`);
  opts.onLawShown?.(scene.law.id);
  return true;
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
