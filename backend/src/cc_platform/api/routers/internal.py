"""Service-to-service routes (not part of the public contract: absent from the OpenAPI document).

Authenticated with a shared secret (``CC_INTERNAL_SERVICE_TOKEN``, ``Authorization: Bearer``),
compared in constant time. Without the secret, or without agent-core, they answer ``404``: nothing
to expose. Consumers: agent-core's ``grant_active`` check (ADR 0003, S17) and the improvement
engine's proposal announcement (ADR 0007).
"""

from __future__ import annotations

import hmac
from datetime import datetime
from typing import Annotated

from fastapi import APIRouter, Header, Path, Query
from pydantic import BaseModel, Field

from cc_platform.api.dependencies import ApiContextDep
from cc_platform.api.routers._assistant import builder_use_cases
from cc_platform.api.schemas import builder as builder_schemas
from cc_platform.api.schemas.common import RequestModel
from cc_platform.application.cases.ports import EvidenceCell
from cc_platform.application.errors import AuthenticationRequiredError
from cc_platform.domain.cases.values import CaseChannel, CasePriority, CaseType, CloseReason
from cc_platform.domain.notifications.notification import (
    MAX_EFFECT,
    MAX_EVIDENCE,
    MAX_EVIDENCE_LINKS,
    MAX_PROBLEM,
    MAX_PROPOSAL_ID,
    MAX_TITLE,
    ImprovementDossier,
)
from cc_platform.domain.people.staff import Language
from cc_platform.domain.shared.errors import NotFoundError

router = APIRouter(prefix="/internal", tags=["internal"], include_in_schema=False)


class GrantStatus(BaseModel):
    active: bool


def _authorize(token: str | None, authorization: str | None) -> None:
    if token is None:
        raise NotFoundError()  # not configured: the route does not exist
    presented = (authorization or "").removeprefix("Bearer ").strip()
    if not hmac.compare_digest(presented.encode(), token.encode()):
        raise AuthenticationRequiredError()


@router.get("/grants/{grantRef}", response_model=GrantStatus)
async def grant_status(
    grant_ref: Annotated[str, Path(alias="grantRef", max_length=128)],
    api: ApiContextDep,
    authorization: Annotated[str | None, Header()] = None,
) -> GrantStatus:
    _authorize(api.internal_token, authorization)
    assistant = api.use_cases.assistant
    if assistant is None:
        raise NotFoundError()
    return GrantStatus(active=await assistant.grant_status.execute(grant_ref))


class AnnounceProposalRequest(RequestModel):
    """The improvement engine's announcement (ADR 0007). Free text is bounded and must carry no
    personal data (422 otherwise); the evidence is case ids, never customer words."""

    proposal_id: str = Field(min_length=1, max_length=MAX_PROPOSAL_ID)
    title: str = Field(min_length=1, max_length=MAX_TITLE)
    problem: str = Field(min_length=1, max_length=MAX_PROBLEM)
    evidence: str = Field(min_length=1, max_length=MAX_EVIDENCE)
    expected_effect: str = Field(min_length=1, max_length=MAX_EFFECT)
    evidence_links: list[str] = Field(default_factory=list, max_length=MAX_EVIDENCE_LINKS)


@router.post(
    "/builder/proposals/announce",
    response_model=builder_schemas.ProposalSummary,
    summary="The improvement engine announces a proposal it created in agent-core",
)
async def announce_proposal(
    body: AnnounceProposalRequest,
    api: ApiContextDep,
    authorization: Annotated[str | None, Header()] = None,
) -> builder_schemas.ProposalSummary:
    _authorize(api.internal_token, authorization)
    dossier = ImprovementDossier(
        title=body.title,
        problem=body.problem,
        evidence=body.evidence,
        expected_effect=body.expected_effect,
        evidence_links=tuple(body.evidence_links),
    )
    announce = (await builder_use_cases(api)).announce
    summary = await announce.execute(body.proposal_id, dossier)
    return builder_schemas.ProposalSummary.model_validate(summary)


@router.get(
    "/evidence/cases",
    summary="Which real cases sit in a cell (the improvement engine's evidence links)",
)
async def evidence_cases(
    api: ApiContextDep,
    *,
    authorization: Annotated[str | None, Header()] = None,
    case_type: Annotated[CaseType | None, Query(alias="caseType")] = None,
    channel: Annotated[CaseChannel | None, Query()] = None,
    language: Annotated[Language | None, Query()] = None,
    priority: Annotated[CasePriority | None, Query()] = None,
    close_reason: Annotated[CloseReason | None, Query(alias="closeReason")] = None,
    opened_from: Annotated[datetime | None, Query(alias="openedFrom")] = None,
    opened_before: Annotated[datetime | None, Query(alias="openedBefore")] = None,
    limit: Annotated[int, Query(ge=1, le=MAX_EVIDENCE_LINKS)] = MAX_EVIDENCE_LINKS,
) -> dict[str, object]:
    _authorize(api.internal_token, authorization)
    cell = EvidenceCell(
        case_type=case_type.value if case_type else None,
        channel=channel.value if channel else None,
        language=language.value if language else None,
        priority=priority.value if priority else None,
        close_reason=close_reason.value if close_reason else None,
        opened_from=opened_from,
        opened_before=opened_before,
    )
    view = await api.use_cases.cases.sample_evidence.execute(cell, limit=limit)
    return {"suppressed": view.suppressed, "matched": view.matched, "caseIds": list(view.case_ids)}
