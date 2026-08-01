# Correction 2 to Addendum 1

Applies to: `BRIEFING-multi-profile-addendum-1.md`, section 3 (group id row) and
section 4 (reactions).

The audit is right on both counts. Both corrections come from reading the actual core
schema and the actual SDK code rather than inferring from behaviour, which is what should
have happened in the first place.

---

## 1. Group ids: the claim was inverted

### What the addendum and the parent brief say

The addendum lists as an expected test result:

> the same local group ID can exist for different users without collision

The parent brief states:

> A local groupId must never be treated as globally unique.

Both are wrong, and in the same direction.

### What the schema says

```sql
CREATE TABLE groups (
  group_id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users ...,
  UNIQUE (user_id, local_display_name),
  UNIQUE (user_id, group_profile_id)
) STRICT;
```

`group_id` is a global primary key. Upstream deliberately scopes `local_display_name` and
`group_profile_id` per user and deliberately does **not** scope `group_id`. Two profiles
can never both hold group 21.

### What the measurement actually showed

The measurement is consistent with the schema; it was described wrongly. One real group,
26 participating profiles, produced group ids 21, 20, 19, 18, 17, 16, 15, 14, 13, 12, 11,
10, 9, 8, 7, 6, 5, 4, 3, 2 and others. That is **one group holding 26 ids**, not 26
groups colliding on one id.

### The correct statement

A `groupId` identifies a **(profile, group) membership**, not a group. It is globally
unique. The same conversation is represented by as many group ids as there are
participating profiles in the database.

### Why the inversion matters

The hazard is not collision, which cannot occur. The hazard is **aliasing**.

Anything keyed on `group_id` alone fragments: the same conversation accumulates one
identity per participating profile. For an archive, `messages.group_id` would scatter a
single conversation across 26 apparent groups. Anything that must hold per conversation
rather than per membership fragments with it, including consent, retention, and any
per-group policy.

Believing the collision story leads to writing deduplication logic that is not needed.
Understanding the aliasing story leads to writing **canonicalisation** logic, which is
needed and is a different piece of code.

### Resulting requirement, not previously stated anywhere

There must be a **conversation-level identity above the membership ids**, with a mapping
from every participating profile's `group_id` onto it. Neither the brief nor the addendum
specified this. It is a prerequisite for the archive and for anything that holds per
conversation.

Determining the right stable key for that identity requires the schema. `group_profile_id`
is scoped per user by the UNIQUE constraint above and is therefore not a candidate on its
own. This is an open design question, not a settled one, and it should be answered from
the schema rather than inferred.

### Consequence for the brief's test list

The brief's third required test asks to prove that the same local group id can exist for
different users without collision. As written it tests a condition the schema makes
impossible, so it passes trivially and proves nothing.

The useful test is the inverse: **one conversation, N participating profiles, N distinct
group ids, all resolving to a single conversation identity.**

The compound key `userId + groupId` that the brief prescribes remains harmless and is
still worth carrying, because it keeps the membership nature of the id visible at every
call site. Only the stated reason for it was wrong.

---

## 2. Reactions: the asymmetry does not exist

### What the addendum says

> Removing a reaction returns normally.

This was inferred from reading the SDK wrapper, never tested. It is wrong.

### What the SDK does

```ts
async apiChatItemReaction(chatType, chatId, chatItemId, add, reaction) {
  const r = await this.sendChatCmd(CC.APIChatItemReaction.cmdString({...}))
  if (r.type === "chatItemsDeleted") return r.chatItemDeletions
  throw new ChatCommandError("error setting item reaction", r)
}
```

`chatItemsDeleted` is the response to deleting chat **items**. The `/_reaction` command
does not return it in either direction; it returns `chatItemReaction` for both add and
remove. The guard is therefore never satisfied and **both directions throw**.

How the error was missed during measurement: the removal path in the probe ran through
the replacement function, which accepts both response types, and its failure branch was
an empty catch used for cleanup. The wrapper's removal path was never exercised.

### What this changes

The workaround is unaffected. It already accepts both response shapes and works in both
directions:

```ts
const r = await chat.sendChatCmd(
  CC.APIChatItemReaction.cmdString({ chatRef: { chatType, chatId }, chatItemId, add, reaction })
)
if (r.type === "chatItemReaction" || r.type === "chatItemsDeleted") return r
throw new Error("reaction failed: " + (r?.type ?? "unknown"))
```

Only the description was wrong. Recording it as a documented SDK limitation rather than
applying it as a behavioural rule is the correct handling, and the correct statement of
the limitation is: **`apiChatItemReaction` throws on success in both directions**, not
only when adding.

The verified reaction set in the addendum is unaffected; it was established empirically
through the replacement function.

---

## 3. Not our call

The brief's "do not edit" list names `src/web/views/ai.ts`. If the tree contains
`ai-profiles.ts` and `ai-onboarding.ts` instead, only the author of the brief can say
which was meant. That question belongs upstream, not here.

---

## 4. Scope

This correction adds no work items. It corrects two statements and surfaces one
previously unstated requirement, the conversation-level identity, which needs a decision
before the archive can key anything on a group.
