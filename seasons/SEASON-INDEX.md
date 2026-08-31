# Cinderella — Season Index

The unit of work is the **Season**, numbered from **1**. Each season is authorised by
numbered briefings (`CCB-S<season>-<NNN>`) and closes with a protocol document under
`seasons/`. The earlier zero-based scheme and the "Stages 0–7" framing are deprecated —
see [`../docs/decisions.md`](../docs/decisions.md) **D-014**.

| Season | Title | Status | Close-out |
|--------|-------|--------|-----------|
| 1 | Foundation — consent-based SimpleX→web archive | Content-complete, in production | [SEASON-1-PROTOCOL.md](SEASON-1-PROTOCOL.md) |
| 2 | Public product — archive front, SEO, stream experience, reporting, website foundation | Content-complete, in production | [SEASON-2-PROTOCOL.md](SEASON-2-PROTOCOL.md) |
| 3 | Interaction layer, plugin framework, public front polish, queue foundation, latent-fault audit, the site split | **Closed** by CCB-S3-043 | [SEASON-3-PROTOCOL.md](SEASON-3-PROTOCOL.md) |
| 4 | The AI she actually is — character, constitution, memory, backups, moderation, search | **Closed** by CCB-S4-052 | [SEASON-4-PROTOKOLL.md](SEASON-4-PROTOKOLL.md) |
| 5 | More than one of her, and the Avatar layer | **Closed** by CCB-S5-065 | [SEASON-5-PROTOCOL.md](SEASON-5-PROTOCOL.md) |
| 6 | Not yet titled | **Not yet opened** | [SEASON-6-HANDOVER.md](SEASON-6-HANDOVER.md) (forward-looking) |

> **Two season counts run in parallel.** The above is the *product's* count. The
> marketing site has its own, beginning at **site Season 1**, in its own repository
> ([D-089](../docs/decisions.md)). They share no briefing ids and no register. Always
> name which one you mean.

> **Numbering note.** All briefing ids are renumbered to `CCB-S1-<NNN>` (canonical
> and authoritative — see [`CCB-REGISTER.md`](CCB-REGISTER.md)). Commit messages for
> pre-alignment work retain their original `CCB-S0-<NNN>` ids in git history
> (historical artifacts, not rewritten). One id, `CCB-S4-001`, is misnumbered across
> the season boundary; see [the appendix](#appendix-the-season-34-boundary-settled).

## Season 1 — Foundation

**Delivered and live** at `<admin-host>`, bot active in the "Cyb3rD3sk"
group: capture pipeline (text/image/video/voice/link/file → PostgreSQL + on-disk
media), consent gating (`/publish` / `/unpublish`, forward-only, deletion-aware),
the responsive admin console (dashboard, Messages + takedown, Consent, Settings,
Embed management), an appless public passkey-secured console over Let's Encrypt TLS
with the full hardening suite, PostgreSQL-backed sessions, reliable XFTP media, and
the SDK-native avatar. See [SEASON-1-PROTOCOL.md](SEASON-1-PROTOCOL.md) and the
living documents under [`../docs/`](../docs/).

**Season 2 (planned, from the Season 1 vantage point):** public embed front
(`/embed/<instance-id>`), command & moderation system, local AI brain (RTX 3090 over
a tunnel), and multi-tenancy for customer self-service. _(Season 2 as actually
delivered is recorded below; command/moderation, the AI brain and multi-tenancy moved
to Season 3.)_

## Season 2 — Public product

**Delivered and live** at `<admin-host>`: the consent-gated public archive
front (`/embed/<id>`, SSR, with a separate consent-gated media path); the full SEO &
marketing suite (schema.org JSON-LD, sitemaps, robots, OG/Twitter + auto social image,
RSS, analytics hook — all admin-configurable); the stream experience (house-palette
light/dark toggle, live auto-update, cursor-based infinite scroll with DOM windowing,
inline video, loading polish); content reporting & moderation (public report button +
audit-logged admin review queue); auth hardening (RP-ID/origin startup guard); and the
marketing website foundation at the domain root (i18n EN/DE, landing page, discreet
operator login, off-by-default analytics/share/cookie-banner building blocks). See
[SEASON-2-PROTOCOL.md](SEASON-2-PROTOCOL.md) and the living documents under
[`../docs/`](../docs/).

**Season 3 (planned, from the Season 2 vantage point):** the real website (redesign + all
pages + footer-linked legal); the legal & compliance backbone (Impressum, Privacy Policy,
Terms, DSA contact, preserve-and-report); child-safety CSAM screening at receipt; the AI
brain + categorization engine + video gallery; the command & moderation system; retention
auto-delete (D-027); and multi-tenancy & Pro (D-026). _(Season 3 as actually delivered is
recorded below; the legal texts, CSAM screening, categorization, retention and
multi-tenancy moved to Season 4.)_

## Season 3 — The interaction layer, and the latent-fault audit

**Delivered and live** at `<admin-host>`: natural addressing in English and
German over a closed intent catalog that the resolver classifies but never executes; the
plugin framework with the crypto price plugin as its first tenant; archived member
questions paired with her answers; her own messages as a second publication branch; media
metadata stripping; click-to-play video cards; chat formatting, per-item permalinks and a
script-free share bar on the public front; the operator's website; a durable
Postgres-backed job queue and a capture write-ahead foundation; the admin restructure and
dark-neon restyle; and the enforced no-em-dash rule. The season's real story is five latent
faults found and fixed, and the swallowed-error audit they produced (D-063).

See [SEASON-3-PROTOCOL.md](SEASON-3-PROTOCOL.md) — in particular **Part G**, which records
the delivery gap per briefing id, four Part C items that were in fact already delivered, and
the inventory of the **local AI subsystem that entered the repository outside the briefing
scheme** and is Season 4's first task.

**Delivery gap, corrected under CCB-S3-028.** Part G recorded CCB-S3-012, 013 and 020 as
never received and needing reissue. All three were reissued and **delivered** on 2026-07-27
(`eeae2a2`, `b76aa8f` + `bf1f779`, and `cea9adf` for Phase A of the seam). CCB-S3-027 and
CCB-S3-029 also landed and were absent from the register entirely. The close-out currency
check itself ran before any of this and was stale; CCB-S3-028 re-ran it and found **all six
living documents out of date, five seriously**.

**Season 4 (planned, from the Season 3 vantage point):** the marketing site on its own domain
and the demo backend shipped under the misnumbered CCB-S4-001 and belong to Season 3
(D-080/081/082); see [the appendix](#appendix-the-season-34-boundary-settled). Ahead: consolidate the
parallel-chat AI work into the documents and the architecture; finish the carried briefings, consent-affecting ones first;
the AI brain behind one configurable endpoint; categorization + media gallery on the queue;
counsel review of the legal texts; child safety; multi-tenancy & Pro (D-026), where the
adapter seam pays off; and the **multi-profile runtime** (D-083/084/085), which is design
only and needs the conversation-identity question answered before the archive can key
anything per conversation. _(Season 4 as actually delivered is recorded below; the legal
texts, categorization, retention, child-safety detection, the media gallery and multi-tenancy
moved to Season 5 and beyond. What arrived instead was the AI herself.)_

## Season 4 — The AI she actually is

**Closed** by CCB-S4-052. `48b61f3` (Season 3's close) to `8617491`: **199 commits, 51
briefings (CCB-S4-002 to 052), 60 decisions (D-094 to D-154), 21 migrations (023 to 043)**,
and 64 `verify:` scripts at season end. See [SEASON-4-PROTOKOLL.md](SEASON-4-PROTOKOLL.md),
which carries a closing section recording every figure corrected on filing and its evidence.

The season began with a bot that had been deliberately deleted and a codebase split across
three parallel workstreams. **Delivered and live:** the profile generator as offline tooling;
the two parallel workstreams consolidated and the whole surface reviewed for prompt injection;
backups that actually run, encrypted with the key off-host and watched from the console across
a privilege boundary it never crosses; the multi-profile runtime merged and one bot wired onto
it; the bot brought back into the operator's group step by step, ending in **free conversation**;
a personality on five dials under a ceiling that does not move, with an origin she may draw on
and never recite; moderation on two ladders, built, reversible and **shipped locked**; grounding
facts and web search behind a fence that results can never escape; **the rule registry and the
Book of Elii**, where every sentence she is told is a row an operator can read, edit, enact and
be quoted; conversation memory of the whole group thread, equally untrusted; and a reasoning
control that was refuted rather than built.

The through-line: **a rule you cannot read is a rule you cannot trust.**

**Season 5 (planned, from the Season 4 vantage point):** the Avatar layer in three pillars
(arming the moderation, the privileged moderation channel, the learning path); multi-bot
hosting; a self-tuning request queue; the channel bridge; the gallery, coordinated with the
site repository; and the hardware page with the model-reachability display that would have
saved an hour three times in Season 4. Still carried from Season 3's forecast and not yet
built: the legal texts under counsel review, categorization, retention auto-delete, the
child-safety detection provider, and multi-tenancy & Pro (D-026).

## Season 5 — More than one of her, and the Avatar layer

**Closed** by CCB-S5-065 on 2026-09-01; the record is
[SEASON-5-PROTOCOL.md](SEASON-5-PROTOCOL.md). Opened by CCB-S5-001 on 2026-08-08; season
dates 2026-08-08 to 2026-08-31 per the register's own rows.

**Delivered and live:** multi-bot hosting from day one (every enabled bot on one core, per-bot
laws over a shared constitution, CCB-S5-001/D-155) with the console catching up over the
briefings that followed;
the rooms model (one record captures one room, CCB-S5-033/D-190); the knowledge base with
verbatim chunks and the evidence-gated source line (CCB-S5-022/023, D-256); the channel bridge
with per-channel web publication and its retention bound (CCB-S5-032/043/064); the music
library (CCB-S5-044); the retention floor that stopped keeping what nobody agreed to — 64% of
the archive — with its tombstone (CCB-S5-054, D-240/D-241); the honesty guard family (branded
ids, the repetition gate, the injection floor, the evidence rule, D-252–D-258); and the
site-material review that closed the season (CCB-S5-062/063/064, ~70 defect entries from six
annexes).

**What the plan said and did not happen:** none of the three Avatar-layer pillars was started —
the moderation is still observe-only (`ARMING_UNLOCKED = false`, awaiting the live-group
proofs), no privileged channel, no learning path as scoped. The protocol measures the whole
plan honestly, gives the failures equal weight (the 38 source-line emissions, the eighteen
failed probes, the four id-space confusions, the deny-lists that failed open again), and
records a register gap found on filing: six briefing ids with no register row.

_**Season 6 (from the Season 5 vantage point):** scope will be set by its own briefings; the
carried spine is in [SEASON-6-HANDOVER.md](SEASON-6-HANDOVER.md) — arm the moderation, the
learning path's correction-and-memory halves, the queue, the gallery, the hardware page, and
the record debts the close queued._

## Appendix: the Season 3/4 boundary, settled

_Settled under CCB-S3-043 and kept because `CCB-S4-001` still appears in commit messages, in
the decisions and in the architecture, and anyone reading the register will trip over it._

**Season 3 ends with CCB-S3-043.** `CCB-S4-001` is a **misnumbered Season 3 briefing**, not
the start of Season 4.

This was genuinely ambiguous and had to be settled from the commit history, because
at the time the index and the register both claimed Season 4 was "already underway".
The evidence:

- `CCB-S4-001` landed on **2026-07-27** (`3e60c96`, `6769281`).
- **Fourteen Season 3 briefings were issued and delivered after it**: CCB-S3-030,
  031, 034, 035, 036, 037, 038 and 040 on 2026-07-28; 041 on 2026-07-29; 042 and 043
  on 2026-07-30. Three more (027, 028, 029) landed the same day as S4-001.
- So the numbering never actually moved to Season 4. Reading the boundary the other
  way (Season 3 ended when S4-001 began) would make **fourteen** ids wrong in order to
  keep **one** right. One misnumbered id is the parsimonious reading, and it is what
  the evidence shows.
- The subject agrees. `CCB-S4-001` delivered the marketing site on its own domain,
  which is Season 3's own stated scope ("public front polish… the operator's website").
  Nothing in the Season 4 scope covers it.

**The id `CCB-S4-001` is not rewritten.** It stands in commit messages, in D-080,
D-081 and D-082, and in `architecture.md` §29 and §30. This repository already has the
precedent: pre-alignment `CCB-S0-<NNN>` ids survive in git history as historical
artifacts and are corrected in the register rather than rewritten. Read `CCB-S4-001`
as **the fifteenth-from-last briefing of Season 3**, recorded as such in
[`CCB-REGISTER.md`](CCB-REGISTER.md).

**Season 4 therefore begins with the first briefing issued after CCB-S3-043**, which
would be `CCB-S4-001`… and that id is taken. **Season 4's first briefing is
`CCB-S4-002`.** Stated explicitly here so the collision is not rediscovered later.

**One consequence, recorded when Season 4 was filed:** no contiguous commit range holds
Season 4 exactly. CCB-S4-002 was delivered on 2026-07-28 as `0e0a3d9`, two days *before*
Season 3 closed at `48b61f3`, because the profile-generator chat ran alongside that close.
The 199 commits counted for Season 4 are everything after Season 3's close, and CCB-S4-002's
own delivery sits outside them.
