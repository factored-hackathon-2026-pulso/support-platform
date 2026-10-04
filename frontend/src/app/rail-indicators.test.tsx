import { act, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { Rail } from '@/components/layout/Rail'
import type * as AdminApi from '@/features/admin/api'
import type * as CasesApi from '@/features/cases/api'
import { fetchAvailability, fetchInbox } from '@/features/cases/api'
import { fetchAdminUsers } from '@/features/admin/api'
import type * as SupervisionApi from '@/features/supervision/api'
import { fetchEscalations, fetchQueueOverview } from '@/features/supervision/api'
import { NOW, available, makeInbox, paused } from '@/test/case-fixtures'
import { makeUserList } from '@/test/admin-fixtures'
import { adminStaff, supervisorStaff } from '@/test/fixtures'
import { renderWithProviders } from '@/test/render'
import { makeEscalationOverview, makeQueueOverview } from '@/test/supervision-fixtures'
import { useRailIndicators, useRailPresence } from './rail-indicators'
import { ROLES, type RoleId } from './roles'

vi.mock('@/features/supervision/api', async (importOriginal) => {
  const actual = await importOriginal<typeof SupervisionApi>()
  return {
    ...actual,
    fetchQueueOverview: vi.fn<typeof actual.fetchQueueOverview>(),
    fetchEscalations: vi.fn<typeof actual.fetchEscalations>(),
  }
})

function RailFor({ roleId }: { roleId: RoleId }) {
  return (
    <Rail
      role={ROLES[roleId]}
      indicators={useRailIndicators(roleId)}
      presence={useRailPresence(roleId)}
    />
  )
}

vi.mock('@/features/cases/api', async (importOriginal) => {
  const actual = await importOriginal<typeof CasesApi>()
  return {
    ...actual,
    fetchInbox: vi.fn<typeof actual.fetchInbox>(),
    fetchAvailability: vi.fn<typeof actual.fetchAvailability>(),
  }
})

vi.mock('@/features/admin/api', async (importOriginal) => {
  const actual = await importOriginal<typeof AdminApi>()
  return { ...actual, fetchAdminUsers: vi.fn<typeof actual.fetchAdminUsers>() }
})

beforeEach(() => {
  vi.mocked(fetchQueueOverview).mockResolvedValue(makeQueueOverview())
  vi.mocked(fetchEscalations).mockResolvedValue(makeEscalationOverview())
  vi.mocked(fetchAdminUsers).mockResolvedValue(makeUserList())
  vi.mocked(fetchInbox).mockResolvedValue(makeInbox())
  vi.mocked(fetchAvailability).mockResolvedValue(paused)
})

describe('useRailIndicators', () => {
  it('shows the unassigned cases on "Colas" and the open escalations in the Supervisión role, live', async () => {
    const { sockets } = renderWithProviders(<RailFor roleId="supervisor" />, {
      staff: supervisorStaff,
      route: '/supervision/auditoria',
    })
    expect(await screen.findByRole('link', { name: 'Colas, 3 sin asignar' })).toBeInTheDocument()
    expect(await screen.findByRole('link', { name: 'Escalados, 2 abiertos' })).toBeInTheDocument()

    act(() => sockets.last()?.open())
    expect(sockets.last()?.messages()).toContainEqual({
      action: 'subscribe',
      topic: 'supervision:queues',
    })
    expect(sockets.last()?.messages()).toContainEqual({
      action: 'subscribe',
      topic: 'supervision:escalations',
    })
    // A queue.updated with newer counts moves the badge at once.
    vi.mocked(fetchQueueOverview).mockReturnValue(new Promise(() => {}))
    act(() =>
      sockets.last()?.receive({
        type: 'queue.updated',
        id: 'EVT-Q-1',
        occurredAt: NOW.toISOString(),
        data: {
          entity: 'case',
          entityId: 'CASE-1',
          caseId: 'CASE-1',
          actor: { role: 'supervisor', id: 'STF-1' },
          payload: {
            total: 2,
            byLanguage: [],
            computedAt: new Date(NOW.getTime() + 60_000).toISOString(),
          },
        },
      }),
    )
    expect(await screen.findByRole('link', { name: 'Colas, 2 sin asignar' })).toBeInTheDocument()
  })

  it('shows Por responder on Casos and her presence in the analyst role, never the queues', async () => {
    const { sockets } = renderWithProviders(<RailFor roleId="analyst" />, {
      staff: supervisorStaff,
      route: '/analista',
    })
    expect(await screen.findByRole('link', { name: 'Casos, 2 pendientes' })).toBeInTheDocument()
    expect(await screen.findByText('Estado: En pausa')).toBeInTheDocument()
    expect(fetchQueueOverview).not.toHaveBeenCalled()
    expect(fetchInbox).toHaveBeenCalledWith({ status: null, q: '' }, expect.anything())
    // Her inbox topic stays subscribed on every analyst screen.
    act(() => sockets.last()?.open())
    expect(sockets.last()?.messages()).toContainEqual({
      action: 'subscribe',
      topic: `inbox:${supervisorStaff.id}`,
    })
    expect(sockets.last()?.messages()).not.toContainEqual({
      action: 'subscribe',
      topic: 'supervision:queues',
    })
    // availability.updated moves the dot.
    act(() =>
      sockets.last()?.receive({
        type: 'availability.updated',
        id: 'EVT-AV-1',
        occurredAt: NOW.toISOString(),
        data: { entity: 'staff', entityId: 'STF-1', caseId: null, actor: null, payload: available },
      }),
    )
    expect(await screen.findByText('Estado: Disponible')).toBeInTheDocument()
  })

  it('asks nothing of the cases outside the analyst role, and shows no dot', async () => {
    renderWithProviders(<RailFor roleId="supervisor" />, {
      staff: supervisorStaff,
      route: '/supervision/equipo',
    })
    await screen.findByRole('link', { name: 'Colas, 3 sin asignar' })
    expect(fetchInbox).not.toHaveBeenCalled()
    expect(fetchAvailability).not.toHaveBeenCalled()
    expect(screen.queryByText(/^Estado:/)).not.toBeInTheDocument()
  })

  it('shows no badge with empty queues', async () => {
    vi.mocked(fetchQueueOverview).mockResolvedValue(
      makeQueueOverview({ counts: { total: 0, byLanguage: [], computedAt: NOW.toISOString() } }),
    )
    renderWithProviders(<RailFor roleId="supervisor" />, {
      staff: supervisorStaff,
      route: '/supervision/equipo',
    })
    await vi.waitFor(() => expect(fetchQueueOverview).toHaveBeenCalled())
    expect(screen.getByRole('link', { name: 'Colas' })).toBeInTheDocument()
  })

  it('shows the locked accounts on "Usuarios y roles" in the Administración role, live', async () => {
    const { sockets } = renderWithProviders(<RailFor roleId="admin" />, {
      staff: adminStaff,
      route: '/administracion/equipos',
    })
    expect(
      await screen.findByRole('link', { name: 'Usuarios y roles, 1 pendiente' }),
    ).toBeInTheDocument()
    expect(fetchAdminUsers).toHaveBeenCalledWith({}, expect.anything())
    expect(fetchQueueOverview).not.toHaveBeenCalled()

    act(() => sockets.last()?.open())
    expect(sockets.last()?.messages()).toContainEqual({
      action: 'subscribe',
      topic: 'admin:directory',
    })
    // Someone unlocked Mariana: the directory refetches and the badge goes.
    vi.mocked(fetchAdminUsers).mockResolvedValue(
      makeUserList(undefined, {
        statusCounts: { active: 12, locked: 0, invited: 0, inactive: 1, all: 13 },
      }),
    )
    act(() =>
      sockets.last()?.receive({
        type: 'directory.updated',
        id: 'EVT-DIR-9',
        occurredAt: NOW.toISOString(),
        data: {
          entity: 'staff',
          entityId: 'STF-1',
          caseId: null,
          actor: { role: 'admin', id: 'STF-2' },
          payload: { staffIds: ['STF-1'], teamIds: [] },
        },
      }),
    )
    expect(await screen.findByRole('link', { name: 'Usuarios y roles' })).toBeInTheDocument()
  })

  it('does not ask for the directory outside the Administración role', async () => {
    renderWithProviders(<RailFor roleId="supervisor" />, {
      staff: supervisorStaff,
      route: '/supervision/equipo',
    })
    await screen.findByRole('link', { name: 'Colas, 3 sin asignar' })
    expect(fetchAdminUsers).not.toHaveBeenCalled()
  })
})
