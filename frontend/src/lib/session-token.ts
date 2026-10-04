/**
 * Session token store: memory first, mirrored to sessionStorage so a reload in
 * the same tab keeps the session, while closing the tab ends it.
 *
 * It is a tiny external store (subscribe/get) so React reads it with
 * `useSyncExternalStore` and non-React code (api client, realtime) reads it
 * directly. Nothing else should touch sessionStorage for auth.
 */

const STAFF_STORAGE_KEY = 'cc.session.token'

type Listener = () => void

function readStorage(key: string): string | null {
  try {
    return globalThis.sessionStorage?.getItem(key) ?? null
  } catch {
    // Storage can be blocked (privacy mode, sandboxed iframes): memory still works.
    return null
  }
}

function writeStorage(key: string, token: string | null): void {
  try {
    if (token === null) globalThis.sessionStorage?.removeItem(key)
    else globalThis.sessionStorage?.setItem(key, token)
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

/** One store per principal: staff (`cc.session.token`) and the simulator customer. */
export function createSessionTokenStore(storageKey: string = STAFF_STORAGE_KEY): SessionTokenStore {
  let token: string | null = readStorage(storageKey)
  const listeners = new Set<Listener>()

  function set(next: string | null) {
    if (next === token) return
    token = next
    writeStorage(storageKey, next)
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

/** The app-wide staff store. Tests call `sessionToken.clear()` between cases. */
export const sessionToken = createSessionTokenStore()

/**
 * Customer token of the /customer simulator (audience `cc-customer`). Kept apart
 * from the staff session on purpose: the staff API client, socket and guards
 * never see it, and dropping it never signs the staff member out.
 */
export const customerSessionToken = createSessionTokenStore('cc.customer.token')
