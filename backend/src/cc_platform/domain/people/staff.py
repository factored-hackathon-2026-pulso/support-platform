"""Staff aggregate: the people who work on the support platform (analysts, supervisors,
administrators)."""

from __future__ import annotations

from dataclasses import dataclass
from enum import StrEnum

from cc_platform.domain.shared.actor import ActorRef, ActorRole
from cc_platform.domain.shared.aggregate import AggregateRoot
from cc_platform.domain.shared.errors import InvalidValueError
from cc_platform.domain.shared.ids import IdPrefix, require_id


class StaffRole(StrEnum):
    """Platform roles. They combine: one person may hold several (brief §1)."""

    ANALYST = "analyst"
    SUPERVISOR = "supervisor"
    ADMIN = "admin"

    @property
    def actor_role(self) -> ActorRole:
        return ActorRole(self.value)


#: Order used to pick a default acting role (matches the role rail of the canvas).
ROLE_PRECEDENCE: tuple[StaffRole, ...] = (
    StaffRole.ANALYST,
    StaffRole.SUPERVISOR,
    StaffRole.ADMIN,
)


class Language(StrEnum):
    SPANISH = "es"
    PORTUGUESE = "pt"


def normalize_email(email: str) -> str:
    normalized = email.strip().lower()
    local, _, domain = normalized.partition("@")
    if not local or "." not in domain or " " in normalized:
        raise InvalidValueError("El correo no tiene un formato válido.", field="email")
    return normalized


@dataclass(eq=False)
class Staff(AggregateRoot):
    """A person with access to the back office."""

    id: str
    name: str
    email: str
    roles: frozenset[StaffRole]
    languages: frozenset[Language]
    team: str
    active: bool = True

    def __post_init__(self) -> None:
        require_id(self.id, IdPrefix.STAFF)
        if not self.name.strip():
            raise InvalidValueError("staff name must not be empty", field="name")
        self.email = normalize_email(self.email)
        if not self.roles:
            raise InvalidValueError("staff must hold at least one role", field="roles")
        if not self.languages:
            raise InvalidValueError("staff must speak at least one language", field="languages")
        if not self.team.strip():
            raise InvalidValueError("staff team must not be empty", field="team")

    def has_role(self, role: StaffRole) -> bool:
        return role in self.roles

    def has_any_role(self, roles: frozenset[StaffRole]) -> bool:
        return not self.roles.isdisjoint(roles)

    def speaks(self, language: Language) -> bool:
        return language in self.languages

    @property
    def primary_role(self) -> StaffRole:
        return next(role for role in ROLE_PRECEDENCE if role in self.roles)

    def actor_ref(self, acting_role: StaffRole | None = None) -> ActorRef:
        role = (
            acting_role
            if acting_role is not None and acting_role in self.roles
            else self.primary_role
        )
        return ActorRef(role=role.actor_role, actor_id=self.id)
