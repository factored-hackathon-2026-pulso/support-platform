"""Every error code the code base can raise is registered in ``ProblemCode`` (no drift)."""

from __future__ import annotations

import importlib
import pkgutil

import cc_platform
from cc_platform.api.problems import CODE_BY_HTTP_STATUS, PROBLEMS, ProblemCode
from cc_platform.application.errors import ApplicationError
from cc_platform.domain.shared.errors import DomainError


def _all_subclasses(base: type) -> set[type]:
    found: set[type] = set()
    pending = [base]
    while pending:
        for subclass in pending.pop().__subclasses__():
            if subclass not in found:
                found.add(subclass)
                pending.append(subclass)
    return found


def _import_everything() -> None:
    for module in pkgutil.walk_packages(cc_platform.__path__, prefix="cc_platform."):
        if ".scripts." not in module.name:
            importlib.import_module(module.name)


def test_every_error_class_uses_a_registered_code() -> None:
    _import_everything()
    errors = {DomainError, ApplicationError} | _all_subclasses(DomainError)
    errors |= _all_subclasses(ApplicationError)
    unregistered = {
        f"{error.__module__}.{error.__qualname__}: {error.code}"
        for error in errors
        if error.code not in set(ProblemCode)
    }
    assert unregistered == set()


def test_every_code_has_exactly_one_spec() -> None:
    assert set(PROBLEMS) == set(ProblemCode)
    assert all(400 <= spec.status <= 599 for spec in PROBLEMS.values())
    assert all(PROBLEMS[code].status == status for status, code in CODE_BY_HTTP_STATUS.items())


def test_openapi_publishes_the_codes_as_an_enum(client) -> None:  # type: ignore[no-untyped-def]
    schemas = client.get("/api/v1/openapi.json").json()["components"]["schemas"]
    assert set(schemas["ProblemCode"]["enum"]) == {code.value for code in ProblemCode}
    problem = schemas["ProblemDetails"]["properties"]
    assert problem["code"] == {"$ref": "#/components/schemas/ProblemCode"}
    assert {
        "remainingAttempts", "unlockAt", "requiredRoles", "errors", "currentStatus",
        "analystId", "policyRuleId", "caseLanguage", "currentAnalystId",
        # slice 4
        "field", "currentVersion", "current", "action", "blockReason", "openCases", "caseIds",
        "memberCount", "teamId",
    } <= set(problem)  # fmt: skip
    assert problem["action"]["anyOf"][0] == {"$ref": "#/components/schemas/SelfChangeAction"}
    assert problem["blockReason"]["anyOf"][0] == {"$ref": "#/components/schemas/OpenCasesBlock"}
    assert problem["caseLanguage"]["anyOf"][0] == {"$ref": "#/components/schemas/Language"}
    assert problem["currentStatus"]["anyOf"][0] == {"$ref": "#/components/schemas/CaseStatus"}
