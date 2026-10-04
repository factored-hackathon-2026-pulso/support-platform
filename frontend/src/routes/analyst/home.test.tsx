import { act, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type * as CasesApi from '@/features/cases/api'
import { fetchAvailability, fetchInbox, updateAvailability } from '@/features/cases/api'
import type * as HomeApi from '@/features/home/api'
import { fetchHome } from '@/features/home/api'
import { ApiProblem } from '@/lib/api'
import { NOW, emptyInbox, makeInbox, paused, seededInbox } from '@/test/case-fixtures'
import { analystStaff } from '@/test/fixtures'
import { makeHome } from '@/test/home-fixtures'
import { renderRoute } from '@/test/render'

vi.mock('@/features/cases/api', async (importOriginal) => {
  const actual = await importOriginal<typeof CasesApi>()
  return {
    ...actual,
    fetchInbox: vi.fn<typeof actual.fetchInbox>(),
    fetchAvailability: vi.fn<typeof actual.fetchAvailability>(),
    updateAvailability: vi.fn<typeof actual.updateAvailability>(),
  }
})

vi.mock('@/features/home/api', async (importOriginal) => {
  const actual = await importOriginal<typeof HomeApi>()
  return { ...actual, fetchHome: vi.fn<typeof actual.fetchHome>() }
})

beforeEach(() => {
  // Only Date is faked: "hace x" and the greeting read it, timers stay real.
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

const renderHome = (entry = '/analyst/home') => renderRoute(entry, { staff: analystStaff })

describe('/analyst/home (Inicio)', () => {
  it('greets her and names the day and her team', async () => {
    renderHome()
    // NOW is 11:00 in Bogotá (the tests' zone).
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Buenos días, Daniela' }),
    ).toBeInTheDocument()
    expect(screen.getByText('Jueves 5 de marzo')).toBeInTheDocument()
    expect(screen.getByText('Equipo Andes', { selector: 'header span' })).toHaveClass(
      'rounded-full',
    )
    expect(screen.queryByText('Datos de ejemplo')).not.toBeInTheDocument()
    expect(document.title).toBe('Inicio · LATAM Bank Soporte')
    expect(screen.getByRole('main')).toBeInTheDocument()
  })

  it('paused: "Empezar a atender" makes her available, and back', async () => {
    const { user } = renderHome()
    const block = await screen.findByRole('region', { name: 'Tu disponibilidad' })
    expect(await within(block).findByText('Estás en pausa')).toBeInTheDocument()
    expect(within(block).getByText('Sin casos nuevos')).toBeInTheDocument()
    expect(await within(block).findByText('5 casos abiertos')).toBeInTheDocument()
    expect(within(block).getByRole('link', { name: 'Ir a Casos' })).toHaveAttribute(
      'href',
      '/analyst/cases',
    )
    await user.click(within(block).getByRole('button', { name: 'Empezar a atender' }))
    expect(updateAvailability).toHaveBeenCalledWith('available')
    expect(await within(block).findByText('Estás disponible')).toBeInTheDocument()
    expect(within(block).getByText('Recibes casos nuevos')).toBeInTheDocument()
    await user.click(within(block).getByRole('button', { name: 'Pausar casos nuevos' }))
    expect(updateAvailability).toHaveBeenLastCalledWith('paused')
  })

  it('links the four status tiles to Casos with the filter', async () => {
    const { user, router } = renderHome()
    const tiles = await screen.findByRole('navigation', { name: 'Tus casos por estado' })
    await within(tiles).findByRole('link', { name: '2 Por responder. Ver en Casos' })
    expect(
      within(tiles)
        .getAllByRole('link')
        .map((link) => [link.getAttribute('aria-label'), link.getAttribute('href')]),
    ).toEqual([
      ['2 Por responder. Ver en Casos', '/analyst/cases?status=to_reply'],
      ['2 Nuevos. Ver en Casos', '/analyst/cases?status=new'],
      ['1 Esperando al cliente. Ver en Casos', '/analyst/cases?status=waiting'],
      ['3 Cerrados, últimos 7 días. Ver en Casos', '/analyst/cases?status=closed'],
    ])
    expect(within(tiles).getByRole('link', { name: /Por responder/ })).toHaveClass('border-l-warn')
    await user.click(within(tiles).getByRole('link', { name: /Cerrados/ }))
    await waitFor(() => expect(router.state.location.pathname).toBe('/analyst/cases'))
    expect(router.state.location.search).toBe('?status=closed')
    expect(
      await screen.findByRole('button', { name: 'Quitar filtro Cerrados' }),
    ).toBeInTheDocument()
  })

  it('lists "Lo primero" by urgency and opens a case in Casos with its filter', async () => {
    renderHome()
    const section = await screen.findByRole('region', { name: 'Lo primero' })
    const list = await within(section).findByRole('list', { name: 'Casos por urgencia' })
    const rows = Array.from(list.children) as HTMLElement[]
    expect(rows.map((row) => row.querySelector('span span span.truncate')?.textContent)).toEqual([
      'Beatriz Salcedo Prieto',
      'Patricia Lozano Vega',
      'Larissa Monteiro Alves',
      'Marcela Quintana Pardo',
      'Joaquín Ferreyra Paz',
    ])
    expect(rows[0]).toHaveClass('border-l-warn')
    // Status as glyph + word, the channel icon-only (its name for screen readers), the SLA level.
    const status = within(rows[0]!).getByText('Por responder').parentElement!
    expect(status.querySelector('svg')).toHaveAttribute('data-status-shape', 'pie-75')
    expect(status).not.toHaveClass('rounded-full')
    expect(rows[0]).toHaveTextContent('Canal: Chat en la app')
    expect(rows[0]).toHaveTextContent('SLA de primera respuesta: 3 min')
    expect(rows[0]!.querySelector('.lucide-flame')).toBeInTheDocument()
    // No language in a case summary.
    expect(rows[2]).not.toHaveTextContent(/portugu/i)
    expect(
      within(section).getByRole('list', { name: 'Casos por urgencia' }).textContent,
    ).not.toContain('·')
    expect(
      within(list).getByRole('link', { name: 'Abrir el caso de Beatriz Salcedo Prieto' }),
    ).toHaveAttribute('href', '/analyst/cases?case=CASE-00000000000000000000000102&status=to_reply')
  })

  it('marks an escalated case in "Lo primero" with "Escalado" (glyph + word)', async () => {
    vi.mocked(fetchInbox).mockResolvedValue(
      makeInbox(
        seededInbox.map((item) => (item.id.endsWith('101') ? { ...item, escalated: true } : item)),
      ),
    )
    renderHome()
    const section = await screen.findByRole('region', { name: 'Lo primero' })
    const list = await within(section).findByRole('list', { name: 'Casos por urgencia' })
    const marker = await within(list).findByText('Escalado')
    expect(marker.parentElement!.querySelector('svg')).toHaveAttribute('data-status-shape', 'up')
    expect(marker.closest('li')).toHaveTextContent('Marcela Quintana Pardo')
    expect(within(list).getAllByText('Escalado')).toHaveLength(1)
  })

  it('shows "Mientras no estabas": four rows, then every row with "Ver todo (n)"', async () => {
    const { user } = renderHome()
    const feed = await screen.findByRole('region', { name: 'Mientras no estabas' })
    await within(feed).findByText('Cerraste sesión')
    expect(within(feed).getByText('hoy 10:20')).toBeInTheDocument()
    const list = within(feed).getByRole('list', { name: 'Mientras no estabas' })
    expect(within(list).getAllByRole('link')).toHaveLength(4)
    const away = within(list).getByRole('link', { name: /^Marcela Quintana Pardo: Ya no es tuyo/ })
    expect(away).toHaveAttribute('href', '/analyst/cases?case=CASE-00000000000000000000000101')
    expect(away).toHaveAccessibleName(
      'Marcela Quintana Pardo: Ya no es tuyo. Lo reasignó: Lucía Herrera, Ahora lo atiende: Sebastián Cárdenas, Solo lectura, hace 6 min. Abrir en solo lectura',
    )
    expect(within(list).getByText('Larissa Monteiro Alves').tagName).toBe('STRONG')
    // Rule 3 applied: the language and the "Regla 3" tag as their own fact.
    const arrival = within(list).getByRole('link', { name: /^Larissa Monteiro Alves: Te llegó/ })
    expect(arrival).toHaveTextContent('Por idioma: PortuguésRegla 3')
    expect(list.textContent).not.toContain('·')

    const more = within(feed).getByRole('button', { name: 'Ver todo (5)' })
    expect(more).toHaveAttribute('aria-expanded', 'false')
    await user.click(more)
    expect(within(list).getAllByRole('link')).toHaveLength(5)
    expect(within(list).getByText('Esperó 17 min')).toBeInTheDocument()
    expect(within(feed).getByRole('button', { name: 'Ver menos' })).toHaveAttribute(
      'aria-expanded',
      'true',
    )
  })

  it('says when there is nothing new, and the 8-hour fallback', async () => {
    vi.mocked(fetchHome).mockResolvedValue(
      makeHome({ sinceSource: 'fallback', activity: { items: [], total: 0 } }),
    )
    renderHome()
    const feed = await screen.findByRole('region', { name: 'Mientras no estabas' })
    expect(await within(feed).findByText('Nada nuevo desde tu última sesión')).toBeInTheDocument()
    expect(within(feed).getByText('Últimas 8 horas')).toBeInTheDocument()
    expect(within(feed).queryByRole('button', { name: /Ver todo/ })).not.toBeInTheDocument()
  })

  it('shows "Tu equipo ahora": counts only, and her language queues', async () => {
    renderHome()
    const team = await screen.findByRole('region', { name: 'Tu equipo ahora' })
    await within(team).findByText('Disponibles')
    expect(team).toHaveTextContent('Disponibles0 de 4')
    expect(team).toHaveTextContent('Cola en español2El más antiguo: hace 17 min')
    expect(team).toHaveTextContent('Cola en portugués1El más antiguo: hace 6 min')
    expect(team).toHaveTextContent('Al empezar, la cola de tus idiomas se reparte primero contigo.')
    expect(team.querySelector('dl')?.textContent).not.toContain('·')
  })

  it('says she has no open cases (canvas `vacía`)', async () => {
    vi.mocked(fetchInbox).mockResolvedValue(emptyInbox)
    renderHome()
    const section = await screen.findByRole('region', { name: 'Lo primero' })
    expect(
      await within(section).findByRole('heading', { name: 'No tienes casos abiertos' }),
    ).toBeInTheDocument()
    expect(section).toHaveTextContent(
      'Cuando empieces a atender, los casos que te lleguen aparecen aquí.',
    )
  })

  it('shows skeletons while loading', async () => {
    vi.mocked(fetchInbox).mockReturnValue(new Promise(() => {}))
    vi.mocked(fetchAvailability).mockReturnValue(new Promise(() => {}))
    vi.mocked(fetchHome).mockReturnValue(new Promise(() => {}))
    renderHome()
    const block = await screen.findByRole('region', { name: 'Tu disponibilidad' })
    expect(block).toHaveAttribute('aria-busy', 'true')
    const feed = screen.getByRole('region', { name: 'Mientras no estabas' })
    expect(feed.querySelector('[aria-busy="true"]')).toBeInTheDocument()
    const first = screen.getByRole('region', { name: 'Lo primero' })
    expect(first.querySelector('[aria-busy="true"]')).toBeInTheDocument()
    const tiles = screen.getByRole('navigation', { name: 'Tus casos por estado' })
    expect(
      within(tiles).getByRole('link', { name: 'Sin dato de Por responder. Ver en Casos' }),
    ).toBeInTheDocument()
  })

  it('shows the errors with a retry', async () => {
    vi.mocked(fetchHome).mockRejectedValueOnce(ApiProblem.network())
    vi.mocked(fetchInbox).mockRejectedValue(ApiProblem.network())
    const { user } = renderHome()
    const feed = await screen.findByRole('region', { name: 'Mientras no estabas' })
    await waitFor(() => expect(fetchHome).toHaveBeenCalled())
    const alert = await within(feed).findByRole('alert')
    expect(alert).toHaveTextContent('No pudimos cargar lo que pasó')
    expect(screen.getByRole('region', { name: 'Tu equipo ahora' })).toHaveTextContent(
      'Sin datos del equipo por ahora.',
    )
    const first = screen.getByRole('region', { name: 'Lo primero' })
    expect(await within(first).findByRole('alert')).toHaveTextContent('No pudimos cargar tus casos')
    await user.click(within(alert).getByRole('button', { name: 'Reintentar' }))
    expect(await within(feed).findByText('Volvió a escribir')).toBeInTheDocument()
  })

  it('marks Inicio in the rail, counts Por responder on Casos and shows her presence', async () => {
    renderHome()
    const rail = screen.getByRole('navigation', { name: 'Principal' })
    expect(within(rail).getByRole('link', { name: 'Inicio' })).toHaveAttribute(
      'aria-current',
      'page',
    )
    expect(
      await within(rail).findByRole('link', { name: 'Casos, 2 pendientes' }),
    ).not.toHaveAttribute('aria-current')
    expect(await within(rail).findByText('Estado: En pausa')).toBeInTheDocument()
  })

  it('follows her inbox topic and refetches the home on her envelopes', async () => {
    const { sockets } = renderHome()
    await screen.findByText('Te llegó')
    const socket = sockets.last()
    act(() => socket?.open())
    await waitFor(() =>
      expect(socket?.messages()).toContainEqual({
        action: 'subscribe',
        topic: `inbox:${analystStaff.id}`,
      }),
    )
    // Never a supervision topic for an analyst.
    expect(socket?.messages()).not.toContainEqual(
      expect.objectContaining({ topic: expect.stringMatching(/^supervision:/) }),
    )
    const calls = vi.mocked(fetchHome).mock.calls.length
    act(() =>
      socket?.receive({
        type: 'case.assigned',
        id: 'EVT-HOME-1',
        occurredAt: NOW.toISOString(),
        data: {
          entity: 'case',
          entityId: seededInbox[0]!.id,
          caseId: seededInbox[0]!.id,
          actor: null,
          payload: { ...seededInbox[0]!, version: 99 },
        },
      }),
    )
    await waitFor(() => expect(vi.mocked(fetchHome).mock.calls.length).toBeGreaterThan(calls))
  })

  it('is where an analyst lands at "/"', async () => {
    const { router } = renderHome('/')
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Buenos días, Daniela' }),
    ).toBeInTheDocument()
    expect(router.state.location.pathname).toBe('/analyst/home')
  })
})
