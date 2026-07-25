/** Shared administration UI helpers. */

import { html, type SafeHtml } from '../html.js';

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
