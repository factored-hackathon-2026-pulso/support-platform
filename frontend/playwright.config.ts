import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig, devices } from '@playwright/test'

/**
 * Browser e2e (brief §8, slice 5): Chromium against a real backend on a FRESH
 * temporary SQLite database and the Vite dev server pointed at it.
 *
 * The runner evaluates this file in its main process and again in every worker.
 * The first evaluation picks two free ports and a temporary data directory and
 * hands them to the workers through `process.env` (workers inherit it), so every
 * process agrees on the same servers. `backend/cc_platform.db` is never touched.
 */

const FRONTEND_DIR = path.dirname(fileURLToPath(import.meta.url))
const BACKEND_DIR = path.resolve(FRONTEND_DIR, '../backend')

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer()
    server.unref()
    server.on('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      const port = typeof address === 'object' && address ? address.port : 0
      server.close(() => resolve(port))
    })
  })
}

if (!process.env.E2E_API_PORT) {
  process.env.E2E_API_PORT = String(await freePort())
  process.env.E2E_WEB_PORT = String(await freePort())
  process.env.E2E_DATA_DIR = path.join(tmpdir(), `cc-e2e-${process.pid}-${Date.now().toString(36)}`)
}

const apiPort = process.env.E2E_API_PORT
const webPort = process.env.E2E_WEB_PORT
const dataDir = process.env.E2E_DATA_DIR ?? ''
const apiURL = `http://127.0.0.1:${apiPort}`
const webURL = `http://127.0.0.1:${webPort}`
process.env.E2E_API_URL = apiURL
process.env.E2E_WEB_URL = webURL

export default defineConfig({
  testDir: './e2e',
  // One shared backend whose assignment depends on who is available (rule 3, least
  // loaded): the scenarios run one at a time, each one creating its own people.
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  timeout: 90_000,
  expect: { timeout: 10_000 },
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : [['list']],
  globalTeardown: './e2e/support/global-teardown.ts',
  use: {
    baseURL: webURL,
    locale: 'es-CO',
    timezoneId: 'America/Bogota',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'off',
    actionTimeout: 10_000,
    navigationTimeout: 20_000,
  },
  projects: [
    {
      name: 'chromium',
      // Desktop-first boards are 1440×900 (brief §5.4).
      use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } },
    },
  ],
  webServer: [
    {
      name: 'api',
      // `mkdir` first: SQLite creates the database file, not its directory.
      command: `mkdir -p "${dataDir}" && uv run uvicorn cc_platform.bootstrap.app:create_app --factory --host 127.0.0.1 --port ${apiPort} --log-level warning`,
      cwd: BACKEND_DIR,
      url: `${apiURL}/api/v1/health`,
      reuseExistingServer: false,
      timeout: 120_000,
      stdout: 'ignore',
      stderr: 'pipe',
      env: {
        CC_ENV: 'test',
        CC_PERSISTENCE: 'sqlalchemy',
        CC_DATABASE_URL: `sqlite+aiosqlite:///${path.join(dataDir, 'cc_platform.db')}`,
        CC_SEED_DEMO_DATA: 'true',
        CC_CORS_ORIGINS: JSON.stringify([webURL]),
        CC_LOG_LEVEL: 'WARNING',
        CC_LOG_FORMAT: 'console',
      },
    },
    {
      name: 'web',
      command: `pnpm exec vite --host 127.0.0.1 --port ${webPort} --strictPort`,
      cwd: FRONTEND_DIR,
      url: webURL,
      reuseExistingServer: false,
      timeout: 120_000,
      stdout: 'ignore',
      stderr: 'pipe',
      env: { VITE_API_URL: apiURL },
    },
  ],
})
