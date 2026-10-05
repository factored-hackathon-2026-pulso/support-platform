"""Staff-only transcript lines (``routing`` turns) with their facts (slice 23c).

Each builder returns the Spanish sentence the turn stores (``copy.py``, unchanged: what
older clients, the audit and the inbox preview read) together with its facts
(``StaffLine``: a kind and its parameters), which the staff UI turns into a sentence in each
viewer's language. Customer notices are not here: they are chat content, in the case
language.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime

from cc_platform.application.cases import copy
from cc_platform.domain.cases.turn import StaffLine
from cc_platform.domain.cases.values import CaseChannel, CloseReason, StaffLineKind
from cc_platform.domain.people.staff import Language
from cc_platform.domain.shared.json import iso_utc


@dataclass(frozen=True, slots=True)
class Banner:
    """A staff-only line: the stored Spanish ``text`` and its ``line`` facts."""

    text: str
    line: StaffLine


def _with_paused(
    params: dict[str, str | int], paused_first_name: str | None
) -> dict[str, str | int]:
    return params if paused_first_name is None else {**params, "paused": paused_first_name}


def assigned_on_arrival(analyst_name: str, language: Language) -> Banner:
    return Banner(
        copy.assigned_on_arrival(analyst_name, language),
        StaffLine(
            StaffLineKind.ASSIGNED_ON_ARRIVAL,
            {"analyst": analyst_name, "language": language.value},
        ),
    )


def assigned_from_assistant(analyst_name: str, language: Language) -> Banner:
    return Banner(
        copy.assigned_from_assistant(analyst_name, language),
        StaffLine(
            StaffLineKind.ASSIGNED_FROM_ASSISTANT,
            {"analyst": analyst_name, "language": language.value},
        ),
    )


def queued(language: Language, label: str) -> Banner:
    return Banner(
        copy.queued(language, label),
        StaffLine(StaffLineKind.QUEUED, {"language": language.value}),
    )


def assigned_from_queue(
    analyst_name: str, waited_minutes: int, label: str, language: Language
) -> Banner:
    return Banner(
        copy.assigned_from_queue(analyst_name, waited_minutes, label),
        StaffLine(
            StaffLineKind.ASSIGNED_FROM_QUEUE,
            {"analyst": analyst_name, "minutes": waited_minutes, "language": language.value},
        ),
    )


def wrote_again(
    first_name: str,
    closed_at: datetime,
    reason: CloseReason,
    channel: CaseChannel = CaseChannel.CHAT_APP,
) -> Banner:
    """The UI shows the previous closing time in the viewer's zone (the stored Spanish text
    names the display zone)."""
    return Banner(
        copy.wrote_again(first_name, closed_at, reason, channel),
        StaffLine(
            StaffLineKind.WROTE_AGAIN,
            {
                "customer": first_name,
                "closedAt": iso_utc(closed_at),
                "closeReason": reason.value,
                "channel": channel.value,
            },
        ),
    )


def manually_assigned_from_queue(
    supervisor_name: str,
    analyst_name: str,
    waited_minutes: int,
    label: str,
    language: Language,
    *,
    paused_first_name: str | None = None,
) -> Banner:
    params: dict[str, str | int] = {
        "supervisor": supervisor_name,
        "analyst": analyst_name,
        "minutes": waited_minutes,
        "language": language.value,
    }
    return Banner(
        copy.manually_assigned_from_queue(
            supervisor_name,
            analyst_name,
            waited_minutes,
            label,
            paused_first_name=paused_first_name,
        ),
        StaffLine(StaffLineKind.ASSIGNED_BY_SUPERVISION, _with_paused(params, paused_first_name)),
    )


def reassigned(
    supervisor_name: str,
    previous_name: str,
    analyst_name: str,
    *,
    paused_first_name: str | None = None,
) -> Banner:
    params: dict[str, str | int] = {
        "supervisor": supervisor_name,
        "previous": previous_name,
        "analyst": analyst_name,
    }
    return Banner(
        copy.reassigned(
            supervisor_name, previous_name, analyst_name, paused_first_name=paused_first_name
        ),
        StaffLine(StaffLineKind.REASSIGNED, _with_paused(params, paused_first_name)),
    )


def escalated(analyst_name: str) -> Banner:
    return Banner(
        copy.escalated(analyst_name),
        StaffLine(StaffLineKind.ESCALATED, {"analyst": analyst_name}),
    )


def escalation_withdrawn(analyst_name: str) -> Banner:
    return Banner(
        copy.escalation_withdrawn(analyst_name),
        StaffLine(StaffLineKind.ESCALATION_WITHDRAWN, {"analyst": analyst_name}),
    )


def escalation_answered(supervisor_name: str) -> Banner:
    return Banner(
        copy.escalation_answered(supervisor_name),
        StaffLine(StaffLineKind.ESCALATION_ANSWERED, {"supervisor": supervisor_name}),
    )


def escalation_taken(supervisor_name: str, previous_name: str) -> Banner:
    return Banner(
        copy.escalation_taken(supervisor_name, previous_name),
        StaffLine(
            StaffLineKind.ESCALATION_TAKEN,
            {"supervisor": supervisor_name, "previous": previous_name},
        ),
    )


def assistant_released(
    reason: str, *, ref: str | None = None, code: str | None = None, who: str | None = None
) -> Banner:
    """``ref``, ``code`` and ``who`` only when known (the UI says "sin detalle" and "Supervisión"
    in the viewer's language otherwise). ``ref`` stays in the facts but no text shows it."""
    optional = {"ref": ref, "code": code, "who": who}
    params: dict[str, str | int] = {"reason": reason}
    params |= {key: value for key, value in optional.items() if value}
    return Banner(
        copy.assistant_released(reason, ref=ref, code=code, who=who),
        StaffLine(StaffLineKind.ASSISTANT_RELEASED, params),
    )


def follow_up_call(analyst_name: str, customer_first_name: str) -> Banner:
    return Banner(
        copy.follow_up_call(analyst_name, customer_first_name),
        StaffLine(
            StaffLineKind.FOLLOW_UP_CALL,
            {"analyst": analyst_name, "customer": customer_first_name},
        ),
    )
