"""Administration (slice 4 §5): users, roles, languages and teams. Administración only.

Every command re-checks on fresh state that the caller is still an active admin, runs in
``retry_on_conflict`` and answers ``changed: false`` when it would change nothing. Edits
carry ``expectedVersion``; a stale one is ``409 version_conflict`` whose ``current`` member
is the record as its ``GET`` returns it now (rendered here, ``_with_current``).

Administration never moves cases: a change that would leave an open case with someone who
can no longer hold it is ``409 staff_has_open_cases`` until supervision reassigns it.

Part 4 (secure onboarding): administration never sees or hands out a password. A new person
gets an invitation by email (``invitation/resend``, ``invitation/cancel``) and a forgotten
password is replaced through a reset link sent by email (``password-reset``).
"""

from __future__ import annotations

from collections.abc import Awaitable
from typing import Annotated, Any, cast

from fastapi import APIRouter, Depends, Header, Path, Query, Response, status

from cc_platform.api.dependencies import ApiContextDep, require_roles
from cc_platform.api.schemas.administration import (
    AdminTeam,
    AdminTeamChange,
    AdminTeamDetail,
    AdminTeamList,
    AdminUser,
    AdminUserChange,
    AdminUserList,
    CreateTeamRequest,
    CreateUserRequest,
    InvitedUser,
    PasswordResetLinkSent,
    RenameTeamRequest,
    UpdateUserRequest,
    VersionRequest,
)
from cc_platform.api.schemas.common import problem_responses
from cc_platform.application.errors import VersionConflictError
from cc_platform.application.people.admin.dto import (
    AdminTeamView,
    AdminUserView,
    CreateUserCommand,
    TeamStatusFilter,
    UpdateUserCommand,
    UserFilters,
    UserStatusFilter,
)
from cc_platform.application.security import Actor
from cc_platform.domain.people.staff import Language, StaffRole
from cc_platform.domain.shared.json import JsonValue

router = APIRouter(prefix="/admin", tags=["administration"])

Admin = Annotated[Actor, Depends(require_roles(StaffRole.ADMIN))]
StaffId = Annotated[str, Path(alias="staffId", max_length=64, examples=["STF-01J…"])]
TeamId = Annotated[str, Path(alias="teamId", max_length=64, examples=["TEAM-01J…"])]

IDEMPOTENCY_KEY = "Idempotency-Key"
REPLAYED_HEADER = "Idempotent-Replayed"
CreationKey = Annotated[
    str | None,
    Header(
        alias=IDEMPOTENCY_KEY,
        min_length=8,
        max_length=64,
        pattern=r"^[A-Za-z0-9_-]+$",
        description="Optional. A retry with the same key and the same email (user) or name "
        "(team) answers 200 with the existing record and `Idempotent-Replayed: true`.",
    ),
]


async def _with_current[T](call: Awaitable[T]) -> T:
    """Render ``version_conflict``'s ``current`` (the record as its GET returns it)."""
    try:
        return await call
    except VersionConflictError as exc:
        view = exc.current_view
        current: dict[str, Any] | None = None
        if isinstance(view, AdminUserView):
            current = AdminUser.from_view(view).model_dump(mode="json", by_alias=True)
        elif isinstance(view, AdminTeamView):
            current = AdminTeam.from_view(view).model_dump(mode="json", by_alias=True)
        if current is not None:
            exc.details = {**exc.details, "current": cast("JsonValue", current)}
        raise


def _replayed(response: Response, replayed: bool) -> None:
    if replayed:
        response.status_code = status.HTTP_200_OK
        response.headers[REPLAYED_HEADER] = "true"


# ----------------------------------------------------------------------------- users
@router.get(
    "/users",
    response_model=AdminUserList,
    summary="The directory: people with their roles, languages, team and account status",
    description=(
        "Filters combine with AND. `q` is a case- and accent-insensitive contains on name, "
        "email or id. `status=active` (default) includes locked accounts. `roleCounts` cover "
        "every filter except `role`; `statusCounts` every filter except `status`. At most 500 "
        "rows, by name."
    ),
    responses=problem_responses(401, 403, 422),
)
async def list_users(
    *,
    actor: Admin,
    api: ApiContextDep,
    q: Annotated[str | None, Query(min_length=1, max_length=80)] = None,
    role: StaffRole | None = None,
    status_filter: Annotated[UserStatusFilter, Query(alias="status")] = UserStatusFilter.ACTIVE,
    team_id: Annotated[str | None, Query(alias="teamId", max_length=64)] = None,
    language: Language | None = None,
) -> AdminUserList:
    view = await api.use_cases.administration.list_users.execute(
        actor,
        UserFilters(query=q, role=role, status=status_filter, team_id=team_id, language=language),
    )
    return AdminUserList.from_view(view)


@router.get(
    "/users/{staffId}",
    response_model=AdminUser,
    summary="One person of the directory (any status)",
    responses=problem_responses(401, 403, 404),
)
async def get_user(staff_id: StaffId, actor: Admin, api: ApiContextDep) -> AdminUser:
    return AdminUser.from_view(await api.use_cases.administration.get_user.execute(actor, staff_id))


@router.post(
    "/users",
    response_model=InvitedUser,
    status_code=status.HTTP_201_CREATED,
    summary="Invite a person: she gets an email with a link that lasts 48 hours",
    description=(
        "Part 4: no password exists or is shown. The person starts `invited` (she cannot "
        "sign in) and sets her own password and authenticator with the link. Checks in this "
        "order: the caller is an active admin (403) · `Idempotency-Key` replay (200, no new "
        "email; another email → `idempotency_conflict`) · name, email, roles, analyst ⇒ at "
        "least one language (422 `invalid_value` with `field`) · the email is free (409 "
        "`email_taken`; the email of a cancelled invitation is invited again) · the team "
        "exists (422 `invalid_value`, `field: teamId`) and is active (422 `team_inactive`). "
        "Once active she starts En pausa."
    ),
    responses={
        200: {"description": "Idempotent replay of an existing invitation", "model": InvitedUser},
        **problem_responses(401, 403, 409, 422),
    },
)
async def create_user(
    *,
    body: CreateUserRequest,
    actor: Admin,
    api: ApiContextDep,
    response: Response,
    idempotency_key: CreationKey = None,
) -> InvitedUser:
    result = await api.use_cases.administration.create_user.execute(
        actor,
        CreateUserCommand(
            name=body.name,
            email=body.email,
            roles=tuple(body.roles),
            languages=tuple(body.languages),
            team_id=body.team_id,
            idempotency_key=idempotency_key,
        ),
    )
    _replayed(response, result.replayed)
    return InvitedUser.from_view(result)


@router.patch(
    "/users/{staffId}",
    response_model=AdminUserChange,
    summary="Edit a person: name, email, roles, languages, team",
    description=(
        "Absent fields are unchanged (send at least one). Checks in this order: 403 · 404 · "
        "`version_conflict` (with `current`) · `invalid_value` · `email_taken` · the team "
        "(`invalid_value` / `team_inactive`) · `self_change_forbidden` (`remove_own_admin`) · "
        "`staff_has_open_cases` (removing analyst, or a language of one of her open cases) · "
        "`last_admin`. Removing analyst pauses her; a role change applies on her next request "
        "and closes her sockets (4409)."
    ),
    responses=problem_responses(401, 403, 404, 409, 422),
)
async def update_user(
    staff_id: StaffId, body: UpdateUserRequest, actor: Admin, api: ApiContextDep
) -> AdminUserChange:
    command = UpdateUserCommand(
        expected_version=body.expected_version,
        name=body.name,
        email=body.email,
        roles=tuple(body.roles) if body.roles is not None else None,
        languages=tuple(body.languages) if body.languages is not None else None,
        team_id=body.team_id,
    )
    view = await _with_current(
        api.use_cases.administration.update_user.execute(actor, staff_id, command)
    )
    return AdminUserChange.from_view(view)


@router.post(
    "/users/{staffId}/deactivate",
    response_model=AdminUserChange,
    summary="Deactivate an account: she can no longer sign in and her sessions end",
    description=(
        "Checks: 403 · 404 · `version_conflict` · `self_change_forbidden` (`deactivate_self`) "
        "· already inactive (200, `changed: false`) · `staff_has_open_cases` (`deactivate`) · "
        "`last_admin`. She is paused and every session ends now (her sockets close with 4401)."
    ),
    responses=problem_responses(401, 403, 404, 409, 422),
)
async def deactivate_user(
    staff_id: StaffId, body: VersionRequest, actor: Admin, api: ApiContextDep
) -> AdminUserChange:
    view = await _with_current(
        api.use_cases.administration.deactivate_user.execute(actor, staff_id, body.expected_version)
    )
    return AdminUserChange.from_view(view)


@router.post(
    "/users/{staffId}/reactivate",
    response_model=AdminUserChange,
    summary="Reactivate an account (she starts En pausa; her old password works again)",
    responses=problem_responses(401, 403, 404, 409, 422),
)
async def reactivate_user(
    staff_id: StaffId, body: VersionRequest, actor: Admin, api: ApiContextDep
) -> AdminUserChange:
    view = await _with_current(
        api.use_cases.administration.reactivate_user.execute(actor, staff_id, body.expected_version)
    )
    return AdminUserChange.from_view(view)


@router.post(
    "/users/{staffId}/unlock",
    response_model=AdminUserChange,
    summary="Unlock a locked account (resets the failed-attempt counter)",
    description="`changed: false` when the counter was already clear.",
    responses=problem_responses(401, 403, 404),
)
async def unlock_user(staff_id: StaffId, actor: Admin, api: ApiContextDep) -> AdminUserChange:
    view = await api.use_cases.administration.unlock_user.execute(actor, staff_id)
    return AdminUserChange.from_view(view)


@router.post(
    "/users/{staffId}/password-reset",
    response_model=PasswordResetLinkSent,
    summary="Email her a link to set a new password (one hour); her sessions end now",
    description=(
        "Part 4: nobody but her sees the new password. Checks: 403 · 404 · "
        "`self_change_forbidden` (`reset_own_password`) · `staff_invited` (she never "
        "activated her account: resend the invitation) · `staff_inactive`. Her sessions and "
        "pending sign-ins end now (sockets 4401) and a lock is cleared; her current password "
        "works until she sets the new one. Not idempotent: each call sends a new link and the "
        "previous one stops working."
    ),
    responses=problem_responses(401, 403, 404, 409, 422),
)
async def reset_password(
    staff_id: StaffId, actor: Admin, api: ApiContextDep
) -> PasswordResetLinkSent:
    view = await api.use_cases.administration.reset_password.execute(actor, staff_id)
    return PasswordResetLinkSent.from_view(view)


@router.post(
    "/users/{staffId}/invitation/resend",
    response_model=AdminUserChange,
    summary="Send her invitation again: a new link for 48 hours, the previous one stops working",
    description=(
        "Part 4. Pending or expired invitations only (409 `invalid_transition` once she "
        "activated the account or the invitation was cancelled)."
    ),
    responses=problem_responses(401, 403, 404, 409),
)
async def resend_invitation(staff_id: StaffId, actor: Admin, api: ApiContextDep) -> AdminUserChange:
    view = await api.use_cases.administration.resend_invitation.execute(actor, staff_id)
    return AdminUserChange.from_view(view)


@router.post(
    "/users/{staffId}/invitation/cancel",
    response_model=AdminUserChange,
    summary="Cancel her invitation: the link stops working and the account is not created",
    description=(
        "Part 4. Pending or expired invitations only (409 `invalid_transition` otherwise). "
        "She leaves the directory list (`status: cancelled`); inviting the same email again "
        "reuses her record."
    ),
    responses=problem_responses(401, 403, 404, 409),
)
async def cancel_invitation(staff_id: StaffId, actor: Admin, api: ApiContextDep) -> AdminUserChange:
    view = await api.use_cases.administration.cancel_invitation.execute(actor, staff_id)
    return AdminUserChange.from_view(view)


# ----------------------------------------------------------------------------- teams
@router.get(
    "/teams",
    response_model=AdminTeamList,
    summary="Teams with their member counts",
    responses=problem_responses(401, 403, 422),
)
async def list_teams(
    actor: Admin,
    api: ApiContextDep,
    status_filter: Annotated[TeamStatusFilter, Query(alias="status")] = TeamStatusFilter.ACTIVE,
) -> AdminTeamList:
    view = await api.use_cases.administration.list_teams.execute(actor, status_filter)
    return AdminTeamList.from_view(view)


@router.get(
    "/teams/{teamId}",
    response_model=AdminTeamDetail,
    summary="One team and its members (active first, then inactive)",
    responses=problem_responses(401, 403, 404),
)
async def get_team(team_id: TeamId, actor: Admin, api: ApiContextDep) -> AdminTeamDetail:
    view = await api.use_cases.administration.get_team.execute(actor, team_id)
    return AdminTeamDetail.from_view(view)


@router.post(
    "/teams",
    response_model=AdminTeam,
    status_code=status.HTTP_201_CREATED,
    summary="Create a team",
    description=(
        "Names are unique among all teams, ignoring case and accents (409 `team_name_taken`)."
    ),
    responses={
        200: {"description": "Idempotent replay of an existing team", "model": AdminTeam},
        **problem_responses(401, 403, 409, 422),
    },
)
async def create_team(
    *,
    body: CreateTeamRequest,
    actor: Admin,
    api: ApiContextDep,
    response: Response,
    idempotency_key: CreationKey = None,
) -> AdminTeam:
    result = await api.use_cases.administration.create_team.execute(
        actor, body.name, idempotency_key=idempotency_key
    )
    _replayed(response, result.replayed)
    return AdminTeam.from_view(result.team)


@router.patch(
    "/teams/{teamId}",
    response_model=AdminTeamChange,
    summary="Rename a team",
    responses=problem_responses(401, 403, 404, 409, 422),
)
async def rename_team(
    team_id: TeamId, body: RenameTeamRequest, actor: Admin, api: ApiContextDep
) -> AdminTeamChange:
    view = await _with_current(
        api.use_cases.administration.rename_team.execute(
            actor, team_id, body.expected_version, body.name
        )
    )
    return AdminTeamChange.from_view(view)


@router.post(
    "/teams/{teamId}/deactivate",
    response_model=AdminTeamChange,
    summary="Deactivate a team without active members",
    description="With active members: 409 `team_not_empty` with `memberCount`.",
    responses=problem_responses(401, 403, 404, 409, 422),
)
async def deactivate_team(
    team_id: TeamId, body: VersionRequest, actor: Admin, api: ApiContextDep
) -> AdminTeamChange:
    view = await _with_current(
        api.use_cases.administration.deactivate_team.execute(actor, team_id, body.expected_version)
    )
    return AdminTeamChange.from_view(view)


@router.post(
    "/teams/{teamId}/reactivate",
    response_model=AdminTeamChange,
    summary="Reactivate a team",
    responses=problem_responses(401, 403, 404, 409, 422),
)
async def reactivate_team(
    team_id: TeamId, body: VersionRequest, actor: Admin, api: ApiContextDep
) -> AdminTeamChange:
    view = await _with_current(
        api.use_cases.administration.reactivate_team.execute(actor, team_id, body.expected_version)
    )
    return AdminTeamChange.from_view(view)
