/** Shared administration UI helpers. */

import { escapeHtml, html, raw, type SafeHtml } from '../html.js';

export function fmtDate(iso: string | null): string {
  if (!iso) return 'Not available';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toISOString().replace('T', ' ').slice(0, 16) + ' UTC';
}

export type Tone = 'green' | 'red' | 'amber' | 'slate' | 'blue';

const TONES: Record<Tone, string> = {
  green: 'bg-emerald-100 text-emerald-800',
  red: 'bg-red-100 text-red-800',
  amber: 'bg-amber-100 text-amber-800',
  slate: 'bg-slate-200 text-slate-700',
  blue: 'bg-sky-100 text-sky-800',
};

export function badge(text: string, tone: Tone = 'slate'): SafeHtml {
  return html`<span
    class="inline-flex items-center rounded-full px-2.5 py-1 text-xs font-medium ${TONES[tone]}"
  >
    ${text}
  </span>`;
}

export function card(title: string, content: SafeHtml, extraCls = ''): SafeHtml {
  return html`<section class="admin-card ${extraCls}">
    <h2 class="admin-card-title">${title}</h2>
    ${content}
  </section>`;
}

export function pageHeader(title: string, subtitle?: string): SafeHtml {
  return html`<div class="admin-page-header">
    <h1 class="admin-page-title">${title}</h1>
    ${subtitle ? html`<p class="admin-page-subtitle">${subtitle}</p>` : null}
  </div>`;
}

export function stat(label: string, value: string | number, tone: Tone = 'slate'): SafeHtml {
  const toneClass: Record<Tone, string> = {
    green: 'text-emerald-700',
    red: 'text-red-700',
    amber: 'text-amber-700',
    slate: 'text-slate-900',
    blue: 'text-sky-700',
  };

  return html`<div class="admin-stat">
    <div class="admin-stat-label">${label}</div>
    <div class="admin-stat-value ${toneClass[tone]}">${value}</div>
  </div>`;
}

/**
 * One row of a scope panel: a control, where it lives, and who deviates.
 *
 * Deliberately structural rather than tied to either inventory. `SETTING_SCOPES` (interaction
 * settings) and `PLUGIN_SETTING_SCOPES` (capabilities and their bounds) are two tables with
 * two owners, and a third kind will arrive; what an operator needs to read off a page is the
 * same three facts every time, so the RENDERER is shared and the inventories stay separate.
 */
export interface ScopeLine {
  /** What the control is called. A dotted setting path, or a name an operator would use. */
  key: string;
  /**
   * Where the control lives.
   *
   * `other` exists because two of them are NEITHER (CCB-S5-043): a channel's publication
   * switch is per CHANNEL, and the first version of this panel badged it `shared: 2 bot(s)`
   * under the heading "Shared across every bot", above a footer promising that editing it
   * changes two bots. Every word of that was false, the control worked perfectly, and the
   * reason line right beside it said "per CHANNEL, not per bot". That is the D-212 failure
   * exactly, so the panel gained a third answer rather than the wrong one being tolerated.
   */
  scope: 'per-bot' | 'shared' | 'other';
  /** Bots that have been given their own value. Empty for a deployment-wide control. */
  deviatingBotIds: number[];
  /** How many bots read the shared value. Excludes the deviating ones. */
  sharedBotCount: number;
  /** One line: why it lives where it lives. */
  reason: string;
  /**
   * Replaces the derived badge.
   *
   * Required for `other`, which has nothing to derive from, and useful for a per-bot control
   * that is not a setting: "per bot: none set" is the right sentence about an unset override
   * and the wrong one about mappings, where none set means none exist.
   */
  badge?: string;
}

/**
 * WHAT THIS PAGE CHANGES (CCB-S5-041/043, D-213).
 *
 * Lifted out of the Interaction page under CCB-S5-043 so the Bridge page renders the SAME
 * surface rather than a second one beside it. The operator's standing requirement is that it
 * must always be visible which settings are one bot's and which are the deployment's, and he
 * has learned to read this shape: a badge per control, the deviating bots named, and a count
 * on the warning. A page that invented its own version would make him learn it twice, and
 * the two would drift.
 *
 * `switcherHref` builds the per-bot links. Null suppresses them, which is what a page whose
 * bot is chosen by the sidebar switcher wants: two switchers for one choice is the "which of
 * these am I editing" question the panel exists to answer.
 */
export function scopePanel(opts: {
  lines: readonly ScopeLine[];
  bots: readonly { id: number; displayName: string }[];
  selectedBotId: number | null;
  /** Builds the href for a bot's own view, or for the shared view when given null. */
  switcherHref: ((botId: number | null) => string) | null;
  /** Overrides the card title, for a page where "this page" is too broad. */
  title?: string;
}): SafeHtml | null {
  const { lines, bots, selectedBotId, switcherHref } = opts;
  if (lines.length === 0) return null;

  const names = new Map(bots.map((b) => [b.id, b.displayName]));
  const selected = selectedBotId === null ? null : (names.get(selectedBotId) ?? null);
  const perBot = lines.filter((p) => p.scope === 'per-bot');
  const shared = lines.filter((p) => p.scope === 'shared');
  const other = lines.filter((p) => p.scope === 'other');

  const line = (v: ScopeLine): SafeHtml => {
    const deviating = v.deviatingBotIds.map((id) => names.get(id) ?? `bot ${String(id)}`).join(', ');
    const derived =
      v.scope === 'per-bot'
        ? v.deviatingBotIds.length > 0
          ? badge(`per bot: ${String(v.deviatingBotIds.length)} differ`, 'amber')
          : badge('per bot: none set', 'slate')
        : badge(`shared: ${String(v.sharedBotCount)} bot(s)`, 'slate');
    return html`<li class="flex flex-wrap items-baseline gap-2 py-0.5">
      <code class="text-xs text-slate-800">${v.key}</code>
      ${v.badge === undefined ? derived : badge(v.badge, 'blue')}
      <span class="text-xs text-slate-500">${v.reason}</span>
      ${v.deviatingBotIds.length > 0
        ? html`<span class="text-xs text-amber-800">Set for ${deviating}.</span>`
        : null}
    </li>`;
  };

  return card(
    opts.title ?? 'What this page changes',
    html`
      ${bots.length > 1
        ? html`<div class="mb-3 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm">
            <p>
              Editing <strong>${selected ?? 'the shared settings'}</strong>.
              ${selected === null
                ? html`Saving here changes the shared value, which reaches every bot that has
                    not been given its own.`
                : html`Saving a per-bot setting here changes <strong>${selected}</strong> only;
                    the others keep what they have.`}
            </p>
            ${switcherHref === null
              ? null
              : html`<p class="mt-2 flex flex-wrap gap-2">
                  <a
                    class="rounded-lg px-2 py-1 text-xs ${selectedBotId === null
                      ? 'bg-slate-900 font-medium text-white'
                      : 'border border-slate-300 text-slate-700'}"
                    href="${switcherHref(null)}"
                    >Shared</a
                  >
                  ${bots.map(
                    (b) =>
                      html`<a
                        class="rounded-lg px-2 py-1 text-xs ${b.id === selectedBotId
                          ? 'bg-slate-900 font-medium text-white'
                          : 'border border-slate-300 text-slate-700'}"
                        href="${switcherHref(b.id)}"
                        >${b.displayName}</a
                      >`,
                  )}
                </p>`}
          </div>`
        : null}

      ${perBot.length > 0
        ? html`<div>
            <h4 class="text-xs font-bold uppercase tracking-wide text-slate-500">Set per bot</h4>
            <ul class="mt-1">${perBot.map((p) => line(p))}</ul>
          </div>`
        : null}

      ${shared.length > 0
        ? html`<div class="${perBot.length > 0 ? 'mt-3' : ''}">
            <h4 class="text-xs font-bold uppercase tracking-wide text-slate-500">
              Shared across every bot
            </h4>
            <ul class="mt-1">${shared.map((p) => line(p))}</ul>
            <p class="mt-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600">
              These cannot be set for one bot, and the reason is beside each one. Editing any of
              them changes <strong>${String(bots.length)}</strong> bot(s).
            </p>
          </div>`
        : null}

      ${other.length > 0
        ? html`<div class="${perBot.length > 0 || shared.length > 0 ? 'mt-3' : ''}">
            <h4 class="text-xs font-bold uppercase tracking-wide text-slate-500">
              Neither: not a per-bot setting and not a deployment one
            </h4>
            <ul class="mt-1">${other.map((p) => line(p))}</ul>
            <p class="mt-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600">
              Switching the bot above changes nothing about these. What each one acts on is
              beside it.
            </p>
          </div>`
        : null}
    `,
  );
}

export function truncate(value: string, length: number): string {
  return value.length > length ? `${value.slice(0, length)}...` : value;
}

/* ── THE LAYOUT VOCABULARY (CCB-S5-036, D-194) ───────────────────────────────
 *
 * DERIVED FROM THE PAGES, NOT INVENTED FOR THEM. All 26 views were read and counted; each
 * of these earns its place by replacing hand-rolled uses that already exist, and the counts
 * are stated so a later reader can check the claim rather than trust it:
 *
 *   factList        25 uses across 11 different class strings
 *   statusTiles     16 uses across 4 BYTE-IDENTICAL CSS grid rules
 *   sectionHeader   14 uses across 7 class names, three of which already lie about
 *                   where they are used (`runtime-control-*` on the routing page)
 *   actionForm      18 uses across 4 tones
 *
 * WHAT IS DELIBERATELY NOT HERE. Numbered process steps (3 uses, all different shapes),
 * the technical-details disclosure (4 uses, identical, but each cancels a different
 * margin), and the wizard's journey stepper (1). A vocabulary that reaches for one-offs is
 * how these rot; three uses is a pattern only if the fourth is coming.
 *
 * SPACING IS NOT HERE EITHER, ON PURPOSE. `.admin-content > * + *` and `.admin-stack > * + *`
 * own vertical rhythm in CSS, so the CONTAINER spaces its children and a page author cannot
 * produce flush sections by omission. That direction is the whole fix: `.admin-card` has
 * padding and no margin, so before this the Channel Bridge's six cards sat at 0px apart.
 * Measured after: 22px, every gap.
 */

/** One label/value row set. Replaces 25 hand-rolled `<dl>` grids. */
export function factList(
  rows: readonly (readonly [string, string | SafeHtml])[],
  columns: 1 | 2 = 2,
): SafeHtml {
  return html`<dl class="admin-facts" data-columns="${String(columns)}">
    ${rows.map(
      ([label, value]) => html`<div class="admin-fact">
        <dt class="admin-fact-label">${label}</dt>
        <dd class="admin-fact-value">${value}</dd>
      </div>`,
    )}
  </dl>`;
}

/** A status tile: label, value, and the one line that says what it means. */
export function statusTile(label: string, value: string, note?: string): SafeHtml {
  return html`<article class="admin-tile">
    <span class="admin-tile-label">${label}</span>
    <strong class="admin-tile-value">${value}</strong>
    ${note ? html`<small class="admin-tile-note">${note}</small>` : null}
  </article>`;
}

/** The grid the tiles sit in. Four across, as all four hand-rolled versions were. */
export function statusTiles(tiles: readonly SafeHtml[]): SafeHtml {
  return html`<div class="admin-tiles">${[...tiles]}</div>`;
}

/**
 * A heading inside a card or a page, with an optional control on the right.
 *
 * The eyebrow is optional because half the existing uses have none, and the trailing
 * control is `SafeHtml` rather than a button spec because the seven existing versions put
 * a link, a form and a plain button there and none of them is wrong.
 */
export function sectionHeader(opts: {
  title: string;
  eyebrow?: string;
  blurb?: string;
  action?: SafeHtml;
}): SafeHtml {
  return html`<header class="admin-section-header">
    <div>
      ${opts.eyebrow ? html`<span class="admin-section-eyebrow">${opts.eyebrow}</span>` : null}
      <h2 class="admin-section-title">${opts.title}</h2>
      ${opts.blurb ? html`<p class="admin-section-blurb">${opts.blurb}</p>` : null}
    </div>
    ${opts.action ?? null}
  </header>`;
}

/**
 * A POST that does one thing.
 *
 * The CSRF field is not optional and not the caller's to forget: 18 hand-rolled versions
 * each wrote it out, and the one that does not is a route that refuses with no explanation.
 */
export function actionForm(opts: {
  action: string;
  csrf: string;
  label: string;
  fields?: Record<string, string | number>;
  tone?: 'primary' | 'quiet' | 'danger';
  confirm?: string;
}): SafeHtml {
  const tone = opts.tone ?? 'quiet';
  return html`<form method="post" action="${opts.action}" class="admin-action-form">
    <input type="hidden" name="_csrf" value="${opts.csrf}" />
    ${Object.entries(opts.fields ?? {}).map(
      ([name, value]) => html`<input type="hidden" name="${name}" value="${String(value)}" />`,
    )}
    <button
      type="submit"
      class="admin-action-button admin-action-${tone}"
      ${opts.confirm ? raw(`data-confirm="${escapeHtml(opts.confirm)}"`) : ''}
    >
      ${opts.label}
    </button>
  </form>`;
}
