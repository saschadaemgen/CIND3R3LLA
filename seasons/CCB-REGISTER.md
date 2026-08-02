# Cinderella — Claude Code Briefing Register (Seasons 1–4)

*Supersedes the earlier "Season 0" register. Internal and public season numbering
are now aligned: the first completed block is **Season 1**. Seasons 1, 2 and 3 are
complete; **Season 3 closes with CCB-S3-043** (not CCB-S3-028, which was a
documentation pass fifteen briefings before the end). **Season 4 has not started.**
The previous zero-based scheme is retired (see
[`../docs/decisions.md`](../docs/decisions.md) **D-014**, superseding D-011).*

> **This register covers the PRODUCT only.** The marketing site has its own briefings,
> its own season count starting at site Season 1, and its own register, in its own
> repository (D-089). A site briefing never appears here. The one exception is
> **CCB-S3-042**, which was issued in this scheme before the split completed and is
> recorded below for continuity.

> **Status vocabulary.** *Delivered* = the work is in `main` and deployed, evidenced by at
> least one commit carrying the briefing's `Briefing:` trailer. *Never received* = no
> commit, no document reference and no code reference anywhere in the repository. *Not
> built* = the briefing is held (or its subject is documented) but no implementation
> exists. *Reissued and delivered* = recorded as never received, then reissued and landed.
> Season 3 statuses were re-verified against commits, code and harnesses under CCB-S3-026;
> see [`SEASON-3-PROTOCOL.md`](SEASON-3-PROTOCOL.md) **Part G §2**. **That check is
> superseded by CCB-S3-028**, which re-ran it after CCB-S3-012, 013, 020 and 027 had
> landed and found three "never received" rows to be stale.

## Numbering convention

- Every Claude Code Briefing carries a unique identifier: **`CCB-S<season>-<NNN>`** —
  season-bound, zero-padded, sequential (e.g. `CCB-S1-001`).
- The identifier appears in the briefing header and in the Conventional Commit
  message of the resulting work, so every change is traceable end to end:
  commit → briefing → decision.
- **Seasons are numbered from one, internal and public aligned.** The first
  completed block is Season 1. The "Stages 0–7" framing from early implementation
  reports remains deprecated; the unit is the Season.
- **Documentation checkpoint (standing rule, [`../CLAUDE.md`](../CLAUDE.md)):** every
  briefing includes a mandatory documentation step — on completing the work, Claude
  Code updates whichever of the six living docs the change affects, grounded in the
  actual code, or states "no documentation change" in the report. Never skipped
  silently.
- Briefings are written in a professional, publication-ready style.

> **The `ID` column is authoritative.** Briefings delivered before the alignment
> were committed with their pre-alignment `CCB-S0-<NNN>` ids; those ids survive in
> git history and are **not** rewritten. The canonical id is the `CCB-S1-<NNN>`
> value here. Old planning-chat source filenames also keep their original names.

## Register — Season 1

| ID | Title | Type | Status | Source file |
|----|-------|------|--------|-------------|
| CCB-S1-001 | Foundation: repo scaffold, capture pipeline, persistence, consent gating | Briefing | Delivered | CINDERELLA-S0-CC-BRIEFING.md |
| CCB-S1-002 | Admin/config console; in-process SDK topology correction; embed data model; responsive-by-default | Addendum | Delivered | CINDERELLA-S0-ADDENDUM-1.md |
| CCB-S1-003 | VPS live deployment: systemd hardening, non-root service, secrets handling | Addendum | Delivered | CINDERELLA-S0-ADDENDUM-2.md |
| CCB-S1-004 | WireGuard-only admin access | Addendum | Superseded by CCB-S1-005 | CINDERELLA-S0-ADDENDUM-3.md |
| CCB-S1-005 | Appless public console: Let's Encrypt HTTP-01, native WebAuthn passkeys, full hardening controls | Addendum | Delivered | CINDERELLA-S0-ADDENDUM-4.md |
| CCB-S1-006 | Login-failure hotfix: session persistence and reverse-proxy headers | Hotfix | Delivered | CINDERELLA-HOTFIX-login.md |
| CCB-S1-007 | Group onboarding, avatar application, live capture acceptance | Briefing | Delivered | CINDERELLA-CONNECT-BRIEFING.md |
| CCB-S1-008 | Avatar-not-applied and premature-logout hotfix: PostgreSQL-backed sessions | Hotfix | Delivered | CINDERELLA-HOTFIX-avatar-session.md |
| CCB-S1-009 | XFTP media-download hotfix (initial) | Hotfix | Superseded by CCB-S1-010 | CINDERELLA-HOTFIX-xftp-media.md |
| CCB-S1-010 | XFTP media "missing" hotfix — root cause: EXDEV cross-device rename | Hotfix | Delivered | CINDERELLA-HOTFIX-xftp-media-v2.md |
| CCB-S1-011 | Avatar re-apply-on-startup hotfix | Hotfix | Delivered | CINDERELLA-HOTFIX-avatar-persist.md |
| CCB-S1-012 | Avatar-propagation diagnosis | Diagnosis | Delivered | CINDERELLA-DIAG-avatar-propagation.md |
| CCB-S1-013 | Avatar for all members via desktop set + on-wire capture | Briefing | Superseded by CCB-S1-014/015 | CINDERELLA-BRIEFING-avatar-allmembers.md |
| CCB-S1-014 | Avatar fix: group-message flush (SimpleX core-source finding) | Fix | Delivered | CINDERELLA-AVATAR-FIX-group-message.md |
| CCB-S1-015 | Avatar fix: SDK-native — image carried in the `bot.run` profile | Fix | Delivered | CINDERELLA-AVATAR-FIX-sdk-native.md |
| CCB-S1-016 | Admin Messages actions and state-model hotfix | Hotfix | Delivered | CINDERELLA-HOTFIX-messages-actions.md |
| CCB-S1-017 | Season close-out: protocol & handover | Briefing | Delivered | CCB-S0-017-season-0-closeout.md |
| CCB-S1-018 | Read-only VPS deploy key (replace git-bundle deploys) | Briefing | Issued — awaiting operator's GitHub deploy-key step | CCB-S0-018-vps-deploy-key.md |
| CCB-S1-019 | Numbering alignment, doc relabel, and standing documentation-maintenance rule | Briefing | Delivered | CCB-S1-019-renumber-docrule.md |

## Register — Season 2

Season 2 was closed by CCB-S2-016 ([`SEASON-2-PROTOCOL.md`](SEASON-2-PROTOCOL.md)); the
register block was never written at the time and is reconstructed here from the commit
trailers under CCB-S3-026.

| ID | Title | Type | Status |
|----|-------|------|--------|
| CCB-S2-001 | README relaunch as a SimpleX AI Bot Suite; banner + AGPL-3.0 licence | Briefing | Delivered |
| CCB-S2-002 | README restyle to the SimpleGo house style | Briefing | Delivered |
| CCB-S2-003 | Public archive front: SSR `/embed/<id>`, consent-gated media, core SEO | Briefing | Delivered |
| CCB-S2-004 | Full SEO & marketing suite: structured data, sitemap, feed, robots, OG, analytics | Briefing | Delivered |
| CCB-S2-005 | House-palette dark mode + persisting light/dark toggle | Briefing | Delivered |
| CCB-S2-006 | Live consent-gated auto-update on the public stream | Briefing | Delivered |
| CCB-S2-007 | Cursor-paged infinite scroll with DOM windowing and live reconcile | Briefing | Delivered |
| CCB-S2-008 | Inline video player: controls, fullscreen, byte-range, download toggle | Briefing | Delivered |
| CCB-S2-009 | Public content reporting + admin review queue + notification bar | Briefing | Delivered |
| CCB-S2-010 | Stream loading polish; embedded-overflow fallback | Briefing | Delivered |
| CCB-S2-011 | WebAuthn RP-ID/origin mismatch guard (passkey-lockout footgun) | Fix | Delivered |
| CCB-S2-012 | Public marketing website: landing page, i18n (EN/DE), app-authoritative robots | Briefing | Delivered |
| CCB-S2-013 | CSAM claim tightened to not-yet-built; docs currency check (S2-003..012) | Briefing | Delivered |
| CCB-S2-014 | Honest CSAM wording + alpha status notice | Briefing | Delivered |
| CCB-S2-015 | *(unknown)* | — | **No evidence in the repository.** No commit, document or code reference. Either never issued or never received |
| CCB-S2-016 | Season 2 close-out: protocol & handover; D-026/027/028 | Briefing | Delivered |

## Register — Season 3

| ID | Title | Type | Status |
|----|-------|------|--------|
| CCB-S3-001 | Season 3 website: the operator's dark-neon template as the real SSR site, i18n, legal page stubs | Briefing | Delivered |
| CCB-S3-002 | Natural addressing: wake word, deterministic intent resolver, Cinderella's voice | Briefing | Delivered |
| CCB-S3-003 | Reply presentation: plain messages, and the markup SimpleX actually renders | Briefing | Delivered |
| CCB-S3-004 | Plugin framework, and crypto prices rebuilt on it; canonical pinned asset ids | Briefing | Delivered |
| CCB-S3-005 | Addressing guards: being named is not being addressed; answer in the sender's language | Briefing | Delivered |
| CCB-S3-005 A | Short German instructions answered in English (a matched keyword set is authoritative) | Addendum | **Delivered** (D-067) — Part C listed this as not started |
| CCB-S3-006 | Conversions, precision, state questions, elliptical follow-ups; corrected major pins | Briefing | Delivered |
| CCB-S3-007 | Her own messages, published on the operator's decision; name redaction | Briefing | **Delivered** — absent from the close-out narrative as issued |
| CCB-S3-008 | Plugin API keys re-encrypted on every boot; provider failures say why | Fix | Delivered |
| CCB-S3-009 | A member's question is that member's message (archived as a derived pair) | Briefing | Delivered |
| CCB-S3-010 | A real help command, and consent copy that tells the truth | Briefing | Delivered |
| CCB-S3-010 A | The undo principle: undo may only reduce exposure, never increase it | Addendum | Delivered (D-054/D-055) |
| CCB-S3-011 P1 | Media metadata stripping: publish a stripped derivative, never the file as sent | Briefing | Delivered |
| CCB-S3-011 A | A withheld image is never silent (fail-closed gate could not write derivatives) | Addendum | Delivered |
| CCB-S3-011 B | Media error responses must not be cacheable; one retry on live-inserted images | Addendum | **Half delivered.** The retry is live; the cacheability half is not built |
| CCB-S3-012 | Encrypted originals at rest, CSAM screening seam | Briefing | **Reissued and delivered** 2026-07-27 as `eeae2a2`. (Was recorded as never received; the reissue landed.) |
| CCB-S3-013 | Hide or delete on revocation, with evidence holds | Briefing | **Reissued and delivered** 2026-07-27 as `b76aa8f` (revocation, holds) and `bf1f779` (§4, quarantine segregated on disk). (Was recorded as never received.) |
| CCB-S3-014 | Video links play as click-to-play cards with locally served thumbnails | Briefing | Delivered |
| CCB-S3-014 A | Consent banner with analytics and video categories | Addendum | Not built |
| CCB-S3-015 | Admin restructure and dark-neon restyle | Briefing | **Partially delivered.** Stage 1 (sub-sections + submenu) and stage 3 (restyle) live; **stage 2 not built** |
| CCB-S3-016 | SDK capability inventory, and the support-scope answer | Briefing | Delivered (documentation) |
| CCB-S3-017 | Contact address, private channel, direct-chat capture exclusion | Briefing | **Research done and documented, not built** |
| CCB-S3-017 A | The contact↔member link exists but is conditional | Addendum | Delivered (documentation, D-058) |
| CCB-S3-018 | The permanent failed-file-receipts alert | Briefing | **Subject documented, not built.** Referenced by id in four documents and in `src/queue/types.ts`; arrival of the briefing itself is not evidenced |
| CCB-S3-019 | A private support-scope message is never a public one (capture whitelist) | Fix | Delivered (D-059) |
| CCB-S3-020 | The SimpleX adapter seam | Briefing | **Reissued and delivered** 2026-07-27 as `cea9adf` — **Phase A only** (domain types, `ChatAdapter`, a fake, and two checks). Phases B and C remain open. (Was recorded as never received.) |
| CCB-S3-021 | Em-dashes forbidden, help formatting, dead admin help field | Briefing | **Delivered**, all three parts (D-061, D-066) — Part C listed this as not started |
| CCB-S3-022 | Durable Postgres-backed job queue | Briefing | **Partially delivered.** Phase 1 (foundation + crash-recovery hardening) live; **phase 2 not built** |
| CCB-S3-023 | Swallowed-error audit; a failed in-group deletion is retried durably | Briefing | Delivered (D-063) |
| CCB-S3-023 f/u | Follow-ups: atomic consent categorisation, generalised plugin self-check, unbounded ids | Follow-up | **Partly delivered.** Unbounded ids in the media and report routes are fixed and live; the other two remain open |
| CCB-S3-024 | Capture write-ahead log | Briefing | **Partially delivered.** Slice 1 (durable substrate) live; **slices 2 and 3 not built** |
| CCB-S3-025 | Stream polish: formatting, soft report control, share bar, permalinks, attribution | Briefing | Delivered |
| CCB-S3-026 | Season 3 close-out: protocol & handover to Season 4 | Briefing | Delivered 2026-07-27 as `972f789`. Its currency check is **superseded by CCB-S3-028**, having run before 012, 013, 020 and 027 landed |
| CCB-S3-027 | Erasure covers the SimpleX core's own copy | Briefing | Delivered 2026-07-27 as `cc06cf2` (D-077) |
| CCB-S3-028 | Final documentation pass; what must survive the planning chat | Briefing | Delivered (this entry) |
| CCB-S3-029 | Real legal pages, German binding | Briefing | Delivered 2026-07-27 as `db7b83c`, corrected by `2817ebe` (D-079) |
| CCB-S4-001 | The marketing site on its own domain; demo backend | Briefing | **Misnumbered; it is a Season 3 briefing** (see [`SEASON-INDEX.md`](SEASON-INDEX.md)). **Phase 1 delivered** 2026-07-27 as `3e60c96` and `6769281` (D-080, D-081, D-082). The visitor-facing demo UI is not built. The nginx configuration **is** in the repository now (D-089) |
| CCB-S3-030 | The section tree, the navigation shell, and the Platform pages | Briefing | Delivered 2026-07-28 as `4b20e29` |
| CCB-S3-031 | Consent copy that stops telling members their kept archive is gone | Briefing | Delivered 2026-07-28 as `80f26b4` (**D-093**, renumbered from a second D-082 under this briefing) |
| CCB-S3-032 | *(unknown)* | — | **No evidence in the repository.** No commit, document or code reference. Either never issued or never received |
| CCB-S3-033 | *(unknown)* | — | **No evidence in the repository.** No commit, document or code reference. Either never issued or never received |
| CCB-S3-034 | One submenu at a time, inert entries, a home page about the platform; the sticking focus ring | Briefing | Delivered 2026-07-28 as `6cd7ece` and `902efcd` |
| CCB-S3-035 | Fullscreen menu, travelling indicator, live hero, designed sections | Briefing | Delivered 2026-07-28 as `56f0b7c` |
| CCB-S3-036 | Two-tier header, one indicator, and a menu that opens | Briefing | Delivered 2026-07-28 as `6bdea87` |
| CCB-S3-037 | English only; retired locale prefixes 301 to the English page | Briefing | Delivered 2026-07-28 as `e2edccb`, corrected by `073333e` (old locale links were reaching the admin login) |
| CCB-S3-038 | The admin mega panel, hairline separators, indicator on the label | Briefing | Delivered 2026-07-28 as `a9ee5cc` |
| CCB-S3-039 | *(unknown)* | — | **No evidence in the repository.** No commit, document or code reference. Either never issued or never received |
| CCB-S3-040 | The generated design-system package | Briefing | Delivered 2026-07-28 as `a9ee5cc` |
| CCB-S3-041 | Site settings leave the database; then the site leaves the repository | Briefing | Delivered in two parts: `3da6076` 2026-07-29 (Part A, settings to the environment, `/website` deleted) and `aeb8db7` 2026-07-30 (Part B, the split; D-089, D-090). D-091 and D-092 followed as `8450a12` and `a01161d` |
| CCB-S3-042 | Hand the site repository over | Handover | **Delivered to the site repository, not executed here.** Committed as `2f3d265` in `cind3r3lla-site` alongside the deployment and design handovers. It briefs work *in that repository*; nothing in it touches this one. Much of it was already satisfied by D-089 (own `CLAUDE.md`, `README.md`, `.env.example`, deploy script, unit, port; harnesses carried across and passing) |
| CCB-S3-043 | Close Season 3: the season boundary, the duplicate decision number, README, NOTICE, em-dash scope | Briefing | Delivered (this entry) |

## Season 4 — open

**`CCB-S4-001` is not a Season 4 briefing.** It is a misnumbered Season 3 one; the boundary
and the evidence for it are in [`SEASON-INDEX.md`](SEASON-INDEX.md). Fourteen Season 3
briefings were issued and delivered after it landed, so the numbering never actually moved.
The id is **not rewritten** (it stands in commit messages and in D-080/081/082) and is
recorded in the Season 3 block above, in the position where it landed.

**Season 4 therefore opened at `CCB-S4-002`.** `CCB-S4-001` is taken.

| Briefing | Title | Type | Status |
|---|---|---|---|
| CCB-S4-002 | Profile generator, component 1: the name generator | Briefing | **Delivered** 2026-07-28 as `0e0a3d9`. **Id allocated retroactively** at the delivery of CCB-S4-003: the briefing was issued without one, so the commit carries no `Briefing:` trailer. `npm run verify:namegen`, 42 checks. **"Culturally coherent names" is NOT delivered** — the shipped corpus carries no culture labels, so the grammar engine runs against hand-authored fixtures; the swap point is documented in `corpus.ts` |
| CCB-S4-003 | Profile generator, component 2: the trait sampler | Briefing | **Delivered** 2026-07-31 (D-094, D-095). `npm run verify:traits`, 66 checks. Includes the shared-RNG move to `src/generator/rng.ts` (`verify:namegen` still passes). **Finding carried forward:** at `sigma` 0.5, the bottom of the range the briefing calls valid, the adjusted-mutual-information measure is 0.917 and crosses the briefing's own 0.9 caricature bound. Surfaced, not resolved: it is a calibration decision for the personality model's owner |
| CCB-S4-004 | Multi-profile core foundation | Briefing | **Delivered on a branch**, `feature/multi-profile-core-foundation`, **not merged and therefore not in this table on `main`**. Its row and D-096 land with the branch. Recorded here so the gap between S4-003 and S4-005 reads as a branch that has not merged rather than as a missing briefing |
| CCB-S4-007 | Profile generator, component 5: assembly and review | Briefing | **Delivered** 2026-07-31 (D-103). `npm run assemble` writes three views plus a pre-filled review record; `npm run verify:assemble`, 22 checks. **The crowd view found a defect on its first run**: `crispin sinclair`, drawn for culture `de`, writing a German bio under an English name. That is CCB-S4-002's documented fixture-corpus gap, on record for months and abstract until names and bios were rendered side by side. Filed against the name generator rather than fixed, per §2. Also found and closed a smaller gap: the name corpus carried no version while the other three data sets did |
| CCB-S4-006 | Profile generator, component 4: the bio generator | Briefing | **Delivered** 2026-07-31 (D-102). `npm run verify:bio`, 26 checks. §3's empty share realised at 66.7 percent against a 68 percent target, skewed by activity tier and conscientiousness. §6 answered with six variety mechanisms rather than a skeleton list: 279 distinct structural patterns, most common at 4.6 percent. **Every population statistic passed while the text was wrong** - reading twenty-six actual bios found doubled punctuation, German bios naming English interests, and unfillable slots; all three are now gated. English and German authored, 39.9 percent still falling back and counted |
| CCB-S4-008 | Consolidation of the two parallel-chat workstreams | Briefing | **Delivered** 2026-08-01 (D-110 to D-114). The planning package is committed under [`docs/planning/`](../docs/planning/), sixteen files, **scrub required zero replacements** and the README records what was checked. The 23-commit AI block has its umbrella row below and its reasoning in D-111 to D-113; `architecture.md` §24 is an architecture rather than an inventory; `security.md` §12 answers four of its five open questions from the code, **prompt injection stays OPEN**. Three carried code gaps closed: the BIGINT overflow guard is gated at all three sites (**and proving the gate found that only one of the three has a second bound in the data layer**), the D-109 language drop is printed, and the stale `claude/funny-goldstine-4812cc` worktree and branch are removed. **Stage 0 initially stopped**: 14 of 16 M2 documents were absent and were delivered mid-briefing. Reconciliation found **three contradictions**, all resolved in the repository's favour and all recorded |
| CCB-S4-009 | Post-consolidation hygiene | Briefing | **Delivered** 2026-08-02 (D-115). Both harnesses CCB-S4-008 left red are green and **mutation-proven in both directions**; the full set is **41 of 41**. `verify:admin-brand-fx` follows the operator's ruling that D-088 governs, inverted and broadened so no plain-spelling product reference survives anywhere in the admin chrome. `verify:admin-navigation-shell` was stale against **D-089**, which moved the marketing site out and took `/website` with it: **Stage 2 did not stop**, because the page was deliberately removed under a recorded decision rather than lost in a redesign, evidenced by `3da6076`. **CCB-S4-008's stated cause for that harness was wrong** and is corrected in `architecture.md` §24.7; a literal grep missed an interpolated attribute. Living-documents count corrected from five to six in the four current statements, `adapter-contract.md` named; the Season 1 and Season 2 protocols keep "five" because it was true before CCB-S3-020 added the sixth. **No `src/` change, so no deployment.** One finding out of scope and recorded, not fixed: `BOT_DISPLAY_NAME` regressed away from D-088 in `80f26b4` and is still wrong on `main` |
| CCB-S4-010 | Security review of the local AI subsystem: prompt injection | Briefing | **Delivered** 2026-08-02 (D-116, D-117). Headline: **the consent path is injection-resistant by construction**, on four independent layers, and the evidence is the code rather than the prompt. The gate is a conjunction over two independent evaluators of the same text and the model's output alone can never satisfy it; a third-party target is refused outright; a consent intent **writes nothing**; and the write is keyed to the sender of the confirming message. **The worst case of a perfectly successful injection is the bot asking the sender about the sender's own consent.** The consent path's own wording never reaches a model either: an allowlist of 9 of 36 persona keys, gated over 60 real personalize calls. **One gap found and closed**: `status` reports a member's own publication state and ran in free mode where `requiredLiterals` protects tokens rather than meaning, so it is now locked. **One gap scoped, not built**: a model-emitted third-party name is not covered by mention-based redaction (D-117). **Four residuals need a live adversarial test** against a running endpoint and are named rather than waved through. `verify:interaction` gains three checks, each mutation-proven; 41 of 41 green. `src/` changed, so a deploy ships the locked status reply |
| CCB-S4-011 | Backup infrastructure, from an unrun script to a running timer | Briefing | **Delivered** 2026-08-02 (D-118). **What now triggers it:** `cinderella-backup.timer`, daily 03:30, `Persistent=true` so a host that was off catches up on boot; installing and enabling the units on the VPS is the operator step `BACKUP.md` §3 documents. Set widened on both operator rulings: **quarantine** (moved out of `MEDIA_ROOT`, so in no other archive) and the **messaging-core SQLite** (her SimpleX identity; unencrypted, so `0600` in `0700`). **Round trip PROVEN here**, not owed: PostgreSQL 16.13, scratch databases, restore into an empty DB with matching rows, byte-identical media and quarantine, SQLite identity read back, 15 generations of each of five kinds pruned to 14 with the oldest removed, failed dump leaving zero files. **Two real defects found and demonstrated**: a shell redirect left a zero-byte dump that counted as a generation, and `ls`-over-glob under `pipefail` aborted the whole script for any kind with no files yet. **Owed on the VPS** (cannot be run here): file modes, since NTFS reports `install -m600` as success and leaves `0644`, and the timer itself, since there is no systemd. **Operator-owned and still open:** the privacy-policy clause that a restore re-applies subsequent deletions |
| CCB-S4-012 | `backup.sh` hotfix: env sourcing and the executable bit | Briefing | **Delivered** 2026-08-02. Two defects found installing CCB-S4-011 on the VPS, both real and both fixed forward. **(1) The env file was executed, not read.** `set -a && . "$ENV_FILE"` parses values as shell, so the admin Argon2 hash `$argon2id$v=19$...` read as an unset variable under `set -u` and aborted the unit at env line 9 before anything was written. Now extracted as **data**, only the four keys the script uses, on the principle `deploy.sh` already applied for the same `$` hazard. **(2) The executable bit was not in git**, so a fresh checkout failed `203/EXEC`; tree mode is now **`100755`** (was `100644`). **The failure was reproduced first**, message and line number matching the host, then re-proven fixed: full round trip against an env carrying a synthetic Argon2-shaped hash, five archives, exit 0, restore identical, hash line verbatim, and the missing-`DATABASE_URL` guard still firing with its original message and zero files left. `$` in values the script consumes stays literal. **No `src/` change, so no application deploy**; the operator needs `git pull` then `systemctl start cinderella-backup.service` |
| CCB-S4-005 | Profile generator, component 3: surface derivation | Briefing | **Delivered** 2026-07-31 (D-099). `npm run verify:surface`, 28 checks. Style is a pure function of the latent vector and identity is drawn from population parameters, kept apart by the function signatures rather than by discipline. **The §8 collinearity diagnostic caught the loadings on its first run**: `tone` and `emojiAffinity` correlated at 0.983, which had also left the §5 coherence cap inert at 0 of 20,000 avatars; re-authored to 0.659 and 6.35 percent. Three §13 open questions answered in D-099 |

**Both ids were allocated at delivery rather than at issue**, which is the exception rather
than the practice. The register's own rule is that ids are allocated at the moment a
briefing is issued; these two briefings arrived without them, and the trait-sampler briefing
said so in terms ("No CCB id assigned. Needs one before it can be recorded against the
register"). Recorded here so the gap is visible rather than inferred from the missing
trailer on `0e0a3d9`.

### Work in `main` that carries no briefing id

One row accounts for the whole block. **It is deliberately not given a `CCB-` id**: no id is
reused, no commit is rewritten, and inventing one would misrepresent unbriefed work as
briefed. The `Block` column therefore carries a descriptive label, not an identifier.

| Block | Commits | Span | Decision | Status |
|---|---|---|---|---|
| Local AI subsystem and admin expansion | `b308201`..`e236ccf` (**23**, inclusive of `b308201`; roughly 17,700 inserted lines across 46 files) | 2026-07-25 to 2026-07-27 | **D-068** | **Consolidated under CCB-S4-008.** None of the 23 carries a `Briefing:` trailer, so none is registrable as a briefing and none was rewritten to add one. The work originated in the operator's parallel planning chats and was **deployed but unexplained**: the code was in `main` and its reasoning was in a chat transcript. That reasoning is now recorded as **D-111** (the fourteen pre-implementation boundaries, marked clause by clause against the code), **D-112** (the consent double gate) and **D-113** (the private inference path); [`architecture.md`](../docs/architecture.md) §24 is an architecture rather than an inventory, and four of the five open security questions are answered in [`security.md`](../docs/security.md) §12. **Prompt injection remains unreviewed** and is scoped to a successor briefing |

**This block is Season 3 work by date and is not a Season 3 briefing.** It landed inside
Season 3's span and carries no id, so it changes nothing about the season boundary:
**Season 3 still closes with CCB-S3-043**, which is a statement about briefings, and this
was never one. Recorded in the same spirit as the `CCB-S4-004` row above: the gap reads as
**explained** rather than as a missing briefing.

The original inventory is in [`SEASON-3-PROTOCOL.md`](SEASON-3-PROTOCOL.md) **Part G §3**,
kept as written.

## Planning documents (not Claude Code Briefings — they inform Season 2)

- **Command & Moderation Concept** — CINDERELLA-CONCEPT-commands-moderation.md
- Supporting research (SimpleX bot capabilities, avatar propagation, secure
  remote-access options) — reference material, not briefings.

## Notes

- **Numbering change:** the season label was realigned from the retired zero-based
  scheme to Season 1 (this block) / Season 2 (next). Old delivered filenames retain
  their original descriptive names; the authoritative id is the `CCB-S1-NNN` column
  above. Commit messages for pre-alignment work carry the original `CCB-S0-<NNN>`
  ids in git history (historical artifacts, not rewritten).
- **Supersessions:** CCB-S1-004 (WireGuard) → CCB-S1-005 (appless public console);
  CCB-S1-009 (XFTP v1) → CCB-S1-010 (EXDEV root cause); CCB-S1-013 (desktop-set
  avatar) → CCB-S1-014 / CCB-S1-015 (core-source finding, then SDK-native).
- From here, ids are allocated at the moment a briefing is issued.
