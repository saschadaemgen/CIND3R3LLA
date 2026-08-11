// Copies vendored front-end assets (htmx) into public/assets/.
// Runs as part of `npm run assets`. No CDN dependencies — everything is
// served same-origin under the admin console's strict CSP.
import { copyFileSync, mkdirSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = join(root, 'public', 'assets');
mkdirSync(outDir, { recursive: true });

const htmxSrc = join(root, 'node_modules', 'htmx.org', 'dist', 'htmx.min.js');
copyFileSync(htmxSrc, join(outDir, 'htmx.min.js'));

// WebAuthn browser helper (UMD global: SimpleWebAuthnBrowser).
const webauthnSrc = join(
  root,
  'node_modules',
  '@simplewebauthn',
  'browser',
  'dist',
  'bundle',
  'index.umd.min.js',
);
copyFileSync(webauthnSrc, join(outDir, 'webauthn-browser.js'));

// ── OUR OWN SCRIPTS: EVERY ONE, NOT A LIST SOMEBODY MAINTAINS (CCB-S5-024) ──
//
// This was ten explicit copyFileSync calls, and adding a script meant remembering to add an
// eleventh. The knowledge base upload shipped with its script missing from the page AND from
// this list, and a script that is not copied 404s at exactly the moment it is needed, in
// silence, because nothing on the page reports a missing defer script.
//
// A glob cannot be forgotten. Vendored assets stay explicit above, because they come out of
// node_modules under different names and there is nothing to enumerate.
const ownScripts = readdirSync(join(root, 'assets')).filter((f) => f.endsWith('.js'));
for (const name of ownScripts) {
  copyFileSync(join(root, 'assets', name), join(outDir, name));
}

console.log(`copied htmx.min.js, webauthn-browser.js and ${ownScripts.length} own script(s) -> public/assets/`);
