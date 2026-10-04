"""The notification center (slice 10): every staff member's own notifications.

Any staff role (each one has a bell); a person only ever reads and changes **her own**
(another person's notification answers 404). Live: ``notification.created`` and
``notifications.read`` on her ``staff:<id>`` topic.
"""

from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Path, Query

from cc_platform.api.dependencies import ApiContextDep, CurrentActor
from cc_platform.api.schemas.common import problem_responses
from cc_platform.api.schemas.notifications import (
    NotificationPage,
    NotificationReadResult,
    NotificationsReadAllResult,
)
from cc_platform.application.notifications.use_cases import DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE

router = APIRouter(prefix="/me/notifications", tags=["notifications"])

NotificationId = Annotated[str, Path(alias="notificationId", max_length=64, examples=["NTF-01J…"])]


@router.get(
    "",
    response_model=NotificationPage,
    summary="My notifications, newest first",
    description=(
        "Structured facts (no text): `kind` says what happened, the other members who and "
        "which case. Newest first by `createdAt` (when it happened), cursor pagination "
        "(`nextCursor`). `unreadCount` counts all her unread ones. Only the newest 200 per "
        "person are kept."
    ),
    responses=problem_responses(401, 422),
)
async def list_my_notifications(
    actor: CurrentActor,
    api: ApiContextDep,
    cursor: Annotated[str | None, Query(max_length=80)] = None,
    limit: Annotated[int, Query(ge=1, le=MAX_PAGE_SIZE)] = DEFAULT_PAGE_SIZE,
) -> NotificationPage:
    view = await api.use_cases.notifications.list_mine.execute(actor, cursor=cursor, limit=limit)
    return NotificationPage.from_view(view)


@router.post(
    "/read-all",
    response_model=NotificationsReadAllResult,
    summary="Mark all my notifications as read",
    responses=problem_responses(401),
)
async def mark_all_notifications_read(
    actor: CurrentActor, api: ApiContextDep
) -> NotificationsReadAllResult:
    view = await api.use_cases.notifications.mark_all_read.execute(actor)
    return NotificationsReadAllResult.from_view(view)


@router.post(
    "/{notificationId}/read",
    response_model=NotificationReadResult,
    summary="Mark one of my notifications as read",
    description=(
        "Idempotent: an already read one answers `changed: false`. Someone else's (or an "
        "unknown) id answers 404."
    ),
    responses=problem_responses(401, 404),
)
async def mark_notification_read(
    notification_id: NotificationId, actor: CurrentActor, api: ApiContextDep
) -> NotificationReadResult:
    view = await api.use_cases.notifications.mark_read.execute(actor, notification_id)
    return NotificationReadResult.from_view(view)
