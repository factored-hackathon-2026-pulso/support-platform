import { useState } from 'react'
import { act, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type * as CasesApi from '@/features/cases/api'
import { fetchAvailability, fetchInbox, updateAvailability } from '@/features/cases/api'
import { CaseListPanel, type InboxStatus } from '@/features/cases'
import { ApiProblem } from '@/lib/api'
import {
  NOW,
  available,
  emptyInbox,
  makeCaseSummary,
  makeInbox,
  paused,
} from '@/test/case-fixtures'
import { analystStaff } from '@/test/fixtures'
import { renderWithProviders } from '@/test/render'

vi.mock('@/features/cases/api', async (importOriginal) => {
  const actual = await importOriginal<typeof CasesApi>()
  return {
    ...actual,
    fetchInbox: vi.fn<typeof actual.fetchInbox>(),
    fetchAvailability: vi.fn<typeof actual.fetchAvailability>(),
    updateAvailability: vi.fn<typeof actual.updateAvailability>(),
  }
})

const onSelectCase = vi.fn<(caseId: string) => void>()
const onFilterChange = vi.fn<(filter: InboxStatus | null) => void>()
const onQueryChange = vi.fn<(query: string) => void>()
const onCollapsedChange = vi.fn<(collapsed: boolean) => void>()

/** Controlled like the Workspace does it, with the callbacks spied. */
function Harness({ collapsed: initialCollapsed = false }: { collapsed?: boolean }) {
  const [selected, setSelected] = useState<string | null>('CASE-00000000000000000000000101')
  const [filter, setFilter] = useState<InboxStatus | null>(null)
  const [query, setQuery] = useState('')
  const [collapsed, setCollapsed] = useState(initialCollapsed)
  return (
    <CaseListPanel
      selectedCaseId={selected}
      filter={filter}
      query={query}
      collapsed={collapsed}
      onSelectCase={(id) => {
        onSelectCase(id)
        setSelected(id)
      }}
      onFilterChange={(next) => {
        onFilterChange(next)
        setFilter(next)
      }}
      onQueryChange={(next) => {
        onQueryChange(next)
        setQuery(next)
      }}
      onCollapsedChange={(next) => {
        onCollapsedChange(next)
        setCollapsed(next)
      }}
    />
  )
}

function renderPanel(options: { collapsed?: boolean } = {}) {
  return renderWithProviders(<Harness {...options} />, { staff: analystStaff, route: '/analista' })
}

const caseList = () => screen.getByRole('list', { name: 'Casos' })
const card = (name: RegExp | string) => within(caseList()).getByRole('button', { name })

beforeEach(() => {
  // Only Date is faked: SLA and "hace x" read the real clock, timers stay real.
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(NOW)
  vi.mocked(fetchInbox).mockResolvedValue(makeInbox())
  vi.mocked(fetchAvailability).mockResolvedValue(available)
  vi.mocked(updateAvailability).mockImplementation(async (status) => ({
    status,
    since: NOW.toISOString(),
  }))
})

afterEach(() => {
  vi.useRealTimers()
})

describe('CaseListPanel', () => {
  it('renders the title, the counters as filters and one card per status', async () => {
    renderPanel()
    expect(screen.getByRole('heading', { level: 1, name: 'Casos' })).toBeInTheDocument()
    const filters = screen.getByRole('radiogroup', { name: 'Filtrar casos' })
    await within(filters).findByRole('radio', { name: '6 Todos' })
    for (const name of [
      '2 Por responder',
      '1 En curso',
      '1 Nuevos',
      '1 Por llamar',
      '1 En espera',
    ]) {
      expect(within(filters).getByRole('radio', { name })).toBeInTheDocument()
    }
    expect(within(filters).getByRole('radio', { name: '6 Todos' })).toBeChecked()

    expect(within(caseList()).getAllByRole('button')).toHaveLength(6)
    expect(card(/Marcela Quintana Pardo, Por responder/)).toHaveAttribute('title', 'Por responder')
    expect(card(/Claudia Restrepo Varela, En llamada/)).toHaveTextContent('En llamada · 04:06')
    expect(card(/Claudia Restrepo Varela/)).toHaveTextContent('ahora')
    expect(card(/Larissa Monteiro Alves, Nuevo/)).toHaveTextContent('SLA 58 min')
    expect(card(/Héctor Villarreal Garza, Por llamar/)).toHaveTextContent(
      'Prioridad baja · Teléfono · Cargo no reconocido',
    )
    expect(card(/Héctor Villarreal Garza/)).toHaveTextContent('SLA 2 días')
    expect(card(/Joaquín Ferreyra Paz, Esperando al cliente/)).toHaveTextContent(
      'Prioridad media · App · Estado de la disputa',
    )
  })

  it('draws the status stripe and the SLA risk with tokens', async () => {
    renderPanel()
    const marcela = await screen.findByRole('button', { name: /Marcela Quintana Pardo/ })
    expect(marcela).toHaveClass('border-l-warn')
    expect(card(/Claudia Restrepo Varela/)).toHaveClass('border-l-success')
    expect(card(/Larissa Monteiro Alves/)).toHaveClass('border-l-accent')
    expect(card(/Héctor Villarreal Garza/)).toHaveClass('border-l-callout')
    expect(card(/Joaquín Ferreyra Paz/)).toHaveClass('border-l-waiting')

    expect(within(card(/Beatriz Salcedo Prieto/)).getByText('SLA 9 min')).toHaveClass('text-warn')
    expect(within(marcela).getByText('SLA 5 h')).toHaveClass('text-ink-2')
    expect(marcela).toHaveTextContent('Prioridad media · Web · Cargo no reconocido')
    expect(marcela).toHaveTextContent('hace 2 min')
  })

  it('marks the selected case and selects another one', async () => {
    const { user } = renderPanel()
    const marcela = await screen.findByRole('button', { name: /Marcela Quintana Pardo/ })
    expect(marcela).toHaveAttribute('aria-current', 'true')
    await user.click(card(/Beatriz Salcedo Prieto/))
    expect(onSelectCase).toHaveBeenCalledWith('CASE-00000000000000000000000102')
    expect(card(/Beatriz Salcedo Prieto/)).toHaveAttribute('aria-current', 'true')
    expect(marcela).not.toHaveAttribute('aria-current')
  })

  it('filters with the counters', async () => {
    const { user } = renderPanel()
    await user.click(await screen.findByRole('radio', { name: '1 Por llamar' }))
    expect(onFilterChange).toHaveBeenCalledWith('to_call')
    await waitFor(() =>
      expect(fetchInbox).toHaveBeenCalledWith({ status: 'to_call', q: '' }, expect.anything()),
    )
    expect(screen.getByRole('radio', { name: '1 Por llamar' })).toBeChecked()
  })

  it('searches by customer or case number after a pause in typing', async () => {
    const { user } = renderPanel()
    await screen.findByRole('list', { name: 'Casos' })
    await user.type(screen.getByRole('searchbox', { name: 'Buscar caso' }), ' Joaquín ')
    expect(onQueryChange).toHaveBeenLastCalledWith(' Joaquín ')
    await waitFor(() =>
      expect(fetchInbox).toHaveBeenCalledWith({ status: null, q: 'Joaquín' }, expect.anything()),
    )
    expect(screen.getByRole('searchbox', { name: 'Buscar caso' })).toHaveAttribute(
      'placeholder',
      'Buscar por cliente o número',
    )
  })

  it('shows "Nada pendiente." when the filter has no cases', async () => {
    vi.mocked(fetchInbox).mockResolvedValue(emptyInbox)
    renderPanel()
    expect(await screen.findByText('Nada pendiente.')).toBeInTheDocument()
    expect(screen.getByRole('radio', { name: '0 Todos' })).toBeInTheDocument()
  })

  it('says when a search matches nothing', async () => {
    vi.mocked(fetchInbox).mockImplementation(async ({ q }) => (q ? emptyInbox : makeInbox()))
    const { user } = renderPanel()
    await screen.findByRole('list', { name: 'Casos' })
    await user.type(screen.getByRole('searchbox', { name: 'Buscar caso' }), 'Zuleta')
    expect(await screen.findByText('Ningún caso coincide con tu búsqueda.')).toBeInTheDocument()
  })

  it('shows skeletons and placeholder counters while loading', async () => {
    vi.mocked(fetchInbox).mockReturnValue(new Promise(() => {}))
    const { container } = renderPanel()
    expect(container.querySelector('[aria-busy="true"]')).toBeInTheDocument()
    expect(screen.getByRole('radio', { name: '– Todos' })).toBeInTheDocument()
    expect(screen.queryByRole('list', { name: 'Casos' })).not.toBeInTheDocument()
  })

  it('shows the error with a retry', async () => {
    vi.mocked(fetchInbox).mockRejectedValueOnce(ApiProblem.network())
    const { user } = renderPanel()
    const list = screen.getByRole('region', { name: 'Casos abiertos' })
    const alert = await within(list).findByRole('alert')
    expect(alert).toHaveTextContent('No pudimos cargar tus casos')
    await user.click(within(alert).getByRole('button', { name: 'Reintentar' }))
    expect(await screen.findByRole('list', { name: 'Casos' })).toBeInTheDocument()
  })

  it('pauses from the availability pill', async () => {
    const { user } = renderPanel()
    const pill = await screen.findByRole('button', { name: /^Disponible/ })
    expect(screen.queryByText('En pausa · no te llegan casos nuevos')).not.toBeInTheDocument()
    await user.click(pill)
    expect(updateAvailability).toHaveBeenCalledWith('paused')
    expect(await screen.findByRole('button', { name: /^En pausa/ })).toBeInTheDocument()
    expect(screen.getByText('En pausa · no te llegan casos nuevos')).toBeInTheDocument()
  })

  it('shows the paused banner and goes back to available', async () => {
    vi.mocked(fetchAvailability).mockResolvedValue(paused)
    const { user } = renderPanel()
    expect(await screen.findByText('En pausa · no te llegan casos nuevos')).toBeInTheDocument()
    expect(screen.getByText('Los que ya tienes siguen contigo.')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Volver a disponible' }))
    expect(updateAvailability).toHaveBeenCalledWith('available')
    await waitFor(() =>
      expect(screen.queryByText('En pausa · no te llegan casos nuevos')).not.toBeInTheDocument(),
    )
    expect(screen.getByRole('button', { name: /^Disponible/ })).toBeInTheDocument()
  })

  it('rolls the pill back and tells the analyst when the change fails', async () => {
    vi.mocked(updateAvailability).mockRejectedValue(ApiProblem.network())
    const { user } = renderPanel()
    await user.click(await screen.findByRole('button', { name: /^Disponible/ }))
    expect(await screen.findByText('No pudimos cambiar tu estado')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /^Disponible/ })).toBeInTheDocument()
  })

  it('collapses to a rail of initials and expands again', async () => {
    const { user } = renderPanel()
    await user.click(await screen.findByRole('button', { name: 'Contraer la lista' }))
    expect(onCollapsedChange).toHaveBeenCalledWith(true)

    const rail = screen.getByRole('region', { name: 'Casos, lista contraída' })
    expect(within(rail).getByRole('heading', { level: 1, name: 'Casos' })).toBeInTheDocument()
    expect(within(rail).getByText('por responder').parentElement).toHaveTextContent(
      '2 por responder',
    )
    const marcela = within(rail).getByRole('button', {
      name: 'Marcela Quintana Pardo, Por responder',
    })
    expect(marcela).toHaveTextContent('MQ')
    expect(marcela).toHaveClass('border-warn')
    expect(marcela).toHaveAttribute('aria-current', 'true')
    expect(
      within(rail).getByRole('button', { name: 'Joaquín Ferreyra Paz, Esperando al cliente' }),
    ).toHaveClass('border-waiting')

    await user.click(within(rail).getByRole('button', { name: 'Larissa Monteiro Alves, Nuevo' }))
    expect(onSelectCase).toHaveBeenCalledWith('CASE-00000000000000000000000103')

    await user.click(within(rail).getByRole('button', { name: 'Mostrar la lista de casos' }))
    expect(onCollapsedChange).toHaveBeenLastCalledWith(false)
    expect(screen.getByRole('region', { name: 'Casos abiertos' })).toBeInTheDocument()
  })

  it('toasts a newly assigned case and opens it from the toast', async () => {
    const { user, sockets } = renderPanel()
    await screen.findByRole('list', { name: 'Casos' })
    const socket = sockets.last()
    expect(socket).toBeDefined()
    const fresh = makeCaseSummary({
      id: 'CASE-00000000000000000000009001',
      customer: { id: 'CUS-00000000000000000000002004', displayName: 'Rafael Nogueira Costa' },
      status: 'assigned',
      inboxStatus: 'new',
      version: 1,
    })
    const envelope = {
      type: 'case.assigned',
      id: 'EVT-ASSIGNED-1',
      occurredAt: NOW.toISOString(),
      data: { entity: 'case', entityId: fresh.id, caseId: fresh.id, actor: null, payload: fresh },
    }
    act(() => {
      socket?.open()
      socket?.receive(envelope)
      socket?.receive(envelope)
    })
    expect(await screen.findByText('Te llegó un caso nuevo')).toBeInTheDocument()
    expect(screen.getAllByText('Te llegó un caso nuevo')).toHaveLength(1)
    expect(screen.getByText('Rafael Nogueira Costa')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Ver caso' }))
    expect(onSelectCase).toHaveBeenCalledWith('CASE-00000000000000000000009001')
  })

  it('refetches the inbox when the socket comes back', async () => {
    const { sockets } = renderPanel()
    await screen.findByRole('list', { name: 'Casos' })
    const first = sockets.last()
    act(() => first?.open())
    const callsBefore = vi.mocked(fetchInbox).mock.calls.length
    act(() => first?.serverClose(1006))
    await waitFor(() => expect(sockets.sockets.length).toBeGreaterThan(1), { timeout: 3000 })
    act(() => sockets.last()?.open())
    await waitFor(() =>
      expect(vi.mocked(fetchInbox).mock.calls.length).toBeGreaterThan(callsBefore),
    )
  })
})
