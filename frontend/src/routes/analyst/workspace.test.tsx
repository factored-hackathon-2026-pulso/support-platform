import { act, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type * as CasesApi from '@/features/cases/api'
import { fetchAvailability, fetchInbox, updateAvailability } from '@/features/cases/api'
import { ApiProblem } from '@/lib/api'
import {
  NOW,
  available,
  closedInbox,
  emptyInbox,
  makeInbox,
  paused,
  seededInbox,
} from '@/test/case-fixtures'
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
  const TRIGGER = 'ficha-del-cliente-boton'
  /** Stub pane: a focusable heading that takes the focus when asked, like the real one. */
  function ConversationPane({
    caseId,
    onClosed,
    customerFile,
    focusOnLoad,
    onFocused,
  }: {
    caseId: string
    onClosed?: (id: string) => void
    customerFile?: { open: boolean; onToggle(): void }
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
        {customerFile ? (
          <button
            id={TRIGGER}
            type="button"
            aria-expanded={customerFile.open}
            onClick={customerFile.onToggle}
          >
            Ver ficha de Patricia Lozano Vega
          </button>
        ) : null}
      </section>
    )
  }
  /** Stub sections: show what the Workspace passes and let the test drive them. */
  function CustomerFile({
    caseId,
    history,
    onHistoryChange,
  }: {
    caseId: string
    history: string | null
    onHistoryChange: (history: string) => void
  }) {
    return (
      <div>
        <p>
          Ficha de {caseId} · {history ?? 'lista'}
        </p>
        <button type="button" onClick={() => onHistoryChange('CASE-00000000000000000000000110')}>
          Abrir caso 110
        </button>
      </div>
    )
  }
  return {
    conversationKeys: {
      all: ['conversation'],
      detail: (caseId: string) => ['conversation', caseId, 'detail'],
      turns: (caseId: string) => ['conversation', caseId, 'turns'],
      history: (caseId: string) => ['conversation', caseId, 'history'],
    },
    registerConversationRealtime: () => {},
    CUSTOMER_FILE_PANEL_ID: 'ficha-del-cliente',
    CUSTOMER_FILE_TRIGGER_ID: TRIGGER,
    ConversationPane,
    CustomerFile,
  }
})

// Daniela's open inbox in urgency order (slice 6): Beatriz (102, SLA at risk),
// Patricia (108), Larissa (103), Marcela (101), Joaquín (107).
const FIRST = 'CASE-00000000000000000000000102'
const NEXT = 'CASE-00000000000000000000000108'
const SECOND = 'CASE-00000000000000000000000101'

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
    expect(within(list).getByRole('button', { name: /Marcela Quintana Pardo/ })).toHaveAttribute(
      'aria-current',
      'true',
    )
    await user.click(within(list).getByRole('button', { name: /Joaquín Ferreyra Paz/ }))
    expect(searchOf(router).get('caso')).toBe('CASE-00000000000000000000000107')
    expect(router.state.historyAction).toBe('PUSH')
    expect(screen.getByText('Conversación CASE-00000000000000000000000107')).toBeInTheDocument()
  })

  it('renders the list and the conversation, no status tiles and no panel until asked', async () => {
    renderWorkspace()
    await screen.findByText(`Conversación ${FIRST}`)
    expect(screen.getByRole('region', { name: 'Casos abiertos' })).toBeInTheDocument()
    expect(screen.getByRole('main')).toBeInTheDocument()
    expect(screen.queryByRole('complementary')).not.toBeInTheDocument()
    expect(screen.queryByRole('tablist')).not.toBeInTheDocument()
    expect(screen.queryByRole('radiogroup', { name: 'Filtrar casos' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^Quitar filtro/ })).not.toBeInTheDocument()
  })

  it('opens Cerrados from ?estado=cerrados with a chip that removes the filter', async () => {
    vi.mocked(fetchInbox).mockImplementation(async ({ status }) =>
      status === 'closed' ? makeInbox(closedInbox) : makeInbox(),
    )
    const { router, user } = renderWorkspace('/analista?estado=cerrados')
    await screen.findByText('Conversación CASE-00000000000000000000000106')
    expect(fetchInbox).toHaveBeenCalledWith({ status: 'closed', q: '' }, expect.anything())
    const list = screen.getByRole('list', { name: 'Casos' })
    expect(within(list).getByRole('button', { name: /Héctor Villarreal Garza/ })).toHaveTextContent(
      'Cerrado: hace 3 h',
    )

    await user.click(screen.getByRole('button', { name: 'Quitar filtro Cerrados' }))
    expect(searchOf(router).get('estado')).toBeNull()
    expect(screen.queryByRole('button', { name: /^Quitar filtro/ })).not.toBeInTheDocument()
  })

  it('opens a case from Inicio with its filter: the card is highlighted', async () => {
    vi.mocked(fetchInbox).mockImplementation(async ({ status }) =>
      makeInbox(status ? seededInbox.filter((item) => item.inboxStatus === status) : seededInbox),
    )
    renderWorkspace(`/analista?caso=${SECOND}&estado=por-responder`)
    expect(await screen.findByText(`Conversación ${SECOND}`)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Quitar filtro Por responder' })).toBeInTheDocument()
    const list = await screen.findByRole('list', { name: 'Casos' })
    expect(within(list).getByRole('button', { name: /Marcela Quintana Pardo/ })).toHaveAttribute(
      'aria-current',
      'true',
    )
  })

  it('falls back to every open case for a removed filter slug', async () => {
    renderWorkspace('/analista?estado=por-llamar')
    await screen.findByText(`Conversación ${FIRST}`)
    expect(fetchInbox).toHaveBeenCalledWith({ status: null, q: '' }, expect.anything())
    expect(screen.queryByRole('button', { name: /^Quitar filtro/ })).not.toBeInTheDocument()
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
      await screen.findByRole('heading', { level: 2, name: 'No tienes casos abiertos' }),
    ).toBeInTheDocument()
    expect(
      screen.getByText(
        'Estás disponible. Cuando un cliente escriba y te corresponda, aparece aquí.',
      ),
    ).toBeInTheDocument()
    expect(screen.getByText('Nada pendiente.')).toBeInTheDocument()
    expect(searchOf(router).get('caso')).toBeNull()
  })

  it('explains the empty inbox while paused (pausa)', async () => {
    vi.mocked(fetchInbox).mockResolvedValue(emptyInbox)
    vi.mocked(fetchAvailability).mockResolvedValue(paused)
    renderWorkspace()
    expect(
      await screen.findByText(/^Estás en pausa: no te llegan casos nuevos/),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: 'En pausa. Volver a disponible' }),
    ).toBeInTheDocument()
    expect(screen.queryByText('Los que ya tienes siguen contigo.')).not.toBeInTheDocument()
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
    // The one below it in the list (urgency order).
    expect(searchOf(router).get('caso')).toBe(NEXT)
    const next = await screen.findByRole('heading', { name: `Conversación ${NEXT}` })
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

  it('keeps a case assigned over the socket in the toast and never opens it on its own', async () => {
    const assigned = { ...seededInbox[1]!, version: 99 }
    vi.mocked(fetchInbox)
      .mockResolvedValueOnce(emptyInbox)
      .mockResolvedValue(makeInbox([assigned]))
    const { router, sockets } = renderWorkspace()
    await screen.findByRole('heading', { level: 2, name: 'No tienes casos abiertos' })
    act(() => {
      sockets.last()?.open()
      sockets.last()?.receive({
        type: 'case.assigned',
        id: 'EVT-ASSIGNED-10',
        occurredAt: NOW.toISOString(),
        data: {
          entity: 'case',
          entityId: SECOND,
          caseId: SECOND,
          actor: { role: 'supervisor', id: 'STF-00000000000000000000000005' },
          payload: assigned,
        },
      })
    })
    expect(await screen.findByText('Te asignaron un caso')).toBeInTheDocument()
    const list = await screen.findByRole('list', { name: 'Casos' })
    await within(list).findByRole('button', { name: /Marcela Quintana Pardo/ })
    // Opening it would mark it read and log an open she never made: it stays Nuevo.
    expect(searchOf(router).get('caso')).toBeNull()
    expect(screen.queryByRole('region', { name: 'Conversación del caso' })).not.toBeInTheDocument()
    expect(screen.getByText('Te asignaron un caso')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Ver caso' })).toBeInTheDocument()
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

describe('/analista "Ficha del cliente"', () => {
  it('opens from the customer name, keeps ?ficha=1, focuses the panel and closes with Escape', async () => {
    const { router, user } = renderWorkspace()
    await screen.findByText(`Conversación ${FIRST}`)
    const trigger = screen.getByRole('button', { name: 'Ver ficha de Patricia Lozano Vega' })
    expect(trigger).toHaveAttribute('aria-expanded', 'false')
    await user.click(trigger)
    expect(searchOf(router).get('ficha')).toBe('1')
    const panel = await screen.findByRole('complementary', { name: 'Ficha del cliente' })
    expect(trigger).toHaveAttribute('aria-expanded', 'true')
    expect(panel).toHaveAttribute('id', 'ficha-del-cliente')
    expect(panel).toHaveTextContent(`Ficha de ${FIRST} · lista`)
    await waitFor(() =>
      expect(
        within(panel).getByRole('heading', { level: 2, name: 'Ficha del cliente' }),
      ).toHaveFocus(),
    )
    // The conversation keeps working next to it.
    expect(screen.getByText(`Conversación ${FIRST}`)).toBeInTheDocument()

    await user.keyboard('{Escape}')
    expect(searchOf(router).get('ficha')).toBeNull()
    expect(screen.queryByRole('complementary')).not.toBeInTheDocument()
    await waitFor(() => expect(trigger).toHaveFocus())
  })

  it('shows "Casos anteriores" in the panel, in the URL, and closes with its button', async () => {
    const { router, user } = renderWorkspace(`/analista?caso=${FIRST}&ficha=1`)
    const panel = await screen.findByRole('complementary', { name: 'Ficha del cliente' })
    // Restored from the URL: the focus is left alone.
    expect(within(panel).getByRole('heading', { level: 2 })).not.toHaveFocus()
    await user.click(within(panel).getByRole('button', { name: 'Abrir caso 110' }))
    expect(searchOf(router).get('historial')).toBe('CASE-00000000000000000000000110')
    expect(router.state.historyAction).toBe('REPLACE')
    expect(panel).toHaveTextContent(`Ficha de ${FIRST} · CASE-00000000000000000000000110`)

    await user.click(within(panel).getByRole('button', { name: 'Cerrar la ficha del cliente' }))
    expect(searchOf(router).get('ficha')).toBeNull()
    expect(searchOf(router).get('historial')).toBeNull()
    expect(screen.queryByRole('complementary')).not.toBeInTheDocument()
  })

  it('maps the old ?historial= link to the panel and keeps it open on another case', async () => {
    const { router, user } = renderWorkspace(
      `/analista?caso=${FIRST}&historial=CASE-00000000000000000000000110`,
    )
    expect(
      await screen.findByText(`Ficha de ${FIRST} · CASE-00000000000000000000000110`),
    ).toBeInTheDocument()
    const list = await screen.findByRole('list', { name: 'Casos' })
    await user.click(within(list).getByRole('button', { name: /Joaquín Ferreyra Paz/ }))
    expect(searchOf(router).get('caso')).toBe('CASE-00000000000000000000000107')
    expect(searchOf(router).get('historial')).toBeNull()
    expect(searchOf(router).get('ficha')).toBe('1')
    expect(
      await screen.findByText('Ficha de CASE-00000000000000000000000107 · lista'),
    ).toBeInTheDocument()
  })

  it('ignores the removed panel params and restores a collapsed list (contraida)', async () => {
    const { router } = renderWorkspace(
      `/analista?caso=${SECOND}&lista=contraida&panel=cliente&apoyo=contraido`,
    )
    const rail = await screen.findByRole('region', { name: 'Casos, lista contraída' })
    expect(
      await within(rail).findByRole('button', { name: 'Marcela Quintana Pardo, Por responder' }),
    ).toHaveAttribute('aria-current', 'true')
    expect(screen.queryByRole('complementary')).not.toBeInTheDocument()
    // The next URL write drops them.
    expect(router.state.location.search).toContain('lista=contraida')
  })
})
