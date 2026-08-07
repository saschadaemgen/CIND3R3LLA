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
import { currentReplyModel } from '../../interaction/ai-runtime.js';
import { botIdentity } from '../../interaction/settings.js';
import { currentBotPersonality } from '../../profiles/bot-personality.js';
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

/** The tone, in one place, so it stays consistent and stays out of the rule text. */
const EPIGRAPH =
  'Eighty-two sentences decide what she will and will not do. They are written down, they ' +
  'are hers to be held to, and they are yours to revise. Read before you change one.';

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

function ruleCard(
  entry: { rule: PromptRule; position?: number; conditional: boolean; shippedText?: string },
  csrf: string,
  openId: string,
): SafeHtml {
  const rule = entry.rule;
  const open = openId === rule.id;
  const drifted = entry.shippedText !== undefined && entry.shippedText !== rule.text;

  return html`<article
    id="rule-${rule.id}"
    class="rounded-xl border ${rule.enabled
      ? 'border-slate-200'
      : 'border-amber-300 bg-amber-50/40'} bg-white p-4 shadow-sm"
  >
    <div class="flex flex-wrap items-center gap-2">
      ${entry.position ? html`<span class="text-xs font-mono text-slate-400">#${String(entry.position)}</span>` : null}
      <code class="text-sm font-semibold text-slate-900">${rule.id}</code>
      ${tierBadge(rule.tier)} ${rule.critical ? badge('critical', 'red') : null}
      ${rule.enabled ? null : badge('disabled', 'amber')}
      ${drifted ? badge('changed from shipped', 'amber') : null}
      ${rule.nameable ? badge('nameable', 'green') : badge('withheld', 'slate')}
      <span class="ml-auto text-xs text-slate-400">
        lane ${rule.lane} · ord ${String(rule.ord)} · ${rule.appliesWhen}
      </span>
    </div>

    <p class="mt-2 whitespace-pre-wrap text-sm text-slate-800">${rule.text}</p>

    <p class="mt-2 text-xs text-slate-400">
      from <code>${rule.source}</code>
    </p>

    <div class="mt-3 flex flex-wrap gap-3 text-sm">
      <a class="underline" href="/book/rule/${rule.id}">Edit${open ? ' (open below)' : ''}</a>
      <a class="underline" href="/book/history?rule=${rule.id}">History</a>
    </div>

    ${open ? editor(rule, csrf, entry.shippedText) : null}
  </article>`;
}

/**
 * The editor for one rule.
 *
 * A CONSTITUTIONAL rule needs its own id typed out. That is the same reasoning the arming
 * control uses: a checkbox is one you tick once and then forever, and the id is the one
 * string that cannot be typed by muscle memory because it is different for every rule.
 */
function editor(rule: PromptRule, csrf: string, shippedText?: string): SafeHtml {
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
 * The prompt as it WOULD be, beside what it is now.
 *
 * Rendered through `systemPrompt`, the reply path's own function, so this is not a second
 * assembly that happens to agree today. The personality and the identity are the live ones,
 * because the question here is what she would actually be told rather than what a
 * representative bot would be.
 */
function previewCard(
  current: PromptRuleSet,
  proposed: PromptRuleSet,
  rule: PromptRule,
  identity: BotIdentity,
): SafeHtml {
  const personality: BotPersonality | null = currentBotPersonality();
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

function sectionBlock(section: BookSection, csrf: string, openId: string): SafeHtml {
  return html`<section class="mt-6">
    <h2 class="text-sm font-bold uppercase tracking-wide text-slate-500">
      ${section.title}
      <span class="ml-2 font-normal normal-case text-slate-400">
        ${String(section.entries.length)} rule${section.entries.length === 1 ? '' : 's'}
      </span>
    </h2>
    <p class="mt-1 text-sm text-slate-500">${section.note}</p>
    <div class="mt-3 flex flex-col gap-3">
      ${section.entries.map((entry) => ruleCard(entry, csrf, openId))}
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
            <p class="mt-2">${EPIGRAPH}</p>
            <p class="mt-2 text-slate-400">
              ${String(rules.length)} rules ·
              ${String(rules.filter((r) => r.tier === 'constitutional').length)} constitutional ·
              ${String(rules.filter((r) => !r.enabled).length)} switched off ·
              ${String(drifted.length)} changed from what shipped ·
              ${String(rules.filter((r) => r.nameable).length)} she may name ·
              ${String(rules.filter((r) => !r.nameable).length)} withheld from members
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

          ${sections.map((section) => sectionBlock(section, csrf, ''))}
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
          ${previewCard(rules, [...rules, proposed], proposed, botIdentity(ctx.interaction.get()))}
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
          ${ruleCard(entry, csrf, rule.id)}
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
            ${previewCard(rules, proposed, rule, previewIdentity(ctx))}
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
  app.get('/book/assembled', async (req, reply) => {
    const csrf = req.session?.csrfToken ?? '';
    const rules = await listPromptRules(ctx.db);
    const personality = currentBotPersonality();
    const identity = previewIdentity(ctx);
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
      body: html`
        ${pageHeader('The Assembled Word', 'What each kind of reply is told, in the order it is told.')}
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
