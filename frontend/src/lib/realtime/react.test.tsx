import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createFakeSocketFactory } from '@/test/fake-socket'
import { RealtimeClient } from './client'
import { createEnvelopeHandlerRegistry } from './handlers'
import { RealtimeProvider } from './react'

function renderProvider() {
  const sockets = createFakeSocketFactory()
  const client = new RealtimeClient({
    url: (t) => `ws://api.test/api/v1/ws?token=${t}`,
    getToken: () => 'tkn',
    createSocket: sockets.factory,
    // A long backoff: only retryNow() can reconnect within the test.
    backoff: { baseMs: 60_000, maxMs: 60_000, random: () => 1 - Number.EPSILON },
  })
  render(
    <QueryClientProvider client={new QueryClient()}>
      <RealtimeProvider client={client} handlers={createEnvelopeHandlerRegistry()} token="tkn">
        <span />
      </RealtimeProvider>
    </QueryClientProvider>,
  )
  return { client, sockets }
}

describe('RealtimeProvider', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('reconnects at once when the browser comes back online', () => {
    const { client, sockets } = renderProvider()
    act(() => sockets.last()?.open())
    act(() => sockets.last()?.serverClose(1006))
    expect(client.getStatus()).toBe('reconnecting')
    expect(sockets.sockets).toHaveLength(1)

    act(() => {
      window.dispatchEvent(new Event('online'))
    })
    expect(sockets.sockets).toHaveLength(2)
  })

  it('reconnects at once when the tab becomes visible again', () => {
    const { sockets } = renderProvider()
    act(() => sockets.last()?.open())
    act(() => sockets.last()?.serverClose(1012))

    act(() => {
      document.dispatchEvent(new Event('visibilitychange'))
    })
    expect(sockets.sockets).toHaveLength(2)
  })
})
