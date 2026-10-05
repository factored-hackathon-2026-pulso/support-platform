"""Part 4 adapters: invitation and reset repositories (both stores, same uniqueness), the
dev mailbox (SQL and memory), TOTP against RFC 6238, the secret box and the link tokens."""

from __future__ import annotations

import base64
from collections.abc import AsyncIterator, Awaitable, Callable
from datetime import UTC, datetime, timedelta

import pytest

from cc_platform.application.ports.email import EmailKind, EmailMessage
from cc_platform.application.ports.unit_of_work import UnitOfWork, UnitOfWorkFactory
from cc_platform.domain.people.invitation import Invitation, InvitationState
from cc_platform.domain.people.login_account import LoginAccount
from cc_platform.domain.people.password_reset import PasswordReset, PasswordResetState
from cc_platform.domain.people.staff import AccountSetup, Language, Staff, StaffRole
from cc_platform.domain.people.team import Team
from cc_platform.domain.shared.actor import ActorRef, ActorRole
from cc_platform.domain.shared.errors import ConcurrentUpdateError
from cc_platform.infrastructure.clock import FixedClock
from cc_platform.infrastructure.email import dev_mailbox
from cc_platform.infrastructure.email.dev_mailbox import (
    DiscardingEmailSender,
    InMemoryDevMailbox,
    SqlDevMailbox,
)
from cc_platform.infrastructure.events.in_process_bus import InProcessEventBus
from cc_platform.infrastructure.ids import SequentialIdGenerator
from cc_platform.infrastructure.persistence.memory.store import InMemoryStore
from cc_platform.infrastructure.persistence.memory.unit_of_work import InMemoryUnitOfWork
from cc_platform.infrastructure.persistence.sqlalchemy.database import Database
from cc_platform.infrastructure.persistence.sqlalchemy.migrator import migrate
from cc_platform.infrastructure.persistence.sqlalchemy.unit_of_work import SqlAlchemyUnitOfWork
from cc_platform.infrastructure.security.one_time_tokens import SecretsOneTimeTokens
from cc_platform.infrastructure.security.secret_box import FernetSecretBox, derive_key
from cc_platform.infrastructure.security.totp import PyotpTotpService

NOW = datetime(2026, 10, 3, 14, tzinfo=UTC)
ADMIN = ActorRef(ActorRole.ADMIN, "STF-" + "0" * 25 + "7")
TEAM = "TEAM-" + "0" * 25 + "1"
ONE, TWO = "STF-" + "0" * 25 + "1", "STF-" + "0" * 25 + "2"


@pytest.fixture(params=["memory", "sqlite"])
async def factory(request: pytest.FixtureRequest) -> AsyncIterator[UnitOfWorkFactory]:
    clock, ids, bus = FixedClock(), SequentialIdGenerator(), InProcessEventBus()
    if request.param == "memory":
        store = InMemoryStore()

        def memory() -> UnitOfWork:
            return InMemoryUnitOfWork(store, bus=bus, ids=ids, clock=clock)

        yield memory
        return
    database = Database("sqlite+aiosqlite:///:memory:")
    await migrate(database)

    def sql() -> UnitOfWork:
        return SqlAlchemyUnitOfWork(database.session_factory, bus=bus, ids=ids, clock=clock)

    yield sql
    await database.dispose()


async def commit(
    factory: UnitOfWorkFactory, change: Callable[[UnitOfWork], Awaitable[None]]
) -> None:
    async with factory() as uow:
        await change(uow)
        await uow.commit()


def person(staff_id: str, email: str) -> Staff:
    return Staff(
        id=staff_id,
        name="Bruna Esteves",
        email=email,
        roles=frozenset({StaffRole.ANALYST}),
        languages=frozenset({Language.PORTUGUESE}),
        team_id=TEAM,
        created_at=NOW,
        active=False,
        setup=AccountSetup.INVITED,
    )


async def people(uow: UnitOfWork) -> None:
    await uow.teams.add(Team(id=TEAM, name="Equipo Andes", active=True, created_at=NOW))
    await uow.staff.add(person(ONE, "bruna@latambank.example"))
    await uow.staff.add(person(TWO, "otra@latambank.example"))


def invitation(number: int, staff_id: str, token_hash: str) -> Invitation:
    return Invitation.send(
        invitation_id="INV-" + str(number).zfill(26),
        staff_id=staff_id,
        token_hash=token_hash,
        now=NOW,
        actor=ADMIN,
    )


async def test_invitations_round_trip_and_stay_unique(factory: UnitOfWorkFactory) -> None:
    await commit(factory, people)
    sent = invitation(1, ONE, "hash-1")
    sent.start_enrollment(password_hash="argon", totp_secret="sealed", now=NOW)

    async def add(uow: UnitOfWork) -> None:
        await uow.invitations.add(sent)

    await commit(factory, add)
    async with factory() as uow:
        by_token = await uow.invitations.get_by_token_hash("hash-1")
        by_staff = await uow.invitations.get_for_staff(ONE)
        listed = await uow.invitations.list()
        staff = await uow.staff.get(ONE)
    assert by_token is not None
    assert by_staff is not None
    assert (by_token.id, by_token.state, by_token.password_hash, by_token.totp_secret) == (
        sent.id,
        InvitationState.PENDING,
        "argon",
        "sealed",
    )
    assert by_staff.expires_at == NOW + timedelta(hours=48)
    assert [i.id for i in listed] == [sent.id]
    assert staff is not None
    assert staff.setup is AccountSetup.INVITED

    for duplicate in (invitation(2, ONE, "hash-2"), invitation(3, TWO, "hash-1")):

        async def add_again(uow: UnitOfWork, item: Invitation = duplicate) -> None:
            await uow.invitations.add(item)

        with pytest.raises(ConcurrentUpdateError):  # one per person, one per token
            await commit(factory, add_again)

    async def resend(uow: UnitOfWork) -> None:
        stored = await uow.invitations.get_for_staff(ONE)
        assert stored is not None
        stored.resend("hash-9", now=NOW, actor=ADMIN, ttl=timedelta(hours=48))
        await uow.invitations.save(stored)

    await commit(factory, resend)
    async with factory() as uow:
        assert await uow.invitations.get_by_token_hash("hash-1") is None
        fresh = await uow.invitations.get_by_token_hash("hash-9")
    assert fresh is not None
    assert (fresh.resend_count, fresh.password_hash, fresh.version) == (1, None, 2)


async def test_password_resets_round_trip(factory: UnitOfWorkFactory) -> None:
    await commit(factory, people)
    reset = PasswordReset.issue(
        reset_id="PWR-" + "0" * 25 + "1",
        staff_id=ONE,
        token_hash="r-1",
        now=NOW,
        actor=ADMIN,
        revoked_sessions=0,
        cleared_lock=False,
    )

    async def add(uow: UnitOfWork) -> None:
        await uow.password_resets.add(reset)

    await commit(factory, add)

    async def use(uow: UnitOfWork) -> None:
        stored = await uow.password_resets.get_by_token_hash("r-1")
        assert stored is not None
        stored.use(now=NOW)
        await uow.password_resets.save(stored)

    await commit(factory, use)
    async with factory() as uow:
        stored = await uow.password_resets.get_for_staff(ONE)
    assert stored is not None
    assert (stored.state, stored.used_at) == (PasswordResetState.USED, NOW)

    async def second(uow: UnitOfWork) -> None:
        await uow.password_resets.add(
            PasswordReset.issue(
                reset_id="PWR-" + "0" * 25 + "2",
                staff_id=ONE,
                token_hash="r-2",
                now=NOW,
                actor=ADMIN,
                revoked_sessions=0,
                cleared_lock=False,
            )
        )

    with pytest.raises(ConcurrentUpdateError):  # one link row per person
        await commit(factory, second)


async def test_login_accounts_keep_the_sealed_secret(factory: UnitOfWorkFactory) -> None:
    await commit(factory, people)
    account = LoginAccount.open(
        staff_id=ONE,
        password_hash="argon",
        totp_secret="sealed",
        now=NOW,
        actor=ActorRef(ActorRole.ANALYST, ONE),
    )

    async def add(uow: UnitOfWork) -> None:
        await uow.login_accounts.add(account)

    await commit(factory, add)
    async with factory() as uow:
        stored = await uow.login_accounts.get(ONE)
    assert stored is not None
    assert (stored.totp_secret, stored.uses_totp) == ("sealed", True)


# ----------------------------------------------------------------------------- dev mailbox
def message(number: int) -> EmailMessage:
    return EmailMessage(
        kind=EmailKind.INVITATION,
        to=f"persona{number}@latambank.example",
        subject="Te invitaron",
        text="Hola",
        link=f"http://localhost:5173/activate?token=t{number}",
    )


@pytest.mark.parametrize("kind", ["memory", "sqlite"])
async def test_the_dev_mailbox_keeps_the_newest(kind: str, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(dev_mailbox, "MAX_KEPT", 3)
    clock, ids = FixedClock(), SequentialIdGenerator()
    database: Database | None = None
    mailbox: InMemoryDevMailbox | SqlDevMailbox
    if kind == "memory":
        mailbox = InMemoryDevMailbox(clock=clock, ids=ids)
    else:
        database = Database("sqlite+aiosqlite:///:memory:")
        await migrate(database)
        mailbox = SqlDevMailbox(database.session_factory, clock=clock, ids=ids)
    for number in range(1, 5):
        await mailbox.send(message(number))
        clock.advance(timedelta(seconds=1))
    latest = await mailbox.latest(10)
    assert [m.to for m in latest] == [f"persona{n}@latambank.example" for n in (4, 3, 2)]
    assert latest[0].link.endswith("token=t4")
    assert latest[0].sent_at > latest[1].sent_at
    assert [m.to for m in await mailbox.latest(1)] == ["persona4@latambank.example"]
    if database is not None:
        await database.dispose()


async def test_the_discarding_sender_drops_without_logging_the_address(
    capsys: pytest.CaptureFixture[str],
) -> None:
    await DiscardingEmailSender().send(message(1))
    output = capsys.readouterr().out
    assert "persona1" not in output
    assert "token=t1" not in output


# ----------------------------------------------------------------------------- security
def test_totp_matches_rfc_6238_sha1_vectors() -> None:
    """RFC 6238 appendix B (SHA-1, secret "12345678901234567890"): the 6-digit codes are
    the last six digits of the 8-digit vectors."""
    secret = base64.b32encode(b"12345678901234567890").decode()
    totp = PyotpTotpService(issuer="LATAM Bank CC")
    vectors = {
        59: "94287082",
        1111111109: "07081804",
        1111111111: "14050471",
        1234567890: "89005924",
        2000000000: "69279037",
        20000000000: "65353130",
    }
    for seconds, eight in vectors.items():
        at = datetime.fromtimestamp(seconds, tz=UTC)
        assert totp.code_at(secret, at) == eight[-6:]
        assert totp.verify(secret, eight[-6:], at=at)


def test_totp_accepts_one_step_of_drift_and_only_six_digits() -> None:
    totp = PyotpTotpService(issuer="LATAM Bank CC")
    secret = totp.new_secret()
    assert len(secret) == 32
    code = totp.code_at(secret, NOW)
    assert totp.verify(secret, code, at=NOW + timedelta(seconds=30))
    assert totp.verify(secret, code, at=NOW - timedelta(seconds=30))
    later = NOW + timedelta(seconds=90)
    if totp.code_at(secret, later) != code:
        assert not totp.verify(secret, code, at=later)
    for bad in ("", "12345", "1234567", "12a456", " 123456"):
        assert not totp.verify(secret, bad, at=NOW)
    uri = totp.provisioning_uri(secret, account_name="ana@latambank.example")
    assert uri == (
        f"otpauth://totp/LATAM%20Bank%20CC:ana%40latambank.example?secret={secret}"
        "&issuer=LATAM%20Bank%20CC"
    )
    assert (totp.issuer, totp.digits, totp.period_seconds) == ("LATAM Bank CC", 6, 30)


def test_the_secret_box_seals_and_refuses_another_key() -> None:
    box = FernetSecretBox(derive_key("one-session-secret-that-is-long-enough"))
    sealed = box.seal("JBSWY3DPEHPK3PXP")
    assert "JBSWY3DPEHPK3PXP" not in sealed
    assert box.open(sealed) == "JBSWY3DPEHPK3PXP"
    assert box.seal("JBSWY3DPEHPK3PXP") != sealed  # random IV
    other = FernetSecretBox(derive_key("another-session-secret-long-enough"))
    with pytest.raises(ValueError, match="cannot be opened"):
        other.open(sealed)


def test_link_tokens_are_high_entropy_and_stored_as_hashes() -> None:
    tokens = SecretsOneTimeTokens()
    issued = [tokens.issue() for _ in range(20)]
    assert len({i.token for i in issued}) == 20
    for item in issued:
        assert len(item.token) == 43  # 32 random bytes, URL-safe
        assert item.hash == tokens.hash(item.token)
        assert len(item.hash) == 64
        assert item.token not in item.hash
