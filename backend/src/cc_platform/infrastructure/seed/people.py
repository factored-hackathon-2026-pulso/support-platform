"""Seed staff and teams — "Datos de ejemplo" (slice 2 contract §8.1, slice 4 §11).

Every name, email and id here is invented (brief §4.7: staff names in the dataset are records
too and must never be copied). Roles combine (Analista, Supervisora, Administración):

- the main persona is an analyst who speaks Spanish and Portuguese (Daniela);
- more analysts, two of them bilingual (Sebastián, Tomás) to show least-loaded balancing;
- supervisors, plus a team lead holding Analista + Supervisora (Felipe exercises the
  role switcher: Casos ↔ Equipo y colas);
- administrators;
- slice 4: Mariana (Supervisora, locked by the admin story) and Andrés (an analyst whose
  account Carolina deactivated). Neither appears in "Equipo y colas", so the slice 3
  numbers do not move.

Teams are records (slice 4): three active teams that existed before the event log (no
creation event) and "Disputas · Equipo Caribe", created and deactivated by Valeria in the
admin story (``add_demo_admin_story``). Every seeded account uses ``DEMO_PASSWORD``.
"""

from __future__ import annotations

from dataclasses import dataclass, replace
from datetime import UTC, datetime, timedelta

from cc_platform.application.ports.clock import Clock
from cc_platform.application.ports.security import PasswordHasher
from cc_platform.application.ports.unit_of_work import UnitOfWork, UnitOfWorkFactory
from cc_platform.domain.people.admin_roster import AdminRoster
from cc_platform.domain.people.availability import AnalystAvailability, AvailabilityStatus
from cc_platform.domain.people.login_account import LockoutPolicy, LoginAccount
from cc_platform.domain.people.mfa import MfaMethod
from cc_platform.domain.people.session import StaffSession
from cc_platform.domain.people.staff import Language, Staff, StaffRole
from cc_platform.domain.people.team import Team
from cc_platform.domain.shared.actor import ActorRef, ActorRole
from cc_platform.domain.shared.ids import BODY_LENGTH, IdPrefix, make_id
from cc_platform.infrastructure.seed.timeline import SeedTimeline

DEMO_PASSWORD = "demo1234"
DEMO_EMAIL_DOMAIN = "latambank.example"

ES = Language.SPANISH
PT = Language.PORTUGUESE

#: Teams 1–3 (and every seeded person) exist since this long before the first seed.
SEEDED_DIRECTORY_AGE = timedelta(days=30)


def seed_team_id(number: int) -> str:
    return make_id(IdPrefix.TEAM, str(number).zfill(BODY_LENGTH))


@dataclass(frozen=True, slots=True)
class TeamSeed:
    number: int
    name: str

    @property
    def id(self) -> str:
        return seed_team_id(self.number)


TEAM_ANDES = TeamSeed(1, "Disputas · Equipo Andes")
TEAM_PACIFICO = TeamSeed(2, "Disputas · Equipo Pacífico")
TEAM_PLATFORM = TeamSeed(3, "Administración de la plataforma")
#: Created and deactivated in the admin story (inactive, no members).
TEAM_CARIBE = TeamSeed(4, "Disputas · Equipo Caribe")

#: Teams the staff seed creates (active, no event: they existed before the log).
DEMO_TEAMS: tuple[TeamSeed, ...] = (TEAM_ANDES, TEAM_PACIFICO, TEAM_PLATFORM)


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
    team: TeamSeed
    active: bool = True

    @property
    def id(self) -> str:
        return seed_staff_id(self.number)

    @property
    def email(self) -> str:
        return f"{self.username}@{DEMO_EMAIL_DOMAIN}"

    def to_staff(self, created_at: datetime) -> Staff:
        return Staff(
            id=self.id,
            name=self.name,
            email=self.email,
            roles=self.roles,
            languages=self.languages,
            team_id=self.team.id,
            created_at=created_at,
            active=self.active,
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
    # Team lead: Analista + Supervisora (works cases and watches the team's queues). Valeria
    # gave him Supervisora five days before the first seed (admin story).
    StaffSeed(11, "Felipe Echeverri", "felipe.echeverri", frozenset({A, S}), frozenset({ES}),
              TEAM_ANDES),
    # Slice 4: locked by five wrong passwords (admin story); the rail badge shows 1.
    StaffSeed(12, "Mariana Duque", "mariana.duque", frozenset({S}), frozenset({ES}),
              TEAM_PACIFICO),
    # Slice 4: deactivated by Carolina two days before the first seed (admin story).
    StaffSeed(13, "Andrés Villamil", "andres.villamil", frozenset({A}), frozenset({ES}),
              TEAM_ANDES, active=False),
)  # fmt: skip

FELIPE = next(seed for seed in DEMO_STAFF if seed.number == 11)
MARIANA = next(seed for seed in DEMO_STAFF if seed.number == 12)
ANDRES = next(seed for seed in DEMO_STAFF if seed.number == 13)
VALERIA = next(seed for seed in DEMO_STAFF if seed.number == 7)
CAROLINA = next(seed for seed in DEMO_STAFF if seed.number == 9)


async def seed_demo_staff(
    uow: UnitOfWorkFactory,
    hasher: PasswordHasher,
    *,
    now: datetime | None = None,
    password: str = DEMO_PASSWORD,
    seeds: tuple[StaffSeed, ...] = DEMO_STAFF,
    teams: tuple[TeamSeed, ...] = DEMO_TEAMS,
) -> int:
    """Insert missing seed teams, staff, their login accounts and the admin roster.

    Idempotent; returns how many people it created. Nothing here records an event: the
    directory existed before the log (the admin story adds the events that tell it).
    """
    created_at = (now or datetime.now(UTC)) - SEEDED_DIRECTORY_AGE
    created = 0
    async with uow() as unit:
        for team_seed in teams:
            if await unit.teams.get(team_seed.id) is None:
                await unit.teams.add(
                    Team(id=team_seed.id, name=team_seed.name, active=True, created_at=created_at)
                )
        for seed in seeds:
            if await unit.staff.get(seed.id) is not None:
                continue
            staff = seed.to_staff(created_at)
            await unit.staff.add(staff)
            await unit.login_accounts.add(
                LoginAccount(staff_id=staff.id, password_hash=await hasher.hash(password))
            )
            created += 1
        if await unit.admin_roster.get() is None:
            admins = frozenset(seed.id for seed in seeds if seed.active and AD in seed.roles)
            await unit.admin_roster.add(AdminRoster(admin_ids=admins))
        await unit.commit()
    return created


def _admin(seed: StaffSeed) -> ActorRef:
    return ActorRef(ActorRole.ADMIN, seed.id)


async def add_demo_admin_story(unit: UnitOfWork, t: datetime, timeline: SeedTimeline) -> int:
    """Slice 4 §11: what administration did before the first seed, through the domain, with
    the story's times (its events go to ``timeline``). Runs once (marker: team Caribe).

    - Valeria gave Felipe the Supervisora role at T−5d (his stored row already has it: the
      event is recorded on his earlier revision);
    - Valeria created "Disputas · Equipo Caribe" at T−3d and deactivated it at T−1d;
    - Carolina deactivated Andrés at T−2d (no sessions to end);
    - Mariana typed a wrong password five times (T−6m … T−2m): locked until T+13m.
    """
    if await unit.teams.get(TEAM_CARIBE.id) is not None:
        return 0
    created_at = t - SEEDED_DIRECTORY_AGE
    felipe = replace(FELIPE, roles=frozenset({A})).to_staff(created_at)
    felipe.set_roles(FELIPE.roles, now=t - timedelta(days=5), actor=_admin(VALERIA))
    andres = replace(ANDRES, active=True).to_staff(created_at)
    andres.deactivate(revoked_sessions=0, now=t - timedelta(days=2), actor=_admin(CAROLINA))
    timeline.take(felipe, andres)

    caribe = Team.create(
        team_id=TEAM_CARIBE.id,
        name=TEAM_CARIBE.name,
        now=t - timedelta(days=3),
        actor=_admin(VALERIA),
    )
    caribe.deactivate(active_members=0, now=t - timedelta(days=1), actor=_admin(VALERIA))
    await unit.teams.add(caribe)
    timeline.take(caribe)

    account = await unit.login_accounts.get(MARIANA.id)
    if account is not None:
        herself = ActorRef(ActorRole.SUPERVISOR, MARIANA.id)
        for minutes in (6, 5, 4, 3, 2):
            account.register_failed_attempt(
                now=t - timedelta(minutes=minutes), policy=LockoutPolicy(), actor=herself
            )
        await unit.login_accounts.save(account)
        timeline.take(account)
    return 1


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
        if StaffRole.ANALYST not in seed.roles or not seed.active:
            continue  # an inactive analyst (Andrés) has no availability row
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


async def seed_demo_admin_story(uow: UnitOfWorkFactory, clock: Clock) -> int:
    """``add_demo_admin_story`` in its own Unit of Work (tests). Idempotent."""
    timeline = SeedTimeline()
    async with uow() as unit:
        created = await add_demo_admin_story(unit, clock.now(), timeline)
        timeline.record_into(unit)
        await unit.commit()
    return created
