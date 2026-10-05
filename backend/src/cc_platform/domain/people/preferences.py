"""``StaffPreferences``: a person's own settings of the platform (slice 23: the UI language).

Kept apart from ``Staff`` on purpose: administration edits ``Staff`` with an expected version,
and a person changing her own language must never make an administrator's edit stale. A
missing row means the defaults (``UiLanguage.SPANISH``). The server reads it too: the texts it
renders for a person (notifications, emails, problem details) follow it in a later phase.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from enum import StrEnum

from cc_platform.domain.people.events import StaffUiLanguageChanged
from cc_platform.domain.shared.actor import ActorRef
from cc_platform.domain.shared.aggregate import AggregateRoot
from cc_platform.domain.shared.ids import IdPrefix, require_id


class UiLanguage(StrEnum):
    """Languages of the platform UI (BCP 47 tags, as the browser and ``Intl`` use them).

    Not the same set as ``Language`` (what a person speaks with customers: ``es`` | ``pt``).
    """

    SPANISH = "es"
    PORTUGUESE_BRAZIL = "pt-BR"


DEFAULT_UI_LANGUAGE = UiLanguage.SPANISH


@dataclass(eq=False)
class StaffPreferences(AggregateRoot):
    staff_id: str
    ui_language: UiLanguage = DEFAULT_UI_LANGUAGE

    def __post_init__(self) -> None:
        require_id(self.staff_id, IdPrefix.STAFF)

    @classmethod
    def default(cls, staff_id: str) -> StaffPreferences:
        return cls(staff_id=staff_id)

    def set_ui_language(self, language: UiLanguage, *, now: datetime, actor: ActorRef) -> bool:
        """Change the UI language; ``False`` (nothing recorded) when it is already ``language``."""
        if language is self.ui_language:
            return False
        previous = self.ui_language
        self.ui_language = language
        self._record(
            StaffUiLanguageChanged(
                occurred_at=now,
                actor=actor,
                entity_id=self.staff_id,
                from_language=previous.value,
                to_language=language.value,
            )
        )
        return True
