"""Composition root: the only module that knows concrete adapter classes.

``build_container(settings)`` wires settings → adapters → use cases and subscribes the
event-bus consumers. Tests pass their own clock/id generator to get deterministic output.
"""

from __future__ import annotations

from collections.abc import Sequence
from dataclasses import dataclass, field

import structlog

from cc_platform.api.context import ApiContext, BuildInfo, RealtimeOptions
from cc_platform.application.people.auth import (
    AuthenticateSession,
    LoginWithPassword,
    Logout,
    VerifyMfa,
)
from cc_platform.application.people.queries import GetCurrentStaff, ListStaff
from cc_platform.application.people.use_cases import PeopleUseCases
from cc_platform.application.ports.clock import Clock
from cc_platform.application.ports.event_bus import EventBus
from cc_platform.application.ports.health import HealthProbe
from cc_platform.application.ports.ids import IdGenerator
from cc_platform.application.ports.realtime import RealtimeHub
from cc_platform.application.ports.security import (
    MfaVerifier,
    PasswordHasher,
    SessionTokenService,
)
from cc_platform.application.ports.unit_of_work import UnitOfWork, UnitOfWorkFactory
from cc_platform.application.realtime.projector import (
    RealtimeProjector,
    SessionTerminator,
    TopicMapper,
)
from cc_platform.application.realtime.topics import TopicAccessPolicy
from cc_platform.application.use_cases import UseCases
from cc_platform.bootstrap.settings import Settings
from cc_platform.domain.people.events import SessionEnded
from cc_platform.domain.people.login_account import LockoutPolicy
from cc_platform.domain.people.mfa import MfaPolicy
from cc_platform.infrastructure.clock import SystemClock
from cc_platform.infrastructure.events.in_process_bus import InProcessEventBus
from cc_platform.infrastructure.ids import UlidIdGenerator
from cc_platform.infrastructure.persistence.memory.store import InMemoryStore
from cc_platform.infrastructure.persistence.memory.unit_of_work import InMemoryUnitOfWork
from cc_platform.infrastructure.persistence.sqlalchemy.database import Database, DatabaseProbe
from cc_platform.infrastructure.persistence.sqlalchemy.unit_of_work import SqlAlchemyUnitOfWork
from cc_platform.infrastructure.realtime.in_memory_hub import InMemoryRealtimeHub
from cc_platform.infrastructure.security.login_attempts import InMemoryUnknownLoginAttempts
from cc_platform.infrastructure.security.mfa import DevMfaVerifier
from cc_platform.infrastructure.security.passwords import Argon2PasswordHasher
from cc_platform.infrastructure.security.tokens import HmacSessionTokenService
from cc_platform.infrastructure.seed.people import seed_demo_staff

_log = structlog.get_logger(__name__)


@dataclass
class Container:
    settings: Settings
    clock: Clock
    ids: IdGenerator
    event_bus: EventBus
    realtime_hub: RealtimeHub
    topic_access: TopicAccessPolicy
    topic_mapper: TopicMapper
    uow: UnitOfWorkFactory
    password_hasher: PasswordHasher
    tokens: SessionTokenService
    mfa_verifier: MfaVerifier
    use_cases: UseCases
    database: Database | None = None
    health_probes: Sequence[HealthProbe] = field(default_factory=tuple)

    def api_context(self) -> ApiContext:
        """The narrow view the HTTP/WebSocket layer gets (no adapters, no Unit of Work)."""
        return ApiContext(
            use_cases=self.use_cases,
            clock=self.clock,
            ids=self.ids,
            realtime_hub=self.realtime_hub,
            topic_access=self.topic_access,
            health_probes=self.health_probes,
            build_info=BuildInfo(build=self.settings.build, environment=self.settings.env),
            realtime=RealtimeOptions(
                expiry_check_interval=self.settings.realtime_expiry_check_interval
            ),
        )

    async def startup(self) -> None:
        if self.database is not None:
            await self.database.create_schema()
        if self.settings.seed_demo_data:
            created = await seed_demo_staff(self.uow, self.password_hasher)
            if created:
                _log.info("seed_demo_staff", created=created)

    async def shutdown(self) -> None:
        if self.database is not None:
            await self.database.dispose()


def build_container(
    settings: Settings,
    *,
    clock: Clock | None = None,
    ids: IdGenerator | None = None,
) -> Container:
    if settings.env == "prod":
        # Fail fast: only the development MFA verifier exists today.
        raise RuntimeError("No production MFA provider is configured yet (DevMfaVerifier only).")
    clock = clock or SystemClock()
    ids = ids or UlidIdGenerator(clock)
    bus = InProcessEventBus()

    database: Database | None = None
    probes: list[HealthProbe] = []
    uow: UnitOfWorkFactory
    if settings.persistence == "sqlalchemy":
        database = Database(settings.database_url, echo=settings.database_echo)
        probes.append(DatabaseProbe(database))
        session_factory = database.session_factory

        def sql_uow() -> UnitOfWork:
            return SqlAlchemyUnitOfWork(session_factory, bus=bus, ids=ids, clock=clock)

        uow = sql_uow
    else:
        store = InMemoryStore()

        def memory_uow() -> UnitOfWork:
            return InMemoryUnitOfWork(store, bus=bus, ids=ids, clock=clock)

        uow = memory_uow

    hasher = Argon2PasswordHasher(
        time_cost=settings.argon2_time_cost,
        memory_cost=settings.argon2_memory_cost,
        parallelism=settings.argon2_parallelism,
    )
    tokens = HmacSessionTokenService(settings.session_secret.get_secret_value())
    mfa_verifier = DevMfaVerifier(settings.dev_mfa_code)

    hub = InMemoryRealtimeHub(queue_size=settings.realtime_queue_size)
    mapper = TopicMapper()
    bus.subscribe(RealtimeProjector(hub, mapper))
    bus.subscribe(SessionTerminator(hub), event_types=[SessionEnded])

    lockout = LockoutPolicy(
        max_failed_attempts=settings.lockout_max_attempts,
        lock_duration=settings.lockout_duration,
    )
    use_cases = UseCases(
        people=PeopleUseCases(
            login=LoginWithPassword(
                uow=uow,
                hasher=hasher,
                clock=clock,
                ids=ids,
                lockout=lockout,
                mfa=MfaPolicy(ttl=settings.mfa_ttl, max_attempts=settings.mfa_max_attempts),
                unknown_attempts=InMemoryUnknownLoginAttempts(),
            ),
            verify_mfa=VerifyMfa(
                uow=uow,
                verifier=mfa_verifier,
                tokens=tokens,
                clock=clock,
                ids=ids,
                lockout=lockout,
                session_ttl=settings.session_ttl,
            ),
            authenticate=AuthenticateSession(uow=uow, tokens=tokens, clock=clock),
            logout=Logout(uow=uow, clock=clock),
            current_staff=GetCurrentStaff(uow=uow),
            list_staff=ListStaff(uow=uow),
        )
    )

    return Container(
        settings=settings,
        clock=clock,
        ids=ids,
        event_bus=bus,
        realtime_hub=hub,
        topic_access=TopicAccessPolicy(),
        topic_mapper=mapper,
        uow=uow,
        password_hasher=hasher,
        tokens=tokens,
        mfa_verifier=mfa_verifier,
        use_cases=use_cases,
        database=database,
        health_probes=tuple(probes),
    )
