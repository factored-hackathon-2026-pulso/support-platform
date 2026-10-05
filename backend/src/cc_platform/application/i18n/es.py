"""Spanish (neutral es-CO / es-MX): the source catalog of the server's texts.

Pure data. The words the stored transcript lines also use (language and queue names, close
reasons, role labels) are pinned equal to ``cases/copy.py`` and ``people/admin/copy.py`` by a
test. Times are never written here: the UI shows them in the viewer's zone.
"""

from __future__ import annotations

from collections.abc import Mapping
from typing import Final

CATALOG: Final[Mapping[str, str]] = {
    # ------------------------------------------------------------------ shared vocabulary
    "list.and": "y",
    "someone": "alguien",
    "language.es": "español",
    "language.pt": "portugués",
    "queue.es": "Cola en español",
    "queue.pt": "Cola en portugués",
    "closeReason.resolved": "Resuelto",
    "closeReason.customer_unresponsive": "El cliente no respondió",
    "closeReason.duplicate": "Duplicado",
    "closeReason.out_of_scope": "Fuera de alcance",
    "closeReason.other": "Otro",
    # Slice 12: how a case opened, inside a sentence ("Abrió un caso nuevo por …").
    "channel.chat_app": "chat en la app",
    "channel.chat_web": "chat web",
    "channel.phone_inbound": "llamada entrante",
    "channel.phone_outbound": "llamada saliente",
    "channel.email": "correo",
    # Slice 7: the 1–4 rating scale in words (the frontend uses the same ones).
    "rating.1": "Mal",
    "rating.2": "Regular",
    "rating.3": "Bien",
    "rating.4": "Excelente",
    # Slice 8: the priority levels.
    "priority.none": "Sin prioridad",
    "priority.low": "Baja",
    "priority.medium": "Media",
    "priority.high": "Alta",
    "priority.critical": "Crítica",
    # Slice 18: the case types (the dataset's complaint subcategories; "Tarjeta virtual" is
    # team-generated).
    "caseType.none": "Sin tipo",
    "caseType.unrecognized_charge": "Cargo no reconocido",
    "caseType.undue_charge": "Cobro indebido",
    "caseType.app_issue": "Problema con app",
    "caseType.branch_service": "Atención en sucursal",
    "caseType.service_quality": "Calidad de servicio",
    "caseType.virtual_card": "Tarjeta virtual",
    # Slice 21: what a case type's copilot does at each stage (ADR 0006 §1).
    "stage.0": "solo personas",
    "stage.1": "el copiloto responde",
    "stage.2": "el copiloto propone herramientas",
    "stage.3": "el copiloto propone respuestas",
    # Slice 4: role labels (the frontend shows the same ones).
    "role.analyst": "Analista",
    "role.supervisor": "Supervisión",
    "role.admin": "Administración",
    # Slice 23: each UI language by its own name (as the language menu shows it).
    "uiLanguage.es": "Español",
    "uiLanguage.pt-BR": "Português",
    # ------------------------------------------------------------------ audit: "Qué hizo"
    "audit.fallback": "Evento {event_type}",
    "audit.rule3": " (regla 3)",
    # cases
    "audit.caseOpened.followUp": "Abrió un caso de seguimiento para llamar al cliente",
    "audit.caseOpened.calledAgain": "Volvió a llamar y abrió un caso nuevo por {channel}",
    "audit.caseOpened.wroteAgain": "Volvió a escribir y abrió un caso nuevo por {channel}",
    "audit.caseOpened.new": "Abrió un caso nuevo por {channel}",
    "audit.caseQueued": "Dejó el caso en la {queue}: nadie disponible habla {language}",
    "audit.caseAssigned.followUp": "Se asignó el caso para hacer una llamada de seguimiento",
    "audit.caseAssigned.fromQueueAfter": (
        "Asignó el caso a {analyst} desde la {queue} después de {minutes} min"
    ),
    "audit.caseAssigned.reassigned": "Reasignó el caso de {previous} a {analyst}",
    "audit.caseAssigned.fromQueue": "Asignó el caso a {analyst} desde la {queue}",
    "audit.caseAssigned.available": (
        "Asignó el caso a {analyst}: estaba disponible y habla {language}"
    ),
    "audit.caseAssigned.paused": " ({analyst} estaba en pausa)",
    "audit.caseStatus.openedByAssignee": "Abrió el caso por primera vez",
    "audit.caseStatus.closed": "El caso pasó a cerrado",
    "audit.caseStatus.reassigned": "El caso volvió a «sin abrir» por la reasignación",
    "audit.caseStatus.other": "Cambió el estado del caso",
    "audit.caseRead": "Leyó la conversación hasta el mensaje {sequence}",
    "audit.firstResponse.met": "Primera respuesta en {minutes} min · SLA cumplido",
    "audit.firstResponse.missed": "Primera respuesta en {minutes} min · SLA vencido",
    "audit.caseClosed": "Cerró el caso · {label}",
    "audit.caseRated.score": "El cliente calificó el caso: {label}",
    "audit.caseRated.plain": "El cliente calificó el caso",
    "audit.priority.removed": "Quitó la prioridad",
    "audit.priority.changedTo": "Cambió la prioridad a {label}",
    "audit.priority.changed": "Cambió la prioridad",
    "audit.caseType.removed": "Quitó el tipo de caso",
    "audit.caseType.changedTo": "Cambió el tipo de caso a {label}",
    "audit.caseType.changed": "Cambió el tipo de caso",
    "audit.caseViewed": "Abrió la conversación en modo supervisión (solo lectura)",
    # turns (the audit never shows what was said)
    "audit.turn.notice": "La plataforma le envió un aviso al cliente",
    "audit.turn.routing": "Dejó una nota de asignación para el equipo",
    "audit.turn.note": "Dejó una nota interna para el equipo",
    "audit.turn.emailFromCustomer": "Envió un correo",
    "audit.turn.email": "Respondió por correo",
    "audit.turn.callEvent": "Anotó un cambio de la llamada en la transcripción",
    "audit.turn.callLine": "Habló en la llamada",
    "audit.turn.customerMessage": "Escribió un mensaje",
    "audit.turn.assistantMessage": "Respondió al cliente (asistente)",
    "audit.turn.reply": "Respondió al cliente",
    # the assistant (ADR 0003)
    "audit.assistant.started": "La conversación empezó con el asistente",
    "audit.assistant.sessionStarted": "Empezó la sesión con el asistente",
    "audit.assistant.turnAnswered": "El asistente respondió",
    "audit.assistant.inputQueued": "Respondió a la confirmación del asistente",
    "audit.assistant.stepUpVerified": "Pasó la verificación adicional",
    "audit.assistant.stepUpRejected": "Falló la verificación adicional",
    "audit.assistantReleased.escalated": "El asistente escaló el caso a una persona",
    "audit.assistantReleased.ended": "El asistente terminó su atención sin resolver el caso",
    "audit.assistantReleased.failed": "El asistente no pudo seguir y el caso pasó a una persona",
    "audit.assistantReleased.supervision": "Tomó el caso del asistente",
    "audit.assistantReleased.customer_request": "Pidió hablar con una persona",
    "audit.assistantReleased.ai_disabled": (
        "El caso pasó a una persona porque se apagaron las funciones de IA"
    ),
    "audit.assistantReleased.other": "El caso salió del asistente",
    "audit.assistantEnded.resolved": "El asistente resolvió la conversación",
    "audit.assistantEnded.escalated": "El asistente terminó: escaló el caso a una persona",
    "audit.assistantEnded.ended": "El asistente terminó su atención sin resolver",
    "audit.assistantEnded.failed": "El asistente dejó de atender por una falla",
    "audit.assistantEnded.released": (
        "La atención del asistente terminó: el caso pasó a una persona"
    ),
    "audit.assistantEnded.other": "Terminó el asistente",
    # the copilot (slice 15, ADR 0005)
    "audit.copilot.queryAsked": "Le preguntó algo al copiloto sobre el caso",
    "audit.copilot.answered": "El copiloto respondió",
    "audit.copilot.suggestionRequested": "Se pidió una sugerencia al copiloto",
    "audit.copilot.suggestionReady": "El copiloto preparó una sugerencia",
    "audit.copilot.suggestionNone": "El copiloto no tenía nada que sugerir",
    "audit.copilot.suggestionFailed": "No se pudo preparar la sugerencia del copiloto",
    "audit.copilot.toolUsed": "Usó una herramienta que propuso el copiloto",
    "audit.copilot.suggestionShown": "Vio una sugerencia del copiloto",
    "audit.copilot.suggestionIgnored": "La sugerencia del copiloto quedó sin usar",
    "audit.suggestion.escalationDismissed": "Descartó la recomendación de escalar del copiloto",
    "audit.handoffRated.useful": "Calificó el traspaso del asistente: útil",
    "audit.handoffRated.incomplete": "Calificó el traspaso del asistente: incompleto",
    "audit.handoffRated.unnecessary": "Calificó el traspaso del asistente: innecesario",
    "audit.handoffRated.other": "Calificó el traspaso del asistente",
    "audit.suggestion.escalation": "Escaló el caso con la recomendación del copiloto",
    "audit.suggestion.used": "Usó el borrador del copiloto tal cual",
    "audit.suggestion.edited": "Usó el borrador del copiloto con cambios",
    "audit.suggestion.discarded": "Descartó el borrador del copiloto",
    "audit.suggestion.ignored": "El borrador del copiloto quedó sin decidir",
    "audit.suggestion.other": "Decidió sobre una sugerencia del copiloto",
    # stages (slice 21)
    "audit.stage.someType": "un tipo de caso",
    "audit.stage.other": "otra etapa",
    "audit.stage.numbered": "la etapa {stage}: {text}",
    "audit.stage.advanced": "Subió {type} a {stage}",
    "audit.stage.movedBack": "Devolvió {type} a {stage}",
    "audit.stage.proposalWithdrawn": "Retiró la propuesta de agente de {type}",
    "audit.stage.agentReady": "Propuso un agente para {type}",
    "audit.stage.agentActivated": "Activó el agente de {type}",
    # the agent builder (slice 16)
    "audit.builder.proposalCreated": "Creó una propuesta de cambio de un agente",
    "audit.builder.proposalTracked": "Agregó una propuesta del constructor a la lista",
    "audit.builder.draftSaved": "Guardó el borrador de una propuesta",
    "audit.builder.validatedClean": "Validó la propuesta: sin violaciones",
    "audit.builder.validated_one": "Validó la propuesta: {count} violación",
    "audit.builder.validated_other": "Validó la propuesta: {count} violaciones",
    "audit.builder.frozen": "Congeló la candidata de una propuesta",
    "audit.builder.reopened": "Reabrió una propuesta para editarla",
    "audit.builder.verdict.pass": "La evaluación de la propuesta pasó el gate",
    "audit.builder.verdict.fail": (
        "La evaluación de la propuesta no pasó el gate: volvió a borrador"
    ),
    "audit.builder.verdict.failed_infra": (
        "La evaluación de la propuesta falló por la infraestructura"
    ),
    "audit.builder.verdict.other": "Evaluó la propuesta",
    "audit.builder.approvedLoosened": (
        "Aprobó la propuesta, aceptando que afloja la vara de evaluación"
    ),
    "audit.builder.approved": "Aprobó la propuesta",
    "audit.builder.rejected": "Rechazó la propuesta: volvió a borrador",
    "audit.builder.published": "Publicó la propuesta como una versión nueva del agente",
    "audit.builder.promoted": "Promovió una versión de un agente a {alias}",
    "audit.builder.revoked": "Revocó una versión de un agente",
    "audit.builder.questionAsked": "Le escribió al constructor de agentes",
    "audit.builder.answered": "El constructor de agentes respondió",
    # escalations (slice 9)
    "audit.escalation.opened": "Escaló el caso a supervisión",
    "audit.escalation.withdrawn": "Retiró el escalamiento",
    "audit.escalation.answered": "Respondió el escalamiento",
    "audit.escalation.taken": "Tomó el caso escalado de {previous}",
    "audit.escalation.reassigned": "Reasignó el caso escalado de {previous} a {analyst}",
    "audit.escalation.closed": "El escalamiento terminó porque se cerró el caso",
    "audit.escalation.acknowledged": "Leyó lo que hizo supervisión con su escalamiento",
    # calls (slice 12)
    "audit.call.outbound": "Llamó a {customer}",
    "audit.call.inbound": "Llamó a la línea de atención",
    "audit.call.answeredByCustomer": "Contestó la llamada",
    "audit.call.answered": "Atendió la llamada",
    "audit.call.held": "Puso la llamada en espera",
    "audit.call.resumed": "Retomó la llamada",
    "audit.call.muted": "Silenció su micrófono",
    "audit.call.unmuted": "Activó su micrófono",
    "audit.call.rejected": "Rechazó la llamada",
    "audit.call.cancelled": "Colgó antes de que contestaran",
    "audit.call.ended": "Terminó la llamada · duró {minutes} min",
    # availability and her own settings
    "audit.availability.deactivated": "Dejó en pausa a {person} al desactivar su cuenta",
    "audit.availability.roleRemoved": ("Dejó en pausa a {person} al quitarle el rol de Analista"),
    "audit.availability.available": "Pasó a Disponible",
    "audit.availability.paused": "Pasó a En pausa",
    "audit.uiLanguageChanged": "Cambió el idioma de la plataforma a {name}",
    # access
    "audit.customerSession": "Abrió el chat ({channel})",
    "audit.passwordAccepted": "Ingresó la contraseña correcta",
    "audit.mfaChallengeIssued": "Se le pidió el código de verificación",
    "audit.factor.mfa": "código",
    "audit.factor.password": "contraseña",
    "audit.loginFailed": "Intento de ingreso fallido ({factor}) · quedan {remaining}",
    "audit.mfaFailed": "Código de verificación incorrecto · quedan {remaining}",
    "audit.accountLocked": "La cuenta quedó bloqueada por {minutes} min tras {attempts} intentos",
    "audit.sessionStarted": "Inició sesión",
    "audit.sessionEnded": "Cerró sesión",
    "audit.sessionEndedBy": "Cerró la sesión de {person}",
    "audit.sessionRevoked": "Su sesión se revocó",
    "audit.invitationAccepted": "Aceptó la invitación y activó su cuenta",
    "audit.mfaEnrolled": "Configuró la verificación en dos pasos",
    "audit.passwordReset": "Creó una contraseña nueva con el enlace de restablecimiento",
    # administration (slice 4, part 4)
    "audit.sessionsSuffix_one": " y cerró su sesión",
    "audit.sessionsSuffix_other": " y cerró sus {count} sesiones",
    "audit.staffCreated": "Creó la cuenta de {person}",
    "audit.profile.name": "Cambió el nombre de {before} a {after}",
    "audit.profile.email": "Cambió el correo de {after}",
    "audit.profile.both": "Cambió el nombre y el correo de {after} (antes {before})",
    "audit.roles.both": "Cambió los roles de {person}: le dio {added} y le quitó {removed}",
    "audit.roles.removed": "Le quitó a {person} el rol de {removed}",
    "audit.roles.added": "Le dio a {person} el rol de {added}",
    "audit.languages.none": "Cambió los idiomas de {person}: ya no tiene idiomas",
    "audit.languages.spoken": "Cambió los idiomas de {person}: ahora habla {spoken}",
    "audit.team.other": "otro equipo",
    "audit.teamChanged": "Pasó a {person} de {before} a {after}",
    "audit.staffDeactivated": "Desactivó la cuenta de {person}{sessions}",
    "audit.staffReactivated": "Reactivó la cuenta de {person}",
    "audit.accountUnlocked": "Desbloqueó la cuenta de {person}",
    "audit.attemptsReset": "Reinició los intentos de ingreso de {person}",
    "audit.resetLinkSent": (
        "Le envió a {person} un enlace para restablecer la contraseña{sessions}"
    ),
    "audit.invitationSent": "Invitó a {person} por correo",
    "audit.invitationResent": "Reenvió la invitación a {person}",
    "audit.invitationCancelled": "Canceló la invitación de {person}",
    "audit.aiEnabled": "Activó las funciones de IA",
    "audit.aiDisabled": "Desactivó las funciones de IA",
    "audit.teamCreated": "Creó el equipo {team}",
    "audit.teamRenamed": "Le cambió el nombre al equipo {before}: ahora es {after}",
    "audit.teamDeactivated": "Desactivó el equipo {team}",
    "audit.teamReactivated": "Reactivó el equipo {team}",
    # ------------------------------------------------------------------ emails (part 4)
    "duration.hours_one": "1 hora",
    "duration.hours_other": "{count} horas",
    "duration.minutes_one": "1 minuto",
    "duration.minutes_other": "{count} minutos",
    "email.invitation.subject": "Te invitaron a la Plataforma CC de LATAM Bank",
    "email.invitation.body": (
        "Hola, {name}.\n\n"
        "Administración te invitó a la Plataforma CC de LATAM Bank con el rol de {roles} "
        "en {team}.\n\n"
        "Para activar tu cuenta, abre este enlace, crea tu contraseña y configura la "
        "verificación en dos pasos con una app de autenticación:\n"
        "{link}\n\n"
        "El enlace vence en {duration} y sirve una sola vez. Nadie del banco conoce "
        "tu contraseña ni te la va a pedir.\n\n"
        "Si no esperabas esta invitación, ignora este correo."
    ),
    "email.reset.subject": "Crea una contraseña nueva para la Plataforma CC",
    "email.reset.body": (
        "Hola, {name}.\n\n"
        "Administración te envió un enlace para crear una contraseña nueva. Tus sesiones "
        "abiertas se cerraron.\n\n"
        "Abre este enlace y crea tu contraseña nueva:\n"
        "{link}\n\n"
        "El enlace vence en {duration} y sirve una sola vez. Tu verificación en dos "
        "pasos no cambia.\n\n"
        "Si no lo pediste, avisa a administración."
    ),
}
