"""Back-office authentication (dev mode): password → MFA → session token."""

from __future__ import annotations

from fastapi import APIRouter, Response, status

from cc_platform.api.dependencies import ApiContextDep, CurrentActor
from cc_platform.api.schemas.auth import (
    LoginRequest,
    LoginResponse,
    MeResponse,
    MfaRequest,
    SessionOut,
    SessionResponse,
)
from cc_platform.api.schemas.common import problem_responses
from cc_platform.api.schemas.people import StaffOut
from cc_platform.api.schemas.platform import PlatformSettings
from cc_platform.application.people.dto import LoginCommand, VerifyMfaCommand

router = APIRouter(prefix="/auth", tags=["auth"])


@router.post(
    "/login",
    response_model=LoginResponse,
    summary="Check email and password; always asks for a second factor",
    description=(
        "Wrong credentials return `invalid_credentials` with `remainingAttempts`; the fifth "
        "consecutive failure returns `account_locked` (423) with `unlockAt`."
    ),
    responses=problem_responses(401, 422, 423),
)
async def login(body: LoginRequest, api: ApiContextDep) -> LoginResponse:
    result = await api.use_cases.people.login.execute(
        LoginCommand(email=body.email, password=body.password)
    )
    return LoginResponse(
        mfa_required=result.mfa_required,
        challenge_id=result.challenge_id,
        expires_at=result.expires_at,
        methods=list(result.methods),
    )


@router.post(
    "/mfa",
    response_model=SessionResponse,
    summary="Verify the second factor and start a session",
    description=(
        "Development code: `000000`. Use the returned token as `Authorization: Bearer`. "
        "A wrong code returns `mfa_invalid` with `remainingAttempts`; wrong codes also count "
        "toward the account lockout, so the failure that reaches it returns `account_locked` "
        "(423) with `unlockAt`, as does any attempt while the account is locked."
    ),
    responses=problem_responses(401, 422, 423),
)
async def verify_mfa(body: MfaRequest, api: ApiContextDep) -> SessionResponse:
    grant = await api.use_cases.people.verify_mfa.execute(
        VerifyMfaCommand(challenge_id=body.challenge_id, code=body.code, method=body.method)
    )
    return SessionResponse(
        token=grant.token,
        session=SessionOut(id=grant.session_id, expires_at=grant.expires_at),
        staff=StaffOut.from_view(grant.staff),
    )


@router.get(
    "/me",
    response_model=MeResponse,
    summary="The signed-in staff member and session",
    responses=problem_responses(401),
)
async def me(actor: CurrentActor, api: ApiContextDep) -> MeResponse:
    current = await api.use_cases.people.current_staff.execute(actor)
    settings = await api.use_cases.platform.settings.execute()
    return MeResponse(
        staff=StaffOut.from_view(current.staff),
        session=SessionOut(id=current.session_id, expires_at=current.session_expires_at),
        platform=PlatformSettings.from_view(settings),
    )


@router.post(
    "/logout",
    status_code=status.HTTP_204_NO_CONTENT,
    response_class=Response,
    summary="End the current session (also closes its realtime sockets)",
    responses=problem_responses(401),
)
async def logout(actor: CurrentActor, api: ApiContextDep) -> Response:
    await api.use_cases.people.logout.execute(actor)
    return Response(status_code=status.HTTP_204_NO_CONTENT)
