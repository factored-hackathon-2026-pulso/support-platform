"""Slice 12 over the API: simulated calls (inbound and outbound), email threads and internal
notes; RBAC, invalid transitions, idempotency, first response, the audit and the realtime
fan-out (``call.updated``, transcript and email turns)."""

from __future__ import annotations

import uuid
from collections.abc import Callable
from typing import Any

from fastapi.testclient import TestClient

from cc_platform.api.schemas.channels import (
    CallList,
    CallResponse,
    CustomerCallResponse,
    EmailReplyResponse,
    EmailThread,
    SendEmailResponse,
)
from cc_platform.infrastructure.seed.cases import seed_case_id
from cc_platform.infrastructure.seed.customers import seed_customer_id
from cc_platform.infrastructure.seed.people import seed_staff_id
from tests.api.test_cases_realtime import assert_contract_payloads, connect, subscribe, until_pong
from tests.api.test_escalations_api import problem
from tests.support import ANALYST, JULIAN, SUPERVISOR, bearer

SignIn = Callable[[str], str]
Session = Callable[..., str]
Available = Callable[..., None]

DANIELA_ID = seed_staff_id(ANALYST.number)
PATRICIA_NEW, LARISSA, REFUND_CLOSED, IGNACIO = (seed_case_id(n) for n in (108, 103, 104, 117))
PATRICIA, LARISSA_CUSTOMER, NATALIA_SIM, LUCAS_SIM = 1004, 1003, 2001, 2003


def key() -> str:
    return str(uuid.uuid4())


def staff_call(client: TestClient, token: str, case_id: str, reason: object = "Seguimiento") -> Any:
    return client.post(
        f"/api/v1/cases/{case_id}/calls",
        headers={**bearer(token), "Idempotency-Key": key()},
        json={"reason": reason},
    )


def act(client: TestClient, token: str, case_id: str, call_id: str, action: str) -> Any:
    return client.post(f"/api/v1/cases/{case_id}/calls/{call_id}/{action}", headers=bearer(token))


def line(client: TestClient, token: str, path: str, text: str) -> Any:
    cmid = key()
    return client.post(
        path,
        headers={**bearer(token), "Idempotency-Key": cmid},
        json={"text": text, "clientMessageId": cmid},
    )


def call_in(client: TestClient, token: str, idem: str | None = None) -> Any:
    return client.post(
        "/api/v1/customer/calls", headers={**bearer(token), "Idempotency-Key": idem or key()}
    )


def valid(schema: Any, body: dict[str, Any]) -> dict[str, Any]:
    assert schema.model_validate(body).model_dump(mode="json", by_alias=True) == body
    return body


def talk_hold_and_hang_up(
    client: TestClient, daniela: str, natalia: str, case_id: str, call_id: str
) -> None:
    """Both sides speak, the analyst holds (no lines then), mutes, resumes and hangs up."""
    path = f"/api/v1/cases/{case_id}/calls/{call_id}/transcript"
    said = line(
        client, natalia, f"/api/v1/customer/calls/{call_id}/transcript", "Hola, llamo por un cobro."
    )
    assert said.status_code == 201, said.text
    assert said.json()["turn"]["kind"] == "transcript"
    assert line(client, daniela, path, "Buenas tardes, ¿me da la fecha?").status_code == 201
    held = act(client, daniela, case_id, call_id, "hold")
    assert held.json()["call"]["state"] == "on_hold"
    problem(line(client, daniela, path, "Sigo aquí"), 409, "invalid_transition")  # on hold
    muted = client.post(
        f"/api/v1/cases/{case_id}/calls/{call_id}/mute",
        headers=bearer(daniela),
        json={"muted": True},
    )
    assert muted.json()["call"]["muted"] is True
    resumed = act(client, daniela, case_id, call_id, "resume")
    assert resumed.json()["call"]["state"] == "in_call"
    assert len(resumed.json()["call"]["holds"]) == 1
    ended = act(client, daniela, case_id, call_id, "hangup")
    call = ended.json()["call"]
    assert (call["state"], call["endReason"], call["endedByRole"]) == (
        "ended",
        "completed",
        "analyst",
    )
    assert ended.json()["case"]["activeCallId"] is None
    problem(act(client, daniela, case_id, call_id, "hangup"), 409, "call_not_active")


# ----------------------------------------------------------------------------- inbound call
def test_an_inbound_call_opens_a_case_rings_and_is_answered(
    client: TestClient, sign_in: SignIn, customer_session: Session, available: Available
) -> None:
    available(DANIELA_ID)
    natalia = customer_session(NATALIA_SIM)
    idem = key()
    started = call_in(client, natalia, idem)
    assert started.status_code == 201, started.text
    body = valid(CustomerCallResponse, started.json())
    assert (body["caseCreated"], body["conversation"]["status"]) == (True, "with_agent")
    assert body["conversation"]["channel"] == "phone_inbound"
    assert (body["call"]["state"], body["call"]["direction"]) == ("ringing", "inbound")
    call_id, case_id = body["call"]["id"], body["conversation"]["caseId"]
    replay = call_in(client, natalia, idem)
    assert (replay.status_code, replay.headers["Idempotent-Replayed"]) == (200, "true")
    assert replay.json()["call"]["id"] == call_id
    problem(call_in(client, natalia), 409, "call_in_progress")  # one call at a time

    daniela = sign_in(ANALYST.email)
    detail = client.get(f"/api/v1/cases/{case_id}", headers=bearer(daniela)).json()
    assert detail["case"]["activeCallId"] == call_id
    assert (detail["activeCall"]["state"], detail["capabilities"]["canCall"]) == ("ringing", False)
    assert detail["case"]["firstResponseAt"] is None
    path = f"/api/v1/cases/{case_id}/calls/{call_id}/transcript"
    problem(line(client, daniela, path, "¿Aló?"), 409, "invalid_transition")  # still ringing

    answered = act(client, daniela, case_id, call_id, "answer")
    assert answered.status_code == 200, answered.text
    result = valid(CallResponse, answered.json())
    assert (result["call"]["state"], result["call"]["analystName"]) == ("in_call", "Daniela Ríos")
    assert result["case"]["status"] == "in_progress"
    assert result["case"]["firstResponseAt"] == result["call"]["answeredAt"]  # the first response
    problem(act(client, daniela, case_id, call_id, "answer"), 409, "invalid_transition")

    talk_hold_and_hang_up(client, daniela, natalia, case_id, call_id)
    listed = valid(
        CallList, client.get(f"/api/v1/cases/{case_id}/calls", headers=bearer(daniela)).json()
    )
    assert [c["id"] for c in listed["items"]] == [call_id]
    turns = client.get(f"/api/v1/cases/{case_id}/turns", headers=bearer(daniela)).json()["items"]
    transcript = [(t["authorRole"], t["text"]) for t in turns if t["kind"] == "transcript"]
    assert transcript == [
        ("customer", "Hola, llamo por un cobro."),
        ("analyst", "Buenas tardes, ¿me da la fecha?"),
        ("system", "Llamada en espera."),
        ("system", "La llamada continúa."),
        ("system", "La llamada terminó."),
    ]
    mine = client.get("/api/v1/customer/call", headers=bearer(natalia)).json()["call"]
    assert (mine["state"], mine["agentName"], mine["endReason"]) == (
        "ended",
        "Daniela",
        "completed",
    )


def test_call_rbac_and_unknown_ids(
    client: TestClient, sign_in: SignIn, customer_session: Session, available: Available
) -> None:
    available(DANIELA_ID)
    natalia = customer_session(NATALIA_SIM)
    body = call_in(client, natalia).json()
    call_id, case_id = body["call"]["id"], body["conversation"]["caseId"]
    julian, lucia = sign_in(JULIAN.email), sign_in(SUPERVISOR.email)
    problem(act(client, julian, case_id, call_id, "answer"), 403, "case_not_assigned")
    problem(act(client, lucia, case_id, call_id, "answer"), 403, "forbidden")  # not an analyst
    problem(act(client, natalia, case_id, call_id, "answer"), 401, "unauthenticated")
    # A supervisor reads the calls of any case; the customer's token is not staff.
    assert client.get(f"/api/v1/cases/{case_id}/calls", headers=bearer(lucia)).status_code == 200
    daniela = sign_in(ANALYST.email)
    problem(act(client, daniela, case_id, "CALL-nope", "answer"), 404, "not_found")
    problem(act(client, daniela, PATRICIA_NEW, call_id, "answer"), 404, "not_found")  # other case
    lucas = customer_session(LUCAS_SIM)
    problem(
        client.post(f"/api/v1/customer/calls/{call_id}/hangup", headers=bearer(lucas)),
        404,
        "not_found",
    )
    # The customer hangs up while it rings: cancelled, never answered.
    gone = client.post(f"/api/v1/customer/calls/{call_id}/hangup", headers=bearer(natalia))
    assert (gone.json()["call"]["state"], gone.json()["call"]["endReason"]) == (
        "ended",
        "cancelled",
    )


# ----------------------------------------------------------------------------- outbound call
def test_an_outbound_call_is_answered_by_the_customer_and_blocks_the_close(
    client: TestClient, sign_in: SignIn, customer_session: Session
) -> None:
    daniela = sign_in(ANALYST.email)
    problem(staff_call(client, daniela, PATRICIA_NEW, "   "), 422, "validation_error")
    started = staff_call(client, daniela, PATRICIA_NEW, "  Confirmar el reembolso  ")
    assert started.status_code == 201, started.text
    body = valid(CallResponse, started.json())
    call = body["call"]
    assert (call["direction"], call["state"], call["reason"]) == (
        "outbound",
        "ringing",
        "Confirmar el reembolso",
    )
    assert body["case"]["status"] == "in_progress"  # she is working the case
    problem(staff_call(client, daniela, PATRICIA_NEW), 409, "call_in_progress")
    closing = client.post(
        f"/api/v1/cases/{PATRICIA_NEW}/close",
        headers=bearer(daniela),
        json={"reason": "resolved", "note": None},
    )
    assert problem(closing, 409, "call_in_progress")["callId"] == call["id"]
    problem(act(client, daniela, PATRICIA_NEW, call["id"], "answer"), 409, "invalid_transition")

    patricia = customer_session(PATRICIA)
    mine = client.get("/api/v1/customer/call", headers=bearer(patricia)).json()["call"]
    assert (mine["id"], mine["state"], mine["agentName"]) == (call["id"], "ringing", "Daniela")
    assert "reason" not in mine  # the customer never sees why
    answered = client.post(f"/api/v1/customer/calls/{call['id']}/answer", headers=bearer(patricia))
    assert answered.status_code == 200, answered.text
    assert answered.json()["call"]["state"] == "in_call"
    detail = client.get(f"/api/v1/cases/{PATRICIA_NEW}", headers=bearer(daniela)).json()
    assert detail["case"]["firstResponseAt"] == detail["activeCall"]["answeredAt"]
    assert act(client, daniela, PATRICIA_NEW, call["id"], "hangup").status_code == 200
    assert closing.status_code == 409
    closed = client.post(
        f"/api/v1/cases/{PATRICIA_NEW}/close",
        headers=bearer(daniela),
        json={"reason": "resolved", "note": None},
    )
    assert closed.status_code == 200, closed.text
    problem(staff_call(client, daniela, PATRICIA_NEW), 409, "case_closed")


def test_the_customer_rejects_an_outbound_call(
    client: TestClient, sign_in: SignIn, customer_session: Session
) -> None:
    daniela = sign_in(ANALYST.email)
    call = staff_call(client, daniela, LARISSA, "Retorno sobre a compra").json()["call"]
    larissa = customer_session(LARISSA_CUSTOMER)
    rejected = client.post(f"/api/v1/customer/calls/{call['id']}/reject", headers=bearer(larissa))
    assert rejected.status_code == 200, rejected.text
    assert rejected.json()["call"]["endReason"] == "rejected"
    turns = client.get(f"/api/v1/cases/{LARISSA}/turns", headers=bearer(daniela)).json()["items"]
    assert turns[-1]["text"] == "A chamada terminou sem resposta."  # the case language
    detail = client.get(f"/api/v1/cases/{LARISSA}", headers=bearer(daniela)).json()
    assert detail["case"]["firstResponseAt"] is None  # nobody talked
    assert detail["capabilities"]["canCall"] is True


def test_the_audit_hides_the_reason_of_a_call(client: TestClient, sign_in: SignIn) -> None:
    daniela, lucia = sign_in(ANALYST.email), sign_in(SUPERVISOR.email)
    assert staff_call(client, daniela, PATRICIA_NEW, "Confirmar el reembolso").status_code == 201
    events = client.get(
        f"/api/v1/audit/events?caseId={PATRICIA_NEW}", headers=bearer(lucia)
    ).json()["items"]
    started = next(e for e in events if e["type"] == "call.started")
    assert started["description"] == "Llamó a Patricia Lozano Vega"
    assert started["redactedFields"] == ["reason"]
    assert started["payload"]["reason_length"] == len("Confirmar el reembolso")
    assert "reason" not in started["payload"]


# ----------------------------------------------------------------------------- notes
def test_an_internal_note_never_reaches_the_customer(
    client: TestClient, sign_in: SignIn, customer_session: Session
) -> None:
    daniela = sign_in(ANALYST.email)
    note = line(client, daniela, f"/api/v1/cases/{PATRICIA_NEW}/notes", "Revisar el reembolso.")
    assert note.status_code == 201, note.text
    turn = note.json()["turn"]
    assert (turn["kind"], turn["audience"], turn["authorRole"]) == ("note", "staff", "analyst")
    patricia = customer_session(PATRICIA)
    seen = client.get("/api/v1/customer/conversation", headers=bearer(patricia)).json()["turns"]
    assert "Revisar el reembolso." not in [t["text"] for t in seen]
    julian = sign_in(JULIAN.email)
    problem(
        line(client, julian, f"/api/v1/cases/{PATRICIA_NEW}/notes", "Hola"),
        403,
        "case_not_assigned",
    )
    problem(
        line(client, daniela, f"/api/v1/cases/{REFUND_CLOSED}/notes", "Tarde"), 409, "case_closed"
    )


# ----------------------------------------------------------------------------- email
def send_email(
    client: TestClient, token: str, subject: str, body: str, cmid: str | None = None
) -> Any:
    cmid = cmid or key()
    return client.post(
        "/api/v1/customer/emails",
        headers={**bearer(token), "Idempotency-Key": cmid},
        json={"subject": subject, "body": body, "clientMessageId": cmid},
    )


def reply(
    client: TestClient, token: str, case_id: str, body: str, cmid: str | None = None, **extra: Any
) -> Any:
    cmid = cmid or key()
    return client.post(
        f"/api/v1/cases/{case_id}/emails",
        headers={**bearer(token), "Idempotency-Key": cmid},
        json={"body": body, "clientMessageId": cmid, **extra},
    )


def test_an_email_thread_opens_a_case_threads_and_is_answered(
    client: TestClient, sign_in: SignIn, customer_session: Session, available: Available
) -> None:
    available(DANIELA_ID)
    lucas = customer_session(LUCAS_SIM)
    first = send_email(client, lucas, "Cobro que no reconozco", "Hola, ¿me ayudás con un cobro?")
    assert first.status_code == 201, first.text
    body = valid(SendEmailResponse, first.json())
    assert (body["caseCreated"], body["conversation"]["channel"]) == (True, "email")
    assert body["email"]["direction"] == "in"
    case_id = body["conversation"]["caseId"]
    second = send_email(client, lucas, "Re: Cobro que no reconozco", "Fue el lunes.")
    assert (second.json()["caseCreated"], second.json()["conversation"]["caseId"]) == (
        False,
        case_id,
    )  # it joins the open email case

    daniela = sign_in(ANALYST.email)
    cmid = key()
    answered = reply(client, daniela, case_id, "Ya lo revisamos.", cmid)
    assert answered.status_code == 201, answered.text
    result = valid(EmailReplyResponse, answered.json())
    email = result["email"]
    assert email["subject"] == "Re: Cobro que no reconozco"  # never "Re: Re:"
    assert email["body"] == (
        "Hola, Lucas:\n\nYa lo revisamos.\n\nSaludos,\nDaniela Ríos\nLATAM Bank"
    )
    assert (email["direction"], email["authorName"]) == ("out", "Daniela Ríos")
    assert result["case"]["firstResponseAt"] == email["createdAt"]
    assert result["case"]["inboxStatus"] == "waiting"
    again = reply(client, daniela, case_id, "Ya lo revisamos.", cmid)
    assert (again.status_code, again.headers["Idempotent-Replayed"]) == (200, "true")
    problem(reply(client, daniela, case_id, "Otro texto", cmid), 409, "idempotency_conflict")

    thread = valid(
        EmailThread, client.get(f"/api/v1/cases/{case_id}/emails", headers=bearer(daniela)).json()
    )
    assert thread["subject"] == "Cobro que no reconozco"
    assert [e["direction"] for e in thread["items"]] == ["in", "in", "out"]
    mine = client.get("/api/v1/customer/emails", headers=bearer(lucas)).json()
    assert [e["direction"] for e in mine["items"]] == ["in", "in", "out"]
    assert mine["items"][2]["authorName"] == "Daniela"
    turns = client.get("/api/v1/customer/conversation", headers=bearer(lucas)).json()["turns"]
    assert next(t["subject"] for t in turns if t["kind"] == "email") == "Cobro que no reconozco"


def test_email_rules(client: TestClient, sign_in: SignIn) -> None:
    daniela, julian = sign_in(ANALYST.email), sign_in(JULIAN.email)
    no_thread = reply(client, daniela, PATRICIA_NEW, "Le escribo por correo.")
    assert problem(no_thread, 422, "invalid_value")["field"] == "subject"
    with_subject = reply(
        client, daniela, PATRICIA_NEW, "Le escribo por correo.", subject="Su reembolso"
    )
    assert with_subject.status_code == 201, with_subject.text
    assert with_subject.json()["email"]["subject"] == "Su reembolso"
    problem(reply(client, julian, IGNACIO, "Hola"), 403, "case_not_assigned")
    problem(reply(client, daniela, REFUND_CLOSED, "Tarde", subject="x"), 409, "case_closed")
    seeded = client.get(f"/api/v1/cases/{IGNACIO}/emails", headers=bearer(daniela)).json()
    assert [e["direction"] for e in seeded["items"]] == ["in", "out", "in"]  # the seeded thread


# ----------------------------------------------------------------------------- realtime
def test_call_and_email_changes_reach_staff_and_customer_topics(
    client: TestClient, sign_in: SignIn, customer_session: Session
) -> None:
    daniela = sign_in(ANALYST.email)
    patricia = customer_session(PATRICIA)
    with connect(client, daniela) as staff, connect(client, patricia) as mine:
        subscribe(staff, f"case:{PATRICIA_NEW}")
        subscribe(staff, f"inbox:{DANIELA_ID}")
        subscribe(mine, f"customer:{seed_customer_id(PATRICIA)}")
        until_pong(staff)
        until_pong(mine)
        call = staff_call(client, daniela, PATRICIA_NEW, "Confirmar el reembolso").json()["call"]
        client.post(f"/api/v1/customer/calls/{call['id']}/answer", headers=bearer(patricia))
        path = f"/api/v1/cases/{PATRICIA_NEW}/calls/{call['id']}/transcript"
        assert line(client, daniela, path, "Hola, Patricia.").status_code == 201
        note = line(client, daniela, f"/api/v1/cases/{PATRICIA_NEW}/notes", "Nota del equipo")
        assert note.status_code == 201
        sent = reply(client, daniela, PATRICIA_NEW, "Le confirmo.", subject="Su reembolso")
        assert sent.status_code == 201
        staff_seen, customer_seen = until_pong(staff), until_pong(mine)
    assert_contract_payloads(staff_seen)
    assert_contract_payloads(customer_seen, customer=True)
    staff_calls = {e["data"]["payload"]["state"] for e in staff_seen if e["type"] == "call.updated"}
    assert staff_calls == {"ringing", "in_call"}
    assert {e["data"]["payload"]["reason"] for e in staff_seen if e["type"] == "call.updated"} == {
        "Confirmar el reembolso"
    }
    customer_calls = [e for e in customer_seen if e["type"] == "call.updated"]
    assert {e["data"]["payload"]["state"] for e in customer_calls} == {"ringing", "in_call"}
    assert all(
        e["data"]["actor"]["id"] in {None, seed_customer_id(PATRICIA)} for e in customer_calls
    )
    kinds = [e["data"]["payload"]["kind"] for e in customer_seen if e["type"] == "turn.created"]
    assert kinds == ["transcript", "email"]  # never the staff-only note
    staff_kinds = [e["data"]["payload"]["kind"] for e in staff_seen if e["type"] == "turn.created"]
    assert staff_kinds == ["transcript", "note", "email"]
