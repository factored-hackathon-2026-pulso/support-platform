import { act, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type * as ConversationApi from '@/features/conversation/api'
import { fetchCaseDetail } from '@/features/conversation/api'
import type * as SupervisionApi from '@/features/supervision/api'
import {
  fetchEscalations,
  fetchLastTurns,
  fetchQueueOverview,
  fetchTeamOverview,
  respondEscalation,
  setCaseAssignee,
  takeEscalatedCase,
} from '@/features/supervision/api'
import { ApiProblem } from '@/lib/api'
import { NOW, minutesFrom } from '@/test/case-fixtures'
import { makeCaseDetail, makeTurn } from '@/test/conversation-fixtures'
import { supervisorStaff } from '@/test/fixtures'
import { renderRoute } from '@/test/render'
import {
  DANIELA_ID,
  JULIAN_ID,
  answeredEscalation,
  camilaEscalation,
  julianCamila,
  makeEscalationOverview,
  makeQueueOverview,
  makeTeamOverview,
  marcelaEscalation,
} from '@/test/supervision-fixtures'

vi.mock('@/features/supervision/api', async (importOriginal) => {
  const actual = await importOriginal<typeof SupervisionApi>()
  return {
    ...actual,
    fetchTeamOverview: vi.fn<typeof actual.fetchTeamOverview>(),
    fetchQueueOverview: vi.fn<typeof actual.fetchQueueOverview>(),
    fetchEscalations: vi.fn<typeof actual.fetchEscalations>(),
    fetchLastTurns: vi.fn<typeof actual.fetchLastTurns>(),
    respondEscalation: vi.fn<typeof actual.respondEscalation>(),
    takeEscalatedCase: vi.fn<typeof actual.takeEscalatedCase>(),
    setCaseAssignee: vi.fn<typeof actual.setCaseAssignee>(),
  }
})

vi.mock('@/features/conversation/api', async (importOriginal) => {
  const actual = await importOriginal<typeof ConversationApi>()
  return { ...actual, fetchCaseDetail: vi.fn<typeof actual.fetchCaseDetail>() }
})

const ESC = camilaEscalation.escalation

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(NOW)
  vi.mocked(fetchTeamOverview).mockResolvedValue(makeTeamOverview())
  vi.mocked(fetchQueueOverview).mockResolvedValue(makeQueueOverview())
  vi.mocked(fetchEscalations).mockResolvedValue(makeEscalationOverview())
  vi.mocked(fetchCaseDetail).mockResolvedValue(
    makeCaseDetail({
      case: camilaEscalation.case,
      customer: {
        ...makeCaseDetail().customer,
        displayName: 'Camila Torres Benavides',
        city: 'Bucaramanga',
        country: 'CO',
      },
    }),
  )
  vi.mocked(fetchLastTurns).mockResolvedValue({
    items: [
      makeTurn({
        id: 'TRN-1',
        caseId: julianCamila.id,
        sequence: 1,
        authorRole: 'customer',
        text: 'Hola, hice una transferencia y no le llegó a mi hermano.',
        createdAt: minutesFrom(-25),
      }),
      makeTurn({
        id: 'TRN-2',
        caseId: julianCamila.id,
        sequence: 2,
        kind: 'routing',
        audience: 'staff',
        authorRole: 'system',
        authorId: null,
        text: 'Julián Ortega escaló el caso a supervisión.',
        createdAt: minutesFrom(-21),
      }),
    ],
    olderCursor: null,
    lastSequence: 2,
  })
})

afterEach(() => {
  vi.useRealTimers()
})

function renderEscalations(path = '/supervision/escalations') {
  return renderRoute(path, { staff: supervisorStaff })
}

const list = () => screen.getByRole('region', { name: 'Escalamientos' })

describe('escalations screen ("Escalados")', () => {
  it('lists open escalations first, the longest waiting first, then the ones attended today', async () => {
    renderEscalations()
    expect(await screen.findByRole('heading', { level: 1, name: 'Escalados' })).toBeInTheDocument()
    expect(screen.getByText('Casos en los que el equipo pidió ayuda de supervisión')).toBeVisible()
    expect(await screen.findByText('2 abiertos')).toBeInTheDocument()
    const headings = within(list())
      .getAllByRole('heading', { level: 2 })
      .map((h) => h.textContent)
    expect(headings).toEqual(['Abiertos (2)', 'Atendidos hoy'])
    const rows = within(list()).getAllByRole('button')
    expect(rows[0]).toHaveAccessibleName(/Julián Ortega.*Camila Torres Benavides/)
    expect(rows[1]).toHaveAccessibleName(/Daniela Ríos.*Marcela Quintana Pardo/)
    expect(rows[2]).toHaveAccessibleName(/Joaquín Ferreyra Paz/)
    expect(within(rows[0]!).getByText('21 min')).toBeInTheDocument()
    expect(within(rows[0]!).getByText('Abierto')).toBeInTheDocument()
    expect(within(rows[2]!).getByText('Respondido')).toBeInTheDocument()
  })

  it('shows the empty state', async () => {
    vi.mocked(fetchEscalations).mockResolvedValue(
      makeEscalationOverview({ items: [], openCount: 0 }),
    )
    renderEscalations()
    expect(await screen.findByText('Nadie escaló un caso')).toBeInTheDocument()
  })

  it('opens the panel with the motive, the case and its last messages', async () => {
    const { user, router } = renderEscalations()
    await user.click(
      await within(await screen.findByRole('region', { name: 'Escalamientos' })).findByRole(
        'button',
        { name: /Camila Torres Benavides/ },
      ),
    )
    expect(router.state.location.search).toBe(`?escalation=${ESC.id}`)
    const panel = await screen.findByRole('complementary', { name: 'Camila Torres Benavides' })
    expect(within(panel).getByText(ESC.motive)).toBeInTheDocument()
    expect(within(panel).getByText('Escaló hace 21 min')).toBeInTheDocument()
    expect(await within(panel).findByText('Bucaramanga, Colombia')).toBeInTheDocument()
    expect(
      await within(panel).findByText('Hola, hice una transferencia y no le llegó a mi hermano.'),
    ).toBeInTheDocument()
    expect(within(panel).getByRole('link', { name: /Ver caso completo/ })).toHaveAttribute(
      'href',
      `/supervision/cases/${julianCamila.id}`,
    )
    expect(within(panel).getByRole('button', { name: 'Responder' })).toBeInTheDocument()
    expect(within(panel).getByRole('button', { name: 'Reasignar' })).toBeInTheDocument()
    // Lucía holds only Supervisión: taking the case is not offered.
    expect(within(panel).queryByRole('button', { name: 'Tomar el caso' })).toBeNull()
  })

  it('answers with a required note and reports it', async () => {
    vi.mocked(respondEscalation).mockResolvedValue({
      escalation: { ...ESC, state: 'answered', note: 'Sigue tú con ella.' },
      case: { ...julianCamila, escalated: false },
    })
    const { user } = renderEscalations(`/supervision/escalations?escalation=${ESC.id}`)
    const panel = await screen.findByRole('complementary', { name: 'Camila Torres Benavides' })
    await user.click(within(panel).getByRole('button', { name: 'Responder' }))
    const reply = within(panel).getByRole('textbox', { name: 'Tu respuesta para Julián' })
    await waitFor(() => expect(reply).toHaveFocus())
    expect(reply).toHaveAccessibleDescription(/Le llega a Julián dentro del caso/)
    await user.click(within(panel).getByRole('button', { name: 'Enviar respuesta' }))
    expect(within(panel).getByText('Escribe tu respuesta.')).toBeInTheDocument()
    expect(respondEscalation).not.toHaveBeenCalled()
    await user.type(reply, 'Sigue tú con ella.')
    expect(within(panel).getByText('18/500')).toBeInTheDocument()
    await user.click(within(panel).getByRole('button', { name: 'Enviar respuesta' }))
    expect(respondEscalation).toHaveBeenCalledWith(ESC.id, 'Sigue tú con ella.')
    expect(
      await screen.findByText(
        'Le llegó tu respuesta a Julián en el caso de Camila Torres Benavides.',
      ),
    ).toBeInTheDocument()
  })

  it('reports an escalation that was withdrawn meanwhile', async () => {
    vi.mocked(respondEscalation).mockRejectedValue(
      new ApiProblem({ status: 409, code: 'escalation_not_open' }),
    )
    const { user } = renderEscalations(`/supervision/escalations?escalation=${ESC.id}`)
    const panel = await screen.findByRole('complementary', { name: 'Camila Torres Benavides' })
    await user.click(within(panel).getByRole('button', { name: 'Responder' }))
    await user.type(within(panel).getByRole('textbox'), 'Hola')
    await user.click(within(panel).getByRole('button', { name: 'Enviar respuesta' }))
    expect(
      await within(panel).findByText(/Este escalamiento ya no está abierto/),
    ).toBeInTheDocument()
  })

  it('takes the case when the supervisor also holds Analista', async () => {
    vi.mocked(fetchEscalations).mockResolvedValue(
      makeEscalationOverview({
        items: [{ ...camilaEscalation, canTake: true }, marcelaEscalation, answeredEscalation],
      }),
    )
    vi.mocked(takeEscalatedCase).mockResolvedValue({
      escalation: { ...ESC, state: 'taken' },
      case: { ...julianCamila, assignedAnalystId: 'STF-SUP0000005' },
    })
    const { user } = renderEscalations(`/supervision/escalations?escalation=${ESC.id}`)
    const panel = await screen.findByRole('complementary', { name: 'Camila Torres Benavides' })
    await user.click(within(panel).getByRole('button', { name: 'Tomar el caso' }))
    expect(takeEscalatedCase).toHaveBeenCalledWith(ESC.id)
    expect(
      await screen.findByText(
        'Tomaste el caso de Camila Torres Benavides. Julián lo puede leer, pero ya no responder.',
      ),
    ).toBeInTheDocument()
  })

  it('reassigns from the panel with the shared dialog', async () => {
    vi.mocked(setCaseAssignee).mockResolvedValue({
      changed: true,
      case: { ...julianCamila, assignedAnalystId: DANIELA_ID },
      assignment: { ...makeCaseDetail().assignment!, reason: 'manual' },
    })
    const { user, router } = renderEscalations(`/supervision/escalations?escalation=${ESC.id}`)
    const panel = await screen.findByRole('complementary', { name: 'Camila Torres Benavides' })
    await user.click(within(panel).getByRole('button', { name: 'Reasignar' }))
    expect(router.state.location.search).toBe(`?escalation=${ESC.id}&reassign=1`)
    const dialog = await screen.findByRole('dialog', { name: 'Reasignar caso' })
    await user.click(within(dialog).getByRole('radio', { name: /^Daniela Ríos/ }))
    await user.click(within(dialog).getByRole('button', { name: 'Reasignar a Daniela' }))
    expect(setCaseAssignee).toHaveBeenCalledWith(julianCamila.id, {
      analystId: DANIELA_ID,
      expectedAnalystId: JULIAN_ID,
      confirmPaused: false,
    })
    expect(
      await screen.findByText(
        'El caso de Camila Torres Benavides pasó de Julián Ortega a Daniela Ríos.',
      ),
    ).toBeInTheDocument()
  })

  it('shows what supervision did with an attended one, without actions', async () => {
    renderEscalations(`/supervision/escalations?escalation=${answeredEscalation.escalation.id}`)
    const panel = await screen.findByRole('complementary', { name: 'Joaquín Ferreyra Paz' })
    expect(within(panel).getByText('Lucía Herrera respondió')).toBeInTheDocument()
    expect(within(panel).getByText('Revisé el reclamo: sigue dentro del plazo.')).toBeVisible()
    expect(within(panel).queryByRole('button', { name: 'Responder' })).toBeNull()
  })

  it('refetches on a new escalation without a toast over the list', async () => {
    const { sockets } = renderEscalations()
    await screen.findByRole('region', { name: 'Escalamientos' })
    const calls = vi.mocked(fetchEscalations).mock.calls.length
    act(() => {
      sockets.last()?.open()
      sockets.last()?.receive({
        type: 'escalation.updated',
        id: 'EVT-ESC-9',
        occurredAt: NOW.toISOString(),
        data: {
          entity: 'escalation',
          entityId: ESC.id,
          caseId: julianCamila.id,
          actor: { role: 'analyst', id: JULIAN_ID },
          payload: ESC,
        },
      })
    })
    await waitFor(() =>
      expect(vi.mocked(fetchEscalations).mock.calls.length).toBeGreaterThan(calls),
    )
    expect(screen.queryByText('Julián Ortega escaló un caso')).not.toBeInTheDocument()
  })

  it('drops an escalation that is no longer listed', async () => {
    const { router } = renderEscalations('/supervision/escalations?escalation=ESC-NADA')
    await screen.findByRole('region', { name: 'Escalamientos' })
    await waitFor(() => expect(router.state.location.search).toBe(''))
  })
})
