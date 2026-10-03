import { act, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { Rail } from '@/components/layout/Rail'
import type * as SupervisionApi from '@/features/supervision/api'
import { fetchQueueOverview } from '@/features/supervision/api'
import { NOW } from '@/test/case-fixtures'
import { supervisorStaff } from '@/test/fixtures'
import { renderWithProviders } from '@/test/render'
import { makeQueueOverview } from '@/test/supervision-fixtures'
import { useRailIndicators } from './rail-indicators'
import { ROLES, type RoleId } from './roles'

vi.mock('@/features/supervision/api', async (importOriginal) => {
  const actual = await importOriginal<typeof SupervisionApi>()
  return { ...actual, fetchQueueOverview: vi.fn<typeof actual.fetchQueueOverview>() }
})

function RailFor({ roleId }: { roleId: RoleId }) {
  return <Rail role={ROLES[roleId]} indicators={useRailIndicators(roleId)} />
}

beforeEach(() => {
  vi.mocked(fetchQueueOverview).mockResolvedValue(makeQueueOverview())
})

describe('useRailIndicators', () => {
  it('shows the queued cases on "Equipo y colas" in the Supervisora role, live', async () => {
    const { sockets } = renderWithProviders(<RailFor roleId="supervisor" />, {
      staff: supervisorStaff,
      route: '/supervision/auditoria',
    })
    expect(
      await screen.findByRole('link', { name: 'Equipo y colas, 3 pendientes' }),
    ).toBeInTheDocument()

    act(() => sockets.last()?.open())
    expect(sockets.last()?.messages()).toContainEqual({
      action: 'subscribe',
      topic: 'supervision:queues',
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
    expect(
      await screen.findByRole('link', { name: 'Equipo y colas, 2 pendientes' }),
    ).toBeInTheDocument()
  })

  it('fetches nothing and shows no badge in the analyst role (Felipe on Casos)', async () => {
    renderWithProviders(<RailFor roleId="analyst" />, {
      staff: supervisorStaff,
      route: '/analista',
    })
    expect(await screen.findByRole('link', { name: 'Casos' })).toBeInTheDocument()
    expect(fetchQueueOverview).not.toHaveBeenCalled()
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
    expect(screen.getByRole('link', { name: 'Equipo y colas' })).toBeInTheDocument()
  })
})
