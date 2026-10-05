/**
 * Namespace `audit`: Auditoría (the event log, its filters and the detail aside). Spanish is
 * the source. The event descriptions ("Qué hizo") come rendered from the server (slice 23c).
 */
export default {
  screen: {
    title: 'Auditoría',
    subtitle: 'Quién hizo qué, en qué caso y cuándo',
  },
  search: {
    label: 'Buscar',
    placeholder: 'Buscar por id de caso, cliente o persona',
  },
  filters: {
    who: 'Quién',
    kind: {
      all: 'Todos',
      staff: 'Equipo',
      customer: 'Clientes',
      system: 'Plataforma',
    },
    type: 'Tipo',
    allTypes: 'Todos los tipos',
    person: 'Persona',
    allPeople: 'Todas las personas',
    inactivePerson: '{{name}} (desactivada)',
    from: 'Desde',
    to: 'Hasta',
    rangeError: 'Debe ser el mismo día de «Desde» o uno posterior.',
    changesOnly: 'Solo acciones que cambian algo',
    caseChip: 'Caso',
    removeCase: 'Quitar el filtro del caso {{caseId}}',
  },
  /** The catalog families of the "Tipo" filter and the detail kicker. */
  families: {
    conversation: 'Conversación',
    assignment: 'Asignación',
    lifecycle: 'Ciclo del caso',
    availability: 'Disponibilidad',
    access: 'Accesos',
    administration: 'Administración',
    escalation: 'Escalamientos',
    agents: 'Agentes e IA',
    other: 'Otros',
  },
  /** Kind badges of actors that are not staff roles (those come from `shell:roles`). */
  actor: {
    customer: 'Cliente',
    system: 'Plataforma',
    assistant: 'Asistente virtual',
  },
  log: {
    region: 'Registro',
    table: 'Eventos',
    columns: {
      time: 'Hora',
      who: 'Quién',
      what: 'Qué hizo',
      case: 'Caso',
    },
    today: 'Hoy',
    yesterday: 'Ayer',
    changes: 'CAMBIO',
    shown_one: 'Mostrando {{count, number}} evento',
    shown_other: 'Mostrando {{count, number}} eventos',
    empty: 'Todavía no hay eventos.',
    emptyFiltered: 'Ningún evento coincide con estos filtros.',
    blocked: 'Corrige las fechas para ver el registro.',
    errorTitle: 'No pudimos cargar el registro',
    loadMore: 'Cargar más',
    loadMoreFailed: 'No pudimos cargar más eventos. Inténtalo de nuevo.',
  },
  detail: {
    region: 'Detalle del registro',
    pick: 'Elige un evento para ver el detalle.',
    notFound: 'No encontramos ese evento.',
    errorTitle: 'No pudimos cargar el evento',
    loading: 'Cargando el evento',
    time: 'Hora',
    who: 'Quién',
    fields: {
      event: 'Evento',
      type: 'Tipo',
      case: 'Caso',
      actor: 'Quién',
      occurred: 'Ocurrió',
      ingested: 'Registrado',
    },
    payload: 'Datos del evento',
    openConversation: 'Ver la conversación',
    filterByCase: 'Filtrar por este caso',
  },
  /** What the PII policy removed from "Datos del evento", and where it is. */
  redacted: {
    text: 'El texto del mensaje no se muestra aquí: está en la conversación.',
    comment: 'El comentario del cliente no se muestra aquí: está en el caso cerrado.',
    motive: 'El motivo del escalamiento no se muestra aquí: está en el caso y en Escalados.',
    note: 'La respuesta de supervisión no se muestra aquí: está en el caso y en Escalados.',
  },
} as const
