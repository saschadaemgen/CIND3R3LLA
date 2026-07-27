# Cinderella — Season Index

The unit of work is the **Season**, numbered from **1**. Seasons 1, 2 and 3 are complete
and in production; Season 4 is next. Each season is authorised by numbered briefings
(`CCB-S<season>-<NNN>`) and closes with a protocol document under `seasons/`. The
earlier zero-based scheme and the "Stages 0–7" framing are deprecated — see
[`../docs/decisions.md`](../docs/decisions.md) **D-014**.

> **Numbering note.** All briefing ids are renumbered to `CCB-S1-<NNN>` (canonical
> and authoritative — see [`CCB-REGISTER.md`](CCB-REGISTER.md)). Commit messages for
> pre-alignment work retain their original `CCB-S0-<NNN>` ids in git history
> (historical artifacts, not rewritten).

| Season | Title | Status | Close-out |
|--------|-------|--------|-----------|
| 1 | Foundation — consent-based SimpleX→web archive | Content-complete, in production | [SEASON-1-PROTOCOL.md](SEASON-1-PROTOCOL.md) |
| 2 | Public product — archive front, SEO, stream experience, reporting, website foundation | Content-complete, in production | [SEASON-2-PROTOCOL.md](SEASON-2-PROTOCOL.md) |
| 3 | Interaction layer, plugin framework, public front polish, queue foundation, latent-fault audit | Content-complete, in production | [SEASON-3-PROTOCOL.md](SEASON-3-PROTOCOL.md) |
| 4 | Consolidate the local AI work, finish the carried briefings, AI brain, categorization, legal, child safety, multi-tenancy | Next | — |

## Season 1 — Foundation

**Delivered and live** at `cinderella.simplego.dev`, bot active in the "Cyb3rD3sk"
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

**Delivered and live** at `cinderella.simplego.dev`: the consent-gated public archive
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

**Delivered and live** at `cinderella.simplego.dev`: natural addressing in English and
German over a closed intent catalog that the resolver classifies but never executes; the
plugin framework with the crypto price plugin as its first tenant; archived member
questions paired with her answers; her own messages as a second publication branch; media
metadata stripping; click-to-play video cards; chat formatting, per-item permalinks and a
script-free share bar on the public front; the operator's website; a durable
Postgres-backed job queue and a capture write-ahead foundation; the admin restructure and
dark-neon restyle; and the enforced no-em-dash rule. The season's real story is five latent
faults found and fixed, and the swallowed-error audit they produced (D-063).

See [SEASON-3-PROTOCOL.md](SEASON-3-PROTOCOL.md) — in particular **Part G**, which records
the delivery gap per briefing id (CCB-S3-012, 013 and 020 were never received and need
reissuing), four Part C items that were in fact already delivered, and the inventory of the
**local AI subsystem that entered the repository outside the briefing scheme** and is
Season 4's first task.

**Season 4 (planned):** consolidate the parallel-chat AI work into the documents and the
architecture **before anything else**; finish the carried briefings, consent-affecting ones
first; the AI brain behind one configurable endpoint; categorization + media gallery on the
queue; legal & compliance; child safety; multi-tenancy & Pro (D-026), where the adapter
seam (CCB-S3-020) pays off.
