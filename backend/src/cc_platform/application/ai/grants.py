"""``GetGrantStatus``: is an advisor delegation still active? (ADR 0003, S17).

agent-core verifies a delegation's signature and expiry itself, and asks the **assignment issuer**
(this platform) whether the grant is still active (``grant_active``, M9 §3.1 check 3). A grant is
the ``grant_ref`` the platform signed into the delegation: ``<case id>:<staff id>``. It is active
while that person is an active analyst and the **assignee** of that case (open or closed: the
handoff label is sent after the close). It dies when the case is reassigned away, or the person is
deactivated or loses the Analista role, so agent-core stops honouring a delegation that is still
inside its 10 minutes.

Anything malformed or unknown is simply not active (agent-core fails closed anyway).
"""

from __future__ import annotations

from dataclasses import dataclass

from cc_platform.application.ports.unit_of_work import UnitOfWorkFactory
from cc_platform.domain.people.staff import StaffRole
from cc_platform.domain.shared.ids import IdPrefix, is_valid_id


@dataclass(frozen=True, slots=True)
class GetGrantStatus:
    uow: UnitOfWorkFactory

    async def execute(self, grant_ref: str) -> bool:
        case_id, separator, staff_id = grant_ref.partition(":")
        if not separator:
            return False
        if not (is_valid_id(case_id, IdPrefix.CASE) and is_valid_id(staff_id, IdPrefix.STAFF)):
            return False
        async with self.uow() as uow:
            case = await uow.cases.get(case_id)
            staff = await uow.staff.get(staff_id)
        if case is None or staff is None:
            return False
        return staff.active and staff.has_role(StaffRole.ANALYST) and case.is_assignee(staff_id)
