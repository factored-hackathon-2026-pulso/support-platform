import { useCallback } from 'react'
import {
  useInfiniteQuery,
  useMutation,
  useQueryClient,
  type QueryClient,
} from '@tanstack/react-query'
import type { ApiProblem } from '@/lib/api'
import { useOnReconnect } from '@/lib/realtime'
import {
  fetchNotifications,
  markAllNotificationsRead,
  markNotificationRead,
  notificationKeys,
  notificationMutationKeys,
} from '../api'
import { unreadCountOf, withNotification, withRead, withUnreadCount } from '../model'
import type {
  Notification,
  NotificationPage,
  NotificationPages,
  NotificationReadResult,
  NotificationsReadAllResult,
} from '../types'

/** Safety net for anything a socket missed (the bell is on every staff screen). */
export const NOTIFICATIONS_REFETCH_MS = 60_000

function useNotificationsQuery<T>(select: (pages: NotificationPages) => T, enabled: boolean) {
  const queryClient = useQueryClient()
  useOnReconnect(
    () => void queryClient.invalidateQueries({ queryKey: notificationKeys.all }),
    enabled,
  )
  return useInfiniteQuery<
    NotificationPage,
    ApiProblem,
    T,
    ReturnType<typeof notificationKeys.list>,
    string | null
  >({
    queryKey: notificationKeys.list(),
    queryFn: ({ pageParam, signal }) => fetchNotifications(pageParam, signal),
    initialPageParam: null,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    refetchInterval: NOTIFICATIONS_REFETCH_MS,
    select,
    enabled,
  })
}

const identity = (pages: NotificationPages) => pages

/** GET /me/notifications as pages (newest first), live through realtime.ts. */
export function useNotifications({ enabled = true }: { enabled?: boolean } = {}) {
  return useNotificationsQuery(identity, enabled)
}

/** Her unread count (the bell badge and its accessible name); 0 until it loads. */
export function useUnreadNotificationsCount({
  enabled = true,
}: { enabled?: boolean } = {}): number {
  return useNotificationsQuery(unreadCountOf, enabled).data ?? 0
}

function patch(queryClient: QueryClient, apply: (pages: NotificationPages) => NotificationPages) {
  queryClient.setQueryData<NotificationPages>(notificationKeys.list(), (pages) =>
    pages ? apply(pages) : pages,
  )
}

/**
 * POST /me/notifications/{id}/read: optimistic (the dot and the count go at once), then
 * the server's answer; a failure refetches the list.
 */
export function useMarkNotificationRead() {
  const queryClient = useQueryClient()
  return useMutation<NotificationReadResult, ApiProblem, Notification>({
    mutationKey: notificationMutationKeys.read(),
    mutationFn: (notification) => markNotificationRead(notification.id),
    onMutate: (notification) => {
      if (notification.readAt) return
      const pages = queryClient.getQueryData<NotificationPages>(notificationKeys.list())
      const unread = Math.max(0, unreadCountOf(pages) - 1)
      patch(queryClient, (current) =>
        withRead(
          current,
          { notificationIds: [notification.id], unreadCount: unread },
          new Date().toISOString(),
        ),
      )
    },
    onSuccess: (result) =>
      patch(queryClient, (pages) =>
        withNotification(pages, result.notification, result.unreadCount),
      ),
    onError: () => void queryClient.invalidateQueries({ queryKey: notificationKeys.all }),
  })
}

/** POST /me/notifications/read-all: optimistic, then the server's count. */
export function useMarkAllNotificationsRead() {
  const queryClient = useQueryClient()
  return useMutation<NotificationsReadAllResult, ApiProblem, void>({
    mutationKey: notificationMutationKeys.readAll(),
    mutationFn: () => markAllNotificationsRead(),
    onMutate: () =>
      patch(queryClient, (pages) =>
        withRead(pages, { notificationIds: null, unreadCount: 0 }, new Date().toISOString()),
      ),
    onSuccess: (result) =>
      patch(queryClient, (pages) => withUnreadCount(pages, result.unreadCount)),
    onError: () => void queryClient.invalidateQueries({ queryKey: notificationKeys.all }),
  })
}

/** Mark one read without waiting (navigation from the panel or a toast). */
export function useReadNotification(): (notification: Notification) => void {
  const { mutate } = useMarkNotificationRead()
  return useCallback(
    (notification: Notification) => {
      if (!notification.readAt) mutate(notification)
    },
    [mutate],
  )
}
