# CIND3R3LLA design system

Written for someone with no memory of this project.

CIND3R3LLA is a self-hosted control plane for AI identities inside private
communities. The public site at `cind3r3lla.com` is its shop window. The look is
dark, near-black, with two accent hues on a deliberately narrow palette: a cyan
that carries interface meaning, and a magenta that carries brand.

Everything here is **generated from the site's own stylesheet**. There is no second
copy to keep in step. If a value below disagrees with the site, the site is right
and this package is stale, which means the build did not run.

---

## Tokens

### Colour

Two layers, and the distinction matters.

**The palette** (`--ink-*`, `--cyan-*`, `--magenta-*`, `--slate-*`, plus green,
amber and red) is the raw ramp. Do not use it in a component. It exists so the
semantic layer has something to point at.

**The semantic layer** is what components use:

| Token | Use |
|---|---|
| `--surface-page` | The page itself. Near-black, `#050A12`. |
| `--surface-raised` | Anything sitting above the page: header, panels. |
| `--surface-card` | Cards and tiles, one step lighter again. |
| `--surface-field` | Input interiors. |
| `--surface-hover` | The wash under a hovered row or item. |
| `--text-bright` | Headings and anything that must win attention. |
| `--text-body` | Body copy. |
| `--text-muted` | Secondary copy, rail links, descriptions. |
| `--text-faint` | Captions, kickers, metadata. Do not set body copy in this. |
| `--text-accent` | Cyan. Links, active navigation, kickers. |
| `--neon` | Brand magenta. Sparingly: it is the loudest thing available. |
| `--neon-hover`, `--neon-weak`, `--text-neon` | Its hover, its wash and its light variant. |
| `--border-hairline` | The default 1px edge. Almost invisible on purpose. |
| `--border-strong` | An edge that should be noticed: focus, active, emphasis. |
| `--border-neutral` | A grey edge where the cyan tint would read as meaning. |
| `--success` / `--warning` / `--danger` / `--info` + `-surface` | Status, each with a low-opacity wash for the pill background. |
| `--focus-ring` | The keyboard focus shadow. Never restyle focus per component. |

**Reach for a semantic token, never a palette one.** The point of `--neon` rather
than `--magenta-500` is that a change of hue does not leave a variable whose name
lies about its value.

### Type

Two families. `--font-sans` (Source Sans 3) for everything; `--font-mono`
(JetBrains Mono) for kickers, labels, counts and anything that should read as
machine output rather than prose.

The size scale runs `--size-micro` 11px through `--size-hero` 76px. Body copy is
`--size-body` 16px at `--leading-body` 1.6.

Three tracking values, and they are not interchangeable:

- `--tracking-display` `-0.03em` tightens large headings, which otherwise look loose.
- `--tracking-body` `0` for prose.
- `--tracking-caps` `0.14em` for uppercase labels. Uppercase text without added
  tracking reads as shouting; with it, it reads as a label.

Navigation items and the Demo control use `0.11em` and `0.1em` respectively, both
slightly tighter than `--tracking-caps` because they sit at 11.5px where wide
tracking starts to fragment the word.

### Spacing

A 4px base: `--space-1` 4px through `--space-20` 80px. Layout is capped by
`--container-max` 1200px with `--gutter` 24px.

Section rhythm is a single value, `--band-gap` 52px, applied between every band
below the hero. It was 88px and the gaps were larger than the content.

Body text is capped at `--measure` 68ch. Long lines are the most common way a dark
site becomes unreadable.

### Shape

`--radius-xs` 4px through `--radius-xl` 20px, and one more that matters more than
all of them:

**`--clip-corner`, 9px.** The signature shape. A cut at the top-left and
bottom-right corners, applied with `clip-path`, on the Demo control and on section
panels. It is the single strongest cue that a page belongs to this system. Use the
documented pattern in `components.css`, never a hand-written polygon: the value
lives in one token so it can be changed once.

### Motion

One control curve and two interface curves:

- `--ease-control` `cubic-bezier(.2,0,0,1)` for the Demo control. Fast out of the
  gate, long settle.
- `--ease-out` `cubic-bezier(.2,.7,.2,1)` for the travelling nav indicator and
  panel transitions.
- `--ease-in-out` `cubic-bezier(.45,0,.25,1)` for anything symmetric.

Durations: `--duration-fast` 150ms for colour, `--duration-base` 300ms for
movement, `--duration-slow` 500ms for entrances.

The navigation panel slides with the admin console's own timing, 190ms on
`cubic-bezier(.2,.8,.2,1)`, because the two surfaces deliberately share one
language.

**Every animation must be disabled under `prefers-reduced-motion: reduce`.** Not
reduced, disabled. The Demo control keeps its colour change and drops the glitch,
the scanline and the raster.

---

## Components

### The Demo control

The approved control treatment, and the reference for anything interactive added
later.

Structure is two nested elements: an outer carrying the clip and a 1.2px pad that
acts as the border, and an inner `.in` carrying the same clip, the dark interior
and the `overflow:hidden` that keeps the scanline inside.

**Nothing moves.** No transform on the element, no lift, no scale. Everything
happens inside it:

- the label tears into cyan and magenta in hard `steps(1)`, sliced into horizontal
  bands, then resolves. No crossfade anywhere.
- one scanline crosses top to bottom, once.
- a fine raster fades in: 1px lines at 3px spacing, very low opacity.

A control that leads nowhere yet renders in the identical shape without an `href`,
never hidden and never a link to a 404.

### Buttons

`.cn-btn` with `-primary`, `-secondary`, `-ghost` and three sizes. Conventional
rounded rectangles; the clipped corner belongs to the Demo control and to panels,
not to every button, or it stops being a signature.

### Navigation item and indicator

Items are uppercase, 11.5px, `0.11em`, muted, brightening on hover and going accent
when active.

**One indicator, not an underline per item.** A single element that animates its
position and width between items as the pointer moves, returning to the active item
on leave. It is sized to the label, not the padded box. Nothing else is ever drawn
under a nav item; a second bar there was a real bug twice.

### Utility rail

The thin tier above the main bar: secondary links, muted, cyan on hover, separated
by 1px hairlines sized to the **text** rather than to the padded box. A separator
that spans the full element height reads as a shape rather than as a divider.

### Mega menu panel

Copied wholesale from the admin console so both surfaces share one navigation
language. Three columns: an intro carrying a kicker, a section heading, a
description and a link in; then entry columns; then the close control. It slides
down from under the header and is not a full-viewport overlay.

### Section panel

A content block with the signature clipped corner, drawn as a padded wrapper so the
1px edge follows the cut corners instead of being sliced off by the clip.

### Feature chip and portrait badge

The hero feature row is four chips that fade in on a 110ms stagger, left to right.
Simultaneous animation reads as a rendering fault. The portrait badge floats over
the hero image at a measured offset from its edge.

---

## Standing constraints

These shape every decision, and a design that ignores them cannot ship.

- **Everything self-hosted. No CDN.** Fonts, icons and scripts are served from the
  origin. A design that needs a Google font needs the font file committed instead.
- **No inline `style` attributes.** The site's CSP is `style-src 'nonce-...'`, and a
  nonce covers `<style>` elements only; browsers block style attributes under it. A
  harness fails the build if one appears. Every layout value is a class.
- **The CSP must not be weakened.** If an effect needs a CSP change, drop the
  effect.
- **Server-rendered, progressive enhancement only.** Every page is complete HTML
  before any script runs. Scripts add the travelling indicator, the menu and the
  headline rotator; without them the page still reads and every link still works.
- **No em-dashes**, en-dashes or horizontal bars in any visitor-facing string, in
  any language. Use a comma, a full stop, or restructure. Enforced by a harness.
- **`prefers-reduced-motion` respected everywhere.**
- **One language.** The site ships English only. The i18n machinery is intact but
  no second locale is loaded, so no design may assume a language switcher.

---

## Where the system is still inconsistent

Recorded honestly, because these are the places a designer will find friction:

- **Two naming generations coexist.** Older rules use `--cyan-400` and
  `--magenta-500` directly; newer ones use `--text-accent` and `--neon`. Both
  resolve to the same colours, so nothing is broken, but the palette layer is
  reachable from component code when it should not be.
- **The Demo control hard-codes its hues.** `#FF3DA6`, `#08060F`, `#160410`,
  `#F58FCD` and `#3DE0F0` are literals in that component rather than tokens,
  because the treatment was supplied as finished CSS and was copied rather than
  reinterpreted. They are close to, but not identical with, `--magenta-*`.
- **Five admin-derived tokens are aliased.** The mega panel needed
  `--mega-line`, `--mega-line-strong`, `--mega-accent-strong`, `--mega-brand-strong`
  and `--mega-text`, carrying the admin console's exact values so the copied
  component does not drift. Two of them duplicate site values exactly.
- **Shadows are defined but barely used.** `--shadow-1..3` exist; most elevation is
  done with borders and background steps instead.
- **The hero uses its own spacing.** `.hero-col` caps at 560px rather than at
  `--measure`, because the headline needs a narrower column than body copy does.
