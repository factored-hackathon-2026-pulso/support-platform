/** Namespace `workspace`: the analyst Workspace frame ("Casos": empty states, the right panel). */
export default {
  title: 'Casos',
  loading: 'Cargando tus casos',
  pick: {
    title: 'Elige un caso de la lista',
    description: 'La conversación con el cliente aparece aquí.',
  },
  /** No open case at all; the paused variant explains why nothing arrives. */
  empty: {
    title: 'No tienes casos abiertos',
    paused:
      'Estás en pausa: no te llegan casos nuevos. Vuelve a disponible para recibir el siguiente.',
    available: 'Estás disponible. Cuando un cliente escriba y te corresponda, aparece aquí.',
  },
  customerFile: {
    title: 'Ficha del cliente',
    close: 'Cerrar la ficha del cliente',
  },
  /** The right panel with AI on and its tabs. */
  support: {
    label: 'Apoyo del caso',
    tabs: 'Apoyo',
    close: 'Cerrar el panel de apoyo',
    handoff: 'Traspaso',
    copilot: 'Copiloto',
    tools: 'Herramientas',
    customer: 'Cliente',
  },
} as const
