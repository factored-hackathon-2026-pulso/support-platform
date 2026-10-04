"""RFC 7807 problem+json responses and the error → HTTP mapping.

Domain and application errors carry a stable ``code``; the HTTP status, title and default
detail of each code come from the registry in ``cc_platform.api.problems`` (single source).
An unregistered code (a bug caught by the problem-code tests) still answers safely as
``domain_error`` (422) or ``application_error`` (400), never a 500 by accident.

Unexpected exceptions are turned into a 500 problem by ``UnhandledErrorMiddleware``
(``cc_platform.api.middleware``), which runs inside CORS so the browser can read the body.
"""

from __future__ import annotations

from collections.abc import Mapping
from typing import Any

import structlog
from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException

from cc_platform.api.problems import (
    CODE_BY_HTTP_STATUS,
    ProblemCode,
    problem_code,
    spec_for,
)
from cc_platform.api.schemas import builder as builder_schemas
from cc_platform.api.schemas.common import PROBLEM_MEDIA_TYPE
from cc_platform.application.ai.errors import RegistryRejectedError
from cc_platform.application.errors import ApplicationError
from cc_platform.domain.shared.errors import DomainError

_log = structlog.get_logger(__name__)

PROBLEM_TYPE_PREFIX = "urn:cc-platform:problem:"


def code_for(error: DomainError | ApplicationError) -> ProblemCode:
    fallback = (
        ProblemCode.DOMAIN_ERROR
        if isinstance(error, DomainError)
        else ProblemCode.APPLICATION_ERROR
    )
    code = problem_code(error.code, fallback=fallback)
    if code is fallback and error.code != fallback.value:
        _log.warning("unregistered_problem_code", code=error.code)
    return code


def problem_response(
    request: Request,
    *,
    code: ProblemCode,
    status: int | None = None,
    detail: str | None = None,
    extensions: Mapping[str, Any] | None = None,
    headers: Mapping[str, str] | None = None,
) -> JSONResponse:
    spec = spec_for(code)
    status = status or spec.status
    request_id = getattr(request.state, "request_id", None)
    body: dict[str, Any] = {
        "type": f"{PROBLEM_TYPE_PREFIX}{code.value}",
        "title": spec.title,
        "status": status,
        "code": code.value,
        "detail": detail or spec.detail,
        "instance": request.url.path,
        "requestId": request_id,
    }
    # Extensions never override the RFC 7807 members (a detail named "status" is dropped).
    for key, value in (extensions or {}).items():
        body.setdefault(key, value)
    response_headers = dict(headers or {})
    if status == 401:
        response_headers.setdefault("WWW-Authenticate", "Bearer")
    if request_id:
        response_headers.setdefault("X-Request-ID", request_id)
    return JSONResponse(
        body, status_code=status, media_type=PROBLEM_MEDIA_TYPE, headers=response_headers
    )


def internal_error_response(request: Request) -> JSONResponse:
    return problem_response(request, code=ProblemCode.INTERNAL_ERROR)


async def _handle_business_error(request: Request, exc: Exception) -> JSONResponse:
    if not isinstance(exc, DomainError | ApplicationError):  # pragma: no cover - registration bug
        raise exc
    code = code_for(exc)
    _log.info("request_rejected", code=code.value, status=spec_for(code).status)
    return problem_response(request, code=code, detail=exc.message, extensions=exc.details)


async def _handle_registry_error(request: Request, exc: Exception) -> JSONResponse:
    """A registry refusal: its structured parts are rendered with the builder schemas."""
    if not isinstance(exc, RegistryRejectedError):  # pragma: no cover - registration bug
        raise exc
    code = code_for(exc)
    extensions: dict[str, Any] = {"registryCode": exc.registry_code}
    if exc.violations:
        extensions["violations"] = [
            builder_schemas.Violation.model_validate(v).model_dump(mode="json", by_alias=True)
            for v in exc.violations
        ]
    if exc.report is not None:
        extensions["report"] = builder_schemas.EvalReport.model_validate(exc.report).model_dump(
            mode="json", by_alias=True
        )
    if exc.eval_run_id is not None:
        extensions["evalRunId"] = exc.eval_run_id
    if exc.yardstick_loosened:
        extensions["yardstickLoosened"] = [
            builder_schemas.YardstickChange.model_validate(c).model_dump(mode="json", by_alias=True)
            for c in exc.yardstick_loosened
        ]
    _log.info("request_rejected", code=code.value, registry_code=exc.registry_code)
    return problem_response(request, code=code, detail=exc.message, extensions=extensions)


async def _handle_validation_error(request: Request, exc: Exception) -> JSONResponse:
    if not isinstance(exc, RequestValidationError):  # pragma: no cover - registration bug
        raise exc
    errors = [
        {
            "loc": [str(part) for part in error.get("loc", ())],
            "msg": error.get("msg", ""),
            "type": error.get("type", ""),
        }
        for error in exc.errors()
    ]
    return problem_response(
        request, code=ProblemCode.VALIDATION_ERROR, extensions={"errors": errors}
    )


async def _handle_http_error(request: Request, exc: Exception) -> JSONResponse:
    if not isinstance(exc, StarletteHTTPException):  # pragma: no cover - registration bug
        raise exc
    code = CODE_BY_HTTP_STATUS.get(exc.status_code, ProblemCode.HTTP_ERROR)
    detail = spec_for(code).detail or (exc.detail if isinstance(exc.detail, str) else None)
    return problem_response(
        request, code=code, status=exc.status_code, detail=detail, headers=exc.headers
    )


def install_error_handlers(app: FastAPI) -> None:
    app.add_exception_handler(DomainError, _handle_business_error)
    app.add_exception_handler(ApplicationError, _handle_business_error)
    app.add_exception_handler(RegistryRejectedError, _handle_registry_error)
    app.add_exception_handler(RequestValidationError, _handle_validation_error)
    app.add_exception_handler(StarletteHTTPException, _handle_http_error)
