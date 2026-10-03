"""Application errors of the cases context."""

from __future__ import annotations

from cc_platform.application.errors import ApplicationError


class CaseNotAssignedError(ApplicationError):
    """The case exists but the caller may not see it (read) or is not its assignee (write)."""

    code = "case_not_assigned"
    default_message = "No tienes acceso a este caso."
