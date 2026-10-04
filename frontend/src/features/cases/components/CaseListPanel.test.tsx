import { useState } from 'react'
import { act, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type * as CasesApi from '@/features/cases/api'
import { fetchAvailability, fetchInbox, updateAvailability } from '@/features/cases/api'
import { CaseListPanel, type CaseSummary, type InboxStatus } from '@/features/cases'
import { ApiProblem } from '@/lib/api'
import {
  NOW,
  available,
  closedInbox,
  emptyInbox,
  makeCaseSummary,
  makeInbox,
  paused,
  seededInbox,
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
function Harness({
  collapsed: initialCollapsed = false,
  filter: initialFilter = null,
}: {
  collapsed?: boolean
  filter?: InboxStatus | null
}) {
  const [selected, setSelected] = useState<string | null>('CASE-00000000000000000000000101')
  const [filter, setFilter] = useState<InboxStatus | null>(initialFilter)
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

function renderPanel(options: { collapsed?: boolean; filter?: InboxStatus | null } = {}) {
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
  it('renders the title and one flat list of the open cases in urgency order, no tiles', async () => {
    renderPanel()
    expect(screen.getByRole('heading', { level: 1, name: 'Casos' })).toBeInTheDocument()
    await screen.findByRole('list', { name: 'Casos' })
    expect(screen.queryByRole('radiogroup', { name: 'Filtrar casos' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^Quitar filtro/ })).not.toBeInTheDocument()

    // SLA at risk (Beatriz), the nearest SLA (Patricia, then Larissa), answered and
    // waiting for her (Marcela), waiting for the customer last (Joaquín).
    expect(
      within(caseList())
        .getAllByRole('button')
        .map((button) => button.querySelector('span span')?.textContent),
    ).toEqual([
      'Beatriz Salcedo Prieto',
      'Patricia Lozano Vega',
      'Larissa Monteiro Alves',
      'Marcela Quintana Pardo',
      'Joaquín Ferreyra Paz',
    ])
    // Separate elements, never a dot-joined line: the status (glyph + word), the channel
    // (icon-only, its name for screen readers), the time.
    const marcela = card(/Marcela Quintana Pardo/)
    expect(marcela).toHaveAttribute('title', 'Por responder')
    expect(within(marcela).getByText('Por responder').parentElement).toHaveClass('text-warn-strong')
    expect(
      within(marcela).getByText('Por responder').parentElement!.querySelector('svg'),
    ).toHaveAttribute('data-status-shape', 'pie-75')
    expect(within(marcela).getByText('Por responder')).not.toHaveClass('bg-warn-soft')
    expect(within(marcela).getByText('Canal: Web')).toHaveClass('sr-only')
    expect(marcela).toHaveTextContent('Última actividad: hace 2 min')
    expect(marcela.textContent).not.toContain('·')
    expect(marcela).not.toHaveTextContent('Prioridad media') // only a high priority shows
    expect(card(/Larissa Monteiro Alves/)).toHaveTextContent('SLA de primera respuesta: 13 min')
    expect(
      within(card(/Larissa Monteiro Alves/))
        .getByText('Nuevo')
        .parentElement!.querySelector('svg'),
    ).toHaveAttribute('data-status-shape', 'ring')
    expect(
      within(card(/Joaquín Ferreyra Paz/)).getByText('Esperando al cliente'),
    ).toBeInTheDocument()
    expect(within(card(/Joaquín Ferreyra Paz/)).getByText('Canal: App')).toBeInTheDocument()
  })

  it('shows the first-response SLA only while the first reply is pending', async () => {
    renderPanel()
    const beatriz = await screen.findByRole('button', { name: /Beatriz Salcedo Prieto/ })
    // The shared SLA levels: at risk = flame in warn, running = clock in muted; the
    // value stays visible, "SLA" is in the accessible text and the tooltip.
    const atRisk = within(beatriz).getByText('3 min', { selector: 'span.truncate' })
    expect(atRisk.parentElement).toHaveClass('text-warn')
    expect(atRisk.parentElement?.querySelector('svg')).toHaveClass('lucide-flame')
    expect(beatriz).toHaveTextContent('SLA de primera respuesta: 3 min')
    expect(beatriz).toHaveTextContent('Vence en 3 min') // tooltip
    const running = within(card(/Larissa Monteiro Alves/)).getByText('13 min', {
      selector: 'span.truncate',
    })
    expect(running.parentElement).toHaveClass('text-muted')
    expect(running.parentElement?.querySelector('svg')).toHaveClass('lucide-clock')
    // Marcela and Joaquín already got a first answer: no SLA tag.
    expect(card(/Marcela Quintana Pardo/)).not.toHaveTextContent(/SLA/)
    expect(card(/Joaquín Ferreyra Paz/)).not.toHaveTextContent(/SLA/)
    expect(card(/Marcela Quintana Pardo/).querySelector('.lucide-flame')).toBeNull()
  })

  it('draws the status stripe with tokens and tags a customer who wrote again', async () => {
    renderPanel()
    const marcela = await screen.findByRole('button', { name: /Marcela Quintana Pardo/ })
    expect(marcela).toHaveClass('border-l-warn')
    expect(card(/Larissa Monteiro Alves/)).toHaveClass('border-l-accent')
    expect(card(/Joaquín Ferreyra Paz/)).toHaveClass('border-l-waiting')
    expect(marcela).toHaveTextContent('hace 2 min')

    // "Volvió a escribir": icon-only with a tooltip, its text for screen readers.
    const patricia = card(/Patricia Lozano Vega/)
    expect(
      within(patricia).getByText('Volvió a escribir', { selector: '.sr-only' }),
    ).toBeInTheDocument()
    expect(patricia).toHaveAccessibleName(/Volvió a escribir/)
    expect(within(marcela).queryAllByText('Volvió a escribir')).toHaveLength(0)
  })

  it('lists the closed cases of the last 7 days in Cerrados (from Inicio or the URL)', async () => {
    vi.mocked(fetchInbox).mockImplementation(async ({ status }) =>
      status === 'closed' ? makeInbox(closedInbox) : makeInbox(),
    )
    renderPanel({ filter: 'closed' })
    await screen.findByRole('list', { name: 'Casos' })
    const hector = await within(caseList()).findByRole('button', {
      name: /Héctor Villarreal Garza/,
    })
    expect(hector).toHaveAttribute('title', 'Cerrado')
    // The most recent close first (server order), not the urgency order.
    expect(within(caseList()).getAllByRole('button')[0]).toBe(hector)
    expect(within(caseList()).getAllByRole('button')).toHaveLength(3)
    expect(hector).toHaveClass('border-l-offline')
    expect(hector).toHaveTextContent('Cerrado: hace 3 h')
    expect(within(hector).getByText('Cerrado').parentElement!.querySelector('svg')).toHaveAttribute(
      'data-status-shape',
      'check',
    )
    expect(hector).toHaveTextContent('Fuera de alcance')
    expect(hector.querySelector('[data-reason="out_of_scope"]')).toHaveClass('bg-warn-soft')
    expect(hector).not.toHaveTextContent(/SLA/)
    expect(card(/Claudia Restrepo Varela/)).toHaveTextContent('El cliente no respondió')
    expect(card(/Patricia Lozano Vega/)).toHaveTextContent('Resuelto')
    expect(card(/Patricia Lozano Vega/)).toHaveTextContent('hace 2 días')
  })

  it("shows the customer's rating on a Cerrados card as a face with its name (slice 7)", async () => {
    vi.mocked(fetchInbox).mockImplementation(async ({ status }) =>
      status === 'closed' ? makeInbox(closedInbox) : makeInbox(),
    )
    renderPanel({ filter: 'closed' })
    const hector = await within(await screen.findByRole('list', { name: 'Casos' })).findByRole(
      'button',
      { name: /Héctor Villarreal Garza/ },
    )
    // Icon-only and secondary: its name is in the card's name; slice 8: the tooltip says
    // "Calificación: Bien" too (the face alone on the card, no word).
    expect(hector).toHaveAccessibleName(/Calificación: Bien/)
    const named = within(hector).getAllByText('Calificación: Bien')
    expect(named.map((node) => node.className.includes('sr-only'))).toEqual([true, false])
    expect(named[1]).toHaveAttribute('aria-hidden', 'true')
    expect(hector.querySelector('.lucide-smile')).not.toBeNull()
    expect(card(/Patricia Lozano Vega/)).toHaveAccessibleName(/Calificación: Excelente/)
    expect(card(/Patricia Lozano Vega/).querySelector('.lucide-laugh')).not.toBeNull()
    // Unrated: nothing (no "Sin calificar" on the card).
    const claudia = card(/Claudia Restrepo Varela/)
    expect(claudia).not.toHaveAccessibleName(/Calificación/)
    // Never a dot-joined line.
    expect(hector.textContent).not.toContain('·')
  })

  it('flags a high or critical priority with its glyph, icon-only (slice 8)', async () => {
    const inbox = makeInbox()
    const levels: Record<string, CaseSummary['priority']> = {
      'Marcela Quintana Pardo': 'critical',
      'Beatriz Salcedo Prieto': 'high',
      'Joaquín Ferreyra Paz': 'medium',
    }
    vi.mocked(fetchInbox).mockResolvedValue({
      ...inbox,
      items: inbox.items.map((item) => ({
        ...item,
        priority: levels[item.customer.displayName] ?? 'none',
      })),
    })
    renderPanel()
    const marcela = await within(await screen.findByRole('list', { name: 'Casos' })).findByRole(
      'button',
      { name: /Marcela Quintana Pardo/ },
    )
    expect(marcela).toHaveAccessibleName(/Prioridad crítica/)
    expect(marcela.querySelector('svg[data-priority="critical"]')).not.toBeNull()
    const beatriz = card(/Beatriz Salcedo Prieto/)
    expect(beatriz).toHaveAccessibleName(/Prioridad alta/)
    expect(beatriz.querySelector('svg[data-priority="high"]')).not.toBeNull()
    // The tooltip says it; the card shows only the glyph.
    expect(within(beatriz).getAllByText('Prioridad alta')[1]).toHaveAttribute('aria-hidden', 'true')
    // Medium and none stay off the card.
    expect(card(/Joaquín Ferreyra Paz/).querySelector('svg[data-priority]')).toBeNull()
    expect(card(/Larissa Monteiro Alves/)).not.toHaveAccessibleName(/Prioridad|Sin prioridad/)
  })

  it('says when no case was closed in the last 7 days', async () => {
    vi.mocked(fetchInbox).mockResolvedValue(emptyInbox)
    renderPanel({ filter: 'closed' })
    expect(await screen.findByText('No cerraste casos en los últimos 7 días.')).toBeInTheDocument()
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

  it('shows the filter of the URL as a removable chip; removing it shows every open case', async () => {
    vi.mocked(fetchInbox).mockImplementation(async ({ status }) =>
      makeInbox(status ? seededInbox.filter((item) => item.inboxStatus === status) : seededInbox),
    )
    const { user } = renderPanel({ filter: 'waiting' })
    await waitFor(() =>
      expect(fetchInbox).toHaveBeenCalledWith({ status: 'waiting', q: '' }, expect.anything()),
    )
    await screen.findByRole('list', { name: 'Casos' })
    expect(within(caseList()).getAllByRole('button')).toHaveLength(1)
    const chip = screen.getByRole('button', { name: 'Quitar filtro Esperando al cliente' })
    expect(chip).toHaveTextContent('Esperando al cliente')
    await user.click(chip)
    expect(onFilterChange).toHaveBeenCalledWith(null)
    expect(screen.queryByRole('button', { name: /^Quitar filtro/ })).not.toBeInTheDocument()
    await waitFor(() => expect(within(caseList()).getAllByRole('button')).toHaveLength(5))
  })

  it('names each filter chip', async () => {
    const { unmount } = renderPanel({ filter: 'closed' })
    expect(screen.getByRole('button', { name: 'Quitar filtro Cerrados' })).toBeInTheDocument()
    unmount()
    renderPanel({ filter: 'to_reply' })
    expect(screen.getByRole('button', { name: 'Quitar filtro Por responder' })).toBeInTheDocument()
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
  })

  it('says when a search matches nothing', async () => {
    vi.mocked(fetchInbox).mockImplementation(async ({ q }) => (q ? emptyInbox : makeInbox()))
    const { user } = renderPanel()
    await screen.findByRole('list', { name: 'Casos' })
    await user.type(screen.getByRole('searchbox', { name: 'Buscar caso' }), 'Zuleta')
    expect(await screen.findByText('Ningún caso coincide con tu búsqueda.')).toBeInTheDocument()
  })

  it('shows skeletons while loading', async () => {
    vi.mocked(fetchInbox).mockReturnValue(new Promise(() => {}))
    const { container } = renderPanel()
    expect(container.querySelector('[aria-busy="true"]')).toBeInTheDocument()
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

  it('pauses from the availability pill, which then becomes the orange paused control', async () => {
    const { user } = renderPanel()
    const pill = await screen.findByRole('button', { name: 'Disponible. Pausar casos nuevos' })
    expect(pill).toHaveTextContent('Disponible')
    expect(screen.queryByText('No te llegan casos nuevos')).not.toBeInTheDocument()
    await user.click(pill)
    expect(updateAvailability).toHaveBeenCalledWith('paused')
    const control = await screen.findByRole('button', { name: 'En pausa. Volver a disponible' })
    expect(control).toHaveClass('bg-warn')
    expect(control).toHaveTextContent('En pausaNo te llegan casos nuevos')
    expect(screen.queryByRole('button', { name: /^Disponible/ })).not.toBeInTheDocument()
  })

  it('shows no separate paused banner: the control itself goes back to available', async () => {
    vi.mocked(fetchAvailability).mockResolvedValue(paused)
    const { user } = renderPanel()
    const control = await screen.findByRole('button', { name: 'En pausa. Volver a disponible' })
    expect(screen.queryByText('Los que ya tienes siguen contigo.')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Volver a disponible' })).not.toBeInTheDocument()
    await user.click(control)
    expect(updateAvailability).toHaveBeenCalledWith('available')
    expect(
      await screen.findByRole('button', { name: 'Disponible. Pausar casos nuevos' }),
    ).toBeInTheDocument()
    expect(screen.queryByText('No te llegan casos nuevos')).not.toBeInTheDocument()
  })

  it('rolls the pill back and tells the analyst when the change fails', async () => {
    vi.mocked(updateAvailability).mockRejectedValue(ApiProblem.network())
    const { user } = renderPanel()
    await user.click(await screen.findByRole('button', { name: /^Disponible/ }))
    expect(await screen.findByText('No pudimos cambiar tu estado')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /^Disponible/ })).toBeInTheDocument()
  })

  it('collapses to a rail of initials of the open cases and expands again', async () => {
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

  it('leaves the closed cases out of the collapsed rail', async () => {
    vi.mocked(fetchInbox).mockResolvedValue(makeInbox(closedInbox))
    renderPanel({ collapsed: true, filter: 'closed' })
    const rail = screen.getByRole('region', { name: 'Casos, lista contraída' })
    await waitFor(() => expect(fetchInbox).toHaveBeenCalled())
    expect(within(rail).queryByRole('button', { name: /Héctor/ })).not.toBeInTheDocument()
  })

  it('toasts a customer who wrote again after a close', async () => {
    const { sockets } = renderPanel()
    await screen.findByRole('list', { name: 'Casos' })
    const returned = makeCaseSummary({
      id: 'CASE-00000000000000000000009002',
      customer: { id: 'CUS-00000000000000000000001005', displayName: 'Claudia Restrepo Varela' },
      status: 'assigned',
      inboxStatus: 'new',
      previousCaseId: 'CASE-00000000000000000000000105',
      version: 1,
    })
    act(() => {
      sockets.last()?.open()
      sockets.last()?.receive({
        type: 'case.assigned',
        id: 'EVT-ASSIGNED-2',
        occurredAt: NOW.toISOString(),
        data: {
          entity: 'case',
          entityId: returned.id,
          caseId: returned.id,
          actor: null,
          payload: returned,
        },
      })
    })
    expect(await screen.findByText('Claudia volvió a escribir')).toBeInTheDocument()
    expect(screen.queryByText('Te llegó un caso nuevo')).not.toBeInTheDocument()
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

  it('drops the new-case toast once its case is opened from the list, or closes', async () => {
    const { user, sockets } = renderPanel()
    await screen.findByRole('list', { name: 'Casos' })
    const socket = sockets.last()
    const fresh = makeCaseSummary({
      id: 'CASE-00000000000000000000009001',
      customer: { id: 'CUS-00000000000000000000002004', displayName: 'Rafael Nogueira Costa' },
      status: 'assigned',
      inboxStatus: 'new',
      version: 1,
    })
    const other = makeCaseSummary({
      id: 'CASE-00000000000000000000009003',
      customer: { id: 'CUS-00000000000000000000002005', displayName: 'Lucía Benítez Ortiz' },
      status: 'assigned',
      inboxStatus: 'new',
      version: 1,
    })
    const assigned = (summary: typeof fresh, id: string) => ({
      type: 'case.assigned',
      id,
      occurredAt: NOW.toISOString(),
      data: {
        entity: 'case',
        entityId: summary.id,
        caseId: summary.id,
        actor: null,
        payload: summary,
      },
    })
    // The refetch the new cases trigger brings them in.
    vi.mocked(fetchInbox).mockResolvedValue(makeInbox([fresh, other, ...seededInbox]))
    act(() => {
      socket?.open()
      socket?.receive(assigned(fresh, 'EVT-ASSIGNED-10'))
      socket?.receive(assigned(other, 'EVT-ASSIGNED-11'))
    })
    const toasts = screen.getByRole('region', { name: 'Notificaciones' })
    await waitFor(() =>
      expect(within(toasts).getAllByText('Te llegó un caso nuevo')).toHaveLength(2),
    )

    // Opening Rafael's case from its card: its toast goes, Lucía's stays.
    await user.click(
      await within(caseList()).findByRole('button', { name: /Rafael Nogueira Costa/ }),
    )
    await waitFor(() => expect(within(toasts).queryByText('Rafael Nogueira Costa')).toBeNull())
    expect(within(toasts).getByText('Lucía Benítez Ortiz')).toBeInTheDocument()

    // Lucía's case closes (closed elsewhere): no "Ver caso" left pointing at it.
    act(() => {
      socket?.receive({
        type: 'case.updated',
        id: 'EVT-UPDATED-11',
        occurredAt: NOW.toISOString(),
        data: {
          entity: 'case',
          entityId: other.id,
          caseId: other.id,
          actor: null,
          payload: { ...other, status: 'closed', inboxStatus: 'closed', version: 2 },
        },
      })
    })
    await waitFor(() => expect(within(toasts).queryByText('Te llegó un caso nuevo')).toBeNull())
  })

  it('says "Te asignaron un caso" when a supervisor assigned it', async () => {
    const { sockets } = renderPanel()
    await screen.findByRole('list', { name: 'Casos' })
    const fresh = makeCaseSummary({
      id: 'CASE-00000000000000000000000113',
      customer: { id: 'CUS-00000000000000000000001011', displayName: 'Camila Torres Benavides' },
      status: 'assigned',
      inboxStatus: 'new',
      version: 7,
    })
    act(() => {
      sockets.last()?.open()
      sockets.last()?.receive({
        type: 'case.assigned',
        id: 'EVT-MANUAL-1',
        occurredAt: NOW.toISOString(),
        data: {
          entity: 'case',
          entityId: fresh.id,
          caseId: fresh.id,
          actor: { role: 'supervisor', id: 'STF-SUP0000001' },
          payload: fresh,
        },
      })
    })
    expect(await screen.findByText('Te asignaron un caso')).toBeInTheDocument()
    const toasts = screen.getByRole('region', { name: 'Notificaciones' })
    expect(within(toasts).getByText('Camila Torres Benavides')).toBeInTheDocument()
    expect(within(toasts).getByText('Supervisión')).toBeInTheDocument()
  })

  it('toasts once when supervision reassigns one of her cases away', async () => {
    const { sockets } = renderPanel()
    await screen.findByRole('list', { name: 'Casos' })
    const gone = makeCaseSummary({ version: 9, assignedAnalystId: 'STF-OTHER', inboxStatus: 'new' })
    const unassigned = {
      type: 'case.unassigned',
      id: 'EVT-UNASSIGNED-1',
      occurredAt: NOW.toISOString(),
      data: {
        entity: 'case',
        entityId: gone.id,
        caseId: gone.id,
        actor: { role: 'supervisor', id: 'STF-SUP0000001' },
        payload: gone,
      },
    }
    act(() => {
      sockets.last()?.open()
      sockets.last()?.receive(unassigned)
      sockets.last()?.receive(unassigned)
    })
    expect(await screen.findByText('Supervisión reasignó un caso')).toBeInTheDocument()
    expect(screen.getAllByText('Supervisión reasignó un caso')).toHaveLength(1)
    expect(
      screen.getByText(
        'El caso de Marcela Quintana Pardo pasó a otra persona del equipo. Puedes leerlo, pero ya no responder.',
      ),
    ).toBeInTheDocument()
  })

  it('does not toast a case that is already the selected one', async () => {
    const { sockets } = renderPanel()
    await screen.findByRole('list', { name: 'Casos' })
    const selected = makeCaseSummary({ id: 'CASE-00000000000000000000000101', version: 9 })
    act(() => {
      sockets.last()?.open()
      sockets.last()?.receive({
        type: 'case.assigned',
        id: 'EVT-ASSIGNED-12',
        occurredAt: NOW.toISOString(),
        data: {
          entity: 'case',
          entityId: selected.id,
          caseId: selected.id,
          actor: null,
          payload: selected,
        },
      })
    })
    await waitFor(() => expect(screen.getByRole('status')).toBeEmptyDOMElement())
    expect(screen.queryByRole('button', { name: 'Ver caso' })).not.toBeInTheDocument()
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
