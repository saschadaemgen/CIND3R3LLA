# SimpleX embedded core: measurement report

Measurements of the official SimpleX Node SDK (`simplex-chat` 6.5.4) running an
**embedded native core**, taken for the CIND3R3LLA multi-bot project.

All figures below were measured, not estimated. Where a number is an extrapolation
it is marked as such.

**Test setup**

| | |
|---|---|
| SDK | `simplex-chat` 6.5.4 + `@simplex-chat/types` 0.8.0 |
| Core | embedded native library (`libsimplex.so` / `.dll`), no external CLI process |
| Backend | SQLite (single shared database, one core) |
| Host | Windows, Node 22.14, consumer hardware, Starlink uplink |
| Group | one real SimpleX group, 27 test profiles joined, all hosted by the same core |

---

## 1. Architecture: what the SDK actually is

The Node SDK is **not** a remote control for the `simplex-chat` CLI. It ships a
node-gyp addon that loads the same core library the desktop clients use, directly
in the Node process. Commands go through `chatSendCmd`, events arrive via
`chatRecvMsgWait`. There is no daemon and no IPC.

Consequence: profiles do not cost a process. They cost rows in a database and a
small amount of core state.

**Correct entry point for multi-profile operation:** `ChatApi.init()` + `startChat()`,
then manage profiles through the user APIs. The `bot.run()` convenience wrapper is
built for a single bot and takes over the active user, so it is unsuitable here.

---

## 2. Profile cost

Creating profiles in a single core, measured in steps:

| profiles | RSS | database | ms per profile |
|---|---|---|---|
| 1 | 50 MB | 1.6 MB | 21 |
| 25 | 126 MB | 3.4 MB | 19 |
| 50 | 154 MB | 5.2 MB | 20 |
| 100 | 178 MB | 8.9 MB | 20 |
| 200 | 176 MB | 16.3 MB | 22 |
| 1000 (Linux) | 334 MB | 75.8 MB | 19 |

**Findings**

- Memory rises while the Haskell runtime claims its working heap, then **flattens**.
  Between 100 and 1000 profiles, 900 additional profiles cost roughly **24 MB**.
- Marginal cost per profile: **~27 KB RAM, ~75 KB database**.
- Creation time is **constant at ~20 ms** and does not degrade with count.
- For comparison, the CLI approach with one process per profile costs **64 MB each**,
  which makes 1000 profiles (~64 GB) impossible. The embedded core is roughly
  **190x more efficient** at that scale.

---

## 3. Startup and stability

**Cold start with 200 profiles, 27 of them holding real group connections:**

- `startChat()` returns after **42 ms**
- first event after **201 ms**
- subscriptions continue in the background for roughly **60 seconds**
- RSS during that phase: 248 MB rising to 302 MB

**Idle behaviour over 5 minutes:**

```
125s: 328 MB, 822 events    <- subscriptions finish
150s: 328 MB, 822 events
175s: 319 MB                <- memory is reclaimed
300s: 318 MB                <- flat
```

**Findings**

- The core does **not block** on startup. It returns immediately and subscribes
  asynchronously.
- No memory growth once subscriptions are complete. Memory is even reclaimed.
- **Operational consequence:** a bot must not be treated as ready when `startChat()`
  returns. A state model of `starting` → `subscribing` → `ready` is required, otherwise
  the first messages after a restart are served slowly. This was measured directly:
  an attribution test run 8 seconds after start took **10 s** to reach the first
  receiver; the same test on a warm core took **153 ms**.

---

## 4. Message attribution (the multi-bot foundation)

One message sent, then the globally active user was deliberately switched to a
**different** profile before delivery.

```
sent at:                          2026-07-27T10:50:42.556Z
own send confirmed after:         198 ms
first other profile received after: 153 ms
last  other profile received after: 1771 ms
receiving profiles:               26 of 26 (100%)
duplicates:                       none
received by the ACTIVE profile:   1
received by NON-active profiles:  25
```

**Findings**

- Every event carries the **receiving profile's own `userId`**, correctly and without
  duplicates.
- Delivery is **independent of the globally active user**. Switching the active profile
  during delivery changed nothing.
- **Group ids are local to each profile.** The same group appears as `groupId 21` for
  one profile, `groupId 4` for another, `groupId 2` for a third. A group id is
  meaningless without the `userId` it belongs to.

**Important counterpart:** while *delivery* is independent of the active user,
several *commands* are not. `apiListGroups(foreignUserId)` is rejected with
`differentActiveUser`. Outgoing actions must therefore be serialized through
`apiSetActiveUser`, or they will silently run as the wrong profile. In an early test,
three parallel joins per batch produced exactly one success each, because the
`apiSetActiveUser` calls overwrote one another.

---

## 5. Throughput

20 messages from 3 sender profiles into the 27-member group, full fan-out captured
(520 receive events, 100%).

```
send time            median 305 ms | p90 617 ms | max 1509 ms
delivery span        45.0 s after the last send
average receive rate 11.4 events/s
steady-state rate    ~15 events/s  (computed from the interval deltas)
cost per receive     ~65 ms steady state, ~88 ms including ramp-up
```

Interval deltas during delivery, showing the rate rising and then holding:

```
15-20s: 15.4 /s     30-35s: 16.0 /s
20-25s: 12.6 /s     35-40s: 14.8 /s
25-30s: 14.4 /s
```

This is corroborated independently by the attribution test: 26 receivers in
1771 ms is 14.7 events/s.

**Findings**

- A single core sustains roughly **15 incoming message events per second**.
- The rate **does not degrade** under sustained load; it ramps up and holds.
- Sending and receiving contend for the same core. Send latency rose from 93 ms to
  305 ms median while the receive backlog was being worked off. A core should not be
  driven to saturation.
- Reaction send time: **median 161 ms**, p90 483 ms.

---

## 6. Round trip (what a user experiences)

Question asked, a designated other profile waits until it actually receives the
question, then replies with `inReplyTo`, and the asker waits until the answer is
visible.

```
ask -> responder sees it   median 2000 ms | max 2230 ms
responder -> reply sent    median  298 ms | p90 552 ms
FULL ROUND TRIP            median 4432 ms | max 4906 ms
```

**This is an upper bound, not a typical value.** In this setup one core hosts all 27
group members, so every message costs 26 receive events inside that one process. In
production, with one avatar per support group and human members on their own devices,
a core processes **one** receive event per incoming message.

---

## 7. Capacity model

Derived from the measured constants:

```
incoming message processed   ~65 ms of core time
outgoing message to N members ~12 ms per member
core saturates at            ~15 incoming events/s
memory                       not a limiting factor (~300 MB for 200 profiles)
```

For a support deployment with one avatar per group and roughly ten members per group,
one exchange (one incoming message plus one reply) costs on the order of **200 ms** of
core time. That implies **~5 exchanges per second**, or several hundred thousand per
day, on a single core.

**The limiting resource is event throughput, not memory.** Scaling is therefore
achieved by distributing groups across cores, not by shrinking per-profile cost.

**Extrapolation, explicitly marked as such:** one million empty profiles would be
roughly 27 GB of RAM and 75 GB of database. The database size alone is the reason the
SDK offers a PostgreSQL backend (Linux x86_64). This figure is a linear extension of
the measured marginal cost and has **not** been verified at that scale. What has been
verified is 1000 profiles in one core and 27 profiles holding real connections.

---

## 8. Reactions

The core accepts exactly the eight reactions the clients offer. Verified empirically
against a live group, one fresh message per emoji:

```
accepted:  👍 👎 😀 😂 😢 ❤ 🚀 ✅
rejected:  😃 😔 😭 🤣 🎉 ✔ 👏 👌   (commandError)
```

Exact code points matter. `😀 U+1F600` is accepted, the visually similar
`😃 U+1F603` is not. `😢 U+1F622` is accepted, `😔 U+1F614` is not.

### SDK bug found

`ChatApi.apiChatItemReaction` checks the response against `"chatItemsDeleted"` and
throws otherwise. Adding a reaction returns `"chatItemReaction"`, so **every add
throws even though the reaction is applied**. Removing a reaction returns normally.
The asymmetry makes it look like the emoji was rejected.

Compounding it: the thrown `ChatCommandError` carries the successful response on
`.response`, and `.chatError` is `undefined`. Error handlers that inspect
`.chatError`, which is what `ChatAPIError` uses, log an empty error.

Present in **6.5.4** (current `latest`) and **7.0.0-beta.3** (current `beta`).
Already reported upstream as PR
[#7109](https://github.com/simplex-chat/simplex-chat/pull/7109), open at time of writing.

**Workaround:** bypass the wrapper and accept both success shapes.

```ts
const cmd = CC.APIChatItemReaction.cmdString({
  chatRef: {chatType, chatId}, chatItemId, add, reaction,
})
const r = await chat.sendChatCmd(cmd)
if (r.type === "chatItemReaction" || r.type === "chatItemsDeleted") return r
```

---

## 9. Rotation is unnecessary

An early design assumed profiles would have to be activated in waves to stay
reachable. This is **not** required.

`startChat()` subscribes **all** profiles in the database, not only the active one.
`apiSetActiveUser` changes the command context; it does not start or stop
subscriptions. This was confirmed both by reading the core's startup path and by
measurement: 26 non-active profiles received a message while a 27th was the active
one.

---

## 10. Practical notes

- **Own sends are not reliably reported as events.** Outgoing messages must be recorded
  from the return value of `apiSendTextMessage`, not from the event stream. Relying on
  events loses every send.
- **`duplicateGroupMessage` and `SEMsgNotFound "setMsgUserAck"` appear routinely** when
  many profiles in one core forward the same group message to each other. They are the
  core correctly discarding duplicates, not errors in application code.
- **Windows installs 5 native libraries (~132 MB); Linux installs 161 (~230 MB).** The
  addon build needs C++ build tools and Python. In restricted environments `node-gyp`
  may fail fetching Node headers; `--nodedir` pointing at local headers resolves it.
- **`DbConfig` uses `filePrefix` and `encryptionKey`**, producing `<prefix>_chat.db`
  and `<prefix>_agent.db`.

---

## 11. Open questions

- Behaviour beyond 1000 profiles, and with the PostgreSQL backend.
- Cost of a profile that belongs to many groups, rather than one. The limiting factor
  is subscribed queues and connections, and that has not been isolated.
- Throughput on server-grade hardware; all figures above are from a consumer machine
  on a satellite uplink.
- Reconnection behaviour after network loss, as opposed to a clean restart.
