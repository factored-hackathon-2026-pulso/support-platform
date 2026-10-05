"""The HTTP agent-core registry client: wire mapping, the structured errors, outages
(ADR 0003 §7, slice 16). The shapes are checked against the published schemas in
``tests/contracts/test_agent_core_registry_contract.py``."""

from __future__ import annotations

import json
from collections.abc import Callable

import httpx
import pytest

from cc_platform.application.ai import AgentCredentials, AgentRuntimeUnavailableError
from cc_platform.application.ai.registry import AgentRegistryError, ProposalOrigin, ProposalState
from cc_platform.infrastructure.ai.http_registry import HttpAgentRegistry
from tests.contracts.test_agent_core_registry_contract import (
    DRAFT,
    EVAL_RUN,
    HASH,
    PROPOSAL,
    REPORT,
)

CREDENTIALS = AgentCredentials("header.payload.signature")


def registry(handler: Callable[[httpx.Request], httpx.Response]) -> HttpAgentRegistry:
    client = httpx.AsyncClient(
        base_url="http://agent-core.test", transport=httpx.MockTransport(handler)
    )
    return HttpAgentRegistry(client)


def problem(status: int, code: str, **extra: object) -> httpx.Response:
    body = {
        "type": f"urn:agentcore:registry:{code}",
        "title": code,
        "status": status,
        "code": code,
        "detail": "texto para personas",
        "trace_id": "trace-1",
        **extra,
    }
    return httpx.Response(status, json=body, headers={"content-type": "application/problem+json"})


async def test_a_proposal_is_parsed_with_its_enums_and_dates() -> None:
    api = registry(lambda _request: httpx.Response(201, json=PROPOSAL))

    proposal = await api.create_proposal(
        CREDENTIALS, agent_id="disputas", title="Resumen", origin=ProposalOrigin.BUILDER_CHAT
    )

    assert (proposal.state, proposal.origin) == (ProposalState.DRAFT, ProposalOrigin.MANUAL)
    assert proposal.updated_at.isoformat() == "2026-10-04T15:00:00+00:00"
    assert proposal.base_release_id is None
    assert proposal.candidate_hash is None


async def test_the_list_sends_only_the_filters_given_and_reads_the_page() -> None:
    seen: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        seen.append(request)
        later = {**PROPOSAL, "proposal_id": "p-2", "updated_at": "2026-10-05T09:00:00Z"}
        return httpx.Response(200, json={"items": [later, PROPOSAL], "total": 7})

    api = registry(handler)
    page = await api.list_proposals(CREDENTIALS, limit=50)
    filtered = await api.list_proposals(CREDENTIALS, agent_id="cobros", state="draft", limit=10)

    assert [p.proposal_id for p in page.items] == ["p-2", PROPOSAL["proposal_id"]]
    assert page.total == 7  # every match, not just this page
    assert seen[0].url.path == "/v1/registry/proposals"
    assert dict(seen[0].url.params) == {"limit": "50", "offset": "0"}
    assert dict(seen[1].url.params) == {
        "limit": "10",
        "offset": "0",
        "agent_id": "cobros",
        "state": "draft",
    }
    assert filtered.items[0].updated_at.isoformat() == "2026-10-05T09:00:00+00:00"


async def test_a_list_body_without_items_is_an_outage_not_an_empty_list() -> None:
    api = registry(lambda _request: httpx.Response(200, json={"unexpected": True}))

    with pytest.raises(AgentRuntimeUnavailableError):
        await api.list_proposals(CREDENTIALS)


async def test_the_detail_carries_the_draft_and_the_last_evaluation() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        assert request.url.path == f"/v1/registry/proposals/{PROPOSAL['proposal_id']}"
        return httpx.Response(
            200,
            json={"proposal": PROPOSAL, "changes": [DRAFT], "last_eval": EVAL_RUN, "review": None},
        )

    detail = await registry(handler).get_proposal(
        CREDENTIALS, proposal_id=str(PROPOSAL["proposal_id"])
    )

    assert [c.kind for c in detail.changes] == ["template"]
    assert detail.changes[0].docs.rationale == "Se lee mejor"
    assert detail.last_eval is not None
    assert detail.last_eval.report.items[0].value == "0.9"  # an exact decimal, as text
    assert detail.review is None


async def test_the_review_is_parsed_once_there_is_an_evaluation() -> None:
    review = {
        "functional_changes": [DRAFT],
        "release_changes": [{"field": "max_input_chars", "before": 4000, "after": 6000}],
        "suite": {"kind": "eval_suite", "id": "suite-disputas", "version": "1.0.0"},
        "suite_changes": [],
        "gate": REPORT["items"],
        "yardstick_loosened": [
            {"kind": "floor_loosened", "target": "resolution_rate", "message": "m"}
        ],
    }
    api = registry(
        lambda _r: httpx.Response(
            200, json={"proposal": PROPOSAL, "changes": [], "last_eval": EVAL_RUN, "review": review}
        )
    )

    detail = await api.get_proposal(CREDENTIALS, proposal_id="p")

    assert detail.review is not None
    assert detail.review.release_changes[0].after == 6000
    assert detail.review.yardstick_loosened[0].kind == "floor_loosened"
    assert detail.review.gate[0].passed is True


async def test_the_credential_is_the_only_secret_and_travels_in_the_header() -> None:
    seen: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        seen.append(request)
        return httpx.Response(200, json=PROPOSAL)

    await registry(handler).reopen(CREDENTIALS, proposal_id="p")

    assert seen[0].headers["authorization"] == "Bearer header.payload.signature"
    assert "header.payload.signature" not in repr(CREDENTIALS)
    assert "header.payload.signature" not in str(seen[0].url)


async def test_ids_are_path_segments_and_entity_ids_keep_their_slashes() -> None:
    seen: list[str] = []
    alias = {"agent_id": "a/b", "alias": "prod", "release_id": "rel-1", "status": "active"}

    def handler(request: httpx.Request) -> httpx.Response:
        seen.append(request.url.raw_path.decode())
        return httpx.Response(200, json=alias if "aliases" in seen[-1] else [])

    api = registry(handler)
    await api.list_versions(CREDENTIALS, kind="template", entity_id="t/saludo")
    await api.get_alias(CREDENTIALS, agent_id="a/b", alias="prod")

    assert seen == [
        "/v1/registry/versions/template/t/saludo",
        "/v1/registry/aliases/a%2Fb/prod",  # an id never adds a path segment
    ]


async def test_decimals_are_read_as_numbers_or_numeric_strings() -> None:
    """agent-core's wire has exact JSON numbers; its published schema says numeric strings."""
    as_numbers = {**REPORT, "items": [{**REPORT["items"][0], "value": 0.9, "floor": 0.8}]}
    as_strings = {**REPORT, "items": [{**REPORT["items"][0], "value": "0.9", "floor": "0.8"}]}

    for body in (as_numbers, as_strings):
        report = await registry(lambda _r, b=body: httpx.Response(200, json=b)).evaluate(
            CREDENTIALS, proposal_id="p", suite_id="s"
        )
        assert (report.items[0].value, report.items[0].floor) == ("0.9", "0.8")
        assert report.items[0].base_value is None


async def test_a_validation_problem_carries_its_violations() -> None:
    violations = [
        {"rule": "G0-05", "path": "nodes/n1", "flow": "disputa", "node_id": "n1", "message": "m"}
    ]
    api = registry(lambda _r: problem(422, "validation_failed", violations=violations))

    with pytest.raises(AgentRegistryError) as failed:
        await api.freeze(CREDENTIALS, proposal_id="p")

    error = failed.value
    assert (error.status, error.code) == (422, "validation_failed")
    assert [(v.rule, v.node_id, v.flow) for v in error.violations] == [("G0-05", "n1", "disputa")]
    assert error.detail == "texto para personas"
    assert error.trace_id == "trace-1"


async def test_a_failed_gate_carries_the_report_and_the_run() -> None:
    failed_report = {**REPORT, "verdict": "fail", "eval_run_id": "evr-9"}
    api = registry(lambda _r: problem(409, "gate_failed", payload=failed_report))

    with pytest.raises(AgentRegistryError) as failed:
        await api.evaluate(CREDENTIALS, proposal_id="p", suite_id="s")

    assert failed.value.code == "gate_failed"
    assert failed.value.report is not None
    assert failed.value.report.verdict == "fail"
    assert failed.value.eval_run_id == "evr-9"


async def test_loosening_lists_what_the_proposal_loosens() -> None:
    payload = [{"kind": "floor_loosened", "target": "m", "message": "baja el piso"}]
    api = registry(lambda _r: problem(409, "loosening_not_accepted", payload=payload))

    with pytest.raises(AgentRegistryError) as refused:
        await api.approve(CREDENTIALS, proposal_id="p", candidate_hash=HASH)

    assert [c.target for c in refused.value.yardstick_loosened] == ["m"]


async def test_role_and_state_refusals_keep_their_codes() -> None:
    codes = ["forbidden_role", "step_up_required", "proposal_stale", "not_found", "quota_exceeded"]
    for code in codes:
        status = {"forbidden_role": 403, "step_up_required": 403, "not_found": 404}.get(code, 409)
        api = registry(lambda _r, c=code, s=status: problem(s, c))
        with pytest.raises(AgentRegistryError) as refused:
            await api.publish(CREDENTIALS, proposal_id="p", idempotency_key="k" * 8)
        assert refused.value.code == code


async def test_an_outage_is_not_a_refusal() -> None:
    def down(_request: httpx.Request) -> httpx.Response:
        raise httpx.ConnectError("refused")

    with pytest.raises(AgentRuntimeUnavailableError):
        await registry(down).get_release(CREDENTIALS, release_id="rel-1")
    with pytest.raises(AgentRuntimeUnavailableError):  # a 5xx with no problem body
        await registry(lambda _r: httpx.Response(502, text="bad gateway")).get_release(
            CREDENTIALS, release_id="rel-1"
        )
    with pytest.raises(AgentRuntimeUnavailableError):  # not JSON at all
        await registry(lambda _r: httpx.Response(200, text="<html>")).get_release(
            CREDENTIALS, release_id="rel-1"
        )
    with pytest.raises(AgentRegistryError) as unknown:  # an unknown code is still a refusal
        await registry(lambda _r: problem(401, "credentials_invalid")).get_release(
            CREDENTIALS, release_id="rel-1"
        )
    assert unknown.value.code == "credentials_invalid"
    assert json.dumps(unknown.value.args).count("signature") == 0
