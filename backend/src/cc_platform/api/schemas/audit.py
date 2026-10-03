"""Audit schemas (slice 3 contract §5.2). Response members are always present."""

from __future__ import annotations

from datetime import datetime
from typing import Any

from pydantic import Field

from cc_platform.api.schemas.common import ApiModel
from cc_platform.application.audit.catalog import AuditFamily
from cc_platform.application.audit.queries import (
    AuditActorView,
    AuditCaseRefView,
    AuditEventPageView,
    AuditEventView,
)
from cc_platform.domain.shared.actor import ActorRole


class AuditActor(ApiModel):
    role: ActorRole
    id: str
    name: str | None = Field(description="Staff or customer name; null for the platform.")

    @classmethod
    def from_view(cls, view: AuditActorView) -> AuditActor:
        return cls(role=view.role, id=view.id, name=view.name)


class AuditCaseRef(ApiModel):
    id: str
    customer_name: str | None

    @classmethod
    def from_view(cls, view: AuditCaseRefView) -> AuditCaseRef:
        return cls(id=view.id, customer_name=view.customer_name)


class AuditEvent(ApiModel):
    id: str = Field(examples=["EVT-01J…"])
    type: str = Field(description="event_type, e.g. case.assigned.", examples=["case.assigned"])
    family: AuditFamily
    changes_state: bool = Field(description='"CAMBIO": the event changed something.')
    description: str = Field(description="Spanish, from the backend catalog.")
    occurred_at: datetime = Field(description="event_time.")
    ingested_at: datetime
    actor: AuditActor
    entity: str = Field(
        description="case | turn | staff | staff_session | mfa_challenge | customer."
    )
    entity_id: str
    case_ref: AuditCaseRef | None = Field(description="Set when the event concerns a case.")
    payload: dict[str, Any] = Field(
        description="snake_case keys as stored, after redaction (no message text)."
    )
    redacted_fields: list[str] = Field(description="Payload keys removed by the PII policy.")

    @classmethod
    def from_view(cls, view: AuditEventView) -> AuditEvent:
        return cls(
            id=view.id,
            type=view.type,
            family=view.family,
            changes_state=view.changes_state,
            description=view.description,
            occurred_at=view.occurred_at,
            ingested_at=view.ingested_at,
            actor=AuditActor.from_view(view.actor),
            entity=view.entity,
            entity_id=view.entity_id,
            case_ref=AuditCaseRef.from_view(view.case_ref) if view.case_ref else None,
            payload=dict(view.payload),
            redacted_fields=list(view.redacted_fields),
        )


class AuditEventPage(ApiModel):
    items: list[AuditEvent] = Field(description="Newest first.")
    next_cursor: str | None = Field(description="Opaque; null on the last page.")

    @classmethod
    def from_view(cls, view: AuditEventPageView) -> AuditEventPage:
        return cls(
            items=[AuditEvent.from_view(item) for item in view.items],
            next_cursor=view.next_cursor,
        )
