import type { ReactElement, ReactNode } from 'react'
import { render, type RenderOptions } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createMemoryRouter, RouterProvider, type InitialEntry } from 'react-router'
import { AppProviders } from '@/app/providers'
import { createQueryClient } from '@/app/query-client'
import { createAppRealtimeClient } from '@/app/realtime'
import { createAppEnvelopeHandlers } from '@/app/realtime-handlers'
import { routes } from '@/app/router'
import { primePlatformSettings } from '@/app/platform'
import { sessionKeys, type Staff } from '@/app/session'
import { sessionToken } from '@/lib/session-token'
import { createFakeSocketFactory } from './fake-socket'

export interface RenderAppOptions {
  /** Signed-in staff member; omit (or null) to start signed out. */
  staff?: Staff | null
  /**
   * Stored token without a cached staff member: the app restores the session with
   * GET /auth/me (stub `fetch` for it). Ignored when `staff` is given.
   */
  token?: string
  /**
   * The AI switch (slice 18) as GET /auth/me would say it, primed with `staff`. Default
   * off: the people-only app, so a screen shows no AI element unless a test asks for it.
   */
  aiEnabled?: boolean
}

/**
 * Fresh providers per test: own query cache, fake realtime socket, own envelope
 * handler registry (every feature's), optional session.
 */
function setupProviders({ staff = null, token, aiEnabled = false }: RenderAppOptions) {
  const queryClient = createQueryClient()
  const sockets = createFakeSocketFactory()
  const realtimeClient = createAppRealtimeClient(sockets.factory)
  const envelopeHandlers = createAppEnvelopeHandlers()
  if (staff) {
    queryClient.setQueryData(sessionKeys.me(), staff)
    primePlatformSettings(queryClient, { aiEnabled })
    sessionToken.set(`test-token-${staff.id}`)
  } else if (token) {
    sessionToken.set(token)
  } else {
    sessionToken.clear()
  }
  function Wrapper({ children }: { children: ReactNode }) {
    return (
      <AppProviders
        queryClient={queryClient}
        realtimeClient={realtimeClient}
        envelopeHandlers={envelopeHandlers}
      >
        {children}
      </AppProviders>
    )
  }
  return { queryClient, sockets, realtimeClient, envelopeHandlers, Wrapper }
}

export interface RenderWithProvidersOptions extends RenderOptions, RenderAppOptions {
  /** Initial URL. */
  route?: string
  /** Route pattern the UI is mounted at, so `useParams` works (e.g. '/supervision/cases/:caseId'). */
  path?: string
}

/** Render a component with the app providers and a memory router around it. */
export function renderWithProviders(
  ui: ReactElement,
  { route = '/', path = '*', staff, token, aiEnabled, ...options }: RenderWithProvidersOptions = {},
) {
  const { Wrapper, ...context } = setupProviders({ staff, token, aiEnabled })
  const router = createMemoryRouter([{ path, element: ui }], { initialEntries: [route] })
  return {
    user: userEvent.setup(),
    router,
    ...context,
    ...render(<RouterProvider router={router} />, { wrapper: Wrapper, ...options }),
  }
}

/** Render the real route table at `entry` (path string or { pathname, state }). */
export function renderRoute(entry: InitialEntry, options: RenderAppOptions = {}) {
  const { Wrapper, ...context } = setupProviders(options)
  const router = createMemoryRouter(routes, { initialEntries: [entry] })
  return {
    user: userEvent.setup(),
    router,
    ...context,
    ...render(<RouterProvider router={router} />, { wrapper: Wrapper }),
  }
}
