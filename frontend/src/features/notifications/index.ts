/**
 * Public API of the notification center (docs/platform/api/slice-10-notifications.md §5):
 * the rail bell + panel and the live toasts (`NotificationCenter`, composed by the route
 * table into the staff shell). Depends on `@/features/cases/core` (rating words) and
 * `@/features/conversation/core` (language names). Everything in `./core` is re-exported
 * here; the app shell imports `core` only.
 */
export * from './core'
export { NotificationCenter } from './components/NotificationCenter'
export { NotificationItem, NotificationTile } from './components/NotificationItem'
