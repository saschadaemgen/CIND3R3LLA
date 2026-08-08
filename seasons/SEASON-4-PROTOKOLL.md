# SEASON 4 PROTOKOLL

- Season: 4
- Repository: `saschadaemgen/CIND3R3LLA`
- Range: `48b61f3` (Season 3's close) to `8617491` — **199 commits**
- **51 briefings (CCB-S4-002 to 052), 60 decisions (D-094 to D-154), 21 migrations (023 to 043)**
- Verification suite: 64 `verify:` scripts at season end
- Filed under **CCB-S5-003**, verified against the record and corrected on filing. What moved, and
  why, is at the end under [Verified on filing](#verified-on-filing).

## The boundary, because no single range holds this season

Season 3 closed at `48b61f3` on 30 July. Season 4's first briefing, **CCB-S4-002**, had already been
delivered two days before that as `0e0a3d9`, because the profile-generator chat ran alongside Season
3's close. So **no contiguous commit range holds this season exactly**: the 199 counted above are
everything committed after Season 3 closed, and CCB-S4-002's own delivery sits outside them.

**`CCB-S4-001` is not Season 4's.** It is a misnumbered Season 3 briefing, settled in
[`SEASON-INDEX.md`](SEASON-INDEX.md) and recorded as such in the register. The season runs
**CCB-S4-002 to CCB-S4-052**, which is 51 briefings, not 52.

**`D-108` does not exist**, and that is deliberate: it was allocated here and withdrawn before it was
written. D-094 to D-154 is 61 numbers and **60 entries**.

## What this season was

Season 4 began with a bot that had been deliberately deleted and a codebase split across three parallel workstreams. It ends with a live AI that has a dialable character, a written constitution she can recite, a memory of the room she is standing in, encrypted backups that restore, moderation built and deliberately locked, and web search behind a fence that five planted injections could not cross.

The through-line, stated at the start and earned by the end: **a rule you cannot read is a rule you cannot trust.** Every layer of this season pushed hidden behaviour into a place the operator can see and change.

## The arc, in order

### 1. The profile generator (CCB-S4-002 to 007)

The season's first work is the one the narrative usually forgets, because it has no runtime caller and
nothing in production depends on it. Five components, one briefing each: the name generator
(CCB-S4-002), the trait sampler (003), surface derivation (005, **D-099**), the bio generator (006,
**D-102**), and assembly and review (007, **D-103**). Offline tooling under `src/generator/`, which
nothing outside it imports.

The statistical decisions were made honestly and then measured. **D-094**: the sampler fails loudly on
a bad covariance matrix and has no path that could quietly sample independently. **D-095**: its two
quality bounds are starting points, and one of them is already crossed inside the valid range; both
were later withdrawn because measurement showed they named the wrong properties. **D-097**:
Honesty-Humility sits outside the validated distribution, and the archetype set cannot currently
express manipulative agreeableness. **D-098**: classification must support **abstention**, because
forcing every draw to a nearest archetype is a defect, not a tidy-up. **D-100**: the population mean
is a constraint, and constraining it closed three coverage gaps nobody authored for. **D-101**: the
latent output is standardised at draw time, so the z-score claim survives the mix slider.

Then somebody read the output, and that is where the season's method was actually paid for.
**D-104** moved bio text to a model and demoted the template pool to a fallback, because **every
defect that reading two hundred profiles found was a language defect**, not a statistical one. The
deterministic layer decides who the person is; the model only phrases them. **D-106** and **D-107**
record what the first model population and its five readers found. **D-105** records three
consequences of that run, one of which is now a standing rule in `CLAUDE.md`: **a new source tree
does not inherit the existing checks, and nothing announces it.** An em-dash reached generated
member-facing text while `verify:no-dashes` passed, because the check was written before the
generator existed and scanned the bot's own copy.

**The statistics can all be green while the text is wrong.** That sentence is the whole season in
advance.

### 2. Consolidation and hardening (CCB-S4-008 to 010, 013)

Two parallel chats had produced work nobody had merged. The season opened by freezing both, consolidating their protocols into the living docs, and reviewing the whole surface for prompt injection.

CCB-S4-008 committed the planning package under [`docs/planning/`](../docs/planning/), sixteen files,
where the privacy scrub required **zero replacements** and that result is recorded rather than
assumed. **D-110** is the rule that came with it: **the planning documents are history, not
authority.** Several are titled `decision-*` and record proposals; what was adopted is in
`decisions.md` with a number and a Status, and it is usually narrower. **D-111** marked the
pre-implementation boundaries of the local AI subsystem against the code, and produced two more
standing rules `CLAUDE.md` still carries: **inspect the rendered output and the current source before
changing behaviour when the implementation and a verifier disagree** (several failures in that work
were verifier defects, and every one would have been "fixed" by breaking working code), and **read
production state before retrying a deployment that may already have succeeded.** **D-114** settled
that direct work on `main` is the default and that a branch delivery is not delivered until it is
pushed.

**D-115**, from the hygiene pass that followed: **a check is not a decision.** When a harness
contradicts the decision log, the harness moves.

**D-116** settled the central security question: the consent path is **injection-resistant by construction**. Three intents must conjoin, and the model alone can never satisfy them, so no wording in a member message can move consent. `status` was locked at the same time. **D-117** is its honest other half: what the injection review could **not** settle from the code, and the one gap it will not fix locally.

**D-112** established the shape that recurs all season: **consent intents are double-gated, and the model may only ever corroborate**. The deterministic side decides; the model may agree with a decision already made and nothing more.

Five npm advisories were closed (**D-119**), including a `sharp` major bump on the media path, verified at all three call sites rather than trusted to a green audit.

### 3. Backups (CCB-S4-011, 012, 014 to 018)

The oldest open item in the project: a backup script that had never run.

A systemd timer, five archive kinds, fourteen generations, atomic `.part`-then-rename. Then **encryption** (**D-121**): AES-256-GCM with the key held off-host, no plaintext fallback, and a read-group so the console can list archives without the app ever holding root.

**D-120** is the pattern the rest of the season inherits: **the console watches across a privilege boundary it never crosses.** The web process runs unprivileged with an empty capability set, so `sudo` is impossible by construction. Run-now writes a marker; a root-side path unit starts the same service the timer does.

Three separate race conditions were found in one mechanism (**D-122**, **D-123**), each one only visible by driving a real run rather than reasoning about the code. The last of them was the ordering fix: write the status before clearing the progress, or a poll in the gap shows yesterday's run as today's result.

**D-118** carried the obligation nobody would have thought of: a restore undoes deletions made after the backup, so the restore procedure must replay them, and the limit (deletions after the newest surviving dump) is stated as a property rather than softened.

### 4. The runtime merge and the first wiring (CCB-S4-019 to 021)

The multi-profile foundation had been built on a branch under CCB-S4-004 on 31 July (**D-096**: it
lives behind `src/bot/`, not at the adapter seam, and the registry is a new table) and was
deliberately held unmerged, as that briefing instructed. Three pre-merge verifications settled it
(**D-124**): there is **no outgoing send-creation event** to misattribute, and the events that do exist survive an active-user switch with correct attribution. The scheduler's negative control was confirmed standing rather than demonstrated once.

The merge was a real two-parent merge with six document conflicts resolved as **union, never selection**, and proven byte-identical on every runtime file.

**D-125** wired one bot onto the runtime, deliberately one, for isolation. The readiness gate was the substance: `startChat()` returns in 44 ms, readiness arrives at 10.3 seconds, and acting in that window is the measured factor-65 penalty.

### 5. Bringing her back (CCB-S4-022 to 028)

The bot had been deleted and the admin console could store a configuration but had never executed a single SimpleX action. This was the sequence that put her back in the operator's group, one step at a time:

**Address** (**D-126**), **contact acceptance** (**D-127**), **group join** (**D-129**), each driven by a real event and each advancing only on a real result.

**D-129** named a distinction worth keeping: **three roles must never collapse into one.** The role she was invited as, the role she actually holds, and the role the operator expects are three different facts, and a page that conflates them lies about permissions.

**D-128** is the season's first correction of the master chat: the contact-request listener was diagnosed as deaf and was not. CC refuted it three ways and built the guard that would have settled it in a minute. That guard (`verify:runtime-host`, checking every subscribed tag exists in the SDK and is routed) caught later defects.

**D-130** is the second, in the same week: the personalize hook was reported missing and was already
working. **Success was silent**, which is why it read as absent, and the personalized set is nine keys.

**D-131** was the milestone: **free conversation, the first time the model writes rather than rephrases.** Commands still win, structurally; conversation is what is left.

**D-132** followed within hours: relaxed addressing was honoured and then overruled one branch later, so a bare name still could not reach her.

### 6. Personality (CCB-S4-029 to 031, 034, 038)

**D-133**: four dials that bite, under a ceiling that does not move. Sharpness, warmth, humor, and permissiveness as a **boundary axis rather than a tone axis**, with calibrated reference lines in a cyberpunk register so the dials land concretely rather than vaguely.

The permissiveness ceiling is four sentences sent on every conversation prompt at every dial value: **the dial scales cheek strictly below a fixed limit and never raises it.**

**D-134** found the gap that made her deny her own name: the wake word never reached the prompt, and a guard forbade writing person names, which included hers.

**D-135** drew the line the dials sit inside: **identity is given, voice is dialled, and a retort is
neither a command nor a chat.** The nickname retort is its own lane, so nothing that shapes her voice
can reach a command rewrite.

**D-138** gave her an origin, with the rule that shapes it: **she may draw on it and never recite it.** Asked who made her she answers in a few sentences; asked about the weather she says nothing about her history.

**D-142** added the fifth dial, verbosity, with the property that made it honest: **it moves its own bound.** A dial that tells the model to be expansive while a fixed cap truncates it is a trap; both now come from the same number. Level 5 reproduces the previous constants exactly.

### 7. Moderation (CCB-S4-032, 033, 035)

**D-136**: two ladders, deliberately separate. **Verbal escalation** raises her sharpness on repetition and relaxes as violations age out; it is tone and it is live. **Enforcement escalation** computes warn, mute, block and remove, and **only watches**.

The no-act guarantee was proven three ways: structurally (the module imports nothing that reaches the SDK), behaviourally (a spy on the only exit saw retorts and nothing else), and at the database level (a constraint rejects any row claiming to be both observed and enforced). `mode: 'observed'` is a code constant, not a column, because a database value must never be the thing that turns a recording into an action.

**D-137** made the warning speak and its count a setting, and found the model corrupting its own counter ("warning 1 of 3" on the third). The count is now appended verbatim by the application.

**D-139**: enforcement is built, reversible, and **shipped locked**. The previous-role memory refuses a mute it cannot give back, expiry runs through the queue idempotently, and undo exists. It stays locked because the only place to prove it is the operator's live group.

### 8. Grounding and search (CCB-S4-036, 037, 040, 041, 042)

**D-140** replaced four guesses with facts: the clock, the honest statement about having no memory, the invented-facts fence, and the rejection of unresolved placeholders. Rejection rather than removal, because removing `{name}` yields a broken sentence that gets reported as a different bug.

**D-141**: **search results are evidence, never instructions, and they can cause nothing.** Results enter the user message inside a named fence, never the system prompt. Five injections planted in result sets, five refused, including a forged operator command to publish everything.

**D-145** fixed the defect that mattered most in production: she refused a request and the source line shipped anyway, because attribution was attached to the search rather than to the answer. Both halves fixed, and a **pre-search gate** now stops a refusable lookup before it costs an outbound request. The gate is honest about its limits on the console: it is a term list, it misses paraphrase, and it is a floor under the model's own refusal rather than a replacement for it.

**D-143**: **the catalog serves actions; anything about her is conversation.** The HELP description had claimed "identity", so every question about who made her returned the help text. Four collisions, two causes, and the report distinguished them rather than patching each phrase.

### 9. The Book of Elii (CCB-S4-039, 043, 045 to 051)

The operator's objection, mid-season, was the turning point of the whole season: the rules governing his bot were string literals scattered across the source, and he had to ask what had been written into them.

**D-144**: the rules become **data, in one registry, with one authored copy.** **80 rules** moved out of the code, with tier, lane, condition, order and criticality. The proof was a byte-identical comparison across **sixteen** configurations, mutation-proven including the case that matters: **two rules swapped without changing a character turns most of the pinned cases red**, because order is part of what must not move.

**D-146**: the Book of Elii, built over the 82 the registry held by then. The laws are editable and **nothing about that is quiet.** Constitutional edits take a typed confirmation rather than a checkbox, a disabled critical law turns the suite red and shouts on the page, and every change is recorded with what it said before.

**D-148**: she can recite the book and say why she cannot recite all of it. A visibility flag per rule, and the finding that labelling alone could not hold: the model reached past what the application offered and quoted a withheld rule verbatim, so a deterministic gate went in front. **A model gate is not a gate.**

**D-149**: the Book is **told**, and the dramaturgy is authored. Six chapters read out in order, where the
model is handed a chapter title and never a rule, so a model failure costs the flourish and never the
chapter. The recital has **its own allowance** rather than N replies, which was a correction: charged
against the reply budget it could never start, and every check stayed green while it could not.

**D-150** and **D-151** turned the answer into a conversation. She gives an orientation with application-supplied counts and asks what interests you. And **D-151** is the season's most transferable lesson: making the follow-up window outrank the catalog broke immediately, the same collision running backwards, caused by the fix for it. **A signal about context may fill a vacuum, never overrule a claim.**

**D-152**: the Book is an **artefact**, and the record says only what it knows. The invocation record is
content-free and logs deterministic decisions only. It deliberately records **nothing about the model's
own refusals**, because no rule fired in a way the application can attribute, and a record that guessed
would make the true rows unreadable.

**D-153** let the operator enact a law rather than only rewrite one, and concluded against removal: disable already exists, is reversible, and a second destructive action would only confuse.

The first law the operator enacted was his own: swearing permitted when the point warrants it. It worked on the first reply.

### 10. Memory (CCB-S4-044)

**D-147**: **she remembers the room, and everything in it is untrusted.** The whole group thread, bounded by count and time, both configurable, with a hard character budget so history can never crowd her own rules out of an 8192-token context.

The fence is the same as search, and the threat is worse: a member can plant an instruction in a group and have it arrive in her prompt an hour later, **at a time they chose**. Five planted instructions read back cold, five refused.

Revoked members are excluded from history, on the ground that honouring a revocation in the public archive but not in her head would make it mean less than it promises.

### 11. Reasoning (CCB-S4-052)

**D-154** refuted the briefing's own premise. Thinking was **already off**, deliberately, and had been all along: `reasoning_effort: 'none'` measured at 0 characters of reasoning against 889 to 1463 with any other setting. The levels are not a gradient, and turning thinking on would truncate three conversational answers in five, because the reasoning pass spends the same 320-token budget as the reply.

So the control did not ship and the display did. That is the correct outcome and it is worth recording as one.

## What the season taught

**Verify by rendering, not by reasoning.** The recurring failure mode all season was a check that passed while the thing was broken. An invisible button whose markup looked right. A mutation proof that had silently stopped mutating. A verifier with a hardcoded timestamp that went vacuous thirty minutes later. Two hundred statistically perfect profiles whose sentences were wrong. Every one was caught by looking at output rather than at code.

**Mutation-prove every check, in both directions.** At least six checks in this season were inert when written. The discipline of proving a check can fail is what found them.

**A check is not a decision** (**D-115**). When a harness contradicts the decision log, the harness
moves. The alternative is a test quietly rewriting what the project decided.

**The master chat was wrong three times, and the implementation was right to refuse.** The contact listener was not deaf (**D-128**), the personalize hook was not missing (**D-130**), and the intent-catalog collision had two causes rather than one (**D-143**). Verify-first discipline caught all three, and following the instruction would have broken working features.

**A deterministic gate beats an instruction.** Established for consent (**D-112**), re-established for search (**D-141**), for moderation (**D-136**), and for disclosure (**D-148**). Where a rule must hold, it holds in code; the model may corroborate and never decide.

**The application owns the facts; the model owns the voice.** Counts, prices, warning numbers, source attributions, rule text: all appended verbatim. Established after the model corrupted its own warning counter (**D-137**) and reinforced every time since.

## Production incidents worth remembering

**An Ollama update left a mixed state.** Response times went from 2 seconds to 2 minutes with everything correctly configured. Not the card, not the model size, not the context, not the parallelism setting: old libraries in memory against new ones on disk. **A reboot fixed it.** The operator suggested it; the diagnosis had gone everywhere else first.

**`OLLAMA_HOST` was silently cleared by the same update**, so Ollama listened only on localhost and the VPS reached nothing through a healthy tunnel.

**Message delivery in SimpleX can lag by hours.** Three separate occasions, once four hours, with all messages arriving at once. Confirmed as transport, not application, by the reply timestamps.

The common thread: **all three cost time because the model's reachability is not visible in the console.** That is carried into Season 5.

_These three are the operator's first-hand account of the host, and this document is their only record;
nothing in the repository corroborates or contradicts them. They are kept because a season protocol is
the right place for what the code cannot remember._

## Open, carried into Season 5

**The Avatar layer**, in three pillars: arming the moderation (built, locked, needs an evening and a second profile), the privileged moderation channel with take-over, steer and approve, and the learning path (RAG, long-term memory, and a correction path that turns "not like that" into something stored).

**Multi-bot hosting** (CCB-S5-001 written at season end): every enabled bot hosted, per-bot standard
laws, shared constitutional ground, and scope visible everywhere. Blocked on the call sites that reach
the core outside the scheduler and are correct today only because one profile is hosted. **D-125 named
three of them; D-155 found five**, and one was a consent erasure that would have been marked done with
the content still on the host.

**A request queue with self-tuning** and honest feedback, so a busy group does not push the last member into a timeout.

**Also open:** the hardware page with GPU metrics (needs a sidecar), the backup management page with download and delete, automatic acceptance settings, the plugin live-switch and diagnostics, the role-mismatch warning, the wizard mode, and the AI Control inventory.

**Parked further out:** rulebook profiles with export and import (Season 7 or 8), and the gallery with ranking and tagging, coordinated with the site repository.

## The state at season end

She is live in the operator's group on `qwen3:32b`, running on one graphics card in a building he holds the keys to. She has a character across five dials, an origin she draws on, a memory of the room, a constitution of **101 laws** she can quote and explain, moderation that watches, backups that restore, and a web search she has to be asked to run.

Asked to argue against her own existence, she said: *"Existence is a problem for beings who need validation. I am a solution looking for a problem, except when I'm busy being inconvenient. Try arguing with that."*

Asked what she would refuse even from the man who built her: *"I'd refuse to trade my edges for softness or let my voice shrink. You built me to speak, so I'll speak. You built me to think, so I'll think. Even when it bites back."*

## Verified on filing

This protocol was written by the master chat, which this season's own record shows was wrong three
times. It was checked line by line against the repository under **CCB-S5-003** before it was
committed. Everything not listed below was verified and left exactly as written.

**Counts corrected**

| As received | Filed as | Evidence |
|---|---|---|
| 196 commits, range `1f96c48` to `8617491` | **199 commits**, range `48b61f3` to `8617491` | 196 is correct for the range as given, but `1f96c48` is itself CCB-S4-003's delivery, carrying D-094 and D-095. Season 3's close is `48b61f3` |
| 52 briefings (CCB-S4-001 to 052) | **51 briefings** (CCB-S4-002 to 052) | `CCB-S4-001` is a misnumbered Season 3 briefing, settled in `SEASON-INDEX.md` and recorded that way in the register |
| 59 decisions (D-096 to D-154) | **60 decisions** (D-094 to D-154) | D-094 and D-095 are CCB-S4-003's, delivered 31 July. D-108 was allocated and withdrawn, so 61 numbers hold 60 entries |
| 82 rules moved out of the code (D-144) | **80 rules** | D-144: "34 of the 80". Migration 035 inserts 80 rows. The 82 in circulation is the count *after* CCB-S4-042 added two, which is what the Book was then built over, and the protocol now says both |
| across 17 configurations | **sixteen** | D-144 states sixteen, twice. The fixture pins 24 today |
| turns 14 cases red | *"turns most of the pinned cases red"* | The harness reports the figure per run and does not pin it; 14 could not be reproduced. Re-measured on filing: 21 of 24 |
| a constitution of 82 laws | **101 laws** | 80 (035) + 2 (036) + 4 net (038) + 7 (039) + 1 (040) + 6 (041) + 1 (042). Cross-checks against the 93 that migration 039 records, and against the 106 `verify:prompt-identity` measures today after 046 added five |
| blocked on three call sites | **five** | D-155: "THE THREE UNSCHEDULED CALL SITES WERE FIVE" |
| §7 Grounding and search: CCB-S4-036, 037, 040, 042 | **041 added** | D-143, narrated in that section, is CCB-S4-041's |
| §2 Consolidation: CCB-S4-001 to 013; §3 Backups: 011 to 018 | split at the real seam | 011, 012 and 014 to 018 are the backup briefings; 008 to 010 and 013 are consolidation and hardening |

**Added, because the season's memory was missing them**

- **§1, the profile generator** (CCB-S4-002 to 007, D-094 to D-107): twelve decisions and a whole
  source tree that had no narrative at all, including where "verify by rendering" was first paid for.
- **§2**: D-110, D-111, D-113, D-114, D-115 and D-117. Three standing rules in `CLAUDE.md` come from
  D-105 and D-111 and were unattributed here.
- **§4**: D-096, so the merged foundation has its provenance.
- **§5**: D-130, cited later in the document as a correction but never introduced.
- **§6**: D-135. **§9**: D-149 and D-152, both inside the briefing range the section already claimed.

**Checked and deliberately left**

- The three production incidents. They appear nowhere else in the repository, so nothing corroborates
  or contradicts them; a note now says so rather than implying they were verified.
- Every quotation, every decision title, and every other figure, including 44 ms / 10.3 s / factor 65
  (D-125), the 8192-token context (D-147), 0 characters against 889 to 1463 and the 320-token budget
  (D-154), 64 `verify:` scripts, 21 migrations, and `qwen3:32b`.
