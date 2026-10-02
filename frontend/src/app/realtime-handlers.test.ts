import { QueryClient } from '@tanstack/react-query'
import { describe, expect, it, vi } from 'vitest'
import type { EnvelopeHandler, RealtimeEnvelope, RealtimeRegistration } from '@/lib/realtime'
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
