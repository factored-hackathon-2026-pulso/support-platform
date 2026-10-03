"""``AdministrationRealtimeProjector`` (slice 4 §9.2): realtime signals of administration.

Subscribed to the bus like the cases and supervision projectors, built the same way
(payloads come from a presenter that renders the REST schemas). Sockets only *signal*:

- ``directory.updated`` → ``admin:directory`` with ``{staffIds, teamIds}`` (what may have
  changed, never rows): after every administration event about a person (``staff.*``),
  an availability change, an account lock, and every ``team.*`` event. Also after the
  case events that change someone's open cases (``AdminUser.openCases``, which gates
  deactivation and removing Analista or a language): ``case.assigned`` names the previous
  and the new analyst, ``case.closed`` its assignee (``teamIds`` empty: no team count
  changes). Admin screens refetch the users and teams they show.
- ``me.updated`` → ``staff:<id>`` with her fresh ``StaffOut``: after a change of her name or
  email, roles, languages or team; ``team.renamed`` sends one to each active member of the
  team (the role switcher shows the team name).

The raw ``RealtimeProjector`` never forwards these events (``ADMIN_OWNED_EVENTS`` are
suppressed in its ``TopicMapper``). ``team.updated``/``queue.updated`` for "Equipo y colas"
stay with ``SupervisionRealtimeProjector``, which owns the supervision topics.
"""

from __future__ import annotations

from typing import Protocol

from cc_platform.application.events import EventRecord
from cc_platform.application.people.dto import StaffView
from cc_platform.application.ports.realtime import RealtimeHub
from cc_platform.application.ports.unit_of_work import UnitOfWork, UnitOfWorkFactory
from cc_platform.application.realtime.projector import derived_envelope
from cc_platform.application.realtime.topics import Topic
from cc_platform.domain.cases.events import CaseAssigned, CaseClosed
from cc_platform.domain.people.events import (
    STAFF_ADMIN_EVENTS,
    TEAM_EVENTS,
    AccountLocked,
    StaffAvailabilityChanged,
    StaffCreated,
    StaffLanguagesChanged,
    StaffProfileUpdated,
    StaffRolesChanged,
    StaffTeamChanged,
    TeamRenamed,
)
from cc_platform.domain.shared.events import DomainEvent
from cc_platform.domain.shared.json import JsonObject, JsonValue

#: Case events that change an analyst's open cases (§9.2): the admin view of her
#: ``openCases`` must not go stale after supervision reassigns or she closes a case.
CASE_LOAD_EVENTS: tuple[type[DomainEvent], ...] = (CaseAssigned, CaseClosed)

#: Events this projection listens to.
ADMIN_REALTIME_EVENTS: tuple[type[DomainEvent], ...] = (
    *STAFF_ADMIN_EVENTS,
    *TEAM_EVENTS,
    StaffAvailabilityChanged,
    AccountLocked,
    *CASE_LOAD_EVENTS,
)

#: Events whose raw envelopes never reach a socket (this projection signals them).
ADMIN_OWNED_EVENTS: tuple[type[DomainEvent], ...] = (*STAFF_ADMIN_EVENTS, *TEAM_EVENTS)

#: A change of these is a change of her own ``StaffOut`` (``me.updated``).
ME_EVENTS: tuple[type[DomainEvent], ...] = (
    StaffProfileUpdated,
    StaffRolesChanged,
    StaffLanguagesChanged,
    StaffTeamChanged,
)

#: Events after which a team's member counts may have changed.
_MEMBERSHIP_EVENTS: tuple[type[DomainEvent], ...] = STAFF_ADMIN_EVENTS


class AdministrationRealtimePresenter(Protocol):
    """Serialises views exactly like the REST schemas (camelCase JSON)."""

    def staff(self, view: StaffView) -> JsonObject: ...


class AdministrationRealtimeProjector:
    def __init__(
        self, hub: RealtimeHub, uow: UnitOfWorkFactory, presenter: AdministrationRealtimePresenter
    ) -> None:
        self._hub = hub
        self._uow = uow
        self._present = presenter

    async def __call__(self, record: EventRecord) -> None:
        event = record.event
        async with self._uow() as uow:
            staff_ids, team_ids = await self._directory_ids(uow, event)
            if staff_ids or team_ids:
                await self._directory(record, staff_ids, team_ids)
            if isinstance(event, ME_EVENTS):
                await self._me(uow, record, event.entity_id)
            elif isinstance(event, TeamRenamed):
                members = [
                    person.id
                    for person in await uow.staff.list()
                    if person.active and person.team_id == event.entity_id
                ]
                for staff_id in members:
                    await self._me(uow, record, staff_id)

    @staticmethod
    async def _directory_ids(uow: UnitOfWork, event: DomainEvent) -> tuple[list[str], list[str]]:
        if isinstance(event, TEAM_EVENTS):
            return [], [event.entity_id]
        if isinstance(event, CaseAssigned):
            previous = event.previous_analyst_id
            moved = [previous] if previous and previous != event.assigned_analyst_id else []
            return [*moved, event.assigned_analyst_id], []
        if isinstance(event, CaseClosed):
            case = await uow.cases.get(event.entity_id)
            assignee = case.assigned_analyst_id if case is not None else None
            return ([assignee] if assignee else []), []
        team_ids: list[str] = []
        if isinstance(event, StaffCreated):
            team_ids = [event.team_id]
        elif isinstance(event, StaffTeamChanged):
            team_ids = [event.from_team_id, event.to_team_id]
        elif isinstance(event, _MEMBERSHIP_EVENTS):
            staff = await uow.staff.get(event.entity_id)
            team_ids = [staff.team_id] if staff is not None else []
        return [event.entity_id], team_ids

    async def _directory(
        self, record: EventRecord, staff_ids: list[str], team_ids: list[str]
    ) -> None:
        payload: JsonObject = {
            "staffIds": list[JsonValue](staff_ids),
            "teamIds": list[JsonValue](team_ids),
        }
        envelope = derived_envelope(record, "directory.updated", payload, actor_id=record.actor_id)
        await self._hub.publish(str(Topic.admin_directory()), envelope)

    async def _me(self, uow: UnitOfWork, record: EventRecord, staff_id: str) -> None:
        staff = await uow.staff.get(staff_id)
        if staff is None:
            return
        team = await uow.teams.get(staff.team_id)
        if team is None:
            return
        payload = self._present.staff(StaffView.from_staff(staff, team))
        envelope = derived_envelope(record, "me.updated", payload, actor_id=record.actor_id)
        await self._hub.publish(str(Topic.staff(staff_id)), envelope)
