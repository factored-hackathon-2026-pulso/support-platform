import { AppShell } from '@/components/layout'
import { NotificationCenter } from '@/features/notifications'

/**
 * Layout route of the staff area: the shell with the notification center in the rail
 * (slice 10: the bell, its panel and the live toasts, on every screen of every role).
 * Composed here because layout never imports features and the app shell only imports their
 * `core.ts`; the route table mounts it eagerly (it is the frame of every staff screen).
 */
export default function StaffShell() {
  return <AppShell notifications={<NotificationCenter />} />
}
