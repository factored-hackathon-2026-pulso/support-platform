"""Application errors of the cases context."""

from __future__ import annotations

from cc_platform.application.errors import ApplicationError


class CaseNotAssignedError(ApplicationError):
    """The case exists but the caller may not see it (read) or is not its assignee (write)."""

    code = "case_not_assigned"
    default_message = "No tienes acceso a este caso."


class AnalystNotEligibleError(ApplicationError):
    """Manual assignment: the target is unknown, inactive or not an analyst (422)."""

    code = "analyst_not_eligible"
    default_message = "Esa persona no puede recibir casos."

    def __init__(self, analyst_id: str) -> None:
        super().__init__(None, analystId=analyst_id)


class AnalystPausedError(ApplicationError):
    """Manual assignment to a paused analyst without ``confirmPaused`` (409)."""

    code = "analyst_paused"
    default_message = "Esa persona está en pausa. Confirma para asignarle el caso igual."

    def __init__(self, analyst_id: str) -> None:
        super().__init__(None, analystId=analyst_id)


class AssignmentChangedError(ApplicationError):
    """The case changed hands since the supervisor looked at it (409).

    ``currentAnalystId`` is who holds it now (``null`` = it is queued).
    """

    code = "assignment_changed"
    default_message = "El caso cambió de manos mientras decidías."

    def __init__(self, current_analyst_id: str | None) -> None:
        super().__init__(None, currentAnalystId=current_analyst_id)
