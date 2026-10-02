import { act, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type * as CasesApi from '@/features/cases/api'
import { fetchAvailability, fetchInbox, updateAvailability } from '@/features/cases/api'
import { ApiProblem } from '@/lib/api'
import { NOW, available, emptyInbox, makeInbox, paused, seededInbox } from '@/test/case-fixtures'
import { analystStaff } from '@/test/fixtures'
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

/**
 * The conversation feature is another agent's slice with its own tests: here it
 * is replaced by stubs that expose what the Workspace passes to it.
 */
vi.mock('@/features/conversation', async () => {
  const { useEffect, useRef } = await import('react')
  /** Stub pane: a focusable heading that takes the focus when asked, like the real one. */
  function ConversationPane({
    caseId,
    onClosed,
    focusOnLoad,
    onFocused,
  }: {
    caseId: string
    onClosed?: (id: string) => void
    focusOnLoad?: boolean
    onFocused?: () => void
  }) {
    const heading = useRef<HTMLHeadingElement>(null)
    useEffect(() => {
      if (!focusOnLoad) return
      heading.current?.focus()
      onFocused?.()
    }, [focusOnLoad, onFocused])
    return (
      <section aria-label="Conversación del caso">
        <h2 ref={heading} tabIndex={-1}>
          Conversación {caseId}
        </h2>
        <button type="button" onClick={() => onClosed?.(caseId)}>
          Simular cierre
        </button>
      </section>
    )
  }
  return {
    conversationKeys: {
      all: ['conversation'],
      detail: (caseId: string) => ['conversation', caseId, 'detail'],
      turns: (caseId: string) => ['conversation', caseId, 'turns'],
    },
    registerConversationRealtime: () => {},
    ConversationPane,
    RoutingSummary: ({ caseId }: { caseId: string }) => <p>Cómo llegó a ti · {caseId}</p>,
    useCaseDetail: (caseId: string | null) => ({
      status: 'success',
      isFetching: false,
      refetch: () => {},
      data: {
        customer: {
          id: 'CUS-00000000000000000000001001',
          displayName: caseId?.endsWith('102')
            ? 'Beatriz Salcedo Prieto'
            : 'Marcela Quintana Pardo',
          segment: 'Plus',
          country: 'CO',
          city: 'Barranquilla',
          locale: 'es-CO',
          language: 'es',
          customerSince: '2019-02-01',
          documentType: 'CE',
        },
      },
    }),
  }
})

const FIRST = 'CASE-00000000000000000000000101'
const SECOND = 'CASE-00000000000000000000000102'

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(NOW)
  vi.mocked(fetchInbox).mockResolvedValue(makeInbox())
  vi.mocked(fetchAvailability).mockResolvedValue(available)
  vi.mocked(updateAvailability).mockResolvedValue(available)
})

afterEach(() => {
  vi.useRealTimers()
})

const renderWorkspace = (entry = '/analista') => renderRoute(entry, { staff: analystStaff })
const searchOf = (router: ReturnType<typeof renderWorkspace>['router']) =>
  new URLSearchParams(router.state.location.search)

describe('/analista (Workspace)', () => {
  it('auto-selects the first case of the list, replacing the history entry', async () => {
    const { router } = renderWorkspace()
    expect(await screen.findByText(`Conversación ${FIRST}`)).toBeInTheDocument()
    expect(searchOf(router).get('caso')).toBe(FIRST)
    expect(router.state.historyAction).toBe('REPLACE')
    expect(screen.getByRole('heading', { level: 1, name: 'Casos' })).toBeInTheDocument()
    expect(screen.getByRole('main')).toContainElement(screen.getByText(`Conversación ${FIRST}`))
    expect(document.title).toBe('Casos · LATAM Bank Soporte')
  })

  it('opens the case in the URL and selects others with a new history entry', async () => {
    const { router, user } = renderWorkspace(`/analista?caso=${SECOND}`)
    expect(await screen.findByText(`Conversación ${SECOND}`)).toBeInTheDocument()
    const list = await screen.findByRole('list', { name: 'Casos' })
    expect(within(list).getByRole('button', { name: /Beatriz Salcedo Prieto/ })).toHaveAttribute(
      'aria-current',
      'true',
    )
    await user.click(within(list).getByRole('button', { name: /Joaquín Ferreyra Paz/ }))
    expect(searchOf(router).get('caso')).toBe('CASE-00000000000000000000000107')
    expect(router.state.historyAction).toBe('PUSH')
    expect(screen.getByText('Conversación CASE-00000000000000000000000107')).toBeInTheDocument()
  })

  it('restores the filter from ?estado= and keeps the filter in the URL', async () => {
    const toCall = seededInbox.filter((item) => item.inboxStatus === 'to_call')
    vi.mocked(fetchInbox).mockImplementation(async ({ status }) =>
      status === 'to_call' ? makeInbox(toCall) : makeInbox(),
    )
    const { router, user } = renderWorkspace('/analista?estado=por-llamar')
    expect(await screen.findByRole('radio', { name: '1 Por llamar' })).toBeChecked()
    await screen.findByText('Conversación CASE-00000000000000000000000106')
    expect(fetchInbox).toHaveBeenCalledWith({ status: 'to_call', q: '' }, expect.anything())

    await user.click(screen.getByRole('radio', { name: '6 Todos' }))
    expect(searchOf(router).get('estado')).toBeNull()
    await user.click(screen.getByRole('radio', { name: '1 En espera' }))
    expect(searchOf(router).get('estado')).toBe('en-espera')
  })

  it('keeps the search in the URL', async () => {
    const { router, user } = renderWorkspace()
    await screen.findByText(`Conversación ${FIRST}`)
    await user.type(screen.getByRole('searchbox', { name: 'Buscar caso' }), 'Héctor')
    expect(searchOf(router).get('q')).toBe('Héctor')
    expect(router.state.historyAction).toBe('REPLACE')
    expect(screen.getByRole('searchbox', { name: 'Buscar caso' })).toHaveValue('Héctor')
  })

  it('shows the empty state when the analyst has no cases (vacia)', async () => {
    vi.mocked(fetchInbox).mockResolvedValue(emptyInbox)
    const { router } = renderWorkspace()
    expect(
      await screen.findByRole('heading', { level: 2, name: 'No tienes contactos abiertos' }),
    ).toBeInTheDocument()
    expect(
      screen.getByText(
        'Estás disponible. Cuando un agente escale un contacto que te corresponde, aparece aquí.',
      ),
    ).toBeInTheDocument()
    expect(screen.getByText('Nada pendiente.')).toBeInTheDocument()
    expect(screen.queryByRole('complementary', { name: /Panel de apoyo/ })).not.toBeInTheDocument()
    expect(searchOf(router).get('caso')).toBeNull()
  })

  it('explains the empty inbox while paused (pausa)', async () => {
    vi.mocked(fetchInbox).mockResolvedValue(emptyInbox)
    vi.mocked(fetchAvailability).mockResolvedValue(paused)
    renderWorkspace()
    expect(
      await screen.findByText(/^Estás en pausa: no te llegan casos nuevos/),
    ).toBeInTheDocument()
    expect(screen.getByText('En pausa · no te llegan casos nuevos')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Volver a disponible' })).toBeInTheDocument()
  })

  it('shows a loading state while the inbox loads', async () => {
    vi.mocked(fetchInbox).mockReturnValue(new Promise(() => {}))
    renderWorkspace()
    expect(await screen.findByText('Cargando tus casos')).toBeInTheDocument()
  })

  it('keeps the list error in the list and asks to pick a case', async () => {
    vi.mocked(fetchInbox).mockRejectedValue(ApiProblem.network())
    renderWorkspace()
    const list = await screen.findByRole('region', { name: 'Casos abiertos' })
    expect(await within(list).findByRole('alert')).toHaveTextContent('No pudimos cargar tus casos')
    expect(
      screen.getByRole('heading', { level: 2, name: 'Elige un caso de la lista' }),
    ).toBeInTheDocument()
  })

  it('selects the next case after closing one and moves the focus to it', async () => {
    const { router, user } = renderWorkspace()
    await screen.findByText(`Conversación ${FIRST}`)
    await user.click(screen.getByRole('button', { name: 'Simular cierre' }))
    expect(searchOf(router).get('caso')).toBe(SECOND)
    const next = await screen.findByRole('heading', { name: `Conversación ${SECOND}` })
    await waitFor(() => expect(next).toHaveFocus())
  })

  it('moves the focus to the empty state when the last case is closed', async () => {
    vi.mocked(fetchInbox).mockResolvedValue(makeInbox([seededInbox[0]!]))
    const { router, user } = renderWorkspace()
    await screen.findByText(`Conversación ${FIRST}`)
    await user.click(screen.getByRole('button', { name: 'Simular cierre' }))
    expect(searchOf(router).get('caso')).toBeNull()
    const empty = await screen.findByRole('heading', { name: 'Elige un caso de la lista' })
    await waitFor(() => expect(empty).toHaveFocus())
  })

  it('opens the case of the "Ver caso" toast and focuses it', async () => {
    const { router, user, sockets } = renderWorkspace()
    await screen.findByText(`Conversación ${FIRST}`)
    const assigned = { ...seededInbox[1]!, version: 99 }
    act(() => {
      sockets.last()?.open()
      sockets.last()?.receive({
        type: 'case.assigned',
        id: 'EVT-ASSIGNED-9',
        occurredAt: NOW.toISOString(),
        data: { entity: 'case', entityId: SECOND, caseId: SECOND, actor: null, payload: assigned },
      })
    })
    await user.click(await screen.findByRole('button', { name: 'Ver caso' }))
    expect(searchOf(router).get('caso')).toBe(SECOND)
    const heading = await screen.findByRole('heading', { name: `Conversación ${SECOND}` })
    await waitFor(() => expect(heading).toHaveFocus())
  })

  it('subscribes to the analyst inbox topic', async () => {
    const { sockets } = renderWorkspace()
    await screen.findByText(`Conversación ${FIRST}`)
    const socket = sockets.last()
    act(() => socket?.open())
    await waitFor(() =>
      expect(socket?.messages()).toContainEqual({
        action: 'subscribe',
        topic: `inbox:${analystStaff.id}`,
      }),
    )
  })
})

describe('/analista support panel', () => {
  it('opens on Copiloto with the slice 2 placeholder', async () => {
    renderWorkspace()
    const panel = await screen.findByRole('complementary', { name: 'Panel de apoyo' })
    const tabs = within(panel).getByRole('tablist', { name: 'Paneles' })
    expect(within(tabs).getByRole('tab', { name: 'Copiloto' })).toHaveAttribute(
      'aria-selected',
      'true',
    )
    expect(within(panel).getByText(/^Pregúntale lo que necesites sobre este cliente/)).toBeVisible()
    expect(within(panel).getByText(/^Llega en la próxima entrega/)).toBeInTheDocument()
    expect(within(panel).getByRole('textbox', { name: 'Pregúntale al copiloto' })).toBeDisabled()
    expect(within(panel).getByRole('button', { name: 'Preguntar' })).toBeDisabled()
  })

  it('switches tabs through the URL (?panel=)', async () => {
    const { router, user } = renderWorkspace()
    const panel = await screen.findByRole('complementary', { name: 'Panel de apoyo' })

    await user.click(within(panel).getByRole('tab', { name: 'Herramientas' }))
    expect(searchOf(router).get('panel')).toBe('herramientas')
    const toolTabs = within(panel).getByRole('tablist', { name: 'Tipo de herramienta' })
    expect(
      within(toolTabs)
        .getAllByRole('tab')
        .map((tab) => tab.textContent),
    ).toEqual(['Acciones 0', 'Consultas 0', 'Hechas 0'])
    expect(within(panel).getByText('No hay acciones para este caso.')).toBeInTheDocument()
    await user.click(within(toolTabs).getByRole('tab', { name: /Hechas/ }))
    expect(within(panel).getByText('Todavía no se hizo nada en este caso.')).toBeInTheDocument()

    await user.click(within(panel).getByRole('tab', { name: 'Cliente' }))
    expect(searchOf(router).get('panel')).toBe('cliente')
    expect(
      within(panel).getByRole('heading', { level: 2, name: 'Marcela Quintana Pardo' }),
    ).toBeInTheDocument()
    expect(
      within(panel).getByText('Plus · cliente desde feb 2019 · Barranquilla, Colombia'),
    ).toBeInTheDocument()
    expect(within(panel).getByText('CUS-00000000000000000000001001 · CE')).toBeInTheDocument()
    expect(within(panel).getByText(`Cómo llegó a ti · ${FIRST}`)).toBeInTheDocument()
    for (const section of [
      'Productos',
      'Reclamos',
      'Contactos recientes',
      'Contacto',
      'Quién vio qué',
    ]) {
      expect(within(panel).getByRole('button', { name: section })).toHaveAttribute(
        'aria-expanded',
        'false',
      )
    }
  })

  it('collapses to an icon rail and reopens on a tab (panelContraido)', async () => {
    const { router, user } = renderWorkspace()
    const panel = await screen.findByRole('complementary', { name: 'Panel de apoyo' })
    await user.click(within(panel).getByRole('button', { name: 'Contraer el panel' }))
    expect(searchOf(router).get('apoyo')).toBe('contraido')

    const rail = screen.getByRole('complementary', { name: 'Panel de apoyo, contraído' })
    for (const name of ['Mostrar el panel', 'Copiloto', 'Herramientas', 'Cliente']) {
      expect(within(rail).getByRole('button', { name })).toBeInTheDocument()
    }
    await user.click(within(rail).getByRole('button', { name: 'Cliente' }))
    expect(searchOf(router).get('apoyo')).toBeNull()
    expect(searchOf(router).get('panel')).toBe('cliente')
    const reopened = screen.getByRole('complementary', { name: 'Panel de apoyo' })
    expect(within(reopened).getByRole('tab', { name: 'Cliente' })).toHaveAttribute(
      'aria-selected',
      'true',
    )
  })

  it('restores collapsed list and panel from the URL (contraida)', async () => {
    renderWorkspace(`/analista?caso=${FIRST}&lista=contraida&apoyo=contraido`)
    const rail = await screen.findByRole('region', { name: 'Casos, lista contraída' })
    expect(
      await within(rail).findByRole('button', { name: 'Marcela Quintana Pardo, Por responder' }),
    ).toHaveAttribute('aria-current', 'true')
    expect(
      screen.getByRole('complementary', { name: 'Panel de apoyo, contraído' }),
    ).toBeInTheDocument()
  })
})
