"""FastAPI application factory.

``uvicorn cc_platform.bootstrap.app:create_app --factory`` builds the app from the
environment; tests call ``create_app(settings, container=...)`` with their own container.
"""

from __future__ import annotations

from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from cc_platform import __version__
from cc_platform.api.dependencies import API_CONTEXT_STATE
from cc_platform.api.errors import install_error_handlers
from cc_platform.api.middleware import (
    CORRELATION_ID_HEADER,
    REQUEST_ID_HEADER,
    RequestContextMiddleware,
    UnhandledErrorMiddleware,
)
from cc_platform.api.openapi import install_openapi
from cc_platform.api.router import API_PREFIX, build_api_router, operation_id
from cc_platform.bootstrap.container import Container, build_container
from cc_platform.bootstrap.settings import Settings
from cc_platform.infrastructure.logging import configure_logging

DESCRIPTION = (
    "API of the LATAM Bank contact-center platform (transaction-dispute intake). "
    "Errors are RFC 7807 `application/problem+json` with a stable `code`. "
    "Realtime: WebSocket `/api/v1/ws?token=…` with `{type,id,occurredAt,data}` envelopes."
)


def create_app(settings: Settings | None = None, *, container: Container | None = None) -> FastAPI:
    settings = settings or (container.settings if container else Settings())
    configure_logging(level=settings.log_level, fmt=settings.log_format)
    container = container or build_container(settings)

    @asynccontextmanager
    async def lifespan(_app: FastAPI) -> AsyncIterator[None]:
        await container.startup()
        try:
            yield
        finally:
            await container.shutdown()

    app = FastAPI(
        title="CC Platform API",
        version=__version__,
        description=DESCRIPTION,
        lifespan=lifespan,
        openapi_url=f"{API_PREFIX}/openapi.json",
        docs_url=f"{API_PREFIX}/docs",
        redoc_url=None,
        generate_unique_id_function=operation_id,
    )
    # Routers only see the narrow ``ApiContext``, never the container (adapters, UoW).
    setattr(app.state, API_CONTEXT_STATE, container.api_context())

    install_error_handlers(app)
    install_openapi(app)
    # Middleware order: the last added is the outermost.
    # RequestContext → CORS → UnhandledError → routes: a crash still gets CORS headers.
    app.add_middleware(UnhandledErrorMiddleware)
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
        expose_headers=[REQUEST_ID_HEADER, CORRELATION_ID_HEADER],
    )
    # Added last → outermost: CORS and error responses also carry the request id.
    app.add_middleware(RequestContextMiddleware)
    app.include_router(build_api_router())
    return app
