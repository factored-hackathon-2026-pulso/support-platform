"""Application errors of the cases context."""

from __future__ import annotations

from cc_platform.application.errors import ApplicationError


class CaseNotAssignedError(ApplicationError):
    """The case exists but the caller is not its assignee (nor a supervisor reading it)."""

    code = "case_not_assigned"
    default_message = "Este caso no está asignado a ti."
