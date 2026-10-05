import { screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type * as CasesApi from '@/features/cases/api'
import { fetchAvailability, fetchInbox, updateAvailability } from '@/features/cases/api'
import { ApiProblem } from '@/lib/api'
import { NOW, emptyInbox, makeInbox, paused } from '@/test/case-fixtures'
import { analystStaff } from '@/test/fixtures'
import { makeActivityItem, makeHome } from '@/test/home-fixtures'
import { renderRoute } from '@/test/render'
import type * as HomeApi from '../api'
import { fetchHome } from '../api'

// Inicio in Portuguese (slice 23). The Spanish screen is covered by routes/analyst/home.test.tsx;
// words owned by the cases area (status names, close reasons) are not asserted here.

vi.mock('@/features/cases/api', async (importOriginal) => {
  const actual = await importOriginal<typeof CasesApi>()
  return {
    ...actual,
    fetchInbox: vi.fn<typeof actual.fetchInbox>(),
    fetchAvailability: vi.fn<typeof actual.fetchAvailability>(),
    updateAvailability: vi.fn<typeof actual.updateAvailability>(),
  }
})

vi.mock('../api', async (importOriginal) => {
  const actual = await importOriginal<typeof HomeApi>()
  return { ...actual, fetchHome: vi.fn<typeof actual.fetchHome>() }
})

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(NOW)
  vi.mocked(fetchInbox).mockResolvedValue(makeInbox())
  vi.mocked(fetchAvailability).mockResolvedValue(paused)
  vi.mocked(updateAvailability).mockImplementation(async (status) => ({
    status,
    since: NOW.toISOString(),
  }))
  vi.mocked(fetchHome).mockResolvedValue(makeHome())
})

afterEach(() => {
  vi.useRealTimers()
})

const renderHome = (options: { aiEnabled?: boolean } = {}) =>
  renderRoute('/analyst/home', { staff: analystStaff, locale: 'pt-BR', ...options })

describe('/analyst/home (Início) in Portuguese', () => {
  it('greets her, and "Começar a atender" makes her available', async () => {
    const { user } = renderHome()
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Bom dia, Daniela' }),
    ).toBeInTheDocument()
    expect(screen.getByText('Quinta-feira, 5 de março')).toBeInTheDocument()
    expect(document.title).toBe('Início · LATAM Bank Suporte')
    const block = screen.getByRole('region', { name: 'Sua disponibilidade' })
    expect(await within(block).findByText('Você está em pausa')).toBeInTheDocument()
    expect(within(block).getByText('Sem casos novos')).toBeInTheDocument()
    expect(await within(block).findByText('5 casos abertos')).toBeInTheDocument()
    expect(within(block).getByRole('link', { name: 'Ir para Casos' })).toBeInTheDocument()
    await user.click(within(block).getByRole('button', { name: 'Começar a atender' }))
    expect(updateAvailability).toHaveBeenCalledWith('available')
    expect(await within(block).findByText('Você está disponível')).toBeInTheDocument()
    expect(within(block).getByText('Você recebe casos novos')).toBeInTheDocument()
    expect(within(block).getByRole('button', { name: 'Pausar casos novos' })).toBeInTheDocument()
  })

  it('names the tiles and "Prioridades" in pt-BR', async () => {
    renderHome()
    const tiles = await screen.findByRole('navigation', { name: 'Seus casos por status' })
    const links = await within(tiles).findAllByRole('link', { name: /Ver em Casos$/ })
    expect(links).toHaveLength(4)
    expect(links[3]).toHaveAccessibleName(/^3 .+, últimos 7 dias\. Ver em Casos$/)
    expect(within(tiles).getByText('Últimos 7 dias')).toBeInTheDocument()
    const first = screen.getByRole('region', { name: 'Prioridades' })
    expect(within(first).getByText('Ordenado pelo que vence antes')).toBeInTheDocument()
    const list = await within(first).findByRole('list', { name: 'Casos por urgência' })
    expect(
      within(list).getByRole('link', { name: 'Abrir o caso de Beatriz Salcedo Prieto' }),
    ).toHaveTextContent('Abrir')
  })

  it('tells "Enquanto você estava fora" with its fixed templates and expands it', async () => {
    const { user } = renderHome()
    const feed = await screen.findByRole('region', { name: 'Enquanto você estava fora' })
    await within(feed).findByText('Você saiu')
    expect(within(feed).getByText('hoje 10:20')).toBeInTheDocument()
    const list = within(feed).getByRole('list', { name: 'Enquanto você estava fora' })
    expect(
      within(list).getByRole('link', { name: /^Marcela Quintana Pardo: Não é mais seu\./ }),
    ).toHaveAccessibleName(
      'Marcela Quintana Pardo: Não é mais seu. Reatribuiu: Lucía Herrera, Agora atendido por: Sebastián Cárdenas, Somente leitura, há 6 min. Abrir em somente leitura',
    )
    const arrival = within(list).getByRole('link', {
      name: /^Larissa Monteiro Alves: Chegou para você\./,
    })
    expect(arrival).toHaveTextContent(/Por idioma: PortuguêsPT.*Regra 3/)
    await user.click(within(feed).getByRole('button', { name: 'Ver tudo (5)' }))
    expect(within(list).getByText('Esperou 17 min')).toBeInTheDocument()
    expect(within(feed).getByRole('button', { name: 'Ver menos' })).toHaveAttribute(
      'aria-expanded',
      'true',
    )
  })

  it('shows "Sua equipe agora" with counts only', async () => {
    renderHome()
    const team = await screen.findByRole('region', { name: 'Sua equipe agora' })
    await within(team).findByText('Disponíveis')
    expect(team).toHaveTextContent('Disponíveis0 de 4')
    expect(team).toHaveTextContent(/Aguardam na fila2O mais antigo: há 17 min/)
    expect(team).toHaveTextContent(
      'Ao começar, a fila dos seus idiomas é distribuída primeiro para você.',
    )
  })

  it('with AI on, sums up the assistant in pt-BR', async () => {
    vi.mocked(fetchHome).mockResolvedValue(
      makeHome({
        assistant: { resolved: 9, handedToYou: 1, withAssistantNow: 3 },
        activity: {
          items: [
            makeActivityItem({
              kind: 'assigned_by_assistant',
              customerName: 'Natalia Guzmán Rincón',
              reason: 'assistant_handoff',
            }),
          ],
          total: 1,
        },
      }),
    )
    renderHome({ aiEnabled: true })
    const feed = await screen.findByRole('region', { name: 'Enquanto você estava fora' })
    expect(await within(feed).findByText('Assistente virtual')).toBeInTheDocument()
    expect(feed).toHaveTextContent('Resolveu 9 conversas dos seus idiomas e passou 1 para você')
    expect(
      within(feed).getByRole('link', {
        name: /^Natalia Guzmán Rincón: O assistente passou para você\./,
      }),
    ).toBeInTheDocument()
    expect(screen.getByRole('region', { name: 'Sua equipe agora' })).toHaveTextContent(
      'Com o assistente agora3',
    )
  })

  it('says she has no open cases, nothing new, and the 8-hour fallback', async () => {
    vi.mocked(fetchInbox).mockResolvedValue(emptyInbox)
    vi.mocked(fetchHome).mockResolvedValue(
      makeHome({ sinceSource: 'fallback', activity: { items: [], total: 0 } }),
    )
    renderHome()
    const first = await screen.findByRole('region', { name: 'Prioridades' })
    expect(
      await within(first).findByRole('heading', { name: 'Você não tem casos abertos' }),
    ).toBeInTheDocument()
    expect(first).toHaveTextContent(
      'Quando você começar a atender, os casos que chegarem aparecem aqui.',
    )
    const feed = screen.getByRole('region', { name: 'Enquanto você estava fora' })
    expect(
      await within(feed).findByText('Nada de novo desde sua última sessão'),
    ).toBeInTheDocument()
    expect(within(feed).getByText('Últimas 8 horas')).toBeInTheDocument()
  })

  it('shows the errors in pt-BR with a retry', async () => {
    vi.mocked(fetchHome).mockRejectedValueOnce(ApiProblem.network())
    vi.mocked(fetchInbox).mockRejectedValue(ApiProblem.network())
    const { user } = renderHome()
    const feed = await screen.findByRole('region', { name: 'Enquanto você estava fora' })
    await waitFor(() => expect(fetchHome).toHaveBeenCalled())
    const alert = await within(feed).findByRole('alert')
    expect(alert).toHaveTextContent('Não foi possível carregar o que aconteceu')
    expect(alert).toHaveTextContent('Verifique sua conexão e tente de novo.')
    expect(screen.getByRole('region', { name: 'Sua equipe agora' })).toHaveTextContent(
      'Sem dados da equipe por enquanto.',
    )
    const first = screen.getByRole('region', { name: 'Prioridades' })
    expect(await within(first).findByRole('alert')).toHaveTextContent(
      'Não foi possível carregar seus casos',
    )
    await user.click(within(alert).getByRole('button', { name: 'Tentar de novo' }))
    expect(await within(feed).findByText('Voltou a escrever')).toBeInTheDocument()
  })
})
