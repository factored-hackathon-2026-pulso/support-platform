"""``cc-api`` console script: run the API with uvicorn using ``CC_*`` settings."""

from __future__ import annotations

import uvicorn

from cc_platform.bootstrap.settings import Settings


def main() -> None:
    settings = Settings()
    uvicorn.run(
        "cc_platform.bootstrap.app:create_app",
        factory=True,
        host=settings.host,
        port=settings.port,
        reload=settings.env == "dev",
        access_log=False,
        log_config=None,
    )


if __name__ == "__main__":  # pragma: no cover
    main()
