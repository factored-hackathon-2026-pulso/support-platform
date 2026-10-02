"""Seed staff — "Datos de ejemplo".

Every name, email and id here is invented (brief §4.7: staff names in the dataset are records
too and must never be copied). Role combinations follow the canvas (note ``au3``: "roles
combinables: supervisora + automatización, o automatización + administración"):

- the main persona is a Specialist analyst who speaks Spanish and Portuguese;
- two supervisors, plus a team lead holding Analista + Supervisora (switches from the
  Workspace to "Por aprobar" without signing in again; four-eyes still stops self-approval);
- Supervisora + Automatización in one person (role switcher between supervision and
  automation screens);
- Automatización + Administración in one person (exercises four-eyes on admin changes);
- single-role automation and admin users.

All seeded accounts share the development password ``DEMO_PASSWORD`` (documented in README).
"""

from __future__ import annotations

from dataclasses import dataclass

from cc_platform.application.ports.security import PasswordHasher
from cc_platform.application.ports.unit_of_work import UnitOfWorkFactory
from cc_platform.domain.people.login_account import LoginAccount
from cc_platform.domain.people.staff import Language, Staff, StaffLevel, StaffRole
from cc_platform.domain.shared.ids import BODY_LENGTH, IdPrefix, make_id

DEMO_PASSWORD = "demo1234"
DEMO_EMAIL_DOMAIN = "latambank.example"

ES = Language.SPANISH
PT = Language.PORTUGUESE
TEAM_ANDES = "Disputas · Equipo Andes"
TEAM_PACIFICO = "Disputas · Equipo Pacífico"
TEAM_AUTOMATION = "Automatización"
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
    level: StaffLevel
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
            level=self.level,
            languages=self.languages,
            team=self.team,
        )


A, S, AU, AD = StaffRole.ANALYST, StaffRole.SUPERVISOR, StaffRole.AUTOMATION, StaffRole.ADMIN

DEMO_STAFF: tuple[StaffSeed, ...] = (
    # Main persona of the analyst Workspace.
    StaffSeed(1, "Daniela Ríos", "daniela.rios", frozenset({A}), StaffLevel.SPECIALIST,
              frozenset({ES, PT}), TEAM_ANDES),
    StaffSeed(2, "Julián Ortega", "julian.ortega", frozenset({A}), StaffLevel.JUNIOR,
              frozenset({ES}), TEAM_ANDES),
    StaffSeed(3, "Paula Medina", "paula.medina", frozenset({A}), StaffLevel.MID_SENIOR,
              frozenset({ES}), TEAM_PACIFICO),
    StaffSeed(4, "Sebastián Cárdenas", "sebastian.cardenas", frozenset({A}), StaffLevel.SENIOR,
              frozenset({ES, PT}), TEAM_PACIFICO),
    # Supervisors (approvals, team, audit).
    StaffSeed(5, "Lucía Herrera", "lucia.herrera", frozenset({S}), StaffLevel.SPECIALIST,
              frozenset({ES, PT}), TEAM_ANDES),
    StaffSeed(6, "Martín Salazar", "martin.salazar", frozenset({S}), StaffLevel.SENIOR,
              frozenset({ES}), TEAM_PACIFICO),
    # Automatización + Administración in one person → four-eyes on admin changes.
    StaffSeed(7, "Valeria Quintero", "valeria.quintero", frozenset({AU, AD}), StaffLevel.SENIOR,
              frozenset({ES}), TEAM_AUTOMATION),
    StaffSeed(8, "Tomás Arango", "tomas.arango", frozenset({AU}), StaffLevel.SENIOR,
              frozenset({ES, PT}), TEAM_AUTOMATION),
    StaffSeed(9, "Carolina Peña", "carolina.pena", frozenset({AD}), StaffLevel.SENIOR,
              frozenset({ES}), TEAM_PLATFORM),
    # Supervisora + Automatización (canvas au3).
    StaffSeed(10, "Renata Villalba", "renata.villalba", frozenset({S, AU}), StaffLevel.SPECIALIST,
              frozenset({ES, PT}), TEAM_AUTOMATION),
    # Team lead: Analista + Supervisora (works cases and approves the team's requests).
    StaffSeed(11, "Felipe Echeverri", "felipe.echeverri", frozenset({A, S}), StaffLevel.SENIOR,
              frozenset({ES}), TEAM_ANDES),
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
