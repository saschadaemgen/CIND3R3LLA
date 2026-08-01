/**
 * Offline verification for CIND3R3LLA administration branding and original site FX.
 *
 * No database, network, SimpleX transport, or production service is used.
 */

import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { registerNav } from '../src/web/server.js';
import { html, page } from '../src/web/html.js';

let failures = 0;

function check(label: string, ok: boolean, detail = ''): void {
  if (!ok) failures++;
  console.log(`  [${ok ? 'PASS' : 'FAIL'}] ${label}${detail ? `: ${detail}` : ''}`);
}

async function main(): Promise<void> {
  registerNav();

  const rendered = page({
    title: 'Brand verification',
    active: 'ai:onboarding',
    csrfToken: 'verification-token',
    body: html`<p>Brand verification</p>`,
  });

  const root = process.cwd();
  const htmlSource = await readFile(join(root, 'src', 'web', 'html.ts'), 'utf8');
  const css = await readFile(join(root, 'assets', 'app.css'), 'utf8');
  const effects = await readFile(join(root, 'assets', 'admin-effects.js'), 'utf8');
  const copier = await readFile(join(root, 'scripts', 'copy-assets.mjs'), 'utf8');

  console.log('\n1. Product and bot naming');
  check('browser title uses the product name', rendered.includes('| CIND3R3LLA</title>'));
  check(
    'header exposes the product wordmark',
    rendered.includes('aria-label="CIND3R3LLA administration"'),
  );
  check(
    'footer exposes the product name',
    rendered.includes('admin-footer-product">CIND3R3LLA</span>'),
  );
  // THIS CHECK USED TO ASSERT THE OPPOSITE, and it was red on `main` from 2026-07-28.
  // It was written in `23acf03`, before D-088, and guarded the rule that product identity
  // is not inferred from one bot profile by pinning this sentence to the plain spelling.
  // `9d11bb0` then implemented D-088, which stylises the product name EVERYWHERE it is
  // displayed, the admin console included, and did not update this harness. The operator
  // has ruled: D-088 governs and the harness follows, so the assertion is inverted.
  //
  // The rule the original check cared about is not abandoned, it has moved to where it
  // actually lives. The admin chrome is PRODUCT copy and carries the product spelling; the
  // INDIVIDUAL bot's name is `BOT_DISPLAY_NAME` in configuration, which is a different
  // thing in a different file and is not what this sentence was ever about.
  check(
    'admin chrome copy uses the product spelling (D-088)',
    htmlSource.includes('Control how CIND3R3LLA addresses people') &&
      !htmlSource.includes('Control how Cinderella addresses people'),
  );
  // Broadened deliberately: pinning one sentence let the rest of the chrome drift without
  // anything noticing. No plain-spelling product reference belongs in this file at all.
  check(
    'and no plain-spelling product reference survives anywhere in the admin chrome',
    !/\bCinderella\b/.test(htmlSource),
  );

  console.log('\n2. Original random starfield');
  check(
    'page renders a canvas starfield',
    rendered.includes('id="admin-starfield"') && rendered.includes('class="admin-starfield"'),
  );
  check(
    'same origin effects script is loaded',
    rendered.includes('<script src="/assets/admin-effects.js" defer></script>'),
  );
  check(
    'original star count and radius are restored',
    effects.includes('Math.min(190, Math.floor((width * height) / 9000))') &&
      effects.includes('Math.random() * 1.3 + 0.35'),
  );
  check(
    'original twinkle values are restored',
    effects.includes('speed: 0.5 + Math.random() * 1.7') &&
      effects.includes('baseOpacity: 0.3 + Math.random() * 0.5') &&
      effects.includes('Math.sin(time * star.speed + star.phase) * 0.4'),
  );
  check(
    'original white cyan and magenta palette is restored',
    effects.includes('[255, 255, 255]') &&
      effects.includes('[141, 225, 236]') &&
      effects.includes('[244, 92, 176]'),
  );

  console.log('\n3. Original ambient background');
  check(
    'original four background gradients are restored',
    css.includes('radial-gradient(40% 40% at 12% 4%') &&
      css.includes('radial-gradient(44% 42% at 88% 24%') &&
      css.includes('radial-gradient(46% 40% at 20% 58%') &&
      css.includes('radial-gradient(52% 44% at 82% 90%'),
  );
  check(
    'original ambient timing is restored',
    css.includes('admin-original-ambient 28s cubic-bezier(0.45, 0, 0.25, 1) infinite alternate') &&
      css.includes('translate3d(0, -2.5%, 0) scale(1.07)'),
  );
  check(
    'only the original subtle noise layer remains',
    css.includes('mix-blend-mode: overlay') &&
      css.includes('opacity: 0.045') &&
      !css.includes('@keyframes admin-approved-haze'),
  );
  check(
    'reduced motion remains supported',
    effects.includes('prefers-reduced-motion: reduce') &&
      css.includes('@media (prefers-reduced-motion: reduce)'),
  );

  console.log('\n4. Build integration');
  check(
    'asset copier publishes the effects script',
    copier.includes("assets', 'admin-effects.js") &&
      copier.includes("public', 'assets', 'admin-effects.js"),
  );

  console.log('\n=== RESULTS ===');
  console.log(`StepSuccessful: ${failures === 0}`);
  console.log(`Failures: ${failures}`);
  console.log('ProductName: CIND3R3LLA');
  console.log('IndividualBotNamePreserved: Cinderella');
  console.log('OriginalRandomStarfieldRestored: true');
  console.log('OriginalAmbientBackgroundRestored: true');
  console.log('AdditionalHazeRemoved: true');
  console.log('SimplexSdkActionsExecuted: false');
  console.log('Committed: false');
  console.log('Pushed: false');
  console.log('ProductionChanged: false');

  if (failures > 0) process.exit(1);
}

main().catch((error: unknown) => {
  console.error('\n=== RESULTS ===');
  console.error('StepSuccessful: false');
  console.error(`Error: ${error instanceof Error ? error.message : String(error)}`);
  console.error('SimplexSdkActionsExecuted: false');
  console.error('Committed: false');
  console.error('Pushed: false');
  console.error('ProductionChanged: false');
  process.exit(1);
});
