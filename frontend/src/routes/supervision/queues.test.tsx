import { act, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type * as SupervisionApi from '@/features/supervision/api'
import {
  fetchEscalations,
  fetchOpenCases,
  fetchQueueOverview,
  fetchTeamOverview,
  releaseFromAssistant,
} from '@/features/supervision/api'
import { ApiProblem } from '@/lib/api'
import { NOW } from '@/test/case-fixtures'
import { supervisorStaff } from '@/test/fixtures'
import { makeNotification, notificationCreated } from '@/test/notification-fixtures'
import { renderRoute } from '@/test/render'
import {
  JULIAN_ID,
  julianCamila,
  makeEscalationOverview,
  makeOpenCases,
  makeQueueOverview,
  makeTeamOverview,
  portugueseOpenCases,
  queuedGabriela,
  queuedRosa,
} from '@/test/supervision-fixtures'

vi.mock('@/features/supervision/api', async (importOriginal) => {
  const actual = await importOriginal<typeof SupervisionApi>()
  return {
    ...actual,
    fetchTeamOverview: vi.fn<typeof actual.fetchTeamOverview>(),
    fetchQueueOverview: vi.fn<typeof actual.fetchQueueOverview>(),
    fetchEscalations: vi.fn<typeof actual.fetchEscalations>(),
    fetchOpenCases: vi.fn<typeof actual.fetchOpenCases>(),
    releaseFromAssistant: vi.fn<typeof actual.releaseFromAssistant>(),
  }
})

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(NOW)
  vi.mocked(fetchTeamOverview).mockResolvedValue(makeTeamOverview())
  vi.mocked(fetchQueueOverview).mockResolvedValue(makeQueueOverview())
  vi.mocked(fetchEscalations).mockResolvedValue(makeEscalationOverview())
  vi.mocked(fetchOpenCases).mockImplementation((language) =>
    Promise.resolve(language === 'pt' ? portugueseOpenCases : makeOpenCases()),
  )
})

afterEach(() => {
  vi.useRealTimers()
})

function renderQueues(path = '/supervision/queues') {
  return renderRoute(path, { staff: supervisorStaff })
}

const table = () => screen.getByRole('table', { name: 'Casos abiertos en español' })
const row = (name: RegExp) => within(table()).getByRole('row', { name })

describe('queues screen ("Colas")', () => {
  it('lists every open case of the language, with no "Asignar" anywhere', async () => {
    renderQueues()
    expect(await screen.findByRole('heading', { level: 1, name: 'Colas' })).toBeInTheDocument()
    expect(
      screen.getByText(/La asignación es automática: cada caso le llega a la primera persona/),
    ).toBeInTheDocument()
    await screen.findByRole('table', { name: 'Casos abiertos en español' })
    expect(screen.queryByRole('button', { name: /Asignar/ })).not.toBeInTheDocument()
    for (const header of ['Cliente', 'Estado', 'Abierto', 'Primera respuesta', 'Lo tiene']) {
      expect(within(table()).getByRole('columnheader', { name: header })).toBeVisible()
    }
    const rosa = row(/Rosa Elena Ibarra Méndez/)
    expect(within(rosa).getAllByText('Sin asignar')).toHaveLength(2) // status and holder
    expect(within(rosa).getByText('Canal: Chat en la app')).toBeInTheDocument()
    expect(within(rosa).getByText('2 min')).toBeInTheDocument()
    const mauricio = row(/Mauricio Achával Ríos/)
    expect(within(mauricio).getByText('Vencida')).toBeInTheDocument()
    expect(within(mauricio).getAllByText('Prioridad alta').length).toBeGreaterThan(0)
    const camila = row(/Camila Torres Benavides/)
    expect(within(camila).getByText('Escalado')).toBeInTheDocument()
    expect(within(camila).getByText('Julián Ortega')).toBeInTheDocument()
    expect(within(row(/Esteban Morales Quiroga/)).getByText('Respondida')).toBeInTheDocument()
    expect(within(rosa).getByRole('link', { name: 'Rosa Elena Ibarra Méndez' })).toHaveAttribute(
      'href',
      `/supervision/cases/${queuedRosa.id}`,
    )
  })

  it('shows each queue with its figures and switches language in the URL', async () => {
    const { user, router } = renderQueues()
    const nav = await screen.findByRole('navigation', { name: 'Idioma' })
    // Each queue is its language mark (globe + code), named "Cola en …".
    const spanish = within(nav).getByRole('button', { name: /^Cola en español/ })
    expect(spanish).toHaveTextContent(/^Cola en españolES/)
    expect(spanish.querySelector('[data-languages="es"] svg.lucide-globe')).not.toBeNull()
    expect(spanish).toHaveAttribute('aria-pressed', 'true')
    expect(await within(spanish).findByText('2 sin asignar')).toBeInTheDocument()
    const portuguese = within(nav).getByRole('button', { name: /^Cola en portugués/ })
    expect(within(portuguese).getByText('2 abiertos')).toBeInTheDocument()
    await user.click(portuguese)
    expect(router.state.location.search).toBe('?language=pt')
    const ptTable = await screen.findByRole('table', { name: 'Casos abiertos en portugués' })
    const title = screen.getByRole('heading', { level: 2, name: 'Cola en portugués' })
    expect(title.querySelector('[data-languages="pt"] svg.lucide-globe')).not.toBeNull()
    expect(within(ptTable).getByText('Gabriela Duarte Melo')).toBeInTheDocument()
    expect(fetchOpenCases).toHaveBeenCalledWith('pt', expect.anything())
  })

  it('filters by status, priority and analyst with chips, and opens a case', async () => {
    const { user, router } = renderQueues()
    await screen.findByRole('table', { name: 'Casos abiertos en español' })
    await user.click(screen.getByRole('button', { name: 'Filtros' }))
    await user.click(screen.getByRole('checkbox', { name: 'Julián Ortega 2' }))
    expect(router.state.location.search).toBe(`?analyst=${JULIAN_ID}`)
    await user.click(screen.getByRole('checkbox', { name: 'Por responder 1' }))
    expect(within(table()).getAllByRole('row')).toHaveLength(2)
    expect(screen.getByText(/^1 de \d+ casos abiertos$/)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Listo' }))
    await user.click(screen.getByRole('button', { name: 'Quitar filtro Julián Ortega' }))
    expect(router.state.location.search).toBe('?status=to_reply')

    await user.click(row(/Camila Torres Benavides/).querySelector('td:nth-child(3)')!)
    await waitFor(() =>
      expect(router.state.location.pathname).toBe(`/supervision/cases/${julianCamila.id}`),
    )
    expect(router.state.location.state).toEqual({ from: '/supervision/queues?status=to_reply' })
  })

  it('says when a queue is empty or nothing matches', async () => {
    vi.mocked(fetchOpenCases).mockResolvedValue({ ...portugueseOpenCases, cases: [] })
    renderQueues('/supervision/queues?language=pt')
    expect(await screen.findByText('No hay casos abiertos en portugués')).toBeInTheDocument()
  })

  it('offers to clear filters that match nothing', async () => {
    const { user, router } = renderQueues('/supervision/queues?priority=critical')
    expect(await screen.findByText('Ningún caso coincide con los filtros.')).toBeInTheDocument()
    await user.click(screen.getAllByRole('button', { name: 'Limpiar filtros' }).at(-1)!)
    await waitFor(() => expect(router.state.location.search).toBe(''))
  })

  it('shows the error with a retry', async () => {
    vi.mocked(fetchOpenCases).mockRejectedValue(ApiProblem.network())
    renderQueues()
    expect(await screen.findByText('No pudimos cargar los casos')).toBeInTheDocument()
  })

  it('refetches on queue signals; the queued-case toast comes from the bell, with "Ver en la cola"', async () => {
    const { user, sockets, router } = renderQueues()
    await screen.findByRole('table', { name: 'Casos abiertos en español' })
    const calls = vi.mocked(fetchOpenCases).mock.calls.length
    act(() => {
      sockets.last()?.open()
      sockets.last()?.receive({
        type: 'queue.case_queued',
        id: 'EVT-Q-9',
        occurredAt: NOW.toISOString(),
        data: {
          entity: 'case',
          entityId: queuedGabriela.id,
          caseId: queuedGabriela.id,
          actor: { role: 'system', id: null },
          payload: queuedGabriela,
        },
      })
    })
    await waitFor(() => expect(vi.mocked(fetchOpenCases).mock.calls.length).toBeGreaterThan(calls))
    // The signal alone toasts nothing: the notification stream does (slice 10).
    const toasts = screen.getByRole('region', { name: 'Avisos' })
    expect(within(toasts).queryByText('Un caso espera en la cola en portugués')).toBeNull()
    act(() => {
      sockets.last()?.receive(
        notificationCreated(
          makeNotification({
            id: 'NTF-00000000000000000000000090',
            kind: 'case_queued',
            role: 'supervisor',
            caseId: queuedGabriela.id,
            customerName: 'Gabriela Duarte Melo',
            language: 'pt',
          }),
          1,
        ),
      )
    })
    expect(
      await within(toasts).findByText('Un caso espera en la cola en portugués'),
    ).toBeInTheDocument()
    await user.click(within(toasts).getByRole('button', { name: 'Ver en la cola' }))
    await waitFor(() => expect(router.state.location.search).toBe('?language=pt'))
  })
})

describe('queues screen with the assistant (slice 19)', () => {
  const ximena = {
    ...queuedRosa,
    id: 'CASE-00000000000000000000000119',
    customer: { ...queuedRosa.customer, displayName: 'Ximena Robles Treviño' },
    status: 'with_assistant' as const,
    inboxStatus: null,
  }
  const withAssistant = () => {
    const open = makeOpenCases()
    return { ...open, cases: [...open.cases, { case: ximena, assigneeName: null }] }
  }

  beforeEach(() => {
    vi.mocked(fetchOpenCases).mockImplementation((language) =>
      Promise.resolve(language === 'pt' ? portugueseOpenCases : withAssistant()),
    )
    vi.mocked(releaseFromAssistant).mockReset()
  })

  it('lists the case last, held by "Asistente virtual", and takes it into the queue', async () => {
    vi.mocked(releaseFromAssistant).mockResolvedValue({ ...ximena, status: 'queued' })
    const { user } = renderRoute('/supervision/queues', { staff: supervisorStaff, aiEnabled: true })
    await screen.findByRole('table', { name: 'Casos abiertos en español' })
    const rows = within(table()).getAllByRole('row')
    const last = rows[rows.length - 1]!
    expect(last).toHaveAccessibleName(/Ximena Robles Treviño/)
    expect(within(last).getByText('Con el asistente')).toBeInTheDocument()
    expect(within(last).getByText('No corre')).toBeInTheDocument()
    expect(within(last).getByText('Asistente virtual')).toBeInTheDocument()
    expect(within(last).queryByText('Sin asignar')).not.toBeInTheDocument()
    expect(last.querySelector('[data-status-shape="bot"]')).not.toBeNull()
    // The language card counts it apart.
    expect(screen.getByRole('button', { name: /Cola en español/ })).toHaveTextContent(
      '1 con el asistente',
    )

    const fetches = vi.mocked(fetchOpenCases).mock.calls.length
    await user.click(
      within(last).getByRole('button', { name: 'Tomar el caso de Ximena Robles Treviño' }),
    )
    expect(releaseFromAssistant).toHaveBeenCalledWith(ximena.id)
    expect(await screen.findByText('Tomaste el caso del asistente')).toBeInTheDocument()
    expect(
      screen.getByText('Quedó en la cola en español: le llega a la primera persona disponible.'),
    ).toBeInTheDocument()
    await waitFor(() =>
      expect(vi.mocked(fetchOpenCases).mock.calls.length).toBeGreaterThan(fetches),
    )
  })

  it('says when the assistant no longer has the case', async () => {
    vi.mocked(releaseFromAssistant).mockRejectedValue(
      new ApiProblem({ status: 409, code: 'assistant_not_active' }),
    )
    const { user } = renderRoute('/supervision/queues', { staff: supervisorStaff, aiEnabled: true })
    await screen.findByRole('table', { name: 'Casos abiertos en español' })
    await user.click(screen.getByRole('button', { name: 'Tomar el caso de Ximena Robles Treviño' }))
    expect(await screen.findByText('El asistente ya no tiene este caso')).toBeInTheDocument()
  })
})
