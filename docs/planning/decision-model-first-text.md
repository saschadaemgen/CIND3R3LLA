# Invert the text engine: model first, template as a safety net

Decision following the defect report on CCB-S4-006.

---

## 1. The answer, directly

**Yes for anything that is language. No for anything that is structure.**

Every one of the ten defect classes in the read is a template-set problem that a language model
does not have:

| Defect | A model conditioned on the personality |
|---|---|
| `arbeite an kochen` | writes German that is German |
| `Buchbinden-Verteidiger` | does not calque English idiom |
| three clauses naming one hobby | does not repeat itself |
| `Ueber`, `fuer`, `gaertnern` | writes umlauts |
| lower-case German nouns | capitalises them |
| `Zurzeit keine Fragen` as a bio | writes a bio when asked for one |
| register whiplash | holds a register |
| `my lurker opinions` | has no internal enums to leak |

Ten for ten. That is not a close call, and the read is the evidence.

**The line that holds elsewhere:**

| Component | Engine | Why |
|---|---|---|
| Names | deterministic | A model would produce plausible-sounding names with statistically wrong frequencies. Corpus data beats invention. |
| Traits | deterministic | Mathematics. |
| Surface derivation | deterministic | Mathematics. |
| **Bios** | **model** | Language. |
| Avatar images | model | Imagery. |
| Messages, later | model | Language. |

The specification put the bio on the wrong side of that line, with `template` as default and the
model as "optional reinforcement". It is the other way round.

---

## 2. What the deterministic work was actually for

This reframes the past week rather than writing it off.

**The deterministic layer's job was never to write the text. Its job is to decide who the person
is.** Latent traits, archetype, style percentiles, interests, activity tier, culture, name. That
is the conditioning a model needs to write a bio that belongs to a specific person rather than to
nobody.

Without it, a model produces a generic bio. With it, it produces the bio of someone who is
conscientious, reserved, interested in bookbinding, German, and rarely posts. That is the
difference between a text generator and a personality generator, and the deterministic layer is
the part that makes it the second.

The trait work was not wasted by this decision. It becomes the input to it.

---

## 3. What changes about the template path

Keeping a fallback is still right: the tool must not stop working when no model is reachable, and
load testing at scale should not need one.

But its job changes, and it gets much smaller.

**A fallback that produces wrong text is worse than a fallback that produces none.** An empty bio
is realistic; two thirds of real profiles have one. `arbeite an kochen` is a tell. Given the
choice between an incorrect bio and no bio, the correct fallback behaviour is no bio.

So the template path should be:

- **a small pool of plainly correct clauses per language**, authored in that language, no
  translation, no idiom, no register experiments
- **a much higher empty rate**, because the honest fallback for "I cannot write this well" is
  silence
- **the six variety mechanisms retained but constrained**: no em-dash, no lower-case habit for
  languages that capitalise nouns, no separator that a phone keyboard cannot produce
- **no clause that is not a self-description**

That is a fraction of the authoring work in the defect report, and it is work that can actually
be finished. The current attempt to make templates produce good varied prose in two languages is
the part that failed, and it is the part to abandon.

The three mechanical defects still get fixed regardless of engine, because they are in the
composition step rather than the pool: interest repetition, the enum leak, the em-dash.

---

## 4. Determinism survives, by caching

A seed must still reproduce a profile exactly. A model does not guarantee that.

**Generate once, cache against the seed.** After the first generation the profile is
reproducible, which is what the property is for: an avatar that lives for months must not change
its own biography.

The cache is keyed on the seed plus the configuration version plus the model identity, so a
change in any of the three is visible as a change rather than silently producing different text
for the same seed.

This was already in the specification and simply never mattered while the model path was
hypothetical.

---

## 5. Cost, honestly

Local inference on your own hardware makes this cheaper than it sounds, and the numbers are
smaller than they look:

- **Two thirds of profiles have no bio at all.** A hundred thousand profiles is roughly
  thirty-four thousand bios, not a hundred thousand.
- **Load-test populations do not need good bios.** That is the template path's actual use case,
  and at that scale nobody reads them.
- **The populations that need good bios are small.** A support deployment has a handful of
  avatars. A demonstration room has dozens.

So the expensive case and the quality case barely overlap. `textEngine` stays a per-run setting
and the default flips by use case rather than globally.

---

## 6. What this does not change

The model writes **wording**. It does not decide identity, permissions, disclosure, actor type or
anything else. That boundary is already the project's stated principle and it is not weakened by
moving one text field across the line.

Nor does it change the validation approach. A model-written population still has to pass the same
statistical checks against reference data, and it will fail them in different ways than a
template population would. The reading step from CCB-S4-007 becomes more important rather than
less, because model output fails less obviously.

---

## 7. Recommended sequence

1. Fix the three mechanical defects, which are engine-independent.
2. Shrink the template pool to plainly correct clauses and raise its empty rate. Stop trying to
   make it good.
3. Build the model path against the existing personality conditioning.
4. Compare the two by reading, not by statistics.

Step four is the one that settles it, and the read of two hundred profiles is now the established
way to do that.
