"""Event log export — AI extension point for learning and evaluation.

Exports the append-only event log in the ``platform_history`` shape with the contract's
privacy guarantees: ``customer_id`` pseudonymised, free text with personal data masked,
original text kept only inside the platform. Consumers must filter by ``event_time`` (not
``ingested_at``) to avoid leakage when building training or evaluation sets.
"""

from __future__ import annotations

from collections.abc import AsyncIterator
from dataclasses import dataclass
from datetime import datetime
from typing import Protocol

from cc_platform.domain.shared.json import JsonObject


@dataclass(frozen=True, slots=True)
class ExportWindow:
    event_time_from: datetime
    event_time_to: datetime
    entities: tuple[str, ...] = ()
    """Restrict to contract entities (``turn``, ``tool_call``…); empty means all."""


class EventExporter(Protocol):
    def export(self, window: ExportWindow) -> AsyncIterator[JsonObject]:
        """Yield masked, pseudonymised rows in ``event_time`` order."""
        ...
