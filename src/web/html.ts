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

function distributedWord(value: string, className: string): SafeHtml {
  return html`<span class="${className} admin-brand-wordmark" aria-hidden="true">
    ${Array.from(value).map((character) => html`<span>${character}</span>`)}
  </span>`;
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
  description?: string;
  megaGroup?: string;
  children?: NavItem[];
}

let navItems: NavItem[] = [];
const GLOBE_ICON = raw(
  '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c3 3.2 3 14.8 0 18M12 3c-3 3.2-3 14.8 0 18"/></svg>',
);
const BOOK_ICON = raw(
  '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H11v16H6.5A2.5 2.5 0 0 0 4 21.5z"/><path d="M20 5.5A2.5 2.5 0 0 0 17.5 3H13v16h4.5a2.5 2.5 0 0 1 2.5 2.5z"/></svg>',
);
const GITHUB_ICON = raw(
  '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2.8a9.2 9.2 0 0 0-2.9 17.9c.5.1.7-.2.7-.5v-1.8c-2.8.6-3.4-1.2-3.4-1.2-.5-1.2-1.1-1.5-1.1-1.5-.9-.6.1-.6.1-.6 1 .1 1.6 1.1 1.6 1.1.9 1.6 2.4 1.1 2.9.8.1-.7.4-1.1.6-1.4-2.2-.3-4.6-1.1-4.6-4.9 0-1.1.4-2 1.1-2.7-.1-.3-.5-1.3.1-2.7 0 0 .9-.3 2.8 1.1A9.7 9.7 0 0 1 12 6.1a9.7 9.7 0 0 1 2.1.3c1.9-1.4 2.8-1.1 2.8-1.1.6 1.4.2 2.4.1 2.7.7.7 1.1 1.6 1.1 2.7 0 3.8-2.3 4.6-4.6 4.9.4.3.7 1 .7 1.9v2.7c0 .3.2.6.7.5A9.2 9.2 0 0 0 12 2.8z"/></svg>',
);
const LOGOUT_ICON = raw(
  '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M10 4H5a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h5"/><path d="m16 8 4 4-4 4M20 12H9"/></svg>',
);

interface ResourceLink {
  href: string;
  label: string;
  icon: SafeHtml;
  external?: boolean;
}

const RESOURCE_LINKS: ResourceLink[] = [
  { href: '/en', label: 'Website', icon: GLOBE_ICON },
  { href: '/en/docs', label: 'Docs', icon: BOOK_ICON },
  {
    href: 'https://github.com/saschadaemgen/cinderella',
    label: 'CIND3R3LLA Git',
    icon: GITHUB_ICON,
    external: true,
  },
  {
    href: 'https://github.com/cannatoshi/SimpleGo',
    label: 'SimpleGo Git',
    icon: GITHUB_ICON,
    external: true,
  },
];

function resourceLink(link: ResourceLink, compact = false): SafeHtml {
  return html`<a
    href="${link.href}"
    class="${compact ? 'admin-mobile-resource-link' : 'admin-resource-link'}"
    aria-label="${link.label}"
    title="${link.label}"
    ${link.external ? raw('target="_blank" rel="noreferrer"') : ''}
  >
    <span class="admin-resource-icon">${link.icon}</span>
    <span class="admin-resource-label">${link.label}</span>
  </a>`;
}

export function setNavItems(items: NavItem[]): void {
  navItems = items;
}

function containsActive(item: NavItem, active: string | undefined): boolean {
  if (!active) return false;
  if (item.key === active) return true;
  return item.children?.some((child) => containsActive(child, active)) ?? false;
}

const MEGA_SECTION_DESCRIPTIONS: Record<string, string> = {
  content: 'Manage captured messages, publication consent, and review queues.',
  interaction: 'Control how Cinderella addresses people, responds, follows up, and archives.',
  ai: 'Configure models, profiles, runtime policy, knowledge, safety, and operational testing.',
  plugins: 'Review installed extensions and open each plugin control surface.',
  system: 'Manage core settings, security, embeds, and website delivery.',
};

const MEGA_GROUPS_BY_SECTION: Record<string, Record<string, string>> = {
  content: {
    messages: 'Publishing',
    consent: 'Governance',
    reports: 'Review',
  },
  interaction: {
    'interaction:addressing': 'Conversation',
    'interaction:language': 'Conversation',
    'interaction:replies': 'Conversation',
    'interaction:nicknames': 'Conversation',
    'interaction:voice': 'Conversation',
    'interaction:guards': 'Behavior & Safety',
    'interaction:followup': 'Behavior & Safety',
    'interaction:consent': 'Behavior & Safety',
    'interaction:archiving': 'Operations',
    'interaction:diagnostics': 'Operations',
  },
  ai: {
    'ai:overview': 'Foundation',
    'ai:onboarding': 'Foundation',
    'ai:profiles': 'Foundation',
    'ai:runtime': 'Foundation',
    'ai:models': 'Intelligence',
    'ai:routing': 'Intelligence',
    'ai:personality': 'Intelligence',
    'ai:knowledge': 'Intelligence',
    'ai:hardware': 'Operations',
    'ai:telemetry': 'Operations',
    'ai:testing': 'Operations',
    'ai:audit': 'Operations',
    'ai:privacy': 'Safety & Connectivity',
    'ai:providers': 'Safety & Connectivity',
  },
  plugins: {
    plugins: 'Management',
  },
  system: {
    settings: 'Core',
    security: 'Core',
    embeds: 'Delivery',
    site: 'Delivery',
  },
};

const MEGA_ITEM_DESCRIPTIONS: Record<string, string> = {
  messages: 'Captured items and publication state.',
  consent: 'Consent records and publication decisions.',
  reports: 'Items that require administrator review.',
  'interaction:addressing': 'Names, mentions, and direct addressing.',
  'interaction:guards': 'Safety gates and response boundaries.',
  'interaction:followup': 'Follow up behavior and timing.',
  'interaction:language': 'Language detection and selection.',
  'interaction:replies': 'Reply rules and response style.',
  'interaction:nicknames': 'Member naming and aliases.',
  'interaction:consent': 'Conversation consent behavior.',
  'interaction:voice': 'Voice and audio interaction settings.',
  'interaction:archiving': 'Archive behavior and publication flow.',
  'interaction:diagnostics': 'Interaction diagnostics and evidence.',
  'ai:overview': 'Current AI state and operational summary.',
  'ai:onboarding': 'Create and configure SimpleX AI bots with a guided assistant.',
  'ai:profiles': 'Groups, roles, and access policy for configured AI bots.',
  'ai:runtime': 'Runtime mode and local model controls.',
  'ai:models': 'Installed and available model catalog.',
  'ai:routing': 'Intent and reply model routing.',
  'ai:hardware': 'GPU, memory, and runtime capacity.',
  'ai:telemetry': 'Performance and request telemetry.',
  'ai:personality': 'Personality profiles and behavior.',
  'ai:privacy': 'Privacy gates and safety controls.',
  'ai:providers': 'Local and external provider policy.',
  'ai:knowledge': 'Private knowledge and retrieval controls.',
  'ai:testing': 'Model comparison and controlled tests.',
  'ai:audit': 'AI policy and administrator audit history.',
  plugins: 'Plugin catalog and extension status.',
  settings: 'General system configuration.',
  security: 'Authentication, sessions, and access controls.',
  embeds: 'Public embed configuration.',
  site: 'Website content and delivery controls.',
};

function megaGroup(root: NavItem, child: NavItem): string {
  return (
    child.megaGroup ??
    MEGA_GROUPS_BY_SECTION[root.key]?.[child.key] ??
    (root.key === 'plugins' ? 'Installed plugins' : 'Explore')
  );
}

function megaItemDescription(item: NavItem): string {
  return item.description ?? MEGA_ITEM_DESCRIPTIONS[item.key] ?? `Open ${item.label} controls.`;
}

function topNavigationLink(
  item: NavItem,
  active: string | undefined,
  megaEnabled = true,
): SafeHtml {
  const branchActive = containsActive(item, active);
  const hasMega = megaEnabled && Boolean(item.children?.length);

  return html`<a
    href="${item.href}"
    data-main-section="${item.key}"
    data-main-active="${branchActive ? 'true' : 'false'}"
    ${hasMega ? raw(`data-mega-trigger="${escapeHtml(item.key)}"`) : ''}
    class="admin-main-nav-link"
    ${hasMega ? raw(`aria-haspopup="true" aria-expanded="false" aria-controls="admin-mega-${escapeHtml(item.key)}"`) : ''}
    ${branchActive ? raw('aria-current="page"') : ''}
  >
    ${item.label}
  </a>`;
}

function megaNavigationPanel(item: NavItem, active: string | undefined): SafeHtml {
  const groups = new Map<string, NavItem[]>();

  for (const child of item.children ?? []) {
    const group = megaGroup(item, child);
    const current = groups.get(group) ?? [];
    current.push(child);
    groups.set(group, current);
  }

  return html`<section
    id="admin-mega-${item.key}"
    class="admin-mega-panel"
    data-mega-panel="${item.key}"
    aria-hidden="true"
    hidden
  >
    <div class="admin-mega-panel-inner">
      <div class="admin-mega-intro">
        <span class="admin-mega-kicker">Control section</span>
        <h2 class="admin-mega-title">${item.label}</h2>
        <p class="admin-mega-description">
          ${item.description ?? MEGA_SECTION_DESCRIPTIONS[item.key] ?? `Open ${item.label} administration.`}
        </p>
        <a href="${item.href}" class="admin-mega-overview-link">Open section overview</a>
      </div>

      <div class="admin-mega-groups">
        ${Array.from(groups.entries()).map(
          ([group, children]) =>
            html`<section class="admin-mega-group">
              <h3 class="admin-mega-group-title">${group}</h3>
              <div class="admin-mega-group-links">
                ${children.map(
                  (child) =>
                    html`<a
                      href="${child.href}"
                      class="admin-mega-link"
                      ${child.key === active ? raw('aria-current="page"') : ''}
                    >
                      <span class="admin-mega-link-icon">${child.icon}</span>
                      <span class="admin-mega-link-copy">
                        <span class="admin-mega-link-label">${child.label}</span>
                        <span class="admin-mega-link-description"
                          >${megaItemDescription(child)}</span
                        >
                      </span>
                    </a>`,
                )}
              </div>
            </section>`,
        )}
      </div>

      <button type="button" class="admin-mega-close" data-mega-close aria-label="Close menu">
        ×
      </button>
    </div>
  </section>`;
}

function megaNavigationPanels(active: string | undefined): SafeHtml {
  const roots = navItems.filter((item) => item.children && item.children.length > 0);

  return html`<div class="admin-mega-shell" data-mega-shell data-open="false">
    ${roots.map((item) => megaNavigationPanel(item, active))}
  </div>`;
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
        ${navItems.map((item) => topNavigationLink(item, active, false))}
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

      <div class="admin-mobile-resources">
        <div class="admin-mobile-context-title">Project links</div>
        ${RESOURCE_LINKS.map((link) => resourceLink(link, true))}
      </div>

      <form method="post" action="/logout" class="admin-mobile-signout">
        <input type="hidden" name="_csrf" value="${csrfToken}" />
        <button type="submit" class="admin-mobile-logout">
          <span class="admin-resource-icon">${LOGOUT_ICON}</span>
          <span>Sign out</span>
        </button>
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

function fixedFooter(): SafeHtml {
  return html`<footer class="admin-footer" data-admin-footer>
    <div class="admin-footer-version">
      <span class="admin-footer-product">CIND3R3LLA</span>
      <span aria-hidden="true"> · </span>
      <span>Version 0.0.1-alpha</span>
    </div>
    <a
      class="admin-footer-copyright"
      href="https://it-and-more.systems/"
      target="_blank"
      rel="noreferrer"
    >
      © 1995-2026 Sascha Dämgen IT & MORE Systems
    </a>
  </footer>`;
}
export function page(options: PageOptions): string {
  const chrome = options.chrome !== false;
  const activeRoot = navItems.find((item) => containsActive(item, options.active));
  const csrfToken = options.csrfToken ?? '';

  const header = chrome
    ? html`<header class="admin-header" data-admin-header>
        <div class="admin-header-glow" aria-hidden="true"></div>
        <div class="admin-header-inner">
          <a href="/dashboard" class="admin-brand" data-admin-brand>
            <span class="admin-brand-copy" aria-label="CIND3R3LLA administration">
              ${distributedWord('CIND3R3LLA', 'admin-brand-name')}
              ${distributedWord('administration', 'admin-brand-subtitle')}
            </span>
          </a>

          <nav data-main-navigation class="admin-main-navigation">
            ${navItems.map((item) => topNavigationLink(item, options.active))}
            <span
              class="admin-main-nav-indicator"
              data-main-nav-indicator
              aria-hidden="true"
            ></span>
          </nav>

          <div class="admin-header-right">
            <nav class="admin-resource-navigation" aria-label="Project resources">
              ${RESOURCE_LINKS.map((link) => resourceLink(link))}
            </nav>

            <form method="post" action="/logout" class="admin-signout-form">
              <input type="hidden" name="_csrf" value="${csrfToken}" />
              <button
                type="submit"
                class="admin-logout-button"
                aria-label="Sign out"
                title="Sign out"
              >
                <span class="admin-resource-icon">${LOGOUT_ICON}</span>
                <span class="admin-resource-label">Sign out</span>
              </button>
            </form>

            <div class="admin-mobile-menu-wrap">
              ${mobileNavigation(activeRoot, options.active, csrfToken)}
            </div>
          </div>
        </div>
        ${megaNavigationPanels(options.active)}
      </header>`
    : html``;

  const contextualSidebar =
    chrome && activeRoot?.children && activeRoot.children.length > 0
      ? html`<aside data-context-sidebar data-section="${activeRoot.key}" class="admin-sidebar">
          <div class="admin-sidebar-brandline">
            <span class="admin-sidebar-brand-icon">${activeRoot.icon}</span>
            <div>
              <span class="admin-sidebar-kicker">Current section</span>
              <strong>${activeRoot.label}</strong>
            </div>
          </div>
          <nav class="admin-sidebar-nav">
            ${activeRoot.children.map((item) => sidebarNavigationItem(item, options.active, 0))}
          </nav>
          <div class="admin-sidebar-meta">
            <span class="admin-sidebar-meta-dot" aria-hidden="true"></span>
            <span>Private control surface</span>
          </div>
        </aside>`
      : html``;

  const document = html`<!doctype html>
    <html lang="en" class="h-full">
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <meta name="robots" content="noindex, nofollow" />
        <meta name="theme-color" content="#050A12" />
        <title>${options.title} | CIND3R3LLA</title>
        <link rel="stylesheet" href="/assets/app.css" />
        <script src="/assets/htmx.min.js" defer></script>
        ${
          chrome
            ? html`<script src="/assets/webauthn-browser.js" defer></script>
                <script src="/assets/auth.js" defer></script>
                <script src="/assets/admin-effects.js" defer></script>
                <script src="/assets/admin-navigation.js" defer></script>`
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
          <canvas id="admin-starfield" class="admin-starfield" aria-hidden="true"></canvas>
          ${header}
          <div class="admin-workspace">
            ${contextualSidebar}
            <main class="admin-main">
              <div class="admin-content">
                ${chrome ? raw(REPORT_BAR_MARKER) : ''}${options.body}
              </div>
            </main>
          </div>
          ${chrome ? fixedFooter() : null}
        </div>
      </body>
    </html>`;

  return document.value;
}
