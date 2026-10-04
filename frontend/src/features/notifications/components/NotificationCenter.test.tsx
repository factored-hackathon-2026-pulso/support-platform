import { act, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type * as NotificationsApi from '@/features/notifications/api'
import {
  fetchNotifications,
  markAllNotificationsRead,
  markNotificationRead,
} from '@/features/notifications/api'
import { ApiProblem } from '@/lib/api'
import { NOW, minutesFrom } from '@/test/case-fixtures'
import { allRolesStaff, analystStaff } from '@/test/fixtures'
import {
  analystNotifications,
  makeNotification,
  makeNotificationPage,
  notificationCreated,
  notificationsRead,
} from '@/test/notification-fixtures'
import { renderWithProviders } from '@/test/render'
import { NotificationCenter } from './NotificationCenter'

vi.mock('@/features/notifications/api', async (importOriginal) => {
  const actual = await importOriginal<typeof NotificationsApi>()
  return {
    ...actual,
    fetchNotifications: vi.fn<typeof actual.fetchNotifications>(),
    markNotificationRead: vi.fn<typeof actual.markNotificationRead>(),
    markAllNotificationsRead: vi.fn<typeof actual.markAllNotificationsRead>(),
  }
})

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(NOW)
  vi.mocked(fetchNotifications).mockResolvedValue(makeNotificationPage())
  vi.mocked(markNotificationRead).mockImplementation(async (id) => ({
    notification: { ...analystNotifications.find((n) => n.id === id)!, readAt: NOW.toISOString() },
    changed: true,
    unreadCount: 2,
  }))
  vi.mocked(markAllNotificationsRead).mockResolvedValue({ updated: 3, unreadCount: 0 })
})

afterEach(() => {
  vi.useRealTimers()
})

function renderCenter(route = '/analista/inicio', staff = analystStaff) {
  return renderWithProviders(<NotificationCenter />, { route, staff })
}

async function openPanel(user: ReturnType<typeof renderCenter>['user']) {
  await user.click(await screen.findByRole('button', { name: 'Notificaciones, 3 sin leer' }))
  return within(screen.getByRole('region', { name: 'Notificaciones' }))
}

function item(panel: ReturnType<typeof within>, title: string): HTMLElement {
  const row = panel.getByText(title).closest('li')
  if (!row) throw new Error(`no row for ${title}`)
  return row
}

describe('NotificationCenter: the bell', () => {
  it('names the unread count and shows the orange badge', async () => {
    renderCenter()
    const bell = await screen.findByRole('button', { name: 'Notificaciones, 3 sin leer' })
    expect(bell).toHaveAttribute('aria-expanded', 'false')
    expect(within(bell).getByText('3')).toBeInTheDocument()
  })

  it('opens the panel with the focus on its heading: "Nuevas" then "Anteriores"', async () => {
    const { user } = renderCenter()
    const panel = await openPanel(user)
    expect(screen.getByRole('button', { name: 'Notificaciones, 3 sin leer' })).toHaveAttribute(
      'aria-expanded',
      'true',
    )
    expect(panel.getByRole('heading', { level: 2, name: 'Notificaciones' })).toHaveFocus()
    expect(panel.getAllByRole('heading', { level: 3 }).map((h) => h.textContent)).toEqual([
      'Nuevas',
      'Anteriores',
    ])
    expect(panel.getAllByText('Sin leer')).toHaveLength(3)
    const reassigned = within(item(panel, 'Supervisión reasignó tu caso'))
    expect(reassigned.getByText('Marcela Quintana Pardo pasó a Sebastián Cárdenas')).toBeVisible()
    expect(reassigned.getByText('hace 6 min')).toBeInTheDocument()
    expect(reassigned.getByRole('link', { name: 'Ver caso' })).toHaveAccessibleDescription(
      'Supervisión reasignó tu caso',
    )
    const rated = within(item(panel, 'El cliente calificó tu atención: Excelente'))
    expect(rated.getByText('1 mar')).toBeInTheDocument()
    expect(rated.queryByRole('button', { name: 'Marcar como leída' })).toBeNull()
    expect(panel.queryByText('Estás al día')).toBeNull()
  })

  it('marks one as read and keeps it under "Anteriores"', async () => {
    const { user } = renderCenter()
    const panel = await openPanel(user)
    const row = within(item(panel, 'El cliente volvió a escribir'))
    await user.click(row.getByRole('button', { name: 'Marcar como leída' }))
    expect(markNotificationRead).toHaveBeenCalledWith('NTF-00000000000000000000000003')
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Notificaciones, 2 sin leer' })).toBeVisible(),
    )
    expect(panel.getAllByText('Sin leer')).toHaveLength(2)
  })

  it('marks all as read: "Estás al día"', async () => {
    const { user } = renderCenter()
    const panel = await openPanel(user)
    await user.click(panel.getByRole('button', { name: 'Marcar todas como leídas' }))
    expect(markAllNotificationsRead).toHaveBeenCalled()
    expect(await panel.findByText('Estás al día')).toBeInTheDocument()
    expect(panel.getByText('No tienes notificaciones nuevas.')).toBeInTheDocument()
    expect(panel.queryByRole('button', { name: 'Marcar todas como leídas' })).toBeNull()
    expect(screen.getByRole('button', { name: 'Notificaciones' })).toBeInTheDocument()
  })

  it('opens what a notification is about, reads it and closes the panel', async () => {
    const { user, router } = renderCenter()
    const panel = await openPanel(user)
    await user.click(
      within(item(panel, 'Te llegó un caso nuevo')).getByRole('link', { name: 'Abrir caso' }),
    )
    await waitFor(() => expect(router.state.location.pathname).toBe('/analista'))
    expect(router.state.location.search).toBe('?caso=CASE-00000000000000000000000103')
    expect(router.state.location.state).toEqual({ focus: 'notification' })
    expect(markNotificationRead).toHaveBeenCalledWith('NTF-00000000000000000000000004')
    expect(screen.queryByRole('region', { name: 'Notificaciones' })).toBeNull()
  })

  it('closes with Escape (focus back on the bell) and with a click outside', async () => {
    const { user } = renderCenter()
    await openPanel(user)
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('region', { name: 'Notificaciones' })).toBeNull()
    expect(screen.getByRole('button', { name: 'Notificaciones, 3 sin leer' })).toHaveFocus()
    await openPanel(user)
    await user.click(document.body)
    expect(screen.queryByRole('region', { name: 'Notificaciones' })).toBeNull()
    await openPanel(user)
    await user.click(screen.getByRole('button', { name: 'Cerrar notificaciones' }))
    expect(screen.queryByRole('region', { name: 'Notificaciones' })).toBeNull()
  })

  it('says "Estás al día" when nothing is unread (notificacionesVacia)', async () => {
    vi.mocked(fetchNotifications).mockResolvedValue(
      makeNotificationPage(analystNotifications.map((n) => ({ ...n, readAt: minutesFrom(-1) }))),
    )
    const { user } = renderCenter()
    await user.click(await screen.findByRole('button', { name: 'Notificaciones' }))
    const panel = within(screen.getByRole('region', { name: 'Notificaciones' }))
    expect(panel.getByText('Estás al día')).toBeInTheDocument()
    expect(panel.getAllByRole('heading', { level: 3 }).map((h) => h.textContent)).toEqual([
      'Anteriores',
    ])
  })

  it('shows the error with a retry, and loads older pages', async () => {
    vi.mocked(fetchNotifications).mockRejectedValueOnce(
      new ApiProblem({ status: 0, code: 'network_error', title: 'Sin conexión' }),
    )
    const { user } = renderCenter()
    await user.click(screen.getByRole('button', { name: 'Notificaciones' }))
    const panel = within(screen.getByRole('region', { name: 'Notificaciones' }))
    expect(await panel.findByText('No pudimos cargar tus notificaciones')).toBeInTheDocument()
    vi.mocked(fetchNotifications).mockResolvedValueOnce(
      makeNotificationPage(analystNotifications.slice(0, 2), { nextCursor: 'cursor-2' }),
    )
    await user.click(panel.getByRole('button', { name: 'Reintentar' }))
    vi.mocked(fetchNotifications).mockResolvedValueOnce(
      makeNotificationPage(analystNotifications.slice(2), { unreadCount: 3 }),
    )
    await user.click(await panel.findByRole('button', { name: 'Cargar más' }))
    expect(await panel.findByText('El cliente calificó tu atención: Excelente')).toBeVisible()
    expect(fetchNotifications).toHaveBeenLastCalledWith('cursor-2', expect.anything())
  })
})

describe('NotificationCenter: live', () => {
  it('a new one raises the count and toasts with its action and "Más tarde"', async () => {
    const { user, sockets } = renderCenter()
    await screen.findByRole('button', { name: 'Notificaciones, 3 sin leer' })
    const fresh = makeNotification({
      id: 'NTF-00000000000000000000000050',
      kind: 'escalation_answered',
      createdAt: minutesFrom(0),
      actorName: 'Lucía Herrera',
      customerName: 'Marcela Quintana Pardo',
      caseId: 'CASE-00000000000000000000000101',
    })
    act(() => {
      sockets.last()?.open()
      sockets.last()?.receive(notificationCreated(fresh, 4))
    })
    expect(await screen.findByRole('button', { name: 'Notificaciones, 4 sin leer' })).toBeVisible()
    const toasts = within(screen.getByRole('region', { name: 'Avisos' }))
    expect(toasts.getByText('Supervisión respondió tu escalamiento')).toBeInTheDocument()
    expect(toasts.getByText('Lucía Herrera sobre Marcela Quintana Pardo')).toBeInTheDocument()
    expect(toasts.getByRole('button', { name: 'Revisar' })).toBeInTheDocument()
    await user.click(toasts.getByRole('button', { name: 'Más tarde' }))
    expect(toasts.queryByText('Supervisión respondió tu escalamiento')).toBeNull()
    // Still unread in the bell.
    expect(screen.getByRole('button', { name: 'Notificaciones, 4 sin leer' })).toBeVisible()
    expect(markNotificationRead).not.toHaveBeenCalled()
  })

  it("the toast's action opens it and reads it", async () => {
    const { user, sockets, router } = renderCenter()
    await screen.findByRole('button', { name: 'Notificaciones, 3 sin leer' })
    const fresh = makeNotification({
      id: 'NTF-00000000000000000000000051',
      createdAt: minutesFrom(0),
    })
    act(() => {
      sockets.last()?.open()
      sockets.last()?.receive(notificationCreated(fresh, 4))
    })
    const toasts = within(screen.getByRole('region', { name: 'Avisos' }))
    await user.click(await toasts.findByRole('button', { name: 'Abrir caso' }))
    await waitFor(() => expect(router.state.location.pathname).toBe('/analista'))
    expect(markNotificationRead).toHaveBeenCalledWith(fresh.id)
  })

  it('toasts only on the screens of its role (the bell still counts it)', async () => {
    const { sockets } = renderCenter('/supervision/colas', allRolesStaff)
    await screen.findByRole('button', { name: 'Notificaciones, 3 sin leer' })
    act(() => {
      sockets.last()?.open()
      sockets
        .last()
        ?.receive(
          notificationCreated(
            makeNotification({ id: 'NTF-00000000000000000000000052', createdAt: minutesFrom(0) }),
            4,
          ),
        )
    })
    expect(await screen.findByRole('button', { name: 'Notificaciones, 4 sin leer' })).toBeVisible()
    expect(screen.queryByText('Te llegó un caso nuevo')).toBeNull()
  })

  it('drops a toast read elsewhere (another tab)', async () => {
    const { sockets } = renderCenter()
    await screen.findByRole('button', { name: 'Notificaciones, 3 sin leer' })
    const fresh = makeNotification({
      id: 'NTF-00000000000000000000000053',
      createdAt: minutesFrom(0),
    })
    act(() => {
      sockets.last()?.open()
      sockets.last()?.receive(notificationCreated(fresh, 4))
    })
    expect(await screen.findByText('Te llegó un caso nuevo')).toBeInTheDocument()
    act(() => sockets.last()?.receive(notificationsRead([fresh.id], 3)))
    await waitFor(() => expect(screen.queryByText('Te llegó un caso nuevo')).toBeNull())
    expect(screen.getByRole('button', { name: 'Notificaciones, 3 sin leer' })).toBeVisible()
  })
})
