"""Brazilian Portuguese: the server's texts for a person whose UI language is ``pt-BR``.

Same keys and placeholders as ``es.py`` (a test checks it). The terms follow the frontend
glossary (``docs/platform/api/slice-23-i18n.md`` §3, §8): atribuir / reatribuir, assumir o
caso, fila, equipe, encerrar (a case), escalonamento, transferência, perfil (a role),
convite, e-mail, Supervisão, Administração, Assistente virtual.
"""

from __future__ import annotations

from collections.abc import Mapping
from typing import Final

CATALOG: Final[Mapping[str, str]] = {
    # ------------------------------------------------------------------ shared vocabulary
    "list.and": "e",
    "someone": "alguém",
    "language.es": "espanhol",
    "language.pt": "português",
    "queue.es": "Fila em espanhol",
    "queue.pt": "Fila em português",
    "closeReason.resolved": "Resolvido",
    "closeReason.customer_unresponsive": "O cliente não respondeu",
    "closeReason.duplicate": "Duplicado",
    "closeReason.out_of_scope": "Fora do escopo",
    "closeReason.other": "Outro",
    "channel.chat_app": "chat no app",
    "channel.chat_web": "chat web",
    "channel.phone_inbound": "ligação recebida",
    "channel.phone_outbound": "ligação efetuada",
    "channel.email": "e-mail",
    "rating.1": "Ruim",
    "rating.2": "Regular",
    "rating.3": "Bom",
    "rating.4": "Excelente",
    "priority.none": "Sem prioridade",
    "priority.low": "Baixa",
    "priority.medium": "Média",
    "priority.high": "Alta",
    "priority.critical": "Crítica",
    "caseType.none": "Sem tipo",
    "caseType.unrecognized_charge": "Transação não reconhecida",
    "caseType.undue_charge": "Cobrança indevida",
    "caseType.app_issue": "Problema com o app",
    "caseType.branch_service": "Atendimento na agência",
    "caseType.service_quality": "Qualidade do atendimento",
    "caseType.virtual_card": "Cartão virtual",
    "stage.0": "só pessoas",
    "stage.1": "o copiloto responde",
    "stage.2": "o copiloto propõe ferramentas",
    "stage.3": "o copiloto propõe respostas",
    "role.analyst": "Analista",
    "role.supervisor": "Supervisão",
    "role.admin": "Administração",
    "uiLanguage.es": "Español",
    "uiLanguage.pt-BR": "Português",
    # ------------------------------------------------------------------ audit: "O que fez"
    "audit.fallback": "Evento {event_type}",
    "audit.rule3": " (regra 3)",
    # cases
    "audit.caseOpened.followUp": "Abriu um caso de acompanhamento para ligar para o cliente",
    "audit.caseOpened.calledAgain": "Voltou a ligar e abriu um caso novo por {channel}",
    "audit.caseOpened.wroteAgain": "Voltou a escrever e abriu um caso novo por {channel}",
    "audit.caseOpened.new": "Abriu um caso novo por {channel}",
    "audit.caseQueued": "Deixou o caso na {queue}: ninguém disponível fala {language}",
    "audit.caseAssigned.followUp": "Assumiu o caso para fazer uma ligação de acompanhamento",
    "audit.caseAssigned.fromQueueAfter": (
        "Atribuiu o caso a {analyst} da {queue} depois de {minutes} min"
    ),
    "audit.caseAssigned.reassigned": "Reatribuiu o caso de {previous} para {analyst}",
    "audit.caseAssigned.fromQueue": "Atribuiu o caso a {analyst} da {queue}",
    "audit.caseAssigned.available": (
        "Atribuiu o caso a {analyst}: estava disponível e fala {language}"
    ),
    "audit.caseAssigned.paused": " ({analyst} estava em pausa)",
    "audit.caseStatus.openedByAssignee": "Abriu o caso pela primeira vez",
    "audit.caseStatus.closed": "O caso passou para encerrado",
    "audit.caseStatus.reassigned": "O caso voltou para «não aberto» pela reatribuição",
    "audit.caseStatus.other": "Mudou o status do caso",
    "audit.caseRead": "Leu a conversa até a mensagem {sequence}",
    "audit.firstResponse.met": "Primeira resposta em {minutes} min · SLA cumprido",
    "audit.firstResponse.missed": "Primeira resposta em {minutes} min · SLA vencido",
    "audit.caseClosed": "Encerrou o caso · {label}",
    "audit.caseRated.score": "O cliente avaliou o caso: {label}",
    "audit.caseRated.plain": "O cliente avaliou o caso",
    "audit.priority.removed": "Removeu a prioridade",
    "audit.priority.changedTo": "Mudou a prioridade para {label}",
    "audit.priority.changed": "Mudou a prioridade",
    "audit.caseType.removed": "Removeu o tipo de caso",
    "audit.caseType.changedTo": "Mudou o tipo de caso para {label}",
    "audit.caseType.changed": "Mudou o tipo de caso",
    "audit.caseViewed": "Abriu a conversa no modo supervisão (somente leitura)",
    # turns
    "audit.turn.notice": "A plataforma enviou um aviso ao cliente",
    "audit.turn.routing": "Deixou uma nota de atribuição para a equipe",
    "audit.turn.note": "Deixou uma nota interna para a equipe",
    "audit.turn.emailFromCustomer": "Enviou um e-mail",
    "audit.turn.email": "Respondeu por e-mail",
    "audit.turn.callEvent": "Registrou uma mudança da ligação na transcrição",
    "audit.turn.callLine": "Falou na ligação",
    "audit.turn.customerMessage": "Escreveu uma mensagem",
    "audit.turn.assistantMessage": "Respondeu ao cliente (assistente)",
    "audit.turn.reply": "Respondeu ao cliente",
    # the assistant
    "audit.assistant.started": "A conversa começou com o assistente",
    "audit.assistant.sessionStarted": "Começou a sessão com o assistente",
    "audit.assistant.turnAnswered": "O assistente respondeu",
    "audit.assistant.inputQueued": "Respondeu à confirmação do assistente",
    "audit.assistant.stepUpVerified": "Passou na verificação adicional",
    "audit.assistant.stepUpRejected": "Falhou na verificação adicional",
    "audit.assistantReleased.escalated": "O assistente escalou o caso para uma pessoa",
    "audit.assistantReleased.ended": "O assistente encerrou o atendimento sem resolver o caso",
    "audit.assistantReleased.failed": (
        "O assistente não conseguiu continuar e o caso passou para uma pessoa"
    ),
    "audit.assistantReleased.supervision": "Assumiu o caso do assistente",
    "audit.assistantReleased.customer_request": "Pediu para falar com uma pessoa",
    "audit.assistantReleased.ai_disabled": (
        "O caso passou para uma pessoa porque as funções de IA foram desligadas"
    ),
    "audit.assistantReleased.other": "O caso saiu do assistente",
    "audit.assistantEnded.resolved": "O assistente resolveu a conversa",
    "audit.assistantEnded.escalated": "O assistente terminou: escalou o caso para uma pessoa",
    "audit.assistantEnded.ended": "O assistente encerrou o atendimento sem resolver",
    "audit.assistantEnded.failed": "O assistente parou de atender por uma falha",
    "audit.assistantEnded.released": (
        "O atendimento do assistente terminou: o caso passou para uma pessoa"
    ),
    "audit.assistantEnded.other": "O assistente terminou",
    # the copilot
    "audit.copilot.queryAsked": "Perguntou algo ao copiloto sobre o caso",
    "audit.copilot.answered": "O copiloto respondeu",
    "audit.copilot.suggestionRequested": "Uma sugestão foi pedida ao copiloto",
    "audit.copilot.suggestionReady": "O copiloto preparou uma sugestão",
    "audit.copilot.suggestionNone": "O copiloto não tinha nada a sugerir",
    "audit.copilot.suggestionFailed": "Não foi possível preparar a sugestão do copiloto",
    "audit.copilot.toolUsed": "Usou uma ferramenta que o copiloto propôs",
    "audit.suggestion.escalation": "Escalou o caso com a recomendação do copiloto",
    "audit.suggestion.used": "Usou o rascunho do copiloto sem alterações",
    "audit.suggestion.edited": "Usou o rascunho do copiloto com alterações",
    "audit.suggestion.discarded": "Descartou o rascunho do copiloto",
    "audit.suggestion.ignored": "O rascunho do copiloto ficou sem decisão",
    "audit.suggestion.other": "Decidiu sobre uma sugestão do copiloto",
    # stages
    "audit.stage.someType": "um tipo de caso",
    "audit.stage.other": "outra etapa",
    "audit.stage.numbered": "a etapa {stage}: {text}",
    "audit.stage.advanced": "Subiu {type} para {stage}",
    "audit.stage.movedBack": "Devolveu {type} para {stage}",
    "audit.stage.proposalWithdrawn": "Retirou a proposta de agente de {type}",
    "audit.stage.agentReady": "Propôs um agente para {type}",
    "audit.stage.agentActivated": "Ativou o agente de {type}",
    "audit.stage.agentRenamed": "Mudou o nome do agente de {type}",
    "audit.stage.agentPaused": "Pausou o agente de {type}",
    "audit.stage.agentResumed": "Retomou o agente de {type}",
    # the agent builder
    "audit.builder.proposalCreated": "Criou uma proposta de mudança de um agente",
    "audit.builder.proposalTracked": "Adicionou uma proposta do construtor à lista",
    "audit.builder.draftSaved": "Salvou o rascunho de uma proposta",
    "audit.builder.validatedClean": "Validou a proposta: sem violações",
    "audit.builder.validated_one": "Validou a proposta: {count} violação",
    "audit.builder.validated_other": "Validou a proposta: {count} violações",
    "audit.builder.frozen": "Congelou a candidata de uma proposta",
    "audit.builder.reopened": "Reabriu uma proposta para editá-la",
    "audit.builder.verdict.pass": "A avaliação da proposta passou no gate",
    "audit.builder.verdict.fail": (
        "A avaliação da proposta não passou no gate: voltou para rascunho"
    ),
    "audit.builder.verdict.failed_infra": (
        "A avaliação da proposta falhou por causa da infraestrutura"
    ),
    "audit.builder.verdict.other": "Avaliou a proposta",
    "audit.builder.approvedLoosened": (
        "Aprovou a proposta, aceitando que ela afrouxa o critério de avaliação"
    ),
    "audit.builder.approved": "Aprovou a proposta",
    "audit.builder.rejected": "Rejeitou a proposta: voltou para rascunho",
    "audit.builder.published": "Publicou a proposta como uma nova versão do agente",
    "audit.builder.promoted": "Promoveu uma versão de um agente para {alias}",
    "audit.builder.revoked": "Revogou uma versão de um agente",
    "audit.builder.questionAsked": "Escreveu para o construtor de agentes",
    "audit.builder.answered": "O construtor de agentes respondeu",
    # escalations
    "audit.escalation.opened": "Escalou o caso para a supervisão",
    "audit.escalation.withdrawn": "Retirou o escalonamento",
    "audit.escalation.answered": "Respondeu ao escalonamento",
    "audit.escalation.taken": "Assumiu o caso escalado de {previous}",
    "audit.escalation.reassigned": "Reatribuiu o caso escalado de {previous} para {analyst}",
    "audit.escalation.closed": "O escalonamento terminou porque o caso foi encerrado",
    "audit.escalation.acknowledged": "Leu o que a supervisão fez com o escalonamento",
    # calls
    "audit.call.outbound": "Ligou para {customer}",
    "audit.call.inbound": "Ligou para a central de atendimento",
    "audit.call.answeredByCustomer": "Atendeu a ligação",
    "audit.call.answered": "Atendeu a ligação",
    "audit.call.held": "Colocou a ligação em espera",
    "audit.call.resumed": "Retomou a ligação",
    "audit.call.muted": "Silenciou o microfone",
    "audit.call.unmuted": "Ativou o microfone",
    "audit.call.rejected": "Recusou a ligação",
    "audit.call.cancelled": "Desligou antes de atenderem",
    "audit.call.ended": "Encerrou a ligação · durou {minutes} min",
    # availability and her own settings
    "audit.availability.deactivated": "Colocou {person} em pausa ao desativar a conta",
    "audit.availability.roleRemoved": ("Colocou {person} em pausa ao remover o perfil de Analista"),
    "audit.availability.available": "Passou para Disponível",
    "audit.availability.paused": "Passou para Em pausa",
    "audit.uiLanguageChanged": "Mudou o idioma da plataforma para {name}",
    # access
    "audit.customerSession": "Abriu o chat ({channel})",
    "audit.passwordAccepted": "Digitou a senha correta",
    "audit.mfaChallengeIssued": "O código de verificação foi solicitado",
    "audit.factor.mfa": "código",
    "audit.factor.password": "senha",
    "audit.loginFailed": "Tentativa de acesso malsucedida ({factor}) · restam {remaining}",
    "audit.mfaFailed": "Código de verificação incorreto · restam {remaining}",
    "audit.accountLocked": ("A conta ficou bloqueada por {minutes} min após {attempts} tentativas"),
    "audit.sessionStarted": "Iniciou a sessão",
    "audit.sessionEnded": "Encerrou a sessão",
    "audit.sessionEndedBy": "Encerrou a sessão de {person}",
    "audit.sessionRevoked": "A sessão foi revogada",
    "audit.invitationAccepted": "Aceitou o convite e ativou a conta",
    "audit.mfaEnrolled": "Configurou a verificação em duas etapas",
    "audit.passwordReset": "Criou uma nova senha com o link de redefinição",
    # administration
    "audit.sessionsSuffix_one": " e encerrou a sessão",
    "audit.sessionsSuffix_other": " e encerrou as {count} sessões",
    "audit.staffCreated": "Criou a conta de {person}",
    "audit.profile.name": "Mudou o nome de {before} para {after}",
    "audit.profile.email": "Mudou o e-mail de {after}",
    "audit.profile.both": "Mudou o nome e o e-mail de {after} (antes {before})",
    "audit.roles.both": "Mudou os perfis de {person}: deu {added} e removeu {removed}",
    "audit.roles.removed": "Removeu de {person} o perfil de {removed}",
    "audit.roles.added": "Deu a {person} o perfil de {added}",
    "audit.languages.none": "Mudou os idiomas de {person}: não fala mais nenhum idioma",
    "audit.languages.spoken": "Mudou os idiomas de {person}: agora fala {spoken}",
    "audit.team.other": "outra equipe",
    "audit.teamChanged": "Passou {person} de {before} para {after}",
    "audit.staffDeactivated": "Desativou a conta de {person}{sessions}",
    "audit.staffReactivated": "Reativou a conta de {person}",
    "audit.accountUnlocked": "Desbloqueou a conta de {person}",
    "audit.attemptsReset": "Reiniciou as tentativas de acesso de {person}",
    "audit.resetLinkSent": "Enviou a {person} um link para redefinir a senha{sessions}",
    "audit.invitationSent": "Convidou {person} por e-mail",
    "audit.invitationResent": "Reenviou o convite para {person}",
    "audit.invitationCancelled": "Cancelou o convite de {person}",
    "audit.aiEnabled": "Ativou as funções de IA",
    "audit.aiDisabled": "Desativou as funções de IA",
    "audit.teamCreated": "Criou a equipe {team}",
    "audit.teamRenamed": "Mudou o nome da equipe {before}: agora é {after}",
    "audit.teamDeactivated": "Desativou a equipe {team}",
    "audit.teamReactivated": "Reativou a equipe {team}",
    # ------------------------------------------------------------------ emails
    "duration.hours_one": "1 hora",
    "duration.hours_other": "{count} horas",
    "duration.minutes_one": "1 minuto",
    "duration.minutes_other": "{count} minutos",
    "email.invitation.subject": "Seu convite para a Plataforma CC do LATAM Bank",
    "email.invitation.body": (
        "Olá, {name}.\n\n"
        "A Administração convidou você para a Plataforma CC do LATAM Bank com o perfil de "
        "{roles} em {team}.\n\n"
        "Para ativar sua conta, abra este link, crie sua senha e configure a verificação em "
        "duas etapas com um app autenticador:\n"
        "{link}\n\n"
        "O link vence em {duration} e só pode ser usado uma vez. Ninguém do banco conhece "
        "sua senha nem vai pedi-la.\n\n"
        "Se você não esperava este convite, ignore este e-mail."
    ),
    "email.reset.subject": "Crie uma nova senha para a Plataforma CC",
    "email.reset.body": (
        "Olá, {name}.\n\n"
        "A Administração enviou um link para você criar uma nova senha. Suas sessões "
        "abertas foram encerradas.\n\n"
        "Abra este link e crie sua nova senha:\n"
        "{link}\n\n"
        "O link vence em {duration} e só pode ser usado uma vez. Sua verificação em duas "
        "etapas não muda.\n\n"
        "Se você não pediu isso, avise a Administração."
    ),
}
