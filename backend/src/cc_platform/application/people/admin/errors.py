"""Errors of the administration use cases (slice 4 §8; codes registered in ``api/problems.py``)."""

from __future__ import annotations

from collections.abc import Sequence

from cc_platform.application.errors import ApplicationError
from cc_platform.application.people.admin.dto import OpenCasesBlock, SelfChangeAction
from cc_platform.domain.people.staff import Language
from cc_platform.domain.shared.json import JsonValue

#: At most this many case ids travel in ``staff_has_open_cases.caseIds``.
MAX_BLOCKING_CASE_IDS = 20


class SelfChangeForbiddenError(ApplicationError):
    """Nobody removes her own Administración, deactivates herself or resets her own password."""

    code = "self_change_forbidden"
    default_message = "No puedes hacer ese cambio sobre tu propia cuenta."

    def __init__(self, action: SelfChangeAction) -> None:
        super().__init__(None, action=action.value)
        self.action = action


class StaffHasOpenCasesError(ApplicationError):
    """The change would leave open cases with someone who can no longer hold them (§3.6):
    supervision has to reassign them first."""

    code = "staff_has_open_cases"
    default_message = (
        "Tiene casos abiertos. Supervisión tiene que reasignarlos antes de este cambio."
    )

    def __init__(
        self,
        block_reason: OpenCasesBlock,
        case_ids: Sequence[str],
        *,
        case_language: Language | None = None,
    ) -> None:
        ids: list[JsonValue] = list(sorted(case_ids)[:MAX_BLOCKING_CASE_IDS])
        details: dict[str, JsonValue] = {
            "blockReason": block_reason.value,
            "openCases": len(case_ids),
            "caseIds": ids,
        }
        if case_language is not None:
            details["caseLanguage"] = case_language.value
        super().__init__(None, **details)
        self.block_reason = block_reason
        self.case_ids = tuple(case_ids)
        self.case_language = case_language


class StaffInactiveError(ApplicationError):
    code = "staff_inactive"
    default_message = "Esta cuenta está desactivada."
