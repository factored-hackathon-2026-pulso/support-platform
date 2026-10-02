"""Seed staff cover the role combinations of the canvas (note au3) with invented people."""

from __future__ import annotations

from cc_platform.domain.people.staff import StaffRole
from cc_platform.infrastructure.seed.people import DEMO_STAFF, seed_demo_staff
from tests.support import PlainHasher, build_auth_kit

A, S, AU, AD = StaffRole.ANALYST, StaffRole.SUPERVISOR, StaffRole.AUTOMATION, StaffRole.ADMIN


def test_seed_covers_every_canvas_role_combination() -> None:
    combinations = {seed.roles for seed in DEMO_STAFF}
    assert frozenset({S, AU}) in combinations  # supervisora + automatización
    assert frozenset({AU, AD}) in combinations  # automatización + administración (four-eyes)
    assert frozenset({A, S}) in combinations  # team lead: Workspace ↔ "Por aprobar"
    for role in StaffRole:
        assert frozenset({role}) in combinations


def test_seed_ids_and_emails_are_unique() -> None:
    assert len({seed.number for seed in DEMO_STAFF}) == len(DEMO_STAFF)
    assert len({seed.email for seed in DEMO_STAFF}) == len(DEMO_STAFF)


async def test_seeding_is_idempotent() -> None:
    kit = build_auth_kit()
    assert await seed_demo_staff(kit.uow, PlainHasher()) == len(DEMO_STAFF)
    assert await seed_demo_staff(kit.uow, PlainHasher()) == 0
