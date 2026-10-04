import { useSearchParams } from 'react-router'
import { ActivationScreen, readToken } from '@/features/onboarding'

/** /activate?token= — the invitation link (public, part 4). */
export default function ActivateRoute() {
  const [params] = useSearchParams()
  return <ActivationScreen token={readToken(params)} />
}
