/**
 * verify:site (CCB-S2-012) — exercises the public marketing website against the REAL
 * Fastify server (via inject) on a real PGlite database. Proves: per-language routing
 * + negotiation + persistence, hreflang/SEO head, indexable site vs noindex admin,
 * the discreet login, clean stubs (no 404s), and the three building blocks shipping
 * OFF by default — with analytics consent-gated (no tracking before the banner) and
 * social share being script-free links.
 *
 * DEV harness only. No secrets, placeholder data.
 */

import { mkdtempSync, writeFileSync, copyFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { buildServer } from '../src/web/server.js';
import { loadMigrationFiles } from '../src/db/migrate.js';
import { SettingsService } from '../src/settings/service.js';
import { SecurityService } from '../src/security/settings.js';
import { SiteService } from '../src/site/settings.js';
import { loadLocales, type LocaleSet } from '../src/web/site/i18n.js';
import { isPublicSitePath } from '../src/web/site/routes.js';
import { NAV_SECTIONS, SECTIONS, SITE_PAGES } from '../src/web/site/pages.js';
import type { Queryable } from '../src/db/pool.js';
import type { AdminConfig, Config } from '../src/config.js';

let failures = 0;
function check(name: string, cond: boolean, extra = ''): void {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${cond ? '' : `  — ${extra}`}`);
  if (!cond) failures++;
}

const ORIGIN = 'https://cinderella.example.test';

async function main(): Promise<void> {
  const pg = new PGlite();
  const db: Queryable = {
    async query(text, values) {
      const res = await pg.query(text, values ? [...values] : undefined);
      return {
        rows: res.rows as never[],
        rowCount: (res.affectedRows ?? res.rows.length) as number,
      };
    },
  };
  for (const m of await loadMigrationFiles()) await pg.exec(m.sql);

  // --- Locale loader (adding a language is a FILE) ---
  const locales = loadLocales('locales');
  check('i18n: en + de loaded, en default first', locales.codes[0] === 'en' && locales.has('de'));
  check('i18n: t resolves a real string', locales.t('en', 'hero.title1').length > 10);
  check(
    'i18n: de differs from en (translated)',
    locales.t('de', 'hero.title1') !== locales.t('en', 'hero.title1'),
  );
  check(
    'i18n: missing key falls back to the key',
    locales.t('en', 'no.such.key') === 'no.such.key',
  );
  check('i18n: unknown locale is not supported', !locales.has('xx'));
  check(
    'i18n: 40 locales loaded (D-030), all with endonym + ogLocale',
    locales.codes.length === 40 &&
      locales.codes.every((c) => !!locales.meta[c]?.name && !!locales.meta[c]?.ogLocale),
  );
  check(
    'i18n: RTL locales carry dir=rtl',
    ['ar', 'he', 'fa'].every((c) => locales.meta[c]?.dir === 'rtl'),
  );

  // --- Loader resilience (CCB-S2-012 review): a bad locale file must NOT crash the
  // process (this one process also hosts the admin console + capture worker). ---
  const tmp = mkdtempSync(join(tmpdir(), 'cin-locales-'));
  copyFileSync('locales/en.json', join(tmp, 'en.json'));
  writeFileSync(join(tmp, 'de.json'), '{ "hero.title": "kaputt", }'); // trailing comma = invalid
  let resilient: LocaleSet | null = null;
  try {
    resilient = loadLocales(tmp);
  } catch {
    resilient = null;
  }
  check('resilience: a malformed non-primary locale does NOT throw', resilient !== null);
  check(
    'resilience: en still loads, the broken de is skipped',
    !!resilient && resilient.has('en') && !resilient.has('de'),
  );
  // A mis-cased file name is normalized to lowercase so negotiation can match it.
  const tmp2 = mkdtempSync(join(tmpdir(), 'cin-locales2-'));
  copyFileSync('locales/en.json', join(tmp2, 'en.json'));
  copyFileSync('locales/de.json', join(tmp2, 'De.json'));
  const cased = loadLocales(tmp2);
  check('resilience: mis-cased De.json is normalized to code "de"', cased.has('de'));
  // A missing primary is synthesized (empty) rather than crashing the whole product.
  const tmp3 = mkdtempSync(join(tmpdir(), 'cin-locales3-'));
  const synth = loadLocales(tmp3);
  check(
    'resilience: missing primary is synthesized (no throw, t() degrades to key ids)',
    synth.has('en') && synth.t('en', 'hero.title') === 'hero.title',
  );

  // --- Public-path predicate ---
  const codes = locales.codes;
  check('predicate: / is public', isPublicSitePath('/', codes));
  check('predicate: /en is public', isPublicSitePath('/en', codes));
  check('predicate: /en/platform is public', isPublicSitePath('/en/platform', codes));
  check('predicate: /en/legal/privacy is public', isPublicSitePath('/en/legal/privacy', codes));
  check('predicate: /sitemap-site.xml is public', isPublicSitePath('/sitemap-site.xml', codes));
  check('predicate: /messages is NOT public (admin)', !isPublicSitePath('/messages', codes));
  check('predicate: /dashboard is NOT public (admin)', !isPublicSitePath('/dashboard', codes));
  check('predicate: /website is NOT public (admin config)', !isPublicSitePath('/website', codes));

  const adminCfg: AdminConfig = {
    adminPort: 0,
    adminUsername: 'operator',
    adminPasswordHash: 'x',
    sessionSecret: 'verify-site-session-secret-0123456789abcdef01',
    publicOrigin: ORIGIN,
    rpId: 'cinderella.example.test',
    webauthnOrigin: ORIGIN,
    rpName: 'Cinderella',
  };
  const cfg: Config = {
    botDisplayName: 'Cinderella',
    simplexDbPrefix: './state/simplex/cinderella',
    simplexFilesFolder: './state/files',
    groupName: 'test',
    mediaRoot: process.cwd(),
    avatarPath: '',
    databaseUrl: 'postgres://x',
    logLevel: 'error',
  };
  const settings = await SettingsService.load(db, cfg.logLevel);
  const security = await SecurityService.load(db);
  const site = await SiteService.load(db); // all OFF initially
  const app = buildServer({
    db,
    adminCfg,
    cfg,
    settings,
    security,
    site,
    mediaRoot: cfg.mediaRoot,
  });
  await app.ready();

  // --- Root negotiation + persistence ---
  const rootDefault = await app.inject({ method: 'GET', url: '/' });
  check(
    'root: / redirects to the default language (/en)',
    rootDefault.statusCode === 302 && rootDefault.headers.location === '/en',
    `status=${rootDefault.statusCode} loc=${rootDefault.headers.location}`,
  );
  const rootAL = await app.inject({
    method: 'GET',
    url: '/',
    headers: { 'accept-language': 'de-DE,de;q=0.9' },
  });
  check('root: Accept-Language de → /de', rootAL.headers.location === '/de');
  const rootCookie = await app.inject({
    method: 'GET',
    url: '/',
    headers: { 'accept-language': 'en', cookie: 'cin-lang=de' },
  });
  check('root: cin-lang cookie wins over Accept-Language', rootCookie.headers.location === '/de');

  // --- Localized landing pages ---
  const en = await app.inject({ method: 'GET', url: '/en' });
  const de = await app.inject({ method: 'GET', url: '/de' });
  check('en: 200 + <html lang="en">', en.statusCode === 200 && en.body.includes('<html lang="en"'));
  check('de: 200 + <html lang="de">', de.statusCode === 200 && de.body.includes('<html lang="de"'));
  check('en: renders the English hero title', en.body.includes(locales.t('en', 'hero.title1')));
  check('de: renders the German hero title', de.body.includes(locales.t('de', 'hero.title1')));
  check(
    'lang: /en persists the choice (Set-Cookie cin-lang=en)',
    String(en.headers['set-cookie'] ?? '').includes('cin-lang=en'),
  );
  check('switcher: /en links to /de', en.body.includes('href="/de"'));
  check('login: discreet operator-login button links to /login', en.body.includes('href="/login"'));
  check(
    'nav: main template pages linked',
    en.body.includes('/en/platform') &&
      en.body.includes('/en/security') &&
      en.body.includes('/en/legal'),
  );

  // ── Every page in the tree is real (CCB-S3-030) ────────────────────────────
  //
  // The acceptance criterion is "no lorem, no stubs, no dead links", so this
  // walks the catalog rather than sampling it. The catalog is the same object the
  // nav, the breadcrumbs, the sitemap and the route table are built from, so a
  // page cannot pass here and be missing from one of those.
  const treePages = SITE_PAGES.filter((x) => !x.slug.startsWith('legal'));
  const missing: string[] = [];
  const noMeta: string[] = [];
  for (const page of treePages) {
    for (const loc of ['en', 'de']) {
      const res = await app.inject({ method: 'GET', url: `/${loc}/${page.slug}` });
      if (res.statusCode !== 200) {
        missing.push(`/${loc}/${page.slug} -> ${String(res.statusCode)}`);
        continue;
      }
      // A raw `meta.<key>.title` in a <title> means the page has no authored
      // content and no locale entry: exactly the "stub with a real URL" the
      // briefing forbids.
      // Structural, not textual. This used to look for the stub BADGE TEXT, and
      // when the Demo control started saying "Coming soon" on every page, every
      // page looked like a stub (CCB-S3-036).
      if (res.body.includes(`meta.${page.key}.`) || res.body.includes('class="stub-cta"')) {
        noMeta.push(`/${loc}/${page.slug}`);
      }
    }
  }
  check(
    `tree: all ${String(treePages.length)} pages answer 200 in EN and DE`,
    missing.length === 0,
    missing.slice(0, 4).join(', '),
  );
  // CCB-S3-030 lands in passes (the briefing allows the split explicitly). The
  // tree is complete from pass one, so a page in a section that has not been
  // written yet renders the clean stub rather than a 404. This list SHRINKS as
  // passes land; it is not a way to switch the check off.
  const WRITTEN_SECTIONS = ['platform'];
  const shouldHaveContent = noMeta.filter((u) =>
    WRITTEN_SECTIONS.some((sec) => u.startsWith(`/en/${sec}`) || u.startsWith(`/de/${sec}`)),
  );
  check(
    'tree: no page in a WRITTEN section falls back to a stub or an unresolved meta key',
    shouldHaveContent.length === 0,
    shouldHaveContent.slice(0, 4).join(', '),
  );
  if (noMeta.length > 0) {
    console.log(
      `      note: ${String(noMeta.length / 2)} page(s) still awaiting copy in a later pass`,
    );
  }

  const platform = await app.inject({ method: 'GET', url: '/en/platform' });
  check(
    'tree: a section overview is 200 and indexable',
    platform.statusCode === 200 && platform.body.includes('name="robots" content="index'),
  );
  // CCB-S3-034: every entry is present as INERT TEXT, not a link. The menu is what
  // shows the shape of the platform, so nothing is dropped while the individual
  // pages are commissioned; but an entry that goes nowhere must not look like it
  // does, and must not be a tab stop.
  const menuEntryCount = NAV_SECTIONS.reduce((n, sec) => n + sec.children.length + 1, 0);
  check(
    `nav: all ${String(menuEntryCount)} entries of the four nav sections are in the menu`,
    NAV_SECTIONS.every((sec) =>
      [locales.t('en', 'nav.overview'), ...sec.children.map((c) => locales.t('en', c.navKey))].every(
        (label) => platform.body.includes(`class="cme-label">${label}</span>`),
      ),
    ),
  );
  check(
    'nav: Open Source is NOT in the navigation, and its pages still answer',
    !platform.body.includes('data-section="open-source"') &&
      (await app.inject({ method: 'GET', url: '/en/open-source/status' })).statusCode === 200 &&
      (await app.inject({ method: 'GET', url: '/en/open-source/contributing' })).statusCode === 200,
  );
  check(
    'nav: Roadmap is in the utility rail and Contributing in the footer',
    platform.body.includes(`/en/open-source/status`) &&
      platform.body.includes(`/en/open-source/contributing`),
  );
  check(
    'header: two tiers, with the rail carrying login and the language switcher',
    platform.body.includes('class="rail"') &&
      platform.body.includes('rail-login') &&
      platform.body.includes('lang-menu'),
  );
  check(
    'header: the Demo control is the only control left in the main bar',
    /class="hdr-controls">\s*<(a|span) class="dm/.test(platform.body),
  );
  check(
    'demo: clipped, and carries the raster, the scanline and the glitch label',
    platform.body.includes('dm-raster') &&
      platform.body.includes('dm-scan') &&
      platform.body.includes('dm-label'),
  );
  check(
    'menu: the admin three-column shape, with an intro and a description per entry',
    platform.body.includes('cn-menu-intro') &&
      platform.body.includes('cn-menu-heading') &&
      platform.body.includes('cn-menu-desc') &&
      (platform.body.match(/cme-desc/g) ?? []).length >= menuEntryCount - 4,
  );
  check(
    'nav: entries are inert, so none of them is a link or a tab stop',
    !/<a[^>]*class="np-item/.test(platform.body) && !/np-item[^"]*"[^>]*href=/.test(platform.body),
  );
  // CCB-S3-035: the dropdown panels are gone. One fullscreen menu carries every
  // section, in the admin console's design language, so overlapping panels are not
  // a state the markup can reach.
  check(
    'nav: one fullscreen menu, no per-item dropdown panels',
    platform.body.includes('id="cn-menu"') &&
      !platform.body.includes('nav-sub') &&
      !platform.body.includes('nav-panel'),
  );
  check(
    'nav: the menu groups every NAVIGABLE section',
    NAV_SECTIONS.every((sec) => platform.body.includes(`data-section="${sec.page.key}"`)),
  );
  check(
    'nav: exactly one travelling indicator, not an underline per item',
    (platform.body.match(/class="nav-indicator" data-nav-indicator/g) ?? []).length === 1,
  );
  // Each entry's contents must be plain text: no badge, no "soon", no dimming
  // element. A menu full of pending-labels reads as a product that does not work.
  // The entry is icon + label + description now (the admin shape), so nesting is
  // expected. What must not appear is a badge or a pending label.
  check(
    'nav: no badge or "soon" label decorates a menu entry',
    !/cn-menu-entry[\s\S]{0,400}?cn-badge/.test(platform.body) &&
      !/cme-label[^<]*<[^>]*>\s*(soon|coming|planned|bald)/i.test(platform.body),
  );
  const deep = await app.inject({ method: 'GET', url: '/en/platform/consent-archive' });
  check(
    'nav: a sub-page still marks its section as current',
    deep.body.includes('nav-section active'),
  );
  check(
    'breadcrumbs: a sub-page shows a trail through its section',
    deep.body.includes('class="wrap crumbs"') && deep.body.includes('href="/en/platform"'),
  );
  check(
    'breadcrumbs: a section overview shows none (it would only repeat itself)',
    !platform.body.includes('class="wrap crumbs"'),
  );
  check(
    'prev/next: a sub-page links back to its section and on to the next page',
    deep.body.includes('rel="prev"') && deep.body.includes('rel="next"'),
  );
  const lastOfSection = await app.inject({
    method: 'GET',
    url: '/en/platform/administration',
  });
  check(
    'prev/next: the last page of a section has no next (the ends do not wrap)',
    lastOfSection.body.includes('rel="prev"') && !lastOfSection.body.includes('rel="next"'),
  );
  // One menu at every width now, so there is no separate drawer to diverge.
  check(
    'mobile: the same fullscreen menu serves every width',
    deep.body.includes('id="cn-menu"') && !deep.body.includes('cn-mobile-menu'),
  );
  // The hero specifically (CCB-S3-035 §1). It appeared twice, in the chip and in
  // the feature row, on a marketing page for something nobody can obtain.
  const heroOf = (body: string): string => {
    const a = body.indexOf('hero-cine');
    const b = body.indexOf('</section>', a);
    return a < 0 ? '' : body.slice(a, b);
  };
  check(
    'hero: the words "in development" appear nowhere in the hero',
    heroOf(en.body).length > 200 &&
      !/in development/i.test(heroOf(en.body)) &&
      !/in Entwicklung/i.test(heroOf(de.body)),
  );
  const secPage = await app.inject({ method: 'GET', url: '/en/security' });
  check(
    'hero: and the honest screening detail is still on the Security page',
    /in development/i.test(secPage.body),
  );
  // The demo chip is gone entirely (CCB-S3-034). It returns when the demo exists.
  check(
    'demo: no demo chip anywhere in the header',
    !deep.body.includes('nav-demo') && !deep.body.includes('demo.cind3r3lla'),
  );
  const proDe = await app.inject({ method: 'GET', url: '/de/pro' });
  check(
    'i18n: German is authored, not a fallback notice',
    proDe.statusCode === 200 &&
      proDe.body.includes('<html lang="de"') &&
      !proDe.body.includes(locales.t('de', 'i18n.fallback')),
  );
  const frPage = await app.inject({ method: 'GET', url: '/fr/platform' });
  check(
    'i18n: a third locale falls back to English and SAYS so',
    frPage.statusCode === 200 && frPage.body.includes(locales.t('fr', 'i18n.fallback')),
  );
  check(
    'footer: legal links on every page',
    deep.body.includes('/en/legal/privacy') && deep.body.includes('/en/legal/terms'),
  );
  // CCB-S3-035 §1 removed the hero disclaimer, so this now measures what it always
  // meant to: wherever a page actually CLAIMS screening, that claim carries the
  // marker. The stub pages match nothing because they make no claim; the phrase
  // used to reach them only through the header announcement, which is gone.
  const csamUnmarked: string[] = [];
  for (const page of treePages) {
    const res = await app.inject({ method: 'GET', url: `/en/${page.slug}` });
    const body = res.body;
    // Only the visible document, never the <head>: a meta description is not a
    // place a marker can be read.
    const visible = body.slice(body.indexOf('<body'));
    if (!/CSAM|child sexual abuse/i.test(visible)) continue;
    if (!/in development|in Entwicklung|planned/i.test(visible)) csamUnmarked.push(page.slug);
  }
  check(
    'honesty: wherever a page claims screening, the claim is marked in development',
    csamUnmarked.length === 0,
    csamUnmarked.join(', '),
  );

  // ── The legal pages carry REAL operator data (CCB-S3-029) ──────────────────
  //
  // These assertions are deliberately blunt: they name the operator's actual
  // details and they sweep every legal page in every locale for the bracketed
  // placeholder syntax the site used to ship. A German site with a wrong
  // Impressum is directly actionable, so "no placeholder survived" is checked
  // mechanically rather than by eye.
  const legal = await app.inject({ method: 'GET', url: '/en/legal' });
  check(
    'legal: 200 + indexable + real operator identity',
    legal.statusCode === 200 &&
      legal.body.includes('name="robots" content="index') &&
      legal.body.includes('Sascha D') &&
      legal.body.includes('Am Neumarkt 22') &&
      legal.body.includes('45663') &&
      legal.body.includes('Recklinghausen'),
  );
  check(
    'legal: real telephone number and business email',
    legal.body.includes('+49 2361 9702434') && legal.body.includes('info@it-and-more.systems'),
  );
  check(
    'legal: Youth Protection Officer present (voluntary wording)',
    legal.body.includes('Eike Keller') &&
      legal.body.includes('e.keller@simplego.dev') &&
      legal.body.includes('voluntarily'),
  );
  check(
    'legal: the archive contact address is present',
    legal.body.includes('cind3rella@cind3r3lla.com'),
  );
  // The operator asked twice that no tax or economic id appear. Assert its absence
  // so a later "completeness" edit cannot quietly add one back.
  check(
    'legal: NO tax / VAT / economic identification number',
    !/USt-IdNr|Umsatzsteuer|VAT ID|Wirtschafts-Identifikationsnummer/i.test(legal.body),
  );

  const legalDe = await app.inject({ method: 'GET', url: '/de/legal' });
  check(
    'legal: the binding German Impressum renders, with its statutory headings',
    legalDe.statusCode === 200 &&
      legalDe.body.includes('Angaben gem') &&
      legalDe.body.includes('5 DDG') &&
      legalDe.body.includes('18 Abs. 2 MStV') &&
      legalDe.body.includes('Jugendschutzbeauftragter'),
  );
  check(
    'legal: German carries NO convenience-translation notice (it IS the binding text)',
    !legalDe.body.includes('convenience translation'),
  );
  check(
    'legal: a non-German locale says which version binds, and links to it',
    legal.body.includes('convenience translation') && legal.body.includes('/de/legal'),
  );

  const privacy = await app.inject({ method: 'GET', url: '/en/legal/privacy' });
  check(
    'legal: privacy is 200 and now INDEXABLE (no longer a draft)',
    privacy.statusCode === 200 && privacy.body.includes('name="robots" content="index'),
  );
  check(
    'legal: privacy states the open-web consequence and the forward-only rule',
    /open web/i.test(privacy.body) && /forward-only/i.test(privacy.body),
  );
  check(
    'legal: privacy tells the truth about screening (in development, not active)',
    /in development/i.test(privacy.body) &&
      /no such screening runs today|No detection provider is connected/i.test(privacy.body),
  );
  check(
    'legal: privacy states hiding is never deferred by a hold',
    /never deferred/i.test(privacy.body),
  );
  // Retention (CCB-S3-029 Addendum A): the ten-year ceiling is operator POLICY, and
  // stating it is fine. What must never be dropped is the sentence admitting the
  // limit is enforced by hand, because the code implements no expiry whatsoever.
  check(
    'legal: privacy states the ten-year ceiling',
    /maximum of ten years/i.test(privacy.body),
  );
  check(
    'legal: and admits in its own sentence that the limit is applied MANUALLY',
    /applied manually/i.test(privacy.body) && /[Aa]utomated expiry is planned/.test(privacy.body),
  );
  check(
    'legal: privacy claims no theme preference (dark is the only theme)',
    !/theme preference/i.test(privacy.body),
  );

  // ── The rights section (Addendum A Part 2) ─────────────────────────────────
  //
  // These assertions exist because the honest version of this section is longer
  // and less flattering than the comfortable one, and every deleted sentence
  // below was a real temptation. Each check pins a fact a 50-agent code read
  // established, so a later edit toward brevity cannot quietly restore a promise
  // the system does not keep.
  check(
    'rights: the in-chat route comes FIRST and is named as costing the member nothing',
    privacy.body.indexOf('costs you nothing') > 0 &&
      privacy.body.indexOf('costs you nothing') < privacy.body.indexOf('what it costs you'),
  );
  check(
    'rights: the anonymity cost of email is stated in the member’s interest',
    /necessarily learn a connection between your email address/i.test(privacy.body) &&
      /designed to prevent exactly that link/i.test(privacy.body),
  );
  check(
    'rights: verification is in-band, and the email linkage is deleted after processing',
    /confirm from inside the group chat/i.test(privacy.body) &&
      /delete that correspondence once your request is closed/i.test(privacy.body),
  );
  check(
    'rights: the linkage deletion is NOT dressed up as a system control',
    /commitment we keep by hand/i.test(privacy.body) &&
      /not a control the system enforces/i.test(privacy.body),
  );
  // The bot has no private channel: no contact address, no direct send target with
  // a production implementation, no token. The token route must read as planned.
  check(
    'rights: the one-time code is PLANNED, never offered as available',
    /planned, not available/i.test(privacy.body) &&
      /does not exist yet/i.test(privacy.body) &&
      !/we will send you a (one-time )?code|use the code we sent/i.test(privacy.body),
  );
  check(
    'rights: both identity-loss cases are covered separately',
    /still hold your SimpleX identity/i.test(privacy.body) &&
      /lost your SimpleX identity altogether/i.test(privacy.body),
  );
  check(
    'rights: rejoining yields a NEW identity, and the policy says the old content is out of reach',
    /rejoining gives you a new member identity/i.test(privacy.body),
  );
  check(
    'rights: knowledge of PUBLISHED content is explicitly not proof of authorship',
    /Knowing what was published proves nothing/i.test(privacy.body),
  );
  check(
    'rights: unpublished content is named as the only meaningful evidence',
    /never published are known to you and to us alone/i.test(privacy.body),
  );
  check(
    'rights: an unverifiable ERASURE request leads to restriction, not refusal',
    /request for restriction under Art\. 18/i.test(privacy.body) &&
      /do not treat an unverifiable erasure request as a refusal/i.test(privacy.body),
  );
  check(
    'rights: an unverifiable ACCESS request is refused, and the asymmetry is explained',
    /the answer to an access request is no, and it stays no/i.test(privacy.body),
  );
  // The operator console has no hard-destruction route: /messages/:id/delete sets a
  // reversible flag. The policy must not imply the operator can erase on request.
  check(
    'rights: the policy admits destruction is NOT something the operator can perform',
    /only route in this system that actually destroys content is the one you drive yourself/i.test(
      privacy.body,
    ),
  );
  check(
    'rights: the chat’s actual limits are listed, not glossed',
    /cannot do today/i.test(privacy.body) && /no route from hidden to destroyed/i.test(privacy.body),
  );

  const privacyDe = await app.inject({ method: 'GET', url: '/de/legal/privacy' });
  check(
    'rights: the BINDING German version carries the same substance',
    privacyDe.statusCode === 200 &&
      /höchstens zehn Jahre/i.test(privacyDe.body) &&
      /manuell durchgesetzt/i.test(privacyDe.body) &&
      /geplant, aber nicht verfügbar/i.test(privacyDe.body) &&
      /Einschränkung der Verarbeitung nach Art\. 18 DSGVO/i.test(privacyDe.body) &&
      /beweist nichts/i.test(privacyDe.body) &&
      /neue Mitgliedskennung/i.test(privacyDe.body),
  );
  check(
    'legal: privacy does not overclaim erasure',
    !/unrecoverable/i.test(privacy.body.replace(/We do not use the word[^<]*/g, '')),
  );

  const terms = await app.inject({ method: 'GET', url: '/de/legal/terms' });
  check(
    'legal: German terms page is 200 and still marked a draft',
    terms.statusCode === 200 && terms.body.includes(locales.t('de', 'legal.badge.draft')),
  );
  check(
    'legal: terms says plainly that none are in force, rather than inventing any',
    /keine eigenen Allgemeinen Gesch/i.test(terms.body),
  );

  // The sweep. Every legal page, in every locale the site ships, must be free of
  // the `[bracketed]` placeholder the pages used to carry.
  const placeholderPages: string[] = [];
  for (const loc of locales.codes) {
    for (const slug of ['legal', 'legal/privacy', 'legal/terms']) {
      const res = await app.inject({ method: 'GET', url: `/${loc}/${slug}` });
      const body = res.body;
      if (
        body.includes('class="ph"') ||
        /\[(?:date|Street|Postal|Country|Operator|Liability|Hosting)[^\]]*\]/i.test(body) ||
        body.includes('example.org') ||
        body.includes('example.com')
      ) {
        placeholderPages.push(`/${loc}/${slug}`);
      }
    }
  }
  check(
    'legal: NOT ONE placeholder or demo value on any legal page, in any language',
    placeholderPages.length === 0,
    placeholderPages.slice(0, 5).join(', '),
  );

  const legalNope = await app.inject({ method: 'GET', url: '/en/legal/nope' });
  check('legal: unknown legal sub-page is 404', legalNope.statusCode === 404);

  // --- CSP: no style ATTRIBUTES anywhere (style-src nonce covers only <style>
  // elements — browsers BLOCK style attributes, which broke the header/footer
  // layout in production; CCB-S3-001 regression guard) ---
  for (const [name, res] of [
    ['home', en],
    ['platform', platform],
    ['sub-page', deep],
    ['pro', proDe],
    ['legal', legal],
    ['privacy', privacy],
    ['docs', await app.inject({ method: 'GET', url: '/en/docs' })],
  ] as const) {
    check(`csp: ${name} page renders zero style="" attributes`, !res.body.includes('style="'));
    // Operator style rule (CCB-S3-001 follow-up): the em dash is banned from
    // visible copy. Applies to every locale, enforced on the rendered output.
    check(`copy: ${name} page contains no em dash`, !res.body.includes('—'));
  }

  // --- SEO head ---
  check('seo: canonical to /en', en.body.includes(`<link rel="canonical" href="${ORIGIN}/en"`));
  check('seo: hreflang de alternate', en.body.includes(`hreflang="de" href="${ORIGIN}/de"`));
  check('seo: hreflang x-default', en.body.includes(`hreflang="x-default" href="${ORIGIN}/en"`));
  check(
    'seo: title + description present',
    en.body.includes('<title>') && en.body.includes('name="description"'),
  );
  check(
    'seo: OpenGraph + Twitter',
    en.body.includes('property="og:title"') && en.body.includes('name="twitter:card"'),
  );
  check('seo: og:locale is en_US', en.body.includes('content="en_US"'));
  check('seo: de og:locale is de_DE', de.body.includes('content="de_DE"'));
  check(
    'seo: JSON-LD Organization + WebSite + SoftwareApplication',
    en.body.includes('"Organization"') &&
      en.body.includes('"WebSite"') &&
      en.body.includes('"SoftwareApplication"'),
  );
  check('seo: home is indexable', en.body.includes('name="robots" content="index'));

  // --- The stub path still exists, but nothing in the tree reaches it ------
  //
  // /docs used to be the stub. It is a real section now (CCB-S3-030), so the
  // stub renderer is proved through a page deliberately left out of the
  // catalog instead. Keeping the proof matters: the stub is what stands
  // between a future half-added page and a 404.
  const docs = await app.inject({ method: 'GET', url: '/en/docs' });
  check('docs is a real page now, not a stub', docs.statusCode === 200);
  const docsDe = await app.inject({ method: 'GET', url: '/de/docs' });
  check(
    'docs: /de/docs is a German 200',
    docsDe.statusCode === 200 && docsDe.body.includes('<html lang="de"'),
  );
  const unknown = await app.inject({ method: 'GET', url: '/en/nope' });
  check('stub: unknown slug is 404', unknown.statusCode === 404);

  // --- Headers: site indexable + frame-DENY + nonce CSP; admin still gated ---
  const csp = String(en.headers['content-security-policy'] ?? '');
  check(
    'headers: nonce CSP (default-src none, nonce style/script, frame-ancestors none)',
    csp.includes("default-src 'none'") &&
      csp.includes("style-src 'nonce-") &&
      csp.includes("script-src 'nonce-") &&
      csp.includes("frame-ancestors 'none'"),
  );
  check(
    'headers: x-frame-options DENY + nosniff + no-store',
    en.headers['x-frame-options'] === 'DENY' &&
      en.headers['x-content-type-options'] === 'nosniff' &&
      en.headers['cache-control'] === 'no-store',
  );
  // The app is authoritative for robots policy (CCB-S2-012) so the origin nginx never
  // has to blanket-noindex the host: home is indexable at the HTTP layer, thin stubs
  // are noindex, and every admin response is noindex.
  const enRobots = String(en.headers['x-robots-tag'] ?? '');
  check(
    'headers: home is indexable (X-Robots-Tag: index, follow)',
    enRobots.includes('index') && !enRobots.includes('noindex'),
  );
  const termsHeaders = await app.inject({ method: 'GET', url: '/en/legal/terms' });
  check(
    'headers: the terms draft carries X-Robots-Tag noindex',
    String(termsHeaders.headers['x-robots-tag'] ?? '').includes('noindex'),
  );
  const adminHome = await app.inject({ method: 'GET', url: '/dashboard' });
  check(
    'admin: /dashboard still gated (302 → /login)',
    adminHome.statusCode === 302 && adminHome.headers.location === '/login',
  );
  check(
    'admin: response carries X-Robots-Tag noindex (app-authoritative)',
    String(adminHome.headers['x-robots-tag'] ?? '').includes('noindex'),
  );
  const adminCfgPage = await app.inject({ method: 'GET', url: '/website' });
  check('admin: /website config is gated (302 → /login)', adminCfgPage.statusCode === 302);

  // --- Building blocks OFF by default (no banner, no analytics, no share) ---
  check('off: no cookie banner rendered', !en.body.includes('id="cin-cookie"'));
  check('off: no analytics/consent bootstrap', !en.body.includes('cin-consent'));
  check('off: no share links', !en.body.includes('class="share-links"'));

  // --- Turn the three blocks ON (analytics consent-gated behind the banner) ---
  await site.save(
    {
      analytics: {
        enabled: true,
        provider: 'Plausible',
        scriptUrl: 'https://stats.example.test/js/s.js',
      },
      cookieBanner: { enabled: true, policyUrl: '' },
      socialShare: { enabled: true, networks: ['x', 'reddit', 'email'] },
    },
    'verify-site',
  );
  const on = await app.inject({ method: 'GET', url: '/en' });
  const onCsp = String(on.headers['content-security-policy'] ?? '');
  check('on: cookie banner rendered', on.body.includes('id="cin-cookie"'));
  check('on: consent bootstrap present', on.body.includes('cin-consent'));
  check(
    'on: analytics origin added to CSP (script-src + connect-src)',
    onCsp.includes('https://stats.example.test') &&
      onCsp.split('https://stats.example.test').length === 3,
  );
  check(
    'consent-gate: analytics NOT loaded directly (no eager <script src>)',
    !on.body.includes('<script src="https://stats.example.test'),
  );
  check(
    'consent-gate: analytics URL only inside the consent bootstrap (loads after accept)',
    on.body.includes('stats.example.test'),
  );
  check('share: links rendered', on.body.includes('class="share-links"'));
  check(
    'share: script-free — anchors to the network share endpoints, no vendor script',
    on.body.includes('twitter.com/intent/tweet') && !on.body.includes('platform.twitter.com'),
  );

  // --- Analytics requires the banner (consent mechanism) to load ---
  await site.save(
    {
      analytics: { enabled: true, provider: '', scriptUrl: 'https://stats.example.test/js/s.js' },
      cookieBanner: { enabled: false, policyUrl: '' },
      socialShare: { enabled: false, networks: [] },
    },
    'verify-site',
  );
  const noBanner = await app.inject({ method: 'GET', url: '/en' });
  const noBannerCsp = String(noBanner.headers['content-security-policy'] ?? '');
  check(
    'gate: analytics on + banner off ⇒ nothing loads (no banner, no analytics origin)',
    !noBanner.body.includes('id="cin-cookie"') &&
      !noBanner.body.includes('cin-consent') &&
      !noBannerCsp.includes('stats.example.test'),
  );

  // --- Adversarial: a hostile analytics URL cannot break out of the inline script ---
  await site.save(
    {
      analytics: {
        enabled: true,
        provider: '',
        scriptUrl: 'https://evil.example.test/a.js</script><script>x',
      },
      cookieBanner: { enabled: true, policyUrl: '' },
      socialShare: { enabled: false, networks: [] },
    },
    'verify-site',
  );
  const xss = await app.inject({ method: 'GET', url: '/en' });
  check(
    'xss: analytics URL is escaped in the inline bootstrap (no </script> breakout)',
    !xss.body.includes('a.js</script><script>x'),
  );

  // --- Sitemap ---
  const smSite = await app.inject({ method: 'GET', url: '/sitemap-site.xml' });
  check(
    'sitemap: /sitemap-site.xml lists /en + /de with hreflang',
    smSite.statusCode === 200 &&
      smSite.body.includes(`${ORIGIN}/en`) &&
      smSite.body.includes(`${ORIGIN}/de`) &&
      smSite.body.includes('xhtml:link'),
  );
  // EVERY page in the tree must be in the sitemap (CCB-S3-030), not a sample of
  // them. The sitemap and the nav are built from the same catalog, so this is what
  // proves they cannot drift apart.
  const notInSitemap = SITE_PAGES.filter(
    (x) => !x.noindex && !smSite.body.includes(`${ORIGIN}/en/${x.slug}</loc>`),
  ).map((x) => x.slug);
  check(
    'sitemap: every indexable page in the tree is listed, the terms draft is not',
    notInSitemap.length === 0 && !smSite.body.includes('/legal/terms'),
    notInSitemap.slice(0, 5).join(', '),
  );
  const smIndex = await app.inject({ method: 'GET', url: '/sitemap.xml' });
  check('sitemap: index references the site sitemap', smIndex.body.includes('/sitemap-site.xml'));

  await app.close();
  console.log('');
  if (failures > 0) {
    console.error(`verify:site FAILED (${failures})`);
    process.exit(1);
  }
  console.log('verify:site OK');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
