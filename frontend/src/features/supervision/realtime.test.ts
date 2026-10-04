import { QueryClient } from '@tanstack/react-query'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createEnvelopeHandlerRegistry, type RealtimeEnvelope } from '@/lib/realtime'
import { NOW } from '@/test/case-fixtures'
import { makeQueueOverview, makeTeamOverview, queuedGabriela } from '@/test/supervision-fixtures'
import { supervisionKeys } from './api'
import { TEAM_REFETCH_THROTTLE_MS, registerSupervisionRealtime } from './realtime'
import type { QueueCounts, QueueOverview } from './types'

let counter = 0
function envelope(type: string, payload: unknown): RealtimeEnvelope {
  counter += 1
  return {
    type,
    id: `EVT-S${counter}`,
    occurredAt: NOW.toISOString(),
    data: { entity: 'case', entityId: 'CASE-1', caseId: null, actor: null, payload },
  }
}

function setup() {
  const registry = createEnvelopeHandlerRegistry()
  registerSupervisionRealtime(registry)
  const queryClient = new QueryClient()
  queryClient.setQueryData(supervisionKeys.queues(), makeQueueOverview())
  queryClient.setQueryData(supervisionKeys.team(), makeTeamOverview())
  return { registry, queryClient }
}

const counts = (total: number, secondsAfterNow: number): QueueCounts => ({
  total,
  byLanguage: [
    { language: 'es', waiting: total, oldestQueuedAt: null },
    { language: 'pt', waiting: 0, oldestQueuedAt: null },
  ],
  computedAt: new Date(NOW.getTime() + secondsAfterNow * 1000).toISOString(),
})

describe('registerSupervisionRealtime', () => {
  it('handles the supervision envelopes of the contract', () => {
    const { registry, queryClient } = setup()
    for (const type of ['queue.updated', 'queue.case_queued', 'team.updated']) {
      expect(registry.dispatch(envelope(type, {}), queryClient)).toBe(1)
    }
  })

  it('queue.updated patches the counts when newer, then refetches the queues', () => {
    const { registry, queryClient } = setup()
    registry.dispatch(envelope('queue.updated', counts(2, 5)), queryClient)
    const overview = queryClient.getQueryData<QueueOverview>(supervisionKeys.queues())
    expect(overview?.counts.total).toBe(2)
    expect(queryClient.getQueryState(supervisionKeys.queues())?.isInvalidated).toBe(true)
  })

  it('queue.updated ignores counts that are not newer than the cache', () => {
    const { registry, queryClient } = setup()
    const before = queryClient.getQueryData<QueueOverview>(supervisionKeys.queues())
    registry.dispatch(envelope('queue.updated', counts(9, -5)), queryClient)
    registry.dispatch(envelope('queue.updated', counts(9, 0)), queryClient)
    expect(queryClient.getQueryData(supervisionKeys.queues())).toBe(before)
    expect(queryClient.getQueryState(supervisionKeys.queues())?.isInvalidated).toBe(false)
    registry.dispatch(envelope('queue.updated', { nope: true }), queryClient)
    expect(queryClient.getQueryData(supervisionKeys.queues())).toBe(before)
  })

  it('queue.case_queued refetches the queues', () => {
    const { registry, queryClient } = setup()
    registry.dispatch(envelope('queue.case_queued', queuedGabriela), queryClient)
    expect(queryClient.getQueryState(supervisionKeys.queues())?.isInvalidated).toBe(true)
    expect(queryClient.getQueryState(supervisionKeys.team())?.isInvalidated).toBe(false)
  })
})

describe('team.updated throttle', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('refetches at once, then at most once per window with a trailing call', () => {
    const { registry, queryClient } = setup()
    const spy = vi.spyOn(queryClient, 'invalidateQueries')
    // Each refetch: the team and "Colas" (the held cases move with the same signals).
    const invalidate = {
      get calls() {
        return spy.mock.calls.filter(([filters]) => filters?.queryKey?.[1] === 'team')
      },
    }
    const signal = () =>
      registry.dispatch(envelope('team.updated', { staffIds: ['STF-1'] }), queryClient)

    signal()
    expect(invalidate.calls).toHaveLength(1)
    expect(spy).toHaveBeenCalledWith({ queryKey: supervisionKeys.team(), exact: true })
    expect(spy).toHaveBeenCalledWith({ queryKey: supervisionKeys.openCases() })

    signal()
    signal()
    expect(invalidate.calls).toHaveLength(1)
    vi.advanceTimersByTime(TEAM_REFETCH_THROTTLE_MS)
    expect(invalidate.calls).toHaveLength(2) // the trailing call

    vi.advanceTimersByTime(TEAM_REFETCH_THROTTLE_MS)
    expect(invalidate.calls).toHaveLength(2) // nothing pending: the window closes
    signal()
    expect(invalidate.calls).toHaveLength(3) // a new window starts at once
  })

  it('keeps the throttle per registry', () => {
    const first = setup()
    const second = setup()
    const spy = vi.spyOn(second.queryClient, 'invalidateQueries')
    first.registry.dispatch(envelope('team.updated', { staffIds: [] }), first.queryClient)
    second.registry.dispatch(envelope('team.updated', { staffIds: [] }), second.queryClient)
    expect(spy).toHaveBeenCalledTimes(2) // team + "Colas", once
  })
})

describe('escalation.updated (slice 9)', () => {
  it('refetches "Escalados" (and its badge)', () => {
    const { registry, queryClient } = setup()
    queryClient.setQueryData(supervisionKeys.escalations(), { items: [], openCount: 0 })
    registry.dispatch(envelope('escalation.updated', { id: 'ESC-1' }), queryClient)
    expect(queryClient.getQueryState(supervisionKeys.escalations())?.isInvalidated).toBe(true)
  })
})
