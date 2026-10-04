"""Test doubles and builders shared by the suite."""

from __future__ import annotations

import asyncio
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from typing import Any

from cc_platform.application.people.auth import (
    AuthenticateSession,
    LoginWithPassword,
    Logout,
    VerifyMfa,
)
from cc_platform.application.ports.unit_of_work import UnitOfWork, UnitOfWorkFactory
from cc_platform.application.security import Actor, CustomerActor
from cc_platform.bootstrap.container import Container, build_container
from cc_platform.bootstrap.settings import Settings
from cc_platform.domain.cases.values import CaseChannel
from cc_platform.domain.people.availability import AvailabilityStatus
from cc_platform.domain.people.login_account import LockoutPolicy
from cc_platform.domain.people.mfa import MfaMethod, MfaPolicy
from cc_platform.domain.people.staff import StaffRole
from cc_platform.domain.shared.events import DomainEvent
from cc_platform.infrastructure.clock import FixedClock
from cc_platform.infrastructure.events.in_process_bus import InProcessEventBus
from cc_platform.infrastructure.ids import SequentialIdGenerator
from cc_platform.infrastructure.persistence.memory.store import InMemoryStore
from cc_platform.infrastructure.persistence.memory.unit_of_work import InMemoryUnitOfWork
from cc_platform.infrastructure.security.login_attempts import InMemoryUnknownLoginAttempts
from cc_platform.infrastructure.security.mfa import DevMfaVerifier
from cc_platform.infrastructure.security.tokens import HmacSessionTokenService
from cc_platform.infrastructure.seed.customers import DEMO_CUSTOMERS
from cc_platform.infrastructure.seed.people import (
    DEMO_PASSWORD,
    DEMO_STAFF,
    StaffSeed,
    seed_staff_id,
)

TEST_SECRET = "test-secret-that-is-long-enough-for-hs256-0123"
DEV_MFA_CODE = "000000"

ANALYST = next(s for s in DEMO_STAFF if s.name == "Daniela Ríos")
SUPERVISOR = next(s for s in DEMO_STAFF if s.name == "Lucía Herrera")
ADMIN_ONLY = next(s for s in DEMO_STAFF if s.name == "Valeria Quintero")
ADMIN = next(s for s in DEMO_STAFF if s.name == "Carolina Peña")
SECOND_SUPERVISOR = next(s for s in DEMO_STAFF if s.name == "Renata Villalba")
TEAM_LEAD = next(s for s in DEMO_STAFF if s.name == "Felipe Echeverri")
PASSWORD = DEMO_PASSWORD


def make_settings(**overrides: Any) -> Settings:
    """Fast, isolated settings: in-memory SQLite, cheap Argon2, quiet logs."""
    values: dict[str, Any] = {
        "env": "test",
        "persistence": "sqlalchemy",
        "database_url": "sqlite+aiosqlite:///:memory:",
        "argon2_time_cost": 1,
        "argon2_memory_cost": 1024,
        "argon2_parallelism": 1,
        "log_level": "WARNING",
        "session_secret": TEST_SECRET,
        "build": "test-build",
        # Slice 10: no periodic SLA sweep (tests run ``sweep_sla_risk.execute`` themselves).
        "notification_sweep_seconds": 0,
    }
    values.update(overrides)
    return Settings(_env_file=None, **values)  # ignore a developer's backend/.env


def bearer(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


class PlainHasher:
    """Instant ``PasswordHasher`` for unit tests (never use outside tests)."""

    async def hash(self, password: str) -> str:
        return f"plain:{password}"

    async def verify(self, password_hash: str | None, password: str) -> bool:
        return password_hash is not None and password_hash == f"plain:{password}"


class YieldingHasher(PlainHasher):
    """``PlainHasher`` that yields to the event loop like a real (threaded) Argon2 check,
    so concurrent use-case calls interleave between the read and the save."""

    async def verify(self, password_hash: str | None, password: str) -> bool:
        await asyncio.sleep(0)
        await asyncio.sleep(0)
        return await super().verify(password_hash, password)


class YieldingMfaVerifier(DevMfaVerifier):
    """``DevMfaVerifier`` that yields like a network call to a real MFA provider."""

    async def verify(self, *, staff_id: str, method: MfaMethod, code: str) -> bool:
        await asyncio.sleep(0)
        await asyncio.sleep(0)
        return await super().verify(staff_id=staff_id, method=method, code=code)


class RecordingHandler:
    def __init__(self) -> None:
        self.records: list[Any] = []

    async def __call__(self, record: Any) -> None:
        self.records.append(record)

    @property
    def event_types(self) -> list[str]:
        return [record.event_type for record in self.records]


@dataclass
class AuthKit:
    """Auth use cases over an in-memory Unit of Work, with controllable time."""

    clock: FixedClock
    ids: SequentialIdGenerator
    bus: InProcessEventBus
    store: InMemoryStore
    uow: UnitOfWorkFactory
    hasher: PlainHasher
    tokens: HmacSessionTokenService
    login: LoginWithPassword
    verify_mfa: VerifyMfa
    authenticate: AuthenticateSession
    logout: Logout


def build_auth_kit(
    *,
    lockout: LockoutPolicy | None = None,
    mfa: MfaPolicy | None = None,
    session_ttl: timedelta = timedelta(hours=8),
    hasher: PlainHasher | None = None,
    verifier: DevMfaVerifier | None = None,
) -> AuthKit:
    clock = FixedClock()
    ids = SequentialIdGenerator()
    bus = InProcessEventBus()
    store = InMemoryStore()

    def uow() -> UnitOfWork:
        return InMemoryUnitOfWork(store, bus=bus, ids=ids, clock=clock)

    hasher = hasher or PlainHasher()
    lockout = lockout or LockoutPolicy()
    tokens = HmacSessionTokenService(TEST_SECRET)
    return AuthKit(
        clock=clock,
        ids=ids,
        bus=bus,
        store=store,
        uow=uow,
        hasher=hasher,
        tokens=tokens,
        login=LoginWithPassword(
            uow=uow,
            hasher=hasher,
            clock=clock,
            ids=ids,
            lockout=lockout,
            mfa=mfa or MfaPolicy(),
            unknown_attempts=InMemoryUnknownLoginAttempts(),
        ),
        verify_mfa=VerifyMfa(
            uow=uow,
            verifier=verifier or DevMfaVerifier(DEV_MFA_CODE),
            tokens=tokens,
            clock=clock,
            ids=ids,
            lockout=lockout,
            session_ttl=session_ttl,
        ),
        authenticate=AuthenticateSession(uow=uow, tokens=tokens, clock=clock),
        logout=Logout(uow=uow, clock=clock),
    )


async def make_available_quietly(uow: UnitOfWorkFactory, *staff_ids: str) -> None:
    """Arrange: these analysts are ``available`` and the seeded queues stay as they are.

    The seed starts with nobody available (an available Spanish or Portuguese speaker
    would already have drained the queued cases, rule 3), and an availability change
    through the API drains the queue in the background. Tests about manual assignment,
    reassignment or the team view need an available target *and* the seeded queues, so
    they store the state directly, without the ``staff.availability_changed`` event that
    starts the drain.
    """
    async with uow() as unit:
        for staff_id in staff_ids:
            row = await unit.availability.get(staff_id)
            assert row is not None, staff_id
            row.status = AvailabilityStatus.AVAILABLE
            await unit.availability.save(row)
        await unit.commit()


async def emit(uow: UnitOfWorkFactory, *events: DomainEvent) -> None:
    """Commit loose events through a Unit of Work (event log + bus)."""
    async with uow() as unit:
        unit.record(*events)
        await unit.commit()


def make_actor(*roles: StaffRole, staff_id: str = "STF-" + "0" * 25 + "7") -> Actor:
    return Actor(
        staff_id=staff_id,
        name="Valeria Quintero",
        roles=frozenset(roles),
        session_id="SES-" + "0" * 25 + "1",
        session_expires_at=datetime(2026, 10, 2, 22, tzinfo=UTC),
    )


# ----------------------------------------------------------------------------- slice 1 helpers
class FixedPasswords:
    """``TemporaryPasswordGenerator`` for tests: predictable ``abcd-efgh-0001``, ``…-0002``."""

    def __init__(self) -> None:
        self.issued: list[str] = []

    def generate(self) -> str:
        password = f"abcd-efgh-{len(self.issued) + 1:04d}"
        self.issued.append(password)
        return password


async def memory_container(
    *,
    seed: bool = True,
    clock: FixedClock | None = None,
    passwords: FixedPasswords | None = None,
) -> Container:
    """The real composition (use cases, projections, queue drainer) over the in-memory UoW."""
    container = build_container(
        make_settings(persistence="memory", seed_demo_data=seed),
        clock=clock or FixedClock(),
        ids=SequentialIdGenerator(),
        temporary_passwords=passwords,
    )
    await container.startup()
    return container


def actor_for(seed: StaffSeed) -> Actor:
    return Actor(
        staff_id=seed_staff_id(seed.number),
        name=seed.name,
        roles=seed.roles,
        session_id="SES-" + str(seed.number).zfill(26),
        session_expires_at=datetime(2026, 10, 3, tzinfo=UTC),
    )


def customer_actor(number: int, *, channel: CaseChannel = CaseChannel.APP_CHAT) -> CustomerActor:
    seed = next(s for s in DEMO_CUSTOMERS if s.number == number)
    return CustomerActor(
        customer_id=seed.id,
        display_name=seed.name,
        session_id="CSN-" + str(number).zfill(26),
        channel=channel,
        session_expires_at=datetime(2026, 10, 3, tzinfo=UTC),
    )


SEBASTIAN = next(s for s in DEMO_STAFF if s.name == "Sebastián Cárdenas")
JULIAN = next(s for s in DEMO_STAFF if s.name == "Julián Ortega")
TOMAS = next(s for s in DEMO_STAFF if s.name == "Tomás Arango")
PAULA = next(s for s in DEMO_STAFF if s.name == "Paula Medina")
MARIANA = next(s for s in DEMO_STAFF if s.name == "Mariana Duque")
ANDRES = next(s for s in DEMO_STAFF if s.name == "Andrés Villamil")
