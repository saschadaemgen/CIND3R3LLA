# CIND3R3LLA design system package

A machine-readable export of the design system used by `cind3r3lla.com`, produced
so that design tooling has something to read. Point `/design-sync` at this
directory rather than at the repository root: the repo is large, and a tool aimed
at the whole project is slow and finds less.

## Files

| File | What it is |
|---|---|
| `tokens.css` | Every design token as real CSS custom properties. |
| `tokens.json` | The same tokens, machine readable, with `var()` chains resolved to literal values. |
| `components.css` | The component rules, extracted from the live stylesheet and grouped. |
| `index.html` | A rendered showcase of every component in every state. Open it directly in a browser. |
| `design-system.md` | What each token means, when to use it, and the constraints that shape every decision. Start here. |
| `README.md` | This file. |

`index.html` is self-contained: no build step, no network request, no external
stylesheet. It inlines the site's real stylesheet, so every specimen renders
exactly as the site renders it.

## This directory is GENERATED. Do not edit it.

Everything here is produced by `scripts/build-design-system.ts` from
`src/web/site/css.ts`, which is the actual stylesheet the server inlines into every
page. Editing a file here achieves nothing: the next `npm run build` overwrites it.

**To change the design, change the site.** Then rebuild:

```bash
npm run design-system     # regenerate just this package
npm run build             # regenerate it as part of the normal build
```

### Why generated rather than hand-written

A design system kept in two places drifts within a week, and then two files
disagree about what the brand magenta is. There is exactly one source of truth here
and it is the code that renders the site.

The alternative direction, putting the tokens in a real CSS file and having the
site import them, was considered and rejected: the site inlines its CSS under a
per-response CSP nonce, so reading a file at request time would add a filesystem
dependency to the render path for no benefit.

## Two things to know before importing this

**1. Use the live site as a second input.** `https://cind3r3lla.com` is the truest
example of the brand that exists. Claude Design's web capture tool can read elements
from the running page, and that will tell you more about how the system feels than
any token list. The hero, the two-tier header and the navigation panel are the
places to look.

**2. A GitHub import would show you an older design than the running site.** The
site is currently deployed by copying built files straight to the server, and the
newest design work is not yet committed. The repository is therefore behind what
`cind3r3lla.com` serves. Prefer this package plus the live site; treat the
repository's history as background rather than as current state.

## What the site is

A public marketing site for a self-hosted control plane for AI identities inside
private communities. Dark, near-black, with a narrow two-hue accent palette: cyan
for interface meaning, magenta for brand. Server-rendered, no framework, no CDN,
self-hosted fonts and icons, and a strict CSP that forbids inline style attributes.

The constraints in `design-system.md` are not preferences. A design that needs a
CDN font or an inline style cannot ship as-is.
