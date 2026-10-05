"""The approval review keeps agent-core's `inherited` / `inherited_from` (agent-core PR 52)."""

from __future__ import annotations

from cc_platform.api.schemas import builder as schemas
from cc_platform.application.ai.registry import ReleaseSettingChange


def test_the_review_passes_the_donor_of_an_inherited_value_through() -> None:
    change = ReleaseSettingChange(
        field="max_input_chars", before=None, after=4000, inherited=True, inherited_from="rel-donor"
    )

    out = schemas.ReleaseSettingChange.model_validate(change).model_dump(by_alias=True)

    assert out["inherited"] is True
    assert out["inheritedFrom"] == "rel-donor"


def test_an_explicit_value_is_not_marked_inherited() -> None:
    change = ReleaseSettingChange(field="max_input_chars", before=4000, after=6000)

    out = schemas.ReleaseSettingChange.model_validate(change).model_dump(by_alias=True)

    assert out["inherited"] is False
    assert out["inheritedFrom"] is None
