import { describe, expect, it } from 'vitest'
import { apiBaseUrl, realtimeUrl } from './config'

describe('realtimeUrl', () => {
  it('follows the API origin and encodes the token', () => {
    expect(realtimeUrl('a b', 'http://localhost:8000/')).toBe(
      'ws://localhost:8000/api/v1/ws?token=a%20b',
    )
    expect(realtimeUrl('t', 'https://cc.example.com')).toBe(
      'wss://cc.example.com/api/v1/ws?token=t',
    )
  })

  it("uses the page's origin when the API is same-origin (behind CloudFront)", () => {
    expect(realtimeUrl('t', '', 'https://support.example.org')).toBe(
      'wss://support.example.org/api/v1/ws?token=t',
    )
    expect(realtimeUrl('t', '', 'http://localhost:5173')).toBe(
      'ws://localhost:5173/api/v1/ws?token=t',
    )
  })
})

describe('apiBaseUrl', () => {
  it('defaults to the local API and treats `/` or empty as same-origin', () => {
    expect(apiBaseUrl(undefined)).toBe('http://localhost:8000')
    expect(apiBaseUrl('https://api.example.org/')).toBe('https://api.example.org')
    expect(apiBaseUrl('/')).toBe('')
    expect(apiBaseUrl('')).toBe('')
  })
})
