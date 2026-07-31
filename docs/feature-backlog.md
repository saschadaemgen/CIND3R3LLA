# Cinderella — Feature Backlog

> _Living document — Cinderella, Seasons 1–4. Ground truth is the code in this repository; where an earlier briefing outline diverged from the code, the divergence is noted inline. Maintained under the CCB briefing scheme; last updated under **CCB-S4-003**._

Cinderella's living record of what is built, what is scoped for Season 2, and what is
waiting on the operator. **The code is the source of truth.** Every "Done" item below
is anchored to a file and, where useful, a line. Where the planning outline and the
code disagree, the divergence is called out inline.

Season boundaries follow the close-out briefing CCB-S1-017
([`seasons/SEASON-1-PROTOCOL.md`](../seasons/SEASON-1-PROTOCOL.md)). The unit of work
is the **Season**, numbered from 1; the older "Stages 0–7" framing is deprecated (it
survives only in historical task labels and in-code comments).

---

## Done — Season 1 (built and verifiable in code)

### Capture pipeline — text, image, video, voice, link, file

- [x] **Six-way type taxonomy** — `CapturedType = 'text' | 'image' | 'video' | 'voice' | 'link' | 'file'` and the classifier that maps SimpleX `MsgContent` discriminants onto it. Note `chat`-type content (a SimpleX chat link) is folded into `link`. See [`src/capture/message.ts:13`](../src/capture/message.ts) and `classifyType` at [`src/capture/message.ts:64`](../src/capture/message.ts).
- [x] **Event wiring** — `newChatItems`, `chatItemUpdated` (edits overwrite so pre-edit text is never left published), and both in-group deletion events (`groupChatItemsDeleted`, `chatItemsDeleted`) are handled in [`src/capture/handler.ts`](../src/capture/handler.ts). Capture can be scoped to a single stable numeric group id.
- [x] **Media on disk, path in DB** — received files are moved into `MEDIA_ROOT`; the DB stores the relative posix path, mime, and size — never the bytes. Cross-device (`EXDEV`) rename falls back to copy+unlink (the fix confirmed live in CCB-S1-010). See [`src/capture/media.ts`](../src/capture/media.ts).
- [x] **Schema** — `messages` (with a generated `search` `tsvector` + GIN index, `simple` config) and `links`, in [`migrations/001_init.sql`](../migrations/001_init.sql). Full-text-search infrastructure (Postgres FTS + a `links` table) exists at the schema level; no public search UI is wired yet (that ships with the Season 2 web front).

### Consent gating — the one rule

- [x] **`/publish` / `/unpublish`** parsed as exact ASCII commands and recorded against the **stable member id** (never the display name); commands are treated as control messages and are **not** persisted as archive content. See `parseConsentCommand` in [`src/consent/commands.ts:19`](../src/consent/commands.ts), consent-command detection at [`src/capture/handler.ts:102`](../src/capture/handler.ts), and dispatch through the `onCommand` hook at [`src/capture/handler.ts:125`](../src/capture/handler.ts).
- [x] **Derived publish state** — publication is computed, never a stored flag, by the `message_publish_state` / `published_messages` views. A row publishes only when it is not admin-`deleted`, not `group_deleted`, `moderation_state <> 'rejected'`, the sender has an unrevoked `consent` row, and `sent_at >= opted_in_at` (forward-only). Introduced in [`migrations/002_consent.sql`](../migrations/002_consent.sql), then recreated to add the moderation gate in [`migrations/004_moderation.sql`](../migrations/004_moderation.sql) and the `group_deleted` split in [`migrations/005_deletion_provenance.sql`](../migrations/005_deletion_provenance.sql).
- [x] **Deletion provenance split** — `group_deleted` (set only by in-group deletion, never clearable from the console) is separated from admin `deleted`, so an operator can never undelete a member's group deletion back into publication. See [`migrations/005_deletion_provenance.sql`](../migrations/005_deletion_provenance.sql).
- [x] **Consent-first welcome / notice** — the verbatim group welcome (`WELCOME_MESSAGE` at [`src/consent/commands.ts:48`](../src/consent/commands.ts)) and the `/publish` / `/unpublish` confirmation replies (`PUBLISH_REPLY` [`:26`](../src/consent/commands.ts), `UNPUBLISH_REPLY` [`:32`](../src/consent/commands.ts)) live in [`src/consent/commands.ts`](../src/consent/commands.ts).

### Admin console — dashboard, messages + takedown, consent, settings, embeds

- [x] **Server** — Fastify bound to `127.0.0.1` only (nginx TLS in front, listen at [`src/web/server.ts:243`](../src/web/server.ts)), `trustProxy: 'loopback'` ([`src/web/server.ts:82`](../src/web/server.ts)), CSRF on all mutations, per-request IP-access and rate-limit hooks, security headers on every response. See [`src/web/server.ts`](../src/web/server.ts).
- [x] **Dashboard** — [`src/web/views/dashboard.ts`](../src/web/views/dashboard.ts) (`GET /`).
- [x] **Messages browser + manual takedown** — filters by type/published/deleted/time; takedown sets `moderation_state = 'rejected'`, restore clears it back to `'none'`, mark-deleted/undelete on the admin `deleted` axis, all audited; in-group deletions cannot be restored (409). See [`src/web/views/messages.ts`](../src/web/views/messages.ts) (routes `/messages`, `/messages/:id/takedown`, `/restore`, `/delete`, `/undelete`; the 409 guard at [`src/web/views/messages.ts:363`](../src/web/views/messages.ts)).
- [x] **Consent viewer** — [`src/web/views/consent.ts`](../src/web/views/consent.ts) (`GET /consent`).
- [x] **Settings** — live-editable operator settings persisted in the `settings` table (secrets stay in env). See [`src/web/views/settings.ts`](../src/web/views/settings.ts) and [`migrations/003_admin.sql`](../migrations/003_admin.sql).
- [x] **Embed management (admin side only)** — instance CRUD, theme/layout/filter/media-type config, and the copy-paste iframe snippet generator. See [`src/web/views/embeds.ts`](../src/web/views/embeds.ts). **The public endpoint the snippet points at is not built — see Season 2.**
- [x] **Audit log** — every state-changing action recorded (actor/action/target/details) in `audit_log`. See [`migrations/003_admin.sql`](../migrations/003_admin.sql) and [`src/db/audit.ts`](../src/db/audit.ts).

### Appless passkey security + hardening

- [x] **Passkeys (WebAuthn) as primary auth** with an Argon2id break-glass path and optional TOTP; counter-regression auto-locks a credential (cloned-authenticator signal — the `locked` column). Schema: [`migrations/006_webauthn.sql`](../migrations/006_webauthn.sql). Routes/ceremonies: [`src/web/security/routes.ts`](../src/web/security/routes.ts) and [`src/web/security/webauthn.ts`](../src/web/security/webauthn.ts).
- [x] **Full A4.5 hardening suite, admin-configurable and persisted** — passkey attestation policy, session idle/absolute timeouts, step-up for sensitive mutations, login rate-limit/lockout, global per-minute limit, IP allow/deny, configurable CSP + security headers, and webhook alerting (https-only URL validation). See [`src/security/settings.ts`](../src/security/settings.ts) and the enforcement hooks in [`src/web/server.ts`](../src/web/server.ts): security headers on `onSend` ([`:129`](../src/web/server.ts)), global rate-limit + IP allow/deny + session/auth guard on `onRequest` ([`:134`](../src/web/server.ts)), CSRF + step-up on `preHandler` ([`:172`](../src/web/server.ts)). Security page + TOTP enroll/enable/disable + logout-others: [`src/web/views/security.ts`](../src/web/views/security.ts).
- [x] **WebAuthn RP-ID/origin startup guard (CCB-S2-011)** — `loadAdminConfig` calls `validateRpConfig` so the server refuses to boot unless the effective `WEBAUTHN_RP_ID` matches the origin host (or a registrable parent), and logs the effective RP ID/origin — converting the silent passkey-lockout footgun into a loud config failure. See [`src/config.ts`](../src/config.ts), verified in [`scripts/verify-admin.ts`](../scripts/verify-admin.ts); rationale in decisions D-022.

### PostgreSQL-backed sessions

- [x] Sessions persist in the `admin_sessions` table so restarts/deploys no longer log the operator out; the signed cookie carries a stable id. See [`migrations/007_sessions.sql`](../migrations/007_sessions.sql), `SessionStore` in [`src/web/session.ts`](../src/web/session.ts), wired at [`src/web/server.ts:84`](../src/web/server.ts).

### Avatar

- [x] Set SDK-natively (image carried in the `bot.run` boot profile) and flushed to existing group members via a group message. Staging entry point: `npm run avatar -- <image>` → [`src/bot/set-avatar.ts`](../src/bot/set-avatar.ts); the running service applies it (`bot.run` + `updateBotUserProfile` self-heal) via [`src/bot/avatar.ts`](../src/bot/avatar.ts). The image path resolves from the `AVATAR_PATH` env (`resolveAvatarPath`, [`src/config.ts:121`](../src/config.ts)).
  > **Note:** the outline lists the avatar as Done and the code confirms it — SEASON-1-PROTOCOL records it delivered (CCB-S1-014/015, [`seasons/SEASON-1-PROTOCOL.md:57`](../seasons/SEASON-1-PROTOCOL.md)). The one stale point is that [`CLAUDE.md`](../CLAUDE.md) still files the avatar under "Parked (do not build now)" ([`CLAUDE.md:83`](../CLAUDE.md)). CLAUDE.md's stated invocation `npm run avatar -- <img>` is **accurate** — it matches the tool's own usage string ([`src/bot/set-avatar.ts:4`](../src/bot/set-avatar.ts)), which reads the image path from `process.argv[2]` ([`:22`](../src/bot/set-avatar.ts)); the npm script `"avatar": "tsx src/bot/set-avatar.ts"` ([`package.json:15`](../package.json)) forwards the `--` args to it. Treat the avatar as **done**; only CLAUDE.md's "Parked" placement is out of date.

---

## Season 2 — shipped and scoped

Season 2 is partly built: the **public embed front** (§1, CCB-S2-003…010) and the
**public marketing website** (§6, CCB-S2-012) have shipped; §2–5 remain scoped and
not-yet-in-code. Each item below carries its own status line — trust the per-item
status, not a blanket one.

### 1. Public embed front — the `/embed/<instance-id>` route

**Status: FOUNDATION SHIPPED (CCB-S2-003).** The SSR `GET /embed/:id` route, its
consent-gated media route `GET /embed/:id/media/:msgId`, server-side
type/time/full-text filtering via URL params, core SEO (title/description,
canonical, OG/Twitter, schema.org JSON-LD, indexable), and iframe auto-height are
built and verified ([`src/web/front/`](../src/web/front/),
[`src/db/public-archive.ts`](../src/db/public-archive.ts),
[`scripts/verify-public.ts`](../scripts/verify-public.ts)).

**The full SEO & marketing suite is SHIPPED too (CCB-S2-004):** per-instance
configurable structured data (the toggle-driven schema.org `@graph` — WebSite +
SearchAction, Organization, CollectionPage + BreadcrumbList / ItemList, postings,
ImageObject/VideoObject), `sitemap.xml` + sitemap index, admin-defaulted `robots.txt`,
per-instance meta (title template, description, keywords, canonical base, robots),
full OG/Twitter + operator/auto social image, an RSS feed, and a privacy-respecting
per-instance analytics hook (off by default, CSP-scoped — D-017). All admin-edited on
the embed instance, all consent-gated. See [`src/web/front/seo.ts`](../src/web/front/seo.ts).

**Theming shipped (CCB-S2-005):** the SimpleGo house palette with **dark by default**
and a persisting sun/moon visitor toggle (`sg-theme` localStorage, no-flash `<head>`
script, `theme-color` meta) — the first design-template switch. Instance `mode`
(auto/light/dark) sets the SSR default; operator accent/bg/text overrides still win.
See [`src/web/front/render.ts`](../src/web/front/render.ts).

**Stream polish shipped (CCB-S3-025):** the chat's own text formatting (`*bold*`, `_italic_`, `~strike~`,
`` `code` ``, `#secret#`) is carried into the stream from SimpleX's parsed runs, redaction-safe and
XSS-safe; the report control is a soft, tokenised destructive red (muted at rest, full on hover); each
card has a **script-free share bar** (X/Facebook/Reddit/WhatsApp/Telegram plain links + copy-link;
hover-revealed on desktop, permanent on touch; zero third-party load, no cookie-banner entry) pointing
at a new **stable, crawlable, canonical per-item permalink** `GET /embed/:id/m/:msgId` (consent-gated,
in the sitemap); and her own messages carry **attribution** linking her name + an editable
"(SimpleX AI Bot)" label to the repo. All per-instance configurable; chat-side attribution is a minimal
help-reply signature. See D-065, architecture §23. `src/web/share.ts`, `migrations/019_formatted_text.sql`.

**Live auto-update shipped (CCB-S2-006):** an open page keeps itself current with no
manual refresh — consent-gated polling as progressive enhancement over the unchanged
SSR/SEO. `GET /embed/:id/state` (published ids + a version hash) and
`GET /embed/:id/fragment` (the re-rendered list region) both read
`published_messages`, so a recalled item disappears (its media `404`s) and a newly
published one appears within one poll interval; the client pauses while the tab is
hidden and re-posts the iframe height after a swap. Adds `connect-src 'self'` to the
embed CSP and a per-IP rate limit on the two poll endpoints. SSE is the recorded
future upgrade; "immediately" means "within the poll interval" (D-018). See
[`src/web/front/embed.ts`](../src/web/front/embed.ts),
[`src/web/front/render.ts`](../src/web/front/render.ts).

**Inline video shipped (CCB-S2-008):** video plays inline in the card as a native
`<video controls preload="metadata" playsinline>` (was an "Open video" link opening a
bare file), house-styled + theme-aware, with a per-instance download button
(`player.showDownload`, default ON; OFF → hidden + `controlsList=nodownload`). The embed
CSP gained `media-src 'self'`; the consent-gated media route serves HTTP byte-ranges
(`206`/`Accept-Ranges`, after the consent gate) so WebKit plays inline + seeking works;
the copy-paste snippet's iframe grants `allow="fullscreen"` for the cross-origin fullscreen
button (D-019). See [`src/web/front/render.ts`](../src/web/front/render.ts),
[`src/web/front/embed.ts`](../src/web/front/embed.ts), [`src/db/embeds.ts`](../src/db/embeds.ts).

**Infinite scroll shipped (CCB-S2-007):** the stream pages the full archive on scroll by a
stable `(sent_at, id)` cursor (no offset drift), with DOM windowing (bounded memory), and a
live reconcile that coexists with CCB-S2-006 (recalled content disappears wherever it sits;
new head publishes prepend). New `GET /page` (cursor chunks) + ranged `GET /state?cursor=&top=`;
the `/fragment` route is retired. Deep content stays crawlable via `?page=N` SSR + `rel=next/prev`

- sitemap. Separate `/page` rate-limit bucket; SSE + full virtualization are future upgrades
  (D-020). See [`src/db/public-archive.ts`](../src/db/public-archive.ts),
  [`src/web/front/render.ts`](../src/web/front/render.ts), [`src/web/front/embed.ts`](../src/web/front/embed.ts).

**Content reporting shipped (CCB-S2-009):** a public per-item "Report" button (no-JS `<details>`
form) → `POST /embed/:id/report` (visible-until-review; published-gated with a neutral response, no
oracle; minimal-data keyed daily-rotating HMAC token, no raw IP; own rate limit + cross-site gate),
and an admin `/reports` grouped queue + open-count notification bar with audited take-down / resolve
/ dismiss. External e-mail/SMS/SimpleX alerts are an inert Settings placeholder (Part C). New
`migrations/008_reports.sql` + [`src/db/reports.ts`](../src/db/reports.ts),
[`src/web/views/reports.ts`](../src/web/views/reports.ts) (D-021).

**Remaining in Season 2:** a design editor, further templates, the Web Component, an
SSE transport for live-update, and SSR/media caching with publish-event invalidation.
The history below records the pre-CCB-S2-003 state.

- **What exists today (verified):**
  - `embed_instances` table ([`migrations/003_admin.sql:26`](../migrations/003_admin.sql)).
  - Admin CRUD + theme/layout/filter/media config + audit ([`src/web/views/embeds.ts`](../src/web/views/embeds.ts)).
  - The snippet generator `embedSnippet()` that emits `<iframe src="{publicOrigin}/embed/{instanceId}">` plus an auto-height `postMessage` listener ([`src/web/views/embeds.ts:24`](../src/web/views/embeds.ts)). `publicOrigin` comes from `AdminConfig.publicOrigin` ([`src/config.ts:62`](../src/config.ts)).
- **What is missing (verified absent):** there is **no `GET /embed/:id` route anywhere in the codebase.** A repo-wide search finds `/embed/<instance-id>` only in comments, the snippet string, and season/schema docs — the only registered routes are the admin `/embeds` family. The iframe the operator can already copy today points at an endpoint that returns nothing. The source says so explicitly: "The public `/embed/<instance-id>` route and the widget rendering itself are a later season" ([`src/web/views/embeds.ts:5`](../src/web/views/embeds.ts)); "The `/embed` route goes live with the public-front season" ([`src/web/views/embeds.ts:265`](../src/web/views/embeds.ts)); and the schema comment "The `/embed/<instance-id>` route and widget rendering are a later season" ([`migrations/003_admin.sql:24`](../migrations/003_admin.sql)).

  > This matches the outline's suspicion exactly: the embed **admin settings** exist, the **public `/embed` endpoint is not implemented.** Season 2 must add the route that resolves an instance id → its settings → the `published_messages` projection and renders the widget (plus the Web Component, per [`CLAUDE.md`](../CLAUDE.md)).

- [x] Implement `GET /embed/:id` serving published content, honouring per-instance theme/layout/filters/media visibility. **(CCB-S2-003)**
- [x] Live auto-update — consent-gated `state`/`fragment` poll endpoints; recalled content disappears and new content appears without a manual refresh. **(CCB-S2-006)**
- [x] Inline video player — native `<video>` with controls/fullscreen, byte-range serving, per-instance download toggle (default on). **(CCB-S2-008)**
- [x] Infinite scroll — cursor pagination, DOM windowing, crawlable deep pages (rel=next/prev + sitemap); coexists with live-update. **(CCB-S2-007)**
- [x] Loading polish — kill the iframe scrollbar flash (`html.embedded{overflow:hidden}` before paint), house-themed skeleton loader (shimmer, reduced-motion safe), card fade-in, no viewport shift on append/windowing. **(CCB-S2-010)**
- [ ] Render the widget (and the parked Web-Component wrapper).

### 2. Command & moderation system

- [ ] Private join + consent flow over the member-support scope (knocking → private greeting → `/publish` → accept).
- [ ] Role-gated moderation with confirmation and audit.
- [ ] Admission hardening: knocking + bot-generated captcha + observer-by-default.
  > Hook already in place: the `moderation_state` enum is defined ([`migrations/001_init.sql:9`](../migrations/001_init.sql)) and enforced _negatively_ by the publish views and the manual takedown button, but nothing drives it automatically — every captured row stays `'none'` until this track is built (comment at [`migrations/001_init.sql:7`](../migrations/001_init.sql)).

### 3. Local AI brain over a tunnel

- [~] Integrate the operator's local model over a secure tunnel, decoupled behind a single "AI endpoint" address; the bot forwards free-form private messages and returns replies, while commands stay deterministic (source: [`seasons/SEASON-1-PROTOCOL.md`](../seasons/SEASON-1-PROTOCOL.md) Part D §3).
  > **The seam was built first (CCB-S3-002).** `resolveIntent` in [`src/interaction/resolver.ts`](../src/interaction/resolver.ts) is the single entry point every caller uses; swapping in the AI is a `setIntentResolver()` registration, with the deterministic rule engine kept as the automatic fallback when the endpoint is unreachable and as the validator of the closed intent catalog. No caller imports the rule engine directly, so the swap touches no call site.
  > **A local Ollama resolver is now IN THE REPOSITORY and deployed, but unconsolidated (D-068).** The claim "no AI exists in code today" is **no longer true** as of 2026-07-25. [`src/interaction/ollama-resolver.ts`](../src/interaction/ollama-resolver.ts) registers through exactly that seam, with the rule engine as fallback; [`ollama-reply.ts`](../src/interaction/ollama-reply.ts) and [`ai-runtime.ts`](../src/interaction/ai-runtime.ts) add reply wording, runtime control, role routing and telemetry. It arrived from the operator's parallel planning chats with **no briefing id**, so it is not in the register and its design reasoning is recorded nowhere in this repository. **Season 4's first task is consolidation, not construction** ([`seasons/SEASON-3-PROTOCOL.md`](../seasons/SEASON-3-PROTOCOL.md) Part D and Part G §3, [`architecture.md`](architecture.md) §24). Not security-reviewed ([`security.md`](security.md) §12).

### 4. Multi-tenancy & Pro (customer self-service)

- [ ] Tenant isolation (carry a tenant key in new tables from the start), a role model (operator over all; customers scoped to their tenant), subscription/self-service management, per-customer passkey login. The current schema is single-tenant — no tenant key exists in any table yet (source: [`seasons/SEASON-1-PROTOCOL.md`](../seasons/SEASON-1-PROTOCOL.md) Part D §4).
- [ ] **Dual-license / Pro edition (D-026)** — the open edition stays AGPL-3.0; a commercial **Pro** edition follows under separate terms. **Caveat:** Pro that still links `simplex-chat` remains AGPL-bound unless SimpleX grants a commercial library licence or Pro avoids linking it — the tenancy/Pro architecture must respect this boundary from the start. Decided, not yet built.

### 4a. Retention auto-delete

- [ ] **Abo-dependent, admin-configurable retention, default 10 years, auto-delete after expiry (D-027)** — nothing auto-expires today; existing takedown/`/unpublish`/in-group-deletion are unchanged. The deletion mechanism is a Season 3 build and must be disclosed in the Privacy Policy. Decided, not yet built.

### 5. Optional durable-ban identity layer

- [ ] An application-level verified-identity layer binding bans to an external key — **only if** admission-gate friction proves insufficient. SimpleX has no persistent identity, so removed members otherwise rejoin instantly. Explicitly conditional/optional in [`seasons/SEASON-1-PROTOCOL.md`](../seasons/SEASON-1-PROTOCOL.md) Part D §5.

### 5a. Natural addressing — talking to her instead of commanding her

**Status: SHIPPED (CCB-S3-002).** Deterministic, no AI. Slash commands are unchanged and remain.

- [x] **Wake-word addressing** — her name, not a phrase, so greetings work in every language for
      free. Strict first-standalone-word anchoring rejects `Cinderellas Archiv` and
      `I think Cinderella is great`; typos in the name are forgiven. Direct replies to her
      messages and a per-member **follow-up window** (default 60s) also count as addressing.
      See [`src/interaction/addressing.ts`](../src/interaction/addressing.ts).
- [x] **Rule-based intent resolver** — closed catalog (`PUBLISH`, `UNPUBLISH`, `STATUS`,
      `SEARCH`, `HELP`, `UNDO`, `UNKNOWN`), EN+DE keyword/phrase sets, Levenshtein typo
      tolerance, phrases outranking keywords, and negation/hypothetical/quotation guards. It
      **never executes anything**. See [`src/interaction/rules.ts`](../src/interaction/rules.ts).
- [x] **Consent confirmation handshake** — publishing and unpublishing by natural language always
      ask first and act only on an affirmative; slash commands stay immediate.
- [x] **Third-party refusal** — any instruction naming or pointing at another member is refused,
      admin or not; the acted-on member id is always the sender's own.
- [x] **Undo** — a member can revert their own last consent decision inside a configurable window,
      backed by the new `consent_actions` journal (D-032).
- [x] **Cinderella's voice** — the §5 persona strings shipped as admin-editable defaults in EN and
      DE, structured so a new language is a new key.
- [x] **Nicknames** — she does not answer to "Cindy": a rotating sarcastic retort, never a repeat
      of the previous one in a chat, no action taken, no follow-up window opened, and silence past
      the anti-spam limit.
- [x] **Admin console** — `/interaction` exposes every §7 setting (wake word, greetings, toggles,
      windows, threshold, affirmations, rate limits, persona strings per language, retorts,
      nicknames) with a restore-defaults action; audited, live, no restart.
      See [`src/web/views/interaction.ts`](../src/web/views/interaction.ts).
- [x] **Reply presentation (CCB-S3-003)** — she answers as a plain group message instead of
      quoting the member back at the group; `replyMode` (`plain` default / `mention` /
      `quote`) and a localised, disableable name prefix are admin-editable. Confirmation
      prompts and nickname retorts never quote. Persona markup corrected to the delimiters
      SimpleX actually renders (`*bold*`, not `**bold**`), with a harness guard against
      regression. See [`src/interaction/reply.ts`](../src/interaction/reply.ts) and
      [`src/bot/send.ts`](../src/bot/send.ts).
- [x] **Address guards + reply language (CCB-S3-005)** — forwarded messages never reach the
      interaction layer; UNKNOWN is answered only on a strong address signal (greeting, direct
      reply, or mid-conversation) and otherwise met with silence; a length guard ignores
      long-form text without a high-confidence intent; an optional `strict` mode requires a
      greeting. Every guard is individually switchable with an explanatory description, and
      ignored candidates appear in a near-miss log on the same page. Reply language is now
      detected from the member's message (scored, not single-hint), remembered for the
      follow-up window, and pinned across a confirmation handshake.
      See [`src/interaction/near-misses.ts`](../src/interaction/near-misses.ts).
- [x] **Plugin framework (CCB-S3-004)** — capabilities beyond the archive are plugins with
      their own settings page and their own intents; the sidebar has a Plugins submenu built
      from the registry. A disabled plugin's intents leave the active catalog entirely.
      Adding a second plugin needs no framework change.
- [x] **Price lookups, rebuilt (CCB-S3-004 revised)** — three provider adapters
      (CoinMarketCap, CoinGecko, Dexscreener) in an ordered chain with automatic failover;
      symbols resolved lazily then PINNED in `asset_mappings` and never silently
      re-resolved; ambiguity asks the member once and remembers the answer globally;
      write-only encrypted API keys; licence-required attribution bound to the provider that
      answered. See [`src/plugins/crypto-prices/`](../src/plugins/crypto-prices/).
- [ ] **Superseded first cut** — the original hardcoded asset registry and single CoinGecko
      provider were replaced wholesale; nothing of it remains.
- [x] **Price lookups (superseded)** — a `PRICE` intent answers "what is HEX worth" and
      "how much Ethereum for 1 million HEX" in EN and DE. Assets resolve through an
      admin-editable registry pinned to canonical provider ids (HEX pinned to the original
      Ethereum token by contract), never by symbol; an ambiguous symbol asks. Quotes are
      cached, price questions have their own rate limit, cross-asset conversions go through
      the base currency, and provider failure answers honestly instead of inventing a number.
      See [`src/price/`](../src/price/).
- [x] **Crypto plugin polish (CCB-S3-006)** — bare `N X in Y` conversions resolve;
      significant-figure precision so a sub-cent price never shows as `0`; filler words no
      longer captured as asset names; majors pre-pinned by ticker AND name so they never
      disambiguate; genuine ambiguity ranked by market cap, capped, shown with the figure, and
      auto-resolved on dominance; state questions never become consent prompts; elliptical
      follow-ups inherit read-only intents; short discourse fillers allowed before her name.
- [x] **Cinderella's own messages in the archive (CCB-S3-006 §9 → built as CCB-S3-007).**
      `publish_bot_messages` (default on), capture of her own group sends at the send site,
      publication derived from the operator's setting rather than from consent, a consent-leak
      guard that redacts or withholds replies naming a member who has not opted in, and
      per-category noise exclusions. See D-042, D-043, D-044.
- [ ] **Her welcome message and the avatar flush are still not archived.** The welcome
      message is the consent notice itself, and arguably the most publish-worthy thing she
      says, but it is sent from the one-shot `npm run connect` process, whose capture
      pipeline is not running. The avatar-flush message bypasses `sendToChat` and is
      correctly absent — though by omission rather than by rule.
- [ ] **The live front does not re-render a card whose body changed.** `reconcile` adds and
      removes whole cards; it never rewrites one in place. Under the `redact` guard a
      revocation changes a body without changing the id set, so an already-open tab keeps
      the pre-redaction text until reload. `withhold` has no such gap. The same limitation
      applies to a member EDITING a published message, so it predates CCB-S3-007.
- [x] **Carry-over, keys and diagnosability (CCB-S3-008)** — an inherited intent can no longer
      invent an asset out of an interjection; the double-encryption defect that made every
      configured provider key unusable is fixed and self-healing; provider attempts are logged
      with cause and latency and shown on the plugin page; pins that no enabled provider can
      serve are reported at boot and on demand.
- [ ] **The provider-attempt log does not survive a restart.** It is deliberately in memory, like
      the near-miss log — but it means a failure that happened before the last restart cannot be
      investigated. Persisting it would make provider behaviour reviewable over time.
- [x] **Media metadata stripping (CCB-S3-011 Part 1)** — published media is served from a
      stripped derivative; originals untouched; orientation baked in; formats with no stripper
      recorded rather than assumed clean; existing media remediated.
- [ ] **No video or document stripper on this instance (CCB-S3-011 Part 1).** Needs ffmpeg for
      container/stream tags and a PDF library for document metadata. Today those formats are
      served unstripped and flagged as such. The audit found no metadata in them, so this is a
      gap in the guarantee rather than a live leak.
- [x] **CCB-S3-011 Part 2 / CCB-S3-013 — revocation: hide or delete, with evidence holds. BUILT.**
      The briefing was reissued after the Season 3 close-out reported it missing, and delivered as one
      piece with the hold rules. Hide/delete choice with **no default** and a safe interim (`pending`,
      which reads as hidden and authorises nothing); both states derived, with **no view rewrite needed**
      because `revoked_at` already unpublishes (D-070); restore after hide only, by that member only,
      preserving the ORIGINAL `opted_in_at` so forward-only publication does not strand the content;
      the choice recorded in the consent journal as its own append-only decision; row, media and every
      derivative erased, including id-named orphans and `.tmp` sidecars no column references
      ([`src/media/owned-files.ts`](../src/media/owned-files.ts)); no separate search index to purge
      (the tsvector is generated and goes with the row); audit entries carry identifiers only.
      Asymmetric confirmation: hide accepts an affirmation, delete requires the literal word and
      `matchesLiteral` refuses fuzzy neighbours (D-072, architecture §25).
      Evidence holds: only `illegal` creates one, they never compound, they are time-boxed
      (`holdDays`, default 30) on the durable queue, escalations and hash-match quarantines never
      expire, and the guard is a **DB trigger** so no path gets past it. Operator review offers
      release / destroy / escalate, with destroy structurally impossible for a hash match.
      Verified by [`scripts/verify-revocation.ts`](../scripts/verify-revocation.ts) (60 checks).
- [x] **Quarantine is segregated on the filesystem and at the serving layer (CCB-S3-013 §4).** The raw
      `@fastify/static` mount over `MEDIA_ROOT` is removed in favour of `/media/msg/:id`
      ([`src/web/views/admin-media.ts`](../src/web/views/admin-media.ts)), quarantined bytes are MOVED
      into `QUARANTINE_ROOT` ([`src/media/quarantine.ts`](../src/media/quarantine.ts)), and quarantined
      rows are withheld from publication (`migrations/022`). Both guards are independent, and the config
      loader refuses to start if the two roots are nested.
- [x] **Encryption at rest for originals (CCB-S3-012 §2).** AES-256-GCM under a dedicated
      `MEDIA_SECRET`, uniform across all originals so encryption status leaks nothing; derivatives stay
      plaintext. Mixed trees supported via a magic header; `npm run encrypt-media` backfills
      idempotently. Byte-range serving uses the plaintext size (D-075).
- [x] **The hash-screening seam (CCB-S3-012 §3).** `HashScreeningProvider` with a null default that
      transmits nothing and a fixture provider for harnesses; screening enqueued at receipt on every
      image, independent of consent, never blocking capture; a provider error retries and never reads as
      clean. Admin panel at `/screening` shows provider health and quarantined items by reference only
      (D-076).
- [ ] **No detection provider is connected (CCB-S3-012, blocked on the operator).** Blocked on: a
      provider account, the legal process agreed with a lawyer, retention periods, and a designated
      point of contact. Until then the null provider is active and the public copy says "in development".
- [ ] **Perceptual hashing is not implemented.** The fixture provider uses SHA-256, which proves the
      plumbing but would not survive a re-encode. A real adapter implements the same interface with
      perceptual hashing; the interface does not need to change.
- [x] **`MEDIA_SECRET` is in the backup set.** ~~`deploy/backup.sh` copies the database and the media
      tree but not `/etc/cinderella`.~~ **Corrected under CCB-S3-028: this was wrong.** `backup.sh` does
      copy the env file, and its restore instructions install it back at mode 600. The residual concern is
      different and is tracked under "Backups and disaster recovery" below: the key is copied to sit
      **beside** the encrypted media it unlocks, which is not a backup of a secret so much as a way to
      lose both at once.
- [ ] **The CSAM hold source has no producer (CCB-S3-013 Part B, by design).** `evidence_holds.source`
      accepts `'csam'`, the never-expiring behaviour is implemented and tested, and the operator UI
      already refuses to offer destroy for it. Nothing creates one until hash screening exists
      (CCB-S3-012). The hook is deliberate: the mechanism is built and proven before the screening that
      needs it.
- [ ] **Backups still outlive a destruction.** `deploy/backup.sh` keeps fourteen generations and has
      never run, so today a destruction persists nowhere. Once backups are scheduled, destroyed content
      survives in them until it ages out, which is exactly what the member-facing copy now promises
      (removal from the live archive, copies fading as backups expire). If the retention policy changes,
      that copy has to change with it.
- [ ] **Media error responses on the public front are cacheable (CCB-S3-011 Addendum B, the half
      that was not built).** [`src/web/server.ts:188`](../src/web/server.ts) deliberately exempts
      the public front from the global `no-store` hook (it must stay embeddable and indexable),
      and the 404 paths in the media route
      ([`src/web/front/embed.ts:479-528`](../src/web/front/embed.ts)) set no `cache-control` at
      all. A shared cache may therefore apply heuristic freshness to a 404 for an item that is
      merely not yet derived, and keep serving "missing" after it exists. The success path
      (`:533`) does set `no-store`. **The retry half of the same addendum IS live** (`7a22aa3`):
      the route calls `ensureDerivative` and serves the healed file rather than failing. Fix is
      one `cache-control: no-store` on the error paths.
- [ ] **Backups are not scheduled.** `deploy/backup.sh` keeps the last 14 copies but no cron or
      timer invokes it, and no dump exists on the host. Until it runs there is no recovery from
      a disk loss; once it runs, deleted content persists for 14 backup cycles, which is what
      any deletion promise has to be written against.
- [x] **Member questions in the archive (CCB-S3-009)** — instructions are captured and published
      on the consent rules with per-category switches; question and answer publish or withhold as
      a pair; the public front shows the pairing.
- [ ] **Existing exchanges cannot be repaired.** The questions asked before this shipped were
      never captured, so the answers already in the archive stay unpaired. Nothing can recover a
      message that was never stored.
- [x] **Help and consent explanation (CCB-S3-010)** — full help generated from the active catalog,
      `help <topic>` detail, extended vocabulary, `/help`; consent prompts, welcome and help state
      the three properties (forward-only, public-until-revoked, final) in EN and DE.
- [x] **No em-dashes + readable, editable help (CCB-S3-021)** — the em-dash sweep + `verify:no-dashes`
      guard + the standing CLAUDE.md rule and the block-structured help/welcome are D-061 (§1-2). §3
      (D-066) made the help ONE editable template: the persona `help` field IS the reply, with the
      machine filling `{wake}`/`{label}`/`{consent}`/`{commands}` (the last still catalog-driven); blank
      restores the default; a save missing a required placeholder is rejected. The previously dead
      editable Help field is gone. Audit: `help` was the only editable-but-dead persona field.
- [ ] **Native command menu (CCB-S3-010 §2c) — investigated, not adopted.** The SDK exposes it, but
      it renders only in a 1:1 chat with the bot, and Cinderella has no contact address. A
      `buildCommandMenu` producer over the active catalog is ready if she is ever given a direct
      surface. See `docs/wire-format.md` §3f.
- [x] **Video-link cards (CCB-S3-014)** — YouTube links play in the stream, click-to-play, with a
      locally-served thumbnail and zero third-party loading before the click. A matcher registry, so
      PeerTube/Vimeo is a matcher away.
- [ ] **Video providers beyond YouTube.** The registry is ready; PeerTube, Vimeo and a direct video
      file are each one matcher. Not built.
- [~] **Admin console restyle (CCB-S3-015).** Stage 1 (split Interaction into sub-sections + submenu
      + deep links) and Stage 3 (dark-neon restyle reusing the website design system, cyan accent;
      D-060) DONE. Stage 2 (two-column tile layout, per-tile save, sized inputs, collapsible help)
      still to build.
- [x] **Queue-based retry of a failed in-group deletion (CCB-S3-023 follow-up) — DONE.** A failed
      `markDeleted` now enqueues a durable `deletion.apply` job (interactive lane, idempotent,
      fail-fast on a bad payload) that retries until it succeeds or dead-letters visibly; the alert is
      actionable ("queued for automatic retry", or "remove by hand" only if even the enqueue fails).
      Production was checked: all 6 in-group deletions were correctly applied, zero still published, so
      the finding never actually fired. `src/queue/jobs/deletion.ts`; `verify:queue` §16.
- [ ] **CCB-S3-023 deferred fixes (audit recorded them rather than doing them here).**
      (b) **Atomic consent-command categorisation** — set `member_category='consent'` in the persist transaction for command
      messages, so a classification failure cannot leak the command onto the archive (today it is only
      made visible). Risk: a rare infra error between insert and categorisation can publish a consent
      command until noticed. (c) **Generalised plugin `selfCheck()` interface** — the boot credential
      check is crypto-specific; a plugin interface would auto-cover a future plugin's integrations.
      Risk: a new plugin's unreachable credential would not be boot-checked until wired.
- [~] **Durable job queue (CCB-S3-022).** Foundation DONE: Postgres-backed `jobs` table (migration
      017), `SKIP LOCKED` claim, backoff + dead-letter, permanent-vs-transient, priority lanes +
      concurrency limits + pausable bulk, idempotency, the worker, a placeholder analysis job, and
      `verify:queue` (D-062, architecture §21). Phase 2 still to build: move media-derivative
      generation and video-thumbnail fetching onto it (verify the archive still renders after each),
      a resumable rate-limited backfill command, and the admin observability page (depth, throughput,
      wait, dead letters + retry/cancel, stuck-job indicator, bulk pause toggle).
- [~] **Capture write-ahead log (CCB-S3-024).** §1 established the extent (before any change): a new
      message and an edit were the two events lost on a handler failure with only a log line; deletions
      are durable (S3-023); file receipts are recorded-not-retried — the 16 of CCB-S3-018 are exactly
      this class (recorded `media_error`, never retried, past the ~48h relay window). Production
      before-check: the loss path had not fired for ordinary member content (67 uncaptured = intentional
      pre-S3-009 command/instruction drops, none since Jul 23). Slice 1 DONE: the durable substrate —
      `capture_events` (migration 018), the store, the reprocessor registry + order-preserving
      `capture.drain`, and `verify:capture-events` (30 checks) (D-064, architecture §22). Slice 2 to
      build: wire the dispatcher to record-then-process with the scope gate FIRST (harness guard that an
      excluded event never reaches the store), idempotent reprocessors for new_message/edit/deletion,
      per-conversation ordering + defer on the live path, boot drain. Slice 3: retention prune of
      processed rows (short window, member content — add the privacy-policy note then) + admin counts
      (received/processed/retried/deferred/dead per type, a dead capture event distinct from a job
      failure) + a crash test against the live archive.
- [ ] **Direct contact - member binding (CCB-S3-017 Addendum A) - investigated, not built, blocked.**
      The structural link EXISTS (`Contact.contactGroupMemberId`, `apiCreateMemberContact`) so the
      pairing-code protocol is unnecessary in the normal case - but it is gated on the group's
      `directMessages` preference, and the whole thing is blocked on CCB-S3-017 section 3 (the
      direct-contact surface), which is not in the repo. Keep the pairing fallback documented for the
      directMessages-off case. Stale-member rule recorded in wire-format section 8f. See D-058.
- [ ] **Private per-member channel via the support scope (unblocked by the CCB-S3-016 audit).** The
      SDK exposes it (wire-format §8a). ~~Prerequisite before any build: capture must exclude
      `chatInfo.groupChatScope` messages~~ — **done (CCB-S3-019):** capture is now a public-group-only
      whitelist (`isPublicGroupChat`, security.md §9h / D-059), so nothing private is archived.
      Remaining open question needing a live test: can a moderator INITIATE, or only reply? Would
      enable private onboarding, private status replies, and private moderation notices.
- [ ] **Moderation & membership console (exposed, unused).** accept/reject pending members, remove,
      role changes, block-for-all, a live roster — all in the SDK per §8b, none surfaced in the
      admin yet.
- [ ] **Reactions (exposed, unused).** Send an emoji ack; subscribe to the `chatItemReaction`
      event to read reactions. §8b.
- [ ] **More assets and a second provider** — only HEX, BTC, ETH, USD and EUR ship. Adding an
      asset is a registry line in the admin, no code change; adding a second provider is an
      implementation of the `PriceProvider` interface. A fallback chain across providers is
      not built.
- [ ] **Placeholder markup injection** — `{name}`-style substitutions put member-controlled
      text into a message SimpleX will parse. The mention prefix strips the pairing delimiters
      (`sanitizeDisplayName`), but other placeholders (`{query}` in the search answer, `{name}`
      in the third-party refusal) do not. Cosmetic today; worth a shared escape helper if more
      placeholders appear.
- [ ] **More languages** — only EN and DE ship with persona copy. The structure takes a new
      language as a key in the persona/retort maps; the resolver's keyword sets would need the
      matching additions.
- [ ] **Private answers** — `STATUS` and undo detail are kept short because SimpleX gives the bot
      no private per-member channel (see `wire-format.md` §4). If a direct-contact path is ever
      built, those answers should move into it.

---

### 6. Public marketing website — SPLIT OUT (D-089)

**Status: SHIPPED, and no longer tracked here.** The website moved to its own repository,
process, port, systemd unit and deploy script under D-089; its backlog moves with it. The
record below is the state at the moment of the split and is kept for history, not as
open work. One correction it did not survive: the building blocks were configurable on
`/website` in the console, and that page is gone (CCB-S3-041) - they are environment
variables now.

**Status at split: REDESIGN SHIPPED (CCB-S3-001, superseding the CCB-S2-012 foundation landing).**
The domain root `/` serves the operator's approved dark-neon design (D-029), SSR and
indexable, with all template pages real; the admin dashboard stays at `/dashboard` and the
operator login remains a discreet header button to the unchanged, `noindex`, hardened admin.

- [x] Site scaffold + routing at `/`, per-language URLs, negotiation + switcher +
      `hreflang`; adding a language is a file, not code. **(CCB-S2-012)**
- [x] **40 languages** — EN master + DE + 38 machine-translated locales (dropdown
      switcher, RTL support for ar/he/fa); every file is marked "pending
      native-speaker review" in `_meta.status`. **(CCB-S3-001 follow-up, D-030)**
- [x] **Dark-only + copy rules** — light mode removed entirely; em dashes banned
      from visible copy in all languages (enforced by `verify:site`); footer
      Ecosystem column links simplex.chat / matrix.org. **(CCB-S3-001 follow-up, D-030)**
- [x] Full per-page SEO — title/description/canonical/OG/Twitter + JSON-LD
      (Organization + WebSite + SoftwareApplication); site indexable, admin `noindex`;
      `robots.txt` + a marketing sitemap. **(CCB-S2-012)**
- [x] Building blocks shipped but OFF by default — visitor analytics (consent-gated),
      cookie/consent banner, script-free social share — admin-configurable on `/website`
      with the operator-responsibility note. **(CCB-S2-012, carried through CCB-S3-001)**
- [x] **Template redesign** — the operator's dark-neon template ported 1:1 to SSR:
      own token system (dark default + light), self-hosted fonts, inlined lucide icons,
      starfield/reveal/demo effects as nonce'd vanilla JS. **(CCB-S3-001)**
- [x] **Real pages** — Home (with the interactive archive-demo preview), Features, Pro,
      Security, Open Source, Legal; EN + DE. Docs remains a clean `noindex` stub. **(CCB-S3-001)**
- [x] **Legal pages wired** — footer-linked on every page; the Legal Notice includes the
      voluntarily appointed Youth Protection Officer; Privacy/Terms render as drafts
      (badged, `noindex`, out of the sitemap). **(CCB-S3-001)**
- [x] **Real Impressum + Privacy Policy** — the operator's actual details, the German
      Impressum verbatim and binding, the privacy policy drafted from the code, both
      indexable and in the sitemap; every placeholder gone from every legal page in all
      40 locales. Texts live in `src/pages/legal.ts` **in the site repository** (D-089), not
      in the locale files, because a binding legal text cannot be machine translated.
      **(CCB-S3-029, D-079)**
- [ ] **Terms of service** — still outstanding, and the page says so rather than
      carrying invented terms. Needs the commercial Pro tier to be settled, then counsel.
      Publishing them = an entry in `legal.ts` plus dropping `noindex` from `legal-terms`
      in `pages.ts` - **both in the site repository now** (D-089), not here.
- [ ] **Counsel review** — nothing on the legal pages has been reviewed by a lawyer. The
      privacy policy in particular makes claims about preservation, deferred destruction
      and the limits of erasure that are accurate to the code but untested legally.

### Promises the published privacy policy now makes that the code does not yet keep

These are not ordinary features. Each one is the gap between a sentence a member can
read on [cind3r3lla.com](https://cind3r3lla.com/en/legal/privacy) and what the archive
can actually do, so each is dated by publication rather than by convenience.
**(CCB-S3-029 Addendum A)**

- [ ] **Automated retention expiry** — admin-configurable, ten years by default. The
      policy states a ten-year ceiling and admits, in its own sentence, that the limit
      is currently applied **by hand**. Today no retention mechanism exists at all:
      nothing selects content by age, no period is stored or read anywhere, and no
      interface lets the operator set a shorter one. The deferred-destruction sweeper
      and the hold-expiry job expire *holds*, not content. The hook is the durable job
      queue (`src/queue/`), which already has `runAt` scheduling. A manual process
      nobody has written down is a policy that will not be executed, and the first
      deletion falls due in 2036, which is exactly long enough to forget.
- [ ] **One-time recovery code at opt-in** — the proactive fix for identity loss.
      Verification after the fact is hard only because nothing was established
      beforehand; opt-in is the one moment a member is provably themselves. Issue a
      code then, privately, store only its hash, and authorship becomes provable
      afterwards from any channel with no personal data and no identity disclosed.
      Blocked on a private channel: the bot boots with `createAddress: false`
      (`src/bot/client.ts`), subscribes to no contact events, and `SendTarget
      {to:'direct'}` has no production implementation, so there is nowhere to send a
      code privately today. See D-058 and CCB-S3-017 §3. The policy names this as
      **planned**, and `verify:site` asserts it is never offered as available.
- [ ] **Operator route to action a verified erasure request** — the policy tells
      members that erasure by email ends in *restriction*, not destruction, because
      that is the truth: `/messages/:id/delete` sets a reversible flag, and the only
      hard-destruction paths are the member's own in-chat delete and the evidence-hold
      workflow. An operator cannot destroy on request even when the request is fully
      verified. That is a defensible default, but it should be a decision rather than
      an accident.
- [ ] **Per-member scope in the admin console** — restriction is applied message by
      message, and `MessageFilters` has no sender filter, so restricting one member's
      content means paging the whole archive 25 rows at a time. This makes the Art. 18
      route the policy promises impractical at any real archive size.
- [ ] **No route from hidden to destroyed** — a member who revokes and chooses *hide*
      has no in-chat way to escalate to destruction later, and she answers such a
      request with "There is nothing of yours left in my archive to destroy", which is
      **false**: the content is retained and restorable. The policy currently routes
      these members to email as the honest workaround. The reply is a standing-rule
      violation (CCB-S3-023: a degraded function must not run silently) and should be
      fixed before the workaround becomes load-bearing.
- [ ] **`/unpublish` is a silent no-op when slash commands are disabled** — with the
      slash-command setting off, `/unpublish` neither acts nor replies. A member
      exercising the one right the policy calls "the fastest and most complete route"
      gets no acknowledgement and no effect. It should refuse audibly.
- [ ] **A member who never opted in has no in-chat route to anything** — capture is
      unconditional (`src/capture/persist.ts` has no consent lookup; consent is applied
      at read time), so their messages, media and display name are stored exactly like
      anyone else's, while every in-chat right is reachable only through a revocation
      of a consent they never gave. Nothing they can say in the group reaches their own
      stored data.
- [ ] **Docs page** — real documentation content (currently a stub).
- [ ] **Matrix support** — operator decision (CCB-S3-001 follow-up): the site now
      positions Cinderella as the bot suite **for SimpleX and Matrix** and lists
      "Matrix support" first on the public roadmap (badged _Planned_). Nothing
      Matrix-related is designed or built yet — this records the publicly announced
      direction so the docs and the site stay in sync.

---

## Unconsolidated — the local AI subsystem already in `main` (D-068)

**Season 4's first task, and it blocks everything else** ([`seasons/SEASON-3-PROTOCOL.md`](../seasons/SEASON-3-PROTOCOL.md)
Part D). 23 commits between 2026-07-25 and 2026-07-27 (`b308201`..`e236ccf`), roughly 17,700
inserted lines across 46 files, **none carrying a `Briefing:` trailer**. It is deployed and its
harnesses pass; what is missing is the reasoning, the reconciliation and the review. Inventory in
[`architecture.md`](architecture.md) §24.

- [x] **Built and deployed** — local Ollama intent resolver behind the existing seam, individualized
      reply wording, runtime control / role routing / model discovery / content-free telemetry; a
      profile, group and authority control plane; deterministic per-group runtime policy; persistent
      bot onboarding configuration; the AI admin workspaces, mega navigation and brand layer;
      migrations 017/018/019; and 19 `verify:*` harnesses, all passing.
- [ ] **Reconcile against these five documents and the decision log.** A decision taken in a parallel
      chat must not silently contradict one recorded here. Two of Season 3's worst faults came from
      work whose reasoning lived outside the documents; this is the third instance of the pattern,
      caught at close-out rather than in production.
- [ ] **Security review under the CCB scheme.** Not done. The open questions are listed in
      [`security.md`](security.md) §12: SSRF reach of the configurable endpoint, whether member
      content sent to the model passes the same consent and scope gates as capture, prompt injection
      against `blockedLiterals` and the consent gate, whether the new admin routes carry the CSRF /
      step-up / session / rate-limit controls, and whether the telemetry is in fact content-free.
- [ ] **Decide how this subsystem relates to the plugin framework** as the function count grows
      toward the projected ~300. Two extension mechanisms now exist side by side.
- [ ] **Migration numbering.** Numbers 017, 018 and 019 each exist twice. Not broken (the runner keys
      on filename) but constrained: **no applied migration may be renamed**, and the number is not an
      ordinal. Allocate from 020. See **D-069** and [`architecture.md`](architecture.md) Appendix §5.
- [x] **Lint failure on `main` repaired at close-out (CCB-S3-026).**
      `src/interaction/ollama-reply.ts` tripped `no-control-regex` on a deliberate C0/C1 sanitizer
      for untrusted model output; an `eslint-disable-next-line` now carries that reason. No behaviour
      changed.
- [ ] **Attribute future work.** Every commit carries its `Briefing:` trailer. The absence of one on
      all 23 commits is exactly why this work was invisible to the register and to the per-change
      documentation rule.

## Adapter seam follow-ups (CCB-S3-020 Phases B and C)

- [x] **Phase A: the seam exists and is enforced.** Domain types, opaque `RawItem`, `ChatAdapter` over
      the operations that have callers, one adapter (`src/bot/`), an in-memory fake, and
      `verify:adapter-seam` which proves it fails on a violation (D-078).
- [ ] **Phase B: the audit-found operations.** Moderation (delete another member's message, remove a
      member, change a role), reactions, and creating a contact from a member. All available and all
      intended, none with a caller. They arrive WITH their first caller so the shape is verified against
      live behaviour rather than guessed.
- [ ] **Phase C: remove the `raw_json` leak. Prerequisite for Matrix, not housekeeping.** SQL reads the
      SimpleX item shape in two live places: `migrations/019_formatted_text.sql` builds the public
      front's `formatted_text` from `raw_json -> 'chatItem' -> 'formattedText'`, and
      `scripts/scan-support-scope.ts` reads `raw_json -> 'chatInfo' -> 'groupChatScope'`. A Matrix event
      has an entirely different shape, so any SQL reading the SimpleX shape is wrong the moment a second
      protocol exists. Needs a Cinderella-defined formatted-runs shape, a rewrite of 019, and a backfill
      over existing rows: a schema change on the path serving every public page, so its own briefing.
      Note `capture_events.payload` (migration 018) has **no production writer yet**, so its shape can
      still be defined in domain terms for free.

## Operator-owned open items (carried into Season 2)

These are not code tasks — they are actions only the operator can take. Source:
[`seasons/SEASON-1-PROTOCOL.md`](../seasons/SEASON-1-PROTOCOL.md) Part C.

- [ ] **Register a second passkey, then close the break-glass path.** Enrol passkeys on ≥2 devices (a YubiKey 5-series has been ordered — the current YubiKey 4 predates FIDO2 and cannot store passkeys), then disable break-glass and **rotate the break-glass password** (it was exposed in plaintext in an implementation report). The toggle and rotation surface live on the Security page ([`src/web/views/security.ts`](../src/web/views/security.ts)); the decision to flip them is the operator's.
- [ ] **Add a read-only deploy key on the VPS** so deployment can `git pull` normally instead of shipping via `git bundle`.
  > **Note:** [`seasons/SEASON-1-PROTOCOL.md:94`](../seasons/SEASON-1-PROTOCOL.md) (Part C §2) describes the repo as **private** ("deploying via `git bundle` … the repo is private"). This contradicts [`CLAUDE.md`](../CLAUDE.md), which states once, at [`CLAUDE.md:25`](../CLAUDE.md), that "The repo is **public**." (CLAUDE.md's other uses of "public" — the admin console, the SimpleX group, the web archive, the `/embed` widget — do not refer to the repository.) The two standing documents disagree on repository visibility; this backlog reports the discrepancy rather than resolving it. Either way, the pre-push secret-grep discipline applies.

---

## Backups and disaster recovery (CCB-S3-028) — the largest single operational risk

Verified against the production host on 2026-07-27, not inferred.

- [ ] **No backups exist.** `/var/backups/cinderella/` does not exist on the host, there is no cron entry
      and no systemd timer. `deploy/backup.sh` is committed, is well written, and **has never run.** The
      archive has no recovery from disk loss of any kind. Everything else in this section is secondary to
      scheduling it.
- [ ] **The key is backed up beside what it unlocks.** `backup.sh` does copy the env file carrying
      `MEDIA_SECRET` (correcting an earlier note above), but into the same backup directory as the
      encrypted media. A single lost or stolen backup is then either a total loss or a total disclosure.
      The key belongs somewhere the operator controls separately. There is no key history: rotating
      `MEDIA_SECRET` destroys the archive.
- [ ] **Quarantine bytes fall out of backups entirely.** `QUARANTINE_ROOT` is deliberately outside
      `MEDIA_ROOT` (D-074) and `backup.sh` covers only the media tree. Evidence surviving a disk failure
      matters for the custody obligation.
- [ ] **Restoring a backup resurrects deleted content.** Any restore must re-apply the deletions that
      happened since the dump, or the deletion promise breaks on every restore. This belongs in the runbook
      **and** in the privacy policy. Whether it is even implementable today depends on whether the consent
      action journal (migration 009) and deletion provenance (005) retain enough to replay a deletion
      against a restored row — that needs checking before the procedure is written.
- [ ] **Backup encryption is unresolved.** `backup.sh` does not encrypt. Open decision, with the tradeoff:
      encrypting under a key separate from `MEDIA_SECRET` protects the dump but adds a second key whose
      loss is equally fatal; a pull model (the backup host reaches in) means a compromised server cannot
      reach or destroy its own backups, but requires standing credentials on the backup side.

**Open question the operator owes:** is the SimpleX core database backed up, and what does losing it cost?
It holds unencrypted content, which is a privacy argument *against* backing it up, but it also holds
Cinderella's SimpleX identity and group membership. If losing it means she cannot be restored and must be
re-invited to the group as a **new identity**, every member's consent record survives while the identity
they consented to does not. That answer changes the urgency and has not been established.

**Standing constraint (not an open question):** quarantine material must never reach a private machine.
Suspect material on a personal computer is a materially different legal position from the same material
under a documented custody process on a server. No restore or debugging procedure may pull it locally.

## The profile generator — two components built, no runtime caller

Offline tooling under `src/generator/`, built component by component against its own
briefings. Architecture §31 has the detail; the state of it is:

- [x] **Shared deterministic RNG** — SplitMix32, named per-stage streams, no `Math.random`
      and no clock ([`src/generator/rng.ts`](../src/generator/rng.ts)).
- [x] **Name generator** (CCB-S4-002) — pipeline, culture-grammar engine, population statistics and
      SimpleX sanitisation. `npm run verify:namegen`, 42 checks. **"Culturally coherent
      names" is not delivered**: the shipped corpus carries no culture labels, so the
      grammar engine runs against hand-authored fixtures, and the swap point for a real
      labelled corpus is documented in `corpus.ts`.
- [x] **Trait sampler** (CCB-S4-003) — six-dimensional correlated personality vectors around archetype
      means, with a deliberate 45% unclassified background. `npm run verify:traits`,
      66 checks. See D-094 and D-095.
- [x] **An agreeable-but-manipulative archetype** — `ingratiator` and
      `principledContrarian` fill the two unoccupied quadrants. A/H falls 0.935 to 0.173
      and the near-null direction closes (smallest whitened eigenvalue 0.0011 to 0.1089).
      Ten archetypes now, all 45 pairs clearing the separation floor. See D-097.
- [x] **Break the rest of the moral halo** — closed by a joint solve rather than more
      patching (`npm run solve:archetypes`), plus an eleventh archetype
      (`anxiousScrupulous`) added for COVERAGE after the solve met the N/H target while
      leaving that region empty. Every correlation now within 0.12 of the model;
      spectrum condition ratio 2.77 against roughly 3000 originally. Set version
      `archetypes-11-2026-07-31`. See D-097.
- [ ] **Measure the abstention rate conditioned on each trait**, the first time a
      classifier exists. Prediction to test: `ordinary-calm` sits 1.605 from any
      archetype against 0.760 for its anxious mirror, so calm-and-unremarkable avatars
      may abstain more readily than anxious ones at the same threshold — which would
      mean emotionally stable people are labelled less often, purely as an artefact of
      where the set sits. Confirm the rate is flat (D-098).
- [ ] **Abstention in every classifier (D-098).** Settled as a requirement before
      anything classifies: a component that assigns an avatar to an archetype must be
      able to return "no archetype". Forced nearest-archetype assignment is a defect.
      The modal person sits 1.605 from any archetype and would be labelled `roleModel`.
- [x] **Geometric coverage sweep** — `npm run coverage:geometry`, bound to the archetype
      set version rather than to the commit or to solve time. Finds UNNAMED gaps the
      standing check cannot; `verify:traits` fails if the set moved without it re-running.
- [x] **Standing coverage check** — `data/coverage-regions.json` names sixteen regions
      with a status each; `verify:traits` checks all of them every run, counts occupancy
      rather than asserting booleans, and flags weakly-occupied regions the sign
      predicate cannot see. Threshold 0.5 non-strict with a 0.3 corroborating pass.
- [x] **The low-honesty pole** — closed by constraining the population MEAN (D-100), not
      by authorship. `cold-systematic`, `calm-bad-faith` and `covert-bad-faith` are all
      occupied; `covert-bad-faith`, recorded as the first region to fill if a feature
      ever consumed actor typing, filled itself. The version binding is what surfaced it.
- [ ] ~~The low-honesty pole is two points~~ (superseded by the line above)**, both strongly extraverted and both
      emotionally average: bad faith in this set is always loud and never rattled. No
      introverted, calm or anxious bad actor exists. **The correlation matrix cannot see
      this** — every pair involving honesty is now within 0.12 of the model. Second
      independent instance of "a repaired correlation is not a populated space".
      `covert-bad-faith` (low E, low H) is the first region to fill when a feature
      consumes actor typing. Note the harm is in what the set can NAME, not what it can
      PRODUCE: those avatars are generated and simply classified to the wrong nearest
      archetype (D-097).
- [ ] **A calm, organised, low-honesty archetype** — cold, patient, systematic bad faith,
      as distinct from the warm ingratiating kind `ingratiator` already covers. The set
      can currently express manipulation only as charm. Deliberately open: no product
      feature uses actor-type personality yet. **When actor-type modelling becomes real,
      this is the first region to check** (D-097).
- [ ] **The joint-density check per archetype.** The sharper form of the outward-push
      hypothesis: `|z| = 2` on one trait is roughly the 2nd percentile and unremarkable,
      but an archetype extreme on one trait AND displaced on others sits at a joint
      density far below any marginal suggests. Ask what fraction of real people occupy
      the neighbourhood of each archetype mean in six dimensions, and compare against the
      mixture weight assigned to it. Turns a general concern into a number per archetype,
      and would show an archetype given five percent of a population where real data has
      one (D-101).
- [ ] **A separation floor that survives the mix slider.** The floor is a property of
      (set x mix) in standardised space; a plausible operator mix (80 percent one
      archetype) already falls to 1.927 against a 2.0 floor. Reported, not gated, because
      failing the run would break a legitimate slider position — but it needs a product
      answer, probably a warning in the Personality panel rather than a refusal (D-101).
- [ ] **Carry two named expectations into fidelity measurement**, so they are tested
      rather than noticed. (1) The joint solve pushed means outward — `anxiousScrupulous`
      at N +1.73 / H +1.70 is top-few-percent on two dimensions at once, which followed
      from the separation constraint rather than from a choice; whether real data has
      density there is unanswerable from inside the generator. (2) Coverage is a
      two-level question: does every intended region contain an archetype, and does the
      generated population reach where real people are. The second needs beta-recall and
      nearest-neighbour coverage against reference data.
- [ ] **Extend the versioning pattern to the reference layer.** "A set that cannot be
      named cannot have a bound written against it" applies to the reference dataset
      (file hashes, exclusion rules, scoring keys, split indices), the metric
      implementation, and the numeric tolerances — not only to the archetype set, which
      is just the first instance (D-097).
- [ ] **Reference data layer** — raw file hashes, per-artefact licence text, exclusion
      rules, scoring keys, frozen train/validation/holdout indices. Everything downstream
      of validation depends on this existing and being immutable, and it is not code.
      Note the licensing fork it must resolve: IPIP material is public domain and usable
      commercially; the official HEXACO-PI-R forms are free only for non-commercial
      academic research. D-097 defers that fork rather than removing it.
- [x] **Surface derivation** (CCB-S4-005) — style, rhythm and identity from the latent
      vector. `npm run verify:surface`, 28 checks. Style is a pure function (no `Rng`
      parameter); identity is drawn (no `latent` parameter), so personality cannot leak
      into origin, age or gender. See D-099, including the §8 diagnostic catching
      `tone`/`emojiAffinity` at 0.983 on its first run, which had also left the coherence
      cap firing on 0 of 20,000 avatars.
- [ ] **Population layer** — composing a room rather than an avatar: who is in it, in what
      mix, with what collision behaviour. The trait sampler takes `archetypeMix` as an
      input and deliberately makes no claim about what a realistic one is.
- [ ] **Validation layer, bios, avatars, persistence** — none started.
- [ ] **Wiring any of it to the runtime.** Nothing outside `src/generator/` imports it and
      no migration writes its output; D-082's schema position is unchanged. Note before
      starting: the build does not copy the modules' `data/` JSON into `dist/`, which has
      never mattered because both harnesses run from source through `tsx`.

## Carried into Season 4 (recorded under CCB-S3-028)

Findings that existed only in the planning chat. Verified against code first; several turned out to be
wrong or already handled and are recorded here with the correction rather than the claim.

- [ ] **Terms of service cover no commercial Pro tier.** CCB-S3-029 replaced the placeholders and the page
      now says plainly that no terms are in force. A public Pro pricing page already advertises tariffs, so
      the marketing surface is ahead of the terms. Needs counsel.
- [ ] **Retention auto-delete is decided but unbuilt.** Already recorded as **D-027 (PLANNED)** — abo
      dependent, admin configurable, default ten years. Do **not** allocate a new decision number. The
      legal texts describe it as a mechanism rather than a fixed number so a tariff can change it without
      a rewrite, which CCB-S3-029 implemented. The deferred-destruction sweeper and evidence holds in
      `src/archive/` are **not** the retention mechanism and should not be mistaken for it.
- [ ] **Nine high-severity npm advisories, not three.** `@fastify/static`, `brace-expansion`, `fast-uri`,
      `find-my-way`, and `sharp` (inheriting four libvips CVEs). `sharp` is on the media path, which makes
      it the one to look at first.
- [ ] **The demo UI is not built.** Backend, isolation guard (D-082) and session handling are. The
      visitor-facing pane, the four guided prompts, the disclosure line and the mobile layout are not. The
      demo hostname answers 404 by deliberate nginx configuration (D-081), which is correct until the pane
      exists.
- [ ] **Thirty-nine locales carry no translated child-safety copy** and fall back to English after the
      correction. Forty locale files ship; the English source is one of them.
- [ ] **Integer overflow to 500 on the public route.** The bounded-id fix applied to the admin media and
      report routes was not applied everywhere; an out-of-range id still reaches Postgres and surfaces as a
      500 rather than a clean 404. Same pattern, one route short.
- [ ] **`capture_events` is unreachable in production and unerasable.** `recordEvent` has no production
      caller, so the write-ahead subsystem is not merely unwritten but entirely unreachable. Two
      consequences that must be settled *before* CCB-S3-024 slice 2 writes the first row: no erasure path
      touches `capture_events`, so a payload carrying member content would **survive a member's deletion**;
      and the `capture_event_kind` enum cannot express file receipts although the migration names them.
- [ ] **`capture_events.payload` shape is still free, and this is the only place the choice still exists.**
      Define it in domain terms, not the SDK shape. Open question with a real tradeoff: carrying the opaque
      raw item buys replay fidelity but creates a second retained copy of member content, which collides
      with the erasure point above.
- [ ] **Phase C is a Matrix prerequisite, not housekeeping.** A Matrix event has a different JSON shape, so
      any SQL reading the SimpleX shape breaks the moment a second protocol exists. Open question: do it
      now, or defer until a second protocol is actually being built. Deferring is cheaper today and more
      expensive exactly once.
- [ ] **The core database is a screening blind spot.** 291 of 1380 core chat items carry embedded base64
      image data (measured on the host 2026-07-27; the figure grows). That is image data outside
      `MEDIA_ROOT`, unencrypted, invisible to quarantine, and invisible to screening, which only ever sees
      received **files**. The architectural point is the durable one and it is verifiable from the code:
      connecting a detection provider would not cover these.
- [ ] **Why do we keep our own row for in-group-deleted items?** Exactly 11 messages are marked
      `group_deleted` rather than erased (measured on the host; the claim was accurate). Open question: if
      retaining our copy serves neither the publication derivation nor consent gaps, both copies should go.
      Read `message_publish_state` before deciding — the answer is mostly in the SQL.
- [ ] **Check the group-creator path before making the conversation key `NOT NULL`.** The conversation
      identity is settled as `groups.via_group_link_uri_hash` (D-083), measured identical and populated
      across 27 profiles in one group. But every profile in that sample **joined via the group link**. A
      profile that *created* the group never joined via a link and may have no hash, and a profile that
      joined by member invitation is equally untested. `root_pub_key` is empty in this schema version, so
      there is no protocol-level fallback. Sufficient for a bot joining existing groups; unresolved for a
      bot that creates one.
- [ ] **The core stores the group avatar once per membership.** `group_profiles.image` measured at 12.1 KB
      identical across 27 memberships, so one group picture occupies ~334 KB in one core database. Core-side
      storage, distinct from the archive message duplication in D-083, and it scales the same way.
- [ ] **The nginx configuration is not in the repository.** See D-081. A sanitised copy of the marketing
      vhost and the SNI splitter should be committed so the topology is not server-only.
- [ ] **Two untracked, un-ignored inventory files sit in the working tree** (`local_ai_manifest_*.csv/.txt`).
      Either ignore them or remove them; an un-ignored artefact is one `git add -A` away from being public.

**Operator-owned, still open since Season 1:** register a second passkey on the YubiKey; rotate the
break-glass password; disable break-glass once the second passkey exists.

## Verification note

This backlog was written against the code on `main`. Every "Done" checkbox was
confirmed against a named file and line; every Season 2 item was confirmed **absent**
from the codebase (no route, table, or module implementing it), not merely
undocumented. The single most important verification result: **the public
`/embed/:id` route does not exist in code** — only its admin-side configuration does.
