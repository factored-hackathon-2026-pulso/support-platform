"""``backend/openapi.json`` is the frontend contract: it must be current and truthful."""

from __future__ import annotations

from typing import Any

from cc_platform.scripts.export_openapi import DEFAULT_OUTPUT, build_openapi, main, render


def test_committed_openapi_is_up_to_date() -> None:
    assert DEFAULT_OUTPUT.exists(), "run: uv run python -m cc_platform.scripts.export_openapi"
    assert main(["--check"]) == 0, "openapi.json is stale; regenerate it with export_openapi"


def test_export_is_deterministic() -> None:
    assert render(build_openapi()) == render(build_openapi())


def test_every_error_response_is_problem_json() -> None:
    document: dict[str, Any] = build_openapi()
    for path, item in document["paths"].items():
        for method, operation in item.items():
            assert operation["operationId"], (method, path)
            for status, response in operation["responses"].items():
                if status.startswith(("4", "5")) and path != "/api/v1/health":
                    assert list(response["content"]) == ["application/problem+json"], (path, status)
    assert "HTTPValidationError" not in document["components"]["schemas"]


def test_protected_routes_declare_the_session_scheme() -> None:
    paths = build_openapi()["paths"]
    assert paths["/api/v1/auth/me"]["get"]["security"] == [{"SessionToken": []}]
    assert paths["/api/v1/staff"]["get"]["security"] == [{"SessionToken": []}]
    assert "security" not in paths["/api/v1/auth/login"]["post"]


def test_customer_routes_use_the_customer_scheme() -> None:
    paths = build_openapi()["paths"]
    customer = "/api/v1/customer"
    assert paths[f"{customer}/conversation"]["get"]["security"] == [{"CustomerToken": []}]
    assert paths[f"{customer}/conversation/turns"]["post"]["security"] == [{"CustomerToken": []}]
    assert paths[f"{customer}/conversations"]["get"]["security"] == [{"CustomerToken": []}]
    assert paths[f"{customer}/conversations/{{caseId}}"]["get"]["security"] == [
        {"CustomerToken": []}
    ]
    assert "security" not in paths[f"{customer}/demo-customers"]["get"]
    assert "security" not in paths[f"{customer}/sessions"]["post"]
    assert paths["/api/v1/cases/inbox"]["get"]["security"] == [{"SessionToken": []}]


RESPONSE_SCHEMAS = (
    "CaseSummary", "InboxCounts", "CaseDetail", "CaseCustomer", "AssignmentOut", "CaseClosure",
    "CaseHistory", "CaseHistoryItem", "Turn", "CustomerTurn", "CustomerConversation",
    "CustomerConversationResponse", "CustomerConversationSummary", "CustomerConversationDetail",
    "DemoCustomer", "StaffOut", "CaseCapabilities", "TeamOverview", "TeamSummary", "TeamRef",
    "ActivityCounts", "TeamAnalyst", "AnalystCaseCounts", "QueueOverview", "LanguageQueue",
    "QueueCounts", "QueueCount", "AssignmentResult", "AuditEventPage", "AuditEvent", "AuditActor",
    "AuditCaseRef", "AdminUser", "AdminUserGuards", "OpenCaseCounts", "AdminUserList",
    "RoleCounts", "UserStatusCounts", "InvitedUser", "AdminUserChange", "PasswordResetLinkSent",
    "AdminInvitation", "InvitationCheck", "TotpEnrollment", "ActivatedAccount",
    "PasswordResetCheck", "PasswordResetDone", "PasswordRules", "DevMailbox", "DevEmail",
    "AdminTeam", "TeamStatusCounts", "AdminTeamList", "AdminTeamMember", "AdminTeamDetail",
    "AdminTeamChange", "StaffListResponse", "Escalation", "EscalationResult", "EscalationItem",
    "EscalationOverview", "LanguageOpenCases", "OpenCaseRow",
    # slice 12: calls, email, notes
    "Call", "HoldInterval", "CallResponse", "CallList", "EmailMessage", "EmailThread",
    "EmailReplyResponse", "CustomerCall", "CustomerCallState", "CustomerCallResponse",
    "CustomerCallLineResponse", "CustomerEmail", "CustomerEmailThread", "SendEmailResponse",
    # ADR 0003: the assistant
    "AssistantConfirmation", "AssistantStepUp", "AssistantState", "CaseHandoff",
)  # fmt: skip


def test_response_members_are_always_present() -> None:
    """``T | null`` members are required in the schema, so generated types have no ``?``."""
    schemas = build_openapi()["components"]["schemas"]
    for name in RESPONSE_SCHEMAS:
        schema = schemas[name]
        assert set(schema["required"]) == set(schema["properties"]), name


def test_removed_scope_is_gone_from_the_contract() -> None:
    document = build_openapi()
    schemas = document["components"]["schemas"]
    for removed in ("RouteStop", "RoutingSummary", "ChannelIdentity", "CustomerProfile"):
        assert removed not in schemas
    assert schemas["CaseChannel"]["enum"] == [
        "chat_app",
        "chat_web",
        "phone_inbound",
        "phone_outbound",
        "email",
    ]
    assert schemas["CaseStatus"]["enum"] == [
        "queued",
        "assigned",
        "in_progress",
        "closed",
        "with_assistant",  # ADR 0003
    ]
    assert schemas["InboxStatus"]["enum"] == ["new", "to_reply", "waiting", "closed"]
    assert schemas["StaffRole"]["enum"] == ["analyst", "supervisor", "admin"]
    assert set(schemas["ProblemCode"]["enum"]) == {
        "invalid_credentials", "mfa_invalid", "mfa_challenge_invalid", "account_locked",
        "unauthenticated", "session_expired", "forbidden", "not_found", "method_not_allowed",
        "conflict", "concurrent_update", "invalid_transition", "case_not_assigned", "case_closed",
        "idempotency_conflict", "analyst_not_eligible", "language_mismatch", "analyst_paused",
        "assignment_changed", "invalid_value", "policy_violation", "validation_error",
        "domain_error", "application_error", "invalid_topic", "invalid_message", "http_error",
        "internal_error", "version_conflict", "email_taken", "team_name_taken",
        "self_change_forbidden", "last_admin", "staff_has_open_cases", "team_not_empty",
        "team_inactive", "staff_inactive", "case_not_closed", "already_rated",
        "escalation_open", "escalation_not_open",
        # slice 12 (calls)
        "call_in_progress", "call_not_active",
        # part 4 (secure onboarding)
        "staff_invited", "link_invalid", "rate_limited", "password_rejected", "totp_invalid",
        # ADR 0003 (the assistant)
        "assistant_disabled", "assistant_not_active", "assistant_active", "assistant_busy",
        "confirmation_not_pending", "confirmation_expired", "step_up_not_pending",
        "invalid_step_up_code", "handoff_unavailable", "agent_core_unavailable",
        "agent_core_rejected",
    }  # fmt: skip
    for removed in ("CreatedUser", "PasswordResetResult"):  # part 4: no temporary passwords
        assert removed not in schemas
    assert "temporaryPassword" not in str(document)
    assert set(schemas["CloseCaseRequest"]["required"]) == {"reason", "note"}
