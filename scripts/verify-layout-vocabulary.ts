/**
 * The console has a layout vocabulary, and pages use it (CCB-S5-036, D-194).
 *
 * ── WHAT WENT WRONG, AND WHY IT WAS STRUCTURAL ───────────────────────────────
 *
 * The operator's report was that there are CSS faults everywhere, modules sit flush against
 * each other, and the console looks unfinished. The cause was not a stylesheet: `html.ts`
 * gave the page shell and the navigation and NOTHING BELOW THAT, and `ui.ts` had six
 * helpers, so 26 view files each invented their own layout and spacing was whatever the
 * author typed that day.
 *
 * ── THE LOAD-BEARING ASSERTION IS THE SPACING ONE ────────────────────────────
 *
 * `.admin-card` has padding and NO margin. `.admin-content` had no gap and no sibling rule.
 * So two cards in a row sat flush - measured at 0px on the Channel Bridge, six cards, five
 * gaps, all zero. The container owns the rhythm now, which is the direction that matters:
 * if each card carried its own margin, a page that wraps one in a div loses the spacing and
 * cannot see why. With the container owning it, OMISSION PRODUCES CORRECT OUTPUT.
 *
 * That property is asserted here over the real stylesheet, and mutation-proven: remove the
 * rule and this goes red.
 *
 *   npx tsx scripts/verify-layout-vocabulary.ts
 */

import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';

let failures = 0;
function check(label: string, ok: boolean, detail = ''): void {
  if (!ok) failures++;
  console.log(`  [${ok ? 'PASS' : 'FAIL'}] ${label}${detail ? ` - ${detail}` : ''}`);
}

/**
 * The rule that makes flush sections impossible.
 *
 * NOT a literal substring test. The first version asserted
 * `.admin-content>*+*{margin-top`, which is true of the source and FALSE of the build -
 * lightningcss merges identical declarations, so the shipped rule reads
 * `.admin-content>*+*,.admin-stack>*+*{margin-top:22px}`. The property held and the matcher
 * was wrong, which is D-111 exactly: look at what is rendered before changing either side.
 *
 * So it finds the selector, then the block that selector belongs to, then a margin in it.
 */
export function ownsVerticalRhythm(css: string): boolean {
  const flat = css.replace(/\s+/g, '');
  const at = flat.indexOf('.admin-content>*+*');
  if (at === -1) return false;
  const open = flat.indexOf('{', at);
  const close = flat.indexOf('}', open);
  if (open === -1 || close === -1) return false;
  return /margin-top:\d/.test(flat.slice(open, close));
}

async function main(): Promise<void> {
  console.log('The console has a layout vocabulary (CCB-S5-036, D-194)');

  const root = process.cwd();
  const source = await readFile(join(root, 'assets', 'app.css'), 'utf8');
  const built = await readFile(join(root, 'public', 'assets', 'app.css'), 'utf8');
  const ui = await readFile(join(root, 'src', 'web', 'views', 'ui.ts'), 'utf8');

  /* ── 1. the container owns the rhythm ─────────────────────────────────── */

  console.log('\n1. Spacing comes from the container, so omission cannot produce flush sections');

  check('the source stylesheet owns vertical rhythm on .admin-content', ownsVerticalRhythm(source));
  check('  and it SURVIVES THE BUILD, which is where a selector silently dies', ownsVerticalRhythm(built));
  check(
    '  the stack helper carries the same rhythm for blocks inside a card',
    source.replace(/\s+/g, '').includes('.admin-stack>*+*{margin-top'),
  );

  // MUTATION: the shipped state. `.admin-card` has padding and no margin, so with no
  // container rule two cards sit flush - which is exactly what was measured at 0px.
  check(
    'MUTATION: with the container rule removed, nothing else supplies the gap',
    !ownsVerticalRhythm(source.replace(/\.admin-content\s*>\s*\*\s*\+\s*\*\s*\{[^}]*\}/g, '')) &&
      !/\.admin-card\s*\{[^}]*margin(-top)?\s*:/.test(source),
    'admin-card carries no margin of its own, which is why the container must',
  );

  /* ── 2. the vocabulary exists and is exported ─────────────────────────── */

  console.log('\n2. The vocabulary is derived from the pages, and it is reachable');

  for (const name of ['factList', 'statusTile', 'statusTiles', 'sectionHeader', 'actionForm']) {
    check(`ui.ts exports ${name}`, new RegExp(`export function ${name}\\b`).test(ui));
  }
  check(
    'and it states the counts it was derived from, so the claim can be checked',
    ui.includes('25 uses') && ui.includes('16 uses') && ui.includes('18 uses'),
  );
  check(
    'and it names what was deliberately NOT made a component',
    ui.includes('DELIBERATELY NOT HERE'),
  );

  // Every vocabulary class must actually be styled, or a page using it renders unstyled and
  // the helper is worse than the hand-rolled markup it replaced.
  for (const cls of [
    'admin-facts',
    'admin-fact-label',
    'admin-tiles',
    'admin-tile-value',
    'admin-section-header',
    'admin-action-button',
  ]) {
    check(`  .${cls} is styled in the built stylesheet`, built.includes(cls));
  }

  /* ── 3. the CSRF field is not the caller's to forget ──────────────────── */

  console.log('\n3. actionForm cannot be used without its CSRF field');

  check(
    'the helper writes the CSRF input itself rather than trusting the caller',
    /export function actionForm[\s\S]*?name="_csrf"/.test(ui),
  );
  check(
    '  and takes the token as a REQUIRED argument, so a caller cannot omit it',
    /actionForm\(opts: \{[\s\S]*?csrf: string;/.test(ui),
  );

  /* ── 4. no view re-declares the shell ─────────────────────────────────── */

  console.log('\n4. No view rebuilds the page shell for itself');

  const viewDir = join(root, 'src', 'web', 'views');
  const views = (await readdir(viewDir)).filter((f) => f.endsWith('.ts'));
  const offenders: string[] = [];
  for (const file of views) {
    const body = await readFile(join(viewDir, file), 'utf8');
    // A view that writes its own <html> or <body> has left the shell behind, which is the
    // one thing the vocabulary cannot rescue.
    if (/<html[\s>]/.test(body) || /<body[\s>]/.test(body)) offenders.push(file);
  }
  check(
    'every view renders INTO the shell rather than around it',
    offenders.length === 0,
    offenders.join(', '),
  );
  check(`  (${String(views.length)} view files scanned)`, views.length >= 20);

  console.log(
    `\n${failures === 0 ? 'ALL PASSED' : `${String(failures)} CHECK(S) FAILED`} - layout vocabulary.`,
  );
  console.log(
    'Note: this pins the vocabulary and the spacing rule. It cannot see that a page LOOKS\n' +
      'right (D-162); the conversion state is reported per page in the briefing.',
  );
  process.exitCode = failures === 0 ? 0 : 1;
}

main().catch((err: unknown) => {
  console.error(err);
  process.exitCode = 1;
});
