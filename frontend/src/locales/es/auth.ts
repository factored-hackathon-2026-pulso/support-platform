/** Namespace `auth`: signing in (Entrar, the second factor, the lockout). */
export default {
  login: {
    title: 'Entrar',
    subtitle: 'Tu rol (Analista, Supervisión o Administración) se asigna a tu cuenta.',
    form: 'Entrar con correo',
    email: 'Correo',
    emailPlaceholder: 'nombre.apellido@latambank.example',
    password: 'Contraseña',
    forgot: '¿La olvidaste?',
    forgotTitle: '¿Olvidaste tu contraseña?',
    forgotHelp:
      'Pide a Administración un enlace para restablecerla: te llega a tu correo y vence en 1 hora.',
    submit: 'Continuar',
    devTitle: 'Entorno de desarrollo',
    devHint:
      'Usa una cuenta sembrada (@latambank.example) con la contraseña demo1234. Datos de ejemplo.',
    noteMfa: 'Después de la contraseña siempre pedimos el código de tu app de autenticación.',
    noteLockout:
      'Después de {{attempts}} intentos fallidos la cuenta se bloquea {{minutes}} minutos. Cada ingreso queda registrado.',
    devMailboxLead: 'Herramienta de desarrollo:',
    devMailbox: 'Correos de desarrollo',
  },
  validation: {
    emailRequired: 'Escribe tu correo.',
    emailInvalid: 'Revisa el correo: debe tener la forma nombre@dominio.',
    passwordRequired: 'Escribe tu contraseña.',
  },
  failure: {
    generic: 'No pudimos completar el ingreso. Intenta de nuevo en unos segundos.',
    credentials: 'El correo o la contraseña no coinciden.',
    credentialsAttempts_one:
      'El correo o la contraseña no coinciden. Te queda 1 intento antes de que la cuenta se bloquee por {{minutes}} minutos.',
    credentialsAttempts_other:
      'El correo o la contraseña no coinciden. Te quedan {{count}} intentos antes de que la cuenta se bloquee por {{minutes}} minutos.',
    validation: 'Revisa el correo y la contraseña e intenta de nuevo.',
    mfaInvalid: 'El código no es válido o ya venció. Escribe el código que muestra ahora tu app.',
    mfaInvalidAttempts_one:
      'El código no es válido o ya venció. Escribe el código que muestra ahora tu app. Te queda 1 intento.',
    mfaInvalidAttempts_other:
      'El código no es válido o ya venció. Escribe el código que muestra ahora tu app. Te quedan {{count}} intentos.',
    mfaExpired: 'Tu ingreso venció. Escribe otra vez tu correo y contraseña.',
  },
  mfa: {
    title: 'Confirma que eres tú',
    notMe: 'No soy yo',
    instructions: 'Escribe el código de 6 dígitos de tu aplicación de autenticación.',
    hint: 'El código cambia cada 30 segundos.',
    incomplete: 'Escribe los {{length}} dígitos.',
    form: 'Segundo factor',
    code: 'Código de {{length}} dígitos',
    submit: 'Entrar',
    devHint:
      'Cuentas sembradas: el código de prueba es 000000. Si activaste tu cuenta con una invitación, usa el código de tu app.',
  },
  locked: {
    title: 'Tu cuenta está bloqueada por {{minutes}} minutos',
    unlockedTitle: 'Ya puedes volver a intentar',
    description: 'Hubo {{attempts}} intentos fallidos.',
    descriptionFor: 'Hubo {{attempts}} intentos fallidos para {{email}}.',
    retryAt: 'Podrás volver a intentar a las {{time}}.',
    timer: 'Faltan {{time}} para desbloquear',
    untilUnlock: 'para desbloquear',
    signInAgain: 'Volver a entrar',
    needNow: '¿Necesitas entrar ya?',
    help: 'Pide a Administración que desbloquee tu cuenta o te envíe un enlace para restablecer tu contraseña. Cuando lo haga, puedes entrar sin esperar.',
    backToSignIn: 'Volver al ingreso',
    notYou: '¿No fuiste tú? Avísale a Administración: alguien pudo intentar entrar con tu correo.',
    audited: 'Los intentos quedaron registrados en la auditoría.',
  },
  help: {
    link: '¿Problemas para entrar?',
    title: 'Pide ayuda a Administración',
    text: 'Administración desbloquea tu cuenta o te envía por correo un enlace para restablecer la contraseña.',
    who: 'Te ayuda Administración',
  },
} as const
