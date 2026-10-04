"""First-response SLA (Strategy ``SlaPolicy``; slice 2 contract §4.5, slice 8).

``sla_due_at = opened_at + target``: one fixed, team-generated target for every case (not
from the dataset; the UI labels it "Política de ejemplo"): 15 minutes. Since slice 8 the
priority no longer drives it (a case opens with priority ``none`` and staff set it later,
which must not move a promise already made). The SLA stops at the first analyst message
(``case.first_responded``); the frontend shows its level from ``slaDueAt`` while
``firstResponseAt`` is null.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timedelta
from typing import Protocol

#: Team-generated first-response target, the same for every case.
FIRST_RESPONSE_TARGET = timedelta(minutes=15)


class SlaPolicy(Protocol):
    def due_at(self, *, opened_at: datetime) -> datetime:
        """When the first response is due for a case opened at ``opened_at``."""
        ...


@dataclass(frozen=True, slots=True)
class FirstResponseSlaPolicy:
    target: timedelta = FIRST_RESPONSE_TARGET

    def due_at(self, *, opened_at: datetime) -> datetime:
        return opened_at + self.target
