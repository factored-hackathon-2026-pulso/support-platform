import { QueryClient } from '@tanstack/react-query'
import { describe, expect, it, vi } from 'vitest'
import { createEnvelopeHandlerRegistry, type EnvelopeHandler } from './handlers'
import type { RealtimeEnvelope } from './types'

const envelope: RealtimeEnvelope = {
  type: 'case.updated',
  id: 'EVT-9',
  occurredAt: '2026-01-01T00:00:00Z',
  data: { caseId: 'CASE-1', status: 'en_curso' },
}

describe('envelope handler registry', () => {
  it('dispatches to the handlers of the envelope type and lets them update the cache', () => {
    const registry = createEnvelopeHandlerRegistry()
    const queryClient = new QueryClient()
    registry.register('case.updated', (env, qc) => {
      qc.setQueryData(['cases', 'detail', 'CASE-1'], env.data)
    })
    const other = vi.fn<EnvelopeHandler>()
    registry.register('turn.created', other)

    expect(registry.dispatch(envelope, queryClient)).toBe(1)
    expect(queryClient.getQueryData(['cases', 'detail', 'CASE-1'])).toEqual(envelope.data)
    expect(other).not.toHaveBeenCalled()
  })

  it('unregisters handlers and survives a failing one', () => {
    const registry = createEnvelopeHandlerRegistry()
    const queryClient = new QueryClient()
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const broken = vi.fn<EnvelopeHandler>(() => {
      throw new Error('boom')
    })
    const healthy = vi.fn<EnvelopeHandler>()
    registry.register('case.updated', broken)
    const off = registry.register('case.updated', healthy)

    registry.dispatch(envelope, queryClient)
    expect(healthy).toHaveBeenCalledTimes(1)
    expect(errorSpy).toHaveBeenCalled()

    off()
    registry.dispatch(envelope, queryClient)
    expect(healthy).toHaveBeenCalledTimes(1)
  })
})
