/** Router state carried to /login so the user lands where they were going. */
export interface LoginRedirectState {
  from?: string
}

/** The page the user wanted before being sent to /login (from router state). */
export function readRedirectFrom(state: unknown): string | null {
  if (typeof state !== 'object' || state === null || !('from' in state)) return null
  const { from } = state as { from: unknown }
  return typeof from === 'string' ? from : null
}
