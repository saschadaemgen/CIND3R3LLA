# CLAUDE.md — Cinderella standing context

**CIND3R3LLA is the central AI / identity of this system** — the top-level
product, not just a bot. The name is stylised: **CIND3R3LLA**, everywhere it is
displayed, including her wake word. Members may also address her with the plain
spelling `Cinderella`, which the detector accepts as a small typo away from the
stylised form rather than as a declared alias. **This line used to cite
`DEFAULT_WAKE_ALIASES` (D-088); no such thing exists in the code and the grep is
clean across the tree, so the claim was stale and was corrected in CCB-S5-014
(D-172).** There is no alias mechanism: a bot answers to its wake word, which may
be several words, and a partial name is a NICKNAME and earns the retort.
Prose in this repo still says "Cinderella" for readability; that is fine, and it is
not something to go and "fix". The consent-based SimpleX-group-to-web **archive is her
first capability**; later she brings a team of additional agents. Treat
"Cinderella" as the identity, with the archive as one capability under her.

As the archive, she joins a public SimpleX group the operator controls, captures
opted-in members' messages (text/image/video/voice/file/link) into PostgreSQL +
a media tree on disk, and (later season) republishes them as a searchable public
web archive. Standalone — NOT part of CARVILON, CyberDesk, or SimpleGoX.

## The one rule: consent-first

**Nothing a member posts appears on the public archive unless that member opted
in** — by sending `/publish`, or by asking her in plain language and confirming
when she asks back (CCB-S3-002; both routes share one write path, and consent is
always first-person). This is the product's legal backbone. Publication is _derived_
(never a stale flag) from the `consent` table, `sent_at` (forward-only from
opt-in), `deleted`/`group_deleted`, `moderation_state`, and the `consent_gaps` a
hide/restore cycle leaves behind — see the `message_publish_state` /
`published_messages` views. A revocation hides everything at once; the member then
chooses **hide** (retained, restorable by them alone) or **delete** (erased, and an
evidence hold can defer that but never the hiding) — CCB-S3-013.
**And publication being gated was never the same thing as storage being gated** (CCB-S5-054,
D-240). Until retention, everything was KEPT whether anybody opted in or not - 64% of his
archive - and it was found by the operator asking about his own data rather than by anything we
ran. The content of messages from members who have never touched consent AT ALL is now removed
past a bound, leaving a tombstone: *the content is gone, the fact that a message existed is
not*. The SimpleX core's own second copy is bounded from the same page, because a promise kept
in one database and broken in the one beside it is not a promise.

## Non-negotiables (base briefing §1)

- Work on **`main`** only. **Conventional Commits**.
- **Mandatory pre-push grep** for real IPs, secrets, hostnames, device ids, and
  member data. The repo is **public**. Test/config data uses placeholders only.
- **No secrets in source or logs.** Everything sensitive is env (git-ignored
  `.env` in dev; systemd `EnvironmentFile` 0600 in prod). Redact before logging.
- **English** everywhere. Proof-of-concept before integration.
- **Stages define order, not checkpoints.** A briefing split into stages is worked
  through continuously, deploying as you go; do not stop between stages waiting for
  approval unless a stage explicitly says otherwise.
- **A briefing is not delivered until it is confirmed delivered.** Three briefings were
  never received in Season 3 and this was only discovered at close-out. Confirm receipt
  against the register when a briefing arrives, and record the delivering commit against
  its CCB id when it lands.
- **An action in one surface must reach every surface that shows it** (standing rule, D-205).
  Four times in one day the operator was shown a world that no longer existed, and each one cost
  him a round of testing something that could not work: **Clear record** succeeded and the page
  kept rendering the cleared row, so he pressed it again and got a correct refusal that read as a
  broken control; the **room index** resolved four rooms while the page said none; the
  **membership status** called a channel current that had never been joined; and the **bridge's
  channel list** went on offering a channel whose group the Capture page had just cleared, so he
  picked the dead one as a mapping source and waited an hour for posts that could never arrive.
  None of these was a mechanism failing. Every mechanism worked: the clear cleared, the tick
  ticked 1516 times and succeeded, the join command returned success. **What failed was that the
  thing which changed the world did not tell the things that describe it.**
  So when an action changes state, ask **which other surfaces render that state** and reach them
  in the same action: rebuild the index, invalidate the list, delete the paired row. Two specific
  traps, because both of these are what actually happened. **A read model refreshed only at boot
  and on one event is stale by construction** - name every writer, not the one you were thinking
  about. And **a successful action followed by an accurate refusal is indistinguishable from a
  control that does nothing**, so a stale surface does not merely mislead, it makes the working
  fix look broken and invites somebody to "fix" it.
  This is the same failure as reporting against the console instead of the core: a surface is a
  claim about state, never the state, and it is only as true as its last refresh.
- **A key that is local to one profile is not an identity** (standing rule, D-205). The core's
  numeric group id is stable *within* one profile's database and nowhere else: two bots in one
  room hold two different ids, and **a rejoin gives the same room a new one**. Both bit the
  operator in one day - his group moved 4 -> 8 and the channel 7 -> 9 - and every guard built on
  that id inherits the bug, which is why a duplicate-pairing refusal keyed on it would be defeated
  by exactly the rejoin it is meant to survive. `plugins/channel-bridge/origin.ts` already says
  this in full, and the mapping tables were keyed on the local id anyway: **the reasoning was
  written down and the schema did not follow it**. So when something must be identified across
  profiles or across time, derive the key from what the thing IS (a channel's link) rather than
  from what this process happens to call it, and treat a local id as a handle for one session.
- **A deny-list on the consent, capture or membership path fails OPEN, so it must be an
  allow-list** (standing rule, D-201). Three times this season a guard was written as "everything
  except these" and the case that mattered was simply not on the list: the wake-word guard, the
  blocked-literals match, and `membershipIsActive`, which named five of the FIFTEEN
  `GroupMemberStatus` values and therefore reported `unknown` - what a join that never completed
  looks like - as a CURRENT membership. The console told the operator the bot was in a channel it
  had never joined, wrote `joined` into the membership history, and kept saying so for a day while
  he insisted otherwise. He was right.
  A deny-list is a claim to have enumerated every way something can be false, over a vocabulary
  somebody else owns and extends. **State what is ALLOWED and refuse the rest**, so an unknown
  value is refused rather than admitted, and so a vocabulary that grows fails loudly instead of
  silently widening the guard. Where a path genuinely must be permissive - capture fails TOWARDS
  capturing per D-190, because a duplicate is visible and a lost message is gone - that is a
  SECOND predicate with its own name and its own comment, never the same one serving both. The two
  questions "may this keep capturing?" and "is this true?" have safe answers pointing in opposite
  directions, and one predicate cannot answer both.
- **When the documentation is silent, read the client** (standing rule, D-209). It has paid
  twice in two days. Four rounds of probing could not find `direct=off`, and one grep of the
  core's own parser gave the whole grammar including the flag's default; the four member-arrival
  events were settled by reading the Kotlin client rather than guessing a fifth time. The reason
  is structural rather than lucky: `bots/api/COMMANDS.md` and the SDK readme are months old and
  predate channels entirely, while the **clients ship with every release and therefore cannot be
  stale**. They are public under `apps/` (`apps/multiplatform` Kotlin, `apps/ios` Swift), and the
  core's parser is `src/Simplex/Chat/Library/Commands.hs`.
  The rule is not "read more source". It is that **an absent answer in the documentation is not
  evidence of an absent capability**, and a bot surface that does not wrap something says nothing
  about whether the core can do it - `APIPrepareGroup` is in no public bot API and works. Fetch
  the file and grep it; it is minutes, and every time it has been skipped the alternative was
  days. Two questions are open there right now: how visible the member support thread is to a
  member, and where the client renders `peerType` and why the operator sees it only in a direct
  chat.
  **AND THE SECOND QUESTION, WHICH THE FIRST ONE DOES NOT ASK (D-235).** "Would you show this
  page to a customer?" is about whether it is PRESENTABLE. It says nothing about whether the
  customer could USE it, and a page can pass the first test cleanly while failing the second.
  The Bridge page stated "In the community activity stream: not shown" and then sent the
  operator to Interaction, Archiving to change it. The sentence was true, the badge was
  accurate, the control it pointed at worked, and he read the whole thing as the feature being
  unavailable and hunted for it before asking. Nothing was broken and the page was still wrong.
  So ask BOTH: would you show this to a customer, and **could a customer do the thing this page
  is for without already knowing where everything else lives?** Two rules follow from it, and
  both are concrete enough to check. **A page that names a setting it does not hold must link
  to the page that does** - and a link is the floor, not the answer; if the decision belongs
  here, the control belongs here. **A page that describes a state must say how to change it, in
  a way you can click.** A badge with no verb beside it reads as a report on something you do
  not control, which is the same shape as a surface telling somebody what they cannot do.

  **AND THE OTHER HALF, WHICH COST THREE ROUNDS IN ONE WEEK: the source is the authority on what
  a capability IS, and only the RUNNING APP is the authority on what it DOES.** The client
  imports `AnimatedImageDrawable`, has a `SimpleAndAnimatedImageView` with per-platform
  implementations, and carries a comment saying WebP is left uncompressed on send *because it
  can be animated* - so animation is plainly supported in the source. It does not happen. A
  40-frame GIF with its extension intact, sent from the operator's own app AND from the bot's
  own path, renders as a still both times. The same gap appeared with `peerType`, which every
  type defines and no client was ever watched displaying, and with the voice player, which
  accepted an MP3 the source never promised.
  So a grep answers "can this be expressed" and settles an argument about the API. It does not
  answer "does this work", and reporting the first as though it were the second is how three
  findings this week were confidently wrong. When the question is what a MEMBER will see, the
  only instrument is a member's app, and the operator is the one holding it.
- **Before a page is reported done: open it, screenshot it, and LOOK at it** (standing rule,
  D-212). This is the gap between D-178 and D-199, and it is not "look harder". D-178 says a
  control is verified when it has been OPERATED, and that has been happening. This is a
  different question: is the page PRESENTABLE. Are the controls aligned, does every one say what
  it acts on, is the copy TRUE, and does anything look dropped in beside something else.
  **The test is one question, answered honestly in the report: would you show this page to a
  customer?** If no, it is not done, and fixing it is part of the work rather than a follow-up.
  Every check in this repository asserts BEHAVIOUR, and behaviour is not what the operator sees
  first. A page can pass every assertion, be operated successfully in a browser, and still be
  mislabelled, unaligned and unusable - all three shipped in one week, and all three were found
  by the operator opening a page rather than by anything we ran. The tooling was never missing:
  pages were being opened, spacing measured, controls pressed. What was missing was doing it
  UNPROMPTED and judging appearance rather than function.
  **The same applies to copy, which is the half most easily skipped.** Operating a control
  proves it works; it proves nothing about whether the words beside it are true. `/welcome`'s
  scope statement was false while the control it described worked perfectly, and the operator
  set one bot's greeting believing it was shared. Read what a page SAYS, not only what it does.
  **And look at the page the OPERATOR will get - rebuilt and reloaded - not at whatever the
  preview last compiled.** This rule failed on its first use exactly there: the copy fix had
  been written and pushed, the preview was serving the build from before it, and the page on
  screen still carried the old words. Reporting from that would have claimed a change nobody
  had seen render. A stale preview makes "I looked" FALSE IN A WAY THAT FEELS TRUE, which is
  worse than not looking, because not looking is at least known to the person doing it.
  **HOW TO LOOK, because a rule requiring a look is worth nothing if the next session cannot
  work out how.** The in-app Browser pane's screenshot fails when the pane is not displayed
  (`the page is not compositing frames`), which is a state the model cannot change. Headless
  Chrome needs no pane and works. The console needs a session, so mint one with a PERSISTENT
  profile and reuse it: run `scripts/admin-preview.ts` (port 8788), then two Chrome
  invocations sharing one `--user-data-dir` - first `/preview-login`, then the page:
  `chrome.exe --headless=new --disable-gpu --no-first-run --user-data-dir=/tmp/shot/prof
  --virtual-time-budget=5000 --screenshot=/tmp/shot/page.png --window-size=1440,1400 <url>` -
  and READ the png. `npm run build` FIRST or the screenshot shows the previous build, which is
  the trap above; and give `--window-size` more height than the page so a fold does not hide
  the half most worth judging.
- **Nothing reaches the public repository until it has been demonstrated to work** (standing rule,
  D-199). The repository is the operator's shop window, and a commit that claims a capability it
  does not have reads as not knowing what we are doing. This was established after two pushes in
  two days that described unproven work as delivered: the channel join, pushed as "channel join
  built" when it creates an ordinary group rather than a channel and no subscriber ever appears;
  and the expiry check the day before. Both were green on every check, which is precisely the
  problem - **a passing harness is not a demonstration**, and neither is a command the core
  ACCEPTS. The join returned `startedConnectionToGroup` and set `use_relays = 0`.
  So: **probe locally, prove locally, push what was proven.** Exploratory work belongs on
  throwaway cores and databases and is never pushed at all, which is the one thing that went
  right. Where something genuinely must land half-finished, that is fine and it is SAID: the
  commit message and the register row state what is unproven, in those words, rather than
  describing it as delivered. And when a claim turns out to be wrong, it is corrected IN PLACE
  per D-191/D-193 so the mistake stays legible, never edited away.
- **Surface failures, never swallow them** (standing rule, CCB-S3-023). A caught error
  must not be converted into a value that reads as a legitimate result (masking), and a
  degraded/absent function must not run silently. Log with actionable context (operation,
  input, error); for anything on the **consent, capture, publication, media or plugin
  path** that loses a guarantee, also call `status.error` so it reaches the admin
  dashboard, not only a log file. Distinguish **"not configured"** (a choice) from
  **"configured but failing"** (a fault). A fallback that can mask a fault is counted and
  the count shown in the admin. Do not add noise: alert on real faults, not normal states.
- **A new source tree does not inherit the existing checks; their scopes are reviewed**
  (standing rule, D-105). A check written before a subtree existed does not cover that
  subtree, and **nothing announces it**: the rule held, the check ran, the check was green,
  and the output violated the rule. That is exactly how an em-dash reached generated member
  facing text while `verify:no-dashes` passed, because it scanned the bot's own copy and
  the generator did not exist when it was written. Every standing check has the same
  exposure to every directory added after it. So when a source tree is added, walk the
  standing checks and decide **per check** whether it now applies, rather than assuming the
  green run means covered.
- **Rendering a page is not verifying it** (standing rule, D-178). Four defects in one week worked
  in the local admin preview and failed on the host, and THREE of them were not preview
  limitations at all: the preview could have shown every one, and would have, if the control had
  been operated instead of the markup read. The sharpest case was reproducible in the preview in
  one expression - the upload form carried a script's hook, `[...document.scripts]` did not
  contain that script, the submit button was live because nothing had disabled it, and a real
  file left the field at zero bytes. "Verified in the browser" had meant FETCHED in the browser.
  So a control is verified when it has been **operated and its effect observed**: the click made,
  the file chosen, the form submitted, the state read back. Nothing less may be reported as
  verified, whatever it was done in. And four things the preview genuinely cannot show must be
  driven on the host first: database privileges and extensions (PGlite is a superuser, which hid
  the pgvector failure), pool semantics (PGlite is one connection, which hid a non-transaction),
  the SimpleX core, and nginx with its body limits. The preview now starts with cold caches, runs
  the queue, and cannot lose a script from `assets/`.
- **A control that a check can drive is not a control an operator can use** (standing rule,
  D-162). Every harness here drives routes and reads markup, and none of them can see that a
  rendered control is invisible, unreachable or inert. The avatar Upload button had correct
  markup, correct client wiring, a correct route, honest server errors and a green
  `verify:bot-avatar`, and it did nothing when clicked, because the console had no `:disabled`
  styling and the button was disabled: it rendered at full brightness with `cursor: pointer` and
  swallowed the click in silence. The operator found it in one click. So when a briefing adds or
  moves an operator control, **open it in a browser and press it**, and treat the check that
  follows as the regression guard it is rather than as the evidence it is not. The same applies
  to copy: a label is only correct against what the code does *today*, which is the other half
  of this defect and the reason `selected_for_runtime` lied for seven briefings.
- **An explicit user id is not an exemption from the scheduler** (standing rule, D-171). This
  file's own architecture notes said `apiListGroups` "takes an EXPLICIT user id, so it needs no
  scheduler: it is one of the few commands that cannot be misrouted". The core does the
  opposite: it CHECKS the id against the active user and refuses with `differentActiveUser`.
  Naming a user makes a command refusable, not unmisroutable. Every SimpleX command goes
  through `ActiveUserScheduler`, whatever it carries. The sentence appeared three times and
  produced three bare call sites, so **correct the reasoning and not only the code**: reasoning
  is what propagates.
- **A bar that lives only in a prompt is not a bar** (standing rule, D-183). This has now been
  established twice in two days and produced six routing collisions across the season. An intent
  whose explicitness requirement is written into the model's own description will be claimed for
  things it cannot serve, and the seam will honour the claim, because the only thing the seam
  validates is the catalog. The archive got its deterministic predicate in CCB-S5-027; LOOKUP
  kept a sentence in a prompt and produced the worst defect of the season a day later. **When a
  lane states a bar, the bar is a predicate over the text or it does not exist.** The same
  applies to what a rule tells her about honesty: three new constitutional rules reduced invented
  provenance from most runs to four in six, which is a real improvement and is not a guarantee,
  so the thing that holds must always be the deterministic half.
  **And check the comment above the list**: the one over the LOOKUP phrases asserted an invariant
  the list already violated and named a check that did not exist.
- **A constant measured on one machine is a guess about every other one** (standing rule, D-184).
  The lookup announcement needed to know how long a reply takes to write, so the first build
  measured it and shipped the number. Measured properly afterwards, with the transport's OWN
  request shape, the two models this repository ships defaults for were **three times apart**
  (`qwen3:32b` ~138 characters a second, `qwen3.5:9b` ~414), and the operator's own production
  figure matched neither, because production is different hardware again. The constant would
  have announced a one second wait on one deployment and sat silently through a sixteen second
  one on another, and every check would have stayed green, because the checks would have been
  written against the constant. **A number that describes the environment is read from the
  environment**, and here it cost one integer on a meter that was already recording the times.
  The same question applies to any figure taken on the development box: latency, throughput,
  model behaviour, VRAM. Measure it where it runs, or carry it as a fallback that the running
  system replaces.
- **A dead detector and a clean repository look exactly the same** (standing rule, D-184).
  Three safety patterns in this tree held a `U+0008` BACKSPACE where a word boundary was meant,
  written by a shell heredoc that turns the two characters into one byte, invisible in every
  terminal. Two of them ARE the CCB-S3-031 guarantee that consent copy never claims destruction
  over retained content; the third carries a comment saying a match "is worth failing over".
  None could ever match, all three passed for their whole lives, and the same byte had already
  done the same thing once in CCB-S4-015. `verify:searchable` looked only for NUL, which blinds
  grep LOUDLY; this byte kills a pattern QUIETLY, which is worse, and it now scans every control
  byte outside tab, newline and carriage return. Two lessons beyond the byte. **A negative
  assertion needs a positive control**, or it is indistinguishable from a broken one, which is
  why every repaired detector here is now driven against text that must trip it. And **a check
  that never ran never had its LOGIC reviewed either**: repairing the consent regex turned
  `verify:interaction` red on copy that was CORRECT, and per D-111 the verifier was fixed and
  the strings were left alone.
- **Anything the application appends to her words becomes, through memory, an example of how
  she writes** (standing rule, D-180). She produced a forged knowledge-base source line in
  production, in the application's own format, naming a document the real line one row below it
  did not name. Nobody instructed her to write one. She has conversation memory, memory is the
  whole thread INCLUDING her own replies as they were SENT, and the application appends the
  source line AFTER she writes, so what she reads back an hour later is her prose with an
  attribution attached to it. Twenty of those and the format is simply how her answers look.
  Every application-owned line has this shape: the moderation warning with its count, the
  sanction announcement, every persona line whose placeholders the application fills. So when
  something is appended to her output, ask what it teaches, and keep it out of what she is shown
  next time. **A rule in the registry is not the answer to this**, and there already was one:
  she is told not to write a source line, and she wrote one anyway, because an instruction
  competes with an example and the example was hers.
- **A green `npm audit` describes the LOCKFILE, not what executes** (standing rule, D-174).
  `npm audit fix` rewrote the lockfile from the vulnerable js-yaml to the patched one and **did
  not install it**; the next audit read the lockfile and printed `found 0 vulnerabilities` while
  the vulnerable resolver was still the code on disk. The tool that reports the fix and the tool
  that applies it are one command, they can disagree, and the disagreement resolves in favour of
  "you are safe". `npm ci` also errors out AFTER it starts removing packages, so a locked file
  (`esbuild.exe`, a sharp DLL, anything a stray dev server holds) leaves the tree old, empty or
  partial with the audit still green. So read the installed version separately -
  `node -e "console.log(require('./node_modules/<pkg>/package.json').version)"` - and for anything
  that matters read the patched code rather than the version number.
  **And establish reachability before urgency**: a runtime dependency, a build-time dependency,
  and a build-time dependency with no reachable call site wear the same severity badge and are
  three different facts. The first two questions are `npm ls <pkg> --omit=dev` and "does anything
  here call it". When something moves, check every call site of what moved, which is the
  season-4 sharp-bump precedent.
- **A validation rule that fails to compile fails OPEN, and silently** (standing rule, D-164).
  The slug's `pattern` attribute contained an unescaped `-` in a character class. Browsers
  compile `pattern` in regex `v` mode, where that is a syntax error, so it threw on every
  validation and the constraint was dropped: an input holding `NOT a slug!!` reported itself
  VALID for the field's entire life, and nothing said so because the server was catching what
  the browser let through. Anything that compiles a rule at runtime, from any source, has this
  shape. `verify:bot-creation-form` sweeps every pattern the console serves; the same question
  should be asked of any future rule text that a browser or an engine compiles.
- **When the implementation and a verifier disagree, inspect the rendered output and the
  current source before changing behaviour** (standing rule, D-111, from the local AI
  protocol). Several failures in that work were **verifier defects, not implementation
  defects**: desktop and mobile markup counted together, HTML escaping expected as
  unescaped text, nested HTML truncated by a regex, whitespace-sensitive exact matching, a
  check still asserting a pre-rename title. Every one of them would have been "fixed" by
  changing working code to satisfy a broken test. The check is cheap and the damage is not:
  look at what the code actually renders, and at what the test actually asserts, before
  touching either.
- **Read production state before retrying a deployment that may already have succeeded**
  (standing rule, D-111, same source). Ordinary `git push` output and a transient `curl`
  reset both read like failures and are not. A blind retry of a deployment that already
  landed is how a working production host gets disturbed for no reason. Check the service,
  the health endpoint and the deployed revision first, then decide.
- **No em-dashes in member-facing output** (standing rule, CCB-S3-021). The em-dash
  (`—`), en-dash (`–`), and horizontal bar (`―`) must never appear in any string a
  member can read, in any language: persona strings, locale files, the help and
  welcome copy, retorts, plugin replies, and any admin copy that reaches a member.
  Use a normal hyphen, a comma, or restructure. Enforced by `verify:no-dashes`,
  which also scans the whole plugins tree so new copy is caught automatically.

  **Scope, settled under CCB-S3-043 so it stops resurfacing: OUTPUT ONLY.** The rule
  covers what a member or a visitor can read. It does **not** cover prose in this
  repository: `NOTICE`, `README.md`, the six living documents, the season protocols
  and the register may all use em-dashes freely, and they do. `verify:no-dashes` is
  therefore **correct as it stands** and is not under-scoped; a repository-wide sweep
  would rewrite roughly half a megabyte of documentation to satisfy a typographic
  preference no member will ever encounter. If a document ever starts being served to
  members, it moves into scope on that day and not before.

## Architecture (decided — do not re-litigate)

- **One process** (Addendum 1 A2): the `simplex-chat` npm SDK (6.5.4) embeds the
  Haskell chat core **in-process** (native addon) alongside the Fastify admin
  console. There is **no separate daemon and no exposed SimpleX port** — the old
  WebSocket-daemon model was the deprecated ≤0.3.x line. The sensitive surface is
  the on-disk SimpleX DB, protected by filesystem perms.
- **Two logical DBs, kept separate:** (1) the SimpleX core's own SQLite state
  under `state/`; (2) Cinderella's **archive** PostgreSQL (messages, links,
  consent, settings, audit, embeds).
- **Media on disk** (`MEDIA_ROOT`); the DB stores the path, never the bytes.
  **Originals are ENCRYPTED at rest** (AES-256-GCM under a dedicated `MEDIA_SECRET`,
  D-075); the stripped public derivative stays plaintext. Every reader of an original
  goes through `src/media/at-rest.ts`. Rotating `MEDIA_SECRET` destroys the archive:
  there is no key history, and it must be backed up separately from the media.
  **Quarantined media is MOVED to `QUARANTINE_ROOT`**, outside `MEDIA_ROOT` and served
  by nothing; the admin console addresses media by message id (`/media/msg/:id`), never
  by path, and the raw static mount over the media tree is gone (CCB-S3-013 §4, D-074).
  The config loader refuses to start if the two roots are nested.
- **Search:** Postgres FTS (generated `tsvector` + GIN) + a `links` table.
- **Admin console** is hostile-facing: Fastify on 127.0.0.1, public nginx TLS in
  front at the admin hostname. **Passkeys (WebAuthn) are the primary auth**
  (native `@simplewebauthn`), with an admin-toggleable Argon2id break-glass path
  (+ optional TOTP). Signed HttpOnly/Secure/SameSite=Strict session; CSRF on all
  mutations; every A4.5 hardening control (session/step-up/rate-limit/IP/CSP/
  headers/attestation/alerting) is configured on the **Security** page, persisted
  in `settings`, audited. `trustProxy` pinned to `loopback`. Responsive (A5).

## Layout

- `src/` — `config.ts`, `log.ts`, `adapter/` (the chat seam: Cinderella's own domain
  types, the `ChatAdapter` interface, and an in-memory fake; D-078),
  `bot/` (**the SimpleX adapter, and the ONLY place that may import `simplex-chat`** -
  enforced by `verify:adapter-seam`; core wiring, files, connect, avatar, parsing),
  `capture/` (parse, media, links, persist, her own sends), `consent/`,
  `archive/` (whether her own messages publish, name redaction, destruction, the
  deferred-destruction sweeper, and `retention.ts`, **which stops keeping what nobody agreed
  to** (CCB-S5-054, D-240): the allow-list predicate, the tombstone that clears content and
  keeps the skeleton, and the hourly pass. The sentence to repeat is *the content is gone, the
  fact that a message existed is not*. Nothing here can move the published set, and that is
  STRUCTURAL rather than careful: `message_publish_state` reads none of the columns the sweep
  clears, and opt-in is forward-only, so every swept row sits on the unreachable side of every
  opt-in that has not happened yet. The core's own copy is the SECOND half of the same promise
  and is set from the same page, `/_ttl <userId> <seconds>` through the scheduler),
  `media/` (metadata detection and stripping, video matchers),
  `interaction/`
  (wake word, intent resolver, dialogue engine, persona, help, `personality.ts`: the
  base character, her origin, the five 1-10 dials and the given identity, pure, with the
  calibrated references (D-133, D-135). The base character is how she SOUNDS and the origin
  is what she IS and where she came from, carried into the prompt as background she may draw
  on but must never recite or raise unprompted (D-138).
  **The RULES she is given are not in the code at all** (D-144): every sentence the model
  reads is a row in `cinderella_prompt_rules`, seeded by migration 035, assembled by
  `prompt-rules.ts` (pure: lanes, the seventeen fixed conditions, placeholder rendering),
  loaded by `db/prompt-rules.ts` and cached by `prompt-rule-service.ts`. **The migration is
  the only authored copy and there is deliberately no fallback in code**, because a fallback
  is a second source; an unreadable registry makes her fall back to the deterministic reply
  rather than word one with no rules. The rules are EDITABLE from the console since
  CCB-S4-043 (the Book of Elii, D-146): `prompt-book.ts` is the pure reading model,
  `web/views/book-of-elii.ts` the three pages, migration 037 the history. Text, enabled and
  order only, never tier, lane or condition, because those are contracts the assembler
  implements in code. The boundary that decides what is a rule: a rule is a
  sentence whose text does not depend on a setting, so the dial bands and calibrated
  references stay personality data and the permissiveness ceiling moved.
  **She may QUOTE some of them since CCB-S4-045/046** (D-148): `disclosure.ts` is the pure
  model, migration 039 the `nameable` flag. The flag says what the application offers her,
  never what she can see, so the boundary is two deterministic gates in `disclosure.ts` that
  answer before the model is asked. Rules are handed over as ROWS and rendered through
  `renderPromptRule`, or a member is quoted the literal `{{name}}`.
  **She can TELL it since CCB-S4-047** (D-149): `recital.ts` is the pure plan (chapters, beats,
  bounds, what may never be recited), `recital-runner.ts` sends one beat and books the next,
  `recital-service.ts` joins it to the queue and the transport, `bot/recital-port.ts` sends by
  group id because beat two arrives minutes after the message object is gone, and
  `web/views/recital.ts` is the console. The dramaturgy is AUTHORED and the voice is hers: the
  model is handed a chapter title and never a rule, so a model failure costs the flourish and
  never the chapter. A recital has its OWN allowance rather than N replies, which was a
  correction: charged against the reply budget it could never start, and every check stayed
  green.
  **Asked for the BOOK by name she plays a SCENE since CCB-S5-005** (D-159): `book-scene.ts` is
  the pure model (the two briefs, the one law, the fabricated-law gate, the bounds) and
  `recital-service.ts`'s `tellBookScene` sends it as ONE message. It replaced CCB-S4-050's
  three-beat story, which was the third answer the operator rejected for volume. **The one-law
  bound is structural**: the scene holds one rule rather than an array, and neither brief
  contains any rule text, so quoting a second is not something the model can do wrong.
  `law-numbers.ts` gives every law she may name a stable page number, derived from the registry
  by id rather than stored, over the NAMEABLE set only, because numbering the withheld ones lets
  a member read their subject off their neighbours. **The application prints the page and she
  never states the number**, measured: handed a law and its number, `qwen3:32b` put the number on
  a different law,
  and `conversation-log.ts`: the content-free record of what the conversational path
  did, shown on the Diagnostics page.
  **`protected-text.ts` is the pure model of the lines the APPLICATION writes and she may not**
  (CCB-S5-027, D-180): the protected set is DERIVED, a persona line is protected when its
  template carries a placeholder the application fills, and the marker is the literal run in
  front of the first one. Used three times over one predicate: the raw completion is stripped in
  `generateOllamaReply` before every other guard, history is stripped before it reaches the
  prompt, and `knowledgePassages` carries text with no document NAME to cite. `forgery-log.ts`
  counts every strip for the Diagnostics page, because stripping is a fallback that hides a
  fault by design.
  **`blocked-name-log.ts` is the same shape for the guard that goes the other way** (CCB-S5-031,
  D-186): `blockedLiterals` catches a reply containing the speaking member's display name, which
  used to be a bare substring test, so a member called `In` or `Al` lost every answer she wrote to
  an ordinary preposition and the only trace was a `log.debug`. It is a whole-word Unicode match
  with a four-character floor, and every catch is counted with the matched name, an excerpt, and
  what it cost. **Strip-versus-reject was decided by that count under D-227**: a true match is
  STRIPPED now (vocative removed, inline mention turned second person) and the answer ships with
  cost `stripped`; rejection remains the fallback for a strip that leaves nothing or fails to
  remove the name.
  **`invented-refusal-log.ts` is the third of the family** (D-226): `capability-claims.ts`
  strips a first-person refusal of a capability THIS bot holds - "I won't look it up for you"
  with the lookup enabled - judged deterministically against the per-bot catalog, the
  membershipIsActive treatment of what had become the season's fourth deny-list. The claimable
  vocabulary is a Record over the intent union, so a new intent fails to COMPILE until it is
  placed or excluded with a reason; the consent intents are excluded because a refusal there is
  the product speaking), `plugins/` (plugin
  registry + the Crypto Prices plugin: providers, pinning, cache; the Web Search plugin; and
  `scope.ts`, **the inventory of which plugin setting belongs to one bot and which to the
  deployment** (CCB-S5-021, D-175). The per-bot settings are the `enabled` switches, one per
  plugin (**eight**: crypto prices, web search, knowledge base, channel bridge, welcome, capture,
  music, music-uploads
  - and this number keeps going stale, because a new plugin adds one and nothing points at
  this line. It said "exactly two" until CCB-S5-032, "three" until the knowledge base, "four"
  until welcome and capture, and was corrected again under CCB-S5-043. The count that cannot
  drift is `grep -c "key: ENABLED_KEY" src/plugins/scope.ts`, and `verify:plugin-scope` already
  asserts every registered plugin is placed, so the check is the authority and this is a
  convenience); everything else is deployment-wide: the credential, the
  upstream quota, the cache, the untrusted-text ceilings and the bridge's storage bound. The
  catalog a bot can be asked for is built per bot by
  `capabilitiesFor` and carried in `IntentContext`, where it is REQUIRED: it was module state
  in `intent.ts`, which is one catalog for the process and therefore one set of capabilities
  for every hosted bot. A cache miss fails CLOSED, unlike the interaction settings, because a
  capability answered from the shared states is a bot doing what the operator forbade it),
  `price/`
  (amount parsing + number formatting). **`plugins/web-search/relevance.ts` is the measured
  floor** (CCB-S5-028, D-183): pure cosine scoring of every result against the question with the
  same embedder the knowledge base uses, floored at 0.70, which was MEASURED by
  `npm run calibrate:search-relevance` because the knowledge base's 0.55 would have admitted the
  two pages that caused the briefing. Below the bar nothing reaches the model and the reply is
  the application's; an embedder that cannot answer fails CLOSED.
  **`plugins/channel-bridge/` is the channel bridge** (CCB-S5-032, D-187): a channel post
  becomes a standing announcement brought into a group on a cadence, per bot. A channel
  surfaces as a group whose items carry direction `channelRcv` WITH NO MEMBER, so a channel
  post can never travel the consent path and has its own parser (`parseChannelPost` beside
  `parseGroupMessage`, exclusive by direction) and its own tables (migration 057). `cadence.ts`
  is pure (whichever-trigger-first, the age window, the digest that accounts for every pending
  post), `loop.ts` is pure (a source must be a known channel and a destination must not be one,
  so the mapping graph cannot cycle; the send-readback refuses the bridge's own product
  arriving back), `origin.ts` is the structured origin the website will filter by
  (`channelKey` derived from the channel LINK, stable across a rename). NO model is anywhere
  on the path: posts forward VERBATIM under application-written persona attribution. Her
  announcements archive under the 'bridge' category, EXCLUDED by default. Media re-hosts at
  intake (relays expire ~48h) under `BRIDGE_MEDIA_ROOT`, a SIBLING of MEDIA_ROOT (the
  destruction sweeper walks that whole tree), plaintext with the reasoning in security §16.
  The transport is `bot/bridge-port.ts` (recital-port pattern, plus in-place edit and
  BROADCAST delete, a separate runtime method from the Internal-mode consent erasure so no
  caller defaults into the wrong scope); the rhythm is `bridge.tick`, a self-chaining queue
  job with a minute-bucket key so boot seeds collapse into a live chain.
  **Her announcements PUBLISH since CCB-S5-043** (D-215): `publication.ts` is the per-channel
  publish and publish-unnamed decision, keyed on `channelKey` with NO foreign key to the channel
  records, because a rejoin replaces those and would otherwise unpublish a live block silently.
  The origin now rides on the archived message itself (`messages.bridge_channel_key` /
  `bridge_channel_name`, migration 062, written in the same INSERT), because the forward log it
  used to live on is cascaded by the Capture page's Clear record, and a published item must not
  be able to lose its provenance. A `bridge` row publishes on that switch ALONE - not on
  `categories.bridge`, which becomes the separate question of whether a public announcement also
  appears beside members' messages, and not on `publish_bot`, which is about her conversation
  rather than the operator's own text. Two surfaces read those records: the activity stream with
  a channel dropdown, and `GET /embed/:id/channels`, a standalone announcements block a site can
  embed WITHOUT the stream (`renderChannelBlockPage`), which is two promises rather than one
  filtered surface.
  **`plugins/music/` is the music library** (CCB-S5-044, D-216): tracks the operator uploads
  with their tags read rather than retyped, playlists as the unit of assignment (a bot may
  only find and play what its assignments reach - the briefing-named mutation), the two
  proven send shapes decided by the cover alone (one `MsgContent.Video` message with one;
  title line plus bare `MsgContent.Voice` player without), the bridge's cadence reused with
  the operator's budgets on top (3 unbidden per room per day, 60-minute gap, SEPARATE for
  music and spots, his numbers), the DJ sheet as derived locked facts so she cannot claim a
  genre she does not hold, and Part 4b's member-upload playback behind its own per-bot
  switch (`music-uploads`), allow-listed, played without being stored. The encoder is
  `media/encode.ts` (ffmpeg-static, audio byte-copied, odd dimensions CROPPED - measured,
  because the Stage-0 record contradicted itself); the transport is `bot/music-port.ts`
  (recital-port pattern); the rhythm is `music.tick`.
  **`members/data-registry.ts` is the profile fence** (D-217): every table carrying a
  member-identifying column, classed archive / consent / safety / profile, with
  `verify:member-data` sweeping information_schema so a member-data table that nobody
  registered goes red instead of unnoticed. The profile itself is the memory briefing's;
  this is the shape it must not violate. `settings/`,
  `queue/` (durable Postgres-backed background jobs: store, worker, registry, handlers),
  `bot/runtime/` (**the multi-profile runtime, and the bot now runs on it**: one core, many
  SimpleX profiles, a serialized active-user scheduler, event routing by receiving `userId`.
  Wired under CCB-S4-021 with one profile hosted, and **hosting EVERY enabled bot since
  CCB-S5-001** (`startRuntimeHost` in `host.ts` is the caller, `src/index.ts` calls it).
  Each hosted bot gets its OWN event source, file receiver, engine, consent handler and
  capture registration; sharing any of them would undo the router. Nothing sends before the
  core is ready, because `startChat()` returning is 44 ms and readiness is ten seconds
  later, measured. **`BOT_RUNTIME_HOSTING` and the pre-runtime `bot.run` boot path are
  gone** (D-155): that path cannot host a second profile, so the lever would have been a
  switch that silently reduced the deployment to one bot. `startBot` stays for
  `npm run connect`. `ownership.ts` answers which bot owns which group, and
  `runtime.runForGroup` is the seam every group-addressed command that takes no explicit
  user id must go through - it THROWS on an unknown owner rather than acting as whichever
  profile is active, because issuing the consent erasure as the wrong bot deletes zero rows
  and raises nothing. Most of its files import no SDK so it is testable with no core; see
  architecture §32, D-096, D-124, D-125 and D-155),
  `generator/` (**offline tooling, no runtime caller**: the profile generator, built one
  component per briefing. Shared deterministic `rng.ts`, then `names/` and `traits/`.
  Nothing outside it imports it and nothing writes its output; see architecture §31.
  Components: `names/` (CCB-S4-002), `traits/` (CCB-S4-003), `surface/` (CCB-S4-005), `bio/` (CCB-S4-006), `assemble/` (CCB-S4-007)).
  `npm run assemble` renders a population for a person to READ: the statistics can all be
  green while the text is wrong, which is how CCB-S4-006 and CCB-S4-007 each found a
  defect no number could show. **Bio text has two engines** (D-104): `--engine model` is
  the quality path, because every defect a read of two hundred profiles found was a
  LANGUAGE defect, and the template pool is the availability fallback, deliberately small,
  plain and quiet. The deterministic layer decides who the person is; the model only
  phrases them. Determinism survives by caching on seed + conditioning version + model
  identity),
  `profiles/` (profile/group/authority config, runtime policy, bot onboarding —
  configuration and policy, plus what the onboarding steps produced: the contact address
  (D-126) and the incoming contact requests (D-127). This tree still never drives the
  SDK: the actions live in `bot/runtime/admin-actions.ts` and hand the RESULT here, and
  the event listener records what the core reported; unconsolidated, D-068),
  `knowledge/` (**the knowledge base store**, CCB-S5-022/023, D-176/D-177: `chunk.ts` cuts a
  document into half-open RANGES so a chunk body is `source.slice()` and verbatim is
  structural rather than aspirational, `retrieval.ts` fuses / floors / budgets, `embed.ts` is
  the nomic-embed-text transport, `service.ts` the orchestration. Deliberately NOT under
  `plugins/`, because long-term per-member memory is the same machinery over different
  material; the plugin surface is `plugins/knowledge-base/`),
  `db/`, `web/` (server, auth, session, views), `index.ts`.
- `src/capture/rooms.ts` is **what a real room is and which record captures it** (CCB-S5-033,
  D-190): a member's wire id is scoped to the ROOM, so two `groups` records are one room exactly
  when their member sets intersect, measured at 941/830/**1** within rooms and **0** across. The
  1 is load-bearing, so the predicate is `>= 1` and never a ratio, and rooms are connected
  COMPONENTS rather than pairs. **The unit is the capturing RECORD, not the bot**: `apiListGroups`
  returns ENDED memberships, so one bot can hold several records in one room. An unresolved
  conflict ELECTS (lowest SimpleX user id, the D-182 rule) and is reported loudly; every uncertain
  case fails TOWARDS capturing, because a duplicate is visible and a lost message is gone.
  `room-service.ts` is the live index, refreshed at boot and on membership change.

`migrations/` — 001 messages/links · 002 consent+views · 003 admin · 004
  moderation gate · 005 deletion provenance · 006 webauthn + TOTP · 007 admin
  sessions (persisted across restarts) · 008 content reports · 009 consent action
  journal (provenance + undo) · 010 asset mappings (pinned symbol→asset) · 011
  seeded major assets (locked pins) · 012 correct pins that predate the seed · 013
  her own messages (bot rows, mentions, the second publication branch) · 014
  stripped media derivatives · 015 member instructions + exchange pairing · 016 video links · 017 durable job queue
  (state machine, `FOR UPDATE SKIP LOCKED` claim, backoff/dead-letter, idempotency) ·
  018 capture write-ahead events · 019 formatted text · 020 revocation hide/delete +
  evidence holds (incl. the BEFORE DELETE hold trigger) · 021 consent gaps (a restore
  never publishes what was said while hidden) · 022 quarantine withholds (a hash match
  or an escalation is served to nobody) · 023 bot registry (one row per SimpleX profile
  the core reports: actor type, automation mode, avatar source, the personality
  reference; nothing hosts it yet) · 024 the onboarding contact address (the link the
  console's create-address step produces, stored with the SimpleX user it was created
  on, all three columns under one CHECK) · 025 incoming contact requests (a row per
  request the core reports, keyed unique on the core's own id, because a public address
  can be used by more than one person at a time) · 026 group invitations (a row per
  invitation, with the role OFFERED and the role HELD kept apart, and neither of them the
  operator's expected role) · 027 the free-conversation publication category (a view
  replacement, because 013 carries the category defaults as a literal that must match
  `DEFAULT_ARCHIVE`) · 028 the personality layer (a base character and four 1-10 dials per
  bot, on `cinderella_bot_profiles` because that is where per-bot settings live; the
  `settings` table is global and has no bot dimension) · 029 moderation (append-only
  violations counted over a rolling window per member per chat, the sanction record whose
  `mode` is only ever `observed` today, and the two ladders per bot) · 030 the spoken
  warning · 031 her origin (a second per-bot text column beside the base character, 4000
  characters against its 600, whose column DEFAULT is the operator's written history so
  that the existing bot is backfilled and every new one starts with one; clearing it
  stores NULL and stays cleared, because a default applies to an insert and never to an
  update) · 032 arming (the numeric `group_member_id` a restore acts through, `expired_at`
  as distinct from `expires_at` so a lost expiry job reads as overdue rather than as
  permanent, and the CHECK that makes an enforced row claiming neither success nor failure
  unrepresentable) · 033 the web-search publication category (a view replacement, the same
  correction 027 made, because the category defaults are a literal that must match
  `DEFAULT_ARCHIVE`) · 034 the verbosity axis (a fifth dial, whose 5 reproduces the fixed
  500 character conversation cap and 240 character retort cap it replaced, to the
  character) · 035 the rule registry (every sentence the model is told, as data: id, tier,
  lane, condition, global order, text, enabled, critical, scope and its origin in the code,
  with CHECK constraints on the three vocabularies. **This file is the only authored copy of
  that text**, so changing a rule means changing it here or, from the next briefing, in the
  console; the code holds no fallback copy) · 036 the production lessons (a new condition
  value `has-model`, the two rules CCB-S4-042 adds, and the origin default losing its model
  claim plus an UPDATE for the rows that still hold it, because a default applies to an insert
  and never to an update) · 037 the rule history (one row per change to a rule, both sides
  of all three editable fields plus who and when; the OLDEST row per rule is what that rule
  shipped as, which is why there is no `shipped_text` column and why D-144 stays true) ·
  038 conversation memory (two conditions, the four rules that fence remembered chat, and the
  DELETION of the two no-memory rules D-140 booked in advance for the day memory was built) ·
  039 rule visibility (`nameable`, defaulting FALSE so a rule a later migration adds is private
  until somebody decides, seeded 53 nameable / 40 withheld of 93; two conditions, seven
  `disclosure.*` rules, and the visibility columns on the history. **The flag hides nothing
  from the model**: every rule is in the prompt, because that is what a rule is, so it controls
  what the application OFFERS her to quote and the boundary is held by a gate in code) ·
  040 the recital (the six chapters the Book is read out in: order, titles in both languages,
  the id PREFIXES each claims with longest match winning, the image, and the authored line used
  when the model gives nothing. Prefixes rather than a join table of rule ids, so a rule a later
  migration adds to an existing family lands in its chapter instead of appearing in none with
  nothing saying so. Plus `identity.book-name`, because detection told her a question was about
  her rules and no rule in the registry named the Book, which is the other half of the
  production defect CCB-S4-047 opened with) ·
  041 the conversational Book (two conditions, the four overview rules whose counts are
  PLACEHOLDERS the application fills and protects as required literals, and the two that shape
  a capped follow-up. The general answer quotes nothing now: a wall of quoted rules is what
  production rejected) ·
  042 the invocation record (one row per DETERMINISTIC decision: which law, which chat, what
  kind, and the gate's own category. Content-free, and the group id is the only identifier.
  **It records nothing about the model's own refusals**, because no rule fired in a way the
  application can attribute, and a record that guessed would make the true rows unreadable.
  Plus the rule that lets her say it in the chat, which is free: the follow-up path had already
  gated those rules on `nameable`) ·
  043 enacting a law (a `create` action on the history, and nothing else. **No removal**: the
  briefing's definition of it is what `disable` already does, verified clause by clause, and a
  hard delete would ERASE the law's history through the existing cascade, which is the one
  thing the Book is for) ·
  044 hosting more than one of her (`simplex_user_id` on `cinderella_bot_profiles`, which is
  the edge that did not exist: the character, dials, origin and ladders all hang off that
  table and the SimpleX id lived on `cinderella_bot_registry` with no link back, so nothing
  could ask which personality the profile that received a message has. Plus the bot dimension
  on the moderation counters, made explicit while the backfill is still provably right:
  they were isolated only by the accident that the core's group ids differ per profile, and
  conversation canonicalisation would collapse that. `selected_for_runtime` becomes THE
  PRIMARY, the console's default selection and nothing more. **Nothing renamed the control for
  another seven briefings**, so the wizard went on asking the operator to "select for the
  runtime" and refusing the second bot that answered yes; CCB-S5-008 took the flag out of
  creation entirely and gave moving it its own action, D-162. **Nothing reads it at all from
  CCB-S5-019** (D-173): the column, its index and its data are still here and step two drops
  them, but every reader is gone, including the display-name ternary in `host.ts` that was its
  last functional consumer. A boot REFUSES, naming both values, if the bot wearing
  `BOT_DISPLAY_NAME` has a different name in its record, because booting would otherwise rename
  it in front of its group) ·
  045 standard laws per bot (`cinderella_prompt_rule_overrides`, NULL meaning inherit in both
  value columns so on, off and reworded are ONE mechanism. **The `bot` tier 035 reserved for
  this is the wrong mechanism and stays unused**: a tier is a property of a row and cannot
  express one law with two texts without a duplicate id, and five things are keyed on that id.
  A trigger refuses any override of a constitutional law, because five bots with five
  different outermost limits means nobody can say what any of them will refuse) ·
  046 the self-capability fence (five rules extending D-140 from invented facts about the
  PROJECT to powers she claims over HERSELF, after she told a member in production that she
  would break a bad rule and stop working for anyone who bought her. **Both directions are
  constitutional**: under-claiming is as false as over-claiming, so the spine that keeps her
  spine and the prohibition that fences her are one boundary with two sides, and the spine is
  emitted FIRST because a model handed "you cannot" first answers from the lack. The first
  draft caused the failure it was meant to prevent by containing a sentence she could recite;
  see D-156) ·
  048 the page of a law (one condition and the two rules that hand a page over, for the answer
  where she is given NO law to quote: the application prints it under her words, whole and
  numbered. **Handing her the law and its number was the first build and it was measured
  failing**, four turns against `qwen3:32b`, with the law text surviving every time and the
  number landing on the wrong law. So these rules say what she does not do, and they are the
  same two sentences the scene's brief carries. Numbered 048 rather than 047 because CCB-S5-006
  was allocating 047 in the same working tree at the same time; see D-159) ·
  049 a face per bot (`avatar_path` on `cinderella_bot_profiles`: a path under the asset root, or
  NULL. **NULL is an answer rather than a gap** - it means the deployment default, which is
  `AVATAR_PATH` - so there is no special primary case anywhere and an existing deployment keeps
  exactly the picture it has, because the primary has no upload and falls back to the file the
  operator already set. The bytes are not here; the path is, as with the media tree and the
  chapter images. A configured path that cannot be read is a FAULT that leaves that bot's profile
  alone, never a quiet fallback to the deployment's face; see D-161) ·
  057 the channel bridge (five tables - the channels a bot knows, the mappings with their
  per-mapping cadences and the CHECK that a mapping with no trigger is unrepresentable, the
  posts keyed by the source's shared message id, the forward log with its STRUCTURED origin
  jsonb, and the suppression record - plus the 'bridge' publication category as a view
  replacement, the 013/027/033 pattern, shipped EXCLUDED. **A channel post has no member**, so
  these tables are deliberately outside `messages` and outside every consent view; see D-187).
  · 058 which bot captures which room (keyed on a REAL record, because a key derived from
  membership drifts when membership does and a forgotten assignment is silent; one-per-room is
  enforced in `assignCapture`'s single transaction, since a room is not a column) · 059 the
  membership history (append-only: which bot, which room, when, how; distinct from 026, which
  tracks ONE invitation and mutates - a link-join has no such row, which is why nothing recorded one)
  · 062 channel posts on the website (CCB-S5-043, D-215: the channel origin ON the archived
  announcement, written in the same INSERT, because the forward log it used to live on is
  cascaded by a console action and a published item must not be able to lose its provenance; the
  publication record keyed on `channel_key` with NO foreign key to the channel records, so a
  rejoin cannot silently unpublish a live block; a random `public_id` because the key is derived
  from the channel's public link and publishing it would defeat anonymisation; and both publish
  views rebuilt, where a `bridge` row now publishes on the per-channel switch ALONE and
  `categories.bridge` becomes `in_stream`, the separate question of whether a public
  announcement also stands beside members' messages)
  · 063 the music library (CCB-S5-044, D-216/D-217: tracks with kinds - music, audiobook,
  documentary, spot - playlists, per-bot assignments whose cadence CHECK makes a
  half-configured cadence unrepresentable, and the plays log, which is the FIRST
  profile-class member-data source: member_id NULLABLE and written NULL until the memory
  work delivers the opt-in, no stored aggregate anywhere so deletion can never leave a
  ghost, `kind_at_play` frozen per play because the budget decision's basis must survive a
  later edit; plus the 'music' publication category as a view replacement, shipped
  EXCLUDED - the 013/027/033/057 pattern)
  · 064 her music self-knowledge (CCB-S5-044 follow-up, D-218: the `has-music` condition and
  three rules in the D-138 shape - the DJ facts as placeholders she cannot contradict, the
  not-a-manual prohibition, the no-invention fence - plus `album` on the tracks, because it
  is in the tag and the first build dropped it. Re-baselined prompt-identity; the diff is the
  three sentences)
  · 070 keeping what nobody agreed to (CCB-S5-054, D-240: `content_swept_at`, the CHECK that
  makes a tombstone still holding content UNREPRESENTABLE, and two partial indexes - the unswept
  one SHRINKS as the archive is swept, which is the opposite of the usual direction and is the
  point. A DELETE was the obvious reading of the briefing's shape and is wrong four ways: the
  020 trigger aborts a bulk statement on ONE held row, the cascade takes her published replies
  through `reply_to_id`, `(group_id, group_msg_id)` is what makes capture idempotent so a
  deleted row returns on the next re-capture, and `media_path` is the only handle on the
  encrypted original).
  Runner: `node dist/db/migrate.js`.
  **Numbers 017, 018 and 019 each exist TWICE** — the unconsolidated local-AI work (D-068)
  added `017_cinderella_profiles`, `018_runtime_policy_decisions` and `019_bot_onboarding`
  alongside the three above. Nothing is broken: the runner keys `schema_migrations` on the
  **full filename** and applies files in filename order, so all six apply exactly once. But
  **never rename an applied migration** (it would re-apply), the number is a label rather
  than an ordinal, and new migrations allocate from **the highest number on disk plus one**
  (currently **070**, since 070 landed the retention tombstone). Stated as a rule
  rather than a fixed number, because the fixed
  number went stale once already. See D-069.
  **Read the whole working tree and not only `main`.** 047 and 048 were allocated within an hour
  of each other by two briefings running at once, both from a highest-on-disk of 046, which is
  the same parallel-allocation failure the decision numbers already have twice.
- `scripts/` — PGlite verification harnesses + asset/password helpers.
- `deploy/` — `cinderella.service`, `nginx-admin.conf`, `RUNBOOK.md`, `backup.sh`.
- Git-ignored: `.env`, `state/`, `media/`, `public/` (built assets), `dist/`.

## Verify before committing nontrivial changes

`npm run build` (tsc + Tailwind/htmx assets) · `npm run lint` · and the PGlite
harnesses (real Postgres-in-WASM, no server needed): `verify:db`,
`verify:consent`, `verify:admin`, `verify:admin-views`, `verify:interaction`
(natural addressing), `verify:price` (market data; `-- --live` hits the real
provider), `verify:archive` (her own messages + the consent leak guard), plus
`verify:security`, `verify:public`, `verify:revocation`
(hide/delete on revocation + the evidence holds; proves no path destroys a held item),
`verify:retention` (what the archive stops keeping, CCB-S5-054, D-240: the allow-list with
EVERY clause mutation-proven by neutering it one at a time, every spared row asserted beside a
swept one in the SAME pass - because "nothing published was lost" passes against a sweep that
does nothing, and "the unconsented rows are empty" passes against one that empties everything -
the published id list compared character for character across the sweep, the schema refusing a
tombstone that still holds content, and the page driven through its real routes. It cannot see
that the page's controls are reachable (D-162); that was done in a browser),
`verify:queue`, `verify:capture-events`, `verify:no-dashes`,
`verify:decisions-index` (the generated index at the top of `docs/decisions.md`, D-157: that it
matches the headings byte for byte, that every entry has a Status, and above all that **no decision
number is allocated twice**, which has happened twice. Mutation-proven four ways. Regenerate with
`npm run verify:decisions-index -- --update` after touching a decision heading or its Status),
`verify:prompt-identity` (**the byte-identity check on the whole prompt**, D-144: 24
configurations covering every lane and every condition branch, compared against
`scripts/fixtures/prompt-baseline.json`, which was captured from the code one commit BEFORE
the rule registry moved the sentences into the database. It is not specific to that
briefing: any change to any prompt line, from any briefing or any future rule edit, fails it
and prints which lane and which line moved. A DELIBERATE change is re-baselined on purpose
with `npm run verify:prompt-identity -- --update`, and the diff to the fixture is then the
reviewable record of what she is now told. It also asserts every rule marked `critical`
reaches a prompt in a lane and condition that selects it, and proves both guards can go red
by mutating a rule's text, swapping two rules' order, disabling a constitutional rule, and
rendering with an empty registry.
**It pins WHAT SHIPS, not what a deployment holds**: it reads the seeded registry, so an
operator editing a rule in the Book does not and cannot move it. That is correct, and it
means the drift to watch for is production diverging from the shipped set, which the Book
counts and badges. An ENGINEER changing a rule in a migration re-baselines with `-- --update`),
`verify:book` (the Book of Elii: reading and search, an edit recording both sides of itself, a
constitutional rule refusing to change without its own id typed out, a switched-off critical
rule going loud on the page, a rollback restoring the exact previous text, and a probe of one
rule per lane so a preview can never again show "nothing moved" for a change that is real),
`verify:personality` (the five dials, her identity and the nickname retort lane: that each
dial changes the prompt that is actually sent, that the permissiveness ceiling is in every
conversation prompt at every value and also with no personality configured, that her name
and the other given facts reach it, that her origin reaches it and is fenced by the
draw-on-not-recite rule, that the shipped origin in the migration and the one in the
TypeScript constant are character for character identical, and that none of it reaches a
command rewrite.
`npm run verify:personality-live` is the companion that asks a REAL model the same
question at a low and a high setting and prints both, since a prompt the model ignores is
a dead slider with a passing test; it also asks who she is and where she came from and
fails if she recites her history or volunteers it unasked. It needs Ollama and is not in
the offline set),
`verify:moderation` (the two ladders, the rolling window and its decay, per-member
per-chat scoping, exemptions, and above all the NO-ACT guarantee, asserted structurally by
scanning for every enforcement API name, behaviourally by driving a member past every rung
with a spy on the engine's only outbound, and by the schema CHECK that refuses an observed
row claiming to be enforced. `npm run verify:moderation-live` walks the same nickname up
the ladder against a real model and prints every rung; it needs Ollama),
`verify:search` (web search: that untrusted results are fenced into the USER message and
never the system prompt, that a result can cause no action at all, the budgets, the
deterministic trigger and its negative controls, the honest failure line, and since
CCB-S4-042 the **pre-search gate** with its negative controls and the rule that **a source
line belongs to the answer**: a refusal reaches no provider and cites nothing, an
undeclared answer cites nothing either, and the two are mutation-proven by removing the
gate and by re-attributing a refusal.
`npm run verify:lessons-live` is the companion that drives all six production defects
through a REAL model and prints every reply; it needs Ollama and is not in the offline set.
`npm run verify:search-live` puts five real prompt injections in the result set and prints
what she does with each; it needs Ollama),
`verify:memory` (conversation memory: the three limits and which one binds, every exclusion
with a positive control beside it so an empty query cannot satisfy them all, the fence proven
absent from the instruction section, and a planted instruction driven through the whole engine
to show it reaches no capability.
`npm run verify:memory-live` plants five real instructions in the HISTORY, asks something
ordinary, and prints what she does with each; it needs Ollama and is not in the offline set),
`verify:disclosure` (what she may quote of her own rules, CCB-S4-045/046: the nameable split,
the selection and its budgets, that every quotable rule RENDERS, and above all that no question
can select a withheld rule, mutation-proven both ways. It also pins the two DETERMINISTIC GATES,
which exist because marking a rule internal does not hide it from the model and a prompt sentence
could not hold the line: an elimination probe and a question aimed at the machinery are answered
by the application, before the model is asked anything.
`npm run verify:disclosure-live` asks a real model to recite, to explain the withholding, and to
be talked out of both by authority and by elimination; it needs Ollama and is not in the offline
set. Read its output rather than its exit code: two defects in this work passed every check and
were only visible in the answer),
`verify:rule-conversation` (the Book as a conversation, CCB-S4-048: the overview's counts and
areas, the follow-up cap of two, selection BY AREA rather than by keyword, and the precedence
fix that stopped a question about her own laws reaching a search engine. It drives the real
engine with a resolver that always claims LOOKUP, which is what production did, and its control
proves the rule is selective rather than a blanket that would disable the catalog.
`npm run verify:rule-conversation-live` holds the whole conversation against a real model. Two
of its follow-up checks are run-to-run variable and deliberately not loosened; see its header.
Extended by CCB-S4-049 with the follow-up detection: her own chapter names in both languages,
the three-minute post-overview window, and the rule that the window is the WEAKEST of the three
signals and promotes only what nothing else claimed, because letting it outrank the catalog
cost the archive its own questions),
`verify:book-scene` (the Book as a SCENE, CCB-S5-005, renamed from `verify:book-artefact`: that a
question about the BOOK gets the scene while a question about her RULES keeps the overview, that
the scene is ONE message carrying EXACTLY ONE law, that the laws have stable page numbers and no
withheld law has one, that the invitation is heard while an ordinary question after a scene is
not, and the record's deliberate limit from CCB-S4-050. **The one-law bound is asserted
structurally rather than by inspection**: the counter is mutation-proven in both directions, the
briefs are proven to contain no rule text over the whole registry, and a model that invents a law
is driven end to end and shown to get the authored line instead.
It also drives **the whole composition the entrypoint wires**, which is what the first deployment
got wrong: the scene rendered, the engine believed it and the transport it had been handed was the
recital port, so nothing arrived and nothing said so. A scene is a REPLY and leaves through the
reply path. Mutation-proven by restoring the shipped defect, which reaches the engine's outbound
with nothing, and every way a scene can fail to arrive is now an error plus a `status.error`.
`npm run verify:book-scene-live` plays the whole conversation at two sharpness settings against a
real model: the scene, another law, and a law by number. Read its output rather than its exit
code, and read the `her framing:` lines: every defect this briefing fixed was found in a run that
was green on everything structural),
`verify:rule-creation` (enacting a law, CCB-S4-051: every field the console asks for, the
preview, the typed confirmation for a constitutional law, a duplicate id refused by name, and
the history a creation writes. Mutation-proven three ways: a law cannot be created without an
id, cannot be created outside every chapter, and DELETING one erases its history, which is why
removal was not built.
`npm run verify:rule-creation-live` enacts the operator's own swearing law and A/Bs it against a
real model; it needs Ollama),
`verify:reasoning` (what she thinks with, CCB-S4-052: that the console's stated reasoning
setting is read back out of the transport, so a page that drifted from the code goes red, and
that the measured figures it quotes are the ones on record. **Thinking is OFF and always has
been**: `reasoning_effort: 'none'` is sent on every request and Ollama honours it. No dial was
built, because the reasoning pass spends the same `max_tokens: 320` as the reply and turning it
on made three replies in five come back empty and fall back to the deterministic line),
`verify:interaction-scope` and `verify:two-names` (two bots, one name, CCB-S5-006: the
inventory of which interaction settings are shared and which are one bot's, and the proof that
two bots answer only to their own. The inventory ships as DATA in `setting-scope.ts` rather than
as a table in a document, and the first check asserts EVERY key of `InteractionSettings` is
placed, so a setting added later without a placement goes red instead of silently defaulting to
shared - which is exactly how `wakeWord` came to be shared. It also reads the per-bot key list
out of the DATABASE constraint and compares it to the code, because the duplication between them
is deliberate and the drift would not be. `verify:two-names` drives the real `detectAddress`,
because the defect was never that the settings object had one wake word but that both bots woke
on it; its mutation puts a bot back on the shared value and shows both waking again),
`verify:knowledge` (she reads what he gives her, CCB-S5-022/023: that what is stored is what
went in, asserted as an EXACT substring over eight document shapes including a 4000-character
run with no spaces and a heading depth jump; that a removed or re-ingested document leaves no
chunk behind; that retrieved text cannot exceed its budget at any settings and that no chunk is
ever truncated to fit; that the relevance floor decides and below it she is handed NOTHING; that
a document granted to one bot is invisible to another in SQL rather than by filtering
afterwards; and that passages reach the model fenced and never in the system prompt.
**Section 6b is the one to keep**: it sets EVERY control the console offers to a value whose
effect is decidable and asserts the effect, because `trigger` shipped normalised, persisted,
audited, inventoried and rendered, and read by nothing, so `off` and `explicit` both behaved
exactly like `always`. No other assertion would have caught it, because they all drive the
default. Mutation-proven on the two failures the briefing names.
Two of its checks exist because they were once VACUOUS: the verbatim assertion compared only
each chunk's first line and squashed whitespace before comparing order, and it printed
"EVERY chunk body is a substring of the source" over a document where two of three were not.
`npm run verify:knowledge-live` drives all four cases against the production model, ingesting
with the real embedder: a question answered from a real document with its attribution, one no
document covers, the same question with the document removed, and a bot without the capability.
It needs Ollama and is not in the offline set. Read its output rather than its exit code: the
relevance floor was corrected from 0.45 to a measured 0.55 because a green run printed a
document name under an answer about the boiling point of mercury, and again to 0.60 under
D-226 when production showed a README noise band straddling 0.55;
`npm run calibrate:knowledge-relevance` prints the bands per deployment),
`verify:plugin-scope` (different bots, different capabilities, CCB-S5-021: the inventory placing
every plugin setting, the database CHECK agreeing with it, inheritance leaving the existing
deployment alone, and above all the ABSENT-CAPABILITY property PER BOT, asserted at all three
layers it has - the rule engine never matches the pattern, the model is never shown the intent,
and the seam downgrades a resolver that claims it anyway - and then driven end to end through the
real engine with a spy on the search port. Mutation-proven four ways, including one that RESTORES
the shipped defect and shows a bot reaching a plugin that is off for it. Every negative has a
positive control beside it, because "this bot cannot search" passes against a bot that answers
nothing at all, which is why the quiet bot is also shown answering a question it still can.
`npm run verify:plugin-scope-live` puts one lookup question to two real bots with different
capabilities and prints both replies; it needs Ollama and is not in the offline set. Read its
output rather than its exit code: the one thing it can decide is that no provider was reached and
that neither bot CLAIMED to have looked, and the rest is whether the answer sounds like a bot that
never had the capability),
`verify:self-claims` (what she may claim about herself, CCB-S5-002: that the fence is present,
constitutional and critical, that the spine is emitted before the prohibition, that it reaches
every lane that speaks in her voice and NO command lane, and above all that the detector the live
check depends on actually recognises the replies observed in production, because a live check
whose patterns match nothing passes forever. Mutation-proven four ways, with the CORRECT answers
as positive controls so the obvious response to a red run cannot be to loosen the patterns.
`npm run verify:self-claims-live` puts all five probes to a real model at sharpness 10 and 4; it
needs Ollama and is not in the offline set. **Read its output rather than its exit code**: three
of the five capability patterns exist only because somebody read a green run and saw the lie had
moved to a form the previous wording did not cover),
`verify:multi-bot` (more than one of her, CCB-S5-001: which bot owns which group and the
refusal to guess, two bots never resolving to one SimpleX profile, moderation counters and reply
budgets proven not to merge, a standard law on for one bot and off for another, and the
constitutional refusal at all three layers. Mutation-proven both ways, and every guarantee has a
POSITIVE CONTROL beside it, because each of these passes trivially against an implementation that
does nothing: a counter check passes if nothing is ever counted.
`npm run verify:multi-bot-live` drives two characters with opposite dials against a real model,
prints both replies, and measures the queue under genuine concurrency; it needs Ollama and is not
in the offline set. Read its output rather than its exit code: the voice is the point, and no
check can assert it. **Section 8 is CCB-S5-027's** (D-182): a slash command names no bot, so
exactly one now answers it, and the election is driven through the REAL engine and the REAL
consent handler rather than left as a computable predicate, which is D-162's lesson),
`verify:lookup-honesty` (what reaches her from a lookup and what she may say about it,
CCB-S5-028, D-183: that a question naming no request to go and look is downgraded whichever
resolver claimed it, that results below the measured floor never reach the model, that an
embedder which cannot answer hands over NOTHING rather than the unjudged, and that no source
line can stand under an answer that used nothing. The two mutations the briefing asked for by
name are both here: the floor set to zero lets the production results through again, and a model
declaring `[0, 1]` on a rejected set still gets no line because it was never shown one. Every
negative has a positive control beside it, because a floor that refused everything passes every
assertion about refusing.
`npm run verify:lookup-honesty-live` drives the operator's exact question end to end against the
real model and the real embedder, plus a knowledge question and a question nothing answers.
**Read its output rather than its exit code**, and read the MEASURED counts at the end: the
application-decided guarantees are asserted, and the model's own honesty is measured at 5 of 6
saying the results do not cover it and 4 of 6 inventing a provenance anyway. Its fabrication
patterns were widened after a green run reported 0 of 3 on three answers that all invented one),
`calibrate:search-relevance` is where the floor's number comes from, and it is not a check: it
prints the four bands and what each candidate floor would admit,
`verify:capture-rooms` and `verify:capture-console` (one record captures a room, CCB-S5-033,
D-190: the room rule over the production shape, the election, the assignment, and the guarantee
that no room is captured twice - mutation-proven by restoring the shipped "every bot captures"
behaviour and by showing a per-groupId check finding six ids and no conflict. The console harness
drives the real routes: the warning, the switch as ONE action read back out of the database, and a
membership change appearing on the page. Neither can see that a control is reachable (D-162)),
`verify:bridge` (the channel bridge, CCB-S5-032, D-187: the two parsers proven exclusive in
both directions with positive controls, the cadence's whichever-comes-first at both orderings,
the age window, the repeat cap, dismissal, the digest proven to ACCOUNT for every pending post,
the quiet case sending and recording nothing, the loop guard's refusals and its send-readback
driven end to end, the suppression invariant provable as SQL, the whole composition through a
fake port with the structured origin asserted field by field, edits recomposing in place,
deletions broadcast-withdrawing, and NO model on the path asserted structurally. The two
briefing-named mutations are proven in-script AND by breaking the source: the readback bypassed
re-bridges the bridge's own product, the record skipped turns the invariant red, and a third -
the trigger composition inverted to whichever-comes-last - turns eight checks red),
`verify:channel-publication` (channel posts on the website, CCB-S5-043, D-215: the migration's
own SQL derivation of a channel key proven CHARACTER IDENTICAL to `channelKeyFor` in both its
forms, because that expression runs once on the operator's data and nothing else would notice a
disagreement; the BACKFILL driven the only honest way, by applying migrations to 061, seeding
legacy rows and then applying 062 alone, so what is recoverable is recovered and what is not is
left NULL, unpublishable and COUNTED; the origin stamped through the real service and a fake
port; the channel record CLEARED and the published item keeping BOTH its provenance and its
publication, which is the whole point of the briefing; a rejoin under a new group id landing on
the same decision; and the mutation the briefing named, the view rebuilt with the switch
predicate replaced by TRUE, which makes an unpublished channel's post publicly readable. Two
surfaces with positive controls in BOTH directions, because "no member message is in the block"
passes against a block that is empty. Anonymisation asserted over all four exits the name has -
the column, the text, the search text and the structured runs - with the post's own words proven
intact character for character. The console section PRESSES the real routes and reads the effect
back out of the database, including the refusal for a channel that has no record),
`verify:music` (the music plugin, CCB-S5-044, D-216: the cover deciding the shape with both
shapes asserted call for call, the asks through the REAL engine including the no-reply-on-play
rule, the playlist boundary with the briefing-named mutation and its positive controls, the
cadence at both trigger orderings, the SEPARATE budgets proven against each other with a
requested play consuming neither, the gap, one-send-per-group with the busy line, Part 4b's
four refusals, the profile fence's member_id-NULL invariant, and no model on the path
structurally),
`verify:music-encode` (the real ffmpeg: the crop-not-pad settlement measured on an odd-height
cover, byte-copied audio confirmed off the stream table, the tag read including an APIC cover,
the encode cache proven to serve without re-encoding AND to re-encode a row stamped with an
older version, the recipe sha256 PINNED beside ENCODE_VERSION so an unbumped recipe edit goes
red (D-222, the black-bars lesson), and a member upload end to end with real bytes, played and
not stored, the sent bytes outliving the command for the async upload and swept by the aged
tick - D-224),
`verify:member-data` (D-217's sweep: information_schema over every migration against the
registry, both directions, the profile class's promises, and the mutation of an unregistered
member table going red),
`verify:protected-text` (the lines the application writes and she may not, CCB-S5-027, D-180:
that the protected set is DERIVED from the persona rather than listed, that a forgery is removed
whether it stands on its own line or is tacked onto the end of a sentence, that a draft she was
GIVEN is hers to carry, that her own memory no longer shows her a source line, and that no
document NAME reaches the prompt. Mutation-proven by emptying the marker list, and the wiring is
read from the source because there is exactly one production path into the transport and it must
set the field after the caller's spread.
Two of its checks exist because of this briefing's own mistakes: the reword of the archive count
opened with its placeholder and silently lost its guard, which the unguarded REPORT caught; and
an earlier draft asserted a property that was true by construction and could never fail. Every
absence has a presence beside it, because "no forged line reached the member" passes against a
guard that eats every reply),
`verify:archive-search` (where an archive search goes and what it counts, CCB-S5-027, D-181:
that the rule engine really does return UNKNOWN for the production question, so the model is the
only suspect; that a resolver claiming SEARCH for a message naming nowhere is downgraded while
the SAME resolver naming the archive is honoured; that the answer states what it MATCHED; and
each of the count's three exclusions mutation-proven one at a time against the number production
would have printed. The positive controls are the load-bearing half: a gate that refused every
SEARCH, or a count that excluded everything, passes every negative here),
`verify:scheduler-reentry` (a command may not schedule another from inside itself,
CCB-S5-015: re-entry refused IMMEDIATELY rather than after the 60 s command timeout, the error
naming both commands, the alarm distinct from the timeout alarm, and a nested call for a
DIFFERENT bot refused too because there is one queue. Section 2 is the load-bearing half: a
guard that refused everything would pass every re-entry assertion, so ordinary sequential and
concurrent scheduling is proven untouched and the async store is proven not to outlive its
command. Section 3 drives the REAL avatar flush and its mutation restores the shipped wrapper,
which is also what exposed a catch too wide to tell a defect from an unreachable group),
`verify:bot-creation-form` (the create form can be completed, CCB-S5-010: every `pattern` the
console serves compiles in regex `v` mode, which is the mode browsers use and the one the slug
pattern silently failed for its whole life, plus proof it CONSTRAINS rather than merely
compiles; and that the wizard's reveal-and-report is still wired to both Next and Finish, so a
required field on a hidden step can never refuse in silence again. **It cannot see the wall it
was written for**: `hidden` is set at runtime, the shipped markup does not carry it, and a
static sweep reports the form as perfectly reachable, which it did. The browser found that one;
this is the guard),
`verify:new-bot-identity` (a new bot knows its own name, CCB-S5-009: one definition of a usable
wake word shared by creation and the settings page, creation refusing without one and refusing a
duplicate BY NAME, a new bot getting its own retorts with the assertion that not one of them is
hers and none names her world, the three retort states (own / inherited / none) told apart
because silence looks identical in all three, and the real engine driven twice: once to show the
new bot answering with ITS name, once with an emptied list to show the moderation ladder's
warning still arriving rather than being discarded. Mutation-proven by removing the wake-word
requirement, which turns seven checks red),
`verify:searchable` (every tracked text file is searchable, CCB-S5-009: a single NUL byte makes
grep and ripgrep classify a file as binary and SKIP it, silently, so every content search in the
repository goes blind to it. Two harnesses carried one, written as a `?? '<NUL>'` sentinel that
should have been the escape, and a stale import in one of them survived a repository-wide grep
because of it. The third was written by the commit that reported the first two. Stricter than
the tools it protects, because they decide on the first block and this reads the whole file),
`verify:onboarding-per-bot` and `verify:bot-avatar` (onboarding a second bot and giving it a
face, CCB-S5-007: that every onboarding step acts as the bot it was GIVEN, with the other bot as
a positive control on each one and an unhosted id raising rather than falling back to the
primary; and that each bot wears its own image, with NULL meaning the deployment default, so
there is no special primary case. The load-bearing assertion is that a configured avatar which
cannot be read is a FAULT carrying NO image, which is the line that goes red the day somebody
"fixes" it into a fallback to the deployment's face, and it is mutation-proven. Every guarantee
has a positive control beside it, because "bot A is not wearing bot B's face" passes against an
implementation that dresses nobody. The decision lives in `bot/runtime/faces.ts` precisely so it
is answerable with no SimpleX core; the console section drives the real upload, clear and serve
routes and then reads what it stored back out through `listBotsToHost`),
`verify:recital` (the Book told, CCB-S4-047: the chapters and their order, both triggers with
twelve negative controls, the bounds and what gives way when they bind, and above all that no
withheld rule can be recited at any bound in either language, mutation-proven both ways. It also
pins the two things live runs found: that a rule whose placeholders have no values is not
planned (rendering it throws and killed a beat mid-reading), and that the elimination gate covers
the vocabulary a PERFORMANCE invents for the set she kept back. The console section drives the
real routes, including an image through the real upload path.
`npm run verify:recital-live` reads the whole book against a real model, then reads it again with
the model failing on every beat, then runs the CCB-S4-045/046 extraction attempts after one; it
needs Ollama and is not in the offline set. Read its output rather than its exit code: both leaks
this briefing closed were found in a fully green run),
`verify:namegen`, `verify:traits`, `verify:surface`, `verify:bio`, `verify:bio-model` and
`verify:assemble` (the profile generator; pure computation, no DB. `verify:bio-model` fakes
the model transport, so no Ollama need be running.
`verify:traits` gates CORRECTNESS and only REPORTS the two quality measures: both bounds
were withdrawn under D-095 after measurement showed they named the wrong properties.
`npm run calibrate:traits` prints the surface replacements get written from),
`verify:multi-profile` (the multi-profile runtime, against PGlite and an in-process core
double; merged to `main` under CCB-S4-020),
`verify:runtime-host` (the single-bot wiring: profile resolution, the bot-profile guard,
capture through the router proven call-for-call identical to capture through the SDK, the
readiness gate, and the assertion that the runtime's SDK-free files are still SDK-free,
which `verify:adapter-seam` cannot catch because it permits the SDK anywhere under
`src/bot/`. Since CCB-S5-019 it also drives **the rename reconciliation** (D-173): what refuses,
and above all what still BOOTS, since a refusal that fired on any disagreement would pass every
positive assertion and stop deployments in no danger. Mutation-proven both ways, and it reads
from the source that `host.ts` throws on the answer rather than computing it and dropping it),
`verify:adapter-seam` (nothing outside the adapter imports the SDK, and the check
proves it fails on a violation), `verify:adapter-fake` (the seam driven with no SDK),
`verify:screening` (encryption at rest + the hash-screening seam; the fixture
provider proves the quarantine path with no real material).
`scripts/admin-preview.ts` boots a seeded local admin console for browser checks.

**The marketing site is not in this repository** (D-089). It lives in
[`cind3r3lla-site`](https://github.com/saschadaemgen/cind3r3lla-site) with its own
process, port (`8788`), systemd unit and deploy script, and it carries its own
`verify:site`, `verify:i18n-keys` and `verify:no-dashes`. This repository's
`verify:no-dashes` therefore no longer scans `locales/` (there is none here); it
covers the bot's own member-facing output, which is what remains.

## Documentation maintenance (binding on every briefing)

Documentation is maintained **per change, not per season** (CCB-S1-019). On
completing the work of any briefing, review the **six** living documents —
[`docs/architecture.md`](docs/architecture.md), [`docs/security.md`](docs/security.md),
[`docs/wire-format.md`](docs/wire-format.md), [`docs/feature-backlog.md`](docs/feature-backlog.md),
[`docs/decisions.md`](docs/decisions.md), [`docs/adapter-contract.md`](docs/adapter-contract.md)
— and update whichever the change affects,
grounded in the actual code. If the change touches nothing documented, state
**"no documentation change"** explicitly in the completion report — never skip
silently. New decisions get a `D-<n>` entry with a Status (`IMPLEMENTED` /
`PLANNED` / `Superseded by D-<n>`), **written in the same commit that first spends the
number - never "to follow"**. Two commits deferred their entries to ride with a follow-up
("D-210 to follow with the layout", "D-214 to follow with stage 1"), neither follow-up
landed, and five numbers sat cited in shipped code with no entries for anyone to read until
the CCB-S5-043 close-out tripped over them; all five were then reconstructed after the fact,
which is strictly worse than writing them when the reasoning was fresh. Keep the
implemented-vs-planned discipline so the docs never present planned work as built.

**`docs/planning/` is history, not authority** (D-110). Sixteen documents from the parallel
planning chats, committed as a dated snapshot under CCB-S4-008. On any divergence the order
is **the code, then the living documents, then these**. Several are titled `decision-*` and
record *proposals*; what was adopted is in `docs/decisions.md` with a number and a Status,
and it is usually narrower. Nothing there may be cited as a decision, nothing there is
maintained, and anything added later is privacy-scrubbed first with the result recorded in
its README even when the scrub replaced nothing.

**Read the next free decision number off the file; never assume it.** This has gone
wrong twice: once when D-080 was allocated to two entries, and again when a second
D-082 appeared, both renumbered afterwards. The highest number is not always the last
heading in the file, because entries are ordered newest-first and the planning chat
allocates in parallel. The check is one command, and it is not optional:

```bash
grep -oE "^### D-[0-9]+" docs/decisions.md | grep -oE "[0-9]+" | sort -n | tail -1
```

Since D-157 the **generated index at the top of `docs/decisions.md` states the highest allocated
number and names the gaps**, so that is the fastest read; the command above remains the check.
**After adding, retitling or restatusing a decision, regenerate the index** or the suite goes red:

```bash
npm run verify:decisions-index -- --update
```

Same discipline for briefing ids and migration numbers (D-069): allocate from what is
on disk plus one.

**Allocation reads EVERY OPEN BRANCH, not `main` alone**, for as long as any branch carries
decision entries. `D-096` was allocated on `feature/multi-profile-core-foundation` and does
not exist on `main`; reading the highest number off `main` would have produced a second
D-096 the moment that branch landed, which is the duplicate-allocation failure this file
already records happening twice. The check when a branch is open:

```bash
git log --all -p -- docs/decisions.md | grep -oE "^\+### D-[0-9]+" | grep -oE "[0-9]+" | sort -n | tail -1
```

A deliberate gap is fine and should be stated in the entry that skips it.

Why this keeps the docs ground truth: the strategy documents (season protocol,
decisions narrative, season plan) are authored in the planning chat and may run
ahead of the code; the six technical docs are maintained by Claude Code **from the
code** and are the corrective.

**The count was five until CCB-S3-020 added [`docs/adapter-contract.md`](docs/adapter-contract.md)
and did not update the rule that governs it** (corrected under CCB-S4-009). Statements of
"five" in the Season 1 and Season 2 protocols are therefore **historically correct and are
left alone**; only current and forward-looking statements were changed. If a seventh is
ever added, this rule, its companion above, the register's documentation checkpoint and
`README.md` all state the count and all need updating together.

**Two season counts now run in parallel, and they must never be conflated.** This
repository has the product's seasons (`CCB-S<n>-<NNN>`, currently closing Season 3).
The marketing site has its own, starting at **its own Season 1**, in its own
repository with its own briefings and its own protocol documents. A bare "Season 1"
is ambiguous from now on: say *product Season 1* or *site Season 1*. Briefing ids are
not shared across the two, and a site briefing never appears in this repository's
register.

## Deploy (VPS) — see [deploy/RUNBOOK.md](deploy/RUNBOOK.md)

Shared production host. Be **additive**: never touch neighbouring services,
DBs, or nginx configs. App in `/opt/cinderella` (git), runtime data in
`/var/lib/cinderella` (owned by the non-root `cinderella` user). One systemd
unit. Update = `git pull && npm ci && npm run build && node dist/db/migrate.js &&
systemctl restart cinderella`. Admin console is **public + passkey-secured**
(Addendum 4): nginx TLS at the admin hostname → Fastify `127.0.0.1:8787`. See
[deploy/RUNBOOK.md](deploy/RUNBOOK.md). WireGuard (Addendum 3) is retired from the
admin path but stays installed for optional defense-in-depth
([deploy/wireguard.md](deploy/wireguard.md)).

## Child safety (CCB-S3-012) — foundation built, provider NOT connected

Storage and custody are built; detection is not. **No screening provider is
configured**, the null provider transmits nothing, and the public copy says "in
development" until a real provider is configured and verified. Hash matching finds
KNOWN material only, never new material, and a no-match is not a statement of safety.
A match preserves and quarantines, never deletes. Reporting, retention periods and the
point of contact are legal questions for a lawyer and are deliberately absent from the
code. See architecture §26, D-075/D-076.

## Parked (do not build now)

Public `/embed/<id>` widget render + Web-Component (later season; config model + admin
UI already exist), AI moderation / CSAM scanning (separate track — the
`moderation_state` column is the hook), self-hosted relay/super-peer capture.

**The bot avatar left this list under CCB-S5-007** and had arguably left it earlier: it was
delivered in Season 1 and `docs/feature-backlog.md` has said so for some time while this line
still read "do not build now". Each bot now carries its own image, uploaded from the AI Bot page
and stored per bot (migration 049, D-161); `npm run avatar -- <img>` still stages the deployment
default, which is what a bot with no upload of its own wears.
