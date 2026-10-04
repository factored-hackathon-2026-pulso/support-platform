/**
 * Core public API of the notification center (ARCHITECTURE.md §3, "Two public files"):
 * what the always-loaded app shell may import without components: the realtime
 * registration, the unread-count hook, keys, the copy model and types.
 */
export { notificationKeys } from './api'
export { useUnreadNotificationsCount } from './hooks/use-notifications'
export {
  NOTIFICATION_KIND,
  bellLabel,
  notificationCopy,
  notificationTime,
  readNotificationCreated,
  readNotificationsRead,
} from './model'
export { registerNotificationsRealtime } from './realtime'
export type {
  Notification,
  NotificationCreatedPayload,
  NotificationKind,
  NotificationPage,
  NotificationsReadPayload,
} from './types'
