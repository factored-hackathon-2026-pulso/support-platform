"""``Ed25519AgentCredentialIssuer``: compact JWS in agent-core's format (M9 §3.8).

``header.payload.signature``, each part base64url without padding. The header is exactly
``{"alg": "EdDSA", "kid", "typ"}`` and ``typ`` separates a principal (``principal+jws``) from a
delegation (``delegation+jws``). The payload is the serialized ``Principal`` or ``OnBehalfOf``
(unknown fields are rejected by agent-core, so nothing extra goes in). Validity (``exp``) is
checked by agent-core with its own clock; credentials are minted per call and short-lived.
"""

from __future__ import annotations

import json
from dataclasses import replace
from datetime import UTC, datetime, timedelta
from typing import Any

from cc_platform.application.ai.credentials import AgentCredentials, BuilderIdentity
from cc_platform.application.ports.clock import Clock
from cc_platform.infrastructure.ai.keys import AgentSigningKeys, SigningKey, b64url

PRINCIPAL_TYP = "principal+jws"
DELEGATION_TYP = "delegation+jws"
DEFAULT_TTL = timedelta(minutes=10)
#: A builder credential at ``step_up`` (approve, publish, promote, revoke): minutes, not the
#: ordinary ten, because the platform checks a fresh second factor right before each call.
STEP_UP_TTL = timedelta(minutes=2)
_SUBJECT_KIND = "customer"


def _iso(moment: datetime) -> str:
    return moment.astimezone(UTC).strftime("%Y-%m-%dT%H:%M:%SZ")


def _sign(key: SigningKey, typ: str, payload: dict[str, Any]) -> str:
    header = json.dumps(
        {"alg": "EdDSA", "kid": key.kid, "typ": typ}, separators=(",", ":"), sort_keys=True
    )
    body = json.dumps(payload, separators=(",", ":"), sort_keys=True, ensure_ascii=False)
    head = b64url(header.encode("utf-8"))
    claims = b64url(body.encode("utf-8"))
    signature = key.private.sign(f"{head}.{claims}".encode("ascii"))
    return f"{head}.{claims}.{b64url(signature)}"


class Ed25519AgentCredentialIssuer:
    def __init__(
        self, keys: AgentSigningKeys, clock: Clock, *, ttl: timedelta = DEFAULT_TTL
    ) -> None:
        self._keys = keys
        self._clock = clock
        self._ttl = ttl

    def customer(
        self,
        *,
        bank_customer_id: str,
        session_id: str,
        step_up_at: datetime | None = None,
    ) -> AgentCredentials:
        now = self._clock.now()
        # ``session_id`` is accepted for the day a channel identity claim exists; agent-core's
        # principal carries nothing but the customer today, so nothing extra is signed.
        principal = self._principal(
            now,
            kind="customer",
            subject_id=bank_customer_id,
            level="step_up" if step_up_at is not None else "session",
            level_at=step_up_at,
            simulated=step_up_at is not None,  # the only second factor there is is simulated
        )
        return AgentCredentials(_sign(self._keys.principal, PRINCIPAL_TYP, principal))

    def advisor(
        self, *, staff_id: str, bank_customer_id: str, grant_ref: str, expires_at: datetime
    ) -> AgentCredentials:
        now = self._clock.now()
        principal = self._principal(
            now, kind="advisor", subject_id=staff_id, attrs={"actor": "human"}
        )
        delegation = {
            "subject": {"kind": _SUBJECT_KIND, "ref": bank_customer_id},
            "grant_ref": grant_ref,
            "grantee": {"type": "advisor", "id": staff_id},
            "scopes": [],
            "exp": _iso(expires_at),
        }
        return AgentCredentials(
            _sign(self._keys.principal, PRINCIPAL_TYP, principal),
            _sign(self._keys.delegation, DELEGATION_TYP, delegation),
        )

    def builder(self, identity: BuilderIdentity) -> AgentCredentials:
        principal = self._builder_principal(identity)
        return AgentCredentials(_sign(self._keys.staff, PRINCIPAL_TYP, principal))

    def builder_run(self, identity: BuilderIdentity) -> AgentCredentials:
        principal = self._builder_principal(replace(identity, step_up=False))
        return AgentCredentials(_sign(self._keys.principal, PRINCIPAL_TYP, principal))

    def _builder_principal(self, identity: BuilderIdentity) -> dict[str, Any]:
        now = self._clock.now()
        roles = [
            role
            for role, held in (
                ("constructor", identity.constructor),
                ("aprobador", identity.approver),
                ("admin", identity.admin),
            )
            if held
        ]
        return self._principal(
            now,
            kind="builder",
            subject_id=identity.staff_id,
            roles=roles,
            attrs={"actor": "human"},
            level="step_up" if identity.step_up else "session",
            # a second factor is fresh for the one call it was asked for, not for ten minutes
            ttl=STEP_UP_TTL if identity.step_up else None,
        )

    def _principal(
        self,
        now: datetime,
        *,
        kind: str,
        subject_id: str,
        roles: list[str] | None = None,
        attrs: dict[str, str] | None = None,
        level: str = "session",
        level_at: datetime | None = None,
        simulated: bool = False,
        ttl: timedelta | None = None,
    ) -> dict[str, Any]:
        return {
            "type": kind,
            "id": subject_id,
            "roles": roles or [],
            "scopes": [],
            "attrs": attrs or {},
            "auth": {"level": level, "at": _iso(level_at or now), "simulated": simulated},
            "exp": _iso(now + (ttl or self._ttl)),
        }
