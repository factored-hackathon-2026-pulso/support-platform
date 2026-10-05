import type { ReactNode } from 'react'
import { Outlet } from 'react-router'
import { useRailIndicators, useRailPresence } from '@/app/rail-indicators'
import { useCurrentRole } from '@/app/session'
import { NavigationProgress } from './NavigationProgress'
import { Rail } from './Rail'
import { ScreenSuspense } from './ScreenSuspense'

export interface AppShellProps {
  /** The rail's bell (slice 10), composed by the route table: layout never imports features. */
  notifications?: ReactNode
}

/**
 * Staff layout: full-viewport row with the dark 64px rail and the page.
 * Pure layout: access control lives in the route guards (app/guards.tsx).
 */
export function AppShell({ notifications }: AppShellProps = {}) {
  const role = useCurrentRole()
  const indicators = useRailIndicators(role.id)
  const presence = useRailPresence(role.id)
  return (
    <div className="flex h-dvh min-h-0 bg-canvas text-ink">
      <NavigationProgress />
      <Rail role={role} indicators={indicators} presence={presence} notifications={notifications} />
      <div className="flex min-w-0 grow flex-col overflow-hidden">
        <ScreenSuspense>
          <Outlet />
        </ScreenSuspense>
      </div>
    </div>
  )
}
