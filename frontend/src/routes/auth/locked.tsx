import { useLocation } from 'react-router'
import { LockedScreen, readLockedState } from '@/features/auth'

/** /login/bloqueada — lockout after 5 failed attempts, with countdown. */
export default function LockedRoute() {
  const location = useLocation()
  return <LockedScreen {...readLockedState(location.state)} />
}
