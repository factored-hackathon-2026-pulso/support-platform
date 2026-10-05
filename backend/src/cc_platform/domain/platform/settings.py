"""``PlatformSettings`` (slice 18, ADR 0005): the platform-wide switches Administración owns.

A singleton aggregate (``id = "default"``, like ``AdminRoster``) saved with its
compare-and-set ``version``. Today it holds one switch, the AI functions ("Funciones de IA"):
off, the platform behaves exactly as it did before AI (people only); on, the AI layer may act
where agent-core is configured. The row does not exist until the first change: until then the
deployment default (``CC_AI_ENABLED``) applies.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime

from cc_platform.domain.platform.events import PlatformAiToggled
from cc_platform.domain.shared.actor import ActorRef
from cc_platform.domain.shared.aggregate import AggregateRoot

SETTINGS_ID = "default"


@dataclass(eq=False)
class PlatformSettings(AggregateRoot):
    ai_enabled: bool
    id: str = SETTINGS_ID
    updated_at: datetime | None = None
    """When someone last changed a switch (``None``: the deployment default applies)."""
    updated_by_id: str | None = None

    def set_ai_enabled(self, *, enabled: bool, actor: ActorRef, at: datetime) -> bool:
        """Turn the AI functions on or off. The same value is a no-op (False, no event);
        otherwise records ``platform.ai_toggled`` ``{enabled}``."""
        if enabled is self.ai_enabled:
            return False
        self.ai_enabled = enabled
        self.updated_at = at
        self.updated_by_id = actor.actor_id
        self._record(
            PlatformAiToggled(occurred_at=at, actor=actor, entity_id=self.id, enabled=enabled)
        )
        return True
