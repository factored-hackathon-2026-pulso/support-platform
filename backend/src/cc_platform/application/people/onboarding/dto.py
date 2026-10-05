"""Inputs and outputs of the public onboarding routes (part 4)."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime

from cc_platform.application.ports.email import SentEmail
from cc_platform.domain.people.preferences import DEFAULT_UI_LANGUAGE, UiLanguage
from cc_platform.domain.people.staff import StaffRole


@dataclass(frozen=True, slots=True)
class InvitationPreview:
    """What a valid invitation link shows (the token proves it is hers)."""

    name: str
    email: str
    roles: tuple[StaffRole, ...]
    team_name: str
    expires_at: datetime
    ui_language: UiLanguage = DEFAULT_UI_LANGUAGE
    """Slice 23c: her platform language (the activation screens switch to it)."""


@dataclass(frozen=True, slots=True)
class TotpEnrollmentView:
    """Step 2 of the activation: what her authenticator app needs. Shown once."""

    otpauth_uri: str
    secret: str
    account_name: str
    issuer: str
    digits: int
    period_seconds: int


@dataclass(frozen=True, slots=True)
class ActivatedAccountView:
    name: str
    email: str


@dataclass(frozen=True, slots=True)
class PasswordResetPreview:
    name: str
    email: str
    expires_at: datetime
    ui_language: UiLanguage = DEFAULT_UI_LANGUAGE


@dataclass(frozen=True, slots=True)
class PasswordResetDoneView:
    email: str
    revoked_sessions: int


@dataclass(frozen=True, slots=True)
class SetPasswordCommand:
    token: str
    password: str


@dataclass(frozen=True, slots=True)
class ActivateCommand:
    token: str
    code: str


@dataclass(frozen=True, slots=True)
class DevMailboxView:
    items: tuple[SentEmail, ...]
