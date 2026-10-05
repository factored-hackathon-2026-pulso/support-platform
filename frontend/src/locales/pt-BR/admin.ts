import type { Translation } from '@/lib/i18n/catalog'
import type es from '../es/admin'

export default {
  platform: {
    title: 'Plataforma',
    subtitle: 'Ajustes para toda a equipe',
    aiTitle: 'Funções de IA',
    aiDescription:
      'Assistente, copiloto e tipos de caso. Desligadas, a plataforma atende só com pessoas.',
    installationValue: 'Valor da instalação',
    someone: 'Alguém',
    lastChange: 'Última alteração',
    when: 'Quando',
    engineMissing: 'O motor de IA não está conectado',
    engineMissingText: 'Enquanto isso, a plataforma continua atendendo só com pessoas.',
    onTitle: 'Funções de IA ligadas',
    onText: 'Todos já estão vendo a mudança.',
    offTitle: 'Funções de IA desligadas',
    offText: 'A plataforma atende só com pessoas.',
    failedTitle: 'Não foi possível alterar as funções de IA',
    failedForbidden: 'Você não tem mais o perfil de Administração.',
    failedNetwork: 'Verifique sua conexão e tente de novo.',
    failedOther: 'Tente de novo.',
  },

  actions: {
    cancel: 'Cancelar',
    seeInAudit: 'Ver na auditoria',
  },
  roleDescription: {
    analyst: 'Atende casos por chat com os clientes.',
    supervisor:
      'Vê as filas e a equipe, trata os escalonamentos, reatribui casos e revisa a auditoria.',
    admin: 'Convida e edita contas, perfis, idiomas e equipes.',
  },
  languageInSentence: {
    es: 'espanhol',
    pt: 'português',
  },
  accountStatus: {
    active: 'Ativa',
    locked: 'Bloqueada',
    invited: 'Convite pendente',
    inactive: 'Desativada',
    cancelled: 'Convite cancelado',
  },
  teamStatus: {
    active: 'Ativa',
    inactive: 'Inativa',
  },
  teamStates: {
    active: 'Ativas',
    inactive: 'Inativas',
  },
  teamOptionInactive: '{{name}} (inativa)',
  lockedUntil: 'Até as {{time}}',
  statusCallout: {
    lockedTitle: 'Conta bloqueada',
    lockedText_one:
      '{{count, number}} tentativa sem sucesso. A conta se desbloqueia sozinha às {{time}}.',
    lockedText_other:
      '{{count, number}} tentativas sem sucesso. A conta se desbloqueia sozinha às {{time}}.',
    inactiveTitle: 'Conta desativada',
    inactiveText: 'Não consegue entrar.',
  },
  openCases: {
    part: '{{value, number}} em {{language}}',
    total: '{{value, number}} ({{parts}})',
  },
  noLanguages: 'Sem idiomas',
  filters: {
    status: 'Status',
    language: 'Idioma',
  },

  users: {
    subtitle: 'Quem pode fazer o quê na plataforma',
    subtitleCount_one: '{{count, number}} pessoa na plataforma',
    subtitleCount_other: '{{count, number}} pessoas na plataforma',
    count_one: '{{count, number}} pessoa',
    count_other: '{{count, number}} pessoas',
    shown_one: '{{shown, number}} de {{count, number}} pessoa',
    shown_other: '{{shown, number}} de {{count, number}} pessoas',
    create: 'Novo usuário',
    search: 'Buscar pessoa',
    searchPlaceholder: 'Buscar por nome, e-mail ou id',
    table: 'Pessoas',
    loadError: 'Não foi possível carregar as pessoas',
    emptyFiltered: 'Ninguém corresponde a estes filtros.',
    empty: 'Ainda não há pessoas.',
    columns: {
      person: 'Pessoa',
      roles: 'Perfis',
      account: 'Conta',
    },
    source: 'Pessoas, perfis, idiomas e equipes: diretório da plataforma (dados de exemplo).',
  },

  teams: {
    subtitle: 'Como as pessoas se agrupam na plataforma',
    subtitleCount_one: '{{count, number}} equipe na plataforma',
    subtitleCount_other: '{{count, number}} equipes na plataforma',
    count_one: '{{count, number}} equipe',
    count_other: '{{count, number}} equipes',
    shown_one: '{{shown, number}} de {{count, number}} equipe',
    shown_other: '{{shown, number}} de {{count, number}} equipes',
    create: 'Nova equipe',
    loadError: 'Não foi possível carregar as equipes',
    empty: 'Não há equipes neste status.',
    columns: {
      people: 'Pessoas',
      analysts: 'Analistas',
      status: 'Status',
    },
    source: 'Equipes e pessoas: diretório da plataforma (dados de exemplo).',
  },

  form: {
    name: 'Nome completo',
    roles: 'Perfis',
    teamPlaceholder: 'Escolha uma equipe',
    rolesNote:
      'As mudanças de perfil valem na hora: a pessoa vê o menu atualizado sem precisar entrar de novo.',
    languagesHint:
      'Quem atende casos precisa de pelo menos um idioma. Os casos em português só chegam a quem fala o idioma (regra 3).',
    uiLanguage: 'Idioma da plataforma',
    uiLanguageHint:
      'O convite chega neste idioma e a plataforma abre assim. Depois dá para mudar no menu da conta.',
  },
  fieldError: {
    name: 'Digite o nome completo (pelo menos 2 caracteres).',
    email: 'Digite um e-mail válido, como nome@latambank.example.',
    roles: 'Escolha pelo menos um perfil.',
    languages: 'Quem atende casos precisa de pelo menos um idioma.',
    teamId: 'Escolha uma equipe.',
  },
  teamNameError: 'Digite um nome com pelo menos 2 caracteres.',

  guards: {
    removeOwnAdmin: 'Você não pode remover o seu próprio perfil de Administração.',
    deactivateSelf: 'Você não pode desativar a sua própria conta.',
    resetOwnPassword:
      'Peça a outra pessoa da Administração que envie a você um link para redefinir sua senha.',
    lastAdmin: 'É a única pessoa ativa com Administração.',
    removeAnalyst_one:
      'Tem {{count, number}} caso aberto: a supervisão precisa reatribuí-lo antes de remover o perfil de Analista.',
    removeAnalyst_other:
      'Tem {{count, number}} casos abertos: a supervisão precisa reatribuí-los antes de remover o perfil de Analista.',
    removeLanguage_one:
      'Tem {{count, number}} caso aberto em {{language}}: a supervisão precisa reatribuí-lo antes de remover esse idioma.',
    removeLanguage_other:
      'Tem {{count, number}} casos abertos em {{language}}: a supervisão precisa reatribuí-los antes de remover esse idioma.',
    deactivateTitle: 'Primeiro é preciso reatribuir os casos',
    deactivateText_one: 'Tem {{count, number}} caso aberto. A Supervisão o reatribui em Equipe.',
    deactivateText_other:
      'Tem {{count, number}} casos abertos. A Supervisão os reatribui em Equipe.',
  },

  failure: {
    generic: 'Não foi possível salvar as alterações. Tente de novo.',
    versionConflictUser:
      'Outra pessoa alterou este cadastro enquanto você editava. Carregamos os dados atuais: revise e salve de novo.',
    versionConflictTeam:
      'Outra pessoa alterou esta equipe enquanto você editava. Carregamos os dados atuais: revise e salve de novo.',
    emailTaken: 'Já existe uma conta com esse e-mail.',
    teamNameTaken: 'Já existe uma equipe com esse nome.',
    lastAdmin: 'É preciso manter pelo menos uma pessoa ativa com Administração.',
    openCasesDeactivate_one:
      'Tem {{count, number}} caso aberto. A Supervisão precisa reatribuí-lo antes de desativar a conta.',
    openCasesDeactivate_other:
      'Tem {{count, number}} casos abertos. A Supervisão precisa reatribuí-los antes de desativar a conta.',
    teamNotEmpty_one: 'Para desativá-la, primeiro mova a pessoa desta equipe para outra.',
    teamNotEmpty_other:
      'Para desativá-la, primeiro mova as {{count, number}} pessoas desta equipe para outra.',
    teamInactive: 'Essa equipe está desativada. Escolha outra.',
    staffInactive: 'Esta conta está desativada. Reative-a primeiro.',
    staffInvited: 'Esta pessoa ainda não ativou a conta. Reenvie o convite.',
    invalidTransition: 'Esta pessoa não tem mais um convite pendente.',
  },

  toast: {
    deactivatedTitle: 'Conta desativada',
    deactivatedText: '{{name}} não consegue mais entrar.',
    deactivatedSessions_one: '{{name}} não consegue mais entrar. A sessão aberta foi encerrada.',
    deactivatedSessions_other:
      '{{name}} não consegue mais entrar. As {{count, number}} sessões abertas foram encerradas.',
    reactivatedTitle: 'Conta reativada',
    reactivatedText: '{{name}} pode entrar de novo com a própria senha. Começa Em pausa.',
    unlockedTitle: 'Conta desbloqueada',
    unlockedText: '{{name}} já pode tentar entrar de novo.',
    notLocked: 'A conta já não estava bloqueada.',
    resentTitle: 'Convite reenviado',
    resentText:
      'Enviamos um novo link para {{email}}. Ele vence em {{hours}} horas e o anterior não funciona mais.',
    cancelledTitle: 'Convite cancelado',
    cancelledText: 'O link que {{name}} recebeu não funciona mais.',
    resetSentTitle: 'Link enviado',
    resetSentText:
      'Enviamos para {{email}} um link para criar uma nova senha. As sessões abertas foram encerradas.',
    saved: 'Alterações salvas',
    idCopied: 'Id copiado',
    moved: '{{name}} foi para {{team}}',
    teamRenamed: 'Nome salvo',
    teamReactivated: 'Equipe reativada',
    teamDeactivated: 'Equipe desativada',
  },

  invitation: {
    infoTitle: 'A pessoa recebe um convite por e-mail',
    infoText:
      'Com o link, ela cria a própria senha e configura a verificação em duas etapas. Ninguém mais vê a senha. O link vence em {{hours}} horas.',
    sentTitle: 'Convite enviado',
    sentTo: 'Convite enviado para <strong>{{email}}</strong>.',
    expiry: 'O link vence em {{hours}} horas.',
    steps: {
      password: 'Cria a própria senha',
      mfa: 'Configura a verificação em duas etapas',
      active: 'A conta fica ativa e começa Em pausa',
    },
    sentFootnote:
      'Enquanto isso, aparece como Convite pendente. Você pode reenviar ou cancelar o convite na ficha da pessoa.',
    send: 'Enviar convite',
    spanFuture: 'em {{hours}} h',
    spanPast: 'há {{hours}} h',
    sent: 'Convite enviado',
    expired: 'Venceu',
    expires: 'Vence',
  },

  person: {
    none: 'Escolha uma pessoa para ver e editar a conta dela.',
    notFound: 'Não encontramos essa pessoa.',
    loadError: 'Não foi possível carregar esta pessoa',
    loading: 'Carregando a pessoa',
    aside: 'Pessoa selecionada',
    copyId: 'Copiar id da pessoa',
    form: 'Conta de {{name}}',
    unlock: 'Desbloquear',
    reactivate: 'Reativar conta',
    expiredTitle: 'O convite venceu',
    expiredText: 'O link não funciona mais. Reenvie o convite para mandar um novo.',
    cancelledTitle: 'Convite cancelado',
    cancelledText: 'Para convidar de novo, use Novo usuário com o mesmo e-mail.',
    stale:
      'Outra pessoa acabou de alterar este cadastro. Se você salvar, vamos conferir se as alterações não entram em conflito.',
    save: 'Salvar alterações',
    resend: 'Reenviar convite',
    cancelInvitation: 'Cancelar convite',
    sendReset: 'Enviar link de redefinição',
    deactivate: 'Desativar conta',
    facts: {
      lastLogin: 'Último acesso',
      never: 'Nunca',
      now: 'Agora',
      available: 'Disponível',
      paused: 'Em pausa',
      openCases: 'Casos abertos',
      secondFactor: 'Verificação em duas etapas',
      created: 'Conta criada',
    },
    secondFactor: {
      totp: 'App autenticador',
      devCode: 'Código de desenvolvimento',
    },
  },

  resetDialog: {
    title: 'Enviar para {{name}} um link para redefinir a senha?',
    email:
      'Chega um e-mail para {{email}} com um link para criar uma nova senha. Ele vence em 1 hora.',
    unlocks: 'Se a conta estava bloqueada, ela é desbloqueada.',
    nobodySees: 'Ninguém da equipe vê a nova senha.',
    confirm: 'Enviar link',
  },
  sessionsEndNow: 'As sessões abertas são encerradas agora.',
  cancelDialog: {
    title: 'Cancelar o convite de {{name}}?',
    text: 'O link que enviamos deixa de funcionar e a conta não é criada. Se precisar, você pode convidar de novo.',
    back: 'Voltar',
  },
  deactivateDialog: {
    title: 'Desativar a conta de {{name}}?',
    noSignIn: 'Não vai conseguir entrar.',
    noCases: 'Deixa de receber casos e fica Em pausa.',
    historyKept: 'O histórico e a auditoria são mantidos.',
    openTeam: 'Ver em Equipe',
  },

  team: {
    none: 'Escolha uma equipe para ver as pessoas dela.',
    notFound: 'Não encontramos essa equipe.',
    loadError: 'Não foi possível carregar a equipe',
    loading: 'Carregando a equipe',
    aside: 'Equipe selecionada',
    status: 'Status',
    created: 'Criada em {{date}}',
    nameLabel: 'Nome da equipe',
    saveName: 'Salvar nome',
    members: 'Pessoas ({{total, number}})',
    addMember: 'Adicionar pessoa',
    noMembers: 'Esta equipe não tem pessoas.',
    deactivate: 'Desativar equipe',
    reactivate: 'Reativar equipe',
    createName: 'Nome',
    createSubmit: 'Criar equipe',
    deactivateTitle: 'Desativar a equipe {{name}}?',
    deactivateText: 'Ninguém mais poderá ser movido para esta equipe. O histórico é mantido.',
    addTitle: 'Adicionar a {{team}}',
    addSubmit: 'Mover para {{team}}',
    addField: 'Pessoa',
    addPlaceholder: 'Escolha uma pessoa',
    addPick: 'Escolha quem mover.',
    addMove: 'Sai de {{from}} e vai para {{to}}.',
    addLoadError: 'Não foi possível carregar as pessoas. Tente de novo.',
  },
} satisfies Translation<typeof es>
