"""Export the OpenAPI document to ``backend/openapi.json`` (stable, sorted keys).

Usage: ``uv run python -m cc_platform.scripts.export_openapi [--output PATH] [--check]``.
``--check`` exits with status 1 when the file on disk is out of date (for CI).
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Any

from cc_platform.bootstrap.app import create_app
from cc_platform.bootstrap.settings import BACKEND_DIR, Settings

DEFAULT_OUTPUT = BACKEND_DIR / "openapi.json"


def build_openapi() -> dict[str, Any]:
    settings = Settings(
        env="dev",
        persistence="memory",
        seed_demo_data=False,
        log_level="WARNING",
        build="openapi",
    )
    return create_app(settings).openapi()


def render(document: dict[str, Any]) -> str:
    return json.dumps(document, indent=2, sort_keys=True, ensure_ascii=False) + "\n"


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    parser.add_argument("--check", action="store_true", help="fail if the file is stale")
    args = parser.parse_args(argv)

    content = render(build_openapi())
    output: Path = args.output
    if args.check:
        current = output.read_text(encoding="utf-8") if output.exists() else ""
        if current != content:
            print(f"{output} is out of date; run export_openapi", file=sys.stderr)
            return 1
        return 0
    output.write_text(content, encoding="utf-8")
    print(f"wrote {output}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
