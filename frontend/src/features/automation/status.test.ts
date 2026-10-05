import { describe, expect, it } from 'vitest'
import { BUILDER_OFF, BUILDER_ON } from '@/test/automation-fixtures'
import { isAgentsServiceDown } from './hooks/use-automation'

describe('isAgentsServiceDown (deploy brief P4)', () => {
  it('is down only when agent-core is wired and does not answer', () => {
    expect(isAgentsServiceDown({ ...BUILDER_ON, reachable: false })).toBe(true)
    expect(isAgentsServiceDown({ ...BUILDER_ON, reachable: true })).toBe(false)
    // not wired at all is "El motor de IA no está conectado", not "down"
    expect(isAgentsServiceDown({ ...BUILDER_OFF, reachable: false })).toBe(false)
    expect(isAgentsServiceDown(undefined)).toBe(false)
  })
})
