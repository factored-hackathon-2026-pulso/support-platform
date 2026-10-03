"""Staff schemas."""

from __future__ import annotations

from cc_platform.api.schemas.common import ApiModel
from cc_platform.application.people.dto import StaffView
from cc_platform.domain.people.staff import Language, StaffRole


class StaffOut(ApiModel):
    id: str
    name: str
    email: str
    roles: list[StaffRole]
    languages: list[Language]
    team: str

    @classmethod
    def from_view(cls, view: StaffView) -> StaffOut:
        return cls(
            id=view.id,
            name=view.name,
            email=view.email,
            roles=list(view.roles),
            languages=list(view.languages),
            team=view.team,
        )


class StaffListResponse(ApiModel):
    items: list[StaffOut]
