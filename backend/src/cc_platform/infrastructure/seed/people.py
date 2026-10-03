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
from datetime import datetime, timedelta

from cc_platform.application.ports.clock import Clock
from cc_platform.application.ports.security import PasswordHasher
from cc_platform.application.ports.unit_of_work import UnitOfWork, UnitOfWorkFactory
from cc_platform.domain.people.availability import AnalystAvailability, AvailabilityStatus
from cc_platform.domain.people.login_account import LoginAccount
from cc_platform.domain.people.mfa import MfaMethod
from cc_platform.domain.people.session import StaffSession
from cc_platform.domain.people.staff import Language, Staff, StaffRole
from cc_platform.domain.shared.actor import ActorRef, ActorRole
from cc_platform.domain.shared.ids import BODY_LENGTH, IdPrefix, make_id
from cc_platform.infrastructure.seed.timeline import SeedTimeline

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


#: Analysts who start ``available``. Nobody: the seeded queues hold cases nobody available
#: could take (rule 3), so an available Spanish or Portuguese speaker would contradict them.
#: Sign in as Daniela (es, pt) and switch to "Disponible": the queues drain to her, oldest
#: first, and new chats land on her. Sebastián or Tomás (es, pt, no cases) then show the
#: least-loaded balancing.
DEMO_AVAILABLE_ANALYSTS: frozenset[int] = frozenset()

#: Analysts who were available and paused this long before the first seed (slice 3 §9.3),
#: each with a ``staff.availability_changed`` at the story's time:
#: - Paula paused before Lucía moved her case (114) to Julián;
#: - Julián is the "En pausa" row of "Equipo y colas" (signed in, see ``DEMO_SESSIONS``);
#: - Daniela paused right after her last new case (103) and before the queued cases (111,
#:   112, 109) arrived, which is why they wait.
DEMO_PAUSED_BEFORE: dict[int, timedelta] = {
    3: timedelta(minutes=33),
    2: timedelta(minutes=20),
    1: timedelta(minutes=12),
}

#: Seeded staff sessions, started this long before the first seed (slice 3 §9.3): Julián is
#: signed in (so "En pausa", not "Desconectada") until the session's normal TTL runs out.
DEMO_SESSIONS: dict[int, timedelta] = {2: timedelta(minutes=45)}
#: How long the paused analysts had been available before pausing (the story). Daniela's
#: oldest open case arrived 50 minutes before the seed, so her shift started earlier.
_AVAILABLE_SINCE = timedelta(minutes=45)
_AVAILABLE_SINCE_BY_ANALYST: dict[int, timedelta] = {1: timedelta(minutes=60)}


def seed_session_id(number: int) -> str:
    """Stable id of a seeded session. The ``Z…`` body keeps it apart from generated ids
    (time-ordered ULIDs, or the sequential ids of the tests)."""
    return make_id(IdPrefix.SESSION, str(number).rjust(BODY_LENGTH, "Z"))


def _analyst_ref(number: int) -> ActorRef:
    return ActorRef(ActorRole.ANALYST, seed_staff_id(number))


async def add_demo_sessions(
    unit: UnitOfWork,
    t: datetime,
    timeline: SeedTimeline,
    *,
    ttl: timedelta,
    sessions: dict[int, timedelta] = DEMO_SESSIONS,
) -> int:
    """Seeded sign-ins (``auth.session_started`` with the story's time) missing from
    ``unit``; their events go to ``timeline``. Returns how many."""
    created = 0
    for number, ago in sessions.items():
        session_id = seed_session_id(number)
        if await unit.sessions.get(session_id) is not None:
            continue
        session = StaffSession.start(
            session_id=session_id,
            staff_id=seed_staff_id(number),
            now=t - ago,
            ttl=ttl,
            mfa_method=MfaMethod.TOTP,
            actor=_analyst_ref(number),
        )
        await unit.sessions.add(session)
        timeline.take(session)
        created += 1
    return created


async def seed_demo_sessions(
    uow: UnitOfWorkFactory,
    clock: Clock,
    *,
    ttl: timedelta,
    sessions: dict[int, timedelta] = DEMO_SESSIONS,
) -> int:
    """``add_demo_sessions`` in its own Unit of Work. Idempotent; the session expires after
    ``ttl`` like any other (delete the database to re-anchor)."""
    timeline = SeedTimeline()
    async with uow() as unit:
        created = await add_demo_sessions(unit, clock.now(), timeline, ttl=ttl, sessions=sessions)
        timeline.record_into(unit)
        await unit.commit()
    return created


async def add_demo_availability(
    unit: UnitOfWork,
    t: datetime,
    timeline: SeedTimeline,
    *,
    seeds: tuple[StaffSeed, ...] = DEMO_STAFF,
    available: frozenset[int] = DEMO_AVAILABLE_ANALYSTS,
    paused_before: dict[int, timedelta] = DEMO_PAUSED_BEFORE,
) -> int:
    """Availability rows for every seeded analyst that has none; the pauses' events go to
    ``timeline``. Returns how many."""
    created = 0
    for seed in seeds:
        if StaffRole.ANALYST not in seed.roles:
            continue
        staff_id = seed_staff_id(seed.number)
        if await unit.availability.get(staff_id) is not None:
            continue
        ago = paused_before.get(seed.number)
        if ago is not None:
            # Through the domain, so the log has the pause at the story's time.
            since = _AVAILABLE_SINCE_BY_ANALYST.get(seed.number, _AVAILABLE_SINCE)
            row = AnalystAvailability(
                staff_id=staff_id, status=AvailabilityStatus.AVAILABLE, since=t - since
            )
            row.change(AvailabilityStatus.PAUSED, now=t - ago, actor=_analyst_ref(seed.number))
        else:
            status = (
                AvailabilityStatus.AVAILABLE
                if seed.number in available
                else AvailabilityStatus.PAUSED
            )
            row = AnalystAvailability(staff_id=staff_id, status=status, since=t)
        await unit.availability.add(row)
        timeline.take(row)
        created += 1
    return created


async def seed_demo_availability(
    uow: UnitOfWorkFactory,
    clock: Clock,
    *,
    seeds: tuple[StaffSeed, ...] = DEMO_STAFF,
    available: frozenset[int] = DEMO_AVAILABLE_ANALYSTS,
    paused_before: dict[int, timedelta] = DEMO_PAUSED_BEFORE,
) -> int:
    """``add_demo_availability`` in its own Unit of Work. Idempotent."""
    timeline = SeedTimeline()
    async with uow() as unit:
        created = await add_demo_availability(
            unit,
            clock.now(),
            timeline,
            seeds=seeds,
            available=available,
            paused_before=paused_before,
        )
        timeline.record_into(unit)
        await unit.commit()
    return created
