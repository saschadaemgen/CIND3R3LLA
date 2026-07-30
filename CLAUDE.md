# CLAUDE.md — Cinderella standing context

**CIND3R3LLA is the central AI / identity of this system** — the top-level
product, not just a bot. The name is stylised: **CIND3R3LLA**, everywhere it is
displayed, including her wake word. Members may also address her with the plain
spelling `Cinderella`, which is a DECLARED alias (`DEFAULT_WAKE_ALIASES`, D-088)
rather than a fuzzy-match accident, because addressing her is the consent path.
Prose in this repo still says "Cinderella" for readability; that is fine, and it is
not something to go and "fix". The consent-based SimpleX-group-to-web **archive is her
first capability**; later she brings a team of additional agents. Treat
"Cinderella" as the identity, with the archive as one capability under her.

As the archive, she joins a public SimpleX group the operator controls, captures
opted-in members' messages (text/image/video/voice/file/link) into PostgreSQL +
a media tree on disk, and (later season) republishes them as a searchable public
web archive. Standalone — NOT part of CARVILON, CyberDesk, or SimpleGoX.

## The one rule: consent-first

**Nothing a member posts appears on the public archive unless that member opted
in** — by sending `/publish`, or by asking her in plain language and confirming
when she asks back (CCB-S3-002; both routes share one write path, and consent is
always first-person). This is the product's legal backbone. Publication is _derived_
(never a stale flag) from the `consent` table, `sent_at` (forward-only from
opt-in), `deleted`/`group_deleted`, `moderation_state`, and the `consent_gaps` a
hide/restore cycle leaves behind — see the `message_publish_state` /
`published_messages` views. A revocation hides everything at once; the member then
chooses **hide** (retained, restorable by them alone) or **delete** (erased, and an
evidence hold can defer that but never the hiding) — CCB-S3-013.

## Non-negotiables (base briefing §1)

- Work on **`main`** only. **Conventional Commits**.
- **Mandatory pre-push grep** for real IPs, secrets, hostnames, device ids, and
  member data. The repo is **public**. Test/config data uses placeholders only.
- **No secrets in source or logs.** Everything sensitive is env (git-ignored
  `.env` in dev; systemd `EnvironmentFile` 0600 in prod). Redact before logging.
- **English** everywhere. Proof-of-concept before integration.
- **Stages define order, not checkpoints.** A briefing split into stages is worked
  through continuously, deploying as you go; do not stop between stages waiting for
  approval unless a stage explicitly says otherwise.
- **A briefing is not delivered until it is confirmed delivered.** Three briefings were
  never received in Season 3 and this was only discovered at close-out. Confirm receipt
  against the register when a briefing arrives, and record the delivering commit against
  its CCB id when it lands.
- **Surface failures, never swallow them** (standing rule, CCB-S3-023). A caught error
  must not be converted into a value that reads as a legitimate result (masking), and a
  degraded/absent function must not run silently. Log with actionable context (operation,
  input, error); for anything on the **consent, capture, publication, media or plugin
  path** that loses a guarantee, also call `status.error` so it reaches the admin
  dashboard, not only a log file. Distinguish **"not configured"** (a choice) from
  **"configured but failing"** (a fault). A fallback that can mask a fault is counted and
  the count shown in the admin. Do not add noise: alert on real faults, not normal states.
- **No em-dashes in member-facing output** (standing rule, CCB-S3-021). The em-dash
  (`—`), en-dash (`–`), and horizontal bar (`―`) must never appear in any string a
  member can read, in any language: persona strings, locale files, the help and
  welcome copy, retorts, plugin replies, and any admin copy that reaches a member.
  Use a normal hyphen, a comma, or restructure. Enforced by `verify:no-dashes`,
  which also scans the whole plugins tree so new copy is caught automatically.
  (Prose comments and docs are out of scope; this is about output.)

## Architecture (decided — do not re-litigate)

- **One process** (Addendum 1 A2): the `simplex-chat` npm SDK (6.5.4) embeds the
  Haskell chat core **in-process** (native addon) alongside the Fastify admin
  console. There is **no separate daemon and no exposed SimpleX port** — the old
  WebSocket-daemon model was the deprecated ≤0.3.x line. The sensitive surface is
  the on-disk SimpleX DB, protected by filesystem perms.
- **Two logical DBs, kept separate:** (1) the SimpleX core's own SQLite state
  under `state/`; (2) Cinderella's **archive** PostgreSQL (messages, links,
  consent, settings, audit, embeds).
- **Media on disk** (`MEDIA_ROOT`); the DB stores the path, never the bytes.
  **Originals are ENCRYPTED at rest** (AES-256-GCM under a dedicated `MEDIA_SECRET`,
  D-075); the stripped public derivative stays plaintext. Every reader of an original
  goes through `src/media/at-rest.ts`. Rotating `MEDIA_SECRET` destroys the archive:
  there is no key history, and it must be backed up separately from the media.
  **Quarantined media is MOVED to `QUARANTINE_ROOT`**, outside `MEDIA_ROOT` and served
  by nothing; the admin console addresses media by message id (`/media/msg/:id`), never
  by path, and the raw static mount over the media tree is gone (CCB-S3-013 §4, D-074).
  The config loader refuses to start if the two roots are nested.
- **Search:** Postgres FTS (generated `tsvector` + GIN) + a `links` table.
- **Admin console** is hostile-facing: Fastify on 127.0.0.1, public nginx TLS in
  front at the admin hostname. **Passkeys (WebAuthn) are the primary auth**
  (native `@simplewebauthn`), with an admin-toggleable Argon2id break-glass path
  (+ optional TOTP). Signed HttpOnly/Secure/SameSite=Strict session; CSRF on all
  mutations; every A4.5 hardening control (session/step-up/rate-limit/IP/CSP/
  headers/attestation/alerting) is configured on the **Security** page, persisted
  in `settings`, audited. `trustProxy` pinned to `loopback`. Responsive (A5).

## Layout

- `src/` — `config.ts`, `log.ts`, `adapter/` (the chat seam: Cinderella's own domain
  types, the `ChatAdapter` interface, and an in-memory fake; D-078),
  `bot/` (**the SimpleX adapter, and the ONLY place that may import `simplex-chat`** -
  enforced by `verify:adapter-seam`; core wiring, files, connect, avatar, parsing),
  `capture/` (parse, media, links, persist, her own sends), `consent/`,
  `archive/` (whether her own messages publish, name redaction, destruction and the
  deferred-destruction sweeper),
  `media/` (metadata detection and stripping, video matchers),
  `interaction/`
  (wake word, intent resolver, dialogue engine, persona, help), `plugins/` (plugin
  registry + the Crypto Prices plugin: providers, pinning, cache), `price/`
  (amount parsing + number formatting), `settings/`,
  `queue/` (durable Postgres-backed background jobs: store, worker, registry, handlers),
  `profiles/` (profile/group/authority config, runtime policy, bot onboarding —
  configuration and policy only, they never drive the SDK; unconsolidated, D-068),
  `db/`, `web/` (server, auth, session, views), `index.ts`.
- `migrations/` — 001 messages/links · 002 consent+views · 003 admin · 004
  moderation gate · 005 deletion provenance · 006 webauthn + TOTP · 007 admin
  sessions (persisted across restarts) · 008 content reports · 009 consent action
  journal (provenance + undo) · 010 asset mappings (pinned symbol→asset) · 011
  seeded major assets (locked pins) · 012 correct pins that predate the seed · 013
  her own messages (bot rows, mentions, the second publication branch) · 014
  stripped media derivatives · 015 member instructions + exchange pairing · 016 video links · 017 durable job queue
  (state machine, `FOR UPDATE SKIP LOCKED` claim, backoff/dead-letter, idempotency) ·
  018 capture write-ahead events · 019 formatted text · 020 revocation hide/delete +
  evidence holds (incl. the BEFORE DELETE hold trigger) · 021 consent gaps (a restore
  never publishes what was said while hidden) · 022 quarantine withholds (a hash match
  or an escalation is served to nobody).
  Runner: `node dist/db/migrate.js`.
  **Numbers 017, 018 and 019 each exist TWICE** — the unconsolidated local-AI work (D-068)
  added `017_cinderella_profiles`, `018_runtime_policy_decisions` and `019_bot_onboarding`
  alongside the three above. Nothing is broken: the runner keys `schema_migrations` on the
  **full filename** and applies files in filename order, so all six apply exactly once. But
  **never rename an applied migration** (it would re-apply), the number is a label rather
  than an ordinal, and new migrations allocate from **the highest number on disk plus one**
  (currently **023**). Stated as a rule rather than a fixed number, because the fixed
  number went stale once already. See D-069.
- `scripts/` — PGlite verification harnesses + asset/password helpers.
- `deploy/` — `cinderella.service`, `nginx-admin.conf`, `RUNBOOK.md`, `backup.sh`.
- Git-ignored: `.env`, `state/`, `media/`, `public/` (built assets), `dist/`.

## Verify before committing nontrivial changes

`npm run build` (tsc + Tailwind/htmx assets) · `npm run lint` · and the PGlite
harnesses (real Postgres-in-WASM, no server needed): `verify:db`,
`verify:consent`, `verify:admin`, `verify:admin-views`, `verify:interaction`
(natural addressing), `verify:price` (market data; `-- --live` hits the real
provider), `verify:archive` (her own messages + the consent leak guard), plus
`verify:security`, `verify:public`, `verify:revocation`
(hide/delete on revocation + the evidence holds; proves no path destroys a held item),
`verify:queue`, `verify:capture-events`, `verify:no-dashes`,
`verify:adapter-seam` (nothing outside the adapter imports the SDK, and the check
proves it fails on a violation), `verify:adapter-fake` (the seam driven with no SDK),
`verify:screening` (encryption at rest + the hash-screening seam; the fixture
provider proves the quarantine path with no real material).
`scripts/admin-preview.ts` boots a seeded local admin console for browser checks.

**The marketing site is not in this repository** (D-089). It lives in
[`cind3r3lla-site`](https://github.com/saschadaemgen/cind3r3lla-site) with its own
process, port (`8788`), systemd unit and deploy script, and it carries its own
`verify:site`, `verify:i18n-keys` and `verify:no-dashes`. This repository's
`verify:no-dashes` therefore no longer scans `locales/` (there is none here); it
covers the bot's own member-facing output, which is what remains.

## Documentation maintenance (binding on every briefing)

Documentation is maintained **per change, not per season** (CCB-S1-019). On
completing the work of any briefing, review the five living documents —
[`docs/architecture.md`](docs/architecture.md), [`docs/security.md`](docs/security.md),
[`docs/wire-format.md`](docs/wire-format.md), [`docs/feature-backlog.md`](docs/feature-backlog.md),
[`docs/decisions.md`](docs/decisions.md) — and update whichever the change affects,
grounded in the actual code. If the change touches nothing documented, state
**"no documentation change"** explicitly in the completion report — never skip
silently. New decisions get a `D-<n>` entry with a Status (`IMPLEMENTED` /
`PLANNED` / `Superseded by D-<n>`). Keep the implemented-vs-planned discipline so
the docs never present planned work as built.

Why this keeps the docs ground truth: the strategy documents (season protocol,
decisions narrative, season plan) are authored in the planning chat and may run
ahead of the code; the five technical docs are maintained by Claude Code **from the
code** and are the corrective.

## Deploy (VPS) — see [deploy/RUNBOOK.md](deploy/RUNBOOK.md)

Shared production host. Be **additive**: never touch neighbouring services,
DBs, or nginx configs. App in `/opt/cinderella` (git), runtime data in
`/var/lib/cinderella` (owned by the non-root `cinderella` user). One systemd
unit. Update = `git pull && npm ci && npm run build && node dist/db/migrate.js &&
systemctl restart cinderella`. Admin console is **public + passkey-secured**
(Addendum 4): nginx TLS at the admin hostname → Fastify `127.0.0.1:8787`. See
[deploy/RUNBOOK.md](deploy/RUNBOOK.md). WireGuard (Addendum 3) is retired from the
admin path but stays installed for optional defense-in-depth
([deploy/wireguard.md](deploy/wireguard.md)).

## Child safety (CCB-S3-012) — foundation built, provider NOT connected

Storage and custody are built; detection is not. **No screening provider is
configured**, the null provider transmits nothing, and the public copy says "in
development" until a real provider is configured and verified. Hash matching finds
KNOWN material only, never new material, and a no-match is not a statement of safety.
A match preserves and quarantines, never deletes. Reporting, retention periods and the
point of contact are legal questions for a lawyer and are deliberately absent from the
code. See architecture §26, D-075/D-076.

## Parked (do not build now)

Bot avatar (operator supplies image → `npm run avatar -- <img>`), public
`/embed/<id>` widget render + Web-Component (later season; config model + admin
UI already exist), AI moderation / CSAM scanning (separate track — the
`moderation_state` column is the hook), self-hosted relay/super-peer capture.
