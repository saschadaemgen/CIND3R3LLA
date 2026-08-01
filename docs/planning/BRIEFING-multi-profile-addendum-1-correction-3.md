# Correction 3 to Addendum 1

Resolves the requirement surfaced in Correction 2 section 1: the conversation-level
identity above the per-membership `group_id`.

Answered by measurement, not inference. Both candidates proposed in the audit are
unusable; a third field is.

---

## 1. The answer

**`groups.via_group_link_uri_hash`.**

32 bytes, a hash of the group link. Identical across every profile that belongs to the
same group, populated on every one of them. Fixed length, opaque, and it carries no
credential material.

---

## 2. Evidence

Method: scan every column of `groups` and `group_profiles`, joined per membership, and
classify each by whether its value is identical across all memberships of one group.

Sample: one real SimpleX group, **27 participating profiles in one core database**,
SDK 6.5.4 schema. Group ids ran 1 through 27, confirming again that a `group_id` is a
membership row and not a group.

Result for the candidates:

| Column | Populated | Distinct | Verdict |
|---|---|---|---|
| `group_profiles.public_group_id` | 0 of 27 | none | never populated |
| `group_profiles.group_link` | 0 of 27 | none | never populated |
| `groups.via_group_link_uri` | 27 of 27 | 1 | works, but see below |
| `groups.via_group_link_uri_hash` | 27 of 27 | 1 | **usable** |
| `groups.root_pub_key` | 0 of 27 | none | never populated |

Both candidates named in the audit are empty for this group type. They may be populated
for public directory groups; that was not tested and should not be assumed.

`root_pub_key` was checked because a protocol-level group key would have closed the gap
in section 4. It is never populated in this schema version.

---

## 3. Why not `via_group_link_uri`

It works, and it should not be used. It holds the full join link: 373 bytes containing
server addresses and key material. Using it as an archive key writes a credential into
every row that references a conversation.

The hash is the same value, stable in the same way, at 32 bytes and with nothing
sensitive in it.

---

## 4. What is still not covered

**All 27 profiles in the sample joined via the group link.** That is how they were
created.

Two paths were not tested and are not covered by this result:

- a profile that **created** the group. It never joined via a link, so
  `via_group_link_uri_hash` may be absent.
- a profile that joined via a **member invitation** rather than the group link.

With `root_pub_key` empty, this schema version offers no protocol-level fallback that
would cover those paths. For bots that join existing support groups, which is the normal
operation, the field is sufficient. For a bot that creates a group, the identity has to
come from somewhere else and that case is open.

Recommendation: treat the hash as the conversation key, and make the column NOT NULL only
after the creator path has been checked against a database that contains one.

---

## 5. Fields that are identical but are not identities

For completeness, since they appear in the same scan and could be mistaken for candidates:

`gp.image`, `gp.preferences`, `gp.display_name`, `g.local_display_name` are group
**content**. They are identical across memberships because the group profile is shared,
but they change when someone edits the group, so they cannot key anything.
`g.relay_request_execute_at` decodes to `1970-01-01`, a default. The remainder are flags.

---

## 6. Side finding: the group image is stored per membership

Not what was being looked for, but it belongs in the record because it is the same class
of problem as the message duplication.

`group_profiles.image` is 12.1 KB and identical across all 27 memberships. The group
avatar is therefore stored **27 times** in one core database, roughly 334 KB for a single
group picture.

This is core-side storage, not archive storage, so it is separate from the message
duplication in Correction 2. It scales the same way: with groups multiplied by
participating profiles.
