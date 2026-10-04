"""Base schema (camelCase on the wire) and the RFC 7807 problem schema."""

from __future__ import annotations

from datetime import datetime
from typing import Any

from pydantic import BaseModel, ConfigDict, Field
from pydantic.alias_generators import to_camel

from cc_platform.api.problems import ProblemCode
from cc_platform.application.people.admin.dto import OpenCasesBlock, SelfChangeAction
from cc_platform.domain.cases.escalation import EscalationState
from cc_platform.domain.cases.values import CaseStatus
from cc_platform.domain.people.password_policy import PasswordRule
from cc_platform.domain.people.staff import Language, StaffRole

PROBLEM_MEDIA_TYPE = "application/problem+json"


class ApiModel(BaseModel):
    """All request/response bodies: camelCase aliases, snake_case in Python."""

    model_config = ConfigDict(
        alias_generator=to_camel,
        validate_by_name=True,
        validate_by_alias=True,
        serialize_by_alias=True,
        frozen=True,
    )


class RequestModel(ApiModel):
    """Request bodies reject unknown fields so typos fail loudly."""

    model_config = ConfigDict(extra="forbid")


class ValidationIssue(ApiModel):
    loc: list[str]
    msg: str
    type: str


class ProblemDetails(ApiModel):
    """RFC 7807 problem. ``code`` is the stable machine identifier clients branch on.

    The optional members below are the documented extensions; a domain error may add other
    structured details (e.g. ``openCaseId`` on ``conflict``), hence
    ``additionalProperties``.
    """

    model_config = ConfigDict(extra="allow")

    type: str = Field(examples=["urn:cc-platform:problem:account_locked"])
    title: str
    status: int
    code: ProblemCode
    detail: str | None = None
    instance: str | None = None
    request_id: str | None = None
    remaining_attempts: int | None = Field(
        default=None,
        description=(
            "invalid_credentials, mfa_invalid, totp_invalid: failed attempts left before the lock."
        ),
    )
    unlock_at: datetime | None = Field(
        default=None, description="account_locked, rate_limited: when the lock ends."
    )
    reasons: list[PasswordRule] | None = Field(
        default=None, description="password_rejected: every rule the password breaks."
    )
    required_roles: list[StaffRole] | None = Field(
        default=None, description="forbidden: roles that may perform the action."
    )
    errors: list[ValidationIssue] | None = Field(
        default=None, description="validation_error: one entry per invalid field."
    )
    current_status: CaseStatus | None = Field(
        default=None,
        description="invalid_transition, case_closed, case_not_closed: the case status now.",
    )
    analyst_id: str | None = Field(
        default=None,
        description="analyst_not_eligible, language_mismatch, analyst_paused: the target.",
    )
    policy_rule_id: str | None = Field(
        default=None, description='language_mismatch: the rule behind it ("H1", rule 3).'
    )
    case_language: Language | None = Field(
        default=None,
        description=(
            "language_mismatch: the language of the case; staff_has_open_cases "
            "(remove_language): the language of the blocking cases."
        ),
    )
    current_analyst_id: str | None = Field(
        default=None,
        description="assignment_changed: who holds the case now (null = it is queued).",
    )
    field: str | None = Field(
        default=None,
        description=(
            "invalid_value, email_taken, team_name_taken: the request field at fault "
            "(name, email, roles, languages, teamId)."
        ),
    )
    current_version: int | None = Field(
        default=None, description="version_conflict: the record's version now."
    )
    current: dict[str, Any] | None = Field(
        default=None,
        description=(
            "version_conflict: the record as its GET returns it now (AdminUser or AdminTeam; "
            "CaseSummary for a case priority, slice 8)."
        ),
    )
    action: SelfChangeAction | None = Field(
        default=None, description="self_change_forbidden: which change on her own account."
    )
    block_reason: OpenCasesBlock | None = Field(
        default=None, description="staff_has_open_cases: which change the open cases block."
    )
    open_cases: int | None = Field(
        default=None, description="staff_has_open_cases: how many open cases block it."
    )
    case_ids: list[str] | None = Field(
        default=None, description="staff_has_open_cases: those cases (at most 20)."
    )
    member_count: int | None = Field(
        default=None, description="team_not_empty: the team's active members."
    )
    team_id: str | None = Field(default=None, description="team_inactive: the team.")
    escalation_id: str | None = Field(
        default=None, description="escalation_open: the case's open escalation (slice 9)."
    )
    current_state: EscalationState | None = Field(
        default=None, description="escalation_not_open: the escalation's state now (slice 9)."
    )


def problem_responses(*statuses: int) -> dict[int | str, dict[str, Any]]:
    """OpenAPI ``responses`` entries for error statuses.

    The content type and schema are filled in by ``cc_platform.api.openapi`` so that every
    4xx/5xx response of the document is ``application/problem+json`` → ``ProblemDetails``.
    """
    return {status: {"description": "Problem details (RFC 7807)"} for status in statuses}
