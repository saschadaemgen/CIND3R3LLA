# Correction 1 to Addendum 1

Applies to: `BRIEFING-multi-profile-addendum-1.md`, section 3, the row on recording
outgoing messages.

The audit is right to question it. The claim as written is stronger than the evidence
behind it. This correction states exactly what was observed, what was not established,
and how to settle the question against shipped code.

---

## 1. What the addendum says, and why it overstates

The addendum states:

> The core does not reliably emit a `newChatItems` event for one's own outgoing message.

That is an inference, not an observation. It should have read: recording sends from the
event stream lost every send in one measured scenario, while recording from the return
value of `apiSendTextMessage` was correct in all scenarios. The mechanism was never
established.

---

## 2. What was actually observed

Two runs, same code base, same SDK build (6.5.4), same database, same group.

**Run A, single send.** One message sent. Every event captured for 90 seconds and
filtered by message text. Result: **27 events, of which 1 was `groupSnd`** for the sent
message, and 26 were `groupRcv`. The outgoing event **did** arrive.

**Run B, ten sends.** Five question and answer pairs, each send preceded by
`apiSetActiveUser`. Events captured throughout, plus 15 seconds after the last send.
Sends recorded from events only. Result: **zero sends recorded**, across all profiles,
while six profiles had demonstrably sent. Cross-check confirming the sends really
happened: the five responder profiles each showed 9 received messages where every other
profile showed 10. The missing one in each case is that profile's own message.

Switching to the return value of `apiSendTextMessage` produced the correct counts
immediately: 5 for the asker, 1 for each of the five responders.

---

## 3. The difference between the two runs, and the resulting hypothesis

The material difference is **active user switching**.

Run A sent once while the sender was the active user, and switched afterwards.
Run B called `apiSetActiveUser` immediately before every single send, ten times in
sequence, interleaved with waiting.

**Hypothesis:** the `newChatItems` event for one's own outgoing message is delivered in
the context of the profile that is active at delivery time. If the active user has
already been switched away by then, the event is not attributed to the sender and is
lost to an event-driven recorder.

This is a hypothesis. It has not been isolated, and there are at least two other
candidates that were not eliminated: a race between event delivery and the end of the
observation window, and an emission difference that depends on how quickly consecutive
sends follow one another.

---

## 4. What this means for the shipped single-profile code

If the hypothesis holds, current single-profile behaviour is **not affected**. A single
bot never switches the active user, so the condition that loses the event never occurs.

The consequence is more specific and more awkward than "broken now": event-driven send
recording would be **correct today and break at the moment the multi-profile runtime
lands**, because that runtime introduces active user switching as a normal operation.

That is worth knowing before the migration rather than after it.

---

## 5. How to settle it

The test is small and does not need the multi-profile runtime.

1. Send one message. Capture every event for 60 seconds. Confirm a `groupSnd` event
   arrives carrying the sending profile's `userId`. This reproduces Run A and establishes
   the baseline.
2. Repeat, but call `apiSetActiveUser` to a different profile immediately after the send,
   before the event can arrive. Check whether the `groupSnd` event still arrives, and if
   so, which `userId` it carries.

If step 2 loses the event or attributes it to the wrong profile, the hypothesis holds and
the migration risk is confirmed. If step 2 behaves like step 1, the cause lies elsewhere
and Run B needs re-examining.

Either way the conclusion for implementation is unchanged: **record outgoing messages
from the command return value.** That is correct under both outcomes, costs nothing, and
removes the question from the critical path. The reason to run the test is to know
whether existing event-driven recording elsewhere in the code base needs changing before
the runtime lands, not to decide how the new runtime should record.

---

## 6. Scope

This correction adds no work items. Sections 1, 2, 4, 5, 6 and 7 of the addendum are
unaffected and stand as written.
