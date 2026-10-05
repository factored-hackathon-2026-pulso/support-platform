import type { Translation } from '@/lib/i18n/catalog'
import type es from '../es/notifications'

export default {
  actions: {
    openCase: 'Abrir caso',
    viewCase: 'Ver caso',
    review: 'Revisar',
    viewInQueue: 'Ver na fila',
    viewUsers: 'Ver usuários',
  },
  someone: 'Alguém da equipe',
  aCustomer: 'Um cliente',
  kinds: {
    assigned: 'Você recebeu um caso novo',
    assignedBySupervisor: 'Supervisão atribuiu um caso a você',
    reassignedAway: 'Supervisão reatribuiu seu caso',
    customerReturned: 'O cliente voltou a escrever',
    escalationAnswered: 'Supervisão respondeu seu escalonamento',
    escalationAnsweredDetail: '{{actor}} sobre {{customer}}',
    escalationTaken: 'Supervisão assumiu seu caso',
    escalationReassigned: 'Supervisão reatribuiu seu caso escalado',
    passedTo: '{{customer}} passou para {{name}}',
    caseRated: 'O cliente avaliou seu atendimento: {{rating}}',
    caseEscalated: '{{actor}} escalou um caso',
    caseQueued: 'Um caso aguarda na fila em {{language}}',
    slaAtRisk: 'Caso prestes a vencer sem resposta',
    accountLocked: 'Conta bloqueada: {{name}}',
    failedAttempts_one: '{{count, number}} tentativa malsucedida de entrar',
    failedAttempts_other: '{{count, number}} tentativas malsucedidas de entrar',
    invitationAccepted: 'Convite aceito: {{name}}',
    invitationAcceptedDetail: 'Já pode entrar na plataforma',
  },
  sla: {
    answered: '{{name}}, já tem resposta',
    overdue: '{{name}}, vencido',
    dueIn: '{{name}}, vence em {{minutes}} min',
  },
  time: {
    now: 'agora',
    minutes: 'há {{minutes}} min',
    hours: 'há {{hours}} h',
  },
  bell: {
    label: 'Notificações',
    unread_one: 'Notificações, {{count, number}} não lida',
    unread_other: 'Notificações, {{count, number}} não lidas',
  },
  panel: {
    heading: 'Notificações',
    markAllRead: 'Marcar todas como lidas',
    close: 'Fechar notificações',
    loading: 'Carregando notificações',
    errorTitle: 'Não foi possível carregar suas notificações',
    errorText: 'Verifique sua conexão.',
    loadMore: 'Carregar mais',
    sections: {
      new: 'Novas',
      earlier: 'Anteriores',
    },
    upToDateTitle: 'Você está em dia',
    upToDateText: 'Você não tem notificações novas.',
  },
  item: {
    markRead: 'Marcar como lida',
    unread: 'Não lida',
  },
  toast: {
    later: 'Mais tarde',
  },
} satisfies Translation<typeof es>
