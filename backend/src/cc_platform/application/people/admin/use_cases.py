"""The administration use cases (slice 4), as one bundle the composition root builds.

Routers reach them as ``api.use_cases.administration.<name>``.
"""

from __future__ import annotations

from dataclasses import dataclass

from cc_platform.application.people.admin.commands import (
    CreateUser,
    DeactivateUser,
    ReactivateUser,
    ResetPassword,
    UnlockAccount,
    UpdateUser,
)
from cc_platform.application.people.admin.queries import GetTeam, GetUser, ListTeams, ListUsers
from cc_platform.application.people.admin.team_commands import (
    CreateTeam,
    DeactivateTeam,
    ReactivateTeam,
    RenameTeam,
)


@dataclass(frozen=True, slots=True)
class AdministrationUseCases:
    list_users: ListUsers
    get_user: GetUser
    create_user: CreateUser
    update_user: UpdateUser
    deactivate_user: DeactivateUser
    reactivate_user: ReactivateUser
    unlock_user: UnlockAccount
    reset_password: ResetPassword
    list_teams: ListTeams
    get_team: GetTeam
    create_team: CreateTeam
    rename_team: RenameTeam
    deactivate_team: DeactivateTeam
    reactivate_team: ReactivateTeam
