import { QueryClient } from '@tanstack/react-query'
import { describe, expect, it, vi } from 'vitest'
import {
  topics,
  type EnvelopeHandler,
  type RealtimeEnvelope,
  type RealtimeRegistration,
} from '@/lib/realtime'
import { createAppEnvelopeHandlers } from './realtime-handlers'

const envelope: RealtimeEnvelope = {
  type: 'case.updated',
  id: 'EVT-1',
  occurredAt: '2026-01-01T00:00:00Z',
  data: { caseId: 'CASE-1' },
}

describe('createAppEnvelopeHandlers', () => {
  it('runs every feature registration on a fresh registry', () => {
    const handler = vi.fn<EnvelopeHandler>()
    const registerCases: RealtimeRegistration = (registry) => {
      registry.register('case.updated', handler)
    }
    const registry = createAppEnvelopeHandlers([registerCases])
    expect(registry.dispatch(envelope, new QueryClient())).toBe(1)
    expect(handler).toHaveBeenCalledWith(envelope, expect.any(QueryClient))
  })

  it('never shares handlers between registries', () => {
    const registerCases: RealtimeRegistration = (registry) => {
      registry.register('case.updated', () => {})
    }
    createAppEnvelopeHandlers([registerCases])
    expect(createAppEnvelopeHandlers([]).dispatch(envelope, new QueryClient())).toBe(0)
  })
})

describe('FEATURE_REALTIME_REGISTRATIONS', () => {
  const at = (type: string): RealtimeEnvelope => ({ ...envelope, type, data: {} })

  it('handles every staff envelope of slices 1–2 (inbox + open conversation)', () => {
    const registry = createAppEnvelopeHandlers()
    const queryClient = new QueryClient()
    expect(registry.dispatch(at('turn.created'), queryClient)).toBe(1) // conversation
    expect(registry.dispatch(at('case.updated'), queryClient)).toBe(2) // inbox + conversation
    expect(registry.dispatch(at('case.assigned'), queryClient)).toBe(2)
    expect(registry.dispatch(at('inbox.counts'), queryClient)).toBe(1)
    expect(registry.dispatch(at('availability.updated'), queryClient)).toBe(1)
  })

  it('handles the supervision envelopes of slice 3', () => {
    const registry = createAppEnvelopeHandlers()
    const queryClient = new QueryClient()
    expect(registry.dispatch(at('case.unassigned'), queryClient)).toBe(1) // inbox
    expect(registry.dispatch(at('queue.updated'), queryClient)).toBe(1)
    expect(registry.dispatch(at('queue.case_queued'), queryClient)).toBe(1)
    expect(registry.dispatch(at('team.updated'), queryClient)).toBe(1)
  })

  it('handles the administration and personal envelopes of slice 4', () => {
    const registry = createAppEnvelopeHandlers()
    const queryClient = new QueryClient()
    expect(registry.dispatch(at('directory.updated'), queryClient)).toBe(1)
    expect(registry.dispatch(at('me.updated'), queryClient)).toBe(1)
  })

  it('leaves customer envelopes to the simulator registry', () => {
    const registry = createAppEnvelopeHandlers()
    expect(registry.dispatch(at('conversation.updated'), new QueryClient())).toBe(0)
    expect(topics.customer('CUS-1')).toBe('customer:CUS-1')
  })
})
