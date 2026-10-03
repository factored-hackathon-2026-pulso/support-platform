"""Audit: who did what, on which case, and when (slice 3 §5). Supervisors and admins.

Reads the append-only event log, newest first, with cursor pagination. Message text is
never returned here (``redactedFields``); it stays in the transcript, read through the
audited supervisor case view. Reading the audit is not itself audited.
"""

from __future__ import annotations

from datetime import UTC, datetime
from typing import Annotated

from fastapi import APIRouter, Depends, Path, Query

from cc_platform.api.dependencies import ApiContextDep, require_roles
from cc_platform.api.schemas.audit import AuditEvent, AuditEventPage
from cc_platform.api.schemas.common import problem_responses
from cc_platform.application.audit.catalog import AuditFamily
from cc_platform.application.audit.queries import (
    DEFAULT_AUDIT_PAGE,
    MAX_AUDIT_PAGE,
    AuditActorKind,
    AuditQuery,
)
from cc_platform.application.security import Actor
from cc_platform.domain.people.staff import StaffRole

router = APIRouter(prefix="/audit", tags=["audit"])

SupervisorOrAdmin = Annotated[Actor, Depends(require_roles(StaffRole.SUPERVISOR, StaffRole.ADMIN))]


def _utc(value: datetime | None) -> datetime | None:
    """A timestamp without a zone is read as UTC."""
    if value is None or value.tzinfo is not None:
        return value
    return value.replace(tzinfo=UTC)


@router.get(
    "/events",
    response_model=AuditEventPage,
    summary="The event log, newest first, with filters",
    description=(
        "Filters combine with AND. `actorKind`: staff (any staff role), customer or system. "
        "`family` and `changesOnly` come from the backend catalog. `from` is inclusive and "
        "`to` exclusive (on the event time). `q` is a case-insensitive contains on ids only "
        "(event, entity, case, actor). `nextCursor` is opaque: pass it as `cursor`."
    ),
    responses=problem_responses(401, 403, 422),
)
async def list_events(
    *,
    _actor: SupervisorOrAdmin,
    api: ApiContextDep,
    actor_kind: Annotated[AuditActorKind | None, Query(alias="actorKind")] = None,
    actor_id: Annotated[str | None, Query(alias="actorId", max_length=120)] = None,
    case_id: Annotated[str | None, Query(alias="caseId", max_length=64)] = None,
    family: AuditFamily | None = None,
    changes_only: Annotated[bool, Query(alias="changesOnly")] = False,
    occurred_from: Annotated[datetime | None, Query(alias="from")] = None,
    occurred_to: Annotated[datetime | None, Query(alias="to")] = None,
    q: Annotated[str | None, Query(min_length=1, max_length=80)] = None,
    cursor: Annotated[str | None, Query(max_length=32)] = None,
    limit: Annotated[int, Query(ge=1, le=MAX_AUDIT_PAGE)] = DEFAULT_AUDIT_PAGE,
) -> AuditEventPage:
    page = await api.use_cases.audit.list_events.execute(
        AuditQuery(
            actor_kind=actor_kind,
            actor_id=actor_id,
            case_id=case_id,
            family=family,
            changes_only=changes_only,
            occurred_from=_utc(occurred_from),
            occurred_to=_utc(occurred_to),
            text=q,
            cursor=cursor,
            limit=limit,
        )
    )
    return AuditEventPage.from_view(page)


@router.get(
    "/events/{eventId}",
    response_model=AuditEvent,
    summary="One event of the log (redacted like the list)",
    responses=problem_responses(401, 403, 404),
)
async def get_event(
    event_id: Annotated[str, Path(alias="eventId", max_length=64, examples=["EVT-01J…"])],
    _actor: SupervisorOrAdmin,
    api: ApiContextDep,
) -> AuditEvent:
    return AuditEvent.from_view(await api.use_cases.audit.get_event.execute(event_id))
