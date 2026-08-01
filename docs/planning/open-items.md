# Open items

Everything still outstanding, as of the end of the measurement phase.
Nothing here is lost; nothing here is done unless marked.

---

## 1. Ready to hand over

| Item | State |
|---|---|
| `simplex-core-measurement-report.md` | Complete. Goes to the CIND3R3LLA chat. |
| `measurement-results.json` | On the measurement machine. Raw data behind the report. Goes with it. |
| `message-history.json` | Proof that per-profile history works (addressed / replied). |
| `avatar-personality-model-v2.md` | Complete, four open decisions inside. |

---

## 2. Measurement: what was never run

| Item | Why it is open | Needed? |
|---|---|---|
| `latency` phase | Never executed. Largely covered by the attribution test (first receiver 153 ms, all 26 in 1771 ms). | Low priority. |
| `moderate` phase | Cannot run: no bench profile holds moderator or owner rights in the test group. Would need a role granted manually in the app. | Only if avatars should moderate later. |
| Beyond 1000 profiles | Verified: 1000 in one core. Everything above is extrapolation. | Before any claim about six-figure scale. |
| PostgreSQL backend | Never tested. Linux x86_64 only. Relevant above roughly 100k profiles where SQLite becomes the bottleneck. | Before large-scale runs. |
| Profile in **many** groups | We measured one profile in one group. The other chat correctly flagged that cost scales with subscribed queues, not profile count. A profile in 200 groups is the untested case. | This is the real scaling question. |
| Server-grade hardware | All figures come from one consumer machine on a satellite link. | Before quoting capacity to anyone external. |
| Reconnect after network loss | We measured a clean restart. An interrupted connection is a different path. | Before production. |

---

## 3. Upstream

| Item | State |
|---|---|
| Comment on PR #7109 | Drafted, ready to paste. Confirms the reaction bug in 6.5.4 and 7.0.0-beta.3, adds the `.chatError` undefined detail the PR does not mention. **Not confirmed posted.** |
| Reaction workaround | Must stay in our code until #7109 is merged. Applies to CIND3R3LLA too. |

---

## 4. Specification decisions still open

1. **Rhythm-only archetypes**: composable with trait archetypes, or just archetypes with neutral traits. Composable is cleaner, more machinery.
2. **Operator trait profile**: manual entry, questionnaire, or inferred from their messages. Product question for CIND3R3LLA; the generator only needs the input shape.
3. **Model-backed text generation**: in scope for the first build, or deferred. Does not change the structure either way.
4. **Persist or recompute `Personality`**: recommendation is persist, keeping the seed. Avatars will live for months while the configuration evolves; recomputing would shift their personality underneath them.

---

## 5. Legacy from the PowerShell era

| Item | Decision needed |
|---|---|
| `Anastasia.ps1`, `Community-Boost.ps1`, `Rotate-Members.ps1`, `NameGen.ps1`, `Start-Members.ps1`, `Stop-Members.ps1` | Superseded by the embedded-core approach. Retire, or keep as a CLI-based fallback? Rotation in particular solves a problem that does not exist under the SDK. |
| `names_data.json` (603 KB, 36,162 given names across 57 cultures, 21,967 surnames, fantasy pools) | **Must be carried over.** This is the most valuable asset from the old stack. Needs the culture-grammar metadata from the new spec added to it. |
| Avatar motif × style deck | Port to the new stack. The shuffled-deck mechanism that prevents consecutive style repeats is sound and stays. |
| Name sanitisation (strip `.` and `'`) | Must be reimplemented, applied **after** culture-correct generation, only on the SimpleX-facing string. |
| 27 bench profiles in the test group | They accumulate. Decide on a cleanup routine before larger runs, or accept them as permanent members. |

---

## 6. Needed from the CIND3R3LLA briefing before building

| Question | Why it blocks |
|---|---|
| Shape of the bot profile model | `Personality` must map onto it. If a personality concept already exists there, we must not build a second one. |
| Repo layout and where our module sits | Package or subdirectory, module boundaries. |
| TypeScript setup: config, module system, build, lint, test runner | Affects every import. |
| Does our output write into the shared SimpleX database, or do we emit descriptions that CIND3R3LLA executes? | **The most important one.** Decides whether the generator is a writer or a producer of specifications. |
| Division of labour | Avoid duplicating work between the two chats. |
| Naming and commit conventions | Shared repo. |

---

## 7. Build order once the briefing is in

1. **Name generator**, culture-first: culture → name grammar → platform display transform. Ports `names_data.json`, adds culture-grammar metadata, Zipfian popularity, collisions allowed, SimpleX sanitisation last.
2. **Trait sampler**: archetype selection, correlated draw via Cholesky, sigma 0.5–0.7, separation 1.5–2.5, unclassified share 0.45. Small piece of mathematics, roughly sixty lines.
3. **Surface derivation**: latent traits to style, identity and rhythm, with overrides recorded.
4. **Population layer**: participation curve, completeness raggedness, name style mix, bot share.
5. **Validation layer**: the eight statistical tests. Should exist early so everything after it is measured, not assumed.
6. **Bio generator**, template path. Model path optional and separate.
7. **Avatar generation**: motif × style, ported.
8. **Interface**: project and run structure, configuration, presets, seeds.

Validation deliberately sits before the generators it checks, so no generator is ever
built without a way to tell whether its output is realistic.

---

## 8. Dead

| Item | Note |
|---|---|
| Reddit post | Account suspended three times; no reply to appeals. The material goes to PR #7109, a GitHub discussion, or the company site instead. |
| Profile rotation | Solved a problem that does not exist. One core serves all profiles in its database in parallel. Kept here only so the reasoning is not rediscovered later. |
