import type { Translation } from '@/lib/i18n/catalog'
import type es from '../es/workspace'

export default {
  title: 'Casos',
  loading: 'Carregando seus casos',
  pick: {
    title: 'Escolha um caso da lista',
    description: 'A conversa com o cliente aparece aqui.',
  },
  empty: {
    title: 'Você não tem casos abertos',
    paused: 'Você está em pausa: não recebe casos novos. Fique disponível para receber o próximo.',
    available:
      'Você está disponível. Quando um cliente escrever e o caso for seu, ele aparece aqui.',
  },
  customerFile: {
    title: 'Ficha do cliente',
    close: 'Fechar a ficha do cliente',
  },
  support: {
    label: 'Apoio ao caso',
    tabs: 'Apoio',
    close: 'Fechar o painel de apoio',
    handoff: 'Transferência',
    copilot: 'Copiloto',
    tools: 'Ferramentas',
    customer: 'Cliente',
  },
} satisfies Translation<typeof es>
