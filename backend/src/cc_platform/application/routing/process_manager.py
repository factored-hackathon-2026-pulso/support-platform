"""Routing process manager (bus subscriber): reacts to committed facts with background work.

- ``case.opened`` → ``RouteCase`` for that case (the customer's POST never waits for it).
- ``staff.availability_changed`` to ``available`` → ``DrainQueue``.

Jobs are idempotent (they re-read the case and skip it if it already moved), so a
duplicate event or a retry is harmless.
"""

from __future__ import annotations

from cc_platform.application.events import EventRecord
from cc_platform.application.ports.background import BackgroundTasks
from cc_platform.application.routing.route_case import DrainQueue, RouteCase
from cc_platform.domain.cases.events import CaseOpened
from cc_platform.domain.people.availability import AvailabilityStatus
from cc_platform.domain.people.events import StaffAvailabilityChanged
from cc_platform.domain.shared.events import DomainEvent

SUBSCRIBED_EVENTS: tuple[type[DomainEvent], ...] = (CaseOpened, StaffAvailabilityChanged)


class RoutingProcessManager:
    def __init__(self, tasks: BackgroundTasks, route_case: RouteCase, drain_queue: DrainQueue):
        self._tasks = tasks
        self._route_case = route_case
        self._drain_queue = drain_queue

    async def __call__(self, record: EventRecord) -> None:
        event = record.event
        if isinstance(event, CaseOpened):
            case_id = event.entity_id

            async def route() -> None:
                await self._route_case.execute(case_id)

            self._tasks.spawn(f"route_case:{case_id}", route)
        elif (
            isinstance(event, StaffAvailabilityChanged)
            and event.to_status == AvailabilityStatus.AVAILABLE.value
        ):
            self._tasks.spawn("drain_queue", self._drain_queue.execute)
