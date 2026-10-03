"""Server-written banner texts (slice 2 contract §3.3).

The UI formats every other time in the viewer's own zone, so a time baked into a stored
banner must name its zone; an unlabeled Bogotá time would read as the viewer's clock.
"""

from __future__ import annotations

from datetime import UTC, datetime

from cc_platform.application.cases import copy
from cc_platform.domain.cases.values import CloseReason

#: 20:59 UTC: 15:59 in Bogotá, 17:59 in Buenos Aires, 14:59 in Ciudad de México.
CLOSED_AT = datetime(2026, 10, 1, 20, 59, 31, tzinfo=UTC)


def test_display_datetime_names_the_display_zone() -> None:
    assert copy.display_datetime(CLOSED_AT) == "1 oct, 15:59 hora Bogotá"


def test_display_datetime_converts_across_the_local_date_line() -> None:
    # 03:10 UTC on 2 Oct is still 1 Oct in Bogotá (UTC-5).
    at = datetime(2026, 10, 2, 3, 10, tzinfo=UTC)
    assert copy.display_datetime(at) == "1 oct, 22:10 hora Bogotá"


def test_wrote_again_banner_labels_the_close_time_zone() -> None:
    assert copy.wrote_again("Patricia", CLOSED_AT, CloseReason.RESOLVED) == (
        "Patricia volvió a escribir. Su caso anterior se cerró el 1 oct, 15:59 hora Bogotá "
        "(resuelto)."
    )


def test_wrote_again_banner_lower_cases_every_close_reason() -> None:
    text = copy.wrote_again("Marcela", CLOSED_AT, CloseReason.CUSTOMER_UNRESPONSIVE)
    assert text.endswith("15:59 hora Bogotá (el cliente no respondió).")
