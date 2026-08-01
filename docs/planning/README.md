# Planning workstream source documents

Historical record, committed under CCB-S4-008. **These are inputs, never authority.**

## What this directory is

The documents here were authored in the operator's parallel planning chats, outside the
CCB briefing scheme and outside this repository. They are the reasoning behind work that
either already landed on `main`, landed on `feature/multi-profile-core-foundation`, or has
not been built at all. Until this commit they existed on one machine with no backup, which
is the exposure this intake removes.

They are committed **as received**, unedited. See the scrub section below.

## The rule: on any divergence, the code and the living documents win

These files are a snapshot of what was believed at the time they were written. Several
statements in them are already out of date, and at least one is contradicted by evidence
gathered afterwards. Where a planning document and the repository disagree, the repository
is right by definition:

1. The code.
2. The six living documents: [`architecture.md`](../architecture.md),
   [`security.md`](../security.md), [`wire-format.md`](../wire-format.md),
   [`feature-backlog.md`](../feature-backlog.md), [`decisions.md`](../decisions.md),
   [`adapter-contract.md`](../adapter-contract.md).
3. Only then these.

Nothing in this directory may be cited as a decision. Decisions live in
[`decisions.md`](../decisions.md) with a `D-<n>` number and a Status. A planning document
that reads like a decision (several are titled that way) records a *proposal*; the entry in
the decision log records what was actually adopted, and it is frequently narrower.

The reconciliation of this package against the code is recorded under CCB-S4-008 and in
D-110. Known divergences found during that pass are listed there rather than annotated into
these files, so the files stay a faithful snapshot.

## The scrub obligation, and what it found

**Anything entering this directory is privacy-scrubbed first.** The repository is public.
No real public IPs, hostnames, secrets or tokens; no real member, group, device or operator
identifiers; no personal filesystem paths or usernames.

For this intake the scrub was run and **no replacement was required**. That is the finding,
not an omission: the package was authored without operator-machine detail in it. What was
checked, across all sixteen files:

| Checked for | Result |
|---|---|
| IPv4 and IPv6 literals | none |
| URLs | one, `github.com/simplex-chat/simplex-chat/pull/7109`, a public upstream PR |
| Email addresses | none |
| Hostnames and domains | none beyond that one URL |
| Usernames, personal filesystem paths, home directories | none |
| Secrets, tokens, API keys, credentials, private keys | none; the only matches are prose *about* credential material in the SimpleX schema |
| Long base64 or hex runs that could be an identifier | none; all matches are filenames and SQL identifiers |
| SimpleX links, `smp://`, `xftp://`, invitation or contact addresses | none |
| Real member, group or device identifiers, display names | none; the schema column names appear, no data does |
| Quoted operator chat messages | none |

Two judgement calls, recorded so they can be revisited:

- **`simplex-core-measurement-report.md` states the test host was a consumer machine on a
  Starlink uplink.** Kept. It is not an identifier, it describes a connection class that
  millions of people use, and it is material to reading the numbers: the report itself
  qualifies its own figures with it. Removing it would damage the technical meaning.
- **The report describes "one real SimpleX group, 27 test profiles".** Kept. No group name,
  link, id or member appears anywhere in it.

Two files referenced by `open-items.md` are **deliberately absent**:
`measurement-results.json` and `message-history.json`. They are the raw probe data behind
the report and the second is described in that document as per-profile message history, so
they are exactly the material this directory must not carry. They stay on the measurement
machine.

## The two probe scripts

`check-group-identity.js` and `scan-group-identity.js` query a SimpleX core SQLite database
to answer whether any field is identical across profiles sharing a group. They already take
the database location as a `--db` argument with the relative default `./db/bench`, so the
intake requirement that a hardcoded local path become a parameter was **already satisfied**
and no change was made. They are committed with their logic unaltered, they open the
database read-only, and they contain no path pointing at any real machine.

They are tooling for a question that is still open. See
`conversation-identity-status.md`, which records what the schema audit settled and what
still needs a query against a populated database.

## Contents

| File | What it is |
|---|---|
| `simplex-core-measurement-report.md` | Measurements of the embedded SimpleX core: profile cost, startup, attribution, throughput, capacity. The evidential basis for the multi-profile design |
| `BRIEFING-multi-profile-core-foundation-merged.md` | The merged briefing that became CCB-S4-004 |
| `BRIEFING-multi-profile-addendum-1-correction-1.md` | Correction: the addendum overstated a claim; what was actually observed |
| `BRIEFING-multi-profile-addendum-1-correction-2.md` | Correction: the group-id claim was inverted, and the reaction asymmetry |
| `BRIEFING-multi-profile-addendum-1-correction-3.md` | Correction: conversation identity, and why not `via_group_link_uri` |
| `conversation-identity-status.md` | What the schema audit settled about conversation identity, and what still blocks archive work |
| `avatar-personality-model-v2.md` | The five-layer personality and population model behind the profile generator |
| `avatar-model-addendum-a.md` | Designed characters, trigger profiles, disclosure |
| `avatar-model-addendum-b.md` | The four configuration layers, wizard to raw |
| `defects-bio-generator.md` | Ten defect classes from reading two hundred generated profiles |
| `decision-model-first-text.md` | The proposal to invert the text engine: model first, template as fallback |
| `decisions-reader-workflow.md` | Three decisions from the multi-reader workflow, including the language restriction |
| `legal-register.md` | Topics requiring qualified review before alpha ends. Not legal advice, and not conclusions |
| `open-items.md` | Everything outstanding at the end of the measurement phase |
| `check-group-identity.js` | Probe: is any field identical across profiles in one group |
| `scan-group-identity.js` | Probe: broader scan of the same question |

## Adding to this directory later

Same two obligations, in order: scrub first, then record what the scrub replaced in this
README. A document that has not been scrubbed does not get committed, and a scrub that
replaced nothing says so explicitly rather than staying silent, so that a later reader can
tell the difference between "checked, clean" and "never checked".
