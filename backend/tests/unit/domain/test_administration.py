"""Slice 4 domain (§2): ``Team``, the editable ``Staff``, ``AdminRoster`` and the login
account's unlock and reset."""

from __future__ import annotations

from datetime import UTC, datetime, timedelta

import pytest

from cc_platform.domain.people import (
    AdminRoster,
    Language,
    LastAdminError,
    LockoutPolicy,
    LoginAccount,
    Staff,
    StaffAccountUnlocked,
    StaffCreated,
    StaffDeactivated,
    StaffLanguagesChanged,
    StaffPasswordReset,
    StaffProfileUpdated,
    StaffReactivated,
    StaffRole,
    StaffRolesChanged,
    StaffTeamChanged,
    Team,
    TeamCreated,
    TeamDeactivated,
    TeamInactiveError,
    TeamNotEmptyError,
    TeamReactivated,
    TeamRenamed,
    fold,
    normalize_email,
)
from cc_platform.domain.people.availability import (
    AnalystAvailability,
    AvailabilityChangeReason,
    AvailabilityStatus,
)
from cc_platform.domain.people.names import team_name_key
from cc_platform.domain.shared.actor import ActorRef, ActorRole
from cc_platform.domain.shared.errors import InvalidValueError
from cc_platform.infrastructure.security.temporary_passwords import (
    ALPHABET,
    SecretsTemporaryPasswordGenerator,
)

NOW = datetime(2026, 10, 3, 14, tzinfo=UTC)
ADMIN = ActorRef(ActorRole.ADMIN, "STF-" + "0" * 25 + "7")
STAFF_ID = "STF-" + "0" * 25 + "1"
TEAM_A = "TEAM-" + "0" * 25 + "1"
TEAM_B = "TEAM-" + "0" * 25 + "2"
A, S, AD = StaffRole.ANALYST, StaffRole.SUPERVISOR, StaffRole.ADMIN
ES, PT = Language.SPANISH, Language.PORTUGUESE


def team(
    team_id: str = TEAM_A, name: str = "Disputas · Equipo Andes", *, active: bool = True
) -> Team:
    return Team(id=team_id, name=name, active=active, created_at=NOW)


def person(**overrides: object) -> Staff:
    values: dict[str, object] = {
        "id": STAFF_ID,
        "name": "Daniela Ríos",
        "email": "daniela.rios@latambank.example",
        "roles": frozenset({A}),
        "languages": frozenset({ES, PT}),
        "team_id": TEAM_A,
        "created_at": NOW,
    }
    values.update(overrides)
    return Staff(**values)  # type: ignore[arg-type]


# ----------------------------------------------------------------------------- names
def test_names_are_trimmed_collapsed_and_bounded() -> None:
    assert person(name="  Ana   María  Gil ").name == "Ana María Gil"
    for bad in ("A", " ", "x" * 121):
        with pytest.raises(InvalidValueError) as error:
            person(name=bad)
        assert error.value.details["field"] == "name"
    assert team(name="  Equipo   Sur ").name == "Equipo Sur"
    with pytest.raises(InvalidValueError):
        team(name="x" * 81)


def test_team_name_key_ignores_case_accents_and_spaces() -> None:
    assert team_name_key("Disputas · Equipo Pacífico") == team_name_key(
        "disputas ·  equipo PACIFICO"
    )
    assert fold("Ñandú") == "nandu"


def test_email_format_and_length() -> None:
    assert normalize_email("  Ana.Gil@LatamBank.Example ") == "ana.gil@latambank.example"
    for bad in ("ana", "ana@", "@latam.example", "a@b@c.example", "a b@x.example", "a@x.", "a@.x"):
        with pytest.raises(InvalidValueError):
            normalize_email(bad)
    with pytest.raises(InvalidValueError):
        normalize_email("a" * 250 + "@x.example")


# ----------------------------------------------------------------------------- team
def test_team_create_rename_deactivate_reactivate() -> None:
    created = Team.create(team_id=TEAM_A, name=" Equipo  Sur ", now=NOW, actor=ADMIN)
    assert (created.name, created.active, created.name_key) == ("Equipo Sur", True, "equipo sur")
    assert not created.rename("Equipo Sur", now=NOW, actor=ADMIN)  # no-op
    assert created.rename("Equipo sur", now=NOW, actor=ADMIN)  # case only: allowed
    assert created.deactivate(active_members=0, now=NOW, actor=ADMIN)
    assert not created.deactivate(active_members=0, now=NOW, actor=ADMIN)  # already inactive
    assert created.reactivate(now=NOW, actor=ADMIN)
    assert not created.reactivate(now=NOW, actor=ADMIN)
    events = created.pull_events()
    assert [type(e) for e in events] == [TeamCreated, TeamRenamed, TeamDeactivated, TeamReactivated]
    assert events[0].payload() == {"name": "Equipo Sur"}
    assert events[1].payload() == {"from_name": "Equipo Sur", "to_name": "Equipo sur"}
    assert events[0].entity == "team"


def test_a_team_with_active_members_cannot_be_deactivated() -> None:
    with pytest.raises(TeamNotEmptyError) as error:
        team().deactivate(active_members=2, now=NOW, actor=ADMIN)
    assert error.value.code == "team_not_empty"
    assert error.value.details == {"memberCount": 2}


def test_team_ids_are_validated() -> None:
    with pytest.raises(InvalidValueError):
        team(team_id="disputas-equipo-andes")


# ----------------------------------------------------------------------------- staff
def test_analysts_need_a_language_others_may_have_none() -> None:
    with pytest.raises(InvalidValueError) as error:
        person(languages=frozenset())
    assert error.value.details["field"] == "languages"
    assert person(roles=frozenset({AD}), languages=frozenset()).languages == frozenset()
    with pytest.raises(InvalidValueError) as roles:
        person(roles=frozenset())
    assert roles.value.details["field"] == "roles"


def test_create_records_the_canonical_payload() -> None:
    staff = Staff.create(
        staff_id=STAFF_ID,
        name="Ana Gil",
        email="Ana.Gil@latambank.example",
        roles={AD, A},
        languages={PT, ES},
        team=team(),
        now=NOW,
        actor=ADMIN,
        creation_key="key-0001",
    )
    (event,) = staff.pull_events()
    assert isinstance(event, StaffCreated)
    assert event.payload() == {
        "name": "Ana Gil",
        "roles": ["analyst", "admin"],
        "languages": ["es", "pt"],
        "team_id": TEAM_A,
        "team_name": "Disputas · Equipo Andes",
    }
    assert (staff.email, staff.creation_key, staff.created_at) == (
        "ana.gil@latambank.example",
        "key-0001",
        NOW,
    )


def test_create_into_an_inactive_team_is_refused() -> None:
    with pytest.raises(TeamInactiveError) as error:
        Staff.create(
            staff_id=STAFF_ID,
            name="Ana Gil",
            email="ana.gil@latambank.example",
            roles={A},
            languages={ES},
            team=team(active=False),
            now=NOW,
            actor=ADMIN,
        )
    assert error.value.details == {"teamId": TEAM_A}


def test_each_setter_records_one_event_and_a_no_op_records_nothing() -> None:
    staff = person()
    assert not staff.update_profile(name="Daniela  Ríos", now=NOW, actor=ADMIN)
    assert staff.update_profile(name="Daniela Ríos Paz", now=NOW, actor=ADMIN)
    assert staff.update_profile(email="dani@latambank.example", now=NOW, actor=ADMIN)
    assert not staff.set_roles({A}, now=NOW, actor=ADMIN)
    assert staff.set_roles({A, S}, now=NOW, actor=ADMIN)
    assert not staff.set_languages({PT, ES}, now=NOW, actor=ADMIN)
    assert staff.set_languages({PT}, now=NOW, actor=ADMIN)
    assert staff.move_to(team(TEAM_B, "Disputas · Equipo Pacífico"), from_team_name="Andes",
                         now=NOW, actor=ADMIN)  # fmt: skip
    events = staff.pull_events()
    assert [type(e) for e in events] == [
        StaffProfileUpdated,
        StaffProfileUpdated,
        StaffRolesChanged,
        StaffLanguagesChanged,
        StaffTeamChanged,
    ]
    assert events[0].payload() == {
        "changed_fields": ["name"],
        "from_name": "Daniela Ríos",
        "to_name": "Daniela Ríos Paz",
    }
    # An email change never writes the email into the log.
    assert events[1].payload() == {
        "changed_fields": ["email"],
        "from_name": "Daniela Ríos Paz",
        "to_name": "Daniela Ríos Paz",
    }
    assert events[2].payload() == {
        "from_roles": ["analyst"],
        "to_roles": ["analyst", "supervisor"],
        "added": ["supervisor"],
        "removed": [],
    }
    assert events[3].payload() == {
        "from_languages": ["es", "pt"],
        "to_languages": ["pt"],
        "added": [],
        "removed": ["es"],
    }
    assert events[4].payload() == {
        "from_team_id": TEAM_A,
        "from_team_name": "Andes",
        "to_team_id": TEAM_B,
        "to_team_name": "Disputas · Equipo Pacífico",
    }


def test_one_edit_records_its_events_in_the_contract_order() -> None:
    staff = person()
    edit = staff.plan_edit(
        team_id=TEAM_B,
        languages={ES},
        roles={A, AD},
        email="d.rios@latambank.example",
        name="Daniela R.",
    )
    assert edit.profile_fields == ("name", "email")
    assert staff.apply_edit(edit, now=NOW, actor=ADMIN, team=team(TEAM_B, "Pacífico"),
                            from_team_name="Andes")  # fmt: skip
    kinds = [e.event_type for e in staff.pull_events()]
    assert kinds == [
        "staff.profile_updated",
        "staff.roles_changed",
        "staff.languages_changed",
        "staff.team_changed",
    ]


def test_an_edit_is_validated_as_the_resulting_person() -> None:
    supervisor = person(roles=frozenset({S}), languages=frozenset())
    # Becoming an analyst while also getting a language is valid as a whole.
    edit = supervisor.plan_edit(roles={A, S}, languages={PT})
    assert supervisor.apply_edit(edit, now=NOW, actor=ADMIN)
    with pytest.raises(InvalidValueError) as error:
        person(roles=frozenset({S}), languages=frozenset()).plan_edit(roles={A})
    assert error.value.details["field"] == "languages"


def test_moving_into_an_inactive_team_is_refused() -> None:
    with pytest.raises(TeamInactiveError):
        person().move_to(team(TEAM_B, "Caribe", active=False), from_team_name="Andes",
                         now=NOW, actor=ADMIN)  # fmt: skip


def test_deactivate_and_reactivate() -> None:
    staff = person()
    assert staff.deactivate(revoked_sessions=2, now=NOW, actor=ADMIN)
    assert not staff.deactivate(revoked_sessions=0, now=NOW, actor=ADMIN)
    assert not staff.active
    with pytest.raises(TeamInactiveError):
        staff.reactivate(team(active=False), now=NOW, actor=ADMIN)
    assert staff.reactivate(team(), now=NOW, actor=ADMIN)
    assert not staff.reactivate(team(), now=NOW, actor=ADMIN)
    events = staff.pull_events()
    assert [type(e) for e in events] == [StaffDeactivated, StaffReactivated]
    assert events[0].payload() == {"revoked_sessions": 2}
    assert events[1].payload() == {}


def test_availability_reason_only_when_administration_changed_it() -> None:
    row = AnalystAvailability(staff_id=STAFF_ID, status=AvailabilityStatus.AVAILABLE, since=NOW)
    row.change(AvailabilityStatus.PAUSED, now=NOW, actor=ADMIN,
               reason=AvailabilityChangeReason.ROLE_REMOVED)  # fmt: skip
    row.change(AvailabilityStatus.AVAILABLE, now=NOW, actor=ADMIN)
    first, second = row.pull_events()
    assert first.payload() == {
        "from_status": "available",
        "to_status": "paused",
        "reason": "role_removed",
    }
    assert "reason" not in second.payload()


# ----------------------------------------------------------------------------- roster
def test_roster_grant_revoke_and_last_admin() -> None:
    roster = AdminRoster(admin_ids=frozenset({"STF-A"}))
    roster.grant("STF-B")
    assert roster.admin_ids == {"STF-A", "STF-B"}
    roster.revoke("STF-A")
    assert roster.is_last("STF-B")
    with pytest.raises(LastAdminError) as error:
        roster.revoke("STF-B")
    assert error.value.code == "last_admin"
    assert roster.admin_ids == {"STF-B"}
    assert not roster.pull_events()  # the staff events tell what happened


# ----------------------------------------------------------------------------- login account
def locked_account() -> LoginAccount:
    account = LoginAccount(staff_id=STAFF_ID, password_hash="old")
    for _ in range(5):
        account.register_failed_attempt(now=NOW, policy=LockoutPolicy(), actor=ADMIN)
    account.pull_events()
    return account


def test_unlock_a_locked_account() -> None:
    account = locked_account()
    assert account.unlock(now=NOW + timedelta(minutes=1), actor=ADMIN)
    assert (account.failed_attempts, account.locked_until) == (0, None)
    (event,) = account.pull_events()
    assert isinstance(event, StaffAccountUnlocked)
    assert event.payload() == {"was_locked": True, "failed_attempts": 5}
    assert event.entity_id == STAFF_ID


def test_unlock_resets_failures_without_a_lock_and_ignores_a_clear_counter() -> None:
    account = LoginAccount(staff_id=STAFF_ID, password_hash="h")
    assert not account.unlock(now=NOW, actor=ADMIN)  # clear: no-op
    account.register_failed_attempt(now=NOW, policy=LockoutPolicy(), actor=ADMIN)
    account.pull_events()
    assert account.unlock(now=NOW, actor=ADMIN)
    assert account.pull_events()[0].payload() == {"was_locked": False, "failed_attempts": 1}
    expired = locked_account()
    assert not expired.unlock(now=NOW + timedelta(minutes=15), actor=ADMIN)  # lock ran out


def test_reset_password_replaces_the_hash_and_clears_the_lock() -> None:
    account = locked_account()
    account.reset_password("new-hash", now=NOW, actor=ADMIN, revoked_sessions=1)
    assert (account.password_hash, account.failed_attempts, account.locked_until) == (
        "new-hash",
        0,
        None,
    )
    (event,) = account.pull_events()
    assert isinstance(event, StaffPasswordReset)
    assert event.payload() == {"revoked_sessions": 1, "cleared_lock": True}
    assert "new-hash" not in str(event.payload())


def test_temporary_passwords_follow_the_format() -> None:
    generator = SecretsTemporaryPasswordGenerator()
    passwords = {generator.generate() for _ in range(50)}
    assert len(passwords) == 50
    for password in passwords:
        assert len(password) == 14
        groups = password.split("-")
        assert [len(g) for g in groups] == [4, 4, 4]
        assert set("".join(groups)) <= set(ALPHABET)
    assert not set("01ilo") & set(ALPHABET)
