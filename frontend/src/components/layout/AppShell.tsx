import { Outlet } from 'react-router'
import { useRailIndicators, useRailPresence } from '@/app/rail-indicators'
import { useCurrentRole } from '@/app/session'
import { NavigationProgress } from './NavigationProgress'
import { Rail } from './Rail'

/**
 * Staff layout: full-viewport row with the dark 64px rail and the page.
 * Pure layout: access control lives in the route guards (app/guards.tsx).
 */
export function AppShell() {
  const role = useCurrentRole()
  const indicators = useRailIndicators(role.id)
  const presence = useRailPresence(role.id)
  return (
    <div className="flex h-dvh min-h-0 bg-canvas text-ink">
      <NavigationProgress />
      <Rail role={role} indicators={indicators} presence={presence} />
      <div className="flex min-w-0 grow flex-col overflow-hidden">
        <Outlet />
      </div>
    </div>
  )
}
