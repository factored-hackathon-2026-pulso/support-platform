"""Analyst REST API: inbox, detail, history, turns, replies, read, close, availability."""

from __future__ import annotations

import uuid
from collections.abc import Callable
from datetime import timedelta
from typing import Any

import pytest
from fastapi.testclient import TestClient

from cc_platform.infrastructure.clock import FixedClock
from cc_platform.infrastructure.seed.cases import seed_case_id
from tests.support import ANALYST, JULIAN, PAULA, SUPERVISOR, TEAM_LEAD, bearer

MARCELA, BEATRIZ, LARISSA, JOAQUIN = (seed_case_id(n) for n in (101, 102, 103, 107))
PATRICIA_REFUND, CLAUDIA, HECTOR, PATRICIA_AGAIN, GABRIELA, PATRICIA_OLD = (
    seed_case_id(n) for n in (104, 105, 106, 108, 109, 110)
)
ADMIN_EMAIL = "carolina.pena@latambank.example"
CLOSE_BODY = {"reason": "resolved", "note": None}
SUMMARY_KEYS = {
    "id", "version", "customer", "channel", "language", "priority", "status", "inboxStatus",
    "openedAt", "slaDueAt", "firstResponseAt", "lastInteractionAt", "preview",
    "previewAuthorRole", "assignedAnalystId", "unreadCount", "lastSequence", "previousCaseId",
    "closedAt", "closeReason", "rating", "escalated",
}  # fmt: skip


@pytest.fixture
def daniela(sign_in: Callable[[str], str]) -> dict[str, str]:
    return bearer(sign_in(ANALYST.email))


def reply(
    client: TestClient,
    headers: dict[str, str],
    case_id: str,
    text: str,
    client_message_id: str | None = None,
    *,
    key: str | None = None,
) -> Any:
    cmid = client_message_id or str(uuid.uuid4())
    return client.post(
        f"/api/v1/cases/{case_id}/turns",
        headers={**headers, "Idempotency-Key": key or cmid},
        json={"text": text, "clientMessageId": cmid},
    )


def close(client: TestClient, headers: dict[str, str], case_id: str, body: object) -> Any:
    return client.post(f"/api/v1/cases/{case_id}/close", headers=headers, json=body)


# ----------------------------------------------------------------------------- inbox
def test_inbox_lists_the_open_cases_with_counts(
    client: TestClient, daniela: dict[str, str]
) -> None:
    response = client.get("/api/v1/cases/inbox", headers=daniela)
    assert response.status_code == 200
    body = response.json()
    assert body["counts"] == {
        "all": 5,
        "new": 2,
        "toReply": 2,
        "waiting": 1,
        "closed": 3,
        "computedAt": "2026-10-02T14:00:00Z",
    }
    assert [i["id"] for i in body["items"]] == [PATRICIA_AGAIN, LARISSA, MARCELA, BEATRIZ, JOAQUIN]
    first = body["items"][0]
    assert set(first) == SUMMARY_KEYS
    assert (first["inboxStatus"], first["previousCaseId"]) == ("new", PATRICIA_REFUND)
    beatriz = body["items"][3]
    assert (beatriz["firstResponseAt"], beatriz["slaDueAt"]) == (None, "2026-10-02T14:02:00Z")
    assert body["serverTime"] == "2026-10-02T14:00:00Z"


def test_inbox_filters_closed_and_search(client: TestClient, daniela: dict[str, str]) -> None:
    waiting = client.get("/api/v1/cases/inbox?status=waiting", headers=daniela).json()
    assert [i["id"] for i in waiting["items"]] == [JOAQUIN]
    assert waiting["counts"]["all"] == 5
    closed = client.get("/api/v1/cases/inbox?status=closed", headers=daniela).json()
    assert [i["id"] for i in closed["items"]] == [HECTOR, CLAUDIA, PATRICIA_REFUND]
    assert [i["closeReason"] for i in closed["items"]] == [
        "out_of_scope",
        "customer_unresponsive",
        "resolved",
    ]
    assert {i["inboxStatus"] for i in closed["items"]} == {"closed"}
    assert closed["counts"] == waiting["counts"]
    found = client.get("/api/v1/cases/inbox", params={"q": "BEATRIZ"}, headers=daniela).json()
    assert [i["customer"]["displayName"] for i in found["items"]] == ["Beatriz Salcedo Prieto"]
    assert found["counts"]["closed"] == 3  # q never changes the counters
    for old_slug in ("live", "en-curso", "bogus"):
        bad = client.get(f"/api/v1/cases/inbox?status={old_slug}", headers=daniela)
        assert (bad.status_code, bad.json()["code"]) == (422, "validation_error")
    too_long = client.get("/api/v1/cases/inbox", params={"q": "x" * 81}, headers=daniela)
    assert too_long.json()["code"] == "validation_error"


def test_closed_window_in_the_api(
    client: TestClient, sign_in: Callable[[str], str], clock: FixedClock
) -> None:
    clock.advance(timedelta(days=5, hours=23))  # Patricia's refund closed 7 d 23 h ago
    daniela = bearer(sign_in(ANALYST.email))  # sessions last 8 h
    closed = client.get("/api/v1/cases/inbox?status=closed", headers=daniela).json()
    assert [i["id"] for i in closed["items"]] == [HECTOR, CLAUDIA]
    assert closed["counts"]["closed"] == 2


def test_inbox_needs_an_analyst(client: TestClient, sign_in: Callable[[str], str]) -> None:
    assert client.get("/api/v1/cases/inbox").json()["code"] == "unauthenticated"
    supervisor = client.get("/api/v1/cases/inbox", headers=bearer(sign_in(SUPERVISOR.email)))
    assert supervisor.status_code == 403
    assert supervisor.json()["code"] == "forbidden"


# ----------------------------------------------------------------------------- detail
def test_case_detail_for_the_assignee(client: TestClient, daniela: dict[str, str]) -> None:
    response = client.get(f"/api/v1/cases/{PATRICIA_AGAIN}", headers=daniela)
    assert response.status_code == 200
    detail = response.json()
    assert set(detail) == {
        "case",
        "customer",
        "assignment",
        "closure",
        "capabilities",
        "previousCaseCount",
        "escalation",
    }
    assert detail["customer"] == {
        "id": detail["case"]["customer"]["id"],
        "displayName": "Patricia Lozano Vega",
        "locale": "es-MX",
        "language": "es",
        "country": "MX",
        "city": "Guadalajara",
    }
    assignment = detail["assignment"]
    assert (assignment["analystName"], assignment["reason"], assignment["policyRuleId"]) == (
        "Daniela Ríos",
        "language_least_loaded",
        None,
    )
    assert (assignment["queueLabel"], assignment["waitedSeconds"]) == (None, None)
    assert detail["closure"] is None
    assert detail["previousCaseCount"] == 2
    assert detail["capabilities"] == {
        "canReply": True,
        "replyBlockedReason": None,
        "canClose": True,
        "canAssign": False,
        "canChangePriority": True,
        "canEscalate": True,
    }
    portuguese = client.get(f"/api/v1/cases/{LARISSA}", headers=daniela).json()
    assert portuguese["assignment"]["policyRuleId"] == "H1"


def test_closed_case_detail(client: TestClient, daniela: dict[str, str]) -> None:
    detail = client.get(f"/api/v1/cases/{PATRICIA_REFUND}", headers=daniela).json()
    assert detail["closure"] == {
        "closedAt": "2026-09-30T14:00:00Z",
        "closedById": detail["assignment"]["analystId"],
        "closedByName": "Daniela Ríos",
        "reason": "resolved",
        "note": "Se explicó el plazo del reverso (5 días hábiles).",
    }
    assert detail["capabilities"] == {
        "canReply": False,
        "replyBlockedReason": "closed",
        "canClose": False,
        "canAssign": False,
        "canChangePriority": False,
        "canEscalate": False,
    }


def test_case_visibility(
    client: TestClient, daniela: dict[str, str], sign_in: Callable[[str], str]
) -> None:
    paula = client.get(f"/api/v1/cases/{MARCELA}", headers=bearer(sign_in(PAULA.email)))
    assert paula.status_code == 403
    assert paula.json()["code"] == "case_not_assigned"
    assert paula.json()["detail"] == "No tienes acceso a este caso."
    supervisor = client.get(f"/api/v1/cases/{MARCELA}", headers=bearer(sign_in(SUPERVISOR.email)))
    assert supervisor.status_code == 200
    assert supervisor.json()["capabilities"]["replyBlockedReason"] == "not_assignee"
    queued = client.get(f"/api/v1/cases/{GABRIELA}", headers=bearer(sign_in(SUPERVISOR.email)))
    assert (queued.json()["case"]["status"], queued.json()["case"]["inboxStatus"]) == (
        "queued",
        None,
    )
    admin = client.get(f"/api/v1/cases/{MARCELA}", headers=bearer(sign_in(ADMIN_EMAIL)))
    assert admin.json()["code"] == "forbidden"
    for unknown in (seed_case_id(999), "CASE-1", "inbox2"):
        missing = client.get(f"/api/v1/cases/{unknown}", headers=daniela)
        assert (missing.status_code, missing.json()["code"]) == (404, "not_found")


# ----------------------------------------------------------------------------- history
def test_history_lists_the_customers_other_cases(
    client: TestClient, daniela: dict[str, str]
) -> None:
    response = client.get(f"/api/v1/cases/{PATRICIA_AGAIN}/history", headers=daniela)
    assert response.status_code == 200
    body = response.json()
    assert body["total"] == 2
    assert [i["id"] for i in body["items"]] == [PATRICIA_REFUND, PATRICIA_OLD]
    old = body["items"][1]
    assert old == {
        "id": PATRICIA_OLD,
        "status": "closed",
        "channel": "web_chat",
        "openedAt": "2026-09-12T14:00:00Z",
        "closedAt": "2026-09-12T14:15:00Z",
        "closeReason": "resolved",
        "analystId": old["analystId"],
        "analystName": "Julián Ortega",
        "preview": "Ah, es cierto. Gracias.",
        "rating": {"score": 3, "comment": None, "ratedAt": "2026-09-12T14:16:00Z"},
    }
    # Slice 7: "Calificó: Excelente" with the customer's words, for the case Daniela closed.
    assert body["items"][0]["rating"] == {
        "score": 4,
        "comment": "Muy clara la explicación del plazo, gracias.",
        "ratedAt": "2026-09-30T14:02:00Z",
    }
    alone = client.get(f"/api/v1/cases/{BEATRIZ}/history", headers=daniela).json()
    assert alone == {"items": [], "total": 0}


def test_history_access_is_read_only(
    client: TestClient, daniela: dict[str, str], sign_in: Callable[[str], str]
) -> None:
    julians = client.get(f"/api/v1/cases/{PATRICIA_OLD}", headers=daniela)
    assert julians.status_code == 200
    assert julians.json()["capabilities"] == {
        "canReply": False,
        "replyBlockedReason": "not_assignee",
        "canClose": False,
        "canAssign": False,
        "canChangePriority": False,
        "canEscalate": False,
    }
    turns = client.get(f"/api/v1/cases/{PATRICIA_OLD}/turns", headers=daniela).json()
    assert [t["authorName"] for t in turns["items"] if t["authorRole"] == "analyst"] == [
        "Julián Ortega"
    ]
    history = client.get(f"/api/v1/cases/{PATRICIA_OLD}/history", headers=daniela).json()
    assert [i["id"] for i in history["items"]] == [PATRICIA_AGAIN, PATRICIA_REFUND]
    write = reply(client, daniela, PATRICIA_OLD, "Hola")
    assert (write.status_code, write.json()["code"]) == (403, "case_not_assigned")
    read = client.post(
        f"/api/v1/cases/{PATRICIA_OLD}/read", headers=daniela, json={"upToSequence": 1}
    )
    assert read.json()["code"] == "case_not_assigned"
    closing = close(client, daniela, PATRICIA_OLD, CLOSE_BODY)
    assert closing.json()["code"] == "case_not_assigned"
    paula = bearer(sign_in(PAULA.email))
    for path in (f"/api/v1/cases/{PATRICIA_OLD}", f"/api/v1/cases/{PATRICIA_AGAIN}/history"):
        refused = client.get(path, headers=paula)
        assert (refused.status_code, refused.json()["code"]) == (403, "case_not_assigned")
    missing = client.get(f"/api/v1/cases/{seed_case_id(999)}/history", headers=daniela)
    assert missing.status_code == 404


# ----------------------------------------------------------------------------- turns
def test_turn_pages(client: TestClient, daniela: dict[str, str]) -> None:
    latest = client.get(f"/api/v1/cases/{BEATRIZ}/turns?limit=2", headers=daniela).json()
    assert [t["sequence"] for t in latest["items"]] == [5, 6]
    assert latest["olderCursor"] == "5"
    assert latest["lastSequence"] == 6
    assert set(latest["items"][0]) == {
        "id", "caseId", "sequence", "kind", "audience", "authorRole", "authorId",
        "authorName", "text", "language", "createdAt", "clientMessageId",
    }  # fmt: skip
    older = client.get(
        f"/api/v1/cases/{BEATRIZ}/turns", params={"cursor": latest["olderCursor"]}, headers=daniela
    ).json()
    assert [t["sequence"] for t in older["items"]] == [1, 2, 3, 4]
    assert (older["items"][2]["kind"], older["items"][2]["audience"]) == ("routing", "staff")
    after = client.get(f"/api/v1/cases/{BEATRIZ}/turns?afterSequence=5", headers=daniela).json()
    assert [t["sequence"] for t in after["items"]] == [6]
    both = client.get(f"/api/v1/cases/{BEATRIZ}/turns?cursor=5&afterSequence=1", headers=daniela)
    assert (both.status_code, both.json()["code"]) == (422, "validation_error")
    bad = client.get(f"/api/v1/cases/{BEATRIZ}/turns?cursor=abc", headers=daniela)
    assert bad.status_code == 422


@pytest.mark.parametrize(
    "params",
    [
        {"cursor": "²"},  # str.isdigit() accepts it, int() does not
        {"cursor": "٣"},  # an Arabic-Indic digit: int() would read it as 3
        {"cursor": "0"},
        {"cursor": "9223372036854775808"},  # 2**63: no SQLite INTEGER holds it
        {"cursor": "9" * 23},
        {"afterSequence": "9223372036854775808"},
        {"afterSequence": "99999999999999999999999"},
        {"afterSequence": "-1"},
    ],
)
def test_tampered_turn_cursors_are_422(
    client: TestClient, daniela: dict[str, str], params: dict[str, str]
) -> None:
    response = client.get(f"/api/v1/cases/{BEATRIZ}/turns", params=params, headers=daniela)
    assert response.status_code == 422, response.text
    assert response.json()["code"] in {"validation_error", "invalid_value"}


def test_the_largest_sequence_is_still_a_valid_cursor(
    client: TestClient, daniela: dict[str, str]
) -> None:
    edge = str(2**63 - 1)
    for params in ({"cursor": edge}, {"afterSequence": edge}):
        response = client.get(f"/api/v1/cases/{BEATRIZ}/turns", params=params, headers=daniela)
        assert response.status_code == 200, response.text


# ----------------------------------------------------------------------------- replies
def test_reply_idempotent_retry_and_first_response(
    client: TestClient, daniela: dict[str, str]
) -> None:
    cmid = str(uuid.uuid4())
    created = reply(client, daniela, LARISSA, "Olá, Larissa! Sou a Daniela.", cmid)
    assert created.status_code == 201
    body = created.json()
    assert body["turn"]["sequence"] == 4
    assert body["turn"]["clientMessageId"] == cmid
    assert (body["case"]["status"], body["case"]["inboxStatus"]) == ("in_progress", "waiting")
    assert body["case"]["firstResponseAt"] == "2026-10-02T14:00:00Z"

    replay = reply(client, daniela, LARISSA, "Olá, Larissa! Sou a Daniela.", cmid)
    assert replay.status_code == 200
    assert replay.headers["Idempotent-Replayed"] == "true"
    assert replay.json()["turn"]["id"] == body["turn"]["id"]
    conflict = reply(client, daniela, LARISSA, "Otro texto", cmid)
    assert (conflict.status_code, conflict.json()["code"]) == (409, "idempotency_conflict")


def test_reply_validation(client: TestClient, daniela: dict[str, str]) -> None:
    mismatch = reply(client, daniela, BEATRIZ, "Hola", key="another-key-123")
    assert (mismatch.status_code, mismatch.json()["code"]) == (422, "validation_error")
    no_header = client.post(
        f"/api/v1/cases/{BEATRIZ}/turns",
        headers=daniela,
        json={"text": "Hola", "clientMessageId": str(uuid.uuid4())},
    )
    assert no_header.status_code == 422
    assert reply(client, daniela, BEATRIZ, "   ").status_code == 422
    cmid = str(uuid.uuid4())
    with_evidence = client.post(
        f"/api/v1/cases/{BEATRIZ}/turns",
        headers={**daniela, "Idempotency-Key": cmid},
        json={"text": "Hola", "clientMessageId": cmid, "evidenceIds": ["X-1"]},
    )
    assert with_evidence.status_code == 422  # unknown members are rejected


def test_reply_rules(
    client: TestClient, daniela: dict[str, str], sign_in: Callable[[str], str]
) -> None:
    julian = reply(client, bearer(sign_in(JULIAN.email)), BEATRIZ, "Hola")
    assert (julian.status_code, julian.json()["code"]) == (403, "case_not_assigned")
    lead = reply(client, bearer(sign_in(TEAM_LEAD.email)), BEATRIZ, "Hola")
    assert (lead.status_code, lead.json()["code"]) == (403, "case_not_assigned")
    supervisor = reply(client, bearer(sign_in(SUPERVISOR.email)), BEATRIZ, "Hola")
    assert (supervisor.status_code, supervisor.json()["code"]) == (403, "forbidden")
    closed = reply(client, daniela, CLAUDIA, "¿Sigue ahí?")
    assert (closed.status_code, closed.json()["code"]) == (409, "case_closed")
    queued = reply(client, daniela, GABRIELA, "Olá")
    assert (queued.status_code, queued.json()["code"]) == (403, "case_not_assigned")


# ----------------------------------------------------------------------------- read
def test_mark_read_opens_a_new_case(client: TestClient, daniela: dict[str, str]) -> None:
    response = client.post(
        f"/api/v1/cases/{LARISSA}/read", headers=daniela, json={"upToSequence": 3}
    )
    assert response.status_code == 200
    summary = response.json()
    assert (summary["status"], summary["inboxStatus"], summary["unreadCount"]) == (
        "in_progress",
        "to_reply",
        0,
    )
    invalid = client.post(f"/api/v1/cases/{LARISSA}/read", headers=daniela, json={})
    assert invalid.status_code == 422


# ----------------------------------------------------------------------------- close
@pytest.mark.parametrize(
    "reason", ["resolved", "customer_unresponsive", "duplicate", "out_of_scope", "other"]
)
def test_close_with_every_reason(client: TestClient, daniela: dict[str, str], reason: str) -> None:
    response = close(client, daniela, MARCELA, {"reason": reason, "note": None})
    assert response.status_code == 200
    detail = response.json()
    assert (detail["case"]["status"], detail["case"]["inboxStatus"]) == ("closed", "closed")
    assert (detail["case"]["closeReason"], detail["closure"]["reason"]) == (reason, reason)
    assert detail["capabilities"] == {
        "canReply": False,
        "replyBlockedReason": "closed",
        "canClose": False,
        "canAssign": False,
        "canChangePriority": False,
        "canEscalate": False,
    }


def test_close_note_rules(client: TestClient, daniela: dict[str, str]) -> None:
    trimmed = close(client, daniela, MARCELA, {"reason": "other", "note": "  Llamó por error.  "})
    assert trimmed.json()["closure"]["note"] == "Llamó por error."
    blank = close(client, daniela, JOAQUIN, {"reason": "other", "note": "   "})
    assert blank.json()["closure"]["note"] is None
    exactly = close(client, daniela, LARISSA, {"reason": "other", "note": " " + "x" * 500 + " "})
    assert exactly.status_code == 200
    for body in (
        {"reason": "resolved", "note": "x" * 501},
        {"reason": "solved", "note": None},
        {"reason": "resolved"},  # note must be present (null when empty)
        {"note": None},
        {**CLOSE_BODY, "resolved": True},  # the old body: unknown member
    ):
        bad = close(client, daniela, BEATRIZ, body)
        assert (bad.status_code, bad.json()["code"]) == (422, "validation_error"), body


def test_close_then_nothing_more(client: TestClient, daniela: dict[str, str]) -> None:
    assert close(client, daniela, BEATRIZ, CLOSE_BODY).status_code == 200
    again = close(client, daniela, BEATRIZ, CLOSE_BODY)
    assert again.status_code == 409
    assert (again.json()["code"], again.json()["currentStatus"]) == ("case_closed", "closed")
    late = reply(client, daniela, BEATRIZ, "¿Sigue ahí?")
    assert (late.status_code, late.json()["code"]) == (409, "case_closed")
    inbox = client.get("/api/v1/cases/inbox", headers=daniela).json()
    assert (inbox["counts"]["all"], inbox["counts"]["toReply"], inbox["counts"]["closed"]) == (
        4,
        1,
        4,
    )
    closed = client.get("/api/v1/cases/inbox?status=closed", headers=daniela).json()
    assert closed["items"][0]["id"] == BEATRIZ  # the most recent close first
    seeded = close(client, daniela, HECTOR, CLOSE_BODY)
    assert (seeded.status_code, seeded.json()["code"]) == (409, "case_closed")


def test_close_needs_the_assignee(
    client: TestClient, daniela: dict[str, str], sign_in: Callable[[str], str]
) -> None:
    julian = close(client, bearer(sign_in(JULIAN.email)), BEATRIZ, CLOSE_BODY)
    assert (julian.status_code, julian.json()["code"]) == (403, "case_not_assigned")
    supervisor = close(client, bearer(sign_in(SUPERVISOR.email)), BEATRIZ, CLOSE_BODY)
    assert (supervisor.status_code, supervisor.json()["code"]) == (403, "forbidden")
    queued = close(client, daniela, GABRIELA, CLOSE_BODY)  # nobody holds a queued case
    assert (queued.status_code, queued.json()["code"]) == (403, "case_not_assigned")
    missing = close(client, daniela, seed_case_id(999), CLOSE_BODY)
    assert missing.status_code == 404


# ----------------------------------------------------------------------------- availability
def test_availability(
    client: TestClient, daniela: dict[str, str], sign_in: Callable[[str], str]
) -> None:
    mine = client.get("/api/v1/me/availability", headers=daniela)
    assert mine.json()["status"] == "paused"  # nobody starts available (seed)
    back = client.put("/api/v1/me/availability", headers=daniela, json={"status": "available"})
    assert back.status_code == 200
    assert back.json()["status"] == "available"
    paused = client.put("/api/v1/me/availability", headers=daniela, json={"status": "paused"})
    assert paused.status_code == 200
    assert paused.json()["status"] == "paused"
    assert client.get("/api/v1/me/availability", headers=daniela).json()["status"] == "paused"
    bad = client.put("/api/v1/me/availability", headers=daniela, json={"status": "x"})
    assert bad.status_code == 422
    supervisor = client.get("/api/v1/me/availability", headers=bearer(sign_in(SUPERVISOR.email)))
    assert supervisor.json()["code"] == "forbidden"
