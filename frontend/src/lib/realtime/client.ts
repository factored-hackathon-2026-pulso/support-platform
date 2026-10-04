/**
 * Realtime client: one WebSocket per tab to `/api/v1/ws?token=`.
 *
 * - Topic subscriptions are reference counted, so two components watching the
 *   same case share one server subscription, and they are replayed after every
 *   reconnect.
 * - Unexpected closes reconnect with exponential backoff + jitter; the attempt
 *   counter resets once a connection opens.
 * - Domain envelopes are deduplicated by `(type, id)` (a bounded window of
 *   recent keys, kept across reconnects): handlers and listeners see each event
 *   once, even if the server delivers it twice. Control envelopes pass through.
 * - Close code 4401 (token rejected, session ended or expired), 4403 and 1008
 *   stop reconnecting and call `onAuthError` (the session then ends and the user
 *   goes to /login). 1013 ("try again later") and network drops reconnect.
 * - Close code 4409 (`access_changed`: an admin changed this person's roles) is
 *   not an auth error: the token is still valid, so the client reconnects at
 *   once (no backoff) and tells the `onAccessChanged` listeners, which reload
 *   the session (/auth/me); the replayed subscriptions are re-checked with the
 *   new roles by the server.
 * - Framework-free: React glue lives in `react.tsx`.
 */
import { computeBackoff, type BackoffOptions } from './backoff'
import { RecentKeys, envelopeKey } from './dedupe'
import {
  isControlEnvelope,
  parseEnvelope,
  type ClientMessage,
  type ConnectionStatus,
  type RealtimeEnvelope,
  type RealtimeTopic,
} from './types'

/** Close codes that mean "do not retry with this token". */
export const AUTH_CLOSE_CODES: ReadonlySet<number> = new Set([1008, 4401, 4403])

/** The person's roles changed (slice-4-administration.md §9.3): reconnect now, reload the session. */
export const ACCESS_CHANGED_CLOSE_CODE = 4409

/** Minimal WebSocket surface the client needs (the browser one, or a fake in tests). */
export interface WebSocketLike {
  readonly readyState: number
  send(data: string): void
  close(code?: number, reason?: string): void
  onopen: ((event: Event) => void) | null
  onclose: ((event: CloseEvent) => void) | null
  onmessage: ((event: MessageEvent) => void) | null
  onerror: ((event: Event) => void) | null
}

export type WebSocketFactory = (url: string) => WebSocketLike

const CONNECTING = 0
const OPEN = 1

export interface RealtimeClientOptions {
  /** Builds the socket URL for the current token (see `realtimeUrl`). */
  url: (token: string) => string
  /** Current session token; `null` means do not connect. */
  getToken: () => string | null
  /** Defaults to the browser WebSocket. */
  createSocket?: WebSocketFactory
  backoff?: BackoffOptions
  /** Called when the server rejects the token. */
  onAuthError?: () => void
  /** How many recent envelope keys to remember for dedupe (default 512). */
  dedupeWindow?: number
}

type EnvelopeListener = (envelope: RealtimeEnvelope) => void
type StatusListener = (status: ConnectionStatus) => void
type AccessChangedListener = () => void

export class RealtimeClient {
  private readonly options: RealtimeClientOptions
  private socket: WebSocketLike | null = null
  private status: ConnectionStatus = 'idle'
  private attempt = 0
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null
  /** Set by `disconnect()`: an intentional close must not reconnect. */
  private stopped = true
  private readonly topicRefs = new Map<RealtimeTopic, number>()
  private readonly envelopeListeners = new Set<EnvelopeListener>()
  private readonly statusListeners = new Set<StatusListener>()
  private readonly accessChangedListeners = new Set<AccessChangedListener>()
  private readonly seen: RecentKeys

  constructor(options: RealtimeClientOptions) {
    this.options = options
    this.seen = new RecentKeys(options.dedupeWindow)
  }

  getStatus(): ConnectionStatus {
    return this.status
  }

  /** Topics with at least one subscriber. */
  activeTopics(): RealtimeTopic[] {
    return [...this.topicRefs.keys()]
  }

  /** Opens the socket (no-op without a token or when already connected). */
  connect(): void {
    this.stopped = false
    if (this.socket || this.reconnectTimer) return
    this.open()
  }

  /** Closes the socket for good (sign out, unmount). Subscriptions are kept for a later connect. */
  disconnect(): void {
    this.stopped = true
    this.clearReconnectTimer()
    const socket = this.socket
    this.socket = null
    if (socket) {
      this.detach(socket)
      closeWhenSettled(socket)
    }
    this.attempt = 0
    this.setStatus('closed')
  }

  /**
   * Subscribe to a topic. Returns the unsubscribe function.
   * The server only hears about the first subscriber and the last unsubscriber.
   */
  subscribe(topic: RealtimeTopic): () => void {
    const count = this.topicRefs.get(topic) ?? 0
    this.topicRefs.set(topic, count + 1)
    if (count === 0) this.send({ action: 'subscribe', topic })

    let active = true
    return () => {
      if (!active) return
      active = false
      const current = this.topicRefs.get(topic) ?? 0
      if (current <= 1) {
        this.topicRefs.delete(topic)
        this.send({ action: 'unsubscribe', topic })
      } else {
        this.topicRefs.set(topic, current - 1)
      }
    }
  }

  onEnvelope(listener: EnvelopeListener): () => void {
    this.envelopeListeners.add(listener)
    return () => this.envelopeListeners.delete(listener)
  }

  onStatusChange(listener: StatusListener): () => void {
    this.statusListeners.add(listener)
    return () => this.statusListeners.delete(listener)
  }

  /** Called when the server closes with 4409 (the person's roles changed). */
  onAccessChanged(listener: AccessChangedListener): () => void {
    this.accessChangedListeners.add(listener)
    return () => this.accessChangedListeners.delete(listener)
  }

  // ── internals ────────────────────────────────────────────────────────────

  private open(reconnecting = this.attempt > 0): void {
    const token = this.options.getToken()
    if (!token) {
      this.setStatus('idle')
      return
    }
    const create =
      this.options.createSocket ?? ((url: string) => new WebSocket(url) as WebSocketLike)
    this.setStatus(reconnecting ? 'reconnecting' : 'connecting')

    let socket: WebSocketLike
    try {
      socket = create(this.options.url(token))
    } catch {
      this.scheduleReconnect()
      return
    }
    this.socket = socket

    socket.onopen = () => {
      this.attempt = 0
      this.setStatus('open')
      for (const topic of this.activeTopics()) this.send({ action: 'subscribe', topic })
    }
    socket.onmessage = (event) => {
      const envelope = parseEnvelope(event.data)
      if (!envelope) return
      if (!isControlEnvelope(envelope) && !this.seen.add(envelopeKey(envelope))) return
      for (const listener of this.envelopeListeners) listener(envelope)
    }
    socket.onerror = () => {
      // Browsers always follow an error with a close event; reconnect happens there.
    }
    socket.onclose = (event) => {
      if (this.socket !== socket) return
      this.detach(socket)
      this.socket = null
      if (this.stopped) {
        this.setStatus('closed')
        return
      }
      if (AUTH_CLOSE_CODES.has(event.code)) {
        this.stopped = true
        this.setStatus('closed')
        this.options.onAuthError?.()
        return
      }
      if (event.code === ACCESS_CHANGED_CLOSE_CODE) {
        // Same token, new roles: reconnect right away (a `reconnecting` → `open`
        // edge, so screens refetch what they missed) and reload the session.
        this.attempt = 0
        this.open(true)
        for (const listener of this.accessChangedListeners) listener()
        return
      }
      this.scheduleReconnect()
    }
  }

  private scheduleReconnect(): void {
    if (this.stopped) return
    const delay = computeBackoff(this.attempt, this.options.backoff)
    this.attempt += 1
    this.setStatus('reconnecting')
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null
      if (!this.stopped) this.open()
    }, delay)
  }

  private clearReconnectTimer(): void {
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer)
    this.reconnectTimer = null
  }

  private detach(socket: WebSocketLike): void {
    socket.onopen = null
    socket.onclose = null
    socket.onmessage = null
    socket.onerror = null
  }

  private send(message: ClientMessage): void {
    // While disconnected the topics stay in `topicRefs` and are replayed on open.
    if (this.socket?.readyState === OPEN) this.socket.send(JSON.stringify(message))
  }

  private setStatus(status: ConnectionStatus): void {
    if (status === this.status) return
    this.status = status
    for (const listener of this.statusListeners) listener(status)
  }
}

/**
 * Closes a socket we no longer want. One that is still connecting is closed as
 * soon as it opens: closing it mid-handshake makes browsers log "WebSocket is
 * closed before the connection is established" (e.g. React StrictMode's dev
 * remount of a provider that already holds a token, like the /customer simulator).
 */
function closeWhenSettled(socket: WebSocketLike): void {
  if (socket.readyState === CONNECTING) {
    socket.onopen = () => socket.close(1000, 'client disconnect')
    return
  }
  socket.close(1000, 'client disconnect')
}
