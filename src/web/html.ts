/**
 * Server-rendered HTML: a tagged-template helper with automatic escaping, plus
 * the responsive layout shell (Tailwind + htmx; no SPA pipeline).
 *
 * Escaping contract: `html` escapes every interpolated value except values that
 * are themselves the result of an `html` call or wrapped with `raw`. Never pass
 * user-controlled strings through `raw`.
 */

const ESCAPE_RE = /[&<>"']/g;
const ESCAPES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

export function escapeHtml(value: string): string {
  return value.replace(ESCAPE_RE, (character) => ESCAPES[character] ?? character);
}

/** A string that is already-safe HTML. Only `html` and `raw` produce it. */
export class SafeHtml {
  constructor(readonly value: string) {}

  toString(): string {
    return this.value;
  }
}

/** Marks a string as already-safe HTML. Do not use on user-controlled input. */
export function raw(value: string): SafeHtml {
  return new SafeHtml(value);
}

type Interpolatable = string | number | boolean | SafeHtml | null | undefined | Interpolatable[];

function render(value: Interpolatable): string {
  if (value === null || value === undefined || value === false) return '';
  if (value instanceof SafeHtml) return value.value;
  if (Array.isArray(value)) return value.map(render).join('');
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return escapeHtml(value);
}

/** Tagged template producing SafeHtml with all interpolations escaped. */
export function html(strings: TemplateStringsArray, ...values: Interpolatable[]): SafeHtml {
  let output = '';

  for (let index = 0; index < strings.length; index++) {
    output += strings[index];
    if (index < values.length) output += render(values[index]);
  }

  return new SafeHtml(output);
}

export interface PageOptions {
  title: string;
  /** Active navigation item key. */
  active?: string;
  /** Rendered inside main. */
  body: SafeHtml;
  /** Extra content for head. */
  head?: SafeHtml;
  /** When false, the administration chrome is omitted. */
  chrome?: boolean;
  /** CSRF token exposed to htmx requests. */
  csrfToken?: string;
  /** When true, sensitive form submits trigger a passkey step-up. */
  stepUpRequired?: boolean;
}

export interface NavItem {
  key: string;
  href: string;
  label: string;
  icon: SafeHtml;
  /**
   * Nested entries form the contextual sidebar. The structure is recursive so
   * larger sections can add another submenu level without redesigning the shell.
   */
  children?: NavItem[];
}

let navItems: NavItem[] = [];

/** Registered once at server construction. */
export function setNavItems(items: NavItem[]): void {
  navItems = items;
}

function containsActive(item: NavItem, active: string | undefined): boolean {
  if (!active) return false;
  if (item.key === active) return true;
  return item.children?.some((child) => containsActive(child, active)) ?? false;
}

function topNavigationLink(item: NavItem, active: string | undefined): SafeHtml {
  const branchActive = containsActive(item, active);

  return html`<a
    href="${item.href}"
    data-main-active="${branchActive ? 'true' : 'false'}"
    class="flex shrink-0 items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
      branchActive
        ? 'bg-slate-900 text-white'
        : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
    }"
    ${branchActive ? raw('aria-current="page"') : ''}
  >
    ${item.icon}<span>${item.label}</span>
  </a>`;
}

function sidebarNavigationItem(item: NavItem, active: string | undefined, depth: number): SafeHtml {
  const branchActive = containsActive(item, active);
  const padding = depth === 0 ? 'px-3' : depth === 1 ? 'pl-6 pr-3' : 'pl-9 pr-3';

  if (item.children && item.children.length > 0) {
    return html`<details
      name="cinderella-sidebar-depth-${depth}"
      class="group"
      ${branchActive ? raw('open') : ''}
    >
      <summary
        class="${padding} flex cursor-pointer list-none items-center justify-between rounded-lg py-2 text-sm font-medium transition-colors [&::-webkit-details-marker]:hidden ${
          branchActive
            ? 'bg-slate-100 text-slate-900'
            : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
        }"
      >
        <span class="flex items-center gap-2">${item.icon}<span>${item.label}</span></span>
        <span class="text-xs text-slate-400 transition-transform group-open:rotate-90">›</span>
      </summary>
      <div class="mt-1 flex flex-col gap-1">
        ${item.children.map((child) => sidebarNavigationItem(child, active, depth + 1))}
      </div>
    </details>`;
  }

  const isActive = item.key === active;

  return html`<a
    href="${item.href}"
    data-nav-depth="${depth}"
    class="${padding} flex items-center gap-2 rounded-lg py-2 text-sm transition-colors ${
      isActive
        ? 'bg-slate-900 font-medium text-white'
        : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
    }"
    ${isActive ? raw('aria-current="page"') : ''}
  >
    ${item.icon}<span>${item.label}</span>
  </a>`;
}

function mobileNavigation(
  activeRoot: NavItem | undefined,
  active: string | undefined,
  csrfToken: string,
): SafeHtml {
  return html`<details class="group md:hidden">
    <summary
      class="flex cursor-pointer list-none items-center gap-2 rounded-lg border border-slate-200 px-3 py-2 text-sm font-medium text-slate-700 [&::-webkit-details-marker]:hidden"
    >
      <span>Menu</span>
      <span class="text-slate-400 transition-transform group-open:rotate-90">›</span>
    </summary>
    <div class="absolute inset-x-0 top-full z-40 border-b border-slate-200 bg-white p-3 shadow-lg">
      <nav data-main-navigation-mobile class="grid gap-1">
        ${navItems.map((item) => topNavigationLink(item, active))}
      </nav>
      ${
        activeRoot?.children && activeRoot.children.length > 0
          ? html`<div class="mt-3 border-t border-slate-200 pt-3">
              <div class="mb-2 px-3 text-xs font-semibold uppercase tracking-wide text-slate-400">
                ${activeRoot.label}
              </div>
              <nav class="flex flex-col gap-1">
                ${activeRoot.children.map((item) => sidebarNavigationItem(item, active, 0))}
              </nav>
            </div>`
          : null
      }
      <form method="post" action="/logout" class="mt-3 border-t border-slate-200 pt-3">
        <input type="hidden" name="_csrf" value="${csrfToken}" />
        <button
          type="submit"
          class="w-full rounded-lg px-3 py-2 text-left text-sm font-medium text-slate-600 hover:bg-slate-100 hover:text-slate-900"
        >
          Sign out
        </button>
      </form>
    </div>
  </details>`;
}

/** Inline alert triangle glyph. */
const REPORT_FLAG_SVG = `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>`;

/** Stable placeholder for the open-report notification bar. */
export const REPORT_BAR_MARKER = '<!--cinderella-report-bar-->';

/** The report bar HTML for a given open-report count. */
export function reportBarHtml(count: number): string {
  if (count <= 0) return '';

  return html`<a
    href="/reports"
    class="mb-4 flex items-center gap-2 rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm font-medium text-amber-800 hover:bg-amber-100"
  >
    ${raw(REPORT_FLAG_SVG)}
    <span>${count} item${count === 1 ? '' : 's'} awaiting review, open the report queue</span>
  </a>`.value;
}

export function page(options: PageOptions): string {
  const chrome = options.chrome !== false;
  const activeRoot = navItems.find((item) => containsActive(item, options.active));
  const csrfToken = options.csrfToken ?? '';

  const topNavigation = html`${navItems.map((item) => topNavigationLink(item, options.active))}`;

  const header = chrome
    ? html`<header class="sticky top-0 z-30 border-b border-slate-200 bg-white/95 backdrop-blur">
        <div class="relative flex min-h-16 items-center gap-4 px-4 md:px-6">
          <a href="/dashboard" class="shrink-0 text-base font-semibold tracking-tight">
            🕯️ Cinderella Admin
          </a>

          <nav
            data-main-navigation
            class="hidden min-w-0 flex-1 items-center gap-1 overflow-x-auto md:flex"
          >
            ${topNavigation}
          </nav>

          <form method="post" action="/logout" class="ml-auto hidden shrink-0 md:block">
            <input type="hidden" name="_csrf" value="${csrfToken}" />
            <button
              type="submit"
              class="rounded-lg px-3 py-2 text-sm font-medium text-slate-500 hover:bg-slate-100 hover:text-slate-900"
            >
              Sign out
            </button>
          </form>

          <div class="ml-auto md:hidden">
            ${mobileNavigation(activeRoot, options.active, csrfToken)}
          </div>
        </div>
      </header>`
    : html``;

  const contextualSidebar =
    chrome && activeRoot?.children && activeRoot.children.length > 0
      ? html`<aside
          data-context-sidebar
          data-section="${activeRoot.key}"
          class="hidden w-64 shrink-0 flex-col border-r border-slate-200 bg-white p-4 md:flex"
        >
          <div class="mb-3 px-3">
            <div class="text-xs font-semibold uppercase tracking-wide text-slate-400">
              Current section
            </div>
            <div class="mt-1 text-sm font-semibold text-slate-900">${activeRoot.label}</div>
          </div>
          <nav class="flex flex-col gap-1">
            ${activeRoot.children.map((item) => sidebarNavigationItem(item, options.active, 0))}
          </nav>
        </aside>`
      : html``;

  const document = html`<!doctype html>
    <html lang="en" class="h-full">
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <meta name="robots" content="noindex, nofollow" />
        <title>${options.title} | Cinderella Admin</title>
        <link rel="stylesheet" href="/assets/app.css" />
        <script src="/assets/htmx.min.js" defer></script>
        ${
          chrome
            ? html`<script src="/assets/webauthn-browser.js" defer></script>
                <script src="/assets/auth.js" defer></script>`
            : html``
        }
        ${options.head ?? html``}
      </head>
      <body
        class="h-full bg-slate-100 text-slate-900 antialiased"
        data-csrf="${csrfToken}"
        ${options.stepUpRequired ? raw('data-stepup-required="1"') : ''}
        ${csrfToken ? raw(`hx-headers='{"x-csrf-token":"${escapeHtml(csrfToken)}"}'`) : ''}
      >
        <div class="flex min-h-full flex-col">
          ${header}
          <div class="flex min-h-0 flex-1">
            ${contextualSidebar}
            <main class="min-w-0 flex-1 p-4 md:p-8">
              ${chrome ? raw(REPORT_BAR_MARKER) : ''}${options.body}
            </main>
          </div>
        </div>
      </body>
    </html>`;

  return document.value;
}
