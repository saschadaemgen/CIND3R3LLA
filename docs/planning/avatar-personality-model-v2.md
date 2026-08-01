# Avatar personality and population model

Specification for the CIND3R3LLA profile generator, revision 2.

Revision 1 modelled an avatar as a bundle of independent sliders. Research on
personality structure and on the composition of real online communities showed that
approach produces statistically detectable fake populations. This revision replaces it.

Status: proposal for review. Open decisions are marked **OPEN**.

---

## 1. What changed from revision 1, and why

| Revision 1 | Problem | Revision 2 |
|---|---|---|
| Nine independent character sliders (tone, verbosity, warmth, humor, emoji, …) | **Distance concentration.** Independently sampled high-dimensional vectors cluster at the centroid: expected pairwise distance grows with √d while its variance stays constant, so every avatar ends up equally average. Also, these are surface effects, not traits. | Latent trait layer (Big Five + Honesty-Humility), sampled **correlated**. Surface style is derived from it. |
| Traits sampled independently | Big Five traits co-vary in real people (meta-analysis, N=144,117). Independent sampling produces impossible personalities. | Multivariate sampling through a covariance matrix (Cholesky), per archetype. |
| Every avatar gets a clean archetype | Only ~42% of real people are classifiable into any personality type. A population where everyone is a clean type is itself a fake signature. | ~40–50% of avatars are drawn from a broad background distribution, belonging to no archetype. |
| `origin` used the same notation for population distribution and within-profile blend | Two different concepts, one notation. Guaranteed to produce wrong results. | Separated: `originMix` (population) vs `originBlend` (within one avatar). |
| Display names strictly unique | Real name popularity is Zipfian. Perfect uniqueness is a detectable artefact. | Uniqueness enforced on the account key only. Display-name collisions occur naturally and are allowed. |
| No population-level layer | Individually plausible profiles, implausible group. Detection research is unambiguous: individual profiles are easy to fake, populations are not (humans classified generated profiles as bots only 18.2% of the time, near chance). | Population layer is first-class: participation curve, completeness raggedness, bot share, archetype mix. |
| No validation | The failure modes are known and measurable. Not measuring them is a choice. | Validation layer runs the known fake-detection tests against our own output. |
| `languageRegister: nonNative` | Simulating non-native speech drifts into caricature and has no empirical support in the sources reviewed. | Removed. Replaced by a neutral `sentenceComplexity` derived from verbosity. |

---

## 2. Structure

```
populationConfig + seed
        |
        v
   latent traits            (Big Five + Honesty-Humility, correlated)
        |
        v
   surface: style / identity / rhythm    (derived, overridable)
        |
        v
   visible profile          (display name, bio, avatar)
        |
        v
   validation               (population-level statistical tests)
```

Three representations:

- `PopulationConfig`, what the operator configures. Distributions, mixes, curves.
- `Personality`, one resolved avatar.
- `PopulationReport`, the validation output for a generated set.

`resolve(seed, populationConfig) -> Personality` stays pure and deterministic.

---

## 3. Layer 1: Latent traits

Six dimensions, stored as z-scores (population mean 0, SD 1).

| Trait | Short | Drives |
|---|---|---|
| Openness | `O` | interests breadth, fantasy name affinity, avatar style adventurousness |
| Conscientiousness | `C` | bio completeness, message structure, response reliability |
| Extraversion | `E` | message frequency, initiative, verbosity, warmth of tone |
| Agreeableness | `A` | warmth, positive reaction preference, reply propensity |
| Neuroticism | `N` | response latency variance, message length variance |
| Honesty-Humility | `H` | good-faith vs manipulative behaviour (reserved for the behaviour layer) |

### 3.1 Correlated sampling

Traits are **not** independent. Sampling procedure per avatar:

1. Pick an archetype according to the population mix, or the background distribution.
2. Draw `z ~ N(0, I)` in six dimensions.
3. Output `traits = mu_archetype + L * z * sigma`, where `L * Lᵀ = Sigma`.

Starting covariance (raw correlations, to be tunable):

```
E-A  = +0.29     N-C  = -0.22     E-O  = +0.20
A-O  = +0.19     N-A  = -0.12     N-E  = -0.11
C-A  = +0.15     C-O  =  0.00
```

Higher-order structure to preserve: C, A and low N form one factor (stability);
O and E form another (plasticity).

**Parameters:**

- `sigma` per dimension: **0.5 to 0.7** by default. Narrower makes archetypes caricatures, wider dissolves them.
- inter-archetype mean separation: **1.5 to 2.5 SD** on the defining traits.

That separation-to-sigma ratio reproduces what real data looks like: density peaks that
are recognisable but not cleanly separable.

### 3.2 The unclassifiable middle

`unclassifiedShare`, default **0.45**. That share of avatars is drawn from a broad
background Gaussian belonging to no archetype. Without it, the population is too tidy
to be real.

---

## 4. Layer 2: Surface

Derived from the latent traits, each overridable. Overrides are recorded.

### 4.1 Style

| Field | Derived from |
|---|---|
| `tone` (formal ↔ casual) | E up, C down, A up |
| `verbosity` | E up, C up |
| `warmth` | A up, E up |
| `humor` | E up, O up, C down |
| `emojiAffinity` | E up, A up, C down. Capped low for formal tone. |
| `reactionWeights` over 👍 👎 😀 😂 😢 ❤ 🚀 ✅ | A and E push 😂 ❤ 🚀; C and low E push ✅ 👍; low A enables 👎 |
| `sentenceComplexity` | verbosity, C |

### 4.2 Identity

| Field | Values | Notes |
|---|---|---|
| `originBlend` | one culture, or a weighted blend **within this avatar** | e.g. `{de: 0.7, es: 0.3}` means this avatar's name mixes German and Spanish, typically first name from one, family name from the other. Distinct from `originMix` in the population config. |
| `ageBand` | `teen`, `youngAdult`, `adult`, `middleAge`, `senior` | |
| `genderPresentation` | `female`, `male`, `neutral`, `unspecified` | |
| `nameType` | `real`, `handle`, `pseudonym`, `mononym`, `initials`, `fantasy` | Extended from revision 1. |
| `namePattern` | culture-dependent | See section 6. |
| `fantasyIntensity` | 0…100 | Only for `fantasy`. Continuous. |
| `nameCase` | `natural`, `lower`, `mixed` | |

### 4.3 Rhythm

| Field | Distribution | Notes |
|---|---|---|
| `activityTier` | drawn from the participation curve | See section 5.1. |
| `interEventAlpha` | power law, default alpha ≈ **1.5** | Human message timing is heavy-tailed, not Poisson. |
| `circadianMask` | per-avatar active hours, timezone from origin | Overlays the power law. |
| `sessionPattern` | `burst`, `steady`, `sporadic` | Bursts separated by long silences, with a gap spike around ~10 hours (sleep). |
| `responseLatency` | log-normal | Fast mode of tens of seconds inside active windows, long tail of hours. |
| `messageLength` | log-normal, median **6–10 words**, mode **16–32 chars**, ~**98% single-line** | Measured across chat platforms. |

---

## 5. Layer 3: Population

Configured once for a run. This layer decides whether the group reads as real.

### 5.1 Participation curve

The 90-9-1 rule is folklore. The robust finding is superuser dominance; the lurker
share varies enormously by community.

Measured anchors:

| Community | Top 1% share of content | Ever posted |
|---|---|---|
| Health forums (63,990 users, 578,349 posts) | **74.7%** | **<25%** |
| Twitter | none | ~25% (lurkers ~75%, **not** 90%) |
| Wikipedia | ~0.003% of users produce ~two-thirds of edits | very low |
| Open source | pattern inverts for personal projects | none |

Therefore: `participationCurve` is a **parameter**, expressed as a Zipf exponent plus
an `everPostedShare`. Defaults: top 1% produce ~70% of messages, 10–25% ever post.
Small private groups (most Discord servers have under 15 members) get a much flatter
curve than broadcast channels.

### 5.2 Completeness raggedness

Real populations are unevenly incomplete. Uniform completeness is a fake signature.

| Field | Default | Source note |
|---|---|---|
| avatar present, active members | ~95% | Engaged humans nearly always replace the default picture. |
| avatar present, lurkers | ~40% | Deliberately much lower. |
| bio empty | **60–75%** | Skewed strongly by activity tier and by C. |
| secondary fields empty | ~70–80% | Measured on comparable platforms. |
| AI-generated face images | **< 0.1%** | Measured share on Twitter was 0.052% of ~15M profiles. If we use AI faces at all, stay under this. |

### 5.3 Name style mix

Platform-dependent. SimpleX has no central identity and no real-name norm, so the
default mix must lean pseudonymous, unlike a Facebook-style population.

| Style | SimpleX default | Reference points |
|---|---|---|
| pseudonym / handle | ~45% | 63% on pseudonym-normed platforms; 40% of general commenters |
| first name only | ~20% | |
| full real name | ~15% | >90% on real-name-normed platforms, so this is deliberately low |
| mononym | ~8% | |
| initials / minimal | ~7% | |
| fantasy | ~5% | |

**Name popularity must be Zipfian, not uniform.** A few very common names, a long rare
tail. Collisions are expected and allowed.

### 5.4 Automated traffic

`botShare`, default **0.10**. A Discord study over 2.05 billion messages found 17% of
messages came from bots. A small automated or announcement fraction **increases**
realism rather than reducing it.

### 5.5 Archetype mix

Weighted mix over the archetype set, plus `unclassifiedShare`. Empirical starting
point from cluster analysis, explicitly one sample's numbers rather than constants:
role model ~27%, self-centered ~23%, reserved ~17%, average the remainder.

---

## 6. Names

### 6.1 Culture-first generation

Sample culture → apply that culture's name grammar → apply the platform display
transform. Never assume a name is two tokens.

| Structure | Cultures | Notes |
|---|---|---|
| given + family | most of Europe, Anglophone | order reverses in Chinese, Japanese, Hungarian |
| given + patronymic + family | East Slavic | patronymic and surname are gendered |
| patronymic only, no family name | Iceland | Jónsdóttir / Stefánsson |
| given + ibn/bint + father | Arabic | |
| mononym | parts of South India, Indonesia, Malaysia | no family name at all |
| double surname | Spanish | paternal + maternal |
| particled surname | Dutch, Spanish, German | "van der Meer" is one surname, and is not title-cased |

### 6.2 Hard rules

- Unicode throughout. Apostrophes and hyphens are legal in names (O'Hara, Jean-Pierre).
- A name-part may contain spaces.
- Never require a family name.
- Capitalisation is not "title-case every word".
- **SimpleX constraint:** display names must not contain `.` or `'`. SimpleX rejects
  them and the client hangs on an interactive prompt. Sanitisation is mandatory, and
  must be applied **after** name generation, so the generator stays culture-correct
  and only the SimpleX-facing string is stripped.
- Uniqueness is enforced on the account key. Display-name collisions are allowed.

---

## 7. Archetypes

An archetype is a named mean-vector over the six latent traits, plus optional biases
on identity and rhythm. Applying one sets everything; each dimension may be overridden.
`Personality` records `archetype` and `overrides[]`.

Archetypes are data in a JSON file, editable without a rebuild.

| Archetype | Latent sketch |
|---|---|
| `average` | moderate everything, slightly high E and N |
| `roleModel` | low N, high on everything else |
| `reserved` | low N, low O, low E, moderate A and C |
| `selfCentered` | high E, low O, low A, low C |
| `enthusiasticNewcomer` | high E, high A, high O, low C |
| `terseExpert` | high C, low E, moderate A, low N |
| `quietLurker` | low E, moderate everything else, minimal activity |
| `professionalSupport` | high C, high A, moderate E, low N, high H |
| `nightOwl` | rhythm bias only, layered on any trait profile |

`professionalSupport` is the production-facing one for CIND3R3LLA support avatars.
`nightOwl` demonstrates that rhythm-only archetypes should be composable with trait
archetypes rather than replacing them.

**OPEN:** whether rhythm-only archetypes are a separate composable category or just
archetypes with neutral traits. Composable is cleaner but more machinery.

---

## 8. The human link

Unchanged from revision 1 in intent, now expressed over latent traits.

| Field | Values |
|---|---|
| `steeredBy` | operator reference, or null |
| `personalitySource` | `own`, `derived`, `hybrid` |
| `derivedTraits` | which of the six latent traits are inherited rather than sampled |

Inheriting at the **latent** level rather than the surface level means the avatar
resembles its operator in disposition while still having its own name, bio and voice.
That is almost certainly the behaviour you want, and it was not expressible in
revision 1.

**OPEN:** where the operator's own trait profile comes from. Manual entry, a short
questionnaire, or inference from their existing messages. Product question for
CIND3R3LLA; the generator only needs the input shape.

---

## 9. Layer 4: Visible profile

| Output | Derived from |
|---|---|
| `displayName` | identity, culture grammar, platform transform |
| `bio` | interests, C (completeness), verbosity, humor, tone, bioTheme |
| `avatar` | interests (motif) × style (from O and humor), or absent |

The motif × style deck from Anastasia stays: a shuffled style deck with no consecutive
repeats. It fixed the "all avatars look alike" problem and the mechanism is sound.

### 9.1 Text generation: two paths, both required

`textEngine`: `template` or `model`.

**`template`** is the default and must work standalone. No external dependency, fast
enough for six-figure runs, fully deterministic from the seed.

**`model`** is optional reinforcement: a language model conditioned on the trait vector
writes the bio. The argument for it is specific and measurable: template text has a
uniform structural signature at scale, which is exactly the kind of aggregate artefact
the validation layer is designed to catch. A model conditioned on traits produces
variety templates cannot reach.

Requirements if the model path is used:

- The template path must remain fully functional. The tool must never depend on a model.
- Local and external backends behind one interface, switchable per run.
- Determinism is weaker on this path. Generated text is cached against the seed so a
  run stays reproducible after the fact.
- Cost and rate limits make this unsuitable for the largest runs. Expect it to be used
  for hundreds or thousands of profiles, not hundreds of thousands.

**OPEN:** whether the model path is in scope for the first build or deferred. It does
not change the structure either way, which is the point of specifying it now.

---

## 10. Layer 5: Validation

New in revision 2, and the part with no equivalent in comparable tools.

The literature on detecting synthetic populations lists the signatures. We test our own
output against them after every run and report failures.

| Test | Expected | Failure means |
|---|---|---|
| pairwise distance histogram over latent traits | wide variance | distances concentrated → avatars are mush, widen sigma or separation |
| clustering recovery | archetypes recoverable as density peaks, **not** cleanly separable | perfectly separable → caricatures, raise `unclassifiedShare` |
| participation distribution | power law, Zipf-shaped | uniform or Gaussian → everyone posts, population is fake |
| inter-event times | heavy-tailed, alpha ≈ 1.5, bursty | Poisson or uniform → classic bot signature |
| message length | log-normal, median 6–10 words | Gaussian or fixed-length → generated text signature |
| completeness by field | ragged, correlated with activity tier | uniform completeness → coordinated-fake signature |
| name popularity | Zipfian, collisions present | perfectly unique → artefact |
| field-pattern similarity | no repeated templates across profiles | template repetition → the classic coordinated-inauthentic tell |

Output is a `PopulationReport` with pass/fail per test and the measured value against
the expected range. **Any distribution that comes out uniform or Gaussian is a bug**,
not a cosmetic issue.

This is also the strongest thing to show externally: not "we generate profiles" but
"we generate populations and demonstrate statistically that they behave like real ones".

---

## 11. Data shape

```ts
interface Personality {
  seed: number
  archetype: string | null          // null = unclassified middle
  overrides: string[]

  latent: {
    openness: number                // z-scores
    conscientiousness: number
    extraversion: number
    agreeableness: number
    neuroticism: number
    honesty: number
  }

  style: {
    tone: number                    // 0..100, derived
    verbosity: number
    warmth: number
    humor: number
    emojiAffinity: number
    sentenceComplexity: number
    reactionWeights: Record<string, number>
  }

  identity: {
    originBlend: Record<string, number>   // within THIS avatar
    ageBand: AgeBand
    genderPresentation: GenderPresentation
    nameType: NameType
    namePattern: string
    fantasyIntensity: number
    nameCase: NameCase
  }

  rhythm: {
    activityTier: "superuser" | "contributor" | "lurker"
    interEventAlpha: number
    circadianMask: HourRange[]
    sessionPattern: SessionPattern
    responseLatency: { median: number; sigma: number }
    messageLength: { median: number; sigma: number }
  }

  link: {
    steeredBy: string | null
    personalitySource: "own" | "derived" | "hybrid"
    derivedTraits: string[]
  }

  profile: {
    displayName: string
    bio: string | null
    avatar: { motif: string; style: string } | null
  }

  isBot: boolean
}
```

```ts
interface PopulationConfig {
  size: number
  seed: number

  archetypeMix: Record<string, number>
  unclassifiedShare: number         // default 0.45
  sigma: number                     // default 0.6
  archetypeSeparation: number       // default 2.0
  covariance: number[][]

  originMix: Record<string, number>       // across the POPULATION
  blendProbability: number                // chance an avatar has a mixed origin
  nameStyleMix: Record<NameType, number>

  participation: { zipfExponent: number; everPostedShare: number }
  completeness: { avatarActive: number; avatarLurker: number; bioEmpty: number }
  botShare: number                  // default 0.10
  aiFaceShare: number               // default 0.0005

  textEngine: "template" | "model"
  coherenceRules: Record<string, boolean>
}
```

---

## 12. Coherence rules

Applied during resolution, each individually switchable. Tests that want deliberate
incoherence turn them off.

| Rule | Effect |
|---|---|
| origin → name pool | names drawn from the culture grammar of `originBlend` |
| interests → avatar motif | motif drawn from interest tags, not the full list |
| latent → style | style fields derived, not sampled |
| tone → emoji ceiling | formal avatars capped low regardless of population setting |
| latent → reaction weights | A and E favour 😂 ❤ 🚀; C and low E favour ✅ 👍 |
| activityTier → completeness | lurkers get empty bios and default avatars far more often |
| C → bio completeness | conscientious avatars fill their profile more |
| ageBand → nameType bias | teens skew to handles, seniors to real names; a bias, not a rule |

**Decision from revision 1, now resolved:** individually switchable, because population
validation needs to isolate the effect of single rules. A single strict/relaxed/off
switch cannot do that.

---

## 13. Open decisions

1. Rhythm-only archetypes composable, or archetypes with neutral traits (section 7).
2. Where an operator's trait profile comes from (section 8).
3. Model-backed text generation in scope for the first build, or deferred (section 9.1).
4. Persist `Personality` per profile, or always recompute from the seed. Recomputing is
   cleaner but breaks when the configuration changes. Given that avatars are expected to
   live for months while the configuration evolves, persisting is the safer choice, with
   the seed retained so any avatar can be traced back.

---

## 14. Sources

The empirical figures above come from a research review covering: Big Five and HEXACO
structure and intercorrelations (meta-analysis, N=144,117); personality type clustering
(Nature Human Behaviour 2018, >1.5M respondents) and its formal critique (~42%
classifiable); distance concentration in high dimensions; participation inequality
(health forums, 63,990 users; Twitter lurker share ~75%; Wikipedia; open source);
profile completeness and pseudonym use (Disqus/NetPop, Pew, bot-detection feature
studies); AI-generated face prevalence (14,989,385 Twitter profile images, 0.052%);
message length distributions (Twitch, mobile chat, Twitter); inter-event timing power
laws (email, SMS, IM); and bot traffic share (Discord, 2.05B messages).

Where sources disagree the range is given rather than a single number. The 90-9-1 rule
in particular is repeated far more often than it is measured, and is treated here as a
tunable parameter rather than a constant.
