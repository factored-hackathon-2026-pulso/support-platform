import { useEffect, useState } from 'react'

/**
 * Generic React utilities shared by every feature (a debounced search box, a
 * ticking clock). Features import them from `@/lib/hooks` instead of copying
 * them, since features cannot import each other's internals.
 */

/** `value` once it stopped changing for `delayMs` (search as you type). */
export function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value)
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delayMs)
    return () => clearTimeout(timer)
  }, [value, delayMs])
  return debounced
}

/**
 * The real clock, re-read every `intervalMs` while `enabled` (SLA countdowns,
 * "hace 2 min", day separators "Hoy" / "Ayer").
 */
export function useNow(intervalMs: number, enabled = true): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!enabled) return
    const timer = setInterval(() => setNow(Date.now()), intervalMs)
    return () => clearInterval(timer)
  }, [intervalMs, enabled])
  return now
}
