"""Analyst REST API: inbox, detail, turns, replies, read, close, availability."""

from __future__ import annotations

import uuid
from collections.abc import Callable
from typing import Any

import pytest
from fastapi.testclient import TestClient

from cc_platform.infrastructure.seed.cases import seed_case_id
from tests.support import ANALYST, JULIAN, SUPERVISOR, TEAM_LEAD, bearer

WEB_DISPUTE, IMPATIENT, PORTUGUESE, EMAIL, CALL, CONDUSEF, WAITING = (
    seed_case_id(n) for n in range(101, 108)
)
ADMIN_EMAIL = "carolina.pena@latambank.example"


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


CLOSE_BODY = {
    "resolved": True,
    "contactReason": "Transaccional",
    "resolutionCode": "explained",
    "followUp": "none",
    "sendCsatSurvey": False,
}


# ----------------------------------------------------------------------------- inbox
def test_inbox_lists_the_seeded_cases_with_counts(
    client: TestClient, daniela: dict[str, str]
) -> None:
    response = client.get("/api/v1/cases/inbox", headers=daniela)
    assert response.status_code == 200
    body = response.json()
    assert body["counts"] == {
        "all": 7,
        "new": 1,
        "toReply": 3,
        "live": 1,
        "toCall": 1,
        "waiting": 1,
        "computedAt": "2026-10-02T14:00:00Z",
    }
    first = body["items"][0]
    assert first["inboxStatus"] == "live"
    assert first["liveSince"].endswith("Z")
    assert set(first) >= {"version", "customer", "slaDueAt", "lastInteractionAt", "unreadCount"}
    assert body["serverTime"] == "2026-10-02T14:00:00Z"


def test_inbox_filters_and_search(client: TestClient, daniela: dict[str, str]) -> None:
    waiting = client.get("/api/v1/cases/inbox?status=waiting", headers=daniela).json()
    assert [i["id"] for i in waiting["items"]] == [WAITING]
    assert waiting["counts"]["all"] == 7
    found = client.get("/api/v1/cases/inbox", params={"q": "BEATRIZ"}, headers=daniela).json()
    assert [i["customer"]["displayName"] for i in found["items"]] == ["Beatriz Salcedo Prieto"]
    assert client.get("/api/v1/cases/inbox?status=bogus", headers=daniela).status_code == 422
    too_long = client.get("/api/v1/cases/inbox", params={"q": "x" * 81}, headers=daniela)
    assert too_long.json()["code"] == "validation_error"


def test_inbox_needs_an_analyst(client: TestClient, sign_in: Callable[[str], str]) -> None:
    assert client.get("/api/v1/cases/inbox").json()["code"] == "unauthenticated"
    supervisor = client.get("/api/v1/cases/inbox", headers=bearer(sign_in(SUPERVISOR.email)))
    assert supervisor.status_code == 403
    assert supervisor.json()["code"] == "forbidden"


# ----------------------------------------------------------------------------- detail and turns
def test_case_detail_for_the_assignee(client: TestClient, daniela: dict[str, str]) -> None:
    response = client.get(f"/api/v1/cases/{WEB_DISPUTE}", headers=daniela)
    assert response.status_code == 200
    detail = response.json()
    assert detail["case"]["id"] == WEB_DISPUTE
    assert detail["customer"]["displayName"] == "Marcela Quintana Pardo"
    assert detail["customer"]["customerSince"] == "2019-03-14"
    assert detail["channelIdentity"] == {"kind": "web_session", "verified": True}
    assert detail["assignment"]["analystName"] == "Daniela Ríos"
    assert [s["kind"] for s in detail["routing"]["stops"]] == ["tier", "tier", "tier", "assignee"]
    assert detail["routing"]["inputsUsed"] == ["customers", "transactions", "interactions"]
    assert detail["closure"] is None
    assert detail["capabilities"] == {
        "canReply": True,
        "replyBlockedReason": None,
        "canClose": True,
    }


def test_case_visibility(
    client: TestClient, daniela: dict[str, str], sign_in: Callable[[str], str]
) -> None:
    other = client.get(f"/api/v1/cases/{WEB_DISPUTE}", headers=bearer(sign_in(JULIAN.email)))
    assert other.status_code == 403
    assert other.json()["code"] == "case_not_assigned"
    assert other.json()["detail"] == "Este caso no está asignado a ti."
    supervisor = client.get(
        f"/api/v1/cases/{WEB_DISPUTE}", headers=bearer(sign_in(SUPERVISOR.email))
    )
    assert supervisor.status_code == 200
    assert supervisor.json()["capabilities"]["replyBlockedReason"] == "not_assignee"
    admin = client.get(f"/api/v1/cases/{WEB_DISPUTE}", headers=bearer(sign_in(ADMIN_EMAIL)))
    assert admin.json()["code"] == "forbidden"
    for unknown in (seed_case_id(999), "CASE-1", "inbox2"):
        missing = client.get(f"/api/v1/cases/{unknown}", headers=daniela)
        assert (missing.status_code, missing.json()["code"]) == (404, "not_found")


def test_turn_pages(client: TestClient, daniela: dict[str, str]) -> None:
    latest = client.get(f"/api/v1/cases/{EMAIL}/turns?limit=2", headers=daniela).json()
    assert [t["sequence"] for t in latest["items"]] == [5, 6]
    assert latest["olderCursor"] == "5"
    assert latest["lastSequence"] == 6
    older = client.get(
        f"/api/v1/cases/{EMAIL}/turns", params={"cursor": latest["olderCursor"]}, headers=daniela
    ).json()
    assert [t["sequence"] for t in older["items"]] == [1, 2, 3, 4]
    assert older["items"][1]["kind"] == "routing"
    assert older["items"][1]["audience"] == "staff"
    after = client.get(f"/api/v1/cases/{EMAIL}/turns?afterSequence=5", headers=daniela).json()
    assert [t["sequence"] for t in after["items"]] == [6]
    both = client.get(f"/api/v1/cases/{EMAIL}/turns?cursor=5&afterSequence=1", headers=daniela)
    assert (both.status_code, both.json()["code"]) == (422, "validation_error")
    bad = client.get(f"/api/v1/cases/{EMAIL}/turns?cursor=abc", headers=daniela)
    assert bad.status_code == 422


# ----------------------------------------------------------------------------- replies
def test_reply_and_idempotent_retry(client: TestClient, daniela: dict[str, str]) -> None:
    cmid = str(uuid.uuid4())
    created = reply(client, daniela, PORTUGUESE, "Olá, Larissa! Sou a Daniela.", cmid)
    assert created.status_code == 201
    body = created.json()
    assert body["turn"]["sequence"] == 4
    assert body["turn"]["clientMessageId"] == cmid
    assert body["turn"]["evidenceIds"] == []
    assert body["case"]["status"] == "in_progress"
    assert body["case"]["inboxStatus"] == "waiting"

    replay = reply(client, daniela, PORTUGUESE, "Olá, Larissa! Sou a Daniela.", cmid)
    assert replay.status_code == 200
    assert replay.headers["Idempotent-Replayed"] == "true"
    assert replay.json()["turn"]["id"] == body["turn"]["id"]
    conflict = reply(client, daniela, PORTUGUESE, "Otro texto", cmid)
    assert (conflict.status_code, conflict.json()["code"]) == (409, "idempotency_conflict")


def test_reply_validation(client: TestClient, daniela: dict[str, str]) -> None:
    mismatch = reply(client, daniela, IMPATIENT, "Hola", key="another-key-123")
    assert (mismatch.status_code, mismatch.json()["code"]) == (422, "validation_error")
    no_header = client.post(
        f"/api/v1/cases/{IMPATIENT}/turns",
        headers=daniela,
        json={"text": "Hola", "clientMessageId": str(uuid.uuid4())},
    )
    assert no_header.status_code == 422
    blank = reply(client, daniela, IMPATIENT, "   ")
    assert blank.status_code == 422
    cmid = str(uuid.uuid4())
    with_evidence = client.post(
        f"/api/v1/cases/{IMPATIENT}/turns",
        headers={**daniela, "Idempotency-Key": cmid},
        json={"text": "Hola", "clientMessageId": cmid, "evidenceIds": ["CALL-1"]},
    )
    assert with_evidence.status_code == 422  # slice 3 adds evidence with rule 9 checks


def test_reply_rules(
    client: TestClient, daniela: dict[str, str], sign_in: Callable[[str], str]
) -> None:
    email = reply(client, daniela, EMAIL, "Hola, Patricia")
    assert (email.status_code, email.json()["code"]) == (409, "channel_not_supported")
    julian = reply(client, bearer(sign_in(JULIAN.email)), IMPATIENT, "Hola")
    assert (julian.status_code, julian.json()["code"]) == (403, "case_not_assigned")
    lead = reply(client, bearer(sign_in(TEAM_LEAD.email)), IMPATIENT, "Hola")
    assert (lead.status_code, lead.json()["code"]) == (403, "case_not_assigned")
    supervisor = reply(client, bearer(sign_in(SUPERVISOR.email)), IMPATIENT, "Hola")
    assert (supervisor.status_code, supervisor.json()["code"]) == (403, "forbidden")


# ----------------------------------------------------------------------------- read and close
def test_mark_read_opens_a_new_case(client: TestClient, daniela: dict[str, str]) -> None:
    response = client.post(
        f"/api/v1/cases/{PORTUGUESE}/read", headers=daniela, json={"upToSequence": 3}
    )
    assert response.status_code == 200
    summary = response.json()
    assert (summary["status"], summary["inboxStatus"], summary["unreadCount"]) == (
        "in_progress",
        "to_reply",
        0,
    )
    invalid = client.post(f"/api/v1/cases/{PORTUGUESE}/read", headers=daniela, json={})
    assert invalid.status_code == 422


def test_close_then_nothing_more(client: TestClient, daniela: dict[str, str]) -> None:
    closed = client.post(f"/api/v1/cases/{IMPATIENT}/close", headers=daniela, json=CLOSE_BODY)
    assert closed.status_code == 200
    detail = closed.json()
    assert detail["case"]["status"] == "closed"
    assert detail["closure"]["contactReason"] == "Transaccional"
    assert detail["closure"]["followupAt"] is None
    assert detail["capabilities"] == {
        "canReply": False,
        "replyBlockedReason": "closed",
        "canClose": False,
    }
    again = client.post(f"/api/v1/cases/{IMPATIENT}/close", headers=daniela, json=CLOSE_BODY)
    assert again.status_code == 409
    assert again.json()["code"] == "case_closed"
    assert again.json()["currentStatus"] == "closed"
    late = reply(client, daniela, IMPATIENT, "¿Sigue ahí?")
    assert (late.status_code, late.json()["code"]) == (409, "case_closed")
    inbox = client.get("/api/v1/cases/inbox", headers=daniela).json()
    assert inbox["counts"]["all"] == 6
    bad = client.post(
        f"/api/v1/cases/{WAITING}/close", headers=daniela, json={**CLOSE_BODY, "followUp": "x"}
    )
    assert bad.status_code == 422


# ----------------------------------------------------------------------------- availability
def test_availability(
    client: TestClient, daniela: dict[str, str], sign_in: Callable[[str], str]
) -> None:
    mine = client.get("/api/v1/me/availability", headers=daniela)
    assert mine.json()["status"] == "available"
    paused = client.put("/api/v1/me/availability", headers=daniela, json={"status": "paused"})
    assert paused.status_code == 200
    assert paused.json()["status"] == "paused"
    assert client.get("/api/v1/me/availability", headers=daniela).json()["status"] == "paused"
    assert (
        client.put("/api/v1/me/availability", headers=daniela, json={"status": "x"}).status_code
        == 422
    )
    supervisor = client.get("/api/v1/me/availability", headers=bearer(sign_in(SUPERVISOR.email)))
    assert supervisor.json()["code"] == "forbidden"
