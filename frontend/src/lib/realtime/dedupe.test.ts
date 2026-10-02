import { describe, expect, it } from 'vitest'
import { RecentKeys, envelopeKey } from './dedupe'

describe('RecentKeys', () => {
  it('reports a repeated key once and forgets the oldest beyond capacity', () => {
    const keys = new RecentKeys(2)
    expect(keys.add('a')).toBe(true)
    expect(keys.add('a')).toBe(false)
    expect(keys.add('b')).toBe(true)
    expect(keys.add('c')).toBe(true) // evicts "a"
    expect(keys.size).toBe(2)
    expect(keys.add('a')).toBe(true)
  })

  it('refreshes the recency of a repeated key', () => {
    const keys = new RecentKeys(2)
    keys.add('a')
    keys.add('b')
    keys.add('a') // "a" is now the newest
    keys.add('c') // evicts "b"
    expect(keys.add('a')).toBe(false)
    expect(keys.add('b')).toBe(true)
  })
})

describe('envelopeKey', () => {
  it('tells apart envelopes of one event with different types', () => {
    expect(envelopeKey({ type: 'turn.created', id: 'EVT-1' })).not.toBe(
      envelopeKey({ type: 'case.updated', id: 'EVT-1' }),
    )
  })
})
