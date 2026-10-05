"""Fail fast on a broken configuration: read the ``CC_*`` settings once, at startup, and stop
with a readable list of what is wrong instead of a traceback.

The message names variables and rules only: ``Settings`` hides input values in its errors
(``hide_input_in_errors``) and the deployment rules never quote a value, so a secret can
never reach the output.
"""

from __future__ import annotations

import sys
from typing import TextIO

from pydantic import ValidationError

from cc_platform.bootstrap.deploy_checks import DeploymentConfigError
from cc_platform.bootstrap.settings import Settings

#: Exit status of a refused configuration (a usage error, not a crash).
CONFIG_EXIT_STATUS = 2


def describe_settings_error(error: ValidationError) -> list[str]:
    """One line per problem: ``CC_PORT: Input should be a valid integer``."""
    lines: list[str] = []
    for item in error.errors(include_input=False, include_url=False):
        cause = (item.get("ctx") or {}).get("error")
        if isinstance(cause, DeploymentConfigError):
            lines.extend(cause.problems)
            continue
        location = ".".join(str(part) for part in item["loc"])
        name = f"CC_{location.upper()}" if location else "configuration"
        lines.append(f"{name}: {item['msg']}")
    return lines


def load_settings(stream: TextIO | None = None) -> Settings:
    """``Settings()`` from the environment, or exit with status 2 and the list of problems."""
    try:
        return Settings()
    except ValidationError as error:
        out = stream or sys.stderr
        print("Invalid configuration: the API will not start.", file=out)
        for line in describe_settings_error(error):
            print(f"  - {line}", file=out)
        print("See docs/platform/deploy-env.md for every CC_* variable.", file=out)
        raise SystemExit(CONFIG_EXIT_STATUS) from None
