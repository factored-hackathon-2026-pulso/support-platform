"""``HttpAgentRegistry`` against agent-core's published registry contract (ADR 0003, slice 16).

``agent-core-registry/*.json`` are copies of ``agent-core/contracts/registry/*.json`` (models and
request bodies of ``/v1/registry``; the version is the one in ``agent-core-contract-version.txt``).
agent-core's OpenAPI does not describe the registry routes, so the route table below is taken from
``agent_core/registry/http.py`` and checked by hand when that file changes.

Two directions are checked:

- what the adapter **sends** (path, method, header and body fields) against the route table and the
  published request bodies: a field the contract does not know, or one it requires and the adapter
  omits, fails here;
- what agent-core **answers**: every canned answer below is validated against the published model
  *before* the adapter reads it, so the fixtures stay truthful and the adapter parses real shapes.

The proposal list (``GET /v1/registry/proposals``, contract 1.4.0) is not in
``contracts/registry/``: ``agent-core-registry-listing.json`` is an extract of
``agent-core/contracts/registry-openapi.json`` (that operation and the schemas it uses). Its query
parameters and its ``ProposalPage`` answer are checked against it.

``ProposalDetail``, ``ValidationReport`` and ``CandidateView`` are not published as schemas yet;
they are composed from published pieces (``Proposal``, ``EntityDraft``, ``EvalRun``) and the fields
``registry/service.py`` declares. Ask agent-core to publish them.
"""

from __future__ import annotations

import json
import re
from pathlib import Path
from typing import Any

import httpx
import pytest

from cc_platform.application.ai import AgentCredentials
from cc_platform.application.ai.registry import EntityDraft, ProposalOrigin, VersionDocs
from cc_platform.infrastructure.ai.http_registry import HttpAgentRegistry

HERE = Path(__file__).parent
SCHEMAS = HERE / "agent-core-registry"
LISTING: dict[str, Any] = json.loads(
    (HERE / "agent-core-registry-listing.json").read_text(encoding="utf-8")
)
LISTING_OPERATION: dict[str, Any] = LISTING["paths"]["/v1/registry/proposals"]["get"]
BUILDER = AgentCredentials("a.b.c")
NOW = "2026-10-04T15:00:00Z"
HASH = "ab" * 32

#: ``(method, path template)`` of every call the adapter makes, with the request body it must send
#: (a published schema name) or ``None``. From ``agent_core/registry/http.py``.
ROUTES: dict[tuple[str, str], str | None] = {
    ("POST", "/v1/registry/proposals"): "CreateProposalBody",
    ("GET", "/v1/registry/proposals"): None,  # query parameters: the listing extract
    ("GET", "/v1/registry/proposals/{pid}"): None,
    ("PUT", "/v1/registry/proposals/{pid}/draft"): "PutDraftBody",
    ("POST", "/v1/registry/proposals/{pid}/validate"): None,
    ("POST", "/v1/registry/proposals/{pid}/freeze"): None,
    ("POST", "/v1/registry/proposals/{pid}/reopen"): None,
    ("POST", "/v1/registry/proposals/{pid}/evaluate"): "EvaluateBody",
    ("POST", "/v1/registry/proposals/{pid}/approve"): "ApproveBody",
    ("POST", "/v1/registry/proposals/{pid}/reject"): "ReasonBody",
    ("POST", "/v1/registry/proposals/{pid}/publish"): None,  # Idempotency-Key header
    ("POST", "/v1/registry/aliases/{agent}/{alias}"): "PromoteBody",
    ("GET", "/v1/registry/aliases/{agent}/{alias}"): None,
    ("GET", "/v1/registry/versions/{kind}/{eid}"): None,
    ("POST", "/v1/registry/releases/{rid}/revoke"): "ReasonBody",
    ("GET", "/v1/registry/releases/{rid}"): None,
    ("GET", "/v1/registry/releases/{a}/diff/{b}"): None,
    ("GET", "/v1/registry/entities/{kind}/{eid}"): None,
}


# ----------------------------------------------------------------------------- a small validator
def load(name: str) -> dict[str, Any]:
    data: dict[str, Any] = json.loads((SCHEMAS / f"{name}.json").read_text(encoding="utf-8"))
    return data


def conforms(  # noqa: PLR0912 - one branch per JSON Schema keyword
    value: Any, schema: dict[str, Any], defs: dict[str, Any], path: str = "$"
) -> None:
    """The subset of JSON Schema agent-core's generated models use (no extra dependency)."""
    if "$ref" in schema:
        conforms(value, defs[schema["$ref"].rsplit("/", 1)[-1]], defs, path)
        return
    for key in ("anyOf", "oneOf"):
        if key in schema:
            errors = []
            for option in schema[key]:
                try:
                    conforms(value, option, defs, path)
                    return
                except AssertionError as error:
                    errors.append(str(error))
            raise AssertionError(f"{path}: none of {key} matches ({'; '.join(errors)})")
    if "const" in schema:
        assert value == schema["const"], f"{path}: expected {schema['const']!r}"
    if "enum" in schema:
        assert value in schema["enum"], f"{path}: {value!r} not in {schema['enum']}"
    kind = schema.get("type")
    kinds = {
        "object": dict,
        "array": list,
        "string": str,
        "boolean": bool,
        "null": type(None),
    }
    if kind in kinds:
        assert isinstance(value, kinds[kind]), (
            f"{path}: expected {kind}, got {type(value).__name__}"
        )
    if kind == "integer":
        assert isinstance(value, int)
        assert not isinstance(value, bool), f"{path}: expected integer"
    if kind == "number":
        assert isinstance(value, int | float)
        assert not isinstance(value, bool), f"{path}: number"
    if kind == "string" and "pattern" in schema:
        assert re.search(schema["pattern"], value), f"{path}: {value!r} !~ {schema['pattern']}"
    if kind == "object":
        properties = schema.get("properties", {})
        for name in schema.get("required", []):
            assert name in value, f"{path}: missing required {name!r}"
        if schema.get("additionalProperties") is False:
            extra = set(value) - set(properties)
            assert not extra, f"{path}: unexpected {sorted(extra)}"
        for name, item in value.items():
            if name in properties:
                conforms(item, properties[name], defs, f"{path}.{name}")
            elif isinstance(schema.get("additionalProperties"), dict):
                conforms(item, schema["additionalProperties"], defs, f"{path}.{name}")
    if kind == "array" and "items" in schema:
        for index, item in enumerate(value):
            conforms(item, schema["items"], defs, f"{path}[{index}]")


def check_answer(model: str, value: Any) -> None:
    if model == "ProposalPage":  # from the listing extract (OpenAPI components)
        components = LISTING["components"]["schemas"]
        conforms(value, components[model], components, model)
        return
    schema = load(model)
    conforms(value, schema, schema.get("$defs", {}), model)


# ----------------------------------------------------------------------------- canned answers
DOCS = {"description": "Acorta el resumen", "rationale": "Se lee mejor", "changelog": "1.1.0"}
PROPOSAL = {
    "proposal_id": "0199ab00-0000-7000-8000-000000000001",
    "agent_id": "disputas",
    "origin": "manual",
    "state": "draft",
    "rev": 0,
    "base_release_id": None,
    "title": "Resumen más corto",
    "created_by": "STF-1",
    "candidate_hash": None,
    "updated_at": NOW,
}
DRAFT = {"kind": "template", "content": {"id": "t/resumen", "version": "1.1.0"}, "docs": DOCS}
REF = {"kind": "template", "id": "t/resumen", "version": "1.1.0"}
# The published schema types a decimal as a numeric string; agent-core's own ``dumps`` writes an
# exact JSON number. The adapter reads both (``test_agent_registry.py``).
REPORT = {
    "verdict": "pass",
    "items": [
        {
            "metric_id": "resolution_rate",
            "phase": "new_yardstick",
            "role": "gate",
            "value": "0.9",
            "base_value": None,
            "noise_margin": None,
            "floor": "0.8",
            "passed": True,
            "reason": "",
        }
    ],
    "runs": None,
    "results": [],
    "judge_notes": [],
    "yardstick_changes": [],
    "detail": None,
}
EVAL_RUN = {
    "eval_run_id": "evr-1",
    "proposal_id": PROPOSAL["proposal_id"],
    "candidate_hash": HASH,
    "base_release_id": None,
    "suite": {"kind": "eval_suite", "id": "suite-disputas", "version": "1.0.0"},
    "verdict": "pass",
    "report": REPORT,
    "at": NOW,
}
RELEASE = {
    "release_id": "rel-abababababababab",
    "status": "active",
    "agent_id": "disputas",
    "entities": [{"ref": REF, "content_hash": HASH, "docs": DOCS, "changed_vs_base": True}],
    "knowledge_snapshot": None,
    "proposal_id": PROPOSAL["proposal_id"],
    "base_release_id": None,
    "published_by": "STF-1",
    "published_at": NOW,
    "eval_suite_refs": [],
    "interrupts": [],
    "language_detection": {"id": "lang-detect", "version": "1.0.0"},
    "injection_ruleset": None,
    "max_input_chars": 4000,
}


def answer(method: str, template: str) -> tuple[int, Any]:
    """The answer agent-core gives to ``(method, template)``, validated against its schemas."""
    published: dict[tuple[str, str], tuple[int, str | None, Any]] = {
        ("POST", "/v1/registry/proposals"): (201, "Proposal", PROPOSAL),
        ("GET", "/v1/registry/proposals"): (
            200,
            "ProposalPage",
            {"items": [PROPOSAL, {**PROPOSAL, "origin": "builder_chat"}], "total": 2},
        ),
        ("GET", "/v1/registry/proposals/{pid}"): (
            200,
            None,
            {"proposal": PROPOSAL, "changes": [DRAFT], "last_eval": EVAL_RUN, "review": None},
        ),
        ("PUT", "/v1/registry/proposals/{pid}/draft"): (200, "Proposal", PROPOSAL),
        ("POST", "/v1/registry/proposals/{pid}/validate"): (
            200,
            None,
            {"violations": [], "candidate_hash": HASH, "auto_bumped": [REF]},
        ),
        ("POST", "/v1/registry/proposals/{pid}/freeze"): (
            200,
            None,
            {
                "proposal_id": PROPOSAL["proposal_id"],
                "candidate_hash": HASH,
                "release_id_preview": "rel-abababababababab",
                "new_versions": [REF],
                "auto_bumped": [],
            },
        ),
        ("POST", "/v1/registry/proposals/{pid}/reopen"): (200, "Proposal", PROPOSAL),
        ("POST", "/v1/registry/proposals/{pid}/evaluate"): (200, None, REPORT),
        ("POST", "/v1/registry/proposals/{pid}/approve"): (
            200,
            "Approval",
            {
                "proposal_id": PROPOSAL["proposal_id"],
                "candidate_hash": HASH,
                "actor": "STF-1",
                "decision": "approved",
                "reason": None,
                "yardstick_loosened": [],
                "at": NOW,
            },
        ),
        ("POST", "/v1/registry/proposals/{pid}/reject"): (200, "Proposal", PROPOSAL),
        ("POST", "/v1/registry/proposals/{pid}/publish"): (200, "ReleaseDetail", RELEASE),
        ("POST", "/v1/registry/aliases/{agent}/{alias}"): (
            200,
            "AliasChange",
            {
                "agent_id": "disputas",
                "alias": "prod",
                "before": None,
                "after": RELEASE["release_id"],
                "actor": "STF-1",
                "reason": "ok",
                "at": NOW,
            },
        ),
        ("GET", "/v1/registry/aliases/{agent}/{alias}"): (
            200,
            "AliasState",
            {
                "agent_id": "disputas",
                "alias": "prod",
                "release_id": RELEASE["release_id"],
                "status": "active",
            },
        ),
        ("GET", "/v1/registry/versions/{kind}/{eid}"): (
            200,
            None,
            [
                {
                    "ref": REF,
                    "content_hash": HASH,
                    "docs": DOCS,
                    "created_by": "STF-1",
                    "created_at": NOW,
                }
            ],
        ),
        ("POST", "/v1/registry/releases/{rid}/revoke"): (
            200,
            "ReleaseDetail",
            {**RELEASE, "status": "revoked"},
        ),
        ("GET", "/v1/registry/releases/{rid}"): (200, "ReleaseDetail", RELEASE),
        ("GET", "/v1/registry/releases/{a}/diff/{b}"): (
            200,
            "ReleaseDiff",
            {
                "a": "rel-1",
                "b": "rel-2",
                "added": [REF],
                "removed": [],
                "changed": [{"before": REF, "after": {**REF, "version": "1.2.0"}, "docs": DOCS}],
            },
        ),
        ("GET", "/v1/registry/entities/{kind}/{eid}"): (
            200,
            "EntityVersion",
            {
                "ref": REF,
                "content": {"id": "t/resumen", "version": "1.1.0", "text": "corto"},
                "content_hash": HASH,
                "docs": DOCS,
                "created_by": "STF-1",
                "created_at": NOW,
            },
        ),
    }
    status, model, body = published[(method, template)]
    if model is not None:
        check_answer(model, body)
    return status, body


def template_of(request: httpx.Request) -> str:
    """The route template a concrete request belongs to (and fail if it belongs to none)."""
    parts = request.url.raw_path.decode().split("?")[0].strip("/").split("/")
    for method, template in ROUTES:
        candidate = template.strip("/").split("/")
        if method != request.method:
            continue
        # ``{eid:path}`` takes the rest of the path (an entity id may contain ``/``)
        if template.endswith("{eid}"):
            if len(parts) >= len(candidate) and all(
                c.startswith("{") or c == p for c, p in zip(candidate[:-1], parts, strict=False)
            ):
                return template
        elif len(candidate) == len(parts) and all(
            c.startswith("{") or c == p for c, p in zip(candidate, parts, strict=True)
        ):
            return template
    raise AssertionError(f"{request.method} {request.url.path} is not in agent-core's registry API")


def check_request(request: httpx.Request) -> str:
    template = template_of(request)
    assert request.headers["authorization"] == "Bearer a.b.c"
    body_schema = ROUTES[(request.method, template)]
    if body_schema is None:
        assert not request.content, f"{template} takes no body"
    else:
        schema = load(body_schema)
        body = json.loads(request.content)
        assert set(body) <= set(schema["properties"]), set(body) - set(schema["properties"])
        assert set(schema.get("required", [])) <= set(body), set(schema["required"]) - set(body)
        conforms(body, schema, schema.get("$defs", {}), body_schema)
    if template.endswith("/publish"):
        assert request.headers["idempotency-key"], "publish needs an Idempotency-Key"
    declared = (
        {p["name"] for p in LISTING_OPERATION["parameters"] if p["in"] == "query"}
        if (request.method, template) == ("GET", "/v1/registry/proposals")
        else {"version"}  # ``GET /entities/{kind}/{eid}?version=``
    )
    sent = set(request.url.params.keys())
    assert sent <= declared, f"{template}: query {sorted(sent - declared)} is not in the contract"
    return template


async def test_every_call_of_the_adapter_matches_the_published_registry_contract() -> None:
    seen: list[str] = []

    def handler(request: httpx.Request) -> httpx.Response:
        template = check_request(request)
        seen.append(f"{request.method} {template}")
        status, body = answer(request.method, template)
        return httpx.Response(status, json=body)

    api = HttpAgentRegistry(
        httpx.AsyncClient(base_url="http://agent-core.test", transport=httpx.MockTransport(handler))
    )
    pid = str(PROPOSAL["proposal_id"])
    await api.create_proposal(
        BUILDER, agent_id="disputas", title="Resumen", origin=ProposalOrigin.MANUAL
    )
    await api.get_proposal(BUILDER, proposal_id=pid)
    page = await api.list_proposals(BUILDER, agent_id="disputas", state="draft", limit=50)
    assert [p.proposal_id for p in page.items] == [pid, pid]
    assert page.items[1].origin is ProposalOrigin.BUILDER_CHAT
    assert page.total == 2
    await api.put_draft(
        BUILDER,
        proposal_id=pid,
        expected_rev=0,
        changes=[
            EntityDraft("template", {"id": "t/resumen", "version": "1.1.0"}, VersionDocs(**DOCS))
        ],
    )
    await api.validate(BUILDER, proposal_id=pid)
    await api.freeze(BUILDER, proposal_id=pid)
    await api.reopen(BUILDER, proposal_id=pid)
    await api.evaluate(BUILDER, proposal_id=pid, suite_id="suite-disputas", suite_version="1.0.0")
    await api.evaluate(BUILDER, proposal_id=pid, suite_id="suite-disputas")
    await api.approve(BUILDER, proposal_id=pid, candidate_hash=HASH, accept_yardstick_loosened=True)
    await api.reject(BUILDER, proposal_id=pid, reason="No cumple")
    await api.publish(BUILDER, proposal_id=pid, idempotency_key="publish-0001")
    await api.promote(BUILDER, agent_id="disputas", alias="prod", release_id="rel-1", reason="ok")
    await api.get_alias(BUILDER, agent_id="disputas", alias="prod")
    await api.revoke(BUILDER, release_id="rel-1", reason="error")
    await api.get_release(BUILDER, release_id="rel-1")
    await api.diff_releases(BUILDER, a="rel-1", b="rel-2")
    await api.list_versions(BUILDER, kind="template", entity_id="t/resumen")
    await api.get_entity(BUILDER, kind="template", entity_id="t/resumen", version="1.1.0")

    assert {s.split(" ", 1)[1] for s in seen} == {t for _, t in ROUTES}, "a route is not exercised"


@pytest.mark.parametrize("model", ["Proposal", "EvalRun", "ReleaseDetail", "EntityVersion"])
def test_the_fixtures_would_fail_a_wrong_shape(model: str) -> None:
    """The validator is not vacuous: a field the model does not have is refused."""
    schema = load(model)
    sample = {
        "Proposal": PROPOSAL,
        "EvalRun": EVAL_RUN,
        "ReleaseDetail": RELEASE,
        "EntityVersion": {
            "ref": REF,
            "content": {},
            "content_hash": HASH,
            "docs": DOCS,
            "created_by": "x",
            "created_at": NOW,
        },
    }[model]
    conforms(sample, schema, schema.get("$defs", {}))
    with pytest.raises(AssertionError):
        conforms({**sample, "surprise": 1}, schema, schema.get("$defs", {}))
    first_required = schema["required"][0]
    with pytest.raises(AssertionError):
        conforms(
            {k: v for k, v in sample.items() if k != first_required},
            schema,
            schema.get("$defs", {}),
        )


def test_the_copied_registry_schemas_are_the_version_the_adapter_was_written_for() -> None:
    version = (HERE / "agent-core-contract-version.txt").read_text(encoding="utf-8").strip()

    assert version == "1.4.0"
    assert LISTING["info"]["version"] == "1.0.0"  # the registry API's own version
    assert {p["name"] for p in LISTING_OPERATION["parameters"]} >= {"agent_id", "state", "limit"}
    assert {path.stem for path in SCHEMAS.glob("*.json")} >= {
        "CreateProposalBody",
        "PutDraftBody",
        "EvaluateBody",
        "ApproveBody",
        "ReasonBody",
        "PromoteBody",
    }
