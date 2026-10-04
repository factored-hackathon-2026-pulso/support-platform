"""Staff aggregate: the people who work on the support platform (analysts, supervisors,
administrators).

Slice 4 makes it editable by administration. Invariants: a name of 2–120 characters, a
valid email (unique, enforced by the repository), at least one role, at least one language
for whoever holds Analista (others may speak none), and exactly one team (``team_id``).

Edits go through ``plan_edit`` (validates the resulting person, records nothing) and
``apply_edit`` (records one event per kind of change, in the contract order: profile,
roles, languages, team). Splitting the two lets the use case check its own rules (email
taken, open cases, the admin roster) between validation and the change. The single-purpose
methods (``update_profile``, ``set_roles``, ``set_languages``, ``move_to``) are the same
two steps.
"""

from __future__ import annotations

from collections.abc import Iterable
from dataclasses import dataclass
from datetime import datetime
from enum import StrEnum

from cc_platform.domain.people.errors import StaffInvitedError, TeamInactiveError
from cc_platform.domain.people.events import (
    StaffCreated,
    StaffDeactivated,
    StaffLanguagesChanged,
    StaffProfileUpdated,
    StaffReactivated,
    StaffRolesChanged,
    StaffTeamChanged,
)
from cc_platform.domain.people.names import normalize_person_name
from cc_platform.domain.people.team import Team
from cc_platform.domain.shared.actor import ActorRef, ActorRole
from cc_platform.domain.shared.aggregate import AggregateRoot
from cc_platform.domain.shared.errors import InvalidValueError
from cc_platform.domain.shared.ids import IdPrefix, require_id

#: Team-generated limit (contract §1.3).
MAX_EMAIL_LENGTH = 254


class StaffRole(StrEnum):
    """Platform roles. They combine: one person may hold several (brief §1)."""

    ANALYST = "analyst"
    SUPERVISOR = "supervisor"
    ADMIN = "admin"

    @property
    def actor_role(self) -> ActorRole:
        return ActorRole(self.value)


#: Order used to pick a default acting role (matches the role rail of the canvas). It is
#: also the canonical order of role lists (API responses, event payloads).
ROLE_PRECEDENCE: tuple[StaffRole, ...] = (
    StaffRole.ANALYST,
    StaffRole.SUPERVISOR,
    StaffRole.ADMIN,
)


class Language(StrEnum):
    SPANISH = "es"
    PORTUGUESE = "pt"


class AccountSetup(StrEnum):
    """Part 4: where a person is in getting her account (stored on ``Staff``).

    - ``invited``: administration created her; her invitation is pending (or expired). She
      has no password and no login account yet, so she cannot sign in (``active`` false).
    - ``withdrawn``: her invitation was cancelled before she activated it. The record stays
      (history, audit) but the directory hides it; inviting the same email again reuses it.
    - ``complete``: she activated her account (or was seeded). Only then does ``active``
      mean what slice 4 says (deactivate / reactivate).
    """

    INVITED = "invited"
    WITHDRAWN = "withdrawn"
    COMPLETE = "complete"


def canonical_roles(roles: Iterable[StaffRole]) -> tuple[StaffRole, ...]:
    held = set(roles)
    return tuple(role for role in ROLE_PRECEDENCE if role in held)


def sorted_languages(languages: Iterable[Language]) -> tuple[Language, ...]:
    return tuple(sorted(set(languages)))


def normalize_email(email: str) -> str:
    normalized = email.strip().lower()
    local, _, domain = normalized.partition("@")
    if (
        not local
        or "@" in domain
        or "." not in domain
        or domain.startswith(".")
        or domain.endswith(".")
        or any(ch.isspace() for ch in normalized)
        or len(normalized) > MAX_EMAIL_LENGTH
    ):
        raise InvalidValueError("El correo no tiene un formato válido.", field="email")
    return normalized


def validate_roles_and_languages(
    roles: frozenset[StaffRole], languages: frozenset[Language]
) -> None:
    if not roles:
        raise InvalidValueError("Elige al menos un rol.", field="roles")
    if StaffRole.ANALYST in roles and not languages:
        raise InvalidValueError(
            "Quien atiende casos necesita al menos un idioma.", field="languages"
        )


@dataclass(frozen=True, slots=True)
class StaffProfile:
    """A validated new person (name, email, roles, languages), before any team check."""

    name: str
    email: str
    roles: frozenset[StaffRole]
    languages: frozenset[Language]

    @classmethod
    def of(
        cls,
        *,
        name: str,
        email: str,
        roles: Iterable[StaffRole],
        languages: Iterable[Language],
    ) -> StaffProfile:
        profile = cls(
            name=normalize_person_name(name),
            email=normalize_email(email),
            roles=frozenset(roles),
            languages=frozenset(languages),
        )
        validate_roles_and_languages(profile.roles, profile.languages)
        return profile


def _values(items: Iterable[StrEnum]) -> tuple[str, ...]:
    return tuple(item.value for item in items)


@dataclass(frozen=True, slots=True)
class StaffEdit:
    """A validated edit of one person: the values before and after (``Staff.plan_edit``)."""

    name: tuple[str, str]
    email: tuple[str, str]
    roles: tuple[frozenset[StaffRole], frozenset[StaffRole]]
    languages: tuple[frozenset[Language], frozenset[Language]]
    team_id: tuple[str, str]

    @property
    def profile_fields(self) -> tuple[str, ...]:
        fields: list[str] = []
        if self.name[0] != self.name[1]:
            fields.append("name")
        if self.email[0] != self.email[1]:
            fields.append("email")
        return tuple(fields)

    @property
    def roles_added(self) -> frozenset[StaffRole]:
        return self.roles[1] - self.roles[0]

    @property
    def roles_removed(self) -> frozenset[StaffRole]:
        return self.roles[0] - self.roles[1]

    @property
    def languages_added(self) -> frozenset[Language]:
        return self.languages[1] - self.languages[0]

    @property
    def languages_removed(self) -> frozenset[Language]:
        return self.languages[0] - self.languages[1]

    @property
    def team_changed(self) -> bool:
        return self.team_id[0] != self.team_id[1]

    @property
    def changes_anything(self) -> bool:
        return bool(
            self.profile_fields
            or self.roles[0] != self.roles[1]
            or self.languages[0] != self.languages[1]
            or self.team_changed
        )


@dataclass(eq=False)
class Staff(AggregateRoot):
    """A person with access to the back office."""

    id: str
    name: str
    email: str
    roles: frozenset[StaffRole]
    languages: frozenset[Language]
    team_id: str
    created_at: datetime
    active: bool = True
    creation_key: str | None = None
    setup: AccountSetup = AccountSetup.COMPLETE

    def __post_init__(self) -> None:
        require_id(self.id, IdPrefix.STAFF)
        if self.setup is not AccountSetup.COMPLETE and self.active:
            raise InvalidValueError("only a complete account can be active", field="active")
        self.name = normalize_person_name(self.name)
        self.email = normalize_email(self.email)
        self.roles = frozenset(self.roles)
        self.languages = frozenset(self.languages)
        validate_roles_and_languages(self.roles, self.languages)
        require_id(self.team_id, IdPrefix.TEAM)

    # ------------------------------------------------------------------ queries
    def has_role(self, role: StaffRole) -> bool:
        return role in self.roles

    def has_any_role(self, roles: frozenset[StaffRole]) -> bool:
        return not self.roles.isdisjoint(roles)

    def speaks(self, language: Language) -> bool:
        return language in self.languages

    @property
    def is_invited(self) -> bool:
        return self.setup is AccountSetup.INVITED

    @property
    def is_withdrawn(self) -> bool:
        return self.setup is AccountSetup.WITHDRAWN

    @property
    def is_member(self) -> bool:
        """She counts in her team: active, or invited and on her way (part 4)."""
        return self.active or self.is_invited

    @property
    def is_active_admin(self) -> bool:
        return self.active and StaffRole.ADMIN in self.roles

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

    # ------------------------------------------------------------------ creation
    @classmethod
    def create(
        cls,
        *,
        staff_id: str,
        name: str,
        email: str,
        roles: Iterable[StaffRole],
        languages: Iterable[Language],
        team: Team,
        now: datetime,
        actor: ActorRef,
        creation_key: str | None = None,
    ) -> Staff:
        """A new person in an active team (records ``staff.created``). Part 4: she starts
        ``invited`` (inactive, no password) until she accepts her invitation."""
        if not team.active:
            raise TeamInactiveError(team.id)
        staff = cls(
            id=staff_id,
            name=name,
            email=email,
            roles=frozenset(roles),
            languages=frozenset(languages),
            team_id=team.id,
            created_at=now,
            creation_key=creation_key,
            active=False,
            setup=AccountSetup.INVITED,
        )
        staff._record(
            StaffCreated(
                occurred_at=now,
                actor=actor,
                entity_id=staff.id,
                name=staff.name,
                roles=_values(canonical_roles(staff.roles)),
                languages=_values(sorted_languages(staff.languages)),
                team_id=team.id,
                team_name=team.name,
            )
        )
        return staff

    # ------------------------------------------------------------------ edits
    def plan_edit(
        self,
        *,
        name: str | None = None,
        email: str | None = None,
        roles: Iterable[StaffRole] | None = None,
        languages: Iterable[Language] | None = None,
        team_id: str | None = None,
    ) -> StaffEdit:
        """Validate the person that would result (absent = unchanged); records nothing."""
        new_name = normalize_person_name(name) if name is not None else self.name
        new_email = normalize_email(email) if email is not None else self.email
        new_roles = frozenset(roles) if roles is not None else self.roles
        new_languages = frozenset(languages) if languages is not None else self.languages
        validate_roles_and_languages(new_roles, new_languages)
        return StaffEdit(
            name=(self.name, new_name),
            email=(self.email, new_email),
            roles=(self.roles, new_roles),
            languages=(self.languages, new_languages),
            team_id=(self.team_id, team_id if team_id is not None else self.team_id),
        )

    def apply_edit(
        self,
        edit: StaffEdit,
        *,
        now: datetime,
        actor: ActorRef,
        team: Team | None = None,
        from_team_name: str | None = None,
    ) -> bool:
        """Apply a planned edit; one event per kind of change, in the contract order.

        A team change needs the destination ``team`` (it must be active) and the name of the
        current one (``from_team_name``, the name at the time). ``False`` when the edit
        changes nothing (nothing recorded).
        """
        if (edit.name[0], edit.email[0], edit.roles[0], edit.languages[0], edit.team_id[0]) != (
            self.name,
            self.email,
            self.roles,
            self.languages,
            self.team_id,
        ):
            raise ValueError("the edit was planned on another revision of this person")
        if edit.team_changed and (team is None or team.id != edit.team_id[1]):
            raise ValueError("a team change needs the destination team")
        if edit.team_changed and team is not None and not team.active:
            raise TeamInactiveError(team.id)
        if not edit.changes_anything:
            return False

        if edit.profile_fields:
            self.name, self.email = edit.name[1], edit.email[1]
            self._record(
                StaffProfileUpdated(
                    occurred_at=now,
                    actor=actor,
                    entity_id=self.id,
                    changed_fields=edit.profile_fields,
                    from_name=edit.name[0],
                    to_name=edit.name[1],
                )
            )
        if edit.roles[0] != edit.roles[1]:
            self.roles = edit.roles[1]
            self._record(
                StaffRolesChanged(
                    occurred_at=now,
                    actor=actor,
                    entity_id=self.id,
                    from_roles=_values(canonical_roles(edit.roles[0])),
                    to_roles=_values(canonical_roles(edit.roles[1])),
                    added=_values(canonical_roles(edit.roles_added)),
                    removed=_values(canonical_roles(edit.roles_removed)),
                )
            )
        if edit.languages[0] != edit.languages[1]:
            self.languages = edit.languages[1]
            self._record(
                StaffLanguagesChanged(
                    occurred_at=now,
                    actor=actor,
                    entity_id=self.id,
                    from_languages=_values(sorted_languages(edit.languages[0])),
                    to_languages=_values(sorted_languages(edit.languages[1])),
                    added=_values(sorted_languages(edit.languages_added)),
                    removed=_values(sorted_languages(edit.languages_removed)),
                )
            )
        if edit.team_changed and team is not None:
            self.team_id = team.id
            self._record(
                StaffTeamChanged(
                    occurred_at=now,
                    actor=actor,
                    entity_id=self.id,
                    from_team_id=edit.team_id[0],
                    from_team_name=from_team_name or edit.team_id[0],
                    to_team_id=team.id,
                    to_team_name=team.name,
                )
            )
        return True

    def update_profile(
        self,
        *,
        name: str | None = None,
        email: str | None = None,
        now: datetime,
        actor: ActorRef,
    ) -> bool:
        return self.apply_edit(self.plan_edit(name=name, email=email), now=now, actor=actor)

    def set_roles(self, roles: Iterable[StaffRole], *, now: datetime, actor: ActorRef) -> bool:
        return self.apply_edit(self.plan_edit(roles=roles), now=now, actor=actor)

    def set_languages(
        self, languages: Iterable[Language], *, now: datetime, actor: ActorRef
    ) -> bool:
        return self.apply_edit(self.plan_edit(languages=languages), now=now, actor=actor)

    def move_to(self, team: Team, *, from_team_name: str, now: datetime, actor: ActorRef) -> bool:
        edit = self.plan_edit(team_id=team.id)
        return self.apply_edit(edit, now=now, actor=actor, team=team, from_team_name=from_team_name)

    # ------------------------------------------------------------------ onboarding (part 4)
    def activate(self, team: Team) -> None:
        """Her invitation was accepted: the account is complete and active. No event of its
        own (``staff.invitation_accepted`` says it); her team must be active."""
        if not self.is_invited:
            raise ValueError("only an invited person can be activated")
        if team.id != self.team_id:
            raise ValueError("activate needs the person's own team")
        if not team.active:
            raise TeamInactiveError(team.id)
        self.setup = AccountSetup.COMPLETE
        self.active = True

    def withdraw(self) -> None:
        """Her invitation was cancelled before she activated it (no event of its own)."""
        if not self.is_invited:
            raise ValueError("only an invited person can be withdrawn")
        self.setup = AccountSetup.WITHDRAWN

    def reinvite(self, *, creation_key: str | None) -> None:
        """Invited again with the same email after a cancelled invitation."""
        if not self.is_withdrawn:
            raise ValueError("only a withdrawn person can be invited again")
        self.setup = AccountSetup.INVITED
        if creation_key is not None:
            self.creation_key = creation_key

    # ------------------------------------------------------------------ lifecycle
    def deactivate(self, *, revoked_sessions: int, now: datetime, actor: ActorRef) -> bool:
        """She can no longer sign in; her history, audit and team membership stay."""
        if not self.active:
            return False
        self.active = False
        self._record(
            StaffDeactivated(
                occurred_at=now, actor=actor, entity_id=self.id, revoked_sessions=revoked_sessions
            )
        )
        return True

    def reactivate(self, team: Team, *, now: datetime, actor: ActorRef) -> bool:
        """Back in her (active) team; her availability is left as it was (paused). Someone
        who never activated her account cannot be reactivated (``staff_invited``)."""
        if self.active:
            return False
        if self.setup is not AccountSetup.COMPLETE:
            raise StaffInvitedError()
        if team.id != self.team_id:
            raise ValueError("reactivate needs the person's own team")
        if not team.active:
            raise TeamInactiveError(team.id)
        self.active = True
        self._record(StaffReactivated(occurred_at=now, actor=actor, entity_id=self.id))
        return True
