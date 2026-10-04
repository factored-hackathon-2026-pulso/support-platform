"""``Turn``: one entry of a case transcript (append-only, contract ``turn``).

Turns are created only through ``Case.append_turn`` in the same Unit of Work as the case
save, so the case's compare-and-set serialises their ``sequence`` (1-based, gap-free per
case, staff-only turns included).
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime

from cc_platform.domain.cases.values import (
    CONVERSATION_KINDS,
    EmailDirection,
    TurnAudience,
    TurnAuthorRole,
    TurnKind,
)
from cc_platform.domain.people.staff import Language
from cc_platform.domain.shared.actor import ActorRef
from cc_platform.domain.shared.errors import InvalidValueError
from cc_platform.domain.shared.ids import IdPrefix, require_id

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

    def __post_init__(self) -> None:
        require_id(self.id, IdPrefix.TURN)
        require_id(self.case_id, IdPrefix.CASE)
        if self.sequence < 1:
            raise InvalidValueError("turn sequence starts at 1", field="sequence")
        if self.text != normalize_turn_text(self.text):
            raise InvalidValueError("turn text must be normalised", field="text")
        if self.kind is TurnKind.ROUTING and self.audience is not TurnAudience.STAFF:
            raise InvalidValueError("routing banners are staff-only", field="audience")
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
