/**
 * The sidebar shows the sub-pages of what is open, never the menu above it. (D-259)
 *
 * ── THE RULE, AND WHY IT KEEPS BREAKING ──────────────────────────────────────
 *
 * D-225 settled it and `deepestSectionFor` implements it correctly and generically: the
 * sidebar renders the children of the DEEPEST opened node that has children. So whether a
 * page shows its own sub-pages or the menu above it is decided entirely by whether its nav
 * node HAS children - which is data, not logic.
 *
 * That data has been wrong twice, and the operator found it himself both times: the Music
 * Library (D-225) and the Channel Bridge (CCB-S5-058). Both times the mechanism was fine and
 * the row was missing. Nothing announced it, because a page with no declared children is
 * indistinguishable, to every check that existed, from a page that legitimately has none.
 *
 * ── WHAT THIS ASSERTS ────────────────────────────────────────────────────────
 *
 * Every `active` key a page actually sets is resolved through the REAL resolver against the
 * REAL registered tree, and three things are required of each one:
 *
 *   1. the key exists in the tree at all - a page pointing at a key nobody registered gets
 *      the root menu and looks like a page with no section;
 *   2. the sidebar section it resolves to CONTAINS that key, rather than being an ancestor
 *      that happens to have children - which is exactly the fallback the rule forbids;
 *   3. a page that is one of several sibling routes under one heading declares them.
 *
 * The keys are read from the SOURCE rather than listed here, because a list here would go
 * stale the first time somebody adds a page, and that is the failure being fixed.
 *
 *   npx tsx scripts/verify-sidebar.ts
 */

import { readdirSync, readFileSync } from 'node:fs';
import { registerNav } from '../src/web/server.js';
import { navItemsSnapshot, sidebarSectionFor, type NavItem } from '../src/web/html.js';

let failures = 0;
function check(label: string, ok: boolean, detail = ''): void {
  if (!ok) failures++;
  console.log(`  [${ok ? 'PASS' : 'FAIL'}] ${label}${detail ? `: ${detail}` : ''}`);
}

/** Every `active:` a view sets, with its interpolations expanded from the source. */
function activeKeysFromSource(): { key: string; file: string }[] {
  const dir = new URL('../src/web/views/', import.meta.url);
  const out: { key: string; file: string }[] = [];
  for (const name of readdirSync(dir)) {
    if (!name.endsWith('.ts')) continue;
    const text = readFileSync(new URL(name, dir), 'utf8');
    for (const m of text.matchAll(/active: *[`'"]([^`'"]+)[`'"]/g)) {
      const raw = m[1] ?? '';
      // `interaction:${slug}` and friends: the prefix is what places the page in the tree,
      // and the suffix is enumerated by the section's own table, so the prefix is resolved
      // against every child of the matching parent below.
      out.push({ key: raw, file: name });
    }
  }
  return out;
}

function allKeys(items: readonly NavItem[]): Set<string> {
  const keys = new Set<string>();
  const walk = (i: NavItem): void => {
    keys.add(i.key);
    for (const c of i.children ?? []) walk(c);
  };
  for (const i of items) walk(i);
  return keys;
}

function findNode(items: readonly NavItem[], key: string): NavItem | undefined {
  for (const i of items) {
    if (i.key === key) return i;
    const found = findNode(i.children ?? [], key);
    if (found) return found;
  }
  return undefined;
}

function containsKey(node: NavItem, key: string): boolean {
  if (node.key === key) return true;
  return (node.children ?? []).some((c) => containsKey(c, key));
}

function main(): void {
  registerNav();
  const tree = navItemsSnapshot();
  const keys = allKeys(tree);

  /* ── 1. Every page's key is in the tree ──────────────────────────────────── */

  console.log('\n1. Every page points at a nav node that exists');

  const dynamic: { key: string; file: string }[] = [];
  const staticKeys: { key: string; file: string }[] = [];
  for (const entry of activeKeysFromSource()) {
    if (entry.key.includes('${')) dynamic.push(entry);
    else staticKeys.push(entry);
  }
  for (const { key, file } of staticKeys) {
    check(`${key} (${file})`, keys.has(key), keys.has(key) ? '' : 'no such nav key');
  }
  // A templated key resolves per section; the PREFIX must name a real parent whose children
  // are the pages. `channel-bridge:${section}` is the shape that was missing entirely.
  //
  // `plugin:${SOME_ID}` is the ONE exception and it is not a section at all: it is how a
  // single-page plugin names itself, so its parent is the Plugins menu. Asserting a section
  // there would demand sub-pages of a page that legitimately has none, which is the verifier
  // inventing a rule rather than checking one (D-111).
  for (const { key, file } of dynamic) {
    const prefix = key.slice(0, key.indexOf('${')).replace(/:$/, '');
    if (prefix === 'plugin') {
      const plugins = findNode(tree, 'plugins-root') ?? findNode(tree, 'plugins');
      check(
        `${key} (${file}) is a single-page plugin under the Plugins menu`,
        plugins !== undefined,
        plugins === undefined ? 'no Plugins menu' : '',
      );
      continue;
    }
    const node = findNode(tree, prefix) ?? findNode(tree, `plugin:${prefix}`);
    check(
      `${key} (${file}) has a parent with children`,
      node !== undefined && (node.children ?? []).length > 0,
      node === undefined ? `no node for "${prefix}"` : `${String((node.children ?? []).length)} children`,
    );
  }

  /* ── 2. THE RULE: the sidebar shows the page's own section ───────────────── */

  console.log('\n2. The sidebar shows the sub-pages of what is open, not the menu above it');

  // A TOP-LEVEL page with no children has no sub-pages to show and no siblings under a
  // heading: the root menu is the only thing there is, and demanding a section would be the
  // verifier asserting something the rule never said. Dashboard is the whole set today.
  const standalone = new Set(
    tree.filter((i) => (i.children ?? []).length === 0).map((i) => i.key),
  );
  console.log(
    `  (standalone top-level pages, exempt because they have no sub-pages: ${[...standalone].join(', ') || 'none'})`,
  );
  const seen = new Set<string>();
  for (const { key, file } of staticKeys) {
    if (!keys.has(key) || seen.has(key)) continue;
    seen.add(key);
    if (standalone.has(key)) continue;
    const section = sidebarSectionFor(key);
    const own = section !== undefined && containsKey(section, key);
    check(
      `${key} (${file}) -> sidebar "${section?.label ?? 'ROOT MENU'}"`,
      own,
      own ? '' : 'falls back to an ancestor: the operator sees the menu above the page',
    );
  }

  /* ── 2b. Every page a section SERVES is a page the sidebar OFFERS ────────── */

  console.log('\n2b. Every sub-page a section serves is in the sidebar');

  // The same failure one level down, and the one nothing would announce: a section grows a
  // page, the route is served, the nav row is forgotten, and the page is reachable only by
  // typing the URL. The slugs are read from each section's OWN table so this cannot go stale
  // the way a list here would.
  const viewsDir = new URL('../src/web/views/', import.meta.url);
  const tableSlugs = (file: string, decl: string, field: 'slug' | 'key'): string[] => {
    const text = readFileSync(new URL(file, viewsDir), 'utf8');
    const from = text.indexOf(decl);
    if (from === -1) return [];
    const to = text.indexOf('\n];', from);
    const block = text.slice(from, to === -1 ? undefined : to);
    return [...block.matchAll(new RegExp(`${field}: '([a-z-]+)'`, 'g'))].map((m) => m[1] ?? '');
  };

  for (const [label, file, decl, field, prefix] of [
    ['Interaction', 'interaction.ts', 'const SECTIONS', 'slug', 'interaction'],
    ['Moderation', 'moderation.ts', 'const SECTIONS', 'slug', 'moderation'],
    ['Channel Bridge', 'bridge.ts', 'const BRIDGE_SECTIONS', 'key', 'channel-bridge'],
  ] as const) {
    const slugs = tableSlugs(file, decl, field);
    check(`${label} serves at least one sub-page`, slugs.length > 0, `${String(slugs.length)} found`);
    for (const slug of slugs) {
      const key = `${prefix}:${slug}`;
      const node = findNode(tree, key);
      const section = sidebarSectionFor(key);
      check(
        `  ${key} is offered in the sidebar`,
        node !== undefined && section !== undefined && containsKey(section, key),
        node === undefined ? 'served but NOT in the nav: reachable only by typing the URL' : '',
      );
    }
  }

  /* ── 3. The two sections this rule was written for ───────────────────────── */

  console.log('\n3. The two the operator found himself');

  for (const [plugin, expected] of [
    ['music', ['Library', 'Playlists', 'Assignments', 'Storage']],
    // Retention joined under CCB-S5-064 (the bridge media sweep's own page).
    ['channel-bridge', ['Channels', 'Mappings', 'Publishing', 'Forward log', 'Diagnostics', 'Retention']],
  ] as const) {
    const node = findNode(tree, `plugin:${plugin}`);
    const labels = (node?.children ?? []).map((c) => c.label);
    check(
      `${plugin} is a section with its own pages`,
      JSON.stringify(labels) === JSON.stringify([...expected]),
      labels.join(' / ') || 'NO CHILDREN',
    );
    // And each of those pages resolves BACK to this section rather than to Plugins.
    for (const child of node?.children ?? []) {
      const section = sidebarSectionFor(child.key);
      check(
        `  ${child.label} keeps the ${plugin} sidebar`,
        section?.key === `plugin:${plugin}`,
        section?.label ?? 'ROOT',
      );
    }
  }

  /* ── 4. The mutation, so a green run means something ─────────────────────── */

  console.log('\n4. Mutation: a section that loses its children loses its sidebar');

  const bridge = findNode(tree, 'plugin:channel-bridge');
  const kept = bridge?.children;
  if (bridge) {
    // Restores the shipped defect: the row missing from PLUGIN_SUB_PAGES.
    delete (bridge as { children?: NavItem[] }).children;
    const section = sidebarSectionFor('channel-bridge:mappings');
    check(
      'with no declared children, a bridge page falls back to the Plugins menu',
      section?.key !== 'plugin:channel-bridge',
      `sidebar would show "${section?.label ?? 'ROOT'}"`,
    );
    (bridge as { children?: NavItem[] }).children = kept;
    check(
      '  and restoring them restores the section',
      sidebarSectionFor('channel-bridge:mappings')?.key === 'plugin:channel-bridge',
    );
  }

  console.log(
    failures === 0
      ? '\nEvery console page shows its own sub-pages, and a section that lost its rows would ' +
          'go red here rather than being found in a browser.'
      : `\n${String(failures)} check(s) FAILED.`,
  );
  process.exit(failures === 0 ? 0 : 1);
}

main();
