"""``registry_admin_credential``: a short-lived admin ``builder`` credential signed with the
staff key, for agent-core's registry CLI (loading the seed agents)."""

from __future__ import annotations

import json
from pathlib import Path

import pytest
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PublicKey

from cc_platform.infrastructure.ai.keys import AgentSigningKeys, b64url_decode
from cc_platform.scripts.registry_admin_credential import main


def _keys_file(tmp_path: Path) -> tuple[Path, AgentSigningKeys]:
    keys = AgentSigningKeys.generate(suffix="test")
    path = tmp_path / "private.json"
    path.write_text(json.dumps(keys.private_document()), encoding="utf-8")
    return path, keys


def test_prints_only_a_staff_signed_admin_step_up_credential(
    tmp_path: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    path, keys = _keys_file(tmp_path)
    assert main(["--staff-id", "STF-ana", "--keys", str(path)]) == 0
    out = capsys.readouterr()
    token = out.out.strip()
    assert out.err == ""
    assert "\n" not in token
    head, body, signature = token.split(".")
    header, claims = json.loads(b64url_decode(head)), json.loads(b64url_decode(body))
    assert header["kid"] == keys.staff.kid  # verified by agent-core's --staff-keys
    Ed25519PublicKey.from_public_bytes(b64url_decode(keys.staff.public_b64url())).verify(
        b64url_decode(signature), f"{head}.{body}".encode("ascii")
    )
    assert claims["type"] == "builder"
    assert claims["id"] == "STF-ana"
    assert set(claims["roles"]) == {"constructor", "aprobador", "admin"}
    assert claims["attrs"] == {"actor": "human"}
    assert claims["auth"]["level"] == "step_up"
    assert seed_hidden(keys, token)


def seed_hidden(keys: AgentSigningKeys, token: str) -> bool:
    return keys.staff.seed_b64url() not in token


def test_without_a_key_file_it_refuses(
    tmp_path: Path, capsys: pytest.CaptureFixture[str], monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.delenv("CC_AGENT_KEYS_FILE", raising=False)
    assert main(["--staff-id", "STF-ana"]) == 2
    assert main(["--staff-id", "STF-ana", "--keys", str(tmp_path / "missing.json")]) == 2
    assert capsys.readouterr().out == ""
