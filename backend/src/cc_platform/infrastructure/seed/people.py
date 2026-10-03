"""Seed staff — "Datos de ejemplo" (slice 2 contract §8.1).

Every name, email and id here is invented (brief §4.7: staff names in the dataset are records
too and must never be copied). Roles combine (Analista, Supervisora, Administración):

- the main persona is an analyst who speaks Spanish and Portuguese (Daniela);
- more analysts, two of them bilingual (Sebastián, Tomás) to show least-loaded balancing;
- supervisors, plus a team lead holding Analista + Supervisora (Felipe exercises the
  role switcher: Casos ↔ Equipo y colas);
- administrators.

All seeded accounts share the development password ``DEMO_PASSWORD`` (documented in README).
"""

from __future__ import annotations

from dataclasses import dataclass

from cc_platform.application.ports.clock import Clock
from cc_platform.application.ports.security import PasswordHasher
from cc_platform.application.ports.unit_of_work import UnitOfWorkFactory
from cc_platform.domain.people.availability import AnalystAvailability, AvailabilityStatus
from cc_platform.domain.people.login_account import LoginAccount
from cc_platform.domain.people.staff import Language, Staff, StaffRole
from cc_platform.domain.shared.ids import BODY_LENGTH, IdPrefix, make_id

DEMO_PASSWORD = "demo1234"
DEMO_EMAIL_DOMAIN = "latambank.example"

ES = Language.SPANISH
PT = Language.PORTUGUESE
TEAM_ANDES = "Disputas · Equipo Andes"
TEAM_PACIFICO = "Disputas · Equipo Pacífico"
TEAM_PLATFORM = "Administración de la plataforma"


def seed_staff_id(number: int) -> str:
    """Stable ids so a restart keeps the same people (and links in the UI keep working)."""
    return make_id(IdPrefix.STAFF, str(number).zfill(BODY_LENGTH))


@dataclass(frozen=True, slots=True)
class StaffSeed:
    number: int
    name: str
    username: str
    roles: frozenset[StaffRole]
    languages: frozenset[Language]
    team: str

    @property
    def email(self) -> str:
        return f"{self.username}@{DEMO_EMAIL_DOMAIN}"

    def to_staff(self) -> Staff:
        return Staff(
            id=seed_staff_id(self.number),
            name=self.name,
            email=self.email,
            roles=self.roles,
            languages=self.languages,
            team=self.team,
        )


A, S, AD = StaffRole.ANALYST, StaffRole.SUPERVISOR, StaffRole.ADMIN

DEMO_STAFF: tuple[StaffSeed, ...] = (
    # Main persona of the analyst Workspace.
    StaffSeed(1, "Daniela Ríos", "daniela.rios", frozenset({A}), frozenset({ES, PT}), TEAM_ANDES),
    StaffSeed(2, "Julián Ortega", "julian.ortega", frozenset({A}), frozenset({ES}), TEAM_ANDES),
    StaffSeed(3, "Paula Medina", "paula.medina", frozenset({A}), frozenset({ES}), TEAM_PACIFICO),
    StaffSeed(4, "Sebastián Cárdenas", "sebastian.cardenas", frozenset({A}),
              frozenset({ES, PT}), TEAM_PACIFICO),
    # Supervisors (team and queues, audit).
    StaffSeed(5, "Lucía Herrera", "lucia.herrera", frozenset({S}), frozenset({ES, PT}),
              TEAM_ANDES),
    StaffSeed(6, "Martín Salazar", "martin.salazar", frozenset({S}), frozenset({ES}),
              TEAM_PACIFICO),
    # Administrators.
    StaffSeed(7, "Valeria Quintero", "valeria.quintero", frozenset({AD}), frozenset({ES}),
              TEAM_PLATFORM),
    StaffSeed(8, "Tomás Arango", "tomas.arango", frozenset({A}), frozenset({ES, PT}),
              TEAM_PACIFICO),
    StaffSeed(9, "Carolina Peña", "carolina.pena", frozenset({AD}), frozenset({ES}),
              TEAM_PLATFORM),
    StaffSeed(10, "Renata Villalba", "renata.villalba", frozenset({S}), frozenset({ES, PT}),
              TEAM_PACIFICO),
    # Team lead: Analista + Supervisora (works cases and watches the team's queues).
    StaffSeed(11, "Felipe Echeverri", "felipe.echeverri", frozenset({A, S}), frozenset({ES}),
              TEAM_ANDES),
)  # fmt: skip


async def seed_demo_staff(
    uow: UnitOfWorkFactory,
    hasher: PasswordHasher,
    *,
    password: str = DEMO_PASSWORD,
    seeds: tuple[StaffSeed, ...] = DEMO_STAFF,
) -> int:
    """Insert missing seed staff and their login accounts. Idempotent; returns how many."""
    created = 0
    async with uow() as unit:
        for seed in seeds:
            staff = seed.to_staff()
            if await unit.staff.get(staff.id) is not None:
                continue
            await unit.staff.add(staff)
            await unit.login_accounts.add(
                LoginAccount(staff_id=staff.id, password_hash=await hasher.hash(password))
            )
            created += 1
        await unit.commit()
    return created


#: Only Daniela takes new cases at first, so the demo lands on her. Signing in as Sebastián
#: or Tomás (es, pt, no cases) and switching to "Disponible" shows the least-loaded
#: balancing (and drains the seeded Portuguese queue).
DEMO_AVAILABLE_ANALYSTS: frozenset[int] = frozenset({1})


async def seed_demo_availability(
    uow: UnitOfWorkFactory,
    clock: Clock,
    *,
    seeds: tuple[StaffSeed, ...] = DEMO_STAFF,
    available: frozenset[int] = DEMO_AVAILABLE_ANALYSTS,
) -> int:
    """Availability rows for every seeded analyst that has none. Idempotent."""
    created = 0
    now = clock.now()
    async with uow() as unit:
        for seed in seeds:
            if StaffRole.ANALYST not in seed.roles:
                continue
            staff_id = seed_staff_id(seed.number)
            if await unit.availability.get(staff_id) is not None:
                continue
            status = (
                AvailabilityStatus.AVAILABLE
                if seed.number in available
                else AvailabilityStatus.PAUSED
            )
            await unit.availability.add(
                AnalystAvailability(staff_id=staff_id, status=status, since=now)
            )
            created += 1
        await unit.commit()
    return created
