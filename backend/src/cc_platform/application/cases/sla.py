"""First-response SLA (Strategy ``SlaPolicy``; slice 2 contract §4.5).

``sla_due_at = opened_at + target(priority)``. Team-generated targets (not from the
dataset; the UI labels them "Política de ejemplo"): ``high`` 5 min · ``medium`` 15 min ·
``low`` 60 min. The SLA stops at the first analyst message (``case.first_responded``); the
frontend formats "SLA x" from ``slaDueAt`` while ``firstResponseAt`` is null.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime, timedelta
from typing import Protocol

from cc_platform.domain.cases.values import CasePriority


class SlaPolicy(Protocol):
    def due_at(self, *, priority: CasePriority, opened_at: datetime) -> datetime:
        """When the first response is due for a case opened at ``opened_at``."""
        ...


def _team_generated_targets() -> dict[CasePriority, timedelta]:
    return {
        CasePriority.HIGH: timedelta(minutes=5),
        CasePriority.MEDIUM: timedelta(minutes=15),
        CasePriority.LOW: timedelta(minutes=60),
    }


@dataclass(frozen=True, slots=True)
class FirstResponseSlaPolicy:
    targets: dict[CasePriority, timedelta] = field(default_factory=_team_generated_targets)

    def due_at(self, *, priority: CasePriority, opened_at: datetime) -> datetime:
        return opened_at + self.targets[priority]
