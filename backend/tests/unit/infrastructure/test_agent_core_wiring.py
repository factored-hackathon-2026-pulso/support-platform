"""agent-core wiring in the composition root: off by default, on with its two settings."""

from __future__ import annotations

import asyncio
import json
from pathlib import Path

import pytest

from cc_platform.bootstrap.container import build_container
from cc_platform.infrastructure.ai.keys import AgentSigningKeys
from cc_platform.infrastructure.core.clients import ResilientAgentRegistry, ResilientAgentRuntime
from cc_platform.infrastructure.core.resilience import CallKind
from cc_platform.infrastructure.ids import SequentialIdGenerator
from tests.support import make_settings


def write_keys(directory: Path) -> Path:
    path = directory / "private.json"
    path.write_text(
        json.dumps(AgentSigningKeys.generate(suffix="t").private_document()), encoding="utf-8"
    )
    return path


def test_without_settings_the_platform_stays_people_only() -> None:
    container = build_container(make_settings(), ids=SequentialIdGenerator())

    assert container.agent_core is None


async def test_with_url_and_keys_the_issuer_and_runtime_are_built(tmp_path: Path) -> None:
    settings = make_settings(
        agent_core_url="http://agent-core.test", agent_keys_file=write_keys(tmp_path)
    )

    container = build_container(settings, ids=SequentialIdGenerator())

    assert container.agent_core is not None
    credentials = container.agent_core.issuer.customer(bank_customer_id="C-1", session_id="s")
    assert credentials.authorization.count(".") == 2
    await container.shutdown()


def test_the_url_and_the_keys_go_together(tmp_path: Path) -> None:
    with pytest.raises(ValueError, match="go together"):
        make_settings(agent_core_url="http://agent-core.test")
    with pytest.raises(ValueError, match="go together"):
        make_settings(agent_keys_file=write_keys(tmp_path))


async def test_every_call_goes_through_one_guard_built_from_the_settings(tmp_path: Path) -> None:
    """Deploy brief P4: ``CC_CORE_*`` shape the guard; unset model timeouts fall back to
    ``CC_AGENT_CORE_TIMEOUT_SECONDS``."""
    settings = make_settings(
        agent_core_url="http://agent-core.test",
        agent_keys_file=write_keys(tmp_path),
        agent_core_timeout_seconds=40,
        core_timeout_copilot_seconds=15,
        core_timeout_evaluate_seconds=200,
        core_retry_attempts=1,
        core_breaker_failure_threshold=7,
        core_breaker_reset_seconds=12,
    )

    container = build_container(settings, ids=SequentialIdGenerator())

    services = container.agent_core
    assert services is not None
    assert services.guard is not None
    timeouts = services.guard.timeouts
    assert (timeouts.assistant, timeouts.copilot, timeouts.builder) == (40, 15, 40)
    assert (timeouts.registry, timeouts.evaluate) == (30, 200)
    assert services.guard.retry.attempts == 1
    assert services.guard.breaker.state.value == "closed"
    assert isinstance(services.runtime_for(CallKind.COPILOT), ResilientAgentRuntime)
    assert isinstance(services.guarded_registry(), ResilientAgentRegistry)
    assert services.http_client is not None
    assert services.http_client.timeout.connect == 3.0
    await container.shutdown()


def test_without_a_core_the_readiness_check_says_ok() -> None:
    container = build_container(make_settings(), ids=SequentialIdGenerator())

    assert asyncio.run(container.core_status()) == "ok"
