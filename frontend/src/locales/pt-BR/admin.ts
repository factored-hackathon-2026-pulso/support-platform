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
} satisfies Translation<typeof es>
