import type { WebSocketLike } from '@/lib/realtime'

/** In-memory WebSocket for tests: drive it with open() / receive() / serverClose(). */
export class FakeSocket implements WebSocketLike {
  readyState = 0
  sent: string[] = []
  closedWith: { code?: number; reason?: string } | null = null
  onopen: WebSocketLike['onopen'] = null
  onclose: WebSocketLike['onclose'] = null
  onmessage: WebSocketLike['onmessage'] = null
  onerror: WebSocketLike['onerror'] = null

  readonly url: string

  constructor(url: string) {
    this.url = url
  }

  send(data: string) {
    this.sent.push(data)
  }

  close(code?: number, reason?: string) {
    this.readyState = 3
    this.closedWith = { code, reason }
  }

  open() {
    this.readyState = 1
    this.onopen?.(new Event('open'))
  }

  receive(data: unknown) {
    this.onmessage?.(
      new MessageEvent('message', { data: typeof data === 'string' ? data : JSON.stringify(data) }),
    )
  }

  serverClose(code = 1006) {
    this.readyState = 3
    this.onclose?.(new CloseEvent('close', { code }))
  }

  /** Parsed client messages. */
  messages(): unknown[] {
    return this.sent.map((raw) => JSON.parse(raw) as unknown)
  }
}

/** Factory that records every socket it creates. */
export function createFakeSocketFactory() {
  const sockets: FakeSocket[] = []
  const factory = (url: string) => {
    const socket = new FakeSocket(url)
    sockets.push(socket)
    return socket
  }
  return { sockets, factory, last: () => sockets[sockets.length - 1] }
}
