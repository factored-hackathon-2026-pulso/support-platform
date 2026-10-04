"""Seed staff (contract §8.1): three combinable roles and invented people."""

from __future__ import annotations

from datetime import timedelta

from cc_platform.domain.people.staff import StaffRole
from cc_platform.infrastructure.seed.people import (
    DEMO_STAFF,
    seed_demo_staff,
    seed_staff_id,
    seed_team_id,
)
from tests.support import PlainHasher, build_auth_kit, memory_container

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
        "Mariana": {S},  # slice 4: locked by the admin story
        "Andrés": {A},  # slice 4: inactive
    }
    assert [seed.name for seed in DEMO_STAFF if not seed.active] == ["Andrés Villamil"]
    assert {seed.team.name for seed in DEMO_STAFF} == {
        "Equipo Andes",
        "Equipo Pacífico",
        "Administración de la plataforma",
    }


def test_seed_ids_and_emails_are_unique() -> None:
    assert len({seed.number for seed in DEMO_STAFF}) == len(DEMO_STAFF)
    assert len({seed.email for seed in DEMO_STAFF}) == len(DEMO_STAFF)


async def test_seeding_is_idempotent() -> None:
    kit = build_auth_kit()
    assert await seed_demo_staff(kit.uow, PlainHasher()) == len(DEMO_STAFF)
    assert await seed_demo_staff(kit.uow, PlainHasher()) == 0


async def test_admin_story_and_directory_of_a_fresh_start() -> None:
    """Slice 4 §11: teams, Mariana locked, Andrés inactive, the roster and four admin events;
    the slice 3 numbers do not move (see ``test_supervision_read_models``)."""
    container = await memory_container()
    now = container.clock.now()
    async with container.uow() as uow:
        teams = {team.name: team for team in await uow.teams.list()}
        roster = await uow.admin_roster.get()
        mariana = await uow.login_accounts.get(seed_staff_id(12))
        andres = await uow.staff.get(seed_staff_id(13))
        andres_availability = await uow.availability.get(seed_staff_id(13))
        events = (await uow.event_log.page(limit=1000)).items
    assert {name: (team.id, team.active) for name, team in teams.items()} == {
        "Equipo Andes": (seed_team_id(1), True),
        "Equipo Pacífico": (seed_team_id(2), True),
        "Administración de la plataforma": (seed_team_id(3), True),
        "Equipo Caribe": (seed_team_id(4), False),
    }
    assert teams["Equipo Andes"].created_at == now - timedelta(days=30)
    assert teams["Equipo Caribe"].created_at == now - timedelta(days=3)
    assert roster is not None
    assert roster.admin_ids == {seed_staff_id(7), seed_staff_id(9)}
    assert mariana is not None
    assert (mariana.failed_attempts, mariana.locked_until) == (5, now + timedelta(minutes=13))
    assert andres is not None
    assert (andres.active, andres_availability) == (False, None)
    admin = [
        (e.event_type, e.event_time, e.actor_id)
        for e in events
        if e.event_type.startswith(("staff.", "team.")) and e.actor_role == "admin"
    ]
    valeria, carolina = seed_staff_id(7), seed_staff_id(9)
    assert admin == [
        ("staff.roles_changed", now - timedelta(days=5), valeria),
        ("team.created", now - timedelta(days=3), valeria),
        # part 4: Valeria invited Tatiana (she accepted at T−1h) and, at T−3h, Bruna
        ("staff.deactivated", now - timedelta(days=2), carolina),
        ("staff.created", now - timedelta(days=2), valeria),
        ("staff.invitation_sent", now - timedelta(days=2), valeria),
        ("team.deactivated", now - timedelta(days=1), valeria),
        ("staff.created", now - timedelta(hours=3), valeria),
        ("staff.invitation_sent", now - timedelta(hours=3), valeria),
    ]
    tatiana_id, bruna_id = seed_staff_id(14), seed_staff_id(15)
    hers = [(e.event_type, e.event_time) for e in events if e.actor_id == tatiana_id]
    assert hers == [
        ("staff.mfa_enrolled", now - timedelta(hours=1)),
        ("staff.invitation_accepted", now - timedelta(hours=1)),
    ]
    async with container.uow() as uow:
        tatiana = await uow.staff.get(tatiana_id)
        bruna = await uow.staff.get(bruna_id)
        tatiana_account = await uow.login_accounts.get(tatiana_id)
        bruna_invitation = await uow.invitations.get_for_staff(bruna_id)
    assert tatiana is not None
    assert bruna is not None
    assert (tatiana.active, tatiana.is_invited, bruna.active, bruna.is_invited) == (
        True, False, False, True
    )  # fmt: skip
    assert tatiana_account is not None
    assert tatiana_account.uses_totp
    assert bruna_invitation is not None
    assert bruna_invitation.expires_at == now + timedelta(hours=45)
    times = [e.event_time for e in events]
    assert times == sorted(times)  # the story is logged in story-time order
    locks = [e for e in events if e.entity_id == seed_staff_id(12)]
    assert [e.event_type for e in locks] == ["auth.login_failed"] * 5 + ["auth.account_locked"]
    # Running the seed again changes nothing.
    await container.seed_demo_data()
    async with container.uow() as uow:
        assert len((await uow.event_log.page(limit=1000)).items) == len(events)
