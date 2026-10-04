"""Composition root: the only module that knows concrete adapter classes.

``build_container(settings)`` wires settings → adapters → use cases and subscribes the
event-bus consumers. Tests pass their own clock/id generator to get deterministic output.
"""

from __future__ import annotations

from collections.abc import Sequence
from dataclasses import dataclass, field

import structlog

from cc_platform.api.context import ApiContext, BuildInfo, RealtimeOptions
from cc_platform.api.realtime_presenter import SchemaRealtimePresenter
from cc_platform.application.audit.queries import GetAuditEvent, ListAuditEvents
from cc_platform.application.audit.use_cases import AuditUseCases
from cc_platform.application.cases.analyst_home import GetAnalystHome
from cc_platform.application.cases.assignment import (
    QUEUE_DRAINER_EVENTS,
    AssignCase,
    DrainQueue,
    LanguageLeastLoadedStrategy,
    QueueDrainer,
    RepositoryAnalystDirectory,
)
from cc_platform.application.cases.calls import (
    AddInternalNote,
    AnswerCall,
    AnswerOutboundCall,
    EndCustomerCall,
    GetCustomerCall,
    HangUpCall,
    HoldCall,
    ListCaseCalls,
    PostCallLine,
    PostCustomerCallLine,
    ResumeCall,
    SetCallMuted,
    StartInboundCall,
    StartOutboundCall,
)
from cc_platform.application.cases.commands import CloseCase, MarkCaseRead, PostAnalystTurn
from cc_platform.application.cases.customer_chat import (
    GetCustomerConversation,
    GetPastConversation,
    ListPastConversations,
    PostCustomerTurn,
    RateConversation,
)
from cc_platform.application.cases.emails import (
    GetCustomerEmails,
    GetEmailThread,
    ReplyEmail,
    SendCustomerEmail,
)
from cc_platform.application.cases.escalations import (
    AcknowledgeEscalation,
    EscalateCase,
    GetEscalationOverview,
    RespondEscalation,
    TakeEscalatedCase,
    WithdrawEscalation,
)
from cc_platform.application.cases.manual_assignment import SetCaseAssignee
from cc_platform.application.cases.priority import ChangeCasePriority
from cc_platform.application.cases.queries import (
    AuthorizeCaseSubscription,
    GetCaseDetail,
    GetCaseHistory,
    GetInbox,
    ListCaseTurns,
)
from cc_platform.application.cases.realtime import (
    OWNED_EVENTS,
    SILENT_EVENTS,
    CaseRealtimeProjector,
)
from cc_platform.application.cases.sla import FirstResponseSlaPolicy
from cc_platform.application.cases.supervision import (
    GetLanguageOpenCases,
    GetQueueOverview,
    GetTeamOverview,
)
from cc_platform.application.cases.supervision_realtime import (
    SUPERVISION_EVENTS,
    SupervisionRealtimeProjector,
)
from cc_platform.application.cases.use_cases import CasesUseCases, ChannelsUseCases
from cc_platform.application.customers.use_cases import (
    AuthenticateCustomer,
    CustomersUseCases,
    ListDemoCustomers,
    StartCustomerSession,
)
from cc_platform.application.notifications.projector import NotificationProjector
from cc_platform.application.notifications.sweep import SweepSlaRisk
from cc_platform.application.notifications.use_cases import (
    ListMyNotifications,
    MarkAllNotificationsRead,
    MarkNotificationRead,
    NotificationsUseCases,
)
from cc_platform.application.notifications.writer import NotificationSignals, NotificationWriter
from cc_platform.application.people.admin.commands import (
    CancelInvitation,
    CreateUser,
    DeactivateUser,
    ReactivateUser,
    ResendInvitation,
    SendPasswordResetLink,
    UnlockAccount,
    UpdateUser,
)
from cc_platform.application.people.admin.guards import ensure_admin_roster
from cc_platform.application.people.admin.queries import GetTeam, GetUser, ListTeams, ListUsers
from cc_platform.application.people.admin.realtime import (
    ADMIN_OWNED_EVENTS,
    ADMIN_REALTIME_EVENTS,
    AdministrationRealtimeProjector,
)
from cc_platform.application.people.admin.team_commands import (
    CreateTeam,
    DeactivateTeam,
    ReactivateTeam,
    RenameTeam,
)
from cc_platform.application.people.admin.use_cases import AdministrationUseCases
from cc_platform.application.people.auth import (
    AuthenticateSession,
    LoginWithPassword,
    Logout,
    VerifyMfa,
)
from cc_platform.application.people.availability import GetMyAvailability, SetMyAvailability
from cc_platform.application.people.onboarding.commands import (
    ActivateInvitation,
    CheckInvitation,
    CheckPasswordReset,
    CompletePasswordReset,
    LinkGuard,
    SetInvitationPassword,
)
from cc_platform.application.people.onboarding.dev_mailbox import ListDevMailbox
from cc_platform.application.people.onboarding.links import AppLinks
from cc_platform.application.people.onboarding.mailer import OnboardingMailer
from cc_platform.application.people.onboarding.use_cases import OnboardingUseCases
from cc_platform.application.people.queries import GetCurrentStaff, ListStaff
from cc_platform.application.people.use_cases import PeopleUseCases
from cc_platform.application.ports.clock import Clock
from cc_platform.application.ports.email import DevMailbox, EmailSender
from cc_platform.application.ports.event_bus import EventBus
from cc_platform.application.ports.health import HealthProbe
from cc_platform.application.ports.ids import IdGenerator
from cc_platform.application.ports.realtime import RealtimeHub
from cc_platform.application.ports.security import (
    MfaVerifier,
    OneTimeTokens,
    PasswordHasher,
    SecretBox,
    SessionTokenService,
)
from cc_platform.application.ports.unit_of_work import UnitOfWork, UnitOfWorkFactory
from cc_platform.application.realtime.projector import (
    AccessTerminator,
    RealtimeProjector,
    SessionTerminator,
    TopicMapper,
)
from cc_platform.application.realtime.topics import TopicAccessPolicy
from cc_platform.application.use_cases import UseCases
from cc_platform.bootstrap.settings import Settings
from cc_platform.domain.people.events import SessionEnded, StaffRolesChanged
from cc_platform.domain.people.login_account import LockoutPolicy
from cc_platform.domain.people.mfa import MfaPolicy
from cc_platform.infrastructure.background import AsyncioBackgroundTasks, PeriodicTask
from cc_platform.infrastructure.clock import SystemClock
from cc_platform.infrastructure.email.dev_mailbox import (
    DiscardingEmailSender,
    InMemoryDevMailbox,
    SqlDevMailbox,
)
from cc_platform.infrastructure.events.in_process_bus import InProcessEventBus
from cc_platform.infrastructure.ids import UlidIdGenerator
from cc_platform.infrastructure.persistence.memory.store import InMemoryStore
from cc_platform.infrastructure.persistence.memory.unit_of_work import InMemoryUnitOfWork
from cc_platform.infrastructure.persistence.sqlalchemy.database import Database, DatabaseProbe
from cc_platform.infrastructure.persistence.sqlalchemy.unit_of_work import SqlAlchemyUnitOfWork
from cc_platform.infrastructure.realtime.in_memory_hub import InMemoryRealtimeHub
from cc_platform.infrastructure.security.customer_tokens import HmacCustomerTokenService
from cc_platform.infrastructure.security.login_attempts import InMemoryUnknownLoginAttempts
from cc_platform.infrastructure.security.mfa import DevMfaVerifier
from cc_platform.infrastructure.security.one_time_tokens import SecretsOneTimeTokens
from cc_platform.infrastructure.security.passwords import Argon2PasswordHasher
from cc_platform.infrastructure.security.secret_box import FernetSecretBox, derive_key
from cc_platform.infrastructure.security.tokens import HmacSessionTokenService
from cc_platform.infrastructure.security.totp import PyotpTotpService
from cc_platform.infrastructure.seed.activity import seed_demo_activity
from cc_platform.infrastructure.seed.customers import seed_demo_customers
from cc_platform.infrastructure.seed.notifications import mark_seed_notifications_seen
from cc_platform.infrastructure.seed.onboarding import SeedOnboarding
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
    background: AsyncioBackgroundTasks
    drain_queue: DrainQueue
    # Part 4: secure onboarding.
    one_time_tokens: OneTimeTokens
    totp: PyotpTotpService
    secret_box: SecretBox
    mailer: OnboardingMailer
    dev_mailbox: DevMailbox | None = None
    database: Database | None = None
    health_probes: Sequence[HealthProbe] = field(default_factory=tuple)
    sla_sweep: PeriodicTask | None = None

    def api_context(self) -> ApiContext:
        """The narrow view the HTTP/WebSocket layer gets (no adapters, no Unit of Work)."""
        return ApiContext(
            use_cases=self.use_cases,
            clock=self.clock,
            ids=self.ids,
            realtime_hub=self.realtime_hub,
            topic_access=self.topic_access,
            health_probes=self.health_probes,
            build_info=BuildInfo(
                build=self.settings.build,
                environment=self.settings.env,
                dev_mailbox=self.dev_mailbox is not None,
            ),
            realtime=RealtimeOptions(
                expiry_check_interval=self.settings.realtime_expiry_check_interval
            ),
        )

    async def startup(self) -> None:
        if self.database is not None:
            await self.database.create_schema()
        if self.settings.seed_demo_data:
            await self.seed_demo_data()
        # Slice 4 §2.3: the admin roster exists from the start (idempotent).
        await ensure_admin_roster(self.uow)
        # No startup drain (contract §3.2): the queue drains when an analyst becomes
        # available (``QueueDrainer``) and, in slice 3, by hand.
        if self.sla_sweep is not None:
            # Slice 10: cases already at risk get their notification now, then every tick.
            await self.use_cases.notifications.sweep_sla_risk.execute()
            self.sla_sweep.start()

    async def seed_demo_data(self) -> None:
        """ "Datos de ejemplo": invented staff, customers, availability and the seeded cases."""
        onboarding = SeedOnboarding(
            hasher=self.password_hasher, tokens=self.one_time_tokens, box=self.secret_box
        )
        created = {
            "staff": await seed_demo_staff(self.uow, self.password_hasher, now=self.clock.now()),
            "customers": await seed_demo_customers(self.uow),
            **await seed_demo_activity(
                self.uow,
                self.ids,
                self.clock,
                ttl=self.settings.session_ttl,
                onboarding=onboarding,
            ),
        }
        # Part 4: the seeded pending invitation's email, now that its link exists.
        for email in onboarding.emails:
            await self.mailer.invitation(email.staff, team_name=email.team_name, token=email.token)
        if created["cases"]:
            # Slice 10: the story's older notifications start read.
            created["notifications_seen"] = await mark_seed_notifications_seen(
                self.uow, now=self.clock.now()
            )
        if any(created.values()):
            _log.info("seed_demo_data", **created)

    async def shutdown(self) -> None:
        if self.sla_sweep is not None:
            await self.sla_sweep.stop()
        await self.background.drain()
        if self.database is not None:
            await self.database.dispose()


@dataclass(frozen=True, slots=True)
class _OnboardingKit:
    tokens: OneTimeTokens
    totp: PyotpTotpService
    box: SecretBox
    mailer: OnboardingMailer
    dev_mailbox: DevMailbox | None


def _onboarding_kit(
    settings: Settings,
    *,
    clock: Clock,
    ids: IdGenerator,
    database: Database | None,
    tokens: OneTimeTokens | None,
) -> _OnboardingKit:
    """Part 4 adapters: link tokens, TOTP, the secret box and the email sender (the dev
    mailbox while ``CC_DEV_MAILBOX`` is on, else a sender that drops the message)."""
    key = (
        settings.totp_secret_key.get_secret_value().encode()
        if settings.totp_secret_key is not None
        else derive_key(settings.session_secret.get_secret_value())
    )
    dev_mailbox: DevMailbox | None = None
    if settings.dev_mailbox_enabled:
        dev_mailbox = (
            SqlDevMailbox(database.session_factory, clock=clock, ids=ids)
            if database is not None
            else InMemoryDevMailbox(clock=clock, ids=ids)
        )
    sender: EmailSender = dev_mailbox if dev_mailbox is not None else DiscardingEmailSender()
    return _OnboardingKit(
        tokens=tokens or SecretsOneTimeTokens(),
        totp=PyotpTotpService(issuer=settings.totp_issuer),
        box=FernetSecretBox(key),
        mailer=OnboardingMailer(
            sender=sender,
            links=AppLinks(settings.public_app_url),
            invitation_ttl=settings.invitation_ttl,
            reset_ttl=settings.password_reset_ttl,
        ),
        dev_mailbox=dev_mailbox,
    )


def build_container(
    settings: Settings,
    *,
    clock: Clock | None = None,
    ids: IdGenerator | None = None,
    one_time_tokens: OneTimeTokens | None = None,
) -> Container:
    if settings.env == "prod":
        # Fail fast: there is no production email adapter yet (part 4: the dev mailbox only),
        # so nobody could receive an invitation or a reset link.
        raise RuntimeError("No production email adapter is configured yet (dev mailbox only).")
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

    customer_tokens = HmacCustomerTokenService(settings.session_secret.get_secret_value())
    background = AsyncioBackgroundTasks()

    # Part 4: secure onboarding (links by email, TOTP enrollment).
    kit = _onboarding_kit(settings, clock=clock, ids=ids, database=database, tokens=one_time_tokens)
    link_tokens, totp, secret_box, mailer = kit.tokens, kit.totp, kit.box, kit.mailer
    link_guard = LinkGuard(attempts=InMemoryUnknownLoginAttempts(), clock=clock)

    # Assignment (brief §4.6): one use case, two callers. ``AssignCase`` runs inside the
    # Unit of Work that opens a case (``PostCustomerTurn``) and inside ``DrainQueue``, which
    # the ``QueueDrainer`` process manager spawns when an analyst becomes available.
    assign_case = AssignCase(
        clock=clock,
        ids=ids,
        strategy=LanguageLeastLoadedStrategy(),
        directory=RepositoryAnalystDirectory(),
    )
    drain_queue = DrainQueue(uow=uow, assign_case=assign_case)

    hub = InMemoryRealtimeHub(queue_size=settings.realtime_queue_size)
    mapper = TopicMapper()
    mapper.suppress(*OWNED_EVENTS)  # the cases projection publishes their envelopes
    mapper.suppress(*SILENT_EVENTS)  # audited reads (case.viewed): never on a socket
    mapper.suppress(*ADMIN_OWNED_EVENTS)  # the administration projection signals them
    bus.subscribe(RealtimeProjector(hub, mapper))
    bus.subscribe(SessionTerminator(hub), event_types=[SessionEnded])
    bus.subscribe(AccessTerminator(hub), event_types=[StaffRolesChanged])
    bus.subscribe(
        AdministrationRealtimeProjector(hub, uow, SchemaRealtimePresenter()),
        event_types=ADMIN_REALTIME_EVENTS,
    )
    bus.subscribe(
        CaseRealtimeProjector(hub, uow, SchemaRealtimePresenter(), clock),
        event_types=OWNED_EVENTS,
    )
    bus.subscribe(
        SupervisionRealtimeProjector(hub, uow, SchemaRealtimePresenter(), clock),
        event_types=SUPERVISION_EVENTS,
    )
    bus.subscribe(QueueDrainer(background, drain_queue), event_types=QUEUE_DRAINER_EVENTS)

    # Slice 10: notifications are derived from committed events (and the SLA sweep).
    notification_signals = NotificationSignals(hub, SchemaRealtimePresenter(), ids)
    notification_writer = NotificationWriter(uow=uow, ids=ids, signals=notification_signals)
    bus.subscribe(NotificationProjector(uow, notification_writer))
    sweep_sla_risk = SweepSlaRisk(uow=uow, clock=clock, writer=notification_writer)

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
                totp=totp,
                box=secret_box,
            ),
            authenticate=AuthenticateSession(uow=uow, tokens=tokens, clock=clock),
            logout=Logout(uow=uow, clock=clock),
            current_staff=GetCurrentStaff(uow=uow),
            list_staff=ListStaff(uow=uow),
            get_availability=GetMyAvailability(uow=uow, clock=clock),
            set_availability=SetMyAvailability(uow=uow, clock=clock),
        ),
        cases=CasesUseCases(
            inbox=GetInbox(uow=uow, clock=clock),
            detail=GetCaseDetail(uow=uow, clock=clock),
            history=GetCaseHistory(uow=uow),
            turns=ListCaseTurns(uow=uow),
            post_analyst_turn=PostAnalystTurn(uow=uow, clock=clock, ids=ids),
            mark_read=MarkCaseRead(uow=uow, clock=clock),
            close=CloseCase(uow=uow, clock=clock, ids=ids),
            customer_conversation=GetCustomerConversation(uow=uow),
            post_customer_turn=PostCustomerTurn(
                uow=uow,
                clock=clock,
                ids=ids,
                sla=FirstResponseSlaPolicy(),
                assign_case=assign_case,
            ),
            past_conversations=ListPastConversations(uow=uow),
            past_conversation=GetPastConversation(uow=uow),
            authorize_subscription=AuthorizeCaseSubscription(uow=uow),
            team_overview=GetTeamOverview(uow=uow, clock=clock),
            queue_overview=GetQueueOverview(uow=uow, clock=clock),
            set_assignee=SetCaseAssignee(uow=uow, clock=clock, ids=ids),
            analyst_home=GetAnalystHome(uow=uow, clock=clock),
            rate_conversation=RateConversation(uow=uow, clock=clock),
            change_priority=ChangeCasePriority(uow=uow, clock=clock),
            language_open_cases=GetLanguageOpenCases(uow=uow, clock=clock),
            escalate=EscalateCase(uow=uow, clock=clock, ids=ids),
            withdraw_escalation=WithdrawEscalation(uow=uow, clock=clock, ids=ids),
            acknowledge_escalation=AcknowledgeEscalation(uow=uow, clock=clock),
            respond_escalation=RespondEscalation(uow=uow, clock=clock, ids=ids),
            take_escalated_case=TakeEscalatedCase(uow=uow, clock=clock, ids=ids),
            escalation_overview=GetEscalationOverview(uow=uow, clock=clock),
        ),
        channels=ChannelsUseCases(
            list_calls=ListCaseCalls(uow=uow, clock=clock),
            start_outbound_call=StartOutboundCall(uow=uow, clock=clock, ids=ids),
            answer_call=AnswerCall(uow=uow, clock=clock),
            hold_call=HoldCall(uow=uow, clock=clock, ids=ids),
            resume_call=ResumeCall(uow=uow, clock=clock, ids=ids),
            set_call_muted=SetCallMuted(uow=uow, clock=clock),
            hang_up_call=HangUpCall(uow=uow, clock=clock, ids=ids),
            post_call_line=PostCallLine(uow=uow, clock=clock, ids=ids),
            add_note=AddInternalNote(uow=uow, clock=clock, ids=ids),
            email_thread=GetEmailThread(uow=uow),
            reply_email=ReplyEmail(uow=uow, clock=clock, ids=ids),
            start_inbound_call=StartInboundCall(
                uow=uow,
                clock=clock,
                ids=ids,
                sla=FirstResponseSlaPolicy(),
                assign_case=assign_case,
            ),
            customer_call=GetCustomerCall(uow=uow),
            answer_outbound_call=AnswerOutboundCall(uow=uow, clock=clock),
            reject_call=EndCustomerCall(uow=uow, clock=clock, ids=ids, reject=True),
            customer_hang_up=EndCustomerCall(uow=uow, clock=clock, ids=ids),
            post_customer_call_line=PostCustomerCallLine(uow=uow, clock=clock, ids=ids),
            send_customer_email=SendCustomerEmail(
                uow=uow,
                clock=clock,
                ids=ids,
                sla=FirstResponseSlaPolicy(),
                assign_case=assign_case,
            ),
            customer_emails=GetCustomerEmails(uow=uow),
        ),
        customers=CustomersUseCases(
            list_demo_customers=ListDemoCustomers(uow=uow),
            start_session=StartCustomerSession(
                uow=uow,
                tokens=customer_tokens,
                clock=clock,
                ids=ids,
                ttl=settings.customer_session_ttl,
            ),
            authenticate=AuthenticateCustomer(uow=uow, tokens=customer_tokens, clock=clock),
        ),
        audit=AuditUseCases(
            list_events=ListAuditEvents(uow=uow),
            get_event=GetAuditEvent(uow=uow),
        ),
        administration=AdministrationUseCases(
            list_users=ListUsers(uow=uow, clock=clock),
            get_user=GetUser(uow=uow, clock=clock),
            create_user=CreateUser(
                uow=uow, clock=clock, ids=ids, tokens=link_tokens, mailer=mailer
            ),
            update_user=UpdateUser(uow=uow, clock=clock),
            deactivate_user=DeactivateUser(uow=uow, clock=clock),
            reactivate_user=ReactivateUser(uow=uow, clock=clock),
            unlock_user=UnlockAccount(uow=uow, clock=clock),
            reset_password=SendPasswordResetLink(
                uow=uow, clock=clock, ids=ids, tokens=link_tokens, mailer=mailer
            ),
            resend_invitation=ResendInvitation(
                uow=uow, clock=clock, tokens=link_tokens, mailer=mailer
            ),
            cancel_invitation=CancelInvitation(uow=uow, clock=clock),
            list_teams=ListTeams(uow=uow),
            get_team=GetTeam(uow=uow, clock=clock),
            create_team=CreateTeam(uow=uow, clock=clock, ids=ids),
            rename_team=RenameTeam(uow=uow, clock=clock),
            deactivate_team=DeactivateTeam(uow=uow, clock=clock),
            reactivate_team=ReactivateTeam(uow=uow, clock=clock),
        ),
        notifications=NotificationsUseCases(
            list_mine=ListMyNotifications(uow=uow, clock=clock),
            mark_read=MarkNotificationRead(uow=uow, clock=clock, signals=notification_signals),
            mark_all_read=MarkAllNotificationsRead(
                uow=uow, clock=clock, signals=notification_signals
            ),
            sweep_sla_risk=sweep_sla_risk,
        ),
        onboarding=OnboardingUseCases(
            check_invitation=CheckInvitation(
                uow=uow, tokens=link_tokens, clock=clock, guard=link_guard
            ),
            set_invitation_password=SetInvitationPassword(
                uow=uow,
                tokens=link_tokens,
                clock=clock,
                guard=link_guard,
                hasher=hasher,
                totp=totp,
                box=secret_box,
            ),
            activate_invitation=ActivateInvitation(
                uow=uow,
                tokens=link_tokens,
                clock=clock,
                guard=link_guard,
                totp=totp,
                box=secret_box,
                lockout=lockout,
            ),
            check_password_reset=CheckPasswordReset(
                uow=uow, tokens=link_tokens, clock=clock, guard=link_guard
            ),
            complete_password_reset=CompletePasswordReset(
                uow=uow, tokens=link_tokens, clock=clock, guard=link_guard, hasher=hasher
            ),
            dev_mailbox=ListDevMailbox(kit.dev_mailbox),
        ),
    )
    sla_sweep = (
        PeriodicTask("sla_sweep", settings.notification_sweep_seconds, sweep_sla_risk.execute)
        if settings.notification_sweep_seconds > 0
        else None
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
        background=background,
        drain_queue=drain_queue,
        one_time_tokens=link_tokens,
        totp=totp,
        secret_box=secret_box,
        mailer=mailer,
        dev_mailbox=kit.dev_mailbox,
        database=database,
        health_probes=tuple(probes),
        sla_sweep=sla_sweep,
    )
