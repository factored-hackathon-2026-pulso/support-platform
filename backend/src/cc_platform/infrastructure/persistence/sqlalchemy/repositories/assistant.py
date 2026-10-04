"""SQLAlchemy repositories of the ``ai`` context (ADR 0003)."""

from __future__ import annotations

from collections.abc import Mapping
from datetime import datetime
from typing import Any, Literal, cast

from sqlalchemy import insert, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from cc_platform.domain.ai.copilot import CopilotMessage, CopilotThread
from cc_platform.domain.ai.session import (
    AgentInput,
    AssistantSession,
    AssistantState,
    PendingConfirmation,
    PendingStepUp,
)
from cc_platform.domain.shared.json import iso_utc
from cc_platform.infrastructure.persistence.sqlalchemy import tables
from cc_platform.infrastructure.persistence.sqlalchemy.repositories.base import (
    Row,
    VersionedRepository,
)


def input_to_json(item: AgentInput | None) -> dict[str, Any] | None:
    if item is None:
        return None
    return {
        "kind": item.kind,
        "turn_id": item.turn_id,
        "sequence": item.sequence,
        "token": item.token,
        "answer": item.answer,
        "attempt": item.attempt,
    }


def input_from_json(raw: dict[str, Any] | None) -> AgentInput | None:
    if raw is None:
        return None
    return AgentInput(
        kind=cast("Literal['text', 'confirm']", raw["kind"]),
        turn_id=raw["turn_id"],
        sequence=raw.get("sequence"),
        token=raw.get("token"),
        answer=cast("Literal['yes', 'no'] | None", raw.get("answer")),
        attempt=int(raw.get("attempt", 0)),
    )


def _confirmation_to_json(item: PendingConfirmation | None) -> dict[str, Any] | None:
    if item is None:
        return None
    return {
        "token": item.token,
        "summary": item.summary,
        "expires_at": iso_utc(item.expires_at),
    }


def _confirmation_from_json(raw: dict[str, Any] | None) -> PendingConfirmation | None:
    if raw is None:
        return None
    return PendingConfirmation(
        token=raw["token"],
        summary=raw["summary"],
        expires_at=datetime.fromisoformat(raw["expires_at"]),
    )


class SqlAssistantSessionRepository(VersionedRepository[AssistantSession]):
    table = tables.assistant_sessions
    #: ``case_id`` is unique: two cases racing to create the same session means retry.
    insert_race_is_retryable = True

    def _key(self, aggregate: AssistantSession) -> str:
        return aggregate.id

    def _to_row(self, aggregate: AssistantSession) -> dict[str, Any]:
        step_up = aggregate.step_up
        return {
            "id": aggregate.id,
            "case_id": aggregate.case_id,
            "customer_id": aggregate.customer_id,
            "entry_agent": aggregate.entry_agent,
            "state": aggregate.state.value,
            "agent": aggregate.agent,
            "agent_session_id": aggregate.agent_session_id,
            "run_id": aggregate.run_id,
            "awaiting": aggregate.awaiting,
            "confirmation": _confirmation_to_json(aggregate.confirmation),
            "step_up": (
                None
                if step_up is None
                else {"reason": step_up.reason, "simulated": step_up.simulated}
            ),
            "step_up_verified_at": aggregate.step_up_verified_at,
            "step_up_attempts": aggregate.step_up_attempts,
            "processed_sequence": aggregate.processed_sequence,
            "claim": input_to_json(aggregate.claim),
            "claimed_at": aggregate.claimed_at,
            "queued": input_to_json(aggregate.queued),
            "blocked": input_to_json(aggregate.blocked),
            "resend_blocked": aggregate.resend_blocked,
            "handoff_ref": aggregate.handoff_ref,
            "handoff_resolved_at": aggregate.handoff_resolved_at,
            "failure_code": aggregate.failure_code,
            "last_trace_id": aggregate.last_trace_id,
            "created_at": aggregate.created_at,
            "updated_at": aggregate.updated_at,
        }

    def _from_row(self, row: Row) -> AssistantSession:
        step_up = row["step_up"]
        return AssistantSession(
            id=row["id"],
            case_id=row["case_id"],
            customer_id=row["customer_id"],
            entry_agent=row["entry_agent"],
            created_at=row["created_at"],
            updated_at=row["updated_at"],
            state=AssistantState(row["state"]),
            agent=row["agent"],
            agent_session_id=row["agent_session_id"],
            run_id=row["run_id"],
            awaiting=row["awaiting"],
            confirmation=_confirmation_from_json(row["confirmation"]),
            step_up=(
                None
                if step_up is None
                else PendingStepUp(reason=step_up["reason"], simulated=bool(step_up["simulated"]))
            ),
            step_up_verified_at=row["step_up_verified_at"],
            step_up_attempts=row["step_up_attempts"],
            processed_sequence=row["processed_sequence"],
            claim=input_from_json(row["claim"]),
            claimed_at=row["claimed_at"],
            queued=input_from_json(row["queued"]),
            blocked=input_from_json(row["blocked"]),
            resend_blocked=bool(row["resend_blocked"]),
            handoff_ref=row["handoff_ref"],
            handoff_resolved_at=row["handoff_resolved_at"],
            failure_code=row["failure_code"],
            last_trace_id=row["last_trace_id"],
        )

    async def get_by_case(self, case_id: str) -> AssistantSession | None:
        return await self._get_where(self.table.c.case_id == case_id)


def _message_to_json(m: CopilotMessage) -> dict[str, Any]:
    return {
        "id": m.id,
        "role": m.role,
        "text": m.text,
        "created_at": iso_utc(m.created_at),
        "client_message_id": m.client_message_id,
        "answers": m.answers,
    }


def _message_from_json(raw: dict[str, Any]) -> CopilotMessage:
    return CopilotMessage(
        id=raw["id"],
        role=cast("Literal['analyst', 'copilot']", raw["role"]),
        text=raw["text"],
        created_at=datetime.fromisoformat(raw["created_at"]),
        client_message_id=raw.get("client_message_id"),
        answers=raw.get("answers"),
    )


class SqlCopilotThreadRepository(VersionedRepository[CopilotThread]):
    table = tables.copilot_threads
    #: ``(case_id, analyst_id)`` is unique: two first questions racing means retry.
    insert_race_is_retryable = True

    def _key(self, aggregate: CopilotThread) -> str:
        return aggregate.id

    def _to_row(self, aggregate: CopilotThread) -> dict[str, Any]:
        return {
            "id": aggregate.id,
            "case_id": aggregate.case_id,
            "analyst_id": aggregate.analyst_id,
            "agent": aggregate.agent,
            "agent_session_id": aggregate.agent_session_id,
            "run_id": aggregate.run_id,
            "runs": aggregate.runs,
            "messages": [_message_to_json(m) for m in aggregate.messages],
            "last_trace_id": aggregate.last_trace_id,
            "created_at": aggregate.created_at,
            "updated_at": aggregate.updated_at,
        }

    def _from_row(self, row: Row) -> CopilotThread:
        return CopilotThread(
            id=row["id"],
            case_id=row["case_id"],
            analyst_id=row["analyst_id"],
            agent=row["agent"],
            created_at=row["created_at"],
            updated_at=row["updated_at"],
            agent_session_id=row["agent_session_id"],
            run_id=row["run_id"],
            runs=row["runs"],
            messages=tuple(_message_from_json(m) for m in row["messages"]),
            last_trace_id=row["last_trace_id"],
        )

    async def get_for(self, case_id: str, analyst_id: str) -> CopilotThread | None:
        c = self.table.c
        return await self._get_where(c.case_id == case_id, c.analyst_id == analyst_id)


class SqlBankCustomerLinks:
    """Not an aggregate: a plain lookup table (no events, no versions)."""

    def __init__(self, session: AsyncSession) -> None:
        self._session = session

    async def get(self, customer_id: str) -> str | None:
        links = tables.bank_customer_links
        result = await self._session.execute(
            select(links.c.bank_customer_id).where(links.c.customer_id == customer_id)
        )
        value = result.scalar()
        return None if value is None else str(value)

    async def set_many(self, links: Mapping[str, str]) -> int:
        table = tables.bank_customer_links
        changed = 0
        for customer_id, bank_customer_id in links.items():
            current = await self.get(customer_id)
            if current == bank_customer_id:
                continue
            if current is None:
                await self._session.execute(
                    insert(table).values(customer_id=customer_id, bank_customer_id=bank_customer_id)
                )
            else:
                await self._session.execute(
                    update(table)
                    .where(table.c.customer_id == customer_id)
                    .values(bank_customer_id=bank_customer_id)
                )
            changed += 1
        return changed
