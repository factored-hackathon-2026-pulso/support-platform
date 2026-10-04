import { useLocation, useNavigate } from 'react-router'
import { PATHS } from '@/app/paths'
import { readRedirectFrom } from '@/app/redirect'
import { LoginScreen, type LockedRouteState, type MfaRouteState } from '@/features/auth'
import { useDevMailboxEnabled } from '@/features/onboarding/core'

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
  const devMailbox = useDevMailboxEnabled()

  return (
    <LoginScreen
      notice={readNotice(location.state)}
      showDevHint={import.meta.env.DEV}
      showDevMailbox={devMailbox}
      onChallenge={(challenge, email) => {
        const state: MfaRouteState = {
          challengeId: challenge.challengeId,
          email,
          ...(from ? { from } : {}),
        }
        navigate(PATHS.loginVerify, { state })
      }}
      onLocked={({ email, unlockAt }) => {
        const state: LockedRouteState = { email, ...(unlockAt ? { unlockAt } : {}) }
        navigate(PATHS.loginLocked, { replace: true, state })
      }}
    />
  )
}
