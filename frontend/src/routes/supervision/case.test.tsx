import { screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type * as ConversationApi from '@/features/conversation/api'
import {
  changeCasePriority,
  fetchCaseDetail,
  fetchCaseHistory,
  fetchTurns,
  markCaseRead,
} from '@/features/conversation/api'
import { priorityMenuLabel } from '@/features/cases'
import type { CaseDetail } from '@/features/conversation'
import type * as SupervisionApi from '@/features/supervision/api'
import { fetchQueueOverview, fetchTeamOverview, setCaseAssignee } from '@/features/supervision/api'
import { ApiProblem } from '@/lib/api'
import { NOW } from '@/test/case-fixtures'
import { CASE_ID, makeCaseDetail, patriciaHistory, seededTurns } from '@/test/conversation-fixtures'
import { supervisorStaff } from '@/test/fixtures'
import { renderRoute } from '@/test/render'
import {
  DANIELA_ID,
  makeQueueOverview,
  makeTeamOverview,
  queuedRosa,
} from '@/test/supervision-fixtures'

vi.mock('@/features/conversation/api', async (importOriginal) => {
  const actual = await importOriginal<typeof ConversationApi>()
  return {
    ...actual,
    fetchCaseDetail: vi.fn<typeof actual.fetchCaseDetail>(),
    fetchTurns: vi.fn<typeof actual.fetchTurns>(),
    fetchCaseHistory: vi.fn<typeof actual.fetchCaseHistory>(),
    markCaseRead: vi.fn<typeof actual.markCaseRead>(),
    changeCasePriority: vi.fn<typeof actual.changeCasePriority>(),
  }
})

vi.mock('@/features/supervision/api', async (importOriginal) => {
  const actual = await importOriginal<typeof SupervisionApi>()
  return {
    ...actual,
    fetchTeamOverview: vi.fn<typeof actual.fetchTeamOverview>(),
    fetchQueueOverview: vi.fn<typeof actual.fetchQueueOverview>(),
    setCaseAssignee: vi.fn<typeof actual.setCaseAssignee>(),
  }
})

/** Felipe-like team lead (Analista + Supervisora) holding the case himself. */
function ownCaseDetail(): CaseDetail {
  const detail = makeCaseDetail({
    previousCaseCount: 2,
    capabilities: {
      canReply: true,
      replyBlockedReason: null,
      canClose: true,
      canAssign: true,
      canChangePriority: true,
    },
  })
  detail.case = {
    ...detail.case,
    assignedAnalystId: supervisorStaff.id,
    status: 'assigned',
    inboxStatus: 'new',
    unreadCount: 1,
  }
  detail.assignment = {
    ...detail.assignment!,
    analystId: supervisorStaff.id,
    analystName: 'Laura Méndez',
  }
  return detail
}

function queuedDetail(): CaseDetail {
  return {
    ...makeCaseDetail({
      assignment: null,
      capabilities: {
        canReply: false,
        replyBlockedReason: 'not_assignee',
        canClose: false,
        canAssign: true,
        canChangePriority: true,
      },
    }),
    case: queuedRosa,
    customer: {
      ...makeCaseDetail().customer,
      id: queuedRosa.customer.id,
      displayName: queuedRosa.customer.displayName,
      country: 'MX',
      city: 'Puebla',
      locale: 'es-MX',
    },
  }
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(NOW)
  vi.mocked(fetchCaseDetail).mockResolvedValue(ownCaseDetail())
  vi.mocked(fetchTurns).mockResolvedValue({
    items: seededTurns(),
    olderCursor: null,
    lastSequence: 4,
  })
  vi.mocked(fetchCaseHistory).mockResolvedValue(patriciaHistory)
  vi.mocked(markCaseRead).mockResolvedValue(ownCaseDetail().case)
  vi.mocked(fetchTeamOverview).mockResolvedValue(makeTeamOverview())
  vi.mocked(fetchQueueOverview).mockResolvedValue(makeQueueOverview())
})

afterEach(() => {
  vi.useRealTimers()
})

const casePath = (id = CASE_ID) => `/supervision/casos/${id}`

describe('supervisor case view', () => {
  it('sets the priority of a queued case from the header (slice 8)', async () => {
    vi.mocked(fetchCaseDetail).mockResolvedValue(queuedDetail())
    vi.mocked(changeCasePriority).mockImplementation(async (caseId, body) => ({
      changed: true,
      case: { ...queuedRosa, id: caseId, priority: body.priority, version: queuedRosa.version + 1 },
    }))
    const { user } = renderRoute(casePath(queuedRosa.id), { staff: supervisorStaff })
    const trigger = await screen.findByRole('button', {
      name: priorityMenuLabel(queuedRosa.priority),
    })
    await user.click(trigger)
    await user.click(screen.getByRole('menuitemradio', { name: 'Crítica' }))
    expect(changeCasePriority).toHaveBeenCalledWith(queuedRosa.id, {
      priority: 'critical',
      expectedVersion: queuedRosa.version,
    })
    expect(
      await screen.findByRole('button', { name: 'Prioridad: Crítica. Cambiar la prioridad' }),
    ).toBeInTheDocument()
    // The meta line no longer carries the priority.
    expect(screen.queryByText(/prioridad (media|alta|baja)/)).not.toBeInTheDocument()
  })

  it('is read-only even for an assignee holding both roles', async () => {
    renderRoute(casePath(), { staff: supervisorStaff })
    expect(
      await screen.findByRole('heading', {
        level: 1,
        name: 'Conversación de Marcela Quintana Pardo (supervisión)',
      }),
    ).toBeInTheDocument()
    expect(document.title).toBe('Caso CASE-…0101 · Supervisión · LATAM Bank Soporte')
    expect(screen.getByText('Vista de supervisión · solo lectura')).toBeInTheDocument()
    await screen.findByRole('list', { name: 'Mensajes' })
    expect(screen.queryByRole('textbox', { name: 'Escribe al cliente' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Cerrar caso' })).not.toBeInTheDocument()
    expect(
      screen.getByText('Vista de supervisión · Solo lectura. Lo atiende Laura Méndez.'),
    ).toBeInTheDocument()
    expect(screen.getByText('Cómo llegó').parentElement).toHaveTextContent(
      'Lo atiende Laura Méndez: le llegó al estar disponible y hablar español',
    )
    expect(screen.getByRole('button', { name: 'Reasignar' })).toBeInTheDocument()
    // The rail keeps "Equipo y colas" current on the case view.
    const rail = screen.getByRole('navigation', { name: 'Principal' })
    expect(within(rail).getByRole('link', { name: /Equipo y colas/ })).toHaveAttribute(
      'aria-current',
      'page',
    )
    // Never moves the assignee's read cursor from here.
    await new Promise((resolve) => setTimeout(resolve, 1100))
    expect(markCaseRead).not.toHaveBeenCalled()
  })

  it('goes back to where it came from, even after opening the history', async () => {
    const from = '/supervision/auditoria?caso=CASE-00000000000000000000000101'
    const { user, router } = renderRoute(
      { pathname: casePath(), state: { from } },
      { staff: supervisorStaff },
    )
    const back = await screen.findByRole('link', { name: 'Volver a Auditoría' })
    expect(back).toHaveAttribute('href', from)

    await user.click(await screen.findByRole('button', { name: 'Casos anteriores (2)' }))
    const sheet = await screen.findByRole('dialog', { name: 'Casos anteriores de Marcela' })
    expect(within(sheet).getByRole('list', { name: 'Casos anteriores' })).toBeInTheDocument()
    expect(router.state.location.search).toBe('?historial=lista')
    expect(screen.getByRole('link', { name: 'Volver a Auditoría', hidden: true })).toHaveAttribute(
      'href',
      from,
    )
  })

  it('defaults "Volver" to Equipo y colas', async () => {
    renderRoute(casePath(), { staff: supervisorStaff })
    expect(await screen.findByRole('link', { name: 'Volver a Equipo y colas' })).toHaveAttribute(
      'href',
      '/supervision/equipo',
    )
  })

  it('assigns a queued case from the view', async () => {
    vi.mocked(fetchCaseDetail).mockResolvedValue(queuedDetail())
    vi.mocked(setCaseAssignee).mockResolvedValue({
      changed: true,
      case: { ...queuedRosa, status: 'assigned', assignedAnalystId: DANIELA_ID },
      assignment: { ...makeCaseDetail().assignment!, reason: 'manual' },
    })
    const { user, router } = renderRoute(casePath(queuedRosa.id), { staff: supervisorStaff })
    expect(
      await screen.findByText(
        'Vista de supervisión · El caso espera en la cola en español. Asígnalo para que alguien le responda.',
      ),
    ).toBeInTheDocument()
    expect(screen.getByText('Cómo llegó').parentElement).toHaveTextContent(
      'Espera en la cola en español desde las 10:47: nadie disponible habla español',
    )

    await user.click(screen.getByRole('button', { name: 'Asignar' }))
    expect(router.state.location.search).toBe('?asignar=1')
    await user.click(await screen.findByRole('radio', { name: 'Daniela Ríos' }))
    const dialog = screen.getByRole('dialog', { name: 'Asignar caso' })
    await user.click(within(dialog).getByRole('button', { name: 'Asignar a Daniela' }))
    expect(setCaseAssignee).toHaveBeenCalledWith(queuedRosa.id, {
      analystId: DANIELA_ID,
      expectedAnalystId: null,
      confirmPaused: false,
    })
    expect(
      await screen.findByText('Listo · El caso de Rosa Elena Ibarra Méndez pasó a Daniela Ríos'),
    ).toBeInTheDocument()
    await waitFor(() => expect(router.state.location.search).toBe(''))
    // The pane refetches the detail (capabilities, assignment).
    await waitFor(() => expect(vi.mocked(fetchCaseDetail).mock.calls.length).toBeGreaterThan(1))
  })

  it('closes the dialog when the case was closed meanwhile', async () => {
    vi.mocked(setCaseAssignee).mockRejectedValue(
      new ApiProblem({ status: 409, code: 'case_closed', extensions: { currentStatus: 'closed' } }),
    )
    const { user } = renderRoute(`${casePath()}?asignar=1`, { staff: supervisorStaff })
    // The dialog loads the team (the candidates) first.
    await user.click(await screen.findByRole('radio', { name: 'Daniela Ríos' }))
    await user.click(screen.getByRole('button', { name: 'Reasignar a Daniela' }))
    expect(await screen.findByText('Este caso ya se cerró.')).toBeInTheDocument()
    await waitFor(() =>
      expect(screen.queryByRole('dialog', { name: 'Reasignar caso' })).not.toBeInTheDocument(),
    )
  })

  it('shows no assign button on a closed case and explains a load failure', async () => {
    vi.mocked(fetchCaseDetail).mockRejectedValue(new ApiProblem({ status: 404, code: 'not_found' }))
    renderRoute(casePath(), { staff: supervisorStaff })
    expect(await screen.findByText('No encontramos este caso')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /signar/ })).not.toBeInTheDocument()
  })
})
