import { screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type * as AuditApi from '@/features/audit/api'
import { fetchAuditEvent, fetchAuditEvents, fetchStaffDirectory } from '@/features/audit/api'
import type * as SupervisionApi from '@/features/supervision/api'
import { fetchQueueOverview } from '@/features/supervision/api'
import { ApiProblem } from '@/lib/api'
import {
  LUCIA_ID,
  makeAuditEvent,
  makeAuditPage,
  makePauseEvent,
  makeRedactedTurnEvent,
} from '@/test/audit-fixtures'
import { NOW } from '@/test/case-fixtures'
import { analystStaff, supervisorStaff } from '@/test/fixtures'
import { renderRoute } from '@/test/render'
import { makeQueueOverview } from '@/test/supervision-fixtures'

vi.mock('@/features/audit/api', async (importOriginal) => {
  const actual = await importOriginal<typeof AuditApi>()
  return {
    ...actual,
    fetchAuditEvents: vi.fn<typeof actual.fetchAuditEvents>(),
    fetchAuditEvent: vi.fn<typeof actual.fetchAuditEvent>(),
    fetchStaffDirectory: vi.fn<typeof actual.fetchStaffDirectory>(),
  }
})

vi.mock('@/features/supervision/api', async (importOriginal) => {
  const actual = await importOriginal<typeof SupervisionApi>()
  return { ...actual, fetchQueueOverview: vi.fn<typeof actual.fetchQueueOverview>() }
})

const ESTEBAN_CASE = 'CASE-00000000000000000000000114'

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(NOW)
  vi.mocked(fetchAuditEvents).mockResolvedValue(makeAuditPage())
  vi.mocked(fetchStaffDirectory).mockResolvedValue([
    { ...supervisorStaff, id: LUCIA_ID, name: 'Lucía Herrera' },
    analystStaff,
  ])
  vi.mocked(fetchQueueOverview).mockResolvedValue(makeQueueOverview())
})

afterEach(() => {
  vi.useRealTimers()
})

function renderAudit(path = '/supervision/auditoria') {
  return renderRoute(path, { staff: supervisorStaff })
}

const log = () => screen.getByRole('table', { name: 'Eventos' })
const aside = () => screen.getByRole('complementary', { name: 'Detalle del registro' })

describe('Auditoría', () => {
  it('lists the events newest first under day separators', async () => {
    renderAudit()
    expect(await screen.findByRole('heading', { level: 1, name: 'Auditoría' })).toBeInTheDocument()
    expect(screen.getByText('Quién hizo qué, en qué caso y cuándo')).toBeInTheDocument()
    await screen.findByRole('table', { name: 'Eventos' })
    expect(within(log()).getByRole('columnheader', { name: 'Hoy' })).toBeInTheDocument()
    expect(within(log()).getByRole('columnheader', { name: 'Ayer' })).toBeInTheDocument()

    const reassigned = within(log()).getByRole('row', { name: /Reasignó el caso/ })
    expect(within(reassigned).getByText('11:02:05')).toBeInTheDocument()
    expect(within(reassigned).getByText('Supervisora')).toBeInTheDocument()
    expect(within(reassigned).getByText('Lucía Herrera')).toBeInTheDocument()
    expect(within(reassigned).getByText('CAMBIO')).toBeInTheDocument()
    expect(within(reassigned).getByText('CASE-…0114')).toBeInTheDocument()

    const message = within(log()).getByRole('row', { name: /Escribió un mensaje/ })
    expect(within(message).getByText('Cliente')).toBeInTheDocument()
    expect(within(message).queryByText('CAMBIO')).not.toBeInTheDocument()
    const pause = within(log()).getByRole('row', { name: /Pasó a En pausa/ })
    expect(within(pause).getByText('—')).toBeInTheDocument()

    expect(screen.getByText('Mostrando 3 eventos')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Cargar más' })).not.toBeInTheDocument()
    expect(within(aside()).getByText('Elige un evento para ver el detalle.')).toBeInTheDocument()
    expect(fetchAuditEvents).toHaveBeenCalledWith({}, null, expect.anything())
  })

  it('shows the detail of a selected event and filters by its case', async () => {
    const { user, router } = renderAudit()
    await screen.findByRole('table', { name: 'Eventos' })
    await user.click(
      within(log()).getByRole('button', { name: /Reasignó el caso de Paula Medina/ }),
    )
    expect(router.state.location.search).toMatch(/^\?evento=EVT-/)
    const detail = aside()
    expect(within(detail).getByText('11:02:05 · ASIGNACIÓN')).toBeInTheDocument()
    expect(
      within(detail).getByRole('heading', {
        name: 'Reasignó el caso de Paula Medina a Julián Ortega',
      }),
    ).toBeInTheDocument()
    expect(within(detail).getByText('Lucía Herrera · Supervisora')).toBeInTheDocument()
    expect(within(detail).getByText('case.assigned')).toBeInTheDocument()
    expect(within(detail).getByText(ESTEBAN_CASE)).toBeInTheDocument()
    // Ocurrió and Registrado.
    expect(within(detail).getAllByText('5 mar 2026, 11:02:05', { selector: 'dd' })).toHaveLength(2)

    await user.click(within(detail).getByRole('button', { name: /Datos del evento/ }))
    expect(within(detail).getByText('previous_analyst_id')).toBeInTheDocument()
    expect(within(detail).getByText('STF-ANA0000003')).toBeInTheDocument()

    const link = within(detail).getByRole('link', { name: 'Ver la conversación' })
    expect(link).toHaveAttribute('href', `/supervision/casos/${ESTEBAN_CASE}`)

    await user.click(within(detail).getByRole('button', { name: 'Filtrar por este caso' }))
    expect(new URLSearchParams(router.state.location.search).get('caso')).toBe(ESTEBAN_CASE)
    await waitFor(() =>
      expect(fetchAuditEvents).toHaveBeenLastCalledWith(
        { caseId: ESTEBAN_CASE },
        null,
        expect.anything(),
      ),
    )
    expect(
      screen.getByRole('button', { name: `Quitar el filtro del caso ${ESTEBAN_CASE}` }),
    ).toBeInTheDocument()

    await user.click(within(aside()).getByRole('link', { name: 'Ver la conversación' }))
    // Another (lazy) route: the navigation commits once its module has loaded.
    await waitFor(() =>
      expect(router.state.location.pathname).toBe(`/supervision/casos/${ESTEBAN_CASE}`),
    )
    expect(router.state.location.state).toEqual({
      from: expect.stringMatching(/^\/supervision\/auditoria\?caso=/),
    })
  })

  it('says the message text lives in the conversation', async () => {
    const turn = makeRedactedTurnEvent()
    vi.mocked(fetchAuditEvents).mockResolvedValue(makeAuditPage([turn]))
    renderAudit(`/supervision/auditoria?evento=${turn.id}`)
    expect(
      await screen.findByText('El texto del mensaje no se muestra aquí: está en la conversación.'),
    ).toBeInTheDocument()
  })

  it('loads more pages with the cursor', async () => {
    vi.mocked(fetchAuditEvents)
      .mockResolvedValueOnce(makeAuditPage([makeAuditEvent(), makeRedactedTurnEvent()], 'c-1'))
      .mockResolvedValueOnce(makeAuditPage([makePauseEvent()]))
    const { user } = renderAudit()
    expect(await screen.findByText('Mostrando 2 eventos')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Cargar más' }))
    expect(await screen.findByText('Mostrando 3 eventos')).toBeInTheDocument()
    expect(fetchAuditEvents).toHaveBeenLastCalledWith({}, 'c-1', expect.anything())
    expect(screen.queryByRole('button', { name: 'Cargar más' })).not.toBeInTheDocument()
  })

  it('filters by who, type, person and changes, replacing the history entry', async () => {
    const { user, router } = renderAudit()
    await screen.findByRole('table', { name: 'Eventos' })
    await user.click(screen.getByRole('radio', { name: 'Equipo' }))
    await user.selectOptions(screen.getByRole('combobox', { name: 'Tipo' }), 'assignment')
    await user.selectOptions(
      await screen.findByRole('combobox', { name: 'Persona' }),
      'Lucía Herrera',
    )
    await user.click(screen.getByRole('checkbox', { name: 'Solo acciones que cambian algo' }))
    expect(router.state.location.search).toBe(
      `?quien=equipo&persona=${LUCIA_ID}&tipo=asignacion&cambios=1`,
    )
    await waitFor(() =>
      expect(fetchAuditEvents).toHaveBeenLastCalledWith(
        { actorKind: 'staff', actorId: LUCIA_ID, family: 'assignment', changesOnly: true },
        null,
        expect.anything(),
      ),
    )
    // Customers have no "Persona": the filter goes.
    await user.click(screen.getByRole('radio', { name: 'Clientes' }))
    expect(screen.queryByRole('combobox', { name: 'Persona' })).not.toBeInTheDocument()
    expect(router.state.location.search).toBe('?quien=clientes&tipo=asignacion&cambios=1')
  })

  it('searches ids after a pause in typing', async () => {
    const { user, router } = renderAudit()
    await screen.findByRole('table', { name: 'Eventos' })
    await user.type(screen.getByRole('searchbox', { name: 'Buscar' }), '0114')
    await waitFor(() => expect(router.state.location.search).toBe('?q=0114'))
    await waitFor(() =>
      expect(fetchAuditEvents).toHaveBeenLastCalledWith({ q: '0114' }, null, expect.anything()),
    )
  })

  it('rejects a Hasta before Desde without asking the server', async () => {
    renderAudit('/supervision/auditoria?desde=2026-03-05&hasta=2026-03-04')
    expect(await screen.findByText('Corrige las fechas para ver el registro.')).toBeInTheDocument()
    expect(screen.getByLabelText('Hasta')).toHaveAccessibleDescription(
      'Debe ser el mismo día de «Desde» o uno posterior.',
    )
    expect(fetchAuditEvents).not.toHaveBeenCalled()
  })

  it('sends the days as UTC instants of the viewer zone', async () => {
    renderAudit('/supervision/auditoria?desde=2026-03-04&hasta=2026-03-05')
    await screen.findByRole('table', { name: 'Eventos' })
    expect(fetchAuditEvents).toHaveBeenCalledWith(
      { from: '2026-03-04T05:00:00.000Z', to: '2026-03-06T05:00:00.000Z' },
      null,
      expect.anything(),
    )
  })

  it('offers "Limpiar filtros" when nothing matches the filters', async () => {
    vi.mocked(fetchAuditEvents).mockResolvedValue(makeAuditPage([]))
    const { user, router } = renderAudit('/supervision/auditoria?cambios=1&tipo=accesos')
    expect(
      await screen.findByRole('heading', { name: 'Ningún evento coincide con estos filtros.' }),
    ).toBeInTheDocument()
    const clear = screen.getAllByRole('button', { name: 'Limpiar filtros' })
    await user.click(clear[clear.length - 1]!)
    expect(router.state.location.search).toBe('')
    expect(
      await screen.findByRole('heading', { name: 'Todavía no hay eventos.' }),
    ).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Limpiar filtros' })).not.toBeInTheDocument()
  })

  it('shows an error with a retry', async () => {
    vi.mocked(fetchAuditEvents).mockRejectedValueOnce(ApiProblem.network())
    const { user } = renderAudit()
    expect(await screen.findByText('No pudimos cargar el registro')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Reintentar' }))
    expect(await screen.findByRole('table', { name: 'Eventos' })).toBeInTheDocument()
  })

  it('loads a linked event that is not in the pages, or says it does not exist', async () => {
    const pause = makePauseEvent()
    vi.mocked(fetchAuditEvents).mockResolvedValue(makeAuditPage([makeAuditEvent()]))
    vi.mocked(fetchAuditEvent).mockResolvedValueOnce(pause)
    const { unmount } = renderAudit(`/supervision/auditoria?evento=${pause.id}`)
    expect(
      await within(
        await screen.findByRole('complementary', { name: 'Detalle del registro' }),
      ).findByRole('heading', { name: 'Pasó a En pausa' }),
    ).toBeInTheDocument()
    expect(fetchAuditEvent).toHaveBeenCalledWith(pause.id, expect.anything())
    expect(screen.queryByRole('link', { name: 'Ver la conversación' })).not.toBeInTheDocument()
    unmount()

    vi.mocked(fetchAuditEvent).mockRejectedValueOnce(
      new ApiProblem({ status: 404, code: 'not_found' }),
    )
    renderAudit('/supervision/auditoria?evento=EVT-NADA')
    expect(await screen.findByText('No encontramos ese evento.')).toBeInTheDocument()
  })
})
