"""JSON value typing and normalisation for event payloads and error details."""

from __future__ import annotations

from collections.abc import Mapping
from datetime import UTC, datetime
from enum import Enum

type JsonScalar = str | int | float | bool | None
type JsonValue = JsonScalar | list[JsonValue] | dict[str, JsonValue]
type JsonObject = dict[str, JsonValue]


def iso_utc(value: datetime) -> str:
    """ISO-8601 in UTC with a ``Z`` suffix (same format Pydantic uses in API responses)."""
    if value.tzinfo is None:
        raise ValueError("naive datetimes are not allowed; use timezone-aware UTC")
    return value.astimezone(UTC).isoformat().replace("+00:00", "Z")


def to_json_value(value: object) -> JsonValue:
    """Convert common domain values to JSON-safe values.

    Datetimes become ISO-8601 strings, enums their value, sets/tuples sorted/plain lists and
    mappings plain dicts. Unsupported objects raise ``TypeError`` so payload bugs surface
    in tests instead of producing ``repr`` garbage in the event log.
    """
    if value is None or isinstance(value, bool | int | float | str):
        return value
    if isinstance(value, Enum):
        return to_json_value(value.value)
    if isinstance(value, datetime):
        return iso_utc(value)
    if isinstance(value, frozenset | set):
        return sorted((to_json_value(item) for item in value), key=_sort_key)
    if isinstance(value, list | tuple):
        return [to_json_value(item) for item in value]
    if isinstance(value, Mapping):
        return {str(key): to_json_value(item) for key, item in value.items()}
    raise TypeError(f"value of type {type(value).__name__} is not JSON serialisable")


def _sort_key(value: JsonValue) -> str:
    return str(value)
