import { act, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type * as SupervisionApi from '@/features/supervision/api'
import {
  fetchEscalations,
  fetchOpenCases,
  fetchQueueOverview,
  fetchTeamOverview,
  setCaseAssignee,
} from '@/features/supervision/api'
import { ApiProblem } from '@/lib/api'
import { NOW, makeCaseSummary } from '@/test/case-fixtures'
import { makeCaseDetail } from '@/test/conversation-fixtures'
import { supervisorStaff } from '@/test/fixtures'
import { makeNotification, notificationCreated } from '@/test/notification-fixtures'
import { renderRoute } from '@/test/render'
import {
  ANDES,
  DANIELA_ID,
  JULIAN_ID,
  camilaEscalation,
  julianCamila,
  makeAnalyst,
  makeEscalationOverview,
  makeOpenCases,
  makeQueueOverview,
  makeTeamOverview,
  seededAnalysts,
} from '@/test/supervision-fixtures'

vi.mock('@/features/supervision/api', async (importOriginal) => {
  const actual = await importOriginal<typeof SupervisionApi>()
  return {
    ...actual,
    fetchTeamOverview: vi.fn<typeof actual.fetchTeamOverview>(),
    fetchQueueOverview: vi.fn<typeof actual.fetchQueueOverview>(),
    fetchEscalations: vi.fn<typeof actual.fetchEscalations>(),
    fetchOpenCases: vi.fn<typeof actual.fetchOpenCases>(),
    setCaseAssignee: vi.fn<typeof actual.setCaseAssignee>(),
  }
})

beforeEach(() => {
  // Only Date is faked: waits and SLA read the pinned clock, timers stay real.
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(NOW)
  vi.mocked(fetchTeamOverview).mockResolvedValue(makeTeamOverview())
  vi.mocked(fetchQueueOverview).mockResolvedValue(makeQueueOverview())
  vi.mocked(fetchEscalations).mockResolvedValue(makeEscalationOverview())
  vi.mocked(fetchOpenCases).mockResolvedValue(makeOpenCases())
})

afterEach(() => {
  vi.useRealTimers()
})

function renderTeam(path = '/supervision/team') {
  return renderRoute(path, { staff: supervisorStaff })
}

const analystsTable = () => screen.getByRole('table', { name: 'Analistas' })
const row = (name: RegExp) => within(analystsTable()).getByRole('row', { name })

/** A connected analyst who speaks Spanish (the reassign suggestions). */
const connected = (id: string, name: string, open: number) =>
  makeAnalyst({
    id,
    name,
    team: ANDES,
    availability: 'available',
    signedIn: true,
    activity: open > 0 ? 'busy' : 'available',
    counts: { open, new: 0, toReply: 0, waiting: 0 },
  })

describe('team screen ("Equipo")', () => {
  it('lists every analyst in one table, without team tabs', async () => {
    renderTeam()
    expect(await screen.findByRole('heading', { level: 1, name: 'Equipo' })).toBeInTheDocument()
    expect(document.title).toBe('Equipo · LATAM Bank Soporte')
    expect(await screen.findByText('6 analistas')).toBeInTheDocument()
    expect(screen.queryByRole('radio', { name: /Todos los equipos/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('tab')).not.toBeInTheDocument()
    expect(within(analystsTable()).getAllByRole('row')).toHaveLength(seededAnalysts.length + 1)
    for (const header of [
      'Nombre',
      'Ahora',
      'Idiomas',
      'Abiertos',
      'Por responder',
      'Espera más larga',
      'En riesgo',
      'Calificación 7 días',
    ]) {
      expect(within(analystsTable()).getByRole('columnheader', { name: header })).toBeVisible()
    }
    const danielaRow = row(/Daniela Ríos/)
    expect(within(danielaRow).getByText('Atendiendo')).toBeInTheDocument()
    expect(within(danielaRow).getByText('sin sesión abierta')).toBeInTheDocument()
    expect(within(danielaRow).getByText('Carga alta')).toBeInTheDocument()
    // Her languages as marks, named for screen readers.
    expect(
      within(danielaRow).getByText('Español y Português', { selector: '.sr-only' }),
    ).toBeInTheDocument()
    expect(danielaRow.querySelectorAll('svg[data-language]')).toHaveLength(2)
    const julianRow = row(/Julián Ortega/)
    expect(within(julianRow).getByText('En pausa')).toBeInTheDocument()
    expect(within(row(/Paula Medina/)).getByText('Sin conexión')).toBeInTheDocument()
    expect(screen.getByText('7 casos abiertos')).toBeInTheDocument()
    expect(screen.getByText('2 en riesgo')).toBeInTheDocument()
  })

  it('filters with one Filtros dropdown and removable chips, in the URL', async () => {
    const { user, router } = renderTeam()
    await screen.findByRole('table', { name: 'Analistas' })
    await user.click(screen.getByRole('button', { name: 'Filtros' }))
    const estado = screen.getByRole('group', { name: 'Estado' })
    expect(within(estado).getByRole('checkbox', { name: 'Sin conexión 4' })).toBeInTheDocument()
    await user.click(
      within(screen.getByRole('group', { name: 'Idioma' })).getByRole('checkbox', {
        name: 'Português 3',
      }),
    )
    expect(router.state.location.search).toBe('?language=pt')
    expect(await screen.findByText('3 de 6 analistas')).toBeInTheDocument()
    expect(within(analystsTable()).getAllByRole('row')).toHaveLength(4)
    await user.click(
      within(screen.getByRole('group', { name: 'Equipo' })).getByRole('checkbox', {
        name: 'Equipo Andes 1',
      }),
    )
    expect(router.state.location.search).toBe(`?language=pt&team=${ANDES.id}`)
    await user.click(screen.getByRole('button', { name: 'Listo' }))
    const chips = screen.getByRole('group', { name: 'Filtros activos' })
    await user.click(within(chips).getByRole('button', { name: 'Quitar filtro Português' }))
    expect(router.state.location.search).toBe(`?team=${ANDES.id}`)
    await user.click(within(chips).getByRole('button', { name: 'Limpiar filtros' }))
    expect(router.state.location.search).toBe('')
  })

  it('says when nobody matches and clears the filters', async () => {
    const { user, router } = renderTeam('/supervision/team?status=available')
    expect(await screen.findByText('Nadie coincide con los filtros.')).toBeInTheDocument()
    await user.click(screen.getAllByRole('button', { name: 'Limpiar filtros' }).at(-1)!)
    await waitFor(() => expect(router.state.location.search).toBe(''))
  })

  it('opens the analyst sheet with facts, her cases and the "Escalado" marker', async () => {
    vi.mocked(fetchTeamOverview).mockResolvedValue(
      makeTeamOverview({
        analysts: seededAnalysts.map((analyst) =>
          analyst.id === JULIAN_ID
            ? {
                ...analyst,
                openCases: analyst.openCases.map((c) =>
                  c.id === julianCamila.id ? { ...c, escalated: true } : c,
                ),
              }
            : analyst,
        ),
      }),
    )
    const { user, router } = renderTeam()
    await user.click(await screen.findByRole('button', { name: 'Julián Ortega' }))
    const sheet = await screen.findByRole('dialog', { name: 'Julián Ortega' })
    expect(router.state.location.search).toBe(`?analyst=${JULIAN_ID}`)
    expect(within(sheet).getByText('Equipo Andes')).toBeInTheDocument()
    // Her languages as marks: "Idiomas: Español" for screen readers.
    expect(within(sheet).getByText('Idiomas:')).toBeInTheDocument()
    expect(sheet.querySelector('svg[data-language="es"]')).not.toBeNull()
    expect(within(sheet).getByText('2,5')).toBeInTheDocument()
    expect(within(sheet).getByText('Escalado')).toBeInTheDocument()
    expect(
      within(sheet).getByRole('link', { name: 'Ver conversación de Camila Torres Benavides' }),
    ).toHaveAttribute('href', `/supervision/cases/${julianCamila.id}`)
    await user.click(
      within(sheet).getByRole('link', { name: 'Ver conversación de Camila Torres Benavides' }),
    )
    await waitFor(() =>
      expect(router.state.location.pathname).toBe(`/supervision/cases/${julianCamila.id}`),
    )
    expect(router.state.location.state).toEqual({
      from: `/supervision/team?analyst=${JULIAN_ID}`,
    })
  })

  it('closes the sheet of an analyst who is not listed', async () => {
    const { router } = renderTeam('/supervision/team?analyst=STF-NADIE')
    await screen.findByRole('table', { name: 'Analistas' })
    await waitFor(() => expect(router.state.location.search).toBe(''))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('shows the team error with a retry', async () => {
    vi.mocked(fetchTeamOverview).mockRejectedValue(ApiProblem.network())
    renderTeam()
    expect(await screen.findByText('No pudimos cargar el equipo')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Reintentar' })).toBeInTheDocument()
  })
})

describe('reassign dialog ("Reasignar caso")', () => {
  const people = [
    connected('STF-A', 'Ana Ruiz', 3),
    connected('STF-B', 'Bruno Díaz', 1),
    connected('STF-C', 'Carla Gil', 0),
    connected('STF-D', 'Darío Paz', 2),
    connected('STF-E', 'Elena Mora', 4),
  ]

  it('suggests three speakers, searches the rest and includes paused people on demand', async () => {
    vi.mocked(fetchTeamOverview).mockResolvedValue(
      makeTeamOverview({ analysts: [...seededAnalysts, ...people] }),
    )
    const { user } = renderTeam(`/supervision/team?reassign=${julianCamila.id}`)
    const dialog = await screen.findByRole('dialog', { name: 'Reasignar caso' })
    expect(within(dialog).getByText('Lo atiende Julián Ortega')).toBeInTheDocument()
    expect(within(dialog).getByText('Sugeridos')).toBeInTheDocument()
    expect(within(dialog).getByText('Solo quienes hablan español')).toBeInTheDocument()
    const radios = () => within(dialog).getAllByRole('radio')
    expect(radios()).toHaveLength(3)
    expect(within(dialog).getByRole('radio', { name: /^Carla Gil/ })).toBeInTheDocument()
    expect(within(dialog).queryByRole('radio', { name: /^Julián Ortega/ })).not.toBeInTheDocument()
    expect(within(dialog).getByText(/^\+3 más: escribe un nombre/)).toBeInTheDocument()

    await user.type(
      within(dialog).getByRole('searchbox', { name: 'Buscar a alguien del equipo' }),
      'elena',
    )
    expect(within(dialog).getByText('Resultados')).toBeInTheDocument()
    expect(radios()).toHaveLength(1)
    await user.clear(within(dialog).getByRole('searchbox', { name: 'Buscar a alguien del equipo' }))
    await user.type(
      within(dialog).getByRole('searchbox', { name: 'Buscar a alguien del equipo' }),
      'tomas',
    )
    expect(within(dialog).getByText('Nadie con ese nombre habla español.')).toBeInTheDocument()
    await user.click(
      within(dialog).getByRole('checkbox', {
        name: 'Incluir a quienes están en pausa o desconectados',
      }),
    )
    expect(within(dialog).getByRole('radio', { name: /^Tomás Arango/ })).toBeInTheDocument()
  })

  it('asks to confirm a paused choice, previews the notice and reports a race', async () => {
    vi.mocked(setCaseAssignee).mockRejectedValueOnce(
      new ApiProblem({
        status: 409,
        code: 'assignment_changed',
        extensions: { currentAnalystId: DANIELA_ID },
      }),
    )
    const { user } = renderTeam(`/supervision/team?reassign=${julianCamila.id}`)
    const dialog = await screen.findByRole('dialog', { name: 'Reasignar caso' })
    await user.click(
      within(dialog).getByRole('checkbox', {
        name: 'Incluir a quienes están en pausa o desconectados',
      }),
    )
    await user.click(within(dialog).getByRole('radio', { name: /^Paula Medina/ }))
    expect(within(dialog).getByText(/Paula está en pausa: no recibe casos nuevos/)).toBeVisible()
    await user.click(within(dialog).getByRole('button', { name: 'Reasignar a Paula' }))
    expect(
      within(dialog).getByText('Confirma que quieres pasarlo aunque esté en pausa.'),
    ).toBeInTheDocument()
    expect(setCaseAssignee).not.toHaveBeenCalled()
    await user.click(within(dialog).getByRole('radio', { name: /^Daniela Ríos/ }))
    expect(
      within(dialog).getByText('Ahora te atiende Daniela, de nuestro equipo.'),
    ).toHaveAttribute('lang', 'es')
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
  })

  it('reports a reassignment in the strip', async () => {
    vi.mocked(setCaseAssignee).mockResolvedValue({
      changed: true,
      case: makeCaseSummary({ ...julianCamila, assignedAnalystId: DANIELA_ID }),
      assignment: { ...makeCaseDetail().assignment!, reason: 'manual' },
    })
    const { user } = renderTeam(`/supervision/team?reassign=${julianCamila.id}`)
    const dialog = await screen.findByRole('dialog', { name: 'Reasignar caso' })
    await user.click(within(dialog).getByRole('radio', { name: /^Daniela Ríos/ }))
    await user.click(within(dialog).getByRole('button', { name: 'Reasignar a Daniela' }))
    expect(
      await screen.findByText(
        'El caso de Camila Torres Benavides pasó de Julián Ortega a Daniela Ríos.',
      ),
    ).toBeInTheDocument()
  })

  it('drops ?reassign= for a case that is not open any more', async () => {
    const { router } = renderTeam('/supervision/team?reassign=CASE-NADA')
    await screen.findByRole('table', { name: 'Analistas' })
    await waitFor(() => expect(router.state.location.search).toBe(''))
  })
})

describe('notices', () => {
  it('toasts a new escalation once from the notification stream, with "Revisar"', async () => {
    const { user, sockets, router } = renderTeam()
    await screen.findByRole('table', { name: 'Analistas' })
    const envelope = notificationCreated(
      makeNotification({
        id: 'NTF-00000000000000000000000091',
        kind: 'case_escalated',
        role: 'supervisor',
        caseId: julianCamila.id,
        customerName: 'Camila Torres Benavides',
        actorId: JULIAN_ID,
        actorName: 'Julián Ortega',
        escalationId: camilaEscalation.escalation.id,
      }),
      1,
    )
    act(() => {
      sockets.last()?.open()
      sockets.last()?.receive(envelope)
      sockets.last()?.receive(envelope)
    })
    const toasts = screen.getByRole('region', { name: 'Avisos' })
    expect(await within(toasts).findByText('Julián Ortega escaló un caso')).toBeInTheDocument()
    expect(within(toasts).getAllByText('Julián Ortega escaló un caso')).toHaveLength(1)
    await user.click(within(toasts).getByRole('button', { name: 'Revisar' }))
    await waitFor(() => expect(router.state.location.pathname).toBe('/supervision/escalations'))
    expect(router.state.location.search).toBe(`?escalation=${camilaEscalation.escalation.id}`)
  })

  it('subscribes to the supervision topics', async () => {
    const { sockets } = renderTeam()
    await screen.findByRole('table', { name: 'Analistas' })
    act(() => sockets.last()?.open())
    const messages = sockets.last()?.messages()
    for (const topic of ['supervision:team', 'supervision:queues', 'supervision:escalations']) {
      expect(messages).toContainEqual({ action: 'subscribe', topic })
    }
  })
})

describe('supervision routes', () => {
  it('lands on Colas and keeps the removed approvals URL on the not-found page', async () => {
    const { router } = renderTeam('/supervision')
    await waitFor(() => expect(router.state.location.pathname).toBe('/supervision/queues'))
    renderTeam('/supervision/aprobaciones')
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Página no encontrada' }),
    ).toBeInTheDocument()
  })
})
