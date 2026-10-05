"""``Turn``: one entry of a case transcript (append-only, contract ``turn``).

Turns are created only through ``Case.append_turn`` in the same Unit of Work as the case
save, so the case's compare-and-set serialises their ``sequence`` (1-based, gap-free per
case, staff-only turns included).
"""

from __future__ import annotations

from collections.abc import Mapping
from dataclasses import dataclass, field
from datetime import datetime

from cc_platform.domain.cases.values import (
    CONVERSATION_KINDS,
    EmailDirection,
    StaffLineKind,
    TurnAudience,
    TurnAuthorRole,
    TurnKind,
)
from cc_platform.domain.people.staff import Language
from cc_platform.domain.shared.actor import ActorRef
from cc_platform.domain.shared.errors import InvalidValueError
from cc_platform.domain.shared.ids import IdPrefix, require_id
from cc_platform.domain.shared.json import JsonObject, JsonValue

MAX_TURN_TEXT = 4000
MAX_EMAIL_SUBJECT = 200


def normalize_turn_text(text: str) -> str:
    """Trim surrounding whitespace (newlines inside are kept); 1–4000 characters."""
    normalized = text.strip()
    if not normalized:
        raise InvalidValueError("El mensaje no puede estar vacío.", field="text")
    if len(normalized) > MAX_TURN_TEXT:
        raise InvalidValueError(
            f"El mensaje no puede superar {MAX_TURN_TEXT} caracteres.", field="text"
        )
    return normalized


def normalize_email_subject(subject: str) -> str:
    """An email's subject: one line, trimmed, 1–200 characters."""
    normalized = " ".join(subject.split())
    if not normalized:
        raise InvalidValueError("Escribe el asunto del correo.", field="subject")
    if len(normalized) > MAX_EMAIL_SUBJECT:
        raise InvalidValueError(
            f"El asunto puede tener hasta {MAX_EMAIL_SUBJECT} caracteres.", field="subject"
        )
    return normalized


@dataclass(frozen=True, slots=True)
class StaffLine:
    """Slice 23c: the facts of a staff-only transcript line (``routing`` turn): what it says
    (``kind``) and with what (``params``: names as they were then, ids of enums, counts,
    ISO times). The turn's ``text`` keeps the Spanish sentence; the staff UI writes the line
    from these facts in each viewer's language. Older turns have none (their text is shown).
    """

    kind: StaffLineKind
    params: Mapping[str, str | int] = field(default_factory=dict)

    def __post_init__(self) -> None:
        for key, value in self.params.items():
            if not isinstance(value, str | int) or isinstance(value, bool):
                raise InvalidValueError(f"staff line param {key} must be text or a number")

    def to_json(self) -> JsonObject:
        params: dict[str, JsonValue] = dict(self.params)
        return {"kind": self.kind.value, "params": params}

    @classmethod
    def from_json(cls, data: object) -> StaffLine | None:
        """The stored facts, or ``None`` when absent or not understood (the text is shown)."""
        if not isinstance(data, dict):
            return None
        kind, params = data.get("kind"), data.get("params")
        if kind not in {k.value for k in StaffLineKind} or not isinstance(params, dict):
            return None
        clean = {
            str(k): v
            for k, v in params.items()
            if isinstance(v, str | int) and not isinstance(v, bool)
        }
        return cls(StaffLineKind(kind), clean)


@dataclass(frozen=True, slots=True)
class Turn:
    id: str
    case_id: str
    sequence: int
    kind: TurnKind
    audience: TurnAudience
    author_role: TurnAuthorRole
    author_id: str | None
    text: str
    language: Language
    created_at: datetime
    client_message_id: str | None = None
    subject: str | None = None
    """Slice 12: the subject of an ``email`` turn (``None`` on every other kind)."""
    staff_line: StaffLine | None = None
    """Slice 23c: the facts of a staff-only line (``routing`` turns written since 23c)."""

    def __post_init__(self) -> None:
        require_id(self.id, IdPrefix.TURN)
        require_id(self.case_id, IdPrefix.CASE)
        if self.sequence < 1:
            raise InvalidValueError("turn sequence starts at 1", field="sequence")
        if self.text != normalize_turn_text(self.text):
            raise InvalidValueError("turn text must be normalised", field="text")
        if self.kind is TurnKind.ROUTING and self.audience is not TurnAudience.STAFF:
            raise InvalidValueError("routing banners are staff-only", field="audience")
        if self.staff_line is not None and self.kind is not TurnKind.ROUTING:
            raise InvalidValueError("only a routing banner has staff-line facts", field="kind")
        if self.author_role is not TurnAuthorRole.SYSTEM and not self.author_id:
            raise InvalidValueError("only system turns may lack an author", field="author_id")
        self._check_channel_kinds()

    def _check_channel_kinds(self) -> None:
        """Slice 12 invariants: notes are an analyst's and staff only; emails have a subject
        and a person as author; call lines and emails reach the customer."""
        if self.kind is TurnKind.NOTE and (
            self.audience is not TurnAudience.STAFF
            or self.author_role is not TurnAuthorRole.ANALYST
        ):
            raise InvalidValueError("an internal note is an analyst's, staff only", field="kind")
        is_email = self.kind is TurnKind.EMAIL
        if is_email != (self.subject is not None):
            raise InvalidValueError("only an email has a subject", field="subject")
        if self.subject is not None and self.subject != normalize_email_subject(self.subject):
            raise InvalidValueError("the subject must be normalised", field="subject")
        if is_email and self.author_role is TurnAuthorRole.SYSTEM:
            raise InvalidValueError("an email is written by a person", field="author_role")
        public_kinds = {TurnKind.EMAIL, TurnKind.TRANSCRIPT}
        if self.kind in public_kinds and self.audience is not TurnAudience.EVERYONE:
            raise InvalidValueError("call lines and emails reach the customer", field="audience")

    @property
    def author(self) -> ActorRef:
        if self.author_id is None:
            return ActorRef.system()
        return ActorRef(self.author_role.actor_role, self.author_id)

    @property
    def is_public(self) -> bool:
        return self.audience is TurnAudience.EVERYONE

    @property
    def is_conversation(self) -> bool:
        """A chat message or an email (``CONVERSATION_KINDS``)."""
        return self.kind in CONVERSATION_KINDS

    @property
    def is_customer_message(self) -> bool:
        return self.is_conversation and self.author_role is TurnAuthorRole.CUSTOMER

    @property
    def is_analyst_message(self) -> bool:
        return self.is_conversation and self.author_role is TurnAuthorRole.ANALYST

    @property
    def email_direction(self) -> EmailDirection | None:
        """``in`` (from the customer) or ``out`` (from an analyst) for an email."""
        if self.kind is not TurnKind.EMAIL:
            return None
        if self.author_role is TurnAuthorRole.CUSTOMER:
            return EmailDirection.IN
        return EmailDirection.OUT
