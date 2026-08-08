# Concept: platform and reach

> **Proposal, not decision.** See [`README.md`](README.md).

The Avatar layer is what she becomes. This is what she stands on, and where she is seen.

---

## 1. A self-tuning request queue with honest feedback

**The problem, measured rather than assumed.** A reply takes about **7 seconds**. Each addressed
message costs **two model calls**, the resolver and the reply. `LOCAL_AI_TIMEOUT_MS` accepts a maximum
of **60000** and **defaults to 15000** (`src/config.ts:348`).

So roughly **eight** concurrent requests reach the 60-second ceiling, and roughly **two** reach the
default. The last member in a busy group does not get a slow answer; they get an abort, and today they
are told nothing useful about why.

**Two halves, and the second one is the point.**

- **Self-tuning.** Admission and ordering that adapt to what the host is actually doing, rather than
  a fixed concurrency number that is wrong on both sides of a GPU upgrade. The signal already exists
  per request: the measured latency of the last N calls.
- **Honest feedback.** A member who will not be answered within the budget should be told so, in her
  voice, before the budget runs out - not silently dropped and not left watching nothing. This is the
  CCB-S3-023 standing rule applied to load: a degraded function must not run silently, and "busy" is a
  legitimate state to report rather than a fault to hide.

**Design notes worth arguing about before building:**

- The **durable queue already exists** (CCB-S3-022, architecture §21) with claim, backoff, dead-letter
  and idempotency. The question is whether model requests belong on it or beside it: a queue job that
  a member is *waiting on* has different latency requirements from an expiry sweep.
- **The resolver call is the cheaper one to shed.** If load has to be reduced, dropping to the
  deterministic intent path costs less than dropping the reply, and the deterministic path is already
  the fallback everywhere else.
- **Per-bot fairness becomes real the moment two bots are busy** (CCB-S5-001). One bot's group must
  not be able to starve another's, and the active-user scheduler serializes commands, not model calls.

---

## 2. The channel bridge plugin

Map a SimpleX **channel** to one or more **groups**, mirror its posts into them, and optionally onward
to the activity stream and the website blog.

**The one hard rule:** a mirrored post carries **its origin, attributed**, and is never passed off as
hers. She is a courier here, not an author, and every fence in this project depends on a member being
able to tell whose words they are reading.

**Open questions to answer before building:**

- **One-way or reply-back?** Mirroring down is a publishing feature. Carrying replies back up makes
  the bridge a two-way transport, which raises consent (whose message is being republished where?) and
  makes the bridge itself a message source that can be injected through.
- **Edits and deletions.** An edit upstream must reach every mirror, and a deletion upstream must
  reach every mirror *faster*. The adapter contract already requires an edit to arrive as an edit of
  the original item (§3), which is what makes this tractable at all.
- **Media.** Mirrored media means a second copy under `MEDIA_ROOT`, with the encryption-at-rest and
  stripping rules applying to it exactly as they do to captured media.
- **How attribution renders**, differently, in three surfaces: the group message, the activity stream,
  and the blog. The blog is the one where getting it wrong looks most like plagiarism.

---

## 3. The gallery

Coordinated with the site repository. **Ordered by what it costs, cheapest first**, so that each stage
ships something usable before the next one is needed.

1. **Ranking, with no model at all.** Counting and sorting on the stable `senderMemberId`. No
   inference, no queue pressure, no new consent surface. This alone is most of a gallery.
2. **Linked video, sorted from its own metadata.** The cheapest enriched case, because title,
   description and category **arrive with the link** (see `wire-format.md` §3g: SimpleX supplies the
   preview title and thumbnail).
3. **Images, through a vision model.** The first stage that costs inference per item, and therefore
   the first that needs the queue.
4. **Uploaded video, last.** Most expensive per item and least common.

**The consent question, which has to be settled at stage 1 and not at stage 3:** **do tags follow an
unpublish?** A tag derived from a member's image is derived from member content. If the member
unpublishes, the tag is either removed with it or it is a residue of content they withdrew. The
project's own rule points one way (publication is *derived*, never a stale flag), and the gallery
should derive its tags through the same views rather than caching them beside the archive.

**Queue requirement:** stages 3 and 4 are exactly the workload §1 above exists to schedule. They must
not compete with a member waiting for a reply.

---

## 4. The hardware page, and the reachability display

**GPU metrics need a sidecar** on the operator's own machine, because the model host is not the
application host and the console must not reach into it directly.

**The reachability display is the smaller half and the more valuable one.** Three Season 4 incidents
cost hours for one shared reason: *whether the model was reachable was not visible in the console.*
An Ollama update left old libraries in memory against new ones on disk and turned 2-second replies
into 2-minute ones with everything correctly configured. The same update silently cleared
`OLLAMA_HOST`, so it listened only on localhost and the VPS reached nothing through a healthy tunnel.

What the display has to distinguish, in the CCB-S3-023 vocabulary this project already uses:

- **Not configured** (a choice) from **configured but unreachable** (a fault) from **reachable but
  slow** (the incident that actually happened).
- Last successful call, its latency, and the model that answered - because "reachable" was true in
  every one of those incidents.

---

## 5. Smaller carried items

- **Backup management** with download and delete, on top of the visibility built in CCB-S4-014 to 018.
  Delete crosses the privilege boundary D-120 established, so it needs the same marker-and-path-unit
  shape rather than a new escalation path.
- **Automatic acceptance settings** for incoming contact requests (CCB-S4-023 built the manual step).
- **The plugin live-switch and diagnostics.**
- **The role-mismatch warning** - the page that must not collapse the three roles D-129 separated.
- **Wizard mode** for onboarding.
- **The AI Control inventory.**

---

## 6. Parked further out: rulebook profiles, and the import problem

Export and import of a whole rulebook, so a character can be moved between deployments or shared.
Season 7 or 8.

**The import is a security problem and it is worth naming now, while nothing depends on it.** Every
fence built in Season 4 rests on one property: **untrusted text can cause nothing.** Search results
are evidence (D-141), remembered conversation is evidence (D-147), a member instruction is content
(CCB-S3-009). An imported rulebook is the exact inversion - foreign text whose *entire purpose* is to
become her laws, read by the model as instruction, in the system prompt, above the fence rather than
inside it.

Consequences to design for rather than discover:

- **The constitution must not be importable.** D-155 already refuses per-bot constitutional
  deviations in three places; an import is a fourth way in and must be refused in the same terms.
- **An import is an edit, and edits are recorded** (D-146). Every imported law needs the same history
  row, the same before-and-after, and the same attribution as a hand edit, or the Book stops being
  the record of what she was told.
- **`verify:prompt-identity` pins what SHIPS, not what a deployment holds.** An import moves a
  deployment away from the shipped set without moving the fixture, which is correct but means the
  Book's drift count is the only thing that would show it.
- **A human reads it before it applies.** A diff, a count, and a typed confirmation for anything
  constitutional - the same shape the Book already uses, because the whole point of that shape is that
  a change to her laws is never quiet.
