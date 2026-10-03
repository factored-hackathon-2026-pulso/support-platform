"""Id generator adapters."""

from __future__ import annotations

import secrets
import threading
from collections import defaultdict

from cc_platform.application.ports.clock import Clock
from cc_platform.domain.shared.ids import BODY_LENGTH, IdPrefix, encode_body, make_id

_RANDOM_BITS = 80


class UlidIdGenerator:
    """Time-ordered ids (ULID layout). Monotonic within the same millisecond."""

    def __init__(self, clock: Clock) -> None:
        self._clock = clock
        self._lock = threading.Lock()
        self._last_ms = -1
        self._last_random = 0

    def new_id(self, prefix: IdPrefix) -> str:
        timestamp_ms = int(self._clock.now().timestamp() * 1000)
        with self._lock:
            if timestamp_ms <= self._last_ms:
                timestamp_ms = self._last_ms
                randomness = self._last_random + 1
                if randomness >= 1 << _RANDOM_BITS:  # pragma: no cover - 2^80 ids per ms
                    timestamp_ms += 1
                    randomness = secrets.randbits(_RANDOM_BITS - 1)
            else:
                randomness = secrets.randbits(_RANDOM_BITS - 1)
            self._last_ms = timestamp_ms
            self._last_random = randomness
        return make_id(prefix, encode_body(timestamp_ms, randomness))


#: Seeded people and teams use the low numbers (``STF-…01``–``13``, ``TEAM-…01``–``04``);
#: generated ones start above them so a test can create people and teams over the seed.
_FIRST_SEQUENTIAL: dict[IdPrefix, int] = {IdPrefix.STAFF: 1000, IdPrefix.TEAM: 1000}


class SequentialIdGenerator:
    """Readable deterministic ids for tests: ``CASE-00000000000000000000000001``
    (``STF-…1001`` and ``TEAM-…1001`` onwards, above the seeded ones)."""

    def __init__(self) -> None:
        self._counters: defaultdict[IdPrefix, int] = defaultdict(int, _FIRST_SEQUENTIAL)
        self._lock = threading.Lock()

    def new_id(self, prefix: IdPrefix) -> str:
        with self._lock:
            self._counters[prefix] += 1
            value = self._counters[prefix]
        return make_id(prefix, str(value).zfill(BODY_LENGTH))
