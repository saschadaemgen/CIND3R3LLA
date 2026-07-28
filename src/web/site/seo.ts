/**
 * Marketing-site SEO (CCB-S2-012) — per-page `<head>` metadata + JSON-LD + hreflang,
 * modelled on the archive front's CCB-S2-004 machinery but for a static multi-page,
 * multi-language site (no consent-gated data flows through here).
 *
 * The home page is indexable; thin "coming soon" stubs are `noindex, follow` (crawl
 * the links, don't index the placeholder). JSON-LD emits Organization + WebSite +
 * SoftwareApplication for the suite, with stable @ids cross-linked by publisher.
 */

import type { LocaleSet } from './i18n.js';
import { HOME, SITE_PAGES, pagePath, type SitePage } from './pages.js';
import { contentFor } from './content.js';

/** Canonical project links (not translatable). */
export const GITHUB_URL = 'https://github.com/saschadaemgen/cinderella';
export const LICENSE_URL = 'https://www.gnu.org/licenses/agpl-3.0.html';
/** The public SimpleX group (CCB-S3-037 2). */
export const SIMPLEX_GROUP_URL =
  'https://smp15.simplex.im/g#O6P1s2earUQKND1Gdn4-g8objkdMyhQXS1Ba8hxQzNA';

export const CONTACT_EMAIL = 'cind3rella@cind3r3lla.com';

/** JSON for a <script type="application/ld+json"> — escape `<` so text can't break out. */
function ldJson(v: unknown): string {
  return JSON.stringify(v).replace(/</g, '\\u003c');
}

const XML_RE = /[&<>"']/g;
const XML_ESC: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&apos;',
};
function xml(v: string): string {
  return v.replace(XML_RE, (c) => XML_ESC[c] ?? c);
}

export interface SiteAlternate {
  hreflang: string;
  href: string;
}

export interface SiteSeoHead {
  title: string;
  description: string;
  canonicalUrl: string;
  robots: string;
  ogTitle: string;
  ogDescription: string;
  ogType: string;
  ogSiteName: string;
  ogLocale: string;
  ogUrl: string;
  twitterCard: string;
  /** hreflang alternates including x-default ('' href never emitted). */
  alternates: SiteAlternate[];
  /** Serialized JSON-LD @graph. */
  jsonLd: string;
}

export interface SiteSeoContext {
  origin: string;
  locale: string;
  locales: LocaleSet;
  page: SitePage;
  t: (key: string, vars?: Record<string, string | number>) => string;
}

/**
 * hreflang alternates (CCB-S3-037 1).
 *
 * The site ships one language now, and hreflang for a single language says
 * nothing a crawler cannot already see from the page. Emitting a lone
 * `hreflang="en"` plus an `x-default` pointing at the same URL is noise at best
 * and a contradiction at worst. Returns empty, and the head renders nothing.
 *
 * The MACHINERY stays: this is a content decision, not an architectural one, and
 * a second locale file reinstates the alternates by making this list non-empty.
 */
function alternatesFor(c: SiteSeoContext): SiteAlternate[] {
  if (c.locales.codes.length < 2) return [];
  const alts: SiteAlternate[] = c.locales.codes.map((code) => ({
    hreflang: code,
    href: `${c.origin}${pagePath(code, c.page)}`,
  }));
  alts.push({ hreflang: 'x-default', href: `${c.origin}${pagePath(c.locales.default, c.page)}` });
  return alts;
}

export function resolveSiteHead(c: SiteSeoContext): SiteSeoHead {
  // A page with authored content carries its own title and description in the
  // language it was written in (CCB-S3-030). The locale files remain the source for
  // the pages that predate the content module, and `t()` returns the key itself when
  // it is missing, so falling back to the content is what stops a raw
  // `meta.platform-npcs.title` reaching a <title> tag.
  const authored = contentFor(c.page.key, c.locale);
  const metaTitle = c.t(`meta.${c.page.key}.title`);
  const metaDesc = c.t(`meta.${c.page.key}.description`);
  //
  // NO RAW KEY MAY EVER REACH THE PAGE (CCB-S3-034). `t()` returns the key itself
  // when it is missing, which put `meta.contributing.title` in a browser tab. The
  // fix is structural rather than 34 new strings in 40 locale files: resolve in
  // order, and end on something that cannot be missing. The nav label exists for
  // every page in the tree by construction, so the last step always resolves.
  const titleMissing = metaTitle === `meta.${c.page.key}.title`;
  const descMissing = metaDesc === `meta.${c.page.key}.description`;
  const brand = c.t('brand.name');
  const title = !titleMissing
    ? metaTitle
    : authored
      ? `${authored.title} · ${brand}`
      : `${c.t(c.page.navKey)} · ${brand}`;
  const description = !descMissing
    ? metaDesc
    : authored
      ? authored.description
      : c.t('meta.home.description');
  const canonicalUrl = `${c.origin}${pagePath(c.locale, c.page)}`;
  // Built pages are indexable; thin stubs AND draft legal texts are noindex (still
  // followable) so placeholders don't dilute the index while links stay crawlable.
  const robots = c.page.built && !c.page.noindex ? 'index, follow' : 'noindex, follow';
  const ogLocale = c.locales.meta[c.locale]?.ogLocale ?? 'en_US';
  const siteName = c.t('brand.name');

  return {
    title,
    description,
    canonicalUrl,
    robots,
    ogTitle: title,
    ogDescription: description,
    ogType: 'website',
    ogSiteName: siteName,
    ogLocale,
    ogUrl: canonicalUrl,
    twitterCard: 'summary_large_image',
    alternates: alternatesFor(c),
    jsonLd: buildSiteJsonLd(c),
  };
}

function buildSiteJsonLd(c: SiteSeoContext): string {
  const org = {
    '@type': 'Organization',
    '@id': `${c.origin}/#org`,
    name: c.t('brand.name'),
    url: c.origin,
    sameAs: [GITHUB_URL],
  };
  const website = {
    '@type': 'WebSite',
    '@id': `${c.origin}/#website`,
    name: c.t('brand.name'),
    url: c.origin,
    inLanguage: c.locale,
    publisher: { '@id': `${c.origin}/#org` },
  };
  const app = {
    '@type': 'SoftwareApplication',
    '@id': `${c.origin}/#app`,
    name: c.t('brand.name'),
    applicationCategory: 'CommunicationApplication',
    operatingSystem: 'Linux',
    description: c.t('meta.home.description'),
    url: c.origin,
    license: LICENSE_URL,
    offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD' },
    publisher: { '@id': `${c.origin}/#org` },
  };
  return ldJson({ '@context': 'https://schema.org', '@graph': [org, website, app] });
}

/**
 * Sitemap for the marketing site: the indexable (built) pages, one entry per locale,
 * each with xhtml:link hreflang alternates. Referenced from the origin sitemap index.
 */
export function buildSiteSitemapXml(origin: string, locales: LocaleSet): string {
  const built = [HOME, ...SITE_PAGES].filter((p) => p.built && !p.noindex);
  const multi = locales.codes.length > 1;
  const urls: string[] = [];
  for (const page of built) {
    for (const code of locales.codes) {
      // One language means no alternates to declare (CCB-S3-037 1). The loop and
      // the xhtml namespace stay, so adding a locale file restores them.
      const links = multi
        ? '\n' +
          [
            ...locales.codes.map(
              (alt) =>
                `    <xhtml:link rel="alternate" hreflang="${xml(alt)}" href="${xml(`${origin}${pagePath(alt, page)}`)}"/>`,
            ),
            `    <xhtml:link rel="alternate" hreflang="x-default" href="${xml(`${origin}${pagePath(locales.default, page)}`)}"/>`,
          ].join('\n')
        : '';
      urls.push(`  <url>\n    <loc>${xml(`${origin}${pagePath(code, page)}`)}</loc>${links}\n  </url>`);
    }
  }
  return (
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">\n` +
    `${urls.join('\n')}\n</urlset>\n`
  );
}

export { HOME };
