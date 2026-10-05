/**
 * Namespace `notifications`: the rail bell, its panel and the live toasts. The API sends
 * structured facts only (`kind`, who, which case): every word of a notification is a fixed
 * template here (people-only, gender-neutral roles: "Supervisión"). Spanish is the source.
 */
export default {
  /** The primary action of each kind. */
  actions: {
    openCase: 'Abrir caso',
    viewCase: 'Ver caso',
    review: 'Revisar',
    viewInQueue: 'Ver en la cola',
    viewUsers: 'Ver usuarios',
  },
  /** Stand-ins when the API has no name. */
  someone: 'Alguien del equipo',
  aCustomer: 'Un cliente',
  /** The title and the one line of each kind. */
  kinds: {
    assigned: 'Te llegó un caso nuevo',
    assignedBySupervisor: 'Supervisión te asignó un caso',
    reassignedAway: 'Supervisión reasignó tu caso',
    customerReturned: 'El cliente volvió a escribir',
    escalationAnswered: 'Supervisión respondió tu escalamiento',
    escalationAnsweredDetail: '{{actor}} sobre {{customer}}',
    escalationTaken: 'Supervisión tomó tu caso',
    escalationReassigned: 'Supervisión reasignó tu caso escalado',
    passedTo: '{{customer}} pasó a {{name}}',
    caseRated: 'El cliente calificó tu atención: {{rating}}',
    caseEscalated: '{{actor}} escaló un caso',
    caseQueued: 'Un caso espera en la cola en {{language}}',
    slaAtRisk: 'Caso por vencer sin respuesta',
    accountLocked: 'Cuenta bloqueada: {{name}}',
    failedAttempts_one: '{{count, number}} intento fallido al entrar',
    failedAttempts_other: '{{count, number}} intentos fallidos al entrar',
    invitationAccepted: 'Invitación aceptada: {{name}}',
    invitationAcceptedDetail: 'Ya puede entrar a la plataforma',
  },
  /** The SLA line of "Caso por vencer sin respuesta". */
  sla: {
    answered: '{{name}}, ya tiene respuesta',
    overdue: '{{name}}, vencido',
    dueIn: '{{name}}, vence en {{minutes}} min',
  },
  /** When it arrived; from a day on, the date. */
  time: {
    now: 'ahora',
    minutes: 'hace {{minutes}} min',
    hours: 'hace {{hours}} h',
  },
  bell: {
    label: 'Notificaciones',
    unread_one: 'Notificaciones, {{count, number}} sin leer',
    unread_other: 'Notificaciones, {{count, number}} sin leer',
  },
  panel: {
    heading: 'Notificaciones',
    markAllRead: 'Marcar todas como leídas',
    close: 'Cerrar notificaciones',
    loading: 'Cargando notificaciones',
    errorTitle: 'No pudimos cargar tus notificaciones',
    errorText: 'Revisa tu conexión.',
    loadMore: 'Cargar más',
    sections: {
      new: 'Nuevas',
      earlier: 'Anteriores',
    },
    upToDateTitle: 'Estás al día',
    upToDateText: 'No tienes notificaciones nuevas.',
  },
  item: {
    markRead: 'Marcar como leída',
    unread: 'Sin leer',
  },
  toast: {
    later: 'Más tarde',
  },
} as const
