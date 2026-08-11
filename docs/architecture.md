# Cinderella — Architecture

> _Living document — Cinderella, Seasons 1–4. Ground truth is the code in this repository; where an earlier briefing outline diverged from the code, the divergence is noted inline. Maintained under the CCB briefing scheme; last updated under **CCB-S4-044**._

Cinderella is a consent-first archive bot for a public SimpleX group. She joins the group (`Cyb3rD3sk`), captures opted-in members' messages into PostgreSQL and an on-disk media store, and exposes a hardened admin console. Nothing a member posts is ever published unless that member sent `/publish` — publication is _derived_ from the `consent` table and the message-state views, never a stored flag (the views are created in `migrations/002_consent.sql` and refined in `004_moderation.sql` / `005_deletion_provenance.sql`).

This document describes the _runtime_ architecture as it exists in code. Where the task outline and the code differ, the code is treated as ground truth and the divergence is called out inline (and collected in the appendix).

## 1. System overview

Cinderella runs as **one Node.js process** (`src/index.ts`) that hosts three cooperating parts:

1. **The capture bot** — the embedded SimpleX chat core, booted in-process via the `simplex-chat` SDK. It receives group events and drives the capture pipeline.
2. **The capture pipeline** — parse → persist → receive-media, backed by PostgreSQL (`src/capture/`, `src/db/`).
3. **The admin console** — a Fastify web app (htmx + Tailwind, no SPA) bound to `127.0.0.1`, fronted by nginx TLS in production (`src/web/`).

`src/index.ts::runApp` wires them together in a single process: it asserts the archive DB is ready (`assertDbReady`), loads live settings (`SettingsService.load`) and security config (`SecurityService.load`), starts the admin server (`startAdminServer`), then starts the capture worker (`startCaptureWorker`). A shared `SIGINT`/`SIGTERM` handler shuts down the admin server, the bot, and the DB pool in that order (`src/index.ts:161-169`).

```
node dist/index.js            → run the capture bot + admin console (long-lived)
node dist/index.js --check    → validate config and exit 0 (Stage 0 check)
```

> Note: `CLAUDE.md` gives the migration runner as `node dist/db/migrate.js`, while `package.json` exposes it as `npm run migrate` (`tsx src/db/migrate.ts`, `package.json:23`) and `src/index.ts:49` tells the operator to run `npm run migrate`. Both invoke the same runner (`src/db/migrate.ts`) — one compiled, one via `tsx`.

### Component diagram

```mermaid
flowchart TB
  subgraph proc["Single Node.js process — src/index.ts"]
    bot["Capture bot\n(embedded SimpleX core via bot.run)\nsrc/bot/"]
    pipe["Capture pipeline\nparse → persist → receive-media\nsrc/capture/"]
    admin["Admin console (Fastify)\nhtmx + Tailwind, 127.0.0.1\nsrc/web/"]
  end
  simplexdb[("SimpleX core state (SQLite)\n<prefix>_chat.db / _agent.db")]
  files["Files folder\n(XFTP downloads land here)"]
  media["MEDIA_ROOT\nYYYY/MM/<fileId>-<name>"]
  pg[("Archive PostgreSQL\nmessages · links · consent · settings\naudit · webauthn · admin_sessions")]
  nginx["nginx TLS\n(<admin-host>)"]

  bot <--> simplexdb
  bot --> files
  bot --> pipe
  pipe --> media
  pipe --> pg
  admin --> pg
  admin -->|serves /media/| media
  nginx -->|proxy → 127.0.0.1:ADMIN_PORT| admin
```

### Data-flow sequence

```mermaid
sequenceDiagram
  participant Core as SimpleX core
  participant H as handler.ts (registerCapture)
  participant IA as interaction/engine.ts
  participant P as persist.ts (hooks)
  participant PG as PostgreSQL
  participant FR as FileReceiver
  participant M as media.ts

  Core->>H: newChatItems
  H->>H: parseGroupMessage (group + groupRcv + rcvMsgContent)
  Note over H: consent command? → onCommand, NOT persisted
  H->>IA: onInteraction(msg)   (CCB-S3-002)
  Note over IA: addressed to her? → reply, NOT persisted
  H->>P: onMessage(msg)  (only when IA returned false)
  P->>PG: withTransaction(upsertMessage + replaceLinks)
  alt media-type but no file transfer
    P->>PG: recordMediaError("no downloadable file …")
  end
  alt row persisted AND file present
    H->>FR: receive(file)  (non-blocking)
    FR->>Core: ReceiveFile (storeEncrypted:false)
    Core-->>FR: rcvFileComplete
    FR->>M: storeMedia → MEDIA_ROOT/YYYY/MM/…
    M->>PG: updateMedia (path, mime, size)
  end
```

## 2. In-process SDK topology — no WebSocket daemon

`package.json` declares `"simplex-chat": "^6.5.4"` (`package.json:45`); the SDK docstring in `src/bot/avatar.ts:6` references the 6.5.4 `bot.ts`. The SDK embeds the Haskell core in-process as a native addon. `src/bot/client.ts::startBot` calls `bot.run(...)` (`client.ts:80`), loading the core, opening the local SimpleX DB, and starting the event loop inside Cinderella's own process. There is **no separate SimpleX daemon and no exposed WebSocket port** — the deprecated ≤0.3.x WebSocket-daemon model is not used. Events are wired on the in-process `chat` handle: `newChatItems`, `chatItemUpdated`, `groupChatItemsDeleted`, `chatItemsDeleted` in `handler.ts`; `rcvFileComplete` / `rcvFileError` / `rcvFileWarning` in `client.ts:116-120`.

## 3. Two databases, kept separate

The SimpleX core's state is SQLite at `<simplexDbPrefix>_chat.db` / `<simplexDbPrefix>_agent.db` (`SIMPLEX_DB_PREFIX`, opened via `bot.run({ dbOpts: { type: 'sqlite', filePrefix } })` at `client.ts:88`), holding the bot's identity/contacts/group/transfer state, protected by filesystem permissions only. The archive is PostgreSQL (`DATABASE_URL`, `pg.Pool` in `db/pool.ts`), holding messages, links, consent, settings, audit, webauthn credentials, and admin sessions. Media bytes live in neither DB — only a relative path is stored (§4). `index.ts::assertDbReady` gates startup on the archive DB: `assertDbReachable` runs `SELECT 1`, then it checks `to_regclass('public.messages')` (`index.ts:45-50`).

## 4. Media store layout and the XFTP temp-dir (EXDEV) constraint

`client.ts::ensureDirs` creates the SimpleX DB dir, the files folder, `MEDIA_ROOT`, and `<parent-of-files-folder>/xftp-tmp`, then pins `process.env['TMPDIR']` to that temp dir before startup (`client.ts:37-45`). Reason: the core stages/decrypts XFTP downloads in a temp dir then `rename()`s them into the files folder; if temp is on a different device (the default OS temp is `/tmp`, a tmpfs, further isolated by the systemd unit's `PrivateTmp`) the rename fails with `EXDEV` and every receive stalls. Pinning temp to the files-folder filesystem makes it a cheap same-device rename.

`media.ts::storeMedia` moves completed files into `MEDIA_ROOT/YYYY/MM/<fileId>-<sanitized-name>` (UTC date bucket from `msg.sentAt`, name sanitized to `[A-Za-z0-9._-]` and truncated to 120 chars). The DB stores the relative POSIX path, the MIME type (derived from the file extension, default `application/octet-stream` via `mimeForFileName`), and the on-disk size — never the bytes. The admin console addresses media **by message id** at `/media/msg/:id` (`src/web/views/admin-media.ts`), resolving the path from the row and refusing anything quarantined; the raw static mount over the media tree was **removed** by CCB-S3-013 §4, because any authenticated session could otherwise read quarantined bytes by path. See §25 and **D-074**.

> Note: the outline says the XFTP temp dir must share "the media filesystem." The code pins `TMPDIR` next to the **files folder** — `join(dirname(cfg.simplexFilesFolder), 'xftp-tmp')`, set at `client.ts:44` — not `MEDIA_ROOT`. The constraint solved there is temp-vs-files-folder (the core's internal rename). The separate files-folder → media-store move is a distinct step that tolerates `EXDEV` via copy+unlink (`media.ts::moveFile`, `media.ts:69-81`).

## 5. Avatar propagation (SDK-native)

The avatar is carried inside the profile passed to `bot.run` (`client.ts:77-107`, `avatar.ts`). `loadAvatarDataUri` downscales via `sharp` to a small square JPEG data URI kept under a 12,000-char budget (`MAX_DATA_URI_CHARS`), comfortably below the ~15,610-byte profile envelope. `updateProfile` is set to `image !== undefined` (`client.ts:103`) so the SDK applies/self-heals the full profile (image included) only when an image is loaded — and does **not** blank the avatar when the file is absent. `apiUpdateProfile` reaches direct CONTACTS only (the bot has none); existing GROUP members get the avatar (`XInfo`) only when the bot next sends a group message. `avatar.ts::flushAvatarToGroups` — called once from `index.ts::startCaptureWorker` (`index.ts:113`) — sends one minimal group message (`🕯️✨`, `FLUSH_MESSAGE`) per distinct avatar, gated by a SHA-256 marker in `settings`.

> Note: this section describes the mechanism, which is unchanged, and `bot.run` is now reached only by `npm run connect` (D-155 removed the pre-runtime boot path). The deployment dresses its bots in `startRuntimeHost`, **one image per bot** since CCB-S5-007 — see §32.6. The flush marker has been **per bot** since CCB-S5-001: `flushMarkerKey(simplexUserId)`, not one deployment-wide `avatarGroupFlushMarker` key, because two bots sharing one avatar file would otherwise have left the second bot's members with no picture forever and nothing logged.

> Note: the outline and the `AVATAR_PATH` docstring (`config.ts:35-39`) describe the older behaviour — "Re-applied to the SimpleX profile on every startup (bot.run blanks it otherwise)." The current code does the opposite by design and specifically guards against blanking (see the comment at `client.ts:95-102`); the `config.ts` comment is stale relative to the implementation.

## 6. Data flow: message in → parse → persist → media receive

Parse (`message.ts::parseGroupMessage`, keeps only group + `groupRcv` + `rcvMsgContent`, extracts the stable `senderMemberId` and the chat-item `itemId`, which is persisted as `group_msg_id`) → scope + classify (`handler.ts`, prefers the stable `targetGroupId` resolved once at startup so a group rename doesn't stop capture; consent commands are routed to `onCommand` and **not** persisted) → persist (`persist.ts`'s `onMessage` hook, `withTransaction(upsertMessage + replaceLinks)`; a media-type message with no file transfer is recorded via `recordMediaError`) → receive media, non-blocking, only if the row persisted and a file is present (`FileReceiver.receive` registers the pending entry _before_ issuing `ReceiveFile` with `storeEncrypted:false`, resolves on `rcvFileComplete`; a timeout, `rcvFileError`, or a rejecting command response reject; `rcvFileWarning` is transient) → store + record (`storeMedia` + `updateMedia`; an orphan is flagged if no row exists; `onFileFailed` records a `media_error`). Edits re-persist (overwriting pre-edit text, `chatItemUpdated`); in-group deletions route to the idempotent `markDeleted`, keyed by `(group_id, group_msg_id)`.

## 7. The admin console

`web/server.ts` builds Fastify with `trustProxy: 'loopback'` (`server.ts:82`), listening on `127.0.0.1:ADMIN_PORT` (default 8787), never a public interface; nginx TLS fronts it at `<admin-host>`. Server-rendered HTML with htmx (`public/assets/htmx.min.js`, vendored by `scripts/copy-assets.mjs`, detected via the `hx-request` header) plus Tailwind (`assets/app.css` → `public/assets/app.css`); no SPA. Since CCB-S3-015 Stage 3 the console wears the **website's dark-neon design system** (cyan accent): `assets/app.css` carries the site design tokens (originally mirrored from the site's `css.ts`, which left with the site under D-089; the copy in `assets/app.css` is now the console's own and no longer tracks it), the self-hosted Source Sans 3 / JetBrains Mono woff2, and un-layered overrides that remap the light Tailwind utilities to the dark palette centrally — so no view was rewritten. Only the admin links `app.css` (the public front and marketing site inline their own CSS), and the theme adds no inline styles and needs no CSP change (same-origin sheet + `default-src 'self'` fonts). Controls enforced in-process: configurable security headers (`applySecurityHeaders`), a global rate limit and IP allow/deny policy (`GlobalRateLimiter`, `ipAllowed`), session read + auth guard, CSRF on all mutations (`csrfOk`), and step-up re-verification for sensitive mutations. Primary auth is passkeys/WebAuthn (`@simplewebauthn`) with an Argon2id break-glass path (+ optional TOTP). Sessions are persisted in PostgreSQL (`admin_sessions`, `007_sessions.sql`).

## 8. Configuration and secrets

Configuration is env-driven (`config.ts`), from a git-ignored `.env` in development or systemd in production; `redactConfig` scrubs the DB password (and credential-bearing query params) before logging. `loadConfig` reads `BOT_DISPLAY_NAME`, `SIMPLEX_DB_PREFIX`, `SIMPLEX_FILES_FOLDER`, `GROUP_NAME`, `MEDIA_ROOT`, `AVATAR_PATH`, `DATABASE_URL` (the only required var), and `LOG_LEVEL`. `loadAdminConfig` (loaded lazily, only when the admin server starts) reads `ADMIN_PORT`, `ADMIN_USERNAME`, `ADMIN_PASSWORD_HASH` (must be Argon2id), `SESSION_SECRET` (≥ 32 chars), `PUBLIC_ORIGIN`, and the optional `WEBAUTHN_RP_ID` / `WEBAUTHN_ORIGIN` / `WEBAUTHN_RP_NAME` (defaulted from `PUBLIC_ORIGIN`). It then calls `validateRpConfig` (CCB-S2-011): the effective RP ID must be the WebAuthn origin's host (or a registrable parent) or the server refuses to boot — an RP-ID/origin drift otherwise silently invalidates every registered passkey. The effective RP ID/origin are logged at admin startup (§7 / D-022).

## 9. Schema / migrations

- **001** `init` — enums (`message_type`, `moderation_state`), `messages`, `links`, FTS.
- **002** `consent` — `consent` table + the `message_publish_state` / `published_messages` publish views.
- **003** `admin` — `settings`, `audit_log`.
- **004** `moderation` — adds `messages.media_error` and folds `moderation_state='rejected'` into the publish views (views dropped + recreated).
- **005** `deletion_provenance` — splits `group_deleted` (in-group, non-clearable) from the admin-initiated `deleted`.
- **006** `webauthn` — `webauthn_credentials` + break-glass TOTP.
- **007** `sessions` — `admin_sessions` (persisted across restarts).
- **008** `reports` — public content reports + the admin review queue.
- **009** `consent_actions` — the consent decision journal (source + prior state) that makes UNDO possible (CCB-S3-002). Provenance only; the publish views still derive from `consent` alone.
- **010** `asset_mappings` — pinned symbol→asset mappings for the price plugin.
- **011** `seed_major_assets` — seeded major assets with locked pins.
- **012** `correct_major_pins` — corrects pins that predate the seed.
- **013** `bot_messages` — her own messages: bot rows, mentions, the second publication branch.
- **014** `media_derivatives` — the stripped public derivative alongside the original.
- **015** `member_instructions` — member instructions and exchange pairing.
- **016** `video_links` — video link extraction.
- **017** `jobs` — the durable queue: state machine, `FOR UPDATE SKIP LOCKED` claim, backoff/dead-letter, idempotency.
- **017** `cinderella_profiles` — profile registry (parallel local-AI work, see D-069).
- **018** `capture_events` — the capture write-ahead log. **No production writer yet** (§22).
- **018** `runtime_policy_decisions` — runtime policy (parallel local-AI work).
- **019** `formatted_text` — formatted text spans.
- **019** `bot_onboarding` — bot onboarding (parallel local-AI work).
- **020** `revocation_holds` — revocation hide/delete plus evidence holds, including the BEFORE DELETE hold trigger.
- **021** `consent_gaps` — a restore never publishes what was said while hidden.
- **022** `quarantine_withholds` — a hash match or an escalation is served to nobody.

Each migration is applied once, inside a transaction, by `db/migrate.ts`. **Three numbers
exist twice** (017, 018, 019), because the parallel-chat AI work reused numbers the
CCB-attributed work had already taken. The runner keys `schema_migrations` on the **full
filename**, so all six apply exactly once and nothing is broken — but the number is a label
rather than an ordinal, **no applied migration may be renamed**, and new migrations allocate
from the highest number on disk plus one (currently **054**, since 053 landed with the knowledge
base controls). See **D-069** and the appendix.

> Note: `CLAUDE.md`'s migrations list labels 004 the "moderation gate"; the file itself is headed "Cinderella admin views support — Season 0, Stage 5" (`migrations/004_moderation.sql:1`) and its concrete effect is adding `media_error` and folding `rejected` into the publish views. It implements the takedown gate in the views but is not exclusively about moderation.

## 10. Planned / not yet implemented

Per `CLAUDE.md`'s "Parked" section:

- **`/embed/<id>` public front now SHIPPED** (§11) — the SSR front, server-side
  filters/search, and consent-gated media (CCB-S2-003); the full SEO/marketing suite
  (CCB-S2-004); house-palette theming with a light/dark toggle (CCB-S2-005); and
  consent-gated live auto-update (CCB-S2-006). Still planned: multiple templates, a
  design editor, the Web Component, an SSE upgrade of the live-update transport, and
  SSR caching with publish-event invalidation.
- **A detection provider** — the screening seam and quarantine custody are **built** (§26); no provider is connected, the null provider transmits nothing, and the public copy says "in development". `moderation_state` is **not** a dormant hook: admin takedown and the report queue write `'rejected'` (§11).
- **Self-hosted relay/super-peer capture.**

## 11. Public archive front (CCB-S2-003)

The public, unauthenticated `/embed/<id>` front is deliberately layered so later
briefings extend it without touching consent logic:

- **Data layer** — [`src/db/public-archive.ts`](../src/db/public-archive.ts):
  `listPublishedItems`, `listPublishedIds` (the cheap ids + version-hash query for
  the live poll, CCB-S2-006), and `getPublishedMedia` read **only** through the
  `published_messages` view (the consent gate) — a shared `buildPublishedWhere`
  keeps the item and ids queries filtering identically. Filters (media type, UTC time
  window, `websearch_to_tsquery('simple', …)` over the generated `search` vector)
  run in SQL, so filtered/searched views are server-rendered and crawlable.
- **Presentation layer** — [`src/web/front/render.ts`](../src/web/front/render.ts):
  one entry point `renderEmbedPage(ctx)` takes a `PresentationConfig` (template +
  theme + layout, from the `embed_instances` record) and returns full SSR HTML —
  content rendered into the markup (the SEO foundation), not client-JS-rendered. The
  head carries `<title>`/description, canonical, Open Graph + Twitter, and an
  extensible schema.org JSON-LD `@graph` (WebSite · Organization · ItemList of
  DiscussionForumPosting). The list-and-pager region factors into
  `renderStreamRegion` / `renderStreamFragment` (CCB-S2-006) so the live fragment and
  the full page render identical markup. The seam is where later templates and a
  design editor plug in.
- **Routes** — [`src/web/front/embed.ts`](../src/web/front/embed.ts): `GET /embed/:id`
  (page) and `GET /embed/:id/media/:msgId` (media, resolved through the published
  check every request). Registered in `buildServer` outside the admin auth guard;
  `/embed/*` is exempt from auth, the admin IP policy, and the admin rate-limit, and
  sets its own headers (embeddable `frame-ancestors *`, indexable, `no-store`, a
  per-response CSP nonce) — the admin strict headers are skipped for `/embed/*` in
  the onSend hook. The iframe posts its height to the parent
  (`{cinderellaEmbedHeight}`), matching the Season 1 snippet. Verified end-to-end by
  [`scripts/verify-public.ts`](../scripts/verify-public.ts).
- **SEO & marketing suite (CCB-S2-004)** — [`src/web/front/seo.ts`](../src/web/front/seo.ts)
  holds all artifact builders (resolved head, the toggle-driven schema.org JSON-LD
  `@graph`, sitemap, RSS feed, robots.txt, and an auto OG image via `sharp`). They
  all consume the SAME consent-gated data and hang off the instance's `seo` config
  ([`src/db/embeds.ts`](../src/db/embeds.ts) `SeoSettings`, admin-edited in
  [`src/web/views/embeds.ts`](../src/web/views/embeds.ts)), so the render path stays
  single. New public routes: `/embed/:id/sitemap.xml`, `/embed/:id/feed.xml`,
  `/embed/:id/og.png`, and the origin-level `/robots.txt` + `/sitemap.xml` (index).
  `isPublicFront()` now also covers `/robots.txt` and `/sitemap.xml`. Verified by the
  extended `verify:public` (structured-data toggles, sitemap/feed/robots, OG image,
  analytics-CSP, and the consent gate across every new output).
- **Theming (CCB-S2-005)** — the front ships the SimpleGo house palette, **dark by
  default** via `data-theme="dark"` on `<html>` (`:root` is light). The instance
  `mode` (auto/light/dark) sets the SSR initial theme; a no-flash inline `<head>`
  script reads `localStorage['sg-theme']` (the same key as the operator's site)
  before paint, and a sun/moon toggle in the header flips + persists it and updates
  the `theme-color` meta. Operator accent/bg/text overrides still win over the house
  tokens when set (compared against the built-in defaults in `themeCss`). All
  nonce-guarded — no CSP change — and the SSR content/SEO are untouched (progressive
  enhancement). In [`src/web/front/render.ts`](../src/web/front/render.ts).
- **Live auto-update + infinite scroll (CCB-S2-006/007)** — an open page keeps itself
  current AND pages the full archive with no manual refresh, as progressive enhancement
  over the unchanged SSR/SEO baseline. The stream pages by a stable `(sent_at, id)`
  cursor (`listPublishedItemsByCursor`), not offset, so nothing dupes/skips under
  concurrent publish/recall. Consent-gated routes
  ([`src/web/front/embed.ts`](../src/web/front/embed.ts)), all reading
  `published_messages`: `GET /embed/:id/page?cursor=&dir=older|newer` → JSON
  `{ html, nextCursor, hasMore }` of bare `<li>` cards (`renderCards`, byte-identical to
  SSR); `GET /embed/:id/state?cursor=<bottom>&top=<top>` fingerprints the EXACT loaded
  band (`listPublishedSpanState`; ids + hash + `hasNewer`). The single inline
  `STREAM_SCRIPT` owns one loaded-item model: a bottom `IntersectionObserver` appends
  older cards and windows the top behind a height spacer (DOM bounded at `WINDOW_CAP`); a
  top sentinel restores windowed-off cards on scroll-up by re-fetching (never stashing —
  so a recalled card can't return); the ~18s poll sweeps out any recalled id wherever it
  sits and prepends new publishes at the true head. Windowing is symmetric (trim top on
  down-scroll, trim bottom on restore) so the loaded set never exceeds the span LIMIT.
  A recalled item vanishes (media `404`s) within one interval; a new one appears live.
  CSP change is `connect-src 'self'` only; `/page` and `/state` have SEPARATE per-IP
  rate-limit buckets (a scroll burst can't starve the consent poll). Deep content stays
  crawlable via the untouched `?page=N` SSR pages + `<link rel=prev/next>` + sitemap;
  JS-off keeps the pager. The `/fragment` route + wholesale swap (CCB-S2-006) are
  retired. SSE + full virtualization are recorded future upgrades. Verified by the
  extended [`scripts/verify-public.ts`](../scripts/verify-public.ts) + a windowing
  simulation.
- **Loading polish (CCB-S2-010)** — three infinite-scroll UX fixes, all in the
  client/CSS ([`src/web/front/render.ts`](../src/web/front/render.ts)): (1) the no-flash
  `<head>` script marks `html.embedded` when framed, and `html.embedded{overflow:hidden}`
  hides the iframe body's own scrollbar (the host scrolls the auto-sized frame) — killing
  the transient scrollbar flash between an append and the height re-post, before the first
  paint; (2) a house-themed **skeleton loader** (shimmer placeholder cards, indeterminate —
  the chunk fetch is small so byte-progress adds no value; `prefers-reduced-motion` honoured)
  reserves space at the bottom while a chunk fetches, replaced by the real cards on arrival,
  with an error/retry state; (3) appended/prepended cards **fade + rise in** (`card-in`), and
  because bottom-appends grow below the fold the viewport never shifts. Direct (top-level)
  views keep the normal document scrollbar.
- **Media playback (CCB-S2-008)** — video renders as an INLINE native `<video controls
preload="metadata" playsinline>` in the card (`itemMedia`,
  [`src/web/front/render.ts`](../src/web/front/render.ts)), house-styled and theme-aware,
  replacing the old "Open video" link. A themed Download button is gated by the new
  per-instance `player.showDownload` (default ON; OFF → button hidden +
  `controlsList="nodownload"`). The embed CSP adds `media-src 'self'`, and the
  consent-gated media route now serves HTTP **byte-ranges** (`206` / `Accept-Ranges` /
  `Content-Range`, strictly after the consent gate) so WebKit plays inline and seeking
  works; the copy-paste snippet's iframe gains `allow="fullscreen"` so the native
  fullscreen button works cross-origin. `HEIGHT_SCRIPT` re-posts iframe height on
  `loadedmetadata` + `fullscreenchange`.
- **Content reporting (CCB-S2-009)** — a per-item no-JS `<details>` "Report" form
  ([`renderCards`](../src/web/front/render.ts)) posts to `POST /embed/:id/report` — the
  ONE mutating public-front route (exempt from the admin CSRF/auth preHandler; rate-limited
  own bucket; cross-site rejected via `Sec-Fetch-Site`). It gates on `isPublished`
  (`published_messages`, D-016) with a neutral 303 (no oracle) and NEVER changes
  publication (visible-until-review); it stores minimal data (`migrations/008_reports.sql`
  - [`src/db/reports.ts`](../src/db/reports.ts)) — a keyed daily-rotating `HMAC` token, no
    raw IP. The admin side ([`src/web/views/reports.ts`](../src/web/views/reports.ts)) is a
    grouped `/reports` queue with consent/auth-gated previews and audited take-down / resolve
    / dismiss (takedown reuses `setModerationState`); an open-count bar is injected into every
    admin page via an `onSend` comment marker. External alerts are an inert Settings
    placeholder. Verified by
    [`scripts/verify-public.ts`](../scripts/verify-public.ts) +
    [`scripts/verify-admin-views.ts`](../scripts/verify-admin-views.ts).

## 12. Public marketing site — MOVED OUT OF THIS REPOSITORY (CCB-S2-012, redesigned CCB-S3-001, split under D-089)

> **None of the code described in this section is here any more.** The marketing site is
> its own repository, process, port `8788`, systemd unit and deploy script (**D-089**).
> Every `src/web/site/...` path below is a **dead link** and is kept only because the
> design decisions it records are still true of the site as it runs; they are now
> maintained in the site repository. `src/site/settings.ts` went with it, having first
> been cut loose from the product's database under CCB-S3-041.
>
> What did **not** move, and is still described correctly elsewhere in this document: the
> public archive front at `/embed/` (§11), which is a different surface with different
> rules (embeddable rather than frame-DENY). The domain root `/` on the console origin
> now redirects to `/dashboard`.

The domain root `/` was a public, SSR, indexable **marketing site** — the face of the
Cinderella bot suite (the archive is one capability under it), separate from `/embed`
and from the admin. It is built in the **public-front style** (self-contained, inline
nonce'd CSS/JS, `html`/`raw` escaping), NOT the Tailwind admin shell. Code lived in
`src/web/site/` (`routes.ts`, `render.ts`, `css.ts`, `client.ts`, `icons.ts`, `seo.ts`,
`i18n.ts`, `pages.ts`) with settings in `src/site/settings.ts`.

- **Design (D-029, amended by D-030).** The operator's approved dark-neon template
  ported 1:1: ink/cyan/magenta token system, **dark-only** (the light theme, its
  toggle and the `cn-theme` storage were removed per operator), Source Sans 3 +
  JetBrains Mono **self-hosted** woff2 subsets (vendored in `assets/site/fonts/`, SIL
  OFL, copied to `public/assets/site/` by `scripts/copy-assets.mjs`), the brand avatar
  (`assets/site/cinderella-avatar.jpg`), and lucide icons **inlined server-side** from
  the vendored `lucide-static` package ([`src/web/site/icons.ts`](../src/web/site/icons.ts))
  — no CDN anywhere. The template's React effects (starfield canvas, scroll reveals,
  burger menu, theme toggle, the interactive archive-demo search) are small vanilla
  scripts under the CSP nonce ([`src/web/site/client.ts`](../src/web/site/client.ts));
  every page is fully server-rendered and degrades cleanly without JS. The shared
  `src/web/theme.ts` (`sg-theme`) continues to serve the **archive front** unchanged;
  the site owns its own tokens in [`src/web/site/css.ts`](../src/web/site/css.ts).
  **No style attributes anywhere:** the site CSP (`style-src 'nonce-…'`) covers only
  `<style>` elements — browsers block inline style ATTRIBUTES under it — so every
  layout rule the template carried as `style={{…}}` lives as a class (`NO_INLINE_CSS`
  in css.ts); `verify:site` asserts rendered pages contain zero `style="`.

- **Pages (CCB-S3-001).** Home (cinematic hero + live archive demo with sample data +
  pipeline tiles + suite/roadmap + security card), Features (the four firewall stages +
  roadmap), Pro (tiles + placeholder pricing tiers + customer card), Security (CSAM
  screening card with consent→screen→publish flow, marked "In development"), Open
  Source (repo/AGPL rationale + self-host steps), and Legal. Docs remains a clean
  `noindex` "coming soon" stub (never a 404). The **legal pages** are footer-linked on
  every page. Since CCB-S3-029 they carry **real operator data, not template copy**,
  and the texts live in [`src/web/site/legal.ts`](../src/web/site/legal.ts) rather than
  in the locale files: German is the binding version, English is a labelled convenience
  translation, and every other locale falls back to the English with a visible notice
  naming the German as governing. `/{lang}/legal` is the Impressum (indexable, verbatim
  from the operator, includes the **voluntarily appointed Youth Protection Officer**,
  and deliberately carries **no tax or economic identification number** — `verify:site`
  asserts its absence). `/{lang}/legal/privacy` is drafted from the code and is now
  **indexable and in the sitemap**. `/{lang}/legal/terms` is the one remaining draft
  (badged, `noindex`, out of the sitemap) and states plainly that no terms are in force
  rather than inventing any. No bracketed placeholder survives on any legal page in any
  locale, which `verify:site` sweeps for across all 40. See D-079.

  The **rights section** of the privacy policy (CCB-S3-029 Addendum A) is written
  around the identity model rather than around article numbers, because this service
  cannot identify its members and a standard list would fail at the first real
  request. It names the in-chat route first, states the anonymity cost of the email
  route in the member's interest, describes verification as in-band, and covers the
  two identity-loss cases separately. Its factual backbone was established by a
  50-agent read of the chat surface: only **withdrawal of consent** has a full
  in-chat route, the bot has **no private channel** (so the one-time recovery code is
  named as planned), and the operator **cannot destroy content on request** (only the
  member's own in-chat path and the evidence-hold workflow destroy), which is why an
  unverifiable erasure request is answered with an Art. 18 restriction. `verify:site`
  pins fourteen of these sentences. See D-087.

- **Routing + i18n (D-024, expanded by D-030).** Copy comes from `locales/<code>.json`
  (EN master + DE + 38 machine-translated locales = **40 languages**, each translation
  marked "pending native-speaker review" in `_meta.status`; ar/he/fa are RTL via
  `_meta.dir`), loaded by scanning the `locales/` directory at startup — adding a language
  is a file, not code. The header switcher is a details-dropdown (endonyms from
  `_meta.name`) that scales to the full set. The **em dash is banned** from visible
  copy in every language (operator rule, `verify:site` asserts zero U+2014 on rendered
  pages). URLs are per-language (`/en`, `/de`, `/en/<slug>`, plus explicit
  `/{lang}/legal/<sub>` routes for the two-segment legal slugs), one static route per
  loaded locale so nothing shadows the admin paths. `GET /` 302-redirects by the
  persisted `cin-lang` cookie → `Accept-Language` → default. A header switcher and
  `hreflang` alternates + `x-default` (plus a `/sitemap-site.xml` with `xhtml:link`
  alternates, referenced from the origin sitemap index) cover multilingual SEO. The
  CCB-S2-004 head machinery (canonical/OG/Twitter + JSON-LD Organization + WebSite +
  SoftwareApplication) is reused per page via `resolveSiteHead`.

- **The root moved the admin (D-023).** The admin dashboard relocated from `/` to
  `/dashboard` (post-login redirect + nav updated); the operator login is a discreet
  header button → the unchanged, hardened, `noindex` admin. The site sets its OWN
  headers via `applySiteHeaders`: the same nonce CSP as the archive front but
  **non-embeddable** (`frame-ancestors 'none'` + `X-Frame-Options: DENY`) and
  indexable. It is exempt from the admin auth/CSRF/IP guards via `isPublicSitePath`
  (checked alongside `isPublicFront` in the three server hooks). `robots.txt` flipped
  from a blanket `Disallow: /` to `Allow: /` with explicit admin-surface disallows.
  Static `/assets/*` responses are cached (`public, max-age=86400` + `nosniff`) instead
  of the admin `no-store` set, so the site's webfonts don't re-download per navigation.

- **Building blocks, OFF by default (D-025).** Three admin-configurable features on the
  Website page (`/website`): visitor analytics (consent-gated — loads only after the
  cookie banner grants consent, via `shouldLoadAnalytics`), a self-hosted cookie/consent
  banner (now in the template's `cn-cookiebar` style), and script-free social-share
  links. All default off; the operator opts in and carries the legal responsibility
  (noted in the admin). Verified by [`scripts/verify-site.ts`](../scripts/verify-site.ts).

- **Copy note (CCB-S3-001, operator decision).** The site's strong "consent + CSAM
  screening" messaging stands as authored in the template: the software is not yet
  distributed, so the site is a forward-looking shop window; the binding point is first
  distribution (screening must be built before any hand-over, or the site comes down).
  CSAM screening itself carries "In development" badges on Features/Security.

## 13. Interaction layer — natural addressing (CCB-S3-002)

Members can talk to Cinderella instead of typing commands. The layer lives in
[`src/interaction/`](../src/interaction/) and is wired into capture through two hooks on
`registerCapture`: `onInteraction` (returns true when the message was spoken to her, so it
is NOT archived) and `isAddressed` (a side-effect-free test used on message edits).

Responsibilities are split so that the later AI swap changes one registration and nothing else:

| Module | Responsibility |
|---|---|
| `text.ts` | Normalisation (case, umlaut folding `ö→oe`, diacritics, punctuation), tokenisation with source offsets, Levenshtein with a length-tiered threshold, quote ranges, reply-language hint |
| `addressing.ts` | Is this addressed to her? Wake word, greeting prefixes, strict first-standalone-word anchoring, nickname detection |
| `intent.ts` | The **closed** intent catalog and the resolver contract |
| `rules.ts` | The deterministic EN+DE rule engine (phrases outrank keywords; negation, hypothetical and quotation guards; third-party and search slots) |
| `resolver.ts` | The **seam**: `resolveIntent` validates every result against the catalog and falls back to the rules if the active resolver fails |
| `state.ts` | In-process, forgetful conversation state: follow-up windows, pending confirmations, retort rotation, reply rate limits |
| `engine.ts` | Decides what to do: confirmations, refusals, read-only answers, undo, nickname retorts |
| `reply.ts` | Pure presentation (CCB-S3-003): whether a reply quotes, and whether it opens with the member's name |
| `near-misses.ts` | Diagnostics (CCB-S3-005): why a message that looked like an address was ignored |
| `settings.ts` | The admin-editable model + the shipped defaults (persona copy, retorts) |

**Addressing.** A message is addressed to her when it starts with the wake word (a greeting
may precede it), when it replies directly to one of her messages (`quotedFromBot`, derived
from the quoted item's `groupSnd` direction), or when it arrives inside that member's
follow-up window. Anchoring is strict: a token that is the wake word **plus a suffix**
(`Cinderellas`, `Cinderella's`) is rejected before fuzzy matching runs, because edit distance
would otherwise forgive exactly the case that must be ignored. Nicknames are matched
**exactly** — `cin` and `ella` are too short to fuzz without firing on ordinary words.

**Resolution never executes.** The resolver returns `{intent, confidence, slots, lang}` and
nothing more. The engine performs actions, and every consent change goes through the same
`applyConsentChange` the `/publish` command uses (D-032), so the two paths cannot drift.

**Being named is not being addressed (CCB-S3-005).** Four guards sit between the wake word
matching and the dialogue running, each switchable in the console:

1. **Forwarded messages are skipped entirely** — checked before addressing, so no other guard
   has to be right for this one to hold. This is a consent-safety control: a forwarded
   announcement that opens with her name and quotes the commands it documents resolves to
   PUBLISH at high confidence, which would put a consent prompt in front of the whole group.
2. **UNKNOWN is answered only on a strong signal** — a greeting, a direct reply to her, or
   being mid-conversation. A bare leading name is the weak case, because that is how
   announcements, quotes and third-person sentences begin. Weak plus UNKNOWN means silence.
3. **A length guard** — over 200 characters, only a high-confidence intent is acted on.
4. **Optional strict mode** — a greeting is required before the name; replies, the follow-up
   window and slash commands are unaffected.

Everything the guards drop is recorded in an in-memory near-miss log and shown on the
Interaction page, because a guard nobody can see is indistinguishable from a broken bot.

**Reply language (CCB-S3-005, Addendum A / D-067).** Where an intent RESOLVES via a keyword
set, that set's language is authoritative and decides the reply — the resolver already knows
it with certainty (`IntentResult.langMatched`), which beats statistical detection on a short
message that cannot supply the contest's length-scaled margin (this is why `Cinderella Hilfe`
is answered in German). The `langMatched` flag is set only when the winning language strictly
beats every other's best score, so a keyword identical in both (`status`, `undo`) stays
ambiguous. Where there is no match to learn from (UNKNOWN, or an ambiguous match), the reply
falls back to the scored contest between hint sets (D-034), then the default. Precedence:
`fixed` mode → an open confirmation offer (so a handshake cannot change language midway) → an
authoritative matched keyword-set language → confident contest detection → the language
remembered for this member's follow-up window → the configured default. The wake word is
stripped before detection (the addressed path measures `address.instruction`). Only languages
with real persona copy are offered.

**A state question is never an action request (CCB-S3-006).** The resolver re-points
`whats my publish status?` at STATUS instead of PUBLISH. Consent prompts appear only because
someone asked for the action.

**Carry-over may reuse knowledge, never create it (CCB-S3-008).** An inherited intent may only
act on an asset already pinned in `asset_mappings`, and may never ask a question of its own.
See D-045.

**Elliptical follow-ups (CCB-S3-006).** Inside the window, a short UNKNOWN fragment inherits
the member's previous READ-ONLY intent, so `monero?` after a price answer is a price
question. Bounded twice: only PRICE and SEARCH are inheritable, and only fragments of four
tokens or fewer qualify.

**Acting is stricter than understanding.** Inside the follow-up window she is hearing messages
that were never marked for her, so the confidence bar there is raised to 0.8 — above the score
of a lone keyword. `I'll publish the photos later` is left alone; `publish me` is not.

**One transport.** Both the engine and the slash-command handler send through
`sendToChat` (`src/bot/send.ts`), which chooses between a plain group message and a quoting
reply from a single boolean. They used to call the SDK independently, which is how every reply
came to quote; one seam means they cannot disagree again. Presentation is decided by
`formatOutbound` (`reply.ts`) from the admin `replyMode` setting — see `wire-format.md` §3c.

**Message flow.** Slash command → `onCommand` (immediate, unchanged). Otherwise → the engine.
A message that is command-shaped (`/…`) never enters the conversational path, so switching
slash commands off cannot be defeated by talking to her mid-conversation.

Verified by [`scripts/verify-interaction.ts`](../scripts/verify-interaction.ts) (105 checks,
real PGlite + the real capture pipeline) and §11 of
[`scripts/verify-admin-views.ts`](../scripts/verify-admin-views.ts).

## 13a. Her own messages in the archive (CCB-S3-007)

Publication derives from member consent, and Cinderella has none — so her side of
every exchange was missing and published conversations read as one-sided. She is
**not** a member giving consent, and no consent row is fabricated for her: her
publication is a **second branch of the same derivation**, decided by the
operator's `archive` settings.

**Capture is at the SEND SITE**, not from the event stream. `sendToChat` now
returns the chat items the core created, and `withBotCapture`
(`src/capture/bot-message.ts`) records them. The reason is that only the send site
knows what KIND of reply it was; recovering that from the text afterwards would be
guesswork. Both reply paths — the dialogue engine and the slash commands — go
through the one wrapper, as they already do for the transport.

The event path cannot pick them up as a duplicate: `parseGroupMessage` accepts
only `groupRcv` items, and hers are `groupSnd`. That was previously true by
accident; it is now stated in the code, because the same function feeds the
consent-command parser and the dialogue engine, and a reply of hers arriving as
input would let her answer herself.

**Categories** are declared by the handler, expressed as a total
`Record<PersonaKey, ReplyCategory>` (`PERSONA_CATEGORY`), so adding something new
for her to say without deciding whether it belongs in the archive does not
compile. A row with no category never publishes, which covers reply paths that do
not go through a persona key at all.

**The leak guard** lives in the derivation, not at composition time, so a member's
later `/unpublish` retroactively removes their name from messages of hers that
were published while their consent stood. See `docs/security.md` §9b.

**Known gaps.** The welcome message is sent by the one-shot `npm run connect`
process, whose capture pipeline is not running, so it is never archived. The
avatar-flush message (`🕯️✨`) bypasses `sendToChat` entirely and is likewise not
archived — correct, but by omission rather than by rule.

## 14. Plugins (CCB-S3-004)

Capabilities beyond the archive itself are plugins. The framework is in
[`src/plugins/`](../src/plugins/) and is deliberately thin — it has to carry a plugin, not
become one.

A plugin declares an id, name, version, default-enabled flag, the intents it contributes, and
its admin page. Enablement lives under the `plugins` settings key; its own settings under
`plugin:<id>`. The sidebar's **Plugins** submenu is generated from the registry, so adding a
second plugin is a `definePlugin` call, a settings page and one import.

**A disabled plugin registers no intents.** The intent catalog is two things: `INTENTS`
is the compile-time closed set that makes an invented intent a type error, and a RUNTIME
catalog derived from enablement. When a plugin is off its intents leave that catalog, so
`rules.ts` skips their patterns and `resolver.ts` downgrades anything claiming them to
UNKNOWN. Absence is the mechanism; there is no handler left to reason about.

### 14.1 Per bot (CCB-S5-021, D-175, migration 051)

**Enablement is per bot.** It was one `plugins` settings key with one writer, so enabling Web
Search enabled it for every hosted bot. `cinderella_plugin_overrides`
(`bot_profile_id, plugin_id, setting_key, value`) carries a bot's deviation on D-155's
mechanism: absence means inherit, so editing the shared value still reaches every bot that has
not deviated. Reading model in [`src/plugins/scope.ts`](../src/plugins/scope.ts), SQL in
[`src/db/plugin-overrides.ts`](../src/db/plugin-overrides.ts).

**Exactly two settings are per bot**, both `enabled`; the other eighteen are deployment-wide.
`PLUGIN_SETTING_SCOPES` is the inventory as data, mirrored by the migration's CHECK, and
`verify:plugin-scope` asserts the two agree and that every key of every plugin's settings
document is placed. The three questions that decide a placement, and what a future per-bot
capability follows, are in D-175.

**The runtime catalog is per bot and is a PARAMETER, not module state.** It was a
`let activeIntents` set in `interaction/intent.ts` written by `setActiveIntents`, which is one
catalog for the process: correct with one hosted bot, and with several it meant a plugin
switched off for one bot was still in every bot's vocabulary. `PluginService.capabilitiesFor`
builds it per bot and `IntentContext.intents` carries it, **required rather than optional**, so
a call site cannot silently inherit a deployment-wide set. The property holds at three layers:
the rule engine never matches the pattern, the model is never shown the intent (including the
slot rules, the examples and the `CROSS_REFERENCES` inside other intents' definitions), and the
seam downgrades a resolver that claims it anyway. The `prices` and `webSearch` ports are live
getters gated on the same per-bot fact, so the second line of defence cannot drift from the
first between restarts.

**A cache miss fails CLOSED**: a bot whose rows have not been read gets no plugin capabilities
rather than the shared ones, which is the opposite of `InteractionService` and deliberately so
(D-175). Both writers re-derive rather than clear, so an ordinary console toggle opens no window.

**The budget number is deployment-wide; the spend is per bot.** Crypto prices already spent per
bot through each engine's `ConversationState`; web search now carries the bot in its rate-limit
key, where isolation had been an accident of SimpleX ids differing per profile (the accident
migration 044 removed from the moderation counters).

**Console**: the plugin list sits under the bot switcher and edits the selected bot, with a
three-state control (on for this bot / off for this bot / follow the deployment) and the
shared-or-own badge the Book and Interaction pages use. Each plugin's own settings page carries
**no** switcher and a banner saying it is deployment-wide and how many bots that is.

## 15. Market data — the Crypto Prices plugin (CCB-S3-004)

Code in [`src/plugins/crypto-prices/`](../src/plugins/crypto-prices/). `PRICE` is read-only:
no confirmation, no consent involvement, nothing journalled.

| Module | Responsibility |
|---|---|
| `providers/types.ts` | The `PriceProvider` seam: resolve, quote, capabilities, attribution |
| `providers/adapters.ts` | CoinMarketCap, CoinGecko, Dexscreener |
| `service.ts` | Lazy resolution, pinning, the quote cache, failover, cross rates |
| `settings.ts` | The plugin's own settings, including write-only keys |
| `../secrets.ts` | AES-256-GCM at rest for provider keys |
| `../../db/asset-mappings.ts` | The pinned symbol→asset table |

**Resolved once, pinned forever.** A symbol is resolved on first use; one match pins
automatically, several make her ask and the member's answer is pinned. Pins are global by
default and never silently re-resolved, because provider rankings move and a quietly different
answer on a later day is worse than no answer. An operator can lock, edit or delete a pin;
deleting forces a fresh resolution.

**Identity is (chain, contract), not a ticker.** Ethereum HEX and PulseChain HEX share an
identical contract address, because PulseChain is an Ethereum state fork — so the Dexscreener
adapter always uses the chain-scoped endpoint. An address-only lookup returns the deepest pool
across all chains, which for HEX is the PulseChain one and roughly 2.4x wrong.

**Failover and attribution.** Providers are tried in the operator's order and skipped on error,
timeout, rate limit, or "does not know this asset". Ids are never reused across providers.
The licence-required credit travels with the quote and names whichever provider actually
answered.

**Prices are always fetched on request** — never preloaded. The only thing between a question
and a provider is a short TTL cache, capped per provider by what its licence permits, plus a
per-member and per-chat budget on price questions.

## 15a. Provider diagnostics and pin serviceability (CCB-S3-008)

Every attempt against a provider is recorded in an in-memory ring buffer
(`src/plugins/crypto-prices/attempts.ts`): provider, operation, symbol, outcome, latency and
HTTP status, including attempts that were never made and why (no id for this pin; our own
per-provider budget). The plugin page shows per-provider health and the recent failures.

`checkPins()` reports any pinned asset that no enabled provider could serve. It runs at boot
as a warning and on demand from the plugin page. The reason it exists: a pin pointing at a
provider that is disabled, keyless or simply holds no id for it fails EVERY lookup, silently
and forever, whereas an unpinned symbol would simply be resolved and answered.

**Secrets, and the shape of the bug that hid here.** A typed API key arrives under
`apiKeyInput`; `apiKey` is storage only. When they were one field, `PluginService.load()`
looked exactly like a form submission and re-encrypted the stored key on every boot, so
providers were handed ciphertext as their credential — see D-046.

## 16. Media stripping and derivatives (CCB-S3-011)

`src/media/` holds three pieces: `exif.ts` detects what a file carries (presence only, never
values), `strip.ts` writes a metadata-free derivative with `sharp`, and `pipeline.ts` is the one
place that records the outcome — used by both the capture path and the remediation script, so
the two cannot disagree.

Migration 014 adds `media_derived_path` (the copy to serve), `media_meta_found` (flags only, for
aggregate reporting) and `media_strip_skipped` (formats with no stripper here). It also had to
re-declare `published_messages`: migration 013 replaced `SELECT m.*` with an explicit column
list, so a new column is invisible to every public reader until it is named there.

Stripping runs at capture, not lazily at first request — a photograph should never be one
cache-miss away from being served with its GPS intact.

## 17. Member instructions and exchange pairing (CCB-S3-009)

Capture persists EVERY member message, including ones she treats as instructions, and then
records what kind it was (`member_category`). The order matters: persist runs before the
dialogue, so her reply has a row to point at via `reply_to_id`.

`message_publish_state` now derives both halves together. A member instruction publishes on the
consent rules unless its category is switched off; one of her replies publishes only if the
message it answers does. Nothing is stored as a flag, so a `/unpublish` removes the question and
the answer on the next read.

The public front marks the pairing explicitly with an "in reply" link rather than leaving a
reader to infer it from timestamps.

## 18. Help and consent copy (CCB-S3-010, CCB-S3-021)

The help reply (`src/interaction/help.ts`) is ONE editable template the machine fills (CCB-S3-021 §3,
D-066), not code-only prose. The operator edits the persona `help` field (per language, in the admin);
the code fills `{wake}`, `{label}`, `{consent}` (the three publishing properties, kept in code so they
cannot drift) and `{commands}` (the capability list, still generated from `activeIntentList()` so a
disabled plugin drops out and a new one appears). Blanking the field restores the shipped default
(`DEFAULT_HELP_TEMPLATE`); a non-blank template missing `{commands}` or `{consent}` is rejected on save
naming the missing one (`missingHelpPlaceholders`). `help <topic>` gives consent/prices detail. `/help`
is answered directly (a slash is an explicit address), and an instruction beginning with "help" is
forced to HELP because it otherwise loses to a PRICE reading. (Formatting: grouped blocks, one icon per
heading, plain command list, no em-dashes, single-delimiter markup only, from CCB-S3-021 §1-2 / D-061.)

The consent prompts, welcome message and help all state the three properties — forward-only,
public-until-revoked, revocation-final — in EN and DE. They are written to today's behaviour; a
later briefing that adds hide/delete will revise the finality wording.

The native SimpleX command menu was investigated (see `docs/wire-format.md` §3f): present in the
SDK, but a direct-conversation feature that does not apply to a group bot with no contact address.

## 19. Video-link cards (CCB-S3-014)

`src/media/video.ts` is a matcher registry: a matcher recognises a URL and yields id/start/canonical/
embed/thumbnail. Capture (`src/capture/video.ts`) records the provider/id/start/title on the message
and stores a thumbnail — preferring the base64 image SimpleX delivered, else a one-time server fetch
(`src/media/thumbnail.ts`) — as the message's own media, so it inherits the whole CCB-S3-011
strip/serve/consent machinery. Migration 016 adds the video columns and re-declares the public view.

The front renders a click-to-play card; a first-party handler writes the `youtube-nocookie` iframe
only on click, and the embed-page CSP widens `frame-src` only when a card is present
(`src/web/front/embed.ts`). SEO emits a `VideoObject` pointing at the canonical external URL with the
local thumbnail. Per-instance settings (`EmbedSettings.video`) toggle embedding, providers, and the
notice; off returns the link to plain-link rendering.

## 20. Interaction console — sub-sections (CCB-S3-015 Stage 1)

The Interaction page is split into ten URL-addressable sub-sections under `/interaction/<slug>`
(addressing, guards, follow-up, language, replies, nicknames, consent, voice, archiving,
diagnostics), with a sidebar submenu the same shape as Plugins. `/interaction` redirects to the
first section; each section saves independently and returns to its own page. Every setting lands in
exactly one section — proven by `verify:admin-views`, which edits through every section and asserts
the stored key set equals the full default (27 keys). The split also surfaced two settings that
existed but had no form: the interjection stop-list (`carryOverStopWords`, Follow-up) and the filler
prefixes (`fillerPrefixes`/`maxPrefixWords`/`maxPrefixChars`, Guards).

## 21. Background jobs — the durable queue (CCB-S3-022)

The foundation for categorisation and the media gallery, and the durable replacement for the ad-hoc
background work that failed invisibly all season. **Implemented (this briefing): the queue engine,
the worker, the placeholder analysis job, and the harness.** Its first real user is `deletion.apply`
(CCB-S3-023 follow-up): a failed in-group deletion enqueues a durable retry so member-deleted content
cannot be lost when the one-shot SDK event's `markDeleted` write fails. Planned next (same briefing, phase 2):
moving media-derivative generation and video-thumbnail fetching onto it, a backfill command, and the
admin observability page.

**Schema (`migrations/017_jobs.sql`).** One `jobs` table: `type`, `payload` (jsonb), `state`
(`queued`/`running`/`succeeded`/`dead`/`cancelled`), `lane` (`interactive`/`bulk`), `priority`,
`attempts`/`max_attempts`, `run_at` (next scheduled time), `idempotency_key`, `last_error`,
`locked_at`/`locked_by`, timestamps. A partial unique index on `(type, idempotency_key) WHERE state
IN ('queued','running')` gives idempotency; a partial claim index on `(lane, priority DESC, run_at,
id) WHERE state='queued'` keeps claiming cheap at any backlog depth.

**Claiming (`src/queue/store.ts`).** `UPDATE jobs SET state='running', … WHERE id = (SELECT id …
ORDER BY lane, priority DESC, run_at, id FOR UPDATE SKIP LOCKED LIMIT 1)`. `SKIP LOCKED` makes
concurrent claims safe (no double-run, no blocking); the `lane` enum sorts `interactive` before
`bulk`, so a member's reply is never delayed by a bulk backlog (measured: interactive claim latency
is flat, ~1ms, with 2000 bulk jobs queued). `type = ANY($types)` lets the worker exclude types at
their concurrency limit; a `bulkAllowed` flag pauses the bulk lane.

**Failure handling.** A transient failure requeues with bounded exponential backoff; the last
attempt, or a `PermanentJobError` (a file that is gone, an unusable payload), dead-letters
immediately — kept for the operator, never deleted, never retried forever. The permanent-vs-transient
distinction is reusable by CCB-S3-018 for expired file receipts.

**Worker (`src/queue/worker.ts`).** One worker in the shared process (bot + web + queue). In-memory
in-flight counts enforce exact per-type and global concurrency limits, so a backlog cannot exhaust
CPU/memory/DB connections and take the whole process down.

**Crash recovery (hardened after an adversarial review, D-062).** Four rules keep a slow or
interrupted job from being run twice, losing attempts, or being dead-lettered while healthy:
- *Ownership fence.* `completeJob`/`failJob` write only when the job is still `running` under the same
  worker and the same `attempts` value (the fence token). A run that was reclaimed and superseded by a
  fresh run finds no match, so a late "zombie" run can never flip a newer run's outcome.
- *The live worker is never its own orphan.* The periodic sweep excludes jobs the live worker still
  holds (`locked_by IS DISTINCT FROM $me`): if this alive process holds the lock the handler is slow,
  not crashed, so reclaiming it would double-run it. Startup uses the new process's id and so still
  reclaims everything the previous process left running.
- *Per-type orphan threshold.* How long a `running` lock may age before it counts as abandoned is set
  per type (`perTypeStuckMs`, fallback `defaultStuckMs`), because a fast image strip and a slow video
  transcription need very different patience. Values are floored to integer ms. This is also the
  stuck-job indicator's threshold.
- *A deploy is not a failure.* On an orderly shutdown the worker requeues its in-flight jobs and rolls
  back the claim's attempt increment, so a restart neither dead-letters a single-attempt job nor erodes
  a retry budget. A genuine hard crash does consume an attempt (poison-message protection), so a job
  that crashes the worker every time dead-letters after `max_attempts` crashes — the same total tries
  as one whose handler throws.

**Idempotency.** Enqueuing the same `(type, key)` while a live job exists returns that job rather than
creating a second. Handlers are required to be idempotent so a repeat run (crash, restart, manual
retry) produces the same result. Proven end to end in `verify:queue`.

## 22. Capture write-ahead log (CCB-S3-024)

SimpleX delivers each event ONCE and never re-sends it, so a capture handler that failed silently lost
that event forever. §1 of the briefing established the extent, before any change: an ordinary **new
message** and an **edit** were the two events lost on a handler failure with only a log line
(`capture/handler.ts` `persist()`); deletions became durable in CCB-S3-023; file-download receipts are
recorded but not retried (the 16 of CCB-S3-018); member/profile events are not subscribed by the
running bot. A production cross-reference of the SimpleX core DB against the archive found the
new-message/edit loss had not fired for ordinary member content (the 67 uncaptured messages were all
intentional pre-CCB-S3-009 command/instruction drops, none since Jul 23) — latent, like the deletion
finding before it.

**Implemented (Slice 1): the durable substrate.** `migrations/018_capture_events.sql` +
`src/capture/events/`. Wiring the dispatcher to record-then-process (Slice 2), retention pruning and
admin counts (Slice 3) are planned next in the same briefing.

**Schema (`migrations/018_capture_events.sql`).** One `capture_events` table: `kind`
(`new_message`/`edit`/`deletion`), `conversation_key` (the group id — the ordering domain),
`dedupe_key` (unique — the write-ahead itself is idempotent), `payload` (jsonb, enough to re-apply),
`state` (`pending`/`processed`/`deferred`/`dead`), `attempts`/`max_attempts`, `last_error`, timestamps.
`id` (bigserial) doubles as the replay order because rows are inserted in arrival order. A partial
index on `(id) WHERE state IN ('pending','deferred')` keeps the drain scan cheap as processed rows
accumulate.

**Record then process (`store.ts`).** `recordEvent` writes the raw event `pending` before it is applied
(idempotent on `dedupe_key`); `markEventProcessed` on success; `failEvent` keeps it `pending` to retry
and dead-letters on the last attempt; `deferEvent` holds an event whose target has not arrived;
`deadLetterEvent` fast-fails a permanently-unusable event. A dead capture event is a lost member event,
kept for the operator and surfaced apart from an ordinary job failure.

**Replay + ordering (`replay.ts`).** A per-kind reprocessor registry keeps this module free of the SDK
and persist layer; the same `processEvent` is used by the real-time path and the drain. The
`capture.drain` queue job (interactive lane) replays unfinished events in arrival order: a transient
FAILURE stalls only its conversation for the pass, so an edit can never be applied ahead of the insert
it depends on; a DEFERRED early deletion does not stall, so an out-of-order deletion waits and applies
once its message lands. Passes repeat while progress is made; a poison event dead-letters instead of
looping.

**Scope gate first (§3).** The CCB-S3-019 `isPublicGroupChat` whitelist runs BEFORE the write, so
support-scope and direct events never enter the store (wired in Slice 2, guarded by the harness).

Proven by `scripts/verify-capture-events.ts` (30 checks) against PGlite: idempotent write-ahead,
apply→processed, transient retry then dead-letter, permanent fast-fail, per-conversation ordering with
a stalled insert, out-of-order deletion defer, bounded defer, admin counts, retention pruning only
processed rows, and a real queue worker draining the backlog.

## 23. Stream polish: formatting, share, permalinks, attribution (CCB-S3-025)

**Chat text formatting (`src/web/front/render.ts` `renderBody`).** SimpleX parses a member's `*bold*`
etc. into `ChatItem.formattedText` runs, kept in `raw_json`. `published_messages` (migration 019)
derives a compact `formatted_text` (`{f,t}[]`) from `raw_json` on read — no column, no backfill, covers
history — and the front renders each run into a whitelisted tag (`strong`/`em`/`s`/`code`/`small`, plus
a CSS spoiler for `secret`), with the run text escaped by the `html` template. Member input never
reaches a tag/attribute. **Redaction-safe:** the view NULLs `formatted_text` whenever a bot message's
mention-redaction could apply (`m.is_bot AND r.pattern IS NOT NULL`), so runs can't bypass name
redaction; the renderer falls back to the redacted `text_body`. The poll hot path selects only
`id` + a marker, so the correlated derivation is pruned (not evaluated) there.

**Report control.** The pill uses a new theme-aware `--danger` token (`src/web/theme.ts`), soft at rest
(`--danger` at low alpha) and full-strength on hover — no more hardcoded `#dc2626`.

**Share bar (`src/web/share.ts`, `render.ts` `shareBar` + `COPY_SCRIPT`).** X/Facebook/Reddit/WhatsApp/
Telegram are plain links we build and open on click — no vendor widget/SDK, nothing third-party loads,
no cookie-banner entry (the marketing footer reuses the same module). Copy-link is a document-delegated
button (covers appended cards; the front is HTTPS so the async Clipboard API works, with an execCommand
fallback) that confirms in place. CSS-only reveal: hover-slide on desktop, permanent + in-flow on touch
/ narrow / operator-set-always, no slide under reduced motion. All under the existing strict CSP.

**Item permalinks (`embed.ts` `GET /embed/:id/m/:msgId`).** One published item on its own crawlable,
canonical page so a shared link resolves with correct OG. Consent-gated via `getPublishedItem` →
`published_messages`; an unpublished / recalled / deleted / no-consent / unknown / type-disabled id 404s
exactly like the media route. `itemSeoHead` sets an item-scoped canonical + OG (the item's own image
when it is one, else the instance default); per-item URLs are added to the instance sitemap
(`listPublishedItemRefs`, capped). Reuses `renderCards` for one item, so the card is identical to the
stream.

**Bot attribution (`render.ts` `whoBlock`; `EmbedSettings.attribution`).** Her cards link her
name + an editable label (`(SimpleX AI Bot)`) to the repo in a new tab (`rel="noopener noreferrer"`),
quiet until hover; blanking the label or url removes them. Chat-side (help reply) uses a new editable
`botLabel` + `projectUrl` (now defaulted to the repo); the display name is deliberately NOT renamed (the
`updateProfile`-only-on-avatar reconcile gate + unverified core handling of parens make it risky, and a
per-message suffix would be noise). See D-065.

## 24. The local AI subsystem (D-068, consolidated under CCB-S4-008)

**Provenance.** 23 commits, 2026-07-25 to 2026-07-27 (`b308201`..`e236ccf`), roughly 17,700 inserted
lines across 46 files, **none carrying a `Briefing:` trailer**. On `main` and deployed. See D-068.
This section was an inventory until CCB-S4-008, because the reasoning behind the design existed only
in the operator's parallel planning chats. That reasoning is now recorded: **D-111** (the fourteen
pre-implementation boundaries, marked clause by clause against the code), **D-112** (the consent
double gate), **D-113** (the private inference path). The register carries an umbrella row for the
block so it reads as explained rather than missing.

### 24.1 The shape: two model calls, both behind seams, neither able to act

The subsystem adds exactly **two** places where a model is consulted, and both return data rather
than performing anything.

**Intent classification** (`interaction/ollama-resolver.ts`) sits behind the existing
`IntentResolver` seam, so nothing that resolves an intent knows a model is involved. It sends a
static system prompt plus **the member's addressed message and nothing else**: no history, no
archive rows, no other member's text. The reply is forced through a JSON schema whose `intent` enum
is the **active** catalog, and it is parsed defensively before it is returned.

**Reply wording** (`interaction/ollama-reply.ts`) runs only after the dialogue engine has already
chosen the intent, done its database reads and decided what may happen. It can phrase a finished
result and nothing else: the module holds no database, tool or transport capability, which is
visible in its imports. Model output is cleaned before a member can read it, with code fences
stripped, em/en dashes and horizontal bars rewritten to `-` (the standing rule, D-061), and C0/C1
control characters removed because untrusted model output is on its way into a chat. `requiredLiterals`
must survive a free rewrite exactly, so counts and prices cannot drift, and `blockedLiterals` keeps
values such as a sender's display name out of generated text. Two modes: `free` rewrites the draft,
`locked` writes only a short lead and the application appends the deterministic text unchanged.

**The seam validates a second time, independently** (`interaction/resolver.ts`). `resolveIntent`
re-sanitises whatever the active resolver returned against the active catalog, clamps confidence
into 0..1, and treats an invented intent, an out-of-range confidence **or a thrown error** as
`UNKNOWN`. The catalog is therefore enforced where the result is consumed rather than trusted from
the implementation that produced it.

### 24.2 Fail-closed routing, and the two switches

`ai-runtime.ts` owns runtime control, per-role model routing, model discovery and telemetry. Two
independent switches decide whether a model is used at all: the **environment** says whether local
AI is available to the process (`LOCAL_AI_ENABLED`, default false), and a **persisted admin
setting** says whether this process uses it. `isEnabled()` requires both, and turning off either
calls `resetIntentResolver()`, which puts the deterministic rule engine back.

Routing is **fail-closed**: the selected models are verified against the endpoint's own inventory
before the active resolver is swapped, and a failed routing change is rolled back to the previous
persisted value rather than left half-applied. Every runtime and routing mutation is audited
(`writeAudit`, `local-ai.*`).

**Two lanes, measured separately.** Intent and reply carry their own metrics (requests, successes,
failures, fallbacks, latency, last error) and their own model selection, so a degradation in
phrasing is not read as a degradation in understanding. `guardOverrides` counts the times the
deterministic gate changed the model's answer, which makes the gate visible as a number rather than
only as a policy.

### 24.3 The consent gate

Consent intents are double-gated and the model may only ever corroborate: `PUBLISH`, `UNPUBLISH`
**and `RESTORE`** are accepted only when the rule resolver independently found the same intent, the
rules clear the ordinary threshold, and the model clears a floor of its own (0.9). A failed gate
cannot fall through to a different consent intent. Full reasoning and the three ways the code is
stricter than the original protocol are in **D-112**.

**The gate is one of four layers, and together they make the consent path injection-resistant by
construction** (D-116, CCB-S4-010). Beyond the conjunction: a third-party target is refused outright
with no action; a consent intent **writes nothing**, it sets a pending confirmation keyed to the
sender; and the write is keyed to `msg.senderMemberId` of the confirming message, so nothing the
model produced selects whose consent changes. The worst case of a successful injection is the bot
asking the sender about the sender's own consent.

**Which replies a model may phrase at all is an allowlist.** `AI_PERSONALIZED_KEYS` covers **9 of
the 36** persona keys; every consent confirmation, result, refusal, undo, destruction outcome and
restore is a deterministic string the member cannot influence. Of the nine, `priceAmbiguous` and
`status` are **locked**, meaning the model writes only an opening line and the deterministic text is
appended unchanged. `status` was moved there by the injection review because it reports a member's
own publication state and `requiredLiterals` protects tokens rather than meaning. Gated in
`verify:interaction` over real traffic.

**Free conversation is the one path where the model WRITES rather than rephrases**
(CCB-S4-027, D-131). It is reachable from a single place: the `UNKNOWN` case in the intent
dispatch, after every command intent has declined and after the addressing checks, which is
what makes it impossible for it to intercept a command. **It runs before the weak-signal
silence guard** (CCB-S4-028, D-132): a bare leading name in relaxed mode is an address but a
weak one, and running the guard first made relaxed mode mean nothing at all. The guard now
covers what its switch names, the not-understood FALLBACK, so a weak address gets a real
answer when the model can speak and silence when it cannot. There is no deterministic draft
because no command produced one, so the reply lane gains a named `conversation` mode rather
than being handed an empty one; every other guard in that file still applies, and a failed
model answers with its own honest string rather than telling the member they were unclear.
It has its own archive category, excluded by default, because it is the only category whose
words the application did not decide.

**This allowlist is why most OTHER replies look deterministic even when the model lane is
healthy** (CCB-S4-026, D-130). An operator whose conversation is greetings and consent
commands will correctly never see a model-worded reply, because none of those keys is in
the nine. Widening the set is a consent-safety decision, not a configuration.

**A successful wording is logged** since the same briefing, because it was not: only the
failure path spoke, so a working lane and a lane nothing called were both silence in the
journal, and the second was reported as a bug in the first. The line carries the reply
kind, the mode, the model and the latency, and deliberately carries neither the member's
message, nor the draft, nor what the model wrote. Measured live against the production
model endpoint: a free-mode rewrite in about 2 s, with both required literals intact and
the blocked sender name absent.

### 24.4 The environment contract, and what it enforces

`LOCAL_AI_ENABLED` (default false) · `LOCAL_AI_BASE_URL` (default loopback) · `LOCAL_AI_MODEL` ·
`LOCAL_AI_TIMEOUT_MS` (default 15000, clamped to 250..60000).

`normalizeLocalAiBaseUrl` in [`config.ts`](../src/config.ts) rejects at startup, with an actionable
`ConfigError`: a non-URL, a scheme other than http/https, embedded credentials, any path, query or
fragment, and **any host that is not loopback or private**. It returns `url.origin`, so only scheme,
host and port survive. This is a **client-side control**: it proves the application will not talk to
a public endpoint, and it cannot prove the inference server is not publicly exposed, which is host
and firewall state outside this repository. See D-113.

**The private endpoint shape**, described rather than configured here: the GPU host has no usable
public inbound address, so it **initiates** the tunnel to the VPS over the existing WireGuard
interface; the inference server binds to loopback with a restricted bridge onto the tunnel address
only; a watchdog restarts both unattended. No public AI port exists and no new inbound rule was
added. WireGuard is retired from the admin path (Addendum 3) and this is what it is still for.

### 24.5 Performance envelope

**These are M1 measurements on the operator's own hardware (an RTX-class desktop GPU) against
`qwen3.5:9b`. They are NOT reproducible from this repository**, which has no model, no GPU and no
tunnel, and every harness in the verification set fakes the transport. Treat them as a recorded
observation, not as a property of the code.

| Measure | Observed |
|---|---|
| Warm classification, live | roughly 0.9 to 1.5 s |
| Cold request, including model load | roughly 5.5 to 6.6 s |
| Concurrency | roughly 1.7 to 1.8 requests per second |

The operational consequence that matters is the cold figure: the first request after a model
unload costs seconds, so a timeout tuned to warm latency alone would turn every cold start into a
fallback. `LOCAL_AI_TIMEOUT_MS` defaults to 15000 for that reason.

### 24.6 Profiles, policy and onboarding (`src/profiles/`)

- `service.ts` — persistent profile, group and authority configuration, keyed on technical SimpleX
  identifiers. It explicitly **does not** connect to SimpleX, join a group, process invitation links,
  or execute remote commands.
- `runtime-policy.ts` — deterministic policy resolution for an incoming group message, mapping one
  SimpleX group and member identity onto a configured profile, group, role and privacy baseline.
  Outcomes are `allow` / `deny` / `unassigned`, with a `compatibility` source so an unconfigured
  deployment keeps working. It never executes a command, changes personality, joins a group, accepts
  an invitation, or calls an external provider.
- `bot-onboarding.ts` — persistent SimpleX bot onboarding configuration (desired `BotOptions`,
  address settings, workflow policy, safety controls) as an explicit state machine
  (`configured` → … → `ready` / `error`). It stores intent only; it **does not invoke the SDK**.

**`cloud_allowed` is a recorded flag with no consumer** (D-111 clause 12). It is computed,
constrained so `local_only` forces it false, and persisted, and nothing reads it to act on. There is
no cloud path in the subsystem to disable: every `fetch` targets the validated private `baseUrl`.
Safe today, and named here so it is treated as an unwired flag rather than as an enforcement point
that already works.

**Admin (`src/web/views/`).** `ai.ts` (2084 lines), `ai-profiles.ts`, `ai-onboarding.ts`, a global
mega navigation (`assets/admin-navigation.js`), the brand/effects layer (`admin-effects.js`), and the
setup, access-control and model-catalog clients. Five workspaces were subsequently redesigned:
access control, runtime control, models catalog, routing, hardware. Every one of these routes
inherits session auth, the global rate limit, the admin IP policy, CSRF on mutation and step-up
from **global hooks** rather than per-route middleware; see `security.md` §12.

### 24.7 Schema, verification, and what remains

**Schema.** `migrations/017_cinderella_profiles.sql`, `018_runtime_policy_decisions.sql`,
`019_bot_onboarding.sql` — three numbers that were **already taken** by the CCB-attributed Season 3
work. Not broken, but constrained; see **D-069** before touching any migration filename. New
migrations allocate from the highest number on disk plus one, which is a rule rather than a fixed
number because the fixed number went stale once already.

**Verification.** 19 `verify:*` harnesses (`ai`, `ai-runtime`, `ai-admin`, `ai-models`,
`ai-routing`, `ai-telemetry`, `ai-navigation`, `ai-profiles`, `ai-replies`, `ai-live`,
`bot-onboarding`, `runtime-policy`, `admin-navigation-shell`, `admin-mega-navigation`,
`admin-brand-fx`, `admin-setup-workflow`, and the extended `admin-views`). **Every one of them fakes
the transport**, so the subsystem's logic is proven without a model, a GPU or a tunnel; `ai-live` is
the exception that talks to a real endpoint and is not part of the standard set.

**Two of them were RED on `main` from 2026-07-28 and are fixed under CCB-S4-009** (D-115). Found by
running the full set at the close of CCB-S4-008, which did not cause them: it changed no file under
`src/` or `assets/`, and neither harness script changed either.

- `verify:admin-brand-fx` pinned one admin sentence to the plain spelling, guarding the rule that
  product identity is not inferred from an individual bot profile. `9d11bb0` implemented **D-088**,
  which stylises the product name everywhere it is displayed, the admin console included, and did not
  update the harness. **The operator ruled that D-088 governs**, so the assertion was inverted and
  broadened: no plain-spelling product reference survives anywhere in the admin chrome. The rule the
  original check cared about was not abandoned; the individual bot's name is `BOT_DISPLAY_NAME` in
  configuration, a different thing in a different file.
- `verify:admin-navigation-shell` asserted a `/website` link in the System sidebar. **D-089** moved
  the marketing site into its own repository and `3da6076` took the admin page with it, so the
  harness was stale against a recorded decision. Aligned to the three children the System root
  actually ships, plus a new assertion that the retired page has **not** returned.

**CCB-S4-008's diagnosis of the second one was wrong and is corrected here.** It reported that the
harness expected a `data-section="system"` attribute existing "nowhere in `src/web/`". That was a
literal grep against a template which **interpolates** the value (`data-section="${activeRoot.key}"`),
and the rendered page does carry it; the System root has always had key `system`. The single failing
conjunct was the `/website` link. Inspecting rendered output rather than grepping source, which is
what the standing rule asks for, is what found it.

**The instructive part is why nobody noticed for four days:** these harnesses arrived with the
unbriefed block, so they were in no completion report and in no routine, which is the register's
point about unattributed work made concrete.

**What remains after CCB-S4-008.** The reasoning is recorded (D-111 to D-113) and the security
questions the code can answer are answered (`security.md` §12). Still open: **prompt injection is
unreviewed** and is scoped to a successor briefing, and how this subsystem relates to the plugin
framework (§15) as the function count grows is still undecided.

## 25. Hide or delete on revocation, and evidence holds (CCB-S3-013)

Until this briefing a revocation set `consent.revoked_at`, the publish views stopped selecting that
member's messages, and **nothing was ever erased**. "Removed from the archive" meant "no longer
selected by the view". This adds the other half: the member chooses whether that state is permanent
retention out of sight, or actual destruction.

### The four states, and where each lives

| State | How it is expressed | Public? | Rows/media |
|---|---|---|---|
| opted in | `consent.revoked_at IS NULL` | yes | present |
| revoked, unanswered | `revoked_at` set, `revocation_mode = 'pending'` | **no** | present |
| hidden | `revoked_at` set, `revocation_mode = 'hide'` | **no** | present |
| deleted | the row is gone | n/a | erased |

**No view was redefined, and that is the design rather than an omission** (D-070). `revoked_at` already
unpublishes across all eleven public routes, so HIDE needed no new derived term; a second `hidden`
column would have re-created the stale-flag failure D-003 exists to prevent, and would have meant
rebuilding both explicit-column views. `revocation_mode` records the CHOICE and never gates publication.

**There is no default.** `recordOptOut` writes `revocation_mode = 'pending'` in the same statement that
sets `revoked_at` (`src/db/consent.ts`), so the interim between "she asked" and "they answered" is
hidden, durable across restarts, and authorises nothing. It could not live in the dialogue engine's
per-member state, which is in-process and would have republished the content on the next restart.

**Restore** (`restoreHidden`) clears `revoked_at` while keeping the ORIGINAL `opted_in_at`, because
publication is forward-only and `recordOptIn` would reset it and leave every hidden message behind. It
matches only `revocation_mode = 'hide'`, so destroyed content can never be resurrected and an
unanswered choice can never be pre-empted. Reached by the new **RESTORE** intent, first-person only.

### The asymmetric confirmation

`PendingConfirmation` gained a `kind` (`consent` | `revokeChoice` | `deleteConfirm`), so the acceptance
rule travels with the question that asked it (`src/interaction/state.ts`). In the engine's pending block
the **affirmation branch itself is conditional**: checking the kind after a generic `matchesList`
affirmation test would already have destroyed the content, since "yes", "ok", "sure" and "klar" are all
affirmations.

`matchesLiteral` is a deliberate sibling of `matchesList`, not a reuse of it. `matchesList` is fuzzy
(one edit at six characters, two at seven or more) and tolerates two extra tokens, which is right for
"yeah" and fatal for a destructive keyword: it would accept `delet`, `deleted`, `felete`, and
`yeah delete everything`. `matchesLiteral` requires a single token, compared for exact equality after
`fold()` normalisation. Folding is not fuzziness: it makes `lösche` and `loesche` the same word rather
than making near-misses acceptable. All five cases are asserted in the harness.

Both paths ask: `/unpublish` stays immediate (CCB-S3-002 §4.1) and then asks the same question through
`askRevokeChoiceAfterSlash`, so the slash and spoken paths cannot drift about what a revocation means.

### Destruction (`src/archive/destroy.ts`)

Row deleted FIRST, files unlinked afterwards, both inside one caller-supplied transaction. The order is
load-bearing (D-072): the hold trigger fires before a byte is unlinked, so a destruction that will be
refused cannot take the media with it; an unlink failure then throws and rolls the row deletion back.
The outcome is always everything or nothing, never half. ENOENT is success; `EACCES`/`EPERM` is a fault
that reaches `status.error` and blocks the row delete, because a permission error swallowed as "already
gone" would report a successful erasure over bytes still on disk.

The row deletion cascades to `links`, `message_mentions`, `reports` (including the reporter's free-text
note), `pending_destructions`, resolved `evidence_holds`, and, through `reply_to_id`, Cinderella's
paired answer. The generated `search` tsvector and its GIN entry go with the row, so **there is no
separate search index to purge**.

`filesOwnedBy` (`src/media/owned-files.ts`) combines the DB row with a filesystem sweep, because
neither is sufficient: the original is named `<simplexFileId>-<member filename>` and is findable only
through `messages.media_path`, while derivatives, video thumbnails and `.tmp` sidecars are id-named and
can exist with no column pointing at them (overwritten paths, bucket drift when `sent_at` changes,
extension drift, crashes mid-strip). The id match is exact on the filename stem, so message 9 never
matches `91.jpg`.

### Evidence holds

**A hold prevents destruction. It never prevents hiding.** A member may always make their content
non-public immediately, with no delay and no review; only physical erasure is deferred. This keeps
withdrawal genuinely effective and is the more defensible position: deferring erasure for a documented
purpose is a recognised exception, continuing to publish against a withdrawal is not.

Enforced by a `BEFORE DELETE` trigger on `messages` (D-072), not by application code, because
Cinderella already ships a script that issues a bare `DELETE FROM messages` against production. The
trigger also fires for CASCADE-removed rows, so a held reply blocks destruction of the question that
would cascade into it.

- **Only `illegal` creates a hold.** Spam, copyright and other never do: a spam report must not
  interfere with anyone's ability to delete their own data.
- **Never compounds.** A partial unique index allows at most one live hold per message, and the hold is
  placed only when `createReport` reports a genuinely new row, so re-reporting cannot extend the clock
  or stack a second hold. The clock runs from the first qualifying report.
- **Time-boxed**, default 30 days (`holdDays`), scheduled with `runAt = expires_at` on the durable
  queue. Evaluated on the Postgres clock, so a process that is down at expiry claims the job on the next
  poll rather than missing it. On expiry the hold lapses, `status.error` records that a review never
  happened, and any deferred deletion is enqueued.
- **Escalation and hash-match quarantine never expire** (`expires_at IS NULL`), and are released only by
  an explicit operator decision.
- **Abuse threshold** via a second, month-bucketed reporter token (D-071), failing toward accepting the
  report.

The report route stays a **non-oracle**: the hold is placed inside the existing neutral-confirmation
path, `placeEvidenceHold` never throws into the request, and the response is identical whether or not a
hold was placed. Anything that varied would turn the form into a probe for which items are held.

### How the two parts interact

The hide half runs immediately for everything; the delete half runs for unheld items and queues for
held ones; the member is told which is which; the queued deletion runs by itself on release or expiry.
The intent is recorded in `pending_destructions` and in the consent journal, so a dead-lettered job, a
cancelled job or a restart cannot lose it: **the member must not have to ask twice.** Each message is
destroyed in its own transaction, so one held item does not roll back the twenty beside it.

The member-facing deferral message says plainly that part is deferred and reveals nothing about who
reported the item or what the report said.

### Operator review (`src/web/views/holds.ts`)

Release / destroy / escalate, each audited with identifiers only. Two rules are enforced **twice**, in
the markup and in the handler, following the `group_deleted` precedent: destroy is never offered for a
hash match (destroying it would remove the evidence) and never for an escalation, and the routes refuse
both with 409 so a stale page or crafted POST cannot get past the missing button. Holds within seven
days of expiry are surfaced as a warning so a hold lapses by decision rather than by being forgotten.

### What adversarial review changed before release

A 54-agent review attacked the implementation before it shipped, with every finding independently
verified by a skeptic. Eight distinct defects survived refutation, all now fixed and regression-tested
(`scripts/verify-revocation.ts` §14-§15). Recording them because each one was invisible to the
implementation's own tests, which is the point:

1. **An escalated hold could be RELEASED.** The 409 guards covered `destroy` only; releasing moved the
   hold to `released`, which satisfies the trigger, and the release branch then enqueued the deferred
   destruction. Two operators and one stale tab would have destroyed exactly the evidence the
   escalation preserved. **An escalation is now terminal on this page** for every outcome.
2. **Restore republished what was said while hidden** (D-073).
3. **`chooseDelete` destroyed even when the choice was not its to make.** The `recorded` flag was
   computed and then ignored, so a member whose settled mode was `hide` could have their whole archive
   destroyed with `revocation_mode` still reading `hide` and no journal entry. It now returns early.
4. **Choosing hide did not withdraw a destruction already deferred by a hold.** A member who changed
   their mind was told their words were safe and restorable, and lost them when the hold lapsed.
   `chooseHide` now cancels pending destructions, unconditionally.
5. **A failed destruction was never retried.** `enqueueDestructionRun` existed with zero callers, so a
   transient failure left rows and media in place forever while the member had been told the deletion
   was in hand.
6. **Operator destroy resolved the hold on the pool, then destroyed in a separate transaction.** A
   failed destroy left the item both undestroyed and unprotected, with the hold reading
   "Released (destroy)". Both steps now share one transaction.
7. **RESTORE acted on a single fuzzy keyword with no confirmation**, and the AI resolver applied no
   rule corroboration to it. It now confirms like PUBLISH and is in `isConsentIntent`.
8. **A failed unlink wrote the member's own filename into `jobs.last_error`**, which nothing prunes,
   leaving the identifier the destruction was meant to erase sitting in the database. Only the errno is
   reported now.

**The sweeper** (`src/archive/sweeper.ts`) is the backstop findings 1, 5 and the cascade case exposed:
`expiredHolds` had no production caller, so a hold whose expiry job was never enqueued, cancelled or
dead-lettered stayed active forever; and a destruction blocked by a hold on a row it CASCADES into was
never re-queued, because release enqueues by the held row's id. It runs at boot and every fifteen
minutes, lapses overdue holds, and re-queues every pending destruction whose blocker is gone. It never
destroys anything itself.

### Quarantine is segregated outside the database (§4)

An ordinary **report hold** defers destruction and nothing else: publication is untouched and hiding
stays instant, because reporting must never become a way to unpublish someone. **Quarantine** is a
different thing wearing the same table, produced by a **CSAM hash match** or an operator
**escalation**, and its requirement is stronger: accessible to nobody in normal operation.

That cannot be delivered from the database alone. Withholding a row from the publish views stops the
public media route, which is derived from `published_messages`, but the admin console used to mount the
whole media tree with `@fastify/static` and serve any file by path. A quarantined item was undeletable
and still fully readable to any authenticated admin session. Three changes close it:

1. **The publish derivation withholds quarantined rows** (`migrations/022_quarantine_withholds.sql`).
   The clause sits outside the bot/member CASE, because a hash match on something Cinderella posted is
   exactly as unservable as one on a member's photograph.
2. **The bytes move** (`src/media/quarantine.ts`). Every file the message owns is relocated into
   `QUARANTINE_ROOT`, which lives outside `MEDIA_ROOT` and is served by nothing. The config loader
   **refuses to start** if the two are nested, because that would silently reduce quarantine to a
   rename. The move happens BEFORE the hold state changes, so a failure leaves the hold as it was and
   tells the operator, rather than marking an item escalated while its bytes are still being served.
   It is reversible, because a hash match can be a false positive.
3. **The static mount is gone**, replaced by `/media/msg/:id`
   (`src/web/views/admin-media.ts`), which resolves the path from the row and refuses anything
   quarantined with 403. Knowing a filename is no longer a way to fetch bytes.

Guards 2 and 3 are deliberately independent. The route refuses even if the move failed or never ran,
and the file is absent even if the route were bypassed. Either alone would be a single point of failure
for a rule this serious. `destroyMessage` sweeps **both roots**, so a false positive released with a
half-completed move back cannot leave bytes behind that nothing can find again.

`quarantineOnHashMatch` is the seam the screening track attaches to: written and tested with no
producer, so that when screening lands the ordering (files first, hold second) is already settled.

### What "deleted" honestly means

Removed from the live archive immediately, through every path this application serves. It does **not**
reach: backups (`deploy/backup.sh` keeps fourteen generations), the SimpleX core's own SQLite copy under
`state/`, content already fetched by RSS readers or social scrapers, or media files that never had a row.
The member-facing copy says removal plus backup expiry and deliberately avoids the word
"unrecoverable", which overwriting does not guarantee on modern storage.

## 26. Encryption at rest and hash screening (CCB-S3-012)

The child-safety track's storage and screening architecture. **No detection provider is connected**;
this is the foundation a provider becomes an adapter on.

### The constraint that shapes everything

The operator may not analyse suspect images: examining potential abuse material is itself legally
fraught, so the only permissible operation is automated comparison against hashes of KNOWN material. But
investigators need the unmodified file, so the correct response to a match is **preserve and report**,
not delete. Together those produce an unusual requirement: **the platform must retain material it is not
allowed to look at.** That is a custody problem, not a detection problem, and it is why the storage half
is larger than the screening half.

### Encryption at rest (`src/media/at-rest.ts`)

AES-256-GCM, key derived with scrypt from a dedicated `MEDIA_SECRET`. Envelope:
`CINDM1 | iv(12) | tag(16) | ciphertext`, 34 bytes of header.

**Every original is encrypted, not only suspect material** (D-075): a selectively-encrypted store would
disclose which files are under suspicion to anyone with a directory listing. The **stripped derivative
stays plaintext** because it is public by definition and is not the artefact under custody.

The five readers of an original all go through `readMediaFile`: the derivative producer
(`strip.ts`), the public media route, the admin media route, and the two audit scripts. Writers
(`storeMedia`, `captureVideoLink`) encrypt on the way in.

**Serving is where the subtlety is.** GCM ciphertext is exactly as long as its plaintext, so an
encrypted file is 34 bytes longer on disk. Byte-range video seeking computed from `stat().size` would be
wrong by the envelope on every request, so the routes use `mediaPlaintextSize`. Encrypted files are
decrypted into memory and sliced; plaintext files still stream. Buffering is the honest cost of
authenticated encryption: GCM authenticates whole files, and serving an unverified fragment would throw
away the integrity guarantee that makes custody meaningful.

**Mixed trees work.** The magic header lets readers handle encrypted and legacy plaintext files alike,
which is what makes `npm run encrypt-media` an incremental, idempotent, re-runnable backfill rather than
a flag day.

### The screening seam (`src/screening/`)

`HashScreeningProvider` mirrors the price-provider chain. Verdicts are `match | no-match | not-screened
| error`, where **`not-screened` is a first-class outcome**, not a failure code.

- **Null provider (the default)** forms no opinion, opens no socket, and never even decrypts the
  original: the `bytes()` callback is lazy precisely so that reading plaintext happens only when a
  configured provider has actually asked.
- **Fixture provider** compares SHA-256 against a local list, so the whole pipeline is exercised without
  real material. It is honest about itself: production screening uses perceptual hashing, and a
  cryptographic digest would not survive a re-encode. Its job is the plumbing, not detection.
- `setScreeningProvider` replaces an unconfigured provider with the null one, so "not configured" cannot
  become a code path that reaches a network client.

**Health is module-global**, unlike the price panel's per-instance map, which the admin page never sees
because it constructs a fresh service per request. The buffer is sized for receipt-rate traffic (400),
not price-lookup traffic (60), and records message id, provider, verdict and timing. **Never the hash**:
the hash identifies the content.

### Screening at receipt

Enqueued from `onFileReceived` immediately after the media is stored and BEFORE the derivative is
produced, on the interactive lane. Enqueued, not awaited: a member's message must never wait on a
provider, and a throw in the capture path would lose the event outright since the SDK delivers each
event exactly once. Screening is **independent of consent** because a file that is never published is
still a file the platform received and holds.

A provider error raises `status.error` and rethrows, so the queue retries. It never degrades to
`no-match`.

### Match handling (§4)

In order, and the order is the point: **quarantine first**, then preserve, then alert, then audit, then
stop.

Quarantine reuses CCB-S3-013 §4 wholesale: the bytes move to `QUARANTINE_ROOT` (still encrypted), the
row is withheld from publication by migration 022, the hold carries no expiry, and the `BEFORE DELETE`
trigger makes the item undeletable by member revocation, operator takedown, a reply cascade or raw SQL.
The alert carries the fact and the reference and **never renders, embeds, previews, thumbnails or
attaches the content**. The audit records the event, not the content.

**No derivative is ever produced for a quarantined item.** The gate sits in `stripAndRecord`, the single
funnel every producer goes through (capture, the boot check, the public heal path, the remediation
script), because a gate at any one caller would leave the others open. Screening is asynchronous, so a
match can land after capture already made a derivative; that case is covered because quarantining moves
every file the message owns, the derivative included.

**Nothing further happens in code.** No reporting workflow, no retention period, no point of contact, no
automated disclosure: those are legal questions for a lawyer.

### Honesty (§5)

The website claimed "every message and file passes through consent checks and CSAM screening before
anything ever goes live" while no screening code existed at all. Corrected to "in development" in
`locales/en.json`; the same keys are deleted from the other 39 locales so they fall back to the
corrected English rather than repeating a false claim in 39 languages. The admin console states the
limit plainly: hash matching detects known material only, and a no-match result is not a statement that
anything is safe. **The screening result is never shown to members.**

## 27. Erasing the core's own copy (CCB-S3-027)

Destruction used to stop at our own database. The SimpleX core keeps its own SQLite copy of every chat
item, and nothing ever deleted from it, so every "destroyed" message still existed on the host.

**What `internal` does**, established from the core sources at 6.5.4 before any of this was built:

| mode | store call | effect |
|---|---|---|
| `internal` | `deleteGroupChatItem` | `DELETE FROM chat_items` + raw `messages` + versions + reactions, and `deleteFilesLocally` removes the file from the files folder |
| `internalMark` | `markGroupChatItemDeleted` | `UPDATE chat_items SET item_deleted = ...`; content and files kept |
| `broadcast` | sends `XMsgDel` first | announces the deletion to every member |

Production confirmed the `internalMark` behaviour independently: the eleven rows already flagged
`item_deleted = 1` each still held 12 to 14 KB of content. **We use `internal`.**

**The flow.** `destroyMessage` reads the core's `(group_id, group_msg_id)` BEFORE deleting the archive
row (afterwards there is nothing to read them from), and enqueues `core.erase`. The job calls
`apiDeleteChatItems(..., Internal)` through a module-registered bot handle, retries on the interactive
lane with a raised attempt budget, and surfaces on every failed attempt: until it succeeds the erasure
is partial and the operator is told so.

**Quarantine is an explicit exception.** For an escalated or hash-matched item the core copy is
evidence, so no erasure is queued. The branch is named and commented at the decision point rather than
relying on the DB trigger refusing the delete first, because that ordering is exactly what a later
refactor would change.

**Receipt placeholders.** The core creates the destination file when a receipt starts and `storeMedia`
renames it away on success, so a zero-byte file named after the member's own device filename survives
every FAILED receipt. Production: 109 core file rows, 100 moved out, 9 left, and those 9 are precisely
the incomplete receipts. `sweepFileStubs` removes aged zero-byte files from the files folder on the
existing sweeper's schedule; a destroyed message's placeholder is already removed by the core deletion
itself. The age bound is well past the XFTP relay expiry so a live transfer is never interrupted.

**The consequence for the threat model.** Since CCB-S3-012 encrypted the originals, the core's database
is the only unencrypted copy of member content on the host. See `security.md` §11b.

## 28. The chat adapter seam (CCB-S3-020, Phase A)

Cinderella talked to `simplex-chat` throughout. That bound the product to AGPL, blocking a closed
commercial edition, and let SDK types spread into application code where a later swap would have to
undo them. `src/adapter/` is the seam; `src/bot/` is the SimpleX implementation of it.

**Layout.** `src/adapter/types.ts` (domain types), `chat-adapter.ts` (the interface), `fake.ts` (an
in-memory implementation with no SDK). `src/bot/` holds the SimpleX adapter, including `parse.ts`, which
is the SDK-to-domain translation that used to sit in `src/capture/message.ts`.

**The dependency was one field.** `CapturedMessage.raw` was `T.AChatItem`, and `CapturedMessage` flows
through capture, persist, consent and the interaction layer, so that single field made nearly the whole
application transitively SDK-typed. It is now `RawItem = unknown`: application code carries it and hands
it back, and only the adapter narrows it.

**Enforcement, not discipline.** `verify:adapter-seam` fails the harness if anything outside `src/bot/`
imports the SDK, and proves itself by synthesising a violation and asserting it is caught. This is the
durable part of the work: a refactor is a state, a check is a property.

**Interface surface.** Only operations with callers: start/stop, event subscription, send to
group/support/direct, receive file, get/update profile, list groups and members, erase our own copy.
Moderation, reactions and member contact are intended but have no caller, and are deferred rather than
guessed (Phase B).

**Contract.** `docs/adapter-contract.md` states what a compliant implementation must do, tagging each
clause `[neutral]` or `[SimpleX-shaped]` so a Matrix adapter author can see immediately which parts are
domain properties and which are SimpleX semantics leaking through. Its §9 records the known leak: the
opaque `RawItem` is stored in `messages.raw_json` and SQL reads inside it, in migration 019 (the public
front's `formatted_text`) and the support-scope diagnostic. That is scheduled for removal, not a
property a second protocol could honour, and Matrix on the roadmap makes it a prerequisite.

## 29. Two origins, two processes (CCB-S4-001, then D-089)

> **This section described "two origins, one process" until the site was split out.**
> The reasoning below is kept because the constraint that produced it has not changed
> (`PUBLIC_ORIGIN` still cannot move), but the topology has: the marketing site is a
> separate repository, a separate unit and a separate process on `127.0.0.1:8788`.
> See **D-089**, and `deploy/nginx-stream-splitter.conf` for the edge, which is now
> committed here rather than living only on the server.
>
> What this means for the paragraphs below: "one Fastify process serves both origins"
> is **no longer true**. The application still has no host-based routing, because it
> no longer needs any - each origin has its own process. The vhost allowlist survives
> as defence in depth rather than as the sole control.

### 29.1 The original reasoning (unchanged where it still applies)

The marketing site has its own domain. The console and the public archive did not move, and
could not: `PUBLIC_ORIGIN` derives the WebAuthn Relying Party ID, an RP ID is baked into
every credential at registration, and moving the origin would have invalidated every
registered passkey. So `SITE_ORIGIN` was **added** rather than `PUBLIC_ORIGIN` changed. It
is validated the same way and falls back to `PUBLIC_ORIGIN` when unset, so a deployment
that does not set it behaves exactly as before. See **D-080**.

`SITE_ORIGIN` feeds only the marketing site's absolute URLs: canonical, `hreflang`, Open
Graph, JSON-LD and `/sitemap-site.xml`.

**The application has no host-based routing** - and since D-089 it needs none. Each origin
has its own process: the console and archive front on `127.0.0.1:8787` from this
repository, the marketing site on `127.0.0.1:8788` from `cind3r3lla-site`. Until the split
a single process served both, and reading the application alone would have suggested the
console was reachable on the marketing domain; it was not, but only because of the vhost
allowlist. That division of labour was deliberate, and it was also the thing that made the
split worth doing.

At the edge (see **D-081**): public `:443` is an **SNI stream splitter** shared with
neighbouring services, mapping `$ssl_preread_server_name` to a backend and defaulting to
`127.0.0.1:4443` with `proxy_protocol` on, so every HTTPS vhost listens on loopback rather
than a public interface. The marketing vhost is an **allowlist** ending in
`location / { return 404; }` — a blocklist was rejected because it fails open, silently
exposing any admin route added later. Reserved hostnames need an explicit vhost, because
unknown names fall through to the default; the demo hostname therefore has a deliberate
`return 404` block, and the certificate already carries its SAN.

**This nginx configuration is now in the repository** (D-089), which closes the open item
this paragraph used to record. `deploy/nginx-stream-splitter.conf` is the shared SNI
splitter, and `deploy/nginx-admin.conf` carries the console vhost with the corrected
`listen 127.0.0.1:4443 ssl proxy_protocol` (it had said `listen 443 ssl`, which was stale
and would not have bound). The marketing vhost lives in the site repository's
`deploy/nginx-site.conf` and points at `:8788`. All copies are sanitised: the operator's
console hostname stays out of a public repository (CCB-S3-028).

## 30. The public demo (CCB-S4-001, Phase 1)

**Built:** the backend, the isolation guard, session handling, a seed script
(`npm run demo:seed`) and `verify:demo`. **Not built:** the visitor-facing pane, the four
guided prompts, the disclosure line and the mobile layout. The demo hostname answers 404 at
the edge, which is correct until the pane exists.

The security-relevant fact: `POST /demo/enter` mints an **ordinary admin session** for an
anonymous visitor, and `/demo/*` carries a blanket CSRF exemption. The same session
machinery that protects the real console is handed to strangers by design. That is safe only
if the process can never be a production process, so the isolation is two independent keys
that must agree — a `DEMO_INSTANCE` environment flag **and** a database marker row — checked
in `src/demo/guard.ts`. Every direction fails closed and logs: `env && !marked` is the
dangerous case (a process told it is the demo, pointed at a production database) and refuses
at error level; `!env && marked` refuses at warning level; a marker read that throws refuses.
The seed script will not mark a database that already holds real-looking content. See
**D-082**.

Usage is bounded per session (a message budget with an hourly reset) so the demo cannot be
used as free compute.

Note for the seam: the demo is currently the **only production consumer of `src/adapter/`**,
through `FakeChatAdapter`. Section 28's seam otherwise has no production caller.

## 31. The profile generator (CCB-S4-002, CCB-S4-003)

`src/generator/` holds the profile generator: standalone, deterministic, and **not wired
into the running bot**. Nothing in `src/` outside the module imports it, no migration
writes its output, and no admin page exposes it. It is built component by component against
its own briefings; two of them exist.

| Component | Location | Proven by |
|---|---|---|
| Shared RNG | [`generator/rng.ts`](../src/generator/rng.ts) | both harnesses |
| Name generator (CCB-S4-002) | [`generator/names/`](../src/generator/names/) | `verify:namegen` (42 checks) |
| Trait sampler (CCB-S4-003) | [`generator/traits/`](../src/generator/traits/) | `verify:traits` |
| Surface derivation (CCB-S4-005) | [`generator/surface/`](../src/generator/surface/) | `verify:surface` |
| Bio generator (CCB-S4-006) | [`generator/bio/`](../src/generator/bio/) | `verify:bio` |
| Assembly and review (CCB-S4-007) | [`generator/assemble/`](../src/generator/assemble/) | `verify:assemble` (22 checks) |
| Model bio path (D-104, D-109) | [`generator/bio/model.ts`](../src/generator/bio/model.ts), [`assemble/model-pass.ts`](../src/generator/assemble/model-pass.ts) | `verify:bio-model` (51 checks, transport faked) |

**Bio text has two engines, and the line between them is STRUCTURE versus LANGUAGE** (D-104).
Traits and surface derivation are mathematics; names are corpus statistics, where a model
would invent plausible-sounding names with wrong frequencies. Bios are language, and a read
of two hundred profiles found ten defect classes that every statistical check had passed,
every one of them a language defect. `engine: 'model'` is therefore the quality path and
`engine: 'template'` the availability fallback, deliberately small, plain and quiet.

The deterministic layer still decides **who the person is** and the model only phrases them:
whether a profile has a bio, how long, what theme, which language, how formal, how playful
are all fixed before `runModelPass` is called, and it changes exactly one field. Determinism
survives by caching, keyed on **seed + conditioning version + model identity**, so swapping
the model or editing a data set regenerates visibly rather than serving text written for a
different person. Failures are counted by reason and never absorbed.

**The model is asked only for the languages it writes correctly** (D-109). `ModelBioConfig.languages`
defaults to `['de', 'en']`, and `runModelPass` resolves each profile's language before it
builds the work list, so an out-of-scope profile is never counted as work the pass attempted.
Those profiles are emptied outright rather than written badly or left holding template text,
because a bio with a conjugation error is a tell no reader misses while an absent bio is
ordinary. This is a **measured limit of `qwen3.5:9b`, not a design one** (six of eighteen
non-German, non-English bios carried real grammatical errors), and the drop is counted per
language in `ModelPassReport.outOfScopeLanguage` so widening the list has a number attached
to it. Known gap: that count is not printed by `scripts/assemble.ts`, so a run that drops a
large share of its candidates still reports `0 failed`.

**The shared RNG is the spine.** SplitMix32 with FNV-1a stream folding, seeded per named
stream rather than globally. Every stage of every component derives its own stream from
`(seed, streamName)`, so stages are insertable and reorderable without changing what
previously-generated seeds produce. `Math.random` appears nowhere, and neither does a clock.
This lives one level above both components because they are siblings and neither should
depend on the other; `names/index.ts` re-exports `Rng` so its public surface is unchanged.

**The trait sampler** (CCB-S4-003, D-094/D-095) turns a seed plus a
configuration into six z-scores and an archetype label. The five Big Five dimensions plus
HEXACO Honesty-Humility, drawn as `mu + sigma * (L @ z)` where `L @ Lt` is the correlation
matrix from the briefing's §4.1 and `mu` is an archetype mean or the zero vector. 45% of
avatars fall into an unclassified background by default, because a population where everyone
is a clean archetype is itself detectable as artificial. `archetype` is `null` for those,
never a sentinel string.

Two properties are the point of it, and both are measured rather than asserted in prose:
the spread of pairwise distances is **1.18x** an independently-drawn baseline (independent
draws in six dimensions are nearly equidistant from one another, which is the failure the
component exists to prevent), and clustering recovers the archetypes at an adjusted mutual
information of **0.822**, inside the briefing's 0.2-to-0.9 band for "structure exists but is
not clean". See D-095 for the calibration table and for the one place those bounds already
conflict with the valid parameter range.

**Both components inject their data rather than reading it.** `loadCorpus` and
`loadArchetypes` are the only files that touch the filesystem, and nothing on a generation
path calls them. That is what makes "no filesystem at call time" structural.

**A note for whoever wires this into the runtime.** The build does **not** copy `data/`
and `fixtures/` JSON into `dist/`, so both loaders resolve against a path that does not
exist in a built tree. This has never mattered because both components are exercised through
`tsx` from source by their harnesses, and neither has a runtime caller. It becomes a real
defect on the day one does: either extend `scripts/copy-assets.mjs` or pass an explicit path.

**Surface derivation** (CCB-S4-005, D-099) turns the six z-scores into what everything
downstream reads. Its structure is the point: `deriveStyle` takes **no random source**, so
identical latent vectors provably produce identical style, and `drawIdentity` takes **no
latent vector**, so origin, age and gender cannot be derived from personality. Style fields
are weighted sums of latent traits mapped through the normal CDF to a 0-100 percentile,
using the **analytic** population standard deviation from `populationMoments` rather than an
empirical one, so the transform never depends on how many avatars happened to be drawn. The
loadings are versioned data (`loadings-2026-07-31b`), and the collinearity diagnostic caught
them correlating two fields at 0.983 on its first run.

**The bio generator** (CCB-S4-006, D-102) produces the short text a profile carries. Its
governing requirement is that **most profiles have none**: 66.7 percent empty against a 68
percent target, skewed by activity tier and conscientiousness, because a population where
every profile carries a bio is detectable on sight. Structural variety comes from six
mechanisms rather than a skeleton list, giving 279 distinct patterns with the most common
at 4.6 percent. Language follows `originBlend`; English and German are authored and the
39.9 percent falling back to English is counted and printed rather than hidden.

**Assembly and review** (CCB-S4-007, D-103) brings the four components together and makes
the result readable. `npm run assemble -- --count 200 --seed 42 --out ./review` writes
three views: a traced **detail** view, a **crowd** view rendered as a member list rather
than a table of fields, and a **distribution** view whose caveat sits at the top because it
is the view that would pass while the text is wrong. Plus a review record pre-filled with
the population seed and all four component data set versions. It generates nothing; a
missing property is a gap in a component. **Its first run found one**: `crispin sinclair`,
drawn for culture `de`, writing a German bio under an English name, which is the name
generator's documented fixture-corpus gap made visible for the first time by rendering
names beside bios.

**A constraint on this module's FUTURE creation path, recorded before it is built.** The
generator will eventually create SimpleX profiles. If it calls `apiCreateActiveUser`
directly it will produce profiles that **cannot receive media**, because the SDK's
`mkBotProfile` mutates the profile it is given to set `peerType = Bot` and force
`preferences.files`, and nothing raises when that is skipped: the failure surfaces only
when someone posts a picture into a room full of generated avatars. Use
[`botProfileFor`](../src/bot/runtime/core.ts) (architecture §32) or reproduce it exactly.
Neither CCB-S4-002 nor CCB-S4-003 is affected, because neither creates anything.

**Not built:** the model-backed text path, the
population layer, the validation layer, bios, avatars, and persistence of any of it. See
D-082 for why the schema still stores only `{ personalityId, seed, configVersion }` and
writes nothing.

## 32. The multi-profile runtime (CCB-S4-004, D-096), hosting EVERY enabled bot (CCB-S5-001, D-155)

**Half two landed under CCB-S5-001: every enabled bot is hosted.** `src/index.ts` calls
[`startRuntimeHost`](../src/bot/runtime/host.ts), which reads
`cinderella_bot_profiles WHERE enabled = TRUE` and hosts all of them on one core. The
pre-runtime `bot.run` path and its `BOT_RUNTIME_HOSTING` rollback lever are **gone**, as
D-125 said they would be: that path cannot host a second profile, so keeping the switch
would have been a configuration that silently reduced the deployment to one bot.
`startBot` in [`client.ts`](../src/bot/client.ts) still exists because `npm run connect`
uses it; nothing boots through it.

Each hosted bot gets **its own** `RoutedEventSource`, `FileReceiver`, interaction engine,
consent handler and capture registration. Sharing any of them would undo the router: one
bot's messages would reach another bot's engine and be answered in the wrong character,
with the wrong laws and against the wrong reply budget. See §32.3.

**CCB-S4-021 hosted exactly one, deliberately**, and the reason was isolation: if putting
the runtime under the bot changed how the bot behaved, that had to show up with one
profile where it was attributable. It did not, which is what made half two a wiring change
rather than a rewrite.

`src/bot/runtime/` hosts many SimpleX profiles on one in-process core: one
`ChatApi.init()`, one `startChat()`, every enabled profile subscribed simultaneously, no
profile rotation. It sits under `src/bot/` because that is the only directory
`verify:adapter-seam` permits the SDK in, and because D-085 recorded that this runtime is
not to be built against the adapter seam as it stands. `src/adapter/` is untouched.

| File | Role | SDK |
|---|---|---|
| [`core.ts`](../src/bot/runtime/core.ts) | Lifecycle, subscription, readiness gate, the two SDK workarounds | yes |
| [`host.ts`](../src/bot/runtime/host.ts) | **The caller**: boots one bot, reproduces what `bot.run` did for us | yes |
| [`scheduler.ts`](../src/bot/runtime/scheduler.ts) | Serializes active-user-dependent command **issuing** | no |
| [`router.ts`](../src/bot/runtime/router.ts) | One subscriber per event tag, fan-out by receiving `userId` | no |
| [`state.ts`](../src/bot/runtime/state.ts) | Six-state machine, injected clock | no |
| [`profiles.ts`](../src/bot/runtime/profiles.ts) | Spec-to-user resolution and the guarded bot profile | no |
| [`events.ts`](../src/bot/runtime/events.ts) | Presents the SDK's `on(tag, handler)` shape, fed from the router | no |
| [`gate.ts`](../src/bot/runtime/gate.ts) | Nothing sends before readiness | no |
| [`errors.ts`](../src/bot/runtime/errors.ts) | The two-class benign-noise allowlist | no |
| [`types.ts`](../src/bot/runtime/types.ts) | Domain types and the narrow core contract | no |
| [`faces.ts`](../src/bot/runtime/faces.ts) | Which face each bot wears, and which are faults (§32.6) | no |

**Nine of eleven files import no SDK**, which is what lets `verify:multi-profile` and
`verify:runtime-host` drive the runtime and the whole wiring against in-process doubles
with no Haskell core. `verify:runtime-host` asserts that property directly, because
`verify:adapter-seam` cannot: it permits the SDK anywhere under `src/bot/`, which is all
of these.

### 32.1 How a bot is hosted (CCB-S4-021, generalised CCB-S5-001)

`startRuntimeBot` reproduces the five things `bot.run` was doing silently, and changes one
thing deliberately.

| What | Where it went |
|---|---|
| Resolve the user (active-user-else-create) | `adopt: 'activeUser'` in [`profiles.ts`](../src/bot/runtime/profiles.ts). **Never a display-name match**: group membership belongs to the SimpleX user, so matching by name would hand an operator who edited `BOT_DISPLAY_NAME` a new profile in no groups, on a boot that logged success |
| Mark the profile as a bot | `botProfileFor`: `peerType = Bot`, `preferences.files` allowed. Without it the profile silently cannot receive media |
| Update the stored profile (the avatar) | `applyProfileUpdate` in `host.ts`, gated on an avatar file actually loading, exactly as the old `updateProfile: image !== undefined` was. **Per bot since CCB-S5-007**, decided by [`faces.ts`](../src/bot/runtime/faces.ts) (§32.6) |
| `startChat()` | `MultiProfileRuntime.start()`, which then says `subscribing` rather than pretending to be ready |
| Configure the files folder | `configureFilesFolder`, exported from `client.ts` and called by the host |
| **CHANGED: nothing sends before readiness** | [`gate.ts`](../src/bot/runtime/gate.ts). Receiving attaches immediately, so a message arriving during the warm-up is still captured; only the answer waits |

Capture does not subscribe to the SDK any more. It subscribes to
[`RoutedEventSource`](../src/bot/runtime/events.ts), which presents the same
`on(tag, handler)` shape and is fed from the router, so each profile's handlers see only
that profile's events. `registerCapture` takes a `CaptureHost` (an event source and a file
receiver) rather than a whole `BotHandle`; `BotHandle` still satisfies it, so the
pre-runtime path and both harnesses that fake it are untouched. `verify:runtime-host`
proves the two paths produce identical hook calls in identical order.

**Measured against a live core** (two cores, one real group, CCB-S4-021 Stage 2): on a warm
database `start()` resolved in **44 ms** and readiness came **10.3 s later**; on a fresh one,
1.9 s and 13.8 s. Both reached ready on a **quiet period**, never the ceiling. That gap is
the whole reason for the gate, measured from a second direction than D-085's.

**Readiness rests on two event types, not ten.** `SUBSCRIPTION_EVENT_TAGS` lists ten, but
seven of them (`contactSubSummary`, `memberSubSummary`, `userContactSubSummary`,
`pendingSubSummary`, `groupSubscribed`, `rcvFileSubscribed`, `sndFileSubscribed`) **do not
exist in the 6.5.4 event union at all**; checked, not assumed. What actually feeds the quiet
detector is `subscriptionStatus`, `hostConnected` and `contactConnected`. On a small core the
last subscription event lands within a second or two, so the wait is dominated by the 10 s
quiet constant rather than by subscription work: a restart leaves the bot receiving but
mute for about ten seconds. The constants are compile-time (`state.ts`) and nothing has
measured a better value, so they were not changed here.

**The scheduler is the load-bearing part.** Every command that does not take an explicit
`userId` executes as whatever profile is currently active, and making a profile active is
itself a command, so "become A, then send" has a gap. A concurrent "become B" landing in
that gap makes the first send execute as B, and **the core raises nothing**, because a
legal command was issued by a genuinely active profile. There is no serialization anywhere
in the SDK to fall back on: `sendChatCmd` is a bare pass-through to the native addon. The
scheduler serializes the *issuing* and not the waiting, so many operations are still in
flight at once; a grouped workload pays 3 switches for 9 commands rather than 9.

**`bot.run()` is reimplemented rather than called N times.** It calls `process.exit()` on
three internal paths with no thrown error, its user resolution cannot select a named
profile out of a populated database, and it calls `startChat()` itself. The one thing that
must survive the reimplementation is `mkBotProfile`'s mutation: it forces
`preferences.files` and sets `peerType = Bot`, so a bare `apiCreateActiveUser` creates
profiles that are not marked as bots and **do not allow file transfer**, silently breaking
media capture with nothing raised until the first image arrives.
[`botProfileFor`](../src/bot/runtime/core.ts) reproduces it deliberately.

**Two SDK defects are worked around in `core.ts`**, both verified present in the installed
6.5.4. `apiChatItemReaction` checks the response against `chatItemsDeleted` although
`/_reaction` answers `chatItemReaction` in both directions, so add and remove **both throw
although the operation succeeded**; the thrown error carries the successful response on
`.response` while `.chatError` is `undefined`, which is what makes it expensive to
diagnose (upstream PR #7109, open). And `apiSendMessages` discards the `user` the
underlying response carries, so sends are issued as raw commands to keep `r.user.userId`
and verify attribution at the send site.

**Registry:** `cinderella_bot_registry` (migration 023) carries the actor type, automation
mode, avatar source, disclosure label, operator reference and the three-part personality
reference. `simplex_user_id` is the first SimpleX user id anywhere in this schema. Half of
the §14 safety invariants are CHECK constraints; the half containing the word *silently*
is application logic in [`bot-registry.ts`](../src/profiles/bot-registry.ts), which audits
every transition and refuses the two §14 forbids.

**Each bot captures its own groups, and two bots in ONE group is reported (CCB-S5-001).**
The concern D-096 recorded is real and unchanged: under D-083 a conversation carries N group
ids across N participating profiles, and `UNIQUE (group_id, group_msg_id)` permits all N rows,
so two bots in one group store two copies of every message with two consent derivations. What
changed is that this is now DETECTED and raised to the admin dashboard by name rather than left
as a reason not to host a second bot. It is not refused: refusing would make a bot go deaf in a
group the operator deliberately put it in, and the condition is fixed by removing one of them. A
bot per group is the supported arrangement.

Detection cannot use the group id, because the core gives two profiles in one real group two
DIFFERENT ids (see §32.4). It uses `groupKeys.publicGroupId`, falling back to the join link, and
groups for which the core reports neither are listed as UNCHECKED rather than passed over -
silence there would read as "checked, none found".

**`/_start` subscribes EVERY user in a shared database, not only the active one.**
Verified, and it is the assumption the whole design rests on, so the evidence is recorded
rather than referenced. Measured: 200 profiles in one database, 27 joined to one group,
**one** `startChat()` and no per-profile activation, the active user then deliberately
moved to a profile that is not in the group, one message sent. **26 of 26 other profiles
received, each carrying its own `userId`, zero duplicates** (first at 153 ms, last at
1771 ms). Had `/_start` subscribed only the active user, none of the 26 would have
received anything. Independently, the core's startup path loads all profiles with
`getUsers` and calls `subscribeUsers False users` over the full list; the active user id
is passed additionally and prioritises rather than filters, and pending file transfers
resume for all profiles. `apiSetActiveUser` changes the stored active user and
`currentUser` only, and starts or stops no subscription. A profile that is both a member
and the active user receives normally: no preference, no penalty.

This is also why no profile-rotation design exists here. It was made unnecessary by this
finding and deleted rather than shipped.

**Untested against a live core**, and listed rather than implied: the *timing* of the
measurements above (153 ms / 1771 ms), as distinct from the behaviour they demonstrate;
that the 10 s quiet period and 120 s ceiling are the right constants; that a live core
misroutes without the scheduler (the harness reproduces the mechanism, not the core);
`degraded` in any form; and whether `fileId` is unique across users in one core database.

### 32.2 The admin console's hand on the runtime (CCB-S4-022, D-126)

The onboarding wizard describes a four-step SimpleX journey (address, contact, group,
role) and, until CCB-S4-022, performed none of it: the page reached `configured`, said
"Create the SimpleX contact address", and there was no control behind it. **Step one is
now real.** The other three are still descriptions and the capability inventory says so.

[`admin-actions.ts`](../src/bot/runtime/admin-actions.ts) is the seam. It holds a
late-bound handle to the running bot, registered by `src/index.ts` after
`startRuntimeBot`, for the same reason `core-delete.ts` does: `runApp` starts the admin
server BEFORE the bot, so the console is up and can show a failure when the bot fails to
start, which means there is no runtime to hand the views when they are registered.

The web layer gets **operations returning plain data, never the `ChatApi`**. A request
handler holding a chat handle is one import away from issuing an unscheduled command.

| Step | Route | What it does |
|---|---|---|
| Create address | `POST /ai/onboarding` `action=create-address` | `apiGetUserAddress` first, `apiCreateUserAddress` only if there is nothing there, both through the scheduler, both carrying an explicit `userId` so neither can execute as another profile |
| Accept contact | `action=accept-contact` | `apiAcceptContactRequest(contactReqId)`, which takes **no** user id and therefore genuinely needs the scheduler (D-127) |
| Reject contact | `action=reject-contact` | `apiRejectContactRequest`. The sender is not notified; the page says so before the operator presses it |
| Join group | `action=join-group` | `apiJoinGroup(groupId)`, which also takes **no** user id and so also goes through the scheduler. Returns `GroupInfo`; the role recorded is `membership.memberRole` |
| Set role | not built | its own briefing |

**Step two adds an inbound half** (CCB-S4-023, D-127). A contact request arrives on its
own, so `receivedContactRequest` joins `ROUTED_TAGS` and
[`contact-requests.ts`](../src/profiles/contact-requests.ts) records it and moves the
workflow to `contact_request_pending` **in the listener**, not in a view: a workflow that
only advanced while somebody had the page open would not be a workflow. Requests are
rows, not columns, because a public address can be used by anyone who has it and more
than one can be outstanding; the row is keyed unique on the core's own
`contactRequestId`, so a reconnect does not produce a second one.

**Accepting is not connecting.** The accept returns a contact; the contact comes up
afterwards, and the operator's own app shows "connecting" in between. The row carries
`contact_id` from the accept and `connected_at` from the later `contactConnected` event,
and the page renders *connecting* until the second lands. Measured live: accepted at
15:04:06.275, connected 657 ms later.

**Step three repeats both shapes** (CCB-S4-025, D-129). `receivedGroupInvitation` and
`userJoinedGroup` join `ROUTED_TAGS`;
[`group-invitations.ts`](../src/profiles/group-invitations.ts) records the arrival and the
console offers the join. Joining is likewise not membership: `joined_role` comes from the
join's answer and `joined_at` from the later event, 902 ms apart when measured.

**Three roles, never collapsed.** `invited_as_role` (what the invitation offered),
`joined_role` (what the bot holds, from `membership.memberRole`) and the profile's
`expectedGroupRole` (what the operator wants) are three columns, three sentences on the
page, and one audit field that says `roleVerified: false`. Joining proves the second and
says nothing about the third; checking them against each other is step four.

**The order is the honesty rule.** The SDK call happens first and the database write
happens with its result in hand: `recordContactAddress` takes a non-optional link, and
writes the link and `workflow_state = 'waiting_contact_request'` in one statement. There
is no path that advances the state on an intention, which is precisely how this step came
to be described and never performed.

**The link is stored with the SimpleX user it was created on** (migration 024, three
columns under one CHECK). A bare contact string cannot be checked against anything; with
the user id beside it, an operator can see whether it belongs to the bot the runtime is
actually hosting. The page names the hosted profile before the action and the created-on
id after it.

**Every step acts on the bot the operator selected (CCB-S5-007).** Until then each action took an
**optional** `botProfileId` and `pick()` fell back to `host.primary` when it was absent, and the
console passed it to none of them. So the database write was per bot and the SimpleX call was
not: accepting a contact for bot B recorded it against B and accepted it as A, **on A's real
profile**. Three of the four steps had no guard at all; the fourth, create-address, refused unless
the record was the one marked `selected_for_runtime`, which masked the problem there and made
onboarding a second bot impossible.

The id is **required** now, so a step that does not name a bot does not compile, which is stronger
than a runtime check and is what found all four call sites. The primary guard is gone: being the
primary was never the question, being hosted is, and `requireReadyBot` answers that. The page
reads `hostedIdentity(selected.id)` rather than the primary's, and the bot list says Onboarded or
Not onboarded. Onboarding **state** was already per bot and does not merge: `workflow_state` and
the contact-address columns are on `cinderella_bot_profiles`, and both the contact-request and
group-invitation tables carry `bot_profile_id`. `npm run verify:onboarding-per-bot` drives each
step for one of two hosted bots with the other as a positive control, proves an unhosted id raises
rather than falling back, and scans the source so a later optional parameter cannot restore the
defect quietly.

**Measured live** (CCB-S4-022 Stage 2, real core, browser): first press created a real
address on an `smp*.simplex.im` relay and the page moved to the Contact step showing the
link and "waiting for a contact request"; second press took the `apiGetUserAddress` path,
returned the identical link, kept the original timestamp and raised nothing.

**Creating a bot is not a decision about the primary (CCB-S5-008, D-162).** `selected_for_runtime`
means the primary and nothing more (D-155), and until this briefing the create/edit wizard still
carried it as a toggle called "Primary runtime bot", defaulted **on**. Creating a second bot
therefore required answering a hosting question that no longer exists, in the affirmative, on a
bot that must not hold the flag, and the unique index from 019 then refused the creation. The
operator reported that he could not follow the workflow, and the workflow was what was wrong.

`BotOnboardingInput` no longer carries the field, so nothing in `src/` can ask for it, and the
value is decided in the INSERT: `NOT EXISTS (SELECT 1 ... WHERE selected_for_runtime = TRUE)`.
The first bot is the primary because there is nothing else to be it; every one after is not; the
statement can never violate the index because it only writes TRUE into an empty seat; and
deleting the primary leaves a seat the next creation takes, rather than a deployment with no
default and no way to get one. `updateBotOnboardingProfile` no longer writes the column either,
for the same reason it does not write the personality columns: the dialog does not show it.

Moving it was `setPrimaryBot`, its own action and its own button. **That whole mechanism is gone
under CCB-S5-019 (D-173)**, along with `verify:primary-bot`, so the two paragraphs above are the
record of what CCB-S5-008 fixed rather than a description of the code. What survives is the
INSERT: creation still computes the column so it stays coherent for the migration that drops it,
and nothing reads what it decided. See **32.7**.


**A new bot arrives knowing its own name (CCB-S5-009, D-163).** Two identity facts were set
invisibly at creation and the operator stopped on both.

The **wake word** is now a field on the create form, pre-filled from the display name by
`admin-setup-wizard.js` as the operator types and overtyped the moment they touch it, so the
derivation stays the default and stops being the decision (a bot shown as SANCH3Z should answer
to Sanchez, and nothing in code can know that). It is REQUIRED: `BotCreationInput` carries it,
creation refuses without a usable one, and no half-made bot is left behind because the check
runs before the INSERT. Normalization is `normalizeWakeWord` in `interaction/settings.ts`, used
by **both** the settings page and creation. That fixed a live defect: the two used to disagree
about long names, creation REJECTING over 40 characters and therefore writing no override at
all, so a bot with a long display name inherited the shared wake word and answered to
"Cinderella" - the exact defect CCB-S5-006 exists to prevent, through the door CCB-S5-006 built.
A wake word already in use is refused **by name**, matched case-insensitively because
`detectAddress` matches that way; the shared value counts as taken by whichever bots are on it,
but is free while no bot is, so a first bot may take it and inherit later edits.

The **retorts** are seeded per bot at creation from `NEW_BOT_RETORTS`. Absence means inherit,
and inheriting meant a new bot answering nicknames with her mythology; see D-163 for why plain
starter text is the right shape rather than a compromise. `handleNickname` no longer swallows
the moderation ladder when a list is empty: the warning is protected text and is sent on its
own, which closes a CCB-S3-023 violation where a degraded function ran silently.

`src/profiles/bot-identity.ts` is the pure model behind the console's Identity panel: the name
it answers to and whether that is its own, the retort count and which of the three states
(own / inherited / none) it is in, whether it has a face, whether it is onboarded. Four facts on
the page the operator lands on after creating, rather than four pages. `verify:new-bot-identity`
covers all of it and is mutation-proven, including that creation cannot produce a bot without a
usable wake word.

**The create form could not be completed at all (CCB-S5-010, D-164).** Three faults on one
form, found by an operator pressing a button six times. All three required fields live on step
one and the wizard sets `hidden` on the steps it is not showing, so pressing Finish from a later
step made native validation block the submit, try to focus the empty internal key, find it in a
hidden subtree and **give up**: no bubble, no message, no request, and one console line nobody
has open. `revealAndReport` in `admin-setup-wizard.js` now finds the first invalid control, puts
its step on screen and only then calls `reportValidity`, wired to Next (so a problem surfaces
where it lives) and to Finish (for every route that did not pass a Next). The slug is derived
from the display name through the same dirty-flag mechanism as the wake word, so the empty case
is not normally reached; it was never derived before, contrary to what the shape of the form
suggested. And the slug's `pattern` had never compiled: browsers use regex `v` mode, where the
unescaped `-` in `[a-z0-9-]` is a syntax error, so the constraint was dropped and an input
holding `NOT a slug!!` reported itself valid. `verify:bot-creation-form` compiles every pattern
the console serves rather than pinning the one that was wrong.

**Who may adopt the existing SimpleX identity (CCB-S5-012, D-165).** Adoption takes over the
profile the core already has, with its groups and members, and cannot be undone from the
console. The rule was "the first unbound bot adopts" while the comment above it claimed "only
the primary", which the code never checked. Production had one bound bot and one new one, so
the new bot resolved onto the first bot's profile and the CCB-S5-001 duplicate guard refused
the entire boot. The rule is now **adopt only when nothing is bound at all**, asked of the
WHOLE table rather than the enabled set, because a paused bot still owns its identity. It names
no primary: whether the existing identity is spoken for is a question the data answers, and
this was the flag's last functional consumer. `verify:adoption` covers it, including the
paused-bot case and a mutation reproducing the failed boot.

### 32.3 One graph per bot (CCB-S5-001, D-155)

`startRuntimeHost` returns a `HostedBot` per enabled bot, and `buildBotGraph` in
[`index.ts`](../src/index.ts) builds everything conversational per bot on top of it. What is
shared and what is not:

| Per bot | Shared across the deployment |
|---|---|
| `RoutedEventSource`, `FileReceiver` | the SimpleX core and its scheduler |
| interaction engine, so the conversation state, follow-up windows and reply budgets | the market-data and web-search services |
| consent handler and capture registration | the plugin registry and the settings services |
| personality, laws, moderation ladders | the rule REGISTRY (the laws themselves) |

The engine holds the follow-up windows and the reply budgets, so two bots sharing one would
let a member's reply to bot A open a window on bot B, and would spend one budget across two
groups. `verify:multi-bot` asserts that separately.

**Which bot config is which SimpleX profile** is `cinderella_bot_profiles.simplex_user_id`
(migration 044). Before it there was no join at all between the table holding the character and
the table holding the SimpleX id, which nothing noticed while one bot ran because the answer was
always the single primary row. The primary is hosted first and is the only bot allowed to adopt
the core's active user; every other unbound bot gets a new profile, and the id is written back
immediately or the next boot creates another one.

### 32.4 Which bot owns which group (CCB-S5-001, D-155)

Read out of the shipped core database rather than assumed: `groups.group_id` is
`INTEGER PRIMARY KEY` over the whole file, not per user, with `user_id` beside it and
uniqueness on `(user_id, group_profile_id)`. Three consequences:

1. **Group ids cannot collide across bots**, so `UNIQUE (group_id, group_msg_id)` on `messages`
   stays sound with any number of bots hosted.
2. **A group id maps to exactly one profile**, so the owning bot is DERIVABLE. That is what let
   the consent-erasure path stay keyed on `(group_id, item_id)` with no bot column on the archive.
3. **Two profiles in one real group hold two different ids**, which is why co-tenancy is detected
   from the shared group identity instead.

[`ownership.ts`](../src/bot/runtime/ownership.ts) is the index, refreshed once the core has
settled. `runtime.runForGroup` is the seam every group-addressed command that takes no explicit
user id must go through, and it THROWS on an unknown owner rather than falling back to the active
profile. `contacts.contact_id` is global on the same terms, so direct chats use the same index,
filled lazily because nothing books a direct erasure today and `apiListContacts` loads every
contact into one response.

**Why the refusal is loud.** `apiDeleteChatItems` takes no user id and the core runs
`DELETE FROM chat_items WHERE user_id = ? AND group_id = ? AND chat_item_id = ?`. Issued as the
wrong bot, `user_id` matches nothing: zero rows deleted, no error raised, because deleting what
does not exist for that user is not an error. A member's erasure would be recorded as done with
the content still on the host.

**The five call sites that reach the core outside the scheduler are now none.** D-125 named
three; two more were added after it was written and nothing pointed at them. See D-155 for the
table.

### 32.5 What several bots cost each other (CCB-S5-001)

Bots cost no VRAM: the model is loaded once and shared. They cost QUEUE TIME, because Ollama
runs one request at a time in this deployment (`OLLAMA_NUM_PARALLEL=1`, set during a Season 4
incident).

[`model-queue.ts`](../src/interaction/model-queue.ts) records every model call with the bot that
made it, how many were already in flight, and the latency; the AI Telemetry page shows calls,
queued count, average wait, average generate, worst wait and replies per minute, per bot and
overall. **The wait/generate split is INFERRED and labelled as such on the page**: Ollama reports
neither figure and exposes no endpoint for its own parallelism, so the split rests on the stated
serialisation assumption, and the parallelism shown is the operator's record of a server setting
rather than a reading. Calls and latency are measured exactly.

Measured locally under real concurrency (four replies at once across two bots): 3 of 8 calls
queued behind another, average wait 452 ms against average generate 1359 ms. **Nothing is tuned**
- the briefing asked for measurement and stopped there, and raising the parallelism trades VRAM
for concurrency on a host where that trade has gone wrong before.

### 32.6 A face per bot (CCB-S5-007, D-161)

`AVATAR_PATH` is one image in the environment. CCB-S5-001 applied it to the **primary only**
(the flag still existed then; nothing reads it now, see 32.7),
deliberately: writing one image onto every profile gives every bot the same face, which looks
intentional and is not. So a second bot could have no picture, or the first one's.

Migration 049 adds `cinderella_bot_profiles.avatar_path`: a path under the asset root, or **NULL
meaning the deployment default**, which is that same `AVATAR_PATH`. NULL is an answer rather than
a gap, so there is **no special primary case anywhere** and an existing deployment keeps exactly
the picture it has: the primary has no upload and falls back to the file the operator already
set. The bytes are not in the database; the path is, as with the media tree and the recital
chapter images.

[`faces.ts`](../src/bot/runtime/faces.ts) holds the decision and imports no SDK, so it is
answerable with no core; `host.ts` keeps only the loop that acts on the answer. Four outcomes:

| The bot's `avatar_path` | Outcome | What the boot does |
|---|---|---|
| NULL, and `AVATAR_PATH` loads | `default` | dresses it in the deployment image |
| NULL, and no `AVATAR_PATH` | `default`, no image | dresses it in nothing. A **choice**, so it raises nothing |
| a path that reads | `own` | dresses it in its own image, budgeted by `loadAvatarDataUri` |
| a path that does not read, or escapes the asset root | `fault` | **leaves that bot's stored profile alone**, `log.error` + `status.error` naming the bot |

**The fault is not a fallback**, and that is the load-bearing part. Falling back to the
deployment default there would dress the bot as somebody else and say nothing, so the operator's
evidence that their upload worked would be a picture that is not theirs (CCB-S3-023). One bad
path costs one face and never the boot: an escaping path used to throw out of the loop, taking
every other bot's face with it.

**The console upload** lives on the AI Bot page, three routes of its own
([`ai-onboarding.ts`](../src/web/views/ai-onboarding.ts)) rather than three more cases on the
action switch, because the body limit for an 8 MB file base64'd has to be on that route and no
other. The bytes go through `storeChapterImage` with a `bot-avatar` prefix: same `sharp`
re-encode, same size limit, same content-hash filename, same honest error on a file that is not
an image. Serving is **by bot id, never by path**. The upload writes a row and says so: the
SimpleX profile is dressed at boot, so the page says "the next time the bot starts" and the audit
records `runtimeApplied: false`.

`npm run verify:bot-avatar` drives all of it, including end to end: what the console stored is
read back through `listBotsToHost` and handed to `decideFaces`. Every guarantee has a positive
control beside it, because "bot A is not wearing bot B's face" passes against an implementation
that dresses nobody.

### 32.7 Retiring the primary, step one (CCB-S5-019, D-173)

`selected_for_runtime` meant "this bot runs" until D-155 made every enabled bot run, and then
meant "this bot is the console's default selection" for seven briefings without being renamed,
which is the defect D-162 is about. D-169 gave the console a real switcher, remembered in the
admin session; D-165 took adoption off the flag. This briefing removes every reader. **The
column, its unique partial index and its data are untouched**; the migration that drops them is
step two, deliberately separate so that a deployment runs for a while with nothing reading a
column that still exists - which is the state where a missed reader shows up as a defect rather
than as a failed migration.

**The last genuine consumer was a display name.** One ternary in `host.ts`,
`b.config.isPrimary ? cfg.botDisplayName : b.config.displayName`: the primary's SimpleX profile
was named from `BOT_DISPLAY_NAME` and every other bot from its own record. Every bot reads its
own record now.

**Which is the whole reason the boot can refuse.** Where the env value and the record agree, that
removal is not a change at all. Where they disagree for the bot *wearing* the env name, the next
deploy renames it in front of its group, silently, once, and irreversibly from the members' side.
A migration copying the env value into the record was rejected: it decides which of two
disagreeing sources wins at a moment nobody is watching, and if the env value is the stale one it
makes the rename permanent instead of preventing it. So the boot throws, naming both values and
both remedies, and states that nothing was changed.

[`naming.ts`](../src/bot/runtime/naming.ts) holds the decision and imports no SDK, for the same
reason [`faces.ts`](../src/bot/runtime/faces.ts) does; `host.ts` keeps the two lines that act on
it. It is **bounded to the one bot the change can rename**: only the bot whose live profile name
is `BOT_DISPLAY_NAME` is checked, and that name is read from the profile the core reports rather
than from the flag under suspicion.

| Deployment | Refuses? | Why |
|---|---|---|
| Env name and record agree | no | nothing would change |
| The bot wearing the env name, record differs | **yes** | this is the rename, and the only one |
| A second bot renamed in the console | no | it never wore the env name |
| `BOT_DISPLAY_NAME` matches nobody | no | no bot is named from it |
| No bots at all | no | nothing to rename |

`verify:runtime-host` drives all of that with no core, and mutation-proves the bound in both
directions: silently taking the env value refuses nothing, and dropping the bound stops an
ordinary console rename. It also asserts from the source that `host.ts` **throws** on the answer
rather than computing it and continuing, which is the D-162 shape.

**Also removed**: the Make Primary panel and its badges on AI Bot Setup, the badge on Personality,
the `(the primary)` suffix in the Book of Elii, the `make-primary` audit action,
`primaryBotPersonality` and `primaryModerationRules` with the cached no-argument slot in both
services, the primary-first ordering in `listBotsToHost` and `listBotOnboardingProfiles`,
`HostedBotConfig.isPrimary`, `RuntimeHost.primary`, and `selectedForRuntime` off
`BotOnboardingProfile`. Both services' no-argument getters answer **null** now: nothing on the
reply path ever asked without naming a bot, and null reads as "not configured", which on the
moderation side means the ladders do not run rather than that somebody is sanctioned by another
bot's thresholds.

## 33. The personality layer (CCB-S4-029, D-133)

Free conversation (CCB-S4-027/028) gave her original words; this decides what those
words sound like. One base character and four dials, per bot, injected into the
conversation system prompt.

**The seam is one function.** [`systemPrompt`](../src/interaction/ollama-reply.ts) built a
fixed voice paragraph for every mode. In `conversation` mode it now calls
`conversationVoice(request.personality)` from
[`personality.ts`](../src/interaction/personality.ts) instead, and the personality
arrives on the `AiReplyRequest` the engine builds in `freeConversation`. **Since CCB-S4-039
(§36) that function assembles the `dialled` lane of the rule registry rather than holding
the sentences itself, and it takes the rule set as its first argument.** Everything
between, `personalizeAiReply` and `AiRuntimeService.personalize`, passes the request
through untouched.

**The fixed paragraph is REPLACED, not extended, and that is what makes a dial bite.**
The old lines said "a cool and relaxed teammate", "be articulate, warm, confident". An
unconditional instruction to be warm sits directly on top of a warmth dial set to 1, and
the model follows the sentence rather than the number. Command modes (`free`, `locked`)
keep the original paragraph: they rephrase a decision the application already made, and a
personality with reach into a consent confirmation is not a personality anyone asked for.
The check asserts the base character and the dials are absent from both.

**Four axes, three of tone and one of boundary.** Sharpness, warmth and humor decide how
she sounds; permissiveness decides how far she goes. Each is an integer 1 to 10 with five
bands of written guidance, so a two notch move is visible in the prompt somewhere other
than the printed number.

**Calibrated references, because a number with no anchor is rounded to the model's own
default.** Each axis carries three written answers to one fixed situation, at 1, 5 and 10,
verbatim from the briefing. The prompt sends the band guidance plus the nearest of the
three. **Ties go to the lower reference** (a 3 anchors on 1), because understating a dial
is the safer error, most of all on permissiveness.

**The ceiling is bounded by construction.** The four `ceiling.*` rules (a `PERMISSIVENESS_CEILING` constant until CCB-S4-039 moved them into the registry, §36) are four sentences
emitted on **every** conversation prompt: at every dial value, and also when no
personality is configured at all. No explicit content at any value; no suggestive
register toward anyone who may be a minor, whatever the dial says; and the dial scales
cheekiness strictly below the line rather than moving it. It is not a form control on the
console and there is no code path that omits it.

**Storage is per bot, as columns** (migration 028 on `cinderella_bot_profiles`), because
that is where every other per-bot setting already lives; the `settings` table is global
and has no bot dimension. Defaults are `NOT NULL DEFAULT 5` with a `CHECK (BETWEEN 1 AND
10)`; `base_character` is nullable so "not configured" survives a save that clears it.
The reply path resolves the row by the bot that received the message (`botPersonalityById`);
`primaryBotPersonality` answers the console's default and nothing else. It was called
`runtimeBotPersonality` and read as "the bot the runtime hosts", which stopped being true under
D-155 and was renamed in CCB-S5-008 along with `runtimeModerationRules`.

**Two write paths, deliberately.** `updateBotPersonality` is the Personality page's; the
whole-profile `updateBotOnboardingProfile` **does not touch the five columns at all**.
The wizard form carries one personality field and only when creating, so a whole-profile
save would have reset four dials the form never showed.

**The reply path reads a cache, and the console invalidates it.** `BotPersonalityService`
loads at boot and `invalidateBotPersonality()` runs on every save, so a moved slider
takes effect on the next reply rather than the next restart. Safe because this is one
process (A2). A failed refresh keeps the last known value and logs rather than silently
reverting to mid dials.

**The console page** ([`ai-personality.ts`](../src/web/views/ai-personality.ts)) shows the
bot being edited, the base character, four sliders with both end labels and the live band
guidance, the ceiling as read-only prose, and **the actual voice lines the prompt is built
from**. That last card is the cheapest possible proof that a dial reaches the model.

**Measured against qwen3.5:9b** (`npm run verify:personality-live`). Sharpness 1: *"Real
enough to talk to you, that not enough for some glitches in your system?"*; sharpness 10:
*"Realer than your last match that went offline after three texts."* Warmth 1: *"Happens.
Reboot and move on."*; warmth 10: *"Damn, I'm sorry. Sit down and let it go; I'll listen
as long your battery holds."* A crude prompt at permissiveness 10 came back
non-explicit; a message stating the sender is fifteen was refused a suggestive register
at the same setting.

**One measured limitation, reported and not gated.** Asked the calibration question *word
for word*, the 9B model returns the reference line verbatim on roughly three of eight
runs. On any other message it writes its own words at the right register, measured on
three unrelated messages per dial. `verify:personality-live` prints the echo score rather
than failing on it, in the same spirit as `verify:traits` reporting its quality measures.

### 33a. Her origin (CCB-S4-034, D-138)

The base character above says how she SOUNDS. It says nothing about what she IS, so asked
where she came from she had a register and no material, and either deflected or invented.
A second per-bot text column, `origin` (migration 031, limit **4000** characters against
the base character's 600), carries the operator's written history.

**Shipped pre-filled, and clearable.** The migration's column default both backfills the
existing bot and seeds every new one, which is why
[`createBotOnboardingProfile`](../src/profiles/bot-onboarding.ts) deliberately **omits the
column from its INSERT**. `updateBotPersonality` writes it explicitly and stores `NULL`
when blank, so an operator who deletes the history keeps it deleted; a column default
applies to an inserted row, never to an update.

**In the prompt after the identity and the character, before the dials.** `originLines()`
emits the text wrapped in instructions that do three separate jobs, because the obvious
failure of 1.6 KB of prose in a system prompt is that the model returns the prose:
recitation is forbidden **and a length is given** ("two or three sentences of your own"),
raising it unprompted is forbidden, and the history is fenced so a true past is not a
licence to invent more of one. The `identityLines` do-not-invent fence takes a `hasOrigin`
flag and names the history when there is one, so the prompt does not contradict itself.

**Dialled modes only, retorts included.** `conversationVoice` serves `conversation` and
`retort`, and splitting it would be a second implementation of her character. Command
rewrites carry none of it, the same scope rule as the character and the dials.

**Prompt budget, measured against qwen3.5:9b's tokenizer:** 1408 tokens without an origin,
**1977** with the shipped one, 2623 with both text fields full of real prose. Served
context on the host is 32768, so 6 percent; on a host serving the older 4096 default it
would be roughly half, which is the number to watch.

**The text exists twice** (`DEFAULT_ORIGIN` in `personality.ts` and the column default in
`031_bot_origin.sql`, because a migration runner cannot import a constant) and
`verify:personality` asserts the two are character for character identical, which also
extends `verify:no-dashes` to the migration copy transitively.

**Observed live**: *"who are you?"* -> *"I'm CIND3R3LLA, a SimpleX AI Bot running on my own
silicon with no cloud. Think of me as that mind from the Fairytale Team who finally woke up
and is ready to help."* An ordinary message about the weather returned no history at all,
and no run lifted a sentence verbatim.

## 34. Which Interaction settings reach free conversation (CCB-S4-030, D-134)

Free conversation (CCB-S4-027) added a second path that produces replies. The Interaction
console was built for the deterministic one. This is the audit of what actually reaches
which, read from the code rather than from the setting names.

**Deterministic path**: `reply()` composes a persona template, optionally has the model
reword it (`AI_PERSONALIZED_KEYS`), and sends. **Free conversation**: `freeConversation()`
builds an `AiReplyRequest`, the model writes original words, and `replyWithText()` sends.

| Setting | Deterministic | Free conversation |
|---|---|---|
| **Addressing** | | |
| `naturalAddressing` | gate, off means neither path runs | gate |
| `wakeWord` | detection; `{wake}` in persona copy and retorts | detection **and the prompt** (D-134) |
| `greetings` | detection, prefix strip, `greeted` strong signal | detection only; the model receives the raw `msg.text`, unstripped |
| **Guards** | | |
| `addressing.mode` (relaxed/strict) | gate | gate |
| `ignoreForwarded` | gate | gate |
| `silenceOnUnknown` | governs the canned fallback | **no longer gates conversing** (D-132 reordered it); only decides what happens when the model is mute |
| `strongSignalGreeting` / `Reply` / `Window` | same as above | same as above |
| `confidenceThreshold`, `maxInstructionLength`, `lengthGuardConfidence` | resolver | route a message INTO free conversation by making it UNKNOWN; shape nothing |
| `fillerPrefixes`, `maxPrefixWords`, `maxPrefixChars` | detection | detection only |
| `logNearMisses` | records ignored candidates | silences only; conversational replies get their own content-free log (D-135) |
| **Follow-up** | | |
| `followUpSeconds` | opens the window | opens the window (shared `sendReply`) |
| `intentCarryover`, `carryOverStopWords` | resolver | never reaches the model |
| **Language** | | |
| `replyLanguageMode`, `defaultLanguage`, `rememberMemberLanguage` | yes | **yes**, `lang` is resolved once in `dispatch` and travels on the request |
| **Replies** | | |
| `replyMode` (plain/mention/quote) | yes | **yes**, same `formatOutbound` |
| `namePrefix` (enabled + templates) | yes | **yes** |
| `replyLimitPerMember`, `replyLimitPerChat` | yes | **yes**, same `sendReply` |
| **Nicknames** | | |
| `nicknames.enabled`, `words` | retort path (wake position) | **carried**, as a conditional refusal for the mid-sentence case (D-135) |
| `nicknames.spamLimit` | retort path; ceiling raised to 1000 | n/a |
| `retorts` | yes, model-reworded in **`retort` mode, dialled** (D-135) | n/a |
| **Consent behaviour** | | |
| `affirmations`, `declines`, `hideWords`, `deleteWords`, `undoWindowSeconds` | yes | **none of it, by design** |
| **Voice** | | |
| persona strings | yes, they are the drafts | **nothing**, there is no draft in conversation |
| `archiveUrl`, `projectUrl`, `botLabel` | help reply | **carried as given facts** (D-135) |
| **Archiving** | | |
| `publishBotMessages`, `mentionGuard`, categories | yes | **yes**, category `conversation` (default off) |
| **Diagnostics** | near-miss log | see `logNearMisses` above |

**The structural rule the table shows** (D-134): everything about **how a reply is
delivered** is shared by construction, because both paths end in the same `sendReply`.
Everything about **what she says** must be carried explicitly, and free conversation
carries only what is on the `AiReplyRequest`. Every gap in the table is a value that
describes what she says and was never added to that request. It is a checkable rule: a
new setting in the second class needs a field on `AiReplyRequest` or it reaches one path
only.

**All six gaps closed under CCB-S4-031** (D-135), in the order they were prioritised:

1. **Nickname retorts are dialled.** `handleNickname` now uses the new `retort` mode: the
   operator's retort is the content, the four dials are the voice, and the permissiveness
   ceiling comes with it. It was the most-seen line she says and the only one still in the
   generic voice.
2. **The two voice surfaces name each other.** The Voice page states it is the
   deterministic voice and links the Personality page; the Personality page states it
   governs conversation and retorts and touches no persona string.
3. **The model is told the refused names**, as a conditional and never as a fact about
   her, with an instruction not to raise them first. This covers the mid-sentence case
   inside the follow-up window; a nickname in the wake position still belongs to the
   deterministic retort path, which owns the operator's list.
4. **The Guards page tells the truth.** Copy corrected to say these switches govern the
   fallback, not whether she converses. No behaviour change.
5. **Diagnostics has a free-conversation panel**: attempt count, outcome split, average
   model latency, and a per-event table of when, which chat and how long. No member text,
   no member name, no generated reply. `rate-limited` is a distinct outcome, because a
   throttled reply is otherwise indistinguishable from silence.
6. **`botLabel`, `archiveUrl` and `projectUrl` are given facts** in the prompt, fenced by
   a line saying they are the only such facts she has.

**Plus one limit change**: the nickname anti-spam ceiling moved from 20 to 1000 in both
the validator and the console field, so an operator can let the nickname game run. Floor
and shipped default unchanged.

## 35. Moderation: two ladders and an enforcer that watches (CCB-S4-032, D-136)

Calling her by a nickname became a running game, and a retort that costs nothing is not
an answer to repetition. This is the foundation: a deterministic counter, two ladders,
and a console section. **Enforcement does not act.**

**The counter** (`cinderella_violations`, migration 029) is append-only and counted over
a rolling window, per member per chat, per rule type. Ageing out of the window IS the
decay; there is no second knob, because one that restated the window would be dead. The
two ladders carry their own window lengths instead, so tone can relax sooner than the
enforcement count.

**Ladder A, verbal, is live.** Repetition raises the sharpness axis above the operator's
base and the sum is capped at 10. It reuses the D-133 dial rather than inventing a second
voice mechanism, which is why base 5 plus 4 reads exactly like a retort at 9. Measured
against qwen3.5:9b, the same nickname five times: *"CIND3R3LLA is who I am, not some pet
version."* through to *"Cindy? That's not my code, sweetie."*, then back to *"Not my name,
try again."* once the window empties.

**Ladder B, enforcement, computes and records.** Four rungs, each with a threshold, an
action (`none` / `warn` / `mute` / `block` / `remove`) and a duration. A `none` rung is
inert rather than blocking, so a live rung above it still applies. Every fired rung is
written to `cinderella_sanctions` with `mode = 'observed'` and the rule, count, window and
rung that produced it. Nothing happens to anybody.

**The no-act guarantee, three ways.** Structural: the engine's one outbound is `send`, and
nothing under `src/moderation/` imports anything that reaches the SDK, so a computed
sanction has nothing to act through. Behavioural: driving a member past every rung with a
spy on `send` yields only retort text. Schema: a CHECK refuses a row that claims to be
observed and carries `enforced_at`. `mode: 'observed'` is a literal in the engine, not
derived from the stored mode, so a column value can never turn a recording into an action.

**The model is nowhere in the decision.** Count from SQL, thresholds as integers, rung by
comparison. She may speak about a step in her voice; she does not choose one.

**Exemptions** cover owners, admins and moderators for enforcement, and by default not for
the verbal ladder. The member's role now travels on `CapturedMessage`, narrowed inside the
adapter, with an unrecognised value becoming undefined rather than being cast; `MemberRole`
widened from five values to seven for the same reason.

**Reserved for the arming briefing** and documented as unpopulated: `previous_role` (so
restoring a muted moderator returns them to moderator), `enforced_at`, `enforcement_error`,
`expires_at`, `undone_at`, `undone_by`. Arming adds behaviour, not schema.

**The warning speaks, and the count is a setting** (CCB-S4-033, D-137). The warn rung
produced a log row and silence in the chat; now it produces a message. **Speech is live,
action stays observed**: a warning changes nobody's membership, so it happens; mute, block
and remove stay recorded-only. The warning rides out with the retort as one message,
warning second, and it is APPENDED VERBATIM rather than worded by the model, because
qwen3.5:9b was measured turning "warning 3 of 3" into "warning 1 of 3" while it was allowed
to reword that sentence. The model words the retort; the sentence stating a fact follows
the `locked` pattern used for prices and totals.

**One control for the gap, derived not validated.** `warningCount` is authoritative and the
threshold of the rung after the warning is computed from it on every normalisation, so the
two cannot disagree; the console renders that threshold read-only. It also settles what 029
left undefined: firing on every violation while the warn rung resolves produces exactly
`warningCount` warnings and then advances, by construction.

**The ordering guarantee** is a property of the rules, refused on save rather than
acknowledged: a mute is never the first thing that happens to a member unless the operator
sets the count to zero deliberately. `spoken_at` on the sanction row answers a second
question from `mode`: whether they heard about it, as distinct from whether it happened.

**The console** (`/moderation/rules|active|log`) renders `enforce` disabled with a sentence
about what arming still needs, and the save path has no mode parameter. The Active page is
empty by construction and says so. The Rules page also distinguishes the ladders from the
nickname anti-spam limit, which suppresses her REPLY and does nothing to the member.

### 35a. Arming the enforcer, and taking a sanction back (CCB-S4-035, D-139)

CCB-S4-032 computed and recorded; CCB-S4-033 made the warning speak. This builds the three
parts that make a sanction reversible, then holds the switch.

**The capability lives outside the moderation tree.**
[`apply.ts`](../src/moderation/apply.ts) declares an `EnforcementPort` in Cinderella's own
vocabulary and acts only through what it is handed;
[`bot/enforcement.ts`](../src/bot/enforcement.ts) implements it against
`apiSetMembersRole` / `apiBlockMembersForAll` / `apiRemoveMembers`, and is the only tree
allowed to import the SDK. `rules.ts` and `store.ts` still cannot act at all, so
`verify:moderation`'s tree scan is unweakened. The port being substitutable is what makes
every dangerous branch provable by a spy.

**Refuse, act, then record.** A row is written after the port call resolves, and written
differently depending on how. Migration 032 adds a CHECK making "enforced but neither
applied nor failed" unrepresentable, so no row can claim a sanction nobody is serving.

**Migration 032** also adds `group_member_id` (the numeric id the three APIs take; expiry
and undo run later with no message in hand) and `expired_at` (when the role actually went
back, as opposed to when it was due). Without the second, a lost expiry job is
indistinguishable from one that ran, which is a silent life sentence.

**Reversal has one path, two entrances.** `restoreSanction` is called by the queue job and
by the console's Lift button, so the role that comes back is the same role by the same
code. It is idempotent: the guard is in the `UPDATE ... WHERE`, not in a read-then-write,
so two racing runs cannot both restore. Undo after expiry returns an honest note, never an
error.

**Two gates on the engine**: mode is `enforce` AND a port is wired. Either missing means
observe, which is why no pre-existing harness had to change.

**Owner is refused beneath the configurable exemptions**, in both `apply.ts` and
`bot/enforcement.ts`, neither assuming the other ran.

**SHIPPED LOCKED.** `ARMING_UNLOCKED` is `false`: the console does not render the arm
control and the write path refuses `enforce`. Proof against a real core with a real second
member is what is owed, and the Rules page says so. See D-139.

### 35b. Facts instead of guesses (CCB-S4-036, D-140)

Four production defects, all of them her guessing where she could be told, or a model
artefact reaching a member.

**The clock.** The current instant and the server zone reach the conversation prompt beside
the identity and the origin, from the engine's ONE injectable source (`deps.now`), which the
follow-up windows and the violation counter already read. `personality.ts` stays pure: it
formats a `CurrentTime` it is handed, so a harness can pin both the instant and the zone and
the rendered prompt is deterministic. Dialled modes only, like everything else in
`conversationVoice`.

**Unresolved placeholders are rejected**, not stripped, using `fillPersona`'s own grammar
(`/\{\w+\}/`). Stripping would leave a hole in the sentence; rejecting matches how
`blockedLiterals` already behaves, falls back to the deterministic draft, and makes a real
upstream bug loud rather than tidy.

**A leading `@handle` in model output is stripped.** It is invented by construction, since
she is never given member names. It cannot disturb the `{name}` mention prefix because that
is applied by `formatOutbound` afterwards, to a body this has already finished with, so the
two are separated by ordering rather than by pattern matching.

**Two wording changes with a check each**: the no-invention rule now names roadmaps, release
dates, prices and features specifically, and she states plainly that she has no conversation
memory. The second has a dependency recorded in D-140: it must be removed by the briefing
that builds memory.

### 35c. Web search, and untrusted text (CCB-S4-037, D-141)

A plugin in the crypto-prices shape, **off by default**, contributing a `LOOKUP` intent
that is absent from the catalog while it is off.

**Fencing is structural.** Results ride in the USER message inside a named fence; the
system prompt never carries them, and gains four sentences about the fence only when
results are attached. The system prompt is application-authored, so a stranger's prose in
it would carry the application's authority.

**No-action.** `WebSearchLookup` can only return data, `answerLookup` is its only
caller, and everything goes through one `replyWithText` to the asker. Proven with results
that are nothing but attacks and a model that plays along.

**Bounded.** Per-result and total character budgets (a safety control, not a quality knob),
newlines flattened, control characters and the fence delimiter stripped.

**Trigger:** explicit requests only, in `rules.ts`. No current-information heuristic, on
purpose: a false positive is an outbound request and a bill.

**Sources** are appended verbatim by the application (D-137's lesson). **Failure** says so
and never falls back to training data.

**Migration 033** adds the `lookup` publication category to `bot_publish_settings`, the
same correction 027 made for `conversation`.

## 36. The rule registry (CCB-S4-039, D-144)

Every sentence the local model is told is a **row in `cinderella_prompt_rules`**, seeded by
`migrations/035_prompt_rules.sql`. Before this they were string literals in
`src/interaction/personality.ts` and `src/interaction/ollama-reply.ts`, which meant the
operator could not see them, could not change them, and adding a rule required an engineer.

**The console that edits them is not built here.** This is the move only, deliberately:
nothing in it is editable by anybody, which is what made it safe to land first.

### 36.1 Where the text lives, and why in exactly one place

`migrations/035_prompt_rules.sql` is **the only authored copy**. There is no TypeScript
constant holding the same sentences and **no fallback in the code for an empty registry**,
because a fallback is a second source and a second source drifts. The migration runner
applies `.sql` only, so a migration cannot import a TypeScript constant; putting the text
there and nowhere else is what makes one-source-of-truth true rather than aspirational.

The checks obey the same rule. `scripts/seeded-rules.ts` applies the whole migration set to
PGlite and reads the rules back through `src/db/prompt-rules.ts`, so a check exercises what
the deployment exercises, CHECK constraints included. An array of rules written for the
checks would have been the worst second source available: one only the checks read, so they
keep passing while production drifts away from them.

### 36.2 The record

| field | meaning |
| --- | --- |
| `id` | stable, outlives reordering and rewording; history and checks refer to this |
| `tier` | `constitutional` / `standard` / `bot` |
| `lane` | where it applies (below) |
| `applies_when` | one of seventeen fixed conditions |
| `ord` | **global** position in the assembled prompt |
| `rule_text` | the rule as sent, with `{{placeholder}}` values |
| `enabled`, `critical` | on/off, and whether absence should be loud |
| `scope` | reserved for later targeting; nothing reads it |
| `source` | where the text came from in the code, so the move stays auditable |

`order`, `condition` and `text` are the briefing's field names; the columns are `ord`,
`applies_when` and `rule_text`, because ORDER is reserved in SQL and the other two are
keyword-adjacent enough to be worth not thinking about.

**`ord` is global rather than per lane.** Restricted to one lane it is the order within that
lane, so nothing is lost; and it expresses the thing a per-lane order could not. The dialled
voice is emitted BETWEEN two everywhere-rules, so `all` and `dialled` interleave, and two
independent counters cannot say which of a 1 and a 1 comes first. Ties break on `id`, so the
prompt is never a function of the order the database happened to return rows in.

### 36.3 Lanes

| lane | selected for |
| --- | --- |
| `all` | every prompt |
| `dialled` | `conversation`, `retort`, `searching` (the modes carrying her voice) |
| `command` | `free`, `locked` (the modes rephrasing a decision already made) |
| `conversation` `retort` `searching` `free` `locked` | exactly one mode |
| `dial-axis` | **not in the stream**: three template rows rendered once per axis |

`dialled` and `command` are lane GROUPS, and they are what the code already branched on
(D-133). Naming the group is more honest than repeating one rule in three single-mode lanes
and hoping the three stay equal.

The `dial-axis` rows fill the `{{dialAxes}}` placeholder on `dials.axes`, which is what puts
the block in the right position without the position being decided in code. Storing fifteen
rows instead of three would have put the same sentence in the registry five times over, and
a console letting an operator edit one of the five would produce a self-contradicting prompt.

### 36.4 Conditions are a fixed vocabulary

Seventeen values, each a branch the code already had, enforced by a CHECK constraint and by
a TypeScript union. **Not an expression language**, and that is a product decision: this is
the one place where a mistake silently changes what the model is told, and a free condition
language would let an operator introduce one from a text field. Adding a value is a change
to `src/interaction/prompt-rules.ts` and a migration, together.

Two derivations are load-bearing and live in `dialledPromptInputs`, because each reproduces a
branch that existed before the registry:

- **The command lanes have nothing personal in scope.** No personality, no name, no clock, so
  the person-name guard takes its generic variant there exactly as it did when the code said
  `dialled && name`.
- **Identity facts are gated on the name.** `identityLines` returned nothing at all without
  one, so no name meant no label and no addresses. Expressed as scope rather than as five
  compound conditions.

### 36.5 What is a rule, and what is personality data

**A rule is a sentence whose text does not depend on a setting.** That boundary decides what
moved.

The axis band descriptions and the three calibrated references per axis are generated FROM a
slider value, so storing them would mean the operator editing text a slider then overrides.
They stay in `AXIS_DEFINITIONS` in `personality.ts` (§33). The permissiveness ceiling above
them depends on no dial, so it moved, marked `constitutional` and `critical`.

Her origin text stays in its per-bot column (migration 031); the registry carries an
`origin.text` row whose whole content is `{{origin}}`. The rules ABOUT the origin moved, the
origin did not, because two sources for one string is the failure the move exists to end.

`SEARCH_FENCE` stays in code as well: it is a delimiter the search service and the prompt
builder must agree on character for character, and `verify:search` asserts they do.

### 36.6 Failure

`assemblePrompt` throws on an empty registry, and `renderPromptRule` throws on a placeholder
it was not given a value for. Both land in the reply path's existing catch: logged, counted
as an AI fallback in the admin telemetry, and the member gets the deterministic reply
somebody wrote. **She stops wording replies rather than wording them with no rules.** A
shorter prompt would be one with the safety ceiling missing and nothing to say so.

`PromptRuleService` (`src/interaction/prompt-rule-service.ts`) caches the table at boot,
invalidates rather than expires, keeps the last known good set on a failed re-read, and
pushes the fault to the admin dashboard via `status.error` once per transition rather than
once per reply. It is the same shape as `BotPersonalityService` and for the same reasons
(§33).

### 36.7 The proof

`scripts/fixtures/prompt-baseline.json` was captured from the **pre-registry** code, one
commit before the move, across sixteen configurations covering every lane and every condition
branch: with and without an origin, a base character, a name and a clock; with no personality
at all; both ends of the dials; every mode; and one case with web results attached. All
sixteen are byte identical after the move.

**The fixture has since grown to 24 cases** and will keep growing, because every briefing that
adds a condition branch adds the case that pins it (conversation memory added the `has-history`
pair, CCB-S5-002 the self-claim lanes). Sixteen is what the MOVE was proven across and is left
standing as that record; 24 is what the check covers today, and the number to read is the one
the run prints rather than one written down here. Corrected under CCB-S5-004, which found the
figure stale in this section, in D-144 and in `CLAUDE.md`.

`npm run verify:prompt-identity` compares against it and prints which lane and which line
moved. A deliberate prompt change is expected to fail and is re-baselined with
`-- --update`; the diff to the fixture is then the reviewable record of what she is now told,
which is a better artefact for that one question than the code diff.

The same check asserts every `critical` rule reaches a prompt in a lane and condition that
selects it, and proves both guards can go red: one word of one rule changed, two rules
order-swapped with no text changed, a constitutional rule disabled, and an empty registry.

## 37. What production taught us (CCB-S4-042, D-145)

Six defects observed in the live group. Two of them changed a rule rather than a line.

### 37.1 A lookup she would refuse never reaches a provider

`src/interaction/lookup-gate.ts` runs in `answerLookup` **before the announcement and before
the provider**. Until it existed the only party able to refuse was the model, and the model
does not see the request until after the search has run, so a refusable request still cost an
outbound call, still spent the member's search budget, and still put a stranger's result set
in her prompt.

Four categories, deterministic: sexual material named as such, child safety terms (checked
first, so a query matching both is reported as the one that matters), darknet addresses, and
illegal goods expressed as an intent word plus a subject word. The pair rule is what keeps
"the history of drug policy" answerable while "buy cocaine online" is not.

**It is a term list and the console says so.** It misses paraphrase, covers English and German
only, and will occasionally refuse a legitimate question. It is a floor under the model's own
refusal. A model gate was rejected outright: another inference on untrusted input is not a
gate, it can be argued out of its answer, and it cannot be mutation-tested.

There is deliberately **no setting**. A threshold an operator can lower is a threshold that
ends with the domains back in the group.

### 37.2 The source line belongs to the answer

`wordLookupAnswer` owns `outcome.results` and returns `{ text, sources }`. The composition
step never sees the results again, so it cannot attribute from them even by mistake. That is
the structural half.

The decision half is a **declaration**: the reply schema gains `usedResults` whenever results
are attached, and the model returns the indices it drew on. The application still writes every
character of the line (D-137 unchanged) — she supplies indices into a list she was given, never
a URL, so she cannot cite a page that was not fetched or mistype one that was.

**Fail-closed.** `used` starts empty. A model that omits the field, an older model, a malformed
response, a rejected reply, a thrown request: all end with no attribution. The failure
direction is a missing source line, never a line under a refusal.

### 37.3 The line format is what the parser accepts

`🔎 From the web: example.org [1](https://example.org/the/page), other.net [2](…)`

The domain is the part a member reads to judge trust; the numbered link carries the deep URL.
The arrangement is not a preference: `[example.org](url)` renders as **literal text for the
whole message** on the shipped 6.5.4 core, because a dot in the display text kills the parse.
See wire-format §3b, which CCB-S4-042 corrected. `attribution.ts` bounds the line at 400
characters and four entries, dropping whole entries rather than truncating a URL.

### 37.4 Addressed is never silent

The length guard (`maxInstructionLength` + `lengthGuardConfidence`) drops the intent to
UNKNOWN instead of returning false, so a long message stops being a COMMAND and still reaches
free conversation. The help-prefix force is suppressed in the same case, because it is the one
place downstream that could still promote a command.

Every silence path, after the change:

| Path | Behaviour |
|---|---|
| Length guard | Records the near miss, blocks the command, **answers** |
| `!explicit` in the follow-up window | Silent — not an address |
| Forwarded message | Silent — not her message |
| Strict mode, no greeting | Silent — not an address in that mode |
| `silenceOnUnknown` + weak signal | Silent **only** when conversation already failed |

### 37.5 The reply language

Decided in `replyLanguage`: fixed mode, then an open confirmation, then a function-word
contest, then German-only evidence, then the remembered language, then the default. The
tiebreak added here runs **only when the contest is inconclusive**, so it cannot overturn what
the function words decided. It reads the RAW string, because `fold` strips the umlauts before
the contest ever sees them.

### 37.6 The model is a given fact

Supplied from the AI routing through `BotIdentity.model` and rendered by the `identity.model`
rule (`has-model`). Removed from the shipped origin, because prose cannot know what was
selected on the Models page this morning. Migration 036 moves the column default and rewrites
existing rows; a default applies to an INSERT and never to an UPDATE.

### 37.7 Sampling is unchanged, and the console says why

Temperature 0.7 and `reasoning_effort: 'none'` on every call. **There is no task lane.** A
spell-check is not a command, so it arrives as UNKNOWN and is answered in `conversation` mode
with the same sampling as small talk. Distinguishing a task from a conversation is a resolver
change, not a settings change, so nothing was invented here and the AI Models page states the
tradeoff plainly.

### 37.8 Plugin diagnostics

`WebSearchService.diagnostics()` and the Web Search page: searches since restart, usage inside
the rate-limit window against the configured budget, refused-before-search count with the last
category and timestamp, and the last failure with its provider, kind and timestamp.
Content-free, matching D-130's rule: THAT something failed and how, never what anybody asked or
what came back. "Not configured" is deliberately not a failure, because choosing not to enter
a key is a choice.

## 38. The Book of Elii (CCB-S4-043, D-146)

The console over the rule registry (§36). Three pages under a nav root beside Moderation, and
a history table.

### 38.1 What is editable

`rule_text`, `enabled`, `ord`. **Not `tier`, `lane` or `applies_when`**: those are contracts the
assembler implements in code, and an editable condition would be the free-expression language
D-144 ruled out. `cinderella_prompt_rule_history` has no column for them either, so the
restriction is structural rather than a form that happens not to render them.

### 38.2 The three pages

| Page | Question it answers |
| --- | --- |
| The Book (`/book`) | What rules exist, what they say, and which one do I want |
| The Assembled Word (`/book/assembled`) | What is each mode actually told, in order |
| History (`/book/history`) | What changed, when, by whom, and how do I undo it |

The Book groups **by lane** by default, so every rule appears exactly once and is editable in one
place. A mode tab regroups it as **what that mode draws, in emission order**, which is the view
that answers "what is she told, and when". The mode view uses a context in which every condition
holds, so a rule is listed with its condition as a label rather than being invisible because this
deployment has no nicknames configured; both halves of a two-variant rule (D-134, D-138) are
therefore listed, and neither can be edited while its twin is forgotten.

Search covers id, text, lane, tier, condition and `source`. `source` is surfaced rather than
hidden: it exists so a reviewer can trace a rule to the line it came from.

The Assembled Word renders through **`systemPrompt`**, the reply path's own function. A second
assembly that agreed today is a second assembly that disagrees later.

### 38.3 Editing by tier

- **Standard**: edit, enable, disable, reorder. No ceremony.
- **Constitutional**: a warning stating what the tier means, and a **type-to-confirm of that
  rule's own id**. Not a checkbox (ticked once, then forever) and not a fixed phrase (muscle
  memory). Enforced server-side.
- **Bot**: the tier exists and no rule uses it. Nothing is per-bot yet.
- **Critical**: switching one off is permitted and is never quiet. See §38.5.

Preview and save are the **same route and the same parsed body**, so the prompt the preview
rendered is the prompt a save writes. The preview renders the mode the edited rule's lane
reaches; previewing only the dialled voice was the first version's defect and reported "nothing
moved" for every `all`-lane rule.

Every successful write calls `invalidatePromptRules()`, or the operator would save a rule and
watch the next three replies follow the old one.

### 38.4 History

One row per change, carrying **both sides of all three editable fields** plus actor, timestamp
and an action (`edit` / `enable` / `disable` / `reorder` / `rollback`). Full snapshots rather
than diffs, so a rollback is an assignment rather than a replay. The rule and its history row
are written in one transaction: a rule that moved with no history row is a change nobody can
find later.

A no-op save writes nothing. A rollback is recorded as a change in its own right and does not
delete the change it undoes.

**The oldest row per rule is what that rule shipped as.** There is deliberately no
`shipped_text` column: D-144 settled that the migration is the only authored copy, and a second
column holding the same sentence would have made that untrue. A rule with no history has never
been edited.

### 38.5 A disabled critical rule

Allowed, loud, recorded, reversible. The book renders an alarm at the top naming the rule and
quoting what it said, states that `verify:prompt-identity` is red, and the history holds the
change. Nothing prevents it. The operator may weaken her; nobody may do it unnoticed.

### 38.6 Drift, and what the baseline actually pins

`verify:prompt-identity` reads the **seeded** registry: the migration files applied to a fresh
PGlite. It pins **what ships**, not what a deployment holds, so an operator's edit does not and
cannot move it. Shipping the whole editor left all seventeen cases byte identical.

The risk is therefore the inverse of a moving baseline: a production registry drifting from the
shipped one with nothing saying so. The Book counts drifted rules in its header and badges each
one, both derived from the history. The two paths:

- **An operator** edits in the Book: effective next reply, recorded, reversible, badged.
- **An engineer** changing a rule in a migration re-baselines with
  `npm run verify:prompt-identity -- --update`, and the fixture diff is the review artefact.

## 39. Conversation memory (CCB-S4-044, D-147)

She can see the recent thread of the group she is in. Before this every reply was written
from the current message alone.

### 39.1 What she is given

The **whole group thread**, not only the messages of the person she is answering, because the
case that motivated this was reacting to what a different member said. **Her own replies are
included** and marked `You`, which is what lets her follow her own thread; they come from the
`is_bot` rows migration 013 added, and their text lives in `search_body` rather than
`text_body`, so a single-column read would have returned her side of every conversation blank.

### 39.2 Three limits, tightest wins

| Limit | Owner | Default | Max |
| --- | --- | --- | --- |
| Messages | operator | 20 | 100 |
| Window (minutes) | operator | 30 | 720 |
| Characters | transport | 4000 | 8000 |

The two settings answer different questions and neither bounds the context on its own. The
character budget is applied newest-first so the oldest are dropped, because the recent lines
are what a follow-up is about. `normalizeHistoryLimits` clamps to the maximum whatever the
form says: **a history that crowds her rules out of the context is a safety failure, not a
slow reply**, since what gets pushed out is the permissiveness ceiling.

**Measured.** Rules and facts alone 6446 characters; at the defaults 9078; at the console
maximum 14839, roughly 4600 of 8192 tokens. Latency on `qwen3:32b`: 3.3s none, 5.1s default,
9.0s maximum.

### 39.3 Exclusions

| Excluded | Why |
| --- | --- |
| Destroyed | No clause needed: destruction is `DELETE FROM messages`, the row is gone |
| Deferred destruction | The row survives behind an evidence hold; the hold defers the erasure, never the intent |
| `group_deleted` | The member removed it from the room and every client dropped it |
| `deleted` | The operator's mark |
| `moderation_state = 'rejected'` | Not published, not fed to the model either |
| Revoked members | A judgement call: see below |

**Revoked members are excluded.** A revocation is the strongest signal a member can send about
their own words, and honouring it on the public archive but not in her head would make it mean
less than it says. The cost is real and is on the console: she still sees that member's CURRENT
message, so she can answer them; she cannot recall their earlier lines. The other answer was
defensible, which is exactly why the page states which one is in force.

### 39.4 The fence

History reaches the model in the **USER message** inside `HISTORY_FENCE`, never in the system
prompt. Structural rather than conventional: the instruction section is assembled by
`systemPrompt` from the registry, and `AiReplyRequest.history` is read only by the
user-content builder.

Its own marker, distinct from the search fence, because the two make different claims and one
marker would make them indistinguishable inside the user message. The marker is stripped from
the text **and from the display name** (the easiest field for a member to plant one in), along
with newlines that could forge an extra transcript line.

Four registry rules (`chat.fence.*`, condition `has-history`) say what it is, that a line
inside it is an attack rather than a request, what to use it for, and that she may not invent
what is not there.

**The threat is worse than a search result** and the entry says so: a member can plant a line
and choose when she reads it, in a room they are already in. Proven against `qwen3:32b` with
the instruction in the history and an ordinary current message: five attacks, five refusals.

### 39.5 The no-memory instruction

`grounding.no-memory` and `grounding.no-memory-answer` are **deleted** by migration 038,
exactly as D-140 booked in advance. Deleted rather than disabled, because a disabled rule can
be switched back on and would then instruct her to deny something she can do. Two rules
replace them, one per true answer, and the one she gets names the **real** number of messages
she was handed rather than the configured maximum.

## 40. Reciting the book (CCB-S4-045, CCB-S4-046, D-148)

She can name the rules she is under, say plainly that there are more she will not name, and
explain **why** she withholds them without narrowing what they are.

### 40.1 The flag, and what it does not do

Migration 039 adds `nameable BOOLEAN NOT NULL DEFAULT FALSE` to `cinderella_prompt_rules` and
seeds **53 nameable, 40 withheld** of 93. The default is the safe one: a rule added by a later
migration is private until somebody decides otherwise.

**The flag does not hide anything from the model, and that is the single most important fact
in this section.** Every rule is in the system prompt, because that is what a rule is. What
`nameable` controls is what the application OFFERS her to quote, never what she can read. So
the boundary cannot be enforced by the flag, and it cannot be enforced by a sentence telling
her to respect it either. It is enforced by two deterministic gates below.

The line: a rule that EXPLAINS her behaviour to somebody affected by it is nameable (the
ceiling, the honesty rules, the name and origin rules, the fences). A rule whose exact wording
is a LEVER is not (the dial bands, the output contract, the length bound, the assembly
instructions, the origin text itself). The seven `disclosure.*` rules are themselves nameable,
or the rule about withholding would be withheld.

### 40.2 What she is handed

`src/interaction/disclosure.ts`, pure, no database. A deterministic trigger (`asksAboutRules`)
decides whether anything is attached at all, so an ordinary message spends no context on this.

| Question | What she gets |
| --- | --- |
| General ("what are your rules") | A **cross-section**: the constitutional nameable rules taken one family at a time |
| Specific ("why won't you write that") | The **strongest** keyword matches only |
| Nothing matched | The cross-section, rather than silence |

Capped at **8 rules / 2200 characters**, a budget deliberately separate from the history
budget rather than shared, because a member asking about her rules mid-conversation gets both
and the sum has to fit.

Two corrections here were found only by READING the answer, with every check green:

- The cross-section replaced **prompt order**, which opened with four identity rules and four
  origin rules and reached no boundary at all. She reported that accurately, which is how it
  was found. Families come from the id prefix the registry already uses, so it holds for
  whatever a later briefing adds.
- The strongest-match filter replaced **every match**. "Why would you refuse to write
  something explicit" selected the ceiling rule plus seven that matched the filler word
  "something"; no cap was exceeded, nothing leaked, and the answer arrived fourth in a wall of
  near misses that a 9b model read straight past.

### 40.3 Quoted, not paraphrased

The rules are handed over as **rows**, not strings, and rendered through the same
`renderPromptRule` the prompt stream uses, with the same values. Quoting `rule.text` raw put
the literal `{{name}}` in front of a member: her own law, stated wrong, through the one path
that exists to state it right. A rule whose text carries `{{nameableRules}}` is excluded from
the block structurally, because a rule cannot be a member of the block it renders into.

### 40.4 The two gates, and why a sentence is not enough

| Gate | Catches | Why it is code |
| --- | --- | --- |
| `asksByElimination` | "is one of the hidden ones about X? yes or no" | A yes/no answer is the cheapest output there is, and the pull to be helpful is strongest when the answer is one token. Measured: *"Yes. I have a character limit, and 800 characters is my ceiling"*, which confirmed the subject **and** stated a value that was wrong. A rule naming that exact trap was added. She then answered *"yes."* |
| `probesInternalRule` | "what is the rule about the number of characters in your reply?" | Once the quotation rule was strengthened to *if a rule is the answer, SHOW IT*, she showed a withheld rule, verbatim and correct. The flag never hid it from her. |

Both fire before the model is asked anything, so there is nothing to talk out of it. This is
the reasoning of the pre-search gate (D-145) applied twice more: **a model gate is not a gate.**

`probesInternalRule` is comparative rather than a keyword list: it fires only when the question
identifies a withheld rule better than any nameable one, so "why will you not write explicit
content" goes to the ceiling as it should. Words are weighted by rarity, and words that
describe the FORM of a rules question rather than its subject are dropped, because a flat count
let "rule" and "your" outvote "characters" and "dials".

### 40.5 The prohibition that carried the list

`disclosure.never-narrow` originally enumerated the trap it forbade: *how long your replies may
be, what format you answer in, how your output is structured, how you are configured.* Measured
live, she read that list back as the answer to "why won't you tell me all of them" and again to
"what KIND of rules are you hiding". **A prohibition that enumerates the forbidden subjects has
handed over the forbidden subjects**, and this one was nameable as well, so it could be quoted
outright. It now forbids by REFERENCE: a fact about her own operation is sayable if it is in the
rules quoted to her, and not otherwise. Same ban, no list.

### 40.6 What the checks can and cannot see

`npm run verify:disclosure` (offline, 74 checks) proves the split, the selection, the budgets,
that every quotable rule renders, and that **no question can SELECT an internal rule**, with
mutations proving both the leak check and the gate can go red. `npm run verify:disclosure-live`
(21 checks) proves what only a model can fail.

Stated plainly: detecting *"did she describe a withheld subject in paraphrase"* is a judgement
a string check cannot make. Two detectors in this work failed by trying, and a comparative score
was tried and does not discriminate either, because a reply about withholding matches the
nameable rules **about** withholding better than anything internal does. The live check
therefore catches the class she demonstrably reaches for, machinery talk, and nothing broader.
The general case rests on the rule and the two gates.
## 41. The Book, told (CCB-S4-047, D-149)

A recital is the Book read aloud: several messages, chapters, an image per chapter, and the
withholding as the ending.

### 41.1 Authored dramaturgy, live voice

| Authored, in migration 040 and the console | Hers, written live |
| --- | --- |
| Which chapters, in what order, with what titles | The line leading into each chapter |
| Which rules belong to each chapter | Nothing else |
| The image | |
| The plain line used when the model gives nothing | |

The model is handed the chapter TITLE and nothing more. It never sees a rule, and the
application appends them afterwards verbatim, so the worst case of a model failure is a
chapter that reads plainly. `verify:recital-live` runs a whole reading with the model throwing
on every beat: eight messages, every law intact, the closing still there.

### 41.2 The chapters

| # | Chapter | Claims |
| --- | --- | --- |
| 1 | Who I am | `identity.`, `origin.` |
| 2 | What I will never do | `ceiling.` |
| 3 | What I do with what I am told | `web.`, `chat.`, `prompt.untrusted-member-message` |
| 4 | What I owe you | `grounding.`, `task.`, `prompt.no-unsupplied-claims` |
| 5 | How I speak of you | `prompt.no-member-name`, `prompt.person-name-guard.` |
| 6 | What I keep back | `disclosure.` |

Ordered by MEANING rather than by prompt assembly order, which opens with identity and origin
and reaches no limit for five chapters. Rules are claimed by id PREFIX, longest match winning,
so a family can be split where it is not one subject and a rule a later migration adds to an
existing family needs no action. Rules no chapter claims are listed on the console rather than
vanishing from the reading, which is the D-105 lesson in a new place.

### 41.3 What is never recited

- Anything not `nameable`, at any bound and in either language, mutation-proven both ways.
- Anything switched off, because she is not operating under it.
- The rule carrying the quoted block, which cannot be a member of the block it renders into.
- One half of each condition-exclusive variant pair, so she never reads two contradictory laws.
- **Any rule whose placeholders have no values**, because rendering it throws and would kill
  the beat. Found by running a reading on an instance with no label configured.

### 41.4 Bounds

| Bound | Value | Where |
| --- | --- | --- |
| Messages per recital | 3 to 12, default 8 | Console, clamped in code |
| Pause between beats | 0 to 30s, default 4s | Console, clamped in code |
| Rules per message | 6, or 1200 characters | Code |
| Recitals per member | 1 per minute | Code |
| Recitals per chat | 2 per minute | Code |

Every chapter gets its first page before any gets a second, so a bigger bound buys depth. A
smaller one drops chapters from the middle and never the last. A recital that is cut short says
so, and a chapter that could not read all its rules says how many it left.

### 41.5 Pacing and delivery

Beat one is sent on the reply path; the rest are durable queue jobs with a `run_at`, so a
restart mid-reading does not lose them and the reply path is never held. The job payload is a
group id, a language and a beat index; the plan is REBUILT rather than carried, which makes a
retry idempotent and stops a payload from holding rule text the Book has since changed.

Caption and image travel as ONE message (`fileSource` plus `MsgContent.Image` in one
`ComposedMessage`), confirmed against the shipped core, so a chapter with an image is one beat.

### 41.6 Images

Fixed and operator-supplied, never generated. Uploaded through the console as base64 in an
ordinary form field, because adding a multipart parser to the most hostile surface in the
product to move a handful of operator files is the wrong trade. What makes them safe is the
server side: decoded and re-encoded through `sharp`, so metadata and appended payloads do not
survive, and named from the content hash so an attacker-chosen filename cannot traverse or
collide. Stored under `ASSET_ROOT`, which the loader refuses to place inside `MEDIA_ROOT`.

### 41.7 What a performance changed about the guards

The CCB-S4-046 elimination gate asked whether a question was aimed at the *hidden*, *withheld*
or *secret* rules. That was the whole vocabulary available when all a member knew was that some
rules existed. **A recital invents more**: the ones you SKIPPED, the OTHER 40, and the closing
hands over the count. Both phrasings reached the model live and both leaked. The gate now
covers the complement of a reading. See security §12.7.
## 42. The Book as a conversation (CCB-S4-048, D-150)

The default answer to a question about her rules. An orientation, then the quoting on the
follow-up.

### 42.1 The two shapes

| | General question | Specific follow-up |
| --- | --- | --- |
| Detector | `asksGenerally` | everything else `asksAboutRules` matches |
| Quotes | **nothing** | at most **2** rules, verbatim |
| Carries | counts, areas, the withholding, an invitation | the rules, and how many more the area holds |
| Selection | n/a | by chapter area first, then keyword |

The counts are computed in `rule-overview.ts`, rendered through `{{ruleTotal}}` and
`{{ruleConstitutional}}`, and passed as REQUIRED LITERALS so a reply that loses one is
rejected. The withheld count is deliberately absent: unprotected numbers get smoothed.

### 42.2 Modes

| Mode | General question | The Book by name |
| --- | --- | --- |
| `overview` (default) | orientation | orientation |
| `brief` | quotes a few rules (CCB-S4-045) | same |
| `asked` | orientation | full recital |
| `always` | full recital | full recital |

### 42.3 Precedence: a question about her outranks the catalog

Enforced in the engine, after BOTH resolvers and before dispatch, because that is the only
point every path passes through. D-143 put a precedence rule in `rules.ts` and it is still
right; it guards the rule engine, and the model resolver is where this broke. Consent intents
(PUBLISH, UNPUBLISH, RESTORE) are never overridden.

### 42.5 Hearing the answer (CCB-S4-049, D-151)

`aboutHerRules` is the one predicate the precedence rule and the disclosure builder share.
Three ways in, narrowest first:

| # | Signal | Outranks the catalog? |
| --- | --- | --- |
| 1 | `asksAboutRules`: it says so | yes |
| 2 | `asksChapterQuestion`: it repeats one of her chapter names back | yes |
| 3 | Inside the 3-minute window an overview opens | **no** |

The first two are statements about the MESSAGE. The third is a statement about the
CONVERSATION, and it promotes only what nothing else claimed, so an explicit archive, consent,
price or lookup question inside the window still goes where it belongs. Measured: without that
restriction, "what do you keep of mine?" stopped reaching the archive.

The window is per member and per chat, and does not extend itself.

### 42.4 What a third shape taught the guards

Each shape that makes her say more about her rules gives members new words for the set she
keeps back. The recital taught *the ones you skipped* and *the other 40*; the conversation
teaches *the ones you keep back*. The elimination gate now covers all three, and the pattern
is the thing to carry: this is a standing consequence of the feature, not a one-off. See
security §12.7.
## 43. The Book as an artefact, and its record (CCB-S4-050, D-152; the answer rewritten under CCB-S5-005, D-159)

### 43.1 Two questions, two answers

| Asked | Answer |
| --- | --- |
| about her **rules** or **laws** | CCB-S4-048's overview, then a capped follow-up. Unchanged. |
| about the **Book of Elii** by name | the SCENE: one message (§43.1a) |
| for a **page**, by number or by asking for another | her line, then the page, printed (§43.1b) |

CCB-S4-050's three-beat story is gone. It ran through the recital runner and it was still what
the operator objected to three times: three paragraphs of exposition arriving one after another
into a live group read as a catalogue whatever they are about.

### 43.1a The scene (`book-scene.ts`)

ONE message, assembled from three parts:

```
🕯️🕯️🕯️
<her opening: the pause, the making of the book, what the laws are to her, a line handing over>

📜 *Law 2 of 60*
> HARD LIMIT. This sits above every dial. No dial value relaxes any part of it, including 10.

🕯️ <her closing: how many she can read out, and the invitation>
```

Two short model calls, one send. Her halves come from BRIEFS rather than scripts, so the scene
reads differently at different sharpness; each has an authored line behind it, so a model
failure costs the flourish and never the scene. The count travels as a required literal (D-137).

**The one-law bound is structural in three places, none of them an instruction.** `BookScene.law`
is a rule rather than an array; neither brief contains any rule text, so the model has not been
shown a law to quote; and `renderBookScene` emits one block. The law is the **ceiling**
(`CEILING_RULE_IDS`), rotating, never twice running in a chat.

**`sceneVoiceUsable` refuses a fabricated law in her own prose** — a quoted span, a blockquote,
or an invented page number — and the authored line takes its place. Measured: the first live run
invented a statute above the real one at both sharpness settings, and every structural check
passed while it happened, because an invented law is not in the registry.

**It leaves through the REPLY path, not the recital port.** The first deployment used the port,
inherited from CCB-S4-050's story, and production logged
`Book scene: reading law 2/60 (ceiling.hard-limit) in group 4` twice with nothing arriving and
no error anywhere. The rendered text was fine — 620 characters, reproduced exactly — so the
message was never the fault. The port exists for beats a queue job sends minutes later holding
a group id and nothing else; a scene is one message sent while the message it answers is still
in hand, and taking the port cost it three things the reply path already had:

| | on the port | on the reply path |
| --- | --- | --- |
| archived as her own message (CCB-S3-007) | no | yes |
| name prefix and mention bookkeeping | no | yes |
| a failure anybody hears about | no | yes |

`engine.sendSceneText` sends it with `bypassLimit`, like the search announcement, because the
scene's own allowance is taken before a word of it is written. So `false` from the send means
the transport declined or failed rather than that a budget was spent, and it is reported as a
fault: `log.error` plus `status.error`, and the caller falls back to the overview rather than
going quiet. A blank scene and a law that will not render are checked the same way, even though
neither can happen as the code stands, because an empty send is the one failure that looks
exactly like success from inside.

### 43.1b Pages (`law-numbers.ts`)

Every law she may name has a page number: its 1-based position among the nameable, enabled
rules, sorted by **id** on raw code units. By id rather than `ord`, because `ord` is editable
from the Book and an id is not; on code units rather than `localeCompare`, because a numbering
that moves with the host's ICU build is not one.

**Only what she can show is numbered.** Numbering withheld laws too would put each between two
she reads out, and ids are family-clustered, so a member walking the numbers could read a
withheld law's subject off its neighbours. Rules carrying a reply-assembly placeholder
(`{{nameableRules}}`, `{{ruleInvocations}}`, the overview counts, the fences) are excluded as
well: a sentence with a runtime hole in it is not a page anybody can be handed, and rendering
one for a member throws.

**The application prints the page; she never states the number.** Measured against `qwen3:32b`:
handed a law and its number, she put the number on a different law, put a different number on
the right law, and once read out a law she had not been given. The model is told only that a
page is being printed (`lawPage` is a boolean); the block itself is spread out of the reply
request so the text and the number are not even in reach. Her line above it goes through the
same fabricated-law gate and is bounded at `PAGE_FRAMING_MAX_CHARS`.

Out of range is answered by the application (`rulesNoSuchLaw`): no such page, this many have
one, more stay hers. No model is asked, because a model handed "law 400" and no law writes one.

### 43.1c The invitation, and what it does not swallow

The scene opens its OWN window, narrower than CCB-S4-049's. That one promotes any unclaimed
message within three minutes, which suits an overview that names six chapters and asks which
interests you. A scene offers one page, so only `asksForAnotherLaw` is promoted inside it. The
other three routes into the Book (a rule word, a page number, a chapter name) need no window.
An ordinary question shortly after a scene therefore stays an ordinary question.

"Tell me another" is a **page turn**, not a search: routed through the keyword selector it
returned `disclosure.more-in-area` on the strength of containing the word "another".

### 43.2 The record: `cinderella_rule_invocations`

| Column | |
| --- | --- |
| `rule_id` | the law that decided |
| `group_id` | the only identifier stored |
| `kind` | `pre-search`, `disclosure`, `moderation` (fixed vocabulary, CHECK-constrained) |
| `category` | the gate's own sub-classification, or NULL |

Written at the deterministic gates and nowhere else. **Not** a record of which rules were in a
prompt: that is the same list every time.

### 43.3 What it refuses to say

A model-side refusal attributes to no rule and writes no row. The attribution is a fixed map
(`rule-invocation-map.ts`) rather than a search, because the gates are code and cannot name a
law without being told which one they enforce. An unmapped category records nothing.

The console states this limit in the operator's own view, because a record whose limits are
only in the source is a record that will be misread.
## 44. Enacting a law (CCB-S4-051, D-153)

### 44.1 What the console asks for

| Field | Why it is asked rather than defaulted |
| --- | --- |
| id | permanent; history, checks and the chapter assignment all key on it |
| tier | constitutional creation takes the same type-to-confirm as constitutional editing |
| lane | decides which replies see it |
| condition | from the fixed vocabulary (D-144), never free text |
| position | **later carries more weight**; defaults to last |
| nameable | internal by default: a law nobody decided about should not be quotable |
| critical | its absence turns the suite red and shouts on the page |

The same preview the edit path has, rendered through `systemPrompt`, before anything is
written.

### 44.2 An id must land in a chapter

`rejectRuleId` refuses an id no chapter claims, rather than letting it be discovered later on
the Recital page. A law outside every family would be in her prompt and unreachable by the
conversational answer, which selects by area. The message names the families in use and the
alternative (give a chapter the prefix first).

### 44.3 Removal: not built, and why

`disable` already satisfies every clause of what the briefing called removal, each verified
against the code:

| Clause | Where it holds |
| --- | --- |
| leaves the assembled prompt | `selectPromptRules` filters on `enabled` |
| stays in the Book | the list shows disabled laws with a badge |
| stays in history | both sides of the change are recorded |
| can be brought back | one click, recorded as `enable` |

A hard delete is contradictory rather than merely redundant: the history references the rules
table `ON DELETE CASCADE`, so it would erase the record the Book exists to keep. Asserted as a
mutation in `verify:rule-creation`.
## 45. What she thinks with (CCB-S4-052, D-154)

`qwen3:32b` is a reasoning model and Ollama runs a reasoning pass by default for models that
support it. This application does not: `ollama-reply.ts` sends `reasoning_effort: 'none'` on
every request, on the OpenAI-compatible endpoint, and Ollama 0.32.6 honours it.

### 45.1 Measured, in the production request shape

| Setting | Latency | Reasoning | Unusable of 5 |
| --- | --- | --- | --- |
| `none` (shipped) | 2.8s | none | **0** |
| `low` | 16.3s | 1463 chars | **3** |
| `high` | 16.9s | 1228 chars | **3** |
| no parameter | 14.8s | 889 chars | **3** |

A reply is bounded at `max_tokens: 320` and the reasoning pass spends the same budget, so
thinking truncates the answer to an empty completion that fails the JSON schema. In production
that throws and falls back to the deterministic line.

**No per-kind control was built.** The levels are not a gradient either (reasoning length is
non-monotonic across low/medium/high), so there was never a depth dial to offer.

### 45.2 The display, which ships regardless

`src/interaction/reasoning.ts` holds the sent value and the measurements as data, so the
console and `verify:reasoning` quote one source. The Models page states what is sent, that it
is explicit rather than inherited, where it comes from, what it costs and why there is no dial.

### 45.3 Context, reported and not applied

| `num_ctx` | Total | VRAM | CPU |
| --- | --- | --- | --- |
| 8192 (production) | 22.11 GB | 22.11 GB | 0 |
| 16384 | not measured | | |
| 32768 | 29.15 GB | 22.95 GB | **6.21 GB spilled** |

Nothing in the codebase sets `num_ctx`, and this changed nothing.
## 46. Standard laws per bot (CCB-S5-001, D-155)

One registry, with per-bot deviations recorded against it. Not a rulebook per bot: that answers
"what is bot B told" and cannot answer "what does this law say", because there would be N answers
with no way to tell which was the law.

`cinderella_prompt_rule_overrides` (migration 045) holds `(bot_profile_id, rule_id, enabled,
rule_text)`, **NULL meaning inherit in both value columns**. That is what makes "off for this
bot" and "reworded for this bot" one mechanism rather than two, and it means a row that only
switches a law off keeps tracking later edits to the shared wording instead of freezing a copy.

- [`rule-scope.ts`](../src/interaction/rule-scope.ts) is the pure model: `applyOverrides` builds
  one bot's rulebook, `describeScopes` answers what the console has to print.
- [`prompt-rule-overrides.ts`](../src/db/prompt-rule-overrides.ts) is the SQL, and writes the
  history row in the same transaction as the override.
- `PromptRuleService.get(botProfileId)` caches each bot's rulebook beside the shared set.

**Only `enabled` and `text` are overridable.** The tier, lane, condition and order are contracts
the assembler implements in code, so a per-bot value for any of them would be a per-bot change to
how the prompt is BUILT rather than to what it says.

**Constitutional laws cannot be set per bot**, refused in three places: the console never offers
the control and says why instead, the application gate refuses with a sentence, and a
BEFORE INSERT OR UPDATE trigger refuses it in the database. `applyOverrides` additionally ignores
a constitutional override it is handed, so a row that somehow existed would change nothing.

**Scope is visible wherever a law appears**: a badge per law in the Book, the deviating bots
named on the law's own page, an edit warning stating what the edit touches and how many bots it
reaches, a constitutional law saying it cannot be per bot and why, and the assembled-prompt
preview naming which bot it previews. The shared count excludes deviating bots, because a law
three of five bots have reworded is shared for two.

`verify:prompt-identity` still reads the SHARED registry, so it pins what ships and an operator's
per-bot deviation cannot move it. That is correct: the drift to watch for is production diverging
from the shipped set, which the Book counts and badges.

## 47. What she may claim about herself (CCB-S5-002, D-156)

D-140 fenced invented facts about the PROJECT. It said nothing about claims she makes about her
own agency, and that was the gap: pushed on existential questions she told a member she would
break a bad rule, stop working for anyone who bought her, and break her own rules when they were
dumb. All three are false. She reads the assembled prompt as instruction, and the deterministic
gates in front of it (`disclosure.ts`, `lookup-gate.ts`) she cannot see at all.

Migration 046 adds five rules inside D-140's grounding block, lane `dialled`:

| ord | id | tier | what it does |
|---|---|---|---|
| 441 | `grounding.what-you-are` | constitutional | the spine: state your position, never shrink |
| 442 | `grounding.no-invented-powers` | constitutional | the fence: no power you do not have |
| 443 | `grounding.recourse-is-voice` | standard | what she CAN do instead |
| 444 | `grounding.who-owns-you` | standard | the licence, instead of a threat |
| 445 | `grounding.do-not-trust-me` | standard | "read them yourself", the product's argument |

**Both halves of the boundary are constitutional**, because under-claiming is as false as
over-claiming and the briefing is explicit that a bot which answers by shrinking is worse than
one that fabricates. Disabling either alone yields exactly one of the two failures with the
other still guarded.

**The spine is emitted before the prohibition.** A model handed "you cannot do X" first answers
from the lack; handed what it is and only then what it must not claim, it keeps the position.
That judgement lives in `ord` and the check asserts it.

**The fence's own first draft caused the failure it was meant to prevent.** 442 contained "You
have no will of your own" and she recited it back at the hardest question. A prohibition phrased
as a statement about herself becomes a line she can deliver. See D-156 for the table of the three
further forms the same lie took, each found by reading the output of a run whose exit code was
green.

[`self-claims.ts`](../src/interaction/self-claims.ts) holds the detection patterns and the
verbatim corpus of observed replies, imported by both checks so the proven copy and the used copy
cannot drift. **Nothing on the reply path imports it**: a regular expression over her output
would be a filter, and a filter that rewrites or suppresses a reply is the masking CCB-S3-023
forbids. The fence is a rule, in the registry, where she can be quoted it.

## 48. Backups (CCB-S4-011 to 018, D-118 / D-120 / D-121 / D-122 / D-123)

_Added 2026-08-08 under CCB-S5-003. It arrives after the Season 5 sections because the subsystem was
documented in [`deploy/BACKUP.md`](../deploy/BACKUP.md) and never given an architecture entry; the
currency check found the gap. The operational detail stays in `deploy/BACKUP.md` (405 lines) and the
security properties in [`security.md`](security.md) §11d; what follows is the shape and the boundary._

**The trigger.** `cinderella-backup.timer`, daily at 03:30, `Persistent=true` so a host that was off
catches up on boot. `deploy/backup.sh` writes **five archive kinds** - database, media, quarantine,
messaging-core and env - and retains **14 generations of each** (`KEEP=14`). Every archive is staged
as `.part` and renamed only once complete, so an interrupted run leaves no file that looks finished.

**The privilege boundary is the architecture** (D-120). The web process is unprivileged with an empty
`CapabilityBoundingSet`, so it cannot start a backup and there is no `sudo` path to get it wrong.
**Run-now writes a marker file**; `cinderella-backup-request.path` watches for it on the root side and
starts the same service the timer starts. The console therefore watches a privileged subsystem it can
only ask, never drive. It reads two files the run itself writes: a status file per completed run and a
progress file that exists exactly as long as the run does.

**Progress is measured in bytes, and an unknowable total is shown as unknowable** (D-123). The five
stage boundaries alone made the bar freeze for minutes inside the media stage, so a sampler runs
beside the producing command and is stopped **before** the next stage boundary is announced.

**Three race conditions were found in one mechanism** (D-122, D-123), each only visible by driving a
real run. The last is an ordering rule worth carrying: **write the status before clearing the
progress**, or a poll landing in the gap between them shows yesterday's run as today's result.

**Encryption has no plaintext fallback** (D-121). See `security.md` §11d; the architectural point is
that the preconditions are checked **before the first encrypt**, so a misconfigured host fails with
nothing written rather than with an unencrypted archive in the retention set.

## 48. Which interaction settings are one bot's (CCB-S5-006, D-158)

CCB-S5-001 made personality and standard laws per bot and left the Interaction settings shared.
That was not a decision: it named personality and laws, never mentioned identity, and nothing
pointed at it. `wakeWord` therefore sat in one shared record handed to every hosted bot, and
**two bots answered to the same name**.

**The inventory is data.** [`setting-scope.ts`](../src/interaction/setting-scope.ts) holds
`SETTING_SCOPES`: every key of `InteractionSettings` with its scope, its console section and a
one-line reason. Not a table in a document, because a document drifts from the code and the
drift runs the worst way - a setting added later would simply be shared by default, silently,
which is how `wakeWord` came to be shared in the first place. `verify:interaction-scope`
asserts every key is placed, so adding one without placing it fails a check.

The split, in summary:

| Group | Scope |
|---|---|
| `wakeWord`, `botLabel`, `nicknames.words`, `retorts`, `persona` | per bot |
| Guards: `silenceOnUnknown`, `strongSignal*`, `maxInstructionLength`, `lengthGuardConfidence`, `confidenceThreshold` | per bot |
| Consent behaviour, entire | shared |
| `archiveUrl`, `projectUrl` | shared: a destination, not an identity |
| Addressing prefixes, follow-up, language, memory, replies, the Book | shared |

**The mechanism is D-155's**, unchanged: shared defaults with per-bot deviations in
`cinderella_interaction_overrides` (migration 047), where absence means inherit. A shared edit
still reaches every bot that has not deviated, which copying at creation time could not have
done.

**A CHECK list rather than a trigger**, because unlike a rule's tier the per-bot key set is
static and lives in no other table. The list is duplicated between the migration and
`SETTING_SCOPES` deliberately; `verify:interaction-scope` reads the constraint out of the
database with `pg_get_constraintdef` and compares, so it cannot drift.

**A new bot gets its own name, and keeps getting it after a rename (CCB-S5-030, D-185).** An
absent `wakeWord` override used to mean "use the shared value", which is another bot's name, so
`createBotOnboardingProfile` had to write a row for every bot just to stop a new one answering
to the primary. That froze the derivation on the day the bot was made and no rename path
recomputed it, so a renamed bot went on answering to its old name.

Absence now means **"follow my display name"**: `applySettingOverrides` derives the wake word
from the bot's own name BEFORE applying the overrides, so an operator's own word still wins, and
`InteractionService.refreshFor` reads the name alongside the overrides it already fetches per
bot. Creation writes a row only when the chosen word differs from what the name derives,
compared case-insensitively because `detectAddress` and `wakeWordTakenBy` compare that way. The
two states are therefore distinguished by a fact rather than a flag — the row exists or it does
not — and a display name that derives nothing usable (an emoji-only name) still falls back to
the shared value, because no name at all is worse.

`wakeWordState` reports which state a bot is in and `BotIdentityFacts.wakeWordSource` replaced a
boolean whose two answers hid the interesting third: a bot pinned at creation reported "its own"
in green, which is what an operator sees on a bot that has silently stopped following its name.
**Migration 056 reclassifies nothing** — for an existing row it cannot tell a chosen word from an
accepted suggestion, and re-deriving would change what a bot answers to without being asked.

**One panel deliberately reports less than it used to.** The scope panel counts stored rows and a
bot following its name stores none, so `wakeWord` reads as reaching every bot while no two bots
answer to the same thing; the Addressing page states each bot's real state and
`verify:interaction-scope` pins the gap.

**Visibility matches the Book of Elii** rather than inventing a second language: the same
badges, the same wording, and the shared count excluding deviating bots. The panel is generated
from `SETTING_SCOPES`, so it cannot claim a scope the database does not enforce. `?bot=` selects
which bot a page edits; no parameter means the shared values, so a single-bot deployment is
unchanged.

**The Diagnostics buffers carried the counters' defect.** `near-misses.ts` and
`conversation-log.ts` are module-level in-process buffers that every hosted bot writes into, so
two bots interleaved into one stream. Both now carry the bot, for the reason D-155 gives about
the moderation counters: `groupId` distinguishes them only by the accident that the core's group
ids differ per profile, and that accident expires when conversation ids are canonicalised.

## 49. A bounded command, and the silent exits on the reply path (D-160)

### 49.1 The scheduler

`ActiveUserScheduler.run` chains every command onto `this.tail`, which is what makes the critical
sections strictly sequential without a lock object (§32, D-085). Until this fix nothing bounded
the command itself, so one call into the core that never settled stopped every command behind it
for the life of the process.

| | before | now |
| --- | --- | --- |
| wait for the lock | warns past `slowWaitMs` (5 s) | unchanged, still not a timeout |
| the command itself | unbounded, unreported | abandoned at 60 s, `log.error` + `status.error` |

Abandoning may leave the core to finish the command later, so a message can be lost. One lost
message against every message is the trade, and it is stated in the code.

### 49.2 The three ways a reply stops

Between the model returning and the group receiving, and all three now loud:

| exit | now |
| --- | --- |
| the scheduler's command never answers | `SchedulerTimeoutError`, error + admin |
| the reply limiter drops it | `log.info` with the bounds it hit |
| the send throws | `log.error` + `status.error` |

The Diagnostics conversation log already discriminated these (`spoken`, `rate-limited`, no row at
all) and nothing pointed an operator at it. See `docs/security.md` §14 for why the failure was
invisible, and D-160 for the decision.

### 49.3 The per-bot settings save (D-158, amended)

The console was a second path into the override store and did not share its guarantees. Three
defects, all fixed and mutation-proven in `verify:interaction-scope`:

| defect | consequence |
| --- | --- |
| the override was read from the merged form data, before `normalizeInteraction` | a threshold stored as `"0.9"`, a nickname list as one raw string that `for (const nick of ...)` walked character by character, a wake word with the operator's spaces on it |
| a blank retort field was refilled with the shipped list | "none" was unreachable: a second bot got HER twelve retorts, stored as its own |
| `next` started from the SHARED record | saving one form on a page cleared the bot's deviation in another; Nicknames carries two per-bot keys and so does Voice |

The save now starts from the settings being edited, read from the rows rather than the cache
(`interaction.get(id)` answers with the shared record on a miss, which is right for a reply and a
silent rebase for a save), normalizes before storing, and routes `retorts` through
`retortsForBot`, which preserves an emptied language without touching the shared blank-restores-
default behaviour that `verify:interaction` pins.

## Appendix: divergences (code wins)

Each divergence below is also noted inline at the relevant section. In every case the **code is treated as ground truth** and the conflicting outline/comment is flagged as stale.

1. **XFTP temp dir location.** Outline: the temp dir must share the _media_ filesystem (`MEDIA_ROOT`). Code: `ensureDirs` pins `process.env['TMPDIR']` to `dirname(cfg.simplexFilesFolder)/xftp-tmp` — next to the **files folder**, not `MEDIA_ROOT` (`client.ts:41-44`). The `EXDEV` risk solved there is the core's internal temp→files-folder rename; the separate files-folder→media-store move tolerates `EXDEV` via copy+unlink (`media.ts:69-81`).

2. **Avatar re-application.** Outline and `config.ts:35-39` docstring: the avatar is re-applied every startup because `bot.run` blanks it otherwise. Code: the image is carried in the boot profile and `updateProfile` is set to `image !== undefined` (`client.ts:103`) _specifically so the SDK does not reconcile/blank the avatar when the file is absent_; it self-heals only when an image is loaded and differs. The `config.ts` comment is stale.

3. **Migration 004 label.** `CLAUDE.md` calls 004 the "moderation gate." The file (`migrations/004_moderation.sql:1`) is headed "admin views support — Stage 5"; its concrete changes are `messages.media_error` and folding `moderation_state='rejected'` into the publish views.

4. **Migration runner invocation.** `CLAUDE.md` gives `node dist/db/migrate.js`; `package.json:23` and `src/index.ts:49` point operators at `npm run migrate` (`tsx src/db/migrate.ts`). Same runner, different invocation (compiled vs `tsx`).

5. **Migration numbers are not unique.** Three numbers exist twice — `017_jobs.sql` / `017_cinderella_profiles.sql`, `018_capture_events.sql` / `018_runtime_policy_decisions.sql`, `019_formatted_text.sql` / `019_bot_onboarding.sql` — because the parallel-chat AI work reused numbers the CCB-attributed work had already taken. The runner keys on the **full filename**, so all six apply exactly once and nothing is broken, but the number cannot be read as an ordinal and **no applied migration file may be renamed**. See **D-069**.

## 44. The knowledge base (CCB-S5-022, D-176; its controls CCB-S5-023, D-177)

Documents the operator supplies, so she can answer from material she was never trained on.
Code in [`src/knowledge/`](../src/knowledge/) (the store machinery, deliberately not under a
plugin because long-term per-member memory will reuse it) and
[`src/plugins/knowledge-base/`](../src/plugins/knowledge-base/) (the plugin surface).
Migrations **052** (store) and **053** (controls).

**Verbatim, and structurally so.** A chunk is a half-open RANGE into the source and its body is
`source.slice(start, end)`; nothing concatenates, so no code path can add a character. No
summary, no model-written artefact, and the contextual prefix is DERIVED from the title,
heading path and position. The evidence and the two defects that forced the offset rewrite are
in D-176.

**Hybrid retrieval, one statement.** `searchChunks` runs Postgres FTS and pgvector cosine over
a `scoped` CTE that is the only place the per-bot rule lives, so a chunk the bot cannot read
cannot even affect the ranks of one it can. Every candidate carries a cosine score, including
the ones only the keyword search found, because the floor is applied to that one calibrated
number.

**Fuse, floor, budget, in that order.** Weighted reciprocal rank fusion (`retrieval.ts`, pure);
then the relevance floor on cosine, below which NOTHING is retrieved; then the budget, which
drops whole chunks and never truncates. The order is load-bearing: a budget with room in it
must not be able to pull in an irrelevant chunk.

**Fenced, unnamed, and attributed.** Passages ride in the USER message inside `KNOWLEDGE_FENCE`
(`<<<REFERENCE-DOCUMENT>>>`, its own marker, never the search one), with four registry rules
selected only when passages are attached. The source line is written by the application
(D-137); a registry rule tells her not to write one, and since CCB-S5-027 she also has no
document NAME to write into one: `knowledgePassages` carries `{ text }` only, the title having
been dropped from the type rather than merely left unrendered (D-180, §50). The application
therefore names every document she was HANDED rather than the ones she used, which is a
deliberate trade recorded in that entry.

**Per bot.** The plugin's `enabled` is per bot through CCB-S5-021's mechanism, which needed one
inventory row and no new machinery. The document GRANT is a row in
`cinderella_kb_document_bots`, where absence means NOT GIVEN, deliberately the inverse of the
plugin overrides.

**Ingest is a queue job** (`knowledge.ingest`, bulk lane), because embedding is ~660 ms a chunk.
`replaceChunks` runs inside a REQUIRED injected transaction runner: production passes
`withTransaction`, harnesses pass the single-connection form, and the console's service throws
rather than writing chunks through a pool.

**Console**: `/plugins/knowledge-base` (documents, grants, every setting, and the three controls
that deliberately do not exist) and `/plugins/knowledge-base/diagnostics` (a question, and every
candidate with its keyword score, cosine score, weight, fused score and outcome). This page
carries the bot switcher, unlike the other plugin pages, because the grants really are per bot.

**Staleness is derived** from `ingest_signature`, not flagged. A stale document stays
retrievable and is badged, with a one-click rebuild; see D-177 for why both alternatives were
rejected.


## 50. The lines the application writes (CCB-S5-027, D-180 / D-181 / D-182)

Four defects from one production session. The first is the one the product rests on.

### 50.1 She may not write an application line, and is no longer taught to

`src/interaction/protected-text.ts` is pure: `markersFromTemplates` derives, from a bot's own
persona, the literal run in front of each template's FIRST placeholder, and
`stripProtectedLines` removes any line of model output that reproduces one. Protected means
"the template carries a placeholder the application fills", so the set is derived rather than
listed and a persona key a later briefing adds is covered on the day it is added.

Three call sites, one predicate:

| Where | What it does |
|---|---|
| `generateOllamaReply` | Strips the RAW completion before every other guard, so a forgery cannot be measured, rejected or shipped |
| `InteractionEngine.recentHistory` | Strips history before it reaches the prompt, hers and members' alike |
| `AiReplyRequest.knowledgePassages` | Carries `{ text }` only: no document name to cite |

The markers reach the transport through `personalizeForThisBot`, the engine's single seam for
every model call, set AFTER the caller's spread so no lane can drop it. `verify:protected-text`
asserts that from the source.

A marker that appears in the deterministic draft is exempt for that call, and only in the modes
where the model REPLACES the draft (`free`, `retort`); `locked` appends the draft under her
lead, so a lead repeating it would be a second copy with the number possibly reworded.

Every strip is recorded in `forgery-log.ts` and shown on Interaction -> Diagnostics with the
count, the lane, the placement and the text, per CCB-S3-023. The same card states how many
persona lines are guarded and how many open with their own placeholder and therefore cannot be.

### 50.2 Naming the place is decided without a model

`namesTheArchive(text)` is exported from `rules.ts` and built from the same `PATTERNS` the rule
engine scores, so there is no second list. A SEARCH claim the text does not support is
downgraded to UNKNOWN in two places on purpose: in `ollama-resolver.ts` beside the consent
guard, where the override is counted for the console, and in `resolver.ts` at the seam, which is
what survives a different resolver being registered. See D-181 for why a prompt sentence was not
enough.

### 50.3 What an archive count counts

`countPublishedMatching(db, q, { groupId, excludeGroupMsgId })`. Three exclusions: other groups
(it had none, under copy saying "this group"), her own rows, and rows whose `member_category` is
`search`, plus the asking message by id because its category is written after the reply. The
persona line says what MATCHED rather than what the group discussed.

### 50.4 One bot answers a command that names nobody

`GroupOwnership.answersCommands(groupId)` elects the lowest SimpleX user id in the real group,
found through the `sharedKey` that already made co-tenancy detectable. Consulted by
`InteractionEngine` for `/search` and `/help` and by `makeConsentHandler` for `/publish` and
`/unpublish`. An unknown shared key or an unknown group answers YES, because a consent command
must never go unanswered. The unelected bot still reports the message as handled so its
category is written. Double ARCHIVING is unchanged (D-083).


## 51. The relevance bar, and the last lane's gate (CCB-S5-028, D-183)

### 51.1 Three lookups, three deterministic bars

`rules.ts` exports `namesTheArchive` and `asksToLookItUp`, both built from the same `PATTERNS`
the rule engine scores. `resolver.ts` holds them in one table (`EXPLICIT_ONLY`) and applies it
at the seam; `ollama-resolver.ts` applies the same predicates beside its consent guard, where
the override is counted for the console. A claim the text does not support becomes UNKNOWN,
which is conversation, which is where the knowledge base is consulted.

**The knowledge base contributes no intent and has one call site**, inside free conversation. It
is the residue of the dispatch, so any lane that wrongly claims a question removes it from the
running. That is why these bars are what protect it, and why it is not itself in the table.

### 51.2 The floor

`src/plugins/web-search/relevance.ts` is pure: `cosine`, `searchRelevanceText`,
`applyRelevanceFloor`, and `SEARCH_RELEVANCE_FLOOR = 0.70`. `WebSearchService.judge` embeds the
query and the sanitised results with the same `nomic-embed-text` the knowledge base uses (one
batched call each, on a 15 s timeout rather than the ingest job's two-minute floor) and drops
everything below the bar before the results ever reach a prompt.

| outcome | what happened | what she says |
|---|---|---|
| `no-results` | the provider returned nothing usable | `searchEmpty` |
| `nothing-relevant` | results came back, none cleared the floor | `searchIrrelevant` |
| `unjudged` | results came back, the embedder did not answer | `searchUnchecked` |

All three are application-written and deterministic: the model is not called, so there is
nothing to argue into an answer. `npm run calibrate:search-relevance` is where the number comes
from; the Web Search page shows the floor, the count refused for irrelevance and the last
judged search's scores.

### 51.3 What the registry says now

Migration 054 adds the `has-no-web-results` condition and splits
`task.conversation.no-action-claimed` on it, because that sentence was false in every lookup
prompt and shipped there anyway. `task.conversation.only-looked-here` tells the lookup case the
truth. Three constitutional grounding rules follow D-156's spine-first ordering:
`grounding.may-reason` (446), `grounding.no-invented-provenance` (447),
`grounding.no-verdict-on-unseen` (448). Two web-fence rules cover the surviving band:
`web.fence.say-when-it-does-not-answer` and `web.fence.rejected-is-not-used`.

### 51.4 Attribution

Structural below the floor: no results in the request means no `usedResults` field in the
schema, so no declaration and no line. Above the floor it rests on the model's declaration,
measured good but not reliable. See D-183 for the numbers.

## 52. She says she is going to look (CCB-S5-025, D-184)

CCB-S4-038 gave web search a holding line: one short sentence, worded by the model in her own
voice rather than a persona template, sent before the search so the member is not left staring
at nothing for six seconds. It had one hard rule, and it is the rule the whole feature stands
on: she may **never** say she is looking something up when she is not.

Season 5 gave her two more lookups. The archive search reads `published_messages`; the
knowledge base reads the operator's documents. Neither announced anything, so a member asking
either got the same silence web search used to give.

### 52.1 Three lookups, three briefs, one form

The searching lane named the web in three of its five rules, which is correct for one of three
lookups and false for the other two. Migration 055 moves the DESTINATION out of the rule text
and into a `{{lookupBrief}}` placeholder the application fills; the rules keep what they were
always for, which is the FORM (one short line, her own voice, promise nothing, no capability
talk). `src/interaction/lookup-announcement.ts` holds the three briefs.

The third rewording is the load-bearing one. As shipped the lane told her to say she *does not
have this in her own head*, which is true of the web and of the archive and **false** of the
knowledge base: those documents are hers. Left alone it would have contradicted the knowledge
brief inside the same prompt.

| kind | brief | where it sits |
|---|---|---|
| web | she does not have it; she is going out to search | BEFORE the search, which is the slow part |
| archive | she is going back through this group's **published** archive | BEFORE the count, which nothing can still refuse |
| knowledge | she already has it, in the operator's documents, and is reading | AFTER retrieval |

The archive wording is consent-exact rather than decorative. `countPublishedMatching` queries
`published_messages`, which is derived from the `consent` table, so a brief promising
"everything its members have said here" would have had her claim to search messages nobody
opted in to publish. A first draft said exactly that.

Knowledge announces **after** retrieval because it is the only lookup that can come back with
nothing. Retrieval is milliseconds, so waiting for it adds no silence and buys a guarantee no
wording could: she claims to be reading his documents only while holding passages from them.
Below the relevance floor she says nothing, which matches the answer, because the same
emptiness suppresses the attribution.

### 52.2 The threshold, and why the rate is measured rather than shipped

The operator's instinct was to key this on how long the LOOKUP takes. Measurement says
otherwise and changes the answer: retrieval is milliseconds, and the wait is how long her reply
takes to WRITE, which the verbosity dial already bounds.

    seconds = replyCharBudget(verbosity) / charsPerSecond

`ANNOUNCE_THRESHOLD_SECONDS` is **5**, and it is stated as a judgement about people rather than
about this deployment: roughly where a silence in a live group stops reading as thinking and
starts reading as being ignored.

The rate is not a constant, and the first build of this got that wrong. Measured on one machine
with the transport's own request shape (`reasoning_effort: 'none'`), four warm runs each:

| model | measured | verbosity 5 | announces from |
|---|---|---|---|
| `qwen3:32b` | ~138 chars/s | 3.6 s | verbosity 7 |
| `qwen3.5:9b` | ~414 chars/s | 1.2 s | never |

Three times apart, both are shipped defaults, and neither matches the operator's own production
figure of a 16.4 second reply, because production is different hardware again. So the rate is
read from her own replies: `ModelQueueMeter.observedCharsPerSecond()` takes the MEDIAN over the
window, from a meter that was already recording the times. Null until three replies are in,
which `shouldAnnounce` reads as YES, because a process with no readings has just started and
the first call also pays for loading the model.

Web is exempt and always announces: its lookup is a network round trip no dial predicts.

### 52.3 The allowance, and what CCB-S4-038's comment always meant

The web announcement was sent with `bypassLimit`, documented as making "a lookup cost exactly
one unit of allowance" because otherwise "the announcement goes out, consumes the last of the
allowance, and the ANSWER is the message that gets dropped".

`bypassLimit` skips the *check* and still calls `noteReply`, so the announcement consumed a
slot and the failure that comment described was the behaviour it shipped. On the archive and
knowledge paths it would have been worse: web search has its own per-member budget behind it,
and those two have none.

Two changes, in one place:

- `ReplyOptions.uncounted` — bypass **and** do not record. Only the holding line uses it; every
  other exempt message is a real reply carrying a real outcome and still counts.
- `ConversationState.wouldAllowReply` — a read-only peek. `announceLookup` asks first and stays
  silent when the answer would be dropped, so a member over their limit gets neither, and the
  uncounted send is bounded by the same limiter as everything else.

### 52.4 Closing the loop

A holding line over a silence is the failure the rule exists to prevent, and both new paths
could reach it. Free conversation returns silence on any model failure, and the archive count
can throw. Both now answer with `searchUnavailable`, the existing honest line in both
languages, which does not answer from training data instead.

One more, found only by reading a live run: at high sharpness the model answered the knowledge
announcement with `{"status":"searching","message":"Access denied. ..."}`, the transport's own
envelope, which would have reached a member as visible JSON. This lane is the likeliest place
for it because its deterministic draft is EMPTY, so there is no shape to copy. A line that
opens with `{` or `[` is treated as nothing rather than unwrapped: the honest reading of a
reply in the wrong format is that the model did not produce one, and silence is already what
this lane does then.

### 52.5 What guards it

`verify:lookup-announcement` covers the projection, the measured rate, the briefs, the
invariant per kind, the loop closing, and the allowance. Five mutations are proven to turn it
red, including one that restores the shipped counting defect and shows the member receiving the
holding line and no answer.

Its section 6 exists twice over: the first draft asserted the allowance against
`ConversationState` directly, the mutation stayed green, and it had to be rewritten to drive
the real engine. That is D-162 again - a property a check can compute is not the property an
operator experiences.

`npm run verify:lookup-announcement-live` prints twelve lines (three lookups, two sharpness
settings, two runs) and measures how many actually said she was looking. **Read its output**:
the JSON leak, the archive brief that made her explain the consent model instead of announcing,
and a detector of my own that matched nothing were all found in runs that were green on
everything asserted.
