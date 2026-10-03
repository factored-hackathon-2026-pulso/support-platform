import { act, renderHook } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createFakeSocketFactory } from '@/test/fake-socket'
import { RealtimeClient } from './client'
import { RealtimeContext } from './context'
import { useOnReconnect } from './hooks'

function setup() {
  const sockets = createFakeSocketFactory()
  const client = new RealtimeClient({
    url: (t) => `ws://api.test/api/v1/ws?token=${t}`,
    getToken: () => 'tkn',
    createSocket: sockets.factory,
    backoff: { baseMs: 100, maxMs: 1_000, random: () => 1 - Number.EPSILON },
    onAuthError: () => {},
  })
  const wrapper = ({ children }: { children: ReactNode }) => (
    <RealtimeContext value={client}>{children}</RealtimeContext>
  )
  /** Drops the open socket and lets the client open a new one. */
  const reconnect = () => {
    act(() => sockets.last()?.serverClose(1006))
    act(() => vi.advanceTimersByTime(1_000))
    act(() => sockets.last()?.open())
  }
  return { client, sockets, wrapper, reconnect }
}

describe('useOnReconnect', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('runs the latest callback only on reconnecting → open', () => {
    const { client, sockets, wrapper, reconnect } = setup()
    const first = vi.fn<() => void>()
    const second = vi.fn<() => void>()
    const { rerender } = renderHook(({ callback }) => useOnReconnect(callback), {
      wrapper,
      initialProps: { callback: first },
    })
    act(() => client.connect())
    act(() => sockets.last()?.open())
    expect(first).not.toHaveBeenCalled()

    rerender({ callback: second })
    reconnect()
    expect(first).not.toHaveBeenCalled()
    expect(second).toHaveBeenCalledTimes(1)
  })

  it('does nothing while disabled', () => {
    const { client, sockets, wrapper, reconnect } = setup()
    const callback = vi.fn<() => void>()
    renderHook(() => useOnReconnect(callback, false), { wrapper })
    act(() => client.connect())
    act(() => sockets.last()?.open())
    reconnect()
    expect(callback).not.toHaveBeenCalled()
  })
})
