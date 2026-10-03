"""``Team`` aggregate (slice 4 §2.1): how people are grouped on the platform.

Every staff member belongs to exactly one team (``Staff.team_id``). A team is never deleted:
it can be deactivated once it has no active members (it keeps its inactive members as
history) and reactivated later. Its name is unique among **all** teams, compared without
case or accents (``name_key``); the repository enforces it with a unique column.

``touch`` bumps the stored ``version`` without recording anything: a command that moves
someone into a team saves the team with it, so a concurrent ``DeactivateTeam`` (which counts
the active members) and the move serialise on the team's compare-and-set (contract §3.8).
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime

from cc_platform.domain.people.errors import TeamNotEmptyError
from cc_platform.domain.people.events import (
    TeamCreated,
    TeamDeactivated,
    TeamReactivated,
    TeamRenamed,
)
from cc_platform.domain.people.names import normalize_team_name, team_name_key
from cc_platform.domain.shared.actor import ActorRef
from cc_platform.domain.shared.aggregate import AggregateRoot
from cc_platform.domain.shared.ids import IdPrefix, require_id


@dataclass(eq=False)
class Team(AggregateRoot):
    id: str
    name: str
    active: bool
    created_at: datetime
    creation_key: str | None = None

    def __post_init__(self) -> None:
        require_id(self.id, IdPrefix.TEAM)
        self.name = normalize_team_name(self.name)

    @property
    def name_key(self) -> str:
        return team_name_key(self.name)

    @classmethod
    def create(
        cls,
        *,
        team_id: str,
        name: str,
        now: datetime,
        actor: ActorRef,
        creation_key: str | None = None,
    ) -> Team:
        team = cls(id=team_id, name=name, active=True, created_at=now, creation_key=creation_key)
        team._record(TeamCreated(occurred_at=now, actor=actor, entity_id=team.id, name=team.name))
        return team

    def rename(self, name: str, *, now: datetime, actor: ActorRef) -> bool:
        """``False`` (nothing recorded) when the normalised name is exactly the same."""
        new_name = normalize_team_name(name)
        if new_name == self.name:
            return False
        previous = self.name
        self.name = new_name
        self._record(
            TeamRenamed(
                occurred_at=now,
                actor=actor,
                entity_id=self.id,
                from_name=previous,
                to_name=new_name,
            )
        )
        return True

    def deactivate(self, *, active_members: int, now: datetime, actor: ActorRef) -> bool:
        if not self.active:
            return False
        if active_members > 0:
            raise TeamNotEmptyError(active_members)
        self.active = False
        self._record(
            TeamDeactivated(occurred_at=now, actor=actor, entity_id=self.id, name=self.name)
        )
        return True

    def reactivate(self, *, now: datetime, actor: ActorRef) -> bool:
        if self.active:
            return False
        self.active = True
        self._record(
            TeamReactivated(occurred_at=now, actor=actor, entity_id=self.id, name=self.name)
        )
        return True

    def touch(self) -> None:
        """No event: the next save still bumps ``version`` (the CAS token of §3.8)."""
