import { useEffect, useState } from 'react'
import { secondsUntil } from '../model'

/**
 * Seconds left until `target` (ISO string), ticking every second and stopping
 * at 0. Returns null when there is no target.
 */
export function useCountdown(target: string | null | undefined): number | null {
  const [now, setNow] = useState(() => Date.now())
  const remaining = target ? secondsUntil(target, now) : null
  const done = remaining === 0

  useEffect(() => {
    if (!target || done) return
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [target, done])

  return remaining
}
