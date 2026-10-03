import { QueryClient } from '@tanstack/react-query'
import { describe, expect, it } from 'vitest'
import { createEnvelopeHandlerRegistry, type RealtimeEnvelope } from '@/lib/realtime'
import { NOW } from '@/test/case-fixtures'
import { TEAM_PACIFICO, supervisorStaff } from '@/test/fixtures'
import { sessionKeys, type Staff } from './session'
import { readStaff, registerSessionRealtime } from './session-realtime'

function meUpdated(payload: unknown, id = 'EVT-M1'): RealtimeEnvelope {
  return {
    type: 'me.updated',
    id,
    occurredAt: NOW.toISOString(),
    data: { entity: 'staff', entityId: 'STF-1', caseId: null, actor: null, payload },
  }
}

function setup(me: Staff | null = supervisorStaff) {
  const registry = createEnvelopeHandlerRegistry()
  registerSessionRealtime(registry)
  const queryClient = new QueryClient()
  if (me) queryClient.setQueryData(sessionKeys.me(), me)
  return { registry, queryClient }
}

describe('registerSessionRealtime', () => {
  it('me.updated replaces the cached me (roles, team) when it is the same person', () => {
    const { registry, queryClient } = setup()
    const fresh: Staff = { ...supervisorStaff, roles: ['analyst'], team: TEAM_PACIFICO }
    expect(registry.dispatch(meUpdated(fresh), queryClient)).toBe(1)
    expect(queryClient.getQueryData(sessionKeys.me())).toEqual(fresh)
  })

  it('ignores someone else, no session and malformed payloads', () => {
    const { registry, queryClient } = setup()
    registry.dispatch(meUpdated({ ...supervisorStaff, id: 'STF-OTRA', roles: [] }), queryClient)
    registry.dispatch(meUpdated({ id: supervisorStaff.id }), queryClient)
    expect(queryClient.getQueryData(sessionKeys.me())).toBe(supervisorStaff)
    expect(readStaff(meUpdated({ ...supervisorStaff, team: null }))).toBeNull()

    const anonymous = setup(null)
    anonymous.registry.dispatch(meUpdated(supervisorStaff), anonymous.queryClient)
    expect(anonymous.queryClient.getQueryData(sessionKeys.me())).toBeUndefined()
  })
})
