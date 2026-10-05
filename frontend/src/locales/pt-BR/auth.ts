import type { Translation } from '@/lib/i18n/catalog'
import type es from '../es/auth'

export default {
  login: {
    title: 'Entrar',
    subtitle: 'Seu perfil (Analista, Supervisão ou Administração) é atribuído à sua conta.',
    form: 'Entrar com e-mail',
    email: 'E-mail',
    emailPlaceholder: 'nome.sobrenome@latambank.example',
    password: 'Senha',
    forgot: 'Esqueceu?',
    forgotTitle: 'Esqueceu sua senha?',
    forgotHelp:
      'Peça à Administração um link para redefini-la: ele chega no seu e-mail e vence em 1 hora.',
    submit: 'Continuar',
    devTitle: 'Ambiente de desenvolvimento',
    devHint:
      'Use uma conta de exemplo (@latambank.example) com a senha demo1234. Dados de exemplo.',
    noteMfa: 'Depois da senha, sempre pedimos o código do seu app autenticador.',
    noteLockout:
      'Depois de {{attempts}} tentativas sem sucesso, a conta fica bloqueada por {{minutes}} minutos. Cada acesso fica registrado.',
    devMailboxLead: 'Ferramenta de desenvolvimento:',
    devMailbox: 'E-mails de desenvolvimento',
  },
  validation: {
    emailRequired: 'Digite seu e-mail.',
    emailInvalid: 'Confira o e-mail: ele deve ter o formato nome@dominio.',
    passwordRequired: 'Digite sua senha.',
  },
  failure: {
    generic: 'Não foi possível concluir o acesso. Tente de novo em alguns segundos.',
    credentials: 'O e-mail ou a senha não conferem.',
    credentialsAttempts_one:
      'O e-mail ou a senha não conferem. Resta 1 tentativa antes de a conta ser bloqueada por {{minutes}} minutos.',
    credentialsAttempts_other:
      'O e-mail ou a senha não conferem. Restam {{count}} tentativas antes de a conta ser bloqueada por {{minutes}} minutos.',
    validation: 'Confira o e-mail e a senha e tente de novo.',
    mfaInvalid: 'O código é inválido ou já venceu. Digite o código que o seu app mostra agora.',
    mfaInvalidAttempts_one:
      'O código é inválido ou já venceu. Digite o código que o seu app mostra agora. Resta 1 tentativa.',
    mfaInvalidAttempts_other:
      'O código é inválido ou já venceu. Digite o código que o seu app mostra agora. Restam {{count}} tentativas.',
    mfaExpired: 'Seu acesso expirou. Digite de novo seu e-mail e sua senha.',
  },
  mfa: {
    title: 'Confirme que é você',
    notMe: 'Não sou eu',
    instructions: 'Digite o código de 6 dígitos do seu aplicativo autenticador.',
    hint: 'O código muda a cada 30 segundos.',
    incomplete: 'Digite os {{length}} dígitos.',
    form: 'Segundo fator',
    code: 'Código de {{length}} dígitos',
    submit: 'Entrar',
    devHint:
      'Contas de exemplo: o código de teste é 000000. Se você ativou sua conta por um convite, use o código do seu app.',
  },
  locked: {
    title: 'Sua conta está bloqueada por {{minutes}} minutos',
    unlockedTitle: 'Você já pode tentar de novo',
    description: 'Houve {{attempts}} tentativas sem sucesso.',
    descriptionFor: 'Houve {{attempts}} tentativas sem sucesso para {{email}}.',
    retryAt: 'Você poderá tentar de novo às {{time}}.',
    timer: 'Faltam {{time}} para o desbloqueio',
    untilUnlock: 'para o desbloqueio',
    signInAgain: 'Entrar de novo',
    needNow: 'Precisa entrar agora?',
    help: 'Peça à Administração que desbloqueie sua conta ou envie um link para redefinir sua senha. Assim que isso for feito, você pode entrar sem esperar.',
    backToSignIn: 'Voltar para o acesso',
    notYou: 'Não foi você? Avise a Administração: alguém pode ter tentado entrar com o seu e-mail.',
    audited: 'As tentativas ficaram registradas na auditoria.',
  },
  help: {
    link: 'Problemas para entrar?',
    title: 'Peça ajuda à Administração',
    text: 'A Administração desbloqueia sua conta ou envia por e-mail um link para redefinir a senha.',
    who: 'Quem ajuda é a Administração',
  },
} satisfies Translation<typeof es>
