import { Navigate, useLocation, useNavigate } from 'react-router'
import { PATHS } from '@/app/paths'
import { useSession } from '@/app/session'
import { MfaScreen, readMfaState, type LockedRouteState } from '@/features/auth'

/**
 * /login/verify — step 2 (6-digit code). Needs the challenge from step 1
 * in router state; without it (reload, direct link) it goes back to /login.
 * After `signIn`, the GuestOnly guard redirects to the requested page or home.
 */
export default function MfaRoute() {
  const location = useLocation()
  const navigate = useNavigate()
  const { signIn } = useSession()
  const challenge = readMfaState(location.state)

  if (!challenge) return <Navigate to={PATHS.login} replace />

  return (
    <MfaScreen
      challengeId={challenge.challengeId}
      email={challenge.email}
      showDevHint={import.meta.env.DEV}
      onSignedIn={({ token, staff }) => signIn(token, staff)}
      onLocked={({ email, unlockAt }) => {
        const state: LockedRouteState = { email, ...(unlockAt ? { unlockAt } : {}) }
        navigate(PATHS.loginLocked, { replace: true, state })
      }}
      onRestart={(notice) =>
        navigate(PATHS.login, {
          replace: true,
          state: { notice, ...(challenge.from ? { from: challenge.from } : {}) },
        })
      }
    />
  )
}
