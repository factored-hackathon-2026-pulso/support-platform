"""The agent builder (ADR 0003 §7, slice 16): proposals through agent-core's registry.

Over the real composition and both persistence adapters, with a registry double that applies
agent-core's own authorization (``registry/roles.py``) to the credential the platform signs, so a
test proves *what is sent* (principal, roles, human, step-up), not only that something is.
"""

from __future__ import annotations

import json
from collections.abc import AsyncIterator
from pathlib import Path

import pytest

from cc_platform.application.ai.builder import AgentBuilder, identity_of
from cc_platform.application.ai.errors import (
    AgentCoreUnavailableError,
    BuilderStepUpInvalidError,
    RegistryConflictError,
    RegistryGateFailedError,
    RegistryLooseningNotAcceptedError,
    RegistryNotFoundError,
    RegistryValidationFailedError,
)
from cc_platform.application.ai.registry import (
    AgentRegistryError,
    ProposalOrigin,
    ProposalState,
    Violation,
    YardstickChange,
)
from cc_platform.application.audit.catalog import AuditNames, describe, fallback_description
from cc_platform.application.errors import ForbiddenError
from cc_platform.application.events import StoredEvent
from cc_platform.application.security import Actor
from cc_platform.domain.people.errors import AccountLockedError
from cc_platform.infrastructure.ai.memory_registry import RecordedRegistryCall
from cc_platform.infrastructure.seed.people import seed_staff_id
from tests.builder_support import AGENT, BuilderWorld, builder_events, builder_world, draft
from tests.support import ADMIN_ONLY, ANALYST, SUPERVISOR, actor_for

CODE = "000000"  # the development code of the seeded accounts (no authenticator enrolled)
LUCIA = seed_staff_id(SUPERVISOR.number)
VALERIA = seed_staff_id(ADMIN_ONLY.number)


@pytest.fixture(params=["memory", "sqlalchemy"])
async def world(request: pytest.FixtureRequest, tmp_path: Path) -> AsyncIterator[BuilderWorld]:
    async for built in builder_world(str(request.param), tmp_path):
        yield built


def builder(world: BuilderWorld) -> AgentBuilder:
    assert world.container.use_cases.assistant is not None
    assert world.container.use_cases.assistant.builder is not None
    return world.container.use_cases.assistant.builder.registry


def calls(world: BuilderWorld, operation: str) -> list[RecordedRegistryCall]:
    return [c for c in world.registry.calls if c.operation == operation]


async def evaluated_proposal(world: BuilderWorld, actor: Actor | None = None) -> tuple[str, str]:
    """A proposal that went through create, draft, freeze and a passing evaluation."""
    api, who = builder(world), actor or actor_for(SUPERVISOR)
    proposal = await api.create_proposal(who, agent_id=AGENT, title="Resumen más corto")
    await api.save_draft(who, proposal.proposal_id, expected_rev=0, changes=[draft()])
    candidate = await api.freeze(who, proposal.proposal_id)
    await api.evaluate(who, proposal.proposal_id, suite_id="suite-disputas", suite_version=None)
    return proposal.proposal_id, candidate.candidate_hash


# ----------------------------------------------------------------------------- identity
async def test_a_supervisor_builds_as_a_human_builder_with_constructor_and_approver(
    world: BuilderWorld,
) -> None:
    await builder(world).create_proposal(actor_for(SUPERVISOR), agent_id=AGENT, title="Cambio")

    principal = calls(world, "create_proposal")[0].principal
    assert (principal["type"], principal["id"]) == ("builder", LUCIA)
    assert sorted(principal["roles"]) == ["aprobador", "constructor"]
    assert principal["attrs"] == {"actor": "human"}
    assert principal["auth"]["level"] == "session"  # no second factor: nothing sensitive asked


async def test_administration_adds_the_admin_role(world: BuilderWorld) -> None:
    await builder(world).create_proposal(actor_for(ADMIN_ONLY), agent_id=AGENT, title="Cambio")

    principal = calls(world, "create_proposal")[0].principal
    assert principal["id"] == VALERIA
    assert sorted(principal["roles"]) == ["admin", "aprobador", "constructor"]
    assert principal["attrs"] == {"actor": "human"}


async def test_the_registry_only_trusts_the_staff_key(world: BuilderWorld) -> None:
    """agent-core verifies the registry's principals against ``--staff-keys``: the credential the
    platform signs for the *runtime* (identity key) is refused there, like a forged one."""
    assert world.container.agent_core is not None
    issuer = world.container.agent_core.issuer
    identity = identity_of(actor_for(SUPERVISOR))

    with pytest.raises(AgentRegistryError) as refused:
        await world.registry.create_proposal(
            issuer.builder_run(identity), agent_id=AGENT, title="Cambio"
        )
    assert refused.value.code == "credentials_invalid"
    created = await world.registry.create_proposal(
        issuer.builder(identity), agent_id=AGENT, title="Cambio"
    )
    assert created.created_by == LUCIA


async def test_an_analyst_has_no_agent_builder(world: BuilderWorld) -> None:
    with pytest.raises(ForbiddenError):
        await builder(world).create_proposal(actor_for(ANALYST), agent_id=AGENT, title="Cambio")
    with pytest.raises(ForbiddenError):
        await builder(world).list_proposals(actor_for(ANALYST))
    assert world.registry.calls == []


# ----------------------------------------------------------------------------- the lifecycle
async def test_a_proposal_goes_from_draft_to_prod_and_only_decisions_carry_step_up(
    world: BuilderWorld,
) -> None:
    api, who = builder(world), actor_for(SUPERVISOR)
    proposal = await api.create_proposal(who, agent_id=AGENT, title="Resumen más corto")
    assert proposal.state is ProposalState.DRAFT
    saved = await api.save_draft(who, proposal.proposal_id, expected_rev=0, changes=[draft()])
    assert saved.rev == 1
    report = await api.validate(who, proposal.proposal_id)
    assert report.violations == ()
    assert report.candidate_hash is not None
    candidate = await api.freeze(who, proposal.proposal_id)
    assert candidate.candidate_hash == report.candidate_hash
    evaluation = await api.evaluate(
        who, proposal.proposal_id, suite_id="suite-disputas", suite_version=None
    )
    assert evaluation.verdict == "pass"

    approval = await api.approve(
        who,
        proposal.proposal_id,
        candidate_hash=candidate.candidate_hash,
        accept_yardstick_loosened=False,
        step_up_code=CODE,
    )
    assert (approval.decision, approval.actor) == ("approved", LUCIA)
    release = await api.publish(
        who, proposal.proposal_id, idempotency_key="publish-0001", step_up_code=CODE
    )
    assert release.status == "active"
    assert release.proposal_id == proposal.proposal_id
    change = await api.promote(
        who,
        AGENT,
        "prod",
        release_id=release.release_id,
        reason="Probado en staging",
        step_up_code=CODE,
    )
    assert (change.alias, change.after) == ("prod", release.release_id)
    assert (await api.get_alias(who, AGENT, "prod")).release_id == release.release_id
    detail = await api.get_proposal(who, proposal.proposal_id)
    assert detail.proposal.state is ProposalState.PUBLISHED

    levels = {c.operation: c.principal["auth"]["level"] for c in world.registry.calls}
    assert {op for op, level in levels.items() if level == "step_up"} == {
        "approve",
        "publish",
        "promote",
    }
    assert all(c.principal["attrs"] == {"actor": "human"} for c in world.registry.calls)


async def test_a_step_up_credential_lives_minutes_not_ten(world: BuilderWorld) -> None:
    proposal_id, candidate_hash = await evaluated_proposal(world)
    await builder(world).approve(
        actor_for(SUPERVISOR),
        proposal_id,
        candidate_hash=candidate_hash,
        accept_yardstick_loosened=False,
        step_up_code=CODE,
    )

    approve, ordinary = calls(world, "approve")[0], calls(world, "create_proposal")[0]
    lifetime = approve.principal["exp"], ordinary.principal["exp"]
    assert lifetime[0] < lifetime[1]  # 2 minutes against 10 (same clock)


async def test_reject_publish_and_promote_also_need_the_second_factor(
    world: BuilderWorld,
) -> None:
    proposal_id, _ = await evaluated_proposal(world)
    who = actor_for(SUPERVISOR)

    rejected = await builder(world).reject(
        who, proposal_id, reason="No cumple el tono", step_up_code=CODE
    )

    assert rejected.state is ProposalState.DRAFT
    assert calls(world, "reject")[0].principal["auth"]["level"] == "step_up"


# ----------------------------------------------------------------------------- the second factor
async def test_a_wrong_code_stops_the_call_and_counts_toward_the_lock(world: BuilderWorld) -> None:
    proposal_id, candidate_hash = await evaluated_proposal(world)
    who = actor_for(SUPERVISOR)

    async def approve(code: str) -> None:
        await builder(world).approve(
            who,
            proposal_id,
            candidate_hash=candidate_hash,
            accept_yardstick_loosened=False,
            step_up_code=code,
        )

    with pytest.raises(BuilderStepUpInvalidError) as first:
        await approve("111111")
    assert first.value.remaining_attempts == 4
    assert calls(world, "approve") == []  # the registry was never asked
    for _ in range(3):
        with pytest.raises(BuilderStepUpInvalidError):
            await approve("111111")
    with pytest.raises(AccountLockedError):  # the fifth wrong code locks her out
        await approve("111111")
    with pytest.raises(AccountLockedError):  # even the right one, until the lock ends
        await approve(CODE)
    assert calls(world, "approve") == []


async def test_an_account_with_an_authenticator_needs_its_code_not_the_development_one(
    world: BuilderWorld,
) -> None:
    container = world.container
    secret = container.totp.new_secret()
    async with container.uow() as uow:
        account = await uow.login_accounts.get(LUCIA)
        assert account is not None
        account.totp_secret = container.secret_box.seal(secret)
        await uow.login_accounts.save(account)
        await uow.commit()
    proposal_id, candidate_hash = await evaluated_proposal(world)
    who = actor_for(SUPERVISOR)

    with pytest.raises(BuilderStepUpInvalidError):
        await builder(world).approve(
            who,
            proposal_id,
            candidate_hash=candidate_hash,
            accept_yardstick_loosened=False,
            step_up_code=CODE,
        )
    good = container.totp.code_at(secret, container.clock.now())
    approval = await builder(world).approve(
        who,
        proposal_id,
        candidate_hash=candidate_hash,
        accept_yardstick_loosened=False,
        step_up_code=good,
    )
    assert approval.decision == "approved"


async def test_each_decision_asks_again(world: BuilderWorld) -> None:
    """Nothing is remembered: a code that passed once does not unlock the next call."""
    proposal_id, candidate_hash = await evaluated_proposal(world)
    who = actor_for(SUPERVISOR)
    await builder(world).approve(
        who,
        proposal_id,
        candidate_hash=candidate_hash,
        accept_yardstick_loosened=False,
        step_up_code=CODE,
    )

    with pytest.raises(BuilderStepUpInvalidError):
        await builder(world).publish(
            who, proposal_id, idempotency_key="publish-0002", step_up_code="999999"
        )


# ----------------------------------------------------------------------------- the registry's word
async def test_a_failed_gate_is_audited_and_reaches_the_caller_with_its_report(
    world: BuilderWorld,
) -> None:
    api, who = builder(world), actor_for(SUPERVISOR)
    proposal = await api.create_proposal(who, agent_id=AGENT, title="Cambio")
    await api.save_draft(who, proposal.proposal_id, expected_rev=0, changes=[draft()])
    await api.freeze(who, proposal.proposal_id)
    world.registry.verdicts.append("fail")

    with pytest.raises(RegistryGateFailedError) as failed:
        await api.evaluate(who, proposal.proposal_id, suite_id="suite", suite_version=None)

    assert failed.value.report is not None
    assert failed.value.report.verdict == "fail"
    assert failed.value.registry_code == "gate_failed"
    events = [
        e for e in await builder_events(world.container) if e[0] == "builder.proposal_evaluated"
    ]
    assert [e[1]["verdict"] for e in events] == ["fail"]
    assert events[0][1]["items_failed"] == 1
    detail = await api.get_proposal(who, proposal.proposal_id)
    assert detail.proposal.state is ProposalState.DRAFT  # back to draft: edit and freeze again


async def test_violations_travel_with_the_validation_error(world: BuilderWorld) -> None:
    api, who = builder(world), actor_for(SUPERVISOR)
    proposal = await api.create_proposal(who, agent_id=AGENT, title="Cambio")
    await api.save_draft(who, proposal.proposal_id, expected_rev=0, changes=[draft()])
    world.registry.violations.append(
        Violation("G0-05", "disputa", "n1", "nodes/n1", "falta confirm")
    )

    report = await api.validate(who, proposal.proposal_id)
    assert [v.rule for v in report.violations] == ["G0-05"]
    assert report.candidate_hash is None
    with pytest.raises(RegistryValidationFailedError) as refused:
        await api.freeze(who, proposal.proposal_id)

    assert [v.node_id for v in refused.value.violations] == ["n1"]


async def test_stale_revisions_and_wrong_states_are_conflicts(world: BuilderWorld) -> None:
    api, who = builder(world), actor_for(SUPERVISOR)
    proposal = await api.create_proposal(who, agent_id=AGENT, title="Cambio")
    await api.save_draft(who, proposal.proposal_id, expected_rev=0, changes=[draft()])

    with pytest.raises(RegistryConflictError) as stale:
        await api.save_draft(who, proposal.proposal_id, expected_rev=0, changes=[draft("1.2.0")])
    assert stale.value.registry_code == "proposal_stale"
    with pytest.raises(RegistryConflictError) as early:
        await api.evaluate(who, proposal.proposal_id, suite_id="suite", suite_version=None)
    assert early.value.registry_code == "illegal_transition"  # not frozen yet


async def test_loosening_the_yardstick_needs_an_explicit_acceptance(world: BuilderWorld) -> None:
    world.registry.loosened.append(
        YardstickChange("floor_loosened", "resolution_rate", "baja el piso")
    )
    proposal_id, candidate_hash = await evaluated_proposal(world)
    who = actor_for(SUPERVISOR)

    with pytest.raises(RegistryLooseningNotAcceptedError) as refused:
        await builder(world).approve(
            who,
            proposal_id,
            candidate_hash=candidate_hash,
            accept_yardstick_loosened=False,
            step_up_code=CODE,
        )
    assert [c.kind for c in refused.value.yardstick_loosened] == ["floor_loosened"]

    approval = await builder(world).approve(
        who,
        proposal_id,
        candidate_hash=candidate_hash,
        accept_yardstick_loosened=True,
        step_up_code=CODE,
    )
    assert [c.target for c in approval.yardstick_loosened] == ["resolution_rate"]


async def test_publishing_twice_with_the_same_key_returns_the_same_release(
    world: BuilderWorld,
) -> None:
    proposal_id, candidate_hash = await evaluated_proposal(world)
    api, who = builder(world), actor_for(SUPERVISOR)
    await api.approve(
        who,
        proposal_id,
        candidate_hash=candidate_hash,
        accept_yardstick_loosened=False,
        step_up_code=CODE,
    )

    first = await api.publish(who, proposal_id, idempotency_key="publish-0003", step_up_code=CODE)
    again = await api.publish(who, proposal_id, idempotency_key="publish-0003", step_up_code=CODE)

    assert again.release_id == first.release_id


async def test_unknown_ids_and_outages_are_translated(world: BuilderWorld) -> None:
    api, who = builder(world), actor_for(SUPERVISOR)
    with pytest.raises(RegistryNotFoundError):
        await api.get_proposal(who, "00000000-0000-7000-8000-999999999999")
    world.registry.unavailable = True
    with pytest.raises(AgentCoreUnavailableError):
        await api.create_proposal(who, agent_id=AGENT, title="Cambio")
    with pytest.raises(AgentCoreUnavailableError):
        await api.get_release(who, "rel-1")


async def test_only_administration_revokes_and_not_the_release_prod_points_at(
    world: BuilderWorld,
) -> None:
    proposal_id, candidate_hash = await evaluated_proposal(world)
    api, lucia, valeria = builder(world), actor_for(SUPERVISOR), actor_for(ADMIN_ONLY)
    await api.approve(
        lucia,
        proposal_id,
        candidate_hash=candidate_hash,
        accept_yardstick_loosened=False,
        step_up_code=CODE,
    )
    release = await api.publish(
        lucia, proposal_id, idempotency_key="publish-0004", step_up_code=CODE
    )

    with pytest.raises(ForbiddenError):  # a supervisor never reaches the registry's admin
        await api.revoke(lucia, release.release_id, reason="Error", step_up_code=CODE)
    assert calls(world, "revoke") == []
    revoked = await api.revoke(valeria, release.release_id, reason="Error", step_up_code=CODE)
    assert revoked.status == "revoked"
    principal = calls(world, "revoke")[0].principal
    assert "admin" in principal["roles"]
    assert principal["auth"]["level"] == "step_up"


# ----------------------------------------------------------------------------- the list
async def test_the_list_remembers_what_the_platform_made_and_refreshes_it(
    world: BuilderWorld,
) -> None:
    api, who = builder(world), actor_for(SUPERVISOR)
    first = await api.create_proposal(who, agent_id=AGENT, title="Uno")
    second = await api.create_proposal(who, agent_id="consultas", title="Dos")

    listed = await api.list_proposals(who)

    assert listed.registry_listed is True
    assert [p.proposal_id for p in listed.items] == [second.proposal_id, first.proposal_id]
    assert all(p.live and p.source == "platform" and p.registered_by == LUCIA for p in listed.items)
    only = await api.list_proposals(who, agent_id="consultas")
    assert [p.proposal_id for p in only.items] == [second.proposal_id]

    # the registry moves on without the platform (the builder chat saves a draft)...
    await world.registry.put_draft(
        builder(world)._credentials(who),
        proposal_id=first.proposal_id,
        expected_rev=0,
        changes=[draft()],
    )
    refreshed = {p.proposal_id: p for p in (await api.list_proposals(who)).items}
    assert refreshed[first.proposal_id].rev == 1
    # one call to agent-core's list refreshed every row: no read by id
    assert calls(world, "get_proposal") == []
    # ...and with the registry down the cached rows come back, marked as such
    world.registry.unavailable = True
    stale = await api.list_proposals(who)
    assert stale.registry_listed is False
    assert len(stale.items) == 2
    assert not any(p.live for p in stale.items)
    cached = await api.list_proposals(who, refresh=False)
    assert (cached.items[0].live, cached.registry_listed) == (False, False)


async def test_the_improvement_engine_s_proof_scratch_is_not_listed(world: BuilderWorld) -> None:
    """The engine proves a patch on throwaway evaluation drafts titled with a prefix.

    They are evidence, not deliverables: no supervisor should see, approve or publish one."""
    api, who = builder(world), actor_for(SUPERVISOR)
    real = await api.create_proposal(
        who, agent_id=AGENT, title="[improvement-engine] template:t/estado_pqr M4"
    )
    scratch = await api.create_proposal(
        who,
        agent_id=AGENT,
        title="[improvement-engine] [proof-scratch] evaluation base reg-1 - not a deliverable",
    )

    listed = await api.list_proposals(who)
    assert [p.proposal_id for p in listed.items] == [real.proposal_id]
    cached = await api.list_proposals(who, refresh=False)
    assert [p.proposal_id for p in cached.items] == [real.proposal_id]
    world.registry.unavailable = True  # the index read by id does not bring it back either
    assert [p.proposal_id for p in (await api.list_proposals(who)).items] == [real.proposal_id]
    world.registry.unavailable = False
    # still readable by its id (a link, the audit trail): hidden from the list, not erased
    assert (
        await api.get_proposal(who, scratch.proposal_id)
    ).proposal.proposal_id == scratch.proposal_id


async def test_the_list_reads_agent_core_as_the_person(world: BuilderWorld) -> None:
    await builder(world).list_proposals(actor_for(SUPERVISOR), agent_id=AGENT, state="draft")

    [call] = calls(world, "list_proposals")
    assert call.arguments == {"agent_id": AGENT, "state": "draft", "limit": 50, "offset": 0}
    assert (call.principal["id"], call.principal["auth"]["level"]) == (LUCIA, "session")


async def test_a_proposal_only_agent_core_has_is_listed_as_from_the_registry(
    world: BuilderWorld,
) -> None:
    api, who = builder(world), actor_for(SUPERVISOR)
    mine = await api.create_proposal(who, agent_id=AGENT, title="Desde la plataforma")
    orphan = world.registry.seed_proposal(agent_id="cobros", title="Del chat, sin id")

    listed = await api.list_proposals(who)

    by_id = {p.proposal_id: p for p in listed.items}
    assert [p.proposal_id for p in listed.items] == [orphan, mine.proposal_id]  # newest first
    assert (by_id[orphan].source, by_id[orphan].registered_by) == ("registry", None)
    assert (by_id[orphan].origin, by_id[orphan].created_by) == ("builder_chat", "constructor-bot")
    assert by_id[orphan].live is True
    assert by_id[mine.proposal_id].source == "platform"
    # listing does not adopt it: nothing joins the index, nothing is audited
    events = await builder_events(world.container)
    assert [e for e in events if e[0] == "builder.proposal_tracked"] == []
    cached = await api.list_proposals(who, refresh=False)
    assert [p.proposal_id for p in cached.items] == [mine.proposal_id]


async def test_the_filters_apply_to_both_and_follow_the_registry_state(
    world: BuilderWorld,
) -> None:
    api, who = builder(world), actor_for(SUPERVISOR)
    moved = await api.create_proposal(who, agent_id=AGENT, title="Se congela")
    await api.save_draft(who, moved.proposal_id, expected_rev=0, changes=[draft()])
    await api.list_proposals(who)  # the index caches it as a draft
    # the registry freezes it behind the platform's back
    await world.registry.freeze(builder(world)._credentials(who), proposal_id=moved.proposal_id)
    orphan = world.registry.seed_proposal(agent_id="cobros", title="Borrador del chat")

    drafts = await api.list_proposals(who, state="draft")
    candidates = await api.list_proposals(who, state="candidate")
    for_cobros = await api.list_proposals(who, agent_id="cobros")

    assert [p.proposal_id for p in drafts.items] == [orphan]  # not the cached draft any more
    assert [(p.proposal_id, p.state) for p in candidates.items] == [
        (moved.proposal_id, "candidate")
    ]
    assert [p.proposal_id for p in for_cobros.items] == [orphan]


async def test_without_agent_core_s_list_the_index_is_read_by_id(world: BuilderWorld) -> None:
    """An agent-core without the list call (before contract 1.4.0), or one whose list fails."""
    api, who = builder(world), actor_for(SUPERVISOR)
    mine = await api.create_proposal(who, agent_id=AGENT, title="Uno")
    world.registry.seed_proposal(agent_id="cobros", title="Del chat")
    world.registry.listing_failure = AgentRegistryError(status=404, code="not_found")

    listed = await api.list_proposals(who)

    assert listed.registry_listed is False
    assert [(p.proposal_id, p.live) for p in listed.items] == [(mine.proposal_id, True)]
    assert len(calls(world, "get_proposal")) == 1


async def test_who_brought_a_proposal_here_survives_the_merge(world: BuilderWorld) -> None:
    api, who = builder(world), actor_for(SUPERVISOR)
    engine = world.registry.seed_proposal(
        agent_id=AGENT, title="Del motor", created_by="engine", origin=ProposalOrigin.AUTO_DETECT
    )
    await api.announce_proposal(engine)
    chat = world.registry.seed_proposal(agent_id=AGENT, title="Del chat")
    await api.track_proposal(who, chat)

    listed = {p.proposal_id: p for p in (await api.list_proposals(who)).items}

    assert (listed[engine].source, listed[engine].registered_by) == ("engine", "engine")
    assert (listed[chat].source, listed[chat].registered_by) == ("tracked", LUCIA)


async def test_a_proposal_the_chat_made_is_tracked_once(world: BuilderWorld) -> None:
    api, who = builder(world), actor_for(SUPERVISOR)
    proposal_id = world.registry.seed_proposal(agent_id=AGENT, title="Del chat")
    [listed] = (await api.list_proposals(who)).items
    assert (listed.proposal_id, listed.source) == (proposal_id, "registry")

    tracked = await api.track_proposal(who, proposal_id)
    again = await api.track_proposal(who, proposal_id)

    assert (tracked.source, tracked.created_by) == ("tracked", "constructor-bot")
    assert again.proposal_id == proposal_id
    [now_listed] = (await api.list_proposals(who)).items
    assert (now_listed.source, now_listed.registered_by) == ("tracked", LUCIA)
    events = [
        e for e in await builder_events(world.container) if e[0] == "builder.proposal_tracked"
    ]
    assert len(events) == 1  # audited when it joined, not on every refresh
    with pytest.raises(RegistryNotFoundError):
        await api.track_proposal(who, "00000000-0000-7000-8000-888888888888")


async def test_agent_core_refuses_an_invalid_agent_id_or_a_long_title(world: BuilderWorld) -> None:
    """agent-core's ``Proposal``: ``agent_id`` ``^[a-z0-9][a-z0-9_/-]*$``, ``title`` 1-200."""
    api, who = builder(world), actor_for(SUPERVISOR)

    with pytest.raises(RegistryValidationFailedError):
        await api.create_proposal(who, agent_id="Quiero un agente para cobros", title="Uno")
    with pytest.raises(RegistryValidationFailedError):
        await api.create_proposal(who, agent_id="cobros", title="x" * 201)
    assert (await api.create_proposal(who, agent_id="cobros", title="x" * 200)).agent_id == "cobros"


async def test_operating_on_an_unknown_proposal_adds_it_to_the_list(world: BuilderWorld) -> None:
    api, who = builder(world), actor_for(SUPERVISOR)
    proposal_id = world.registry.seed_proposal(agent_id=AGENT, title="Del chat")

    await api.save_draft(who, proposal_id, expected_rev=0, changes=[draft()])

    [listed] = (await api.list_proposals(who)).items
    assert (listed.proposal_id, listed.source) == (proposal_id, "tracked")


# ----------------------------------------------------------------------------- the audit
async def test_every_operation_is_audited_with_ids_and_states_only(world: BuilderWorld) -> None:
    api, who = builder(world), actor_for(SUPERVISOR)
    secret_text, reason = "TEXTO-SECRETO-DEL-PROMPT", "RAZON-PRIVADA-DEL-RECHAZO"
    proposal = await api.create_proposal(who, agent_id=AGENT, title="TITULO-PRIVADO")
    changed = draft()
    await api.save_draft(
        who,
        proposal.proposal_id,
        expected_rev=0,
        changes=[
            type(changed)(changed.kind, {**changed.content, "text": secret_text}, changed.docs)
        ],
    )
    await api.validate(who, proposal.proposal_id)
    candidate = await api.freeze(who, proposal.proposal_id)
    await api.evaluate(who, proposal.proposal_id, suite_id="suite", suite_version=None)
    await api.reject(who, proposal.proposal_id, reason=reason, step_up_code=CODE)
    await api.save_draft(who, proposal.proposal_id, expected_rev=2, changes=[draft("1.2.0")])
    candidate = await api.freeze(who, proposal.proposal_id)
    await api.evaluate(who, proposal.proposal_id, suite_id="suite", suite_version=None)
    await api.approve(
        who,
        proposal.proposal_id,
        candidate_hash=candidate.candidate_hash,
        accept_yardstick_loosened=False,
        step_up_code=CODE,
    )
    release = await api.publish(
        who, proposal.proposal_id, idempotency_key="publish-0005", step_up_code=CODE
    )
    await api.promote(
        who, AGENT, "prod", release_id=release.release_id, reason=reason, step_up_code=CODE
    )

    events = await builder_events(world.container)

    assert [e[0] for e in events] == [
        "builder.proposal_created",
        "builder.draft_saved",
        "builder.proposal_validated",
        "builder.proposal_frozen",
        "builder.proposal_evaluated",
        "builder.proposal_rejected",
        "builder.draft_saved",
        "builder.proposal_frozen",
        "builder.proposal_evaluated",
        "builder.proposal_approved",
        "builder.proposal_published",
        "builder.alias_promoted",
    ]
    assert {e[2] for e in events} == {"supervisor"}
    dump = json.dumps([e[1] for e in events])
    for private in (secret_text, reason, "TITULO-PRIVADO"):
        assert private not in dump
    rejected = next(e for e in events if e[0] == "builder.proposal_rejected")
    assert rejected[1]["reason_length"] == len(reason)
    assert rejected[1]["step_up"] is True
    drafted = next(e for e in events if e[0] == "builder.draft_saved")
    assert (drafted[1]["agent_id"], drafted[1]["changes"], drafted[1]["kinds"]) == (
        AGENT,
        1,
        ["template"],
    )
    names = AuditNames()
    for event_type, payload, role, entity_id in events:
        stored = StoredEvent(
            sequence=1,
            event_id="EVT-" + "0" * 25 + "1",
            event_type=event_type,
            entity="builder",
            entity_id=entity_id,
            case_id=None,
            actor_role=role,
            actor_id=LUCIA,
            event_time=world.container.clock.now(),
            ingested_at=world.container.clock.now(),
            payload=payload,
        )
        assert describe(stored, names) != fallback_description(event_type), event_type


async def test_without_the_registry_there_is_no_builder(tmp_path: Path) -> None:
    async for built in builder_world("memory", tmp_path, with_registry=False):
        assert built.container.use_cases.assistant is not None
        assert built.container.use_cases.assistant.builder is None
