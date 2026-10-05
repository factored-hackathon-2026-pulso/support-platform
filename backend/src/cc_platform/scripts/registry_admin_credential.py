"""Sign a short-lived admin credential for agent-core's registry CLI (loading the seed agents).

Usage (where ``CC_AGENT_KEYS_FILE`` is readable, e.g. inside the platform API container)::

    uv run python -m cc_platform.scripts.registry_admin_credential --staff-id <staff id>

Prints one JWS to stdout and nothing else: a ``builder`` principal for that person with the
``constructor``, ``aprobador`` and ``admin`` roles at ``step_up``, signed with the platform's
**staff** key, the one agent-core verifies with ``--staff-keys`` /
``AGENTCORE_STAFF_KEYS_FILE``. It is valid for two minutes (the step-up window): use it at once,
as ``AGENTCORE_CREDENTIAL`` for ``agentcore registry --verifier
agent_core.composition.registry:staff_verifier import <seed dir>``. ``import`` only succeeds on
an empty registry for each agent.

Whoever can read the private key file can sign any credential: this script adds no power, it
only spares typing the claims. It never prints the key.
"""

from __future__ import annotations

import argparse
import os
import sys
from pathlib import Path

from cc_platform.application.ai.credentials import BuilderIdentity
from cc_platform.infrastructure.ai.ed25519_issuer import Ed25519AgentCredentialIssuer
from cc_platform.infrastructure.ai.keys import AgentSigningKeys
from cc_platform.infrastructure.clock import SystemClock

KEYS_ENV = "CC_AGENT_KEYS_FILE"


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--staff-id", required=True, help="the person the registry will record")
    parser.add_argument(
        "--keys", type=Path, default=None, help=f"private key file (default: ${KEYS_ENV})"
    )
    args = parser.parse_args(argv)
    path = args.keys or (Path(os.environ[KEYS_ENV]) if os.environ.get(KEYS_ENV) else None)
    if path is None:
        print(f"set {KEYS_ENV} or pass --keys", file=sys.stderr)
        return 2
    try:
        keys = AgentSigningKeys.from_file(path)
    except ValueError as error:
        print(str(error), file=sys.stderr)
        return 2
    issuer = Ed25519AgentCredentialIssuer(keys, SystemClock())
    identity = BuilderIdentity(
        staff_id=args.staff_id, constructor=True, approver=True, admin=True, step_up=True
    )
    print(issuer.builder(identity).authorization)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
