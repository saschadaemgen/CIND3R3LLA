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
- **A new source tree does not inherit the existing checks; their scopes are reviewed**
  (standing rule, D-105). A check written before a subtree existed does not cover that
  subtree, and **nothing announces it**: the rule held, the check ran, the check was green,
  and the output violated the rule. That is exactly how an em-dash reached generated member
  facing text while `verify:no-dashes` passed, because it scanned the bot's own copy and
  the generator did not exist when it was written. Every standing check has the same
  exposure to every directory added after it. So when a source tree is added, walk the
  standing checks and decide **per check** whether it now applies, rather than assuming the
  green run means covered.
- **When the implementation and a verifier disagree, inspect the rendered output and the
  current source before changing behaviour** (standing rule, D-111, from the local AI
  protocol). Several failures in that work were **verifier defects, not implementation
  defects**: desktop and mobile markup counted together, HTML escaping expected as
  unescaped text, nested HTML truncated by a regex, whitespace-sensitive exact matching, a
  check still asserting a pre-rename title. Every one of them would have been "fixed" by
  changing working code to satisfy a broken test. The check is cheap and the damage is not:
  look at what the code actually renders, and at what the test actually asserts, before
  touching either.
- **Read production state before retrying a deployment that may already have succeeded**
  (standing rule, D-111, same source). Ordinary `git push` output and a transient `curl`
  reset both read like failures and are not. A blind retry of a deployment that already
  landed is how a working production host gets disturbed for no reason. Check the service,
  the health endpoint and the deployed revision first, then decide.
- **No em-dashes in member-facing output** (standing rule, CCB-S3-021). The em-dash
  (`—`), en-dash (`–`), and horizontal bar (`―`) must never appear in any string a
  member can read, in any language: persona strings, locale files, the help and
  welcome copy, retorts, plugin replies, and any admin copy that reaches a member.
  Use a normal hyphen, a comma, or restructure. Enforced by `verify:no-dashes`,
  which also scans the whole plugins tree so new copy is caught automatically.

  **Scope, settled under CCB-S3-043 so it stops resurfacing: OUTPUT ONLY.** The rule
  covers what a member or a visitor can read. It does **not** cover prose in this
  repository: `NOTICE`, `README.md`, the six living documents, the season protocols
  and the register may all use em-dashes freely, and they do. `verify:no-dashes` is
  therefore **correct as it stands** and is not under-scoped; a repository-wide sweep
  would rewrite roughly half a megabyte of documentation to satisfy a typographic
  preference no member will ever encounter. If a document ever starts being served to
  members, it moves into scope on that day and not before.

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
  (wake word, intent resolver, dialogue engine, persona, help, `personality.ts`: the
  base character, her origin, the five 1-10 dials and the given identity, pure, with the
  calibrated references (D-133, D-135). The base character is how she SOUNDS and the origin
  is what she IS and where she came from, carried into the prompt as background she may draw
  on but must never recite or raise unprompted (D-138).
  **The RULES she is given are not in the code at all** (D-144): every sentence the model
  reads is a row in `cinderella_prompt_rules`, seeded by migration 035, assembled by
  `prompt-rules.ts` (pure: lanes, the seventeen fixed conditions, placeholder rendering),
  loaded by `db/prompt-rules.ts` and cached by `prompt-rule-service.ts`. **The migration is
  the only authored copy and there is deliberately no fallback in code**, because a fallback
  is a second source; an unreadable registry makes her fall back to the deterministic reply
  rather than word one with no rules. The boundary that decides what is a rule: a rule is a
  sentence whose text does not depend on a setting, so the dial bands and calibrated
  references stay personality data and the permissiveness ceiling moved,
  and `conversation-log.ts`: the content-free record of what the conversational path
  did, shown on the Diagnostics page), `plugins/` (plugin
  registry + the Crypto Prices plugin: providers, pinning, cache), `price/`
  (amount parsing + number formatting), `settings/`,
  `queue/` (durable Postgres-backed background jobs: store, worker, registry, handlers),
  `bot/runtime/` (**the multi-profile runtime, and the bot now runs on it**: one core, many
  SimpleX profiles, a serialized active-user scheduler, event routing by receiving `userId`.
  Wired under CCB-S4-021 with **exactly one profile hosted** (`host.ts` is the caller,
  `src/index.ts` calls it); hosting a second is half two. Nothing sends before the core is
  ready, because `startChat()` returning is 44 ms and readiness is ten seconds later,
  measured. `BOT_RUNTIME_HOSTING=false` falls back to the pre-runtime `bot.run` path and is
  the rollback lever, not a configuration. Eight of its ten files import no SDK so it is
  testable with no core; see architecture §32, D-096, D-124 and D-125),
  `generator/` (**offline tooling, no runtime caller**: the profile generator, built one
  component per briefing. Shared deterministic `rng.ts`, then `names/` and `traits/`.
  Nothing outside it imports it and nothing writes its output; see architecture §31.
  Components: `names/` (CCB-S4-002), `traits/` (CCB-S4-003), `surface/` (CCB-S4-005), `bio/` (CCB-S4-006), `assemble/` (CCB-S4-007)).
  `npm run assemble` renders a population for a person to READ: the statistics can all be
  green while the text is wrong, which is how CCB-S4-006 and CCB-S4-007 each found a
  defect no number could show. **Bio text has two engines** (D-104): `--engine model` is
  the quality path, because every defect a read of two hundred profiles found was a
  LANGUAGE defect, and the template pool is the availability fallback, deliberately small,
  plain and quiet. The deterministic layer decides who the person is; the model only
  phrases them. Determinism survives by caching on seed + conditioning version + model
  identity),
  `profiles/` (profile/group/authority config, runtime policy, bot onboarding —
  configuration and policy, plus what the onboarding steps produced: the contact address
  (D-126) and the incoming contact requests (D-127). This tree still never drives the
  SDK: the actions live in `bot/runtime/admin-actions.ts` and hand the RESULT here, and
  the event listener records what the core reported; unconsolidated, D-068),
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
  or an escalation is served to nobody) · 023 bot registry (one row per SimpleX profile
  the core reports: actor type, automation mode, avatar source, the personality
  reference; nothing hosts it yet) · 024 the onboarding contact address (the link the
  console's create-address step produces, stored with the SimpleX user it was created
  on, all three columns under one CHECK) · 025 incoming contact requests (a row per
  request the core reports, keyed unique on the core's own id, because a public address
  can be used by more than one person at a time) · 026 group invitations (a row per
  invitation, with the role OFFERED and the role HELD kept apart, and neither of them the
  operator's expected role) · 027 the free-conversation publication category (a view
  replacement, because 013 carries the category defaults as a literal that must match
  `DEFAULT_ARCHIVE`) · 028 the personality layer (a base character and four 1-10 dials per
  bot, on `cinderella_bot_profiles` because that is where per-bot settings live; the
  `settings` table is global and has no bot dimension) · 029 moderation (append-only
  violations counted over a rolling window per member per chat, the sanction record whose
  `mode` is only ever `observed` today, and the two ladders per bot) · 030 the spoken
  warning · 031 her origin (a second per-bot text column beside the base character, 4000
  characters against its 600, whose column DEFAULT is the operator's written history so
  that the existing bot is backfilled and every new one starts with one; clearing it
  stores NULL and stays cleared, because a default applies to an insert and never to an
  update) · 032 arming (the numeric `group_member_id` a restore acts through, `expired_at`
  as distinct from `expires_at` so a lost expiry job reads as overdue rather than as
  permanent, and the CHECK that makes an enforced row claiming neither success nor failure
  unrepresentable) · 033 the web-search publication category (a view replacement, the same
  correction 027 made, because the category defaults are a literal that must match
  `DEFAULT_ARCHIVE`) · 034 the verbosity axis (a fifth dial, whose 5 reproduces the fixed
  500 character conversation cap and 240 character retort cap it replaced, to the
  character) · 035 the rule registry (every sentence the model is told, as data: id, tier,
  lane, condition, global order, text, enabled, critical, scope and its origin in the code,
  with CHECK constraints on the three vocabularies. **This file is the only authored copy of
  that text**, so changing a rule means changing it here or, from the next briefing, in the
  console; the code holds no fallback copy) · 036 the production lessons (a new condition
  value `has-model`, the two rules CCB-S4-042 adds, and the origin default losing its model
  claim plus an UPDATE for the rows that still hold it, because a default applies to an insert
  and never to an update).
  Runner: `node dist/db/migrate.js`.
  **Numbers 017, 018 and 019 each exist TWICE** — the unconsolidated local-AI work (D-068)
  added `017_cinderella_profiles`, `018_runtime_policy_decisions` and `019_bot_onboarding`
  alongside the three above. Nothing is broken: the runner keys `schema_migrations` on the
  **full filename** and applies files in filename order, so all six apply exactly once. But
  **never rename an applied migration** (it would re-apply), the number is a label rather
  than an ordinal, and new migrations allocate from **the highest number on disk plus one**
  (currently **037**, since 036 landed with the production lessons). Stated as a rule
  rather than a fixed number, because the fixed
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
`verify:prompt-identity` (**the byte-identity check on the whole prompt**, D-144: sixteen
configurations covering every lane and every condition branch, compared against
`scripts/fixtures/prompt-baseline.json`, which was captured from the code one commit BEFORE
the rule registry moved the sentences into the database. It is not specific to that
briefing: any change to any prompt line, from any briefing or any future rule edit, fails it
and prints which lane and which line moved. A DELIBERATE change is re-baselined on purpose
with `npm run verify:prompt-identity -- --update`, and the diff to the fixture is then the
reviewable record of what she is now told. It also asserts every rule marked `critical`
reaches a prompt in a lane and condition that selects it, and proves both guards can go red
by mutating a rule's text, swapping two rules' order, disabling a constitutional rule, and
rendering with an empty registry),
`verify:personality` (the five dials, her identity and the nickname retort lane: that each
dial changes the prompt that is actually sent, that the permissiveness ceiling is in every
conversation prompt at every value and also with no personality configured, that her name
and the other given facts reach it, that her origin reaches it and is fenced by the
draw-on-not-recite rule, that the shipped origin in the migration and the one in the
TypeScript constant are character for character identical, and that none of it reaches a
command rewrite.
`npm run verify:personality-live` is the companion that asks a REAL model the same
question at a low and a high setting and prints both, since a prompt the model ignores is
a dead slider with a passing test; it also asks who she is and where she came from and
fails if she recites her history or volunteers it unasked. It needs Ollama and is not in
the offline set),
`verify:moderation` (the two ladders, the rolling window and its decay, per-member
per-chat scoping, exemptions, and above all the NO-ACT guarantee, asserted structurally by
scanning for every enforcement API name, behaviourally by driving a member past every rung
with a spy on the engine's only outbound, and by the schema CHECK that refuses an observed
row claiming to be enforced. `npm run verify:moderation-live` walks the same nickname up
the ladder against a real model and prints every rung; it needs Ollama),
`verify:search` (web search: that untrusted results are fenced into the USER message and
never the system prompt, that a result can cause no action at all, the budgets, the
deterministic trigger and its negative controls, the honest failure line, and since
CCB-S4-042 the **pre-search gate** with its negative controls and the rule that **a source
line belongs to the answer**: a refusal reaches no provider and cites nothing, an
undeclared answer cites nothing either, and the two are mutation-proven by removing the
gate and by re-attributing a refusal.
`npm run verify:lessons-live` is the companion that drives all six production defects
through a REAL model and prints every reply; it needs Ollama and is not in the offline set.
`npm run verify:search-live` puts five real prompt injections in the result set and prints
what she does with each; it needs Ollama),
`verify:namegen`, `verify:traits`, `verify:surface`, `verify:bio`, `verify:bio-model` and
`verify:assemble` (the profile generator; pure computation, no DB. `verify:bio-model` fakes
the model transport, so no Ollama need be running.
`verify:traits` gates CORRECTNESS and only REPORTS the two quality measures: both bounds
were withdrawn under D-095 after measurement showed they named the wrong properties.
`npm run calibrate:traits` prints the surface replacements get written from),
`verify:multi-profile` (the multi-profile runtime, against PGlite and an in-process core
double; merged to `main` under CCB-S4-020),
`verify:runtime-host` (the single-bot wiring: profile resolution, the bot-profile guard,
capture through the router proven call-for-call identical to capture through the SDK, the
readiness gate, and the assertion that the runtime's SDK-free files are still SDK-free,
which `verify:adapter-seam` cannot catch because it permits the SDK anywhere under
`src/bot/`),
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
completing the work of any briefing, review the **six** living documents —
[`docs/architecture.md`](docs/architecture.md), [`docs/security.md`](docs/security.md),
[`docs/wire-format.md`](docs/wire-format.md), [`docs/feature-backlog.md`](docs/feature-backlog.md),
[`docs/decisions.md`](docs/decisions.md), [`docs/adapter-contract.md`](docs/adapter-contract.md)
— and update whichever the change affects,
grounded in the actual code. If the change touches nothing documented, state
**"no documentation change"** explicitly in the completion report — never skip
silently. New decisions get a `D-<n>` entry with a Status (`IMPLEMENTED` /
`PLANNED` / `Superseded by D-<n>`). Keep the implemented-vs-planned discipline so
the docs never present planned work as built.

**`docs/planning/` is history, not authority** (D-110). Sixteen documents from the parallel
planning chats, committed as a dated snapshot under CCB-S4-008. On any divergence the order
is **the code, then the living documents, then these**. Several are titled `decision-*` and
record *proposals*; what was adopted is in `docs/decisions.md` with a number and a Status,
and it is usually narrower. Nothing there may be cited as a decision, nothing there is
maintained, and anything added later is privacy-scrubbed first with the result recorded in
its README even when the scrub replaced nothing.

**Read the next free decision number off the file; never assume it.** This has gone
wrong twice: once when D-080 was allocated to two entries, and again when a second
D-082 appeared, both renumbered afterwards. The highest number is not always the last
heading in the file, because entries are ordered newest-first and the planning chat
allocates in parallel. The check is one command, and it is not optional:

```bash
grep -oE "^### D-[0-9]+" docs/decisions.md | grep -oE "[0-9]+" | sort -n | tail -1
```

Same discipline for briefing ids and migration numbers (D-069): allocate from what is
on disk plus one.

**Allocation reads EVERY OPEN BRANCH, not `main` alone**, for as long as any branch carries
decision entries. `D-096` was allocated on `feature/multi-profile-core-foundation` and does
not exist on `main`; reading the highest number off `main` would have produced a second
D-096 the moment that branch landed, which is the duplicate-allocation failure this file
already records happening twice. The check when a branch is open:

```bash
git log --all -p -- docs/decisions.md | grep -oE "^\+### D-[0-9]+" | grep -oE "[0-9]+" | sort -n | tail -1
```

A deliberate gap is fine and should be stated in the entry that skips it.

Why this keeps the docs ground truth: the strategy documents (season protocol,
decisions narrative, season plan) are authored in the planning chat and may run
ahead of the code; the six technical docs are maintained by Claude Code **from the
code** and are the corrective.

**The count was five until CCB-S3-020 added [`docs/adapter-contract.md`](docs/adapter-contract.md)
and did not update the rule that governs it** (corrected under CCB-S4-009). Statements of
"five" in the Season 1 and Season 2 protocols are therefore **historically correct and are
left alone**; only current and forward-looking statements were changed. If a seventh is
ever added, this rule, its companion above, the register's documentation checkpoint and
`README.md` all state the count and all need updating together.

**Two season counts now run in parallel, and they must never be conflated.** This
repository has the product's seasons (`CCB-S<n>-<NNN>`, currently closing Season 3).
The marketing site has its own, starting at **its own Season 1**, in its own
repository with its own briefings and its own protocol documents. A bare "Season 1"
is ambiguous from now on: say *product Season 1* or *site Season 1*. Briefing ids are
not shared across the two, and a site briefing never appears in this repository's
register.

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
