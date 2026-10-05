import { describe, expect, it } from 'vitest'
import { createQueryClient } from './query-client'
import { createAppEnvelopeHandlers } from './realtime-handlers'
import { platformKeys, primePlatformSettings, readPlatformSettings } from './platform'

const updated = (payload: unknown) => ({
  type: 'platform.updated',
  id: 'EVT-1',
  occurredAt: '2026-10-04T15:00:00Z',
  data: {
    entity: 'platform',
    entityId: 'default',
    caseId: null,
    actor: { role: 'admin', id: null },
    payload,
  },
})

describe('platform settings (slice 18)', () => {
  it('reads the switch from platform.updated and ignores a malformed one', () => {
    expect(readPlatformSettings(updated({ aiEnabled: false }))).toEqual({ aiEnabled: false })
    expect(readPlatformSettings(updated({ aiEnabled: 'no' }))).toBeNull()
    expect(readPlatformSettings(updated(null))).toBeNull()
  })

  it('platform.updated replaces the cached switch for every screen', () => {
    const queryClient = createQueryClient()
    primePlatformSettings(queryClient, { aiEnabled: true })
    const handlers = createAppEnvelopeHandlers()
    handlers.dispatch(updated({ aiEnabled: false }), queryClient)
    expect(queryClient.getQueryData(platformKeys.settings())).toEqual({ aiEnabled: false })
    handlers.dispatch(updated({ aiEnabled: 1 }), queryClient)
    expect(queryClient.getQueryData(platformKeys.settings())).toEqual({ aiEnabled: false })
  })
})
