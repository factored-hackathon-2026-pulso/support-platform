/**
 * Namespace `common`: words every area shares (actions, loading, generic errors) and the
 * copy of the design-system primitives (`components/ui`). In the entry chunk.
 */
export default {
  appTitle: 'LATAM Bank Soporte',
  brand: {
    mark: 'CC',
    name: 'Plataforma CC',
  },
  actions: {
    retry: 'Reintentar',
    close: 'Cerrar',
    continue: 'Continuar',
    signIn: 'Entrar',
    signOut: 'Cerrar sesión',
    refresh: 'Actualizar',
    copy: 'Copiar',
    copied: 'Copiada',
    show: 'Mostrar',
    hide: 'Ocultar',
    done: 'Listo',
  },
  loading: 'Cargando',
  /** Accessible name of a control with an alert dot. */
  withAlerts: '{{name}}, con alertas',
  withAlertsSuffix: 'con alertas',
  fields: {
    email: 'Correo',
    team: 'Equipo',
    languages: 'Idiomas',
    role: 'Rol',
  },
  query: {
    errorTitle: 'No pudimos cargar esta información',
    errorDescription: 'Revisa tu conexión e inténtalo de nuevo.',
  },
  errors: {
    generic: 'No pudimos completar la solicitud. Intenta de nuevo.',
    network: 'No hay conexión con el servidor. Revisa tu red e intenta de nuevo.',
  },
  filters: {
    button: 'Filtros',
    active: 'activos',
    legend: 'Filtros',
    activeLegend: 'Filtros activos',
    clear: 'Limpiar filtros',
    remove: 'Quitar filtro {{label}}',
  },
  codeInput: {
    digit: 'Dígito {{index}}',
  },
  toast: {
    region: 'Avisos',
    dismiss: 'Cerrar aviso',
  },
} as const
