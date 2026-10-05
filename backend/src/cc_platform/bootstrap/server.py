"""``cc-api`` console script: run the API with uvicorn using ``CC_*`` settings.

Production behaviour (``docs/platform/deploy-env.md``): the configuration is checked before
anything starts (``load_settings`` exits with status 2 and the list of problems); forwarded
headers are handled by the app (``TrustedProxyMiddleware``, ``CC_TRUSTED_PROXIES``), so
uvicorn's own proxy handling is off; SIGTERM drains in-flight requests for at most
``CC_SHUTDOWN_TIMEOUT_SECONDS`` and closes the WebSockets with 1012 (service restart).
"""

from __future__ import annotations

import math

import uvicorn

from cc_platform.bootstrap.startup import load_settings


def main() -> None:
    settings = load_settings()
    uvicorn.run(
        "cc_platform.bootstrap.app:create_app",
        factory=True,
        host=settings.host,
        port=settings.port,
        reload=settings.reload_enabled,
        access_log=False,
        log_config=None,
        proxy_headers=False,
        server_header=False,
        timeout_graceful_shutdown=math.ceil(settings.shutdown_timeout_seconds),
    )


if __name__ == "__main__":  # pragma: no cover
    main()
