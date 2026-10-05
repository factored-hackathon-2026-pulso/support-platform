import type { InfiniteData } from '@tanstack/react-query'
import type { Notification, NotificationPage } from '@/features/notifications'
import type { RealtimeEnvelope } from '@/lib/realtime'
import { NOW, minutesFrom } from './case-fixtures'

/**
 * Invented notifications for tests ("Datos de ejemplo", slice 10): the canvas boards'
 * bell (Workspace "notificaciones", SuColas, Admin), never dataset records.
 */
export function makeNotification(overrides: Partial<Notification> = {}): Notification {
  return {
    id: 'NTF-00000000000000000000000001',
    kind: 'assigned_on_arrival',
    role: 'analyst',
    createdAt: minutesFrom(-14),
    readAt: null,
    caseId: 'CASE-00000000000000000000000103',
    customerName: 'Larissa Monteiro Alves',
    actorId: null,
    actorName: null,
    targetId: null,
    targetName: null,
    escalationId: null,
    language: 'es',
    score: null,
    failedAttempts: null,
    slaDueAt: minutesFrom(1),
    firstResponseAt: null,
    improvement: null,
    ...overrides,
  }
}

/** Daniela's bell (canvas Workspace "notificaciones"): three new, two read. */
export const analystNotifications: Notification[] = [
  makeNotification({
    id: 'NTF-00000000000000000000000005',
    kind: 'reassigned_away',
    createdAt: minutesFrom(-6),
    caseId: 'CASE-00000000000000000000000101',
    customerName: 'Marcela Quintana Pardo',
    actorId: 'STF-00000000000000000000000005',
    actorName: 'Lucía Herrera',
    targetId: 'STF-00000000000000000000000004',
    targetName: 'Sebastián Cárdenas',
  }),
  makeNotification({ id: 'NTF-00000000000000000000000004' }),
  makeNotification({
    id: 'NTF-00000000000000000000000003',
    kind: 'customer_returned',
    createdAt: minutesFrom(-15),
    caseId: 'CASE-00000000000000000000000108',
    customerName: 'Patricia Lozano Vega',
  }),
  makeNotification({
    id: 'NTF-00000000000000000000000002',
    kind: 'escalation_answered',
    createdAt: minutesFrom(-25),
    readAt: minutesFrom(-20),
    caseId: 'CASE-00000000000000000000000101',
    customerName: 'Marcela Quintana Pardo',
    actorId: 'STF-00000000000000000000000005',
    actorName: 'Lucía Herrera',
    escalationId: 'ESC-00000000000000000000000101',
  }),
  makeNotification({
    id: 'NTF-00000000000000000000000001',
    kind: 'case_rated',
    createdAt: '2026-03-01T15:00:00Z',
    readAt: '2026-03-01T16:00:00Z',
    caseId: 'CASE-00000000000000000000000104',
    customerName: 'Patricia Lozano Vega',
    score: 4,
  }),
]

/** One page of `GET /me/notifications`. */
export function makeNotificationPage(
  items: Notification[] = analystNotifications,
  overrides: Partial<NotificationPage> = {},
): NotificationPage {
  return {
    items,
    unreadCount: items.filter((n) => !n.readAt).length,
    nextCursor: null,
    serverTime: NOW.toISOString(),
    ...overrides,
  }
}

/** The list cache as `useInfiniteQuery` keeps it. */
export function asPages(
  ...pages: NotificationPage[]
): InfiniteData<NotificationPage, string | null> {
  return { pages, pageParams: pages.map((_, index) => (index === 0 ? null : `cursor-${index}`)) }
}

/** `notification.created` on `staff:<id>`. */
export function notificationCreated(
  notification: Notification,
  unreadCount: number,
): RealtimeEnvelope {
  return {
    type: 'notification.created',
    id: notification.id,
    occurredAt: notification.createdAt,
    data: {
      entity: 'notification',
      entityId: notification.id,
      caseId: notification.caseId,
      actor: { role: 'system', id: null },
      payload: { notification, unreadCount },
    },
  }
}

/** `notifications.read` on `staff:<id>` (`ids = null`: all of them). */
export function notificationsRead(
  ids: string[] | null,
  unreadCount: number,
  id = 'MSG-00000000000000000000000001',
): RealtimeEnvelope {
  return {
    type: 'notifications.read',
    id,
    occurredAt: NOW.toISOString(),
    data: {
      entity: 'notification',
      entityId: 'STF-00000000000000000000000001',
      caseId: null,
      actor: { role: 'system', id: null },
      payload: { notificationIds: ids, unreadCount },
    },
  }
}
