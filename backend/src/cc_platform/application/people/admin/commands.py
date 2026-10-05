"""Administration commands on people (slice 4 §3.1–§3.6).

Every command:

- runs its whole body in ``retry_on_conflict`` and re-evaluates every rule on fresh state;
- first re-checks the actor (``fresh_admin``: an active admin, else 403);
- answers ``changed: false`` (no events, no save, same version) when it would change
  nothing;
- saves every aggregate with compare-and-set; events commit in the order they are recorded.

``expectedVersion`` mismatches are ``version_conflict`` and never retried. The rules are
checked in the order the contract lists them (§3.1–§3.5), so the first failing rule is the
one the caller sees.

**Administration never moves cases (§3.6).** Deactivating someone, removing her Analista
role, or removing a language one of her open cases uses is refused with
``staff_has_open_cases`` until supervision reassigns them (``SetCaseAssignee``): one
assignment path, with rule 3, the pause rule and the audit.

Part 4 (secure onboarding): administration never sees or hands out a password. Creating a
person invites her (``Invitation``, a link by email that lasts 48 hours); a forgotten
password is replaced through a reset link (one hour). Emails go out after the commit.

Sessions: deactivation and sending a reset link end every active session in the same Unit
of Work (``SessionTerminator`` then closes her sockets with 4401) and cancel every pending
MFA challenge, so a sign-in that already passed the password step cannot finish. A roles
change ends no session: roles are re-read on her next request, and ``AccessTerminator``
closes her sockets (4409) so they reconnect with the new roles.

Results are read back after commit (``user_view``), as ``GET /admin/users/{id}`` returns
the person.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime

from cc_platform.application.concurrency import retry_on_conflict
from cc_platform.application.people.admin.dto import (
    AdminUserChangeView,
    AdminUserView,
    CreateUserCommand,
    InvitedUserView,
    OpenCasesBlock,
    PasswordResetLinkView,
    SelfChangeAction,
    UpdateUserCommand,
)
from cc_platform.application.people.admin.errors import (
    SelfChangeForbiddenError,
    StaffInactiveError,
)
from cc_platform.application.people.admin.guards import (
    destination_team,
    ensure_languages_not_in_use,
    ensure_no_open_cases,
    ensure_not_self,
    ensure_user_version,
    fresh_admin,
    load_roster,
    load_target,
    open_cases_of,
    store_roster,
)
from cc_platform.application.people.admin.queries import not_found_person, user_view
from cc_platform.application.people.onboarding.mailer import OnboardingMailer
from cc_platform.application.people.preferences import preset_ui_language, ui_language_of
from cc_platform.application.ports.clock import Clock
from cc_platform.application.ports.ids import IdGenerator
from cc_platform.application.ports.security import IssuedToken, OneTimeTokens
from cc_platform.application.ports.unit_of_work import UnitOfWork, UnitOfWorkFactory
from cc_platform.application.security import Actor
from cc_platform.domain.cases.errors import IdempotencyConflictError
from cc_platform.domain.people.availability import AvailabilityChangeReason, AvailabilityStatus
from cc_platform.domain.people.errors import EmailTakenError, StaffInvitedError, TeamInactiveError
from cc_platform.domain.people.invitation import Invitation
from cc_platform.domain.people.password_reset import PasswordReset
from cc_platform.domain.people.preferences import DEFAULT_UI_LANGUAGE, UiLanguage
from cc_platform.domain.people.session import SessionEndReason
from cc_platform.domain.people.staff import (
    Staff,
    StaffEdit,
    StaffProfile,
    StaffRole,
    normalize_email,
)
from cc_platform.domain.people.team import Team
from cc_platform.domain.shared.actor import ActorRef
from cc_platform.domain.shared.errors import InvalidTransitionError, InvalidValueError
from cc_platform.domain.shared.ids import IdPrefix


@dataclass(slots=True)
class _LinkToken:
    """One link token per request, issued once (retries reuse it; only its hash is
    stored, the token itself goes into the email once)."""

    tokens: OneTimeTokens
    _issued: IssuedToken | None = field(default=None, repr=False)  # never logged

    def get(self) -> IssuedToken:
        if self._issued is None:
            self._issued = self.tokens.issue()
        return self._issued


@dataclass(frozen=True, slots=True)
class _Outgoing:
    """What a committed command still has to email (after the commit, never before)."""

    staff: Staff
    team_name: str
    token: str
    language: UiLanguage = DEFAULT_UI_LANGUAGE


async def _read_back(
    uow_factory: UnitOfWorkFactory, staff_id: str, actor: Actor, now: datetime
) -> AdminUserView:
    async with uow_factory() as uow:
        view = await user_view(uow, staff_id, viewer_id=actor.staff_id, now=now)
    if view is None:  # pragma: no cover - people are never deleted
        raise not_found_person(staff_id)
    return view


async def _end_sessions(uow: UnitOfWork, staff_id: str, *, now: datetime, actor: ActorRef) -> int:
    """End her active sessions and withdraw her pending MFA challenges; returns how many
    sessions it ended.

    A pending challenge proves a password step that is no longer valid (the old password
    after a reset; any password before a deactivation), so finishing it must not grant a
    session. Each cancelled challenge is saved with compare-and-set: a ``VerifyMfa`` racing
    this command loses its own challenge save, retries and finds it cancelled
    (``mfa_challenge_invalid``).
    """
    for challenge in await uow.mfa_challenges.list_pending_for(staff_id, now):
        if challenge.cancel(now=now):
            await uow.mfa_challenges.save(challenge)
    sessions = await uow.sessions.list_active_for(staff_id, now)
    for session in sessions:
        session.end(now=now, reason=SessionEndReason.REVOKED, actor=actor)
        await uow.sessions.save(session)
    return len(sessions)


async def _pause(
    uow: UnitOfWork,
    staff_id: str,
    *,
    now: datetime,
    actor: ActorRef,
    reason: AvailabilityChangeReason,
) -> None:
    """Administration leaves an available analyst "En pausa" (she gets no new cases)."""
    availability = await uow.availability.get(staff_id)
    if availability is not None and availability.change(
        AvailabilityStatus.PAUSED, now=now, actor=actor, reason=reason
    ):
        await uow.availability.save(availability)


# ----------------------------------------------------------------------------- create
@dataclass(frozen=True, slots=True)
class CreateUser:
    """``POST /admin/users`` (§3.1, part 4): the person starts ``invited`` (no password, no
    login account) and gets an invitation link by email that lasts 48 hours.

    An email that belongs to a person whose invitation was cancelled is not taken: she is
    invited again (same record and id, her profile updated, a new link). An idempotent
    replay answers the existing person and sends nothing.
    """

    uow: UnitOfWorkFactory
    clock: Clock
    ids: IdGenerator
    tokens: OneTimeTokens
    mailer: OnboardingMailer

    async def execute(self, actor: Actor, command: CreateUserCommand) -> InvitedUserView:
        token = _LinkToken(self.tokens)
        staff_id, outgoing = await retry_on_conflict(lambda: self._attempt(actor, command, token))
        if outgoing is not None:
            await self.mailer.invitation(
                outgoing.staff,
                team_name=outgoing.team_name,
                token=outgoing.token,
                language=outgoing.language,
            )
        user = await _read_back(self.uow, staff_id, actor, self.clock.now())
        return InvitedUserView(user=user, replayed=outgoing is None)

    async def _attempt(
        self, actor: Actor, command: CreateUserCommand, token: _LinkToken
    ) -> tuple[str, _Outgoing | None]:
        now = self.clock.now()
        async with self.uow() as uow:
            admin = await fresh_admin(uow, actor)
            if command.idempotency_key is not None:
                existing = await uow.staff.get_by_creation_key(command.idempotency_key)
                if existing is not None:
                    return _replay(existing, command), None
            # The whole person first (invalid_value), then the email, then the team.
            profile = StaffProfile.of(
                name=command.name,
                email=command.email,
                roles=command.roles,
                languages=command.languages,
            )
            known = await uow.staff.get_by_email(profile.email)
            if known is not None and not known.is_withdrawn:
                raise EmailTakenError()
            team = await destination_team(uow, command.team_id)
            if not team.active:
                raise TeamInactiveError(team.id)

            issued = token.get()
            ttl = self.mailer.invitation_ttl
            if known is None:
                staff = Staff.create(
                    staff_id=self.ids.new_id(IdPrefix.STAFF),
                    name=profile.name,
                    email=profile.email,
                    roles=profile.roles,
                    languages=profile.languages,
                    team=team,
                    now=now,
                    actor=admin,
                    creation_key=command.idempotency_key,
                )
                invitation = Invitation.send(
                    invitation_id=self.ids.new_id(IdPrefix.INVITATION),
                    staff_id=staff.id,
                    token_hash=issued.hash,
                    now=now,
                    actor=admin,
                    ttl=ttl,
                )
                await uow.staff.add(staff)
                await uow.invitations.add(invitation)
            else:
                staff = known
                await _reinvite(uow, staff, profile, team, command, now=now, actor=admin)
                invitation_found = await uow.invitations.get_for_staff(staff.id)
                if invitation_found is None:  # pragma: no cover - a withdrawn person had one
                    raise EmailTakenError()
                invitation_found.reissue(issued.hash, now=now, actor=admin, ttl=ttl)
                await uow.staff.save(staff)
                await uow.invitations.save(invitation_found)
            await preset_ui_language(uow, staff.id, command.ui_language)
            team.touch()  # serialises with a concurrent DeactivateTeam (§3.8)
            await uow.teams.save(team)
            await uow.commit()
        outgoing = _Outgoing(
            staff=staff, team_name=team.name, token=issued.token, language=command.ui_language
        )
        return staff.id, outgoing


async def _reinvite(
    uow: UnitOfWork,
    staff: Staff,
    profile: StaffProfile,
    team: Team,
    command: CreateUserCommand,
    *,
    now: datetime,
    actor: ActorRef,
) -> None:
    """A withdrawn person invited again: her profile becomes the new one (recorded as
    edits), then she is ``invited`` again."""
    edit = staff.plan_edit(
        name=profile.name, roles=profile.roles, languages=profile.languages, team_id=team.id
    )
    from_team_name: str | None = None
    if edit.team_changed:
        current = await uow.teams.get(staff.team_id)
        from_team_name = current.name if current else staff.team_id
    staff.apply_edit(
        edit,
        now=now,
        actor=actor,
        team=team if edit.team_changed else None,
        from_team_name=from_team_name,
    )
    staff.reinvite(creation_key=command.idempotency_key)


def _replay(existing: Staff, command: CreateUserCommand) -> str:
    """Same key + same email → the existing person (200); anything else → 409."""
    try:
        same = normalize_email(command.email) == existing.email
    except InvalidValueError:
        same = False
    if not same:
        raise IdempotencyConflictError("Esa clave ya se usó para crear otra cuenta.")
    return existing.id


# ----------------------------------------------------------------------------- update
@dataclass(frozen=True, slots=True)
class UpdateUser:
    """``PATCH /admin/users/{staffId}`` (§3.2): name, email, roles, languages, team."""

    uow: UnitOfWorkFactory
    clock: Clock

    async def execute(
        self, actor: Actor, staff_id: str, command: UpdateUserCommand
    ) -> AdminUserChangeView:
        changed = await retry_on_conflict(lambda: self._attempt(actor, staff_id, command))
        user = await _read_back(self.uow, staff_id, actor, self.clock.now())
        return AdminUserChangeView(changed=changed, user=user)

    async def _attempt(self, actor: Actor, staff_id: str, command: UpdateUserCommand) -> bool:
        now = self.clock.now()
        async with self.uow() as uow:
            admin = await fresh_admin(uow, actor)  # 1
            target = await load_target(uow, staff_id)  # 2
            await ensure_user_version(  # 3
                uow, target, command.expected_version, actor=actor, now=now
            )
            edit = target.plan_edit(  # 4
                name=command.name,
                email=command.email,
                roles=command.roles,
                languages=command.languages,
                team_id=command.team_id,
            )
            new_team, from_team_name = await _check_email_and_team(uow, target, edit)  # 5, 6
            await _check_guard_rails(uow, actor, target, edit)  # 7, 8, 9

            if not target.apply_edit(  # 10
                edit, now=now, actor=admin, team=new_team, from_team_name=from_team_name
            ):
                return False
            if new_team is not None:
                new_team.touch()  # serialises with a concurrent DeactivateTeam (§3.8)
                await uow.teams.save(new_team)
            if StaffRole.ANALYST in edit.roles_removed:
                await _pause(
                    uow,
                    target.id,
                    now=now,
                    actor=admin,
                    reason=AvailabilityChangeReason.ROLE_REMOVED,
                )
            await uow.staff.save(target)
            await uow.commit()
        return True


async def _check_email_and_team(
    uow: UnitOfWork, target: Staff, edit: StaffEdit
) -> tuple[Team | None, str | None]:
    """Rules 5–6: the new email is free; the new team exists and is active. Returns the
    destination team (``None`` when it does not change) and the current team's name."""
    if "email" in edit.profile_fields:
        other = await uow.staff.get_by_email(edit.email[1])
        if other is not None and other.id != target.id:
            raise EmailTakenError()
    if not edit.team_changed:
        return None, None
    new_team = await destination_team(uow, edit.team_id[1])
    if not new_team.active:
        raise TeamInactiveError(new_team.id)
    current = await uow.teams.get(target.team_id)
    return new_team, current.name if current else target.team_id


async def _check_guard_rails(uow: UnitOfWork, actor: Actor, target: Staff, edit: StaffEdit) -> None:
    """Rules 7–9: not her own admin role; no open case left without an eligible assignee;
    the roster keeps an active admin (saved with CAS, so two demotions serialise)."""
    if target.id == actor.staff_id and StaffRole.ADMIN in edit.roles_removed:
        raise SelfChangeForbiddenError(SelfChangeAction.REMOVE_OWN_ADMIN)
    analyst_removed = StaffRole.ANALYST in edit.roles_removed
    if analyst_removed or edit.languages_removed:
        refs = await open_cases_of(uow, target.id)
        if analyst_removed:
            ensure_no_open_cases(refs, OpenCasesBlock.REMOVE_ANALYST)
        ensure_languages_not_in_use(refs, edit.languages_removed)
    if target.active and StaffRole.ADMIN in edit.roles_added | edit.roles_removed:
        roster, new = await load_roster(uow)
        if StaffRole.ADMIN in edit.roles_added:
            roster.grant(target.id)
        else:
            roster.revoke(target.id)
        await store_roster(uow, roster, new=new)


# ----------------------------------------------------------------------------- lifecycle
@dataclass(frozen=True, slots=True)
class DeactivateUser:
    """``POST /admin/users/{staffId}/deactivate`` (§3.3)."""

    uow: UnitOfWorkFactory
    clock: Clock

    async def execute(
        self, actor: Actor, staff_id: str, expected_version: int
    ) -> AdminUserChangeView:
        revoked = await retry_on_conflict(lambda: self._attempt(actor, staff_id, expected_version))
        user = await _read_back(self.uow, staff_id, actor, self.clock.now())
        return AdminUserChangeView(
            changed=revoked is not None, user=user, revoked_sessions=revoked or 0
        )

    async def _attempt(self, actor: Actor, staff_id: str, expected_version: int) -> int | None:
        """How many sessions it ended; ``None`` when she was already inactive (no-op)."""
        now = self.clock.now()
        async with self.uow() as uow:
            admin = await fresh_admin(uow, actor)
            target = await load_target(uow, staff_id)
            await ensure_user_version(uow, target, expected_version, actor=actor, now=now)
            ensure_not_self(actor, target.id, SelfChangeAction.DEACTIVATE_SELF)
            if not target.active:
                return None
            ensure_no_open_cases(await open_cases_of(uow, target.id), OpenCasesBlock.DEACTIVATE)
            if target.has_role(StaffRole.ADMIN):
                roster, new = await load_roster(uow)
                roster.revoke(target.id)
                await store_roster(uow, roster, new=new)

            sessions = await uow.sessions.list_active_for(target.id, now)
            target.deactivate(revoked_sessions=len(sessions), now=now, actor=admin)
            await _pause(
                uow, target.id, now=now, actor=admin, reason=AvailabilityChangeReason.DEACTIVATED
            )
            revoked = await _end_sessions(uow, target.id, now=now, actor=admin)
            await uow.staff.save(target)
            await uow.commit()
        return revoked


@dataclass(frozen=True, slots=True)
class ReactivateUser:
    """``POST /admin/users/{staffId}/reactivate`` (§3.4): she starts En pausa."""

    uow: UnitOfWorkFactory
    clock: Clock

    async def execute(
        self, actor: Actor, staff_id: str, expected_version: int
    ) -> AdminUserChangeView:
        changed = await retry_on_conflict(lambda: self._attempt(actor, staff_id, expected_version))
        user = await _read_back(self.uow, staff_id, actor, self.clock.now())
        return AdminUserChangeView(changed=changed, user=user)

    async def _attempt(self, actor: Actor, staff_id: str, expected_version: int) -> bool:
        now = self.clock.now()
        async with self.uow() as uow:
            admin = await fresh_admin(uow, actor)
            target = await load_target(uow, staff_id)
            await ensure_user_version(uow, target, expected_version, actor=actor, now=now)
            if target.active:
                return False
            if target.is_invited or target.is_withdrawn:
                raise StaffInvitedError()
            team = await uow.teams.get(target.team_id)
            if team is None or not team.active:
                raise TeamInactiveError(target.team_id)
            if target.has_role(StaffRole.ADMIN):
                roster, new = await load_roster(uow)
                roster.grant(target.id)
                await store_roster(uow, roster, new=new)
            target.reactivate(team, now=now, actor=admin)
            team.touch()  # an active member again: serialise with DeactivateTeam (§3.8)
            await uow.teams.save(team)
            await uow.staff.save(target)
            await uow.commit()
        return True


# ----------------------------------------------------------------------------- login account
@dataclass(frozen=True, slots=True)
class UnlockAccount:
    """``POST /admin/users/{staffId}/unlock`` (§3.5). Inactive accounts too (harmless)."""

    uow: UnitOfWorkFactory
    clock: Clock

    async def execute(self, actor: Actor, staff_id: str) -> AdminUserChangeView:
        changed = await retry_on_conflict(lambda: self._attempt(actor, staff_id))
        user = await _read_back(self.uow, staff_id, actor, self.clock.now())
        return AdminUserChangeView(changed=changed, user=user)

    async def _attempt(self, actor: Actor, staff_id: str) -> bool:
        now = self.clock.now()
        async with self.uow() as uow:
            admin = await fresh_admin(uow, actor)
            target = await load_target(uow, staff_id)
            account = await uow.login_accounts.get(target.id)
            if account is None or not account.unlock(now=now, actor=admin):
                return False
            await uow.login_accounts.save(account)
            await uow.commit()
        return True


@dataclass(frozen=True, slots=True)
class SendPasswordResetLink:
    """``POST /admin/users/{staffId}/password-reset`` (part 4): a link to set a new password
    by email (one hour); administration never sees a password. Her sessions end now, her
    pending MFA challenges are cancelled and a lock is cleared. Her current password keeps
    working until she sets the new one. Not idempotent: each call sends a new link (the
    previous one stops working)."""

    uow: UnitOfWorkFactory
    clock: Clock
    ids: IdGenerator
    tokens: OneTimeTokens
    mailer: OnboardingMailer

    async def execute(self, actor: Actor, staff_id: str) -> PasswordResetLinkView:
        token = _LinkToken(self.tokens)
        staff, revoked, expires_at, language = await retry_on_conflict(
            lambda: self._attempt(actor, staff_id, token)
        )
        await self.mailer.password_reset(staff, token=token.get().token, language=language)
        user = await _read_back(self.uow, staff_id, actor, self.clock.now())
        return PasswordResetLinkView(user=user, revoked_sessions=revoked, expires_at=expires_at)

    async def _attempt(
        self, actor: Actor, staff_id: str, token: _LinkToken
    ) -> tuple[Staff, int, datetime, UiLanguage]:
        now = self.clock.now()
        async with self.uow() as uow:
            admin = await fresh_admin(uow, actor)
            target = await load_target(uow, staff_id)
            ensure_not_self(actor, target.id, SelfChangeAction.RESET_OWN_PASSWORD)
            if target.is_invited or target.is_withdrawn:
                raise StaffInvitedError()
            if not target.active:
                raise StaffInactiveError()
            account = await uow.login_accounts.get(target.id)
            if account is None:  # pragma: no cover - every active person has a login account
                raise not_found_person(target.id)
            cleared_lock = account.clear_attempts(now=now)
            sessions = await uow.sessions.list_active_for(target.id, now)
            issued, ttl = token.get(), self.mailer.reset_ttl
            reset = await uow.password_resets.get_for_staff(target.id)
            if reset is None:
                reset = PasswordReset.issue(
                    reset_id=self.ids.new_id(IdPrefix.PASSWORD_RESET),
                    staff_id=target.id,
                    token_hash=issued.hash,
                    now=now,
                    actor=admin,
                    revoked_sessions=len(sessions),
                    cleared_lock=cleared_lock,
                    ttl=ttl,
                )
                await uow.password_resets.add(reset)
            else:
                reset.reissue(
                    issued.hash,
                    now=now,
                    actor=admin,
                    revoked_sessions=len(sessions),
                    cleared_lock=cleared_lock,
                    ttl=ttl,
                )
                await uow.password_resets.save(reset)
            revoked = await _end_sessions(uow, target.id, now=now, actor=admin)
            await uow.login_accounts.save(account)
            language = await ui_language_of(uow, target.id)
            await uow.commit()
        return target, revoked, reset.expires_at, language


# ----------------------------------------------------------------------------- invitations
async def _invited_target(uow: UnitOfWork, staff_id: str) -> tuple[Staff, Invitation]:
    """The person addressed by an invitation command: she must still be invited."""
    target = await load_target(uow, staff_id)
    invitation = await uow.invitations.get_for_staff(target.id)
    if not target.is_invited or invitation is None:
        raise InvalidTransitionError("Esta persona no tiene una invitación pendiente.")
    return target, invitation


@dataclass(frozen=True, slots=True)
class ResendInvitation:
    """``POST /admin/users/{staffId}/invitation/resend`` (part 4): a new link (pending or
    expired invitation); the previous one stops working and the 48 hours start again."""

    uow: UnitOfWorkFactory
    clock: Clock
    tokens: OneTimeTokens
    mailer: OnboardingMailer

    async def execute(self, actor: Actor, staff_id: str) -> AdminUserChangeView:
        token = _LinkToken(self.tokens)
        outgoing = await retry_on_conflict(lambda: self._attempt(actor, staff_id, token))
        await self.mailer.invitation(
            outgoing.staff,
            team_name=outgoing.team_name,
            token=outgoing.token,
            language=outgoing.language,
        )
        user = await _read_back(self.uow, staff_id, actor, self.clock.now())
        return AdminUserChangeView(changed=True, user=user)

    async def _attempt(self, actor: Actor, staff_id: str, token: _LinkToken) -> _Outgoing:
        now = self.clock.now()
        async with self.uow() as uow:
            admin = await fresh_admin(uow, actor)
            target, invitation = await _invited_target(uow, staff_id)
            issued = token.get()
            invitation.resend(issued.hash, now=now, actor=admin, ttl=self.mailer.invitation_ttl)
            team = await uow.teams.get(target.team_id)
            await uow.invitations.save(invitation)
            language = await ui_language_of(uow, target.id)
            await uow.commit()
        return _Outgoing(
            staff=target,
            team_name=team.name if team else "",
            token=issued.token,
            language=language,
        )


@dataclass(frozen=True, slots=True)
class CancelInvitation:
    """``POST /admin/users/{staffId}/invitation/cancel`` (part 4): the link stops working and
    the account is not created. She leaves the directory (``cancelled``); inviting her email
    again ("Nuevo usuario") reuses her record."""

    uow: UnitOfWorkFactory
    clock: Clock

    async def execute(self, actor: Actor, staff_id: str) -> AdminUserChangeView:
        await retry_on_conflict(lambda: self._attempt(actor, staff_id))
        user = await _read_back(self.uow, staff_id, actor, self.clock.now())
        return AdminUserChangeView(changed=True, user=user)

    async def _attempt(self, actor: Actor, staff_id: str) -> None:
        now = self.clock.now()
        async with self.uow() as uow:
            admin = await fresh_admin(uow, actor)
            target, invitation = await _invited_target(uow, staff_id)
            invitation.cancel(now=now, actor=admin)
            target.withdraw()
            await uow.invitations.save(invitation)
            await uow.staff.save(target)
            await uow.commit()
