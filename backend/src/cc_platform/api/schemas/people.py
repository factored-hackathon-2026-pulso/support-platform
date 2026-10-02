"""Staff schemas."""

from __future__ import annotations

from cc_platform.api.schemas.common import ApiModel
from cc_platform.application.people.dto import StaffView
from cc_platform.domain.people.staff import Language, StaffLevel, StaffRole


class StaffOut(ApiModel):
    id: str
    name: str
    email: str
    roles: list[StaffRole]
    level: StaffLevel
    languages: list[Language]
    team: str
    requires_four_eyes: bool

    @classmethod
    def from_view(cls, view: StaffView) -> StaffOut:
        return cls(
            id=view.id,
            name=view.name,
            email=view.email,
            roles=list(view.roles),
            level=view.level,
            languages=list(view.languages),
            team=view.team,
            requires_four_eyes=view.requires_four_eyes,
        )


class StaffListResponse(ApiModel):
    items: list[StaffOut]
