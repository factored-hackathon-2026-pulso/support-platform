# ADR 0006 · AI maturity by case type, behind one switch

- Status: **Accepted** (user decisions of 2026-10-04). The foundation (S18) is built: the AI switch and the case type (contract `api/slice-18-ai-foundation.md`). S19 is built: the assistant's screens (contract `api/slice-19-assistant-screens.md`); decided while building it: turning AI off hands the assistant's open conversations to people (they are released like "Supervisión takes it", reason `ai_disabled`), and with AI on the Workspace's right panel becomes tabs ("Traspaso", "Cliente"; S20 adds the rest). S20–S22 are planned below.
- Date: 2026-10-04
- Scope: `backend/`, `frontend/`, and the agent-core ports the later slices need.
- Related: ADR 0003 (agent-core integration: the assistant, the copilot, the builder; it still stands), ADR 0004 (tool service), ADR 0005 (copilot suggestions: `reply`, `tool`, `action`, `escalate`, with `used` / `edited` / `discarded` / `ignored` feedback; contract `api/slice-15b-copilot-suggestions.md`), `ENGINEERING_BRIEF.md` §1 and §8, contracts `api/slice-14-assistant.md`, `api/slice-15-copilot.md`, `api/slice-16-agent-builder.md`. Design: the AI boards of the canvas (`IaWorkspace`, `IaAutomatizacion`, `IaEt*`, `IaAn*`, `IaSu*`, `IaSim*`).

## Context

ADR 0003 brought AI back through agent-core and its backend is built: an assistant for customers (S14), a copilot for analysts (S15) and an agent builder for Supervisión (S16). None of it has a screen yet, and the three pieces were planned as features side by side. The user's product vision ties them together: **AI matures per kind of case**, and the platform shows that maturity. It also has to stay a credible people-only platform: the pitch shows the platform before and after AI, so everything AI is additive and can be turned off.

## Decision

### 1. The maturity model: stages per case type

Each **case type** (§2) goes through stages. The stage belongs to the type, not to a case:

| Stage | What happens for that type |
|---|---|
| 0 · people only | Analysts solve it alone. The copilot does not learn from it yet. |
| 1 · the analyst asks | The copilot answers what the analyst asks about the case (S15's thread). |
| 2 · the copilot proposes tools | From what the team looks up in these cases, the copilot proposes read-only tools ("Herramientas") and the analyst runs them. |
| 3 · the copilot shadows | It follows the conversation, prepares the tools the team usually runs and proposes a draft reply above the composer; the analyst edits and sends it (or not). |
| agent | The system proposes to Supervisión an autonomous agent for the type; Supervisión tests it and activates it. A type with an agent is served by the assistant (S14); what it cannot resolve it hands to an analyst with the handoff packet. |

The signals that move a type from one stage to the next (how often the copilot's answers were used, tool runs, how many drafts were sent as written, resolution and CSAT of the type) are measured per type with **team-rule thresholds**: values the team chose for the demo, not learned from data, named as such in code and shown as "Política de ejemplo" where the UI states them (brief §2). Moving a type to "agent" is never automatic: the system proposes, a person in Supervisión decides (it reuses S16: a proposal, an evaluation, an approval with a fresh authenticator code, a publication).

### 2. Case type = the dataset's complaint subcategory

The case type is `complaints.subcategory` of the challenge dataset, read from data-lab's committed aggregate report (`reports/demand/complaints_by_subcategory.csv`, names only, never records):

| `CaseType` | Name (UI) | Dataset category |
|---|---|---|
| `none` | Sin tipo | the dataset's `(null)` subcategory; every case opens with it |
| `unrecognized_charge` | Cargo no reconocido | Transactions |
| `undue_charge` | Cobro indebido | Fees |
| `app_issue` | Problema con app | Technical |
| `branch_service` | Atención en sucursal | Branch |
| `service_quality` | Calidad de servicio | Service |
| `virtual_card` | Tarjeta virtual | **team-generated**: a new product the demo shows maturing from zero |

The type is stored on the case and set by its assignee analyst or Supervisión, exactly like the priority (slice 8): same rules, same errors, same realtime. Classifying a case automatically (the assistant's handoff, or the copilot) is a later slice's concern (S21) and goes through the same domain method.

### 3. One switch: "Funciones de IA"

A persisted platform setting, owned by Administración ("Plataforma"), defaulting to `CC_AI_ENABLED` (true in development), audited (`platform.ai_toggled`) and pushed live to every connected staff and customer client (`platform.updated` on `platform:settings`).

- **Off**: the platform is the people-only one, exactly as before AI. New chats never start with the assistant (they go to people, rule 3), the copilot answers `available: false`, the copilot's suggestions (ADR 0005) answer `available: false` and none is made in the background, the builder answers unavailable, and the SPA hides every AI element (in S18, the case type). A conversation the assistant already holds goes to people (S19: released to its language queue with the staff banner "IA desactivada" and the public notice), so no customer is left with an assistant that is off.
- **On, without agent-core configured**: also people-only, as today (the admin screen says the engine is not connected). The case type shows: it is data the team can start collecting before agent-core is wired.
- **On, with agent-core**: the AI layer acts where each type's stage allows it (S19–S22).

The switch is read from the database on every AI entry point (not cached in the process), so it holds across workers once the platform runs on more than one.

### 4. Where the learning lives

Stages 2 and 3 are **the copilot's suggestions (ADR 0005)**, not a new mechanism: a `tool` suggestion is the stage 2 tool proposal ("Herramientas"), a `reply` suggestion is the stage 3 draft above the composer, and their feedback (`used`, `edited` with its edit distance, `discarded`, `ignored`, aggregated per case type) is the core of the stage signals. ADR 0005's `copilot_mode` per case type (`answer | tools | drafts`) is the stage as a switch; S21 computes it from those signals instead of leaving it on by default.

Learning beyond that (which tools to propose, the drafts themselves) belongs to agent-core. The platform defines **ports** for what it needs (per-type tool proposals, a shadowing draft for a turn, stage signals) and calls agent-core through them. For anything else, where agent-core does not provide a capability yet, the slice ships a **development adapter** behind the same port, labelled as such in code and in the UI ("Política de ejemplo" / development), never a hidden fake in production code paths. Replacing it with agent-core's real capability changes no screen.

## Slice plan

| Slice | Scope |
|---|---|
| **S18** | **Foundation (built).** The AI switch (setting, admin "Plataforma", `/auth/me`, the simulator, live updates, gating of the assistant gate, copilot and builder); the case type on the case (`PUT /cases/{caseId}/type`, `case.type_changed`, audit, realtime, seed); regenerated frontend types. Contract `api/slice-18-ai-foundation.md`. |
| S19 | **The assistant in the app (built)** (S14 frontend): the simulator's assistant conversation (working, confirmation, step-up, "Hablar con una persona"), the hand-over to people, the handoff card and the "Traspaso" tab of the right panel, the handoff label at close, Supervisión's "Tomar el caso" in Colas; AI off hands the assistant's conversations to people. Contract `api/slice-19-assistant-screens.md`. |
| S20 | **The support panel** (S15 frontend): Copiloto, Herramientas and Cliente in the Workspace's right panel, next to "Ficha del cliente". Only with the switch on, and only for a case whose customer is linked. |
| S21 | **Learning stages**: per-type stage signals with team-rule thresholds, the copilot's tool proposals (stage 2) and shadowing drafts above the composer (stage 3), the type's stage shown in the Workspace (the stage bars of `IaWorkspace`). Stages 2 and 3 build on the copilot's suggestions (ADR 0005, slice 15b): the `tool` and `reply` kinds are the proposals and the drafts, and their `used` / `edited` feedback per case type feeds the stage signals; no new port for them. The stage drives ADR 0005's `copilot_mode` per type. A port to agent-core, with a clearly labelled development adapter, only for what the suggestions do not provide yet (the stage signals' aggregation if agent-core is to own it). |
| S22 | **Automatización** (Supervisión): the panorama by case type (stage, signals, volume), the proposed agent for a mature type → test → activate on the S16 builder backend, and the agents list and detail. |

## Alternatives rejected

- **A feature flag per AI piece** (assistant, copilot, builder). The pitch needs one before/after switch; per-piece flags multiply the states the people-only app must be tested in. Each piece still has its own availability (agent-core configured, a linked customer, the type's stage).
- **An environment variable only.** Turning AI on or off would need a redeploy, it would not be audited, and clients would not follow live.
- **Our own categories instead of the dataset's subcategories.** The stages are measured per type; grounding the types in the dataset keeps the signals comparable with the data the team analysed. "Tarjeta virtual" is the one team-generated exception, labelled as such.
- **Hiding the case type from the API when AI is off.** The type is data about the case; the switch decides what the SPA shows, not what the API accepts, so turning AI off and on never loses the team's classification.

## Consequences

- The out-of-scope list of the brief keeps its meaning for the people-only app; AI stays additive. Every AI screen of S19–S22 must render nothing while the switch is off, and the e2e suite keeps a scenario that turns it off and on.
- Seeded cases carry types (and their `case.type_changed` events in the audit), whatever the switch says.
- The audit gains two event types (`case.type_changed`, lifecycle; `platform.ai_toggled`, administration).
