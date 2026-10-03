"""Staff schemas (people context). ``TeamRef`` is shared with supervision and administration."""

from __future__ import annotations

from pydantic import Field

from cc_platform.api.schemas.common import ApiModel
from cc_platform.application.people.dto import StaffView, TeamRefView
from cc_platform.domain.people.staff import Language, StaffRole


class TeamRef(ApiModel):
    id: str = Field(description="TEAM-… id of the team.", examples=["TEAM-01J…"])
    name: str = Field(description="The team's current name.")

    @classmethod
    def from_view(cls, view: TeamRefView) -> TeamRef:
        return cls(id=view.id, name=view.name)


class StaffOut(ApiModel):
    id: str
    name: str
    email: str
    roles: list[StaffRole] = Field(description="Canonical order: analyst, supervisor, admin.")
    languages: list[Language] = Field(description="Sorted; may be empty without analyst.")
    team: TeamRef
    active: bool

    @classmethod
    def from_view(cls, view: StaffView) -> StaffOut:
        return cls(
            id=view.id,
            name=view.name,
            email=view.email,
            roles=list(view.roles),
            languages=list(view.languages),
            team=TeamRef.from_view(view.team),
            active=view.active,
        )


class StaffListResponse(ApiModel):
    items: list[StaffOut]
