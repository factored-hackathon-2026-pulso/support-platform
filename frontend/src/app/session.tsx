import {
  createContext,
  use,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useSyncExternalStore,
  type ReactNode,
} from 'react'
import { useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query'
import { useLocation } from 'react-router'
import { api, isApiProblem, unwrap, type Schemas } from '@/lib/api'
import { sortLanguages, type FactItem } from '@/components/ui'
import { getInitials } from '@/lib/format'
import { i18n } from '@/lib/i18n'
import { sessionToken } from '@/lib/session-token'
import { primePlatformSettings } from './platform'
import { primePreferences } from './preferences'
import { ROLES, roleFromPath, sortRoles, type RoleDefinition, type RoleId } from './roles'

export type Staff = Schemas['StaffOut']

/**
 * The person's summary as short icon rows (slice 6 UI rule: never a dot-joined
 * line): [users] the team, then her languages as one mark ("[globe] ES PT", named
 * "Español y Português"; skipped when empty).
 */
export function summaryFacts(staff: Pick<Staff, 'team' | 'languages'>): FactItem[] {
  const languages = sortLanguages(staff.languages)
  const facts: FactItem[] = [
    { key: 'team', icon: 'users', text: staff.team.name, label: i18n.t('fields.team') },
  ]
  if (languages.length > 0) {
    facts.push({
      key: 'languages',
      icon: 'languages',
      text: '',
      label: i18n.t('fields.languages'),
      languages,
    })
  }
  return facts
}

/** Staff member as the UI uses it: API fields + derived display values. */
export interface SessionUser extends Staff {
  initials: string
  /** Roles in canonical order, unknown values dropped. */
  roleIds: RoleId[]
  /** Team and languages as short icon rows (`summaryFacts`). */
  summary: FactItem[]
}

export function toSessionUser(staff: Staff): SessionUser {
  return {
    ...staff,
    initials: getInitials(staff.name),
    roleIds: sortRoles(staff.roles),
    summary: summaryFacts(staff),
  }
}

/**
 * - `loading`: there is a token and GET /auth/me is in flight.
 * - `authenticated`: the staff member is known.
 * - `error`: there is a token but /me failed for a transient reason (network,
 *   5xx). The token is kept and the UI offers to retry: an outage is not a sign-out.
 * - `anonymous`: no token (never signed in, signed out, or rejected by the API).
 */
export type SessionStatus = 'anonymous' | 'loading' | 'authenticated' | 'error'

/** Pure status derivation (see SessionStatus). */
export function deriveSessionStatus({
  hasToken,
  hasStaff,
  isFetching,
  error,
}: {
  hasToken: boolean
  hasStaff: boolean
  isFetching: boolean
  error: unknown
}): SessionStatus {
  if (!hasToken) return 'anonymous'
  if (hasStaff) return 'authenticated'
  if (isFetching || error == null) return 'loading'
  return isRejectedToken(error) ? 'anonymous' : 'error'
}

/** Query keys owned by the session (not a feature: every screen depends on it). */
export const sessionKeys = {
  all: ['session'] as const,
  me: () => [...sessionKeys.all, 'me'] as const,
}

/**
 * GET /auth/me → the staff member (the session part is not used by the UI yet). Slice 18: the
 * answer also carries the platform settings (the AI switch); slice 23: her preferences (the UI
 * language). `queryClient` keeps them in their own caches (`app/platform.ts`,
 * `app/preferences.ts`), so they need no second request.
 */
export async function fetchMe(signal?: AbortSignal, queryClient?: QueryClient): Promise<Staff> {
  const { staff, platform, preferences } = await unwrap(api.GET('/api/v1/auth/me', { signal }))
  if (queryClient) {
    primePlatformSettings(queryClient, platform)
    primePreferences(queryClient, preferences)
  }
  return staff
}

/**
 * Best effort: ends the server session (and its sockets). The local sign-out never
 * waits for it. The token is passed explicitly because the caller clears the
 * store right after: the request must not depend on when the auth middleware
 * happens to read it.
 */
function endServerSession(token: string): void {
  void unwrap(
    // i18n-ignore-next-line: the auth scheme, not copy
    api.POST('/api/v1/auth/logout', { headers: { Authorization: `Bearer ${token}` } }),
  ).catch(() => {
    // Expired or unreachable: the local token is dropped anyway.
  })
}

/** A 4xx from /me means the token itself is useless (5xx and network errors are transient). */
function isRejectedToken(error: unknown): boolean {
  return isApiProblem(error) && error.status >= 400 && error.status < 500
}

interface SessionContextValue {
  status: SessionStatus
  user: SessionUser | null
  hasRole: (role: RoleId) => boolean
  /** Stores the token and the staff returned by POST /auth/mfa. */
  signIn: (token: string, staff: Staff) => void
  signOut: () => void
  /** Ask GET /auth/me again (after `status: 'error'`). */
  retry: () => void
}

const SessionContext = createContext<SessionContextValue | null>(null)

/**
 * Session state: token (memory + sessionStorage, see lib/session-token) and the
 * staff member from GET /auth/me. A 401 on any authenticated call clears the
 * token (lib/api/client.ts), which makes `status` anonymous and the route
 * guards redirect to /login. Lives outside the router (see providers.tsx).
 */
export function SessionProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient()
  const token = useSessionToken()

  const me = useQuery({
    queryKey: sessionKeys.me(),
    queryFn: ({ signal }) => fetchMe(signal, queryClient),
    enabled: token !== null,
    staleTime: Infinity,
  })

  // When the token goes away (sign out, expired session) drop every cached
  // response: the next user must never see the previous one's data.
  const previousToken = useRef(token)
  useEffect(() => {
    if (previousToken.current !== null && token === null) queryClient.clear()
    previousToken.current = token
  }, [token, queryClient])

  // A token that /me rejects (401 is already handled by the API client; 403…) is
  // useless. 5xx and network errors keep it: see `status: 'error'`.
  useEffect(() => {
    if (token && me.isError && isRejectedToken(me.error)) sessionToken.clear()
  }, [token, me.isError, me.error])

  const signIn = useCallback(
    (nextToken: string, staff: Staff) => {
      queryClient.setQueryData(sessionKeys.me(), staff)
      sessionToken.set(nextToken)
    },
    [queryClient],
  )

  const signOut = useCallback(() => {
    const current = sessionToken.get()
    if (current) endServerSession(current)
    sessionToken.clear()
  }, [])

  const { refetch } = me
  const retry = useCallback(() => {
    void refetch()
  }, [refetch])

  const staff = token ? me.data : undefined
  const status = deriveSessionStatus({
    hasToken: token !== null,
    hasStaff: staff !== undefined,
    isFetching: me.isFetching,
    error: me.error,
  })
  const value = useMemo<SessionContextValue>(() => {
    const user = status === 'authenticated' && staff ? toSessionUser(staff) : null
    return {
      status,
      user,
      hasRole: (role) => Boolean(user?.roleIds.includes(role)),
      signIn,
      signOut,
      retry,
    }
  }, [status, staff, signIn, signOut, retry])

  return <SessionContext value={value}>{children}</SessionContext>
}

/** Raw session token (for transports such as the realtime socket). */
export function useSessionToken(): string | null {
  return useSyncExternalStore(sessionToken.subscribe, sessionToken.get, sessionToken.get)
}

export function useSession(): SessionContextValue {
  const ctx = use(SessionContext)
  if (!ctx) throw new Error('useSession must be used inside <SessionProvider>.')
  return ctx
}

/** Signed-in user; only call it under the authenticated shell. */
export function useCurrentUser(): SessionUser {
  const { user } = useSession()
  if (!user) throw new Error('useCurrentUser requires an active session.')
  return user
}

/**
 * Current role, derived from the URL (/analyst, /supervision, /admin).
 * On shared pages (404) it falls back to the user's first role.
 * Must be used inside the router.
 */
export function useCurrentRole(): RoleDefinition {
  const { pathname } = useLocation()
  const { user } = useSession()
  const id = roleFromPath(pathname) ?? user?.roleIds[0] ?? 'analyst'
  return ROLES[id]
}
