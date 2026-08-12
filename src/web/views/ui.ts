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
