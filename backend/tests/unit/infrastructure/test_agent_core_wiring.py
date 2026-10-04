"""agent-core wiring in the composition root: off by default, on with its two settings."""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from cc_platform.bootstrap.container import build_container
from cc_platform.infrastructure.ai.keys import AgentSigningKeys
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
