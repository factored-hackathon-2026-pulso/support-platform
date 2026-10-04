"""``InMemoryAgentRegistry``: a small agent-core registry for tests (no network).

It follows the real registry's state machine (``draft → candidate → evaluated → approved →
published``) and, above all, its **authorization**: it reads the principal out of the credential
the platform signed (the signature is not checked here) and applies agent-core's rules
(``registry/roles.py``): only a ``builder`` operates the registry; ``constructor`` builds;
approving, rejecting, publishing and promoting need a *human* ``aprobador`` at ``step_up``;
revoking needs a human ``admin`` at ``step_up``. So a test proves what the platform sends, not
only that it sends something.

Scripting: ``violations`` (what ``validate`` and ``freeze`` report), ``verdicts`` (what each
``evaluate`` answers, ``pass`` by default), ``loosened`` (what an evaluation loosens in the
yardstick) and ``unavailable`` (an outage). Every call is recorded without credentials.
"""

from __future__ import annotations

import hashlib
import json
from collections.abc import Sequence
from dataclasses import asdict, dataclass, field, replace
from typing import Any

from cc_platform.application.ai.credentials import AgentCredentials
from cc_platform.application.ai.registry import (
    AgentRegistryError,
    AliasChange,
    AliasState,
    Approval,
    CandidateView,
    ChangedRef,
    EntityDraft,
    EntityInRelease,
    EntityRef,
    EntityVersion,
    EvalReport,
    EvalRun,
    GateItem,
    Proposal,
    ProposalDetail,
    ProposalOrigin,
    ProposalState,
    ReleaseDetail,
    ReleaseDiff,
    ValidationReport,
    VersionRef,
    VersionSummary,
    Violation,
    YardstickChange,
)
from cc_platform.application.ai.runtime import AgentRuntimeUnavailableError
from cc_platform.application.ports.clock import Clock
from cc_platform.infrastructure.ai.keys import read_jws


@dataclass(frozen=True, slots=True)
class RecordedRegistryCall:
    operation: str
    arguments: dict[str, object]
    principal: dict[str, Any]
    """The principal the platform signed (type, id, roles, attrs, auth), as the registry read it."""


def _deny(code: str, detail: str, status: int = 403) -> AgentRegistryError:
    return AgentRegistryError(status=status, code=code, detail=detail)


@dataclass
class InMemoryAgentRegistry:
    clock: Clock
    calls: list[RecordedRegistryCall] = field(default_factory=list)
    unavailable: bool = False
    staff_kid: str | None = None
    """When set, the credential must be signed with this key id: the registry verifies
    principals against the **staff** keys, so another key is ``credentials_invalid``."""
    violations: list[Violation] = field(default_factory=list)
    verdicts: list[str] = field(default_factory=list)
    loosened: list[YardstickChange] = field(default_factory=list)
    _proposals: dict[str, Proposal] = field(default_factory=dict)
    _changes: dict[str, tuple[EntityDraft, ...]] = field(default_factory=dict)
    _evals: dict[str, EvalRun] = field(default_factory=dict)
    _approved: set[str] = field(default_factory=set)
    _releases: dict[str, ReleaseDetail] = field(default_factory=dict)
    _aliases: dict[tuple[str, str], str] = field(default_factory=dict)
    _publish_keys: dict[str, tuple[str, str]] = field(default_factory=dict)
    _versions: dict[tuple[str, str], list[EntityVersion]] = field(default_factory=dict)
    _count: int = 0

    # ------------------------------------------------------------------ authorization
    def _enter(
        self, operation: str, credentials: AgentCredentials, **arguments: object
    ) -> dict[str, Any]:
        header, principal = read_jws(credentials.authorization)
        if self.staff_kid is not None and header.get("kid") != self.staff_kid:
            self.calls.append(RecordedRegistryCall(operation, arguments, {}))
            raise AgentRegistryError(
                status=401, code="credentials_invalid", detail="firma de otro emisor"
            )
        self.calls.append(RecordedRegistryCall(operation, arguments, principal))
        if self.unavailable:
            raise AgentRuntimeUnavailableError("scripted outage")
        if principal.get("type") != "builder" or not principal.get("id"):
            raise _deny("forbidden_role", "el registry solo lo opera un builder")
        return principal

    @staticmethod
    def _require_constructor(principal: dict[str, Any]) -> None:
        if "constructor" not in principal.get("roles", []):
            raise _deny("forbidden_role", "se necesita el rol constructor")

    @staticmethod
    def _require_human_step_up(principal: dict[str, Any], role: str) -> None:
        human = (principal.get("attrs") or {}).get("actor") == "human"
        if role not in principal.get("roles", []) or not human:
            raise _deny("forbidden_role", f"solo una persona con rol {role} puede hacer esto")
        if (principal.get("auth") or {}).get("level") != "step_up":
            raise _deny("step_up_required", "la operación exige autenticación reforzada")

    # ------------------------------------------------------------------ helpers
    def _proposal_id(self) -> str:
        """agent-core's proposal ids are UUIDs."""
        return f"00000000-0000-7000-8000-{self._count:012d}"

    def _get(self, proposal_id: str) -> Proposal:
        proposal = self._proposals.get(proposal_id)
        if proposal is None:
            raise AgentRegistryError(status=404, code="not_found", detail="la propuesta no existe")
        return proposal

    def _set(self, proposal: Proposal, **changes: Any) -> Proposal:
        updated = replace(proposal, updated_at=self.clock.now(), **changes)
        self._proposals[proposal.proposal_id] = updated
        return updated

    def _expect(self, proposal: Proposal, *states: ProposalState) -> None:
        if proposal.state not in states:
            raise AgentRegistryError(
                status=409,
                code="illegal_transition",
                detail=f"la propuesta está en {proposal.state.value}",
            )

    def _hash(self, proposal_id: str) -> str:
        changes = [
            {"kind": c.kind, "content": c.content, "docs": asdict(c.docs)}
            for c in self._changes.get(proposal_id, ())
        ]
        return hashlib.sha256(json.dumps(changes, sort_keys=True).encode()).hexdigest()

    @staticmethod
    def _refs(changes: Sequence[EntityDraft]) -> tuple[VersionRef, ...]:
        return tuple(
            VersionRef(c.kind, str(c.content.get("id", c.kind)), str(c.content.get("version", "")))
            for c in changes
        )

    # ------------------------------------------------------------------ proposals
    async def create_proposal(
        self,
        credentials: AgentCredentials,
        *,
        agent_id: str,
        title: str,
        origin: ProposalOrigin = ProposalOrigin.MANUAL,
    ) -> Proposal:
        principal = self._enter(
            "create_proposal", credentials, agent_id=agent_id, title=title, origin=origin.value
        )
        self._require_constructor(principal)
        self._count += 1
        proposal = Proposal(
            proposal_id=self._proposal_id(),
            agent_id=agent_id,
            origin=origin,
            state=ProposalState.DRAFT,
            rev=0,
            base_release_id=self._aliases.get((agent_id, "staging")),
            title=title,
            created_by=str(principal["id"]),
            candidate_hash=None,
            updated_at=self.clock.now(),
        )
        self._proposals[proposal.proposal_id] = proposal
        self._changes[proposal.proposal_id] = ()
        return proposal

    def seed_proposal(
        self, *, agent_id: str, title: str, created_by: str = "constructor-bot"
    ) -> str:
        """A proposal somebody else made (the builder chat's service identity): returns its id."""
        self._count += 1
        proposal = Proposal(
            proposal_id=self._proposal_id(),
            agent_id=agent_id,
            origin=ProposalOrigin.BUILDER_CHAT,
            state=ProposalState.DRAFT,
            rev=0,
            base_release_id=self._aliases.get((agent_id, "staging")),
            title=title,
            created_by=created_by,
            candidate_hash=None,
            updated_at=self.clock.now(),
        )
        self._proposals[proposal.proposal_id] = proposal
        self._changes[proposal.proposal_id] = ()
        return proposal.proposal_id

    async def get_proposal(
        self, credentials: AgentCredentials, *, proposal_id: str
    ) -> ProposalDetail:
        self._enter("get_proposal", credentials, proposal_id=proposal_id)
        proposal = self._get(proposal_id)
        last = self._evals.get(proposal_id) if proposal.candidate_hash else None
        return ProposalDetail(
            proposal=proposal, changes=self._changes[proposal_id], last_eval=last, review=None
        )

    async def put_draft(
        self,
        credentials: AgentCredentials,
        *,
        proposal_id: str,
        expected_rev: int,
        changes: Sequence[EntityDraft],
    ) -> Proposal:
        principal = self._enter(
            "put_draft",
            credentials,
            proposal_id=proposal_id,
            expected_rev=expected_rev,
            kinds=[c.kind for c in changes],
        )
        self._require_constructor(principal)
        proposal = self._get(proposal_id)
        self._expect(proposal, ProposalState.DRAFT)
        if proposal.rev != expected_rev:
            raise AgentRegistryError(
                status=409,
                code="proposal_stale",
                detail=f"la propuesta va en la revisión {proposal.rev}, no en {expected_rev}",
            )
        self._changes[proposal_id] = tuple(changes)
        return self._set(proposal, rev=proposal.rev + 1)

    async def validate(
        self, credentials: AgentCredentials, *, proposal_id: str
    ) -> ValidationReport:
        principal = self._enter("validate", credentials, proposal_id=proposal_id)
        self._require_constructor(principal)
        self._get(proposal_id)
        if self.violations or not self._changes[proposal_id]:
            found = tuple(self.violations) or (
                Violation("REG-EMPTY", None, None, "changes", "el borrador está vacío"),
            )
            return ValidationReport(violations=found, candidate_hash=None, auto_bumped=())
        return ValidationReport(
            violations=(), candidate_hash=self._hash(proposal_id), auto_bumped=()
        )

    async def freeze(self, credentials: AgentCredentials, *, proposal_id: str) -> CandidateView:
        principal = self._enter("freeze", credentials, proposal_id=proposal_id)
        self._require_constructor(principal)
        proposal = self._get(proposal_id)
        self._expect(proposal, ProposalState.DRAFT)
        report = await self.validate(credentials, proposal_id=proposal_id)
        if report.violations or report.candidate_hash is None:
            raise AgentRegistryError(
                status=422,
                code="validation_failed",
                detail=f"la candidata tiene {len(report.violations)} violaciones",
                violations=report.violations,
            )
        self._set(proposal, state=ProposalState.CANDIDATE, candidate_hash=report.candidate_hash)
        return CandidateView(
            proposal_id=proposal_id,
            candidate_hash=report.candidate_hash,
            release_id_preview="rel-" + report.candidate_hash[:16],
            new_versions=self._refs(self._changes[proposal_id]),
            auto_bumped=(),
        )

    async def reopen(self, credentials: AgentCredentials, *, proposal_id: str) -> Proposal:
        principal = self._enter("reopen", credentials, proposal_id=proposal_id)
        self._require_constructor(principal)
        proposal = self._get(proposal_id)
        self._expect(
            proposal, ProposalState.CANDIDATE, ProposalState.EVALUATED, ProposalState.APPROVED
        )
        self._approved.discard(proposal_id)
        return self._set(
            proposal, state=ProposalState.DRAFT, candidate_hash=None, rev=proposal.rev + 1
        )

    async def evaluate(
        self,
        credentials: AgentCredentials,
        *,
        proposal_id: str,
        suite_id: str,
        suite_version: str | None = None,
    ) -> EvalReport:
        principal = self._enter("evaluate", credentials, proposal_id=proposal_id, suite_id=suite_id)
        self._require_constructor(principal)
        proposal = self._get(proposal_id)
        self._expect(proposal, ProposalState.CANDIDATE)
        verdict: Any = self.verdicts.pop(0) if self.verdicts else "pass"
        item = GateItem(
            metric_id="resolution_rate",
            phase="new_yardstick",
            role="gate",
            value="0.9" if verdict == "pass" else "0.4",
            base_value=None,
            noise_margin=None,
            floor="0.8",
            passed=verdict == "pass",
            reason="",
        )
        report = EvalReport(
            verdict=verdict,
            items=(item,),
            yardstick_changes=tuple(self.loosened),
            detail=None,
        )
        run = EvalRun(
            eval_run_id=f"evr-{self._count:04d}",
            proposal_id=proposal_id,
            candidate_hash=proposal.candidate_hash or "",
            base_release_id=proposal.base_release_id,
            suite=VersionRef("eval_suite", suite_id, suite_version or "1.0.0"),
            verdict=verdict,
            report=report,
            at=self.clock.now(),
        )
        self._evals[proposal_id] = run
        if verdict == "pass":
            self._set(proposal, state=ProposalState.EVALUATED)
        elif verdict == "fail":
            self._set(
                proposal, state=ProposalState.DRAFT, candidate_hash=None, rev=proposal.rev + 1
            )
            raise AgentRegistryError(
                status=409,
                code="gate_failed",
                detail="la candidata no pasa el gate",
                report=report,
                eval_run_id=run.eval_run_id,
            )
        return report

    async def approve(
        self,
        credentials: AgentCredentials,
        *,
        proposal_id: str,
        candidate_hash: str,
        accept_yardstick_loosened: bool = False,
    ) -> Approval:
        principal = self._enter(
            "approve",
            credentials,
            proposal_id=proposal_id,
            candidate_hash=candidate_hash,
            accept_yardstick_loosened=accept_yardstick_loosened,
        )
        self._require_human_step_up(principal, "aprobador")
        proposal = self._get(proposal_id)
        self._expect(proposal, ProposalState.EVALUATED)
        if candidate_hash != proposal.candidate_hash:
            raise AgentRegistryError(
                status=409,
                code="candidate_changed",
                detail="la candidata aprobada no es la vigente",
            )
        loosened = tuple(self.loosened)
        if loosened and not accept_yardstick_loosened:
            raise AgentRegistryError(
                status=409,
                code="loosening_not_accepted",
                detail="la propuesta afloja la vara",
                yardstick_loosened=loosened,
            )
        self._set(proposal, state=ProposalState.APPROVED)
        self._approved.add(proposal_id)
        return Approval(
            proposal_id=proposal_id,
            candidate_hash=candidate_hash,
            actor=str(principal["id"]),
            decision="approved",
            reason=None,
            yardstick_loosened=loosened,
            at=self.clock.now(),
        )

    async def reject(
        self, credentials: AgentCredentials, *, proposal_id: str, reason: str
    ) -> Proposal:
        principal = self._enter(
            "reject", credentials, proposal_id=proposal_id, reason_length=len(reason)
        )
        self._require_human_step_up(principal, "aprobador")
        proposal = self._get(proposal_id)
        self._expect(proposal, ProposalState.EVALUATED)
        return self._set(
            proposal, state=ProposalState.DRAFT, candidate_hash=None, rev=proposal.rev + 1
        )

    async def publish(
        self, credentials: AgentCredentials, *, proposal_id: str, idempotency_key: str
    ) -> ReleaseDetail:
        principal = self._enter(
            "publish", credentials, proposal_id=proposal_id, idempotency_key=idempotency_key
        )
        self._require_human_step_up(principal, "aprobador")
        prior = self._publish_keys.get(idempotency_key)
        if prior is not None:
            if prior[0] != proposal_id:
                raise AgentRegistryError(
                    status=409,
                    code="illegal_transition",
                    detail="la Idempotency-Key ya se usó con otra propuesta",
                )
            return self._releases[prior[1]]
        proposal = self._get(proposal_id)
        self._expect(proposal, ProposalState.APPROVED)
        current = self._aliases.get((proposal.agent_id, "staging"))
        if current != proposal.base_release_id:
            self._set(
                proposal,
                state=ProposalState.DRAFT,
                candidate_hash=None,
                base_release_id=current,
                rev=proposal.rev + 1,
            )
            raise AgentRegistryError(
                status=409, code="proposal_stale", detail="staging cambió desde la propuesta"
            )
        release_id = "rel-" + (proposal.candidate_hash or "")[:16]
        entities = tuple(
            EntityInRelease(
                ref=ref,
                content_hash=self._hash(proposal_id)[:16],
                docs=change.docs,
                changed_vs_base=True,
            )
            for ref, change in zip(
                self._refs(self._changes[proposal_id]), self._changes[proposal_id], strict=True
            )
        )
        release = ReleaseDetail(
            release_id=release_id,
            status="active",
            agent_id=proposal.agent_id,
            entities=entities,
            knowledge_snapshot=None,
            proposal_id=proposal_id,
            base_release_id=proposal.base_release_id,
            published_by=str(principal["id"]),
            published_at=self.clock.now(),
            eval_suite_refs=(),
            interrupts=(),
            language_detection=EntityRef("lang-detect", "1.0.0"),
            injection_ruleset=None,
            max_input_chars=4000,
        )
        self._releases[release_id] = release
        self._aliases[(proposal.agent_id, "staging")] = release_id
        self._publish_keys[idempotency_key] = (proposal_id, release_id)
        self._set(proposal, state=ProposalState.PUBLISHED)
        return release

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
        principal = self._enter(
            "promote",
            credentials,
            agent_id=agent_id,
            alias=alias,
            release_id=release_id,
            reason_length=len(reason),
        )
        self._require_human_step_up(principal, "aprobador")
        if alias not in {"staging", "prod"}:
            raise AgentRegistryError(
                status=422, code="validation_failed", detail="el alias debe ser staging o prod"
            )
        release = self._releases.get(release_id)
        if release is None:
            raise AgentRegistryError(status=404, code="not_found", detail="la release no existe")
        if release.status != "active" or release.agent_id != agent_id:
            raise AgentRegistryError(
                status=409, code="illegal_transition", detail="esa release no se puede promover"
            )
        before = self._aliases.get((agent_id, alias))
        self._aliases[(agent_id, alias)] = release_id
        return AliasChange(
            agent_id=agent_id,
            alias=alias,
            before=before,
            after=release_id,
            actor=str(principal["id"]),
            reason=reason[:500],
            at=self.clock.now(),
        )

    async def revoke(
        self, credentials: AgentCredentials, *, release_id: str, reason: str
    ) -> ReleaseDetail:
        principal = self._enter(
            "revoke", credentials, release_id=release_id, reason_length=len(reason)
        )
        self._require_human_step_up(principal, "admin")
        release = self._releases.get(release_id)
        if release is None:
            raise AgentRegistryError(status=404, code="not_found", detail="la release no existe")
        if release.status != "active":
            raise AgentRegistryError(
                status=409, code="illegal_transition", detail="la release ya está revocada"
            )
        if any(alias == "prod" and rid == release_id for (_, alias), rid in self._aliases.items()):
            raise AgentRegistryError(
                status=409,
                code="illegal_transition",
                detail="prod apunta a esta release: promueve otra antes de revocarla",
            )
        revoked = replace(release, status="revoked")
        self._releases[release_id] = revoked
        return revoked

    async def get_alias(
        self, credentials: AgentCredentials, *, agent_id: str, alias: str
    ) -> AliasState:
        self._enter("get_alias", credentials, agent_id=agent_id, alias=alias)
        release_id = self._aliases.get((agent_id, alias))
        if release_id is None:
            raise AgentRegistryError(
                status=404, code="not_found", detail="el alias no apunta a ninguna release"
            )
        return AliasState(
            agent_id=agent_id,
            alias=alias,
            release_id=release_id,
            status=self._releases[release_id].status,
        )

    async def get_release(self, credentials: AgentCredentials, *, release_id: str) -> ReleaseDetail:
        self._enter("get_release", credentials, release_id=release_id)
        release = self._releases.get(release_id)
        if release is None:
            raise AgentRegistryError(status=404, code="not_found", detail="la release no existe")
        return release

    async def diff_releases(self, credentials: AgentCredentials, *, a: str, b: str) -> ReleaseDiff:
        self._enter("diff_releases", credentials, a=a, b=b)
        left, right = self._releases.get(a), self._releases.get(b)
        if left is None or right is None:
            raise AgentRegistryError(status=404, code="not_found", detail="la release no existe")
        before = {(e.ref.kind, e.ref.id): e for e in left.entities}
        after = {(e.ref.kind, e.ref.id): e for e in right.entities}
        return ReleaseDiff(
            a=a,
            b=b,
            added=tuple(after[k].ref for k in sorted(after.keys() - before.keys())),
            removed=tuple(before[k].ref for k in sorted(before.keys() - after.keys())),
            changed=tuple(
                ChangedRef(before[k].ref, after[k].ref, after[k].docs)
                for k in sorted(before.keys() & after.keys())
                if before[k].ref != after[k].ref
            ),
        )

    # ------------------------------------------------------------------ entities
    def seed_entity(self, version: EntityVersion) -> None:
        """Make an entity version readable (``get_entity`` and ``list_versions``)."""
        self._versions.setdefault((version.ref.kind, version.ref.id), []).append(version)

    async def list_versions(
        self, credentials: AgentCredentials, *, kind: str, entity_id: str
    ) -> tuple[VersionSummary, ...]:
        self._enter("list_versions", credentials, kind=kind, entity_id=entity_id)
        return tuple(
            VersionSummary(v.ref, v.content_hash, v.docs, v.created_by, v.created_at)
            for v in self._versions.get((kind, entity_id), [])
        )

    async def get_entity(
        self,
        credentials: AgentCredentials,
        *,
        kind: str,
        entity_id: str,
        version: str | None = None,
    ) -> EntityVersion:
        self._enter("get_entity", credentials, kind=kind, entity_id=entity_id, version=version)
        found = [
            v for v in self._versions.get((kind, entity_id), []) if version in (None, v.ref.version)
        ]
        if not found:
            raise AgentRegistryError(
                status=404, code="not_found", detail="la entidad o su versión no existe"
            )
        return found[-1]
