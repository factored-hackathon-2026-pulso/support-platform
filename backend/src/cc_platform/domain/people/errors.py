"""Errors of the people context (staff accounts, teams, MFA challenges, sessions)."""

from __future__ import annotations

from datetime import datetime

from cc_platform.domain.shared.errors import ConflictError, DomainError
from cc_platform.domain.shared.json import iso_utc


class AccountLockedError(DomainError):
    """Too many failed password attempts; the account is locked until ``unlock_at``."""

    code = "account_locked"
    default_message = "Tu cuenta está bloqueada temporalmente por intentos fallidos."

    def __init__(self, unlock_at: datetime) -> None:
        super().__init__(None, unlockAt=iso_utc(unlock_at))
        self.unlock_at = unlock_at


class MfaChallengeInvalidError(DomainError):
    """The MFA challenge does not exist, expired, was already used or ran out of attempts."""

    code = "mfa_challenge_invalid"
    default_message = (
        "El código venció o ya no es válido. Vuelve a ingresar tu correo y contraseña."
    )


# ----------------------------------------------------------------------------- administration
class EmailTakenError(ConflictError):
    """Another account already uses that (normalised) email."""

    code = "email_taken"
    default_message = "Ya existe una cuenta con ese correo."

    def __init__(self) -> None:
        super().__init__(None, field="email")


class TeamNameTakenError(ConflictError):
    """Another team (active or not) already has that name (case and accents ignored)."""

    code = "team_name_taken"
    default_message = "Ya existe un equipo con ese nombre."

    def __init__(self) -> None:
        super().__init__(None, field="name")


class TeamInactiveError(DomainError):
    """Nobody can be moved into (or reactivated in) a deactivated team."""

    code = "team_inactive"
    default_message = "Ese equipo está desactivado."

    def __init__(self, team_id: str) -> None:
        super().__init__(None, teamId=team_id)
        self.team_id = team_id


class TeamNotEmptyError(ConflictError):
    """A team with active members cannot be deactivated."""

    code = "team_not_empty"
    default_message = "El equipo todavía tiene personas activas."

    def __init__(self, member_count: int) -> None:
        super().__init__(None, memberCount=member_count)
        self.member_count = member_count


class LastAdminError(ConflictError):
    """The change would leave the platform without an active administrator."""

    code = "last_admin"
    default_message = "Debe quedar al menos una persona activa con el rol de Administración."
