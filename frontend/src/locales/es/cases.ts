/**
 * Namespace `cases`: the Casos list (cards, search, the collapsed rail, availability) and the
 * shared case vocabulary every area shows (status, channel, priority, case type, close
 * reasons, ratings, SLA, escalation states), read by `features/cases/model.ts` at call time.
 */
export default {
  /** Case status: `label` is the word next to the glyph; `bucket` names the filter / tile. */
  status: {
    queued: { label: 'Sin asignar', bucket: 'Sin asignar' },
    new: { label: 'Nuevo', bucket: 'Nuevos' },
    to_reply: { label: 'Por responder', bucket: 'Por responder' },
    waiting: { label: 'Esperando al cliente', bucket: 'Esperando al cliente' },
    closed: { label: 'Cerrado', bucket: 'Cerrados' },
    /** A past case still open ("Casos anteriores"). */
    open: 'Abierto',
    /** Slice 19: the virtual assistant holds it. */
    withAssistant: 'Con el asistente',
  },
  filters: {
    all: 'Todos',
  },
  channel: {
    chat_app: 'Chat en la app',
    chat_web: 'Chat web',
    phone_inbound: 'Llamada entrante',
    phone_outbound: 'Llamada saliente',
    email: 'Correo',
    /** Accessible label of the channel fact. */
    fact: 'Canal',
  },
  /** `label`: the level as a value; `long`: with the noun, for tooltips. */
  priority: {
    none: { label: 'Sin prioridad', long: 'Sin prioridad' },
    critical: { label: 'Crítica', long: 'Prioridad crítica' },
    high: { label: 'Alta', long: 'Prioridad alta' },
    medium: { label: 'Media', long: 'Prioridad media' },
    low: { label: 'Baja', long: 'Prioridad baja' },
    menu: 'Prioridad',
    menuTrigger: 'Prioridad: {{level}}. Cambiar la prioridad',
  },
  /** The dataset's complaint subcategories; `virtual_card` is team-generated. */
  caseType: {
    none: 'Sin tipo',
    unrecognized_charge: 'Cargo no reconocido',
    undue_charge: 'Cobro indebido',
    app_issue: 'Problema con app',
    branch_service: 'Atención en sucursal',
    service_quality: 'Calidad de servicio',
    virtual_card: 'Tarjeta virtual',
    menu: 'Tipo de caso',
    menuTrigger: 'Tipo de caso: {{type}}. Cambiar el tipo de caso',
  },
  country: {
    CO: 'Colombia',
    MX: 'México',
    AR: 'Argentina',
    BR: 'Brasil',
  },
  closeReason: {
    resolved: { label: 'Resuelto', meaning: 'Se atendió lo que pidió.' },
    customer_unresponsive: {
      label: 'El cliente no respondió',
      meaning: 'Dejó de contestar y no se pudo seguir.',
    },
    duplicate: { label: 'Duplicado', meaning: 'Ya hay otro caso por lo mismo.' },
    out_of_scope: { label: 'Fuera de alcance', meaning: 'Lo que pide no lo atiende este equipo.' },
    other: { label: 'Otro', meaning: 'Cuéntalo en la nota interna.' },
    none: 'Sin motivo',
  },
  /** CSAT 1–4. */
  rating: {
    poor: 'Mal',
    fair: 'Regular',
    good: 'Bien',
    excellent: 'Excelente',
    fact: 'Calificación: {{label}}',
  },
  /** Compact time left or waited (SLA, escalations). */
  time: {
    minutes: '{{count, number}} min',
    hours: '{{count, number}} h',
    days_one: '{{count, number}} día',
    days_other: '{{count, number}} días',
  },
  sla: {
    tag: 'SLA {{time}}',
    overdueTag: 'SLA vencido',
    label: 'SLA de primera respuesta',
    overdue: 'Vencido',
    overdueTooltip: 'Primera respuesta vencida',
    atRiskTooltip: 'Vence en {{time}}',
    runningTooltip: 'Primera respuesta: vence en {{time}}',
  },
  availability: {
    paused: {
      label: 'En pausa',
      detail: 'No te llegan casos nuevos',
      accessibleName: 'En pausa. Volver a disponible',
    },
    available: {
      label: 'Disponible',
      detail: 'Te llegan casos nuevos',
      accessibleName: 'Disponible. Pausar casos nuevos',
    },
    loading: 'Estado…',
    unknown: 'Sin estado',
    failedTitle: 'No pudimos cambiar tu estado',
    failedDetail: 'Revisa tu conexión e inténtalo de nuevo.',
  },
  /** A card that continues a closed case. */
  returned: {
    label: 'Volvió a escribir',
    title: 'Escribió de nuevo después de que se cerró su caso anterior',
  },
  card: {
    callInProgress: 'Llamada en curso',
    closed: 'Cerrado',
    noMessages: 'Sin mensajes todavía',
    lastActivity: 'Última actividad',
  },
  /** Empty list per filter. */
  empty: {
    searching: 'Ningún caso coincide con tu búsqueda.',
    closed: 'No cerraste casos en los últimos 7 días.',
    to_reply: 'Ningún caso espera tu respuesta.',
    new: 'No tienes casos nuevos.',
    waiting: 'Ningún caso espera al cliente.',
    all: 'Nada pendiente.',
  },
  list: {
    region: 'Casos abiertos',
    title: 'Casos',
    collapse: 'Contraer la lista',
    collapseShort: 'Contraer',
    search: 'Buscar caso',
    searchPlaceholder: 'Buscar por cliente o número',
    filter: 'Filtro:',
    loadError: 'No pudimos cargar tus casos',
  },
  /** The collapsed list (`?list=collapsed`). */
  rail: {
    region: 'Casos, lista contraída',
    expand: 'Mostrar la lista de casos',
    expandShort: 'Mostrar casos',
    toReply: 'por responder',
  },
  escalation: {
    marker: 'Escalado',
    state: {
      open: 'Abierto',
      answered: 'Respondido',
      taken: 'Tomado',
      reassigned: 'Reasignado',
      withdrawn: 'Retirado',
      closed: 'Caso cerrado',
    },
    waited: 'Esperó',
    waitedTooltip: 'Esperó {{time}}',
    waiting: 'Espera',
    waitingTooltip: 'Espera desde hace {{time}}',
  },
} as const
