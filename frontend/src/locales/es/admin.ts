/** Namespace `admin`: Administración. Slice 23a migrated "Plataforma"; 23b adds the rest. */
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
} as const
