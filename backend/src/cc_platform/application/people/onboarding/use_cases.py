"""The public onboarding use cases (part 4), as one bundle the composition root builds.

Routers reach them as ``api.use_cases.onboarding.<name>``.
"""

from __future__ import annotations

from dataclasses import dataclass

from cc_platform.application.people.onboarding.commands import (
    ActivateInvitation,
    CheckInvitation,
    CheckPasswordReset,
    CompletePasswordReset,
    SetInvitationPassword,
)
from cc_platform.application.people.onboarding.dev_mailbox import ListDevMailbox


@dataclass(frozen=True, slots=True)
class OnboardingUseCases:
    check_invitation: CheckInvitation
    set_invitation_password: SetInvitationPassword
    activate_invitation: ActivateInvitation
    check_password_reset: CheckPasswordReset
    complete_password_reset: CompletePasswordReset
    dev_mailbox: ListDevMailbox
