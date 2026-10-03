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
  /** Stub pane: a focusable heading that takes the focus when asked, like the real one. */
  function ConversationPane({
    caseId,
    onClosed,
    onOpenHistory,
    focusOnLoad,
    onFocused,
  }: {
    caseId: string
    onClosed?: (id: string) => void
    onOpenHistory?: () => void
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
        <button type="button" onClick={() => onOpenHistory?.()}>
          Casos anteriores (2)
        </button>
      </section>
    )
  }
  /** Stub sheet: shows what the Workspace passes and lets the test drive it. */
  function CaseHistorySheet({
    caseId,
    customerName,
    selected,
    onSelect,
    onClose,
  }: {
    caseId: string
    customerName: string
    selected: string
    onSelect: (selected: string) => void
    onClose: () => void
  }) {
    return (
      <dialog open aria-label={`Casos anteriores de ${customerName}`}>
        <p>
          Historial de {caseId} · {selected}
        </p>
        <button type="button" onClick={() => onSelect('CASE-00000000000000000000000110')}>
          Abrir caso 110
        </button>
        <button type="button" onClick={onClose}>
          Cerrar historial
        </button>
      </dialog>
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
    ConversationPane,
    CaseHistorySheet,
    useCaseDetail: (caseId: string | null) => ({
      status: 'success',
      isFetching: false,
      refetch: () => {},
      data: caseId
        ? {
            customer: {
              id: 'CUS-00000000000000000000001004',
              displayName: 'Patricia Lozano Vega',
              country: 'MX',
              city: 'Guadalajara',
              locale: 'es-MX',
              language: 'es',
            },
          }
        : undefined,
    }),
  }
})

// Order of Daniela's open inbox in the fixtures: Beatriz (102), Marcela (101), …
const FIRST = 'CASE-00000000000000000000000102'
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

  it('renders two columns: the list and the conversation, with no support panel', async () => {
    renderWorkspace()
    await screen.findByText(`Conversación ${FIRST}`)
    expect(screen.getByRole('region', { name: 'Casos abiertos' })).toBeInTheDocument()
    expect(screen.getByRole('main')).toBeInTheDocument()
    expect(screen.queryByRole('complementary')).not.toBeInTheDocument()
    expect(screen.queryByRole('tablist')).not.toBeInTheDocument()
    const filters = screen.getByRole('radiogroup', { name: 'Filtrar casos' })
    for (const name of [
      '5 Todos',
      '2 Por responder',
      '2 Nuevos',
      '1 Esperando al cliente',
      '3 Cerrados',
    ]) {
      expect(within(filters).getByRole('radio', { name })).toBeInTheDocument()
    }
  })

  it('opens Cerrados from ?estado=cerrados, read-only cards, and keeps the filter in the URL', async () => {
    vi.mocked(fetchInbox).mockImplementation(async ({ status }) =>
      status === 'closed' ? makeInbox(closedInbox) : makeInbox(),
    )
    const { router, user } = renderWorkspace('/analista?estado=cerrados')
    expect(await screen.findByRole('radio', { name: '3 Cerrados' })).toBeChecked()
    await screen.findByText('Conversación CASE-00000000000000000000000106')
    expect(fetchInbox).toHaveBeenCalledWith({ status: 'closed', q: '' }, expect.anything())
    const list = screen.getByRole('list', { name: 'Casos' })
    expect(
      within(list).getByRole('button', { name: /Héctor Villarreal Garza, Cerrado/ }),
    ).toHaveTextContent('Cerrado hace 3 h')

    await user.click(screen.getByRole('radio', { name: '5 Todos' }))
    expect(searchOf(router).get('estado')).toBeNull()
    await user.click(screen.getByRole('radio', { name: '1 Esperando al cliente' }))
    expect(searchOf(router).get('estado')).toBe('esperando')
  })

  it('falls back to Todos for a removed filter slug', async () => {
    renderWorkspace('/analista?estado=por-llamar')
    expect(await screen.findByRole('radio', { name: '5 Todos' })).toBeChecked()
    expect(fetchInbox).toHaveBeenCalledWith({ status: null, q: '' }, expect.anything())
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

describe('/analista "Casos anteriores"', () => {
  it('opens the history sheet through the URL and closes it again', async () => {
    const { router, user } = renderWorkspace()
    await screen.findByText(`Conversación ${FIRST}`)
    await user.click(screen.getByRole('button', { name: 'Casos anteriores (2)' }))
    expect(searchOf(router).get('historial')).toBe('lista')
    const sheet = await screen.findByRole('dialog', {
      name: 'Casos anteriores de Patricia Lozano Vega',
    })
    expect(sheet).toHaveTextContent(`Historial de ${FIRST} · lista`)

    await user.click(within(sheet).getByRole('button', { name: 'Abrir caso 110' }))
    expect(searchOf(router).get('historial')).toBe('CASE-00000000000000000000000110')
    expect(router.state.historyAction).toBe('REPLACE')

    await user.click(within(sheet).getByRole('button', { name: 'Cerrar historial' }))
    expect(searchOf(router).get('historial')).toBeNull()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('restores the sheet on a past case from the URL and drops it when another case is picked', async () => {
    const { router, user } = renderWorkspace(
      `/analista?caso=${FIRST}&historial=CASE-00000000000000000000000110`,
    )
    expect(
      await screen.findByText(`Historial de ${FIRST} · CASE-00000000000000000000000110`),
    ).toBeInTheDocument()
    const list = await screen.findByRole('list', { name: 'Casos' })
    await user.click(within(list).getByRole('button', { name: /Joaquín Ferreyra Paz/ }))
    expect(searchOf(router).get('caso')).toBe('CASE-00000000000000000000000107')
    expect(searchOf(router).get('historial')).toBeNull()
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
