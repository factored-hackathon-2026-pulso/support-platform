"""OpenAPI post-processing: every error response is ``application/problem+json``.

FastAPI documents validation errors as ``HTTPValidationError`` (``application/json``); the
API actually answers RFC 7807 problems (see ``cc_platform.api.errors``). Rewriting the
document here keeps ``openapi.json`` truthful, so the frontend's generated types match.
"""

from __future__ import annotations

from typing import Any

from fastapi import FastAPI
from fastapi.openapi.utils import get_openapi

from cc_platform.api.schemas.common import PROBLEM_MEDIA_TYPE, ProblemDetails

_PROBLEM_REF = {"$ref": "#/components/schemas/ProblemDetails"}
_FASTAPI_VALIDATION_SCHEMAS = ("HTTPValidationError", "ValidationError")


def install_openapi(app: FastAPI) -> None:
    def openapi() -> dict[str, Any]:
        if app.openapi_schema is None:
            document = get_openapi(
                title=app.title,
                version=app.version,
                description=app.description,
                routes=app.routes,
            )
            app.openapi_schema = problemize(document)
        return app.openapi_schema

    app.openapi = openapi  # type: ignore[method-assign]


def problemize(document: dict[str, Any]) -> dict[str, Any]:
    schemas: dict[str, Any] = document.setdefault("components", {}).setdefault("schemas", {})
    problem_schema = ProblemDetails.model_json_schema(
        by_alias=True, ref_template="#/components/schemas/{model}"
    )
    # Nested models/enums (ProblemCode, ValidationIssue, StaffRole) become components too.
    schemas.update(problem_schema.pop("$defs", {}))
    schemas["ProblemDetails"] = problem_schema
    for path_item in document.get("paths", {}).values():
        for operation in path_item.values():
            for status, response in operation.get("responses", {}).items():
                if str(status)[:1] in {"4", "5"} and _is_generic_error(response):
                    response["content"] = {PROBLEM_MEDIA_TYPE: {"schema": dict(_PROBLEM_REF)}}
                    if response.get("description") == "Validation Error":
                        response["description"] = "Problem details (RFC 7807): validation_error"
    for name in _FASTAPI_VALIDATION_SCHEMAS:
        schemas.pop(name, None)
    return document


def _is_generic_error(response: dict[str, Any]) -> bool:
    """True unless the route documented its own body (e.g. ``/health`` 503 → HealthResponse)."""
    content = response.get("content")
    if not content:
        return True
    refs = {media.get("schema", {}).get("$ref", "") for media in content.values()}
    return all(ref.endswith(_FASTAPI_VALIDATION_SCHEMAS) for ref in refs)
