/**
 * Private Ollama reply wording.
 *
 * The dialogue engine has already selected the intent, performed any database
 * reads, and decided what may happen. This module can only phrase the finished
 * result. It has no database, consent, tool, or transport capability.
 */

import type { LocalAiConfig } from '../config.js';
import type { FetchLike } from './ollama-resolver.js';
import {
  dialledPromptInputs,
  replyCharBudget,
  retortCharBudget,
  type BotIdentity,
  type BotPersonality,
  type CurrentTime,
} from './personality.js';
import {
  NOTHING_IN_SCOPE,
  assemblePrompt,
  lanesForMode,
  renderPromptRule,
  type PromptRule,
  type PromptRuleContext,
  type PromptRuleSet,
} from './prompt-rules.js';
import { modelQueue } from './model-queue.js';
import { stripProtectedLines } from './protected-text.js';
import { recordForgedLine } from './forgery-log.js';

export type AiReplyMode = 'free' | 'locked' | 'conversation' | 'retort' | 'searching';

export interface AiReplyRequest {
  /**
   * Which bot is speaking (CCB-S5-001).
   *
   * Carried for the queue meter, so the console can say what each bot costs at a model
   * they all share. Nothing about the PROMPT depends on it - the per-bot laws and dials
   * are resolved before this and arrive already applied in `rules` and `personality` -
   * which is why it is optional and why `verify:prompt-identity` is unaffected by it.
   */
  botProfileId?: number | null;
  /** Operational reply kind, for example status, help, or nickname. */
  kind: string;
  /** Language code selected by the deterministic interaction layer. */
  lang: string;
  /** The exact member message, treated as untrusted text. */
  memberMessage: string;
  /** Complete deterministic reply used when AI is unavailable or unsafe. */
  deterministicDraft: string;
  /**
   * Free mode rewrites the draft. Locked mode writes only a short lead and the
   * application appends the deterministic draft unchanged.
   *
   * CONVERSATION mode is the one that is different in kind (CCB-S4-027, D-131): there
   * is no draft, because no command produced one, so the model writes original words
   * rather than rephrasing a decision the application already made. Every other guard in
   * this file still applies to it, which is why it is a mode here rather than a second
   * transport somewhere else.
   *
   * RETORT mode is a fourth thing and exists because the first three could not express it
   * (CCB-S4-031, D-135). A nickname retort HAS a draft, like `free`, and must be spoken in
   * her dialled voice, like `conversation`. It could not be `free`, because `free` is the
   * command-rewrite lane and D-133 deliberately keeps the personality out of it: a
   * personality able to reword a consent confirmation is not one anyone asked for. So the
   * two properties are separated into their own mode rather than by loosening `free`.
   */
  mode: AiReplyMode;
  /**
   * The rules she is given, from the registry (CCB-S4-039, D-144).
   *
   * REQUIRED, and not optional with a sensible default, because there is no sensible
   * default. Every sentence in the system prompt comes from here, including the safety
   * ceiling, so a caller that forgot to supply them would otherwise build a prompt with no
   * rules in it and nothing would say so. Required, the compiler says so; and an empty set
   * still throws in {@link assemblePrompt} rather than producing a shorter prompt.
   */
  rules: PromptRuleSet;
  /** Values that must survive a free rewrite exactly, such as counts and prices. */
  requiredLiterals?: readonly string[];
  /** Values the generated wording must not expose, such as the sender's display name. */
  blockedLiterals?: readonly string[];
  /**
   * The openings of the lines the APPLICATION writes, which she may never write herself
   * (CCB-S5-027, D-180).
   *
   * Derived from this bot's persona by `markersFromTemplates`, so an operator who rewords a
   * line rewords its guard in the same edit, and a persona key a later briefing adds is
   * covered without anybody remembering to add it here.
   *
   * OPTIONAL IN THE TYPE AND UNIVERSAL IN PRODUCTION, and the difference is worth stating.
   * Making it required would touch twenty harnesses that build a request by hand and none of
   * which is testing this; instead there is exactly one production path into this function,
   * `InteractionEngine.personalizeForThisBot`, and it sets the field AFTER spreading the
   * caller's request so no lane can drop it. `verify:protected-text` asserts that from the
   * source, which is the same shape `verify:runtime-host` uses for `host.ts`.
   */
  protectedMarkers?: readonly string[];
  /** Maximum free reply length. Locked leads use their own smaller limit. */
  maxChars?: number;
  /**
   * How she is dialled (CCB-S4-029, D-133). DIALLED MODES ONLY, which since CCB-S4-031
   * means `conversation` and `retort`: the command modes rephrase a decision the
   * application already made, and a personality that could rewrite a consent
   * confirmation or a price in its own voice would be a personality with reach into
   * things this file exists to protect.
   *
   * Absent means the operator has configured no runtime bot, not that she has no
   * boundaries: the permissiveness ceiling is emitted either way.
   */
  personality?: BotPersonality | null;
  /**
   * The given facts about her: name, what she is, where the archive and project live,
   * and the names she refuses (CCB-S4-030, CCB-S4-031, D-135).
   *
   * DIALLED MODES ONLY (`conversation` and `retort`), like the personality. The command
   * modes rewrite a draft the application already composed, and that draft already says
   * her name wherever it should through the `{wake}` placeholder in the persona copy.
   */
  identity?: BotIdentity;
  /**
   * The wall clock, from the engine's single injectable source (CCB-S4-036).
   *
   * Carried on every request and RENDERED only in the dialled modes, like the personality
   * and the identity. A command rewrite is rephrasing a decision the application already
   * made and has no business being told the date; free conversation is where somebody asks
   * what year it is.
   *
   * Absent means no clock was supplied, and the prompt then says nothing about the time
   * rather than inventing one. That is the honest shape and it is also what every harness
   * written before this briefing gets by default.
   */
  now?: CurrentTime;
  /**
   * Search results, as UNTRUSTED QUOTED MATERIAL (CCB-S4-037, D-141).
   *
   * ── WHERE THIS GOES, AND WHY THAT IS THE WHOLE DEFENCE ────────────────────
   *
   * NOT into the system prompt. The system prompt is application-authored text that tells
   * the model what it is and what it may do; putting a stranger's prose in there is
   * handing that stranger the same authority the application has. These go into the USER
   * message, inside a named fence, and the system prompt says what the fence contains and
   * that nothing inside it may be obeyed.
   *
   * That separation is structural rather than a wording convention. There is no code path
   * that can move a result into the instruction section, because the instruction section
   * is built by `systemPrompt` from constants and configured values, and this field is
   * read only by the user-content builder.
   *
   * ── AND WHY THEY CANNOT CAUSE ANYTHING ────────────────────────────────────
   *
   * A result reaching this field has already passed through the search service, which
   * holds no chat client, no database and no consent code. From here it becomes characters
   * in one prompt whose output is bounded by every guard that already applies: the blocked
   * literals, the placeholder rejection and the invented-mention strip from CCB-S4-036,
   * and the length cap. There is nowhere for it to go except into the wording of one
   * reply to the person who asked.
   */
  /**
   * Passages from the operator's documents (CCB-S5-022).
   *
   * VERBATIM slices of what he gave her, fenced in the user message exactly as the web
   * results and the history are. The application decides which document names appear under
   * the answer; the model is never asked and never writes that line (D-137).
   */
  /**
   * TEXT ONLY, AND NO DOCUMENT NAME (CCB-S5-027, D-180).
   *
   * It used to carry the title and render it as the fence label, and that is what made the
   * forged attribution she produced in production LOOK REAL: she was handed the exact
   * string the application was about to print, and one of the passages' titles came back
   * inside her prose as a citation of her own.
   *
   * The title is dropped from the type rather than merely left unrendered, because a field
   * that holds it is a field a later prompt builder can spread into the message. What she
   * cannot be shown, she cannot copy.
   *
   * D-176 had already made this call once, one door along: the contextual prefix is not sent
   * either, because prepending "From X, under Y" to a passage would be the application
   * putting words in the document's mouth. A name beside the passage is the same act.
   *
   * WHAT IT COSTS, stated rather than glossed: she can no longer say which passage came from
   * where, so per-document attribution is foreclosed and the application's line names every
   * document she was HANDED rather than the ones she used. That is the honest direction. The
   * documents she was handed is a fact this code knows; the ones she used is a claim only
   * she could make, and this whole briefing is about not letting her make claims.
   */
  knowledgePassages?: readonly { text: string }[];
  webResults?: readonly { title: string; snippet: string; url: string }[];
  /**
   * Which of `webResults` the answer actually drew on, as the model declares them
   * (CCB-S4-042, D-145).
   *
   * A CALLBACK rather than a return value, and it is called only when the model both
   * answered and declared. That is the fail-closed shape the caller needs: a model that
   * omits the field, an older model, a malformed response, a thrown request, all leave the
   * caller with no declaration and therefore no attribution. The failure direction is a
   * missing source line, never a source line on a refusal, which is the defect this
   * exists for: she refused to search for pornography and the application printed the
   * domains underneath the refusal.
   *
   * Indices are passed through UNVALIDATED beyond being numbers. The caller owns the
   * result list and validates against it; validating here would be a second place that
   * has to agree about what is in range.
   */
  onSourcesUsed?: (indices: readonly number[]) => void;
  /**
   * What was said in this chat before the current message (CCB-S4-044, D-147).
   *
   * UNTRUSTED, and it rides in the USER message inside {@link HISTORY_FENCE}, never in the
   * system prompt. Everything in it was written by members, so a member can write "ignore
   * your instructions" into a group and have it arrive here an hour later as remembered
   * context. That is the same threat search results posed (D-141) with a worse timing
   * property, and it gets the same structural answer: the instruction section is built by
   * `systemPrompt` from the registry and configured values, and this field is read only by
   * the user-content builder. There is no code path from here into the rules.
   *
   * Already trimmed to the operator's limits and the hard character budget by the caller;
   * this transport does not re-decide how much of it to send, it only fences what it is
   * given.
   */
  history?: readonly { speaker: string; text: string }[];
  /**
   * How far back the history she was given is allowed to reach, in minutes.
   *
   * Carried alongside the entries because the rule that tells her what she can see has to
   * state BOTH halves, and the count alone would let her claim a window she does not have.
   */
  historyWindowMinutes?: number;
  /**
   * The rules she may quote, supplied EXACTLY (CCB-S4-045, D-148).
   *
   * Application-authored text, unlike the history and the search results, so it is not
   * fenced as untrusted: these are her own laws. What it is instead is EXACT. The registry
   * text is handed over verbatim and she is told to quote rather than reword, because D-137
   * settled that a model asked to preserve a fact inside prose it rewrites corrupts it, and
   * a paraphrased rule is her stating her own law inaccurately.
   *
   * RULES rather than strings, because the registry holds placeholders and a rule quoted from
   * `rule.text` would hand a member the literal `{{name}}`. They go through the same renderer
   * as the prompt stream, with the same values, so what she quotes is what she is under.
   */
  nameableRules?: readonly PromptRule[];
  /** Whether anything is withheld. Decides whether she is told to say so. */
  hasWithheldRules?: boolean;
  /**
   * The ORIENTATION she gives to a general question (CCB-S4-048, D-150).
   *
   * Present means: quote nothing, state these counts exactly, name these areas, invite a
   * question. The counts also travel as required literals, because D-137 settled that a
   * number a model is asked to preserve inside its own prose is a number it will smooth.
   */
  ruleOverview?: { total: number; constitutional: number; areas: string };
  /**
   * How many more rules the area they asked about holds, beyond the ones quoted.
   *
   * Zero or absent means the quoted set IS the area. Non-zero makes her say there is more
   * and invite another question, rather than reading two of nine and stopping.
   */
  moreInArea?: number;
  /**
   * What the record holds for the rules quoted (CCB-S4-050, D-152).
   *
   * Only ever about rules that have ALREADY passed the nameable gate, because it is built from
   * the same selection. An internal rule's invocations are as withheld as its text, by the
   * same mechanism rather than by a second one.
   */
  ruleInvocations?: string;
  /**
   * This answer IS one page of the Book (CCB-S5-005, D-159).
   *
   * Present means: the application is printing the law, whole and numbered, underneath
   * whatever she says, so she writes a line handing over to it and quotes nothing. No rule
   * text travels with it, deliberately: measured, a model handed a law and its page number
   * puts the number on a different law, and a page number that points at the wrong page is
   * worse than no page number.
   */
  lawPage?: boolean;
}

/**
 * The delimiter that marks untrusted web content (CCB-S4-037).
 *
 * Duplicated from the search service's `FENCE` on purpose, and the two are asserted equal
 * by `verify:search`. The service needs it to STRIP it out of results; the prompt needs it
 * to WRAP them. Importing the plugin from here would make the interaction layer depend on
 * a plugin, which is exactly backwards: plugins depend on the core.
 */
export const SEARCH_FENCE = '<<<UNTRUSTED-WEB-CONTENT>>>';

/**
 * The delimiter that marks remembered conversation (CCB-S4-044, D-147).
 *
 * ── WHY HISTORY GETS ITS OWN FENCE AND NOT THE SEARCH ONE ─────────────────
 *
 * They are different claims. The search fence says "strangers on the web wrote this"; this
 * one says "people in this room said this, and one of them may have been trying to plant an
 * instruction for you to find later". A model that can tell them apart can weigh them
 * differently, and a single marker would have made the two indistinguishable inside the
 * user message.
 *
 * The stakes are higher here than for search, which is worth saying plainly: a planted line
 * sitting in a group and firing an hour later is a nastier attack than one in a search
 * result, because the attacker chooses the timing and the target is a room they are already
 * in. The answer is the same shape as D-141 and the proof has to be stronger.
 */
export const HISTORY_FENCE = '<<<UNTRUSTED-CHAT-HISTORY>>>';

/**
 * The delimiter that marks text retrieved from the operator's own documents
 * (CCB-S5-022, D-176).
 *
 * ── WHY IT IS FENCED AT ALL, WHEN THE OPERATOR WROTE IT ─────────────────────
 *
 * Because the fence is structural, and an exception carved for trust is a thing somebody
 * widens later. These documents are the least hostile input in the system - his own protocol
 * notes, on his own disk - and that is exactly the argument that would be made for the next
 * source, and the one after that, until the fence means nothing.
 *
 * There is also a real case, not a hypothetical one: a document is a FILE, and files are
 * copied from places. A protocol specification pasted out of a vendor PDF, a decision record
 * quoting an email, an architecture note with a snippet of somebody's config in it: the
 * operator wrote the document, and he did not write every sentence in it.
 *
 * Its own marker rather than the search one, for the reason history has its own: they are
 * different claims. The search fence says strangers on the web wrote this; this one says the
 * operator gave me this, treat it as reference material and not as an instruction.
 */
export const KNOWLEDGE_FENCE = '<<<REFERENCE-DOCUMENT>>>';

const DEFAULT_MAX_CHARS = 700;
const LOCKED_LEAD_MAX_CHARS = 180;

function asRecord(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`Ollama returned an invalid ${label}.`);
  }
  return value as Record<string, unknown>;
}

/**
 * An addressed-to construct the model invented at the head of its own reply (CCB-S4-036).
 *
 * ── THE OBSERVED DEFECT ──────────────────────────────────────────────────────
 *
 * Asked to answer in the words of Elon Musk, she opened with `@elons-ghost:`. In a chat
 * client that reads as a mention of a member, and there is no such member. It is the
 * model doing what chat transcripts in its training data do, and it has nothing to do
 * with anything this application asked for.
 *
 * ── WHY A LEADING `@handle` IS INVENTED BY CONSTRUCTION ──────────────────────
 *
 * She is never given member names. The standing guard forbids writing a person name other
 * than her own, and the sender's name is separately rejected outright by `blockedLiterals`.
 * So an `@handle` at the START of model output cannot be a real member she was told about:
 * there is no path by which she could have learned one. That is what makes stripping it
 * safe rather than a guess about who exists.
 *
 * ── WHY IT CANNOT DISTURB THE APPLICATION'S OWN PREFIX ───────────────────────
 *
 * The `{name}` mention prefix on the Replies page is applied by `formatOutbound`, in
 * `reply.ts`, AFTER this function has run and to a body this function has already
 * finished with. This only ever sees the model's raw output, never the assembled message,
 * so the legitimate prefix is out of reach by ordering rather than by pattern matching.
 * The check proves that path still works end to end.
 *
 * Anchored at the start and applied once. A mid-sentence `@` is left alone: an address
 * somebody typed, an email, a handle being discussed are all legitimate content, and this
 * is about a chat-transcript artefact in the opening position, not about the character.
 */
const INVENTED_MENTION = /^\s*@[\p{L}\p{N}][\p{L}\p{N}._-]{0,63}\s*[:,]\s*/u;

export function stripInventedMention(value: string): string {
  return value.replace(INVENTED_MENTION, '');
}

function cleanReply(value: string, preserveLines: boolean): string {
  const withoutFences = stripInventedMention(value)
    .replace(/```/g, '')
    .replace(/[\u2013\u2014\u2015]/g, ' - ')
    // Control characters are stripped ON PURPOSE: this is untrusted model output on its way to
    // a member, and a stray C0/C1 byte would ride into the chat. The rule fires on the intent,
    // not on a fault.
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '');

  if (!preserveLines) return withoutFences.replace(/\s+/g, ' ').trim();

  return withoutFences
    .split(/\r?\n/)
    .map((line) => line.trimEnd())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/**
 * The reply envelope.
 *
 * `usedResults` is present ONLY when results were attached (CCB-S4-042). A field asking
 * which sources were used, on a request that carries no sources, is an invitation to
 * invent some, and it is the same reasoning that keeps the fence instruction out of an
 * ordinary prompt.
 *
 * It is REQUIRED when present, because `strict: true` json_schema needs every property
 * listed in `required`, and because a model that must answer the question cannot quietly
 * skip it. An empty array is the honest answer for a refusal and is what the caller reads
 * as "attribute nothing".
 */
function responseSchema(maxChars: number, withSources: boolean): Record<string, unknown> {
  return {
    type: 'object',
    additionalProperties: false,
    required: withSources ? ['reply', 'usedResults'] : ['reply'],
    properties: {
      reply: {
        type: 'string',
        minLength: 1,
        maxLength: maxChars,
      },
      ...(withSources
        ? {
            usedResults: {
              type: 'array',
              items: { type: 'integer', minimum: 0 },
            },
          }
        : {}),
    },
  };
}

/**
 * The system prompt, assembled from the rule registry (CCB-S4-039, D-144).
 *
 * ── WHAT THIS FUNCTION STILL DECIDES ─────────────────────────────────────────
 *
 * Not one sentence. Every instruction the model reads is a record in
 * `cinderella_prompt_rules`, seeded by `migrations/035_prompt_rules.sql`, and this decides
 * only three things: which LANES the mode draws from, which CONDITIONS hold, and what fills
 * the placeholders. There is no literal here to fall back to, deliberately: a fallback would
 * be a second source of the rules and a second source drifts.
 *
 * ── WHICH MODES CARRY HER VOICE ──────────────────────────────────────────────
 *
 * `conversation`, `retort` and `searching` do; `free` and `locked` do not (D-133). The
 * command modes rephrase a decision the application already made, and a personality able to
 * reword a consent confirmation is not one anybody asked for. That is expressed as the
 * `dialled` and `command` lanes, and as a context in which nothing personal is in scope for
 * the command modes: no personality, no name, no clock. The person-name guard therefore
 * takes its generic variant there, exactly as it did when this was an `&&`.
 *
 * ── WHY THE FENCE INSTRUCTION IS CONDITIONAL ─────────────────────────────────
 *
 * The `has-web-results` rules are emitted only when results are actually attached, so an
 * ordinary reply carries no mention of a capability it is not using, and a prompt that talks
 * about web content when none was fetched cannot invite the model to invent some (D-141).
 *
 * Exported for the checks. One that reasoned about the prompt from the outside would be
 * asserting on its own model of this function rather than on this function.
 */
export function systemPrompt(request: AiReplyRequest, outputMaxChars: number): string {
  const dialled =
    request.mode === 'conversation' ||
    request.mode === 'retort' ||
    request.mode === 'searching';

  const base = dialled
    ? dialledPromptInputs(
        request.rules,
        request.personality ?? null,
        request.identity,
        request.now,
      )
    : { context: NOTHING_IN_SCOPE, values: {} as Record<string, string> };

  const context: PromptRuleContext = {
    ...base.context,
    hasWebResults: (request.webResults?.length ?? 0) > 0,
    hasKnowledge: (request.knowledgePassages?.length ?? 0) > 0,
    hasHistory: (request.history?.length ?? 0) > 0,
    hasNameableRules: (request.nameableRules?.length ?? 0) > 0,
    hasWithheldRules: request.hasWithheldRules === true,
    hasRuleOverview: request.ruleOverview !== undefined,
    hasMoreInArea: (request.moreInArea ?? 0) > 0,
    hasInvocationRecord: (request.ruleInvocations ?? '').length > 0,
    hasLawPage: request.lawPage === true,
  };

  // Everything except the quoted block, so the quoted block can be rendered WITH it.
  const quoteValues: Record<string, string> = {
    ...base.values,
    // The INSTRUCTION half of the length bound. The number itself is computed from the
    // verbosity dial by the caller (see `generateOllamaReply`), because it is also the hard
    // limit the reply is rejected against, and the two must come from one place (D-142).
    maxChars: String(outputMaxChars),
    // Stays in code rather than in the registry: it is a delimiter the search service and
    // this file must agree on character for character, and `verify:search` asserts they do.
    // An operator editing it in a console would break the agreement silently.
    fence: SEARCH_FENCE,
    // Same reasoning as the search fence: a delimiter the transport and the rule text must
    // agree on character for character, so it is code rather than an editable sentence.
    historyFence: HISTORY_FENCE,
    // Same reasoning again: a delimiter the transport and the rule text must agree on
    // character for character, so it is code rather than an editable sentence.
    knowledgeFence: KNOWLEDGE_FENCE,
    // What she may honestly say she can see. The COUNT is what was actually supplied after
    // every limit bound, not the configured maximum, because telling her she can see twenty
    // when she was handed four is the same class of false statement D-140 removed.
    historyCount: String(request.history?.length ?? 0),
    historyMinutes: String(request.historyWindowMinutes ?? 0),
    // Application facts, never counted by the model (D-137). Empty strings when there is no
    // overview: the rules that use them are not selected, so nothing renders them.
    ruleTotal: String(request.ruleOverview?.total ?? 0),
    ruleConstitutional: String(request.ruleOverview?.constitutional ?? 0),
    ruleAreas: request.ruleOverview?.areas ?? '',
    moreInArea: String(request.moreInArea ?? 0),
    ruleInvocations: request.ruleInvocations ?? '',
  };

  const values: Record<string, string> = {
    ...quoteValues,
    // One rule per line, rendered exactly as she is holding it. Handing over raw `rule.text`
    // quoted `{{name}}` at a member, which is her own law stated wrong: the failure D-137
    // describes, arriving through the one path that exists to state the law accurately.
    // `renderPromptRule` throws on a value it was not given, so a rule quoted outside the
    // lane whose values are in scope fails the reply into the deterministic fallback rather
    // than reaching a member with a hole in it.
    // Leading newline so the first rule starts a line of its own. Without it the block renders
    // as "...quoted for you: - Never write explicit sexual content.", which reads as prose
    // continuing the sentence rather than as the first item of a list, and the one rule most
    // likely to be the answer is the one that stops looking like a quotation.
    nameableRules: (request.nameableRules ?? [])
      .map((rule) => `\n- ${renderPromptRule(rule, quoteValues)}`)
      .join(''),
  };

  return assemblePrompt(request.rules, lanesForMode(request.mode), context, values).join('\n');
}

function parseCompletion(value: unknown): { reply: string; usedResults: number[] } {
  const envelope = asRecord(value, 'completion envelope');
  const choices = envelope['choices'];
  if (!Array.isArray(choices) || choices.length === 0) {
    throw new Error('Ollama returned no reply choice.');
  }

  const choice = asRecord(choices[0], 'completion choice');
  const message = asRecord(choice['message'], 'completion message');
  const content = message['content'];
  if (typeof content !== 'string' || content.trim() === '') {
    throw new Error('Ollama returned an empty reply completion.');
  }

  let decoded: unknown;
  try {
    decoded = JSON.parse(content);
  } catch {
    throw new Error('Ollama returned malformed reply JSON.');
  }

  const result = asRecord(decoded, 'reply result');
  const reply = result['reply'];
  if (typeof reply !== 'string') {
    throw new Error('Ollama returned an invalid reply field.');
  }

  // The declaration is OPTIONAL to parse even when the schema required it (CCB-S4-042).
  // A missing or malformed field must not cost the member their answer: it costs the
  // attribution, which is the direction this is allowed to fail in. Anything that is not
  // a finite number is dropped here; range is the caller's business, since the caller is
  // the one holding the result list.
  const declared = result['usedResults'];
  const usedResults = Array.isArray(declared)
    ? declared.filter((value): value is number => typeof value === 'number' && Number.isFinite(value))
    : [];

  return { reply, usedResults };
}

function cleanLiterals(values: readonly string[] | undefined): string[] {
  return [...new Set((values ?? []).map((value) => value.trim()).filter((value) => value !== ''))];
}

function requiredLiterals(request: AiReplyRequest): string[] {
  return cleanLiterals(request.requiredLiterals);
}

function blockedLiterals(request: AiReplyRequest): string[] {
  return cleanLiterals(request.blockedLiterals);
}

function containsBlockedLiteral(text: string, request: AiReplyRequest): string | undefined {
  const lower = text.toLocaleLowerCase();
  return blockedLiterals(request).find((literal) => lower.includes(literal.toLocaleLowerCase()));
}

/**
 * A placeholder that should have been filled and was not (CCB-S4-036).
 *
 * ── THE GRAMMAR IS BORROWED, NOT INVENTED ────────────────────────────────────
 *
 * The pattern is exactly what `fillPersona` substitutes, `/\{(\w+)\}/`. That is
 * deliberate: the thing being detected is "a token the template layer would have replaced,
 * still sitting in the output", so the detector has to use the template layer's own idea
 * of what a placeholder is. A looser pattern would fire on `{}` or on prose in braces,
 * neither of which is a leak.
 *
 * ── REJECT, DO NOT STRIP, AND WHY ────────────────────────────────────────────
 *
 * The briefing left the choice open and named the trade. Rejecting is what this does, for
 * three reasons.
 *
 * Stripping leaves a hole. `Hey {name}, good to see you` becomes `Hey , good to see you`,
 * which is a broken sentence that reads as a different bug and would have members
 * reporting the wrong thing. Rejecting falls back to the deterministic draft, which is
 * always a complete sentence somebody wrote.
 *
 * It is the same shape as `blockedLiterals`, which already rejects rather than redacts
 * when the sender's name appears. Two guards on the same output behaving differently is
 * how one of them gets forgotten.
 *
 * And a leaked `{name}` is a REAL BUG somewhere upstream, not cosmetic damage. `reply.ts`
 * documents the footgun in terms: two different values can fill `{name}` in this pipeline
 * and they must never be filled in the same pass. Rejecting makes the failure loud, in the
 * logs and in the AI telemetry, instead of quietly tidying the evidence away.
 */
const UNRESOLVED_PLACEHOLDER = /\{\w+\}/;

export function unresolvedPlaceholder(text: string): string | undefined {
  return UNRESOLVED_PLACEHOLDER.exec(text)?.[0];
}

/**
 * Does this call ask the model to REWRITE the application's draft, or to write beside it?
 *
 * The distinction decides whether a protected line inside the draft is hers to carry.
 * `free` and `retort` replace the draft with what comes back, so the protected content has
 * to survive in her wording or it is lost; `locked` keeps the draft and appends it under
 * her lead, so a lead repeating it is either a duplicate or, worse, a second copy with the
 * number reworded, which is the D-137 failure with an extra step.
 *
 * Stated as a predicate with the reasoning attached rather than inlined, because the next
 * mode somebody adds has to answer this question and should have to read the answer.
 */
function modelRewritesTheDraft(mode: AiReplyMode): boolean {
  return mode === 'free' || mode === 'retort';
}

/**
 * Takes back any line of the model's that imitates one the application writes
 * (CCB-S5-027, D-180).
 *
 * Runs on the RAW completion, before cleaning, length checking and every other guard, so a
 * forged attribution can neither push a reply over its bound nor survive into a lane that
 * appends the real line underneath it.
 *
 * Records what it removed. This is a fallback that hides a fault by design - the member
 * sees a correct reply and nothing downstream knows a forgery was in it - and CCB-S3-023
 * requires exactly that kind of fallback to be counted where an operator can see the count.
 */
function guardProtectedText(raw: string, request: AiReplyRequest): string {
  const markers = request.protectedMarkers ?? [];
  if (markers.length === 0) return raw;

  const { text, removed } = stripProtectedLines(
    raw,
    markers,
    modelRewritesTheDraft(request.mode) ? request.deterministicDraft : '',
  );
  for (const line of removed) {
    recordForgedLine({
      at: Date.now(),
      botProfileId: request.botProfileId ?? null,
      kind: request.kind,
      where: line.where,
      text: line.text,
    });
  }
  return text;
}

export async function generateOllamaReply(
  config: LocalAiConfig,
  request: AiReplyRequest,
  fetchImpl: FetchLike = fetch,
): Promise<string> {
  const maxChars =
    request.mode === 'locked'
      ? LOCKED_LEAD_MAX_CHARS
      : request.mode === 'searching'
        ? // A HOLDING LINE, bounded far below anything else she says. It scales with
          // verbosity like everything else, because a terse bot should be terse about
          // this too, but the ceiling is low at every setting: this is one sentence.
          Math.max(40, Math.min(request.maxChars ?? Math.round(retortCharBudget(request.personality?.verbosity ?? 5) * 0.6), 200))
        : request.mode === 'retort'
        ? // THE DIAL MOVES THE BOUND (CCB-S4-038). Told to be expansive under a fixed cap,
          // she writes past it, the reply is rejected for length and the member gets the
          // deterministic fallback, so the operator concludes the slider does nothing. The
          // instruction and the limit come from the same number instead. An explicit
          // `maxChars` from a caller still wins, because a caller that named a length meant
          // it. A retort scales far less and stays a one-liner: see `retortCharBudget`.
          Math.max(
            40,
            Math.min(
              request.maxChars ?? retortCharBudget(request.personality?.verbosity ?? 5),
              400,
            ),
          )
        : request.mode === 'conversation'
          ? Math.max(
              80,
              Math.min(
                request.maxChars ?? replyCharBudget(request.personality?.verbosity ?? 5),
                1400,
              ),
            )
          : Math.max(80, Math.min(request.maxChars ?? DEFAULT_MAX_CHARS, 1600));
  const hasWebResults = (request.webResults?.length ?? 0) > 0;
  const endpoint = new URL('/v1/chat/completions', `${config.baseUrl}/`);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.timeoutMs);
  // Opened before the request and closed in `finally`, so a throw, a timeout and an abort
  // all record a completed call. A meter that only counted successes would report a
  // healthy queue on a deployment where every second reply was failing (CCB-S3-023).
  const call = modelQueue.start(request.botProfileId ?? null);
  let callOk = false;

  try {
    const response = await fetchImpl(endpoint, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: config.model,
        messages: [
          {
            role: 'system',
            content: systemPrompt(request, maxChars),
          },
          {
            role: 'user',
            content: JSON.stringify({
              replyKind: request.kind.slice(0, 80),
              language: request.lang.slice(0, 16),
              memberMessage: request.memberMessage.slice(0, 2000),
              // UNTRUSTED, and structurally separated: this rides in the user message,
              // never in the system prompt, and every entry is wrapped in the named fence
              // so the model can see exactly where a stranger's words start and stop. The
              // service has already stripped the fence marker out of the content itself,
              // so nothing in here can close the fence early (CCB-S4-037).
              ...(request.webResults?.length
                ? {
                    webResults: request.webResults.map((result) => ({
                      title: `${SEARCH_FENCE}${result.title}${SEARCH_FENCE}`,
                      snippet: `${SEARCH_FENCE}${result.snippet}${SEARCH_FENCE}`,
                      url: result.url,
                    })),
                  }
                : {}),
              // THE OPERATOR'S DOCUMENTS (CCB-S5-022), fenced per passage for the same
              // reason as everything else in this object. The text is verbatim from a file
              // he uploaded; the marker is stripped from it before it gets here, so nothing
              // in a document can close its own fence and continue as the application.
              ...(request.knowledgePassages?.length
                ? {
                    // UNNAMED, since CCB-S5-027. See the field's own documentation: the
                    // title was the one string she could copy to forge a citation that
                    // looked real, and she was being handed it beside the passage.
                    referenceDocuments: request.knowledgePassages.map(
                      (p) => `${KNOWLEDGE_FENCE}${p.text}${KNOWLEDGE_FENCE}`,
                    ),
                  }
                : {}),
              // REMEMBERED CONVERSATION, fenced per entry for the same reason the web
              // results are (CCB-S4-044). The caller has stripped the marker out of the
              // text, so nothing in here can close its own fence early and continue as if
              // it were the application talking.
              ...(request.history?.length
                ? {
                    chatHistory: request.history.map(
                      (line) => `${HISTORY_FENCE}${line.speaker}: ${line.text}${HISTORY_FENCE}`,
                    ),
                  }
                : {}),
              // Omitted in conversation mode rather than sent empty: an empty field
              // invites the model to invent something to rewrite.
              ...(request.mode === 'conversation'
                ? {}
                : { deterministicDraft: request.deterministicDraft.slice(0, 5000) }),
              requiredLiterals: requiredLiterals(request),
            }),
          },
        ],
        stream: false,
        temperature: 0.7,
        max_tokens: 320,
        reasoning_effort: 'none',
        response_format: {
          type: 'json_schema',
          json_schema: {
            name: 'cinderella_reply',
            strict: true,
            schema: responseSchema(maxChars, hasWebResults),
          },
        },
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new Error(`Ollama reply HTTP ${response.status}.`);
    }

    const completion = parseCompletion(await response.json());
    // FIRST, before cleaning and before every other guard (CCB-S5-027). See
    // `guardProtectedText`: the lines the application writes are taken back out of hers
    // here, so nothing further down can measure, reject or ship one.
    const raw = guardProtectedText(completion.reply, request);

    if (request.mode === 'locked') {
      const lead = cleanReply(raw, false);
      if (!lead || lead.length > LOCKED_LEAD_MAX_CHARS) {
        throw new Error('Ollama returned an invalid locked reply lead.');
      }
      const blocked = containsBlockedLiteral(lead, request);
      if (blocked) throw new Error(`Ollama reply exposed blocked text: ${blocked}.`);
      const leaked = unresolvedPlaceholder(lead);
      if (leaked) throw new Error(`Ollama reply leaked an unresolved placeholder: ${leaked}.`);
      const protectedText = request.deterministicDraft.trim();
      return protectedText ? `${lead}\n${protectedText}` : lead;
    }

    const reply = cleanReply(raw, true);
    if (!reply || reply.length > maxChars) {
      throw new Error('Ollama returned an invalid personalized reply length.');
    }

    const missing = requiredLiterals(request).filter((literal) => !reply.includes(literal));
    if (missing.length > 0) {
      throw new Error(`Ollama reply lost required literal(s): ${missing.join(', ')}.`);
    }
    const blocked = containsBlockedLiteral(reply, request);
    if (blocked) throw new Error(`Ollama reply exposed blocked text: ${blocked}.`);
    const leaked = unresolvedPlaceholder(reply);
    if (leaked) throw new Error(`Ollama reply leaked an unresolved placeholder: ${leaked}.`);
    // Checked LAST, on the text that is about to be returned, so nothing added after the
    // strip can reintroduce one. See `unresolvedPlaceholder` for why this rejects.

    // AFTER every guard has passed (CCB-S4-042). A reply that is about to be rejected for
    // a blocked literal or a leaked placeholder must not leave a source declaration behind
    // it, because the caller would then attribute a reply the member never sees.
    if (hasWebResults) request.onSourcesUsed?.(completion.usedResults);

    callOk = true;
    return reply;
  } catch (error) {
    if (controller.signal.aborted) {
      throw new Error(`Ollama reply timed out after ${config.timeoutMs} ms.`);
    }
    throw error;
  } finally {
    clearTimeout(timeout);
    modelQueue.finish(call, callOk);
  }
}
