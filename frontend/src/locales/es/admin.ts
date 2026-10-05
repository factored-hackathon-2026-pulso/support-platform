/**
 * Namespace `admin`: Administración ("Usuarios y roles", "Equipos", "Plataforma"). Shared
 * words come from `common` (actions, fields, filters) and `shell` (role and screen names).
 */
export default {
  platform: {
    title: 'Plataforma',
    subtitle: 'Ajustes para todo el equipo',
    aiTitle: 'Funciones de IA',
    aiDescription:
      'Asistente, copiloto y tipos de caso. Apagadas, la plataforma atiende solo con personas.',
    installationValue: 'Valor de la instalación',
    someone: 'Alguien',
    lastChange: 'Último cambio',
    when: 'Cuándo',
    engineMissing: 'El motor de IA no está conectado',
    engineMissingText: 'Mientras tanto, la plataforma sigue atendiendo solo con personas.',
    onTitle: 'Funciones de IA encendidas',
    onText: 'Todos lo ven en este momento.',
    offTitle: 'Funciones de IA apagadas',
    offText: 'La plataforma atiende solo con personas.',
    failedTitle: 'No pudimos cambiar las funciones de IA',
    failedForbidden: 'Ya no tienes el rol de Administración.',
    failedNetwork: 'Revisa tu conexión e inténtalo de nuevo.',
    failedOther: 'Inténtalo de nuevo.',
  },

  /** Words several screens of the area share. */
  actions: {
    cancel: 'Cancelar',
    seeInAudit: 'Ver en auditoría',
  },
  /** Second line of the role checkbox cards. */
  roleDescription: {
    analyst: 'Atiende casos por chat con los clientes.',
    supervisor:
      'Ve las colas y el equipo, atiende escalamientos, reasigna casos y revisa la auditoría.',
    admin: 'Invita y edita cuentas, roles, idiomas y equipos.',
  },
  /** A language inside a sentence ("4 en español"). */
  languageInSentence: {
    es: 'español',
    pt: 'portugués',
  },
  /** Account status words (they qualify "cuenta"). */
  accountStatus: {
    active: 'Activa',
    locked: 'Bloqueada',
    invited: 'Invitación pendiente',
    inactive: 'Desactivada',
    cancelled: 'Invitación cancelada',
  },
  /** Team status words (they qualify "equipo"). */
  teamStatus: {
    active: 'Activo',
    inactive: 'Inactivo',
  },
  /** The "Estado" options of the Equipos "Filtros" dropdown. */
  teamStates: {
    active: 'Activos',
    inactive: 'Inactivos',
  },
  teamOptionInactive: '{{name}} (inactivo)',
  lockedUntil: 'Hasta las {{time}}',
  statusCallout: {
    lockedTitle: 'Cuenta bloqueada',
    lockedText_one: '{{count, number}} intento fallido. Se desbloquea sola a las {{time}}.',
    lockedText_other: '{{count, number}} intentos fallidos. Se desbloquea sola a las {{time}}.',
    inactiveTitle: 'Cuenta desactivada',
    inactiveText: 'No puede ingresar.',
  },
  /** "Casos abiertos": "5 (4 en español y 1 en portugués)". */
  openCases: {
    part: '{{value, number}} en {{language}}',
    total: '{{value, number}} ({{parts}})',
  },
  noLanguages: 'Sin idiomas',
  filters: {
    status: 'Estado',
    language: 'Idioma',
  },

  users: {
    subtitle: 'Quién puede hacer qué en la plataforma',
    subtitleCount_one: '{{count, number}} persona en la plataforma',
    subtitleCount_other: '{{count, number}} personas en la plataforma',
    count_one: '{{count, number}} persona',
    count_other: '{{count, number}} personas',
    shown_one: '{{shown, number}} de {{count, number}} persona',
    shown_other: '{{shown, number}} de {{count, number}} personas',
    create: 'Nuevo usuario',
    search: 'Buscar persona',
    searchPlaceholder: 'Buscar por nombre, correo o id',
    table: 'Personas',
    loadError: 'No pudimos cargar las personas',
    emptyFiltered: 'Nadie coincide con estos filtros.',
    empty: 'Todavía no hay personas.',
    columns: {
      person: 'Persona',
      roles: 'Roles',
      account: 'Cuenta',
    },
    source: 'Personas, roles, idiomas y equipos: directorio de la plataforma (datos de ejemplo).',
  },

  teams: {
    subtitle: 'Cómo se agrupan las personas en la plataforma',
    subtitleCount_one: '{{count, number}} equipo en la plataforma',
    subtitleCount_other: '{{count, number}} equipos en la plataforma',
    count_one: '{{count, number}} equipo',
    count_other: '{{count, number}} equipos',
    shown_one: '{{shown, number}} de {{count, number}} equipo',
    shown_other: '{{shown, number}} de {{count, number}} equipos',
    create: 'Nuevo equipo',
    loadError: 'No pudimos cargar los equipos',
    empty: 'No hay equipos en este estado.',
    columns: {
      people: 'Personas',
      analysts: 'Analistas',
      status: 'Estado',
    },
    source: 'Equipos y personas: directorio de la plataforma (datos de ejemplo).',
  },

  /** The person form (edit aside and "Nuevo usuario"). */
  form: {
    name: 'Nombre completo',
    roles: 'Roles',
    teamPlaceholder: 'Elige un equipo',
    rolesNote:
      'Los cambios de rol se aplican de inmediato: la persona ve su menú actualizado sin volver a ingresar.',
    languagesHint:
      'Quien atiende casos necesita al menos un idioma. Los casos en portugués solo llegan a quien lo habla (regla 3).',
    uiLanguage: 'Idioma de la plataforma',
    uiLanguageHint:
      'La invitación llega en este idioma y la plataforma se abre así. Después se cambia desde el menú de la cuenta.',
  },
  fieldError: {
    name: 'Escribe el nombre completo (al menos 2 caracteres).',
    email: 'Escribe un correo válido, como nombre@latambank.example.',
    roles: 'Elige al menos un rol.',
    languages: 'Quien atiende casos necesita al menos un idioma.',
    teamId: 'Elige un equipo.',
  },
  teamNameError: 'Escribe un nombre de al menos 2 caracteres.',

  /** Guard rails (self changes, the last admin, open cases). */
  guards: {
    removeOwnAdmin: 'No puedes quitarte tu propio rol de Administración.',
    deactivateSelf: 'No puedes desactivar tu propia cuenta.',
    resetOwnPassword:
      'Pídele a otra persona de Administración que te envíe un enlace para restablecer tu contraseña.',
    lastAdmin: 'Es la única persona activa con Administración.',
    removeAnalyst_one:
      'Tiene {{count, number}} caso abierto: supervisión tiene que reasignarlos antes de quitarle el rol de Analista.',
    removeAnalyst_other:
      'Tiene {{count, number}} casos abiertos: supervisión tiene que reasignarlos antes de quitarle el rol de Analista.',
    removeLanguage_one:
      'Tiene {{count, number}} caso abierto en {{language}}: supervisión tiene que reasignarlos antes de quitarle ese idioma.',
    removeLanguage_other:
      'Tiene {{count, number}} casos abiertos en {{language}}: supervisión tiene que reasignarlos antes de quitarle ese idioma.',
    deactivateTitle: 'Primero hay que reasignar sus casos',
    deactivateText_one:
      'Tiene {{count, number}} caso abierto. Supervisión los reasigna desde Equipo.',
    deactivateText_other:
      'Tiene {{count, number}} casos abiertos. Supervisión los reasigna desde Equipo.',
  },

  /** Problem codes → what the person reads (contract §10.4). */
  failure: {
    generic: 'No pudimos guardar los cambios. Inténtalo de nuevo.',
    versionConflictUser:
      'Alguien más cambió a esta persona mientras editabas. Cargamos los datos actuales: revisa y vuelve a guardar.',
    versionConflictTeam:
      'Alguien más cambió este equipo mientras editabas. Cargamos los datos actuales: revisa y vuelve a guardar.',
    emailTaken: 'Ya existe una cuenta con ese correo.',
    teamNameTaken: 'Ya existe un equipo con ese nombre.',
    lastAdmin: 'Debe quedar al menos una persona activa con Administración.',
    openCasesDeactivate_one:
      'Tiene {{count, number}} caso abierto. Supervisión tiene que reasignarlos antes de desactivar la cuenta.',
    openCasesDeactivate_other:
      'Tiene {{count, number}} casos abiertos. Supervisión tiene que reasignarlos antes de desactivar la cuenta.',
    teamNotEmpty_one: 'Para desactivarlo, primero mueve a su persona a otro equipo.',
    teamNotEmpty_other:
      'Para desactivarlo, primero mueve a sus {{count, number}} personas a otro equipo.',
    teamInactive: 'Ese equipo está desactivado. Elige otro.',
    staffInactive: 'Esta cuenta está desactivada. Reactívala primero.',
    staffInvited: 'Esta persona todavía no activó su cuenta. Reenvía la invitación.',
    invalidTransition: 'Esta persona ya no tiene una invitación pendiente.',
  },

  toast: {
    deactivatedTitle: 'Cuenta desactivada',
    deactivatedText: '{{name}} ya no puede ingresar.',
    deactivatedSessions_one: '{{name}} ya no puede ingresar. Se cerró su sesión.',
    deactivatedSessions_other:
      '{{name}} ya no puede ingresar. Se cerraron sus {{count, number}} sesiones.',
    reactivatedTitle: 'Cuenta reactivada',
    reactivatedText: '{{name}} puede volver a ingresar con su contraseña. Empieza En pausa.',
    unlockedTitle: 'Cuenta desbloqueada',
    unlockedText: '{{name}} ya puede volver a intentar ingresar.',
    notLocked: 'La cuenta ya no estaba bloqueada.',
    resentTitle: 'Invitación reenviada',
    resentText:
      'Le enviamos un enlace nuevo a {{email}}. Vence en {{hours}} horas y el anterior ya no funciona.',
    cancelledTitle: 'Invitación cancelada',
    cancelledText: 'El enlace que recibió {{name}} ya no funciona.',
    resetSentTitle: 'Enlace enviado',
    resetSentText:
      'Le enviamos a {{email}} un enlace para crear una contraseña nueva. Sus sesiones abiertas se cerraron.',
    saved: 'Cambios guardados',
    idCopied: 'Id copiado',
    moved: '{{name}} pasó a {{team}}',
    teamRenamed: 'Nombre guardado',
    teamReactivated: 'Equipo reactivado',
    teamDeactivated: 'Equipo desactivado',
  },

  invitation: {
    infoTitle: 'Le llega una invitación por correo',
    infoText:
      'Con el enlace crea su contraseña y configura la verificación en dos pasos. Nadie más ve su contraseña. El enlace vence en {{hours}} horas.',
    sentTitle: 'Invitación enviada',
    sentTo: 'Invitación enviada a <strong>{{email}}</strong>.',
    expiry: 'El enlace vence en {{hours}} horas.',
    steps: {
      password: 'Crea su propia contraseña',
      mfa: 'Configura la verificación en dos pasos',
      active: 'Su cuenta queda activa y empieza En pausa',
    },
    sentFootnote:
      'Mientras tanto aparece como Invitación pendiente. Puedes reenviarla o cancelarla desde su ficha.',
    send: 'Enviar invitación',
    /** "en 45 h" / "hace 3 h" (an invitation lives 48 hours). */
    spanFuture: 'en {{hours}} h',
    spanPast: 'hace {{hours}} h',
    sent: 'Invitación enviada',
    expired: 'Venció',
    expires: 'Vence',
  },

  /** The selected person's aside. */
  person: {
    none: 'Elige una persona para ver y editar su cuenta.',
    notFound: 'No encontramos a esa persona.',
    loadError: 'No pudimos cargar a esta persona',
    loading: 'Cargando la persona',
    aside: 'Persona seleccionada',
    copyId: 'Copiar id de la persona',
    form: 'Cuenta de {{name}}',
    unlock: 'Desbloquear',
    reactivate: 'Reactivar cuenta',
    expiredTitle: 'La invitación venció',
    expiredText: 'El enlace ya no funciona. Reenvíala para enviarle uno nuevo.',
    cancelledTitle: 'Invitación cancelada',
    cancelledText: 'Para invitarle de nuevo, usa Nuevo usuario con el mismo correo.',
    stale:
      'Alguien más acaba de cambiar a esta persona. Si guardas, revisaremos que no choquen tus cambios.',
    save: 'Guardar cambios',
    resend: 'Reenviar invitación',
    cancelInvitation: 'Cancelar invitación',
    sendReset: 'Enviar enlace para restablecer',
    deactivate: 'Desactivar cuenta',
    facts: {
      lastLogin: 'Último ingreso',
      never: 'Nunca',
      now: 'Ahora',
      available: 'Disponible',
      paused: 'En pausa',
      openCases: 'Casos abiertos',
      secondFactor: 'Verificación en dos pasos',
      created: 'Cuenta creada',
    },
    secondFactor: {
      totp: 'App de autenticación',
      devCode: 'Código de desarrollo',
    },
  },

  resetDialog: {
    title: '¿Enviar a {{name}} un enlace para restablecer su contraseña?',
    email:
      'Le llega un correo a {{email}} con un enlace para crear una contraseña nueva. Vence en 1 hora.',
    unlocks: 'Si la cuenta estaba bloqueada, se desbloquea.',
    nobodySees: 'Nadie del equipo ve la contraseña nueva.',
    confirm: 'Enviar enlace',
  },
  /** A consequence two dialogs list (reset link, deactivation). */
  sessionsEndNow: 'Se cierran sus sesiones abiertas ahora.',
  cancelDialog: {
    title: '¿Cancelar la invitación de {{name}}?',
    text: 'El enlace que le enviamos deja de funcionar y la cuenta no se crea. Si hace falta, puedes invitarle de nuevo.',
    back: 'Volver',
  },
  deactivateDialog: {
    title: '¿Desactivar la cuenta de {{name}}?',
    noSignIn: 'No podrá ingresar.',
    noCases: 'Deja de recibir casos y queda En pausa.',
    historyKept: 'Su historial y la auditoría se conservan.',
    openTeam: 'Ver en Equipo',
  },

  /** The selected team's aside and its dialogs. */
  team: {
    none: 'Elige un equipo para ver sus personas.',
    notFound: 'No encontramos ese equipo.',
    loadError: 'No pudimos cargar el equipo',
    loading: 'Cargando el equipo',
    aside: 'Equipo seleccionado',
    status: 'Estado',
    created: 'Creado el {{date}}',
    nameLabel: 'Nombre del equipo',
    saveName: 'Guardar nombre',
    members: 'Personas ({{total, number}})',
    addMember: 'Agregar persona',
    noMembers: 'Este equipo no tiene personas.',
    deactivate: 'Desactivar equipo',
    reactivate: 'Reactivar equipo',
    createName: 'Nombre',
    createSubmit: 'Crear equipo',
    deactivateTitle: '¿Desactivar el equipo {{name}}?',
    deactivateText: 'Ya no se podrá mover a nadie a este equipo. Su historial se conserva.',
    addTitle: 'Agregar a {{team}}',
    addSubmit: 'Mover a {{team}}',
    addField: 'Persona',
    addPlaceholder: 'Elige a una persona',
    addPick: 'Elige a quién mover.',
    addMove: 'Pasa de {{from}} a {{to}}.',
    addLoadError: 'No pudimos cargar las personas. Inténtalo de nuevo.',
  },
} as const
