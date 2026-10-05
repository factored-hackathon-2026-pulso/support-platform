"""Views of the notifications context and the one reader that builds them (slice 10).

A view is the stored notification plus the names and the case facts the frontend needs to
render it (customer, who acted, who it is about, the case's first-response SLA now). Names
are read when the list is read, so a renamed person shows with her current name.
"""

from __future__ import annotations

from collections.abc import Sequence
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from weakref import WeakKeyDictionary

from cc_platform.application.notifications.ports import NotificationCursor
from cc_platform.application.ports.unit_of_work import UnitOfWork
from cc_platform.domain.notifications.notification import (
    ImprovementDossier,
    Notification,
    NotificationKind,
)
from cc_platform.domain.people.staff import Language, Staff, StaffRole
from cc_platform.domain.shared.errors import InvalidValueError
from cc_platform.domain.shared.ids import IdPrefix, is_valid_id


@dataclass(frozen=True, slots=True)
class NotificationView:
    id: str
    kind: NotificationKind
    role: StaffRole
    created_at: datetime
    read_at: datetime | None
    case_id: str | None
    customer_name: str | None
    actor_id: str | None
    actor_name: str | None
    target_id: str | None
    target_name: str | None
    escalation_id: str | None
    language: Language | None
    score: int | None
    failed_attempts: int | None
    sla_due_at: datetime | None
    """The case's first-response due time (``sla_at_risk``; any case kind)."""
    first_response_at: datetime | None
    proposal_id: str | None = None
    agent_id: str | None = None
    improvement: ImprovementDossier | None = None
    """``improvement_proposed``: the engine's dossier summary."""


@dataclass(frozen=True, slots=True)
class NotificationPageView:
    items: tuple[NotificationView, ...]
    unread_count: int
    next_cursor: str | None
    server_time: datetime


@dataclass(frozen=True, slots=True)
class NotificationReadView:
    notification: NotificationView
    changed: bool
    unread_count: int


@dataclass(frozen=True, slots=True)
class NotificationsReadAllView:
    updated: int
    unread_count: int


# ----------------------------------------------------------------------------- cursor
_EPOCH = datetime(1970, 1, 1, tzinfo=UTC)
_MICROSECOND = timedelta(microseconds=1)
_MAX_MICROS_DIGITS = 18


def encode_cursor(position: NotificationCursor) -> str:
    """``<microseconds since the epoch>.<NTF-id>`` (opaque to clients)."""
    micros = (position.created_at - _EPOCH) // _MICROSECOND
    return f"{micros}.{position.notification_id}"


def decode_cursor(cursor: str) -> NotificationCursor:
    """The position a cursor stands for; ``InvalidValueError`` (422) for anything else."""
    micros, sep, notification_id = cursor.partition(".")
    if (
        not sep
        or not micros
        or len(micros) > _MAX_MICROS_DIGITS
        or not micros.isascii()
        or not micros.isdigit()
        or not is_valid_id(notification_id, IdPrefix.NOTIFICATION)
    ):
        raise InvalidValueError("El cursor no es válido.", field="cursor")
    try:
        created_at = _EPOCH + int(micros) * _MICROSECOND
    except OverflowError:
        raise InvalidValueError("El cursor no es válido.", field="cursor") from None
    return NotificationCursor(created_at=created_at, notification_id=notification_id)


# ----------------------------------------------------------------------------- reader
_PEOPLE: WeakKeyDictionary[UnitOfWork, list[Staff]] = WeakKeyDictionary()


async def people_of(uow: UnitOfWork) -> list[Staff]:
    """Every person, read once per Unit of Work (a projection reads them for the recipients,
    the actor check and the names; nothing in this context writes staff)."""
    found = _PEOPLE.get(uow)
    if found is None:
        found = await uow.staff.list()
        _PEOPLE[uow] = found
    return found


class NotificationReader:
    """Builds views in a fixed number of queries (staff, customers, cases), never N+1."""

    def __init__(self, uow: UnitOfWork) -> None:
        self._uow = uow

    async def views(self, notifications: Sequence[Notification]) -> list[NotificationView]:
        if not notifications:
            return []
        staff_names = {person.id: person.name for person in await people_of(self._uow)}
        case_ids = {n.case_id for n in notifications if n.case_id is not None}
        cases = await self._uow.cases.get_many(case_ids) if case_ids else {}
        customer_ids = {n.customer_id for n in notifications if n.customer_id is not None}
        customer_ids |= {case.customer_id for case in cases.values()}
        customers = await self._uow.customers.get_many(customer_ids) if customer_ids else {}
        views: list[NotificationView] = []
        for item in notifications:
            case = cases.get(item.case_id) if item.case_id is not None else None
            customer_id = item.customer_id or (case.customer_id if case is not None else None)
            customer = customers.get(customer_id) if customer_id is not None else None
            views.append(
                NotificationView(
                    id=item.id,
                    kind=item.kind,
                    role=item.role,
                    created_at=item.created_at,
                    read_at=item.read_at,
                    case_id=item.case_id,
                    customer_name=customer.display_name if customer is not None else None,
                    actor_id=item.actor_id,
                    actor_name=staff_names.get(item.actor_id) if item.actor_id else None,
                    target_id=item.target_id,
                    target_name=staff_names.get(item.target_id) if item.target_id else None,
                    escalation_id=item.escalation_id,
                    language=item.language or (case.language if case is not None else None),
                    score=item.score,
                    failed_attempts=item.failed_attempts,
                    sla_due_at=case.sla_due_at if case is not None else None,
                    first_response_at=case.first_response_at if case is not None else None,
                    proposal_id=item.proposal_id,
                    agent_id=item.agent_id,
                    improvement=item.improvement,
                )
            )
        return views
