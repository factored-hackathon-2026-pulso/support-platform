import { screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type * as AuditApi from '@/features/audit/api'
import { fetchAuditEvents, fetchStaffDirectory } from '@/features/audit/api'
import type * as SupervisionApi from '@/features/supervision/api'
import { fetchQueueOverview } from '@/features/supervision/api'
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

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(NOW)
  vi.mocked(fetchAuditEvents).mockResolvedValue(makeAuditPage())
  vi.mocked(fetchStaffDirectory).mockResolvedValue([
    { ...supervisorStaff, id: LUCIA_ID, name: 'Lucía Herrera' },
    { ...analystStaff, active: false },
  ])
  vi.mocked(fetchQueueOverview).mockResolvedValue(makeQueueOverview())
})

afterEach(() => {
  vi.useRealTimers()
})

function renderAudit(path = '/supervision/audit') {
  return renderRoute(path, { staff: supervisorStaff, locale: 'pt-BR' })
}

const log = () => screen.getByRole('table', { name: 'Eventos' })
const aside = () => screen.getByRole('complementary', { name: 'Detalhes do registro' })

describe('Auditoria in Brazilian Portuguese', () => {
  it('shows the log, its filters and an event detail in pt-BR', async () => {
    const assigned = makeAuditEvent()
    vi.mocked(fetchAuditEvents).mockResolvedValue(
      makeAuditPage([assigned, makeRedactedTurnEvent(), makePauseEvent()]),
    )
    const { user } = renderAudit()
    expect(await screen.findByRole('heading', { level: 1, name: 'Auditoria' })).toBeInTheDocument()
    expect(screen.getByText('Quem fez o quê, em qual caso e quando')).toBeInTheDocument()
    expect(screen.getByRole('searchbox', { name: 'Buscar' })).toHaveAttribute(
      'placeholder',
      'Buscar por id de caso, cliente ou pessoa',
    )
    await screen.findByRole('table', { name: 'Eventos' })

    for (const name of ['Hora', 'Quem', 'O que fez', 'Caso', 'Hoje', 'Ontem']) {
      expect(within(log()).getByRole('columnheader', { name })).toBeInTheDocument()
    }
    // Server-rendered descriptions stay as they arrive (slice 23c).
    const reassigned = within(log()).getByRole('row', { name: /Reasignó el caso/ })
    expect(within(reassigned).getByText('Supervisão')).toBeInTheDocument()
    expect(within(reassigned).getByText('MUDANÇA')).toBeInTheDocument()
    const message = within(log()).getByRole('row', { name: /Escribió un mensaje/ })
    expect(within(message).getByText('Cliente')).toBeInTheDocument()
    expect(screen.getByText('Mostrando 3 eventos')).toBeInTheDocument()

    for (const name of ['Todos', 'Equipe', 'Clientes', 'Plataforma']) {
      expect(screen.getByRole('radio', { name })).toBeInTheDocument()
    }
    expect(screen.getByRole('option', { name: 'Todos os tipos' })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: 'Escalonamentos' })).toBeInTheDocument()
    expect(
      await screen.findByRole('option', { name: `${analystStaff.name} (desativada)` }),
    ).toBeInTheDocument()
    expect(screen.getByRole('checkbox', { name: 'Só ações que mudam algo' })).toBeInTheDocument()
    expect(within(aside()).getByText('Escolha um evento para ver os detalhes.')).toBeInTheDocument()

    await user.click(
      within(log()).getByRole('button', { name: /Reasignó el caso de Paula Medina/ }),
    )
    const detail = aside()
    expect(within(detail).getByText('ATRIBUIÇÃO')).toBeInTheDocument()
    expect(within(detail).getByText('Ocorreu')).toBeInTheDocument()
    expect(within(detail).getByRole('button', { name: /Dados do evento/ })).toBeInTheDocument()
    expect(within(detail).getByRole('link', { name: 'Ver a conversa' })).toBeInTheDocument()

    await user.click(within(detail).getByRole('button', { name: 'Filtrar por este caso' }))
    expect(
      await screen.findByRole('button', {
        name: `Remover o filtro do caso ${assigned.caseRef!.id}`,
      }),
    ).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Limpar filtros' })).toBeInTheDocument()
  })

  it('says where the redacted message text lives', async () => {
    const turn = makeRedactedTurnEvent()
    vi.mocked(fetchAuditEvents).mockResolvedValue(makeAuditPage([turn]))
    renderAudit(`/supervision/audit?event=${turn.id}`)
    expect(
      await screen.findByText('O texto da mensagem não aparece aqui: está na conversa.'),
    ).toBeInTheDocument()
  })

  it('blocks the request while Até is before De', async () => {
    renderAudit('/supervision/audit?from=2026-03-05&to=2026-03-04')
    expect(await screen.findByText('Corrija as datas para ver o registro.')).toBeInTheDocument()
    expect(screen.getByLabelText('Até')).toHaveAccessibleDescription(
      'Deve ser o mesmo dia de “De” ou um dia posterior.',
    )
    expect(fetchAuditEvents).not.toHaveBeenCalled()
  })

  it('offers to clear the filters when nothing matches', async () => {
    vi.mocked(fetchAuditEvents).mockResolvedValue(makeAuditPage([]))
    const { user, router } = renderAudit('/supervision/audit?actor=customer')
    expect(
      await screen.findByText('Nenhum evento corresponde a estes filtros.'),
    ).toBeInTheDocument()
    const [clear] = screen.getAllByRole('button', { name: 'Limpar filtros' })
    await user.click(clear!)
    await waitFor(() => expect(router.state.location.search).toBe(''))
    expect(await screen.findByText('Ainda não há eventos.')).toBeInTheDocument()
  })
})
