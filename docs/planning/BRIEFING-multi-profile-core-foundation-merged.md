# Briefing: Multi-profile core foundation

Supersedes the original "CIND3R3LLA Multi Profile Runtime Brief" and its three
corrections. Those documents contain contradictions; this one does not. Where they
disagree with this briefing, this briefing wins.

**No CCB id assigned.** Needs one before it can be recorded against the register.

---

## 1. Base and branch

```
base commit   1f96c48
branch        feature/multi-profile-core-foundation   (does not exist yet, create it)
next free migration   023
next free decision    D-096
```

Do not merge to main.

The original brief named base `e236ccf` and migration 020. Both are stale: main has moved
seven-plus commits, migrations 020, 021 and 022 are taken, and the adapter seam has since
moved the boundary this runtime must sit behind.

---

## 2. Why this exists in this form

The original brief was correct in intent and wrong in one load-bearing detail: it stated
that a SimpleX `groupId` must never be treated as globally unique. The opposite is true,
and building to the original rule would have put an inverted assumption in the foundation.

The correction was verified against the schema and against a 27-profile measurement
database. Section 5 states the corrected rule.

Three design decisions were already recorded from the original brief and are **not to be
re-decided**: **D-083** (group id semantics), **D-084** (actor types and automation modes),
**D-085** (runtime model and state machine). Reference them; extend them if implementation
reveals something new.

---

## 3. Product model: four actor types

The system must distinguish these from the beginning.

**`human_user`**, a real human-controlled account. May use an uploaded avatar, a
generated avatar, or none. No automated behaviour is implied by the avatar.

**`human_operated_agent`**, a moderator, administrator, support or character account
operated by a responsible human. AI acts as assistant or autopilot; a human remains
accountable and can observe, interrupt, edit, approve or take over. These are not NPCs.

**`npc`**, an automated entertainment, game, tutorial, demonstration, onboarding or
population actor. Must support a disclosure label.

**`system_automation`**, a technical service identity for notifications or system
operations. Requires no simulated human personality.

### 3.1 Independence of concepts

Actor type, avatar source, personality source and automation mode are **independent**.
A generated avatar may belong to any of the four actor types. **Do not infer actor type
from avatar style.**

### 3.2 Avatar sources

Prepare the data model for: `none`, `uploaded`, `generated_template`,
`generated_local_ai`.

Do not implement the image generator in this phase. Uploaded avatars must remain
supported for every profile, so an operator can replace an unsuitable generated one.

### 3.3 Automation modes

Prepare: `manual`, `assisted`, `autopilot`, `fully_automated`.

Defaults: `human_user` manual; `human_operated_agent` assisted or autopilot; `npc`
fully_automated; `system_automation` fully_automated.

The model must allow a human-operated agent to move between assisted, autopilot and
manual takeover.

---

## 4. Scope of this phase

Implement the multi-profile core foundation only.

**Do not implement personality generation.** Prepare a personality reference field or
boundary. See section 9.

---

## 5. Group identity: the corrected rule

**A `groupId` is globally unique and identifies a (profile, group) membership, not a
group.**

Schema evidence:

```sql
CREATE TABLE groups (
  group_id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users ...,
  UNIQUE (user_id, local_display_name),
  UNIQUE (user_id, group_profile_id)
) STRICT;
```

`group_id` is a primary key. Upstream deliberately scopes `local_display_name` and
`group_profile_id` per user and deliberately does **not** scope `group_id`. Two profiles
can never both hold group 21.

Measured confirmation: one real group with 27 participating profiles produced group ids
1 through 27, all distinct.

### 5.1 The hazard is aliasing, not collision

Collision cannot occur. What occurs is the inverse: one conversation carries as many
group ids as there are participating profiles.

```sql
CONSTRAINT messages_group_msg_unique UNIQUE (group_id, group_msg_id)
```

Both components differ per profile, so this constraint does not collide. It **permits all
N rows**. With N participating profiles the archive stores N copies of every message, and
consent evaluation, publication derivation and the full-text index multiply with them.

Anything that must hold per conversation rather than per membership fragments the same
way.

### 5.2 The conversation identity

**`groups.via_group_link_uri_hash`.** 32 bytes, a hash of the group link. Measured across
27 profiles sharing one group: populated on all 27, identical on all 27.

Rejected alternatives, all measured on the same sample:

| Field | Result |
|---|---|
| `group_profiles.public_group_id` | 0 of 27 populated |
| `group_profiles.group_link` | 0 of 27 populated |
| `groups.root_pub_key` | 0 of 27 populated |
| `groups.via_group_link_uri` | works, and **must not be used** |

`via_group_link_uri` is the full join link: 373 bytes of server addresses and key
material. Using it as a key writes a credential into every row referencing a
conversation. This is a prohibition, not a preference.

**Residual gap, recorded and not assumed away.** All 27 sampled profiles joined via the
group link. A profile that **created** a group never did, and `root_pub_key` is empty in
this schema version, so there is no protocol-level fallback. Do not make the column
`NOT NULL` until the creator path has been checked against a database containing one.

### 5.3 Consent identity is unaffected

`group_members.member_id` is the protocol-level id, documented as unique per group, with
`UNIQUE (group_id, member_id)`. Every profile sees the same member under the same id.
Consent keyed on `sender_member_id` therefore survives multi-profile intact.

This needs no new design.

---

## 6. Required components

**6.1 Multi-profile runtime.** Replace the single-profile assumptions created by
`bot.run()` with a reusable runtime on one `ChatApi.init()` instance and one
`startChat()` call. Load and manage all profiles from the shared SimpleX database.

**6.2 Runtime state machine.** States: `offline`, `starting`, `subscribing`, `ready`,
`degraded`, `stopping`. Transition criteria in section 7.

**6.3 Event routing.** Route every incoming event through the receiving SimpleX `userId`.

**6.4 Group addressing.** Carry `userId` alongside `groupId` at every call site. The
compound is redundant as a key, since `groupId` alone is unique, but it keeps the
membership nature of the id visible and prevents the aliasing error in section 5.1.

**6.5 Serialized command scheduler.** For all commands that depend on the active SimpleX
user. It must select the required user, execute exactly one active-user-dependent command
at a time, return the result to the correct bot context, and prevent concurrent
`apiSetActiveUser` races. Implementation detail in section 8.

**6.6 Outgoing message recording.** Record outgoing messages from the **command return
value**. Do not depend on an outgoing event appearing in the event stream. Section 9.2.

**6.7 Persistent bot registry.** At least: internal bot id, SimpleX user id, actor type,
automation mode, human operator reference where applicable, display name, avatar source,
avatar reference, disclosure label, enabled state, created and updated timestamps, and a
personality reference per section 9.1.

---

## 7. State machine transitions

Measured, not estimated. Source: 200 profiles in one core, 27 holding real connections.

**`starting` → `subscribing`:** when `startChat()` returns. Measured at **42 ms**. It
returns almost immediately and subscribes in the background.

**`subscribing` → `ready`:** when subscription-class events stop arriving. Implement as a
quiet period: no new subscription event for **10 seconds**, hard ceiling **120 seconds**,
after which declare `ready` and log that it was reached on the ceiling rather than on
quiet.

Measured: first event after 201 ms, events continued for roughly 60 seconds (494 in the
first 60 s, 822 before going quiet).

**This is not cosmetic.** A run that began sending 8 seconds after `startChat()` took
**10 seconds** to reach the first receiver. The same operation on a settled core took
**153 ms**. Factor 65. Treating the core as ready when `startChat()` returns is wrong by
two orders of magnitude in first-message latency.

**`degraded`:** no measured guidance. A clean restart was measured; a network
interruption was not. Implement and report the behaviour as untested.

---

## 8. The active-user constraint

Measured behaviour with the controller running:

```
apiListGroups(foreign userId)   -> rejected with differentActiveUser
apiConnectPlan(foreign userId)  -> proceeds to link validation
apiConnect(foreign userId)      -> proceeds to link validation
```

Do not rely on which calls tolerate a foreign `userId`. Route everything through the
scheduler.

**Serialize the issuing, not the waiting.** Commands are issued one at a time: select
user, issue, release. Completion arrives asynchronously through events, so many
operations may be in flight simultaneously. Serializing the wait as well collapses
throughput for no benefit.

**The failure mode is silent.** Concurrent `apiSetActiveUser` calls overwrite one another
and the following command executes as the wrong profile **without raising an error**.

Reproducible negative test: three parallel `apiSetActiveUser` plus connect calls per batch
produced **exactly one success per batch**, 7 of 20 operations, with the failures forming
a regular gap pattern. Serializing the issuing step produced **20 of 20**. Build this into
the suite; it fails silently otherwise.

---

## 9. Two boundaries to the generator workstream

### 9.1 Personality reference

Personality generation is out of scope. The registry needs a reference field so it can be
filled later without a migration.

Proposed shape: `{ personalityId, seed, configVersion }`. The seed alone reconstructs a
personality exactly, given the configuration version.

**One existing column needs a decision.** `personality_profile` currently exists and is
never written; every row takes the literal default, so it reads as configured when nothing
configured it. Either it becomes the reference field and something writes it, or it is
retired and the reference is added separately. A column that exists, is never written and
silently defaults is worse than no column, because it looks answered.

The generator itself now exists as `src/generator/names` (CCB-S4-002) and
`src/generator/traits` (CCB-S4-003). Neither has a runtime caller yet, and neither is to
be wired in during this phase.

### 9.2 Outgoing message recording

Recording sends from the event stream loses them. Measured: a history built from events
alone recorded **zero** sends while six profiles had demonstrably sent. Recording from the
return value of `apiSendTextMessage` produced correct counts.

The mechanism was not root-caused. The working hypothesis is that the outgoing event is
delivered in the context of the profile active at delivery time, so rapid
`apiSetActiveUser` switching loses it. If that holds, current single-profile recording is
correct today and **breaks at the moment this runtime lands**, because this runtime
introduces active-user switching as normal operation.

Settling it is a small test and does not need the runtime: send one message and confirm a
`groupSnd` event arrives with the sender's `userId`; repeat while switching the active
user immediately after the send, and check whether the event still arrives and which
`userId` it carries.

Either way the implementation is the same: **record from the return value.**

---

## 10. Known SDK defect: reactions

`ChatApi.apiChatItemReaction` checks the response against `"chatItemsDeleted"` and throws
otherwise. `/_reaction` returns `chatItemReaction` in **both** directions, so the guard is
never satisfied and **both add and remove throw** although the operation succeeds.

The thrown `ChatCommandError` carries the successful response on `.response`, while
`.chatError` is `undefined`. Handlers inspecting `.chatError`, which is what
`ChatAPIError` uses, log an empty error. That is what makes it expensive to diagnose.

Present in **6.5.4** and **7.0.0-beta.3**. Reported upstream as PR #7109, open.

Workaround wherever reactions are set:

```ts
const cmd = CC.APIChatItemReaction.cmdString({
  chatRef: { chatType, chatId }, chatItemId, add, reaction,
})
const r = await chat.sendChatCmd(cmd)
if (r.type === "chatItemReaction" || r.type === "chatItemsDeleted") return r
throw new Error("reaction failed: " + (r?.type ?? "unknown"))
```

Verified reaction set, tested one fresh message per emoji against a live group:

```
accepted:  👍 👎 😀 😂 😢 ❤ 🚀 ✅
rejected:  😃 😔 😭 🤣 🎉 ✔ 👏 👌   (commandError)
```

Code points matter. `😀 U+1F600` is accepted; the near-identical `😃 U+1F603` is not.
`😢 U+1F622` is accepted; `😔 U+1F614` is not.

---

## 11. Expected noise

Routine once several profiles in one core relay the same group message to each other. The
core correctly discarding duplicates.

```
errorStore  / duplicateGroupMessage
errorAgent  / INTERNAL / SEMsgNotFound "setMsgUserAck"
```

Log at debug level. Do not surface as failures and do not let them trip health checks, or
they will mask real errors.

---

## 12. Implementation details

| Detail | Note |
|---|---|
| `DbConfig` fields | `filePrefix` and `encryptionKey`, not `dbPath` / `dbKey`. Produces `<prefix>_chat.db` and `<prefix>_agent.db`. |
| Display name characters | SimpleX rejects `.` and `'`. Sanitise before use. |
| Migration numbering | Next free is **023**. Note that two files share the number 019; the runner applies by filename and records applied names, so this is safe but should not be repeated. |

---

## 13. Required tests

With measured expected values where they exist.

| Test | Expectation |
|---|---|
| all profiles remain subscribed regardless of the active user | With the active user parked on a non-participant, **26 of 26** other profiles received, **0 duplicates**. A profile that is both member and active user receives normally: no preference, no penalty. |
| incoming events retain the receiving userId | Every `newChatItems` event carried the receiving profile's own `userId`. `T.User` exposes `activeUser: boolean` as a cheap assertion hook. |
| group ids are per membership and globally unique | The inverse of the original brief's test. One conversation, N participating profiles, N **distinct** group ids, all resolving to a single conversation identity via `via_group_link_uri_hash`. The original test, that ids may repeat across users, tests a condition the schema makes impossible. |
| active user changes do not affect incoming attribution | First receiver **153 ms**, last **1771 ms**, all 26 correct while the active user was elsewhere. |
| outgoing commands are serialized | See section 8. |
| parallel requests cannot execute under the wrong profile | Negative test in section 8: unserialized gives 7 of 20 with a regular gap pattern; serialized gives 20 of 20. |
| outgoing messages are recorded from command results | Events alone recorded zero of ten sends. Return value recorded all. |
| the four actor types remain distinct | Structural. |
| avatar source does not determine actor type | Structural. |
| manual takeover disables autopilot for a human-operated agent | Structural. |

---

## 14. Safety and audit

- Every automation mode change is persisted and audited.
- Every manual takeover is persisted and audited.
- The system never silently changes a human-operated agent into a fully automated NPC.
- The system never presents an NPC as a human-operated agent.
- AI may generate wording and creative material. Deterministic application logic controls
  identity, permissions, routing, disclosure and execution.

---

## 15. Do not edit

```
src/web/views/ai.ts
assets/app.css
scripts/verify-ai-admin.ts
scripts/verify-ai-navigation.ts
```

All four exist. Note that `src/web/views/ai.ts` has been edited by other work since the
original brief was written, so this list is an instruction for this phase, not a claim
that the files are untouched.

Administration integration follows in a separate workstream once this foundation is
stable.

---

## 16. Deliverable

Return: base commit, branch name, architecture summary, changed files, migration details,
tests added, all test results, new commit SHA, open questions.

Do not merge to main.

---

## 17. Capacity constants

For sizing only, not for external claims.

```
core base cost              ~160 MB, once
profile creation            ~20 ms, constant regardless of count
marginal profile            ~27 KB RAM, ~75 KB database
1000 profiles, one core     334 MB RSS, 75.8 MB database
incoming message processed  ~65 ms steady state
sustained receive rate      ~15 events/s per core, stable under load
outgoing message            ~12 ms per group member
idle                        flat, no leak observed
```

Send and receive contend: send latency rose from **93 ms** to **305 ms** median while a
receive backlog was worked off.

**Untested:** a profile belonging to many groups. All figures measured one profile in one
group. Cost scales with subscribed queues, not profile count.
