"""Composition root: the only module that knows concrete adapter classes.

``build_container(settings)`` wires settings → adapters → use cases and subscribes the
event-bus consumers. Tests pass their own clock/id generator to get deterministic output.
"""

from __future__ import annotations

import json
from collections.abc import Awaitable, Callable, Sequence
from dataclasses import dataclass, field

import httpx
import structlog

from cc_platform.api.context import ApiContext, BuildInfo, RealtimeOptions
from cc_platform.api.realtime_presenter import SchemaRealtimePresenter
from cc_platform.application.ai import AgentCredentialIssuer, AgentRuntime
from cc_platform.application.ai.agents import (
    AgentCatalogUseCases,
    GetAgents,
    RenameAgent,
    SetAgentPaused,
)
from cc_platform.application.ai.announce import AnnounceImprovement
from cc_platform.application.ai.builder import AgentBuilder
from cc_platform.application.ai.builder_chat import (
    AskBuilder,
    GetBuilderThread,
    RestartBuilderThread,
)
from cc_platform.application.ai.builder_step_up import BuilderStepUp
from cc_platform.application.ai.config import AssistantConfig, AssistantGate
from cc_platform.application.ai.copilot import AskCopilot, GetCopilotThread
from cc_platform.application.ai.customer import (
    AnswerAssistantConfirmation,
    RequestPerson,
    VerifyAssistantStepUp,
)
from cc_platform.application.ai.engine import AssistantEngine, AssistantHandover
from cc_platform.application.ai.grants import GetGrantStatus
from cc_platform.application.ai.maturity import (
    MATURITY_SIGNAL_EVENTS,
    ActivateTypeAgent,
    GetAiStages,
    MaturityProjector,
    MaturityRealtimeProjector,
    MaturityUseCases,
    MoveStageBack,
    RecordItemDecision,
    RecordToolUsed,
    WhileTypeProposes,
)
from cc_platform.application.ai.priority import ApplyHandoffPriority, HandoffPriorityProcess
from cc_platform.application.ai.process import ASSISTANT_PROCESS_EVENTS, AssistantTurnProcess
from cc_platform.application.ai.registry import AgentRegistryClient
from cc_platform.application.ai.staff import (
    AiOffHandoverProcess,
    GetCaseHandoff,
    LinkBankCustomers,
    RecordHandoffResolution,
    ReleaseAssistantCase,
    ReleaseAssistantCasesOnAiOff,
)
from cc_platform.application.ai.suggestion_process import (
    SUGGESTION_PROCESS_EVENTS,
    SUGGESTION_SIGNAL_EVENTS,
    SuggestionProcess,
    SuggestionSignal,
)
from cc_platform.application.ai.suggestions import (
    DecideSuggestion,
    GetLatestSuggestion,
    LinkSuggestion,
    PurgeSuggestionDrafts,
    RequestSuggestion,
    SuggestionService,
)
from cc_platform.application.ai.sweep import SweepAssistantSessions
from cc_platform.application.ai.use_cases import (
    AssistantUseCases,
    BuilderUseCases,
    SuggestionUseCases,
)
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
from cc_platform.application.cases.case_type import ChangeCaseType
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
from cc_platform.application.cases.evidence import SampleEvidenceCases
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
from cc_platform.application.events import EventRecord
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
from cc_platform.application.people.preferences import GetMyPreferences, SetMyPreferences
from cc_platform.application.people.preferences_realtime import (
    PREFERENCES_EVENTS,
    PreferencesRealtimeProjector,
)
from cc_platform.application.people.queries import GetCurrentStaff, ListStaff
from cc_platform.application.people.use_cases import PeopleUseCases
from cc_platform.application.platform.realtime import PlatformRealtimeProjector
from cc_platform.application.platform.settings import (
    AiSwitch,
    GetPlatformSettings,
    PlatformDefaults,
    SetAiEnabled,
    WhileAiOn,
)
from cc_platform.application.platform.use_cases import PlatformUseCases
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
from cc_platform.domain.ai.events import AssistantEnded
from cc_platform.domain.ai.maturity_events import MATURITY_EVENTS, STAGE_EVENTS
from cc_platform.domain.people.events import SessionEnded, StaffRolesChanged
from cc_platform.domain.people.login_account import LockoutPolicy
from cc_platform.domain.people.mfa import MfaPolicy
from cc_platform.domain.people.staff import Language
from cc_platform.domain.platform.events import PLATFORM_EVENTS, PlatformAiToggled
from cc_platform.infrastructure.ai.ed25519_issuer import Ed25519AgentCredentialIssuer
from cc_platform.infrastructure.ai.http_registry import HttpAgentRegistry
from cc_platform.infrastructure.ai.http_runtime import HttpAgentRuntime
from cc_platform.infrastructure.ai.keys import AgentSigningKeys
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
from cc_platform.infrastructure.persistence.sqlalchemy.database import (
    Database,
    DatabaseProbe,
    PoolOptions,
)
from cc_platform.infrastructure.persistence.sqlalchemy.migrator import ensure_at_head, migrate
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
    #: ADR 0003: ``None`` while ``CC_AGENT_CORE_URL`` is unset (the platform stays people-only).
    agent_core: AgentCoreServices | None = None
    assistant_engine: AssistantEngine | None = None
    assistant_sweep: PeriodicTask | None = None
    #: ADR 0005: purges the drafts older than 24 hours; ``None`` without suggestions.
    suggestion_purge: PeriodicTask | None = None

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
            internal_token=(
                self.settings.internal_service_token.get_secret_value()
                if self.settings.internal_service_token is not None
                else None
            ),
        )

    async def startup(self) -> None:
        if self.database is not None:
            if self.settings.migrate_on_start:
                report = await migrate(self.database)
                if report.changed:
                    _log.info(
                        "database_migrated",
                        before=report.before,
                        after=report.after,
                        adopted=report.adopted,
                    )
            else:
                await ensure_at_head(self.database)
        if self.settings.seed_demo_data:
            await self.seed_demo_data()
        # Slice 4 §2.3: the admin roster exists from the start (idempotent).
        await ensure_admin_roster(self.uow)
        await self._link_bank_customers()
        # No startup drain (contract §3.2): the queue drains when an analyst becomes
        # available (``QueueDrainer``) and, in slice 3, by hand.
        if self.sla_sweep is not None:
            # Slice 10: cases already at risk get their notification now, then every tick.
            await self.use_cases.notifications.sweep_sla_risk.execute()
            self.sla_sweep.start()
        if self.assistant_sweep is not None:
            self.assistant_sweep.start()
        if self.suggestion_purge is not None:
            self.suggestion_purge.start()

    async def _link_bank_customers(self) -> None:
        """ADR 0003: apply the private ``{platform customer id: dataset customer id}`` file."""
        path = self.settings.bank_customer_links_file
        if path is None:
            return
        try:
            raw = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            _log.error("bank_customer_links_unreadable", file=path.name)  # never the contents
            return
        if not isinstance(raw, dict):
            _log.error("bank_customer_links_invalid", file=path.name)
            return
        links = {str(k): str(v) for k, v in raw.items()}
        changed, skipped = await LinkBankCustomers(self.uow).execute(links)
        _log.info("bank_customer_links", changed=changed, skipped=skipped)

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
                stage_rule=self.settings.stage_rule(),
            ),
        }
        # Part 4: the seeded pending invitation's email, now that its link exists.
        for email in onboarding.emails:
            await self.mailer.invitation(
                email.staff, team_name=email.team_name, token=email.token, language=email.language
            )
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
        if self.assistant_sweep is not None:
            await self.assistant_sweep.stop()
        if self.suggestion_purge is not None:
            await self.suggestion_purge.stop()
        await self.background.drain()
        if self.agent_core is not None and self.agent_core.http_client is not None:
            await self.agent_core.http_client.aclose()
        if self.database is not None:
            await self.database.dispose()


@dataclass(frozen=True, slots=True)
class AgentCoreServices:
    """The platform's side of the contract with agent-core (ADR 0003 §1-2)."""

    issuer: AgentCredentialIssuer
    runtime: AgentRuntime
    http_client: httpx.AsyncClient | None = None
    """Closed on shutdown; ``None`` for a test double that owns no connection."""
    registry: AgentRegistryClient | None = None
    """The registry API (slice 16, the agent builder); ``None`` leaves the builder disabled."""


def _agent_core_services(settings: Settings, clock: Clock) -> AgentCoreServices | None:
    if settings.agent_core_url is None or settings.agent_keys_file is None:
        return None
    keys = AgentSigningKeys.from_file(settings.agent_keys_file)
    client = httpx.AsyncClient(
        base_url=settings.agent_core_url, timeout=settings.agent_core_timeout_seconds
    )
    return AgentCoreServices(
        issuer=Ed25519AgentCredentialIssuer(keys, clock),
        runtime=HttpAgentRuntime(client),
        http_client=client,
        registry=HttpAgentRegistry(client),
    )


def _wire_realtime(
    settings: Settings,
    bus: EventBus,
    *,
    uow: UnitOfWorkFactory,
    clock: Clock,
    background: AsyncioBackgroundTasks,
    drain_queue: DrainQueue,
) -> tuple[InMemoryRealtimeHub, TopicMapper]:
    """The hub and every bus subscriber that projects events onto sockets or drains the queue."""
    hub = InMemoryRealtimeHub(queue_size=settings.realtime_queue_size)
    mapper = TopicMapper()
    mapper.suppress(*OWNED_EVENTS)  # the cases projection publishes their envelopes
    mapper.suppress(*SILENT_EVENTS)  # audited reads (case.viewed): never on a socket
    mapper.suppress(*ADMIN_OWNED_EVENTS)  # the administration projection signals them
    mapper.suppress(*PLATFORM_EVENTS)  # the platform projection signals them (slice 18)
    mapper.suppress(*MATURITY_EVENTS)  # the stages projection signals them (slice 21)
    mapper.suppress(*PREFERENCES_EVENTS)  # the preferences projection signals them (slice 23)
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
    bus.subscribe(
        PlatformRealtimeProjector(hub, SchemaRealtimePresenter()), event_types=PLATFORM_EVENTS
    )
    bus.subscribe(MaturityRealtimeProjector(hub), event_types=STAGE_EVENTS)
    bus.subscribe(
        PreferencesRealtimeProjector(hub, SchemaRealtimePresenter()),
        event_types=PREFERENCES_EVENTS,
    )
    return hub, mapper


@dataclass(frozen=True, slots=True)
class _AssistantParts:
    gate: AssistantGate
    engine: AssistantEngine
    resolution: RecordHandoffResolution
    use_cases: AssistantUseCases
    sweep: SweepAssistantSessions


def _build_assistant(
    settings: Settings,
    agent_core: AgentCoreServices,
    *,
    uow: UnitOfWorkFactory,
    clock: Clock,
    ids: IdGenerator,
    bus: EventBus,
    hub: RealtimeHub,
    background: AsyncioBackgroundTasks,
    assign_case: AssignCase,
    step_up: BuilderStepUp,
    ai_switch: AiSwitch,
    notifications: NotificationWriter,
) -> _AssistantParts:
    """Wire the assistant: engine, the bus process that keeps it answering, and the use cases."""
    config = AssistantConfig(
        entry_agent=settings.assistant_agent,
        languages=frozenset(Language(code) for code in settings.assistant_languages),
        step_up_code=settings.assistant_step_up_code,
    )
    handover = AssistantHandover(
        clock=clock, ids=ids, sla=FirstResponseSlaPolicy(), assign_case=assign_case
    )
    engine = AssistantEngine(
        uow=uow,
        clock=clock,
        ids=ids,
        runtime=agent_core.runtime,
        issuer=agent_core.issuer,
        handover=handover,
        config=config,
    )
    bus.subscribe(AssistantTurnProcess(background, engine), event_types=ASSISTANT_PROCESS_EVENTS)
    bus.subscribe(
        HandoffPriorityProcess(
            background,
            ApplyHandoffPriority(
                uow=uow, clock=clock, runtime=agent_core.runtime, issuer=agent_core.issuer
            ),
        ),
        event_types=[AssistantEnded],
    )
    # Slice 19: turning AI off hands the assistant's open conversations to people.
    bus.subscribe(
        AiOffHandoverProcess(
            background, ReleaseAssistantCasesOnAiOff(uow=uow, clock=clock, handover=handover)
        ),
        event_types=[PlatformAiToggled],
    )
    use_cases = AssistantUseCases(
        confirm=AnswerAssistantConfirmation(uow=uow, clock=clock, ids=ids),
        verify_step_up=VerifyAssistantStepUp(
            uow=uow, clock=clock, ids=ids, handover=handover, config=config
        ),
        request_person=RequestPerson(uow=uow, clock=clock, handover=handover),
        handoff=GetCaseHandoff(
            uow=uow, clock=clock, runtime=agent_core.runtime, issuer=agent_core.issuer
        ),
        release=ReleaseAssistantCase(uow=uow, clock=clock, handover=handover),
        copilot_thread=GetCopilotThread(uow=uow, stage_gate=settings.stage_gates_suggestions),
        grant_status=GetGrantStatus(uow=uow),
        ask_copilot=AskCopilot(
            uow=uow,
            clock=clock,
            ids=ids,
            runtime=agent_core.runtime,
            issuer=agent_core.issuer,
            agent=settings.copilot_agent,
            stage_gate=settings.stage_gates_suggestions,
        ),
        builder=_build_builder(
            settings,
            agent_core,
            uow=uow,
            clock=clock,
            ids=ids,
            step_up=step_up,
            notifications=notifications,
        ),
        suggestions=_build_suggestions(settings, agent_core, uow=uow, clock=clock, ids=ids),
    )
    if use_cases.suggestions is not None:  # ADR 0005: automatic suggestions and their signal
        if settings.copilot_suggestions_auto:
            suggestion_process = SuggestionProcess(
                background,
                use_cases.suggestions.service,
                coalesce_seconds=settings.copilot_suggestions_coalesce_seconds,
            )
            bus.subscribe(
                # Slice 18: no automatic suggestion while the AI switch is off; slice 21: nor for
                # a case whose type is below stage 2 (its copilot proposes nothing yet).
                WhileAiOn(ai_switch, _stage_gated(settings, uow, suggestion_process)),
                event_types=SUGGESTION_PROCESS_EVENTS,
            )
        bus.subscribe(SuggestionSignal(hub), event_types=SUGGESTION_SIGNAL_EVENTS)
    return _AssistantParts(
        gate=AssistantGate(config, switch=ai_switch),
        engine=engine,
        resolution=RecordHandoffResolution(
            uow=uow, clock=clock, runtime=agent_core.runtime, issuer=agent_core.issuer
        ),
        use_cases=use_cases,
        sweep=SweepAssistantSessions(uow=uow, clock=clock, tasks=background, engine=engine),
    )


def _stage_gated(
    settings: Settings, uow: UnitOfWorkFactory, subscriber: Callable[[EventRecord], Awaitable[None]]
) -> Callable[[EventRecord], Awaitable[None]]:
    """Slice 21: the automatic suggestions only for a case whose type proposes (stage 2+)."""
    return WhileTypeProposes(uow, subscriber) if settings.stage_gates_suggestions else subscriber


def _build_suggestions(
    settings: Settings,
    agent_core: AgentCoreServices,
    *,
    uow: UnitOfWorkFactory,
    clock: Clock,
    ids: IdGenerator,
) -> SuggestionUseCases | None:
    """ADR 0005: the copilot's suggestions exist when a suggestions agent is configured."""
    if settings.copilot_suggestions_agent is None:
        return None
    service = SuggestionService(
        uow=uow,
        clock=clock,
        ids=ids,
        runtime=agent_core.runtime,
        issuer=agent_core.issuer,
        agent=settings.copilot_suggestions_agent,
        stage_gate=settings.stage_gates_suggestions,
    )
    return SuggestionUseCases(
        service=service,
        request=RequestSuggestion(service=service, uow=uow),
        latest=GetLatestSuggestion(
            uow=uow, clock=clock, stage_gate=settings.stage_gates_suggestions
        ),
        decide=DecideSuggestion(uow=uow, clock=clock),
        link=LinkSuggestion(uow=uow, clock=clock),
        purge=PurgeSuggestionDrafts(uow=uow, clock=clock),
    )


def _build_builder(
    settings: Settings,
    agent_core: AgentCoreServices,
    *,
    uow: UnitOfWorkFactory,
    clock: Clock,
    ids: IdGenerator,
    step_up: BuilderStepUp,
    notifications: NotificationWriter,
) -> BuilderUseCases | None:
    """Slice 16: the agent builder exists when agent-core's registry is wired."""
    if agent_core.registry is None:
        return None
    registry = AgentBuilder(
        uow=uow,
        clock=clock,
        registry=agent_core.registry,
        issuer=agent_core.issuer,
        step_up=step_up,
    )
    return BuilderUseCases(
        registry=registry,
        thread=GetBuilderThread(uow=uow),
        ask=AskBuilder(
            uow=uow,
            clock=clock,
            ids=ids,
            runtime=agent_core.runtime,
            registry=agent_core.registry,
            issuer=agent_core.issuer,
            builder=registry,
            agent=settings.builder_agent,
        ),
        restart=RestartBuilderThread(
            uow=uow,
            clock=clock,
            ids=ids,
            runtime=agent_core.runtime,
            issuer=agent_core.issuer,
            agent=settings.builder_agent,
        ),
        announce=AnnounceImprovement(uow=uow, clock=clock, builder=registry, writer=notifications),
    )


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
    agent_core: AgentCoreServices | None = None,
) -> Container:
    """``agent_core`` is a seam for tests (a fake runtime); otherwise it is built from the
    settings (``CC_AGENT_CORE_URL``), or absent when they leave it unset."""
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
        database = Database(
            settings.database_url,
            echo=settings.database_echo,
            pool=PoolOptions(
                size=settings.database_pool_size,
                max_overflow=settings.database_max_overflow,
                timeout_seconds=settings.database_pool_timeout_seconds,
            ),
        )
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

    hub, mapper = _wire_realtime(
        settings, bus, uow=uow, clock=clock, background=background, drain_queue=drain_queue
    )

    # Slice 10: notifications are derived from committed events (and the SLA sweep).
    notification_signals = NotificationSignals(hub, SchemaRealtimePresenter(), ids)
    notification_writer = NotificationWriter(uow=uow, ids=ids, signals=notification_signals)
    bus.subscribe(NotificationProjector(uow, notification_writer))
    sweep_sla_risk = SweepSlaRisk(uow=uow, clock=clock, writer=notification_writer)

    lockout = LockoutPolicy(
        max_failed_attempts=settings.lockout_max_attempts,
        lock_duration=settings.lockout_duration,
    )

    # ADR 0003: the assistant (agent-core). It exists only when agent-core is configured.
    agent_core = agent_core or _agent_core_services(settings, clock)
    # Slice 18 (ADR 0006): the AI switch, asked by every AI entry point.
    platform_defaults = PlatformDefaults(
        ai_enabled=settings.ai_enabled, agent_core_configured=agent_core is not None
    )
    ai_switch = AiSwitch(uow=uow, defaults=platform_defaults)
    # Slice 21 (ADR 0006): each case type's signals and the team rule that moves its stage.
    stage_rule = settings.stage_rule()
    bus.subscribe(
        WhileAiOn(ai_switch, MaturityProjector(uow=uow, rule=stage_rule)),
        event_types=MATURITY_SIGNAL_EVENTS,
    )
    assistant = (
        None
        if agent_core is None
        else _build_assistant(
            settings,
            agent_core,
            uow=uow,
            clock=clock,
            ids=ids,
            bus=bus,
            hub=hub,
            background=background,
            assign_case=assign_case,
            step_up=BuilderStepUp(
                uow=uow,
                clock=clock,
                lockout=lockout,
                totp=totp,
                box=secret_box,
                dev_verifier=mfa_verifier,
            ),
            ai_switch=ai_switch,
            notifications=notification_writer,
        )
    )
    assistant_gate = assistant.gate if assistant else None
    assistant_use_cases = assistant.use_cases if assistant else None
    assistant_engine = assistant.engine if assistant else None
    handoff_resolution = assistant.resolution if assistant else None
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
            get_preferences=GetMyPreferences(uow=uow),
            set_preferences=SetMyPreferences(uow=uow, clock=clock),
        ),
        cases=CasesUseCases(
            inbox=GetInbox(uow=uow, clock=clock),
            detail=GetCaseDetail(uow=uow, clock=clock),
            history=GetCaseHistory(uow=uow),
            turns=ListCaseTurns(uow=uow),
            post_analyst_turn=PostAnalystTurn(uow=uow, clock=clock, ids=ids),
            mark_read=MarkCaseRead(uow=uow, clock=clock),
            close=CloseCase(
                uow=uow, clock=clock, ids=ids, tasks=background, resolution=handoff_resolution
            ),
            customer_conversation=GetCustomerConversation(uow=uow),
            post_customer_turn=PostCustomerTurn(
                uow=uow,
                clock=clock,
                ids=ids,
                sla=FirstResponseSlaPolicy(),
                assign_case=assign_case,
                assistant=assistant_gate,
            ),
            past_conversations=ListPastConversations(uow=uow),
            past_conversation=GetPastConversation(uow=uow),
            authorize_subscription=AuthorizeCaseSubscription(uow=uow),
            team_overview=GetTeamOverview(uow=uow, clock=clock),
            queue_overview=GetQueueOverview(uow=uow, clock=clock),
            set_assignee=SetCaseAssignee(uow=uow, clock=clock, ids=ids),
            analyst_home=GetAnalystHome(uow=uow, clock=clock, switch=ai_switch),
            rate_conversation=RateConversation(uow=uow, clock=clock),
            change_priority=ChangeCasePriority(uow=uow, clock=clock),
            change_type=ChangeCaseType(uow=uow, clock=clock),
            language_open_cases=GetLanguageOpenCases(uow=uow, clock=clock),
            escalate=EscalateCase(uow=uow, clock=clock, ids=ids),
            withdraw_escalation=WithdrawEscalation(uow=uow, clock=clock, ids=ids),
            acknowledge_escalation=AcknowledgeEscalation(uow=uow, clock=clock),
            respond_escalation=RespondEscalation(uow=uow, clock=clock, ids=ids),
            take_escalated_case=TakeEscalatedCase(uow=uow, clock=clock, ids=ids),
            escalation_overview=GetEscalationOverview(uow=uow, clock=clock),
            sample_evidence=SampleEvidenceCases(uow=uow, min_cell=settings.evidence_min_cell),
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
        platform=PlatformUseCases(
            settings=GetPlatformSettings(uow=uow, defaults=platform_defaults),
            set_ai_enabled=SetAiEnabled(uow=uow, clock=clock, defaults=platform_defaults),
            ai_switch=ai_switch,
        ),
        maturity=MaturityUseCases(
            stages=GetAiStages(uow=uow, switch=ai_switch, rule=stage_rule),
            move_back=MoveStageBack(uow=uow, clock=clock, switch=ai_switch),
            tool_used=RecordToolUsed(uow=uow, clock=clock, switch=ai_switch),
            item_decided=RecordItemDecision(uow=uow, clock=clock, switch=ai_switch),
            activate_agent=ActivateTypeAgent(
                uow=uow,
                clock=clock,
                switch=ai_switch,
                builder=(
                    assistant_use_cases.builder.registry
                    if assistant_use_cases is not None and assistant_use_cases.builder is not None
                    else None
                ),
            ),
        ),
        agent_catalog=AgentCatalogUseCases(
            agents=GetAgents(uow=uow, switch=ai_switch),
            rename=RenameAgent(uow=uow, clock=clock, switch=ai_switch),
            pause=SetAgentPaused(
                uow=uow,
                clock=clock,
                switch=ai_switch,
                builder=(
                    assistant_use_cases.builder.registry
                    if assistant_use_cases is not None and assistant_use_cases.builder is not None
                    else None
                ),
            ),
        ),
        assistant=assistant_use_cases,
    )
    assistant_sweep = (
        PeriodicTask("assistant_sweep", settings.assistant_sweep_seconds, assistant.sweep.execute)
        if assistant is not None and settings.assistant_sweep_seconds > 0
        else None
    )
    suggestions = assistant_use_cases.suggestions if assistant_use_cases is not None else None
    suggestion_purge = (
        PeriodicTask(
            "suggestion_purge",
            settings.copilot_suggestions_purge_seconds,
            suggestions.purge.execute,
        )
        if suggestions is not None and settings.copilot_suggestions_purge_seconds > 0
        else None
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
        agent_core=agent_core,
        assistant_engine=assistant_engine,
        assistant_sweep=assistant_sweep,
        suggestion_purge=suggestion_purge,
    )
