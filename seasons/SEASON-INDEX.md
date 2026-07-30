# Cinderella — Season Index

The unit of work is the **Season**, numbered from **1**. Each season is authorised by
numbered briefings (`CCB-S<season>-<NNN>`) and closes with a protocol document under
`seasons/`. The earlier zero-based scheme and the "Stages 0–7" framing are deprecated —
see [`../docs/decisions.md`](../docs/decisions.md) **D-014**.

## The Season 3 / Season 4 boundary, settled

**Season 3 ends with CCB-S3-043. Season 4 has not begun.** `CCB-S4-001` is a
**misnumbered Season 3 briefing**, not the start of Season 4.

This was genuinely ambiguous and had to be settled from the commit history, because
until now the index and the register both claimed Season 4 was "already underway".
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
  Nothing in the Season 4 scope below covers it.

**The id `CCB-S4-001` is not rewritten.** It stands in commit messages, in D-080,
D-081 and D-082, and in `architecture.md` §29 and §30. This repository already has the
precedent: pre-alignment `CCB-S0-<NNN>` ids survive in git history as historical
artifacts and are corrected in the register rather than rewritten. Read `CCB-S4-001`
as **the fifteenth-from-last briefing of Season 3**, recorded as such in
[`CCB-REGISTER.md`](CCB-REGISTER.md).

**Season 4 therefore begins with the first briefing issued after CCB-S3-043**, which
will be `CCB-S4-001`… and that id is taken. **Season 4's first briefing is
`CCB-S4-002`.** Stated explicitly here so the collision is not rediscovered later.

> **Two season counts run in parallel from now on.** The above is the *product's*
> count. The marketing site has its own, beginning at **site Season 1**, in its own
> repository ([D-089](../docs/decisions.md)). They share no briefing ids and no
> register. Always name which one you mean.

| Season | Title | Status | Close-out |
|--------|-------|--------|-----------|
| 1 | Foundation — consent-based SimpleX→web archive | Content-complete, in production | [SEASON-1-PROTOCOL.md](SEASON-1-PROTOCOL.md) |
| 2 | Public product — archive front, SEO, stream experience, reporting, website foundation | Content-complete, in production | [SEASON-2-PROTOCOL.md](SEASON-2-PROTOCOL.md) |
| 3 | Interaction layer, plugin framework, public front polish, queue foundation, latent-fault audit, the site split | **Closed** by CCB-S3-043 | [SEASON-3-PROTOCOL.md](SEASON-3-PROTOCOL.md) |
| 4 | Consolidate the local AI work, finish the carried briefings, AI brain, categorization, legal, child safety, multi-tenancy, multi-profile runtime | Not started; opens at `CCB-S4-002` | — |

> **Numbering note.** All briefing ids are renumbered to `CCB-S1-<NNN>` (canonical
> and authoritative — see [`CCB-REGISTER.md`](CCB-REGISTER.md)). Commit messages for
> pre-alignment work retain their original `CCB-S0-<NNN>` ids in git history
> (historical artifacts, not rewritten).

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

**Season 4 (not started; opens at CCB-S4-002).** The marketing site on its own domain and
the demo backend shipped under the misnumbered CCB-S4-001 and belong to Season 3
(D-080/081/082); see the boundary section at the top. Ahead: consolidate the
parallel-chat AI work into the documents and the architecture; finish the carried briefings, consent-affecting ones first;
the AI brain behind one configurable endpoint; categorization + media gallery on the queue;
counsel review of the legal texts; child safety; multi-tenancy & Pro (D-026), where the
adapter seam pays off; and the **multi-profile runtime** (D-083/084/085), which is design
only and needs the conversation-identity question answered before the archive can key
anything per conversation.
