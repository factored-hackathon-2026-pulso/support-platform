# ADR 0009 · Routing customers to the agent of their case type, and pausing it

- Status: **Accepted** (user decisions of 2026-10-05: routing by routing card, pause as a directory exclusion, display names editable by Supervisión). It answers items 4 and 6 of the support-platform team's list of AI pending items (routing by case type; the panel's agent catalog, results per agent and pause).
- Date: 2026-10-05
- Scope: `backend/` (assistant intake, maturity, the agents read model) and agent-core (`registry`, `recepcion`'s directory).
- Related: ADR 0003, ADR 0006 (§1 "agent" stage; slice 22 §3 and §6 name the gaps this closes), agent-core ADR 0021 (transfer between agents), agent-core `RegistryDirectory`.

## Context

Activating an agent for a case type (slice 22) records `agent: active` and promotes the agent's `prod` alias, but "doesn't change anything for the customer": every conversation starts with `CC_ASSISTANT_AGENT` (`recepcion@prod`). Two facts shape the options:

1. **The platform does not know the case type when a customer writes.** The type is set later by a person (slice 18) or, for a new conversation, does not exist yet. A routing rule "by type" cannot run at intake on the platform's side.
2. **agent-core already builds `recepcion`'s directory from the registry.** `RegistryDirectory.members("atencion-cliente")` returns every agent whose `prod` alias points at an active release **and** whose `routing.directory` is that directory; `recepcion`'s `elegir-especialista` model picks among them by `routing.summary` and `routing.examples`, and `accepts` must be set. So an agent that is activated with a routing card **is already reachable from `recepcion`**: what is missing is that the constructor writes that card (it now does: agent-core PR "constructor drafts") and that the platform can tell "this agent serves the type" from "this agent is in the directory".

## Decision (proposed)

### 1. Routing stays in agent-core, by routing card

`recepcion` keeps routing. The type "Cobro indebido" is served by the agent whose card says so: the constructor writes `routing.directory: atencion-cliente`, a `summary` and 3-4 `examples` taken from the type, and `accepts.slots.problema`. Activating the agent (promoting `prod`) is what adds it to the directory. The platform does **not** pick the entry agent per type (it cannot, fact 1).

The platform's part is only to **show** the truth: `GET /ai/stages` gains `routing: 'in_directory' | 'not_in_directory' | 'unknown'` per type, read from the registry (the agent's `prod` alias and its card), so the screen says "Recepción le deriva estos casos" or "Activo, pero recepción no lo ve" (an agent activated without a card). Activation refuses (409 `agent_not_routable`) an agent whose card is missing, because activating it would change nothing.

Cost of this choice: routing quality depends on the card's examples and on `elegir-especialista`'s calibration, not on a rule. That is the same mechanism the demo already uses for `disputas`.

### 2. Pausing an agent

Pause = **the agent leaves the directory without being unpublished**: a `paused` flag the platform sets per type and sends to agent-core, which excludes the agent from `RegistryDirectory.members`. Conversations already with the agent continue; new ones go to a person or to the next agent. Resuming clears the flag. agent-core needs one small, additive change (a `paused_agents` read from the registry, with its audit event); the registry's `prod` alias is not touched, so rollback stays one call.

Alternative considered: pause = point `prod` at the previous release. Rejected: it changes what the customers get instead of stopping it, and a first agent has no previous release.

### 3. Catalog and results per agent (platform only, read models)

- **Catalog with display names:** a platform table `agent_catalog(agent_id, display_name, case_type)`, filled when an agent is activated (name defaults to the type's name, editable by Supervisión). It replaces "humanize the id" in the agents screens.
- **Results per agent:** a projection over `assistant.turn_answered`/`assistant.ended` events (now with the assistant as actor: platform PR #29). It needs agent-core to confirm what `agent` holds after a transfer (`id@alias`); until then it counts by the id before `@`. Per agent and day: sessions, resolved, handed to people.

## Consequences

- No change in `recepcion`'s flow. One additive agent-core change (pause). One migration on the platform (`agent_catalog`, a `paused` column, a results projection). Delete `backend/cc_platform.db` as usual.
- The honest limit stays visible: routing is semantic (card + model), so a type's agent may not receive 100% of its cases. The results per agent measure exactly that.

## Decided

1. Routing by routing card is enough; no classification step at intake.
2. Pause excludes the agent from the directory; conversations in progress continue.
3. Display names are editable by Supervisión (default: the case type's name).
