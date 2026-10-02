"""SLA policy (Strategy; synthetic policy values, labelled as such in the UI).

Chat (app/web, and inbound phone): ``high`` 30 min · ``medium`` 60 min · ``low`` 4 h from
``opened_at``; email 24 h; outbound follow-ups (origin regulator/branch) 48 h. "SLA x" is
formatted by the frontend from ``slaDueAt``.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime, timedelta
from typing import Protocol

from cc_platform.domain.cases.values import CaseChannel, CaseOrigin, CasePriority


class SlaPolicy(Protocol):
    def due_at(
        self,
        *,
        channel: CaseChannel,
        origin: CaseOrigin,
        priority: CasePriority,
        opened_at: datetime,
    ) -> datetime: ...


def _default_chat_targets() -> dict[CasePriority, timedelta]:
    return {
        CasePriority.HIGH: timedelta(minutes=30),
        CasePriority.MEDIUM: timedelta(minutes=60),
        CasePriority.LOW: timedelta(hours=4),
    }


@dataclass(frozen=True, slots=True)
class SyntheticSlaPolicy:
    chat: dict[CasePriority, timedelta] = field(default_factory=_default_chat_targets)
    email: timedelta = timedelta(hours=24)
    outbound: timedelta = timedelta(hours=48)

    def due_at(
        self,
        *,
        channel: CaseChannel,
        origin: CaseOrigin,
        priority: CasePriority,
        opened_at: datetime,
    ) -> datetime:
        if origin.is_outbound:
            return opened_at + self.outbound
        if channel is CaseChannel.EMAIL:
            return opened_at + self.email
        return opened_at + self.chat[priority]
