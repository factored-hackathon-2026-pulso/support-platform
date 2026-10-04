"""Administration use cases (slice 4 §3, §4) over the real composition and the seed:
every rule table in order, the effects, idempotent creates, the read models and the
guard rails."""

from __future__ import annotations

from datetime import timedelta
from typing import Any

import pytest

from cc_platform.application.errors import (
    AuthenticationRequiredError,
    ForbiddenError,
    InvalidCredentialsError,
    VersionConflictError,
)
from cc_platform.application.people.admin.dto import (
    AccountStatus,
    AdminTeamView,
    AdminUserView,
    CreateUserCommand,
    InvitationStatus,
    OpenCasesBlock,
    SelfChangeAction,
    TeamStatusFilter,
    UpdateUserCommand,
    UserFilters,
    UserStatusFilter,
)
from cc_platform.application.people.admin.errors import (
    SelfChangeForbiddenError,
    StaffHasOpenCasesError,
    StaffInactiveError,
)
from cc_platform.application.people.dto import LoginCommand, VerifyMfaCommand
from cc_platform.application.people.onboarding.errors import LinkInvalidError
from cc_platform.application.security import Actor
from cc_platform.bootstrap.container import Container
from cc_platform.domain.cases.errors import IdempotencyConflictError
from cc_platform.domain.people.admin_roster import AdminRoster
from cc_platform.domain.people.availability import AvailabilityStatus
from cc_platform.domain.people.errors import (
    EmailTakenError,
    LastAdminError,
    MfaChallengeInvalidError,
    StaffInvitedError,
    TeamInactiveError,
    TeamNameTakenError,
    TeamNotEmptyError,
)
from cc_platform.domain.people.staff import Language, StaffRole
from cc_platform.domain.shared.errors import InvalidValueError, NotFoundError
from cc_platform.infrastructure.clock import FixedClock
from cc_platform.infrastructure.seed.cases import seed_case_id
from cc_platform.infrastructure.seed.people import seed_staff_id, seed_team_id
from tests.support import (
    ADMIN,
    ADMIN_ONLY,
    ANALYST,
    ANDRES,
    INVITED_PASSWORD,
    MARIANA,
    PASSWORD,
    SUPERVISOR,
    TEAM_LEAD,
    TOMAS,
    FixedLinkTokens,
    activate_invited,
    actor_for,
    latest_link,
    make_available_quietly,
    memory_container,
)

A, S, AD = StaffRole.ANALYST, StaffRole.SUPERVISOR, StaffRole.ADMIN
ES, PT = Language.SPANISH, Language.PORTUGUESE
ANDES, PACIFICO, PLATFORM, CARIBE = (seed_team_id(n) for n in (1, 2, 3, 4))
DANIELA_ID, JULIAN_ID, TOMAS_ID, FELIPE_ID = (seed_staff_id(n) for n in (1, 2, 8, 11))
VALERIA_ID, CAROLINA_ID = seed_staff_id(7), seed_staff_id(9)
MARIANA_ID, ANDRES_ID = seed_staff_id(12), seed_staff_id(13)
TATIANA_ID, BRUNA_ID = seed_staff_id(14), seed_staff_id(15)


@pytest.fixture
async def setup() -> tuple[Container, FixedLinkTokens]:
    tokens = FixedLinkTokens()
    return await memory_container(tokens=tokens), tokens


@pytest.fixture
def container(setup: tuple[Container, FixedLinkTokens]) -> Container:
    return setup[0]


@pytest.fixture
def valeria() -> Actor:
    return actor_for(ADMIN_ONLY)


def ana(**overrides: Any) -> CreateUserCommand:
    values: dict[str, Any] = {
        "name": "Ana Gil",
        "email": "ana.gil@latambank.example",
        "roles": (A,),
        "languages": (PT,),
        "team_id": PACIFICO,
    }
    values.update(overrides)
    return CreateUserCommand(**values)


async def user(container: Container, staff_id: str, viewer: Actor) -> AdminUserView:
    return await container.use_cases.administration.get_user.execute(viewer, staff_id)


async def team(container: Container, team_id: str, viewer: Actor) -> AdminTeamView:
    return (await container.use_cases.administration.get_team.execute(viewer, team_id)).team


async def event_types(container: Container, since: int = 0) -> list[str]:
    async with container.uow() as uow:
        page = await uow.event_log.page(limit=1000)
    return [e.event_type for e in page.items if e.sequence > since]


async def last_sequence(container: Container) -> int:
    async with container.uow() as uow:
        page = await uow.event_log.page(limit=1000)
    return page.items[-1].sequence if page.items else 0


async def payloads(container: Container, event_type: str) -> list[dict[str, Any]]:
    async with container.uow() as uow:
        page = await uow.event_log.page(limit=1000)
    return [dict(e.payload) for e in page.items if e.event_type == event_type]


async def sign_in(container: Container, email: str, password: str = PASSWORD) -> str:
    people = container.use_cases.people
    login = await people.login.execute(LoginCommand(email=email, password=password))
    grant = await people.verify_mfa.execute(
        VerifyMfaCommand(challenge_id=login.challenge_id, code="000000")
    )
    return grant.token


async def sign_in_totp(
    container: Container, email: str, secret: str, password: str = INVITED_PASSWORD
) -> str:
    """An invited person signs in: her password and the code of her authenticator."""
    people = container.use_cases.people
    login = await people.login.execute(LoginCommand(email=email, password=password))
    code = container.totp.code_at(secret, container.clock.now())
    grant = await people.verify_mfa.execute(
        VerifyMfaCommand(challenge_id=login.challenge_id, code=code)
    )
    return grant.token


# ----------------------------------------------------------------------------- create
async def test_create_user_invites_her_without_any_password(
    setup: tuple[Container, FixedLinkTokens], valeria: Actor
) -> None:
    container, tokens = setup
    before = await last_sequence(container)
    created = await container.use_cases.administration.create_user.execute(valeria, ana())
    assert not created.replayed
    new = created.user
    assert (new.name, new.email, new.roles, new.languages) == (
        "Ana Gil",
        "ana.gil@latambank.example",
        (A,),
        (PT,),
    )
    assert (new.team.id, new.team.name, new.status, new.version) == (
        PACIFICO,
        "Equipo Pacífico",
        AccountStatus.INVITED,
        1,
    )
    now = container.clock.now()
    assert new.invitation is not None
    assert (new.invitation.status, new.invitation.sent_at, new.invitation.resend_count) == (
        InvitationStatus.PENDING,
        now,
        0,
    )
    assert new.invitation.expires_at == now + timedelta(hours=48)
    assert (new.last_login_at, new.failed_attempts, new.second_factor) == (None, 0, None)
    assert await event_types(container, before) == ["staff.created", "staff.invitation_sent"]
    payload = (await payloads(container, "staff.created"))[-1]
    assert payload == {
        "name": "Ana Gil",
        "roles": ["analyst"],
        "languages": ["pt"],
        "team_id": PACIFICO,
        "team_name": "Equipo Pacífico",
    }
    # No login account, only the token's hash; the email carries the link.
    async with container.uow() as uow:
        assert await uow.login_accounts.get(new.id) is None
        invitation = await uow.invitations.get_for_staff(new.id)
        page = await uow.event_log.page(limit=1000)
    assert invitation is not None
    assert invitation.token_hash == tokens.hash(tokens.issued[-1])
    assert invitation.token_hash != tokens.issued[-1]
    assert all(tokens.issued[-1] not in str(e.payload) for e in page.items)
    assert all("ana.gil@" not in str(e.payload) for e in page.items)
    assert await latest_link(container, "ana.gil@latambank.example") == tokens.issued[-1]
    # She cannot sign in until she accepts it…
    with pytest.raises(InvalidCredentialsError):
        await container.use_cases.people.login.execute(
            LoginCommand(email="ana.gil@latambank.example", password=PASSWORD)
        )
    # …then she signs in with her own password and her authenticator (never 000000).
    secret = await activate_invited(container, "ana.gil@latambank.example")
    activated = await user(container, new.id, valeria)
    assert (activated.status, activated.invitation, activated.second_factor) == (
        AccountStatus.ACTIVE,
        None,
        "totp",
    )
    assert activated.availability is AvailabilityStatus.PAUSED  # no row: starts "En pausa"
    token = await sign_in_totp(container, "ana.gil@latambank.example", secret)
    actor = await container.use_cases.people.authenticate.execute(token)
    assert actor.roles == {A}


@pytest.mark.parametrize(
    ("overrides", "field"),
    [
        ({"name": " A "}, "name"),
        ({"email": "ana.gil"}, "email"),
        ({"roles": ()}, "roles"),
        ({"languages": ()}, "languages"),
        ({"team_id": "TEAM-" + "9" * 26}, "teamId"),
        ({"team_id": "disputas-equipo-andes"}, "teamId"),
    ],
)
async def test_create_user_invalid_values(
    container: Container, valeria: Actor, overrides: dict[str, Any], field: str
) -> None:
    with pytest.raises(InvalidValueError) as error:
        await container.use_cases.administration.create_user.execute(valeria, ana(**overrides))
    assert error.value.details["field"] == field


async def test_create_user_rules_in_order(container: Container, valeria: Actor) -> None:
    create = container.use_cases.administration.create_user
    # A taken email (any case) is checked before the team.
    with pytest.raises(EmailTakenError) as taken:
        await create.execute(valeria, ana(email="Daniela.Rios@LatamBank.example", team_id=CARIBE))
    assert taken.value.details == {"field": "email"}
    with pytest.raises(TeamInactiveError) as inactive:
        await create.execute(valeria, ana(team_id=CARIBE))
    assert inactive.value.details == {"teamId": CARIBE}
    # Validation comes before the email check.
    with pytest.raises(InvalidValueError):
        await create.execute(valeria, ana(email="daniela.rios@latambank.example", roles=()))
    # A non-admin (or a demoted admin) is refused first.
    with pytest.raises(ForbiddenError):
        await create.execute(actor_for(SUPERVISOR), ana(roles=()))


async def test_create_without_languages_is_fine_without_analyst(
    container: Container, valeria: Actor
) -> None:
    created = await container.use_cases.administration.create_user.execute(
        valeria, ana(roles=(S,), languages=())
    )
    assert (created.user.languages, created.user.availability) == ((), None)


async def test_idempotent_create(container: Container, valeria: Actor) -> None:
    create = container.use_cases.administration.create_user
    first = await create.execute(valeria, ana(idempotency_key="create-ana-0001"))
    before = await last_sequence(container)
    again = await create.execute(
        valeria, ana(idempotency_key="create-ana-0001", email=" ANA.GIL@latambank.example")
    )
    assert again.replayed
    assert again.user.id == first.user.id
    assert await event_types(container, before) == []
    assert len(await container.dev_mailbox.latest(200)) == 2  # Bruna's (seed) and Ana's
    with pytest.raises(IdempotencyConflictError) as conflict:
        await create.execute(
            valeria, ana(idempotency_key="create-ana-0001", email="otra@latambank.example")
        )
    assert conflict.value.code == "idempotency_conflict"
    # Without a key a retry is a plain duplicate.
    with pytest.raises(EmailTakenError):
        await create.execute(valeria, ana())


async def test_an_invited_admin_joins_the_roster_when_she_activates(
    container: Container, valeria: Actor
) -> None:
    created = await container.use_cases.administration.create_user.execute(
        valeria, ana(roles=(AD,), languages=())
    )

    async def roster_ids() -> frozenset[str]:
        async with container.uow() as uow:
            roster = await uow.admin_roster.get()
        assert roster is not None
        return roster.admin_ids

    assert await roster_ids() == {VALERIA_ID, CAROLINA_ID}  # invited: not an active admin yet
    await activate_invited(container, "ana.gil@latambank.example")
    assert await roster_ids() == {VALERIA_ID, CAROLINA_ID, created.user.id}


# ----------------------------------------------------------------------------- update
async def test_update_rules_in_order(container: Container, valeria: Actor) -> None:
    update = container.use_cases.administration.update_user
    daniela = await user(container, DANIELA_ID, valeria)
    with pytest.raises(ForbiddenError):
        await update.execute(actor_for(ANALYST), DANIELA_ID, UpdateUserCommand(1, name="X Y"))
    for unknown in ("STF-" + "9" * 26, "nope"):
        with pytest.raises(NotFoundError):
            await update.execute(valeria, unknown, UpdateUserCommand(1, name="Xy"))
    with pytest.raises(VersionConflictError) as stale:
        await update.execute(valeria, DANIELA_ID, UpdateUserCommand(daniela.version + 1, name="Q"))
    assert stale.value.details == {"currentVersion": daniela.version}
    assert stale.value.current_view == daniela  # the record as GET returns it now
    version = daniela.version
    with pytest.raises(InvalidValueError) as invalid:  # 4 before 5
        await update.execute(
            valeria,
            DANIELA_ID,
            UpdateUserCommand(version, name="Q", email="julian.ortega@latambank.example"),
        )
    assert invalid.value.details["field"] == "name"
    with pytest.raises(EmailTakenError):  # 5 before 6
        await update.execute(
            valeria,
            DANIELA_ID,
            UpdateUserCommand(version, email="Julian.Ortega@latambank.example", team_id=CARIBE),
        )
    with pytest.raises(InvalidValueError) as unknown_team:
        await update.execute(valeria, DANIELA_ID, UpdateUserCommand(version, team_id="TEAM-x"))
    assert unknown_team.value.details["field"] == "teamId"
    with pytest.raises(TeamInactiveError):  # 6 before 8
        await update.execute(
            valeria, DANIELA_ID, UpdateUserCommand(version, team_id=CARIBE, roles=(S,))
        )
    with pytest.raises(StaffHasOpenCasesError) as analyst:
        await update.execute(valeria, DANIELA_ID, UpdateUserCommand(version, roles=(S,)))
    assert analyst.value.details["blockReason"] == "remove_analyst"
    assert analyst.value.details["openCases"] == 5
    assert sorted(analyst.value.details["caseIds"]) == [  # type: ignore[arg-type]
        seed_case_id(n) for n in (101, 102, 103, 107, 108)
    ]
    with pytest.raises(StaffHasOpenCasesError) as language:
        await update.execute(valeria, DANIELA_ID, UpdateUserCommand(version, languages=(ES,)))
    assert language.value.details == {
        "blockReason": "remove_language",
        "openCases": 1,
        "caseIds": [seed_case_id(103)],
        "caseLanguage": "pt",
    }
    assert (await user(container, DANIELA_ID, valeria)).version == version  # nothing saved


async def test_update_applies_every_change_in_order(container: Container, valeria: Actor) -> None:
    update = container.use_cases.administration.update_user
    tomas = await user(container, TOMAS_ID, valeria)
    before = await last_sequence(container)
    result = await update.execute(
        valeria,
        TOMAS_ID,
        UpdateUserCommand(
            tomas.version,
            name="Tomás Arango Paz",
            email="tomas.paz@latambank.example",
            roles=(A, S),
            languages=(ES,),
            team_id=ANDES,
        ),
    )
    assert result.changed
    assert result.revoked_sessions == 0
    assert (result.user.name, result.user.roles, result.user.languages, result.user.team.id) == (
        "Tomás Arango Paz",
        (A, S),
        (ES,),
        ANDES,
    )
    assert result.user.version == tomas.version + 1
    assert await event_types(container, before) == [
        "staff.profile_updated",
        "staff.roles_changed",
        "staff.languages_changed",
        "staff.team_changed",
    ]
    moved = (await payloads(container, "staff.team_changed"))[-1]
    assert moved == {
        "from_team_id": PACIFICO,
        "from_team_name": "Equipo Pacífico",
        "to_team_id": ANDES,
        "to_team_name": "Equipo Andes",
    }


async def test_update_without_a_change_is_a_no_op(container: Container, valeria: Actor) -> None:
    tomas = await user(container, TOMAS_ID, valeria)
    before = await last_sequence(container)
    result = await container.use_cases.administration.update_user.execute(
        valeria,
        TOMAS_ID,
        UpdateUserCommand(
            tomas.version, name=" Tomás  Arango ", roles=(A,), languages=(PT, ES), team_id=PACIFICO
        ),
    )
    assert not result.changed
    assert result.user.version == tomas.version
    assert await event_types(container, before) == []


async def test_nobody_removes_their_own_admin_role(container: Container, valeria: Actor) -> None:
    me = await user(container, VALERIA_ID, valeria)
    assert me.guards.is_self
    with pytest.raises(SelfChangeForbiddenError) as error:
        await container.use_cases.administration.update_user.execute(
            valeria, VALERIA_ID, UpdateUserCommand(me.version, roles=(S,))
        )
    assert error.value.details == {"action": "remove_own_admin"}
    # Adding a role to herself is fine.
    added = await container.use_cases.administration.update_user.execute(
        valeria, VALERIA_ID, UpdateUserCommand(me.version, roles=(S, AD))
    )
    assert added.user.roles == (S, AD)


async def test_removing_analyst_pauses_her_and_keeps_her_sessions(
    container: Container, valeria: Actor
) -> None:
    token = await sign_in(container, TEAM_LEAD.email)
    await make_available_quietly(container.uow, FELIPE_ID)
    felipe = await user(container, FELIPE_ID, valeria)
    before = await last_sequence(container)
    result = await container.use_cases.administration.update_user.execute(
        valeria, FELIPE_ID, UpdateUserCommand(felipe.version, roles=(S,))
    )
    assert (result.user.roles, result.user.availability) == ((S,), None)
    assert await event_types(container, before) == [
        "staff.roles_changed",
        "staff.availability_changed",
    ]
    paused = (await payloads(container, "staff.availability_changed"))[-1]
    assert paused == {"from_status": "available", "to_status": "paused", "reason": "role_removed"}
    # No session ends: the role change applies on his next request.
    actor = await container.use_cases.people.authenticate.execute(token)
    assert actor.roles == {S}
    async with container.uow() as uow:
        row = await uow.availability.get(FELIPE_ID)
    assert row is not None
    assert row.status is AvailabilityStatus.PAUSED


async def test_an_inactive_person_can_be_edited(container: Container, valeria: Actor) -> None:
    andres = await user(container, ANDRES_ID, valeria)
    result = await container.use_cases.administration.update_user.execute(
        valeria, ANDRES_ID, UpdateUserCommand(andres.version, team_id=PACIFICO)
    )
    assert (result.changed, result.user.team.id, result.user.status) == (
        True,
        PACIFICO,
        AccountStatus.INACTIVE,
    )


async def test_last_admin_is_the_domain_backstop(container: Container, valeria: Actor) -> None:
    async with container.uow() as uow:  # a roster that only knows Carolina
        roster = await uow.admin_roster.get()
        assert roster is not None
        roster.admin_ids = frozenset({CAROLINA_ID})
        await uow.admin_roster.save(roster)
        await uow.commit()
    carolina = await user(container, CAROLINA_ID, valeria)
    with pytest.raises(LastAdminError):
        await container.use_cases.administration.update_user.execute(
            valeria, CAROLINA_ID, UpdateUserCommand(carolina.version, roles=(S,))
        )


async def test_two_admins_cannot_demote_each_other(container: Container) -> None:
    valeria, carolina = actor_for(ADMIN_ONLY), actor_for(ADMIN)
    update = container.use_cases.administration.update_user
    target = await user(container, CAROLINA_ID, valeria)
    await update.execute(valeria, CAROLINA_ID, UpdateUserCommand(target.version, roles=(S,)))
    # Carolina's own request now finds her no longer an admin (fresh actor check).
    other = await user(container, VALERIA_ID, carolina)
    with pytest.raises(ForbiddenError):
        await update.execute(carolina, VALERIA_ID, UpdateUserCommand(other.version, roles=(S,)))
    me = await user(container, VALERIA_ID, valeria)
    assert me.guards.last_active_admin
    async with container.uow() as uow:
        roster = await uow.admin_roster.get()
    assert roster is not None
    assert roster.admin_ids == {VALERIA_ID}


async def test_languages_added_drain_the_queue(container: Container, valeria: Actor) -> None:
    # Julián (es) is available; Gabriela's Portuguese case (109) waits. Giving him
    # Portuguese makes him eligible (rule 3), and the queue drains to him.
    await make_available_quietly(container.uow, JULIAN_ID)
    julian = await user(container, JULIAN_ID, valeria)
    await container.use_cases.administration.update_user.execute(
        valeria, JULIAN_ID, UpdateUserCommand(julian.version, languages=(ES, PT))
    )
    await container.background.drain()
    async with container.uow() as uow:
        gabriela = await uow.cases.get(seed_case_id(109))
    assert gabriela is not None
    assert gabriela.assigned_analyst_id == JULIAN_ID


# ----------------------------------------------------------------------------- deactivate
async def test_deactivate_rules(container: Container, valeria: Actor) -> None:
    deactivate = container.use_cases.administration.deactivate_user
    me = await user(container, VALERIA_ID, valeria)
    with pytest.raises(SelfChangeForbiddenError) as self_change:
        await deactivate.execute(valeria, VALERIA_ID, me.version)
    assert self_change.value.details == {"action": "deactivate_self"}
    daniela = await user(container, DANIELA_ID, valeria)
    with pytest.raises(VersionConflictError):
        await deactivate.execute(valeria, DANIELA_ID, daniela.version + 3)
    with pytest.raises(StaffHasOpenCasesError) as blocked:
        await deactivate.execute(valeria, DANIELA_ID, daniela.version)
    assert blocked.value.details["blockReason"] == "deactivate"
    assert blocked.value.details["openCases"] == 5
    andres = await user(container, ANDRES_ID, valeria)
    again = await deactivate.execute(valeria, ANDRES_ID, andres.version)
    assert (again.changed, again.revoked_sessions, again.user.version) == (
        False,
        0,
        andres.version,
    )


async def test_deactivate_ends_sessions_and_pauses(container: Container, valeria: Actor) -> None:
    token = await sign_in(container, TOMAS.email)
    await make_available_quietly(container.uow, TOMAS_ID)
    tomas = await user(container, TOMAS_ID, valeria)
    before = await last_sequence(container)
    result = await container.use_cases.administration.deactivate_user.execute(
        valeria, TOMAS_ID, tomas.version
    )
    assert (result.changed, result.revoked_sessions, result.user.status) == (
        True,
        1,
        AccountStatus.INACTIVE,
    )
    assert await event_types(container, before) == [
        "staff.deactivated",
        "staff.availability_changed",
        "auth.session_ended",
    ]
    assert (await payloads(container, "staff.deactivated"))[-1] == {"revoked_sessions": 1}
    assert (await payloads(container, "staff.availability_changed"))[-1]["reason"] == (
        "deactivated"
    )
    ended = (await payloads(container, "auth.session_ended"))[-1]
    assert ended == {"staff_id": TOMAS_ID, "reason": "revoked"}
    with pytest.raises(AuthenticationRequiredError):
        await container.use_cases.people.authenticate.execute(token)
    with pytest.raises(InvalidCredentialsError):  # same answer as an unknown email
        await container.use_cases.people.login.execute(
            LoginCommand(email=TOMAS.email, password=PASSWORD)
        )


async def test_deactivating_an_admin_leaves_the_roster(
    container: Container, valeria: Actor
) -> None:
    carolina = await user(container, CAROLINA_ID, valeria)
    await container.use_cases.administration.deactivate_user.execute(
        valeria, CAROLINA_ID, carolina.version
    )
    me = await user(container, VALERIA_ID, valeria)
    assert me.guards.last_active_admin
    # Reactivating her grants it back.
    carolina = await user(container, CAROLINA_ID, valeria)
    back = await container.use_cases.administration.reactivate_user.execute(
        valeria, CAROLINA_ID, carolina.version
    )
    assert back.changed
    assert back.user.status is AccountStatus.ACTIVE
    async with container.uow() as uow:
        roster = await uow.admin_roster.get()
    assert isinstance(roster, AdminRoster)
    assert roster.admin_ids == {VALERIA_ID, CAROLINA_ID}


async def test_reactivate(container: Container, valeria: Actor) -> None:
    admin = container.use_cases.administration
    andres = await user(container, ANDRES_ID, valeria)
    back = await admin.reactivate_user.execute(valeria, ANDRES_ID, andres.version)
    assert (back.changed, back.user.status, back.user.availability) == (
        True,
        AccountStatus.ACTIVE,
        AvailabilityStatus.PAUSED,
    )
    noop = await admin.reactivate_user.execute(valeria, ANDRES_ID, back.user.version)
    assert not noop.changed
    # Her old password works again.
    assert await sign_in(container, ANDRES.email)


async def test_reactivating_into_an_inactive_team_is_refused(
    container: Container, valeria: Actor
) -> None:
    admin = container.use_cases.administration
    created = await admin.create_team.execute(valeria, "Equipo Temporal")
    invited = (await admin.create_user.execute(valeria, ana(team_id=created.team.id))).user
    # An invited person is a member too: the team cannot be deactivated under her.
    with pytest.raises(TeamNotEmptyError):
        await admin.deactivate_team.execute(
            valeria, created.team.id, (await team(container, created.team.id, valeria)).version
        )
    with pytest.raises(StaffInvitedError):  # nothing to reactivate before she activates
        await admin.reactivate_user.execute(valeria, invited.id, invited.version)
    await activate_invited(container, "ana.gil@latambank.example")
    person = await user(container, invited.id, valeria)
    off = await admin.deactivate_user.execute(valeria, person.id, person.version)
    current = await team(container, created.team.id, valeria)
    await admin.deactivate_team.execute(valeria, created.team.id, current.version)
    with pytest.raises(TeamInactiveError):
        await admin.reactivate_user.execute(valeria, person.id, off.user.version)


# ----------------------------------------------------------------------------- unlock / reset
async def test_unlock_mariana(container: Container, valeria: Actor) -> None:
    mariana = await user(container, MARIANA_ID, valeria)
    assert (mariana.status, mariana.failed_attempts) == (AccountStatus.LOCKED, 5)
    assert mariana.locked_until == container.clock.now() + timedelta(minutes=13)
    result = await container.use_cases.administration.unlock_user.execute(valeria, MARIANA_ID)
    assert (result.changed, result.user.status, result.user.locked_until) == (
        True,
        AccountStatus.ACTIVE,
        None,
    )
    assert result.user.version == mariana.version  # the profile is untouched
    assert (await payloads(container, "staff.account_unlocked"))[-1] == {
        "was_locked": True,
        "failed_attempts": 5,
    }
    again = await container.use_cases.administration.unlock_user.execute(valeria, MARIANA_ID)
    assert not again.changed
    assert await sign_in(container, MARIANA.email)
    with pytest.raises(NotFoundError):
        await container.use_cases.administration.unlock_user.execute(valeria, "STF-x")


async def test_send_password_reset_link(
    setup: tuple[Container, FixedLinkTokens], valeria: Actor
) -> None:
    container, tokens = setup
    reset = container.use_cases.administration.reset_password
    with pytest.raises(SelfChangeForbiddenError) as self_change:
        await reset.execute(valeria, VALERIA_ID)
    assert self_change.value.details == {"action": "reset_own_password"}
    with pytest.raises(StaffInactiveError):
        await reset.execute(valeria, ANDRES_ID)
    with pytest.raises(StaffInvitedError):  # Bruna never activated her account
        await reset.execute(valeria, BRUNA_ID)
    result = await reset.execute(valeria, MARIANA_ID)
    now = container.clock.now()
    assert (result.revoked_sessions, result.user.status) == (0, AccountStatus.ACTIVE)
    assert result.expires_at == now + timedelta(hours=1)
    (sent,) = await payloads(container, "staff.password_reset_link_sent")
    assert sent["revoked_sessions"] == 0
    assert sent["cleared_lock"] is True
    assert set(sent) == {"reset_id", "expires_at", "revoked_sessions", "cleared_lock"}
    # The link went to her email; her old password still works until she sets a new one.
    token = await latest_link(container, MARIANA.email)
    assert token == tokens.issued[-1]
    assert await sign_in(container, MARIANA.email)
    # Each call sends a new link (the previous one stops working) and ends her sessions.
    second = await reset.execute(valeria, MARIANA_ID)
    assert second.revoked_sessions == 1
    newer = await latest_link(container, MARIANA.email)
    assert newer != token
    onboarding = container.use_cases.onboarding
    with pytest.raises(LinkInvalidError):
        await onboarding.check_password_reset.execute(token, client="test")
    preview = await onboarding.check_password_reset.execute(newer, client="test")
    assert (preview.name, preview.email) == (MARIANA.name, MARIANA.email)


async def test_reset_password_events_and_sessions(container: Container, valeria: Actor) -> None:
    await sign_in(container, TOMAS.email)
    before = await last_sequence(container)
    result = await container.use_cases.administration.reset_password.execute(valeria, TOMAS_ID)
    assert result.revoked_sessions == 1
    assert await event_types(container, before) == [
        "staff.password_reset_link_sent",
        "auth.session_ended",
    ]


async def finish_mfa(container: Container, challenge_id: str) -> str:
    grant = await container.use_cases.people.verify_mfa.execute(
        VerifyMfaCommand(challenge_id=challenge_id, code="000000")
    )
    return grant.token


async def test_reset_password_cancels_a_sign_in_past_the_password_step(
    container: Container, valeria: Actor
) -> None:
    """The old (maybe leaked) password must not finish a sign-in after the reset."""
    login = container.use_cases.people.login
    pending = await login.execute(LoginCommand(email=TOMAS.email, password=PASSWORD))
    await container.use_cases.administration.reset_password.execute(valeria, TOMAS_ID)
    with pytest.raises(MfaChallengeInvalidError):
        await finish_mfa(container, pending.challenge_id)
    async with container.uow() as uow:
        assert await uow.sessions.list_active_for(TOMAS_ID, container.clock.now()) == []
    # A new sign-in still works (the password changes only when he uses the link).
    fresh = await login.execute(LoginCommand(email=TOMAS.email, password=PASSWORD))
    assert await finish_mfa(container, fresh.challenge_id)


async def test_deactivate_then_reactivate_cancels_a_pending_sign_in(
    container: Container, valeria: Actor
) -> None:
    admin = container.use_cases.administration
    pending = await container.use_cases.people.login.execute(
        LoginCommand(email=TOMAS.email, password=PASSWORD)
    )
    tomas = await user(container, TOMAS_ID, valeria)
    off = await admin.deactivate_user.execute(valeria, TOMAS_ID, tomas.version)
    await admin.reactivate_user.execute(valeria, TOMAS_ID, off.user.version)
    with pytest.raises(MfaChallengeInvalidError):
        await finish_mfa(container, pending.challenge_id)
    # Signing in again after the reactivation works.
    assert await sign_in(container, TOMAS.email)


async def test_reset_leaves_other_people_s_sign_ins_alone(
    container: Container, valeria: Actor
) -> None:
    other = await container.use_cases.people.login.execute(
        LoginCommand(email=ANALYST.email, password=PASSWORD)
    )
    await container.use_cases.administration.reset_password.execute(valeria, TOMAS_ID)
    assert await finish_mfa(container, other.challenge_id)


# ----------------------------------------------------------------------------- teams
async def test_team_commands(container: Container, valeria: Actor) -> None:
    admin = container.use_cases.administration
    with pytest.raises(TeamNameTakenError) as taken:
        await admin.create_team.execute(valeria, "  equipo   ANDES ")
    assert taken.value.details == {"field": "name"}
    with pytest.raises(TeamNameTakenError):  # inactive teams keep their name too
        await admin.create_team.execute(valeria, "Equipo Caribe")
    with pytest.raises(InvalidValueError):
        await admin.create_team.execute(valeria, "X")
    created = await admin.create_team.execute(valeria, "Equipo Sur", idempotency_key="team-sur-01")
    assert (created.team.name, created.team.active, created.team.member_count) == (
        "Equipo Sur",
        True,
        0,
    )
    replay = await admin.create_team.execute(valeria, "equipo sur", idempotency_key="team-sur-01")
    assert replay.replayed
    assert replay.team.id == created.team.id
    with pytest.raises(IdempotencyConflictError):
        await admin.create_team.execute(valeria, "Equipo Norte", idempotency_key="team-sur-01")

    rename = admin.rename_team
    with pytest.raises(VersionConflictError) as stale:
        await rename.execute(valeria, created.team.id, 9, "Equipo Austral")
    assert isinstance(stale.value.current_view, AdminTeamView)
    same = await rename.execute(valeria, created.team.id, 1, " Equipo  Sur ")
    assert not same.changed
    with pytest.raises(TeamNameTakenError):
        await rename.execute(valeria, created.team.id, 1, "Administración de la plataforma")
    cased = await rename.execute(valeria, created.team.id, 1, "Equipo SUR")
    assert (cased.changed, cased.team.name, cased.team.version) == (True, "Equipo SUR", 2)

    with pytest.raises(TeamNotEmptyError) as not_empty:
        await admin.deactivate_team.execute(
            valeria, ANDES, (await team(container, ANDES, valeria)).version
        )
    assert not_empty.value.details == {"memberCount": 6}  # Tatiana, and Bruna (invited)
    off = await admin.deactivate_team.execute(valeria, created.team.id, 2)
    assert (off.changed, off.team.active) == (True, False)
    assert not (await admin.deactivate_team.execute(valeria, created.team.id, 3)).changed
    on = await admin.reactivate_team.execute(valeria, created.team.id, 3)
    assert (on.changed, on.team.active) == (True, True)
    with pytest.raises(NotFoundError):
        await admin.reactivate_team.execute(valeria, "TEAM-" + "9" * 26, 1)


async def test_moving_into_a_team_touches_it(container: Container, valeria: Actor) -> None:
    pacifico = await team(container, PACIFICO, valeria)
    tomas = await user(container, TOMAS_ID, valeria)
    await container.use_cases.administration.update_user.execute(
        valeria, TOMAS_ID, UpdateUserCommand(tomas.version, team_id=ANDES)
    )
    assert (await team(container, PACIFICO, valeria)).version == pacifico.version
    assert (await team(container, ANDES, valeria)).version == 2  # the CAS token moved


# ----------------------------------------------------------------------------- queries
async def listing(container: Container, viewer: Actor, **filters: Any) -> Any:
    return await container.use_cases.administration.list_users.execute(
        viewer, UserFilters(**filters)
    )


async def test_directory_filters_and_counts(container: Container, valeria: Actor) -> None:
    every = await listing(container, valeria)
    assert len(every.items) == 13  # the 12 seeded active people and Tatiana
    assert (every.role_counts.all, every.role_counts.analyst) == (13, 7)
    assert (every.role_counts.supervisor, every.role_counts.admin) == (5, 2)
    assert (every.status_counts.active, every.status_counts.locked) == (13, 1)
    assert (every.status_counts.invited, every.status_counts.inactive) == (1, 1)
    assert every.status_counts.all == 15
    names = [item.name for item in every.items]
    assert names == sorted(names, key=lambda n: n.replace("Á", "A"))
    assert "Mariana Duque" in names  # active includes locked
    assert "Andrés Villamil" not in names

    found = await listing(container, valeria, query="ANDRES", status=UserStatusFilter.ALL)
    assert [i.name for i in found.items] == ["Andrés Villamil"]
    assert [i.id for i in (await listing(container, valeria, query="0000012")).items] == [
        MARIANA_ID
    ]
    assert [i.name for i in (await listing(container, valeria, query="pena@")).items] == [
        "Carolina Peña"
    ]
    locked = await listing(container, valeria, status=UserStatusFilter.LOCKED)
    assert [i.name for i in locked.items] == ["Mariana Duque"]
    inactive = await listing(container, valeria, status=UserStatusFilter.INACTIVE)
    assert [i.name for i in inactive.items] == ["Andrés Villamil"]
    invited = await listing(container, valeria, status=UserStatusFilter.INVITED)
    assert [(i.name, i.status) for i in invited.items] == [("Bruna Esteves", AccountStatus.INVITED)]
    assert invited.items[0].invitation is not None

    supervisors = await listing(container, valeria, role=S)
    assert {i.name for i in supervisors.items} == {
        "Felipe Echeverri", "Lucía Herrera", "Mariana Duque", "Martín Salazar", "Renata Villalba"
    }  # fmt: skip
    assert supervisors.role_counts.all == 13  # counts ignore the role filter
    assert supervisors.status_counts.all == 5  # …but not the others

    andes_pt = await listing(container, valeria, team_id=ANDES, language=PT)
    assert {i.name for i in andes_pt.items} == {"Daniela Ríos", "Lucía Herrera"}
    andes_all = await listing(container, valeria, team_id=ANDES, status=UserStatusFilter.ALL)
    assert andes_all.status_counts.inactive == 1
    assert len(andes_all.items) == 7
    assert await listing(container, valeria, team_id="TEAM-nope") is not None


async def test_per_user_fields(container: Container, valeria: Actor) -> None:
    daniela = await user(container, DANIELA_ID, valeria)
    assert (daniela.open_cases.total, daniela.open_cases.es, daniela.open_cases.pt) == (5, 4, 1)
    assert daniela.availability is AvailabilityStatus.PAUSED
    assert daniela.guards.is_self is False
    lucia = await user(container, seed_staff_id(5), valeria)
    assert lucia.availability is None  # supervisors have no availability
    me = await user(container, VALERIA_ID, valeria)
    assert (me.guards.is_self, me.guards.last_active_admin) == (True, False)
    with pytest.raises(NotFoundError):
        await user(container, "STF-" + "9" * 26, valeria)


async def test_status_is_derived_at_the_clock() -> None:
    clock = FixedClock()
    container = await memory_container(clock=clock)
    valeria = actor_for(ADMIN_ONLY)
    assert (await user(container, MARIANA_ID, valeria)).status is AccountStatus.LOCKED
    clock.advance(timedelta(minutes=13))  # the lock runs out
    mariana = await user(container, MARIANA_ID, valeria)
    assert (mariana.status, mariana.locked_until, mariana.failed_attempts) == (
        AccountStatus.ACTIVE,
        None,
        0,
    )
    every = await listing(container, valeria)
    assert every.status_counts.locked == 0


async def test_teams_read_model(container: Container, valeria: Actor) -> None:
    admin = container.use_cases.administration
    active = await admin.list_teams.execute(valeria, TeamStatusFilter.ACTIVE)
    rows = [
        (t.name, t.member_count, t.analyst_count, t.inactive_member_count) for t in active.items
    ]
    assert rows == [
        ("Administración de la plataforma", 2, 0, 0),
        ("Equipo Andes", 6, 5, 1),  # part 4: Tatiana, and Bruna (invited) counts too
        ("Equipo Pacífico", 6, 3, 0),
    ]  # fmt: skip
    counts = active.status_counts
    assert (counts.active, counts.inactive, counts.all) == (3, 1, 4)
    inactive = await admin.list_teams.execute(valeria, TeamStatusFilter.INACTIVE)
    assert [t.name for t in inactive.items] == ["Equipo Caribe"]
    detail = await admin.get_team.execute(valeria, ANDES)
    assert [(m.name, m.status) for m in detail.members] == [
        ("Bruna Esteves", AccountStatus.INVITED),
        ("Daniela Ríos", AccountStatus.ACTIVE),
        ("Felipe Echeverri", AccountStatus.ACTIVE),
        ("Julián Ortega", AccountStatus.ACTIVE),
        ("Lucía Herrera", AccountStatus.ACTIVE),
        ("Tatiana Rojas", AccountStatus.ACTIVE),
        ("Andrés Villamil", AccountStatus.INACTIVE),
    ]
    with pytest.raises(NotFoundError):
        await admin.get_team.execute(valeria, "nope")


async def test_supervision_follows_team_renames(container: Container, valeria: Actor) -> None:
    pacifico = await team(container, PACIFICO, valeria)
    await container.use_cases.administration.rename_team.execute(
        valeria, PACIFICO, pacifico.version, "Equipo Pacífico Sur"
    )
    overview = await container.use_cases.cases.team_overview.execute()
    assert [(t.id, t.name) for t in overview.teams] == [
        (ANDES, "Equipo Andes"),
        (PACIFICO, "Equipo Pacífico Sur"),
    ]
    tomas = next(a for a in overview.analysts if a.id == TOMAS_ID)
    assert tomas.team.name == "Equipo Pacífico Sur"


async def test_supervision_lists_only_active_analysts_and_their_teams(
    container: Container, valeria: Actor
) -> None:
    admin = container.use_cases.administration
    created = await admin.create_team.execute(valeria, "Equipo Solo Lectura")
    await admin.create_user.execute(valeria, ana(team_id=created.team.id))
    overview = await container.use_cases.cases.team_overview.execute()
    assert created.team.id not in {t.id for t in overview.teams}  # she is only invited
    await activate_invited(container, "ana.gil@latambank.example")
    overview = await container.use_cases.cases.team_overview.execute()
    assert created.team.id in {t.id for t in overview.teams}
    assert BRUNA_ID not in {a.id for a in overview.analysts}  # invited: not in supervision
    for number in (1, 2, 11):  # Andes keeps its analysts; Andrés (inactive) is not listed
        assert seed_staff_id(number) in {a.id for a in overview.analysts}
    assert ANDRES_ID not in {a.id for a in overview.analysts}
    assert MARIANA_ID not in {a.id for a in overview.analysts}  # supervisor only
    assert OpenCasesBlock.DEACTIVATE.value == "deactivate"
    assert SelfChangeAction.DEACTIVATE_SELF.value == "deactivate_self"
