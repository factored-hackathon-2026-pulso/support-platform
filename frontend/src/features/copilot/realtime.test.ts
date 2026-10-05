import { QueryClient } from '@tanstack/react-query'
import { describe, expect, it } from 'vitest'
import { createEnvelopeHandlerRegistry, type RealtimeEnvelope } from '@/lib/realtime'
import { copilotKeys } from './api'
import { registerCopilotRealtime } from './realtime'

const CASE_ID = 'CASE-00000000000000000000000101'

function envelope(
  type: string,
  payload: Record<string, unknown>,
  caseId = CASE_ID,
): RealtimeEnvelope {
  return {
    type,
    id: `EVT-${type}`,
    occurredAt: '2026-10-04T19:30:00Z',
    data: { entity: 'copilot', entityId: 'CPS-1', caseId, actor: null, payload },
  }
}

function setup() {
  const registry = createEnvelopeHandlerRegistry()
  registerCopilotRealtime(registry)
  const queryClient = new QueryClient()
  queryClient.setQueryData(copilotKeys.latest(CASE_ID), { available: true, suggestion: null })
  const stale = () => queryClient.getQueryState(copilotKeys.latest(CASE_ID))?.isInvalidated
  return { registry, queryClient, stale }
}

describe('registerCopilotRealtime', () => {
  it('reads the newest suggestion again on `copilot.suggestion_updated`', () => {
    const { registry, queryClient, stale } = setup()
    registry.dispatch(
      envelope('copilot.suggestion_updated', { suggestionId: 'CPS-1', status: 'ready' }),
      queryClient,
    )
    expect(stale()).toBe(true)
  })

  it('reads it again when the customer writes, not for her own turns', () => {
    const { registry, queryClient, stale } = setup()
    registry.dispatch(envelope('turn.created', { authorRole: 'analyst' }), queryClient)
    expect(stale()).toBe(false)
    registry.dispatch(envelope('turn.created', { authorRole: 'customer' }), queryClient)
    expect(stale()).toBe(true)
  })

  it('ignores a case nobody shows', () => {
    const { registry, queryClient } = setup()
    registry.dispatch(
      envelope('copilot.suggestion_updated', { status: 'ready' }, 'CASE-OTHER'),
      queryClient,
    )
    expect(queryClient.getQueryState(copilotKeys.latest('CASE-OTHER'))).toBeUndefined()
  })

  it('reads the stages per case type again on `ai.stage_updated` (slice 21)', () => {
    const { registry, queryClient } = setup()
    queryClient.setQueryData(copilotKeys.stages(), { available: true, types: [] })
    registry.dispatch(envelope('ai.stage_updated', { caseType: 'app_issue' }, ''), queryClient)
    expect(queryClient.getQueryState(copilotKeys.stages())?.isInvalidated).toBe(true)
  })
})
