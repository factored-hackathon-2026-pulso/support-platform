"""The agent builder for supervisors (ADR 0003 §7, slice 16): a client of agent-core's registry.

Building an agent is proposing a change to versioned data: a **proposal** goes ``draft →
candidate → evaluated → approved → published`` (agent-core ADR 0018). This module is the
platform's side of it, and it holds three rules:

1. **The person acts, not the platform.** Every registry call carries a ``builder`` credential
   minted from *her* session: Supervisión is ``constructor`` + ``aprobador``, Administración adds
   ``admin``, always as a human. The registry decides by its own roles; the builder agent
   (``constructor-chat``) lends nobody anything.
2. **Approving, rejecting, publishing, promoting and revoking need a fresh second factor** (the
   registry's ``step_up``): the request carries ``stepUpCode``, verified against her authenticator
   (``BuilderStepUp``) right before the call; the credential is raised to ``step_up`` for that call
   only.
3. **Every operation is audited** (``builder.*`` events: ids, states and counters, never a draft's
   content, a reason or a prompt) in the platform's event log, never on a socket.

The proposals list merges agent-core's own list (``GET /v1/registry/proposals``, contract 1.4.0)
with the platform's index (``BuilderProposal``): the index remembers who brought a proposal here
(``source``) and the last state it saw; the registry stays the source of truth and every read
refreshes the cached state. A proposal only agent-core knows (the builder chat's, which belong to
its service identity) is listed with ``source="registry"``.
"""

from __future__ import annotations

import asyncio
from collections.abc import Awaitable, Callable, Sequence
from dataclasses import dataclass, replace
from datetime import datetime

from cc_platform.application.ai.builder_step_up import BUILDER_ROLES, BuilderStepUp
from cc_platform.application.ai.credentials import (
    AgentCredentialIssuer,
    AgentCredentials,
    BuilderIdentity,
)
from cc_platform.application.ai.errors import (
    AgentCoreUnavailableError,
    translate_registry_error,
)
from cc_platform.application.ai.registry import (
    AgentRegistryClient,
    AgentRegistryError,
    AliasChange,
    AliasState,
    Approval,
    CandidateView,
    EntityDraft,
    EntityVersion,
    EvalReport,
    Proposal,
    ProposalDetail,
    ProposalOrigin,
    ProposalPage,
    ReleaseDetail,
    ReleaseDiff,
    ValidationReport,
    VersionSummary,
)
from cc_platform.application.ai.runtime import AgentRuntimeUnavailableError
from cc_platform.application.concurrency import retry_on_conflict
from cc_platform.application.errors import ForbiddenError
from cc_platform.application.ports.clock import Clock
from cc_platform.application.ports.unit_of_work import UnitOfWorkFactory
from cc_platform.application.security import Actor, ensure_any_role
from cc_platform.domain.ai.builder import ENGINE_REGISTRANT, BuilderProposal, ProposalSource
from cc_platform.domain.ai.events import (
    BuilderAliasPromoted,
    BuilderDraftSaved,
    BuilderProposalApproved,
    BuilderProposalCreated,
    BuilderProposalEvaluated,
    BuilderProposalFrozen,
    BuilderProposalPublished,
    BuilderProposalRejected,
    BuilderProposalReopened,
    BuilderProposalTracked,
    BuilderProposalValidated,
    BuilderReleaseRevoked,
)
from cc_platform.domain.people.staff import StaffRole
from cc_platform.domain.shared.actor import ActorRef, ActorRole
from cc_platform.domain.shared.errors import InvalidValueError, NotFoundError
from cc_platform.domain.shared.events import DomainEvent

#: How many proposals the list refreshes against the registry at once.
MAX_LIST = 50
_REASON_MAX = 2000

#: What the second factor asks of the person: a code from her authenticator app.
STEP_UP_METHOD = "authenticator"
STEP_UP_DIGITS = 6


@dataclass(frozen=True, slots=True)
class BuilderStatus:
    """What the caller may do here; the screens show or hide their controls from it."""

    can_approve: bool
    can_revoke: bool
    step_up_method: str
    step_up_digits: int


@dataclass(frozen=True, slots=True)
class ProposalSummary:
    """One row of the proposals list: the registry's last word, as the platform remembers it."""

    proposal_id: str
    agent_id: str
    title: str
    origin: str
    state: str
    rev: int
    base_release_id: str | None
    candidate_hash: str | None
    created_by: str
    registered_by: str | None
    """Who brought it into the platform's index (a staff id or ``engine``); None for a proposal
    only agent-core's list has."""
    source: str
    """``platform``, ``chat``, ``tracked`` or ``engine`` (the index); ``registry`` when only
    agent-core's list has it."""
    updated_at: datetime
    refreshed_at: datetime
    live: bool
    """True when ``state`` was just read from the registry; False when it is the cached value
    (the registry did not answer for this one)."""


#: ``source`` of a proposal that only agent-core's list has (not in the platform's index).
REGISTRY_SOURCE = "registry"


@dataclass(frozen=True, slots=True)
class ProposalListing:
    """``GET /builder/proposals``: the rows, and whether agent-core's own list was read."""

    items: tuple[ProposalSummary, ...]
    registry_listed: bool
    """True when the rows include every proposal agent-core has (its list answered); False when
    they are only the platform's index (the list did not answer, or ``refresh`` was off)."""


PROOF_SCRATCH_PREFIX = "[improvement-engine] [proof-scratch]"
"""The improvement engine proves a patch on throwaway evaluation drafts it titles with this prefix
(they carry ``kind: proof_scratch`` in their change docs). They are evidence, never a deliverable,
so the list leaves them out; they stay readable by id."""


def _is_proof_scratch(title: str) -> bool:
    return title.startswith(PROOF_SCRATCH_PREFIX)


def summary_of(entry: BuilderProposal, *, live: bool) -> ProposalSummary:
    return ProposalSummary(
        proposal_id=entry.id,
        agent_id=entry.agent_id,
        title=entry.title,
        origin=entry.origin,
        state=entry.state,
        rev=entry.rev,
        base_release_id=entry.base_release_id,
        candidate_hash=entry.candidate_hash,
        created_by=entry.created_by,
        registered_by=entry.registered_by,
        source=entry.source,
        updated_at=entry.updated_at,
        refreshed_at=entry.refreshed_at,
        live=live,
    )


def _listed(proposal: Proposal, *, at: datetime) -> ProposalSummary:
    """A row for a proposal only agent-core's list has."""
    return ProposalSummary(
        proposal_id=proposal.proposal_id,
        agent_id=proposal.agent_id,
        title=proposal.title,
        origin=proposal.origin.value,
        state=proposal.state.value,
        rev=proposal.rev,
        base_release_id=proposal.base_release_id,
        candidate_hash=proposal.candidate_hash,
        created_by=proposal.created_by,
        registered_by=None,
        source=REGISTRY_SOURCE,
        updated_at=proposal.updated_at,
        refreshed_at=at,
        live=True,
    )


def identity_of(actor: Actor, *, step_up: bool = False) -> BuilderIdentity:
    """The registry principal a person is: Supervisión builds and approves; Administración adds
    ``admin``. Derived from her roles in the directory, never from a request."""
    return BuilderIdentity(
        staff_id=actor.staff_id,
        constructor=True,
        approver=True,
        admin=StaffRole.ADMIN in actor.roles,
        step_up=step_up,
    )


async def guarded[T](call: Awaitable[T]) -> T:
    """Run a registry call translating its failures to the platform's errors."""
    try:
        return await call
    except AgentRuntimeUnavailableError:
        raise AgentCoreUnavailableError() from None
    except AgentRegistryError as error:
        raise translate_registry_error(error) from None


def _add_to_index(
    proposal: Proposal, *, registered_by: str, source: ProposalSource, at: datetime
) -> BuilderProposal:
    return BuilderProposal(
        id=proposal.proposal_id,
        agent_id=proposal.agent_id,
        title=proposal.title,
        origin=proposal.origin.value,
        created_by=proposal.created_by,
        registered_by=registered_by,
        source=source,
        state=proposal.state.value,
        rev=proposal.rev,
        base_release_id=proposal.base_release_id,
        candidate_hash=proposal.candidate_hash,
        created_at=at,
        updated_at=proposal.updated_at,
        refreshed_at=at,
    )


def _observe(entry: BuilderProposal, proposal: Proposal, at: datetime) -> bool:
    return entry.observe(
        title=proposal.title,
        state=proposal.state.value,
        rev=proposal.rev,
        base_release_id=proposal.base_release_id,
        candidate_hash=proposal.candidate_hash,
        updated_at=proposal.updated_at,
        at=at,
    )


@dataclass(frozen=True, slots=True)
class AgentBuilder:
    uow: UnitOfWorkFactory
    clock: Clock
    registry: AgentRegistryClient
    issuer: AgentCredentialIssuer
    step_up: BuilderStepUp

    # ------------------------------------------------------------------ plumbing
    @staticmethod
    def _ensure(actor: Actor) -> None:
        ensure_any_role(actor, BUILDER_ROLES)

    def _credentials(self, actor: Actor, *, step_up: bool = False) -> AgentCredentials:
        return self.issuer.builder(identity_of(actor, step_up=step_up))

    async def _step_up_credentials(self, actor: Actor, code: str) -> AgentCredentials:
        """Verify the fresh second factor, then mint the credential that carries it."""
        await self.step_up.verify(actor, code)
        return self._credentials(actor, step_up=True)

    async def _settle(
        self,
        actor: Actor | None,
        credentials: AgentCredentials,
        proposal_id: str,
        events: Callable[[str], Sequence[DomainEvent]],
        *,
        proposal: Proposal | None = None,
        source: ProposalSource = "tracked",
    ) -> Proposal | None:
        """After an operation succeeded: remember the registry's current word about the proposal
        and record the audit events (``events`` gets the agent id). The call already happened, so
        a registry that does not answer now only costs a stale cache, never the audit."""
        if proposal is None:
            try:
                proposal = (
                    await self.registry.get_proposal(credentials, proposal_id=proposal_id)
                ).proposal
            except (AgentRuntimeUnavailableError, AgentRegistryError):
                proposal = None

        registered_by = actor.staff_id if actor is not None else ENGINE_REGISTRANT

        async def attempt() -> None:
            async with self.uow() as uow:
                now = self.clock.now()
                entry = await uow.builder_proposals.get(proposal_id)
                if proposal is not None:
                    if entry is None:
                        entry = _add_to_index(
                            proposal, registered_by=registered_by, source=source, at=now
                        )
                        await uow.builder_proposals.add(entry)
                    elif _observe(entry, proposal, now):
                        await uow.builder_proposals.save(entry)
                agent_id = (
                    proposal.agent_id if proposal is not None else (entry.agent_id if entry else "")
                )
                uow.record(*events(agent_id))
                await uow.commit()

        await retry_on_conflict(attempt)
        return proposal

    @staticmethod
    def _ref(actor: Actor) -> ActorRef:
        return actor.acting_as(BUILDER_ROLES)

    # ------------------------------------------------------------------ status and reads
    def status(self, actor: Actor) -> BuilderStatus:
        self._ensure(actor)
        return BuilderStatus(
            can_approve=True,
            can_revoke=StaffRole.ADMIN in actor.roles,
            step_up_method=STEP_UP_METHOD,
            step_up_digits=STEP_UP_DIGITS,
        )

    async def list_proposals(
        self,
        actor: Actor,
        *,
        agent_id: str | None = None,
        state: str | None = None,
        limit: int = MAX_LIST,
        refresh: bool = True,
    ) -> ProposalListing:
        """Every proposal, newest first: agent-core's list merged with the platform's index.

        With ``refresh`` the registry is read: its list (one call) gives every proposal and the
        current state of the indexed ones; a proposal only agent-core has is a ``registry`` row.
        If the list does not answer, the index alone is shown, each row re-read by id as before
        (one that does not answer keeps its cached row, ``live`` false) and ``registry_listed``
        is False. Without ``refresh`` the cached index, untouched."""
        self._ensure(actor)
        size = max(1, min(limit, MAX_LIST))
        async with self.uow() as uow:
            entries = await uow.builder_proposals.search(agent_id=agent_id, state=state, limit=size)
        entries = [e for e in entries if not _is_proof_scratch(e.title)]
        if not refresh:
            return ProposalListing(
                items=tuple(summary_of(e, live=False) for e in entries), registry_listed=False
            )
        credentials = self._credentials(actor)
        page = await self._registry_page(credentials, agent_id=agent_id, state=state, size=size)
        fresh = {p.proposal_id: p for p in page.items} if page is not None else {}
        if page is None:
            missing = list(entries)
        elif page.total > len(page.items):
            # a full page: an indexed proposal it lacks is older than every row, or gone
            missing = []
        else:
            # the whole list: an indexed proposal it lacks changed state, or the registry lost it
            missing = [e for e in entries if e.id not in fresh]
        fetched = await asyncio.gather(
            *(self.registry.get_proposal(credentials, proposal_id=e.id) for e in missing),
            return_exceptions=True,
        )
        by_id = {
            e.id: f.proposal
            for e, f in zip(missing, fetched, strict=True)
            if isinstance(f, ProposalDetail)
        }
        known = await self._refresh({**fresh, **by_id})
        now = self.clock.now()
        rows = [
            replace(summary_of(known[pid], live=True), refreshed_at=now)
            if pid in known
            else _listed(proposal, at=now)
            for pid, proposal in {**fresh, **by_id}.items()
            if state is None or proposal.state.value == state
        ]
        rows.extend(summary_of(e, live=False) for e in missing if e.id not in by_id)
        rows = [row for row in rows if not _is_proof_scratch(row.title)]
        rows.sort(key=lambda row: (row.updated_at, row.proposal_id), reverse=True)
        return ProposalListing(items=tuple(rows[:size]), registry_listed=page is not None)

    async def _registry_page(
        self, credentials: AgentCredentials, *, agent_id: str | None, state: str | None, size: int
    ) -> ProposalPage | None:
        """agent-core's list, or None when it does not answer (an outage, an older agent-core
        without the call, a refusal): the caller falls back to the index."""
        try:
            return await self.registry.list_proposals(
                credentials, agent_id=agent_id, state=state, limit=size
            )
        except (AgentRuntimeUnavailableError, AgentRegistryError):
            return None

    async def _refresh(self, fresh: dict[str, Proposal]) -> dict[str, BuilderProposal]:
        """Remember what the registry says about the indexed proposals among ``fresh``; returns
        those index entries (refreshed). The others are not in the index."""
        known: dict[str, BuilderProposal] = {}
        if not fresh:
            return known

        async def attempt() -> None:
            known.clear()
            async with self.uow() as uow:
                now = self.clock.now()
                changed = False
                for proposal_id, proposal in fresh.items():
                    entry = await uow.builder_proposals.get(proposal_id)
                    if entry is None:
                        continue
                    if _observe(entry, proposal, now):
                        await uow.builder_proposals.save(entry)
                        changed = True
                    known[proposal_id] = entry
                if changed:
                    await uow.commit()

        await retry_on_conflict(attempt)
        return known

    async def get_proposal(self, actor: Actor, proposal_id: str) -> ProposalDetail:
        """The proposal with its draft, the last evaluation and (once evaluated) the approver's
        review, from the registry; a proposal the platform already indexes is refreshed."""
        self._ensure(actor)
        detail = await guarded(
            self.registry.get_proposal(self._credentials(actor), proposal_id=proposal_id)
        )
        await self._refresh({proposal_id: detail.proposal})
        return detail

    async def get_alias(self, actor: Actor, agent_id: str, alias: str) -> AliasState:
        self._ensure(actor)
        return await guarded(
            self.registry.get_alias(self._credentials(actor), agent_id=agent_id, alias=alias)
        )

    async def get_release(self, actor: Actor, release_id: str) -> ReleaseDetail:
        self._ensure(actor)
        return await guarded(
            self.registry.get_release(self._credentials(actor), release_id=release_id)
        )

    async def diff_releases(self, actor: Actor, a: str, b: str) -> ReleaseDiff:
        self._ensure(actor)
        return await guarded(self.registry.diff_releases(self._credentials(actor), a=a, b=b))

    async def list_versions(
        self, actor: Actor, kind: str, entity_id: str
    ) -> tuple[VersionSummary, ...]:
        self._ensure(actor)
        return await guarded(
            self.registry.list_versions(self._credentials(actor), kind=kind, entity_id=entity_id)
        )

    async def get_entity(
        self, actor: Actor, kind: str, entity_id: str, version: str | None
    ) -> EntityVersion:
        self._ensure(actor)
        return await guarded(
            self.registry.get_entity(
                self._credentials(actor), kind=kind, entity_id=entity_id, version=version
            )
        )

    # ------------------------------------------------------------------ building (constructor)
    async def create_proposal(self, actor: Actor, *, agent_id: str, title: str) -> Proposal:
        self._ensure(actor)
        credentials = self._credentials(actor)
        proposal = await guarded(
            self.registry.create_proposal(
                credentials, agent_id=agent_id, title=title.strip(), origin=ProposalOrigin.MANUAL
            )
        )
        ref = self._ref(actor)
        now = self.clock.now()
        await self._settle(
            actor,
            credentials,
            proposal.proposal_id,
            lambda agent: [
                BuilderProposalCreated(
                    occurred_at=now,
                    actor=ref,
                    entity_id=proposal.proposal_id,
                    agent_id=agent,
                    origin=proposal.origin.value,
                    base_release_id=proposal.base_release_id,
                )
            ],
            proposal=proposal,
            source="platform",
        )
        return proposal

    async def track_proposal(self, actor: Actor, proposal_id: str) -> ProposalSummary:
        """Bring a proposal agent-core already has (the builder chat made it, or a person did
        directly) into the platform's list. Idempotent: tracking it again just refreshes it."""
        self._ensure(actor)
        credentials = self._credentials(actor)
        detail = await guarded(self.registry.get_proposal(credentials, proposal_id=proposal_id))
        return await self.adopt(actor, credentials, detail.proposal, source="tracked")

    async def announce_proposal(self, proposal_id: str) -> ProposalSummary:
        """ADR 0007: adopt a proposal the improvement engine made (``origin=auto_detect``) into the
        list, without a human session. Read-only towards the registry (a ``constructor`` read, never
        an approver); it approves and publishes nothing. Idempotent like ``track_proposal``."""
        credentials = self.issuer.builder(
            BuilderIdentity(staff_id=ENGINE_REGISTRANT, constructor=True)
        )
        detail = await guarded(self.registry.get_proposal(credentials, proposal_id=proposal_id))
        if detail.proposal.origin is not ProposalOrigin.AUTO_DETECT:
            raise InvalidValueError(
                "only a proposal the improvement engine detected can be announced",
                field="proposal_id",
            )
        return await self._adopt(
            None,
            ActorRef(role=ActorRole.SYSTEM, actor_id=ENGINE_REGISTRANT),
            credentials,
            detail.proposal,
            source="engine",
        )

    async def adopt(
        self,
        actor: Actor,
        credentials: AgentCredentials,
        proposal: Proposal,
        *,
        source: ProposalSource,
    ) -> ProposalSummary:
        """Add a proposal the registry confirmed to the list (the audit records it once) or refresh
        the one already there. Used by ``track_proposal`` and by the builder chat."""
        return await self._adopt(actor, self._ref(actor), credentials, proposal, source=source)

    async def _adopt(
        self,
        actor: Actor | None,
        ref: ActorRef,
        credentials: AgentCredentials,
        proposal: Proposal,
        *,
        source: ProposalSource,
    ) -> ProposalSummary:
        now = self.clock.now()
        async with self.uow() as uow:
            known = await uow.builder_proposals.get(proposal.proposal_id) is not None
        await self._settle(
            actor,
            credentials,
            proposal.proposal_id,
            lambda agent: (
                []
                if known
                else [
                    BuilderProposalTracked(
                        occurred_at=now,
                        actor=ref,
                        entity_id=proposal.proposal_id,
                        agent_id=agent,
                        source=source,
                    )
                ]
            ),
            proposal=proposal,
            source=source,
        )
        async with self.uow() as uow:
            entry = await uow.builder_proposals.get(proposal.proposal_id)
        if entry is None:  # pragma: no cover - settled just above
            raise NotFoundError("No encontramos la propuesta en la lista.")
        return summary_of(entry, live=True)

    async def save_draft(
        self,
        actor: Actor,
        proposal_id: str,
        *,
        expected_rev: int,
        changes: Sequence[EntityDraft],
    ) -> Proposal:
        self._ensure(actor)
        credentials = self._credentials(actor)
        proposal = await guarded(
            self.registry.put_draft(
                credentials, proposal_id=proposal_id, expected_rev=expected_rev, changes=changes
            )
        )
        ref, now = self._ref(actor), self.clock.now()
        kinds = sorted({c.kind for c in changes})
        await self._settle(
            actor,
            credentials,
            proposal_id,
            lambda agent: [
                BuilderDraftSaved(
                    occurred_at=now,
                    actor=ref,
                    entity_id=proposal_id,
                    agent_id=agent,
                    rev=proposal.rev,
                    changes=len(changes),
                    kinds=kinds,
                )
            ],
            proposal=proposal,
        )
        return proposal

    async def validate(self, actor: Actor, proposal_id: str) -> ValidationReport:
        self._ensure(actor)
        credentials = self._credentials(actor)
        report = await guarded(self.registry.validate(credentials, proposal_id=proposal_id))
        ref, now = self._ref(actor), self.clock.now()
        await self._settle(
            actor,
            credentials,
            proposal_id,
            lambda agent: [
                BuilderProposalValidated(
                    occurred_at=now,
                    actor=ref,
                    entity_id=proposal_id,
                    agent_id=agent,
                    violations=len(report.violations),
                    candidate_hash=report.candidate_hash,
                )
            ],
        )
        return report

    async def freeze(self, actor: Actor, proposal_id: str) -> CandidateView:
        self._ensure(actor)
        credentials = self._credentials(actor)
        candidate = await guarded(self.registry.freeze(credentials, proposal_id=proposal_id))
        ref, now = self._ref(actor), self.clock.now()
        await self._settle(
            actor,
            credentials,
            proposal_id,
            lambda agent: [
                BuilderProposalFrozen(
                    occurred_at=now,
                    actor=ref,
                    entity_id=proposal_id,
                    agent_id=agent,
                    candidate_hash=candidate.candidate_hash,
                    new_versions=len(candidate.new_versions),
                )
            ],
        )
        return candidate

    async def reopen(self, actor: Actor, proposal_id: str) -> Proposal:
        self._ensure(actor)
        credentials = self._credentials(actor)
        proposal = await guarded(self.registry.reopen(credentials, proposal_id=proposal_id))
        ref, now = self._ref(actor), self.clock.now()
        await self._settle(
            actor,
            credentials,
            proposal_id,
            lambda agent: [
                BuilderProposalReopened(
                    occurred_at=now,
                    actor=ref,
                    entity_id=proposal_id,
                    agent_id=agent,
                    rev=proposal.rev,
                )
            ],
            proposal=proposal,
        )
        return proposal

    async def evaluate(
        self, actor: Actor, proposal_id: str, *, suite_id: str, suite_version: str | None
    ) -> EvalReport:
        """Runs the agent's evaluation suite on the frozen candidate. A failed gate is audited
        too (verdict ``fail``: the proposal went back to draft) before the 409 reaches her."""
        self._ensure(actor)
        credentials = self._credentials(actor)
        ref = self._ref(actor)

        def evaluated(report: EvalReport) -> Callable[[str], list[DomainEvent]]:
            # the time the verdict arrived: an evaluation takes as long as the agent's scenarios
            return lambda agent: [
                BuilderProposalEvaluated(
                    occurred_at=self.clock.now(),
                    actor=ref,
                    entity_id=proposal_id,
                    agent_id=agent,
                    suite_id=suite_id,
                    verdict=report.verdict,
                    items=len(report.items),
                    items_failed=sum(1 for i in report.items if not i.passed),
                )
            ]

        try:
            report = await self.registry.evaluate(
                credentials,
                proposal_id=proposal_id,
                suite_id=suite_id,
                suite_version=suite_version,
            )
        except AgentRegistryError as error:
            if error.code == "gate_failed" and error.report is not None:
                await self._settle(actor, credentials, proposal_id, evaluated(error.report))
            raise translate_registry_error(error) from None
        except AgentRuntimeUnavailableError:
            raise AgentCoreUnavailableError() from None
        await self._settle(actor, credentials, proposal_id, evaluated(report))
        return report

    # ------------------------------------------------------------------ deciding (step-up)
    async def approve(
        self,
        actor: Actor,
        proposal_id: str,
        *,
        candidate_hash: str,
        accept_yardstick_loosened: bool,
        step_up_code: str,
    ) -> Approval:
        self._ensure(actor)
        credentials = await self._step_up_credentials(actor, step_up_code)
        approval = await guarded(
            self.registry.approve(
                credentials,
                proposal_id=proposal_id,
                candidate_hash=candidate_hash,
                accept_yardstick_loosened=accept_yardstick_loosened,
            )
        )
        ref, now = self._ref(actor), self.clock.now()
        await self._settle(
            actor,
            credentials,
            proposal_id,
            lambda agent: [
                BuilderProposalApproved(
                    occurred_at=now,
                    actor=ref,
                    entity_id=proposal_id,
                    agent_id=agent,
                    candidate_hash=approval.candidate_hash,
                    yardstick_loosened=len(approval.yardstick_loosened),
                    step_up=True,
                )
            ],
        )
        return approval

    async def reject(
        self, actor: Actor, proposal_id: str, *, reason: str, step_up_code: str
    ) -> Proposal:
        self._ensure(actor)
        credentials = await self._step_up_credentials(actor, step_up_code)
        proposal = await guarded(
            self.registry.reject(credentials, proposal_id=proposal_id, reason=reason.strip())
        )
        ref, now = self._ref(actor), self.clock.now()
        await self._settle(
            actor,
            credentials,
            proposal_id,
            lambda agent: [
                BuilderProposalRejected(
                    occurred_at=now,
                    actor=ref,
                    entity_id=proposal_id,
                    agent_id=agent,
                    reason_length=len(reason.strip()),
                    step_up=True,
                )
            ],
            proposal=proposal,
        )
        return proposal

    async def publish(
        self, actor: Actor, proposal_id: str, *, idempotency_key: str, step_up_code: str
    ) -> ReleaseDetail:
        """Publishes the approved candidate as a release; ``staging`` points at it. Idempotent on
        ``idempotency_key`` (a retry returns the same release)."""
        self._ensure(actor)
        credentials = await self._step_up_credentials(actor, step_up_code)
        release = await guarded(
            self.registry.publish(
                credentials, proposal_id=proposal_id, idempotency_key=idempotency_key
            )
        )
        ref, now = self._ref(actor), self.clock.now()
        await self._settle(
            actor,
            credentials,
            proposal_id,
            lambda agent: [
                BuilderProposalPublished(
                    occurred_at=now,
                    actor=ref,
                    entity_id=proposal_id,
                    agent_id=agent or release.agent_id,
                    release_id=release.release_id,
                    step_up=True,
                )
            ],
        )
        return release

    async def promote(
        self,
        actor: Actor,
        agent_id: str,
        alias: str,
        *,
        release_id: str,
        reason: str,
        step_up_code: str,
    ) -> AliasChange:
        self._ensure(actor)
        credentials = await self._step_up_credentials(actor, step_up_code)
        change = await guarded(
            self.registry.promote(
                credentials,
                agent_id=agent_id,
                alias=alias,
                release_id=release_id,
                reason=reason.strip(),
            )
        )
        ref, now = self._ref(actor), self.clock.now()
        await self._record_only(
            BuilderAliasPromoted(
                occurred_at=now,
                actor=ref,
                entity_id=agent_id,
                alias=change.alias,
                release_id=change.after,
                before=change.before,
                reason_length=len(reason.strip()),
                step_up=True,
            )
        )
        return change

    async def revoke(
        self, actor: Actor, release_id: str, *, reason: str, step_up_code: str
    ) -> ReleaseDetail:
        """Withdraws a release at once (Administración only: the registry asks for ``admin``)."""
        self._ensure(actor)
        if StaffRole.ADMIN not in actor.roles:
            raise ForbiddenError([StaffRole.ADMIN.value])
        credentials = await self._step_up_credentials(actor, step_up_code)
        release = await guarded(
            self.registry.revoke(credentials, release_id=release_id, reason=reason.strip())
        )
        ref, now = self._ref(actor), self.clock.now()
        await self._record_only(
            BuilderReleaseRevoked(
                occurred_at=now,
                actor=ref,
                entity_id=release_id,
                agent_id=release.agent_id,
                reason_length=len(reason.strip()),
                step_up=True,
            )
        )
        return release

    async def _record_only(self, *events: DomainEvent) -> None:
        async with self.uow() as uow:
            uow.record(*events)
            await uow.commit()
