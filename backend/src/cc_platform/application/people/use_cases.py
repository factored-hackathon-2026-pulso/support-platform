"""The use cases of the people context, as one bundle the composition root builds."""

from __future__ import annotations

from dataclasses import dataclass

from cc_platform.application.people.auth import (
    AuthenticateSession,
    LoginWithPassword,
    Logout,
    VerifyMfa,
)
from cc_platform.application.people.queries import GetCurrentStaff, ListStaff


@dataclass(frozen=True, slots=True)
class PeopleUseCases:
    login: LoginWithPassword
    verify_mfa: VerifyMfa
    authenticate: AuthenticateSession
    logout: Logout
    current_staff: GetCurrentStaff
    list_staff: ListStaff
