/**
 * Marketing-site CSS (CCB-S3-001) — the operator's approved dark-neon design,
 * ported from the website template (tmp/Cinderella Website.html):
 * ink/cyan/magenta token system (dark ONLY, light mode removed per operator), Source Sans 3 +
 * JetBrains Mono self-hosted woff2 (Google-subset files under /assets/site/fonts,
 * SIL OFL), the cinematic FX layer, and the design-system component styles
 * (cn-badge/card/tag/btn/input/tabs/sechead/ftile/tier/cookiebar).
 *
 * Self-contained: no CDN fonts/icons — everything resolves same-origin or data:
 * under the site's strict CSP (see routes.ts applySiteHeaders).
 */

import { iconMaskDataUri } from './icons.js';

const FONTS_BASE = '/assets/site/fonts';

interface FontSubset {
  name: string;
  range: string;
}

const SUBSETS = {
  cyrillicExt: {
    name: 'cyrillic-ext',
    range: 'U+0460-052F, U+1C80-1C8A, U+20B4, U+2DE0-2DFF, U+A640-A69F, U+FE2E-FE2F',
  },
  cyrillic: { name: 'cyrillic', range: 'U+0301, U+0400-045F, U+0490-0491, U+04B0-04B1, U+2116' },
  greekExt: { name: 'greek-ext', range: 'U+1F00-1FFF' },
  greek: {
    name: 'greek',
    range: 'U+0370-0377, U+037A-037F, U+0384-038A, U+038C, U+038E-03A1, U+03A3-03FF',
  },
  vietnamese: {
    name: 'vietnamese',
    range:
      'U+0102-0103, U+0110-0111, U+0128-0129, U+0168-0169, U+01A0-01A1, U+01AF-01B0, U+0300-0301, U+0303-0304, U+0308-0309, U+0323, U+0329, U+1EA0-1EF9, U+20AB',
  },
  latinExt: {
    name: 'latin-ext',
    range:
      'U+0100-02BA, U+02BD-02C5, U+02C7-02CC, U+02CE-02D7, U+02DD-02FF, U+0304, U+0308, U+0329, U+1D00-1DBF, U+1E00-1E9F, U+1EF2-1EFF, U+2020, U+20A0-20AB, U+20AD-20C0, U+2113, U+2C60-2C7F, U+A720-A7FF',
  },
  latin: {
    name: 'latin',
    range:
      'U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+0304, U+0308, U+0329, U+2000-206F, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD',
  },
} satisfies Record<string, FontSubset>;

function face(
  family: string,
  style: string,
  weight: string,
  file: string,
  subset: FontSubset,
): string {
  return `@font-face{font-family:'${family}';font-style:${style};font-weight:${weight};font-display:swap;src:url("${FONTS_BASE}/${file}") format('woff2');unicode-range:${subset.range}}`;
}

/** The @font-face set — variable files shared across weights (as Google serves them). */
function fontFacesCss(): string {
  const s = SUBSETS;
  const jbm = [s.cyrillicExt, s.cyrillic, s.greek, s.vietnamese, s.latinExt, s.latin];
  const ss3 = [s.cyrillicExt, s.cyrillic, s.greekExt, s.greek, s.vietnamese, s.latinExt, s.latin];
  const out: string[] = [];
  for (const sub of jbm) {
    out.push(face('JetBrains Mono', 'normal', '400 500', `jetbrains-mono-${sub.name}.woff2`, sub));
  }
  for (const sub of ss3) {
    out.push(face('Source Sans 3', 'italic', '400', `source-sans-3-italic-${sub.name}.woff2`, sub));
  }
  for (const sub of ss3) {
    out.push(face('Source Sans 3', 'normal', '400 700', `source-sans-3-${sub.name}.woff2`, sub));
  }
  return out.join('\n');
}

/** Cinderella color system — cyber black, neon cyan, magenta brand. Dark default. */
const TOKENS_CSS = `
:root{
--ink-950:#050A12;--ink-900:#080D18;--ink-850:#0B1220;--ink-800:#0E1626;--ink-700:#131D31;--ink-600:#1A2740;
--cyan-200:#B5EBF2;--cyan-300:#8FE1EC;--cyan-400:#6DD0DF;--cyan-500:#45BDD1;--cyan-600:#2E9DB0;--cyan-700:#1F7A8A;--cyan-800:#155765;
--magenta-300:#FBA9D6;--magenta-400:#F45CB0;--magenta-500:#E8389F;--magenta-600:#C21E80;--magenta-700:#8A1259;
--slate-50:#E8EDF4;--slate-200:#CBD5E1;--slate-400:#94A3B8;--slate-500:#64748B;--slate-600:#475569;--slate-700:#334155;
--green-400:#4ADE9E;--green-600:#1E9E6C;--amber-400:#E0B454;--amber-600:#B08A2E;--red-400:#E5646E;--red-600:#C2434E;
}
:root{
--text-body:var(--slate-200);--text-bright:var(--slate-50);--text-muted:var(--slate-400);--text-faint:var(--slate-500);--text-accent:var(--cyan-300);--text-link:var(--cyan-300);--text-on-accent:#04121A;
--surface-page:var(--ink-950);--surface-raised:var(--ink-900);--surface-card:var(--ink-850);--surface-field:rgba(5,10,18,.55);--surface-hover:rgba(203,213,225,.06);--surface-accent-weak:rgba(69,189,209,.08);
--border-hairline:rgba(69,189,209,.12);--border-strong:rgba(69,189,209,.28);--border-neutral:rgba(203,213,225,.09);
--primary:var(--cyan-500);--primary-hover:var(--cyan-400);--primary-active:var(--cyan-600);
--accent:var(--cyan-500);--accent-hover:var(--cyan-400);
--neon:var(--magenta-500);--neon-hover:var(--magenta-400);--neon-weak:rgba(232,56,159,.1);--text-neon:var(--magenta-300);
--success:var(--green-400);--success-surface:rgba(74,222,158,.1);--warning:var(--amber-400);--warning-surface:rgba(224,180,84,.1);--danger:var(--red-400);--danger-surface:rgba(229,100,110,.1);--info:var(--cyan-400);--info-surface:rgba(69,189,209,.1);
--focus-ring:0 0 0 3px rgba(69,189,209,.3);
--scrim:rgba(2,5,10,.7);
color-scheme:dark;
}
:root{
--font-sans:'Source Sans 3',-apple-system,'Segoe UI',sans-serif;
--font-mono:'JetBrains Mono',ui-monospace,'SF Mono',monospace;
--size-hero:76px;--size-display:46px;--size-title:32px;--size-heading:22px;--size-subheading:17px;--size-body:16px;--size-body-sm:14px;--size-caption:13px;--size-micro:11px;
--leading-display:1.03;--leading-heading:1.22;--leading-body:1.6;
--tracking-display:-0.03em;--tracking-body:0;--tracking-caps:0.14em;
--space-1:4px;--space-2:8px;--space-4:16px;--space-6:24px;--space-8:32px;--space-12:48px;--space-16:64px;--space-20:80px;
--container-max:1200px;--gutter:24px;
--radius-xs:4px;--radius-sm:8px;--radius-md:12px;--radius-lg:16px;--radius-xl:20px;--radius-pill:999px;
--shadow-1:0 1px 2px rgba(0,0,0,.4),0 8px 24px rgba(0,0,0,.3);
--shadow-2:0 2px 4px rgba(0,0,0,.45),0 16px 48px rgba(0,0,0,.4);
--shadow-3:0 4px 8px rgba(0,0,0,.5),0 32px 80px rgba(0,0,0,.5);
--glow-accent:0 0 24px rgba(69,189,209,.22);
--glow-accent-strong:0 0 20px rgba(69,189,209,.35),0 0 60px rgba(69,189,209,.18);
--glow-neon:0 0 40px rgba(232,56,159,.45);
--glow-neon-sm:0 0 18px rgba(232,56,159,.4);
--edge-lit:inset 0 1px 0 rgba(141,225,236,.08);
--grad-accent:linear-gradient(115deg,#B5EBF2,#45BDD1 55%,#2E9DB0);
--card-sheen:linear-gradient(180deg,rgba(69,189,209,.05),rgba(69,189,209,0) 42%);
--ease:ease;
--ease-in-out:cubic-bezier(.45,0,.25,1);
--ease-out:cubic-bezier(.2,.7,.2,1);
--duration-fast:150ms;
--duration-base:300ms;
--duration-slow:500ms;
}
*{box-sizing:border-box}
html{background:var(--surface-page)}
body{margin:0;font-family:var(--font-sans);font-size:var(--size-body);line-height:var(--leading-body);color:var(--text-body);background:var(--surface-page);-webkit-font-smoothing:antialiased}
h1,h2,h3{font-weight:700;line-height:var(--leading-heading);letter-spacing:var(--tracking-display);color:var(--text-bright)}
a{color:var(--text-link);text-decoration:none}
a:hover{color:var(--accent-hover);text-decoration:underline;text-underline-offset:3px}
code,pre{font-family:var(--font-mono);font-size:.9em}
::selection{background:rgba(69,189,209,.3)}
svg{vertical-align:-0.18em;flex:none}
@media (prefers-reduced-motion:reduce){*,*::before,*::after{animation-duration:.01ms!important;animation-iteration-count:1!important;transition-duration:.01ms!important}}
`;

/** Layout + FX — the template's page CSS, adapted to the SSR document structure. */
const LAYOUT_CSS = `
.skip{position:absolute;left:-9999px;top:0;background:var(--primary);color:var(--text-on-accent);padding:8px 14px;border-radius:var(--radius-sm);z-index:100}
.skip:focus{left:12px;top:12px}
/* NO FOCUS RING ON A MOUSE CLICK, ANYWHERE (CCB-S3-036 1).
   Every interactive element on this site styles :focus-visible and none of them
   suppressed the user-agent default, so a pointer click matched plain :focus, the
   browser drew its own ring, and it stayed until focus moved. One rule covers the
   whole site rather than a fix per element, which is how the nav came to be the
   only one anybody noticed.
   Scoped as :focus:not(:focus-visible) rather than a blanket outline:none on
   :focus, so a browser without :focus-visible support never matches and keeps its
   ring instead of losing focus indication entirely. Text inputs always match
   :focus-visible per spec, so they are unaffected. */
:focus:not(:focus-visible){outline:none}
.wrap{max-width:1200px;margin:0 auto;padding:0 24px}
.screen{animation:screenIn var(--duration-base) var(--ease-out)}
@keyframes screenIn{from{opacity:0;transform:translateY(8px)}}
.grid4{display:grid;grid-template-columns:repeat(4,1fr);gap:16px}
.grid3{display:grid;grid-template-columns:repeat(3,1fr);gap:16px}
.grid2{display:grid;grid-template-columns:1fr 1fr;gap:16px}
section.band{padding:120px 0 0}
.hero-bg{background:linear-gradient(180deg,rgba(232,56,159,.06),transparent 44%);border-bottom:1px solid var(--border-neutral)}
.nav-link{border:none;background:none;cursor:pointer;white-space:nowrap;font-family:var(--font-sans);font-size:14px;font-weight:600;color:var(--text-muted);padding:8px 11px;border-radius:var(--radius-sm);transition:color var(--duration-fast) var(--ease),background var(--duration-fast) var(--ease);text-decoration:none;display:inline-flex;align-items:center;gap:6px}
.nav-link:hover{color:var(--text-bright);background:var(--surface-hover);text-decoration:none}
.nav-link.active{color:var(--text-accent)}
.doc{max-width:760px}
.legal-binding{margin-top:36px;padding-top:28px;border-top:1px solid var(--border)}
.legal-binding-note{color:var(--text-muted);font-size:14px;border-left:2px solid var(--border);padding-left:12px;margin:0 0 20px}
/* ---- Navigation with submenus (CCB-S3-030) ---------------------------------
   <details> gives click and keyboard for free. Hover-to-open is added ONLY on
   pointer-fine devices, so a touch device never gets a menu that springs open
   while you scroll past it. No script, so the CSP is untouched. */
/* ---- The two-tier header (CCB-S3-036 3, CCB-S3-037 2) ----------------------- */
.site-header{padding:0}
.rail{background:rgba(3,7,14,.92);border-bottom:1px solid rgba(141,225,236,.14)}
.rail-row{display:flex;align-items:center;justify-content:space-between;height:34px;gap:18px}
.rail-side{display:flex;align-items:center;min-width:0}
.rail-right{margin-left:auto}
.rail-link{display:inline-flex;align-items:center;gap:6px;font-size:11.5px;line-height:1;
  color:var(--text-muted);text-decoration:none;white-space:nowrap;padding:0 13px;
  transition:color var(--duration-fast) var(--ease)}
.rail-link:hover{color:var(--cyan-400);text-decoration:none}
.rail-link svg{flex:none;opacity:.8}
.rail-link:hover svg{opacity:1}
/* Hairline separators, the height of the TEXT rather than of the bar. This is what
   makes a rail read as a rail instead of as floating words (CCB-S3-037 2). */
.rail-side .rail-link + .rail-link{border-left:1px solid rgba(141,225,236,.16)}
.rail-side .rail-link:first-child{padding-left:0}
.rail-right .rail-link:last-child{padding-right:0}

/* The main bar. */
.site-header .hdr-row{display:flex;align-items:center;gap:26px;height:70px}
.wm-name{font-weight:700;font-size:19px;letter-spacing:.01em;color:var(--text-bright)}
.wordmark:hover 
.hdr-nav{position:relative;display:flex;align-items:center;margin-left:auto}
.nav-link{border:none;background:none;cursor:pointer;white-space:nowrap;
  font-family:var(--font-sans);font-size:11.5px;font-weight:600;letter-spacing:.11em;
  text-transform:uppercase;color:var(--text-muted);padding:8px 15px;text-decoration:none;
  display:inline-flex;align-items:center;
  transition:color var(--duration-fast) var(--ease)}
.nav-link:hover{color:var(--text-bright);background:none}
.nav-link.active{color:var(--text-accent)}
.hdr-nav .nav-link + .nav-link{border-left:1px solid rgba(141,225,236,.16)}
/* Raised so it sits close under the label rather than near the bar's bottom edge
   (CCB-S3-037 2): was -6px, now -1px, a 5px lift. */
.nav-indicator{position:absolute;bottom:-1px;left:0;width:0;height:3px;pointer-events:none;
  border-radius:999px;opacity:0;
  background:linear-gradient(90deg,rgba(244,92,176,0) 0%,rgba(244,92,176,.92) 18%,
    rgba(141,225,236,.92) 82%,rgba(141,225,236,0) 100%);
  box-shadow:0 0 14px rgba(244,92,176,.42),0 0 22px rgba(141,225,236,.22);
  transition:transform 270ms cubic-bezier(.2,.8,.2,1),width 270ms cubic-bezier(.2,.8,.2,1),
    opacity 140ms ease;will-change:transform,width}
.nav-indicator[data-ready=true]{opacity:1}
.hdr-controls{display:flex;align-items:center;gap:12px;margin-left:8px}

/* ---- The Demo control (CCB-S3-037 3) ----------------------------------------
   The operator's approved CSS, adapted to the site's class names. The outer
   element carries the clip and a 1.2px pad that acts as the border; .in carries
   the same clip, the dark interior and the overflow that keeps the scanline in.
   Nothing transforms. */
.dm{position:relative;height:34px;cursor:pointer;display:inline-block;text-decoration:none;
  clip-path:polygon(9px 0,100% 0,100% calc(100% - 9px),calc(100% - 9px) 100%,0 100%,0 9px);
  padding:1.2px;background:rgba(255,61,166,.34);
  transition:background 200ms cubic-bezier(.2,0,0,1)}
.dm .in{position:relative;height:100%;overflow:hidden;
  clip-path:polygon(9px 0,100% 0,100% calc(100% - 9px),calc(100% - 9px) 100%,0 100%,0 9px);
  background:#08060F;color:#F58FCD;
  display:flex;align-items:center;gap:6px;padding:0 15px;
  font-size:11.5px;font-weight:500;letter-spacing:.1em;
  transition:color 190ms cubic-bezier(.2,0,0,1),background 200ms cubic-bezier(.2,0,0,1)}
.dm:hover{background:#FF3DA6}
.dm:hover .in{color:#fff;background:#160410}
.dm.dm-soon{cursor:default}
.dm .in::after{content:'';position:absolute;inset:0;pointer-events:none;opacity:0;
  background:repeating-linear-gradient(0deg,rgba(255,61,166,.1) 0 1px,transparent 1px 3px);
  transition:opacity 220ms cubic-bezier(.2,0,0,1)}
.dm:hover .in::after{opacity:1}
.dm .sl{position:absolute;left:0;right:0;height:1.5px;background:#FF3DA6;opacity:0;
  pointer-events:none}
.dm:hover .sl{animation:dmScan 340ms cubic-bezier(.2,0,0,1) 1}
@keyframes dmScan{0%{top:0;opacity:0}12%{opacity:.85}88%{opacity:.85}100%{top:100%;opacity:0}}
.dm .t{position:relative;display:inline-block}
.dm:hover .t{animation:dmGlitch 300ms steps(1) 1}
@keyframes dmGlitch{
  0%{transform:translate(0);text-shadow:none}
  15%{transform:translate(-2px,1px);text-shadow:-2px 0 #3DE0F0,2px 0 #FF3DA6;clip-path:inset(20% 0 45% 0)}
  30%{transform:translate(2px,-1px);text-shadow:2px 0 #3DE0F0,-2px 0 #FF3DA6;clip-path:inset(55% 0 15% 0)}
  45%{transform:translate(-1px,0);text-shadow:-1px 0 #3DE0F0,1px 0 #FF3DA6;clip-path:inset(10% 0 70% 0)}
  60%{transform:translate(1px,1px);text-shadow:none;clip-path:inset(0)}
  100%{transform:translate(0);text-shadow:none;clip-path:inset(0)}}
@media (prefers-reduced-motion:reduce){
  .dm:hover .t,.dm:hover .sl{animation:none}
  .dm .in::after{transition:none}
}

/* ---- Mobile header, built deliberately (CCB-S3-037 4) -----------------------
   Not the desktop layout reflowed. Under 900px the main bar is the logo and the
   menu trigger, nothing else; the rail is hidden rather than allowed to wrap; and
   the Demo control moves into the menu at full size. */
.burger{display:none}
.cn-menu-demo{display:none}
@media (max-width:900px){
  .rail{display:none}
  .nav-desktop{display:none}
  .burger{display:inline-flex}
  .site-header .hdr-row{height:60px;gap:12px}
  /* Raised specificity: the base .hdr-iconbtn and .cn-menu-close rules sit LATER
     in the sheet and would otherwise win on source order, leaving 38px and 40px
     targets on a phone. */
  .site-header .hdr-iconbtn{width:44px;height:44px;margin-left:auto}
  .cn-menu-demo{display:block}
  .cn-menu-demo .dm{height:46px}
  .cn-menu-demo .dm .in{font-size:13px;padding:0 22px;justify-content:center}
  /* Real touch targets, reachable one-handed. */
  .cn-menu-entry{padding:13px 10px}
  .cme-label{font-size:15.5px}
  .cn-menu .cn-menu-close{width:46px;height:46px}
}

/* ---- The navigation panel: the admin's mega panel, COPIED (CCB-S3-038 1) -----
   Rules lifted verbatim from assets/app.css with admin-mega- renamed. Five
   admin tokens have no site equivalent and are aliased below with the admin's
   EXACT values, so nothing drifts; --line and --line-strong were already
   identical to the site's --border-hairline and --border-strong. */
:root{
  --mega-line:rgba(69,189,209,.12);
  --mega-line-strong:rgba(69,189,209,.28);
  --mega-accent-strong:#8fe1ec;
  --mega-brand-strong:#fba9d6;
  --mega-text:#e8edf4;
}
.cn-mega-shell{position:absolute;top:100%;right:0;left:0;z-index:70;
  visibility:hidden;pointer-events:none;
  border-top:1px solid rgba(232,56,159,.18);
  border-bottom:1px solid var(--mega-line-strong);
  background:
    radial-gradient(circle at 22% 0,rgba(232,56,159,.13),transparent 26rem),
    radial-gradient(circle at 82% 18%,rgba(69,189,209,.11),transparent 30rem),
    rgba(5,10,18,.975);
  box-shadow:0 34px 74px rgba(0,0,0,.5);
  opacity:0;transform:translateY(-12px);
  transition:visibility 0s linear 190ms,opacity 150ms ease,
    transform 190ms cubic-bezier(.2,.8,.2,1);
  backdrop-filter:blur(26px) saturate(145%)}
.cn-mega-shell[data-open='true']{visibility:visible;pointer-events:auto;opacity:1;
  transform:translateY(0);transition-delay:0s}
.cn-mega-panel[hidden]{display:none}
.cn-mega-panel-inner{position:relative;display:grid;width:min(100%,1600px);margin:0 auto;
  padding:28px 38px 32px;
  grid-template-columns:minmax(220px,290px) minmax(0,1fr) auto;
  align-items:start;gap:34px}
.cn-mega-intro{padding-right:28px;border-right:1px solid var(--mega-line)}
.cn-mega-kicker{color:var(--mega-brand-strong);font-family:var(--font-mono);font-size:9px;
  font-weight:500;letter-spacing:.14em;text-transform:uppercase}
.cn-mega-title{margin:7px 0 0;font-size:24px;line-height:1.1;color:var(--mega-text)}
.cn-mega-description{margin:10px 0 0;color:var(--text-muted);font-size:13px;line-height:1.55}
.cn-mega-overview-link{display:inline-flex;margin-top:16px;align-items:center;gap:7px;
  color:var(--mega-accent-strong);font-size:12px;font-weight:700;text-decoration:none}
.cn-mega-overview-link::after{content:'›';font-size:17px;line-height:1;
  transition:transform 140ms ease}
.cn-mega-overview-link:hover::after{transform:translateX(3px)}
.cn-mega-groups{display:grid;min-width:0;grid-template-columns:repeat(4,minmax(150px,1fr));
  gap:26px}
.cn-mega-group-title{margin:0 0 9px;color:var(--text-faint);font-family:var(--font-mono);
  font-size:9px;font-weight:500;letter-spacing:.11em;text-transform:uppercase}
.cn-mega-group-links{display:grid;gap:5px}
.cn-mega-link{display:grid;min-height:52px;grid-template-columns:30px minmax(0,1fr);
  align-items:center;gap:10px;border:1px solid transparent;border-radius:11px;padding:7px 9px;
  color:var(--text-muted);
  transition:border-color 140ms ease,background 140ms ease,color 140ms ease,transform 140ms ease}
.cn-mega-link-icon{display:grid;width:30px;height:30px;place-items:center;
  border:1px solid var(--mega-line);border-radius:9px;background:rgba(5,10,18,.56);
  color:var(--mega-accent-strong)}
.cn-mega-link-icon svg{width:15px;height:15px}
.cn-mega-link-copy{min-width:0}
.cn-mega-link-label{display:block;color:inherit;font-size:12px;font-weight:700}
.cn-mega-link-description{display:block;margin-top:2px;overflow:hidden;color:var(--text-faint);
  font-size:10px;line-height:1.35;text-overflow:ellipsis;white-space:nowrap}
.cn-mega-close{display:grid;width:34px;height:34px;place-items:center;cursor:pointer;
  border:1px solid var(--mega-line);border-radius:10px;background:rgba(5,10,18,.52);
  color:var(--text-muted);font:inherit;font-size:20px;line-height:1}
.cn-mega-close:hover{border-color:rgba(232,56,159,.34);color:var(--mega-brand-strong)}
@media (max-width:1100px){
  .cn-mega-panel-inner{padding-right:26px;padding-left:26px;
    grid-template-columns:minmax(190px,240px) minmax(0,1fr) auto;gap:24px}
  .cn-mega-groups{grid-template-columns:repeat(2,minmax(170px,1fr));gap:20px}
}
/* Below the mobile breakpoint the panel is the whole navigation, so it stacks and
   scrolls rather than sitting as a strip under a header that has no nav in it. */
@media (max-width:900px){
  .cn-mega-shell{position:fixed;top:60px;bottom:0;overflow-y:auto}
  .cn-mega-panel-inner{grid-template-columns:1fr;gap:18px;padding:18px 18px 28px}
  .cn-mega-intro{padding-right:0;border-right:0;border-bottom:1px solid var(--mega-line);
    padding-bottom:14px}
  .cn-mega-groups{grid-template-columns:1fr}
  .cn-mega-link{min-height:60px}
  .cn-mega-link-label{font-size:14px}
  .cn-mega-link-description{font-size:11.5px;white-space:normal}
  .cn-mega-close{width:44px;height:44px}
}
@media (prefers-reduced-motion:reduce){
  .cn-mega-shell,.cn-mega-link,.cn-mega-overview-link::after{transition:none}
}
.cn-menu-demo{display:none}
@media (max-width:900px){.cn-menu-demo{display:block;margin-top:18px}}

/* ---- Hero (CCB-S3-038 2) ----------------------------------------------------
   ONE COLUMN, ONE MEASURE, ONE LEFT EDGE. The headline, the paragraph, the button
   row and the feature row all start on the same vertical line. Nothing in this
   column is centred; the feature row used to be, so it lined up with nothing. */
.hero-col{max-width:560px}
.hero-col > *{text-align:left;margin-left:0}
.hero-feats{display:flex;flex-wrap:nowrap;justify-content:flex-start;gap:20px}
.hero-feats > *{flex:0 0 auto}
.trust-item{display:inline-flex;align-items:center;gap:7px;white-space:nowrap;
  position:relative;opacity:0;transform:translateY(6px);
  animation:trustIn .5s cubic-bezier(.2,.8,.2,1) forwards}
@keyframes trustIn{to{opacity:1;transform:translateY(0)}}
/* Staggered, because simultaneous reads as a rendering fault. */
.hero-feats > *:nth-child(1){animation-delay:0ms}
.hero-feats > *:nth-child(2){animation-delay:110ms}
.hero-feats > *:nth-child(3){animation-delay:220ms}
.hero-feats > *:nth-child(4){animation-delay:330ms}
@media (max-width:900px){
  .hero-feats{flex-wrap:wrap;gap:12px 18px}
}

/* THE ROTATOR RESERVES HEIGHT, NEVER WIDTH. Every phrase occupies the same grid
   cell, so the row sizes to the tallest and nothing shifts vertically; the
   column's max-width caps the line, so nothing overruns horizontally. No explicit
   width is set anywhere on the rotator, which is what made the old version leave
   short phrases hanging past the paragraph. */
.hero-rot{display:grid}
.hero-rot > .ph{grid-area:1 / 1;opacity:0}
.hero-rot > .ph[data-on]{opacity:1}
/* The header controls' glitch: hard steps, a brief cyan and magenta tear. */
.hero-rot > .ph.glitch{animation:heroGlitch 340ms steps(1,end) both}
@keyframes heroGlitch{
  0%{transform:translate3d(0,0,0);clip-path:inset(0 0 0 0);
     text-shadow:-2px 0 rgba(244,92,176,.9),2px 0 rgba(141,225,236,.9)}
  20%{transform:translate3d(-3px,0,0);clip-path:inset(12% 0 46% 0)}
  40%{transform:translate3d(3px,0,0);clip-path:inset(54% 0 12% 0);
     text-shadow:3px 0 rgba(244,92,176,.9),-3px 0 rgba(141,225,236,.9)}
  60%{transform:translate3d(-2px,0,0);clip-path:inset(28% 0 34% 0)}
  80%{transform:translate3d(1px,0,0);clip-path:inset(0 0 0 0)}
  100%{transform:translate3d(0,0,0);clip-path:inset(0 0 0 0);text-shadow:none}
}
@media (prefers-reduced-motion:reduce){
  .trust-item{opacity:1;transform:none;animation:none}
  .hero-rot > .ph.glitch{animation:none}
}

/* The two chips over the portrait: same size, same treatment, and offsets measured
   from the portrait's edge rather than left where they fell (CCB-S3-038 2d). */
.hero-stage{position:relative}
.pchip{position:absolute;display:inline-flex;align-items:center;gap:7px;
  height:30px;padding:0 13px;border-radius:999px;
  font-size:11.5px;font-weight:600;white-space:nowrap;
  border:1px solid var(--border-strong);background:rgba(5,10,18,.86);
  color:var(--text-bright);backdrop-filter:blur(8px)}
.pchip .d{width:6px;height:6px;border-radius:50%;background:var(--cyan-400);flex:none}
.pchip.c1{top:9%;right:-4%}
.pchip.c2{bottom:9%;left:-4%}
@media (max-width:900px){
  .pchip.c1{top:4%;right:2%}
  .pchip.c2{bottom:4%;left:2%}
}

/* ---- Breadcrumbs and previous/next ---------------------------------------- */
.crumbs{display:flex;flex-wrap:wrap;align-items:center;gap:6px;padding-top:18px;font-size:13px;
  color:var(--text-muted)}
.crumbs a{color:var(--text-muted)}
.crumbs a:hover{color:var(--text-accent)}
.crumb-sep{opacity:.45}
.crumb-here{color:var(--text)}
.prevnext{display:grid;grid-template-columns:1fr 1fr;gap:14px;margin:56px auto 72px}
.pn{display:flex;flex-direction:column;gap:4px;padding:16px 18px;border-radius:14px;
  border:1px solid var(--border);background:var(--bg-panel)}
.pn:hover{border-color:var(--text-accent)}
.pn-empty{border:0;background:none}
.pn-label{display:inline-flex;align-items:center;gap:5px;font-size:12px;color:var(--text-muted);
  text-transform:uppercase;letter-spacing:.06em}
.pn-title{font-size:15px;font-weight:600;color:var(--text)}
.pn-next{text-align:right;align-items:flex-end}
@media (max-width:640px){.prevnext{grid-template-columns:1fr}.pn-empty{display:none}}

/* ---- The generic content page --------------------------------------------- */
.doc-page{max-width:820px}
.doc-sec{margin-bottom:44px}
.doc-sec h2{display:flex;flex-wrap:wrap;align-items:center;gap:10px;font-size:23px;font-weight:600;
  margin:0 0 14px;color:var(--text)}
.doc-sec p{margin:0 0 14px;line-height:1.72;color:var(--text-muted)}
.doc-list{margin:0 0 16px;padding-left:20px;display:flex;flex-direction:column;gap:7px}
.doc-list li{line-height:1.65;color:var(--text-muted)}
.doc-callout{margin:18px 0 0;padding:14px 18px;border-radius:12px;
  border-left:3px solid var(--text-accent);background:var(--bg-panel);
  color:var(--text);font-weight:500}
.fallback-note{margin:18px 0 0;font-size:13px;color:var(--text-muted);
  border-left:2px solid var(--border);padding-left:12px}
.doc h2{font-size:22px;font-weight:600;margin:0 0 18px;color:var(--text)}
.doc h3{font-size:18px;margin:28px 0 8px}
.doc p,.doc li{font-size:14px;line-height:1.7;color:var(--text-muted)}
.mono-block{background:var(--surface-field);border:1px solid var(--border-neutral);border-radius:var(--radius-sm);padding:14px 16px;font-family:var(--font-mono);font-size:13px;line-height:1.8;color:var(--text-body);overflow-x:auto}
.nav-desktop{display:flex;align-items:center}
.burger{display:none}
main,footer,header{position:relative;z-index:1}
.site-header{position:sticky;top:0;z-index:80;background:color-mix(in srgb,var(--surface-page) 80%,transparent);backdrop-filter:blur(16px);-webkit-backdrop-filter:blur(16px);border-bottom:1px solid var(--border-neutral)}
.site-header::after{content:"";position:absolute;left:0;right:0;bottom:-1px;height:1px;background:linear-gradient(90deg,transparent,var(--magenta-500),transparent);background-size:38% 100%;background-repeat:no-repeat;animation:hbeam 5.5s linear infinite;pointer-events:none}
@keyframes hbeam{0%{background-position:-60% 0}100%{background-position:160% 0}}
@media (prefers-reduced-motion:reduce){.site-header::after{animation:none;opacity:.4}}
/* THE OLD PER-ITEM UNDERLINE IS GONE (CCB-S3-036 1).
   It drew a cyan 1px ::after under every hovered or active nav item, and the
   travelling .nav-indicator was added above without removing it, so two bars sat
   under the same item, cyan and magenta. .nav-link{position:relative} went with
   it: it existed only to anchor that ::after, and leaving it would have made the
   absolutely positioned indicator resolve against the ITEM instead of the nav,
   which is a second bug wearing the first one's clothes. One indicator, nothing
   else under a nav item. */
.hdr-iconbtn{display:inline-flex;align-items:center;justify-content:center;width:38px;height:38px;border:1px solid transparent;border-radius:var(--radius-sm);background:none;color:var(--text-muted);cursor:pointer;transition:color .15s,background .15s}
.hdr-iconbtn:hover{color:var(--text-bright);background:var(--surface-hover)}
.hdr-iconbtn:focus-visible{outline:none;box-shadow:var(--focus-ring)}
.nav-login{display:inline-flex;align-items:center;gap:6px;height:38px;padding:0 15px;border:1px solid var(--border-strong);border-radius:var(--radius-sm);font-size:14px;font-weight:600;color:var(--text-accent);text-decoration:none;transition:background .15s,border-color .15s}
.nav-login:hover{background:var(--surface-accent-weak);border-color:var(--accent);text-decoration:none;color:var(--text-accent)}
[data-reveal]{opacity:0;transform:translateY(26px);transition:opacity .7s var(--ease-out),transform .7s var(--ease-out)}
[data-reveal].on{opacity:1;transform:none}
.no-js [data-reveal]{opacity:1;transform:none}
@media (prefers-reduced-motion:reduce){[data-reveal]{opacity:1;transform:none}}
.fx-hero{position:relative;overflow:hidden;isolation:isolate}
.fx-hero::before{content:"";position:absolute;z-index:-2;left:-15%;right:-15%;top:-24%;height:86%;background:radial-gradient(46% 56% at 30% 40%,rgba(232,56,159,.24),transparent 68%),radial-gradient(42% 52% at 74% 32%,rgba(69,189,209,.12),transparent 72%);filter:blur(48px);animation:aurora 24s var(--ease-in-out) infinite alternate}
@keyframes aurora{to{transform:translate3d(4%,3%,0) scale(1.12)}}
.fx-hero::after{content:"";position:absolute;z-index:-1;inset:0;background-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='120' height='120'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='.9' numOctaves='2' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='120' height='120' filter='url(%23n)'/%3E%3C/svg%3E");opacity:.05;pointer-events:none;mix-blend-mode:overlay}
@media (prefers-reduced-motion:reduce){.fx-hero::before{animation:none}}
footer .fcol a{transition:color var(--duration-fast) var(--ease)}
footer .fcol a:hover{color:var(--text-accent);text-decoration:none}
.fx-pulse-sm{width:7px;height:7px;border-radius:99px;background:var(--cyan-400);box-shadow:0 0 10px rgba(69,189,209,.9);animation:fxpulse 1.6s ease infinite}
@keyframes fxpulse{50%{opacity:.35}}
@keyframes fxfeedin{from{opacity:0;transform:translateY(6px)}}
.mobile-menu{display:none}
footer a{color:var(--text-muted);font-size:14px}
footer a:hover{color:var(--text-accent);text-decoration:none}
@media (max-width:1023px){.grid4{grid-template-columns:1fr 1fr}.grid3{grid-template-columns:1fr 1fr}}
@media (max-width:959px){.nav-desktop{display:none!important}.burger{display:inline-flex}.mobile-menu{display:block}}
@media (max-width:639px){.grid4,.grid3,.grid2{grid-template-columns:1fr}section.band{padding:64px 0 0}.wrap{padding:0 18px}}
.grad-text{background:linear-gradient(115deg,#FBA9D6,#E8389F 55%,#C21E80);-webkit-background-clip:text;background-clip:text;color:transparent;-webkit-text-fill-color:transparent;padding-bottom:.05em}
.ann{display:inline-flex;align-items:center;gap:10px;padding:5px 6px 5px 14px;border:1px solid var(--border-hairline);border-radius:99px;background:var(--surface-field);font-size:13px;color:var(--text-muted);text-decoration:none;transition:border-color .2s var(--ease),color .2s var(--ease)}
.ann:hover{border-color:var(--border-strong);color:var(--text-bright);text-decoration:none}
.ann-dot{width:7px;height:7px;border-radius:99px;background:var(--magenta-400);box-shadow:0 0 10px rgba(232,56,159,.9)}
.ann-chip{display:inline-flex;align-items:center;justify-content:center;width:22px;height:22px;border-radius:99px;background:var(--neon-weak);color:var(--text-neon)}
.trust{display:flex;flex-wrap:wrap;justify-content:center;gap:9px 22px;margin:24px auto 0;font-family:var(--font-mono);font-size:12px;color:var(--text-faint)}
.trust span{display:inline-flex;align-items:center;gap:7px}
.hero-visual{position:relative;width:100%;max-width:960px;margin:52px auto 0}
.hero-visual::before{content:"";position:absolute;z-index:-1;inset:-12% -8% -28%;background:radial-gradient(50% 46% at 50% 2%,rgba(232,56,159,.22),transparent 70%);filter:blur(36px)}
.foot-top{position:absolute;top:0;left:0;right:0;height:1px;background:linear-gradient(90deg,transparent,var(--border-strong),transparent)}
.cn-btn-primary{background:linear-gradient(180deg,var(--magenta-400),var(--magenta-500))!important;color:#170410!important;box-shadow:inset 0 1px 0 rgba(255,255,255,.32),0 0 24px rgba(232,56,159,.38)!important}
.cn-btn-primary:hover:not(:disabled){background:linear-gradient(180deg,var(--magenta-300),var(--magenta-400))!important;box-shadow:inset 0 1px 0 rgba(255,255,255,.4),var(--glow-neon)!important}
.cn-btn-secondary{background:rgba(69,189,209,.1)!important;border-color:rgba(69,189,209,.45)!important;color:var(--cyan-200)!important}
.cn-btn-secondary:hover:not(:disabled){background:rgba(69,189,209,.16)!important;border-color:var(--cyan-400)!important;color:#EAFBFF!important}
.wordmark{display:inline-flex;align-items:center;text-decoration:none}
.wordmark:hover{text-decoration:none}
.hero-cine{display:grid;grid-template-columns:1.15fr .85fr;gap:44px;align-items:center;text-align:left;padding:72px 0 84px}
.hero-cine .hero-stage{align-self:center}
.hero-h1{font-size:clamp(24px,3.4vw,46px)!important;line-height:1.04}
.hero-cine .htext{display:flex;flex-direction:column;align-items:flex-start}
.hero-stage{position:relative;display:flex;align-items:center;justify-content:center}
.pring{position:relative;width:min(420px,92%);aspect-ratio:1;border-radius:50%}
.pring img{width:100%;height:100%;object-fit:cover;border-radius:50%;display:block;box-shadow:0 0 0 2px rgba(232,56,159,.95),0 0 60px rgba(232,56,159,.4),0 0 140px rgba(232,56,159,.22)}
.pring::before{content:"";position:absolute;inset:-7%;border-radius:50%;z-index:-1;background:conic-gradient(from 0deg,rgba(232,56,159,0),rgba(232,56,159,.55),rgba(69,189,209,.35),rgba(232,56,159,0));filter:blur(26px);animation:spin 16s linear infinite}
@keyframes spin{to{transform:rotate(360deg)}}
@media (prefers-reduced-motion:reduce){.pring::before{animation:none}}
.pchip{position:absolute;z-index:5;display:inline-flex;align-items:center;gap:7px;background:rgba(12,5,14,.82);backdrop-filter:blur(10px);-webkit-backdrop-filter:blur(10px);border:1px solid rgba(232,56,159,.32);border-radius:99px;padding:7px 12px;font-family:var(--font-mono);font-size:11.5px;color:#f5d6ea;box-shadow:0 8px 30px rgba(0,0,0,.5)}
.pchip .d{width:7px;height:7px;border-radius:99px;background:var(--magenta-400);box-shadow:0 0 10px rgba(232,56,159,.9)}
.pchip.c1{top:13%;left:-3%}
.pchip.c2{bottom:11%;right:-4%;border-color:rgba(69,189,209,.32);color:#cdeff5}
.pchip.c2 .d{background:var(--cyan-400);box-shadow:0 0 10px rgba(69,189,209,.9)}
@media (max-width:860px){.hero-cine{grid-template-columns:1fr;text-align:center}.hero-cine .htext{align-items:center}.hero-stage{order:-1}.trust{justify-content:center!important}}
.cn-sechead-eyebrow{color:var(--text-neon)!important}
.cn-ftile-icon{color:var(--text-neon)!important;background:var(--neon-weak)!important;border-color:rgba(232,56,159,.2)!important}
.cn-card-accent{border-color:rgba(232,56,159,.42)!important;box-shadow:var(--edge-lit),var(--glow-neon),var(--shadow-1)!important}
.cn-card-hover:hover{box-shadow:var(--edge-lit),var(--glow-neon),var(--shadow-2)!important;border-color:rgba(232,56,159,.32)!important}
footer a:hover,footer .fcol a:hover{color:var(--text-neon)!important}
body::before{content:"";position:fixed;inset:0;z-index:0;pointer-events:none;background:radial-gradient(40% 40% at 12% 4%,rgba(232,56,159,.14),transparent 60%),radial-gradient(44% 42% at 88% 24%,rgba(69,189,209,.10),transparent 62%),radial-gradient(46% 40% at 20% 58%,rgba(232,56,159,.09),transparent 60%),radial-gradient(52% 44% at 82% 90%,rgba(69,189,209,.09),transparent 60%);animation:ambient 28s var(--ease-in-out) infinite alternate}
body::after{content:"";position:fixed;inset:0;z-index:0;pointer-events:none;opacity:.045;mix-blend-mode:overlay;background-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='120' height='120'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='.9' numOctaves='2' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='120' height='120' filter='url(%23n)'/%3E%3C/svg%3E")}
@keyframes ambient{to{transform:translate3d(0,-2.5%,0) scale(1.07)}}
@media (prefers-reduced-motion:reduce){body::before{animation:none}}
.cn-card:has(.cn-ftile-icon),.cn-card:has(.cn-tier-name){position:relative;overflow:hidden;transition:box-shadow .3s var(--ease),transform .3s var(--ease),border-color .3s var(--ease)}
.cn-card:has(.cn-ftile-icon):hover,.cn-card:has(.cn-tier-name):hover{transform:translateY(-3px);border-color:rgba(232,56,159,.38)!important;box-shadow:var(--edge-lit),var(--glow-neon),var(--shadow-2)!important}
.cn-card:has(.cn-ftile-icon):hover .cn-ftile-icon{box-shadow:var(--edge-lit),var(--glow-neon-sm)!important;border-color:rgba(232,56,159,.4)!important}
.cn-card:has(.cn-ftile-icon)::after,.cn-card:has(.cn-tier-name)::after{content:"";position:absolute;top:0;left:-75%;width:55%;height:100%;background:linear-gradient(100deg,transparent,rgba(255,255,255,.13),transparent);transform:skewX(-18deg);pointer-events:none;opacity:0}
.cn-card:has(.cn-ftile-icon):hover::after,.cn-card:has(.cn-tier-name):hover::after{opacity:1;animation:sheen 1s var(--ease-out)}
@keyframes sheen{0%{left:-75%}100%{left:135%}}
@media (prefers-reduced-motion:reduce){.cn-card:has(.cn-ftile-icon):hover::after,.cn-card:has(.cn-tier-name):hover::after{animation:none;opacity:0}}
@keyframes symRise{from{opacity:0;transform:translateY(22px)}to{opacity:1;transform:none}}
@keyframes symLeft{from{opacity:0;transform:translateX(-28px)}to{opacity:1;transform:none}}
@keyframes symRight{from{opacity:0;transform:translateX(30px)}to{opacity:1;transform:none}}
@keyframes symScale{from{opacity:0;transform:scale(.92)}to{opacity:1;transform:none}}
@keyframes symBlur{from{opacity:0;filter:blur(12px);transform:translateY(10px)}to{opacity:1;filter:none;transform:none}}
.sym{opacity:0;animation-duration:.75s;animation-timing-function:var(--ease-out);animation-fill-mode:both}
.sym-rise{animation-name:symRise}
.sym-left{animation-name:symLeft}
.sym-right{animation-name:symRight;animation-duration:.9s}
.sym-scale{animation-name:symScale;animation-duration:.85s}
.sym-blur{animation-name:symBlur;animation-duration:.95s}
@media (prefers-reduced-motion:reduce){.sym{animation:none;opacity:1;filter:none;transform:none}}
#cn-starfield{position:fixed;inset:0;z-index:0;pointer-events:none}
.footer-share{margin-top:8px;padding:0 24px 8px}
.footer-share .share-title{display:flex;align-items:center;gap:7px;font-family:var(--font-mono);font-size:11px;letter-spacing:.08em;text-transform:uppercase;color:var(--text-faint);margin:0 0 10px}
.share-links{display:flex;flex-wrap:wrap;gap:8px}
.share-links a{display:inline-flex;align-items:center;height:28px;padding:0 12px;border:1px solid var(--border-neutral);border-radius:99px;background:var(--surface-field);color:var(--text-muted);font-size:13px;font-weight:600}
.share-links a:hover{border-color:var(--border-strong);color:var(--text-accent);text-decoration:none}
.burger .i-close{display:none}
.burger.open .i-close{display:inline}
.burger.open .i-menu{display:none}
.stub-hero{padding:96px 0 40px;text-align:center}
.stub-hero h1{font-size:var(--size-display);margin:16px 0 12px;letter-spacing:-.025em}
.stub-hero p{color:var(--text-muted);max-width:52ch;margin:0 auto 10px;font-size:16px}
.stub-cta{display:flex;gap:12px;justify-content:center;flex-wrap:wrap;margin-top:26px}
`;

/** The interactive archive-demo frame (the product as hero). */
const DEMO_CSS = `
.ad-frame{width:100%;text-align:left;background:var(--surface-card);border:1px solid var(--border-strong);border-radius:var(--radius-lg);box-shadow:var(--edge-lit),var(--glow-accent),var(--shadow-3);overflow:hidden}
.ad-titlebar{display:flex;align-items:center;gap:7px;padding:11px 14px;border-bottom:1px solid var(--border-neutral);background:var(--surface-raised)}
.ad-dot{width:11px;height:11px;border-radius:99px;flex:none;opacity:.9}
.ad-url{margin-left:10px;display:inline-flex;align-items:center;gap:6px;font-family:var(--font-mono);font-size:12px;color:var(--text-muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.ad-badge{margin-left:auto;font-family:var(--font-mono);font-size:11px;letter-spacing:.08em;color:var(--text-faint);border:1px solid var(--border-neutral);border-radius:99px;padding:2px 9px}
.ad-body{display:grid;grid-template-columns:212px 1fr;min-height:396px}
.ad-side{border-right:1px solid var(--border-neutral);padding:14px 12px;display:flex;flex-direction:column;gap:3px;background:color-mix(in srgb,var(--surface-raised) 55%,transparent)}
.ad-side-label{font-family:var(--font-mono);font-size:10px;letter-spacing:.1em;color:var(--text-faint);padding:2px 8px 8px}
.ad-g{display:flex;align-items:center;gap:9px;width:100%;border:none;background:none;cursor:pointer;font-family:var(--font-sans);font-size:13.5px;color:var(--text-muted);padding:8px 9px;border-radius:var(--radius-sm);text-align:left;transition:background var(--duration-fast) var(--ease),color var(--duration-fast) var(--ease)}
.ad-g:hover{background:var(--surface-hover);color:var(--text-bright)}
.ad-g.on{background:var(--surface-accent-weak);color:var(--text-accent);box-shadow:inset 0 0 0 1px var(--border-hairline)}
.ad-count{margin-left:auto;font-family:var(--font-mono);font-size:11px;color:var(--text-faint);background:var(--surface-field);border-radius:99px;padding:1px 7px}
.ad-g.on .ad-count{color:var(--text-accent)}
.ad-consent{margin-top:auto;display:flex;gap:8px;align-items:flex-start;font-size:11.5px;line-height:1.45;color:var(--text-faint);padding:10px 8px 2px}
.ad-main{display:flex;flex-direction:column;min-width:0}
.ad-searchbar{display:flex;align-items:center;gap:10px;padding:14px 16px;border-bottom:1px solid var(--border-neutral)}
.ad-input{flex:1;min-width:0;background:none;border:none;outline:none;font-family:var(--font-sans);font-size:15px;color:var(--text-bright);caret-color:var(--cyan-400)}
.ad-input::placeholder{color:var(--text-faint)}
.ad-clear{border:none;background:none;cursor:pointer;color:var(--text-faint);display:none;padding:2px;border-radius:99px}
.ad-clear:hover{color:var(--text-bright)}
.ad-filters{display:flex;align-items:center;gap:10px;padding:11px 16px;border-bottom:1px solid var(--border-neutral);flex-wrap:wrap}
.ad-resultcount{margin-left:auto;font-family:var(--font-mono);font-size:12px;color:var(--text-muted)}
.ad-stream{padding:6px 8px 10px;max-height:300px;overflow-y:auto}
.ad-scroll::-webkit-scrollbar{width:8px}.ad-scroll::-webkit-scrollbar-thumb{background:var(--border-strong);border-radius:8px}.ad-scroll::-webkit-scrollbar-track{background:transparent}
.ad-msg{display:flex;gap:12px;padding:11px 10px;border-radius:var(--radius-sm);animation:fxfeedin .35s var(--ease-out)}
.ad-msg:hover{background:var(--surface-hover)}
.ad-avatar{flex:none;width:30px;height:30px;border-radius:99px;display:flex;align-items:center;justify-content:center;font-family:var(--font-mono);font-size:13px;font-weight:600;color:var(--text-accent);background:var(--surface-accent-weak);border:1px solid var(--border-hairline)}
.ad-meta{display:flex;align-items:center;gap:9px;flex-wrap:wrap}
.ad-meta b{font-size:14px;color:var(--text-bright);font-weight:600}
.ad-grp{font-family:var(--font-mono);font-size:11.5px;color:var(--text-accent)}
.ad-time{font-family:var(--font-mono);font-size:11px;color:var(--text-faint)}
.ad-arch{margin-left:auto;display:inline-flex;align-items:center;gap:4px;font-family:var(--font-mono);font-size:10.5px;color:var(--success)}
.ad-text{font-size:14px;color:var(--text-body);line-height:1.5;margin-top:2px}
mark.ad-hl{background:rgba(69,189,209,.28);color:var(--text-bright);border-radius:3px;padding:0 2px;box-shadow:0 0 10px rgba(69,189,209,.3)}
.ad-chip{display:inline-flex;align-items:center;gap:6px;margin-top:8px;padding:4px 9px;border:1px solid var(--border-neutral);border-radius:var(--radius-sm);font-family:var(--font-mono);font-size:11.5px;color:var(--text-muted);background:var(--surface-field)}
.ad-empty{display:none;flex-direction:column;align-items:center;justify-content:center;gap:10px;padding:56px 20px;text-align:center;color:var(--text-muted);font-size:14px}
@media (max-width:719px){.ad-body{grid-template-columns:1fr}.ad-side{flex-direction:row;flex-wrap:wrap;border-right:none;border-bottom:1px solid var(--border-neutral)}.ad-side-label,.ad-consent{display:none}.ad-g{width:auto}}
`;

/** Design-system component CSS (from the template's bundled Cinderella DS). */
function componentsCss(): string {
  const checkMask = iconMaskDataUri('check');
  return `
.cn-badge{display:inline-flex;align-items:center;gap:5px;height:20px;padding:0 8px;border-radius:var(--radius-xs);font-family:var(--font-sans);font-size:11px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;white-space:nowrap;border:1px solid transparent}
.cn-badge-neutral{background:var(--surface-hover);color:var(--text-muted)}
.cn-badge-accent{background:var(--info-surface);color:var(--text-accent);border-color:var(--border-hairline)}
.cn-badge-success{background:var(--success-surface);color:var(--success)}
.cn-badge-warning{background:var(--warning-surface);color:var(--warning)}
.cn-badge-danger{background:var(--danger-surface);color:var(--danger)}
.cn-badge-outline{background:transparent;color:var(--text-muted);border-color:var(--border-neutral)}
.cn-card{border-radius:var(--radius-md);font-family:var(--font-sans)}
.cn-card-default{background:var(--card-sheen),var(--surface-card);border:1px solid var(--border-hairline);box-shadow:var(--edge-lit),var(--shadow-1)}
.cn-card-quiet{background:var(--surface-raised);border:1px solid var(--border-neutral)}
.cn-card-accent{background:var(--card-sheen),var(--surface-card);border:1px solid var(--border-strong);box-shadow:var(--edge-lit),var(--glow-accent),var(--shadow-1)}
.cn-card-pad-md{padding:20px}
.cn-card-pad-lg{padding:28px}
.cn-tag{display:inline-flex;align-items:center;gap:6px;height:28px;padding:0 10px;border-radius:var(--radius-sm);border:1px solid var(--border-neutral);background:transparent;font-family:var(--font-sans);font-size:13px;color:var(--text-body);transition:background var(--duration-fast) var(--ease),border-color var(--duration-fast) var(--ease),color var(--duration-fast) var(--ease)}
button.cn-tag{cursor:pointer}
button.cn-tag:hover{border-color:var(--border-strong);color:var(--text-bright)}
button.cn-tag:focus-visible{outline:none;box-shadow:var(--focus-ring)}
.cn-tag-selected{background:var(--surface-accent-weak);border-color:var(--border-strong);color:var(--text-accent)}
button.cn-tag-selected:hover{border-color:var(--accent);color:var(--accent-hover)}
.cn-btn{display:inline-flex;align-items:center;justify-content:center;gap:8px;border:1px solid transparent;border-radius:var(--radius-sm);font-family:var(--font-sans);font-weight:600;cursor:pointer;transition:background var(--duration-fast) var(--ease),color var(--duration-fast) var(--ease),border-color var(--duration-fast) var(--ease),box-shadow var(--duration-base) var(--ease),transform var(--duration-fast) var(--ease);text-decoration:none;white-space:nowrap}
.cn-btn:hover{text-decoration:none}
.cn-btn:focus-visible{outline:none;box-shadow:var(--focus-ring)}
.cn-btn:active:not(:disabled){transform:translateY(1px)}
.cn-btn:disabled{opacity:.4;cursor:not-allowed}
.cn-btn-sm{height:32px;padding:0 14px;font-size:13px}
.cn-btn-md{height:40px;padding:0 18px;font-size:14px}
.cn-btn-lg{height:48px;padding:0 24px;font-size:15px}
.cn-btn-ghost{background:transparent;color:var(--text-body)}
.cn-btn-ghost:hover:not(:disabled){background:var(--surface-hover);color:var(--text-bright)}
.cn-btn-full{width:100%}
.cn-field{display:flex;flex-direction:column;gap:6px;font-family:var(--font-sans)}
.cn-field-label{font-size:13px;font-weight:600;color:var(--text-bright)}
.cn-field-hint{font-size:12px;color:var(--text-faint)}
.cn-input{font-family:var(--font-sans);font-size:14px;color:var(--text-bright);background:var(--surface-field);border:1px solid var(--border-neutral);border-radius:var(--radius-sm);transition:border-color var(--duration-fast) var(--ease),box-shadow var(--duration-fast) var(--ease)}
.cn-input::placeholder{color:var(--text-faint)}
.cn-input:hover:not(:disabled){border-color:var(--border-strong)}
.cn-input:focus{outline:none;border-color:var(--accent);box-shadow:var(--focus-ring)}
.cn-input-md{height:40px;padding:0 12px}
.cn-tabs{display:flex;font-family:var(--font-sans)}
.cn-tabs-underline{gap:22px;border-bottom:1px solid var(--border-neutral)}
.cn-tabs-underline .cn-tab{border:none;background:none;cursor:pointer;padding:10px 2px;font-size:14px;font-weight:600;color:var(--text-muted);border-bottom:2px solid transparent;margin-bottom:-1px;text-decoration:none;transition:color var(--duration-fast) var(--ease),border-color var(--duration-fast) var(--ease)}
.cn-tabs-underline .cn-tab:hover{color:var(--text-bright);text-decoration:none}
.cn-tabs-underline .cn-tab[aria-current="page"]{color:var(--text-accent);border-bottom-color:var(--accent)}
.cn-tab:focus-visible{outline:none;box-shadow:var(--focus-ring)}
.cn-sechead{font-family:var(--font-sans);max-width:640px}
.cn-sechead-center{margin-left:auto;margin-right:auto;text-align:center}
.cn-sechead-eyebrow{font-size:12px;font-weight:700;letter-spacing:var(--tracking-caps);text-transform:uppercase;color:var(--text-accent);margin-bottom:10px}
.cn-sechead-title{font-size:var(--size-title);font-weight:700;letter-spacing:-.015em;line-height:1.2;color:var(--text-bright);margin:0}
.cn-sechead-lede{font-size:16px;line-height:1.6;color:var(--text-muted);margin:12px 0 0}
.cn-ftile-icon{width:40px;height:40px;border-radius:var(--radius-sm);background:var(--surface-accent-weak);border:1px solid var(--border-hairline);display:flex;align-items:center;justify-content:center;color:var(--text-accent);box-shadow:var(--edge-lit)}
.cn-ftile-title{font-size:16px;font-weight:700;color:var(--text-bright);margin:14px 0 0;display:flex;align-items:center;gap:8px}
.cn-ftile-body{font-size:14px;line-height:1.6;color:var(--text-muted);margin:6px 0 0}
.cn-tier-name{font-size:14px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:var(--text-muted);display:flex;align-items:center;gap:8px}
.cn-tier-highlight .cn-tier-name{color:var(--text-accent)}
.cn-tier-price{margin:14px 0 2px;color:var(--text-bright)}
.cn-tier-price b{font-size:36px;font-weight:700;letter-spacing:-.02em}
.cn-tier-price span{font-size:14px;color:var(--text-faint);font-weight:400}
.cn-tier-desc{font-size:14px;color:var(--text-muted);line-height:1.55;margin:6px 0 0;min-height:44px}
.cn-tier-list{list-style:none;margin:18px 0 22px;padding:0;display:flex;flex-direction:column;gap:9px}
.cn-tier-list li{display:flex;gap:9px;align-items:flex-start;font-size:14px;color:var(--text-body)}
.cn-tier-list li::before{content:"";flex:none;width:16px;height:16px;margin-top:2px;background:var(--text-accent);-webkit-mask:url("${checkMask}") center/contain no-repeat;mask:url("${checkMask}") center/contain no-repeat}
.cn-cookiebar{position:fixed;left:0;right:0;bottom:0;z-index:90;background:var(--surface-raised);border-top:1px solid var(--border-hairline);box-shadow:var(--edge-lit),0 -8px 32px rgba(0,0,0,.4);font-family:var(--font-sans);animation:cn-cookie-in var(--duration-slow) var(--ease-out)}
.cn-cookiebar-inner{max-width:1200px;margin:0 auto;padding:14px 24px;display:flex;align-items:center;gap:20px;flex-wrap:wrap}
.cn-cookiebar-text{flex:1;min-width:260px;font-size:13px;line-height:1.55;color:var(--text-muted)}
.cn-cookiebar-text b{color:var(--text-bright);font-weight:700}
.cn-cookiebar-actions{display:flex;gap:10px}
@keyframes cn-cookie-in{from{transform:translateY(100%)}}
`;
}

/**
 * Layout classes replacing the template's inline styles. The site CSP is
 * `style-src 'nonce-…'`, and a nonce covers only <style> ELEMENTS — style
 * ATTRIBUTES are blocked. So every layout rule the React template carried as
 * `style={{…}}` lives here as a class; render.ts emits NO style attributes
 * (verify:site asserts this). Defined last so these win the cascade where they
 * override earlier component rules (e.g. section padding).
 */
const NO_INLINE_CSS = `
.hdr-row{display:flex;align-items:center;gap:20px;height:64px}
.hdr-nav{gap:2px;flex:1;margin-left:14px}
.hdr-controls{gap:10px}
.hdr-spacer{flex:1}
.hdr-iconbtn.burger{display:none}
@media (max-width:959px){.hdr-iconbtn.burger{display:inline-flex}}
.mobile-panel{border-top:1px solid var(--border-neutral);background:var(--surface-raised);padding:12px 24px 18px}
.mm-nav{display:flex;flex-direction:column;gap:2px}
.mm-controls{display:flex;gap:10px;align-items:center;margin-top:14px}
.wm-name{font-weight:700;font-size:20px;letter-spacing:-.03em;color:var(--text-bright)}
.wordmark-lg .wm-name{font-size:22px}
.wordmark-lg .page-hero{padding:80px 24px 64px;max-width:900px;position:relative}
.hero-badge{margin-bottom:16px}
.eyebrow-neon{font-size:12px;font-weight:700;letter-spacing:var(--tracking-caps);text-transform:uppercase;color:var(--text-neon);margin-bottom:14px}
.page-h1{font-size:var(--size-display);margin:0;letter-spacing:-.025em;line-height:1.06}
.page-lede{font-size:18px;line-height:1.6;color:var(--text-muted);max-width:640px;margin:18px 0 0}
.site-footer{margin-top:120px;border-top:1px solid var(--border-neutral);background:var(--surface-raised);position:relative}
.foot-grid{display:flex;gap:48px;padding:64px 24px 44px;flex-wrap:wrap}
.foot-brand{flex:1 1 280px}
.foot-blurb{font-size:14px;color:var(--text-muted);margin:14px 0 16px;max-width:320px;line-height:1.65}
.foot-badges{display:flex;gap:8px}
.fcol{min-width:150px}
.fcol-title{font-size:12px;font-weight:700;letter-spacing:var(--tracking-caps);text-transform:uppercase;color:var(--text-neon);margin-bottom:14px}
.fcol-links{display:flex;flex-direction:column;gap:10px}
.foot-bottom{display:flex;justify-content:space-between;gap:16px;flex-wrap:wrap;padding:18px 24px;border-top:1px solid var(--border-neutral);font-size:13px;color:var(--text-faint)}
.home-h1{margin:18px 0 22px;letter-spacing:-.03em}
.hline{display:block;white-space:nowrap}
.home-lede{font-size:18px;line-height:1.6;color:var(--text-muted);max-width:500px;margin:0}
.home-cta{display:flex;gap:12px;margin-top:26px;flex-wrap:wrap}
.trust-left{justify-content:flex-start}
.row-title{display:flex;align-items:center;gap:10px;flex-wrap:wrap}
.card-title{font-size:18px;font-weight:700;color:var(--text-bright)}
.card-title-sm{font-size:17px;font-weight:700;color:var(--text-bright)}
.card-title-lg{font-size:20px;font-weight:700;color:var(--text-bright)}
.card-lede{font-size:15px;line-height:1.65;color:var(--text-muted);margin:12px 0 18px}
.card-note{font-size:14px;color:var(--text-muted);margin:8px 0 0;line-height:1.6}
.card-para{font-size:14px;line-height:1.7;color:var(--text-muted);margin:10px 0 16px}
.card-para-tight{font-size:14px;line-height:1.7;color:var(--text-muted);margin:10px 0 0}
.list-col{display:flex;flex-direction:column;gap:11px;margin-top:16px}
.roadmap-row{display:flex;justify-content:space-between;align-items:center;border-bottom:1px solid var(--border-neutral);padding-bottom:10px;font-size:14px}
.card-split{display:flex;gap:48px;align-items:center;flex-wrap:wrap}
.card-row{display:flex;gap:32px;align-items:center;flex-wrap:wrap}
.split-main{flex:1 1 340px}
.split-320{flex:1 1 320px}
.split-side{flex:1 1 300px;display:flex;flex-direction:column;gap:12px}
.icon-line{display:flex;gap:11px;align-items:center;font-size:15px;color:var(--text-body)}
.chip-row{display:flex;gap:8px;flex-wrap:wrap}
.cap-list{display:flex;flex-direction:column;gap:16px}
.cap-card{display:flex;gap:24px;align-items:flex-start;flex-wrap:wrap}
.cap-icon{position:relative;width:44px;height:44px;flex:none;border-radius:var(--radius-sm);background:var(--neon-weak);border:1px solid rgba(232,56,159,.2);display:flex;align-items:center;justify-content:center;color:var(--text-neon)}
.cap-num{position:absolute;top:-9px;left:-9px;width:20px;height:20px;border-radius:99px;background:var(--surface-card);border:1px solid var(--border-neutral);font-family:var(--font-mono);font-size:10px;color:var(--text-faint);display:flex;align-items:center;justify-content:center}
.cap-main{flex:1 1 420px}
.cap-title{font-size:19px;font-weight:700;color:var(--text-bright)}
.cap-body{font-size:14px;line-height:1.7;color:var(--text-muted);margin:8px 0 14px;max-width:660px}
.pro-form{display:flex;gap:10px;align-items:flex-end;flex-wrap:wrap}
.pro-email{width:220px}
.sec-csam{display:flex;gap:36px;flex-wrap:wrap;align-items:center}
.sec-icon{width:44px;height:44px;border-radius:var(--radius-sm);background:var(--neon-weak);border:1px solid rgba(232,56,159,.28);display:flex;align-items:center;justify-content:center;color:var(--text-neon);box-shadow:var(--edge-lit),var(--glow-neon-sm)}
.sec-main{flex:1 1 360px}
.sec-title{font-size:22px;font-weight:700;color:var(--text-bright)}
.sec-body{font-size:15px;line-height:1.65;color:var(--text-muted);margin:10px 0 0;max-width:520px}
.sec-flow{flex:1 1 280px;display:flex;align-items:center;justify-content:center;gap:6px;flex-wrap:wrap}
.flow-node{text-align:center;padding:16px 14px;border-radius:var(--radius-md);border:1px solid var(--border-neutral);background:var(--surface-field);min-width:92px;color:var(--text-muted)}
.flow-node.on{border-color:rgba(232,56,159,.45);background:var(--neon-weak);box-shadow:var(--glow-neon-sm);color:var(--text-neon)}
.flow-label{font-family:var(--font-mono);font-size:11px;margin-top:8px}
.step-num{font-family:var(--font-mono);font-size:11px;color:var(--text-accent);margin-bottom:8px}
.step-title{font-size:15px;font-weight:700;color:var(--text-bright);margin-bottom:10px}
.mono-sm{font-size:12px}
.note-faint{font-size:13px;color:var(--text-faint);margin-top:16px}
.legal-card{margin-top:24px;max-width:860px}
.ad-dot-r{background:#E5646E}
.ad-dot-y{background:#E0B454}
.ad-dot-g{background:#4ADE9E}
.ad-msg-body{flex:1;min-width:0}
.ad-q{color:var(--text-accent)}
.ic-accent{color:var(--text-accent)}
.ic-muted{color:var(--text-muted)}
.ic-faint{color:var(--text-faint)}
.ic-neon{color:var(--text-neon)}
.ic-success{color:var(--success)}
section.pt40{padding-top:40px}
section.pt48{padding-top:48px}
section.pt64{padding-top:64px}
.mt16{margin-top:16px!important}
.mt22{margin-top:22px!important}
.mt36{margin-top:36px!important}
.mt40{margin-top:40px!important}
.mt48{margin-top:48px!important}
.grid-stretch{align-items:stretch}
.grid-start{align-items:start}
.d40{animation-delay:40ms}
.d120{animation-delay:120ms}
.d220{animation-delay:220ms}
.d240{animation-delay:240ms}
.d380{animation-delay:380ms}
.d480{animation-delay:480ms}
.d580{animation-delay:580ms}
/* --- Language dropdown (scales to the full locale set) --- */
.lang-menu{position:relative}
.lang-menu summary{list-style:none;cursor:pointer;display:inline-flex;align-items:center;gap:7px;height:38px;padding:0 12px;border:1px solid var(--border-neutral);border-radius:var(--radius-sm);font-size:12px;font-weight:700;letter-spacing:.04em;color:var(--text-muted);transition:color var(--duration-fast) var(--ease),border-color var(--duration-fast) var(--ease),background var(--duration-fast) var(--ease)}
.lang-menu summary::-webkit-details-marker{display:none}
.lang-menu summary:hover{color:var(--text-bright);border-color:var(--border-strong)}
.lang-menu summary:focus-visible{outline:none;box-shadow:var(--focus-ring)}
.lang-menu[open] summary{color:var(--text-accent);border-color:var(--border-strong);background:var(--surface-accent-weak)}
.lm-code{text-transform:uppercase;font-family:var(--font-mono)}
.lang-menu .lm-chev{transition:transform var(--duration-fast) var(--ease)}
.lang-menu[open] .lm-chev{transform:rotate(180deg)}
.lang-panel{position:absolute;right:0;top:calc(100% + 8px);z-index:95;width:340px;max-width:82vw;max-height:min(430px,70vh);overflow-y:auto;background:var(--surface-raised);border:1px solid var(--border-strong);border-radius:var(--radius-md);box-shadow:var(--edge-lit),var(--glow-accent),var(--shadow-2);padding:8px;display:grid;grid-template-columns:1fr 1fr;gap:2px;align-content:start}
.lang-panel::-webkit-scrollbar{width:8px}
.lang-panel::-webkit-scrollbar-thumb{background:var(--border-strong);border-radius:8px}
.lang-panel a{display:flex;align-items:center;gap:8px;padding:7px 9px;border-radius:var(--radius-sm);font-size:13px;color:var(--text-muted);text-decoration:none;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.lang-panel a:hover{background:var(--surface-hover);color:var(--text-bright);text-decoration:none}
.lang-panel a.on{background:var(--surface-accent-weak);color:var(--text-accent)}
.lang-panel .lc{flex:none;width:26px;font-family:var(--font-mono);font-size:10.5px;color:var(--text-faint);text-transform:uppercase}
.lang-panel a.on .lc{color:var(--text-accent)}
.mm-controls .lang-panel{left:0;right:auto}
/* --- Hero portrait hover (cooler mouse-over on the pring) --- */
.pring img{transition:transform var(--duration-slow) var(--ease-out),box-shadow var(--duration-slow) var(--ease),filter var(--duration-slow) var(--ease)}
.pring:hover img{transform:scale(1.045) rotate(1.4deg);filter:saturate(1.18) brightness(1.05);box-shadow:0 0 0 2.5px var(--magenta-400),0 0 90px rgba(232,56,159,.6),0 0 220px rgba(232,56,159,.32)}
.pring::before{transition:filter var(--duration-slow) var(--ease)}
.pring:hover::before{animation-duration:5s;filter:blur(20px) saturate(1.3)}
.pchip{transition:transform .35s var(--ease-out),box-shadow .35s var(--ease),border-color .35s var(--ease)}
.pring:hover .pchip.c1{transform:translate(-4px,-7px);border-color:rgba(232,56,159,.7);box-shadow:0 8px 30px rgba(0,0,0,.5),0 0 18px rgba(232,56,159,.5)}
.pring:hover .pchip.c2{transform:translate(4px,7px);border-color:rgba(69,189,209,.7);box-shadow:0 8px 30px rgba(0,0,0,.5),0 0 18px rgba(69,189,209,.5)}
@media (prefers-reduced-motion:reduce){.pring:hover img,.pring:hover .pchip.c1,.pring:hover .pchip.c2{transform:none}}
/* --- Footer menu restyle: accent titles, hover shift, light separators --- */
.foot-grid{gap:56px 0}
.foot-brand{padding-right:56px}
.fcol{position:relative;padding-left:32px;padding-right:32px}
.fcol::before{content:"";position:absolute;left:0;top:6px;bottom:6px;width:1px;background:linear-gradient(180deg,transparent,var(--border-strong) 30%,var(--border-strong) 70%,transparent)}
.fcol-title{position:relative;padding-bottom:10px;margin-bottom:16px;border-bottom:1px solid var(--border-neutral)}
.fcol-title::after{content:"";position:absolute;left:0;bottom:-1px;width:26px;height:2px;border-radius:2px;background:linear-gradient(90deg,var(--magenta-500),rgba(232,56,159,0))}
.fcol-links{gap:11px}
.fcol-links a{display:inline-flex;align-items:center;gap:6px;width:max-content;padding:1px 0;border-radius:4px;transition:color var(--duration-fast) var(--ease),transform var(--duration-base) var(--ease-out)}
.fcol-links a:hover{transform:translateX(3px)}
.fcol-links a:focus-visible{outline:none;box-shadow:var(--focus-ring)}
.fcol-links a .ext{opacity:.5}
.fcol-links a:hover .ext{opacity:.9}
@media (max-width:860px){
  .foot-grid{gap:0}
  .foot-brand{padding-right:0;padding-bottom:28px}
  .fcol{padding:22px 0 0;margin-top:22px;border-top:1px solid var(--border-neutral)}
  .fcol::before{display:none}
}
/* Bigger brand portrait in the footer */
.wordmark-lg .wordmark-lg .wm-name{font-size:26px}

/* ---- Sections below the hero (CCB-S3-037 5) ---------------------------------
   Every section is a panel carrying the SAME 9px clipped corner as the Demo
   control, because that shape is the site's signature and repeating it is what
   makes the page read as one system. One alignment throughout (left), a capped
   measure, and a tightened rhythm: the gaps used to be larger than the content. */
:root{--band-gap:52px;--measure:68ch}
.band{padding-block:0;margin-block:0}
.band + .band{margin-top:var(--band-gap)}
.band > .cn-card,.band > .sec-panel,.band.wrap{position:relative}

/* The panel. Same clip as .dm, drawn with a padded wrapper so the 1px edge shows
   through the cut corners exactly the way the Demo control's does. */
.sec-panel{position:relative;padding:1px;
  background:linear-gradient(180deg,rgba(141,225,236,.22),rgba(244,92,176,.14));
  clip-path:polygon(9px 0,100% 0,100% calc(100% - 9px),calc(100% - 9px) 100%,0 100%,0 9px)}
.sec-panel > .sec-panel-in{position:relative;
  clip-path:polygon(9px 0,100% 0,100% calc(100% - 9px),calc(100% - 9px) 100%,0 100%,0 9px);
  background:linear-gradient(180deg,rgba(11,18,32,.86),rgba(8,13,24,.72));
  padding:30px 32px}
@media (max-width:640px){.sec-panel > .sec-panel-in{padding:22px 18px}}

/* One relationship between eyebrow, heading and body, everywhere. Left aligned:
   mixing left and centre in adjacent sections is what made it look accidental. */
.cn-sechead{text-align:left;max-width:var(--measure)}
.cn-sechead-center{text-align:left}
.cn-sechead-eyebrow{display:flex;align-items:center;gap:9px;margin-bottom:10px;
  font-family:var(--font-mono);font-size:10px;font-weight:500;letter-spacing:.16em;
  text-transform:uppercase;color:var(--text-accent)}
.cn-sechead-eyebrow::before{content:"";width:20px;height:1px;background:var(--text-accent);
  opacity:.65;flex:0 0 auto}
.cn-sechead-title{font-size:clamp(23px,2.7vw,30px);font-weight:600;line-height:1.22;
  margin:0 0 12px;color:var(--text)}
.cn-sechead-lede{font-size:15.5px;line-height:1.7;color:var(--text-muted);margin:0;
  max-width:var(--measure)}
.cn-ftile-body{max-width:52ch}
.grid4{display:grid;grid-template-columns:repeat(auto-fit,minmax(252px,1fr));gap:16px}
.list-col{display:flex;flex-direction:column;gap:10px;max-width:var(--measure)}
.icon-line{display:flex;align-items:flex-start;gap:11px;font-size:15px;line-height:1.6;
  color:var(--text-muted)}
.mt48{margin-top:26px}.mt40{margin-top:24px}.mt36{margin-top:22px}.mt22{margin-top:16px}
`;

/** The complete site stylesheet (emitted once per page under the CSP nonce). */
export function siteCss(): string {
  return [fontFacesCss(), TOKENS_CSS, LAYOUT_CSS, DEMO_CSS, componentsCss(), NO_INLINE_CSS]
    .join('\n')
    .trim();
}