# SEASON 5 HANDOVER

- Season: 5
- Repository: `saschadaemgen/CIND3R3LLA`
- Opened: 2026-08-08 by CCB-S5-001
- Status: **in progress**. This is a forward-looking document and it will be superseded by
  `SEASON-5-PROTOKOLL.md` at close.
- Written under **CCB-S5-003**. The concept work it summarises is under
  [`concepts/`](concepts/), which is **proposal, not decision** - read
  [`concepts/README.md`](concepts/README.md) before citing anything there.

## What this season is for

Season 4 gave her a character, a constitution she can read out, a memory of the room, and the
verification discipline to trust any of it. She is one bot, answering one group, with everything she
says shaped by rules an operator can now edit.

**Season 5 is about her being more than one, and about her getting better at it.** Three things
follow from that, and they are the season's spine:

1. **She is plural.** More than one profile on one core, each with its own character and its own
   deviations from a shared constitution. Delivered on day one by CCB-S5-001; what is left is the
   console catching up with it.
2. **She is supervised.** The moderation built in Season 4 is armed, and the operator gets a
   privileged channel to take over, steer or approve rather than only to watch.
3. **She learns.** A correction path that turns "not like that" into something stored, and a memory
   longer than the room she is standing in.

Everything else in this document is either what makes those safe (a queue that does not drop the last
member) or what makes them worth having (the bridge, the gallery, the pages that show what is
actually happening on the host).

## Delivered so far

- **CCB-S5-001** (D-155) - **more than one of her.** `startRuntimeHost` hosts every enabled bot, each
  with its own event source, file receiver, engine, consent handler and capture registration.
  `cinderella_prompt_rule_overrides` makes on, off and reworded one mechanism, and a database trigger
  refuses any per-bot override of a constitutional law. `runtime.runForGroup` **throws on an unknown
  owner** rather than acting as whichever profile is active. `BOT_RUNTIME_HOSTING` and the pre-runtime
  `bot.run` boot path are gone, because a lever that silently reduces the deployment to one bot is
  worse than no lever.
- **CCB-S5-002** (D-156) - **she claims powers she does not have.** The invented-facts fence now
  covers her own capabilities, autonomy and agency, in both directions, and both halves are
  constitutional.
- **CCB-S5-003** - this record. The Season 4 protocol filed and corrected, the index brought current,
  the adapter contract audited, the other living documents checked, and this handover.

## The three pillars: the Avatar layer

Full note: [`concepts/avatar-layer.md`](concepts/avatar-layer.md).

**1. Arm the moderation.** Enforcement is built, reversible and shipped locked (D-139). Everything
except the switch exists: the ladders, the previous-role memory that refuses a mute it cannot give
back, idempotent expiry through the queue, and undo. It stays locked because **the only place to prove
it is a live group**, and until CCB-S5-001 there was only one bot to prove it in. That blocker is now
gone. This needs an evening, a second profile and a real group, not a briefing's worth of building.

**2. The privileged moderation channel.** Take over, steer, approve. The operator speaks to her in a
channel members cannot see and either replaces what she was going to say, redirects it, or lets it
through. **The authenticity problem must be settled before this is built, not after:** a member
reading her reply cannot tell whether they are talking to her or to the operator wearing her voice,
and the archive would record it as hers either way. That is a consent-adjacent honesty question, not a
UI question.

**3. The learning path.** RAG, long-term memory beyond the group thread, and a correction path that
turns "not like that" into something stored. The hardest of the three, and the one where Season 4's
rules apply most directly: **anything stored from a conversation is untrusted text** (D-147), and
anything that shapes what she says next is a rule, which means it belongs where rules live and are
readable (D-144).

## The rest of the season

Full note: [`concepts/platform-and-reach.md`](concepts/platform-and-reach.md).

**A self-tuning request queue with honest feedback**, so a busy group does not push the last member
into a timeout. **Measured:** a reply takes about 7 seconds and each addressed message costs **two**
model calls, the resolver and the reply. `LOCAL_AI_TIMEOUT_MS` is capped at 60000 and **defaults to
15000** (`src/config.ts:348`), so roughly **eight** concurrent requests reach the 60-second ceiling and
roughly **two** reach the default. The last member in a busy group already loses today.

**The channel bridge plugin.** Map a SimpleX channel to one or more groups and mirror posts with their
origin attributed rather than passed off as her own, optionally onward to the activity stream and the
website blog. Open questions to answer before building: one-way or reply-back; what happens to edits,
deletions and media; and how attribution renders in each surface.

**The gallery**, coordinated with the site repository, in the order that spends least for most:
ranking with **no model at all** (counting and sorting on the stable `senderMemberId`), then linked
video sorted from metadata that arrives with the link, then images through a vision model, then
uploaded video last. Its consent question is the one to settle first: **do tags follow an unpublish?**

**The hardware page** with GPU metrics, which needs a sidecar on the operator's own machine, and the
**model reachability display**. Three Season 4 incidents cost time for the same reason: whether the
model was reachable was not visible in the console.

**Smaller carried items:** backup management with download and delete, automatic acceptance settings,
the plugin live-switch and diagnostics, the role-mismatch warning, the wizard mode, and the AI Control
inventory.

**Parked further out:** rulebook profiles with export and import. The **import is a security problem
worth naming now**: an imported rulebook is foreign text that becomes her laws, which is the one
input in the whole system that is *supposed* to change her behaviour. Every fence built in Season 4
assumes untrusted text can cause nothing; this deliberately inverts that.

## What CCB-S5-001 deliberately left

Recorded here rather than in the backlog's general list, because these are the specific edges of a
delivered briefing:

- **The onboarding console pages still act on the primary bot.** `selectedForRuntime` is now the
  *primary* selection and nothing more, but `src/web/views/ai-onboarding.ts` still tells an operator
  that a bot not marked primary "is not marked as the primary runtime bot, so the runtime is not
  hosting" it. That sentence was true until CCB-S5-001 and is not true now. The pages need to act per
  bot, and that line needs correcting either way.
- **`AVATAR_PATH` is primary-only.** One image in the environment cannot dress several bots
  (`src/bot/runtime/host.ts:291`). A per-bot avatar layer is a later briefing, and the host says so in
  a status note rather than silently giving every bot the same face.

## Still carried from earlier seasons

Not new, not forgotten, and none of it was Season 4's fault: the legal texts under counsel review, the
categorization engine, retention auto-delete (D-027), the child-safety **detection provider** (storage
and custody are built; no provider is configured), multi-tenancy and Pro (D-026), and the adapter
seam's Phases B and C. See [`../docs/feature-backlog.md`](../docs/feature-backlog.md), which is the
authoritative list; this document is the narrative.
