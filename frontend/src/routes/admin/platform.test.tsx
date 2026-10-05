import { act, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type * as AdminApi from '@/features/admin/api'
import { fetchAdminPlatform, setAiEnabled } from '@/features/admin/api'
import { platformKeys } from '@/app/platform'
import { ApiProblem } from '@/lib/api'
import { envelope } from '@/test/conversation-fixtures'
import { adminStaff } from '@/test/fixtures'
import { renderRoute } from '@/test/render'

vi.mock('@/features/admin/api', async (importOriginal) => {
  const actual = await importOriginal<typeof AdminApi>()
  return {
    ...actual,
    fetchAdminPlatform: vi.fn<typeof actual.fetchAdminPlatform>(),
    setAiEnabled: vi.fn<typeof actual.setAiEnabled>(),
  }
})

const NEVER_CHANGED = {
  aiEnabled: true,
  agentCoreConfigured: true,
  version: 0,
  updatedAt: null,
  updatedByName: null,
}

beforeEach(() => {
  vi.mocked(fetchAdminPlatform).mockResolvedValue(NEVER_CHANGED)
})

describe('/admin/platform ("Plataforma", slice 18)', () => {
  it('shows the AI switch with what it does and where its value comes from', async () => {
    renderRoute('/admin/platform', { staff: adminStaff })
    expect(await screen.findByRole('heading', { name: 'Plataforma' })).toBeInTheDocument()
    const control = await screen.findByRole('switch', { name: 'Funciones de IA' })
    expect(control).toHaveAttribute('aria-checked', 'true')
    expect(control).toHaveAccessibleDescription(
      'Asistente, copiloto y tipos de caso. Apagadas, la plataforma atiende solo con personas.',
    )
    expect(screen.getByText('Valor de la instalación')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Plataforma' })).toHaveAttribute('aria-current', 'page')
    expect(screen.queryByText('El motor de IA no está conectado')).not.toBeInTheDocument()
  })

  it('turns it off at once, then shows who changed it, and the app follows', async () => {
    vi.mocked(setAiEnabled).mockResolvedValue({
      changed: true,
      settings: {
        ...NEVER_CHANGED,
        aiEnabled: false,
        version: 1,
        updatedAt: new Date().toISOString(),
        updatedByName: 'Valeria Quintero',
      },
    })
    const { user, queryClient } = renderRoute('/admin/platform', {
      staff: adminStaff,
      aiEnabled: true,
    })
    await user.click(await screen.findByRole('switch', { name: 'Funciones de IA' }))
    expect(setAiEnabled).toHaveBeenCalledWith(false)
    expect(screen.getByRole('switch', { name: 'Funciones de IA' })).toHaveAttribute(
      'aria-checked',
      'false',
    )
    expect(await screen.findByText('Valeria Quintero')).toBeInTheDocument()
    expect(await screen.findByText('Funciones de IA apagadas')).toBeInTheDocument()
    expect(queryClient.getQueryData(platformKeys.settings())).toEqual({ aiEnabled: false })
  })

  it('puts the switch back and says why when the change fails', async () => {
    vi.mocked(setAiEnabled).mockRejectedValue(ApiProblem.network())
    const { user } = renderRoute('/admin/platform', { staff: adminStaff })
    await user.click(await screen.findByRole('switch', { name: 'Funciones de IA' }))
    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('No pudimos cambiar las funciones de IA')
    expect(alert).toHaveTextContent('Revisa tu conexión e inténtalo de nuevo.')
    expect(screen.getByRole('switch', { name: 'Funciones de IA' })).toHaveAttribute(
      'aria-checked',
      'true',
    )
  })

  it('says so when AI is on but agent-core is not connected', async () => {
    vi.mocked(fetchAdminPlatform).mockResolvedValue({
      ...NEVER_CHANGED,
      agentCoreConfigured: false,
    })
    renderRoute('/admin/platform', { staff: adminStaff })
    expect(await screen.findByText('El motor de IA no está conectado')).toBeInTheDocument()
  })

  it('refetches when another admin changes it (platform.updated)', async () => {
    const { sockets } = renderRoute('/admin/platform', { staff: adminStaff })
    await screen.findByRole('switch', { name: 'Funciones de IA' })
    const socket = sockets.last()
    act(() => socket?.open())
    await waitFor(() =>
      expect(socket?.messages()).toContainEqual({
        action: 'subscribe',
        topic: 'platform:settings',
      }),
    )
    vi.mocked(fetchAdminPlatform).mockResolvedValue({ ...NEVER_CHANGED, aiEnabled: false })
    act(() => socket?.receive(envelope('platform.updated', { aiEnabled: false })))
    await waitFor(() =>
      expect(screen.getByRole('switch', { name: 'Funciones de IA' })).toHaveAttribute(
        'aria-checked',
        'false',
      ),
    )
  })
})
