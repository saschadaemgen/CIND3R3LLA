/**
 * The marketing site's page catalog (CCB-S2-012, redesigned CCB-S3-001, restructured
 * CCB-S3-030) — one source of truth shared by routing, navigation, breadcrumbs,
 * previous/next, SEO and the sitemap.
 *
 * WHY A TREE AND NOT A LIST. The site outgrew its flat nav: the product is a
 * self-hosted control plane for intelligent identities, and five top-level sections
 * each carry real sub-pages. Every submenu item is a page with its own URL rather
 * than an anchor, because a link into the middle of a long page is not a page: it
 * cannot be titled, described, canonicalised, indexed or shared on its own.
 *
 * The tree is the ONLY place the structure is written down. Nav, drawer,
 * breadcrumbs, previous/next, the sitemap and the route table all derive from it,
 * so a page cannot exist in one and be missing from another. That is what makes
 * "no dead links" checkable rather than aspirational.
 *
 * A page's i18n meta keys are `meta.<key>.title` / `meta.<key>.description`, and its
 * URL is `/<locale>` for home and `/<locale>/<slug>` otherwise. Slugs may contain
 * one '/' (`platform/consent-archive`); the route table handles both depths.
 */

export interface SitePage {
  /** Stable id; also the `meta.<key>.*` prefix. */
  key: string;
  /** URL slug ('' for home; may contain '/' for a sub-page). */
  slug: string;
  /** i18n key for the nav label. */
  navKey: string;
  /** Whether a real page exists (else a stub is rendered). */
  built: boolean;
  /** Built but thin/draft content — noindex, excluded from the sitemap. */
  noindex?: boolean;
}

export interface SiteSection {
  /** The section's own overview page. */
  page: SitePage;
  /** Sub-pages, in reading order. Previous/next walks this order. */
  children: SitePage[];
}

export const HOME: SitePage = { key: 'home', slug: '', navKey: 'nav.home', built: true };

const p = (key: string, slug: string, navKey: string): SitePage => ({
  key,
  slug,
  navKey,
  built: true,
});

/**
 * The five sections, in nav order.
 *
 * Reading order inside a section is deliberate rather than alphabetical: Platform
 * opens with the consent archive because that is the differentiator, and Docs opens
 * with getting started because that is what somebody arriving from a search wants.
 */
export const SECTIONS: SiteSection[] = [
  {
    page: p('platform', 'platform', 'nav.platform'),
    children: [
      p('platform-consent-archive', 'platform/consent-archive', 'nav.platform.consentArchive'),
      p('platform-knowledge-site', 'platform/knowledge-site', 'nav.platform.knowledgeSite'),
      p('platform-ai-runtime', 'platform/ai-runtime', 'nav.platform.aiRuntime'),
      p('platform-identities', 'platform/identities', 'nav.platform.identities'),
      p('platform-npcs', 'platform/npcs', 'nav.platform.npcs'),
      p('platform-agents', 'platform/agents', 'nav.platform.agents'),
      p('platform-interaction', 'platform/interaction', 'nav.platform.interaction'),
      p('platform-administration', 'platform/administration', 'nav.platform.administration'),
    ],
  },
  {
    page: p('security', 'security', 'nav.security'),
    children: [
      p('security-consent', 'security/consent-architecture', 'nav.security.consent'),
      p('security-data', 'security/data-protection', 'nav.security.data'),
      p('security-moderation', 'security/content-safety', 'nav.security.moderation'),
      p('security-sovereignty', 'security/self-hosting', 'nav.security.sovereignty'),
    ],
  },
  {
    page: p('pro', 'pro', 'nav.pro'),
    children: [
      p('pro-hosted', 'pro/hosted', 'nav.pro.hosted'),
      p('pro-installation', 'pro/installation', 'nav.pro.installation'),
      p('pro-support', 'pro/support', 'nav.pro.support'),
    ],
  },
  {
    page: p('docs', 'docs', 'nav.docs'),
    children: [
      p('docs-installation', 'docs/installation', 'nav.docs.installation'),
      p('docs-member', 'docs/member-guide', 'nav.docs.member'),
      p('docs-operator', 'docs/operator-guide', 'nav.docs.operator'),
      p('docs-commands', 'docs/commands', 'nav.docs.commands'),
      p('docs-faq', 'docs/faq', 'nav.docs.faq'),
      p('docs-troubleshooting', 'docs/troubleshooting', 'nav.docs.troubleshooting'),
    ],
  },
  {
    page: p('open-source', 'open-source', 'nav.opensource'),
    children: [
      p('status', 'open-source/status', 'nav.opensource.status'),
      p('contributing', 'open-source/contributing', 'nav.opensource.contributing'),
    ],
  },
];

/**
 * Pages that are reachable but not in the top nav: the legal set.
 *
 * They are footer-linked on every page (CCB-S3-029) rather than crowding a nav that
 * already carries five sections.
 */
export const FOOTER_PAGES: SitePage[] = [
  { key: 'legal', slug: 'legal', navKey: 'nav.legal', built: true },
  // The privacy policy carries real, code-derived text (CCB-S3-029) and is
  // therefore indexable: a policy nobody can find is not a policy.
  { key: 'legal-privacy', slug: 'legal/privacy', navKey: 'nav.legal', built: true },
  // Terms alone remain a draft. The commercial tier is not settled, and the page
  // says so rather than inventing terms a visitor could rely on, so it stays out
  // of the index until real ones are published.
  { key: 'legal-terms', slug: 'legal/terms', navKey: 'nav.legal', built: true, noindex: true },
];

/** Every page the site serves, excluding home. */
export const SITE_PAGES: SitePage[] = [
  ...SECTIONS.flatMap((s) => [s.page, ...s.children]),
  ...FOOTER_PAGES,
];

/** Top-level nav entries (home plus the five section overviews). */
export const NAV_PAGES: SitePage[] = [HOME, ...SECTIONS.map((s) => s.page)];

const BY_SLUG = new Map(SITE_PAGES.map((x) => [x.slug, x]));
const BY_KEY = new Map<string, SitePage>([
  [HOME.key, HOME],
  ...SITE_PAGES.map((x) => [x.key, x] as [string, SitePage]),
]);

/** Look up a page by slug ('' is home, handled by the caller). */
export function pageBySlug(slug: string): SitePage | undefined {
  return BY_SLUG.get(slug);
}

export function pageByKey(key: string): SitePage | undefined {
  return BY_KEY.get(key);
}

/** The path for a page in a locale — `/en` for home, `/en/platform` otherwise. */
export function pagePath(locale: string, page: SitePage): string {
  return page.slug ? `/${locale}/${page.slug}` : `/${locale}`;
}

/** The section a page belongs to, if any. A section's own overview belongs to it. */
export function sectionOf(page: SitePage): SiteSection | undefined {
  return SECTIONS.find((s) => s.page.key === page.key || s.children.some((c) => c.key === page.key));
}

/**
 * Previous and next within a section, so the site can be read through rather than
 * only jumped into. The section overview is the first stop, so the walk is
 * `[overview, ...children]` and the ends are open rather than wrapping: wrapping
 * would send a reader who finished the last page back to the top with no signal
 * that they had finished.
 */
export function neighbours(page: SitePage): { prev?: SitePage | undefined; next?: SitePage | undefined } {
  const section = sectionOf(page);
  if (!section) return {};
  const walk = [section.page, ...section.children];
  const i = walk.findIndex((x) => x.key === page.key);
  if (i < 0) return {};
  return { prev: walk[i - 1], next: walk[i + 1] };
}

/**
 * The breadcrumb trail for a page, excluding home (the renderer prepends it).
 *
 * A section overview gets a one-item trail, which the renderer suppresses: a
 * breadcrumb that only repeats the page's own title is noise.
 */
export function breadcrumbs(page: SitePage): SitePage[] {
  const section = sectionOf(page);
  if (!section) return page.key === HOME.key ? [] : [page];
  return section.page.key === page.key ? [page] : [section.page, page];
}
