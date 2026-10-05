"""``ChangeCaseType`` (slice 18 contract §3): the assignee or supervision says what a case is
about (a dataset complaint subcategory, ``CaseType``). The AI matures per case type (ADR 0006).

It mirrors ``ChangeCasePriority`` (slice 8) in every respect. A ``PUT`` that sets a state, so
it is safe to repeat: the whole body runs in ``retry_on_conflict`` and every rule is
re-evaluated, **in this order**, on the freshly loaded case:

1. the case exists (404 ``not_found``);
2. the caller is its assignee (with the Analista role) or holds Supervisión (any case); an
   analyst who only reads it through history access, or anyone else, gets 403
   ``case_not_assigned``;
3. it is not closed (409 ``case_closed``);
4. it already has that type → **no-op** (``changed: false``, no event, no save), whatever
   the version;
5. the case is still at ``expected_version`` (the version the caller saw), else 409
   ``version_conflict`` with the case as the caller reads it now (``current``): a type is
   never overwritten blindly.

Then ``Case.change_type`` records ``case.type_changed`` ``{from, to}`` and the case is saved
with its compare-and-set. A concurrent save raises ``ConcurrentUpdateError``: the command
re-runs on fresh state, where rule 4 or rule 5 decides.

The type is data about the case: it does not depend on the AI switch (slice 18 §2), which only
decides whether the SPA shows it.
"""

from __future__ import annotations

from dataclasses import dataclass

from cc_platform.application.cases.dto import CaseSummaryView
from cc_platform.application.cases.errors import CaseNotAssignedError
from cc_platform.application.cases.read_model import CaseReader
from cc_platform.application.concurrency import retry_on_conflict
from cc_platform.application.errors import VersionConflictError
from cc_platform.application.ports.clock import Clock
from cc_platform.application.ports.unit_of_work import UnitOfWorkFactory
from cc_platform.application.security import Actor
from cc_platform.domain.cases.errors import CaseClosedError
from cc_platform.domain.cases.values import CaseType
from cc_platform.domain.people.staff import StaffRole
from cc_platform.domain.shared.errors import NotFoundError
from cc_platform.domain.shared.ids import IdPrefix, is_valid_id


@dataclass(frozen=True, slots=True)
class ChangeCaseTypeCommand:
    case_type: CaseType
    expected_version: int
    """The case version the caller saw (``CaseSummary.version``)."""


@dataclass(frozen=True, slots=True)
class CaseTypeResultView:
    changed: bool
    case: CaseSummaryView


@dataclass(frozen=True, slots=True)
class ChangeCaseType:
    uow: UnitOfWorkFactory
    clock: Clock

    async def execute(
        self, actor: Actor, case_id: str, command: ChangeCaseTypeCommand
    ) -> CaseTypeResultView:
        return await retry_on_conflict(lambda: self._attempt(actor, case_id, command))

    async def _attempt(
        self, actor: Actor, case_id: str, command: ChangeCaseTypeCommand
    ) -> CaseTypeResultView:
        async with self.uow() as uow:
            case = await uow.cases.get(case_id) if is_valid_id(case_id, IdPrefix.CASE) else None
            if case is None:
                raise NotFoundError("No encontramos ese caso.", caseId=case_id)
            is_assignee = case.is_assignee(actor.staff_id) and actor.has_any_role(
                {StaffRole.ANALYST}
            )
            if not is_assignee and not actor.has_any_role({StaffRole.SUPERVISOR}):
                raise CaseNotAssignedError()
            if case.is_closed:
                raise CaseClosedError()
            reader = CaseReader(uow)
            if case.case_type is command.case_type:
                return CaseTypeResultView(changed=False, case=await reader.summary(case))
            if case.version != command.expected_version:
                raise VersionConflictError(
                    current_version=case.version, current_view=await reader.summary(case)
                )
            role = StaffRole.ANALYST if is_assignee else StaffRole.SUPERVISOR
            case.change_type(
                actor=actor.acting_as({role}), case_type=command.case_type, at=self.clock.now()
            )
            await uow.cases.save(case)
            summary = await reader.summary(case)
            await uow.commit()
        return CaseTypeResultView(changed=True, case=summary)
