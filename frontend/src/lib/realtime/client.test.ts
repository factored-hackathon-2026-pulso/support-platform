import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createFakeSocketFactory } from '@/test/fake-socket'
import { RealtimeClient } from './client'
import type { ConnectionStatus, RealtimeEnvelope } from './types'

function setup(token: string | null = 'tkn') {
  const sockets = createFakeSocketFactory()
  let currentToken = token
  const onAuthError = vi.fn<() => void>()
  const client = new RealtimeClient({
    url: (t) => `ws://api.test/api/v1/ws?token=${t}`,
    getToken: () => currentToken,
    createSocket: sockets.factory,
    // Deterministic backoff: 100, 200, 400… ms.
    backoff: { baseMs: 100, maxMs: 1_000, random: () => 1 - Number.EPSILON },
    onAuthError,
  })
  const statuses: ConnectionStatus[] = []
  client.onStatusChange((status) => statuses.push(status))
  return {
    client,
    sockets,
    statuses,
    onAuthError,
    setToken: (t: string | null) => (currentToken = t),
  }
}

describe('RealtimeClient', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('connects with the token in the URL and reports status', () => {
    const { client, sockets, statuses } = setup()
    client.connect()
    expect(sockets.sockets).toHaveLength(1)
    expect(sockets.last()?.url).toBe('ws://api.test/api/v1/ws?token=tkn')
    sockets.last()?.open()
    expect(client.getStatus()).toBe('open')
    expect(statuses).toEqual(['connecting', 'open'])
  })

  it('does not connect without a token', () => {
    const { client, sockets } = setup(null)
    client.connect()
    expect(sockets.sockets).toHaveLength(0)
    expect(client.getStatus()).toBe('idle')
  })

  it('reconnects with growing backoff after unexpected closes and resets after a successful open', () => {
    const { client, sockets } = setup()
    client.connect()
    sockets.last()?.serverClose(1006)
    expect(client.getStatus()).toBe('reconnecting')

    vi.advanceTimersByTime(99)
    expect(sockets.sockets).toHaveLength(1)
    vi.advanceTimersByTime(1)
    expect(sockets.sockets).toHaveLength(2)

    // Second failure waits twice as long.
    sockets.last()?.serverClose(1006)
    vi.advanceTimersByTime(199)
    expect(sockets.sockets).toHaveLength(2)
    vi.advanceTimersByTime(1)
    expect(sockets.sockets).toHaveLength(3)

    // A successful open resets the attempt counter: next delay is back to 100 ms.
    sockets.last()?.open()
    sockets.last()?.serverClose(1006)
    vi.advanceTimersByTime(100)
    expect(sockets.sockets).toHaveLength(4)
  })

  it('caps the delay at maxMs', () => {
    const { client, sockets } = setup()
    client.connect()
    for (let i = 0; i < 6; i += 1) {
      sockets.last()?.serverClose(1006)
      vi.runOnlyPendingTimers()
    }
    const before = sockets.sockets.length
    sockets.last()?.serverClose(1006)
    vi.advanceTimersByTime(999)
    expect(sockets.sockets).toHaveLength(before)
    vi.advanceTimersByTime(1)
    expect(sockets.sockets).toHaveLength(before + 1)
  })

  it('does not reconnect after disconnect()', () => {
    const { client, sockets } = setup()
    client.connect()
    sockets.last()?.open()
    client.disconnect()
    expect(sockets.last()?.closedWith?.code).toBe(1000)
    expect(client.getStatus()).toBe('closed')
    vi.advanceTimersByTime(60_000)
    expect(sockets.sockets).toHaveLength(1)
  })

  it('cancels a pending reconnect on disconnect()', () => {
    const { client, sockets } = setup()
    client.connect()
    sockets.last()?.serverClose(1006)
    client.disconnect()
    vi.advanceTimersByTime(60_000)
    expect(sockets.sockets).toHaveLength(1)
  })

  it('stops and reports an auth error when the server rejects the token', () => {
    const { client, sockets, onAuthError } = setup()
    client.connect()
    sockets.last()?.serverClose(4401)
    expect(onAuthError).toHaveBeenCalledTimes(1)
    expect(client.getStatus()).toBe('closed')
    vi.advanceTimersByTime(60_000)
    expect(sockets.sockets).toHaveLength(1)
  })

  it('stays idle on reconnect when the token is gone', () => {
    const { client, sockets, setToken } = setup()
    client.connect()
    setToken(null)
    sockets.last()?.serverClose(1006)
    vi.runOnlyPendingTimers()
    expect(sockets.sockets).toHaveLength(1)
    expect(client.getStatus()).toBe('idle')
  })

  it('reference-counts topics and replays them after reconnecting', () => {
    const { client, sockets } = setup()
    client.connect()
    sockets.last()?.open()

    const offA = client.subscribe('case:CASE-1')
    const offB = client.subscribe('case:CASE-1')
    client.subscribe('approvals')
    expect(sockets.last()?.messages()).toEqual([
      { action: 'subscribe', topic: 'case:CASE-1' },
      { action: 'subscribe', topic: 'approvals' },
    ])

    offA()
    offA() // idempotent
    expect(sockets.last()?.messages()).toHaveLength(2)

    sockets.last()?.serverClose(1006)
    vi.runOnlyPendingTimers()
    sockets.last()?.open()
    expect(sockets.last()?.messages()).toEqual([
      { action: 'subscribe', topic: 'case:CASE-1' },
      { action: 'subscribe', topic: 'approvals' },
    ])

    offB()
    expect(sockets.last()?.messages()).toContainEqual({
      action: 'unsubscribe',
      topic: 'case:CASE-1',
    })
    expect(client.activeTopics()).toEqual(['approvals'])
  })

  it('queues subscriptions made while connecting and sends them on open', () => {
    const { client, sockets } = setup()
    client.connect()
    client.subscribe('inbox:STF-1')
    expect(sockets.last()?.sent).toEqual([])
    sockets.last()?.open()
    expect(sockets.last()?.messages()).toEqual([{ action: 'subscribe', topic: 'inbox:STF-1' }])
  })

  it('emits valid envelopes and ignores malformed frames', () => {
    const { client, sockets } = setup()
    const received: RealtimeEnvelope[] = []
    client.onEnvelope((envelope) => received.push(envelope))
    client.connect()
    sockets.last()?.open()

    sockets.last()?.receive({
      type: 'turn.created',
      id: 'EVT-1',
      occurredAt: '2026-01-01T00:00:00Z',
      data: { caseId: 'CASE-1' },
    })
    sockets.last()?.receive('not json')
    sockets.last()?.receive({ type: 'pong' })
    sockets.last()?.receive([1, 2, 3])

    expect(received).toEqual([
      {
        type: 'turn.created',
        id: 'EVT-1',
        occurredAt: '2026-01-01T00:00:00Z',
        data: { caseId: 'CASE-1' },
      },
    ])
  })
})
