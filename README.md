<img src="assets/banner.jpg" alt="CIND3R3LLA - Private AI orchestration for SimpleX communities" width="100%">

# CIND3R3LLA (advanced AI Bot Suite)

**Private AI orchestration for SimpleX & MATRIX! communities.**<br>
Local AI, human controlled agents, autonomous NPCs, consent first community memory, and a hardened administration platform.<br>
One embedded SimpleX core. Your infrastructure. Your rules. No silent cloud fallback.

[![License](https://img.shields.io/badge/license-AGPL--3.0-blue?style=for-the-badge)](LICENSE)
![Version](https://img.shields.io/badge/version-v0.0.1--alpha-orange?style=for-the-badge)
![Network](https://img.shields.io/badge/network-SimpleX-6E56CF?style=for-the-badge)
![Runtime](https://img.shields.io/badge/runtime-TypeScript-3178C6?style=for-the-badge)
![Database](https://img.shields.io/badge/database-PostgreSQL-336791?style=for-the-badge)
![Local AI](https://img.shields.io/badge/AI-local%20Ollama-00BCD4?style=for-the-badge)
![Auth](https://img.shields.io/badge/auth-Passkeys-2EA44F?style=for-the-badge)

> **Status: active alpha.** CIND3R3LLA is under active development. Stable capabilities and work in progress are separated throughout this document. The project is already running in production, but the multi profile agent runtime is still being integrated.

## More than a chatbot

CIND3R3LLA is a self hosted control plane for intelligent identities inside private and public communities.

It combines the embedded SimpleX core, deterministic application logic, local language models, persistent community memory, human supervision, moderation workflows, public knowledge publishing, and character driven interaction in one platform.

A moderator or administrator can operate through a persistent avatar in a community, discuss difficult situations with the team in a private staff space, refine the avatar's behaviour, approve or override actions, and continue using the same identity in the public conversation.

Autonomous NPCs can host games, explain features, welcome new members, tell context aware jokes, create roleplay moments, or demonstrate how a community works. Human operated agents can automate routine work while remaining under direct human control. Technical automation accounts can handle status and system tasks without pretending to be personalities.

The actor type, automation mode, personality, permissions, avatar source, and public role are separate. A fantasy avatar does not define whether the identity is human operated, autonomous, or purely technical.

## The vision

CIND3R3LLA is designed for communities that want AI characters without surrendering their conversations to an external platform.

- **Local intelligence** - inference runs through private Ollama infrastructure with explicit model routing and deterministic fallback.
- **Human control** - moderators and administrators remain accountable and can review, interrupt, edit, approve, or take over.
- **Multi profile identities** - one embedded SimpleX core can host many persistent profiles without one process per bot.
- **NPC worlds** - entertainment, games, tutorials, onboarding, roleplay, and community characters with individual personalities and schedules.
- **Private staff collaboration** - agents can be discussed, trained, corrected, and supervised in team spaces before acting in public contexts.
- **Consent first memory** - public groups can turn opted in conversation into a searchable, self owned knowledge base.
- **Deterministic safety** - AI may classify and phrase, but identity, permissions, consent, routing, publication, and execution remain application controlled.
- **Transport independence** - SimpleX is the first transport. The platform architecture is designed to support additional private transports later.

## What is live today

### Embedded SimpleX runtime

CIND3R3LLA loads the official native SimpleX core directly inside the Node.js process through `simplex-chat`.

There is no external CLI daemon and no remote control layer. The application owns the event loop, local databases, file reception, message capture, and outgoing transport path.

### Consent first public archive

Public SimpleX communities can preserve useful conversation without silently collecting everyone.

Two gates always apply:

1. The community enables publication.
2. Each member explicitly opts in.

Members can use `/publish` and `/unpublish`. Only eligible messages sent after opt in can appear publicly. Publication state is derived from consent and moderation state rather than trusted as a stale flag.

Supported archive material includes:

- text
- images
- video
- voice
- links
- files
- edits
- in group deletions

### Searchable public knowledge site

The public archive is server rendered, searchable, filterable, and designed for long term discovery.

Current capabilities include:

- full text search
- media and time filters
- infinite scrolling
- live updates
- inline video
- light and dark appearance
- structured data
- sitemaps
- feeds
- social previews
- public content reporting
- audited takedown workflows

### Hardened administration

CIND3R3LLA includes a dedicated administration platform rather than a collection of hidden environment variables.

Current administration areas cover:

- dashboard and runtime status
- content and moderation
- interaction settings
- AI bot setup
- access control
- local AI runtime
- model catalog
- independent AI routing
- hardware visibility boundaries
- telemetry
- personality
- privacy and safety
- providers
- knowledge and RAG preparation
- testing and comparison
- audit history
- plugins
- system configuration

The administration uses real TLS, passkeys, PostgreSQL backed sessions, rate limiting, strict security headers, audit logging, and explicit status reporting.

### Local AI runtime

The local AI layer is connected to Ollama through a private endpoint.

Current capabilities include:

- local runtime enable and disable controls
- stored setting versus effective runtime state
- connection probes before activation
- deterministic fallback
- installed model discovery
- model family, parameter, quantization, and file size metadata
- separate model selection for intent classification and reply wording
- refusal to activate missing models
- no silent cloud fallback
- audited runtime and routing changes
- content free operational telemetry

The intent model may classify a request. The reply model may improve wording. Neither model receives permission to execute actions, change consent, publish content, or send arbitrary messages.

### Interaction and plugins

The existing interaction engine supports:

- configurable wake words
- natural addressing
- slash commands
- reply modes
- deterministic intent handling
- local AI phrasing
- plugin supplied capabilities
- archived bot replies linked to the triggering member message

CIND3R3LLA already includes a plugin boundary and a crypto price integration as the first operational example.

## Multi profile agent runtime

The next major runtime replaces the current single bot convenience wrapper with a shared multi profile core.

The implementation is based on measured behaviour of the official SimpleX Node SDK:

- one `ChatApi.init()` instance
- one `startChat()` call
- all profiles subscribed simultaneously
- incoming attribution through the receiving `userId`
- local group identity defined by `userId + groupId`
- serialized active user dependent commands
- outgoing messages recorded from command results
- no normal profile rotation

The runtime state model distinguishes:

- `offline`
- `starting`
- `subscribing`
- `ready`
- `degraded`
- `stopping`

A bot is not considered ready merely because `startChat()` has returned. Subscription progress and operational readiness are separate states.

## Identity model

CIND3R3LLA separates four internal actor types:

| Actor type | Purpose | Typical control |
|---|---|---|
| `human_user` | A real member identity | manual |
| `human_operated_agent` | Moderator, administrator, support, or character identity supervised by a human | assisted, autopilot, or manual takeover |
| `npc` | Entertainment, game, tutorial, onboarding, demonstration, or roleplay character | automated |
| `system_automation` | Technical notifications and system operations | automated |

This classification controls permissions and automation. It does not force a permanent label onto every message or avatar.

Transparency belongs in the product experience: onboarding, welcome messages, terms, profile information, and the public user directory. The chat remains immersive.

## Avatars and personalities

Every profile can use:

- no avatar
- an uploaded avatar
- a deterministic generated avatar
- an avatar generated with local AI

Operators can replace any unsuitable result.

Personality generation is designed as a deterministic system first. The local AI is an optional creative layer, not the source of authority.

The planned personality engine separates:

- latent personality traits
- visible communication style
- cultural and naming rules
- activity rhythm
- participation behaviour
- profile completeness
- operator influence
- avatar motif and style
- manual overrides
- generator version and seed

Templates must always work without a model. Local AI can provide more natural biography text, character variations, and avatar prompts. Generated results are cached so profiles remain reproducible.

## Human operated agents

A human operated agent is not an NPC.

It can represent a moderator, administrator, support specialist, host, or recurring community character. AI acts as an assistant or autopilot, while a responsible human remains behind the identity.

Planned controls include:

- manual mode
- assisted mode
- autopilot
- immediate human takeover
- action approval requirements
- team discussion context
- public context boundaries
- per group permissions
- model assignment
- personality assignment
- avatar management
- audit history
- last activity and last reply
- failure and fallback state

The system must never silently convert a human operated identity into an autonomous NPC.

## NPCs and community entertainment

NPCs are first class personalities, not empty traffic generators.

Possible roles include:

- court jester
- game opponent
- quiz host
- storyteller
- tutorial guide
- welcome character
- event host
- community mascot
- demonstration member
- scheduled commentator

An NPC may react to recent conversation, appear according to a configurable rhythm, answer when addressed, observe cooldowns, avoid sensitive moderation moments, and operate only within explicitly granted capabilities.

Example:

> The court jester appears at irregular times, makes a context aware joke about a harmless moment in the conversation, and can be addressed directly for another joke.

Scheduling, permissions, context access, message limits, and moderation boundaries remain deterministic. The model only creates the final wording.

## Administration principle

Every operational capability should have:

- a backend implementation
- persistent settings
- an administration control
- stored and effective status
- audit coverage
- automated tests
- clear failure behaviour
- documented boundaries

CIND3R3LLA does not hide important behaviour in code while presenting an empty control panel, and it does not present controls that are not connected to real backend behaviour.

## Architecture

```text
SimpleX network
      |
      v
Embedded native SimpleX core
      |
      +--> Profile and event attribution by userId
      |
      +--> Serialized command scheduler
      |
      v
CIND3R3LLA deterministic application layer
      |
      +--> Identity, permissions, consent, routing, moderation
      +--> Interaction engine and plugins
      +--> Archive and public site
      +--> Human supervision and audit
      |
      v
Private local AI
      |
      +--> Intent classification
      +--> Reply wording
      +--> Optional profile text and avatar generation
```

The local AI can support decisions defined by the application. It cannot grant itself authority.

## Security and privacy

Security is part of the architecture, not a marketing checkbox.

- private or loopback AI endpoints
- no automatic cloud fallback
- passwordless passkeys
- TLS and HSTS
- strict response headers
- least privilege system service
- isolated runtime directories
- PostgreSQL backed sessions
- rate limiting
- CSRF protection
- audit logging
- consent gated publication
- separate private and public media paths
- metadata remediation for public media
- explicit failure reporting
- deterministic permission checks
- human takeover for supervised agents

Conversation content is not sent to an external model provider by default.

## Current status

| Capability | Status |
|---|---|
| Embedded SimpleX capture bot | Live |
| Consent first archive | Live |
| Public searchable website | Live |
| Content reports and audited takedowns | Live |
| Hardened administration | Live |
| Local Ollama runtime | Live |
| Independent intent and reply model routing | Live |
| AI model catalog and hardware metadata | Live |
| GPU telemetry | Planned |
| Multi profile core runtime | Active development |
| Serialized multi profile command scheduler | Active development |
| Persistent bot registry | Active development |
| Human operated agent controls | Planned after runtime foundation |
| NPC personality and scheduling engine | Specified |
| Deterministic avatar generator | Specified |
| Local AI avatar and biography generation | Planned |
| Private team based agent training workflow | Planned |
| Additional private transports | Planned |

## Technology

- TypeScript
- Node.js
- Fastify
- PostgreSQL
- htmx
- Tailwind CSS
- WebAuthn and passkeys
- official in process `simplex-chat` core
- Ollama local AI
- systemd and nginx on Debian

## Documentation

The repository contains detailed technical documents for architecture, decisions, security, wire formats, and the feature backlog.

These documents are updated when a runtime boundary becomes stable. Experimental measurements and proposals remain clearly separated from implemented production behaviour.

## Project status

`v0.0.1-alpha`

CIND3R3LLA is a live newcomer project with an unusually broad goal: private community AI that combines persistent identities, human supervision, autonomous characters, consent first knowledge publishing, moderation, and local inference without turning the community into somebody else's dataset.

The project is early, but the foundation is real.

## License

Licensed under the GNU Affero General Public License v3.0. See [LICENSE](LICENSE).

AGPL applies because CIND3R3LLA links the AGPL licensed [`simplex-chat`](https://github.com/simplex-chat/simplex-chat) library.

<div align="center">

Built on <a href="https://simplex.chat/">SimpleX</a>.<br>
Not affiliated with SimpleX Chat.

</div>
