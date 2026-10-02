"""Who performed an action.

``ActorRole`` is the vocabulary of ``actor_role`` / ``author_role`` in
``contracts/platform_history.json``: staff roles, the customer, automated tiers
(judge, tree, ai_agent, copilot) and the platform itself (system).
"""

from __future__ import annotations

from dataclasses import dataclass
from enum import StrEnum

from cc_platform.domain.shared.errors import InvalidValueError


class ActorRole(StrEnum):
    ANALYST = "analyst"
    SUPERVISOR = "supervisor"
    AUTOMATION = "automation"
    ADMIN = "admin"
    CUSTOMER = "customer"
    JUDGE = "judge"
    TREE = "tree"
    AI_AGENT = "ai_agent"
    COPILOT = "copilot"
    SYSTEM = "system"


@dataclass(frozen=True, slots=True)
class ActorRef:
    """Reference to the actor of a domain event (role under which they acted + id).

    For people ``actor_id`` is the staff or customer id; for automated components it is
    ``component_id@component_version`` as the contract requires.
    """

    role: ActorRole
    actor_id: str

    def __post_init__(self) -> None:
        if not self.actor_id.strip():
            raise InvalidValueError("actor id must not be empty", field="actor_id")

    @classmethod
    def system(cls) -> ActorRef:
        return cls(role=ActorRole.SYSTEM, actor_id="cc-platform")
