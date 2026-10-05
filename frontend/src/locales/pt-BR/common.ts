import type { Translation } from '@/lib/i18n/catalog'
import type es from '../es/common'

export default {
  appTitle: 'LATAM Bank Suporte',
  brand: {
    mark: 'CC',
    name: 'Plataforma CC',
  },
  actions: {
    retry: 'Tentar de novo',
    close: 'Fechar',
    continue: 'Continuar',
    signIn: 'Entrar',
    signOut: 'Sair',
    refresh: 'Atualizar',
    copy: 'Copiar',
    copied: 'Copiada',
    show: 'Mostrar',
    hide: 'Ocultar',
    done: 'Pronto',
  },
  loading: 'Carregando',
  withAlerts: '{{name}}, com alertas',
  withAlertsSuffix: 'com alertas',
  fields: {
    email: 'E-mail',
    team: 'Equipe',
    languages: 'Idiomas',
    role: 'Perfil',
  },
  query: {
    errorTitle: 'Não foi possível carregar estas informações',
    errorDescription: 'Verifique sua conexão e tente de novo.',
  },
  errors: {
    generic: 'Não foi possível concluir a solicitação. Tente de novo.',
    network: 'Sem conexão com o servidor. Verifique sua rede e tente de novo.',
  },
  filters: {
    button: 'Filtros',
    active: 'ativos',
    legend: 'Filtros',
    activeLegend: 'Filtros ativos',
    clear: 'Limpar filtros',
    remove: 'Remover filtro {{label}}',
  },
  codeInput: {
    digit: 'Dígito {{index}}',
  },
  toast: {
    region: 'Avisos',
    dismiss: 'Fechar aviso',
  },
} satisfies Translation<typeof es>
