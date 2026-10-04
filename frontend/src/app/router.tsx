import type { ComponentType } from 'react'
import { createBrowserRouter, Navigate, type RouteObject } from 'react-router'
import { AuthLayout } from '@/components/layout'
import StaffShell from '@/routes/staff-shell'
import { GuestOnly, RequireRole, RequireSession, RootRedirect } from './guards'
import { PATHS } from './paths'
import { RouteErrorBoundary } from './RouteErrorBoundary'
import { RouteFallback } from './RouteFallback'
import type { RoleId } from './roles'

type RouteModule = { default: ComponentType }

/**
 * Lazy route: code-splits the module under src/routes and gives it the route
 * error boundary, so a crash in one screen keeps the rail usable, and a
 * HydrateFallback, so a cold load shows the shell + a spinner instead of a
 * blank page while the chunk downloads. Route modules must `export default`
 * their component.
 */
function lazyRoute(path: string | undefined, load: () => Promise<RouteModule>): RouteObject {
  return {
    ...(path === undefined ? { index: true } : { path }),
    ErrorBoundary: RouteErrorBoundary,
    HydrateFallback: RouteFallback,
    lazy: async () => ({ Component: (await load()).default }),
  }
}

/** Role root without a screen of its own (/supervision → /supervision/queues). */
function indexRedirect(to: string): RouteObject {
  return { index: true, element: <Navigate to={to} replace /> }
}

/** Role section: guard + its screens. */
function roleSection(role: RoleId, path: string, children: RouteObject[]): RouteObject {
  return { path, element: <RequireRole role={role} />, children }
}

/**
 * Route table (English paths from ./paths, brief §5). Child paths are absolute (they start
 * with their parent's). To add a screen: add its path to PATHS, create a module in
 * src/routes/<area>/ and register it here (ARCHITECTURE.md › Routing).
 */
export const routes: RouteObject[] = [
  { path: '/', element: <RootRedirect />, ErrorBoundary: RouteErrorBoundary },

  // Login steps (no rail). Authenticated users are sent to their home.
  {
    path: PATHS.login,
    element: <GuestOnly />,
    ErrorBoundary: RouteErrorBoundary,
    children: [
      {
        Component: AuthLayout,
        children: [
          lazyRoute(undefined, () => import('@/routes/auth/login')),
          lazyRoute(PATHS.loginVerify, () => import('@/routes/auth/mfa')),
          lazyRoute(PATHS.loginLocked, () => import('@/routes/auth/locked')),
        ],
      },
    ],
  },

  // Part 4: the invitation and password-reset links. Same look as the login, but not
  // GuestOnly: a signed-in person opening a link (an admin trying it) still sees it.
  {
    Component: AuthLayout,
    ErrorBoundary: RouteErrorBoundary,
    children: [
      lazyRoute(PATHS.activate, () => import('@/routes/onboarding/activate')),
      lazyRoute(PATHS.resetPassword, () => import('@/routes/onboarding/reset')),
    ],
  },

  // Development mailbox (part 4): only meaningful when the backend runs it.
  lazyRoute(PATHS.devMailbox, () => import('@/routes/dev/mailbox')),

  // Customer chat simulator: dev/demo tool outside the staff shell.
  lazyRoute(PATHS.customer, () => import('@/routes/customer/simulator')),

  // Staff area: session required, then one guard per role section.
  {
    element: <RequireSession />,
    ErrorBoundary: RouteErrorBoundary,
    children: [
      {
        Component: StaffShell,
        ErrorBoundary: RouteErrorBoundary,
        children: [
          roleSection('analyst', PATHS.analyst.root, [
            indexRedirect(PATHS.analyst.home),
            lazyRoute(PATHS.analyst.home, () => import('@/routes/analyst/home')),
            lazyRoute(PATHS.analyst.cases, () => import('@/routes/analyst/workspace')),
            lazyRoute('*', () => import('@/routes/not-found')),
          ]),
          roleSection('supervisor', PATHS.supervision.root, [
            indexRedirect(PATHS.supervision.queues),
            lazyRoute(PATHS.supervision.queues, () => import('@/routes/supervision/queues')),
            lazyRoute(PATHS.supervision.team, () => import('@/routes/supervision/team')),
            lazyRoute(
              PATHS.supervision.escalations,
              () => import('@/routes/supervision/escalations'),
            ),
            lazyRoute(
              `${PATHS.supervision.cases}/:caseId`,
              () => import('@/routes/supervision/case'),
            ),
            lazyRoute(PATHS.supervision.audit, () => import('@/routes/supervision/audit')),
            lazyRoute('*', () => import('@/routes/not-found')),
          ]),
          roleSection('admin', PATHS.admin.root, [
            indexRedirect(PATHS.admin.users),
            lazyRoute(PATHS.admin.users, () => import('@/routes/admin/users')),
            lazyRoute(PATHS.admin.teams, () => import('@/routes/admin/teams')),
            lazyRoute(PATHS.admin.audit, () => import('@/routes/admin/audit')),
            lazyRoute('*', () => import('@/routes/not-found')),
          ]),
          lazyRoute('*', () => import('@/routes/not-found')),
        ],
      },
    ],
  },
]

/** Browser router for the app (main.tsx). Tests use createMemoryRouter(routes). */
export function createAppRouter() {
  return createBrowserRouter(routes)
}
