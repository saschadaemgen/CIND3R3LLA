# Three decisions from the reader workflow

Response to `30736ef`. Two decisions, one new component, and one note on method.

---

## 1. The conditioning gap is ours, and it is the largest thing on the board

> In 82 bios: no proper noun, no year, no place, no employer, no URL. No real set of
> self-written profiles can look like that.

That assessment is right and the diagnosis is right: **it is a conditioning gap, not a phrasing
gap.** Neither engine can produce specifics because the deterministic layer has none to hand
over.

And it is a gap in what this workstream specified. We modelled personality in six dimensions,
derived style from it, and never gave an avatar a **life**. Real bios are made of specifics:

```
Berlin. Backend, mostly. Cats.
Photographer since 2014, mostly analogue.
Cologne / bikes / bad coffee
Third-year physics. Ask me about telescopes.
```

Every one of those carries something concrete, and none of it is expressible from what we
currently produce.

**Decision: a biography layer, as a new component.** Deterministic, drawn like identity is,
biased by personality where that is genuinely defensible and drawn independently where it is
not.

What it needs to hold, at minimum:

| Field | Notes |
|---|---|
| place | city or region, consistent with the origin blend |
| occupation | a field, not necessarily a title |
| tenure | how long at it, in years or a start year |
| a small number of specifics | a camera, an instrument, a distance, a language studied |
| optionally a URL | a small share of profiles carry one |

**Three constraints that matter more than the field list:**

**Most avatars have almost none of it.** The same distribution logic that gives 66 percent
empty bios applies here: a lurker with a complete life story is as wrong as a lurker with a
polished bio. Specifics are drawn sparsely and correlate with activity tier and
conscientiousness.

**Do not derive occupation from personality.** This is the `drawIdentity` rule again, and the
same hazard: deriving a job from traits encodes propositions nobody intends. Conscientious
people are not accountants. Draw it, with at most a weak documented bias where one is
defensible.

**Places follow the origin blend, and this is where the existing corpus gap bites again.** A
German origin needs German cities. That is the same labelled-data problem as the names, and it
should be solved the same way rather than by inventing a parallel mechanism.

This is the highest-leverage open item and it should come before further work on either text
engine. Both engines are limited by the same missing input.

---

## 2. Restrict the model path to German and English

Six of eighteen non-DE/EN bios carried real grammar errors: `horne` for `horneo`,
`je parcoure` for `je parcours`, `cocinador` which is not a word.

And the evidence that it is not a prompt problem is the strongest part: when the recitation gate
tightened, the model rewrote a Spanish bio from a recitation into `"Cursó lenguas"`, third
person preterite where first person present was needed. **The defect moved rather than
disappearing.** That is a capability limit.

**Restrict the model path to `de` and `en`. Other origins fall back to an empty bio.**

Reasoning, in the order it matters:

- An empty bio is realistic and correct. A Spanish bio with a conjugation error is a tell that
  no reader misses. The fallback rule already established for the template path applies here
  unchanged: **silence beats wrong.**
- The alternative, a larger model, is a real option but it is a hardware and cost decision that
  belongs to the platform rather than to this component. Recording the restriction makes that
  decision visible when someone wants to lift it.
- Accepting the errors is not an option. The entire purpose is that the population does not read
  as machine-made.

**Record it as a model-specific limitation, not as a design one.** The restriction is a property
of `qwen3.5:9b` at this size and quantisation. A different model changes it, and the record
should say which model was tested and when, so the restriction is re-examined rather than
inherited.

---

## 3. The two engines fail on different axes, and that decides where each is used

> The model path is caught on a **single line**. The template path is caught only across the
> **whole corpus**.

This is a better statement of the rule than the one already recorded and it should replace it.

| Reader is looking at | Use |
|---|---|
| One profile, in detail | template is caught by nothing; model may be caught by that line |
| A member list | template repetition is visible; model lines are individually fine |
| A load-test population nobody reads | either, and template is cheaper |

The default flips by **what will be looked at**, not by quality in the abstract. That refines the
earlier decision rather than reversing it.

A consequence worth stating: the crowd view from CCB-S4-007 is exactly the reader that catches
the template path, and single-profile inspection is exactly the reader that catches the model
path. **Both views are needed to catch both failure modes**, which is a stronger reason for
having three views than the one I gave when specifying them.

---

## 4. Three escaping bugs in one function, none of which failed a test

`\b` in a template literal as backspace, whole-word matching missing inflection, and `[\p{L}]`
silently becoming a character class of brackets and the letters p and L.

Fifty-three bios passed through an inert gate while the harness reported green. The gate read
correctly, typechecked, and did nothing.

That is the em-dash lesson at a smaller scale and with a sharper edge: **a check that does not
check is worse than no check, because it is read as coverage.** The general defence is the one
that found all three, which is running a validator against real output rather than reading it.

`String.raw` closes the escaping class specifically. What generalises is: **any validator whose
job is to reject should be gated on rejecting.** A test that asserts good input passes says
nothing about whether bad input fails.

---

## 5. On the reader workflow

The fifteen refutations are what make the five findings credible. "Perfectly constructed
tricolon" and "personality stated directly" being overturned, when both describe things people
write constantly, is exactly the false-positive rate a single reading would have carried
silently.

**One of those readers found a real bug in code committed minutes earlier**, by reading the
source rather than the output. That is worth noting as a use of the workflow that was not part
of its design.

The workflow also produced the verdict that neither engine would pass as human, against a
faster reading that said the model output was fine. That correction is the useful kind: it was
too generous, and the multi-reader setup caught it. The same posture applies to my own reading
of the two hundred profiles, which found ten defect classes and would likely have found more
under the same treatment.

---

## 6. Sequence

1. The biography layer. Both engines are limited by the same missing input, and neither improves
   without it.
2. Re-read after it lands, both engines, both views.
3. Only then revisit which engine is default for which use.

Restricting the model path to `de` and `en` and gating the validator on rejection can happen
alongside, since neither depends on the biography layer.
