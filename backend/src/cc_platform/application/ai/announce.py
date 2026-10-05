"""ADR 0007: the improvement engine announces a proposal it created in agent-core.

Two steps, both idempotent, neither of which decides anything:

1. the proposal joins the builder list (``AgentBuilder.announce_proposal``: the registry confirms
   it, the platform adds it once and audits it once as ``builder.proposal_tracked`` by the
   ``engine``);
2. every active Supervisión person gets an ``improvement_proposed`` notification carrying the
   engine's dossier summary. The notification's idempotency key is the proposal id, so replaying
   the announcement (or a retry after a failure between the two steps) never notifies twice.

A supervisor still approves or rejects in the builder with a fresh authenticator code (ADR 0003).
"""

from __future__ import annotations

from dataclasses import dataclass

from cc_platform.application.ai.builder import AgentBuilder, ProposalSummary
from cc_platform.application.notifications.projector import active_with_role
from cc_platform.application.notifications.writer import NotificationDraft, NotificationWriter
from cc_platform.application.ports.clock import Clock
from cc_platform.application.ports.unit_of_work import UnitOfWorkFactory
from cc_platform.domain.notifications.notification import ImprovementDossier, NotificationKind
from cc_platform.domain.people.staff import StaffRole

#: ``source_key`` prefix of the notification: unique per recipient, keyed by the proposal.
SOURCE_KEY_PREFIX = "improve:"


@dataclass(frozen=True, slots=True)
class AnnounceImprovement:
    uow: UnitOfWorkFactory
    clock: Clock
    builder: AgentBuilder
    writer: NotificationWriter

    async def execute(self, proposal_id: str, dossier: ImprovementDossier) -> ProposalSummary:
        summary = await self.builder.announce_proposal(proposal_id)
        async with self.uow() as uow:
            recipients = await active_with_role(uow, StaffRole.SUPERVISOR)
        await self.writer.write(
            [
                NotificationDraft(
                    kind=NotificationKind.IMPROVEMENT_PROPOSED,
                    recipients=recipients,
                    created_at=self.clock.now(),
                    source_key=f"{SOURCE_KEY_PREFIX}{proposal_id}",
                    actor_id=None,
                    proposal_id=summary.proposal_id,
                    agent_id=summary.agent_id,
                    improvement=dossier,
                )
            ]
        )
        return summary
