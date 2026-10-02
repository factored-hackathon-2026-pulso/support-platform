/**
 * Bounded memory of recently seen envelope keys (insertion-ordered LRU).
 *
 * The server sends one envelope per event and connection, but the same
 * `(type, id)` can still reach a tab twice (an older server fanning out per
 * topic, a retry after a reconnect). `RealtimeClient` drops the repeat before
 * any handler runs, so cache handlers and the refetches they trigger run once.
 */
export const DEFAULT_DEDUPE_WINDOW = 512

export class RecentKeys {
  private readonly keys = new Set<string>()
  private readonly capacity: number

  constructor(capacity = DEFAULT_DEDUPE_WINDOW) {
    this.capacity = Math.max(1, capacity)
  }

  /** Records `key`; returns `false` when it was already among the recent keys. */
  add(key: string): boolean {
    if (this.keys.has(key)) {
      // Refresh recency, so a key that keeps repeating stays remembered.
      this.keys.delete(key)
      this.keys.add(key)
      return false
    }
    this.keys.add(key)
    if (this.keys.size > this.capacity) {
      const oldest = this.keys.values().next().value
      if (oldest !== undefined) this.keys.delete(oldest)
    }
    return true
  }

  get size(): number {
    return this.keys.size
  }
}

/** Dedupe key of a domain envelope: ids are unique per `type` (contract §5.2). */
export function envelopeKey(envelope: { type: string; id: string }): string {
  return `${envelope.type}\u0000${envelope.id}`
}
