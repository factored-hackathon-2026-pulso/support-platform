"""SQLAlchemy repository of the notifications context (slice 10)."""

from __future__ import annotations

from collections.abc import Collection
from datetime import datetime
from typing import Any, cast

from sqlalchemy import CursorResult, and_, delete, func, or_, select, update
from sqlalchemy import case as sql_case
from sqlalchemy.exc import IntegrityError

from cc_platform.application.notifications.ports import NotificationCursor
from cc_platform.domain.notifications.notification import (
    ImprovementDossier,
    Notification,
    NotificationKind,
)
from cc_platform.domain.people.staff import Language
from cc_platform.domain.shared.errors import ConcurrentUpdateError, DomainError
from cc_platform.infrastructure.persistence.sqlalchemy import tables
from cc_platform.infrastructure.persistence.sqlalchemy.repositories.base import (
    Row,
    VersionedRepository,
)


class SqlNotificationRepository(VersionedRepository[Notification]):
    table = tables.notifications
    #: A duplicate ``(recipient_id, source_key)`` = the same fact written twice at once.
    insert_race_is_retryable = True

    def _key(self, aggregate: Notification) -> str:
        return aggregate.id

    def _integrity_error(self, exc: IntegrityError, *, insert: bool) -> DomainError:
        return ConcurrentUpdateError(entity=self.table.name)

    def _to_row(self, aggregate: Notification) -> dict[str, Any]:
        return {
            "id": aggregate.id,
            "recipient_id": aggregate.recipient_id,
            "kind": aggregate.kind.value,
            "created_at": aggregate.created_at,
            "source_key": aggregate.source_key,
            "case_id": aggregate.case_id,
            "customer_id": aggregate.customer_id,
            "actor_id": aggregate.actor_id,
            "target_id": aggregate.target_id,
            "escalation_id": aggregate.escalation_id,
            "language": aggregate.language.value if aggregate.language else None,
            "score": aggregate.score,
            "failed_attempts": aggregate.failed_attempts,
            "read_at": aggregate.read_at,
            "proposal_id": aggregate.proposal_id,
            "agent_id": aggregate.agent_id,
            "improvement": _dossier_to_json(aggregate.improvement),
        }

    def _from_row(self, row: Row) -> Notification:
        return Notification(
            id=row["id"],
            recipient_id=row["recipient_id"],
            kind=NotificationKind(row["kind"]),
            created_at=row["created_at"],
            source_key=row["source_key"],
            case_id=row["case_id"],
            customer_id=row["customer_id"],
            actor_id=row["actor_id"],
            target_id=row["target_id"],
            escalation_id=row["escalation_id"],
            language=Language(row["language"]) if row["language"] else None,
            score=row["score"],
            failed_attempts=row["failed_attempts"],
            read_at=row["read_at"],
            proposal_id=row["proposal_id"],
            agent_id=row["agent_id"],
            improvement=_dossier_from_json(row["improvement"]),
        )

    async def recipients_with_key(
        self, source_key: str, recipient_ids: Collection[str]
    ) -> set[str]:
        if not recipient_ids:
            return set()
        c = self.table.c
        result = await self._session.execute(
            select(c.recipient_id).where(
                c.source_key == source_key, c.recipient_id.in_(list(recipient_ids))
            )
        )
        return set(result.scalars())

    async def page(
        self, recipient_id: str, *, before: NotificationCursor | None, limit: int
    ) -> list[Notification]:
        c = self.table.c
        criteria: list[Any] = [c.recipient_id == recipient_id]
        if before is not None:
            criteria.append(
                or_(
                    c.created_at < before.created_at,
                    and_(c.created_at == before.created_at, c.id < before.notification_id),
                )
            )
        result = await self._session.execute(
            select(self.table)
            .where(*criteria)
            .order_by(c.created_at.desc(), c.id.desc())
            .limit(limit)
        )
        found: list[Notification] = []
        for row in result.mappings():
            notification = self._load(row)
            if notification is not None:
                found.append(notification)
        return found

    async def improvement_for(self, proposal_id: str) -> Notification | None:
        c = self.table.c
        result = await self._session.execute(
            select(self.table)
            .where(
                c.proposal_id == proposal_id,
                c.kind == NotificationKind.IMPROVEMENT_PROPOSED.value,
            )
            .order_by(c.created_at, c.id)
            .limit(1)
        )
        row = result.mappings().first()
        return None if row is None else self._load(row)

    async def unread_count(self, recipient_id: str) -> int:
        c = self.table.c
        result = await self._session.execute(
            select(func.count())
            .select_from(self.table)
            .where(c.recipient_id == recipient_id, c.read_at.is_(None))
        )
        return int(result.scalar_one())

    async def mark_all_read(self, recipient_id: str, *, at: datetime) -> int:
        c = self.table.c
        statement = (
            update(self.table)
            .where(c.recipient_id == recipient_id, c.read_at.is_(None))
            .values(
                # Never before the fact itself (a seeded or swept one may be "older" than now
                # only in the past; a clock set back in a test must not break the invariant).
                read_at=sql_case((c.created_at > at, c.created_at), else_=at),
                version=c.version + 1,
            )
        )
        result = cast("CursorResult[Any]", await self._session.execute(statement))
        return int(result.rowcount or 0)

    async def prune(self, recipient_id: str, *, keep: int) -> set[str]:
        c = self.table.c
        result = await self._session.execute(
            select(c.id)
            .where(c.recipient_id == recipient_id)
            .order_by(c.created_at.desc(), c.id.desc())
            .offset(keep)
        )
        stale = set(result.scalars())
        if stale:
            await self._session.execute(delete(self.table).where(c.id.in_(sorted(stale))))
        return stale


def _dossier_to_json(dossier: ImprovementDossier | None) -> dict[str, Any] | None:
    if dossier is None:
        return None
    return {
        "title": dossier.title,
        "problem": dossier.problem,
        "evidence": dossier.evidence,
        "expectedEffect": dossier.expected_effect,
        "evidenceLinks": list(dossier.evidence_links),
    }


def _dossier_from_json(value: dict[str, Any] | None) -> ImprovementDossier | None:
    if value is None:
        return None
    return ImprovementDossier(
        title=value["title"],
        problem=value["problem"],
        evidence=value["evidence"],
        expected_effect=value["expectedEffect"],
        evidence_links=tuple(value["evidenceLinks"]),
    )
