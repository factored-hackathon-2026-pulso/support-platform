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
import { primePreferences } from '@/app/preferences'
import { sessionKeys, type Staff } from '@/app/session'
import { i18n, type AppLocale } from '@/lib/i18n'
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
  /**
   * The UI language (slice 23): the app renders in it from the first frame, and a signed-in
   * `staff` has it as her saved preference. Default `es`. Every catalog is preloaded
   * (src/test/setup.ts), and the language goes back to `es` after each test.
   */
  locale?: AppLocale
}

/**
 * Switch the UI language for a test, synchronously (every catalog is already loaded). Use it
 * to change language mid-test; `renderRoute` / `renderWithProviders` take `locale` for the start.
 */
export function setTestLocale(locale: AppLocale): void {
  void i18n.changeLanguage(locale)
  if (i18n.language !== locale) {
    throw new Error(`The UI language did not switch to ${locale} synchronously.`)
  }
}

/**
 * Fresh providers per test: own query cache, fake realtime socket, own envelope
 * handler registry (every feature's), optional session.
 */
function setupProviders({
  staff = null,
  token,
  aiEnabled = false,
  locale = 'es',
}: RenderAppOptions) {
  setTestLocale(locale)
  const queryClient = createQueryClient()
  const sockets = createFakeSocketFactory()
  const realtimeClient = createAppRealtimeClient(sockets.factory)
  const envelopeHandlers = createAppEnvelopeHandlers()
  if (staff) {
    queryClient.setQueryData(sessionKeys.me(), staff)
    primePlatformSettings(queryClient, { aiEnabled })
    primePreferences(queryClient, { uiLanguage: locale })
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
  {
    route = '/',
    path = '*',
    staff,
    token,
    aiEnabled,
    locale,
    ...options
  }: RenderWithProvidersOptions = {},
) {
  const { Wrapper, ...context } = setupProviders({ staff, token, aiEnabled, locale })
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
