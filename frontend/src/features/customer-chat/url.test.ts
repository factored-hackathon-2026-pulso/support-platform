import { describe, expect, it } from 'vitest'
import { parseSimulatorChannel, toSimulatorSearch } from './url'

describe('simulator URL state', () => {
  it('maps ?channel= to the channel picked and back', () => {
    for (const channel of ['chat', 'call', 'email'] as const) {
      expect(toSimulatorSearch(channel).toString()).toBe(`channel=${channel}`)
      expect(parseSimulatorChannel(toSimulatorSearch(channel))).toBe(channel)
    }
    expect(toSimulatorSearch(null).toString()).toBe('')
  })

  it('shows the picker for an absent or unknown channel', () => {
    expect(parseSimulatorChannel(new URLSearchParams())).toBeNull()
    expect(parseSimulatorChannel(new URLSearchParams('channel=fax'))).toBeNull()
    expect(parseSimulatorChannel(new URLSearchParams('channel=llamada'))).toBeNull()
  })
})
