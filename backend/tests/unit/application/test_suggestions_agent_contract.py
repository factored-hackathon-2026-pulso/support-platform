"""The suggestions input and output against agent-core's ``copiloto-sugerencias`` agent.

agent-core's ``input_schema`` takes scalars and one flat list, and rejects a slot it does not
declare or a null. These tests read the agent's YAML and the synthetic cases from agent-core's
repository, kept as a snapshot in ``tests/contracts/copiloto-sugerencias`` (set
``AGENT_CORE_SUGGESTIONS_FIXTURES`` to compare against a live checkout); refresh it when the
agent changes. They check shapes, not the model: no model ran.
"""

from __future__ import annotations

import os
from collections.abc import AsyncIterator, Mapping
from pathlib import Path
from typing import Any

import pytest

from cc_platform.bootstrap.container import Container
from cc_platform.domain.ai.suggestion import (
    ActionSuggestion,
    EscalationSuggestion,
    ReplySuggestion,
    ToolSuggestion,
    normalize_suggestions,
)
from cc_platform.infrastructure.ai.http_runtime import _suggestions
from cc_platform.infrastructure.ai.memory_runtime import InMemoryAgentRuntime
from cc_platform.infrastructure.seed.people import seed_staff_id
from tests.assistant_support import NATALIA, assistant_world, escalation, say, settle
from tests.support import ANALYST, actor_for, customer_actor, make_available_quietly

yaml = pytest.importorskip("yaml")

AGENT = "copiloto-sugerencias@prod"
DANIELA = seed_staff_id(ANALYST.number)


#: A snapshot of agent-core's agent and synthetic cases, copied from its repository (so this runs in
#: CI). ``AGENT_CORE_SUGGESTIONS_FIXTURES`` points at a live checkout to compare against it.
SNAPSHOT = Path(__file__).resolve().parents[2] / "contracts" / "copiloto-sugerencias"


def _fixtures_dir() -> Path | None:
    live = os.environ.get("AGENT_CORE_SUGGESTIONS_FIXTURES")
    for candidate in (live, SNAPSHOT):
        if candidate and (Path(candidate) / "agents").is_dir():
            return Path(candidate)
    return None


FIXTURES = _fixtures_dir()
needs_fixtures = pytest.mark.skipif(
    FIXTURES is None, reason="agent-core's copiloto-sugerencias fixtures are not on this machine"
)


def _load(relative: str) -> Any:
    assert FIXTURES is not None
    return yaml.safe_load((FIXTURES / relative).read_text(encoding="utf-8"))


# ------------------------------------------------------------------ a small input_schema validator
_SCALARS: dict[str, tuple[type, ...]] = {
    "string": (str,),
    "integer": (int,),
    "boolean": (bool,),
}


def schema_errors(schema: Mapping[str, Any], value: Mapping[str, Any]) -> list[str]:
    """What agent-core's engine would reject: a slot not declared (``slot_not_accepted``), a
    missing required one, a null or a wrong type (``slot_type_mismatch``), a list too long."""
    errors: list[str] = []
    for name in value:
        if name not in schema:
            errors.append(f"slot_not_accepted: {name}")
    for name, spec in schema.items():
        if name not in value:
            if spec.get("required"):
                errors.append(f"missing: {name}")
            continue
        errors.extend(_slot_errors(name, spec, value[name]))
    return errors


def _slot_errors(name: str, spec: Mapping[str, Any], item: object) -> list[str]:
    kind = spec["type"]
    if item is None:
        return [f"null: {name}"]
    if kind == "list":
        if not isinstance(item, list):
            return [f"slot_type_mismatch: {name}"]
        errors = []
        if "max_items" in spec and len(item) > spec["max_items"]:
            errors.append(f"too_many_items: {name}")
        for entry in item:
            if not isinstance(entry, dict):
                errors.append(f"slot_type_mismatch: {name}[]")
                continue
            errors.extend(f"{name}[].{e}" for e in schema_errors(spec["items"], entry))
        return errors
    allowed = _SCALARS[kind]
    if not isinstance(item, allowed) or (kind == "integer" and isinstance(item, bool)):
        return [f"slot_type_mismatch: {name}"]
    return []


@needs_fixtures
def test_the_validator_rejects_the_old_nested_shape() -> None:
    """Control: the shape the platform sent before is what the engine answered 422 to."""
    schema = _load("agents/copiloto-sugerencias@1.0.0.yaml")["input_schema"]
    old = {
        "idioma": "es",
        "canal": "chat",
        "prioridad": "normal",
        "sla": {"estado": "a_tiempo", "minutos_restantes": 20},
        "motivo_llegada": None,
        "espera_del_cliente_segundos": 0,
        "sugerencia_anterior": None,
        "turnos": [],
    }

    errors = schema_errors(schema, old)

    assert "slot_not_accepted: sla" in errors
    assert "slot_not_accepted: sugerencia_anterior" in errors
    assert "null: motivo_llegada" in errors
    assert "missing: sla_estado" in errors


@needs_fixtures
def test_the_synthetic_cases_inputs_pass_the_validator() -> None:
    schema = _load("agents/copiloto-sugerencias@1.0.0.yaml")["input_schema"]
    for case in _load("casos/sinteticos.yaml")["casos"]:
        assert schema_errors(schema, case["input"]) == [], case["id"]


# ------------------------------------------------------------------ what the platform sends
@pytest.fixture
def runtime() -> InMemoryAgentRuntime:
    return InMemoryAgentRuntime()


@pytest.fixture
async def world(runtime: InMemoryAgentRuntime, tmp_path: Path) -> AsyncIterator[Container]:
    async for container in assistant_world(
        "memory",
        tmp_path,
        runtime,
        copilot_suggestions_agent=AGENT,
        copilot_suggestions_auto=False,
    ):
        yield container


async def _case_with_daniela(world: Container, runtime: InMemoryAgentRuntime) -> str:
    await make_available_quietly(world.uow, DANIELA)
    runtime.script.append(escalation())
    result = await world.use_cases.cases.post_customer_turn.execute(customer_actor(NATALIA), say())
    await settle(world)
    runtime.calls.clear()
    return result.conversation.case_id


def _inputs(runtime: InMemoryAgentRuntime) -> list[dict[str, Any]]:
    return [c.arguments["input"] for c in runtime.calls if c.operation == "start_run"]  # type: ignore[misc]


@needs_fixtures
async def test_what_the_platform_sends_passes_the_agents_input_schema(
    world: Container, runtime: InMemoryAgentRuntime
) -> None:
    schema = _load("agents/copiloto-sugerencias@1.0.0.yaml")["input_schema"]
    assert world.use_cases.assistant is not None
    assert world.use_cases.assistant.suggestions is not None
    asking = world.use_cases.assistant.suggestions.request
    case_id = await _case_with_daniela(world, runtime)
    full = (
        ReplySuggestion(text="Hola Natalia"),
        EscalationSuggestion(reason_code="rule:x", evidence=("e",)),
    )
    runtime.suggestion_script.extend([(), full, ()])

    await asking.execute(actor_for(ANALYST), case_id, request_key="key-00000001")
    await asking.execute(actor_for(ANALYST), case_id, request_key="key-00000002")
    await asking.execute(actor_for(ANALYST), case_id, request_key="key-00000003")  # after a draft

    sent = _inputs(runtime)
    assert len(sent) == 3
    for agent_input in sent:
        assert schema_errors(schema, agent_input) == [], agent_input
    assert "assistant_session_id" in sent[0]  # a case the assistant held
    assert sent[2]["sugerencia_borrador"] == "ignored"  # replaced by this request
    assert "sugerencia_borrador" not in sent[0]


# ------------------------------------------------------------------ what agent-core answers
@needs_fixtures
def test_the_expected_outputs_of_the_synthetic_cases_parse_without_losing_type_or_text() -> None:
    for case in _load("casos/sinteticos.yaml")["casos"]:
        expected: list[dict[str, Any]] = case["expected"]
        parsed = _suggestions(expected)
        kept = normalize_suggestions(parsed)

        assert len(parsed) == len(expected), case["id"]
        assert len(kept) == len(expected), case["id"]  # nothing dropped, nothing cut
        for raw, item in zip(expected, kept, strict=True):
            assert item.kind == raw["type"], case["id"]
            if isinstance(item, ReplySuggestion):
                assert item.text == raw["text"]
                assert item.citations == tuple(raw.get("citations", ()))
                assert item.language == raw["language"]
            elif isinstance(item, ToolSuggestion):
                assert item.tool == raw["tool"]
                assert item.why == raw["why"]
                assert item.label  # the platform's own
            elif isinstance(item, ActionSuggestion):
                assert (item.tool, item.summary) == (raw["tool"], raw["summary"])
            else:
                assert item.reason_code == raw["reason_code"]
                assert item.evidence == tuple(raw["evidence"])
                assert item.motive_draft == raw["motive_draft"]
