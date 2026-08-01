# Addendum B: Configuration layers

Extends `avatar-personality-model-v2.md` and Addendum A.

The model now carries a large number of settings: latent traits and their covariance,
sigma, archetype separation, unclassified share, participation curve, completeness
raggedness, name style mix, bot share, trigger profiles, context depth, disclosure.

All of it is wanted. None of it may be in the way of someone who just wants to fill a
room.

**Principle: simple by default, complete on demand.** Four layers of visibility over one
configuration object.

---

## 1. The one rule that makes this work

**Every layer writes the same `PopulationConfig`.** The wizard is not a separate code
path; it fills the same structure with defaults. Consequences:

- Start in the wizard, open the advanced panels afterwards, lose nothing.
- A preset is just a saved `PopulationConfig`.
- The raw config file and the wizard cannot drift apart, because there is only one shape.
- Anything the wizard cannot express is still reachable one layer down, never blocked.

A second rule follows from it: **every setting displays its default and whether it has
been changed.** Deviations stay visible, so a config that misbehaves can be read at a
glance. This mirrors `overrides[]` on `Personality`.

---

## 2. Layer 1: Wizard

Four questions. Everything else defaulted. This is the path a new user takes and it must
produce a usable result without any further input.

### Question 1: What are you building?

| Answer | Sets |
|---|---|
| Fill a room realistically | sampled personalities, validation on, participation curve realistic, mixed completeness |
| Load test | sampled, validation on, text engine template, activity high, avatars mostly off for speed |
| A specific character | designed character, validation off, opens the character editor |
| Staff-assisted accounts | actor type `human_operated_agent`, automation `assisted`, archetype `professionalSupport`, context depth `deep` |

### Question 2: How many?

Sets `size`. Above roughly 5,000 the text engine is forced to `template` and a note
explains why (cost and rate limits, not capability). Above roughly 100,000 a note points
at the PostgreSQL backend.

### Question 3: Which region?

Sets `originMix` from a short list of presets (German-speaking, Western Europe,
international, single country, custom). Custom opens the full culture weighting.

### Question 4: How lively?

| Answer | Sets |
|---|---|
| Quiet, mostly reading | Zipf exponent steep, `everPostedShare` ~0.10 |
| Normal community | ~0.25, the measured default |
| Very active | flatter curve, ~0.40 |

Everything else takes the defaults in section 5.

---

## 3. Layer 2: Presets

A named, saved `PopulationConfig`. Ships with a starting set, and any configuration can
be saved as a new one.

| Preset | For |
|---|---|
| `smallCommunity` | under 50 members, flat participation curve, high active share |
| `largeCommunity` | hundreds of members, steep curve, most never post |
| `loadTest10k` | 10,000 profiles, template text, avatars off, activity high |
| `supportRoom` | a handful of `human_operated_agent` profiles, deep context |
| `entertainmentRoom` | designed characters plus a sampled population around them |

Presets are data files, editable and shareable, not code.

---

## 4. Layer 3: Panels

Grouped advanced settings, collapsed by default. Each group states what it affects and
what happens if left alone.

| Panel | Contains |
|---|---|
| Personality | archetype mix, sigma, separation, unclassified share, covariance matrix |
| Population | participation curve, completeness, bot share, AI face share |
| Names | style mix, culture weights, blend probability, pattern preferences |
| Content | bio themes and lengths, avatar motifs and styles, text engine |
| Rhythm | activity hours, timing exponent, session patterns, response latency |
| Characters | designed character library, trigger profiles, context depth, disclosure |
| Validation | which tests run, thresholds, what counts as a failure |
| Coherence | the individual coherence rule switches |

Panels never hide a setting behind a decision made in the wizard. A wizard answer
pre-fills; it does not lock.

---

## 5. Layer 4: Raw configuration

The full `PopulationConfig` as an editable file, with schema validation and an inline
diff against the defaults. For people who know exactly what they want, and for version
control.

---

## 6. Defaults

The single most important table in this document, because almost every run will use
these unchanged. All values are the measured or researched defaults from v2.

```
sigma                    0.6
archetypeSeparation      2.0
unclassifiedShare        0.45
participation            zipf, everPostedShare 0.25, top 1% ~70% of messages
completeness             avatar active 0.95, avatar lurker 0.40, bio empty 0.65
botShare                 0.10
aiFaceShare              0.0005
nameStyleMix             pseudonym 0.45, firstName 0.20, fullReal 0.15,
                         mononym 0.08, initials 0.07, fantasy 0.05
textEngine               template
coherenceRules           all on
validation               all tests on
messageLength            log-normal, median 8 words
interEventAlpha          1.5
```

Every one of these is a starting point with a reason behind it, not a guess. The panels
should show that reason on hover, so changing a value is an informed act.

---

## 7. What the wizard must never do

- Never lock a setting that a panel could change.
- Never silently produce a configuration the panels cannot represent.
- Never hide that validation is off. If a choice disables validation, say so on screen.
- Never let a load-test preset be applied to a room containing real users without an
  explicit confirmation.

---

## 8. Open decisions

1. Whether the wizard reappears for every new run, or only for the first one in a
   project. Suggestion: offer it, remember the dismissal per project.
2. Whether presets are per project or global. Global is more useful, per project is
   tidier.
3. Whether the raw configuration layer is exposed in the alpha at all, or only the first
   three layers.
