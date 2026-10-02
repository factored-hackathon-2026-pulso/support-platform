/**
 * Reconnect delays: exponential backoff with "full jitter"
 * (delay = random(0.5..1) × min(max, base × 2^attempt)), so many tabs that lose
 * the server at once do not reconnect in lockstep.
 */
export interface BackoffOptions {
  /** First delay in ms. Default 500. */
  baseMs?: number
  /** Ceiling in ms. Default 15 000. */
  maxMs?: number
  /** Random source in [0, 1). Inject a constant in tests. */
  random?: () => number
}

export function computeBackoff(
  attempt: number,
  { baseMs = 500, maxMs = 15_000, random = Math.random }: BackoffOptions = {},
): number {
  const safeAttempt = Math.max(0, Math.floor(attempt))
  const ceiling = Math.min(maxMs, baseMs * 2 ** safeAttempt)
  const jitter = 0.5 + random() * 0.5
  return Math.round(ceiling * jitter)
}
