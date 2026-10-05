"""Writing notifications and signalling them (slice 10).

``NotificationWriter`` is the one place that stores notifications: the event projector and
the SLA sweep hand it ``NotificationDraft``s (a fact and its recipients). In one Unit of
Work, inside ``retry_on_conflict``, it

1. skips recipients that already have the draft's ``source_key`` (idempotency: a fact
   delivered twice, a sweep that runs again, a replayed event);
2. inserts one ``Notification`` per remaining recipient (``NTF-…``);
3. prunes each touched recipient to the newest ``RETENTION_PER_PERSON``;
4. commits, then publishes ``notification.created`` to each recipient's ``staff:<id>`` topic
   (``{notification, unreadCount}``) through ``NotificationSignals``.

``NotificationSignals`` also publishes ``notifications.read`` after a person reads one or
all of hers, so her other tabs update the bell. Sockets only signal: REST stays the source of
truth (``GET /me/notifications``).
"""

from __future__ import annotations

from collections.abc import Sequence
from dataclasses import dataclass
from datetime import datetime
from typing import Protocol

from cc_platform.application.concurrency import retry_on_conflict
from cc_platform.application.notifications.dto import NotificationReader, NotificationView
from cc_platform.application.ports.ids import IdGenerator
from cc_platform.application.ports.realtime import RealtimeEnvelope, RealtimeHub
from cc_platform.application.ports.unit_of_work import UnitOfWork, UnitOfWorkFactory
from cc_platform.application.realtime.topics import Topic
from cc_platform.domain.notifications.notification import (
    RETENTION_PER_PERSON,
    ImprovementDossier,
    Notification,
    NotificationKind,
)
from cc_platform.domain.people.staff import Language
from cc_platform.domain.shared.ids import IdPrefix
from cc_platform.domain.shared.json import JsonObject, JsonValue

NOTIFICATION_CREATED = "notification.created"
NOTIFICATIONS_READ = "notifications.read"


@dataclass(frozen=True, slots=True)
class NotificationDraft:
    """One fact for a set of recipients (the writer skips who already has it)."""

    kind: NotificationKind
    recipients: tuple[str, ...]
    created_at: datetime
    source_key: str
    case_id: str | None = None
    customer_id: str | None = None
    actor_id: str | None = None
    target_id: str | None = None
    escalation_id: str | None = None
    language: Language | None = None
    score: int | None = None
    failed_attempts: int | None = None
    proposal_id: str | None = None
    agent_id: str | None = None
    improvement: ImprovementDossier | None = None


class NotificationPresenter(Protocol):
    """Serialises a view exactly like the REST schema (camelCase JSON)."""

    def notification(self, view: NotificationView) -> JsonObject: ...


@dataclass(frozen=True, slots=True)
class NotificationSignals:
    hub: RealtimeHub
    presenter: NotificationPresenter
    ids: IdGenerator

    async def created(self, view: NotificationView, recipient_id: str, unread_count: int) -> None:
        payload: JsonObject = {
            "notification": self.presenter.notification(view),
            "unreadCount": unread_count,
        }
        envelope = RealtimeEnvelope(
            type=NOTIFICATION_CREATED,
            id=view.id,
            occurred_at=view.created_at,
            data=_data(view.id, view.case_id, payload),
        )
        await self.hub.publish(str(Topic.staff(recipient_id)), envelope)

    async def read(
        self,
        recipient_id: str,
        *,
        notification_ids: Sequence[str] | None,
        unread_count: int,
        at: datetime,
    ) -> None:
        """``notification_ids = None``: she read all of them."""
        ids: JsonValue = None if notification_ids is None else list[JsonValue](notification_ids)
        payload: JsonObject = {"notificationIds": ids, "unreadCount": unread_count}
        envelope = RealtimeEnvelope(
            type=NOTIFICATIONS_READ,
            id=self.ids.new_id(IdPrefix.MESSAGE),
            occurred_at=at,
            data=_data(recipient_id, None, payload),
        )
        await self.hub.publish(str(Topic.staff(recipient_id)), envelope)


def _data(entity_id: str, case_id: str | None, payload: JsonObject) -> JsonObject:
    """The domain-envelope ``data`` shape every client reader expects."""
    return {
        "entity": "notification",
        "entityId": entity_id,
        "caseId": case_id,
        "actor": {"role": "system", "id": None},
        "payload": payload,
    }


@dataclass(frozen=True, slots=True)
class WrittenNotification:
    """A stored notification, ready to signal once its Unit of Work committed."""

    notification: Notification
    view: NotificationView
    unread_count: int


@dataclass
class NotificationWriter:
    uow: UnitOfWorkFactory
    ids: IdGenerator
    signals: NotificationSignals
    retention: int = RETENTION_PER_PERSON

    async def write(self, drafts: Sequence[NotificationDraft]) -> list[Notification]:
        """Store the drafts in a Unit of Work of its own, then signal each new one."""
        if not any(draft.recipients for draft in drafts):
            return []
        written = await retry_on_conflict(lambda: self._attempt(drafts))
        await self.publish(written)
        return [item.notification for item in written]

    async def _attempt(self, drafts: Sequence[NotificationDraft]) -> list[WrittenNotification]:
        async with self.uow() as uow:
            written = await self.stage(uow, drafts)
            if written:
                await uow.commit()
        return written

    async def stage(
        self, uow: UnitOfWork, drafts: Sequence[NotificationDraft]
    ) -> list[WrittenNotification]:
        """Add the drafts to the caller's Unit of Work (skipping known keys) and prune each
        recipient; the caller commits, then ``publish``es what this returns."""
        created: list[Notification] = []
        for draft in drafts:
            created.extend(await self._add(uow, draft))
        if not created:
            return []
        recipients = sorted({item.recipient_id for item in created})
        pruned: set[str] = set()
        for recipient_id in recipients:
            pruned |= await uow.notifications.prune(recipient_id, keep=self.retention)
        # A fact older than her newest ``retention`` ones (a late sweep) is not kept.
        created = [item for item in created if item.id not in pruned]
        unread = {r: await uow.notifications.unread_count(r) for r in recipients}
        views = await NotificationReader(uow).views(created)
        return [
            WrittenNotification(item, view, unread[item.recipient_id])
            for item, view in zip(created, views, strict=True)
        ]

    async def publish(self, written: Sequence[WrittenNotification]) -> None:
        """``notification.created`` for each one (after the commit)."""
        for item in written:
            await self.signals.created(item.view, item.notification.recipient_id, item.unread_count)

    async def _add(self, uow: UnitOfWork, draft: NotificationDraft) -> list[Notification]:
        recipients = list(dict.fromkeys(draft.recipients))
        if not recipients:
            return []
        known = await uow.notifications.recipients_with_key(draft.source_key, recipients)
        created: list[Notification] = []
        for recipient_id in recipients:
            if recipient_id in known:
                continue
            notification = Notification(
                id=self.ids.new_id(IdPrefix.NOTIFICATION),
                recipient_id=recipient_id,
                kind=draft.kind,
                created_at=draft.created_at,
                source_key=draft.source_key,
                case_id=draft.case_id,
                customer_id=draft.customer_id,
                actor_id=draft.actor_id,
                target_id=draft.target_id,
                escalation_id=draft.escalation_id,
                language=draft.language,
                score=draft.score,
                failed_attempts=draft.failed_attempts,
                proposal_id=draft.proposal_id,
                agent_id=draft.agent_id,
                improvement=draft.improvement,
            )
            await uow.notifications.add(notification)
            created.append(notification)
        return created
