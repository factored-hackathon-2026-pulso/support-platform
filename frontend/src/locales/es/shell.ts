/**
 * Namespace `shell`: the frame of the staff app (rail, account menu, role names, session
 * screens, route errors, the sign-in brand panel). In the entry chunk.
 */
export default {
  rail: {
    label: 'Principal',
    withNews: '{{label}}, con novedades',
    pending_one: '{{label}}, {{count, number}} pendiente',
    pending_other: '{{label}}, {{count, number}} pendientes',
    queued_one: '{{label}}, {{count, number}} sin asignar',
    queued_other: '{{label}}, {{count, number}} sin asignar',
    escalations_one: '{{label}}, {{count, number}} abierto',
    escalations_other: '{{label}}, {{count, number}} abiertos',
  },
  /** Role names: `name` in sentences, chips and toasts; `switcher` in the account menu. */
  roles: {
    analyst: { name: 'Analista', switcher: 'Analista de casos' },
    supervisor: { name: 'Supervisión', switcher: 'Supervisión' },
    admin: { name: 'Administración', switcher: 'Administración' },
  },
  nav: {
    home: 'Inicio',
    cases: 'Casos',
    queues: 'Colas',
    team: 'Equipo',
    escalations: 'Escalados',
    automation: 'Automatización',
    audit: 'Auditoría',
    users: 'Usuarios y roles',
    teams: 'Equipos',
    platform: 'Plataforma',
  },
  presence: {
    paused: 'Estado: En pausa',
    available: 'Estado: Disponible',
  },
  accountMenu: {
    open: '{{name}}, cambiar de rol',
    switchRole: 'Cambiar de rol',
    language: 'Idioma de la plataforma',
    languageFailed: 'No pudimos guardar el idioma',
    languageFailedDetail: 'Revisa tu conexión e inténtalo de nuevo.',
  },
  rolesChanged: {
    title: 'Cambiaron tus roles',
    description: 'Ahora tienes: {{roles}}.',
  },
  session: {
    loading: 'Cargando tu sesión',
    unavailableTab: 'Sin conexión',
    unavailableTitle: 'No pudimos cargar tu sesión',
    unavailableText:
      'La plataforma no responde en este momento. Tu sesión sigue abierta: intenta de nuevo en unos segundos.',
    noRoleTab: 'Sin rol asignado',
    noRoleTitle: 'Tu cuenta no tiene un rol asignado',
    noRoleText:
      'Pide a Administración que te asigne un rol (Analista, Supervisión o Administración).',
  },
  routeError: {
    notFoundTab: 'Página no encontrada',
    errorTab: 'Error',
    notFoundTitle: 'No encontramos esta página',
    errorTitle: 'Algo salió mal en esta pantalla',
    notFoundText: 'Revisa la dirección o vuelve al inicio.',
    errorText: 'El resto de la plataforma sigue funcionando. Intenta cargarla de nuevo.',
    goHome: 'Ir al inicio',
  },
  loadingScreen: 'Cargando la pantalla',
  loadingPage: 'Cargando la página',
  notFound: {
    title: 'Página no encontrada',
    heading: 'Esta dirección no existe',
    text: 'Puede que el enlace esté incompleto o que la pantalla haya cambiado de lugar.',
    goTo: 'Ir a {{place}}',
  },
  placeholder: {
    title: 'En construcción',
    text: 'Esta pantalla ya está diseñada y llega en una próxima entrega.',
  },
  authPanel: {
    tagline: 'Atención al cliente por chat, de principio a fin.',
    region: 'Contact center de LATAM Bank en México, Colombia y Argentina',
    notice: 'Uso exclusivo del personal autorizado del banco.',
  },
} as const
