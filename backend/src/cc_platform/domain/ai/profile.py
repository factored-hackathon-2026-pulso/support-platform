"""``AgentProfile``: what Supervisión sets for an agent itself, by its agent-core id (``cobros``),
so it can be chosen while the agent is still being reviewed, before it serves any case type.

Today that is its photo (avatar). The row appears the first time a photo is picked. When the
agent serves a type, the type shows this photo (``CaseTypeMaturity.agent_avatar`` is its copy).
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime

from cc_platform.domain.ai.maturity import AGENT_AVATARS
from cc_platform.domain.ai.maturity_events import AgentAvatarChosen
from cc_platform.domain.shared.actor import ActorRef
from cc_platform.domain.shared.aggregate import AggregateRoot
from cc_platform.domain.shared.errors import InvalidValueError


@dataclass(eq=False)
class AgentProfile(AggregateRoot):
    agent_id: str
    avatar: str | None = None

    def choose_avatar(
        self, avatar: str, *, actor: ActorRef, at: datetime, announce: bool = True
    ) -> bool:
        """Pick the photo. False: it already was. ``announce`` False: the type that serves the
        agent records the change (``ai.agent_avatar_set``), so this one stays silent."""
        if avatar not in AGENT_AVATARS:
            raise InvalidValueError("Unknown agent avatar.", field="avatar")
        if avatar == self.avatar:
            return False
        self.avatar = avatar
        if announce:
            self._record(
                AgentAvatarChosen(
                    occurred_at=at,
                    actor=actor,
                    entity_id=self.agent_id,
                    agent_id=self.agent_id,
                    avatar=avatar,
                )
            )
        return True
