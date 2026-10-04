"""The platform's signing keys for agent-core credentials.

Three independent Ed25519 keys, so that compromising one purpose never forges another:

- ``principal``: customers and analysts (agent-core's ``--identity-keys`` ``principal_keys``);
- ``delegation``: the assignment grants (``--identity-keys`` ``delegation_keys``);
- ``staff``: supervisors and administrators acting on the registry (``--staff-keys``).

The private file is secret (git-ignored, a secrets manager in a deployment). What agent-core
loads is the public document, which ``public_documents`` builds. Rotating is publishing a new
``kid`` next to the old one and retiring the old one later: agent-core re-reads its files.
"""

from __future__ import annotations

import json
from base64 import urlsafe_b64decode, urlsafe_b64encode
from dataclasses import dataclass
from pathlib import Path

from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey

_PURPOSES = ("principal", "delegation", "staff")
_SEED_BYTES = 32


def b64url(data: bytes) -> str:
    return urlsafe_b64encode(data).rstrip(b"=").decode("ascii")


def b64url_decode(text: str) -> bytes:
    return urlsafe_b64decode(text + "=" * (-len(text) % 4))


@dataclass(frozen=True, slots=True)
class SigningKey:
    kid: str
    private: Ed25519PrivateKey

    def public_b64url(self) -> str:
        raw = self.private.public_key().public_bytes(
            serialization.Encoding.Raw, serialization.PublicFormat.Raw
        )
        return b64url(raw)

    def seed_b64url(self) -> str:
        raw = self.private.private_bytes(
            serialization.Encoding.Raw,
            serialization.PrivateFormat.Raw,
            serialization.NoEncryption(),
        )
        return b64url(raw)


@dataclass(frozen=True, slots=True)
class AgentSigningKeys:
    principal: SigningKey
    delegation: SigningKey
    staff: SigningKey

    @classmethod
    def generate(cls, *, suffix: str) -> AgentSigningKeys:
        """New random keys; ``suffix`` goes in each ``kid`` (for example ``2026-10``)."""
        return cls(
            principal=SigningKey(f"cc-principal-{suffix}", Ed25519PrivateKey.generate()),
            delegation=SigningKey(f"cc-grant-{suffix}", Ed25519PrivateKey.generate()),
            staff=SigningKey(f"cc-staff-{suffix}", Ed25519PrivateKey.generate()),
        )

    def private_document(self) -> dict[str, dict[str, str]]:
        return {
            purpose: {"kid": key.kid, "seed": key.seed_b64url()}
            for purpose, key in (
                ("principal", self.principal),
                ("delegation", self.delegation),
                ("staff", self.staff),
            )
        }

    @classmethod
    def from_private_document(cls, document: object) -> AgentSigningKeys:
        if not isinstance(document, dict) or set(document) != set(_PURPOSES):
            raise ValueError("the agent key file must have exactly: " + ", ".join(_PURPOSES))
        loaded: dict[str, SigningKey] = {}
        for purpose in _PURPOSES:
            entry = document[purpose]
            if not isinstance(entry, dict) or not isinstance(entry.get("kid"), str):
                raise ValueError(f"agent key '{purpose}': kid is missing")
            try:
                seed = b64url_decode(str(entry.get("seed", "")))
                if len(seed) != _SEED_BYTES:
                    raise ValueError("length")
                private = Ed25519PrivateKey.from_private_bytes(seed)
            except ValueError:
                # never echo the seed
                raise ValueError(
                    f"agent key '{purpose}': the seed is not 32 bytes of base64url"
                ) from None
            loaded[purpose] = SigningKey(str(entry["kid"]), private)
        return cls(loaded["principal"], loaded["delegation"], loaded["staff"])

    @classmethod
    def from_file(cls, path: Path) -> AgentSigningKeys:
        try:
            text = path.read_text(encoding="utf-8")
        except OSError:
            raise ValueError(f"cannot read the agent key file ({path.name})") from None
        try:
            return cls.from_private_document(json.loads(text))
        except json.JSONDecodeError:
            raise ValueError(f"the agent key file is not JSON ({path.name})") from None

    def public_documents(self) -> tuple[dict[str, dict[str, str]], dict[str, dict[str, str]]]:
        """``(identity, staff)``: agent-core's ``--identity-keys`` and ``--staff-keys`` files."""
        identity = {
            "principal_keys": {self.principal.kid: self.principal.public_b64url()},
            "delegation_keys": {self.delegation.kid: self.delegation.public_b64url()},
        }
        staff = {"principal_keys": {self.staff.kid: self.staff.public_b64url()}}
        return identity, staff
