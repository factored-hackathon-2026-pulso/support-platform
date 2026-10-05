"""Server-rendered texts in the reader's UI language (slice 23c): the catalogs, and the
audit descriptions in Brazilian Portuguese (Spanish stays pinned by ``test_audit.py``)."""

from __future__ import annotations

from dataclasses import replace

from cc_platform.application.audit.catalog import AuditNames, describe, fallback_description
from cc_platform.application.audit.queries import AuditQuery, ListAuditEvents
from cc_platform.application.cases import copy
from cc_platform.application.i18n import CATALOGS, placeholders, texts
from cc_platform.application.i18n import es as es_catalog
from cc_platform.application.people.admin.copy import ROLE_LABEL
from cc_platform.domain.people.preferences import UiLanguage
from cc_platform.infrastructure.seed.people import seed_staff_id
from tests.support import ANALYST, SUPERVISOR, actor_for, memory_container
from tests.unit.application.test_audit import T, emit_everything, stored

PT = UiLanguage.PORTUGUESE_BRAZIL
DANIELA_ID, JULIAN_ID = seed_staff_id(1), seed_staff_id(2)


# ----------------------------------------------------------------------------- catalogs
def test_every_catalog_has_the_same_keys_and_placeholders_as_spanish() -> None:
    source = CATALOGS[UiLanguage.SPANISH]
    for language, catalog in CATALOGS.items():
        assert set(catalog) == set(source), language
        for key, template in catalog.items():
            assert template.strip(), f"{language} {key} is empty"
            assert placeholders(template) == placeholders(source[key]), f"{language} {key}"


def test_the_spanish_catalog_keeps_the_words_of_the_stored_texts() -> None:
    """The transcript lines are still stored in Spanish (``cases/copy.py``): one vocabulary."""
    catalog = es_catalog.CATALOG
    for language, name in copy.LANGUAGE_NAME.items():
        assert catalog[f"language.{language.value}"] == name
    for language, label in copy.QUEUE_LABEL.items():
        assert catalog[f"queue.{language.value}"] == label
    for reason, label in copy.CLOSE_REASON_LABEL.items():
        assert catalog[f"closeReason.{reason.value}"] == label
    for role, label in ROLE_LABEL.items():
        assert catalog[f"role.{role.value}"] == label


def test_lists_and_plurals_in_each_language() -> None:
    es, pt = texts(UiLanguage.SPANISH), texts(PT)
    assert [es.join([]), es.join(["A"]), es.join(["A", "B"]), es.join(["A", "B", "C"])] == [
        "",
        "A",
        "A y B",
        "A, B y C",
    ]
    assert pt.join(["Analista", "Supervisão"]) == "Analista e Supervisão"
    assert pt.plural("duration.hours", 1) == "1 hora"
    assert pt.plural("duration.hours", 48) == "48 horas"
    assert es.plural("audit.builder.validated", 2) == "Validó la propuesta: 2 violaciones"


# ----------------------------------------------------------------------------- audit in pt-BR
def test_descriptions_in_portuguese() -> None:
    names = AuditNames(people={DANIELA_ID: "Daniela Ríos", JULIAN_ID: "Julián Ortega"})
    cases = [
        (
            stored(
                "case.assigned",
                {"reason": "arrival", "assigned_analyst_id": DANIELA_ID, "policy_rule_id": "H1"},
            ),
            "Atribuiu o caso a Daniela Ríos: estava disponível e fala português (regra 3)",
        ),
        (
            stored(
                "case.assigned",
                {
                    "reason": "manual",
                    "assigned_analyst_id": DANIELA_ID,
                    "previous_analyst_id": JULIAN_ID,
                },
            ),
            "Reatribuiu o caso de Julián Ortega para Daniela Ríos",
        ),
        (
            stored("case.queued", {"queue_label": "Cola en español", "language": "es"}),
            "Deixou o caso na fila em espanhol: ninguém disponível fala espanhol",
        ),
        (stored("case.closed", {"reason": "duplicate"}), "Encerrou o caso · Duplicado"),
        (stored("case.priority_changed", {"to": "high"}), "Mudou a prioridade para Alta"),
        (
            stored("case.type_changed", {"to": "undue_charge"}),
            "Mudou o tipo de caso para Cobrança indevida",
        ),
        (stored("case.rated", {"score": 3}), "O cliente avaliou o caso: Bom"),
        (stored("escalation.opened", {}), "Escalou o caso para a supervisão"),
        (
            stored("ai.stage_advanced", {"case_type": "undue_charge", "to_stage": 3}),
            "Subiu Cobrança indevida para a etapa 3: o copiloto propõe respostas",
        ),
        (
            stored("staff.ui_language_changed", {"to_language": "pt-BR"}),
            "Mudou o idioma da plataforma para Português",
        ),
        (
            stored("staff.ui_language_changed", {"to_language": "es"}),
            "Mudou o idioma da plataforma para Español",
        ),
        (
            stored("auth.login_failed", {"factor": "password", "remaining_attempts": 4}),
            "Tentativa de acesso malsucedida (senha) · restam 4",
        ),
        (
            stored("builder.proposal_validated", {"violations": 1}),
            "Validou a proposta: 1 violação",
        ),
        (stored("test.unknown", {}), "Evento test.unknown"),
    ]
    for event, text in cases:
        assert describe(event, names, PT) == text
    assert fallback_description("test.unknown", PT) == "Evento test.unknown"


def test_staff_lists_and_session_counts_in_portuguese() -> None:
    names = AuditNames(people={DANIELA_ID: "Daniela Ríos"})
    roles = replace(
        stored("staff.roles_changed", {"added": ["supervisor", "analyst"]}), entity_id=DANIELA_ID
    )
    assert describe(roles, names, PT) == "Deu a Daniela Ríos o perfil de Analista e Supervisão"
    deactivated = replace(
        stored("staff.deactivated", {"revoked_sessions": 2}), entity_id=DANIELA_ID
    )
    assert describe(deactivated, names, PT) == (
        "Desativou a conta de Daniela Ríos e encerrou as 2 sessões"
    )
    assert (
        describe(deactivated, names) == "Desactivó la cuenta de Daniela Ríos y cerró sus 2 sesiones"
    )


async def test_the_log_speaks_the_readers_language() -> None:
    """Every emitted event, read by a person whose UI is in Portuguese (Daniela switched in
    ``emit_everything``): no fallback, nothing left in Spanish; a Spanish reader is unchanged."""
    container = await memory_container()
    await emit_everything(container)
    use_case = ListAuditEvents(container.uow)
    query = AuditQuery(limit=100)
    in_portuguese = (await use_case.execute(query, reader=actor_for(ANALYST))).items
    in_spanish = (await use_case.execute(query, reader=actor_for(SUPERVISOR))).items
    without_reader = (await use_case.execute(query)).items
    assert [e.description for e in in_spanish] == [e.description for e in without_reader]
    assert [e.id for e in in_portuguese] == [e.id for e in in_spanish]
    assert not [e for e in in_portuguese if e.description.startswith("Evento ")]
    same = [
        (pt.type, pt.description)
        for pt, es in zip(in_portuguese, in_spanish, strict=True)
        if pt.description == es.description
    ]
    assert same == []
    descriptions = {e.description for e in in_portuguese}
    assert {
        "Mudou o idioma da plataforma para Português",
        "Passou para Disponível",
        "Passou para Em pausa",
    } <= descriptions
    one = await container.use_cases.audit.get_event.execute(
        in_portuguese[0].id, reader=actor_for(ANALYST)
    )
    assert one.description == in_portuguese[0].description


def test_times_stay_out_of_descriptions() -> None:
    event = stored("auth.account_locked", {"locked_until": T.isoformat(), "failed_attempts": 5})
    assert (
        describe(event, AuditNames(), PT) == "A conta ficou bloqueada por 0 min após 5 tentativas"
    )
