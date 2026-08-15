# INTEGRATION-MUSIC.md: the music area as a section

Package: this file + `Music Library.dc.html` (open in a browser; `support.js` and `_ds/` sit
beside it). The prototype is the design. Where it and this file disagree, the prototype wins,
and a disagreement is a bug to report rather than interpret.

Read against `saschadaemgen/CIND3R3LLA@main`, commit tree `999482ab6065`, 2026-08-15. Every
field, bound and mode below was taken from that source, not from memory:
`migrations/063_music_library.sql`, `src/plugins/music/{settings,library,store}.ts`,
`src/web/views/music.ts`, `src/web/{html,views/ui}.ts`.

**No em-dash (U+2014) anywhere**, in this file or in any string the console ships. The rule
applies to the spec too: it is not shipped, the build check never sees it, which is exactly
how it drifts.

## 1. What was wrong, and what each fix is

| The operator's words | The fix in the prototype |
| --- | --- |
| "you scroll and scroll and scroll" | One page became four, registered as a real section with its own sidebar (§2). |
| Nothing grouped or ordered | Each sub-page holds one job. Inside a page, one module per idea, never a stack of unrelated forms. |
| The file input is an empty box with "no file chosen" | The native input is visually hidden; a labelled control ("Choose files") triggers it, and a drop zone states what is read from the file. |
| "Replace cover" did three things | Two named steps: "Choose an image" then "Upload and replace", with the state line saying which has happened. |
| No sorting, no filtering, cannot click a genre | Sortable headers on seven columns, a facet column with live counts, and the genre cell in each row is a filter control. |
| No way to hear a track | Play in every row, one player bar that survives sub-page changes. Needs one new route (§4). |
| Could not tell whether a control had been pressed | Every mutation has three visible states: clean, pending, applied at HH:MM:SS (§6). |

## 2. The section, and how it registers

The music page currently renders with `active: 'plugins'`, so it inherits the Plugins
sidebar and contributes nothing to it: one page pretending to be a section. Register it as a
root in the `setNavItems()` call in `src/web/server.ts`:

```ts
{ key: 'music', href: '/music', label: 'Music', icon: MUSIC_ICON, children: [
  { key: 'music:library',     href: '/music',             label: 'Library',
    description: 'Tracks, their tags, covers, cached videos, and playback.' },
  { key: 'music:playlists',   href: '/music/playlists',   label: 'Playlists',
    description: 'The unit of assignment, and the order she plays.' },
  { key: 'music:assignments', href: '/music/assignments', label: 'Assignments',
    description: 'Which bot holds which playlist, and on what rhythm.' },
  { key: 'music:storage',     href: '/music/storage',     label: 'Storage and diagnostics',
    description: 'Measured disk figures, the unbidden budgets, every skip counted.' } ] }
```

Also needed, because `html.ts` keys them by section: `MEGA_SECTION_DESCRIPTIONS.music`, and
`MEGA_GROUPS_BY_SECTION.music = { 'music:library': 'Library', 'music:playlists': 'Programming',
'music:assignments': 'Programming', 'music:storage': 'Operations' }`. `MEGA_ITEM_DESCRIPTIONS`
is unnecessary if each child carries `description`, which is the better place for it.

`MUSIC_ICON` is a Lucide `disc-3`-style glyph in the same `raw('<svg viewBox="0 0 24 24">…')`
shape as `GLOBE_ICON`. The prototype's rail draws it inline; the shell owns it in the repo.

**The prototype links the repo's own `assets/app.css` (verbatim copy) and composes from it:**
`admin-shell`, `admin-stars`, `admin-card` (with its top gradient hairline), `admin-tiles` and
`admin-tile`, `admin-action-button` with `admin-action-primary` / `admin-action-danger`, the
global dark field styling for `input` / `select`, `admin-sidebar-meta`, `admin-clock`. The few
prototype-only classes (`.mus-link`, `.mus-th`, `.mus-caret`, `.mus-act`, the drawer) are
layout glue and name no new colours.

### Scope per page, stated with the switcher the shell already has

The section sidebar is the operator's own spec: plain black (`#050a12`), NO border, no
heading above it, full height so it later meets the console's top navigation. Links reuse the
repo's active treatment verbatim (`admin-sidebar-link[aria-current]`: magenta hairline,
magenta-to-cyan wash, `inset 3px 0 0 var(--brand)`), each with its live count. The sidebar
foot keeps `admin-sidebar-meta` and the `admin-clock` glitch clock, both already in app.css
and admin-clock.js.

`page({ botSwitcher: { …, scope } })` exists for exactly this. Per page:

| Page | `scope` | Why |
| --- | --- | --- |
| Library | `shared` | The library is the deployment's shelf. Switching the bot must not appear to change it. |
| Playlists | `shared` | Same shelf. |
| Assignments | `mixed` | Rows are per bot, and the table shows every bot with the bot named in each row. |
| Storage and diagnostics | `shared` | Budgets and the member-upload bound are deployment-wide. |

The operator's hard requirement, "a page that edits one bot's settings must say which bot, in
words", is met twice on Assignments: the switcher states the scope, and every row carries its
bot's name as text. Keep `musicScopePanel()` from the current view; it is the surface he has
already learned to read. Render it at the foot of Assignments and Storage.

## 3. Sub-pages, and what belongs on each

**Library** (`/music`), one full-width table plus a sliding track panel (the operator's
decision, third iteration): the panel is styled exactly like the left sidebar, plain black,
borderless, full height, fixed to the RIGHT edge. It slides in over the table when a row's
Edit is pressed (`translateX(104%)` to `0`, 300ms, none under reduced motion) and slides away
on Close, so the table always has the full width.

- Filters are four controls in the toolbar: search, kind, genre, and one state select (no
  cover, cover without video, video cached, in no playlist, duration unknown). A genre cell
  in any row filters by that genre on click.
- Selection is checkboxes, header checkbox ticks everything shown. Ticking opens a bulk bar
  above the table: "N tracks selected, add to <playlist> [Add to playlist]", which is the
  twenty-songs-in-one-press path (`POST /music/playlists/add-tracks`, the route that exists).
- Sort: title, artist, kind, genre, duration, size, plays. Text ascends first, numbers descend
  first. The active header carries the caret; the others reserve its space.
- Columns: check, play, cover, track, artist, kind, genre, time, size, plays, video state,
  and an ACTIONS column: Edit (opens the panel) and Delete (two-press in place, "Delete" then
  "Again?", disarming itself after 2.8s). Album is panel-only: it is not a scanning column.
- The header and every row share ONE declared grid template, and the whole table sits in a
  horizontal scroller with a `min-width`. This is load-bearing: with `minmax(0,1fr)` and no
  minimum, the title column collapses to zero at narrow widths and the headers overprint. It
  did, and it is why the template carries `minmax(104px,1.5fr)`.
- Detail: the five editable fields (title, artist, album, genre, kind), the cover block, the
  cached-video block, the read-only facts, and delete. The send shape is stated, never offered:
  with a cover, one video message; without, title plus bare voice player.

**Playlists** (`/music/playlists`): list plus detail. The detail holds the ORDER, with up,
down and remove per row, "Add tracks" as a ticked picker, and who holds the playlist. Empty is
a normal state and says so.

**Assignments** (`/music/assignments`): one table, every bot, bot column first. Per row: mode,
destination group, minutes, messages, state, Apply, Take away. New assignments start on
request only, as the schema's default does. The three constraint sentences under the table are
the CHECK constraints in words.

**Storage and diagnostics** (`/music/storage`): four measured tiles, genres held (her whole
vocabulary), most played, the two unbidden budgets plus the member-upload bound, diagnostics.

## 4. Routes: what exists, what is new

Every existing route keeps its path, method and body. The redesign is a rendering change plus
three additions.

Preserved: `POST /music/tracks/upload`, `/music/tracks/:id/meta`, `/music/tracks/:id/cover`,
`/music/tracks/:id/delete`, `/music/playlists/create`, `/music/playlists/:id/delete`,
`/music/playlists/add-tracks`, `/music/playlists/add-track`,
`/music/playlists/:id/remove-track`, `/music/assign`, `/music/assignments/:id/cadence`,
`/music/assignments/:id/onrequest`, `/music/assignments/:id/delete`, `/music/settings`, and
`GET /music/tracks/:id/cover.jpg`.

New, and each is small:

1. **`GET /music/tracks/:id/audio`**, the reason the player can exist. Authenticated, addressed
   by track id and never by path (the admin-media rule), `cache-control: no-store`, and it MUST
   answer `Range` so seeking does not refetch. It serves the ORIGINAL bytes: the preview must
   prove what was uploaded, not what was encoded. **A preview writes no row to
   `cinderella_track_plays`.** A play record means a member received a track; the console
   listening is not that, and the prototype says so in the player bar.
2. **`POST /music/playlists/:id/order`** (or extend `add-tracks`), for the reorder controls.
   `setPlaylistTracks(db, id, ids)` already does the work; there is no route to it.
3. **`POST /music/playlists/:id/rename`**. The design shows a name that can be corrected. If
   this is cut, cut the control too rather than leaving it inert.

Two query changes:

- **A per-track play count.** The list shows plays per row; `libraryFacts` returns only
  `mostPlayed` and `popularNow`. One `GROUP BY track_id` over `cinderella_track_plays`,
  LEFT JOINed, and no stored aggregate (the D-217 rule holds: nothing is stored as a total).
- **Assignments across every bot.** `assignmentsForBot(db, botId)` is one bot's rows. The table
  needs the same rows for all bots joined to `cinderella_bot_profiles` for the name. The unique
  constraint is `(bot_profile_id, playlist_id)`, so the shape supports it as it stands.

## 5. Class vocabulary: use the console's own

The layout vocabulary already exists and was derived from all 26 views. Compose with it:
`pageHeader`, `card` / `.admin-card` / `.admin-card-title`, `sectionHeader`, `factList`
(`.admin-facts`), `statusTile` / `statusTiles` (`.admin-tiles`), `actionForm`
(`.admin-action-button` with `primary` / `quiet` / `danger`), `badge`, `scopePanel`,
`fmtDate`. `.admin-content > * + *` owns vertical rhythm, so no page-level margins.

New classes this section needs, named here so they are not invented twice:

| Prototype element | Class to add | Notes |
| --- | --- | --- |
| Facet column | `.music-facets`, `.music-facet-group`, `.music-facet-row` | Row is a grid of label plus count, `aria-pressed` for the on state. |
| Track table | `.music-table`, `.music-table-scroll`, `.music-row` | ONE `grid-template-columns` shared by header and rows, in CSS, not per row. |
| Sort caret | `.music-sort-caret` | Rotated square, opacity 0 when inactive so the header does not shift. |
| Cover cell and thumb | `.music-cover`, `.music-cover-empty` | The empty one is a dashed box, not an error colour. |
| Cached-video dot | `.music-vdot` with `data-state="built|none|nocover"` | Three states, one of which is "cannot be built". |
| Staged upload rows | `.music-staged`, `.music-staged-row` | Client-side only until Import. |
| Player bar | `.music-player` | Fixed to the bottom of `.admin-main`, not the viewport, so the footer is not covered. |
| Text and number fields | reuse the console's field classes | **Delete `INPUT_CLS`.** `'w-full rounded-lg border border-slate-300 px-2 py-1.5 text-sm'` is a light-theme utility string on a dark console, and it is most of why the page reads as unfinished. |

Two things to verify rather than assume: `ui.ts`'s `badge()` tones are Tailwind light
utilities (`bg-emerald-100 text-emerald-800`), and `scopePanel` carries `bg-white`,
`text-slate-500` and friends. Either `app.css` overrides them or they need dark tones. The
prototype's chips are a 1px bordered mono label at 9.5px with `--success`, `--warning`,
`--danger` and `--text-muted`, which is the shape to match.

The module treatment in the prototype (corner light, corner sparks, the 1px inner grain) is
the site console's `.mx` family from `src/pages/css.ts`. If `app.css` has no equivalent, port
it as a variant of `.admin-card` rather than replacing the card: `.admin-card` keeps padding
and rhythm, the variant adds the clipped corner, the animated corner light
(`mxCornerBg` / `mxCornerBgRev`, plus the `Lg` pair for large modules) and the spark
(`mxSparkBloom` / `mxSparkBloomB`, `--sp-len` registered with `@property` so the rays grow).
Sparks fire on a random slot every few seconds, never on all modules at once.

## 6. The state grammar: clean, pending, applied

The operator set an assignment and could not tell whether he had pressed the final step. Three
states, one vocabulary, everywhere something can be changed:

- **Clean.** A mono line: `no pending changes`, or `saved 14:03:07` once something has been.
- **Pending.** A count in `--warning` (`2 unsaved changes`), the card or row marked `edited`
  or `not applied`, a 2px inset warning bar on a pending row, and the Apply control lit while
  Revert appears beside it.
- **Applied.** The count is replaced by `applied 14:05:12`, the row's state chip flips to
  `cadence active` or `on request only`, and the mono confirmation line under the table names
  what happened, with `aria-live="polite"`.

Two save models on purpose, and the difference is visible: the track detail and the budgets
are drafts with an explicit Save; the playlist order, the exclusion of a track from a playlist
and the per-row Take away act at once, because they are single actions rather than a form.
Assignments are drafts per row, because a cadence is three fields that are meaningless
separately.

Destructive controls are two-press, not a checkbox: "Delete this track" then "Press again to
delete", with the consequence spelled out beside it (the file, the cover, the cached video and
its plays). This replaces the `confirm=on` checkbox; the route can keep requiring the field,
the second press supplies it.

## 7. Data facts the design depends on

- **`genre` is ONE `TEXT` column per track, not several.** The brief said several; the schema
  and `readTags` (`common.genre?.[0]`) say one. The design follows the code: a single free-text
  field with a datalist of genres already held. If several are wanted, that is a migration and
  a new table, not a UI change, and the "genres held" list that bounds her vocabulary would
  change shape with it. **Confirm before building anything multi-genre.**
- **`duration_seconds` is nullable.** "unknown" is a real value, shown in `--warning`, not a
  zero and not a blank. Duration comes from the ffmpeg probe, never from the tag.
- **The encode is a trio** (`encoded_path`, `encoded_at`, `encode_version`), constrained so a
  half-recorded encode is unrepresentable. The detail pane therefore shows built-at and the
  recipe version together, and a cover replacement clears the trio and re-queues.
- **A coverless track cannot have a video.** The build control is disabled with the reason
  stated, not hidden.
- **Encoding leaves the request.** Upload stores and answers; the queue encodes. The prototype
  models this: "queued, the encoder runs outside this request", then the size appears. Never
  block a request on ffmpeg again (the 504 lesson).
- **Cadence bounds:** mode is `on-request` or `cadence`; a cadence needs `dest_group_id` and at
  least one of `interval_minutes` (1 to 10080) or `message_count` (1 to 10000); an on-request
  row carries none of them. The prototype enforces all of it client-side and states it in
  words under the table.
- **Plays are anonymous.** `member_id` is written NULL by every caller. The Storage tile says
  "no member is recorded", which is the honest version of a plays figure here.
- **Deployment-wide settings** (`MUSIC_DEFAULTS`): music and spot daily caps and gaps, and
  `memberUploadMaxBytes` (10 MB, mp3 only, checked by name AND first bytes). Operator uploads
  are bounded separately by `TRACK_MAX_BYTES` (100 MB), which is a constant, not a setting: the
  drop zone states it as a fact. The per-bot `music-uploads` switch stays on the Plugins page,
  and the page says so instead of duplicating it.
- **Not settable, and stated beside the thing it governs:** the send shape (the cover decides)
  and shuffle without replacement (derived from the plays log).

## 8. Prototype-only shims: DO NOT PORT

- `armLive()` / `ensureLive()` and the `window.__muTimer` handle. This preview runtime can swap
  the logic instance and run the old instance's `componentWillUnmount` without running the new
  one's `componentDidMount`, which leaves the page rendering but inert. The console mounts
  once: one `setInterval` for the player clock, armed normally.
- The starfield canvas and the ambient washes. `app.css` and `admin-effects.js` already own
  `#admin-starfield`; do not add a second one.
- Sample data: 16 tracks, 6 playlists, 4 assignments, 3 bots, and the diagnostics figures. All
  of it is placeholder. The SHAPES are not.
- Tag reading is faked from the file name and size (`"Artist - Title.mp3"`). The console reads
  the real ID3 tag through `assets/admin-music-upload.js` and posts base64 with
  `imageData`, `fileName`, `kind`, `title`, `artist`, `album`, `genre`, `coverData`, `ajax=1`;
  the server re-reads the tag with `music-metadata` and the typed fields win.
- Two `@media` rules and the `[data-dz="on"]` drop-zone highlight are the only non-inline
  styles in the prototype besides keyframes. In the repo they are ordinary class rules.

Cover thumbnails in the prototype are a tinted block with the title's first letter, because no
artwork exists here. In the console they are `/music/tracks/:id/cover.jpg` and **the `width`
and `height` ATTRIBUTES are load-bearing**: a class can be right in the source and absent from
a built stylesheet, and the operator's first list showed one cover at its own dimensions,
filling the screen.

## 9. Reduced motion, and the live surfaces

`prefers-reduced-motion: reduce` removes the corner light, the sparks, the starfield twinkle,
the indicator travel and the screen entrance. Absence, not "faster". Information never moves:
the player's position and every figure keep updating. The prototype also honours a
`reducedMotion` prop so the state can be reviewed without changing the operating system.

`aria-live` surfaces, all `polite`:

| Surface | Attributes |
| --- | --- |
| Player bar, now playing | `aria-live="polite"` on the title line |
| Upload staging, how many read | `aria-live="polite"` |
| Cover state line | `aria-live="polite"` |
| Cached-video state line | `aria-live="polite"` |
| Save confirmations (track, budgets) | `aria-live="polite"` |
| Playlist and assignment confirmations | `aria-live="polite"` |
| Validation refusals | `role="alert"` |

Every icon-only control carries an `aria-label` naming its track ("Play Nachtluft"), and the
sort headers are buttons, not decorated cells.

## 10. Copy rules this section holds to

Sentence case, no exclamation marks, no emoji. A control says what it does: "Upload and
replace", not "Replace cover". A refusal names the shape it wants ("Write it in CIDR" is the
sibling rule in the insights console; here it is "no title in the tag", "1 to 10080"). Absence
is described, never coloured as an error: "no genre", "in no playlist", "Empty. That is a
normal state". And the figures are measured: `mb()` adapts to KB below a megabyte, because
"0.0 MB" over a non-empty library reads as nothing stored, which is how a 14 KB fixture once
looked.

## 11. Open, and worth one answer each

1. **Genre, one or several** (§7). Everything else here is buildable as it stands.
2. **Does Music belong as a top-level section, or as a child of Plugins with its own children?**
   The prototype assumes top-level, which is what "not registered at all" argues for. Nested
   works: `sidebarNavigationItem` recurses.
3. **The player's reach.** One bar for the whole section is designed. If it should also survive
   leaving the section, it belongs in the shell, not in the music views.
