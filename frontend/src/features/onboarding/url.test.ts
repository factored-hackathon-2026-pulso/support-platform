import { describe, expect, it } from 'vitest'
import { inAppPath, readToken } from './url'

describe('the emailed links', () => {
  it('reads the token (blank = none)', () => {
    expect(readToken(new URLSearchParams('token=abc'))).toBe('abc')
    expect(readToken(new URLSearchParams('token=%20'))).toBeNull()
    expect(readToken(new URLSearchParams(''))).toBeNull()
  })

  it('opens the activation and reset links inside the SPA, never a foreign one', () => {
    expect(inAppPath('http://localhost:5173/activate?token=abc')).toBe('/activate?token=abc')
    expect(inAppPath('http://127.0.0.1:4000/reset-password?token=x-y')).toBe(
      '/reset-password?token=x-y',
    )
    expect(inAppPath('http://localhost:5173/activar?token=abc')).toBeNull()
    expect(inAppPath('https://evil.example/login')).toBeNull()
    expect(inAppPath('not a url')).toBeNull()
  })
})
