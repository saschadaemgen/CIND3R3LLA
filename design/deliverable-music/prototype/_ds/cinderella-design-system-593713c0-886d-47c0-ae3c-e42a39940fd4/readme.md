# Cinderella Design System

Cinderella is a **SimpleX AI bot suite** — a commercial, open-source (AGPL-3.0) product in **early alpha**. Its first capability is a consent-first archive: the bot joins public SimpleX groups, captures only after explicit opt-in, and publishes a permanent, searchable public web archive with reporting/moderation and security engineered in (passkeys, encrypted transport, media behind auth, local AI). A commercial **Pro** edition adds managed hosting and capabilities beyond the open core.

**Sources.** The design brief was provided as text (pasted design brief, July 2026) — mandatory style: *cyber black with neon blue*, Source Sans 3, 12px radii, subtle 0.3s motion, dark default. No binary assets were attached:
- **No logo/candle mark or hero banner asset.** The wordmark is set in plain type (Source Sans 3 Bold). The brief says a small candle mark may accompany it — the asset wasn't provided and was **not** drawn. Drop it into `assets/` when available.
- **Fonts are Google-hosted** (Source Sans 3 as specified; JetBrains Mono added for code/meta). Provide licensed files to ship `@font-face` binaries instead.
- **Icons are Lucide via CDN** — no proprietary set exists.

## Products represented
One surface: the **public website** (Home, Features, Pro, Security, Open Source, Legal ×3, Login) — the complete template lives in `ui_kits/website/`. The hardened operator console is *not* part of this system (by brief: only its login entry point is designed).

## Content fundamentals
- **Tone:** professional, factual, technical, trustworthy. An engineer explaining, not a marketer selling. No fairy-tale/princess/midnight metaphors — the name is just a name.
- **Honesty is brand:** alpha status is stated on the hero, not buried ("Early alpha — features and APIs may change."). Roadmap items are labelled *Planned*; CSAM screening is labelled *In development*. Claims are specific and verifiable ("media sits behind authenticated, expiring URLs"), never superlative ("world's best").
- **Person:** "we" = the project; "you" = the operator/visitor. Second person freely.
- **Casing:** sentence case everywhere, including buttons and nav. ALL-CAPS only for 11–12px eyebrows/badges (+0.12em).
- **Punctuation:** no exclamation marks. No emoji, ever. Full stops on complete sentences.
- **Buttons:** short factual verbs — "Explore the archive", "View on GitHub", "Join the waitlist". Never "Click here"/"Learn more"/"Submit".
- **Bilingual:** EN default, DE fully parallel (formal *Sie*). German is not an afterthought — chrome, pages, and legal templates all switch.
- **Required footer line:** "Built on SimpleX. Not affiliated with SimpleX Chat."

## Visual foundations
- **Palette:** near-black blue `ink` surfaces (#050A12 page → #1A2740), one luminous `cyan` accent (#45BDD1, hover #6DD0DF), light `slate` text (#CBD5E1 body, #E8EDF4 bright — never pure white). Semantic green/amber/red are muted and sit on faint tinted surfaces. One accent — no second hue, no purple gradients.
- **Dark is default; light is secondary**, implemented as `[data-theme="light"]` remapping the semantic aliases only (base ramps never change).
- **Type:** Source Sans 3 only, weights 400/600/700; headings 700 with −0.015em. JetBrains Mono for code, log lines, timestamps (12–13px). Scale: 56/40/30/22/17/16/14/13/11.
- **Spacing:** 4px scale (`--space-1…24`), 1200px container, 24px gutters, sections at 80–96px.
- **Backgrounds:** flat ink fields. The only decoration: a faint 72px hairline grid + one soft radial cyan glow on hero bands. No textures, no photography, no illustration.
- **Signature surface — the edge-lit card:** ink-850 face + faint cyan sheen from the top edge (`--card-sheen`), 1px cyan hairline (12%), 1px inner top highlight (`--edge-lit`), soft black shadow, 12px radius. Hover: border 28% + `--glow-accent` + 2px lift.
- **Borders:** cyan-alpha hairlines (`rgba(69,189,209,.12)`) separate; neutral slate-alpha borders for quiet contexts; `--border-strong` (28%) for hover/emphasis.
- **Glow is reserved:** one glowing highlight per view (primary button hover, accent card, wordmark). Restrained > neon-overload.
- **Radii:** 4 badges/checks · 8 buttons/inputs/tags · 12 cards · 16 dialogs · 20 hero panels. Pill only for tiny chips, sparingly.
- **Motion:** 0.3s ease transitions; entrances are fade + 8–12px rise only. No bounces, spins, parallax. `prefers-reduced-motion` disables everything (base.css).
- **Hover:** borders brighten, text lifts muted→bright, primary buttons lighten one cyan step + glow; cards lift 2px. **Press:** darken one step + 1px sink. **Focus:** always-visible 3px cyan ring.
- **Transparency/blur:** sticky header only (78% page-color + 14px blur) and dialog scrims. Text never sits on unblurred transparency.
- **Layout:** sticky glass header (60px), centered 1200px column, footer on raised ink. Legal/long-form max-width 760px.

## Iconography
- **[Lucide](https://lucide.dev) via CDN** (`lucide-static@0.462.0` on jsDelivr) — 2px stroke, matches the technical tone. The `Icon` component masks the SVG with `currentColor` so icons tint like text (slate at rest, cyan when accent). **Substitution flag:** swap the CDN base in `components/display/Icon.jsx` if a brand set ever exists.
- Vocabulary: `shield-check, lock, key-round, search, archive, database, flag, users, cpu, globe, moon, sun, github, file-text, menu, x, check, arrow-right, external-link`.
- Structural glyphs (check, chevron, ×, toast intents) are embedded in components as copied Lucide path data so controls work offline.
- Sizes 16/20/24. No emoji; no unicode ornaments — this brand's "character art" is mono text (timestamps, version tags).

## Typography sourcing (substitution flag)
No font files were provided. Google-hosted via `tokens/fonts.css`: **Source Sans 3** (brief-specified) + **JetBrains Mono** (added for code). Because they're remote `@import`s, the compiler manifest lists no font binaries — they still load. Provide licensed files to switch to shipped `@font-face`.

## Index
- `styles.css` — global entry; imports `tokens/` (fonts, colors, typography, spacing, effects, base).
- `tokens/` — ramps + semantic aliases (use aliases first); `[data-theme="light"]` scope lives in `colors.css`.
- `guidelines/` — specimen cards (Design System tab): `type/`, `colors/`, `foundations/`, `brand/`.
- `components/` — React primitives on `window.CinderellaDesignSystem_593713` (each `.jsx` + `.d.ts` + `.prompt.md`):
  - `forms/` — Button, IconButton, Input, Select, Checkbox, Radio, Switch
  - `display/` — Card, Badge, Tag, Icon
  - `navigation/` — Tabs
  - `feedback/` — Dialog, Toast, Tooltip
  - `marketing/` — SectionHeader, FeatureTile, PricingTier, CookieBanner (required by the brief)
- `ui_kits/website/` — the complete public-site template (all 7+ pages, bilingual, themed, responsive).
- `SKILL.md` — agent-skill entry point.

**Intentional additions:** `Icon` (wraps CDN Lucide); `JetBrains Mono` (code font, brief specified sans only); the `marketing/` group exists because the brief explicitly lists those four components.
