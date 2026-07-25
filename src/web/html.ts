/**
 * Server-rendered administration shell with automatic HTML escaping.
 *
 * The shell uses a restrained top navigation, a contextual sidebar, and a
 * centered content canvas. Nested sidebar levels remain available for sections
 * that genuinely need them.
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

export class SafeHtml {
  constructor(readonly value: string) {}

  toString(): string {
    return this.value;
  }
}

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
  active?: string;
  body: SafeHtml;
  head?: SafeHtml;
  chrome?: boolean;
  csrfToken?: string;
  stepUpRequired?: boolean;
}

export interface NavItem {
  key: string;
  href: string;
  label: string;
  icon: SafeHtml;
  children?: NavItem[];
}

let navItems: NavItem[] = [];

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
    class="admin-main-nav-link"
    ${branchActive ? raw('aria-current="page"') : ''}
  >
    ${item.label}
  </a>`;
}

function sidebarNavigationItem(item: NavItem, active: string | undefined, depth: number): SafeHtml {
  const branchActive = containsActive(item, active);

  if (item.children && item.children.length > 0) {
    return html`<details
      name="cinderella-sidebar-depth-${depth}"
      class="admin-sidebar-group"
      ${branchActive ? raw('open') : ''}
    >
      <summary class="admin-sidebar-group-summary">
        <span>${item.label}</span>
        <span class="admin-sidebar-chevron" aria-hidden="true"></span>
      </summary>
      <div class="admin-sidebar-group-items">
        ${item.children.map((child) => sidebarNavigationItem(child, active, depth + 1))}
      </div>
    </details>`;
  }

  const isActive = item.key === active;

  return html`<a
    href="${item.href}"
    data-nav-depth="${depth}"
    class="admin-sidebar-link"
    ${isActive ? raw('aria-current="page"') : ''}
  >
    <span>${item.label}</span>
  </a>`;
}

function mobileNavigation(
  activeRoot: NavItem | undefined,
  active: string | undefined,
  csrfToken: string,
): SafeHtml {
  return html`<details class="admin-mobile-menu">
    <summary class="admin-mobile-menu-trigger">
      <span>Menu</span>
      <span class="admin-mobile-menu-icon" aria-hidden="true"></span>
    </summary>
    <div class="admin-mobile-menu-panel">
      <nav data-main-navigation-mobile class="admin-mobile-main-nav">
        ${navItems.map((item) => topNavigationLink(item, active))}
      </nav>

      ${
        activeRoot?.children && activeRoot.children.length > 0
          ? html`<div class="admin-mobile-context">
              <div class="admin-mobile-context-title">${activeRoot.label}</div>
              <nav class="admin-mobile-context-nav">
                ${activeRoot.children.map((item) => sidebarNavigationItem(item, active, 0))}
              </nav>
            </div>`
          : null
      }

      <form method="post" action="/logout" class="admin-mobile-signout">
        <input type="hidden" name="_csrf" value="${csrfToken}" />
        <button type="submit" class="admin-text-button">Sign out</button>
      </form>
    </div>
  </details>`;
}

const REPORT_FLAG_SVG = `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>`;

export const REPORT_BAR_MARKER = '<!--cinderella-report-bar-->';

export function reportBarHtml(count: number): string {
  if (count <= 0) return '';

  return html`<a href="/reports" class="admin-report-bar">
    ${raw(REPORT_FLAG_SVG)}
    <span>${count} item${count === 1 ? '' : 's'} awaiting review</span>
  </a>`.value;
}

export function page(options: PageOptions): string {
  const chrome = options.chrome !== false;
  const activeRoot = navItems.find((item) => containsActive(item, options.active));
  const csrfToken = options.csrfToken ?? '';

  const header = chrome
    ? html`<header class="admin-header" data-admin-header>
        <div class="admin-header-inner">
          <a href="/dashboard" class="admin-brand" data-admin-brand>
            <span class="admin-brand-mark" aria-hidden="true">C</span>
            <span class="admin-brand-copy">
              <span class="admin-brand-name">Cinderella</span>
              <span class="admin-brand-subtitle">Control Center</span>
            </span>
          </a>

          <div class="admin-header-right">
            <nav data-main-navigation class="admin-main-navigation">
              ${navItems.map((item) => topNavigationLink(item, options.active))}
            </nav>

            <form method="post" action="/logout" class="admin-signout-form">
              <input type="hidden" name="_csrf" value="${csrfToken}" />
              <button type="submit" class="admin-text-button">Sign out</button>
            </form>

            <div class="admin-mobile-menu-wrap">
              ${mobileNavigation(activeRoot, options.active, csrfToken)}
            </div>
          </div>
        </div>
      </header>`
    : html``;

  const contextualSidebar =
    chrome && activeRoot?.children && activeRoot.children.length > 0
      ? html`<aside data-context-sidebar data-section="${activeRoot.key}" class="admin-sidebar">
          <div class="admin-sidebar-heading">
            <span class="admin-sidebar-dot" aria-hidden="true"></span>
            <span>${activeRoot.label}</span>
          </div>
          <nav class="admin-sidebar-nav">
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
        <title>${options.title} | Cinderella</title>
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
        class="h-full"
        data-csrf="${csrfToken}"
        ${options.stepUpRequired ? raw('data-stepup-required="1"') : ''}
        ${csrfToken ? raw(`hx-headers='{"x-csrf-token":"${escapeHtml(csrfToken)}"}'`) : ''}
      >
        <div class="admin-shell" data-admin-shell>
          ${header}
          <div class="admin-workspace">
            ${contextualSidebar}
            <main class="admin-main">
              <div class="admin-content">
                ${chrome ? raw(REPORT_BAR_MARKER) : ''}${options.body}
              </div>
            </main>
          </div>
        </div>
      </body>
    </html>`;

  return document.value;
}
