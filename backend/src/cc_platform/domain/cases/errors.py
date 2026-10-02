"""Errors of the cases context (stable codes registered in ``api/problems.py``)."""

from __future__ import annotations

from cc_platform.domain.cases.values import CaseStatus
from cc_platform.domain.shared.errors import ConflictError, InvalidTransitionError


class CaseClosedError(ConflictError):
    """The case is closed: nothing can be written to it any more (409)."""

    code = "case_closed"
    default_message = "Este caso ya está cerrado."

    def __init__(self) -> None:
        super().__init__(None, currentStatus=CaseStatus.CLOSED.value)


class ChannelNotSupportedError(ConflictError):
    """Only chat channels work live in slice 1; phone and email are read-only (409)."""

    code = "channel_not_supported"
    default_message = "Por ahora solo puedes escribir en casos de chat."

    def __init__(self, channel: str) -> None:
        super().__init__(None, channel=channel)


class IdempotencyConflictError(ConflictError):
    """The same ``clientMessageId`` was already used with another text (409)."""

    code = "idempotency_conflict"
    default_message = "Ese mensaje ya se envió con otro texto."


def invalid_case_transition(current: CaseStatus, target: str) -> InvalidTransitionError:
    return InvalidTransitionError(
        f"Un caso en estado {current.value} no puede pasar a {target}.",
        currentStatus=current.value,
    )
