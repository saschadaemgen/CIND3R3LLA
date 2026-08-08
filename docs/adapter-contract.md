# Cinderella — Chat Adapter Contract

> _Living document — maintained under the CCB briefing scheme; introduced by **CCB-S3-020**._

What a **compliant implementation** of `ChatAdapter` (`src/adapter/chat-adapter.ts`) must do. This is
written as requirements on any implementation, not as notes about the SimpleX one, because its purpose
is to let a second core be built against something firmer than guesswork.

Everything here was learned the hard way. Each clause names the briefing where the lesson was paid for,
so a future implementer can read the original if they want the full story.

---

## Audit, 2026-08-08 (CCB-S5-003)

This document had not been touched since 27 July, across the most structural season the project has
had. It was read against the code and it is **substantially still correct**: every clause in sections
1 to 9 was checked and only the additions below were needed. What follows is the state it describes,
stated once so a reader knows what they are holding.

**This is a specification, not a description.** `ChatAdapter` has exactly **one implementation
today, `FakeChatAdapter`**, and its only consumers are the demo routes and two harnesses
(`verify:adapter-fake`, `verify:adapter-seam`). Production does not go through the interface: the bot
drives the SDK directly inside `src/bot/`, and what it shares with the seam is `src/adapter/types.ts`,
the **domain types**, which capture, parse, consent, moderation, erasure and onboarding all import.
That is not drift. **D-078 shipped Phase A only and deferred B and C**, and Phase A was always the
types plus the enforcing check. The interface and this contract run ahead of the code on purpose,
which is what makes them worth keeping accurate.

**What Season 4 and 5 added, and this document had no clause for:** the member's role as a first-class
domain value (§1), one core hosting **many bot identities at once** (§9a, new), and the fact that an
erasure issued as the wrong identity **succeeds and does nothing** (§7). The last of those cost a
member's erasure being marked done with the content still on the host, and it is exactly the kind of
silent consent bug section 0 warns about.

**Deliberately left:** the SimpleX-shaped tags. Every one of them still describes SimpleX honestly and
none has a second protocol to be resolved against yet. §9.1's known leak is unchanged and unresolved,
by design.

---

## 0. How to read this

**MUST** clauses are behaviours Cinderella relies on. Violating one does not produce a compile error; it
produces a consent, capture or publication bug, usually silent.

Each section is tagged:

- **[neutral]** — a property of the domain. Any protocol can satisfy it.
- **[SimpleX-shaped]** — currently phrased in terms of SimpleX semantics. A second protocol cannot
  satisfy it honestly as written, and it needs resolving before or during that work.

---

## 1. Identity and durability

**[neutral] Member ids MUST be stable for as long as the member is continuously present, and MUST NOT
be reused after they leave and rejoin.**

Consent is bound to the member id, and a rejoining member deliberately gets fresh consent rather than
inheriting the old decision (CCB-S1-001 §9). An implementation that recycled ids would silently
re-publish a member who had never opted in on this membership. An implementation whose ids churn while
a member is present would silently revoke everybody.

**[neutral] Display names MUST NOT be treated as identity.** They collide between members and change
freely. Cinderella stores them for rendering only.

**[neutral] Group ids MUST be stable across a rename.** Capture is scoped to a numeric group id
precisely so a group admin renaming the group does not stop capture.

**[neutral] A member's role MUST be reported at its real granularity, and MUST NOT be flattened onto
a neighbouring value.** (CCB-S4-032, added to this document 2026-08-08.)

`MemberRole` was widened from five values to the full seven the moment something read it, because
moderation computes exemptions from it and **an exemption computed from a lossy role is an exemption
that can be wrong**. An implementation whose protocol has fewer roles MUST say which of these it
cannot express, rather than mapping `relay` or `author` onto the nearest thing it has.

**[neutral] Three roles are three facts and MUST NOT be collapsed** (CCB-S4-025, D-129): the role a
bot was *invited* as, the role it *actually holds*, and the role the operator *expects*. A page or an
interface that reports one number for all three lies about permissions, and the lie only surfaces when
an action is refused.

---

## 2. Message scope, and the private-thread problem

**[SimpleX-shaped] An implementation MUST distinguish a message posted to the whole group from a
message in a private member-to-operator thread, and MUST make that distinction available on every
received message.**

This is the most expensive lesson in the archive. In SimpleX, a support-scope message arrives on the
SAME event as a public group message, and the only difference is an OPTIONAL `groupChatScope`
discriminator on `ChatInfo`. Absent-means-public read as "ordinary public message", and two private
messages were captured into the archive (CCB-S3-019).

The domain type therefore makes `scope` **required** and closed (`public | support | unknown`), and
capture is a **whitelist**: only a provably public group message passes. An implementation MUST map any
scope it does not recognise to `unknown` rather than omitting it, so a future scope fails closed instead
of arriving as public.

Why this is tagged SimpleX-shaped: "a private thread inside a group, addressed to the operators" is a
SimpleX product concept. Matrix has no direct equivalent; the nearest analogues are a separate room or a
threaded reply, which have different membership and visibility semantics. **A Matrix adapter must decide
what `support` means before it can populate this field honestly**, and the answer may be that it always
reports `public` and Cinderella never receives support traffic on that protocol.

---

## 3. Event delivery

**[neutral] An implementation MUST deliver each event at most once, and MUST state whether it can
redeliver.**

The SimpleX core delivers exactly once and never re-sends. A handler that fails loses the event
permanently, with no record it existed. That is why capture writes ahead of processing (CCB-S3-024) and
why sixteen failed file receipts from Season 1 were unrecoverable.

An implementation that CAN redeliver may do so, and Cinderella will tolerate duplicates: capture is
idempotent per `(group, item)`. An implementation that cannot redeliver MUST say so, because the
write-ahead log is the only thing standing between that property and lost member content.

**[neutral] Deletion events MUST identify items by the same id used when the item was delivered.**
Cinderella persists that id as `group_msg_id` and matches deletions against it.

**[neutral] An edit MUST arrive as an edit of the original item, not as a new item.** Cinderella
overwrites in place so that pre-edit text is never left published.

---

## 4. Sending

**[neutral] An implementation MUST support sending to a group, to a member's private thread, and to a
direct chat**, and MUST return enough about what it sent for the caller to archive it: item id, chat id,
timestamp and text. Cinderella archives her own messages as rows (CCB-S3-007), so a send that reports
nothing is a message that cannot be published or retracted.

**[neutral] A reply MUST be expressible without the caller inspecting the protocol's representation.**
The caller passes back the opaque handle it was given.

**[SimpleX-shaped] Text formatting MUST use single delimiters, and doubling a delimiter MUST disable
the format.**

`*bold*`, `_italic_`, `~strike~`, backtick code, `#secret#`. Doubling (`**bold**`) renders the
asterisks literally rather than emphasising, which is the opposite of Markdown and of every other chat
product. Verified against the SimpleX parser source (CCB-S3-003) after literal asterisks shipped to the
live group. A protocol with different markup MUST translate, not pass through.

---

## 5. Files

**[neutral] A received file MUST land at a path the caller can move it from**, and the implementation
MUST NOT assume the caller leaves it in place. Cinderella moves originals into its own encrypted store.

**[SimpleX-shaped] The staging directory and the destination directory MUST be on one filesystem.**

SimpleX stages and decrypts an XFTP download in a temp directory and then `rename()`s it into the files
folder. If temp is on a different device the rename fails with `EXDEV` and the file never arrives, so
every receive stalls — the CCB-S1-010 failure, whose fix was pinning `TMPDIR` next to the files folder.
An implementation with different transfer mechanics MUST document its own equivalent constraint, because
Cinderella's deployment layout depends on knowing it.

**[SimpleX-shaped] Transfers expire.** XFTP relays hold a file about 48 hours. A receipt older than
that can never complete, and Cinderella's retry budgets are set against that window.

**[SimpleX-shaped] A receipt creates its destination file when it STARTS.** A failed transfer therefore
leaves a zero-byte file named after the sender's own filename, which is member metadata that outlives an
erasure request (CCB-S3-027 §4). An implementation MUST either not do this, or Cinderella must keep
sweeping placeholders, as it does now.

---

## 6. Profile

**[SimpleX-shaped] A profile image change reaches direct contacts immediately, but group members only
on the bot's NEXT group message.**

SimpleX piggybacks the profile update onto the next outgoing group message. Cinderella compensates by
sending a single minimal message after setting the avatar, once, tracked by a marker so restarts do not
spam the group (CCB-S1-014/015). An implementation that pushes profile updates out of band MUST say so,
so that compensation can be dropped rather than sending a pointless message forever.

**[SimpleX-shaped] The profile image rides inside the profile envelope and is size-bounded.** SimpleX's
envelope is roughly 15.6 KB encoded; Cinderella targets 12,000 characters of data URI and steps
resolution and quality down until it fits. An implementation with a different or absent bound MUST
state it.

**[neutral] Setting a profile without an image MUST NOT erase an existing one.** An earlier version
reconciled the whole profile on every boot and blanked the avatar each time.

---

## 7. Erasure

**[neutral] `eraseOwnCopy` MUST remove the implementation's own stored copy of the content, not flag
it.**

This is a real distinction, not a pedantic one. SimpleX offers `internal` (deletes the item row, its
wire messages, its edit versions, its reactions, and its file on disk) and `internalMark` (sets a
deleted flag and keeps everything). Production held eleven items marked deleted, each still carrying
12 to 14 KB of content (CCB-S3-027). Only the former satisfies this method.

**[neutral] `eraseOwnCopy` MUST NOT broadcast a retraction to other members.** The member asked
Cinderella to erase her copy, not to announce their decision to the group. An implementation whose only
delete is a broadcast MUST report that it cannot satisfy this method, rather than broadcasting.

**[neutral] An erasure issued as the wrong bot identity MUST fail, and MUST NOT succeed quietly.**
(CCB-S5-001, D-155; added to this document 2026-08-08.)

The SimpleX core scopes its delete by `user_id` and `apiDeleteChatItems` takes no user id. Issued as
the wrong hosted profile it **deletes zero rows and raises nothing**, because deleting what does not
exist for that user is not an error. A member's erasure is then marked done with the content still on
the host: the worst possible shape for a consent bug, since every layer above reports success. The fix
is a port that resolves the owning bot from the chat id and **throws when it cannot**, so the queue
retries rather than the record lying. An implementation that scopes deletion by identity MUST make a
mis-scoped delete distinguishable from a delete that found nothing.

---

## 8. Member contact

**[SimpleX-shaped] A private channel to an individual member may exist, and MUST NOT be assumed.**

The contact-to-member link is structural and trustworthy where it exists: the core sets it over the
authenticated group connection, so no pairing-code protocol is needed. But it depends on the group's
`directMessages` setting, which the operator or a group admin controls (CCB-S3-016/017, D-058). An
implementation MUST make its availability discoverable rather than failing at send time.

---

## 8a. Bot identity, when one core hosts more than one

_Added 2026-08-08 (CCB-S5-003). This whole area postdates the document: it arrives with D-096, D-125
and D-155, and nothing here was decidable when the contract was written._

**[SimpleX-shaped] An implementation MUST state whether one connection can host several bot
identities, and if it can, every received event MUST carry which identity received it.**

SimpleX has one core with many users, one active at a time, and Cinderella now hosts **every enabled
bot on that one core**: an active-user scheduler serializes commands, and events are routed by the
receiving `userId`. An implementation that gives each identity its own connection satisfies this
trivially and should say so. One that multiplexes MUST report the receiver, because without it a
message from group A is answered by whichever profile happened to be active.

**[neutral] Anything addressed to a group MUST be resolvable to the identity that owns that group,
and an unresolvable owner MUST raise rather than default.**

This is the same lesson as the erasure clause in §7 and it generalises past deletion. Cinderella's
`runtime.runForGroup` throws on an unknown owner precisely because "act as whoever is active" is a
plausible-looking default that produces silent wrong-identity writes. Three such call sites were
predicted; there were five.

**[SimpleX-shaped] A command issued while a different identity is active MUST be serialized against
the switch, not merely queued behind it.** The active-user switch is global state on a shared core,
so an unscheduled call is not slow, it is *wrong*, and it is wrong only sometimes.

---

## 9. Known leaks

These are places where SimpleX semantics currently pass through the seam. They are recorded here rather
than in code comments because a second implementer needs to see them together, before they start.

### 9.1 `RawItem` is stored, and SQL reads inside it

`ChatMessage.raw` is typed `unknown` and application code may not inspect it. But it is persisted to
`messages.raw_json`, and **SQL reaches into the SimpleX shape**:

| Site | Expression | Status |
|---|---|---|
| `migrations/019_formatted_text.sql:57,62` | `raw_json -> 'chatItem' -> 'formattedText'` | **Live, on the public front.** Builds `published_messages.formatted_text` |
| `scripts/scan-support-scope.ts:36` | `raw_json -> 'chatInfo' -> 'groupChatScope'` | Live diagnostic, used by the CCB-S3-019 remediation |
| `migrations/001_init.sql:36` | `raw_json` column itself | Stores the whole item |
| `migrations/018_capture_events.sql:30` | `payload` "everything needed to re-apply the event" | **Still no production writer** (re-checked 2026-08-08: `capture/events/store.ts` is imported only by `replay.ts` and its harness, although the drain job *is* registered on the queue). Shape is not fixed, so it can still be defined in domain terms |

**This is not a contract clause a second protocol can satisfy.** Saying "a compliant implementation must
emit `AChatItem`-shaped JSON" would be a SimpleX requirement wearing a neutral name. A Matrix event has
an entirely different shape, and no honest Matrix adapter can produce `chatItem.formattedText`.

So it is stated plainly: **this is a known leak of SimpleX semantics through the seam, scheduled for
removal, not a property of the domain.** Until it is removed, the SimpleX adapter is the only
implementation that can drive the public front's formatted text.

Resolving it means defining Cinderella's own formatted-runs shape, rewriting migration 019 against it,
and backfilling existing rows. That is a schema change on the path that serves every public page, so it
belongs in its own briefing rather than being smuggled into a refactor.

**Matrix support is on the roadmap, which moves this from housekeeping to a prerequisite.** Any SQL that
reads the SimpleX shape is wrong the moment a second protocol exists.

### 9.2 Scope semantics

Section 2 above. `support` is a SimpleX product concept, and a Matrix adapter has to decide what it
means before it can populate the field.

### 9.3 Raw command escapes

The SimpleX adapter issues two commands the typed API does not wrap: `/_files_folder` to set the
download destination, and `ReceiveFile` with `storeEncrypted: false`. These are adapter-internal and do
not cross the seam, but a second implementation needs equivalents for both: a configurable download
destination, and a way to accept a file unencrypted so Cinderella can apply its own encryption at rest.

---

## 10. What is deliberately not in the interface

Moderation (deleting another member's message, removing a member, changing a role), reactions, and
creating a contact from a member. The CCB-S3-016 audit found all of them available in the SDK and all
are intended, but an interface method with no caller is a guess about a future implementation
(CCB-S3-020 §3). They arrive with their first real caller, when their shape can be verified against
live behaviour.

**Corrected 2026-08-08 (CCB-S5-003): moderation now has callers, and they did not come through this
interface.** `src/bot/enforcement.ts` wraps `apiSetMembersRole`, `apiBlockMembersForAll` and
`apiRemoveMembers` behind a late-bound **port** (`EnforcementPort`), and `src/bot/recital-port.ts` and
the core-delete port do the same for their own needs. So the rule above held in one sense (nothing was
added to `ChatAdapter` speculatively) and was overtaken in another: **the shape that arrived with the
first real caller was a narrow port, not a method on the wide interface.**

That is worth recording as a finding rather than a tidy-up. A port names exactly what one caller
needs, is trivially faked in a harness, and can be left unset so the capability is *absent* rather
than *broken* — which is how enforcement ships **locked** (D-139) while its code is complete and
reversible. If `ChatAdapter` ever gets a second implementation, the question to answer first is
whether these ports fold into it or stay beside it. Reactions and creating a contact from a member
still have no caller and stay out.
