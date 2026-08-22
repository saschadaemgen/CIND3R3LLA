/**
 * Saying she is going to look, for all three lookups (CCB-S5-025).
 *
 * Pure: the briefs, the projection and the threshold, with no model and no database, so
 * `verify:lookup-announcement` can drive every branch and the console can state the numbers.
 *
 * ── DECISION ONE: THE THREE ARE DISTINGUISHED ────────────────────────────────
 *
 * Web search goes outside. The archive is this group's own history. The knowledge base is
 * what the operator gave her. One line saying "let me look that up" for all three tells a
 * member nothing about where the answer will come from, and it would CONTRADICT the
 * attribution that follows: `🔎 From the web:` and `📄 From what you gave me:` already say
 * which, after the fact. An announcement disagreeing with the line under the answer would be
 * worse than none, so the announcement says the same thing first.
 *
 * The distinction is DATA, not schema. Each kind supplies a short brief; the searching-lane
 * rules keep owning the FORM (one line, her voice, promise nothing, no capability talk). That
 * is the `sceneVoice` pattern from CCB-S5-005: the application states the situation, the
 * model finds the words, and the dials do the rest. Nothing here is a fixed string she says,
 * which is what makes it vary with sharpness and warmth instead of reading like a progress bar.
 *
 * ── DECISION TWO: WHEN IT IS WORTH ANNOUNCING, AND WHY THE RATE IS MEASURED ─
 *
 * The operator's instinct was to key this on how long the LOOKUP takes. Measurement says
 * otherwise, and it changes the answer: retrieval is milliseconds (one embedding call, then
 * SQL), while the reply has to be WRITTEN a character at a time. So the wait is set by how
 * long her answer will be, and that is knowable before the lookup starts, because the answer
 * is bounded by the verbosity dial:
 *
 *     seconds = replyCharBudget(verbosity) / charsPerSecond
 *
 * Characters rather than tokens throughout, because the budget is already in characters and
 * converting through a tokens-per-character guess would add an error term for nothing.
 *
 * ── THE RATE IS NOT A CONSTANT, AND THE FIRST BUILD OF THIS GOT THAT WRONG ───
 *
 * It shipped 19.5 tokens a second, measured on one model on one machine. Then the same box,
 * the same prompt shape and reasoning off, as the transport sends it (at the time
 * `reasoning_effort: 'none'`; `think: false` since the D-252 endpoint move, same effect),
 * were measured against both models this repository ships a default for:
 *
 *     qwen3:32b     ~138 characters a second      verbosity 5 -> 3.6 s
 *     qwen3.5:9b    ~414 characters a second      verbosity 5 -> 1.2 s
 *
 * Three times apart, and neither matches the operator's own production figure of a 16.4
 * second reply, because production is different hardware again. A constant would have made
 * her announce a one second wait on one deployment and sit silently through a sixteen second
 * one on another. There is no number that is right for a machine this code has never run on.
 *
 * So the rate is READ FROM HER OWN REPLIES, by the queue meter that was already recording
 * the times: see `ModelQueueMeter.observedCharsPerSecond`. This module stays pure and takes
 * it as an argument.
 *
 * ── AND THE WEB IS THE EXCEPTION, FOR A REASON ───────────────────────────────
 *
 * Web search ALWAYS announces, whatever the dial says, because its lookup is a network round
 * trip of one to six seconds that no dial predicts. The other two announce only when the
 * projected reply crosses {@link ANNOUNCE_THRESHOLD_SECONDS}, because for them the lookup
 * costs nothing and the reply is the whole wait.
 *
 * ── WHERE THE ANNOUNCEMENT SITS, WHICH FALLS OUT OF THE SAME MEASUREMENT ─────
 *
 * The rule CCB-S4-038 set is that she may only announce once the lookup is CERTAIN to run,
 * because she once announced a search that was then rate-limited and claimed to have looked
 * when she never did. Each kind satisfies that differently, and the difference is not
 * cosmetic:
 *
 *   web       BEFORE the search. The search is the slow part, so covering it is the point,
 *             and everything that could refuse it (the plugin, the provider, the pre-search
 *             gate) has already run by then.
 *   archive   BEFORE the count, for the same reason: the query is validated and the next
 *             statement is the query, so nothing can still refuse it.
 *   knowledge AFTER retrieval. This is the one lookup that can come back with NOTHING, and
 *             its brief says the answer is already in the operator's documents. Retrieval
 *             costs milliseconds, so waiting for it adds no silence, and it buys a guarantee
 *             no wording could: she only claims to be reading those documents while holding
 *             passages from them. Below the relevance floor she says nothing at all, which
 *             matches the answer, since the attribution is suppressed by the same emptiness.
 */

import { replyCharBudget } from './personality.js';

/** Which of the three is about to happen. */
export type LookupKind = 'web' | 'archive' | 'knowledge';

/**
 * Above this projected wait, a holding line is worth a message; below it, it costs a message
 * to save nothing.
 *
 * Five seconds is a judgement and is stated as one: it is roughly where a silence in a live
 * group stops reading as thinking and starts reading as being ignored. It is a constant here
 * rather than a setting because it is a claim about PEOPLE, not about this deployment. What
 * varies per deployment is the rate, and that is measured.
 *
 * What it works out to, at the two rates measured on the development machine:
 *
 *     qwen3:32b   ~138 chars/s   announces from verbosity 7 (800 chars, 5.8 s) upward
 *     qwen3.5:9b  ~414 chars/s   never announces; even verbosity 10 comes back in 3.4 s
 *
 * That second row is the feature working, not a bug: on a model that fast there is nothing
 * to wait for, so she says nothing and just answers.
 */
export const ANNOUNCE_THRESHOLD_SECONDS = 5;

/**
 * How long her reply will take to write, at this verbosity and this measured rate.
 *
 * `charsPerSecond` comes from `ModelQueueMeter.observedCharsPerSecond`. A non-finite or
 * non-positive rate is refused rather than producing an Infinity or a negative wait, because
 * either would silently decide every announcement from then on.
 */
export function projectedReplySeconds(verbosity: number, charsPerSecond: number): number {
  if (!Number.isFinite(charsPerSecond) || charsPerSecond <= 0) {
    throw new RangeError(`projectedReplySeconds needs a positive rate, got ${charsPerSecond}.`);
  }
  return replyCharBudget(verbosity) / charsPerSecond;
}

/**
 * Whether this lookup earns a holding line.
 *
 * The web always does; see the header. The other two are decided by the projection, so the
 * same question gets no announcement at verbosity 2 and one at verbosity 8.
 *
 * `charsPerSecond` of NULL means the meter has not seen enough replies to say yet, and the
 * answer is then YES. That is the deliberate direction: a process with no readings is a
 * process that has just started, the first reply also pays for loading the model, and that
 * was 3 to 8 seconds against sub-second warm calls in every measurement taken. Staying quiet
 * on a no-reading would put the silence exactly where it is longest.
 */
export function shouldAnnounce(
  kind: LookupKind,
  verbosity: number,
  charsPerSecond: number | null,
): boolean {
  if (kind === 'web') return true;
  if (charsPerSecond === null || !Number.isFinite(charsPerSecond) || charsPerSecond <= 0) {
    return true;
  }
  return projectedReplySeconds(verbosity, charsPerSecond) >= ANNOUNCE_THRESHOLD_SECONDS;
}

/**
 * What she is about to do, in one sentence the model turns into her own line.
 *
 * NOT a line she says. These are situational briefs: the searching-lane rules require one
 * short line in her own voice that promises nothing, so what a member sees is written at her
 * current sharpness and warmth every time. Two members at different dials get different
 * words for the same brief, which is the whole reason these are not fixed strings.
 *
 * The stance differs, and that is the informative part. For the web she does not have it. For
 * the archive she is going back through what the room PUBLISHED. For the knowledge base she DOES
 * have it: it is in the documents she was given, and she is reading them. A member who knows
 * which of those is happening reads the answer differently.
 *
 * The archive wording is consent-exact rather than a flourish, and it is SHORT for a reason
 * that only a live run showed. `countPublishedMatching` queries `published_messages`, which is
 * DERIVED from the consent table, so it sees only what members opted in to publish. A first
 * draft said "everything its members have said here", which would have had her claim to search
 * messages nobody consented to publish, in the one product where that is the legal backbone.
 *
 * The correction then overshot: spelling the consent model out as "the messages its members
 * have chosen to publish" made the model treat CONSENT as the topic, and one run at low
 * sharpness answered with a description of the consent model and never mentioned looking at
 * all. A brief is a situation, not a subject to write about, so the qualifier is now the single
 * word `published` and carries no clause to expand on.
 */
export function lookupBrief(kind: LookupKind): string {
  switch (kind) {
    case 'web':
      return (
        'You do not have this one in your own head. You are about to go out and search the ' +
        'web for it.'
      );
    case 'archive':
      return (
        'You are about to go back through this group\'s published archive to see what was ' +
        'said about this.'
      );
    case 'knowledge':
      return (
        'You already have this one: it is in the documents the operator gave you, and you ' +
        'are reading them now. You are not going out anywhere for it.'
      );
  }
}

/**
 * The attribution each kind produces, as a persona key, so a check can assert that an
 * announcement and the line under the answer never disagree about where she looked.
 *
 * `archive` has none: its answer is a count of what this group said, and there is no source
 * to name beyond the group itself.
 *
 * `knowledge` has none SINCE CCB-S5-056, and that is a withdrawal rather than an absence.
 * The line printed a false attribution six times in a week; the sixth put a document name
 * under invented claims about a third party. The application stops printing it until an
 * attribution can be proven to name the source the answer actually used, which is
 * CCB-S5-055. **The persona string itself stays** - `protected-text.ts` derives what she may
 * not write from the templates carrying placeholders, so removing it would take the marker
 * with it and let her forge the line herself with nothing left to strip it (D-180).
 *
 * `web` keeps its line, and the distinction is the whole point: those are real links to real
 * pages, chosen from the model's own declaration of which results it used, and they have
 * never been wrong.
 */
export const ATTRIBUTION_KEY: Record<LookupKind, string | null> = {
  web: 'searchSources',
  knowledge: null,
  archive: null,
};

/**
 * Does this holding line say WHERE she is looking? (CCB-S5-057, D-251)
 *
 * ── WHY THE BRIEF WAS NOT ENOUGH ─────────────────────────────────────────────
 *
 * `lookupBrief` reaches the prompt correctly on every lookup and names the destination in
 * full. Nothing then required the destination to SURVIVE, and the lane is capped at 40 to
 * 200 characters with an over-length reply discarded entirely, which is steady pressure
 * toward exactly the clause that gets dropped. Production produced "Looking up now." - the
 * same sentence for the web, the archive and the operator's documents.
 *
 * That matters more than it reads. Those are three different promises that take three
 * different amounts of time: a network round trip, a query over this group's own archive,
 * and a local read of his files. And since the knowledge attribution was withdrawn and the
 * archive never had one, for two of the three kinds this line is the ONLY place a member is
 * ever told where she looked.
 *
 * ── AN ALLOW-LIST OF PHRASINGS, NOT ONE REQUIRED LITERAL ─────────────────────
 *
 * The exact-literal machinery exists and was the obvious tool, and it is the wrong one here:
 * it demands one string verbatim, and a line that says "out on the internet" instead of "the
 * web" would be thrown away for saying the right thing in her own words. The point is that
 * she names the place, not that she names it in the application's vocabulary.
 *
 * So this is a set of acceptable markers per destination, in both languages, and the line
 * passes if it carries any of them.
 *
 * ── AND WHAT HAPPENS WHEN IT DOES NOT ────────────────────────────────────────
 *
 * The line is dropped, which is the behaviour this lane already has when the model cannot
 * speak, and the reasoning is recorded at that call site: there is deliberately NO canned
 * fallback, because "let me look that up" every time the model is busy is the sentence the
 * whole feature was written to avoid. So a line that does not name its destination is
 * treated as no line rather than replaced by one, and the member gets silence and then the
 * answer - the pre-CCB-S5-025 behaviour, not a new failure.
 */
const DESTINATION_MARKERS: Record<LookupKind, readonly string[]> = {
  web: ['web', 'internet', 'online', 'netz', 'suchmaschine'],
  archive: ['archive', 'archiv', 'this group', 'dieser gruppe', 'group', 'gruppe'],
  knowledge: [
    'document',
    'documents',
    'dokument',
    'unterlagen',
    'notes',
    'notizen',
    'files',
    'dateien',
    'gave me',
    'gegeben',
  ],
};

export function namesDestination(line: string, kind: LookupKind): boolean {
  const t = line.toLowerCase();
  return DESTINATION_MARKERS[kind].some((marker) => t.includes(marker));
}
