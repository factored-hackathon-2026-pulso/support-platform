/**
 * API types of the notification center (docs/platform/api/slice-10-notifications.md):
 * aliases of the schemas generated from `backend/openapi.json` (`pnpm gen:api`), plus the
 * payloads of the two envelopes on `staff:<id>`.
 */
import type { InfiniteData } from '@tanstack/react-query'
import type { Schemas } from '@/lib/api'

export type Notification = Schemas['Notification']
export type NotificationKind = Schemas['NotificationKind']
export type NotificationPage = Schemas['NotificationPage']
export type NotificationReadResult = Schemas['NotificationReadResult']
export type NotificationsReadAllResult = Schemas['NotificationsReadAllResult']

/** The list cache: pages of `GET /me/notifications`, newest first. */
export type NotificationPages = InfiniteData<NotificationPage, string | null>

/** `notification.created` → `{ notification, unreadCount }`. */
export interface NotificationCreatedPayload {
  notification: Notification
  unreadCount: number
}

/** `notifications.read` → `{ notificationIds (null = all), unreadCount }`. */
export interface NotificationsReadPayload {
  notificationIds: string[] | null
  unreadCount: number
}
