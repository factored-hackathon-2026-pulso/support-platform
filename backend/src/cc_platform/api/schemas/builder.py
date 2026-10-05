"""Agent builder schemas (ADR 0003 §7, slice 16): proposals, evaluation, releases and the chat with
the builder agent.

Response models mirror agent-core's published registry models (``contracts/registry``) in
camelCase; ``content`` of an entity, and the structures of an evaluation that are keyed by
metric or scenario ids, are agent-core's own JSON and pass through untouched (their keys are data,
not field names, so they keep agent-core's snake_case). Every response member is present
(``T | null`` where it may be empty).
"""

from __future__ import annotations

from datetime import datetime
from typing import Annotated, Any, Literal

from pydantic import ConfigDict, Field, StringConstraints

from cc_platform.api.schemas.cases import ClientMessageId
from cc_platform.api.schemas.common import ApiModel, RequestModel
from cc_platform.application.ai.builder import BuilderStatus as BuilderStatusView
from cc_platform.application.ai.registry import ProposalOrigin, ProposalState

StepUpCode = Annotated[
    str,
    StringConstraints(strip_whitespace=True, min_length=4, max_length=12),
    Field(
        description="A fresh code from the person's authenticator app (6 digits). Asked again on "
        "every call that needs it: the platform raises that one call to the registry's `step_up`."
    ),
]
EntityId = Annotated[str, StringConstraints(min_length=1, max_length=120)]
Verdict = Literal["pass", "fail", "failed_infra"]
ReleaseStatus = Literal["active", "revoked"]


class ViewModel(ApiModel):
    """A response built from an application dataclass (same field names)."""

    model_config = ConfigDict(from_attributes=True)


# ----------------------------------------------------------------------------- status
class BuilderStatus(ViewModel):
    available: bool = Field(
        description="False while agent-core is not configured: hide the agent builder."
    )
    can_approve: bool = Field(description="Approve, reject, publish and promote (needs step-up).")
    can_revoke: bool = Field(description="Revoke a release (Administración; needs step-up).")
    step_up_method: Literal["authenticator"] | None = Field(
        description="How the second factor is asked: a code from the authenticator app."
    )
    step_up_digits: int | None = Field(description="How many digits the code has.")
    reachable: bool = Field(
        default=True,
        description=(
            "Deploy brief P4: false while agent-core is configured but down (its circuit breaker "
            "is open or it does not answer its health check): show that the agents service is "
            "not available; the screens that only read the platform keep working."
        ),
    )

    @classmethod
    def from_view(cls, view: BuilderStatusView, *, reachable: bool = True) -> BuilderStatus:
        return cls(
            reachable=reachable,
            available=True,
            can_approve=view.can_approve,
            can_revoke=view.can_revoke,
            step_up_method="authenticator",
            step_up_digits=view.step_up_digits,
        )

    @classmethod
    def unavailable(cls) -> BuilderStatus:
        return cls(
            available=False,
            can_approve=False,
            can_revoke=False,
            step_up_method=None,
            step_up_digits=None,
        )


# --------------------------------------------------------------------------- shared registry shapes
class VersionRef(ViewModel):
    kind: str
    id: str
    version: str


class VersionDocs(ViewModel):
    description: str
    rationale: str = Field(description="Why this entity changes.")
    changelog: str


class EntityDraft(ViewModel):
    kind: str = Field(description="`agent`, `flow`, `prompt`, `tool`... or `release_settings`.")
    content: dict[str, Any] = Field(
        description="The entity as agent-core defines it (it carries its own `id` and `version`)."
    )
    docs: VersionDocs


class Violation(ViewModel):
    rule: str = Field(description="agent-core's rule id (G0-05, REG-PROPOSAL...).")
    flow: str | None
    node_id: str | None
    path: str | None
    message: str


class YardstickChange(ViewModel):
    kind: str = Field(description="metric_removed, floor_loosened, noise_widened...")
    target: str
    message: str


class GateItem(ViewModel):
    metric_id: str
    phase: str = Field(description="base_yardstick, new_yardstick or platform.")
    role: str | None
    value: str | None = Field(description="Exact decimal as text; null = not measured.")
    base_value: str | None
    noise_margin: str | None
    floor: str | None
    passed: bool
    reason: str


class EvalReport(ViewModel):
    verdict: Verdict
    items: list[GateItem] = Field(description="Each gate item apart: there is no composite score.")
    yardstick_changes: list[YardstickChange]
    detail: str | None
    runs: dict[str, Any] | None = Field(
        description="agent-core's measurements per run (`base_on_old`, `cand_on_old`, "
        "`cand_on_new`), passed through."
    )
    results: list[dict[str, Any]] = Field(
        description="Result of each scenario run, passed through."
    )
    judge_notes: list[dict[str, Any]] = Field(
        description="Informative notes, never in the verdict."
    )


class EvalRun(ViewModel):
    eval_run_id: str
    proposal_id: str
    candidate_hash: str
    base_release_id: str | None
    suite: VersionRef
    verdict: Verdict
    report: EvalReport
    at: datetime


class ReleaseSettingChange(ViewModel):
    field: str
    before: Any
    after: Any


class ApprovalReview(ViewModel):
    """What the approver reviews, as three separate elements."""

    functional_changes: list[EntityDraft]
    release_changes: list[ReleaseSettingChange]
    suite: VersionRef
    suite_changes: list[EntityDraft]
    gate: list[GateItem]
    yardstick_loosened: list[YardstickChange]


# ----------------------------------------------------------------------------- proposals
class Proposal(ViewModel):
    proposal_id: str
    agent_id: str
    origin: ProposalOrigin
    state: ProposalState
    rev: int = Field(description="The draft revision: send it back as `expectedRev` to save.")
    base_release_id: str | None
    title: str
    created_by: str = Field(description="A staff id, or the builder agent's service identity.")
    candidate_hash: str | None = Field(description="Set from `candidate` on.")
    updated_at: datetime


class ProposalSummary(ViewModel):
    proposal_id: str
    agent_id: str
    title: str
    origin: ProposalOrigin
    state: ProposalState
    rev: int
    base_release_id: str | None
    candidate_hash: str | None
    created_by: str
    registered_by: str | None = Field(
        description="Who brought it into the platform's index: a staff id, or `engine` (ADR "
        "0007). Null for a `registry` row (only agent-core's list has it)."
    )
    source: Literal["platform", "chat", "tracked", "engine", "registry"] = Field(
        description="Who brought it here: created on this platform, found through the builder "
        "chat's answer, tracked by id, announced by the improvement engine, or `registry`: only "
        "agent-core's list has it (the builder chat made it and its answer did not name it, or "
        "someone created it in agent-core directly)."
    )
    updated_at: datetime
    refreshed_at: datetime = Field(description="When the platform last read it from the registry.")
    live: bool = Field(
        description="True when `state` was just read from the registry; false when it is the "
        "cached value (the registry did not answer for this row)."
    )


class ProposalList(ViewModel):
    items: list[ProposalSummary]
    registry_listed: bool = Field(
        description="True when `items` include every proposal agent-core has (its list call "
        "answered). False when they are only the platform's index: agent-core's list did not "
        "answer (show a quiet notice) or `refresh` was false."
    )


class ProposalDetail(ViewModel):
    proposal: Proposal
    changes: list[EntityDraft] = Field(description="The draft: what the proposal changes.")
    last_eval: EvalRun | None = Field(
        description="The evaluation of the current candidate (null before one, and after a "
        "failed gate: the proposal is back in draft; that report came with the 409)."
    )
    review: ApprovalReview | None = Field(description="Present once there is an evaluation.")


class ValidationReport(ViewModel):
    violations: list[Violation]
    candidate_hash: str | None = Field(description="Null while there are violations.")
    auto_bumped: list[VersionRef]


class CandidateView(ViewModel):
    proposal_id: str
    candidate_hash: str = Field(description="Send it to approve: the approval binds to it.")
    release_id_preview: str
    new_versions: list[VersionRef]
    auto_bumped: list[VersionRef]


class Approval(ViewModel):
    proposal_id: str
    candidate_hash: str
    actor: str
    decision: Literal["approved", "rejected"]
    reason: str | None
    yardstick_loosened: list[YardstickChange]
    at: datetime


class EntityRef(ViewModel):
    id: str
    version: str


class EntityInRelease(ViewModel):
    ref: VersionRef
    content_hash: str
    docs: VersionDocs
    changed_vs_base: bool


class ReleaseDetail(ViewModel):
    release_id: str
    status: ReleaseStatus
    agent_id: str
    entities: list[EntityInRelease]
    knowledge_snapshot: str | None
    proposal_id: str | None
    base_release_id: str | None
    published_by: str
    published_at: datetime
    eval_suite_refs: list[VersionRef]
    interrupts: list[dict[str, Any]] = Field(description="agent-core's interrupts, passed through.")
    language_detection: EntityRef
    injection_ruleset: EntityRef | None
    max_input_chars: int


class AliasState(ViewModel):
    agent_id: str
    alias: str
    release_id: str
    status: ReleaseStatus


class AliasChange(ViewModel):
    agent_id: str
    alias: str
    before: str | None
    after: str
    actor: str
    reason: str
    at: datetime


class ChangedRef(ViewModel):
    before: VersionRef
    after: VersionRef
    docs: VersionDocs


class ReleaseDiff(ViewModel):
    a: str
    b: str
    added: list[VersionRef]
    removed: list[VersionRef]
    changed: list[ChangedRef]


class VersionSummary(ViewModel):
    ref: VersionRef
    content_hash: str
    docs: VersionDocs
    created_by: str
    created_at: datetime


class VersionList(ViewModel):
    items: list[VersionSummary] = Field(description="Oldest first.")


class EntityVersion(ViewModel):
    ref: VersionRef
    content: dict[str, Any]
    content_hash: str
    docs: VersionDocs
    created_by: str
    created_at: datetime


# ----------------------------------------------------------------------------- requests
class VersionDocsRequest(RequestModel):
    description: Annotated[str, StringConstraints(min_length=1, max_length=4000)]
    rationale: Annotated[str, StringConstraints(max_length=4000)]
    changelog: Annotated[str, StringConstraints(max_length=8000)]


class EntityDraftRequest(RequestModel):
    kind: Annotated[str, StringConstraints(min_length=1, max_length=60)]
    content: dict[str, Any]
    docs: VersionDocsRequest


class CreateProposalRequest(RequestModel):
    agent_id: Annotated[
        str, StringConstraints(pattern=r"^[a-z0-9][a-z0-9_/-]*$", max_length=120)
    ] = Field(description="The agent to change (agent-core's id).")
    title: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=200)]


class TrackProposalRequest(RequestModel):
    proposal_id: EntityId


class SaveDraftRequest(RequestModel):
    expected_rev: int = Field(ge=0, description="The `rev` the caller saw (stale = 409).")
    changes: list[EntityDraftRequest] = Field(
        max_length=100, description="The whole draft: it replaces the previous one."
    )


class EvaluateRequest(RequestModel):
    suite_id: EntityId
    suite_version: Annotated[str | None, StringConstraints(max_length=40)] = None


class ApproveRequest(RequestModel):
    candidate_hash: EntityId = Field(description="From `CandidateView` / the proposal.")
    accept_yardstick_loosened: bool = Field(
        default=False,
        description="Required when the proposal loosens the evaluation yardstick (409 "
        "`registry_loosening_not_accepted` lists what).",
    )
    step_up_code: StepUpCode


class RejectRequest(RequestModel):
    reason: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=2000)]
    step_up_code: StepUpCode


class PublishRequest(RequestModel):
    step_up_code: StepUpCode


class PromoteRequest(RequestModel):
    release_id: EntityId
    reason: Annotated[str, StringConstraints(strip_whitespace=True, max_length=500)] = ""
    step_up_code: StepUpCode


class RevokeRequest(RequestModel):
    reason: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=2000)]
    step_up_code: StepUpCode


# ----------------------------------------------------------------------------- chat
class BuilderMessage(ViewModel):
    id: str
    role: Literal["person", "agent"]
    text: str
    created_at: datetime
    answers: str | None = Field(
        description="On an agent message: the `id` of the person's message it answers."
    )


BuilderAwaiting = Literal["none", "slot", "confirmation", "step_up", "input"]


class BuilderThread(ViewModel):
    available: bool = Field(description="False while agent-core is not configured.")
    messages: list[BuilderMessage] = Field(description="Oldest first (the newest 200).")
    awaiting: BuilderAwaiting | None = Field(
        description="Only on `POST /builder/chat/restart`: what the new run waits for after its "
        "opening (`slot`: it asked for a datum, e.g. which agent). Null on a read, or when the "
        "run could not start (the next message starts it).",
    )


class AskBuilderRequest(RequestModel):
    text: Annotated[str, Field(min_length=1, max_length=2000)]
    client_message_id: ClientMessageId


class BuilderExchange(ViewModel):
    message: BuilderMessage
    answers: list[BuilderMessage] = Field(
        description="What the builder answered (one or more messages); empty if it said nothing."
    )
    proposals: list[ProposalSummary] = Field(
        description="Proposals the answer mentions that the registry confirmed, now in the list."
    )
    replayed: bool = Field(description="A retry of a message that was already answered.")
    awaiting: BuilderAwaiting | None = Field(
        description="What the builder waits for after this answer (agent-core's `awaiting`): "
        "`slot` when it asked for a datum (the next message answers it), `none` when it finished "
        "or handed over. Null on a replay."
    )
