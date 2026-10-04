"""Use cases of the notifications context (slice 10): a person's own notifications.

Every staff role has a bell, so every route only needs a session; each person only ever sees
and changes **her own** notifications (another person's id answers 404, as if it did not
exist).

- ``ListMyNotifications``: newest first (``createdAt``, then id), keyset cursor, plus how
  many are unread.
- ``MarkNotificationRead``: one of hers; read once (a second call is a no-op,
  ``changed: false``); compare-and-set + ``retry_on_conflict``.
- ``MarkAllNotificationsRead``: every unread one of hers in one conditional statement.

After a change, ``notifications.read`` goes to her ``staff:<id>`` topic so her other tabs
update the bell.
"""

from __future__ import annotations

from dataclasses import dataclass

from cc_platform.application.concurrency import retry_on_conflict
from cc_platform.application.notifications.dto import (
    NotificationPageView,
    NotificationReader,
    NotificationReadView,
    NotificationsReadAllView,
    decode_cursor,
    encode_cursor,
)
from cc_platform.application.notifications.ports import NotificationCursor
from cc_platform.application.notifications.sweep import SweepSlaRisk
from cc_platform.application.notifications.writer import NotificationSignals
from cc_platform.application.ports.clock import Clock
from cc_platform.application.ports.unit_of_work import UnitOfWorkFactory
from cc_platform.application.security import Actor
from cc_platform.domain.shared.errors import NotFoundError
from cc_platform.domain.shared.ids import IdPrefix, is_valid_id

DEFAULT_PAGE_SIZE = 30
MAX_PAGE_SIZE = 100


@dataclass(frozen=True, slots=True)
class ListMyNotifications:
    uow: UnitOfWorkFactory
    clock: Clock

    async def execute(
        self, actor: Actor, *, cursor: str | None = None, limit: int = DEFAULT_PAGE_SIZE
    ) -> NotificationPageView:
        before = decode_cursor(cursor) if cursor else None
        size = max(1, min(limit, MAX_PAGE_SIZE))
        async with self.uow() as uow:
            rows = await uow.notifications.page(actor.staff_id, before=before, limit=size + 1)
            page = rows[:size]
            views = await NotificationReader(uow).views(page)
            unread = await uow.notifications.unread_count(actor.staff_id)
        last = page[-1] if page else None
        next_cursor = (
            encode_cursor(NotificationCursor(last.created_at, last.id))
            if last is not None and len(rows) > size
            else None
        )
        return NotificationPageView(
            items=tuple(views),
            unread_count=unread,
            next_cursor=next_cursor,
            server_time=self.clock.now(),
        )


@dataclass(frozen=True, slots=True)
class MarkNotificationRead:
    uow: UnitOfWorkFactory
    clock: Clock
    signals: NotificationSignals

    async def execute(self, actor: Actor, notification_id: str) -> NotificationReadView:
        result = await retry_on_conflict(lambda: self._attempt(actor, notification_id))
        if result.changed:
            await self.signals.read(
                actor.staff_id,
                notification_ids=[result.notification.id],
                unread_count=result.unread_count,
                at=self.clock.now(),
            )
        return result

    async def _attempt(self, actor: Actor, notification_id: str) -> NotificationReadView:
        async with self.uow() as uow:
            notification = (
                await uow.notifications.get(notification_id)
                if is_valid_id(notification_id, IdPrefix.NOTIFICATION)
                else None
            )
            if notification is None or notification.recipient_id != actor.staff_id:
                raise NotFoundError(
                    "No encontramos esa notificación.", notificationId=notification_id
                )
            changed = notification.mark_read(at=self.clock.now())
            if changed:
                await uow.notifications.save(notification)
            (view,) = await NotificationReader(uow).views([notification])
            unread = await uow.notifications.unread_count(actor.staff_id)
            if changed:
                await uow.commit()
        return NotificationReadView(notification=view, changed=changed, unread_count=unread)


@dataclass(frozen=True, slots=True)
class MarkAllNotificationsRead:
    uow: UnitOfWorkFactory
    clock: Clock
    signals: NotificationSignals

    async def execute(self, actor: Actor) -> NotificationsReadAllView:
        now = self.clock.now()
        updated, unread = await retry_on_conflict(lambda: self._attempt(actor))
        if updated:
            await self.signals.read(
                actor.staff_id, notification_ids=None, unread_count=unread, at=now
            )
        return NotificationsReadAllView(updated=updated, unread_count=unread)

    async def _attempt(self, actor: Actor) -> tuple[int, int]:
        async with self.uow() as uow:
            updated = await uow.notifications.mark_all_read(actor.staff_id, at=self.clock.now())
            unread = await uow.notifications.unread_count(actor.staff_id)
            await uow.commit()
        return updated, unread


@dataclass(frozen=True, slots=True)
class NotificationsUseCases:
    list_mine: ListMyNotifications
    mark_read: MarkNotificationRead
    mark_all_read: MarkAllNotificationsRead
    sweep_sla_risk: SweepSlaRisk
