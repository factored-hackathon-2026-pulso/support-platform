/**
 * Notification center calls (docs/platform/api/slice-10-notifications.md §4). The only
 * module of the feature that talks to the API client; tests mock it with
 * `vi.mock('@/features/notifications/api')`.
 */
import { api, unwrap } from '@/lib/api'
import type { NotificationPage, NotificationReadResult, NotificationsReadAllResult } from './types'

/** Rows per page of the panel. */
export const NOTIFICATIONS_PAGE_SIZE = 30

/** Query and mutation keys. */
export const notificationKeys = {
  all: ['notifications'] as const,
  list: () => ['notifications', 'list'] as const,
}

export const notificationMutationKeys = {
  read: () => ['notifications', 'read'] as const,
  readAll: () => ['notifications', 'read-all'] as const,
}

/** GET /me/notifications: hers, newest first; `cursor` = the previous page's `nextCursor`. */
export async function fetchNotifications(
  cursor: string | null,
  signal?: AbortSignal,
): Promise<NotificationPage> {
  return unwrap(
    api.GET('/api/v1/me/notifications', {
      params: {
        query: { limit: NOTIFICATIONS_PAGE_SIZE, ...(cursor ? { cursor } : {}) },
      },
      signal,
    }),
  )
}

/** POST /me/notifications/{id}/read (idempotent). */
export async function markNotificationRead(
  notificationId: string,
): Promise<NotificationReadResult> {
  return unwrap(
    api.POST('/api/v1/me/notifications/{notificationId}/read', {
      params: { path: { notificationId } },
    }),
  )
}

/** POST /me/notifications/read-all. */
export async function markAllNotificationsRead(): Promise<NotificationsReadAllResult> {
  return unwrap(api.POST('/api/v1/me/notifications/read-all'))
}
