import { describe, expect, it } from 'vitest'
import {
  envelopeActor,
  envelopeCaseId,
  envelopePayload,
  topics,
  type RealtimeEnvelope,
} from './types'

const at = (data: unknown): RealtimeEnvelope => ({
  type: 'case.assigned',
  id: 'EVT-1',
  occurredAt: '2026-03-05T16:00:00Z',
  data,
})

describe('envelope readers', () => {
  it('reads the actor of a domain envelope', () => {
    expect(envelopeActor(at({ actor: { role: 'supervisor', id: 'STF-1' } }))).toEqual({
      role: 'supervisor',
      id: 'STF-1',
    })
    expect(envelopeActor(at({ actor: { role: 'system', id: null } }))).toEqual({
      role: 'system',
      id: null,
    })
  })

  it('returns null for a missing or malformed actor', () => {
    expect(envelopeActor(at({}))).toBeNull()
    expect(envelopeActor(at({ actor: { id: 'STF-1' } }))).toBeNull()
    expect(envelopeActor(at('nope'))).toBeNull()
  })

  it('reads the payload and the case id', () => {
    const envelope = at({ caseId: 'CASE-1', payload: { id: 'CASE-1' } })
    expect(envelopePayload(envelope)).toEqual({ id: 'CASE-1' })
    expect(envelopeCaseId(envelope)).toBe('CASE-1')
    expect(envelopePayload(at({ payload: [] }))).toBeNull()
  })
})

describe('topics', () => {
  it('names the supervision topics', () => {
    expect(topics.supervisionQueues()).toBe('supervision:queues')
    expect(topics.supervisionTeam()).toBe('supervision:team')
  })

  it('names the administration and personal topics', () => {
    expect(topics.adminDirectory()).toBe('admin:directory')
    expect(topics.staff('STF-1')).toBe('staff:STF-1')
  })
})
