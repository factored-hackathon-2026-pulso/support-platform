"""``Notification`` aggregate (slice 10): invariants, its role and reading it once."""

from __future__ import annotations

from datetime import UTC, datetime, timedelta

import pytest

from cc_platform.domain.notifications.notification import (
    KIND_ROLE,
    STAFF_KINDS,
    Notification,
    NotificationKind,
)
from cc_platform.domain.people.staff import StaffRole
from cc_platform.domain.shared.errors import InvalidValueError

T = datetime(2026, 10, 4, 12, 0, tzinfo=UTC)
NTF = "NTF-" + "1".zfill(26)
STF = "STF-" + "1".zfill(26)
OTHER = "STF-" + "2".zfill(26)
CASE = "CASE-" + "1".zfill(26)


def make(kind: NotificationKind = NotificationKind.CASE_RATED, **changes: object) -> Notification:
    values: dict[str, object] = {
        "id": NTF,
        "recipient_id": STF,
        "kind": kind,
        "created_at": T,
        "source_key": "EVT-" + "1".zfill(26),
        "case_id": CASE,
        "score": 4,
    }
    values.update(changes)
    return Notification(**values)  # type: ignore[arg-type]


def test_every_kind_belongs_to_one_role() -> None:
    assert set(KIND_ROLE) == set(NotificationKind)
    assert {k for k, r in KIND_ROLE.items() if r is StaffRole.ADMIN} == STAFF_KINDS
    supervision = {k for k, r in KIND_ROLE.items() if r is StaffRole.SUPERVISOR}
    assert supervision == {
        NotificationKind.CASE_ESCALATED,
        NotificationKind.CASE_QUEUED,
        NotificationKind.SLA_AT_RISK,
    }
    assert make().role is StaffRole.ANALYST


def test_read_once() -> None:
    notification = make()
    assert notification.is_unread
    assert notification.mark_read(at=T + timedelta(minutes=1)) is True
    assert notification.read_at == T + timedelta(minutes=1)
    assert notification.mark_read(at=T + timedelta(minutes=5)) is False
    assert notification.read_at == T + timedelta(minutes=1)


def test_never_read_before_it_happened() -> None:
    notification = make()
    notification.mark_read(at=T - timedelta(hours=1))
    assert notification.read_at == T
    with pytest.raises(InvalidValueError):
        make(read_at=T - timedelta(seconds=1))


@pytest.mark.parametrize(
    "changes",
    [
        {"id": "nope"},
        {"recipient_id": CASE},
        {"source_key": "  "},
        {"source_key": "x" * 81},
        {"case_id": None},
        {"case_id": "CASE-1"},
        {"score": 5},
        {"score": 0},
    ],
)
def test_case_kind_invariants(changes: dict[str, object]) -> None:
    with pytest.raises(InvalidValueError):
        make(**changes)


def test_staff_kinds_name_their_person() -> None:
    locked = make(NotificationKind.ACCOUNT_LOCKED, case_id=None, score=None, target_id=OTHER)
    assert locked.role is StaffRole.ADMIN
    with pytest.raises(InvalidValueError):
        make(NotificationKind.ACCOUNT_LOCKED, case_id=None, score=None)
    with pytest.raises(InvalidValueError):
        make(NotificationKind.INVITATION_ACCEPTED, case_id=None, target_id=CASE)
