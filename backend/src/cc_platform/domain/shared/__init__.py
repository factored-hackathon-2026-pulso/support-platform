"""Shared kernel: ids, actors, events, errors and JSON helpers used by every context."""

from cc_platform.domain.shared.actor import ActorRef, ActorRole
from cc_platform.domain.shared.aggregate import AggregateRoot
from cc_platform.domain.shared.errors import (
    ConcurrentUpdateError,
    ConflictError,
    DomainError,
    InvalidTransitionError,
    InvalidValueError,
    NotFoundError,
    PolicyViolationError,
)
from cc_platform.domain.shared.events import DomainEvent
from cc_platform.domain.shared.ids import IdPrefix, is_valid_id, make_id, prefix_of, require_id
from cc_platform.domain.shared.json import JsonObject, JsonValue, iso_utc, to_json_value

__all__ = [
    "ActorRef",
    "ActorRole",
    "AggregateRoot",
    "ConcurrentUpdateError",
    "ConflictError",
    "DomainError",
    "DomainEvent",
    "IdPrefix",
    "InvalidTransitionError",
    "InvalidValueError",
    "JsonObject",
    "JsonValue",
    "NotFoundError",
    "PolicyViolationError",
    "is_valid_id",
    "iso_utc",
    "make_id",
    "prefix_of",
    "require_id",
    "to_json_value",
]
