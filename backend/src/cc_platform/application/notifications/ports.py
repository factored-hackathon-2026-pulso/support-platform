"""Ports of the notifications context (slice 10)."""

from __future__ import annotations

from collections.abc import Collection
from dataclasses import dataclass
from datetime import datetime
from typing import Protocol

from cc_platform.domain.notifications.notification import Notification


@dataclass(frozen=True, slots=True)
class NotificationCursor:
    """Keyset position in one person's list (newest first): strictly older than this."""

    created_at: datetime
    notification_id: str


class NotificationRepository(Protocol):
    """One person's notifications, versioned like any aggregate."""

    async def get(self, notification_id: str) -> Notification | None: ...

    async def add(self, notification: Notification) -> None:
        """Insert; a duplicate ``(recipient_id, source_key)`` raises
        ``ConcurrentUpdateError`` (the same fact written twice at once: the writer re-runs
        and skips it)."""
        ...

    async def save(self, notification: Notification) -> None:
        """Compare-and-set on ``version``; raises ``ConcurrentUpdateError`` when stale."""
        ...

    async def recipients_with_key(
        self, source_key: str, recipient_ids: Collection[str]
    ) -> set[str]:
        """Which of ``recipient_ids`` already have a notification for ``source_key``."""
        ...

    async def page(
        self, recipient_id: str, *, before: NotificationCursor | None, limit: int
    ) -> list[Notification]:
        """Up to ``limit`` of her notifications, newest first (``created_at``, then id),
        strictly older than ``before`` when given."""
        ...

    async def unread_count(self, recipient_id: str) -> int: ...

    async def mark_all_read(self, recipient_id: str, *, at: datetime) -> int:
        """Read every unread one of hers in one conditional statement (``read_at IS NULL``,
        version bumped); returns how many changed. No read-modify-write: two concurrent
        calls cannot lose an update."""
        ...

    async def prune(self, recipient_id: str, *, keep: int) -> set[str]:
        """Delete all but her newest ``keep`` (``created_at``, then id); returns the ids
        deleted."""
        ...
