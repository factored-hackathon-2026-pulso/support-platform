"""Generate the platform's agent-core signing keys (ADR 0003 §2).

Usage: ``uv run python -m cc_platform.scripts.gen_agent_keys --out .agent-keys --suffix 2026-10``

Writes three files into ``--out`` (default ``backend/.agent-keys``, git-ignored):

- ``private.json``: the secret seeds; the platform reads it through ``CC_AGENT_KEYS_FILE``;
- ``identity-keys.json``: public keys for ``agentcore serve --identity-keys``;
- ``staff-keys.json``: public keys for ``agentcore serve --staff-keys``.

It refuses to overwrite ``private.json``: rotating means a new ``--suffix`` next to the old key
(publish both public files, switch the platform, retire the old one later).
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

from cc_platform.bootstrap.settings import BACKEND_DIR
from cc_platform.infrastructure.ai.keys import AgentSigningKeys


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--out", type=Path, default=BACKEND_DIR / ".agent-keys")
    parser.add_argument("--suffix", required=True, help="goes in each kid, e.g. 2026-10")
    args = parser.parse_args(argv)

    private_path = args.out / "private.json"
    if private_path.exists():
        print(f"{private_path} already exists; use a new --out for a rotation", file=sys.stderr)
        return 1
    keys = AgentSigningKeys.generate(suffix=args.suffix)
    identity, staff = keys.public_documents()
    args.out.mkdir(parents=True, exist_ok=True)
    private_path.write_text(json.dumps(keys.private_document(), indent=2), encoding="utf-8")
    (args.out / "identity-keys.json").write_text(json.dumps(identity, indent=2), encoding="utf-8")
    (args.out / "staff-keys.json").write_text(json.dumps(staff, indent=2), encoding="utf-8")
    print(f"keys written to {args.out} (private.json is secret: never commit it)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
