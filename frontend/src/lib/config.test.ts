import { describe, expect, it } from 'vitest'
import { realtimeUrl } from './config'

describe('realtimeUrl', () => {
  it('follows the API origin and encodes the token', () => {
    expect(realtimeUrl('a b', 'http://localhost:8000/')).toBe(
      'ws://localhost:8000/api/v1/ws?token=a%20b',
    )
    expect(realtimeUrl('t', 'https://cc.example.com')).toBe(
      'wss://cc.example.com/api/v1/ws?token=t',
    )
  })
})
