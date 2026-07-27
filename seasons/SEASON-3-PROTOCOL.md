# CCB-S3-026 — Season 3 Close-Out: Protocol & Handover to Season 4

- **Briefing:** CCB-S3-026
- **Type:** Season close-out (protocol + handover + directive)
- **Project:** Cinderella
- **From:** Planning/Architecture chat
- **To:** Claude Code

> This document is the committed record of briefing CCB-S3-026. The five living
> documents it references (`architecture`, `security`, `wire-format`,
> `feature-backlog`, `decisions`) live under [`docs/`](../docs/). The briefing register
> is [`CCB-REGISTER.md`](CCB-REGISTER.md).
>
> **Numbering note.** This closes **Season 3**, not Season 2. Season 2 was closed by
> CCB-S2-016; every briefing since has been `CCB-S3-*`. The next season is **Season 4**,
> and its briefings are `CCB-S4-NNN`.

---

## Part A — Directive to Claude Code (execution record)

1. **Close-out committed** as this file, with a Season 3 entry in
   [`SEASON-INDEX.md`](SEASON-INDEX.md).
2. **Documentation currency pass** performed. Result in **Part G**.
3. **Briefing register updated** with every `CCB-S3-*` entry and its verified status
   (and the previously missing Season 2 block). See [`CCB-REGISTER.md`](CCB-REGISTER.md).
4. **Delivery gap reported per briefing id** in **Part G §2**. This corrects Part C in
   four places: four items listed there as open are in fact **delivered and live**.
5. `main` only, Conventional Commit with `Briefing: CCB-S3-026`, pre-push grep, pushed
   and deployed.

## Part B — Season 3 Protocol: what shipped

Season 3 turned Cinderella from a capture bot into something a member can talk to, and
hardened the archive underneath it. The character of the season was **finding faults that
had been latent since the code was written**, which is why so much of the work is invisible.

### Interaction

- **Natural addressing.** She answers to her name, with optional greetings, in English and
  German. A follow-up window lets a member continue without repeating it. A deterministic
  rule resolver maps free text onto a closed intent catalog, with typo tolerance, umlaut
  folding, and guards on negation and quotation. The resolver **never executes**; existing
  consent code does, so a future language model cannot publish anyone by misreading a
  sentence. (CCB-S3-002)
- **Addressing guards.** Forwarded messages are ignored, unrecognised input is met with
  silence unless the address signal was strong, long text is not an instruction, and a
  strict mode requires a greeting. Each guard is individually configurable. (CCB-S3-005)
- **Reply presentation.** No quote clutter, and SimpleX's actual markup, verified from the
  parser source: single delimiters, doubling disables the format. (CCB-S3-003)
- **Reply language.** An intent that resolves by matching a keyword set answers in that
  set's language, with certainty rather than probability; the weighted statistical contest
  is kept only for UNKNOWN. (CCB-S3-005 Addendum A, D-067)
- **Help.** Full vocabulary in both languages, with the capability list generated from the
  **active intent catalog**, so a disabled plugin does not advertise itself and a new one
  appears without editing. (CCB-S3-010)
- **Consent copy.** The three publishing properties are stated before the member confirms:
  forward-only, public until taken back, and revocation is final. (CCB-S3-010)
- **The undo principle.** Undo may only ever **reduce** exposure. Undoing an opt-in is
  allowed; undoing a revocation is refused, because nothing may return revoked content to
  public view. Written as a rule at the single point that writes, so any future consent
  operation inherits it. (CCB-S3-010 Addendum A, D-054/D-055)

### Plugins

- **A plugin framework**, with the crypto price lookup as its first tenant. A disabled
  plugin **leaves the intent catalog entirely**, so nothing can resolve to a switched-off
  capability. (CCB-S3-004)
- **Price lookups** across three providers with failover, attribution bound to whichever
  actually answered, and symbol mappings resolved once then pinned permanently.
  Chain-scoped, because Ethereum HEX and PulseChain HEX share a contract address and an
  address-only lookup returns a 2.4x wrong price with no error.
  (CCB-S3-004, CCB-S3-006, CCB-S3-008)

### Archive and public front

- **Member questions are archived** alongside her answers, as a derived pair: an answer is
  published only if its question is, and revoking removes both halves. Before this,
  instructions were never persisted at all and she appeared to answer nobody. (CCB-S3-009)
- **Her own messages** are archived and publish on the operator's decision, with name
  redaction, as a second publication branch. (CCB-S3-007)
- **Media metadata stripping.** Published images are served from derivatives with EXIF,
  IPTC and XMP removed. The gate fails closed. (CCB-S3-011 Part 1)
- **Video links** play as click-to-play cards with locally served thumbnails: no
  third-party request before the click. (CCB-S3-014)
- **Chat text formatting** now renders in the stream, derived from SimpleX's own parsed
  runs, escaped and whitelisted, and **nulled whenever a bot-message name redaction
  applies** so formatting cannot leak a redacted name. (CCB-S3-025)
- **Per-item permalinks**, crawlable and consent-gated, plus a script-free share bar.
  (CCB-S3-025)
- **The website** was integrated from the operator's template, with i18n and footer-linked
  legal pages. (CCB-S3-001)

### Infrastructure

- **A durable job queue.** Postgres-backed, `FOR UPDATE SKIP LOCKED`, priority lanes,
  per-type concurrency, backoff, dead-lettering, idempotency, and per-type orphan reclaim
  that excludes the live worker's own locks. Measured: interactive claim latency is flat at
  1ms with an empty queue and with 2000 bulk jobs queued. (CCB-S3-022 phase 1)
- **A capture write-ahead log** foundation, so an event whose handler fails becomes
  retryable instead of lost. Additive only; not yet on the live path. (CCB-S3-024 slice 1)
- **Admin restructure**, ten sections with a sidebar submenu, and the dark neon restyle.
  (CCB-S3-015 stages 1 and 3)
- **No em-dashes in member-facing output**, enforced by `verify:no-dashes` across the whole
  plugins tree, and the help reply reduced to one editable template rather than two texts
  where the editable one was dead. (CCB-S3-021, D-061/D-066)
- **The marketing site on its own domain**, added late and recorded under CCB-S3-028 because
  it shipped after the close-out began. `SITE_ORIGIN` was split out from `PUBLIC_ORIGIN`
  rather than moving the console, because `PUBLIC_ORIGIN` derives the WebAuthn RP ID and
  moving it would have invalidated every registered passkey. The edge enforces the split
  with a vhost **allowlist** ending in 404, so an admin route added later is never silently
  exposed on the marketing domain. (CCB-S4-001, D-080/D-081)
- **A public demo backend**, with a two-key isolation guard: a `DEMO_INSTANCE` env flag
  **and** a database marker, both required, failing closed and loudly in every direction.
  The dangerous case it exists for is a process told it is the demo while pointed at a
  production database, which would otherwise put a stranger in the real console. The
  visitor-facing UI is not built. (CCB-S4-001, D-082)

### Security findings, which are the season's real story

Five faults of the same shape were found, each latent since the code that contained it was
written:

1. **Support-scope messages were captured.** Private member-to-admin threads arrive on the
   same event as group messages with nothing distinguishing them. Two rows existed; none
   were published; both removed. Fixed with a **whitelist**: only a provable public group
   message passes, so direct chats and any future scope fail closed. (CCB-S3-019, D-059)
2. **Plugin API keys were re-encrypted on every boot**, so both providers received an
   unusable key. The keys had never worked since the day they were entered, and the only
   symptom was a friendly "markets are out of earshot". (CCB-S3-008)
3. **A failed in-group deletion left content published**, with the error going only to a
   log. Production cross-reference showed all six real deletions applied correctly, so it
   never fired, but it was possible from the day it was written. Now retried durably.
   (CCB-S3-023)
4. **Media derivatives could not be written** after a remediation script ran as root, and
   the fail-closed gate withheld images silently. (CCB-S3-011 Addendum A)
5. **A swallowed error disabled all orphan reclaim** in the queue. (CCB-S3-022)

This produced a **deliberate audit**: 114 caught errors classified, 19 silently degrading,
10 masking, 9 confirmed real after adversarial verification. The standing rule now in
`CLAUDE.md`: surface failures, distinguish not-configured from configured-but-failing,
count masking fallbacks, and do not add noise. (CCB-S3-023, D-063)

### Two structural findings worth carrying forward

- **The SDK delivers each event exactly once and never re-sends it.** A handler that fails
  loses the event permanently, with no record it existed. This explains the 16 failed file
  receipts flagged since Season 1: recorded, never retried, past the relay expiry window.
  (CCB-S3-024)
- **A private per-member channel exists** via the member support scope, contradicting the
  Season 1 documentation that said it did not. The contact-to-member link is **structural
  and trustworthy**, set by the core over the authenticated group connection, so a
  pairing-code protocol is unnecessary in the normal case. It depends on the group's
  `directMessages` setting. (CCB-S3-016, CCB-S3-017 Addendum A, D-058)

## Part C — Open items carried into Season 4

The table below is the briefing's Part C **as issued**, with the verified status appended.
Where the two disagree, the verified column is grounded in commits, code and passing
harnesses, and the evidence is given in **Part G §2**.

| Briefing | Subject | As issued | **Verified** |
|---|---|---|---|
| CCB-S3-011 Part 2 / **CCB-S3-013** | Hide or delete on revocation, with evidence holds | May never have been received | **Reissued and DELIVERED** — `b76aa8f`, plus `bf1f779` for §4 (D-070/071/072/073/074) |
| CCB-S3-012 | Encrypted originals at rest, CSAM screening seam | Not started | **Reissued and DELIVERED** — `eeae2a2` (D-075, D-076). No provider is connected, by design |
| CCB-S3-005 Addendum A | Short German instructions answered in English | Not started | **DELIVERED and live** (D-067) |
| CCB-S3-014 Addendum A | Consent banner with analytics and video categories | Not started | Not started |
| CCB-S3-021 | Em-dashes forbidden, help formatting, dead admin help field | Not started | **DELIVERED and live**, all three parts (D-061, D-066) |
| CCB-S3-011 Addendum B | Media error responses not cacheable; one retry on live-inserted images | Not started | **Half delivered.** Retry is live; the cacheability half is **not** built |
| CCB-S3-017 + Addendum A | Contact address, private channel, direct-chat capture exclusion | Research done, not built | Research done and documented, not built |
| CCB-S3-018 | The permanent failed-file-receipts alert | Not started | Subject documented, not built |
| CCB-S3-020 | The SimpleX adapter seam | Filed last, not started | **Reissued and DELIVERED, Phase A only** — `cea9adf` (D-078). Types, interface, fake, two checks. No production caller; Phases B and C open |
| CCB-S3-022 phase 2 | Media derivatives onto the queue, backfill, admin queue page | Not started | Not started |
| CCB-S3-024 slices 2 and 3 | Wire capture to write-ahead, retention, admin counts | Not started | Not started |
| CCB-S3-015 stage 2 | Two-column tiles, per-tile save, sized inputs, collapsible help | Not started | Not started |
| CCB-S3-023 follow-ups | Atomic consent categorisation, generalised plugin self-check, unbounded ids in media and report routes | Deferred | **Partly delivered.** The unbounded ids are fixed and live; the other two remain open |

**Operator-owned:**

- Register a second passkey on the YubiKey 5, then **rotate the leaked break-glass
  password** and disable break-glass. Outstanding since Season 1.
- Set **Archive link** and **Project link** on the Interaction page, or the help footer
  omits them.
- Decide the CoinMarketCap free-tier licensing question; the chain currently has it
  configured.
- **No backups exist.** `deploy/backup.sh` keeps fourteen copies but has never run: no
  cron, no timer, no dump on the host. The archive has no recovery from disk loss.
  **Re-verified on the host under CCB-S3-028 and still true**, and now the season's largest
  operational risk. Full analysis in [`../docs/feature-backlog.md`](../docs/feature-backlog.md).
- **Nine** high-severity npm advisories, not three (measured under CCB-S3-028):
  `@fastify/static`, `brace-expansion`, `fast-uri`, `find-my-way`, and `sharp` with four
  inherited libvips CVEs. `sharp` sits on the media path.

**Documentation debt:** ~~the legal texts remain unwritten~~ — **superseded.** CCB-S3-029
delivered real legal pages (`db7b83c`, corrected by `2817ebe`): a binding German Impressum
reproduced verbatim, an English convenience translation, a privacy policy drafted from the
code that names the hosting processor, the retention mechanism and the screening status,
with every other locale falling back to English under a visible governing-version notice
(D-079). What remains is counsel review, and terms of service for the commercial Pro tier.

**Added under CCB-S3-028** (the close-out currency check, re-run after 012, 013, 020 and 027
landed):

- All six living documents were **out of date** — five seriously. The per-change
  documentation rule did not hold this season; the failure mode was omission and internal
  self-contradiction rather than overclaiming.
- The operator's real admin hostname was committed in three places in a public repository,
  against the repo's own standing rule. Scrubbed under this briefing; the disclosure has
  already occurred.
- The nginx configuration for CCB-S4-001 exists **only on the server** and is recorded in
  D-081 because that was the only place the topology existed.
- The multi-profile runtime design, the largest body of unrecorded reasoning in the project,
  is now recorded as D-083, D-084 and D-085, with the group-identity claim corrected and the
  conversation-identity question recorded as open.

## Part D — Season 4

### The first task is consolidation, and it comes before any new feature

The operator has been running **two parallel chats** on the local AI implementation, and
that work is **not represented in these documents**. It is, however, **already in this
repository and deployed**: 23 commits between 2026-07-25 and 2026-07-27, roughly 17,700
inserted lines across 46 files, none carrying a `Briefing:` trailer. See **Part G §3** for
the full inventory and the two defects it brought with it. Season 4 opens by gathering it:

- What was designed, decided and built there, and what state it is in.
- Reconcile it against the five living documents and the decision log, so a decision made
  in another chat does not silently contradict one recorded here.
- Fold it into the architecture rather than bolting it on.

Nothing else should start until this is done. Two of the season's worst faults came from
work whose reasoning existed somewhere other than the documents. This is a third instance
of exactly that pattern, caught at close-out rather than in production.

### Scale changes the priorities

The operator projects roughly **300 functions**. That number, more than any individual
feature, should drive Season 4:

- **The plugin framework becomes the load-bearing structure.** It carried one tenant well.
  Whether it carries fifty is the question, and it is cheaper to answer now than at forty.
- **The admin cannot be a growing list of sections.** Ten sections already needed a
  submenu; the AI work has since added five more workspaces and a mega navigation.
- **The intent catalog must stay closed and safe** as it grows. Resolver collisions already
  appeared with a handful of intents, when `help consent` resolved to a price lookup.
- **The queue, the write-ahead log and the adapter seam stop being optional.** At this
  scale, work that is not durable, not observable and not swappable becomes unmanageable.

### The plan

1. **Consolidate the AI work** from the parallel chats, as above.
2. **Finish the open briefings** in Part C. Consent-affecting ones first: CCB-S3-013, then
   the private channel, then the write-ahead wiring. Note that CCB-S3-013, CCB-S3-012 and
   CCB-S3-020 must be **reissued**: they were never received (Part G §2).
3. **The AI brain**, behind one configurable endpoint, with the rule engine as automatic
   fallback, and the model classifying but never executing. **A substantial part of this is
   already built** by the parallel-chat work and needs review rather than construction
   (Part G §3).
4. **Categorisation and the media gallery**, on the queue: per-community categories, video
   via transcript and sampled frames rather than full analysis.
5. **Legal and compliance**: the three texts, a DSA point of contact, and a defined
   preserve-and-report process.
6. **Child safety**: encrypted originals, hash screening at receipt, quarantine that
   resists deletion.
7. **Multi-tenancy and Pro**, which is also where **CCB-S3-020** pays off: a closed Pro
   edition needs the operator's own protocol implementation in place of the AGPL library,
   and the seam is what makes that a swap rather than a rewrite.

## Part E — Handover to the new chat

Season 4 begins in a **new planning chat**. It should be given:

- This document.
- The five living documents and the decision log.
- The briefing register.
- Whatever the parallel AI chats produced, noting that the code itself is already on `main`
  and inventoried in Part G §3.

**Conventions that carry over unchanged:** briefings as downloadable files, never inline.
`CCB-S4-NNN` numbering, id in the filename, the header and the commit message. Documentation
maintained per change, not per season. **Done means deployed and live**, including pushed.
Work directly on `main`. Pre-push grep before every push. Professional and factual in
everything public; **no em-dashes anywhere**. German in chat, English in code, docs and
commits.

**One convention to correct:** briefings must not be split into stages that stop and wait.
Stages define order, not checkpoints. Season 3 lost a full day to an admin restyle that
halted after stage one because the briefing implied it should.

**One convention to add:** every commit carries its `Briefing:` trailer. The 23
unattributed AI commits are the reason the work was invisible to the register and to the
documents.

## Part F — Status

Season 3 is content-complete for what shipped and **live in production**. The interaction
layer, the plugin framework, the price plugin, the public front with formatting and
permalinks, the queue foundation, and the security fixes are all deployed. A substantial
body of briefed but unbuilt work carries forward, listed in Part C.

The archive has never leaked a private message, never published revoked content, and never
lost a member's message. Each of those was verified against production rather than assumed.

---

## Part G — Close-out findings (added by Claude Code under CCB-S3-026)

### §1 Tree health at close-out

`npm run build` clean; `npm run lint` clean **after one repair** (below); all 30
verification harnesses pass, including the 19 that arrived with the unattributed AI work.

**Repair made during this close-out.** `npm run lint` was **failing on `main`** at
`src/interaction/ollama-reply.ts:50` (`no-control-regex`), introduced by the AI work. The
regex is correct: it strips C0/C1 control characters from untrusted model output before it
reaches a member. The rule was firing on the intent, not on a fault, so the fix is an
`eslint-disable-next-line` carrying that reason. No behaviour changed.

### §2 Delivery gap, per briefing id

**Held and delivered** (each has at least one commit carrying its `Briefing:` trailer):
CCB-S3-001, 002, 003, 004, 005, 005 Addendum A, 006, 007, 008, 009, 010, 010 Addendum A,
011 Part 1, 011 Addendum A, 014, 015 (stages 1 and 3), 016, 017 (research and docs only),
019, 021, 022 (phase 1), 023, 024 (slice 1), 025.

**Never received.** No commit, no document reference, no code reference anywhere in the
repository:

- **CCB-S3-013** (hide or delete on revocation, with evidence holds). The briefing's
  suspicion is correct. The work is tracked only as "CCB-S3-011 Part 2 — NOT BUILT" in
  `docs/feature-backlog.md`, which is why it was referred to by that name. **Reissue for
  Season 4.**
- **CCB-S3-012** (encrypted originals at rest, CSAM screening seam). **Reissue.**
- **CCB-S3-020** (the SimpleX adapter seam). **Reissue.**

**Subject known, briefing not evidenced, not built.** **CCB-S3-018** (permanent
failed-file-receipts alert) is referenced by id in `docs/architecture.md:638` and `:673`,
`docs/decisions.md:137`, `docs/feature-backlog.md:345` and `src/queue/types.ts:30`, always
as future work whose shape is understood (the 16 recorded-not-retried receipts, and the
permanent-vs-transient distinction the queue already provides for it). Whether the briefing
document itself arrived cannot be established from the repository; its content is not lost.

**Part C corrections.** Four items listed as open are delivered:

| Item | Evidence |
|---|---|
| CCB-S3-005 Addendum A | Commit `7d0efd0`, trailer `Briefing: CCB-S3-005`; D-067; `verify:interaction` §21 covers the four acceptance cases |
| CCB-S3-021 | Commits `4e5ea11` (em-dash ban + readable help) and `2e4a056` (the dead admin help field, D-066), both trailered; `verify:no-dashes` scans 123 sources and passes |
| CCB-S3-023 follow-up: unbounded ids | Commit `19e080a` — media and report routes bound the message id and return a clean 404 instead of a 500. The other two follow-ups (atomic consent categorisation, generalised plugin self-check) remain open |
| CCB-S3-011 Addendum B | **Half.** The retry half is live (`7a22aa3`, "a withheld image heals itself"): the media route calls `ensureDerivative` and serves the healed file. The **cacheability half is not built** — see the defect below |

**One briefing missing from the close-out narrative.** **CCB-S3-007** (her own messages,
published on the operator's decision, commit `fa218ea`) appears in neither Part B nor
Part C as issued. It is delivered and live; it is now recorded in Part B and in the
register.

**Open defect found while verifying Part C.** Media error responses on the public front are
cacheable. `src/web/server.ts:188` exempts the public front from the global `no-store`
hook, and the 404 paths in the media route (`src/web/front/embed.ts:479-528`) set no
`cache-control` at all, so a shared cache may apply heuristic freshness to a 404 for an item
that is merely not yet derived. The success path at `:533` does set `no-store`. This is
precisely the half of CCB-S3-011 Addendum B that was not built; it is recorded in
`docs/feature-backlog.md` and carries into Season 4.

### §3 The local AI subsystem, already in the repository

The parallel-chat work is not pending: it is on `main` and deployed. Inventory, so Season 4
starts from fact rather than recollection:

- **23 commits**, 2026-07-25 to 2026-07-27, `b308201`..`e236ccf`, roughly **17,700 inserted
  lines across 46 files**. **None carries a `Briefing:` trailer**, so none appears in the
  register and none triggered the per-change documentation rule.
- **Runtime and interaction:** `src/interaction/ollama-resolver.ts` (a local Ollama intent
  resolver), `src/interaction/ollama-reply.ts` (individualized reply wording),
  `src/interaction/ai-runtime.ts` (runtime control, role routing, model discovery,
  content-free telemetry).
- **Profiles and policy:** `src/profiles/service.ts` (profile, group and authority
  configuration), `src/profiles/runtime-policy.ts` (deterministic allow/deny per group and
  member), `src/profiles/bot-onboarding.ts` (persistent SimpleX bot onboarding
  configuration).
- **Admin:** `src/web/views/ai.ts` (2084 lines), `ai-profiles.ts`, `ai-onboarding.ts`, a
  global mega navigation, the CIND3R3LLA brand and effects, and five redesigned workspaces
  (access control, runtime control, models catalog, routing, hardware).
- **Migrations:** `017_cinderella_profiles.sql`, `018_runtime_policy_decisions.sql`,
  `019_bot_onboarding.sql`.
- **Harnesses:** 19 new `verify:*` scripts, all passing.

**The safety posture looks deliberate and matches Part D §3.** The resolver's own header
states that the model classifies only and never executes, writes consent, calls a tool, or
decides whether a confirmation is accepted; consent intents carry an additional gate where
the model may confirm PUBLISH or UNPUBLISH **only** when the rule resolver independently
found the same intent. Enabling and routing changes are fail-closed, verifying the selected
models before the active resolver is swapped. This is review work for Season 4, not
construction work. It has **not** been security-reviewed under the CCB scheme, and
`docs/security.md` says so explicitly.

**Defect: duplicate migration numbers.** The AI work reused three numbers that Season 3 had
already taken:

| Number | Season 3 (CCB-attributed) | Parallel-chat AI work |
|---|---|---|
| 017 | `017_jobs.sql` (queue, CCB-S3-022) | `017_cinderella_profiles.sql` |
| 018 | `018_capture_events.sql` (write-ahead, CCB-S3-024) | `018_runtime_policy_decisions.sql` |
| 019 | `019_formatted_text.sql` (CCB-S3-025) | `019_bot_onboarding.sql` |

This is **not currently broken**: `src/db/migrate.ts` keys `schema_migrations` on the **full
filename** and applies files in filename order, so all six apply exactly once, alphabetically
within each number. Two consequences carry forward, recorded as **D-069**:

1. **The files must not be renamed.** Renaming any applied migration makes the runner treat
   it as new and re-apply it against a schema that already has it.
2. **The number is no longer a reliable ordinal.** A fresh rebuild applies each pair in
   alphabetical order, which is not necessarily the order production received them. The six
   are independent today, so nothing breaks; a future migration that depends on a
   same-numbered sibling would.

Season 4 should allocate from **020** and treat the number as a label, not a sequence.
