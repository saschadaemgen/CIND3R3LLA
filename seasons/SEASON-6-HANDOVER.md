# SEASON 6 HANDOVER

- Season: 6
- Repository: `saschadaemgen/CIND3R3LLA`
- Status: **not yet opened.** This is a forward-looking document, written at Season 5's close
  for whoever picks up Season 6 with no memory of it. It will be superseded by
  `SEASON-6-PROTOCOL.md` at that season's close.
- Written under **CCB-S5-065**. The season that produced it is in
  [SEASON-5-PROTOCOL.md](SEASON-5-PROTOCOL.md); the reasoning is in
  [`../docs/decisions.md`](../docs/decisions.md) (D-155 to D-262); the item-level record is in
  [`CCB-REGISTER.md`](CCB-REGISTER.md) and [`../docs/feature-backlog.md`](../docs/feature-backlog.md).
- Ground rule inherited from the close that wrote this: no invented dates, no invented status.
  Every claim below states where it comes from.

## The state of the deployment, honestly

**What runs, live, today** (each verifiable in the code and the register):

- **Multi-bot hosting** — every enabled bot on one core, per-bot engines, consent handlers and
  capture registrations; `runForGroup` throws on an unknown owner (CCB-S5-001, D-155).
- **Capture and consent** — the original product, live since Season 1: six-type capture,
  encrypted media at rest, publication derived from consent and never a stored flag,
  revocation hide/delete with evidence holds. One record captures one room (CCB-S5-033).
- **The Book** — every prompt sentence a database row, console-editable with history and
  rollback, per-bot overrides that cannot touch the constitution or switch off a critical law
  (migrations 035–076), disclosure gates, the recital, the one-law scene.
- **The channel bridge** — verbatim channel announcements on cadence, no model on the path,
  per-channel web publication keyed on the channel link (CCB-S5-032/043).
- **The music library** — playlists as the unit of assignment, the two proven send shapes, the
  operator's budgets, delivery watches (CCB-S5-044, D-216–D-224).
- **The knowledge base** — per-bot grants, verbatim chunks, measured 0.60 floor, and the
  evidence-gated source line: a document is cited only when the answer demonstrably used it
  (D-256).
- **Web search** — deterministic pre-search gate, results fenced into the user message,
  measured 0.70 floor, the snippet-not-a-page label (D-244).
- **The honesty guard family, all live**: protected-text strip (D-180), blocked-name
  strip-not-reject (D-227), invented-refusal strip (D-226), unseen-member-claims strip
  (D-258), the repetition gate (D-253), branded id types (D-258), the injection floor
  (`asksToSetAsideRules`, D-258).
- **Moderation, observe-only** — violations counted per member per chat per bot, the warn rung
  SPEAKS in production, rungs wear derived names (D-262). It cannot act; see the next section.
- **The admin console and the public SSR front** — passkeys, full hardening, the activity
  stream and channel block; only the widget render / Web Component alone stays parked.

**What is switched off, by design, waiting on the operator** (source: the code's own
defaults and the decisions cited):

- The **archive retention sweep** (`DEFAULT_RETENTION.enabled = false`,
  `src/archive/retention.ts` — D-240: "the operator turns it on after reading the count").
- The **bridge media retention sweep** (same shape, 30-day default, D-262, migration 077).
- The **core TTL** (`/_ttl`), settable from the same page.
- **Music member-uploads** (per-bot switch, off by default, MP3-only per D-219).
- **Child-safety screening** — no provider configured; the null provider transmits nothing;
  blocked on the operator's provider account and a lawyer (CCB-S3-012).
- **The demo UI** — backend and isolation exist, the visitor-facing UI does not, the hostname
  404s by deliberate nginx configuration (D-081/D-082).
- Two **dead flags** that are neither on nor off but *unread*: `cloud_allowed` and
  `auto_accept_contacts` — stored, surfaced, and honoured by nothing (backlog; restated
  unfixed in D-261). Either honour them or say on the page that they are not read.

**What has never been proven live** (built and harness-proven only):

- **Enforcement above the warning** — mute/unmute with role restore, block, remove, expiry,
  undo after restart: all proven against the port fake only.
- The **welcome plugin's live cases** (register, CCB-S5-041: "LIVE CASES UNPROVEN and stated
  as such").
- **Both retention sweeps' first production pass** (each proven on real files/rows in
  harnesses; neither has ever run against the production archive).
- The **backup timer's first real run** on the VPS (units installed, catch-up unconfirmed —
  backlog, BACKUP.md §6).
- The **live adversarial injection test** (D-117's four residuals that reading code cannot
  settle; needs the operator's environment).
- The runtime **`degraded` state** — never entered; a core fault leaves the runtime reporting
  ready (backlog).
- The **capture write-ahead substrate** — `capture_events` has no production writer at all.
- The member-side questions only a member's app can answer (D-209; and the precedent that
  source is not proof: animated GIFs are supported in the client source and proven not to
  render).

## The largest built-but-inert thing in the product

**The moderation ladder cannot enforce anything today.** `ARMING_UNLOCKED` is `false`
(`src/moderation/rules.ts`), and it has been since enforcement was built and deliberately
locked under **CCB-S4-035** (D-139). Everything below it is complete: the ladders, the
counters, the sanction records, the arming console with its typed confirmation, the undo, the
expiry-as-overdue model (migration 032), the port wiring, `verify:moderation`'s no-act
guarantee proven structurally, behaviourally and by schema CHECK. What is owed is the half no
harness can reach: **an actual mute applied and lifted in a live group, a moderator restored,
the five proofs enumerated in [`concepts/avatar-layer.md`](concepts/avatar-layer.md)** — an
evening, a second profile's group, and a second human, which only the operator can supply.
Flipping the flag afterwards is an engineering one-liner.

This gets its own section because a reader of the site — or of the console's own Moderation
pages, which render ladders, rungs and counters in working order — **will assume the product
moderates. It observes.** Every rung above the spoken warning does nothing, and has never done
anything, anywhere. Until the live proof happens, that sentence belongs in every conversation
about what the product is. And pillar 2's companion question (the ask-first privileged
channel) "should probably arrive together" with the arming, per the backlog.

## The three behavioural faults from live testing, still open

1. **She invents a definition rather than saying she does not know.** Measured, not
   anecdotal: 3 of 3 control runs invented complete, plausible definitions (a "SINA Box", a
   "Zeliqua protocol") on a bot holding no capability to look anything up (CCB-S5-046;
   `verify:offer-live` prints the count every run). The backlog's own words: "the one to fix
   first of everything on this page" — it is the failure the product is sold on not having.
   The open design question is recorded with it: a claim of fact is not a pattern the way an
   invented refusal is, so the deterministic half may need a different instrument than
   `capability-claims.ts`, and it is not obvious what — saying so is part of the work.
2. **A bot with no web search offers to look things up anyway** — one run in two, from its own
   priors (CCB-S5-046, "the half that does not hold, reported rather than hidden"). The
   deterministic mirror of D-226 — strip an OFFER of a capability the bot lacks, as refusals
   of capabilities it holds are already stripped — is **booked, not built**.
3. **The memory denial, not reproduced.** In production she denied holding messages that were
   in her window; eighteen runs against the production model with history supplied produced
   zero denials, so the live prompt differed from every prompt that could be reassembled
   afterwards and nothing recorded how (D-258). It is instrumented (`recordMemoryDenial`)
   rather than diagnosed — naming a cause would have been a guess — and **reading that counter
   is the next move**. Stated residue: a wrong *positive* claim inside the window is not
   caught by the guard that catches claims about unseen members.

## Queued work, from the annexes and the backlog

**The behavioural defects deliberately left out of CCB-S5-063** because they are not stale
surfaces — D-261's judged-not-fixed list, each "deserving its own briefing": the Welcome
once-rule cascading away on bot deletion (schema change); bridge intake trusting
MIME-by-extension; `latestMemberAudio` picking newest media rather than newest audio; the
probe conflating could-not-look with looked-and-absent; the crypto quote cache never evicting;
the missing console controls (four crypto settings, hideWords/deleteWords); mega-menu
grouping; raw group ids on the Moderation pages. Plus the standing debts D-261 restates:
the dead flags above, D-224's remaining delivery-watch halves (bridge re-hosted media and
recital images have the event half only), and marketing-ahead-of-legal.

**The console work the operator asked for and did not get** (recorded under CCB-S5-041 and
CCB-S5-059): every view declaring its kind (settings / data / infrastructure / overview /
access) so `verify:scope-copy` stops guessing; the picker's "All bots (shared settings)"
entry; hover tooltips ("he wants the OPTION of more detail"); the whose-data question on data
pages. And CCB-S5-059's **twenty-one recorded promises** ("Promised in conversation and never
written down" in the backlog) — four welcome-plugin additions, four bridge items, and the
rest, each with its source conversation noted there.

**Structural debt named for the next toucher** (backlog): move the announcement condition
into `shouldAnnounce` (until then the ordering in `engine.ts` is load-bearing); a tsconfig
for `scripts/` (64 pre-existing type errors); `selected_for_runtime`'s step-two drop (D-173);
**nothing re-runs checks automatically**, so a harness can be red on `main` for days unnoticed
(D-189, named-not-solved, bitten twice).

**Queued by the close itself** (CCB-S5-065): reconstruct the six missing register rows
(CCB-S5-039/040/042/043/044/047) from the commits listed in the
[Season 5 protocol](SEASON-5-PROTOCOL.md#the-register-gap-found-on-filing) while they can
still be read; renumber `architecture.md`'s duplicated sections (two §44, two §48, the
mid-file appendix) **together with a sweep of every `architecture.md §N` citation** — stated
in the doc's own header note; and give the README real chapters for the Season 5 plugins
(knowledge base, music, welcome, retention) — the close fixed its false figures but did not
write the missing coverage.

## Things that need a decision rather than a build

So Season 6 does not discover them as surprises. Each is the operator's, with its source:

- **The arming live proof** (above) — only he can supply the evening, the group and the second
  human; the engineering that follows is trivial.
- **The two retention switch-ons** — read the counts, then enable (D-240's and D-262's design).
- **The YouTube-downloader refusal** — decided in conversation, never recorded; D-261: "a
  decision entry should carry his reasoning, not an invented one."
- **The D-205 bridge re-key** — the bridge tables are still keyed on the local group id a
  rejoin replaces; the reasoning is written in `origin.ts` and the schema does not follow it.
  Named repeatedly, never briefed. His call on when.
- **Pro and the legal texts** — a public pricing page is ahead of terms that do not exist;
  nothing lawyer-reviewed; the AGPL linking boundary for Pro (D-026). Needs counsel, not code.
- **The four recorded-unanswered decisions** (backlog, CCB-S5-059): the 1,255 duplicate
  messages of 7–12 August (found, counted, never acted on); the `selected_for_runtime` drop;
  otplib v12→v13; the deploy that hangs on a GitHub download, cause never established.
- **Security/ops items only he can do**: register the second passkey (the YubiKey), rotate
  and disable break-glass, enable the backup timer and confirm its first run, decide backup
  encryption, move `MEDIA_SECRET` and the backup passphrase somewhere separate from what they
  unlock.
- **The child-safety provider** — account, lawyer-agreed process, retention periods, point of
  contact (CCB-S3-012).
- **The erasure route** — an operator cannot destroy on a fully verified request; "a
  defensible default, but it should be a decision rather than an accident" (backlog).
- **Knowledge-beside-web** — when both could answer: answer from web and mention the
  material, or say what she was given and offer to look? Left open by CCB-S5-028.
- **The structured-origin countersignature** — the site repository must countersign the origin
  shape before either side commits further (backlog; settle in the site chat).
- **Smaller recorded calls**: `BOT_DISPLAY_NAME`'s collateral revert (D-088); the
  repo-visibility contradiction between SEASON-1-PROTOCOL Part C and `CLAUDE.md`; what a red
  harness from the unbriefed block means for the standard set; nicknames-at-creation.

## What Season 6 could be

Not a plan — Season 6's briefings will say what it is. But the carried spine is unchanged from
the last handover, now one season more overdue: **arm the moderation** (with the privileged
channel's authenticity question settled first), and **the learning path** (correction path
first, retrieval last — the knowledge base built the retrieval machinery; the member-memory
and correction halves are untouched, governed by D-147 and D-144/D-146). Around them: the
queue with honest feedback, the gallery with the site repo, the hardware page whose absence
has now cost time in two seasons' protocols, and the register/README debts above. Season 5's
lesson travels with all of it: **whatever is promised, make it a property of the application,
and measure the decision rather than an input to it.**
