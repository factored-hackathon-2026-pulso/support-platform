"""``HttpAgentRegistry``: the HTTP client of agent-core's registry API (``/v1/registry``).

Speaks ``agent-core/agent_core/registry/http.py`` (snake_case JSON; the bodies and models are the
ones published in ``contracts/registry/*.json``). Credentials travel only in the ``Authorization``
header; neither they nor draft content are ever logged or put in an exception. A timeout, a
network failure or a 5xx without a problem body is ``AgentRuntimeUnavailableError``; an
``application/problem+json`` answer is ``AgentRegistryError`` with its stable ``code`` (the
structured parts the platform shows, like violations and failed gate reports, are parsed here).
"""

from __future__ import annotations

import contextlib
from collections.abc import Mapping, Sequence
from datetime import datetime
from typing import Any, Literal, cast
from urllib.parse import quote

import httpx

from cc_platform.application.ai.credentials import AgentCredentials
from cc_platform.application.ai.registry import (
    AgentRegistryError,
    AliasChange,
    AliasState,
    Approval,
    ApprovalReview,
    CandidateView,
    ChangedRef,
    EntityDraft,
    EntityInRelease,
    EntityRef,
    EntityVersion,
    EvalReport,
    EvalRun,
    GateItem,
    Proposal,
    ProposalDetail,
    ProposalOrigin,
    ProposalPage,
    ProposalState,
    ReleaseDetail,
    ReleaseDiff,
    ReleaseSettingChange,
    ReleaseStatus,
    ValidationReport,
    Verdict,
    VersionDocs,
    VersionRef,
    VersionSummary,
    Violation,
    YardstickChange,
)
from cc_platform.application.ai.runtime import AgentRuntimeUnavailableError
from cc_platform.domain.shared.json import JsonObject, JsonValue

DEFAULT_TIMEOUT_SECONDS = 60.0
_PREFIX = "/v1/registry"


# ----------------------------------------------------------------------------- parsing
def _dt(value: object) -> datetime:
    return datetime.fromisoformat(str(value).replace("Z", "+00:00"))


def _opt(value: object) -> str | None:
    return None if value is None else str(value)


def _num(value: object) -> str | None:
    """A decimal as text: agent-core sends exact decimals as JSON numbers."""
    return None if value is None else str(value)


def _obj(value: object) -> JsonObject:
    return cast("JsonObject", value) if isinstance(value, dict) else {}


def _objs(value: object) -> tuple[JsonObject, ...]:
    return tuple(_obj(v) for v in value) if isinstance(value, list) else ()


def _ref(raw: Mapping[str, Any]) -> VersionRef:
    return VersionRef(kind=str(raw["kind"]), id=str(raw["id"]), version=str(raw["version"]))


def _refs(raw: object) -> tuple[VersionRef, ...]:
    return tuple(_ref(r) for r in raw) if isinstance(raw, list) else ()


def _docs(raw: Mapping[str, Any]) -> VersionDocs:
    return VersionDocs(
        description=str(raw["description"]),
        rationale=str(raw["rationale"]),
        changelog=str(raw["changelog"]),
    )


def _entity_ref(raw: Mapping[str, Any]) -> EntityRef:
    return EntityRef(id=str(raw["id"]), version=str(raw["version"]))


def _draft(raw: Mapping[str, Any]) -> EntityDraft:
    return EntityDraft(kind=str(raw["kind"]), content=_obj(raw["content"]), docs=_docs(raw["docs"]))


def _drafts(raw: object) -> tuple[EntityDraft, ...]:
    return tuple(_draft(d) for d in raw) if isinstance(raw, list) else ()


def _proposal(raw: Mapping[str, Any]) -> Proposal:
    return Proposal(
        proposal_id=str(raw["proposal_id"]),
        agent_id=str(raw["agent_id"]),
        origin=ProposalOrigin(str(raw["origin"])),
        state=ProposalState(str(raw["state"])),
        rev=int(raw.get("rev", 0)),
        base_release_id=_opt(raw.get("base_release_id")),
        title=str(raw["title"]),
        created_by=str(raw["created_by"]),
        candidate_hash=_opt(raw.get("candidate_hash")),
        updated_at=_dt(raw["updated_at"]),
    )


def _violation(raw: Mapping[str, Any]) -> Violation:
    return Violation(
        rule=str(raw["rule"]),
        flow=_opt(raw.get("flow")),
        node_id=_opt(raw.get("node_id")),
        path=_opt(raw.get("path")),
        message=str(raw["message"]),
    )


def _yardstick(raw: object) -> tuple[YardstickChange, ...]:
    if not isinstance(raw, list):
        return ()
    return tuple(
        YardstickChange(kind=str(c["kind"]), target=str(c["target"]), message=str(c["message"]))
        for c in raw
    )


def _gate_item(raw: Mapping[str, Any]) -> GateItem:
    return GateItem(
        metric_id=str(raw["metric_id"]),
        phase=str(raw["phase"]),
        role=_opt(raw.get("role")),
        value=_num(raw.get("value")),
        base_value=_num(raw.get("base_value")),
        noise_margin=_num(raw.get("noise_margin")),
        floor=_num(raw.get("floor")),
        passed=bool(raw["passed"]),
        reason=str(raw.get("reason", "")),
    )


def _gate(raw: object) -> tuple[GateItem, ...]:
    return tuple(_gate_item(i) for i in raw) if isinstance(raw, list) else ()


def _report(raw: Mapping[str, Any]) -> EvalReport:
    runs = raw.get("runs")
    return EvalReport(
        verdict=cast("Verdict", raw["verdict"]),
        items=_gate(raw.get("items")),
        yardstick_changes=_yardstick(raw.get("yardstick_changes")),
        detail=_opt(raw.get("detail")),
        runs=_obj(runs) if isinstance(runs, dict) else None,
        results=_objs(raw.get("results")),
        judge_notes=_objs(raw.get("judge_notes")),
    )


def _eval_run(raw: Mapping[str, Any]) -> EvalRun:
    return EvalRun(
        eval_run_id=str(raw["eval_run_id"]),
        proposal_id=str(raw["proposal_id"]),
        candidate_hash=str(raw["candidate_hash"]),
        base_release_id=_opt(raw.get("base_release_id")),
        suite=_ref(raw["suite"]),
        verdict=cast("Verdict", raw["verdict"]),
        report=_report(raw["report"]),
        at=_dt(raw["at"]),
    )


def _review(raw: Mapping[str, Any]) -> ApprovalReview:
    return ApprovalReview(
        functional_changes=_drafts(raw.get("functional_changes")),
        release_changes=tuple(
            ReleaseSettingChange(
                field=str(c["field"]),
                before=cast("JsonValue", c.get("before")),
                after=cast("JsonValue", c.get("after")),
            )
            for c in raw.get("release_changes", [])
        ),
        suite=_ref(raw["suite"]),
        suite_changes=_drafts(raw.get("suite_changes")),
        gate=_gate(raw.get("gate")),
        yardstick_loosened=_yardstick(raw.get("yardstick_loosened")),
    )


def _release(raw: Mapping[str, Any]) -> ReleaseDetail:
    injection = raw.get("injection_ruleset")
    return ReleaseDetail(
        release_id=str(raw["release_id"]),
        status=cast("ReleaseStatus", raw["status"]),
        agent_id=str(raw["agent_id"]),
        entities=tuple(
            EntityInRelease(
                ref=_ref(e["ref"]),
                content_hash=str(e["content_hash"]),
                docs=_docs(e["docs"]),
                changed_vs_base=bool(e["changed_vs_base"]),
            )
            for e in raw.get("entities", [])
        ),
        knowledge_snapshot=_opt(raw.get("knowledge_snapshot")),
        proposal_id=_opt(raw.get("proposal_id")),
        base_release_id=_opt(raw.get("base_release_id")),
        published_by=str(raw["published_by"]),
        published_at=_dt(raw["published_at"]),
        eval_suite_refs=_refs(raw.get("eval_suite_refs")),
        interrupts=_objs(raw.get("interrupts")),
        language_detection=_entity_ref(raw["language_detection"]),
        injection_ruleset=_entity_ref(injection) if isinstance(injection, dict) else None,
        max_input_chars=int(raw["max_input_chars"]),
    )


def _problem_error(response: httpx.Response) -> Exception:
    """The error of a failed call: unavailable when agent-core itself failed, else the problem."""
    body: Any = None
    with contextlib.suppress(ValueError):
        body = response.json()
    problem: dict[str, Any] = body if isinstance(body, dict) else {}
    code = str(problem.get("code", "unknown"))
    if response.status_code >= 500 and code in {"unknown", "internal_error"}:
        return AgentRuntimeUnavailableError(f"agent-core failed ({response.status_code})")
    detail = str(problem.get("detail") or "")
    payload = cast("JsonValue", problem.get("payload"))
    violations: tuple[Violation, ...] = ()
    report: EvalReport | None = None
    eval_run_id: str | None = None
    loosened: tuple[YardstickChange, ...] = ()
    if code == "validation_failed" and isinstance(problem.get("violations"), list):
        violations = tuple(_violation(v) for v in problem["violations"])
    elif code == "gate_failed" and isinstance(payload, dict) and "verdict" in payload:
        report = _report(payload)
        eval_run_id = _opt(payload.get("eval_run_id"))
    elif code == "loosening_not_accepted":
        loosened = _yardstick(payload)
    return AgentRegistryError(
        status=response.status_code,
        code=code,
        detail=detail,
        payload=payload,
        trace_id=_opt(problem.get("trace_id")),
        violations=violations,
        report=report,
        eval_run_id=eval_run_id,
        yardstick_loosened=loosened,
    )


def _segment(value: str) -> str:
    """One path segment (an id that is not allowed to add ``/`` or ``..``)."""
    return quote(value, safe="")


def _entity_path(value: str) -> str:
    """An entity id may contain ``/`` (``t/saludo``): agent-core takes it as a path."""
    return "/".join(quote(part, safe="") for part in value.split("/"))


class HttpAgentRegistry:
    def __init__(self, client: httpx.AsyncClient) -> None:
        """``client`` carries the ``base_url`` and the timeout; the caller owns its lifetime."""
        self._client = client

    async def _call(
        self,
        method: str,
        path: str,
        credentials: AgentCredentials,
        *,
        json: dict[str, Any] | None = None,
        params: dict[str, str] | None = None,
        extra_headers: dict[str, str] | None = None,
    ) -> Any:
        headers = {"Authorization": f"Bearer {credentials.authorization}", **(extra_headers or {})}
        try:
            response = await self._client.request(
                method, f"{_PREFIX}{path}", headers=headers, json=json, params=params
            )
        except httpx.HTTPError:
            raise AgentRuntimeUnavailableError("agent-core did not answer") from None
        if response.status_code >= 400:
            raise _problem_error(response)
        try:
            body = response.json()
        except ValueError:
            raise AgentRuntimeUnavailableError("agent-core answered an unexpected body") from None
        return body

    # ------------------------------------------------------------------ proposals
    async def create_proposal(
        self,
        credentials: AgentCredentials,
        *,
        agent_id: str,
        title: str,
        origin: ProposalOrigin = ProposalOrigin.MANUAL,
    ) -> Proposal:
        data = await self._call(
            "POST",
            "/proposals",
            credentials,
            json={"agent_id": agent_id, "origin": origin.value, "title": title},
        )
        return _proposal(data)

    async def list_proposals(
        self,
        credentials: AgentCredentials,
        *,
        agent_id: str | None = None,
        state: str | None = None,
        limit: int = 50,
        offset: int = 0,
    ) -> ProposalPage:
        params = {"limit": str(limit), "offset": str(offset)}
        if agent_id is not None:
            params["agent_id"] = agent_id
        if state is not None:
            params["state"] = state
        data = await self._call("GET", "/proposals", credentials, params=params)
        items = data.get("items") if isinstance(data, dict) else None
        if not isinstance(items, list):
            raise AgentRuntimeUnavailableError("agent-core answered an unexpected body")
        return ProposalPage(
            items=tuple(_proposal(item) for item in items),
            total=int(data.get("total", len(items))),
        )

    async def get_proposal(
        self, credentials: AgentCredentials, *, proposal_id: str
    ) -> ProposalDetail:
        data = await self._call("GET", f"/proposals/{_segment(proposal_id)}", credentials)
        last_eval, review = data.get("last_eval"), data.get("review")
        return ProposalDetail(
            proposal=_proposal(data["proposal"]),
            changes=_drafts(data.get("changes")),
            last_eval=_eval_run(last_eval) if isinstance(last_eval, dict) else None,
            review=_review(review) if isinstance(review, dict) else None,
        )

    async def put_draft(
        self,
        credentials: AgentCredentials,
        *,
        proposal_id: str,
        expected_rev: int,
        changes: Sequence[EntityDraft],
    ) -> Proposal:
        body = {
            "expected_rev": expected_rev,
            "changes": [
                {
                    "kind": c.kind,
                    "content": c.content,
                    "docs": {
                        "description": c.docs.description,
                        "rationale": c.docs.rationale,
                        "changelog": c.docs.changelog,
                    },
                }
                for c in changes
            ],
        }
        data = await self._call(
            "PUT", f"/proposals/{_segment(proposal_id)}/draft", credentials, json=body
        )
        return _proposal(data)

    async def validate(
        self, credentials: AgentCredentials, *, proposal_id: str
    ) -> ValidationReport:
        data = await self._call("POST", f"/proposals/{_segment(proposal_id)}/validate", credentials)
        return ValidationReport(
            violations=tuple(_violation(v) for v in data.get("violations", [])),
            candidate_hash=_opt(data.get("candidate_hash")),
            auto_bumped=_refs(data.get("auto_bumped")),
        )

    async def freeze(self, credentials: AgentCredentials, *, proposal_id: str) -> CandidateView:
        data = await self._call("POST", f"/proposals/{_segment(proposal_id)}/freeze", credentials)
        return CandidateView(
            proposal_id=str(data["proposal_id"]),
            candidate_hash=str(data["candidate_hash"]),
            release_id_preview=str(data["release_id_preview"]),
            new_versions=_refs(data.get("new_versions")),
            auto_bumped=_refs(data.get("auto_bumped")),
        )

    async def reopen(self, credentials: AgentCredentials, *, proposal_id: str) -> Proposal:
        data = await self._call("POST", f"/proposals/{_segment(proposal_id)}/reopen", credentials)
        return _proposal(data)

    async def evaluate(
        self,
        credentials: AgentCredentials,
        *,
        proposal_id: str,
        suite_id: str,
        suite_version: str | None = None,
    ) -> EvalReport:
        body: dict[str, Any] = {"suite_id": suite_id}
        if suite_version is not None:
            body["suite_version"] = suite_version
        data = await self._call(
            "POST", f"/proposals/{_segment(proposal_id)}/evaluate", credentials, json=body
        )
        return _report(data)

    async def approve(
        self,
        credentials: AgentCredentials,
        *,
        proposal_id: str,
        candidate_hash: str,
        accept_yardstick_loosened: bool = False,
    ) -> Approval:
        data = await self._call(
            "POST",
            f"/proposals/{_segment(proposal_id)}/approve",
            credentials,
            json={
                "candidate_hash": candidate_hash,
                "accept_yardstick_loosened": accept_yardstick_loosened,
            },
        )
        return _approval(data)

    async def reject(
        self, credentials: AgentCredentials, *, proposal_id: str, reason: str
    ) -> Proposal:
        data = await self._call(
            "POST",
            f"/proposals/{_segment(proposal_id)}/reject",
            credentials,
            json={"reason": reason},
        )
        return _proposal(data)

    async def publish(
        self, credentials: AgentCredentials, *, proposal_id: str, idempotency_key: str
    ) -> ReleaseDetail:
        data = await self._call(
            "POST",
            f"/proposals/{_segment(proposal_id)}/publish",
            credentials,
            extra_headers={"Idempotency-Key": idempotency_key},
        )
        return _release(data)

    # ------------------------------------------------------------------ aliases and releases
    async def promote(
        self,
        credentials: AgentCredentials,
        *,
        agent_id: str,
        alias: str,
        release_id: str,
        reason: str = "",
    ) -> AliasChange:
        data = await self._call(
            "POST",
            f"/aliases/{_segment(agent_id)}/{_segment(alias)}",
            credentials,
            json={"release_id": release_id, "reason": reason},
        )
        return AliasChange(
            agent_id=str(data["agent_id"]),
            alias=str(data["alias"]),
            before=_opt(data.get("before")),
            after=str(data["after"]),
            actor=str(data["actor"]),
            reason=str(data.get("reason", "")),
            at=_dt(data["at"]),
        )

    async def revoke(
        self, credentials: AgentCredentials, *, release_id: str, reason: str
    ) -> ReleaseDetail:
        data = await self._call(
            "POST",
            f"/releases/{_segment(release_id)}/revoke",
            credentials,
            json={"reason": reason},
        )
        return _release(data)

    async def get_alias(
        self, credentials: AgentCredentials, *, agent_id: str, alias: str
    ) -> AliasState:
        data = await self._call(
            "GET", f"/aliases/{_segment(agent_id)}/{_segment(alias)}", credentials
        )
        return AliasState(
            agent_id=str(data["agent_id"]),
            alias=str(data["alias"]),
            release_id=str(data["release_id"]),
            status=cast("ReleaseStatus", data["status"]),
        )

    async def get_release(self, credentials: AgentCredentials, *, release_id: str) -> ReleaseDetail:
        return _release(await self._call("GET", f"/releases/{_segment(release_id)}", credentials))

    async def diff_releases(self, credentials: AgentCredentials, *, a: str, b: str) -> ReleaseDiff:
        data = await self._call("GET", f"/releases/{_segment(a)}/diff/{_segment(b)}", credentials)
        return ReleaseDiff(
            a=str(data["a"]),
            b=str(data["b"]),
            added=_refs(data.get("added")),
            removed=_refs(data.get("removed")),
            changed=tuple(
                ChangedRef(before=_ref(c["before"]), after=_ref(c["after"]), docs=_docs(c["docs"]))
                for c in data.get("changed", [])
            ),
        )

    # ------------------------------------------------------------------ entities
    async def list_versions(
        self, credentials: AgentCredentials, *, kind: str, entity_id: str
    ) -> tuple[VersionSummary, ...]:
        data = await self._call(
            "GET", f"/versions/{_segment(kind)}/{_entity_path(entity_id)}", credentials
        )
        return tuple(
            VersionSummary(
                ref=_ref(v["ref"]),
                content_hash=str(v["content_hash"]),
                docs=_docs(v["docs"]),
                created_by=str(v["created_by"]),
                created_at=_dt(v["created_at"]),
            )
            for v in data
        )

    async def get_entity(
        self,
        credentials: AgentCredentials,
        *,
        kind: str,
        entity_id: str,
        version: str | None = None,
    ) -> EntityVersion:
        data = await self._call(
            "GET",
            f"/entities/{_segment(kind)}/{_entity_path(entity_id)}",
            credentials,
            params={"version": version} if version is not None else None,
        )
        return EntityVersion(
            ref=_ref(data["ref"]),
            content=_obj(data["content"]),
            content_hash=str(data["content_hash"]),
            docs=_docs(data["docs"]),
            created_by=str(data["created_by"]),
            created_at=_dt(data["created_at"]),
        )


def _approval(raw: Mapping[str, Any]) -> Approval:
    return Approval(
        proposal_id=str(raw["proposal_id"]),
        candidate_hash=str(raw["candidate_hash"]),
        actor=str(raw["actor"]),
        decision=cast("Literal['approved', 'rejected']", raw["decision"]),
        reason=_opt(raw.get("reason")),
        yardstick_loosened=_yardstick(raw.get("yardstick_loosened")),
        at=_dt(raw["at"]),
    )
