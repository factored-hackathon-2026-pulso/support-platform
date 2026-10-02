from __future__ import annotations

from dataclasses import replace
from datetime import UTC, datetime, timedelta

import jwt
import pytest

from cc_platform.application.errors import AuthenticationRequiredError
from cc_platform.application.ports.security import SessionClaims
from cc_platform.domain.people.mfa import MfaMethod
from cc_platform.domain.people.staff import StaffRole
from cc_platform.infrastructure.security.mfa import DevMfaVerifier
from cc_platform.infrastructure.security.passwords import Argon2PasswordHasher
from cc_platform.infrastructure.security.tokens import HmacSessionTokenService
from tests.support import TEST_SECRET

ISSUED = datetime(2026, 10, 2, 14, tzinfo=UTC)
CLAIMS = SessionClaims(
    session_id="SES-" + "0" * 25 + "1",
    staff_id="STF-" + "0" * 25 + "1",
    roles=frozenset({StaffRole.ANALYST, StaffRole.SUPERVISOR}),
    issued_at=ISSUED,
    expires_at=ISSUED + timedelta(hours=8),
)


def test_token_round_trip() -> None:
    service = HmacSessionTokenService(TEST_SECRET)
    assert service.read(service.issue(CLAIMS)) == CLAIMS


def test_expired_token_still_decodes_so_the_clock_decides() -> None:
    service = HmacSessionTokenService(TEST_SECRET)
    past = replace(
        CLAIMS, issued_at=ISSUED - timedelta(days=30), expires_at=ISSUED - timedelta(days=29)
    )
    assert service.read(service.issue(past)).expires_at == past.expires_at


@pytest.mark.parametrize(
    "token_factory",
    [
        lambda s: s.issue(CLAIMS)[:-2] + "xx",
        lambda s: HmacSessionTokenService("another-secret-that-is-also-long-enough-123").issue(
            CLAIMS
        ),
        lambda s: jwt.encode({"sub": "x"}, TEST_SECRET, algorithm="HS256"),
        lambda s: jwt.encode(
            {
                "sub": "x",
                "sid": "y",
                "roles": ["root"],
                "iat": 1,
                "exp": 2,
                "iss": "cc-platform",
                "aud": "cc-backoffice",
            },
            TEST_SECRET,
            algorithm="HS256",
        ),
        lambda s: "not-a-token",
    ],
    ids=["tampered", "other-secret", "missing-claims", "unknown-role", "garbage"],
)
def test_invalid_tokens_are_rejected(token_factory) -> None:  # type: ignore[no-untyped-def]
    service = HmacSessionTokenService(TEST_SECRET)
    with pytest.raises(AuthenticationRequiredError):
        service.read(token_factory(service))


def test_short_secret_is_refused() -> None:
    with pytest.raises(ValueError, match="at least"):
        HmacSessionTokenService("short")


async def test_argon2_hash_and_verify() -> None:
    hasher = Argon2PasswordHasher(time_cost=1, memory_cost=1024, parallelism=1)
    digest = await hasher.hash("demo1234")
    assert digest.startswith("$argon2id$")
    assert await hasher.verify(digest, "demo1234")
    assert not await hasher.verify(digest, "wrong")
    assert not await hasher.verify(None, "demo1234")
    assert not await hasher.verify("not-a-hash", "demo1234")


async def test_dev_mfa_verifier_accepts_only_the_configured_code() -> None:
    verifier = DevMfaVerifier("000000")
    assert await verifier.verify(staff_id="STF-1", method=MfaMethod.TOTP, code="000000")
    assert not await verifier.verify(staff_id="STF-1", method=MfaMethod.SMS, code="123456")
