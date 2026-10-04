import { QueryClient } from '@tanstack/react-query'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createEnvelopeHandlerRegistry, type RealtimeEnvelope } from '@/lib/realtime'
import { homeKeys } from './api'
import { HOME_REFETCH_THROTTLE_MS, HOME_SIGNALS, registerHomeRealtime } from './realtime'

const at = (type: string, id = 'EVT-1'): RealtimeEnvelope => ({
  type,
  id,
  occurredAt: '2026-03-05T16:00:00Z',
  data: {},
})

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('registerHomeRealtime', () => {
  it('refetches "Inicio" on her inbox, availability and queue signals, nothing else', () => {
    const registry = createEnvelopeHandlerRegistry()
    registerHomeRealtime(registry)
    const queryClient = new QueryClient()
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries')
    expect(HOME_SIGNALS).toEqual([
      'case.assigned',
      'case.unassigned',
      'case.updated',
      'inbox.counts',
      'availability.updated',
      'queue.updated',
      'queue.case_queued',
    ])
    for (const type of HOME_SIGNALS) expect(registry.dispatch(at(type), queryClient)).toBe(1)
    expect(registry.dispatch(at('turn.created'), queryClient)).toBe(0)
    expect(registry.dispatch(at('team.updated'), queryClient)).toBe(0)
    expect(invalidate).toHaveBeenCalledWith({ queryKey: homeKeys.all })
  })

  it('throttles: one refetch at once, one trailing for the burst, none when quiet', () => {
    const registry = createEnvelopeHandlerRegistry()
    registerHomeRealtime(registry)
    const queryClient = new QueryClient()
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries')

    registry.dispatch(at('case.updated', 'EVT-1'), queryClient)
    registry.dispatch(at('inbox.counts', 'EVT-2'), queryClient)
    registry.dispatch(at('case.updated', 'EVT-3'), queryClient)
    expect(invalidate).toHaveBeenCalledTimes(1)

    vi.advanceTimersByTime(HOME_REFETCH_THROTTLE_MS)
    expect(invalidate).toHaveBeenCalledTimes(2) // trailing call for the burst
    vi.advanceTimersByTime(HOME_REFETCH_THROTTLE_MS * 3)
    expect(invalidate).toHaveBeenCalledTimes(2)

    registry.dispatch(at('availability.updated', 'EVT-4'), queryClient)
    expect(invalidate).toHaveBeenCalledTimes(3)
  })

  it('keeps the throttle per registry', () => {
    const first = createEnvelopeHandlerRegistry()
    const second = createEnvelopeHandlerRegistry()
    registerHomeRealtime(first)
    registerHomeRealtime(second)
    const queryClient = new QueryClient()
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries')
    first.dispatch(at('case.updated'), queryClient)
    second.dispatch(at('case.updated'), queryClient)
    expect(invalidate).toHaveBeenCalledTimes(2)
  })
})
