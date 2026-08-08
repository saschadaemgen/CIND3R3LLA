# Concept: the Avatar layer

> **Proposal, not decision.** See [`README.md`](README.md).

Season 4 built a bot that speaks well and watches carefully. The Avatar layer is what turns her from
something that watches into something that acts, and from something that repeats into something that
improves. Three pillars, in the order their risk allows.

---

## 1. Arm the moderation

**Everything except the switch already exists** (CCB-S4-032/033/035, D-136 / D-137 / D-139).

- **Two ladders, deliberately separate.** Verbal escalation raises her sharpness on repetition and
  relaxes as violations age out; it is tone, and it is live today. Enforcement escalation computes
  warn, mute, block and remove, and today it **only watches**.
- **The no-act guarantee is proven three ways**: structurally (the module imports nothing that reaches
  the SDK), behaviourally (a spy on the only outbound saw retorts and nothing else), and at the
  database level (a CHECK rejects any row claiming to be both observed and enforced).
  `mode: 'observed'` is a **code constant, not a column**, because a database value must never be the
  thing that turns a recording into an action.
- **The reversal machinery is built.** Migration 032 stores the numeric `group_member_id` a restore
  acts through, and keeps `expired_at` distinct from `expires_at` so a lost expiry job reads as
  **overdue** rather than as permanent. The previous-role memory refuses a mute it cannot give back.
  Expiry runs through the durable queue, idempotently. Undo exists.
- **The SDK calls are wrapped and late-bound.** `src/bot/enforcement.ts` holds `setMemberRole`,
  `blockMemberForAll` and `removeMember` behind an `EnforcementPort` that can simply be left unset, so
  the capability is *absent* rather than *broken*. `NEVER_ENFORCE_AGAINST` starts at `['owner']`.

**What arming actually is:** setting that port, and turning `mode` from `observed`. Not a build.

**Why it did not happen in Season 4.** The only place to prove an enforcement ladder is a live group
with a real member, and there was one bot and one group, which is the operator's own. Acting there is
irreversible in a way a harness is not: a wrongly removed member is a person, not a row.
**CCB-S5-001 removed that blocker** by making a second hosted profile ordinary.

**What to prove, in a second profile's own group, before it is armed anywhere real:**

1. Every rung fires at the rung it should, against a real member, with the count the application
   appends verbatim (D-137).
2. Every rung is **reversible in the same session**: mute then unmute, block then unblock, remove then
   re-invite, with the previous role restored from memory rather than guessed.
3. An expiry that is missed reads as **overdue**, not as permanent, and the queue's retry closes it.
4. The owner exemption holds, and a role that cannot be expressed does not silently become a
   neighbouring one (see `adapter-contract.md` §1).
5. Undo, from the console, after a restart.

**The open question this pillar has to answer:** an enforcement action is the first thing she does
that a member cannot ignore. Whether the operator is asked first, always, is the substance of pillar 2
and the two should probably arrive together.

---

## 2. The privileged moderation channel

Take over, steer, approve. A channel members cannot see, in which the operator can replace what she
was about to say, redirect it, or let it through.

**The authenticity problem, stated before anything is built.** A member reading a reply cannot tell
whether they are talking to her or to the operator wearing her voice, and **the archive would record
it as hers either way**. That is not a UI question. It touches the same nerve as the consent rule:
the archive's value is that it says what actually happened.

Positions worth having an argument about, rather than defaulting into one:

- **Mark it.** Operator-authored replies carry a visible marker in the chat and a column in the
  archive. Honest, and it costs the illusion the Avatar layer exists to create.
- **Don't mark it, but record it.** Members see her; the archive and the console know. Keeps the
  voice, and means the public archive can state something the member could not have known.
- **Steer only, never speak.** The operator can redirect and reject, but every character a member
  reads was generated under her rules. The narrowest option and the only one with no authenticity
  question at all.

**Recommendation to argue against:** *steer only* for the first delivery, with take-over deferred
until the marking question is settled. It is the only variant that needs no new honesty rule, and
"approve before send" is already most of the operational value.

**What it needs regardless of which way that goes:** a per-bot privileged channel that is not a group
message (§8f of `wire-format.md` on the direct contact link), a hold-before-send state in the reply
path, and a timeout policy for when the operator is asleep - because a reply that waits forever for
approval is a bot that has stopped answering.

---

## 3. The learning path

RAG, long-term memory beyond the group thread, and a correction path that turns "not like that" into
something stored.

**The two Season 4 rules that govern all of it:**

- **Anything stored from a conversation is untrusted text** (D-147). Conversation memory already
  proved the threat model: a member can plant an instruction and choose when she reads it. Retrieval
  makes the window unbounded rather than bounded, so the fence has to be at least as strong, and the
  exclusions (destroyed, deleted, rejected, revoked) have to survive into whatever is indexed.
- **Anything that shapes what she says next is a rule, and rules are readable** (D-144, D-146). A
  correction stored as an opaque embedding is a rule the operator cannot read, which is the exact
  thing the Book of Elii was built to end. A stored correction should be **inspectable, attributable
  and revocable** in the same sense a law is.

**Therefore the correction path is the first piece, not the last.** It is the smallest of the three,
it is the one whose output has to be human-readable anyway, and it forces the storage question
(where does a correction live, who can see it, what removes it) to be answered while the answer is
still cheap.

**Sequence to propose:** correction path → long-term memory of corrections and facts → retrieval over
the archive. Retrieval last, because it is the only one that reintroduces arbitrary member text at a
time nobody chose.

**Consent, which will come up immediately:** an unpublish and a revocation must reach whatever is
indexed, not only the archive. Season 4 already decided the principle for conversation memory -
honouring a revocation in the public archive but not in her head would make it mean less than it
promises - and an index is a head.
