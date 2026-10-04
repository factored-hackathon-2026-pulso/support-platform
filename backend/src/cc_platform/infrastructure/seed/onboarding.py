"""Seeded invitations (part 4): two people who came in by email, through the domain.

- **Tatiana Rojas** (Analista, español, Equipo Andes): Valeria invited her two days before
  the first seed and she accepted one hour before it (password ``demo1234``, an authenticator
  with the documented key ``TATIANA_TOTP_SECRET``). Her ``staff.invitation_accepted`` is the
  administrators' "Invitación aceptada: Tatiana Rojas" notification. She has **no** dev
  code: she signs in with a code computed from that key (an authenticator app, ``oathtool``
  or ``pyotp``), like every invited person.
- **Bruna Esteves** (Analista, portugués, Equipo Andes): Valeria invited her three hours
  before the first seed; the invitation is pending (it expires 45 hours after the seed). Her
  invitation email (with a fresh link) is in the dev mailbox after the first start.

Every other seeded account keeps ``demo1234`` and the development code ``000000``.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime, timedelta

from cc_platform.application.ports.security import OneTimeTokens, PasswordHasher, SecretBox
from cc_platform.application.ports.unit_of_work import UnitOfWork
from cc_platform.domain.people.invitation import INVITATION_TTL, Invitation
from cc_platform.domain.people.login_account import LoginAccount
from cc_platform.domain.people.staff import Staff
from cc_platform.domain.people.team import Team
from cc_platform.domain.shared.actor import ActorRef, ActorRole
from cc_platform.domain.shared.ids import BODY_LENGTH, IdPrefix, make_id
from cc_platform.infrastructure.seed.people import (
    DEMO_PASSWORD,
    ES,
    PT,
    TEAM_ANDES,
    VALERIA,
    A,
    StaffSeed,
)
from cc_platform.infrastructure.seed.timeline import SeedTimeline

#: Tatiana's authenticator key (RFC 6238 test key from the canvas board). Documented in the
#: runbook so the demo can add it to an app; never a real account's key.
TATIANA_TOTP_SECRET = "JBSWY3DPEHPK3PXP"

TATIANA = StaffSeed(14, "Tatiana Rojas", "tatiana.rojas", frozenset({A}), frozenset({ES}),
                    TEAM_ANDES)  # fmt: skip
BRUNA = StaffSeed(15, "Bruna Esteves", "bruna.esteves", frozenset({A}), frozenset({PT}),
                  TEAM_ANDES)  # fmt: skip

TATIANA_INVITED_BEFORE = timedelta(days=2)
TATIANA_ACCEPTED_BEFORE = timedelta(hours=1)
BRUNA_INVITED_BEFORE = timedelta(hours=3)


def seed_invitation_id(number: int) -> str:
    return make_id(IdPrefix.INVITATION, str(number).zfill(BODY_LENGTH))


@dataclass(frozen=True, slots=True)
class PendingInvitationEmail:
    """An invitation the seed created: its email goes out after the seed commits."""

    staff: Staff
    team_name: str
    token: str


@dataclass(slots=True)
class SeedOnboarding:
    """What the seed needs to invite people like administration does."""

    hasher: PasswordHasher
    tokens: OneTimeTokens
    box: SecretBox
    emails: list[PendingInvitationEmail] = field(default_factory=list)


def _valeria() -> ActorRef:
    return ActorRef(ActorRole.ADMIN, VALERIA.id)


async def add_demo_invitations(
    unit: UnitOfWork, t: datetime, timeline: SeedTimeline, *, onboarding: SeedOnboarding
) -> int:
    """Tatiana (accepted) and Bruna (pending), once (marker: Bruna exists). Returns 1 when
    it ran. Bruna's invitation email is queued on ``onboarding.emails``."""
    if await unit.staff.get(BRUNA.id) is not None:
        return 0
    team = await unit.teams.get(TEAM_ANDES.id)
    if team is None:  # pragma: no cover - the staff seed creates the teams first
        return 0

    # Tatiana: invited at T−2d, accepted at T−1h.
    invited_at = t - TATIANA_INVITED_BEFORE
    tatiana = _invited(TATIANA, now=invited_at, team=team)
    invitation = Invitation.send(
        invitation_id=seed_invitation_id(TATIANA.number),
        staff_id=tatiana.id,
        token_hash=onboarding.tokens.issue().hash,  # the link was used: nobody needs it
        now=invited_at,
        actor=_valeria(),
        ttl=INVITATION_TTL,
    )
    accepted_at = t - TATIANA_ACCEPTED_BEFORE
    herself = ActorRef(ActorRole.ANALYST, tatiana.id)
    sealed = onboarding.box.seal(TATIANA_TOTP_SECRET)
    password_hash = await onboarding.hasher.hash(DEMO_PASSWORD)
    invitation.start_enrollment(password_hash=password_hash, totp_secret=sealed, now=accepted_at)
    tatiana.activate(team)
    account = LoginAccount.open(
        staff_id=tatiana.id,
        password_hash=password_hash,
        totp_secret=sealed,
        now=accepted_at,
        actor=herself,
    )
    invitation.accept(now=accepted_at, actor=herself)
    await unit.staff.add(tatiana)
    await unit.invitations.add(invitation)
    await unit.login_accounts.add(account)
    timeline.take(tatiana, invitation, account)

    # Bruna: invited at T−3h, pending.
    bruna_at = t - BRUNA_INVITED_BEFORE
    bruna = _invited(BRUNA, now=bruna_at, team=team)
    issued = onboarding.tokens.issue()
    pending = Invitation.send(
        invitation_id=seed_invitation_id(BRUNA.number),
        staff_id=bruna.id,
        token_hash=issued.hash,
        now=bruna_at,
        actor=_valeria(),
        ttl=INVITATION_TTL,
    )
    await unit.staff.add(bruna)
    await unit.invitations.add(pending)
    timeline.take(bruna, pending)
    onboarding.emails.append(
        PendingInvitationEmail(staff=bruna, team_name=team.name, token=issued.token)
    )
    return 1


def _invited(seed: StaffSeed, *, now: datetime, team: Team) -> Staff:
    return Staff.create(
        staff_id=seed.id,
        name=seed.name,
        email=seed.email,
        roles=seed.roles,
        languages=seed.languages,
        team=team,
        now=now,
        actor=_valeria(),
    )
