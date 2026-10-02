import '@testing-library/jest-dom/vitest'
import { cleanup } from '@testing-library/react'
import { afterEach, vi } from 'vitest'
import { customerSessionToken, sessionToken } from '@/lib/session-token'

// No real network in tests: the app-wide API client sees a failing fetch.
// Mock the feature `api.ts` modules instead (or pass `fetch` to createApiClient).
globalThis.fetch = vi.fn<typeof fetch>(() =>
  Promise.reject(new TypeError('Network disabled in tests')),
)

afterEach(() => {
  cleanup()
  sessionToken.clear()
  customerSessionToken.clear()
  try {
    sessionStorage.clear()
  } catch {
    // Storage unavailable: nothing to clean.
  }
})
