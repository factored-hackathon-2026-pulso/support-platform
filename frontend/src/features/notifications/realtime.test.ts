import { QueryClient } from '@tanstack/react-query'
import { describe, expect, it, vi } from 'vitest'
import { minutesFrom } from '@/test/case-fixtures'
import {
  asPages,
  makeNotification,
  makeNotificationPage,
  notificationCreated,
  notificationsRead,
} from '@/test/notification-fixtures'
import { createEnvelopeHandlerRegistry } from '@/lib/realtime'
import { notificationKeys } from './api'
import { allNotifications, unreadCountOf } from './model'
import { registerNotificationsRealtime } from './realtime'
import type { NotificationPages } from './types'

function setup(pages?: NotificationPages) {
  const registry = createEnvelopeHandlerRegistry()
  registerNotificationsRealtime(registry)
  const queryClient = new QueryClient()
  if (pages) queryClient.setQueryData(notificationKeys.list(), pages)
  const invalidate = vi.spyOn(queryClient, 'invalidateQueries')
  const read = () => queryClient.getQueryData<NotificationPages>(notificationKeys.list())
  return { registry, queryClient, invalidate, read }
}

describe('registerNotificationsRealtime', () => {
  it('puts a new notification on top of the bell with the server count', () => {
    const { registry, queryClient, read, invalidate } = setup(asPages(makeNotificationPage()))
    const fresh = makeNotification({
      id: 'NTF-00000000000000000000000099',
      createdAt: minutesFrom(0),
    })
    expect(registry.dispatch(notificationCreated(fresh, 4), queryClient)).toBe(1)
    expect(allNotifications(read())[0]?.id).toBe(fresh.id)
    expect(unreadCountOf(read())).toBe(4)
    expect(invalidate).not.toHaveBeenCalled()
  })

  it('marks what was read elsewhere (another tab, "Marcar todas")', () => {
    const { registry, queryClient, read } = setup(asPages(makeNotificationPage()))
    registry.dispatch(notificationsRead(['NTF-00000000000000000000000005'], 2), queryClient)
    expect(allNotifications(read()).filter((n) => !n.readAt)).toHaveLength(2)
    registry.dispatch(notificationsRead(null, 0, 'MSG-2'), queryClient)
    expect(allNotifications(read()).every((n) => n.readAt)).toBe(true)
    expect(unreadCountOf(read())).toBe(0)
  })

  it('refetches when the list was never loaded, and ignores malformed payloads', () => {
    const { registry, queryClient, invalidate, read } = setup()
    registry.dispatch(notificationCreated(makeNotification(), 1), queryClient)
    expect(invalidate).toHaveBeenCalledWith({ queryKey: notificationKeys.list() })
    expect(read()).toBeUndefined()
    invalidate.mockClear()
    const broken = { ...notificationCreated(makeNotification(), 1), data: { payload: {} } }
    registry.dispatch(broken, queryClient)
    expect(invalidate).not.toHaveBeenCalled()
  })
})
