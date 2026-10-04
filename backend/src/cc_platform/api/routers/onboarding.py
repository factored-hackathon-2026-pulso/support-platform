"""Public onboarding routes (part 4): the invitation and password-reset links.

No session: the link's token (in the JSON body, never in the URL) is the only credential.
A token that is unknown, expired, used or cancelled always answers 410 ``link_invalid``;
too many of those from one client answer 429 ``rate_limited`` (``unlockAt``). See
``docs/platform/api/slice-11-invitations.md``.
"""

from __future__ import annotations

from fastapi import APIRouter, Request

from cc_platform.api.dependencies import ApiContextDep
from cc_platform.api.schemas.common import problem_responses
from cc_platform.api.schemas.onboarding import (
    ActivatedAccount,
    ActivateRequest,
    InvitationCheck,
    LinkTokenRequest,
    NewPasswordRequest,
    PasswordResetCheck,
    PasswordResetDone,
    TotpEnrollment,
)
from cc_platform.application.people.onboarding.dto import ActivateCommand, SetPasswordCommand

router = APIRouter(prefix="/onboarding", tags=["onboarding"])


def _client(request: Request) -> str:
    """The rate-limit key: the client address (behind a proxy, configure uvicorn's
    ``--forwarded-allow-ips`` so this is the real one)."""
    return request.client.host if request.client is not None else "unknown"


@router.post(
    "/invitations/check",
    response_model=InvitationCheck,
    summary="Is this invitation link usable? Who does it invite?",
    responses=problem_responses(410, 422, 429),
)
async def check_invitation(
    body: LinkTokenRequest, request: Request, api: ApiContextDep
) -> InvitationCheck:
    view = await api.use_cases.onboarding.check_invitation.execute(
        body.token, client=_client(request)
    )
    return InvitationCheck.from_view(view)


@router.post(
    "/invitations/password",
    response_model=TotpEnrollment,
    summary="Step 1: her password; returns her authenticator setup (shown once)",
    description=(
        "The password policy is checked here (422 `password_rejected` with `reasons`). It is "
        "kept (hashed) until the code of step 2; sending it again starts over with a new key."
    ),
    responses=problem_responses(409, 410, 422, 429),
)
async def set_invitation_password(
    body: NewPasswordRequest, request: Request, api: ApiContextDep
) -> TotpEnrollment:
    view = await api.use_cases.onboarding.set_invitation_password.execute(
        SetPasswordCommand(token=body.token, password=body.password), client=_client(request)
    )
    return TotpEnrollment.from_view(view)


@router.post(
    "/invitations/activate",
    response_model=ActivatedAccount,
    summary="Step 2: the first code of her app activates the account",
    description=(
        "A wrong code is 422 `totp_invalid` with `remainingAttempts`; the fifth locks the "
        "invitation for 15 minutes (423 `account_locked` with `unlockAt`). Before step 1: 409 "
        "`invalid_transition`. Success uses the link up: she signs in with her email, her "
        "password and her app; she starts En pausa."
    ),
    responses=problem_responses(409, 410, 422, 423, 429),
)
async def activate_invitation(
    body: ActivateRequest, request: Request, api: ApiContextDep
) -> ActivatedAccount:
    view = await api.use_cases.onboarding.activate_invitation.execute(
        ActivateCommand(token=body.token, code=body.code), client=_client(request)
    )
    return ActivatedAccount.from_view(view)


@router.post(
    "/password-resets/check",
    response_model=PasswordResetCheck,
    summary="Is this password-reset link usable?",
    responses=problem_responses(410, 422, 429),
)
async def check_password_reset(
    body: LinkTokenRequest, request: Request, api: ApiContextDep
) -> PasswordResetCheck:
    view = await api.use_cases.onboarding.check_password_reset.execute(
        body.token, client=_client(request)
    )
    return PasswordResetCheck.from_view(view)


@router.post(
    "/password-resets/complete",
    response_model=PasswordResetDone,
    summary="Her new password (the link is used up; her sessions end)",
    responses=problem_responses(410, 422, 429),
)
async def complete_password_reset(
    body: NewPasswordRequest, request: Request, api: ApiContextDep
) -> PasswordResetDone:
    view = await api.use_cases.onboarding.complete_password_reset.execute(
        SetPasswordCommand(token=body.token, password=body.password), client=_client(request)
    )
    return PasswordResetDone.from_view(view)
