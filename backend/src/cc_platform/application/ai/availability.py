"""Whether the Core (agent-core) can be called right now (deploy brief P4, degraded mode).

The infrastructure's circuit breaker (``infrastructure/core/resilience.py``) answers it: after
several consecutive failures the Core is taken as down for a while and every call fails at once,
without waiting for a timeout. The application uses the answer to degrade on purpose instead of
failing call by call:

- a new chat goes straight to people (``AssistantGate``);
- the copilot's automatic suggestions are not even attempted (``WhileCoreAvailable``);
- ``/readyz`` reports the Core as ``degraded`` (``CoreStatusCheck``), never as fatal.
"""

from __future__ import annotations

from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from typing import Literal, Protocol

from cc_platform.application.events import EventRecord

#: The Core's state for readiness: ``degraded`` = down, or its breaker is open.
type CoreStatus = Literal["ok", "degraded"]
#: ``await check()`` → the Core's state. Fast, never raises (``ApiContext.core_status``).
type CoreStatusCheck = Callable[[], Awaitable[CoreStatus]]


class CoreAvailability(Protocol):
    def is_available(self) -> bool:
        """False while the Core is known to be down (its circuit breaker is open). Cheap: no
        network call."""
        ...


async def core_status_unknown() -> CoreStatus:
    """The check of a platform without a Core (``CC_AGENT_CORE_URL`` unset): nothing to wait for,
    the platform is people-only by configuration."""
    return "ok"


@dataclass(frozen=True, slots=True)
class WhileCoreAvailable:
    """A bus subscriber that forwards events only while the Core is available: background AI work
    (the copilot's automatic suggestions) is skipped while the Core is down, so the panels stay
    quiet instead of filling with failed attempts."""

    core: CoreAvailability
    subscriber: Callable[[EventRecord], Awaitable[None]]

    async def __call__(self, record: EventRecord) -> None:
        if self.core.is_available():
            await self.subscriber(record)
