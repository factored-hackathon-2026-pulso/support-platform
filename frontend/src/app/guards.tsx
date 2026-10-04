import { Navigate, Outlet, useLocation } from 'react-router'
import { CloudOff, UserX } from 'lucide-react'
import { FullScreenStatus } from '@/components/layout'
import { Button, DocumentTitle, EmptyState } from '@/components/ui'
import { firstRoleHome, resolvePostLoginPath, type RoleId } from './roles'
import { readRedirectFrom, type LoginRedirectState } from './redirect'
import { useSession } from './session'

/** Any staff URL: RequireSession renders the "no role" screen there. */
const STAFF_FALLBACK = '/analista'

/**
 * The session could not be restored for a transient reason (API down, 5xx): the
 * token is kept, so the user can retry instead of being sent to the login.
 */
function SessionUnavailable() {
  const { retry, signOut } = useSession()
  return (
    <main className="flex h-dvh items-center justify-center bg-canvas">
      <DocumentTitle title="Sin conexión" />
      <EmptyState
        as="h1"
        icon={<CloudOff size={40} strokeWidth={1.6} />}
        title="No pudimos cargar tu sesión"
        description="La plataforma no responde en este momento. Tu sesión sigue abierta: intenta de nuevo en unos segundos."
        action={
          <>
            <Button variant="primary" onClick={retry}>
              Reintentar
            </Button>
            <Button variant="secondary" onClick={signOut}>
              Cerrar sesión
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

  if (status === 'loading') return <FullScreenStatus label="Cargando tu sesión" />
  if (status === 'error') return <SessionUnavailable />
  if (!user) {
    const state: LoginRedirectState = { from: `${location.pathname}${location.search}` }
    return <Navigate to="/login" replace state={state} />
  }
  if (user.roleIds.length === 0) {
    return (
      <main className="flex h-dvh items-center justify-center bg-canvas">
        <DocumentTitle title="Sin rol asignado" />
        <EmptyState
          as="h1"
          icon={<UserX size={40} strokeWidth={1.6} />}
          title="Tu cuenta no tiene un rol asignado"
          description="Pide a Administración que te asigne un rol (Analista, Supervisión o Administración)."
          action={
            <Button variant="primary" onClick={signOut}>
              Cerrar sesión
            </Button>
          }
        />
      </main>
    )
  }
  return <Outlet />
}

/** Role section (/analista, /supervision…): users without the role go to their own home. */
export function RequireRole({ role }: { role: RoleId }) {
  const { user, hasRole } = useSession()
  if (!user) return <Navigate to="/login" replace />
  if (!hasRole(role)) return <Navigate to={firstRoleHome(user.roleIds) ?? '/login'} replace />
  return <Outlet />
}

/**
 * Login screens: once authenticated (e.g. right after the MFA step) send the
 * user to the page they asked for, or to their first role home.
 */
export function GuestOnly() {
  const { status, user } = useSession()
  const location = useLocation()
  if (status === 'loading') return <FullScreenStatus label="Cargando tu sesión" />
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
  if (status === 'loading') return <FullScreenStatus label="Cargando tu sesión" />
  if (status === 'error') return <SessionUnavailable />
  if (!user) return <Navigate to="/login" replace />
  return <Navigate to={firstRoleHome(user.roleIds) ?? STAFF_FALLBACK} replace />
}
