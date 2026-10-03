"""Seed staff (contract §8.1): three combinable roles and invented people."""

from __future__ import annotations

from cc_platform.domain.people.staff import StaffRole
from cc_platform.infrastructure.seed.people import DEMO_STAFF, seed_demo_staff
from tests.support import PlainHasher, build_auth_kit

A, S, AD = StaffRole.ANALYST, StaffRole.SUPERVISOR, StaffRole.ADMIN


def test_seed_staff_roles_follow_the_contract() -> None:
    roles = {seed.name.split()[0]: seed.roles for seed in DEMO_STAFF}
    assert roles == {
        "Daniela": {A},
        "Julián": {A},
        "Paula": {A},
        "Sebastián": {A},
        "Lucía": {S},
        "Martín": {S},
        "Valeria": {AD},
        "Tomás": {A},
        "Carolina": {AD},
        "Renata": {S},
        "Felipe": {A, S},  # team lead: Casos ↔ Equipo y colas
    }
    assert {seed.team for seed in DEMO_STAFF} == {
        "Disputas · Equipo Andes",
        "Disputas · Equipo Pacífico",
        "Administración de la plataforma",
    }


def test_seed_ids_and_emails_are_unique() -> None:
    assert len({seed.number for seed in DEMO_STAFF}) == len(DEMO_STAFF)
    assert len({seed.email for seed in DEMO_STAFF}) == len(DEMO_STAFF)


async def test_seeding_is_idempotent() -> None:
    kit = build_auth_kit()
    assert await seed_demo_staff(kit.uow, PlainHasher()) == len(DEMO_STAFF)
    assert await seed_demo_staff(kit.uow, PlainHasher()) == 0
