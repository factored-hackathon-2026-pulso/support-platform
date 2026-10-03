import '@testing-library/jest-dom/vitest'
import { cleanup, configure } from '@testing-library/react'
import { afterEach, vi } from 'vitest'
import { customerSessionToken, sessionToken } from '@/lib/session-token'

// Route tests render the real lazy route table: the first `import()` of a screen
// (transform + module graph + first render in jsdom) can take well over the 1 s
// default under CPU load (CI runners, parallel gates). findBy*/waitFor still
// resolve as soon as the DOM matches; only a genuine failure waits the full 5 s.
// The per-test timeout (vite.config.ts) stays above it so the real error surfaces.
configure({ asyncUtilTimeout: 5000 })

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
