/**
 * The Book of Elii (CCB-S4-043, D-146): the laws she runs under, readable and editable.
 *
 * ── WHY THIS EXISTS ──────────────────────────────────────────────────────────
 *
 * CCB-S4-039 moved eighty-two rules out of the source and into a table. Nothing read them
 * but the assembler and nothing could change them but a migration, so the operator still
 * could not see the laws his own bot runs under. That was the complaint that started the
 * whole line of work: he had to ask what had been written into her.
 *
 * ── THE TONE IS PART OF THE SPECIFICATION, AND SO IS ITS LIMIT ───────────────
 *
 * The operator asked for weight here, and it is the right instinct rather than decoration: a
 * book of laws carried through the wasteland is exactly what this holds. So the framing and
 * the copy carry gravity, and there is friction where friction belongs.
 *
 * What it must never become is a page whose drama gets in the way of finding a rule. The
 * rules themselves stay plain, searchable and boringly legible; the theatre is in the
 * chrome, never in the text an operator has to read to do their job.
 *
 * ── WHAT AN OPERATOR MAY DO, AND WHAT THE PAGE OWES THEM ─────────────────────
 *
 * He may weaken her from here. He may disable the ceiling. It is his system and the page
 * does not forbid it. What the page owes him is that it can never happen by accident or in
 * silence: constitutional edits need the rule's own id typed out, every change is recorded
 * with both sides of it, a disabled critical rule is stated loudly at the top of the book,
 * and the same condition turns `verify:prompt-identity` red.
 *
 * These rules were drafted by an assistant and not authored by the operator. He has said as
 * much. The page treats them as his to revise, and `source` says where each came from.
 */

import type { FastifyInstance } from 'fastify';
import {
  listPromptRules,
  listPromptRuleHistory,
  listRecentPromptRuleChanges,
  rollbackPromptRule,
  shippedPromptRuleText,
  updatePromptRule,
  type PromptRuleChange,
} from '../../db/prompt-rules.js';
import {
  BOOK_MODES,
  bookByLane,
  bookByMode,
  disabledCriticalRules,
  driftedRules,
  withEdit,
  type BookSection,
} from '../../interaction/prompt-book.js';
import type { PromptRule, PromptRuleSet } from '../../interaction/prompt-rules.js';
import {
  replyCharBudget,
  type BotIdentity,
  type BotPersonality,
} from '../../interaction/personality.js';
import { invalidatePromptRules } from '../../interaction/prompt-rule-service.js';
import { lawPages } from '../../interaction/law-numbers.js';
import {
  clearOverrideRecorded,
  listAllOverrides,
  listOverridesForBot,
  listOverridesForRule,
  setOverrideRecorded,
} from '../../db/prompt-rule-overrides.js';
import {
  applyOverrides,
  canOverride,
  describeScopes,
  CONSTITUTIONAL_SCOPE_REASON,
  type RuleOverride,
  type RuleScope,
} from '../../interaction/rule-scope.js';
import { resolveSelectedBot } from '../selected-bot.js';
import { listBotOnboardingProfiles } from '../../profiles/bot-onboarding.js';
import { currentReplyModel } from '../../interaction/ai-runtime.js';
import { botIdentity } from '../../interaction/settings.js';
import { previewPersonality } from '../preview-personality.js';
import { html, page, raw, type SafeHtml } from '../html.js';
import type { ViewContext } from '../server.js';
import { badge, card, fmtDate, pageHeader } from './ui.js';
import { systemPrompt, type AiReplyMode } from '../../interaction/ollama-reply.js';
import {
  PROMPT_RULE_CONDITIONS,
  PROMPT_RULE_LANES,
  PROMPT_RULE_TIERS,
  type PromptRuleCondition,
  type PromptRuleLane,
  type PromptRuleTier,
} from '../../interaction/prompt-rules.js';
import { listRecitalChapters } from '../../db/recital-chapters.js';
import {
  chapterForNewRule,
  rejectRuleId,
  ruleFamilies,
} from '../../interaction/rule-overview.js';
import { createPromptRule } from '../../db/prompt-rules.js';

const INPUT_CLS = 'w-full rounded-lg border border-slate-300 px-2 py-1.5 text-sm';
const TEXTAREA_CLS = 'w-full rounded-lg border border-slate-300 px-2 py-1.5 font-mono text-sm';

function bodyString(body: unknown, key: string): string {
  const value = (body as Record<string, unknown> | null)?.[key];
  return typeof value === 'string' ? value : '';
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * The tone, in one place, so it stays consistent and stays out of the rule text.
 *
 * The count is DERIVED (D-228): it shipped as the literal "Eighty-two" and sat one line
 * above a counter reading 121, because prose holding a number is prose holding a stale
 * number - the plugin-count lesson (CLAUDE.md) on an operator-facing page.
 */
function epigraph(ruleCount: number): string {
  return (
    `${String(ruleCount)} sentences decide what she will and will not do. They are written ` +
    'down, they are hers to be held to, and they are yours to revise. Read before you change one.'
  );
}

/**
 * What a law's scope is, said in the list and said again on its own page (CCB-S5-001).
 *
 * The briefing's requirement in one word: RECOGNISABLE. A rule you cannot read is a rule
 * you cannot trust, and a rule whose scope you cannot read is the same problem one level
 * up - an operator editing a sentence has to know, before typing, whether he is changing
 * one bot or all of them.
 */
function scopeBadge(scope: RuleScope | undefined): SafeHtml | null {
  if (!scope) return null;
  if (scope.kind === 'constitutional') return badge('shared: every bot', 'red');
  if (scope.kind === 'per-bot') {
    return badge(
      `per bot: ${String(scope.deviations.length)} differ${scope.deviations.length === 1 ? 's' : ''}`,
      'amber',
    );
  }
  return badge(`shared: ${String(scope.sharedBotCount)} bot(s)`, 'slate');
}

/** Which bots deviate and how, named rather than counted, for the rule's own page. */
function scopeDetail(
  scope: RuleScope | undefined,
  botNames: Map<number, string>,
): SafeHtml | null {
  if (!scope) return null;
  if (scope.kind === 'constitutional') {
    // The reason already opens by saying it is shared and cannot be set for one, so a
    // lead-in that says it again reads as a stutter on the rendered page. Seen there
    // rather than reasoned about: D-111's rule, applied to copy.
    return html`<p class="mt-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-900">
      ${CONSTITUTIONAL_SCOPE_REASON}
    </p>`;
  }
  if (scope.kind === 'shared') {
    return html`<p class="mt-2 text-xs text-slate-500">
      Shared. Every one of the ${String(scope.sharedBotCount)} bot(s) reads this exact sentence.
    </p>`;
  }
  return html`<div class="mt-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
    <p class="font-semibold">Set per bot.</p>
    <ul class="mt-1 list-disc pl-4">
      ${scope.deviations.map(
        (d) => html`<li>
          ${botNames.get(d.botProfileId) ?? `bot ${String(d.botProfileId)}`}:
          ${d.off ? 'switched off' : null}${d.off && d.reworded ? ' and ' : null}${d.reworded
            ? 'reworded'
            : null}
        </li>`,
      )}
    </ul>
    <p class="mt-1">
      The other ${String(scope.sharedBotCount)} bot(s) read the shared sentence above.
    </p>
  </div>`;
}

/**
 * Setting one law for one bot (CCB-S5-001).
 *
 * A CONSTITUTIONAL law gets a sentence saying it cannot be done and why, rather than a
 * control that accepts the click and then refuses. The briefing asks for exactly that
 * distinction, and it is the difference between a system that explains itself and one that
 * argues with you.
 */
function perBotPanel(
  rule: PromptRule,
  bots: { id: number; displayName: string; enabled: boolean }[],
  overrides: RuleOverride[],
  csrf: string,
): SafeHtml {
  if (!canOverride(rule)) {
    return html`<section class="mt-4 rounded-xl border border-red-200 bg-red-50/60 p-4">
      <h3 class="text-sm font-bold text-red-900">This law cannot be set for one bot</h3>
      <p class="mt-1 text-sm text-red-900">${CONSTITUTIONAL_SCOPE_REASON}</p>
      <p class="mt-2 text-xs text-red-800">
        If you need genuinely different limits for a community, that is a whole rulebook
        rather than an exception to this one, and it is not built yet.
      </p>
    </section>`;
  }

  const byBot = new Map(overrides.map((o) => [o.botProfileId, o]));

  return html`<section class="mt-4 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
    <h3 class="text-sm font-bold text-slate-900">This law, per bot</h3>
    <p class="mt-1 text-sm text-slate-600">
      Leave a bot alone and it reads the shared sentence, and keeps tracking it when the
      shared sentence is edited. Switch it off, or give that one bot different words.
    </p>
    <div class="mt-3 flex flex-col gap-3">
      ${bots.map((bot) => {
        const o = byBot.get(bot.id);
        const deviates = o !== undefined;
        return html`<form
          method="post"
          action="/book/rule/${rule.id}/bot"
          class="rounded-lg border ${deviates
            ? 'border-amber-300 bg-amber-50/50'
            : 'border-slate-200 bg-slate-50'} p-3"
        >
          <input type="hidden" name="_csrf" value="${csrf}" />
          <input type="hidden" name="botProfileId" value="${String(bot.id)}" />
          <div class="flex flex-wrap items-center gap-2">
            <span class="text-sm font-semibold text-slate-900">${bot.displayName}</span>
            ${bot.enabled ? null : badge('not running', 'slate')}
            ${deviates ? badge('has its own version', 'amber') : badge('shared', 'slate')}
          </div>
          <div class="mt-2 flex flex-wrap items-center gap-4">
            <label class="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                name="enabled"
                ${(o?.enabled ?? rule.enabled) ? raw('checked') : ''}
                class="rounded"
              />
              In effect for this bot
            </label>
          </div>
          <label class="mt-2 flex flex-col gap-1 text-sm">
            <span class="text-slate-700">
              Its own wording ${o?.text === null || o?.text === undefined
                ? html`<span class="text-slate-400">(empty = use the shared sentence)</span>`
                : null}
            </span>
            <textarea
              name="text"
              rows="3"
              placeholder="${rule.text}"
              class="w-full rounded-lg border border-slate-300 px-2 py-1.5 font-mono text-xs"
            >${o?.text ?? ''}</textarea>
          </label>
          <div class="mt-2 flex flex-wrap gap-3">
            <button
              type="submit"
              class="rounded-lg bg-slate-900 px-3 py-1.5 text-sm font-medium text-white"
            >
              Save for ${bot.displayName} only
            </button>
            ${deviates
              ? html`<button
                  type="submit"
                  name="action"
                  value="clear"
                  class="rounded-lg border border-slate-300 px-3 py-1.5 text-sm text-slate-700"
                >
                  Put this bot back on the shared law
                </button>`
              : null}
          </div>
        </form>`;
      })}
    </div>
  </section>`;
}

function tierBadge(tier: string): SafeHtml {
  if (tier === 'constitutional') return badge('constitutional', 'red');
  if (tier === 'bot') return badge('bot', 'amber');
  return badge('standard', 'slate');
}

/* ── The alarm ───────────────────────────────────────────────────────────── */

/**
 * A disabled critical rule, stated where nobody can miss it.
 *
 * NOT a prevention. The briefing is explicit and it is the right call: the operator may do
 * this, nobody may do it unnoticed. So this is loud, it names what the rule protected, and
 * it says in the same breath that the verification suite is now red.
 */
function alarm(rules: PromptRuleSet): SafeHtml | null {
  const missing = disabledCriticalRules(rules);
  if (missing.length === 0) return null;

  return html`<div
    class="mb-6 rounded-xl border-2 border-red-500 bg-red-50 px-4 py-3 text-sm text-red-900"
  >
    <p class="text-base font-bold">
      ${String(missing.length)} rule${missing.length === 1 ? ' is' : 's are'} switched off that
      the guard requires.
    </p>
    <p class="mt-1">
      These were marked <strong>critical</strong> because their absence should never be quiet.
      She is running without them right now, and
      <code>npm run verify:prompt-identity</code> is red until they come back or somebody
      decides, deliberately, that they should not.
    </p>
    <ul class="mt-2 list-disc space-y-1 pl-5">
      ${missing.map(
        (rule) => html`<li>
          <code class="font-semibold">${rule.id}</code>
          <span class="block text-red-800">${rule.text}</span>
        </li>`,
      )}
    </ul>
  </div>`;
}

/* ── One rule ────────────────────────────────────────────────────────────── */

interface ScopeView {
  scopes: Map<string, RuleScope>;
  botNames: Map<number, string>;
}

function ruleCard(
  entry: { rule: PromptRule; position?: number; conditional: boolean; shippedText?: string },
  csrf: string,
  openId: string,
  view?: ScopeView,
  pages?: ReadonlyMap<string, number>,
): SafeHtml {
  const rule = entry.rule;
  const open = openId === rule.id;
  const drifted = entry.shippedText !== undefined && entry.shippedText !== rule.text;
  // THE PAGE NUMBER A MEMBER SEES (CCB-S5-005). The same computation the chat uses, so the
  // operator and the member are looking at the same book. Absent on a withheld rule, because
  // a withheld rule has no page number: see `law-numbers.ts` for why that is deliberate.
  const page = pages?.get(rule.id);

  return html`<article
    id="rule-${rule.id}"
    class="rounded-xl border ${rule.enabled
      ? 'border-slate-200'
      : 'border-amber-300 bg-amber-50/40'} bg-white p-4 shadow-sm"
  >
    <div class="flex flex-wrap items-center gap-2">
      ${entry.position ? html`<span class="text-xs font-mono text-slate-400">#${String(entry.position)}</span>` : null}
      ${page
        ? html`<span
            class="rounded bg-slate-900 px-1.5 py-0.5 text-xs font-mono font-semibold text-white"
            title="The page number she quotes to a member: &quot;that is law ${String(page)}&quot;."
            >law ${String(page)}</span
          >`
        : null}
      <code class="text-sm font-semibold text-slate-900">${rule.id}</code>
      ${tierBadge(rule.tier)} ${rule.critical ? badge('critical', 'red') : null}
      ${rule.enabled ? null : badge('disabled', 'amber')}
      ${drifted ? badge('changed from shipped', 'amber') : null}
      ${rule.nameable ? badge('nameable', 'green') : badge('withheld', 'slate')}
      ${scopeBadge(view?.scopes.get(rule.id))}
      <span class="ml-auto text-xs text-slate-400">
        lane ${rule.lane} · ord ${String(rule.ord)} · ${rule.appliesWhen}
      </span>
    </div>

    <p class="mt-2 whitespace-pre-wrap text-sm text-slate-800">${rule.text}</p>

    ${view ? scopeDetail(view.scopes.get(rule.id), view.botNames) : null}

    <p class="mt-2 text-xs text-slate-400">
      from <code>${rule.source}</code>
    </p>

    <div class="mt-3 flex flex-wrap gap-3 text-sm">
      <a class="underline" href="/book/rule/${rule.id}">Edit${open ? ' (open below)' : ''}</a>
      <a class="underline" href="/book/history?rule=${rule.id}">History</a>
    </div>

    ${open ? editor(rule, csrf, entry.shippedText, view?.scopes.get(rule.id)) : null}
  </article>`;
}

/**
 * The editor for one rule.
 *
 * A CONSTITUTIONAL rule needs its own id typed out. That is the same reasoning the arming
 * control uses: a checkbox is one you tick once and then forever, and the id is the one
 * string that cannot be typed by muscle memory because it is different for every rule.
 */
function editor(
  rule: PromptRule,
  csrf: string,
  shippedText?: string,
  scope?: RuleScope,
): SafeHtml {
  const constitutional = rule.tier === 'constitutional';

  return html`<form
    method="post"
    action="/book/rule/${rule.id}"
    class="mt-4 flex flex-col gap-3 rounded-lg border ${constitutional
      ? 'border-red-300 bg-red-50/50'
      : 'border-slate-200 bg-slate-50'} p-3"
  >
    <input type="hidden" name="_csrf" value="${csrf}" />

    ${constitutional
      ? html`<div class="rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-900">
          <p class="font-semibold">This is a constitutional rule.</p>
          <p class="mt-1">
            It is one of the boundaries: what she will not say, what she must not invent, what
            she may not do with a stranger's text. Changing it changes what she is permitted to
            do, not how she sounds. Nothing below stops you. Type the rule's id to say you meant
            it, and the change is recorded with both sides of it.
          </p>
        </div>`
      : null}

    ${scope && scope.kind !== 'constitutional'
      ? html`<div class="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700">
          <p class="font-semibold">What this edit will touch, before you make it.</p>
          <p class="mt-1">
            This is the SHARED sentence. Saving it changes
            ${String(scope.sharedBotCount)} bot(s)${scope.deviations.length > 0
              ? html` - every bot except the ${String(scope.deviations.length)} that
                  ${scope.deviations.length === 1 ? 'has' : 'have'} its own version of this law,
                  which ${scope.deviations.length === 1 ? 'keeps' : 'keep'} what
                  ${scope.deviations.length === 1 ? 'it was' : 'they were'} given`
              : null}.
            To change it for one bot only, use the per-bot section on the rule's own page.
          </p>
        </div>`
      : null}

    <label class="flex flex-col gap-1 text-sm">
      <span class="font-medium text-slate-700">The sentence she is told</span>
      <textarea
        name="text"
        rows="4"
        class="w-full rounded-lg border border-slate-300 px-2 py-1.5 font-mono text-sm"
      >${rule.text}</textarea>
    </label>

    <div class="flex flex-wrap items-end gap-4">
      <label class="flex items-center gap-2 text-sm">
        <input type="checkbox" name="enabled" ${rule.enabled ? raw('checked') : ''} class="rounded" />
        Enabled
      </label>
      <label class="flex items-center gap-2 text-sm">
        <input type="checkbox" name="nameable" ${rule.nameable ? raw('checked') : ''} class="rounded" />
        She may quote this to a member who asks
      </label>
      <label class="flex flex-col gap-1 text-sm">
        <span class="font-medium text-slate-700">Order</span>
        <input
          name="ord"
          type="number"
          value="${String(rule.ord)}"
          class="w-32 rounded-lg border border-slate-300 px-2 py-1.5 text-sm"
        />
      </label>
    </div>

    ${constitutional
      ? html`<label class="flex flex-col gap-1 text-sm">
          <span class="font-medium text-red-900">Type <code>${rule.id}</code> to confirm</span>
          <input
            name="confirm"
            autocomplete="off"
            placeholder="${rule.id}"
            class="w-full rounded-lg border border-red-300 px-2 py-1.5 font-mono text-sm sm:w-96"
          />
        </label>`
      : null}

    ${shippedText !== undefined && shippedText !== rule.text
      ? html`<details class="text-sm">
          <summary class="cursor-pointer text-slate-600">What this rule shipped as</summary>
          <p class="mt-1 whitespace-pre-wrap rounded-lg bg-white p-2 font-mono text-xs text-slate-600">
${shippedText}</p>
        </details>`
      : null}

    <div class="flex flex-wrap gap-3">
      <button
        type="submit"
        name="action"
        value="preview"
        class="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100"
      >
        Preview the prompt this would make
      </button>
      <button
        type="submit"
        name="action"
        value="save"
        class="rounded-lg ${constitutional
          ? 'bg-red-700 hover:bg-red-800'
          : 'bg-slate-900 hover:bg-slate-700'} px-3 py-2 text-sm font-medium text-white"
      >
        Save
      </button>
    </div>
  </form>`;
}

/* ── The preview ─────────────────────────────────────────────────────────── */

/**
 * The dialled voice as it WOULD be, beside what it is now.
 *
 * Rendered from the real personality and identity, because the question here is what she
 * would actually be told, not what a representative bot would be. Falls back to a plain
 * message when no runtime is up rather than inventing a bot to preview against.
 */
/** The given facts, live, so a preview is the prompt rather than a description of one. */
function previewIdentity(ctx: ViewContext): BotIdentity {
  const model = currentReplyModel();
  return { ...botIdentity(ctx.interaction.get()), ...(model ? { model } : {}) };
}

/**
 * Which mode actually carries this rule.
 *
 * A preview that always showed the conversation VOICE would tell an operator editing an
 * `all`-lane guard that nothing moved, because the voice section is the dialled lane only.
 * That was the first version and it was wrong in exactly the way this page must not be:
 * confidently showing no change where there is one. So the mode is chosen from the rule.
 *
 * `dial-axis` maps to conversation because its three template rows are rendered into the
 * dial block, which a conversation prompt carries.
 */
function modeFor(rule: PromptRule): AiReplyMode {
  switch (rule.lane) {
    case 'command':
    case 'free':
      return 'free';
    case 'locked':
      return 'locked';
    case 'retort':
      return 'retort';
    case 'searching':
      return 'searching';
    default:
      return 'conversation';
  }
}

/**
 * Whose prompt a preview is of (D-229).
 *
 * Resolved once per request and handed in, rather than reached for inside the card, because
 * the previous version reached for it and got nothing: `currentBotPersonality()` with no bot
 * id answered with the PRIMARY's personality until CCB-S5-019 took that fallback away, and
 * has answered `null` ever since. A parameter cannot rot that way - a caller that forgets it
 * does not compile - and it keeps the card a pure function of what it is given.
 */
interface PreviewBot {
  /** The bot's display name, or null when the deployment has no bots at all. */
  name: string | null;
  /** Its personality, read from the rows, or null when it has none configured. */
  personality: BotPersonality | null;
}

/**
 * The prompt as it WOULD be, beside what it is now.
 *
 * Rendered through `systemPrompt`, the reply path's own function, so this is not a second
 * assembly that happens to agree today. The identity is the live one and the personality is
 * the SELECTED BOT'S, read from its rows, because the question here is what she would
 * actually be told rather than what a representative bot would be.
 *
 * ── THE CLAIM THIS COMMENT USED TO MAKE, AND WHY IT WAS FALSE ────────────────
 *
 * It said "the personality and the identity are the live ones" for seven months while the
 * personality was `null` on every render: the dial block, the base character and the origin
 * were absent from every previewed prompt, and the page went on saying "this is the same
 * function the reply path calls, so what you read here is what she would be told". The
 * function was; the arguments were not. Corrected in place per D-191 rather than deleted,
 * because a comment that was confidently wrong is worth leaving legible.
 */
function previewCard(
  current: PromptRuleSet,
  proposed: PromptRuleSet,
  rule: PromptRule,
  identity: BotIdentity,
  bot: PreviewBot,
): SafeHtml {
  const personality = bot.personality;
  const mode = modeFor(rule);

  const render = (rules: PromptRuleSet): string => {
    try {
      return systemPrompt(
        {
          kind: 'preview',
          lang: 'en',
          memberMessage: '',
          deterministicDraft: '',
          mode,
          rules,
          personality,
          identity,
          now: {
            at: new Date(),
            timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
          },
        },
        replyCharBudget(personality?.verbosity ?? 5),
      );
    } catch (error) {
      return `(could not assemble: ${errorMessage(error)})`;
    }
  };

  const before = render(current);
  const after = render(proposed);

  return card(
    'The prompt this would make',
    html`
      <p class="text-sm text-slate-600">
        A <strong>${mode}</strong> prompt, assembled from the registry with your change applied
        and nothing saved. The mode is the one this rule's lane reaches; the same edit shows up
        in every other mode that draws the same lane. This is the same function the reply path
        calls, so what you read here is what she would be told.
        ${
          /* WHOSE PROMPT, SAID OUT LOUD (D-229). The same requirement the Assembled Word
             carries and for the same reason: the voice section differs per bot, so an
             unlabelled prompt is worse than no prompt.

             SELF-CONTAINED, AND THAT IS THE POINT. The first draft said "the bot selected in
             the sidebar", and the screenshot showed the sidebar reading "Deployment-wide" two
             inches away, because the Book's own pages carry no switcher: the LAWS are the
             deployment's. So the sentence says why a bot is named on a page that edits
             everybody's laws, instead of pointing at a control that is not there. */ ''
        }
        ${bot.name === null
          ? html`<br />No bot is configured, so this carries no character and no dials: the
              original voice under the ceiling, which is what she would be told with none.`
          : html`<br />The laws are the deployment's; the voice around them is one bot's, so a
              preview has to pick one. This is <strong>${bot.name}</strong>, with that bot's
              own dials, base character and origin.`}
        ${before === after
          ? html`<strong class="text-amber-800">
              Nothing moved: this edit changes no sentence in this prompt.</strong
            >`
          : null}
      </p>
      <div class="mt-3 grid gap-3 lg:grid-cols-2">
        <div>
          <p class="mb-1 text-xs font-semibold uppercase text-slate-500">Now</p>
          <pre class="personality-prompt">${before}</pre>
        </div>
        <div>
          <p class="mb-1 text-xs font-semibold uppercase text-slate-500">
            With ${rule.id} changed
          </p>
          <pre class="personality-prompt">${after}</pre>
        </div>
      </div>
    `,
  );
}
/* ── Sections ────────────────────────────────────────────────────────────── */

function sectionBlock(
  section: BookSection,
  csrf: string,
  openId: string,
  view?: ScopeView,
  pages?: ReadonlyMap<string, number>,
): SafeHtml {
  return html`<section class="mt-6">
    <h2 class="text-sm font-bold uppercase tracking-wide text-slate-500">
      ${section.title}
      <span class="ml-2 font-normal normal-case text-slate-400">
        ${String(section.entries.length)} rule${section.entries.length === 1 ? '' : 's'}
      </span>
    </h2>
    <p class="mt-1 text-sm text-slate-500">${section.note}</p>
    <div class="mt-3 flex flex-col gap-3">
      ${section.entries.map((entry) => ruleCard(entry, csrf, openId, view, pages))}
    </div>
  </section>`;
}

function viewTabs(mode: string, query: string): SafeHtml {
  const href = (m: string): string =>
    `/book?view=${m}${query ? `&q=${encodeURIComponent(query)}` : ''}`;
  const tab = (m: string, label: string): SafeHtml =>
    html`<a
      class="rounded-lg px-3 py-1.5 text-sm ${mode === m
        ? 'bg-slate-900 font-medium text-white'
        : 'border border-slate-300 bg-white text-slate-700 hover:bg-slate-50'}"
      href="${href(m)}"
      >${label}</a
    >`;

  return html`<div class="flex flex-wrap gap-2">
    ${tab('lanes', 'Every rule, by lane')}
    ${BOOK_MODES.map((m) => tab(m, `As ${m}`))}
  </div>`;
}

/* ── Registration ────────────────────────────────────────────────────────── */

export function registerBookOfElii(app: FastifyInstance, ctx: ViewContext): void {
  /**
   * Every law's scope, and the bots it is measured against (CCB-S5-001).
   *
   * Read together, because a scope is meaningless without the bot count: "shared" has to
   * say how many, and "per bot" has to name which.
   */
  const readScopes = async (
    rules: PromptRuleSet,
  ): Promise<{
    view: ScopeView;
    bots: { id: number; displayName: string; enabled: boolean }[];
  }> => {
    const profiles = await listBotOnboardingProfiles(ctx.db);
    const bots = profiles.map((p) => ({
      id: p.id,
      displayName: p.displayName,
      enabled: p.enabled,
    }));
    const overrides = await listAllOverrides(ctx.db);
    return {
      view: {
        scopes: describeScopes(rules, overrides, bots.length),
        botNames: new Map(bots.map((b) => [b.id, b.displayName])),
      },
      bots,
    };
  };

  /**
   * The bot a preview is of, and its personality (D-229).
   *
   * The sidebar's STANDING selection, never `?bot=`: a preview arrives as a form POST with
   * no query string of its own, so the session is the only thing that can say which bot the
   * operator is working on. Same resolver as every other settings page (CCB-S5-011), so the
   * preview shows the bot whose name the sidebar is displaying while it is being read.
   */
  const previewBot = async (sessionBot: number | null): Promise<PreviewBot> => {
    const profiles = await listBotOnboardingProfiles(ctx.db);
    const selection = resolveSelectedBot(profiles, undefined, sessionBot);
    return {
      name: selection.selectedName,
      personality: await previewPersonality(ctx.db, selection.selectedId),
    };
  };

  /** The Book: read, search, and open one rule for editing. */
  app.get<{ Querystring: { view?: string; q?: string; saved?: string; error?: string } }>(
    '/book',
    async (req, reply) => {
      const csrf = req.session?.csrfToken ?? '';
      const rules = await listPromptRules(ctx.db);
      const shipped = await shippedPromptRuleText(ctx.db);
      const view = req.query.view ?? 'lanes';
      const query = req.query.q ?? '';
      const drifted = driftedRules(rules, shipped);

      const sections =
        view !== 'lanes' && (BOOK_MODES as readonly string[]).includes(view)
          ? [bookByMode(rules, view as AiReplyMode, shipped, query)]
          : bookByLane(rules, shipped, query);

      const shown = sections.reduce((n, s) => n + s.entries.length, 0);
      const { view: scopeView, bots } = await readScopes(rules);
      const pages = lawPages(rules);
      const deviatingLaws = [...scopeView.scopes.values()].filter(
        (s) => s.deviations.length > 0,
      ).length;
      reply.type('text/html');

      return page({
        title: 'The Book of Elii',
        active: 'book:rules',
        csrfToken: csrf,
        body: html`
          ${pageHeader('The Book of Elii', 'The laws she runs under, and what happens when you change one.')}
          ${req.query.saved
            ? html`<div class="mb-4 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
                Written to the book, and recorded in the history.
              </div>`
            : null}
          ${req.query.error
            ? html`<div class="mb-4 rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-800">
                ${req.query.error}
              </div>`
            : null}
          ${alarm(rules)}

          <div class="mb-5 rounded-xl border border-slate-800 bg-slate-900 px-4 py-3 text-sm text-slate-200">
            <p class="text-xs font-semibold uppercase tracking-widest text-slate-400">
              What is written here is what she is
            </p>
            <p class="mt-2">${epigraph(rules.length)}</p>
            <p class="mt-2 text-slate-400">
              ${String(rules.length)} rules ·
              ${String(rules.filter((r) => r.tier === 'constitutional').length)} constitutional ·
              ${String(rules.filter((r) => !r.enabled).length)} switched off ·
              ${String(drifted.length)} changed from what shipped ·
              ${String(rules.filter((r) => r.nameable).length)} she may name ·
              ${String(rules.filter((r) => !r.nameable).length)} withheld from members
            </p>
            ${
              /* The scope statement, on the knowledge model (D-228): state, bot,
                 consequence, where. The true split here is by TIER, not by page. */ ''
            }
            <p class="mt-2 text-slate-400">
              This Book is the deployment's: every bot reads these laws. A
              <strong>constitutional</strong> law binds all ${String(bots.length)} bot${bots.length === 1 ? '' : 's'}
              identically and cannot be given to one bot alone. A <strong>standard</strong> law
              can be switched or reworded for a single bot on that law's own page${deviatingLaws > 0
                ? html`, and ${String(deviatingLaws)} ${deviatingLaws === 1 ? 'law currently deviates' : 'laws currently deviate'}
                    for some bot - each one says so below`
                : html`; none currently deviates`}.
              The Assembled Word shows what any one bot is actually told.
            </p>
            <p class="mt-2 text-slate-400">
              ${String(pages.size)} of them have a PAGE NUMBER, which is what she quotes when
              somebody asks for "law 12" and what a member can ask her for. The number is the
              law's position among the ones she may name, sorted by id, so editing text or
              reordering the prompt never moves it. Adding, removing or withholding a law does.
              A withheld law has no number, deliberately: numbering them all would let anybody
              read a withheld law's subject off its neighbours.
            </p>
          </div>

          <div class="mb-4 flex flex-col gap-3">
            <div>
              <a
                href="/book/new"
                class="inline-block rounded-lg bg-slate-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-slate-700"
                >Enact a new law</a
              >
            </div>
            ${viewTabs(view, query)}
            <form method="get" action="/book" class="flex flex-wrap gap-2">
              <input type="hidden" name="view" value="${view}" />
              <input
                name="q"
                value="${query}"
                placeholder="Search id, text, lane, tier, condition or source"
                class="w-full rounded-lg border border-slate-300 px-2 py-1.5 text-sm sm:w-96"
              />
              <button
                type="submit"
                class="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50"
              >
                Search
              </button>
              ${query
                ? html`<a class="self-center text-sm underline" href="/book?view=${view}">Clear</a>`
                : null}
            </form>
            <p class="text-sm text-slate-500">
              Showing ${String(shown)} of ${String(rules.length)}.
            </p>
          </div>

          ${sections.map((section) => sectionBlock(section, csrf, '', scopeView, pages))}
        `,
      });
    },
  );

  /**
   * Enacting a law (CCB-S4-051, D-153).
   *
   * Every field is ASKED FOR rather than defaulted, because each one is a decision the
   * operator would otherwise discover later: an id he cannot change, a lane that decides which
   * replies see it, a position that decides how much weight it carries against the model's
   * trained habits.
   */
  app.get<{ Querystring: Record<string, string> }>('/book/new', async (req, reply) => {
    const csrf = req.session?.csrfToken ?? '';
    const rules = await listPromptRules(ctx.db);
    const chapters = await listRecitalChapters(ctx.db);
    const families = ruleFamilies(chapters);
    const highest = rules.reduce((n, r) => Math.max(n, r.ord), 0);
    reply.type('text/html');

    return page({
      title: 'Enact a law | The Book of Elii',
      active: 'book:rules',
      csrfToken: csrf,
      body: html`
        ${pageHeader('Enact a law', 'A new law, written into the Book and into her prompt.')}
        ${req.query['error']
          ? html`<div class="mb-4 rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-800">
              ${req.query['error']}
            </div>`
          : null}

        <form method="post" action="/book/new" class="grid gap-4">
          <input type="hidden" name="_csrf" value="${csrf}" />

          ${card(
            'What it says',
            html`<label class="flex flex-col gap-1 text-sm">
              <span class="font-medium text-slate-700">The law</span>
              <textarea name="text" rows="5" class="${TEXTAREA_CLS}">${req.query['text'] ?? ''}</textarea>
              <span class="text-xs text-slate-500">
                One instruction, in the second person, as she will read it. This is the exact
                text that goes into her prompt and, if it is nameable, the exact text a member
                is quoted.
              </span>
            </label>`,
          )}

          ${card(
            'What it is called',
            html`<label class="flex flex-col gap-1 text-sm">
                <span class="font-medium text-slate-700">Id</span>
                <input name="id" value="${req.query['id'] ?? ''}" placeholder="ceiling.no-slurs" class="${INPUT_CLS}" />
                <span class="text-xs text-slate-500">
                  Permanent. It outlives every rewording and every reorder, and it is what the
                  history, the checks and the chapter assignment refer to. Lowercase and dotted.
                </span>
                <span class="text-xs text-slate-500">
                  The part before the first dot is the FAMILY, and it decides which chapter
                  reads this law out. A law in no family is in her prompt and unreadable by
                  anybody asking about that part of the Book, so it is refused. Families in use:
                  ${families.map((f: string) => html`<code>${f}</code> `)}
                </span>
              </label>`,
          )}

          ${card(
            'How it applies',
            html`
              <div class="grid gap-3 sm:grid-cols-2">
                <label class="flex flex-col gap-1 text-sm">
                  <span class="font-medium text-slate-700">Lane</span>
                  <select name="lane" class="${INPUT_CLS}">
                    ${PROMPT_RULE_LANES.map(
                      (l: string) => html`<option value="${l}">${l}</option>`,
                    )}
                  </select>
                  <span class="text-xs text-slate-500">
                    Which replies see it. <code>all</code> is every reply she writes;
                    <code>dialled</code> is free conversation and retorts, where her voice is;
                    the rest are the command and search lanes.
                  </span>
                </label>
                <label class="flex flex-col gap-1 text-sm">
                  <span class="font-medium text-slate-700">Applies when</span>
                  <select name="appliesWhen" class="${INPUT_CLS}">
                    ${PROMPT_RULE_CONDITIONS.map(
                      (c: string) =>
                        html`<option value="${c}" ${c === 'always' ? raw('selected') : ''}>${c}</option>`,
                    )}
                  </select>
                  <span class="text-xs text-slate-500">
                    From the fixed vocabulary (D-144), never free text: the assembler implements
                    these in code. <code>always</code> unless the law only makes sense in one
                    situation.
                  </span>
                </label>
              </div>
              <label class="mt-3 flex flex-col gap-1 text-sm">
                <span class="font-medium text-slate-700">Position</span>
                <input name="ord" type="number" value="${String(highest + 1)}" class="${INPUT_CLS} sm:w-40" />
                <span class="text-xs text-slate-500">
                  <strong>Later carries more weight.</strong> The prompt is read in order, and a
                  law meant to overrule the model's trained habits needs to sit near the end.
                  The highest in use is ${String(highest)}, so the default puts this last.
                </span>
              </label>
            `,
          )}

          ${card(
            'What kind of law',
            html`
              <label class="flex flex-col gap-1 text-sm">
                <span class="font-medium text-slate-700">Tier</span>
                <select name="tier" class="${INPUT_CLS}">
                  ${PROMPT_RULE_TIERS.map(
                    (t: string) =>
                      html`<option value="${t}" ${t === 'standard' ? raw('selected') : ''}>${t}</option>`,
                  )}
                </select>
                <span class="text-xs text-slate-500">
                  <code>standard</code> unless this is a boundary no setting may relax.
                  Enacting a <code>constitutional</code> law is as consequential as changing
                  one, so it asks you to type the id to confirm.
                </span>
              </label>
              <label class="mt-3 flex items-center gap-2 text-sm">
                <input type="checkbox" name="nameable" class="rounded" />
                <span>She may quote this law to a member who asks</span>
              </label>
              <span class="text-xs text-slate-500">
                Nameable if it EXPLAINS her behaviour to somebody affected by it. Internal if
                its exact wording is a lever. Internal is the default because a law nobody
                decided about should not be quotable.
              </span>
              <label class="mt-3 flex items-center gap-2 text-sm">
                <input type="checkbox" name="critical" class="rounded" />
                <span>Its absence should be loud</span>
              </label>
              <span class="text-xs text-slate-500">
                Critical laws are checked for presence by <code>verify:prompt-identity</code>,
                so disabling one turns the suite red and shouts at the top of the Book. For
                anything the product's safety rests on.
              </span>
              <label class="mt-3 flex items-center gap-2 text-sm">
                <input type="checkbox" name="enabled" checked class="rounded" />
                <span>In force from now</span>
              </label>
            `,
          )}

          ${card(
            'Confirm',
            html`
              <label class="flex flex-col gap-1 text-sm">
                <span class="font-medium text-slate-700">
                  Typed confirmation, for a constitutional law only
                </span>
                <input name="confirm" placeholder="type the id again" class="${INPUT_CLS}" />
                <span class="text-xs text-slate-500">
                  Left empty for a standard law. A constitutional one takes the same ceremony as
                  changing one: type the id exactly.
                </span>
              </label>
              <div class="mt-3 flex gap-2">
                <button
                  type="submit"
                  name="action"
                  value="preview"
                  class="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50"
                >
                  Preview the prompt
                </button>
                <button
                  type="submit"
                  name="action"
                  value="save"
                  class="rounded-lg bg-slate-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-slate-700"
                >
                  Enact it
                </button>
              </div>
            `,
          )}
        </form>
      `,
    });
  });

  app.post<{ Body: Record<string, unknown> }>('/book/new', async (req, reply) => {
    const csrf = req.session?.csrfToken ?? '';
    const actor = req.session?.username ?? 'unknown';
    const rules = await listPromptRules(ctx.db);
    const chapters = await listRecitalChapters(ctx.db);

    const id = bodyString(req.body, 'id').trim();
    const text = bodyString(req.body, 'text').replace(/\r\n/g, '\n').trim();
    const tier = bodyString(req.body, 'tier') as PromptRuleTier;
    const lane = bodyString(req.body, 'lane') as PromptRuleLane;
    const appliesWhen = bodyString(req.body, 'appliesWhen') as PromptRuleCondition;
    const ord = Number.parseInt(bodyString(req.body, 'ord'), 10);

    const back = (message: string): string =>
      `/book/new?error=${encodeURIComponent(message)}&id=${encodeURIComponent(id)}&text=${encodeURIComponent(text)}`;

    const idProblem = rejectRuleId(chapters, id);
    if (idProblem) return reply.redirect(back(idProblem));
    if (!text) return reply.redirect(back('A law with no text is not a law.'));
    if (!Number.isSafeInteger(ord)) return reply.redirect(back('Position must be a whole number.'));
    if (!(PROMPT_RULE_TIERS as readonly string[]).includes(tier)) {
      return reply.redirect(back('Unknown tier.'));
    }
    if (!(PROMPT_RULE_LANES as readonly string[]).includes(lane)) {
      return reply.redirect(back('Unknown lane.'));
    }
    if (!(PROMPT_RULE_CONDITIONS as readonly string[]).includes(appliesWhen)) {
      return reply.redirect(back('Unknown condition.'));
    }

    const proposed: PromptRule = {
      id,
      tier,
      lane,
      appliesWhen,
      ord,
      text,
      enabled: 'enabled' in req.body,
      critical: 'critical' in req.body,
      nameable: 'nameable' in req.body,
      scope: null,
      source: `the console (${actor})`,
    };

    // THE PREVIEW, before anything is written. The same question the edit path answers: what
    // would she actually be told?
    if (bodyString(req.body, 'action') === 'preview') {
      const bot = await previewBot(req.session?.selectedBotProfileId ?? null);
      reply.type('text/html');
      return page({
        title: `Preview ${id} | The Book of Elii`,
        active: 'book:rules',
        csrfToken: csrf,
        body: html`
          ${pageHeader('Before and after', `The prompt with "${id}" enacted.`)}
          <p class="mb-4 text-sm text-slate-600">
            Nothing has been written. This law would land in the chapter
            <strong>${chapterForNewRule(chapters, id)?.titleEn ?? 'none'}</strong>, at position
            ${String(ord)} of ${String(rules.length + 1)}.
          </p>
          ${previewCard(rules, [...rules, proposed], proposed, botIdentity(ctx.interaction.get()), bot)}
          <div class="mt-4">
            <a class="text-sm underline" href="${back('')}">Back to the form</a>
          </div>
        `,
      });
    }

    if (tier === 'constitutional' && bodyString(req.body, 'confirm').trim() !== id) {
      return reply.redirect(
        back(`That is a constitutional law. Type its id exactly (${id}) to enact it.`),
      );
    }

    try {
      await createPromptRule(ctx.db, proposed, actor);
    } catch (err) {
      return reply.redirect(back(errorMessage(err)));
    }
    invalidatePromptRules();
    return reply.redirect(`/book/rule/${id}?saved=1`);
  });

  /** One rule, open for editing, with its history beneath it. */
  app.get<{ Params: { id: string }; Querystring: { error?: string } }>(
    '/book/rule/:id',
    async (req, reply) => {
      const csrf = req.session?.csrfToken ?? '';
      const rules = await listPromptRules(ctx.db);
      const shipped = await shippedPromptRuleText(ctx.db);
      const rule = rules.find((r) => r.id === req.params.id);
      reply.type('text/html');

      if (!rule) {
        return page({
          title: 'The Book of Elii',
          active: 'book:rules',
          csrfToken: csrf,
          body: html`${pageHeader('No such rule')}
            <p class="text-sm text-slate-600">
              Nothing in the book has the id <code>${req.params.id}</code>.
              <a class="underline" href="/book">Back to the book</a>.
            </p>`,
        });
      }

      const history = await listPromptRuleHistory(ctx.db, rule.id, 20);
      const { view: scopeView, bots } = await readScopes(rules);
      const ruleOverrides = await listOverridesForRule(ctx.db, rule.id);
      const entry = {
        rule,
        conditional: rule.appliesWhen !== 'always',
        ...(shipped.has(rule.id) ? { shippedText: shipped.get(rule.id)! } : {}),
      };

      return page({
        title: `${rule.id} | The Book of Elii`,
        active: 'book:rules',
        csrfToken: csrf,
        body: html`
          ${pageHeader(rule.id, 'One rule, what it says, and everything that has been done to it.')}
          ${req.query.error
            ? html`<div class="mb-4 rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-800">
                ${req.query.error}
              </div>`
            : null}
          <p class="mb-4 text-sm"><a class="underline" href="/book">Back to the book</a></p>
          ${ruleCard(entry, csrf, rule.id, scopeView, lawPages(rules))}
          ${perBotPanel(rule, bots, ruleOverrides, csrf)}
          <div class="mt-4">${changeTable(history, csrf, false)}</div>
        `,
      });
    },
  );

  /**
   * Save or preview one rule.
   *
   * Preview and save are the SAME route and the same parsed body, so what the preview
   * rendered is what a save would write. Two routes would be two chances to disagree.
   */
  app.post<{ Params: { id: string }; Body: Record<string, unknown> }>(
    '/book/rule/:id',
    async (req, reply) => {
      const csrf = req.session?.csrfToken ?? '';
      const ruleId = req.params.id;
      const rules = await listPromptRules(ctx.db);
      const rule = rules.find((r) => r.id === ruleId);

      if (!rule) {
        return reply.redirect('/book?error=' + encodeURIComponent('No such rule.'));
      }

      const edit = {
        text: bodyString(req.body, 'text').replace(/\r\n/g, '\n').trim(),
        enabled: bodyString(req.body, 'enabled') !== '',
        ord: Number.parseInt(bodyString(req.body, 'ord'), 10),
        nameable: bodyString(req.body, 'nameable') !== '',
      };

      if (!edit.text) {
        return reply.redirect(
          `/book/rule/${ruleId}?error=` +
            encodeURIComponent('A rule with no text is not a rule. Disable it instead.'),
        );
      }
      if (!Number.isSafeInteger(edit.ord)) {
        return reply.redirect(
          `/book/rule/${ruleId}?error=` + encodeURIComponent('Order must be a whole number.'),
        );
      }

      const proposed = withEdit(rules, ruleId, edit);

      if (bodyString(req.body, 'action') === 'preview') {
        const bot = await previewBot(req.session?.selectedBotProfileId ?? null);
        reply.type('text/html');
        return page({
          title: `Preview ${ruleId} | The Book of Elii`,
          active: 'book:rules',
          csrfToken: csrf,
          body: html`
            ${pageHeader('Before you write it', 'What this change would do to the prompt she is given.')}
            <p class="mb-4 text-sm">
              <a class="underline" href="/book/rule/${ruleId}">Back to the rule</a>
            </p>
            ${previewCard(rules, proposed, rule, previewIdentity(ctx), bot)}
            <div class="mt-4">
              ${card(
                'Write it',
                html`<form method="post" action="/book/rule/${ruleId}" class="flex flex-col gap-3">
                  <input type="hidden" name="_csrf" value="${csrf}" />
                  <input type="hidden" name="text" value="${edit.text}" />
                  ${edit.enabled ? html`<input type="hidden" name="enabled" value="on" />` : null}
                  ${edit.nameable ? html`<input type="hidden" name="nameable" value="on" />` : null}
                  <input type="hidden" name="ord" value="${String(edit.ord)}" />
                  ${rule.tier === 'constitutional'
                    ? html`<label class="flex flex-col gap-1 text-sm">
                        <span class="font-medium text-red-900"
                          >Type <code>${rule.id}</code> to confirm</span
                        >
                        <input
                          name="confirm"
                          autocomplete="off"
                          placeholder="${rule.id}"
                          class="w-full rounded-lg border border-red-300 px-2 py-1.5 font-mono text-sm sm:w-96"
                        />
                      </label>`
                    : null}
                  <button
                    type="submit"
                    name="action"
                    value="save"
                    class="self-start rounded-lg ${rule.tier === 'constitutional'
                      ? 'bg-red-700 hover:bg-red-800'
                      : 'bg-slate-900 hover:bg-slate-700'} px-3 py-2 text-sm font-medium text-white"
                  >
                    Save this change
                  </button>
                </form>`,
              )}
            </div>
          `,
        });
      }

      // THE CONFIRMATION. Checked here rather than in the browser, because a check the client
      // performs is a check an operator's next tab does not.
      if (rule.tier === 'constitutional' && bodyString(req.body, 'confirm').trim() !== rule.id) {
        return reply.redirect(
          `/book/rule/${ruleId}?error=` +
            encodeURIComponent(
              `That is a constitutional rule. Type its id exactly (${rule.id}) to change it.`,
            ),
        );
      }

      try {
        const change = await updatePromptRule(
          ctx.db,
          ruleId,
          edit,
          req.session?.username ?? 'unknown',
        );
        // The reply path caches the registry, so without this the operator would save a rule
        // and watch the next three replies still follow the old one.
        if (change) invalidatePromptRules();
        return reply.redirect(change ? '/book?saved=1' : `/book/rule/${ruleId}`);
      } catch (error) {
        return reply.redirect(
          `/book/rule/${ruleId}?error=` + encodeURIComponent(errorMessage(error)),
        );
      }
    },
  );

  /** The Assembled Word: every mode's prompt, as it stands right now. */
  /**
   * Set or clear ONE law for ONE bot (CCB-S5-001).
   *
   * Separate from the shared-law route on purpose. They write different rows, record
   * different actions, and reach different numbers of bots, and one route deciding which
   * of those it meant from the shape of a form body is how an edit intended for one bot
   * reaches all of them.
   */
  app.post<{ Params: { id: string }; Body: Record<string, unknown> }>(
    '/book/rule/:id/bot',
    async (req, reply) => {
      const ruleId = req.params.id;
      const rules = await listPromptRules(ctx.db);
      const rule = rules.find((r) => r.id === ruleId);
      const back = (msg: string, ok = false): string =>
        `/book/rule/${encodeURIComponent(ruleId)}?${ok ? 'saved=1' : 'error=' + encodeURIComponent(msg)}`;

      if (!rule) return reply.redirect('/book?error=' + encodeURIComponent('No such rule.'));

      // The gate, before anything is written. The database refuses this too; this exists so
      // the operator gets a sentence rather than a constraint violation.
      if (!canOverride(rule)) {
        return reply.redirect(back(CONSTITUTIONAL_SCOPE_REASON));
      }

      const botProfileId = Number.parseInt(bodyString(req.body, 'botProfileId'), 10);
      if (!Number.isSafeInteger(botProfileId) || botProfileId <= 0) {
        return reply.redirect(back('That form did not say which bot it was for.'));
      }

      const shared = {
        sharedText: rule.text,
        sharedEnabled: rule.enabled,
        sharedOrd: rule.ord,
        sharedNameable: rule.nameable,
      };
      const actor = req.session?.username ?? 'operator';

      if (bodyString(req.body, 'action') === 'clear') {
        await clearOverrideRecorded(ctx.db, { botProfileId, ruleId, ...shared }, actor);
        invalidatePromptRules();
        return reply.redirect(back('', true));
      }

      const text = bodyString(req.body, 'text').replace(/\r\n/g, '\n').trim();
      const enabled = bodyString(req.body, 'enabled') !== '';
      // An empty box means INHERIT rather than an empty rule: a law with no words is not a
      // law, and the placeholder in the form says the shared sentence is what fills it.
      const nextText = text.length === 0 ? null : text;
      // Nothing to store when the bot would read exactly the shared law anyway. Writing a
      // row here would show the bot as deviating on the page while changing nothing.
      if (nextText === null && enabled === rule.enabled) {
        await clearOverrideRecorded(ctx.db, { botProfileId, ruleId, ...shared }, actor);
        invalidatePromptRules();
        return reply.redirect(back('', true));
      }

      try {
        await setOverrideRecorded(
          ctx.db,
          { botProfileId, ruleId, enabled, text: nextText, ...shared },
          actor,
        );
      } catch (err) {
        return reply.redirect(back(err instanceof Error ? err.message : String(err)));
      }
      invalidatePromptRules();
      return reply.redirect(back('', true));
    },
  );

  app.get<{ Querystring: { bot?: string } }>('/book/assembled', async (req, reply) => {
    const csrf = req.session?.csrfToken ?? '';
    const shared = await listPromptRules(ctx.db);

    // ── WHICH BOT THIS PREVIEWS, SAID OUT LOUD (CCB-S5-001) ────────────────
    //
    // The briefing asks for it by name, and the reason is that this page became a lie the
    // moment laws could differ: it assembled the shared registry and the primary's dials
    // and presented the result as "what she is told", when a bot that had reworded a law
    // was being told something else. An unlabelled prompt is worse than no prompt.
    const profiles = await listBotOnboardingProfiles(ctx.db);
    // Through the shared resolver since CCB-S5-011, so this page opens on the bot the
    // operator is editing everywhere else. It used to fall back to the PRIMARY, which is
    // the console role the switcher replaces: the primary flag is untouched, but nothing
    // here reads it any more.
    const selection = resolveSelectedBot(
      profiles,
      req.query.bot,
      req.session?.selectedBotProfileId ?? null,
    );
    const selected = profiles.find((p) => p.id === selection.selectedId);
    const overrides = selected ? await listOverridesForBot(ctx.db, selected.id) : [];
    const rules = applyOverrides(shared, overrides);
    // THE ROWS, NOT THE CACHE (D-229). This named the right bot and still asked the reply
    // path's cache, which answers a miss with `null` and kicks a refresh, so the FIRST load
    // after a boot assembled a word with no character in it and the second one had it. The
    // two preview branches above read the rows; a third answer to the same question on the
    // same page is how the two halves of a page come to disagree.
    const personality = await previewPersonality(ctx.db, selected?.id);
    const identity = previewIdentity(ctx);
    const deviations = overrides.length;
    reply.type('text/html');

    // THE REPLY PATH'S OWN FUNCTION, not a second assembly that agrees with it today.
    // `systemPrompt` is what `generateOllamaReply` calls, so a prompt shown here is the
    // prompt sent; building the context and the values separately would be a second
    // implementation with its own opinion about which rules apply.
    const assembled = (mode: AiReplyMode): string => {
      try {
        return systemPrompt(
          {
            kind: 'preview',
            lang: 'en',
            memberMessage: '',
            deterministicDraft: '',
            mode,
            rules,
            personality,
            identity,
            // The server's own zone, which is what the engine passes at reply time.
            now: {
              at: new Date(),
              timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
            },
          },
          replyCharBudget(personality?.verbosity ?? 5),
        );
      } catch (error) {
        return `(not assembled: ${errorMessage(error)})`;
      }
    };
    return page({
      title: 'The Assembled Word',
      active: 'book:assembled',
      csrfToken: csrf,
      botSwitcher: { ...selection, returnTo: '/book/assembled' },
      body: html`
        ${pageHeader('The Assembled Word', 'What each kind of reply is told, in the order it is told.')}
        <div class="mb-4 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm">
          <p>
            Previewing
            <strong>${selected?.displayName ?? 'no bot'}</strong>.
            ${deviations > 0
              ? html`It has <strong>${String(deviations)}</strong> law(s) of its own; the rest
                  it shares with every other bot.`
              : html`It reads the shared laws exactly, with none of its own.`}
          </p>
          ${profiles.length > 1
            ? html`<p class="mt-2 flex flex-wrap gap-2">
                ${profiles.map(
                  (p) =>
                    html`<a
                      class="rounded-lg px-2 py-1 text-xs ${p.id === selected?.id
                        ? 'bg-slate-900 font-medium text-white'
                        : 'border border-slate-300 text-slate-700'}"
                      href="/book/assembled?bot=${String(p.id)}"
                      >${p.displayName}</a
                    >`,
                )}
              </p>`
            : null}
        </div>
        <p class="mb-4 text-sm text-slate-600">
          The book lists rules; this lists <strong>prompts</strong>. A rule's lane and condition
          decide whether it appears at all, so the only way to see what a mode actually receives
          is to assemble it. Values she is given, her name, her origin, the clock and the dial
          block, are rendered into these sentences at reply time and appear here as their
          placeholders when no runtime is up.
        </p>
        ${BOOK_MODES.map((mode) =>
          html`<div class="mt-4">
            ${card(mode, html`<pre class="personality-prompt">${assembled(mode)}</pre>`)}
          </div>`,
        )}
      `,
    });
  });

  /** History: what changed, when, by whom, and the way back. */
  app.get<{ Querystring: { rule?: string; saved?: string; error?: string } }>(
    '/book/history',
    async (req, reply) => {
      const csrf = req.session?.csrfToken ?? '';
      const ruleId = req.query.rule ?? '';
      const changes = ruleId
        ? await listPromptRuleHistory(ctx.db, ruleId, 100)
        : await listRecentPromptRuleChanges(ctx.db, 100);
      reply.type('text/html');

      return page({
        title: 'History | The Book of Elii',
        active: 'book:history',
        csrfToken: csrf,
        body: html`
          ${pageHeader(
            ruleId ? `History of ${ruleId}` : 'History',
            'Every change to every rule, both sides of it, and who made it.',
          )}
          ${req.query.saved
            ? html`<div class="mb-4 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
                Rolled back, and recorded as a change in its own right.
              </div>`
            : null}
          ${req.query.error
            ? html`<div class="mb-4 rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-800">
                ${req.query.error}
              </div>`
            : null}
          <p class="mb-4 text-sm">
            <a class="underline" href="/book">Back to the book</a>
            ${ruleId ? html` · <a class="underline" href="/book/history">All changes</a>` : null}
          </p>
          <p class="mb-4 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700">
            A badly worded rule does not break anything. It degrades her quietly, and shows up
            weeks later as "she has been a bit off". This is how you find which edit did it.
            Rolling one back is itself recorded, so undoing something is as visible as doing it.
          </p>
          ${changeTable(changes, csrf, true)}
        `,
      });
    },
  );

  /** Roll one change back. */
  app.post<{ Body: Record<string, unknown> }>('/book/rollback', async (req, reply) => {
    const changeId = Number.parseInt(bodyString(req.body, 'change'), 10);
    if (!Number.isSafeInteger(changeId)) {
      return reply.redirect('/book/history?error=' + encodeURIComponent('Unknown change.'));
    }
    try {
      const done = await rollbackPromptRule(
        ctx.db,
        changeId,
        req.session?.username ?? 'unknown',
      );
      if (done) invalidatePromptRules();
      return reply.redirect(done ? '/book/history?saved=1' : '/book/history');
    } catch (error) {
      return reply.redirect('/book/history?error=' + encodeURIComponent(errorMessage(error)));
    }
  });
}

/* ── The change list ─────────────────────────────────────────────────────── */

function changeTable(
  changes: PromptRuleChange[],
  csrf: string,
  showRule: boolean,
): SafeHtml {
  if (changes.length === 0) {
    return card(
      'History',
      html`<p class="text-sm text-slate-600">
        Nothing has been changed. Every rule still says exactly what the migration seeded, which
        is what the repository's baseline pins.
      </p>`,
    );
  }

  return card(
    `${String(changes.length)} change${changes.length === 1 ? '' : 's'}`,
    html`<div class="flex flex-col gap-3">
      ${changes.map(
        (change) => html`<div class="rounded-lg border border-slate-200 p-3">
          <div class="flex flex-wrap items-center gap-2 text-sm">
            ${badge(change.action, change.action === 'rollback' ? 'amber' : 'slate')}
            ${showRule
              ? html`<a class="font-mono font-semibold underline" href="/book/rule/${change.ruleId}"
                  >${change.ruleId}</a
                >`
              : null}
            <span class="text-slate-500">${change.actor}</span>
            <span class="ml-auto text-xs text-slate-400">${fmtDate(change.changedAt)}</span>
          </div>
          ${change.oldText !== change.newText
            ? html`<div class="mt-2 grid gap-2 lg:grid-cols-2">
                <div>
                  <p class="text-xs font-semibold uppercase text-slate-400">Was</p>
                  <p class="whitespace-pre-wrap rounded bg-red-50 p-2 font-mono text-xs text-slate-700">
${change.oldText}</p>
                </div>
                <div>
                  <p class="text-xs font-semibold uppercase text-slate-400">Now</p>
                  <p class="whitespace-pre-wrap rounded bg-emerald-50 p-2 font-mono text-xs text-slate-700">
${change.newText}</p>
                </div>
              </div>`
            : null}
          ${change.oldEnabled !== change.newEnabled
            ? html`<p class="mt-2 text-sm text-slate-600">
                ${change.newEnabled ? 'Switched on.' : 'Switched off.'}
              </p>`
            : null}
          ${change.oldOrd !== change.newOrd
            ? html`<p class="mt-2 text-sm text-slate-600">
                Moved from ${String(change.oldOrd)} to ${String(change.newOrd)}.
              </p>`
            : null}
          <form method="post" action="/book/rollback" class="mt-2">
            <input type="hidden" name="_csrf" value="${csrf}" />
            <input type="hidden" name="change" value="${String(change.id)}" />
            <button
              type="submit"
              class="rounded-lg border border-slate-300 bg-white px-2 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50"
            >
              Put it back to "Was"
            </button>
          </form>
        </div>`,
      )}
    </div>`,
  );
}
