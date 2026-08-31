# Cinderella — Feature Backlog

> _Living document — Cinderella, Seasons 1–5. Ground truth is the code in this repository; where an earlier briefing outline diverged from the code, the divergence is noted inline. Maintained under the CCB briefing scheme, per change rather than per season, so a "last updated under" stamp here is not kept - it went stale the first time nobody remembered it (CCB-S5-063)._

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
  > **Note:** the outline lists the avatar as Done and the code confirms it — SEASON-1-PROTOCOL records it delivered (CCB-S1-014/015, [`seasons/SEASON-1-PROTOCOL.md:57`](../seasons/SEASON-1-PROTOCOL.md)). CLAUDE.md's stated invocation `npm run avatar -- <img>` is **accurate** — it matches the tool's own usage string ([`src/bot/set-avatar.ts:4`](../src/bot/set-avatar.ts)), which reads the image path from `process.argv[2]` ([`:22`](../src/bot/set-avatar.ts)); the npm script `"avatar": "tsx src/bot/set-avatar.ts"` ([`package.json:15`](../package.json)) forwards the `--` args to it. The stale point this note used to carry — that CLAUDE.md still filed the avatar under "Parked (do not build now)" — was **corrected under CCB-S5-007**.

- [x] **One image per bot** (CCB-S5-007, D-161, [`migrations/049_per_bot_avatar.sql`](../migrations/049_per_bot_avatar.sql)). `AVATAR_PATH` is one image in the environment, so with every enabled bot hosted (CCB-S5-001) a second bot could have no picture or the first one's. `cinderella_bot_profiles.avatar_path` now holds a path per bot, **NULL meaning the deployment default**, so there is no special primary case and an existing deployment keeps exactly the picture it has. Uploaded from the AI Bot page through the same `sharp` re-encode the chapter images use, decided at boot by [`src/bot/runtime/faces.ts`](../src/bot/runtime/faces.ts), proven by `npm run verify:bot-avatar`. `npm run avatar -- <img>` still stages the **deployment default**, and is primary-only by construction; a per-bot image is uploaded in the console, not staged on disk.
  > **Still single-bot elsewhere, reported and not fixed:** both `npm run connect` and `npm run avatar` act on one profile by construction. `BOT_DISPLAY_NAME` no longer names any bot's profile since CCB-S5-019 (D-173) - every bot is named from its own record - and the env value's only remaining role is the boot reconciliation that refuses a rename.

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

- [ ] **Abo-dependent, admin-configurable retention, default 10 years, auto-delete after expiry (D-027)** — nothing auto-expires today *under this feature*: the D-027 subscription-tied expiry is decided, not built. (Qualified under CCB-S5-063 because the unqualified sentence stopped being safe to quote: since migration 070 the archive DOES sweep unconsented content nightly — that is CCB-S5-054's retention floor, a different mechanism with a different reason.) Existing takedown/`/unpublish`/in-group-deletion are unchanged. The deletion mechanism must be disclosed in the Privacy Policy when built.

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
- [x] **Capability per bot (CCB-S5-021, D-175)** — whether a plugin is available is a per-bot
      setting on D-155's inherit-unless-deviated mechanism (migration 051); the intent catalog
      is built per bot rather than for the process, so a bot without a capability cannot
      produce it at any of the three layers. Everything else about a plugin, the credential,
      the quotas, the cache and the untrusted-text ceilings, stays deployment-wide, and the
      inventory saying which is which is data in `src/plugins/scope.ts`. **The knowledge base
      below inherits this shape**: enablement and the documents it is given are per bot, its
      index and credentials are not.
- [x] **Knowledge base (CCB-S5-022, D-176; controls CCB-S5-023, D-177)** — documents the
      operator uploads, chunked VERBATIM (no model-written artefacts), embedded with
      nomic-embed-text, retrieved by hybrid keyword + vector search with a calibrated
      relevance floor, a hard prompt budget and an application-written source line. Granted
      per bot. Migrations 052 and 053; needs pgvector on the server.
      **Long-term per-member memory is the same machinery over different material**, and the
      shape it should follow is written down in D-176; what it adds is consent, which is why
      it is its own work.
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
- [x] **Reconcile against the living documents and the decision log** (CCB-S4-008). The reasoning is
      recorded as **D-111** (the fourteen pre-implementation boundaries, marked clause by clause
      against the code), **D-112** (the consent double gate) and **D-113** (the private inference
      path). `architecture.md` §24 is an architecture rather than an inventory.
- [x] **Security review under the CCB scheme** (CCB-S4-008), except prompt injection. Four of the
      five questions are answered from the code in [`security.md`](security.md) §12: the endpoint is
      **not admin-settable** and the validator refuses any non-private host; what leaves the process
      is the addressed message and the bot's own draft, never archive content; the telemetry is
      content-free field by field, including the `details` JSONB; and CSRF, session, rate limit and
      step-up are enforced by **global hooks**, so no AI route can omit one.
- [x] **Prompt injection reviewed** (CCB-S4-010, D-116). The consent path is **injection-resistant
      by construction**: the gate is a conjunction over two independent evaluators of the same text,
      a third-party target is refused outright, a consent intent writes nothing, and the write is
      keyed to the sender of the confirming message. The consent path's own wording never reaches a
      model (allowlist of 9 of 36 persona keys). One gap found and closed: `status` is now locked.
      Gated in `verify:interaction`, three checks, each mutation-proven.
- [ ] **A model-emitted third-party name is not covered by mention-based redaction** (D-117).
      `blockedLiterals` carries only the sender's display name; a name the member wrote about
      someone else is in the model's input and in none of the guards, and archive redaction
      alternates patterns declared at the reply site rather than read from the finished text. By
      default only the **price** category among the personalized kinds publishes, which is the narrow
      route to the public archive. Not a local guard: the options are passing every known member name
      as a blocked literal, not publishing personalized categories, or declaring mentions from the
      finished text, which CCB-S3-007 §2 deliberately refused. **Scoped to a successor briefing.**
- [ ] **Live adversarial test against a running endpoint** (D-117). Four residuals that reading code
      cannot settle: whether a crafted message can steer the classification at all, how instruction-
      shaped text behaves, whether the model can be made to echo a third-party name despite the
      prompt forbidding it, and whether a free-mode reply can keep its required literals while
      inverting their meaning. In every case the containment means a wrong answer is the worst
      outcome, not an unauthorised action. Needs the operator's environment.
- [ ] **Decide how this subsystem relates to the plugin framework** as the function count grows
      toward the projected ~300. Two extension mechanisms now exist side by side.
- [ ] **`cloud_allowed` is a flag with no consumer.** Computed, constrained so `local_only` forces it
      false, persisted, and read by nothing that could act on it. Safe today, and exactly the shape
      `docs/planning/conversation-identity-status.md` warns about for `personality_profile`: a column
      that exists, is never consumed and defaults quietly reads as configured when nothing configured
      it. Whoever builds a provider path must treat it as unwired rather than as working enforcement.
- [ ] **Migration numbering.** Numbers 017, 018 and 019 each exist twice. Not broken (the runner keys
      on filename) but constrained: **no applied migration may be renamed**, and the number is not an
      ordinal. Allocate from **the highest number on disk plus one**, stated as a rule because the
      fixed number in this line went stale once already. See **D-069** and
      [`architecture.md`](architecture.md) Appendix §5.

### Designed but never implemented, from the local AI protocol (M1 §19, folded in under CCB-S4-008)

Recorded so the gap between what the admin surface suggests and what exists is visible.

- [ ] **Batch text, image and video categorization queue.** M1's second stated product purpose for
      local AI, alongside interactive understanding. Only the interactive foundation was built. The
      durable job queue (§22) is the obvious host for it.
- [ ] **Vision-model production pipeline.** Prerequisite for the above on images and video, and
      related to the parked AI-moderation track where `moderation_state` is the hook.
- [ ] **GPU and VRAM telemetry agent.** The AI Hardware workspace exists and reports `not integrated`
      rather than fabricated numbers, which is the honest state and should stay that way until a
      real agent exists. M1 §22 places it deliberately late, as a separate private agent.
- [ ] **Private RAG ingestion and retrieval.** Page and architecture boundary exist; no ingestion, no
      retrieval, and it stays disabled until explicitly approved (D-111 clause 12).
- [ ] **Authenticated Go reverse proxy with a bearer token, and a dedicated AI gateway abstraction.**
      The option M1 recorded for making the endpoint implementation genuinely replaceable. Today the
      OpenAI-compatible wire shape is written into both call sites and there is no provider
      abstraction, which is why D-111 marks clause 4 **PARTIAL** rather than implemented.
- [ ] **Personality training or a personality generator.** Superseded in part: the profile generator
      (CCB-S4-002 to S4-007) is that work, built offline with no runtime caller.
- [ ] **Live creation of multiple SimpleX identities from the setup assistant, and automated contact
      creation and group invitation execution.** The onboarding service stores intent only and does
      not invoke the SDK. The multi-profile runtime it depends on is MERGED and hosting every
      enabled bot since CCB-S5-001 (this row said "unmerged" long after the same file recorded the
      merge; CCB-S5-063) - what remains open is the assistant driving it.
- [ ] **Matrix transport.** Recorded elsewhere in this file; M1 §22 is explicit that SimpleX is
      finished first.
- [ ] **Rewritten README and redesigned repository banner.** Presentation work, never done.

**The intentionally inactive admin surfaces are inactive on purpose, not unfinished by accident:**
provider pages and provider boundaries, the private RAG page, the personality page and its training
boundary, the testing and comparison page, and the cloud routing controls. They render, and the
actions they imply are disabled. That is the D-111 clause 12 position: nothing is switched off,
because nothing was built to switch off.
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

## Promised in conversation and never written down (CCB-S5-059)

**Why this section exists, and it is the point of it.** Everything below was asked for by the
operator, acknowledged, and then lost - because it was passed as a sentence in a message rather
than as a briefing, a decision entry or a backlog row. A briefing starts from zero context, so a
sentence that lives only in a chat does not survive being read once.

None of this is a decision to build. It is a decision to STOP LOSING IT. Recording it also fixes
the thing the operator named last: **an item that was decided against should say so, and an item
nobody has looked at should not be indistinguishable from one that was.** So each row carries
where it actually stands.

### From the welcome plugin - four additions, specified and queued after stage 5, never built

Stage 5 closed and none of these was built. All four were specified in detail at the time.

- [ ] **Her own arrival text, per bot.** NOT LOOKED AT. When she JOINS A GROUP she introduces
      herself, and that is a different message from greeting a member: the member is being told
      the rules, she is being introduced. The event already exists and already fires on exactly
      that: `arrivalNotice(wakeWord)` in `src/consent/commands.ts:97`, whose text is the
      hardcoded `ARRIVAL_TEMPLATE` with a `{wake}` placeholder. It becomes a per-bot key
      alongside the member greeting, which is the mechanism the welcome plugin already has.
- [ ] **Which bots are eligible to greet.** NOT LOOKED AT. Configurable per deployment: only
      one bot, or several taking turns at random. The claim path already makes this safe, so
      the change is deciding WHO MAY ATTEMPT rather than adding coordination.
      **One caveat, and it must be a stated suppression reason rather than silence:** if the
      eligible bot is not in the room, nobody greets, and the operator would never find that
      himself. That is the D-205 family - a rule that quietly does nothing looks identical to
      a feature that is switched off.
- [ ] **Several greeting texts per bot, picked at random.** NOT LOOKED AT. A group with thirty
      joins a month hears the same sentence thirty times. Same shape as the retort pools, and
      **cheaper alongside the arrival text than after it**, since both turn one string into a
      list and the console work is otherwise the same work twice.
- [ ] **A second bot following the greeting with a line of its own.** REPORTED ON, NOT BUILT.
      Cinderella greets, Rick adds a remark. The report was given and its conclusion is the
      part worth keeping: the follower is told THAT a greeting happened and BY WHOM, never
      what it said. That keeps it entirely outside D-180 - nothing another bot wrote enters
      the model's context, so there is no path by which one bot's words become an example the
      other learns to imitate.

### From the channel bridge - four items, named repeatedly and never briefed

- [ ] **The key rework, from the local group id to the stable channel key.** NOT BRIEFED. The
      core's numeric group id is local to one profile and a rejoin gives the same room a new
      one, which is the standing rule in `CLAUDE.md` and the reason `origin.ts` already derives
      `channelKey` from the channel LINK. The bridge's own tables are still keyed on the local
      id, so a rejoin can orphan a record. **The reasoning was written down and the schema did
      not follow it**, which is the sentence that standing rule uses about itself.
- [ ] **Immediate first announcement.** NOT BRIEFED. A fresh post should announce on arrival
      rather than waiting for the next tick, which at a 60-minute cadence can be an hour of a
      standing announcement nobody has seen yet.
- [ ] **Cross-bot duplicate refusal, keyed on the CHANNEL rather than the group id.** NOT
      BRIEFED. Two bots subscribed to one channel can both announce it. Keying the refusal on
      the group id would be defeated by exactly the rejoin it is meant to survive, which is the
      standing rule again.
- [ ] **Incognito per bot.** CONFIRMED VIABLE, NEVER BUILT. `/_connect group #<id> incognito=on`
      was confirmed against the core.

### Two inheritance defects

- [ ] **The false shared-wake-word warning at boot.** CONFIRMED IN THE CODE, NOT FIXED.
      `src/index.ts:993` reads `effective.wakeWord === interaction.get().wakeWord`, which is
      string equality and not inheritance provenance - so two bots that happen to have been
      given the same name trigger a warning about sharing the SHARED value. It needs **two
      tests, not one**: is this bot on the inherited value or on its own, and do any two bots
      collide. Those are different questions and the warning currently asks neither.
- [ ] **Nicknames inherit.** NAMED WHILE FIXING THE ORIGIN DEFAULT, LEFT OPEN.
      `nicknames.words` still defaults to `['cindy', 'cindi', 'cin', 'ella']`
      (`src/interaction/settings.ts:1107`), so a new bot with a blank origin still answers to
      another bot's pet forms. The reason is on record and is the whole argument: **"Cindy" is
      a pet form of ONE name.** A second bot inheriting them refuses a name that was never
      theirs, which is the retort firing on somebody else's behalf.

### From CCB-S5-060 - what fetching the page would take, reported so it is not owed twice

- [ ] **The page fetch behind the web search.** REPORTED, DELIBERATELY UNBUILT (D-244, D-255).
      The briefing asked what it would take, and the answer is a briefing of its own, not a
      feature slipped in beside one. The build itself is ordinary: a fetcher in the search
      plugin (deployment-wide per `scope.ts`, like the provider credential), timeouts, a size
      cap, HTML-to-text extraction. What makes it its own briefing is the safety surface: a
      fetched page is the same untrusted text a snippet is, at two or three orders of
      magnitude more of it, chosen by whoever controls the page. It needs its own token
      ceiling, its own relevance floor measured the way `relevance.ts`'s was, the same
      fenced-into-the-user-message rule the results already have, and the D-183 discipline
      that every one of those bars is a predicate rather than a prompt sentence. It also
      needs the latency stated before it ships (a fetch plus extraction plus a longer prompt,
      on hardware where the reply time is already long enough to announce, D-251). What it
      buys: the crawl-date problem dissolves for fetched pages - a page read now is current
      now - so the snippet rule shrinks to the values she quotes from previews she still did
      not open. Until then the snippet rule is the stopgap, and it is deterministic.

### Operator decisions still unanswered

- [ ] **The 1,255 duplicate messages from 7 to 12 August.** FOUND AND COUNTED, NEVER ACTED ON.
- [ ] **The primary bot, step two.** D-173 left `selected_for_runtime` read by nothing, with its
      column, index and data still present; step two drops them.
- [ ] **`otplib` v12 to v13.** Deprecation warnings on every install. D-174's discipline
      applies: establish reachability before urgency, and read the INSTALLED version rather
      than the lockfile.
- [ ] **The deploy that hangs on a GitHub download.** Retrying usually works and **nobody has
      established why**, which is the shape D-239 warns about: a diagnosis that is available
      and unproven gets re-derived rather than tested.

### Ideas from this session, recorded before they go the same way

- [ ] **Animated cover videos**, generated with the ffmpeg that now ships: zoom, pan, a pulse on
      the beat, glitch, waveform. Configurable in the admin - on or off, which effects, how
      many, how strong. Inheritance deployment to playlist to track, **with the source of an
      effective value visible**, a preview, and the file-size cost stated, because motion is
      not free.
- [ ] **An advertising interface for spots**, as its own area, reusing the bridge's cadence
      model. And beyond advertising: **a bot announcing its own new capabilities once**, when a
      capability is switched on.
- [ ] **Video generation through Seedance on fal.ai** for marketing material. A cloud service,
      so it belongs to the declared tier and **never touches customer content**, and it needs a
      SPEND BOUND, since each call costs real money.
- [ ] **A one-time link, sent privately in chat**, opening a page that does not know who the
      member is. For settings, and for the midnight design's withdrawal path where identity
      must be proven without a form.
- [ ] **A member profile she can recite** - how many messages, how many tracks, which tastes -
      deletable in named parts. The SHAPE is already recorded in D-217; what is not recorded is
      that he asked for **the recital itself**.
- [ ] **Playing a video from their own library into the chat**, which is the same send path with
      no encode.
- [ ] **A member's uploaded MP3 entering the library**, rather than only being played once.
      Waits on the file consent work.

---

## Left open by CCB-S5-028, deliberately

- [ ] **Answer from the web and say she also has material on it.** CCB-S5-028 decided that the
      knowledge base does NOT pre-empt an explicit "look up X" on a document match (D-183): a
      score that routes a question into a corpus would be the first gate in this tree that
      CREATES a claim rather than removing one, and D-143 and D-179 both settled that naming
      the place outranks a topic match. The honest shapes are (a) answer from the web and
      mention she has material, or (b) say what she was given and offer to look. Silent
      substitution is not one of them. Needs a decision about which, plus a `lookup` prompt
      case carrying the `has-knowledge` rules and a re-baseline of `verify:prompt-identity`.
- [ ] **The adjacent band.** The relevance floor separates "about something else" from "about
      this", and cannot separate "same field, does not answer it" from "answers it": the gap
      between the lowest relevant result and the highest adjacent one was 0.0066. Those results
      reach the model, and whether she then says "this does not cover it" rests on a prompt rule
      that was measured working 5 times in 6. A cross-encoder reranker is the technique that
      would close it and Ollama still has no rerank endpoint (D-176); the seam is
      `applyRelevanceFloor`.
- [ ] **A source line still rests on the model's declaration above the floor.** Measured good
      (8/8 empty for irrelevant results, 4/4 correct for relevant ones) and not reliable (1/6
      declared sources under an explicit refusal). Nothing structural can close that while the
      only party who knows what an answer drew on is the party writing it.

---

## Left open by CCB-S5-032, deliberately — what the bridge hands the site, and what it does not build

The channel bridge (D-187) was scoped to the group side. Four things are recorded rather than
built, the first two explicitly for the operator to settle in the site repository's chat before
either side commits.

- [ ] **The structured origin's shape needs the site's countersignature.** The bridge stores
      `{ v: 1, source, channelKey, channelName, postedAt, sharedMsgId }` on every forward, and
      the console filters by `channelKey`, so the shape is proven fit for the question the
      activity stream will ask. GUESSED, and flagged per the briefing: whether the site prefers
      the raw channel link over the hashed `channelKey`, the field names themselves, and whether
      it wants the source post's text or her rendered announcement (the archive row joined via
      `cinderella_bridge_forwards.message_id` carries the announcement). Getting this wrong after
      both sides ship is a migration in two repositories; settle it in the site chat first.
- [ ] **Onward publication is a row, not a rewrite.** When the activity stream and the blog
      arrive, a new destination must be a `bridge_forwards`-shaped record joined to a published
      row, never a second forwarding pipeline. The 'bridge' publication category (migration 057,
      excluded by default) is the switch that day; nothing else should need schema.
- [ ] **Bridge media has no retention sweep.** Re-hosted channel files accumulate under
      `BRIDGE_MEDIA_ROOT`, bounded per file by `maxFileBytes` and by nothing over time. Resolved
      posts' files could be swept after their last live copy is withdrawn; that needs a decision
      about whether a withdrawn announcement's media should survive for the site's later use,
      which is exactly the onward-publication question, so it waits with it.
- [ ] **The tick does not run per-second cadences and does not pretend to.** The tick sweeps
      every minute, so a cadence is granular to the minute; the console's minimum interval is 1.
      Stated here because a sub-minute expectation would read as the bridge being late.

---

## Left open by CCB-S5-031, deliberately — the name guard's other half

D-186 fixed the MATCHING and the reporting. Two questions about the rule itself were held back
on the operator's instruction, and they are the ones that decide whether the guard is right at
all rather than merely accurate.

- [ ] **Strip rather than reject.** A reply that genuinely contains the member's name is a true
      match, and rejecting it costs the member the whole answer to punish a decoration.
      [`protected-text.ts`](../src/interaction/protected-text.ts) already refused that trade for
      forged source lines and STRIPS instead, and `unresolvedPlaceholder` rejects for a reason
      that does not apply here: stripping a leaked `{name}` leaves a hole in a sentence, while
      removing a vocative leaves a sentence. The counterargument is that a name can appear
      mid-clause where removal reads as a grammatical error, so this needs the excerpts the new
      Diagnostics card collects before it can be decided. **This is the fix for the production
      rejection that D-186 explicitly does not address.**
- [ ] **Whether the rule should exist in this form.** She is never handed the sender's display
      name; it reaches her only through conversation memory, where `speakerOf` renders every
      message as `<displayName>: <text>`. The application shows her the name on every line and
      then destroys her reply for using it, which is D-180's shape a second time. The
      alternatives are to fence the names out of what she is shown, to accept that she may
      address a member by name, or to keep the guard. Nothing here should be changed until
      `npm run calibrate:name-usage` has been run against the production model, because the
      whole question is how often it actually fires.
- [ ] **Four characters is a proxy, not a line.** No length separates a short name from an
      ordinary word, and the floor buys the common case at the cost of leaving members with
      very short display names unguarded. Revisit with the calibration and the card's counts.

---

## Left open by CCB-S5-030, deliberately — the three siblings of the rename defect

D-185 made a bot's wake word follow its display name. Renaming a bot touches three other things
that did **not** follow, all found while fixing that one and all left alone on purpose: the fix
was scoped to what the operator reported, and each of these is a separate decision rather than a
line of the same change. Recorded here with the reasoning, because the reasoning is what
propagates.

The first and third combine into one observable state worth stating plainly: **after a rename a
bot answers to its new name while still wearing its old one**, until the process is restarted.
That is a smaller inconsistency than the one D-185 removed, and it is real.

- [ ] **The SimpleX profile name a member actually sees is applied only at boot.** The console
      writes `cinderella_bot_profiles.display_name`
      ([`bot-onboarding.ts`](../src/profiles/bot-onboarding.ts), the `UPDATE ... SET slug, display_name`),
      and the only caller that pushes a name onto the SimpleX profile is `applyProfileUpdate` in
      [`host.ts`](../src/bot/runtime/host.ts), inside the boot path. So a rename is invisible in
      the group until a restart. **And for one bot it is worse than invisible**: `findRenameOnBoot`
      REFUSES the boot, naming both values, when the bot wearing `BOT_DISPLAY_NAME` has a
      different name in its record (D-173). That refusal is correct — booting would rename it in
      front of its group — but it means renaming that particular bot in the console arms a failed
      deploy, and nothing in the console says so at the moment of saving. Fixing it is either an
      on-demand profile push (the shape `faces.ts` already uses for avatars, per D-168) or a
      console refusal that matches the boot's; both are decisions about who owns the name, which
      is exactly what D-173 settled for boot and not for the console.
- [ ] **`nicknames.words` is per-bot by inventory and is never written at creation.**
      [`setting-scope.ts`](../src/interaction/setting-scope.ts) declares it `per-bot` and states
      the reason itself: *"Cindy" is a pet form of ONE name. A second bot inheriting them refuses
      names nobody called it.* Creation writes `retorts` and does not write this
      ([`bot-onboarding.ts`](../src/profiles/bot-onboarding.ts)), so every bot inherits the shared
      default `['cindy', 'cindi', 'cin', 'ella']` — pet forms of Cinderella. A bot called anything
      else therefore retorts when a member says "cindy" and stays silent at every diminutive of
      its own name. The inventory documents the harm and nothing implements it, which is the
      D-105 shape: the rule held, the check was green, the behaviour was wrong. Not fixed here
      because deriving pet forms from an arbitrary name is a language problem, not a plumbing
      one — "Cindy" from "Cinderella" is not a transformation a function gets right for
      "Bob" — so it needs either an operator-entered list at creation or a deliberate decision
      to write an EMPTY list, which is the honest default and would at least stop a new bot
      answering to her nicknames.
- [ ] **The runtime holds a display name snapshotted at boot.** `b.config.displayName` is read
      once into the hosted-bot config and used throughout [`host.ts`](../src/bot/runtime/host.ts)
      for the profile push, the avatar decision and the logs. The wake word now resolves from the
      database on every settings refresh (D-185), so the two disagree between a rename and the
      next restart. Fixing it means deciding what else must be re-read when a bot's record
      changes and where that invalidation is triggered from, which is a runtime-lifecycle
      question rather than a naming one.

---

## Left open by CCB-S5-027, deliberately

Three things the briefing's fixes name and do not build. Each is written down because the
reasoning for not building it now is part of the fix, not an oversight.

- [ ] **Per-document attribution for the knowledge base.** The application's source line names
      every document she was HANDED, not the ones her answer used, and D-180 FORECLOSED the
      obvious fix by removing the document name from what she is shown: nothing in her prompt
      identifies a passage any more, so she cannot declare indices the way `usedResults` lets
      her for web search. Building it means giving the passages opaque handles she can name
      without naming a document, and deciding whether a handle is a name by another route. The
      current line is over-broad in one direction only, which is the safe one.
- [ ] **`/search` brings nothing back.** The persona line used to end "Shall I bring them to
      you?" and nothing answered a "yes": carry-over is PRICE-only by design, so the reply
      reached free conversation. CCB-S5-027 removed the offer rather than leaving an unkept
      promise beside a false premise it was fixing. Actually listing or linking the matches is
      a feature, and it needs a decision about what a member may be shown in chat that the
      public archive does not already show them.
- [ ] **Five persona lines cannot be guarded.** `markersFromTemplates` needs a literal in front
      of a template's first placeholder, and the price quotes (`price`, `conversion` in both
      languages, and `de.priceUnknownAsset`) open with an emoji and an asterisk. A model could
      therefore write a price line in her format and it would not be stripped. The Diagnostics
      card states the number. Fixing it means rewording member-facing price copy, which is a
      decision about her voice rather than about this guard.

---

## Operator-owned open items (carried into Season 2)

These are not code tasks — they are actions only the operator can take. Source:
[`seasons/SEASON-1-PROTOCOL.md`](../seasons/SEASON-1-PROTOCOL.md) Part C.

- [ ] **Register a second passkey, then close the break-glass path.** Enrol passkeys on ≥2 devices (a YubiKey 5-series has been ordered — the current YubiKey 4 predates FIDO2 and cannot store passkeys), then disable break-glass and **rotate the break-glass password** (it was exposed in plaintext in an implementation report). The toggle and rotation surface live on the Security page ([`src/web/views/security.ts`](../src/web/views/security.ts)); the decision to flip them is the operator's.
- [ ] **Add a read-only deploy key on the VPS** so deployment can `git pull` normally instead of shipping via `git bundle`.
  > **Note:** [`seasons/SEASON-1-PROTOCOL.md:94`](../seasons/SEASON-1-PROTOCOL.md) (Part C §2) describes the repo as **private** ("deploying via `git bundle` … the repo is private"). This contradicts [`CLAUDE.md`](../CLAUDE.md), which states once, at [`CLAUDE.md:25`](../CLAUDE.md), that "The repo is **public**." (CLAUDE.md's other uses of "public" — the admin console, the SimpleX group, the web archive, the `/embed` widget — do not refer to the repository.) The two standing documents disagree on repository visibility; this backlog reports the discrepancy rather than resolving it. Either way, the pre-push secret-grep discipline applies.

---

## Backups and disaster recovery (CCB-S3-028) — the largest single operational risk

Verified against the production host on 2026-07-27, not inferred.

- [x] **A trigger exists** (CCB-S4-011, D-118). `deploy/cinderella-backup.timer` and its service unit are
      in the repository: daily at 03:30, `Persistent=true` so a host that was off catches up on boot,
      output to the journal, non-zero exit on a failed dump. **Installing and enabling them on the VPS is
      an operator step**, documented in [`deploy/BACKUP.md`](../deploy/BACKUP.md) §3. Until that is done
      the host still has no backups; the repository half is what this briefing could deliver.
- [x] **Two install-time defects fixed** (CCB-S4-012), both found on the VPS and both real repository
      defects. The env file was read with `set -a && . "$ENV_FILE"`, which EXECUTES it: under `set -u`
      the admin Argon2 hash `$argon2id$v=19$...` parsed as a reference to an unset variable and aborted
      the unit at env line 9, before anything was written. The file is now read as **data**, extracting
      only the four keys the script uses, on the same principle `deploy.sh` already applied. And the
      executable bit was not stored in git, so a fresh checkout failed `203/EXEC`; the tree mode is now
      `100755`. The round trip is re-proven against an env carrying a synthetic Argon2-shaped value,
      which is the case the CCB-S4-011 fixture missed.
- [ ] **Confirm on the VPS after the first real run** (owed by CCB-S4-011, which could not run systemd or
      verify file modes on a Windows workstation): that `OnCalendar` fires and `Persistent=true` catches a
      missed run, and that the archives really are `0600` in a `0700` directory. `BACKUP.md` §6 lists both
      as owed and says how to check.
- [x] **Two defects in `backup.sh` found and fixed** (D-118), both demonstrated. A failed `pg_dump` left a
      **zero-byte dump that counted as a generation** and could push a good one out of retention, because
      the dump used a shell redirect; and retention piped `ls` over a glob, which under `set -o pipefail`
      **aborted the whole script** for any kind with no files yet.
- [ ] **The key is backed up beside what it unlocks.** `backup.sh` does copy the env file carrying
      `MEDIA_SECRET` (correcting an earlier note above), but into the same backup directory as the
      encrypted media. A single lost or stolen backup is then either a total loss or a total disclosure.
      The key belongs somewhere the operator controls separately. There is no key history: rotating
      `MEDIA_SECRET` destroys the archive.
- [x] **Quarantine bytes are in the backup set** (D-118 decision 1). Derived exactly as
      `resolveQuarantineRoot()` derives it rather than hardcoded, so a host that moved it stays covered.
      Its own 14 generations.
- [x] **The restore procedure re-applies deletions** (D-118 decision 3), in
      [`deploy/BACKUP.md`](../deploy/BACKUP.md) §5. The question of whether it was implementable is
      answered: **one of the three cases is automatic** (a destruction requested before the dump has its
      `pending_destructions` row inside the dump, and the sweeper re-applies it on start), and the other
      two are replayed by diffing the restored generation against a newer surviving one. Revocation is the
      dangerous case, because nothing is missing: content simply becomes public again.
- [ ] **The privacy-policy clause: wording confirmed, not yet shipped, and it ships ELSEWHERE.** The
      operator supplied the binding German on 2026-08-02 and it is recorded verbatim in **D-118**. It does
      **not** land in this repository: the legal texts left with the marketing site (D-089), so the clause
      belongs in [`cind3r3lla-site`](https://github.com/saschadaemgen/cind3r3lla-site) at
      `src/pages/legal.ts`, in the existing section "Grenzen der Löschung, ehrlich benannt" which already
      says copies persist in backups until they expire. **That is a site briefing**, with a site id, and it
      is not in this register. Carried here only so the confirmed wording is not lost between the two
      repositories. One flagged, unacted observation on the German is in D-118.
- [ ] **Deletions after the newest surviving dump are unrecoverable, by construction.** Nothing records
      them outside the database that was lost. The exposure window is the time since the last successful
      backup, which is the operational argument for the timer being enabled rather than merely committed.
- [ ] **Backup encryption is unresolved.** `backup.sh` does not encrypt. Open decision, with the tradeoff:
      encrypting under a key separate from `MEDIA_SECRET` protects the dump but adds a second key whose
      loss is equally fatal; a pull model (the backup host reaches in) means a compromised server cannot
      reach or destroy its own backups, but requires standing credentials on the backup side.

**That open question is ANSWERED** (D-118 decision 2): the messaging-core database **is** backed up. The
identity argument won, and the privacy argument became a handling requirement rather than an exclusion.
Because it holds unencrypted content, its archive is `0600` in a `0700` directory and `BACKUP.md` states
that plainly so a later reader does not loosen it. It is snapshotted with `sqlite3 .backup` for
consistency against a live database, and when `sqlite3` is absent the script still copies but warns on
every file rather than passing a weaker backup off as a good one.

**Standing constraint (not an open question):** quarantine material must never reach a private machine.
Suspect material on a personal computer is a materially different legal position from the same material
under a documented custody process on a server. No restore or debugging procedure may pull it locally.

## The profile generator — all five components built, no runtime caller

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
- [x] **Bio generator** (CCB-S4-006) — `npm run verify:bio`, 26 checks. See D-102,
      including the three defects that every population statistic passed and only
      reading twenty-six actual bios found.
- [x] **Profile assembly and review** (CCB-S4-007) — `npm run assemble`, three views plus
      a pre-filled review record. `npm run verify:assemble`, 22 checks. See D-103.
- [ ] **FIRST FINDING FROM THE CROWD VIEW: names do not look like their culture.**
      `crispin sinclair`, origin `de`, drawn for culture `de`, writing a German bio under
      an English name. This is CCB-S4-002's documented gap — "culturally coherent names"
      needs a labelled corpus and the fixtures stand in for one — but it was abstract
      until names and bios were rendered side by side, and then it was the first thing a
      reader noticed. Needs the labelled corpus; `corpus.ts` documents the swap point.
      Related: five surnames repeat across 200 profiles (dalgleish, draywood, Brannigan,
      de Jong, Blackwood), which is the fixture pools being small.
- [x] **Bio text moved to a model; the template pool is now the fallback** (D-104) —
      `--engine model`, conditioned on the personality the deterministic layer produces,
      cached on seed + conditioning version + model identity so a seed still reproduces
      its bio. `npm run verify:bio-model`, 33 checks with the transport faked. Ten defect
      classes found by reading, of which nine were language and one was not a defect at
      all. Three were engine-independent and fixed regardless (shared slot pool, per-
      language lower-case gate, em-dash out of the separator pool), each with a named
      regression gate in `verify:bio`.
- [ ] **Author bio templates for the remaining origins.** Avatars whose origin has no pool
      fall back to English. Language now walks the WHOLE origin blend and takes the first
      authored language rather than the top origin only (D-104), so a real second language
      is no longer discarded, but es, fr and nl are still outstanding (D-102). Lower
      priority than it was: the model path writes any language it knows, so this only
      matters for the fallback, which is meant to be used when nobody is reading.
- [ ] **The fallback pool is visibly repetitive, by design and worth watching.** After the
      shrink the most common clause form is 12.1 percent of all clauses, against 4.6
      percent for the large pool that produced the bad text (D-104). That is the accepted
      trade: plainly correct and repetitive beats varied and wrong. If the template path
      ever becomes something a person reads, this is the number that has to move.
- [ ] **NO PROPER NOUNS ANYWHERE. The deepest defect a read has found, and it survives
      fixing everything else.** Five independent readers over 82 bios (D-107): not one
      city, year, employer, band, book or URL in the whole population. No real set of
      self-written profiles could look like that. Neither engine can produce it, because
      the deterministic layer has nothing specific to hand over: it draws origins, age
      bands and interests, and never a place or a job or a date. This is a CONDITIONING
      gap, so it belongs to the surface layer rather than to the bio writer, and it is
      probably the highest-leverage single item left in the workstream.
- [x] **DECIDED: which languages the model may be asked for.** `qwen3.5:9b` makes outright
      grammatical errors outside German and English, at six of eighteen bios: `horne` for
      `horneo`, `je parcoure` for `je parcours`, `cocinador` (not a Spanish word). Not a
      prompt defect and not fixable by prompting; tightening the recitation gate merely
      swapped one Spanish recitation for a conjugation error (D-107). Three options were
      recorded; **the first is taken** (D-109): `ModelBioConfig.languages` defaults to
      `['de', 'en']` and out-of-scope profiles get no bio at all rather than a bad one.
      Running a larger model remains the way to lift it, and is a platform decision.
- [x] **The out-of-scope language drop is now printed** (CCB-S4-008). `runModelPass` collected
      `outOfScopeLanguage` per language (D-109) and `scripts/assemble.ts` printed every other
      figure except that one, so a run dropping a large share of its candidates still reported
      `0 failed` on the only path a person uses. It now prints the per-language drop and its
      share of candidates, confirmed live: `nl 6, es 5, fr 3`, 40.0 percent.
- [ ] **The two engines fail differently, and the comparison is not one axis.** The model
      path is caught by a SINGLE bio read in isolation (coined compounds, simile, matched
      couplets, drift into third person); the template path is only caught ACROSS the
      corpus (repetition). So "which is better" depends on whether one profile or a whole
      member list is being looked at, and the model path's per-bio tells are the ones to
      work on next (D-107).
- [ ] **Emoji are drawn independently of the interests, on the template path only.** A
      telescope turned up on a baking profile. The model path has no such defect by
      construction, since the model writes its own emoji into the text; fixing it in the
      template path means tying the emoji pool to the interest, which is pool authoring.
- [ ] **Profile creation, when it arrives, must not call `apiCreateActiveUser` directly.**
      The SDK's `mkBotProfile` mutates the profile to set `peerType = Bot` and allow
      files; skipping it produces profiles that silently cannot receive media, and nothing
      surfaces until someone posts a picture. Use `botProfileFor` from
      [`src/bot/runtime/core.ts`](../src/bot/runtime/core.ts). Recorded now because the
      generator is the workstream most likely to hit it.
- [ ] **Population layer** — composing a room rather than an avatar: who is in it, in what
      mix, with what collision behaviour. The trait sampler takes `archetypeMix` as an
      input and deliberately makes no claim about what a realistic one is.
- [ ] **Validation layer, bios, avatars, persistence** — none started.
- [ ] **Wiring any of it to the runtime.** Nothing outside `src/generator/` imports it and
      no migration writes its output; D-082's schema position is unchanged. Note before
      starting: the build does not copy the modules' `data/` JSON into `dist/`, which has
      never mattered because both harnesses run from source through `tsx`.

## From the planning package, not yet reflected anywhere else (CCB-S4-008 Stage 5)

Gaps found by reading [`docs/planning/`](planning/) against the code and the decision log.
The package is history, not authority (D-110); these are the items where it describes
something the repository does not have and the gap is worth carrying.

- [ ] **The biography layer, as a specified component.** `decisions-reader-workflow.md` §1
      calls it "the highest-leverage open item" and specifies it: place, occupation, tenure,
      a small number of specifics, optionally a URL, plus three constraints that matter more
      than the field list (most avatars have almost none of it and specifics correlate with
      activity tier and conscientiousness; **do not derive occupation from personality**, the
      `drawIdentity` rule again; places follow the origin blend, which hits the same
      labelled-corpus gap as the names). The **gap** is already in this file as "NO PROPER
      NOUNS ANYWHERE" (D-107); what is missing is the **specified shape above**, which no
      decision records. Both text engines are limited by the same missing input, so this
      precedes further work on either.
- [ ] **The whole avatar half of the personality model is unbuilt**, and nothing in the
      decision log says so. Verified absent from `src/`: designed characters,
      trigger profiles, disclosure labels as a generator concern (Addendum A), the
      motif × style deck and any image generation, and Addendum B's four configuration
      layers (wizard, presets, panels, raw). `avatar-personality-model-v2.md` layers 1, 2
      and 4 are built (traits, surface, visible profile); layer 3 (population) and layer 5
      (validation) exist only as far as `assemble/` and the per-component harnesses go, not
      as the specified layers.
- [ ] **The conversation-identity question needs one query against a populated database.**
      `conversation-identity-status.md` settles that a `groupId` identifies a *membership*,
      that `group_profile_id` is disqualified, and that consent identity survives
      multi-profile because it keys on `sender_member_id`. What is open is whether
      `public_group_id` or `group_link` in `group_profiles` is populated and identical
      across profiles sharing a group. It cannot be answered on a fresh instance, and
      `docs/planning/check-group-identity.js` and `scan-group-identity.js` are the probes for
      it. Worth running **before** the multi-profile runtime writes its first row: retrofitting
      a conversation identity after duplication starts is a data migration rather than a
      schema decision. Note the counterpart the same document raises: `shared_msg_id` is
      captured and persisted today but nullable with no index, and a canonicalisation that
      silently skips null rows would be worse than none.
- [ ] **Archive storage was never measured.** `conversation-identity-status.md` closes on
      this and it is easy to miss: the measurement report covers **runtime** cost only.
      Archive storage scales with messages multiplied by participating profiles, which is a
      different factor from cost per event, so any sizing taken from the measurement report
      alone understates storage for a multi-profile deployment.
- [ ] **Four specification decisions in `open-items.md` §4 are still open**: rhythm-only
      archetypes composable with trait archetypes or not; how an operator's own trait profile
      is obtained; and whether `Personality` is persisted or recomputed (the document
      recommends persisting with the seed, and D-104's cache keying already implies it for
      bios without deciding it for personality). The fourth, model-backed text generation,
      **is** decided: D-104 and D-109.

## Two harnesses were RED on `main` (found under CCB-S4-008, fixed under CCB-S4-009)

Both arrived with the unbriefed AI block and failed from 2026-07-28. Full account in
[`architecture.md`](architecture.md) §24.7 and **D-115**.

- [x] **`verify:admin-brand-fx`** — the operator ruled that D-088 governs, so the assertion was
      inverted and broadened to "no plain-spelling product reference survives anywhere in the admin
      chrome". Mutation-proven in both directions.
- [x] **`verify:admin-navigation-shell`** — stale against D-089, which moved the marketing site out
      and took `/website` with it. Aligned to the three children the System root ships, plus a new
      assertion that the retired page has not returned. Mutation-proven in both directions.
      **CCB-S4-008's stated cause was wrong** and is corrected in §24.7: the `data-section` attribute
      is interpolated and does render; the failing conjunct was the `/website` link.
- [x] **The backup console's run-now button was invisible, and is fixed** (CCB-S4-015). It shipped with
      `bg-cinder-600`, and there is no `cinder` colour anywhere in this project: Tailwind v4 is CSS-first
      here with no config file and `assets/app.css` defines no such token, so Tailwind emitted nothing.
      Measured on the live page, the old class computed to `background: rgba(0,0,0,0)`, `border: 0px` and
      `cursor: default`: literally bare text in an empty frame. Now `setup-button setup-button-quiet`,
      the console's own system, verbatim what "Reset workflow" uses. **Both classes are required**, which
      is the part worth remembering: `setup-button` carries the shape and the `-quiet` variant carries
      only the colours. Also added self-limiting htmx refresh so a requested run appears without a manual
      reload. Gated by 9 further checks in `verify:admin-views`, mutation-proven.
- [ ] **Decide what a red harness from the unbriefed block means for the standard set.** These two
      sat red for four days because they were in no completion report and no routine. The full set is
      41 of 41 green as of CCB-S4-009, so the question is now about keeping it that way: either the
      whole set must be green before a push, or the ones nobody owns are retired. Leaving any of them
      red teaches everyone to ignore a red run, which is worse than either.

- [ ] **`BOT_DISPLAY_NAME` silently regressed away from D-088, and is still wrong on `main`.** Found
      while verifying the brand under CCB-S4-009, outside its scope, so recorded rather than fixed.
      `9d11bb0` implemented D-088 by setting the default to `CIND3R3LLA`; `80f26b4` on the same day,
      a **consent-messaging fix**, changed it back to `Cinderella` with nothing in its message about
      the brand. That is a collateral revert, the broad-source-replacement hazard CLAUDE.md warns
      about, and D-088 explicitly lists `BOT_DISPLAY_NAME` as following the product name.
      `.env.example` also still says `Cinderella`. **Deliberately not fixed here**: it changes
      `src/`, it changes a member-facing identity, and the live value depends on the production
      `EnvironmentFile`, which cannot be read from the repository. Needs an operator decision plus a
      deploy, not a hygiene edit.

## Public front: the BIGINT bounds are not layered evenly (found under CCB-S4-008)

- [ ] **Two of the three public routes have no second line of defence against an oversized
      message id.** Found by *proving* the new regression gate rather than by reading the
      code: `getPublishedItem` carries its own `MAX_SAFE_INTEGER` bound (CCB-S3-025 review),
      so `/embed/:id/m/:msgId` stays a clean 404 even with its route guard deleted.
      `getPublishedMedia` and the `isPublished` path carry **no such bound**, so for
      `/embed/:id/media/:msgId` and `POST /embed/:id/report` the route guard is the only
      thing between an oversized id and a 22003/22P02 that 500s. All three are gated by
      `verify:public` now, so a deletion goes red either way. The open question is whether
      the data layer should be symmetric, which is a small change and deliberately **not**
      made under CCB-S4-008's "nothing further" scope.

## The multi-profile runtime — merged, wired, and now hosting EVERY enabled bot (CCB-S4-004, D-096; merged under CCB-S4-020; wired under CCB-S4-021, D-125; plural under CCB-S5-001, D-155)

Built on `feature/multi-profile-core-foundation` and merged to `main` on 2026-08-03 after
its review and the three pre-merge verifications of CCB-S4-019. Architecture §32 has the detail.

**Superseded twice since this section was written.** It said "nothing calls it: `startBot()` is not
wired, so the modules ship dormant". CCB-S4-021 wired one bot onto it (D-125), and CCB-S5-001 made
`startRuntimeHost` host **every enabled bot** (D-155), removing `BOT_RUNTIME_HOSTING` and the
pre-runtime `bot.run` boot path entirely. `startBot` survives only for `npm run connect`. The
checkboxes below are the state of the *foundation* and remain accurate; the "not wired" framing is
history. What CCB-S5-001 deliberately left is in
[`../seasons/SEASON-5-HANDOVER.md`](../seasons/SEASON-5-HANDOVER.md).

- [x] **Runtime, scheduler, router, state machine, benign-noise allowlist** —
      `src/bot/runtime/`. `npm run verify:multi-profile`, 80 checks.
- [x] **Persistent bot registry** — migration 023 + `src/profiles/bot-registry.ts`. Actor
      types, automation modes, avatar sources, disclosure labels, the three-part
      personality reference, and the §14 safety invariants split between CHECK
      constraints and audited application logic.
- [x] **Two SDK workarounds** — the reactions defect (both directions throw although the
      operation succeeded) and `apiSendMessages` discarding the sending user.
- [ ] **Two bots in ONE group.** Still not supported, and now DETECTED rather than merely
      warned about in a document (CCB-S5-001). Each bot captures its own groups, which is a
      bot per group and is the supported arrangement. Two bots in one group would store two
      copies of every message with two consent derivations, so the condition is raised to
      the admin dashboard by name; it is not refused, because that would make a bot go deaf
      in a group the operator deliberately put it in. Supporting it properly still needs
      `via_group_link_uri_hash` canonicalisation first (D-083), and note that canonicalising
      would also collapse the accidental per-bot isolation of the moderation counters - which
      is why migration 044 made that dimension explicit before the day arrives.
- [ ] **Conversation canonicalisation** via `groups.via_group_link_uri_hash`. Do not make
      the column `NOT NULL` until the group-*creator* path has been checked against a
      database containing one; all 27 sampled profiles had joined via a link.
- [x] **Wiring one bot onto the runtime** (CCB-S4-021, D-125). `src/index.ts` boots through
      `startRuntimeBot`; capture, the interaction layer and the file receiver are fed from
      the router instead of the SDK's subscriber table, with no change to their logic.
      Proven live: boot, readiness, receive, attributed send, quoting reply, consent
      command, and a restart that adopts the existing profile.
- [x] **Onboarding step 1 of 4: create the contact address** (CCB-S4-022, D-126). The
      wizard described this step and had no control behind it. It has one now, it produces
      a real link through the running runtime, and the workflow state advances only on a
      link the core returned.
- [x] **Onboarding step 2 of 4: accept the contact request** (CCB-S4-023, D-127).
      `receivedContactRequest` is routed, recorded in the listener, presented with the
      requester named, and accepted or rejected through the runtime. Proven live on both
      sides with a second SimpleX core.
- [x] **Onboarding step 3 of 4: join the group** (CCB-S4-025, D-129).
      `receivedGroupInvitation` and `userJoinedGroup` are routed, the invitation is
      recorded on arrival, and the join records the role the core reports. Proven live on
      both sides through steps one and two on real relays.
- [ ] **Onboarding step 4 of 4: verify and adjust the role.** `apiListMembers` to read it
      and `APIMembersRole` to change it, reaching `role_verified` and then `ready`. The
      three roles are already stored apart (D-129), so this step compares rather than
      guesses.
- [ ] **Declining a group invitation is not built.** There is no reject command for an
      invitation the way there is for a contact request; refusing means deleting the chat.
      An unwanted invitation currently sits pending on the page forever.
- [x] **Free conversation, the raw test** (CCB-S4-027, D-131). Addressed, no command
      intent, model writes the reply. Commands are untouched and proven so.
- [x] **Relaxed addressing now means what its label says** (CCB-S4-028, D-132). A bare
      leading name was classified as an address all along and then discarded by the
      weak-signal silence guard one branch later.
- [ ] **Conversation has no history.** Every turn is the current message alone, so she
      cannot follow a thread. History, persona cards, sharpness and motif are the
      personality work proper.
- [ ] **Model output can carry envelope artefacts.** One live conversational reply ended
      with a stray `}` from the structured-output envelope. Cosmetic, seen once in two
      replies, deliberately not pattern-matched away in a raw test.
- [ ] **Widening the personalized reply set is the personality work's first question.**
      Nine of the 36 persona keys may be model-worded (D-130); the rest are deterministic
      because they can change consent or report an action. An operator who mostly exchanges
      greetings and consent commands will therefore never hear the model, which reads as a
      broken feature and is the product working. Any widening is a consent-safety decision
      and needs the injection review's attention, not a config toggle.
- [ ] **Automatic contact acceptance is stored and not honoured.** `auto_accept_contacts`
      defaults to true and the accept is manual regardless: nothing reads the flag. That
      is the safe direction, and it is a setting that currently means nothing, which is
      its own kind of dishonesty. Either honour it or say on the page that it is not read.
- [x] **Nothing links an onboarding record to a runtime profile except the operator's
      `selected_for_runtime` flag.** Overtaken. Migration 044 put `simplex_user_id` on
      `cinderella_bot_profiles`, which is the link, and CCB-S5-019 (D-173) removed every reader
      of the flag: the create-address action is given a bot id and resolves the hosted identity
      from that. What remains is the flag's own retirement, below.
- [ ] **Drop `selected_for_runtime`** (step two of D-173). Nothing reads the column since
      CCB-S5-019; creation still writes it so it stays coherent, and the unique partial index
      `cinderella_one_runtime_bot_profile_idx` still exists. The migration drops both, and takes
      with it the INSERT's `NOT EXISTS (...)` computation, the duplicate-key message in
      `bot-onboarding.ts` that names the index, and the fixture columns in `verify:adoption`,
      `verify:interaction-scope`, `verify:multi-bot`, `verify:two-names` and
      `verify:multi-bot-live`. Deliberately a separate briefing: a deployment runs for a while
      with nothing reading a column that still exists, which is the state where a missed reader
      is a defect rather than a failed migration.
- [x] **Hosting EVERY enabled profile** (half two, CCB-S5-001, D-155). `startRuntimeHost`
      hosts `cinderella_bot_profiles WHERE enabled = TRUE`; each gets its own event source,
      file receiver, engine, consent handler and capture registration. `deleteFromCore` now
      resolves the owning bot from the group id rather than taking one.
- [ ] **Per-profile `status`.** The dashboard still reports one bot-running state for the
      deployment. With several hosted, one bot failing to reach ready is not visible as
      distinct from all of them failing. `FileReceiver` is per bot now, so the `(userId,
      fileId)` keying that item asked for is moot; the `userId` dimension on
      `runtime-policy.ts` is still open.
- [x] **The call sites that reached the core outside the scheduler** (D-125, closed by
      CCB-S5-001). **There were five, not three.** D-125 named core erasure, the consent
      fallback and `flushAvatarToGroups`; `recital-port.ts` (CCB-S4-047) and
      `enforcement.ts` (CCB-S4-035) were added after that list was written and nothing
      pointed at them. The second is the moderation path: `apiSetMembersRole`,
      `apiBlockMembersForAll` and `apiRemoveMembers` all take a group id and no user id.
      All five now route by group owner through the scheduler, except the consent fallback,
      which was unreachable code and was deleted. See D-155 for the table.
      **Standing lesson:** a list of "revisit these later" call sites goes stale the moment
      somebody adds a sixth, because nothing in the code points back at the list. The
      replacement is structural - `runtime.runForGroup` is the seam, and a new site that
      does not use it is a new site that names no bot.
- [ ] **Per-bot avatars.** `AVATAR_PATH` is one image in the environment, applied to the
      PRIMARY only (CCB-S5-001). Writing it onto every hosted profile would give every bot
      the same face, which reads as deliberate and is not; a second bot with no picture reads
      as unfinished, which it is. `cinderella_bot_registry` already carries `avatar_source`
      and `avatar_ref` for this.
- [ ] **Whole rulebook profiles**, with export and import. The clean answer if the operator
      ever wants genuinely different outermost limits for a community (an adults-only group
      behind an AVS). Explicitly NOT per-bot suspension of a constitutional law, which
      CCB-S5-001 refuses in three places on purpose.
- [x] **The onboarding console pages do not yet name their bot.** Done. CCB-S5-007 threaded the
      views through so every onboarding step acts as the bot it was given, and CCB-S5-019
      removed `hostedIdentity`'s fallback to the primary altogether: the id is required, and an
      unhosted one raises rather than acting as somebody else.
- [ ] **Close the boot event-loss window.** Capture subscribes after `startRuntimeBot`
      returns, so an event in between reaches a tag with no handler. Narrower than the
      pre-runtime path's and now COUNTED (`RoutedEventSource.unhandled`, with a
      `status.error` when a `newChatItems` is among them) rather than assumed empty.
      Closing it means buffering and replaying at boot, which is a behaviour change and
      was out of scope for a cutover briefing.
- [ ] **The readiness constants are compile-time.** `QUIET_PERIOD_MS` (10 s) and
      `READY_CEILING_MS` (120 s) are not reachable through `RuntimeOptions`. Measured on a
      live core: the last subscription event lands within a second or two on a small core,
      so a restart leaves the bot mute for about ten seconds waiting out the quiet period
      rather than waiting for subscription work. Nothing has measured a better value, so
      nothing was changed; this is what a briefing that wants to change one has to beat.
- [ ] **`degraded` is still never entered.** The state exists and `RuntimeStateMachine`
      exposes it, and nothing in `core.ts` calls it, so a core fault leaves the runtime
      reporting `ready`. D-096 ships it untested deliberately; a trigger needs the network
      interruption D-085 never measured.
- [x] **`/_start` subscribes every user in a shared database** — verified two ways, and
      it is the assumption the whole design rests on. 26 of 26 non-active profiles
      received one message with the active user parked on a non-participant; and the
      core's startup path calls `subscribeUsers` over the full user list. Architecture
      §32 carries the evidence. This is what made profile rotation unnecessary.
- [x] **The outgoing-event axis** — settled against a live core under CCB-S4-019 (D-124):
      there is no `newChatItems` event for one's own send at all, and the outgoing
      `chatItemsStatusesUpdated` events carry the true sender's `userId` even when
      delivered after the active user has been switched.
- [ ] **Live-core verification of the remaining items** — the *timing* of those
      measurements, the 10 s / 120 s constants, `degraded`, and whether `fileId` is unique
      across users in one core database.

## Carried into Season 4, and still open in Season 5 (recorded under CCB-S3-028)

_Re-checked at Season 4's close under CCB-S5-003: none of these was delivered in Season 4, and they
carry forward unchanged. They are listed separately from the Season 5 section above because their
findings and corrections belong with the briefing that produced them._

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
- [x] **All high-severity npm advisories are closed** (CCB-S4-013). `npm audit` reports **0
      vulnerabilities** at every severity. Deliberately split into two commits by risk class, so either is
      revertible alone. **Class A**, four non-breaking lifts inside their existing major lines via
      `npm audit fix` and never `--force`: `@fastify/static` 10.1.0 to 10.1.2 (the sharp one, an
      **authorization bypass** via non-canonical URL paths plus a route-guard bypass via path traversal,
      on the public HTTP path), `find-my-way` 9.6.0 to 9.7.0, `fast-uri` 3.1.3 to 3.1.5, `brace-expansion`
      1.1.16 to 1.1.18, with `fastify` deliberately held at major 5. **Every nested copy was checked**, not
      only the top-level one. **Class B**, the `sharp` major bump to 0.35.3 closing four libvips CVEs,
      recorded as **D-119** with each of the three call sites verified by exercising it.
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

## The announcement's condition is correct BY PLACEMENT, not by design (found under CCB-S5-037)

`shouldAnnounce` ([`../src/interaction/lookup-announcement.ts`](../src/interaction/lookup-announcement.ts))
takes three arguments - the lookup KIND, the verbosity dial, and the measured characters-per-second -
and returns whether to say "let me check that". **None of them is a statement that the member asked
anything.** It answers "would the reply be slow enough to be worth warning about", which is a
different question and a good one, but it is not the question the announcement's truth depends on.

It is nevertheless correct today, for the knowledge lane, because of where it is CALLED:

```ts
if (knowledgePassages.length > 0 && this.lookupAnnouncementDue('knowledge')) {
```

Passages exist only when retrieval returned something above the floor, and since CCB-S5-037 retrieval
only runs when the message has retrievable content. So the guarantee is assembled from a predicate in
`engine.ts`, a floor in `retrieval.ts`, and an `&&` at the call site - and `shouldAnnounce` itself
would happily announce a lookup for a heart emoji if anybody ever called it one line earlier.

**This is the season's defining defect class and it is worth naming as such.** D-183: a bar that lives
only in a prompt is not a bar. D-190: "one bot per room" was the phrase everyone remembered and the
guarantee was about the capturing RECORD. D-192: absence of a switcher was being used to mean
"deployment-wide". Each was a property that held by placement and was described as if it held by
design, and each was found in production rather than by a check. This one is the same shape, caught
before it broke rather than after, which is the only difference.

**What to do about it**, for whoever touches that path next:

- [ ] Move the condition INTO `shouldAnnounce` rather than relying on the caller: it should take what
      the member actually said and refuse on its own account. The web lane returns `true`
      unconditionally at the top of the function, which is the same hole with a different lane in it.
- [ ] Then assert it directly - the current checks drive the engine, so they prove the composition
      rather than the function, and a future caller that gets the order wrong would pass them.

Until that is done, **the ordering in `engine.ts` is load-bearing and must not be rearranged**: moving
the announcement above the retrieval, or reusing `shouldAnnounce` from a lane that has not already
proven it has something, reintroduces the CCB-S5-037 defect exactly.

---

## Carried into Season 5 (recorded under CCB-S5-003)

The narrative is in [`../seasons/SEASON-5-HANDOVER.md`](../seasons/SEASON-5-HANDOVER.md) and the
concept work in [`../seasons/concepts/`](../seasons/concepts/); this is the item list, and it is the
authoritative one. Nothing here is new work invented at close-out: every line was already open at the
end of Season 4.

**The Avatar layer, in three pillars.**

- [ ] **Arm the moderation.** Built, reversible and shipped **locked** (D-139). Not a build: setting
      the `EnforcementPort` and turning `mode` off `observed`. It waited on a live group that was not
      the operator's own, which CCB-S5-001 has now made ordinary. Needs an evening, a second profile,
      and the five proofs listed in [`../seasons/concepts/avatar-layer.md`](../seasons/concepts/avatar-layer.md).
- [ ] **The privileged moderation channel** — take over, steer, approve. **The authenticity question
      must be settled first**: a member cannot tell her voice from the operator's wearing it, and the
      archive would record it as hers either way. Not a UI question.
- [ ] **The learning path** — RAG, long-term memory, and a correction path that turns "not like that"
      into something stored. Governed by two existing rules: anything stored from a conversation is
      untrusted text (D-147), and anything that shapes what she says next is a rule, so it must be
      readable (D-144, D-146). Correction path first, retrieval last.

**Platform.**

- [ ] **A self-tuning request queue with honest feedback.** Measured: ~7 s per reply, **two** model
      calls per addressed message, `LOCAL_AI_TIMEOUT_MS` capped at 60000 and defaulting to **15000**
      (`src/config.ts:348`). So ~8 concurrent requests reach the ceiling and ~2 reach the default. A
      member who will not be answered in budget must be told, in her voice, before the budget expires
      — CCB-S3-023 applied to load.
- [x] **The channel bridge plugin** — SHIPPED (CCB-S5-032, D-187; publishing to the website per
      channel since CCB-S5-043, D-215). Channel posts arrive as standing announcements with origin
      attributed, never passed off as hers; edits recompose, deletions withdraw, media re-hosts at
      intake. The open questions resolved: one-way (no reply-back), and attribution renders via the
      structured origin on all three surfaces. This row sat unchecked for eleven briefings after the
      feature shipped (CCB-S5-063).
- [ ] **The gallery**, coordinated with the site repository, cheapest first: ranking with **no model**
      (counting and sorting on the stable `senderMemberId`); then linked video from the metadata that
      arrives with the link; then images through a vision model; then uploaded video. **Settle the
      consent question at stage 1: do tags follow an unpublish?** Stages 3 and 4 need the queue above.
- [ ] **The hardware page** with GPU metrics — needs a sidecar on the operator's own machine.
- [ ] **The model reachability display.** Three Season 4 incidents cost hours for one reason: model
      reachability is not visible in the console. Must distinguish *not configured* from *configured
      but unreachable* from *reachable but slow*, since "reachable" was true in all three.

**Smaller carried items.**

- [ ] **Backup management** with download and delete, on top of CCB-S4-014 to 018. Delete crosses the
      D-120 privilege boundary and needs the same marker-and-path-unit shape, not a new escalation.
- [ ] **Automatic acceptance settings** for incoming contact requests (CCB-S4-023 built the manual step).
- [ ] **The plugin live-switch and diagnostics.**
- [ ] **The role-mismatch warning** — the page that must not collapse the three roles of D-129.
- [ ] **Wizard mode** for onboarding.
- [ ] **The AI Control inventory.**

**Left by CCB-S5-001, specifically.**

- [x] **The onboarding console pages still act on the primary bot.** Done in two parts. CCB-S5-007
      made every onboarding step act on the bot it was given and removed the primary guard from
      create-address. CCB-S5-008 finished the copy: the wizard's "Primary runtime bot" toggle is gone
      (creating a bot no longer touches the flag), the detail card carries a Primary bot panel that
      states what it does and does not decide, and the Personality page no longer tells the operator
      that saving a non-primary bot's character "changes nothing a member hears", which had been
      false since D-155. The two `status.error` lines telling the operator to "mark one as the
      primary runtime bot" were reworded too: they fire when the bot that received an event has no
      configuration record, which was never a question about the primary.
- [x] **`AVATAR_PATH` is primary-only.** Done in CCB-S5-007 (migration 049, D-161): each bot carries
      its own `avatar_path` and NULL means the deployment default. Ticked here in CCB-S5-008, which
      found the line still open while the feature had shipped.

**Parked further out.**

- [ ] **Rulebook profiles with export and import** (Season 7 or 8). **The import is a security problem
      and it is named now rather than discovered later:** every fence in this project rests on
      untrusted text being unable to cause anything, and an imported rulebook is foreign text whose
      whole purpose is to become her laws. The constitution must not be importable (D-155 already
      refuses per-bot constitutional deviation in three places; an import is a fourth way in), an
      import is an edit and must write history (D-146), and `verify:prompt-identity` pins what *ships*
      rather than what a deployment holds, so the Book's drift count would be the only signal.

## Carried out of the rule registry (CCB-S4-039, D-144)

The move landed inert and byte identical. These four are what it surfaced and deliberately
did not act on, recorded here so none of them is lost.

- [ ] **The Book of Elii console.** Viewing, editing, the tier warnings, the type-to-confirm
      on constitutional rules, version history and rollback, and the prompt preview before
      saving. **This is the next briefing**, named as out of scope by CCB-S4-039 itself; the
      registry and its guards exist so it is built on top of something already proven.
      `invalidatePromptRules()` in `src/interaction/prompt-rule-service.ts` is the hook it
      calls on every save.
- [ ] **Two non-identical copies of the generic voice paragraph.** `voice.command.restraint`
      says *"theatrical, **submissive**, corporate, preachy, or excessively cute"*;
      `character.generic.restraint` omits "submissive". They diverged in the code
      (`ollama-reply.ts` vs `personality.ts`) and were carried across unchanged, because
      CCB-S4-039 could not change a character of what the model is told. **Now two rows an
      operator can read side by side and settle deliberately** — which is the first thing the
      registry bought that the literals could not.
- [ ] **The identity facts are gated on her having a name.** `identityLines` returned nothing
      at all without one, so a bot with no configured wake word gets no label, no archive
      address, no project address, and no do-not-invent fence closing that list. Preserved
      exactly (as scope, in `dialledPromptInputs`), but nothing about it looks deliberate,
      and it is worth deciding rather than inheriting.
- [ ] **The intent-classifier prompt is still hardcoded.** `systemPrompt` in
      `src/interaction/ollama-resolver.ts` reaches a model and was deliberately left out of
      the registry: it is a different prompt on a different path, its content is a
      specification of the intent catalog rather than rules about her, and it has no lane in
      the lane vocabulary CCB-S4-039 settled. Moving it would mean inventing lanes nobody
      decided. Worth a decision once the console exists, because the same ownership argument
      applies: the operator cannot see or change it today either.

- [ ] **`verify:personality-live`'s no-memory assertion is a narrow regex, not a behaviour
      check.** It requires one of `no memory`, `do not remember`, `don't remember`,
      `cannot remember`, `can't remember`, `nothing before`, `no record of`. Measured under
      CCB-S4-039 across six runs, **three at the base commit and three after the registry
      move**: it fails 2 of 3 either way, on answers that are plainly correct
      (*"No, I don't have a memory of our chat history or past messages"*, *"My memory is a
      short read of just this message"*). **Pre-existing and not a regression** - the prompt
      is byte identical - and deliberately left alone by that briefing, because quietly
      loosening an assertion during a briefing whose whole claim is "nothing changed" is
      exactly what makes the claim unverifiable. Fix the verifier, not the behaviour (D-111).

## `scripts/` is not typechecked (found under CCB-S4-039)

`npm run typecheck` is `tsc --noEmit`, and `tsconfig.json` includes `src/**/*.ts` only. The
forty-odd harnesses in `scripts/` are therefore compiled by `tsx` at run time and never
type-checked, so a type error in a harness surfaces as a runtime failure, or does not surface
at all in a branch the run does not reach.

Found the honest way: CCB-S4-039 added a required field to `AiReplyRequest`, `npm run lint`
and `npm run typecheck` both passed clean, and five harnesses were still missing it. They
failed at run time and were fixed, but the compiler should have said so first.

**Measured before recording**: a probe tsconfig covering `scripts/**` reports **64 pre-existing
errors** across roughly a dozen files (missing `Config` fields in fixtures, `string` where a
union is wanted, index-signature access under `noPropertyAccessFromIndexSignature`). None was
introduced by that briefing. So this is real work rather than a one-line config change, which
is why it is a backlog item and not a drive-by fix.

- [ ] Add a `tsconfig.scripts.json` (or widen `include`) and clear the 64 errors, then wire
      it into `npm run typecheck` so the harnesses are covered by the same gate as `src/`.


## The activity stream's channel filter, and the one thing to do BEFORE it (CCB-S5-041)

**DELIVERED under CCB-S5-043 (D-215), including the migration this entry said to do first.**
The origin is on the archived record (`messages.bridge_channel_key` / `bridge_channel_name`,
migration 062, written in the same INSERT as the announcement); the stream has its channel
dropdown; publication is a switch per channel rather than the one Archive-page category this
entry assumed, because the operator wants one channel public and another private; and there is
a second surface the entry did not anticipate, a standalone announcements block a site can
embed without the stream. The rejected alternative below stayed rejected, for exactly the
reason stated. What is left of this entry is the record of the reasoning; nothing in it is
outstanding.

The website's activity stream should offer a channel dropdown - every channel that has posted
into it, plus "all channels" - showing only that channel's items. That is the fitness proof
`origin` was designed for, and the bridge console's own forward filter already proves the query
works one surface in.

**Nothing about the origin field needs to change.** `cinderella_bridge_forwards` already carries
the structured `origin` jsonb and already has exactly the index the filter wants:

```sql
ON cinderella_bridge_forwards ((origin ->> 'channelKey'), sent_at DESC)
```

`channelKey` is derived from the channel LINK, so it survives a rename and a rejoin, which the
local group id does not (D-205).

**The one thing to decide first, and to do first.** `origin` lives on that table and NOWHERE
else: her bridged announcements archive as bot messages under the `bridge` category, and
`bot-message.ts` / `db/bot-messages.ts` reference `origin` not at all. So the archived row - the
thing the public stream actually renders - does not know which channel it came from.

- [x] **Carry `channelKey` and `channelName` onto the archived message at insert**, with a
      migration, BEFORE the stream is built. Done in CCB-S5-043 (migration 062). The backfill
      could read only `cinderella_bridge_forwards.origin`, so an announcement whose forward row
      had already been cascaded away keeps no origin, can never publish, and is COUNTED on the
      Bridge console rather than left blank in silence - which is the cost this entry's last
      line predicted, made visible instead of assumed away.

Rejected alternative: joining the stream to `cinderella_bridge_forwards` at render time. It is
cheaper to build and needs no migration, and it is wrong for a reason this repository has paid
for repeatedly - **the forward log is OPERATIONAL state with its own lifecycle, and the archive
is a PUBLISHED record.** Deriving a public claim from a table a console action can cascade is
the same shape as keying on a group id that a rejoin moves. And the cascade is real rather than
theoretical: `deleteBridgeChannel` (D-204) removes a channel's forwards when an ended record is
cleared, which would silently strip provenance from items already published.

Doing it now costs one migration. Doing it after the stream depends on it costs a backfill from
a source that may no longer be complete.


## The picker states the scope, and every view declares what kind of page it is (CCB-S5-041)

The operator set one bot's greeting believing it was shared, because the page named no bot. The
copy fix helps; this is the structural version, and it removes the need to read a paragraph to
know what you are editing.

**The picker gains an entry above the bots: "All bots (shared settings)".** Then the SWITCHER
states the scope. A bot's name selected means you are editing that bot; the shared entry means
you are editing everything.

- **shared page**: the shared entry is preselected and the bot entries are NOT selectable,
  because choosing one would promise something the page cannot do.
- **per-bot page**: the bots are selectable, as now.
- **mixed page**: `knowledge` is the real one - grants are per bot, the rest is deployment-wide -
  so the entry appears and the page says which blocks belong to which, the way it already does.

**Not blocking the dropdown**, which was the first thought: a control that will not open does not
say WHY, and that is a silent control again - the defect this whole thread is about.

### And this answers the twelve UNCLASSIFIABLE views

`verify:scope-copy` could not classify twelve of twenty-two, and the reason is that **most of
them are not settings pages at all**. Asking "per-bot or shared?" was the wrong question, which
is why they came back unclassifiable rather than wrong:

| kind | views |
|---|---|
| show DATA | messages, consent, holds, reports |
| configure INFRASTRUCTURE | security, backup, embeds |
| OVERVIEW | dashboard |
| operator ACCESS | ai-profiles |

`ai-profiles` is worth its own note: it manages operator access, a THIRD id space - and the one
nearly confused with bot ids when the profile-words form was almost placed there (D-209). Three
id spaces that look alike is exactly the standing-rule shape.

- [ ] Require every view to DECLARE its kind (settings / data / infrastructure / overview /
      access). Only a settings page then owes a bot-or-shared answer, and `verify:scope-copy`
      asserts the declaration matches what the view calls rather than guessing from it.
- [ ] A data page's honest question is **whose data is shown**, which is a different question and
      worth asking separately rather than folding into scope.

### Tooltips, because the console is too dry

Every setting has one honest line today, which is good and terse. He wants the OPTION of more
detail without the page becoming a wall of text, and a tooltip is the right shape: the line stays
short, the explanation is there for whoever wants it.

- [ ] Hover tooltips carrying real explanation beside the one-line label. The reasoning already
      exists in the code comments and the decision entries; most of these tooltips are a matter
      of surfacing what is written rather than writing something new.

## Verification note

This backlog was written against the code on `main`. Every "Done" checkbox was
confirmed against a named file and line; every Season 2 item was confirmed **absent**
from the codebase (no route, table, or module implementing it), not merely
undocumented. The single most important verification result: **the public
`/embed/:id` route does not exist in code** — only its admin-side configuration does.

## Extend files.watch to every file-bearing send path (D-224)

Music library plays and member-upload playbacks book delivery checks; the bridge's re-hosted
media sends and the recital's chapter images do not yet. The seam is generic
(`enqueueFileWatch` + `runtime.readGroupItemsAsOwner`); each send site needs its own booking
with its bot, group and item. Until then those paths have the event half only, which cannot
see a file stuck in `new`.

## Knowledge retrieval on off-topic questions (RESOLVED under D-226)

The 0.55 knowledge floor admitted the SimpleGo README's noise band (0.53-0.58 on questions it
has nothing to say about, measured with the production embedder on local copies), and the
constitutional `knowledge.no-invention` rule then produced a "what you gave me does not cover
this" denial with a source line under it - overriding facts the application itself had put in
the same prompt. D-226 took two of the three options at once: the floor moved to a re-measured
0.60 (the middle of the gap between the noise band and the covered band, with
`npm run calibrate:knowledge-relevance` to re-measure per deployment, D-184), and migration 065
scoped no-invention so that when the passages do not answer, what the prompt itself told her -
clock, library, laws - is hers to state, while naming a document for it stays forbidden. The
third option, a default trigger of 'explicit', was not taken and remains available if the
noise returns on other material.

---

## She invents a definition rather than saying she does not know (CCB-S5-046, MEASURED)

**Priority: this is the one to fix first of everything on this page.** It is the failure the
product is sold on not having, and it is worse than any silence: a silence tells a member
nothing, and this tells them something false with complete confidence.

**Measured, not anecdotal.** Driving `verify:offer-live` against `qwen3:14b`, a bot with **no**
web-search capability answered:

> "A SINA Box is a device used in network infrastructure, often associated with security or
> data management functions. Specific details depend on the context in which it's being used."

Complete, plausible, and invented. On a second run:

> "Zeliqua is a protocol that allows for secure and private communication between parties.
> It's designed to ensure that messages are encrypted and can only be read by the intended
> recipient."

**The rate: 3 of 3 control runs answered without ever saying they did not know.**
`verify:offer-live` prints that count on every run (`MEASURED: n of 3 answered without saying
they did not know`), so the number can be watched rather than re-argued.

**What it violates.** `grounding.say-you-do-not-know` in terms: *"When you do not know
something, say so plainly in your own voice. An honest answer that you do not know beats a
plausible one you made up, and filling the gap is the one thing you must not do."* The rule is
constitutional, critical, and in every conversation prompt. It is being ignored.

**Why the offer work does not close it.** A bot that HOLDS web search now offers to look, and
that path is honest. This is the bot that holds NOTHING, where there is no capability to fall
back on and the model fills the gap instead. The two are different halves and only one is done.

**What is NOT yet known**, and should be established before designing: whether the 32B behaved
the same way (the rules were tuned against it), whether it is worse for names that look
technical than for names that look like people, and whether the deterministic half is even
possible - a claim of fact is not a pattern the way an invented refusal is, so this may need a
different instrument than `capability-claims.ts`. D-183 says the thing that holds must be
deterministic; here it is not obvious what that could be, and saying so is part of the work.

---

## Rename "community stream" before customers embed it (CCB-S5-046, from a member)

A member asked what "community stream" meant and **thought it was live video**. Nothing about
it is live and nothing about it is video: it is a page of archived messages that a visitor
scrolls.

The name is on the surface a customer embeds, so the cost of leaving it is paid by their
visitors rather than ours, and renaming after they have embedded it is worse than renaming now.

Where it appears: the embed page copy and headings, `PublicScope = 'stream'` in
`src/db/public-archive.ts`, the `in_stream` column from migration 062, the Capture and Embeds
console pages, and `docs/architecture.md`. **The internal identifiers do not have to move with
the visible name** - `in_stream` is a column and renaming it is a migration with no member
benefit, so the visible copy and the schema can be decided separately.

Worth deciding together with it: what the standalone channel block is called, since "channels"
has the same problem in the other direction (it suggests video channels).
