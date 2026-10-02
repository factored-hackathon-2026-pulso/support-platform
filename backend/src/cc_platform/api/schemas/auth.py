"""Authentication schemas."""

from __future__ import annotations

from datetime import datetime
from typing import Literal

from pydantic import Field

from cc_platform.api.schemas.common import ApiModel, RequestModel
from cc_platform.api.schemas.people import StaffOut
from cc_platform.domain.people.mfa import MfaMethod


class LoginRequest(RequestModel):
    email: str = Field(min_length=3, max_length=320, examples=["daniela.rios@latambank.example"])
    password: str = Field(min_length=1, max_length=256, examples=["demo1234"])


class LoginResponse(ApiModel):
    mfa_required: bool
    challenge_id: str
    expires_at: datetime
    methods: list[MfaMethod]


class MfaRequest(RequestModel):
    challenge_id: str = Field(min_length=1, max_length=64)
    code: str = Field(min_length=4, max_length=32, examples=["000000"])
    method: MfaMethod = MfaMethod.TOTP


class SessionOut(ApiModel):
    id: str
    expires_at: datetime


class SessionResponse(ApiModel):
    token: str
    token_type: Literal["Bearer"] = "Bearer"  # noqa: S105 - token scheme name, not a secret
    session: SessionOut
    staff: StaffOut


class MeResponse(ApiModel):
    staff: StaffOut
    session: SessionOut
