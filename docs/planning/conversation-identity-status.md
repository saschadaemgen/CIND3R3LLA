# Conversation identity: settled and open

State after the schema audit. Records what no longer needs discussing, so it does not get
reopened, and what still blocks archive work.

Supersedes nothing. Extends `BRIEFING-multi-profile-addendum-1-correction-2.md` section 1.

---

## Settled

**1. A `groupId` identifies a membership, not a group.** Globally unique primary key. Two
profiles never share one. The same conversation carries as many group ids as there are
participating profiles.

**2. `group_profile_id` is disqualified, more strongly than Correction 2 stated.**
`group_profiles` itself carries `user_id INTEGER DEFAULT NULL REFERENCES users ON DELETE
CASCADE`. The row is per user, not a shared object seen through a scoped constraint. Each
profile holds its own copy.

**3. Consent identity survives multi-profile intact.** `group_members.member_id` is the
protocol-level id, documented in the core schema as unique per group, with
`UNIQUE (group_id, member_id)`. Every profile sees the same member under the same id.
Consent is keyed on `sender_member_id`, never on a display name. A member who opted in is
the same member to all participating profiles.

**This needs no new design. Do not reopen it.**

**4. The hazard is duplication, not only fragmentation.**

```sql
CONSTRAINT messages_group_msg_unique UNIQUE (group_id, group_msg_id)
```

Both components differ per profile, so the constraint does not collide. It **permits all
N rows**. With N participating profiles the archive stores N copies of every message, and
consent evaluation, publication derivation and the full-text index multiply with them.

Correction 2 described this as scattering across N apparent groups. That understates it.

---

## Tractable now, and deliberately decoupled

`shared_msg_id` is already captured from the protocol and persisted today. It is nullable
and carries no unique constraint and no index.

Message-level canonicalisation can therefore be built **before** the conversation-level
key is decided. The two do not have to share a migration, and separating them removes the
archive block from the critical path.

Open on this point: whether `shared_msg_id` is populated for every captured message or
only some. Nullable suggests it is not guaranteed, and a canonicalisation that silently
skips null rows would be worse than none.

---

## Open, and cheap to settle

Two candidates for the conversation-level key, both in `group_profiles`:

```
public_group_id  BLOB
group_link       BLOB
```

Neither can be assessed on a fresh development instance with one user and no groups. What
is needed is a query against the production host answering two questions: are they
populated, and are they identical across profiles that share a group.

That is a small query and it unblocks the archive design. Worth running before the
multi-profile runtime writes its first row, because retrofitting a conversation identity
after the duplication has started means a data migration rather than a schema decision.

---

## Open, and dependent on the above

- whose messages publish when several profiles share a group
- whether name redaction holds across profiles
- how `group_deleted` behaves per membership rather than per conversation

None of these can be answered before the conversation-level key exists.

---

## One item belonging to the generator workstream

`personality_profile` is never written. Every row takes the literal default, so it reads
as configured when nothing configured it.

Our specification assumes the bot registry holds a personality reference of the shape
`{ personalityId, seed, configVersion }`. Before the generator lands, one of two things
must be true: either that column becomes the reference field and something writes it, or
it is retired and the reference field is added separately.

A column that exists, is never written and silently defaults is worse than no column,
because it looks answered.

---

## Consequence for the capacity figures

The measurement report covers runtime cost only. Archive storage was never measured and
is not in it.

Archive storage scales with messages multiplied by participating profiles, which is a
separate factor from the runtime cost per event. Any sizing that uses the measurement
report alone will understate storage for a multi-profile deployment.
