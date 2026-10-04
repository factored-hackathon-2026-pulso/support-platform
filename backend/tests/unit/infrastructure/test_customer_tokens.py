"""Customer tokens: separate audience from staff tokens, tamper-proof, chat channels only."""

from __future__ import annotations

from datetime import UTC, datetime, timedelta

import jwt
import pytest

from cc_platform.application.customers.ports import CustomerSessionClaims
from cc_platform.application.errors import AuthenticationRequiredError
from cc_platform.application.ports.security import SessionClaims
from cc_platform.domain.cases import CaseChannel
from cc_platform.domain.people.staff import StaffRole
from cc_platform.infrastructure.security.customer_tokens import HmacCustomerTokenService
from cc_platform.infrastructure.security.tokens import HmacSessionTokenService
from tests.support import TEST_SECRET

NOW = datetime(2026, 10, 2, 14, tzinfo=UTC)
CLAIMS = CustomerSessionClaims(
    session_id="CSN-" + "0" * 25 + "1",
    customer_id="CUS-" + "0" * 22 + "2001",
    channel=CaseChannel.CHAT_WEB,
    issued_at=NOW,
    expires_at=NOW + timedelta(hours=8),
)


def test_round_trip() -> None:
    service = HmacCustomerTokenService(TEST_SECRET)
    assert service.read(service.issue(CLAIMS)) == CLAIMS


def test_staff_and_customer_tokens_are_not_interchangeable() -> None:
    customers = HmacCustomerTokenService(TEST_SECRET)
    staff = HmacSessionTokenService(TEST_SECRET)
    staff_token = staff.issue(
        SessionClaims(
            session_id="SES-" + "0" * 25 + "1",
            staff_id="STF-" + "0" * 25 + "1",
            roles=frozenset({StaffRole.ANALYST}),
            issued_at=NOW,
            expires_at=NOW + timedelta(hours=8),
        )
    )
    with pytest.raises(AuthenticationRequiredError):
        customers.read(staff_token)
    with pytest.raises(AuthenticationRequiredError):
        staff.read(customers.issue(CLAIMS))


def test_forged_or_non_chat_tokens_are_rejected() -> None:
    service = HmacCustomerTokenService(TEST_SECRET)
    forged = HmacCustomerTokenService("another-secret-that-is-long-enough-0123456").issue(CLAIMS)
    with pytest.raises(AuthenticationRequiredError):
        service.read(forged)
    payload = jwt.decode(
        service.issue(CLAIMS),
        TEST_SECRET,
        algorithms=["HS256"],
        audience="cc-customer",
        options={"verify_exp": False, "verify_iat": False},
    )
    phone = jwt.encode({**payload, "channel": "phone"}, TEST_SECRET, algorithm="HS256")
    with pytest.raises(AuthenticationRequiredError):
        service.read(phone)
