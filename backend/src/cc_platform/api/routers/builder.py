"""The agent builder for supervisors (ADR 0003 §7, slice 16): proposals to change an agent, their
evaluation, approval and publication, releases and aliases, and the chat with the builder agent.

Supervisión and Administración only; ``404 assistant_disabled`` while agent-core is not
configured or the AI switch is off (slice 18). The platform is a client of agent-core's
registry: every call carries the credential of the person acting, and the registry decides by
its own roles. Approving, rejecting, publishing, promoting and revoking ask for a fresh
authenticator code (``stepUpCode``) in the same request.
Registry refusals are mapped to ``registry_*`` problem codes (``registryCode`` carries the
registry's own).
"""

from __future__ import annotations

from typing import Annotated, cast

from fastapi import APIRouter, Depends, Header, Path, Query, Response, status
from fastapi.exceptions import RequestValidationError

from cc_platform.api.dependencies import ApiContextDep, require_roles
from cc_platform.api.routers._assistant import ai_is_on, builder_use_cases
from cc_platform.api.schemas import builder as schemas
from cc_platform.api.schemas.common import problem_responses
from cc_platform.application.ai.registry import EntityDraft, ProposalState, VersionDocs
from cc_platform.application.security import Actor
from cc_platform.domain.people.staff import StaffRole

router = APIRouter(prefix="/builder", tags=["builder"])

Builder = Annotated[Actor, Depends(require_roles(StaffRole.SUPERVISOR, StaffRole.ADMIN))]
Admin = Annotated[Actor, Depends(require_roles(StaffRole.ADMIN))]
ProposalId = Annotated[str, Path(alias="proposalId", min_length=1, max_length=120)]
AgentId = Annotated[str, Path(alias="agentId", min_length=1, max_length=120)]
Alias = Annotated[str, Path(min_length=1, max_length=40, examples=["staging", "prod"])]
ReleaseId = Annotated[str, Path(alias="releaseId", min_length=1, max_length=120)]
Kind = Annotated[str, Path(min_length=1, max_length=60, examples=["agent", "flow", "prompt"])]
EntityPath = Annotated[str, Path(alias="entityId", min_length=1, max_length=200)]

IDEMPOTENCY_KEY = "Idempotency-Key"
PublishKey = Annotated[
    str,
    Header(
        alias=IDEMPOTENCY_KEY,
        min_length=8,
        max_length=64,
        description="One key per publication the caller means to make: a retry with it returns "
        "the same release (the registry de-duplicates it).",
    ),
]
STEP_UP_NOTE = (
    "Needs a fresh authenticator code (`stepUpCode`): a wrong one is 422 `builder_step_up_invalid` "
    "(`remainingAttempts`; it counts toward the account lock, 423 `account_locked`)."
)
REGISTRY_ERRORS = problem_responses(401, 403, 404, 409, 422, 429, 502, 503)


def _drafts(items: list[schemas.EntityDraftRequest]) -> list[EntityDraft]:
    return [
        EntityDraft(
            kind=i.kind,
            content=i.content,
            docs=VersionDocs(
                description=i.docs.description,
                rationale=i.docs.rationale,
                changelog=i.docs.changelog,
            ),
        )
        for i in items
    ]


# ----------------------------------------------------------------------------- status
@router.get(
    "/status",
    response_model=schemas.BuilderStatus,
    summary="Whether the agent builder is available, and what the caller may do",
    description=(
        "Slice 16. Always 200 for Supervisión and Administración: `available: false` while "
        "agent-core is not configured or the AI switch is off (slice 18; hide the section; "
        "every other route is 404 `assistant_disabled`). `canApprove` / `canRevoke` say which "
        "controls to show; `stepUpMethod` and `stepUpDigits` describe the code the sensitive "
        "calls ask for. `reachable: false` (deploy brief P4) while agent-core is configured but "
        "down: the calls that need it answer 503 `agent_core_unavailable` at once."
    ),
    responses=problem_responses(401, 403),
)
async def get_status(actor: Builder, api: ApiContextDep) -> schemas.BuilderStatus:
    assistant = api.use_cases.assistant
    if assistant is None or assistant.builder is None or not await ai_is_on(api):
        return schemas.BuilderStatus.unavailable()
    view = assistant.builder.registry.status(actor)
    return schemas.BuilderStatus.from_view(view, reachable=await api.core_status() == "ok")


# ----------------------------------------------------------------------------- proposals
@router.get(
    "/proposals",
    response_model=schemas.ProposalList,
    summary="The proposals to change agents, newest first",
    description=(
        "Every proposal agent-core has (its `GET /v1/registry/proposals`), merged with the "
        "platform's index, which says who brought each one here (`source`: `platform`, `chat`, "
        "`tracked`, `engine`); a proposal only agent-core has is `source: registry`. With "
        "`refresh` (default) the registry is read and `live` is true; if agent-core's list does "
        "not answer, the index alone is returned (`registryListed: false`), each row re-read by "
        "id, and a row the registry did not answer for keeps its cached state (`live: false`). "
        "`refresh=false` returns the cached index. Newest first, at most 50."
    ),
    responses=problem_responses(401, 403, 404),
)
async def list_proposals(  # noqa: PLR0917 - a filter per query parameter
    actor: Builder,
    api: ApiContextDep,
    agent_id: Annotated[str | None, Query(alias="agentId", max_length=120)] = None,
    state: Annotated[
        ProposalState | None, Query(description="Filter by the proposal state.")
    ] = None,
    limit: Annotated[int, Query(ge=1, le=50)] = 50,
    refresh: Annotated[
        bool, Query(description="Read the registry (its list, or each row by id).")
    ] = True,
) -> schemas.ProposalList:
    listing = await (await builder_use_cases(api)).registry.list_proposals(
        actor,
        agent_id=agent_id,
        state=state.value if state else None,
        limit=limit,
        refresh=refresh,
    )
    return schemas.ProposalList(
        items=[schemas.ProposalSummary.model_validate(i) for i in listing.items],
        registry_listed=listing.registry_listed,
    )


@router.post(
    "/proposals",
    response_model=schemas.Proposal,
    status_code=status.HTTP_201_CREATED,
    summary="Start a proposal to change an agent",
    description=(
        "Creates a proposal in `draft`, based on the agent's `staging` release. The next steps "
        "are `PUT .../draft`, `validate`, `freeze`, `evaluate`, then a person approves and "
        "publishes."
    ),
    responses=REGISTRY_ERRORS,
)
async def create_proposal(
    body: schemas.CreateProposalRequest, actor: Builder, api: ApiContextDep
) -> schemas.Proposal:
    proposal = await (await builder_use_cases(api)).registry.create_proposal(
        actor, agent_id=body.agent_id, title=body.title
    )
    return schemas.Proposal.model_validate(proposal)


@router.post(
    "/proposals/track",
    response_model=schemas.ProposalSummary,
    summary="Bring a proposal agent-core already has into the list",
    description=(
        "For a proposal made outside this screen (the builder chat's answer names the id, or "
        "someone made it by hand). Idempotent. 404 `registry_not_found` if the registry does not "
        "know it."
    ),
    responses=REGISTRY_ERRORS,
)
async def track_proposal(
    body: schemas.TrackProposalRequest, actor: Builder, api: ApiContextDep
) -> schemas.ProposalSummary:
    summary = await (await builder_use_cases(api)).registry.track_proposal(actor, body.proposal_id)
    return schemas.ProposalSummary.model_validate(summary)


@router.get(
    "/proposals/{proposalId}",
    response_model=schemas.ProposalDetail,
    summary="One proposal: its draft, the last evaluation and the approver's review",
    responses=REGISTRY_ERRORS,
)
async def get_proposal(
    proposal_id: ProposalId, actor: Builder, api: ApiContextDep
) -> schemas.ProposalDetail:
    detail = await (await builder_use_cases(api)).registry.get_proposal(actor, proposal_id)
    return schemas.ProposalDetail.model_validate(detail)


@router.get(
    "/proposals/{proposalId}/record",
    response_model=schemas.ProposalRecord,
    summary="The engine's dossier and the history of the decisions on a proposal",
    description=(
        "What the platform keeps about a proposal, without calling agent-core: the improvement "
        "engine's dossier (ADR 0007) with each evidence case resolved (`available: false` when "
        "the id names no case here), and the history from the platform's audit (evaluated, "
        "approved, rejected with its `reasonCode`, published, promoted to `staging` / `prod`). "
        "An id nobody announced or acted on answers an empty record."
    ),
    responses=problem_responses(401, 403, 404),
)
async def get_proposal_record(
    proposal_id: ProposalId, actor: Builder, api: ApiContextDep
) -> schemas.ProposalRecord:
    record = await (await builder_use_cases(api)).record.execute(actor, proposal_id)
    return schemas.ProposalRecord.model_validate(record)


@router.put(
    "/proposals/{proposalId}/draft",
    response_model=schemas.Proposal,
    summary="Write the draft: the entities this proposal changes",
    description=(
        "Replaces the whole draft (only while the proposal is in `draft`). `expectedRev` must be "
        "the proposal's current `rev` (409 `registry_conflict`, `registryCode: proposal_stale`). "
        "Each change is a full entity (`kind`, `content` with its own `id` and `version`, `docs`). "
        "agent-core checks its limits and refuses edits to the platform's guardrails (403 "
        "`registry_forbidden`)."
    ),
    responses=REGISTRY_ERRORS,
)
async def save_draft(
    proposal_id: ProposalId, body: schemas.SaveDraftRequest, actor: Builder, api: ApiContextDep
) -> schemas.Proposal:
    proposal = await (await builder_use_cases(api)).registry.save_draft(
        actor, proposal_id, expected_rev=body.expected_rev, changes=_drafts(body.changes)
    )
    return schemas.Proposal.model_validate(proposal)


@router.post(
    "/proposals/{proposalId}/validate",
    response_model=schemas.ValidationReport,
    summary="Check the draft: the violations, or the candidate hash",
    description="Always 200: `violations` empty means the draft can be frozen. Changes nothing.",
    responses=REGISTRY_ERRORS,
)
async def validate_proposal(
    proposal_id: ProposalId, actor: Builder, api: ApiContextDep
) -> schemas.ValidationReport:
    report = await (await builder_use_cases(api)).registry.validate(actor, proposal_id)
    return schemas.ValidationReport.model_validate(report)


@router.post(
    "/proposals/{proposalId}/freeze",
    response_model=schemas.CandidateView,
    summary="Freeze the draft into a candidate (`draft` → `candidate`)",
    description=(
        "The candidate is identified by its hash; evaluation and approval bind to it, and any "
        "edit makes another one. 422 `registry_validation_failed` (with `violations`) if the "
        "draft is not valid."
    ),
    responses=REGISTRY_ERRORS,
)
async def freeze_proposal(
    proposal_id: ProposalId, actor: Builder, api: ApiContextDep
) -> schemas.CandidateView:
    candidate = await (await builder_use_cases(api)).registry.freeze(actor, proposal_id)
    return schemas.CandidateView.model_validate(candidate)


@router.post(
    "/proposals/{proposalId}/reopen",
    response_model=schemas.Proposal,
    summary="Back to `draft` to edit (from `candidate`, `evaluated` or `approved`)",
    responses=REGISTRY_ERRORS,
)
async def reopen_proposal(
    proposal_id: ProposalId, actor: Builder, api: ApiContextDep
) -> schemas.Proposal:
    proposal = await (await builder_use_cases(api)).registry.reopen(actor, proposal_id)
    return schemas.Proposal.model_validate(proposal)


@router.post(
    "/proposals/{proposalId}/evaluate",
    response_model=schemas.EvalReport,
    summary="Run the agent's evaluation suite on the candidate (`candidate` → `evaluated`)",
    description=(
        "Waits for the evaluation (it runs the real agent: seconds to minutes). `200` with the "
        "report: the verdict is `pass` (the proposal is `evaluated`) or `failed_infra`. A failed "
        "gate is `409 registry_gate_failed` with the `report` (the proposal went back to `draft`). "
        "An agent without an `eval_suite` cannot be evaluated: 404 `registry_not_found` or 422 "
        "`registry_validation_failed`, and so it cannot be approved or published."
    ),
    responses=REGISTRY_ERRORS,
)
async def evaluate_proposal(
    proposal_id: ProposalId, body: schemas.EvaluateRequest, actor: Builder, api: ApiContextDep
) -> schemas.EvalReport:
    report = await (await builder_use_cases(api)).registry.evaluate(
        actor, proposal_id, suite_id=body.suite_id, suite_version=body.suite_version
    )
    return schemas.EvalReport.model_validate(report)


@router.post(
    "/proposals/{proposalId}/approve",
    response_model=schemas.Approval,
    summary="Approve the evaluated candidate (`evaluated` → `approved`)",
    description=(
        f"A person's decision, never the builder agent's. {STEP_UP_NOTE} `candidateHash` must be "
        "the proposal's current one (409 `registry_conflict`, `candidate_changed`). A proposal "
        "that loosens the yardstick needs `acceptYardstickLoosened` (409 "
        "`registry_loosening_not_accepted` lists what it loosens)."
    ),
    responses=REGISTRY_ERRORS,
)
async def approve_proposal(
    proposal_id: ProposalId, body: schemas.ApproveRequest, actor: Builder, api: ApiContextDep
) -> schemas.Approval:
    approval = await (await builder_use_cases(api)).registry.approve(
        actor,
        proposal_id,
        candidate_hash=body.candidate_hash,
        accept_yardstick_loosened=body.accept_yardstick_loosened,
        step_up_code=body.step_up_code,
    )
    return schemas.Approval.model_validate(approval)


@router.post(
    "/proposals/{proposalId}/reject",
    response_model=schemas.Proposal,
    summary="Reject the evaluated candidate: back to `draft`",
    description=(
        "The reason is kept by the registry; `reasonCode` (agent-core's closed list) also goes "
        f"to the registry and into the audit. {STEP_UP_NOTE}"
    ),
    responses=REGISTRY_ERRORS,
)
async def reject_proposal(
    proposal_id: ProposalId, body: schemas.RejectRequest, actor: Builder, api: ApiContextDep
) -> schemas.Proposal:
    proposal = await (await builder_use_cases(api)).registry.reject(
        actor,
        proposal_id,
        reason=body.reason,
        step_up_code=body.step_up_code,
        reason_code=body.reason_code,
    )
    return schemas.Proposal.model_validate(proposal)


@router.post(
    "/proposals/{proposalId}/publish",
    response_model=schemas.ReleaseDetail,
    status_code=status.HTTP_201_CREATED,
    summary="Publish the approved candidate as a release (`approved` → `published`)",
    description=(
        f"`staging` now points at the release; promoting to `prod` is a separate step. "
        f"{STEP_UP_NOTE} Idempotent on `Idempotency-Key`. If `staging` moved since the proposal "
        "was made it goes back to `draft` (409 `registry_conflict`, `proposal_stale`): freeze and "
        "evaluate again."
    ),
    responses=REGISTRY_ERRORS,
)
async def publish_proposal(
    proposal_id: ProposalId,
    body: schemas.PublishRequest,
    idempotency_key: PublishKey,
    actor: Builder,
    api: ApiContextDep,
) -> schemas.ReleaseDetail:
    release = await (await builder_use_cases(api)).registry.publish(
        actor, proposal_id, idempotency_key=idempotency_key, step_up_code=body.step_up_code
    )
    return schemas.ReleaseDetail.model_validate(release)


# ----------------------------------------------------------------------------- aliases and releases
@router.get(
    "/aliases/{agentId}/{alias}",
    response_model=schemas.AliasState,
    summary="Which release an alias (`staging`, `prod`) points to",
    description="404 `registry_not_found` when the alias points nowhere.",
    responses=REGISTRY_ERRORS,
)
async def get_alias(
    agent_id: AgentId, alias: Alias, actor: Builder, api: ApiContextDep
) -> schemas.AliasState:
    state = await (await builder_use_cases(api)).registry.get_alias(actor, agent_id, alias)
    return schemas.AliasState.model_validate(state)


@router.post(
    "/aliases/{agentId}/{alias}/promote",
    response_model=schemas.AliasChange,
    summary="Point an alias (`staging` or `prod`) at a release",
    description=f"Promoting to `prod` is what customers feel. {STEP_UP_NOTE}",
    responses=REGISTRY_ERRORS,
)
async def promote_alias(
    agent_id: AgentId,
    alias: Alias,
    body: schemas.PromoteRequest,
    actor: Builder,
    api: ApiContextDep,
) -> schemas.AliasChange:
    change = await (await builder_use_cases(api)).registry.promote(
        actor,
        agent_id,
        alias,
        release_id=body.release_id,
        reason=body.reason,
        step_up_code=body.step_up_code,
    )
    return schemas.AliasChange.model_validate(change)


@router.get(
    "/releases/{releaseId}",
    response_model=schemas.ReleaseDetail,
    summary="A release: the exact versions it holds",
    responses=REGISTRY_ERRORS,
)
async def get_release(
    release_id: ReleaseId, actor: Builder, api: ApiContextDep
) -> schemas.ReleaseDetail:
    release = await (await builder_use_cases(api)).registry.get_release(actor, release_id)
    return schemas.ReleaseDetail.model_validate(release)


@router.get(
    "/releases/{a}/diff/{b}",
    response_model=schemas.ReleaseDiff,
    summary="What changed between two releases",
    responses=REGISTRY_ERRORS,
)
async def diff_releases(a: str, b: str, actor: Builder, api: ApiContextDep) -> schemas.ReleaseDiff:
    diff = await (await builder_use_cases(api)).registry.diff_releases(actor, a, b)
    return schemas.ReleaseDiff.model_validate(diff)


@router.post(
    "/releases/{releaseId}/revoke",
    response_model=schemas.ReleaseDetail,
    summary="Withdraw a release at once (Administración)",
    description=(
        f"No gate. Refused while `prod` points at the release (409 `registry_conflict`: promote "
        f"another first). {STEP_UP_NOTE}"
    ),
    responses=REGISTRY_ERRORS,
)
async def revoke_release(
    release_id: ReleaseId, body: schemas.RevokeRequest, actor: Admin, api: ApiContextDep
) -> schemas.ReleaseDetail:
    release = await (await builder_use_cases(api)).registry.revoke(
        actor, release_id, reason=body.reason, step_up_code=body.step_up_code
    )
    return schemas.ReleaseDetail.model_validate(release)


# ----------------------------------------------------------------------------- entities
@router.get(
    "/versions/{kind}/{entityId:path}",
    response_model=schemas.VersionList,
    summary="The versions of an entity, oldest first",
    description="`entityId` may contain `/` (`t/saludo`).",
    responses=REGISTRY_ERRORS,
)
async def list_versions(
    kind: Kind, entity_id: EntityPath, actor: Builder, api: ApiContextDep
) -> schemas.VersionList:
    items = await (await builder_use_cases(api)).registry.list_versions(actor, kind, entity_id)
    return schemas.VersionList(items=[schemas.VersionSummary.model_validate(i) for i in items])


@router.get(
    "/entities/{kind}/{entityId:path}",
    response_model=schemas.EntityVersion,
    summary="An entity version with its full content",
    description="The latest version, or `?version=X.Y.Z`. `entityId` may contain `/`.",
    responses=REGISTRY_ERRORS,
)
async def get_entity(
    kind: Kind,
    entity_id: EntityPath,
    actor: Builder,
    api: ApiContextDep,
    version: Annotated[str | None, Query(max_length=40)] = None,
) -> schemas.EntityVersion:
    entity = await (await builder_use_cases(api)).registry.get_entity(
        actor, kind, entity_id, version
    )
    return schemas.EntityVersion.model_validate(entity)


# ----------------------------------------------------------------------------- chat
@router.get(
    "/chat",
    response_model=schemas.BuilderThread,
    summary="The caller's conversation with the builder agent",
    description=(
        "One thread per person. `available: false` (no messages, status 200) while agent-core is "
        "not configured or the AI switch is off (slice 18): hide the chat."
    ),
    responses=problem_responses(401, 403),
)
async def get_chat(actor: Builder, api: ApiContextDep) -> schemas.BuilderThread:
    assistant = api.use_cases.assistant
    if assistant is None or assistant.builder is None or not await ai_is_on(api):
        return schemas.BuilderThread(available=False, messages=[], awaiting=None)
    view = await assistant.builder.thread.execute(actor)
    return schemas.BuilderThread(
        available=True,
        messages=[schemas.BuilderMessage.model_validate(m) for m in view.messages],
        awaiting=None,
    )


@router.post(
    "/chat/restart",
    response_model=schemas.BuilderThread,
    summary="Start a new conversation with the builder agent",
    description=(
        'Slice 22, "Nueva conversación": the caller\'s thread starts over (the transcript stays in '
        "agent-core) and a new run of the builder agent starts at once, in her UI language, "
        "whatever state the current one is in: the thread comes back with the run's opening "
        "(`constructor-chat` first asks which agent) and `awaiting`. If agent-core does not "
        "answer, the thread comes back empty and her next message starts the run. Proposals "
        "already made stay in the list. Each call starts over. AI off or no agent-core: 404 "
        "`assistant_disabled`."
    ),
    responses=problem_responses(401, 403, 404),
)
async def restart_chat(actor: Builder, api: ApiContextDep) -> schemas.BuilderThread:
    view = await (await builder_use_cases(api)).restart.execute(actor)
    return schemas.BuilderThread(
        available=True,
        messages=[schemas.BuilderMessage.model_validate(m) for m in view.messages],
        awaiting=cast("schemas.BuilderAwaiting | None", view.awaiting),
    )


@router.post(
    "/chat/messages",
    response_model=schemas.BuilderExchange,
    status_code=status.HTTP_201_CREATED,
    summary="Tell the builder agent what to change",
    description=(
        "The agent (`constructor-chat`) asks which agent, then what to change; it then reads the "
        "current version, drafts the change, creates a proposal, writes the draft and validates "
        "it, in the caller's UI language (es or pt-BR). `awaiting: slot` says it asked for the "
        "next datum. A message that starts a run (none yet, or the last one ended) answers the "
        "run's opening question: the answer carries that question first. It only proposes: "
        "freezing, evaluating, "
        "approving and publishing are the screens' steps, and approving and publishing are a "
        "person's. The call waits for the model (seconds): show a spinner. Idempotent on "
        "`clientMessageId` (= `Idempotency-Key`), like the analyst's copilot: a retry with the "
        "same text answers 200 with `Idempotent-Replayed: true`, and repeats the call only if the "
        "first one got no answer. Proposals the answer mentions are tracked and returned in "
        "`proposals`. 409 `builder_busy` while it answers a previous message; 503 "
        "`agent_core_unavailable` / 502 `agent_core_rejected` when it does not answer (the message "
        "stays in the thread: send it again with the same `clientMessageId`)."
    ),
    responses={
        200: {
            "description": "Replay of a message already answered",
            "model": schemas.BuilderExchange,
        },
        **problem_responses(401, 403, 404, 409, 422, 502, 503),
    },
)
async def ask_builder(
    *,
    body: schemas.AskBuilderRequest,
    idempotency_key: Annotated[
        str,
        Header(
            alias=IDEMPOTENCY_KEY,
            min_length=8,
            max_length=64,
            description="Must equal the body `clientMessageId`; a retry with it is a replay.",
        ),
    ],
    actor: Builder,
    api: ApiContextDep,
    response: Response,
) -> schemas.BuilderExchange:
    if idempotency_key != body.client_message_id:
        raise RequestValidationError(
            [
                {
                    "loc": ("header", IDEMPOTENCY_KEY),
                    "msg": "Idempotency-Key must equal clientMessageId",
                    "type": "value_error",
                }
            ]
        )
    exchange = await (await builder_use_cases(api)).ask.execute(
        actor, text=body.text, client_message_id=body.client_message_id
    )
    if exchange.replayed:
        response.status_code = status.HTTP_200_OK
        response.headers["Idempotent-Replayed"] = "true"
    return schemas.BuilderExchange(
        message=schemas.BuilderMessage.model_validate(exchange.message),
        answers=[schemas.BuilderMessage.model_validate(m) for m in exchange.answers],
        proposals=[schemas.ProposalSummary.model_validate(p) for p in exchange.proposals],
        replayed=exchange.replayed,
        awaiting=cast("schemas.BuilderAwaiting | None", exchange.awaiting),
    )
