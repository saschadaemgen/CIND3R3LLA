/**
 * Public marketing site presentation (CCB-S2-012, redesigned CCB-S3-001).
 *
 * The operator's approved dark-neon template (tmp/Cinderella Website.html) ported
 * to self-contained SSR: every page server-rendered from the locale files (SEO
 * preserved), themed CSS + tiny vanilla scripts inlined under a per-response CSP
 * nonce, fonts/avatar served same-origin, lucide icons inlined — no CDN, no
 * framework. The building blocks stay OFF by default (D-025): the cookie banner +
 * first-party analytics load NOTHING until the visitor accepts; social share is
 * script-free links. The only essential storage is the language cookie (no
 * consent needed). Dark is the ONLY theme (operator decision); em dashes are
 * banned from visible copy (operator style rule, enforced by verify:site).
 *
 * NO STYLE ATTRIBUTES: the site CSP is `style-src 'nonce-…'`, and a nonce covers
 * only <style> elements — browsers block style ATTRIBUTES under it. Every layout
 * rule the template carried inline lives as a class in css.ts (NO_INLINE_CSS);
 * verify:site asserts rendered pages contain no `style="`.
 *
 * Copy note (CCB-S3-001, operator decision): the strong "consent + CSAM screening"
 * messaging is a forward-looking shop window; the binding point is first
 * distribution. Do not weaken it here — the copy lives in locales/*.json.
 */

import { html, raw, type SafeHtml } from '../html.js';
import { siteCss } from './css.js';
import { siteIcon } from './icons.js';
import {
  archiveDemoScript,
  CHROME_SCRIPT,
  JS_BOOT_SCRIPT,
  REVEAL_SCRIPT,
  STARFIELD_SCRIPT,
  type DemoConfig,
  type DemoMessage,
} from './client.js';
import type { LocaleSet } from './i18n.js';
import {
  breadcrumbs,
  HOME,
  NAV_SECTIONS,
  neighbours,
  pagePath,
  sectionOf,
  type SitePage,
} from './pages.js';
import { CONTACT_EMAIL, GITHUB_URL, SIMPLEX_GROUP_URL, type SiteSeoHead } from './seo.js';
import {
  contentFor,
  isFallbackLocale,
  type ClaimStatus,
  type PageContent,
} from './content.js';
// Importing the content modules is what REGISTERS their pages: each calls
// definePage() at module load. Without this the tree would render stubs.
import './content/platform.js';
import { localised, menuCopyFor } from './menu-copy.js';
import { impressumFor, isBindingLocale, privacyFor, type LegalSection } from './legal.js';
import { shouldLoadAnalytics, type SiteSettings } from '../../site/settings.js';
import { shareUrl, SHARE_LABELS } from '../share.js';

export interface SitePageView {
  locale: string;
  locales: LocaleSet;
  page: SitePage;
  origin: string;
  nonce: string;
  seo: SiteSeoHead;
  site: SiteSettings;
  t: (key: string, vars?: Record<string, string | number>) => string;
}

/** Dark is the only theme (operator decision, CCB-S3-001 follow-up). */
const THEME_COLOR = '#050A12';
const AVATAR_SRC = '/assets/site/cinderella-avatar.jpg';

/** Sample data for the archive demo — placeholder content only (public repo). */
const AD_MSGS: DemoMessage[] = [
  {
    g: '#privacy-talk',
    a: 'mara',
    t: '14:02',
    text: 'New onion-routing writeup is up, covers guard selection end to end.',
  },
  {
    g: '#privacy-talk',
    a: 'devnull',
    t: '14:03',
    text: "Does it touch on padding overhead? That's where most guides hand-wave.",
  },
  {
    g: '#selfhosting',
    a: 'kai',
    t: '09:11',
    text: "Here's my docker-compose.yml for the archive bot behind Caddy.",
    media: 'file',
  },
  { g: '#selfhosting', a: 'lena', t: '09:14', text: 'meetup_recording.mp4', media: 'video' },
  {
    g: '#foss-de',
    a: 'tomasz',
    t: '21:40',
    text: 'AGPL vs GPL for a bot serving a public archive, 14 replies deep now.',
  },
  {
    g: '#privacy-talk',
    a: 'mara',
    t: '14:20',
    text: 'Passkey rollout checklist v2 attached: WebAuthn only, no fallback.',
    media: 'file',
  },
  {
    g: '#foss-de',
    a: 'ingrid',
    t: '21:52',
    text: 'Onion services plus this archive = searchable history without a central host.',
  },
  {
    g: '#selfhosting',
    a: 'kai',
    t: '10:02',
    text: 'grafana-dashboard.png: capture throughput over 24h.',
    media: 'image',
  },
  {
    g: '#privacy-talk',
    a: 'devnull',
    t: '15:31',
    text: 'Consent prompt fired before capture, logged with the group id. Clean.',
  },
  {
    g: '#foss-de',
    a: 'tomasz',
    t: '22:05',
    text: 'Full-text search across a year of threads in under 40 ms.',
  },
];
const AD_GROUPS = ['#privacy-talk', '#selfhosting', '#foss-de'];
const AD_MEDIA_ICON: Record<string, string> = {
  file: 'file-text',
  video: 'clapperboard',
  image: 'image',
};

// Share URLs, labels and icons come from src/web/share.ts (CCB-S3-025) — one
// script-free source of truth shared with the archive stream's per-card share bar.

// ---------- shared building blocks ----------

type Tone = 'neutral' | 'accent' | 'success' | 'warning' | 'danger' | 'outline';

function badge(tone: Tone, label: string): SafeHtml {
  return html`<span class="cn-badge cn-badge-${tone}">${label}</span>`;
}

function sectionHeader(o: {
  eyebrow?: string;
  title: string;
  lede?: string;
  center?: boolean;
}): SafeHtml {
  return html`<div class="cn-sechead${o.center ? ' cn-sechead-center' : ''}">
    ${o.eyebrow ? html`<div class="cn-sechead-eyebrow">${o.eyebrow}</div>` : null}
    <h2 class="cn-sechead-title">${o.title}</h2>
    ${o.lede ? html`<p class="cn-sechead-lede">${o.lede}</p>` : null}
  </div>`;
}

function featureTile(icon: string, title: string, body: string, tileBadge?: SafeHtml): SafeHtml {
  return html`<div class="cn-card cn-card-default cn-card-pad-md">
    <div class="cn-ftile-icon">${siteIcon(icon)}</div>
    <div class="cn-ftile-title">${title}${tileBadge ?? null}</div>
    <p class="cn-ftile-body">${body}</p>
  </div>`;
}

function btnLink(
  href: string,
  variant: 'primary' | 'secondary' | 'ghost',
  size: 'sm' | 'md' | 'lg',
  inner: SafeHtml,
): SafeHtml {
  return html`<a class="cn-btn cn-btn-${variant} cn-btn-${size}" href="${href}">${inner}</a>`;
}

function wordmark(v: SitePageView, large = false): SafeHtml {
  return html`<a class="wordmark${large ? ' wordmark-lg' : ''}" href="${pagePath(v.locale, HOME)}">
    <span class="wm-name">${v.t('brand.name')}</span>
  </a>`;
}

function pageHero(o: {
  badge?: SafeHtml;
  eyebrow?: string;
  title: SafeHtml;
  lede?: string;
}): SafeHtml {
  return html`<section class="hero-bg fx-hero">
    <div class="wrap page-hero">
      ${o.badge ? html`<div class="hero-badge">${o.badge}</div>` : null}
      ${o.eyebrow ? html`<div class="eyebrow-neon">${o.eyebrow}</div>` : null}
      <h1 class="hero-h1 page-h1">${o.title}</h1>
      ${o.lede ? html`<p class="page-lede">${o.lede}</p>` : null}
    </div>
  </section>`;
}

// ---------- chrome ----------

/**
 * Is this page inside that section? Used to mark the current section in the nav.
 *
 * A sub-page marks its parent, so a reader three levels into Platform still sees
 * where they are. The legal pages mark nothing: they live in the footer.
 */
function inSection(v: SitePageView, sectionKey: string): boolean {
  const sec = sectionOf(v.page);
  return sec?.page.key === sectionKey;
}

/**
 * Desktop navigation with submenus.
 *
 * `<details>` rather than a scripted menu, so it opens on CLICK and with the
 * KEYBOARD for free and works with JavaScript off. Hover-to-open is layered on in
 * CSS for pointer-fine devices only, so a touch device never gets a menu that
 * springs open while you are scrolling past it. The briefing asks for hover AND
 * click AND keyboard, and this is the construction that gives all three without a
 * script the CSP would have to be loosened for.
 */

function navLinks(v: SitePageView): SafeHtml {
  // FIVE items: Home plus the four sections (CCB-S3-037 2). The earlier reading of
  // "four items" dropped Home; the intent was four SECTIONS.
  return html`<a
      class="nav-link${v.page.key === HOME.key ? ' active' : ''}"
      href="${pagePath(v.locale, HOME)}"
      data-nav-item
      ${v.page.key === HOME.key ? raw('aria-current="page"') : ''}
      >${v.t('nav.home')}</a
    >
    ${NAV_SECTIONS.map((sec) => {
      const current = inSection(v, sec.page.key);
      return html`<button
        type="button"
        class="nav-link nav-section${current ? ' active' : ''}"
        data-nav-item
        data-menu-open
        data-section="${sec.page.key}"
        ${current ? raw('aria-current="true"') : ''}
      >
        ${v.t(sec.page.navKey)}
      </button>`;
    })}
    <span class="nav-indicator" data-nav-indicator aria-hidden="true"></span>`;
}

/**
 * The utility rail (CCB-S3-037 2).
 *
 * GitHub and Docs on the left, Community, the SimpleX group and Login on the
 * right. Roadmap is gone from the rail and the language switcher with it, because
 * the site ships one language now. Hairline separators between items are what make
 * this read as a rail rather than as floating words: they run the height of the
 * text, not of the bar.
 */
function utilityRail(v: SitePageView): SafeHtml {
  const l = v.locale;
  const left: Array<[string, string, string, boolean]> = [
    ['github', v.t('footer.github'), GITHUB_URL, true],
    ['book-open', v.t('nav.docs'), `/${l}/docs`, false],
  ];
  const right: Array<[string, string, string, boolean]> = [
    ['users', v.t('nav.rail.community'), `${GITHUB_URL}/discussions`, true],
    ['message-circle', v.t('nav.rail.simplex'), SIMPLEX_GROUP_URL, true],
    ['key-round', v.t('nav.login'), '/login', false],
  ];
  const item = ([icon, label, href, ext]: [string, string, string, boolean]): SafeHtml =>
    html`<a class="rail-link" href="${href}" ${ext ? raw('target="_blank" rel="noopener"') : ''}
      >${siteIcon(icon, { size: 13 })}<span>${label}</span></a
    >`;
  return html`<div class="rail">
    <div class="wrap rail-row">
      <div class="rail-side">${left.map(item)}</div>
      <div class="rail-side rail-right">${right.map(item)}</div>
    </div>
  </div>`;
}

/**
 * The Demo control (CCB-S3-037 3).
 *
 * Built to the CSS the operator approved, rather than to a description of it. The
 * shape is an outer element carrying the clip and a 1.2px padding that acts as the
 * border, and an inner `.in` carrying the same clip, the dark interior and the
 * overflow that keeps the scanline inside. Nothing on the button transforms.
 *
 * The demo does not exist yet, so with no `demoUrl` this renders the identical
 * shape without an href. A control that 404s is worse than one that says it is
 * coming, and hiding it would empty the main bar of its only control.
 */
function demoControl(v: SitePageView, inMenu = false): SafeHtml {
  const url = v.site.demoUrl?.trim();
  const inner = html`<span class="in">
    <span class="sl" aria-hidden="true"></span>
    ${siteIcon('play', { size: 13 })}
    <span class="t">${v.t('nav.demo')}</span>
  </span>`;
  const cls = `dm${inMenu ? ' dm-in-menu' : ''}${url ? '' : ' dm-soon'}`;
  return url
    ? html`<a class="${cls}" href="${url}">${inner}</a>`
    : html`<span class="${cls}" aria-disabled="true" title="${v.t('nav.demo.soon')}"
        >${inner}</span
      >`;
}

/**
 * The navigation panel: the admin console's mega panel, COPIED (CCB-S3-038 1).
 *
 * Three previous attempts took the colours and the easing and rebuilt the
 * structure from a description, and all three were wrong. This is the admin's
 * markup with `admin-mega-` renamed to `cn-mega-`, fed the site's sections. The
 * grid, the column sizing, the intro block, the entry rows, the spacing, the
 * timing and the border and background treatment are unchanged.
 *
 * Shape, from the admin: ONE shell positioned `absolute; top:100%` under the
 * header, holding one panel per section, all `hidden` but the open one. It drops
 * from the header and occupies the upper part of the viewport. It is not a
 * full-viewport overlay, and it was one until now.
 *
 * Entries are inert (CCB-S3-034), so the admin's `<a>` becomes a `<span>`; that is
 * the only structural change, and the CSS is identical for both.
 */
/**
 * Splits entries across the columns the admin grid already provides.
 *
 * The grid is `repeat(4, ...)`, and putting every entry in ONE group left a single
 * tall column with three empty ones beside it. The admin distributes its children
 * across groups; the site has no group names to distribute BY, so it balances by
 * count, which is what fills the same grid.
 */
function chunk<T>(items: T[], columns: number): T[][] {
  const per = Math.ceil(items.length / columns);
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += per) out.push(items.slice(i, i + per));
  return out;
}

function megaPanel(v: SitePageView, sec: (typeof NAV_SECTIONS)[number]): SafeHtml {
  const copy = menuCopyFor(sec.page.key);
  const rows: Array<[string, string]> = [
    [v.t('nav.overview'), 'overview'],
    ...sec.children.map((c) => [v.t(c.navKey), c.key] as [string, string]),
  ];
  return html`<section
    id="cn-mega-${sec.page.key}"
    class="cn-mega-panel"
    data-mega-panel="${sec.page.key}"
    aria-hidden="true"
    hidden
  >
    <div class="cn-mega-panel-inner">
      <div class="cn-mega-intro">
        <span class="cn-mega-kicker">${v.t('nav.menu.kicker')}</span>
        <h2 class="cn-mega-title">${v.t(sec.page.navKey)}</h2>
        <p class="cn-mega-description">
          ${copy ? localised(copy.intro, v.locale) : ''}
        </p>
        <a href="${pagePath(v.locale, sec.page)}" class="cn-mega-overview-link"
          >${v.t('nav.overview')}</a
        >
      </div>

      <div class="cn-mega-groups">
        ${chunk(rows, 4).map(
          (colRows) =>
            html`<section class="cn-mega-group">
              <div class="cn-mega-group-links">
                ${colRows.map(([label, copyKey]) => {
                  const ec = copy?.entries[copyKey];
                  return html`<span class="cn-mega-link">
                    <span class="cn-mega-link-icon"
                      >${siteIcon(ec?.icon ?? 'circle', { size: 15 })}</span
                    >
                    <span class="cn-mega-link-copy">
                      <span class="cn-mega-link-label">${label}</span>
                      <span class="cn-mega-link-description"
                        >${ec ? localised(ec, v.locale) : ''}</span
                      >
                    </span>
                  </span>`;
                })}
              </div>
            </section>`,
        )}
      </div>

      <button type="button" class="cn-mega-close" data-menu-close aria-label="${v.t('nav.menu.close')}">
        ×
      </button>
    </div>
  </section>`;
}

/** The shell, holding one panel per section. Copied from `megaNavigationPanels`. */
function fullscreenMenu(v: SitePageView): SafeHtml {
  return html`<div class="cn-mega-shell" id="cn-menu" data-menu data-open="false">
    ${NAV_SECTIONS.map((sec) => megaPanel(v, sec))}
  </div>`;
}

/** Breadcrumbs, so a reader below the top level knows where they are. */
function breadcrumbTrail(v: SitePageView): SafeHtml | null {
  const trail = breadcrumbs(v.page);
  // A trail that only repeats the page's own title is noise, so section overviews
  // and home get none.
  if (trail.length < 2) return null;
  return html`<nav class="wrap crumbs" aria-label="${v.t('a11y.breadcrumb')}">
    <a href="${pagePath(v.locale, HOME)}">${v.t('nav.home')}</a>
    ${trail.map((page, i) =>
      i === trail.length - 1
        ? html`<span class="crumb-sep" aria-hidden="true">/</span><span
              class="crumb-here"
              aria-current="page"
              >${v.t(page.navKey)}</span
            >`
        : html`<span class="crumb-sep" aria-hidden="true">/</span><a
              href="${pagePath(v.locale, page)}"
              >${v.t(page.navKey)}</a
            >`,
    )}
  </nav>`;
}

/**
 * Previous and next within the section, so the site can be read through rather than
 * only jumped into.
 *
 * The ends are open rather than wrapping: a reader who finished the last page of a
 * section should see that they finished it, not be sent silently back to the top.
 */
function prevNext(v: SitePageView): SafeHtml | null {
  const { prev, next } = neighbours(v.page);
  if (!prev && !next) return null;
  return html`<nav class="wrap prevnext" aria-label="${v.t('a11y.pagination')}">
    ${prev
      ? html`<a class="pn pn-prev" href="${pagePath(v.locale, prev)}" rel="prev">
          <span class="pn-label">${siteIcon('chevron-left', { size: 13 })} ${v.t('nav.prev')}</span>
          <span class="pn-title">${v.t(prev.navKey)}</span>
        </a>`
      : html`<span class="pn pn-empty"></span>`}
    ${next
      ? html`<a class="pn pn-next" href="${pagePath(v.locale, next)}" rel="next">
          <span class="pn-label">${v.t('nav.next')} ${siteIcon('chevron-right', { size: 13 })}</span>
          <span class="pn-title">${v.t(next.navKey)}</span>
        </a>`
      : html`<span class="pn pn-empty"></span>`}
  </nav>`;
}



function header(v: SitePageView): SafeHtml {
  return html`<header class="site-header">
    ${utilityRail(v)}
    <div class="wrap hdr-row">
      ${wordmark(v)}
      <nav class="nav-desktop hdr-nav" aria-label="Primary">${navLinks(v)}</nav>
      <span class="nav-desktop hdr-controls">${demoControl(v)}</span>
      <button
        type="button"
        id="cn-burger"
        data-menu-open
        class="hdr-iconbtn burger"
        aria-label="${v.t('a11y.menu')}"
        aria-expanded="false"
        aria-controls="cn-menu"
      >
        ${siteIcon('menu', { size: 22, className: 'i-menu' })}${siteIcon('x', {
          size: 22,
          className: 'i-close',
        })}
      </button>
    </div>
    ${fullscreenMenu(v)}
  </header>`;
}

function footerCol(title: string, items: Array<[string, string, boolean?]>): SafeHtml {
  return html`<div class="fcol">
    <div class="fcol-title">${title}</div>
    <div class="fcol-links">
      ${items.map(
        ([label, href, external]) =>
          html`<a href="${href}" ${external ? raw('target="_blank" rel="noopener"') : ''}
            >${label}${
              external ? siteIcon('external-link', { size: 11, className: 'ext' }) : null
            }</a
          >`,
      )}
    </div>
  </div>`;
}

function footer(v: SitePageView): SafeHtml {
  const l = v.locale;
  return html`<footer class="site-footer">
    <span class="foot-top" aria-hidden="true"></span>
    <div class="wrap foot-grid">
      <div class="foot-brand">
        ${wordmark(v, true)}
        <p class="foot-blurb">${v.t('footer.blurb')}</p>
        <div class="foot-badges">
          ${badge('warning', v.t('badge.alpha'))} ${badge('neutral', v.t('badge.agpl'))}
        </div>
      </div>
      ${footerCol(v.t('footer.product'), [
        [v.t('nav.platform'), `/${l}/platform`],
        ['Pro', `/${l}/pro`],
        [v.t('nav.security'), `/${l}/security`],
        [v.t('footer.docs'), `/${l}/docs`],
      ])}
      ${footerCol(v.t('footer.opensource'), [
        [v.t('footer.github'), GITHUB_URL, true],
        [v.t('footer.agpl'), `/${l}/open-source`],
        // Contributing left the nav with Open Source and lands here, URL unchanged.
        [v.t('nav.opensource.contributing'), `/${l}/open-source/contributing`],
        [v.t('footer.changelog'), `${GITHUB_URL}/commits/main`, true],
      ])}
      ${footerCol(v.t('footer.ecosystem'), [
        ['SimpleX Chat', 'https://simplex.chat', true],
        ['Matrix', 'https://matrix.org', true],
        ['SimpleGo.dev', 'https://simplego.dev', true],
        ['Cyb3rD3sk.com', 'https://cyb3rd3sk.com', true],
      ])}
      ${footerCol(v.t('footer.legal'), [
        [v.t('footer.legalnotice'), `/${l}/legal`],
        [v.t('footer.privacy'), `/${l}/legal/privacy`],
        [v.t('footer.terms'), `/${l}/legal/terms`],
      ])}
    </div>
    ${shareBlock(v)}
    <div class="wrap foot-bottom">
      <span>${v.t('footer.copyright')}</span>
      <span>${v.t('footer.built')}</span>
    </div>
  </footer>`;
}

function shareBlock(v: SitePageView): SafeHtml {
  if (!v.site.socialShare.enabled || v.site.socialShare.networks.length === 0) return html``;
  const pageUrl = v.seo.canonicalUrl;
  const title = v.seo.title;
  return html`<div class="wrap footer-share">
    <p class="share-title">${siteIcon('paperclip', { size: 13 })} ${v.t('share.label')}</p>
    <div class="share-links">
      ${v.site.socialShare.networks.map(
        (net) =>
          html`<a href="${shareUrl(net, pageUrl, title)}" target="_blank" rel="noopener noreferrer"
            >${SHARE_LABELS[net]}</a
          >`,
      )}
    </div>
  </div>`;
}

// ---------- archive demo (SSR + progressive enhancement) ----------

function demoRow(v: SitePageView, m: DemoMessage): SafeHtml {
  const mediaLabel =
    m.media === 'file'
      ? v.t('demo.attachment')
      : m.media === 'video'
        ? 'video · behind auth'
        : 'image · behind auth';
  return html`<div class="ad-msg">
    <span class="ad-avatar" aria-hidden="true">${m.a[0]?.toUpperCase() ?? ''}</span>
    <div class="ad-msg-body">
      <div class="ad-meta">
        <b>${m.a}</b><span class="ad-grp">${m.g}</span><span class="ad-time">${m.t}</span>
        <span class="ad-arch"
          >${siteIcon('check', { size: 12, tone: 'success' })}${v.t('demo.archived')}</span
        >
      </div>
      <div class="ad-text">${m.text}</div>
      ${
        m.media
          ? html`<div class="ad-chip">
              ${siteIcon(AD_MEDIA_ICON[m.media] ?? 'file-text', {
                size: 13,
                tone: 'accent',
              })}<span>${mediaLabel}</span>${siteIcon('lock', { size: 11, tone: 'faint' })}
            </div>`
          : null
      }
    </div>
  </div>`;
}

function archiveDemo(v: SitePageView): SafeHtml {
  return html`<div class="ad-frame" id="cn-ad">
    <div class="ad-titlebar">
      <span class="ad-dot ad-dot-r"></span>
      <span class="ad-dot ad-dot-y"></span>
      <span class="ad-dot ad-dot-g"></span>
      <span class="ad-url"
        >${siteIcon('lock', { size: 12, tone: 'success' })} archive.cinderella.example /
        <span id="cn-ad-url-group" data-all="${v.t('demo.allgroups.short')}"
          >${v.t('demo.allgroups.short')}</span
        ></span
      >
      <span class="ad-badge">${v.t('demo.preview')}</span>
    </div>
    <div class="ad-body">
      <aside class="ad-side">
        <div class="ad-side-label">${v.t('demo.groups')}</div>
        <button type="button" class="ad-g on" data-group="all">
          ${siteIcon('archive', { size: 14 })} ${v.t('demo.allgroups')}<span class="ad-count"
            >${AD_MSGS.length}</span
          >
        </button>
        ${AD_GROUPS.map(
          (g) =>
            html`<button type="button" class="ad-g" data-group="${g}">
              ${siteIcon('hash', { size: 14 })}${g.replace('#', '')}<span class="ad-count"
                >${AD_MSGS.filter((m) => m.g === g).length}</span
              >
            </button>`,
        )}
        <div class="ad-consent">
          ${siteIcon('shield-check', { size: 14, tone: 'success' })}<span
            >${v.t('demo.consent')}</span
          >
        </div>
      </aside>
      <div class="ad-main">
        <div class="ad-searchbar">
          ${siteIcon('search', { size: 17, tone: 'faint' })}
          <input
            id="cn-ad-input"
            class="ad-input"
            placeholder="${v.t('demo.search.placeholder')}"
            aria-label="${v.t('demo.search.label')}"
          />
          <button type="button" id="cn-ad-clear" class="ad-clear" aria-label="${v.t('demo.clear')}">
            ${siteIcon('x', { size: 15 })}
          </button>
        </div>
        <div class="ad-filters">
          <button type="button" id="cn-ad-media" class="cn-tag" aria-pressed="false">
            ${siteIcon('paperclip', { size: 13 })} ${v.t('demo.hasmedia')}
          </button>
          <span class="ad-resultcount" id="cn-ad-count"
            >${v.t('demo.messages', { n: AD_MSGS.length })}</span
          >
        </div>
        <div class="ad-scroll ad-stream" id="cn-ad-stream">
          ${AD_MSGS.map((m) => demoRow(v, m))}
        </div>
        <div class="ad-empty" id="cn-ad-empty">
          ${siteIcon('search-x', { size: 22, tone: 'faint' })}
          <div>${v.t('demo.empty')} <span id="cn-ad-empty-q"></span></div>
        </div>
      </div>
    </div>
  </div>`;
}

function demoConfig(v: SitePageView): DemoConfig {
  const iconStr = (name: string, size: number, tone?: 'accent' | 'faint' | 'success'): string =>
    siteIcon(name, { size, ...(tone ? { tone } : {}) }).toString();
  return {
    messages: AD_MSGS,
    groups: AD_GROUPS,
    word: 'onion',
    i18n: {
      messages: v.t('demo.messages', { n: '{n}' }),
      of: v.t('demo.of', { n: '{n}', total: '{total}' }),
      empty: v.t('demo.empty'),
      archived: v.t('demo.archived'),
      attachment: v.t('demo.attachment'),
    },
    icons: {
      check: iconStr('check', 12, 'success'),
      lock: iconStr('lock', 11, 'faint'),
      'file-text': iconStr('file-text', 13, 'accent'),
      clapperboard: iconStr('clapperboard', 13, 'accent'),
      image: iconStr('image', 13, 'accent'),
    },
  };
}

// ---------- page bodies ----------

function homeBody(v: SitePageView): SafeHtml {
  const l = v.locale;
  const caps: Array<[string, string]> = [
    ['cpu', 'ai'],
    ['users', 'identities'],
    ['sparkles', 'npcs'],
    ['user-cog', 'agents'],
    ['database', 'memory'],
    ['sliders-horizontal', 'admin'],
    ['shield-alert', 'safety'],
    ['git-branch', 'selfhost'],
  ];
  const controlPoints = [
    v.t('home.control.point1'),
    v.t('home.control.point2'),
    v.t('home.control.point3'),
  ];
  // FOUR items, deliberately. The fifth (CSAM screening) is gone from the hero
  // entirely: the honest detail belongs on the Security page, where somebody
  // evaluating the product reads it properly, and a disclaimer on a marketing hero
  // for something nobody can obtain protects no one (CCB-S3-035 §1).
  const trust: Array<[string, string]> = [
    ['shield-check', v.t('trust.consent')],
    ['key-round', v.t('trust.passkeys')],
    ['cpu', v.t('trust.localai')],
    ['git-branch', v.t('trust.agpl')],
  ];
  // The rotating half of the headline. The width is reserved by rendering every
  // phrase stacked, so the layout cannot shift as they change.
  const rotations = ['hero.rot1', 'hero.rot2', 'hero.rot3', 'hero.rot4', 'hero.rot5'].map((k) =>
    v.t(k),
  );
  const secPoints: Array<[string, string]> = [
    ['key-round', v.t('home.sec.point1')],
    ['lock', v.t('home.sec.point2')],
    ['cpu', v.t('home.sec.point3')],
    ['flag', v.t('home.sec.point4')],
  ];
  return html`
    <section class="hero-bg fx-hero">
      <div class="wrap hero-cine">
        <div class="htext hero-col">
          <a class="ann sym sym-left d40" href="/${l}/platform">
            <span class="ann-dot"></span>
            <span>${v.t('hero.ann')}</span>
            <span class="ann-chip">${siteIcon('arrow-right', { size: 13 })}</span>
          </a>
          <h1 class="hero-h1 home-h1">
            <span class="hline sym sym-blur d120">${v.t('hero.title1')}</span>
            <span class="hline grad-text sym sym-rise d240 hero-rot" data-hero-rotator>
              ${rotations.map(
                (phrase, i) =>
                  html`<span
                    class="ph"${i === 0 ? raw(' data-on') : ''}
                    data-hero-phrase
                    ${i === 0 ? raw('') : raw('aria-hidden="true"')}
                    >${phrase}</span
                  >`,
              )}
            </span>
          </h1>
          <p class="home-lede sym sym-left d380">${v.t('hero.lede')}</p>
          <div class="home-cta sym sym-scale d480">
            ${btnLink(`/${l}/security`, 'primary', 'lg', html`${v.t('hero.cta.safeguards')}`)}
            ${btnLink(
              `/${l}/platform`,
              'secondary',
              'lg',
              html`${v.t('hero.cta.explore')} ${siteIcon('arrow-right', { size: 15 })}`,
            )}
          </div>
          <div class="hero-feats" data-hero-features>
            ${trust.map(
              ([i, label]) =>
                html`<span class="trust-item"
                  >${siteIcon(i, { size: 14, tone: 'faint' })}${label}</span
                >`,
            )}
          </div>
        </div>
        <div class="hero-stage sym sym-right d220">
          <div class="pring">
            <img src="${AVATAR_SRC}" alt="${v.t('brand.name')}" width="420" height="420" />
            <span class="pchip c1"><span class="d"></span>${v.t('hero.chip.consent')}</span>
          </div>
        </div>
      </div>
    </section>

    <section class="band wrap" data-reveal>
      ${sectionHeader({
        eyebrow: v.t('home.live.eyebrow'),
        title: v.t('home.live.title'),
        lede: v.t('home.live.lede'),
      })}
      <div class="hero-visual mt36">${archiveDemo(v)}</div>
    </section>

    <section class="band wrap" data-reveal>
      ${sectionHeader({
        eyebrow: v.t('home.how.eyebrow'),
        title: v.t('home.how.title'),
        lede: v.t('home.how.lede'),
        center: true,
      })}
    </section>

    <section class="band wrap" data-reveal>
      ${sectionHeader({
        eyebrow: v.t('home.suite.eyebrow'),
        title: v.t('home.suite.title'),
        lede: v.t('home.suite.lede'),
        center: true,
      })}
      <div class="grid4 mt48">
        ${caps.map(([icon, k]) =>
          featureTile(icon, v.t(`home.cap.${k}.title`), v.t(`home.cap.${k}.body`)),
        )}
      </div>
    </section>

    <section class="band wrap" data-reveal>
      <div class="cn-card cn-card-default cn-card-pad-lg">
        ${sectionHeader({
          eyebrow: v.t('home.control.eyebrow'),
          title: v.t('home.control.title'),
          lede: v.t('home.control.lede'),
        })}
        <div class="list-col mt22">
          ${controlPoints.map(
            (point) =>
              html`<div class="icon-line">
                ${siteIcon('shield-check', { size: 17, tone: 'accent' })}${point}
              </div>`,
          )}
        </div>
      </div>
    </section>

    <section class="band wrap" data-reveal>
      <div class="cn-card cn-card-default cn-card-pad-lg card-split">
        <div class="split-main">
          ${sectionHeader({
            eyebrow: v.t('home.sec.eyebrow'),
            title: v.t('home.sec.title'),
            lede: v.t('home.sec.lede'),
          })}
          <div class="mt22">
            ${btnLink(
              `/${l}/security`,
              'secondary',
              'md',
              html`${v.t('home.sec.cta')} ${siteIcon('arrow-right', { size: 14 })}`,
            )}
          </div>
        </div>
        <div class="split-side">
          ${secPoints.map(
            ([i, label]) =>
              html`<div class="icon-line">
                ${siteIcon(i, { size: 17, tone: 'accent' })}${label}
              </div>`,
          )}
        </div>
      </div>
    </section>
  `;
}

function pricingTier(o: {
  name: string;
  price: string;
  period?: string;
  desc: string;
  features: string[];
  cta: string;
  ctaHref: string;
  highlight?: boolean;
  tierBadge?: SafeHtml;
}): SafeHtml {
  return html`<div
    class="cn-card ${
      o.highlight ? 'cn-card-accent cn-tier-highlight' : 'cn-card-default'
    } cn-card-pad-lg"
  >
    <div class="cn-tier-name">${o.name}${o.tierBadge ?? null}</div>
    <div class="cn-tier-price">
      <b>${o.price}</b>${o.period ? html`<span> ${o.period}</span>` : null}
    </div>
    <p class="cn-tier-desc">${o.desc}</p>
    <ul class="cn-tier-list">
      ${o.features.map((f) => html`<li>${f}</li>`)}
    </ul>
    ${btnLink(o.ctaHref, o.highlight ? 'primary' : 'secondary', 'md', html`${o.cta}`)}
  </div>`;
}

function proBody(v: SitePageView): SafeHtml {
  const l = v.locale;
  return html`
    ${pageHero({
      badge: badge('accent', 'Pro'),
      eyebrow: v.t('pro.eyebrow'),
      title: html`${v.t('pro.title')}`,
      lede: v.t('pro.lede'),
    })}
    <section class="band wrap pt64" data-reveal>
      <div class="grid3">
        ${featureTile('server', v.t('pro.tile1.title'), v.t('pro.tile1.body'))}
        ${featureTile('layers', v.t('pro.tile2.title'), v.t('pro.tile2.body'))}
        ${featureTile('life-buoy', v.t('pro.tile3.title'), v.t('pro.tile3.body'))}
      </div>
    </section>
    <section class="band wrap" data-reveal>
      ${sectionHeader({
        eyebrow: v.t('pro.pricing.eyebrow'),
        title: v.t('pro.pricing.title'),
        lede: v.t('pro.pricing.lede'),
      })}
      <div class="grid3 grid-stretch mt36">
        ${pricingTier({
          name: v.t('pro.tier1.name'),
          price: v.t('pro.tier1.price'),
          period: v.t('pro.tier1.period'),
          desc: v.t('pro.tier1.desc'),
          features: [v.t('pro.tier1.f1'), v.t('pro.tier1.f2'), v.t('pro.tier1.f3')],
          cta: v.t('pro.tier1.cta'),
          ctaHref: `/${l}/open-source`,
        })}
        ${pricingTier({
          name: v.t('pro.tier2.name'),
          price: v.t('pro.tier2.price'),
          period: v.t('pro.tier2.period'),
          desc: v.t('pro.tier2.desc'),
          features: [
            v.t('pro.tier2.f1'),
            v.t('pro.tier2.f2'),
            v.t('pro.tier2.f3'),
            v.t('pro.tier2.f4'),
          ],
          cta: v.t('pro.tier2.cta'),
          ctaHref: `mailto:${CONTACT_EMAIL}?subject=CIND3R3LLA%20Pro%20waitlist`,
          highlight: true,
          tierBadge: badge('accent', v.t('badge.recommended')),
        })}
        ${pricingTier({
          name: v.t('pro.tier3.name'),
          price: v.t('pro.tier3.price'),
          desc: v.t('pro.tier3.desc'),
          features: [v.t('pro.tier3.f1'), v.t('pro.tier3.f2'), v.t('pro.tier3.f3')],
          cta: v.t('pro.tier3.cta'),
          ctaHref: `mailto:${CONTACT_EMAIL}?subject=CIND3R3LLA%20Enterprise`,
        })}
      </div>
    </section>
    <section class="band wrap" data-reveal>
      <div class="cn-card cn-card-accent cn-card-pad-lg card-row">
        <div class="split-320">
          <div class="card-title-lg">${v.t('pro.customer.title')}</div>
          <p class="card-note">${v.t('pro.customer.body')}</p>
        </div>
        <div class="pro-form">
          <div class="cn-field pro-email">
            <label class="cn-field-label" for="cn-pro-email">${v.t('pro.customer.email')}</label>
            <input id="cn-pro-email" class="cn-input cn-input-md" placeholder="you@example.org" />
          </div>
          <a
            class="cn-btn cn-btn-primary cn-btn-md"
            href="mailto:${CONTACT_EMAIL}?subject=CIND3R3LLA%20Pro%20access%20request"
            >${v.t('pro.customer.request')}</a
          >
          ${btnLink('/login', 'secondary', 'md', html`${v.t('pro.customer.login')}`)}
        </div>
      </div>
    </section>
  `;
}

function securityBody(v: SitePageView): SafeHtml {
  const l = v.locale;
  const flow = [
    { t: v.t('security.flow.consent'), i: 'shield-check', on: false },
    { t: v.t('security.flow.screen'), i: 'shield-alert', on: true },
    { t: v.t('security.flow.publish'), i: 'globe', on: false },
  ];
  const tiles = [
    ['key-round', 'tile1'],
    ['server', 'tile2'],
    ['flag', 'tile3'],
  ] as const;
  return html`
    ${pageHero({
      eyebrow: v.t('security.eyebrow'),
      title: html`${v.t('security.title1')}<span class="grad-text">${v.t('security.title2')}</span
        >${v.t('security.title3')}`,
      lede: v.t('security.lede'),
    })}
    <section class="band wrap pt48" data-reveal>
      <div class="cn-card cn-card-accent cn-card-pad-lg sec-csam">
        <div class="sec-main">
          <div class="sec-icon">${siteIcon('shield-alert', { size: 22 })}</div>
          <div class="row-title mt16">
            <span class="sec-title">${v.t('security.csam.title')}</span>
            ${badge('danger', v.t('badge.indev'))}
          </div>
          <p class="sec-body">${v.t('security.csam.body')}</p>
        </div>
        <div class="sec-flow">
          ${flow.map(
            (f, i) => html`
              <div class="flow-node${f.on ? ' on' : ''}">
                ${siteIcon(f.i, { size: 20 })}
                <div class="flow-label">${f.t}</div>
              </div>
              ${i < flow.length - 1 ? siteIcon('arrow-right', { size: 16, tone: 'faint' }) : null}
            `,
          )}
        </div>
      </div>
      <div class="grid3 grid-start mt16">
        ${tiles.map(([icon, k]) =>
          featureTile(icon, v.t(`security.${k}.title`), v.t(`security.${k}.body`)),
        )}
      </div>
    </section>
    <section class="band wrap" data-reveal>
      <div class="cn-card cn-card-default cn-card-pad-lg card-row">
        ${siteIcon('bug', { size: 26, tone: 'accent' })}
        <div class="split-320">
          <div class="card-title-sm">${v.t('security.vuln.title')}</div>
          <p class="card-note">${v.t('security.vuln.body')}</p>
        </div>
        ${btnLink(
          `/${l}/open-source`,
          'secondary',
          'md',
          html`${v.t('security.vuln.cta')} ${siteIcon('arrow-right', { size: 14 })}`,
        )}
      </div>
    </section>
  `;
}

// The template's "Self-hosting / Run it yourself" section is intentionally NOT
// rendered while the product is v0.0.1-alpha (operator decision, CCB-S3-001):
// no self-host instructions until there is a distributable release.
function openSourceBody(v: SitePageView): SafeHtml {
  return html`
    ${pageHero({
      badge: badge('neutral', v.t('badge.agpl')),
      eyebrow: v.t('os.eyebrow'),
      title: html`${v.t('os.title')}`,
      lede: v.t('os.lede'),
    })}
    <section class="band wrap pt64" data-reveal>
      <div class="grid2 grid-stretch">
        <div class="cn-card cn-card-default cn-card-pad-lg">
          <div class="row-title">
            ${siteIcon('github', { size: 22, tone: 'accent' })}<span class="card-title-sm"
              >${v.t('os.repo.title')}</span
            >
          </div>
          <p class="card-para">${v.t('os.repo.body')}</p>
          <a
            class="cn-btn cn-btn-primary cn-btn-md"
            href="${GITHUB_URL}"
            target="_blank"
            rel="noopener"
            >${v.t('os.repo.cta')} ${siteIcon('external-link', { size: 14 })}</a
          >
        </div>
        <div class="cn-card cn-card-default cn-card-pad-lg">
          <div class="card-title-sm">${v.t('os.why.title')}</div>
          <p class="card-para-tight">${v.t('os.why.body')}</p>
        </div>
      </div>
    </section>
  `;
}

// ---------- legal ----------

/** Splits an address paragraph on its newlines, so a postal address stays one. */
const NEWLINE = String.fromCharCode(10);
function splitLines(text: string): string[] {
  return text.split(NEWLINE).map((s) => s.trim());
}

/**
 * Renders one legal document (CCB-S3-029).
 *
 * The text is real operator data from `legal.ts`, not template copy. Paragraphs
 * may carry newlines for postal addresses, which become <br> rather than being
 * collapsed, because an address that runs together is not an address.
 */
function legalDoc(doc: { title: string; sections: LegalSection[] }): SafeHtml {
  return html`<div class="doc">
    <h2>${doc.title}</h2>
    ${doc.sections.map(
      (sec) => html`
        <h3>${sec.h}</h3>
        ${sec.body.map(
          (para) =>
            html`<p>
              ${splitLines(para).map((line, i) => (i === 0 ? html`${line}` : html`<br />${line}`))}
            </p>`,
        )}
      `,
    )}
  </div>`;
}

function legalTabs(v: SitePageView): SafeHtml {
  const l = v.locale;
  const items: Array<[string, string, string]> = [
    ['legal', `/${l}/legal`, v.t('legal.tab.impressum')],
    ['legal-privacy', `/${l}/legal/privacy`, v.t('legal.tab.privacy')],
    ['legal-terms', `/${l}/legal/terms`, v.t('legal.tab.terms')],
  ];
  return html`<nav class="cn-tabs cn-tabs-underline" aria-label="${v.t('legal.title')}">
    ${items.map(
      ([key, href, label]) =>
        html`<a
          class="cn-tab"
          href="${href}"
          ${v.page.key === key ? raw('aria-current="page"') : ''}
          >${label}</a
        >`,
    )}
  </nav>`;
}

/**
 * Terms of service: deliberately NOT invented (CCB-S3-029 Part E).
 *
 * The commercial Pro tier is not settled, and shipping plausible-sounding terms
 * would be worse than shipping none: a visitor could rely on them. So this states
 * plainly that no terms are in force yet, which is both true and useful, and it
 * carries no bracketed placeholder.
 */
function termsDoc(v: SitePageView): SafeHtml {
  const de = v.locale === 'de';
  return html`<div class="doc">
    <h2>${de ? 'Allgemeine Geschäftsbedingungen' : 'Terms of service'}</h2>
    <p>
      ${de
        ? 'Für CIND3R3LLA gelten derzeit keine eigenen Allgemeinen Geschäftsbedingungen. Der Dienst befindet sich in einer Alpha-Phase und wird ohne kostenpflichtigen Tarif angeboten.'
        : 'No terms of service are currently in force for CIND3R3LLA. The service is in an alpha phase and is offered without any paid tier.'}
    </p>
    <p>
      ${de
        ? 'Sobald der kommerzielle Pro-Tarif eingeführt wird, werden hier Allgemeine Geschäftsbedingungen veröffentlicht, die diesen abdecken. Bis dahin gelten die gesetzlichen Bestimmungen sowie die Angaben im Impressum und in der Datenschutzerklärung.'
        : 'Terms covering the commercial Pro tier will be published here when that tier is introduced. Until then, the statutory provisions apply, together with the legal notice and the privacy policy.'}
    </p>
    <p>
      ${de
        ? 'Der Quellcode steht gesondert unter der GNU Affero General Public License v3.0 (AGPL-3.0); für ihn gelten deren Bedingungen.'
        : 'The source code is published separately under the GNU Affero General Public License v3.0 (AGPL-3.0), and its terms apply to the code.'}
    </p>
  </div>`;
}

function legalBody(v: SitePageView): SafeHtml {
  const doc =
    v.page.key === 'legal-privacy'
      ? legalDoc(privacyFor(v.locale))
      : v.page.key === 'legal-terms'
        ? termsDoc(v)
        : legalDoc(impressumFor(v.locale));
  // Only the Terms remain a draft; the Impressum and the privacy policy are real.
  const draft = v.page.key === 'legal-terms';
  // The German versions of the Impressum and the privacy policy are the binding
  // ones. Every other language is a convenience translation and says so, because
  // a reader relying on a translation needs to know which text governs.
  const translated = v.page.key !== 'legal-terms' && !isBindingLocale(v.locale);
  return html`
    ${pageHero({
      eyebrow: v.t('legal.eyebrow'),
      title: html`${v.t('legal.title')}`,
      lede: v.t('legal.lede'),
    })}
    <section class="wrap pt40">
      ${legalTabs(v)}
      <div class="cn-card cn-card-quiet cn-card-pad-lg legal-card">
        <div class="chip-row">
          ${draft ? badge('warning', v.t('legal.badge.draft')) : null}
        </div>
        ${translated
          ? html`<p class="legal-binding-note">
              This is a convenience translation. The legally binding version is the German one,
              which follows below.
            </p>`
          : null}
        ${doc}
        ${translated ? legalBindingOriginal(v) : null}
      </div>
    </section>
  `;
}

/** A clean "coming soon" stub (Docs — never a 404), in the template design. */
/**
 * The binding German original, printed beneath the English translation.
 *
 * CCB-S3-037 removed every locale but English, which took `/de/legal` with it. The
 * German Impressum is the LEGALLY BINDING text (D-079) and a German business is
 * required to publish one, so it cannot leave the site with the locale. It is
 * rendered on the same page instead: the English convenience translation first,
 * then the German that actually governs, so nothing is unreachable and the
 * cross-link that would now be dead is gone.
 *
 * The Terms are excluded because they remain a draft in one language only.
 */
function legalBindingOriginal(v: SitePageView): SafeHtml {
  const doc =
    v.page.key === 'legal-privacy' ? legalDoc(privacyFor('de')) : legalDoc(impressumFor('de'));
  return html`<div class="legal-binding">
    <p class="legal-binding-note">
      Maßgeblich ist die folgende deutsche Fassung.
    </p>
    ${doc}
  </div>`;
}

function stubBody(v: SitePageView): SafeHtml {
  return html`
    <section class="hero-bg fx-hero">
      <div class="wrap stub-hero">
        ${badge('warning', v.t('stub.badge'))}
        <h1>${v.t(v.page.navKey)}</h1>
        <p>${v.t('stub.lead')}</p>
        <p>${v.t('stub.body')}</p>
        <div class="stub-cta">
          <a
            class="cn-btn cn-btn-primary cn-btn-md"
            href="${GITHUB_URL}"
            target="_blank"
            rel="noopener"
            >${v.t('os.repo.cta')} ${siteIcon('external-link', { size: 14 })}</a
          >
          ${btnLink(pagePath(v.locale, HOME), 'secondary', 'md', html`${v.t('stub.back')}`)}
        </div>
      </div>
    </section>
  `;
}

// ---------- cookie banner + consent-gated analytics (D-023/D-025, unchanged) ----------

function consentScript(v: SitePageView): string {
  const url = JSON.stringify(v.site.analytics.scriptUrl).replace(/</g, '\\u003c');
  return `(function(){var KEY='cin-consent';var banner=document.getElementById('cin-cookie');
function stored(){try{return localStorage.getItem(KEY);}catch(e){return null;}}
function save(x){try{localStorage.setItem(KEY,x);}catch(e){}}
var loaded=false;function loadAnalytics(){if(loaded)return;loaded=true;var s=document.createElement('script');s.src=${url};s.async=true;document.head.appendChild(s);}
function accept(){save('granted');if(banner)banner.hidden=true;loadAnalytics();}
function reject(){save('denied');if(banner)banner.hidden=true;}
var d=stored();
if(d==='granted'){loadAnalytics();}
else if(d!=='denied'&&banner){banner.hidden=false;}
var a=document.getElementById('cin-accept'),r=document.getElementById('cin-reject');
if(a)a.addEventListener('click',accept);if(r)r.addEventListener('click',reject);})();`;
}

function cookieBanner(v: SitePageView): SafeHtml {
  const policyHref = v.site.cookieBanner.policyUrl || `/${v.locale}/legal/privacy`;
  return html`<div
    id="cin-cookie"
    class="cn-cookiebar"
    role="region"
    aria-live="polite"
    aria-label="${v.t('cookie.title')}"
    hidden
  >
    <div class="cn-cookiebar-inner">
      <div class="cn-cookiebar-text">
        <b>${v.t('cookie.title')}:</b> ${v.t('cookie.text')}
        <a href="${policyHref}">${v.t('cookie.policy')}</a>.
      </div>
      <div class="cn-cookiebar-actions">
        <button type="button" id="cin-reject" class="cn-btn cn-btn-ghost cn-btn-sm">
          ${v.t('cookie.reject')}
        </button>
        <button type="button" id="cin-accept" class="cn-btn cn-btn-primary cn-btn-sm">
          ${v.t('cookie.accept')}
        </button>
      </div>
    </div>
  </div>`;
}

/**
 * The generic content page (CCB-S3-030).
 *
 * Thirty pages share one renderer rather than each having a bespoke layout,
 * because the argument is the same shape everywhere: a hero, then sections of real
 * prose, some with a load-bearing sentence pulled out as a callout and some with a
 * marker saying the claim is not shipped yet. A bespoke layout per page would mean
 * thirty places for the marker to be forgotten.
 */
function statusChip(v: SitePageView, status: ClaimStatus): SafeHtml | null {
  // Only 'in-development' is worth showing. Marking everything else 'live' would
  // turn the honest marker into decoration and train readers to ignore it.
  return status === 'in-development' ? badge('warning', v.t('status.inDevelopment')) : null;
}

/**
 * A section panel: the 9px clipped corner from the Demo control (CCB-S3-037 5).
 *
 * Two nested elements rather than a border, so the 1px edge follows the cut
 * corners instead of being sliced off by the clip, which is how the Demo control
 * draws its edge too. Repeating that one shape is what makes the page read as a
 * system rather than as a stack of unrelated blocks.
 */
function secPanel(inner: SafeHtml): SafeHtml {
  return html`<div class="sec-panel"><div class="sec-panel-in">${inner}</div></div>`;
}

function contentBody(v: SitePageView, c: PageContent): SafeHtml {
  return html`
    ${pageHero({
      ...(sectionOf(v.page) ? { eyebrow: v.t(sectionOf(v.page)?.page.navKey ?? '') } : {}),
      title: html`${c.title}`,
      lede: c.lede,
    })}
    ${breadcrumbTrail(v)}
    ${isFallbackLocale(v.locale)
      ? html`<div class="wrap">
          <p class="fallback-note">${v.t('i18n.fallback')}</p>
        </div>`
      : null}
    <section class="wrap pt40 doc-page">
      ${c.sections.map(
        (sec) => secPanel(html`<section class="doc-sec">
          <h2>
            ${sec.h}${sec.status ? html` ${statusChip(v, sec.status)}` : null}
          </h2>
          ${sec.body.map((para) => html`<p>${para}</p>`)}
          ${sec.list
            ? html`<ul class="doc-list">
                ${sec.list.map((item) => html`<li>${item}</li>`)}
              </ul>`
            : null}
          ${sec.callout ? html`<p class="doc-callout">${sec.callout}</p>` : null}
        </section>`),
      )}
    </section>
    ${prevNext(v)}
  `;
}

// ---------- document ----------

function bodyFor(v: SitePageView): SafeHtml {
  if (!v.page.built) return stubBody(v);
  switch (v.page.key) {
    case 'legal':
    case 'legal-privacy':
    case 'legal-terms':
      return legalBody(v);
    case 'home':
      return homeBody(v);
    default: {
      // Every page in the tree draws from the content registry. A page with no
      // entry renders the stub rather than a 404, which is the same promise the
      // site has always made, but the acceptance criterion for CCB-S3-030 is that
      // nothing in the navigation reaches it.
      const c = contentFor(v.page.key, v.locale);
      if (c) return contentBody(v, c);
      // CCB-S3-030 lands in passes, and no page may get WORSE in the meantime.
      // Three section overviews already had bespoke pages from CCB-S3-001, so they
      // keep them until their authored copy arrives rather than regressing to a
      // stub. Everything else renders the clean stub: a 200 with the full site
      // chrome, never a 404.
      if (v.page.key === 'pro') return proBody(v);
      if (v.page.key === 'security') return securityBody(v);
      if (v.page.key === 'open-source') return openSourceBody(v);
      return stubBody(v);
    }
  }
}

/** Renders a complete marketing page document. */
export function renderSitePage(v: SitePageView): string {
  const seo = v.seo;
  const dir = v.locales.meta[v.locale]?.dir ?? 'ltr';
  const gated = shouldLoadAnalytics(v.site);
  const body = bodyFor(v);
  const isHome = v.page.key === 'home' && v.page.built;

  const scripts = [
    CHROME_SCRIPT,
    STARFIELD_SCRIPT,
    REVEAL_SCRIPT,
    ...(isHome ? [archiveDemoScript(demoConfig(v))] : []),
  ].join('\n');

  const doc = html`<!doctype html>
    <html lang="${v.locale}" dir="${dir}" class="no-js">
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <meta name="robots" content="${seo.robots}" />
        <meta name="theme-color" content="${THEME_COLOR}" />
        <script nonce="${v.nonce}">
          ${raw(JS_BOOT_SCRIPT)};
        </script>
        <title>${seo.title}</title>
        <meta name="description" content="${seo.description}" />
        <link rel="canonical" href="${seo.canonicalUrl}" />
        ${seo.alternates.map(
          (a) => html`<link rel="alternate" hreflang="${a.hreflang}" href="${a.href}" />`,
        )}
        <meta property="og:type" content="${seo.ogType}" />
        <meta property="og:title" content="${seo.ogTitle}" />
        <meta property="og:description" content="${seo.ogDescription}" />
        <meta property="og:site_name" content="${seo.ogSiteName}" />
        <meta property="og:locale" content="${seo.ogLocale}" />
        <meta property="og:url" content="${seo.ogUrl}" />
        <meta property="og:image" content="${v.origin}${AVATAR_SRC}" />
        <meta name="twitter:card" content="${seo.twitterCard}" />
        <meta name="twitter:title" content="${seo.ogTitle}" />
        <meta name="twitter:description" content="${seo.ogDescription}" />
        <script type="application/ld+json" nonce="${v.nonce}">
          ${raw(seo.jsonLd)}
        </script>
        <style nonce="${v.nonce}">
          ${raw(siteCss())}
        </style>
      </head>
      <body>
        <a class="skip" href="#main">${v.t('a11y.skip')}</a>
        <canvas id="cn-starfield" aria-hidden="true"></canvas>
        ${header(v)}
        <main id="main"><div class="screen">${body}</div></main>
        ${footer(v)} ${gated ? cookieBanner(v) : null}
        <script nonce="${v.nonce}">
          ${raw(scripts)};
        </script>
        ${
          gated
            ? html`<script nonce="${v.nonce}">
                ${raw(consentScript(v))};
              </script>`
            : null
        }
      </body>
    </html>`;
  return doc.toString();
}
