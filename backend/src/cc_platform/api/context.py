"""What the HTTP/WebSocket layer is allowed to use (``ApiContext``).

The composition root (``cc_platform.bootstrap``) builds one ``ApiContext`` and stores it on
``app.state``; routers read it through ``cc_platform.api.dependencies``. It holds use cases
and a few application-level services only: no repositories or Unit of Work, no security
adapters (hasher, token service, MFA provider), no settings object. Routers therefore reach
the domain exclusively through use cases, and ``api`` never imports ``bootstrap``
(enforced by ``tests/test_architecture.py``).
"""

from __future__ import annotations

from collections.abc import Sequence
from dataclasses import dataclass
from datetime import timedelta

from cc_platform.application.ports.clock import Clock
from cc_platform.application.ports.health import HealthProbe, ReadinessProbe
from cc_platform.application.ports.ids import IdGenerator
from cc_platform.application.ports.realtime import RealtimeHub
from cc_platform.application.realtime.topics import TopicAccessPolicy
from cc_platform.application.use_cases import UseCases


@dataclass(frozen=True, slots=True)
class BuildInfo:
    """Shown by ``GET /api/v1/meta``."""

    build: str
    environment: str
    #: Part 4: the dev mailbox is on (``GET /dev/mailbox``); the SPA then links to it.
    dev_mailbox: bool = False


@dataclass(frozen=True, slots=True)
class RealtimeOptions:
    #: How often an idle socket re-checks its session expiry against the ``Clock``.
    expiry_check_interval: timedelta = timedelta(seconds=30)
    #: How often an idle socket gets a ``heartbeat`` envelope; ``None`` = never.
    heartbeat_interval: timedelta | None = None


@dataclass(frozen=True, slots=True)
class ReadinessOptions:
    """``GET /readyz``: the dependencies to check and how long each may take."""

    probes: Sequence[ReadinessProbe] = ()
    timeout_seconds: float = 2.0


@dataclass(frozen=True, slots=True)
class ApiContext:
    use_cases: UseCases
    clock: Clock
    ids: IdGenerator
    realtime_hub: RealtimeHub
    topic_access: TopicAccessPolicy
    health_probes: Sequence[HealthProbe]
    build_info: BuildInfo
    realtime: RealtimeOptions = RealtimeOptions()
    #: ``CC_INTERNAL_SERVICE_TOKEN``: unlocks the service-to-service routes (``/internal``).
    internal_token: str | None = None
    readiness: ReadinessOptions = ReadinessOptions()
