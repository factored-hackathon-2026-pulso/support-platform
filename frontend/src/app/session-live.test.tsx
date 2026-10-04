import { act, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type * as AdminApi from '@/features/admin/api'
import { fetchAdminTeams, fetchAdminUsers } from '@/features/admin/api'
import { makeTeamList, makeUserList } from '@/test/admin-fixtures'
import { NOW } from '@/test/case-fixtures'
import { TEAM_PACIFICO, supervisorAdminStaff } from '@/test/fixtures'
import { renderRoute } from '@/test/render'
import type { Staff } from './session'

vi.mock('@/features/admin/api', async (importOriginal) => {
  const actual = await importOriginal<typeof AdminApi>()
  return {
    ...actual,
    fetchAdminUsers: vi.fn<typeof actual.fetchAdminUsers>(),
    fetchAdminTeams: vi.fn<typeof actual.fetchAdminTeams>(),
  }
})

beforeEach(() => {
  vi.mocked(fetchAdminUsers).mockResolvedValue(makeUserList())
  vi.mocked(fetchAdminTeams).mockResolvedValue(makeTeamList())
})

function meUpdated(staff: Staff, id: string) {
  return {
    type: 'me.updated',
    id,
    occurredAt: NOW.toISOString(),
    data: {
      entity: 'staff',
      entityId: staff.id,
      caseId: null,
      actor: { role: 'admin', id: 'STF-ADM0000009' },
      payload: staff,
    },
  }
}

async function openSwitcher(user: ReturnType<typeof renderRoute>['user']) {
  await user.click(screen.getByRole('button', { name: /cambiar de rol/ }))
  return within(screen.getByRole('list', { name: 'Cambiar de rol' }))
}

describe('SessionLiveSync', () => {
  it('subscribes to her own topic and applies me.updated: role switcher, summary and toast', async () => {
    const { user, sockets } = renderRoute('/administracion/equipos', {
      staff: supervisorAdminStaff,
    })
    await screen.findByRole('heading', { level: 1, name: 'Equipos' })
    act(() => sockets.last()?.open())
    expect(sockets.last()?.messages()).toContainEqual({
      action: 'subscribe',
      topic: `staff:${supervisorAdminStaff.id}`,
    })
    let switcher = await openSwitcher(user)
    expect(switcher.getAllByRole('link').map((link) => link.textContent)).toEqual([
      'Supervisora',
      'Administración',
    ])
    await user.keyboard('{Escape}')

    // An admin removed her Supervisora role and moved her to Pacífico.
    act(() =>
      sockets
        .last()
        ?.receive(
          meUpdated({ ...supervisorAdminStaff, roles: ['admin'], team: TEAM_PACIFICO }, 'EVT-ME-1'),
        ),
    )
    expect(await screen.findByText('Cambiaron tus roles')).toBeInTheDocument()
    expect(screen.getByText('Ahora tienes: Administración.')).toBeInTheDocument()
    switcher = await openSwitcher(user)
    expect(switcher.getAllByRole('link').map((link) => link.textContent)).toEqual([
      'Administración',
    ])
    // Icon rows, not a dot-joined line (slice 6).
    const summary = screen.getByText('Equipo:').closest('ul')!
    expect(
      within(summary)
        .getAllByRole('listitem')
        .map((item) => item.textContent),
    ).toEqual(['Equipo: Equipo Pacífico', 'Idiomas: Español'])
  })

  it('sends her home when the section she is in is gone', async () => {
    const { router, sockets } = renderRoute('/administracion/equipos', {
      staff: supervisorAdminStaff,
    })
    await screen.findByRole('heading', { level: 1, name: 'Equipos' })
    act(() => sockets.last()?.open())
    act(() =>
      sockets
        .last()
        ?.receive(meUpdated({ ...supervisorAdminStaff, roles: ['supervisor'] }, 'EVT-ME-2')),
    )
    await waitFor(() => expect(router.state.location.pathname).toBe('/supervision/equipo'))
    expect(await screen.findByText('Ahora tienes: Supervisora.')).toBeInTheDocument()
  })

  it('on 4409 reconnects at once and reloads /auth/me', async () => {
    const { sockets } = renderRoute('/administracion/equipos', { staff: supervisorAdminStaff })
    await screen.findByRole('heading', { level: 1, name: 'Equipos' })
    act(() => sockets.last()?.open())
    const fetchMock = vi.mocked(globalThis.fetch)
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          staff: { ...supervisorAdminStaff, roles: ['admin', 'analyst'] },
          session: { id: 'SES-1', expiresAt: '2026-10-03T23:00:00Z' },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    )
    const before = sockets.sockets.length
    act(() => sockets.last()?.serverClose(4409))
    // A new socket right away (no backoff), with the same token.
    expect(sockets.sockets.length).toBe(before + 1)
    expect(sockets.last()?.url).toContain(`token=test-token-${supervisorAdminStaff.id}`)
    expect(await screen.findByText('Ahora tienes: Analista y Administración.')).toBeInTheDocument()
    expect(fetchMock).toHaveBeenCalled()
  })
})
