# Addendum A: Designed characters, triggers, and disclosure

Extends `avatar-personality-model-v2.md`. The v2 document is not edited; this addendum
adds what it could not express.

Origin: the court jester. He appears five times an hour at varying moments, mocks
whatever is happening in the chat, tells a fitting joke, and can be addressed directly
with "tell me another one". He carries little intelligence and controls nothing.

That figure does not fit the v2 model at all, and finding out why exposed two gaps.

---

## 1. Two categories of avatar

v2 assumed every avatar is a **sampled** population member: drawn from distributions,
statistically realistic, validated against real-community signatures. That is right for
load testing and for filling a room.

The jester is the opposite. He is **designed**. He has a role, a shtick, an act. Two
jesters should not differ through random perturbation; they should be identical, because
they are the same figure.

| | Sampled personality | Designed character |
|---|---|---|
| Origin | drawn from distributions around an archetype | authored by hand |
| Purpose | realistic population, load testing | a specific figure with a role |
| Variation | random within bands | none, or explicitly authored variants |
| Validation layer | applies fully | **does not apply** |
| Reuse | each instance is unique | one definition, many deployments |
| Typical actor type | `npc` (population), `human_user` (test) | `npc` (character), `human_operated_agent` |

**Designed characters bypass the validation layer.** This is deliberate and must be
explicit in the code, not an oversight. The jester is not supposed to look like a
plausible random group member. Running the realism tests against him would fail for the
right reasons and tell us nothing.

A designed character still uses the same latent trait vector, but the values are set by
hand rather than sampled. That keeps one representation for both categories, so the
downstream derivation of tone, style and reaction preferences works identically.

---

## 2. Designed character definition

```ts
interface DesignedCharacter {
  id: string
  name: string
  role: string                       // "court jester", "quizmaster", "greeter"

  latent: LatentTraits               // authored, not sampled
  voice: {
    register: string                 // short authored note guiding wording
    signature: string[]              // recurring phrases, verbal tics, optional
    avoid: string[]                  // things this figure never says
  }

  disclosure: DisclosureSpec         // section 4
  capabilities: Capability[]         // what a user can ask it to do
  triggers: TriggerProfile           // section 3
  contextDepth: ContextDepth         // section 5

  variants?: DesignedCharacter[]     // authored variations, not random ones
}
```

`capabilities` is what makes a character usable rather than merely present. For the
jester: `tellJoke`, `commentOnRecent`. For a quizmaster: `startQuiz`, `checkAnswer`.
These are also what the disclosure line should advertise, so the user learns what they
can do with the figure.

---

## 3. Trigger profile

v2 modelled activity as timing distributions: power-law inter-event gaps, circadian
masks, session patterns. That describes a person who happens to be around. It does not
describe a figure that performs.

The jester needs three trigger kinds running side by side.

```ts
interface TriggerProfile {
  scheduled: {
    enabled: boolean
    ratePerHour: number              // jester: 5
    jitter: number                   // 0..1, spread within the hour
    activeHours: HourRange[] | "always"
    minGapMinutes: number            // never twice within this window
  }

  reactive: {
    enabled: boolean
    events: ReactiveEvent[]          // keyword, topic shift, activity spike,
                                     // member joins, long silence
    probability: number              // 0..1, does not fire on every match
    cooldownMinutes: number
  }

  addressed: {
    enabled: boolean
    probability: number              // usually 1.0
    requiresMention: boolean
  }

  budget: {
    maxPerHour: number               // shared ceiling across ALL trigger kinds
    maxPerDay: number
    silenceFloor: number             // do not perform below this room activity
  }
}
```

Three properties matter and none of them exist in v2:

**A shared ceiling.** Scheduled, reactive and addressed triggers must draw from one
budget. Otherwise the jester fires five scheduled times *plus* every reactive match
during a busy hour and becomes a nuisance. The stated "five times an hour" is a ceiling,
not a schedule.

**A silence floor.** Performing to an empty room is the clearest tell of an automated
actor. If the room is quiet, the scheduled trigger is skipped rather than deferred.

**Direct address is exempt from scheduling but not from cooldown.** "Tell me another
one" should work immediately. Twenty in a row should not.

Jester defaults:

```
scheduled:  5/hour, jitter 0.8, min gap 6 min
reactive:   activity spike + keyword, probability 0.3, cooldown 10 min
addressed:  probability 1.0, mention not required
budget:     max 8/hour, max 60/day, silence floor 5 messages/hour
```

---

## 4. Disclosure

**The fact belongs to the registry. The voice belongs to the profile description.**

The registry field is structured and machine-readable, exactly as the phase 1 brief
requires. The profile description carries the same information in the figure's own
register. Both exist; neither weakens the other.

```ts
interface DisclosureSpec {
  isAutomated: boolean
  actorType: ActorType               // npc | human_operated_agent | ...
  line: string                       // authored, in the character's voice
  placement: ("bio" | "welcome" | "onRequest")[]
}
```

### 4.1 Why in-voice beats a badge

A warning banner is written in compliance prose and is dismissed unread. A line in the
character's register is read, because it is part of the character. It is the stronger
disclosure, not the weaker one, and it is the one a user can actually act on because it
also says what the figure is for.

```
bad:   [AUTOMATED ACCOUNT] See Terms of Service 4.2
bad:   I am an AI language model.
bad:   ⚠️ AI-generated content

good:  Hofnarr vom Dienst. Automatisiert, aber mit Haltung.
       Frag mich nach einem Witz, oder lass mich einfach machen.
```

The good version says *automatisiert* within the first five words, stays in role, and
ends with an invitation rather than a warning.

### 4.2 Rules for the authored line

1. State that it is automated in **plain words**, early in the line. Not implied, not in
   a second sentence, not behind a link.
2. Stay in the figure's register. A jester writes like a jester.
3. Say what it can do. Disclosure and invitation in the same breath.
4. Never claim to be a person. Never claim not to be automated.
5. No badge glyphs, no warning styling, no legal reference in the line itself.

### 4.3 Disclosure differs by actor type

A single uniform label would be wrong in roughly half the cases. A human-operated
support agent is **not** an AI, there is a person accountable for it. Saying "I am an
AI" there would be a false statement.

| Actor type | What the line must convey | Example |
|---|---|---|
| `npc` | it is automated, and what it does | "Hofnarr vom Dienst. Automatisiert, aber mit Haltung." |
| `human_operated_agent` | a human is accountable, AI assists | "Support. Antworten kommen von unserem Team, teils KI-gestützt." |
| `human_user` | nothing required | none |
| `system_automation` | it is a service, not a conversation partner | "Systemhinweise. Automatisch, keine Antworten." |

**OPEN, and outside our competence:** EU AI Act transparency obligations for systems
that interact with people may apply here, including whether an "obvious from context"
exception covers a jester. A German company should have this assessed by someone
qualified. Nothing in this document is legal advice, and the design deliberately keeps
the structured disclosure field so a stricter requirement can be satisfied later without
a schema change.

---

## 5. Context depth

"Not much intelligence in it" is a setting, not an aside. A jester glances at the last
few messages and makes a joke. A support agent needs the opposite. Putting both on the
same machinery wastes money on one and starves the other.

```ts
type ContextDepth = "shallow" | "contextual" | "deep"
```

| Depth | Window | Memory | Backend | Fits |
|---|---|---|---|---|
| `shallow` | last 3–10 messages | none | template or small local model | jester, greeter, reaction bots |
| `contextual` | current conversation | session only | local model | quizmaster, guide, game NPC |
| `deep` | long history plus knowledge base | persistent, per user | strongest available | support agents |

This matters for cost at scale. A `shallow` figure can run locally, effectively for
free, and populate hundreds of rooms. Only `deep` figures justify an expensive backend.
Making depth a per-character property means one deployment can mix both.

---

## 6. What this changes in v2

| v2 section | Change |
|---|---|
| 2. Structure | A second entry path: designed characters skip sampling and validation, join at the surface layer. |
| 4.3 Rhythm | Timing distributions stay for sampled personalities. Designed characters use `TriggerProfile` instead. |
| 7. Archetypes | Archetypes remain for sampled personalities only. Designed characters are not archetypes and are not mixed into population weights. |
| 10. Validation | Explicitly skipped for designed characters. The report must state how many avatars were excluded and why, so a skipped test never looks like a passed one. |
| 11. Data shape | `Personality` gains `origin: "sampled" \| "designed"` and an optional `characterId`. |

---

## 7. Open decisions

1. Do designed characters live in the same registry as sampled avatars, or a separate
   character library? A shared registry is simpler; a separate library makes reuse
   across deployments obvious.
2. Should a designed character be allowed **authored** variants (three jesters with
   different verbal tics) while still bypassing random perturbation? Useful for filling
   several rooms without an identical figure in each.
3. Where the disclosure line is authored: alongside the character definition, or in the
   administration interface per deployment. The latter allows per-community tone.
