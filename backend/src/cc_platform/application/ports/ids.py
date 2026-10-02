"""Id generator port (see ``cc_platform.domain.shared.ids`` for the id format)."""

from __future__ import annotations

from typing import Protocol

from cc_platform.domain.shared.ids import IdPrefix


class IdGenerator(Protocol):
    def new_id(self, prefix: IdPrefix) -> str:
        """Return a new, unique, prefixed opaque id (``CASE-01J…``)."""
        ...
