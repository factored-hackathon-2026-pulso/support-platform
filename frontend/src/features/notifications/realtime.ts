/**
 * Notification center realtime (docs/platform/api/slice-10-notifications.md §4.4): the two
 * envelopes of her own `staff:<id>` topic (`SessionLiveSync` keeps it subscribed on every
 * staff screen) → the list cache, so the bell and the panel update live. Registered in
 * `app/realtime-handlers.ts`; keep this module light (keys + handlers): it is part of the
 * main bundle. The toasts are `useNotificationToasts` (they need the router).
 */
import type { QueryClient } from '@tanstack/react-query'
import { envelopePayload, type RealtimeEnvelope, type RealtimeRegistration } from '@/lib/realtime'
import { notificationKeys } from './api'
import { readNotificationCreated, readNotificationsRead, withCreated, withRead } from './model'
import type { NotificationPages } from './types'

function update(
  queryClient: QueryClient,
  apply: (pages: NotificationPages) => NotificationPages,
): void {
  const key = notificationKeys.list()
  if (queryClient.getQueryData<NotificationPages>(key) === undefined) {
    void queryClient.invalidateQueries({ queryKey: key })
    return
  }
  queryClient.setQueryData<NotificationPages>(key, (pages) => (pages ? apply(pages) : pages))
}

export const registerNotificationsRealtime: RealtimeRegistration = (registry) => {
  registry.register('notification.created', (envelope: RealtimeEnvelope, queryClient) => {
    const payload = readNotificationCreated(envelopePayload(envelope))
    if (payload) update(queryClient, (pages) => withCreated(pages, payload))
  })
  registry.register('notifications.read', (envelope: RealtimeEnvelope, queryClient) => {
    const payload = readNotificationsRead(envelopePayload(envelope))
    if (payload) update(queryClient, (pages) => withRead(pages, payload, envelope.occurredAt))
  })
}
