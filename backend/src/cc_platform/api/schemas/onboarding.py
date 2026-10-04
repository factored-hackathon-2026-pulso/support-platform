"""Schemas of the public onboarding routes and the dev mailbox (part 4).

Tokens travel in request bodies, never in URLs (so access logs and proxies never see them).
"""

from __future__ import annotations

from datetime import datetime

from pydantic import Field

from cc_platform.api.schemas.common import ApiModel, RequestModel
from cc_platform.application.people.onboarding.dto import (
    ActivatedAccountView,
    InvitationPreview,
    PasswordResetDoneView,
    PasswordResetPreview,
    TotpEnrollmentView,
)
from cc_platform.application.ports.email import EmailKind, SentEmail
from cc_platform.domain.people.password_policy import MAX_LENGTH, MIN_LENGTH, PasswordRule
from cc_platform.domain.people.staff import StaffRole

_TOKEN = Field(min_length=1, max_length=256, description="The token of the link (?token=).")


class LinkTokenRequest(RequestModel):
    token: str = _TOKEN


class NewPasswordRequest(RequestModel):
    token: str = _TOKEN
    password: str = Field(
        min_length=1,
        max_length=256,
        description=(
            f"Her new password: {MIN_LENGTH}–{MAX_LENGTH} characters, without her email name "
            "or her name, not a common password (else 422 password_rejected with reasons)."
        ),
    )


class ActivateRequest(RequestModel):
    token: str = _TOKEN
    code: str = Field(min_length=1, max_length=16, description="The 6 digits her app shows.")


class PasswordRules(ApiModel):
    """The policy the SPA shows live (the server checks it again)."""

    min_length: int
    max_length: int
    rules: list[PasswordRule] = Field(description="The rules the SPA lists, in order.")

    @classmethod
    def current(cls) -> PasswordRules:
        return cls(
            min_length=MIN_LENGTH,
            max_length=MAX_LENGTH,
            rules=[PasswordRule.MIN_LENGTH, PasswordRule.PERSONAL_INFO, PasswordRule.COMMON],
        )


class InvitationCheck(ApiModel):
    """A valid invitation link: who it invites (the token proves it is hers)."""

    name: str
    email: str
    roles: list[StaffRole]
    team_name: str
    expires_at: datetime
    password_rules: PasswordRules

    @classmethod
    def from_view(cls, view: InvitationPreview) -> InvitationCheck:
        return cls(
            name=view.name,
            email=view.email,
            roles=list(view.roles),
            team_name=view.team_name,
            expires_at=view.expires_at,
            password_rules=PasswordRules.current(),
        )


class TotpEnrollment(ApiModel):
    """Step 2 of the activation, shown once: the QR code content and the manual key."""

    otpauth_uri: str = Field(description="otpauth://totp/… (render it as a QR code).")
    secret: str = Field(description="The base32 key to type by hand (RFC 6238).")
    account_name: str
    issuer: str
    digits: int
    period_seconds: int

    @classmethod
    def from_view(cls, view: TotpEnrollmentView) -> TotpEnrollment:
        return cls(
            otpauth_uri=view.otpauth_uri,
            secret=view.secret,
            account_name=view.account_name,
            issuer=view.issuer,
            digits=view.digits,
            period_seconds=view.period_seconds,
        )


class ActivatedAccount(ApiModel):
    name: str
    email: str

    @classmethod
    def from_view(cls, view: ActivatedAccountView) -> ActivatedAccount:
        return cls(name=view.name, email=view.email)


class PasswordResetCheck(ApiModel):
    name: str
    email: str
    expires_at: datetime
    password_rules: PasswordRules

    @classmethod
    def from_view(cls, view: PasswordResetPreview) -> PasswordResetCheck:
        return cls(
            name=view.name,
            email=view.email,
            expires_at=view.expires_at,
            password_rules=PasswordRules.current(),
        )


class PasswordResetDone(ApiModel):
    email: str
    revoked_sessions: int

    @classmethod
    def from_view(cls, view: PasswordResetDoneView) -> PasswordResetDone:
        return cls(email=view.email, revoked_sessions=view.revoked_sessions)


class DevEmail(ApiModel):
    id: str
    kind: EmailKind
    to: str
    subject: str
    text: str
    link: str
    sent_at: datetime

    @classmethod
    def from_view(cls, view: SentEmail) -> DevEmail:
        return cls(
            id=view.id,
            kind=view.kind,
            to=view.to,
            subject=view.subject,
            text=view.text,
            link=view.link,
            sent_at=view.sent_at,
        )


class DevMailbox(ApiModel):
    items: list[DevEmail] = Field(description="Newest first (at most 50).")
