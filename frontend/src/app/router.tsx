import type { ComponentType } from 'react'
import { createBrowserRouter, Navigate, type RouteObject } from 'react-router'
import { AppShell, AuthLayout } from '@/components/layout'
import { GuestOnly, RequireRole, RequireSession, RootRedirect } from './guards'
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

/** Role root without a screen of its own (/supervision → /supervision/equipo). */
function indexRedirect(to: string): RouteObject {
  return { index: true, element: <Navigate to={to} replace /> }
}

/** Role section: guard + its screens. */
function roleSection(role: RoleId, path: string, children: RouteObject[]): RouteObject {
  return { path, element: <RequireRole role={role} />, children }
}

/**
 * Route table (Spanish paths, brief §5). To add a screen: create a module in
 * src/routes/<area>/ and register it here (ARCHITECTURE.md › Routing).
 */
export const routes: RouteObject[] = [
  { path: '/', element: <RootRedirect />, ErrorBoundary: RouteErrorBoundary },

  // Login steps (no rail). Authenticated users are sent to their home.
  {
    path: '/login',
    element: <GuestOnly />,
    ErrorBoundary: RouteErrorBoundary,
    children: [
      {
        Component: AuthLayout,
        children: [
          lazyRoute(undefined, () => import('@/routes/auth/login')),
          lazyRoute('verificacion', () => import('@/routes/auth/mfa')),
          lazyRoute('bloqueada', () => import('@/routes/auth/locked')),
        ],
      },
    ],
  },

  // Customer chat simulator: dev/demo tool outside the staff shell.
  lazyRoute('/cliente', () => import('@/routes/customer/simulator')),

  // Staff area: session required, then one guard per role section.
  {
    element: <RequireSession />,
    ErrorBoundary: RouteErrorBoundary,
    children: [
      {
        Component: AppShell,
        ErrorBoundary: RouteErrorBoundary,
        children: [
          roleSection('analyst', '/analista', [
            lazyRoute(undefined, () => import('@/routes/analyst/workspace')),
          ]),
          roleSection('supervisor', '/supervision', [
            indexRedirect('equipo'),
            lazyRoute('equipo', () => import('@/routes/supervision/team')),
            lazyRoute('casos/:caseId', () => import('@/routes/supervision/case')),
            lazyRoute('auditoria', () => import('@/routes/supervision/audit')),
            lazyRoute('*', () => import('@/routes/not-found')),
          ]),
          roleSection('admin', '/administracion', [
            indexRedirect('usuarios'),
            lazyRoute('usuarios', () => import('@/routes/admin/users')),
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
