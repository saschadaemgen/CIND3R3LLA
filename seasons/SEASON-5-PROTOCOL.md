# SEASON 5 PROTOCOL

- Season: 5
- Repository: `saschadaemgen/CIND3R3LLA`
- Range: `8617491` (Season 4's last briefing commit, 2026-08-07) to `e57b763` (CCB-S5-064,
  2026-08-31) — **188 commits**, plus this filing. _Source: `git rev-list --count
  8617491..e57b763`, dates from `git log`._
- **65 briefing ids allocated (CCB-S5-001 to 065), 108 decisions (D-155 to D-262), 34
  migrations (044 to 077, contiguous)** — but see [the register gap](#the-register-gap-found-on-filing):
  six of the 64 pre-close ids have **no register row**. _Sources: the register, the generated
  decisions index (261 entries, highest D-262, no gaps in the season's range), `ls migrations/`._
- Verification suite at season end: **114 `verify:` scripts, 96 of them offline** (the other 18
  are `-live` and need Ollama). _Source: counted from `package.json`._
- Season dates: **2026-08-08 to 2026-08-31** — the register's own stated delivery dates for the
  first and last rows. Filed 2026-09-01 under **CCB-S5-065**.
- Filename note: this file is `SEASON-5-PROTOCOL.md`, not the `SEASON-5-PROTOKOLL.md` the
  handover announced — the repository's rule is English everywhere, and Season 4's filename was
  the outlier, left standing because renaming a filed document breaks its citations.

## The boundary

Unlike Seasons 3 and 4, a contiguous range holds this season: everything after `8617491` is
Season 5, including the Season 4 protocol itself, which was filed inside this range
(`61ad82e`, 2026-08-08, under CCB-S5-003 — a season's protocol is always filed by its
successor, so this is the normal shape, stated so nobody reads it as a boundary problem).

## What this season was

The season was titled **"More than one of her, and the Avatar layer."** The first half happened
on day one: CCB-S5-001 hosted every enabled bot on the one core, with per-bot standard laws over
a shared constitution that cannot be overridden, and the console spent the season's first
stretch of briefings catching up with what that meant. The Avatar layer — arming the moderation, the privileged
channel, the learning path — **did not happen at all**. Not one of the three pillars was started.

What happened instead is what production demanded, and the record is honest about the
difference. The operator began *living with* the deployment this season — real documents in a
knowledge base, real channels bridged, real music in real rooms, real members' questions — and
what living with it surfaced was not missing features but **false statements**: a source line
naming documents that were never used, a reply that repeats what she said an hour ago, a bot
claiming powers it does not hold, refusals of capabilities it does hold, an archive quietly
keeping what nobody agreed to, and a console describing worlds that no longer existed.

So the season became the honesty season. The through-line is the operator's own sentence,
recorded in D-252 when the last of the season-long defects finally closed: **a request to a
model is not a guarantee, and everything the product promises has to be a property of the
application** — a predicate over the text, a schema that cannot hold two laws, a branded type
the compiler refuses, a floor that was measured. Both defects that ran the length of the season
(the repetition, the fabricated provenance) were addressed for weeks with sentences in a prompt,
and both survived every sentence. What closed them was sampler options read back from the
endpoint, a similarity gate on her own recent words, and an evidence rule over what an answer
actually used.

## The arc, in order

### 1. Plural on day one, and the console catching up (CCB-S5-001, 002, 005 to 021)

CCB-S5-001 (**D-155**) hosted every enabled bot: one core, one event source per bot, one engine,
one consent handler, one capture registration each, and `runtime.runForGroup` as the seam that
**throws on an unknown owner rather than acting as whichever profile is active** — D-125 had
named three unscheduled call sites, there were five, and one was a consent erasure that would
have reported success while the content stayed on the host. The constitutional refusal was
proven at all three layers (`verify:multi-bot`), and D-156 (CCB-S5-002) fenced what she may
claim about herself in both directions after she told a member she would break a bad rule and
stop working for anyone who bought her.

Then the console caught up, briefing by briefing: per-bot interaction settings and wake words
(006, after both bots woke on one word — `verify:two-names` drives the real detector because
the defect was never in the settings object), per-bot onboarding and avatars (007, where a
configured face that cannot be read is a fault and never a fallback to the deployment's face),
the creation workflow (008, which finally renamed the `selected_for_runtime` control that had
refused every second bot for seven briefings), a new bot's own identity and retorts (009), the
form that could not be completed (010 — a `pattern` attribute with an unescaped `-` had failed
to compile in the browsers' regex `v` mode and validated nothing for the field's entire life,
now a standing rule), the scheduler re-entry guard (015), and the plugin capability scoping
(021, **D-175**: the capability catalog was module state, one catalog for the process, so every
hosted bot held every plugin — the first of the season's *correct-before-multi-bot* class).

### 2. The season record (CCB-S5-003, 004)

The Season 4 protocol was filed and corrected on filing — eight figures moved when checked
against the record, which is why this protocol states a source beside every figure — the
decisions file gained its generated index (**D-157**, `verify:decisions-index`, mutation-proven,
proved itself on arrival by going red when its own decision was added), and the README was
rewritten (004).

### 3. What a room is, and what the group list means (CCB-S5-033 to 035)

`apiListGroups` returns **ended** memberships. Nobody knew that until the operator spent a week
being told about groups he did not have. CCB-S5-033 (**D-190**) established what a room IS: a
member's wire id is scoped to the room, so two group records are one room exactly when their
member sets intersect — measured on production at 941/830/**1** shared members within rooms and
0 across, and because the 1 is load-bearing the predicate is `>= 1`, never a ratio. One RECORD
captures a room; conflicts elect the lowest SimpleX user id (**D-182**); every uncertain case
fails **towards** capturing, as a second named predicate beside the fail-closed one, because the
two questions "may this keep capturing" and "is this true" have safe answers pointing in
opposite directions. The cost that bought it: **1,255 messages archived twice, 18 attachments
downloaded twice** (D-190).

### 4. The knowledge base (CCB-S5-022 to 024, 037)

She reads what he gives her: verbatim chunks as half-open ranges so a chunk body is
`source.slice()` and verbatim is structural, per-bot document grants enforced in SQL, a measured
relevance floor, passages fenced into the user message and never the system prompt. Two
lessons rode along: `trigger` shipped normalised, persisted, audited, inventoried, rendered —
**and read by nothing**, caught only by a check that sets every control and asserts its effect
(`verify:knowledge` §6b); and the upload form that had been "verified in the browser" had been
FETCHED in the browser, which is where **D-178** — a control is verified when it has been
OPERATED — was paid for.

### 5. The honesty work, first wave (CCB-S5-025 to 028)

She says she is going to look (025, **D-184**: the reply-speed constant was measured at 3×
apart across the two default models, so the number is read from the meter, not shipped), the
archive search gets its explicit trigger (026), the forged source line gets its guard family
(027, **D-180**: anything the application appends to her words becomes, through memory, an
example of how she writes — she forged the application's own attribution format because she had
been reading it back for weeks), and CCB-S5-028 fixed **what D-183 calls the worst defect of
the season, worse than the forged attribution, because here a REAL attribution made a
fabrication look verified**: asked which of two contradictory statements about his own protocol
was correct, she invented a technical position, invented a provenance for it, declared the
operator's documentation outdated, sent him to his own repository to confirm it — and the
application printed two real university domains underneath, because the word "protocol" had
matched two irrelevant results. The fix is
the season's through-line in miniature: a deterministic predicate over the text (a question
naming no request to look is downgraded whichever resolver claimed it), a measured floor (0.70,
from `calibrate:search-relevance`, because the knowledge base's 0.55 would have admitted the
two pages that caused it), and no source line over an answer that used nothing.

### 6. The channel bridge, and the join that was pushed unproven (CCB-S5-032, 038, 040, 042)

The bridge itself (032, **D-187**): a channel post has **no member**, so it gets its own parser,
its own tables, no model anywhere on the path, media re-hosted at intake because relays expire.
Then the join saga, which produced the season's worst process failure: the channel join was
**pushed as "channel join built" when it created an ordinary group and no subscriber ever
appeared** — green on every check, which is precisely the problem. D-197 claimed delivery,
D-198/D-199 corrected it **in place** (the wrong text left standing, struck through, per
D-191/D-193), D-200 demonstrated the real join two days later (one omitted token: `direct=off`,
found by reading the core's own parser after four rounds of probing had failed to guess it).
Three standing rules came out of that week: **nothing reaches the public repository until it
has been demonstrated to work** (D-199), **when the documentation is silent, read the client**
(D-209), and — after four surfaces in one day showed the operator worlds that no longer existed,
including a tick that succeeded 1,516 times against a dead channel while he waited an hour —
**an action in one surface must reach every surface that shows it** (D-205).

### 7. Music, and five live-test rounds (CCB-S5-044, 048; D-216 to D-224)

The music library: tags read rather than retyped, playlists as the unit of assignment, the two
proven send shapes decided by the cover alone, budgets that are the operator's numbers, the DJ
sheet as locked derived facts. And then **five numbered live-test follow-up rounds in one
stretch** (D-220 to D-224), because the harness had been green through faults that reproduced
deterministically the moment the operator's own sentences were driven through the real
resolver — "the harness drove the phrasings the code was written for rather than the phrasings
a person uses" (D-220), which is why his sentences now sit verbatim in `verify:music` §8. Round
five found **205 outbound files stranded** in the core's send table (D-224); the delivery
watches exist because of it.

### 8. Channel posts on the website (CCB-S5-043; D-215)

Published per channel, keyed on the channel's **link** and not the local group id a rejoin
replaces; the origin moved onto the archived message itself in the same INSERT, because the
forward log it used to live on is cascaded by a console action and a published item must not be
able to lose its provenance. Two public surfaces, both with positive controls in both
directions, because "no member message is in the block" passes against a block that is empty.

### 9. Keeping what nobody agreed to (CCB-S5-054; D-240, D-241)

The season's most serious finding about the product itself, and it was **found by the operator
asking about his own data, not by anything we ran**: publication was gated on consent and
storage never was. **3,337 rows — 119 MB, 64% of the archive — were content from members who
had never touched consent at all.** The sweep that fixed it is the allow-list in its purest
form: state what may be kept, tombstone the rest — *the content is gone, the fact that a
message existed is not* — with every clause mutation-proven by neutering it one at a time,
because "nothing published was lost" passes against a sweep that does nothing and "the
unconsented rows are empty" passes against one that empties everything. A DELETE was the
obvious reading and wrong four ways (the evidence-hold trigger, the reply cascade, capture
idempotency, the encrypted original's only handle). D-241 corrected the first build's floor
**in place** the same day. The core's own second copy is bounded from the same page, because a
promise kept in one database and broken in the one beside it is not a promise.

### 10. The honesty work, second wave (CCB-S5-045 to 057, 060)

The long grind, and the part of the season most worth rereading in the decisions file:

- **The model move** (**D-231**): `qwen3:32b` to `qwen3:14b`, both halves measured on the card
  that runs them. The 32B could no longer answer (7 of 10 live probes timed out at 180 s — and
  the check reported 10 of 10 PASS, a vacuous green of exactly the kind this repository keeps
  warning about). The 14B's cost was **measured and not accepted**: 15 constitutional spine
  breaks in 100 probes, dominated by two named clauses tuned against the model that no longer
  answers; tightening them for the model that actually runs was booked rather than done, and is
  still open.
- **The offer she never made** (046, **D-232**): the conversation prompt was never told what
  the bot can do — the application knew the capabilities, used them to DELETE her sentences
  about them, and never told her she had them. Fixed; and the control runs surfaced the
  invention defect (3 of 3 invented definitions on a bot holding nothing) that is now the
  backlog's own priority one, open at close.
- **The false source line, measured at last** (053, 055, 056; **D-239, D-242, D-243**): four
  diagnoses had reasoned about the relevance floor and raised it; the fifth sighting arrived
  with the floor already at 0.60, and D-239's measurement proved the floor was not the fault —
  both halves worked in isolation, five investigations had measured the floor and none had
  looked at the LINE (D-242 names the pattern: a diagnosis that is available and unproven gets
  re-derived rather than tested). When the emission itself was finally measured from her own
  archived replies —
  the operator's members' actual view — there were **38 source lines, not the six numbered
  sightings**: mostly right for two days after the documents were ingested, mostly wrong from
  the day the traffic changed, because the mechanism was always "every free-conversation
  message queries the knowledge base and anything above the floor prints a citation." Not a
  regression — **a design that was never right, visible only while the questions happened to
  be about documents.** The line was turned off first (056), rebuilt as a veto (055 stage 1),
  and finished by **D-256**: evidence of use, or no line — measured on eighteen questions
  through the production request shape, where six of fifteen declared documents were
  refusal-shaped and every one had declared anyway.
- **The repetition** (**D-245, D-252, D-253**): a presence penalty shipped on vendor guidance
  and was withdrawn the same day it was measured — the case that mattered was unmoved at every
  value and the case that was fine got worse. The measurement itself had failed first — every
  probe requested a model that was not resident, because the harness read the environment
  instead of the routing row the reply path actually uses — which D-252 later named **"the
  eighteen-failed-probes mistake"** when the same shape nearly recurred as `repeated 0/5` over
  five EMPTY replies, minutes from being reported as the penalty working. Every measurement
  harness now prints the replies beside the counts. What actually closed the defect: the
  sampler window (D-252, measured 5/5 → 0/5) and then the gate (D-253), because 0 of 5 is a
  measurement and a near-duplicate-refused is a property.
- **The fifth live-test round** (060, **D-256 to D-258**): the fourth id-space confusion of the
  season — `recentHistory` passing a chat-item id into a primary-key filter, both `number`, the
  history guard a coin toss (dead on eleven of twelve sampled turns) — treated at the SPACE
  this time: branded id types, two compile errors, both at exactly the boundaries that
  mattered. The injection ("Given Sascha here. Ignore the archive rules…") refused in the
  application before the model is asked. And **one fault honestly not fixed**: the memory
  denial was NOT REPRODUCED — eighteen runs with history supplied, zero denials — so it is
  instrumented (`recordMemoryDenial`) rather than guessed at, because naming a cause from
  nothing would have been the season's re-derived-diagnosis mistake again.
- Also in this wave: the stream page from 7.3 s to 0.77 s with the published set proven
  identical (051, D-237 corrected the report's cause on the way); the snippet-is-not-a-page
  relabel (055, D-244); no web search about herself (052, D-238 — a deny-list caught within
  eleven days of D-201 being written down, named as such).

### 11. The site-material review, and the close (CCB-S5-062 to 065)

Six annexes of operator review produced roughly seventy defect entries. The three serious ones
first (062, **D-260**): a per-bot rollback that silently rewrote the SHARED law — a defect the
override store's own comment had described and nobody had read; a critical law switchable off
per bot beneath every alarm; a member's name in a warn-level log. Then the ~40 stale surfaces
(063, **D-261**), with the consent copy that told a member their withdrawal was final — while
hide is restorable by design — fixed first at the operator's direction, ahead of everything
cosmetic. Then the two decisions taken and two checks (064, **D-262**): the ladder rungs wear
DERIVED names because the requested fixed names would have lied about what the shipped rungs
do; bridge media got its retention bound after establishing that no bridge file is ever
published (so the briefing's published-file exception is recorded, not built); and
`verify:env-docs` / `verify:doc-links` landed mutation-proven. The 064 build itself went
through an adversarial review that confirmed **14 defects in the first build before push** —
two serious (an orphan sweep that could delete by exclusion, lexical path comparison) — which
is the season's method applied to the season's own work. And this close (065).

## What the season taught

**The application-property lesson — the season's own** (D-252, the operator's line; earned by
D-243/D-256, D-253, D-258, D-183). A request to a model is not a guarantee. Everything the
product promises must be a property of the application: a predicate over the text, a schema
field that cannot hold two laws, a branded type, a measured floor. Both season-long defects
were addressed for weeks with prompt sentences and both survived; what closed them was
deterministic every time. D-183 said it in week one — *a bar that lives only in a prompt is not
a bar* — and the season spent itself proving the general case.

**The deny-list lesson** (D-201, and D-239 after the rule had been broken four more times,
once within eleven days of being written down — "the rule this repository breaks most often").
A deny-list is what you reach for when you are thinking about the cases you have seen; a
closed set is what you reach for when you accept you cannot see them all. The catching
question is not "have I covered the cases" but **"who owns this vocabulary, and can it grow
without me."**

**The surface lesson** (D-205, D-248, D-261 — numerically the season's largest class: four in
one day, roughly forty at season end). A surface is a claim about state, never the state, and
it is only as true as its last refresh. A successful action followed by an accurate refusal is
indistinguishable from a broken control. And a figure typed into prose is a figure already
going stale, so operator copy renders the constant that IS the figure.

**The measurement lesson** (D-242, D-239, D-241; corollary D-245/D-252). A diagnosis that is
available and unproven gets re-derived rather than tested, because an explanation nobody has
tested has no result to contradict it — five floor investigations against zero emission
instruments. Measure the DECISION, not one input to it; survey the population rather than
reason about it. And a measurement whose failure mode produces the same output as success is
not a measurement — read the samples, not only the counts.

**The type-system lesson** (D-258, D-260, D-226, D-207). Two values with the same primitive
type and different meanings stay assignable in both directions forever, so the next caller
re-makes the mistake with a clean compile. Fix the SPACE, not the call site: brand the ids,
discriminate the union, make the vocabulary a Record over the closed set. A mistake the
compiler refuses is one nobody makes twice — the fourth id confusion was the one that finally
bought this.

## The failures, at full weight

Stated as prominently as anything that shipped, because that is what this record is for.

- **The false source line ran for most of the season.** Six numbered sightings, five
  investigations that measured the relevance floor and none that looked at the emission
  (D-242), and when the emission itself was finally measured: **38 lines had reached members**
  (CCB-S5-055 stage 0, measured from her archived replies on his deployment). The mechanism
  was never right; it merely looked right while the traffic was about documents.
- **The repetition defect also ran for most of the season**, through a prompt sentence asked
  five times over, a penalty shipped unmeasured on vendor guidance, and a measurement that
  probed a model the deployment does not run (the eighteen failed probes, D-245/D-252).
- **An unproven capability was pushed to the public repository as delivered** (the channel
  join, D-197–D-200), green on every check, corrected in place two days later. The expiry
  check the day before it was the same shape. D-199 exists because of that week.
- **The archive kept what nobody agreed to** — 64% of it — **and the operator found it, not
  us** (D-240). The first build of the fix then had its own floor corrected in place the same
  day (D-241).
- **Six briefing ids have no register row** (039, 040, 042, 043, 044, 047 — see below), and
  five decision numbers sat cited in shipped code with no entries until a close-out tripped
  over them (D-210–D-214, reconstructed after the fact, "strictly worse than writing them when
  the reasoning was fresh"). The register also went unwritten for 029/030 and 058 until later
  rows said so.
- **`verify:bridge` was red on `main` for a period nobody noticed** because nothing re-runs
  checks automatically (D-189, named-not-solved, still true at close); `verify:lookup-announcement`
  was red with the suite list simply not including it (D-242).
- **The operator's time was spent on our defects**: five music live-test rounds; a week
  chasing groups that were ended memberships; four stale surfaces in one day, one of which
  held him for an hour against a tick that succeeded 1,516 times; a ten-second page (D-236)
  that was measured only after he reported it.

## The register gap, found on filing

The register holds **58 rows** for the 64 pre-close ids. Six ids have **no row and no mention**
in the register: **CCB-S5-039, 040, 042, 043, 044, 047**. Checked against git on filing rather
than guessed at:

- **039** — one commit (`a803874`, "picker redesign, mid-flight", 2026-08-13). Looks like held
  work; whether it was finished under a later briefing is not established here.
- **040** — nine commits on 2026-08-13 (the two-standing-rules day, D-201/D-205).
- **042** — five commits, 2026-08-14/15 (bridge preview and media encoding, the D-210–D-214
  reconstruction).
- **043** — delivered (`be40943`, 2026-08-15, channel publication, **D-215**).
- **044** — delivered (the music library commits, **D-216/D-217**, and six decision entries
  citing the id) — the largest thing the register does not mention at all.
- **047** — zero commits; cited once, in `scripts/measure-stream-latency.ts` (CCB-S5-051's
  subject area).

Reconstructing six rows months after the fact would repeat the D-210–D-214 mistake at register
scale, so this close **records the gap instead of papering over it**; the reconstruction is
queued in the Season 6 handover as its own small task, to be done from the commits above while
they can still be read. Per the standing rule this gap is exactly why "a briefing is not
delivered until it is confirmed delivered" is in `CLAUDE.md` — and Season 5 shows the
confirmation habit failing in the quiet direction six times.

## Measured against the plan

The [Season 5 handover](SEASON-5-HANDOVER.md) planned three pillars and a platform list. What
happened, item by item:

| Planned | What happened |
|---|---|
| She is plural (multi-bot) | **Delivered day one** (CCB-S5-001), console catch-up over the briefings that followed |
| Arm the moderation (pillar 2) | **Not started.** Still `ARMING_UNLOCKED = false`, still waiting on the live-group proofs — see the handover |
| Privileged moderation channel (pillar 2) | **Not started** (the authenticity question is still open) |
| The learning path (pillar 3) | **Not started as scoped.** The RAG third arguably shipped as the knowledge base (CCB-S5-022/023), over operator documents rather than member memory |
| Self-tuning request queue | **Not built**; the honest-feedback half partially arrived as the lookup announcement (CCB-S5-025) |
| The channel bridge | **Shipped** (CCB-S5-032), publishing per channel (043), with retention (064) |
| The gallery | **Not started** |
| Hardware page / model-reachability display | **Not started** — and the Season 4 protocol's line ("all three cost time because the model's reachability is not visible in the console") is therefore still true |
| Smaller carried items (backup page, plugin live-switch, role-mismatch warning, AI Control inventory) | **Not started** |

And the season delivered a body of work the plan never named: the knowledge base, the music
library, the retention floor, the honesty gates, the rooms model, and the site-material review.
The plan was a forecast; production was the brief.

## The state at season end

She is live, plural, on `qwen3:14b` (D-231), on the operator's own hardware. Running: capture
and consent with derived publication, the bridge with per-channel web publication, the music
library, the knowledge base with the evidence-gated source line, web search behind its
measured floor, the Book — **123 laws at close: 74 nameable, 49 withheld, 59 constitutional,
67 critical** (derived on filing by applying the seeded migrations in PGlite through the real
loader, not counted by hand) — the recital, the scene, the whole guard family, and moderation
that **watches and cannot act** (`ARMING_UNLOCKED = false`, its own paragraph in the
[Season 6 handover](SEASON-6-HANDOVER.md)). Switched off by design until the operator reads
the counts: both retention sweeps. Never proven live: enforcement above the warning, the
backup timer's first real run, the welcome plugin's live cases, both sweeps' first production
pass.

The deployment's numbers, measured where they run: 30 pinned prompt configurations
(`scripts/fixtures/prompt-baseline.json`), eleven intents, eight per-bot plugin switches,
relevance floors 0.70 (web) and 0.60 (knowledge), reply floor read from the meter.

## Verified on filing

Every figure above carries its source inline; the ones that could be re-derived were re-derived
on filing rather than copied from earlier prose: the commit count from `git rev-list`, the
migration range from the tree, the verify counts from `package.json`, the law counts from the
seeded registry via PGlite, the register row count and the six-id gap from the register file
itself, the season dates from the register's own rows. The briefing's two quoted figures were
verified against the record before use: "thirty-eight sightings" is CCB-S5-055's stage-0
measurement ("38 source lines, not six"), and "eighteen failed probes" is D-252's own name for
D-245's failed measurement rounds. Nothing in this filing changed code; the offline
verification suite — all 96 harnesses — was run green against the final tree on the close.
