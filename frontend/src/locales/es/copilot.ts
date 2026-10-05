/**
 * Namespace `copilot`: the analyst's support panel (slice 20): "Copiloto" (the Q&A thread),
 * "Herramientas", the draft above the composer, the escalation recommendation, and the AI stage
 * strip under the case header (slice 21). Spanish is the source.
 */
export default {
  /** The quiet line on top of the "Copiloto" tab: it reads, it never acts. */
  notice: 'Consulta y calcula con los datos de {{name}}. No hace cambios ni le escribe al cliente.',
  thread: {
    emptyTitle: 'Pregúntale sobre {{name}}',
    emptyText: 'Responde en unos segundos con lo que puedes ver de este cliente.',
    examples: 'Ejemplos',
    /** Starter questions of the empty thread (they only fill the box). */
    starters: {
      products: '¿Qué productos tiene y en qué estado están?',
      transactions: '¿Qué movimientos tuvo en los últimos 30 días?',
      complaints: '¿Tiene reclamos anteriores y cómo se cerraron?',
    },
    listLabel: 'Preguntas al copiloto',
    asking: 'Buscando la respuesta: suele tardar unos segundos.',
    /** Screen-reader prefix of her question. */
    you: 'Tú:',
    /** Screen-reader prefix of an answer. */
    copilot: 'Copiloto:',
    failed: 'No se pudo responder.',
    unanswered: 'Sin respuesta del copiloto',
    askAgain: 'Preguntar de nuevo',
  },
  box: {
    label: 'Pregúntale al copiloto',
    placeholder: 'Pregúntale al copiloto',
    placeholderClosed: 'El caso está cerrado',
    submit: 'Preguntar',
    hint: 'Solo tú ves estas preguntas.',
    hintClosed: 'El caso está cerrado: el copiloto ya no responde.',
    hintTooLong: 'La pregunta pasa de 2.000 caracteres.',
  },
  /** A failed question → the line under it. */
  askFailure: {
    generic: 'No se pudo responder. Inténtalo de nuevo.',
    busy: 'El copiloto todavía responde tu pregunta anterior. Reintenta en unos segundos.',
    closed: 'El caso se cerró: el copiloto ya no responde.',
    unavailable: 'El copiloto no tiene datos de este cliente.',
    disabled: 'El copiloto no está disponible ahora.',
    notAssigned: 'Este caso ya no está a tu nombre.',
    tooLong: 'La pregunta puede tener hasta 2.000 caracteres.',
    network: 'No hay conexión. Inténtalo de nuevo.',
  },
  draft: {
    editing: 'Editando el borrador del copiloto',
    inComposer: 'Borrador del copiloto en el cuadro: revísalo y envíalo',
    preparing: 'El copiloto está leyendo el caso',
    title: 'Borrador del copiloto',
    review: 'Revísalo antes de usarlo',
    stale: 'El cliente escribió después de este borrador.',
    basis: 'Lo propone con lo que leyó del caso.',
    discard: 'Descartar',
    edit: 'Editar',
    use: 'Usar',
    useHint: 'Lo pone en el cuadro para que lo envíes',
    discardFailedTitle: 'No se descartó el borrador',
    discardFailedText: 'Inténtalo de nuevo en un momento.',
  },
  escalation: {
    region: 'El copiloto recomienda escalar',
    title: 'El copiloto recomienda escalar a supervisión',
    notNow: 'Ahora no',
    review: 'Revisar y escalar',
    evidence: 'En qué se basa',
    /** agent-core's reason code (`policy:…`, `rule:…`) in words. */
    reasonPolicy: 'Una política lo pide: {{name}}',
    reasonRule: 'Una regla del copiloto lo pide: {{name}}',
    reasonFallback: 'El copiloto recomienda escalarlo',
  },
  tools: {
    intro: 'Lo que el copiloto propone mirar en este caso.',
    suggest: 'Sugerir',
    preparing: 'Preparando sugerencias: suele tardar unos segundos.',
    stale: 'El cliente escribió después de esta sugerencia. Pide otra con Sugerir.',
    emptyTitle: 'Todavía no hay herramientas para este caso',
    emptyText:
      'Aparecen cuando el copiloto ve algo que vale la pena consultar. Mientras tanto, pregúntale en Copiloto o pídele una sugerencia.',
    goToCopilot: 'Ir a Copiloto',
    readsTitle: 'Para consultar',
    readsNote: 'Solo consultan: ninguna hace cambios en la cuenta. Cada uso queda en la auditoría.',
    actionsTitle: 'Preparadas, sin ejecutar',
    actionsNote: 'El copiloto no las ejecuta. Si corresponde, hazlo tú por el flujo de siempre.',
    used: 'Consultada',
    using: 'Consultando',
    use: 'Usar',
    useLabel: 'Usar {{label}}',
    failed: 'No se pudo consultar.',
    failedLine: '{{error}} Vuelve a usarla en Copiloto.',
    empty: 'El copiloto no devolvió nada con esta herramienta.',
    viewInCopilot: 'Ver en Copiloto',
    infoOnly: 'Solo información',
    /** "Usar" on a tool: the question it asks the copilot through her thread. */
    question: 'Consulta {{label}} ({{tool}}) para este cliente y dime qué encontraste.',
  },
  /** "Sugerir" failed → the line in "Herramientas". */
  suggestFailure: {
    generic: 'No se pudo preparar la sugerencia. Inténtalo de nuevo.',
    busy: 'El copiloto ya está preparando una sugerencia. Espera unos segundos.',
    closed: 'El caso se cerró: el copiloto ya no sugiere.',
    unavailable: 'El copiloto no tiene datos de este cliente.',
    disabled: 'Las sugerencias del copiloto no están disponibles ahora.',
    notAssigned: 'Este caso ya no está a tu nombre.',
    network: 'No hay conexión. Inténtalo de nuevo.',
    /** A stored suggestion that failed on its own. */
    stored: 'El copiloto no pudo preparar la última sugerencia.',
  },
  /** The AI stage strip under the case header (slice 21). */
  stage: {
    typeLabel: 'Tipo de caso:',
    /** What the copilot does for a type at each stage. */
    text: {
      team: 'lo resuelve el equipo; el copiloto todavía no aprende de este tipo',
      answers: 'el copiloto responde lo que le preguntas',
      tools: 'el copiloto propone herramientas',
      drafts: 'el copiloto propone respuestas y deja herramientas listas',
    },
    line: 'Etapa {{stage}} de 3: {{text}}',
    agent: 'Con agente: el asistente virtual atiende este tipo y te pasa lo que no resuelve',
  },
} as const
