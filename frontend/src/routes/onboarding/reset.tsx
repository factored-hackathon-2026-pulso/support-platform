import { useSearchParams } from 'react-router'
import { PasswordResetScreen, readToken } from '@/features/onboarding'

/** /reset-password?token= — the password-reset link (public, part 4). */
export default function PasswordResetRoute() {
  const [params] = useSearchParams()
  return <PasswordResetScreen token={readToken(params)} />
}
