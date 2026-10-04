"""Errors of the cases context (stable codes registered in ``api/problems.py``)."""

from __future__ import annotations

from cc_platform.domain.cases.values import LANGUAGE_RULE_ID, CaseStatus
from cc_platform.domain.shared.errors import ConflictError, DomainError, InvalidTransitionError


class CaseClosedError(ConflictError):
    """The case is closed: nothing can be written to it any more (409)."""

    code = "case_closed"
    default_message = "Este caso ya está cerrado."

    def __init__(self) -> None:
        super().__init__(None, currentStatus=CaseStatus.CLOSED.value)


class CaseNotClosedError(ConflictError):
    """Only a closed case can be rated (409, slice 7)."""

    code = "case_not_closed"
    default_message = "Solo se puede calificar una conversación terminada."

    def __init__(self, current: CaseStatus) -> None:
        super().__init__(None, currentStatus=current.value)


class AlreadyRatedError(ConflictError):
    """The case already has its rating: a customer rates a case once (409, slice 7)."""

    code = "already_rated"
    default_message = "Esta conversación ya tiene una calificación."


class IdempotencyConflictError(ConflictError):
    """The same ``clientMessageId`` was already used with another text (409)."""

    code = "idempotency_conflict"
    default_message = "Ese mensaje ya se envió con otro texto."


class LanguageMismatchError(DomainError):
    """Rule 3 (``H1``): the analyst does not speak the case language (422)."""

    code = "language_mismatch"
    default_message = "Ese caso necesita a alguien que hable su idioma (regla 3)."

    def __init__(self, *, case_language: str, analyst_id: str) -> None:
        super().__init__(
            None, policyRuleId=LANGUAGE_RULE_ID, caseLanguage=case_language, analystId=analyst_id
        )


class EscalationOpenError(ConflictError):
    """The case already has an open escalation: one at a time (409, slice 9)."""

    code = "escalation_open"
    default_message = "Este caso ya está escalado a supervisión."

    def __init__(self, escalation_id: str) -> None:
        super().__init__(None, escalationId=escalation_id)


class EscalationNotOpenError(ConflictError):
    """The escalation was already withdrawn, answered or otherwise ended (409, slice 9)."""

    code = "escalation_not_open"
    default_message = "Este escalamiento ya no está abierto."

    def __init__(self, current_state: str) -> None:
        super().__init__(None, currentState=current_state)


class CallInProgressError(ConflictError):
    """The case already has an active call: one call at a time, and a case is not closed
    while its call is still ringing or connected (409, slice 12)."""

    code = "call_in_progress"
    default_message = "Este caso tiene una llamada en curso."

    def __init__(self, call_id: str) -> None:
        super().__init__(None, callId=call_id)


class CallNotActiveError(ConflictError):
    """The call already ended: nothing more happens on it (409, slice 12)."""

    code = "call_not_active"
    default_message = "Esta llamada ya terminó."

    def __init__(self, current_state: str) -> None:
        super().__init__(None, currentState=current_state)


def invalid_case_transition(current: CaseStatus, target: str) -> InvalidTransitionError:
    return InvalidTransitionError(
        f"Un caso en estado {current.value} no puede pasar a {target}.",
        currentStatus=current.value,
    )
