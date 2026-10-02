import { useLocation, useNavigate } from 'react-router'
import { readRedirectFrom } from '@/app/redirect'
import { LoginScreen, type LockedRouteState, type MfaRouteState } from '@/features/auth'

function readNotice(state: unknown): string | null {
  if (typeof state !== 'object' || state === null || !('notice' in state)) return null
  const { notice } = state as { notice: unknown }
  return typeof notice === 'string' ? notice : null
}

/** /login — step 1 (email + password). */
export default function LoginRoute() {
  const navigate = useNavigate()
  const location = useLocation()
  const from = readRedirectFrom(location.state)

  return (
    <LoginScreen
      notice={readNotice(location.state)}
      showDevHint={import.meta.env.DEV}
      onChallenge={(challenge, email) => {
        const state: MfaRouteState = {
          challengeId: challenge.challengeId,
          email,
          methods: challenge.methods,
          ...(from ? { from } : {}),
        }
        navigate('/login/verificacion', { state })
      }}
      onLocked={({ email, unlockAt }) => {
        const state: LockedRouteState = { email, ...(unlockAt ? { unlockAt } : {}) }
        navigate('/login/bloqueada', { replace: true, state })
      }}
    />
  )
}
