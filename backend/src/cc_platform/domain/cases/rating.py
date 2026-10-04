"""Customer satisfaction rating of a closed case (CSAT, slice 7 contract §2).

The scale is 1–4, as in the bank's own survey and
``pulso-data/contracts/synthetic-sample/platform_history.json`` (``case_close.csat``): 1 Mal,
2 Regular, 3 Bien, 4 Excelente. The words live in the frontend; the domain only knows
the number. A case is rated at most once, only after it closed, only by its own
customer (``Case.rate``); the optional comment is trimmed and at most 500 characters
(blank → ``None``).

``key`` is the ``Idempotency-Key`` of the request that rated it: a retry with the same key
and the same answer is a replay, anything else after the first rating is ``already_rated``.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime

from cc_platform.domain.shared.errors import InvalidValueError

MIN_RATING_SCORE = 1
MAX_RATING_SCORE = 4
MAX_RATING_COMMENT = 500


def normalize_rating_score(score: int) -> int:
    """The score as given when it is on the 1–4 scale; anything else is ``invalid_value``."""
    if isinstance(score, bool) or not MIN_RATING_SCORE <= score <= MAX_RATING_SCORE:
        raise InvalidValueError(
            f"La calificación va de {MIN_RATING_SCORE} a {MAX_RATING_SCORE}.", field="score"
        )
    return score


def normalize_rating_comment(comment: str | None) -> str | None:
    """Trimmed comment; blank → ``None``; at most 500 characters."""
    if comment is None:
        return None
    trimmed = comment.strip()
    if not trimmed:
        return None
    if len(trimmed) > MAX_RATING_COMMENT:
        raise InvalidValueError(
            f"El comentario puede tener hasta {MAX_RATING_COMMENT} caracteres.", field="comment"
        )
    return trimmed


@dataclass(frozen=True, slots=True)
class CaseRating:
    """How the customer rated the attention they got (the closed case's analyst)."""

    score: int
    rated_at: datetime
    comment: str | None = None
    key: str | None = None

    def __post_init__(self) -> None:
        normalize_rating_score(self.score)
        if self.comment is not None and normalize_rating_comment(self.comment) != self.comment:
            raise InvalidValueError("the comment must be normalized", field="comment")

    def answers(self, score: int, comment: str | None) -> bool:
        """Same score and same (normalized) comment: a retry of this very rating."""
        return self.score == score and self.comment == comment
