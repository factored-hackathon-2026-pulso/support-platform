"""The Core's ports behind ``CoreGuard`` (deploy brief P4): decorators of ``AgentRuntime`` and
``AgentRegistryClient`` that add the timeout of their call kind, the retries where repeating a
call is safe, and the shared circuit breaker. They change no answer: what the inner client returns
or raises comes out the same, except that a timeout or an open breaker raises an
``AgentRuntimeUnavailableError`` subclass, which every caller already treats as "the Core is down".

What is retried (agent-core makes it idempotent, or it only reads):

- runtime: ``start_run`` (``Idempotency-Key``), ``post_turn`` (``client_turn_id``: agent-core
  answers a repeated turn from its own record), ``get_lineage``, ``get_handoff``. Not
  ``record_resolution`` (once per handoff; a repeat after a lost answer would be a ``409``).
- registry: every ``GET`` and ``publish`` (``Idempotency-Key``). Not the other writes (create,
  draft, validate, freeze, reopen, evaluate, approve, reject, promote, revoke).
"""

from __future__ import annotations

from collections.abc import Mapping, Sequence
from typing import Literal

from cc_platform.application.ai.credentials import AgentCredentials
from cc_platform.application.ai.registry import (
    AgentRegistryClient,
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
from cc_platform.application.ai.runtime import (
    AgentRun,
    AgentRuntime,
    AgentTurn,
    HandoffQuality,
    HandoffResolutionResult,
    SessionLineage,
)
from cc_platform.infrastructure.core.resilience import CallKind, CoreGuard


class ResilientAgentRuntime:
    """``AgentRuntime`` with the guard of one call kind (the assistant, the copilot...)."""

    def __init__(self, inner: AgentRuntime, guard: CoreGuard, kind: CallKind) -> None:
        self._inner = inner
        self._guard = guard
        self._kind = kind

    async def start_run(
        self,
        credentials: AgentCredentials,
        *,
        agent: str,
        idempotency_key: str,
        lang: str | None = None,
        input: Mapping[str, object] | None = None,
    ) -> AgentRun:
        return await self._guard.call(
            self._kind,
            "start_run",
            lambda: self._inner.start_run(
                credentials, agent=agent, idempotency_key=idempotency_key, lang=lang, input=input
            ),
            retryable=True,
        )

    async def post_turn(
        self,
        credentials: AgentCredentials,
        *,
        session_id: str,
        client_turn_id: str,
        channel: str,
        text: str = "",
        confirm_token: str | None = None,
        confirm_answer: Literal["yes", "no"] | None = None,
        lang: str | None = None,
    ) -> AgentTurn:
        return await self._guard.call(
            self._kind,
            "post_turn",
            lambda: self._inner.post_turn(
                credentials,
                session_id=session_id,
                client_turn_id=client_turn_id,
                channel=channel,
                text=text,
                confirm_token=confirm_token,
                confirm_answer=confirm_answer,
                lang=lang,
            ),
            retryable=True,
        )

    async def get_lineage(
        self, credentials: AgentCredentials, *, session_id: str
    ) -> SessionLineage:
        return await self._guard.call(
            self._kind,
            "get_lineage",
            lambda: self._inner.get_lineage(credentials, session_id=session_id),
            retryable=True,
        )

    async def get_handoff(
        self, credentials: AgentCredentials, *, handoff_ref: str
    ) -> dict[str, object]:
        return await self._guard.call(
            self._kind,
            "get_handoff",
            lambda: self._inner.get_handoff(credentials, handoff_ref=handoff_ref),
            retryable=True,
        )

    async def record_resolution(
        self,
        credentials: AgentCredentials,
        *,
        handoff_ref: str,
        resolution_code: str,
        handoff_quality: HandoffQuality,
        notes: str | None = None,
    ) -> HandoffResolutionResult:
        return await self._guard.call(
            self._kind,
            "record_resolution",
            lambda: self._inner.record_resolution(
                credentials,
                handoff_ref=handoff_ref,
                resolution_code=resolution_code,
                handoff_quality=handoff_quality,
                notes=notes,
            ),
        )


class ResilientAgentRegistry:
    """``AgentRegistryClient`` with the guard: ``evaluate`` has its own (longer) timeout."""

    def __init__(self, inner: AgentRegistryClient, guard: CoreGuard) -> None:
        self._inner = inner
        self._guard = guard

    # ------------------------------------------------------------------ proposals
    async def create_proposal(
        self,
        credentials: AgentCredentials,
        *,
        agent_id: str,
        title: str,
        origin: ProposalOrigin = ProposalOrigin.MANUAL,
    ) -> Proposal:
        return await self._guard.call(
            CallKind.REGISTRY,
            "create_proposal",
            lambda: self._inner.create_proposal(
                credentials, agent_id=agent_id, title=title, origin=origin
            ),
        )

    async def list_proposals(
        self,
        credentials: AgentCredentials,
        *,
        agent_id: str | None = None,
        state: str | None = None,
        limit: int = 50,
        offset: int = 0,
    ) -> ProposalPage:
        return await self._guard.call(
            CallKind.REGISTRY,
            "list_proposals",
            lambda: self._inner.list_proposals(
                credentials, agent_id=agent_id, state=state, limit=limit, offset=offset
            ),
            retryable=True,
        )

    async def get_proposal(
        self, credentials: AgentCredentials, *, proposal_id: str
    ) -> ProposalDetail:
        return await self._guard.call(
            CallKind.REGISTRY,
            "get_proposal",
            lambda: self._inner.get_proposal(credentials, proposal_id=proposal_id),
            retryable=True,
        )

    async def put_draft(
        self,
        credentials: AgentCredentials,
        *,
        proposal_id: str,
        expected_rev: int,
        changes: Sequence[EntityDraft],
    ) -> Proposal:
        return await self._guard.call(
            CallKind.REGISTRY,
            "put_draft",
            lambda: self._inner.put_draft(
                credentials, proposal_id=proposal_id, expected_rev=expected_rev, changes=changes
            ),
        )

    async def validate(
        self, credentials: AgentCredentials, *, proposal_id: str
    ) -> ValidationReport:
        return await self._guard.call(
            CallKind.REGISTRY,
            "validate",
            lambda: self._inner.validate(credentials, proposal_id=proposal_id),
        )

    async def freeze(self, credentials: AgentCredentials, *, proposal_id: str) -> CandidateView:
        return await self._guard.call(
            CallKind.REGISTRY,
            "freeze",
            lambda: self._inner.freeze(credentials, proposal_id=proposal_id),
        )

    async def reopen(self, credentials: AgentCredentials, *, proposal_id: str) -> Proposal:
        return await self._guard.call(
            CallKind.REGISTRY,
            "reopen",
            lambda: self._inner.reopen(credentials, proposal_id=proposal_id),
        )

    async def evaluate(
        self,
        credentials: AgentCredentials,
        *,
        proposal_id: str,
        suite_id: str,
        suite_version: str | None = None,
    ) -> EvalReport:
        return await self._guard.call(
            CallKind.EVALUATE,
            "evaluate",
            lambda: self._inner.evaluate(
                credentials,
                proposal_id=proposal_id,
                suite_id=suite_id,
                suite_version=suite_version,
            ),
        )

    async def approve(
        self,
        credentials: AgentCredentials,
        *,
        proposal_id: str,
        candidate_hash: str,
        accept_yardstick_loosened: bool = False,
    ) -> Approval:
        return await self._guard.call(
            CallKind.REGISTRY,
            "approve",
            lambda: self._inner.approve(
                credentials,
                proposal_id=proposal_id,
                candidate_hash=candidate_hash,
                accept_yardstick_loosened=accept_yardstick_loosened,
            ),
        )

    async def reject(
        self, credentials: AgentCredentials, *, proposal_id: str, reason: str
    ) -> Proposal:
        return await self._guard.call(
            CallKind.REGISTRY,
            "reject",
            lambda: self._inner.reject(credentials, proposal_id=proposal_id, reason=reason),
        )

    async def publish(
        self, credentials: AgentCredentials, *, proposal_id: str, idempotency_key: str
    ) -> ReleaseDetail:
        return await self._guard.call(
            CallKind.REGISTRY,
            "publish",
            lambda: self._inner.publish(
                credentials, proposal_id=proposal_id, idempotency_key=idempotency_key
            ),
            retryable=True,
        )

    # ------------------------------------------------------------------ aliases and releases
    async def promote(
        self,
        credentials: AgentCredentials,
        *,
        agent_id: str,
        alias: str,
        release_id: str,
        reason: str = "",
    ) -> AliasChange:
        return await self._guard.call(
            CallKind.REGISTRY,
            "promote",
            lambda: self._inner.promote(
                credentials, agent_id=agent_id, alias=alias, release_id=release_id, reason=reason
            ),
        )

    async def revoke(
        self, credentials: AgentCredentials, *, release_id: str, reason: str
    ) -> ReleaseDetail:
        return await self._guard.call(
            CallKind.REGISTRY,
            "revoke",
            lambda: self._inner.revoke(credentials, release_id=release_id, reason=reason),
        )

    async def get_alias(
        self, credentials: AgentCredentials, *, agent_id: str, alias: str
    ) -> AliasState:
        return await self._guard.call(
            CallKind.REGISTRY,
            "get_alias",
            lambda: self._inner.get_alias(credentials, agent_id=agent_id, alias=alias),
            retryable=True,
        )

    async def get_release(self, credentials: AgentCredentials, *, release_id: str) -> ReleaseDetail:
        return await self._guard.call(
            CallKind.REGISTRY,
            "get_release",
            lambda: self._inner.get_release(credentials, release_id=release_id),
            retryable=True,
        )

    async def diff_releases(self, credentials: AgentCredentials, *, a: str, b: str) -> ReleaseDiff:
        return await self._guard.call(
            CallKind.REGISTRY,
            "diff_releases",
            lambda: self._inner.diff_releases(credentials, a=a, b=b),
            retryable=True,
        )

    # ------------------------------------------------------------------ entities
    async def list_versions(
        self, credentials: AgentCredentials, *, kind: str, entity_id: str
    ) -> tuple[VersionSummary, ...]:
        return await self._guard.call(
            CallKind.REGISTRY,
            "list_versions",
            lambda: self._inner.list_versions(credentials, kind=kind, entity_id=entity_id),
            retryable=True,
        )

    async def get_entity(
        self,
        credentials: AgentCredentials,
        *,
        kind: str,
        entity_id: str,
        version: str | None = None,
    ) -> EntityVersion:
        return await self._guard.call(
            CallKind.REGISTRY,
            "get_entity",
            lambda: self._inner.get_entity(
                credentials, kind=kind, entity_id=entity_id, version=version
            ),
            retryable=True,
        )
