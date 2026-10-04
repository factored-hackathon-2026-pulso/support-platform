"""Who the assistant (agent-core) serves, and with which agent (ADR 0003)."""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import timedelta

from cc_platform.application.ports.unit_of_work import UnitOfWork
from cc_platform.domain.cases.values import CaseChannel
from cc_platform.domain.customers.customer import Customer
from cc_platform.domain.people.staff import Language


@dataclass(frozen=True, slots=True)
class AssistantConfig:
    """Behaviour settings of the assistant (``CC_ASSISTANT_*``)."""

    entry_agent: str = "recepcion@prod"
    """Agent a conversation starts with (``id``, ``id@alias`` or ``id@X.Y.Z``)."""
    languages: frozenset[Language] = field(default_factory=lambda: frozenset({Language.SPANISH}))
    """Case languages the assistant handles. Anything else goes straight to people (policy
    ``H1`` says a person serves Portuguese until the agent's language switch is real)."""
    step_up_code: str = "000000"
    """The simulated second factor (a development stand-in until a real one exists)."""
    claim_timeout: timedelta = timedelta(minutes=2)
    """A claimed input older than this is taken over (the job that held it died)."""
    max_agent_rounds: int = 20
    """Inputs one job sends before it stops (a runaway guard)."""


@dataclass(frozen=True, slots=True)
class AssistantGate:
    """Decides whether a new case opens in the agent's hands: it must be a chat, the customer
    must be a known dataset customer and the case language one the assistant serves."""

    config: AssistantConfig

    async def agent_for(
        self, uow: UnitOfWork, customer: Customer, channel: CaseChannel
    ) -> str | None:
        if not channel.is_chat:
            return None  # calls and emails are people's (agent-core answers chat turns only)
        if customer.language not in self.config.languages:
            return None
        if await uow.bank_links.get(customer.id) is None:
            return None
        return self.config.entry_agent
