"""Actor and RBAC rules shared by HTTP routes, use cases and the WebSocket."""

from __future__ import annotations

import pytest

from cc_platform.application.errors import ForbiddenError
from cc_platform.application.security import ensure_any_role
from cc_platform.domain.people.staff import StaffRole
from cc_platform.domain.shared.actor import ActorRole
from tests.support import make_actor


def test_ensure_any_role_allows_holders_of_one_role() -> None:
    ensure_any_role(make_actor(StaffRole.SUPERVISOR), {StaffRole.SUPERVISOR, StaffRole.ADMIN})


def test_ensure_any_role_reports_required_roles() -> None:
    with pytest.raises(ForbiddenError) as error:
        ensure_any_role(make_actor(StaffRole.ANALYST), {StaffRole.SUPERVISOR, StaffRole.ADMIN})
    assert error.value.code == "forbidden"
    assert error.value.details == {"requiredRoles": ["admin", "supervisor"]}


def test_acting_as_picks_the_allowed_role_by_precedence() -> None:
    actor = make_actor(StaffRole.SUPERVISOR, StaffRole.ADMIN)
    assert actor.acting_as().role is ActorRole.SUPERVISOR
    assert actor.acting_as({StaffRole.ADMIN}).role is ActorRole.ADMIN
    with pytest.raises(ForbiddenError):
        actor.acting_as({StaffRole.ANALYST})
