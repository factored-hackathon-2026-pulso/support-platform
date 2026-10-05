import { Navigate, Outlet, useLocation } from 'react-router'
import { CloudOff, UserX } from 'lucide-react'
import { FullScreenStatus } from '@/components/layout'
import { Button, DocumentTitle, EmptyState } from '@/components/ui'
import { useTranslation } from '@/lib/i18n'
import { firstRoleHome, resolvePostLoginPath, type RoleId } from './roles'
import { PATHS } from './paths'
import { readRedirectFrom, type LoginRedirectState } from './redirect'
import { useSession } from './session'

/** Any staff URL: RequireSession renders the "no role" screen there. */
const STAFF_FALLBACK = PATHS.analyst.root

/**
 * The session could not be restored for a transient reason (API down, 5xx): the
 * token is kept, so the user can retry instead of being sent to the login.
 */
function SessionUnavailable() {
  const { retry, signOut } = useSession()
  const { t } = useTranslation(['shell', 'common'])
  return (
    <main className="flex h-dvh items-center justify-center bg-canvas">
      <DocumentTitle title={t('session.unavailableTab')} />
      <EmptyState
        as="h1"
        icon={<CloudOff size={40} strokeWidth={1.6} />}
        title={t('session.unavailableTitle')}
        description={t('session.unavailableText')}
        action={
          <>
            <Button variant="primary" onClick={retry}>
              {t('common:actions.retry')}
            </Button>
            <Button variant="secondary" onClick={signOut}>
              {t('common:actions.signOut')}
            </Button>
          </>
        }
      />
    </main>
  )
}

/** Staff area: needs a session. Anonymous users go to /login (remembering the URL). */
export function RequireSession() {
  const { status, user, signOut } = useSession()
  const location = useLocation()
  const { t } = useTranslation(['shell', 'common'])

  if (status === 'loading') return <FullScreenStatus label={t('session.loading')} />
  if (status === 'error') return <SessionUnavailable />
  if (!user) {
    const state: LoginRedirectState = { from: `${location.pathname}${location.search}` }
    return <Navigate to={PATHS.login} replace state={state} />
  }
  if (user.roleIds.length === 0) {
    return (
      <main className="flex h-dvh items-center justify-center bg-canvas">
        <DocumentTitle title={t('session.noRoleTab')} />
        <EmptyState
          as="h1"
          icon={<UserX size={40} strokeWidth={1.6} />}
          title={t('session.noRoleTitle')}
          description={t('session.noRoleText')}
          action={
            <Button variant="primary" onClick={signOut}>
              {t('common:actions.signOut')}
            </Button>
          }
        />
      </main>
    )
  }
  return <Outlet />
}

/** Role section (/analyst, /supervision…): users without the role go to their own home. */
export function RequireRole({ role }: { role: RoleId }) {
  const { user, hasRole } = useSession()
  if (!user) return <Navigate to={PATHS.login} replace />
  if (!hasRole(role)) return <Navigate to={firstRoleHome(user.roleIds) ?? PATHS.login} replace />
  return <Outlet />
}

/**
 * Login screens: once authenticated (e.g. right after the MFA step) send the
 * user to the page they asked for, or to their first role home.
 */
export function GuestOnly() {
  const { status, user } = useSession()
  const location = useLocation()
  const { t } = useTranslation(['shell', 'common'])
  if (status === 'loading') return <FullScreenStatus label={t('session.loading')} />
  if (status === 'error') return <SessionUnavailable />
  if (user) {
    // No role at all: any staff URL shows the "sin rol" screen of RequireSession.
    const target =
      resolvePostLoginPath(user.roleIds, readRedirectFrom(location.state)) ?? STAFF_FALLBACK
    return <Navigate to={target} replace />
  }
  return <Outlet />
}

/** `/`: home of the signed-in user, or the login. */
export function RootRedirect() {
  const { status, user } = useSession()
  const { t } = useTranslation(['shell', 'common'])
  if (status === 'loading') return <FullScreenStatus label={t('session.loading')} />
  if (status === 'error') return <SessionUnavailable />
  if (!user) return <Navigate to={PATHS.login} replace />
  return <Navigate to={firstRoleHome(user.roleIds) ?? STAFF_FALLBACK} replace />
}
