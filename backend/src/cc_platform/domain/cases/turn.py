"""``Turn``: one entry of a case transcript (append-only, contract ``turn``).

Turns are created only through ``Case.append_turn`` in the same Unit of Work as the case
save, so the case's compare-and-set serialises their ``sequence`` (1-based, gap-free per
case, staff-only turns included).
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime

from cc_platform.domain.cases.values import TurnAudience, TurnAuthorRole, TurnKind
from cc_platform.domain.people.staff import Language
from cc_platform.domain.shared.actor import ActorRef
from cc_platform.domain.shared.errors import InvalidValueError
from cc_platform.domain.shared.ids import IdPrefix, require_id

MAX_TURN_TEXT = 4000


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

    @property
    def author(self) -> ActorRef:
        if self.author_id is None:
            return ActorRef.system()
        return ActorRef(self.author_role.actor_role, self.author_id)

    @property
    def is_public(self) -> bool:
        return self.audience is TurnAudience.EVERYONE

    @property
    def is_customer_message(self) -> bool:
        return self.kind is TurnKind.MESSAGE and self.author_role is TurnAuthorRole.CUSTOMER

    @property
    def is_analyst_message(self) -> bool:
        return self.kind is TurnKind.MESSAGE and self.author_role is TurnAuthorRole.ANALYST
