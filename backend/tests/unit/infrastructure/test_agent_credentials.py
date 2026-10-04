"""The agent-core credential issuer: JWS shape, key separation, key files (ADR 0003 §2)."""

from __future__ import annotations

import json
from datetime import UTC, datetime, timedelta

import pytest
from cryptography.exceptions import InvalidSignature
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PublicKey

from cc_platform.application.ai import BuilderIdentity
from cc_platform.infrastructure.ai.ed25519_issuer import (
    DELEGATION_TYP,
    PRINCIPAL_TYP,
    Ed25519AgentCredentialIssuer,
)
from cc_platform.infrastructure.ai.keys import AgentSigningKeys, b64url_decode

NOW = datetime(2026, 10, 4, 15, tzinfo=UTC)


class FrozenClock:
    def now(self) -> datetime:
        return NOW


def split(token: str) -> tuple[dict[str, object], dict[str, object], bytes, bytes]:
    head, body, signature = token.split(".")
    return (
        json.loads(b64url_decode(head)),
        json.loads(b64url_decode(body)),
        b64url_decode(signature),
        f"{head}.{body}".encode("ascii"),
    )


def verify(token: str, public: str) -> None:
    _, _, signature, signed = split(token)
    Ed25519PublicKey.from_public_bytes(b64url_decode(public)).verify(signature, signed)


@pytest.fixture
def keys() -> AgentSigningKeys:
    return AgentSigningKeys.generate(suffix="test")


@pytest.fixture
def issuer(keys: AgentSigningKeys) -> Ed25519AgentCredentialIssuer:
    return Ed25519AgentCredentialIssuer(keys, FrozenClock(), ttl=timedelta(minutes=5))


def test_customer_credential_has_agent_cores_exact_header_and_payload(
    issuer: Ed25519AgentCredentialIssuer, keys: AgentSigningKeys
) -> None:
    credentials = issuer.customer(bank_customer_id="C-123", session_id="CSN-1")

    header, payload, _, _ = split(credentials.authorization)
    assert header == {"alg": "EdDSA", "kid": keys.principal.kid, "typ": PRINCIPAL_TYP}
    assert payload == {
        "type": "customer",
        "id": "C-123",
        "roles": [],
        "scopes": [],
        "attrs": {},
        "auth": {"level": "session", "at": "2026-10-04T15:00:00Z", "simulated": False},
        "exp": "2026-10-04T15:05:00Z",
    }
    assert credentials.on_behalf_of is None
    verify(credentials.authorization, keys.principal.public_b64url())


def test_advisor_gets_a_delegation_tied_to_her_and_one_customer(
    issuer: Ed25519AgentCredentialIssuer, keys: AgentSigningKeys
) -> None:
    credentials = issuer.advisor(
        staff_id="STF-9",
        bank_customer_id="C-123",
        grant_ref="GRANT-CASE-1-STF-9",
        expires_at=NOW + timedelta(hours=8),
    )

    assert credentials.on_behalf_of is not None
    header, delegation, _, _ = split(credentials.on_behalf_of)
    assert header["typ"] == DELEGATION_TYP
    assert header["kid"] == keys.delegation.kid
    assert delegation == {
        "subject": {"kind": "customer", "ref": "C-123"},
        "grant_ref": "GRANT-CASE-1-STF-9",
        "grantee": {"type": "advisor", "id": "STF-9"},
        "scopes": [],
        "exp": "2026-10-04T23:00:00Z",
    }
    _, principal, _, _ = split(credentials.authorization)
    assert principal["type"] == "advisor"
    assert principal["id"] == delegation["grantee"]["id"]  # type: ignore[index]
    verify(credentials.on_behalf_of, keys.delegation.public_b64url())


def test_every_purpose_has_its_own_key(
    issuer: Ed25519AgentCredentialIssuer, keys: AgentSigningKeys
) -> None:
    customer = issuer.customer(bank_customer_id="C-1", session_id="s").authorization
    builder = issuer.builder(BuilderIdentity(staff_id="STF-1")).authorization
    delegation = issuer.advisor(
        staff_id="STF-2", bank_customer_id="C-1", grant_ref="g", expires_at=NOW + timedelta(hours=1)
    ).on_behalf_of
    assert delegation is not None

    with pytest.raises(InvalidSignature):
        verify(customer, keys.staff.public_b64url())
    with pytest.raises(InvalidSignature):
        verify(builder, keys.principal.public_b64url())
    with pytest.raises(InvalidSignature):
        verify(delegation, keys.principal.public_b64url())


@pytest.mark.parametrize(
    ("identity", "roles", "level"),
    [
        (BuilderIdentity("STF-1"), ["constructor"], "session"),
        (
            BuilderIdentity("STF-1", approver=True, step_up=True),
            ["constructor", "aprobador"],
            "step_up",
        ),
        (
            BuilderIdentity("STF-1", approver=True, admin=True),
            ["constructor", "aprobador", "admin"],
            "session",
        ),
    ],
)
def test_builder_roles_and_level_come_from_the_identity(
    issuer: Ed25519AgentCredentialIssuer,
    identity: BuilderIdentity,
    roles: list[str],
    level: str,
) -> None:
    _, payload, _, _ = split(issuer.builder(identity).authorization)

    assert payload["type"] == "builder"
    assert payload["roles"] == roles
    assert payload["attrs"] == {"actor": "human"}
    assert payload["auth"]["level"] == level  # type: ignore[index]


def test_a_step_up_credential_is_short_lived_and_the_ordinary_one_is_not(
    issuer: Ed25519AgentCredentialIssuer,
) -> None:
    _, ordinary, _, _ = split(issuer.builder(BuilderIdentity("STF-1", approver=True)).authorization)
    _, fresh, _, _ = split(
        issuer.builder(BuilderIdentity("STF-1", approver=True, step_up=True)).authorization
    )

    assert ordinary["exp"] == "2026-10-04T15:05:00Z"  # the issuer's ttl (5 minutes in this test)
    assert fresh["exp"] == "2026-10-04T15:02:00Z"  # a second factor is fresh for two minutes


def test_the_registry_and_the_runtime_get_the_same_person_signed_by_different_keys(
    issuer: Ed25519AgentCredentialIssuer, keys: AgentSigningKeys
) -> None:
    """agent-core verifies the registry's principals against ``--staff-keys`` and the runtime's
    (``POST /v1/runs``: the builder chat) against ``--identity-keys``: found against a real
    agent-core, where a staff-signed credential answered ``credentials_invalid`` on a run."""
    identity = BuilderIdentity("STF-1", approver=True, admin=True, step_up=True)

    registry = issuer.builder(identity).authorization
    run = issuer.builder_run(identity).authorization

    verify(registry, keys.staff.public_b64url())
    verify(run, keys.principal.public_b64url())
    with pytest.raises(InvalidSignature):
        verify(run, keys.staff.public_b64url())
    with pytest.raises(InvalidSignature):
        verify(registry, keys.principal.public_b64url())
    header, payload, _, _ = split(run)
    assert header == {"alg": "EdDSA", "kid": keys.principal.kid, "typ": PRINCIPAL_TYP}
    assert (payload["type"], payload["id"]) == ("builder", "STF-1")
    assert payload["roles"] == ["constructor", "aprobador", "admin"]
    assert payload["attrs"] == {"actor": "human"}
    assert payload["auth"]["level"] == "session"  # type: ignore[index]  # the chat never has step-up


def test_credentials_never_show_in_repr(issuer: Ed25519AgentCredentialIssuer) -> None:
    credentials = issuer.customer(bank_customer_id="C-1", session_id="s")

    assert credentials.authorization not in repr(credentials)


def test_public_documents_match_agent_cores_key_file_format(keys: AgentSigningKeys) -> None:
    identity, staff = keys.public_documents()

    assert set(identity) == {"principal_keys", "delegation_keys"}
    assert set(staff) == {"principal_keys"}
    for document in (identity, staff):
        for mapping in document.values():
            for encoded in mapping.values():
                assert len(b64url_decode(encoded)) == 32


def test_private_document_round_trips_and_never_leaks_in_errors(keys: AgentSigningKeys) -> None:
    again = AgentSigningKeys.from_private_document(keys.private_document())
    assert again.principal.public_b64url() == keys.principal.public_b64url()

    broken = keys.private_document()
    broken["staff"]["seed"] = "SECRET-NOT-A-SEED"
    with pytest.raises(ValueError, match="staff") as error:
        AgentSigningKeys.from_private_document(broken)
    assert "SECRET-NOT-A-SEED" not in str(error.value)

    with pytest.raises(ValueError, match="exactly"):
        AgentSigningKeys.from_private_document({"principal": broken["principal"]})
