import { act, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type * as SupervisionApi from '@/features/supervision/api'
import { fetchQueueOverview, fetchTeamOverview, setCaseAssignee } from '@/features/supervision/api'
import { ApiProblem } from '@/lib/api'
import { NOW, makeCaseSummary } from '@/test/case-fixtures'
import { makeCaseDetail } from '@/test/conversation-fixtures'
import { supervisorStaff } from '@/test/fixtures'
import { renderRoute } from '@/test/render'
import {
  DANIELA_ID,
  JULIAN_ID,
  SEBASTIAN_ID,
  emptyQueues,
  julianCamila,
  makeQueueOverview,
  makeTeamOverview,
  queuedGabriela,
} from '@/test/supervision-fixtures'

vi.mock('@/features/supervision/api', async (importOriginal) => {
  const actual = await importOriginal<typeof SupervisionApi>()
  return {
    ...actual,
    fetchTeamOverview: vi.fn<typeof actual.fetchTeamOverview>(),
    fetchQueueOverview: vi.fn<typeof actual.fetchQueueOverview>(),
    setCaseAssignee: vi.fn<typeof actual.setCaseAssignee>(),
  }
})

beforeEach(() => {
  // Only Date is faked: waits and SLA read the pinned clock, timers stay real.
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(NOW)
  vi.mocked(fetchTeamOverview).mockResolvedValue(makeTeamOverview())
  vi.mocked(fetchQueueOverview).mockResolvedValue(makeQueueOverview())
})

afterEach(() => {
  vi.useRealTimers()
})

function renderTeam(path = '/supervision/equipo') {
  return renderRoute(path, { staff: supervisorStaff })
}

const queue = (name: string) => screen.getByRole('region', { name })
const analystsTable = () => screen.getByRole('table', { name: 'Analistas' })
const row = (name: RegExp) => within(analystsTable()).getByRole('row', { name })

describe('Equipo y colas', () => {
  it('shows both queues with their cases, risk and waits, and the rail badge', async () => {
    renderTeam()
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Equipo y colas' }),
    ).toBeInTheDocument()
    expect(document.title).toBe('Equipo y colas · LATAM Bank Soporte')
    expect(await screen.findByText('Todos los equipos · 6 analistas')).toBeInTheDocument()
    expect(screen.getByText('3 en espera')).toBeInTheDocument()

    const es = await screen.findByRole('region', { name: 'Cola en español' })
    expect(within(es).getByText('2 en riesgo de SLA')).toBeInTheDocument()
    expect(within(es).getByText('13 min')).toBeInTheDocument()
    expect(within(es).getByText('disponible que habla español')).toBeInTheDocument()
    expect(within(es).getByRole('link', { name: 'Rosa Elena Ibarra Méndez' })).toHaveAttribute(
      'href',
      '/supervision/casos/CASE-00000000000000000000000111',
    )
    expect(within(es).getByText('SLA 2 min')).toBeInTheDocument()
    expect(within(es).getByText('SLA vencido')).toBeInTheDocument()
    expect(within(es).getByText('Espera 13 min')).toBeInTheDocument()

    const pt = queue('Cola en portugués')
    expect(within(pt).getByText('Sin riesgo')).toBeInTheDocument()
    expect(within(pt).getByText('Gabriela Duarte Melo')).toBeInTheDocument()

    const rail = screen.getByRole('navigation', { name: 'Principal' })
    expect(
      await within(rail).findByRole('link', { name: 'Equipo y colas, 3 pendientes' }),
    ).toHaveAttribute('aria-current', 'page')
  })

  it('lists the connected analysts with "Ahora", load and SLA risk', async () => {
    renderTeam()
    await screen.findByRole('table', { name: 'Analistas' })
    expect(screen.getByRole('radio', { name: 'Conectadas 1' })).toBeChecked()
    expect(screen.getByRole('radio', { name: 'En pausa 1' })).toBeInTheDocument()
    expect(screen.getByRole('radio', { name: 'Desconectadas 4' })).toBeInTheDocument()
    expect(screen.getByText('7 casos abiertos · 2 en riesgo de SLA')).toBeInTheDocument()

    const daniela = row(/Daniela Ríos/)
    // "Todos los equipos": the row names the team like the pills, full name in the title.
    expect(within(daniela).getByText('Equipo Andes')).toHaveAttribute(
      'title',
      'Disputas · Equipo Andes',
    )
    expect(within(daniela).getByText('Atendiendo')).toBeInTheDocument()
    expect(within(daniela).getByText('· sin sesión abierta')).toHaveAttribute(
      'title',
      'Le siguen llegando casos aunque no haya iniciado sesión.',
    )
    expect(within(daniela).getByText('español, portugués')).toBeInTheDocument()
    expect(within(daniela).getByText('Carga alta')).toBeInTheDocument()
    const cells = within(daniela)
      .getAllByRole('cell')
      .map((cell) => cell.textContent)
    expect(cells.slice(3)).toEqual(['Carga alta5', '4', '4 min', '1'])
  })

  it('filters by state and team, and says when nobody is in that state', async () => {
    const { user, router } = renderTeam()
    await screen.findByRole('table', { name: 'Analistas' })

    await user.click(screen.getByRole('radio', { name: 'En pausa 1' }))
    const julian = row(/Julián Ortega/)
    expect(within(julian).getByText('En pausa')).toBeInTheDocument()
    expect(
      within(julian)
        .getAllByRole('cell')
        .map((c) => c.textContent)
        .slice(3),
    ).toEqual(['2', '1', '12 min', '1'])
    expect(router.state.location.search).toBe('?estado=en-pausa')

    await user.click(screen.getByRole('radio', { name: 'Desconectadas 4' }))
    expect(within(row(/Paula Medina/)).getAllByRole('cell')[3]).toHaveTextContent('—')

    await user.click(screen.getByRole('radio', { name: 'Equipo Pacífico' }))
    expect(screen.getByText('Disputas · Equipo Pacífico · 3 analistas')).toBeInTheDocument()
    await user.click(screen.getByRole('radio', { name: 'En pausa 0' }))
    expect(screen.getByText('Nadie en este estado ahora.')).toBeInTheDocument()
    expect(router.state.location.search).toBe('?equipo=disputas-equipo-pacifico&estado=en-pausa')
  })

  it('opens the analyst sheet with her open cases', async () => {
    const { user, router } = renderTeam('/supervision/equipo?estado=en-pausa')
    await user.click(await screen.findByRole('button', { name: 'Julián Ortega' }))
    const sheet = await screen.findByRole('dialog', { name: 'Julián Ortega' })
    expect(sheet).toHaveAccessibleDescription('En pausa · español · Disputas · Equipo Andes')
    expect(router.state.location.search).toBe(`?estado=en-pausa&analista=${JULIAN_ID}`)
    expect(within(sheet).getByText('Esperando al cliente')).toBeInTheDocument()
    expect(within(sheet).getByText('Camila Torres Benavides')).toBeInTheDocument()
    expect(within(sheet).getByText('Esteban Morales Quiroga')).toBeInTheDocument()
    expect(
      within(sheet).getByRole('link', { name: 'Ver conversación de Camila Torres Benavides' }),
    ).toHaveAttribute('href', `/supervision/casos/${julianCamila.id}`)

    await user.click(
      within(sheet).getByRole('link', { name: 'Ver conversación de Camila Torres Benavides' }),
    )
    expect(router.state.location.pathname).toBe(`/supervision/casos/${julianCamila.id}`)
    expect(router.state.location.state).toEqual({
      from: `/supervision/equipo?estado=en-pausa&analista=${JULIAN_ID}`,
    })
  })

  it('closes the sheet of an analyst who is not listed', async () => {
    const { router } = renderTeam('/supervision/equipo?analista=STF-NADIE')
    await screen.findByRole('table', { name: 'Analistas' })
    await waitFor(() => expect(router.state.location.search).toBe(''))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('shows empty queues and no badge', async () => {
    vi.mocked(fetchQueueOverview).mockResolvedValue(emptyQueues)
    renderTeam()
    expect(await screen.findAllByText('Sin casos en espera.')).toHaveLength(2)
    expect(screen.getByText('0 en espera')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Equipo y colas' })).toBeInTheDocument()
  })

  it('loads and fails team and queues independently', async () => {
    vi.mocked(fetchTeamOverview).mockRejectedValueOnce(ApiProblem.network())
    vi.mocked(fetchQueueOverview).mockReturnValue(new Promise(() => {}))
    const { user } = renderTeam()
    expect(await screen.findByText('No pudimos cargar el equipo')).toBeInTheDocument()
    expect(
      screen.getByRole('region', { name: 'Colas' }).querySelector('[aria-busy="true"]'),
    ).not.toBeNull()
    await user.click(screen.getByRole('button', { name: 'Reintentar' }))
    expect(await screen.findByRole('table', { name: 'Analistas' })).toBeInTheDocument()
  })

  it('shows the queue error with a retry while the team is fine', async () => {
    vi.mocked(fetchQueueOverview).mockRejectedValue(
      new ApiProblem({ status: 500, code: 'unexpected_error' }),
    )
    renderTeam()
    expect(await screen.findByText('No pudimos cargar las colas')).toBeInTheDocument()
    expect(await screen.findByRole('table', { name: 'Analistas' })).toBeInTheDocument()
  })
})

describe('assign dialog', () => {
  it('disables who does not speak the case language and asks to confirm a paused target', async () => {
    vi.mocked(setCaseAssignee).mockResolvedValue({
      changed: true,
      case: { ...queuedGabriela, status: 'assigned', assignedAnalystId: SEBASTIAN_ID },
      assignment: { ...makeCaseDetail().assignment!, analystId: SEBASTIAN_ID, reason: 'manual' },
    })
    const { user, router } = renderTeam()
    await user.click(
      await screen.findByRole('button', { name: 'Asignar el caso de Gabriela Duarte Melo' }),
    )
    const dialog = await screen.findByRole('dialog', { name: 'Asignar caso' })
    expect(dialog).toHaveAccessibleDescription(
      'Gabriela Duarte Melo · CASE-…0109 · portugués · Espera 6 min en la cola',
    )
    expect(router.state.location.search).toBe(`?asignar=${queuedGabriela.id}`)

    const julian = within(dialog).getByRole('radio', { name: 'Julián Ortega' })
    expect(julian).toBeDisabled()
    expect(julian).toHaveAccessibleDescription('No habla portugués (regla 3)')
    expect(within(dialog).getByRole('radio', { name: 'Paula Medina' })).toBeDisabled()
    expect(within(dialog).getByRole('radio', { name: 'Daniela Ríos' })).toBeEnabled()

    // Nobody chosen yet.
    await user.click(within(dialog).getByRole('button', { name: 'Asignar' }))
    expect(within(dialog).getByText('Elige a quién asignarlo.')).toBeInTheDocument()

    await user.click(within(dialog).getByRole('radio', { name: 'Sebastián Cárdenas' }))
    expect(
      within(dialog).getByText(
        'Sebastián está en pausa: no recibe casos nuevos. Si lo asignas igual, le llega a su lista. Tampoco tiene una sesión abierta.',
      ),
    ).toBeInTheDocument()
    expect(within(dialog).getByText('Que ya lo atiende Sebastián.')).toBeInTheDocument()
    const confirm = within(dialog).getByRole('checkbox', { name: 'Asignar aunque esté en pausa' })

    await user.click(within(dialog).getByRole('button', { name: 'Asignar a Sebastián' }))
    expect(confirm).toHaveFocus()
    expect(confirm).toHaveAccessibleDescription(
      'Confirma que quieres asignarlo aunque esté en pausa.',
    )
    expect(setCaseAssignee).not.toHaveBeenCalled()

    await user.click(confirm)
    await user.click(within(dialog).getByRole('button', { name: 'Asignar a Sebastián' }))
    expect(setCaseAssignee).toHaveBeenCalledWith(queuedGabriela.id, {
      analystId: SEBASTIAN_ID,
      expectedAnalystId: null,
      confirmPaused: true,
    })
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(
      screen.getByText(
        'El caso de Gabriela Duarte Melo pasó a Sebastián Cárdenas. La cola en portugués quedó en 0.',
      ),
    ).toBeInTheDocument()
    expect(screen.getByText('Listo ·')).toBeInTheDocument()
    expect(router.state.location.search).toBe('')
    // The team and queues are refetched.
    await waitFor(() => expect(fetchQueueOverview).toHaveBeenCalledTimes(2))
  })

  it('reassigns from the analyst sheet, previews the notice and reports a race', async () => {
    vi.mocked(setCaseAssignee).mockRejectedValueOnce(
      new ApiProblem({
        status: 409,
        code: 'assignment_changed',
        extensions: { currentAnalystId: DANIELA_ID },
      }),
    )
    const { user } = renderTeam(`/supervision/equipo?estado=en-pausa&analista=${JULIAN_ID}`)
    const sheet = await screen.findByRole('dialog', { name: 'Julián Ortega' })
    await user.click(
      within(sheet).getByRole('button', { name: 'Reasignar el caso de Camila Torres Benavides' }),
    )
    const dialog = await screen.findByRole('dialog', { name: 'Reasignar caso' })
    expect(dialog).toHaveAccessibleDescription(
      'Camila Torres Benavides · CASE-…0113 · español · Lo atiende Julián Ortega',
    )
    expect(within(dialog).queryByRole('radio', { name: 'Julián Ortega' })).not.toBeInTheDocument()

    await user.click(within(dialog).getByRole('radio', { name: 'Daniela Ríos' }))
    expect(
      within(dialog).getByText('Ahora te atiende Daniela, de nuestro equipo.'),
    ).toHaveAttribute('lang', 'es')
    expect(
      within(dialog).queryByRole('checkbox', { name: 'Asignar aunque esté en pausa' }),
    ).not.toBeInTheDocument()
    const teamCalls = vi.mocked(fetchTeamOverview).mock.calls.length
    await user.click(within(dialog).getByRole('button', { name: 'Reasignar a Daniela' }))
    expect(setCaseAssignee).toHaveBeenCalledWith(julianCamila.id, {
      analystId: DANIELA_ID,
      expectedAnalystId: JULIAN_ID,
      confirmPaused: false,
    })
    expect(
      await within(dialog).findByText(
        'Alguien más movió este caso mientras decidías. Revisa a quién está asignado ahora.',
      ),
    ).toBeInTheDocument()
    expect(screen.getByRole('dialog', { name: 'Reasignar caso' })).toBeInTheDocument()
    await waitFor(() =>
      expect(vi.mocked(fetchTeamOverview).mock.calls.length).toBeGreaterThan(teamCalls),
    )
  })

  it('reports a reassignment in the strip', async () => {
    vi.mocked(setCaseAssignee).mockResolvedValue({
      changed: true,
      case: makeCaseSummary({ ...julianCamila, assignedAnalystId: DANIELA_ID }),
      assignment: { ...makeCaseDetail().assignment!, reason: 'manual' },
    })
    const { user } = renderTeam(`/supervision/equipo?asignar=${julianCamila.id}`)
    const dialog = await screen.findByRole('dialog', { name: 'Reasignar caso' })
    await user.click(within(dialog).getByRole('radio', { name: 'Daniela Ríos' }))
    await user.click(within(dialog).getByRole('button', { name: 'Reasignar a Daniela' }))
    expect(
      await screen.findByText(
        'El caso de Camila Torres Benavides pasó de Julián Ortega a Daniela Ríos.',
      ),
    ).toBeInTheDocument()
  })

  it('says when the analyst already had the case', async () => {
    vi.mocked(setCaseAssignee).mockResolvedValue({
      changed: false,
      case: julianCamila,
      assignment: { ...makeCaseDetail().assignment!, reason: 'manual' },
    })
    const { user } = renderTeam(`/supervision/equipo?asignar=${julianCamila.id}`)
    const dialog = await screen.findByRole('dialog', { name: 'Reasignar caso' })
    await user.click(within(dialog).getByRole('radio', { name: 'Daniela Ríos' }))
    await user.click(within(dialog).getByRole('button', { name: 'Reasignar a Daniela' }))
    expect(await screen.findByText('Daniela ya tenía este caso.')).toBeInTheDocument()
    expect(screen.queryByText(/Listo ·/)).not.toBeInTheDocument()
  })

  it('drops ?asignar= for a case that is neither queued nor open', async () => {
    const { router } = renderTeam('/supervision/equipo?asignar=CASE-NADA')
    await screen.findByRole('table', { name: 'Analistas' })
    await waitFor(() => expect(router.state.location.search).toBe(''))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })
})

describe('supervisor notice', () => {
  it('toasts a case that entered a queue, once, and opens the assign dialog', async () => {
    const { user, sockets, router } = renderTeam()
    await screen.findByRole('table', { name: 'Analistas' })
    const envelope = {
      type: 'queue.case_queued',
      id: 'EVT-QUEUED-1',
      occurredAt: NOW.toISOString(),
      data: {
        entity: 'case',
        entityId: queuedGabriela.id,
        caseId: queuedGabriela.id,
        actor: { role: 'system', id: null },
        payload: queuedGabriela,
      },
    }
    act(() => {
      sockets.last()?.open()
      sockets.last()?.receive(envelope)
      sockets.last()?.receive(envelope)
    })
    const toasts = screen.getByRole('region', { name: 'Notificaciones' })
    expect(
      await within(toasts).findByText('Un caso espera en la cola en portugués'),
    ).toBeInTheDocument()
    expect(within(toasts).getAllByText('Un caso espera en la cola en portugués')).toHaveLength(1)
    expect(
      within(toasts).getByText('Gabriela Duarte Melo · nadie disponible habla portugués'),
    ).toBeInTheDocument()
    expect(within(toasts).getByText('Cola en portugués')).toBeInTheDocument()
    expect(within(toasts).getByRole('button', { name: 'Más tarde' })).toBeInTheDocument()

    await user.click(within(toasts).getByRole('button', { name: 'Asignar' }))
    expect(router.state.location.search).toBe(`?asignar=${queuedGabriela.id}`)
    expect(await screen.findByRole('dialog', { name: 'Asignar caso' })).toBeInTheDocument()
  })

  it('subscribes to both supervision topics', async () => {
    const { sockets } = renderTeam()
    await screen.findByRole('table', { name: 'Analistas' })
    act(() => sockets.last()?.open())
    const messages = sockets.last()?.messages()
    expect(messages).toContainEqual({ action: 'subscribe', topic: 'supervision:team' })
    expect(messages).toContainEqual({ action: 'subscribe', topic: 'supervision:queues' })
  })
})

describe('supervision routes', () => {
  it('keeps the removed approvals URL on the role not-found page', async () => {
    renderTeam('/supervision/aprobaciones')
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Página no encontrada' }),
    ).toBeInTheDocument()
  })
})
