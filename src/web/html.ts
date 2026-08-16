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


/**
 * The brand lockup's letter spread (restored by the operator): every letter
 * its own span, the row justified, so "administration" underneath is exactly
 * as wide as the wordmark above it. The two 3s carry the site's magenta.
 */
function distributedWord(value: string, className: string): SafeHtml {
  return html`<span class="${className} admin-brand-wordmark" aria-hidden="true">
    ${Array.from(value).map((character) =>
      character === '3'
        ? html`<span class="admin-brand-three">${character}</span>`
        : html`<span>${character}</span>`,
    )}
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
  /**
   * The bot this page edits, when it edits one (CCB-S5-011).
   *
   * Omitted by pages that are deployment-wide. That omission is the point: a page with no
   * switcher above it is saying it does not belong to one bot, which is information an
   * operator needs as much as the switcher itself.
   */
  botSwitcher?: BotSwitcher;
  /**
   * Live counts beside sidebar links, keyed by nav key (D-225): the music
   * section shows how many tracks and playlists each sub-page holds. Static
   * nav, per-request numbers.
   */
  sidebarBadges?: Record<string, string>;
}

/** What the sidebar needs to render the bot switcher. */
export interface BotSwitcher {
  bots: { id: number; displayName: string }[];
  selectedId: number | null;
  selectedName: string | null;
  /** The URL named the bot, so this page is not showing the remembered selection. */
  fromUrl: boolean;
  /** Where to send the operator back to after switching. */
  returnTo: string;
  /**
   * WHAT THIS PAGE'S SETTINGS ARE SCOPED TO (CCB-S5-041, D-213).
   *
   * The switcher states the scope, so nobody reads a paragraph to learn what they are editing.
   * The operator set one bot's greeting believing it was shared, because the page named no bot
   * and the control said nothing either.
   *
   *   per-bot  the bots are selectable, as before
   *   shared   "All bots" is preselected and the bots are NOT selectable, because choosing one
   *            would promise something the page cannot do
   *   mixed    both offered; the page says which blocks belong to which, as `knowledge` does
   *
   * Absent means `per-bot`, which is what every existing caller is.
   */
  scope?: 'per-bot' | 'shared' | 'mixed';
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
  interaction: 'Control how CIND3R3LLA addresses people, responds, follows up, and archives.',
  moderation: 'Two escalation ladders, who is under a sanction, and the record of every step.',
  ai: 'Configure models, profiles, runtime policy, knowledge, safety, and operational testing.',
  plugins: 'Review installed extensions and open each plugin control surface.',
  system: 'Manage core settings, security, embeds, and website delivery.',
};

const MEGA_GROUPS_BY_SECTION: Record<string, Record<string, string>> = {
  content: {
    messages: 'Publishing',
    consent: 'Governance',
    reports: 'Review',
    holds: 'Review',
    screening: 'Review',
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
  moderation: {
    'moderation:rules': 'Policy',
    'moderation:active': 'Enforcement',
    'moderation:log': 'Enforcement',
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
  holds: 'Content held against destruction while a report is reviewed.',
  screening: 'Hash screening health and quarantined items, by reference only.',
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
  'moderation:rules': 'Verbal and enforcement ladders, windows, and exemptions.',
  'moderation:active': 'Members currently under a sanction.',
  'moderation:log': 'Every violation counted and every step decided.',
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

function sidebarNavigationItem(
  item: NavItem,
  active: string | undefined,
  depth: number,
  badges?: Record<string, string>,
): SafeHtml {
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
        ${item.children.map((child) => sidebarNavigationItem(child, active, depth + 1, badges))}
      </div>
    </details>`;
  }

  const isActive = item.key === active;
  const count = badges?.[item.key];

  return html`<a
    href="${item.href}"
    data-nav-depth="${depth}"
    class="admin-sidebar-link"
    ${isActive ? raw('aria-current="page"') : ''}
  >
    <span>${item.label}</span>
    ${count !== undefined ? html`<span class="admin-sidebar-count">${count}</span>` : ''}
  </a>`;
}

/**
 * The DEEPEST opened node that has children (D-225, the operator's sidebar
 * rule): the sidebar shows only the sub-pages of the thing you have opened.
 * Opening Music under Plugins gives the four music pages and nothing else;
 * the top-level menu keeps its own entries and the sidebar stops echoing
 * them. Recursion unwinds bottom-up, so the first assignment is the deepest.
 */
function deepestSectionFor(active: string | undefined): NavItem | undefined {
  if (active === undefined) return undefined;
  let best: NavItem | undefined;
  const walk = (item: NavItem): boolean => {
    const inChildren = (item.children ?? []).some((child) => walk(child));
    const here = item.key === active || inChildren;
    if (here && item.children !== undefined && item.children.length > 0 && best === undefined) {
      best = item;
    }
    return here;
  };
  for (const item of navItems) walk(item);
  return best;
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

/**
 * The bot switcher, in the sidebar, on every page that edits a bot (CCB-S5-011, D-169).
 *
 * ── ONE CONTROL, ONE PLACE ───────────────────────────────────────────────────
 *
 * It renders here and nowhere else, which is the whole change: an operator should never have
 * to ask which bot a form belongs to, and four page-level pickers meant he asked on every
 * page. Above the section navigation rather than below it, because it governs everything
 * below it and reading order should say so.
 *
 * ── ONE BUTTON PER BOT, WHICH DISSOLVES THE TENSION (CCB-S5-036, D-194) ──────
 *
 * It was a native `<select>` plus a `Switch` button, and the doc here defended the button on
 * D-162 grounds: an auto-submitting select makes a control depend on JavaScript for its only
 * function, and this console has already shipped one control that looked live and was inert.
 * That reasoning was sound and the conclusion was avoidable.
 *
 * The list is now `<details>` holding a form with ONE SUBMIT BUTTON PER BOT. Every property
 * wanted falls out of that with no script at all:
 *
 *   - ONE ACTION. Pressing a bot's name IS the submit. There is no select-then-confirm,
 *     because there is nothing to confirm.
 *   - IT LOOKS LIKE THE CONSOLE. A native select's popup is drawn by the browser and no
 *     stylesheet can reach it; buttons are ours, and so is the disclosure arrow, which is why
 *     the old one sat flush against the right edge.
 *   - NO JAVASCRIPT ANYWHERE. `<details>` and form submission are native, so there is no
 *     no-script path to describe separately: this IS the no-script path, and it is also the
 *     scripted one. Nothing here can be inert, which is a stronger answer to D-162 than the
 *     button was.
 *
 * `<details>` is already the console's disclosure primitive (the sidebar groups and the mobile
 * menu are both built on it), so this introduces no new mechanism.
 *
 * ── AND ADDING A BOT IS A LINK, NOT A FOURTH NAME ────────────────────────────
 *
 * The picker is where an operator is already thinking about which bots exist, so it is where
 * "make another one" belongs. The hazard is that the list now acts on a single press: an
 * entry that is not a bot must not be reachable by the gesture that chooses one.
 *
 * So it is an `<a>`, not a `<button>`. Different element, different affordance, its own row
 * below a rule, and it navigates rather than submitting. Choosing it cannot be a mis-press of
 * choosing a bot, because it is not the same kind of thing being pressed.
 *
 * It carries `returnTo`, so creating a bot lands back on the page the operator started from
 * with the new bot already selected - otherwise he creates one and then has to hunt for it to
 * configure it.
 *
 * With one bot it renders as a plain statement plus that link. Offering a choice between one
 * option is noise; saying whose settings these are never is.
 */
function renderBotSwitcher(sw: PageOptions['botSwitcher'], csrfToken: string): SafeHtml {
  // ── OMISSION USED TO BE THE MESSAGE; NOW THE MESSAGE IS THE MESSAGE ────────
  //
  // A page that edits no single bot passes no switcher, and CCB-S5-011 relied on the
  // resulting ABSENCE to say "this page is deployment-wide". That worked while the control
  // sat mid-sidebar. In the header slot the same absence is just a hole in the layout, and an
  // operator reads a hole as something failing to load rather than as a statement.
  //
  // So the scope is stated instead of implied, which is strictly more information than the
  // blank carried and keeps D-155's scope visibility intact.
  if (!sw) {
    return html`<div class="admin-botpicker admin-botpicker-single" data-bot-switcher="none">
      <span class="admin-sidebar-kicker">Scope</span>
      <strong class="admin-botpicker-current">Deployment-wide</strong>
    </div>`;
  }

  const newBotHref = `/ai/onboarding?new=1&returnTo=${encodeURIComponent(sw.returnTo)}`;
  const addLink = html`<a class="admin-botpicker-add" href="${newBotHref}">
    <span class="admin-botpicker-add-glyph" aria-hidden="true">+</span>
    <span>New bot...</span>
  </a>`;

  if (sw.bots.length <= 1) {
    return html`<div class="admin-botpicker admin-botpicker-single" data-bot-switcher>
      <span class="admin-sidebar-kicker">Editing bot</span>
      <strong class="admin-botpicker-current">${sw.selectedName ?? 'none yet'}</strong>
      ${addLink}
    </div>`;
  }

  const sharedCurrent = sw.scope === 'shared' || (sw.scope === 'mixed' && sw.selectedId === null);
  const sharedHref = `${sw.returnTo}${sw.returnTo.includes('?') ? '&' : '?'}bot=shared`;
  return html`<details class="admin-botpicker" data-bot-switcher>
    <summary class="admin-botpicker-summary">
      <span class="admin-botpicker-label">
        <span class="admin-sidebar-kicker">${sharedCurrent ? 'Editing' : 'Editing bot'}</span>
        <strong class="admin-botpicker-current">${sharedCurrent ? 'All bots' : (sw.selectedName ?? 'none')}</strong>
      </span>
      <span class="admin-botpicker-chevron" aria-hidden="true"></span>
    </summary>
    <div class="admin-botpicker-panel">
      <form method="post" action="/console/select-bot" class="admin-botpicker-list">
        <input type="hidden" name="_csrf" value="${csrfToken}" />
        <input type="hidden" name="returnTo" value="${sw.returnTo}" />
        ${/*
          THE SHARED ENTRY, ABOVE THE BOTS (D-213). A bot's name selected means you are editing
          that bot; this means you are editing everything. On a shared page it is preselected
          and the bots below are disabled - NOT hidden, and the dropdown is NOT blocked from
          opening, because a control that will not open does not say why, which is the silent
          control this whole thread is about.
        */ ''}
        ${sw.scope === 'shared'
          ? html`<div class="admin-botpicker-option admin-botpicker-shared" aria-current="true">
              <span>All bots</span>
              <span class="admin-botpicker-hint">shared settings</span>
            </div>`
          : sw.scope === 'mixed'
            ? html`<a
                class="admin-botpicker-option admin-botpicker-shared"
                href="${sharedHref}"
                ${sharedCurrent ? raw('aria-current="true"') : ''}
              >
                <span>All bots</span>
                <span class="admin-botpicker-hint">shared settings</span>
              </a>`
            : ''}
        ${sw.bots.map(
          (b) => html`<button
            type="submit"
            name="botProfileId"
            value="${String(b.id)}"
            class="admin-botpicker-option"
            ${sw.scope === 'shared' ? raw('disabled aria-disabled="true"') : ''}
            ${b.id === sw.selectedId && !sharedCurrent ? raw('aria-current="true"') : ''}
          >
            ${b.displayName}
          </button>`,
        )}
      </form>
      ${addLink}
    </div>
  </details>
  ${sw.fromUrl
    ? html`<span class="admin-botpicker-note">From this link, not your usual selection.</span>`
    : null}`;
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
  const switcher = renderBotSwitcher(options.botSwitcher, csrfToken);

  const header = chrome
    ? html`<header class="admin-header" data-admin-header>
        <div class="admin-header-glow" aria-hidden="true"></div>
        <div class="admin-header-inner">
          <!--
            THE MOST-USED CONTROL, IN THE MOST VALUABLE SPACE (CCB-S5-036, D-194).

            This was the "CIND3R3LLA administration" wordmark. A wordmark tells an operator
            what he already knows on a private console he signed in to, while the bot picker -
            the control he reaches for most - sat below the fold of the sidebar. The product
            name is still in the footer and in every page title.

            It occupies the sidebar's column width, so the picker and the sidebar under it
            read as one column rather than two unrelated things.
          -->
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


  // ── THE SIDEBAR IS THE CONSOLE'S SPINE, INCLUDING ON THE FIRST PAGE ────────
  //
  // It used to require `activeRoot.children.length > 0`, and the Dashboard nav item has no
  // children - so the console lost its spine on the first page anyone sees. It renders
  // whenever there is chrome now; a section with no children simply contributes no links,
  // which is a thinner sidebar rather than no sidebar.
  const sectionNode = deepestSectionFor(options.active) ?? activeRoot;
  const contextualSidebar = chrome
    ? html`<aside
        data-context-sidebar
        data-section="${sectionNode?.key ?? 'dashboard'}"
        class="admin-sidebar"
      >
        ${switcher}
        ${sectionNode
          ? html`<div class="admin-sidebar-brandline">
              <span class="admin-sidebar-brand-icon">${sectionNode.icon}</span>
              <div>
                <span class="admin-sidebar-kicker">Current section</span>
                <strong>${sectionNode.label}</strong>
              </div>
            </div>`
          : null}
        <div data-player-mount></div>
        ${sectionNode?.children && sectionNode.children.length > 0
          ? html`<nav class="admin-sidebar-nav">
              ${sectionNode.children.map((item) => sidebarNavigationItem(item, options.active, 0, options.sidebarBadges))}
            </nav>`
          : null}
        <div class="admin-sidebar-foot">
          <form method="post" action="/logout" class="admin-sidebar-signout">
            <input type="hidden" name="_csrf" value="${csrfToken}" />
            <button type="submit" class="admin-sidebar-logout">
              <span class="admin-resource-icon">${LOGOUT_ICON}</span>
              <span>Sign out</span>
            </button>
          </form>
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
                <script src="/assets/admin-navigation.js" defer></script>
                <script src="/assets/admin-player.js" defer></script>`
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
