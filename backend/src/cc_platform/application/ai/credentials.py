"""``AgentCredentialIssuer``: the platform signs who is calling ``agent-core`` (ADR 0003 §2).

agent-core trusts only credentials signed with keys it was given (``--identity-keys``,
``--staff-keys``). The platform is the identity issuer and the assignment issuer (the one that
signs a delegation when a case is assigned, agent-core ADR 0006).

What a call carries is derived here from who is acting, never from a request body:

====================  ======================================================================
Platform actor        agent-core credential
====================  ======================================================================
customer session      ``customer`` principal; ``id`` is the dataset ``customer_id``
analyst on a case     ``advisor`` principal + a delegation (``X-On-Behalf-Of``) on that customer
supervision, admin    ``builder`` principal (``constructor``/``aprobador``, plus ``admin``)
====================  ======================================================================
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from typing import Protocol


@dataclass(frozen=True, slots=True)
class AgentCredentials:
    """The two headers of a call: ``Authorization`` and, for advisors only, ``X-On-Behalf-Of``."""

    authorization: str
    on_behalf_of: str | None = None

    def __repr__(self) -> str:  # never print a credential into a log or a traceback
        return "AgentCredentials(<redacted>)"


@dataclass(frozen=True, slots=True)
class BuilderIdentity:
    """A person acting on the registry. ``step_up`` is True only after a fresh second factor."""

    staff_id: str
    constructor: bool = True
    approver: bool = False
    admin: bool = False
    step_up: bool = False


class AgentCredentialIssuer(Protocol):
    def customer(
        self,
        *,
        bank_customer_id: str,
        session_id: str,
        step_up_at: datetime | None = None,
    ) -> AgentCredentials:
        """A customer's own credential. ``bank_customer_id`` is the dataset's ``customer_id``.

        With ``step_up_at`` (when the customer passed the second factor) the credential is
        elevated to ``step_up``. The second factor is simulated for now, so the credential
        says so (``auth.simulated``) until a real one exists."""
        ...

    def advisor(
        self, *, staff_id: str, bank_customer_id: str, grant_ref: str, expires_at: datetime
    ) -> AgentCredentials:
        """An analyst's credential plus a delegation tied to her (``grantee``) and one customer."""
        ...

    def builder(self, identity: BuilderIdentity) -> AgentCredentials:
        """A supervisor's or administrator's credential for the registry and the builder agent."""
        ...
