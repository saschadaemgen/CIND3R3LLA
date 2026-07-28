/**
 * verify:i18n-keys (CCB-S3-035 follow-up) — NO RAW TRANSLATION KEY MAY RENDER.
 *
 * `t()` returns the key itself when a string is missing, which is the right
 * degradation for a locale file with a gap and the wrong thing to ship. A literal
 * `hero.chip.csam` reached the live hero because one change deleted the key from
 * all 40 locales while the call site in `render.ts` stayed. Nothing failed. The
 * guard that existed at the time covered `meta.<page>.title|description` in the SEO
 * head and no body copy at all, under a comment claiming it covered everything.
 *
 * WHY THIS SWEEPS RENDERED PAGES RATHER THAN COMPARING KEY LISTS.
 *
 * The obvious check is "every key a template calls exists in every locale". It
 * would not have caught this. The call site is inside a template literal, so a
 * static scan has to parse TypeScript to find it, and the failure mode that
 * actually happened is a DELETED key, which is invisible to any check that starts
 * from the set of keys that exist. Rendering the page and looking at what a visitor
 * would see is the only check that cannot be fooled by where the call lives.
 *
 * HOW A RAW KEY IS RECOGNISED.
 *
 * Not by shape alone: real copy is full of dotted tokens (`cind3r3lla.com`,
 * `AGPL-3.0`, `e.g.`, `poststelle@ldi.nrw.de`), and a shape-only rule would either
 * drown in false positives or be tuned until it caught nothing. Instead the first
 * segment must be one of the NAMESPACES the locale files actually use, derived from
 * `locales/en.json` at run time rather than hard-coded. That survives the deletion
 * case: `hero.chip.csam` can vanish from every locale and `hero` remains a real
 * namespace, so the token is still recognised. It also cannot rot, because adding a
 * namespace to the locale files adds it here for free.
 *
 * SCOPE: every page in the catalog, in EVERY locale. A key can be present in
 * English and missing in Turkish, and the operator reads the site in German.
 *
 * ── AND THE REVERSE ─────────────────────────────────────────────────────────
 *
 * The fault was a deleted key with a surviving call site. The mirror image is a
 * surviving key with a deleted call site, and a rename produces one or the other
 * depending on which side the change lands on. Checking only one direction means a
 * rename is caught half the time. So the second phase finds keys that exist in the
 * locale files and are called from nowhere.
 *
 * That direction is the one that goes wrong if done naively: most keys here are NOT
 * called as literals. `v.t(c.navKey)` reads the key from a data field, and
 * `v.t(\`home.cap.\${k}.title\`)` builds it. A scanner that only understood
 * `t('literal')` would report a hundred false orphans, be declared useless, and be
 * switched off. So two things count as a call site: any string literal anywhere in
 * `src/` that equals a key (which covers the data-field case, since `navKey:
 * 'nav.platform.consentArchive'` is itself a literal), and any template literal with
 * interpolation, turned into a pattern so `home.cap.\${k}.title` claims
 * `home.cap.*.title`.
 *
 *   npx tsx scripts/verify-i18n-keys.ts
 */

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { buildServer } from '../src/web/server.js';
import { loadMigrationFiles } from '../src/db/migrate.js';
import { SettingsService } from '../src/settings/service.js';
import { SecurityService } from '../src/security/settings.js';
import { SiteService } from '../src/site/settings.js';
import { loadLocales } from '../src/web/site/i18n.js';
import { HOME, SITE_PAGES } from '../src/web/site/pages.js';
import type { Queryable } from '../src/db/pool.js';
import type { AdminConfig, Config } from '../src/config.js';

const ORIGIN = 'https://cinderella.example.test';

interface Finding {
  url: string;
  key: string;
  where: 'text' | 'attribute';
  context: string;
}

/**
 * The visible text of a page, plus the attribute values a visitor can actually
 * read or hear.
 *
 * `<script>` and `<style>` are removed first: the inline chrome script contains
 * selector strings that look exactly like keys, and flagging those would train
 * whoever runs this to ignore it.
 */
function visibleText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&[a-z]+;/gi, ' ');
}

/** Attribute values that reach a person: read on screen, or announced. */
function visibleAttributes(html: string): string[] {
  const out: string[] = [];
  const re = /\b(alt|title|aria-label|placeholder|content|value)\s*=\s*"([^"]*)"/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    const v = m[2];
    if (v) out.push(v);
  }
  return out;
}

function findKeys(haystack: string, namespaces: Set<string>): string[] {
  // A dotted token whose first segment is a real namespace. Two or more segments,
  // no spaces, ordinary key characters only.
  const re = /\b([a-zA-Z_][a-zA-Z0-9_]*)((?:\.[a-zA-Z0-9_]+)+)\b/g;
  const hits: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(haystack))) {
    const head = m[1];
    if (head && namespaces.has(head)) hits.push(m[0]);
  }
  return hits;
}

/** Every `.ts` under a directory. */
function tsFiles(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, name.name);
    if (name.isDirectory()) tsFiles(full, out);
    else if (name.name.endsWith('.ts')) out.push(full);
  }
  return out;
}

/**
 * Everything in the source that can name a translation key.
 *
 * Returns exact literals and patterns separately, because a pattern has to be
 * matched against every key while a literal is a set lookup.
 */
function callSites(roots: string[]): { literals: Set<string>; patterns: RegExp[] } {
  const literals = new Set<string>();
  const patterns: RegExp[] = [];

  for (const root of roots) {
    for (const file of tsFiles(root)) {
      const src = readFileSync(file, 'utf8');

      // Plain string literals: 'x', "x", and `x` with no interpolation. This is
      // deliberately not limited to t() calls, because a key stored in a data
      // structure (pages.ts `navKey`) is a real call site reached through a
      // variable, and there is no way to tell the two apart from the string alone.
      for (const m of src.matchAll(/(['"])([^'"\n]{2,120})\1/g)) {
        const v = m[2];
        if (v && v.includes('.')) literals.add(v);
      }
      for (const m of src.matchAll(/`([^`$\n]{2,120})`/g)) {
        const v = m[1];
        if (v && v.includes('.')) literals.add(v);
      }

      // Template literals WITH interpolation become patterns: every `${...}` is one
      // key segment. `home.cap.${k}.title` claims `home.cap.ai.title` and friends.
      for (const m of src.matchAll(/`([^`\n]*\$\{[^`\n]*)`/g)) {
        const raw = m[1];
        if (!raw || !raw.includes('.')) continue;
        // Only interested in things shaped like a key; a URL template is not one.
        if (/[/?=<>\s]/.test(raw.replace(/\$\{[^}]*\}/g, ''))) continue;
        const source = raw
          .split(/\$\{[^}]*\}/)
          .map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
          .join('[A-Za-z0-9_-]+');
        try {
          patterns.push(new RegExp(`^${source}$`));
        } catch {
          // An unparseable template is not worth failing the run over.
        }
      }
    }
  }
  return { literals, patterns };
}

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

  const locales = loadLocales('locales');

  // The namespace whitelist, derived rather than hard-coded so it cannot go stale.
  const namespaces = new Set<string>();
  for (const file of readdirSync('locales').filter((n) => n.endsWith('.json'))) {
    let dict: Record<string, unknown>;
    try {
      dict = JSON.parse(readFileSync(join('locales', file), 'utf8')) as Record<string, unknown>;
    } catch {
      continue; // a malformed locale is the loader's problem, not this check's
    }
    for (const key of Object.keys(dict)) {
      const head = key.split('.')[0];
      if (head) namespaces.add(head);
    }
  }
  console.log(`Namespaces in scope (${String(namespaces.size)}): ${[...namespaces].sort().join(' ')}`);

  const adminCfg: AdminConfig = {
    adminPort: 0,
    adminUsername: 'operator',
    adminPasswordHash: 'x',
    sessionSecret: 'verify-i18n-keys-session-secret-0123456789abcd',
    publicOrigin: ORIGIN,
    rpId: 'cinderella.example.test',
    webauthnOrigin: ORIGIN,
    rpName: 'CIND3R3LLA',
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
  const site = await SiteService.load(db);
  const app = buildServer({ db, adminCfg, cfg, settings, security, site, mediaRoot: cfg.mediaRoot });
  await app.ready();

  const pages = [HOME, ...SITE_PAGES];
  const findings: Finding[] = [];
  let rendered = 0;

  for (const page of pages) {
    for (const code of locales.codes) {
      const url = page.slug ? `/${code}/${page.slug}` : `/${code}`;
      const res = await app.inject({ method: 'GET', url });
      if (res.statusCode !== 200) continue;
      rendered++;

      for (const key of findKeys(visibleText(res.body), namespaces)) {
        const at = res.body.indexOf(key);
        findings.push({
          url,
          key,
          where: 'text',
          context: res.body.slice(Math.max(0, at - 40), at + key.length + 20).replace(/\s+/g, ' '),
        });
      }
      for (const attr of visibleAttributes(res.body)) {
        for (const key of findKeys(attr, namespaces)) {
          findings.push({ url, key, where: 'attribute', context: attr.slice(0, 90) });
        }
      }
    }
  }

  await app.close();

  console.log(`Rendered ${String(rendered)} pages across ${String(locales.codes.length)} locales.`);

  /* ── Phase 2: keys that exist and are called from nowhere ─────────────────── */
  const allKeys = new Set<string>();
  for (const file of readdirSync('locales').filter((n) => n.endsWith('.json'))) {
    try {
      const dict = JSON.parse(readFileSync(join('locales', file), 'utf8')) as Record<
        string,
        unknown
      >;
      for (const key of Object.keys(dict)) {
        // `_meta` is locale metadata (endonym, direction, og locale) read by the
        // loader itself, never through t(). It has no call site by design.
        if (key !== '_meta') allKeys.add(key);
      }
    } catch {
      continue;
    }
  }
  const { literals, patterns } = callSites(['src']);
  const orphans = [...allKeys]
    .filter((key) => !literals.has(key))
    .filter((key) => !patterns.some((re) => re.test(key)))
    .sort();
  console.log(
    `Checked ${String(allKeys.size)} keys against ${String(literals.size)} literal and ` +
      `${String(patterns.length)} pattern call site(s).\n`,
  );

  if (findings.length === 0 && orphans.length === 0) {
    console.log('ALL PASSED - no raw key renders, and every key has a call site.');
    return;
  }

  if (orphans.length > 0) {
    console.log(`  [FAIL] ${String(orphans.length)} key(s) exist in the locales but are called nowhere:`);
    for (const key of orphans) console.log(`         ${key}`);
    console.log('         Either the call site was removed, or a rename touched only one side.');
    if (findings.length > 0) console.log('');
  }

  if (findings.length === 0) {
    process.exit(1);
  }

  // Grouped by key: one missing string shows up on 40 pages, and 40 identical
  // lines would bury the second fault under the first.
  const byKey = new Map<string, Finding[]>();
  for (const f of findings) {
    const list = byKey.get(f.key) ?? [];
    list.push(f);
    byKey.set(f.key, list);
  }
  for (const [key, list] of [...byKey.entries()].sort()) {
    const first = list[0];
    console.log(`  [FAIL] ${key}  (${String(list.length)} page(s), ${first?.where ?? 'text'})`);
    console.log(`         e.g. ${first?.url ?? ''}: ...${first?.context ?? ''}...`);
  }
  console.log(
    `\n${String(byKey.size)} raw key(s) reaching ${String(findings.length)} rendered page(s).`,
  );
  console.log('Either the key is missing from the locale files, or the call site should go.');
  process.exit(1);
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
