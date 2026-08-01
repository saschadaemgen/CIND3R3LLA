# Legal register

Items requiring qualified review before anything leaves alpha. Recorded, not acted upon.

**This is not legal advice.** It is a list of topics a qualified person should look at.
Nothing here is a conclusion, and the technical design keeps each item satisfiable later
without a schema change.

Status of the project: alpha, not a product. No marketing, no promises, no external
users. Everything below is parked until that changes.

---

## 1. Transparency and disclosure

| Item | Note |
|---|---|
| EU AI Act transparency obligations | Applies to systems interacting with natural persons. Open question whether an "obvious from context" exception covers an entertainment NPC whose profile description already states it is automated. Also unclear how it treats a human-operated agent where a person remains accountable. |
| Disclosure across the four actor types | Current design: structured field in the registry, authored line in the profile description, plus TOS, welcome message, and a public user list on the website. Whether that is sufficient per actor type needs review. |
| Positioning statement | The product position is "entertainment and staff assistance", explicitly not "an AI assistant". Worth confirming that the wording used publicly matches what is legally defensible. |

---

## 2. Data protection

| Item | Note |
|---|---|
| Privacy policy (Datenschutzerklärung) | Required. Generators exist and are adequate as a starting point; still needs review for this specific processing. |
| Message history storage | The generator records who was addressed and who replied. In production that is processing of real users' communication data, not synthetic data. This is probably the single most substantive item on this list. |
| AI processing of user messages | Which model, hosted where, what leaves the machine. Local processing and external providers have very different implications. Relevant that the design already separates a local path from an optional external one. |
| Retention and deletion | How long conversation context is kept, and what happens on a deletion request. |
| Synthetic profiles as data | Generated profiles are not personal data, but a generated face that resembles a real person could raise likeness questions. Current design caps AI-generated faces at under 0.1% of profiles. |

---

## 3. Company and site

| Item | Note |
|---|---|
| Imprint (Impressum) | Required for a German commercial site. |
| Terms of service | Referenced by the disclosure design; needs to actually exist and to say what the design assumes it says. |
| Liability disclaimer (Haftungsausschluss) | Particularly for anything an NPC or an assisted agent says. |

---

## 4. Third-party platform

| Item | Note |
|---|---|
| SimpleX acceptable use | Bulk profile creation on someone else's network. A direct relationship with the operator exists, but the position should be explicit rather than assumed, especially at large scale. |
| Test groups vs real groups | Load tests must never run against a group containing real users without explicit consent. Addendum B makes this a hard confirmation in the interface. |

---

## 5. Content and assets

| Item | Note |
|---|---|
| Name data licensing | Provenance of `names_data.json` (36,162 given names, 21,967 surnames) should be documented. |
| Avatar image sources | Whichever generator is used, its licence terms for commercial use. |
| Character definitions | Designed characters are authored content and belong to whoever wrote them. Worth settling if characters are ever shared between deployments. |

---

## 6. Planned, later

| Item | Note |
|---|---|
| Country-specific legal text generator | Intended feature: generate the appropriate privacy policy, disclaimer, and disclosure wording per jurisdiction. Not in scope now. Would itself need review, since generating legal text for others carries its own exposure. |

---

## 7. Standing rule

Anything touching a legal question gets flagged rather than decided. The technical design
consistently keeps the structured fields in place so a stricter requirement can be met
later without reworking the schema, which is the cheapest possible form of insurance
while the answers are unknown.
