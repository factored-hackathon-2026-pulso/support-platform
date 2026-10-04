"""``SweepSlaRisk``: "Caso por vencer sin respuesta" for supervision (slice 10).

No event says "the first-response SLA is about to expire": time passing is not a fact the
platform records. The sweep turns it into one, deterministically:

- **What.** Every open case (queued, assigned or in progress) without a first response whose
  due time is at most ``SLA_AT_RISK`` (5 min, the same "at risk" as Colas and Equipo) away,
  overdue included.
- **Who.** Every active person with Supervisión.
- **Once.** The idempotency key is ``sla:<caseId>`` (one promise per case, since the
  first-response SLA never moves), so a later sweep never repeats it.
- **When it happened.** ``createdAt`` = the moment the case entered the risk window
  (``slaDueAt − 5 min``, never before the case opened nor after now), so a late sweep does
  not make an old risk look new.
- **Trigger.** The composition root runs it once at startup (after the seed) and then every
  ``CC_NOTIFICATION_SWEEP_SECONDS`` (30 s by default; ``0`` turns it off, as the tests do).
  Tests call ``execute`` directly with a fixed clock.
"""

from __future__ import annotations

from dataclasses import dataclass

from cc_platform.application.cases.supervision import SLA_AT_RISK
from cc_platform.application.notifications.projector import active_with_role
from cc_platform.application.notifications.writer import NotificationDraft, NotificationWriter
from cc_platform.application.ports.clock import Clock
from cc_platform.application.ports.unit_of_work import UnitOfWorkFactory
from cc_platform.domain.cases.values import OPEN_ASSIGNED_STATUSES, CaseStatus
from cc_platform.domain.notifications.notification import NotificationKind
from cc_platform.domain.people.staff import StaffRole

SLA_SOURCE_PREFIX = "sla:"

_OPEN_STATUSES = frozenset({CaseStatus.QUEUED, *OPEN_ASSIGNED_STATUSES})


@dataclass(frozen=True, slots=True)
class SweepSlaRisk:
    uow: UnitOfWorkFactory
    clock: Clock
    writer: NotificationWriter

    async def execute(self) -> int:
        """Write the missing ``sla_at_risk`` notifications; returns how many were written."""
        now = self.clock.now()
        async with self.uow() as uow:
            at_risk = [
                case
                for case in await uow.cases.list_by_statuses(_OPEN_STATUSES)
                if case.first_response_at is None and case.sla_due_at - now <= SLA_AT_RISK
            ]
            if not at_risk:
                return 0
            supervisors = await active_with_role(uow, StaffRole.SUPERVISOR)
        drafts = [
            NotificationDraft(
                kind=NotificationKind.SLA_AT_RISK,
                recipients=supervisors,
                created_at=min(now, max(case.opened_at, case.sla_due_at - SLA_AT_RISK)),
                source_key=f"{SLA_SOURCE_PREFIX}{case.id}",
                case_id=case.id,
                customer_id=case.customer_id,
                language=case.language,
            )
            for case in sorted(at_risk, key=lambda c: (c.sla_due_at, c.id))
        ]
        return len(await self.writer.write(drafts))
