/**
 * Page content for the marketing site (CCB-S3-030).
 *
 * WHY THIS IS NOT IN `locales/`. The site ships 40 locales, 38 of them machine
 * translated. That is fine for a nav label and acceptable for a tagline. It is not
 * fine for thirty pages of technical and legal-adjacent argument, where a mistranslated
 * sentence about consent or deletion is worse than no sentence. So English and German
 * are authored here, side by side, both authoritative, and every other locale falls
 * back to English rather than shipping a machine translation of new copy. Same
 * decision, same reason, as the legal texts (D-079).
 *
 * `locales/*.json` keeps what it is good at: nav labels, chrome, and the short
 * strings that already exist in all 40.
 *
 * HONESTY MODEL (Part A of the briefing, decided by the operator). Pages describe
 * the platform in the present tense, without a disclaimer on every paragraph, because
 * caveating everything makes a product that genuinely runs read as vapourware. The
 * maturity table on the Status page carries the whole truth in one place. Where a
 * SPECIFIC claim would mislead if read as shipped, that claim carries
 * `status: 'in-development'` and renders a visible marker. CSAM screening is the
 * standing example and must always carry it: no provider is connected.
 */

/** A marker rendered against one claim, never against a whole section by default. */
export type ClaimStatus = 'live' | 'in-development';

export interface ContentSection {
  h: string;
  /** Paragraphs. Rendered as <p>; a newline inside one becomes a <br>. */
  body: string[];
  /** Optional highlighted line: the load-bearing claim of the section. */
  callout?: string;
  /** Optional bullet list rendered after the body. */
  list?: string[];
  /** Marks THIS claim, not the page. Renders a visible badge. */
  status?: ClaimStatus;
}

export interface PageContent {
  title: string;
  description: string;
  lede: string;
  sections: ContentSection[];
}

/** One page in both authoritative languages. */
export interface PageEntry {
  en: PageContent;
  de: PageContent;
}

/**
 * The registry. Keyed by `SitePage.key`.
 *
 * A page with no entry renders the "coming soon" stub rather than a 404, which is
 * what `built: false` already meant. Nothing in the shipped tree should rely on
 * that: the acceptance criterion for CCB-S3-030 is that every page in the
 * navigation has real content.
 */
const CONTENT = new Map<string, PageEntry>();

export function definePage(key: string, entry: PageEntry): void {
  CONTENT.set(key, entry);
}

/**
 * Content for a page in a locale.
 *
 * German for `de`, English for everything else. The renderer shows a short notice
 * on the fallback so a reader in one of the other 38 locales knows why the page is
 * in English, rather than assuming the site is broken.
 */
export function contentFor(key: string, locale: string): PageContent | undefined {
  const entry = CONTENT.get(key);
  if (!entry) return undefined;
  return locale === 'de' ? entry.de : entry.en;
}

/** True when this locale is reading a fallback rather than its own language. */
export function isFallbackLocale(locale: string): boolean {
  return locale !== 'en' && locale !== 'de';
}

export function hasContent(key: string): boolean {
  return CONTENT.has(key);
}

export function contentKeys(): string[] {
  return [...CONTENT.keys()];
}
