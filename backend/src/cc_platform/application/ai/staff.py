"""The staff side of the assistant (ADR 0003): read the handoff, take a case from the agent,
tell agent-core how a handoff went, and link platform customers to the dataset.

Credentials for agent-core are minted here from who is acting (never from a request body):
an analyst reads a handoff as an ``advisor`` with a short-lived delegation on that one customer,
tied to her. Supervisors hold no customer data (agent-core ADR 0019), so they read no handoff.
"""

from __future__ import annotations

from collections.abc import Mapping
from dataclasses import dataclass
from datetime import timedelta
from functools import partial
from typing import cast

from cc_platform.application.ai.credentials import AgentCredentialIssuer, AgentCredentials
from cc_platform.application.ai.engine import AssistantHandover
from cc_platform.application.ai.errors import AgentCoreRejectedError, AgentCoreUnavailableError
from cc_platform.application.ai.runtime import (
    AgentRuntime,
    AgentRuntimeError,
    AgentRuntimeUnavailableError,
    HandoffQuality,
)
from cc_platform.application.cases.dto import CaseSummaryView
from cc_platform.application.cases.queries import load_case_access, load_case_for
from cc_platform.application.cases.read_model import CaseReader
from cc_platform.application.concurrency import retry_on_conflict
from cc_platform.application.ports.clock import Clock
from cc_platform.application.ports.unit_of_work import UnitOfWork, UnitOfWorkFactory
from cc_platform.application.security import Actor, ensure_any_role
from cc_platform.domain.ai.errors import AssistantNotActiveError, HandoffUnavailableError
from cc_platform.domain.ai.session import HANDOFF_QUALITIES
from cc_platform.domain.cases.case import Case
from cc_platform.domain.cases.values import CaseStatus
from cc_platform.domain.people.staff import StaffRole
from cc_platform.domain.shared.errors import InvalidValueError

#: A delegation lives minutes, not for the whole case: it is minted per call, so there is
#: nothing to revoke when the case is reassigned or closed (agent-core's ``grant_active`` is
#: a demo double until the platform answers it; ADR 0003 §6).
DELEGATION_TTL = timedelta(minutes=10)


def grant_ref(case: Case, staff_id: str) -> str:
    return f"{case.id}:{staff_id}"


async def advisor_credentials(
    uow: UnitOfWork,
    issuer: AgentCredentialIssuer,
    clock: Clock,
    case: Case,
    staff_id: str,
) -> AgentCredentials:
    bank_id = await uow.bank_links.get(case.customer_id)
    if bank_id is None:
        raise HandoffUnavailableError()
    return issuer.advisor(
        staff_id=staff_id,
        bank_customer_id=bank_id,
        grant_ref=grant_ref(case, staff_id),
        expires_at=clock.now() + DELEGATION_TTL,
    )


@dataclass(frozen=True, slots=True)
class GetCaseHandoff:
    """``GET /cases/{caseId}/handoff``: the packet the assistant built, rendered by agent-core
    for the analyst's own permissions (what she may see in clear is decided there)."""

    uow: UnitOfWorkFactory
    clock: Clock
    runtime: AgentRuntime
    issuer: AgentCredentialIssuer

    async def execute(self, actor: Actor, case_id: str) -> dict[str, object]:
        ensure_any_role(actor, {StaffRole.ANALYST})
        async with self.uow() as uow:
            case = await load_case_for(uow, actor, case_id, write=True)  # only her assignee
            session = await uow.assistant_sessions.get_by_case(case.id)
            if session is None or session.handoff_ref is None:
                raise HandoffUnavailableError()
            handoff_ref = session.handoff_ref
            credentials = await advisor_credentials(
                uow, self.issuer, self.clock, case, actor.staff_id
            )
        try:
            return await self.runtime.get_handoff(credentials, handoff_ref=handoff_ref)
        except AgentRuntimeUnavailableError:
            raise AgentCoreUnavailableError() from None
        except AgentRuntimeError as error:
            raise AgentCoreRejectedError(
                agent_core_code=error.code, agent_core_status=error.status
            ) from None


@dataclass(frozen=True, slots=True)
class ReleaseAssistantCase:
    """``POST /supervision/cases/{caseId}/assistant/release``: Supervisión takes a case from the
    assistant. It goes to the language queue and is placed like any arrival (rule 3)."""

    uow: UnitOfWorkFactory
    clock: Clock
    handover: AssistantHandover

    async def execute(self, actor: Actor, case_id: str) -> CaseSummaryView:
        ensure_any_role(actor, {StaffRole.SUPERVISOR})
        return await retry_on_conflict(lambda: self._attempt(actor, case_id))

    async def _attempt(self, actor: Actor, case_id: str) -> CaseSummaryView:
        async with self.uow() as uow:
            case, _access = await load_case_access(uow, actor, case_id, write=False)
            session = await uow.assistant_sessions.get_by_case(case.id)
            if (
                session is None
                or not session.is_active
                or case.status is not CaseStatus.WITH_ASSISTANT
            ):
                raise AssistantNotActiveError()
            ref = actor.acting_as({StaffRole.SUPERVISOR})
            session.release(actor=ref, at=self.clock.now())
            await uow.assistant_sessions.save(session)
            await self.handover.to_people(
                uow, case, reason="supervision", actor=ref, who=actor.name
            )
            summary = await CaseReader(uow).summary(case)
            await uow.commit()
        return summary


@dataclass(frozen=True, slots=True)
class RecordHandoffResolution:
    """Tells agent-core how the handoff went, once, when the analyst closes the case with a
    ``handoffQuality``. Best effort and in the background: a failure here never fails the close
    (the label is training signal, not part of the case)."""

    uow: UnitOfWorkFactory
    clock: Clock
    runtime: AgentRuntime
    issuer: AgentCredentialIssuer

    async def execute(
        self, *, case_id: str, staff_id: str, resolution_code: str, quality: str
    ) -> bool:
        if quality not in HANDOFF_QUALITIES:
            raise InvalidValueError("handoffQuality is not valid", field="handoffQuality")
        async with self.uow() as uow:
            case = await uow.cases.get(case_id)
            session = await uow.assistant_sessions.get_by_case(case_id)
            if (
                case is None
                or session is None
                or session.handoff_ref is None
                or session.handoff_resolved_at is not None
            ):
                return False
            handoff_ref = session.handoff_ref
            credentials = await advisor_credentials(uow, self.issuer, self.clock, case, staff_id)
        try:
            await self.runtime.record_resolution(
                credentials,
                handoff_ref=handoff_ref,
                resolution_code=resolution_code,
                handoff_quality=cast("HandoffQuality", quality),
            )
        except AgentRuntimeUnavailableError:
            raise AgentCoreUnavailableError() from None  # the background runner logs it
        except AgentRuntimeError as error:
            raise AgentCoreRejectedError(
                agent_core_code=error.code, agent_core_status=error.status
            ) from None
        await retry_on_conflict(partial(self._mark, case_id))
        return True

    async def _mark(self, case_id: str) -> None:
        async with self.uow() as uow:
            session = await uow.assistant_sessions.get_by_case(case_id)
            if session is not None and session.mark_handoff_resolved(at=self.clock.now()):
                await uow.assistant_sessions.save(session)
                await uow.commit()


@dataclass(frozen=True, slots=True)
class LinkBankCustomers:
    """Startup: apply ``{platform customer id: dataset customer id}`` (a private file, never
    committed). Unknown platform customers are skipped and counted by the caller's log."""

    uow: UnitOfWorkFactory

    async def execute(self, links: Mapping[str, str]) -> tuple[int, int]:
        """Returns ``(changed, skipped)``."""
        async with self.uow() as uow:
            known = await uow.customers.get_many(set(links))
            usable = {cid: bank for cid, bank in links.items() if cid in known and bank.strip()}
            changed = await uow.bank_links.set_many(usable)
            await uow.commit()
        return changed, len(links) - len(usable)
