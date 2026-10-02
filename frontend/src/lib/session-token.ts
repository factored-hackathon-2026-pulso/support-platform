/**
 * Session token store: memory first, mirrored to sessionStorage so a reload in
 * the same tab keeps the session, while closing the tab ends it.
 *
 * It is a tiny external store (subscribe/get) so React reads it with
 * `useSyncExternalStore` and non-React code (api client, realtime) reads it
 * directly. Nothing else should touch sessionStorage for auth.
 */

const STORAGE_KEY = 'cc.session.token'

type Listener = () => void

function readStorage(): string | null {
  try {
    return globalThis.sessionStorage?.getItem(STORAGE_KEY) ?? null
  } catch {
    // Storage can be blocked (privacy mode, sandboxed iframes): memory still works.
    return null
  }
}

function writeStorage(token: string | null): void {
  try {
    if (token === null) globalThis.sessionStorage?.removeItem(STORAGE_KEY)
    else globalThis.sessionStorage?.setItem(STORAGE_KEY, token)
  } catch {
    // See readStorage.
  }
}

export interface SessionTokenStore {
  get(): string | null
  set(token: string | null): void
  clear(): void
  subscribe(listener: Listener): () => void
}

export function createSessionTokenStore(): SessionTokenStore {
  let token: string | null = readStorage()
  const listeners = new Set<Listener>()

  function set(next: string | null) {
    if (next === token) return
    token = next
    writeStorage(next)
    for (const listener of listeners) listener()
  }

  return {
    get: () => token,
    set,
    clear: () => set(null),
    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
  }
}

/** The app-wide store. Tests call `sessionToken.clear()` between cases. */
export const sessionToken = createSessionTokenStore()
