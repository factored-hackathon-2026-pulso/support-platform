"""Audit queries (slice 3 contract §5): who did what, on which case, and when.

Reads the append-only ``event_log`` newest first (``sequence`` descending) with cursor
pagination (``nextCursor`` = the sequence of the last item when more exist; the next page
reads ``sequence < cursor``). Filters combine with AND; the family and "only what changes
something" filters come from the catalog (``catalog.py``), never from the client.

Privacy (§5.4): message text never leaves through the audit API. ``turn.created.text`` is
removed (its length is kept as ``text_length``) and listed in ``redactedFields``: the text
stays readable in the transcript, through the supervisor case view, which is itself
audited (``case.viewed``). The same holds for the customer's rating comment (slice 7:
``case.rated.comment`` → ``comment_length``; staff read it on the closed case) and, slice 9,
an escalation's motive and supervision's answer (``motive_length``, ``note_length``; staff
read them in the case and in "Escalados"). Reading the audit is not audited.

Names are resolved with a fixed number of queries per page (staff, customers, the cases'
customer and language), never one per row. Descriptions are rendered in the reader's UI
language (slice 23c: ``ui_language_of``; Spanish when there is no reader, as in tests).
"""

from __future__ import annotations

from collections.abc import Sequence
from dataclasses import dataclass
from datetime import datetime
from enum import StrEnum

from cc_platform.application.audit.catalog import (
    CHANGES_STATE,
    FAMILY,
    AuditFamily,
    AuditNames,
    describe,
    family_of,
    types_of,
)
from cc_platform.application.events import StoredEvent
from cc_platform.application.pagination import decode_sequence_cursor
from cc_platform.application.people.preferences import ui_language_of
from cc_platform.application.ports.event_log import AuditFilters
from cc_platform.application.ports.unit_of_work import UnitOfWork, UnitOfWorkFactory
from cc_platform.application.security import Actor
from cc_platform.domain.people.preferences import DEFAULT_UI_LANGUAGE, UiLanguage
from cc_platform.domain.shared.actor import ActorRole
from cc_platform.domain.shared.errors import InvalidValueError, NotFoundError
from cc_platform.domain.shared.json import JsonObject

DEFAULT_AUDIT_PAGE = 50
MAX_AUDIT_PAGE = 100


class AuditActorKind(StrEnum):
    """ "Quién": the team (any staff role), customers, or the platform itself."""

    STAFF = "staff"
    CUSTOMER = "customer"
    SYSTEM = "system"


ACTOR_ROLES: dict[AuditActorKind, frozenset[str]] = {
    AuditActorKind.STAFF: frozenset(
        {ActorRole.ANALYST.value, ActorRole.SUPERVISOR.value, ActorRole.ADMIN.value}
    ),
    AuditActorKind.CUSTOMER: frozenset({ActorRole.CUSTOMER.value}),
    AuditActorKind.SYSTEM: frozenset({ActorRole.SYSTEM.value}),
}

#: Payload keys removed by the PII policy, per event type (the value's length is kept).
#: Slice 9: an escalation's motive and supervision's answer are staff text like messages.
#: Slice 12: an email's subject (like its body, the turn text) and an outbound call's reason.
REDACTED_TEXT: dict[str, tuple[str, ...]] = {
    "turn.created": ("text", "subject"),
    "case.rated": ("comment",),
    "escalation.opened": ("motive",),
    "escalation.answered": ("note",),
    "call.started": ("reason",),
}


@dataclass(frozen=True, slots=True)
class AuditQuery:
    actor_kind: AuditActorKind | None = None
    actor_id: str | None = None
    case_id: str | None = None
    family: AuditFamily | None = None
    changes_only: bool = False
    occurred_from: datetime | None = None
    occurred_to: datetime | None = None
    text: str | None = None
    cursor: str | None = None
    limit: int = DEFAULT_AUDIT_PAGE


@dataclass(frozen=True, slots=True)
class AuditActorView:
    role: ActorRole
    id: str
    name: str | None


@dataclass(frozen=True, slots=True)
class AuditCaseRefView:
    id: str
    customer_name: str | None


@dataclass(frozen=True, slots=True)
class AuditEventView:
    id: str
    type: str
    family: AuditFamily
    changes_state: bool
    description: str
    occurred_at: datetime
    ingested_at: datetime
    actor: AuditActorView
    entity: str
    entity_id: str
    case_ref: AuditCaseRefView | None
    payload: JsonObject
    redacted_fields: tuple[str, ...]


@dataclass(frozen=True, slots=True)
class AuditEventPageView:
    items: tuple[AuditEventView, ...]
    next_cursor: str | None


def redact(event_type: str, payload: JsonObject) -> tuple[JsonObject, tuple[str, ...]]:
    """Remove message text (contract §5.4) and rating comments (slice 7); ``<key>_length``
    keeps their size (0 for none)."""
    keys = tuple(key for key in REDACTED_TEXT.get(event_type, ()) if key in payload)
    if not keys:
        return dict(payload), ()
    redacted = {k: v for k, v in payload.items() if k not in keys}
    for key in keys:
        value = payload[key]
        redacted[f"{key}_length"] = len(value) if isinstance(value, str) else 0
    return redacted, keys


def filters_of(query: AuditQuery) -> AuditFilters:
    """Translate the screen's filters into log criteria (family and "changes" via the
    catalog). ``other`` = every type the catalog does not name."""
    if (
        query.occurred_from is not None
        and query.occurred_to is not None
        and query.occurred_from >= query.occurred_to
    ):
        raise InvalidValueError("«Desde» debe ser anterior a «Hasta».", field="from")
    event_types: frozenset[str] | None = None
    exclude: frozenset[str] = frozenset()
    if query.family is AuditFamily.OTHER:
        exclude = frozenset(FAMILY)
    elif query.family is not None:
        event_types = types_of(query.family)
    if query.changes_only:
        event_types = CHANGES_STATE if event_types is None else event_types & CHANGES_STATE
    text = query.text.strip() if query.text else None
    return AuditFilters(
        actor_roles=ACTOR_ROLES[query.actor_kind] if query.actor_kind else None,
        actor_id=query.actor_id,
        case_id=query.case_id,
        event_types=event_types,
        exclude_event_types=exclude,
        occurred_from=query.occurred_from,
        occurred_to=query.occurred_to,
        text=text or None,
    )


def decode_audit_cursor(cursor: str | None) -> int | None:
    return None if cursor is None else decode_sequence_cursor(cursor)


async def reader_language(uow: UnitOfWork, reader: Actor | None) -> UiLanguage:
    """The UI language the log is rendered in: the reader's preference (Spanish without one)."""
    return DEFAULT_UI_LANGUAGE if reader is None else await ui_language_of(uow, reader.staff_id)


async def present_events(
    uow: UnitOfWork,
    events: Sequence[StoredEvent],
    language: UiLanguage = DEFAULT_UI_LANGUAGE,
) -> list[AuditEventView]:
    """Rows of the audit log with names and the description in ``language`` (batched
    lookups)."""
    case_ids = {e.case_id for e in events if e.case_id is not None}
    refs = await uow.cases.refs(case_ids) if case_ids else {}
    customer_ids = {e.actor_id for e in events if e.actor_role == ActorRole.CUSTOMER.value}
    customer_ids |= {ref.customer_id for ref in refs.values()}
    customers = await uow.customers.get_many(customer_ids) if customer_ids else {}
    people = {s.id: s.name for s in await uow.staff.list()}
    people |= {cid: c.display_name for cid, c in customers.items()}
    names = AuditNames(
        people=people,
        case_languages={case_id: ref.language for case_id, ref in refs.items()},
    )
    views = []
    for event in events:
        payload, redacted = redact(event.event_type, event.payload)
        role = ActorRole(event.actor_role)
        case_ref = None
        if event.case_id is not None:
            ref = refs.get(event.case_id)
            customer = customers.get(ref.customer_id) if ref else None
            case_ref = AuditCaseRefView(
                id=event.case_id, customer_name=customer.display_name if customer else None
            )
        views.append(
            AuditEventView(
                id=event.event_id,
                type=event.event_type,
                family=family_of(event.event_type),
                changes_state=event.event_type in CHANGES_STATE,
                description=describe(event, names, language),
                occurred_at=event.event_time,
                ingested_at=event.ingested_at,
                actor=AuditActorView(
                    role=role,
                    id=event.actor_id,
                    name=None if role is ActorRole.SYSTEM else people.get(event.actor_id),
                ),
                entity=event.entity,
                entity_id=event.entity_id,
                case_ref=case_ref,
                payload=payload,
                redacted_fields=redacted,
            )
        )
    return views


@dataclass(frozen=True, slots=True)
class ListAuditEvents:
    uow: UnitOfWorkFactory

    async def execute(self, query: AuditQuery, reader: Actor | None = None) -> AuditEventPageView:
        filters = filters_of(query)
        before = decode_audit_cursor(query.cursor)
        size = max(1, min(query.limit, MAX_AUDIT_PAGE))
        async with self.uow() as uow:
            found = await uow.event_log.search(filters, before=before, limit=size + 1)
            page = found[:size]
            items = await present_events(uow, page, await reader_language(uow, reader))
        more = len(found) > size and bool(page)
        return AuditEventPageView(
            items=tuple(items), next_cursor=str(page[-1].sequence) if more else None
        )


@dataclass(frozen=True, slots=True)
class GetAuditEvent:
    uow: UnitOfWorkFactory

    async def execute(self, event_id: str, reader: Actor | None = None) -> AuditEventView:
        async with self.uow() as uow:
            event = await uow.event_log.get(event_id)
            if event is None:
                raise NotFoundError("No encontramos ese evento.", eventId=event_id)
            (view,) = await present_events(uow, [event], await reader_language(uow, reader))
        return view
