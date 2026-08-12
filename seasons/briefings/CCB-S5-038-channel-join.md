# CCB-S5-038 — The Channel Join, on the Core We Already Have

- **Type:** Briefing
- **Season:** 5
- **Date:** 2026-08-13
- **Base:** `main` at `6e302de` or later.
- **Commits:** Conventional Commits, split by concern, pre-push grep before the push.
- **Supersedes:** the 7.0.0 upgrade briefing, whose premise was disproven. See D-196.

## Why this exists

The channel bridge shipped, is deployed, and cannot join a channel. The core refuses
`apiConnect` for a channel link and names the command it wants:

```
{"type":"commandError","message":"channel links must be connected via APIConnectPreparedGroup"}
```

D-191 recorded that as blocked on the 7.0.0 upgrade. **That was wrong**, and D-196 records why:
7.0.0 adds no SDK method at all, and does not wrap that command either.

What is true instead, established by reading the installed core:

```
$ strings libsimplex.so | grep -i prepared
'APIConnectPreparedGroup
'APIConnectPreparedContact
'CRNewPreparedChat
'PreparedGroup

$ strings libsimplex.so | grep '^/_connect'
/_connect
/_connect contact
/_connect contact @
/_connect group #
/_connect plan
```

**The command exists in the core this deployment is already running, and its wire form is
`/_connect group #<groupId>`.** Only the TypeScript wrapper is missing, and `sendChatCmd`
takes a raw string, so nothing is blocking this but the work.

## What to build

A wrapper for the prepared-group connect, and the bridge's Join control behind it.

### 1. The flow, and the load-bearing rule — SETTLED

The core's parser carries four adjacent commands:

```
/_prepare contact      -> APIPrepareContact
/_prepare group        -> APIPrepareGroup
/_connect group #      -> APIConnectPreparedGroup
/_join #               -> APIJoinGroup
```

So the join is **two steps**:

1. `/_prepare group <userId> <link>` — creates the prepared group and answers
   `newPreparedChat` (the `CRNewPreparedChat` constructor, the `"newPreparedChat"` JSON tag,
   and the `conn_link_prepared_connection` column that exists for exactly this).
2. `/_connect group #<groupId>` — completes it.

**THE LOAD-BEARING RULE.** `/_connect group #<n>` acts on whatever group `n` names, and a
wrong `n` joins a different real room which the console cannot undo. So:

> **The id comes from step 1's own response and from nowhere else — never from the connect
> plan, whose `ok` variant carries no group at all, and never from `apiListGroups`, whose
> ordering promises nothing.**

That makes the failure mode structurally impossible rather than merely avoided: the only
value ever passed to step 2 is the one the core handed back one command earlier. If the
prepare answer carries no id, the path REFUSES rather than continuing with a guess — a
refusal costs one message, a guess costs a group.

### 2. The wrapper

In `src/bot/runtime/core.ts`, beside `leaveGroup` and `deleteGroupRecord`:

- takes no user id, so it goes through the scheduler as the owning bot (D-171);
- `sendChatCmd` directly, since the SDK does not wrap it, with a comment saying so and
  pointing at the `strings` evidence above so the next reader does not think it was invented;
- errors through `describeChatError` like everything else (D-188).

Note this is the FIRST raw `sendChatCmd` in the repository. That is a precedent worth stating
in the decision: the seam is that raw commands live in `src/bot/` beside the typed ones and
nowhere else, and `verify:chat-errors`' AST check already requires them to be scheduled.

### 3. The control

`connectBotToChannel` currently throws `ChannelJoinUnavailableError` when the plan reports
relays. Replace that branch with the prepared-group path. **Keep the group-link refusal** — it
does real work independently and is unrelated.

Remove the "not built yet" notice from the bridge page and let the control work.

### 4. Verify it where it can be verified

Per D-178 the SimpleX core is one of the four things only the host can show. So:

- offline: the wrapper is scheduled, the refusal still fires for a group link, the error path
  describes rather than points;
- on the host: the operator joins his channel from the bridge page. That is the proof, and the
  report must not imply otherwise.

## Ground rules

1. Prove where the `groupId` comes from before issuing anything. A wrong id acts on a real group.
2. Back up the core database first. `/root/pre-7.0.0/` from CCB-S5-038's investigation is
   current as of 2026-08-13 23:00; take a fresh one if time has passed.
3. Keep the group-link refusal and the "not a channel" naming.
4. Preserve everything: both bots' identities and memberships, capture assignments, consent.
5. Decision entry: the raw-command precedent and the join it unblocks.

## What this is not

Not the 7.0.0 upgrade. D-196 closes that: it is optional, judged on signed messages, badges and
name resolution, and **no feature is blocked on it**.
