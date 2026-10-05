import { act, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type * as CasesApi from '@/features/cases/api'
import type * as Copilot from '@/features/copilot'
import type * as NotificationsApi from '@/features/notifications/api'
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
import {
  makeNotification,
  makeNotificationPage,
  notificationCreated,
} from '@/test/notification-fixtures'
import { renderRoute } from '@/test/render'
import { fetchNotifications, markNotificationRead } from '@/features/notifications/api'

vi.mock('@/features/cases/api', async (importOriginal) => {
  const actual = await importOriginal<typeof CasesApi>()
  return {
    ...actual,
    fetchInbox: vi.fn<typeof actual.fetchInbox>(),
    fetchAvailability: vi.fn<typeof actual.fetchAvailability>(),
    updateAvailability: vi.fn<typeof actual.updateAvailability>(),
  }
})

vi.mock('@/features/notifications/api', async (importOriginal) => {
  const actual = await importOriginal<typeof NotificationsApi>()
  return {
    ...actual,
    fetchNotifications: vi.fn<typeof actual.fetchNotifications>(),
    markNotificationRead: vi.fn<typeof actual.markNotificationRead>(),
  }
})

/** Slice 20: whether the stubbed copilot says it is available for the open case. */
const copilot = vi.hoisted(() => ({ available: false }))

/**
 * The copilot's tabs are tested in their own feature: here the Workspace's decisions (which tabs,
 * their order, the URL) are checked with stub tabs whose availability the test sets.
 */
vi.mock('@/features/copilot', async (importOriginal) => {
  const actual = await importOriginal<typeof Copilot>()
  return {
    ...actual,
    CopilotPanel: ({ caseId }: { caseId: string }) => <p>Copiloto de {caseId}</p>,
    ToolsPanel: ({ caseId, onOpenCopilot }: { caseId: string; onOpenCopilot?: () => void }) => (
      <div>
        <p>Herramientas de {caseId}</p>
        <button type="button" onClick={onOpenCopilot}>
          Ir a Copiloto
        </button>
      </div>
    ),
    useCopilotAccess: () => true,
    useCopilotThread: (caseId: string) => ({
      data: copilot.available ? { caseId, available: true, messages: [] } : undefined,
    }),
    useLatestSuggestion: () => ({
      data: copilot.available ? { available: true, suggestion: null } : undefined,
    }),
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
    onOpenHandoff,
    copilotMode,
    supportPanel,
  }: {
    caseId: string
    onClosed?: (id: string) => void
    customerFile?: { open: boolean; onToggle(): void }
    focusOnLoad?: boolean
    onFocused?: () => void
    onOpenHandoff?: () => void
    copilotMode?: string | null
    supportPanel?: { open: boolean; onToggle(): void }
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
        {onOpenHandoff ? (
          <button type="button" onClick={onOpenHandoff}>
            Ver todo
          </button>
        ) : null}
        {supportPanel ? (
          <button
            id="apoyo-del-caso-boton"
            type="button"
            aria-expanded={supportPanel.open}
            onClick={supportPanel.onToggle}
          >
            Apoyo
          </button>
        ) : null}
        <p>Copiloto en modo {copilotMode ?? 'ninguno'}</p>
      </section>
    )
  }
  /** Slice 19: the first case of the list came from the assistant; its handoff loaded. */
  const HANDOFF_CASE = 'CASE-00000000000000000000000102'
  function useCaseDetail(caseId: string) {
    return {
      data: {
        case: { id: caseId, status: 'in_progress', customer: { displayName: 'Patricia Lozano' } },
        assignment: null,
      },
    }
  }
  function useCaseHandoff(detail?: { case: { id: string } }) {
    return {
      handoff: { status: 'success' },
      available: detail?.case.id === HANDOFF_CASE,
    }
  }
  function HandoffPanel({ detail }: { detail: { case: { id: string } } }) {
    return <p>Traspaso de {detail.case.id}</p>
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
          Ficha de {caseId} · {history ?? 'list'}
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
    SUPPORT_PANEL_TRIGGER_ID: 'apoyo-del-caso-boton',
    ConversationPane,
    CustomerFile,
    HandoffPanel,
    useCaseDetail,
    useCaseHandoff,
    describeHandoffFailure: () => ({ title: '', description: '', retry: false }),
  }
})

// Daniela's open inbox in urgency order (slice 6): Beatriz (102, SLA at risk),
// Patricia (108), Larissa (103), Marcela (101), Joaquín (107).
const FIRST = 'CASE-00000000000000000000000102'
const NEXT = 'CASE-00000000000000000000000108'
const SECOND = 'CASE-00000000000000000000000101'

beforeEach(() => {
  copilot.available = false
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(NOW)
  vi.mocked(fetchInbox).mockResolvedValue(makeInbox())
  vi.mocked(fetchAvailability).mockResolvedValue(available)
  vi.mocked(updateAvailability).mockResolvedValue(available)
  vi.mocked(fetchNotifications).mockResolvedValue(makeNotificationPage([]))
  vi.mocked(markNotificationRead).mockImplementation(async (id) => ({
    notification: makeNotification({ id, readAt: NOW.toISOString() }),
    changed: true,
    unreadCount: 0,
  }))
})

afterEach(() => {
  vi.useRealTimers()
})

const renderWorkspace = (entry = '/analyst/cases', { aiEnabled = false } = {}) =>
  renderRoute(entry, { staff: analystStaff, aiEnabled })
const searchOf = (router: ReturnType<typeof renderWorkspace>['router']) =>
  new URLSearchParams(router.state.location.search)

describe('/analyst/cases (Workspace)', () => {
  it('auto-selects the first case of the list, replacing the history entry', async () => {
    const { router } = renderWorkspace()
    expect(await screen.findByText(`Conversación ${FIRST}`)).toBeInTheDocument()
    expect(searchOf(router).get('case')).toBe(FIRST)
    expect(router.state.historyAction).toBe('REPLACE')
    expect(screen.getByRole('heading', { level: 1, name: 'Casos' })).toBeInTheDocument()
    expect(screen.getByRole('main')).toContainElement(screen.getByText(`Conversación ${FIRST}`))
    expect(document.title).toBe('Casos · LATAM Bank Soporte')
  })

  it('opens the case in the URL and selects others with a new history entry', async () => {
    const { router, user } = renderWorkspace(`/analyst/cases?case=${SECOND}`)
    expect(await screen.findByText(`Conversación ${SECOND}`)).toBeInTheDocument()
    const list = await screen.findByRole('list', { name: 'Casos' })
    expect(within(list).getByRole('button', { name: /Marcela Quintana Pardo/ })).toHaveAttribute(
      'aria-current',
      'true',
    )
    await user.click(within(list).getByRole('button', { name: /Joaquín Ferreyra Paz/ }))
    expect(searchOf(router).get('case')).toBe('CASE-00000000000000000000000107')
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

  it('opens Cerrados from ?status=closed with a chip that removes the filter', async () => {
    vi.mocked(fetchInbox).mockImplementation(async ({ status }) =>
      status === 'closed' ? makeInbox(closedInbox) : makeInbox(),
    )
    const { router, user } = renderWorkspace('/analyst/cases?status=closed')
    await screen.findByText('Conversación CASE-00000000000000000000000106')
    expect(fetchInbox).toHaveBeenCalledWith({ status: 'closed', q: '' }, expect.anything())
    const list = screen.getByRole('list', { name: 'Casos' })
    expect(within(list).getByRole('button', { name: /Héctor Villarreal Garza/ })).toHaveTextContent(
      'Cerrado: hace 3 h',
    )

    await user.click(screen.getByRole('button', { name: 'Quitar filtro Cerrados' }))
    expect(searchOf(router).get('status')).toBeNull()
    expect(screen.queryByRole('button', { name: /^Quitar filtro/ })).not.toBeInTheDocument()
  })

  it('opens a case from Inicio with its filter: the card is highlighted', async () => {
    vi.mocked(fetchInbox).mockImplementation(async ({ status }) =>
      makeInbox(status ? seededInbox.filter((item) => item.inboxStatus === status) : seededInbox),
    )
    renderWorkspace(`/analyst/cases?case=${SECOND}&status=to_reply`)
    expect(await screen.findByText(`Conversación ${SECOND}`)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Quitar filtro Por responder' })).toBeInTheDocument()
    const list = await screen.findByRole('list', { name: 'Casos' })
    expect(within(list).getByRole('button', { name: /Marcela Quintana Pardo/ })).toHaveAttribute(
      'aria-current',
      'true',
    )
  })

  it('falls back to every open case for a removed filter slug', async () => {
    renderWorkspace('/analyst/cases?status=por-llamar')
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

  it('shows the empty state when the analyst has no cases (canvas `vacia`)', async () => {
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
    expect(searchOf(router).get('case')).toBeNull()
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
    expect(searchOf(router).get('case')).toBe(NEXT)
    const next = await screen.findByRole('heading', { name: `Conversación ${NEXT}` })
    await waitFor(() => expect(next).toHaveFocus())
  })

  it('moves the focus to the empty state when the last case is closed', async () => {
    vi.mocked(fetchInbox).mockResolvedValue(makeInbox([seededInbox[0]!]))
    const { router, user } = renderWorkspace()
    await screen.findByText(`Conversación ${FIRST}`)
    await user.click(screen.getByRole('button', { name: 'Simular cierre' }))
    expect(searchOf(router).get('case')).toBeNull()
    const empty = await screen.findByRole('heading', { name: 'Elige un caso de la lista' })
    await waitFor(() => expect(empty).toHaveFocus())
  })

  it('opens the case of a notification toast ("Abrir caso"), reads it and focuses it', async () => {
    const { router, user, sockets } = renderWorkspace()
    await screen.findByText(`Conversación ${FIRST}`)
    const assigned = makeNotification({ id: 'NTF-00000000000000000000000077', caseId: SECOND })
    act(() => {
      sockets.last()?.open()
      sockets.last()?.receive(notificationCreated(assigned, 1))
    })
    const toasts = screen.getByRole('region', { name: 'Avisos' })
    expect(await within(toasts).findByText('Te llegó un caso nuevo')).toBeInTheDocument()
    expect(within(toasts).getByText('Larissa Monteiro Alves')).toBeInTheDocument()
    await user.click(within(toasts).getByRole('button', { name: 'Abrir caso' }))
    expect(searchOf(router).get('case')).toBe(SECOND)
    const heading = await screen.findByRole('heading', { name: `Conversación ${SECOND}` })
    await waitFor(() => expect(heading).toHaveFocus())
    expect(markNotificationRead).toHaveBeenCalledWith(assigned.id)
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
      sockets.last()?.receive(
        notificationCreated(
          makeNotification({
            id: 'NTF-00000000000000000000000078',
            kind: 'assigned_by_supervisor',
            caseId: SECOND,
            customerName: 'Marcela Quintana Pardo',
            actorName: 'Lucía Herrera',
          }),
          1,
        ),
      )
    })
    expect(await screen.findByText('Supervisión te asignó un caso')).toBeInTheDocument()
    const list = await screen.findByRole('list', { name: 'Casos' })
    await within(list).findByRole('button', { name: /Marcela Quintana Pardo/ })
    // Opening it would mark it read and log an open she never made: it stays Nuevo.
    expect(searchOf(router).get('case')).toBeNull()
    expect(screen.queryByRole('region', { name: 'Conversación del caso' })).not.toBeInTheDocument()
    const toasts = screen.getByRole('region', { name: 'Avisos' })
    expect(within(toasts).getByRole('button', { name: 'Abrir caso' })).toBeInTheDocument()
    expect(within(toasts).getByRole('button', { name: 'Más tarde' })).toBeInTheDocument()
  })

  it('never toasts a notification about the case already open', async () => {
    const { sockets } = renderWorkspace(`/analyst/cases?case=${FIRST}`)
    await screen.findByText(`Conversación ${FIRST}`)
    act(() => {
      sockets.last()?.open()
      sockets.last()?.receive(
        notificationCreated(
          makeNotification({
            id: 'NTF-00000000000000000000000079',
            kind: 'customer_returned',
            caseId: FIRST,
          }),
          1,
        ),
      )
    })
    await waitFor(() => expect(fetchNotifications).toHaveBeenCalled())
    expect(screen.queryByText('El cliente volvió a escribir')).not.toBeInTheDocument()
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

describe('/analyst/cases "Ficha del cliente"', () => {
  it('opens from the customer name, keeps ?panel=customer, focuses the panel and closes with Escape', async () => {
    const { router, user } = renderWorkspace()
    await screen.findByText(`Conversación ${FIRST}`)
    const trigger = screen.getByRole('button', { name: 'Ver ficha de Patricia Lozano Vega' })
    expect(trigger).toHaveAttribute('aria-expanded', 'false')
    await user.click(trigger)
    expect(searchOf(router).get('panel')).toBe('customer')
    const panel = await screen.findByRole('complementary', { name: 'Ficha del cliente' })
    expect(trigger).toHaveAttribute('aria-expanded', 'true')
    expect(panel).toHaveAttribute('id', 'ficha-del-cliente')
    expect(panel).toHaveTextContent(`Ficha de ${FIRST} · list`)
    await waitFor(() =>
      expect(
        within(panel).getByRole('heading', { level: 2, name: 'Ficha del cliente' }),
      ).toHaveFocus(),
    )
    // The conversation keeps working next to it.
    expect(screen.getByText(`Conversación ${FIRST}`)).toBeInTheDocument()

    await user.keyboard('{Escape}')
    expect(searchOf(router).get('panel')).toBeNull()
    expect(screen.queryByRole('complementary')).not.toBeInTheDocument()
    await waitFor(() => expect(trigger).toHaveFocus())
  })

  it('shows "Casos anteriores" in the panel, in the URL, and closes with its button', async () => {
    const { router, user } = renderWorkspace(`/analyst/cases?case=${FIRST}&panel=customer`)
    const panel = await screen.findByRole('complementary', { name: 'Ficha del cliente' })
    // Restored from the URL: the focus is left alone.
    expect(within(panel).getByRole('heading', { level: 2 })).not.toHaveFocus()
    await user.click(within(panel).getByRole('button', { name: 'Abrir caso 110' }))
    expect(searchOf(router).get('previous')).toBe('CASE-00000000000000000000000110')
    expect(router.state.historyAction).toBe('REPLACE')
    expect(panel).toHaveTextContent(`Ficha de ${FIRST} · CASE-00000000000000000000000110`)

    await user.click(within(panel).getByRole('button', { name: 'Cerrar la ficha del cliente' }))
    expect(searchOf(router).get('panel')).toBeNull()
    expect(searchOf(router).get('previous')).toBeNull()
    expect(screen.queryByRole('complementary')).not.toBeInTheDocument()
  })

  it('opens the panel from a ?previous= deep link and keeps it open on another case', async () => {
    const { router, user } = renderWorkspace(
      `/analyst/cases?case=${FIRST}&previous=CASE-00000000000000000000000110`,
    )
    expect(
      await screen.findByText(`Ficha de ${FIRST} · CASE-00000000000000000000000110`),
    ).toBeInTheDocument()
    const list = await screen.findByRole('list', { name: 'Casos' })
    await user.click(within(list).getByRole('button', { name: /Joaquín Ferreyra Paz/ }))
    expect(searchOf(router).get('case')).toBe('CASE-00000000000000000000000107')
    expect(searchOf(router).get('previous')).toBeNull()
    expect(searchOf(router).get('panel')).toBe('customer')
    expect(
      await screen.findByText('Ficha de CASE-00000000000000000000000107 · list'),
    ).toBeInTheDocument()
  })

  it('ignores unknown params and restores a collapsed list', async () => {
    const { router } = renderWorkspace(
      `/analyst/cases?case=${SECOND}&list=collapsed&panel=support&apoyo=contraido`,
    )
    const rail = await screen.findByRole('region', { name: 'Casos, lista contraída' })
    expect(
      await within(rail).findByRole('button', { name: 'Marcela Quintana Pardo, Por responder' }),
    ).toHaveAttribute('aria-current', 'true')
    expect(screen.queryByRole('complementary')).not.toBeInTheDocument()
    // The next URL write drops them.
    expect(router.state.location.search).toContain('list=collapsed')
  })
})

describe('/analyst/cases right panel with AI on (slice 19)', () => {
  it('turns the ficha into the "Cliente" tab and opens "Traspaso" from "Ver todo"', async () => {
    const { router, user } = renderWorkspace('/analyst/cases', { aiEnabled: true })
    await screen.findByText(`Conversación ${FIRST}`)
    await user.click(screen.getByRole('button', { name: 'Ver ficha de Patricia Lozano Vega' }))
    expect(searchOf(router).get('panel')).toBe('customer')
    const panel = await screen.findByRole('complementary', { name: 'Apoyo del caso' })
    expect(panel).toHaveAttribute('id', 'ficha-del-cliente')
    const tabs = within(panel).getByRole('tablist', { name: 'Apoyo' })
    expect(
      within(tabs)
        .getAllByRole('tab')
        .map((tab) => tab.textContent),
    ).toEqual(['Traspaso', 'Cliente'])
    expect(within(tabs).getByRole('tab', { name: 'Cliente' })).toHaveAttribute(
      'aria-selected',
      'true',
    )
    expect(panel).toHaveTextContent(`Ficha de ${FIRST} · list`)

    await user.click(within(tabs).getByRole('tab', { name: 'Traspaso' }))
    expect(searchOf(router).get('panel')).toBe('handoff')
    expect(panel).toHaveTextContent(`Traspaso de ${FIRST}`)

    await user.click(within(panel).getByRole('button', { name: 'Cerrar el panel de apoyo' }))
    expect(searchOf(router).get('panel')).toBeNull()
    await user.click(screen.getByRole('button', { name: 'Ver todo' }))
    expect(searchOf(router).get('panel')).toBe('handoff')
    const reopened = await screen.findByRole('complementary', { name: 'Apoyo del caso' })
    expect(within(reopened).getByRole('tab', { name: 'Traspaso' })).toHaveAttribute(
      'aria-selected',
      'true',
    )
  })

  it('has only "Cliente" for a case the assistant did not hand over', async () => {
    renderWorkspace(`/analyst/cases?case=${SECOND}&panel=handoff`, { aiEnabled: true })
    const panel = await screen.findByRole('complementary', { name: 'Apoyo del caso' })
    expect(
      within(panel)
        .getAllByRole('tab')
        .map((tab) => tab.textContent),
    ).toEqual(['Cliente'])
    expect(panel).toHaveTextContent(`Ficha de ${SECOND} · list`)
  })

  it('keeps the old ficha and ignores the handoff tab with AI off', async () => {
    renderWorkspace(`/analyst/cases?case=${FIRST}&panel=handoff`)
    await screen.findByText(`Conversación ${FIRST}`)
    expect(screen.queryByRole('complementary')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Ver todo' })).not.toBeInTheDocument()
  })
})

describe('/analyst/cases right panel with the copilot (slice 20)', () => {
  const tabNames = (panel: HTMLElement) =>
    within(panel)
      .getAllByRole('tab')
      .map((tab) => tab.textContent)

  it('"Apoyo" opens it at "Copiloto": Traspaso, Copiloto, Herramientas, Cliente', async () => {
    copilot.available = true
    const { router, user } = renderWorkspace('/analyst/cases', { aiEnabled: true })
    await screen.findByText(`Conversación ${FIRST}`)
    expect(screen.getByText('Copiloto en modo drafts')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Apoyo' }))
    expect(searchOf(router).get('panel')).toBe('copilot')
    const panel = await screen.findByRole('complementary', { name: 'Apoyo del caso' })
    expect(tabNames(panel)).toEqual(['Traspaso', 'Copiloto', 'Herramientas', 'Cliente'])
    expect(within(panel).getByRole('tab', { name: 'Copiloto' })).toHaveAttribute(
      'aria-selected',
      'true',
    )
    expect(panel).toHaveTextContent(`Copiloto de ${FIRST}`)
    expect(screen.getByRole('button', { name: 'Apoyo' })).toHaveAttribute('aria-expanded', 'true')

    await user.click(within(panel).getByRole('tab', { name: 'Herramientas' }))
    expect(searchOf(router).get('panel')).toBe('tools')
    await user.click(within(panel).getByRole('button', { name: 'Ir a Copiloto' }))
    expect(searchOf(router).get('panel')).toBe('copilot')

    await user.click(within(panel).getByRole('button', { name: 'Cerrar el panel de apoyo' }))
    expect(searchOf(router).get('panel')).toBeNull()
    await waitFor(() => expect(screen.getByRole('button', { name: 'Apoyo' })).toHaveFocus())
  })

  it('keeps ?panel=customer and ?panel=tools working for a case with no handoff', async () => {
    copilot.available = true
    const { unmount } = renderWorkspace(`/analyst/cases?case=${SECOND}&panel=customer`, {
      aiEnabled: true,
    })
    const panel = await screen.findByRole('complementary', { name: 'Apoyo del caso' })
    expect(tabNames(panel)).toEqual(['Copiloto', 'Herramientas', 'Cliente'])
    expect(within(panel).getByRole('tab', { name: 'Cliente' })).toHaveAttribute(
      'aria-selected',
      'true',
    )
    unmount()

    renderWorkspace(`/analyst/cases?case=${SECOND}&panel=tools`, { aiEnabled: true })
    const tools = await screen.findByRole('complementary', { name: 'Apoyo del caso' })
    expect(tools).toHaveTextContent(`Herramientas de ${SECOND}`)
  })

  it('has no copilot tabs while the copilot is unavailable for the customer', async () => {
    renderWorkspace(`/analyst/cases?case=${SECOND}&panel=copilot`, { aiEnabled: true })
    const panel = await screen.findByRole('complementary', { name: 'Apoyo del caso' })
    expect(tabNames(panel)).toEqual(['Cliente'])
  })

  it('ignores the copilot with AI off: no "Apoyo", no mode, no panel for ?panel=copilot', async () => {
    copilot.available = true
    renderWorkspace(`/analyst/cases?case=${FIRST}&panel=copilot`)
    await screen.findByText(`Conversación ${FIRST}`)
    expect(screen.getByText('Copiloto en modo ninguno')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Apoyo' })).toBeNull()
    expect(screen.queryByRole('complementary')).not.toBeInTheDocument()
  })
})
