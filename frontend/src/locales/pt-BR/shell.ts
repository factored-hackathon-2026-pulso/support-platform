import type { Translation } from '@/lib/i18n/catalog'
import type es from '../es/shell'

export default {
  rail: {
    label: 'Principal',
    withNews: '{{label}}, com novidades',
    pending_one: '{{label}}, {{count, number}} pendente',
    pending_other: '{{label}}, {{count, number}} pendentes',
    queued_one: '{{label}}, {{count, number}} sem responsável',
    queued_other: '{{label}}, {{count, number}} sem responsável',
    escalations_one: '{{label}}, {{count, number}} aberto',
    escalations_other: '{{label}}, {{count, number}} abertos',
  },
  roles: {
    analyst: { name: 'Analista', switcher: 'Analista de casos' },
    supervisor: { name: 'Supervisão', switcher: 'Supervisão' },
    admin: { name: 'Administração', switcher: 'Administração' },
  },
  nav: {
    home: 'Início',
    cases: 'Casos',
    queues: 'Filas',
    team: 'Equipe',
    escalations: 'Escalados',
    audit: 'Auditoria',
    users: 'Usuários e perfis',
    teams: 'Equipes',
    platform: 'Plataforma',
  },
  presence: {
    paused: 'Status: Em pausa',
    available: 'Status: Disponível',
  },
  accountMenu: {
    open: '{{name}}, trocar de perfil',
    switchRole: 'Trocar de perfil',
    language: 'Idioma da plataforma',
    languageFailed: 'Não foi possível salvar o idioma',
    languageFailedDetail: 'Verifique sua conexão e tente de novo.',
  },
  rolesChanged: {
    title: 'Seus perfis mudaram',
    description: 'Agora você tem: {{roles}}.',
  },
  session: {
    loading: 'Carregando sua sessão',
    unavailableTab: 'Sem conexão',
    unavailableTitle: 'Não foi possível carregar sua sessão',
    unavailableText:
      'A plataforma não está respondendo no momento. Sua sessão continua aberta: tente de novo em alguns segundos.',
    noRoleTab: 'Sem perfil atribuído',
    noRoleTitle: 'Sua conta não tem um perfil atribuído',
    noRoleText:
      'Peça à Administração que atribua um perfil a você (Analista, Supervisão ou Administração).',
  },
  routeError: {
    notFoundTab: 'Página não encontrada',
    errorTab: 'Erro',
    notFoundTitle: 'Não encontramos esta página',
    errorTitle: 'Algo deu errado nesta tela',
    notFoundText: 'Confira o endereço ou volte ao início.',
    errorText: 'O restante da plataforma continua funcionando. Tente carregá-la de novo.',
    goHome: 'Ir para o início',
  },
  loadingScreen: 'Carregando a tela',
  loadingPage: 'Carregando a página',
  notFound: {
    title: 'Página não encontrada',
    heading: 'Este endereço não existe',
    text: 'Talvez o link esteja incompleto ou a tela tenha mudado de lugar.',
    goTo: 'Ir para {{place}}',
  },
  placeholder: {
    title: 'Em construção',
    text: 'Esta tela já foi desenhada e chega em uma próxima entrega.',
  },
  authPanel: {
    tagline: 'Atendimento ao cliente por chat, do início ao fim.',
    region: 'Central de atendimento do LATAM Bank no México, na Colômbia e na Argentina',
    notice: 'Uso exclusivo da equipe autorizada do banco.',
  },
} satisfies Translation<typeof es>
