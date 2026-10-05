"""``AgentRegistryClient``: the port to agent-core's registry API (``/v1/registry``, ADR 0003 §7).

The registry is where agents are *built*: a change is a proposal that goes ``draft → candidate →
evaluated → approved → published`` (agent-core ADR 0018). DTOs mirror the shapes agent-core
publishes in ``contracts/registry/*.json`` (snake_case there, Python names here). The adapter is
``infrastructure/ai/http_registry.py``; tests use ``infrastructure/ai/memory_registry.py``.

Every call carries the credential of the *person* acting (a ``builder`` principal minted by the
platform from her session): the registry decides by its own roles, so the platform never lends
authority. Entity ``content`` is opaque JSON here (agents, flows, prompts...): the registry
validates it. Numbers travel as JSON numbers (doubles) or as numeric strings for exact decimals.
"""

from __future__ import annotations

from collections.abc import Sequence
from dataclasses import dataclass
from datetime import datetime
from enum import StrEnum
from typing import Literal, Protocol, get_args

from cc_platform.application.ai.credentials import AgentCredentials
from cc_platform.domain.shared.json import JsonObject, JsonValue

Verdict = Literal["pass", "fail", "failed_infra"]
ReleaseStatus = Literal["active", "revoked"]
#: Why a supervisor rejects a proposal: agent-core's closed vocabulary (``registry/models.py``
#: ``ReasonCode``, PR 53). Optional on a rejection; the free-text reason stays mandatory and is
#: never exposed by the registry.
ReasonCode = Literal[
    "insufficient_evidence",
    "wrong_target",
    "risk",
    "duplicate",
    "policy_conflict",
    "wording",
    "other",
]
REASON_CODES: tuple[ReasonCode, ...] = get_args(ReasonCode)


class ProposalOrigin(StrEnum):
    MANUAL = "manual"
    BUILDER_CHAT = "builder_chat"
    AUTO_DETECT = "auto_detect"
    IMPORT = "import"


class ProposalState(StrEnum):
    DRAFT = "draft"
    CANDIDATE = "candidate"
    EVALUATED = "evaluated"
    APPROVED = "approved"
    PUBLISHED = "published"


@dataclass(frozen=True, slots=True)
class VersionRef:
    kind: str
    id: str
    version: str


@dataclass(frozen=True, slots=True)
class VersionDocs:
    description: str
    rationale: str
    changelog: str


@dataclass(frozen=True, slots=True)
class EntityDraft:
    """One versioned entity of a draft: its ``kind`` (``agent``, ``flow``, ``prompt``...), its
    full ``content`` (it carries its own ``id`` and ``version``) and why it changes."""

    kind: str
    content: JsonObject
    docs: VersionDocs


@dataclass(frozen=True, slots=True)
class Proposal:
    proposal_id: str
    agent_id: str
    origin: ProposalOrigin
    state: ProposalState
    rev: int
    base_release_id: str | None
    title: str
    created_by: str
    candidate_hash: str | None
    updated_at: datetime


@dataclass(frozen=True, slots=True)
class ProposalPage:
    """One page of ``GET /v1/registry/proposals`` (agent-core contract 1.4.0): newest first."""

    items: tuple[Proposal, ...]
    total: int
    """How many proposals match the filters (all pages)."""


#: The most a page of agent-core's proposal list holds (it caps ``limit`` at 200).
MAX_PROPOSAL_PAGE = 200


@dataclass(frozen=True, slots=True)
class Violation:
    """A rule the candidate breaks. Never carries customer data."""

    rule: str
    flow: str | None
    node_id: str | None
    path: str | None
    message: str


@dataclass(frozen=True, slots=True)
class ValidationReport:
    violations: tuple[Violation, ...]
    candidate_hash: str | None
    auto_bumped: tuple[VersionRef, ...]


@dataclass(frozen=True, slots=True)
class CandidateView:
    proposal_id: str
    candidate_hash: str
    release_id_preview: str
    new_versions: tuple[VersionRef, ...]
    auto_bumped: tuple[VersionRef, ...]


@dataclass(frozen=True, slots=True)
class YardstickChange:
    """What a proposal loosens in the yardstick (the approver accepts it apart)."""

    kind: str
    target: str
    message: str


@dataclass(frozen=True, slots=True)
class GateItem:
    """One element of the verdict: a metric, a scenario or a platform guardrail. The numbers are
    exact decimals as text (``None`` = not measured)."""

    metric_id: str
    phase: str
    role: str | None
    value: str | None
    base_value: str | None
    noise_margin: str | None
    floor: str | None
    passed: bool
    reason: str


@dataclass(frozen=True, slots=True)
class EvalReport:
    """What the approver sees. ``runs``, ``results`` and ``judge_notes`` are agent-core's own
    structures, passed through (a screen may show them as a table)."""

    verdict: Verdict
    items: tuple[GateItem, ...]
    yardstick_changes: tuple[YardstickChange, ...]
    detail: str | None
    runs: JsonObject | None = None
    results: tuple[JsonObject, ...] = ()
    judge_notes: tuple[JsonObject, ...] = ()


@dataclass(frozen=True, slots=True)
class EvalRun:
    eval_run_id: str
    proposal_id: str
    candidate_hash: str
    base_release_id: str | None
    suite: VersionRef
    verdict: Verdict
    report: EvalReport
    at: datetime


@dataclass(frozen=True, slots=True)
class ReleaseSettingChange:
    field: str
    before: JsonValue
    after: JsonValue


@dataclass(frozen=True, slots=True)
class ApprovalReview:
    """What the approver reviews, as three separate elements: the functional change, the suite the
    candidate was measured with (and each gate item), and what the yardstick loosens."""

    functional_changes: tuple[EntityDraft, ...]
    release_changes: tuple[ReleaseSettingChange, ...]
    suite: VersionRef
    suite_changes: tuple[EntityDraft, ...]
    gate: tuple[GateItem, ...]
    yardstick_loosened: tuple[YardstickChange, ...]


@dataclass(frozen=True, slots=True)
class LastDecision:
    """The last human decision on a proposal, as agent-core shows it: the closed-vocabulary code,
    never the free-text reason nor who decided (only that an approver did)."""

    decision: Literal["approved", "rejected"]
    reason_code: ReasonCode | None
    decided_at: datetime


@dataclass(frozen=True, slots=True)
class ProposalDetail:
    proposal: Proposal
    changes: tuple[EntityDraft, ...]
    last_eval: EvalRun | None
    review: ApprovalReview | None
    last_decision: LastDecision | None = None
    """Null before any decision, and from an agent-core older than its PR 53."""


@dataclass(frozen=True, slots=True)
class Approval:
    proposal_id: str
    candidate_hash: str
    actor: str
    decision: Literal["approved", "rejected"]
    reason: str | None
    yardstick_loosened: tuple[YardstickChange, ...]
    at: datetime


@dataclass(frozen=True, slots=True)
class EntityRef:
    id: str
    version: str


@dataclass(frozen=True, slots=True)
class EntityInRelease:
    ref: VersionRef
    content_hash: str
    docs: VersionDocs
    changed_vs_base: bool


@dataclass(frozen=True, slots=True)
class ReleaseDetail:
    release_id: str
    status: ReleaseStatus
    agent_id: str
    entities: tuple[EntityInRelease, ...]
    knowledge_snapshot: str | None
    proposal_id: str | None
    base_release_id: str | None
    published_by: str
    published_at: datetime
    eval_suite_refs: tuple[VersionRef, ...]
    interrupts: tuple[JsonObject, ...]
    language_detection: EntityRef
    injection_ruleset: EntityRef | None
    max_input_chars: int


@dataclass(frozen=True, slots=True)
class AliasState:
    agent_id: str
    alias: str
    release_id: str
    status: ReleaseStatus


@dataclass(frozen=True, slots=True)
class AliasChange:
    agent_id: str
    alias: str
    before: str | None
    after: str
    actor: str
    reason: str
    at: datetime


@dataclass(frozen=True, slots=True)
class ChangedRef:
    before: VersionRef
    after: VersionRef
    docs: VersionDocs


@dataclass(frozen=True, slots=True)
class ReleaseDiff:
    a: str
    b: str
    added: tuple[VersionRef, ...]
    removed: tuple[VersionRef, ...]
    changed: tuple[ChangedRef, ...]


@dataclass(frozen=True, slots=True)
class VersionSummary:
    ref: VersionRef
    content_hash: str
    docs: VersionDocs
    created_by: str
    created_at: datetime


@dataclass(frozen=True, slots=True)
class EntityVersion:
    ref: VersionRef
    content: JsonObject
    content_hash: str
    docs: VersionDocs
    created_by: str
    created_at: datetime


class AgentRegistryError(Exception):
    """The registry answered with an error (``application/problem+json``).

    ``code`` is its stable code (``validation_failed``, ``gate_failed``, ``proposal_stale``,
    ``candidate_changed``, ``illegal_transition``, ``forbidden_role``, ``step_up_required``,
    ``not_found``, ``loosening_not_accepted``, ``idempotency_conflict``, ``quota_exceeded``...).
    ``detail`` is its text for people (no customer data) and ``payload`` its structured body
    (violations of a validation, the failed report of a gate, the loosened yardstick).
    """

    def __init__(
        self,
        *,
        status: int,
        code: str,
        detail: str = "",
        payload: JsonValue = None,
        trace_id: str | None = None,
        violations: Sequence[Violation] = (),
        report: EvalReport | None = None,
        eval_run_id: str | None = None,
        yardstick_loosened: Sequence[YardstickChange] = (),
    ) -> None:
        super().__init__(f"agent-core registry answered {status} {code}")
        self.status = status
        self.code = code
        self.detail = detail
        self.payload = payload
        self.trace_id = trace_id
        # The adapter parses the structured bodies it knows: ``validation_failed`` (violations),
        # ``gate_failed`` (the failed report and the run that stored it) and
        # ``loosening_not_accepted`` (what the proposal loosens).
        self.violations = tuple(violations)
        self.report = report
        self.eval_run_id = eval_run_id
        self.yardstick_loosened = tuple(yardstick_loosened)


class AgentRegistryClient(Protocol):
    """Unavailability (timeout, network, a 5xx without a problem body) raises
    ``AgentRuntimeUnavailableError``; a problem answer raises ``AgentRegistryError``."""

    async def create_proposal(
        self,
        credentials: AgentCredentials,
        *,
        agent_id: str,
        title: str,
        origin: ProposalOrigin = ProposalOrigin.MANUAL,
    ) -> Proposal:
        """``POST /v1/registry/proposals``: a new proposal in ``draft`` on the agent's ``staging``
        release as base. Needs ``constructor``."""
        ...

    async def list_proposals(
        self,
        credentials: AgentCredentials,
        *,
        agent_id: str | None = None,
        state: str | None = None,
        limit: int = 50,
        offset: int = 0,
    ) -> ProposalPage:
        """``GET /v1/registry/proposals``: every proposal the registry has, newest first
        (``updated_at``, then id), filtered by agent and state. Any ``builder`` may read it."""
        ...

    async def get_proposal(
        self, credentials: AgentCredentials, *, proposal_id: str
    ) -> ProposalDetail:
        """``GET /v1/registry/proposals/{id}``: the proposal, its draft, the last evaluation and,
        once evaluated, the approver's review."""
        ...

    async def put_draft(
        self,
        credentials: AgentCredentials,
        *,
        proposal_id: str,
        expected_rev: int,
        changes: Sequence[EntityDraft],
    ) -> Proposal:
        """``PUT /v1/registry/proposals/{id}/draft``: replaces the whole draft (``draft`` state
        only; a stale ``expected_rev`` is ``proposal_stale``). Needs ``constructor``."""
        ...

    async def validate(
        self, credentials: AgentCredentials, *, proposal_id: str
    ) -> ValidationReport:
        """``POST .../validate``: builds the candidate and reports its violations (no state)."""
        ...

    async def freeze(self, credentials: AgentCredentials, *, proposal_id: str) -> CandidateView:
        """``POST .../freeze``: ``draft → candidate``, identified by its hash."""
        ...

    async def reopen(self, credentials: AgentCredentials, *, proposal_id: str) -> Proposal:
        """``POST .../reopen``: back to ``draft`` (from candidate, evaluated or approved)."""
        ...

    async def evaluate(
        self,
        credentials: AgentCredentials,
        *,
        proposal_id: str,
        suite_id: str,
        suite_version: str | None = None,
    ) -> EvalReport:
        """``POST .../evaluate``: runs the agent's ``eval_suite`` on the candidate. A failed gate
        is ``AgentRegistryError(code="gate_failed")`` with the report as ``payload``."""
        ...

    async def approve(
        self,
        credentials: AgentCredentials,
        *,
        proposal_id: str,
        candidate_hash: str,
        accept_yardstick_loosened: bool = False,
    ) -> Approval:
        """``POST .../approve``. Needs a human ``aprobador`` at ``step_up``."""
        ...

    async def reject(
        self,
        credentials: AgentCredentials,
        *,
        proposal_id: str,
        reason: str,
        reason_code: ReasonCode | None = None,
    ) -> Proposal:
        """``POST .../reject``: back to ``draft``. Needs a human ``aprobador`` at ``step_up``.
        ``reason_code`` is sent only when given (an older agent-core never sees it)."""
        ...

    async def publish(
        self, credentials: AgentCredentials, *, proposal_id: str, idempotency_key: str
    ) -> ReleaseDetail:
        """``POST .../publish``: a release, ``staging`` now points at it. Idempotent on the key.
        Needs a human ``aprobador`` at ``step_up``."""
        ...

    async def promote(
        self,
        credentials: AgentCredentials,
        *,
        agent_id: str,
        alias: str,
        release_id: str,
        reason: str = "",
    ) -> AliasChange:
        """``POST /v1/registry/aliases/{agent}/{alias}`` (``staging`` or ``prod``). Needs a human
        ``aprobador`` at ``step_up``."""
        ...

    async def revoke(
        self, credentials: AgentCredentials, *, release_id: str, reason: str
    ) -> ReleaseDetail:
        """``POST /v1/registry/releases/{id}/revoke``. Needs a human ``admin`` at ``step_up``."""
        ...

    async def get_alias(
        self, credentials: AgentCredentials, *, agent_id: str, alias: str
    ) -> AliasState:
        """``GET /v1/registry/aliases/{agent}/{alias}`` (404 ``not_found`` if it points nowhere)."""
        ...

    async def get_release(self, credentials: AgentCredentials, *, release_id: str) -> ReleaseDetail:
        """``GET /v1/registry/releases/{id}``."""
        ...

    async def diff_releases(self, credentials: AgentCredentials, *, a: str, b: str) -> ReleaseDiff:
        """``GET /v1/registry/releases/{a}/diff/{b}``."""
        ...

    async def list_versions(
        self, credentials: AgentCredentials, *, kind: str, entity_id: str
    ) -> tuple[VersionSummary, ...]:
        """``GET /v1/registry/versions/{kind}/{id}``: oldest first."""
        ...

    async def get_entity(
        self,
        credentials: AgentCredentials,
        *,
        kind: str,
        entity_id: str,
        version: str | None = None,
    ) -> EntityVersion:
        """``GET /v1/registry/entities/{kind}/{id}`` (latest, or ``?version=``)."""
        ...


#: Operations the registry only lets a human at ``step_up`` do (agent-core ``registry/roles.py``).
STEP_UP_OPERATIONS = frozenset({"approve", "reject", "publish", "promote", "revoke"})
